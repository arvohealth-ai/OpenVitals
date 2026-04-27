# 硬件测试计划

> 语言： [English](./hardware-test-plan.md) | [简体中文](./hardware-test-plan-zh.md)

这份矩阵记录了 OpenVitals v0.6 在 iPhone、Apple Watch、Oura、WHOOP 以及 mirrored-source dedupe 上要被称为“硬件支撑”之前所需的人类证据。自动化检查可以验证 contract 和 mock 路径，但下面这些硬件条目在有人提供真实设备 / 账号证据前都必须保持 **pending**。

## 证据规则

- 没有带时间戳的人类结果、日志片段、截图，或来自真实设备 / 账号的 API/MCP 导出结果，就不要把某一行标记为 passed。
- 不要把 Oura 或 WHOOP 云数据描述成 continuous raw sensor streaming。它们是 provider-mediated 的 delayed/daily sync 数据。
- iPhone companion app 是 Apple Health 的必选连接器；普通 HealthKit 同步不应要求安装 watchOS app。
- 只有 Apple Watch active workout heart-rate samples 才能满足 live HR 路径。
- 为了可审计性，要保留 raw/provider payload 和 platform samples；但在判断 normalized views 时，要看 provenance、dedupe、freshness 和 confidence。

## 自动化预检

在收集 iPhone / Apple Watch 手工证据前，先按 [iOS 硬件 QA Runbook](./ios-hardware-runbook-zh.md) 完成详细的环境与故障排查准备。

手工 iPhone / Apple Watch QA 之前先执行：

```bash
pnpm smoke:apple-health
```

这个本地检查使用合成的 Apple Health / Apple Watch 形状 payload 来验证：API 是否接受 anchored HealthKit samples、Apple Watch live workout HR 语义、mirrored-source filtering、timeline 读取和 explainability。它不能替代真实硬件证据。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| `pending-hardware` | 软件路径可能已经存在，但必需的设备 / 账号证据尚未提供。 |
| `blocked` | 因缺少硬件、账号、entitlement 或凭据而无法开始。 |
| `passed` | 人工证据证明 API/timeline 和 MCP/OpenClaw 结果符合预期。 |
| `failed` | 人工证据或自动化输出表明路径未达到验收标准。 |

## 必测用例

### 1. iPhone HealthKit collector

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | 装有 Health app 数据并可授予 HealthKit 权限的 iPhone。 |
| 账号 / app 配置 | 安装并运行 iOS collector app；初始化 OpenVitals live user；创建 Apple Health mobile session。 |
| 环境变量 | `OPENVITALS_MODE=live`、`OPENVITALS_DB_PATH`、`OPENVITALS_ADMIN_TOKEN`、`OPENVITALS_SECRETS_KEY`。 |
| 精确命令或动作 | 调用 `POST /v1/users/<userId>/connect/apple-health/session`，授予 HealthKit 权限，并对 heart rate、HRV SDNN、resting HR、steps、sleep、workouts 执行 anchored upload。 |
| 预期 API / timeline | timeline / observations 中出现真实 HealthKit samples，带 unit、timezone、source record ID/hash、source revision bundle ID、device metadata、anchor state 和 `captureMode=direct`。sync status 显示最新 upload / anchor，且没有悬挂失败批次。 |
| 预期 MCP / OpenClaw | `health.sync_status` 会报告 Apple Health freshness 和 sample granularity。`health.daily_brief` 只有在 freshness / confidence gate 满足时才使用这些样本。 |
| 已知限制 | 需要真实 iPhone 和 HealthKit entitlement；simulator 数据不足以作为最终硬件证据。 |

### 2. Apple Watch 历史 HealthKit 样本

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | 与测试 iPhone 配对且含有历史 HR / workout / sleep 数据的 Apple Watch。 |
| 账号 / app 配置 | Apple Watch 先写入 Apple Health；iPhone collector 拥有相关读权限。 |
| 环境变量 | 同 iPhone collector。 |
| 精确命令或动作 | 在 Watch 已生成心率、HRV / resting HR（如有）、workouts、steps、sleep 后，执行 anchored historical upload。 |
| 预期 API / timeline | API timeline 中出现 Apple Watch 的 source / device metadata、原始时间戳，且 mirrored provider data 不会在 normalized records 里双计。 |
| 预期 MCP / OpenClaw | daily brief / recovery status 能带 freshness 与 source label 引用 Apple Watch 历史样本。 |
| 已知限制 | Apple Health 可用性受地区和设备设置影响；Watch 必须先生成对应样本。 |

