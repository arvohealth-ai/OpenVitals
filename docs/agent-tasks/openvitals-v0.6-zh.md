# OpenVitals v0.6 Agent 任务简报

> 语言： [English](./openvitals-v0.6.md) | [简体中文](./openvitals-v0.6-zh.md)

Repo: `<path-to-openvitals>`

目标：在保证仓库持续保持绿色的前提下，把当前原型推进成一个有真实硬件支撑的 live-data wedge，覆盖 iPhone + Apple Watch + Oura Ring + WHOOP，并且让面向 agent 的数据语义保持诚实。

重要约束：

- 不要误删或提交 `demo/openclaw-openvitals/vendor/openvitals-platform`；如果你的仓库里带着这个脏的 vendor / demo 项，保持原样不要碰。
- 不要把 WHOOP / Oura 云数据宣传成 continuous raw sensor streams。
- 明确区分 provider payload、platform sample、summary、score 和真正的 live signal。
- 保持修改范围收敛，保留现有 API / runtime / MCP / OpenClaw 结构。

## Phase 0: 先把仓库稳定下来

先让仓库恢复绿色，再加新能力。

任务：

- 修复 `packages/contracts`、`packages/runtime`、`apps/api`、`packages/mcp` 和 providers 之间 contracts / source / dist / type-resolution 的不一致。
- 确保对 consumer 可见的 exports 覆盖当前实际使用的所有 types / schemas / functions，包括 provider credentials、connection methods、source precedence overrides 和 sync status 字段。
- 修复 runtime 的 source precedence override bug。当前失败用例期望 override 后 Apple Health 胜出，但实际 WHOOP 仍在胜出。
- 确认这些导出保持一致：`refreshDerivedState`、`setSourcePrecedence`、`SourcePrecedenceInputSchema`、`ProviderCredentialSchema`、`ConnectionMethod`、`ProviderCredential` 以及 sync status types。
- 在需要时重新生成 docs / types。

验收：

- `pnpm typecheck` 通过。
- `pnpm test` 通过。
- `pnpm smoke:e2e` 通过。
- 不引入无关的 vendor / demo 改动。

## Phase 1: 增加数据能力语义

让数据模型对 agent 安全。

新增或收紧这些 canonical 字段 / 类型：

- `dataGranularity`: `provider_payload`, `sample`, `episode`, `daily_summary`, `score`, `live_signal`
- `latencyClass`: `live`, `near_realtime`, `delayed_sync`, `daily`, `manual`
- `connectionMode`: `cloud_oauth`, `mobile_permission`, `device_pairing`, `mock`
- Provider / metric capability metadata：metric name、source、granularity、expected latency，以及是 direct 还是 mirrored
- freshness 与 confidence 必须在 API、MCP、dashboard 和 explanations 中可见

文档更新要求：

- 停止模糊地使用 “raw data”。
- 明确说：OpenVitals 处理 provider raw payloads、mobile platform samples、normalized episodes、summaries、scores 和 live signals。
- 明确记录：Apple Watch live workout 是 live HR 路径；Oura / WHOOP 云 API 是 delayed / provider-mediated 数据。

验收：

- Provider matrix 能准确展示 WHOOP、Oura、Apple Health、Health Connect 的 capability level。
- MCP 和 API 响应暴露足够的 freshness / granularity 信息，让 agent 避免过度自信地发言。

## Phase 2: 实现真实 Oura connector

当前 Oura provider 还是 mock-only，需要补真实 OAuth / API 支持。

任务：

- 新增 `providers/oura/src/live.ts`。
- 支持环境变量：
  - `OPENVITALS_OURA_CLIENT_ID`
  - `OPENVITALS_OURA_CLIENT_SECRET`
  - `OPENVITALS_OURA_REDIRECT_URI`
  - 可选 `OPENVITALS_OURA_API_URL`
- 增加 Oura OAuth start / callback flow，可以走通用 provider credential flow，也可以按 WHOOP 模式加 Oura-specific route。
- 拉取并规范化：
  - `/v2/usercollection/heartrate`
  - daily sleep / sleep sessions
  - daily readiness
  - daily SpO2
  - daily stress
  - workouts（如果可用）
- 把 Oura 心率行规范成 `heart_rate` observations，`dataGranularity=sample`，不要当成真正 live data。
- 保留 Oura source ID、timestamp、unit、source type、confidence 和 freshness。

硬件测试：

- 使用 Oura Ring 账号。
- 确认 timeline / API 中出现真实 Oura 心率样本。
- 确认 Oura sleep / readiness 会影响 daily brief / recovery scores。

验收：

- Oura 从 `demo-only` 升级成 `real-data-beta` 或 `real-data-ready`。
- Oura real connector 有 unit tests，并且至少有一条记录清楚的人工硬件测试路径。

## Phase 3: 打通真实 iPhone + Apple Watch collector 路径

当前 Swift 文件只是 helper，不是完整硬件测试 app。

任务：

- 把 `examples/mobile-ios-minimal-app` 变成一个可运行的最小 iOS sample，或者如果这是本地首选模式，就明确补齐 Xcode project / template。
- 实现以下 HealthKit 授权：
  - heart rate
  - HRV SDNN
  - resting heart rate
  - step count
  - sleep analysis
  - workouts
- 实现历史 / 增量上传的 anchored queries。
- 上传 `HKSourceRevision.bundleIdentifier`、device info、timezone、unit、source record ID / hash 和 anchor state。
- 把镜像进 Apple Health 的 Oura / WHOOP records 标成 `captureMode=mirrored`，并保留正确 bundle / source metadata。
- 增加可选 Apple Watch live workout 路径：
  - `HKWorkoutSession`
  - `HKLiveWorkoutBuilder`
  - 在 workout session 期间流式上传 live heart rate
  - 归类为 `dataGranularity=live_signal` 或等价语义

