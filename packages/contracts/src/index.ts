import { z } from "zod";

export const API_TRACKS = ["stable", "experimental"] as const;
export const ApiTrackSchema = z.enum(API_TRACKS);
export type ApiTrack = z.infer<typeof ApiTrackSchema>;

export const RUNTIME_MODES = ["demo", "live"] as const;
export const RuntimeModeSchema = z.enum(RUNTIME_MODES);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

export const COLLECTOR_RUNTIME_PATHS = ["mock", "live", "hybrid"] as const;
export const CollectorRuntimePathSchema = z.enum(COLLECTOR_RUNTIME_PATHS);
export type CollectorRuntimePath = z.infer<typeof CollectorRuntimePathSchema>;

export const DATA_MODES = ["demo", "live"] as const;
export const DataModeSchema = z.enum(DATA_MODES);
export type DataMode = z.infer<typeof DataModeSchema>;

export const DATA_GRANULARITIES = [
  "provider_payload",
  "sample",
  "episode",
  "daily_summary",
  "score",
  "live_signal"
] as const;
export const DataGranularitySchema = z.enum(DATA_GRANULARITIES);
export type DataGranularity = z.infer<typeof DataGranularitySchema>;

export const LATENCY_CLASSES = ["live", "near_realtime", "delayed_sync", "daily", "manual"] as const;
export const LatencyClassSchema = z.enum(LATENCY_CLASSES);
export type LatencyClass = z.infer<typeof LatencyClassSchema>;

export const AUTH_STATES = ["not_connected", "connected", "expired", "reauth_required"] as const;
export const AuthStateSchema = z.enum(AUTH_STATES);
export type AuthState = z.infer<typeof AuthStateSchema>;

export const CONNECTION_METHODS = ["sdk-ingest", "oauth", "env-token", "bridge", "mock"] as const;
export const ConnectionMethodSchema = z.enum(CONNECTION_METHODS);
export type ConnectionMethod = z.infer<typeof ConnectionMethodSchema>;

export const CONNECTION_MODES = ["cloud_oauth", "mobile_permission", "device_pairing", "mock"] as const;
export const ConnectionModeSchema = z.enum(CONNECTION_MODES);
export type ConnectionMode = z.infer<typeof ConnectionModeSchema>;

export const DATA_QUALITY_GATES = ["ok", "stale", "missing"] as const;
export const DataQualityGateSchema = z.enum(DATA_QUALITY_GATES);
export type DataQualityGate = z.infer<typeof DataQualityGateSchema>;

export const PROVIDER_IDS = [
  "apple-health",
  "health-connect",
  "oura",
  "whoop",
  "garmin",
  "strava"
] as const;

export const ProviderIdSchema = z.enum(PROVIDER_IDS);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const MetricCapabilitySchema = z.object({
  metricName: z.string(),
  source: ProviderIdSchema,
  dataGranularity: DataGranularitySchema,
  latencyClass: LatencyClassSchema,
  direct: z.boolean(),
  mirrored: z.boolean().default(false)
});
export type MetricCapability = z.infer<typeof MetricCapabilitySchema>;

export const CAPTURE_MODES = ["direct", "mirrored", "manual", "imported", "derived"] as const;
export const CaptureModeSchema = z.enum(CAPTURE_MODES);
export type CaptureMode = z.infer<typeof CaptureModeSchema>;

export const CaptureModePrecedenceSchema = z.object({
  direct: z.number().int(),
  mirrored: z.number().int(),
  imported: z.number().int(),
  manual: z.number().int()
});
export type CaptureModePrecedence = z.infer<typeof CaptureModePrecedenceSchema>;

export const METRIC_FAMILIES = [
  "sleep",
  "recovery",
  "activity",
  "cardiovascular",
  "workout",
  "freshness",
  "goal"
] as const;
export const MetricFamilySchema = z.enum(METRIC_FAMILIES);
export type MetricFamily = z.infer<typeof MetricFamilySchema>;

export const SCORE_KINDS = [
  "sleep_consistency",
  "recovery_readiness",
  "strain_balance",
  "circadian_disruption"
] as const;
export const ScoreKindSchema = z.enum(SCORE_KINDS);
export type ScoreKind = z.infer<typeof ScoreKindSchema>;

export const WORKFLOW_KINDS = [
  "morning_brief",
  "recovery_alert",
  "weekly_review",
  "sync_stale_alert"
] as const;
export const WorkflowKindSchema = z.enum(WORKFLOW_KINDS);
export type WorkflowKind = z.infer<typeof WorkflowKindSchema>;

