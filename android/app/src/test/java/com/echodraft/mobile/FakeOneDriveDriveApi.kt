package com.echodraft.mobile

import java.io.File
import java.security.MessageDigest

class FakeOneDriveDriveApi : OneDriveDriveApi {
    val contents = linkedMapOf<String, ByteArray>()
    val events = mutableListOf<String>()
    var corruptFileUploads = false
    var corruptByteUploads = false
    var fileUploadResponseOverride: OneDriveItem? = null
    var raceBeforeNextCreate: Pair<String, ByteArray>? = null
    var afterByteUpload: (() -> Unit)? = null
    var afterDownload: (() -> Unit)? = null

    override fun appRoot(accessToken: String): OneDriveItem {
        events += "root"
        return OneDriveItem(ROOT_ID, "EchoDraft Mobile Inbox", 0, "root-etag")
    }

    override fun child(accessToken: String, parentId: String, fileName: String): OneDriveItem? {
        check(parentId == ROOT_ID)
        events += "find:$fileName"
        return contents[fileName]?.let { bytes -> item(fileName, bytes) }
    }

    override fun uploadFileIfAbsent(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        file: File,
    ): OneDriveItem {
        check(parentId == ROOT_ID)
        events += "upload-file:$fileName"
        applyCreateRace()
        if (contents.containsKey(fileName)) throw OneDriveConflictException()
        val bytes = file.readBytes().let { if (corruptFileUploads) corrupt(it) else it }
        contents[fileName] = bytes
        return fileUploadResponseOverride ?: item(fileName, bytes)
    }

    override fun uploadBytesIfAbsent(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): OneDriveItem {
        check(parentId == ROOT_ID)
        events += "upload-bytes:$fileName"
        applyCreateRace()
        if (contents.containsKey(fileName)) throw OneDriveConflictException()
        val stored = if (corruptByteUploads) corrupt(bytes) else bytes.copyOf()
        contents[fileName] = stored
        afterByteUpload?.invoke()
        return item(fileName, stored)
    }

    override fun replaceBytes(
        accessToken: String,
        expectedItem: OneDriveItem,
        mimeType: String,
        bytes: ByteArray,
    ): OneDriveItem {
        val fileName = expectedItem.id.removePrefix(ITEM_ID_PREFIX)
        events += "replace-bytes:$fileName"
        val current = contents[fileName]?.let { item(fileName, it) }
        if (current?.id != expectedItem.id || current.eTag != expectedItem.eTag) {
            throw OneDriveConflictException()
        }
        val stored = if (corruptByteUploads) corrupt(bytes) else bytes.copyOf()
        contents[fileName] = stored
        return item(fileName, stored)
    }

    override fun delete(accessToken: String, expectedItem: OneDriveItem) {
        val fileName = expectedItem.id.removePrefix(ITEM_ID_PREFIX)
        events += "delete:$fileName"
        val current = contents[fileName]?.let { item(fileName, it) } ?: return
        if (current.id != expectedItem.id || current.eTag != expectedItem.eTag) {
            throw OneDriveConflictException()
        }
        contents.remove(fileName)
    }

    override fun download(accessToken: String, itemId: String, maximumBytes: Int): ByteArray {
        events += "download:$itemId"
        val fileName = itemId.removePrefix(ITEM_ID_PREFIX)
        val result = contents.getValue(fileName).also { check(it.size <= maximumBytes) }.copyOf()
        afterDownload?.invoke()
        return result
    }

    private fun applyCreateRace() {
        raceBeforeNextCreate?.let { (fileName, bytes) -> contents[fileName] = bytes.copyOf() }
        raceBeforeNextCreate = null
    }

    private fun item(fileName: String, bytes: ByteArray): OneDriveItem = OneDriveItem(
        id = "$ITEM_ID_PREFIX$fileName",
        name = fileName,
        size = bytes.size.toLong(),
        eTag = "\"${sha256(bytes).take(24)}\"",
    )

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }

    private fun corrupt(bytes: ByteArray): ByteArray = bytes.copyOf().also {
        it[0] = (it[0].toInt() xor 0xff).toByte()
    }

    companion object {
        private const val ROOT_ID = "root-id"
        private const val ITEM_ID_PREFIX = "item-id:"
    }
}
