# Real Data Quickstart (Apple Health + Apple Watch + Oura + WHOOP)

> Languages: [English](./real-data-quickstart.md) | [简体中文](./real-data-quickstart-zh.md)


This guide targets the v0.6 hardware-backed wedge:

- Apple Health via the required iPhone companion app and device-side anchored HealthKit ingest.
- Apple Watch historical data through iPhone HealthKit after platform sync.
- Apple Watch live heart rate only through the optional watchOS live workout collector path.
- Oura via official cloud OAuth/API data when the direct connector is available in your build.
- WHOOP via per-user OAuth credential flow.
- Single-node API + SQLite for local self-hosting.

OpenVitals preserves provider payloads and platform samples, then derives episodes, daily summaries, scores, and agent-facing explanations. Do not describe Oura or WHOOP cloud APIs as continuous raw sensor streams; they are provider-mediated delayed/daily sync surfaces. Only Apple Watch live workout samples should be treated as `live_signal` data.

## 1) Configure live mode

Set the shared live-mode variables:

```bash
export OPENVITALS_MODE=live
export OPENVITALS_DB_PATH=.openvitals/openvitals.sqlite
export OPENVITALS_ADMIN_TOKEN=openvitals-dev-admin
export OPENVITALS_SECRETS_KEY=local-dev-secrets-key
```

Configure WHOOP OAuth:

```bash
export OPENVITALS_WHOOP_CLIENT_ID="<whoop-client-id>"
export OPENVITALS_WHOOP_CLIENT_SECRET="<whoop-client-secret>"
export OPENVITALS_WHOOP_REDIRECT_URI="http://127.0.0.1:3000/v1/connect/callback/whoop"
export OPENVITALS_WHOOP_WEBHOOK_SECRET="local-whoop-secret"
```

Configure Oura OAuth when your build includes the direct Oura connector:

```bash
export OPENVITALS_OURA_CLIENT_ID="<oura-client-id>"
export OPENVITALS_OURA_CLIENT_SECRET="<oura-client-secret>"
export OPENVITALS_OURA_REDIRECT_URI="http://127.0.0.1:3000/v1/connect/callback/oura"
# Optional for tests/staging:
export OPENVITALS_OURA_API_URL="https://api.ouraring.com"
```

Then start the API:

```bash
pnpm install
OPENVITALS_MODE=live pnpm --filter @openvitals/api demo
```

## 2) Bootstrap a live profile

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Live User","timezone":"Asia/Shanghai","providers":["apple-health","oura","whoop"],"createTokens":true}'
```

Save the derived token from the response:

```bash
export OPENVITALS_AGENT_TOKEN="<derived-token>"
```

## 3) Connect WHOOP cloud data

Create a WHOOP connect session:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/whoop/start" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN"
```

The response includes:

- `connectUrl`
- `state`
- `sessionId`
- `callbackUrl`
- `connectionMethod`

Open `connectUrl` in a browser and complete the WHOOP grant. If `OPENVITALS_WHOOP_REDIRECT_URI` points at `http://127.0.0.1:3000/v1/connect/callback/whoop`, the API will complete the OAuth code exchange automatically.

If your redirect handler terminates OAuth somewhere else, forward the returned `code` and `state` to the per-user callback route:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/whoop/callback" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "sessionId":"<session-id>",
    "state":"<oauth-state>",
    "code":"<whoop-oauth-code>"
  }'
```

For local self-hosted development, you can also finish the callback manually with a token payload:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/whoop/callback" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "sessionId":"<session-id>",
    "state":"<oauth-state>",
    "accessToken":"<whoop-access-token>",
    "refreshToken":"<whoop-refresh-token>",
    "expiresAt":"2026-03-20T08:00:00.000Z",
    "externalUserId":"whoop-user-123",
    "scopes":["read:sleep","read:recovery","read:workout"]
  }'
```

WHOOP data should be labeled as provider-mediated delayed/daily cloud data. Expected normalized outputs include recovery, sleep, workout, strain/load, HRV, resting heart rate, and heart-rate-zone summaries when the provider returns them.

## 4) Connect Oura cloud data

When the direct Oura connector is available in your build, start the Oura connect flow:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/oura/start" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN"
```

Complete OAuth in the browser, or forward the returned `code` and `state` to the callback route if your redirect terminates elsewhere:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/oura/callback" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "sessionId":"<session-id>",
    "state":"<oauth-state>",
    "code":"<oura-oauth-code>"
  }'
```

