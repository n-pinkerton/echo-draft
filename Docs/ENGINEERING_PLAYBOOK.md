# Engineering Playbook

This guide applies to everyday changes in this repo by humans and coding agents.

## North star

Make the smallest correct change.

- Preserve existing behavior and contracts unless the task explicitly changes them.
- Keep diffs cohesive and reviewable.
- Prefer extending established patterns over redesigning working code.

## Operating loop

### 1. Understand the task and the current behavior

- Restate the goal, assumptions, and non-goals.
- Read the current source of truth in code, tests, and docs before changing behavior.
- Identify risk zones early.

Repo-specific risk zones include:

- auth and browser-based sign-in flows
- updater and installer behavior
- clipboard and paste automation
- hotkey registration and native listeners
- audio recording, temp files, and transcription cleanup
- local model download/install paths
- window/tray lifecycle and cross-platform behavior
- local history persistence and diagnostics capture

### 2. Plan for a reviewable change

- Choose the lowest-risk approach that satisfies the task.
- Keep scope tight.
- Avoid broad cleanup unless it directly supports the change.

### 3. Implement surgically

- Keep domain logic, platform wiring, and UI glue clearly separated where possible.
- Validate external input at boundaries and normalize it early.
- Prefer explicit fallbacks over hidden behavior changes.

### 4. Verify with evidence

- Run targeted tests first, then broader checks as needed.
- Add or update tests that would fail without the change.
- Never report a command as run unless you actually ran it.

Useful commands in this repo:

- `npx vitest run <path-or-filter>`
- `npm test -- <path-or-filter>`
- `npm run lint`
- `npm run typecheck`
- `npm run build:renderer`
- `npm run build:win` on Windows only

### 5. Update durable documentation

- Update docs when behavior, support flow, or maintainer workflow changes.
- Update comments only when they add durable value.
- Prefer linking to the canonical doc instead of duplicating process guidance in multiple files.

## Reviewability standards

- Keep PRs and commits focused.
- Avoid mixed-purpose diffs.
- Do not combine functional changes with broad formatting churn.
- Leave actionable TODOs only when the remaining work is genuinely out of scope.

## Testing strategy

- Prefer many small, stable tests over one broad flaky test.
- Assert observable behavior rather than implementation detail where practical.
- For bug fixes, add a regression test if the behavior is testable.
- Avoid arbitrary sleeps when a real condition can be awaited instead.

## Documentation and comment hygiene

- Self-documenting code beats comment-heavy code.
- Comments should explain intent, invariants, ordering, edge cases, or platform quirks.
- Multi-step workflows belong in canonical docs, not repeated inline across the codebase.

## Definition of done

- The task requirements are met.
- The change is verified with the right level of evidence.
- Tests and docs are updated where needed.
- Remaining risks or unverified areas are called out explicitly.
