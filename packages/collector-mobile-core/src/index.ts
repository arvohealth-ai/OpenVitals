import type { IngestRecord, ProviderId } from "@openvitals/contracts";

export type MobileProvider = Extract<ProviderId, "apple-health" | "health-connect">;

export type CollectorConfig = {
  apiBaseUrl: string;
  agentToken?: string;
};

export type MobileCollectorDataPolicy = {
  rawPayloadPolicy: string;
  provenancePolicy: string;
  dedupePolicy: string;
  credentialFailurePolicy: string;
};

export type MobileDataSemantics = MobileCollectorDataPolicy & {
  providerId: MobileProvider;
  connectionMode: "mobile_permission";
  dataGranularity: Array<"sample" | "episode" | "daily_summary">;
  latencyClass: "near_realtime" | "delayed_sync";
  liveSignal: false;
  notes: string;
};

export type AppleHealthDataSemantics = MobileCollectorDataPolicy & {
  providerId: "apple-health";
  iPhoneHistorical: {
    connectionMode: "mobile_permission";
    dataGranularity: Array<"sample" | "episode" | "daily_summary">;
    latencyClass: Array<"near_realtime" | "delayed_sync">;
    liveSignal: false;
    notes: string;
  };
  watchLiveWorkout: {
    connectionMode: "device_pairing";
    dataGranularity: "live_signal";
    latencyClass: "live";
    liveSignal: true;
    notes: string;
  };
  notes: string;
};

const sharedMobileDataPolicy: MobileCollectorDataPolicy = {
  rawPayloadPolicy:
    "SDK ingest preserves provider/raw sample fields in raw-event payloads; normalized records carry stable sourceRecordId, source app identifiers, and hash tags for audit.",
  provenancePolicy:
    "Every record must identify its originating app/device with bundleId or packageName when mirrored, plus captureMode, confidence, timezone, and source revision metadata when available.",
  dedupePolicy:
    "Runtime dedupe keys are derived from sourceRecordId, sourceApp, metric/time window, and captureMode; mobile collectors should keep sourceRecordId stable across retries and anchor recovery.",
  credentialFailurePolicy:
    "401 session failures require a new mobile session; 403 authorization failures require reconnect or permission repair; transient HTTP failures may be retried with the original idempotency key."
};

export const appleHealthDataSemantics: AppleHealthDataSemantics = {
  providerId: "apple-health",
  ...sharedMobileDataPolicy,
  iPhoneHistorical: {
    connectionMode: "mobile_permission",
    dataGranularity: ["sample", "episode", "daily_summary"],
    latencyClass: ["delayed_sync", "near_realtime"],
    liveSignal: false,
    notes:
      "The iPhone companion uploads HealthKit samples/episodes after HealthKit stores or schedules them; Apple Watch historical samples flow through this path after watch-to-phone Health sync."
  },
  watchLiveWorkout: {
    connectionMode: "device_pairing",
    dataGranularity: "live_signal",
    latencyClass: "live",
    liveSignal: true,
    notes:
      "Only explicit Apple Watch HKWorkoutSession/HKLiveWorkoutBuilder heart-rate updates may use live_signal/live semantics."
  },
  notes:
    "The iPhone app is the required Apple Health connector. The watch app is optional and only upgrades explicit workout-session heart-rate capture to live semantics."
};

export const healthConnectDataSemantics: MobileDataSemantics = {
  providerId: "health-connect",
  connectionMode: "mobile_permission",
  dataGranularity: ["sample", "episode", "daily_summary"],
  latencyClass: "near_realtime",
  liveSignal: false,
  ...sharedMobileDataPolicy,
  notes: "Health Connect batches permissioned on-device samples and episodes through SDK ingest; it is not a continuous cloud raw stream."
};

export type SessionResponse = {
  sessionToken: string;
  expiresAt: string;
};

export type IngestInput = {
  userId: string;
  providerId: MobileProvider;
  sessionToken: string;
  idempotencyKey: string;
  anchorBefore?: string | null;
  anchorAfter?: string | null;
  collectorMeta?: {
    sdk: string;
    sdkVersion: string;
    appBuild: string;
    deviceModel: string;
  } | null;
  records: IngestRecord[];
};

