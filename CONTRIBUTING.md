# Contributing

## Principles

- Keep the runtime deterministic. LLM-facing layers explain and orchestrate; they do not compute raw health scores.
- Preserve provenance. Do not drop raw payload fidelity to make an API prettier.
- Prefer explainable defaults over silent magic, especially for dedupe and safety gating.

## Workflow

1. Install dependencies with `pnpm install`.
2. Run `pnpm demo` for the local stack.
3. Run `pnpm test` before opening a PR.
4. Run `pnpm typecheck` before opening a PR.
5. If you add or change a provider package, run `pnpm docs:generate`.

## Provider Additions

- Add a new `providers/<id>` package or run `pnpm provider:new <id>`.
- Populate `openvitals.provider` metadata in the package manifest.
- Keep the collector contract complete: `connect`, `exchange_session`, `sync_history`, `sync_incremental`, `subscribe_updates`, `normalize`, `resolve_provenance`, `healthcheck`.
- Add at least one integration or fixture-driven test covering dedupe/provenance expectations.

## Scope Guardrails

- Do not introduce diagnostic or clinical claims.
- Do not bypass derived-first agent access defaults without a concrete policy surface.
- Do not hide stale or missing data conditions from downstream agent outputs.
