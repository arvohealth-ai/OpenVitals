# iOS Companion Guide (Apple Health + Optional Apple Watch)

The OpenVitals iOS companion is the required Apple Health connector. Install and configure the iPhone app for normal Apple Health sync. The Apple Watch app is an optional add-on used only when a user wants live workout heart-rate capture from an active workout session.

## Product rules

- **iPhone app required:** profile/token setup, API endpoint setup, HealthKit authorization, historical sync, incremental sync, sync status, stale-data warnings, and manual **Sync Now** live in the iPhone app.
- **Apple Watch app optional:** install it only for explicit live workout heart-rate capture using `HKWorkoutSession` and `HKLiveWorkoutBuilder`.
- **Historical Watch data flows through iPhone HealthKit:** Apple Watch samples written into Apple Health are uploaded by the iPhone app as HealthKit samples after platform sync.
- **No Mac tether for users:** a Mac/Xcode connection is only for development, installation, and hardware QA. End users should not need a physical Mac connection during normal runtime.

## iPhone companion UX

The iPhone app should stay practical and tool-like:

1. **Profile and API setup**
   - Enter/select the OpenVitals user/profile.
   - Enter the API base URL, such as `http://<Mac-LAN-IP>:3000` for local hardware testing or a production API URL.
   - Store the user token locally; never hardcode secrets into the app or repository.
2. **HealthKit onboarding**
   - Explain requested read permissions: heart rate, HRV SDNN, resting heart rate, steps, sleep, and workouts.
   - Show missing/partial permission states and a clear retry path.
3. **Initial sync**
   - Create an Apple Health session with `/v1/users/:id/connect/apple-health/session`.
   - Run an anchored initial upload and show processed, uploaded, dropped mirrored, and failed counts.
4. **Ongoing sync**
   - Reuse the same anchor store for foreground refresh, background/observer-triggered delivery, and manual **Sync Now**.
   - Display last sync time, last anchor, pending ingest batches, latest error, and stale-data state from `/v1/users/:id/sync-status`.
5. **Mirrored-source explanation**
   - Tell users that Oura/WHOOP samples mirrored into Apple Health may be retained for auditability but suppressed from normalized views when direct provider data wins.

## Optional watchOS live workout UX

The watchOS app should not block iPhone-only Apple Health sync. Its UI only needs to support live workout HR:

1. Show whether the paired iPhone app has API/profile/session configuration.
2. Request HealthKit/workout permission when needed.
3. Provide **Start Live Workout HR** and **Stop** actions.
4. Show upload status, last heart-rate timestamp, and any connection or permission error.
5. Mark only active workout-session heart-rate records as `dataGranularity=live_signal`, `latencyClass=live`, `connectionMode=device_pairing`, and `captureMode=direct`.

## Background and stale-data semantics

HealthKit background delivery is scheduler-mediated by iOS. OpenVitals docs and UI should call this **background sync** or **near-realtime when iOS schedules delivery**, not guaranteed live monitoring.

Use these labels consistently:

| Situation | `dataGranularity` | `latencyClass` | User/agent wording |
| --- | --- | --- | --- |
| iPhone HealthKit historical or incremental upload | `sample` or `episode` | `delayed_sync` or `near_realtime` | Apple Health samples uploaded by the iPhone app; may be delayed by HealthKit/iOS scheduling. |
| Apple Watch historical samples visible in HealthKit | `sample` or `episode` | `delayed_sync` or `near_realtime` | Watch data synced into Apple Health, then uploaded by the iPhone app. |
| Apple Watch active workout heart rate | `live_signal` | `live` | Live only while the watch workout collector session is active and fresh. |
| Oura/WHOOP samples mirrored through Apple Health | `sample` or `episode` | `delayed_sync` or `near_realtime` | Mirrored platform samples, not direct cloud live streams. |

## Local hardware setup checklist

See [iOS Hardware QA Runbook](./ios-hardware-runbook.md) for the full troubleshooting matrix covering Xcode platform support, `pnpm` path issues, device detection, Developer Mode, signing identities, bundle IDs, Watch companion packaging, local API networking, and evidence capture.

1. Start the API on the LAN, not loopback-only:
   ```bash
   HOST=0.0.0.0 PORT=3000 OPENVITALS_MODE=live pnpm --filter @openvitals/api demo
   ```
2. Bootstrap a live profile and save the returned token.
3. Generate the Xcode project in `examples/mobile-ios-minimal-app` with XcodeGen.
4. Configure bundle IDs and an Apple Developer Team ID for HealthKit entitlements.
5. Run the iPhone app on a physical iPhone, enter `http://<Mac-LAN-IP>:3000`, grant HealthKit permissions, and run initial sync.
6. Install/run the watchOS target only when validating live workout HR.
7. Record timestamped logs, screenshots, or API/MCP output for hardware evidence; otherwise keep hardware status `pending-hardware`.
