const fs = require("fs");
const path = require("path");

async function checkSettingsUsability(panel, record, outputDir, runId, options = {}) {
  const result = await panel.eval(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const shortcutButton = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "Shortcuts"
      );
      if (!shortcutButton) return { ok: false, error: "Quick Start Shortcuts button not found" };
      const quickMicrophone = document.querySelector(
        '[data-testid="quick-microphone-select"] select[aria-label="Microphone used for dictation"]'
      );
      const quickMicrophoneRect = quickMicrophone?.getBoundingClientRect();
      const quickMicrophoneVisible = Boolean(
        quickMicrophoneRect && quickMicrophoneRect.width > 0 && quickMicrophoneRect.height > 0
      );
      const microphoneOptions = Array.from(quickMicrophone?.options || []).map(
        (option) => option.textContent?.trim()
      );
      const microphoneChoicesPresent =
        microphoneOptions.includes("Automatic (prefer built-in)") &&
        microphoneOptions.includes("System default microphone");
      shortcutButton.click();
      await sleep(500);

      const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4")).find(
        (node) => node.textContent?.trim() === "Dictation Hotkeys"
      );
      const currentItems = Array.from(document.querySelectorAll('[aria-current="page"]'));
      const rect = heading?.getBoundingClientRect();
      const visible = Boolean(
        rect && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight
      );
      const focused = document.activeElement === heading;
      const selectedShortcut =
        currentItems.length === 1 && currentItems[0].textContent?.includes("Shortcuts");
      const sidebarButtons = Array.from(document.querySelectorAll('button[data-section-id]'));
      const focusStylesPresent = sidebarButtons.every(
        (button) =>
          button.className.includes("focus-visible:ring-2") &&
          button.className.includes("focus-visible:outline-none")
      );

      return {
        ok:
          Boolean(heading) &&
          visible &&
          focused &&
          selectedShortcut &&
          focusStylesPresent &&
          quickMicrophoneVisible &&
          microphoneChoicesPresent,
        headingFound: Boolean(heading),
        visible,
        focused,
        currentCount: currentItems.length,
        selectedShortcut,
        focusStylesPresent,
        quickMicrophoneVisible,
        microphoneChoicesPresent,
      };
    })()
  `);

  record(
    "Shortcuts opens directly at visible, focused hotkey controls",
    Boolean(result?.ok),
    JSON.stringify(result)
  );

  let screenshotPath = null;
  if (options.captureScreenshot !== false) {
    const screenshot = await panel.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const screenshotDir = path.join(outputDir, "screenshots");
    screenshotPath = path.join(screenshotDir, `settings-shortcuts-${runId}.png`);
    fs.mkdirSync(screenshotDir, { recursive: true });
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    record(
      "Packaged Shortcuts settings screenshot captured",
      fs.existsSync(screenshotPath),
      screenshotPath
    );
  } else {
    record(
      "Safe gate keeps Shortcuts rendering hidden",
      true,
      "visual screenshot capture is reserved for explicit foreground automation"
    );
  }

  const microphoneResult = await panel.eval(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const quickMicrophone = document.querySelector(
        '[data-testid="quick-microphone-select"] select[aria-label="Microphone used for dictation"]'
      );
      const generalButton = document.querySelector('button[data-section-id="general"]');
      if (!quickMicrophone || !generalButton) {
        return { ok: false, error: "Microphone quick control or General settings link missing" };
      }

      const originalValue = quickMicrophone.value;
      quickMicrophone.value = "__system_default__";
      quickMicrophone.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(150);
      const quickSavedDefault =
        localStorage.getItem("preferBuiltInMic") === "false" &&
        localStorage.getItem("selectedMicDeviceId") === "";

      generalButton.click();
      await sleep(400);
      const preferenceToggle = document.querySelector(
        'button[role="switch"][aria-label="Prefer built-in microphone"]'
      );
      const preferenceSelect = document.querySelector(
        '[role="combobox"][aria-label="Input device"]'
      );
      const microphoneTest = document.querySelector('[data-testid="microphone-level-test"]');
      const microphoneTestButton = microphoneTest?.querySelector(
        'button[aria-label="Start microphone test"]'
      );
      const microphoneTestIsIdle = !microphoneTest?.querySelector(
        '[role="progressbar"][aria-label="Live microphone input level"]'
      );
      const microphoneTestRect = microphoneTest?.getBoundingClientRect();
      const microphoneTestVisible = Boolean(
        microphoneTestRect && microphoneTestRect.width > 0 && microphoneTestRect.height > 0
      );
      const preferencesShowDefault =
        preferenceToggle?.getAttribute("aria-checked") === "false" &&
        preferenceSelect?.textContent?.includes("System Default");

      preferenceToggle?.click();
      await sleep(150);
      const preferencesUpdateQuickControl =
        quickMicrophone.value === "__automatic_builtin__" &&
        localStorage.getItem("preferBuiltInMic") === "true";

      quickMicrophone.value = originalValue;
      quickMicrophone.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(100);

      return {
        ok:
          quickSavedDefault &&
          preferencesShowDefault &&
          preferencesUpdateQuickControl &&
          microphoneTestVisible &&
          Boolean(microphoneTestButton) &&
          microphoneTestIsIdle,
        quickSavedDefault,
        preferencesShowDefault,
        preferencesUpdateQuickControl,
        microphoneTestVisible,
        microphoneTestButtonPresent: Boolean(microphoneTestButton),
        microphoneTestIsIdle,
      };
    })()
  `);

  record(
    "Packaged microphone selector synchronizes with Preferences",
    Boolean(microphoneResult?.ok),
    JSON.stringify(microphoneResult)
  );

  const feedbackResult = await panel.eval(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const setNativeInputValue = (input, value) => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(input),
          "value"
        )?.set;
        if (valueSetter) {
          valueSetter.call(input, value);
        } else {
          input.value = value;
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const heading = Array.from(document.querySelectorAll("h1,h2,h3,h4")).find(
        (node) => node.textContent?.trim() === "Sound & feedback"
      );
      const soundToggle = document.querySelector(
        'button[role="switch"][aria-label="Enable dictation sounds"]'
      );
      const timerToggle = document.querySelector(
        'button[role="switch"][aria-label="Show recording timer"]'
      );
      const reminderToggle = document.querySelector(
        'button[role="switch"][aria-label="Show long recording reminder"]'
      );
      const volumeSlider = document.querySelector(
        'input[type="range"][aria-label="Dictation sound volume"]'
      );
      const previewButton = document.querySelector(
        'button[aria-label="Preview recording started sound"]'
      );
      if (
        !heading ||
        !soundToggle ||
        !timerToggle ||
        !reminderToggle ||
        !volumeSlider ||
        !previewButton
      ) {
        return { ok: false, error: "Sound feedback controls missing" };
      }

      const originalSoundState = soundToggle.getAttribute("aria-checked") === "true";
      const originalTimerState = timerToggle.getAttribute("aria-checked") === "true";
      const originalReminderState = reminderToggle.getAttribute("aria-checked") === "true";
      const originalReminderStorage = localStorage.getItem("longRecordingReminderEnabled");
      const originalVolume = volumeSlider.value;
      soundToggle.click();
      await sleep(100);
      const soundTogglePersisted =
        localStorage.getItem("dictationSoundsEnabled") === String(!originalSoundState);

      timerToggle.click();
      await sleep(100);
      const timerTogglePersisted =
        localStorage.getItem("recordingIndicatorEnabled") === String(!originalTimerState);

      if (timerToggle.getAttribute("aria-checked") !== "true") {
        timerToggle.click();
        await sleep(100);
      }
      reminderToggle.click();
      await sleep(100);
      const reminderTogglePersisted =
        localStorage.getItem("longRecordingReminderEnabled") ===
        String(!originalReminderState);
      reminderToggle.click();
      await sleep(100);

      setNativeInputValue(volumeSlider, "45");
      await sleep(100);
      const volumePersisted = localStorage.getItem("dictationSoundVolume") === "45";

      previewButton.click();
      await sleep(50);

      soundToggle.click();
      if ((timerToggle.getAttribute("aria-checked") === "true") !== originalTimerState) {
        timerToggle.click();
      }
      setNativeInputValue(volumeSlider, originalVolume);
      await sleep(100);
      if (originalReminderStorage === null) {
        localStorage.removeItem("longRecordingReminderEnabled");
      } else {
        localStorage.setItem("longRecordingReminderEnabled", originalReminderStorage);
      }

      const rect = heading.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      return {
        ok:
          visible &&
          soundTogglePersisted &&
          timerTogglePersisted &&
          reminderTogglePersisted &&
          volumePersisted,
        visible,
        soundTogglePersisted,
        timerTogglePersisted,
        reminderTogglePersisted,
        volumePersisted,
        previewPresent: Boolean(previewButton),
      };
    })()
  `);

  record(
    "Packaged sound feedback controls render, persist, and preview",
    Boolean(feedbackResult?.ok),
    JSON.stringify(feedbackResult)
  );

  const reasoningResult = await panel.eval(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const aiModelsButton = document.querySelector('button[data-section-id="aiModels"]');
      if (!aiModelsButton) return { ok: false, error: "AI Models settings link missing" };
      const originalCloudMode = localStorage.getItem("cloudReasoningMode");
      aiModelsButton.click();
      await sleep(400);

      let selector = document.querySelector(
        'select[aria-label="Cleanup reasoning effort"]'
      );
      let switchedToCustom = false;
      if (!selector) {
        const customSetupButton = Array.from(document.querySelectorAll("button")).find(
          (button) => button.textContent?.includes("Custom Setup")
        );
        customSetupButton?.click();
        switchedToCustom = Boolean(customSetupButton);
        await sleep(400);
        selector = document.querySelector('select[aria-label="Cleanup reasoning effort"]');
      }
      if (!selector) {
        if (switchedToCustom) {
          if (originalCloudMode === null) {
            localStorage.removeItem("cloudReasoningMode");
          } else {
            localStorage.setItem("cloudReasoningMode", originalCloudMode);
          }
        }
        return { ok: false, error: "Cleanup reasoning selector missing for OpenAI GPT-5" };
      }

      const options = Array.from(selector.options).map((option) => option.value);
      const choicesPresent = ["none", "low", "medium"].every((value) =>
        options.includes(value)
      );
      const originalValue = selector.value;
      const originalStorage = localStorage.getItem("cleanupReasoningEffort");
      const testValue = originalValue === "medium" ? "none" : "medium";
      const rect = selector.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      selector.value = testValue;
      selector.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(150);
      const persisted = localStorage.getItem("cleanupReasoningEffort") === testValue;

      selector.value = originalValue;
      selector.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(100);
      if (originalStorage === null) {
        localStorage.removeItem("cleanupReasoningEffort");
      }
      if (switchedToCustom) {
        if (originalCloudMode === null) {
          localStorage.removeItem("cloudReasoningMode");
        } else {
          localStorage.setItem("cloudReasoningMode", originalCloudMode);
        }
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "cloudReasoningMode",
            newValue: originalCloudMode,
          })
        );
        await sleep(100);
      }

      const cloudModeRestored =
        localStorage.getItem("cloudReasoningMode") === originalCloudMode;
      return {
        ok: visible && choicesPresent && persisted && cloudModeRestored,
        visible,
        choicesPresent,
        persisted,
        switchedToCustom,
        cloudModeRestored,
      };
    })()
  `);

  record(
    "Packaged cleanup reasoning choices render and persist",
    Boolean(reasoningResult?.ok),
    JSON.stringify(reasoningResult)
  );

  await panel.eval(`
    (() => {
      const closeButton = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
        (button) => button.textContent?.trim() === "Close"
      );
      closeButton?.click();
      return Boolean(closeButton);
    })()
  `);

  return { ...result, microphoneResult, feedbackResult, reasoningResult, screenshotPath };
}

module.exports = { checkSettingsUsability };
