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

- [x] Copy to `Docs\plans\technical-depth-hardening-living-plan-20260720-155541.md`; verified readable and byte-identical on 2026-07-20. Active path: `C:\Users\NigelPinkerton\Documents\ecodraft\Docs\plans\technical-depth-hardening-living-plan-20260720-155541.md`; copy SHA-256: `7DEA40A0DA9EF9E0B0CFD30921F6CD90ADCF0B1A7481A6CC9725FD54DA16D793`; pre-checkpoint active-ledger SHA-256: `0D51837A3B9CA7412AE006C1CE776F7586A324690EB85CCB6192E149F71CF4F3`.
- [x] Bootstrap branch/ledger and record the quick baseline. Branch: `codex/technical-depth-hardening-20260720`; bootstrap commit: `bb1a3998425b864a661000747c7904ee86503925`. Baseline environment: Windows 11 x64, Node `v24.18.0`, npm `10.9.0`; `npm ci` succeeded in 120 seconds (including native postinstall). Quick `npm test -- --silent=passed-only` took 68.4 seconds wall-clock / Vitest 66.11 seconds, ran 231 files and 2,129 tests (3 skipped), with 230 files / 2,125 tests passing and one pre-existing timeout in `src/helpers/__tests__/telemetryFileLogger.test.ts` (`keeps sustained maximum-rate logging within per-file, directory, and retention caps`). Next action: diagnose only as needed by affected gates; do not broaden sprint scope.
- [x] Phase A quality/test policy independently gated and committed as `0168f6845f8a5dce7eb318a82c9721e661442406`. Evidence: reviewer session `019f7de9-dae9-7a53-92bf-dfc25f702640`, profile `reviewer`, final `PROFILE_OK`/`CLEAR`; `npm run lint` passed with 0 errors and 606 historical warnings, `npm run typecheck` passed, `npm run typecheck:test` passed, `npm run quality:changed-lint` passed with 0 errors/11 historical warnings, `npm run quality:file-policy` passed, renderer-boundary/file-policy direct tests passed 19/19 across 2 files, and Node-only process/windows-handle tests passed 16/16. Candidate base was `94c4b50c3d25a35afd88bbb079e7693d2d72b1b6`; self-review included `git diff --check` and staged-diff inspection.
- [x] Phase B OpenAI transcription seam independently gated and committed as `f7bc951b99d140f960d42bd98ef47f3f1ec2e2a8`. Evidence: reviewer session `019f7de9-dae9-7a53-92bf-dfc25f702640`, profile `reviewer`, final `PROFILE_OK`/`CLEAR`; policy tests passed 13/13, unchanged `openAiTranscriber` facade tests passed 35/35, `npm run quality:changed-lint` passed with 0 errors/18 historical warnings, `npm run quality:file-policy` passed, strict app/test typechecks passed, and `git diff --check` passed. Processor physical lines fell from 1,374 to 985; effects remain in the processor while candidate scoring, agreement, timing aggregation, and transport policy are directly testable. Self-review covered facade/caller identity and protected retry/cancellation/fallback paths.
- [x] Phase C completed-transcription delivery seam independently gated and committed as `c80a7788f02714f98e7f5a4f08378bc84ca0cc7d`. Evidence: reviewer session `019f7de9-dae9-7a53-92bf-dfc25f702640`, profile `reviewer`, final `PROFILE_OK`/`CLEAR`; delivery policy tests passed 13/13, unchanged handler tests passed 34/34, `npm run quality:changed-lint` passed with 0 errors/9 historical warnings, `npm run quality:file-policy` passed, strict app/test typechecks passed, and `git diff --check` passed. Handler physical lines fell from 818 to 783; protected clipboard/paste/history/cancellation effects remain ordered in the facade while outcome classification is directly testable.
- [x] Integrated review cleared candidate `94c4b50c3d25a35afd88bbb079e7693d2d72b1b6..078c64ee85a4259c619060a19bca5591ac98a669` on the clean branch. Reviewer session `019f7de9-dae9-7a53-92bf-dfc25f702640`, profile `reviewer`, final `PROFILE_OK`/`CLEAR`; the first-push zero-SHA repair was committed as `078c64ee85a4259c619060a19bca5591ac98a669`. Resolver evidence: all-zero base selected merge-base `6f8ad7ce352522b716f52fc4fdcf80ee7b0d742e` with `origin/main`; changed lint, file policy, direct node policy tests 19/19, and `git diff --check` passed. Final gates and alternating timings remain pending.
- [x] Final heavy gates and alternating timing completed on Windows 11 x64, Node `v24.18.0`, npm `10.9.0`. `npm ci` passed (957 packages; the recorded 42 audit findings remain out of scope), `npm run lint` passed with 0 errors/607 historical warnings, `npm run typecheck` and `npm run typecheck:test` passed, `npm run build:renderer` and `npm run build:win -- --publish never` passed. The default full suite reproduced only the known pre-existing `telemetryFileLogger` sustained-rate timeout; the extended 30-second targeted run passed 7/7. With lock SHA `A5EBC8682D261CEAD19685B5C4DC7EC65449865454846084574EA0F96CAD12DB`, compact-output timing used one warm-up each and alternating baseline/candidate timed runs: baseline `94c4b50c3d25a35afd88bbb079e7693d2d72b1b6` = 54.01s, 53.39s, 58.01s (median 54.01s; 230/231 files and 2125/2129 tests passed); candidate `97d3fa080d93d556183ca7949547c1bae5f7827f` = 59.60s, 59.05s, 58.07s (median 59.05s; 234/235 files and 2170/2174 tests passed). Every run had the same known timeout; differing test sets and a 5.04s/9.33% median delta support no causal speed claim. Setup artifact: `dist\\EchoDraft Setup 1.4.18.exe`, 120,897,760 bytes, SHA-256 `EF5E19C7C8DEC07DFE246FCC0E2389CD036F29DFB3B337D847BA118F7DA62A58`, Authenticode `NotSigned`.
- [x] Preflight/push exact origin branch; `origin` push URL was verified as `https://github.com/n-pinkerton/echo-draft.git`, the feature branch was absent before push, dry run authenticated, outgoing scan found no generated binaries or secrets (the required active plan path is the only intentional personal-path match), and the first push verified remote SHA `3868075f7af14f5499896e9b8a772f6dc05ee8914` with a clean worktree. Final ledger synchronization is a documentation-only fast-forward on the same authorized branch.
- [ ] Report `Action pending` or install/verify the exact authorized artifact before Complete.

