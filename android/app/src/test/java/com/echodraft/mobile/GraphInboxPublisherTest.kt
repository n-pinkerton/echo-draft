package com.echodraft.mobile

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.util.UUID

class GraphInboxPublisherTest {
    private val externalId = UUID.fromString("550e8400-e29b-41d4-a716-446655440000")
    private val audioName = MobileInboxProtocol.audioFileName(externalId)
    private val manifestName = MobileInboxProtocol.manifestFileName(externalId)

    @Test
    fun `publishes and verifies audio before exposing ready manifest`() {
        val api = FakeOneDriveDriveApi()
        val recording = recording("mobile audio")

        publisher(api).publish(recording)

        val audioUpload = api.events.indexOf("upload-file:$audioName")
        val manifestUpload = api.events.indexOf("upload-bytes:$manifestName")
        assertTrue(audioUpload >= 0)
        assertTrue(manifestUpload > audioUpload)
        assertArrayEquals(recording.file.readBytes(), api.contents[audioName])
        assertTrue(api.contents.getValue(manifestName).toString(Charsets.UTF_8).contains(audioName))
        assertTrue(recording.file.isFile)
    }

    @Test
    fun `retry accepts identical audio and publishes only missing manifest`() {
        val api = FakeOneDriveDriveApi()
        val recording = recording("already uploaded")
        api.contents[audioName] = recording.file.readBytes()

        publisher(api).publish(recording)

        assertFalse(api.events.contains("upload-file:$audioName"))
        assertTrue(api.events.contains("upload-bytes:$manifestName"))
        assertTrue(api.contents.containsKey(manifestName))
    }

    @Test
    fun `same-name foreign audio fails closed before manifest publication`() {
        val api = FakeOneDriveDriveApi()
        val recording = recording("local content")
        api.contents[audioName] = "other content".toByteArray()

        assertThrows(IllegalStateException::class.java) {
            publisher(api).publish(recording)
        }

        assertFalse(api.contents.containsKey(manifestName))
        assertTrue(recording.file.isFile)
    }

    @Test
    fun `file created during upload race is never overwritten`() {
        val api = FakeOneDriveDriveApi()
        val recording = recording("local content")
        val foreign = "other content".toByteArray()
        api.raceBeforeNextCreate = audioName to foreign

        assertThrows(IllegalStateException::class.java) {
            publisher(api).publish(recording)
        }

        assertArrayEquals(foreign, api.contents[audioName])
        assertFalse(api.contents.containsKey(manifestName))
    }

    @Test
    fun `failed remote verification leaves manifest absent and local memo intact`() {
        val api = FakeOneDriveDriveApi().apply { corruptFileUploads = true }
        val recording = recording("verify this")

        assertThrows(IllegalStateException::class.java) {
            publisher(api).publish(recording)
        }

        assertFalse(api.contents.containsKey(audioName))
        assertFalse(api.contents.containsKey(manifestName))
        assertTrue(recording.file.isFile)

        api.corruptFileUploads = false
        publisher(api).publish(recording)
        assertTrue(api.contents.containsKey(manifestName))
    }

    @Test
    fun `untrusted upload response cannot delete the requested or another item`() {
        val api = FakeOneDriveDriveApi()
        val recording = recording("verify response identity")
        val unrelatedName = "unrelated.m4a"
        val unrelated = "keep this".toByteArray()
        api.contents[unrelatedName] = unrelated
        api.fileUploadResponseOverride = OneDriveItem(
            id = "item-id:$unrelatedName",
            name = unrelatedName,
            size = unrelated.size.toLong(),
            eTag = "\"untrusted\"",
        )

        assertThrows(IllegalStateException::class.java) {
            publisher(api).publish(recording)
        }

        assertArrayEquals(recording.file.readBytes(), api.contents[audioName])
        assertArrayEquals(unrelated, api.contents[unrelatedName])
        assertFalse(api.events.any { it.startsWith("delete:") })
        assertFalse(api.contents.containsKey(manifestName))
    }

    @Test
    fun `audio changed after manifest commit removes ready marker and fails`() {
        val api = FakeOneDriveDriveApi()
        val recording = recording("stable audio")
        api.afterByteUpload = {
            api.contents[audioName] = api.contents.getValue(audioName).copyOf().also {
                it[0] = (it[0].toInt() xor 0xff).toByte()
            }
        }

        assertThrows(IllegalStateException::class.java) {
            publisher(api).publish(recording)
        }

        assertFalse(api.contents.containsKey(manifestName))
        assertTrue(recording.file.isFile)
    }

    @Test
    fun `manifest collision race preserves foreign content`() {
        val api = FakeOneDriveDriveApi()
        val recording = recording("existing audio")
        api.contents[audioName] = recording.file.readBytes()
        val foreign = ByteArray(expectedManifest(recording).size) { 0x5a.toByte() }
        api.raceBeforeNextCreate = manifestName to foreign

        assertThrows(IllegalStateException::class.java) {
            publisher(api).publish(recording)
        }

        assertArrayEquals(foreign, api.contents[manifestName])
        assertTrue(recording.file.isFile)
    }

    private fun publisher(api: OneDriveDriveApi): GraphInboxPublisher =
        GraphInboxPublisher(OneDriveAccessTokenProvider { "test-token" }, api)

    private fun recording(contents: String): PendingRecordingStore.ReadyRecording {
        val directory = Files.createTempDirectory("echodraft-graph-publisher").toFile()
        val file = File(directory, audioName).apply { writeText(contents) }
        return PendingRecordingStore.ReadyRecording(
            externalId = externalId,
            createdAt = Instant.parse("2026-07-18T01:02:03Z"),
            file = file,
        )
    }

    private fun expectedManifest(recording: PendingRecordingStore.ReadyRecording): ByteArray =
        MobileInboxProtocol.Manifest(
            externalId = recording.externalId,
            audioSha256 = MobileInboxProtocol.sha256(recording.file),
            sizeBytes = recording.file.length(),
            createdAt = recording.createdAt,
        ).toJson().toByteArray()
}
