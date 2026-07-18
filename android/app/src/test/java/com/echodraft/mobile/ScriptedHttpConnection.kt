package com.echodraft.mobile

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.ArrayDeque

data class ScriptedHttpResponse(
    val status: Int,
    val body: ByteArray = byteArrayOf(),
    val headers: Map<String, String> = emptyMap(),
)

class ScriptedHttpConnectionFactory(
    responses: List<ScriptedHttpResponse>,
) : GraphHttpConnectionFactory {
    private val remaining = ArrayDeque(responses)
    val opened = mutableListOf<ScriptedHttpConnection>()

    override fun open(url: URL): HttpURLConnection {
        check(remaining.isNotEmpty()) { "Unexpected HTTP connection" }
        return ScriptedHttpConnection(url, remaining.removeFirst()).also(opened::add)
    }
}

class ScriptedHttpConnection(
    url: URL,
    private val response: ScriptedHttpResponse,
) : HttpURLConnection(url) {
    val requestBody = ByteArrayOutputStream()
    var wasDisconnected = false
        private set

    override fun connect() = Unit

    override fun disconnect() {
        wasDisconnected = true
    }

    override fun usingProxy(): Boolean = false

    override fun getResponseCode(): Int = response.status

    override fun getInputStream(): InputStream = ByteArrayInputStream(response.body)

    override fun getErrorStream(): InputStream? =
        response.body.takeIf { it.isNotEmpty() }?.let(::ByteArrayInputStream)

    override fun getOutputStream(): ByteArrayOutputStream = requestBody

    override fun getHeaderField(name: String?): String? = response.headers[name]
}
