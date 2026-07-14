# Windows Troubleshooting

## Quick Fixes

### No Window Appears

**Symptoms:** EchoDraft runs in Task Manager but no window shows

**Solutions:**

1. Check the system tray. On Windows, EchoDraft may be under the hidden-icons `^` caret until you pin it.
2. To keep it visible, right-click the taskbar → Taskbar settings → Other system tray icons, then enable EchoDraft or drag EchoDraft from the hidden-icons menu into the visible tray.
3. If Windows shows `Electron` instead of `EchoDraft`, install the latest EchoDraft build and restart the app; older builds shipped generic Electron executable metadata that Windows can cache in this list.
4. Click the EchoDraft tray icon for status, copy-last, dictation, Control Panel, and quit actions.
5. Run with debug: `EchoDraft.exe --log-level=debug`
6. Try disabling GPU: `EchoDraft.exe --disable-gpu`

### No Transcriptions

**Symptoms:** Recording works but no text appears

**Solutions:**

1. Check microphone permissions: Settings → Privacy → Microphone
2. Verify mic is selected: Sound settings → Input
3. Test recording in Windows Voice Recorder first

### Automatic Insertion Failed but the Clipboard Worked

**Symptoms:** EchoDraft finishes a dictation and copies the text, but it does not appear at the original cursor.

**Meaning:** Transcription succeeded, but Windows rejected or could not authenticate the insertion target. EchoDraft preserves the result on the clipboard instead of discarding it. Current builds also record a content-free delivery reason code in the history item so this can be diagnosed without logging dictated text.

**Solutions:**

1. Install the latest EchoDraft build; version 1.4.10 corrects a 64-bit Windows input-layout error that could make every simulated Ctrl+V fail.
2. Keep the target app open while the dictation processes. If its window or process restarts, EchoDraft will not inject into the replacement window.
3. Open the history item and check its delivery detail. The text remains available there and on the clipboard after a safe fallback.
4. If failures continue, reproduce once with debug logging enabled and report the delivery reason code; the transcript itself is not needed.

### A Dictation Hotkey Stops Responding

**Symptoms:** A configured shortcut worked earlier but no longer starts dictation, or one press starts and immediately stops recording.

**Solutions:**

1. Install the latest EchoDraft build. Current builds use a focus-independent, repeat-safe Windows route for tap shortcuts and automatically recover shortcuts after resume, workstation unlock, or an unexpected native-listener exit.
2. Open Settings → General → Hotkeys and confirm both displayed shortcuts. Choose a supported single key or chord if a warning appears.
3. Lock and unlock Windows once, then test the shortcut again. EchoDraft should re-register both routes automatically.
4. If it still fails, enable debug mode, reproduce once, and use Settings → Developer → Open Logs Folder. Look for hotkey registration or native-listener status entries; transcript content is not required.

Tap shortcuts continue through ordinary and elevated focus changes. Push-to-talk and modifier-only shortcuts still require the native key-up listener; if one of those behaves differently only over an elevated application, switch temporarily to tap mode and include the listener status entries in the report.

### Cleanup Kept the Original Text

**Symptoms:** History shows **Original preserved**, or the text has punctuation unchanged.

**Meaning:** Check the cleanup detail in History. **Safety check rejected the rewrite** means every cleanup candidate that actually ran failed preservation checks, so EchoDraft kept the recognizer wording. The only permitted fallback edit is an independently verified, dictionary-backed person-name spelling; the raw transcript remains visible in History. Managed EchoDraft Cloud cleanup currently makes one candidate request. OpenAI BYOK can also make one token-locked retry on the selected model and effort; History says **Safety retry: not applied** only when that second pass ran and was rejected. **Needs setup**, **provider unavailable**, and **request failed** instead identify configuration, availability, or provider errors; they do not mean the text itself failed a fidelity check.

**Solutions:**

1. Open the history item’s cleanup details and note the specific fallback reason.
2. For setup, availability, or request failures, confirm the selected model, API key, and network connection in Settings → AI Models.
3. For repeated preservation rejections on Luna, try Low reasoning if the faster None setting falls back too often, or try GPT-5.6 Terra or Sol, then dictate again. A rejected model rewrite is never delivered; the raw transcript remains available in History.

### Microphone Too Quiet

**Symptoms:** EchoDraft reports that the selected microphone is too quiet or not receiving speech, or transcripts are only punctuation/very short phrases despite a normal-length recording.

**Meaning:** The app received a real recording, but the decoded audio level was near silent before transcription. This often points to the wrong input device, a muted/low-gain USB mic, a bad USB connection, or a Windows audio driver issue.

**Solutions:**

1. Open Settings → System → Sound → Input and confirm the intended microphone is selected.
2. Raise the input volume/gain and use "Test your microphone" in Windows Sound settings.
3. Unplug/replug the mic, preferably into a different USB port.
4. If Windows Voice Recorder crashes or also records silence, reinstall or remove/re-detect the USB audio device in Device Manager.
5. Temporarily select another microphone in EchoDraft to confirm the issue is device-specific.

### whisper.cpp Not Working

**Symptoms:** Local transcription fails

**Solutions:**

1. whisper.cpp is bundled with the app - try reinstalling
2. If running from source, run `npm run download:whisper-cpp` and confirm `resources\\bin\\whisper-cpp-win32-x64.exe` exists
3. Check antivirus isn't blocking the whisper-cpp executable
4. Clear model cache: delete `%USERPROFILE%\.cache\echodraft\whisper-models`
5. Try cloud mode as fallback

### FFmpeg Issues

**Symptoms:** Transcription fails silently

**Solutions:**

1. Reinstall EchoDraft (FFmpeg is bundled)
2. Check antivirus isn't quarantining FFmpeg
3. Install system FFmpeg and add to PATH if needed

## Debug Mode

```batch
# Run with debug logging
EchoDraft.exe --log-level=debug

# Or set in .env file at %APPDATA%\echodraft\.env
OPENWHISPR_LOG_LEVEL=debug
```

Use Settings → Developer → Open Logs Folder to open the active log location.

## Common Errors

| Error                 | Meaning                   | Fix                                  |
| --------------------- | ------------------------- | ------------------------------------ |
| Audio buffer empty    | Mic not capturing         | Check permissions, try different mic |
| whisper.cpp not found | Binary not accessible     | Reinstall app, check antivirus       |
| FFmpeg not found      | Can't find FFmpeg         | Reinstall app, check antivirus       |
| Model download failed | Can't download GGML model | Check internet; try cloud mode       |

## Windows-Specific Tips

### Windows Defender

Add EchoDraft to exclusions if blocked:
Settings → Virus & threat protection → Exclusions

### Firewall (Cloud Mode)

Allow EchoDraft through firewall for cloud transcription

### Permission Errors

Right-click → Run as administrator (or set in Properties → Compatibility)

## Complete Reset

```batch
# Uninstall EchoDraft first, then:
rd /s /q "%APPDATA%\EchoDraft"
rd /s /q "%LOCALAPPDATA%\EchoDraft"
```

Then reinstall.

## Getting Help

Report issues at https://github.com/n-pinkerton/echo-draft/issues with:

- Windows version (`winver`)
- EchoDraft version
- Debug log contents
- Steps to reproduce
