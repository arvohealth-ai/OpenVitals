import {
  appleHealthDataSemantics,
  createMobileCollectorClient,
  getMobileSyncStatusSource,
  isCollectorClientError,
  isCredentialExpiredSyncSource,
  type CollectorConfig,
  type IngestInput,
  type MobileSyncStatusResponse,
  type SessionResponse
} from "@openvitals/collector-mobile-core";

export type {
  CollectorConfig,
  IngestInput,
  MobileProvider,
  MobileSyncStatusResponse,
  SessionResponse
} from "@openvitals/collector-mobile-core";

export type AppleHealthDataGranularity = "sample" | "episode" | "daily_summary" | "live_signal";
export type AppleHealthLatencyClass = "live" | "near_realtime" | "delayed_sync";
export type AppleHealthConnectionMode = "mobile_permission" | "device_pairing";
export type AppleHealthCaptureMode = IngestInput["records"][number]["captureMode"];

export type AppleHealthMetricCapability = {
  metric: string;
  metricFamily: IngestInput["records"][number]["metricFamily"];
  dataGranularity: AppleHealthDataGranularity;
  latencyClass: AppleHealthLatencyClass;
  connectionMode: AppleHealthConnectionMode;
  direct: boolean;
  mirrored: boolean;
  notes: string;
};

export type AppleHealthSourceMetadata = {
  bundleId?: string | null;
  sourceName?: string | null;
  productType?: string | null;
  deviceModel?: string | null;
  sourceVersion?: string | null;
  operatingSystemVersion?: string | null;
};

export type AppleHealthRecordSemantics = {
  dataGranularity: AppleHealthDataGranularity;
  latencyClass: AppleHealthLatencyClass;
  connectionMode: AppleHealthConnectionMode;
  captureMode: AppleHealthCaptureMode;
};

export type AppleHealthIngestRecord = IngestInput["records"][number];

export type AppleHealthIngestRecordInput = Omit<
  AppleHealthIngestRecord,
  "id" | "sourceRecordId" | "dataGranularity" | "latencyClass" | "captureMode" | "sourceApp" | "bundleId" | "tags" | "confidence"
> & {
  id?: string;
  sourceRecordId?: string;
  source: AppleHealthSourceMetadata;
  dataGranularity?: AppleHealthDataGranularity;
  latencyClass?: AppleHealthLatencyClass;
  connectionMode?: AppleHealthConnectionMode;
  captureMode?: AppleHealthCaptureMode;
  rawPayload?: Record<string, unknown>;
  tags?: string[];
  confidence?: number;
};

export type AppleHealthCollectorErrorAction = "retry" | "refresh_anchor" | "reconnect" | "permission_repair" | "fail";

export const APPLE_HEALTH_DATA_SEMANTICS = appleHealthDataSemantics;

export const APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC = "live_workout_heart_rate";

export const APPLE_HEALTH_MIRRORED_SOURCE_BUNDLE_IDS = {
  whoop: ["com.whoop.mobile", "com.whoop.ios"],
  oura: ["com.ouraring.oura", "com.oura.health"]
} as const;

