import { assertProviderContract } from "../../_test/contract.js";
import { collector, manifest, mockCollector } from "./index.js";

assertProviderContract({
  expectedProviderId: "apple-health",
  manifest,
  collector
});

describe("apple-health runtime path", () => {
  it("uses live collector as default export", async () => {
    expect(manifest.runtimePath).toBe("hybrid");
    expect(manifest.coverage).toEqual(
      expect.arrayContaining(["heart_rate", "workouts", "apple_watch_live_workout_heart_rate", "source_revision_metadata"])
    );
    expect(manifest.capabilities).toEqual(
      expect.arrayContaining(["healthkit_anchored_queries", "apple_watch_live_workout_hr", "mirrored_origin_classification"])
    );
    expect(manifest.metricCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricName: "heart_rate", dataGranularity: "sample", latencyClass: "delayed_sync", mirrored: true }),
        expect.objectContaining({ metricName: "live_workout_heart_rate", dataGranularity: "live_signal", latencyClass: "live", mirrored: false })
      ])
    );
    expect(manifest.notes).toContain("only live_signal/live path");

    const state = await collector.healthcheck();
    expect(state.message).toContain("live collector");
    expect(state.message).toContain("raw payload preservation");
    expect(state.message).toContain("provenance/dedupe tags");
    expect(mockCollector.manifest.id).toBe("apple-health");
  });
});
