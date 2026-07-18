package com.echodraft.mobile

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class OneDriveAuthConfigTest {
    @Test
    fun `generates single-tenant single-account privacy-safe MSAL configuration`() {
        val signature = Base64.getEncoder().encodeToString(ByteArray(20) { 0xff.toByte() })
        val config = OneDriveAuthConfig(
            clientId = "550e8400-e29b-41d4-a716-446655440000",
            tenantId = "98b41ef1-b87a-4d60-9b62-3df07252fd7a",
            packageName = "com.echodraft.mobile",
            signatureHash = signature,
        )

        val json = JSONObject(config.toMsalJson())
        val authority = json.getJSONArray("authorities").getJSONObject(0)
        val logging = json.getJSONObject("logging")

        assertEquals("SINGLE", json.getString("account_mode"))
        assertTrue(json.getBoolean("broker_redirect_uri_registered"))
        assertEquals("AzureADMyOrg", authority.getJSONObject("audience").getString("type"))
        assertEquals("98b41ef1-b87a-4d60-9b62-3df07252fd7a", authority.getJSONObject("audience").getString("tenant_id"))
        assertFalse(logging.getBoolean("pii_enabled"))
        assertFalse(logging.getBoolean("logcat_enabled"))
        assertEquals("msauth://com.echodraft.mobile/${encoded(signature)}", config.redirectUri)
        assertEquals("/$signature", config.manifestSignaturePath)
    }

    @Test
    fun `rejects non-SHA1 signature hashes`() {
        val shortSignature = Base64.getEncoder().encodeToString(ByteArray(10))

        assertThrows(IllegalArgumentException::class.java) {
            OneDriveAuthConfig(
                clientId = "550e8400-e29b-41d4-a716-446655440000",
                tenantId = "98b41ef1-b87a-4d60-9b62-3df07252fd7a",
                packageName = "com.echodraft.mobile",
                signatureHash = shortSignature,
            )
        }
    }

    @Test
    fun `rejects noncanonical identifiers and signature encodings`() {
        val clientId = "550e8400-e29b-41d4-a716-446655440000"
        val tenantId = "98b41ef1-b87a-4d60-9b62-3df07252fd7a"
        val signature = Base64.getEncoder().encodeToString(ByteArray(20))

        listOf("{$clientId}", clientId.replace("-", "")).forEach { invalidClientId ->
            assertThrows(IllegalArgumentException::class.java) {
                OneDriveAuthConfig(invalidClientId, tenantId, "com.echodraft.mobile", signature)
            }
        }
        listOf(signature.removeSuffix("="), signature.replace("=", " =")).forEach { invalidSignature ->
            assertThrows(IllegalArgumentException::class.java) {
                OneDriveAuthConfig(clientId, tenantId, "com.echodraft.mobile", invalidSignature)
            }
        }
    }

    private fun encoded(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}
