import type {
  AgentToken,
  AgentAccessPolicy,
  AuthState,
  Alert,
  Automation,
  AutomationRun,
  Collector,
  CloudEvent,
  ConnectionMethod,
  ConnectionMode,
  ConnectSessionResponse,
  ConnectorSession,
  ConsentGrant,
  DataGranularity,
  DedupeDecision,
  DemoState,
  Device,
  Episode,
  Feedback,
  IngestBatchInput,
  IngestBatchResult,
  IngestFailure,
  IngestRecord,
  Insight,
  LatencyClass,
  MetricCapability,
  MetricFamily,
  NormalizedPayload,
  Observation,
  ProviderId,
  ProviderManifest,
  ProvenanceFields,
  RawEvent,
  Recommendation,
  Score,
  SourceFilter,
  SourceFilterInput,
  SourcePrecedenceInput,
  SourcePrecedenceOverride,
  SourceAccount,
  SyncAnchor,
  SyncStatusResponse,
  User
} from "@openvitals/contracts";
import {
  AgentTokenSchema,
  ConnectSessionResponseSchema,
  ConnectorSessionSchema,
  ConsentGrantSchema,
  DedupeDecisionSchema,
  DemoStateSchema,
  DeviceSchema,
  EpisodeSchema,
  FeedbackSchema,
  IngestBatchInputSchema,
  IngestBatchResultSchema,
  IngestBatchSchema,
  IngestFailureSchema,
  IngestRecordSchema,
  MetricCapabilitySchema,
  NormalizedPayloadSchema,
  ObservationSchema,
  ProviderIdSchema,
  PROVIDER_IDS,
  RawEventSchema,
  SourceFilterInputSchema,
  SourceFilterSchema,
  SourcePrecedenceInputSchema,
  SourcePrecedenceOverrideSchema,
  SourceAccountSchema,
  SyncAnchorSchema,
  SyncStatusResponseSchema,
  UserSchema
} from "@openvitals/contracts";
import {
  dedupeFingerprint as dedupeFingerprintStage,
  dedupeTimelineWithDecisions as dedupeTimelineWithDecisionsStage
} from "./pipeline/dedupe.js";
import {
  deriveDailySummaries as deriveDailySummariesStage,
  deriveInsights as deriveInsightsStage,
  deriveRecommendations as deriveRecommendationsStage,
  deriveScores as deriveScoresStage,
  type DerivedContext
} from "./pipeline/derive.js";
import {
  applyRecommendationGate as applyRecommendationGateStage,
  findOrCreateDevice as findOrCreateDeviceStage,
  findSourceAccount as findSourceAccountStage,
  projectIngestRecords as projectIngestRecordsStage,
  refreshSourceAccounts as refreshSourceAccountsStage
} from "./pipeline/ingest.js";
import {
  deriveAlerts as deriveAlertsStage,
  deriveAutomations as deriveAutomationsStage,
  deriveAutomationRuns as deriveAutomationRunsStage,
  deriveAuditLogs as deriveAuditLogsStage,
  deriveOutbox as deriveOutboxStage,
  derivePolicies as derivePoliciesStage,
  deriveSourceFilters as deriveSourceFiltersStage,
  deriveSyncAnchors as deriveSyncAnchorsStage
} from "./pipeline/workflow.js";

type PayloadInput = {
  user: User;
  sourceAccount: SourceAccount;
  device: Device;
  now: Date;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DEDUPE_PRECEDENCE_VERSION = "v0.2.0";

const DEFAULT_PRECEDENCE: Record<string, number> = {
  direct: 5,
  mirrored: 4,
  imported: 2,
  manual: 1,
  derived: 0
};

const datePartsForTimezone = (date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: "year" | "month" | "day" | "hour" | "minute"): number => Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute")
  };
};

const localDeltaMinutes = (
  target: { year: number; month: number; day: number; hour: number; minute: number },
  actual: { year: number; month: number; day: number; hour: number; minute: number }
): number =>
  Math.round(
    (Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute) -
      Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)) /
      (60 * 1000)
  );

const localMidnight = (date: Date, timezone: string): Date => {
  const localDate = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const target = {
    year: Number(localDate.find((part) => part.type === "year")?.value ?? 0),
    month: Number(localDate.find((part) => part.type === "month")?.value ?? 1),
    day: Number(localDate.find((part) => part.type === "day")?.value ?? 1),
    hour: 0,
    minute: 0
  };

  let guess = new Date(Date.UTC(target.year, target.month - 1, target.day, 0, 0, 0));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = datePartsForTimezone(guess, timezone);
    const deltaMinutes = localDeltaMinutes(target, actual);
    if (deltaMinutes === 0) {
      break;
    }
    guess = new Date(guess.getTime() + deltaMinutes * 60 * 1000);
  }

  return guess;
};

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY);

const atLocalMinutes = (dayStart: Date, minutes: number): Date => new Date(dayStart.getTime() + minutes * 60 * 1000);

const iso = (date: Date): string => date.toISOString();

const formatDay = (date: Date, timezone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);

const localMinutes = (date: Date, timezone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
};

const average = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

const meanAbsoluteDeviation = (values: number[]): number => {
  const center = average(values);
  return average(values.map((value) => Math.abs(value - center)));
};

const round = (value: number): number => Math.round(value * 10) / 10;

const createId = (...parts: string[]): string => parts.join("_").replace(/[^a-zA-Z0-9:_-]/g, "-");

const wave = (index: number, amplitude: number, phase = 0): number => Math.sin(index * 0.63 + phase) * amplitude;

const canonicalSourceKey = (sourceRecordId: string): string => sourceRecordId.replace(/^mirror:/, "");

const sourceAppForProvider = (providerId: ProviderId): string => {
  switch (providerId) {
    case "apple-health":
      return "com.apple.Health";
    case "health-connect":
      return "com.google.android.apps.healthdata";
    case "oura":
      return "com.ouraring.app";
    case "whoop":
      return "com.whoop.mobile";
    case "garmin":
      return "com.garmin.connect";
    case "strava":
      return "com.strava";
  }
};

const deviceModelForProvider = (providerId: ProviderId): string => {
  switch (providerId) {
    case "apple-health":
      return "Apple Watch Series 10";
    case "health-connect":
      return "Pixel 10 Pro";
    case "oura":
      return "Oura Ring 4";
    case "whoop":
      return "WHOOP 5.0";
    case "garmin":
      return "Forerunner 975";
    case "strava":
      return "iPhone 17 Pro";
  }
};

const providerClass = (providerId: ProviderId): "mobile" | "cloud" =>
  providerId === "apple-health" || providerId === "health-connect" ? "mobile" : "cloud";

const connectionModeForProvider = (providerId: ProviderId): ConnectionMode =>
  providerClass(providerId) === "mobile" ? "mobile_permission" : "cloud_oauth";

const latencyClassForProvider = (providerId: ProviderId): LatencyClass =>
  providerId === "apple-health" || providerId === "health-connect" ? "near_realtime" : "delayed_sync";

const dataGranularityForOriginalType = (originalType: string, captureMode: string): DataGranularity => {
  if (captureMode === "derived") {
    if (originalType === "daily_summary") {
      return "daily_summary";
    }
    if (
      originalType === "sleep_consistency" ||
      originalType === "recovery_readiness" ||
      originalType === "strain_balance" ||
      originalType === "circadian_disruption"
    ) {
      return "score";
    }
  }
  if (originalType === "sleep" || originalType === "workout") {
    return "episode";
  }
  return "sample";
};

type MetricCapabilitySeed = Omit<MetricCapability, "mirrored"> & Partial<Pick<MetricCapability, "mirrored">>;

const parseMetricCapabilities = (capabilities: MetricCapabilitySeed[]): MetricCapability[] =>
  capabilities.map((capability) => MetricCapabilitySchema.parse(capability));

const metricCapabilitiesForProvider = (providerId: ProviderId): MetricCapability[] => {
  switch (providerId) {
    case "apple-health":
      return parseMetricCapabilities([
        { metricName: "heart_rate", source: providerId, dataGranularity: "sample", latencyClass: "near_realtime", direct: true },
        { metricName: "hrv_sdnn", source: providerId, dataGranularity: "sample", latencyClass: "near_realtime", direct: true },
        { metricName: "resting_heart_rate", source: providerId, dataGranularity: "sample", latencyClass: "near_realtime", direct: true },
        { metricName: "steps", source: providerId, dataGranularity: "sample", latencyClass: "near_realtime", direct: true },
        { metricName: "sleep", source: providerId, dataGranularity: "episode", latencyClass: "near_realtime", direct: true, mirrored: true },
        { metricName: "workout", source: providerId, dataGranularity: "episode", latencyClass: "near_realtime", direct: true, mirrored: true }
      ]);
    case "health-connect":
      return parseMetricCapabilities([
        { metricName: "heart_rate", source: providerId, dataGranularity: "sample", latencyClass: "near_realtime", direct: true },
        { metricName: "steps", source: providerId, dataGranularity: "sample", latencyClass: "near_realtime", direct: true },
        { metricName: "sleep", source: providerId, dataGranularity: "episode", latencyClass: "near_realtime", direct: true, mirrored: true },
        { metricName: "workout", source: providerId, dataGranularity: "episode", latencyClass: "near_realtime", direct: true, mirrored: true }
      ]);
    case "oura":
      return parseMetricCapabilities([
        { metricName: "heart_rate", source: providerId, dataGranularity: "sample", latencyClass: "delayed_sync", direct: true },
        { metricName: "sleep", source: providerId, dataGranularity: "episode", latencyClass: "delayed_sync", direct: true },
        { metricName: "readiness", source: providerId, dataGranularity: "score", latencyClass: "daily", direct: true },
        { metricName: "spo2", source: providerId, dataGranularity: "daily_summary", latencyClass: "daily", direct: true },
        { metricName: "stress", source: providerId, dataGranularity: "daily_summary", latencyClass: "daily", direct: true },
        { metricName: "workout", source: providerId, dataGranularity: "episode", latencyClass: "delayed_sync", direct: true }
      ]);
    case "whoop":
      return parseMetricCapabilities([
        { metricName: "sleep", source: providerId, dataGranularity: "episode", latencyClass: "delayed_sync", direct: true },
        { metricName: "recovery", source: providerId, dataGranularity: "score", latencyClass: "delayed_sync", direct: true },
        { metricName: "hrv_rmssd", source: providerId, dataGranularity: "sample", latencyClass: "delayed_sync", direct: true },
        { metricName: "resting_heart_rate", source: providerId, dataGranularity: "sample", latencyClass: "delayed_sync", direct: true },
        { metricName: "strain", source: providerId, dataGranularity: "daily_summary", latencyClass: "delayed_sync", direct: true },
        { metricName: "workout", source: providerId, dataGranularity: "episode", latencyClass: "delayed_sync", direct: true }
      ]);
    case "garmin":
      return parseMetricCapabilities([
        { metricName: "sleep", source: providerId, dataGranularity: "episode", latencyClass: "delayed_sync", direct: true },
        { metricName: "heart_rate", source: providerId, dataGranularity: "sample", latencyClass: "delayed_sync", direct: true },
        { metricName: "workout", source: providerId, dataGranularity: "episode", latencyClass: "delayed_sync", direct: true }
      ]);
    case "strava":
      return parseMetricCapabilities([
        { metricName: "workout", source: providerId, dataGranularity: "episode", latencyClass: "delayed_sync", direct: true },
        { metricName: "training_load", source: providerId, dataGranularity: "daily_summary", latencyClass: "delayed_sync", direct: true }
      ]);
  }
};

