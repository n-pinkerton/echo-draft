# Logging Guidelines

This document governs logs added in code. For the support workflow and debug-file behavior, use `DEBUG.md` as the operational source of truth.

## Goals

- Make failures diagnosable without replaying the entire app in a debugger.
- Keep normal logs high-signal.
- Protect user data and secrets.

## What to log

Prefer structured logs around boundaries and state transitions:

- app startup and shutdown
- auth/session transitions
- hotkey registration and native listener availability
- recording, transcription, paste, save, and cleanup stages
- model download/install lifecycle
- updater and packaging flows
- window and tray transitions when they affect user-visible behavior

Useful fields usually include:

- `scope`
- `operation`
- `sessionId`
- `jobId`
- `platform`
- `provider`
- `model`
- `hotkeyId`
- `durationMs`
- `attempt`
- `errorCode`

## What not to log

Never log:

- API keys, tokens, passwords, or credential-bearing URLs
- raw auth callback URLs or secrets embedded in query strings
- full clipboard contents by default
- transcript text or recorded audio unless the code path is explicitly part of the debug capture flow described in `DEBUG.md`
- full request bodies or provider payloads when summaries or IDs are enough

## Log shape

- Prefer stable message names over clever prose.
- Log start, success, and failure at major boundaries.
- Include enough identifiers to correlate related events.
- Avoid per-chunk or per-render noise at normal log levels.
- Use debug/trace detail only when it materially helps diagnosis.

## Error logging

- Include the safe error summary plus structured context.
- Do not surface raw internal errors directly to end users.
- When a failure has a fallback path, log both the failure and the fallback route.

## When adding new diagnostics

- If the change affects the user-facing debug workflow, update `DEBUG.md` too.
- If the new log exists only to support one temporary investigation, remove it before closing the task unless it provides lasting operational value.
