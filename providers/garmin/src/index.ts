import type { ProviderManifest } from "@openvitals/contracts";
import { ProviderManifestSchema } from "@openvitals/contracts";
import { createMockProviderCollector } from "./mock.js";

export const manifest: ProviderManifest = ProviderManifestSchema.parse({
  id: "garmin",
  packageName: "@openvitals/provider-garmin",
  displayName: "Garmin",
  providerClass: "cloud",
  runtimePath: "mock",
  phase: "phase-1",
  status: "demo-only",
  coverage: ["activities", "steps", "resting_heart_rate", "sync_freshness"],
  capabilities: ["connect", "sync_history", "sync_incremental"],
  notes: "Cloud collector used to demonstrate stale sync detection."
});

export const collector = createMockProviderCollector(manifest);
export const mockCollector = collector;
