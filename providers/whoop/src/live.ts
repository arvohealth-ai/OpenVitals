import crypto from "node:crypto";

import type {
  Collector,
  CollectorContext,
  ConnectionMethod,
  IngestRecord,
  NormalizedPayload,
  ProviderCredential,
  ProviderManifest
} from "@openvitals/contracts";
import { IngestRecordSchema, NormalizedPayloadSchema } from "@openvitals/contracts";
import { normalizeIngestRecordsAsPayload } from "@openvitals/runtime";

const emptyPayload = (): NormalizedPayload => ({
  rawEvents: [],
  observations: [],
  episodes: [],
  devices: []
});

const WHOOP_SOURCE_APP = "com.whoop.mobile";
const DEFAULT_WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const DEFAULT_WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const DEFAULT_WHOOP_API_URL = "https://api.prod.whoop.com/developer/v2";
const DEFAULT_WHOOP_SCOPES = ["read:sleep", "read:recovery", "read:workout", "offline"];

const isoOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
};

const hoursBetween = (startAt: string, endAt: string): number => Math.max((new Date(endAt).getTime() - new Date(startAt).getTime()) / (60 * 60 * 1000), 0);

const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

const asArray = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  return [];
};

const stringOrNull = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

const splitScopeValue = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const whoopScopes = (): string[] => {
  const configured = process.env.OPENVITALS_WHOOP_SCOPE;
  const scopes = configured ? splitScopeValue(configured) : DEFAULT_WHOOP_SCOPES;
  return scopes.length > 0 ? scopes : DEFAULT_WHOOP_SCOPES;
};

const whoopConfig = () => ({
  clientId: process.env.OPENVITALS_WHOOP_CLIENT_ID ?? "",
  clientSecret: process.env.OPENVITALS_WHOOP_CLIENT_SECRET ?? "",
  authUrl: process.env.OPENVITALS_WHOOP_AUTH_URL ?? DEFAULT_WHOOP_AUTH_URL,
  tokenUrl: process.env.OPENVITALS_WHOOP_TOKEN_URL ?? DEFAULT_WHOOP_TOKEN_URL,
  apiUrl: process.env.OPENVITALS_WHOOP_API_URL ?? DEFAULT_WHOOP_API_URL,
  redirectUri: process.env.OPENVITALS_WHOOP_REDIRECT_URI ?? "http://127.0.0.1:3000/v1/connect/callback/whoop",
  scopes: whoopScopes()
});

const addSeconds = (seconds: number): string => new Date(Date.now() + Math.max(seconds, 0) * 1000).toISOString();

const externalUserIdFromPayload = (payload: Record<string, unknown>): string | null => {
  const direct = stringOrNull(payload.user_id) ?? stringOrNull(payload.userId) ?? stringOrNull(payload.id);
  if (direct) {
    return direct;
  }
  const user = payload.user;
  if (user && typeof user === "object") {
    return stringOrNull((user as Record<string, unknown>).id) ?? stringOrNull((user as Record<string, unknown>).user_id);
  }
  return null;
};

const preview = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  if (value.length <= 10) {
    return value;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const normalizeWhoopTokenPayload = (
  payload: Record<string, unknown>,
  fallback: {
    connectionMethod: ConnectionMethod;
    externalUserId?: string | null;
    scopes?: string[];
  }
): {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  externalUserId: string | null;
  connectionMethod: ConnectionMethod;
} => {
  const accessToken = stringOrNull(payload.access_token) ?? stringOrNull(payload.accessToken);
  if (!accessToken) {
    throw new Error("WHOOP token response did not include access_token.");
  }
  const refreshToken = stringOrNull(payload.refresh_token) ?? stringOrNull(payload.refreshToken);
  const expiresAt =
    isoOrNull(payload.expires_at) ??
    (typeof payload.expires_in === "number" ? addSeconds(payload.expires_in) : null) ??
    (typeof payload.expiresIn === "number" ? addSeconds(payload.expiresIn) : null);
  const scopes = splitScopeValue(payload.scope).length > 0 ? splitScopeValue(payload.scope) : fallback.scopes ?? [];
  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes,
    externalUserId: externalUserIdFromPayload(payload) ?? fallback.externalUserId ?? null,
    connectionMethod: fallback.connectionMethod
  };
};

