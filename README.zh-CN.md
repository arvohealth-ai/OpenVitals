<h1 align="center">OpenVitals</h1>

<p align="center">
  <strong>面向主动式 wellness 软件的 agent-native 健康操作系统。</strong>
</p>

<p align="center">
  <a href="https://github.com/arvohealth-ai/OpenVitals/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/arvohealth-ai/OpenVitals/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="License: PolyForm Noncommercial" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue" />
  <img alt="Wellness only: not medical advice" src="https://img.shields.io/badge/not%20medical%20advice-wellness%20only-red" />
</p>

<p align="center">
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&amp;logoColor=white" />
  <img alt="pnpm 10.x" src="https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&amp;logoColor=white" />
  <img alt="TypeScript 5.x" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&amp;logoColor=white" />
  <img alt="MCP agent-ready" src="https://img.shields.io/badge/MCP-agent--ready-6f42c1" />
  <img alt="ARVO open-source core" src="https://img.shields.io/badge/ARVO-open--source%20core-14b8a6" />
</p>

<p align="center">
  <img alt="Apple Health: HealthKit" src="https://img.shields.io/badge/Apple%20Health-HealthKit-000000?logo=apple&amp;logoColor=white" />
  <img alt="Oura: real-data-beta" src="https://img.shields.io/badge/Oura-real--data--beta-2b6cb0" />
  <img alt="WHOOP: real-data-ready" src="https://img.shields.io/badge/WHOOP-real--data--ready-111111" />
</p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

OpenVitals 是一个面向个人 wellness 软件的 agent-native 健康数据平面。
它从手机、穿戴设备和 provider API 摄取数据，显式保留 provenance 与 freshness，
推导出可解释、可审计的 wellness state，并把这些语义安全地暴露给应用、MCP 工具、
OpenClaw workspace、SDK 和本地 agent。

它针对的是健康 agent 在真实场景里最容易出错的那些问题：数据过期、镜像记录双计、
把 provider summary 误当成原始流式数据，以及无法解释来源的黑盒分数。

<p align="center">
  <img src="docs/assets/openvitals-workflow.png" alt="OpenVitals workflow: ingest, reason, and act" width="100%" />
</p>

> OpenVitals 是 wellness 基础设施，不是诊断系统，也不是医疗器械。
> 不应被用于临床决策。

## ARVO 的开源核心

