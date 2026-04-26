import {
  buildDemoState,
  buildLiveState,
  createConnectorSession,
  explainEntity,
  getSyncStatus,
  ingestMobileBatch,
  normalizeIngestRecordsAsPayload,
  runIncrementalSync,
  runIncrementalSyncWithPayloads,
  setSourcePrecedence,
  setSourceFilter
} from "./index.js";

describe("runtime", () => {
  it("builds a coherent demo state", () => {
    const state = buildDemoState(new Date("2026-03-19T08:00:00.000Z"));

    expect(state.sourceAccounts).toHaveLength(6);
    expect(state.alerts.some((alert) => alert.workflowKind === "sync_stale_alert")).toBe(true);
    expect(state.outbox.some((event) => event.type === "health.brief.daily.ready")).toBe(true);
    expect(state.scores.map((score) => score.scoreKind)).toEqual(
      expect.arrayContaining(["sleep_consistency", "recovery_readiness", "strain_balance", "circadian_disruption"])
    );
  });

  it("dedupes mirrored WHOOP sleep against Apple Health", () => {
    const state = buildDemoState(new Date("2026-03-19T08:00:00.000Z"));
    const recentSleep = state.episodes.filter((episode) => episode.episodeType === "sleep").slice(-1)[0];

    expect(recentSleep.source).toBe("whoop");
    expect(recentSleep.suppressedSources).toContain("apple-health");
  });

  it("explains score provenance", () => {
    const state = buildDemoState(new Date("2026-03-19T08:00:00.000Z"));
    const explanation = explainEntity(state, "score", "score_recovery_readiness");

    expect(explanation?.payload).toBeDefined();
    expect(explanation?.whyPrimary).toContain("Derived");
    expect(explanation?.precedenceVersion).toBeDefined();
  });

  it("keeps ingest idempotent by idempotency key", () => {
    const now = new Date("2026-03-19T08:00:00.000Z");
    const seeded = buildDemoState(now);
    const session = createConnectorSession(seeded, "user_ada", "apple-health", now);

    const payload = {
      sessionToken: session.response.sessionToken,
      idempotencyKey: "batch-ios-1",
      anchorBefore: "anchor-1",
      anchorAfter: "anchor-2",
      records: [
        {
          id: "rec_1",
          sourceRecordId: "apple-step-1",
          kind: "observation" as const,
          metricFamily: "activity" as const,
          metric: "steps",
          value: 1200,
          unit: "count",
          startAt: "2026-03-18T00:00:00.000Z",
          endAt: "2026-03-18T23:59:59.000Z",
          timezone: "Asia/Shanghai",
          captureMode: "direct" as const,
          sourceApp: "com.apple.Health",
          confidence: 0.9,
          tags: []
        }
      ]
    };

    const first = ingestMobileBatch(session.state, "user_ada", "apple-health", payload, now);
    const second = ingestMobileBatch(first.state, "user_ada", "apple-health", payload, now);

    expect(first.result.idempotent).toBe(false);
    expect(second.result.idempotent).toBe(true);
    expect(second.state.ingestBatches).toHaveLength(1);
    const pendingStatus = getSyncStatus(session.state, "user_ada", now).sources.find((source) => source.providerId === "apple-health");
    expect(pendingStatus?.activeSessionExpiresAt).toBe(session.response.expiresAt);
    expect(pendingStatus?.queueDepth).toBe(1);

    const syncedStatus = getSyncStatus(first.state, "user_ada", now).sources.find((source) => source.providerId === "apple-health");
    expect(syncedStatus?.lastIngestBatchId).toBe(first.result.batchId);
    expect(syncedStatus?.lastIngestRecordCount).toBe(1);
    expect(syncedStatus?.lastAcceptedRecordCount).toBe(1);
    expect(syncedStatus?.lastDroppedRecordCount).toBe(0);
    expect(syncedStatus?.activeSessionExpiresAt).toBeNull();
  });

  it("restricts Apple Health live_signal records to active Apple Watch workout heart rate", () => {
    const now = new Date("2026-03-19T08:00:00.000Z");
    const seeded = buildDemoState(now);
    const session = createConnectorSession(seeded, "user_ada", "apple-health", now);

    expect(() =>
      ingestMobileBatch(
        session.state,
        "user_ada",
        "apple-health",
        {
          sessionToken: session.response.sessionToken,
          idempotencyKey: "batch-invalid-live",
          records: [
            {
              id: "rec_invalid_live",
              sourceRecordId: "healthkit:steps:live-1",
              kind: "observation",
              metricFamily: "activity",
              metric: "steps",
              dataGranularity: "live_signal",
              latencyClass: "live",
              value: 1200,
              unit: "count",
              startAt: "2026-03-19T07:59:00.000Z",
              endAt: "2026-03-19T08:00:00.000Z",
              timezone: "Asia/Shanghai",
              captureMode: "direct",
              sourceApp: "com.apple.Health",
              confidence: 0.9,
              tags: []
            }
          ]
        },
        now
      )
    ).toThrow("Apple Health live_signal/live records");

    const valid = ingestMobileBatch(
      session.state,
      "user_ada",
      "apple-health",
      {
        sessionToken: session.response.sessionToken,
        idempotencyKey: "batch-valid-live",
        collectorMeta: {
          sdk: "OpenVitalsWatch",
          sdkVersion: "1.0.0",
          appBuild: "100",
          deviceModel: "Apple Watch Ultra"
        },
        records: [
          {
            id: "rec_valid_live",
            sourceRecordId: "HKLiveWorkoutBuilder:heart-rate:1",
            kind: "observation",
            metricFamily: "cardiovascular",
            metric: "live_workout_heart_rate",
            dataGranularity: "live_signal",
            latencyClass: "live",
            value: 142,
            unit: "count/min",
            startAt: "2026-03-19T07:59:00.000Z",
            endAt: "2026-03-19T08:00:00.000Z",
            timezone: "Asia/Shanghai",
            captureMode: "direct",
            sourceApp: "OpenVitals Watch",
            confidence: 0.95,
            tags: ["live_workout", "HKWorkoutSession"]
          }
        ]
      },
      now
    );

    const liveObservation = valid.state.observations.find((observation) => observation.sourceRecordId === "HKLiveWorkoutBuilder:heart-rate:1");
    expect(liveObservation?.dataGranularity).toBe("live_signal");
    expect(liveObservation?.latencyClass).toBe("live");
  });

  it("applies source filter for mirrored records", () => {
    const now = new Date("2026-03-19T08:00:00.000Z");
    const seeded = buildDemoState(now);
    const filtered = setSourceFilter(seeded, "user_ada", "apple-health", { ignoredSources: ["com.whoop.mobile"] }, now);
    const session = createConnectorSession(filtered.state, "user_ada", "apple-health", now);

    const ingest = ingestMobileBatch(
      session.state,
      "user_ada",
      "apple-health",
      {
        sessionToken: session.response.sessionToken,
        idempotencyKey: "batch-ios-filtered",
        records: [
          {
            id: "rec_mirror_1",
            sourceRecordId: "mirror:whoop-step-1",
            kind: "observation",
            metricFamily: "activity",
            metric: "steps",
            value: 2000,
            unit: "count",
            startAt: "2026-03-18T00:00:00.000Z",
            endAt: "2026-03-18T23:59:59.000Z",
            timezone: "Asia/Shanghai",
            captureMode: "mirrored",
            sourceApp: "com.whoop.mobile",
            bundleId: "com.whoop.mobile",
            confidence: 0.8,
            tags: []
          }
        ]
      },
      now
    );

    expect(ingest.result.processedRecords).toBe(0);
    expect(ingest.result.acceptedRecords).toBe(0);
    expect(ingest.result.droppedRecords).toBe(1);
    expect(ingest.result.dropReasons).toEqual([{ reason: "ignored_source_filter", count: 1 }]);
  });

  it("blocks coaching recommendations when stale sources exist after sync runs", () => {
    const now = new Date("2026-03-19T08:00:00.000Z");
    const seeded = buildDemoState(now);
    const synced = runIncrementalSync(seeded, "user_ada", "apple-health", new Date("2026-03-19T10:00:00.000Z"));

    expect(synced.staleGateApplied).toBe(true);
    expect(synced.state.recommendations).toHaveLength(0);
  });

  it("records source-filter ignored records in dedupe decisions", () => {
    const now = new Date("2026-03-19T08:00:00.000Z");
    const seeded = buildDemoState(now);
    const filtered = setSourceFilter(seeded, "user_ada", "apple-health", { ignoredSources: ["com.whoop.mobile"] }, now);
    const session = createConnectorSession(filtered.state, "user_ada", "apple-health", now);

    const ingest = ingestMobileBatch(
      session.state,
      "user_ada",
      "apple-health",
      {
        sessionToken: session.response.sessionToken,
        idempotencyKey: "batch-ios-filtered-2",
        anchorBefore: "anchor-start",
        anchorAfter: "anchor-next",
        records: [
          {
            id: "rec_mirror_2",
            sourceRecordId: "mirror:whoop-step-2",
            kind: "observation",
            metricFamily: "activity",
            metric: "steps",
            value: 2200,
            unit: "count",
            startAt: "2026-03-18T00:00:00.000Z",
            endAt: "2026-03-18T23:59:59.000Z",
            timezone: "Asia/Shanghai",
            captureMode: "mirrored",
            sourceApp: "com.whoop.mobile",
            bundleId: "com.whoop.mobile",
            confidence: 0.8,
            tags: []
          }
        ]
      },
      now
    );

    expect(ingest.state.dedupeDecisions.some((decision) => decision.ignoredBySourceFilter)).toBe(true);
  });

  it("supports per-user capture mode precedence overrides", () => {
    const now = new Date("2026-03-19T08:00:00.000Z");
    const seeded = buildDemoState(now);
    const overridden = setSourcePrecedence(
      seeded,
      "user_ada",
      {
        precedence: {
          direct: 2,
          mirrored: 7,
          imported: 1,
          manual: 0
        }
      },
      now
    );
    const latestSleep = overridden.state.episodes.filter((episode) => episode.episodeType === "sleep").slice(-1)[0];
    expect(latestSleep).toBeDefined();
    expect(latestSleep?.source).toBe("apple-health");
  });

  it("applies live collector payloads during sync runs", () => {
    const now = new Date("2026-03-19T08:00:00.000Z");
    const liveState = buildLiveState({
      userId: "user_live",
      name: "Live User",
      timezone: "Asia/Shanghai",
      now
    });
    const sourceAccount = liveState.sourceAccounts.find((account) => account.providerId === "apple-health");
    const device = liveState.devices.find((candidate) => candidate.providerId === "apple-health");
    expect(sourceAccount).toBeDefined();
    expect(device).toBeDefined();
    if (!sourceAccount || !device) {
      return;
    }

    const payload = normalizeIngestRecordsAsPayload({
      user: liveState.user,
      providerId: "apple-health",
      sourceAccount,
      device,
      records: [
        {
          id: "live-rec-1",
          sourceRecordId: "healthkit:steps:live-1",
          metricFamily: "activity",
          kind: "observation",
          metric: "steps",
          value: 5000,
          unit: "count",
          startAt: "2026-03-18T00:00:00.000Z",
          endAt: "2026-03-18T23:59:59.000Z",
          timezone: "Asia/Shanghai",
          captureMode: "direct",
          sourceApp: "com.apple.Health",
          confidence: 0.9,
          tags: []
        }
      ],
      now
    });

    const synced = runIncrementalSyncWithPayloads(
      liveState,
      "user_live",
      {
        "apple-health": payload
      },
      new Date("2026-03-19T10:00:00.000Z")
    );
    expect(synced.syncedProviderIds).toEqual(["apple-health"]);
    expect(synced.state.observations.some((observation) => observation.sourceRecordId === "healthkit:steps:live-1")).toBe(true);
  });
});
