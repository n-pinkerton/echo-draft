package com.echodraft.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class EchoDraftWidgetPresentationTest {
    @Test
    fun `stopping and publishing show processing instead of setup`() {
        listOf(false, true).forEach { setupReady ->
            assertEquals(
                WidgetActionMode.PROCESSING,
                widgetActionMode(AppPreferences.Phase.STOPPING, setupReady),
            )
            assertEquals(
                WidgetActionMode.PROCESSING,
                widgetActionMode(AppPreferences.Phase.PUBLISHING, setupReady),
            )
        }
    }

    @Test
    fun `recording phases keep the stop action`() {
        listOf(false, true).forEach { setupReady ->
            assertEquals(
                WidgetActionMode.STOP,
                widgetActionMode(AppPreferences.Phase.STARTING, setupReady),
            )
            assertEquals(
                WidgetActionMode.STOP,
                widgetActionMode(AppPreferences.Phase.RECORDING, setupReady),
            )
        }
    }

    @Test
    fun `idle and error phases retain setup gating`() {
        listOf(AppPreferences.Phase.IDLE, AppPreferences.Phase.ERROR).forEach { phase ->
            assertEquals(WidgetActionMode.RECORD, widgetActionMode(phase, setupReady = true))
            assertEquals(WidgetActionMode.SETUP, widgetActionMode(phase, setupReady = false))
        }
    }

    @Test
    fun `compact status gives active work priority`() {
        assertEquals(
            WidgetStatusMode.RECORDING,
            widgetStatusMode(
                AppPreferences.Phase.RECORDING,
                setupReady = true,
                pendingCount = 1,
                hasLastUpload = true,
            ),
        )
        assertEquals(
            WidgetStatusMode.PROCESSING,
            widgetStatusMode(
                AppPreferences.Phase.PUBLISHING,
                setupReady = false,
                pendingCount = 1,
                hasLastUpload = true,
            ),
        )
    }

    @Test
    fun `compact idle status shows pending then last upload then ready`() {
        assertEquals(
            WidgetStatusMode.PENDING,
            widgetStatusMode(
                AppPreferences.Phase.IDLE,
                setupReady = true,
                pendingCount = 1,
                hasLastUpload = true,
            ),
        )
        assertEquals(
            WidgetStatusMode.LAST_UPLOAD,
            widgetStatusMode(
                AppPreferences.Phase.IDLE,
                setupReady = true,
                pendingCount = 0,
                hasLastUpload = true,
            ),
        )
        assertEquals(
            WidgetStatusMode.READY,
            widgetStatusMode(
                AppPreferences.Phase.IDLE,
                setupReady = true,
                pendingCount = 0,
                hasLastUpload = false,
            ),
        )
    }

    @Test
    fun `compact status keeps setup and errors actionable`() {
        assertEquals(
            WidgetStatusMode.SETUP,
            widgetStatusMode(
                AppPreferences.Phase.IDLE,
                setupReady = false,
                pendingCount = 0,
                hasLastUpload = false,
            ),
        )
        assertEquals(
            WidgetStatusMode.ERROR,
            widgetStatusMode(
                AppPreferences.Phase.ERROR,
                setupReady = true,
                pendingCount = 1,
                hasLastUpload = true,
            ),
        )
    }

    @Test
    fun `setup accessibility keeps underlying errors and pending details`() {
        assertEquals(
            "Open the app to finish setup. Recording could not be saved · 1 pending",
            widgetSetupDescription(
                "Open the app to finish setup",
                "Recording could not be saved · 1 pending",
                includeState = true,
            ),
        )
        assertEquals(
            "Open the app to finish setup",
            widgetSetupDescription(
                "Open the app to finish setup",
                "Ready",
                includeState = false,
            ),
        )
    }
}
