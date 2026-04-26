import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApi } from "./index.js";

const DERIVED_TOKEN = "ov_demo_user_ada_derived";
const OTHER_USER_TOKEN = "ov_demo_user_bea_derived";

describe("api", () => {
  it("serves connectors and explain endpoints", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-api-"));
    const { app } = await createApi({ dbPath: path.join(dir, "test.sqlite"), now: new Date("2026-03-19T08:00:00.000Z") });

    const connectors = await app.inject({
      method: "GET",
      url: "/v1/connectors?userId=user_ada",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });

    expect(connectors.statusCode).toBe(200);
    const whoopConnector = (connectors.json().sourceAccounts as Array<Record<string, unknown>>).find((row) => row.providerId === "whoop");
    expect(whoopConnector).toBeDefined();
    expect(typeof whoopConnector?.dataMode).toBe("string");
    expect(typeof whoopConnector?.connectionMethod).toBe("string");
    expect(typeof whoopConnector?.authState).toBe("string");

    const profiles = await app.inject({
      method: "GET",
      url: "/v1/users",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });
    expect(profiles.statusCode).toBe(200);
    expect(profiles.json().profiles).toHaveLength(1);

    const explain = await app.inject({
      method: "GET",
      url: "/v1/explain/score/score_recovery_readiness",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });

    expect(explain.statusCode).toBe(200);

    const state = await app.inject({
      method: "GET",
      url: "/v1/state?userId=user_ada",
      headers: {
        authorization: `Bearer ov_demo_user_ada_full`
      }
    });
    expect(state.statusCode).toBe(200);
    const firstDecision = (state.json().dedupeDecisions as Array<{ fingerprint: string }>)[0];
    expect(firstDecision).toBeDefined();

    if (firstDecision?.fingerprint) {
      const explainDedupe = await app.inject({
        method: "GET",
        url: `/v1/explain-dedupe/${encodeURIComponent(firstDecision.fingerprint)}`,
        headers: {
          authorization: `Bearer ov_demo_user_ada_full`
        }
      });
      expect(explainDedupe.statusCode).toBe(200);
      expect(explainDedupe.json().reasonCode).toBeDefined();
      expect(explainDedupe.json().origin).toBeDefined();
      expect(explainDedupe.json().policyVersion).toBeDefined();
    }
    await app.close();
  });

  it("serves dashboard state with derived scope token", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-api-"));
    const { app } = await createApi({ dbPath: path.join(dir, "test.sqlite"), now: new Date("2026-03-19T08:00:00.000Z") });

    const dashboard = await app.inject({
      method: "GET",
      url: "/v1/dashboard/state?userId=user_ada",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().connectors.runtimeMode).toBeDefined();
    expect(Array.isArray(dashboard.json().automationRuns)).toBe(true);
    await app.close();
  });

  it("acks alerts and updates status", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-api-"));
    const { app } = await createApi({ dbPath: path.join(dir, "test.sqlite"), now: new Date("2026-03-19T08:00:00.000Z") });

    const response = await app.inject({
      method: "POST",
      url: "/v1/alerts/alert_recovery_low/ack",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("acked");
    await app.close();
  });

  it("supports session + ingest + sync-status flow", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-api-"));
    const { app } = await createApi({ dbPath: path.join(dir, "test.sqlite"), now: new Date("2026-03-19T08:00:00.000Z") });

    const session = await app.inject({
      method: "POST",
      url: "/v1/users/user_ada/connect/apple-health/session",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });
    expect(session.statusCode).toBe(200);
    expect(typeof session.json().sessionId).toBe("string");
    expect(session.json().connectionMethod).toBe("sdk-ingest");
    expect(session.json().connectionMode).toBe("mobile_permission");
    const sessionToken = session.json().sessionToken;

    const sourceFilter = await app.inject({
      method: "PUT",
      url: "/v1/users/user_ada/source-filters",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      },
      payload: {
        providerId: "apple-health",
        ignoredSources: ["com.whoop.mobile"]
      }
    });
    expect(sourceFilter.statusCode).toBe(200);

    const sourcePrecedence = await app.inject({
      method: "PUT",
      url: "/v1/users/user_ada/source-precedence",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      },
      payload: {
        precedence: {
          direct: 5,
          mirrored: 4,
          imported: 2,
          manual: 1
        }
      }
    });
    expect(sourcePrecedence.statusCode).toBe(200);

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/users/user_ada/ingest/apple-health",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      },
      payload: {
        sessionToken,
        idempotencyKey: "ingest-1",
        anchorBefore: "anchor-a",
        anchorAfter: "anchor-b",
        records: [
          {
            id: "record-1",
            sourceRecordId: "mirror:whoop-steps-1",
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
      }
    });

    expect(ingest.statusCode).toBe(200);
    expect(ingest.json().processedRecords).toBe(0);
    expect(ingest.json().droppedRecords).toBe(1);
    expect(ingest.json().dropReasons).toEqual([{ reason: "ignored_source_filter", count: 1 }]);

    const syncStatus = await app.inject({
      method: "GET",
      url: "/v1/users/user_ada/sync-status",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });
    expect(syncStatus.statusCode).toBe(200);
    const appleStatus = (syncStatus.json().sources as Array<Record<string, unknown>>).find((row) => row.providerId === "apple-health");
    expect(appleStatus).toBeDefined();
    expect(typeof appleStatus?.lastSuccessfulSyncAt === "string" || appleStatus?.lastSuccessfulSyncAt === null).toBe(true);
    expect(typeof appleStatus?.pendingIngestBatches).toBe("number");
    expect(["ok", "stale", "missing"]).toContain(String(appleStatus?.dataQualityGate));
    expect(appleStatus?.lastIngestBatchId).toBe(ingest.json().batchId);
    expect(typeof appleStatus?.lastIngestAt).toBe("string");
    expect(appleStatus?.lastIngestRecordCount).toBe(0);
    expect(appleStatus?.lastAcceptedRecordCount).toBe(0);
    expect(appleStatus?.lastDroppedRecordCount).toBe(1);
    expect(appleStatus?.lastDropReasons).toEqual([{ reason: "ignored_source_filter", count: 1 }]);
    expect(appleStatus?.activeSessionExpiresAt).toBeNull();

    await app.close();
  });

  it("rejects mirrored Apple ingest records without bundleId", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-api-"));
    const { app } = await createApi({ dbPath: path.join(dir, "test.sqlite"), now: new Date("2026-03-19T08:00:00.000Z") });

    const session = await app.inject({
      method: "POST",
      url: "/v1/users/user_ada/connect/apple-health/session",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });
    const sessionToken = session.json().sessionToken;

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/users/user_ada/ingest/apple-health",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      },
      payload: {
        sessionToken,
        idempotencyKey: "ingest-missing-bundle",
        records: [
          {
            id: "record-missing-bundle",
            sourceRecordId: "mirror:whoop-steps-missing-bundle",
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
            confidence: 0.8
          }
        ]
      }
    });
    expect(ingest.statusCode).toBe(400);

    await app.close();
  });

  it("enforces user isolation by token", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-api-"));
    const { app } = await createApi({ dbPath: path.join(dir, "test.sqlite"), now: new Date("2026-03-19T08:00:00.000Z") });

    const response = await app.inject({
      method: "GET",
      url: "/v1/connectors?userId=user_ada",
      headers: {
        authorization: `Bearer ${OTHER_USER_TOKEN}`
      }
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("supports append-only outbox cursor", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-api-"));
    const { app } = await createApi({ dbPath: path.join(dir, "test.sqlite"), now: new Date("2026-03-19T08:00:00.000Z") });

    const first = await app.inject({
      method: "GET",
      url: "/v1/experimental/outbox/events?userId=user_ada&after=0&limit=50",
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });

    expect(first.statusCode).toBe(200);
    const firstEvents = first.json() as Array<{ sequence: number }>;
    expect(firstEvents.length).toBeGreaterThan(0);
    const latestSequence = firstEvents[firstEvents.length - 1]?.sequence ?? 0;

    const second = await app.inject({
      method: "GET",
      url: `/v1/experimental/outbox/events?userId=user_ada&after=${latestSequence}&limit=50`,
      headers: {
        authorization: `Bearer ${DERIVED_TOKEN}`
      }
    });

    expect(second.statusCode).toBe(200);
    expect((second.json() as unknown[]).length).toBe(0);
    await app.close();
  });

  it("bootstraps live mode and returns usable tokens", async () => {
    const { app } = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });

    const bootstrap = await app.inject({
      method: "POST",
      url: "/v1/live/bootstrap",
      headers: {
        "x-openvitals-admin": "openvitals-dev-admin"
      },
      payload: {
        userId: "user_live",
        name: "Live User",
        timezone: "Asia/Shanghai",
        createTokens: true
      }
    });
    expect(bootstrap.statusCode).toBe(200);
    const tokens = bootstrap.json().tokens as Array<{ label: string; token: string }>;
    const derived = tokens.find((token) => token.label === "derived");
    expect(derived?.token).toBeDefined();

    const connectors = await app.inject({
      method: "GET",
      url: "/v1/connectors?userId=user_live",
      headers: {
        authorization: `Bearer ${derived?.token ?? ""}`
      }
    });
    expect(connectors.statusCode).toBe(200);
    expect(connectors.json().runtimeMode).toBe("live");

    const household = await app.inject({
      method: "POST",
      url: "/v1/household/bootstrap",
      headers: {
        "x-openvitals-admin": "openvitals-dev-admin"
      },
      payload: {
        owner: { userId: "owner_live", name: "Owner", timezone: "Asia/Shanghai" },
        family: [{ userId: "kid_live", name: "Kid", timezone: "Asia/Shanghai" }],
        createTokens: true
      }
    });
    expect(household.statusCode).toBe(200);
    expect(household.json().profiles).toHaveLength(2);

    const ownerFull = household
      .json()
      .profiles.find((profile: { userId: string; tokens: Array<{ label: string; token: string }> }) => profile.userId === "owner_live")
      ?.tokens.find((token: { label: string; token: string }) => token.label === "full")?.token;
    expect(ownerFull).toBeDefined();
    const kidFull = household
      .json()
      .profiles.find((profile: { userId: string; tokens: Array<{ label: string; token: string }> }) => profile.userId === "kid_live")
      ?.tokens.find((token: { label: string; token: string }) => token.label === "full")?.token;
    expect(kidFull).toBeDefined();

    const usersList = await app.inject({
      method: "GET",
      url: "/v1/users",
      headers: {
        authorization: `Bearer ${ownerFull ?? ""}`
      }
    });
    expect(usersList.statusCode).toBe(200);
    expect((usersList.json().profiles as Array<{ id: string }>).map((profile) => profile.id)).toEqual(
      expect.arrayContaining(["owner_live", "kid_live"])
    );

    const ownerSyncStatus = await app.inject({
      method: "GET",
      url: "/v1/users/owner_live/sync-status",
      headers: {
        authorization: `Bearer ${ownerFull ?? ""}`
      }
    });
    expect(ownerSyncStatus.statusCode).toBe(200);
    const dataModes = Object.fromEntries(
      (ownerSyncStatus.json().sources as Array<{ providerId: string; dataMode: string }>).map((entry) => [entry.providerId, entry.dataMode])
    );
    expect(dataModes.whoop).toBe("live");
    expect(dataModes.oura).toBe("live");

    const kidUsersList = await app.inject({
      method: "GET",
      url: "/v1/users",
      headers: {
        authorization: `Bearer ${kidFull ?? ""}`
      }
    });
    expect(kidUsersList.statusCode).toBe(200);
    expect((kidUsersList.json().profiles as Array<{ id: string }>).map((profile) => profile.id)).toEqual(["kid_live"]);
    await app.close();
  });

  it("supports connect start/callback flow with persisted WHOOP credentials", async () => {
    const originalClientId = process.env.OPENVITALS_WHOOP_CLIENT_ID;
    const originalClientSecret = process.env.OPENVITALS_WHOOP_CLIENT_SECRET;
    const originalRedirectUri = process.env.OPENVITALS_WHOOP_REDIRECT_URI;
    process.env.OPENVITALS_WHOOP_CLIENT_ID = "whoop-client";
    process.env.OPENVITALS_WHOOP_CLIENT_SECRET = "whoop-secret";
    process.env.OPENVITALS_WHOOP_REDIRECT_URI = "http://127.0.0.1:3000/v1/connect/callback/whoop";
    const { app } = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });

    const bootstrap = await app.inject({
      method: "POST",
      url: "/v1/live/bootstrap",
      headers: {
        "x-openvitals-admin": "openvitals-dev-admin"
      },
      payload: {
        userId: "user_connect",
        name: "Connect User",
        timezone: "Asia/Shanghai",
        createTokens: true
      }
    });
    const derived = (bootstrap.json().tokens as Array<{ label: string; token: string }>).find((token) => token.label === "derived")?.token;
    expect(derived).toBeDefined();

    const start = await app.inject({
      method: "POST",
      url: "/v1/users/user_connect/connect/whoop/start",
      headers: {
        authorization: `Bearer ${derived ?? ""}`
      }
    });
    expect(start.statusCode).toBe(200);
    const sessionId = start.json().sessionId;
    const oauthState = start.json().state;
    expect(typeof sessionId).toBe("string");
    expect(start.json().connectionMethod).toBe("oauth");

    const callback = await app.inject({
      method: "POST",
      url: "/v1/users/user_connect/connect/whoop/callback",
      headers: {
        authorization: `Bearer ${derived ?? ""}`
      },
      payload: {
        sessionId,
        state: oauthState,
        accessToken: "whoop-access-test-token",
        refreshToken: "whoop-refresh-test-token",
        expiresAt: "2026-03-20T08:00:00.000Z",
        externalUserId: "whoop-user-123",
        scopes: ["read:sleep", "read:recovery", "read:workout"]
      }
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json().connected).toBe(true);
    expect(callback.json().credential.connectionMethod).toBe("oauth");
    expect(callback.json().credential.authState).toBe("connected");

    const syncStatus = await app.inject({
      method: "GET",
      url: "/v1/users/user_connect/sync-status",
      headers: {
        authorization: `Bearer ${derived ?? ""}`
      }
    });
    expect(syncStatus.statusCode).toBe(200);
    const whoop = (syncStatus.json().sources as Array<{ providerId: string; authState: string; connectionMethod: string }>).find(
      (entry) => entry.providerId === "whoop"
    );
    expect(whoop?.authState).toBe("connected");
    expect(whoop?.connectionMethod).toBe("oauth");

    const connectors = await app.inject({
      method: "GET",
      url: "/v1/connectors?userId=user_connect",
      headers: {
        authorization: `Bearer ${derived ?? ""}`
      }
    });
    expect(connectors.statusCode).toBe(200);
    const whoopConnector = (connectors.json().sourceAccounts as Array<{ providerId: string; authState: string; connectionMethod: string }>).find(
      (entry) => entry.providerId === "whoop"
    );
    expect(whoopConnector?.authState).toBe("connected");
    expect(whoopConnector?.connectionMethod).toBe("oauth");
    await app.close();
    if (originalClientId === undefined) {
      delete process.env.OPENVITALS_WHOOP_CLIENT_ID;
    } else {
      process.env.OPENVITALS_WHOOP_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.OPENVITALS_WHOOP_CLIENT_SECRET;
    } else {
      process.env.OPENVITALS_WHOOP_CLIENT_SECRET = originalClientSecret;
    }
    if (originalRedirectUri === undefined) {
      delete process.env.OPENVITALS_WHOOP_REDIRECT_URI;
    } else {
      process.env.OPENVITALS_WHOOP_REDIRECT_URI = originalRedirectUri;
    }
  });

  it("accepts the WHOOP browser redirect callback route", async () => {
    const originalClientId = process.env.OPENVITALS_WHOOP_CLIENT_ID;
    const originalClientSecret = process.env.OPENVITALS_WHOOP_CLIENT_SECRET;
    const originalRedirectUri = process.env.OPENVITALS_WHOOP_REDIRECT_URI;
    const originalFetch = globalThis.fetch;
    process.env.OPENVITALS_WHOOP_CLIENT_ID = "whoop-client";
    process.env.OPENVITALS_WHOOP_CLIENT_SECRET = "whoop-secret";
    process.env.OPENVITALS_WHOOP_REDIRECT_URI = "http://127.0.0.1:3000/v1/connect/callback/whoop";
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "whoop-access-browser",
          refresh_token: "whoop-refresh-browser",
          expires_in: 3600,
          scope: "read:sleep read:recovery read:workout"
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;
    const { app } = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });

    try {
      const bootstrap = await app.inject({
        method: "POST",
        url: "/v1/live/bootstrap",
        headers: {
          "x-openvitals-admin": "openvitals-dev-admin"
        },
        payload: {
          userId: "user_browser_callback",
          name: "Browser Callback User",
          timezone: "Asia/Shanghai",
          createTokens: true
        }
      });
      const derived = (bootstrap.json().tokens as Array<{ label: string; token: string }>).find((token) => token.label === "derived")?.token;
      expect(derived).toBeDefined();

      const start = await app.inject({
        method: "POST",
        url: "/v1/users/user_browser_callback/connect/whoop/start",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      expect(start.statusCode).toBe(200);

      const redirect = await app.inject({
        method: "GET",
        url: `/v1/connect/callback/whoop?state=${encodeURIComponent(start.json().state)}&code=whoop-browser-code`
      });
      expect(redirect.statusCode).toBe(200);
      expect(redirect.json().connected).toBe(true);
      expect(redirect.json().credential.connectionMethod).toBe("oauth");

      const syncStatus = await app.inject({
        method: "GET",
        url: "/v1/users/user_browser_callback/sync-status",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const whoop = (syncStatus.json().sources as Array<{ providerId: string; authState: string }>).find((entry) => entry.providerId === "whoop");
      expect(whoop?.authState).toBe("connected");
    } finally {
      await app.close();
      globalThis.fetch = originalFetch;
      if (originalClientId === undefined) {
        delete process.env.OPENVITALS_WHOOP_CLIENT_ID;
      } else {
        process.env.OPENVITALS_WHOOP_CLIENT_ID = originalClientId;
      }
      if (originalClientSecret === undefined) {
        delete process.env.OPENVITALS_WHOOP_CLIENT_SECRET;
      } else {
        process.env.OPENVITALS_WHOOP_CLIENT_SECRET = originalClientSecret;
      }
      if (originalRedirectUri === undefined) {
        delete process.env.OPENVITALS_WHOOP_REDIRECT_URI;
      } else {
        process.env.OPENVITALS_WHOOP_REDIRECT_URI = originalRedirectUri;
      }
    }
  });

  it("accepts the Oura browser redirect callback route", async () => {
    const originalClientId = process.env.OPENVITALS_OURA_CLIENT_ID;
    const originalClientSecret = process.env.OPENVITALS_OURA_CLIENT_SECRET;
    const originalRedirectUri = process.env.OPENVITALS_OURA_REDIRECT_URI;
    const originalScope = process.env.OPENVITALS_OURA_SCOPE;
    const originalFetch = globalThis.fetch;
    process.env.OPENVITALS_OURA_CLIENT_ID = "oura-client";
    process.env.OPENVITALS_OURA_CLIENT_SECRET = "oura-secret";
    process.env.OPENVITALS_OURA_REDIRECT_URI = "http://localhost:3000/v1/connect/callback/oura";
    process.env.OPENVITALS_OURA_SCOPE = "personal daily heartrate workout spo2";
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "oura-access-browser",
          refresh_token: "oura-refresh-browser",
          expires_in: 3600,
          scope: "personal daily heartrate workout spo2"
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;
    const { app } = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });

    try {
      const bootstrap = await app.inject({
        method: "POST",
        url: "/v1/live/bootstrap",
        headers: {
          "x-openvitals-admin": "openvitals-dev-admin"
        },
        payload: {
          userId: "user_oura_browser_callback",
          name: "Oura Browser Callback User",
          timezone: "Asia/Shanghai",
          providers: ["oura"],
          createTokens: true
        }
      });
      const derived = (bootstrap.json().tokens as Array<{ label: string; token: string }>).find((token) => token.label === "derived")?.token;
      expect(derived).toBeDefined();

      const start = await app.inject({
        method: "POST",
        url: "/v1/users/user_oura_browser_callback/connect/oura/start",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      expect(start.statusCode).toBe(200);
      expect(start.json().connectionMethod).toBe("oauth");
      const authorizeUrl = new URL(start.json().connectUrl);
      expect(authorizeUrl.host).toBe("cloud.ouraring.com");
      expect(authorizeUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3000/v1/connect/callback/oura");
      expect(authorizeUrl.searchParams.get("scope")).toContain("heartrate");

      const redirect = await app.inject({
        method: "GET",
        url: `/v1/connect/callback/oura?state=${encodeURIComponent(start.json().state)}&code=oura-browser-code`
      });
      expect(redirect.statusCode).toBe(200);
      expect(redirect.json().connected).toBe(true);
      expect(redirect.json().credential.providerId).toBe("oura");
      expect(redirect.json().credential.connectionMethod).toBe("oauth");

      const syncStatus = await app.inject({
        method: "GET",
        url: "/v1/users/user_oura_browser_callback/sync-status",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const oura = (syncStatus.json().sources as Array<{ providerId: string; authState: string; connectionMethod: string }>).find(
        (entry) => entry.providerId === "oura"
      );
      expect(oura?.authState).toBe("connected");
      expect(oura?.connectionMethod).toBe("oauth");
    } finally {
      await app.close();
      globalThis.fetch = originalFetch;
      if (originalClientId === undefined) {
        delete process.env.OPENVITALS_OURA_CLIENT_ID;
      } else {
        process.env.OPENVITALS_OURA_CLIENT_ID = originalClientId;
      }
      if (originalClientSecret === undefined) {
        delete process.env.OPENVITALS_OURA_CLIENT_SECRET;
      } else {
        process.env.OPENVITALS_OURA_CLIENT_SECRET = originalClientSecret;
      }
      if (originalRedirectUri === undefined) {
        delete process.env.OPENVITALS_OURA_REDIRECT_URI;
      } else {
        process.env.OPENVITALS_OURA_REDIRECT_URI = originalRedirectUri;
      }
      if (originalScope === undefined) {
        delete process.env.OPENVITALS_OURA_SCOPE;
      } else {
        process.env.OPENVITALS_OURA_SCOPE = originalScope;
      }
    }
  });

  it("accepts WHOOP webhook route and triggers incremental sync", async () => {
    const { app } = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });

    await app.inject({
      method: "POST",
      url: "/v1/live/bootstrap",
      headers: {
        "x-openvitals-admin": "openvitals-dev-admin"
      },
      payload: {
        userId: "user_webhook",
        name: "Webhook User",
        timezone: "Asia/Shanghai",
        createTokens: true
      }
    });

    const webhook = await app.inject({
      method: "POST",
      url: "/v1/users/user_webhook/providers/whoop/webhook",
      headers: {
        "x-openvitals-admin": "openvitals-dev-admin"
      },
      payload: {
        type: "whoop.recovery.updated",
        eventId: "evt-whoop-1"
      }
    });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json().providerId).toBe("whoop");
    expect(Array.isArray(webhook.json().syncedProviderIds)).toBe(true);

    await app.close();
  });

  it("exposes experimental scheduler endpoints and records non-dry runs", async () => {
    const originalSchedulerEnabled = process.env.OPENVITALS_SCHEDULER_ENABLED;
    process.env.OPENVITALS_SCHEDULER_ENABLED = "false";
    const api = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });
    try {
      const { app } = api;
      const bootstrap = await app.inject({
        method: "POST",
        url: "/v1/live/bootstrap",
        headers: {
          "x-openvitals-admin": "openvitals-dev-admin"
        },
        payload: {
          userId: "user_sched",
          name: "Scheduler User",
          timezone: "Asia/Shanghai",
          createTokens: true
        }
      });
      const derived = (bootstrap.json().tokens as Array<{ label: string; token: string }>).find((token) => token.label === "derived")?.token;
      expect(derived).toBeDefined();

      const status = await app.inject({
        method: "GET",
        url: "/v1/experimental/scheduler/status?userId=user_sched",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      expect(status.statusCode).toBe(200);
      expect(status.json().enabled).toBe(false);
      expect(status.json().leader).toBe(true);

      const dryRun = await app.inject({
        method: "POST",
        url: "/v1/experimental/scheduler/run",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          userId: "user_sched",
          job: "all",
          dryRun: true
        }
      });
      expect(dryRun.statusCode).toBe(200);
      expect((dryRun.json().runs as unknown[]).length).toBe(4);

      const persistedRun = await app.inject({
        method: "POST",
        url: "/v1/experimental/scheduler/run",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          userId: "user_sched",
          job: "tick",
          dryRun: false
        }
      });
      expect(persistedRun.statusCode).toBe(200);
      expect((persistedRun.json().runs as Array<{ status: string }>)[0]?.status).toBe("succeeded");

      const runs = await app.inject({
        method: "GET",
        url: "/v1/experimental/scheduler/runs?userId=user_sched&limit=20",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      expect(runs.statusCode).toBe(200);
      expect((runs.json() as unknown[]).length).toBeGreaterThan(0);
    } finally {
      await api.app.close();
      if (originalSchedulerEnabled === undefined) {
        delete process.env.OPENVITALS_SCHEDULER_ENABLED;
      } else {
        process.env.OPENVITALS_SCHEDULER_ENABLED = originalSchedulerEnabled;
      }
    }
  });

  it("dedupes daily scheduler emissions by runKey + payload hash", async () => {
    const originalSchedulerEnabled = process.env.OPENVITALS_SCHEDULER_ENABLED;
    process.env.OPENVITALS_SCHEDULER_ENABLED = "false";
    const api = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });
    try {
      const { app } = api;
      const bootstrap = await app.inject({
        method: "POST",
        url: "/v1/live/bootstrap",
        headers: {
          "x-openvitals-admin": "openvitals-dev-admin"
        },
        payload: {
          userId: "user_daily_dedupe",
          name: "Daily Dedupe User",
          timezone: "Asia/Shanghai",
          createTokens: true
        }
      });
      const derived = (bootstrap.json().tokens as Array<{ label: string; token: string }>).find((token) => token.label === "derived")?.token;
      expect(derived).toBeDefined();

      const baseline = await app.inject({
        method: "GET",
        url: "/v1/experimental/outbox/events?userId=user_daily_dedupe&after=0&limit=1000",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const baselineEvents = baseline.json() as Array<{ sequence: number }>;
      const baselineSequence = baselineEvents.length > 0 ? baselineEvents[baselineEvents.length - 1]!.sequence : 0;

      const firstRun = await app.inject({
        method: "POST",
        url: "/v1/experimental/scheduler/run",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          userId: "user_daily_dedupe",
          job: "daily",
          dryRun: false
        }
      });
      expect(firstRun.statusCode).toBe(200);

      const afterFirst = await app.inject({
        method: "GET",
        url: `/v1/experimental/outbox/events?userId=user_daily_dedupe&after=${baselineSequence}&limit=1000`,
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const firstEvents = afterFirst.json() as Array<{ sequence: number; type: string }>;
      const firstDaily = firstEvents.filter((event) => event.type === "health.brief.daily.ready");
      expect(firstDaily.length).toBe(1);
      const latestAfterFirst = firstEvents.length > 0 ? firstEvents[firstEvents.length - 1]!.sequence : baselineSequence;

      const secondRun = await app.inject({
        method: "POST",
        url: "/v1/experimental/scheduler/run",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          userId: "user_daily_dedupe",
          job: "daily",
          dryRun: false
        }
      });
      expect(secondRun.statusCode).toBe(200);

      const afterSecond = await app.inject({
        method: "GET",
        url: `/v1/experimental/outbox/events?userId=user_daily_dedupe&after=${latestAfterFirst}&limit=1000`,
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const secondEvents = afterSecond.json() as Array<{ type: string }>;
      expect(secondEvents.filter((event) => event.type === "health.brief.daily.ready")).toHaveLength(0);
    } finally {
      await api.app.close();
      if (originalSchedulerEnabled === undefined) {
        delete process.env.OPENVITALS_SCHEDULER_ENABLED;
      } else {
        process.env.OPENVITALS_SCHEDULER_ENABLED = originalSchedulerEnabled;
      }
    }
  });

  it("keeps scheduler tick resilient when WHOOP live credentials are missing", async () => {
    const originalSchedulerEnabled = process.env.OPENVITALS_SCHEDULER_ENABLED;
    const originalWhoopAccessToken = process.env.OPENVITALS_WHOOP_ACCESS_TOKEN;
    const originalWhoopBridgeUrl = process.env.OPENVITALS_WHOOP_BRIDGE_URL;
    process.env.OPENVITALS_SCHEDULER_ENABLED = "false";
    delete process.env.OPENVITALS_WHOOP_ACCESS_TOKEN;
    delete process.env.OPENVITALS_WHOOP_BRIDGE_URL;

    const api = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });
    try {
      const { app } = api;
      const bootstrap = await app.inject({
        method: "POST",
        url: "/v1/live/bootstrap",
        headers: {
          "x-openvitals-admin": "openvitals-dev-admin"
        },
        payload: {
          userId: "user_whoop_missing",
          name: "Whoop Missing User",
          timezone: "Asia/Shanghai",
          createTokens: true
        }
      });
      const derived = (bootstrap.json().tokens as Array<{ label: string; token: string }>).find((token) => token.label === "derived")?.token;
      expect(derived).toBeDefined();

      const run = await app.inject({
        method: "POST",
        url: "/v1/experimental/scheduler/run",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          userId: "user_whoop_missing",
          job: "tick",
          dryRun: false
        }
      });
      expect(run.statusCode).toBe(200);
      expect((run.json().runs as Array<{ status: string }>)[0]?.status).toBe("succeeded");

      const syncStatus = await app.inject({
        method: "GET",
        url: "/v1/users/user_whoop_missing/sync-status",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      expect(syncStatus.statusCode).toBe(200);
      const whoop = (syncStatus.json().sources as Array<{ providerId: string; dataQualityGate: string }>).find((row) => row.providerId === "whoop");
      expect(whoop).toBeDefined();
      expect(whoop?.dataQualityGate).not.toBe("ok");

      const failures = await app.inject({
        method: "GET",
        url: "/v1/experimental/ingest-failures?userId=user_whoop_missing&providerId=whoop&status=failed",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      expect(failures.statusCode).toBe(200);
      expect((failures.json() as unknown[]).length).toBeGreaterThan(0);
    } finally {
      await api.app.close();
      if (originalSchedulerEnabled === undefined) {
        delete process.env.OPENVITALS_SCHEDULER_ENABLED;
      } else {
        process.env.OPENVITALS_SCHEDULER_ENABLED = originalSchedulerEnabled;
      }
      if (originalWhoopAccessToken === undefined) {
        delete process.env.OPENVITALS_WHOOP_ACCESS_TOKEN;
      } else {
        process.env.OPENVITALS_WHOOP_ACCESS_TOKEN = originalWhoopAccessToken;
      }
      if (originalWhoopBridgeUrl === undefined) {
        delete process.env.OPENVITALS_WHOOP_BRIDGE_URL;
      } else {
        process.env.OPENVITALS_WHOOP_BRIDGE_URL = originalWhoopBridgeUrl;
      }
    }
  });

  it("emits stale alerts only on transition or stale-source-set changes", async () => {
    const originalSchedulerEnabled = process.env.OPENVITALS_SCHEDULER_ENABLED;
    process.env.OPENVITALS_SCHEDULER_ENABLED = "false";
    const api = await createApi({
      dbPath: ":memory:",
      mode: "live",
      now: new Date("2026-03-19T08:00:00.000Z")
    });
    try {
      const { app } = api;
      const bootstrap = await app.inject({
        method: "POST",
        url: "/v1/live/bootstrap",
        headers: {
          "x-openvitals-admin": "openvitals-dev-admin"
        },
        payload: {
          userId: "user_stale_transition",
          name: "Stale Transition User",
          timezone: "Asia/Shanghai",
          createTokens: true
        }
      });
      const derived = (bootstrap.json().tokens as Array<{ label: string; token: string }>).find((token) => token.label === "derived")?.token;
      expect(derived).toBeDefined();

      const baseline = await app.inject({
        method: "GET",
        url: "/v1/experimental/outbox/events?userId=user_stale_transition&after=0&limit=1000",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const baselineEvents = baseline.json() as Array<{ sequence: number }>;
      const baselineSequence = baselineEvents.length > 0 ? baselineEvents[baselineEvents.length - 1]!.sequence : 0;

      const firstStale = await app.inject({
        method: "POST",
        url: "/v1/experimental/scheduler/run",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          userId: "user_stale_transition",
          job: "stale",
          dryRun: false
        }
      });
      expect(firstStale.statusCode).toBe(200);

      const afterFirst = await app.inject({
        method: "GET",
        url: `/v1/experimental/outbox/events?userId=user_stale_transition&after=${baselineSequence}&limit=1000`,
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const firstEvents = afterFirst.json() as Array<{ sequence: number; type: string }>;
      expect(firstEvents.filter((event) => event.type === "health.sync.stale")).toHaveLength(1);
      const latestAfterFirst = firstEvents.length > 0 ? firstEvents[firstEvents.length - 1]!.sequence : baselineSequence;

      const secondStale = await app.inject({
        method: "POST",
        url: "/v1/experimental/scheduler/run",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          userId: "user_stale_transition",
          job: "stale",
          dryRun: false
        }
      });
      expect(secondStale.statusCode).toBe(200);

      const afterSecond = await app.inject({
        method: "GET",
        url: `/v1/experimental/outbox/events?userId=user_stale_transition&after=${latestAfterFirst}&limit=1000`,
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const secondEvents = afterSecond.json() as Array<{ sequence: number; type: string }>;
      expect(secondEvents.filter((event) => event.type === "health.sync.stale")).toHaveLength(0);
      const latestAfterSecond = secondEvents.length > 0 ? secondEvents[secondEvents.length - 1]!.sequence : latestAfterFirst;

      const session = await app.inject({
        method: "POST",
        url: "/v1/users/user_stale_transition/connect/apple-health/session",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      expect(session.statusCode).toBe(200);

      const ingest = await app.inject({
        method: "POST",
        url: "/v1/users/user_stale_transition/ingest/apple-health",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          sessionToken: session.json().sessionToken,
          idempotencyKey: "stale-transition-apple-refresh",
          anchorBefore: "anchor-before",
          anchorAfter: "anchor-after",
          records: [
            {
              id: "stale-transition-rec-1",
              sourceRecordId: "healthkit:steps:stale-transition",
              metricFamily: "activity",
              kind: "observation",
              metric: "steps",
              value: 3200,
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
        }
      });
      expect(ingest.statusCode).toBe(200);

      const thirdStale = await app.inject({
        method: "POST",
        url: "/v1/experimental/scheduler/run",
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        },
        payload: {
          userId: "user_stale_transition",
          job: "stale",
          dryRun: false
        }
      });
      expect(thirdStale.statusCode).toBe(200);

      const afterThird = await app.inject({
        method: "GET",
        url: `/v1/experimental/outbox/events?userId=user_stale_transition&after=${latestAfterSecond}&limit=1000`,
        headers: {
          authorization: `Bearer ${derived ?? ""}`
        }
      });
      const thirdEvents = afterThird.json() as Array<{ type: string }>;
      expect(thirdEvents.filter((event) => event.type === "health.sync.stale")).toHaveLength(1);
    } finally {
      await api.app.close();
      if (originalSchedulerEnabled === undefined) {
        delete process.env.OPENVITALS_SCHEDULER_ENABLED;
      } else {
        process.env.OPENVITALS_SCHEDULER_ENABLED = originalSchedulerEnabled;
      }
    }
  });

  it("sends only HMAC webhook signature header (no plaintext secret header)", async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls: Array<{ headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (_input: unknown, init?: { headers?: unknown }) => {
      fetchCalls.push({
        headers: (init?.headers ?? {}) as Record<string, string>
      });
      return { ok: true, status: 200 } as never;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openvitals-api-"));
    const api = await createApi({ dbPath: path.join(dir, "test.sqlite"), now: new Date("2026-03-19T08:00:00.000Z") });
    try {
      const { app } = api;
      const webhook = await app.inject({
        method: "POST",
        url: "/v1/webhooks",
        headers: {
          authorization: `Bearer ${DERIVED_TOKEN}`
        },
        payload: {
          url: "https://example.com/webhook",
          eventTypes: ["health.sync.completed"],
          status: "active"
        }
      });
      expect(webhook.statusCode).toBe(200);

      const sync = await app.inject({
        method: "POST",
        url: "/v1/users/user_ada/sync",
        headers: {
          authorization: `Bearer ${DERIVED_TOKEN}`
        },
        payload: {
          mode: "incremental"
        }
      });
      expect(sync.statusCode).toBe(200);
      expect(fetchCalls.length).toBeGreaterThan(0);

      const firstHeaders = fetchCalls[0]?.headers ?? {};
      expect(typeof firstHeaders["x-openvitals-signature-v1"]).toBe("string");
      expect(firstHeaders["x-openvitals-signature"]).toBeUndefined();
    } finally {
      await api.app.close();
      globalThis.fetch = originalFetch;
    }
  });
});