const toRecords = (input: {
  context: CollectorContext;
  sleepRows: Array<Record<string, unknown>>;
  recoveryRows: Array<Record<string, unknown>>;
  workoutRows: Array<Record<string, unknown>>;
}): IngestRecord[] => {
  const { context, sleepRows, recoveryRows, workoutRows } = input;
  const timezone = context.user.timezone;
  const records: IngestRecord[] = [];
  const pushRecord = (record: IngestRecord) => {
    records.push(IngestRecordSchema.parse(record));
  };

  for (const row of sleepRows) {
    const id = String(row.id ?? row.sleep_id ?? crypto.randomUUID());
    const startAt = isoOrNull(row.start ?? row.start_time ?? row.startAt ?? row.start_datetime);
    const endAt = isoOrNull(row.end ?? row.end_time ?? row.endAt ?? row.end_datetime);
    if (!startAt || !endAt) {
      continue;
    }
    const durationHours = numberOrNull(row.duration_hours) ?? numberOrNull(row.durationHours) ?? hoursBetween(startAt, endAt);
    pushRecord({
      id: `whoop-sleep-${id}`,
      sourceRecordId: `whoop-sleep-${id}`,
      metricFamily: "sleep",
      kind: "episode",
      metric: "sleep",
      episodeType: "sleep",
      title: "WHOOP Sleep",
      metrics: {
        duration_hours: Math.round(durationHours * 10) / 10
      },
      notes: null,
      unit: "hours",
      startAt,
      endAt,
      timezone,
      captureMode: "direct",
      sourceApp: WHOOP_SOURCE_APP,
      bundleId: WHOOP_SOURCE_APP,
      confidence: 0.95,
      tags: []
    });
  }

  for (const row of recoveryRows) {
    const id = String(row.id ?? row.recovery_id ?? row.cycle_id ?? crypto.randomUUID());
    const timestamp = isoOrNull(row.timestamp ?? row.created_at ?? row.createdAt ?? row.day ?? row.score_timestamp);
    if (!timestamp) {
      continue;
    }
    const score = row.score && typeof row.score === "object" ? (row.score as Record<string, unknown>) : {};
    const hrv = numberOrNull(row.hrv_rmssd ?? row.hrv ?? row.hrv_ms ?? score.hrv_rmssd);
    const rhr = numberOrNull(row.resting_heart_rate ?? row.rhr ?? row.restingHeartRate ?? score.resting_heart_rate);
    if (hrv !== null) {
      pushRecord({
        id: `whoop-recovery-hrv-${id}`,
        sourceRecordId: `whoop-recovery-hrv-${id}`,
        metricFamily: "recovery",
        kind: "observation",
        metric: "hrv_rmssd",
        value: hrv,
        unit: "ms",
        startAt: timestamp,
        endAt: timestamp,
        timezone,
        captureMode: "direct",
        sourceApp: WHOOP_SOURCE_APP,
        bundleId: WHOOP_SOURCE_APP,
        confidence: 0.95,
        tags: []
      });
    }
    if (rhr !== null) {
      pushRecord({
        id: `whoop-recovery-rhr-${id}`,
        sourceRecordId: `whoop-recovery-rhr-${id}`,
        metricFamily: "cardiovascular",
        kind: "observation",
        metric: "resting_heart_rate",
        value: rhr,
        unit: "bpm",
        startAt: timestamp,
        endAt: timestamp,
        timezone,
        captureMode: "direct",
        sourceApp: WHOOP_SOURCE_APP,
        bundleId: WHOOP_SOURCE_APP,
        confidence: 0.95,
        tags: []
      });
    }
  }

  for (const row of workoutRows) {
    const id = String(row.id ?? row.workout_id ?? crypto.randomUUID());
    const startAt = isoOrNull(row.start ?? row.start_time ?? row.startAt ?? row.start_datetime);
    const endAt = isoOrNull(row.end ?? row.end_time ?? row.endAt ?? row.end_datetime);
    if (!startAt || !endAt) {
      continue;
    }
    const score = row.score && typeof row.score === "object" ? (row.score as Record<string, unknown>) : {};
    const zoneDuration = row.zone_duration && typeof row.zone_duration === "object" ? (row.zone_duration as Record<string, unknown>) : {};
    const strain = numberOrNull(row.strain ?? row.training_load ?? row.load ?? score.strain) ?? 0;
    const durationMinutes = numberOrNull(row.duration_minutes ?? row.durationMinutes) ?? Math.max(hoursBetween(startAt, endAt) * 60, 0);
    const averageHeartRate = numberOrNull(row.average_heart_rate ?? row.averageHeartRate ?? score.average_heart_rate ?? score.averageHeartRate);
    const maxHeartRate = numberOrNull(row.max_heart_rate ?? row.maxHeartRate ?? score.max_heart_rate ?? score.maxHeartRate);
    const zoneZeroMinutes = numberOrNull(zoneDuration.zone_zero_milli ?? zoneDuration.zoneZeroMilli);
    const zoneOneMinutes = numberOrNull(zoneDuration.zone_one_milli ?? zoneDuration.zoneOneMilli);
    const zoneTwoMinutes = numberOrNull(zoneDuration.zone_two_milli ?? zoneDuration.zoneTwoMilli);
    const zoneThreeMinutes = numberOrNull(zoneDuration.zone_three_milli ?? zoneDuration.zoneThreeMilli);
    const zoneFourMinutes = numberOrNull(zoneDuration.zone_four_milli ?? zoneDuration.zoneFourMilli);
    const zoneFiveMinutes = numberOrNull(zoneDuration.zone_five_milli ?? zoneDuration.zoneFiveMilli);
    pushRecord({
      id: `whoop-workout-${id}`,
      sourceRecordId: `whoop-workout-${id}`,
      metricFamily: "workout",
      kind: "episode",
      metric: "workout",
      episodeType: "workout",
      title: "WHOOP Workout",
      metrics: {
        training_load: Math.round(strain * 10) / 10,
        duration_minutes: Math.round(durationMinutes * 10) / 10,
        ...(averageHeartRate !== null ? { average_heart_rate: averageHeartRate } : {}),
        ...(maxHeartRate !== null ? { max_heart_rate: maxHeartRate } : {}),
        ...(zoneZeroMinutes !== null ? { zone_zero_minutes: Math.round((zoneZeroMinutes / 60_000) * 10) / 10 } : {}),
        ...(zoneOneMinutes !== null ? { zone_one_minutes: Math.round((zoneOneMinutes / 60_000) * 10) / 10 } : {}),
        ...(zoneTwoMinutes !== null ? { zone_two_minutes: Math.round((zoneTwoMinutes / 60_000) * 10) / 10 } : {}),
        ...(zoneThreeMinutes !== null ? { zone_three_minutes: Math.round((zoneThreeMinutes / 60_000) * 10) / 10 } : {}),
        ...(zoneFourMinutes !== null ? { zone_four_minutes: Math.round((zoneFourMinutes / 60_000) * 10) / 10 } : {}),
        ...(zoneFiveMinutes !== null ? { zone_five_minutes: Math.round((zoneFiveMinutes / 60_000) * 10) / 10 } : {})
      },
      notes: "WHOOP provider-mediated workout summary; not a continuous raw heart-rate stream.",
      unit: "load",
      startAt,
      endAt,
      timezone,
      captureMode: "direct",
      sourceApp: WHOOP_SOURCE_APP,
      bundleId: WHOOP_SOURCE_APP,
      confidence: 0.93,
      tags: []
    });
  }

  const uniqueBySourceRecord = new Map<string, IngestRecord>();
  for (const record of records) {
    uniqueBySourceRecord.set(record.sourceRecordId, record);
  }
  return [...uniqueBySourceRecord.values()];
};

