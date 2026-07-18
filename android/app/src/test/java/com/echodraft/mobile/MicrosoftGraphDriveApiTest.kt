package com.echodraft.mobile

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URI

class MicrosoftGraphDriveApiTest {
    @Test
    fun `Graph metadata request uses fixed host bearer token and bounded selection`() {
        val factory = factory(response(HttpURLConnection.HTTP_OK, itemJson("root-id", "EchoDraft", 0)))
        val api = MicrosoftGraphDriveApi(factory)

        api.appRoot("secret-token")

        val request = factory.opened.single()
        assertEquals(
            "https://graph.microsoft.com/v1.0/me/drive/special/approot?\$select=id,name,size,eTag",
            request.url.toString(),
        )
        assertEquals("GET", request.requestMethod)
        assertEquals("Bearer secret-token", request.getRequestProperty("Authorization"))
        assertTrue(request.wasDisconnected)
    }

    @Test
    fun `new uploads request conflict failure instead of replacement`() {
        val factory = factory(response(HttpURLConnection.HTTP_CREATED, itemJson("item-id", "memo.m4a", 3)))
        val api = MicrosoftGraphDriveApi(factory)

        api.uploadBytesIfAbsent("token", "root-id", "memo.m4a", "audio/mp4", byteArrayOf(1, 2, 3))

        val request = factory.opened.single()
        assertEquals(
            "https://graph.microsoft.com/v1.0/me/drive/items/root-id:/memo.m4a:/content" +
                "?@microsoft.graph.conflictBehavior=fail&\$select=id,name,size,eTag",
            request.url.toString(),
        )
        assertArrayEquals(byteArrayOf(1, 2, 3), request.requestBody.toByteArray())
    }

    @Test
    fun `name conflict is surfaced as safe conflict category`() {
        val factory = factory(response(HttpURLConnection.HTTP_CONFLICT, "ignored".toByteArray()))

        assertThrows(OneDriveConflictException::class.java) {
            MicrosoftGraphDriveApi(factory).uploadBytesIfAbsent(
                "token",
                "root-id",
                "memo.m4a",
                "audio/mp4",
                byteArrayOf(1),
            )
        }
        assertTrue(factory.opened.single().wasDisconnected)
    }

    @Test
    fun `conditional replacement addresses item ID and sends matching eTag`() {
        val factory = factory(response(HttpURLConnection.HTTP_OK, itemJson("item-id", "support.jsonl", 2)))
        val existing = OneDriveItem("item-id", "support.jsonl", 1, "\"before\"")

        MicrosoftGraphDriveApi(factory).replaceBytes(
            "token",
            existing,
            "application/x-ndjson",
            byteArrayOf(1, 2),
        )

        val request = factory.opened.single()
        assertEquals(
            "https://graph.microsoft.com/v1.0/me/drive/items/item-id/content" +
                "?\$select=id,name,size,eTag",
            request.url.toString(),
        )
        assertEquals(existing.eTag, request.getRequestProperty("If-Match"))
    }

    @Test
    fun `download redirect never forwards Graph authorization`() {
        val factory = factory(
            response(
                HttpURLConnection.HTTP_MOVED_TEMP,
                headers = mapOf("Location" to "https://download.example/memo.m4a"),
            ),
            response(HttpURLConnection.HTTP_OK, byteArrayOf(4, 5, 6)),
        )

        val bytes = MicrosoftGraphDriveApi(factory).download("secret-token", "item-id", 3)

        assertArrayEquals(byteArrayOf(4, 5, 6), bytes)
        assertEquals("Bearer secret-token", factory.opened[0].getRequestProperty("Authorization"))
        assertNull(factory.opened[1].getRequestProperty("Authorization"))
        assertEquals("https://download.example/memo.m4a", factory.opened[1].url.toString())
        assertTrue(factory.opened.all { it.wasDisconnected })
    }

    @Test
    fun `oversized downloads and malformed metadata fail with closed connections`() {
        val oversizedFactory = factory(response(HttpURLConnection.HTTP_OK, byteArrayOf(1, 2)))
        assertThrows(IllegalStateException::class.java) {
            MicrosoftGraphDriveApi(oversizedFactory).download("token", "item-id", 1)
        }
        assertTrue(oversizedFactory.opened.single().wasDisconnected)

        val malformedFactory = factory(
            response(
                HttpURLConnection.HTTP_OK,
                JSONObject().put("id", "root").put("name", "EchoDraft").put("size", 0).toString()
                    .toByteArray(),
            ),
        )
        assertThrows(org.json.JSONException::class.java) {
            MicrosoftGraphDriveApi(malformedFactory).appRoot("token")
        }
        assertTrue(malformedFactory.opened.single().wasDisconnected)
    }

    @Test
    fun `missing child is returned without exposing an error body`() {
        val factory = factory(response(HttpURLConnection.HTTP_NOT_FOUND, "private response".toByteArray()))

        assertNull(MicrosoftGraphDriveApi(factory).child("token", "root-id", "memo.m4a"))
        assertTrue(factory.opened.single().wasDisconnected)
    }

    @Test
    fun `download redirects remain HTTPS and never accept embedded credentials`() {
        val api = MicrosoftGraphDriveApi(factory())
        assertEquals(
            URI("https://download.example/memo.m4a"),
            api.safeDownloadUrl("https://download.example/memo.m4a"),
        )
        assertThrows(IllegalStateException::class.java) {
            api.safeDownloadUrl("http://download.example/memo.m4a")
        }
        assertThrows(IllegalStateException::class.java) {
            api.safeDownloadUrl("https://user:password@download.example/memo.m4a")
        }
    }

    @Test
    fun `relative CDN redirects resolve only against an already safe HTTPS URL`() {
        val api = MicrosoftGraphDriveApi(factory())
        assertEquals(
            URI("https://download.example/next/memo.m4a"),
            api.safeDownloadUrl("../next/memo.m4a", URI("https://download.example/first/memo.m4a")),
        )
        assertThrows(IllegalStateException::class.java) {
            api.safeDownloadUrl("next/memo.m4a", URI("http://download.example/first"))
        }
    }

    private fun itemJson(id: String, name: String, size: Long): ByteArray =
        JSONObject()
            .put("id", id)
            .put("name", name)
            .put("size", size)
            .put("eTag", "\"etag-$id\"")
            .toString()
            .toByteArray()

    private fun response(
        status: Int,
        body: ByteArray = byteArrayOf(),
        headers: Map<String, String> = emptyMap(),
    ): ScriptedHttpResponse = ScriptedHttpResponse(status, body, headers)

    private fun factory(vararg responses: ScriptedHttpResponse): ScriptedHttpConnectionFactory =
        ScriptedHttpConnectionFactory(responses.toList())
}