export type CollectorErrorCode =
  | "ANCHOR_CONFLICT"
  | "SESSION_EXPIRED"
  | "AUTH_ERROR"
  | "TRANSIENT_ERROR"
  | "HTTP_ERROR";

export class CollectorClientError extends Error {
  code: CollectorErrorCode;
  status: number;
  details: unknown;

  constructor(input: { code: CollectorErrorCode; status: number; message: string; details?: unknown }) {
    super(input.message);
    this.name = "CollectorClientError";
    this.code = input.code;
    this.status = input.status;
    this.details = input.details ?? null;
  }
}

const inferErrorCode = (status: number, payload: unknown): CollectorErrorCode => {
  const message = payload && typeof payload === "object" && "message" in payload ? String((payload as Record<string, unknown>).message) : "";
  if (status === 409 && /anchor mismatch/i.test(message)) {
    return "ANCHOR_CONFLICT";
  }
  if (status === 401) {
    return "SESSION_EXPIRED";
  }
  if (status === 403) {
    return "AUTH_ERROR";
  }
  if (status === 429 || status >= 500) {
    return "TRANSIENT_ERROR";
  }
  return "HTTP_ERROR";
};

export const requestJson = async <T>(
  config: CollectorConfig,
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown
): Promise<T> => {
  const headers: Record<string, string> = body ? { "content-type": "application/json" } : {};
  if (config.agentToken) {
    headers.authorization = `Bearer ${config.agentToken}`;
  }
  const response = await fetch(new URL(path, config.apiBaseUrl).toString(), {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = await response.text();
    }
    const message =
      payload && typeof payload === "object" && "message" in payload
        ? String((payload as Record<string, unknown>).message)
        : `Collector request failed: ${response.status} ${response.statusText}`;
    throw new CollectorClientError({
      code: inferErrorCode(response.status, payload),
      status: response.status,
      message,
      details: payload
    });
  }

  return (await response.json()) as T;
};

export const isCollectorClientError = (error: unknown): error is CollectorClientError =>
  error instanceof CollectorClientError;

export type MobileSyncStatusSource = {
  providerId: string;
  authState?: "not_connected" | "connected" | "expired" | "reauth_required" | string;
  lastAnchor?: string | null;
  credentialExpiresAt?: string | null;
  lastCredentialError?: string | null;
  [key: string]: unknown;
};

export type MobileSyncStatusResponse = {
  userId: string;
  sources?: MobileSyncStatusSource[];
  [key: string]: unknown;
};

export const getMobileSyncStatusSource = (status: MobileSyncStatusResponse, providerId: MobileProvider) =>
  status.sources?.find((source) => source.providerId === providerId) ?? null;

export const isCredentialExpiredSyncSource = (source: MobileSyncStatusSource | null, now = new Date()): boolean => {
  if (!source) {
    return false;
  }
  if (source.authState === "expired" || source.authState === "reauth_required") {
    return true;
  }
  if (!source.credentialExpiresAt) {
    return false;
  }
  return new Date(source.credentialExpiresAt).getTime() <= now.getTime();
};

export const createMobileCollectorClient = (config: CollectorConfig, providerId: MobileProvider) => ({
  providerId,
  async createSession(userId: string): Promise<SessionResponse> {
    return requestJson<SessionResponse>(config, `/v1/users/${userId}/connect/${providerId}/session`, "POST");
  },
  async ingest(input: Omit<IngestInput, "providerId">) {
    return requestJson(config, `/v1/users/${input.userId}/ingest/${providerId}`, "POST", {
      sessionToken: input.sessionToken,
      idempotencyKey: input.idempotencyKey,
      anchorBefore: input.anchorBefore ?? null,
      anchorAfter: input.anchorAfter ?? null,
      collectorMeta: input.collectorMeta ?? null,
      records: input.records
    });
  },
  async checkpointAnchor(userId: string) {
    return requestJson(config, `/v1/users/${userId}/sync`, "POST", {
      providerId,
      mode: "incremental"
    });
  },
  async setIgnoredSources(userId: string, ignoredSources: string[]) {
    return requestJson(config, `/v1/users/${userId}/source-filters`, "PUT", {
      providerId,
      ignoredSources
    });
  },
  async syncStatus(userId: string) {
    return requestJson<MobileSyncStatusResponse>(config, `/v1/users/${userId}/sync-status`, "GET");
  }
});
