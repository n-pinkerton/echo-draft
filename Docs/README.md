# Documentation Map

This directory is the maintainers' index for durable engineering guidance. Keep it lean and use one canonical home per topic.

## Canonical sources

- `README.md`: user-facing overview, install/build/run instructions, and contributor entry points.
- `CLAUDE.md`: technical architecture, module inventory, and fast-moving integration details.
- `DEBUG.md`: debug capture workflow, log file behavior, and support-oriented diagnostics.
- `TROUBLESHOOTING.md`: general troubleshooting flow.
- `WINDOWS_TROUBLESHOOTING.md`: Windows-only troubleshooting.
- `README_WINDOWS_INSTALLER_BUILD.md`: Windows installer packaging runbook.
- `AGENTS.md`: short repo-root instructions for coding agents.

## Repo standards

- `Docs/ENGINEERING_PLAYBOOK.md`: change workflow, verification strategy, and reviewability standards.
- `Docs/COMMENTING_GUIDELINES.md`: when to comment, what to document, and where that guidance belongs.
- `Docs/LOGGING.md`: logging and telemetry rules for code changes.
- `Docs/SECURITY.md`: secrets, privacy, and security-safe engineering defaults.
- `Docs/PRIVACY.md`: end-user and maintainer data-handling notes.

## Source-of-truth rules

- Prefer updating one canonical file over copying the same guidance into multiple docs.
- Keep fast-moving model, provider, and feature inventories in `README.md` or `CLAUDE.md`, not in multiple standards docs.
- If docs and code disagree, treat code and tests as the final contract, then fix the stale docs in the same change when practical.
- Use repo-relative paths in docs so guidance survives different machines and install locations.

## Recommended reading by task

- Any code change: `Docs/ENGINEERING_PLAYBOOK.md`, `Docs/COMMENTING_GUIDELINES.md`, `Docs/LOGGING.md`, `Docs/SECURITY.md`
- Architecture discovery: `CLAUDE.md`
- Debugging or support work: `DEBUG.md`, `TROUBLESHOOTING.md`, `WINDOWS_TROUBLESHOOTING.md`
- Packaging or release validation: `README_WINDOWS_INSTALLER_BUILD.md`

## Maintenance rule

When you add a new durable guide, link it here and remove or trim any duplicated guidance elsewhere.
