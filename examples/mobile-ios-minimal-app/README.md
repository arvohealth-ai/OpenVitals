# iOS Companion App Template (Apple Health + Optional Apple Watch)

This folder is the v0.6 Xcode template surface for an iPhone-hosted Apple Health companion plus an optional Apple Watch live-workout heart-rate stream. The iPhone app is the required install path for ordinary Apple Health sync. The watchOS app is optional and only needed for explicit live workout HR capture. The Swift collector can still be copied into another app, but this folder now also includes an XcodeGen project template and minimal SwiftUI shells for hardware QA.

## Companion UX shape

The iPhone companion should expose a practical setup and status flow:

1. Configure the OpenVitals API base URL and user/profile token.
2. Request and explain HealthKit permissions.
3. Create the Apple Health connector session.
4. Run initial sync and manual **Sync Now**.
5. Show last sync, last anchor, processed/uploaded counts, dropped mirrored count, pending ingest batches, latest error, and stale-data warnings from `/v1/users/:id/sync-status`.
6. Explain that Apple Watch historical data arrives through iPhone HealthKit, while the watchOS app is only for live workout HR.

The optional watchOS app should show configured/unconfigured state, HealthKit/workout permission errors, **Start Live Workout HR**, **Stop**, upload status, and the last heart-rate timestamp.

## What it demonstrates

1. Create a per-user connector session (`/v1/users/:id/connect/apple-health/session`).
2. Request HealthKit permission for heart rate, HRV SDNN, resting heart rate, step count, sleep analysis, and workouts.
3. Run `HKAnchoredObjectQuery` passes for historical/incremental upload.
4. Include `HKSourceRevision.bundleIdentifier`, source name/version, HealthKit device metadata, timezone, source record ID, and anchor state.
5. Mark Oura/WHOOP records mirrored through Apple Health as `captureMode = "mirrored"` with the source bundle ID preserved.
6. Upload anchored batches with `collectorMeta` and retry on server anchor conflicts by reading `/v1/users/:id/sync-status`.
7. Optionally stream Apple Watch workout heart-rate samples as `dataGranularity = "live_signal"` and `latencyClass = "live"` from `HKLiveWorkoutBuilder`.

## Local API setup

Run the API on a network address reachable from the iPhone or watch. `127.0.0.1` only works inside the simulator or on the same host, not from a physical iPhone. End users should not need to keep a Mac physically connected; USB/Xcode is only for development, installation, and hardware QA.

```bash
HOST=0.0.0.0 PORT=3000 pnpm demo
```

Create a live test profile and use the returned derived/full token in the sample app:

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: openvitals-dev-admin" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Live User","timezone":"Asia/Shanghai","providers":["apple-health"],"createTokens":true}'
```

## Xcode template setup

The template uses [XcodeGen](https://github.com/yonaskolb/XcodeGen) so the project file stays generated:

```bash
cd examples/mobile-ios-minimal-app
brew install xcodegen
export OPENVITALS_APPLE_TEAM_ID="<Apple Developer Team ID>"
export OPENVITALS_IOS_BUNDLE_ID="ai.openvitals.healthkitdemo"
export OPENVITALS_WATCH_BUNDLE_ID="ai.openvitals.healthkitdemo.watch"
xcodegen generate
open OpenVitalsHealthKitDemo.xcodeproj
```

`project.yml` includes development defaults for the bundle IDs so the generated project can run from Xcode without inheriting shell environment variables. For physical-device testing, set unique bundle IDs and a real Apple Developer Team ID in Xcode build settings, or pass the same values as `xcodebuild` build settings.

The generated iOS and watchOS targets include:

- HealthKit entitlement.
- HealthKit usage descriptions.
- Local-network usage description.
- Development-only App Transport Security allowance for local HTTP testing.
- Keychain storage for bearer/session tokens; `UserDefaults` keeps non-sensitive setup fields and anchors.

If you prefer a local app, add `OpenVitalsCollector.swift` to that app target and mirror the entitlements/usage strings from `project.yml`.

The default `OpenVitalsHealthKitDemo` scheme builds the iPhone app only. The watchOS target is intentionally left in its own `OpenVitalsWatchDemo` scheme so teams can validate ordinary iPhone HealthKit sync without requiring a paired Apple Watch provisioning profile. Use the watchOS scheme only when testing optional live workout heart-rate capture.

For Personal Team hardware testing, use a bundle identifier under your own namespace:

```bash
xcodebuild -project OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsHealthKitDemo \
  -configuration Debug \
  -destination 'id=<IOS_DEVICE_ID>' \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM='<PERSONAL_TEAM_ID>' \
  PRODUCT_BUNDLE_IDENTIFIER='com.example.openvitals.healthkitdemo' \
  CODE_SIGN_STYLE=Automatic \
  build
