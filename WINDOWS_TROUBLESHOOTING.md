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

### A Dictation Hotkey Stops Responding

**Symptoms:** A configured shortcut worked earlier but no longer starts dictation, or one press starts and immediately stops recording.

**Solutions:**

1. Install the latest EchoDraft build. Current builds suppress Windows key-repeat toggles and automatically recover shortcuts after resume, workstation unlock, or an unexpected native-listener exit.
2. Open Settings → General → Hotkeys and confirm both displayed shortcuts. Choose a supported single key or chord if a warning appears.
3. Lock and unlock Windows once, then test the shortcut again. EchoDraft should re-register both routes automatically.
4. If it still fails, enable debug mode, reproduce once, and use Settings → Developer → Open Logs Folder. Look for hotkey registration or native-listener status entries; transcript content is not required.

### Cleanup Kept the Original Text

**Symptoms:** History shows **Original preserved**, or the text has punctuation unchanged.

**Meaning:** EchoDraft could not safely verify the AI cleanup. It keeps the complete raw transcript instead of accepting possible summarisation, changed polarity, prompt execution, or lost details.

**Solutions:**

1. Confirm an OpenAI cleanup model and key are configured in Settings → AI Models.
2. Try GPT-5.6 Terra or Sol, then dictate again.
3. If this repeats, open the history item’s cleanup details for the safe fallback reason. The original transcript remains available and is never replaced by a rejected cleanup.

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
