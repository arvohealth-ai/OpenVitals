import type { DemoState } from "@openvitals/contracts";
import { toOmh } from "./index.js";

describe("export-omh", () => {
  it("exports Apple Health companion metadata as source-account schema data", () => {
    const state = {
      user: {
        id: "user_ada",
        name: "Ada",
        timezone: "Asia/Shanghai",
        createdAt: "2026-03-19T08:00:00.000Z"
      },
      sourceAccounts: [
        {
          id: "source_apple",
          userId: "user_ada",
          providerId: "apple-health",
          platform: "mobile",
          status: "connected",
          lastSyncAt: "2026-03-19T08:00:00.000Z",
          syncFreshnessHours: 1,
          capabilities: ["heart_rate"],
          metricCapabilities: [
            {
              metricName: "live_workout_heart_rate",
              source: "apple-health",
              dataGranularity: "live_signal",
              latencyClass: "live",
              direct: true,
              mirrored: false
            }
          ],
          connectionMode: "mobile_permission",
          externalUserId: "local-healthkit",
          connectionLabel: "Apple Health iPhone"
        }
      ],
      scores: [],
      dailySummaries: []
    } as unknown as DemoState;

    const sourceAccount = toOmh(state).body.schemas.find((schema) => schema.schema_id === "omh:openvitals:source-account");

    expect(sourceAccount?.data).toMatchObject({
      provider_id: "apple-health",
      connection_mode: "mobile_permission",
      live_signal_capable: true,
      companion_note: expect.stringContaining("iPhone companion")
    });
  });
});
