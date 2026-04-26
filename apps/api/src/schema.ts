import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const jsonTable = (tableName: string) =>
  sqliteTable(tableName, {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    payload: text("payload").notNull()
  });

export const usersTable = jsonTable("users");
export const sourceAccountsTable = jsonTable("source_accounts");
export const devicesTable = jsonTable("devices");
export const consentGrantsTable = jsonTable("consent_grants");
export const rawEventsTable = jsonTable("raw_events");
export const observationsTable = jsonTable("observations");
export const episodesTable = jsonTable("episodes");
export const dailySummariesTable = jsonTable("daily_summaries");
export const scoresTable = jsonTable("scores");
export const insightsTable = jsonTable("insights");
export const recommendationsTable = jsonTable("recommendations");
export const alertsTable = jsonTable("alerts");
export const automationsTable = jsonTable("automations");
export const automationRunsTable = jsonTable("automation_runs");
export const feedbackTable = jsonTable("feedback");
export const policiesTable = jsonTable("policies");
export const auditLogsTable = jsonTable("audit_logs");
export const outboxTable = jsonTable("outbox");
export const webhookTable = jsonTable("webhooks");
export const goalsTable = jsonTable("goals");
export const connectorSessionsTable = jsonTable("connector_sessions");
export const syncAnchorsTable = jsonTable("sync_anchors");
export const sourceFiltersTable = jsonTable("source_filters");
export const sourcePrecedenceOverridesTable = jsonTable("source_precedence_overrides");
export const ingestBatchesTable = jsonTable("ingest_batches");
export const ingestRecordsTable = jsonTable("ingest_records");
export const dedupeDecisionsTable = jsonTable("dedupe_decisions");
export const agentTokensTable = jsonTable("agent_tokens");
export const ingestFailuresTable = jsonTable("ingest_failures");

export const usersIndexTable = sqliteTable("users_index", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: text("created_at").notNull()
});

export const sourceAccountsIndexTable = sqliteTable("source_accounts_index", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: text("provider_id").notNull(),
  platform: text("platform").notNull(),
  status: text("status").notNull(),
  lastSyncAt: text("last_sync_at").notNull(),
  syncFreshnessHours: integer("sync_freshness_hours").notNull()
});

export const connectorSessionsIndexTable = sqliteTable("connector_sessions_index", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: text("provider_id").notNull(),
  status: text("status").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull()
});

export const syncAnchorsIndexTable = sqliteTable("sync_anchors_index", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: text("provider_id").notNull(),
  anchor: text("anchor"),
  checkpointedAt: text("checkpointed_at").notNull(),
  lastError: text("last_error")
});

export const outboxEventsTable = sqliteTable("outbox_events", {
  eventId: text("event_id").primaryKey(),
  sequence: integer("sequence").notNull(),
  userId: text("user_id").notNull(),
  eventType: text("event_type").notNull(),
  occurredAt: text("occurred_at").notNull(),
  payload: text("payload").notNull()
});

export const webhookDeliveriesTable = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  attempt: integer("attempt").notNull(),
  status: text("status").notNull(),
  httpStatus: integer("http_status"),
  error: text("error"),
  nextRetryAt: text("next_retry_at"),
  deliveredAt: text("delivered_at"),
  createdAt: text("created_at").notNull(),
  payload: text("payload").notNull()
});

export const emissionRecordsTable = sqliteTable("emission_records", {
  runKey: text("run_key").primaryKey(),
  userId: text("user_id").notNull(),
  workflowKind: text("workflow_kind").notNull(),
  payloadHash: text("payload_hash").notNull(),
  emittedAt: text("emitted_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  payload: text("payload").notNull()
});

export const schedulerStateTable = sqliteTable("scheduler_state", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  payload: text("payload").notNull()
});

export const schedulerRunsTable = sqliteTable("scheduler_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  payload: text("payload").notNull()
});

export const providerCredentialsTable = sqliteTable("provider_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: text("provider_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull(),
  payload: text("payload").notNull()
});
