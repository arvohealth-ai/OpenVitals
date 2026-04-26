# Hardware Test Plan

This matrix records the manual evidence required before OpenVitals v0.6 can be called hardware-backed for iPhone, Apple Watch, Oura, WHOOP, and mirrored-source dedupe. Automated checks can verify contracts and mocks, but the hardware rows below remain **pending** until a human supplies device/account evidence.

## Evidence rules

- Do not mark a row passed without a timestamped human-provided result, log excerpt, screenshot, or exported API/MCP response from the real device/account.
- Do not claim Oura or WHOOP cloud data is continuous raw sensor streaming. It is provider-mediated delayed/daily sync data.
- Treat the iPhone companion app as the required Apple Health connector; do not require the watchOS app for ordinary HealthKit sync.
- Only Apple Watch live workout heart-rate samples can satisfy the live HR path.
- Preserve raw/provider payloads and platform samples for auditability, but judge normalized views by provenance, dedupe, freshness, and confidence.

## Automated preflight

For detailed setup and troubleshooting before collecting iPhone / Apple Watch evidence, follow the [iOS Hardware QA Runbook](./ios-hardware-runbook.md).

Run this before manual iPhone/Apple Watch QA:

```bash
pnpm smoke:apple-health
```

This local check uses synthetic Apple Health and Apple Watch-shaped payloads to verify the API accepts anchored HealthKit samples, Apple Watch live workout heart-rate semantics, mirrored-source filtering, timeline reads, and explainability. It does not replace hardware evidence.

## Status legend

| Status | Meaning |
| --- | --- |
| `pending-hardware` | Software path may exist, but required device/account evidence has not been supplied. |
| `blocked` | Setup cannot start because required hardware, account, entitlement, or credential is missing. |
| `passed` | Human evidence confirms the expected API/timeline and MCP/OpenClaw result. |
| `failed` | Human evidence or automated output shows the path does not meet acceptance. |

## Required cases

### 1. iPhone HealthKit collector

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | iPhone with Health app data and HealthKit permissions available. |
| Account/app setup | Install/run the iOS collector app; bootstrap a OpenVitals live user; create an Apple Health mobile session. |
| Env vars | `OPENVITALS_MODE=live`, `OPENVITALS_DB_PATH`, `OPENVITALS_ADMIN_TOKEN`, `OPENVITALS_SECRETS_KEY`. |
| Exact command or app action | `POST /v1/users/<userId>/connect/apple-health/session`, grant HealthKit permissions, run anchored upload for heart rate, HRV SDNN, resting HR, steps, sleep, and workouts. |
| Expected API/timeline result | Timeline/observations include real HealthKit samples with unit, timezone, source record ID/hash, source revision bundle ID, device metadata, anchor state, and `captureMode=direct`. Sync status shows latest upload/anchor and no pending failed batches. |
| Expected MCP/OpenClaw result | `health.sync_status` reports Apple Health freshness and sample granularity. `health.daily_brief` uses the samples only when freshness/confidence gates are satisfied. |
| Known limitations | Requires a real iPhone and HealthKit entitlement; simulator data is not sufficient for final hardware evidence. |

### 2. Apple Watch historical HealthKit samples

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | Apple Watch paired to the test iPhone with historical HR/workout/sleep data. |
| Account/app setup | Apple Watch writes to Apple Health; iPhone collector has permission to read relevant types. |
| Env vars | Same as iPhone collector. |
| Exact command or app action | Run anchored historical upload after Watch has recorded heart rate, HRV/resting HR where available, workouts, steps, and sleep. |
| Expected API/timeline result | API timeline shows Apple Watch source/device metadata, preserved timestamps, and no duplicate normalized records for mirrored provider data. |
| Expected MCP/OpenClaw result | Daily brief/recovery status can cite Apple Watch historical samples with freshness and source labels. |
| Known limitations | Apple Health availability varies by region/device settings; Watch must have generated the relevant samples before upload. |

