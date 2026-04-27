# Self-Hosting

> Languages: [English](./self-hosting.md) | [简体中文](./self-hosting-zh.md)


OpenVitals is designed to be self-hosted as a local-first health data plane and proactive wellness runtime.

## Modes

- Local single-node (recommended default): SQLite + one API process.
- Cloud single-node: same SQLite + one API process, fronted by your own reverse proxy if needed.

## Local (single-node)

```bash
pnpm install
OPENVITALS_MODE=live pnpm --filter @openvitals/api demo
```

Then bootstrap a live user:

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Local User","timezone":"Asia/Shanghai","createTokens":true}'
```

Bootstrap owner + family profiles:

```bash
curl -X POST "http://127.0.0.1:3000/v1/household/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"owner":{"userId":"owner_live","name":"Owner","timezone":"Asia/Shanghai"},"family":[{"userId":"mom_live","name":"Mom","timezone":"Asia/Shanghai"}],"createTokens":true}'
```

## Required environment variables

Core runtime:

- `OPENVITALS_MODE=live`
- `OPENVITALS_DB_PATH` (SQLite file path)
- `OPENVITALS_ADMIN_TOKEN`
- `OPENVITALS_SECRETS_KEY` for encrypted provider credential storage

WHOOP OAuth:

- `OPENVITALS_WHOOP_CLIENT_ID`
- `OPENVITALS_WHOOP_CLIENT_SECRET`
- `OPENVITALS_WHOOP_REDIRECT_URI`
- `OPENVITALS_WHOOP_WEBHOOK_SECRET`

Oura OAuth, when the direct Oura connector is present in your build:

- `OPENVITALS_OURA_CLIENT_ID`
- `OPENVITALS_OURA_CLIENT_SECRET`
- `OPENVITALS_OURA_REDIRECT_URI`
- `OPENVITALS_OURA_API_URL` (optional; defaults to Oura's production API)

## Optional development fallback paths

These are for development or migration only; they are not the primary v0.6 path.

WHOOP:

- `OPENVITALS_WHOOP_ACCESS_TOKEN` for single-token local fallback
- `OPENVITALS_WHOOP_BRIDGE_URL` for bridge-based sync fallback
- `OPENVITALS_WHOOP_AUTH_URL`
- `OPENVITALS_WHOOP_TOKEN_URL`
- `OPENVITALS_WHOOP_API_URL`
- `OPENVITALS_WHOOP_SCOPE`

Oura:

- `OPENVITALS_OURA_API_URL` for staging/mock endpoint tests

## Data-source expectations

- Apple Health is device-side only. The server never polls HealthKit.
- Apple Watch live heart rate requires a live workout collector path. Historical HealthKit upload is not the same thing as a live stream.
- Oura cloud data is provider-mediated time series and daily summary/score data, not continuous raw sensor streaming.
- WHOOP cloud data is provider-mediated recovery, sleep, workout, strain/load, HRV, resting-HR, and heart-rate-zone summary data, not continuous raw HR streaming.
- Direct Oura/WHOOP data should win over mirrored Apple Health copies for the same metric/window, while mirrored records remain auditable.

## Scheduler configuration

- `OPENVITALS_SCHEDULER_ENABLED` (live default `true`, demo default `false`)
- `OPENVITALS_SCHEDULER_LEADER` (keep `true` for single instance)
- `OPENVITALS_SCHEDULER_HEARTBEAT_MINUTES` (default `15`)
- `OPENVITALS_SCHEDULER_LOOP_MS` (default `60000`)

## Cloud (single-node)

v0.6 keeps the same simple production architecture:

- one API process;
- one SQLite database file mounted on durable storage;
- per-user provider OAuth credentials encrypted at rest;
- optional reverse proxy/TLS in front.

## Family deployment notes

- `household/bootstrap` creates multiple runtime profiles, but each profile still owns its own:
  - agent tokens;
  - scheduler state;
  - provider credentials;
  - Apple Health mobile session/anchor state;
  - sync freshness and dedupe state.
- Do not share one WHOOP or Oura access token across family members.
- For Apple Health, each person must run device-side ingest from their own iPhone.
- Use the hardware QA matrix before claiming that iPhone, Apple Watch, Oura, WHOOP, or mirrored-dedupe acceptance is complete.

## Notes

- Keep `/v1/state` restricted to `read.raw` and admin workflows.
- Prefer `/v1/dashboard/state` for derived-only UI and agent dashboards.
- For production ingress, terminate TLS in front of the API and restrict admin headers.
- OpenVitals is for wellness/coaching workflows, not diagnosis or clinical decision-making.
