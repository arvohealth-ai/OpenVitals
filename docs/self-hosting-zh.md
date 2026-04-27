# 自托管

> 语言： [English](./self-hosting.md) | [简体中文](./self-hosting-zh.md)

OpenVitals 被设计成一个可自托管、local-first 的健康数据平面与主动式 wellness runtime。

## 模式

- 本地单节点（推荐默认）：SQLite + 一个 API 进程。
- 云端单节点：同样是 SQLite + 一个 API 进程，必要时前面再挂你自己的 reverse proxy。

## 本地（单节点）

```bash
pnpm install
OPENVITALS_MODE=live pnpm --filter @openvitals/api demo
```

然后初始化一个 live user：

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Local User","timezone":"Asia/Shanghai","createTokens":true}'
```

初始化 owner + family profiles：

```bash
curl -X POST "http://127.0.0.1:3000/v1/household/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"owner":{"userId":"owner_live","name":"Owner","timezone":"Asia/Shanghai"},"family":[{"userId":"mom_live","name":"Mom","timezone":"Asia/Shanghai"}],"createTokens":true}'
```

## 必需环境变量

核心 runtime：

- `OPENVITALS_MODE=live`
- `OPENVITALS_DB_PATH`（SQLite 文件路径）
- `OPENVITALS_ADMIN_TOKEN`
- `OPENVITALS_SECRETS_KEY`，用于加密 provider credentials

WHOOP OAuth：

- `OPENVITALS_WHOOP_CLIENT_ID`
- `OPENVITALS_WHOOP_CLIENT_SECRET`
- `OPENVITALS_WHOOP_REDIRECT_URI`
- `OPENVITALS_WHOOP_WEBHOOK_SECRET`

当构建中包含 direct Oura connector 时，还需要 Oura OAuth：

- `OPENVITALS_OURA_CLIENT_ID`
- `OPENVITALS_OURA_CLIENT_SECRET`
- `OPENVITALS_OURA_REDIRECT_URI`
- `OPENVITALS_OURA_API_URL`（可选；默认指向 Oura 生产 API）

## 可选的开发回退路径

这些变量只适用于开发或迁移，不是 v0.6 的主路径。

WHOOP：

- `OPENVITALS_WHOOP_ACCESS_TOKEN`，用于单 token 的本地回退
- `OPENVITALS_WHOOP_BRIDGE_URL`，用于 bridge-based sync 回退
- `OPENVITALS_WHOOP_AUTH_URL`
- `OPENVITALS_WHOOP_TOKEN_URL`
- `OPENVITALS_WHOOP_API_URL`
- `OPENVITALS_WHOOP_SCOPE`

Oura：

- `OPENVITALS_OURA_API_URL`，用于 staging / mock endpoint 测试

## 数据源预期

- Apple Health 是纯设备侧路径，服务端不会轮询 HealthKit。
- Apple Watch 实时心率必须依赖 live workout collector 路径。历史 HealthKit 上传不是 live stream。
- Oura 云数据是 provider-mediated 的时间序列和 daily summary / score 数据，不是 continuous raw sensor streaming。
- WHOOP 云数据是 provider-mediated 的 recovery、sleep、workout、strain/load、HRV、resting-HR 和 heart-rate-zone summary 数据，不是 continuous raw HR streaming。
- 在同一 metric / window 上，direct Oura / WHOOP 应该压过 mirrored Apple Health 副本，同时 mirrored records 继续保留用于审计。

## Scheduler 配置

- `OPENVITALS_SCHEDULER_ENABLED`（live 默认 `true`，demo 默认 `false`）
- `OPENVITALS_SCHEDULER_LEADER`（单实例场景保持 `true`）
- `OPENVITALS_SCHEDULER_HEARTBEAT_MINUTES`（默认 `15`）
- `OPENVITALS_SCHEDULER_LOOP_MS`（默认 `60000`）

## 云端（单节点）

v0.6 仍保持简单的生产架构：

- 一个 API 进程；
- 一个挂在持久化存储上的 SQLite 文件；
- 按用户隔离、静态加密保存的 provider OAuth credentials；
- 前置可选的 reverse proxy / TLS。

## 家庭部署说明

- `household/bootstrap` 可以创建多个 runtime profile，但每个 profile 仍然独立拥有：
  - agent tokens；
  - scheduler state；
  - provider credentials；
  - Apple Health mobile session / anchor state；
  - sync freshness 与 dedupe state。
- 不要在家庭成员之间共享 WHOOP 或 Oura access token。
- 对 Apple Health，每个人都必须在自己的 iPhone 上执行设备侧 ingest。
- 在宣称 iPhone、Apple Watch、Oura、WHOOP 或 mirrored-dedupe 验收完成前，先跑硬件 QA 矩阵。

## 备注

- 让 `/v1/state` 继续仅对 `read.raw` 和 admin workflows 开放。
- 纯 derived 的 UI 和 agent dashboard 优先使用 `/v1/dashboard/state`。
- 生产环境入口应在 API 前终止 TLS，并限制 admin headers。
- OpenVitals 面向 wellness / coaching 工作流，不是诊断或临床决策系统。
