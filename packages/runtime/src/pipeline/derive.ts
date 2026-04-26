import type {
  DemoState,
  Episode,
  Insight,
  Observation,
  ProviderId,
  ProvenanceFields,
  Recommendation,
  Score,
  SourceAccount,
  User
} from "@openvitals/contracts";
import { InsightSchema, RecommendationSchema, ScoreSchema } from "@openvitals/contracts";
import {
  computeCircadianDisruption,
  computeRecoveryReadiness,
  computeSleepConsistency,
  computeStrainBalance
} from "@openvitals/scores";

export type DerivedContext = {
  user: User;
  sourceAccounts: SourceAccount[];
  observations: Observation[];
  episodes: Episode[];
  now: Date;
};

type BuildProvenance = (
  source: ProviderId,
  sourceRecordId: string,
  timezone: string,
  originalType: string,
  unit: string,
  freshnessHours: number,
  confidence: number,
  dedupeGroupId: string,
  captureMode: "direct" | "mirrored" | "manual" | "imported" | "derived",
  suppressedSources: ProviderId[],
  whyPrimary: string,
  origin?: {
    bundleId?: string | null;
    packageName?: string | null;
  }
) => ProvenanceFields;

export type DerivePipelineDeps = {
  addDays: (date: Date, days: number) => Date;
  formatDay: (date: Date, timezone: string) => string;
  buildProvenance: BuildProvenance;
  createId: (...parts: string[]) => string;
  round: (value: number) => number;
  localMinutes: (date: Date, timezone: string) => number;
  average: (values: number[]) => number;
  meanAbsoluteDeviation: (values: number[]) => number;
  iso: (date: Date) => string;
};

const findDailyObservation = (deps: DerivePipelineDeps, observations: Observation[], metric: string, day: string): Observation | undefined =>
  observations.find((observation) => observation.metric === metric && deps.formatDay(new Date(observation.startAt), observation.timezone) === day);

const findDailyEpisode = (
  deps: DerivePipelineDeps,
  episodes: Episode[],
  episodeType: Episode["episodeType"],
  day: string
): Episode | undefined =>
  episodes.find((episode) => episode.episodeType === episodeType && deps.formatDay(new Date(episode.endAt), episode.timezone) === day);

export const deriveDailySummaries = ({ user, observations, episodes, now }: DerivedContext, deps: DerivePipelineDeps): DemoState["dailySummaries"] => {
  const dailySummaries = [];
  for (let index = 13; index >= 0; index -= 1) {
    const day = deps.formatDay(deps.addDays(now, -index), user.timezone);
    const sleepEpisode = findDailyEpisode(deps, episodes, "sleep", day);
    const workoutEpisode = findDailyEpisode(deps, episodes, "workout", day);
    const hrv = findDailyObservation(deps, observations, "hrv_rmssd", day);
    const rhr = findDailyObservation(deps, observations, "resting_heart_rate", day);
    const steps = findDailyObservation(deps, observations, "steps", day);
    const summarySource = sleepEpisode?.source ?? steps?.source ?? "apple-health";
    const summaryProvenance = deps.buildProvenance(
      summarySource,
      `derived-summary-${day}`,
      user.timezone,
      "daily_summary",
      "composite",
      Math.min(2, ...observations.slice(-5).map((observation) => observation.freshnessHours)),
      0.9,
      deps.createId("dedupe", "daily_summary", day),
      "derived",
      [],
      "Daily summary is derived from the primary timeline records after dedupe."
    );
    const { timezone: _summaryTimezone, ...summaryProvenanceWithoutTimezone } = summaryProvenance;

    dailySummaries.push({
      id: deps.createId("summary", day),
      userId: user.id,
      day,
      timezone: user.timezone,
      summary: {
        sleep_hours: deps.round(sleepEpisode?.metrics.duration_hours ?? 0),
        training_load: deps.round(workoutEpisode?.metrics.training_load ?? 0),
        hrv: deps.round(hrv?.value ?? 0),
        resting_heart_rate: deps.round(rhr?.value ?? 0),
        steps: deps.round(steps?.value ?? 0)
      },
      createdAt: deps.iso(now),
      ...summaryProvenanceWithoutTimezone
    });
  }

  return dailySummaries;
};

