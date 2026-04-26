import { createAndroidCollectorClient } from "./index.js";

describe("collector-android", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries queued ingest batches with backoff", async () => {
    let ingestCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ingest/")) {
        ingestCalls += 1;
        if (ingestCalls === 1) {
          return new Response("temporary error", { status: 500, statusText: "Internal Server Error" });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("/sync-status")) {
        return new Response(
          JSON.stringify({
            userId: "user_ada",
            sources: []
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createAndroidCollectorClient({
      apiBaseUrl: "http://127.0.0.1:3000",
      baseBackoffMs: 1
    });
    expect(client.dataSemantics.liveSignal).toBe(false);
    expect(client.dataSemantics.notes).toContain("not a continuous cloud raw stream");

    const queued = await client.enqueue({
      userId: "user_ada",
      sessionToken: "session_1",
      idempotencyKey: "batch_1",
      records: [
        {
          id: "rec_1",
          sourceRecordId: "hc-steps-1",
          metricFamily: "activity",
          kind: "observation",
          metric: "steps",
          value: 1200,
          unit: "count",
          startAt: "2026-03-18T00:00:00.000Z",
          endAt: "2026-03-18T23:59:59.000Z",
          timezone: "Asia/Shanghai",
          captureMode: "direct",
          sourceApp: "com.google.android.apps.healthdata",
          confidence: 0.9,
          tags: []
        }
      ]
    });

    expect(queued.queued).toBe(1);
    expect(queued.backoffUntil).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 5));
    const flushed = await client.flush();
    expect(flushed.queued).toBe(0);
    expect(ingestCalls).toBe(2);
  });
});
