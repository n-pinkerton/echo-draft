package com.echodraft.mobile

import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.nio.ByteBuffer

internal object M4aValidator {
    fun isCompleteAudio(file: File): Boolean {
        if (
            !file.isFile ||
            file.length() !in 1..MobileInboxProtocol.MAX_AUDIO_BYTES.toLong()
        ) {
            return false
        }

        val extractor = MediaExtractor()
        return try {
            extractor.setDataSource(file.absolutePath)
            val audioTrack = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index)
                    .getString(MediaFormat.KEY_MIME)
                    ?.startsWith("audio/") == true
            } ?: return false
            extractor.selectTrack(audioTrack)

            val buffer = ByteBuffer.allocate(SAMPLE_BUFFER_BYTES)
            var sampleCount = 0
            while (sampleCount < MAX_SAMPLE_COUNT) {
                buffer.clear()
                if (extractor.readSampleData(buffer, 0) < 0) return false
                sampleCount += 1
                if (!extractor.advance()) return true
            }
            false
        } catch (_: Exception) {
            false
        } finally {
            extractor.release()
        }
    }

    private const val SAMPLE_BUFFER_BYTES = 64 * 1024
    private const val MAX_SAMPLE_COUNT = 1_000_000
}
