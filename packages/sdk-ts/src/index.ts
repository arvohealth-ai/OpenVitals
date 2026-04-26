import {
  AlertSchema,
  AlertsQuerySchema,
  ConnectCallbackInputSchema,
  ConnectCallbackResponseSchema,
  ConnectSessionResponseSchema,
  ConnectStartResponseSchema,
  ConnectorsResponseSchema,
  DailySummarySchema,
  DailySummariesQuerySchema,
  ExplainResponseSchema,
  HouseholdBootstrapInputSchema,
  HouseholdBootstrapResultSchema,
  IngestBatchInputSchema,
  IngestBatchResultSchema,
  OutboxEventSchema,
  ProfilesListResponseSchema,
  ProviderIdSchema,
  SourceFilterSchema,
  SourcePrecedenceOverrideSchema,
  SyncStatusResponseSchema,
  TimelineEntrySchema,
  TimelineQuerySchema,
  ScoreSchema,
  ScoresQuerySchema,
  SyncRequestSchema,
  WebhookDeliverySchema,
  WebhookEndpointSchema
} from "@openvitals/contracts";
import type { ExplainResponse, ProviderId, SyncStatusEntry, SyncStatusResponse } from "@openvitals/contracts";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
};

export type OpenVitalsClientOptions = {
  agentToken?: string;
};

export const DATA_GRANULARITIES = ["provider_payload", "sample", "episode", "daily_summary", "score", "live_signal"] as const;
export type DataGranularity = (typeof DATA_GRANULARITIES)[number];

export const LATENCY_CLASSES = ["live", "near_realtime", "delayed_sync", "daily", "manual"] as const;
export type LatencyClass = (typeof LATENCY_CLASSES)[number];

export type CompanionRole = "iphone_companion" | "optional_watch_live_workout" | "android_companion" | "cloud_connector" | "mock_or_demo";

export type SourceSignalSemantics = {
  providerId: ProviderId;
  dataMode: SyncStatusEntry["dataMode"];
  connectionMethod: SyncStatusEntry["connectionMethod"];
  connectionMode: SyncStatusEntry["connectionMode"];
  dataGranularity: DataGranularity;
  latencyClass: LatencyClass;
  freshnessHours: number;
  dataQualityGate: SyncStatusEntry["dataQualityGate"];
  stale: boolean;
  stalenessReason: string | null;
  lastSyncAt: string;
  lastSuccessfulSyncAt: string | null;
  queueDepth: number;
  companionRole: CompanionRole;
  liveSignalCapable: boolean;
  liveSignalActive: boolean;
  confidenceNote: string;
  companionNote: string;
};

export type SyncStatusSemantics = {
  userId: string;
  generatedAt: string;
  staleThresholdHours: number;
  gateOpen: boolean;
  gateReason: string | null;
  staleProviders: ProviderId[];
  missingProviders: ProviderId[];
  delayedProviders: ProviderId[];
  liveSignalProviders: ProviderId[];
  liveSignalCapableProviders: ProviderId[];
  iphoneCompanionRequired: boolean;
  watchAppRequiredForHistoricalSync: boolean;
  watchAppRequiredForLiveWorkoutHr: boolean;
  sources: SourceSignalSemantics[];
};

export type ExplanationSignalSemantics = {
  entity: ExplainResponse["entity"];
  id: string;
  dataGranularity: DataGranularity;
  latencyClass: LatencyClass;
  freshnessHours: number | null;
  stale: boolean;
  stalenessReason: string | null;
  confidence: number | null;
  missingSignals: string[];
  suppressedSources: ProviderId[];
  mirroredOrSuppressed: boolean;
};

const staleThresholdHours = 24;
const cloudProviderIds = new Set<ProviderId>(["oura", "whoop", "garmin", "strava"]);
const mobileProviderIds = new Set<ProviderId>(["apple-health", "health-connect"]);

const roundHours = (value: number): number => Math.max(Math.round(value * 10) / 10, 0);

const effectiveConnectionModeForSource = (source: SyncStatusEntry): SyncStatusEntry["connectionMode"] => {
  if (source.connectionMode !== "mock" || source.connectionMethod === "mock") {
    return source.connectionMode;
  }
  if (source.connectionMethod === "sdk-ingest" && mobileProviderIds.has(source.providerId)) {
    return "mobile_permission";
  }
  if (source.connectionMethod === "oauth") {
    return "cloud_oauth";
  }
  if (source.connectionMethod === "bridge") {
    return "device_pairing";
  }
  return source.connectionMode;
};