export const EVENT_TYPES = [
  "health.sync.completed",
  "health.brief.daily.ready",
  "health.sync.stale",
  "health.score.updated",
  "health.alert.recovery.low",
  "health.review.weekly.ready"
] as const;
export const EventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventTypeSchema>;

export const AGENT_SCOPES = [
  "read.derived",
  "read.sleep",
  "read.workouts",
  "read.activity",
  "read.raw",
  "read.labs",
  "read.sync",
  "send.nudges",
  "create.calendar_event",
  "write.goals",
  "write.preferences",
  "admin.tokens"
] as const;
export const AgentScopeSchema = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof AgentScopeSchema>;

export const MCP_TOOL_NAMES = [
  "health.daily_brief",
  "health.weekly_review",
  "health.recovery_status",
  "health.compare_periods",
  "health.explain_score",
  "health.explain_dedupe",
  "health.list_profiles",
  "health.sync_now",
  "health.list_alerts",
  "health.ack_alert",
  "health.sync_status",
  "health.set_goal",
  "health.set_quiet_hours",
  "health.experimental.outbox_events",
  "health.experimental.webhook_deliveries"
] as const;
export const McpToolNameSchema = z.enum(MCP_TOOL_NAMES);
export type McpToolName = z.infer<typeof McpToolNameSchema>;

export const ProvenanceNodeSchema = z.object({
  providerId: ProviderIdSchema,
  sourceRecordId: z.string(),
  captureMode: CaptureModeSchema,
  role: z.enum(["primary", "mirror", "suppressed", "derived", "raw"])
});
export type ProvenanceNode = z.infer<typeof ProvenanceNodeSchema>;

export const ProvenanceFieldsSchema = z.object({
  source: ProviderIdSchema,
  sourceRecordId: z.string(),
  sourceApp: z.string(),
  bundleId: z.string().nullable().optional().default(null),
  packageName: z.string().nullable().optional().default(null),
  captureMode: CaptureModeSchema,
  originalType: z.string(),
  unit: z.string(),
  dataGranularity: DataGranularitySchema.default("sample"),
  latencyClass: LatencyClassSchema.default("delayed_sync"),
  timezone: z.string(),
  freshnessHours: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  dedupeGroupId: z.string(),
  provenanceChain: z.array(ProvenanceNodeSchema),
  whyPrimary: z.string(),
  suppressedSources: z.array(ProviderIdSchema)
});
export type ProvenanceFields = z.infer<typeof ProvenanceFieldsSchema>;

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  createdAt: z.string().datetime()
});
export type User = z.infer<typeof UserSchema>;

export const ProfileSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  lastSyncAt: z.string().datetime().nullable()
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;

export const SourceAccountSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  platform: z.enum(["mobile", "cloud"]),
  status: z.enum(["connected", "stale", "errored"]),
  lastSyncAt: z.string().datetime(),
  syncFreshnessHours: z.number().nonnegative(),
  capabilities: z.array(z.string()),
  metricCapabilities: z.array(MetricCapabilitySchema).default([]),
  connectionMode: ConnectionModeSchema.default("mock"),
  externalUserId: z.string(),
  connectionLabel: z.string()
});
export type SourceAccount = z.infer<typeof SourceAccountSchema>;

export const DeviceSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sourceAccountId: z.string(),
  providerId: ProviderIdSchema,
  name: z.string(),
  model: z.string(),
  platform: z.string(),
  lastSeenAt: z.string().datetime()
});
export type Device = z.infer<typeof DeviceSchema>;

export const ConsentGrantSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sourceAccountId: z.string(),
  scopes: z.array(z.string()),
  grantedAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable()
});
export type ConsentGrant = z.infer<typeof ConsentGrantSchema>;

export const RawEventSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sourceAccountId: z.string(),
  providerId: ProviderIdSchema,
  eventType: z.string(),
  dataGranularity: DataGranularitySchema.default("provider_payload"),
  latencyClass: LatencyClassSchema.default("delayed_sync"),
  sourceRecordId: z.string(),
  capturedAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown())
});
export type RawEvent = z.infer<typeof RawEventSchema>;

const BaseTimelineSchema = z.object({
  id: z.string(),
  userId: z.string(),
  sourceAccountId: z.string(),
  deviceId: z.string().nullable(),
  metricFamily: MetricFamilySchema,
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  createdAt: z.string().datetime()
}).merge(ProvenanceFieldsSchema);

