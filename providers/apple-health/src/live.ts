import type { Collector, ProviderManifest } from "@openvitals/contracts";

const emptyPayload = () => ({
  rawEvents: [],
  observations: [],
  episodes: [],
  devices: []
});

export const createAppleHealthLiveCollector = (manifest: ProviderManifest): Collector => ({
  manifest,
  async connect(user) {
    return {
      connectUrl: `openvitals://connect/apple-health/${user.id}`,
      sessionId: `session_apple-health_${user.id}`
    };
  },
  async exchangeSession(sessionId) {
    return {
      accessToken: `apple_health_access_${sessionId}`,
      refreshToken: `apple_health_refresh_${sessionId}`
    };
  },
  async syncHistory() {
    return emptyPayload();
  },
  async syncIncremental() {
    return emptyPayload();
  },
  async subscribeUpdates() {
    return {
      subscribed: true,
      channel: "openvitals.apple-health.updates"
    };
  },
  async normalize(rawEvents) {
    return {
      rawEvents,
      observations: [],
      episodes: [],
      devices: []
    };
  },
  async resolveProvenance(payload) {
    return payload;
  },
  async healthcheck() {
    return {
      ok: true,
      providerId: "apple-health",
      message: `${manifest.displayName} live collector is ready for SDK-driven HealthKit ingest, anchored sync, raw payload preservation, provenance/dedupe tags, mirrored source filtering, and optional Apple Watch workout heart-rate live signals via /v1/users/:id/ingest/apple-health.`
    };
  }
});
