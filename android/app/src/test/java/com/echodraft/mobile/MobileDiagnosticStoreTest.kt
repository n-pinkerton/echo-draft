package com.echodraft.mobile

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MobileDiagnosticStoreTest {
    private val createdAt = Instant.parse("2026-07-18T03:04:05Z")
    private val metadata = MobileDiagnosticMetadata(
        appVersion = "0.1.0",
        appVersionCode = 1,
        androidApi = 35,
    )

    @Test
    fun `diagnostic snapshot contains support metadata without raw failure data`() {
        val root = Files.createTempDirectory("echodraft-mobile-diagnostics").toFile()
        val store = MobileDiagnosticStore(root, metadata, Clock.fixed(createdAt, ZoneOffset.UTC))
        val error = IllegalStateException(
            "secret transcript at content://provider/private-folder and device serial",
        ).apply {
            stackTrace = arrayOf(
                StackTraceElement(
                    "com.echodraft.mobile.RecorderService",
                    "publishPending",
                    "RecorderService.kt",
                    320,
                ),
                StackTraceElement(
                    "com.echodraft.mobile.PrivateFailure",
                    "capture",
                    "content://provider/private-folder",
                    4,
                ),
                StackTraceElement("vendor.provider.Sync", "write", "Sync.kt", 9),
            )
        }

        store.record("memo_publish_failed", error, pendingMemoCount = 2)
        val snapshot = store.snapshot()

        assertNotNull(snapshot)
        val text = snapshot!!.toString(Charsets.UTF_8)
        assertTrue(text.startsWith("${MobileDiagnosticStore.HEADER_LINE}\n"))
        assertTrue(text.contains("\"event\":\"memo_publish_failed\""))
        assertTrue(text.contains("\"exceptionType\":\"java.lang.IllegalStateException\""))
        assertTrue(text.contains("RecorderService#publishPending(RecorderService.kt:320)"))
        assertTrue(text.contains("\"pendingMemoCount\":2"))
        assertFalse(text.contains("secret transcript"))
        assertFalse(text.contains("content://"))
        assertFalse(text.contains("device serial"))
        assertFalse(text.contains("vendor.provider"))
    }

    @Test
    fun `rolling diagnostics retain only the newest bounded events`() {
        val root = Files.createTempDirectory("echodraft-mobile-diagnostics-limit").toFile()
        val store = MobileDiagnosticStore(root, metadata, Clock.fixed(createdAt, ZoneOffset.UTC))

        repeat(MobileDiagnosticStore.MAX_EVENTS + 3) { index ->
            store.record(
                MobileDiagnosticEvents.MEMO_PUBLISH_FAILED,
                error = null,
                pendingMemoCount = index,
            )
        }

        val snapshot = store.snapshot()!!
        val lines = snapshot.toString(Charsets.UTF_8).trimEnd().lines()
        assertTrue(MobileDiagnosticStore.hasFormatHeader(snapshot))
        assertTrue(snapshot.size <= MobileDiagnosticStore.MAX_SNAPSHOT_BYTES)
        assertTrue(lines.size == MobileDiagnosticStore.MAX_EVENTS + 1)
        assertFalse(lines.any { it.contains("\"pendingMemoCount\":0}") })
        assertTrue(lines.any { it.contains("\"pendingMemoCount\":22}") })
    }

    @Test
    fun `separate store instances serialize concurrent writes`() {
        val root = Files.createTempDirectory("echodraft-mobile-diagnostics-concurrent").toFile()
        val first = MobileDiagnosticStore(root, metadata, Clock.fixed(createdAt, ZoneOffset.UTC))
        val second = MobileDiagnosticStore(root, metadata, Clock.fixed(createdAt, ZoneOffset.UTC))
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(4)
        try {
            val writes = (0 until MobileDiagnosticStore.MAX_EVENTS).map { index ->
                executor.submit {
                    start.await()
                    val store = if (index % 2 == 0) first else second
                    store.record(
                        MobileDiagnosticEvents.RECORDING_START_FAILED,
                        error = null,
                        pendingMemoCount = index,
                    )
                }
            }
            start.countDown()
            writes.forEach { it.get(10, TimeUnit.SECONDS) }
        } finally {
            executor.shutdownNow()
        }

        val lines = first.snapshot()!!.toString(Charsets.UTF_8).trimEnd().lines()
        assertTrue(lines.size == MobileDiagnosticStore.MAX_EVENTS + 1)
        repeat(MobileDiagnosticStore.MAX_EVENTS) { index ->
            assertTrue(lines.any { it.contains("\"pendingMemoCount\":$index}") })
        }
    }

    @Test
    fun `noncanonical private records are dropped before shared serialization`() {
        val root = Files.createTempDirectory("echodraft-mobile-diagnostics-corrupt").toFile()
        val store = MobileDiagnosticStore(root, metadata, Clock.fixed(createdAt, ZoneOffset.UTC))
        store.record(
            MobileDiagnosticEvents.RECORDING_START_FAILED,
            error = null,
            pendingMemoCount = 1,
        )
        val localFile = root.listFiles().orEmpty().single { it.extension == "jsonl" }
        localFile.writeText(
            MobileDiagnosticStore.HEADER_LINE + "\n" +
                "{\"version\":1,\"createdAt\":\"$createdAt\"," +
                "\"event\":\"recording_start_failed\",\"appVersion\":\"0.1.0\"," +
                "\"appVersionCode\":1,\"androidApi\":35,\"pendingMemoCount\":1," +
                "\"transcript\":\"private content://provider/path\"}\n",
        )

        store.record(
            MobileDiagnosticEvents.RECORDING_FINALIZE_FAILED,
            error = null,
            pendingMemoCount = 2,
        )

        val snapshot = store.snapshot()!!.toString(Charsets.UTF_8)
        assertFalse(snapshot.contains("private"))
        assertFalse(snapshot.contains("content://"))
        assertFalse(snapshot.contains("recording_start_failed"))
        assertTrue(snapshot.contains("recording_finalize_failed"))
    }

    @Test
    fun `valid temporary snapshot recovers when the destination is unavailable`() {
        val root = Files.createTempDirectory("echodraft-mobile-diagnostics-recovery").toFile()
        val store = MobileDiagnosticStore(root, metadata, Clock.fixed(createdAt, ZoneOffset.UTC))
        store.record(
            MobileDiagnosticEvents.OPERATION_INTERRUPTED,
            error = null,
            pendingMemoCount = 3,
        )
        val destination = root.listFiles().orEmpty().single { it.extension == "jsonl" }
        val temporary = root.resolve("mobile-diagnostics.tmp")
        assertTrue(destination.renameTo(temporary))

        val snapshot = store.snapshot()!!.toString(Charsets.UTF_8)

        assertTrue(snapshot.contains("operation_interrupted"))
        assertTrue(destination.isFile)
        assertFalse(temporary.exists())
    }

    @Test
    fun `maximum safe stack metadata stays within the snapshot byte cap`() {
        val root = Files.createTempDirectory("echodraft-mobile-diagnostics-bytes").toFile()
        val store = MobileDiagnosticStore(root, metadata, Clock.fixed(createdAt, ZoneOffset.UTC))
        val error = IllegalStateException("not serialized").apply {
            stackTrace = Array(8) { index ->
                StackTraceElement(
                    "com.echodraft.mobile.${"C".repeat(100)}$index",
                    "m${"x".repeat(100)}",
                    "${"F".repeat(90)}.kt",
                    Int.MAX_VALUE,
                )
            }
        }

        repeat(MobileDiagnosticStore.MAX_EVENTS) { index ->
            store.record(
                MobileDiagnosticEvents.MEMO_PUBLISH_FAILED,
                error,
                pendingMemoCount = index,
            )
        }

        assertTrue(store.snapshot()!!.size <= MobileDiagnosticStore.MAX_SNAPSHOT_BYTES)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `diagnostic event codes must be registered`() {
        val root = Files.createTempDirectory("echodraft-mobile-diagnostics-code").toFile()
        val store = MobileDiagnosticStore(root, metadata, Clock.fixed(createdAt, ZoneOffset.UTC))

        store.record("failure with private text", error = null, pendingMemoCount = 0)
    }
}
