# iOS Hardware QA Runbook

> Languages: [English](./ios-hardware-runbook.md) | [简体中文](./ios-hardware-runbook-zh.md)


This runbook captures the real setup failures, checks, and recovery steps seen while validating the OpenVitals iPhone companion and optional Apple Watch live-workout app. Keep it close to the hardware path: most automated checks can prove build and API semantics, but final Apple Health and Apple Watch acceptance still needs real devices and user-granted HealthKit permissions.

## What Can Be Automated

Developers and CI can automate these checks:

```bash
pnpm --filter @openvitals/collector-ios test
pnpm smoke:apple-health
```

`pnpm smoke:apple-health` starts an in-process API and sends synthetic Apple Health / Apple Watch-shaped payloads. It verifies anchored ingest semantics, mirrored-source filtering, timeline reads, explainability, and that live workout heart-rate records are labeled `dataGranularity=live_signal` and `latencyClass=live`.

Local development can also automate project generation, simulator builds, and simulator launch. The default iPhone scheme intentionally builds only the iPhone app; the watchOS app remains in its own optional scheme:

```bash
cd examples/mobile-ios-minimal-app
xcodegen generate
xcodebuild -project OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsHealthKitDemo \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -project OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsWatchDemo \
  -configuration Debug \
  -destination 'generic/platform=watchOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

These checks do not prove real HealthKit access, Apple Watch historical samples, Apple Watch live workout heart rate, background delivery, or provider-mirrored dedupe against real Apple Health data.

## What Requires A Human Or A Physical Device

- Trusting the Mac on the iPhone.
- Enabling Developer Mode on the iPhone.
- Trusting the Personal Team developer profile after first install, when iOS requires it.
- Signing in to Xcode with an Apple Developer account if automatic signing needs to create certificates or provisioning profiles.
- Granting HealthKit permissions on iPhone / Apple Watch.
- Starting and stopping the Apple Watch live workout session.
- Confirming real Health app samples exist for heart rate, HRV SDNN, resting heart rate, steps, sleep, and workouts.

## Local API Setup For Physical Devices

Start the API on the LAN. Do not use loopback-only binding for physical iPhone or Watch testing.

```bash
HOST=0.0.0.0 PORT=3000 OPENVITALS_MODE=live pnpm demo
```

Find the Mac LAN address:

```bash
ipconfig getifaddr en0
```

Use `http://<Mac-LAN-IP>:3000` in the iPhone and Watch apps. `http://127.0.0.1:3000` only works from the Mac or local simulators; on a physical iPhone it points back to the iPhone itself.

Prefer the LAN URL for hardware QA. Temporary HTTPS tunnels are useful for OAuth callbacks and quick GET probes, but they can be unreliable for HealthKit ingest: during hardware QA, localtunnel returned `503 Tunnel Unavailable`, and a Cloudflare quick tunnel returned `413 Payload Too Large` / `524 A timeout occurred` on Apple Health ingest. If a tunnel is required, use a smoke-sized upload first and do not treat tunnel success as proof that normal LAN sync works.