const liveSignalCapableForSource = (source: SyncStatusEntry): boolean =>
  source.metricCapabilities.some((capability) => capability.dataGranularity === "live_signal" && capability.latencyClass === "live");

const liveSignalActiveForSource = (source: SyncStatusEntry): boolean =>
  source.providerId === "apple-health" &&
  source.connectionMethod === "sdk-ingest" &&
  effectiveConnectionModeForSource(source) === "device_pairing";

const dataGranularityForSource = (source: SyncStatusEntry): DataGranularity => {
  if (liveSignalActiveForSource(source)) {
    return "live_signal";
  }
  if (source.connectionMethod === "sdk-ingest" && mobileProviderIds.has(source.providerId)) {
    return "sample";
  }
  return "provider_payload";
};

const latencyClassForSource = (source: SyncStatusEntry): LatencyClass => {
  if (liveSignalActiveForSource(source)) {
    return "live";
  }
  if (source.connectionMethod === "mock") {
    return "manual";
  }
  if (source.connectionMethod === "sdk-ingest" && mobileProviderIds.has(source.providerId) && source.syncFreshnessHours <= 1) {
    return "near_realtime";
  }
  if (cloudProviderIds.has(source.providerId)) {
    return "delayed_sync";
  }
  return source.syncFreshnessHours >= staleThresholdHours ? "daily" : "delayed_sync";
};

const companionRoleForSource = (source: SyncStatusEntry): CompanionRole => {
  if (liveSignalActiveForSource(source)) {
    return "optional_watch_live_workout";
  }
  if (source.providerId === "apple-health" && source.connectionMethod === "sdk-ingest") {
    return "iphone_companion";
  }
  if (source.providerId === "health-connect" && source.connectionMethod === "sdk-ingest") {
    return "android_companion";
  }
  if (source.connectionMethod === "mock" || source.dataMode !== "live") {
    return "mock_or_demo";
  }
  return "cloud_connector";
};

const confidenceNoteForSource = (source: SyncStatusEntry, stale: boolean): string => {
  if (source.dataMode !== "live") {
    return "Demo or mock data; do not present as hardware-backed live telemetry.";
  }
  if (liveSignalActiveForSource(source)) {
    return stale
      ? "Optional Apple Watch live-workout signal is stale; stop live claims until fresh workout samples arrive."
      : "Optional Apple Watch live-workout heart-rate is active and may be described as live_signal/live.";
  }
  if (source.providerId === "apple-health" && source.connectionMethod === "sdk-ingest") {
    return stale
      ? "iPhone companion Apple Health samples are stale; ask the user to open the iPhone app or run Sync Now."
      : "Apple Health is connected through the iPhone companion; historical Apple Watch samples remain HealthKit samples, not live streams.";
  }
  if (source.connectionMethod === "sdk-ingest" && mobileProviderIds.has(source.providerId)) {
    return stale
      ? "Mobile platform samples exist but are stale; defer confident coaching until a fresh sync completes."
      : "Mobile platform samples are recently synced; do not call them real-time unless a live workout stream is explicit.";
  }
  if (cloudProviderIds.has(source.providerId)) {
    return stale
      ? "Cloud provider payload is stale or incomplete; avoid current-state claims."
      : "Cloud provider payload is delayed/provider-mediated rather than continuous raw sensor streaming.";
  }
  return stale ? "Source is stale or missing; avoid high-confidence guidance." : "Source freshness is acceptable for derived guidance.";
};

const companionNoteForSource = (source: SyncStatusEntry, liveSignalCapable: boolean, liveSignalActive: boolean): string => {
  if (source.providerId === "apple-health") {
    if (liveSignalActive) {
      return "Optional Apple Watch workout mode is providing live heart-rate samples; this is the only Apple Health path that should be called live.";
    }
    if (liveSignalCapable) {
      return "Apple Health uses the iPhone companion for normal sync. The Apple Watch app is optional and only required for live workout heart-rate; historical Watch samples arrive through HealthKit on iPhone.";
    }
    return "Apple Health uses the iPhone companion for HealthKit authorization, historical sync, background/incremental sync, and manual Sync Now.";
  }
  if (source.providerId === "health-connect") {
    return "Health Connect uses the Android/mobile companion path; treat samples as platform sync data unless a live signal is explicit.";
  }
  if (cloudProviderIds.has(source.providerId)) {
    return "Cloud provider data is delayed/provider-mediated and should not be described as continuous raw sensor streaming.";
  }
  return "Use source freshness and data-quality gates before giving coaching advice.";
};

