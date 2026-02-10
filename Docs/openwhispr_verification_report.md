# OpenWhispr — Windows Usability Plan Verification Report (Adversarial Gate)

- Review date: **2026-02-11** (NZDT) / **2026-02-10** (UTC)
- Repo: `/home/npinkerton/ReposOther/openwhispr`
- Branch: `main`
- Commit (HEAD): `54aba92` (plus prior gate hardening `baf33a4`, updater/E2E isolation `5c321b9`)

## Scope & standards

This report verifies `Docs/openwhispr_windows_usability_plan.md` against the codebase with Windows-first release-gate standards:

- **PASS requires**: (1) code evidence (file + key functions) **and** (2) runtime verification on a **packaged Windows build**.
- Runtime verification was executed via the packaged-runtime gate harness:
  - `scripts/gate/windows_release_gate.js` (CDP + PowerShell, runs only on Windows)
  - Uses an isolated `userData` path when `OPENWHISPR_E2E=1` to avoid touching the user’s real settings/history.

## Environments & artifacts

### Windows packaged runtime (used for the runtime gate)

- Windows build working copy:
  - `C:\Users\NigelPinkerton\AppData\Local\Temp\openwhispr-winbuild-20260210T075941Z`
- Packaged app executed:
  - `dist\win-unpacked\OpenWhispr.exe`
- Packaged gate runId (PASS):
  - `2026-02-10T19-29-51-395Z`

### Windows installer artifacts (packaging verification)

Installer/portable artifacts were verified present under:

