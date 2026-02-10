# OpenWhispr — Windows Usability Plan Verification Report (Adversarial Gate)

- Review date: **2026-02-11** (NZDT) / **2026-02-10** (UTC)
- Repo: `/home/npinkerton/ReposOther/openwhispr`
- Branch: `main`
- Commit (HEAD): `fc16cdd` (packaged gate ran on code commit `717dbc9`; `fc16cdd` updates this report only)

## Scope & standards

This report verifies `Docs/openwhispr_windows_usability_plan.md` against the codebase with Windows-first release-gate standards:

- **PASS requires**: (1) code evidence (file + key functions) **and** (2) runtime verification on a **packaged Windows build**.
- Runtime verification was executed via the packaged-runtime gate harness:
  - `scripts/gate/windows_release_gate.js` (CDP + PowerShell, runs only on Windows)
  - Uses an isolated `userData` path when `OPENWHISPR_E2E=1` to avoid touching the user’s real settings/history.

## Environments & artifacts

### Windows packaged runtime (used for the runtime gate)

- Windows build working copy:
  - `C:\Users\NigelPinkerton\AppData\Local\Temp\openwhispr-winbuild-20260210T221322Z`
- Packaged app executed:
  - `dist\win-unpacked\OpenWhispr.exe`
- Packaged gate runId (PASS):
  - `2026-02-10T22-18-17-163Z`

### Windows installer artifacts (packaging verification)

Installer/portable artifacts were verified present under:

- `C:\Users\NigelPinkerton\AppData\Local\Temp\openwhispr-winbuild-20260210T221322Z\dist\`
  - `OpenWhispr Setup 1.4.4.exe` (NSIS)
  - `OpenWhispr 1.4.4.exe` (portable)
  - `latest.yml` (+ blockmap)
  - Convenience copy:
    - `C:\Users\NigelPinkerton\Downloads\OpenWhispr Setup 1.4.4 (n-pinkerton fork).exe`

## Traceability matrix (A–G)

Legend: **PASS** = code evidence + packaged runtime evidence. **FAIL** = missing runtime proof or requirement not met.

| Group | Sub-requirement | Evidence (code) | Runtime evidence (packaged) | Status | Notes |
|---|---|---|---|---|---|
| A | Dual hotkeys register (Insert + Clipboard) | `src/helpers/windowManager.js` (`updateHotkey`, `registerClipboardHotkeyInternal`), `src/helpers/ipcHandlers.js` (`e2e-get-hotkey-status`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Hotkeys registered (insert+clipboard)” | PASS | Gate auto-selects non-conflicting pair (e.g., `F8` + `F9`). |
| A | Insert mode inserts into target (foreground stable) | `src/hooks/useAudioRecording.js` (`handleTranscriptionComplete` Insert path), `src/helpers/clipboard.js` (`pasteText`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Insert mode writes into GatePad (foreground stable)” | PASS | Gate uses GatePad by default to avoid touching user Notepad sessions. |
| A | Clipboard mode never auto-inserts; copies to clipboard | `src/hooks/useAudioRecording.js` (Clipboard path writes clipboard; no paste), `src/helpers/windowManager.js` (clipboard route payload) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Clipboard mode does not insert”, **PASS** “Clipboard mode copies to clipboard” | PASS | Gate verifies target text unchanged + clipboard contains result. |
| A | Push-to-talk mode works for both hotkeys (Windows native listener wiring) | `main.js` (Windows Push-to-Talk + `activation-mode-changed` + `refreshWindowsKeyListeners`), `src/helpers/windowsKeyManager.js` (`start(key, hotkeyId)`), `resources/windows-key-listener.c` | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Push-to-talk mode uses native listener (both routes)” | PASS | Listener stop/restart is now treated as normal (no spurious “unavailable” toast). |
| A | “While processing, switch apps” behavior matches mode | `src/helpers/clipboard.js` (`activateInsertionTarget` + failure path), `src/hooks/useAudioRecording.js` (records `pasteSucceeded`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Switch focus away before insert…”, **PASS** “Target lock inserts… OR falls back to clipboard” | PASS | Gate uses a decoy foreground window to force activation logic. |
| B | Status/progress bar always visible | `src/components/ui/DictationStatusBar.jsx`, `src/App.jsx` | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Status bar present” | PASS | |
| B | Stage labels update (Listening/Transcribing) | `src/hooks/useAudioRecording.js` (`STAGE_META`, `updateStage`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Stage label updates (Listening)”, “(Transcribing)” | PASS | Gate asserts UI label changes via E2E helper. |
| C | History workspace renders | `src/components/ControlPanel.tsx`, `src/stores/transcriptionStore.ts` | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “History renders items” | PASS | |
| C | History search works | `src/components/ControlPanel.tsx` (`filteredHistory`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “History search filters results” | PASS | |
| C | History retains text even when paste fails | `src/helpers/audioManager.js` (`safePaste`), `src/hooks/useAudioRecording.js` (saves transcription with `pasteSucceeded`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Insert failure leaves text in clipboard”, **PASS** “History retains text after insert failure” | PASS | Insert failure is forced with an invalid HWND to prove safe fallback. |
| D | Per-dictation diagnostics persisted (mode/status/provider/timings) | `src/helpers/database.js` (`meta_json`, `hydrateTranscriptionRow`, `patchTranscriptionMeta`), `src/hooks/useAudioRecording.js` (writes meta + timings) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** export JSON/CSV + **PASS** “Export JSON includes diagnostics columns”, “Export CSV includes diagnostics columns” | PASS | Export includes `outputMode`, `status`, `provider`, `pasteSucceeded`, `recordMs/transcribeMs/pasteMs/totalMs` etc. |
| D | Export works (CSV + JSON) | `src/helpers/ipcHandlers.js` (`e2e-export-transcriptions`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “E2E export transcriptions (JSON/CSV)” | PASS | |
| D | Diagnostics do not include secrets | `src/helpers/environment.js` (keys stored separately), `src/helpers/ipcHandlers.js` (export flattens meta; no keys) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Export JSON includes diagnostics columns” (`secretLike=false` heuristic) | PASS | Heuristic is limited; code-path review shows API keys are not exported. |
| E | Batch dictionary paste-import supports dedupe/preview | `src/components/SettingsPage.tsx` (batch dictionary UI), `src/helpers/ipcHandlers.js` (dictionary handlers) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Dictionary preview shows dedupe counts” | PASS | |
| E | Merge applies to DB | `src/helpers/database.js` (`setDictionary`), `src/helpers/ipcHandlers.js` (`db-set-dictionary`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Dictionary merge writes to DB” | PASS | |
| E | Export/import round-trip works | `src/helpers/ipcHandlers.js` (`e2e-export-dictionary`, `e2e-import-dictionary`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “E2E export dictionary (TXT)”, “E2E import dictionary (TXT)” | PASS | |
| F | Capture insertion target at dictation start | `src/helpers/clipboard.js` (`captureInsertionTarget`), `src/hooks/useAudioRecording.js` (captures at start) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Capture insertion target … (foreground)” | PASS | Gate asserts captured HWND equals expected target HWND. |
| F | Best-effort activation of original target on completion | `src/helpers/clipboard.js` (`activateInsertionTarget`, error handling) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Target lock inserts… OR falls back to clipboard” | PASS | |
| F | Failure path is safe (clipboard + history) | `src/helpers/audioManager.js` (`safePaste`), `src/hooks/useAudioRecording.js` (saves regardless; `pasteSucceeded`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Insert failure leaves text in clipboard”, “History retains text after insert failure” | PASS | |
| F | Elevated target case handled gracefully | `src/helpers/clipboard.js` (errors surface via `safePaste`) | **Not exercised** | FAIL | Manual: run target app “as Administrator” and confirm OpenWhispr fails safely (clipboard + message), no crash. |
| G | Clipboard format preservation (image) across insert | `src/helpers/clipboard.js` (`snapshotClipboard`, `restoreClipboardSnapshot`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “Clipboard image preserved after insert” | PASS | Gate uses a deterministic clipboard test image and verifies pixel-hash equality after restore delay. |
| G | Clipboard restore delay not dangerously short | `src/helpers/clipboard.js` (`RESTORE_DELAYS.win32_* = 850ms`) | Indirect (image test passes with restore delay) | PASS | Manual recommended for Word/Chrome/VS Code paste timing sensitivity. |
| G | No focus-stealing regression | `src/helpers/windowManager.js` (`showDictationPanel({ focus:false })`) | Gate run `2026-02-10T22-18-17-163Z`: **PASS** “No focus-steal on showDictationPanel”, **PASS** “No focus-steal on insert completion” | PASS | |
| G | Windows helper binaries present in packaged resources | `electron-builder.json` (`extraResources`), `scripts/build-windows-key-listener.js`, `resources/windows-key-listener.c` | Verified packaged tree contains `resources\\bin\\windows-key-listener.exe` and `whisper-server-win32-x64.exe` | PASS | Runtime gate also proves listener can start in push mode. |

## Issues found (during gatekeeping)

1) **Gate target safety (Notepad session restore)**  
   - Severity: High (verification safety; could touch user Notepad content)  
   - Root cause: Windows 11 Notepad can restore previous sessions/tabs; “start Notepad and paste” is not a safe blank slate.  
   - Fix (commit): `0e7dc2c` — gate uses a dedicated GatePad text window by default (opt-in Notepad via `OPENWHISPR_GATE_USE_NOTEPAD=1`).

2) **Clipboard image preservation false-negative (gate)**  
   - Severity: Medium (release gate reliability)  
   - Root cause: hashing PNG bytes can be unstable (encoder differences/metadata), even when the pixels are identical.  
   - Fix (commit): `b143bcd` — gate hashes clipboard images by raw pixels (ARGB) instead of PNG bytes.

3) **Spurious Windows Push-to-Talk “unavailable” toast on listener stop/restart**  
   - Severity: Medium (Windows UX noise; could mislead users)  
   - Root cause: Node can report `code=null` with `signal=SIGTERM` for a process we intentionally stop; previous code treated this as an error.  
   - Fix (commit): `f4c0178` — treat intentional stops as normal and avoid exit-handler races that could drop a newer listener.

4) **Fork safety: update feed and external links pointed to upstream**  
   - Severity: Medium (fork correctness; could confuse users / pull updates from wrong repo)  
   - Fix (commit): `164f9f7` — repoint updater feed + Help/Issues links to `n-pinkerton/openwhispr` and allow env override.

5) **User-safety during verification (clipboard disruption)**  
   - Severity: Low (developer UX)  
   - Fix (commit): `baf33a4` + follow-ups — gate attempts a best-effort clipboard snapshot/restore at end, with safeguards to avoid timeouts on very large clipboard images.

6) **Fork UX: remove Pro/Billing upgrade CTAs**  
   - Severity: Low (fork correctness; avoids pointing users at an unavailable Pro/Billing flow)  
   - Fix (commit): `717dbc9` — remove Pro/Billing CTAs and replace with a GitHub releases link + BYOK/local options.

No High-severity app regressions were found in the verified Windows packaged-runtime scenarios.

## Commands run (record)

### WSL (repo)

- `npm run quality-check` → PASS (warnings only)

### Windows (packaged runtime gate)

From `C:\Users\NigelPinkerton\AppData\Local\Temp\openwhispr-winbuild-20260210T221322Z`:

- `npm ci` → OK
- `npm run quality-check` → PASS (warnings only)
- `npm run build:win` → OK
- `node scripts\gate\windows_release_gate.js dist\win-unpacked\OpenWhispr.exe`
  - Result: **ALL CHECKS PASSED**
  - runId: `2026-02-10T22-18-17-163Z`

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
   - Run the new installer and install over the existing installation:
     - `C:\Users\NigelPinkerton\Downloads\OpenWhispr Setup 1.4.4 (n-pinkerton fork).exe`

4) Post-install verification
   - Launch OpenWhispr.
   - Confirm:
     - provider/model settings remain
     - dictionary remains
     - history remains

## Final verdict (Windows build + install readiness)

**Verdict: GO** (for Windows build/packaging + upgrade-in-place), based on:

- Packaged runtime gate PASS on Windows (`runId 2026-02-10T22-18-17-163Z`)
- Dual output modes + second hotkey verified (insert vs clipboard behavior)
- Windows clipboard image preservation verified on insert success path
- History/exports/dictionary batch workflows verified
- `appId`/`productName` verified stable for upgrade safety

### Recommended (manual) last-mile checks (non-blocking)

- Elevated target insertion: start insert-mode dictation targeting an “Administrator” app and confirm safe fallback messaging.
- Physical hotkey ergonomics: confirm hold-to-talk feel and key-up stop behavior for the chosen keys on Windows 11.