```

The generated project also exposes `OPENVITALS_APPLE_TEAM_ID` and `OPENVITALS_IOS_BUNDLE_ID`, but direct `DEVELOPMENT_TEAM` / `PRODUCT_BUNDLE_IDENTIFIER` CLI overrides are the most reliable path for physical-device signing.

After installing a Personal Team build, iOS may block launch until the developer profile is trusted on the phone. On the iPhone, open **Settings -> General -> VPN & Device Management**, select the Apple Development profile, and tap **Trust**.

During hardware QA, the iPhone app can be prefilled at launch so you do not have to type long tokens on the phone:

```bash
TOKEN="$(jq -r '.tokens[] | select(.label=="derived") | .token' /tmp/openvitals-apple-bootstrap.json)"
DEVICECTL_CHILD_OPENVITALS_IOS_BASE_URL='http://<Mac-LAN-IP>:3000' \
DEVICECTL_CHILD_OPENVITALS_IOS_USER_ID='user_live_apple_hw' \
DEVICECTL_CHILD_OPENVITALS_IOS_BEARER_TOKEN="$TOKEN" \
DEVICECTL_CHILD_OPENVITALS_IOS_LOOKBACK_DAYS='30' \
DEVICECTL_CHILD_OPENVITALS_IOS_MAX_RECORDS_PER_TYPE='1' \
DEVICECTL_CHILD_OPENVITALS_IOS_AUTO_QA='1' \
xcrun devicectl device process launch \
  --device '<IOS_DEVICE_ID>' \
  --terminate-existing \
  com.example.openvitals.healthkitdemo
```

The `DEVICECTL_CHILD_` values are passed only to the launched app process. The app stores the token in local Keychain and non-sensitive fields in `UserDefaults`. `OPENVITALS_IOS_AUTO_QA=1` asks the app to request HealthKit permission on launch and, after the user accepts the system prompt, create an Apple Health session and run the initial anchored sync.

`OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1` is for hardware smoke tests over fragile networks. It uploads at most one record per HealthKit type and does not advance the local HealthKit anchor. Leave it unset for a normal initial sync.

Keep the iPhone unlocked during this launch. If `devicectl` reports `SBMainWorkspace ... reason: Locked`, unlock the phone and retry. As a fallback for launch environment delivery, `devicectl device process launch --environment-variables '<json>'` can pass the same unprefixed `OPENVITALS_IOS_*` keys; avoid printing that JSON because it contains the bearer token.

Use `--console` when diagnosing hardware QA. The app prints `[OpenVitalsHardwareQA]` breadcrumbs for launch-env handling and sync stages without printing tokens. If HealthKit succeeds but ingest fails with `NSURLErrorDomain Code=-1001` against `http://<Mac-LAN-IP>:3000/.../ingest/apple-health`, enable iPhone Settings -> Privacy & Security -> Local Network -> OpenVitals and confirm the Mac API is listening on `HOST=0.0.0.0`. Prefer LAN for ingest tests; temporary HTTPS tunnels can work for GET probes but may fail large or repeated HealthKit ingest with `413` or `524`.

In a custom view model, create the collector:

```swift
let collector = OpenVitalsCollector(
    baseURL: URL(string: "http://127.0.0.1:3000")!,
    token: "<agent-or-demo-token>"
)
let anchorStore = UserDefaultsAnchorStore()
```

6. On first run:

```swift
try await collector.requestAuthorization()
let session = try await collector.createAppleSession(userId: "user_live")
let summary = try await collector.collectAndUploadAnchoredBatch(
    userId: "user_live",
    sessionToken: session.sessionToken,
    anchorStore: anchorStore,
    lookbackDays: 30
)
print("Uploaded \(summary.uploadedRecordCount) records; anchor=\(summary.anchorAfter ?? "nil")")
```

