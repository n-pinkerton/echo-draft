# Privacy Notes

EchoDraft is built to keep as much data local as practical, and to make cloud behavior explicit.

## What stays local

- local transcripts and history stored on your machine
- downloaded local speech and reasoning models
- clipboard and paste automation state
- local debug logs and saved debug audio captures when you enable them

## What may leave your device

- audio sent to selected cloud transcription providers
- text sent to selected cloud reasoning providers
- authentication traffic needed for EchoDraft account features

## Operational guidance

- Use local transcription and local reasoning when you need the strongest privacy posture.
- Turn debug logging on only for active troubleshooting because logs and saved audio can contain sensitive content.
- Review `Docs/SECURITY.md` and `Docs/LOGGING.md` before sharing logs, screenshots, exports, or copied commands.
- If you work in this public repository, re-check for sensitive information before every commit, release, and final handoff.
