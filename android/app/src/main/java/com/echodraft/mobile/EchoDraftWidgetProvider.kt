package com.echodraft.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

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

        // Broadcast receivers must not synchronously query a potentially remote document provider.
        val folderReady = InboxTreeStore(context, preferences).hasPersistedAccess()
        val setupReady = folderReady && preferences.hasMicrophonePermission(context)
        val views = RemoteViews(context.packageName, R.layout.echo_draft_widget)
        views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_title))
        views.setTextViewText(
            R.id.widget_status,
            if (state.pendingCount > 0) "${state.message} · ${state.pendingCount} pending" else state.message,
        )

        val action: PendingIntent
        when {
            state.isRecording -> {
                views.setTextViewText(R.id.widget_action, context.getString(R.string.widget_stop))
                action = PendingIntent.getForegroundService(
                    context,
                    REQUEST_STOP,
                    Intent(context, RecorderService::class.java).setAction(RecorderService.ACTION_STOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }

            state.phase == AppPreferences.Phase.PUBLISHING -> {
                views.setTextViewText(R.id.widget_action, context.getString(R.string.widget_open))
                action = openAppIntent(context)
            }

            setupReady -> {
                views.setTextViewText(R.id.widget_action, context.getString(R.string.widget_record))
                action = PendingIntent.getForegroundService(
                    context,
                    REQUEST_START,
                    Intent(context, RecorderService::class.java).setAction(RecorderService.ACTION_START),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            }

            else -> {
                views.setTextViewText(R.id.widget_action, context.getString(R.string.widget_open))
                views.setTextViewText(R.id.widget_status, context.getString(R.string.status_setup))
                action = openAppIntent(context)
            }
        }
        views.setOnClickPendingIntent(R.id.widget_action, action)
        manager.updateAppWidget(appWidgetId, views)
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
