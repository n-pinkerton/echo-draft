package com.echodraft.mobile

class GraphInboxPublisher(
    private val tokenProvider: OneDriveAccessTokenProvider,
    private val api: OneDriveDriveApi,
) {
    private val remoteFiles = OneDriveRemoteFiles(api)

    fun publish(recording: PendingRecordingStore.ReadyRecording) {
        val source = recording.file
        check(source.isFile && source.length() in 1..MobileInboxProtocol.MAX_AUDIO_BYTES.toLong()) {
            "The pending memo is unavailable or too large"
        }
        val manifest = MobileInboxProtocol.Manifest(
            externalId = recording.externalId,
            audioSha256 = MobileInboxProtocol.sha256(source),
            sizeBytes = source.length(),
            createdAt = recording.createdAt,
        )
        val manifestBytes = manifest.toJson().toByteArray(Charsets.UTF_8)
        check(manifestBytes.size <= MobileInboxProtocol.MAX_MANIFEST_BYTES) {
            "The pending memo manifest is too large"
        }

        val accessToken = tokenProvider.acquireAccessToken()
        val root = api.appRoot(accessToken)
        val audioItem = remoteFiles.ensureFile(
            accessToken = accessToken,
            parentId = root.id,
            fileName = manifest.audioFile,
            mimeType = MobileInboxProtocol.AUDIO_MIME_TYPE,
            file = source,
            expectedSha256 = manifest.audioSha256,
        )
        val manifestItem = remoteFiles.ensureBytes(
            accessToken = accessToken,
            parentId = root.id,
            fileName = manifest.manifestFile,
            mimeType = MobileInboxProtocol.MANIFEST_MIME_TYPE,
            bytes = manifestBytes,
        )
        try {
            remoteFiles.verifyFile(
                accessToken,
                root.id,
                manifest.audioFile,
                manifest.sizeBytes,
                manifest.audioSha256,
                audioItem,
            )
            remoteFiles.verifyBytes(
                accessToken,
                root.id,
                manifest.manifestFile,
                manifestBytes,
                manifestItem,
            )
        } catch (error: Throwable) {
            try {
                api.delete(accessToken, manifestItem)
            } catch (cleanupError: Throwable) {
                error.addSuppressed(cleanupError)
            }
            throw error
        }
    }
}
