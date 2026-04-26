import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import path from "node:path";

import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";

import {
  AlertsQuerySchema,
  ConnectCallbackInputSchema,
  ConnectCallbackResponseSchema,
  ConnectStartResponseSchema,
  ConnectorsResponseSchema,
  ConnectorSessionSchema,
  DailySummariesQuerySchema,
  ExplainEntitySchema,
  ExplainResponseSchema,
  HouseholdBootstrapInputSchema,
  HouseholdBootstrapResultSchema,
  IngestBatchInputSchema,
  IngestFailureSchema,
  OutboxEventSchema,
  ProfilesListResponseSchema,
  ProviderCredentialSchema,
  ProviderIdSchema,
  ScoresQuerySchema,
  SourcePrecedenceInputSchema,
  SyncRequestSchema,
  SyncStatusResponseSchema,
  TimelineQuerySchema,
  WebhookDeliverySchema,
  WebhookEndpointSchema
} from "@openvitals/contracts";
import type { CloudEvent, ConnectionMethod, ConnectionMode, NormalizedPayload, ProviderCredential, ProviderId } from "@openvitals/contracts";
import { renderDashboardPage } from "@openvitals/dashboard";
import { renderDevPlaygroundPage } from "@openvitals/devplayground";
import { toFhirBundle } from "@openvitals/export-fhir";
import { toOmh } from "@openvitals/export-omh";
import {
  buildLiveState,
  buildDemoState,
  createConnectorSession,
  explainDedupeDecision,
  explainEntity,
  refreshDerivedState,
  getSyncStatus,
  ingestMobileBatch,
  runIncrementalSync,
  runIncrementalSyncWithPayloads,
  setSourcePrecedence,
  setSourceFilter
} from "@openvitals/runtime";
import {
  buildWhoopConnectMetadata,
  exchangeWhoopCode,
  loadWhoopPayloadFromCredential,
  providerCredentialPreview,
  refreshWhoopCredential
} from "../../../providers/whoop/src/live.js";
import {
  buildOuraConnectMetadata,
  exchangeOuraCode,
  loadOuraPayloadFromCredential,
  refreshOuraCredential
} from "../../../providers/oura/src/live.js";

import { createStore, type EmissionRecord, type SchedulerRunRecord, type SchedulerStateRecord } from "./db.js";
import { createOpenApiDocument } from "./openapi.js";
import { collectorTypeForRuntime, dataModesForRuntime, pickProviderIds, resolveCollector } from "./provider-registry.js";

const webhookInputSchema = z.object({
  url: z.string().url(),
  eventTypes: z.array(
    z.enum([
      "health.sync.completed",
      "health.brief.daily.ready",
      "health.sync.stale",
      "health.score.updated",
      "health.alert.recovery.low",
      "health.review.weekly.ready"
    ])
  ),
  status: z.enum(["active", "paused"]).default("active")
});

const goalInputSchema = z.object({
  userId: z.string(),
  name: z.string(),
  target: z.string()
});

const quietHoursInputSchema = z.object({
  userId: z.string(),
  start: z.string(),
  end: z.string()
});

const sourceFilterUpsertSchema = z.object({
  providerId: ProviderIdSchema,
  ignoredSources: z.array(z.string()).default([])
});

const whoopRedirectCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

const apiModeSchema = z.enum(["demo", "live"]);

const createAgentTokenInputSchema = z.object({
  userId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  scopes: z.array(z.string()).min(1),
  mode: z.enum(["derived-only", "full"]).default("derived-only")
});

const replayIngestFailureInputSchema = z.object({
  id: z.string()
});

const schedulerJobSchema = z.enum(["tick", "daily", "weekly", "stale", "all"]);

const schedulerRunInputSchema = z.object({
  userId: z.string().optional(),
  job: schedulerJobSchema.default("all"),
  dryRun: z.boolean().default(false)
});

type SchedulerJob = z.infer<typeof schedulerJobSchema>;

const whoopWebhookInputSchema = z.object({
  eventId: z.string().optional(),
  type: z.string().optional(),
  occurredAt: z.string().datetime().optional(),
  data: z.record(z.string(), z.unknown()).optional()
});

const liveBootstrapInputSchema = z.object({
  userId: z.string().default("user_live"),
  name: z.string().default("Live User"),
  timezone: z.string().default("UTC"),
  providers: z.array(ProviderIdSchema).optional(),
  createTokens: z.boolean().default(true)
});

type AuthContext = {
  userId: string;
  scopes: string[];
  mode: "derived-only" | "full";
  isAdmin: boolean;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseTokenFromRequest = (request: FastifyRequest): string | null => {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const customHeader = request.headers["x-agent-token"];
  if (typeof customHeader === "string" && customHeader.length > 0) {
    return customHeader;
  }
  return null;
};

const hasScope = (grantedScopes: string[], requiredScope: string): boolean => {
  if (grantedScopes.includes("*") || grantedScopes.includes(requiredScope)) {
    return true;
  }
  const namespace = requiredScope.split(".")[0];
  return namespace ? grantedScopes.includes(`${namespace}.*`) : false;
};

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const timezoneParts = (date: Date, timezone: string): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const get = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day")
  };
};

