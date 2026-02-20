# EchoDraft Scratchpad

Date: 2026-02-19
Status: In Progress

## AudioManager Refactor (SOLID + Maintainability)

### Context / Why this work matters
- `src/helpers/audioManager.js` is ~3.3k lines and currently mixes responsibilities:
  - microphone constraints + warmup + permission heuristics
  - non-streaming recording (MediaRecorder)
  - streaming recording (AudioWorklet + AssemblyAI websocket via IPC)
  - transcription provider routing (local Whisper/Parakeet, EchoDraft Cloud, BYOK OpenAI/Groq/Mistral/custom)
  - OpenAI SSE parsing for streaming STT
  - audio optimization + WAV conversion helpers
  - reasoning/cleanup orchestration
  - persistence helpers (safe paste, save history)
  - debug-only instrumentation (trace logs, debug audio capture)
- This makes changes risky, increases bug surface area (hidden coupling), and makes contract-style testing difficult.

### Goals (acceptance criteria)
- Split responsibilities into focused modules (single responsibility, clear boundaries, dependency injection where helpful).
- Reduce file sizes to “reviewable” chunks:
  - `src/helpers/audioManager.js` becomes a small orchestrator (target: < ~400 LoC).
  - New modules should also stay in the same ballpark (prefer < ~400 LoC each).
- Keep public contract stable for `useAudioRecording` and `ControlPanel`:
  - `AudioManager` API and callbacks must continue to behave equivalently.
- Add tests that enforce the contracts for every new/changed module (as practical):
  - Pure logic fully unit tested.
  - Side-effectful boundaries tested via mocks (MediaRecorder, fetch, IPC bridges).
- Add JSDoc on module boundaries and cross references to make intent obvious.

### Non-goals (explicitly out of scope unless needed)
- Full repo-wide 100% coverage (this is a large Electron app; we focus on the audio subsystem contract + pure logic).
- Rewriting the UI stage machine in `useAudioRecording` (we’ll keep its contract stable).

### Proposed module split (target structure)
- `src/helpers/audio/`
  - `contracts.ts` (JSDoc/TS types for shared shapes: processing context, progress events, result payloads)
  - `microphone/` (constraints + warmup + caching)
  - `recording/` (non-streaming MediaRecorder controller)
  - `streaming/` (AssemblyAI streaming controller + worklet)
  - `transcription/` (routing + provider implementations)
  - `reasoning/` (cleanup orchestration)
  - `debug/` (debug audio capture client + helpers)

### Execution plan
1) Inventory and lock down the existing `AudioManager` contract with tests (public methods + key behaviors).
2) Extract pure helpers first (word counting, dictionary prompt echo detection, SSE parsing) + add unit tests.
3) Extract transcription providers (local whisper/parakeet, EchoDraft Cloud, BYOK OpenAI) into dependency-injected modules + add tests with mocked fetch/IPC.
4) Extract recording controllers:
   - Non-streaming MediaRecorder controller
   - AssemblyAI streaming controller
   Add contract tests with fakes/mocks (no real mic/audio needed).
5) Replace `audioManager.js` with a thin orchestrator that composes these modules.
6) Run full test suite + fix regressions; ensure module sizes stay within targets.
7) Rebuild Windows installer (`npm run build:win` from Windows) + copy to Downloads.
8) Commit + push (keep scratchpad updated throughout).

---

