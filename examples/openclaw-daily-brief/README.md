# OpenClaw Daily Brief Example

This example shows how to point an OpenClaw workspace at the v0.5 live wedge instead of the old demo-only path.

## Flow

1. Start OpenVitals in live mode and bootstrap one profile.
2. Finish WHOOP connect for that profile and confirm `authState == connected`.
3. Run at least one Apple Health ingest batch from the iOS collector reference.
4. Generate OpenClaw assets with:

```bash
pnpm --filter @openvitals/openclaw-skill exec openvitals-openclaw-init \
  --out-dir . \
  --api-base-url http://127.0.0.1:3000 \
  --user-id user_live \
  --timezone Asia/Shanghai \
  --daily-cron "0 8 * * *" \
  --weekly-cron "0 9 * * 0" \
  --webhook-secret local-dev-secret
```
5. Call `health.sync_status` before coaching outputs, then call `health.daily_brief` on schedule and forward `health.alert.recovery.low` / `health.sync.stale`.

## Live gating rules

- If `health.sync_status` reports any key source as `stale` or `missing`, do not emit high-confidence coaching output.
- WHOOP direct data is preferred over mirrored WHOOP samples from Apple Health.
- Use the live derived token for this profile. Do not reuse another family member's token.

## Suggested Files

- `skills/openvitals/SKILL.md`
- `automation/cron-daily.json`
- `automation/cron-weekly.json`
- `hooks/recovery.low.json`
- `hooks/sync.stale.json`
