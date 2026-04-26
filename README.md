# OpenVitals

OpenVitals is an agent-native health data plane for personal wellness software.
It ingests data from phones, wearables, and provider APIs; keeps provenance and
freshness visible; derives deterministic wellness state; and exposes safe
interfaces for apps, MCP tools, OpenClaw workspaces, SDKs, and local agents.

It is built for the failure modes that make health agents unsafe in practice:
stale data, mirrored records, provider summaries mistaken for raw streams, and
opaque scores that cannot be explained.

> OpenVitals is wellness infrastructure, not a diagnostic system or medical
> device. It should not be used for clinical decision-making.

## Why It Exists

Most health integrations stop at "we connected the API." OpenVitals goes further:

- **Honest data semantics**: every record carries granularity, latency, source,
  confidence, freshness, and capture mode.
- **Agent-safe outputs**: MCP and REST responses say when data is delayed,
  mirrored, stale, missing, or incomplete.
- **Local-first runtime**: a single-node SQLite setup works for development,
  self-hosting, and hardware QA.
- **Explainable scores**: recovery, sleep, strain, circadian, and alert outputs
  can be traced back to evidence.
- **Provider dedupe**: direct Oura/WHOOP data can win over mirrored Apple Health
  copies without destroying the raw audit trail.
- **Mobile collector path**: iPhone HealthKit is the primary Apple Health
  connector; Apple Watch live heart rate is optional and only live during an
  active workout session.

## Quickstart

Requirements:

- Node.js 22+
- pnpm 10+

```bash
pnpm install
pnpm demo
```

In another terminal:

```bash
export OPENVITALS_AGENT_TOKEN=ov_demo_user_ada_derived

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/scores?userId=user_ada"
```

Open the local tools:

- Dashboard: <http://127.0.0.1:3000/dashboard>
- API playground: <http://127.0.0.1:3000/playground>
- OpenAPI JSON: <http://127.0.0.1:3000/v1/openapi.json>

## What You Can Build With It

- A local personal health agent that refuses to overclaim when data is stale.
- A family recovery dashboard with per-profile credentials and scoped tokens.
- An MCP server that gives another agent freshness-aware health context.
- A mobile companion app that uploads HealthKit / Health Connect samples.
- A provider adapter for a new wearable or fitness platform.
- An OpenClaw workspace that runs daily briefings and recovery check-ins.

## Repository Map

| Path | Purpose |
| --- | --- |
| `apps/api` | Fastify API, SQLite runtime state, OAuth/connect flows, SSE/webhooks, OpenAPI, explainability endpoints. |
| `apps/dashboard` | Engineering dashboard for connector state, scores, alerts, freshness, and provenance. |
| `apps/devplayground` | Browser playground for exercising local endpoints. |
| `packages/contracts` | Shared Zod schemas and public TypeScript contracts. |
| `packages/runtime` | Ingest, dedupe, source precedence, baseline, scoring, workflow, and explainability pipeline. |
| `packages/mcp` | MCP server exposing daily brief, recovery status, sync status, freshness, and explanation tools. |
| `packages/sdk-ts`, `packages/sdk-py` | TypeScript and Python SDKs. |
| `packages/collector-*` | Mobile collector primitives for iOS, Android, React Native, Flutter, and shared lifecycle logic. |
| `packages/llm` | LLM provider adapter layer, including OpenRouter smoke support. |
| `providers/*` | Provider adapters for Apple Health, Health Connect, Oura, WHOOP, Garmin, and Strava. |
| `examples/*` | Runnable examples and mobile templates. |
| `docs/*` | Quickstarts, hardware QA, credential setup, OpenClaw, OpenRouter, and self-hosting guides. |

## Data Semantics

OpenVitals treats health data as evidence with context, not just numbers.

| Field | Values | Why it matters |
| --- | --- | --- |
| `dataGranularity` | `provider_payload`, `sample`, `episode`, `daily_summary`, `score`, `live_signal` | Separates source payloads, samples, windows, summaries, scores, and true live signals. |
| `latencyClass` | `live`, `near_realtime`, `delayed_sync`, `daily`, `manual` | Prevents agents from making current-state claims from delayed data. |
| `connectionMode` | `cloud_oauth`, `mobile_permission`, `device_pairing`, `mock` | Explains how data entered the system. |
| `captureMode` | `direct`, `mirrored`, `manual`, `mock` | Prevents double counting when Oura/WHOOP also write into Apple Health. |

Provider boundaries are explicit:

- Apple Watch live heart rate requires the optional live workout collector path
  using `HKWorkoutSession` and `HKLiveWorkoutBuilder`.
- Historical Apple Health / Apple Watch data arrives through iPhone HealthKit as
  samples or episodes, not as a server-side live stream.
