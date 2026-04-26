import type { ProviderManifest } from "@openvitals/contracts";
import { ProviderManifestSchema } from "@openvitals/contracts";
import { createOuraLiveCollector } from "./live.js";
import { createMockProviderCollector } from "./mock.js";

export const manifest: ProviderManifest = ProviderManifestSchema.parse({
  id: "oura",
  packageName: "@openvitals/provider-oura",
  displayName: "Oura",
  providerClass: "cloud",
  runtimePath: "mock",
  phase: "phase-1",
  status: "demo-only",
  coverage: ["resting_heart_rate", "sleep", "readiness", "hrv"],
  capabilities: ["connect", "sync_history", "sync_incremental"],
  notes: "Default Oura collector remains mock until the shared API credential flow enables the live beta path."
});

export const liveManifest: ProviderManifest = ProviderManifestSchema.parse({
  ...manifest,
  runtimePath: "hybrid",
  status: "real-data-beta",
  coverage: ["heart_rate", "resting_heart_rate", "sleep", "readiness", "hrv", "spo2", "stress", "workouts"],
  capabilities: ["connect", "sync_history", "sync_incremental", "provider_mediated_sync", "oauth_metadata", "env_token_sync"],
  notes: "Oura cloud collector for delayed/provider-mediated samples, sleep, readiness, SpO2, stress, and workouts; not a continuous raw sensor stream."
});

export const collector = createMockProviderCollector(manifest);
export const mockCollector = collector;
export const liveCollector = createOuraLiveCollector(liveManifest);
