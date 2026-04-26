import type {
  AgentAccessPolicy,
  Alert,
  Automation,
  AutomationRun,
  CloudEvent,
  DailySummary,
  ProviderId,
  ProvenanceFields,
  Score,
  SourceAccount,
  SourceFilter,
  SyncAnchor,
  User,
  WorkflowKind
} from "@openvitals/contracts";
import {
  AlertSchema,
  AutomationRunSchema,
  AutomationSchema,
  CloudEventSchema,
  SourceFilterSchema,
  SyncAnchorSchema
} from "@openvitals/contracts";

export type WorkflowPipelineDeps = {
  iso: (date: Date) => string;
  buildProvenance: (
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
};

export const createPolicyDecision = (workflowKind: WorkflowKind, severity: Alert["severity"]): Alert["policyDecision"] => {
  if (workflowKind === "sync_stale_alert") {
    return { action: "deliver", reason: "Stale data must preempt coaching output." };
  }

  if (severity === "high") {
    return { action: "deliver", reason: "High-salience wellness alert; still advisory only." };
  }

  return { action: "deliver", reason: "Within quiet-hour and wellness policy constraints." };
};

export const deriveAutomations = (user: User, now: Date, deps: WorkflowPipelineDeps): Automation[] => [
  AutomationSchema.parse({
    id: "automation_morning_brief",
    userId: user.id,
    workflowKind: "morning_brief",
    schedule: "0 8 * * *",
    status: "active",
    quietHours: { start: "22:00", end: "07:00" },
    target: "openclaw.health.daily_brief",
    createdAt: deps.iso(now)
  }),
  AutomationSchema.parse({
    id: "automation_weekly_review",
    userId: user.id,
    workflowKind: "weekly_review",
    schedule: "0 9 * * 0",
    status: "active",
    quietHours: { start: "22:00", end: "07:00" },
    target: "openclaw.health.weekly_review",
    createdAt: deps.iso(now)
  })
];

export const deriveAlerts = (
  user: User,
  sourceAccounts: SourceAccount[],
  scores: Score[],
  dailySummaries: DailySummary[],
  now: Date,
  deps: WorkflowPipelineDeps
): Alert[] => {
  const recovery = scores.find((score) => score.scoreKind === "recovery_readiness");
  const sleep = scores.find((score) => score.scoreKind === "sleep_consistency");
  const staleSources = sourceAccounts.filter((account) => account.syncFreshnessHours >= 24);
  const sortedSummaries = [...dailySummaries].sort((left, right) => (left.day < right.day ? -1 : 1));
  const recent7 = sortedSummaries.slice(-7);
  const recent28 = sortedSummaries.slice(-28);
  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const recentLoad = avg(recent7.map((entry) => entry.summary.training_load ?? 0));
  const baselineLoad = avg(recent28.map((entry) => entry.summary.training_load ?? 0));
  const recentSleepHours = avg(recent7.map((entry) => entry.summary.sleep_hours ?? 0));
  const baselineSleepHours = avg(recent28.map((entry) => entry.summary.sleep_hours ?? 0));
  const loadDeltaPct = baselineLoad > 0 ? Math.round(((recentLoad - baselineLoad) / baselineLoad) * 100) : 0;
  const sleepDeltaHours = Math.round((recentSleepHours - baselineSleepHours) * 10) / 10;
  const alerts: Alert[] = [
    (() => {
      const provenance = deps.buildProvenance(
        "whoop",
        "derived:alert:morning_brief",
        user.timezone,
        "alert",
        "alert",
        2,
        0.86,
        "dedupe_alert_morning_brief",
        "derived",
        [],
        "Morning brief alert derived from the current score set."
      );
      const { confidence: _alertConfidence, ...alertProvenance } = provenance;

      return AlertSchema.parse({
        id: "alert_morning_brief",
        userId: user.id,
        workflowKind: "morning_brief",
        title: "Morning brief is ready",
        summary: `Recovery is ${recovery?.label ?? "unknown"} with sleep consistency at ${sleep?.value ?? 0}.`,
        severity: "info",
        status: "open",
        evidenceSet: [recovery?.id ?? "score_recovery_readiness", sleep?.id ?? "score_sleep_consistency"],
        confidence: 0.86,
        uncertaintyNote: "Brief is derived from the latest synced wearable records.",
        policyDecision: createPolicyDecision("morning_brief", "info"),
        deliveryTargets: ["dashboard", "openclaw", "sse"],
        createdAt: deps.iso(now),
        ...alertProvenance
      });
    })(),
    (() => {
      const provenance = deps.buildProvenance(
        "strava",
        "derived:alert:weekly_review",
        user.timezone,
        "alert",
        "alert",
        4,
        0.82,
        "dedupe_alert_weekly_review",
        "derived",
        [],
        "Weekly review alert derived from deduped load and recovery history."
      );
      const { confidence: _alertConfidence, ...alertProvenance } = provenance;

      return AlertSchema.parse({
        id: "alert_weekly_review",
        userId: user.id,
        workflowKind: "weekly_review",
        title: "Weekly review is ready",
        summary: `7d load avg ${Math.round(recentLoad)} vs 28d baseline ${Math.round(baselineLoad)} (${loadDeltaPct >= 0 ? "+" : ""}${loadDeltaPct}%), sleep delta ${sleepDeltaHours >= 0 ? "+" : ""}${sleepDeltaHours}h.`,
        severity: "info",
        status: "open",
        evidenceSet: scores.map((score) => score.id),
        confidence: 0.82,
        uncertaintyNote: "Weekly review compresses seven days of load and recovery context.",
        policyDecision: createPolicyDecision("weekly_review", "info"),
        deliveryTargets: ["dashboard", "openclaw", "webhook"],
        createdAt: deps.iso(now),
        ...alertProvenance
      });
    })()
  ];

  if (recovery && recovery.value < 55) {
    const provenance = deps.buildProvenance(
      "whoop",
      "derived:alert:recovery_low",
      user.timezone,
      "alert",
      "alert",
      1,
      0.92,
      "dedupe_alert_recovery_low",
      "derived",
      [],
      "Recovery alert is derived from the recovery_readiness score."
    );
    const { confidence: _alertConfidence, ...alertProvenance } = provenance;
    alerts.push(
      AlertSchema.parse({
        id: "alert_recovery_low",
        userId: user.id,
        workflowKind: "recovery_alert",
        title: "Recovery alert: low readiness",
        summary: "HRV is below baseline, resting heart rate is elevated, and sleep debt is building.",
        severity: "high",
        status: "open",
        evidenceSet: [recovery.id],
        confidence: 0.92,
        uncertaintyNote: recovery.uncertaintyNote,
        policyDecision: createPolicyDecision("recovery_alert", "high"),
        deliveryTargets: ["dashboard", "openclaw", "webhook", "sse"],
        createdAt: deps.iso(now),
        ...alertProvenance
      })
    );
  }

  if (staleSources.length > 0) {
    const primaryStaleSource = staleSources[0]!;
    const provenance = deps.buildProvenance(
      primaryStaleSource.providerId,
      "derived:alert:sync_stale",
      user.timezone,
      "alert",
      "alert",
      primaryStaleSource.syncFreshnessHours,
      0.99,
      "dedupe_alert_sync_stale",
      "derived",
      staleSources.slice(1).map((source) => source.providerId),
      "Sync stale alert is derived from connector freshness checks."
    );
    const { confidence: _alertConfidence, ...alertProvenance } = provenance;
    alerts.push(
      AlertSchema.parse({
        id: "alert_sync_stale",
        userId: user.id,
        workflowKind: "sync_stale_alert",
        title: "One or more sources are stale",
        summary: `Stale sources: ${staleSources.map((source) => source.providerId).join(", ")}.`,
        severity: "medium",
        status: "open",
        evidenceSet: staleSources.map((source) => source.id),
        confidence: 0.99,
        uncertaintyNote: "Stale data should block overconfident coaching conclusions.",
        policyDecision: createPolicyDecision("sync_stale_alert", "medium"),
        deliveryTargets: ["dashboard", "openclaw", "webhook", "sse"],
        createdAt: deps.iso(now),
        ...alertProvenance
      })
    );
  }

  return alerts;
};

export const deriveAutomationRuns = (
  user: User,
  alerts: Alert[],
  automations: Automation[],
  now: Date,
  deps: WorkflowPipelineDeps
): AutomationRun[] =>
  alerts.map((alert) =>
    AutomationRunSchema.parse({
      id: `run_${alert.workflowKind}`,
      automationId: automations.find((automation) => automation.workflowKind === alert.workflowKind)?.id ?? `system_${alert.workflowKind}`,
      userId: user.id,
      workflowKind: alert.workflowKind,
      status: alert.policyDecision.action === "deliver" ? "succeeded" : "suppressed",
      startedAt: deps.iso(new Date(now.getTime() - 2 * 60 * 1000)),
      completedAt: deps.iso(now),
      output: {
        alertId: alert.id,
        title: alert.title,
        deliveryTargets: alert.deliveryTargets,
        evidenceSet: alert.evidenceSet
      }
    })
  );

export const derivePolicies = (user: User, now: Date, deps: WorkflowPipelineDeps): AgentAccessPolicy[] => [
  {
    id: "policy_openclaw_health_agent",
    userId: user.id,
    agentId: "openclaw-health-agent",
    agentName: "OpenClaw Health Agent",
    scopes: ["read.sleep", "read.workouts", "read.activity", "read.derived", "send.nudges"],
    mode: "derived-only",
    createdAt: deps.iso(now)
  }
];

export const deriveSourceFilters = (user: User, now: Date, deps: WorkflowPipelineDeps): SourceFilter[] => [
  SourceFilterSchema.parse({
    id: "source_filter_apple-health",
    userId: user.id,
    providerId: "apple-health",
    ignoredSources: [],
    updatedAt: deps.iso(now)
  }),
  SourceFilterSchema.parse({
    id: "source_filter_health-connect",
    userId: user.id,
    providerId: "health-connect",
    ignoredSources: [],
    updatedAt: deps.iso(now)
  })
];

export const deriveSyncAnchors = (user: User, sourceAccounts: SourceAccount[]): SyncAnchor[] =>
  sourceAccounts.map((sourceAccount) =>
    SyncAnchorSchema.parse({
      id: `anchor_${sourceAccount.providerId}`,
      userId: user.id,
      providerId: sourceAccount.providerId,
      anchor: null,
      checkpointedAt: sourceAccount.lastSyncAt,
      lastError: null
    })
  );

export const deriveAuditLogs = (
  user: User,
  policies: AgentAccessPolicy[],
  alerts: Alert[],
  now: Date,
  deps: WorkflowPipelineDeps
): {
  id: string;
  actorType: "system";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  scope: string;
  createdAt: string;
  details: Record<string, unknown>;
}[] => [
  {
    id: "audit_seed_demo",
    actorType: "system",
    actorId: "openvitals",
    action: "seed.demo_state",
    entityType: "user",
    entityId: user.id,
    scope: "system.seed",
    createdAt: deps.iso(now),
    details: { reason: "pnpm demo bootstrap" }
  },
  ...policies.map((policy) => ({
    id: `audit_policy_${policy.id}`,
    actorType: "system" as const,
    actorId: "openvitals",
    action: "policy.grant",
    entityType: "agent_access_policy",
    entityId: policy.id,
    scope: "agent.policy",
    createdAt: deps.iso(now),
    details: { agentName: policy.agentName, scopes: policy.scopes }
  })),
  ...alerts.map((alert) => ({
    id: `audit_alert_${alert.id}`,
    actorType: "system" as const,
    actorId: "openvitals",
    action: "alert.emit",
    entityType: "alert",
    entityId: alert.id,
    scope: alert.workflowKind,
    createdAt: deps.iso(now),
    details: { title: alert.title, status: alert.status }
  }))
];

export const deriveOutbox = (user: User, alerts: Alert[], scores: Score[], now: Date, deps: WorkflowPipelineDeps): CloudEvent[] => {
  const events: CloudEvent[] = [];
  const nonce = now.getTime();

  events.push(
    CloudEventSchema.parse({
      specversion: "1.0",
      id: `event_sync_completed_${nonce}`,
      source: "openvitals",
      type: "health.sync.completed",
      subject: user.id,
      time: deps.iso(now),
      datacontenttype: "application/json",
      data: {
        userId: user.id,
        connectors: ["apple-health", "health-connect", "whoop", "oura", "garmin", "strava"]
      }
    })
  );

  for (const score of scores) {
      events.push(
        CloudEventSchema.parse({
          specversion: "1.0",
          id: `event_score_${score.scoreKind}_${nonce}`,
          source: "openvitals",
        type: "health.score.updated",
        subject: score.id,
        time: deps.iso(now),
        datacontenttype: "application/json",
        data: {
          userId: score.userId,
          scoreKind: score.scoreKind,
          value: score.value,
          label: score.label
        }
      })
    );
  }

  for (const alert of alerts) {
    const type =
      alert.workflowKind === "sync_stale_alert"
        ? "health.sync.stale"
        : alert.workflowKind === "weekly_review"
          ? "health.review.weekly.ready"
          : alert.workflowKind === "morning_brief"
            ? "health.brief.daily.ready"
          : alert.workflowKind === "recovery_alert"
            ? "health.alert.recovery.low"
            : "health.sync.completed";

    events.push(
      CloudEventSchema.parse({
        specversion: "1.0",
        id: `event_alert_${alert.workflowKind}_${nonce}`,
        source: "openvitals",
        type,
        subject: alert.id,
        time: deps.iso(now),
        datacontenttype: "application/json",
        data: {
          userId: alert.userId,
          workflowKind: alert.workflowKind,
          alertId: alert.id,
          title: alert.title,
          severity: alert.severity,
          deliveryTargets: alert.deliveryTargets,
          staleSources: alert.workflowKind === "sync_stale_alert" ? [...alert.evidenceSet].sort() : []
        }
      })
    );
  }

  return events;
};
