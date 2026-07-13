# Windows Installer Build Runbook

This runbook explains how to build the **Windows NSIS installer** (`EchoDraft Setup <version>.exe`) for this repo.

> Important: Windows packaging **must** run on Windows (native modules like `better-sqlite3` are platform-specific). The build is intentionally blocked on non-Windows by `scripts/require-windows.js`.

## Quick start (PowerShell on Windows)

From a copy of the repo that lives on the Windows filesystem:

```powershell
cd C:\path\to\echo-draft
npm ci
npm run build:win

# Copy installer to Downloads (for in-place upgrade testing)
Copy-Item ".\dist\EchoDraft Setup *.exe" "$env:USERPROFILE\Downloads\" -Force
```

## Outputs

After a successful build, `dist/` contains:

- `EchoDraft Setup <version>.exe` — **NSIS installer** (use this to install/reinstall/upgrade)
- `EchoDraft <version>.exe` — **portable** build (runs in-place; does **not** upgrade an installed app)

> Tip: Make sure you copy/install the **EchoDraft Setup** artifact produced by your current build, not an older portable or archived installer.

## Building from WSL (recommended workflow if you develop in WSL)

Build on Windows, but keep your development environment in WSL.

### 1) Copy repo → Windows temp (from WSL)

This mirrors the repo into a Windows folder while keeping big/host-specific directories out of the copy:

```bash
rsync -a --delete \
  --exclude ".git" --exclude "node_modules" --exclude "dist" --exclude "resources/bin" \
  ./ /mnt/c/Users/<you>/AppData/Local/Temp/echodraft-winbuild/
```

Notes:

- Excluding `resources/bin` keeps previously-downloaded helper binaries in the Windows build folder (faster builds, fewer network calls).
- If this is your **first** build on a new machine/folder, you may want to _not_ exclude `resources/bin` (or copy it from a known-good location) so the downloads don’t have to start from scratch.

### 2) Build in PowerShell (on Windows)

```powershell
cd $env:TEMP\echodraft-winbuild
npm ci
npm run build:win
Copy-Item ".\dist\EchoDraft Setup *.exe" "$env:USERPROFILE\Downloads\" -Force
```

## Common problems + fixes

### “Windows packaging must be run on Windows.”

This comes from `scripts/require-windows.js`.

Fix: run the build from **Windows PowerShell/CMD**, not from Linux/WSL:

```powershell
npm run build:win
```

### `download:whisper-cpp` fails (GitHub 404 / no releases)

During this session, `scripts/download-whisper-cpp.js` initially failed with an HTTP 404 when trying to fetch releases from `EchoDraft/whisper.cpp`.

What we changed:

- `scripts/download-whisper-cpp.js` now **skips the download** if `resources/bin/whisper-server-win32-x64.exe` already exists (unless you pass `--force`).

If you hit download failures on a fresh machine:

1. Check whether the binary exists:
   - `resources/bin/whisper-server-win32-x64.exe`
