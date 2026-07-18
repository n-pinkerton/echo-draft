package com.echodraft.mobile

import java.io.File
import java.security.MessageDigest

class OneDriveRemoteFiles(private val api: OneDriveDriveApi) {
    fun ensureFile(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        file: File,
        expectedSha256: String,
    ): OneDriveItem {
        check(file.isFile && file.length() > 0) { "The local publication file is unavailable" }
        check(file.length() <= Int.MAX_VALUE) { "The local publication file is too large" }

        val existing = api.child(accessToken, parentId, fileName)
        val created = if (existing == null) {
            try {
                api.uploadFileIfAbsent(accessToken, parentId, fileName, mimeType, file)
            } catch (_: OneDriveConflictException) {
                null
            }
        } else {
            null
        }
        val expected = created ?: existing ?: api.child(accessToken, parentId, fileName)
            ?: error("OneDrive conflict could not be resolved safely")
        return try {
            verifyFile(
                accessToken,
                parentId,
                fileName,
                file.length(),
                expectedSha256,
                expected,
            )
        } catch (error: Throwable) {
            if (created != null) {
                deleteCreated(
                    accessToken,
                    parentId,
                    fileName,
                    file.length(),
                    created,
                    error,
                )
            }
            throw error
        }
    }

    fun ensureBytes(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
    ): OneDriveItem {
        require(bytes.isNotEmpty())
        val existing = api.child(accessToken, parentId, fileName)
        val created = if (existing == null) {
            try {
                api.uploadBytesIfAbsent(accessToken, parentId, fileName, mimeType, bytes)
            } catch (_: OneDriveConflictException) {
                null
            }
        } else {
            null
        }
        val expected = created ?: existing ?: api.child(accessToken, parentId, fileName)
            ?: error("OneDrive conflict could not be resolved safely")
        return try {
            verifyBytes(accessToken, parentId, fileName, bytes, expected)
        } catch (error: Throwable) {
            if (created != null) {
                deleteCreated(
                    accessToken,
                    parentId,
                    fileName,
                    bytes.size.toLong(),
                    created,
                    error,
                )
            }
            throw error
        }
    }

    fun replaceOwnedBytes(
        accessToken: String,
        parentId: String,
        fileName: String,
        mimeType: String,
        bytes: ByteArray,
        maximumExistingBytes: Int,
        ownsExisting: (ByteArray) -> Boolean,
    ): OneDriveItem {
        require(bytes.isNotEmpty())
        require(maximumExistingBytes >= bytes.size)
        var existing = api.child(accessToken, parentId, fileName)
        if (existing == null) {
            val created = try {
                api.uploadBytesIfAbsent(accessToken, parentId, fileName, mimeType, bytes)
            } catch (_: OneDriveConflictException) {
                null
            }
            if (created != null) {
                return try {
                    verifyBytes(accessToken, parentId, fileName, bytes, created)
                } catch (error: Throwable) {
                    deleteCreated(
                        accessToken,
                        parentId,
                        fileName,
                        bytes.size.toLong(),
                        created,
                        error,
                    )
                    throw error
                }
            }
            existing = api.child(accessToken, parentId, fileName)
                ?: error("OneDrive conflict could not be resolved safely")
        }

        check(existing.name == fileName && existing.size in 1..maximumExistingBytes.toLong()) {
            "OneDrive contains conflicting support content"
        }
        val previous = api.download(accessToken, existing.id, maximumExistingBytes)
        check(ownsExisting(previous)) { "OneDrive contains foreign support content" }
        val stable = api.child(accessToken, parentId, fileName)
            ?: error("OneDrive support content changed during publication")
        requireSameIdentity(existing, stable)
        val replaced = api.replaceBytes(accessToken, stable, mimeType, bytes)
        return verifyBytes(accessToken, parentId, fileName, bytes, replaced)
    }

    fun verifyFile(
        accessToken: String,
        parentId: String,
        fileName: String,
        expectedSize: Long,
        expectedSha256: String,
        expectedItem: OneDriveItem,
    ): OneDriveItem {
        val published = findStable(accessToken, parentId, fileName, expectedSize, expectedItem)
        val remoteBytes = api.download(accessToken, published.id, expectedSize.toInt())
        check(remoteBytes.size.toLong() == expectedSize && sha256(remoteBytes) == expectedSha256) {
            "OneDrive publication verification failed"
        }
        return confirmUnchanged(accessToken, parentId, fileName, published)
    }

    fun verifyBytes(
        accessToken: String,
        parentId: String,
        fileName: String,
        expected: ByteArray,
        expectedItem: OneDriveItem,
    ): OneDriveItem {
        val published = findStable(
            accessToken,
            parentId,
            fileName,
            expected.size.toLong(),
            expectedItem,
        )
        val remoteBytes = api.download(accessToken, published.id, expected.size)
        check(remoteBytes.contentEquals(expected)) { "OneDrive publication verification failed" }
        return confirmUnchanged(accessToken, parentId, fileName, published)
    }

    private fun findStable(
        accessToken: String,
        parentId: String,
        fileName: String,
        expectedSize: Long,
        expectedItem: OneDriveItem,
    ): OneDriveItem {
        val published = api.child(accessToken, parentId, fileName)
            ?: error("OneDrive did not retain the published file")
        check(published.name == fileName && published.size == expectedSize) {
            "OneDrive publication verification failed"
        }
        requireSameIdentity(expectedItem, published)
        return published
    }

    private fun confirmUnchanged(
        accessToken: String,
        parentId: String,
        fileName: String,
        verified: OneDriveItem,
    ): OneDriveItem {
        val confirmed = api.child(accessToken, parentId, fileName)
            ?: error("OneDrive publication changed during verification")
        requireSameIdentity(verified, confirmed)
        return confirmed
    }

    private fun requireSameIdentity(expected: OneDriveItem, actual: OneDriveItem) {
        check(expected.id == actual.id && expected.eTag == actual.eTag) {
            "OneDrive publication changed during verification"
        }
    }

    private fun deleteCreated(
        accessToken: String,
        parentId: String,
        fileName: String,
        expectedSize: Long,
        created: OneDriveItem,
        originalError: Throwable,
    ) {
        try {
            val resolved = api.child(accessToken, parentId, fileName) ?: return
            if (
                created.name != fileName ||
                created.size != expectedSize ||
                resolved.name != fileName ||
                resolved.size != expectedSize ||
                resolved.id != created.id ||
                resolved.eTag != created.eTag
            ) {
                return
            }
            api.delete(accessToken, resolved)
        } catch (cleanupError: Throwable) {
            originalError.addSuppressed(cleanupError)
        }
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { byte ->
                (byte.toInt() and 0xff).toString(16).padStart(2, '0')
            }
}
