package com.echodraft.mobile

import java.io.File

data class OneDriveItem(
    val id: String,
    val name: String,
    val size: Long,
    val eTag: String,
) {
    init {
        require(id.isNotBlank() && id.length <= 1024 && id.none(Char::isISOControl))
        require(name.isNotBlank() && name.length <= 255 && name.none(Char::isISOControl))
        require(size >= 0)
        require(eTag.isNotBlank() && eTag.length <= 1024 && eTag.none(Char::isISOControl))
    }
}

interface OneDriveDriveApi {
    fun appRoot(accessToken: String): OneDriveItem

    fun child(accessToken: String, parentId: String, fileName: String): OneDriveItem?

    fun uploadFileIfAbsent(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        file: File,
    ): OneDriveItem

    fun uploadBytesIfAbsent(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): OneDriveItem

    fun replaceBytes(
        accessToken: String,
        item: OneDriveItem,
        mimeType: String,
        bytes: ByteArray,
    ): OneDriveItem

    fun delete(accessToken: String, item: OneDriveItem)

    fun download(accessToken: String, itemId: String, maximumBytes: Int): ByteArray
}

class OneDriveConflictException : Exception("OneDrive content changed during publication")

fun interface OneDriveAccessTokenProvider {
    fun acquireAccessToken(): String
}
