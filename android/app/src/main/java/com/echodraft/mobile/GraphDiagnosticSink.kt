package com.echodraft.mobile

class GraphDiagnosticSink(
    private val tokenProvider: OneDriveAccessTokenProvider,
    private val api: OneDriveDriveApi,
) {
    private val remoteFiles = OneDriveRemoteFiles(api)

    fun publish(snapshot: ByteArray) {
        require(snapshot.size in 1..MobileDiagnosticStore.MAX_SNAPSHOT_BYTES)
        require(MobileDiagnosticStore.isSafeSnapshot(snapshot))

        val accessToken = tokenProvider.acquireAccessToken()
        val root = api.appRoot(accessToken)
        remoteFiles.replaceOwnedBytes(
            accessToken = accessToken,
            parentId = root.id,
            fileName = MobileDiagnosticStore.SHARED_FILE_NAME,
            mimeType = "application/x-ndjson",
            bytes = snapshot,
            maximumExistingBytes = MobileDiagnosticStore.MAX_SNAPSHOT_BYTES,
            ownsExisting = MobileDiagnosticStore::isSafeSnapshot,
        )
    }
}
