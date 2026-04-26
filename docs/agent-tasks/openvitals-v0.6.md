# OpenVitals v0.6 Agent Task Brief

Repo: `<path-to-openvitals>`

Goal: turn the current prototype into a hardware-backed live-data wedge for iPhone + Apple Watch + Oura Ring + WHOOP, while keeping the repo green and making data semantics honest for agent use.

Important constraints:
- Do not accidentally remove or commit `demo/openclaw-openvitals/vendor/openvitals-platform`; if working in a repository that contains this dirty vendor/demo entry, leave it untouched.
- Do not market WHOOP/Oura cloud data as continuous raw sensor streams.
- Distinguish provider payloads, platform samples, summaries, scores, and true live signals.
- Keep edits scoped. Preserve existing API/runtime/MCP/OpenClaw structure.

## Phase 0: Stabilize The Repo

First make the repository green before adding new features.

Tasks:
- Fix the contracts/source/dist/type-resolution mismatch across `packages/contracts`, `packages/runtime`, `apps/api`, `packages/mcp`, and providers.
- Ensure consumer-visible exports include all currently used types/schemas/functions, including provider credentials, connection methods, source precedence overrides, and sync status fields.
- Fix the runtime source precedence override bug. The failing test currently expects Apple Health to win after override, but WHOOP still wins.
- Confirm `refreshDerivedState`, `setSourcePrecedence`, `SourcePrecedenceInputSchema`, `ProviderCredentialSchema`, `ConnectionMethod`, `ProviderCredential`, and sync status types are exported consistently.
- Regenerate docs/types where needed.

