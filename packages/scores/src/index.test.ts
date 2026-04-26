import {
  computeCircadianDisruption,
  computeRecoveryReadiness,
  computeSleepConsistency,
  computeStrainBalance
} from "./index.js";

describe("scores", () => {
  it("scores stable sleep highly", () => {
    expect(
      computeSleepConsistency({
        bedtimeVarianceMinutes: 18,
        wakeVarianceMinutes: 14,
        durationVarianceMinutes: 20
      }).value
    ).toBeGreaterThan(70);
  });

  it("downgrades depleted recovery", () => {
    const result = computeRecoveryReadiness({
      hrvDeltaPct: -22,
      restingHeartRateDeltaPct: 10,
      sleepDebtHours: 2.8,
      loadRatio: 1.32,
      completeness: 0.9,
      freshnessHours: 2
    });

    expect(result.label).toBe("depleted");
    expect(result.value).toBeLessThan(55);
  });

  it("classifies strain balance windows", () => {
    expect(computeStrainBalance({ loadRatio: 0.7 }).label).toBe("under");
    expect(computeStrainBalance({ loadRatio: 1.0 }).label).toBe("optimal");
    expect(computeStrainBalance({ loadRatio: 1.4 }).label).toBe("overreaching");
  });

  it("reflects circadian drift", () => {
    expect(
      computeCircadianDisruption({
        bedtimeShiftMinutes: 110,
        wakeShiftMinutes: 95,
        missingSleepPenalty: 0
      }).label
    ).toBe("misaligned");
  });
});
