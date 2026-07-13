# Debug Logging

EchoDraft can capture detailed, content-minimised telemetry to a **daily JSONL log file**. Use this when diagnosing issues like delayed recording start, truncated transcripts, or cleanup/transcription mismatches.

## Enable debug logging

### Option 1: In-app toggle (recommended)

`Settings → Developer → Debug mode`

This sets `OPENWHISPR_LOG_LEVEL=debug` in the app’s userData `.env` and starts writing logs to disk immediately.

### Option 2: Command line

```bash
# macOS
/Applications/EchoDraft.app/Contents/MacOS/EchoDraft --log-level=trace

# Windows
EchoDraft.exe --log-level=trace
```

### Option 3: userData `.env`

Add (or set) and restart:

```env
OPENWHISPR_LOG_LEVEL=debug
```

## Log files & format

- **Directory**: `logs/` next to the installed executable **when writable** (preferred), otherwise `logs/` inside the app’s `userData` directory.
- **Filename**: `echodraft-debug-YYYY-MM-DD.jsonl` (local system date).
- **Format**: JSON Lines (one JSON object per line).
  - Line 1 is a `type: "header"` record (system/app details + settings snapshot placeholders).
  - Subsequent lines are structured log records with `ts`, `level`, `scope`, and `meta`.

Tip: In-app, `Settings → Developer → Open Logs Folder` shows you the exact location used on your machine.

## Debug audio captures (rolling)

When debug logging is enabled, the app also saves the **last 10 microphone recordings** (rolling retention) under `logs/audio/` so truncated-transcription reports can be diagnosed by inspecting the actual captured audio.

These files can contain sensitive information. Only enable debug logging when you need it. Use **Delete Diagnostic Data** in the Developer settings to remove EchoDraft daily logs and captured recordings from every known app log location. The cleanup preserves unrelated files and refuses linked log roots. If debug mode remains on, EchoDraft starts a fresh log after cleanup.

## What gets logged (when enabled)

Examples of the high-value telemetry captured in debug mode:

- Hotkey activity (including Windows push-to-talk key down/up)
- Dictation lifecycle (requested → recording started → stop → paste/clipboard → save)
- Per-stage pipeline timings (record/transcribe/cleanup/paste/save/total)
- Audio chunk telemetry (MediaRecorder chunks and/or streaming PCM chunks)
- Transcription and cleanup lengths, completion state, fallback reason, and timing metadata without transcript previews
- API request/response metadata. Credential-named fields and common embedded credential formats are redacted at the main logging boundary; API-key retrieval records contain presence only, never key values, prefixes, or lengths.
- Errors and warnings with stack/context

## Sharing logs

Debug logs can still contain sensitive settings and local paths, while debug audio captures contain the full recording. Share only with trusted support and redact as needed.

Do not send captured audio unless it is needed and you intend to share the recording. After support work is complete, turn off debug mode and use **Delete Diagnostic Data**.

## Disable debug logging

- Turn off `Settings → Developer → Debug mode`, or
- Remove/adjust `OPENWHISPR_LOG_LEVEL` in the userData `.env`, or
- Stop passing `--log-level=trace` on launch.
