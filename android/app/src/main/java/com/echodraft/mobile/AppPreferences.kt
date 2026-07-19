package com.echodraft.mobile

import android.Manifest
import android.content.Context
import android.content.Intent
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

    init {
        migrateLegacySaf(context.applicationContext)
    }

    var oneDriveConnected: Boolean
        get() = sharedPreferences.getBoolean(KEY_ONEDRIVE_CONNECTED, false)
        set(value) {
            sharedPreferences.edit().putBoolean(KEY_ONEDRIVE_CONNECTED, value).apply()
        }

    var lastUploadedAtMillis: Long
        get() = sharedPreferences.getLong(KEY_LAST_UPLOADED_AT_MILLIS, 0L).coerceAtLeast(0L)
        set(value) {
            sharedPreferences.edit().putLong(KEY_LAST_UPLOADED_AT_MILLIS, value.coerceAtLeast(0L)).apply()
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

    private fun migrateLegacySaf(context: Context) {
        if (
            sharedPreferences.contains(KEY_LEGACY_SAF_CLEANUP_PENDING) &&
            !sharedPreferences.getBoolean(KEY_LEGACY_SAF_CLEANUP_PENDING, true)
        ) {
            return
        }

        val legacyUri = runCatching { sharedPreferences.getString(LEGACY_TREE_URI, null) }.getOrNull()
        val permissionReleased = legacyUri == null || runCatching {
            val uri = Uri.parse(legacyUri)
            val permission = context.contentResolver.persistedUriPermissions.firstOrNull {
                it.uri == uri
            }
            if (permission != null) {
                var flags = 0
                if (permission.isReadPermission) {
                    flags = flags or Intent.FLAG_GRANT_READ_URI_PERMISSION
                }
                if (permission.isWritePermission) {
                    flags = flags or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                }
                if (flags != 0) context.contentResolver.releasePersistableUriPermission(uri, flags)
            }
        }.isSuccess
        val recoveryCleared = runCatching {
            context.getSharedPreferences(LEGACY_RECOVERY_PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .commit()
        }.getOrDefault(false)

        if (permissionReleased && recoveryCleared) {
            val completed = sharedPreferences.edit()
                .remove(LEGACY_TREE_URI)
                .putBoolean(KEY_LEGACY_SAF_CLEANUP_PENDING, false)
                .commit()
            if (!completed) {
                sharedPreferences.edit().putBoolean(KEY_LEGACY_SAF_CLEANUP_PENDING, true).apply()
            }
        } else {
            sharedPreferences.edit().putBoolean(KEY_LEGACY_SAF_CLEANUP_PENDING, true).apply()
        }
    }

    companion object {
        private const val PREFERENCES_NAME = "echo_draft_mobile"
        private const val KEY_ONEDRIVE_CONNECTED = "onedrive_connected"
        private const val KEY_LAST_UPLOADED_AT_MILLIS = "last_uploaded_at_millis"
        private const val LEGACY_TREE_URI = "inbox_tree_uri"
        private const val LEGACY_RECOVERY_PREFERENCES = "mobile_publication_recovery"
        private const val KEY_LEGACY_SAF_CLEANUP_PENDING = "legacy_saf_cleanup_pending"
        private const val KEY_PHASE = "recording_phase"
        private const val KEY_MESSAGE = "status_message"
        private const val KEY_PENDING_COUNT = "pending_count"
    }
}