const capabilitiesForProvider = (providerId: ProviderId): string[] => {
  switch (providerId) {
    case "apple-health":
      return ["connect", "exchange_session", "sync_history", "sync_incremental", "source_filtering"];
    case "health-connect":
      return ["connect", "exchange_session", "sync_history", "sync_incremental", "offline_queue", "source_filtering"];
    case "whoop":
    case "oura":
    case "strava":
      return ["connect", "sync_history", "sync_incremental", "subscribe_updates"];
    case "garmin":
      return ["connect", "sync_history", "sync_incremental"];
  }
};

const createWhyPrimary = (source: ProviderId, suppressedSources: ProviderId[], captureMode: string): string => {
  if (suppressedSources.length === 0) {
    return `${source} is the only ${captureMode} record in this dedupe group.`;
  }

  return `${source} won this dedupe group because ${captureMode} ranked highest after precedence + confidence + origin tie-breakers over ${suppressedSources.join(", ")}.`;
};

const buildProvenance = (
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
  origin: {
    bundleId?: string | null;
    packageName?: string | null;
  } = {}
): ProvenanceFields => ({
  source,
  sourceRecordId,
  sourceApp: sourceAppForProvider(source),
  bundleId: origin.bundleId ?? null,
  packageName: origin.packageName ?? null,
  captureMode,
  originalType,
  unit,
  dataGranularity: dataGranularityForOriginalType(originalType, captureMode),
  latencyClass: captureMode === "manual" ? "manual" : latencyClassForProvider(source),
  timezone,
  freshnessHours,
  confidence,
  dedupeGroupId,
  provenanceChain: [
    {
      providerId: source,
      sourceRecordId,
      captureMode,
      role: captureMode === "mirrored" ? "mirror" : captureMode === "derived" ? "derived" : "primary"
    }
  ],
  whyPrimary,
  suppressedSources
});

type RawSleepDay = {
  day: Date;
  sleepStart: Date;
  sleepEnd: Date;
  durationHours: number;
  hrv: number;
  restingHeartRate: number;
  steps: number;
  load: number;
};

const createDailyProfile = (index: number, now: Date, timezone: string): RawSleepDay => {
  const dayStart = addDays(localMidnight(now, timezone), -index);
  const bedtimeMinutes = 23 * 60 + 10 + wave(index, 16);
  const wakeMinutes = 7 * 60 + 10 + wave(index, 14, 0.2);
  const durationHours = 7.6 + wave(index, 0.35, 0.6);
  const hrv = 71 + wave(index, 5, 0.1);
  const restingHeartRate = 52 + wave(index, 1.8, 0.5);
  const steps = 9500 + wave(index, 1300, 0.4);
  const load = 52 + wave(index, 10, 1.2);

  if (index <= 2) {
    const degradation = [
      { bedtimeShift: 90, wakeShift: 55, duration: 6.2, hrv: 54, rhr: 58, steps: 6200, load: 78 },
      { bedtimeShift: 105, wakeShift: 72, duration: 5.9, hrv: 50, rhr: 60, steps: 5800, load: 84 },
      { bedtimeShift: 80, wakeShift: 46, duration: 6.4, hrv: 56, rhr: 57, steps: 6900, load: 70 }
    ][index]!;

    const sleepEnd = atLocalMinutes(dayStart, wakeMinutes + degradation.wakeShift);
    const sleepStart = new Date(sleepEnd.getTime() - degradation.duration * HOUR);

    return {
      day: dayStart,
      sleepStart: new Date(sleepStart.getTime() - degradation.bedtimeShift * 60 * 1000),
      sleepEnd,
      durationHours: degradation.duration,
      hrv: degradation.hrv,
      restingHeartRate: degradation.rhr,
      steps: degradation.steps,
      load: degradation.load
    };
  }

  const sleepEnd = atLocalMinutes(dayStart, wakeMinutes);
  const sleepStart = new Date(sleepEnd.getTime() - durationHours * HOUR);
  return {
    day: dayStart,
    sleepStart,
    sleepEnd,
    durationHours,
    hrv,
    restingHeartRate,
    steps,
    load
  };
};

export const createDemoUser = (now = new Date()): User =>
  UserSchema.parse({
    id: "user_ada",
    name: "Ada Athlete",
    timezone: "Asia/Shanghai",
    createdAt: iso(new Date(now.getTime() - 45 * DAY))
  });

type SourceOverrides = Partial<Record<ProviderId, Partial<SourceAccount>>>;
type DemoSourceAccountSeed = Omit<SourceAccount, "metricCapabilities" | "connectionMode">;

export const createDemoSourceAccounts = (user: User, now = new Date(), overrides: SourceOverrides = {}): SourceAccount[] => {
  const rows: DemoSourceAccountSeed[] = [
    {
      id: "sa_apple",
      userId: user.id,
      providerId: "apple-health",
      platform: "mobile",
      status: "connected",
      lastSyncAt: iso(new Date(now.getTime() - 2 * HOUR)),
      syncFreshnessHours: 2,
      capabilities: ["connect", "exchange_session", "sync_history", "sync_incremental", "source_filtering"],
      externalUserId: "apple-ada",
      connectionLabel: "Ada's Apple Health"
    },
    {
      id: "sa_healthconnect",
      userId: user.id,
      providerId: "health-connect",
      platform: "mobile",
      status: "connected",
      lastSyncAt: iso(new Date(now.getTime() - 3 * HOUR)),
      syncFreshnessHours: 3,
      capabilities: ["connect", "exchange_session", "sync_history", "offline_queue"],
      externalUserId: "hc-ada",
      connectionLabel: "Ada's Health Connect"
    },
    {
      id: "sa_whoop",
      userId: user.id,
      providerId: "whoop",
      platform: "cloud",
      status: "connected",
      lastSyncAt: iso(new Date(now.getTime() - HOUR)),
      syncFreshnessHours: 1,
      capabilities: ["connect", "sync_history", "sync_incremental", "subscribe_updates"],
      externalUserId: "whoop-ada",
      connectionLabel: "Ada's WHOOP"
    },
    {
      id: "sa_oura",
      userId: user.id,
      providerId: "oura",
      platform: "cloud",
      status: "connected",
      lastSyncAt: iso(new Date(now.getTime() - 90 * 60 * 1000)),
      syncFreshnessHours: 1.5,
      capabilities: ["connect", "sync_history", "sync_incremental", "subscribe_updates"],
      externalUserId: "oura-ada",
      connectionLabel: "Ada's Oura"
    },
    {
      id: "sa_garmin",
      userId: user.id,
      providerId: "garmin",
      platform: "cloud",
      status: "stale",
      lastSyncAt: iso(new Date(now.getTime() - 31 * HOUR)),
      syncFreshnessHours: 31,
      capabilities: ["connect", "sync_history", "sync_incremental"],
      externalUserId: "garmin-ada",
      connectionLabel: "Ada's Garmin"
    },
    {
      id: "sa_strava",
      userId: user.id,
      providerId: "strava",
      platform: "cloud",
      status: "connected",
      lastSyncAt: iso(new Date(now.getTime() - 4 * HOUR)),
      syncFreshnessHours: 4,
      capabilities: ["connect", "sync_history", "sync_incremental", "subscribe_updates"],
      externalUserId: "strava-ada",
      connectionLabel: "Ada's Strava"
    }
  ];

  return rows.map((row) =>
    SourceAccountSchema.parse({
      ...row,
      metricCapabilities: metricCapabilitiesForProvider(row.providerId),
      connectionMode: connectionModeForProvider(row.providerId),
      ...(overrides[row.providerId] ?? {})
    })
  );
};

export const createDemoDevices = (user: User, sourceAccounts: SourceAccount[], now = new Date()): Device[] =>
  sourceAccounts.map((sourceAccount) =>
    DeviceSchema.parse({
      id: `device_${sourceAccount.providerId}`,
      userId: user.id,
      sourceAccountId: sourceAccount.id,
      providerId: sourceAccount.providerId,
      name: deviceModelForProvider(sourceAccount.providerId),
      model: deviceModelForProvider(sourceAccount.providerId),
      platform: sourceAccount.platform === "mobile" ? "on-device" : "cloud",
      lastSeenAt: iso(new Date(now.getTime() - sourceAccount.syncFreshnessHours * HOUR))
    })
  );

export const createDemoConsentGrants = (user: User, sourceAccounts: SourceAccount[], now = new Date()): ConsentGrant[] =>
  sourceAccounts.map((sourceAccount) =>
    ConsentGrantSchema.parse({
      id: `consent_${sourceAccount.id}`,
      userId: user.id,
      sourceAccountId: sourceAccount.id,
      scopes:
        sourceAccount.providerId === "strava"
          ? ["read.workouts", "read.activity"]
          : ["read.sleep", "read.workouts", "read.activity", "read.raw"],
      grantedAt: iso(new Date(now.getTime() - 44 * DAY)),
      revokedAt: null
    })
  );

