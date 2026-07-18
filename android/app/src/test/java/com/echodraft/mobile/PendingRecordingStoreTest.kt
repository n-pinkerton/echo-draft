package com.echodraft.mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

class PendingRecordingStoreTest {
    @Test
    fun `only finalized recordings enter the retry queue`() {
        val root = Files.createTempDirectory("echodraft-pending").toFile()
        val createdAt = Instant.parse("2026-07-18T01:02:03Z")
        val store = PendingRecordingStore(root, Clock.fixed(createdAt, ZoneOffset.UTC))
        val id = UUID.fromString("550e8400-e29b-41d4-a716-446655440000")
        val session = store.createSession(id)

        assertTrue(store.listReady().isEmpty())
        session.temporaryFile.writeBytes(byteArrayOf(1, 2, 3))
        val ready = store.finalize(session)

        assertFalse(session.temporaryFile.exists())
        assertEquals("$id.m4a", ready.file.name)
        assertEquals(listOf(ready), store.listReady())
    }

    @Test
    fun `stale in-progress files are removed without deleting finalized memos`() {
        val root = Files.createTempDirectory("echodraft-stale").toFile()
        val store = PendingRecordingStore(root)
        val session = store.createSession()
        session.temporaryFile.writeBytes(byteArrayOf(1))
        val ready = root.resolve("550e8400-e29b-41d4-a716-446655440000.m4a")
        ready.writeBytes(byteArrayOf(2))

        assertEquals(1, store.removeStaleTemporaryFiles())
        assertFalse(session.temporaryFile.exists())
        assertTrue(ready.exists())
    }

    @Test
    fun `failed limit recording is retained outside the upload queue`() {
        val root = Files.createTempDirectory("echodraft-recovery").toFile()
        val createdAt = Instant.parse("2026-07-18T01:02:03Z")
        val store = PendingRecordingStore(root, Clock.fixed(createdAt, ZoneOffset.UTC))
        val id = UUID.fromString("550e8400-e29b-41d4-a716-446655440000")
        val session = store.createSession(id)
        session.temporaryFile.writeBytes(byteArrayOf(4, 5, 6))

        val recovery = store.retainForRecovery(session)

        assertFalse(session.temporaryFile.exists())
        assertEquals("$id.recovery.m4a", recovery.name)
        assertTrue(recovery.exists())
        assertTrue(store.listReady().isEmpty())
    }
}
