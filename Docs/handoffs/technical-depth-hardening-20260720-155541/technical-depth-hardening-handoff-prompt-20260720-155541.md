## Goal Prompt

```text
/goal First, copy the generated living plan from `Docs\handoffs\technical-depth-hardening-20260720-155541\technical-depth-hardening-living-plan-20260720-155541.md` to `Docs\plans\technical-depth-hardening-living-plan-20260720-155541.md` without renaming it. Verify the destination is readable and byte-identical, record its active path and hash in `Progress`, and use only that copy as the living execution plan. Execute the bounded EchoDraft sprint as three independently tested, reviewed, and committed phases: quality/test policy, the OpenAI transcription seam, and the completed-transcription delivery seam. Clear integrated review before final gates and alternating same-machine timing; push only to remote `origin` branch `codex/technical-depth-hardening-20260720` and leave a clean worktree. Preserve user-visible behavior and protected audio, cancellation, fallback, paste, history, IPC, updater, auth, and security contracts. Work only in the configuration/policy, Vitest setup, named seams, necessary immediate callers, and direct tests allowed by the plan; security/dependency migrations, mechanical splits, feature work, main/upstream pushes, merge, deployment, and release are prohibited. Start with one quick baseline and targeted checks. Keep reviewers open for expected follow-up; if closed, use a fresh verified replacement and never resume that fixed-effort session. Treat the plan as an execution ledger subordinate to current user instructions, repository guidance, canonical sources, code contracts, and tests. After each checkpoint, record evidence and choose the next action from it. Mark the goal complete only when acceptance evidence, the authorized push, and exact authorized install verification pass; without install approval, report Action pending and keep the goal active. If no defensible path remains within the boundaries, record attempts, evidence, the blocker, and smallest needed input, then report blocked; budget exhaustion is not completion.
```

## How To Run

Open Codex in the prepared native-Windows EchoDraft checkout. Confirm the generated pair is present,
tracked, unmodified, and synchronized with `origin/main`, then paste the single goal prompt first.
Use `/goal edit` to change scope, `/goal pause` and `/goal resume` for lifecycle control, and
`/goal clear` only when the goal should be discarded.

## Method

One living plan coordinates three independently reviewable candidates. It front-loads one health
baseline, uses focused checks and phase review for quick progress, then concentrates full suites and
alternating baseline/candidate timings at the end. Explicit exclusions and stop rules prevent
incidental cleanup; packaging and exact-artifact installation have separate action gates.

## Review Evidence

The author ran the validator and self-reviewed authority, scope, paths, warning/error policy, timing,
reviewer lifecycle, and action gates. A verified read-only reviewer returned material issues on two
candidates; all accepted findings were repaired. Record the final re-review result externally
against both final hashes in commit evidence, and do not mutate the pair after clearance.

## Alignment Checks

- Checkout-relative Windows paths use one stable plan filename and publish no personal path.
- The generated pair is committed before handoff; only the active ledger receives execution updates.
- Correctness, async, boundary, and no-regression violations fail; broad debt warns with ratchets.
- Every phase reviews before commit; integration review clears before heavy tests and timing.
- Push is limited to the exact origin feature branch; installation cannot be Complete while pending.

## Sources Used

- `AGENTS.md`; `Docs/README.md`; `Docs/ENGINEERING_PLAYBOOK.md`; `Docs/COMMENTING_GUIDELINES.md`; `Docs/LOGGING.md`; `Docs/SECURITY.md`
- `package.json`, `package-lock.json`, both ESLint configs, `src/tsconfig.json`, `vitest.config.mjs`, and `.github/workflows/`
- The named orchestrators, immediate callers, and direct tests inspected in the 2026-07-20 repository audit
- Official Node, ESLint/typescript-eslint, TypeScript, Vitest, Electron, and GitHub Actions guidance inspected in that audit; refresh time-sensitive facts during execution
- Goal-handoff-prompt and review-loop contracts, including validation, rerun, and action-gate references