### Progress log
- [x] Investigated “I have also provided…” truncation report:
  - Source of truth is the SQLite DB at `C:\Users\NigelPinkerton\AppData\Roaming\open-whispr\transcriptions.db`.
    - Query used (WSL): `python3 -c "…sqlite3…SELECT … FROM transcriptions WHERE id=931"`.
  - Record `transcriptions.id=931`:
    - `timestamp=2026-02-18 23:29:23` (UTC)
    - `meta.sessionId=35641b96-d600-448b-bf94-28eea7ae3477`
    - `meta.timings.recordDurationMs=34401` (**~34.4 seconds**, not minutes)
    - `text === raw_text === "I have also provided our existing code deployment playbook."`
    - Word count: raw `9`, cleaned `9`
  - Logs:
    - Installed debug log: `C:\Users\NigelPinkerton\AppData\Local\Programs\OpenWhispr\EchoDraft\logs\openwhispr-debug-2026-02-19.jsonl`
    - That file starts at `2026-02-19T01:02:03Z` (after the `id=931` timestamp), and a search for that sessionId returns no matches.
    - Conclusion: we can’t prove why that recording stopped at ~34s (no logs, no saved audio capture for that session).
  - UI:
    - The UI shows the same sentence for “raw transcript” and the clean text, and `Copy` copies `item.text` (not a preview), so this is not a UI truncation issue.
  - Follow-up action (to confirm next time): persist stop metadata into `meta_json` (stopReason/stopSource/audio bytes/mime/chunks) + keep debug-audio rolling captures enabled.
- [x] Added non-streaming recording contract tests (`src/helpers/__tests__/audioManagerRecording.test.ts`).
- [x] Extracted pure helpers into `src/helpers/audio/` (word counting, dictionary prompt echo guard, OpenAI SSE parsing) + added unit tests; wired `audioManager.js` to use them.
- [x] Extracted BYOK reasoning cleanup into `src/helpers/audio/reasoning/reasoningCleanupService.js` + unit tests; kept `AudioManager.isReasoningAvailable()` as a thin wrapper for compatibility/tests.
- [x] Extracted custom dictionary helpers into `src/helpers/audio/transcription/customDictionary.js` + unit tests; removed `AudioManager.getCustomDictionary*` methods.
- [x] Extracted BYOK HTTP transcription provider into `src/helpers/audio/transcription/openAiTranscriber.js` + unit tests; `AudioManager.processWithOpenAIAPI()` is now a wrapper.
- [x] Extracted microphone selection + warmup into `src/helpers/audio/microphone/microphoneService.js` + unit tests; `AudioManager.getAudioConstraints()` etc now delegate.
- [x] Extracted queue orchestration + pipeline routing:
  - `src/helpers/audio/pipeline/processingQueue.js` + unit tests
  - `src/helpers/audio/pipeline/transcriptionPipeline.js` + unit tests
- [x] Extracted streaming worklet plumbing (blob URL + flush waiter + per-chunk forwarding):
  - `src/helpers/audio/streaming/streamingWorkletManager.js` + unit tests
- [x] Extracted AudioManager event emission + debug audio capture + persistence:
  - `src/helpers/audio/events/audioManagerEvents.js` + unit tests
  - `src/helpers/audio/debug/debugAudioCaptureClient.js` + unit tests
  - `src/helpers/audio/persistence/audioPersistence.js` + unit tests
- [x] Split streaming controller into small files (all <400 LoC):
  - `src/helpers/audio/streaming/assemblyAiStreamingWarmup.js`
  - `src/helpers/audio/streaming/assemblyAiStreamingStart.js`
  - `src/helpers/audio/streaming/assemblyAiStreamingStop.js`
  - `src/helpers/audio/streaming/assemblyAiStreamingCleanup.js`
  - `src/helpers/audio/streaming/streamingAudioContext.js`
  - `src/helpers/audio/streaming/assemblyAiStreamingController.js` now just re-exports
- [x] Split OpenAI/Groq/Mistral BYOK transcription processing:
  - `src/helpers/audio/transcription/openAiTranscriber.js` (now ~395 LoC)
  - `src/helpers/audio/transcription/openAiTranscriptionProcessor.js` (~312 LoC)
- [x] Reduced `src/helpers/audioManager.js` from ~3.3k → **399 LoC** (orchestrator only).
- [x] Added additional non-streaming diagnostics to help root-cause “short recording” and hotkey delays next time:
  - Persisted `hotkeyToStartCallMs` / `hotkeyToRecorderStartMs` (requires renderer to pass `triggeredAt` into recording context).
  - Persisted `start*Ms` breakdown (constraints/getUserMedia/MediaRecorder init/start) into `result.timings` → DB `meta_json.timings`.
  - Persisted `stopReason` / `stopSource` (including auto `track-ended`) + chunk/blob diagnostics (`audioSizeBytes`, `audioFormat`, `chunksCount`, `stop*` latency/flush fields).
  - Added contract tests covering the new fields.