Oura cloud data should be labeled as delayed/provider-mediated. Oura heart-rate rows are samples (`dataGranularity=sample`), not true live signals. Sleep, readiness, SpO2, stress, and workout data should keep provider source IDs, timestamps, units, confidence, and freshness metadata.

## 5) Apple Health ingest (iPhone companion path)

Apple Health remains device-side. The server does not poll HealthKit, and watchOS is not required for ordinary Apple Health sync. Install and configure the iPhone companion app first; it owns profile/token setup, API endpoint setup, HealthKit authorization, initial sync, background/incremental sync, stale-data display, and manual **Sync Now**. Use the optional watchOS target only for live workout heart-rate capture.

Create a mobile session:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/apple-health/session" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN"
```

Then use the iOS companion/template path from `examples/mobile-ios-minimal-app` or the reference collector implementation.

The iPhone app setup flow should:

1. Enter the OpenVitals API base URL. For physical-device local testing, use `http://<Mac-LAN-IP>:3000`, not `127.0.0.1`.
2. Enter or select the user/profile token returned by live bootstrap.
3. Request HealthKit permissions and show missing or partial permissions.
4. Run initial sync, then reuse the same anchors for foreground refresh, background/observer-triggered sync, and manual **Sync Now**.
5. Show `/v1/users/:id/sync-status` details: last sync, last anchor, pending ingest batches, latest error, and stale-data warnings.

Important rules:

- Request HealthKit authorization for heart rate, HRV SDNN, resting heart rate, step count, sleep analysis, and workouts.
- Use anchored incremental uploads and persist anchors locally on device.
- Include source revision bundle identifier, device info, timezone, units, source record ID/hash, and anchor state.
- Apple direct samples use `captureMode: "direct"`.
- Oura/WHOOP samples mirrored through Apple Health use `captureMode: "mirrored"` and preserve the source app bundle.
- Apple Watch historical samples remain HealthKit `sample`/`episode` records with `latencyClass=delayed_sync` or `near_realtime`.
- Apple Watch live HR requires an active live workout session and should be labeled `dataGranularity=live_signal` with `latencyClass=live` while the workout upload is fresh.
- iOS background delivery is scheduler-mediated. Describe it as background sync or near-realtime when iOS schedules delivery, not continuous live monitoring.

Example mirrored payload fragment:

```json
{
  "captureMode": "mirrored",
  "sourceApp": "com.whoop.mobile",
  "bundleId": "com.whoop.mobile"
}
```

## 6) Run provider sync and validate freshness

Trigger incremental WHOOP sync:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/sync" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"providerId":"whoop","mode":"incremental"}'
```

Trigger incremental Oura sync when connected:

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/sync" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"providerId":"oura","mode":"incremental"}'
```

Inspect sync status before any coaching or agent output:

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live/sync-status"
```

Check for:

- `whoop.authState == "connected"` and `whoop.connectionMethod` indicating OAuth or an explicit local fallback.
- Oura connected state when the direct connector is enabled.
- Apple Health connection/session state, latest anchor, pending ingest batches, and freshness.
- Data-quality/freshness gates moving toward `ok` before the agent makes confident current-state claims.
- `pendingIngestBatches` trending to `0`.

## 7) Verify dedupe and proactive outputs

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/scores?userId=user_live"

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/alerts?userId=user_live"
```

If direct Oura/WHOOP data and Apple mirrored copies both exist:

- normalized recovery/sleep/workout views should prefer the direct provider where appropriate;
- raw/provider payloads and mirrored platform samples should remain auditable;
- score and dedupe explanations should show which source won, which source was suppressed, and why;
- the agent should surface stale, delayed, mirrored, or incomplete inputs instead of overconfident health claims.

## 8) Hardware evidence gate

Use [Hardware Test Plan](./hardware-test-plan.md) to record manual evidence for:

- iPhone HealthKit collector;
- Apple Watch historical HealthKit samples;
- Apple Watch live workout heart-rate session;
- iOS background/observer delivery and stale-data UX;
- Oura direct cloud connector;
- WHOOP direct cloud connector;
- Oura and WHOOP mirrored Apple Health dedupe;
- Android Health Connect smoke test after iOS is green.

Hardware tests remain **pending** until a human supplies device/account evidence.

## WHOOP webhook trigger (optional)

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/providers/whoop/webhook" \
  -H "x-openvitals-whoop-signature: ${OPENVITALS_WHOOP_WEBHOOK_SECRET}" \
  -H "content-type: application/json" \
  -d '{"type":"whoop.recovery.updated","eventId":"evt_1"}'
```

If the implementation cannot verify an official WHOOP signature, treat the current shared-secret check as a dev/local webhook guard rather than production-grade signature verification.