export const APPLE_HEALTH_IOS_METRIC_CAPABILITIES = [
  {
    metric: "heart_rate",
    metricFamily: "cardiovascular",
    dataGranularity: "sample",
    latencyClass: "delayed_sync",
    connectionMode: "mobile_permission",
    direct: true,
    mirrored: true,
    notes: "Historical HealthKit heart-rate samples, including Apple Watch samples after device sync."
  },
  {
    metric: APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC,
    metricFamily: "cardiovascular",
    dataGranularity: "live_signal",
    latencyClass: "live",
    connectionMode: "device_pairing",
    direct: true,
    mirrored: false,
    notes: "Opt-in Apple Watch workout-session heart-rate updates from HKLiveWorkoutBuilder."
  },
  {
    metric: "hrv_sdnn",
    metricFamily: "cardiovascular",
    dataGranularity: "sample",
    latencyClass: "delayed_sync",
    connectionMode: "mobile_permission",
    direct: true,
    mirrored: true,
    notes: "Historical HealthKit HRV SDNN quantity samples."
  },
  {
    metric: "resting_heart_rate",
    metricFamily: "cardiovascular",
    dataGranularity: "sample",
    latencyClass: "delayed_sync",
    connectionMode: "mobile_permission",
    direct: true,
    mirrored: true,
    notes: "Historical HealthKit resting-heart-rate quantity samples."
  },
  {
    metric: "steps",
    metricFamily: "activity",
    dataGranularity: "sample",
    latencyClass: "delayed_sync",
    connectionMode: "mobile_permission",
    direct: true,
    mirrored: true,
    notes: "Step-count samples uploaded with source revision metadata."
  },
  {
    metric: "sleep_analysis",
    metricFamily: "sleep",
    dataGranularity: "episode",
    latencyClass: "delayed_sync",
    connectionMode: "mobile_permission",
    direct: true,
    mirrored: true,
    notes: "HealthKit sleep category samples normalized as sleep episodes."
  },
  {
    metric: "workout",
    metricFamily: "workout",
    dataGranularity: "episode",
    latencyClass: "delayed_sync",
    connectionMode: "mobile_permission",
    direct: true,
    mirrored: true,
    notes: "HealthKit workout samples normalized as workout episodes."
  }
] as const satisfies readonly AppleHealthMetricCapability[];

const mirroredBundleIds = new Set<string>(
  Object.values(APPLE_HEALTH_MIRRORED_SOURCE_BUNDLE_IDS).flatMap((bundleIds) => [...bundleIds])
);

const stableSerialize = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
};