---

## App-wide Best-Practice Refactor (Post-audio)

### Why
Now that the audio subsystem is split and well-instrumented, the next maintainability hotspots are the remaining large “god files” that mix responsibilities and are difficult to unit test.

### Current largest files (line count snapshot)
- `src/helpers/ipcHandlers.js` (~2369)
- `src/components/SettingsPage.tsx` (~2320)
- `scripts/gate/windows_release_gate.js` (~1679)
- `src/helpers/clipboard.js` (~1591)
- `src/services/ReasoningService.ts` (~1243)
- `src/hooks/useAudioRecording.js` (~1168)
- `src/components/ControlPanel.tsx` (~1044)
- `main.js` (~1011)

### Target principles (same as audio refactor)
- Split by responsibility (SRP), isolate pure logic, push side effects to boundaries.
- Keep files reviewable (prefer < ~400 LoC; exceptions only with strong justification).
- Add tests for extracted contracts and pure logic (use `// @vitest-environment node` for main-process units where needed).
- Keep user-facing behavior stable; avoid “drive-by” changes.

### Proposed execution order
1) Main-process IPC layer: split `src/helpers/ipcHandlers.js` into `src/helpers/ipc/` modules (window/env/db/clipboard/streaming/model/downloads/etc).
2) Clipboard/paste subsystem: split `src/helpers/clipboard.js` into platform-specific submodules + pure utils; add contract tests.
3) Reasoning: split `src/services/ReasoningService.ts` (request building, response parsing, token limits, error classification) + expand tests.
4) Renderer: split `src/hooks/useAudioRecording.js` into smaller hooks/services and reduce coupling to UI; add more contract tests for session normalization + lifecycle.
5) UI: split `ControlPanel.tsx`/`SettingsPage.tsx` into focused components (minimize prop drilling; favor composition patterns where appropriate).
6) Final: rebuild Windows installer, copy to Downloads, run full test/lint/typecheck, commit + push.

### Progress log
- [x] Refactored main-process IPC layer:
  - Replaced `src/helpers/ipcHandlers.js` with a thin orchestrator that composes focused handler modules.
  - Split handlers into `src/helpers/ipc/handlers/*` + extracted pure utilities into `src/helpers/ipc/utils/*`.
  - Added `src/helpers/ipc/cloud/cloudContext.js` so Cloud API + streaming modules share `getApiUrl()` / `getSessionCookies()` behavior.
  - Added unit tests for extracted pure utils (`dictionaryUtils`, `pathUtils`).
  - Verified `npm test`, `npm run lint`, and `npm run typecheck`.

- [x] Refactored clipboard/paste subsystem:
  - Split `src/helpers/clipboard.js` (~1591 LoC) into a DI-friendly orchestrator (~316 LoC) plus focused modules under `src/helpers/clipboard/`.
  - Added unit tests for clipboard snapshot restore, Linux session detection, Windows PowerShell parsing + insertion targeting, macOS accessibility helpers, and Linux paste error contracts.
  - Shared env-flag parsing via `src/helpers/utils/flags.js` and reused it from `main.js`, `src/updater.js`, and IPC utils.
  - Verified `npm test` after the split.

- [x] Refactored reasoning service:
  - Reduced `src/services/ReasoningService.ts` to ~365 LoC by extracting provider implementations into `src/services/reasoning/` modules.
  - Centralized OpenAI endpoint base + `/responses` vs `/chat/completions` preference logic in `src/services/reasoning/openaiEndpoints.ts` + added unit tests.
  - Extracted reasoning availability check into `src/services/reasoning/availability.ts` + added unit tests.
  - Fixed a TS typecheck failure in `src/helpers/clipboard/macos/macosPaste.test.ts` (Vitest mock call arg typing).
  - Verified `npm test`, `npm run lint`, and `npm run typecheck`.