Acceptance:
- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm smoke:e2e` passes.
- No unrelated vendor/demo changes are introduced.

## Phase 1: Add Data Capability Semantics

Make the data model agent-safe.

Add or refine canonical fields/types:
- `dataGranularity`: `provider_payload`, `sample`, `episode`, `daily_summary`, `score`, `live_signal`.
- `latencyClass`: `live`, `near_realtime`, `delayed_sync`, `daily`, `manual`.
- `connectionMode`: `cloud_oauth`, `mobile_permission`, `device_pairing`, `mock`.
- Provider/metric capability metadata: metric name, source, granularity, expected latency, whether it is direct or mirrored.
- Freshness and confidence must be visible in API, MCP, dashboard, and explanations.

Documentation updates:
- Stop using “raw data” loosely.
- Say: OpenVitals handles provider raw payloads, mobile platform samples, normalized episodes, summaries, scores, and live signals.
- Explicitly document that Apple Watch live workout is the live HR path; Oura/WHOOP cloud APIs are delayed/provider-mediated data.

Acceptance:
- Provider matrix accurately shows WHOOP, Oura, Apple Health, Health Connect capability levels.
- MCP and API responses expose enough freshness/granularity info for an agent to avoid overconfident claims.

## Phase 2: Implement Real Oura Connector

Current Oura provider is mock-only. Build real OAuth/API support.

Tasks:
- Add `providers/oura/src/live.ts`.
- Support env config:
  - `OPENVITALS_OURA_CLIENT_ID`
  - `OPENVITALS_OURA_CLIENT_SECRET`
  - `OPENVITALS_OURA_REDIRECT_URI`
  - optional `OPENVITALS_OURA_API_URL`
- Add Oura OAuth start/callback flow, either via generalized provider credential flow or Oura-specific routes matching the WHOOP pattern.
- Fetch and normalize:
  - `/v2/usercollection/heartrate`
  - daily sleep / sleep sessions
  - daily readiness
  - daily SpO2
  - daily stress
  - workouts if available
- Normalize Oura heart rate rows as `heart_rate` observations with `dataGranularity=sample`, not true live.
- Preserve Oura source IDs, timestamps, units, source type, confidence, and freshness.

Hardware test:
- Use the Oura Ring account.
- Confirm real Oura heart rate samples appear in timeline/API.
- Confirm Oura sleep/readiness affect daily brief/recovery scores.

Acceptance:
- Oura moves from `demo-only` to `real-data-beta` or `real-data-ready`.
- Oura real connector has unit tests and at least one documented manual hardware test path.

## Phase 3: Build A Real iPhone + Apple Watch Collector Path

The current Swift file is a helper, not a complete hardware test app.

Tasks:
- Turn `examples/mobile-ios-minimal-app` into a runnable minimal iOS sample, or add a clear Xcode project/template if that is the preferred local pattern.
- Implement HealthKit authorization for:
  - heart rate
  - HRV SDNN
  - resting heart rate
  - step count
  - sleep analysis
  - workouts
- Implement anchored queries for historical/incremental upload.
- Include `HKSourceRevision.bundleIdentifier`, device info, timezone, unit, source record ID/hash, and anchor state.
- Mark Oura/WHOOP records mirrored through Apple Health as `captureMode=mirrored` with correct bundle/source metadata.
- Add optional Apple Watch live workout path:
  - `HKWorkoutSession`
  - `HKLiveWorkoutBuilder`
  - stream live heart rate during workout session
  - classify as `dataGranularity=live_signal` or equivalent.

Hardware test:
- iPhone grants HealthKit permissions.
- Apple Watch contributes HR/workout data.
- At least one real HR, HRV, resting HR, step, sleep, and workout sample can be uploaded.
- Live workout session produces near-live heart rate samples.

Acceptance:
- API timeline shows real Apple Health/Apple Watch records with provenance.
- Sync status shows freshness and last uploaded anchor.
- Daily brief can use Apple Watch/HealthKit data without duplicate Oura/WHOOP mirrored data.

## Phase 4: Harden WHOOP Live Connector

Current WHOOP connector exists but should be made more honest and robust.

Tasks:
- Verify OAuth scopes, token refresh, and endpoint parsing.
- Normalize sleep, recovery, workout, HRV, resting HR, strain/load, average/max HR, and heart-rate-zone summaries where available.
- Use `updated_at`/pagination safely for incremental sync.
- Make webhook handling explicit: official signature verification if supported; otherwise label current secret check as dev/local webhook security.
- Do not claim continuous raw heart-rate streaming from WHOOP cloud API.

Hardware test:
- Use the WHOOP account/device.
- Complete OAuth connect.
- Sync sleep/recovery/workout.
- Confirm recovery scores and daily brief change from real WHOOP data.

Acceptance:
- WHOOP connector has tests around representative API payloads.
- Real hardware test is documented.
- API/MCP reports WHOOP data as delayed/provider-mediated, not live raw data.

## Phase 5: Fix Dedupe, Provenance, And Freshness

This is central to trust.

Tasks:
- Fix source precedence overrides.
- Add explicit source filters for mirrored Apple Health records from Oura and WHOOP.
- Direct Oura/WHOOP should usually win over mirrored HealthKit copies for the same metric/window.
- Keep all raw/provider records, but normalized views should expose the primary record and suppress duplicates.
- Explanations must show which source won, which source was suppressed, and why.

Hardware test:
- Connect Oura direct and allow Oura to write into Apple Health.
- Connect WHOOP direct and allow WHOOP to write into Apple Health.
- Confirm mirrored Apple Health copies do not double-count against direct Oura/WHOOP records.

Acceptance:
- `explain_dedupe` clearly shows direct vs mirrored behavior.
- Daily summary and scores do not double-count sleep, HR, recovery, or workouts.
- Freshness warnings appear when data is stale or missing.

## Phase 6: Update Agent/MCP/OpenClaw Behavior

Make agent surfaces aware of data quality.

Tasks:
- Enrich `health.sync_status`, `health.daily_brief`, `health.recovery_status`, and `health.explain_score` with data granularity and freshness.
- Add or update an MCP tool such as `health.signal_freshness` if needed.
- Update OpenClaw skill/workspace prompts so the agent says when data is stale, delayed, mirrored, or incomplete.
- The agent should not say “real-time monitoring” unless live Apple Watch/workout data is actually connected.

Acceptance:
- MCP output is usable by another agent without hidden assumptions.
- Daily brief explicitly distinguishes current signals, delayed provider data, and stale/missing data.

## Phase 7: Hardware QA Matrix

Create `docs/hardware-test-plan.md`.

Include test cases for:
- iPhone HealthKit collector.
- Apple Watch historical HealthKit samples.
- Apple Watch live workout heart-rate session.
- Oura direct cloud connector.
- WHOOP direct cloud connector.
- Oura mirrored into Apple Health dedupe.
- WHOOP mirrored into Apple Health dedupe.
- Android Health Connect smoke test after iOS path is green.

For each case record:
- required hardware
- account/app setup
- env vars
- exact command or app action
- expected API/timeline result
- expected MCP/OpenClaw result
- known limitations

## Phase 8: README And Quickstarts

Update:
- `README.md`
- `docs/real-data-quickstart.md`
- `docs/family-quickstart.md`
- generated provider docs

The docs should say:
- OpenVitals is an agent-native health data plane and proactive runtime.
- v0.6 focuses on Apple Health/Apple Watch, Oura, and WHOOP.
- Apple Watch live HR requires the live workout collector path.
- Oura provides cloud time-series/summaries, not raw sensor streams.
- WHOOP provides official cloud recovery/sleep/workout data, not continuous raw HR.
- Dedupe/provenance/freshness are first-class features.

Final required verification:
- `pnpm docs:generate`
- `pnpm typecheck`
- `pnpm test`
- `pnpm smoke:e2e`
- Manual Oura hardware test
- Manual WHOOP hardware test
- Manual iPhone + Apple Watch HealthKit test
- Manual dedupe test with mirrored Oura/WHOOP data in Apple Health

Final deliverable:
- Summary of changed files.
- Test command outputs.
- Hardware test evidence.
- Remaining limitations, especially around realtime/raw-data claims.
