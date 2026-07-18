package com.echodraft.mobile

import android.content.Context
import android.util.Log
import java.util.concurrent.Executors

internal object MobileDiagnosticEvents {
    // Legacy v0.1 code retained so an existing local snapshot remains valid after upgrade.
    const val FOLDER_SELECTION_FAILED = "folder_selection_failed"
    const val ONEDRIVE_CONNECTION_FAILED = "onedrive_connection_failed"
    const val ONEDRIVE_UNAVAILABLE = "onedrive_unavailable"
    const val FOREGROUND_TASK_START_FAILED = "foreground_task_start_failed"
    const val OPERATION_INTERRUPTED = "operation_interrupted"
    // Legacy v0.1 code retained so an existing local snapshot remains valid after upgrade.
    const val SHARED_FOLDER_UNAVAILABLE = "shared_folder_unavailable"
    const val RECORDING_STORAGE_FAILED = "recording_storage_failed"
    const val RECORDING_START_FAILED = "recording_start_failed"
    const val RECORDING_MISSING = "recording_missing"
    const val RECORDING_STOP_FAILED = "recording_stop_failed"
    const val RECORDING_FINALIZE_FAILED = "recording_finalize_failed"
    const val MEMO_PUBLISH_FAILED = "memo_publish_failed"
    const val FOREGROUND_TIMEOUT = "foreground_timeout"
    const val RECORDING_SERVICE_DESTROYED = "recording_service_destroyed"

    private val all = setOf(
        FOLDER_SELECTION_FAILED,
        ONEDRIVE_CONNECTION_FAILED,
        ONEDRIVE_UNAVAILABLE,
        FOREGROUND_TASK_START_FAILED,
        OPERATION_INTERRUPTED,
        SHARED_FOLDER_UNAVAILABLE,
        RECORDING_STORAGE_FAILED,
        RECORDING_START_FAILED,
        RECORDING_MISSING,
        RECORDING_STOP_FAILED,
        RECORDING_FINALIZE_FAILED,
        MEMO_PUBLISH_FAILED,
        FOREGROUND_TIMEOUT,
        RECORDING_SERVICE_DESTROYED,
    )

    fun isKnown(value: String): Boolean = value in all
}

internal class MobileDiagnosticReporter private constructor(context: Context) {
    private val applicationContext = context.applicationContext
    private val store: MobileDiagnosticStore by lazy { MobileDiagnosticStore.from(applicationContext) }
    private val sink: GraphDiagnosticSink by lazy {
        GraphDiagnosticSink(
            OneDriveSession.from(applicationContext),
            MicrosoftGraphDriveApi(),
        )
    }
    private var syncInFlight = false
    private var syncPending = false

    fun record(event: String, error: Throwable? = null, pendingMemoCount: Int) {
        localExecutor.execute { recordNow(event, error, pendingMemoCount) }
    }

    fun sync() {
        localExecutor.execute { requestSyncNow() }
    }

    fun report(event: String, error: Throwable? = null, pendingMemoCount: Int) {
        localExecutor.execute {
            recordNow(event, error, pendingMemoCount)
            requestSyncNow()
        }
    }

    private fun recordNow(event: String, error: Throwable?, pendingMemoCount: Int) {
        runCatching { store.record(event, error, pendingMemoCount) }
            .onFailure { storeError ->
                Log.w(TAG, "Mobile diagnostic could not be retained (${storeError.safeType()})")
            }
    }

    private fun requestSyncNow() {
        if (syncInFlight) {
            syncPending = true
            return
        }
        val snapshot = runCatching { store.snapshot() }
            .onFailure { storeError ->
                Log.w(TAG, "Mobile diagnostics could not be read (${storeError.safeType()})")
            }
            .getOrNull() ?: return
        syncInFlight = true
        sinkExecutor.execute {
            val succeeded = runCatching { sink.publish(snapshot) }
                .onFailure { sinkError ->
                    Log.w(TAG, "Mobile diagnostics remain local for retry (${sinkError.safeType()})")
                }
                .isSuccess
            localExecutor.execute {
                syncInFlight = false
                val publishLatest = syncPending && succeeded
                syncPending = false
                if (publishLatest) requestSyncNow()
            }
        }
    }

    companion object {
        private const val TAG = "EchoDraftDiagnostics"
        private val localExecutor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "EchoDraftMobileDiagnosticStore")
        }
        private val sinkExecutor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "EchoDraftMobileDiagnosticSink")
        }

        @Volatile
        private var instance: MobileDiagnosticReporter? = null

        fun from(context: Context): MobileDiagnosticReporter = instance ?: synchronized(this) {
            instance ?: MobileDiagnosticReporter(context).also { instance = it }
        }

        private fun Throwable.safeType(): String = javaClass.simpleName.take(80)
    }
}
