type WorkspaceProfile = {
  userId: string;
  name: string;
  dailyCron?: string;
  weeklyCron?: string;
};

type OutputFile = {
  path: string;
  content: string;
};

export type OpenClawRecoveryWorkspaceOptions = {
  apiBaseUrl: string;
  timezone: string;
  webhookSecret: string;
  profiles: WorkspaceProfile[];
};

const defaultDailyCron = "0 8 * * *";
const defaultWeeklyCron = "0 9 * * 0";

const createProfileFiles = (profile: WorkspaceProfile, options: OpenClawRecoveryWorkspaceOptions): OutputFile[] => {
  const basePath = `workspaces/health-recovery/${profile.userId}`;
  const dailyCron = profile.dailyCron ?? defaultDailyCron;
  const weeklyCron = profile.weeklyCron ?? defaultWeeklyCron;

  return [
    {
      path: `${basePath}/SKILL.md`,
      content: `# ${profile.name} Health Recovery Workspace

User: ${profile.userId}
API: ${options.apiBaseUrl}
Timezone: ${options.timezone}

Rules:
- Always call health.sync_status first.
- Inspect dataQuality/semantics for dataGranularity, latencyClass, freshnessHours, staleProviders, missingProviders, and liveSignalProviders.
- If dataQualityGate is stale/missing or semantics.gateOpen is false, defer high-confidence coaching.
- Say when data is stale, delayed, mirrored/suppressed, or incomplete.
- Treat Apple Health as the required iPhone companion connector for HealthKit authorization, historical sync, background/incremental sync, and manual Sync Now.
- Do not require the Watch app for historical Apple Health data; historical Watch samples arrive through HealthKit on iPhone.
- Require optional Watch workout mode only for live workout heart-rate and only when liveSignalProviders includes Apple Health live_signal.
- Treat Oura/WHOOP/Garmin/Strava cloud data as delayed provider-mediated payloads, not continuous raw sensor streams.
- Use "real-time monitoring" only when liveSignalProviders includes Apple Health from an explicit live workout/live_signal source.
- Escalate health.alert.recovery.low and health.sync.stale immediately.

Primary actions:
- health.daily_brief
- health.weekly_review
- health.recovery_status
- health.explain_score
- health.list_alerts
- health.ack_alert
- health.set_goal
- health.set_quiet_hours
`
    },
    {
      path: `${basePath}/automation/cron-daily.json`,
      content: JSON.stringify(
        {
          name: `health-daily-brief-${profile.userId}`,
          schedule: dailyCron,
          timezone: options.timezone,
          tool: "health.daily_brief",
          args: {
            userId: profile.userId
          }
        },
        null,
        2
      )
    },
    {
      path: `${basePath}/automation/cron-weekly.json`,
      content: JSON.stringify(
        {
          name: `health-weekly-review-${profile.userId}`,
          schedule: weeklyCron,
          timezone: options.timezone,
          tool: "health.weekly_review",
          args: {
            userId: profile.userId
          }
        },
        null,
        2
      )
    },
    {
      path: `${basePath}/hooks/recovery.low.json`,
      content: JSON.stringify(
        {
          event: "health.alert.recovery.low",
          routeTo: `openclaw-health-agent-${profile.userId}`,
          secret: options.webhookSecret
        },
        null,
        2
      )
    },
    {
      path: `${basePath}/hooks/sync.stale.json`,
      content: JSON.stringify(
        {
          event: "health.sync.stale",
          routeTo: `openclaw-health-agent-${profile.userId}`,
          secret: options.webhookSecret
        },
        null,
        2
      )
    }
  ];
};

export const createOpenClawRecoveryWorkspaceFiles = (options: OpenClawRecoveryWorkspaceOptions): OutputFile[] => {
  const profiles = options.profiles.length > 0 ? options.profiles : [{ userId: "user_ada", name: "Ada Athlete" }];
  const files: OutputFile[] = [
    {
      path: "workspaces/health-recovery/README.md",
      content: `# OpenVitals OpenClaw Recovery Workspace

Generated family workspace for proactive recovery monitoring. Agents must surface freshness, granularity, Apple Health iPhone-companion requirements, optional Watch live-workout status, and stale/missing caveats before giving coaching advice.

API Base URL: ${options.apiBaseUrl}
Timezone: ${options.timezone}

Profiles:
${profiles.map((profile) => `- ${profile.name} (${profile.userId})`).join("\n")}
`
    }
  ];

  for (const profile of profiles) {
    files.push(...createProfileFiles(profile, options));
  }
  return files;
};
