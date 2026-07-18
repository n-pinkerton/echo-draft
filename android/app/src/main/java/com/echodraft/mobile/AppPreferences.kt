package com.echodraft.mobile

import android.Manifest
import android.content.Context
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri

class AppPreferences(context: Context) {
    enum class Phase {
        IDLE,
        STARTING,
        RECORDING,
        STOPPING,
        PUBLISHING,
        ERROR,
    }

    data class State(
        val phase: Phase,
        val message: String,
        val pendingCount: Int,
    ) {
        val isRecording: Boolean
            get() = phase == Phase.STARTING || phase == Phase.RECORDING || phase == Phase.STOPPING

        val isBusy: Boolean
            get() = isRecording || phase == Phase.PUBLISHING
    }

    val sharedPreferences: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    var treeUri: Uri?
        get() = sharedPreferences.getString(KEY_TREE_URI, null)?.let(Uri::parse)
        set(value) {
            sharedPreferences.edit().putString(KEY_TREE_URI, value?.toString()).apply()
        }

    fun state(): State {
        val phase = runCatching {
            Phase.valueOf(sharedPreferences.getString(KEY_PHASE, Phase.IDLE.name)!!)
        }.getOrDefault(Phase.IDLE)
        return State(
            phase = phase,
            message = sharedPreferences.getString(KEY_MESSAGE, "Ready") ?: "Ready",
            pendingCount = sharedPreferences.getInt(KEY_PENDING_COUNT, 0).coerceAtLeast(0),
        )
    }

    fun updateState(phase: Phase, message: String, pendingCount: Int) {
        sharedPreferences.edit()
            .putString(KEY_PHASE, phase.name)
            .putString(KEY_MESSAGE, message.take(200))
            .putInt(KEY_PENDING_COUNT, pendingCount.coerceAtLeast(0))
            .apply()
    }

    fun hasMicrophonePermission(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    companion object {
        private const val PREFERENCES_NAME = "echo_draft_mobile"
        private const val KEY_TREE_URI = "inbox_tree_uri"
        private const val KEY_PHASE = "recording_phase"
        private const val KEY_MESSAGE = "status_message"
        private const val KEY_PENDING_COUNT = "pending_count"
    }
}
