package com.echodraft.mobile

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.net.URL

internal fun interface GraphHttpConnectionFactory {
    fun open(url: URL): HttpURLConnection
}

class MicrosoftGraphDriveApi internal constructor(
    private val connectionFactory: GraphHttpConnectionFactory,
) : OneDriveDriveApi {
    constructor() : this(GraphHttpConnectionFactory { url ->
        url.openConnection() as HttpURLConnection
    })

    override fun appRoot(accessToken: String): OneDriveItem =
        metadataRequest(
            accessToken,
            "GET",
            "/me/drive/special/approot?\$select=id,name,size,eTag",
        ) ?: error("OneDrive app folder is unavailable")

    override fun child(
        accessToken: String,
        parentId: String,
        fileName: String,
    ): OneDriveItem? = metadataRequest(
        accessToken,
        "GET",
        "/me/drive/items/${pathSegment(parentId)}:/${pathSegment(fileName)}" +
            "?\$select=id,name,size,eTag",
        missingIsNull = true,
    )

    override fun uploadFileIfAbsent(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        file: File,
    ): OneDriveItem {
        check(file.isFile && file.length() in 1..MobileInboxProtocol.MAX_AUDIO_BYTES.toLong())
        return uploadNew(accessToken, parentId, fileName, mimeType, file.length()) { connection ->
            file.inputStream().buffered().use { input ->
                connection.outputStream.buffered().use(input::copyTo)
            }
        }
    }

    override fun uploadBytesIfAbsent(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): OneDriveItem {
        require(bytes.size in 1..MobileInboxProtocol.MAX_MANIFEST_BYTES)
        return uploadNew(accessToken, parentId, fileName, mimeType, bytes.size.toLong()) { connection ->
            connection.outputStream.use { it.write(bytes) }
        }
    }

    override fun replaceBytes(
        accessToken: String,
        item: OneDriveItem,
        mimeType: String,
        bytes: ByteArray,
    ): OneDriveItem {
        require(bytes.size in 1..MobileInboxProtocol.MAX_MANIFEST_BYTES)
        return upload(
            accessToken = accessToken,
            path = "/me/drive/items/${pathSegment(item.id)}/content?\$select=id,name,size,eTag",
            mimeType = mimeType,
            contentLength = bytes.size.toLong(),
            ifMatch = item.eTag,
        ) { connection ->
            connection.outputStream.use { it.write(bytes) }
        }
    }

    override fun delete(accessToken: String, item: OneDriveItem) {
        val connection = graphConnection(
            accessToken,
            "/me/drive/items/${pathSegment(item.id)}",
        ).apply {
            requestMethod = "DELETE"
            setRequestProperty("If-Match", item.eTag)
        }
        try {
            when (val status = connection.responseCode) {
                HttpURLConnection.HTTP_NO_CONTENT,
                HttpURLConnection.HTTP_NOT_FOUND,
                -> discardError(connection)
                HttpURLConnection.HTTP_CONFLICT,
                HttpURLConnection.HTTP_PRECON_FAILED,
                -> {
                    discardError(connection)
                    throw OneDriveConflictException()
                }
                else -> {
                    discardError(connection)
                    throw OneDriveHttpException(status)
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    override fun download(accessToken: String, itemId: String, maximumBytes: Int): ByteArray {
        require(maximumBytes in 1..MobileInboxProtocol.MAX_AUDIO_BYTES)
        val graphConnection = graphConnection(
            accessToken,
            "/me/drive/items/${pathSegment(itemId)}/content",
        ).apply { requestMethod = "GET" }
        return try {
            when (val status = graphConnection.responseCode) {
                HttpURLConnection.HTTP_OK -> readBounded(graphConnection.inputStream, maximumBytes)
                HttpURLConnection.HTTP_MOVED_TEMP,
                HttpURLConnection.HTTP_MOVED_PERM,
                HttpURLConnection.HTTP_SEE_OTHER,
                HTTP_TEMPORARY_REDIRECT,
                HTTP_PERMANENT_REDIRECT,
                -> {
                    discardError(graphConnection)
                    val location = graphConnection.getHeaderField("Location")
                        ?: throw OneDriveHttpException(status)
                    downloadWithoutAuthorization(location, maximumBytes)
                }
                else -> {
                    discardError(graphConnection)
                    throw OneDriveHttpException(status)
                }
            }
        } finally {
            graphConnection.disconnect()
        }
    }

    private fun uploadNew(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        contentLength: Long,
        writeBody: (HttpURLConnection) -> Unit,
    ): OneDriveItem = upload(
        accessToken = accessToken,
        path = "/me/drive/items/${pathSegment(parentId)}:/${pathSegment(fileName)}:/content" +
            "?@microsoft.graph.conflictBehavior=fail&\$select=id,name,size,eTag",
        mimeType = mimeType,
        contentLength = contentLength,
        writeBody = writeBody,
    )

    private fun upload(
        accessToken: String,
        path: String,
        mimeType: String,
        contentLength: Long,
        ifMatch: String? = null,
        writeBody: (HttpURLConnection) -> Unit,
    ): OneDriveItem {
        require(contentLength in 1..MobileInboxProtocol.MAX_AUDIO_BYTES.toLong())
        require(mimeType.matches(MIME_TYPE_PATTERN))
        val connection = graphConnection(accessToken, path).apply {
            requestMethod = "PUT"
            doOutput = true
            setRequestProperty("Content-Type", mimeType)
            if (ifMatch != null) setRequestProperty("If-Match", ifMatch)
            setFixedLengthStreamingMode(contentLength)
        }
        return try {
            writeBody(connection)
            val status = connection.responseCode
            if (status == HttpURLConnection.HTTP_CONFLICT || status == HttpURLConnection.HTTP_PRECON_FAILED) {
                discardError(connection)
                throw OneDriveConflictException()
            }
            if (status !in 200..299) {
                discardError(connection)
                throw OneDriveHttpException(status)
            }
            parseItem(readBounded(connection.inputStream, MAX_METADATA_BYTES))
        } finally {
            connection.disconnect()
        }
    }

    private fun metadataRequest(
        accessToken: String,
        method: String,
        path: String,
        missingIsNull: Boolean = false,
    ): OneDriveItem? {
        val connection = graphConnection(accessToken, path).apply { requestMethod = method }
        return try {
            val status = connection.responseCode
            if (missingIsNull && status == HttpURLConnection.HTTP_NOT_FOUND) {
                discardError(connection)
                return null
            }
            if (status !in 200..299) {
                discardError(connection)
                throw OneDriveHttpException(status)
            }
            parseItem(readBounded(connection.inputStream, MAX_METADATA_BYTES))
        } finally {
            connection.disconnect()
        }
    }

    private fun graphConnection(accessToken: String, path: String): HttpURLConnection {
        require(path.startsWith('/') && !path.startsWith("//"))
        require(accessToken.isNotBlank() && accessToken.none { it == '\r' || it == '\n' })
        return connectionFactory.open(URL("$GRAPH_ROOT$path")).apply {
            connectTimeout = CONNECT_TIMEOUT_MILLIS
            readTimeout = READ_TIMEOUT_MILLIS
            instanceFollowRedirects = false
            useCaches = false
            setRequestProperty("Authorization", "Bearer $accessToken")
            setRequestProperty("Accept", "application/json")
        }
    }

    private fun downloadWithoutAuthorization(location: String, maximumBytes: Int): ByteArray {
        var current = safeDownloadUrl(location)
        repeat(MAX_DOWNLOAD_REDIRECTS + 1) { redirectCount ->
            val connection = connectionFactory.open(current.toURL()).apply {
                requestMethod = "GET"
                connectTimeout = CONNECT_TIMEOUT_MILLIS
                readTimeout = READ_TIMEOUT_MILLIS
                instanceFollowRedirects = false
                useCaches = false
            }
            try {
                when (val status = connection.responseCode) {
                    HttpURLConnection.HTTP_OK -> return readBounded(connection.inputStream, maximumBytes)
                    HttpURLConnection.HTTP_MOVED_TEMP,
                    HttpURLConnection.HTTP_MOVED_PERM,
                    HttpURLConnection.HTTP_SEE_OTHER,
                    HTTP_TEMPORARY_REDIRECT,
                    HTTP_PERMANENT_REDIRECT,
                    -> {
                        discardError(connection)
                        if (redirectCount == MAX_DOWNLOAD_REDIRECTS) {
                            throw OneDriveHttpException(status)
                        }
                        current = safeDownloadUrl(
                            connection.getHeaderField("Location")
                                ?: throw OneDriveHttpException(status),
                            current,
                        )
                    }
                    else -> {
                        discardError(connection)
                        throw OneDriveHttpException(status)
                    }
                }
            } finally {
                connection.disconnect()
            }
        }
        error("OneDrive download redirect limit exceeded")
    }

    internal fun safeDownloadUrl(value: String, base: URI? = null): URI {
        val parsed = runCatching { URI(value) }.getOrElse {
            throw IllegalStateException("OneDrive returned an invalid download location")
        }
        val uri = if (parsed.isAbsolute) parsed else base?.resolve(parsed)
            ?: throw IllegalStateException("OneDrive returned an invalid download location")
        check(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) {
            "OneDrive returned an unsafe download location"
        }
        check(uri.userInfo == null) { "OneDrive returned an unsafe download location" }
        return uri
    }

    private fun parseItem(bytes: ByteArray): OneDriveItem {
        val json = JSONObject(bytes.toString(Charsets.UTF_8))
        return OneDriveItem(
            id = json.getString("id"),
            name = json.getString("name"),
            size = json.getLong("size"),
            eTag = json.getString("eTag"),
        )
    }

    private fun readBounded(input: InputStream, maximumBytes: Int): ByteArray = input.use {
        val output = ByteArrayOutputStream(minOf(maximumBytes, DEFAULT_BUFFER_SIZE))
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        var total = 0
        while (true) {
            val count = it.read(buffer)
            if (count < 0) break
            total += count
            check(total <= maximumBytes) { "OneDrive returned an oversized response" }
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    }

    private fun discardError(connection: HttpURLConnection) {
        runCatching { connection.errorStream?.let { readBounded(it, MAX_ERROR_BYTES) } }
    }

    private fun pathSegment(value: String): String {
        require(value.isNotBlank() && value.length <= 1024 && value.none(Char::isISOControl))
        return URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    }

    private class OneDriveHttpException(status: Int) :
        Exception("OneDrive request failed with HTTP status $status")

    companion object {
        private const val GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
        private const val CONNECT_TIMEOUT_MILLIS = 15_000
        private const val READ_TIMEOUT_MILLIS = 45_000
        private const val MAX_METADATA_BYTES = 64 * 1024
        private const val MAX_ERROR_BYTES = 8 * 1024
        private const val MAX_DOWNLOAD_REDIRECTS = 3
        private const val HTTP_TEMPORARY_REDIRECT = 307
        private const val HTTP_PERMANENT_REDIRECT = 308
        private val MIME_TYPE_PATTERN = Regex("^[a-z0-9.+-]+/[a-z0-9.+-]+$")
    }
}
