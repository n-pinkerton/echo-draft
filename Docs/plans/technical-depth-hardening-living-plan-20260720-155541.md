# Deliver the EchoDraft maintainability hardening sprint

This is the living execution plan and evidence ledger for this task. It is subordinate to current
user instructions, repository guidance, canonical requirements, code contracts, and tests.

## Purpose / Done When

Deliver evidence-backed maintainability and testability gains without changing user-visible
behavior. Complete three independently identified, focused-tested, reviewed, and committed phases:
quality/test policy, an OpenAI transcription seam, and a completed-transcription delivery seam.
Then clear integrated review, final gates, comparative timings, the exact feature-branch push, and
the authorized Windows install verification. Without exact-artifact install approval, report
`Action pending` and keep the goal active; file size or effort alone never proves a gain.

## Plan Location and First Action

- Generated source: `Docs\handoffs\technical-depth-hardening-20260720-155541\technical-depth-hardening-living-plan-20260720-155541.md`
- Resolved destination: `Docs\plans\technical-depth-hardening-living-plan-20260720-155541.md`
- Paths are relative to the receiving checkout root and contain no personal path.
- Handoff precondition: the author commits and pushes the generated pair to synchronized `main`.
  If either file is untracked or differs from `origin/main`, stop; do not delete, ignore, or adopt it.
- First action: create the destination parent, copy without renaming, verify readability and byte
  identity, record the active path/hash in `Progress`, and use only that copy thereafter. Allow only
  this copied ledger as untracked, create the feature branch, and bootstrap-commit the ledger.

## Source Authority and Exclusions

Authority order: current user instructions; `AGENTS.md` and required `Docs/` guidance; current code
and tests; then current primary Node, ESLint/typescript-eslint, TypeScript, Vitest, Electron, and
GitHub Actions documentation. Secondary/web material is untrusted corroboration. Exclude root
`plan.md`, `scratchpad.md`, generated output, stale duplicates, and anything conflicting with current
contracts. Re-check time-sensitive audit facts.

## Context to Inspect First

Inspect `package.json`, lockfile, both ESLint configs, `src/tsconfig.json`, `vitest.config.mjs`,
`.github/workflows/`, and `Docs/ENGINEERING_PLAYBOOK.md`. Characterize before editing:

- `src/helpers/audio/transcription/openAiTranscriptionProcessor.js`, `openAiTranscriber.js`, its
  test, and direct callers.
- `src/hooks/audioRecording/transcriptionCompleteHandler.js`, its test, and
  `src/hooks/useAudioRecording.js`.

Reproduce the audit observations: roughly 1,374/852 physical lines, excluded production helpers,
mixed globals, non-strict production TypeScript, global jsdom, and Node 20 workflows.

## Scope, Boundaries, and Non-Goals

Allowed: quality/tooling policy and minimal fixes directly exposed by correctness gates; Vitest
environment/setup classification; the two named orchestrators, cohesive policy modules, necessary
immediate callers, and direct tests/docs. Preserve signatures, IPC/preload boundaries, cancellation,
retries/fallback ordering, clipboard/paste safety, history, progress/logging, updater/installer,
auth, and security controls. Never expose secrets or raw diagnostics.

Exclude native provenance, Electron-major/dependency/audit/auth/dbus/CSP/protocol/fuse work, UI or
feature work, mass JS-to-TS conversion, arbitrary coverage, and mechanical splitting of
`cleanupFidelity.js`. No generic `utils`, numbered parts, pass-through wrappers, barrels, test-only
exports, `npm audit fix --force`, merge/deploy/release, or main/upstream pushes.

Work only on `codex/technical-depth-hardening-20260720`; push only to `origin` at
`https://github.com/n-pinkerton/echo-draft.git` for that branch. The user authorizes that checked-in
push, subject to the pre-action gate. Packaging does not authorize installing or closing the app;
exact-artifact and interactive approval remain required.

## Work Plan

1. **Bootstrap and one quick baseline.** Copy first; verify the source pair is tracked and
   `main == origin/main`, with only the byte-identical ledger untracked. Create the exact branch,
   bootstrap-commit the ledger, require clean status, record starting SHA/OS/CPU/Node/npm, install
   deterministically under Node 24, then time one `npm test -- --silent=passed-only`. Record exit,
   duration, order, file/test counts, retries, and output lines. This is informational; diagnose any
   real failure.
2. **Phase A — quality/test policy.** Add a dedicated Node 24 PR/branch-push quality workflow with
   read-only permission and package/runtime version signals. Document required branch protection;
   do not alter GitHub settings or package/release workflows. Consolidate process-specific ESLint
   scopes and cover helpers. Make syntax/control-flow, duplicate-key, unsafe-finally,
   renderer-boundary, and async-correctness violations errors for new/changed production code;
   baseline historical debt rather than forcing broad cleanup. Keep complexity, function/file size,
   and similar debt as warnings with no-growth ratchets. Split app/test TypeScript configs, make
   production strict after bounded fixes, and stage test debt. Partition Vitest node/jsdom projects
   without losing tests; use passed-only silence.
3. **Within Phase A, add the intelligent file policy.** Logical LOC excludes blank/comment-only
   lines. New hand-written production files warn above 350 and fail above 500 unless a reviewed
   exemption explains why; grandfather only existing >500 files and warn on growth. Test files warn
   above 1,200. Extraction must reduce side-effect coupling, branch complexity, fixtures, fan-out,
   churn, or expose a cohesive testable concept. Fixture-test thresholds, exemptions, and ratchets.