### 3. Apple Watch 实时 workout 心率会话

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | 已配对 iPhone、可启动 workout session 的 Apple Watch。 |
| 账号 / app 配置 | collector 实现 `HKWorkoutSession` 和 `HKLiveWorkoutBuilder`；已授予 HealthKit workout / heart-rate 权限。 |
| 环境变量 | 同 iPhone collector。 |
| 精确命令或动作 | 在 collector app 中启动 live workout capture，保持 workout 进行中，并在会话期间上传 live HR samples。 |
| 预期 API / timeline | timeline 接收到 near-live HR samples，标记为 `dataGranularity=live_signal`、`latencyClass=live` 或 `near_realtime`，并带有 workout / session 标识与 Watch source metadata。 |
| 预期 MCP / OpenClaw | 只有当该 live session 已连接且足够新鲜时，agent 才能描述实时 workout HR；超出这个窗口必须回退到 stale / delayed 表述。 |
| 已知限制 | live HR 必须依赖 active workout；后台历史 HealthKit sync 不能满足这一行。 |

### 4. iOS background / observer delivery 与 stale-data UX

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | 具备 HealthKit 权限并安装 companion app 的 iPhone。 |
| 账号 / app 配置 | 为 iPhone companion 配置 API base URL / profile token，创建 Apple Health session，授予 HealthKit 权限，并启用 app 支持的安全 background / observer 子集。 |
| 环境变量 | 同 iPhone collector。 |
| 精确命令或动作 | 先执行 initial anchored upload，等待或生成新的 HealthKit sample，让 `HKObserverQuery` / background delivery 或前台回退触发 incremental upload；若测试窗口内 iOS 不调度，则手动点击 **Sync Now**。 |
| 预期 API / timeline | `/v1/users/<userId>/sync-status` 显示更新后的 last sync / anchor，pending ingest batches 归零，只有在接受到新鲜数据后 stale-data warnings 才会消失。timeline 记录仍应是 `sample` / `episode`，`latencyClass` 为 `near_realtime` 或 `delayed_sync`，而不是 `live_signal`。 |
| 预期 MCP / OpenClaw | `health.sync_status` 与 brief / recovery 工具要明确说明这是 iOS 调度的 background sync，以及 stale / missing 数据，而不是 continuous monitoring。 |
| 已知限制 | iOS 完全控制后台投递时机。手动 **Sync Now** 只能证明 anchor 复用和增量上传路径，不等于证明 OS 已调度投递。 |

### 5. Oura direct cloud connector

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | 带近期数据的 Oura Ring 与 Oura account / API app。 |
| 账号 / app 配置 | 配置 Oura OAuth app 和 redirect URI；用 Oura OAuth 连接一个 profile。 |
| 环境变量 | `OPENVITALS_OURA_CLIENT_ID`、`OPENVITALS_OURA_CLIENT_SECRET`、`OPENVITALS_OURA_REDIRECT_URI`、可选 `OPENVITALS_OURA_API_URL`，以及核心 live-mode 变量。 |
| 精确命令或动作 | 启动 Oura OAuth（构建支持时调用 `POST /v1/users/<userId>/connect/oura/start`），完成 callback，再执行 `POST /v1/users/<userId>/sync`，body 为 `{"providerId":"oura","mode":"incremental"}`。 |
| 预期 API / timeline | timeline 包含该账号返回的 Oura 心率样本、sleep / readiness、SpO2、stress 和 workouts。记录保留 provider IDs、timestamps、units、freshness、confidence 与正确的 `dataGranularity`（`sample`、`daily_summary` 或 `score`）。 |
| 预期 MCP / OpenClaw | daily brief / recovery status 可以把 Oura 描述成 delayed/provider-mediated 数据，但不能说成 continuous raw live monitoring。 |
| 已知限制 | 构建里必须包含 direct Oura 支持，否则此行保持 blocked 或 pending。API 可用性取决于 Oura scopes 与账号历史。 |

### 6. WHOOP direct cloud connector

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | 带近期 recovery / sleep / workout 数据的 WHOOP 设备 / 账号。 |
| 账号 / app 配置 | 配置 WHOOP OAuth app 和 redirect URI；用 WHOOP OAuth 连接一个 profile。 |
| 环境变量 | `OPENVITALS_WHOOP_CLIENT_ID`、`OPENVITALS_WHOOP_CLIENT_SECRET`、`OPENVITALS_WHOOP_REDIRECT_URI`、`OPENVITALS_WHOOP_WEBHOOK_SECRET`，以及核心 live-mode 变量。 |
| 精确命令或动作 | 启动 WHOOP OAuth（`POST /v1/users/<userId>/connect/whoop/start`），完成 callback，再执行 `POST /v1/users/<userId>/sync`，body 为 `{"providerId":"whoop","mode":"incremental"}`。 |
| 预期 API / timeline | timeline / derived state 中出现 WHOOP 返回的 recovery、sleep、workouts、strain/load、average / max HR、HRV、resting HR 与 HR-zone summaries。同步过程安全处理 refresh / pagination，并记录 freshness。 |
| 预期 MCP / OpenClaw | agent 输出把 WHOOP 描述为 delayed/provider-mediated 的 recovery / sleep / workout 数据，并在同步过期时报告 stale / missing data。 |
| 已知限制 | WHOOP 云 API 不通过这条路径提供 continuous raw HR streaming。如果当前实现只有 shared secret，则 webhook verification 必须明确标记为 dev/local，而不是官方生产签名验证。 |

