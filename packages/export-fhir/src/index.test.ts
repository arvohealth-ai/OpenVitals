import type { DemoState } from "@openvitals/contracts";
import { toFhirBundle } from "./index.js";

describe("export-fhir", () => {
  it("exports Apple Health companion metadata as device extensions", () => {
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
      alerts: []
    } as unknown as DemoState;

    const device = toFhirBundle(state).entry.find((entry) => entry.resource.resourceType === "Device")?.resource;

    expect(device?.extension).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://openvitals.dev/fhir/StructureDefinition/connection-mode", valueCode: "mobile_permission" }),
        expect.objectContaining({ url: "https://openvitals.dev/fhir/StructureDefinition/live-signal-capable", valueBoolean: true }),
        expect.objectContaining({
          url: "https://openvitals.dev/fhir/StructureDefinition/companion-note",
          valueString: expect.stringContaining("iPhone companion")
        })
      ])
    );
  });
});
