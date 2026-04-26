export interface SleepConsistencyInput {
  bedtimeVarianceMinutes: number;
  wakeVarianceMinutes: number;
  durationVarianceMinutes: number;
}

export interface RecoveryReadinessInput {
  hrvDeltaPct: number;
  restingHeartRateDeltaPct: number;
  sleepDebtHours: number;
  loadRatio: number;
  completeness: number;
  freshnessHours: number;
}

export interface StrainBalanceInput {
  loadRatio: number;
}

export interface CircadianDisruptionInput {
  bedtimeShiftMinutes: number;
  wakeShiftMinutes: number;
  missingSleepPenalty: number;
}

export interface ScoreComputation {
  value: number;
  label: string;
  contributionBreakdown: Record<string, number>;
  uncertaintyNote: string;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const rounded = (value: number): number => Math.round(value * 10) / 10;

export function computeSleepConsistency(input: SleepConsistencyInput): ScoreComputation {
  const bedtimePenalty = clamp(input.bedtimeVarianceMinutes / 4, 0, 40);
  const wakePenalty = clamp(input.wakeVarianceMinutes / 4, 0, 40);
  const durationPenalty = clamp(input.durationVarianceMinutes / 6, 0, 20);
  const value = rounded(clamp(100 - bedtimePenalty - wakePenalty - durationPenalty, 0, 100));

  return {
    value,
    label: value >= 80 ? "stable" : value >= 60 ? "watch" : "disrupted",
    contributionBreakdown: {
      bedtime_midpoint_variance: rounded(40 - bedtimePenalty),
      wake_variance: rounded(40 - wakePenalty),
      duration_variance: rounded(20 - durationPenalty)
    },
    uncertaintyNote: value < 60 ? "Recent sleep timing is drifting outside the 28-day baseline." : "Sleep timing is within a workable band."
  };
}

export function computeRecoveryReadiness(input: RecoveryReadinessInput): ScoreComputation {
  const hrvComponent = clamp(35 + input.hrvDeltaPct * 1.2, 0, 35);
  const rhrComponent = clamp(25 - input.restingHeartRateDeltaPct * 2, 0, 25);
  const sleepDebtComponent = clamp(20 - input.sleepDebtHours * 4, 0, 20);
  const loadDistance = Math.abs(1 - input.loadRatio);
  const loadComponent = clamp(10 - loadDistance * 18, 0, 10);
  const freshnessComponent = clamp(10 * input.completeness - input.freshnessHours / 8, 0, 10);
  const value = rounded(clamp(hrvComponent + rhrComponent + sleepDebtComponent + loadComponent + freshnessComponent, 0, 100));

  return {
    value,
    label: value >= 75 ? "ready" : value >= 55 ? "cautious" : "depleted",
    contributionBreakdown: {
      hrv_delta: rounded(hrvComponent),
      resting_hr_delta: rounded(rhrComponent),
      sleep_debt: rounded(sleepDebtComponent),
      load_ratio: rounded(loadComponent),
      freshness_completeness: rounded(freshnessComponent)
    },
    uncertaintyNote:
      input.completeness < 0.7
        ? "Recovery confidence is reduced because one or more signals are stale or missing."
        : value < 55
          ? "Recovery is suppressed by combined sleep debt, HRV drop, and elevated resting heart rate."
          : "Recovery is supported by enough fresh signal coverage."
  };
}

export function computeStrainBalance(input: StrainBalanceInput): ScoreComputation {
  const distance = Math.abs(1 - input.loadRatio);
  const value = rounded(clamp(100 - distance * 80, 0, 100));
  const label = input.loadRatio < 0.8 ? "under" : input.loadRatio > 1.25 ? "overreaching" : "optimal";

  return {
    value,
    label,
    contributionBreakdown: {
      load_ratio: rounded(input.loadRatio)
    },
    uncertaintyNote:
      label === "optimal" ? "Acute load is close to chronic load." : "Acute load has drifted away from the 28-day baseline and needs context."
  };
}

export function computeCircadianDisruption(input: CircadianDisruptionInput): ScoreComputation {
  const bedtimePenalty = clamp(input.bedtimeShiftMinutes / 3.5, 0, 45);
  const wakePenalty = clamp(input.wakeShiftMinutes / 3.5, 0, 45);
  const missingPenalty = clamp(input.missingSleepPenalty, 0, 10);
  const value = rounded(clamp(100 - bedtimePenalty - wakePenalty - missingPenalty, 0, 100));

  return {
    value,
    label: value >= 80 ? "aligned" : value >= 60 ? "drifting" : "misaligned",
    contributionBreakdown: {
      bedtime_shift: rounded(45 - bedtimePenalty),
      wake_shift: rounded(45 - wakePenalty),
      missing_sleep_penalty: rounded(10 - missingPenalty)
    },
    uncertaintyNote:
      missingPenalty > 0 ? "One or more sleep windows are incomplete, so circadian interpretation is conservative." : "Circadian timing is based on recent sleep anchor shifts."
  };
}
