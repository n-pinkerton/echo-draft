package com.echodraft.mobile

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import java.io.ByteArrayOutputStream

internal class SafDiagnosticSink(
    context: Context,
    private val treeStore: InboxTreeStore = InboxTreeStore(context),
) {
    private data class DocumentEntry(
        val uri: Uri,
        val displayName: String,
        val mimeType: String,
        val flags: Int,
    )

    private val resolver: ContentResolver = context.applicationContext.contentResolver
    private val journal = PublicationJournal(context)

    fun publish(snapshot: ByteArray) {
        check(MobileDiagnosticStore.hasFormatHeader(snapshot)) {
            "Invalid mobile diagnostic snapshot"
        }
        val root = treeStore.requireWritableRoot()
        val document = findChild(root) ?: createDocument(root)
        check(document.mimeType != DocumentsContract.Document.MIME_TYPE_DIR) {
            "The mobile diagnostic destination is not a file"
        }
        check(document.flags and DocumentsContract.Document.FLAG_SUPPORTS_WRITE != 0) {
            "The selected provider does not allow diagnostic updates"
        }

        val existing = readBounded(document.uri)
        check(canReplaceExisting(existing, journal.ownsDiagnostics(document.uri))) {
            "A different file already uses the mobile diagnostic filename"
        }
        journal.rememberDiagnostics(document.uri)

        resolver.openOutputStream(document.uri, "wt")?.buffered().use { output ->
            checkNotNull(output) { "The provider would not open the mobile diagnostic file" }
            output.write(snapshot)
        }
        check(readBounded(document.uri).contentEquals(snapshot)) {
            "The provider did not preserve the complete mobile diagnostics"
        }
        journal.clearDiagnostics()
    }

    private fun createDocument(root: InboxTreeStore.Root): DocumentEntry {
        val uri = DocumentsContract.createDocument(
            resolver,
            root.documentUri,
            MIME_TYPE,
            MobileDiagnosticStore.SHARED_FILE_NAME,
        ) ?: error("The provider could not create the mobile diagnostic file")
        journal.rememberDiagnostics(uri)
        return queryDocument(uri).also { document ->
            check(document.displayName == MobileDiagnosticStore.SHARED_FILE_NAME) {
                "The provider changed the mobile diagnostic filename"
            }
        }
    }

    private fun findChild(root: InboxTreeStore.Root): DocumentEntry? {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            root.treeUri,
            root.documentId,
        )
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_FLAGS,
        )
        val matches = mutableListOf<DocumentEntry>()
        resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
            while (cursor.moveToNext()) {
                if (cursor.getString(1) != MobileDiagnosticStore.SHARED_FILE_NAME) continue
                matches += DocumentEntry(
                    uri = DocumentsContract.buildDocumentUriUsingTree(root.treeUri, cursor.getString(0)),
                    displayName = cursor.getString(1),
                    mimeType = cursor.getString(2),
                    flags = cursor.getInt(3),
                )
            }
        } ?: error("The selected shared folder could not be read for diagnostics")
        check(matches.size <= 1) { "The provider returned duplicate mobile diagnostic files" }
        return matches.singleOrNull()
    }

    private fun queryDocument(uri: Uri): DocumentEntry {
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_FLAGS,
        )
        return resolver.query(uri, projection, null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            DocumentEntry(uri, cursor.getString(0), cursor.getString(1), cursor.getInt(2))
        } ?: error("The provider could not confirm the mobile diagnostic file")
    }

    private fun readBounded(uri: Uri): ByteArray {
        val output = ByteArrayOutputStream()
        resolver.openInputStream(uri)?.buffered().use { input ->
            checkNotNull(input) { "The provider would not open the mobile diagnostic file" }
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                check(output.size() + count <= MobileDiagnosticStore.MAX_SNAPSHOT_BYTES) {
                    "The existing mobile diagnostic file exceeds its size limit"
                }
                output.write(buffer, 0, count)
            }
        }
        return output.toByteArray()
    }

    companion object {
        private const val MIME_TYPE = "application/x-ndjson"

        fun canReplaceExisting(contents: ByteArray, ownsIncompleteCreation: Boolean): Boolean =
            MobileDiagnosticStore.hasFormatHeader(contents) ||
                (ownsIncompleteCreation && MobileDiagnosticStore.isHeaderPrefix(contents))
    }
}
