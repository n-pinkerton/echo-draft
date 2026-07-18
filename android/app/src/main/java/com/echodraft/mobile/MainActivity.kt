package com.echodraft.mobile

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import java.util.concurrent.Executors

class MainActivity : ComponentActivity(), SharedPreferences.OnSharedPreferenceChangeListener {
    private lateinit var preferences: AppPreferences
    private lateinit var pendingStore: PendingRecordingStore
    private lateinit var diagnostics: MobileDiagnosticReporter
    private lateinit var oneDriveSession: OneDriveSession
    private lateinit var oneDriveStatus: TextView
    private lateinit var connectButton: Button
    private lateinit var recordingStatus: TextView
    private lateinit var pendingCount: TextView
    private lateinit var recordButton: Button
    private lateinit var retryButton: Button
    private val graphApi = MicrosoftGraphDriveApi()
    private var startAfterPermission = false
    private var connectionInFlight = false
    private var connectedBeforeSignIn = false

    private val permissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        val microphoneGranted = grants[Manifest.permission.RECORD_AUDIO] == true ||
            preferences.hasMicrophonePermission(this)
        if (startAfterPermission && microphoneGranted) startRecorder()
        startAfterPermission = false
        render()
        EchoDraftWidgetUi.updateAll(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        preferences = AppPreferences(this)
        pendingStore = PendingRecordingStore.from(this)
        diagnostics = MobileDiagnosticReporter.from(this)
        oneDriveSession = OneDriveSession.from(this)

        oneDriveStatus = findViewById(R.id.onedrive_status)
        connectButton = findViewById(R.id.connect_onedrive_button)
        recordingStatus = findViewById(R.id.recording_status)
        pendingCount = findViewById(R.id.pending_count)
        recordButton = findViewById(R.id.record_button)
        retryButton = findViewById(R.id.retry_button)

        connectButton.setOnClickListener { connectOneDrive() }
        recordButton.setOnClickListener { toggleRecording() }
        retryButton.setOnClickListener { retryPending() }
        findViewById<Button>(R.id.add_widget_button).setOnClickListener { requestWidgetPin() }
    }

    override fun onStart() {
        super.onStart()
        preferences.sharedPreferences.registerOnSharedPreferenceChangeListener(this)
    }

    override fun onStop() {
        preferences.sharedPreferences.unregisterOnSharedPreferenceChangeListener(this)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        val state = preferences.state()
        if (state.isBusy && !RecorderService.isRunning) {
            pendingStore.removeStaleTemporaryFiles()
            val pendingMemos = pendingStore.pendingCount()
            preferences.updateState(
                AppPreferences.Phase.ERROR,
                "Previous work was interrupted. Any completed memo remains available to retry.",
                pendingMemos,
            )
            diagnostics.record(
                MobileDiagnosticEvents.OPERATION_INTERRUPTED,
                pendingMemoCount = pendingMemos,
            )
        }
        diagnostics.sync()
        render()
        EchoDraftWidgetUi.updateAll(this)
    }

    override fun onSharedPreferenceChanged(sharedPreferences: SharedPreferences?, key: String?) {
        runOnUiThread(::render)
    }

