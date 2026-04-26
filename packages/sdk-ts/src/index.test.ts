import { OpenVitalsClient, summarizeSyncStatusSemantics, type SyncStatusResponse } from "./index.js";

describe("sdk-ts", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("supports v0.2 mobile sync surfaces", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/connect/")) {
        return new Response(
          JSON.stringify({
            userId: "user_ada",
            providerId: "apple-health",
            sessionToken: "session_1",
            expiresAt: "2026-03-19T10:00:00.000Z"
          }),
          { status: 200 }
        );
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
                lastSyncAt: "2026-03-19T08:00:00.000Z",
                lastSuccessfulSyncAt: "2026-03-19T08:00:00.000Z",
                syncFreshnessHours: 1,
                stalenessReason: null,
                lastAnchor: null,
                lastError: null,
                pendingIngestBatches: 0,
                dataQualityGate: "ok",
                queueDepth: 0,
                dataMode: "live",
                connectionMethod: "sdk-ingest",
                connectionMode: "mobile_permission",
                metricCapabilities: [
                  {
                    metricName: "heart_rate",
                    source: "apple-health",
                    dataGranularity: "sample",
                    latencyClass: "delayed_sync",
                    direct: true,
                    mirrored: true
                  },
                  {
                    metricName: "live_workout_heart_rate",
                    source: "apple-health",
                    dataGranularity: "live_signal",
                    latencyClass: "live",
                    direct: true,
                    mirrored: false
                  }
                ],
                credentialExpiresAt: null,
                lastCredentialError: null,
                lastIngestBatchId: "batch_latest",
                backoffUntil: null
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/source-filters")) {
        return new Response(
          JSON.stringify({
            id: "source_filter_apple-health",
            userId: "user_ada",
            providerId: "apple-health",
            ignoredSources: ["com.whoop.mobile"],
            updatedAt: "2026-03-19T08:00:00.000Z"
          }),
          { status: 200 }
        );
      }
      if (url.includes("/source-precedence")) {
        return new Response(
          JSON.stringify({
            id: "source_precedence_user_ada",
            userId: "user_ada",
            precedence: {
              direct: 5,
              mirrored: 4,
              imported: 2,
              manual: 1
            },
            updatedAt: "2026-03-19T08:00:00.000Z"
          }),
          { status: 200 }
        );
      }
      if (url.includes("/providers/whoop/webhook")) {
        return new Response(
          JSON.stringify({
            received: true,
            providerId: "whoop",
            userId: "user_ada"
          }),
          { status: 200 }
        );
      }
      if (url.includes("/explain/score")) {
        return new Response(
          JSON.stringify({
            entity: "score",
            id: "score_recovery_1",
            whyPrimary: "Recovery score uses freshest direct source after dedupe.",
            suppressedSources: ["whoop"],
            lastSyncAt: "2026-03-19T08:00:00.000Z",
            lastSuccessfulSyncAt: "2026-03-19T08:00:00.000Z",
            provenanceChain: [
              {
                providerId: "apple-health",
                sourceRecordId: "apple-steps-1",
                captureMode: "direct",
                role: "primary"
              }
            ],
            dedupeFingerprint: "fp_1",
            precedenceVersion: "v1",
            dedupePolicy: { name: "capture_mode_precedence", version: "v1" },
            ignoredBySourceFilter: false,
            decisionTrace: ["direct source won"],
            suppressionReasons: ["mirrored source suppressed"],
            suppressedRecords: [
              {
                source: "whoop",
                sourceRecordId: "whoop-mirror-1",
                sourceApp: "com.apple.Health",
                bundleId: "com.whoop.mobile",
                packageName: null,
                captureMode: "mirrored",
                reason: "direct source preferred"
              }
            ],
            evidence: ["sleep:2026-03-18"],
            payload: {
              id: "score_recovery_1",
              userId: "user_ada",
              scoreKind: "recovery_readiness",
              value: 82,
              label: "ready",
              confidence: 0.9,
              freshnessHours: 1,
              missingSignals: []
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/dashboard/state")) {
        return new Response(
          JSON.stringify({
            runtimeMode: "live",
            collectorType: "hybrid",
            connectors: {
              runtimeMode: "live",
              collectorType: "hybrid",
              user: { id: "user_ada", name: "Ada", timezone: "Asia/Shanghai", createdAt: "2026-03-19T08:00:00.000Z" },
              sourceAccounts: [],
              devices: [],
              policies: [],
              sourceFilters: [],
              sourcePrecedenceOverrides: []
            },
            scores: [],
            alerts: [],
            explain: null,
            automationRuns: [],
            syncStatus: {
              userId: "user_ada",
              sources: []
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes("/live/bootstrap")) {
        return new Response(
          JSON.stringify({
            runtimeMode: "live",
            userId: "user_ada",
            sourceAccounts: 6,
            tokenCount: 2,
            tokens: [
              { label: "derived", token: "t_derived" },
              { label: "full", token: "t_full" }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.includes("/ingest/")) {
        return new Response(
          JSON.stringify({
            userId: "user_ada",
            providerId: "apple-health",
            batchId: "batch_1",
            idempotent: false,
            processedRecords: 1,
            acceptedRecords: 1,
            droppedRecords: 0,
            dropReasons: [],
            dedupeDecisions: 1,
            outboxEvents: 1,
            staleGateApplied: false,
            syncFreshnessHours: 0,
            anchorAfter: "anchor_2"
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new OpenVitalsClient("http://127.0.0.1:3000");

    const session = await client.createConnectorSession("user_ada", "apple-health");
    const status = await client.syncStatus("user_ada");
    const freshness = await client.signalFreshness("user_ada");
    const filter = await client.setSourceFilter("user_ada", "apple-health", ["com.whoop.mobile"]);
    const precedence = await client.setSourcePrecedence("user_ada", { direct: 5, mirrored: 4, imported: 2, manual: 1 });
    const dashboard = await client.dashboardState("user_ada");
    const ingest = await client.ingestBatch("user_ada", "apple-health", {
      sessionToken: "session_1",
      idempotencyKey: "batch_1",
      anchorBefore: "anchor_1",
      anchorAfter: "anchor_2",
      records: [
        {
          id: "rec_1",
          sourceRecordId: "apple-steps-1",
          metricFamily: "activity",
          kind: "observation",
          metric: "steps",
          value: 1000,
          unit: "count",
          startAt: "2026-03-18T00:00:00.000Z",
          endAt: "2026-03-18T23:59:59.000Z",
          timezone: "Asia/Shanghai",
          captureMode: "direct",
          sourceApp: "com.apple.Health",
          confidence: 0.9,
          tags: []
        }
      ]
    });
    const bootstrap = await client.liveBootstrap({ userId: "user_ada" }, "openvitals-dev-admin");
    const webhook = await client.whoopWebhook("user_ada", { type: "whoop.recovery.updated" }, { adminToken: "openvitals-dev-admin" });
    const explanation = await client.explainWithSemantics("score", "score_recovery_1");

    expect(session.sessionToken).toBe("session_1");
    expect(status.sources).toHaveLength(1);
    expect(status.sources[0]?.queueDepth).toBe(0);
    expect(freshness.semantics.gateOpen).toBe(true);
    expect(freshness.semantics.sources[0]?.dataGranularity).toBe("sample");
    expect(freshness.semantics.sources[0]?.latencyClass).toBe("near_realtime");
    expect(freshness.semantics.sources[0]?.connectionMode).toBe("mobile_permission");
    expect(freshness.semantics.sources[0]?.companionRole).toBe("iphone_companion");
    expect(freshness.semantics.sources[0]?.liveSignalCapable).toBe(true);
    expect(freshness.semantics.sources[0]?.liveSignalActive).toBe(false);
    expect(freshness.semantics.liveSignalCapableProviders).toEqual(["apple-health"]);
    expect(freshness.semantics.liveSignalProviders).toEqual([]);
    expect(filter.providerId).toBe("apple-health");
    expect(precedence.userId).toBe("user_ada");
    expect((dashboard as { runtimeMode: string }).runtimeMode).toBe("live");
    expect(ingest.batchId).toBe("batch_1");
    expect(ingest.acceptedRecords).toBe(1);
    expect(ingest.droppedRecords).toBe(0);
    expect((bootstrap as { tokenCount: number }).tokenCount).toBe(2);
    expect((webhook as { providerId: string }).providerId).toBe("whoop");
    expect(explanation.semantics.dataGranularity).toBe("score");
    expect(explanation.semantics.mirroredOrSuppressed).toBe(true);

    const sourceFilterCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/source-filters"));
    expect(sourceFilterCall?.[1]).toMatchObject({ method: "PUT" });
  });

  it("classifies optional Apple Watch workout mode as the only live Apple Health signal", () => {
    const syncStatus: SyncStatusResponse = {
      userId: "user_ada",
      sources: [
        {
          providerId: "apple-health",
          status: "connected",
          authState: "connected",
          lastSyncAt: "2026-03-19T08:00:00.000Z",
          lastSuccessfulSyncAt: "2026-03-19T08:00:00.000Z",
          syncFreshnessHours: 0,
          stalenessReason: null,
          lastAnchor: "watch-live-anchor",
          lastError: null,
          pendingIngestBatches: 0,
          dataQualityGate: "ok",
          dataMode: "live",
          connectionMethod: "sdk-ingest",
          connectionMode: "device_pairing",
          metricCapabilities: [
            {
              metricName: "live_workout_heart_rate",
              source: "apple-health",
              dataGranularity: "live_signal",
              latencyClass: "live",
              direct: true,
              mirrored: false
            }
          ],
          credentialExpiresAt: null,
          lastCredentialError: null,
          lastIngestBatchId: "batch_watch_live",
          queueDepth: 0,
          backoffUntil: null
        }
      ]
    };

    const semantics = summarizeSyncStatusSemantics(syncStatus, new Date("2026-03-19T08:00:00.000Z"));

    expect(semantics.sources[0]).toMatchObject({
      providerId: "apple-health",
      dataGranularity: "live_signal",
      latencyClass: "live",
      connectionMode: "device_pairing",
      companionRole: "optional_watch_live_workout",
      liveSignalCapable: true,
      liveSignalActive: true
    });
    expect(semantics.liveSignalProviders).toEqual(["apple-health"]);
    expect(semantics.watchAppRequiredForHistoricalSync).toBe(false);
    expect(semantics.watchAppRequiredForLiveWorkoutHr).toBe(true);
    expect(semantics.sources[0]?.confidenceNote).toContain("Apple Watch live-workout");
  });
});