export const ObservationSchema = BaseTimelineSchema.extend({
  kind: z.literal("observation"),
  metric: z.string(),
  value: z.number(),
  normalizedValue: z.number().nullable(),
  tags: z.array(z.string())
});
export type Observation = z.infer<typeof ObservationSchema>;

export const EpisodeSchema = BaseTimelineSchema.extend({
  kind: z.literal("episode"),
  episodeType: z.enum(["sleep", "workout", "meal", "measurement"]),
  title: z.string(),
  metrics: z.record(z.string(), z.number()),
  notes: z.string().nullable()
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const TimelineEntrySchema = z.discriminatedUnion("kind", [ObservationSchema, EpisodeSchema]);
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const DailySummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  day: z.string(),
  timezone: z.string(),
  summary: z.record(z.string(), z.number()),
  createdAt: z.string().datetime()
}).merge(ProvenanceFieldsSchema);
export type DailySummary = z.infer<typeof DailySummarySchema>;

export const ScoreSchema = z.object({
  id: z.string(),
  userId: z.string(),
  scoreKind: ScoreKindSchema,
  value: z.number(),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  freshnessHours: z.number().nonnegative(),
  formulaVersion: z.string(),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  evidenceSet: z.array(z.string()),
  contributionBreakdown: z.record(z.string(), z.number()),
  missingSignals: z.array(z.string()),
  uncertaintyNote: z.string()
}).merge(ProvenanceFieldsSchema);
export type Score = z.infer<typeof ScoreSchema>;

export const InsightSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  summary: z.string(),
  scoreIds: z.array(z.string()),
  createdAt: z.string().datetime()
}).merge(ProvenanceFieldsSchema);
export type Insight = z.infer<typeof InsightSchema>;

export const RecommendationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workflowKind: WorkflowKindSchema,
  title: z.string(),
  summary: z.string(),
  reversible: z.boolean(),
  evidenceSet: z.array(z.string()),
  uncertaintyNote: z.string(),
  preferenceFilter: z.array(z.string()),
  createdAt: z.string().datetime()
}).merge(ProvenanceFieldsSchema);
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const AlertSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workflowKind: WorkflowKindSchema,
  title: z.string(),
  summary: z.string(),
  severity: z.enum(["info", "medium", "high"]),
  status: z.enum(["open", "acked"]),
  evidenceSet: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  uncertaintyNote: z.string(),
  policyDecision: z.object({
    action: z.enum(["deliver", "suppress", "needs-approval"]),
    reason: z.string()
  }),
  deliveryTargets: z.array(z.string()),
  createdAt: z.string().datetime()
}).merge(ProvenanceFieldsSchema);
export type Alert = z.infer<typeof AlertSchema>;

export const AutomationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workflowKind: WorkflowKindSchema,
  schedule: z.string(),
  status: z.enum(["active", "paused"]),
  quietHours: z.object({
    start: z.string(),
    end: z.string()
  }),
  target: z.string(),
  createdAt: z.string().datetime()
});
export type Automation = z.infer<typeof AutomationSchema>;

export const AutomationRunSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  userId: z.string(),
  workflowKind: WorkflowKindSchema,
  status: z.enum(["succeeded", "suppressed", "failed"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  output: z.record(z.string(), z.unknown())
});
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

export const FeedbackSchema = z.object({
  id: z.string(),
  userId: z.string(),
  recommendationId: z.string(),
  reaction: z.enum(["accepted", "dismissed", "snoozed"]),
  notes: z.string().nullable(),
  createdAt: z.string().datetime()
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const AgentAccessPolicySchema = z.object({
  id: z.string(),
  userId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  scopes: z.array(AgentScopeSchema.or(z.string())),
  mode: z.enum(["derived-only", "full"]),
  createdAt: z.string().datetime()
});
export type AgentAccessPolicy = z.infer<typeof AgentAccessPolicySchema>;

export const AgentTokenSchema = z.object({
  id: z.string(),
  userId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  tokenHash: z.string(),
  tokenPreview: z.string(),
  scopes: z.array(AgentScopeSchema.or(z.string())),
  mode: z.enum(["derived-only", "full"]),
  status: z.enum(["active", "revoked"]),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().default(null)
});
export type AgentToken = z.infer<typeof AgentTokenSchema>;

export const AuditLogSchema = z.object({
  id: z.string(),
  actorType: z.enum(["user", "agent", "system"]),
  actorId: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  scope: z.string(),
  createdAt: z.string().datetime(),
  details: z.record(z.string(), z.unknown())
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const CloudEventSchema = z.object({
  specversion: z.literal("1.0"),
  id: z.string(),
  source: z.literal("openvitals"),
  type: EventTypeSchema,
  subject: z.string(),
  time: z.string().datetime(),
  datacontenttype: z.literal("application/json"),
  data: z.record(z.string(), z.unknown())
});
export type CloudEvent = z.infer<typeof CloudEventSchema>;

export const OutboxEventSchema = CloudEventSchema.extend({
  eventId: z.string(),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  apiTrack: ApiTrackSchema.default("stable")
});
export type OutboxEvent = z.infer<typeof OutboxEventSchema>;

export const WebhookDeliverySchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  eventId: z.string(),
  eventType: EventTypeSchema,
  attempt: z.number().int().positive(),
  status: z.enum(["succeeded", "retrying", "failed"]),
  httpStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  nextRetryAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime()
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

export const WebhookEndpointSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  url: z.string().url(),
  secret: z.string(),
  status: z.enum(["active", "paused"]),
  eventTypes: z.array(EventTypeSchema),
  createdAt: z.string().datetime()
});
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

export const ConnectorSessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  sessionToken: z.string(),
  status: z.enum(["active", "expired", "exchanged"]),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});
