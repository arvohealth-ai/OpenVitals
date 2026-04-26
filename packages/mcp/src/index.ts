import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OpenVitalsClient, summarizeExplanationSemantics, summarizeSyncStatusSemantics } from "@openvitals/sdk-ts";
import { MCP_TOOLS } from "./tools.js";

export { MCP_TOOLS } from "./tools.js";

const jsonResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  structuredContent: {
    result: payload
  }
});

const summarizeSyncMetadata = (syncStatus: Awaited<ReturnType<OpenVitalsClient["syncStatus"]>>) => {
  const semantics = summarizeSyncStatusSemantics(syncStatus);
  const semanticsByProvider = new Map(semantics.sources.map((source) => [source.providerId, source]));
  const liveSources = syncStatus.sources.filter((source) => source.dataMode === "live");
  const lastRealSyncAt = liveSources
    .map((source) => source.lastSyncAt)
    .sort((left, right) => (left < right ? 1 : -1))[0] ?? null;
  const anchorAgeHours =
    lastRealSyncAt === null ? null : Math.max(Math.round(((Date.now() - new Date(lastRealSyncAt).getTime()) / (60 * 60 * 1000)) * 10) / 10, 0);
  const missingSignals = syncStatus.sources
    .filter((source) => source.dataQualityGate !== "ok")
    .map((source) => source.providerId);

  return {
    lastRealSyncAt,
    anchorAgeHours,
    missingSignals,
    dataModes: syncStatus.sources.map((source) => ({
      providerId: source.providerId,
      dataMode: source.dataMode,
      connectionMethod: source.connectionMethod,
      connectionMode: semanticsByProvider.get(source.providerId)?.connectionMode ?? source.connectionMode,
      qualityGate: source.dataQualityGate,
      dataGranularity: semanticsByProvider.get(source.providerId)?.dataGranularity ?? "provider_payload",
      latencyClass: semanticsByProvider.get(source.providerId)?.latencyClass ?? "delayed_sync",
      companionRole: semanticsByProvider.get(source.providerId)?.companionRole ?? "mock_or_demo",
      liveSignalCapable: semanticsByProvider.get(source.providerId)?.liveSignalCapable ?? false,
      liveSignalActive: semanticsByProvider.get(source.providerId)?.liveSignalActive ?? false
    })),
    companion: {
      iphoneCompanionRequired: semantics.iphoneCompanionRequired,
      watchAppRequiredForHistoricalSync: semantics.watchAppRequiredForHistoricalSync,
      watchAppRequiredForLiveWorkoutHr: semantics.watchAppRequiredForLiveWorkoutHr,
      liveSignalProviders: semantics.liveSignalProviders,
      liveSignalCapableProviders: semantics.liveSignalCapableProviders,
      guidance:
        "Apple Health normal sync requires the iPhone companion. Historical Apple Watch samples arrive through HealthKit on iPhone; only optional Watch workout mode may be called live."
    }
  };
};

const isDataQualityBlocked = (metadata: ReturnType<typeof summarizeSyncMetadata>): boolean => metadata.missingSignals.length > 0;

