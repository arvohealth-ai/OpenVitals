# OpenVitals iOS Companion App Agent Task Brief

> Languages: [English](./openvitals-ios-companion.md) | [简体中文](./openvitals-ios-companion-zh.md)


Repo: `<path-to-openvitals>`

Goal: turn the current Apple Health/Apple Watch reference template into a production-shaped OpenVitals iOS companion experience where the iPhone app is the primary required install path and the Apple Watch app is an optional add-on for explicit live workout heart-rate capture.

Product decision:
- The iPhone app is the main Apple Health connector. It owns login/profile selection, API endpoint setup, HealthKit authorization, historical sync, background/incremental sync, sync status, stale-data UX, and manual "Sync Now".
- The Apple Watch app is optional. It should only be needed for live workout heart-rate capture using `HKWorkoutSession` + `HKLiveWorkoutBuilder`.
- Apple Watch historical data should still work through the iPhone app after the Watch writes data into Apple Health and HealthKit syncs it to the iPhone.
- Do not require end users to keep the iPhone or Apple Watch physically connected to a Mac. Physical USB/Xcode connection is only for development, installation, and hardware QA.

Important constraints:
- Keep Apple Health semantics honest. Historical HealthKit samples are delayed or near-realtime platform samples, not continuous live streams.
- Only active Apple Watch workout-session heart-rate samples may be represented as `dataGranularity=live_signal` and `latencyClass=live`.
- Do not make watchOS installation mandatory for normal Apple Health sync.
- Keep existing API/runtime/MCP/OpenClaw boundaries intact.
- Do not commit generated XcodeGen artifacts (`OpenVitalsHealthKitDemo.xcodeproj`, generated `Info.plist` files).
- Hardware evidence remains pending unless a real iPhone/Apple Watch run provides timestamped logs, screenshots, or API/MCP output.

## Phase 0: Baseline And Current-State Verification

Tasks:
- Read the current Apple Health implementation in:
  - `examples/mobile-ios-minimal-app`
  - `packages/collector-ios`
  - `packages/collector-mobile-core`
  - `providers/apple-health`
  - `apps/api`
  - `packages/runtime`
- Confirm current XcodeGen setup builds under the installed Xcode.
- Confirm API-level Apple Health smoke tests still pass.
- Identify which generated files are ignored and must stay uncommitted.

Acceptance:
- `pnpm smoke:apple-health` passes.
- `pnpm --filter @openvitals/collector-ios test` passes.
- `xcodegen generate` succeeds in `examples/mobile-ios-minimal-app`.
- `xcodebuild` simulator build for `OpenVitalsHealthKitDemo` succeeds with `CODE_SIGNING_ALLOWED=NO`.
- Baseline report explicitly states whether a physical iPhone/Apple Watch is currently detected.

## Phase 1: Product UX And App Scope Definition

Tasks:
- Define the production UX for the iPhone companion app:
  - profile selection or token setup
  - API endpoint setup for local and production modes
  - HealthKit permission onboarding
  - initial sync
  - passive/background sync status
  - manual "Sync Now"
  - stale-data warnings
  - mirrored-source explanation
  - troubleshooting state when HealthKit permissions are missing or partial
- Define the optional watchOS UX:
  - optional install state
  - start/stop live workout HR capture
  - connection/upload status
  - graceful message when the iPhone app is not configured
- Document the product rule:
  - iPhone app required for Apple Health connector
  - Watch app optional for live workout HR only
  - historical Watch data flows through iPhone HealthKit

Acceptance:
- A short UX spec exists under `docs/` or `examples/mobile-ios-minimal-app/`.
- README/quickstart language does not imply the Watch app is required for ordinary Apple Health sync.
- Agent-facing docs distinguish `delayed_sync`, `near_realtime`, and `live_signal`.

## Phase 2: Promote The iPhone App From QA Shell To Companion App

Tasks:
- Improve `examples/mobile-ios-minimal-app/Sources/OpenVitalsHealthKitDemoApp.swift` into a usable companion flow:
  - setup screen for API base URL and token/profile
  - HealthKit permission state display
  - connect/session creation action
  - initial sync action
  - manual sync action
  - sync status refresh
  - last sync, last anchor, processed count, dropped mirrored count, and stale warning display
  - clear error presentation
- Keep UI practical and tool-like. Avoid marketing hero screens.
- Persist local settings safely in user defaults or a small local settings layer.
- Preserve current collector API usage patterns rather than inventing a new SDK surface unless it reduces real complexity.

Acceptance:
- iPhone app remains buildable in simulator.
- The app can be configured for local API testing with `http://<Mac-LAN-IP>:3000`.
- No secrets are hardcoded.
- Failure states are visible for missing endpoint, missing token, missing HealthKit permission, failed session creation, failed ingest, and stale sync status.

## Phase 3: Add Background/Incremental Sync Shape

