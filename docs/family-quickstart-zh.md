# 家庭部署快速开始

> 语言： [English](./family-quickstart.md) | [简体中文](./family-quickstart-zh.md)

这份指南覆盖 v0.6 下 owner + family 在一个自托管节点上的部署方式。

最重要的约束很简单：每个 profile 都必须拥有自己独立的 runtime state、scheduler state、provider credentials、Apple Health connector session 和 agent token。不要在家庭成员之间共用一个 WHOOP token、一个 Oura token，或一份 Apple Health session。

OpenVitals 在输出任何家庭 wellness/coaching 结果之前，都应该显式暴露 freshness 和 granularity。Apple Watch 实时心率只能来自 active live workout collector；Oura 和 WHOOP 云数据是 provider-mediated 的 delayed/daily 数据，而不是连续原始传感器流。

## 1. 以 live 模式启动 OpenVitals

设置必要环境变量：

```bash
export OPENVITALS_MODE=live
export OPENVITALS_ADMIN_TOKEN=openvitals-dev-admin
export OPENVITALS_DB_PATH="$(pwd)/.openvitals/openvitals.sqlite"
export OPENVITALS_SECRETS_KEY=replace-this-with-a-long-random-secret
```

Provider OAuth 变量：

```bash
export OPENVITALS_WHOOP_CLIENT_ID=your-whoop-client-id
export OPENVITALS_WHOOP_CLIENT_SECRET=your-whoop-client-secret
export OPENVITALS_WHOOP_REDIRECT_URI=http://127.0.0.1:3000/v1/connect/callback/whoop
export OPENVITALS_WHOOP_WEBHOOK_SECRET=local-whoop-secret

export OPENVITALS_OURA_CLIENT_ID=your-oura-client-id
export OPENVITALS_OURA_CLIENT_SECRET=your-oura-client-secret
export OPENVITALS_OURA_REDIRECT_URI=http://127.0.0.1:3000/v1/connect/callback/oura
```

启动 API：

```bash
pnpm --filter @openvitals/api demo
```

## 2. 初始化 owner 与 family profiles

```bash
curl -X POST "http://127.0.0.1:3000/v1/household/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  -d '{
    "owner": {"userId": "owner_live", "name": "Owner", "timezone": "Asia/Shanghai"},
    "family": [
      {"userId": "mom_live", "name": "Mom", "timezone": "Asia/Shanghai"},
      {"userId": "kid_live", "name": "Kid", "timezone": "Asia/Shanghai"}
    ],
    "createTokens": true
  }'
```

把每个 profile 返回的 `derived` 和 `full` token 都单独保存。这些 token 不能混用。

## 3. 为每个 profile 单独连接 WHOOP

为某一个用户启动 WHOOP 连接流程：

```bash
export OWNER_DERIVED_TOKEN=replace-with-owner-derived-token

curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/whoop/start" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}"
```

响应里包含：

- `connectUrl`
- `state`
- `sessionId`
- `callbackUrl`

如果 `OPENVITALS_WHOOP_REDIRECT_URI` 指向 `http://127.0.0.1:3000/v1/connect/callback/whoop`，浏览器授权后 API 会自动完成 OAuth code exchange。

如果你的部署把 OAuth 终止在其他地方，就把回调拿到的 `code` 再转发给这个接口：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/whoop/callback" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}" \
  -H "content-type: application/json" \
  -d '{
    "sessionId": "session_whoop_owner_live_...",
    "state": "whoop_state_...",
    "code": "whoop-oauth-code"
  }'
```

对 `mom_live`、`kid_live` 以及其他 profile 重复这一步。每次 callback 都会持久化一条独立加密的 credential。

## 4. 为每个 profile 单独连接 Oura

当你的构建已经包含 direct Oura connector 时，为每个 profile 分别启动 Oura 连接流程：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/oura/start" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}"
```

完成浏览器授权，或者把返回的 OAuth code 再转发给 callback：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/oura/callback" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}" \
  -H "content-type: application/json" \
  -d '{
    "sessionId": "session_oura_owner_live_...",
    "state": "oura_state_...",
    "code": "oura-oauth-code"
  }'
