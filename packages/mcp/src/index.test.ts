import { MCP_TOOLS } from "./index.js";

describe("mcp", () => {
  it("exposes all planned tool surfaces", () => {
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([
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
    ]);
  });

  it("labels Apple Health companion and optional Watch semantics in agent-facing tools", () => {
    const syncStatusTool = MCP_TOOLS.find((tool) => tool.name === "health.sync_status");
    const syncNowTool = MCP_TOOLS.find((tool) => tool.name === "health.sync_now");

    expect(syncStatusTool?.description).toContain("Apple Health uses the iPhone app");
    expect(syncStatusTool?.description).toContain("Watch is optional for live workout HR only");
    expect(syncNowTool?.description).toContain("iPhone companion sync path");
  });
});
