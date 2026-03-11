# Commenting Guidelines

Comments should make this repo easier to change, not louder to read.

## Core rules

1. Prefer self-documenting code first.
2. Comments must add information the code does not already say.
3. Update or delete stale comments in the same change that makes them stale.
4. Keep one canonical home for each important explanation.

## What comments are for

Use comments to explain:

- non-obvious intent
- invariants and preconditions
- ordering requirements
- platform-specific quirks
- workaround rationale
- safety constraints
- edge cases and failure modes

In this repo, high-value comments often explain things like:

- why a window is shown or focused in a specific order
- why a platform fallback exists for clipboard or hotkey behavior
- why a native helper is required on one OS but not another
- why a cleanup or retention step must happen even on failure

## What not to comment

Avoid comments that merely narrate:

- what a variable assignment does
- what a JSX branch visibly says already
- what a function name already makes obvious
- large workflow descriptions that belong in `Docs/` or a runbook

## Choosing the right place

- No comment: when naming and structure already make the code obvious
- Inline `//` comment: local rationale or constraint for maintainers
- Doc comment: exported function, hook, manager, or IPC surface that is easy to misuse
- Canonical doc: architecture, support flows, packaging steps, or cross-file behavior

## Style

- Put comments directly above the code they explain.
- Keep them short and factual.
- Prefer explaining why something is safe over merely saying it is a workaround.
- Use repo-relative paths when pointing readers to a longer doc.