2. If it’s missing, populate it from a known-good source (for example, from a previously built app under `...\EchoDraft\resources\bin\`) and re-run the build.
3. If you actually want to re-download, force it:

```powershell
npm run download:whisper-cpp -- --force
```

Also consider setting `GITHUB_TOKEN`/`GH_TOKEN` if you are hitting GitHub API rate limits.

### `windows-key-listener` integrity failure

The reviewed Windows push-to-talk helper is repository-managed. Before development and release
builds, `npm run compile:winkeys` verifies both the C source and executable against
`resources/windows-key-listener.integrity.json`.

The build now fails if the helper is missing, stale, or changed. It never downloads a mutable
`latest` release. Restore the reviewed files from source control; if the source legitimately
changes, rebuild and adversarially review the helper, then update both pinned hashes together.

### electron-builder warning: “cannot find path for dependency name=undefined reference=undefined”

We saw this warning during packaging, but the build still succeeded and produced working artifacts.

If builds start failing around this point, capture `dist/builder-debug.yml` and the full console output for investigation.

### Code signing failures

If your environment doesn’t have a signing certificate and electron-builder fails while signing, you can disable auto-discovery for local builds:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run build:win
```

`npm run build:win` can also complete with unsigned artifacts when no Windows certificate is configured. Before distributing an installer, verify it explicitly with `Get-AuthenticodeSignature`; a local `NotSigned` result is suitable only for a trusted personal install, not a public release.

Unsigned Windows builds also disable EchoDraft's in-app automatic updater. This is intentional: install a locally verified Setup artifact manually. Automatic update checks, downloads, and installs are enabled only when Windows code signing is configured with at least one pinned publisher name.

## Validating the installer

1. Run the NSIS installer from `dist/` (or `Downloads/` if copied).
2. Confirm the installed app launches.
3. If you’re debugging dictation issues, enable debug logging in-app and collect:
   - `logs/echodraft-debug-YYYY-MM-DD.jsonl`
   - `logs/audio/` (last 10 recorded audio clips, rolling retention)

## Debugging “truncated” transcriptions (runbook)

If a transcription looks “cut off”, there are two different failure modes:

1. The **audio recording stopped early** (e.g. hotkey pressed again, push-to-talk released, mic device ended).
2. The audio is long, but the **transcription result is incomplete** (API/provider issue).

Current OpenAI streaming builds require an explicit completion event. If a stream closes early, EchoDraft rejects the partial text and retries once through the complete non-streaming path rather than storing the fragment.

### Source of truth: DB + debug logs

- **DB** (history): `C:\\Users\\<you>\\AppData\\Roaming\\EchoDraft\\transcriptions.db`
- **Debug logs**: `C:\\Users\\<you>\\AppData\\Local\\Programs\\EchoDraft\\logs\\echodraft-debug-YYYY-MM-DD.jsonl`
- **Saved audio** (debug enabled): `C:\\Users\\<you>\\AppData\\Local\\Programs\\EchoDraft\\logs\\audio\\` (last 10 clips)

### What to check first

In the Control Panel → History item “Diagnostics”:

- `Record` is the measured recording duration (shows `Xs` under 60 seconds, otherwise `M:SS`).
- `Raw transcript` shows what the STT provider returned **before** cleanup.
- `Copy` copies the full cleaned transcript (`item.text`) — if it’s short, the stored text is short (not a UI preview issue).

### Useful metadata fields (recent builds)

Newer builds persist extra fields into `meta_json.timings` to make this debuggable:

- `stopReason` / `stopSource` (e.g. `manual`, `released`, `track-ended`)
- `audioSizeBytes`, `audioFormat`, `chunksCount`
- `transcriptionRecovery` when an incomplete stream was recovered through the complete-response retry
- Recording start timing breakdown:
  - `hotkeyToStartCallMs`, `hotkeyToRecorderStartMs`
  - `startConstraintsMs`, `startGetUserMediaMs`, `startMediaRecorderInitMs`, `startMediaRecorderStartMs`, `startTotalMs`

If something fails again, grab the matching JSONL session logs and the `.webm` from `logs/audio/` (if debug was enabled) and we can replay/transcribe the exact captured audio to confirm whether the recording itself stopped early vs. transcription truncation.

### Windows hotkey recovery

Current builds route ordinary Windows tap shortcuts through the native listener when available, suppress key-repeat events, and restart listeners after resume, unlock, or an unexpected helper exit. The Electron shortcut remains a fallback when a native route cannot start. For packaged verification, use `scripts/gate/windows_release_gate.js` and confirm both configured routes report ready. The gate defaults to a non-interactive smoke mode that keeps app windows hidden, will not take foreground, and will not type into a window. Visual screenshots, target capture, automatic insertion, and clipboard-image restoration are reserved for `--allow-foreground-automation` on a dedicated idle test desktop.
