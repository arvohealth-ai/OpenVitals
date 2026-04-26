import type { ProviderManifest } from "@openvitals/contracts";
import { ProviderManifestSchema } from "@openvitals/contracts";
import { createMockProviderCollector } from "./mock.js";

export const manifest: ProviderManifest = ProviderManifestSchema.parse({
  id: "strava",
  packageName: "@openvitals/provider-strava",
  displayName: "Strava",
  providerClass: "cloud",
  runtimePath: "mock",
  phase: "phase-1",
  status: "demo-only",
  coverage: ["workouts", "distance", "load", "routes_pending"],
  capabilities: ["connect", "sync_history", "sync_incremental", "subscribe_updates"],
  notes: "Cloud workout provider used for strain/load workflows."
});

export const collector = createMockProviderCollector(manifest);
export const mockCollector = collector;
