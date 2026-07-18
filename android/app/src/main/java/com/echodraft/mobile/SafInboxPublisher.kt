package com.echodraft.mobile

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import java.util.UUID

class SafInboxPublisher(
    context: Context,
    private val treeStore: InboxTreeStore = InboxTreeStore(context),
) {
    data class Result(val externalId: UUID, val manifestFileName: String)

    private data class DocumentEntry(
        val uri: Uri,
        val displayName: String,
        val flags: Int,
    )

    private val resolver: ContentResolver = context.applicationContext.contentResolver
    private val journal = PublicationJournal(context)

    fun publish(recording: PendingRecordingStore.ReadyRecording): Result {
        val sizeBytes = recording.file.length()
        check(sizeBytes in 1..MobileInboxProtocol.MAX_AUDIO_BYTES.toLong()) {
            "Pending memo is empty or exceeds the 32 MB limit"
        }
        val manifest = MobileInboxProtocol.Manifest(
            externalId = recording.externalId,
            audioSha256 = MobileInboxProtocol.sha256(recording.file),
            sizeBytes = sizeBytes,
            createdAt = recording.createdAt,
        )
        val manifestBytes = manifest.toJson().toByteArray(Charsets.UTF_8)
        check(manifestBytes.size <= MobileInboxProtocol.MAX_MANIFEST_BYTES)

        val root = treeStore.requireWritableRoot()
        preflightFinalNames(root, manifest, manifestBytes)
        val audio = ensureAudio(root, manifest, recording.file)
        val readyManifest = ensureManifest(root, manifest, manifestBytes)

        // A successful return is the only point at which the service may retire its private copy.
        verifyAudio(audio, manifest)
        verifyManifest(readyManifest, manifestBytes)
        journal.clear(recording.externalId)
        return Result(recording.externalId, manifest.manifestFile)
    }

    private fun preflightFinalNames(
        root: InboxTreeStore.Root,
        manifest: MobileInboxProtocol.Manifest,
        manifestBytes: ByteArray,
    ) {
        val audio = findChild(root, manifest.audioFile)
        val readyManifest = findChild(root, manifest.manifestFile)
        val audioMatches = audio?.let {
            val (size, hash) = hashDocument(it.uri)
            size == manifest.sizeBytes && hash == manifest.audioSha256
        }
        val manifestMatches = readyManifest?.let {
            readBounded(it.uri, MobileInboxProtocol.MAX_MANIFEST_BYTES)
                ?.contentEquals(manifestBytes) == true
        }

        check(audioMatches != false || journal.ownsAudio(manifest.externalId, audio!!.uri)) {
            "A different file already uses this memo's audio filename"
        }
        check(
            manifestMatches != false ||
                journal.ownsManifest(manifest.externalId, readyManifest!!.uri),
        ) { "A different file already uses this memo's ready-manifest filename" }
    }

    private fun ensureAudio(
        root: InboxTreeStore.Root,
        manifest: MobileInboxProtocol.Manifest,
        source: File,
    ): DocumentEntry {
        val existing = findChild(root, manifest.audioFile)
        if (existing != null) {
            val (size, hash) = hashDocument(existing.uri)
            if (size == manifest.sizeBytes && hash == manifest.audioSha256) return existing
            check(journal.ownsAudio(manifest.externalId, existing.uri)) {
                "A different file already uses this memo's audio filename"
            }
            deleteRequired(existing, "incomplete audio from an earlier attempt")
        }

        val created = createExactDocument(root, MobileInboxProtocol.AUDIO_MIME_TYPE, manifest.audioFile)
        try {
            journal.rememberAudio(manifest.externalId, created.uri)
            requireWritableAndRecoverable(created)
            resolver.openOutputStream(created.uri, "w")?.buffered().use { output ->
                checkNotNull(output) { "The provider would not open the audio document" }
                source.inputStream().buffered().use { input -> input.copyTo(output) }
            }
            verifyAudio(created, manifest)
            return created
        } catch (error: Throwable) {
            cleanupAfterFailure(created, error)
        }
    }

    private fun ensureManifest(
        root: InboxTreeStore.Root,
        manifest: MobileInboxProtocol.Manifest,
        contents: ByteArray,
    ): DocumentEntry {
        val existing = findChild(root, manifest.manifestFile)
        if (existing != null) {
            if (
                readBounded(existing.uri, MobileInboxProtocol.MAX_MANIFEST_BYTES)
                    ?.contentEquals(contents) == true
            ) {
                return existing
            }
            check(journal.ownsManifest(manifest.externalId, existing.uri)) {
                "A different file already uses this memo's ready-manifest filename"
            }
            deleteRequired(existing, "incomplete ready manifest from an earlier attempt")
        }

        val temporaryName =
            "${manifest.externalId.toString().lowercase()}.ready.${UUID.randomUUID()}.tmp.json"
        val temporary = createExactDocument(root, MobileInboxProtocol.MANIFEST_MIME_TYPE, temporaryName)
        try {
            requireWritableAndRecoverable(temporary)
            writeBytes(temporary.uri, contents)
            verifyManifest(temporary, contents)
        } catch (error: Throwable) {
            cleanupAfterFailure(temporary, error)
        }

        if (temporary.flags and DocumentsContract.Document.FLAG_SUPPORTS_RENAME != 0) {
            val renamedUri = tryRename(temporary.uri, manifest.manifestFile)
            if (renamedUri != null) {
                try {
                    journal.rememberManifest(manifest.externalId, renamedUri)
                    val renamed = queryDocument(renamedUri)
                    check(renamed.displayName == manifest.manifestFile) {
                        "The provider changed the ready-manifest filename"
                    }
                    verifyManifest(renamed, contents)
                    return renamed
                } catch (error: Throwable) {
                    cleanupUriAfterFailure(renamedUri, error)
                }
            }
        }

        // A provider can report rename failure after completing it. Recheck the final name before
        // deleting the temporary document or attempting the portable final-name fallback.
        findChild(root, manifest.manifestFile)?.let { ambiguousResult ->
            if (
                readBounded(ambiguousResult.uri, MobileInboxProtocol.MAX_MANIFEST_BYTES)
                    ?.contentEquals(contents) == true
            ) {
                if (temporary.uri != ambiguousResult.uri) deleteIfStillPresent(temporary)
                return ambiguousResult
            }
            if (temporary.uri == ambiguousResult.uri) {
                journal.rememberManifest(manifest.externalId, ambiguousResult.uri)
            }
            check(journal.ownsManifest(manifest.externalId, ambiguousResult.uri)) {
                "A different file already uses this memo's ready-manifest filename"
            }
            deleteRequired(ambiguousResult, "incomplete ready manifest from a failed rename")
        }

        deleteIfStillPresent(temporary)
        val finalDocument = createExactDocument(
            root,
            MobileInboxProtocol.MANIFEST_MIME_TYPE,
            manifest.manifestFile,
        )
        try {
            journal.rememberManifest(manifest.externalId, finalDocument.uri)
            requireWritableAndRecoverable(finalDocument)
            writeBytes(finalDocument.uri, contents)
            verifyManifest(finalDocument, contents)
            return finalDocument
        } catch (error: Throwable) {
            cleanupAfterFailure(finalDocument, error)
        }
    }

    private fun tryRename(uri: Uri, finalName: String): Uri? =
        try {
            DocumentsContract.renameDocument(resolver, uri, finalName)
        } catch (_: FileNotFoundException) {
            null
        } catch (_: UnsupportedOperationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }

    private fun createExactDocument(
        root: InboxTreeStore.Root,
        mimeType: String,
        displayName: String,
    ): DocumentEntry {
        val uri = DocumentsContract.createDocument(resolver, root.documentUri, mimeType, displayName)
            ?: error("The provider could not create $displayName")
        try {
            val created = queryDocument(uri)
            check(created.displayName == displayName) {
                "The provider changed the required filename $displayName"
            }
            return created
        } catch (error: Throwable) {
            cleanupUriAfterFailure(uri, error)
        }
    }

    private fun findChild(root: InboxTreeStore.Root, displayName: String): DocumentEntry? {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            root.treeUri,
            root.documentId,
        )
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_FLAGS,
        )
        val matches = mutableListOf<DocumentEntry>()
        resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                if (cursor.getString(1) != displayName) continue
                val uri = DocumentsContract.buildDocumentUriUsingTree(root.treeUri, cursor.getString(0))
                matches += DocumentEntry(uri, cursor.getString(1), cursor.getInt(2))
            }
        } ?: error("The selected shared folder could not be read")
        check(matches.size <= 1) { "The provider returned duplicate files named $displayName" }
        return matches.singleOrNull()
    }

    private fun queryDocument(uri: Uri): DocumentEntry {
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_FLAGS,
        )
        return resolver.query(uri, projection, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            DocumentEntry(uri, cursor.getString(0), cursor.getInt(1))
        } ?: error("The provider could not confirm a published document")
    }

    private fun requireWritableAndRecoverable(document: DocumentEntry) {
        check(document.flags and DocumentsContract.Document.FLAG_SUPPORTS_WRITE != 0) {
            "The selected provider does not allow writing this document"
        }
        check(document.flags and DocumentsContract.Document.FLAG_SUPPORTS_DELETE != 0) {
            "The selected provider cannot safely recover an interrupted write"
        }
    }

    private fun verifyAudio(document: DocumentEntry, manifest: MobileInboxProtocol.Manifest) {
        val (size, hash) = hashDocument(document.uri)
        check(size == manifest.sizeBytes && hash == manifest.audioSha256) {
            "The provider did not preserve the complete audio document"
        }
    }

    private fun verifyManifest(document: DocumentEntry, contents: ByteArray) {
        check(
            readBounded(document.uri, MobileInboxProtocol.MAX_MANIFEST_BYTES)
                ?.contentEquals(contents) == true,
        ) { "The provider did not preserve the complete ready manifest" }
    }

    private fun writeBytes(uri: Uri, contents: ByteArray) {
        resolver.openOutputStream(uri, "w")?.buffered().use { output ->
            checkNotNull(output) { "The provider would not open the ready manifest" }
            output.write(contents)
        }
    }

    private fun readBounded(uri: Uri, maxBytes: Int): ByteArray? {
        val output = ByteArrayOutputStream()
        resolver.openInputStream(uri)?.buffered().use { input ->
            checkNotNull(input) { "The provider would not open an existing document" }
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (output.size() + count > maxBytes) return null
                output.write(buffer, 0, count)
            }
        }
        return output.toByteArray()
    }

    private fun hashDocument(uri: Uri): Pair<Long, String> {
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        resolver.openInputStream(uri)?.buffered().use { input ->
            checkNotNull(input) { "The provider would not open existing audio" }
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                size += count
                if (size > MobileInboxProtocol.MAX_AUDIO_BYTES.toLong()) return size to ""
                digest.update(buffer, 0, count)
            }
        }
        val hash = digest.digest().joinToString("") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }
        return size to hash
    }

    private fun deleteRequired(document: DocumentEntry, label: String) {
        check(document.flags and DocumentsContract.Document.FLAG_SUPPORTS_DELETE != 0) {
            "The provider cannot remove $label"
        }
        check(DocumentsContract.deleteDocument(resolver, document.uri)) {
            "The provider did not remove $label"
        }
    }

    private fun deleteIfStillPresent(document: DocumentEntry) {
        try {
            deleteRequired(document, "the temporary ready manifest")
        } catch (_: FileNotFoundException) {
            // A successful or ambiguous rename can make the original URI disappear.
        }
    }

    private fun cleanupAfterFailure(document: DocumentEntry, error: Throwable): Nothing {
        try {
            deleteRequired(document, "an incomplete document")
        } catch (cleanupError: Throwable) {
            error.addSuppressed(cleanupError)
        }
        throw error
    }

    private fun cleanupUriAfterFailure(uri: Uri, error: Throwable): Nothing {
        try {
            check(DocumentsContract.deleteDocument(resolver, uri)) {
                "The provider did not remove an incomplete document"
            }
        } catch (cleanupError: Throwable) {
            error.addSuppressed(cleanupError)
        }
        throw error
    }
}
