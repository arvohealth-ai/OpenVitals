import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createApi } from "../apps/api/src/index.js";

const derivedToken = "ov_demo_user_ada_derived";
const otherUserToken = "ov_demo_user_bea_derived";

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

const wait = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-smoke-"));
  const dbPath = path.join(tempDir, "smoke.sqlite");

  const { app } = await createApi({
    dbPath,
    mode: "demo",
    now: new Date("2026-03-19T08:00:00.000Z")
  });

  const receiverAttempts = new Map();
  let receiverRequests = 0;

  const receiver = http.createServer((request, reply) => {
    const eventId = String(request.headers["x-openvitals-event-id"] ?? "unknown");
    const attempt = (receiverAttempts.get(eventId) ?? 0) + 1;
    receiverAttempts.set(eventId, attempt);
    receiverRequests += 1;

    request.resume();

    if (attempt < 3) {
      reply.statusCode = 500;
      reply.end("retry");
      return;
    }

    reply.statusCode = 200;
    reply.end("ok");
  });

  const startReceiver = async () =>
    new Promise((resolve, reject) => {
      receiver.listen(0, "127.0.0.1", (error) => {
        if (error) {
          reject(error);
          return;
        }
        const address = receiver.address();
        check(address && typeof address !== "string", "webhook receiver failed to bind an address");
        resolve(address.port);
      });
    });

  let apiBaseUrl = "";

  const requestJson = async (method, pathName, options = {}) => {
    const headers = new Headers();
    headers.set("authorization", `Bearer ${options.token ?? derivedToken}`);

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

  const requestPublic = async (pathName) => {
    const response = await fetch(new URL(pathName, apiBaseUrl).toString());
    return {
      status: response.status,
      body: await response.text()
    };
  };

  const readFirstSseEvent = async (afterSequence) => {
    const response = await fetch(new URL(`/v1/events/stream?userId=user_ada&after=${afterSequence}`, apiBaseUrl).toString(), {
      headers: {
        authorization: `Bearer ${derivedToken}`
      }
    });

    check(response.status === 200, `sse stream status expected 200, got ${response.status}`);
    check(response.body, "sse stream body missing");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + 5000;
    let buffer = "";

    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        if (!chunk.startsWith("data: ")) {
          continue;
        }

        const payload = parseJson(chunk.slice("data: ".length));
        if (payload !== null && typeof payload === "object") {
          const sequence = Number(payload.sequence ?? 0);
          if (Number.isFinite(sequence) && sequence > afterSequence) {
            await reader.cancel();
            return payload;
          }
        }
      }
    }

    await reader.cancel();
    throw new Error("No SSE event received for cursor window");
  };

  try {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    check(address && typeof address !== "string", "api failed to bind an address");
    apiBaseUrl = `http://127.0.0.1:${address.port}`;

    const receiverPort = await startReceiver();

    const dashboard = await requestPublic("/dashboard");
    check(dashboard.status === 200, `dashboard status expected 200, got ${dashboard.status}`);
    check(dashboard.body.includes("OpenVitals Dashboard"), "dashboard content marker missing");

    const playground = await requestPublic("/playground");
    check(playground.status === 200, `playground status expected 200, got ${playground.status}`);

    const connectors = await requestJson("GET", "/v1/connectors?userId=user_ada");
    check(connectors.status === 200, `connectors status expected 200, got ${connectors.status}`);
    const dashboardState = await requestJson("GET", "/v1/dashboard/state?userId=user_ada");
    check(dashboardState.status === 200, `dashboard state expected 200, got ${dashboardState.status}`);

    const explain = await requestJson("GET", "/v1/explain/score/score_recovery_readiness");
    check(explain.status === 200, `explain status expected 200, got ${explain.status}`);

    const session = await requestJson("POST", "/v1/users/user_ada/connect/apple-health/session");
    check(session.status === 200, `session status expected 200, got ${session.status}`);
    const sessionBody = asObject(session.body, "session response must be an object");
    const sessionToken = sessionBody.sessionToken;
    check(typeof sessionToken === "string" && sessionToken.length > 10, "sessionToken is missing or invalid");

    const sourceFilter = await requestJson("PUT", "/v1/users/user_ada/source-filters", {
      body: {
        providerId: "apple-health",
        ignoredSources: ["com.whoop.mobile"]
      }
    });
    check(sourceFilter.status === 200, `source filter status expected 200, got ${sourceFilter.status}`);

    const ingestPayload = {
      sessionToken,
      idempotencyKey: "smoke-mobile-ingest-1",
      anchorBefore: "anchor-a",
      anchorAfter: "anchor-b",
      records: [
        {
          id: "record-smoke-1",
          sourceRecordId: "mirror:whoop-steps-smoke-1",
          metricFamily: "activity",
          kind: "observation",
          metric: "steps",
          value: 1400,
          unit: "count",
          startAt: "2026-03-18T00:00:00.000Z",
          endAt: "2026-03-18T23:59:59.000Z",
          timezone: "Asia/Shanghai",
          captureMode: "mirrored",
          sourceApp: "com.whoop.mobile",
          bundleId: "com.whoop.mobile",
          confidence: 0.8
        }
      ]
    };

    const ingestFirst = await requestJson("POST", "/v1/users/user_ada/ingest/apple-health", {
      body: ingestPayload
    });
    check(ingestFirst.status === 200, `first ingest status expected 200, got ${ingestFirst.status}`);
    const ingestFirstBody = asObject(ingestFirst.body, "first ingest response must be an object");
    check(ingestFirstBody.droppedRecords === 1, `first ingest droppedRecords expected 1, got ${String(ingestFirstBody.droppedRecords)}`);

    const ingestSecond = await requestJson("POST", "/v1/users/user_ada/ingest/apple-health", {
      body: ingestPayload
    });
    check(ingestSecond.status === 200, `second ingest status expected 200, got ${ingestSecond.status}`);
    const ingestSecondBody = asObject(ingestSecond.body, "second ingest response must be an object");
    check(ingestSecondBody.idempotent === true, `second ingest idempotent expected true, got ${String(ingestSecondBody.idempotent)}`);

    const syncStatus = await requestJson("GET", "/v1/users/user_ada/sync-status");
    check(syncStatus.status === 200, `sync-status expected 200, got ${syncStatus.status}`);
    const syncStatusBody = asObject(syncStatus.body, "sync-status response must be an object");
    const syncSources = asArray(syncStatusBody.sources, "sync-status sources must be an array");
    check(syncSources.some((row) => asObject(row, "sync source must be object").providerId === "apple-health"), "sync-status missing apple-health source");

    const outboxBefore = await requestJson("GET", "/v1/experimental/outbox/events?userId=user_ada&after=0&limit=500");
    check(outboxBefore.status === 200, `outbox before expected 200, got ${outboxBefore.status}`);
    const outboxBeforeRows = asArray(outboxBefore.body, "outbox before must be array");
    const lastBefore = outboxBeforeRows[outboxBeforeRows.length - 1];
    const baselineSequence = Number(asObject(lastBefore, "last outbox row must be object").sequence ?? 0);

    const webhook = await requestJson("POST", "/v1/webhooks", {
      body: {
        url: `http://127.0.0.1:${receiverPort}/hook`,
        status: "active",
        // Use a deterministic sync event so the smoke test checks webhook retry behavior
        // without depending on whether the current demo fixture emits a stale-data event.
        eventTypes: ["health.sync.completed"]
      }
    });
    check(webhook.status === 200, `webhook create expected 200, got ${webhook.status}`);
    const webhookBody = asObject(webhook.body, "webhook response must be object");
    const webhookId = webhookBody.id;
    check(typeof webhookId === "string" && webhookId.length > 0, "webhook id missing");

    const sync = await requestJson("POST", "/v1/users/user_ada/sync", {
      body: {
        providerId: "apple-health",
        mode: "incremental"
      }
    });
    check(sync.status === 200, `sync expected 200, got ${sync.status}`);
    const syncBody = asObject(sync.body, "sync response must be object");
    const streamEvents = Number(syncBody.streamEvents ?? 0);
    check(streamEvents > 0, `sync streamEvents expected > 0, got ${streamEvents}`);

    const outboxAfter = await requestJson(
      "GET",
      `/v1/experimental/outbox/events?userId=user_ada&after=${baselineSequence}&limit=500`
    );
    check(outboxAfter.status === 200, `outbox after expected 200, got ${outboxAfter.status}`);
    const outboxAfterRows = asArray(outboxAfter.body, "outbox after must be array");
    check(outboxAfterRows.length > 0, "outbox after cursor returned 0 rows");

    const sseEvent = await readFirstSseEvent(baselineSequence);

    await wait(500);

    const deliveries = await requestJson("GET", `/v1/experimental/webhook-deliveries?webhookId=${encodeURIComponent(webhookId)}`);
    check(deliveries.status === 200, `deliveries expected 200, got ${deliveries.status}`);
    const deliveryRows = asArray(deliveries.body, "deliveries response must be array");

    const grouped = new Map();
    for (const row of deliveryRows) {
      const delivery = asObject(row, "delivery row must be object");
      const eventId = String(delivery.eventId ?? "");
      if (!eventId) {
        continue;
      }
      const bucket = grouped.get(eventId) ?? [];
      bucket.push(delivery);
      grouped.set(eventId, bucket);
    }

    const hasRetriedSuccess = [...grouped.values()].some((rows) => {
      if (rows.length < 3) {
        return false;
      }
      return rows.some((row) => row.status === "succeeded");
    });
    check(hasRetriedSuccess, "webhook retry+success pattern not observed");

    const crossUser = await requestJson("GET", "/v1/connectors?userId=user_ada", {
      token: otherUserToken
    });
    check(crossUser.status === 403, `cross-user access expected 403, got ${crossUser.status}`);

    const sseType = String(sseEvent.type ?? "unknown");
    const sseSequence = Number(sseEvent.sequence ?? 0);

    console.log(
      JSON.stringify(
        {
          apiBaseUrl,
          dashboard: dashboard.status,
          playground: playground.status,
          connectors: connectors.status,
          dashboardState: dashboardState.status,
          explain: explain.status,
          session: session.status,
          ingestFirstDroppedRecords: ingestFirstBody.droppedRecords,
          ingestSecondIdempotent: ingestSecondBody.idempotent,
          syncStatus: syncStatus.status,
          syncStreamEvents: streamEvents,
          outboxAfterCursorCount: outboxAfterRows.length,
          sseEventType: sseType,
          sseEventSequence: sseSequence,
          webhookDeliveries: deliveryRows.length,
          webhookReceiverRequests: receiverRequests,
          crossUserStatus: crossUser.status
        },
        null,
        2
      )
    );
  } finally {
    await new Promise((resolve) => receiver.close(() => resolve()));
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

await run();