export type ConnectorSession = z.infer<typeof ConnectorSessionSchema>;

export const SyncAnchorSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  anchor: z.string().nullable(),
  checkpointedAt: z.string().datetime(),
  lastError: z.string().nullable()
});
export type SyncAnchor = z.infer<typeof SyncAnchorSchema>;

export const ProviderCredentialSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  authState: AuthStateSchema.default("not_connected"),
  connectionMethod: ConnectionMethodSchema,
  accessToken: z.string(),
  refreshToken: z.string().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
  scopes: z.array(z.string()).default([]),
  externalUserId: z.string().nullable().default(null),
  lastRefreshAt: z.string().datetime().nullable().default(null),
  lastRefreshError: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ProviderCredential = z.infer<typeof ProviderCredentialSchema>;

export const ProviderCredentialPublicSchema = z.object({
  providerId: ProviderIdSchema,
  authState: AuthStateSchema.default("not_connected"),
  connectionMethod: ConnectionMethodSchema,
  expiresAt: z.string().datetime().nullable().default(null),
  scopes: z.array(z.string()).default([]),
  externalUserId: z.string().nullable().default(null),
  lastRefreshAt: z.string().datetime().nullable().default(null),
  lastRefreshError: z.string().nullable().default(null),
  updatedAt: z.string().datetime(),
  accessTokenPreview: z.string(),
  refreshTokenPreview: z.string().nullable().default(null)
});
export type ProviderCredentialPublic = z.infer<typeof ProviderCredentialPublicSchema>;

export const SourceFilterSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  ignoredSources: z.array(z.string()),
  updatedAt: z.string().datetime()
});
export type SourceFilter = z.infer<typeof SourceFilterSchema>;

export const SourcePrecedenceOverrideSchema = z.object({
  id: z.string(),
  userId: z.string(),
  precedence: CaptureModePrecedenceSchema,
  updatedAt: z.string().datetime()
});
export type SourcePrecedenceOverride = z.infer<typeof SourcePrecedenceOverrideSchema>;

export const IngestRecordSchema = z.object({
  id: z.string(),
  sourceRecordId: z.string(),
  metricFamily: MetricFamilySchema,
  kind: z.enum(["observation", "episode"]),
  metric: z.string(),
  dataGranularity: DataGranularitySchema.optional(),
  latencyClass: LatencyClassSchema.optional(),
  value: z.number().optional(),
  normalizedValue: z.number().nullable().optional(),
  episodeType: z.enum(["sleep", "workout", "meal", "measurement"]).optional(),
  title: z.string().optional(),
  metrics: z.record(z.string(), z.number()).optional(),
  notes: z.string().nullable().optional(),
  unit: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string(),
  captureMode: z.enum(["direct", "mirrored", "manual", "imported"]),
  sourceApp: z.string(),
  bundleId: z.string().optional(),
  packageName: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.9),
  tags: z.array(z.string()).default([])
}).superRefine((value, ctx) => {
  if (value.captureMode !== "mirrored") {
    return;
  }
  const hasOriginId = Boolean(value.bundleId || value.packageName);
  if (!hasOriginId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bundleId"],
      message: "mirrored ingest records must include bundleId or packageName for provenance tracking."
    });
  }
});
export type IngestRecord = z.infer<typeof IngestRecordSchema>;