- Oura cloud APIs provide provider-mediated time series, daily summaries, and
  scores. They are not continuous raw sensor streams.
- WHOOP cloud APIs provide provider-mediated recovery, sleep, workout, strain,
  HRV, resting heart-rate, and zone summaries. They are not continuous raw HR
  streaming.

## Provider Status

| Provider | Connection | Data shape | Status | Notes |
| --- | --- | --- | --- | --- |
| Apple Health / Apple Watch | iPhone HealthKit + optional Watch workout app | samples, episodes, daily summaries, live workout HR | `sdk-ingest-ready` | iPhone app is the primary connector. Watch app is optional for active workout HR only. |
| Health Connect | Android device permission | samples and summaries | `prototype` | Android smoke path after iOS is green. |
| Oura | OAuth cloud API or env-token dev path | provider payloads, samples, daily summaries, scores | `real-data-beta` | Delayed/provider-mediated. Direct Oura should beat mirrored Apple Health copies for matching windows. |
| WHOOP | OAuth cloud API or env-token dev path | provider payloads, summaries, scores | `real-data-ready` | Delayed/provider-mediated. No continuous raw HR streaming claims. |
| Garmin | mock | provider payloads and summaries | `demo-only` | Demo coverage only. |
| Strava | mock | workout payloads and summaries | `demo-only` | Demo coverage only. |

Run `pnpm docs:generate` to generate provider and MCP reference docs locally.

## Runtime Modes

`demo` mode seeds deterministic data and demo tokens:

```bash
pnpm demo
```

`live` mode starts without seeded user state and is intended for real connector
flows:

```bash
OPENVITALS_MODE=live pnpm --filter @openvitals/api demo
```

Bootstrap a live user:

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Live User","timezone":"UTC","createTokens":true}'
```

By default, runtime SQLite state is stored at `.openvitals/openvitals.sqlite`.
Override it with `OPENVITALS_DB_PATH`.

## Real Data Setup

Copy the example environment file and fill in only the providers you need:

```bash
cp .env.example .env.local
```

Useful guides:

- [Real Data Quickstart](./docs/real-data-quickstart.md)
- [Credentials Setup (中文)](./docs/credentials-setup-zh.md)
- [iOS Companion Guide](./docs/ios-companion-guide.md)
- [iOS Hardware QA Runbook](./docs/ios-hardware-runbook.md)
- [Hardware Test Plan](./docs/hardware-test-plan.md)
- [Self-Hosting](./docs/self-hosting.md)
- [OpenRouter LLM](./docs/openrouter-llm.md)
- [OpenClaw E2E](./docs/openclaw-e2e.md)

Never commit `.env`, `.env.*`, OAuth codes, access tokens, refresh tokens,
provider client secrets, Apple device identifiers, or real HealthKit exports.

## OpenClaw And MCP

The upstream OpenClaw repository is pinned as a submodule at `vendor/openclaw`.

```bash
git submodule update --init --recursive
pnpm openclaw:e2e
```

The automated E2E starts the demo API, registers the OpenVitals MCP server in an
isolated OpenClaw config, generates skill/workspace assets, and calls
`health.sync_status` plus `health.daily_brief` over MCP stdio.

Generate an OpenClaw daily brief workspace:

```bash
pnpm --filter @openvitals/openclaw-skill exec openvitals-openclaw-init \
  --out-dir . \
  --api-base-url http://127.0.0.1:3000 \
  --user-id user_ada \
  --timezone UTC \
  --daily-cron "0 8 * * *" \
  --weekly-cron "0 9 * * 0" \
  --webhook-secret local-dev-secret
```

## Development

```bash
pnpm docs:generate
pnpm build
pnpm test
pnpm smoke:e2e
pnpm typecheck
pnpm smoke:apple-health
pnpm provider:new fitbit
```

CI runs docs generation, build, unit tests, smoke E2E, and typecheck.

Contributor guardrails:

- Keep score computation deterministic and explainable.
- Preserve raw/provider payload history and normalized records.
- Do not hide stale, mirrored, missing, or incomplete data from agent-facing outputs.
- Do not weaken token scope behavior, OAuth handling, webhook signing, or admin boundaries.
- Do not make diagnostic, treatment, or medical-device claims.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for more.

## License

OpenVitals is source-available for noncommercial use under the
[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).
Commercial use requires a separate commercial license. See
[COMMERCIAL.md](./COMMERCIAL.md).

This is intentionally not an OSI-approved open-source license because the project
does not grant unrestricted commercial use.

## Disclaimer

OpenVitals is for wellness, coaching, self-tracking, and agent context workflows.
It is not a diagnostic system, not a medical device, and not a substitute for
clinical judgment. Always show provenance, confidence, and freshness before
making health-related claims.
