const baseUrl = process.env.OPENVITALS_API_URL ?? "http://127.0.0.1:3000";
const token = process.env.OPENVITALS_AGENT_TOKEN ?? "ov_demo_user_ada_derived";
const userId = process.env.OPENVITALS_USER_ID ?? "user_ada";
const providerId = process.env.OPENVITALS_PROVIDER_ID ?? "apple-health";
const samples = Number(process.env.OPENVITALS_BENCH_SAMPLES ?? 5);

const now = () => performance.now();

const request = async <T = unknown>(path: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(new URL(path, baseUrl).toString(), {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new Error(`Benchmark request failed ${response.status} ${response.statusText} for ${path}`);
  }
  return (await response.json()) as T;
};

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

const run = async () => {
  const latencies: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = now();
    await request(`/v1/users/${userId}/sync-status`);
    latencies.push(now() - start);
  }

  const session = await request<{ sessionToken: string }>(`/v1/users/${userId}/connect/${providerId}/session`, { method: "POST" });
  const ingestLatencies: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const ingestStart = now();
    await request(`/v1/users/${userId}/ingest/${providerId}`, {
      method: "POST",
      body: JSON.stringify({
        sessionToken: session.sessionToken,
        idempotencyKey: `bench-${Date.now()}-${index}`,
        anchorBefore: `bench-anchor-${index}`,
        anchorAfter: `bench-anchor-${index + 1}`,
        records: [
          {
            id: `bench-record-${index}`,
            sourceRecordId: `bench-source-${index}`,
            metricFamily: "activity",
            kind: "observation",
            metric: "steps",
            value: 1000 + index * 10,
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
      })
    });
    ingestLatencies.push(now() - ingestStart);
  }

  const syncStart = now();
  await request(`/v1/users/${userId}/sync`, {
    method: "POST",
    body: JSON.stringify({
      mode: "incremental",
      providerId
    })
  });
  const events = await request(`/v1/experimental/outbox/events?userId=${encodeURIComponent(userId)}&after=0&limit=20`);
  const webhookDeliveries = await request(`/v1/experimental/webhook-deliveries`);
  const syncToEventMs = now() - syncStart;

  const result = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    userId,
    samples,
    syncStatusLatencyMs: {
      avg: Number(average(latencies).toFixed(2)),
      min: Number(Math.min(...latencies).toFixed(2)),
      max: Number(Math.max(...latencies).toFixed(2))
    },
    ingestLatencyMs: {
      avg: Number(average(ingestLatencies).toFixed(2)),
      min: Number(Math.min(...ingestLatencies).toFixed(2)),
      max: Number(Math.max(...ingestLatencies).toFixed(2)),
      tpsApprox: Number((1000 / Math.max(average(ingestLatencies), 1)).toFixed(2))
    },
    syncToEventMs: Number(syncToEventMs.toFixed(2)),
    outboxEventsCount: Array.isArray(events) ? events.length : 0,
    webhookDeliveriesCount: Array.isArray(webhookDeliveries) ? webhookDeliveries.length : 0
  };

  console.log(JSON.stringify(result, null, 2));
};

await run();