const fetchWhoopToken = async (payload: Record<string, string>): Promise<Record<string, unknown>> => {
  const config = whoopConfig();
  const body = new URLSearchParams(payload);
  if (config.clientId) {
    body.set("client_id", config.clientId);
  }
  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }
  if (config.redirectUri) {
    body.set("redirect_uri", config.redirectUri);
  }
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) {
    throw new Error(`WHOOP token endpoint responded with ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
};

export const buildWhoopConnectMetadata = (input: {
  userId: string;
  sessionId: string;
  state: string;
}): {
  connectUrl: string;
  callbackUrl: string;
  state: string;
  connectionMethod: ConnectionMethod;
} => {
  const config = whoopConfig();
  const url = new URL(config.authUrl);
  if (config.clientId) {
    url.searchParams.set("client_id", config.clientId);
  }
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set("redirect_uri", config.redirectUri);
  if (config.scopes.length > 0) {
    url.searchParams.set("scope", config.scopes.join(" "));
  }
  url.searchParams.set("session_id", input.sessionId);
  url.searchParams.set("user_id", input.userId);
  return {
    connectUrl: url.toString(),
    callbackUrl: config.redirectUri,
    state: input.state,
    connectionMethod: "oauth"
  };
};

export const exchangeWhoopCode = async (input: {
  code: string;
  externalUserId?: string | null;
}): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  externalUserId: string | null;
  connectionMethod: ConnectionMethod;
}> => {
  const payload = await fetchWhoopToken({
    grant_type: "authorization_code",
    code: input.code
  });
  return normalizeWhoopTokenPayload(payload, {
    connectionMethod: "oauth",
    externalUserId: input.externalUserId,
    scopes: whoopScopes()
  });
};

export const refreshWhoopCredential = async (credential: ProviderCredential): Promise<ProviderCredential> => {
  if (!credential.refreshToken) {
    throw new Error("WHOOP credential is missing refresh_token.");
  }
  const payload = await fetchWhoopToken({
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken
  });
  const refreshed = normalizeWhoopTokenPayload(payload, {
    connectionMethod: credential.connectionMethod,
    externalUserId: credential.externalUserId,
    scopes: credential.scopes
  });
  return {
    ...credential,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.expiresAt,
    scopes: refreshed.scopes,
    externalUserId: refreshed.externalUserId,
    authState: "connected",
    lastRefreshAt: new Date().toISOString(),
    lastRefreshError: null,
    updatedAt: new Date().toISOString()
  };
};

const fetchWhoopCollection = async (input: {
  accessToken: string;
  path: string;
  mode: "history" | "incremental";
  lastAnchor: string | null;
}): Promise<Array<Record<string, unknown>>> => {
  const { apiUrl } = whoopConfig();
  const results: Array<Record<string, unknown>> = [];
  let nextToken: string | null = null;
  const baseline =
    input.lastAnchor ??
    (input.mode === "history" ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString());

  do {
    const url = new URL(input.path, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
    url.searchParams.set("since", baseline);
    url.searchParams.set("start", baseline);
    url.searchParams.set("limit", "25");
    if (nextToken) {
      url.searchParams.set("nextToken", nextToken);
    }
    const response = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`WHOOP API ${input.path} responded with ${response.status}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    results.push(...asArray(payload.records ?? payload.data ?? payload.results));
    nextToken = stringOrNull(payload.next_token) ?? stringOrNull(payload.nextToken);
  } while (nextToken);

  return results;
};