export const IngestBatchSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  idempotencyKey: z.string(),
  anchorBefore: z.string().nullable(),
  anchorAfter: z.string().nullable(),
  collectorMeta: z
    .object({
      sdk: z.string().min(1),
      sdkVersion: z.string().min(1),
      appBuild: z.string().min(1),
      deviceModel: z.string().min(1)
    })
    .nullable()
    .default(null),
  recordCount: z.number().int().nonnegative(),
  acceptedRecordCount: z.number().int().nonnegative().default(0),
  droppedRecordCount: z.number().int().nonnegative().default(0),
  dropReasons: z.array(z.object({ reason: z.string(), count: z.number().int().nonnegative() })).default([]),
  status: z.enum(["processed", "duplicate", "failed"]),
  receivedAt: z.string().datetime(),
  processedAt: z.string().datetime(),
  error: z.string().nullable()
});
export type IngestBatch = z.infer<typeof IngestBatchSchema>;

export const IngestFailureSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  reason: z.string(),
  retryable: z.boolean().default(true),
  status: z.enum(["failed", "replayed", "discarded"]).default("failed"),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  replayedAt: z.string().datetime().nullable().default(null)
});
export type IngestFailure = z.infer<typeof IngestFailureSchema>;

export const IngestRecordEnvelopeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  batchId: z.string(),
  idempotencyKey: z.string(),
  record: IngestRecordSchema,
  receivedAt: z.string().datetime()
});
export type IngestRecordEnvelope = z.infer<typeof IngestRecordEnvelopeSchema>;

export const DedupeDecisionCandidateSchema = z.object({
  source: ProviderIdSchema,
  sourceRecordId: z.string(),
  sourceApp: z.string(),
  bundleId: z.string().nullable().optional().default(null),
  packageName: z.string().nullable().optional().default(null),
  captureMode: CaptureModeSchema,
  confidence: z.number().min(0).max(1),
  freshnessHours: z.number().nonnegative()
});
export type DedupeDecisionCandidate = z.infer<typeof DedupeDecisionCandidateSchema>;

export const DedupeDecisionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  providerId: ProviderIdSchema,
  fingerprint: z.string(),
  metricFamily: MetricFamilySchema,
  precedenceVersion: z.string(),
  policyVersion: z.string(),
  policy: z
    .object({
      name: z.string(),
      version: z.string()
    })
    .default({
      name: "capture_mode_precedence",
        version: "legacy"
    }),
  reasonCode: z.enum(["single_candidate", "capture_mode_precedence", "confidence_precedence", "source_filter_ignored"]),
  origin: z.object({
    sourceApp: z.string(),
    bundleId: z.string().nullable().optional().default(null),
    packageName: z.string().nullable().optional().default(null)
  }),
  ignoredBySourceFilter: z.boolean().default(false),
  primary: DedupeDecisionCandidateSchema,
  suppressed: z.array(DedupeDecisionCandidateSchema),
  reason: z.string(),
  decisionTrace: z.array(z.string()),
  decidedAt: z.string().datetime()
});
export type DedupeDecision = z.infer<typeof DedupeDecisionSchema>;

export const ProviderManifestSchema = z.object({
  id: ProviderIdSchema,
  packageName: z.string(),
  displayName: z.string(),
  providerClass: z.enum(["mobile", "cloud"]),
  runtimePath: CollectorRuntimePathSchema,
  phase: z.string(),
  status: z.string(),
  coverage: z.array(z.string()),
  capabilities: z.array(z.string()),
  metricCapabilities: z.array(MetricCapabilitySchema).default([]),
  notes: z.string()
});
export type ProviderManifest = z.infer<typeof ProviderManifestSchema>;

export const CollectorContextSchema = z.object({
  user: UserSchema,
  sourceAccount: SourceAccountSchema,
  lastAnchor: z.string().nullable(),
  mode: z.enum(["history", "incremental"])
});
export type CollectorContext = z.infer<typeof CollectorContextSchema>;

export const NormalizedPayloadSchema = z.object({
  rawEvents: z.array(RawEventSchema),
  observations: z.array(ObservationSchema),
  episodes: z.array(EpisodeSchema),
  devices: z.array(DeviceSchema)
});
export type NormalizedPayload = z.infer<typeof NormalizedPayloadSchema>;

export const CollectorHealthcheckSchema = z.object({
  ok: z.boolean(),
  providerId: ProviderIdSchema,
  message: z.string()
});
export type CollectorHealthcheck = z.infer<typeof CollectorHealthcheckSchema>;