export const createHealthMcpServer = (apiBaseUrl = process.env.OPENVITALS_API_URL ?? "http://127.0.0.1:3000") => {
  const client = new OpenVitalsClient(apiBaseUrl, {
    agentToken: process.env.OPENVITALS_AGENT_TOKEN ?? "ov_demo_user_ada_derived"
  });
  const server = new McpServer({
    name: "openvitals",
    version: "0.3.0"
  });
  type ToolName = (typeof MCP_TOOLS)[number]["name"];
  type ToolByName<N extends ToolName> = Extract<(typeof MCP_TOOLS)[number], { name: N }>;
  const getTool = <N extends ToolName>(name: N): ToolByName<N> => {
    const tool = MCP_TOOLS.find((candidate): candidate is ToolByName<N> => candidate.name === name);
    if (!tool) {
      throw new Error(`Missing MCP tool definition: ${name}`);
    }
    return tool;
  };

  const dailyBriefTool = getTool("health.daily_brief");
  server.registerTool(dailyBriefTool.name, dailyBriefTool, async ({ userId }) => {
    const [alerts, scores, sync] = await Promise.all([
      client.alerts({ userId, status: "open" }),
      client.scores({ userId }),
      client.syncStatus(userId)
    ]);
    const syncMetadata = summarizeSyncMetadata(sync);
    const dataQuality = summarizeSyncStatusSemantics(sync);
    const blocked = !dataQuality.gateOpen || isDataQualityBlocked(syncMetadata);
    return jsonResult({
      alert: alerts.find((alert) => alert.workflowKind === "morning_brief") ?? null,
      recovery: scores.find((score) => score.scoreKind === "recovery_readiness") ?? null,
      sleep: scores.find((score) => score.scoreKind === "sleep_consistency") ?? null,
      sync: {
        ...syncMetadata,
        dataQuality
      },
      dataQuality,
      gated: blocked,
      gateReason: blocked ? dataQuality.gateReason ?? "stale_or_missing_data" : null
    });
  });

  const weeklyReviewTool = getTool("health.weekly_review");
  server.registerTool(weeklyReviewTool.name, weeklyReviewTool, async ({ userId }) => {
    const [alerts, scores, sync] = await Promise.all([client.alerts({ userId, status: "open" }), client.scores({ userId }), client.syncStatus(userId)]);
    const syncMetadata = summarizeSyncMetadata(sync);
    const dataQuality = summarizeSyncStatusSemantics(sync);
    const blocked = !dataQuality.gateOpen || isDataQualityBlocked(syncMetadata);
    return jsonResult({
      alert: alerts.find((alert) => alert.workflowKind === "weekly_review") ?? null,
      scores,
      sync: {
        ...syncMetadata,
        dataQuality
      },
      dataQuality,
      gated: blocked,
      gateReason: blocked ? dataQuality.gateReason ?? "stale_or_missing_data" : null
    });
  });

  const recoveryStatusTool = getTool("health.recovery_status");
  server.registerTool(recoveryStatusTool.name, recoveryStatusTool, async ({ userId }) => {
    const [alerts, scores, sync] = await Promise.all([
      client.alerts({ userId }),
      client.scores({ userId, kind: "recovery_readiness" }),
      client.syncStatus(userId)
    ]);
    const syncMetadata = summarizeSyncMetadata(sync);
    const dataQuality = summarizeSyncStatusSemantics(sync);
    const blocked = !dataQuality.gateOpen || isDataQualityBlocked(syncMetadata);
    return jsonResult({
      recovery: scores[0] ?? null,
      alert: alerts.find((alert) => alert.workflowKind === "recovery_alert") ?? null,
      sync: {
        ...syncMetadata,
        dataQuality
      },
      dataQuality,
      gated: blocked,
      gateReason: blocked ? dataQuality.gateReason ?? "stale_or_missing_data" : null
    });
  });

  const comparePeriodsTool = getTool("health.compare_periods");
  server.registerTool(comparePeriodsTool.name, comparePeriodsTool, async ({ userId, days }) => {
    const summaries = await client.dailySummaries({ userId, days: Math.max(days, 7) });
    const recent = summaries.slice(-days);
    const prior = summaries.slice(-days * 2, -days);
    const aggregate = (items: typeof recent) => ({
      sleep_hours: items.reduce((sum, item) => sum + (item.summary.sleep_hours ?? 0), 0),
      training_load: items.reduce((sum, item) => sum + (item.summary.training_load ?? 0), 0),
      steps: items.reduce((sum, item) => sum + (item.summary.steps ?? 0), 0)
    });

    return jsonResult({
      recent: aggregate(recent),
      prior: aggregate(prior),
      days
    });
  });

  const explainScoreTool = getTool("health.explain_score");
  server.registerTool(explainScoreTool.name, explainScoreTool, async ({ scoreId }) => {
    const explanation = await client.explain("score", scoreId);
    return jsonResult({
      ...explanation,
      semantics: summarizeExplanationSemantics(explanation)
    });
  });

  const explainDedupeTool = getTool("health.explain_dedupe");
  server.registerTool(explainDedupeTool.name, explainDedupeTool, async ({ fingerprint }) => {
    return jsonResult(await client.explainDedupe(fingerprint));
  });

  const listProfilesTool = getTool("health.list_profiles");
  server.registerTool(listProfilesTool.name, listProfilesTool, async () => {
    return jsonResult(await client.users());
  });

  const syncNowTool = getTool("health.sync_now");
  server.registerTool(syncNowTool.name, syncNowTool, async ({ userId, providerId, mode }) => {
    return jsonResult(await client.syncUser(userId, { providerId, mode }));
  });

  const listAlertsTool = getTool("health.list_alerts");
  server.registerTool(listAlertsTool.name, listAlertsTool, async ({ userId, status }) => {
    return jsonResult(await client.alerts({ userId, status }));
  });

  const ackAlertTool = getTool("health.ack_alert");
  server.registerTool(ackAlertTool.name, ackAlertTool, async ({ alertId }) => {
    return jsonResult(await client.ackAlert(alertId));
  });

  const syncStatusTool = getTool("health.sync_status");
  server.registerTool(syncStatusTool.name, syncStatusTool, async ({ userId }) => {
    const sync = await client.syncStatus(userId);
    return jsonResult({
      ...sync,
      metadata: summarizeSyncMetadata(sync),
      semantics: summarizeSyncStatusSemantics(sync)
    });
  });

  const setGoalTool = getTool("health.set_goal");
  server.registerTool(setGoalTool.name, setGoalTool, async ({ userId, name, target }) => {
    return jsonResult(await client.setGoal({ userId, name, target }));
  });

  const setQuietHoursTool = getTool("health.set_quiet_hours");
  server.registerTool(setQuietHoursTool.name, setQuietHoursTool, async ({ userId, start, end }) => {
    return jsonResult(await client.setQuietHours({ userId, start, end }));
  });

  const experimentalOutboxTool = getTool("health.experimental.outbox_events");
  server.registerTool(experimentalOutboxTool.name, experimentalOutboxTool, async ({ userId, after, limit }) => {
    return jsonResult(await client.outboxEvents({ userId, after, limit }));
  });

  const experimentalWebhookTool = getTool("health.experimental.webhook_deliveries");
  server.registerTool(experimentalWebhookTool.name, experimentalWebhookTool, async ({ eventId, webhookId }) => {
    return jsonResult(await client.webhookDeliveries({ eventId, webhookId }));
  });

  return server;
};