Bootstrap a live test profile:

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live_apple_hw","name":"Apple Hardware Test","timezone":"Asia/Shanghai","providers":["apple-health"],"createTokens":true}'
```

Use the returned `derived` or `full` token in the iPhone app. Store real tokens only in local Keychain / local secret stores, never in source control.

## Toolchain Checklist

Use the full Xcode app, not only Command Line Tools:

```bash
xcodebuild -version
xcrun xcode-select -p
```

Expected:

```text
/Applications/Xcode.app/Contents/Developer
```

If `xcode-select` points to `/Library/Developer/CommandLineTools`, switch it:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Install iOS and watchOS platform support from Xcode's first-run component screen or Xcode settings. macOS-only platform support is not enough for device builds.

If `pnpm` is missing in non-login shells, put Homebrew / local bin paths on `PATH`:

```bash
PATH=/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH pnpm -v
```

Do not blindly `source .env` in shell scripts. `.env` files often contain values that are valid dotenv syntax but not valid shell syntax. Prefer explicit environment variables, a dotenv loader, or documented exports.

## Xcode Project Generation

The sample project is generated from `examples/mobile-ios-minimal-app/project.yml`:

```bash
cd examples/mobile-ios-minimal-app
xcodegen generate
open OpenVitalsHealthKitDemo.xcodeproj
```

`OpenVitalsHealthKitDemo.xcodeproj`, generated `Info.plist` files, and DerivedData build products are generated artifacts. Keep `project.yml` as the source of truth.

The generated project includes default development bundle IDs so it can run from Xcode without inheriting shell environment variables:

- `OPENVITALS_IOS_BUNDLE_ID=ai.openvitals.healthkitdemo`
- `OPENVITALS_WATCH_BUNDLE_ID=ai.openvitals.healthkitdemo.watch`

For physical devices, use unique bundle IDs and a real Team ID. Personal Team is acceptable for local iPhone HealthKit development when the capability is provisioned and the developer profile is trusted on the phone. Use a personal namespace rather than an unrelated organization team:

```bash
xcodebuild -project OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsHealthKitDemo \
  -configuration Debug \
  -destination 'id=<IOS_DEVICE_ID>' \
  DEVELOPMENT_TEAM='<TEAM_ID>' \
  PRODUCT_BUNDLE_IDENTIFIER='com.example.openvitals.healthkitdemo' \
  CODE_SIGN_STYLE=Automatic \
  build
```

Or set those values in Xcode build settings before pressing Run. The generated project also has `OPENVITALS_APPLE_TEAM_ID` and `OPENVITALS_IOS_BUNDLE_ID` build settings, but the most reliable CLI override for physical-device signing is `DEVELOPMENT_TEAM=... PRODUCT_BUNDLE_IDENTIFIER=... CODE_SIGN_STYLE=Automatic`.

The optional watchOS app needs its own provisioning profile and a usable Watch destination. If Personal Team provisioning reports that it has no devices for the Watch profile, keep validating the iPhone HealthKit path with the iPhone scheme and return to the watchOS scheme after a paired Watch is available to Xcode.

## Device Detection

List devices:

```bash
xcrun devicectl list devices
xcrun xctrace list devices
```

Expected physical iPhone output looks like:

```text
Your iPhone (...) available iPhone...
```

If `devicectl` says:

```text
No devices found.
```

Check:

- iPhone is connected by USB or visible over trusted network debugging.
- iPhone is unlocked.
- The Mac is trusted from the iPhone prompt.
- Xcode is open at least once after installing platform support.
- Developer Mode is enabled.

## Developer Mode

If `xcodebuild` reports:

```text
Developer Mode disabled
To use <iPhone> for development, enable Developer Mode in Settings -> Privacy & Security.
```

Fix on the iPhone:

1. Open Settings.
2. Go to Privacy & Security.
3. Enable Developer Mode.
4. Restart when prompted.
5. Unlock the iPhone and confirm Developer Mode after reboot.

This step is intentionally user-controlled by iOS and cannot be automated from the Mac.

## Code Signing And Provisioning

Check local signing identities:

```bash
security find-identity -p codesigning -v
```

If it returns:

```text
0 valid identities found
```

Xcode cannot sign a physical-device build yet. Fixes:

- Open Xcode -> Settings -> Accounts and sign in with an Apple Developer account.
- Select a Team under the project / target Signing & Capabilities settings.
- Let Xcode manage signing automatically for the iOS and watchOS targets.
- Use unique bundle IDs for physical device testing.
- Confirm HealthKit capability is enabled for the app IDs / targets.

Simulator builds can pass with `CODE_SIGNING_ALLOWED=NO`; physical devices cannot.

## Trusting Personal Team Builds

If `devicectl` installs the app but launch fails with:

```text
Unable to launch ... because it has an invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user
```

Fix on the iPhone:

1. Open Settings.
2. Go to General.
3. Open VPN & Device Management.
4. Select the Apple Development profile for the account used by Xcode.
5. Tap Trust.
6. Keep the iPhone unlocked and connected, then launch again from Xcode or `devicectl`.

This is a user-controlled iOS security step and cannot be automated from the Mac.

## Device Locked During Launch

If `devicectl` launch fails with:

```text
Unable to launch ... because the device was not, or could not be, unlocked
SBMainWorkspace ... reason: Locked
```

the iPhone locked after the permission or Settings step. Unlock the iPhone, keep it on the home screen or OpenVitals foreground, and run the launch command again. The Mac cannot unlock the phone or bypass this guard.

For longer hardware QA runs, temporarily set Auto-Lock to a longer interval on the iPhone:

1. Settings -> Display & Brightness.
2. Auto-Lock.
3. Pick a longer interval for the test, then restore your normal setting afterwards.

## Prefilling The iPhone App For Hardware QA

The iPhone app reads launch environment overrides and persists them locally. This avoids typing long bearer tokens on the phone during development:

```bash
TOKEN="$(jq -r '.tokens[] | select(.label=="derived") | .token' /tmp/openvitals-apple-bootstrap.json)"
DEVICECTL_CHILD_OPENVITALS_IOS_BASE_URL='http://<Mac-LAN-IP>:3000' \
DEVICECTL_CHILD_OPENVITALS_IOS_USER_ID='user_live_apple_hw' \
DEVICECTL_CHILD_OPENVITALS_IOS_BEARER_TOKEN="$TOKEN" \
DEVICECTL_CHILD_OPENVITALS_IOS_LOOKBACK_DAYS='30' \
DEVICECTL_CHILD_OPENVITALS_IOS_AUTO_QA='1' \
xcrun devicectl device process launch \
  --device '<IOS_DEVICE_ID>' \
  --terminate-existing \
  com.example.openvitals.healthkitdemo
