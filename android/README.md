# EchoDraft Mobile (private Android companion)

This is a deliberately small, sideload-only companion for one EchoDraft user. It records an AAC memo, publishes it to a user-selected cloud-synced folder, and leaves transcription and cleanup to the desktop app. It has no `INTERNET` permission, backend, analytics, account system, or on-phone transcription.

## Build now (no phone required)

Prerequisites: an Android 12 or newer phone, plus Android Studio with the Android SDK installed on the PC.

From the repository root in Windows PowerShell:

```powershell
npm run android:build
```

The checked debug APK is written to:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

The helper automatically uses Android Studio's bundled Java runtime and the SDK in the normal Windows location. It runs Android unit tests and lint before assembling the APK.

## Install later

The phone does not need to be connected while building. When ready:

1. On the phone, enable Developer options and USB debugging.
2. Connect it by USB and accept the phone's debugging authorization prompt.
3. Run `npm run android:install` from the repository root.

If Windows does not list the connected phone, install its OEM USB/ADB driver and reconnect it before retrying.

The install command refuses to choose between multiple phones and does not contain or save a device identifier. It uses Android's normal debug signing for a private local install; no Play Store or release-signing setup is needed.

## One-time app setup

1. Open **EchoDraft Mobile** and allow microphone access. Allow notifications so the active-recording control is visible.
2. Tap **Choose shared inbox** and select the phone-side cloud folder reserved for EchoDraft memos. For example, choose a folder exposed by the signed-in OneDrive document provider.
3. In desktop EchoDraft, open **Control Panel → To Do → Choose folder** and select that folder's local synced PC copy.
4. To add the widget, long-press an empty area of the Android home screen, choose **Widgets**, then add **EchoDraft Mobile**. The in-app **Add home-screen widget** button can also request this when the launcher supports it.

The selected folder itself is the inbox root; do not select its parent on either device. If Android loses access because the folder is moved, deleted, or its permission is revoked, open the app and choose it again.

## Use

- Tap **Record memo** in the widget or app, then tap **Stop and send**.
- The app keeps a finalized local copy if publishing fails. Tap **Retry pending memos** after restoring folder or sync access.
- Desktop EchoDraft processes each ready memo with its currently selected transcription provider, model, and cleanup setting. Results appear in **To Do**, where their generated titles and text are searchable and they can be copied and marked actioned.

When a mobile operation fails, EchoDraft keeps a privacy-safe rolling diagnostic locally and makes a best-effort copy named `echodraft-mobile-diagnostics.jsonl` in the selected shared folder. If OneDrive or the folder is unavailable, the local copy is retried when the app next opens, a folder is selected, or a memo upload/retry finishes. Diagnostic storage and provider work runs on application-scoped workers and never gates recording or memo completion. The file contains at most the latest 20 failures (64 KiB total): stable event codes, app/API versions, exception types, and EchoDraft source locations. It never includes exception messages, dictation text, audio, folder paths or URIs, credentials, or phone/device identifiers. Desktop EchoDraft ignores this support file.

Recordings are capped at 32 MB. The Android app does not paste text or perform local transcription.

If Android reaches its hard recording limit but cannot produce a valid M4A container, EchoDraft never publishes it as ready. It retains the raw result privately under the app's no-backup storage for manual recovery instead of risking a corrupt To Do item.