硬件测试：

- iPhone 成功授予 HealthKit 权限。
- Apple Watch 贡献 HR / workout 数据。
- 至少能上传一条真实的 HR、HRV、resting HR、steps、sleep 和 workout 样本。
- live workout session 能产生 near-live 心率样本。

验收：

- API timeline 展示真实 Apple Health / Apple Watch records，且带完整 provenance。
- sync status 展示 freshness 和最后一次上传的 anchor。
- daily brief 在不双计 mirrored Oura / WHOOP 数据的前提下，可以使用 Apple Watch / HealthKit 数据。

## Phase 4: 加固 WHOOP live connector

当前 WHOOP connector 已存在，但语义和健壮性都需要加强。

任务：

- 校验 OAuth scopes、token refresh 和 endpoint parsing。
- 规范化 sleep、recovery、workout、HRV、resting HR、strain / load、average / max HR 和 heart-rate-zone summaries（若 provider 返回）。
- 使用 `updated_at` / pagination 安全完成增量同步。
- 明确 webhook handling：如果官方支持，就做正式 signature verification；否则把当前 shared-secret check 明确标记为 dev / local webhook security。
- 不要声称 WHOOP cloud API 能提供 continuous raw heart-rate streaming。

硬件测试：

- 使用 WHOOP 账号 / 设备。
- 完成 OAuth connect。
- 同步 sleep / recovery / workout。
- 确认 real WHOOP data 会改变 recovery scores 和 daily brief。

验收：

- WHOOP connector 对代表性 API payloads 有测试。
- 有记录清晰的真实硬件测试路径。
- API / MCP 把 WHOOP 报告为 delayed / provider-mediated 数据，而不是 live raw data。

## Phase 5: 修复 dedupe、provenance 与 freshness

这是整个可信度的核心。

任务：

- 修复 source precedence overrides。
- 给镜像进 Apple Health 的 Oura / WHOOP records 增加显式 source filters。
- 在同一 metric / window 上，direct Oura / WHOOP 通常应优先于 mirrored HealthKit copies。
- 保留全部 raw / provider records，但 normalized views 应暴露主记录并抑制重复项。
- explanations 必须能说明哪一个 source 胜出、哪一个被抑制，以及原因。

硬件测试：

- 连接 direct Oura，并允许 Oura 写入 Apple Health。
- 连接 direct WHOOP，并允许 WHOOP 写入 Apple Health。
- 确认 mirrored Apple Health 副本不会和 direct Oura / WHOOP records 双计。

验收：

- `explain_dedupe` 能清楚展示 direct 与 mirrored 的胜负逻辑。
- daily summary 和 scores 不会双计 sleep、HR、recovery 或 workouts。
- stale 或 missing data 时，会出现 freshness warnings。

## Phase 6: 更新 Agent / MCP / OpenClaw 行为

让 agent surface 识别数据质量边界。

任务：

- 给 `health.sync_status`、`health.daily_brief`、`health.recovery_status` 和 `health.explain_score` 补充 data granularity 与 freshness。
- 如有需要，增加或更新 MCP 工具，例如 `health.signal_freshness`。
- 更新 OpenClaw skill / workspace prompts，让 agent 能说明数据是 stale、delayed、mirrored 还是 incomplete。
- 除非真连上 Apple Watch live workout data，否则 agent 不应说 “real-time monitoring”。

验收：

- MCP 输出对另一个 agent 来说可直接使用，不依赖隐藏假设。
- daily brief 明确区分 current signals、delayed provider data 和 stale / missing data。

## Phase 7: 硬件 QA 矩阵

创建 `docs/hardware-test-plan.md`。

其中应包含：

- iPhone HealthKit collector
- Apple Watch historical HealthKit samples
- Apple Watch live workout heart-rate session
- Oura direct cloud connector
- WHOOP direct cloud connector
- Oura mirrored into Apple Health dedupe
- WHOOP mirrored into Apple Health dedupe
- iOS 路径变绿后的 Android Health Connect smoke test

每个用例都记录：

- 所需硬件
- 账号 / app 配置
- env vars
- 精确命令或 app 动作
- 预期 API / timeline 结果
- 预期 MCP / OpenClaw 结果
- 已知限制

## Phase 8: README 与 Quickstarts

更新：

- `README.md`
- `docs/real-data-quickstart.md`
- `docs/family-quickstart.md`
- 生成的 provider docs

文档必须说明：

- OpenVitals 是 agent-native 的健康数据平面与主动 runtime。
- v0.6 重点聚焦 Apple Health / Apple Watch、Oura 和 WHOOP。
- Apple Watch live HR 依赖 live workout collector 路径。
- Oura 提供 cloud time-series / summaries，不是 raw sensor streams。
- WHOOP 提供官方 cloud recovery / sleep / workout 数据，不是 continuous raw HR。
- dedupe、provenance 和 freshness 是第一类能力。

最终必需验证：

- `pnpm docs:generate`
- `pnpm typecheck`
- `pnpm test`
- `pnpm smoke:e2e`
- 人工 Oura hardware test
- 人工 WHOOP hardware test
- 人工 iPhone + Apple Watch HealthKit test
- 人工验证 mirrored Oura / WHOOP data in Apple Health 时的 dedupe

最终交付物：

- 变更文件汇总
- 自动化验证结果
- 硬件证据，或者明确的 pending-hardware 清单
- 仍然存在的限制与后续 issue