    private fun toggleRecording() {
        val state = preferences.state()
        if (state.isRecording) {
            runCatching { RecorderService.requestStop(this) }
                .onFailure { showStartError(it) }
            return
        }
        if (state.isBusy) return
        if (!preferences.oneDriveConnected) {
            connectOneDrive()
            return
        }
        if (!preferences.hasMicrophonePermission(this)) {
            startAfterPermission = true
            val permissions = buildList {
                add(Manifest.permission.RECORD_AUDIO)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    add(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
            permissionRequest.launch(permissions.toTypedArray())
            return
        }
        startRecorder()
    }

    private fun startRecorder() {
        runCatching { RecorderService.requestStart(this) }
            .onFailure { showStartError(it) }
    }

    private fun retryPending() {
        if (!preferences.oneDriveConnected) {
            connectOneDrive()
            return
        }
        runCatching { RecorderService.requestRetry(this) }
            .onFailure { showStartError(it) }
    }

    private fun showStartError(error: Throwable) {
        val pendingMemos = pendingStore.pendingCount()
        preferences.updateState(
            AppPreferences.Phase.ERROR,
            "Android could not start the foreground task. Open the app and try again.",
            pendingMemos,
        )
        diagnostics.report(
            MobileDiagnosticEvents.FOREGROUND_TASK_START_FAILED,
            error,
            pendingMemos,
        )
    }

    private fun connectOneDrive() {
        if (connectionInFlight || preferences.state().isBusy) return
        val pendingMemos = pendingStore.pendingCount()
        if (!oneDriveSession.isConfigured()) {
            preferences.oneDriveConnected = false
            preferences.updateState(
                AppPreferences.Phase.ERROR,
                getString(R.string.onedrive_build_not_configured),
                pendingMemos,
            )
            diagnostics.record(
                MobileDiagnosticEvents.ONEDRIVE_CONNECTION_FAILED,
                pendingMemoCount = pendingMemos,
            )
            render()
            EchoDraftWidgetUi.updateAll(this)
            return
        }

        connectionInFlight = true
        connectedBeforeSignIn = preferences.oneDriveConnected
        preferences.updateState(
            AppPreferences.Phase.IDLE,
            getString(R.string.onedrive_connecting),
            pendingMemos,
        )
        render()
        oneDriveSession.signIn(this, object : OneDriveSession.SignInCallback {
            override fun onSignedIn() {
                if (!canUpdateUi()) return
                verifyOneDriveConnection()
            }

            override fun onCancelled() {
                if (!canUpdateUi()) return
                connectionInFlight = false
                preferences.oneDriveConnected = connectedBeforeSignIn
                preferences.updateState(
                    AppPreferences.Phase.IDLE,
                    getString(R.string.onedrive_sign_in_cancelled),
                    pendingStore.pendingCount(),
                )
                render()
                EchoDraftWidgetUi.updateAll(this@MainActivity)
            }

            override fun onError(error: Throwable) {
                if (!canUpdateUi()) return
                finishConnectionFailure(error)
            }
        })
    }

    private fun verifyOneDriveConnection() {
        preferences.updateState(
            AppPreferences.Phase.IDLE,
            getString(R.string.onedrive_checking),
            pendingStore.pendingCount(),
        )
        render()
        connectionExecutor.execute {
            val result = runCatching {
                val accessToken = oneDriveSession.acquireAccessToken()
                graphApi.appRoot(accessToken)
            }
            runOnUiThread {
                if (!canUpdateUi()) return@runOnUiThread
                result.fold(
                    onSuccess = {
                        connectionInFlight = false
                        preferences.oneDriveConnected = true
                        preferences.updateState(
                            AppPreferences.Phase.IDLE,
                            getString(R.string.onedrive_connected_message),
                            pendingStore.pendingCount(),
                        )
                        diagnostics.sync()
                        render()
                        EchoDraftWidgetUi.updateAll(this)
                    },
                    onFailure = ::finishConnectionFailure,
                )
            }
        }
    }

    private fun finishConnectionFailure(error: Throwable) {
        connectionInFlight = false
        preferences.oneDriveConnected = connectedBeforeSignIn
        val pendingMemos = pendingStore.pendingCount()
        preferences.updateState(
            AppPreferences.Phase.ERROR,
            getString(R.string.onedrive_connection_failed),
            pendingMemos,
        )
        diagnostics.report(
            MobileDiagnosticEvents.ONEDRIVE_CONNECTION_FAILED,
            error,
            pendingMemos,
        )
        render()
        EchoDraftWidgetUi.updateAll(this)
    }

    private fun canUpdateUi(): Boolean = !isFinishing && !isDestroyed

    private fun requestWidgetPin() {
        val manager = AppWidgetManager.getInstance(this)
        if (!manager.isRequestPinAppWidgetSupported) return
        val provider = ComponentName(this, EchoDraftWidgetProvider::class.java)
        manager.requestPinAppWidget(provider, null, null)
    }

    private fun render() {
        val state = preferences.state()
        val connected = preferences.oneDriveConnected
        oneDriveStatus.text = getString(
            if (connected) R.string.onedrive_connected else R.string.onedrive_not_connected,
        )
        connectButton.text = getString(
            if (connected) R.string.reconnect_onedrive else R.string.connect_onedrive,
        )
        connectButton.isEnabled = !connectionInFlight && !state.isBusy
        recordingStatus.text = state.message
        recordingStatus.setTextColor(
            getColor(if (state.isRecording) R.color.echo_recording else R.color.echo_text),
        )
        recordButton.text = getString(if (state.isRecording) R.string.stop else R.string.record)
        recordButton.isEnabled = state.phase != AppPreferences.Phase.PUBLISHING && !connectionInFlight
        pendingCount.text = getString(R.string.pending_count, state.pendingCount)
        retryButton.visibility = if (state.pendingCount > 0 && !state.isBusy) View.VISIBLE else View.GONE
        retryButton.isEnabled = connected && !connectionInFlight
    }

    companion object {
        private val connectionExecutor = Executors.newSingleThreadExecutor { task ->
            Thread(task, "echodraft-onedrive-setup")
        }
    }
}