export interface Collector {
  manifest: ProviderManifest;
  connect(user: User): Promise<{ connectUrl: string; sessionId: string }>;
  exchangeSession(sessionId: string): Promise<{ accessToken: string; refreshToken: string }>;
  syncHistory(context: CollectorContext): Promise<NormalizedPayload>;
  syncIncremental(context: CollectorContext): Promise<NormalizedPayload>;
  subscribeUpdates(context: CollectorContext): Promise<{ subscribed: boolean; channel: string }>;
  normalize(rawEvents: RawEvent[]): Promise<NormalizedPayload>;
  resolveProvenance(payload: NormalizedPayload): Promise<NormalizedPayload>;
  healthcheck(): Promise<CollectorHealthcheck>;
}

export const TimelineQuerySchema = z.object({
  userId: z.string(),
  days: z.coerce.number().int().positive().max(90).default(14)
});
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;

export const ScoresQuerySchema = z.object({
  userId: z.string(),
  kind: ScoreKindSchema.optional()
});
export type ScoresQuery = z.infer<typeof ScoresQuerySchema>;

export const AlertsQuerySchema = z.object({
  userId: z.string(),
  status: z.enum(["open", "acked"]).optional()
});
export type AlertsQuery = z.infer<typeof AlertsQuerySchema>;

export const DailySummariesQuerySchema = z.object({
  userId: z.string(),
  days: z.coerce.number().int().positive().max(90).default(14)
});
export type DailySummariesQuery = z.infer<typeof DailySummariesQuerySchema>;

export const SyncRequestSchema = z.object({
  providerId: ProviderIdSchema.optional(),
  mode: z.enum(["history", "incremental"]).default("incremental")
});
export type SyncRequest = z.infer<typeof SyncRequestSchema>;

export const SourceFilterInputSchema = z.object({
  ignoredSources: z.array(z.string()).default([])
});
export type SourceFilterInput = z.infer<typeof SourceFilterInputSchema>;

export const SourcePrecedenceInputSchema = z.object({
  precedence: CaptureModePrecedenceSchema
});
export type SourcePrecedenceInput = z.infer<typeof SourcePrecedenceInputSchema>;

export const ConnectSessionResponseSchema = z.object({
  userId: z.string(),
  providerId: ProviderIdSchema,
  sessionId: z.string().optional(),
  sessionToken: z.string(),
  connectionMethod: ConnectionMethodSchema.default("sdk-ingest"),
  connectionMode: ConnectionModeSchema.default("mobile_permission"),
  expiresAt: z.string().datetime()
});
export type ConnectSessionResponse = z.infer<typeof ConnectSessionResponseSchema>;

export const IngestBatchInputSchema = z.object({
  sessionToken: z.string(),
  idempotencyKey: z.string(),
  anchorBefore: z.string().nullable().optional(),
  anchorAfter: z.string().nullable().optional(),
  collectorMeta: z
    .object({
      sdk: z.string().min(1),
      sdkVersion: z.string().min(1),
      appBuild: z.string().min(1),
      deviceModel: z.string().min(1)
    })
    .optional(),
  records: z.array(IngestRecordSchema).min(1)
});
export type IngestBatchInput = z.infer<typeof IngestBatchInputSchema>;

export const IngestBatchResultSchema = z.object({
  userId: z.string(),
  providerId: ProviderIdSchema,
  batchId: z.string(),
  idempotent: z.boolean(),
  processedRecords: z.number().int().nonnegative(),
  acceptedRecords: z.number().int().nonnegative(),
  droppedRecords: z.number().int().nonnegative(),
  dropReasons: z.array(z.object({ reason: z.string(), count: z.number().int().nonnegative() })).default([]),
  dedupeDecisions: z.number().int().nonnegative(),
  outboxEvents: z.number().int().nonnegative(),
  staleGateApplied: z.boolean(),
  syncFreshnessHours: z.number().nonnegative(),
  anchorAfter: z.string().nullable()
});
export type IngestBatchResult = z.infer<typeof IngestBatchResultSchema>;

