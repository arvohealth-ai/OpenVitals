import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import type {
  AgentToken,
  Alert,
  ApiTrack,
  CloudEvent,
  DemoState,
  IngestFailure,
  ProviderCredential,
  OutboxEvent,
  WebhookDelivery,
  WebhookEndpoint
} from "@openvitals/contracts";
import {
  AgentTokenSchema,
  AlertSchema,
  CloudEventSchema,
  DemoStateSchema,
  IngestFailureSchema,
  ProviderCredentialSchema,
  OutboxEventSchema,
  WebhookDeliverySchema,
  WebhookEndpointSchema
} from "@openvitals/contracts";

import {
  agentTokensTable,
  alertsTable,
  auditLogsTable,
  automationRunsTable,
  automationsTable,
  connectorSessionsIndexTable,
  connectorSessionsTable,
  consentGrantsTable,
  dailySummariesTable,
  dedupeDecisionsTable,
  devicesTable,
  emissionRecordsTable,
  episodesTable,
  feedbackTable,
  goalsTable,
  ingestBatchesTable,
  ingestFailuresTable,
  ingestRecordsTable,
  insightsTable,
  observationsTable,
  outboxEventsTable,
  outboxTable,
  policiesTable,
  providerCredentialsTable,
  rawEventsTable,
  recommendationsTable,
  scoresTable,
  sourceAccountsIndexTable,
  sourceAccountsTable,
  sourceFiltersTable,
  sourcePrecedenceOverridesTable,
  schedulerRunsTable,
  schedulerStateTable,
  syncAnchorsIndexTable,
  syncAnchorsTable,
  usersIndexTable,
  usersTable,
  webhookDeliveriesTable,
  webhookTable
} from "./schema.js";

const coreTables = [
  usersTable,
  sourceAccountsTable,
  devicesTable,
  consentGrantsTable,
  rawEventsTable,
  observationsTable,
  episodesTable,
  dailySummariesTable,
  scoresTable,
  insightsTable,
  recommendationsTable,
  alertsTable,
  automationsTable,
  automationRunsTable,
  feedbackTable,
  policiesTable,
  auditLogsTable,
  outboxTable,
  connectorSessionsTable,
  syncAnchorsTable,
  sourceFiltersTable,
  sourcePrecedenceOverridesTable,
  ingestBatchesTable,
  ingestRecordsTable,
  dedupeDecisionsTable,
  agentTokensTable,
  ingestFailuresTable
] as const;

