package com.echodraft.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract

class InboxTreeStore(
    private val context: Context,
    private val preferences: AppPreferences = AppPreferences(context),
) {
    data class Root(
        val treeUri: Uri,
        val documentUri: Uri,
        val documentId: String,
        val displayName: String,
        val flags: Int,
    )

    fun persist(uri: Uri, resultFlags: Int): Root {
        val takeFlags = resultFlags and (
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        check(takeFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0) {
            "The selected provider did not grant read access"
        }
        check(takeFlags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0) {
            "The selected provider did not grant write access"
        }
        val previousUri = preferences.treeUri
        context.contentResolver.takePersistableUriPermission(uri, takeFlags)
        preferences.treeUri = uri
        val root = try {
            requireWritableRoot()
        } catch (error: Throwable) {
            preferences.treeUri = previousUri
            if (uri != previousUri) releasePermission(uri, takeFlags)
            throw error
        }
        if (previousUri != null && previousUri != uri) {
            releasePermission(
                previousUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }
        return root
    }

    fun requireWritableRoot(): Root {
        val treeUri = preferences.treeUri ?: error("Choose a shared sync folder first")
        val permission = context.contentResolver.persistedUriPermissions.firstOrNull {
            it.uri == treeUri && it.isReadPermission && it.isWritePermission
        } ?: error("Shared-folder access expired; choose the folder again")
        check(permission.isReadPermission && permission.isWritePermission)

        val documentId = DocumentsContract.getTreeDocumentId(treeUri)
        val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_FLAGS,
        )
        val metadata = context.contentResolver.query(documentUri, projection, null, null, null)
            ?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                Triple(cursor.getString(0) ?: "Shared folder", cursor.getString(1), cursor.getInt(2))
            } ?: error("The selected shared folder is unavailable")

        check(metadata.second == DocumentsContract.Document.MIME_TYPE_DIR) {
            "The selected location is not a folder"
        }
        check(metadata.third and DocumentsContract.Document.FLAG_DIR_SUPPORTS_CREATE != 0) {
            "The selected provider does not allow files in this folder"
        }
        return Root(treeUri, documentUri, documentId, metadata.first, metadata.third)
    }

    fun isReady(): Boolean = runCatching { requireWritableRoot() }.isSuccess

    fun hasPersistedAccess(): Boolean {
        val treeUri = preferences.treeUri ?: return false
        return context.contentResolver.persistedUriPermissions.any {
            it.uri == treeUri && it.isReadPermission && it.isWritePermission
        }
    }

    private fun releasePermission(uri: Uri, flags: Int) {
        runCatching { context.contentResolver.releasePersistableUriPermission(uri, flags) }
    }
}
