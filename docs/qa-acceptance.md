# QA Acceptance Report: openvitals-v0.6

> Languages: [English](./qa-acceptance.md) | [简体中文](./qa-acceptance-zh.md)


This report tracks automated and manual acceptance for the OpenVitals v0.6 hardware-backed wedge. It is intentionally conservative: hardware evidence remains **pending** unless a human provides real device/account evidence.

Last integrated verification update: 2026-04-26.

Note: this report distinguishes **automated repository verification** from **manual hardware verification**. The integrated repository checks passed, but hardware evidence remains pending until a human provides real device/account results.

## Current acceptance status

| Area | Status | Evidence |
| --- | --- | --- |
| Documentation semantics | passed | README and quickstarts document provider payloads, platform samples, summaries, scores, live signals, freshness, confidence, mirrored-source dedupe, and pending hardware gates. |
| Generated docs | passed | `pnpm docs:generate` passed in `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md`. |
| Typecheck | passed | `pnpm typecheck` passed in `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md`. |
| Unit/integration tests | passed | `pnpm test` passed in `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md`. |
| Smoke E2E | passed | `pnpm smoke:e2e` passed in `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md`. |
| Orchestrator verification | passed | `pnpm agent:workflow verify --run openvitals-v0.6` accepted the integrated repository and wrote `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md`. |
| Manual Oura hardware | pending-hardware | Requires Oura Ring/account evidence; see [Hardware Test Plan](./hardware-test-plan.md). |
| Manual WHOOP hardware | pending-hardware | Requires WHOOP device/account evidence; see [Hardware Test Plan](./hardware-test-plan.md). |
| Manual iPhone + Apple Watch HealthKit | pending-hardware | Requires iPhone/Apple Watch evidence; see [Hardware Test Plan](./hardware-test-plan.md). |
| Manual mirrored Oura/WHOOP dedupe | pending-hardware | Requires direct provider data plus mirrored Apple Health copies; see [Hardware Test Plan](./hardware-test-plan.md). |


## Worker verification snapshot

| Worker/source | Reported automated status | Follow-up |
| --- | --- | --- |
| Integrated repository | `pnpm docs:generate`, `pnpm build`, `pnpm test`, `pnpm smoke:e2e`, and `pnpm typecheck` passed in `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md`. | Automated acceptance is complete. |
| worker-3 Phase 0 stabilization | Reported `pnpm test`, `pnpm build`, `pnpm smoke:e2e`, and `pnpm typecheck` passed in commit `b527043`. | Superseded by final integrated verification. |
| worker-6 docs/QA | `pnpm docs:generate`, `pnpm build`, `pnpm typecheck`, and `pnpm smoke:e2e` passed in commit `e487cdae`; pre-integration `pnpm test` failed only on the runtime bug later reported fixed by worker-3. | Superseded by final integrated verification. |
| Hardware QA | Not executed by agents. | Requires human device/account evidence per hardware matrix. |

## Required automated commands

Run these from the repository root after implementation branches are integrated:

```bash
pnpm docs:generate
pnpm typecheck
pnpm test
pnpm smoke:e2e
pnpm agent:workflow verify --run openvitals-v0.6
```

The orchestrator verification should write a report under `.agent-workflows/openvitals-v0.6/reports/`. If it fails, create an iteration note and continue with the smallest responsible worker scope:

```bash
pnpm agent:workflow iterate --run openvitals-v0.6 --note "<failure summary and owner>"
```

## Hardware evidence requirements

Manual evidence must include:

- hardware/account used;
- timestamp;
- app action or command performed;
- API/timeline response excerpt showing source, freshness, granularity, and provenance;
- MCP/OpenClaw response excerpt showing stale/delayed/mirrored/incomplete semantics where applicable;
- any known limitation or failed expectation.

Do not mark these as passed without evidence:

1. Oura direct cloud sync.
2. WHOOP direct cloud sync.
3. iPhone HealthKit anchored upload.
4. Apple Watch historical HealthKit samples.
5. Apple Watch live workout HR session.
6. Oura mirrored into Apple Health dedupe.
7. WHOOP mirrored into Apple Health dedupe.
8. Android Health Connect smoke test after iOS is green.

## Realtime/raw-data claims policy

Allowed wording:

- "Apple Watch live workout heart-rate samples are live/near-real-time while a workout collector session is active."
- "Oura provides provider-mediated heart-rate samples and daily summaries/scores through cloud sync."
- "WHOOP provides provider-mediated recovery, sleep, workout, strain/load, HRV, resting-HR, and HR-zone data through cloud sync."
- "OpenVitals preserves provider payloads and platform samples, then derives normalized episodes, summaries, and scores."

Disallowed wording unless future code and hardware evidence prove it:

- "Oura continuous raw sensor stream."
- "WHOOP continuous raw HR stream."
- "Real-time monitoring" for delayed cloud sync or stale platform uploads.
- "Hardware-backed complete" without the manual hardware evidence rows above.

## Final report template

Use this shape for final release or PR handoff:

```markdown
## Changed files
- ...

## Automated verification
- `pnpm docs:generate` — PASS/FAIL, excerpt/path
- `pnpm typecheck` — PASS/FAIL, excerpt/path
- `pnpm test` — PASS/FAIL, excerpt/path
- `pnpm smoke:e2e` — PASS/FAIL, excerpt/path
- `pnpm agent:workflow verify --run openvitals-v0.6` — PASS/FAIL, report path

## Hardware evidence
- Oura direct cloud connector — PASS/PENDING/FAIL, evidence
- WHOOP direct cloud connector — PASS/PENDING/FAIL, evidence
- iPhone HealthKit collector — PASS/PENDING/FAIL, evidence
- Apple Watch historical samples — PASS/PENDING/FAIL, evidence
- Apple Watch live workout HR — PASS/PENDING/FAIL, evidence
- Mirrored Oura dedupe — PASS/PENDING/FAIL, evidence
- Mirrored WHOOP dedupe — PASS/PENDING/FAIL, evidence
- Android Health Connect smoke — PASS/PENDING/FAIL, evidence

## Remaining limitations
- ...

## Follow-up issues
- ...
```
