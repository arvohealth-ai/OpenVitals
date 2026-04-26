import type { Collector, ProviderManifest } from "@openvitals/contracts";

const emptyPayload = () => ({
  rawEvents: [],
  observations: [],
  episodes: [],
  devices: []
});

export const createHealthConnectLiveCollector = (manifest: ProviderManifest): Collector => ({
  manifest,
  async connect(user) {
    return {
      connectUrl: `openvitals://connect/health-connect/${user.id}`,
      sessionId: `session_health-connect_${user.id}`
    };
  },
  async exchangeSession(sessionId) {
    return {
      accessToken: `health_connect_access_${sessionId}`,
      refreshToken: `health_connect_refresh_${sessionId}`
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
      channel: "openvitals.health-connect.sdk-ingest"
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
      providerId: "health-connect",
      message: `${manifest.displayName} live collector is ready for permissioned SDK ingest via /v1/users/:id/ingest/health-connect; this is on-device sync, not a cloud raw stream.`
    };
  }
});