export const deriveScores = ({ user, sourceAccounts, observations, episodes, now }: DerivedContext, deps: DerivePipelineDeps): Score[] => {
  const timezone = user.timezone;
  const latestDay = deps.formatDay(now, timezone);
  const recentSleepEpisodes = episodes.filter((episode) => episode.episodeType === "sleep").slice(-28);
  const recentWorkoutEpisodes = episodes.filter((episode) => episode.episodeType === "workout");
  const sleepMidpoints = recentSleepEpisodes.map(
    (episode) => (deps.localMinutes(new Date(episode.startAt), timezone) + deps.localMinutes(new Date(episode.endAt), timezone)) / 2
  );
  const wakeMinutesList = recentSleepEpisodes.map((episode) => deps.localMinutes(new Date(episode.endAt), timezone));
  const durations = recentSleepEpisodes.map((episode) => episode.metrics.duration_hours ?? 0);
  const latestSleep = findDailyEpisode(deps, episodes, "sleep", latestDay);
  const latestHrv = findDailyObservation(deps, observations, "hrv_rmssd", latestDay);
  const latestRhr = findDailyObservation(deps, observations, "resting_heart_rate", latestDay);
  const sevenDayLoad = recentWorkoutEpisodes.slice(-4).reduce((sum, episode) => sum + (episode.metrics.training_load ?? 0), 0);
  const twentyEightDayLoad = recentWorkoutEpisodes.slice(-14).reduce((sum, episode) => sum + (episode.metrics.training_load ?? 0), 0);
  const loadRatio = sevenDayLoad / Math.max(twentyEightDayLoad / 4, 1);
  const baselineHrv = deps.average(
    observations.filter((observation) => observation.metric === "hrv_rmssd").slice(-28).map((observation) => observation.value)
  );
  const baselineRhr = deps.average(
    observations.filter((observation) => observation.metric === "resting_heart_rate").slice(-28).map((observation) => observation.value)
  );
  const baselineSleepDuration = deps.average(recentSleepEpisodes.map((episode) => episode.metrics.duration_hours ?? 0));
  const freshestSource = Math.min(...sourceAccounts.map((account) => account.syncFreshnessHours));
  const completeness = Number(Boolean(latestSleep)) * 0.35 + Number(Boolean(latestHrv)) * 0.35 + Number(Boolean(latestRhr)) * 0.3;

  const sleepScore = computeSleepConsistency({
    bedtimeVarianceMinutes: deps.meanAbsoluteDeviation(sleepMidpoints),
    wakeVarianceMinutes: deps.meanAbsoluteDeviation(wakeMinutesList),
    durationVarianceMinutes: deps.meanAbsoluteDeviation(durations) * 60
  });

  const recoveryScore = computeRecoveryReadiness({
    hrvDeltaPct: (((latestHrv?.value ?? baselineHrv) - baselineHrv) / Math.max(baselineHrv, 1)) * 100,
    restingHeartRateDeltaPct: (((latestRhr?.value ?? baselineRhr) - baselineRhr) / Math.max(baselineRhr, 1)) * 100,
    sleepDebtHours: Math.max(baselineSleepDuration - (latestSleep?.metrics.duration_hours ?? baselineSleepDuration), 0),
    loadRatio,
    completeness,
    freshnessHours: freshestSource
  });

  const strainScore = computeStrainBalance({ loadRatio });
  const circadianScore = computeCircadianDisruption({
    bedtimeShiftMinutes:
      Math.abs(
        deps.localMinutes(new Date(latestSleep?.startAt ?? now), timezone) -
          deps.average(recentSleepEpisodes.map((episode) => deps.localMinutes(new Date(episode.startAt), timezone)))
      ) || 0,
    wakeShiftMinutes: Math.abs(deps.localMinutes(new Date(latestSleep?.endAt ?? now), timezone) - deps.average(wakeMinutesList)) || 0,
    missingSleepPenalty: latestSleep ? 0 : 10
  });

  const baseWindowStart = deps.iso(deps.addDays(now, -28));
  const baseWindowEnd = deps.iso(now);

  const buildScore = (
    scoreKind: Score["scoreKind"],
    providerId: ProviderId,
    value: ReturnType<typeof computeSleepConsistency>
  ): Score => {
    const scoreProvenance = deps.buildProvenance(
      providerId,
      `derived:${scoreKind}`,
      user.timezone,
      scoreKind,
      "score",
      freshestSource,
      deps.round(completeness),
      deps.createId("dedupe", "score", scoreKind),
      "derived",
      [],
      "Derived score computed from deduped canonical records."
    );
    const {
      confidence: _scoreConfidence,
      freshnessHours: _scoreFreshness,
      ...scoreProvenanceWithoutConflicts
    } = scoreProvenance;

    return ScoreSchema.parse({
      id: deps.createId("score", scoreKind),
      userId: user.id,
      scoreKind,
      value: value.value,
      label: value.label,
      confidence: deps.round(completeness),
      freshnessHours: freshestSource,
      formulaVersion: "v0.1.0",
      windowStart: baseWindowStart,
      windowEnd: baseWindowEnd,
      evidenceSet: [`sleep:${latestDay}`, `load_ratio:${deps.round(loadRatio)}`, `freshness:${deps.round(freshestSource)}`],
      contributionBreakdown: value.contributionBreakdown,
      missingSignals: completeness < 1 ? ["partial_recovery_signal_coverage"] : [],
      uncertaintyNote: value.uncertaintyNote,
      ...scoreProvenanceWithoutConflicts
    });
  };

  return [
    buildScore("sleep_consistency", latestSleep?.source ?? "whoop", sleepScore),
    buildScore("recovery_readiness", latestHrv?.source ?? "whoop", recoveryScore),
    buildScore("strain_balance", "strava", strainScore),
    buildScore("circadian_disruption", latestSleep?.source ?? "whoop", circadianScore)
  ];
};

