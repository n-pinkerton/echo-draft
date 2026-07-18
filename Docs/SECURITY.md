# Security Notes

This repo handles authentication, local transcript history, clipboard automation, downloaded binaries, and debug artifacts. Treat those areas as security-sensitive by default.

## Public repo directive

This is a public open-source repository. While working in it, and again before finalising any task, explicitly check whether the changed files, generated artifacts, logs, screenshots, docs, or copied commands contain sensitive information.

- If you find or even suspect secrets, tokens, credential-bearing URLs, private keys, personal data, transcript text, clipboard contents, or raw debug captures, stop and draw the user's attention to it clearly before committing, publishing, or sharing anything.
- Do not assume a file is safe just because it already exists in the repo or output directory.

## Non-negotiables

- Never commit secrets, tokens, passwords, or credential-bearing URLs.
- Never paste sensitive diagnostics or secrets into docs, issues, or chat.
- Keep real values in local environment files or approved secret stores, not in tracked files.
- Treat transcript text, clipboard contents, saved audio, and auth data as sensitive user data.

## Secure coding defaults

- Validate external input at trust boundaries.
- Treat URLs, filesystem paths, provider responses, logs, and web content as untrusted data.
- Do not show raw internal errors to end users.
- Prefer safe defaults and least-privilege behavior for filesystem, process, and network operations.
- Use established libraries for crypto and auth flows rather than inventing custom schemes.

## Repo-specific risk areas

- OAuth or browser-based auth redirects
- downloaded helper binaries and model artifacts
- clipboard and paste automation
- local database contents and export flows
- debug logs and saved audio captures
- updater and installer behavior
- mobile inbox audio and manifests in user-selected sync folders

The mobile inbox has no inbound network listener. Treat its sync folder as untrusted input: accept only the versioned UUID-based filename pair, reject symbolic roots/files, read through bounded stable file handles, and verify declared size and SHA-256 before dispatch. Bind processing to a canonical root snapshot, then atomically claim and revalidate the exact files before deletion or quarantine so a replacement at the original pathname is preserved. Delete verified audio before the claimed ready manifest, and retry a partial cleanup after an idempotent To Do save. Retry cloud-settling input before quarantining only a repeatedly stable invalid manifest; use a long retry interval when identity cannot be established safely. Manifests and metadata must not contain phone numbers, serial numbers, IMEIs, SIM details, or other device identifiers.

The optional `echodraft-mobile-diagnostics.jsonl` support file is not an inbox manifest. Keep it bounded, content-free, and safe to sync: stable event codes and app-owned source locations are permitted; exception messages, provider/folder URIs, credentials, device identifiers, dictation text, and audio are not. The desktop scanner must ignore this file and continue accepting only the UUID-based ready-manifest contract.

## Logging and privacy

- Follow `Docs/LOGGING.md` for redaction and field selection.
- Follow `DEBUG.md` for the support workflow around sensitive debug captures.
- Avoid storing more sensitive data than the feature actually needs.

## If you find a security issue

1. Contain the issue first if continued execution could leak or corrupt user data.
2. Preserve only the minimum safe evidence needed to reproduce and fix it.
3. Add regression coverage when the issue is testable.
4. Update the relevant docs or runbook so the fix is durable.

If the issue looks exploitable, report it privately to the maintainer instead of opening a public issue with full exploit details.
