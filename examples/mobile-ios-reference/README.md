# iOS HealthKit Reference Flow

This reference shows the intended v0.6 iOS collector lifecycle for Apple Health and Apple Watch data. Apple Health is always a device-side ingest path; the server never polls a user's HealthKit store directly.

## Flow

1. Create session token via `POST /v1/users/:id/connect/apple-health/session`.
2. Request HealthKit read permissions for:
   - heart rate
   - HRV SDNN
   - resting heart rate
   - step count
   - sleep analysis
   - workouts
3. Run `HKAnchoredObjectQuery` for each sample type and persist one anchor per query stream.
4. Map samples into `IngestRecord` entries with source provenance:
   - `HKSourceRevision.bundleIdentifier`
   - HealthKit source name/version/product type
   - device model/local identifier when available
   - timezone
   - stable source record ID from the HealthKit UUID and source bundle
5. If `captureMode=mirrored`, include `bundleId`. Oura and WHOOP records mirrored through Apple Health must remain mirrored and should not be counted as direct Apple Watch samples.
6. Send `POST /v1/users/:id/ingest/apple-health` with `idempotencyKey`, `anchorBefore`, `anchorAfter`, `collectorMeta`, and records.
7. If anchor mismatch occurs, read `/v1/users/:id/sync-status`, retry with latest server anchor, then continue from the new local anchor.
8. Trigger `/v1/users/:id/sync` for workflow/materialized refresh.

## Minimal Swift flow

See `../mobile-ios-minimal-app/OpenVitalsCollector.swift` for the concrete implementation.

```swift
try await collector.requestAuthorization()
let session = try await collector.createAppleSession(userId: "user_live")
let result = try await collector.collectAndUploadAnchoredBatch(
    userId: "user_live",
    sessionToken: session.sessionToken,
    anchorStore: UserDefaultsAnchorStore(),
    lookbackDays: 30
)
print(result.uploadedRecordCount)
```

## Apple Watch live heart rate

Apple Watch live heart rate is only live while a workout collector is active. Use `HKWorkoutSession` + `HKLiveWorkoutBuilder` from a watchOS target and upload records with:

- metric: `live_workout_heart_rate`
- `dataGranularity`: `live_signal`
- `latencyClass`: `live`
- `connectionMode`: `device_pairing`
- `captureMode`: `direct`

Historical HealthKit heart-rate samples, including samples synced from Apple Watch after the fact, are HealthKit samples with delayed device sync semantics, not continuous real-time monitoring.

## Agent-safe data semantics

| Data path | Granularity | Latency | Capture mode |
| --- | --- | --- | --- |
| HealthKit heart rate / HRV / resting HR / steps | `sample` | `delayed_sync` | `direct` or `mirrored` |
| HealthKit sleep / workouts | `episode` | `delayed_sync` | `direct` or `mirrored` |
| Apple Watch workout builder HR | `live_signal` | `live` | `direct` |
| Oura/WHOOP records mirrored into Apple Health | `sample`/`episode` | `delayed_sync` | `mirrored` |

Do not call Oura or WHOOP cloud data continuous raw streams. If those providers are present through Apple Health, label them mirrored and let direct provider connectors win in dedupe.

## JS-style pseudo code

```ts
const session = await client.createSession("user_live");
await client.ingestWithAnchorRecovery({
  userId: "user_live",
  sessionToken: session.sessionToken,
  idempotencyKey: `apple-${Date.now()}`,
  anchorBefore,
  anchorAfter,
  records
});
await client.checkpointAnchor("user_live");
```
