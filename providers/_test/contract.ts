import type { Collector, ProviderId, ProviderManifest } from "@openvitals/contracts";
import { buildDemoState } from "@openvitals/runtime";

const NOW = new Date("2026-03-19T08:00:00.000Z");

export const assertProviderContract = (input: {
  expectedProviderId: ProviderId;
  manifest: ProviderManifest;
  collector: Collector;
}): void => {
  describe("provider contract", () => {
    it("exposes a stable manifest", () => {
      expect(input.manifest.id).toBe(input.expectedProviderId);
      expect(input.collector.manifest.id).toBe(input.manifest.id);
      expect(input.collector.manifest.packageName).toContain(input.manifest.id);
    });

    it("supports core collector lifecycle", async () => {
      const state = buildDemoState(NOW);
      const sourceAccount = state.sourceAccounts.find((row) => row.providerId === input.manifest.id);
      expect(sourceAccount).toBeDefined();
      if (!sourceAccount) {
        return;
      }

      const context = {
        user: state.user,
        sourceAccount,
        lastAnchor: null,
        mode: "incremental" as const
      };

      const connect = await input.collector.connect(state.user);
      expect(connect.connectUrl).toContain(input.manifest.id);
      expect(connect.sessionId).toContain(state.user.id);

      const exchange = await input.collector.exchangeSession(connect.sessionId);
      expect(exchange.accessToken).toContain(connect.sessionId);
      expect(exchange.refreshToken).toContain(connect.sessionId);

      const health = await input.collector.healthcheck();
      expect(health.ok).toBe(true);
      expect(health.providerId).toBe(input.manifest.id);

      const payload = await input.collector.syncIncremental(context);
      expect(Array.isArray(payload.rawEvents)).toBe(true);
      expect(Array.isArray(payload.observations)).toBe(true);
      expect(Array.isArray(payload.episodes)).toBe(true);

      const updates = await input.collector.subscribeUpdates(context);
      expect(updates.subscribed).toBe(true);

      const normalized = await input.collector.normalize(payload.rawEvents);
      expect(Array.isArray(normalized.rawEvents)).toBe(true);

      const resolved = await input.collector.resolveProvenance(payload);
      expect(resolved.rawEvents.length).toBe(payload.rawEvents.length);
    });
  });
};