const createObservation = (input: {
  id: string;
  userId: string;
  sourceAccountId: string;
  deviceId: string | null;
  metricFamily: Observation["metricFamily"];
  metric: string;
  value: number;
  unit: string;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  providerId: ProviderId;
  timezone: string;
  sourceRecordId: string;
  captureMode: "direct" | "mirrored" | "manual" | "imported" | "derived";
  confidence: number;
  bundleId?: string | null;
  packageName?: string | null;
}): Observation => {
  const dedupeGroupId = createId("dedupe", input.userId, input.metricFamily, input.metric, iso(input.startAt), canonicalSourceKey(input.sourceRecordId));
  return ObservationSchema.parse({
    id: input.id,
    kind: "observation",
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    deviceId: input.deviceId,
    metricFamily: input.metricFamily,
    metric: input.metric,
    value: round(input.value),
    normalizedValue: round(input.value),
    startAt: iso(input.startAt),
    endAt: iso(input.endAt),
    createdAt: iso(input.createdAt),
    tags: [],
    ...buildProvenance(
      input.providerId,
      input.sourceRecordId,
      input.timezone,
      input.metric,
      input.unit,
      0,
      input.confidence,
      dedupeGroupId,
      input.captureMode,
      [],
      `${input.providerId} emitted the original ${input.metric} sample.`,
      {
        bundleId: input.bundleId ?? null,
        packageName: input.packageName ?? null
      }
    )
  });
};

const createEpisode = (input: {
  id: string;
  userId: string;
  sourceAccountId: string;
  deviceId: string | null;
  episodeType: Episode["episodeType"];
  title: string;
  metrics: Record<string, number>;
  startAt: Date;
  endAt: Date;
  createdAt: Date;
  providerId: ProviderId;
  timezone: string;
  sourceRecordId: string;
  captureMode: "direct" | "mirrored" | "manual" | "imported" | "derived";
  confidence: number;
  bundleId?: string | null;
  packageName?: string | null;
}): Episode => {
  const dedupeGroupId = createId("dedupe", input.userId, input.episodeType, iso(input.startAt), canonicalSourceKey(input.sourceRecordId));
  return EpisodeSchema.parse({
    id: input.id,
    kind: "episode",
    userId: input.userId,
    sourceAccountId: input.sourceAccountId,
    deviceId: input.deviceId,
    metricFamily: input.episodeType === "sleep" ? "sleep" : "workout",
    episodeType: input.episodeType,
    title: input.title,
    metrics: Object.fromEntries(Object.entries(input.metrics).map(([key, value]) => [key, round(value)])),
    notes: null,
    startAt: iso(input.startAt),
    endAt: iso(input.endAt),
    createdAt: iso(input.createdAt),
    ...buildProvenance(
      input.providerId,
      input.sourceRecordId,
      input.timezone,
      input.episodeType,
      input.episodeType === "sleep" ? "hours" : "load",
      0,
      input.confidence,
      dedupeGroupId,
      input.captureMode,
      [],
      `${input.providerId} emitted the original ${input.episodeType} event.`,
      {
        bundleId: input.bundleId ?? null,
        packageName: input.packageName ?? null
      }
    )
  });
};

const createRawEvent = (
  userId: string,
  sourceAccountId: string,
  providerId: ProviderId,
  sourceRecordId: string,
  eventType: string,
  capturedAt: Date,
  payload: Record<string, unknown>
): RawEvent =>
  RawEventSchema.parse({
    id: createId("raw", providerId, sourceRecordId),
    userId,
    sourceAccountId,
    providerId,
    eventType,
    sourceRecordId,
    capturedAt: iso(capturedAt),
    payload
  });

