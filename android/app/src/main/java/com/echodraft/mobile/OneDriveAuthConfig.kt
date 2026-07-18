package com.echodraft.mobile

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URLEncoder
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.Base64
import java.util.UUID

data class OneDriveAuthConfig(
    val clientId: String,
    val tenantId: String,
    val packageName: String,
    val signatureHash: String,
) {
    init {
        requireUuid(clientId)
        requireUuid(tenantId)
        require(PACKAGE_NAME_PATTERN.matches(packageName))
        require(runCatching { Base64.getDecoder().decode(signatureHash) }.getOrNull()?.size == 20) {
            "The Android signature hash is invalid"
        }
    }

    val redirectUri: String =
        "msauth://$packageName/${urlEncode(signatureHash)}"

    val manifestSignaturePath: String = "/$signatureHash"

    fun writeMsalConfiguration(context: Context): File {
        val directory = File(context.noBackupFilesDir, "identity")
        check(directory.isDirectory || directory.mkdirs()) {
            "Could not create private identity configuration storage"
        }
        val destination = File(directory, CONFIGURATION_FILE_NAME)
        val bytes = toMsalJson().toByteArray(Charsets.UTF_8)
        if (destination.isFile && runCatching { destination.readBytes() }.getOrNull()?.contentEquals(bytes) == true) {
            return destination
        }

        val temporary = File(directory, TEMPORARY_FILE_NAME)
        if (temporary.exists()) check(temporary.delete()) {
            "Could not replace stale identity configuration"
        }
        FileOutputStream(temporary).use { output ->
            output.write(bytes)
            output.flush()
            output.fd.sync()
        }
        moveReplacing(temporary, destination)
        return destination
    }

    internal fun toMsalJson(): String {
        val audience = JSONObject()
            .put("type", "AzureADMyOrg")
            .put("tenant_id", tenantId)
        val authority = JSONObject()
            .put("type", "AAD")
            .put("audience", audience)
            .put("default", true)
        val logging = JSONObject()
            .put("pii_enabled", false)
            .put("logcat_enabled", false)
            .put("log_level", "WARNING")
        return JSONObject()
            .put("client_id", clientId)
            .put("authorization_user_agent", "DEFAULT")
            .put("redirect_uri", redirectUri)
            .put("account_mode", "SINGLE")
            .put("broker_redirect_uri_registered", true)
            .put("authorities", JSONArray().put(authority))
            .put("logging", logging)
            .toString()
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
        private const val CONFIGURATION_FILE_NAME = "msal_config.json"
        private const val TEMPORARY_FILE_NAME = "msal_config.tmp"
        private val PACKAGE_NAME_PATTERN = Regex("^[a-z][A-Za-z0-9_]*(?:\\.[A-Za-z][A-Za-z0-9_]*)+$")

        fun fromBuildConfig(context: Context): OneDriveAuthConfig? {
            val values = listOf(
                BuildConfig.MSAL_CLIENT_ID,
                BuildConfig.MSAL_TENANT_ID,
                BuildConfig.MSAL_SIGNATURE_HASH,
            )
            if (values.all(String::isBlank)) return null
            return OneDriveAuthConfig(
                clientId = BuildConfig.MSAL_CLIENT_ID,
                tenantId = BuildConfig.MSAL_TENANT_ID,
                packageName = context.packageName,
                signatureHash = BuildConfig.MSAL_SIGNATURE_HASH,
            )
        }

        private fun requireUuid(value: String) {
            require(runCatching { UUID.fromString(value) }.getOrNull()?.toString() == value.lowercase()) {
                "The Microsoft application configuration is invalid"
            }
        }

        private fun urlEncode(value: String): String =
            URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    }
}