[ARVO](https://arvohealth.ai) 是主动式健康 OS 与产品体验：它连接穿戴设备、化验数据和日常习惯，
让健康陪伴 agent 能够发现有意义的变化并推动用户采取行动。Ari 是 ARVO 的第一个健康陪伴 agent。

OpenVitals 是这个方向下的开源核心。它专注于健康 agent 在值得信任之前必须具备的可复用基础设施：

- 接入 Apple Health、Apple Watch、Oura、WHOOP、Health Connect，以及未来更多 provider 数据；
- 保留 provenance、freshness、source priority 和 dedupe 证据；
- 把 provider 延迟、镜像记录、陈旧数据和缺失信号显式暴露给 agent；
- 通过 REST、MCP、SDK、OpenClaw workspace 和移动端 collector 示例输出一致的数据语义。

ARVO 产品可以在这一层之上构建主动式教练、提醒和 companion-agent 工作流。
OpenVitals 自己则聚焦于数据平面、runtime 语义和开发者接口。

<p align="center">
  <img src="docs/assets/openvitals-insight.png" alt="Example insight: low HRV, low ferritin, and a new vegetarian diet can indicate an iron deficiency alert" width="100%" />
</p>

## 为什么要做它

大多数健康集成只停留在“API 连上了”。OpenVitals 往前再走一步：

- **诚实的数据语义**：每条记录都携带 granularity、latency、source、confidence、freshness 和 capture mode。
- **Agent-safe 输出**：MCP 和 REST 会明确告诉你数据是 delayed、mirrored、stale、missing 还是 incomplete。
- **Local-first runtime**：单节点 SQLite 就能覆盖本地开发、自托管和硬件 QA。
- **可解释分数**：recovery、sleep、strain、circadian 和 alert 都能回溯到具体证据。
- **Provider dedupe**：direct Oura/WHOOP 可以在不破坏原始审计轨迹的前提下，覆盖镜像进 Apple Health 的副本。
- **移动端采集路径**：iPhone HealthKit 是 Apple Health 的主连接器；Apple Watch 实时心率是可选路径，仅在 active workout session 中生效。

## 快速开始

要求：

- Node.js 22+
- pnpm 10+

```bash
pnpm install
pnpm demo
```

在另一个终端里：

```bash
export OPENVITALS_AGENT_TOKEN=ov_demo_user_ada_derived

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/scores?userId=user_ada"
```

打开本地工具：

- Dashboard: <http://127.0.0.1:3000/dashboard>
- API playground: <http://127.0.0.1:3000/playground>
- OpenAPI JSON: <http://127.0.0.1:3000/v1/openapi.json>

## 你可以用它做什么

- 一个在数据过期时拒绝过度推断的本地个人健康 agent。
- 一个带 profile 隔离凭据和 scoped token 的家庭恢复看板。
- 一个给其他 agent 提供 freshness-aware 健康上下文的 MCP server。
- 一个上传 HealthKit / Health Connect 样本的移动 companion app。
- 一个新的穿戴设备或健身平台 provider adapter。
- 一个执行 daily brief 和 recovery check-in 的 OpenClaw workspace。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `apps/api` | Fastify API、SQLite runtime state、OAuth/connect flows、SSE/webhooks、OpenAPI、explainability endpoints。 |
| `apps/dashboard` | 用于查看 connector state、scores、alerts、freshness 和 provenance 的工程 dashboard。 |
| `apps/devplayground` | 用于本地接口联调的浏览器 playground。 |
| `packages/contracts` | 共享的 Zod schema 和公开 TypeScript contract。 |
| `packages/runtime` | ingest、dedupe、source precedence、baseline、scoring、workflow 和 explainability pipeline。 |
| `packages/mcp` | 暴露 daily brief、recovery status、sync status、freshness 和 explanation 工具的 MCP server。 |
| `packages/sdk-ts`, `packages/sdk-py` | TypeScript 与 Python SDK。 |
| `packages/collector-*` | iOS、Android、React Native、Flutter 以及共享生命周期逻辑的移动端 collector 原语。 |
| `packages/llm` | LLM provider adapter 层，包含 OpenRouter smoke 支持。 |
| `providers/*` | Apple Health、Health Connect、Oura、WHOOP、Garmin、Strava 的 provider adapter。 |
| `examples/*` | 可运行示例和移动端模板。 |
| `docs/*` | quickstart、硬件 QA、凭据配置、OpenClaw、OpenRouter 和自托管文档。 |

## 数据语义

OpenVitals 把健康数据当作带上下文的证据，而不只是数字。

| 字段 | 取值 | 为什么重要 |
| --- | --- | --- |
| `dataGranularity` | `provider_payload`, `sample`, `episode`, `daily_summary`, `score`, `live_signal` | 区分 provider payload、平台样本、时间窗、汇总、分数和真正的实时信号。 |
| `latencyClass` | `live`, `near_realtime`, `delayed_sync`, `daily`, `manual` | 防止 agent 用延迟数据冒充当前状态。 |
| `connectionMode` | `cloud_oauth`, `mobile_permission`, `device_pairing`, `mock` | 解释数据是通过什么路径进入系统的。 |
| `captureMode` | `direct`, `mirrored`, `manual`, `mock` | 当 Oura/WHOOP 同时写入 Apple Health 时避免双计。 |

Provider 边界是显式定义的：

- Apple Watch 实时心率依赖可选的 live workout collector 路径，基于 `HKWorkoutSession` 和 `HKLiveWorkoutBuilder`。
- 历史 Apple Health / Apple Watch 数据通过 iPhone HealthKit 以 sample 或 episode 形式上传，不是服务端实时流。
- Oura 云 API 提供的是 provider-mediated 的时间序列、日汇总和分数，不是连续原始传感器流。
- WHOOP 云 API 提供的是 provider-mediated 的 recovery、sleep、workout、strain、HRV、resting heart-rate 和 zone summary，不是连续原始心率流。

## Provider 状态

| Provider | 连接方式 | 数据形态 | 状态 | 说明 |
| --- | --- | --- | --- | --- |
| Apple Health / Apple Watch | iPhone HealthKit + 可选 Watch workout app | samples, episodes, daily summaries, live workout HR | `sdk-ingest-ready` | iPhone app 是主连接器。Watch app 只用于 active workout HR。 |
| Health Connect | Android device permission | samples and summaries | `prototype` | iOS 路径打通后再跑 Android smoke。 |
| Oura | OAuth cloud API 或 env-token dev path | provider payloads, samples, daily summaries, scores | `real-data-beta` | delayed/provider-mediated。direct Oura 应在同时间窗中压过 mirrored Apple Health。 |
| WHOOP | OAuth cloud API 或 env-token dev path | provider payloads, summaries, scores | `real-data-ready` | delayed/provider-mediated。不宣称 continuous raw HR streaming。 |
| Garmin | mock | provider payloads and summaries | `demo-only` | 仅覆盖 demo。 |
| Strava | mock | workout payloads and summaries | `demo-only` | 仅覆盖 demo。 |

运行 `pnpm docs:generate` 可以在本地生成 provider 和 MCP reference 文档。

## Runtime 模式

`demo` 模式会种入确定性的演示数据和 token：

```bash
pnpm demo
```

`live` 模式不预置用户状态，适合真实连接流程：

```bash
OPENVITALS_MODE=live pnpm --filter @openvitals/api demo
```

初始化一个 live 用户：

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Live User","timezone":"UTC","createTokens":true}'
```

默认情况下，runtime SQLite 状态存储在 `.openvitals/openvitals.sqlite`。
可以通过 `OPENVITALS_DB_PATH` 覆盖。

## 真实数据接入

先复制环境变量模板，只填写你当前要用的 provider：

```bash
cp .env.example .env.local
```

推荐阅读：

- [文档总览](./docs/README-zh.md)
- [真实数据快速开始](./docs/real-data-quickstart-zh.md)
- [凭据获取清单](./docs/credentials-setup-zh.md)
- [iOS Companion 指南](./docs/ios-companion-guide-zh.md)
- [iOS 硬件 QA Runbook](./docs/ios-hardware-runbook-zh.md)
- [硬件测试计划](./docs/hardware-test-plan-zh.md)
- [自托管](./docs/self-hosting-zh.md)
- [OpenRouter LLM](./docs/openrouter-llm-zh.md)
- [OpenClaw E2E](./docs/openclaw-e2e-zh.md)

永远不要提交 `.env`、`.env.*`、OAuth code、access token、refresh token、
provider client secret、Apple 设备标识符或真实 HealthKit 导出数据。

## OpenClaw 与 MCP

上游 OpenClaw 仓库以 submodule 形式固定在 `vendor/openclaw`。

```bash
git submodule update --init --recursive
pnpm openclaw:e2e
```

自动化 E2E 会启动 demo API、在隔离的 OpenClaw config 中注册 OpenVitals MCP server、
生成 skill/workspace 资产，并通过 MCP stdio 调用 `health.sync_status` 与 `health.daily_brief`。

生成一个 OpenClaw daily brief workspace：

```bash
pnpm --filter @openvitals/openclaw-skill exec openvitals-openclaw-init \
  --out-dir . \
  --api-base-url http://127.0.0.1:3000 \
  --user-id user_ada \
  --timezone UTC \
  --daily-cron "0 8 * * *" \
  --weekly-cron "0 9 * * 0" \
  --webhook-secret local-dev-secret
```

## 开发

```bash
pnpm docs:generate
pnpm build
pnpm test
pnpm smoke:e2e
pnpm typecheck
pnpm smoke:apple-health
pnpm provider:new fitbit
```

CI 会运行 docs generation、build、unit tests、smoke E2E 和 typecheck。

贡献者边界：

- 保持 score 计算 deterministic 且可解释。
- 保留 raw/provider payload 历史和 normalized records。
- 不要在 agent-facing 输出里隐藏 stale、mirrored、missing 或 incomplete 数据。
- 不要削弱 token scope、OAuth、webhook signing 或 admin boundary。
- 不要作出诊断、治疗或医疗器械类声明。

更多说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

OpenVitals 以 source-available 形式提供，非商业用途遵循
[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)。
商业使用需要单独的商业授权，见 [COMMERCIAL.md](./COMMERCIAL.md)。

这不是 OSI 批准的开源许可证，因为项目并不授予无限制的商业使用权。

## 免责声明

OpenVitals 面向 wellness、coaching、自我追踪和 agent context 工作流。
它不是诊断系统，不是医疗器械，也不能替代临床判断。
在做任何健康相关表述前，都应先展示 provenance、confidence 和 freshness。
