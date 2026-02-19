# Windows Installer Build Runbook

This runbook explains how to build the **Windows NSIS installer** (`EchoDraft Setup <version>.exe`) for this repo.

> Important: Windows packaging **must** run on Windows (native modules like `better-sqlite3` are platform-specific). The build is intentionally blocked on non-Windows by `scripts/require-windows.js`.

## Quick start (PowerShell on Windows)

From a copy of the repo that lives on the Windows filesystem:

```powershell
cd C:\path\to\openwhispr
npm ci
npm run build:win

# Copy installer to Downloads (for in-place upgrade testing)
Copy-Item ".\dist\EchoDraft Setup *.exe" "$env:USERPROFILE\Downloads\" -Force
```

## Outputs

After a successful build, `dist/` contains:

- `EchoDraft Setup <version>.exe` — **NSIS installer** (use this to install/reinstall/upgrade)
- `EchoDraft <version>.exe` — **portable** build (runs in-place; does **not** upgrade an installed app)

> Tip: You may also see older artifacts named `OpenWhispr Setup <version>.exe` from earlier builds. Make sure you copy/install the **EchoDraft Setup** one produced by your current build.

## Building from WSL (recommended workflow if you develop in WSL)

Build on Windows, but keep your development environment in WSL.

### 1) Copy repo → Windows temp (from WSL)

This mirrors the repo into a Windows folder while keeping big/host-specific directories out of the copy:

```bash
rsync -a --delete \
  --exclude ".git" --exclude "node_modules" --exclude "dist" --exclude "resources/bin" \
  ./ /mnt/c/Users/<you>/AppData/Local/Temp/openwhispr-winbuild/
```

Notes:
- Excluding `resources/bin` keeps previously-downloaded helper binaries in the Windows build folder (faster builds, fewer network calls).
- If this is your **first** build on a new machine/folder, you may want to *not* exclude `resources/bin` (or copy it from a known-good location) so the downloads don’t have to start from scratch.

### 2) Build in PowerShell (on Windows)

```powershell
cd $env:TEMP\openwhispr-winbuild
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
2. If it’s missing, populate it from a known-good source (for example, from a previously installed app under `...\OpenWhispr\resources\bin\`) and re-run the build.
3. If you actually want to re-download, force it:

```powershell
npm run download:whisper-cpp -- --force
```

Also consider setting `GITHUB_TOKEN`/`GH_TOKEN` if you are hitting GitHub API rate limits.

### `windows-key-listener` download/compile messages are confusing

The Windows push-to-talk key listener build script can attempt:
- download of a prebuilt `windows-key-listener.exe`, or
- local compilation if download fails.

If it cannot obtain the binary, the app still builds, but Windows push-to-talk may fall back to a less capable mode. Installing **Visual Studio Build Tools** (or MinGW-w64) enables local compilation.

### electron-builder warning: “cannot find path for dependency name=undefined reference=undefined”

We saw this warning during packaging, but the build still succeeded and produced working artifacts.

If builds start failing around this point, capture `dist/builder-debug.yml` and the full console output for investigation.

### Code signing failures

If your environment doesn’t have a signing certificate and electron-builder fails while signing, you can disable auto-discovery for local builds:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY="false"
npm run build:win
```

## Validating the installer

1. Run the NSIS installer from `dist/` (or `Downloads/` if copied).
2. Confirm the installed app launches.
3. If you’re debugging dictation issues, enable debug logging in-app and collect:
   - `logs/openwhispr-debug-YYYY-MM-DD.jsonl`
   - `logs/audio/` (last 10 recorded audio clips, rolling retention)

## Debugging “truncated” transcriptions (runbook)

If a transcription looks “cut off”, there are two different failure modes:

1) The **audio recording stopped early** (e.g. hotkey pressed again, push-to-talk released, mic device ended).
2) The audio is long, but the **transcription result is incomplete** (API/provider issue).

### Source of truth: DB + debug logs

- **DB** (history): `C:\\Users\\<you>\\AppData\\Roaming\\open-whispr\\transcriptions.db`
- **Debug logs**: `C:\\Users\\<you>\\AppData\\Local\\Programs\\OpenWhispr\\EchoDraft\\logs\\openwhispr-debug-YYYY-MM-DD.jsonl`
- **Saved audio** (debug enabled): `C:\\Users\\<you>\\AppData\\Local\\Programs\\OpenWhispr\\EchoDraft\\logs\\audio\\` (last 10 clips)

### What to check first

In the Control Panel → History item “Diagnostics”:

- `Record` is the measured recording duration (shows `Xs` under 60 seconds, otherwise `M:SS`).
- `Raw transcript` shows what the STT provider returned **before** cleanup.
- `Copy` copies the full cleaned transcript (`item.text`) — if it’s short, the stored text is short (not a UI preview issue).

### Useful metadata fields (recent builds)

Newer builds persist extra fields into `meta_json.timings` to make this debuggable:

- `stopReason` / `stopSource` (e.g. `manual`, `released`, `track-ended`)
- `audioSizeBytes`, `audioFormat`, `chunksCount`
- Recording start timing breakdown:
  - `hotkeyToStartCallMs`, `hotkeyToRecorderStartMs`
  - `startConstraintsMs`, `startGetUserMediaMs`, `startMediaRecorderInitMs`, `startMediaRecorderStartMs`, `startTotalMs`

If something fails again, grab the matching JSONL session logs and the `.webm` from `logs/audio/` (if debug was enabled) and we can replay/transcribe the exact captured audio to confirm whether the recording itself stopped early vs. transcription truncation.
