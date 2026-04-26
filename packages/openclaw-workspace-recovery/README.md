# @openvitals/openclaw-workspace-recovery

Generates profile-scoped OpenClaw recovery workspaces for owner/family setups. Generated workspaces require agents to check `health.sync_status` semantics before coaching and to label stale, delayed, mirrored, or incomplete data honestly. Apple Health is described as an iPhone companion connector for normal HealthKit sync; the Watch app is optional and only required for live workout heart-rate.

## CLI

```bash
pnpm --filter @openvitals/openclaw-workspace-recovery exec openvitals-openclaw-workspace \
  --out-dir . \
  --api-base-url http://127.0.0.1:3000 \
  --timezone Asia/Shanghai \
  --webhook-secret local-dev-secret \
  --profile "user_owner|Owner|0 8 * * *|0 9 * * 0" \
  --profile "user_mom|Mom|0 8 * * *|0 9 * * 0"
```
