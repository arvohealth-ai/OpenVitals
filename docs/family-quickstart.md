# Family Quickstart

> Languages: [English](./family-quickstart.md) | [简体中文](./family-quickstart-zh.md)


This guide covers a v0.6 owner + family deployment on one self-hosted node.

The important constraint is simple: each profile has its own runtime state, scheduler state, provider credentials, Apple Health connector session, and agent token. Do not share one WHOOP token, one Oura token, or one Apple Health session across family members.

OpenVitals should make freshness and granularity visible before any family coaching output. Apple Watch live HR requires an active live workout collector path; Oura and WHOOP cloud data are provider-mediated delayed/daily data rather than continuous raw sensor streams.

## 1. Start OpenVitals in live mode

Set the required environment variables:

```bash
export OPENVITALS_MODE=live
export OPENVITALS_ADMIN_TOKEN=openvitals-dev-admin
export OPENVITALS_DB_PATH="$(pwd)/.openvitals/openvitals.sqlite"
export OPENVITALS_SECRETS_KEY=replace-this-with-a-long-random-secret
```

Provider OAuth variables:

```bash
export OPENVITALS_WHOOP_CLIENT_ID=your-whoop-client-id
export OPENVITALS_WHOOP_CLIENT_SECRET=your-whoop-client-secret
export OPENVITALS_WHOOP_REDIRECT_URI=http://127.0.0.1:3000/v1/connect/callback/whoop
export OPENVITALS_WHOOP_WEBHOOK_SECRET=local-whoop-secret

export OPENVITALS_OURA_CLIENT_ID=your-oura-client-id
export OPENVITALS_OURA_CLIENT_SECRET=your-oura-client-secret
export OPENVITALS_OURA_REDIRECT_URI=http://127.0.0.1:3000/v1/connect/callback/oura
```

Start the API:

```bash
pnpm --filter @openvitals/api demo
```

## 2. Bootstrap owner + family profiles

```bash
curl -X POST "http://127.0.0.1:3000/v1/household/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  -d '{
    "owner": {"userId": "owner_live", "name": "Owner", "timezone": "Asia/Shanghai"},
    "family": [
      {"userId": "mom_live", "name": "Mom", "timezone": "Asia/Shanghai"},
      {"userId": "kid_live", "name": "Kid", "timezone": "Asia/Shanghai"}
    ],
    "createTokens": true
  }'
```

Save the returned `derived` and `full` token for each profile. These tokens are not interchangeable.

## 3. Connect WHOOP separately for each profile

Start the WHOOP connect flow for one user:

```bash
export OWNER_DERIVED_TOKEN=replace-with-owner-derived-token

curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/whoop/start" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}"
```

The response includes:

- `connectUrl`
- `state`
- `sessionId`
- `callbackUrl`

If `OPENVITALS_WHOOP_REDIRECT_URI` points at `http://127.0.0.1:3000/v1/connect/callback/whoop`, the API will complete the OAuth code exchange automatically after browser consent.

If your deployment terminates OAuth elsewhere, call the callback route with the returned `code`:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/whoop/callback" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}" \
  -H "content-type: application/json" \
  -d '{
    "sessionId": "session_whoop_owner_live_...",
    "state": "whoop_state_...",
    "code": "whoop-oauth-code"
  }'
```

Repeat this step for `mom_live`, `kid_live`, and any additional profile. Each callback persists a separate encrypted credential row.

## 4. Connect Oura separately for each profile

When the direct Oura connector is available in your build, start the Oura connect flow for each profile:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/oura/start" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}"
```

Complete browser consent, or forward the returned OAuth code:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/oura/callback" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}" \
  -H "content-type: application/json" \
  -d '{
    "sessionId": "session_oura_owner_live_...",
    "state": "oura_state_...",
    "code": "oura-oauth-code"
  }'
```

Repeat for each profile that owns an Oura Ring/account. Oura cloud outputs should be treated as delayed provider-mediated samples, summaries, and scores.

## 5. Connect Apple Health separately on each iPhone

Apple Health is device-side only. The server never polls HealthKit.

For each family member:

1. Start a connector session with that profile's token.
2. Use the iOS collector to request HealthKit permission.
3. Save the local anchor on device.
4. Upload anchored batches with collector metadata and source revision metadata.
5. If using Apple Watch live HR, start an active workout session from the watch/iPhone collector path.

Create the Apple session:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/apple-health/session" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}"
```

Requirements for Apple mirrored data:

- mirrored samples must include `bundleId` and source app metadata;
- direct Oura/WHOOP remains the preferred normalized source for matching provider-owned metric windows;
- Apple mirrored Oura/WHOOP samples stay in raw history for auditability;
- Apple Watch live workout HR is labeled as a live signal, not generic delayed provider data.

## 6. Verify per-profile sync state

Check one profile:

```bash
curl "http://127.0.0.1:3000/v1/users/owner_live/sync-status" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}"
```

For WHOOP you should see:

- `authState: "connected"`;
- `connectionMethod: "oauth"` or an explicit local fallback;
- `credentialExpiresAt`;
- freshness or sync-status fields that indicate delayed/daily provider data.

For Oura, when the direct connector is enabled, you should see:

- `authState: "connected"`;
- OAuth credential expiry or refresh metadata;
- latest synced windows for heart-rate samples and daily summaries;
- no claim that Oura is streaming continuous live raw data.

For Apple Health you should see:

- mobile session/permission connection state;
- latest anchor or upload cursor;
- source metadata for direct vs mirrored samples;
- data-quality/freshness gates.

If any source is not connected or has not uploaded fresh batches, the profile may still emit stale-data alerts, but coaching output should be gated and explicit about missing, delayed, or stale inputs.

## 7. Run the scheduler

Manual run:

```bash
curl -X POST "http://127.0.0.1:3000/v1/experimental/scheduler/run" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"userId":"owner_live","job":"all","dryRun":false}'
```

Repeat for each profile if you want to validate per-user outbox behavior immediately.

The scheduler order in live mode is:

1. provider incremental sync where applicable;
2. derived-state refresh;
3. emission dedupe;
4. outbox/webhook/SSE fanout.

## 8. Generate OpenClaw assets per profile

```bash
pnpm --filter @openvitals/openclaw-workspace-recovery exec openvitals-openclaw-workspace \
  --out-dir . \
  --api-base-url http://127.0.0.1:3000 \
  --timezone Asia/Shanghai \
  --webhook-secret family-local-secret \
  --profile "owner_live|Owner|0 8 * * *|0 9 * * 0" \
  --profile "mom_live|Mom|0 8 * * *|0 9 * * 0" \
  --profile "kid_live|Kid|0 8 * * *|0 9 * * 0"
```

In OpenClaw, keep one health agent per profile and call `health.sync_status` before any coaching output. The agent should say when signals are stale, delayed, mirrored, or incomplete.

## 9. Hardware evidence

Manual family acceptance remains pending until a human supplies device/account evidence. Record results in [Hardware Test Plan](./hardware-test-plan.md) and summarize software checks plus hardware status in [QA Acceptance Report](./qa-acceptance.md).
