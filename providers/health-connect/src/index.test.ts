import { assertProviderContract } from "../../_test/contract.js";
import { collector, manifest, mockCollector } from "./index.js";

assertProviderContract({
  expectedProviderId: "health-connect",
  manifest,
  collector
});

describe("health-connect runtime path", () => {
  it("uses live collector as default export", async () => {
    expect(manifest.runtimePath).toBe("hybrid");
    const state = await collector.healthcheck();
    expect(state.message).toContain("SDK ingest");
    expect(state.message).toContain("not a cloud raw stream");
    expect(mockCollector.manifest.id).toBe("health-connect");
  });
});
