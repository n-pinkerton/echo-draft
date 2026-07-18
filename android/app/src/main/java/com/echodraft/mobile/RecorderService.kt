package com.echodraft.mobile

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.MediaRecorder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.Executors

class RecorderService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var preferences: AppPreferences
    private lateinit var pendingStore: PendingRecordingStore
    private lateinit var publisher: GraphInboxPublisher
    private lateinit var diagnostics: MobileDiagnosticReporter
    private val operationFence = OperationFence()

    @Volatile
    private var phase = AppPreferences.Phase.IDLE
    @Volatile
    private var activeRecording: ActiveRecording? = null
    private var activeOperation = 0L

    private class ActiveRecording(
        val operation: Long,
        val recorder: MediaRecorder,
        val pendingSession: PendingRecordingStore.Session,
    ) {
        @Volatile
        var limitStopRequested = false
    }

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        preferences = AppPreferences(this)
        pendingStore = PendingRecordingStore.from(this)
        publisher = GraphInboxPublisher(
            OneDriveSession.from(this),
            MicrosoftGraphDriveApi(),
        )
        diagnostics = MobileDiagnosticReporter.from(this)
        if (pendingStore.removeStaleTemporaryFiles() > 0) {
            diagnostics.record(
                MobileDiagnosticEvents.OPERATION_INTERRUPTED,
                pendingMemoCount = pendingStore.pendingCount(),
            )
        }
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> beginStart()
            ACTION_STOP -> beginStop()
            ACTION_RETRY -> beginRetry()
            else -> stopSelf(startId)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    @Synchronized
    private fun beginStart() {
        if (phase != AppPreferences.Phase.IDLE && phase != AppPreferences.Phase.ERROR) return
        val operation = operationFence.begin()
        activeOperation = operation
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            phase = AppPreferences.Phase.ERROR
            val message = "Microphone permission is required. Open the app to finish setup."
            diagnostics.record(
                MobileDiagnosticEvents.RECORDING_START_FAILED,
                pendingMemoCount = preferences.state().pendingCount,
            )
            startForegroundWithType(
                buildNotification(message, includeStop = false),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
            updateState(phase, message)
            finishService(operation)
            return
        }
        phase = AppPreferences.Phase.STARTING
        startForegroundWithType(
            buildNotification(getString(R.string.notification_starting), includeStop = true),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        )
        updateState(phase, getString(R.string.notification_starting))
        executor.execute { startRecording(operation) }
    }

    @Synchronized
    private fun beginStop() {
        if (phase == AppPreferences.Phase.STARTING || phase == AppPreferences.Phase.RECORDING) {
            val operation = activeOperation
            phase = AppPreferences.Phase.STOPPING
            updateState(phase, getString(R.string.status_saving))
            updateNotification(getString(R.string.notification_saving), includeStop = false)
            executor.execute { finishRecording(operation) }
            return
        }

        if (phase == AppPreferences.Phase.IDLE || phase == AppPreferences.Phase.ERROR) {
            val operation = operationFence.begin()
            activeOperation = operation
            startForegroundWithType(
                buildNotification(getString(R.string.notification_saving), includeStop = false),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
            finishService(operation)
        }
    }

    @Synchronized
    private fun beginRetry() {
        if (phase != AppPreferences.Phase.IDLE && phase != AppPreferences.Phase.ERROR) return
        val operation = operationFence.begin()
        activeOperation = operation
        phase = AppPreferences.Phase.PUBLISHING
        startForegroundWithType(
            buildNotification(getString(R.string.notification_retrying), includeStop = false),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
        updateState(phase, getString(R.string.notification_retrying))
        executor.execute { publishPending(operation, currentMemoId = null) }
    }

    private fun startRecording(operation: Long) {
        if (!operationFence.isCurrent(operation)) return
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fail(
                operation,
                MobileDiagnosticEvents.RECORDING_START_FAILED,
                "Microphone permission is required. Open the app to finish setup.",
            )
            return
        }
        if (!preferences.oneDriveConnected) {
            fail(
                operation,
                MobileDiagnosticEvents.ONEDRIVE_UNAVAILABLE,
                "OneDrive setup is unavailable. Open the app and connect again.",
            )
            return
        }

        val newSession = runCatching { pendingStore.createSession() }.getOrElse { error ->
            fail(
                operation,
                MobileDiagnosticEvents.RECORDING_STORAGE_FAILED,
                "EchoDraft could not create a private recording file.",
                error,
            )
            return
        }
        val newRecorder = MediaRecorder(this)
        val recording = ActiveRecording(operation, newRecorder, newSession)
        try {
            newRecorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            newRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            newRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            newRecorder.setAudioChannels(1)
            newRecorder.setAudioSamplingRate(44_100)
            newRecorder.setAudioEncodingBitRate(64_000)
            newRecorder.setMaxFileSize(
                MobileInboxProtocol.MAX_AUDIO_BYTES.toLong() - RECORDING_LIMIT_HEADROOM_BYTES,
            )
            newRecorder.setOutputFile(newSession.temporaryFile.absolutePath)
            newRecorder.setOnInfoListener { source, what, _ ->
                if (
                    what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING ||
                    what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED
                ) {
                    // This belongs to the captured recorder, so a delayed callback cannot mark a
                    // newer operation. Record it before main-thread dispatch to close the
                    // asynchronous hard-limit/explicit-stop race documented by MediaRecorder.
                    recording.limitStopRequested = true
                    mainHandler.post {
                        if (
                            !operationFence.isCurrent(operation) ||
                            activeRecording !== recording ||
                            recording.recorder !== source
                        ) {
                            return@post
                        }
                        beginStop()
                    }
                }
            }
            newRecorder.prepare()
            activeRecording = recording
            newRecorder.start()
        } catch (error: Throwable) {
            if (activeRecording === recording) activeRecording = null
            runCatching { newRecorder.reset() }
            newRecorder.release()
            pendingStore.discard(newSession)
            fail(
                operation,
                MobileDiagnosticEvents.RECORDING_START_FAILED,
                "EchoDraft could not start the microphone recording.",
                error,
            )
            return
        }

        if (phase != AppPreferences.Phase.STOPPING) {
            phase = AppPreferences.Phase.RECORDING
            updateState(phase, getString(R.string.status_recording))
            updateNotification(getString(R.string.notification_recording), includeStop = true)
        }
    }

    private fun finishRecording(operation: Long) {
        val recording = activeRecording
        if (recording == null || recording.operation != operation) {
            fail(
                operation,
                MobileDiagnosticEvents.RECORDING_MISSING,
                "No active recording was available to save.",
            )
            return
        }

        activeRecording = null
        val activeRecorder = recording.recorder
        val activeSession = recording.pendingSession
        var stopError: RuntimeException? = null
        val stoppedExplicitly = try {
            activeRecorder.stop()
            true
        } catch (error: RuntimeException) {
            stopError = error
            false
        }
        activeRecorder.release()
        val limitStopRequested = recording.limitStopRequested ||
            activeSession.temporaryFile.length() >= RECORDING_LIMIT_RECOVERY_THRESHOLD_BYTES
        val validatedAfterAsyncStop = !stoppedExplicitly &&
            limitStopRequested &&
            M4aValidator.isCompleteAudio(activeSession.temporaryFile)
        when (
            RecordingStopPolicy.decide(
                stoppedExplicitly,
                limitStopRequested,
                validatedAfterAsyncStop,
            )
        ) {
            RecordingStopDisposition.FINALIZE -> Unit
            RecordingStopDisposition.RETAIN_FOR_RECOVERY -> {
                var recoveryError: Throwable? = null
                val retained = runCatching { pendingStore.retainForRecovery(activeSession) }
                    .onFailure { recoveryError = it }
                    .isSuccess
                fail(
                    operation,
                    MobileDiagnosticEvents.RECORDING_STOP_FAILED,
                    if (retained) {
                        "Android could not finalize the limit-stopped memo. A private recovery copy was kept on this phone."
                    } else {
                        "Android could not finalize the limit-stopped memo."
                    },
                    recoveryError ?: stopError,
                )
                return
            }
            RecordingStopDisposition.DISCARD -> {
                pendingStore.discard(activeSession)
                fail(
                    operation,
                    MobileDiagnosticEvents.RECORDING_STOP_FAILED,
                    "The recording was too short to save. Please try again.",
                    stopError,
                )
                return
            }
        }

        val ready = runCatching { pendingStore.finalize(activeSession) }.getOrElse { error ->
            pendingStore.discard(activeSession)
            fail(
                operation,
                MobileDiagnosticEvents.RECORDING_FINALIZE_FAILED,
                "EchoDraft could not finalize the recording.",
                error,
            )
            return
        }
        phase = AppPreferences.Phase.PUBLISHING
        startForegroundWithType(
            buildNotification(getString(R.string.notification_saving), includeStop = false),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
        updateState(phase, getString(R.string.status_saving))
        publishPending(operation, currentMemoId = ready.externalId.toString())
    }

    private fun publishPending(operation: Long, currentMemoId: String?) {
        var currentPublished = currentMemoId == null
        var failures = 0
        for (recording in pendingStore.listReady()) {
            if (!operationFence.isCurrent(operation)) return
            try {
                publisher.publish(recording)
                val retired = operationFence.runIfCurrent(operation) {
                    if (!recording.file.delete()) {
                        error("Published private memo could not be retired")
                    }
                }
                if (!retired) return
                if (recording.externalId.toString() == currentMemoId) currentPublished = true
            } catch (error: Throwable) {
                failures += 1
                diagnostics.record(
                    MobileDiagnosticEvents.MEMO_PUBLISH_FAILED,
                    error,
                    pendingStore.pendingCount(),
                )
            }
        }

        if (!operationFence.isCurrent(operation)) return
        diagnostics.sync()
        val pendingCount = pendingStore.pendingCount()
        val message = when {
            failures == 0 && currentMemoId == null -> "Pending memos uploaded for EchoDraft."
            failures == 0 && currentPublished -> "Memo uploaded for EchoDraft."
            else -> "Memo kept safely on this phone. Open the app to retry the upload."
        }
        phase = if (failures == 0) AppPreferences.Phase.IDLE else AppPreferences.Phase.ERROR
        preferences.updateState(phase, message, pendingCount)
        EchoDraftWidgetUi.updateAll(this)
        finishService(operation)
    }

    private fun fail(
        operation: Long,
        diagnosticEvent: String,
        message: String,
        error: Throwable? = null,
    ) {
        if (!operationFence.isCurrent(operation)) return
        diagnostics.report(diagnosticEvent, error, pendingStore.pendingCount())
        phase = AppPreferences.Phase.ERROR
        updateState(phase, message)
        finishService(operation)
    }

    private fun updateState(nextPhase: AppPreferences.Phase, message: String) {
        preferences.updateState(nextPhase, message, pendingStore.pendingCount())
        EchoDraftWidgetUi.updateAll(this)
    }

    private fun startForegroundWithType(notification: Notification, foregroundType: Int) {
        startForeground(NOTIFICATION_ID, notification, foregroundType)
    }

    private fun updateNotification(message: String, includeStop: Boolean) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(message, includeStop))
    }

    private fun buildNotification(message: String, includeStop: Boolean): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            REQUEST_OPEN_APP,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_mic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(message)
            .setContentIntent(openApp)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)

        if (includeStop) {
            val stop = PendingIntent.getService(
                this,
                REQUEST_STOP,
                Intent(this, RecorderService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.addAction(
                Notification.Action.Builder(
                    Icon.createWithResource(this, R.drawable.ic_stop_notification),
                    getString(R.string.notification_stop),
                    stop,
                ).build(),
            )
        }
        return builder.build()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notification_channel_description)
            setSound(null, null)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun finishService(operation: Long) {
        mainHandler.post {
            if (!operationFence.isCurrent(operation)) return@post
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        operationFence.invalidate()
        phase = AppPreferences.Phase.ERROR
        diagnostics.record(
            MobileDiagnosticEvents.FOREGROUND_TIMEOUT,
            pendingMemoCount = pendingStore.pendingCount(),
        )
        preferences.updateState(
            phase,
            "Android stopped a long-running upload. The memo remains available to retry.",
            pendingStore.pendingCount(),
        )
        EchoDraftWidgetUi.updateAll(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        operationFence.invalidate()
        activeRecording?.let { recording ->
            diagnostics.record(
                MobileDiagnosticEvents.RECORDING_SERVICE_DESTROYED,
                pendingMemoCount = preferences.state().pendingCount,
            )
            runCatching { recording.recorder.reset() }
            recording.recorder.release()
            pendingStore.discard(recording.pendingSession)
        }
        activeRecording = null
        executor.shutdownNow()
        isRunning = false
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.echodraft.mobile.action.START"
        const val ACTION_STOP = "com.echodraft.mobile.action.STOP"
        const val ACTION_RETRY = "com.echodraft.mobile.action.RETRY"

        private const val NOTIFICATION_CHANNEL_ID = "mobile_memo_recording"
        private const val NOTIFICATION_ID = 2107
        private const val REQUEST_OPEN_APP = 41
        private const val REQUEST_STOP = 42
        private const val RECORDING_LIMIT_HEADROOM_BYTES = 1024 * 1024L
        private const val RECORDING_LIMIT_RECOVERY_THRESHOLD_BYTES = 30 * 1024 * 1024L

        @Volatile
        var isRunning: Boolean = false
            private set

        fun requestStart(context: Context) {
            context.startForegroundService(
                Intent(context, RecorderService::class.java).setAction(ACTION_START),
            )
        }

        fun requestStop(context: Context) {
            context.startForegroundService(
                Intent(context, RecorderService::class.java).setAction(ACTION_STOP),
            )
        }

        fun requestRetry(context: Context) {
            context.startForegroundService(
                Intent(context, RecorderService::class.java).setAction(ACTION_RETRY),
            )
        }
    }
}
