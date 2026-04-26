import {
  ConnectSessionResponseSchema,
  DemoStateSchema,
  IngestRecordSchema,
  ProviderManifestSchema,
  SyncStatusResponseSchema
} from "./index.js";

describe("contracts", () => {
  it("validates provider manifests", () => {
    expect(
      ProviderManifestSchema.parse({
        id: "oura",
        packageName: "@openvitals/provider-oura",
        displayName: "Oura",
        providerClass: "cloud",
        runtimePath: "mock",
        phase: "phase-1",
        status: "demo-ready",
        coverage: ["sleep"],
        capabilities: ["connect", "sync_history"],
        notes: "Mock provider for local demo."
      }).id
    ).toBe("oura");
  });

  it("keeps the demo schema shape stable", () => {
    expect(() =>
      DemoStateSchema.parse({
        user: { id: "u", name: "Ada", timezone: "Asia/Shanghai", createdAt: "2026-03-19T00:00:00.000Z" },
        sourceAccounts: [],
        devices: [],
        consentGrants: [],
        rawEvents: [],
        observations: [],
        episodes: [],
        dailySummaries: [],
        scores: [],
        insights: [],
        recommendations: [],
        alerts: [],
        automations: [],
        automationRuns: [],
        feedback: [],
        policies: [],
        auditLogs: [],
        outbox: []
      })
    ).not.toThrow();
  });

  it("requires origin metadata for mirrored ingest records", () => {
    expect(() =>
      IngestRecordSchema.parse({
        id: "rec_mirror_1",
        sourceRecordId: "mirror:sample",
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
      })
    ).toThrow("bundleId");
  });

  it("keeps companion session and sync-status additions backward-compatible", () => {
    const session = ConnectSessionResponseSchema.parse({
      userId: "u",
      providerId: "apple-health",
      sessionToken: "token",
      expiresAt: "2026-03-19T00:15:00.000Z"
    });
    expect(session.connectionMethod).toBe("sdk-ingest");
    expect(session.connectionMode).toBe("mobile_permission");

    const status = SyncStatusResponseSchema.parse({
      userId: "u",
      sources: [
        {
          providerId: "apple-health",
          status: "connected",
          lastSyncAt: "2026-03-19T00:00:00.000Z",
          syncFreshnessHours: 0,
          lastAnchor: null,
          lastError: null
        }
      ]
    });
    expect(status.sources[0]?.lastIngestAt).toBeNull();
    expect(status.sources[0]?.lastDropReasons).toEqual([]);
    expect(status.sources[0]?.activeSessionExpiresAt).toBeNull();
  });
});
