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

const OURA_SOURCE_APP = "com.ouraring.app";
const DEFAULT_OURA_AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const DEFAULT_OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const DEFAULT_OURA_API_URL = "https://api.ouraring.com";
const DEFAULT_OURA_SCOPES = ["personal", "daily", "heartrate", "workout"];

const emptyPayload = (): NormalizedPayload => ({
  rawEvents: [],
  observations: [],
  episodes: [],
  devices: []
});

const isoOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const dayStartIso = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const dayEndIso = (value: unknown): string | null => {
  const start = dayStartIso(value);
  if (!start) {
    return null;
  }
  return new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString();
};

const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const stringOrNull = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

const asArray = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];

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

const ouraScopes = (): string[] => {
  const configured = process.env.OPENVITALS_OURA_SCOPE;
  const scopes = configured ? splitScopeValue(configured) : DEFAULT_OURA_SCOPES;
  return scopes.length > 0 ? scopes : DEFAULT_OURA_SCOPES;
};

const ouraConfig = () => ({
  clientId: process.env.OPENVITALS_OURA_CLIENT_ID ?? "",
  clientSecret: process.env.OPENVITALS_OURA_CLIENT_SECRET ?? "",
  authUrl: process.env.OPENVITALS_OURA_AUTH_URL ?? DEFAULT_OURA_AUTH_URL,
  tokenUrl: process.env.OPENVITALS_OURA_TOKEN_URL ?? DEFAULT_OURA_TOKEN_URL,
  apiUrl: process.env.OPENVITALS_OURA_API_URL ?? DEFAULT_OURA_API_URL,
  redirectUri: process.env.OPENVITALS_OURA_REDIRECT_URI ?? "http://127.0.0.1:3000/v1/connect/callback/oura",
  scopes: ouraScopes()
});

const addSeconds = (seconds: number): string => new Date(Date.now() + Math.max(seconds, 0) * 1000).toISOString();

const externalUserIdFromPayload = (payload: Record<string, unknown>): string | null =>
  stringOrNull(payload.user_id) ?? stringOrNull(payload.userId) ?? stringOrNull(payload.id) ?? null;

