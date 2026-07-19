# EchoDraft Mobile (private Android companion)

This is a deliberately small, sideload-only companion for one EchoDraft user. It records an AAC memo, publishes it to EchoDraft's private OneDrive app folder, and leaves transcription, cleanup, and title generation to the desktop app. It has no custom backend, analytics, client secret, app-store release flow, or on-phone transcription.

Microsoft sign-in is handled by MSAL. EchoDraft requests only delegated `Files.ReadWrite.AppFolder` access, so it can use its own `Apps/EchoDraft Mobile Inbox` folder rather than the rest of OneDrive. MSAL owns the token cache; EchoDraft never stores or logs tokens or account names.

## Build (no phone required)

Prerequisites: Android Studio with the Android SDK installed on the PC. Android 12 or newer is required only when installing.

From the repository root in Windows PowerShell:

```powershell
npm run android:build
```

The helper uses Android Studio's bundled Java runtime, runs Android unit tests and lint, and writes the checked debug APK to:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

An unconfigured checkout can still build and run tests. Installation requires the private Microsoft values below so an unusable build cannot be installed accidentally.

## Private Microsoft setup

This is one-time setup for this user and this PC's Android debug-signing key. No client secret is created.

1. Create a single-tenant Microsoft Entra public-client app named **EchoDraft Mobile Inbox**.
2. Add an Android platform with package name `com.echodraft.mobile` and the Base64 SHA-1 signature hash of this PC's debug certificate.
3. Add delegated Microsoft Graph permission `Files.ReadWrite.AppFolder` and grant/accept consent for the intended account.
4. Put the public identifiers in ignored `android/local.properties` entries:

```properties
echodraft.msalClientId=<application-client-id>
echodraft.msalTenantId=<directory-tenant-id>
echodraft.msalSignatureHash=<raw-base64-sha1-signature>
```

Keep any existing `sdk.dir` entry. The file is ignored by Git and must never be committed. The client ID, tenant ID, and signature hash are not passwords, but keeping this user-specific configuration local avoids publishing account metadata. See Microsoft's [MSAL Android configuration](https://learn.microsoft.com/en-us/entra/msal/android/msal-configuration) and [OneDrive app-folder guidance](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder).

## Install

1. On the phone, enable Developer options and USB debugging.
2. Connect it by USB, unlock it, and accept the debugging authorization prompt.
3. Run `npm run android:install` from the repository root.

The install command validates that the three private Microsoft values exist, refuses to choose between multiple phones, and never contains or saves a device identifier. It uses Android's normal debug signing for this private local install; no Play Store or release-signing setup is needed.

## One-time app setup

1. Open **EchoDraft Mobile** and tap **Connect OneDrive**. Complete Microsoft sign-in and consent. EchoDraft creates/opens `Apps/EchoDraft Mobile Inbox` automatically.
2. Tap **Start recording** once. When Android asks in context, allow microphone access; also allow notifications so the active-recording control is visible. EchoDraft then starts that recording, so dictate a short test memo and tap **Stop recording**. The widget remains in **Set up** mode until both OneDrive is connected and microphone access is granted.
3. Wait for OneDrive on the PC to sync the app folder. In desktop EchoDraft, open **Control Panel → To Do → Choose folder** and select its local copy, normally `OneDrive - <organisation>\Apps\EchoDraft Mobile Inbox`.
4. To add the compact 2×1 widget, long-press an empty area of the Android home screen, choose **Widgets**, then add **EchoDraft Mobile**. The in-app **Add home-screen widget** button can also request this when the launcher supports it.

If sign-in expires, open the app and tap **Reconnect OneDrive**. The widget uses only cached local readiness state; it never performs authentication or network work in a broadcast callback.

If the app says OneDrive is connected but the widget still says **Set up**, open the app and tap **Start recording** to trigger Android's microphone permission prompt. After granting it, finish or stop the recording that EchoDraft starts. Granting the permission refreshes existing widget instances; deleting and re-adding the widget is unnecessary.

## Use and failure behavior

- Tap **Record** in the widget or app, then tap **Stop**.
- While EchoDraft saves and uploads a memo, the widget replaces its action button with a progress spinner. After a successful upload, its small status line shows the last upload date and time to the minute.
- EchoDraft writes and verifies audio before publishing the ready manifest. Create uploads fail on name conflicts, and final audio and manifest identities, sizes, and bytes are rechecked together before the private phone copy can be removed.
- A failed sign-in, network request, conflict, or verification leaves the finalized memo on the phone. Tap **Retry pending uploads** after restoring access.
- Desktop EchoDraft uses its currently selected transcription provider, model, cleanup setting, and title contract. Results appear in **To Do**, where generated titles and text are searchable and items can be copied and marked actioned.

While its dictation renderer is ready, desktop EchoDraft checks the selected local OneDrive folder every five seconds. After it has verified the upload and saved the cleaned memo to **To Do**, it removes that memo's audio and ready-manifest pair. The sync folder being empty after processing is therefore normal; successfully handled recordings can disappear from it quickly.

When a mobile operation fails, EchoDraft keeps a content-free rolling diagnostic locally and makes a best-effort copy named `echodraft-mobile-diagnostics.jsonl` in the OneDrive app folder. If OneDrive is unavailable, the local copy is retried when the app opens or a memo upload/retry finishes. Local storage and Graph publication run on separate application workers and never gate recording completion. The file contains at most the latest 20 failures (64 KiB total): stable event codes, app/API versions, exception types, pending counts, and EchoDraft source locations. A strict allowlist rejects exception messages, dictation text, audio, paths/URIs, credentials, account details, and phone/device identifiers. Desktop EchoDraft ignores this support file.

Recordings are capped at 32 MB. The Android app does not paste text or perform local transcription. If Android reaches the hard recording limit but cannot produce a valid M4A container, EchoDraft never publishes it as ready and retains the raw result privately for manual recovery.