const createTablesSql = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_accounts (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS consent_grants (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw_events (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_summaries (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scores (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS insights (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recommendations (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automations (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS policies (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connector_sessions (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_anchors (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_filters (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_precedence_overrides (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ingest_batches (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ingest_records (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dedupe_decisions (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_tokens (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ingest_failures (id TEXT PRIMARY KEY, user_id TEXT, created_at TEXT NOT NULL, payload TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users_index (id TEXT PRIMARY KEY, name TEXT NOT NULL, timezone TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_accounts_index (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  last_sync_at TEXT NOT NULL,
  sync_freshness_hours INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connector_sessions_index (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_anchors_index (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  anchor TEXT,
  checkpointed_at TEXT NOT NULL,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  error TEXT,
  next_retry_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS emission_records (
  run_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workflow_kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  emitted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduler_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduler_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
`;

const createTableStatements = createTablesSql
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const toRowId = (id: string, userId?: string | null) => (userId ? `${userId}::${id}` : id);

const serialize = (
  payload: { id: string; userId?: string; createdAt?: string },
  fallbackUserId?: string
) => {
  const resolvedUserId = payload.userId ?? fallbackUserId ?? null;
  return {
    id: toRowId(payload.id, resolvedUserId),
    userId: resolvedUserId,
    createdAt: payload.createdAt ?? new Date().toISOString(),
    payload: JSON.stringify(payload)
  };
};

const toDbUrl = (dbPath: string): string => {
  if (dbPath === ":memory:") {
    return ":memory:";
  }

  return dbPath.startsWith("file:") ? dbPath : `file:${dbPath}`;
};

const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");
const PROVIDER_CREDENTIAL_CIPHER_VERSION = "v1";

const providerCredentialKey = (): Buffer =>
  crypto.createHash("sha256").update(process.env.OPENVITALS_SECRETS_KEY ?? "openvitals-dev-secrets-key").digest();

const encryptSecret = (value: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", providerCredentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PROVIDER_CREDENTIAL_CIPHER_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
};

const decryptSecret = (value: string): string => {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = value.split(":");
  if (
    version !== PROVIDER_CREDENTIAL_CIPHER_VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !ciphertextEncoded
  ) {
    throw new Error("Unsupported provider credential cipher payload.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    providerCredentialKey(),
    Buffer.from(ivEncoded, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
};

type ReplaceStateOptions = {
  resetEventStream?: boolean;
};

export type EmissionRecord = {
  runKey: string;
  userId: string;
  workflowKind: string;
  payloadHash: string;
  emittedAt: string;
  payload: Record<string, unknown>;
};

export type SchedulerStateRecord = {
  id: string;
  userId: string;
  enabled: boolean;
  leader: boolean;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastError: string | null;
  lastRunSummary: Record<string, unknown> | null;
  lastDailyKey: string | null;
  lastWeeklyKey: string | null;
  staleActive: boolean;
  lastStaleHash: string | null;
  updatedAt: string;
};

export type SchedulerRunRecord = {
  id: string;
  userId: string | null;
  job: string;
  status: "succeeded" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  emittedEvents: number;
  error: string | null;
  summary: Record<string, unknown> | null;
};

export const createStore = async (dbPath: string) => {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const client = createClient({ url: toDbUrl(dbPath) });
  const db = drizzle(client);
  for (const statement of createTableStatements) {
    await client.execute(statement);
  }

  const insertRows = async (
    table: typeof usersTable,
    rows: Array<{ id: string; userId?: string; createdAt?: string }>,
    fallbackUserId?: string
  ) => {
    if (rows.length === 0) {
      return;
    }
    await db.insert(table).values(rows.map((row) => serialize(row, fallbackUserId)));
  };

  const syncStructuredControlPlane = async (state: DemoState) => {
    await db.delete(usersIndexTable).where(eq(usersIndexTable.id, state.user.id));
    await db.insert(usersIndexTable).values([
      {
        id: state.user.id,
        name: state.user.name,
        timezone: state.user.timezone,
        createdAt: state.user.createdAt
      }
    ]);

    await db.delete(sourceAccountsIndexTable).where(eq(sourceAccountsIndexTable.userId, state.user.id));
    if (state.sourceAccounts.length > 0) {
      await db.insert(sourceAccountsIndexTable).values(
        state.sourceAccounts.map((row) => ({
          id: toRowId(row.id, row.userId),
          userId: row.userId,
          providerId: row.providerId,
          platform: row.platform,
          status: row.status,
          lastSyncAt: row.lastSyncAt,
          syncFreshnessHours: Math.round(row.syncFreshnessHours)
        }))
      );
    }

    await db.delete(connectorSessionsIndexTable).where(eq(connectorSessionsIndexTable.userId, state.user.id));
    if (state.connectorSessions.length > 0) {
      await db.insert(connectorSessionsIndexTable).values(
        state.connectorSessions.map((row) => ({
          id: toRowId(row.id, row.userId),
          userId: row.userId,
          providerId: row.providerId,
          status: row.status,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt
        }))
      );
    }

    await db.delete(syncAnchorsIndexTable).where(eq(syncAnchorsIndexTable.userId, state.user.id));
    if (state.syncAnchors.length > 0) {
      await db.insert(syncAnchorsIndexTable).values(
        state.syncAnchors.map((row) => ({
          id: toRowId(row.id, row.userId),
          userId: row.userId,
          providerId: row.providerId,
          anchor: row.anchor,
          checkpointedAt: row.checkpointedAt,
          lastError: row.lastError
        }))
      );
    }
  };

  const replaceState = async (state: DemoState, options: ReplaceStateOptions = {}) => {
    for (const table of coreTables) {
      await db.delete(table).where(eq(table.userId, state.user.id));
    }

    await insertRows(usersTable, [{ ...state.user, userId: state.user.id }], state.user.id);
    await insertRows(sourceAccountsTable, state.sourceAccounts, state.user.id);
    await insertRows(devicesTable, state.devices, state.user.id);
    await insertRows(consentGrantsTable, state.consentGrants, state.user.id);
    await insertRows(rawEventsTable, state.rawEvents, state.user.id);
    await insertRows(observationsTable, state.observations, state.user.id);
    await insertRows(episodesTable, state.episodes, state.user.id);
    await insertRows(dailySummariesTable, state.dailySummaries, state.user.id);
    await insertRows(scoresTable, state.scores, state.user.id);
    await insertRows(insightsTable, state.insights, state.user.id);
    await insertRows(recommendationsTable, state.recommendations, state.user.id);
    await insertRows(alertsTable, state.alerts, state.user.id);
    await insertRows(automationsTable, state.automations, state.user.id);
    await insertRows(automationRunsTable, state.automationRuns, state.user.id);
    await insertRows(feedbackTable, state.feedback, state.user.id);
    await insertRows(policiesTable, state.policies, state.user.id);
    await insertRows(auditLogsTable, state.auditLogs, state.user.id);
    await insertRows(outboxTable, state.outbox, state.user.id);
    await insertRows(connectorSessionsTable, state.connectorSessions, state.user.id);
    await insertRows(syncAnchorsTable, state.syncAnchors, state.user.id);
    await insertRows(sourceFiltersTable, state.sourceFilters, state.user.id);
    await insertRows(sourcePrecedenceOverridesTable, state.sourcePrecedenceOverrides, state.user.id);
    await insertRows(ingestBatchesTable, state.ingestBatches, state.user.id);
    await insertRows(ingestFailuresTable, state.ingestFailures, state.user.id);
    await insertRows(ingestRecordsTable, state.ingestRecords, state.user.id);
    await insertRows(dedupeDecisionsTable, state.dedupeDecisions, state.user.id);
    await insertRows(agentTokensTable, state.agentTokens, state.user.id);
    await syncStructuredControlPlane(state);

    if (options.resetEventStream) {
      await db.delete(outboxEventsTable);
      await db.delete(webhookDeliveriesTable);
    }
  };

  const loadRows = async <T>(table: typeof usersTable, parse: (value: unknown) => T, userId?: string): Promise<T[]> => {
    const rows = userId ? await db.select().from(table).where(eq(table.userId, userId)) : await db.select().from(table);
    return rows.map((row) => parse(JSON.parse(row.payload)));
  };

  const loadStateOrNull = async (userId?: string): Promise<DemoState | null> => {
    const users = await loadRows(usersTable, (value) => value, userId);
    const user = users[0];
    if (!user) {
      return null;
    }
    const userKey = String((user as { id: string }).id);
    return DemoStateSchema.parse({
      user,
      sourceAccounts: await loadRows(sourceAccountsTable, (value) => value, userKey),
      devices: await loadRows(devicesTable, (value) => value, userKey),
      consentGrants: await loadRows(consentGrantsTable, (value) => value, userKey),
      rawEvents: await loadRows(rawEventsTable, (value) => value, userKey),
      observations: await loadRows(observationsTable, (value) => value, userKey),
      episodes: await loadRows(episodesTable, (value) => value, userKey),
      dailySummaries: await loadRows(dailySummariesTable, (value) => value, userKey),
      scores: await loadRows(scoresTable, (value) => value, userKey),
      insights: await loadRows(insightsTable, (value) => value, userKey),
      recommendations: await loadRows(recommendationsTable, (value) => value, userKey),
      alerts: await loadRows(alertsTable, (value) => value, userKey),
      automations: await loadRows(automationsTable, (value) => value, userKey),
      automationRuns: await loadRows(automationRunsTable, (value) => value, userKey),
      feedback: await loadRows(feedbackTable, (value) => value, userKey),
      policies: await loadRows(policiesTable, (value) => value, userKey),
      auditLogs: await loadRows(auditLogsTable, (value) => value, userKey),
      outbox: await loadRows(outboxTable, (value) => CloudEventSchema.parse(value), userKey),
      connectorSessions: await loadRows(connectorSessionsTable, (value) => value, userKey),
      syncAnchors: await loadRows(syncAnchorsTable, (value) => value, userKey),
      sourceFilters: await loadRows(sourceFiltersTable, (value) => value, userKey),
      sourcePrecedenceOverrides: await loadRows(sourcePrecedenceOverridesTable, (value) => value, userKey),
      ingestBatches: await loadRows(ingestBatchesTable, (value) => value, userKey),
      ingestFailures: await loadRows(ingestFailuresTable, (value) => IngestFailureSchema.parse(value), userKey),
      ingestRecords: await loadRows(ingestRecordsTable, (value) => value, userKey),
      dedupeDecisions: await loadRows(dedupeDecisionsTable, (value) => value, userKey),
      agentTokens: await loadRows(agentTokensTable, (value) => AgentTokenSchema.parse(value), userKey)
    });
  };

  const loadState = async (userId?: string): Promise<DemoState> => {
    const state = await loadStateOrNull(userId);
    if (!state) {
      throw new Error(userId ? `No runtime state is currently loaded for ${userId}.` : "No runtime state is currently loaded.");
    }
    return state;
  };

  const listUsers = async (): Promise<Array<{ id: string; name: string; timezone: string; createdAt: string; lastSyncAt: string | null }>> => {
    const rows = await db.select().from(usersIndexTable);
    const allSourceRows = await db.select().from(sourceAccountsIndexTable);
    return rows.sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1)).map((row) => {
      const latestSync = allSourceRows
        .filter((sourceRow) => sourceRow.userId === row.id)
        .sort((left, right) => (left.lastSyncAt < right.lastSyncAt ? 1 : -1))[0];
      return {
        id: row.id,
        name: row.name,
        timezone: row.timezone,
        createdAt: row.createdAt,
        lastSyncAt: latestSync?.lastSyncAt ?? null
      };
    });
  };

  const listWebhooks = async (): Promise<WebhookEndpoint[]> => loadRows(webhookTable, (value) => WebhookEndpointSchema.parse(value));

  const saveWebhook = async (webhook: WebhookEndpoint) => {
    await db.delete(webhookTable).where(eq(webhookTable.id, toRowId(webhook.id, webhook.userId)));
    await db.insert(webhookTable).values([serialize(webhook, webhook.userId)]);
    return webhook;
  };

  const deleteWebhook = async (id: string) => {
    const rows = await db.select().from(webhookTable);
    const target = rows.find((row) => {
      const payload = JSON.parse(row.payload) as { id?: string };
      return payload.id === id;
    });
    if (!target) {
      return;
    }
    await db.delete(webhookTable).where(eq(webhookTable.id, target.id));
  };

  const findAlertById = async (alertId: string): Promise<Alert | null> => {
    const rows = await db.select().from(alertsTable);
    const row = rows.find((candidate) => {
      const payload = JSON.parse(candidate.payload) as { id?: string };
      return payload.id === alertId;
    });
    if (!row) {
      return null;
    }
    return AlertSchema.parse(JSON.parse(row.payload));
  };

  const ackAlert = async (alertId: string): Promise<Alert | null> => {
    const alert = await findAlertById(alertId);
    if (!alert) {
      return null;
    }
    const nextAlert = AlertSchema.parse({
      ...alert,
      status: "acked"
    });
    await db.delete(alertsTable).where(eq(alertsTable.id, toRowId(alertId, alert.userId)));
    await db.insert(alertsTable).values([serialize(nextAlert, nextAlert.userId)]);
    return nextAlert;
  };

  const saveGoal = async (goal: Record<string, unknown>) => {
    await db.insert(goalsTable).values([
      serialize({
        id: String(goal.id ?? `goal_${Date.now()}`),
        userId: String(goal.userId ?? "unknown"),
        createdAt: new Date().toISOString(),
        ...goal
      })
    ]);
    return goal;
  };

  const setQuietHours = async (userId: string, start: string, end: string) => {
    const automations = (await loadRows(automationsTable, (value) => value as DemoState["automations"][number], userId)).map((row) =>
      row.userId === userId ? { ...row, quietHours: { start, end } } : row
    );
    await db.delete(automationsTable).where(eq(automationsTable.userId, userId));
    await db.insert(automationsTable).values(automations.map((row) => serialize(row, userId)));
    return automations.filter((row) => row.userId === userId);
  };

  const appendOutboxEvents = async (events: CloudEvent[], apiTrack: ApiTrack = "stable"): Promise<OutboxEvent[]> => {
    const existingRows = await db.select().from(outboxEventsTable);
    const existing = existingRows.map((row) => OutboxEventSchema.parse(JSON.parse(row.payload)));
    const latestSequence = existing.reduce((max, row) => Math.max(max, row.sequence), 0);
    let sequence = latestSequence;
    const occurredAt = new Date().toISOString();
    const parsedEvents = events.map((row) => CloudEventSchema.parse(row));
    const seenCloudEventIds = new Set(existing.map((row) => row.id));
    const uniqueEvents = parsedEvents.filter((event) => {
      if (seenCloudEventIds.has(event.id)) {
        return false;
      }
      seenCloudEventIds.add(event.id);
      return true;
    });
    const next = uniqueEvents.map((event) =>
      OutboxEventSchema.parse({
        ...event,
        eventId: crypto.randomUUID(),
        sequence: ++sequence,
        occurredAt,
        apiTrack
      })
    );

    if (next.length > 0) {
      await db.insert(outboxEventsTable).values(
        next.map((event) => ({
          eventId: event.eventId,
          sequence: event.sequence,
          userId: String((event.data as Record<string, unknown>).userId ?? event.subject),
          eventType: event.type,
          occurredAt: event.occurredAt,
          payload: JSON.stringify(event)
        }))
      );
    }
    return next;
  };

  const listOutboxEvents = async (params: { afterSequence?: number; userId?: string; limit?: number } = {}): Promise<OutboxEvent[]> => {
    const afterSequence = params.afterSequence ?? 0;
    const limit = params.limit ?? 200;
    const rows = (await db.select().from(outboxEventsTable))
      .map((row) => OutboxEventSchema.parse(JSON.parse(row.payload)))
      .filter((row) => row.sequence > afterSequence)
      .filter((row) => !params.userId || String((row.data as Record<string, unknown>).userId ?? row.subject) === params.userId)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, limit);
    return rows;
  };

  const saveWebhookDelivery = async (delivery: WebhookDelivery) => {
    const parsed = WebhookDeliverySchema.parse(delivery);
    await db.insert(webhookDeliveriesTable).values([
      {
        id: parsed.id,
        webhookId: parsed.webhookId,
        eventId: parsed.eventId,
        eventType: parsed.eventType,
        attempt: parsed.attempt,
        status: parsed.status,
        httpStatus: parsed.httpStatus,
        error: parsed.error,
        nextRetryAt: parsed.nextRetryAt,
        deliveredAt: parsed.deliveredAt,
        createdAt: parsed.createdAt,
        payload: JSON.stringify(parsed)
      }
    ]);
    return parsed;
  };

  const listWebhookDeliveries = async (params: { eventId?: string; webhookId?: string } = {}): Promise<WebhookDelivery[]> =>
    (await db.select().from(webhookDeliveriesTable))
      .map((row) => WebhookDeliverySchema.parse(JSON.parse(row.payload)))
      .filter((row) => (params.eventId ? row.eventId === params.eventId : true))
      .filter((row) => (params.webhookId ? row.webhookId === params.webhookId : true))
      .sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1));

  const createAgentToken = async (input: {
    userId: string;
    agentId: string;
    agentName: string;
    scopes: string[];
    mode?: "derived-only" | "full";
    token?: string;
  }): Promise<{ token: string; record: AgentToken }> => {
    const token = input.token ?? `hc_${crypto.randomUUID().replaceAll("-", "")}`;
    const record = AgentTokenSchema.parse({
      id: `agent_token_${crypto.randomUUID()}`,
      userId: input.userId,
      agentId: input.agentId,
      agentName: input.agentName,
      tokenHash: hashToken(token),
      tokenPreview: `${token.slice(0, 6)}...${token.slice(-4)}`,
      scopes: input.scopes,
      mode: input.mode ?? "derived-only",
      status: "active",
      createdAt: new Date().toISOString(),
      revokedAt: null
    });
    await db.insert(agentTokensTable).values([serialize(record, record.userId)]);
    return {
      token,
      record
    };
  };

  const listAgentTokens = async (params: { userId?: string; includeRevoked?: boolean } = {}): Promise<AgentToken[]> =>
    (await loadRows(agentTokensTable, (value) => AgentTokenSchema.parse(value)))
      .filter((row) => (params.userId ? row.userId === params.userId : true))
      .filter((row) => (params.includeRevoked ? true : row.status === "active"));

  const findAgentTokenBySecret = async (token: string): Promise<AgentToken | null> => {
    const tokenHash = hashToken(token);
    const tokens = await listAgentTokens({ includeRevoked: true });
    return tokens.find((row) => row.tokenHash === tokenHash && row.status === "active") ?? null;
  };

  const revokeAgentToken = async (id: string): Promise<AgentToken | null> => {
    const tokens = await listAgentTokens({ includeRevoked: true });
    const target = tokens.find((row) => row.id === id);
    if (!target) {
      return null;
    }
    const next = AgentTokenSchema.parse({
      ...target,
      status: "revoked",
      revokedAt: new Date().toISOString()
    });
    await db.delete(agentTokensTable).where(eq(agentTokensTable.id, toRowId(id, target.userId)));
    await db.insert(agentTokensTable).values([serialize(next, next.userId)]);
    return next;
  };

  const saveIngestFailure = async (failure: IngestFailure): Promise<IngestFailure> => {
    const parsed = IngestFailureSchema.parse(failure);
    await db.delete(ingestFailuresTable).where(eq(ingestFailuresTable.id, toRowId(parsed.id, parsed.userId)));
    await db.insert(ingestFailuresTable).values([serialize(parsed, parsed.userId)]);
    return parsed;
  };

  const listIngestFailures = async (params: { userId?: string; providerId?: string; status?: IngestFailure["status"] } = {}): Promise<IngestFailure[]> =>
    (await loadRows(ingestFailuresTable, (value) => IngestFailureSchema.parse(value)))
      .filter((row) => (params.userId ? row.userId === params.userId : true))
      .filter((row) => (params.providerId ? row.providerId === params.providerId : true))
      .filter((row) => (params.status ? row.status === params.status : true))
      .sort((left, right) => (left.createdAt > right.createdAt ? -1 : 1));

  const markIngestFailureReplayed = async (id: string): Promise<IngestFailure | null> => {
    const failure = (await listIngestFailures()).find((row) => row.id === id);
    if (!failure) {
      return null;
    }
    return saveIngestFailure(
      IngestFailureSchema.parse({
        ...failure,
        status: "replayed",
        replayedAt: new Date().toISOString()
      })
    );
  };

  const getEmissionRecord = async (runKey: string): Promise<EmissionRecord | null> => {
    const rows = await db.select().from(emissionRecordsTable).where(eq(emissionRecordsTable.runKey, runKey));
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      runKey: row.runKey,
      userId: row.userId,
      workflowKind: row.workflowKind,
      payloadHash: row.payloadHash,
      emittedAt: row.emittedAt,
      payload: JSON.parse(row.payload) as Record<string, unknown>
    };
  };

  const upsertEmissionRecord = async (record: EmissionRecord): Promise<EmissionRecord> => {
    await db.delete(emissionRecordsTable).where(eq(emissionRecordsTable.runKey, record.runKey));
    await db.insert(emissionRecordsTable).values([
      {
        runKey: record.runKey,
        userId: record.userId,
        workflowKind: record.workflowKind,
        payloadHash: record.payloadHash,
        emittedAt: record.emittedAt,
        createdAt: new Date().toISOString(),
        payload: JSON.stringify(record.payload)
      }
    ]);
    return record;
  };

  const getSchedulerState = async (userId: string): Promise<SchedulerStateRecord | null> => {
    const rows = await db.select().from(schedulerStateTable).where(eq(schedulerStateTable.userId, userId));
    const row = rows[0];
    if (!row) {
      return null;
    }
    return JSON.parse(row.payload) as SchedulerStateRecord;
  };

  const upsertSchedulerState = async (state: SchedulerStateRecord): Promise<SchedulerStateRecord> => {
    await db.delete(schedulerStateTable).where(eq(schedulerStateTable.userId, state.userId));
    await db.insert(schedulerStateTable).values([
      {
        id: toRowId(state.id, state.userId),
        userId: state.userId,
        createdAt: new Date().toISOString(),
        payload: JSON.stringify(state)
      }
    ]);
    return state;
  };

  const appendSchedulerRun = async (run: SchedulerRunRecord): Promise<SchedulerRunRecord> => {
    await db.insert(schedulerRunsTable).values([
      {
        id: run.userId ? toRowId(run.id, run.userId) : run.id,
        userId: run.userId,
        createdAt: run.startedAt,
        payload: JSON.stringify(run)
      }
    ]);
    return run;
  };

  const listSchedulerRuns = async (params: { userId?: string; limit?: number } = {}): Promise<SchedulerRunRecord[]> => {
    const limit = params.limit ?? 50;
    return (await db.select().from(schedulerRunsTable))
      .map((row) => JSON.parse(row.payload) as SchedulerRunRecord)
      .filter((row) => (params.userId ? row.userId === params.userId : true))
      .sort((left, right) => (left.startedAt > right.startedAt ? -1 : 1))
      .slice(0, limit);
  };

  const serializeProviderCredential = (credential: ProviderCredential): string =>
    JSON.stringify({
      ...credential,
      accessToken: encryptSecret(credential.accessToken),
      refreshToken: credential.refreshToken ? encryptSecret(credential.refreshToken) : null
    });

  const parseProviderCredential = (payload: string): ProviderCredential => {
    const parsed = JSON.parse(payload) as Omit<ProviderCredential, "accessToken" | "refreshToken"> & {
      accessToken: string;
      refreshToken: string | null;
    };
    return ProviderCredentialSchema.parse({
      ...parsed,
      accessToken: decryptSecret(parsed.accessToken),
      refreshToken: parsed.refreshToken ? decryptSecret(parsed.refreshToken) : null
    });
  };

  const upsertProviderCredential = async (credential: ProviderCredential): Promise<ProviderCredential> => {
    const parsed = ProviderCredentialSchema.parse(credential);
    const rowId = toRowId(`${parsed.providerId}:credential`, parsed.userId);
    await db.delete(providerCredentialsTable).where(eq(providerCredentialsTable.id, rowId));
    await db.insert(providerCredentialsTable).values([
      {
        id: rowId,
        userId: parsed.userId,
        providerId: parsed.providerId,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
        payload: serializeProviderCredential(parsed)
      }
    ]);
    return parsed;
  };

  const getProviderCredential = async (userId: string, providerId: ProviderCredential["providerId"]): Promise<ProviderCredential | null> => {
    const rowId = toRowId(`${providerId}:credential`, userId);
    const rows = await db.select().from(providerCredentialsTable).where(eq(providerCredentialsTable.id, rowId));
    const row = rows[0];
    return row ? parseProviderCredential(row.payload) : null;
  };

  const listProviderCredentials = async (params: {
    userId?: string;
    providerId?: ProviderCredential["providerId"];
  } = {}): Promise<ProviderCredential[]> =>
    (await db.select().from(providerCredentialsTable))
      .map((row) => parseProviderCredential(row.payload))
      .filter((row) => (params.userId ? row.userId === params.userId : true))
      .filter((row) => (params.providerId ? row.providerId === params.providerId : true))
      .sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));

  const deleteProviderCredentials = async (userId: string, providerId?: ProviderCredential["providerId"]) => {
    if (providerId) {
      await db.delete(providerCredentialsTable).where(eq(providerCredentialsTable.id, toRowId(`${providerId}:credential`, userId)));
      return;
    }
    await db.delete(providerCredentialsTable).where(eq(providerCredentialsTable.userId, userId));
  };

  return {
    client,
    db,
    replaceState,
    loadState,
    loadStateOrNull,
    listUsers,
    listWebhooks,
    saveWebhook,
    deleteWebhook,
    findAlertById,
    ackAlert,
    saveGoal,
    setQuietHours,
    appendOutboxEvents,
    listOutboxEvents,
    saveWebhookDelivery,
    listWebhookDeliveries,
    createAgentToken,
    listAgentTokens,
    findAgentTokenBySecret,
    revokeAgentToken,
    saveIngestFailure,
    listIngestFailures,
    markIngestFailureReplayed,
    getEmissionRecord,
    upsertEmissionRecord,
    getSchedulerState,
    upsertSchedulerState,
    appendSchedulerRun,
    listSchedulerRuns,
    upsertProviderCredential,
    getProviderCredential,
    listProviderCredentials,
    deleteProviderCredentials
  };
};