## Surprises & Discoveries

Record concise sanitized evidence pointers. Out-of-scope discoveries become bounded follow-ups.

- Baseline `npm ci` reported 42 audit findings (1 low, 13 moderate, 23 high, 5 critical); dependency/security migration is explicitly out of scope for this sprint and remains a follow-up.
- Baseline full test run reproduced one telemetry logger timing timeout; all other observed files/tests passed. This is not in the named seams and is not a reason to change protected audio or delivery behavior.

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

- Phase A — Added Node 24 quality workflow, strict app/test TypeScript partitions, explicit Vitest
  node/jsdom classification, changed-production correctness and renderer-boundary gates, and a
  lexical logical-LOC policy with direct fixtures. The bounded AudioManager caller now has an
  explicit callback/result contract. Testability gain: policy behavior is directly table-tested;
  new/changed hooks, imports, requires, aliases, dynamic imports, re-exports, file thresholds,
  exemption schema, and Node test routing are executable checks. Residual risk is the recorded
  historical warning debt and 42 out-of-scope audit findings; no protected runtime behavior was
  intentionally changed. Commit: `0168f6845f8a5dce7eb318a82c9721e661442406`. Follow-up: Phase B
  OpenAI seam remains next, with focused review before commit.

- Phase B — Extracted `openAiTranscriptionPolicy.js` behind the unchanged
  `processWithOpenAIAPI` facade. The module owns candidate scoring, prompt-echo/truncation and
  assistant-style classification, attempt agreement/selection, timing combination, bounded proxy
  timing/status policy, and disagreement construction; IPC, blob, retry, fallback, cancellation,
  and logging effects remain in the orchestrator. Testability gain: 13 direct policy cases plus the
  existing 35 facade cases exercise positive, negative, boundary, retry, cancellation, fallback,
  prompt-echo, truncation, and timing behavior. Risk review found no semantic parity issue; the
  1,374-to-985 processor reduction lowers policy/effect coupling without changing the public seam.
  Commit: `f7bc951b99d140f960d42bd98ef47f3f1ec2e2a8`. Follow-up: Phase C delivery seam.

- Phase C — Extracted `transcriptionDeliveryPolicy.js` behind the unchanged
  `createTranscriptionCompleteHandler` facade. The module plans paste outcomes, preserves protected
  clipboard reason/status precedence, and centralizes history/terminal delivery classification;
  clipboard writes, paste calls, cancellation barriers, IPC, history persistence, cues, toasts, and
  stage ordering remain in the executor. Testability gain: 13 direct policy cases plus 34 existing
  handler cases cover success, failure, uncertainty, protected clipboard, changed/retained
  clipboard, fallback, cancellation, history, and ordering. Risk review found no semantic parity
  issue; handler physical lines fell 818 to 783 while the pure outcome contract became executable.
  Commit: `c80a7788f02714f98e7f5a4f08378bc84ca0cc7d`. Follow-up: integrated review and final gates.

- Integrated checkpoint — Integrated reviewer found no cross-phase application regression. The only
  issue was first-push CI base selection; the workflow now uses the default-branch merge base for a
  zero `github.event.before` and retains empty-tree fallback only for orphan histories. Commit:
  `078c64ee85a4259c619060a19bca5591ac98a669`. Final heavy gates and timing evidence are still
  required.

- Final gates — The renderer and native Windows packaging gates passed. The full suite consistently
  reproduced the pre-existing telemetry logger timeout while all other observed files/tests passed;
  an extended focused run passed the affected file. The repeated same-machine alternating matrix
  was recorded with identical Node/npm/lock/output settings and did not justify a causal performance
  claim because the candidate contains four additional test files and 45 additional tests. The
  built Setup artifact is locally hashable but unsigned (`NotSigned`), so exact-artifact install
  verification remains pending user approval. No release or updater claim is made.

## Assumptions

- Execution is native Windows with primary-documentation access.
- Confirm Node 24 support/compatibility before enforcement.
- Commits/exact origin feature-branch push are authorized; install needs exact-artifact approval.
