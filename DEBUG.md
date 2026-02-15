# Debug Logging

OpenWhispr can capture detailed telemetry (including transcript text) to a **daily JSONL log file**. Use this when diagnosing issues like delayed recording start, truncated transcripts, or cleanup/transcription mismatches.

## Enable debug logging

### Option 1: In-app toggle (recommended)

`Settings → Developer → Debug mode`

This sets `OPENWHISPR_LOG_LEVEL=trace` in the app’s userData `.env` and starts writing logs to disk immediately.

### Option 2: Command line

```bash
# macOS
/Applications/OpenWhispr.app/Contents/MacOS/OpenWhispr --log-level=trace

# Windows
OpenWhispr.exe --log-level=trace
```

### Option 3: userData `.env`

Add (or set) and restart:

```env
OPENWHISPR_LOG_LEVEL=trace
```

## Log files & format

- **Directory**: `logs/` next to the installed executable **when writable** (preferred), otherwise `logs/` inside the app’s `userData` directory.
- **Filename**: `openwhispr-debug-YYYY-MM-DD.jsonl` (local system date).
- **Format**: JSON Lines (one JSON object per line).
  - Line 1 is a `type: "header"` record (system/app details + settings snapshot placeholders).
  - Subsequent lines are structured log records with `ts`, `level`, `scope`, and `meta`.

Tip: In-app, `Settings → Developer → Open Logs Folder` shows you the exact location used on your machine.

## What gets logged (when enabled)

Examples of the high-value telemetry captured in debug mode:

- Hotkey activity (including Windows push-to-talk key down/up)
- Dictation lifecycle (requested → recording started → stop → paste/clipboard → save)
- Per-stage pipeline timings (record/transcribe/cleanup/paste/save/total)
- Audio chunk telemetry (MediaRecorder chunks and/or streaming PCM chunks)
- Transcription outputs (raw + cleaned text) at `trace` level
- API request/response metadata (never logs API keys)
- Errors and warnings with stack/context

## Sharing logs

Debug logs may contain sensitive text (transcripts and settings). Share only with trusted support and redact as needed.

## Disable debug logging

- Turn off `Settings → Developer → Debug mode`, or
- Remove/adjust `OPENWHISPR_LOG_LEVEL` in the userData `.env`, or
- Stop passing `--log-level=trace` on launch.