export const SyncStatusEntrySchema = z.object({
  providerId: ProviderIdSchema,
  status: z.enum(["connected", "stale", "errored"]),
  authState: AuthStateSchema.default("not_connected"),
  lastSyncAt: z.string().datetime(),
  lastSuccessfulSyncAt: z.string().datetime().nullable().default(null),
  syncFreshnessHours: z.number().nonnegative(),
  stalenessReason: z.string().nullable().default(null),
  lastAnchor: z.string().nullable(),
  lastError: z.string().nullable(),
  pendingIngestBatches: z.number().int().nonnegative().default(0),
  dataQualityGate: DataQualityGateSchema.default("ok"),
  dataMode: DataModeSchema.default("demo"),
  connectionMethod: ConnectionMethodSchema.default("mock"),
  connectionMode: ConnectionModeSchema.default("mock"),
  metricCapabilities: z.array(MetricCapabilitySchema).default([]),
  credentialExpiresAt: z.string().datetime().nullable().default(null),
  lastCredentialError: z.string().nullable().default(null),
  lastIngestBatchId: z.string().nullable().default(null),
  lastIngestAt: z.string().datetime().nullable().default(null),
  lastIngestRecordCount: z.number().int().nonnegative().nullable().default(null),
  lastAcceptedRecordCount: z.number().int().nonnegative().nullable().default(null),
  lastDroppedRecordCount: z.number().int().nonnegative().nullable().default(null),
  lastDropReasons: z.array(z.object({ reason: z.string(), count: z.number().int().nonnegative() })).default([]),
  activeSessionExpiresAt: z.string().datetime().nullable().default(null),
  queueDepth: z.number().int().nonnegative().default(0),
  backoffUntil: z.string().datetime().nullable().default(null)
});
export type SyncStatusEntry = z.infer<typeof SyncStatusEntrySchema>;

export const SyncStatusResponseSchema = z.object({
  userId: z.string(),
  sources: z.array(SyncStatusEntrySchema)
});
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;

export const ProfilesListResponseSchema = z.object({
  profiles: z.array(ProfileSummarySchema)
});
export type ProfilesListResponse = z.infer<typeof ProfilesListResponseSchema>;

export const HouseholdProfileInputSchema = z.object({
  userId: z.string(),
  name: z.string(),
  timezone: z.string()
});
export type HouseholdProfileInput = z.infer<typeof HouseholdProfileInputSchema>;

export const HouseholdBootstrapInputSchema = z.object({
  owner: HouseholdProfileInputSchema,
  family: z.array(HouseholdProfileInputSchema).default([]),
  providers: z.array(ProviderIdSchema).optional(),
  createTokens: z.boolean().default(true)
});
export type HouseholdBootstrapInput = z.infer<typeof HouseholdBootstrapInputSchema>;

export const HouseholdBootstrapProfileResultSchema = z.object({
  userId: z.string(),
  providers: z.array(ProviderIdSchema),
  sourceAccounts: z.number().int().nonnegative(),
  tokens: z.array(
    z.object({
      label: z.enum(["derived", "full"]),
      token: z.string()
    })
  )
});
export type HouseholdBootstrapProfileResult = z.infer<typeof HouseholdBootstrapProfileResultSchema>;

export const HouseholdBootstrapResultSchema = z.object({
  runtimeMode: RuntimeModeSchema,
  profiles: z.array(HouseholdBootstrapProfileResultSchema)
});
export type HouseholdBootstrapResult = z.infer<typeof HouseholdBootstrapResultSchema>;

export const ConnectStartResponseSchema = z.object({
  userId: z.string(),
  providerId: ProviderIdSchema,
  providerClass: z.enum(["mobile", "cloud"]),
  connectUrl: z.string(),
  sessionId: z.string(),
  connectionMethod: ConnectionMethodSchema,
  state: z.string().nullable().default(null),
  callbackUrl: z.string().nullable().default(null),
  sessionToken: z.string().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null)
});
export type ConnectStartResponse = z.infer<typeof ConnectStartResponseSchema>;

export const ConnectCallbackInputSchema = z.object({
  sessionId: z.string(),
  state: z.string().optional(),
  code: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  externalUserId: z.string().nullable().optional(),
  scopes: z.array(z.string()).optional()
});
export type ConnectCallbackInput = z.infer<typeof ConnectCallbackInputSchema>;

export const ConnectCallbackResponseSchema = z.object({
  userId: z.string(),
  providerId: ProviderIdSchema,
  connected: z.boolean(),
  accessTokenPreview: z.string(),
  refreshTokenPreview: z.string().nullable().default(null),
  credential: ProviderCredentialPublicSchema
});
export type ConnectCallbackResponse = z.infer<typeof ConnectCallbackResponseSchema>;

export const ExplainEntitySchema = z.enum([
  "observation",
  "episode",
  "daily_summary",
  "score",
  "alert",
  "automation_run"
]);
export type ExplainEntity = z.infer<typeof ExplainEntitySchema>;

