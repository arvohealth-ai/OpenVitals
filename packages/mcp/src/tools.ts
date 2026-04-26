import { z } from "zod";

export const MCP_TOOLS = [
  {
    name: "health.daily_brief",
    title: "Daily Brief",
    description: "Return the latest morning brief alert, recovery summary, and data-quality freshness/granularity semantics including iPhone companion and optional Watch live-mode caveats.",
    inputSchema: {
      userId: z.string()
    }
  },
  {
    name: "health.weekly_review",
    title: "Weekly Review",
    description: "Return the latest weekly review alert, score snapshot, and source freshness/granularity semantics including delayed platform-sync caveats.",
    inputSchema: {
      userId: z.string()
    }
  },
  {
    name: "health.recovery_status",
    title: "Recovery Status",
    description: "Return the recovery_readiness score, supporting alerts, and source freshness/granularity semantics before making coaching claims.",
    inputSchema: {
      userId: z.string()
    }
  },
  {
    name: "health.compare_periods",
    title: "Compare Periods",
    description: "Compare daily summaries over two windows.",
    inputSchema: {
      userId: z.string(),
      days: z.number().int().positive().default(7)
    }
  },
  {
    name: "health.explain_score",
    title: "Explain Score",
    description: "Explain a score's provenance, evidence, freshness, granularity, and mirrored/stale caveats.",
    inputSchema: {
      scoreId: z.string()
    }
  },
  {
    name: "health.explain_dedupe",
    title: "Explain Dedupe",
    description: "Explain a dedupe decision by fingerprint or decision id.",
    inputSchema: {
      fingerprint: z.string()
    }
  },
  {
    name: "health.list_profiles",
    title: "List Profiles",
    description: "List accessible health profiles for the current agent token.",
    inputSchema: {}
  },
  {
    name: "health.sync_now",
    title: "Sync Now",
    description: "Trigger an on-demand sync for a profile; for Apple Health this means prompting the iPhone companion sync path, not forcing a Watch live stream.",
    inputSchema: {
      userId: z.string(),
      providerId: z.enum(["apple-health", "health-connect", "oura", "whoop", "garmin", "strava"]).optional(),
      mode: z.enum(["history", "incremental"]).default("incremental")
    }
  },
  {
    name: "health.list_alerts",
    title: "List Alerts",
    description: "List open or acked alerts for a user.",
    inputSchema: {
      userId: z.string(),
      status: z.enum(["open", "acked"]).optional()
    }
  },
  {
    name: "health.ack_alert",
    title: "Acknowledge Alert",
    description: "Mark an alert as acknowledged.",
    inputSchema: {
      alertId: z.string()
    }
  },
  {
    name: "health.sync_status",
    title: "Sync Status",
    description: "Return connector freshness, granularity, latency class, anchor, error status, and companion semantics: Apple Health uses the iPhone app; Watch is optional for live workout HR only.",
    inputSchema: {
      userId: z.string()
    }
  },
  {
    name: "health.set_goal",
    title: "Set Goal",
    description: "Create or update a lightweight wellness goal.",
    inputSchema: {
      userId: z.string(),
      name: z.string(),
      target: z.string()
    }
  },
  {
    name: "health.set_quiet_hours",
    title: "Set Quiet Hours",
    description: "Update quiet hours for a user's automations.",
    inputSchema: {
      userId: z.string(),
      start: z.string(),
      end: z.string()
    }
  },
  {
    name: "health.experimental.outbox_events",
    title: "Outbox Events (Experimental)",
    description: "List append-only outbox events using sequence cursors.",
    inputSchema: {
      userId: z.string(),
      after: z.number().int().nonnegative().default(0),
      limit: z.number().int().positive().max(1000).default(200)
    }
  },
  {
    name: "health.experimental.webhook_deliveries",
    title: "Webhook Deliveries (Experimental)",
    description: "List webhook delivery attempts and retry traces.",
    inputSchema: {
      eventId: z.string().optional(),
      webhookId: z.string().optional()
    }
  }
] as const;