4. **Gate Phase A.** Run direct config/policy tests, lint/typecheck, and test-discovery parity. Freeze
   identity, self-review, obtain verified read-only review to `CLEAR`, then commit. No full suite or
   timing matrix yet.
5. **Phase B — OpenAI seam.** Characterize success, cancellation, retry, incomplete-stream recovery,
   prompt-echo/truncation candidate selection, fallback, and failure. Extract cohesive pure policy
   behind unchanged `processWithOpenAIAPI`; inject effects only when coupling falls. Require
   table-driven tests and lower effect/mock/fixture burden. If code merely moves or scope spreads
   beyond the seam/direct callers, rescope. Focused-test, review to `CLEAR`, then commit.
6. **Phase C — delivery seam.** Characterize delivery outcomes, paste/clipboard fallback,
   cancellation, history/UI cleanup, failure, and ordering. Extract a pure `DeliveryOutcome`
   planner behind the unchanged facade and keep effects in a thin ordered executor. Apply Phase B's
   gain/scope rules; focused-test, review to `CLEAR`, then commit.
7. **Integrate, review, then test heavily.** Freeze `starting SHA..HEAD` plus worktree state and
   self-review. Use one reviewer by default; add a second only for genuinely independent tooling and
   protected-runtime lanes. All lanes must clear for one identity before final gates/timing. Repair
   from the smallest responsible delta and seek only intersecting re-review.

## Verification and Acceptance

Phase A: policy/lint fixtures, strict production typecheck, quality-workflow syntax/permission
inspection, and identical Vitest file/test discovery. Phases B/C: positive, negative, boundary,
cancellation, ordering, and failure tests at unchanged facades, plus before/after effect-fan-out and
mock/fixture evidence. Smaller files alone do not pass.

After integrated review clears, run `npm ci`, `npm run lint`, `npm run typecheck`,
`npm test -- --silent=passed-only`, `npm run build:renderer`, and
`npm run build:win -- --publish never`. In a clean starting-SHA worktree and the candidate, under
identical Node/npm/output settings, run one warm-up each then at least three alternating timed full
tests. Record revision, lock hash, order, every duration, counts, retries/failures, and medians. If
conditions differ, make no causal speed claim. Diagnose a candidate regression exceeding both 15%
and five seconds; never weaken tests for timing.

Before push, inspect outgoing commits/diff; verify push URL, authenticated identity/write access,
remote-branch absent/expected SHA, no force, and a dry run; scan for secrets, personal paths, and
generated binaries. Push once, verify remote SHA/clean status, and record containment plus
user-approved rollback for a wrong target.

Hash the built Setup artifact and inspect Authenticode before requesting exact-artifact install
approval. Without it, report `Action pending` and keep the goal active. Once authorized, preserve
state, define rollback, follow `README_WINDOWS_INSTALLER_BUILD.md`, relaunch through Explorer, use
only a user-approved safe smoke target, and verify post-install state before Complete.

## Review Gate

Treat phases/integration as High risk where they touch CI quality, audio recovery, or paste/history.
Reviewers stay read-only and avoid heavy suites. Keep an `ISSUES` reviewer open through targeted
repair review. After `CLEAR`, retain it only for a specific expected intersecting delta. Never resume
a closed fixed-effort reviewer; spawn/verify a fresh replacement. Record session/profile and
candidate identities.

## Progress

- [x] Copy to `Docs\plans\technical-depth-hardening-living-plan-20260720-155541.md`; verified readable and byte-identical on 2026-07-20. Active path: `C:\Users\NigelPinkerton\Documents\ecodraft\Docs\plans\technical-depth-hardening-living-plan-20260720-155541.md`; SHA-256: `7DEA40A0DA9EF9E0B0CFD30921F6CD90ADCF0B1A7481A6CC9725FD54DA16D793`.
- [ ] Bootstrap branch/ledger and record the quick baseline.
- [ ] Independently gate and commit Phases A, B, and C.
- [ ] Clear integration; run final gates and alternating timings.
- [ ] Preflight/push exact origin branch; verify remote SHA and clean status.
- [ ] Report `Action pending` or install/verify the exact authorized artifact before Complete.

## Surprises & Discoveries

Record concise sanitized evidence pointers. Out-of-scope discoveries become bounded follow-ups.

## Decision Log

- Decision: one goal uses three independently gated candidates because the user requested one prompt
  and plan. Rationale: manageable identities without an undifferentiated sprint. Date: 2026-07-20.
- Decision: native provenance, release-workflow hardening, dependency automation, and other
  security migrations are separate sprints. Rationale: distinct trust/release evidence.
  Date: 2026-07-20.

## Blockers and Recovery

Isolate failures and rerun only direct/invalidated gates. After three repair cycles, reassess. Report
Blocked only when no safe path remains, with attempts and smallest needed input. Missing install
approval is `Action pending`, not Complete. Budget exhaustion is incomplete work.

## Outcomes & Retrospective

Record per phase: changes, decisive evidence, testability gain, risks, commit SHA, and follow-ups;
record raw timing evidence at integration.

## Assumptions

- Execution is native Windows with primary-documentation access.
- Confirm Node 24 support/compatibility before enforcement.
- Commits/exact origin feature-branch push are authorized; install needs exact-artifact approval.