export const hashAppleHealthRawPayload = (payload: unknown): string => {
  const text = stableSerialize(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const classifyAppleHealthCaptureMode = (source: AppleHealthSourceMetadata): "direct" | "mirrored" => {
  const bundleId = source.bundleId?.toLowerCase() ?? "";
  return mirroredBundleIds.has(bundleId) ? "mirrored" : "direct";
};

export const classifyAppleHealthRecordSemantics = (input: {
  metric: string;
  kind: AppleHealthIngestRecord["kind"];
  source?: AppleHealthSourceMetadata;
  dataGranularity?: AppleHealthDataGranularity;
  latencyClass?: AppleHealthLatencyClass;
  connectionMode?: AppleHealthConnectionMode;
  captureMode?: AppleHealthCaptureMode;
}): AppleHealthRecordSemantics => {
  const captureMode = input.captureMode ?? (input.source ? classifyAppleHealthCaptureMode(input.source) : "direct");
  const requestedLive =
    input.dataGranularity === "live_signal" || input.latencyClass === "live" || input.connectionMode === "device_pairing";

  if (requestedLive) {
    if (input.metric !== APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC) {
      throw new Error("Apple Health live_signal/live semantics are only valid for live_workout_heart_rate records.");
    }
    if (captureMode !== "direct") {
      throw new Error("Apple Health live workout records must be direct Apple Watch samples, not mirrored sources.");
    }
    return {
      dataGranularity: "live_signal",
      latencyClass: "live",
      connectionMode: "device_pairing",
      captureMode
    };
  }

  if (input.metric === APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC) {
    throw new Error("Apple Health live_workout_heart_rate records must opt into device_pairing/live semantics.");
  }

  return {
    dataGranularity: input.dataGranularity ?? (input.kind === "episode" ? "episode" : "sample"),
    latencyClass: input.latencyClass ?? "delayed_sync",
    connectionMode: "mobile_permission",
    captureMode
  };
};

export const buildAppleHealthRecordTags = (input: {
  dataGranularity: AppleHealthDataGranularity;
  latencyClass: AppleHealthLatencyClass;
  connectionMode?: AppleHealthConnectionMode;
  captureMode?: AppleHealthCaptureMode;
  source?: AppleHealthSourceMetadata;
  rawPayload?: Record<string, unknown>;
  sourceRecordId?: string;
  extra?: string[];
}) => {
  const tags = [
    `data_granularity:${input.dataGranularity}`,
    `latency_class:${input.latencyClass}`,
    `connection_mode:${input.connectionMode ?? "mobile_permission"}`,
    `capture_mode:${input.captureMode ?? "direct"}`
  ];
  if (input.sourceRecordId) {
    tags.push(`dedupe_source_record_id:${input.sourceRecordId}`);
  }
  if (input.source?.bundleId) {
    tags.push(`source_bundle:${input.source.bundleId}`);
  }
  if (input.source?.sourceName) {
    tags.push(`source_name:${input.source.sourceName}`);
  }
  if (input.source?.productType) {
    tags.push(`source_product:${input.source.productType}`);
  }
  if (input.source?.deviceModel) {
    tags.push(`device_model:${input.source.deviceModel}`);
  }
  if (input.source?.sourceVersion) {
    tags.push(`source_version:${input.source.sourceVersion}`);
  }
  if (input.rawPayload) {
    tags.push("raw_payload_preserved:provider_raw_event", `raw_payload_hash:${hashAppleHealthRawPayload(input.rawPayload)}`);
  }
  tags.push(...(input.extra ?? []));
  return Array.from(new Set(tags));
};

export const buildAppleHealthSourceRecordId = (input: {
  metric: string;
  startAt: string;
  endAt: string;
  source: AppleHealthSourceMetadata;
  rawPayload?: Record<string, unknown>;
}) => {
  const rawPayload = input.rawPayload ?? {};
  const nativeId = ["uuid", "id", "sampleId", "workoutId"].map((key) => rawPayload[key]).find((value): value is string => typeof value === "string" && value.length > 0);
  if (nativeId) {
    return `healthkit:${input.metric}:${nativeId}`;
  }
  return `healthkit:${input.metric}:${hashAppleHealthRawPayload({
    startAt: input.startAt,
    endAt: input.endAt,
    source: input.source,
    rawPayload
  })}`;
};

export const buildAppleHealthIngestRecord = (input: AppleHealthIngestRecordInput): AppleHealthIngestRecord => {
  const sourceRecordId =
    input.sourceRecordId ??
    buildAppleHealthSourceRecordId({
      metric: input.metric,
      startAt: input.startAt,
      endAt: input.endAt,
      source: input.source,
      rawPayload: input.rawPayload
    });
  const semantics = classifyAppleHealthRecordSemantics({
    metric: input.metric,
    kind: input.kind,
    source: input.source,
    dataGranularity: input.dataGranularity,
    latencyClass: input.latencyClass,
    connectionMode: input.connectionMode,
    captureMode: input.captureMode
  });
  const id = input.id ?? `apple-health:${hashAppleHealthRawPayload({ sourceRecordId, metric: input.metric, startAt: input.startAt, endAt: input.endAt })}`;
  const record: AppleHealthIngestRecord = {
    ...input,
    id,
    sourceRecordId,
    dataGranularity: semantics.dataGranularity,
    latencyClass: semantics.latencyClass,
    captureMode: semantics.captureMode,
    sourceApp: input.source.sourceName ?? input.source.bundleId ?? "Apple Health",
    bundleId: input.source.bundleId ?? undefined,
    confidence: input.confidence ?? (semantics.captureMode === "mirrored" ? 0.8 : 0.9),
    tags: buildAppleHealthRecordTags({
      dataGranularity: semantics.dataGranularity,
      latencyClass: semantics.latencyClass,
      connectionMode: semantics.connectionMode,
      captureMode: semantics.captureMode,
      source: input.source,
      rawPayload: input.rawPayload,
      sourceRecordId,
      extra: input.tags
    })
  };
  delete (record as { source?: unknown }).source;
  delete (record as { rawPayload?: unknown }).rawPayload;
  delete (record as { connectionMode?: unknown }).connectionMode;
  validateAppleHealthIngestRecords([record]);
  return record;
};

export type IosCollectorMetaInput = {
  sdkVersion: string;
  appBuild: string;
  deviceModel: string;
};

export const validateAppleMirrorOrigins = (records: IngestInput["records"]) => {
  const invalid = records.find((record) => record.captureMode === "mirrored" && !record.bundleId);
  if (invalid) {
    throw new Error("Apple mirrored records require bundleId before ingest.");
  }
};

export const validateAppleHealthIngestRecords = (records: IngestInput["records"]) => {
  validateAppleMirrorOrigins(records);
  for (const record of records) {
    const isLiveRecord = record.dataGranularity === "live_signal" || record.latencyClass === "live";
    if (record.metric === APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC && !isLiveRecord) {
      throw new Error("Apple Health live_workout_heart_rate records must use live_signal/live semantics.");
    }
    if (!isLiveRecord) {
      continue;
    }
    if (record.metric !== APPLE_HEALTH_LIVE_WORKOUT_HEART_RATE_METRIC) {
      throw new Error("Apple Health live_signal/live records are restricted to live_workout_heart_rate.");
    }
    if (record.captureMode !== "direct") {
      throw new Error("Apple Health live_signal/live records must be direct, not mirrored.");
    }
    if (!record.tags.includes("connection_mode:device_pairing")) {
      throw new Error("Apple Health live_signal/live records must include connection_mode:device_pairing provenance.");
    }
  }
};

export const buildIosCollectorMeta = (input: IosCollectorMetaInput) => ({
  sdk: "collector-ios",
  sdkVersion: input.sdkVersion,
  appBuild: input.appBuild,
  deviceModel: input.deviceModel
});

export const describeAppleHealthCollectorError = (error: unknown): { action: AppleHealthCollectorErrorAction; retryable: boolean; message: string } => {
  if (!isCollectorClientError(error)) {
    return { action: "fail", retryable: false, message: error instanceof Error ? error.message : "Unknown collector error" };
  }
  if (error.code === "ANCHOR_CONFLICT") {
    return { action: "refresh_anchor", retryable: true, message: error.message };
  }
  if (error.code === "SESSION_EXPIRED") {
    return { action: "reconnect", retryable: false, message: error.message };
  }
  if (error.code === "AUTH_ERROR") {
    return { action: "permission_repair", retryable: false, message: error.message };
  }
  if (error.code === "TRANSIENT_ERROR") {
    return { action: "retry", retryable: true, message: error.message };
  }
  return { action: "fail", retryable: false, message: error.message };
};

export const createIosCollectorClient = (config: CollectorConfig) => {
  const core = createMobileCollectorClient(config, "apple-health");
  return {
    ...core,
    dataSemantics: APPLE_HEALTH_DATA_SEMANTICS,
    async createSession(userId: string): Promise<SessionResponse> {
      return core.createSession(userId);
    },
    async ingestWithAnchorRecovery(input: Omit<IngestInput, "providerId">) {
      validateAppleHealthIngestRecords(input.records);
      try {
        return await core.ingest(input);
      } catch (error) {
        if (!isCollectorClientError(error) || error.code !== "ANCHOR_CONFLICT") {
          throw error;
        }
        const syncStatus = await core.syncStatus(input.userId);
        const latestAnchor = getMobileSyncStatusSource(syncStatus, "apple-health")?.lastAnchor ?? null;
        return core.ingest({
          ...input,
          anchorBefore: latestAnchor
        });
      }
    },
    async appleHealthSyncStatus(userId: string) {
      const status = (await core.syncStatus(userId)) as MobileSyncStatusResponse;
      const source = getMobileSyncStatusSource(status, "apple-health");
      return {
        ...status,
        appleHealth: {
          source,
          credentialExpired: isCredentialExpiredSyncSource(source),
          requiresReconnect: isCredentialExpiredSyncSource(source) || source?.authState === "reauth_required",
          lastAnchor: source?.lastAnchor ?? null
        }
      };
    }
  };
};