```

对每个持有 Oura Ring / Oura account 的 profile 分别执行。Oura 云输出应该被视为 delayed 的 provider-mediated samples、summaries 和 scores。

## 5. 在每台 iPhone 上分别连接 Apple Health

Apple Health 是纯设备侧路径，服务端不会轮询 HealthKit。

对每个家庭成员：

1. 用该 profile 的 token 创建 connector session。
2. 通过 iOS collector 请求 HealthKit 权限。
3. 在设备本地保存 anchor。
4. 携带 collector metadata 和 source revision metadata 上传 anchored batches。
5. 如果要用 Apple Watch 实时心率，则从 watch / iPhone collector 路径启动 active workout session。

创建 Apple session：

```bash
curl -X POST "http://127.0.0.1:3000/v1/users/owner_live/connect/apple-health/session" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}"
```

关于 Apple mirrored data 的要求：

- mirrored samples 必须包含 `bundleId` 和 source app metadata；
- 在同一 provider-owned metric/window 上，direct Oura/WHOOP 仍应优先于 mirrored Apple Health；
- mirrored Oura/WHOOP 样本仍要保留在 raw history 里以便审计；
- Apple Watch 实时 workout HR 要标记为 live signal，而不是通用 delayed provider data。

## 6. 验证各 profile 的同步状态

检查某一个 profile：

```bash
curl "http://127.0.0.1:3000/v1/users/owner_live/sync-status" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}"
```

对 WHOOP，你应当看到：

- `authState: "connected"`；
- `connectionMethod: "oauth"` 或明确的 local fallback；
- `credentialExpiresAt`；
- 表示 delayed/daily provider data 的 freshness 或 sync-status 字段。

对 Oura，在 direct connector 启用时，你应当看到：

- `authState: "connected"`；
- OAuth credential expiry 或 refresh metadata；
- 最近同步的心率样本窗口和日汇总窗口；
- 不会把 Oura 描述成 continuous live raw data。

对 Apple Health，你应当看到：

- mobile session / permission 连接状态；
- 最新 anchor 或 upload cursor；
- direct 与 mirrored samples 的 source metadata；
- data-quality / freshness gates。

如果某个 source 尚未连接或者没有新鲜批次上传，该 profile 仍可能发出 stale-data alerts，但任何 coaching 输出都必须明确说明缺失、延迟或过期输入。

## 7. 运行 scheduler

手动执行：

```bash
curl -X POST "http://127.0.0.1:3000/v1/experimental/scheduler/run" \
  -H "Authorization: Bearer ${OWNER_DERIVED_TOKEN}" \
  -H "content-type: application/json" \
  -d '{"userId":"owner_live","job":"all","dryRun":false}'
```

如果你想立即验证每个用户的 outbox 行为，可以对每个 profile 都运行一次。

live 模式下 scheduler 的顺序是：

1. provider incremental sync（适用时）；
2. derived-state refresh；
3. emission dedupe；
4. outbox / webhook / SSE fanout。

## 8. 为每个 profile 生成 OpenClaw 资产

```bash
pnpm --filter @openvitals/openclaw-workspace-recovery exec openvitals-openclaw-workspace \
  --out-dir . \
  --api-base-url http://127.0.0.1:3000 \
  --timezone Asia/Shanghai \
  --webhook-secret family-local-secret \
  --profile "owner_live|Owner|0 8 * * *|0 9 * * 0" \
  --profile "mom_live|Mom|0 8 * * *|0 9 * * 0" \
  --profile "kid_live|Kid|0 8 * * *|0 9 * * 0"
```

在 OpenClaw 里，应当为每个 profile 保持一个独立 health agent，并在输出任何 coaching 内容前先调用 `health.sync_status`。当信号是 stale、delayed、mirrored 或 incomplete 时，agent 必须说清楚。

## 9. 硬件证据

家庭级人工验收在有人提供真实设备 / 账号证据之前都应保持 pending。把结果记录到 [硬件测试计划](./hardware-test-plan-zh.md)，并在 [QA 验收报告](./qa-acceptance-zh.md) 里总结软件验证和硬件状态。
