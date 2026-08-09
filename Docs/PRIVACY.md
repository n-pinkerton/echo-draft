# Privacy Notes

EchoDraft is built to keep as much data local as practical, and to make cloud behavior explicit.

## What stays local

- local transcripts and history stored on your machine
- actioned mobile To Dos in the locally searchable Archived view
- explicit correction rules, application process-name style mappings, and reason-only correction flags
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
- Reprocessing uses the exact stored raw transcript and may send that text to the selected cleanup provider. It stores a linked alternative locally, leaves the source unchanged, copies the result, and never pastes or submits it automatically.
- Application styles use a manually saved process name and one fixed Document, Message, or Technical value. EchoDraft does not capture or send window titles, selections, screenshots, clipboard contents, or surrounding text for style routing. Codex prompt mode ignores application styles.
- **Settings → Developer → Delete logs and transcripts older than 30 days** is separate from diagnostic cleanup. After two confirmations it can delete previewed History, pending and actioned To Dos, their linked alternatives/flags, and verified desktop JSONL logs strictly older than one UTC cutoff. It excludes captured audio, mobile inbox data and diagnostics, settings, auth, models, dictionaries, correction rules, and app profiles.
- Review `Docs/SECURITY.md` and `Docs/LOGGING.md` before sharing logs, screenshots, exports, or copied commands.
- If you work in this public repository, re-check for sensitive information before every commit, release, and final handoff.