7. Schedule the same `collectAndUploadAnchoredBatch(...)` call from foreground refresh, background app refresh, HealthKit observer delivery where available, or a local **Sync Now** button. The anchor envelope stores one HealthKit anchor per sample type, so later runs upload only new/deleted objects returned by HealthKit. Describe this as scheduler-mediated background sync/near-realtime delivery, not guaranteed live monitoring.

## Automated local preflight

Before using hardware, run the API-level preflight. This does not satisfy hardware acceptance, but it verifies that the server accepts Apple Health historical samples, Apple Watch live workout heart-rate semantics, anchor state, mirrored-source filtering, timeline reads, and explainability.

```bash
pnpm smoke:apple-health
```

## Apple Watch live workout path

The server should only receive `live_signal` Apple Watch heart-rate samples while a real workout session is active and fresh. Historical Apple Health/Apple Watch samples remain delayed or near-realtime HealthKit sync data uploaded by the iPhone app.

For a watchOS target, add the same Swift file and configure `AppleWatchLiveWorkoutHeartRateStreamer`:

```swift
let streamer = AppleWatchLiveWorkoutHeartRateStreamer(collector: collector)
streamer.onHeartRateRecord = { record in
    Task {
        try await collector.uploadAnchoredBatch(
            userId: "user_live",
            sessionToken: session.sessionToken,
            anchorStore: anchorStore,
            anchorAfter: anchorStore.anchor(for: "apple-health", userId: "user_live"),
            records: [record]
        )
    }
}
try await streamer.start(activityType: .other)
```

Live workout records are tagged with:

- `data_granularity:live_signal`
- `latency_class:live`
- `connection_mode:device_pairing`
- `source_product:apple_watch`

Do **not** describe Oura or WHOOP cloud data as live/raw streams. Oura/WHOOP records that appear in Apple Health are mirrored records and should be deduped against direct provider data.

## Mirrored source handling

The collector treats these bundle identifiers as mirrored origins:

- WHOOP: `com.whoop.mobile`, `com.whoop.ios`
- Oura: `com.ouraring.oura`, `com.oura.health`

Mirrored records are uploaded with lower confidence (`0.8`), `captureMode = "mirrored"`, and the original bundle ID. The API rejects mirrored Apple Health records without a bundle ID because provenance-safe dedupe depends on it.

## Manual hardware test path

For detailed physical-device setup and failure recovery, see [`docs/ios-hardware-runbook.md`](../../docs/ios-hardware-runbook.md). It records common issues such as Xcode using only Command Line Tools, missing iOS/watchOS platform support, `pnpm` not being on `PATH`, physical devices not appearing in Xcode, iPhone Developer Mode being disabled, missing signing identities, GUI builds missing bundle ID environment variables, and Watch companion packaging errors.

If the HealthKit permission sheet is hard to find after launch, check iPhone Settings -> Health -> Data Access & Devices -> OpenVitals, or Health app -> profile picture -> Privacy -> Apps -> OpenVitals. If OpenVitals is not listed, open the app and tap **Request HealthKit Permission** once so iOS registers it as a Health-compatible app. Also allow Local Network for the app during LAN-based hardware QA.

Hardware is required for final acceptance. Record evidence for each item in the team QA/hardware matrix:

1. Run the generated iOS app on a physical iPhone and grant HealthKit permissions.
2. Confirm the Apple Watch contributes at least one heart-rate/workout sample visible in HealthKit.
3. Run `collectAndUploadAnchoredBatch(...)` and confirm `/v1/timeline?userId=<userId>` includes real heart rate, HRV SDNN, resting heart rate, steps, sleep, and workout entries with source metadata.
4. Run the watchOS target, start a workout session, and confirm live heart-rate uploads have `data_granularity:live_signal` and `latency_class:live` tags.
5. If Oura or WHOOP write into Apple Health, confirm those records upload as `captureMode=mirrored` and include the originating bundle ID.
6. Confirm direct Oura/WHOOP provider data wins over mirrored Apple Health copies in normalized views.

Current repo verification can validate the collector code and API semantics; final hardware evidence requires a physical iPhone, paired Apple Watch, HealthKit permissions, and full Xcode.
