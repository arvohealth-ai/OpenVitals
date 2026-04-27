# 真实数据快速开始（Apple Health + Apple Watch + Oura + WHOOP）

> 语言： [English](./real-data-quickstart.md) | [简体中文](./real-data-quickstart-zh.md)

这份指南面向 v0.6 的硬件支撑路径：

- Apple Health：通过必装的 iPhone companion app 和设备侧 anchored HealthKit ingest。
- Apple Watch 历史数据：在平台同步后，经 iPhone HealthKit 上传。
- Apple Watch 实时心率：只通过可选的 watchOS live workout collector 路径采集。
- Oura：当你的构建包含 direct connector 时，通过官方云端 OAuth / API 数据接入。
- WHOOP：通过按用户隔离的 OAuth credential flow 接入。
- 使用单节点 API + SQLite 做本地自托管。

OpenVitals 会保留 provider payload 和 platform sample，再在其上推导 episode、daily summary、score 与 agent-facing explanation。不要把 Oura 或 WHOOP 云 API 描述成 continuous raw sensor stream；它们是 provider-mediated 的 delayed / daily sync surface。只有 Apple Watch live workout samples 才应被视为 `live_signal`。

## 1) 配置 live 模式

设置共享的 live-mode 变量：

```bash
export OPENVITALS_MODE=live
export OPENVITALS_DB_PATH=.openvitals/openvitals.sqlite
export OPENVITALS_ADMIN_TOKEN=openvitals-dev-admin
export OPENVITALS_SECRETS_KEY=local-dev-secrets-key
```

配置 WHOOP OAuth：

```bash
export OPENVITALS_WHOOP_CLIENT_ID="<whoop-client-id>"
export OPENVITALS_WHOOP_CLIENT_SECRET="<whoop-client-secret>"
export OPENVITALS_WHOOP_REDIRECT_URI="http://127.0.0.1:3000/v1/connect/callback/whoop"
export OPENVITALS_WHOOP_WEBHOOK_SECRET="local-whoop-secret"
```

如果你的构建包含 direct Oura connector，再配置 Oura OAuth：

```bash
export OPENVITALS_OURA_CLIENT_ID="<oura-client-id>"
export OPENVITALS_OURA_CLIENT_SECRET="<oura-client-secret>"
export OPENVITALS_OURA_REDIRECT_URI="http://127.0.0.1:3000/v1/connect/callback/oura"
# 用于测试 / staging 时可选：
export OPENVITALS_OURA_API_URL="https://api.ouraring.com"
```

然后启动 API：

```bash
pnpm install
OPENVITALS_MODE=live pnpm --filter @openvitals/api demo
```

## 2) 初始化 live profile

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Live User","timezone":"Asia/Shanghai","providers":["apple-health","oura","whoop"],"createTokens":true}'
```

把返回里的 derived token 保存下来：

```bash
export OPENVITALS_AGENT_TOKEN="<derived-token>"
```

## 3) 连接 WHOOP 云数据

创建 WHOOP connect session：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/whoop/start" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN"
```

响应会包含：

- `connectUrl`
- `state`
- `sessionId`
- `callbackUrl`
- `connectionMethod`

在浏览器里打开 `connectUrl` 并完成 WHOOP 授权。如果 `OPENVITALS_WHOOP_REDIRECT_URI` 指向 `http://127.0.0.1:3000/v1/connect/callback/whoop`，API 会自动完成 OAuth code exchange。

如果你的 redirect handler 在别处结束 OAuth，再把拿到的 `code` 和 `state` 转发给每用户 callback route：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/whoop/callback" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "sessionId":"<session-id>",
    "state":"<oauth-state>",
    "code":"<whoop-oauth-code>"
  }'
```

本地自托管开发时，也可以手工用 token payload 完成 callback：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/whoop/callback" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "sessionId":"<session-id>",
    "state":"<oauth-state>",
    "accessToken":"<whoop-access-token>",
    "refreshToken":"<whoop-refresh-token>",
    "expiresAt":"2026-03-20T08:00:00.000Z",
    "externalUserId":"whoop-user-123",
    "scopes":["read:sleep","read:recovery","read:workout"]
  }'
```

WHOOP 数据应被标记为 provider-mediated 的 delayed / daily cloud data。期望的 normalized outputs 包括 recovery、sleep、workout、strain / load、HRV、resting heart rate，以及 provider 返回时的 heart-rate-zone summaries。

## 4) 连接 Oura 云数据

当 direct Oura connector 可用时，启动 Oura connect flow：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/oura/start" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN"
```

在浏览器完成 OAuth，或者把返回的 `code` 和 `state` 转发给 callback route：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/oura/callback" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "sessionId":"<session-id>",
    "state":"<oauth-state>",
    "code":"<oura-oauth-code>"
  }'
```

Oura 云数据应被标记为 delayed / provider-mediated。Oura 心率行是样本（`dataGranularity=sample`），不是真正的 live signal。Sleep、readiness、SpO2、stress 和 workout 数据要保留 provider source ID、timestamp、unit、confidence 和 freshness metadata。

