import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApi } from "../apps/api/src/index.js";

const check = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const asObject = (value, message) => {
  check(value !== null && typeof value === "object" && !Array.isArray(value), message);
  return value;
};

const asArray = (value, message) => {
  check(Array.isArray(value), message);
  return value;
};

const parseJson = (input) => {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

const timestamp = "2026-03-19T08:00:00.000Z";
const userId = "user_apple_watch_e2e";

const healthRecord = (overrides) => ({
  id: overrides.id,
  sourceRecordId: overrides.sourceRecordId,
  metricFamily: overrides.metricFamily,
  kind: overrides.kind ?? "observation",
  metric: overrides.metric,
  value: overrides.value,
  unit: overrides.unit,
  startAt: overrides.startAt,
  endAt: overrides.endAt,
  timezone: "Asia/Shanghai",
  captureMode: overrides.captureMode ?? "direct",
  sourceApp: overrides.sourceApp ?? "com.apple.Health",
  bundleId: overrides.bundleId ?? "com.apple.Health",
  packageName: overrides.packageName,
  confidence: overrides.confidence ?? 0.95,
  dataGranularity: overrides.dataGranularity,
  latencyClass: overrides.latencyClass,
  episodeType: overrides.episodeType,
  title: overrides.title,
  metrics: overrides.metrics,
  tags: [
    `data_granularity:${overrides.dataGranularity}`,
    `latency_class:${overrides.latencyClass}`,
    ...(overrides.tags ?? [])
  ]
});

const run = async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-apple-health-watch-"));
  const dbPath = path.join(tempDir, "apple-health-watch.sqlite");
  const { app } = await createApi({
    dbPath,
    mode: "live",
    now: new Date(timestamp)
  });

  let apiBaseUrl = "";
  const requestJson = async (method, pathName, options = {}) => {
    const headers = new Headers();
    if (options.admin) {
      headers.set("x-openvitals-admin", "openvitals-dev-admin");
    }
    if (options.token) {
      headers.set("authorization", `Bearer ${options.token}`);
    }
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(new URL(pathName, apiBaseUrl).toString(), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    const text = await response.text();
    return {
      status: response.status,
      body: parseJson(text)
    };
  };

  try {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    check(address && typeof address !== "string", "api failed to bind an address");
    apiBaseUrl = `http://127.0.0.1:${address.port}`;

    const bootstrap = await requestJson("POST", "/v1/live/bootstrap", {
      admin: true,
      body: {
        userId,
        name: "Apple Watch E2E User",
        timezone: "Asia/Shanghai",
        providers: ["apple-health"],
        createTokens: true
      }
    });
    check(bootstrap.status === 200, `bootstrap expected 200, got ${bootstrap.status}`);
    const tokens = asArray(asObject(bootstrap.body, "bootstrap body must be an object").tokens, "bootstrap tokens must be an array");
    const derivedToken = asObject(tokens.find((token) => token.label === "derived"), "derived token missing").token;
    const fullToken = asObject(tokens.find((token) => token.label === "full"), "full token missing").token;

    const session = await requestJson("POST", `/v1/users/${userId}/connect/apple-health/session`, {
      token: derivedToken
    });
    check(session.status === 200, `session expected 200, got ${session.status}`);
    const sessionToken = asObject(session.body, "session body must be an object").sessionToken;
    check(typeof sessionToken === "string" && sessionToken.length > 0, "session token missing");

    const sourceFilter = await requestJson("PUT", `/v1/users/${userId}/source-filters`, {
      token: derivedToken,
      body: {
        providerId: "apple-health",
        ignoredSources: ["com.whoop.mobile", "com.ouraring.oura"]
      }
    });
    check(sourceFilter.status === 200, `source filter expected 200, got ${sourceFilter.status}`);

    const historicalRecords = [
      healthRecord({
        id: "apple-health:heart-rate:sample-1",
        sourceRecordId: "com.apple.Health:heart-rate:sample-1",
        metricFamily: "cardiovascular",
        metric: "heart_rate",
        value: 72,
        unit: "bpm",
        startAt: "2026-03-19T07:55:00.000Z",
        endAt: "2026-03-19T07:55:00.000Z",
        dataGranularity: "sample",
        latencyClass: "delayed_sync",
        tags: ["device_model:Apple Watch", "source_product:Watch6,2"]
      }),
      healthRecord({
        id: "apple-health:hrv-sdnn:sample-1",
        sourceRecordId: "com.apple.Health:hrv-sdnn:sample-1",
        metricFamily: "cardiovascular",
        metric: "hrv_sdnn",
        value: 48,
        unit: "ms",
        startAt: "2026-03-19T07:50:00.000Z",
        endAt: "2026-03-19T07:50:00.000Z",
        dataGranularity: "sample",
        latencyClass: "delayed_sync",
        tags: ["device_model:Apple Watch", "source_product:Watch6,2"]
      }),
      healthRecord({
        id: "apple-health:resting-heart-rate:sample-1",
        sourceRecordId: "com.apple.Health:resting-heart-rate:sample-1",
        metricFamily: "cardiovascular",
        metric: "resting_heart_rate",
        value: 58,
        unit: "bpm",
        startAt: "2026-03-19T07:00:00.000Z",
        endAt: "2026-03-19T07:00:00.000Z",
        dataGranularity: "sample",
        latencyClass: "delayed_sync",
        tags: ["device_model:Apple Watch", "source_product:Watch6,2"]
      }),
      healthRecord({
        id: "apple-health:steps:sample-1",
        sourceRecordId: "com.apple.Health:steps:sample-1",
        metricFamily: "activity",
        metric: "steps",
        value: 2460,
        unit: "count",
        startAt: "2026-03-19T00:00:00.000Z",
        endAt: "2026-03-19T07:59:59.000Z",
        dataGranularity: "sample",
        latencyClass: "delayed_sync"
      }),
      healthRecord({
        id: "apple-health:sleep:episode-1",
        sourceRecordId: "com.apple.Health:sleep:episode-1",
        metricFamily: "sleep",
        kind: "episode",
        metric: "sleep_analysis",
        value: 430,
        unit: "minutes",
        startAt: "2026-03-18T15:00:00.000Z",
        endAt: "2026-03-18T22:10:00.000Z",
        episodeType: "sleep",
        title: "HealthKit sleep",
        metrics: { duration_minutes: 430 },
        dataGranularity: "episode",
        latencyClass: "delayed_sync",
        tags: ["device_model:Apple Watch"]
      }),
      healthRecord({
        id: "apple-health:workout:episode-1",
        sourceRecordId: "com.apple.Health:workout:episode-1",
        metricFamily: "workout",
        kind: "episode",
        metric: "workout",
        value: 1800,
        unit: "seconds",
        startAt: "2026-03-19T06:00:00.000Z",
        endAt: "2026-03-19T06:30:00.000Z",
        episodeType: "workout",
        title: "HealthKit workout",
        metrics: { duration_seconds: 1800, active_energy_kcal: 220 },
        dataGranularity: "episode",
        latencyClass: "delayed_sync",
        tags: ["device_model:Apple Watch", "source_product:Watch6,2"]
      })
    ];

    const liveWorkoutRecord = healthRecord({
      id: "apple-watch:live-workout-heart-rate:sample-1",
      sourceRecordId: "apple-watch-live-workout:1773907200000",
      metricFamily: "cardiovascular",
      metric: "live_workout_heart_rate",
      value: 118,
      unit: "count/min",
      startAt: "2026-03-19T08:00:00.000Z",
      endAt: "2026-03-19T08:00:03.000Z",
      dataGranularity: "live_signal",
      latencyClass: "live",
      tags: ["connection_mode:device_pairing", "device_model:Apple Watch", "source_product:apple_watch"]
    });

    const mirroredWhoopRecord = healthRecord({
      id: "apple-health:mirror:whoop:steps-1",
      sourceRecordId: "mirror:whoop-steps-1",
      metricFamily: "activity",
      metric: "steps",
      value: 2460,
      unit: "count",
      startAt: "2026-03-19T00:00:00.000Z",
      endAt: "2026-03-19T07:59:59.000Z",
      captureMode: "mirrored",
      sourceApp: "com.whoop.mobile",
      bundleId: "com.whoop.mobile",
      confidence: 0.8,
      dataGranularity: "sample",
      latencyClass: "delayed_sync",
      tags: ["capture_mode:mirrored"]
    });

    const ingest = await requestJson("POST", `/v1/users/${userId}/ingest/apple-health`, {
      token: derivedToken,
      body: {
        sessionToken,
        idempotencyKey: "apple-health-watch-local-e2e-1",
        anchorBefore: null,
        anchorAfter: JSON.stringify({
          anchors: {
            heart_rate: "anchor-heart-rate",
            hrv_sdnn: "anchor-hrv",
            resting_heart_rate: "anchor-resting",
            steps: "anchor-steps",
            sleep_analysis: "anchor-sleep",
            workouts: "anchor-workouts",
            live_workout_heart_rate: "anchor-live-workout-heart-rate"
          },
          generatedAt: timestamp
        }),
        collectorMeta: {
          sdk: "collector-ios",
          sdkVersion: "local-e2e",
          appBuild: "local",
          deviceModel: "Apple Watch + iPhone"
        },
        records: [...historicalRecords, liveWorkoutRecord, mirroredWhoopRecord]
      }
    });
    check(ingest.status === 200, `ingest expected 200, got ${ingest.status}: ${JSON.stringify(ingest.body)}`);
    const ingestBody = asObject(ingest.body, "ingest body must be an object");
    check(ingestBody.processedRecords === 7, `processedRecords expected 7, got ${String(ingestBody.processedRecords)}`);
    check(ingestBody.droppedRecords === 1, `droppedRecords expected 1, got ${String(ingestBody.droppedRecords)}`);

    const syncStatus = await requestJson("GET", `/v1/users/${userId}/sync-status`, { token: derivedToken });
    check(syncStatus.status === 200, `sync-status expected 200, got ${syncStatus.status}`);
    const appleStatus = asArray(asObject(syncStatus.body, "sync body must be object").sources, "sync sources must be array").find(
      (source) => source.providerId === "apple-health"
    );
    check(appleStatus, "sync-status missing apple-health");
    check(appleStatus.authState === "connected", `apple-health authState expected connected, got ${String(appleStatus.authState)}`);
    check(appleStatus.connectionMethod === "sdk-ingest", `connectionMethod expected sdk-ingest, got ${String(appleStatus.connectionMethod)}`);
    check(appleStatus.dataQualityGate === "ok", `dataQualityGate expected ok, got ${String(appleStatus.dataQualityGate)}`);

    const timeline = await requestJson("GET", `/v1/timeline?userId=${userId}&days=30`, { token: fullToken });
    check(timeline.status === 200, `timeline expected 200, got ${timeline.status}`);
    const timelineRows = asArray(timeline.body, "timeline must be array");
    const metrics = new Set(timelineRows.map((row) => row.metric ?? row.episodeType));
    for (const expectedMetric of ["heart_rate", "hrv_sdnn", "resting_heart_rate", "steps", "sleep", "workout", "live_workout_heart_rate"]) {
      check(metrics.has(expectedMetric), `timeline missing ${expectedMetric}`);
    }
    const liveRow = asObject(
      timelineRows.find((row) => row.metric === "live_workout_heart_rate"),
      "live workout heart-rate row missing"
    );
    check(liveRow.dataGranularity === "live_signal", `live row dataGranularity expected live_signal, got ${String(liveRow.dataGranularity)}`);
    check(liveRow.latencyClass === "live", `live row latencyClass expected live, got ${String(liveRow.latencyClass)}`);
    check(liveRow.captureMode === "direct", `live row captureMode expected direct, got ${String(liveRow.captureMode)}`);

    const explain = await requestJson("GET", `/v1/explain/observation/${encodeURIComponent(liveRow.id)}`, { token: fullToken });
    check(explain.status === 200, `explain live row expected 200, got ${explain.status}`);
    const explainBody = asObject(explain.body, "explain body must be object");
    check(explainBody.dataGranularity === "live_signal", "explain did not preserve live_signal granularity");
    check(explainBody.latencyClass === "live", "explain did not preserve live latency");

    console.log(
      JSON.stringify(
        {
          apiBaseUrl,
          bootstrap: bootstrap.status,
          session: session.status,
          processedRecords: ingestBody.processedRecords,
          droppedMirroredRecords: ingestBody.droppedRecords,
          syncStatus: syncStatus.status,
          appleHealthAuthState: appleStatus.authState,
          appleHealthConnectionMethod: appleStatus.connectionMethod,
          appleHealthDataQualityGate: appleStatus.dataQualityGate,
          timelineCount: timelineRows.length,
          timelineMetrics: [...metrics].sort(),
          liveWorkoutHeartRate: {
            dataGranularity: liveRow.dataGranularity,
            latencyClass: liveRow.latencyClass,
            captureMode: liveRow.captureMode
          },
          explain: explain.status
        },
        null,
        2
      )
    );
  } finally {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

await run();