```

If the `DEVICECTL_CHILD_` launch environment does not appear to reach the app, use `devicectl`'s explicit JSON environment flag. Do not echo or commit the generated JSON because it includes the bearer token:

```bash
ENV_JSON="$(node - <<'NODE'
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("/tmp/openvitals-apple-bootstrap.json", "utf8"));
const token = p.tokens.find((row) => row.label === "full")?.token;
if (!token) process.exit(2);
process.stdout.write(JSON.stringify({
  OPENVITALS_IOS_BASE_URL: "http://<Mac-LAN-IP>:3000",
  OPENVITALS_IOS_USER_ID: "user_live_apple_hw",
  OPENVITALS_IOS_BEARER_TOKEN: token,
  OPENVITALS_IOS_LOOKBACK_DAYS: "30",
  OPENVITALS_IOS_MAX_RECORDS_PER_TYPE: "1",
  OPENVITALS_IOS_AUTO_QA: "1"
}));
NODE
)"
xcrun devicectl device process launch \
  --device '<IOS_DEVICE_ID>' \
  --terminate-existing \
  --environment-variables "$ENV_JSON" \
  com.example.openvitals.healthkitdemo
```

Supported environment names:

- `OPENVITALS_IOS_BASE_URL`
- `OPENVITALS_IOS_USER_ID`
- `OPENVITALS_IOS_BEARER_TOKEN`
- `OPENVITALS_IOS_SESSION_TOKEN`
- `OPENVITALS_IOS_LOOKBACK_DAYS`
- `OPENVITALS_IOS_MAX_RECORDS_PER_TYPE`
- `OPENVITALS_IOS_AUTO_QA`

The bearer/session tokens are stored in the app's local Keychain after launch. `OPENVITALS_IOS_AUTO_QA=1` triggers the hardware QA flow on launch: HealthKit authorization prompt, Apple Health session creation, and initial anchored sync after the user grants permission. Do not print tokens in logs or commit bootstrap JSON files.

`OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1` is a hardware-smoke helper. It uploads at most one record per HealthKit type and intentionally does not advance the local HealthKit anchor, so a later full sync can still upload the complete history. Leave it unset for normal sync and release acceptance.

## Finding The HealthKit Permission Page

The first time OpenVitals calls HealthKit, iOS should present a Health access sheet in front of the app. This is a user-controlled Apple privacy surface; the Mac cannot click it through `devicectl`.

On that sheet, enable every OpenVitals read category needed for QA:

- Heart Rate
- Heart Rate Variability / HRV SDNN
- Resting Heart Rate
- Steps
- Sleep
- Workouts

If the sheet was dismissed, the phone locked, or you need to check the settings later, use one of these paths on the iPhone:

1. Settings -> Health -> Data Access & Devices -> OpenVitals.
2. Health app -> profile picture -> Privacy -> Apps -> OpenVitals.
3. On some iOS versions: Settings -> Privacy & Security -> Health -> OpenVitals.

If OpenVitals is not listed yet, launch the app and tap **Request HealthKit Permission** once. iOS may not show a Health-compatible app in those lists until the app has requested HealthKit access at least once.

Also allow Local Network if iOS prompts for it. The hardware QA app reaches the Mac API over `http://<Mac-LAN-IP>:3000`, so denying Local Network can make the app look configured while all API calls fail.

