import type { ProviderManifest } from "@openvitals/contracts";
import { ProviderManifestSchema } from "@openvitals/contracts";
import { createHealthConnectLiveCollector } from "./live.js";
import { createHealthConnectMockCollector } from "./mock.js";

export const manifest: ProviderManifest = ProviderManifestSchema.parse({
  id: "health-connect",
  packageName: "@openvitals/provider-health-connect",
  displayName: "Health Connect",
  providerClass: "mobile",
  runtimePath: "hybrid",
  phase: "phase-1",
  status: "prototype",
  coverage: ["sleep", "resting_heart_rate", "hrv", "steps", "source_filtering"],
  capabilities: ["connect", "exchange_session", "sync_history", "sync_incremental", "offline_queue"],
  notes: "Android-first on-device SDK ingest with source filtering and session isolation; mobile permission samples/episodes, not a cloud raw stream."
});

export const collector = createHealthConnectLiveCollector(manifest);
export const mockCollector = createHealthConnectMockCollector(manifest);
