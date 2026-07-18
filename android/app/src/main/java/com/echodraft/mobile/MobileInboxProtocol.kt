package com.echodraft.mobile

import java.io.File
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

object MobileInboxProtocol {
    const val VERSION = 1
    const val AUDIO_MIME_TYPE = "audio/mp4"
    const val MANIFEST_MIME_TYPE = "application/json"
    const val MAX_AUDIO_BYTES = 32 * 1024 * 1024
    const val MAX_MANIFEST_BYTES = 64 * 1024

    private val uuidPattern = Regex(
        "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    )

    data class Manifest(
        val externalId: UUID,
        val audioSha256: String,
        val sizeBytes: Long,
        val createdAt: Instant,
    ) {
        init {
            require(sizeBytes in 1..MAX_AUDIO_BYTES.toLong())
            require(audioSha256.matches(Regex("^[0-9a-f]{64}$")))
        }

        val audioFile: String = audioFileName(externalId)
        val manifestFile: String = manifestFileName(externalId)

        fun toJson(): String =
            "{" +
                "\"version\":$VERSION," +
                "\"externalId\":\"${externalId.toString().lowercase()}\"," +
                "\"audioFile\":\"$audioFile\"," +
                "\"audioSha256\":\"$audioSha256\"," +
                "\"sizeBytes\":$sizeBytes," +
                "\"createdAt\":\"$createdAt\"," +
                "\"mimeType\":\"$AUDIO_MIME_TYPE\"" +
                "}"
    }

    fun audioFileName(externalId: UUID): String =
        "${externalId.toString().lowercase()}.m4a"

    fun manifestFileName(externalId: UUID): String =
        "${externalId.toString().lowercase()}.ready.json"

    fun parseAudioFileName(fileName: String): UUID? {
        if (!fileName.endsWith(".m4a")) return null
        val value = fileName.removeSuffix(".m4a").lowercase()
        if (!uuidPattern.matches(value)) return null
        return runCatching { UUID.fromString(value) }.getOrNull()
    }

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }
    }
}