If you need to check it after the prompt, open Settings -> Privacy & Security -> Local Network -> OpenVitals and enable it.

If the app prints or shows an error like this after HealthKit authorization:

```text
NSURLErrorDomain Code=-1001 "The request timed out."
NSErrorFailingURLStringKey=http://<Mac-LAN-IP>:3000/v1/users/.../ingest/apple-health
```

HealthKit returned and the app reached the ingest step, but iOS could not connect to the Mac API. Check:

1. iPhone Settings -> Privacy & Security -> Local Network -> OpenVitals is enabled.
2. The Mac API is bound to `HOST=0.0.0.0`, not `127.0.0.1`.
3. The iPhone and Mac are on the same network and no VPN/firewall is isolating LAN traffic.
4. Mac-side curl succeeds: `curl http://<Mac-LAN-IP>:3000/v1/openapi.json`.
5. iPhone Safari can open `http://<Mac-LAN-IP>:3000/v1/openapi.json`.

Mac-side diagnostics seen during QA:

```bash
xcrun devicectl device info processes --device <IOS_DEVICE_ID> \
  | rg "OpenVitals|HealthPrivacy"
```

If `HealthPrivacyService` is running, the iPhone is usually waiting on the Health permissions UI. If `/sync-status` remains `authState=not_connected` and `/timeline` remains empty, finish the HealthKit permission sheet, then tap **Initial Sync** or relaunch with `OPENVITALS_IOS_AUTO_QA=1`.

Apple documents that users can manage Health permissions under Settings -> Health -> Data Access & Devices, and that apps cannot conclusively tell whether read access was granted. An empty HealthKit query can mean either no permission or no matching data, so server-side `timelineCount=0` is not enough to distinguish those cases.

When launched with `--console`, the app emits hardware QA breadcrumbs with the `[OpenVitalsHardwareQA]` prefix. These logs intentionally confirm launch-env handling and failure stages without printing bearer or session tokens.

Healthy smoke output should show all major phases:

```text
[OpenVitalsHardwareQA] launch env applied: base URL
[OpenVitalsHardwareQA] launch env applied: bearer token
[OpenVitalsHardwareQA] HealthKit authorization returned
[OpenVitalsHardwareQA] connector session ready
[OpenVitalsHardwareQA] HealthKit heart_rate records: ...
[OpenVitalsHardwareQA] smoke upload capped at 1 record(s) per type; local anchor will not advance
[OpenVitalsHardwareQA] uploading chunk 1/1 with 5 record(s)
[OpenVitalsHardwareQA] hardware QA sync complete
```

