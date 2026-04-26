import type { ProviderManifest } from "@openvitals/contracts";
import { ProviderManifestSchema } from "@openvitals/contracts";
import { createWhoopLiveCollector } from "./live.js";
import { createMockProviderCollector } from "./mock.js";

export const manifest: ProviderManifest = ProviderManifestSchema.parse({
  id: "whoop",
  packageName: "@openvitals/provider-whoop",
  displayName: "WHOOP",
  providerClass: "cloud",
  runtimePath: "hybrid",
  phase: "phase-1",
  status: "real-data-ready",
  coverage: ["sleep", "strain", "recovery", "hrv", "resting_heart_rate"],
  capabilities: ["connect", "sync_history", "sync_incremental", "webhook_trigger", "provider_mediated_sync", "oauth_refresh"],
  notes: "WHOOP cloud collector for delayed/provider-mediated sleep, recovery, workout, strain, HRV, and resting HR summaries; not a continuous raw heart-rate stream."
});

export const collector = createWhoopLiveCollector(manifest);
export const mockCollector = createMockProviderCollector(manifest);
