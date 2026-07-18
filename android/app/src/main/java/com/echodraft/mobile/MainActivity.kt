package com.echodraft.mobile

import android.Manifest
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : ComponentActivity(), SharedPreferences.OnSharedPreferenceChangeListener {
    private lateinit var preferences: AppPreferences
    private lateinit var treeStore: InboxTreeStore
    private lateinit var pendingStore: PendingRecordingStore
    private lateinit var folderStatus: TextView
    private lateinit var recordingStatus: TextView
    private lateinit var pendingCount: TextView
    private lateinit var recordButton: Button
    private lateinit var retryButton: Button
    private var startAfterPermission = false

    private val folderPicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val uri = result.data?.data ?: return@registerForActivityResult
        runCatching { treeStore.persist(uri, result.data?.flags ?: 0) }
            .onSuccess {
                preferences.updateState(
                    AppPreferences.Phase.IDLE,
                    "Shared folder ready.",
                    pendingStore.pendingCount(),
                )
            }
            .onFailure {
                preferences.updateState(
                    AppPreferences.Phase.ERROR,
                    "That folder is not writable. Choose another sync folder.",
                    pendingStore.pendingCount(),
                )
            }
        render()
        EchoDraftWidgetUi.updateAll(this)
    }

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
        treeStore = InboxTreeStore(this, preferences)
        pendingStore = PendingRecordingStore.from(this)

        folderStatus = findViewById(R.id.folder_status)
        recordingStatus = findViewById(R.id.recording_status)
        pendingCount = findViewById(R.id.pending_count)
        recordButton = findViewById(R.id.record_button)
        retryButton = findViewById(R.id.retry_button)

        findViewById<Button>(R.id.choose_folder_button).setOnClickListener { chooseFolder() }
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
            preferences.updateState(
                AppPreferences.Phase.ERROR,
                "Previous work was interrupted. Any completed memo remains available to retry.",
                pendingStore.pendingCount(),
            )
        }
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
                .onFailure { showStartError() }
            return
        }
        if (state.isBusy) return
        if (!treeStore.isReady()) {
            chooseFolder()
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
            .onFailure { showStartError() }
    }

    private fun retryPending() {
        if (!treeStore.isReady()) {
            chooseFolder()
            return
        }
        runCatching { RecorderService.requestRetry(this) }
            .onFailure { showStartError() }
    }

    private fun showStartError() {
        preferences.updateState(
            AppPreferences.Phase.ERROR,
            "Android could not start the foreground task. Open the app and try again.",
            pendingStore.pendingCount(),
        )
    }

    private fun chooseFolder() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION,
        )
        folderPicker.launch(intent)
    }

    private fun requestWidgetPin() {
        val manager = AppWidgetManager.getInstance(this)
        if (!manager.isRequestPinAppWidgetSupported) return
        val provider = ComponentName(this, EchoDraftWidgetProvider::class.java)
        manager.requestPinAppWidget(provider, null, null)
    }

    private fun render() {
        val state = preferences.state()
        val root = runCatching { treeStore.requireWritableRoot() }.getOrNull()
        folderStatus.text = root?.displayName ?: getString(R.string.folder_not_selected)
        recordingStatus.text = state.message
        recordingStatus.setTextColor(
            getColor(if (state.isRecording) R.color.echo_recording else R.color.echo_text),
        )
        recordButton.text = getString(if (state.isRecording) R.string.stop else R.string.record)
        recordButton.isEnabled = state.phase != AppPreferences.Phase.PUBLISHING
        pendingCount.text = getString(R.string.pending_count, state.pendingCount)
        retryButton.visibility = if (state.pendingCount > 0 && !state.isBusy) View.VISIBLE else View.GONE
        retryButton.isEnabled = root != null
    }
}