- [x] Refactored hotkey→recording renderer pipeline:
  - Split `src/hooks/useAudioRecording.js` (~1168 → ~356 LoC) into focused modules under `src/hooks/audioRecording/`.
  - Added a new `starting` stage so the UI responds immediately while `getUserMedia`/recorder init is in-flight (reduces perceived hotkey delays).
  - Added unit tests for trigger payload normalization, stage updates, start/stop handler ordering, and transcription-complete persistence.
  - Verified `npm test`, `npm run lint`, and `npm run typecheck`.

- [x] Refactored ControlPanel UI:
  - Reduced `src/components/ControlPanel.tsx` to a controller (~390 LoC) that delegates JSX to `src/components/controlPanel/*`.
  - Split `ControlPanelView` into smaller presentational pieces (`HistoryPanel`, `ControlPanelBanners`, `TranscriptionsHeader`) to keep files reviewable (<400 LoC).
  - Extracted history filtering utilities into `src/components/controlPanel/historyFilterUtils.ts` + unit tests.
  - Added `@testing-library/react` + `@testing-library/jest-dom` and Vitest setup (`src/test/setup.ts`) and covered the new UI components with component-level tests.
  - Verified `npm test`, `npm run lint`, and `npm run typecheck`.

- [x] Refactored SettingsPage UI:
  - Reduced `src/components/SettingsPage.tsx` to a thin section router (<300 LoC).
  - Extracted `account` and `general` sections into `src/components/settings/sections/` (all files <400 LoC).
  - Split General into smaller sub-sections under `src/components/settings/sections/general/*` (Updates/Appearance/Language/Hotkeys/Startup/Microphone).
  - Added component tests for extracted sections (mocking heavy UI widgets where needed).
  - Added `@testing-library/user-event` for interaction-style component tests.

- [x] Refactored TranscriptionModelPicker UI:
  - Split `src/components/TranscriptionModelPicker.tsx` into focused modules under `src/components/transcriptionModelPicker/` (`ModeToggle`, `CloudModePanel`, `LocalModePanel`, `LocalModelCard`, constants).
  - Added component tests for new modules.
  - Verified `npm test`, `npm run lint`, and `npm run typecheck`.

- [x] Refactored `main.js` (main process) for maintainability:
  - Extracted channel/protocol parsing and platform setup into `src/helpers/app/*`.
  - Extracted macOS Globe hotkeys + Windows push-to-talk wiring into `src/helpers/app/platformHotkeys/*` and removed unnecessary `await` on sync activation-mode reads (reduces hotkey latency variance).
  - Added unit tests for the extracted config helpers (`src/helpers/app/appConfig.test.ts`).
  - Reduced `main.js` from ~1007 → ~376 LoC; verified `npm test` and `npm run lint`.

- [x] Improved persisted transcription diagnostics:
  - Persisted `stopReason`/`stopSource` and basic text metrics (`rawWords`, `cleanedWords`, `rawChars`, `cleanedChars`) into `meta_json`.
  - Updated History item details to display extra diagnostics (stop reason/source, audio size/format, chunks, hotkey→rec timing) when present.
  - Expanded JSON/CSV export to include these extra fields.

## Archived: EchoDraft Fix Plan (2026-02-16)

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

## Issue 4 — WindowManager refactor (SRP + hotkey reliability)

### A) Code changes
- [x] Split `src/helpers/windowManager.js` into focused modules under `src/helpers/windowManager/`:
  - `windowContentLoader.js` (dev/prod renderer loading)
  - `mainWindow.js` (dictation overlay creation + resize + always-on-top)
  - `controlPanelWindow.js` (control panel creation + external URL hardening)
  - `hotkeyRouting.js` (hotkey callback + mac compound PTT routing)
  - `clipboardHotkeys.js` (clipboard hotkey registration/persistence, DI-friendly)
- [x] Removed unused imports from `src/helpers/windowManager.js` and kept it as a thin orchestrator (~288 LoC).
- [x] Added unit tests for extracted pure logic:
  - `src/helpers/windowManager/hotkeyRouting.test.ts`
  - `src/helpers/windowManager/clipboardHotkeys.test.ts`

### B) Validation
- [x] Run `npm test`.
- [x] Run `npm run lint` (warnings only; no errors).
- [x] Run `npm run typecheck`.
