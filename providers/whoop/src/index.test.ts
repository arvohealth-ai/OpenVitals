import { loadWhoopPayloadFromCredential, refreshWhoopCredential } from "./live.js";
import { buildDemoState } from "@openvitals/runtime";
import { assertProviderContract } from "../../_test/contract.js";
import { collector, manifest } from "./index.js";

assertProviderContract({
  expectedProviderId: "whoop",
  manifest,
  collector
});

describe("whoop live collector", () => {
  const originalToken = process.env.OPENVITALS_WHOOP_ACCESS_TOKEN;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.OPENVITALS_WHOOP_ACCESS_TOKEN;
    } else {
      process.env.OPENVITALS_WHOOP_ACCESS_TOKEN = originalToken;
    }
  });

  it("reports provider-mediated API mode when access token is present", async () => {
    process.env.OPENVITALS_WHOOP_ACCESS_TOKEN = "test-token";
    expect(manifest.capabilities).toContain("provider_mediated_sync");
    expect(manifest.capabilities).not.toContain("subscribe_updates");
    const status = await collector.healthcheck();
    expect(status.ok).toBe(true);
    expect(status.message.toLowerCase()).toContain("env-token");
    expect(status.message.toLowerCase()).toContain("provider-mediated");
  });

  it("normalizes representative WHOOP sleep, recovery, and workout summaries", async () => {
    const state = buildDemoState(new Date("2026-03-19T08:00:00.000Z"));
    const sourceAccount = state.sourceAccounts.find((row) => row.providerId === "whoop");
    expect(sourceAccount).toBeDefined();
    if (!sourceAccount) {
      return;
    }

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/activity/sleep")) {
        return new Response(
          JSON.stringify({
            records: [
              {
                id: "sleep-1",
                start: "2026-03-18T22:00:00.000Z",
                end: "2026-03-19T06:30:00.000Z",
                duration_hours: 8.5
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.pathname.endsWith("/recovery")) {
        return new Response(
          JSON.stringify({
            records: [
              {
                id: "recovery-1",
                timestamp: "2026-03-19T07:00:00.000Z",
                score: {
                  hrv_rmssd: 62,
                  resting_heart_rate: 48
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url.pathname.endsWith("/activity/workout")) {
        return new Response(
          JSON.stringify({
            records: [
              {
                id: "workout-1",
                start: "2026-03-18T12:00:00.000Z",
                end: "2026-03-18T13:00:00.000Z",
                strain: 12.4,
                average_heart_rate: 142,
                max_heart_rate: 178,
                zone_duration: {
                  zone_three_milli: 900000,
                  zone_four_milli: 600000
                }
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const payload = await loadWhoopPayloadFromCredential({
      context: {
        user: state.user,
        sourceAccount,
        lastAnchor: null,
        mode: "incremental"
      },
      credential: {
        id: "provider_credential_whoop_user_ada",
        userId: state.user.id,
        providerId: "whoop",
        authState: "connected",
        connectionMethod: "oauth",
        accessToken: "whoop-access",
        refreshToken: "whoop-refresh",
        expiresAt: null,
        scopes: ["read:sleep", "read:recovery", "read:workout"],
        externalUserId: "whoop-user-123",
        lastRefreshAt: null,
        lastRefreshError: null,
        createdAt: "2026-03-19T08:00:00.000Z",
        updatedAt: "2026-03-19T08:00:00.000Z"
      },
      mode: "incremental"
    });

    expect(payload.episodes.some((episode) => episode.episodeType === "sleep")).toBe(true);
    const workout = payload.episodes.find((episode) => episode.episodeType === "workout");
    expect(workout?.metrics?.average_heart_rate).toBe(142);
    expect(workout?.metrics?.max_heart_rate).toBe(178);
    expect(workout?.metrics?.zone_three_minutes).toBe(15);
    expect(payload.observations.some((observation) => observation.metric === "hrv_rmssd")).toBe(true);
    expect(payload.observations.some((observation) => observation.metric === "resting_heart_rate")).toBe(true);
  });


  it("refreshes persisted WHOOP credentials", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          access_token: "whoop-access-refreshed",
          refresh_token: "whoop-refresh-refreshed",
          expires_in: 3600,
          scope: "read:sleep read:recovery"
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const refreshed = await refreshWhoopCredential({
      id: "provider_credential_whoop_user_ada",
      userId: "user_ada",
      providerId: "whoop",
      authState: "expired",
      connectionMethod: "oauth",
      accessToken: "whoop-access-old",
      refreshToken: "whoop-refresh-old",
      expiresAt: "2026-03-20T08:00:00.000Z",
      scopes: ["read:sleep"],
      externalUserId: "whoop-user-123",
      lastRefreshAt: null,
      lastRefreshError: "token expired",
      createdAt: "2026-03-19T08:00:00.000Z",
      updatedAt: "2026-03-19T08:00:00.000Z"
    });

    expect(refreshed.accessToken).toBe("whoop-access-refreshed");
    expect(refreshed.refreshToken).toBe("whoop-refresh-refreshed");
    expect(refreshed.authState).toBe("connected");
    expect(refreshed.scopes).toEqual(["read:sleep", "read:recovery"]);
    expect(refreshed.lastRefreshError).toBeNull();
    expect(typeof refreshed.lastRefreshAt).toBe("string");
  });
});