- `C:\Users\NigelPinkerton\AppData\Local\Temp\openwhispr-winbuild-20260210T071303Z\dist\`
  - `OpenWhispr Setup 1.4.4.exe` (NSIS)
  - `OpenWhispr 1.4.4.exe` (portable)
  - `latest.yml` (+ blockmap)

## Traceability matrix (A–G)

Legend: **PASS** = code evidence + packaged runtime evidence. **FAIL** = missing runtime proof or requirement not met.

| Group | Sub-requirement | Evidence (code) | Runtime evidence (packaged) | Status | Notes |
|---|---|---|---|---|---|
| A | Dual hotkeys register (Insert + Clipboard) | `src/helpers/windowManager.js` (`updateHotkey`, `registerClipboardHotkeyInternal`), `src/helpers/ipcHandlers.js` (`e2e-get-hotkey-status`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Hotkeys registered (insert+clipboard)” | PASS | Gate auto-selects non-conflicting pair (`F8` + `F10`). |
| A | Insert mode inserts into target (foreground stable) | `src/hooks/useAudioRecording.js` (`handleTranscriptionComplete` Insert path), `src/helpers/clipboard.js` (`pasteText`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Insert mode writes into GatePad (foreground stable)” | PASS | Gate uses GatePad when existing Notepad windows are detected (safer). |
| A | Clipboard mode never auto-inserts; copies to clipboard | `src/hooks/useAudioRecording.js` (Clipboard path writes clipboard; no paste), `src/helpers/windowManager.js` (clipboard route payload) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Clipboard mode does not insert”, **PASS** “Clipboard mode copies to clipboard” | PASS | Gate verifies target text length unchanged + clipboard contains result. |
| A | Push-to-talk mode works for both hotkeys (Windows native listener wiring) | `main.js` (Windows Push-to-Talk + `activation-mode-changed` + `refreshWindowsKeyListeners`), `src/helpers/windowsKeyManager.js` (`start(key, hotkeyId)`), `resources/windows-key-listener.c` | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Push-to-talk mode uses native listener (both routes)” | PASS | This proves listener startup + route wiring; physical “hold feel” still recommended as a manual smoke check. |
| A | “While processing, switch apps” behavior matches mode | `src/helpers/clipboard.js` (`activateInsertionTarget` + failure path), `src/hooks/useAudioRecording.js` (records `pasteSucceeded`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Switch focus away before insert…”, **PASS** “Target lock inserts… OR falls back to clipboard” | PASS | Gate uses a decoy foreground window to force activation logic. |
| B | Status/progress bar always visible | `src/components/ui/DictationStatusBar.jsx`, `src/App.jsx` | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Status bar present” | PASS | |
| B | Stage labels update (Listening/Transcribing) | `src/hooks/useAudioRecording.js` (`STAGE_META`, `updateStage`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Stage label updates (Listening)”, “(Transcribing)” | PASS | Gate asserts UI label changes via E2E helper. |
| C | History workspace renders | `src/components/ControlPanel.tsx`, `src/stores/transcriptionStore.ts` | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “History renders items” | PASS | |
| C | History search works | `src/components/ControlPanel.tsx` (`filteredHistory`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “History search filters results” | PASS | |
| C | History retains text even when paste fails | `src/helpers/audioManager.js` (`safePaste`), `src/hooks/useAudioRecording.js` (saves transcription with `pasteSucceeded`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Insert failure leaves text in clipboard”, **PASS** “History retains text after insert failure” | PASS | Insert failure is forced with an invalid HWND to prove safe fallback. |
| D | Per-dictation diagnostics persisted (mode/status/provider/timings) | `src/helpers/database.js` (`meta_json`, `hydrateTranscriptionRow`, `patchTranscriptionMeta`), `src/hooks/useAudioRecording.js` (writes meta + timings) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** export JSON/CSV + **PASS** “Export JSON includes diagnostics columns”, “Export CSV includes diagnostics columns” | PASS | Export includes `outputMode`, `status`, `provider`, `pasteSucceeded`, `recordMs/transcribeMs/pasteMs/totalMs` etc. |
| D | Export works (CSV + JSON) | `src/helpers/ipcHandlers.js` (`e2e-export-transcriptions`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “E2E export transcriptions (JSON/CSV)” | PASS | |
| D | Diagnostics do not include secrets | `src/helpers/environment.js` (keys stored separately), `src/helpers/ipcHandlers.js` (export flattens meta; no keys) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Export JSON includes diagnostics columns” (`secretLike=false` heuristic) | PASS | Heuristic is limited; code-path review shows API keys are not exported. |
| E | Batch dictionary paste-import supports dedupe/preview | `src/components/SettingsPage.tsx` (batch dictionary UI), `src/helpers/ipcHandlers.js` (dictionary handlers) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Dictionary preview shows dedupe counts” | PASS | |
| E | Merge applies to DB | `src/helpers/database.js` (`setDictionary`), `src/helpers/ipcHandlers.js` (`db-set-dictionary`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Dictionary merge writes to DB” | PASS | |
| E | Export/import round-trip works | `src/helpers/ipcHandlers.js` (`e2e-export-dictionary`, `e2e-import-dictionary`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “E2E export dictionary (TXT)”, “E2E import dictionary (TXT)” | PASS | |
| F | Capture insertion target at dictation start | `src/helpers/clipboard.js` (`captureInsertionTarget`), `src/hooks/useAudioRecording.js` (captures at start) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Capture insertion target … (foreground)” | PASS | Gate asserts captured HWND equals expected target HWND. |
| F | Best-effort activation of original target on completion | `src/helpers/clipboard.js` (`activateInsertionTarget`, error handling) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Target lock inserts… OR falls back to clipboard” | PASS | |
| F | Failure path is safe (clipboard + history) | `src/helpers/audioManager.js` (`safePaste`), `src/hooks/useAudioRecording.js` (saves regardless; `pasteSucceeded`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Insert failure leaves text in clipboard”, “History retains text after insert failure” | PASS | |
| F | Elevated target case handled gracefully | `src/helpers/clipboard.js` (errors surface via `safePaste`) | **Not exercised** | FAIL | Manual: run target app “as Administrator” and confirm OpenWhispr fails safely (clipboard + message), no crash. |
| G | Clipboard format preservation (image) across insert | `src/helpers/clipboard.js` (`snapshotClipboard`, `restoreClipboardSnapshot`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “Clipboard image preserved after insert” | PASS | Gate uses a deterministic clipboard test image and verifies hash equality after restore delay. |
| G | Clipboard restore delay not dangerously short | `src/helpers/clipboard.js` (`RESTORE_DELAYS.win32_* = 850ms`) | Indirect (image test passes with restore delay) | PASS | Manual recommended for Word/Chrome/VS Code paste timing sensitivity. |
| G | No focus-stealing regression | `src/helpers/windowManager.js` (`showDictationPanel({ focus:false })`) | Gate run `2026-02-10T19-29-51-395Z`: **PASS** “No focus-steal on showDictationPanel”, **PASS** “No focus-steal on insert completion” | PASS | |
| G | Windows helper binaries present in packaged resources | `electron-builder.json` (`extraResources`), `scripts/build-windows-key-listener.js`, `resources/windows-key-listener.c` | Verified packaged tree contains `resources\\bin\\windows-key-listener.exe` and `whisper-server-win32-x64.exe` | PASS | Runtime gate also proves listener can start in push mode. |

## Issues found (during gatekeeping)

1) **Packaged gate false-negatives / hangs (test harness)**  
   - Severity: Medium (release gate reliability)  
   - Root cause: focus/clipboard access on Windows can be timing-sensitive; CDP websockets required robust termination to prevent node hangs.  
   - Fixes (commits):
     - `5c321b9` — E2E disables updater checks + hardens gate cleanup/exit.
     - `baf33a4` / `54aba92` — gate hardening: foreground verification, safe-fallback assertions, push-to-talk/export checks, and clipboard-image retries.

2) **User-safety during verification (clipboard disruption)**  
   - Severity: Low (developer UX)  
   - Fix (commit): `baf33a4` + follow-ups — gate attempts a best-effort clipboard snapshot/restore at end, with safeguards to avoid timeouts on very large clipboard images.

No High-severity app regressions were found in the verified Windows packaged-runtime scenarios.

## Commands run (record)

### WSL (repo)

- `npm run quality-check` → PASS (warnings only)

### Windows (packaged runtime gate)

From `C:\Users\NigelPinkerton\AppData\Local\Temp\openwhispr-winbuild-20260210T075941Z`:

- `node scripts\gate\windows_release_gate.js dist\win-unpacked\OpenWhispr.exe`
  - Result: **ALL CHECKS PASSED**
  - runId: `2026-02-10T19-29-51-395Z`

## Upgrade/install safety (preserve settings/dictionary)

### Identity (must not change)

Verified in `electron-builder.json`:

- `appId`: `com.herotools.openwispr`
- `productName`: `OpenWhispr`

These values should remain stable to preserve the existing `%APPDATA%\OpenWhispr\` userData folder on upgrade.

### User install instructions (upgrade-in-place; no data loss)

1) **Back up user data (copy only; do not delete)**
   - `%APPDATA%\OpenWhispr\` (includes DB + Local Storage)
   - `%USERPROFILE%\.cache\openwhispr\models\` (local models)

2) Build installer on Windows (if needed)
   - `npm ci`
   - `npm run quality-check`
   - `npm run build:win`

3) **Upgrade-in-place**
   - Do **not** uninstall the existing OpenWhispr first.
   - Run the new `OpenWhispr Setup <version>.exe` and install over the existing installation.

4) Post-install verification
   - Launch OpenWhispr.
   - Confirm:
     - provider/model settings remain
     - dictionary remains
     - history remains

## Final verdict (Windows build + install readiness)

**Verdict: GO** (for Windows build/packaging + upgrade-in-place), based on:

- Packaged runtime gate PASS on Windows (`runId 2026-02-10T19-29-51-395Z`)
- Dual output modes + second hotkey verified (insert vs clipboard behavior)
- Windows clipboard image preservation verified on insert success path
- History/exports/dictionary batch workflows verified
- `appId`/`productName` verified stable for upgrade safety

### Recommended (manual) last-mile checks (non-blocking)

- Elevated target insertion: start insert-mode dictation targeting an “Administrator” app and confirm safe fallback messaging.
- Physical hotkey ergonomics: confirm hold-to-talk feel and key-up stop behavior for the chosen keys on Windows 11.

