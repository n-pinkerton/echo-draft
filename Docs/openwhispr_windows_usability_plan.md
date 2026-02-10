# OpenWhispr (openwhispr) — Windows 11 Usability & Reliability Improvement Plan

**Repository reviewed:** the ZIP you attached (fork of `https://github.com/OpenWhispr/openwhispr`)  
**Date of this report:** 2026-02-09 (Pacific/Auckland)

This document is written for engineers who will implement improvements. It includes:

- A concrete, code-aware plan for the features you requested (dual hotkeys, always-visible progress indicator, better history/clipboard workflows, batch dictionary management, “return to original cursor” insertion, per-dictation diagnostics).
- A Windows 11–specific reliability playbook (microphone permissions, hotkey constraints, focus/caret limitations, paste automation constraints, packaging/signing guidance).
- Research references from Windows UI guidance, Electron docs, and established dictation products (Dragon, Wispr Flow, etc.).

---

## Table of contents

1. [Quick executive summary](#quick-executive-summary)  
2. [What’s in the current codebase (relevant architecture)](#whats-in-the-current-codebase-relevant-architecture)  
3. [Usability gaps observed (why users struggle today)](#usability-gaps-observed-why-users-struggle-today)  
4. [What other dictation tools do well (features users expect)](#what-other-dictation-tools-do-well-features-users-expect)  
5. [Implementation plan (requested features)](#implementation-plan-requested-features)  
   1. [Second hotkey for “clipboard-only” dictation](#1-second-hotkey-for-clipboard-only-dictation)  
   2. [Always-visible progress/status bar with stage + partial progress](#2-always-visible-progressstatus-bar-with-stage--partial-progress)  
   3. [A more user-friendly history UI (copy, search, re-use)](#3-a-more-user-friendly-history-ui-copy-search-re-use)  
   4. [Per-dictation diagnostics (timings, provider, benchmark export)](#4-per-dictation-diagnostics-timings-provider-benchmark-export)  
   5. [Batch dictionary management](#5-batch-dictionary-management)  
   6. [“Remember insertion target” (app + caret) and insert there](#6-remember-insertion-target-app--caret-and-insert-there)  
6. [High-impact Windows reliability fixes (paste, focus, clipboard)](#high-impact-windows-reliability-fixes-paste-focus-clipboard)  
7. [Windows 11 constraints & best-practice implementation guidelines](#windows-11-constraints--best-practice-implementation-guidelines)  
8. [Testing & QA plan](#testing--qa-plan)  
9. [Phased roadmap](#phased-roadmap)  
10. [Appendix: concrete code touchpoints](#appendix-concrete-code-touchpoints)  
11. [References](#references)

---

## Quick executive summary

### The 6 changes that will move usability the most

1. **Introduce two output modes**:
   - **Insert mode** (current behavior): paste/type into the target app.
   - **Clipboard mode**: *never* paste; copy result to clipboard + show it in OpenWhispr for review/copy.
   - Add a **second hotkey** to start dictation directly in Clipboard mode (you requested this).

2. **Add an always-visible status/progress bar** in the dictation panel:
   - Shows stage: *Listening → Transcribing → Cleaning up → Inserting/Saving → Done*.
   - Provides partial progress *where possible* (recording timer; streaming partial transcript word/char count; step completion).
   - Follows the “visibility of system status” usability heuristic and reduces uncertainty while waiting.

3. **Turn “history” into a real working surface**:
   - Fast copy, search, filter by provider/mode.
   - Expand each dictation to show diagnostics (timings per stage, model/provider, errors).
   - Add “Copy raw transcript” vs “Copy cleaned output”.

4. **Make dictation runs first-class “sessions”**:
   - Every run gets a `sessionId`, a stored pipeline timeline, and a stored insertion target snapshot (when in Insert mode).

5. **Batch dictionary import/export**:
   - Multi-line paste, file import, dedupe, preview, and export.
   - (Dragon supports list-based vocabulary management; users expect it.)

6. **Best-effort “insert where you started” on Windows**:
   - Capture foreground window handle + (optional) caret screen position at dictation start.
   - At insertion time: attempt to re-activate that window and re-place caret (best effort), then paste/type.
   - If Windows prevents focus (or app blocks injection), fallback gracefully: copy to clipboard + show “Paste manually”.

---

## What’s in the current codebase (relevant architecture)

This is what matters for the requested features.

### Process split

- **Main process**: `main.js`
  - Creates windows, system tray, starts whisper server, registers hotkeys.
  - On Windows, uses a **native helper EXE** (`windows-key-listener`) for modifier-only push-to-talk and right-side modifier keys (because Electron’s `globalShortcut` can’t reliably do those cases).

- **Renderer (dictation panel)**: `src/App.jsx` + hooks
  - Dictation UI is a small always-on-top panel (default 96×96) with a mic button and a small command menu.
  - Recording + processing pipeline is triggered from the renderer via `useAudioRecording`.

### Dictation pipeline

- **Hook**: `src/hooks/useAudioRecording.js`
  - Starts/stops recording.
  - After processing finishes: **always calls `safePaste(result.text)`** today (i.e., always attempts to paste into the active app).

- **Pipeline implementation**: `src/helpers/audioManager.js`
  - Records audio, optionally optimizes (ffmpeg), then transcribes (local whisper/parakeet or cloud), then (optionally) “cleanup” via reasoning model.
  - Already collects some durations (e.g., transcription + reasoning), and returns `result.timings` + `result.source`.

### Pasting and clipboard

- **Main-process clipboard/paste**: `src/helpers/clipboard.js`
  - On Windows: uses `nircmd.exe sendkeypress ctrl+v` if available; otherwise PowerShell `SendKeys`.
  - Restores clipboard extremely quickly on Windows (`RESTORE_DELAYS.win32_*` is **80ms**).
  - Only stores/restores **text clipboard** today (`clipboard.readText()` / `clipboard.writeText()`), not images/RTF/HTML.

### History storage

- **SQLite wrapper**: `src/helpers/database.js`
  - `transcriptions` table currently stores only `(id, text, timestamp)`.
  - There is no structured metadata per dictation.

- **History UI**: `src/components/ControlPanel.tsx` + `src/components/ui/TranscriptionItem.tsx`
  - Already exists, already has copy + delete.
  - But it can’t show diagnostics or provider/model/timings because those aren’t stored.

### Dictionary

- **DB**: `dictionary` table
- **UI**: `src/components/SettingsPage.tsx`
  - Adds/removes words one at a time.
  - No batch import/export.

### Current upstream issues confirm pain points

The upstream repo has open issues consistent with your requests:
- **OpenWhispr window stealing focus** breaks insertion, especially when it’s already open (#236).  
- **Paste failures into terminal/CLI workflows** like Codex CLI (#224 shows a paste-related problem in codex-cli).  

These are strong signals that:
- “Clipboard mode” and
- better insertion-target handling, and
- better status visibility  
will directly improve real users’ day-to-day experience.

---

## Usability gaps observed (why users struggle today)

This section ties directly to known UI/UX principles and observed behavior.

### 1) Unclear state while waiting (no “stage” visibility)
Today the UI essentially flips from “recording” to “processing” with an animation, but does not answer:
- Is it uploading?
- Transcribing?
- Cleaning up?
- Pasting?
- Saving?

Nielsen Norman Group’s “visibility of system status” heuristic explicitly calls out the need for feedback so users know what’s happening, and a lack of feedback causes uncertainty and repeated actions.

### 2) Output mode is “all or nothing” (always tries to paste)
Many power users *don’t* want auto-insertion every time:
- They may move focus while waiting.
- They may be dictating into apps where paste is unreliable (terminals, privileged apps, remote desktops, web views, etc.).
- They may want to review/edit.

Well-known dictation products address this by offering a “dictation box” or clipboard-first workflows (see references on Dragon Dictation Box and Wispr Flow).

### 3) Focus and cursor position are not “locked”
If the user starts dictation in one app and moves to another before processing completes, the result may land in the wrong place. This is explicitly reported upstream (#236), and is one of the most frustrating classes of dictation bugs because it feels random.

### 4) History exists, but isn’t optimized for reuse and debugging
You can copy, but:
- no quick “copy raw vs cleaned”
- no per-run diagnostics (timings, provider, error codes)
- no filtering/search by provider/mode
- no “re-run cleanup” or “reprocess” (a feature that competing tools have)

### 5) Dictionary management is too slow for real-world vocabularies
Many users will add *dozens* of domain terms. One-by-one adding is a “paper cut” that blocks adoption. Competing tools allow list imports.

---

## What other dictation tools do well (features users expect)

You asked specifically to research what users of other dictation software find useful. The clearest patterns:

### A) A “dictation box” / clipboard-first workflow
- **Dragon Dictation Box** lets users dictate into a dedicated box, edit, then transfer text to another app (and can keep text in the clipboard).
- **Wispr Flow** on Windows explicitly emphasizes dictation-to-clipboard and provides a hotkey to paste the last transcript.

This is essentially your requested “non-typing” mode, and is a proven UX.

### B) Clear, always-visible “listening/status bar”
Windows itself uses **Voice Access** with a visible bar at the top showing status and controls — setting user expectations for an always-visible dictation status surface.

### C) History as a “workspace”
Tools like Superwhisper expose a History tab with actions like “Process Again” — users treat dictation history as something they *use*, not just a log.

### D) Vocabulary management at scale
Dragon supports importing/exporting custom words and vocab lists. This is an established expectation for serious dictation users.

### E) Diagnostics for reliability and benchmarking
Power users want to know:
- latency per step
- whether local vs cloud is faster on their machine/network
- whether failures are paste failures vs transcription failures  
…because it directly informs configuration and product trust.

---

## Implementation plan (requested features)

### Guiding principles (non-negotiable)
1. **Never lose user work.** If insertion fails, the text must still be accessible (clipboard + history + UI panel).  
2. **Never surprise-focus.** Dictation should not steal focus from the user’s current app unless they explicitly ask.  
3. **Progress must be visible and honest.** If percent is not knowable, show “indeterminate” progress but still show stage + time.  
4. **Everything should be debuggable.** Store a per-session timeline so issues can be diagnosed and benchmarked.

---

## 1. Second hotkey for “clipboard-only” dictation

### UX definition
Add two modes:

- **Insert mode (existing default)**  
  Dictate → (optional cleanup) → attempt to insert into target app.  
  Always also saves to history.

- **Clipboard mode (new)**  
  Dictate → (optional cleanup) → copy to clipboard + show in OpenWhispr UI.  
  **Never** inserts into another app automatically.

### UX flow (clipboard mode)
1. User presses Clipboard hotkey (tap or push-to-talk, following activation mode).
2. UI shows “Listening… (Clipboard mode)” and a timer.
3. After release/stop:
   - UI shows stages: Transcribing → Cleaning up → Copied.
   - Final text appears in an expanded panel with:
     - **Copy** button
     - **Paste now** button (optional: pastes to *current* cursor, not “locked target”)
     - **Insert to original target** button (only if “remember insertion target” was enabled and capture succeeded)
     - **Edit** (optional stretch goal)

### Implementation steps (code-level)

#### Step 1 — add a new setting + persistence
Add a second hotkey setting.

- Renderer settings store:
  - `dictationKey` (existing)
  - `dictationKeyClipboard` (new)

Touchpoints:
- `src/hooks/useSettings.ts` — add localStorage key, `setDictationKeyClipboard`
- `src/components/SettingsPage.tsx` — add a second `HotkeyInput`
- `src/helpers/environment.js` + IPC:
  - Add a new persisted key, e.g. `DICTATION_KEY_CLIPBOARD`
  - Add IPC handlers:
    - `save-dictation-key-clipboard`
    - `get-dictation-key-clipboard`

Why do both localStorage + env persistence? The app already uses both patterns; keep consistent and avoid breaking startup behavior.

#### Step 2 — teach main process to register two hotkeys
In `main.js` (and/or `src/helpers/hotkeyManager.js`), register two “actions”:
- `dictateInsert`
- `dictateClipboard`

**Windows push-to-talk / modifier-only case:**  
If the hotkey is modifier-only or right-side modifier, it currently uses `windowsKeyListener`. You must extend this to support *two* hotkeys.

Recommended approach:
- Extend `windows-key-listener.c` so it can accept **multiple hotkeys** and emit which one fired.
  - CLI proposal: `windows-key-listener.exe "<hotkeyA>;<hotkeyB>"`
  - Output: `DOWN:HOTKEY_A`, `UP:HOTKEY_A`, `DOWN:HOTKEY_B`, etc.
- Update `src/helpers/windowsKeyManager.js` to parse and emit `{hotkeyId}` along with events.

Simpler fallback (acceptable for MVP):
- Spawn **two** windows-key-listener processes, one per hotkey.  
  (This is less elegant but lower engineering risk.)

#### Step 3 — pass “outputMode” payload into renderer start/stop events
Today:
- main sends `toggle-dictation`, `start-dictation`, `stop-dictation` with no payload.

Change to:
- `start-dictation` with `{ outputMode: "insert" | "clipboard", sessionId }`
- `stop-dictation` with `{ outputMode, sessionId }`
- `toggle-dictation` with `{ outputMode, sessionId }` (tap mode)

Touchpoints:
- `src/helpers/windowManager.js` (send events)
- `preload.js` (IPC event forwarding)
- `src/hooks/useAudioRecording.js` (store active session outputMode)

#### Step 4 — implement clipboard-only completion behavior
In `useAudioRecording.js`:
- Track `currentOutputMode`.
- Replace unconditional `safePaste(result.text)` with:

Pseudo-logic:
```js
await window.electronAPI.writeClipboard(result.text); // always
if (currentOutputMode === "insert") {
  await safePaste(result.text, { sessionId }); // tries paste/type
} else {
  // clipboard-only: no paste
  openResultPanel(result.text, { sessionId });
}
```

You’ll need to add a `writeClipboard` IPC method (or expose existing clipboard write in main).

---

## 2. Always-visible progress/status bar with stage + partial progress

### UX definition
Add a **status bar** that is visible in the dictation panel *no matter which sub-view is open*. It should show:

- Current stage name (Listening, Transcribing, Cleaning up, Inserting, Saving).
- A progress bar:
  - Determinate when possible (recording timer, step completion %, streaming characters).
  - Indeterminate when not possible (local whisper without progress callbacks).
- A small secondary line:
  - “12.4s recorded” (during recording)
  - “Streaming… 38 words” (during streaming)
  - “Cleanup: GPT-… (optional)” (during reasoning)
- A cancel button during processing.

### Why this is the right UX
- Visibility of system status is a foundational heuristic (NNGroup).
- Progress indicators reduce perceived latency (NNGroup progress indicator research).
- Microsoft and design systems distinguish **determinate vs indeterminate** progress indicators — use determinate only when you can honestly estimate progress.

### Implementation steps (code-level)

#### Step 1 — introduce an explicit pipeline state machine
Define a shared type (TS recommended) like:

```ts
export type DictationStage =
  | "idle"
  | "recording"
  | "converting_audio"
  | "transcribing"
  | "cleaning"
  | "inserting"
  | "saving"
  | "done"
  | "error"
  | "cancelled";

export interface DictationProgress {
  sessionId: string;
  stage: DictationStage;
  stageLabel: string;          // UI text
  stageProgress?: number|null; // 0..1 if known
  overallProgress?: number|null;
  recordedMs?: number;
  generatedChars?: number;
  provider?: string;
  model?: string;
  message?: string;            // debug-friendly
}
```

#### Step 2 — make AudioManager emit stage changes
Today `AudioManager` only emits `{isRecording, isProcessing}` via `onStateChange`.

Add:
- `onProgress(progressEvent)` callback
- call it at every major stage boundary.

Where to instrument (examples):
- When recording starts/stops
- Before/after ffmpeg conversion (`optimizeAudio`)
- Before/after transcription provider call
- Before/after cleanup/reasoning
- Before/after paste
- Before/after DB save

#### Step 3 — expose progress to UI and keep it always visible
In the dictation panel renderer (`src/App.jsx`):
- Add a `DictationStatusBar` component pinned to the top.
- It should render regardless of mic state or command menu state.

It should use state from `useAudioRecording`, e.g.:
```js
const { progress } = useAudioRecording(...);
```

#### Step 4 — “how much has been generated” (where possible)
You requested this “if possible”.

**Streaming transcription**: you can do it.
- AssemblyAI streaming already calls `onPartialTranscript`.
- Extend OpenAI streaming (`readTranscriptionStream`) to emit partial deltas.
- Use `generatedChars = partialText.length` and show it.

**Non-streaming local whisper**: you cannot reliably do it unless whisper server provides progress callbacks.
- For local whisper, show:
  - indeterminate progress bar
  - “Transcribing locally…”
  - optionally show *elapsed time* in this stage (this is still helpful and truthful)

#### Step 5 — add an explicit “Cleanup” stage
Users often blame the wrong step if they can’t see “Cleanup” vs “Transcribing”.

Add “Cleaning up” stage only when reasoning is enabled; otherwise skip.

---

## 3. A more user-friendly history UI (copy, search, re-use)

You already have a Control Panel with a transcription list. This should be upgraded to a “history workspace”.

### UX improvements (minimal, high-value)
1. **Search box** (full-text search over transcriptions)
2. **Filters**:
   - Output mode: Insert vs Clipboard
   - Provider: Local Whisper / Local Parakeet / OpenAI / Groq / OpenWhispr cloud / etc
   - Status: Success / Error / Cancelled
3. **One-click actions per dictation**:
   - Copy cleaned output
   - Copy raw transcript
   - Copy diagnostics (JSON)
4. **Expandable details drawer** per dictation:
   - Timings per stage
   - Provider/model
   - Audio duration
   - Paste strategy used (Paste vs Type)
   - Paste success/failure
5. **Pinned / starred dictations** (optional)
6. **“Open results panel”** (bring up the small UI panel to re-copy)

### Implementation steps (code-level)
- Add metadata storage (next section).
- Update `TranscriptionItem.tsx` to show:
  - top line: timestamp + provider badge + mode badge
  - main text: transcript preview
  - expand/collapse details

Stretch goal:
- “Process again” from history, inspired by Superwhisper:
  - Requires optional audio retention (see diagnostics section).

---

## 4. Per-dictation diagnostics (timings, provider, benchmark export)

This is essential for benchmarking local vs cloud providers and for debug/UX trust.

### Data model: store sessions, not just text

Create a “transcription session” record with:
- `sessionId` (uuid)
- `createdAt`
- `finalText`
- `rawText` (optional; before cleanup)
- `outputMode` (insert/clipboard)
- `provider` + `model` fields
- `timings`:
  - recordMs
  - convertMs
  - transcribeMs
  - cleanupMs
  - pasteMs
  - saveMs
  - totalMs
- `insertionTarget` snapshot (Windows: hwnd/title/process; optionally caret rect)
- `pasteResult`: success/failure + error string
- `appVersion`, `osVersion`, `platform`
- `error` object if run failed

### DB approach: use a JSON metadata column (recommended)
SQLite schema change (minimal future pain):

- Add columns:
  - `meta_json TEXT NOT NULL DEFAULT '{}'`
  - optionally `raw_text TEXT` if you want it queryable

This avoids schema churn every time you add a new metric.

### Migration plan (must be safe)
In `DatabaseManager.init()`:
- Inspect existing columns with `PRAGMA table_info(transcriptions)`.
- If `meta_json` missing: `ALTER TABLE transcriptions ADD COLUMN meta_json TEXT DEFAULT '{}'`.
- Keep backward compatibility: when reading rows with no meta_json, treat as `{}`.

### UI presentation
In history items:
- Show “Total time” and a breakdown (e.g., Transcribe 1.2s, Cleanup 0.8s, Paste 0.05s).
- Provide “Copy diagnostics” and “Export CSV”.

### Export for benchmarking
Add an “Export benchmark CSV” button:
- Exports: timestamp, provider, model, outputMode, audioDuration, stage timings, success/fail, error message.

Implementation:
- In main process, add IPC `export-transcriptions-csv` that:
  - queries DB
  - writes CSV to user-chosen location via `dialog.showSaveDialog`

### Optional: audio retention for true “reprocess” benchmarking
If you want to benchmark transcription providers fairly, you need the same audio input.

Add a setting:
- “Save audio for history (local only)” with clear privacy + storage warning.

If enabled:
- Save the final audio file path in `meta_json.audioPath`.
- Add a “Reprocess” button:
  - rerun transcription/cleanup with current settings or chosen provider.

---

## 5. Batch dictionary management

### UX requirements
Add a “Batch add” section to Settings → Dictionary:

- Textarea where user can paste 1 word/phrase per line.
- Accept common separators:
  - newline
  - comma
  - semicolon
- Dedupe and normalize (trim whitespace, ignore blank lines).
- Show a preview:
  - “Importing 132 words (12 duplicates removed)”
- Merge or replace:
  - **Merge** into existing dictionary (default)
  - **Replace all** (danger zone)

Also add:
- Export dictionary to `.txt` (one per line)
- Import from `.txt` or `.csv`

### Why it matters (expectation-setting)
Dragon supports vocabulary import/export and “Add Words from List”. Power users routinely manage vocabularies in bulk.

### Implementation steps (code-level)
Touchpoints:
- `src/components/SettingsPage.tsx`:
  - Add UI for batch input + import/export buttons.
- Add main-process IPC:
  - `export-dictionary`
  - `import-dictionary`
- Reuse existing DB API:
  - `setDictionary(words[])` already exists — extend it with a “merge” path:
    - `getDictionary()` + union + `setDictionary()`.

Parsing algorithm (suggested):
```ts
function parseWords(input: string): string[] {
  return input
    .split(/[\n,;]+/g)
    .map(w => w.trim())
    .filter(Boolean);
}
```

Normalization:
- preserve case? Typically yes (for proper nouns), but you may want to store original.
- for matching in LLM prompts, exact strings matter.

---

## 6. “Remember insertion target” (app + caret) and insert there

You asked: *“remember where your cursor was, like which application and what position you started dictation in, and write the text there instead of where the cursor might be when the dictation finishes.”*

This is possible **only as best-effort** on Windows. There are OS-level constraints and many apps do not expose caret info reliably. The correct solution is to implement a *tiered strategy* with a graceful fallback.

### Tiered design (recommended)

#### Tier 1 (high reliability): lock the *target window/app*
At dictation start, capture:
- foreground window handle (HWND)
- process name/path (optional)
- window title/class (optional)

At insertion time:
- attempt to re-activate that window and paste.

This solves the “I switched to another app while it processed” problem.

#### Tier 2 (best-effort): lock the *caret position*
Also capture caret info at dictation start:
- caret screen coordinates or bounding rect (best effort)

At insertion time, after activating target window:
- click at the stored caret location (relative to screen)
- then paste/type

This solves “I clicked elsewhere in the same app while it processed”, **but can misfire** if:
- the window moved
- the document scrolled
- the app uses a custom caret not reported to Windows

#### Tier 3 (fallback): never paste if lock fails
If any of these fail:
- copy to clipboard
- show a non-intrusive notification: “Copied — paste manually”
- keep the text available in the OpenWhispr UI

### Windows implementation: recommended approach

Because Electron renderer/main do not expose Win32 window handles directly for other apps, you need a Windows-native helper.

#### Option A (recommended): ship your own open-source helper EXE (replace nircmd)
Create a small Windows helper similar to `windows-key-listener.c`, built in `resources/` and copied to `resources/bin/`.

Example: `windows-insert-helper.exe` supporting commands:

- `capture` → prints JSON:
  - hwnd, pid, exePath, windowTitle, className
  - caretRect (optional)
- `activate <hwnd>` → attempts to bring it to foreground
- `paste_ctrl_v` → uses `SendInput` to send Ctrl+V
- `type_unicode <text>` → types text via `KEYEVENTF_UNICODE` (fallback mode)

This gives you:
- focus control
- paste without NirCmd licensing issues
- typed fallback for apps where paste is broken

#### Option B: Node native module
Possible but increases build complexity and CI burden (node-gyp, ABI compatibility).

### Limitations you must clearly communicate to users
1. Windows may block `SetForegroundWindow` for focus-stealing prevention; you can try `AttachThreadInput`, but it’s not guaranteed.
2. `SendInput` is subject to UIPI/integrity rules — a non-elevated process can’t inject input into elevated apps. Users would need to run OpenWhispr elevated too, which has security implications.
3. Caret position retrieval is not universal; many apps draw custom carets.

Therefore:
- Provide a toggle: “Lock insertion target (best effort)”.
- Default it **ON** for Insert mode, but make failures safe.

---

## High-impact Windows reliability fixes (paste, focus, clipboard)

These fixes are critical and should be bundled with the features above, because they directly affect “really working well” on Windows 11.

### 1) Stop restoring clipboard too quickly (80ms is risky)
Some apps read clipboard asynchronously or via delayed paste processing. Restoring after 80ms can result in:
- partial paste
- paste of old clipboard contents
- app errors

**Action:** make clipboard restoration delay configurable and increase defaults:
- Windows default: 500–1500ms (start with 800ms)
- Or: “keep dictated text in clipboard” option (do not restore automatically)

Dragon’s Dictation Box has an explicit setting to keep transferred text in clipboard — users may actually want this.

### 2) Preserve all clipboard formats, not just text
Current behavior:
- reads `clipboard.readText()`
- restores only text

This can destroy user clipboard contents (images/RTF/HTML). It also creates weird failures in apps that look for other formats.

**Action:** snapshot clipboard formats using Electron:
- `clipboard.availableFormats()`
- `clipboard.readBuffer(format)` for each
- restore via `clipboard.writeBuffer(format, buffer)`
- plus `clipboard.write({ text, html, rtf, image })` where appropriate

At minimum:
- preserve image + HTML + RTF + plain text.

### 3) Address focus-stealing bugs (upstream issue #236)
If OpenWhispr comes to the foreground after transcription, you can lose the active textbox focus and insertion fails.

**Action:**
- Ensure completion handlers never call `.focus()` or show a window in a way that steals focus.
- When showing result UI automatically, prefer:
  - `showInactive()` on Windows
  - or show a Windows toast notification rather than raising the window

### 4) Replace NirCmd dependency (licensing + AV risk)
NirCmd’s license/distribution terms can be incompatible with commercial distribution, and small helper EXEs often trigger AV warnings. Also, bundling third-party closed binaries complicates trust.

**Action:** replace `nircmd.exe` with your own helper that uses `SendInput` (see above).

(If you keep NirCmd, you must verify license compatibility for your distribution model.)

---

## Windows 11 constraints & best-practice implementation guidelines

This section is about “assume nothing” Windows 11 realities.

### Microphone permissions (must-have onboarding + diagnostics)
On Windows 11, microphone access can be blocked globally or per-app. Desktop apps also depend on “Let desktop apps access your microphone”.

**Implementation:**
- Add a “Microphone access diagnostics” panel:
  - Check `navigator.mediaDevices.getUserMedia` errors.
  - Provide a button to open Windows microphone privacy settings (deep link or instructions).
- On first-run, detect failure and show a guide.

### Global hotkeys (Electron constraints + Windows reserved combos)
Electron’s `globalShortcut` has limitations:
- Some OS-reserved shortcuts cannot be registered.
- Modifier-only hotkeys are not supported reliably, hence your Windows key listener.

**Implementation:**
- Validate chosen hotkeys at configuration time:
  - Detect conflicts / registration failure
  - Offer suggestions
- Consider defaulting clipboard hotkey to a non-reserved chord.

### Foreground activation and focus rules
Windows restricts bringing other apps to the foreground.
- `SetForegroundWindow` may fail depending on foreground lock rules.
- `AttachThreadInput` can improve success rate but is complex.

**Best practice:**
- Best-effort attempt to activate target.
- If activation fails: do not keep trying; fallback to clipboard mode behavior.

### Input injection restrictions (UIPI / elevated windows)
`SendInput` cannot inject into higher-integrity (elevated) targets.

**Best practice:**
- Detect if target is elevated (advanced; optional).
- If elevated and OpenWhispr is not:
  - show: “Can’t insert into elevated apps. Copied to clipboard.”

### Packaging & code signing (Windows trust)
Unsigned Electron apps and bundled helper binaries often trigger SmartScreen or AV heuristics.

**Best practice:**
- Sign the app and shipped helper binaries.
- Follow Electron/electron-builder Windows signing guidance.
- Keep helper EXEs minimal and deterministic (no network access, no self-modifying behavior).

### Logging and in-app diagnostics (developer mode)
Users need a way to self-diagnose without sending private content.

**Best practice:**
- Add a “Diagnostics” tab:
  - paste tool availability
  - whisper server status
  - last error stack traces (redacted)
  - performance metrics  
- Provide “Copy diagnostics to clipboard” (no transcripts unless user opts in).

---

## Testing & QA plan

### Manual test matrix (Windows 11)
Test all combinations of:
- Output mode: Insert / Clipboard
- Activation: Tap / Push-to-talk
- Provider: Local Whisper / Local Parakeet / Cloud (OpenAI etc)
- Apps:
  - Notepad
  - Word
  - Chrome text area (Gmail, ChatGPT, etc)
  - VS Code editor
  - Windows Terminal / PowerShell
  - Elevated app (Notepad run as admin) → confirm fallback

### Automated tests (pragmatic)
- Unit tests:
  - dictionary batch parsing + dedupe
  - session metadata aggregation
- Integration tests:
  - DB migration: old schema → new schema
  - IPC contracts for new events

### Performance benchmarks
- Add a built-in benchmark command:
  - run N fixed test dictations against selected providers
  - report mean/median timings

---

## Phased roadmap

### Phase 1 (MVP usability) — 1–2 weeks of focused engineering
- Clipboard-only output mode + second hotkey
- Status bar with stages (indeterminate where needed)
- Store meta_json with timings/provider/outputMode
- History: show provider/mode + diagnostics

### Phase 2 (Windows reliability)
- Insertion target “lock app” (HWND) for Windows
- Clipboard restore improvements + full-format clipboard snapshot/restore
- Eliminate NirCmd dependency with your own helper (or make it optional)

### Phase 3 (Power-user features)
- Optional caret position restore (click-at-caret best-effort)
- Reprocess from history (with optional audio retention)
- Export CSV + benchmark UI

---

## Appendix: concrete code touchpoints

### Hotkeys and modes
- `main.js` — hotkey registration; windowsKeyManager start/stop; needs dual-hotkey support
- `src/helpers/windowsKeyManager.js` — extend for multiple hotkeys or multiple processes
- `resources/windows-key-listener.c` — extend protocol for multiple hotkeys (recommended)
- `src/helpers/windowManager.js` — include `outputMode` + `sessionId` payload in IPC
- `preload.js` — forward payloads to renderer callbacks
- `src/hooks/useAudioRecording.js` — branch on `outputMode`; manage session; call clipboard-only path
- `src/helpers/audioManager.js` — accept sessionId and emit progress events

### Progress/status bar
- `src/App.jsx` — add always-visible `DictationStatusBar`
- `src/hooks/useAudioRecording.js` — store and expose progress state
- `src/helpers/audioManager.js` — emit stage events

### History + diagnostics
- `src/helpers/database.js` — add `meta_json`, migrations, query updates
- `src/helpers/ipcHandlers.js` — update save/load transcriptions API
- `src/stores/transcriptionStore.ts` — update types and load logic
- `src/components/ui/TranscriptionItem.tsx` — show metadata + expand diagnostics
- `src/components/ControlPanel.tsx` — add search/filter/export UI

### Dictionary batch
- `src/components/SettingsPage.tsx` — batch input UI
- `src/helpers/ipcHandlers.js` — import/export dictionary
- `src/helpers/database.js` — merge strategy

### Windows insertion target helper
- New: `resources/windows-insert-helper.c` (or similar)
- Update packaging: `electron-builder.json` extraResources for helper
- Update clipboard insertion: `src/helpers/clipboard.js` use helper for paste/type + window activation

---

## References

(Links are included here so this report is self-contained.)

### Usability and progress feedback
- Nielsen Norman Group — “10 Usability Heuristics for User Interface Design” (visibility of system status):  
  https://www.nngroup.com/articles/ten-usability-heuristics/
- Nielsen Norman Group — “Progress Indicators Make a Slow System Less Slow”:  
  https://www.nngroup.com/articles/progress-indicators/
- Microsoft — Progress controls guidance (determinate vs indeterminate):  
  https://learn.microsoft.com/en-us/windows/apps/design/controls/progress-controls

### Dictation products and user workflows
- Nuance Dragon — Dictation Box and transfer/clipboard settings:  
  (Example docs are product/version-specific; search “Dragon Dictation Box” in official Nuance help.)
- Nuance Dragon — Export/import custom words (vocabulary list workflow):  
  (Example official help pages vary by version.)
- Wispr Flow — Dictate text to clipboard and hotkeys (Windows):  
  https://wisprflow.ai/help/how-to-use/win/dictation

### Windows focus/caret + automation constraints
- Microsoft Learn — `SetForegroundWindow`:  
  https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow
- Microsoft Learn — `AttachThreadInput`:  
  https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-attachthreadinput
- Microsoft Learn — `SendInput` (includes UIPI note):  
  https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
- Microsoft Learn — `GetGUIThreadInfo`:  
  https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getguithreadinfo
- The Old New Thing (Raymond Chen) — caret location nuances and limitations:  
  https://devblogs.microsoft.com/oldnewthing/20260107-00/?p=111634

### Electron guidance
- Electron — `globalShortcut` docs:  
  https://www.electronjs.org/docs/latest/api/global-shortcut
- Electron — Code signing (Windows/macOS):  
  https://www.electronjs.org/docs/latest/tutorial/code-signing
- electron-builder — Code signing:  
  https://www.electron.build/code-signing

### Windows 11 permissions
- Microsoft Support — Manage microphone permissions (Windows):  
  https://support.microsoft.com/windows/manage-app-permissions-for-your-microphone-in-windows-10-11

### Upstream OpenWhispr issues illustrating real-world pain points
- Issue: window stealing focus breaks insertion (#236):  
  https://github.com/OpenWhispr/openwhispr/issues/236
- Issue: paste failure into codex-cli (#224):  
  https://github.com/OpenWhispr/openwhispr/issues/224

### NirCmd license note (if you keep it)
- NirSoft NirCmd license/distribution statement:  
  https://www.nirsoft.net/utils/nircmd.html

---

## Closing notes

If you want the highest reliability on Windows **without** fighting OS focus rules, the best UX pattern is:

1) Dictate into OpenWhispr (status bar + live partial text),  
2) Copy to clipboard automatically,  
3) Provide explicit “Insert now” and “Insert to original target” buttons.

That matches real-world user workflows and avoids “text went to the wrong place” failures — while still supporting a fast “Insert mode” path when conditions are favorable.
