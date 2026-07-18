package com.echodraft.mobile

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class GraphDiagnosticSinkTest {
    private val snapshot = safeSnapshot()

    @Test
    fun `replaces only verified EchoDraft diagnostic content`() {
        val api = FakeOneDriveDriveApi()
        api.contents[MobileDiagnosticStore.SHARED_FILE_NAME] = safeSnapshot(pendingCount = 2)

        sink(api).publish(snapshot)

        assertArrayEquals(snapshot, api.contents[MobileDiagnosticStore.SHARED_FILE_NAME])
    }

    @Test
    fun `foreign same-name support file is never overwritten`() {
        val api = FakeOneDriveDriveApi()
        val foreign = "unrelated file".toByteArray()
        api.contents[MobileDiagnosticStore.SHARED_FILE_NAME] = foreign

        assertThrows(IllegalStateException::class.java) {
            sink(api).publish(snapshot)
        }

        assertArrayEquals(foreign, api.contents[MobileDiagnosticStore.SHARED_FILE_NAME])
        assertFalse(api.events.any { it.startsWith("upload-") })
    }

    @Test
    fun `failed support-file verification is reported to the isolated caller`() {
        val api = FakeOneDriveDriveApi().apply { corruptByteUploads = true }

        assertThrows(IllegalStateException::class.java) {
            sink(api).publish(snapshot)
        }
    }

    @Test
    fun `diagnostic changed after ownership check is not replaced`() {
        val api = FakeOneDriveDriveApi()
        val foreign = "unrelated file".toByteArray()
        api.contents[MobileDiagnosticStore.SHARED_FILE_NAME] = safeSnapshot(pendingCount = 2)
        api.afterDownload = {
            api.afterDownload = null
            api.contents[MobileDiagnosticStore.SHARED_FILE_NAME] = foreign
        }

        assertThrows(IllegalStateException::class.java) { sink(api).publish(snapshot) }

        assertArrayEquals(foreign, api.contents[MobileDiagnosticStore.SHARED_FILE_NAME])
        assertFalse(api.events.any { it.startsWith("replace-") })
    }

    @Test
    fun `unknown or potentially sensitive diagnostic fields are rejected before authentication`() {
        val api = FakeOneDriveDriveApi()
        var tokenRequests = 0
        val unsafe = snapshot.toString(Charsets.UTF_8)
            .replace("\"event\":", "\"message\":\"secret\",\"event\":")
            .toByteArray()
        val sink = GraphDiagnosticSink(
            OneDriveAccessTokenProvider {
                tokenRequests += 1
                "test-token"
            },
            api,
        )

        assertThrows(IllegalArgumentException::class.java) { sink.publish(unsafe) }
        org.junit.Assert.assertEquals(0, tokenRequests)
        assertFalse(api.events.any())
    }

    @Test
    fun `trailing credentials and lenient JSON are rejected before authentication`() {
        val text = snapshot.toString(Charsets.UTF_8)
        val headerEnd = text.indexOf('\n') + 1
        val header = text.substring(0, headerEnd)
        val event = text.substring(headerEnd).removeSuffix("\n")
        val unsafeSnapshots = listOf(
            "$header${event}AUTH_TOKEN_DO_NOT_SYNC\n".toByteArray(),
            "$header${event.replaceFirst("\"version\"", "'version'")}\n".toByteArray(),
        )

        unsafeSnapshots.forEach { unsafe ->
            val api = FakeOneDriveDriveApi()
            var tokenRequests = 0
            val sink = GraphDiagnosticSink(
                OneDriveAccessTokenProvider {
                    tokenRequests += 1
                    "test-token"
                },
                api,
            )

            assertThrows(IllegalArgumentException::class.java) { sink.publish(unsafe) }
            org.junit.Assert.assertEquals(0, tokenRequests)
            assertFalse(api.events.any())
        }
    }

    private fun sink(api: OneDriveDriveApi): GraphDiagnosticSink =
        GraphDiagnosticSink(OneDriveAccessTokenProvider { "test-token" }, api)

    private fun safeSnapshot(pendingCount: Int = 1): ByteArray {
        val store = MobileDiagnosticStore(
            directory = Files.createTempDirectory("echodraft-diagnostic-sink").toFile(),
            metadata = MobileDiagnosticMetadata("0.2.0", 2, 35),
            clock = Clock.fixed(Instant.parse("2026-07-18T01:02:03Z"), ZoneOffset.UTC),
        )
        store.record(MobileDiagnosticEvents.OPERATION_INTERRUPTED, null, pendingCount)
        return checkNotNull(store.snapshot())
    }
}