### 3. Apple Watch live workout heart-rate session

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | Apple Watch paired to iPhone, able to start a workout session. |
| Account/app setup | Collector implements `HKWorkoutSession` and `HKLiveWorkoutBuilder`; HealthKit workout/heart-rate permissions granted. |
| Env vars | Same as iPhone collector. |
| Exact command or app action | Start live workout capture in the collector app, keep the workout active, and upload live HR samples during the session. |
| Expected API/timeline result | Timeline receives near-live HR samples labeled `dataGranularity=live_signal` and `latencyClass=live` or `near_realtime`, with workout/session identifiers and Watch source metadata. |
| Expected MCP/OpenClaw result | Agent output may describe live workout HR only while this live session is connected/fresh; outside that window it must fall back to stale/delayed language. |
| Known limitations | Live HR requires an active workout; background historical HealthKit sync does not satisfy this row. |

### 4. iOS background/observer delivery and stale-data UX

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | iPhone with HealthKit permissions and the companion app installed. |
| Account/app setup | Configure the iPhone companion with API base URL/profile token, create an Apple Health session, grant HealthKit permissions, and enable the safe subset of background/observer delivery supported by the app. |
| Env vars | Same as iPhone collector. |
| Exact command or app action | Run an initial anchored upload, generate or wait for a new HealthKit sample, let `HKObserverQuery`/background delivery or foreground fallback trigger incremental upload, then use manual **Sync Now** if iOS does not schedule delivery during the test window. |
| Expected API/timeline result | `/v1/users/<userId>/sync-status` shows updated last sync/anchor, pending ingest batches drain to zero, and stale-data warnings clear only after fresh accepted data. Timeline records remain `sample`/`episode` with `latencyClass=near_realtime` or `delayed_sync`, not `live_signal`. |
| Expected MCP/OpenClaw result | `health.sync_status` and brief/recovery tools disclose scheduler-mediated background sync and stale/missing data rather than claiming continuous monitoring. |
| Known limitations | iOS controls background delivery timing. A manual **Sync Now** fallback can prove incremental anchor reuse, but it does not prove OS-scheduled delivery. |

### 5. Oura direct cloud connector

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | Oura Ring with recent data and an Oura account/API app. |
| Account/app setup | Configure Oura OAuth app and redirect URI; connect a profile with Oura OAuth. |
| Env vars | `OPENVITALS_OURA_CLIENT_ID`, `OPENVITALS_OURA_CLIENT_SECRET`, `OPENVITALS_OURA_REDIRECT_URI`, optional `OPENVITALS_OURA_API_URL`, plus core live-mode vars. |
| Exact command or app action | Start Oura OAuth (`POST /v1/users/<userId>/connect/oura/start` when available), complete callback, then run `POST /v1/users/<userId>/sync` with `{"providerId":"oura","mode":"incremental"}`. |
| Expected API/timeline result | Timeline includes Oura heart-rate samples, sleep/readiness, SpO2, stress, and workouts returned by the account. Records preserve provider IDs, timestamps, units, freshness, confidence, and `dataGranularity` (`sample`, `daily_summary`, or `score` as appropriate). |
| Expected MCP/OpenClaw result | Daily brief/recovery status can cite Oura data as delayed/provider-mediated. It must not describe Oura as continuous raw live monitoring. |
| Known limitations | Direct Oura support must be present in the build; otherwise this row remains blocked or pending. API availability depends on Oura scopes and account history. |

### 6. WHOOP direct cloud connector

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | WHOOP device/account with recent recovery/sleep/workout data. |
| Account/app setup | Configure WHOOP OAuth app and redirect URI; connect a profile with WHOOP OAuth. |
| Env vars | `OPENVITALS_WHOOP_CLIENT_ID`, `OPENVITALS_WHOOP_CLIENT_SECRET`, `OPENVITALS_WHOOP_REDIRECT_URI`, `OPENVITALS_WHOOP_WEBHOOK_SECRET`, plus core live-mode vars. |
| Exact command or app action | Start WHOOP OAuth (`POST /v1/users/<userId>/connect/whoop/start`), complete callback, then run `POST /v1/users/<userId>/sync` with `{"providerId":"whoop","mode":"incremental"}`. |
| Expected API/timeline result | Timeline/derived state includes recovery, sleep, workouts, strain/load, average/max HR, HRV, resting HR, and HR-zone summaries where returned by WHOOP. Sync uses refresh/pagination safely and records freshness. |
| Expected MCP/OpenClaw result | Agent output describes WHOOP as delayed/provider-mediated recovery/sleep/workout data and reports stale/missing data when sync is stale. |
| Known limitations | WHOOP cloud APIs do not provide continuous raw HR streaming through this path. Webhook verification must be explicitly labeled dev/local if only a shared secret is implemented. |

