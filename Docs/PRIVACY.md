# Privacy Notes

EchoDraft is built to keep as much data local as practical, and to make cloud behavior explicit.

## What stays local

- local transcripts and history stored on your machine
- downloaded local speech and reasoning models
- clipboard and paste automation state
- local debug logs and rolling source-audio captures for completed dictations

## What may leave your device

- audio sent to selected cloud transcription providers
- text sent to selected cloud reasoning providers
- authentication traffic needed for EchoDraft account features

## Operational guidance

- Use local transcription and local reasoning when you need the strongest privacy posture.
- Audio captures are retained independently of the debug logging toggle so a transcription failure can be diagnosed. They are sensitive voice data; use **Settings → Developer → Delete Diagnostic Data** after troubleshooting to remove EchoDraft-named daily logs and rolling audio captures. Disable debug mode first if you do not want a fresh diagnostic log created.
- Review `Docs/SECURITY.md` and `Docs/LOGGING.md` before sharing logs, screenshots, exports, or copied commands.
- If you work in this public repository, re-check for sensitive information before every commit, release, and final handoff.
