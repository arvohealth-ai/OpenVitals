# OpenClaw Family Recovery Workspace

This example bootstraps one owner and multiple family profiles, then wires OpenClaw automation/hooks per profile in the v0.5 live wedge.

## 1) Bootstrap household profiles

```bash
curl -X POST "http://127.0.0.1:3000/v1/household/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{
    "owner": {"userId": "user_owner", "name": "Owner", "timezone": "Asia/Shanghai"},
    "family": [
      {"userId": "user_mom", "name": "Mom", "timezone": "Asia/Shanghai"},
      {"userId": "user_dad", "name": "Dad", "timezone": "Asia/Shanghai"}
    ],
    "createTokens": true
  }'
```

## 2) Generate OpenClaw assets per profile

```bash
pnpm --filter @openvitals/openclaw-workspace-recovery exec openvitals-openclaw-workspace \
  --out-dir . \
  --api-base-url http://127.0.0.1:3000 \
  --timezone Asia/Shanghai \
  --webhook-secret family-local-secret \
  --profile "user_owner|Owner|0 8 * * *|0 9 * * 0" \
  --profile "user_mom|Mom|0 8 * * *|0 9 * * 0" \
  --profile "user_dad|Dad|0 8 * * *|0 9 * * 0"
```

## 3) Runtime policy in OpenClaw

- Always call `health.sync_status` before any coaching output.
- If any source is stale, ask for sync first and skip high-confidence recommendations.
- Route `health.alert.recovery.low` and `health.sync.stale` to the profile-specific health agent.
- Keep WHOOP credentials, Apple Health sessions, and agent tokens isolated per profile.
- Finish `connect/whoop/start` + `connect/whoop/callback` for each profile before enabling autonomous delivery.
- Do not assume an owner profile token can access or repair another family member's connector state.