### 7. Oura mirrored into Apple Health dedupe

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | Oura Ring/account, iPhone, Apple Health with Oura writing enabled. |
| Account/app setup | Connect Oura direct; allow Oura app to write relevant metrics into Apple Health; run iPhone collector. |
| Env vars | Core live-mode vars plus Oura OAuth vars. |
| Exact command or app action | Sync direct Oura, upload Apple Health mirrored Oura samples with Oura bundle/source metadata, then request score/timeline/explain endpoints. |
| Expected API/timeline result | Raw/provider and Apple mirrored records are retained. Normalized views prefer direct Oura for matching metric/window and suppress mirrored Apple copies. Explain output names the winner, suppressed source, and reason. |
| Expected MCP/OpenClaw result | Daily brief/recovery status does not double-count Oura sleep/HR/recovery data and can explain mirrored-source suppression. |
| Known limitations | Requires Oura-to-Apple-Health sharing enabled and direct Oura connector availability. |

### 8. WHOOP mirrored into Apple Health dedupe

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | WHOOP device/account, iPhone, Apple Health with WHOOP writing enabled. |
| Account/app setup | Connect WHOOP direct; allow WHOOP app to write relevant metrics into Apple Health; run iPhone collector. |
| Env vars | Core live-mode vars plus WHOOP OAuth vars. |
| Exact command or app action | Sync direct WHOOP, upload Apple Health mirrored WHOOP samples with `bundleId: "com.whoop.mobile"`, then request score/timeline/explain endpoints. |
| Expected API/timeline result | Raw/provider and Apple mirrored records are retained. Normalized views prefer direct WHOOP for matching metric/window and suppress mirrored Apple copies. Explain output names the winner, suppressed source, and reason. |
| Expected MCP/OpenClaw result | Daily brief/recovery status does not double-count WHOOP sleep/recovery/workout data and can explain mirrored-source suppression. |
| Known limitations | Requires WHOOP-to-Apple-Health sharing enabled. |

### 9. Android Health Connect smoke test

| Field | Requirement |
| --- | --- |
| Status | `pending-hardware` |
| Required hardware | Android device with Health Connect and sample health data. |
| Account/app setup | Run Android collector/reference after iOS path is green; grant Health Connect permissions. |
| Env vars | Core live-mode vars. |
| Exact command or app action | Create Health Connect/mobile session if supported by the build, grant permissions, upload a narrow set of heart-rate/steps/sleep samples. |
| Expected API/timeline result | Timeline includes Android platform samples with source metadata and freshness. |
| Expected MCP/OpenClaw result | `health.sync_status` reports Health Connect as prototype/mobile-permission data and agent output avoids treating it as the primary v0.6 live wedge. |
| Known limitations | This is a smoke test after iOS acceptance; not a replacement for Apple Watch live workout evidence. |

## Final acceptance checklist

| Gate | Required evidence | Status |
| --- | --- | --- |
| Automated docs | `pnpm docs:generate` output and clean generated docs. | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Typecheck | `pnpm typecheck`. | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Tests | `pnpm test`. | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Smoke E2E | `pnpm smoke:e2e`. | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Orchestrator verification | `pnpm agent:workflow verify --run openvitals-v0.6`. | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Oura hardware | Case 5 plus case 7 if mirrored dedupe is enabled. | pending-hardware |
| WHOOP hardware | Case 6 plus case 8 if mirrored dedupe is enabled. | pending-hardware |
| iPhone + Apple Watch hardware | Cases 1, 2, 3, and 4. | pending-hardware |
| Android smoke | Case 9 after iOS path is green. | pending-hardware |
