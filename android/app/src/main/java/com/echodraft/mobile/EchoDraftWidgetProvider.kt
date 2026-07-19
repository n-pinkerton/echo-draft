package com.echodraft.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.text.format.DateFormat
import android.text.format.DateUtils
import android.view.View
import android.widget.RemoteViews
import java.util.Date

class EchoDraftWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        appWidgetIds.forEach { appWidgetId ->
            EchoDraftWidgetUi.update(context, appWidgetManager, appWidgetId)
        }
    }
}

object EchoDraftWidgetUi {
    fun updateAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        val component = ComponentName(context, EchoDraftWidgetProvider::class.java)
        manager.getAppWidgetIds(component).forEach { update(context, manager, it) }
    }

    fun update(context: Context, manager: AppWidgetManager, appWidgetId: Int) {
        val preferences = AppPreferences(context)
        var state = preferences.state()
        if (state.isBusy && !RecorderService.isRunning) {
            val pending = PendingRecordingStore.from(context).pendingCount()
            preferences.updateState(
                AppPreferences.Phase.ERROR,
                "Previous work was interrupted. Open EchoDraft to continue.",
                pending,
            )
            MobileDiagnosticReporter.from(context).record(
                MobileDiagnosticEvents.OPERATION_INTERRUPTED,
                pendingMemoCount = pending,
            )
            state = preferences.state()
        }

        // Broadcast receivers use only local cached state; authentication and Graph stay off this path.
        val setupReady = preferences.oneDriveConnected && preferences.hasMicrophonePermission(context)
        val actionMode = widgetActionMode(state.phase, setupReady)
        val views = RemoteViews(context.packageName, R.layout.echo_draft_widget)
        val lastUploadedAt = preferences.lastUploadedAtMillis
        val statusMode = widgetStatusMode(
            state.phase,
            setupReady,
            state.pendingCount,
            hasLastUpload = lastUploadedAt > 0L,
        )
        val lastUploadParts = if (statusMode == WidgetStatusMode.LAST_UPLOAD) {
            formatLastUploadedAt(context, lastUploadedAt)
        } else {
            null
        }
        val statusText = when (statusMode) {
            WidgetStatusMode.SETUP -> context.getString(R.string.widget_status_setup)
            WidgetStatusMode.STARTING -> context.getString(R.string.widget_status_starting)
            WidgetStatusMode.RECORDING -> context.getString(R.string.status_recording)
            WidgetStatusMode.PROCESSING -> context.getString(R.string.status_saving)
            WidgetStatusMode.ERROR -> context.getString(R.string.widget_status_error)
            WidgetStatusMode.PENDING -> context.getString(R.string.widget_status_pending, state.pendingCount)
            WidgetStatusMode.LAST_UPLOAD -> "${lastUploadParts!!.first} ${lastUploadParts.second}"
            WidgetStatusMode.READY -> context.getString(R.string.status_ready)
        }
        views.setTextViewText(R.id.widget_status, statusText)
        views.setInt(R.id.widget_action, "setColorFilter", context.getColor(R.color.echo_blue))
        val stateDescription = if (state.pendingCount > 0) {
            "${state.message} · ${state.pendingCount} pending"
        } else {
            state.message
        }
        views.setContentDescription(
            R.id.widget_status,
            when (statusMode) {
                WidgetStatusMode.SETUP -> widgetSetupDescription(
                    context.getString(R.string.status_setup),
                    stateDescription,
                    includeState = state.phase == AppPreferences.Phase.ERROR || state.pendingCount > 0,
                )
                WidgetStatusMode.LAST_UPLOAD -> context.getString(
                    R.string.widget_last_uploaded,
                    "${lastUploadParts!!.first} ${lastUploadParts.second}",
                )
                else -> stateDescription
            },
        )
        views.setViewVisibility(R.id.widget_action, View.VISIBLE)
        views.setViewVisibility(R.id.widget_progress, View.GONE)

        val action = when (actionMode) {
            WidgetActionMode.STOP -> {
                views.setImageViewResource(R.id.widget_action, R.drawable.ic_stop_notification)
                views.setInt(
                    R.id.widget_action,
                    "setColorFilter",
                    context.getColor(R.color.echo_recording),
                )
                views.setContentDescription(R.id.widget_action, context.getString(R.string.widget_stop))
                PendingIntent.getForegroundService(
                    context,
                    REQUEST_STOP,
                    Intent(context, RecorderService::class.java).setAction(RecorderService.ACTION_STOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }

            WidgetActionMode.PROCESSING -> {
                views.setViewVisibility(R.id.widget_action, View.GONE)
                views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
                null
            }

            WidgetActionMode.RECORD -> {
                views.setImageViewResource(R.id.widget_action, R.drawable.ic_mic_notification)
                views.setContentDescription(R.id.widget_action, context.getString(R.string.widget_record))
                PendingIntent.getForegroundService(
                    context,
                    REQUEST_START,
                    Intent(context, RecorderService::class.java).setAction(RecorderService.ACTION_START),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }

            WidgetActionMode.SETUP -> {
                views.setImageViewResource(R.id.widget_action, R.drawable.ic_mic_notification)
                views.setContentDescription(R.id.widget_action, context.getString(R.string.widget_setup))
                openAppIntent(context)
            }
        }
        action?.let { views.setOnClickPendingIntent(R.id.widget_action, it) }
        manager.updateAppWidget(appWidgetId, views)
    }

    private fun formatLastUploadedAt(context: Context, timestampMillis: Long): Pair<String, String> {
        val date = Date(timestampMillis)
        val shortDate = DateUtils.formatDateTime(
            context,
            timestampMillis,
            DateUtils.FORMAT_SHOW_DATE or
                DateUtils.FORMAT_NO_YEAR or
                DateUtils.FORMAT_NUMERIC_DATE,
        )
        val shortTime = DateFormat.getTimeFormat(context).format(date)
        return shortDate to shortTime
    }

    private fun openAppIntent(context: Context): PendingIntent =
        PendingIntent.getActivity(
            context,
            REQUEST_OPEN_APP,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private const val REQUEST_START = 51
    private const val REQUEST_STOP = 52
    private const val REQUEST_OPEN_APP = 53
}

internal enum class WidgetActionMode {
    STOP,
    PROCESSING,
    RECORD,
    SETUP,
}

internal fun widgetActionMode(
    phase: AppPreferences.Phase,
    setupReady: Boolean,
): WidgetActionMode = when (phase) {
    AppPreferences.Phase.STARTING,
    AppPreferences.Phase.RECORDING,
    -> WidgetActionMode.STOP

    AppPreferences.Phase.STOPPING,
    AppPreferences.Phase.PUBLISHING,
    -> WidgetActionMode.PROCESSING

    AppPreferences.Phase.IDLE,
    AppPreferences.Phase.ERROR,
    -> if (setupReady) WidgetActionMode.RECORD else WidgetActionMode.SETUP
}

internal enum class WidgetStatusMode {
    SETUP,
    STARTING,
    RECORDING,
    PROCESSING,
    ERROR,
    PENDING,
    LAST_UPLOAD,
    READY,
}

internal fun widgetStatusMode(
    phase: AppPreferences.Phase,
    setupReady: Boolean,
    pendingCount: Int,
    hasLastUpload: Boolean,
): WidgetStatusMode {
    if (widgetActionMode(phase, setupReady) == WidgetActionMode.SETUP) {
        return WidgetStatusMode.SETUP
    }
    return when (phase) {
        AppPreferences.Phase.STARTING -> WidgetStatusMode.STARTING
        AppPreferences.Phase.RECORDING -> WidgetStatusMode.RECORDING
        AppPreferences.Phase.STOPPING,
        AppPreferences.Phase.PUBLISHING,
        -> WidgetStatusMode.PROCESSING
        AppPreferences.Phase.ERROR -> WidgetStatusMode.ERROR
        AppPreferences.Phase.IDLE -> when {
            pendingCount > 0 -> WidgetStatusMode.PENDING
            hasLastUpload -> WidgetStatusMode.LAST_UPLOAD
            else -> WidgetStatusMode.READY
        }
    }
}

internal fun widgetSetupDescription(
    setupDescription: String,
    stateDescription: String,
    includeState: Boolean,
): String = if (includeState) "$setupDescription. $stateDescription" else setupDescription