### 7. Oura mirrored into Apple Health dedupe

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | Oura Ring / account、iPhone，以及启用了 Oura 写入 Apple Health 的环境。 |
| 账号 / app 配置 | 连接 direct Oura；允许 Oura app 写入相关指标到 Apple Health；运行 iPhone collector。 |
| 环境变量 | 核心 live-mode 变量 + Oura OAuth 变量。 |
| 精确命令或动作 | 先同步 direct Oura，再上传带 Oura bundle / source metadata 的 Apple Health mirrored Oura 样本，然后请求 score / timeline / explain endpoints。 |
| 预期 API / timeline | raw/provider records 与 Apple mirrored records 都保留。normalized views 在同 metric/window 上优先 direct Oura，并抑制 mirrored Apple 副本。Explain 输出会写明 winner、被抑制的 source 和原因。 |
| 预期 MCP / OpenClaw | daily brief / recovery status 不会双计 Oura 的 sleep / HR / recovery 数据，并能解释 mirrored-source suppression。 |
| 已知限制 | 需要启用 Oura-to-Apple-Health sharing，并且 direct Oura connector 可用。 |

### 8. WHOOP mirrored into Apple Health dedupe

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | WHOOP 设备 / 账号、iPhone，以及启用了 WHOOP 写入 Apple Health 的环境。 |
| 账号 / app 配置 | 连接 direct WHOOP；允许 WHOOP app 写入相关指标到 Apple Health；运行 iPhone collector。 |
| 环境变量 | 核心 live-mode 变量 + WHOOP OAuth 变量。 |
| 精确命令或动作 | 先同步 direct WHOOP，再上传带 `bundleId: "com.whoop.mobile"` 的 Apple Health mirrored WHOOP 样本，然后请求 score / timeline / explain endpoints。 |
| 预期 API / timeline | raw/provider records 与 Apple mirrored records 都保留。normalized views 在同 metric/window 上优先 direct WHOOP，并抑制 mirrored Apple 副本。Explain 输出会写明 winner、被抑制的 source 和原因。 |
| 预期 MCP / OpenClaw | daily brief / recovery status 不会双计 WHOOP 的 sleep / recovery / workout 数据，并能解释 mirrored-source suppression。 |
| 已知限制 | 需要启用 WHOOP-to-Apple-Health sharing。 |

### 9. Android Health Connect smoke test

| 字段 | 要求 |
| --- | --- |
| Status | `pending-hardware` |
| 必需硬件 | 装有 Health Connect 和示例健康数据的 Android 设备。 |
| 账号 / app 配置 | 在 iOS 路径变绿后再运行 Android collector / reference，并授予 Health Connect 权限。 |
| 环境变量 | 核心 live-mode 变量。 |
| 精确命令或动作 | 如果构建支持 Health Connect / mobile session，就创建 session、授予权限并上传一小批 heart-rate / steps / sleep samples。 |
| 预期 API / timeline | timeline 中出现带 source metadata 与 freshness 的 Android platform samples。 |
| 预期 MCP / OpenClaw | `health.sync_status` 把 Health Connect 报告为 prototype / mobile-permission 数据，agent 输出不会把它当成 v0.6 的主 live wedge。 |
| 已知限制 | 这是 iOS 验收后的 smoke test，不是 Apple Watch live workout 证据的替代。 |

## 最终验收清单

| Gate | 必需证据 | 状态 |
| --- | --- | --- |
| Automated docs | `pnpm docs:generate` 输出，且生成文档干净。 | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Typecheck | `pnpm typecheck`。 | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Tests | `pnpm test`。 | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Smoke E2E | `pnpm smoke:e2e`。 | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Orchestrator verification | `pnpm agent:workflow verify --run openvitals-v0.6`。 | passed: `.agent-workflows/openvitals-v0.6/reports/verify-iteration-5.md` |
| Oura hardware | 用例 5，以及启用 mirrored dedupe 时的用例 7。 | pending-hardware |
| WHOOP hardware | 用例 6，以及启用 mirrored dedupe 时的用例 8。 | pending-hardware |
| iPhone + Apple Watch hardware | 用例 1、2、3、4。 | pending-hardware |
| Android smoke | iOS 路径变绿后的用例 9。 | pending-hardware |