const localDateKey = (date: Date, timezone: string): string => {
  const { year, month, day } = timezoneParts(date, timezone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
};

const isoWeekKey = (date: Date, timezone: string): string => {
  const parts = timezoneParts(date, timezone);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const weekYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekYear}-W${pad2(week)}`;
};

const dayOfWeekInTimezone = (date: Date, timezone: string): number => {
  const value = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(date);
  switch (value) {
    case "Sun":
      return 0;
    case "Mon":
      return 1;
    case "Tue":
      return 2;
    case "Wed":
      return 3;
    case "Thu":
      return 4;
    case "Fri":
      return 5;
    default:
      return 6;
  }
};

const sha256 = (payload: unknown): string => crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

const isCloudCredentialExpired = (credential: ProviderCredential | null, now = new Date()): boolean =>
  Boolean(credential?.expiresAt && new Date(credential.expiresAt).getTime() <= now.getTime());

const connectionMethodForProvider = (
  mode: "demo" | "live",
  providerId: ProviderId,
  credential: ProviderCredential | null
): ConnectionMethod => {
  if (credential) {
    return credential.connectionMethod;
  }
  if (providerId === "apple-health" || providerId === "health-connect") {
    return "sdk-ingest";
  }
  if (providerId === "whoop" || providerId === "oura") {
    if (mode === "live") {
      const envPrefix = providerId === "whoop" ? "WHOOP" : "OURA";
      if (process.env[`OPENVITALS_${envPrefix}_ACCESS_TOKEN`]) {
        return "env-token";
      }
      if (process.env[`OPENVITALS_${envPrefix}_BRIDGE_URL`]) {
        return "bridge";
      }
      return "oauth";
    }
    return "mock";
  }
  return "mock";
};

const connectionModeFromMethod = (method: ConnectionMethod): ConnectionMode => {
  switch (method) {
    case "sdk-ingest":
      return "mobile_permission";
    case "oauth":
    case "env-token":
    case "bridge":
      return "cloud_oauth";
    case "mock":
      return "mock";
  }
};

const authStateForProvider = (
  providerId: ProviderId,
  sourceStatus: "connected" | "stale" | "errored",
  credential: ProviderCredential | null,
  mode: "demo" | "live",
  now = new Date()
): ProviderCredential["authState"] => {
  if (providerId === "apple-health" || providerId === "health-connect") {
    return sourceStatus === "connected" ? "connected" : "not_connected";
  }
  if (providerId !== "whoop" && providerId !== "oura") {
    return mode === "demo" ? "connected" : "not_connected";
  }
  if (!credential) {
    const envPrefix = providerId === "whoop" ? "WHOOP" : "OURA";
    return process.env[`OPENVITALS_${envPrefix}_ACCESS_TOKEN`] || process.env[`OPENVITALS_${envPrefix}_BRIDGE_URL`] ? "connected" : "not_connected";
  }
  if (credential.lastRefreshError) {
    return "reauth_required";
  }
  if (isCloudCredentialExpired(credential, now)) {
    return "expired";
  }
  return credential.authState;
};

export type CreateApiOptions = {
  dbPath?: string;
  now?: Date;
  mode?: "demo" | "live";
};

export const createApi = async (options: CreateApiOptions = {}) => {
  const app = Fastify({ logger: false, routerOptions: { maxParamLength: 1024 } });
  await app.register(cors, { origin: true });

  const mode = apiModeSchema.parse(options.mode ?? process.env.OPENVITALS_MODE ?? "demo");
  const baseUrl = "http://127.0.0.1:3000";
  const eventBus = new EventEmitter();
  const adminToken = process.env.OPENVITALS_ADMIN_TOKEN ?? "openvitals-dev-admin";
  const defaultDbPath = process.env.OPENVITALS_DB_PATH ?? path.join(process.cwd(), ".openvitals", "openvitals.sqlite");
  const store = await createStore(options.dbPath ?? defaultDbPath);
  const schedulerEnabled = boolFromEnv(process.env.OPENVITALS_SCHEDULER_ENABLED, mode === "live");
  const schedulerHeartbeatMinutes = Math.max(Number(process.env.OPENVITALS_SCHEDULER_HEARTBEAT_MINUTES ?? 15), 1);
  const schedulerLoopIntervalMs = Math.max(Number(process.env.OPENVITALS_SCHEDULER_LOOP_MS ?? 60_000), 15_000);
  const schedulerLeader = boolFromEnv(process.env.OPENVITALS_SCHEDULER_LEADER, true);
  const schedulerLocks = new Set<string>();
  let schedulerLoop: NodeJS.Timeout | null = null;
  let deterministicNowOffsetMs = 1;
  const nowForApi = (): Date => {
    if (!options.now) {
      return new Date();
    }
    return new Date(options.now.getTime() + deterministicNowOffsetMs++);
  };

  const sendError = (reply: FastifyReply, statusCode: number, error: unknown) => reply.code(statusCode).send({ message: errorMessage(error) });

  const ensureDemoAgentTokens = async () => {
    const existing = await store.listAgentTokens({ includeRevoked: true });
    if (existing.length > 0) {
      return;
    }

    await store.createAgentToken({
      userId: "user_ada",
      agentId: "openclaw-health-agent",
      agentName: "OpenClaw Health Agent (Derived)",
      mode: "derived-only",
      scopes: ["read.derived", "read.sync", "send.nudges", "write.goals", "write.preferences"],
      token: "ov_demo_user_ada_derived"
    });
    await store.createAgentToken({
      userId: "user_ada",
      agentId: "openclaw-health-agent-admin",
      agentName: "OpenClaw Health Agent (Full)",
      mode: "full",
      scopes: [
        "read.derived",
        "read.sleep",
        "read.workouts",
        "read.activity",
        "read.raw",
        "read.sync",
        "send.nudges",
        "write.goals",
        "write.preferences",
        "admin.tokens"
      ],
      token: "ov_demo_user_ada_full"
    });
    await store.createAgentToken({
      userId: "user_bea",
      agentId: "demo-cross-user-agent",
      agentName: "Demo Cross User Agent",
      mode: "derived-only",
      scopes: ["read.derived", "read.sync"],
      token: "ov_demo_user_bea_derived"
    });
  };

  const seedDemoState = async (seedNow: Date) => {
    const nextState = buildDemoState(seedNow);
    await store.replaceState(nextState, { resetEventStream: true });
    await store.appendOutboxEvents(nextState.outbox, "stable");
    await ensureDemoAgentTokens();
    return nextState;
  };

  if (mode === "demo") {
    await seedDemoState(options.now ?? new Date());
  }

  const requireStateForUser = async (reply: FastifyReply, userId: string) => {
    try {
      return await store.loadState(userId);
    } catch (error) {
      sendError(reply, 404, `Unknown user or empty runtime state for ${userId}.`);
      return null;
    }
  };

  const providerCredentialForUser = async (userId: string, providerId: ProviderId): Promise<ProviderCredential | null> =>
    store.getProviderCredential(userId, providerId);

  const findCloudSessionByState = async (providerId: "oura" | "whoop", stateToken: string) => {
    const users = await store.listUsers();
    for (const user of users) {
      const currentState = await store.loadState(user.id).catch(() => null);
      if (!currentState) {
        continue;
      }
      const session = currentState.connectorSessions.find(
        (candidate) =>
          candidate.userId === user.id &&
          candidate.providerId === providerId &&
          candidate.status === "active" &&
          candidate.sessionToken === stateToken
      );
      if (session) {
        return {
          currentState,
          session
        };
      }
    }
    return null;
  };

  const findWhoopSessionByState = (stateToken: string) => findCloudSessionByState("whoop", stateToken);
  const findOuraSessionByState = (stateToken: string) => findCloudSessionByState("oura", stateToken);

  const completeWhoopConnection = async (input: {
    currentState: Awaited<ReturnType<typeof store.loadState>>;
    session: z.infer<typeof ConnectorSessionSchema>;
    code?: string;
    accessToken?: string;
    refreshToken?: string | null;
    expiresAt?: string | null;
    externalUserId?: string | null;
    scopes?: string[];
    requestState?: string | null;
  }) => {
    if (new Date(input.session.expiresAt).getTime() < nowForApi().getTime()) {
      throw new Error("WHOOP connect session is invalid or expired. Start a fresh connect flow.");
    }
    if (input.requestState && input.requestState !== input.session.sessionToken) {
      throw new Error("WHOOP OAuth state mismatch.");
    }
    const exchanged =
      input.code
        ? await exchangeWhoopCode({
            code: input.code,
            externalUserId: input.externalUserId ?? null
          })
        : input.accessToken
          ? {
              accessToken: input.accessToken,
              refreshToken: input.refreshToken ?? null,
              expiresAt: input.expiresAt ?? null,
              scopes: input.scopes ?? [],
              externalUserId: input.externalUserId ?? null,
              connectionMethod: "oauth" as const
            }
          : null;
    if (!exchanged) {
      throw new Error("WHOOP callback requires either code or accessToken.");
    }
    const now = nowForApi().toISOString();
    const credential = ProviderCredentialSchema.parse({
      id: `provider_credential_whoop_${input.currentState.user.id}`,
      userId: input.currentState.user.id,
      providerId: "whoop",
      authState: "connected",
      connectionMethod: exchanged.connectionMethod,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresAt: exchanged.expiresAt,
      scopes: exchanged.scopes,
      externalUserId: exchanged.externalUserId,
      lastRefreshAt: null,
      lastRefreshError: null,
      createdAt: now,
      updatedAt: now
    });
    await store.upsertProviderCredential(credential);
    const nextState = {
      ...input.currentState,
      sourceAccounts: input.currentState.sourceAccounts.map((sourceAccount) =>
        sourceAccount.providerId === "whoop"
          ? {
              ...sourceAccount,
              status: "connected" as const,
              lastSyncAt: now,
              syncFreshnessHours: 0,
              externalUserId: credential.externalUserId ?? sourceAccount.externalUserId
            }
          : sourceAccount
      ),
      connectorSessions: input.currentState.connectorSessions.map((candidate) =>
        candidate.id === input.session.id ? { ...candidate, status: "exchanged" as const } : candidate
      )
    };
    await store.replaceState(nextState, { resetEventStream: false });
    const redacted = providerCredentialPreview(credential);
    return ConnectCallbackResponseSchema.parse({
      userId: input.currentState.user.id,
      providerId: "whoop",
      connected: true,
      accessTokenPreview: redacted.accessTokenPreview,
      refreshTokenPreview: redacted.refreshTokenPreview,
      credential: redacted
    });
  };

  const completeOuraConnection = async (input: {
    currentState: Awaited<ReturnType<typeof store.loadState>>;
    session: z.infer<typeof ConnectorSessionSchema>;
    code?: string;
    accessToken?: string;
    refreshToken?: string | null;
    expiresAt?: string | null;
    externalUserId?: string | null;
    scopes?: string[];
    requestState?: string | null;
  }) => {
    if (new Date(input.session.expiresAt).getTime() < nowForApi().getTime()) {
      throw new Error("Oura connect session is invalid or expired. Start a fresh connect flow.");
    }
    if (input.requestState && input.requestState !== input.session.sessionToken) {
      throw new Error("Oura OAuth state mismatch.");
    }
    const exchanged =
      input.code
        ? await exchangeOuraCode({
            code: input.code,
            externalUserId: input.externalUserId ?? null
          })
        : input.accessToken
          ? {
              accessToken: input.accessToken,
              refreshToken: input.refreshToken ?? null,
              expiresAt: input.expiresAt ?? null,
              scopes: input.scopes ?? [],
              externalUserId: input.externalUserId ?? null,
              connectionMethod: "oauth" as const
            }
          : null;
    if (!exchanged) {
      throw new Error("Oura callback requires either code or accessToken.");
    }
    const now = nowForApi().toISOString();
    const credential = ProviderCredentialSchema.parse({
      id: `provider_credential_oura_${input.currentState.user.id}`,
      userId: input.currentState.user.id,
      providerId: "oura",
      authState: "connected",
      connectionMethod: exchanged.connectionMethod,
      accessToken: exchanged.accessToken,
      refreshToken: exchanged.refreshToken,
      expiresAt: exchanged.expiresAt,
      scopes: exchanged.scopes,
      externalUserId: exchanged.externalUserId,
      lastRefreshAt: null,
      lastRefreshError: null,
      createdAt: now,
      updatedAt: now
    });
    await store.upsertProviderCredential(credential);
    const nextState = {
      ...input.currentState,
      sourceAccounts: input.currentState.sourceAccounts.map((sourceAccount) =>
        sourceAccount.providerId === "oura"
          ? {
              ...sourceAccount,
              status: "connected" as const,
              lastSyncAt: now,
              syncFreshnessHours: 0,
              externalUserId: credential.externalUserId ?? sourceAccount.externalUserId
            }
          : sourceAccount
      ),
      connectorSessions: input.currentState.connectorSessions.map((candidate) =>
        candidate.id === input.session.id ? { ...candidate, status: "exchanged" as const } : candidate
      )
    };
    await store.replaceState(nextState, { resetEventStream: false });
    const redacted = providerCredentialPreview(credential);
    return ConnectCallbackResponseSchema.parse({
      userId: input.currentState.user.id,
      providerId: "oura",
      connected: true,
      accessTokenPreview: redacted.accessTokenPreview,
      refreshTokenPreview: redacted.refreshTokenPreview,
      credential: redacted
    });
  };

  const buildConnectorsResponse = async (state: Awaited<ReturnType<typeof store.loadState>>) => {
    const now = nowForApi();
    const sourceAccounts = await Promise.all(
      state.sourceAccounts.map(async (sourceAccount) => {
        const credential = await providerCredentialForUser(state.user.id, sourceAccount.providerId);
        const connectionMethod = connectionMethodForProvider(mode, sourceAccount.providerId, credential);
        return {
          ...sourceAccount,
          authState: authStateForProvider(sourceAccount.providerId, sourceAccount.status, credential, mode, now),
          dataMode: dataModesForRuntime(mode)[sourceAccount.providerId] ?? "demo",
          runtimePath: resolveCollector(mode, sourceAccount.providerId).collector.manifest.runtimePath,
          connectionMethod,
          connectionMode: connectionModeFromMethod(connectionMethod),
          credentialUpdatedAt: credential?.updatedAt ?? null,
          credentialExpiresAt: credential?.expiresAt ?? null,
          lastCredentialError: credential?.lastRefreshError ?? null
        };
      })
    );

    return ConnectorsResponseSchema.parse({
      runtimeMode: mode,
      collectorType: collectorTypeForRuntime(mode),
      user: state.user,
      sourceAccounts,
      devices: state.devices,
      policies: state.policies,
      sourceFilters: state.sourceFilters,
      sourcePrecedenceOverrides: state.sourcePrecedenceOverrides
    });
  };

  const buildSyncStatusResponse = async (state: Awaited<ReturnType<typeof store.loadState>>, userId: string, now = nowForApi()) => {
    const providerIds = state.sourceAccounts.map((sourceAccount) => sourceAccount.providerId);
    const credentials = await Promise.all(providerIds.map((providerId) => providerCredentialForUser(userId, providerId)));
    const authStates = Object.fromEntries(
      providerIds.map((providerId, index) => [
        providerId,
        authStateForProvider(providerId, state.sourceAccounts.find((sourceAccount) => sourceAccount.providerId === providerId)?.status ?? "stale", credentials[index] ?? null, mode, now)
      ])
    ) as Partial<Record<ProviderId, ProviderCredential["authState"]>>;
    const connectionMethods = Object.fromEntries(
      providerIds.map((providerId, index) => [providerId, connectionMethodForProvider(mode, providerId, credentials[index] ?? null)])
    ) as Partial<Record<ProviderId, ConnectionMethod>>;
    const connectionModes = Object.fromEntries(
      providerIds.map((providerId) => [providerId, connectionModeFromMethod(connectionMethods[providerId] ?? "mock")])
    ) as Partial<Record<ProviderId, ConnectionMode>>;
    const credentialExpiresAt = Object.fromEntries(
      providerIds.map((providerId, index) => [providerId, credentials[index]?.expiresAt ?? null])
    ) as Partial<Record<ProviderId, string | null>>;
    const lastCredentialErrors = Object.fromEntries(
      providerIds.map((providerId, index) => [providerId, credentials[index]?.lastRefreshError ?? null])
    ) as Partial<Record<ProviderId, string | null>>;

    return SyncStatusResponseSchema.parse(
      getSyncStatus(state, userId, now, {
        dataModes: dataModesForRuntime(mode),
        authStates,
        connectionMethods,
        connectionModes,
        credentialExpiresAt,
        lastCredentialErrors
      })
    );
  };

  const authorize = async (
    request: FastifyRequest,
    reply: FastifyReply,
    input: {
      userId?: string;
      requiredScopes?: string[];
      allowAdminBypass?: boolean;
    }
  ): Promise<AuthContext | null> => {
    const isAdmin = input.allowAdminBypass && request.headers["x-openvitals-admin"] === adminToken;
    if (isAdmin) {
      return {
        userId: input.userId ?? "admin",
        scopes: ["*"],
        mode: "full",
        isAdmin: true
      };
    }

    const tokenSecret = parseTokenFromRequest(request);
    if (!tokenSecret) {
      sendError(reply, 401, "Missing bearer token. Use Authorization: Bearer <token>.");
      return null;
    }

    const token = await store.findAgentTokenBySecret(tokenSecret);
    if (!token) {
      sendError(reply, 401, "Invalid or revoked agent token.");
      return null;
    }

    if (input.userId && token.userId !== input.userId) {
      sendError(reply, 403, "Token user does not match requested user.");
      return null;
    }

    if (token.mode !== "full") {
      for (const requiredScope of input.requiredScopes ?? []) {
        if (!hasScope(token.scopes, requiredScope)) {
          sendError(reply, 403, `Missing required scope: ${requiredScope}`);
          return null;
        }
      }
    }

    return {
      userId: token.userId,
      scopes: token.scopes,
      mode: token.mode,
      isAdmin: false
    };
  };

  const toLocalMinutes = (date: Date, timezone: string): number => {
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

  const toClockMinutes = (clock: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
    if (!match) {
      return null;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return hour * 60 + minute;
  };

  const isWithinQuietHours = (input: { timezone: string; quietHours: { start: string; end: string } }, now = new Date()): boolean => {
    const start = toClockMinutes(input.quietHours.start);
    const end = toClockMinutes(input.quietHours.end);
    if (start === null || end === null || start === end) {
      return false;
    }
    const localMinutes = toLocalMinutes(now, input.timezone);
    if (start < end) {
      return localMinutes >= start && localMinutes < end;
    }
    return localMinutes >= start || localMinutes < end;
  };

  const isUrgentEvent = (eventType: string): boolean => eventType === "health.sync.stale" || eventType === "health.alert.recovery.low";

  const shouldDeliverEvent = (
    eventType: string,
    policy: {
      staleGate: boolean;
      inQuietHours: boolean;
    }
  ): boolean => {
    if (policy.inQuietHours && !isUrgentEvent(eventType)) {
      return false;
    }
    if (
      policy.staleGate &&
      (eventType === "health.score.updated" || eventType === "health.review.weekly.ready" || eventType === "health.brief.daily.ready")
    ) {
      return false;
    }
    return true;
  };

  const deliveryPolicyForUser = (
    state: Awaited<ReturnType<typeof store.loadState>>,
    userId: string,
    now = new Date()
  ): {
    staleGate: boolean;
    inQuietHours: boolean;
  } => {
    const syncStatus = getSyncStatus(state, userId, now, { dataModes: dataModesForRuntime(mode) });
    const staleGate = syncStatus.sources.some((source) => source.dataQualityGate !== "ok");
    const automation = state.automations.find((row) => row.userId === userId && row.status === "active");
    const inQuietHours = automation ? isWithinQuietHours({ timezone: state.user.timezone, quietHours: automation.quietHours }, now) : false;
    return {
      staleGate,
      inQuietHours
    };
  };

  const defaultSchedulerState = (userId: string, now = new Date()): SchedulerStateRecord => ({
    id: `scheduler_state_${userId}`,
    userId,
    enabled: schedulerEnabled,
    leader: schedulerLeader,
    lastTickAt: null,
    nextTickAt: new Date(now.getTime() + schedulerHeartbeatMinutes * 60_000).toISOString(),
    lastError: null,
    lastRunSummary: null,
    lastDailyKey: null,
    lastWeeklyKey: null,
    staleActive: false,
    lastStaleHash: null,
    updatedAt: now.toISOString()
  });

  const emissionWorkflowForType = (eventType: string): "morning_brief" | "weekly_review" | "sync_stale_alert" | null => {
    if (eventType === "health.brief.daily.ready") {
      return "morning_brief";
    }
    if (eventType === "health.review.weekly.ready") {
      return "weekly_review";
    }
    if (eventType === "health.sync.stale") {
      return "sync_stale_alert";
    }
    return null;
  };

  const staleSourceHashFromState = (state: Awaited<ReturnType<typeof store.loadState>>): string | null => {
    const staleAlert = state.alerts.find((alert) => alert.userId === state.user.id && alert.workflowKind === "sync_stale_alert" && alert.status === "open");
    if (!staleAlert) {
      return null;
    }
    return sha256([...staleAlert.evidenceSet].sort()).slice(0, 16);
  };

  const emissionRunKey = (input: {
    workflowKind: "morning_brief" | "weekly_review" | "sync_stale_alert";
    userId: string;
    timezone: string;
    now: Date;
    staleHash: string | null;
  }): string => {
    if (input.workflowKind === "morning_brief") {
      return `morning:${input.userId}:${localDateKey(input.now, input.timezone)}`;
    }
    if (input.workflowKind === "weekly_review") {
      return `weekly:${input.userId}:${isoWeekKey(input.now, input.timezone)}`;
    }
    return `stale:${input.userId}:${input.staleHash ?? "none"}:24h`;
  };

  const applyEmissionPolicy = async (
    state: Awaited<ReturnType<typeof store.loadState>>,
    events: CloudEvent[],
    now = new Date(),
    options: { dryRun?: boolean } = {}
  ): Promise<{
    events: CloudEvent[];
    suppressed: number;
    emissionRecords: EmissionRecord[];
    schedulerState: SchedulerStateRecord;
  }> => {
    const dryRun = options.dryRun ?? false;
    const currentSchedulerState = (await store.getSchedulerState(state.user.id)) ?? defaultSchedulerState(state.user.id, now);
    const nextSchedulerState: SchedulerStateRecord = {
      ...currentSchedulerState,
      enabled: schedulerEnabled,
      leader: schedulerLeader,
      updatedAt: now.toISOString()
    };
    const staleHash = staleSourceHashFromState(state);
    let staleActive = currentSchedulerState.staleActive;
    let lastStaleHash = currentSchedulerState.lastStaleHash;
    if (!staleHash) {
      staleActive = false;
      lastStaleHash = null;
    }

    const selected: CloudEvent[] = [];
    const emissionRecords: EmissionRecord[] = [];
    let suppressed = 0;

    for (const event of events) {
      const eventUserId = String((event.data as Record<string, unknown>).userId ?? event.subject);
      if (eventUserId !== state.user.id) {
        selected.push(event);
        continue;
      }

      const workflowKind = emissionWorkflowForType(event.type);
      if (!workflowKind) {
        selected.push(event);
        continue;
      }

      if (workflowKind === "sync_stale_alert") {
        const hasTransition = Boolean(staleHash) && (!staleActive || lastStaleHash !== staleHash);
        if (!hasTransition) {
          suppressed += 1;
          continue;
        }
        staleActive = true;
        lastStaleHash = staleHash;
      }

      const runKey = emissionRunKey({
        workflowKind,
        userId: state.user.id,
        timezone: state.user.timezone,
        now,
        staleHash
      });
      const payloadHash = sha256(event.data);
      const existing = await store.getEmissionRecord(runKey);
      if (existing && existing.payloadHash === payloadHash) {
        suppressed += 1;
        continue;
      }

      selected.push(event);
      if (!dryRun) {
        emissionRecords.push({
          runKey,
          userId: state.user.id,
          workflowKind,
          payloadHash,
          emittedAt: now.toISOString(),
          payload: event.data as Record<string, unknown>
        });
      }
    }
    nextSchedulerState.staleActive = staleActive;
    nextSchedulerState.lastStaleHash = lastStaleHash;

    return {
      events: selected,
      suppressed,
      emissionRecords,
      schedulerState: nextSchedulerState
    };
  };

  const emitOutbox = (events: unknown[]) => {
    for (const event of events) {
      eventBus.emit("outbox_event", event);
    }
  };

  const dispatchWebhooks = async (
    state: Awaited<ReturnType<typeof store.loadState>>,
    events: z.infer<typeof OutboxEventSchema>[],
    now = nowForApi()
  ) => {
    const hooks = (await store.listWebhooks()).filter((hook) => hook.status === "active");
    const deliveries: Array<Record<string, unknown>> = [];
    const maxAttempts = 3;

    for (const hook of hooks) {
      for (const event of events.filter((entry) => hook.eventTypes.includes(entry.type))) {
        const eventUserId = String((event.data as Record<string, unknown>).userId ?? event.subject);
        if (state.user.id !== eventUserId) {
          continue;
        }
        if (hook.userId && hook.userId !== eventUserId) {
          continue;
        }
        const policy = deliveryPolicyForUser(state, eventUserId, now);
        if (!shouldDeliverEvent(event.type, policy)) {
          deliveries.push({
            webhookId: hook.id,
            eventId: event.eventId,
            status: "suppressed",
            reason: policy.inQuietHours ? "quiet_hours" : "stale_data_gate"
          });
          continue;
        }
        let delivered = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const retryDelayMs = Math.min(1000 * 2 ** (attempt - 1), 4000);
          const now = new Date();

          try {
            const body = JSON.stringify(event);
            const signatureV1 = crypto.createHmac("sha256", hook.secret).update(body).digest("hex");
            const response = await fetch(hook.url, {
              method: "POST",
              headers: {
                "content-type": "application/cloudevents+json",
                "x-openvitals-signature-v1": `sha256=${signatureV1}`,
                "x-openvitals-event-id": event.eventId
              },
              body
            });

            if (!response.ok) {
              throw new Error(`Webhook responded with ${response.status}`);
            }

            const delivery = WebhookDeliverySchema.parse({
              id: `delivery_${crypto.randomUUID()}`,
              webhookId: hook.id,
              eventId: event.eventId,
              eventType: event.type,
              attempt,
              status: "succeeded",
              httpStatus: response.status,
              error: null,
              nextRetryAt: null,
              deliveredAt: new Date().toISOString(),
              createdAt: now.toISOString()
            });
            await store.saveWebhookDelivery(delivery);
            deliveries.push({
              webhookId: hook.id,
              eventId: event.eventId,
              status: response.status,
              attempt
            });
            delivered = true;
            break;
          } catch (error) {
            const isLastAttempt = attempt >= maxAttempts;
            const nextRetryAt = isLastAttempt ? null : new Date(now.getTime() + retryDelayMs).toISOString();
            const delivery = WebhookDeliverySchema.parse({
              id: `delivery_${crypto.randomUUID()}`,
              webhookId: hook.id,
              eventId: event.eventId,
              eventType: event.type,
              attempt,
              status: isLastAttempt ? "failed" : "retrying",
              httpStatus: null,
              error: errorMessage(error),
              nextRetryAt,
              deliveredAt: null,
              createdAt: now.toISOString()
            });
            await store.saveWebhookDelivery(delivery);
            if (isLastAttempt) {
              deliveries.push({
                webhookId: hook.id,
                eventId: event.eventId,
                status: "failed",
                attempt,
                error: errorMessage(error)
              });
            } else {
              await delay(retryDelayMs);
            }
          }
        }

        if (!delivered) {
          continue;
        }
      }
    }

    return deliveries;
  };

  const persistStateAndFanout = async (
    nextState: Awaited<ReturnType<typeof store.loadState>>,
    options: { allowedTypes?: string[]; dryRun?: boolean; recordEmissionState?: boolean } = {}
  ) => {
    const allowedTypes = options.allowedTypes ? new Set(options.allowedTypes) : null;
    const candidateEvents = allowedTypes ? nextState.outbox.filter((event) => allowedTypes.has(event.type)) : nextState.outbox;
    const emission = await applyEmissionPolicy(nextState, candidateEvents, nowForApi(), { dryRun: options.dryRun });

    if (options.dryRun) {
      return {
        deliveries: [],
        appendedEvents: [],
        previewEvents: emission.events,
        suppressedEvents: emission.suppressed
      };
    }

    const stateToPersist = {
      ...nextState,
      outbox: emission.events
    };
    await store.replaceState(stateToPersist, { resetEventStream: false });
    const appendedEvents = await store.appendOutboxEvents(stateToPersist.outbox, "stable");
    const deliveries = await dispatchWebhooks(stateToPersist, appendedEvents);
    emitOutbox(appendedEvents);
    if (options.recordEmissionState) {
      for (const record of emission.emissionRecords) {
        await store.upsertEmissionRecord(record);
      }
      await store.upsertSchedulerState(emission.schedulerState);
    }
    return {
      deliveries,
      appendedEvents,
      previewEvents: emission.events,
      suppressedEvents: emission.suppressed
    };
  };

  const collectLiveSyncPayloads = async (
    currentState: Awaited<ReturnType<typeof store.loadState>>,
    userId: string,
    providerId: string | undefined,
    syncMode: "history" | "incremental"
  ) => {
    const isEmptyNormalizedPayload = (payload: NormalizedPayload): boolean =>
      payload.rawEvents.length === 0 && payload.observations.length === 0 && payload.episodes.length === 0 && payload.devices.length === 0;

    let nextState = currentState;
    const payloads: Partial<Record<ProviderId, NormalizedPayload>> = {};
    for (const candidateProviderId of pickProviderIds(providerId)) {
      const sourceAccount = currentState.sourceAccounts.find(
        (sourceAccountRow) => sourceAccountRow.userId === userId && sourceAccountRow.providerId === candidateProviderId
      );
      if (!sourceAccount) {
        continue;
      }

      const { collector } = resolveCollector(mode, candidateProviderId);
      const lastAnchor = currentState.syncAnchors.find(
        (anchorRow) => anchorRow.userId === userId && anchorRow.providerId === candidateProviderId
      )?.anchor;
      const context = {
        user: currentState.user,
        sourceAccount,
        lastAnchor: lastAnchor ?? null,
        mode: syncMode
      } as const;
      try {
        let nextPayload: NormalizedPayload;
        if (mode === "live" && (candidateProviderId === "whoop" || candidateProviderId === "oura")) {
          const envPrefix = candidateProviderId === "whoop" ? "WHOOP" : "OURA";
          const displayName = candidateProviderId === "whoop" ? "WHOOP" : "Oura";
          const existingCredential = await store.getProviderCredential(userId, candidateProviderId);
          let credential = existingCredential;
          if (credential && isCloudCredentialExpired(credential)) {
            try {
              credential = candidateProviderId === "whoop" ? await refreshWhoopCredential(credential) : await refreshOuraCredential(credential);
              await store.upsertProviderCredential(credential);
            } catch (error) {
              const failedAt = nowForApi().toISOString();
              const failedCredential = ProviderCredentialSchema.parse({
                ...credential,
                authState: "reauth_required",
                lastRefreshError: errorMessage(error),
                updatedAt: failedAt
              });
              await store.upsertProviderCredential(failedCredential);
              const failure = IngestFailureSchema.parse({
                id: `sync_failure_${crypto.randomUUID()}`,
                userId,
                providerId: candidateProviderId,
                reason: errorMessage(error),
                retryable: true,
                status: "failed",
                payload: {
                  syncMode,
                  providerId: candidateProviderId,
                  stage: `${candidateProviderId}.refresh`
                },
                createdAt: failedAt,
                replayedAt: null
              });
              nextState = {
                ...nextState,
                sourceAccounts: nextState.sourceAccounts.map((candidate) =>
                  candidate.providerId === candidateProviderId
                    ? {
                        ...candidate,
                        status: "errored" as const
                      }
                    : candidate
                ),
                ingestFailures: [...nextState.ingestFailures.filter((row) => row.id !== failure.id), failure]
              };
              await store.saveIngestFailure(failure);
              continue;
            }
          }

          if (credential) {
            const credentialContext = {
              ...context,
              sourceAccount:
                nextState.sourceAccounts.find((candidate) => candidate.providerId === candidateProviderId) ?? sourceAccount
            };
            nextPayload =
              candidateProviderId === "whoop"
                ? await loadWhoopPayloadFromCredential({
                    context: credentialContext,
                    credential,
                    mode: syncMode
                  })
                : await loadOuraPayloadFromCredential({
                    context: credentialContext,
                    credential
                  });
          } else {
            const fallbackPayload = syncMode === "history" ? await collector.syncHistory(context) : await collector.syncIncremental(context);
            if (
              isEmptyNormalizedPayload(fallbackPayload) &&
              !process.env[`OPENVITALS_${envPrefix}_ACCESS_TOKEN`] &&
              !process.env[`OPENVITALS_${envPrefix}_BRIDGE_URL`]
            ) {
              const failedAt = nowForApi().toISOString();
              const failure = IngestFailureSchema.parse({
                id: `sync_failure_${crypto.randomUUID()}`,
                userId,
                providerId: candidateProviderId,
                reason: `${displayName} is not connected for this user. Complete /connect/start + /connect/callback or configure a dev fallback token/bridge.`,
                retryable: true,
                status: "failed",
                payload: {
                  syncMode,
                  providerId: candidateProviderId,
                  stage: `${candidateProviderId}.credentials`
                },
                createdAt: failedAt,
                replayedAt: null
              });
              nextState = {
                ...nextState,
                sourceAccounts: nextState.sourceAccounts.map((candidate) =>
                  candidate.providerId === candidateProviderId
                    ? {
                        ...candidate,
                        status: "stale" as const
                      }
                    : candidate
                ),
                ingestFailures: [...nextState.ingestFailures.filter((row) => row.id !== failure.id), failure]
              };
              await store.saveIngestFailure(failure);
              continue;
            }
            nextPayload = fallbackPayload;
          }
        } else {
          nextPayload = syncMode === "history" ? await collector.syncHistory(context) : await collector.syncIncremental(context);
        }
        payloads[candidateProviderId] = nextPayload;
      } catch (error) {
        const failedAt = nowForApi().toISOString();
        const failure = IngestFailureSchema.parse({
          id: `sync_failure_${crypto.randomUUID()}`,
          userId,
          providerId: candidateProviderId,
          reason: errorMessage(error),
          retryable: true,
          status: "failed",
          payload: {
            syncMode,
            providerId: candidateProviderId
          },
          createdAt: failedAt,
          replayedAt: null
        });
        nextState = {
          ...nextState,
          ingestFailures: [...nextState.ingestFailures.filter((row) => row.id !== failure.id), failure]
        };
        await store.saveIngestFailure(failure);
      }
    }
    return {
      state: nextState,
      payloads
    };
  };

  const schedulerAllowedTypes: Record<Exclude<SchedulerJob, "all">, string[]> = {
    tick: ["health.sync.stale", "health.alert.recovery.low"],
    daily: ["health.brief.daily.ready"],
    weekly: ["health.review.weekly.ready"],
    stale: ["health.sync.stale"]
  };
  const ingestAllowedTypes = [
    "health.sync.completed",
    "health.score.updated",
    "health.brief.daily.ready",
    "health.review.weekly.ready",
    "health.alert.recovery.low"
  ];

  const executeSchedulerJob = async (input: {
    userId: string;
    job: Exclude<SchedulerJob, "all">;
    dryRun?: boolean;
  }): Promise<SchedulerRunRecord> => {
    const dryRun = input.dryRun ?? false;
    const startedAt = nowForApi();

    if (!dryRun && schedulerLocks.has(input.userId)) {
      return {
        id: `scheduler_run_${crypto.randomUUID()}`,
        userId: input.userId,
        job: input.job,
        status: "failed",
        startedAt: startedAt.toISOString(),
        finishedAt: nowForApi().toISOString(),
        durationMs: 0,
        dryRun,
        emittedEvents: 0,
        error: "scheduler_locked",
        summary: null
      };
    }

    if (!dryRun) {
      schedulerLocks.add(input.userId);
    }

    try {
      const currentState = await store.loadState(input.userId);
      const now = nowForApi();
      const syncResult =
        mode === "live" && input.job === "tick"
          ? await (async () => {
              const liveSync = await collectLiveSyncPayloads(currentState, input.userId, "whoop", "incremental");
              const payloads = liveSync.payloads;
              if (Object.keys(payloads).length > 0) {
                return runIncrementalSyncWithPayloads(liveSync.state, input.userId, payloads, now);
              }
              const refreshed = refreshDerivedState(liveSync.state, input.userId, now);
              return {
                state: refreshed.state,
                syncedProviderIds: [],
                outboxEvents: refreshed.outboxEvents,
                staleGateApplied: refreshed.staleGateApplied
              };
            })()
          : (() => {
              const refreshed = refreshDerivedState(currentState, input.userId, now);
              return {
                state: refreshed.state,
                outboxEvents: refreshed.outboxEvents,
                staleGateApplied: refreshed.staleGateApplied
              };
            })();
      const fanout = await persistStateAndFanout(syncResult.state, {
        allowedTypes: schedulerAllowedTypes[input.job],
        dryRun,
        recordEmissionState: true
      });
      const emittedEvents = fanout.previewEvents.length;
      const summary = {
        userId: input.userId,
        job: input.job,
        emittedEvents,
        appendedEvents: fanout.appendedEvents.length,
        suppressedEvents: fanout.suppressedEvents
      };

      if (!dryRun) {
        const existingSchedulerState = (await store.getSchedulerState(input.userId)) ?? defaultSchedulerState(input.userId, now);
        const nextSchedulerState: SchedulerStateRecord = {
          ...existingSchedulerState,
          enabled: schedulerEnabled,
          leader: schedulerLeader,
          lastRunSummary: summary,
          lastError: null,
          updatedAt: now.toISOString()
        };
        if (input.job === "tick") {
          nextSchedulerState.lastTickAt = now.toISOString();
          nextSchedulerState.nextTickAt = new Date(now.getTime() + schedulerHeartbeatMinutes * 60_000).toISOString();
        }
        if (input.job === "daily") {
          nextSchedulerState.lastDailyKey = localDateKey(now, currentState.user.timezone);
        }
        if (input.job === "weekly") {
          nextSchedulerState.lastWeeklyKey = isoWeekKey(now, currentState.user.timezone);
        }
        await store.upsertSchedulerState(nextSchedulerState);
      }

      const run: SchedulerRunRecord = {
        id: `scheduler_run_${crypto.randomUUID()}`,
        userId: input.userId,
        job: input.job,
        status: "succeeded",
        startedAt: startedAt.toISOString(),
        finishedAt: nowForApi().toISOString(),
        durationMs: Math.max(nowForApi().getTime() - startedAt.getTime(), 0),
        dryRun,
        emittedEvents,
        error: null,
        summary
      };
      if (!dryRun) {
        await store.appendSchedulerRun(run);
      }
      return run;
    } catch (error) {
      const finishedAt = nowForApi();
      const run: SchedulerRunRecord = {
        id: `scheduler_run_${crypto.randomUUID()}`,
        userId: input.userId,
        job: input.job,
        status: "failed",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: Math.max(finishedAt.getTime() - startedAt.getTime(), 0),
        dryRun,
        emittedEvents: 0,
        error: errorMessage(error),
        summary: null
      };
      if (!dryRun) {
        const existingSchedulerState = (await store.getSchedulerState(input.userId)) ?? defaultSchedulerState(input.userId, finishedAt);
        await store.upsertSchedulerState({
          ...existingSchedulerState,
          enabled: schedulerEnabled,
          leader: schedulerLeader,
          lastError: run.error,
          lastRunSummary: {
            userId: input.userId,
            job: input.job,
            error: run.error
          },
          updatedAt: finishedAt.toISOString()
        });
        await store.appendSchedulerRun(run);
      }
      return run;
    } finally {
      if (!dryRun) {
        schedulerLocks.delete(input.userId);
      }
    }
  };

  const expandSchedulerJobs = (job: SchedulerJob): Exclude<SchedulerJob, "all">[] => {
    if (job === "all") {
      return ["tick", "daily", "weekly", "stale"];
    }
    return [job];
  };

  const runSchedulerSweep = async () => {
    if (!schedulerEnabled || !schedulerLeader || mode !== "live") {
      return;
    }

    const now = nowForApi();
    const users = await store.listUsers();
    for (const user of users) {
      const userState = await store.loadState(user.id).catch(() => null);
      if (!userState) {
        continue;
      }

      const schedulerState = (await store.getSchedulerState(user.id)) ?? defaultSchedulerState(user.id, now);
      const localMinutes = toLocalMinutes(now, userState.user.timezone);
      const currentDailyKey = localDateKey(now, userState.user.timezone);
      const currentWeeklyKey = isoWeekKey(now, userState.user.timezone);
      const dueTick =
        schedulerState.lastTickAt === null || now.getTime() - new Date(schedulerState.lastTickAt).getTime() >= schedulerHeartbeatMinutes * 60_000;
      const dueDaily = localMinutes >= 8 * 60 && schedulerState.lastDailyKey !== currentDailyKey;
      const dueWeekly = dayOfWeekInTimezone(now, userState.user.timezone) === 0 && localMinutes >= 9 * 60 && schedulerState.lastWeeklyKey !== currentWeeklyKey;

      if (dueTick) {
        await executeSchedulerJob({ userId: user.id, job: "tick" });
      }
      if (dueDaily) {
        await executeSchedulerJob({ userId: user.id, job: "daily" });
      }
      if (dueWeekly) {
        await executeSchedulerJob({ userId: user.id, job: "weekly" });
      }
    }
  };

  app.get("/", async () => ({
    name: "openvitals",
    mode,
    dashboard: "/dashboard",
    playground: "/playground",
    openapi: "/v1/openapi.json"
  }));

  app.get("/dashboard", async (_, reply) => {
    reply.type("text/html").send(renderDashboardPage(baseUrl));
  });

  app.get("/playground", async (_, reply) => {
    reply.type("text/html").send(renderDevPlaygroundPage(baseUrl));
  });

  app.get("/health", async () => ({ ok: true, mode }));

  app.get("/v1/state", async (request, reply) => {
    const query = z.object({ userId: z.string().optional() }).parse(request.query ?? {});
    const auth = await authorize(request, reply, { allowAdminBypass: true, requiredScopes: ["read.raw"], userId: query.userId });
    if (!auth) {
      return;
    }
    const targetUserId = query.userId ?? auth.userId;
    const state = await requireStateForUser(reply, targetUserId);
    if (!state) {
      return;
    }
    return state;
  });

  app.get("/v1/openapi.json", async () => createOpenApiDocument(baseUrl));

  app.get("/v1/users", async (request, reply) => {
    const auth = await authorize(request, reply, { requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    const users = await store.listUsers();
    const visibleUsers = auth.isAdmin || hasScope(auth.scopes, "admin.tokens")
      ? users
      : users.filter((row) => row.id === auth.userId);
    return ProfilesListResponseSchema.parse({
      profiles: visibleUsers.map((row) => ({
        id: row.id,
        name: row.name,
        timezone: row.timezone,
        lastSyncAt: row.lastSyncAt
      }))
    });
  });

  app.get("/v1/connectors", async (request, reply) => {
    const query = z.object({ userId: z.string() }).parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }

    const state = await requireStateForUser(reply, query.userId);
    if (!state) {
      return;
    }

    return buildConnectorsResponse(state);
  });

  app.get("/v1/dashboard/state", async (request, reply) => {
    const query = z.object({ userId: z.string() }).parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.derived", "read.sync"] });
    if (!auth) {
      return;
    }
    const state = await requireStateForUser(reply, query.userId);
    if (!state) {
      return;
    }

    const connectors = await buildConnectorsResponse(state);
    const scores = state.scores.filter((score) => score.userId === query.userId);
    const alerts = state.alerts.filter((alert) => alert.userId === query.userId);
    const explain = explainEntity(state, "score", "score_recovery_readiness");
    const syncStatus = await buildSyncStatusResponse(state, query.userId, nowForApi());

    return {
      runtimeMode: mode,
      collectorType: collectorTypeForRuntime(mode),
      connectors,
      scores,
      alerts,
      explain,
      automationRuns: state.automationRuns.filter((run) => run.userId === query.userId),
      syncStatus
    };
  });

  app.post("/v1/demo/reset", async (request, reply) => {
    const auth = await authorize(request, reply, { allowAdminBypass: true, requiredScopes: ["admin.tokens"] });
    if (!auth) {
      return;
    }
    const body = z.object({ now: z.string().datetime().optional() }).parse(request.body ?? {});
    const nextState = await seedDemoState(body.now ? new Date(body.now) : nowForApi());
    await store.deleteProviderCredentials(nextState.user.id);
    return {
      userId: nextState.user.id,
      sourceAccounts: nextState.sourceAccounts.length,
      outboxEvents: nextState.outbox.length
    };
  });

  app.post("/v1/live/bootstrap", async (request, reply) => {
    if (mode !== "live") {
      return reply.code(400).send({ message: "Live bootstrap is only available when OPENVITALS_MODE=live." });
    }
    const auth = await authorize(request, reply, { allowAdminBypass: true, requiredScopes: ["admin.tokens"] });
    if (!auth) {
      return;
    }

    const body = liveBootstrapInputSchema.parse(request.body ?? {});
    const nextState = buildLiveState({
      userId: body.userId,
      name: body.name,
      timezone: body.timezone,
      providerIds: body.providers,
      now: nowForApi()
    });
    await store.deleteProviderCredentials(nextState.user.id);
    await store.replaceState(nextState, { resetEventStream: true });

    const tokens: Array<{ label: string; token: string }> = [];
    if (body.createTokens) {
      const derived = await store.createAgentToken({
        userId: nextState.user.id,
        agentId: "openclaw-health-agent",
        agentName: "OpenClaw Health Agent (Derived)",
        mode: "derived-only",
        scopes: ["read.derived", "read.sync", "send.nudges", "write.goals", "write.preferences"]
      });
      const full = await store.createAgentToken({
        userId: nextState.user.id,
        agentId: "openclaw-health-agent-admin",
        agentName: "OpenClaw Health Agent (Full)",
        mode: "full",
        scopes: [
          "read.derived",
          "read.sleep",
          "read.workouts",
          "read.activity",
          "read.raw",
          "read.sync",
          "send.nudges",
          "write.goals",
          "write.preferences",
          "admin.tokens"
        ]
      });
      tokens.push(
        { label: "derived", token: derived.token },
        { label: "full", token: full.token }
      );
    }

    return {
      runtimeMode: mode,
      userId: nextState.user.id,
      providers: nextState.sourceAccounts.map((account: { providerId: string }) => account.providerId),
      sourceAccounts: nextState.sourceAccounts.length,
      tokenCount: tokens.length,
      tokens
    };
  });

  app.post("/v1/household/bootstrap", async (request, reply) => {
    if (mode !== "live") {
      return reply.code(400).send({ message: "Household bootstrap is only available when OPENVITALS_MODE=live." });
    }
    const auth = await authorize(request, reply, { allowAdminBypass: true, requiredScopes: ["admin.tokens"] });
    if (!auth) {
      return;
    }

    const body = HouseholdBootstrapInputSchema.parse(request.body ?? {});
    const profiles = [body.owner, ...body.family];
    const seen = new Set<string>();
    const uniqueProfiles = profiles.filter((profile) => {
      if (seen.has(profile.userId)) {
        return false;
      }
      seen.add(profile.userId);
      return true;
    });

    const results: Array<{ userId: string; providers: ProviderId[]; sourceAccounts: number; tokens: Array<{ label: "derived" | "full"; token: string }> }> =
      [];
    for (const profile of uniqueProfiles) {
      const state = buildLiveState({
        userId: profile.userId,
        name: profile.name,
        timezone: profile.timezone,
        providerIds: body.providers,
        now: nowForApi()
      });
      await store.deleteProviderCredentials(profile.userId);
      await store.replaceState(state, { resetEventStream: false });
      const profileTokens: Array<{ label: "derived" | "full"; token: string }> = [];
      if (body.createTokens) {
        const fullScopes: Array<string> = [
          "read.derived",
          "read.sleep",
          "read.workouts",
          "read.activity",
          "read.raw",
          "read.sync",
          "send.nudges",
          "write.goals",
          "write.preferences"
        ];
        if (profile.userId === body.owner.userId) {
          fullScopes.push("admin.tokens");
        }
        const derived = await store.createAgentToken({
          userId: profile.userId,
          agentId: "openclaw-health-agent",
          agentName: `OpenClaw Health Agent (${profile.name})`,
          mode: "derived-only",
          scopes: ["read.derived", "read.sync", "send.nudges", "write.goals", "write.preferences"]
        });
        const full = await store.createAgentToken({
          userId: profile.userId,
          agentId: "openclaw-health-agent-admin",
          agentName: `OpenClaw Health Agent (Full ${profile.name})`,
          mode: "full",
          scopes: fullScopes
        });
        profileTokens.push(
          { label: "derived", token: derived.token },
          { label: "full", token: full.token }
        );
      }

      results.push({
        userId: profile.userId,
        providers: state.sourceAccounts.map((sourceAccount) => sourceAccount.providerId),
        sourceAccounts: state.sourceAccounts.length,
        tokens: profileTokens
      });
    }

    return HouseholdBootstrapResultSchema.parse({
      runtimeMode: mode,
      profiles: results
    });
  });

  app.post("/v1/users/:id/connect/:provider/session", async (request, reply) => {
    const params = z.object({ id: z.string(), provider: ProviderIdSchema }).parse(request.params);
    const auth = await authorize(request, reply, { userId: params.id, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    try {
      const currentState = await store.loadState(params.id);
      const session = createConnectorSession(currentState, params.id, params.provider, nowForApi());
      await store.replaceState(session.state, { resetEventStream: false });
      return session.response;
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.post("/v1/users/:id/connect/:provider/start", async (request, reply) => {
    const params = z.object({ id: z.string(), provider: ProviderIdSchema }).parse(request.params);
    const auth = await authorize(request, reply, { userId: params.id, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    try {
      const currentState = await store.loadState(params.id);
      if (mode === "live" && params.provider === "whoop") {
        const now = nowForApi();
        const session = ConnectorSessionSchema.parse({
          id: `session_whoop_${params.id}_${now.getTime()}`,
          userId: params.id,
          providerId: params.provider,
          sessionToken: `whoop_state_${crypto.randomUUID()}`,
          status: "active",
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString()
        });
        const connect = buildWhoopConnectMetadata({
          userId: params.id,
          sessionId: session.id,
          state: session.sessionToken
        });
        await store.replaceState(
          {
            ...currentState,
            connectorSessions: [
              ...currentState.connectorSessions.filter(
                (candidate) => !(candidate.userId === params.id && candidate.providerId === params.provider && candidate.status === "active")
              ),
              session
            ]
          },
          { resetEventStream: false }
        );
        return ConnectStartResponseSchema.parse({
          userId: params.id,
          providerId: params.provider,
          providerClass: "cloud",
          connectUrl: connect.connectUrl,
          sessionId: session.id,
          connectionMethod: connect.connectionMethod,
          state: connect.state,
          callbackUrl: connect.callbackUrl,
          sessionToken: null,
          expiresAt: session.expiresAt
        });
      }
      if (mode === "live" && params.provider === "oura") {
        const now = nowForApi();
        const session = ConnectorSessionSchema.parse({
          id: `session_oura_${params.id}_${now.getTime()}`,
          userId: params.id,
          providerId: params.provider,
          sessionToken: `oura:${params.id}:${crypto.randomUUID()}`,
          status: "active",
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString()
        });
        const connect = buildOuraConnectMetadata({
          userId: params.id,
          sessionId: session.id,
          state: session.sessionToken
        });
        await store.replaceState(
          {
            ...currentState,
            connectorSessions: [
              ...currentState.connectorSessions.filter(
                (candidate) => !(candidate.userId === params.id && candidate.providerId === params.provider && candidate.status === "active")
              ),
              session
            ]
          },
          { resetEventStream: false }
        );
        return ConnectStartResponseSchema.parse({
          userId: params.id,
          providerId: params.provider,
          providerClass: "cloud",
          connectUrl: connect.connectUrl,
          sessionId: session.id,
          connectionMethod: connect.connectionMethod,
          state: connect.state,
          callbackUrl: connect.callbackUrl,
          sessionToken: null,
          expiresAt: session.expiresAt
        });
      }
      const { collector } = resolveCollector(mode, params.provider);
      const connect = await collector.connect(currentState.user);

      let mobileSession: { sessionToken: string; expiresAt: string } | null = null;
      let nextState = currentState;
      if (collector.manifest.providerClass === "mobile") {
          const created = createConnectorSession(currentState, params.id, params.provider, nowForApi());
        nextState = created.state;
        mobileSession = {
          sessionToken: created.response.sessionToken,
          expiresAt: created.response.expiresAt
        };
      }

      await store.replaceState(nextState, { resetEventStream: false });
      return ConnectStartResponseSchema.parse({
        userId: params.id,
        providerId: params.provider,
        providerClass: collector.manifest.providerClass,
        connectUrl: connect.connectUrl,
        sessionId: connect.sessionId,
        connectionMethod: collector.manifest.providerClass === "mobile" ? "sdk-ingest" : connectionMethodForProvider(mode, params.provider, null),
        state: null,
        callbackUrl: null,
        sessionToken: mobileSession?.sessionToken ?? null,
        expiresAt: mobileSession?.expiresAt ?? null
      });
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.get("/v1/connect/callback/whoop", async (request, reply) => {
    const query = whoopRedirectCallbackQuerySchema.parse(request.query ?? {});
    try {
      if (query.error) {
        throw new Error(query.error_description ?? query.error);
      }
      if (!query.state) {
        throw new Error("WHOOP redirect callback is missing state.");
      }
      if (!query.code) {
        throw new Error("WHOOP redirect callback is missing code.");
      }
      const matched = await findWhoopSessionByState(query.state);
      if (!matched) {
        throw new Error("WHOOP redirect callback did not match an active session.");
      }
      return completeWhoopConnection({
        currentState: matched.currentState,
        session: matched.session,
        code: query.code,
        requestState: query.state
      });
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.get("/v1/connect/callback/oura", async (request, reply) => {
    const query = whoopRedirectCallbackQuerySchema.parse(request.query ?? {});
    try {
      if (query.error) {
        throw new Error(query.error_description ?? query.error);
      }
      if (!query.state) {
        throw new Error("Oura redirect callback is missing state.");
      }
      if (!query.code) {
        throw new Error("Oura redirect callback is missing code.");
      }
      const matched = await findOuraSessionByState(query.state);
      if (!matched) {
        throw new Error("Oura redirect callback did not match an active session.");
      }
      return completeOuraConnection({
        currentState: matched.currentState,
        session: matched.session,
        code: query.code,
        requestState: query.state
      });
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.post("/v1/users/:id/connect/:provider/callback", async (request, reply) => {
    const params = z.object({ id: z.string(), provider: ProviderIdSchema }).parse(request.params);
    const auth = await authorize(request, reply, { userId: params.id, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    const body = ConnectCallbackInputSchema.parse(request.body ?? {});
    try {
      const currentState = await store.loadState(params.id);
      if (mode === "live" && params.provider === "whoop") {
        const session = currentState.connectorSessions.find(
          (candidate) =>
            candidate.id === body.sessionId &&
            candidate.userId === params.id &&
            candidate.providerId === params.provider &&
            candidate.status === "active"
        );
        if (!session || new Date(session.expiresAt).getTime() < nowForApi().getTime()) {
          throw new Error("WHOOP connect session is invalid or expired. Start a fresh connect flow.");
        }
        return completeWhoopConnection({
          currentState,
          session,
          code: body.code,
          accessToken: body.accessToken,
          refreshToken: body.refreshToken,
          expiresAt: body.expiresAt,
          externalUserId: body.externalUserId,
          scopes: body.scopes,
          requestState: body.state
        });
      }
      if (mode === "live" && params.provider === "oura") {
        const session = currentState.connectorSessions.find(
          (candidate) =>
            candidate.id === body.sessionId &&
            candidate.userId === params.id &&
            candidate.providerId === params.provider &&
            candidate.status === "active"
        );
        if (!session || new Date(session.expiresAt).getTime() < nowForApi().getTime()) {
          throw new Error("Oura connect session is invalid or expired. Start a fresh connect flow.");
        }
        return completeOuraConnection({
          currentState,
          session,
          code: body.code,
          accessToken: body.accessToken,
          refreshToken: body.refreshToken,
          expiresAt: body.expiresAt,
          externalUserId: body.externalUserId,
          scopes: body.scopes,
          requestState: body.state
        });
      }
      const { collector } = resolveCollector(mode, params.provider);
      const exchanged = await collector.exchangeSession(body.sessionId);
      const nowIso = nowForApi().toISOString();
      const nextState = {
        ...currentState,
        sourceAccounts: currentState.sourceAccounts.map((sourceAccount) =>
          sourceAccount.providerId === params.provider
            ? {
                ...sourceAccount,
                status: "connected" as const,
                lastSyncAt: nowIso,
                syncFreshnessHours: 0
              }
            : sourceAccount
        )
      };
      await store.replaceState(nextState, { resetEventStream: false });
      const sourceAccount = nextState.sourceAccounts.find((candidate) => candidate.providerId === params.provider);
      const credential = providerCredentialPreview({
        providerId: params.provider,
        authState: "connected",
        connectionMethod: params.provider === "apple-health" || params.provider === "health-connect" ? "sdk-ingest" : connectionMethodForProvider(mode, params.provider, null),
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        expiresAt: null,
        scopes: [],
        externalUserId: sourceAccount?.externalUserId ?? null,
        lastRefreshAt: null,
        lastRefreshError: null,
        updatedAt: nowIso
      });
      return ConnectCallbackResponseSchema.parse({
        userId: params.id,
        providerId: params.provider,
        connected: true,
        accessTokenPreview: credential.accessTokenPreview,
        refreshTokenPreview: credential.refreshTokenPreview,
        credential
      });
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.post("/v1/users/:id/ingest/:provider", async (request, reply) => {
    const params = z.object({ id: z.string(), provider: ProviderIdSchema }).parse(request.params);
    const auth = await authorize(request, reply, { userId: params.id, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    const rawBody = request.body ?? {};
    try {
      const body = IngestBatchInputSchema.parse(rawBody);
      const currentState = await store.loadState(params.id);
      const ingestion = ingestMobileBatch(currentState, params.id, params.provider, body, nowForApi());
      const fanout = await persistStateAndFanout(ingestion.state, { allowedTypes: ingestAllowedTypes });
      return {
        ...ingestion.result,
        webhookDeliveries: fanout.deliveries,
        streamEvents: fanout.appendedEvents.length
      };
    } catch (error) {
      await store.saveIngestFailure(
        IngestFailureSchema.parse({
          id: `ingest_failure_${crypto.randomUUID()}`,
          userId: params.id,
          providerId: params.provider,
          reason: errorMessage(error),
          retryable: true,
          status: "failed",
          payload: {
            params,
            body: rawBody
          },
          createdAt: nowForApi().toISOString(),
          replayedAt: null
        })
      );
      return sendError(reply, 400, error);
    }
  });

  app.get("/v1/users/:id/sync-status", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const auth = await authorize(request, reply, { userId: params.id, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    try {
      return buildSyncStatusResponse(await store.loadState(params.id), params.id, nowForApi());
    } catch (error) {
      return sendError(reply, 404, error);
    }
  });

  app.put("/v1/users/:id/source-filters", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const auth = await authorize(request, reply, { userId: params.id, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    const input = sourceFilterUpsertSchema.parse(request.body ?? {});
    try {
      const updated = setSourceFilter(
        await store.loadState(params.id),
        params.id,
        input.providerId,
        { ignoredSources: input.ignoredSources },
        nowForApi()
      );
      await store.replaceState(updated.state, { resetEventStream: false });
      return updated.sourceFilter;
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.put("/v1/users/:id/source-precedence", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const auth = await authorize(request, reply, { userId: params.id, requiredScopes: ["write.preferences"] });
    if (!auth) {
      return;
    }
    const input = SourcePrecedenceInputSchema.parse(request.body ?? {});
    try {
      const updated = setSourcePrecedence(await store.loadState(params.id), params.id, input, nowForApi());
      await store.replaceState(updated.state, { resetEventStream: false });
      return updated.sourcePrecedenceOverride;
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.post("/v1/users/:id/sync", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const auth = await authorize(request, reply, { userId: params.id, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    const body = SyncRequestSchema.parse(request.body ?? {});

    try {
      const currentState = await store.loadState(params.id);
      const now = nowForApi();
      const syncResult =
        mode === "live"
          ? await (async () => {
              const liveSync = await collectLiveSyncPayloads(currentState, params.id, body.providerId, body.mode);
              if (Object.keys(liveSync.payloads).length === 0) {
                const refreshed = refreshDerivedState(liveSync.state, params.id, now);
                return {
                  state: refreshed.state,
                  syncedProviderIds: [],
                  outboxEvents: refreshed.outboxEvents,
                  staleGateApplied: refreshed.staleGateApplied
                };
              }
              return runIncrementalSyncWithPayloads(liveSync.state, params.id, liveSync.payloads, now);
            })()
          : runIncrementalSync(currentState, params.id, body.providerId, now);
      const fanout = await persistStateAndFanout(syncResult.state, { recordEmissionState: true });

      return {
        userId: params.id,
        providerId: body.providerId ?? "all",
        mode: body.mode,
        sourceAccounts: syncResult.state.sourceAccounts.length,
        outboxEvents: syncResult.outboxEvents,
        staleGateApplied: syncResult.staleGateApplied,
        webhookDeliveries: fanout.deliveries,
        streamEvents: fanout.appendedEvents.length
      };
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.post("/v1/users/:id/providers/whoop/webhook", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const whoopWebhookSecret = process.env.OPENVITALS_WHOOP_WEBHOOK_SECRET;
    const signature = request.headers["x-openvitals-whoop-signature"];
    const isAdmin = request.headers["x-openvitals-admin"] === adminToken;
    const isWebhookAuthorized = Boolean(typeof signature === "string" && whoopWebhookSecret && signature === whoopWebhookSecret);
    if (!isAdmin && !isWebhookAuthorized) {
      return reply.code(401).send({ message: "Missing or invalid WHOOP webhook signature." });
    }

    const payload = whoopWebhookInputSchema.parse(request.body ?? {});
    try {
      const currentState = await store.loadState(params.id);
      const now = nowForApi();
      const syncResult =
        mode === "live"
          ? await (async () => {
              const liveSync = await collectLiveSyncPayloads(currentState, params.id, "whoop", "incremental");
              if (Object.keys(liveSync.payloads).length === 0) {
                const refreshed = refreshDerivedState(liveSync.state, params.id, now);
                return {
                  state: refreshed.state,
                  syncedProviderIds: [],
                  outboxEvents: refreshed.outboxEvents,
                  staleGateApplied: refreshed.staleGateApplied
                };
              }
              return runIncrementalSyncWithPayloads(liveSync.state, params.id, liveSync.payloads, now);
            })()
          : runIncrementalSync(currentState, params.id, "whoop", now);
      const fanout = await persistStateAndFanout(syncResult.state, { recordEmissionState: true });
      return {
        received: true,
        userId: params.id,
        providerId: "whoop",
        eventType: payload.type ?? "unknown",
        eventId: payload.eventId ?? null,
        syncedProviderIds: syncResult.syncedProviderIds,
        outboxEvents: syncResult.outboxEvents,
        staleGateApplied: syncResult.staleGateApplied,
        webhookDeliveries: fanout.deliveries,
        streamEvents: fanout.appendedEvents.length
      };
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.get("/v1/timeline", async (request, reply) => {
    const query = TimelineQuerySchema.parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.raw"] });
    if (!auth) {
      return;
    }
    const state = await requireStateForUser(reply, query.userId);
    if (!state) {
      return;
    }
    return [...state.episodes, ...state.observations]
      .filter((entry) => entry.userId === query.userId)
      .sort((left, right) => (left.startAt > right.startAt ? -1 : 1))
      .slice(0, query.days * 12);
  });

  app.get("/v1/summaries/daily", async (request, reply) => {
    const query = DailySummariesQuerySchema.parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.derived"] });
    if (!auth) {
      return;
    }
    const state = await requireStateForUser(reply, query.userId);
    if (!state) {
      return;
    }
    return state.dailySummaries.filter((summary) => summary.userId === query.userId).slice(-query.days);
  });

  app.get("/v1/scores", async (request, reply) => {
    const query = ScoresQuerySchema.parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.derived"] });
    if (!auth) {
      return;
    }
    const state = await requireStateForUser(reply, query.userId);
    if (!state) {
      return;
    }
    return state.scores.filter((score) => score.userId === query.userId && (!query.kind || score.scoreKind === query.kind));
  });

  app.get("/v1/alerts", async (request, reply) => {
    const query = AlertsQuerySchema.parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.derived"] });
    if (!auth) {
      return;
    }
    const state = await requireStateForUser(reply, query.userId);
    if (!state) {
      return;
    }
    return state.alerts.filter((alert) => alert.userId === query.userId && (!query.status || alert.status === query.status));
  });

  app.post("/v1/alerts/:id/ack", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const targetAlert = await store.findAlertById(params.id);
    if (!targetAlert) {
      return reply.code(404).send({ message: "Unknown alert." });
    }
    const auth = await authorize(request, reply, { userId: targetAlert.userId, requiredScopes: ["send.nudges"] });
    if (!auth) {
      return;
    }
    const alert = await store.ackAlert(params.id);
    if (!alert) {
      return reply.code(404).send({ message: "Unknown alert." });
    }
    return alert;
  });

  app.get("/v1/explain/:entity/:id", async (request, reply) => {
    const params = z.object({
      entity: ExplainEntitySchema,
      id: z.string()
    }).parse(request.params);

    const requiredScope = params.entity === "observation" || params.entity === "episode" ? "read.raw" : "read.derived";
    const auth = await authorize(request, reply, { requiredScopes: [requiredScope] });
    if (!auth) {
      return;
    }
    const state = await requireStateForUser(reply, auth.userId);
    if (!state) {
      return;
    }
    const explanation = explainEntity(state, params.entity, params.id);
    if (!explanation) {
      return reply.code(404).send({ message: "Unknown entity." });
    }
    return ExplainResponseSchema.parse(explanation);
  });

  const explainDedupeByFingerprint = async (request: FastifyRequest, reply: FastifyReply, fingerprint: string) => {
    const auth = await authorize(request, reply, { requiredScopes: ["read.raw"] });
    if (!auth) {
      return;
    }
    const state = await requireStateForUser(reply, auth.userId);
    if (!state) {
      return;
    }
    const decision = explainDedupeDecision(state, fingerprint);
    if (!decision) {
      return reply.code(404).send({ message: "Unknown dedupe decision." });
    }
    return decision;
  };

  app.get("/v1/explain-dedupe/:fingerprint", async (request, reply) => {
    const params = z.object({ fingerprint: z.string() }).parse(request.params);
    return explainDedupeByFingerprint(request, reply, params.fingerprint);
  });

  app.get("/v1/explain-dedupe/*", async (request, reply) => {
    const params = z.object({ "*": z.string() }).parse(request.params);
    return explainDedupeByFingerprint(request, reply, decodeURIComponent(params["*"]));
  });

  app.get("/v1/export/omh", async (request, reply) => {
    const query = z.object({ userId: z.string() }).parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.raw"] });
    if (!auth) {
      return;
    }
    return toOmh(await store.loadState(query.userId));
  });

  app.get("/v1/export/fhir", async (request, reply) => {
    const query = z.object({ userId: z.string() }).parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.raw"] });
    if (!auth) {
      return;
    }
    return toFhirBundle(await store.loadState(query.userId));
  });

  app.get("/v1/webhooks", async (request, reply) => {
    const auth = await authorize(request, reply, { requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    return (await store.listWebhooks()).filter((hook) => !hook.userId || hook.userId === auth.userId);
  });

  app.post("/v1/webhooks", async (request, reply) => {
    const auth = await authorize(request, reply, { requiredScopes: ["send.nudges"] });
    if (!auth) {
      return;
    }
    const input = webhookInputSchema.parse(request.body);
    return store.saveWebhook(
      WebhookEndpointSchema.parse({
        id: `webhook_${crypto.randomUUID()}`,
        userId: auth.userId,
        url: input.url,
        secret: crypto.randomBytes(12).toString("hex"),
        status: input.status,
        eventTypes: input.eventTypes,
        createdAt: new Date().toISOString()
      })
    );
  });

  app.patch("/v1/webhooks/:id", async (request, reply) => {
    const auth = await authorize(request, reply, { requiredScopes: ["send.nudges"] });
    if (!auth) {
      return;
    }
    const params = z.object({ id: z.string() }).parse(request.params);
    const input = webhookInputSchema.partial().parse(request.body);
    const existing = (await store.listWebhooks()).find((hook) => hook.id === params.id);
    if (!existing || (existing.userId && existing.userId !== auth.userId)) {
      return reply.code(404).send({ message: "Unknown webhook." });
    }

    return store.saveWebhook(
      WebhookEndpointSchema.parse({
        ...existing,
        ...input
      })
    );
  });

  app.delete("/v1/webhooks/:id", async (request, reply) => {
    const auth = await authorize(request, reply, { requiredScopes: ["send.nudges"] });
    if (!auth) {
      return;
    }
    const params = z.object({ id: z.string() }).parse(request.params);
    const existing = (await store.listWebhooks()).find((hook) => hook.id === params.id);
    if (!existing || (existing.userId && existing.userId !== auth.userId)) {
      return reply.code(404).send({ message: "Unknown webhook." });
    }
    await store.deleteWebhook(params.id);
    return reply.code(204).send();
  });

  app.post("/v1/webhooks/:id/test", async (request, reply) => {
    const auth = await authorize(request, reply, { requiredScopes: ["send.nudges"] });
    if (!auth) {
      return;
    }
    const params = z.object({ id: z.string() }).parse(request.params);
    const hook = (await store.listWebhooks()).find((row) => row.id === params.id);
    if (!hook || (hook.userId && hook.userId !== auth.userId)) {
      return reply.code(404).send({ message: "Unknown webhook." });
    }

    const event = (await store.listOutboxEvents({ userId: auth.userId, limit: 1 }))[0] ?? null;
    return {
      webhook: hook.id,
      event
    };
  });

  app.post("/v1/goals", async (request, reply) => {
    const body = goalInputSchema.parse(request.body);
    const auth = await authorize(request, reply, { userId: body.userId, requiredScopes: ["write.goals"] });
    if (!auth) {
      return;
    }
    return store.saveGoal(body);
  });

  app.post("/v1/quiet-hours", async (request, reply) => {
    const input = quietHoursInputSchema.parse(request.body);
    const auth = await authorize(request, reply, { userId: input.userId, requiredScopes: ["write.preferences"] });
    if (!auth) {
      return;
    }
    return store.setQuietHours(input.userId, input.start, input.end);
  });

  app.get("/v1/events/stream", async (request, reply) => {
    const query = z
      .object({
        userId: z.string(),
        after: z.coerce.number().int().nonnegative().default(0)
      })
      .parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    const stateForPolicy = await requireStateForUser(reply, query.userId);
    if (!stateForPolicy) {
      return;
    }
    const deliveryPolicy = deliveryPolicyForUser(stateForPolicy, query.userId);
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders();

    let cursor = query.after;
    const writeEvent = (payload: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    for (const event of await store.listOutboxEvents({ afterSequence: cursor, userId: query.userId, limit: 500 })) {
      if (!shouldDeliverEvent(event.type, deliveryPolicy)) {
        continue;
      }
      writeEvent(event);
      cursor = Math.max(cursor, event.sequence);
    }

    const listener = (payload: unknown) => {
      const parsed = OutboxEventSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      const eventUserId = String((parsed.data.data as Record<string, unknown>).userId ?? parsed.data.subject);
      if (eventUserId !== query.userId || parsed.data.sequence <= cursor) {
        return;
      }
      if (!shouldDeliverEvent(parsed.data.type, deliveryPolicy)) {
        return;
      }
      writeEvent(parsed.data);
      cursor = parsed.data.sequence;
    };
    eventBus.on("outbox_event", listener);
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15000);

    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      eventBus.off("outbox_event", listener);
      reply.raw.end();
    });
  });

  app.get("/v1/experimental/outbox/events", async (request, reply) => {
    const query = z
      .object({
        userId: z.string(),
        after: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().positive().max(1000).default(200)
      })
      .parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    return await store.listOutboxEvents({ userId: query.userId, afterSequence: query.after, limit: query.limit });
  });

  app.get("/v1/experimental/webhook-deliveries", async (request, reply) => {
    const query = z
      .object({
        eventId: z.string().optional(),
        webhookId: z.string().optional()
      })
      .parse(request.query);
    const auth = await authorize(request, reply, { requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    return await store.listWebhookDeliveries(query);
  });

  app.get("/v1/experimental/scheduler/status", async (request, reply) => {
    const query = z.object({ userId: z.string() }).parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }

    const schedulerState = (await store.getSchedulerState(query.userId)) ?? defaultSchedulerState(query.userId, nowForApi());
    return {
      userId: query.userId,
      enabled: schedulerState.enabled,
      leader: schedulerState.leader,
      lastTickAt: schedulerState.lastTickAt,
      nextTickAt: schedulerState.nextTickAt,
      lastError: schedulerState.lastError,
      lastRunSummary: schedulerState.lastRunSummary
    };
  });

  app.post("/v1/experimental/scheduler/run", async (request, reply) => {
    const body = schedulerRunInputSchema.parse(request.body ?? {});

    if (body.userId) {
      const auth = await authorize(request, reply, { userId: body.userId, requiredScopes: ["read.sync"] });
      if (!auth) {
        return;
      }
    } else {
      const auth = await authorize(request, reply, {
        requiredScopes: ["admin.tokens"],
        allowAdminBypass: true
      });
      if (!auth) {
        return;
      }
    }

    const targetUserIds = body.userId ? [body.userId] : (await store.listUsers()).map((row) => row.id);
    const jobs = expandSchedulerJobs(body.job);
    const runs: SchedulerRunRecord[] = [];

    for (const userId of targetUserIds) {
      for (const job of jobs) {
        runs.push(await executeSchedulerJob({ userId, job, dryRun: body.dryRun }));
      }
    }

    return {
      dryRun: body.dryRun,
      runs
    };
  });

  app.get("/v1/experimental/scheduler/runs", async (request, reply) => {
    const query = z
      .object({
        userId: z.string().optional(),
        limit: z.coerce.number().int().positive().max(500).default(50)
      })
      .parse(request.query);

    if (query.userId) {
      const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.sync"] });
      if (!auth) {
        return;
      }
    } else {
      const auth = await authorize(request, reply, {
        requiredScopes: ["admin.tokens"],
        allowAdminBypass: true
      });
      if (!auth) {
        return;
      }
    }

    return await store.listSchedulerRuns({
      userId: query.userId,
      limit: query.limit
    });
  });

  app.get("/v1/experimental/ingest-failures", async (request, reply) => {
    const query = z
      .object({
        userId: z.string(),
        providerId: ProviderIdSchema.optional(),
        status: z.enum(["failed", "replayed", "discarded"]).optional()
      })
      .parse(request.query);
    const auth = await authorize(request, reply, { userId: query.userId, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }
    return await store.listIngestFailures(query);
  });

  app.post("/v1/experimental/ingest-failures/:id/replay", async (request, reply) => {
    const params = replayIngestFailureInputSchema.parse(request.params);
    const failure = (await store.listIngestFailures()).find((row) => row.id === params.id);
    if (!failure) {
      return reply.code(404).send({ message: "Unknown ingest failure." });
    }
    const auth = await authorize(request, reply, { userId: failure.userId, requiredScopes: ["read.sync"] });
    if (!auth) {
      return;
    }

    const payload = failure.payload as Record<string, unknown>;
    const body = IngestBatchInputSchema.parse(payload.body ?? {});
    try {
      const currentState = await store.loadState(failure.userId);
      const ingestion = ingestMobileBatch(currentState, failure.userId, failure.providerId, body, nowForApi());
      const fanout = await persistStateAndFanout(ingestion.state, { allowedTypes: ingestAllowedTypes });
      await store.markIngestFailureReplayed(failure.id);
      return {
        replayed: true,
        ingestResult: ingestion.result,
        webhookDeliveries: fanout.deliveries
      };
    } catch (error) {
      return sendError(reply, 400, error);
    }
  });

  app.get("/v1/experimental/agent-tokens", async (request, reply) => {
    const query = z.object({ userId: z.string().optional() }).parse(request.query);
    const auth = await authorize(request, reply, {
      userId: query.userId,
      requiredScopes: ["admin.tokens"],
      allowAdminBypass: true
    });
    if (!auth) {
      return;
    }
    return store.listAgentTokens({ userId: query.userId, includeRevoked: true });
  });

  app.post("/v1/experimental/agent-tokens", async (request, reply) => {
    const body = createAgentTokenInputSchema.parse(request.body);
    const auth = await authorize(request, reply, {
      userId: body.userId,
      requiredScopes: ["admin.tokens"],
      allowAdminBypass: true
    });
    if (!auth) {
      return;
    }
    const created = await store.createAgentToken(body);
    return {
      token: created.token,
      record: created.record
    };
  });

  app.post("/v1/experimental/agent-tokens/:id/revoke", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const auth = await authorize(request, reply, {
      requiredScopes: ["admin.tokens"],
      allowAdminBypass: true
    });
    if (!auth) {
      return;
    }
    const revoked = await store.revokeAgentToken(params.id);
    if (!revoked) {
      return reply.code(404).send({ message: "Unknown agent token." });
    }
    return revoked;
  });

  if (schedulerEnabled && schedulerLeader && mode === "live") {
    schedulerLoop = setInterval(() => {
      void runSchedulerSweep().catch(async (error) => {
        const users = await store.listUsers();
        const timestamp = new Date();
        for (const user of users) {
          const existing = (await store.getSchedulerState(user.id)) ?? defaultSchedulerState(user.id, timestamp);
          await store.upsertSchedulerState({
            ...existing,
            enabled: schedulerEnabled,
            leader: schedulerLeader,
            lastError: errorMessage(error),
            updatedAt: timestamp.toISOString()
          });
        }
      });
    }, schedulerLoopIntervalMs);
    void runSchedulerSweep();
  }

  app.addHook("onClose", async () => {
    if (schedulerLoop) {
      clearInterval(schedulerLoop);
      schedulerLoop = null;
    }
  });

  return { app, store, mode };
};
