# EchoDraft Fix Plan (Scratchpad)

Date: 2026-02-16
Status: In Progress

## Issue 1 — Intermittent partial transcript truncation

### A) Investigate + baseline
- [x] Read latest log files in `C:\Users\NigelPinkerton\AppData\Local\Programs\EchoDraft\logs`.
- [x] Confirm `72c21aa6` / `cae59e8a` / `0e5a79dd` session sequence in `openwhispr-debug-2026-02-16.jsonl`.
- [x] Confirm stop event with different session id appears while a recording is active.
- [x] Confirm non-streaming stop path writes `Recording stopped` and enqueues one processing job in `audioManager.start/stop` flow.

### B) Code changes
- [x] Add explicit non-streaming stop-in-progress lock in `AudioManager` to prevent stop/start races.
- [x] Add a short, logged flush window before blob creation on non-streaming stop to reduce missing final chunk.
- [x] Reset lock and stop state in `onstop` path, including completion metadata (`stopFlushMs`, `chunksBeforeStop`, `chunksAfterStopWait`).
- [x] Add mismatch logging in `performStopRecording` for stop payload session-id drift.

### C) Validation
- [x] Add/keep stop instrumentation fields in logs (`recordingContext`, `chunksCount`, `stopLatencyMs`, `stopFlushMs`, `stopInProgress`).
- [ ] Perform 2+ long dictations with alternating start/stop and compare: complete job `rawLength` and `outputTextLength` per session.
  - One full end-to-end session observed in `openwhispr-debug-2026-02-16.jsonl` with:
    - `1x Dictation start requested`
    - `1x Dictation stop requested` (`stopSessionMismatch=true`)
    - `1x Dictation transcription complete` (`rawLength:766`, `cleanedLength:782`)
    - stop instrumentation present: `stopFlushMs:65`, `chunksBeforeStopWait:2`, `chunksAfterStopWait:2`.

### D) Repro verification against current logs
- [x] Confirm this log file lacks new flush metadata because it was produced before rebuilt binary.
- [x] Re-run this repro check after reinstall from patched Windows build to verify `stopFlushMs` and `stopSession` mismatch instrumentation.
- [x] Run `npm test src/helpers/__tests__/audioManager.test.ts`.
- [x] Run `npm test src/helpers/__tests__/audioManagerCallbacks.test.ts`.

## Issue 2 — Settings restart drift (debug mode + persistence)

### A) Code changes
- [x] Make env persistence calls from `set-debug-logging` return write status and propagate failure up.
- [x] Harden env-write queue in `EnvironmentManager` to surface failures (not silently drop async writes).
- [x] Read debug state at renderer bootstrap (`src/main.jsx`) and persist `debugLoggingEnabled` in localStorage.
- [x] Add renderer-side startup reconciliation so debug state is restored even if startup IPC is delayed (localStorage fallback + refresh level).
- [x] Log/handle file-write errors for `saveDebugLogLevel` and `saveAllKeysToEnv` calls.

### B) Validation
- [ ] Toggle debug on/off, close app, and reopen 2 times.
- [ ] Verify `DeveloperSection` initial checkbox state and `get-debug-state` values match previous run.
- [ ] Verify `.env` contains `OPENWHISPR_LOG_LEVEL` with chosen value after each toggle.

### C) Bootstrap validation
- [x] Verify renderer startup now reconciles localStorage key `openwhisprDebugEnabled` with persisted debug state and re-syncs to main process.
- [x] Capture a post-rebuild log proving this path runs on real startup after restart.
  - `openwhispr-debug-2026-02-16.jsonl` shows startup `Renderer settings snapshot` in both windows with `openwhisprDebugEnabled:"true"`.

## Issue 3 — Windows rebuild / in-place upgrade

### A) Build execution
- [x] Export repo to Windows path and run `npm ci` on Windows.
- [x] Run `npm run build:win`.
- [x] Capture output `.exe` filenames from `dist`:
  - `EchoDraft Setup 1.4.5.exe`
  - `EchoDraft 1.4.5.exe`
- [x] Install/reinstall from `EchoDraft Setup 1.4.5.exe` via `/S` and confirmed exit code 0.
- [ ] Run one full and one short dictation test in installed app.
  - Completed 1 full test in this run: transcript complete, no truncation observed.
- [ ] Confirm debug setting and transcript completeness post-upgrade.

### B) Post-build check items
- [x] Keep installer filename + version in notes.
- [ ] Capture if restart drift or truncation appears after rebuild.

### C) Final pass completion
- [x] Copy latest Windows installer to `C:\Users\NigelPinkerton\Downloads`.
  - Confirmed `EchoDraft Setup 1.4.5.exe` exists at: `/mnt/c/Users/NigelPinkerton/Downloads/EchoDraft Setup 1.4.5.exe` (131139262 bytes, timestamp 2026-02-16 11:04).
