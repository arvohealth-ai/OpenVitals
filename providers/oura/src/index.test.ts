import { buildDemoState } from "@openvitals/runtime";
import { assertProviderContract } from "../../_test/contract.js";
import { collector, liveCollector, liveManifest, manifest } from "./index.js";
import { loadOuraPayloadFromCredential } from "./live.js";

assertProviderContract({
  expectedProviderId: "oura",
  manifest,
  collector
});

describe("oura live collector", () => {
  const originalToken = process.env.OPENVITALS_OURA_ACCESS_TOKEN;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.OPENVITALS_OURA_ACCESS_TOKEN;
    } else {
      process.env.OPENVITALS_OURA_ACCESS_TOKEN = originalToken;
    }
  });

  it("labels Oura as provider-mediated rather than continuous raw streaming", async () => {
    process.env.OPENVITALS_OURA_ACCESS_TOKEN = "test-token";
    expect(manifest.status).toBe("demo-only");
    expect(liveManifest.status).toBe("real-data-beta");
    expect(liveManifest.runtimePath).toBe("hybrid");
    expect(liveManifest.capabilities).toContain("provider_mediated_sync");
    expect(liveManifest.capabilities).not.toContain("subscribe_updates");

    const status = await liveCollector.healthcheck();
    expect(status.message.toLowerCase()).toContain("provider-mediated");
  });

  it("normalizes representative Oura summaries and samples", async () => {
    const state = buildDemoState(new Date("2026-03-19T08:00:00.000Z"));
    const sourceAccount = state.sourceAccounts.find((row) => row.providerId === "oura");
    expect(sourceAccount).toBeDefined();
    if (!sourceAccount) {
      return;
    }

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/heartrate")) {
        return new Response(JSON.stringify({ data: [{ id: "hr-1", timestamp: "2026-03-18T08:00:00.000Z", bpm: 61 }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/daily_sleep")) {
        return new Response(JSON.stringify({ data: [{ id: "sleep-1", day: "2026-03-18", score: 88, total_sleep_duration: 28200 }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/daily_readiness")) {
        return new Response(JSON.stringify({ data: [{ id: "readiness-1", day: "2026-03-18", score: 91 }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/daily_spo2")) {
        return new Response(JSON.stringify({ data: [{ id: "spo2-1", day: "2026-03-18", spo2_percentage: 97.2 }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/daily_stress")) {
        return new Response(JSON.stringify({ data: [{ id: "stress-1", day: "2026-03-18", stress_high: 12 }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/workout")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "workout-1",
                activity: "run",
                start_datetime: "2026-03-18T09:00:00.000Z",
                end_datetime: "2026-03-18T09:30:00.000Z",
                calories: 240,
                distance: 5000
              }
            ]
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const payload = await loadOuraPayloadFromCredential({
      context: {
        user: state.user,
        sourceAccount,
        lastAnchor: null,
        mode: "incremental"
      },
      credential: {
        id: "provider_credential_oura_user_ada",
        userId: state.user.id,
        providerId: "oura",
        authState: "connected",
        connectionMethod: "env-token",
        accessToken: "test-token",
        refreshToken: null,
        expiresAt: null,
        scopes: ["personal", "daily", "heartrate", "workout"],
        externalUserId: "oura-user-123",
        lastRefreshAt: null,
        lastRefreshError: null,
        createdAt: "2026-03-19T08:00:00.000Z",
        updatedAt: "2026-03-19T08:00:00.000Z"
      }
    });

    expect(payload.observations.some((observation) => observation.metric === "heart_rate")).toBe(true);
    expect(payload.observations.some((observation) => observation.metric === "readiness_score")).toBe(true);
    expect(payload.observations.some((observation) => observation.metric === "spo2")).toBe(true);
    expect(payload.episodes.some((episode) => episode.episodeType === "sleep")).toBe(true);
    expect(payload.episodes.some((episode) => episode.episodeType === "workout")).toBe(true);
    expect(payload.observations.find((observation) => observation.metric === "heart_rate")?.tags).toContain("not_live_signal");
    expect(payload.observations.find((observation) => observation.metric === "readiness_score")?.dataGranularity).toBe("score");
    expect(payload.observations.find((observation) => observation.metric === "spo2")?.dataGranularity).toBe("daily_summary");
    expect(payload.observations.find((observation) => observation.metric === "stress")?.dataGranularity).toBe("daily_summary");
  });
});