export const createProviderMockPayload = ({ user, sourceAccount, device, now }: PayloadInput): NormalizedPayload => {
  const rawEvents: RawEvent[] = [];
  const observations: Observation[] = [];
  const episodes: Episode[] = [];
  const timezone = user.timezone;

  for (let index = 34; index >= 0; index -= 1) {
    const profile = createDailyProfile(index, now, timezone);
    const day = formatDay(profile.day, timezone);
    const capturedAt = new Date(profile.day.getTime() + 18 * HOUR);
    const sourceKey = `${sourceAccount.providerId}:${day}`;

    if (sourceAccount.providerId === "whoop") {
      const sleepId = `whoop-sleep-${day}`;
      rawEvents.push(
        createRawEvent(user.id, sourceAccount.id, "whoop", sleepId, "sleep", capturedAt, {
          durationHours: profile.durationHours,
          hrv: profile.hrv,
          restingHeartRate: profile.restingHeartRate
        })
      );
      episodes.push(
        createEpisode({
          id: createId("episode", "whoop", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          episodeType: "sleep",
          title: "WHOOP Sleep",
          metrics: {
            duration_hours: profile.durationHours,
            recovery_load: Math.max(10, 100 - profile.load)
          },
          startAt: profile.sleepStart,
          endAt: profile.sleepEnd,
          createdAt: capturedAt,
          providerId: "whoop",
          timezone,
          sourceRecordId: sleepId,
          captureMode: "direct",
          confidence: 0.95
        })
      );
      observations.push(
        createObservation({
          id: createId("obs", "whoop", "hrv", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          metricFamily: "recovery",
          metric: "hrv_rmssd",
          value: profile.hrv,
          unit: "ms",
          startAt: profile.sleepEnd,
          endAt: new Date(profile.sleepEnd.getTime() + 5 * 60 * 1000),
          createdAt: capturedAt,
          providerId: "whoop",
          timezone,
          sourceRecordId: `whoop-hrv-${day}`,
          captureMode: "direct",
          confidence: 0.97
        }),
        createObservation({
          id: createId("obs", "whoop", "rhr", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          metricFamily: "cardiovascular",
          metric: "resting_heart_rate",
          value: profile.restingHeartRate,
          unit: "bpm",
          startAt: profile.sleepEnd,
          endAt: new Date(profile.sleepEnd.getTime() + 5 * 60 * 1000),
          createdAt: capturedAt,
          providerId: "whoop",
          timezone,
          sourceRecordId: `whoop-rhr-${day}`,
          captureMode: "direct",
          confidence: 0.97,
          bundleId: "com.whoop.mobile"
        })
      );
    }

    if (sourceAccount.providerId === "apple-health") {
      rawEvents.push(
        createRawEvent(user.id, sourceAccount.id, "apple-health", `mirror:whoop-sleep-${day}`, "sleep", capturedAt, {
          mirroredFrom: "whoop",
          sourceApp: "com.whoop.mobile",
          durationHours: profile.durationHours
        })
      );
      episodes.push(
        createEpisode({
          id: createId("episode", "apple", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          episodeType: "sleep",
          title: "Apple Health Mirrored Sleep",
          metrics: { duration_hours: profile.durationHours },
          startAt: profile.sleepStart,
          endAt: profile.sleepEnd,
          createdAt: capturedAt,
          providerId: "apple-health",
          timezone,
          sourceRecordId: `mirror:whoop-sleep-${day}`,
          captureMode: "mirrored",
          confidence: 0.8,
          bundleId: "com.whoop.mobile"
        })
      );
      observations.push(
        createObservation({
          id: createId("obs", "apple", "steps", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          metricFamily: "activity",
          metric: "steps",
          value: profile.steps,
          unit: "count",
          startAt: profile.day,
          endAt: new Date(profile.day.getTime() + DAY),
          createdAt: capturedAt,
          providerId: "apple-health",
          timezone,
          sourceRecordId: `apple-steps-${day}`,
          captureMode: "direct",
          confidence: 0.92,
          bundleId: "com.apple.Health"
        }),
        createObservation({
          id: createId("obs", "apple", "hrv", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          metricFamily: "recovery",
          metric: "hrv_rmssd",
          value: profile.hrv - 1,
          unit: "ms",
          startAt: profile.sleepEnd,
          endAt: new Date(profile.sleepEnd.getTime() + 5 * 60 * 1000),
          createdAt: capturedAt,
          providerId: "apple-health",
          timezone,
          sourceRecordId: `mirror:whoop-hrv-${day}`,
          captureMode: "mirrored",
          confidence: 0.76,
          bundleId: "com.whoop.mobile"
        })
      );
    }

    if (sourceAccount.providerId === "health-connect") {
      observations.push(
        createObservation({
          id: createId("obs", "hc", "steps", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          metricFamily: "activity",
          metric: "steps",
          value: profile.steps * 0.98,
          unit: "count",
          startAt: profile.day,
          endAt: new Date(profile.day.getTime() + DAY),
          createdAt: capturedAt,
          providerId: "health-connect",
          timezone,
          sourceRecordId: `hc-steps-${day}`,
          captureMode: "direct",
          confidence: 0.9,
          packageName: "com.google.android.apps.healthdata"
        })
      );
      rawEvents.push(
        createRawEvent(user.id, sourceAccount.id, "health-connect", `hc-steps-${day}`, "steps", capturedAt, {
          steps: profile.steps * 0.98
        })
      );
    }

    if (sourceAccount.providerId === "oura") {
      observations.push(
        createObservation({
          id: createId("obs", "oura", "rhr", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          metricFamily: "cardiovascular",
          metric: "resting_heart_rate",
          value: profile.restingHeartRate - 0.5,
          unit: "bpm",
          startAt: profile.sleepEnd,
          endAt: new Date(profile.sleepEnd.getTime() + 5 * 60 * 1000),
          createdAt: capturedAt,
          providerId: "oura",
          timezone,
          sourceRecordId: `oura-rhr-${day}`,
          captureMode: "direct",
          confidence: 0.95
        })
      );
      rawEvents.push(
        createRawEvent(user.id, sourceAccount.id, "oura", `oura-rhr-${day}`, "resting_heart_rate", capturedAt, {
          restingHeartRate: profile.restingHeartRate - 0.5
        })
      );
    }

    if (sourceAccount.providerId === "garmin" && index % 3 === 0) {
      observations.push(
        createObservation({
          id: createId("obs", "garmin", "steps", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          metricFamily: "activity",
          metric: "steps",
          value: profile.steps * 1.03,
          unit: "count",
          startAt: profile.day,
          endAt: new Date(profile.day.getTime() + DAY),
          createdAt: capturedAt,
          providerId: "garmin",
          timezone,
          sourceRecordId: `garmin-steps-${day}`,
          captureMode: "direct",
          confidence: 0.86
        })
      );
      rawEvents.push(
        createRawEvent(user.id, sourceAccount.id, "garmin", `garmin-steps-${day}`, "steps", capturedAt, {
          steps: profile.steps * 1.03
        })
      );
    }

    if (sourceAccount.providerId === "strava" && index % 2 === 0) {
      const workoutStart = atLocalMinutes(profile.day, 18 * 60 + 20 + wave(index, 25));
      const workoutLoad = Math.max(18, profile.load);
      rawEvents.push(
        createRawEvent(user.id, sourceAccount.id, "strava", `strava-workout-${day}`, "workout", capturedAt, {
          trainingLoad: workoutLoad
        })
      );
      episodes.push(
        createEpisode({
          id: createId("episode", "strava", day),
          userId: user.id,
          sourceAccountId: sourceAccount.id,
          deviceId: device.id,
          episodeType: "workout",
          title: "Strava Tempo Run",
          metrics: {
            training_load: workoutLoad,
            duration_minutes: 52 + wave(index, 8),
            distance_km: 9.8 + wave(index, 1.2)
          },
          startAt: workoutStart,
          endAt: new Date(workoutStart.getTime() + (52 + wave(index, 8)) * 60 * 1000),
          createdAt: capturedAt,
          providerId: "strava",
          timezone,
          sourceRecordId: `strava-workout-${day}`,
          captureMode: "direct",
          confidence: 0.93
        })
      );
    }
  }

  return {
    rawEvents,
    observations,
    episodes,
    devices: [device]
  };
};

const toRuntimePrecedence = (override?: SourcePrecedenceOverride["precedence"]): Record<string, number> => ({
  ...DEFAULT_PRECEDENCE,
  ...(override ?? {})
});

const createDedupeDeps = (override?: SourcePrecedenceOverride["precedence"]) => ({
  createId,
  canonicalSourceKey,
  precedence: toRuntimePrecedence(override),
  createWhyPrimary,
  dedupePrecedenceVersion: DEDUPE_PRECEDENCE_VERSION,
  iso
});

const dedupeFingerprint = (input: {
  userId: string;
  sourceRecordId: string;
  metricFamily: MetricFamily;
  startAt: string;
  endAt: string;
  sourceApp: string;
  bundleId?: string | null;
  packageName?: string | null;
}): string => dedupeFingerprintStage(input, createDedupeDeps());

const dedupeTimelineWithDecisions = <T extends Observation | Episode>(
  entries: T[],
  now = new Date(),
  precedenceOverride?: SourcePrecedenceOverride["precedence"]
): { primaryEntries: T[]; decisions: DedupeDecision[] } => dedupeTimelineWithDecisionsStage(entries, createDedupeDeps(precedenceOverride), now);

const deriveDeps = {
  addDays,
  formatDay,
  buildProvenance,
  createId,
  round,
  localMinutes,
  average,
  meanAbsoluteDeviation,
  iso
};

const deriveDailySummaries = (context: DerivedContext): DemoState["dailySummaries"] => deriveDailySummariesStage(context, deriveDeps);

const deriveScores = (context: DerivedContext): Score[] => deriveScoresStage(context, deriveDeps);

const deriveInsights = (user: User, scores: Score[], now: Date): Insight[] => deriveInsightsStage(user, scores, now, deriveDeps);

const deriveRecommendations = (user: User, scores: Score[], now: Date): Recommendation[] =>
  deriveRecommendationsStage(user, scores, now, deriveDeps);

const workflowDeps = {
  iso,
  buildProvenance
};

const deriveAutomations = (user: User, now: Date): Automation[] => deriveAutomationsStage(user, now, workflowDeps);

const deriveAlerts = (
  user: User,
  sourceAccounts: SourceAccount[],
  scores: Score[],
  dailySummaries: DemoState["dailySummaries"],
  now: Date
): Alert[] => deriveAlertsStage(user, sourceAccounts, scores, dailySummaries, now, workflowDeps);

const deriveAutomationRuns = (user: User, alerts: Alert[], automations: Automation[], now: Date): AutomationRun[] =>
  deriveAutomationRunsStage(user, alerts, automations, now, workflowDeps);

const derivePolicies = (user: User, now: Date): AgentAccessPolicy[] => derivePoliciesStage(user, now, workflowDeps);

const deriveSourceFilters = (user: User, now: Date): SourceFilter[] => deriveSourceFiltersStage(user, now, workflowDeps);

const deriveSyncAnchors = (user: User, sourceAccounts: SourceAccount[]): SyncAnchor[] => deriveSyncAnchorsStage(user, sourceAccounts);

const deriveAuditLogs = (user: User, policies: AgentAccessPolicy[], alerts: Alert[], now: Date): DemoState["auditLogs"] =>
  deriveAuditLogsStage(user, policies, alerts, now, workflowDeps);

const deriveOutbox = (user: User, alerts: Alert[], scores: Score[], now: Date): CloudEvent[] =>
  deriveOutboxStage(user, alerts, scores, now, workflowDeps);

export const buildDemoState = (now = new Date(), sourceOverrides: SourceOverrides = {}): DemoState => {
  const user = createDemoUser(now);
  const sourceAccounts = createDemoSourceAccounts(user, now, sourceOverrides);
  const devices = createDemoDevices(user, sourceAccounts, now);
  const consentGrants = createDemoConsentGrants(user, sourceAccounts, now);

  const payloads = sourceAccounts.map((sourceAccount) =>
    createProviderMockPayload({
      user,
      sourceAccount,
      device: devices.find((device) => device.sourceAccountId === sourceAccount.id)!,
      now
    })
  );

  const rawEvents = payloads.flatMap((payload) => payload.rawEvents);
  const dedupedObservations = dedupeTimelineWithDecisions(payloads.flatMap((payload) => payload.observations), now, undefined);
  const dedupedEpisodes = dedupeTimelineWithDecisions(payloads.flatMap((payload) => payload.episodes), now, undefined);
  const observations = dedupedObservations.primaryEntries;
  const episodes = dedupedEpisodes.primaryEntries;
  const dedupeDecisions = [...dedupedObservations.decisions, ...dedupedEpisodes.decisions];
  const dailySummaries = deriveDailySummaries({ user, sourceAccounts, observations, episodes, now });
  const scores = deriveScores({ user, sourceAccounts, observations, episodes, now });
  const insights = deriveInsights(user, scores, now);
  const recommendations = deriveRecommendations(user, scores, now);
  const automations = deriveAutomations(user, now);
  const alerts = deriveAlerts(user, sourceAccounts, scores, dailySummaries, now);
  const automationRuns = deriveAutomationRuns(user, alerts, automations, now);
  const policies = derivePolicies(user, now);
  const sourceFilters = deriveSourceFilters(user, now);
  const syncAnchors = deriveSyncAnchors(user, sourceAccounts);
  const auditLogs = deriveAuditLogs(user, policies, alerts, now);
  const outbox = deriveOutbox(user, alerts, scores, now);
  const feedback = [] as Feedback[];
  const ingestFailures = [] as IngestFailure[];
  const agentTokens = [] as AgentToken[];

  return DemoStateSchema.parse({
    user,
    sourceAccounts,
    devices,
    consentGrants,
    rawEvents,
    observations,
    episodes,
    dailySummaries,
    scores,
    insights,
    recommendations,
    alerts,
    automations,
    automationRuns,
    feedback: feedback.map((row) => FeedbackSchema.parse(row)),
    policies,
    auditLogs,
    outbox,
    connectorSessions: [],
    syncAnchors,
    sourceFilters,
    sourcePrecedenceOverrides: [],
    ingestBatches: [],
    ingestFailures: ingestFailures.map((row) => IngestFailureSchema.parse(row)),
    ingestRecords: [],
    dedupeDecisions,
    agentTokens: agentTokens.map((row) => AgentTokenSchema.parse(row))
  });
};

export const buildLiveState = (input: {
  userId?: string;
  name?: string;
  timezone?: string;
  providerIds?: ProviderId[];
  now?: Date;
} = {}): DemoState => {
  const now = input.now ?? new Date();
  const providerIds = input.providerIds ?? [...PROVIDER_IDS];
  const user = UserSchema.parse({
    id: input.userId ?? "user_live",
    name: input.name ?? "Live User",
    timezone: input.timezone ?? "UTC",
    createdAt: iso(now)
  });

  const sourceAccounts = providerIds.map((providerId) =>
    SourceAccountSchema.parse({
      id: `sa_${providerId}`,
      userId: user.id,
      providerId,
      platform: providerClass(providerId),
      status: "stale",
      lastSyncAt: iso(new Date(now.getTime() - 48 * HOUR)),
      syncFreshnessHours: 48,
      capabilities: capabilitiesForProvider(providerId),
      metricCapabilities: metricCapabilitiesForProvider(providerId),
      connectionMode: connectionModeForProvider(providerId),
      externalUserId: `${providerId}-${user.id}`,
      connectionLabel: `${user.name}'s ${providerId}`
    })
  );
  const devices = createDemoDevices(user, sourceAccounts, now);
  const consentGrants = sourceAccounts.map((sourceAccount) =>
    ConsentGrantSchema.parse({
      id: `consent_${sourceAccount.id}`,
      userId: user.id,
      sourceAccountId: sourceAccount.id,
      scopes: ["read.sleep", "read.workouts", "read.activity", "read.raw"],
      grantedAt: iso(now),
      revokedAt: null
    })
  );
  const automations = deriveAutomations(user, now);
  const policies = derivePolicies(user, now);
  const sourceFilters = deriveSourceFilters(user, now);
  const syncAnchors = deriveSyncAnchors(user, sourceAccounts);
  const alerts: Alert[] = [];
  const scores: Score[] = [];
  const auditLogs = deriveAuditLogs(user, policies, alerts, now);

  return DemoStateSchema.parse({
    user,
    sourceAccounts,
    devices,
    consentGrants,
    rawEvents: [],
    observations: [],
    episodes: [],
    dailySummaries: [],
    scores,
    insights: [],
    recommendations: [],
    alerts,
    automations,
    automationRuns: [],
    feedback: [],
    policies,
    auditLogs,
    outbox: [],
    connectorSessions: [],
    syncAnchors,
    sourceFilters,
    sourcePrecedenceOverrides: [],
    ingestBatches: [],
    ingestFailures: [],
    ingestRecords: [],
    dedupeDecisions: [],
    agentTokens: []
  });
};

export const explainEntity = (state: DemoState, entity: string, id: string) => {
  const collectionMap = {
    observation: state.observations,
    episode: state.episodes,
    daily_summary: state.dailySummaries,
    score: state.scores,
    alert: state.alerts,
    automation_run: state.automationRuns
  } as const;

  const collection = collectionMap[entity as keyof typeof collectionMap];
  const payload = collection?.find((row: { id: string }) => row.id === id);
  if (!payload) {
    return null;
  }

  const payloadFingerprint =
    "sourceRecordId" in payload && "metricFamily" in payload && "startAt" in payload && "endAt" in payload && "sourceApp" in payload
      ? dedupeFingerprint({
          userId: payload.userId,
          sourceRecordId: payload.sourceRecordId,
          metricFamily: payload.metricFamily,
          startAt: payload.startAt,
          endAt: payload.endAt,
          sourceApp: payload.sourceApp,
          bundleId: payload.bundleId ?? null,
          packageName: payload.packageName ?? null
        })
      : null;

  const lastSyncAt =
    "source" in payload
      ? state.sourceAccounts.find((account) => account.providerId === payload.source)?.lastSyncAt ?? null
      : null;

  const dedupeDecision =
    payloadFingerprint || "dedupeGroupId" in payload
      ? state.dedupeDecisions.find((decision) => {
          if (payloadFingerprint && decision.fingerprint === payloadFingerprint) {
            return true;
          }
          if ("sourceRecordId" in payload && decision.primary.sourceRecordId === payload.sourceRecordId) {
            return true;
          }
          return false;
        })
      : undefined;

  const suppressedRecords = dedupeDecision
    ? dedupeDecision.suppressed.map((candidate) => ({
        source: candidate.source,
        sourceRecordId: candidate.sourceRecordId,
        sourceApp: candidate.sourceApp,
        bundleId: candidate.bundleId ?? null,
        packageName: candidate.packageName ?? null,
        captureMode: candidate.captureMode,
        reason: dedupeDecision.reason
      }))
    : [];

  return {
    entity,
    id,
    whyPrimary: "whyPrimary" in payload ? payload.whyPrimary : "Automation runs are derived from workflow execution.",
    suppressedSources: "suppressedSources" in payload ? payload.suppressedSources : [],
    dataGranularity: "dataGranularity" in payload ? payload.dataGranularity : "score",
    latencyClass: "latencyClass" in payload ? payload.latencyClass : "daily",
    freshnessHours: "freshnessHours" in payload ? payload.freshnessHours : 0,
    confidence: "confidence" in payload ? payload.confidence : 0,
    lastSyncAt,
    lastSuccessfulSyncAt: lastSyncAt,
    provenanceChain: "provenanceChain" in payload ? payload.provenanceChain : [],
    dedupeFingerprint: dedupeDecision?.fingerprint ?? payloadFingerprint ?? ("dedupeGroupId" in payload ? payload.dedupeGroupId : null),
    precedenceVersion: dedupeDecision?.precedenceVersion ?? DEDUPE_PRECEDENCE_VERSION,
    dedupePolicy: dedupeDecision?.policy ?? null,
    ignoredBySourceFilter: dedupeDecision?.ignoredBySourceFilter ?? false,
    decisionTrace:
      dedupeDecision?.decisionTrace ?? [
        "No persisted decision trace found for this entity.",
        `Fallback precedence version: ${DEDUPE_PRECEDENCE_VERSION}`
      ],
    suppressionReasons: dedupeDecision ? [dedupeDecision.reason] : [],
    suppressedRecords,
    evidence: "evidenceSet" in payload ? payload.evidenceSet : [],
    payload
  };
};

const MOBILE_PROVIDER_IDS: ProviderId[] = ["apple-health", "health-connect"];

const isMobileProvider = (providerId: ProviderId): boolean => MOBILE_PROVIDER_IDS.includes(providerId);

const calculateFreshnessHours = (lastSyncAt: string, now: Date): number => round(Math.max((now.getTime() - new Date(lastSyncAt).getTime()) / HOUR, 0));

const ingestDeps = {
  calculateFreshnessHours,
  iso,
  round,
  createId,
  canonicalSourceKey,
  deviceModelForProvider,
  buildProvenance
};

const refreshSourceAccounts = (
  sourceAccounts: SourceAccount[],
  now: Date,
  syncedProviderIds: ProviderId[] = []
): SourceAccount[] => refreshSourceAccountsStage(sourceAccounts, now, syncedProviderIds, ingestDeps);

const applyRecommendationGate = (sourceAccounts: SourceAccount[], recommendations: Recommendation[]) =>
  applyRecommendationGateStage(sourceAccounts, recommendations);

const shouldSkipRestoredCandidate = (
  state: DemoState,
  candidate: Pick<DedupeDecision["suppressed"][number], "source" | "captureMode" | "sourceApp">,
  userId: string
): boolean =>
  candidate.captureMode === "mirrored" &&
  (state.sourceFilters.find((filter) => filter.userId === userId && filter.providerId === candidate.source)?.ignoredSources.includes(candidate.sourceApp) ??
    false);

const restoreSuppressedObservationCandidates = (state: DemoState): Observation[] => {
  const candidateKey = (entry: Observation): string =>
    createId("observation", entry.userId, entry.source, entry.sourceRecordId, entry.metric, entry.startAt, entry.endAt);
  const seen = new Set(state.observations.map(candidateKey));
  const restored: Observation[] = [];

  for (const decision of state.dedupeDecisions) {
    if (decision.ignoredBySourceFilter) {
      continue;
    }
    const primary = state.observations.find(
      (entry) =>
        entry.source === decision.primary.source &&
        entry.sourceRecordId === decision.primary.sourceRecordId &&
        entry.metricFamily === decision.metricFamily
    );
    if (!primary) {
      continue;
    }

    for (const candidate of decision.suppressed) {
      if (shouldSkipRestoredCandidate(state, candidate, primary.userId)) {
        continue;
      }
      const restoredCandidate = ObservationSchema.parse({
        ...primary,
        id: createId("obs", candidate.source, canonicalSourceKey(candidate.sourceRecordId), primary.metric, primary.startAt),
        sourceAccountId: state.sourceAccounts.find((account) => account.userId === primary.userId && account.providerId === candidate.source)?.id ?? primary.sourceAccountId,
        deviceId: state.devices.find((device) => device.userId === primary.userId && device.providerId === candidate.source)?.id ?? primary.deviceId,
        source: candidate.source,
        sourceRecordId: candidate.sourceRecordId,
        sourceApp: candidate.sourceApp,
        bundleId: candidate.bundleId ?? null,
        packageName: candidate.packageName ?? null,
        captureMode: candidate.captureMode,
        confidence: candidate.confidence,
        freshnessHours: candidate.freshnessHours,
        provenanceChain: [
          {
            providerId: candidate.source,
            sourceRecordId: candidate.sourceRecordId,
            captureMode: candidate.captureMode,
            role: candidate.captureMode === "mirrored" ? "mirror" : "suppressed"
          }
        ],
        suppressedSources: [],
        whyPrimary: `${candidate.source} restored as a suppressed dedupe candidate for precedence recomputation.`
      });
      const key = candidateKey(restoredCandidate);
      if (!seen.has(key)) {
        seen.add(key);
        restored.push(restoredCandidate);
      }
    }
  }

  return [...state.observations, ...restored];
};

const restoreSuppressedEpisodeCandidates = (state: DemoState): Episode[] => {
  const candidateKey = (entry: Episode): string =>
    createId("episode", entry.userId, entry.source, entry.sourceRecordId, entry.episodeType, entry.startAt, entry.endAt);
  const seen = new Set(state.episodes.map(candidateKey));
  const restored: Episode[] = [];

  for (const decision of state.dedupeDecisions) {
    if (decision.ignoredBySourceFilter) {
      continue;
    }
    const primary = state.episodes.find(
      (entry) =>
        entry.source === decision.primary.source &&
        entry.sourceRecordId === decision.primary.sourceRecordId &&
        entry.metricFamily === decision.metricFamily
    );
    if (!primary) {
      continue;
    }

    for (const candidate of decision.suppressed) {
      if (shouldSkipRestoredCandidate(state, candidate, primary.userId)) {
        continue;
      }
      const restoredCandidate = EpisodeSchema.parse({
        ...primary,
        id: createId("episode", candidate.source, canonicalSourceKey(candidate.sourceRecordId), primary.episodeType, primary.startAt),
        sourceAccountId: state.sourceAccounts.find((account) => account.userId === primary.userId && account.providerId === candidate.source)?.id ?? primary.sourceAccountId,
        deviceId: state.devices.find((device) => device.userId === primary.userId && device.providerId === candidate.source)?.id ?? primary.deviceId,
        title: candidate.captureMode === "mirrored" ? `${candidate.source} Mirrored ${primary.episodeType}` : primary.title,
        source: candidate.source,
        sourceRecordId: candidate.sourceRecordId,
        sourceApp: candidate.sourceApp,
        bundleId: candidate.bundleId ?? null,
        packageName: candidate.packageName ?? null,
        captureMode: candidate.captureMode,
        confidence: candidate.confidence,
        freshnessHours: candidate.freshnessHours,
        provenanceChain: [
          {
            providerId: candidate.source,
            sourceRecordId: candidate.sourceRecordId,
            captureMode: candidate.captureMode,
            role: candidate.captureMode === "mirrored" ? "mirror" : "suppressed"
          }
        ],
        suppressedSources: [],
        whyPrimary: `${candidate.source} restored as a suppressed dedupe candidate for precedence recomputation.`
      });
      const key = candidateKey(restoredCandidate);
      if (!seen.has(key)) {
        seen.add(key);
        restored.push(restoredCandidate);
      }
    }
  }

  return [...state.episodes, ...restored];
};

const recomputeMaterializedState = (
  state: DemoState,
  now: Date,
  syncedProviderIds: ProviderId[] = []
): { state: DemoState; staleGateApplied: boolean } => {
  const sourceAccounts = refreshSourceAccounts(state.sourceAccounts, now, syncedProviderIds);
  const precedenceOverride = state.sourcePrecedenceOverrides.find((row) => row.userId === state.user.id)?.precedence;
  const dedupedObservations = dedupeTimelineWithDecisions(restoreSuppressedObservationCandidates(state), now, precedenceOverride);
  const dedupedEpisodes = dedupeTimelineWithDecisions(restoreSuppressedEpisodeCandidates(state), now, precedenceOverride);
  const observations = dedupedObservations.primaryEntries;
  const episodes = dedupedEpisodes.primaryEntries;
  const dedupeDecisions = [...dedupedObservations.decisions, ...dedupedEpisodes.decisions];
  const dailySummaries = deriveDailySummaries({ user: state.user, sourceAccounts, observations, episodes, now });
  const scores = deriveScores({ user: state.user, sourceAccounts, observations, episodes, now });
  const insights = deriveInsights(state.user, scores, now);
  const recommendationGate = applyRecommendationGate(sourceAccounts, deriveRecommendations(state.user, scores, now));
  const automations = state.automations.length > 0 ? state.automations : deriveAutomations(state.user, now);
  const alerts = deriveAlerts(state.user, sourceAccounts, scores, dailySummaries, now);
  const automationRuns = deriveAutomationRuns(state.user, alerts, automations, now);
  const policies = state.policies.length > 0 ? state.policies : derivePolicies(state.user, now);
  const outbox = deriveOutbox(state.user, alerts, scores, now);

  return {
    staleGateApplied: recommendationGate.staleGateApplied,
    state: DemoStateSchema.parse({
      ...state,
      sourceAccounts,
      observations,
      episodes,
      dailySummaries,
      scores,
      insights,
      recommendations: recommendationGate.recommendations,
      alerts,
      automations,
      automationRuns,
      policies,
      outbox,
      dedupeDecisions
    })
  };
};

const findSourceAccount = (state: DemoState, userId: string, providerId: ProviderId): SourceAccount =>
  findSourceAccountStage(state, userId, providerId);

const findOrCreateDevice = (state: DemoState, sourceAccount: SourceAccount, now: Date): Device =>
  findOrCreateDeviceStage(state, sourceAccount, now, ingestDeps);

const projectIngestRecords = (input: {
  user: User;
  providerId: ProviderId;
  sourceAccount: SourceAccount;
  device: Device;
  records: IngestRecord[];
  idempotencyKey: string;
  batchId: string;
  now: Date;
}) => projectIngestRecordsStage(input, ingestDeps);

export const normalizeIngestRecordsAsPayload = (input: {
  user: User;
  providerId: ProviderId;
  sourceAccount: SourceAccount;
  records: IngestRecord[];
  now?: Date;
  idempotencyKey?: string;
  batchId?: string;
  device?: Device;
}): NormalizedPayload => {
  const now = input.now ?? new Date();
  const device =
    input.device ??
    DeviceSchema.parse({
      id: `device_${input.providerId}_${input.user.id}`,
      userId: input.user.id,
      sourceAccountId: input.sourceAccount.id,
      providerId: input.providerId,
      name: deviceModelForProvider(input.providerId),
      model: deviceModelForProvider(input.providerId),
      platform: input.sourceAccount.platform === "mobile" ? "on-device" : "cloud",
      lastSeenAt: iso(now)
    });

  const projection = projectIngestRecords({
    user: input.user,
    providerId: input.providerId,
    sourceAccount: input.sourceAccount,
    device,
    records: input.records,
    idempotencyKey: input.idempotencyKey ?? createId("collector", "payload", String(now.getTime())),
    batchId: input.batchId ?? createId("collector", "batch", input.providerId, String(now.getTime())),
    now
  });

  return NormalizedPayloadSchema.parse({
    rawEvents: projection.rawEvents,
    observations: projection.observations,
    episodes: projection.episodes,
    devices: [device]
  });
};

export const createConnectorSession = (
  state: DemoState,
  userId: string,
  providerId: ProviderId,
  now = new Date()
): { state: DemoState; response: ConnectSessionResponse } => {
  if (state.user.id !== userId) {
    throw new Error(`Unknown user ${userId}.`);
  }
  if (!isMobileProvider(providerId)) {
    throw new Error(`Connector session is only supported for mobile providers, received ${providerId}.`);
  }

  findSourceAccount(state, userId, providerId);
  const session = ConnectorSessionSchema.parse({
    id: createId("session", providerId, userId, String(now.getTime())),
    userId,
    providerId,
    sessionToken: createId("token", providerId, userId, String(now.getTime()), Math.random().toString(36).slice(2, 8)),
    status: "active",
    createdAt: iso(now),
    expiresAt: iso(new Date(now.getTime() + 15 * 60 * 1000))
  });

  const connectorSessions = [
    ...state.connectorSessions.filter((row) => !(row.userId === userId && row.providerId === providerId && row.status === "active")),
    session
  ];

  return {
    state: DemoStateSchema.parse({
      ...state,
      connectorSessions
    }),
    response: ConnectSessionResponseSchema.parse({
      userId,
      providerId,
      sessionId: session.id,
      sessionToken: session.sessionToken,
      connectionMethod: "sdk-ingest",
      connectionMode: "mobile_permission",
      expiresAt: session.expiresAt
    })
  };
};

export const setSourceFilter = (
  state: DemoState,
  userId: string,
  providerId: ProviderId,
  input: SourceFilterInput,
  now = new Date()
): { state: DemoState; sourceFilter: SourceFilter } => {
  if (state.user.id !== userId) {
    throw new Error(`Unknown user ${userId}.`);
  }
  if (!isMobileProvider(providerId)) {
    throw new Error(`Source filtering is only supported for mobile providers, received ${providerId}.`);
  }
  const parsedInput = SourceFilterInputSchema.parse(input);
  const nextFilter = SourceFilterSchema.parse({
    id: `source_filter_${providerId}`,
    userId,
    providerId,
    ignoredSources: parsedInput.ignoredSources,
    updatedAt: iso(now)
  });

  const sourceFilters = [...state.sourceFilters.filter((row) => !(row.userId === userId && row.providerId === providerId)), nextFilter];
  return {
    state: DemoStateSchema.parse({
      ...state,
      sourceFilters
    }),
    sourceFilter: nextFilter
  };
};

export const setSourcePrecedence = (
  state: DemoState,
  userId: string,
  input: SourcePrecedenceInput,
  now = new Date()
): { state: DemoState; sourcePrecedenceOverride: SourcePrecedenceOverride } => {
  if (state.user.id !== userId) {
    throw new Error(`Unknown user ${userId}.`);
  }
  const parsedInput = SourcePrecedenceInputSchema.parse(input);
  const nextOverride = SourcePrecedenceOverrideSchema.parse({
    id: `source_precedence_${userId}`,
    userId,
    precedence: parsedInput.precedence,
    updatedAt: iso(now)
  });
  const sourcePrecedenceOverrides = [
    ...state.sourcePrecedenceOverrides.filter((row) => row.userId !== userId),
    nextOverride
  ];
  const recomputed = recomputeMaterializedState(
    DemoStateSchema.parse({
      ...state,
      sourcePrecedenceOverrides
    }),
    now
  );
  return {
    state: recomputed.state,
    sourcePrecedenceOverride: nextOverride
  };
};

type SyncStatusOptions = {
  dataModes?: Partial<Record<ProviderId, "demo" | "live">>;
  authStates?: Partial<Record<ProviderId, AuthState>>;
  connectionMethods?: Partial<Record<ProviderId, ConnectionMethod>>;
  connectionModes?: Partial<Record<ProviderId, ConnectionMode>>;
  credentialExpiresAt?: Partial<Record<ProviderId, string | null>>;
  lastCredentialErrors?: Partial<Record<ProviderId, string | null>>;
};

export const getSyncStatus = (state: DemoState, userId: string, now = new Date(), options: SyncStatusOptions = {}): SyncStatusResponse => {
  if (state.user.id !== userId) {
    throw new Error(`Unknown user ${userId}.`);
  }

  const sources = refreshSourceAccounts(state.sourceAccounts, now).map((sourceAccount) => {
    const anchor = state.syncAnchors.find((syncAnchor) => syncAnchor.userId === userId && syncAnchor.providerId === sourceAccount.providerId);
    const activeSessions = state.connectorSessions
      .filter(
        (session) =>
          session.userId === userId &&
          session.providerId === sourceAccount.providerId &&
          session.status === "active" &&
          new Date(session.expiresAt).getTime() > now.getTime()
      )
      .sort((left, right) => (left.expiresAt < right.expiresAt ? 1 : -1));
    const queueDepth = activeSessions.length;
    const failedIngestCount = state.ingestFailures.filter(
      (failure) => failure.userId === userId && failure.providerId === sourceAccount.providerId && failure.status === "failed"
    ).length;
    const providerSignalCount =
      state.observations.filter((observation) => observation.userId === userId && observation.source === sourceAccount.providerId).length +
      state.episodes.filter((episode) => episode.userId === userId && episode.source === sourceAccount.providerId).length;
    const lastBatch = state.ingestBatches
      .filter((batch) => batch.userId === userId && batch.providerId === sourceAccount.providerId)
      .sort((left, right) => (left.processedAt < right.processedAt ? 1 : -1))[0];
    const lastSuccessfulSyncAt =
      anchor && !anchor.lastError ? anchor.checkpointedAt : sourceAccount.status === "connected" ? sourceAccount.lastSyncAt : null;
    const dataQualityGate =
      sourceAccount.status !== "connected" || sourceAccount.syncFreshnessHours >= 24
        ? "stale"
        : providerSignalCount === 0
          ? "missing"
          : "ok";
    const stalenessReason =
      sourceAccount.status === "errored"
        ? anchor?.lastError ?? "provider_error"
        : sourceAccount.syncFreshnessHours >= 24
          ? "freshness_threshold_exceeded"
          : queueDepth > 0
            ? "pending_connector_session"
            : null;
    return {
      providerId: sourceAccount.providerId,
      status: sourceAccount.status,
      authState: options.authStates?.[sourceAccount.providerId] ?? "not_connected",
      lastSyncAt: sourceAccount.lastSyncAt,
      lastSuccessfulSyncAt,
      syncFreshnessHours: sourceAccount.syncFreshnessHours,
      stalenessReason,
      lastAnchor: anchor?.anchor ?? null,
      lastError: anchor?.lastError ?? null,
      pendingIngestBatches: queueDepth + failedIngestCount,
      dataQualityGate,
      dataMode: options.dataModes?.[sourceAccount.providerId] ?? "demo",
      connectionMethod: options.connectionMethods?.[sourceAccount.providerId] ?? "mock",
      connectionMode: options.connectionModes?.[sourceAccount.providerId] ?? sourceAccount.connectionMode,
      metricCapabilities: sourceAccount.metricCapabilities,
      credentialExpiresAt: options.credentialExpiresAt?.[sourceAccount.providerId] ?? null,
      lastCredentialError: options.lastCredentialErrors?.[sourceAccount.providerId] ?? null,
      lastIngestBatchId: lastBatch?.id ?? null,
      lastIngestAt: lastBatch?.processedAt ?? null,
      lastIngestRecordCount: lastBatch?.recordCount ?? null,
      lastAcceptedRecordCount: lastBatch?.acceptedRecordCount ?? null,
      lastDroppedRecordCount: lastBatch?.droppedRecordCount ?? null,
      lastDropReasons: lastBatch?.dropReasons ?? [],
      activeSessionExpiresAt: activeSessions[0]?.expiresAt ?? null,
      queueDepth,
      backoffUntil: null
    };
  });

  return SyncStatusResponseSchema.parse({
    userId,
    sources
  });
};

type SyncRunResult = {
  state: DemoState;
  syncedProviderIds: ProviderId[];
  outboxEvents: number;
  staleGateApplied: boolean;
};

const upsertById = <T extends { id: string }>(rows: T[], incoming: T[]): T[] => {
  if (incoming.length === 0) {
    return rows;
  }
  const index = new Map(rows.map((row) => [row.id, row] as const));
  for (const row of incoming) {
    index.set(row.id, row);
  }
  return [...index.values()];
};

export const runIncrementalSync = (
  state: DemoState,
  userId: string,
  providerId?: ProviderId,
  now = new Date()
): SyncRunResult => {
  if (state.user.id !== userId) {
    throw new Error(`Unknown user ${userId}.`);
  }

  const syncedProviderIds = providerId ? [providerId] : state.sourceAccounts.map((sourceAccount) => sourceAccount.providerId);
  const recomputed = recomputeMaterializedState(state, now, syncedProviderIds);

  const nextSyncAnchors = recomputed.state.syncAnchors.map((anchor) =>
    syncedProviderIds.includes(anchor.providerId)
      ? {
          ...anchor,
          checkpointedAt: iso(now),
          lastError: null
        }
      : anchor
  );

  const nextState = DemoStateSchema.parse({
    ...recomputed.state,
    syncAnchors: nextSyncAnchors,
    auditLogs: upsertById(recomputed.state.auditLogs, [
      {
        id: createId("audit", "sync", String(now.getTime())),
        actorType: "system",
        actorId: "openvitals",
        action: "sync.incremental",
        entityType: "source_account",
        entityId: providerId ?? "all",
        scope: "sync",
        createdAt: iso(now),
        details: {
          syncedProviderIds
        }
      }
    ])
  });

  return {
    state: nextState,
    syncedProviderIds,
    outboxEvents: nextState.outbox.length,
    staleGateApplied: recomputed.staleGateApplied
  };
};

export const runIncrementalSyncWithPayloads = (
  state: DemoState,
  userId: string,
  payloads: Partial<Record<ProviderId, NormalizedPayload>>,
  now = new Date()
): SyncRunResult => {
  if (state.user.id !== userId) {
    throw new Error(`Unknown user ${userId}.`);
  }

  const payloadEntries = Object.entries(payloads)
    .filter((entry): entry is [ProviderId, NormalizedPayload] => Boolean(entry[1]))
    .map(([providerId, payload]) => [ProviderIdSchema.parse(providerId), NormalizedPayloadSchema.parse(payload)] as const);
  const syncedProviderIds = payloadEntries.map(([providerId]) => providerId);

  if (syncedProviderIds.length === 0) {
    return runIncrementalSync(state, userId, undefined, now);
  }

  const mergedRawEvents = upsertById(state.rawEvents, payloadEntries.flatMap(([, payload]) => payload.rawEvents));
  const mergedObservations = upsertById(state.observations, payloadEntries.flatMap(([, payload]) => payload.observations));
  const mergedEpisodes = upsertById(state.episodes, payloadEntries.flatMap(([, payload]) => payload.episodes));
  const mergedDevices = upsertById(state.devices, payloadEntries.flatMap(([, payload]) => payload.devices));

  const collectorIngestBatches = payloadEntries.map(([providerId, payload]) => {
    const existingAnchor = state.syncAnchors.find((anchor) => anchor.userId === userId && anchor.providerId === providerId)?.anchor ?? null;
    const acceptedRecordCount = payload.observations.length + payload.episodes.length;
    return IngestBatchSchema.parse({
      id: createId("collector_batch", providerId, String(now.getTime())),
      userId,
      providerId,
      idempotencyKey: createId("collector_sync", providerId, String(now.getTime())),
      anchorBefore: existingAnchor,
      anchorAfter: existingAnchor,
      recordCount: acceptedRecordCount,
      acceptedRecordCount,
      droppedRecordCount: 0,
      dropReasons: [],
      status: "processed",
      receivedAt: iso(now),
      processedAt: iso(now),
      error: null
    });
  });

  const mergedState = DemoStateSchema.parse({
    ...state,
    rawEvents: mergedRawEvents,
    observations: mergedObservations,
    episodes: mergedEpisodes,
    devices: mergedDevices,
    ingestBatches: [...state.ingestBatches, ...collectorIngestBatches]
  });

  const recomputed = recomputeMaterializedState(mergedState, now, syncedProviderIds);

  const nextSyncAnchors = recomputed.state.syncAnchors.map((anchor) =>
    syncedProviderIds.includes(anchor.providerId)
      ? {
          ...anchor,
          checkpointedAt: iso(now),
          lastError: null
        }
      : anchor
  );

  const nextState = DemoStateSchema.parse({
    ...recomputed.state,
    syncAnchors: nextSyncAnchors,
    auditLogs: upsertById(recomputed.state.auditLogs, [
      {
        id: createId("audit", "sync", "collector", String(now.getTime())),
        actorType: "system",
        actorId: "openvitals",
        action: "sync.incremental.collector",
        entityType: "source_account",
        entityId: syncedProviderIds.join(","),
        scope: "sync",
        createdAt: iso(now),
        details: {
          syncedProviderIds
        }
      }
    ])
  });

  return {
    state: nextState,
    syncedProviderIds,
    outboxEvents: nextState.outbox.length,
    staleGateApplied: recomputed.staleGateApplied
  };
};

export const refreshDerivedState = (
  state: DemoState,
  userId: string,
  now = new Date()
): { state: DemoState; outboxEvents: number; staleGateApplied: boolean } => {
  if (state.user.id !== userId) {
    throw new Error(`Unknown user ${userId}.`);
  }

  const recomputed = recomputeMaterializedState(state, now, []);
  const nextState = DemoStateSchema.parse({
    ...recomputed.state,
    auditLogs: upsertById(recomputed.state.auditLogs, [
      {
        id: createId("audit", "refresh", String(now.getTime())),
        actorType: "system",
        actorId: "openvitals",
        action: "state.refresh.derived",
        entityType: "user",
        entityId: userId,
        scope: "runtime.refresh",
        createdAt: iso(now),
        details: {}
      }
    ])
  });

  return {
    state: nextState,
    outboxEvents: nextState.outbox.length,
    staleGateApplied: recomputed.staleGateApplied
  };
};

const hasTokenMatching = (tokens: string[], predicate: (token: string) => boolean): boolean =>
  tokens.some((token) => predicate(token.toLowerCase()));

const liveWorkoutMetadataTokens = (record: IngestRecord, collectorMeta: IngestBatchInput["collectorMeta"]): string[] => [
  record.sourceRecordId,
  record.sourceApp,
  record.bundleId ?? "",
  record.packageName ?? "",
  collectorMeta?.sdk ?? "",
  collectorMeta?.deviceModel ?? "",
  ...(record.tags ?? [])
];

const hasActiveWorkoutMarker = (tokens: string[]): boolean =>
  hasTokenMatching(
    tokens,
    (token) =>
      token.includes("hkliveworkoutbuilder") ||
      token.includes("hkworkoutsession") ||
      (token.includes("live") && token.includes("workout"))
  );

const hasAppleWatchMarker = (tokens: string[]): boolean => hasTokenMatching(tokens, (token) => token.includes("watch"));

const isAppleHealthLiveWorkoutHeartRate = (record: IngestRecord, collectorMeta: IngestBatchInput["collectorMeta"]): boolean => {
  const metadataTokens = liveWorkoutMetadataTokens(record, collectorMeta);
  return (
    record.kind === "observation" &&
    (record.metric === "heart_rate" || record.metric === "live_workout_heart_rate") &&
    record.captureMode === "direct" &&
    hasActiveWorkoutMarker(metadataTokens) &&
    hasAppleWatchMarker(metadataTokens)
  );
};

const validateLiveIngestSemantics = (
  providerId: ProviderId,
  records: IngestRecord[],
  collectorMeta: IngestBatchInput["collectorMeta"]
): void => {
  for (const record of records) {
    const claimsLive = record.dataGranularity === "live_signal" || record.latencyClass === "live";
    if (!claimsLive) {
      continue;
    }
    if (record.dataGranularity !== "live_signal" || record.latencyClass !== "live") {
      throw new Error("Live ingest records must pair dataGranularity=live_signal with latencyClass=live.");
    }
    if (providerId === "apple-health" && !isAppleHealthLiveWorkoutHeartRate(record, collectorMeta)) {
      throw new Error(
        "Apple Health live_signal/live records must be direct heart_rate observations from active Apple Watch workout sessions and include live-workout/watch metadata."
      );
    }
  }
};

export const ingestMobileBatch = (
  state: DemoState,
  userId: string,
  providerId: ProviderId,
  input: IngestBatchInput,
  now = new Date()
): { state: DemoState; result: IngestBatchResult } => {
  if (!isMobileProvider(providerId)) {
    throw new Error(`Ingest API is currently only supported for mobile providers. Received ${providerId}.`);
  }
  if (state.user.id !== userId) {
    throw new Error(`Unknown user ${userId}.`);
  }
  const parsedInput = IngestBatchInputSchema.parse(input);
  const sourceAccount = findSourceAccount(state, userId, providerId);
  const existingBatch = state.ingestBatches.find(
    (batch) => batch.userId === userId && batch.providerId === providerId && batch.idempotencyKey === parsedInput.idempotencyKey && batch.status !== "failed"
  );
  if (existingBatch) {
    return {
      state,
      result: IngestBatchResultSchema.parse({
        userId,
        providerId,
        batchId: existingBatch.id,
        idempotent: true,
        processedRecords: existingBatch.recordCount,
        acceptedRecords: existingBatch.acceptedRecordCount || existingBatch.recordCount,
        droppedRecords: existingBatch.droppedRecordCount,
        dropReasons: existingBatch.dropReasons,
        dedupeDecisions: state.dedupeDecisions.length,
        outboxEvents: state.outbox.length,
        staleGateApplied: state.sourceAccounts.some((sourceAccountRow) => sourceAccountRow.syncFreshnessHours >= 24),
        syncFreshnessHours: sourceAccount.syncFreshnessHours,
        anchorAfter: existingBatch.anchorAfter
      })
    };
  }
  const session = state.connectorSessions.find(
    (row) => row.userId === userId && row.providerId === providerId && row.sessionToken === parsedInput.sessionToken && row.status === "active"
  );
  if (!session || new Date(session.expiresAt).getTime() < now.getTime()) {
    throw new Error("Session token is invalid or expired. Create a fresh connector session before ingest.");
  }

  const sourceFilter = state.sourceFilters.find((filter) => filter.userId === userId && filter.providerId === providerId);
  const currentAnchor = state.syncAnchors.find((anchor) => anchor.userId === userId && anchor.providerId === providerId)?.anchor ?? null;
  if (parsedInput.anchorBefore !== undefined && currentAnchor && parsedInput.anchorBefore !== currentAnchor) {
    throw new Error(`Anchor mismatch for ${providerId}: expected ${currentAnchor}, received ${parsedInput.anchorBefore}.`);
  }
  const parsedRecords = parsedInput.records.map((record) => IngestRecordSchema.parse(record));
  validateLiveIngestSemantics(providerId, parsedRecords, parsedInput.collectorMeta);
  if (providerId === "apple-health") {
    const invalidMirrorRecord = parsedRecords.find((record) => record.captureMode === "mirrored" && !record.bundleId);
    if (invalidMirrorRecord) {
      throw new Error("Apple Health mirrored records must include bundleId to support provenance-safe dedupe.");
    }
  }
  const filteredRecords = parsedRecords.filter(
    (record) => !(record.captureMode === "mirrored" && sourceFilter?.ignoredSources.includes(record.sourceApp))
  );
  const droppedRecords = parsedRecords.length - filteredRecords.length;
  const dropReasons =
    droppedRecords > 0
      ? [
          {
            reason: "ignored_source_filter",
            count: droppedRecords
          }
        ]
      : [];
  const sourceFilterIgnoredDecisions = parsedRecords
    .filter((record) => record.captureMode === "mirrored" && sourceFilter?.ignoredSources.includes(record.sourceApp))
    .map((record) => {
      const fingerprint = dedupeFingerprint({
        userId,
        sourceRecordId: record.sourceRecordId,
        metricFamily: record.metricFamily,
        startAt: record.startAt,
        endAt: record.endAt,
        sourceApp: record.sourceApp,
        bundleId: record.bundleId ?? null,
        packageName: record.packageName ?? null
      });
      return DedupeDecisionSchema.parse({
        id: createId("dedupe_ignored", fingerprint),
        userId,
        providerId,
        fingerprint,
        metricFamily: record.metricFamily,
        precedenceVersion: DEDUPE_PRECEDENCE_VERSION,
        policyVersion: "v0.2.0",
        policy: {
          name: "source_filter_ignore",
          version: "v0.2.0"
        },
        reasonCode: "source_filter_ignored",
        origin: {
          sourceApp: record.sourceApp,
          bundleId: record.bundleId ?? null,
          packageName: record.packageName ?? null
        },
        ignoredBySourceFilter: true,
        primary: {
          source: providerId,
          sourceRecordId: record.sourceRecordId,
          sourceApp: record.sourceApp,
          bundleId: record.bundleId ?? null,
          packageName: record.packageName ?? null,
          captureMode: record.captureMode,
          confidence: record.confidence ?? 0.8,
          freshnessHours: sourceAccount.syncFreshnessHours
        },
        suppressed: [],
        reason: `Record ignored because source app ${record.sourceApp} is configured in source_filters.`,
        decisionTrace: [
          "Record matched mirrored capture mode",
          `Source app ${record.sourceApp} matched ignored source filter`,
          "Record dropped before normalization and dedupe projection"
        ],
        decidedAt: iso(now)
      });
    });

  const batchId = createId("batch", providerId, parsedInput.idempotencyKey, String(now.getTime()));
  const device = findOrCreateDevice(state, sourceAccount, now);
  const projection = projectIngestRecords({
    user: state.user,
    providerId,
    sourceAccount,
    device,
    records: filteredRecords,
    idempotencyKey: parsedInput.idempotencyKey,
    batchId,
    now
  });

  const ingestBatch = {
    id: batchId,
    userId,
    providerId,
    idempotencyKey: parsedInput.idempotencyKey,
    anchorBefore: parsedInput.anchorBefore ?? null,
    anchorAfter: parsedInput.anchorAfter ?? parsedInput.anchorBefore ?? null,
    collectorMeta: parsedInput.collectorMeta ?? null,
    recordCount: filteredRecords.length,
    acceptedRecordCount: filteredRecords.length,
    droppedRecordCount: droppedRecords,
    dropReasons,
    status: "processed" as const,
    receivedAt: iso(now),
    processedAt: iso(now),
    error: null
  };

  const recomputed = recomputeMaterializedState(
    DemoStateSchema.parse({
      ...state,
      devices: [...state.devices.filter((existingDevice) => existingDevice.id !== device.id), device],
      rawEvents: [...state.rawEvents, ...projection.rawEvents],
      observations: [...state.observations, ...projection.observations],
      episodes: [...state.episodes, ...projection.episodes],
      ingestBatches: [...state.ingestBatches, ingestBatch],
      ingestRecords: [...state.ingestRecords, ...projection.envelopes],
      connectorSessions: state.connectorSessions.map((candidate) =>
        candidate.id === session.id ? { ...candidate, status: "exchanged" as const } : candidate
      ),
      syncAnchors: [
        ...state.syncAnchors.filter((anchor) => !(anchor.userId === userId && anchor.providerId === providerId)),
        SyncAnchorSchema.parse({
          id: `anchor_${providerId}`,
          userId,
          providerId,
          anchor: parsedInput.anchorAfter ?? parsedInput.anchorBefore ?? null,
          checkpointedAt: iso(now),
          lastError: null
        })
      ]
    }),
    now,
    [providerId]
  );

  const nextState = DemoStateSchema.parse({
    ...recomputed.state,
    dedupeDecisions: [...recomputed.state.dedupeDecisions, ...sourceFilterIgnoredDecisions],
    auditLogs: upsertById(recomputed.state.auditLogs, [
      {
        id: createId("audit", "ingest", providerId, String(now.getTime())),
        actorType: "system",
        actorId: "openvitals",
        action: "ingest.batch.processed",
        entityType: "ingest_batch",
        entityId: batchId,
        scope: "ingest",
        createdAt: iso(now),
        details: {
          providerId,
          idempotencyKey: parsedInput.idempotencyKey,
          recordsReceived: parsedInput.records.length,
          recordsAccepted: filteredRecords.length,
          recordsDropped: droppedRecords,
          dropReasons
        }
      }
    ])
  });

  const refreshedSource = nextState.sourceAccounts.find((row) => row.providerId === providerId) ?? sourceAccount;
  return {
    state: nextState,
    result: IngestBatchResultSchema.parse({
      userId,
      providerId,
      batchId,
      idempotent: false,
      processedRecords: filteredRecords.length,
      acceptedRecords: filteredRecords.length,
      droppedRecords,
      dropReasons,
      dedupeDecisions: nextState.dedupeDecisions.length,
      outboxEvents: nextState.outbox.length,
      staleGateApplied: recomputed.staleGateApplied,
      syncFreshnessHours: refreshedSource.syncFreshnessHours,
      anchorAfter: parsedInput.anchorAfter ?? parsedInput.anchorBefore ?? null
    })
  };
};

export const explainDedupeDecision = (state: DemoState, fingerprint: string): DedupeDecision | null =>
  state.dedupeDecisions.find((decision) => decision.fingerprint === fingerprint || decision.id === fingerprint) ?? null;

export const createMockCollector = (manifest: ProviderManifest): Collector => ({
  manifest,
  async connect(user) {
    return {
      connectUrl: `https://demo.openvitals.local/connect/${manifest.id}/${user.id}`,
      sessionId: `session_${manifest.id}_${user.id}`
    };
  },
  async exchangeSession(sessionId) {
    return {
      accessToken: `demo_access_${sessionId}`,
      refreshToken: `demo_refresh_${sessionId}`
    };
  },
  async syncHistory(context) {
    return createProviderMockPayload({
      user: context.user,
      sourceAccount: context.sourceAccount,
      device: DeviceSchema.parse({
        id: `device_${manifest.id}`,
        userId: context.user.id,
        sourceAccountId: context.sourceAccount.id,
        providerId: manifest.id,
        name: deviceModelForProvider(manifest.id),
        model: deviceModelForProvider(manifest.id),
        platform: providerClass(manifest.id) === "mobile" ? "on-device" : "cloud",
        lastSeenAt: iso(new Date())
      }),
      now: new Date()
    });
  },
  async syncIncremental(context) {
    return this.syncHistory(context);
  },
  async subscribeUpdates() {
    return {
      subscribed: true,
      channel: `openvitals.${manifest.id}.updates`
    };
  },
  async normalize(rawEvents) {
    return {
      rawEvents,
      observations: [],
      episodes: [],
      devices: []
    };
  },
  async resolveProvenance(payload) {
    return payload;
  },
  async healthcheck() {
    return {
      ok: true,
      providerId: manifest.id,
      message: `${manifest.displayName} mock collector is healthy.`
    };
  }
});
