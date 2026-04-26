# Claude MCP Recovery Example

Run the local API, then point a Claude-compatible MCP client to:

```json
{
  "mcpServers": {
    "openvitals": {
      "command": "pnpm",
      "args": ["--filter", "@openvitals/mcp", "exec", "openvitals-mcp"],
      "env": {
        "OPENVITALS_API_URL": "http://127.0.0.1:3000",
        "OPENVITALS_AGENT_TOKEN": "ov_demo_user_ada_derived"
      }
    }
  }
}
```

Suggested prompts:

- `Check my recovery status for user_ada`
- `Explain score score_recovery_readiness`
- `List open alerts for user_ada`