## 5) Apple Health ingest（iPhone companion 路径）

Apple Health 仍然是设备侧路径。服务端不会轮询 HealthKit，普通 Apple Health sync 也不要求 watchOS app。请先安装并配置 iPhone companion app；它负责 profile / token 配置、API endpoint 配置、HealthKit 授权、initial sync、background / incremental sync、stale-data 展示和手动 **Sync Now**。可选 watchOS target 只用于 live workout heart-rate capture。

创建 mobile session：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/connect/apple-health/session" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN"
```

然后使用 `examples/mobile-ios-minimal-app` 中的 iOS companion / template 路径，或者参考 collector 实现。

iPhone app 的配置流程应该：

1. 输入 OpenVitals API base URL。真机本地测试使用 `http://<Mac-LAN-IP>:3000`，不要用 `127.0.0.1`。
2. 输入或选择 live bootstrap 返回的 user / profile token。
3. 请求 HealthKit 权限，并展示缺失或部分授权。
4. 执行 initial sync，然后在前台刷新、后台 / observer 触发同步和手动 **Sync Now** 中复用同一套 anchors。
5. 展示 `/v1/users/:id/sync-status`：last sync、last anchor、pending ingest batches、latest error 和 stale-data warnings。

重要规则：

- 请求 heart rate、HRV SDNN、resting heart rate、step count、sleep analysis 和 workouts 的 HealthKit 授权。
- 使用 anchored incremental uploads，并在设备本地持久化 anchors。
- 上传 source revision bundle identifier、device info、timezone、unit、source record ID/hash 和 anchor state。
- Apple direct samples 使用 `captureMode: "direct"`。
- 通过 Apple Health 镜像进来的 Oura / WHOOP 样本使用 `captureMode: "mirrored"`，并保留 source app bundle。
- Apple Watch 历史样本仍是 HealthKit `sample` / `episode`，`latencyClass=delayed_sync` 或 `near_realtime`。
- Apple Watch 实时心率必须依赖 active live workout session，并在上传新鲜时标记为 `dataGranularity=live_signal`、`latencyClass=live`。
- iOS 背景投递由系统调度。请描述为 background sync 或 “near-realtime when iOS schedules delivery”，不要描述成 continuous live monitoring。

示例 mirrored payload 片段：

```json
{
  "captureMode": "mirrored",
  "sourceApp": "com.whoop.mobile",
  "bundleId": "com.whoop.mobile"
}
```

## 6) 运行 provider sync 并验证 freshness

触发 WHOOP incremental sync：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/sync" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"providerId":"whoop","mode":"incremental"}'
```

当 Oura 已连接时，触发 Oura incremental sync：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/sync" \
  -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{"providerId":"oura","mode":"incremental"}'
```

在做任何 coaching 或 agent 输出前，先检查 sync status：

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live/sync-status"
```

重点检查：

- `whoop.authState == "connected"`，且 `whoop.connectionMethod` 正确显示 OAuth 或明确的 local fallback。
- 在 direct connector 启用时，Oura 的 connected state 正常。
- Apple Health 的 connection / session state、latest anchor、pending ingest batches 和 freshness。
- data-quality / freshness gates 正在向 `ok` 靠近，agent 不应在此前对当前状态做自信结论。
- `pendingIngestBatches` 是否趋近 `0`。

## 7) 验证 dedupe 与 proactive outputs

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/scores?userId=user_live"

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/alerts?userId=user_live"
```

如果同时存在 direct Oura / WHOOP 数据和 Apple mirrored copies：

- normalized recovery / sleep / workout views 应优先使用 direct provider；
- raw/provider payload 与 mirrored platform samples 仍要保留用于审计；
- score 与 dedupe explanation 应指出哪个 source 胜出、哪个被抑制、原因是什么；
- agent 要显式暴露 stale、delayed、mirrored 或 incomplete 输入，而不是过度自信地输出健康结论。

## 8) 硬件证据 gate

使用 [硬件测试计划](./hardware-test-plan-zh.md) 记录这些手工证据：

- iPhone HealthKit collector；
- Apple Watch historical HealthKit samples；
- Apple Watch live workout heart-rate session；
- iOS background / observer delivery 和 stale-data UX；
- Oura direct cloud connector；
- WHOOP direct cloud connector；
- Oura 与 WHOOP 的 mirrored Apple Health dedupe；
- iOS 路径变绿后的 Android Health Connect smoke test。

在有人提供真实设备 / 账号证据之前，这些硬件测试都必须保持 **pending**。

## WHOOP webhook trigger（可选）

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/user_live/providers/whoop/webhook" \
  -H "x-openvitals-whoop-signature: ${OPENVITALS_WHOOP_WEBHOOK_SECRET}" \
  -H "content-type: application/json" \
  -d '{"type":"whoop.recovery.updated","eventId":"evt_1"}'
```

如果当前实现还不能验证 WHOOP 官方签名，就把现有 shared-secret check 明确表述为 dev / local webhook guard，而不是 production-grade signature verification。