export const deriveInsights = (user: User, scores: Score[], now: Date, deps: DerivePipelineDeps): Insight[] => {
  const recoveryScore = scores.find((score) => score.scoreKind === "recovery_readiness");
  const strainScore = scores.find((score) => score.scoreKind === "strain_balance");
  return [
    InsightSchema.parse({
      id: "insight_recovery_context",
      userId: user.id,
      title: "Recovery and load are misaligned",
      summary: `Recovery is ${recoveryScore?.label ?? "unknown"} while acute load is ${strainScore?.label ?? "unknown"}.`,
      scoreIds: scores.map((score) => score.id),
      createdAt: deps.iso(now),
      ...deps.buildProvenance(
        "whoop",
        "derived:insight:recovery_context",
        user.timezone,
        "insight",
        "insight",
        2,
        0.88,
        "dedupe_insight_recovery_context",
        "derived",
        [],
        "Insight derived from current score set."
      )
    })
  ];
};

export const deriveRecommendations = (user: User, scores: Score[], now: Date, deps: DerivePipelineDeps): Recommendation[] => {
  const recovery = scores.find((score) => score.scoreKind === "recovery_readiness");
  const sleep = scores.find((score) => score.scoreKind === "sleep_consistency");
  const recommendations: Recommendation[] = [];

  recommendations.push(
    RecommendationSchema.parse({
      id: "recommendation_morning_brief",
      userId: user.id,
      workflowKind: "morning_brief",
      title: "Bias today toward low-friction recovery",
      summary:
        recovery && recovery.value < 55
          ? "Cut intensity, cap training volume, and protect a stable bedtime tonight."
          : "Keep planned training, but hold bedtime and wake time consistent.",
      reversible: true,
      evidenceSet: [recovery?.id ?? "score_recovery_readiness", sleep?.id ?? "score_sleep_consistency"],
      uncertaintyNote: recovery?.uncertaintyNote ?? "Recommendation uses available recovery context.",
      preferenceFilter: ["wellness_only", "no_medical_diagnosis"],
      createdAt: deps.iso(now),
      ...deps.buildProvenance(
        "whoop",
        "derived:recommendation:morning_brief",
        user.timezone,
        "recommendation",
        "recommendation",
        2,
        0.84,
        "dedupe_recommendation_morning_brief",
        "derived",
        [],
        "Recommendation derived from score and policy layers."
      )
    })
  );

  return recommendations;
};
