type OpenClawFile = {
  path: string;
  content: string;
};

export type OpenClawSkillOptions = {
  apiBaseUrl: string;
  userId: string;
  timezone: string;
  dailyCron: string;
  weeklyCron: string;
  webhookSecret: string;
};

const defaults: OpenClawSkillOptions = {
  apiBaseUrl: "http://127.0.0.1:3000",
  userId: "user_ada",
  timezone: "Asia/Shanghai",
  dailyCron: "0 8 * * *",
  weeklyCron: "0 9 * * 0",
  webhookSecret: "replace-me"
};

export const createOpenClawSkillFiles = (input: string | Partial<OpenClawSkillOptions>): OpenClawFile[] => {
  const options = typeof input === "string" ? { ...defaults, apiBaseUrl: input } : { ...defaults, ...input };
  return [
  {
    path: "skills/openvitals/SKILL.md",
    content: `# OpenVitals Skill

Use OpenVitals for daily health summaries, recovery checks, weekly reviews, score explanations, and alert acknowledgements.

Freshness gate:
- Always check health.sync_status before coaching.
- Inspect dataQuality/semantics for dataGranularity, latencyClass, freshnessHours, staleProviders, missingProviders, and liveSignalProviders.
- If any source is stale or missing, prompt for sync first and avoid high-confidence guidance.
- Describe Apple Health as the required iPhone companion connector for HealthKit authorization, historical sync, background/incremental sync, and manual Sync Now.
- Explain that historical Apple Watch samples arrive through Apple Health after syncing to the iPhone; the Watch app is optional unless the user wants live workout heart-rate.
- Describe Health Connect as mobile platform samples unless liveSignalProviders explicitly shows live_signal.
- Describe Oura/WHOOP/Garmin/Strava as delayed provider-mediated payloads, not continuous raw sensor streams.
- Do not say "real-time monitoring" unless liveSignalProviders includes Apple Health from explicit optional Apple Watch workout mode.
- Use health.explain_score semantics to call out mirrored or suppressed sources.

API base URL: ${options.apiBaseUrl}
Default user: ${options.userId}
Timezone: ${options.timezone}

Available actions:
- health.daily_brief
- health.weekly_review
- health.recovery_status
- health.compare_periods
- health.explain_score
- health.explain_dedupe
- health.list_alerts
- health.ack_alert
- health.sync_status
- health.set_goal
- health.set_quiet_hours
`
  },
  {
    path: "HEARTBEAT.md",
    content: `# HEARTBEAT

Every morning, call health.daily_brief for ${options.userId}.
Every Sunday, call health.weekly_review for ${options.userId}.
Honor timezone ${options.timezone}.
Always run health.sync_status before delivering coaching advice.
Read dataQuality/semantics before making claims about recency, granularity, or live status.
If data is stale or missing, ask for sync and defer recommendations.
For Apple Health, direct the user to the iPhone companion for normal sync and Sync Now.
Do not require the Watch app for historical Apple Health data; historical Watch samples arrive through HealthKit on iPhone.
Treat Oura/WHOOP cloud data as delayed provider payloads; do not call them live raw streams.
Use "real-time" only when liveSignalProviders includes Apple Health from an explicit optional Watch workout/live_signal source.
Escalate recovery.low and sync.stale events immediately.
`
  },
  {
    path: "automation/cron-daily.json",
    content: JSON.stringify(
      {
        name: "health-daily-brief",
        schedule: options.dailyCron,
        timezone: options.timezone,
        tool: "health.daily_brief",
        args: { userId: options.userId }
      },
      null,
      2
    )
  },
  {
    path: "automation/cron-weekly.json",
    content: JSON.stringify(
      {
        name: "health-weekly-review",
        schedule: options.weeklyCron,
        timezone: options.timezone,
        tool: "health.weekly_review",
        args: { userId: options.userId }
      },
      null,
      2
    )
  },
  {
    path: "hooks/recovery.low.json",
    content: JSON.stringify(
      {
        event: "health.alert.recovery.low",
        routeTo: "openclaw-health-agent",
        secret: options.webhookSecret
      },
      null,
      2
    )
  },
  {
    path: "hooks/sync.stale.json",
    content: JSON.stringify(
      {
        event: "health.sync.stale",
        routeTo: "openclaw-health-agent",
        secret: options.webhookSecret
      },
      null,
      2
    )
  }
];
};
