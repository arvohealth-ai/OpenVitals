import type {
  DemoState,
  Device,
  IngestRecord,
  IngestRecordEnvelope,
  ProviderId,
  ProvenanceFields,
  RawEvent,
  Recommendation,
  SourceAccount,
  User,
  Episode,
  Observation
} from "@openvitals/contracts";
import {
  DemoStateSchema,
  DeviceSchema,
  EpisodeSchema,
  IngestRecordEnvelopeSchema,
  IngestRecordSchema,
  ObservationSchema,
  RawEventSchema,
  SourceAccountSchema
} from "@openvitals/contracts";

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

export type IngestPipelineDeps = {
  calculateFreshnessHours: (lastSyncAt: string, now: Date) => number;
  iso: (date: Date) => string;
  round: (value: number) => number;
  createId: (...parts: string[]) => string;
  canonicalSourceKey: (sourceRecordId: string) => string;
  deviceModelForProvider: (providerId: ProviderId) => string;
  buildProvenance: BuildProvenance;
};

export const refreshSourceAccounts = (
  sourceAccounts: SourceAccount[],
  now: Date,
  syncedProviderIds: ProviderId[] = [],
  deps: IngestPipelineDeps
): SourceAccount[] =>
  sourceAccounts.map((sourceAccount) => {
    const nextLastSyncAt = syncedProviderIds.includes(sourceAccount.providerId) ? deps.iso(now) : sourceAccount.lastSyncAt;
    const freshnessHours = deps.calculateFreshnessHours(nextLastSyncAt, now);
    const nextStatus = sourceAccount.status === "errored" ? "errored" : freshnessHours >= 24 ? "stale" : "connected";
    return SourceAccountSchema.parse({
      ...sourceAccount,
      status: nextStatus,
      lastSyncAt: nextLastSyncAt,
      syncFreshnessHours: freshnessHours
    });
  });

export const applyRecommendationGate = (
  sourceAccounts: SourceAccount[],
  recommendations: Recommendation[]
): { recommendations: Recommendation[]; staleGateApplied: boolean } => {
  const staleGateApplied = sourceAccounts.some((sourceAccount) => sourceAccount.syncFreshnessHours >= 24);
  return {
    recommendations: staleGateApplied ? [] : recommendations,
    staleGateApplied
  };
};

export const findSourceAccount = (state: DemoState, userId: string, providerId: ProviderId): SourceAccount => {
  const account = state.sourceAccounts.find((sourceAccount) => sourceAccount.userId === userId && sourceAccount.providerId === providerId);
  if (!account) {
    throw new Error(`Source account for ${providerId} is not connected for user ${userId}.`);
  }
  return account;
};

export const findOrCreateDevice = (
  state: DemoState,
  sourceAccount: SourceAccount,
  now: Date,
  deps: IngestPipelineDeps
): Device => {
  const existing = state.devices.find((device) => device.sourceAccountId === sourceAccount.id);
  if (existing) {
    return existing;
  }
  return DeviceSchema.parse({
    id: `device_${sourceAccount.providerId}`,
    userId: sourceAccount.userId,
    sourceAccountId: sourceAccount.id,
    providerId: sourceAccount.providerId,
    name: deps.deviceModelForProvider(sourceAccount.providerId),
    model: deps.deviceModelForProvider(sourceAccount.providerId),
    platform: sourceAccount.platform === "mobile" ? "on-device" : "cloud",
    lastSeenAt: deps.iso(now)
  });
};

const buildIngestProvenance = (
  input: {
    user: User;
    providerId: ProviderId;
    record: IngestRecord;
    freshnessHours: number;
    dedupeGroupId: string;
    confidence: number;
  },
  deps: IngestPipelineDeps
): ProvenanceFields => {
  const provenance = deps.buildProvenance(
    input.providerId,
    input.record.sourceRecordId,
    input.record.timezone || input.user.timezone,
    input.record.metric,
    input.record.unit,
    input.freshnessHours,
    input.confidence,
    input.dedupeGroupId,
    input.record.captureMode,
    [],
    `${input.providerId} ingested ${input.record.metric} from ${input.record.sourceApp}.`,
    {
      bundleId: input.record.bundleId ?? null,
      packageName: input.record.packageName ?? null
    }
  );
  return {
    ...provenance,
    sourceApp: input.record.sourceApp,
    dataGranularity: input.record.dataGranularity ?? provenance.dataGranularity,
    latencyClass: input.record.latencyClass ?? provenance.latencyClass
  };
};

