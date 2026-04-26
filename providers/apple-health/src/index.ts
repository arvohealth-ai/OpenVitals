import type { ProviderManifest } from "@openvitals/contracts";
import { ProviderManifestSchema } from "@openvitals/contracts";
import { createAppleHealthLiveCollector } from "./live.js";
import { createAppleHealthMockCollector } from "./mock.js";

export const manifest: ProviderManifest = ProviderManifestSchema.parse({
  id: "apple-health",
  packageName: "@openvitals/provider-apple-health",
  displayName: "Apple Health",
  providerClass: "mobile",
  runtimePath: "hybrid",
  phase: "phase-1",
  status: "sdk-ingest-ready",
  coverage: [
    "heart_rate",
    "sleep",
    "resting_heart_rate",
    "hrv",
    "steps",
    "workouts",
    "apple_watch_live_workout_heart_rate",
    "mirrored_source_detection",
    "source_revision_metadata"
  ],
  capabilities: [
    "connect",
    "exchange_session",
    "sync_history",
    "sync_incremental",
    "healthkit_anchored_queries",
    "apple_watch_live_workout_hr",
    "source_filtering",
    "mirrored_origin_classification"
  ],
  metricCapabilities: [
    { metricName: "heart_rate", source: "apple-health", dataGranularity: "sample", latencyClass: "delayed_sync", direct: true, mirrored: true },
    { metricName: "hrv_sdnn", source: "apple-health", dataGranularity: "sample", latencyClass: "delayed_sync", direct: true, mirrored: true },
    { metricName: "resting_heart_rate", source: "apple-health", dataGranularity: "sample", latencyClass: "delayed_sync", direct: true, mirrored: true },
    { metricName: "steps", source: "apple-health", dataGranularity: "sample", latencyClass: "delayed_sync", direct: true, mirrored: true },
    { metricName: "sleep_analysis", source: "apple-health", dataGranularity: "episode", latencyClass: "delayed_sync", direct: true, mirrored: true },
    { metricName: "workout", source: "apple-health", dataGranularity: "episode", latencyClass: "delayed_sync", direct: true, mirrored: true },
    { metricName: "live_workout_heart_rate", source: "apple-health", dataGranularity: "live_signal", latencyClass: "live", direct: true, mirrored: false }
  ],
  notes:
    "iPhone HealthKit connector preserves raw payloads and provenance for anchored historical sync; optional Apple Watch workout sessions are the only live_signal/live path."
});

export const collector = createAppleHealthLiveCollector(manifest);
export const mockCollector = createAppleHealthMockCollector(manifest);