export const summarizeSyncStatusSemantics = (syncStatus: SyncStatusResponse, generatedAt = new Date()): SyncStatusSemantics => {
  const sources = syncStatus.sources.map((source): SourceSignalSemantics => {
    const stale = source.dataQualityGate !== "ok" || source.syncFreshnessHours >= staleThresholdHours;
    const connectionMode = effectiveConnectionModeForSource(source);
    const dataGranularity = dataGranularityForSource(source);
    const latencyClass = latencyClassForSource(source);
    const liveSignalCapable = liveSignalCapableForSource(source);
    const liveSignalActive = liveSignalActiveForSource(source);
    return {
      providerId: source.providerId,
      dataMode: source.dataMode,
      connectionMethod: source.connectionMethod,
      connectionMode,
      dataGranularity,
      latencyClass,
      freshnessHours: roundHours(source.syncFreshnessHours),
      dataQualityGate: source.dataQualityGate,
      stale,
      stalenessReason: source.stalenessReason ?? (stale ? "freshness_or_quality_gate" : null),
      lastSyncAt: source.lastSyncAt,
      lastSuccessfulSyncAt: source.lastSuccessfulSyncAt,
      queueDepth: source.queueDepth,
      companionRole: companionRoleForSource(source),
      liveSignalCapable,
      liveSignalActive,
      confidenceNote: confidenceNoteForSource(source, stale),
      companionNote: companionNoteForSource(source, liveSignalCapable, liveSignalActive)
    };
  });

  const staleProviders = sources.filter((source) => source.dataQualityGate === "stale" || source.stale).map((source) => source.providerId);
  const missingProviders = sources.filter((source) => source.dataQualityGate === "missing").map((source) => source.providerId);
  const delayedProviders = sources.filter((source) => source.latencyClass === "delayed_sync" || source.latencyClass === "daily").map((source) => source.providerId);
  const liveSignalProviders = sources.filter((source) => source.dataGranularity === "live_signal").map((source) => source.providerId);
  const liveSignalCapableProviders = sources.filter((source) => source.liveSignalCapable).map((source) => source.providerId);
  const gateOpen = staleProviders.length === 0 && missingProviders.length === 0;

  return {
    userId: syncStatus.userId,
    generatedAt: generatedAt.toISOString(),
    staleThresholdHours,
    gateOpen,
    gateReason: gateOpen ? null : "stale_or_missing_data",
    staleProviders,
    missingProviders,
    delayedProviders,
    liveSignalProviders,
    liveSignalCapableProviders,
    iphoneCompanionRequired: sources.some((source) => source.providerId === "apple-health"),
    watchAppRequiredForHistoricalSync: false,
    watchAppRequiredForLiveWorkoutHr: liveSignalCapableProviders.includes("apple-health"),
    sources
  };
};

const dataGranularityForExplanation = (explanation: ExplainResponse): DataGranularity => {
  if (explanation.entity === "score") {
    return "score";
  }
  if (explanation.entity === "daily_summary") {
    return "daily_summary";
  }
  if (explanation.entity === "episode") {
    return "episode";
  }
  if (explanation.entity === "observation") {
    return "sample";
  }
  return "provider_payload";
};