export type IngestProjection = {
  rawEvents: RawEvent[];
  observations: Observation[];
  episodes: Episode[];
  envelopes: IngestRecordEnvelope[];
};

export const projectIngestRecords = (
  input: {
    user: User;
    providerId: ProviderId;
    sourceAccount: SourceAccount;
    device: Device;
    records: IngestRecord[];
    idempotencyKey: string;
    batchId: string;
    now: Date;
  },
  deps: IngestPipelineDeps
): IngestProjection => {
  const rawEvents: RawEvent[] = [];
  const observations: Observation[] = [];
  const episodes: Episode[] = [];
  const envelopes: IngestRecordEnvelope[] = [];

  for (const record of input.records) {
    const parsedRecord = IngestRecordSchema.parse(record);
    const freshnessHours = deps.round(Math.max((input.now.getTime() - new Date(parsedRecord.endAt).getTime()) / (60 * 60 * 1000), 0));
    const groupMetric = parsedRecord.kind === "episode" ? parsedRecord.episodeType ?? parsedRecord.metric : parsedRecord.metric;
    const dedupeGroupId = deps.createId(
      "dedupe",
      input.user.id,
      parsedRecord.metricFamily,
      groupMetric,
      parsedRecord.startAt,
      parsedRecord.endAt,
      deps.canonicalSourceKey(parsedRecord.sourceRecordId),
      parsedRecord.sourceApp
    );
    const provenance = buildIngestProvenance(
      {
        user: input.user,
        providerId: input.providerId,
        record: parsedRecord,
        freshnessHours,
        dedupeGroupId,
        confidence: parsedRecord.confidence
      },
      deps
    );

    envelopes.push(
      IngestRecordEnvelopeSchema.parse({
        id: deps.createId("ingest_record", input.providerId, input.batchId, parsedRecord.id),
        userId: input.user.id,
        providerId: input.providerId,
        batchId: input.batchId,
        idempotencyKey: input.idempotencyKey,
        record: parsedRecord,
        receivedAt: deps.iso(input.now)
      })
    );

    rawEvents.push(
      RawEventSchema.parse({
        id: deps.createId("raw", input.providerId, parsedRecord.id, input.batchId),
        userId: input.user.id,
        sourceAccountId: input.sourceAccount.id,
        providerId: input.providerId,
        eventType: parsedRecord.kind === "episode" ? parsedRecord.episodeType ?? parsedRecord.metric : parsedRecord.metric,
        sourceRecordId: parsedRecord.sourceRecordId,
        capturedAt: deps.iso(input.now),
        payload: {
          ...parsedRecord,
          providerId: input.providerId
        }
      })
    );

    if (parsedRecord.kind === "observation") {
      observations.push(
        ObservationSchema.parse({
          id: deps.createId("obs", input.providerId, parsedRecord.id),
          kind: "observation",
          userId: input.user.id,
          sourceAccountId: input.sourceAccount.id,
          deviceId: input.device.id,
          metricFamily: parsedRecord.metricFamily,
          metric: parsedRecord.metric,
          value: deps.round(parsedRecord.value ?? 0),
          normalizedValue: parsedRecord.normalizedValue ?? parsedRecord.value ?? null,
          startAt: parsedRecord.startAt,
          endAt: parsedRecord.endAt,
          createdAt: deps.iso(input.now),
          tags: parsedRecord.tags,
          ...provenance
        })
      );
      continue;
    }

    episodes.push(
      EpisodeSchema.parse({
        id: deps.createId("episode", input.providerId, parsedRecord.id),
        kind: "episode",
        userId: input.user.id,
        sourceAccountId: input.sourceAccount.id,
        deviceId: input.device.id,
        metricFamily: parsedRecord.episodeType === "sleep" ? "sleep" : parsedRecord.metricFamily,
        episodeType: parsedRecord.episodeType ?? "measurement",
        title: parsedRecord.title ?? `${input.providerId} ${parsedRecord.episodeType ?? parsedRecord.metric}`,
        metrics: parsedRecord.metrics ?? {},
        notes: parsedRecord.notes ?? null,
        startAt: parsedRecord.startAt,
        endAt: parsedRecord.endAt,
        createdAt: deps.iso(input.now),
        ...provenance
      })
    );
  }

  return IngestProjectionSchema.parse({ rawEvents, observations, episodes, envelopes });
};

const IngestProjectionSchema = DemoStateSchema.pick({ rawEvents: true, observations: true, episodes: true, ingestRecords: true }).transform((value) => ({
  rawEvents: value.rawEvents,
  observations: value.observations,
  episodes: value.episodes,
  envelopes: value.ingestRecords
}));
