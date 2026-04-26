# Android Health Connect Reference Flow

This reference shows the intended Android collector lifecycle for Health Connect data.

## Flow

1. Create session token via `POST /v1/users/:id/connect/health-connect/session`.
2. Read Health Connect records (sleep, HRV, resting heart rate, steps).
3. Map records into `IngestRecord` entries. If `captureMode=mirrored`, include `packageName`.
4. Enqueue batches through `createAndroidCollectorClient(...).enqueue(...)`.
5. Automatic retry/backoff handles transient failures.
6. Anchor conflicts retry with server anchor fetched from `/v1/users/:id/sync-status`.

## Minimal JS-style pseudo code

```ts
const collector = createAndroidCollectorClient({ apiBaseUrl: "http://127.0.0.1:3000" });
const session = await collector.createSession("user_live");
await collector.enqueue({
  userId: "user_live",
  sessionToken: session.sessionToken,
  idempotencyKey: `hc-${Date.now()}`,
  anchorBefore,
  anchorAfter,
  records
});
await collector.checkpointAnchor("user_live");
```
