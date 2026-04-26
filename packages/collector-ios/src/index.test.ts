import {
  APPLE_HEALTH_DATA_SEMANTICS,
  APPLE_HEALTH_IOS_METRIC_CAPABILITIES,
  APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC,
  buildAppleHealthIngestRecord,
  buildAppleHealthRecordTags,
  classifyAppleHealthCaptureMode,
  createIosCollectorClient,
  describeAppleHealthCollectorError,
  hashAppleHealthRawPayload,
  validateAppleHealthIngestRecords
} from "./index.js";

describe("collector-ios", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("recovers from anchor conflicts by retrying with server anchor", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });

      if (url.includes("/ingest/") && calls.filter((call) => call.url.includes("/ingest/")).length === 1) {
        return new Response(JSON.stringify({ message: "Anchor mismatch for apple-health: expected anchor-server, received anchor-client." }), {
          status: 409
        });
      }
      if (url.includes("/sync-status")) {
        return new Response(
          JSON.stringify({
            userId: "user_ada",
            sources: [
              {
                providerId: "apple-health",
                status: "connected",
                authState: "connected",
                lastSyncAt: "2026-03-20T08:00:00.000Z",
                lastSuccessfulSyncAt: "2026-03-20T08:00:00.000Z",
                syncFreshnessHours: 1,
                stalenessReason: null,
                lastAnchor: "anchor-server",
                lastError: null,
                pendingIngestBatches: 0,
                dataQualityGate: "ok",
                dataMode: "live",
                connectionMethod: "sdk-ingest",
                credentialExpiresAt: null,
                lastCredentialError: null,
                lastIngestBatchId: "batch_latest",
                queueDepth: 0,
                backoffUntil: null
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createIosCollectorClient({ apiBaseUrl: "http://127.0.0.1:3000" });
    await client.ingestWithAnchorRecovery({
      userId: "user_ada",
      sessionToken: "session_1",
      idempotencyKey: "batch_1",
      anchorBefore: "anchor-client",
      records: [
        {
          id: "rec_1",
          sourceRecordId: "apple-steps-1",
          metricFamily: "activity",
          kind: "observation",
          metric: "steps",
          value: 1200,
          unit: "count",
          startAt: "2026-03-19T00:00:00.000Z",
          endAt: "2026-03-19T23:59:59.000Z",
          timezone: "Asia/Shanghai",
          captureMode: "direct",
          sourceApp: "com.apple.Health",
          confidence: 0.9,
          tags: []
        }
      ]
    });

    const ingestCalls = calls.filter((call) => call.url.includes("/ingest/"));
    expect(ingestCalls).toHaveLength(2);

    const retryPayloadRaw = ingestCalls[1]?.init?.body;
    const retryPayload = typeof retryPayloadRaw === "string" ? JSON.parse(retryPayloadRaw) : {};
    expect(retryPayload.anchorBefore).toBe("anchor-server");
  });

  it("rejects mirrored records without bundleId before network call", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createIosCollectorClient({ apiBaseUrl: "http://127.0.0.1:3000" });
    await expect(
      client.ingestWithAnchorRecovery({
        userId: "user_ada",
        sessionToken: "session_1",
        idempotencyKey: "batch_1",
        records: [
          {
            id: "rec_mirror_1",
            sourceRecordId: "mirror:whoop-steps-1",
            metricFamily: "activity",
            kind: "observation",
            metric: "steps",
            value: 1200,
            unit: "count",
            startAt: "2026-03-19T00:00:00.000Z",
            endAt: "2026-03-19T23:59:59.000Z",
            timezone: "Asia/Shanghai",
            captureMode: "mirrored",
            sourceApp: "com.whoop.mobile",
            confidence: 0.8,
            tags: []
          }
        ]
      })
    ).rejects.toThrow("bundleId");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("documents HealthKit and Apple Watch data semantics for agent-safe ingest", () => {
    expect(classifyAppleHealthCaptureMode({ bundleId: "com.whoop.mobile" })).toBe("mirrored");
    expect(classifyAppleHealthCaptureMode({ bundleId: "com.ouraring.oura" })).toBe("mirrored");
    expect(classifyAppleHealthCaptureMode({ bundleId: "com.apple.Health" })).toBe("direct");
    expect(APPLE_HEALTH_DATA_SEMANTICS.iPhoneHistorical.liveSignal).toBe(false);

    const liveWorkoutHeartRate = APPLE_HEALTH_IOS_METRIC_CAPABILITIES.find(
      (capability) => capability.metric === APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC
    );
    expect(liveWorkoutHeartRate).toMatchObject({
      dataGranularity: "live_signal",
      latencyClass: "live",
      connectionMode: "device_pairing",
      mirrored: false
    });

    const tags = buildAppleHealthRecordTags({
      dataGranularity: "live_signal",
      latencyClass: "live",
      connectionMode: "device_pairing",
      source: {
        bundleId: "com.apple.Health",
        productType: "Watch6,2",
        deviceModel: "Apple Watch"
      }
    });
    expect(tags).toEqual(
      expect.arrayContaining([
        "data_granularity:live_signal",
        "latency_class:live",
        "connection_mode:device_pairing",
        "source_bundle:com.apple.Health",
        "source_product:Watch6,2",
        "device_model:Apple Watch"
      ])
    );
  });

  it("builds normalized records with raw payload hashes, provenance tags, and stable dedupe ids", () => {
    const rawPayload = {
      uuid: "HKQuantitySample-steps-1",
      sourceRevision: { bundleIdentifier: "com.whoop.mobile", productType: "iPhone15,3" },
      value: 1200
    };
    const record = buildAppleHealthIngestRecord({
      metricFamily: "activity",
      kind: "observation",
      metric: "steps",
      value: 1200,
      unit: "count",
      startAt: "2026-03-19T00:00:00.000Z",
      endAt: "2026-03-19T23:59:59.000Z",
      timezone: "Asia/Shanghai",
      rawPayload,
      source: {
        bundleId: "com.whoop.mobile",
        sourceName: "WHOOP",
        productType: "iPhone15,3",
        sourceVersion: "4.0.0"
      }
    });

    expect(record).toMatchObject({
      sourceRecordId: "healthkit:steps:HKQuantitySample-steps-1",
      dataGranularity: "sample",
      latencyClass: "delayed_sync",
      captureMode: "mirrored",
      bundleId: "com.whoop.mobile",
      sourceApp: "WHOOP"
    });
    expect(record.tags).toEqual(
      expect.arrayContaining([
        `raw_payload_hash:${hashAppleHealthRawPayload(rawPayload)}`,
        "raw_payload_preserved:provider_raw_event",
        "dedupe_source_record_id:healthkit:steps:HKQuantitySample-steps-1",
        "source_version:4.0.0"
      ])
    );
  });

  it("keeps historical Apple Watch samples out of live_signal unless explicit live workout mode is used", () => {
    const historicalWatchHeartRate = buildAppleHealthIngestRecord({
      metricFamily: "cardiovascular",
      kind: "observation",
      metric: "heart_rate",
      value: 72,
      unit: "count/min",
      startAt: "2026-03-19T08:00:00.000Z",
      endAt: "2026-03-19T08:00:05.000Z",
      timezone: "Asia/Shanghai",
      rawPayload: { uuid: "watch-historical-hr-1" },
      source: {
        bundleId: "com.apple.Health",
        sourceName: "Apple Watch",
        productType: "Watch6,2",
        deviceModel: "Apple Watch"
      }
    });
    expect(historicalWatchHeartRate.dataGranularity).toBe("sample");
    expect(historicalWatchHeartRate.latencyClass).toBe("delayed_sync");

    const liveWorkoutHeartRate = buildAppleHealthIngestRecord({
      metricFamily: "cardiovascular",
      kind: "observation",
      metric: APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC,
      value: 144,
      unit: "count/min",
      startAt: "2026-03-19T08:00:00.000Z",
      endAt: "2026-03-19T08:00:01.000Z",
      timezone: "Asia/Shanghai",
      rawPayload: { uuid: "live-workout-hr-1" },
      dataGranularity: "live_signal",
      latencyClass: "live",
      connectionMode: "device_pairing",
      source: {
        bundleId: "com.apple.Health",
        sourceName: "Apple Watch",
        productType: "Watch6,2",
        deviceModel: "Apple Watch"
      }
    });
    expect(liveWorkoutHeartRate).toMatchObject({
      dataGranularity: "live_signal",
      latencyClass: "live",
      captureMode: "direct"
    });

    expect(() =>
      validateAppleHealthIngestRecords([
        {
          ...historicalWatchHeartRate,
          dataGranularity: "live_signal",
          latencyClass: "live"
        }
      ])
    ).toThrow("live_workout_heart_rate");
  });

  it("maps stale/expired credential failures into companion-app actions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/sync-status")) {
        return new Response(
          JSON.stringify({
            userId: "user_ada",
            sources: [
              {
                providerId: "apple-health",
                authState: "expired",
                credentialExpiresAt: "2026-03-19T07:59:59.000Z",
                lastCredentialError: "mobile session expired",
                lastAnchor: "anchor-stale"
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ message: "Forbidden: HealthKit permission missing" }), { status: 403 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createIosCollectorClient({ apiBaseUrl: "http://127.0.0.1:3000" });
    const status = await client.appleHealthSyncStatus("user_ada");
    expect(status.appleHealth).toMatchObject({
      credentialExpired: true,
      requiresReconnect: true,
      lastAnchor: "anchor-stale"
    });

    await expect(
      client.ingestWithAnchorRecovery({
        userId: "user_ada",
        sessionToken: "session_1",
        idempotencyKey: "batch_1",
        records: [
          {
            id: "rec_1",
            sourceRecordId: "apple-steps-1",
            metricFamily: "activity",
            kind: "observation",
            metric: "steps",
            value: 1200,
            unit: "count",
            startAt: "2026-03-19T00:00:00.000Z",
            endAt: "2026-03-19T23:59:59.000Z",
            timezone: "Asia/Shanghai",
            captureMode: "direct",
            sourceApp: "com.apple.Health",
            confidence: 0.9,
            tags: []
          }
        ]
      })
    ).rejects.toMatchObject({ code: "AUTH_ERROR" });

    try {
      await client.ingestWithAnchorRecovery({
        userId: "user_ada",
        sessionToken: "session_1",
        idempotencyKey: "batch_2",
        records: [
          {
            id: "rec_2",
            sourceRecordId: "apple-steps-2",
            metricFamily: "activity",
            kind: "observation",
            metric: "steps",
            value: 500,
            unit: "count",
            startAt: "2026-03-20T00:00:00.000Z",
            endAt: "2026-03-20T23:59:59.000Z",
            timezone: "Asia/Shanghai",
            captureMode: "direct",
            sourceApp: "com.apple.Health",
            confidence: 0.9,
            tags: []
          }
        ]
      });
    } catch (error) {
      expect(describeAppleHealthCollectorError(error)).toMatchObject({
        action: "permission_repair",
        retryable: false
      });
    }
  });
});