export const ExplainResponseSchema = z.object({
  entity: ExplainEntitySchema,
  id: z.string(),
  whyPrimary: z.string(),
  suppressedSources: z.array(ProviderIdSchema),
  dataGranularity: DataGranularitySchema.default("sample"),
  latencyClass: LatencyClassSchema.default("delayed_sync"),
  freshnessHours: z.number().nonnegative().default(0),
  confidence: z.number().min(0).max(1).default(0),
  lastSyncAt: z.string().datetime().nullable(),
  lastSuccessfulSyncAt: z.string().datetime().nullable(),
  provenanceChain: z.array(ProvenanceNodeSchema),
  dedupeFingerprint: z.string().nullable(),
  precedenceVersion: z.string(),
  dedupePolicy: z
    .object({
      name: z.string(),
      version: z.string()
    })
    .nullable(),
  ignoredBySourceFilter: z.boolean(),
  decisionTrace: z.array(z.string()),
  suppressionReasons: z.array(z.string()),
  suppressedRecords: z.array(
    z.object({
      source: ProviderIdSchema,
      sourceRecordId: z.string(),
      sourceApp: z.string(),
      bundleId: z.string().nullable().optional().default(null),
      packageName: z.string().nullable().optional().default(null),
      captureMode: CaptureModeSchema,
      reason: z.string()
    })
  ),
  evidence: z.array(z.string()),
  payload: z.record(z.string(), z.unknown())
});
export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;

export const ConnectorAccountSchema = SourceAccountSchema.extend({
  authState: AuthStateSchema.default("not_connected"),
  dataMode: DataModeSchema.default("demo"),
  runtimePath: CollectorRuntimePathSchema.default("mock"),
  connectionMethod: ConnectionMethodSchema.default("mock"),
  connectionMode: ConnectionModeSchema.default("mock"),
  credentialUpdatedAt: z.string().datetime().nullable().default(null),
  credentialExpiresAt: z.string().datetime().nullable().default(null),
  lastCredentialError: z.string().nullable().default(null)
});
export type ConnectorAccount = z.infer<typeof ConnectorAccountSchema>;

export const ConnectorsResponseSchema = z.object({
  runtimeMode: RuntimeModeSchema.default("demo"),
  collectorType: CollectorRuntimePathSchema.default("mock"),
  user: UserSchema,
  sourceAccounts: z.array(ConnectorAccountSchema),
  devices: z.array(DeviceSchema),
  policies: z.array(AgentAccessPolicySchema),
  sourceFilters: z.array(SourceFilterSchema).default([]),
  sourcePrecedenceOverrides: z.array(SourcePrecedenceOverrideSchema).default([])
});
export type ConnectorsResponse = z.infer<typeof ConnectorsResponseSchema>;

export const DemoStateSchema = z.object({
  user: UserSchema,
  sourceAccounts: z.array(SourceAccountSchema),
  devices: z.array(DeviceSchema),
  consentGrants: z.array(ConsentGrantSchema),
  rawEvents: z.array(RawEventSchema),
  observations: z.array(ObservationSchema),
  episodes: z.array(EpisodeSchema),
  dailySummaries: z.array(DailySummarySchema),
  scores: z.array(ScoreSchema),
  insights: z.array(InsightSchema),
  recommendations: z.array(RecommendationSchema),
  alerts: z.array(AlertSchema),
  automations: z.array(AutomationSchema),
  automationRuns: z.array(AutomationRunSchema),
  feedback: z.array(FeedbackSchema),
  policies: z.array(AgentAccessPolicySchema),
  auditLogs: z.array(AuditLogSchema),
  outbox: z.array(CloudEventSchema),
  connectorSessions: z.array(ConnectorSessionSchema).default([]),
  syncAnchors: z.array(SyncAnchorSchema).default([]),
  sourceFilters: z.array(SourceFilterSchema).default([]),
  sourcePrecedenceOverrides: z.array(SourcePrecedenceOverrideSchema).default([]),
  ingestBatches: z.array(IngestBatchSchema).default([]),
  ingestFailures: z.array(IngestFailureSchema).default([]),
  ingestRecords: z.array(IngestRecordEnvelopeSchema).default([]),
  dedupeDecisions: z.array(DedupeDecisionSchema).default([]),
  agentTokens: z.array(AgentTokenSchema).default([])
});
export type DemoState = z.infer<typeof DemoStateSchema>;

export const McpToolDefinitionSchema = z.object({
  name: McpToolNameSchema,
  title: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown())
});
export type McpToolDefinition = z.infer<typeof McpToolDefinitionSchema>;

export const RoadmapEntrySchema = z.object({
  packageName: z.string(),
  title: z.string(),
  phase: z.string(),
  status: z.string()
});
export type RoadmapEntry = z.infer<typeof RoadmapEntrySchema>;
