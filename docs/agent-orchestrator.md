# Agent Orchestrator

This repository includes a first-pass agent workflow runner for large tasks that need planning, task assignment, isolated development, verification, and iteration.

The workflow keeps GitHub as the source of truth for Issues, PRs, CI, and review. Local execution uses one git worktree per worker task so multiple Codex/OMX workers can operate without overwriting each other.

## Start a Run

```bash
pnpm agent:workflow start --task "Implement the overall task here"
```

For long task descriptions, put the brief in a Markdown file:

```bash
pnpm agent:workflow start --description-file docs/agent-tasks/openvitals-v0.6.md
```

This creates:

- `.agent-workflows/<run-id>/manifest.json`
- `.agent-workflows/<run-id>/plan.md`
- `.agent-workflows/<run-id>/worker-prompts/*.md`
- `.agent-workflows/<run-id>/reports/`

To create worktrees immediately:

```bash
pnpm agent:workflow start --task "Implement the overall task here" --dispatch
```

## Dispatch Workers

```bash
pnpm agent:workflow dispatch --run <run-id>
```

The dispatcher creates branches and worktrees like:

```text
codex/<run-id>-api-runtime
../OpenVitals-worktrees/<run-id>-api-runtime
```

Each worker prompt contains the parent objective, owned paths, branch, worktree, acceptance criteria, and done signal.

## Use with OMX

Open an OMX leader session from the repository root:

```bash
omx --madmax --high
```

Then use the generated plan and prompts:

```bash
$ralplan "Review and approve .agent-workflows/<run-id>/plan.md"
$team 3:executor "Execute the approved plan using the worker prompts under .agent-workflows/<run-id>/worker-prompts"
```

For stricter isolation, point each worker at its assigned worktree from the generated prompt.

## Automate With OMX Team

Prepare a durable OMX team prompt and launcher:

```bash
pnpm agent:workflow omx-plan --run openvitals-v0.6 --phase phase0 --workers 6
```

You can pin the model and reasoning effort:

```bash
pnpm agent:workflow omx-plan --run openvitals-v0.6 --phase phase0 --workers 6 --model gpt-5.5 --reasoning xhigh
```

Start the team:

```bash
pnpm agent:workflow omx-run --run openvitals-v0.6 --phase phase0 --workers 6 --model gpt-5.5 --reasoning xhigh --start
```

Use `--phase phase0` first for large hardware-backed releases. Later phases include manual hardware acceptance that agents cannot honestly mark complete without user-provided evidence.

To attempt all automatable phases while preserving manual hardware gates:

```bash
pnpm agent:workflow omx-run --run openvitals-v0.6 --phase all --workers 7 --model gpt-5.5 --reasoning xhigh --start
```

## Verify

After worker changes are integrated, run:

```bash
pnpm agent:workflow verify --run <run-id>
```

Detached worker worktrees can also run this command. The script first looks for `.agent-workflows/` in the current worktree, then falls back to the shared git repository root (or `OPENVITALS_AGENT_WORKFLOW_ROOT` when set) so verification reports still land in the orchestrator run directory.

Verification runs:

- `pnpm docs:generate`
- `pnpm build`
- `pnpm test`
- `pnpm smoke:e2e`
- `pnpm typecheck`

The report is written to `.agent-workflows/<run-id>/reports/`.

## Iterate

If verification fails:

```bash
pnpm agent:workflow iterate --run <run-id> --note "Fix the failing API contract tests"
```

This advances the run iteration and writes `.agent-workflows/<run-id>/iteration.md`. Send the relevant failure excerpts back to the responsible worker, integrate the fix, and run verification again.

The workflow is complete only when verification passes, generated docs are current, manual hardware gates are explicitly passed or marked pending with evidence requirements, and a human maintainer accepts the final PR.