## Known Xcode Packaging Failures

### Missing bundle ID

Error:

```text
Simulator device failed to install the application.
Missing bundle ID.
```

Cause: the generated Xcode project used shell-only bundle ID variables, but Xcode GUI did not inherit those environment variables.

Fix: keep default `OPENVITALS_IOS_BUNDLE_ID` and `OPENVITALS_WATCH_BUNDLE_ID` values in `project.yml`, or set them explicitly in Xcode build settings / `xcodebuild`.

### Watch companion bundle identifier missing

Error:

```text
The Watch app within this app must specify the key WKCompanionAppBundleIdentifier
```

Cause: embedded watchOS app did not declare the iPhone app bundle identifier.

Fix: `project.yml` must set this in the watchOS target Info.plist properties:

```yaml
WKCompanionAppBundleIdentifier: "$(OPENVITALS_IOS_BUNDLE_ID)"
```

After changing `project.yml`, rerun `xcodegen generate`.

## Running The iPhone Companion

In the iPhone app:

1. Set API base URL to `http://<Mac-LAN-IP>:3000`.
2. Set User ID to the bootstrap user, for example `user_live_apple_hw`.
3. Paste the returned bearer token.
4. Leave Session token empty unless you already created one.
5. Tap Save.
6. Tap Request HealthKit Permission.
7. Grant heart rate, HRV SDNN, resting heart rate, steps, sleep, and workouts.
8. Tap Connect Apple Health Session.
9. Tap Initial Sync.
10. Tap Refresh Sync Status.

Verify from the Mac:

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live_apple_hw/sync-status" | jq

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live_apple_hw&days=30" | jq
```

Expected timeline entries include real HealthKit samples with units, timestamps, source revision bundle IDs, device metadata, source record IDs, anchor state, and `captureMode=direct`.

Hardware-smoke evidence captured during this run:

```text
HealthKit query counts for 1-day lookback:
- heart_rate: 178
- hrv_sdnn: 2
- resting_heart_rate: 1
- steps: 31
- sleep_analysis: 9
- workouts: 0

Smoke upload:
- OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1
- Uploaded: 5 records
- sync_status apple-health: connected
- lastIngestRecordCount: 5
- lastAcceptedRecordCount: 5
- lastDroppedRecordCount: 0
- timeline metrics: heart_rate, hrv_sdnn, resting_heart_rate, steps, sleep
```

## Apple Watch Historical Data

The watchOS app is not required for historical Apple Watch data. Historical Watch samples flow like this:

```text
Apple Watch -> Apple Health on iPhone -> OpenVitals iPhone companion -> OpenVitals API
```

After the Watch has written heart rate, workouts, sleep, or other supported samples into Apple Health, tap Sync Now in the iPhone app and inspect `/v1/timeline`.

Historical Watch data should remain `sample` or `episode` with `latencyClass=delayed_sync` or `near_realtime`. It must not be labeled `live_signal`.

## Apple Watch Live Workout HR

The watchOS app is only for explicit live workout heart-rate capture. It should:

1. Use the same API base URL, user ID, bearer token, and session token as the iPhone app.
2. Request HealthKit / workout permission on the Watch.
3. Start `HKWorkoutSession` and `HKLiveWorkoutBuilder`.
4. Upload heart-rate records while the workout is active.
5. Stop cleanly when the user taps Stop.

Verify:

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live_apple_hw&days=1" \
  | jq '.[] | select(.metric=="live_workout_heart_rate")'
```

Expected records:

- `metric=live_workout_heart_rate`
- `dataGranularity=live_signal`
- `latencyClass=live`
- `captureMode=direct`
- tags include `connection_mode:device_pairing` and `source_product:apple_watch`

### Watch App Simulator / Generic Build Verification

When a physical Apple Watch is not visible to Xcode, still run the non-hardware checks from the repository root so packaging and target architecture failures are caught early:

```bash
xcrun devicectl list devices
xcrun xctrace list devices
xcodebuild -project examples/mobile-ios-minimal-app/OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsWatchDemo \
  -showdestinations
xcodebuild -project examples/mobile-ios-minimal-app/OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsWatchDemo \
  -configuration Debug \
  -destination 'id=<WATCH_SIMULATOR_ID>' \
  CODE_SIGNING_ALLOWED=NO build
xcrun simctl boot <WATCH_SIMULATOR_ID>
xcrun simctl install <WATCH_SIMULATOR_ID> \
  ~/Library/Developer/Xcode/DerivedData/OpenVitalsHealthKitDemo-*/Build/Products/Debug-watchsimulator/OpenVitalsWatchDemo.app
xcrun simctl launch <WATCH_SIMULATOR_ID> ai.openvitals.healthkitdemo.watch
xcrun simctl io <WATCH_SIMULATOR_ID> screenshot /tmp/openvitals-watch-sim.png
xcodebuild -project examples/mobile-ios-minimal-app/OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsWatchDemo \
  -configuration Debug \
  -destination 'generic/platform=watchOS' \
  CODE_SIGNING_ALLOWED=NO build
```

Healthy simulator evidence:

- `xcodebuild` succeeds for a watchOS Simulator destination.
- `xcrun simctl install` and `xcrun simctl launch` succeed.
- The screenshot shows the `OpenVitals` watch app with the optional live HR setup form.
- The app bundle declares `WKApplication=true`, `CFBundleIdentifier=ai.openvitals.healthkitdemo.watch`, and `WKCompanionAppBundleIdentifier=ai.openvitals.healthkitdemo`.
- `xcodebuild` also succeeds for `generic/platform=watchOS`, proving the target compiles for watchOS device architectures.

These checks do not prove HealthKit workout permission, real Apple Watch sensor samples, or live heart-rate upload. If `devicectl`, `xctrace`, and `xcodebuild -showdestinations` list only the iPhone and simulator placeholders, the physical Watch path remains blocked until a paired Apple Watch is unlocked, in Developer Mode, and visible to Xcode as a watchOS destination.

## Background Delivery

HealthKit background delivery is controlled by iOS. Treat it as scheduler-mediated background sync, not guaranteed live monitoring.

Test it this way:

1. Run Initial Sync.
2. Tap Enable HealthKit Background Delivery.
3. Generate or wait for a new HealthKit sample.
4. Put the app in the background.
5. Wait for iOS to schedule delivery.
6. If iOS does not schedule during the test window, use Sync Now to prove the same anchors support incremental upload.

A manual Sync Now proves anchor reuse and incremental ingestion. It does not prove OS-scheduled background delivery.

## Mirrored Oura / WHOOP Data

If Oura or WHOOP writes into Apple Health:

- The iPhone companion should upload those records as `captureMode=mirrored`.
- Preserve the original source app bundle ID, such as `com.ouraring.oura` or `com.whoop.mobile`.
- Direct Oura / WHOOP provider data should usually win over mirrored Apple Health copies for the same metric/window.
- `/v1/explain/...` should show the winning source, suppressed mirrored source, and reason.

Do not describe mirrored Oura / WHOOP Apple Health samples as direct Apple Watch data.

## Evidence To Save

For release acceptance, save timestamped evidence:

- `xcrun devicectl list devices` showing the physical iPhone available.
- Xcode build/run result or `xcodebuild` output for the iPhone target.
- Screenshot of HealthKit permission prompt or Settings -> Health -> Data Access & Devices.
- iPhone app status after Initial Sync.
- `/v1/users/:id/sync-status` response.
- `/v1/timeline` response with real HealthKit records.
- Watch app screenshot while live workout HR is streaming.
- `/v1/timeline` response with `live_workout_heart_rate` as `live_signal`.
- Dedupe/explain output if Oura or WHOOP mirrored Apple Health records are present.

Keep hardware rows in `docs/hardware-test-plan.md` as `pending-hardware` until this evidence exists.
