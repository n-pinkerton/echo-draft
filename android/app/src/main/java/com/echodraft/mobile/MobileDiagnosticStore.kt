package com.echodraft.mobile

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.time.Clock
import java.time.Instant

internal data class MobileDiagnosticMetadata(
    val appVersion: String,
    val appVersionCode: Int,
    val androidApi: Int,
)

internal class MobileDiagnosticStore(
    private val directory: File,
    private val metadata: MobileDiagnosticMetadata,
    private val clock: Clock = Clock.systemUTC(),
) {
    private data class DiagnosticEvent(
        val createdAt: String,
        val event: String,
        val appVersion: String,
        val appVersionCode: Int,
        val androidApi: Int,
        val pendingMemoCount: Int,
        val exceptionType: String?,
        val appStack: List<String>,
    )

    fun record(event: String, error: Throwable?, pendingMemoCount: Int) {
        synchronized(FILE_LOCK) {
            require(MobileDiagnosticEvents.isKnown(event)) { "Unknown mobile diagnostic event code" }
            val nextEvent = DiagnosticEvent(
                createdAt = clock.instant().toString(),
                event = event,
                appVersion = metadata.appVersion.takeIf(APP_VERSION_PATTERN::matches) ?: "unknown",
                appVersionCode = metadata.appVersionCode.coerceAtLeast(0),
                androidApi = metadata.androidApi.coerceAtLeast(0),
                pendingMemoCount = pendingMemoCount.coerceAtLeast(0),
                exceptionType = error?.javaClass?.name
                    ?.takeIf(EXCEPTION_TYPE_PATTERN::matches),
                appStack = error?.stackTrace
                    .orEmpty()
                    .asSequence()
                    .filter { it.className.startsWith(APP_PACKAGE_PREFIX) }
                    .mapNotNull(::safeStackFrame)
                    .take(MAX_APP_STACK_FRAMES)
                    .toList(),
            )
            check(encodeEvent(nextEvent).toByteArray(Charsets.UTF_8).size <= MAX_EVENT_BYTES) {
                "Mobile diagnostic event exceeded its size limit"
            }

            val events = readEvents().toMutableList().apply { add(nextEvent) }
            while (events.size > MAX_EVENTS) events.removeAt(0)

            var bytes = encodeSnapshot(events)
            while (bytes.size > MAX_SNAPSHOT_BYTES && events.size > 1) {
                events.removeAt(0)
                bytes = encodeSnapshot(events)
            }
            check(bytes.size <= MAX_SNAPSHOT_BYTES) { "Mobile diagnostics exceeded their size limit" }
            writeAtomically(bytes)
        }
    }

    fun snapshot(): ByteArray? = synchronized(FILE_LOCK) {
        val events = readEvents()
        if (events.isEmpty()) null else encodeSnapshot(events)
    }

    private fun safeStackFrame(frame: StackTraceElement): String? {
        val className = frame.className.removePrefix(APP_PACKAGE_PREFIX)
        val methodName = frame.methodName
        val fileName = frame.fileName ?: "Unknown"
        if (
            !STACK_TOKEN_PATTERN.matches(className) ||
            !STACK_TOKEN_PATTERN.matches(methodName) ||
            !STACK_FILE_PATTERN.matches(fileName)
        ) {
            return null
        }
        return buildString {
            append(className)
            append('#')
            append(methodName)
            append('(')
            append(fileName)
            if (frame.lineNumber >= 0) append(':').append(frame.lineNumber)
            append(')')
        }
    }

    private fun encodeEvent(event: DiagnosticEvent): String = buildString {
            append("{\"version\":1")
            append(",\"createdAt\":").append(jsonString(event.createdAt))
            append(",\"event\":").append(jsonString(event.event))
            append(",\"appVersion\":").append(jsonString(event.appVersion))
            append(",\"appVersionCode\":").append(event.appVersionCode)
            append(",\"androidApi\":").append(event.androidApi)
            append(",\"pendingMemoCount\":").append(event.pendingMemoCount)
            if (event.exceptionType != null) {
                append(",\"exceptionType\":")
                    .append(jsonString(event.exceptionType))
            }
            if (event.appStack.isNotEmpty()) {
                append(",\"appStack\":[")
                event.appStack.forEachIndexed { index, frame ->
                    if (index > 0) append(',')
                    append(jsonString(frame))
                }
                append(']')
            }
            append('}')
        }

    private fun readEvents(): List<DiagnosticEvent> {
        val destination = File(directory, FILE_NAME)
        val temporary = File(directory, TEMPORARY_FILE_NAME)
        val destinationEvents = readEventsFrom(destination)
        if (destinationEvents != null) {
            if (temporary.exists()) temporary.delete()
            return destinationEvents
        }
        val temporaryEvents = readEventsFrom(temporary)
        if (temporaryEvents != null) {
            moveReplacing(temporary, destination)
            return temporaryEvents
        }
        if (temporary.exists()) temporary.delete()
        return emptyList()
    }

    private fun readEventsFrom(file: File): List<DiagnosticEvent>? {
        if (!file.isFile || file.length() !in 1..MAX_SNAPSHOT_BYTES.toLong()) return null
        val lines = runCatching { file.readLines(Charsets.UTF_8) }.getOrElse { return null }
        if (lines.firstOrNull() != HEADER_LINE) return null
        return lines.drop(1)
            .asSequence()
            .filter { it.toByteArray(Charsets.UTF_8).size <= MAX_EVENT_BYTES }
            .mapNotNull(::decodeEvent)
            .toList()
            .takeLast(MAX_EVENTS)
    }

    private fun decodeEvent(line: String): DiagnosticEvent? = runCatching {
        val json = JSONObject(line)
        val keys = buildSet {
            val iterator = json.keys()
            while (iterator.hasNext()) add(iterator.next())
        }
        check(keys.containsAll(REQUIRED_EVENT_KEYS) && ALLOWED_EVENT_KEYS.containsAll(keys))
        check(json.requireInt("version") == 1)
        val createdAt = json.getString("createdAt")
        check(Instant.parse(createdAt).toString() == createdAt)
        val event = json.getString("event")
        check(MobileDiagnosticEvents.isKnown(event))
        val appVersion = json.getString("appVersion")
        check(APP_VERSION_PATTERN.matches(appVersion))
        val exceptionType = if (json.has("exceptionType")) {
            json.getString("exceptionType").also { check(EXCEPTION_TYPE_PATTERN.matches(it)) }
        } else {
            null
        }
        val appStack = if (json.has("appStack")) {
            val array = json.getJSONArray("appStack")
            check(array.length() in 1..MAX_APP_STACK_FRAMES)
            List(array.length()) { index ->
                array.getString(index).also { check(STACK_FRAME_PATTERN.matches(it)) }
            }
        } else {
            emptyList()
        }
        DiagnosticEvent(
            createdAt = createdAt,
            event = event,
            appVersion = appVersion,
            appVersionCode = json.requireInt("appVersionCode", minimum = 0),
            androidApi = json.requireInt("androidApi", minimum = 0),
            pendingMemoCount = json.requireInt("pendingMemoCount", minimum = 0),
            exceptionType = exceptionType,
            appStack = appStack,
        )
    }.getOrNull()

    private fun JSONObject.requireInt(key: String, minimum: Int = Int.MIN_VALUE): Int {
        val value = get(key)
        check(value is Int || value is Long)
        val number = (value as Number).toLong()
        check(number in minimum.toLong()..Int.MAX_VALUE.toLong())
        return number.toInt()
    }

    private fun encodeSnapshot(events: List<DiagnosticEvent>): ByteArray =
        (buildList {
            add(HEADER_LINE)
            addAll(events.map(::encodeEvent))
        }.joinToString(separator = "\n", postfix = "\n"))
            .toByteArray(Charsets.UTF_8)

    private fun writeAtomically(bytes: ByteArray) {
        check(directory.isDirectory || directory.mkdirs()) {
            "Could not create private mobile diagnostic storage"
        }
        val destination = File(directory, FILE_NAME)
        val temporary = File(directory, TEMPORARY_FILE_NAME)
        if (temporary.exists()) check(temporary.delete()) {
            "Could not replace a stale mobile diagnostic temporary file"
        }
        FileOutputStream(temporary).use { output ->
            output.write(bytes)
            output.flush()
            output.fd.sync()
        }
        moveReplacing(temporary, destination)
    }

    private fun moveReplacing(source: File, destination: File) {
        try {
            Files.move(
                source.toPath(),
                destination.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING,
            )
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(
                source.toPath(),
                destination.toPath(),
                StandardCopyOption.REPLACE_EXISTING,
            )
        }
    }

    companion object {
        const val SHARED_FILE_NAME = "echodraft-mobile-diagnostics.jsonl"
        const val HEADER_LINE = "{\"format\":\"echodraft-mobile-diagnostics\",\"version\":1}"
        const val MAX_EVENTS = 20
        const val MAX_SNAPSHOT_BYTES = 64 * 1024

        private const val FILE_NAME = "mobile-diagnostics.jsonl"
        private const val TEMPORARY_FILE_NAME = "mobile-diagnostics.tmp"
        private const val MAX_EVENT_BYTES = 4 * 1024
        private const val MAX_APP_STACK_FRAMES = 8
        private const val APP_PACKAGE_PREFIX = "com.echodraft.mobile."
        private val APP_VERSION_PATTERN = Regex("^[A-Za-z0-9._+\\-]{1,64}$")
        private val EXCEPTION_TYPE_PATTERN = Regex("^[A-Za-z0-9_.$]{1,160}$")
        private val STACK_TOKEN_PATTERN = Regex("^[A-Za-z0-9_.$<>\\-]{1,120}$")
        private val STACK_FILE_PATTERN = Regex("^[A-Za-z0-9_.\\-]{1,100}$")
        private val STACK_FRAME_PATTERN = Regex(
            "^[A-Za-z0-9_.$<>\\-]{1,120}#[A-Za-z0-9_.$<>\\-]{1,120}" +
                "\\([A-Za-z0-9_.\\-]{1,100}(?::[0-9]{1,10})?\\)$",
        )
        private val REQUIRED_EVENT_KEYS = setOf(
            "version",
            "createdAt",
            "event",
            "appVersion",
            "appVersionCode",
            "androidApi",
            "pendingMemoCount",
        )
        private val ALLOWED_EVENT_KEYS = REQUIRED_EVENT_KEYS + setOf("exceptionType", "appStack")
        private val FILE_LOCK = Any()

        fun from(context: Context): MobileDiagnosticStore = MobileDiagnosticStore(
            directory = File(context.noBackupFilesDir, "mobile-diagnostics"),
            metadata = context.packageManager.getPackageInfo(context.packageName, 0).let { packageInfo ->
                MobileDiagnosticMetadata(
                    appVersion = packageInfo.versionName ?: "unknown",
                    appVersionCode = packageInfo.longVersionCode
                        .coerceAtMost(Int.MAX_VALUE.toLong())
                        .toInt(),
                    androidApi = android.os.Build.VERSION.SDK_INT,
                )
            },
        )

        fun hasFormatHeader(bytes: ByteArray): Boolean {
            if (bytes.size !in 1..MAX_SNAPSHOT_BYTES) return false
            if (bytes.size < HEADER_BYTES.size) return false
            return HEADER_BYTES.indices.all { index -> bytes[index] == HEADER_BYTES[index] }
        }

        fun isHeaderPrefix(bytes: ByteArray): Boolean =
            bytes.size <= HEADER_BYTES.size &&
                bytes.indices.all { index -> bytes[index] == HEADER_BYTES[index] }

        private fun jsonString(value: String): String = buildString {
            append('"')
            value.forEach { character ->
                when (character) {
                    '"' -> append("\\\"")
                    '\\' -> append("\\\\")
                    '\b' -> append("\\b")
                    '\u000c' -> append("\\f")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> if (character.code < 0x20) {
                        append("\\u")
                        append(character.code.toString(16).padStart(4, '0'))
                    } else {
                        append(character)
                    }
                }
            }
            append('"')
        }

        private val HEADER_BYTES = "$HEADER_LINE\n".toByteArray(Charsets.UTF_8)
    }
}