const normalizeOuraTokenPayload = (
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
    throw new Error("Oura token response did not include access_token.");
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

const fetchOuraToken = async (payload: Record<string, string>): Promise<Record<string, unknown>> => {
  const config = ouraConfig();
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
    throw new Error(`Oura token endpoint responded with ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
};

export const buildOuraConnectMetadata = (input: {
  userId: string;
  sessionId: string;
  state: string;
}): {
  connectUrl: string;
  callbackUrl: string;
  state: string;
  connectionMethod: ConnectionMethod;
} => {
  const config = ouraConfig();
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

export const exchangeOuraCode = async (input: {
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
  const payload = await fetchOuraToken({
    grant_type: "authorization_code",
    code: input.code
  });
  return normalizeOuraTokenPayload(payload, {
    connectionMethod: "oauth",
    externalUserId: input.externalUserId,
    scopes: ouraScopes()
  });
};

export const refreshOuraCredential = async (credential: ProviderCredential): Promise<ProviderCredential> => {
  if (!credential.refreshToken) {
    throw new Error("Oura credential is missing refresh_token.");
  }
  const payload = await fetchOuraToken({
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken
  });
  const refreshed = normalizeOuraTokenPayload(payload, {
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

const queryWindow = (context: CollectorContext): { startDate: string; endDate: string } => {
  const end = new Date();
  const start = context.lastAnchor ? new Date(context.lastAnchor) : new Date(end.getTime() - (context.mode === "history" ? 30 : 3) * 24 * 60 * 60 * 1000);
  return {
    startDate: Number.isNaN(start.getTime()) ? new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
};

const fetchOuraCollection = async (input: {
  accessToken: string;
  path: string;
  context: CollectorContext;
}): Promise<Array<Record<string, unknown>>> => {
  const { apiUrl } = ouraConfig();
  const { startDate, endDate } = queryWindow(input.context);
  const results: Array<Record<string, unknown>> = [];
  let nextToken: string | null = null;

  do {
    const url = new URL(input.path, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    if (nextToken) {
      url.searchParams.set("next_token", nextToken);
    }
    const response = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`Oura API ${input.path} responded with ${response.status}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    results.push(...asArray(payload.data ?? payload.records ?? payload.results));
    nextToken = stringOrNull(payload.next_token) ?? stringOrNull(payload.nextToken);
  } while (nextToken);

  return results;
};

const pushRecord = (records: IngestRecord[], record: IngestRecord) => {
  records.push(IngestRecordSchema.parse(record));
};

const scoreValue = (row: Record<string, unknown>): number | null => {
  const score = row.score;
  if (typeof score === "number") {
    return score;
  }
  if (score && typeof score === "object") {
    return numberOrNull((score as Record<string, unknown>).score) ?? numberOrNull((score as Record<string, unknown>).value);
  }
  return null;
};

const toRecords = (input: {
  context: CollectorContext;
  heartRateRows: Array<Record<string, unknown>>;
  dailySleepRows: Array<Record<string, unknown>>;
  sleepRows: Array<Record<string, unknown>>;
  readinessRows: Array<Record<string, unknown>>;
  spo2Rows: Array<Record<string, unknown>>;
  stressRows: Array<Record<string, unknown>>;
  workoutRows: Array<Record<string, unknown>>;
}): IngestRecord[] => {
  const timezone = input.context.user.timezone;
  const records: IngestRecord[] = [];

  for (const row of input.heartRateRows) {
    const timestamp = isoOrNull(row.timestamp ?? row.time ?? row.start_datetime ?? row.datetime);
    const bpm = numberOrNull(row.bpm ?? row.heart_rate ?? row.heartRate);
    if (!timestamp || bpm === null) {
      continue;
    }
    const id = String(row.id ?? row.source_id ?? timestamp);
    pushRecord(records, {
      id: `oura-hr-${id}`,
      sourceRecordId: `oura-hr-${id}`,
      metricFamily: "cardiovascular",
      kind: "observation",
      metric: "heart_rate",
      value: bpm,
      unit: "bpm",
      startAt: timestamp,
      endAt: timestamp,
      timezone,
      captureMode: "direct",
      sourceApp: OURA_SOURCE_APP,
      bundleId: OURA_SOURCE_APP,
      confidence: 0.88,
      tags: ["provider_mediated", "sample", "not_live_signal"]
    });
  }

  for (const row of [...input.dailySleepRows, ...input.sleepRows]) {
    const startAt = isoOrNull(row.bedtime_start ?? row.start_datetime ?? row.start) ?? dayStartIso(row.day);
    const endAt = isoOrNull(row.bedtime_end ?? row.end_datetime ?? row.end) ?? dayEndIso(row.day);
    if (!startAt || !endAt) {
      continue;
    }
    const id = String(row.id ?? row.day ?? startAt);
    const totalSleepSeconds = numberOrNull(row.total_sleep_duration ?? row.total_sleep_duration_seconds ?? row.duration);
    const score = scoreValue(row);
    pushRecord(records, {
      id: `oura-sleep-${id}`,
      sourceRecordId: `oura-sleep-${id}`,
      metricFamily: "sleep",
      kind: "episode",
      metric: "sleep",
      episodeType: "sleep",
      title: "Oura Sleep",
      metrics: {
        ...(totalSleepSeconds !== null ? { duration_minutes: Math.round((totalSleepSeconds / 60) * 10) / 10 } : {}),
        ...(score !== null ? { readiness_score: score } : {})
      },
      notes: "Oura provider-mediated sleep summary; not a raw continuous sleep sensor stream.",
      unit: "hours",
      startAt,
      endAt,
      timezone,
      captureMode: "direct",
      sourceApp: OURA_SOURCE_APP,
      bundleId: OURA_SOURCE_APP,
      confidence: 0.9,
      tags: ["provider_mediated", "daily_summary"]
    });
  }

  for (const row of input.readinessRows) {
    const startAt = dayStartIso(row.day ?? row.date);
    const endAt = dayEndIso(row.day ?? row.date);
    const score = scoreValue(row);
    if (!startAt || !endAt || score === null) {
      continue;
    }
    const id = String(row.id ?? row.day ?? startAt);
    pushRecord(records, {
      id: `oura-readiness-${id}`,
      sourceRecordId: `oura-readiness-${id}`,
      metricFamily: "recovery",
      kind: "observation",
      metric: "readiness_score",
      dataGranularity: "score",
      latencyClass: "daily",
      value: score,
      unit: "score",
      startAt,
      endAt,
      timezone,
      captureMode: "direct",
      sourceApp: OURA_SOURCE_APP,
      bundleId: OURA_SOURCE_APP,
      confidence: 0.9,
      tags: ["provider_mediated", "daily_score"]
    });
  }

  for (const row of input.spo2Rows) {
    const startAt = dayStartIso(row.day ?? row.date);
    const endAt = dayEndIso(row.day ?? row.date);
    const spo2 = numberOrNull(row.spo2_percentage ?? row.average_spo2 ?? row.average ?? row.value);
    if (!startAt || !endAt || spo2 === null) {
      continue;
    }
    const id = String(row.id ?? row.day ?? startAt);
    pushRecord(records, {
      id: `oura-spo2-${id}`,
      sourceRecordId: `oura-spo2-${id}`,
      metricFamily: "cardiovascular",
      kind: "observation",
      metric: "spo2",
      dataGranularity: "daily_summary",
      latencyClass: "daily",
      value: spo2,
      unit: "%",
      startAt,
      endAt,
      timezone,
      captureMode: "direct",
      sourceApp: OURA_SOURCE_APP,
      bundleId: OURA_SOURCE_APP,
      confidence: 0.86,
      tags: ["provider_mediated", "daily_summary"]
    });
  }

  for (const row of input.stressRows) {
    const startAt = dayStartIso(row.day ?? row.date);
    const endAt = dayEndIso(row.day ?? row.date);
    const stress = numberOrNull(row.stress_high ?? row.day_summary ?? row.score ?? row.value);
    if (!startAt || !endAt || stress === null) {
      continue;
    }
    const id = String(row.id ?? row.day ?? startAt);
    pushRecord(records, {
      id: `oura-stress-${id}`,
      sourceRecordId: `oura-stress-${id}`,
      metricFamily: "recovery",
      kind: "observation",
      metric: "stress",
      dataGranularity: "daily_summary",
      latencyClass: "daily",
      value: stress,
      unit: "score",
      startAt,
      endAt,
      timezone,
      captureMode: "direct",
      sourceApp: OURA_SOURCE_APP,
      bundleId: OURA_SOURCE_APP,
      confidence: 0.82,
      tags: ["provider_mediated", "daily_summary"]
    });
  }

  for (const row of input.workoutRows) {
    const startAt = isoOrNull(row.start_datetime ?? row.start);
    const endAt = isoOrNull(row.end_datetime ?? row.end);
    if (!startAt || !endAt) {
      continue;
    }
    const id = String(row.id ?? row.source_id ?? startAt);
    const calories = numberOrNull(row.calories);
    const distance = numberOrNull(row.distance);
    pushRecord(records, {
      id: `oura-workout-${id}`,
      sourceRecordId: `oura-workout-${id}`,
      metricFamily: "workout",
      kind: "episode",
      metric: "workout",
      episodeType: "workout",
      title: String(row.activity ?? row.type ?? "Oura Workout"),
      metrics: {
        ...(calories !== null ? { calories } : {}),
        ...(distance !== null ? { distance_meters: distance } : {})
      },
      notes: "Oura workout summary from provider API.",
      unit: "activity",
      startAt,
      endAt,
      timezone,
      captureMode: "direct",
      sourceApp: OURA_SOURCE_APP,
      bundleId: OURA_SOURCE_APP,
      confidence: 0.86,
      tags: ["provider_mediated", "episode"]
    });
  }

  const uniqueBySourceRecord = new Map<string, IngestRecord>();
  for (const record of records) {
    uniqueBySourceRecord.set(record.sourceRecordId, record);
  }
  return [...uniqueBySourceRecord.values()];
};

export const loadOuraPayloadFromCredential = async (input: {
  context: CollectorContext;
  credential: ProviderCredential;
}): Promise<NormalizedPayload> => {
  const [heartRateRows, dailySleepRows, sleepRows, readinessRows, spo2Rows, stressRows, workoutRows] = await Promise.all([
    fetchOuraCollection({ accessToken: input.credential.accessToken, path: "v2/usercollection/heartrate", context: input.context }).catch(() => []),
    fetchOuraCollection({ accessToken: input.credential.accessToken, path: "v2/usercollection/daily_sleep", context: input.context }).catch(() => []),
    fetchOuraCollection({ accessToken: input.credential.accessToken, path: "v2/usercollection/sleep", context: input.context }).catch(() => []),
    fetchOuraCollection({ accessToken: input.credential.accessToken, path: "v2/usercollection/daily_readiness", context: input.context }).catch(() => []),
    fetchOuraCollection({ accessToken: input.credential.accessToken, path: "v2/usercollection/daily_spo2", context: input.context }).catch(() => []),
    fetchOuraCollection({ accessToken: input.credential.accessToken, path: "v2/usercollection/daily_stress", context: input.context }).catch(() => []),
    fetchOuraCollection({ accessToken: input.credential.accessToken, path: "v2/usercollection/workout", context: input.context }).catch(() => [])
  ]);

  const records = toRecords({
    context: input.context,
    heartRateRows,
    dailySleepRows,
    sleepRows,
    readinessRows,
    spo2Rows,
    stressRows,
    workoutRows
  });

  if (records.length === 0) {
    return emptyPayload();
  }

  return normalizeIngestRecordsAsPayload({
    user: input.context.user,
    providerId: "oura",
    sourceAccount: input.context.sourceAccount,
    records,
    now: new Date()
  });
};

const loadFromEnvToken = async (context: CollectorContext): Promise<NormalizedPayload | null> => {
  const accessToken = process.env.OPENVITALS_OURA_ACCESS_TOKEN;
  if (!accessToken) {
    return null;
  }

  return loadOuraPayloadFromCredential({
    context,
    credential: {
      id: `provider_credential_oura_env_${context.user.id}`,
      userId: context.user.id,
      providerId: "oura",
      authState: "connected",
      connectionMethod: "env-token",
      accessToken,
      refreshToken: null,
      expiresAt: null,
      scopes: ouraScopes(),
      externalUserId: `env:${context.user.id}`,
      lastRefreshAt: null,
      lastRefreshError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
};

const loadFromBridge = async (context: CollectorContext): Promise<NormalizedPayload> => {
  const bridgeUrl = process.env.OPENVITALS_OURA_BRIDGE_URL;
  if (!bridgeUrl) {
    return emptyPayload();
  }
  const url = new URL(bridgeUrl);
  url.searchParams.set("mode", context.mode);
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
    throw new Error(`Oura bridge responded with ${response.status}`);
  }
  return NormalizedPayloadSchema.parse(await response.json());
};

export const createOuraLiveCollector = (manifest: ProviderManifest): Collector => ({
  manifest,
  async connect(user) {
    const sessionId = `session_oura_${user.id}`;
    const connect = buildOuraConnectMetadata({
      userId: user.id,
      sessionId,
      state: `oura:${user.id}:${crypto.randomUUID()}`
    });
    return {
      connectUrl: connect.connectUrl,
      sessionId
    };
  },
  async exchangeSession(sessionId) {
    return {
      accessToken: `oura_access_${sessionId}`,
      refreshToken: `oura_refresh_${sessionId}`
    };
  },
  async syncHistory(context) {
    const fromApi = await loadFromEnvToken(context).catch(() => null);
    if (fromApi) {
      return NormalizedPayloadSchema.parse(fromApi);
    }
    return loadFromBridge(context);
  },
  async syncIncremental(context) {
    return this.syncHistory(context);
  },
  async subscribeUpdates() {
    return {
      subscribed: true,
      channel: "openvitals.oura.provider-mediated-sync"
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
    const config = ouraConfig();
    const hasOauth = Boolean(config.clientId && config.clientSecret && config.redirectUri);
    const hasEnvToken = Boolean(process.env.OPENVITALS_OURA_ACCESS_TOKEN);
    const hasBridge = Boolean(process.env.OPENVITALS_OURA_BRIDGE_URL);
    return {
      ok: true,
      providerId: "oura",
      message: hasEnvToken
        ? `${manifest.displayName} env-token sync is configured for delayed/provider-mediated summaries and samples.`
        : hasBridge
          ? `${manifest.displayName} bridge sync is configured for delayed/provider-mediated summaries and samples.`
          : hasOauth
            ? `${manifest.displayName} OAuth metadata is configured; shared API credential exchange is required before per-user sync.`
            : `${manifest.displayName} is provider-mediated and delayed; configure OAuth, env token, or bridge before claiming real direct data.`
    };
  }
});
