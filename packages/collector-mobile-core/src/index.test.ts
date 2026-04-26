import {
  appleHealthDataSemantics,
  createMobileCollectorClient,
  healthConnectDataSemantics,
  isCollectorClientError,
  isCredentialExpiredSyncSource
} from "./index.js";

describe("collector-mobile-core", () => {
  it("exposes Health Connect as permissioned batched data, not a cloud stream", () => {
    expect(healthConnectDataSemantics.providerId).toBe("health-connect");
    expect(healthConnectDataSemantics.liveSignal).toBe(false);
    expect(healthConnectDataSemantics.rawPayloadPolicy).toContain("raw-event payloads");
    expect(healthConnectDataSemantics.notes).toContain("not a continuous cloud raw stream");
  });

  it("exposes Apple Health iPhone historical semantics separately from optional watch live mode", () => {
    expect(appleHealthDataSemantics.providerId).toBe("apple-health");
    expect(appleHealthDataSemantics.iPhoneHistorical).toMatchObject({
      connectionMode: "mobile_permission",
      liveSignal: false
    });
    expect(appleHealthDataSemantics.iPhoneHistorical.latencyClass).toEqual(expect.arrayContaining(["delayed_sync", "near_realtime"]));
    expect(appleHealthDataSemantics.watchLiveWorkout).toMatchObject({
      connectionMode: "device_pairing",
      dataGranularity: "live_signal",
      latencyClass: "live",
      liveSignal: true
    });
    expect(appleHealthDataSemantics.dedupePolicy).toContain("sourceRecordId");
  });

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses provider-specific lifecycle endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/connect/")) {
        return new Response(
          JSON.stringify({
            sessionToken: "session_1",
            expiresAt: "2026-03-19T10:00:00.000Z"
          }),
          { status: 200 }
        );
      }
      if (url.includes("/ingest/")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/source-filters")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/sync-status")) {
        return new Response(JSON.stringify({ userId: "user_ada", sources: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createMobileCollectorClient({ apiBaseUrl: "http://127.0.0.1:3000" }, "apple-health");

    await client.createSession("user_ada");
    await client.ingest({
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
    await client.setIgnoredSources("user_ada", ["com.whoop.mobile"]);
    await client.syncStatus("user_ada");

    expect(fetchMock).toHaveBeenCalled();
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes("/v1/users/user_ada/connect/apple-health/session"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/v1/users/user_ada/ingest/apple-health"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/v1/users/user_ada/source-filters"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/v1/users/user_ada/sync-status"))).toBe(true);
  });

  it("classifies expired and forbidden collector responses for reconnect UX", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Session token expired; create a new mobile session." }), { status: 401 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createMobileCollectorClient({ apiBaseUrl: "http://127.0.0.1:3000" }, "apple-health");
    await expect(client.syncStatus("user_ada")).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
      status: 401
    });

    try {
      await client.syncStatus("user_ada");
    } catch (error) {
      expect(isCollectorClientError(error)).toBe(true);
      if (isCollectorClientError(error)) {
        expect(error.details).toMatchObject({ message: expect.stringContaining("expired") });
      }
    }
  });

  it("detects expired credential sync-status sources", () => {
    expect(
      isCredentialExpiredSyncSource(
        {
          providerId: "apple-health",
          authState: "connected",
          credentialExpiresAt: "2026-03-19T07:59:59.000Z"
        },
        new Date("2026-03-19T08:00:00.000Z")
      )
    ).toBe(true);
    expect(isCredentialExpiredSyncSource({ providerId: "apple-health", authState: "reauth_required" })).toBe(true);
    expect(isCredentialExpiredSyncSource({ providerId: "apple-health", authState: "connected", credentialExpiresAt: null })).toBe(false);
  });
});
