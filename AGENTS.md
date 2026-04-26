# Agent Instructions

OpenVitals is a pnpm monorepo for a local-first wellness data plane. Keep changes scoped, testable, and compatible with the existing API/runtime/provider boundaries.

## Repository Map

- `apps/api`: Fastify API, SQLite/Drizzle runtime integration, auth, SSE, webhook, explainability endpoints.
- `apps/dashboard`: engineering dashboard.
- `apps/devplayground`: endpoint playground.
- `packages/contracts`: shared public contracts and schemas.
- `packages/runtime`: ingest, dedupe, baseline, score, and workflow pipeline.
- `packages/scores`: transparent score formulas.
- `packages/mcp`, `packages/sdk-ts`, `packages/sdk-py`: agent and SDK surfaces.
- `providers/*`: provider adapters.
- `packages/collector-*`: mobile collector packages.
- `docs` and `examples`: hand-written documentation and runnable examples.

## Required Checks

Run the narrowest useful check first, then run broader checks before reporting ready:

```bash
pnpm build
pnpm test
pnpm smoke:e2e
pnpm typecheck
```

Generated docs come from:

```bash
pnpm docs:generate
```

Do not hand-edit generated docs under `docs/generated`.

## Safety and Product Boundaries

- This project is wellness/coaching software, not a diagnostic system or medical device.
- Preserve raw payload history, normalized records, provenance, dedupe explainability, and audit-friendly evidence sets.
- Do not weaken token scope behavior, admin boundaries, OAuth handling, webhook secrets, or live-mode safeguards.
- Demo-mode behavior should remain deterministic unless the task explicitly changes it.

## Multi-Agent Workflow

- Treat GitHub Issues, PRs, CI, and human review as the source of truth.
- Use one branch and one git worktree per task when working in parallel.
- Do not revert or overwrite another worker's changes.
- If your task affects shared contracts, coordinate with API/runtime/SDK workers and update tests and docs together.