const numericPayloadField = (payload: Record<string, unknown>, key: string): number | null => {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const stringArrayPayloadField = (payload: Record<string, unknown>, key: string): string[] => {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

export const summarizeExplanationSemantics = (explanation: ExplainResponse): ExplanationSignalSemantics => {
  const freshnessHours = numericPayloadField(explanation.payload, "freshnessHours");
  const confidence = numericPayloadField(explanation.payload, "confidence");
  const missingSignals = stringArrayPayloadField(explanation.payload, "missingSignals");
  const dataGranularity = dataGranularityForExplanation(explanation);
  const stale = (freshnessHours ?? 0) >= staleThresholdHours || missingSignals.length > 0;
  return {
    entity: explanation.entity,
    id: explanation.id,
    dataGranularity,
    latencyClass: dataGranularity === "score" || dataGranularity === "daily_summary" ? "daily" : stale ? "daily" : "delayed_sync",
    freshnessHours: freshnessHours === null ? null : roundHours(freshnessHours),
    stale,
    stalenessReason: stale ? (missingSignals.length > 0 ? "missing_signals" : "freshness_threshold_exceeded") : null,
    confidence,
    missingSignals,
    suppressedSources: explanation.suppressedSources,
    mirroredOrSuppressed: explanation.suppressedSources.length > 0 || explanation.suppressedRecords.length > 0
  };
};

const buildUrl = (baseUrl: string, path: string, query?: Record<string, string | number | undefined>): string => {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
};

export class OpenVitalsClient {
  private readonly baseUrl: string;
  private agentToken?: string;

  constructor(baseUrl: string, options: OpenVitalsClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.agentToken = options.agentToken;
  }

  setAgentToken(token: string | undefined) {
    this.agentToken = token;
  }

  private async request<T>(path: string, parser: { parse: (value: unknown) => T }, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.body) {
      headers["content-type"] = "application/json";
    }
    if (this.agentToken) {
      headers.authorization = `Bearer ${this.agentToken}`;
    }
    const response = await fetch(buildUrl(this.baseUrl, path, options.query), {
      method: options.method ?? "GET",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
      throw new Error(`OpenVitals request failed: ${response.status} ${response.statusText}`);
    }

    return parser.parse(await response.json());
  }

  async connectors(userId: string) {
    return this.request(`/v1/connectors`, ConnectorsResponseSchema, { query: { userId } });
  }

  async users() {
    return this.request(`/v1/users`, ProfilesListResponseSchema);
  }

  async dashboardState(userId: string) {
    return this.request(`/v1/dashboard/state`, { parse: (value: unknown) => value }, { query: { userId } });
  }

  async syncUser(userId: string, input: unknown = {}) {
    return this.request(`/v1/users/${userId}/sync`, { parse: (value: unknown) => value }, {
      method: "POST",
      body: SyncRequestSchema.parse(input)
    });
  }

  async whoopWebhook(userId: string, payload: Record<string, unknown> = {}, options: { signature?: string; adminToken?: string } = {}) {
    const headers: Record<string, string> = {};
    if (options.signature) {
      headers["x-openvitals-whoop-signature"] = options.signature;
    }
    if (options.adminToken) {
      headers["x-openvitals-admin"] = options.adminToken;
    }
    return this.request(`/v1/users/${userId}/providers/whoop/webhook`, { parse: (value: unknown) => value }, {
      method: "POST",
      body: payload,
      headers
    });
  }

  async createConnectorSession(userId: string, providerId: unknown) {
    const provider = ProviderIdSchema.parse(providerId);
    return this.request(`/v1/users/${userId}/connect/${provider}/session`, ConnectSessionResponseSchema, {
      method: "POST"
    });
  }

  async connectStart(userId: string, providerId: unknown) {
    const provider = ProviderIdSchema.parse(providerId);
    return this.request(`/v1/users/${userId}/connect/${provider}/start`, ConnectStartResponseSchema, {
      method: "POST"
    });
  }

  async connectCallback(userId: string, providerId: unknown, input: unknown) {
    const provider = ProviderIdSchema.parse(providerId);
    return this.request(`/v1/users/${userId}/connect/${provider}/callback`, ConnectCallbackResponseSchema, {
      method: "POST",
      body: ConnectCallbackInputSchema.parse(input)
    });
  }

  async ingestBatch(userId: string, providerId: unknown, input: unknown) {
    const provider = ProviderIdSchema.parse(providerId);
    return this.request(`/v1/users/${userId}/ingest/${provider}`, IngestBatchResultSchema, {
      method: "POST",
      body: IngestBatchInputSchema.parse(input)
    });
  }

  async syncStatus(userId: string) {
    return this.request(`/v1/users/${userId}/sync-status`, SyncStatusResponseSchema);
  }

  async signalFreshness(userId: string) {
    const syncStatus = await this.syncStatus(userId);
    return {
      ...syncStatus,
      semantics: summarizeSyncStatusSemantics(syncStatus)
    };
  }

  async setSourceFilter(userId: string, providerId: unknown, ignoredSources: string[]) {
    const provider = ProviderIdSchema.parse(providerId);
    return this.request(`/v1/users/${userId}/source-filters`, SourceFilterSchema, {
      method: "PUT",
      body: {
        providerId: provider,
        ignoredSources
      }
    });
  }

  async setSourcePrecedence(userId: string, precedence: { direct: number; mirrored: number; imported: number; manual: number }) {
    return this.request(`/v1/users/${userId}/source-precedence`, SourcePrecedenceOverrideSchema, {
      method: "PUT",
      body: {
        precedence
      }
    });
  }

  async timeline(input: unknown) {
    const query = TimelineQuerySchema.parse(input);
    return this.request(`/v1/timeline`, TimelineEntrySchema.array(), { query });
  }

  async dailySummaries(input: unknown) {
    const query = DailySummariesQuerySchema.parse(input);
    return this.request(`/v1/summaries/daily`, DailySummarySchema.array(), { query });
  }

  async scores(input: unknown) {
    const query = ScoresQuerySchema.parse(input);
    return this.request(`/v1/scores`, ScoreSchema.array(), { query });
  }

  async alerts(input: unknown) {
    const query = AlertsQuerySchema.parse(input);
    return this.request(`/v1/alerts`, AlertSchema.array(), { query });
  }

  async explain(entity: string, id: string) {
    return this.request(`/v1/explain/${entity}/${id}`, ExplainResponseSchema);
  }

  async explainWithSemantics(entity: string, id: string) {
    const explanation = await this.explain(entity, id);
    return {
      ...explanation,
      semantics: summarizeExplanationSemantics(explanation)
    };
  }

  async explainDedupe(fingerprint: string) {
    return this.request(`/v1/explain-dedupe/${fingerprint}`, { parse: (value: unknown) => value });
  }

  async exportOmh(userId: string) {
    return this.request(`/v1/export/omh`, {
      parse: (value: unknown) => value
    }, { query: { userId } });
  }

  async exportFhir(userId: string) {
    return this.request(`/v1/export/fhir`, {
      parse: (value: unknown) => value
    }, { query: { userId } });
  }

  async listWebhooks() {
    return this.request(`/v1/webhooks`, WebhookEndpointSchema.array());
  }

  async createWebhook(input: unknown) {
    return this.request(`/v1/webhooks`, WebhookEndpointSchema, {
      method: "POST",
      body: input
    });
  }

  async ackAlert(alertId: string) {
    return this.request(`/v1/alerts/${alertId}/ack`, AlertSchema, { method: "POST" });
  }

  async setGoal(body: Record<string, unknown>) {
    return this.request(`/v1/goals`, { parse: (value: unknown) => value }, { method: "POST", body });
  }

  async setQuietHours(body: Record<string, unknown>) {
    return this.request(`/v1/quiet-hours`, { parse: (value: unknown) => value }, { method: "POST", body });
  }

  async outboxEvents(input: { userId: string; after?: number; limit?: number }) {
    return this.request(`/v1/experimental/outbox/events`, OutboxEventSchema.array(), {
      query: {
        userId: input.userId,
        after: input.after ?? 0,
        limit: input.limit ?? 200
      }
    });
  }

  async webhookDeliveries(input: { eventId?: string; webhookId?: string } = {}) {
    return this.request(`/v1/experimental/webhook-deliveries`, WebhookDeliverySchema.array(), {
      query: {
        eventId: input.eventId,
        webhookId: input.webhookId
      }
    });
  }

  async liveBootstrap(
    input: { userId?: string; name?: string; timezone?: string; providers?: string[]; createTokens?: boolean } = {},
    adminToken = "openvitals-dev-admin"
  ) {
    return this.request(`/v1/live/bootstrap`, { parse: (value: unknown) => value }, {
      method: "POST",
      body: input,
      headers: {
        "x-openvitals-admin": adminToken
      }
    });
  }

  async householdBootstrap(input: unknown, adminToken = "openvitals-dev-admin") {
    return this.request(`/v1/household/bootstrap`, HouseholdBootstrapResultSchema, {
      method: "POST",
      body: HouseholdBootstrapInputSchema.parse(input),
      headers: {
        "x-openvitals-admin": adminToken
      }
    });
  }
}

export * from "@openvitals/contracts";
