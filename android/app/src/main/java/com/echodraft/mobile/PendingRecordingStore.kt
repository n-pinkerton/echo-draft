package com.echodraft.mobile

import android.content.Context
import java.io.File
import java.time.Clock
import java.time.Instant
import java.util.UUID

class PendingRecordingStore(
    private val directory: File,
    private val clock: Clock = Clock.systemUTC(),
) {
    data class Session(
        val externalId: UUID,
        val createdAt: Instant,
        val temporaryFile: File,
        val processingMode: MobileInboxProtocol.ProcessingMode? = null,
    )

    data class ReadyRecording(
        val externalId: UUID,
        val createdAt: Instant,
        val file: File,
        val processingMode: MobileInboxProtocol.ProcessingMode? = null,
    )

    fun createSession(
        externalId: UUID = UUID.randomUUID(),
        processingMode: MobileInboxProtocol.ProcessingMode? = null,
    ): Session {
        ensureDirectory()
        val modeSegment = processingMode?.let { ".${it.wireValue}" } ?: ""
        val temporaryFile = File(
            directory,
            "${externalId.toString().lowercase()}$modeSegment.recording.m4a",
        )
        check(temporaryFile.createNewFile()) { "Could not reserve a private recording file" }
        return Session(externalId, clock.instant(), temporaryFile, processingMode)
    }

    fun finalize(session: Session): ReadyRecording {
        check(session.temporaryFile.isFile && session.temporaryFile.length() > 0) {
            "The recording did not produce audio"
        }
        val modeSegment = session.processingMode?.let { ".${it.wireValue}" } ?: ""
        val finalFile = File(
            directory,
            "${session.externalId.toString().lowercase()}$modeSegment.m4a",
        )
        check(!finalFile.exists()) { "A pending recording already uses this ID" }
        check(session.temporaryFile.renameTo(finalFile)) { "Could not finalize the private recording" }
        finalFile.setLastModified(session.createdAt.toEpochMilli())
        return ReadyRecording(
            session.externalId,
            session.createdAt,
            finalFile,
            session.processingMode,
        )
    }

    fun retainForRecovery(session: Session): File {
        check(session.temporaryFile.isFile && session.temporaryFile.length() > 0) {
            "The recording did not produce recoverable audio"
        }
        val recoveryFile = File(
            directory,
            "${session.externalId.toString().lowercase()}" +
                (session.processingMode?.let { ".${it.wireValue}" } ?: "") +
                ".recovery.m4a",
        )
        check(!recoveryFile.exists()) { "A recovery recording already uses this ID" }
        check(session.temporaryFile.renameTo(recoveryFile)) {
            "Could not retain the private recovery recording"
        }
        recoveryFile.setLastModified(session.createdAt.toEpochMilli())
        return recoveryFile
    }

    fun listReady(): List<ReadyRecording> {
        ensureDirectory()
        return directory.listFiles()
            .orEmpty()
            .asSequence()
            .filter { it.isFile }
            .mapNotNull { file ->
                val parsed = parseReadyFileName(file.name) ?: return@mapNotNull null
                val timestamp = file.lastModified().takeIf { it > 0 } ?: return@mapNotNull null
                ReadyRecording(
                    parsed.first,
                    Instant.ofEpochMilli(timestamp),
                    file,
                    parsed.second,
                )
            }
            .sortedBy { it.createdAt }
            .toList()
    }

    fun discard(session: Session) {
        session.temporaryFile.delete()
    }

    fun removeStaleTemporaryFiles(): Int {
        ensureDirectory()
        return directory.listFiles()
            .orEmpty()
            .count { file ->
                file.isFile && file.name.endsWith(".recording.m4a") && file.delete()
            }
    }

    fun pendingCount(): Int = listReady().size

    private fun ensureDirectory() {
        check(directory.isDirectory || directory.mkdirs()) {
            "Could not create private pending-recording storage"
        }
    }

    private fun parseReadyFileName(
        fileName: String,
    ): Pair<UUID, MobileInboxProtocol.ProcessingMode?>? {
        val promptSuffix = ".${MobileInboxProtocol.ProcessingMode.CODEX_PROMPT.wireValue}.m4a"
        if (fileName.endsWith(promptSuffix)) {
            val externalId = runCatching {
                UUID.fromString(fileName.removeSuffix(promptSuffix))
            }.getOrNull() ?: return null
            return externalId to MobileInboxProtocol.ProcessingMode.CODEX_PROMPT
        }
        val externalId = MobileInboxProtocol.parseAudioFileName(fileName) ?: return null
        return externalId to null
    }

    companion object {
        fun from(context: Context): PendingRecordingStore =
            PendingRecordingStore(File(context.noBackupFilesDir, "pending-mobile-memos"))
    }
}