export const loadWhoopPayloadFromCredential = async (input: {
  context: CollectorContext;
  credential: ProviderCredential;
  mode: "history" | "incremental";
}): Promise<NormalizedPayload> => {
  const [sleepRows, recoveryRows, workoutRows] = await Promise.all([
    fetchWhoopCollection({ accessToken: input.credential.accessToken, path: "activity/sleep", mode: input.mode, lastAnchor: input.context.lastAnchor }).catch(() => []),
    fetchWhoopCollection({ accessToken: input.credential.accessToken, path: "recovery", mode: input.mode, lastAnchor: input.context.lastAnchor }).catch(() => []),
    fetchWhoopCollection({ accessToken: input.credential.accessToken, path: "activity/workout", mode: input.mode, lastAnchor: input.context.lastAnchor }).catch(() => [])
  ]);

  const records = toRecords({
    context: input.context,
    sleepRows,
    recoveryRows,
    workoutRows
  });

  if (records.length === 0) {
    return emptyPayload();
  }

  return normalizeIngestRecordsAsPayload({
    user: input.context.user,
    providerId: "whoop",
    sourceAccount: input.context.sourceAccount,
    records,
    now: new Date()
  });
};

const loadFromEnvToken = async (context: CollectorContext, mode: "history" | "incremental"): Promise<NormalizedPayload | null> => {
  const accessToken = process.env.OPENVITALS_WHOOP_ACCESS_TOKEN;
  if (!accessToken) {
    return null;
  }

  return loadWhoopPayloadFromCredential({
    context,
    mode,
    credential: {
      id: `provider_credential_whoop_env_${context.user.id}`,
      userId: context.user.id,
      providerId: "whoop",
      authState: "connected",
      connectionMethod: "env-token",
      accessToken,
      refreshToken: null,
      expiresAt: null,
      scopes: whoopScopes(),
      externalUserId: `env:${context.user.id}`,
      lastRefreshAt: null,
      lastRefreshError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
};

const loadFromBridge = async (context: CollectorContext, mode: "history" | "incremental"): Promise<NormalizedPayload> => {
  const bridgeUrl = process.env.OPENVITALS_WHOOP_BRIDGE_URL;
  if (!bridgeUrl) {
    return emptyPayload();
  }
  const url = new URL(bridgeUrl);
  url.searchParams.set("mode", mode);
  url.searchParams.set("userId", context.user.id);
  if (context.lastAnchor) {
    url.searchParams.set("anchor", context.lastAnchor);
  }

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`WHOOP bridge responded with ${response.status}`);
  }
  return NormalizedPayloadSchema.parse(await response.json());
};

export const providerCredentialPreview = (credential: {
  providerId: ProviderCredential["providerId"];
  authState: ProviderCredential["authState"];
  connectionMethod: ProviderCredential["connectionMethod"];
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: string[];
  externalUserId: string | null;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  updatedAt: string;
}) => ({
  providerId: credential.providerId,
  authState: credential.authState,
  connectionMethod: credential.connectionMethod,
  expiresAt: credential.expiresAt,
  scopes: credential.scopes,
  externalUserId: credential.externalUserId,
  lastRefreshAt: credential.lastRefreshAt,
  lastRefreshError: credential.lastRefreshError,
  updatedAt: credential.updatedAt,
  accessTokenPreview: preview(credential.accessToken) ?? "redacted",
  refreshTokenPreview: preview(credential.refreshToken)
});

export const createWhoopLiveCollector = (manifest: ProviderManifest): Collector => ({
  manifest,
  async connect(user) {
    const sessionId = `session_whoop_${user.id}`;
    const connect = buildWhoopConnectMetadata({
      userId: user.id,
      sessionId,
      state: `whoop:${user.id}:${crypto.randomUUID()}`
    });
    return {
      connectUrl: connect.connectUrl,
      sessionId
    };
  },
  async exchangeSession(sessionId) {
    return {
      accessToken: `whoop_access_${sessionId}`,
      refreshToken: `whoop_refresh_${sessionId}`
    };
  },
  async syncHistory(context) {
    const fromApi = await loadFromEnvToken(context, "history").catch(() => null);
    if (fromApi) {
      return NormalizedPayloadSchema.parse(fromApi);
    }
    return loadFromBridge(context, "history");
  },
  async syncIncremental(context) {
    const fromApi = await loadFromEnvToken(context, "incremental").catch(() => null);
    if (fromApi) {
      return NormalizedPayloadSchema.parse(fromApi);
    }
    return loadFromBridge(context, "incremental");
  },
  async subscribeUpdates() {
    return {
      subscribed: true,
      channel: "openvitals.whoop.provider-mediated-sync"
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
    const config = whoopConfig();
    const hasOauth = Boolean(config.clientId && config.clientSecret && config.redirectUri);
    const hasNativeApi = Boolean(process.env.OPENVITALS_WHOOP_ACCESS_TOKEN);
    const hasBridge = Boolean(process.env.OPENVITALS_WHOOP_BRIDGE_URL);
    return {
      ok: true,
      providerId: "whoop",
      message: hasOauth
        ? `${manifest.displayName} OAuth flow is configured for delayed/provider-mediated per-user sync.`
        : hasNativeApi
          ? `${manifest.displayName} env-token fallback is configured for delayed/provider-mediated sync.`
          : hasBridge
            ? `${manifest.displayName} bridge fallback is configured for delayed/provider-mediated sync.`
            : `${manifest.displayName} is ready, but no OAuth client, env token, or bridge is configured yet; do not claim continuous raw HR streaming.`
    };
  }
});
