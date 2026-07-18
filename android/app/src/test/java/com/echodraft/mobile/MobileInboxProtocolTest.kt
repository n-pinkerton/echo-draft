package com.echodraft.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.util.UUID

class MobileInboxProtocolTest {
    private val id = UUID.fromString("550e8400-e29b-41d4-a716-446655440000")

    @Test
    fun `manifest matches desktop protocol v1`() {
        val manifest = MobileInboxProtocol.Manifest(
            externalId = id,
            audioSha256 = "ab".repeat(32),
            sizeBytes = 123,
            createdAt = Instant.parse("2026-07-18T01:02:03Z"),
        )

        assertEquals("550e8400-e29b-41d4-a716-446655440000.m4a", manifest.audioFile)
        assertEquals("550e8400-e29b-41d4-a716-446655440000.ready.json", manifest.manifestFile)
        assertEquals(
            "{\"version\":1,\"externalId\":\"550e8400-e29b-41d4-a716-446655440000\"," +
                "\"audioFile\":\"550e8400-e29b-41d4-a716-446655440000.m4a\"," +
                "\"audioSha256\":\"${"ab".repeat(32)}\",\"sizeBytes\":123," +
                "\"createdAt\":\"2026-07-18T01:02:03Z\",\"mimeType\":\"audio/mp4\"}",
            manifest.toJson(),
        )
    }

    @Test
    fun `hash and filename parsing are deterministic`() {
        val file = File(Files.createTempDirectory("echodraft-protocol").toFile(), "memo.m4a")
        file.writeText("mobile audio")

        assertEquals(
            "bc8482325d0f8ce6b449ab393fe177c87668f870343c86b672006272fd6d6d7e",
            MobileInboxProtocol.sha256(file),
        )
        assertEquals(id, MobileInboxProtocol.parseAudioFileName("$id.m4a"))
        assertNull(MobileInboxProtocol.parseAudioFileName("$id.ready.json"))
    }
}