Tasks:
- Add or document the HealthKit background sync strategy:
  - `HKObserverQuery` / HealthKit background delivery where appropriate
  - anchored query reuse for incremental upload
  - foreground fallback and "Sync Now"
  - app lifecycle handling
- Implement the safe subset that can be built and unit-tested without hardware.
- If full background delivery cannot be validated without hardware, document the manual test and mark it pending hardware.
- Ensure background sync language stays honest: "background sync" and "near-realtime when iOS schedules delivery", not guaranteed live monitoring.

Acceptance:
- Code and docs show how initial sync and incremental sync share anchors.
- API payloads continue to include source revision, bundle ID, device metadata, timezone, source record ID/hash, freshness, and confidence.
- Hardware test plan has a concrete case for background/observer delivery.

## Phase 4: Make watchOS Optional Live Mode

Tasks:
- Keep `examples/mobile-ios-minimal-app/WatchApp` as an optional target/add-on.
- Ensure the watch app does not block iPhone-only Apple Health sync.
- Improve watchOS UI for:
  - configured/unconfigured state
  - start live workout capture
  - stop live workout capture
  - live HR upload status
  - error state if HealthKit/workout permission is missing
- Ensure live workout records include:
  - `dataGranularity=live_signal`
  - `latencyClass=live`
  - `connectionMode=device_pairing`
  - `captureMode=direct`
  - Apple Watch source metadata
- Ensure historical HealthKit records remain `sample` or `episode` with `latencyClass=delayed_sync` or `near_realtime`, not `live_signal`.

Acceptance:
- iPhone-only build path remains documented and functional.
- watchOS target builds in simulator.
- Live HR semantics remain restricted to active workout-session records.
- Docs explicitly say the Watch app is optional unless the user wants live workout HR.

## Phase 5: API, Runtime, MCP, And Agent Surface Alignment

Tasks:
- Verify existing API ingest/session/status routes fully support the companion app:
  - `/v1/users/:id/connect/apple-health/session`
  - `/v1/users/:id/ingest/apple-health`
  - `/v1/users/:id/sync-status`
  - timeline/explain endpoints
- Add missing response fields only if needed by the app UX.
- Ensure MCP/OpenClaw language says:
  - Apple Health connected through iPhone companion app
  - Watch historical samples arrive through Apple Health
  - live HR requires optional Watch live workout mode
  - stale or missing data should be explicitly disclosed

Acceptance:
- Existing smoke checks continue to pass.
- New or updated tests cover any new app-visible API fields.
- MCP/agent docs do not overclaim real-time monitoring.

## Phase 6: Documentation And Hardware QA

Tasks:
- Update docs:
  - `README.md`
  - `docs/real-data-quickstart.md`
  - `docs/hardware-test-plan.md`
  - `examples/mobile-ios-minimal-app/README.md`
  - any generated provider docs via `pnpm docs:generate`
- Add a user-facing Apple Health setup guide:
  - install iPhone app
  - connect profile/API
  - grant HealthKit permissions
  - initial sync
  - optional Apple Watch app for live workout HR
  - troubleshooting stale data and background sync limits
- Add developer local testing guide:
  - run API on `HOST=0.0.0.0 PORT=3000`
  - use Mac LAN IP from iPhone
  - generate Xcode project
  - configure bundle IDs and team
  - run on iPhone
  - run optional Watch target

Acceptance:
- Docs clearly separate local development USB/Xcode requirements from end-user runtime behavior.
- Hardware test plan includes:
  - iPhone-only Apple Health historical sync
  - Apple Watch historical data via iPhone HealthKit
  - optional Watch live workout HR
  - background/observer delivery
  - stale-data UX
  - mirrored Oura/WHOOP source handling

## Phase 7: Verification And Final Delivery

Required automated verification:
- `pnpm docs:generate`
- `pnpm build`
- `pnpm test`
- `pnpm smoke:e2e`
- `pnpm smoke:apple-health`
- `pnpm typecheck`
- `pnpm --filter @openvitals/collector-ios test`
- `xcodegen generate` in `examples/mobile-ios-minimal-app`
- `xcodebuild` simulator build for iPhone app
- `xcodebuild` simulator build for watchOS target if supported by the generated project

Manual hardware verification, if devices are available:
- iPhone app installs on a physical iPhone.
- iPhone app requests HealthKit permissions.
- iPhone app uploads at least one real sample for heart rate, HRV SDNN, resting HR, steps, sleep, and workout when available.
- Apple Watch historical samples appear through iPhone HealthKit upload.
- Optional watchOS app starts a workout session and uploads live heart-rate samples.
- API timeline and MCP/OpenClaw outputs show freshness, granularity, and source metadata honestly.

Final deliverable:
- Summary of changed files.
- UX decision summary: iPhone app required, watchOS optional.
- Test command outputs.
- Hardware evidence if available, otherwise explicit `pending-hardware` list.
- Remaining limitations around iOS background delivery timing and live/raw-data claims.
