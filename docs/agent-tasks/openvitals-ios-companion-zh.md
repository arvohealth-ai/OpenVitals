# OpenVitals iOS Companion App Agent 任务简报

> 语言： [English](./openvitals-ios-companion.md) | [简体中文](./openvitals-ios-companion-zh.md)

Repo: `<path-to-openvitals>`

目标：把当前 Apple Health / Apple Watch reference template，打造成一个更接近生产形态的 OpenVitals iOS companion 体验。其中 iPhone app 是主要且必装的入口，Apple Watch app 只是一个可选附加项，只用于明确的 live workout heart-rate capture。

产品决策：

- iPhone app 是 Apple Health 的主连接器，负责 login / profile 选择、API endpoint 设置、HealthKit 授权、历史同步、后台 / 增量同步、同步状态、stale-data UX 和手动 **Sync Now**。
- Apple Watch app 是可选的，只在需要通过 `HKWorkoutSession` + `HKLiveWorkoutBuilder` 捕获 live workout HR 时使用。
- Apple Watch 历史数据仍应通过 iPhone app 工作：Watch 写入 Apple Health 后，经 HealthKit 同步到 iPhone，再由 iPhone 上传。
- 不要要求终端用户在正常使用时让 iPhone 或 Apple Watch 始终物理连接到 Mac。USB / Xcode 连接只用于开发、安装和硬件 QA。

重要约束：

- 保持 Apple Health 语义诚实。历史 HealthKit samples 属于 delayed 或 near-realtime platform samples，而不是 continuous live stream。
- 只有 active Apple Watch workout-session 心率样本，才能被表示为 `dataGranularity=live_signal` 与 `latencyClass=live`。
- 普通 Apple Health sync 不应强制要求安装 watchOS app。
- 保持现有 API / runtime / MCP / OpenClaw 边界不变。
- 不要提交生成的 XcodeGen 产物（`OpenVitalsHealthKitDemo.xcodeproj`、生成的 `Info.plist` 等）。
- 在没有真实 iPhone / Apple Watch 运行日志、截图或 API / MCP 输出之前，硬件证据仍应保持 pending。

## Phase 0: 基线与现状验证

任务：

- 阅读当前 Apple Health 实现：
  - `examples/mobile-ios-minimal-app`
  - `packages/collector-ios`
  - `packages/collector-mobile-core`
  - `providers/apple-health`
  - `apps/api`
  - `packages/runtime`
- 确认当前 XcodeGen setup 能在已安装的 Xcode 上构建。
- 确认 API 级别的 Apple Health smoke tests 仍然通过。
- 找出哪些生成文件已被忽略，必须保持不提交。

验收：

- `pnpm smoke:apple-health` 通过。
- `pnpm --filter @openvitals/collector-ios test` 通过。
- 在 `examples/mobile-ios-minimal-app` 中执行 `xcodegen generate` 成功。
- `OpenVitalsHealthKitDemo` 的 `xcodebuild` simulator build 在 `CODE_SIGNING_ALLOWED=NO` 下通过。
- 基线报告明确说明当前是否检测到真实 iPhone / Apple Watch。

## Phase 1: 产品 UX 与 app scope 定义

任务：

- 定义 iPhone companion app 的生产 UX：
  - profile 选择或 token 配置
  - API endpoint 设置（本地 / 生产）
  - HealthKit permission onboarding
  - initial sync
  - passive / background sync status
  - 手动 **Sync Now**
  - stale-data warnings
  - mirrored-source explanation
  - 当 HealthKit 权限缺失或不完整时的故障排查状态
- 定义可选 watchOS UX：
  - optional install state
  - start / stop live workout HR capture
  - connection / upload status
  - 当 iPhone app 未配置时的温和提示
- 明确产品规则：
  - iPhone app 是 Apple Health connector 的必需入口
  - Watch app 只用于 live workout HR
  - 历史 Watch 数据通过 iPhone HealthKit 流入

验收：

- 在 `docs/` 或 `examples/mobile-ios-minimal-app/` 下有一份简短 UX spec。
- README / quickstart 的表述不会暗示 Watch app 是普通 Apple Health sync 的必需项。
- 面向 agent 的文档清楚区分 `delayed_sync`、`near_realtime` 和 `live_signal`。

## Phase 2: 把 iPhone app 从 QA shell 提升为 companion app

任务：

- 将 `examples/mobile-ios-minimal-app/Sources/OpenVitalsHealthKitDemoApp.swift` 改造成可用的 companion flow：
  - API base URL 与 token / profile 设置界面
  - HealthKit permission state display
  - connect / session creation action
  - initial sync action
  - manual sync action
  - sync status refresh
  - last sync、last anchor、processed count、dropped mirrored count 与 stale warning 展示
  - 清晰的错误表现
- UI 应保持工具化和实用，不要做 marketing hero screen。
- 用 user defaults 或简洁本地设置层安全保存本地配置。
- 优先复用当前 collector API 的使用模式；除非能切实降复杂度，否则不要新造 SDK surface。

验收：

- iPhone app 在 simulator 中仍然可构建。
- app 能配置为访问本地 API，例如 `http://<Mac-LAN-IP>:3000`。
- 没有硬编码 secrets。
- 对缺少 endpoint、缺少 token、缺少 HealthKit 权限、创建 session 失败、ingest 失败和 stale sync status 等状态都有可见失败反馈。

## Phase 3: 补齐后台 / 增量同步形态

任务：

- 增加或记录 HealthKit background sync 策略：
  - `HKObserverQuery` / HealthKit background delivery
  - anchored query reuse 用于增量上传
  - 前台 fallback 与 **Sync Now**
  - app lifecycle 处理
- 实现能在无硬件条件下构建和单测的安全子集。
- 如果完整 background delivery 不能在无硬件下验证，就把手工测试写清楚并标为 pending hardware。
- 文案上保持诚实：说“background sync”或“near-realtime when iOS schedules delivery”，不要说“guaranteed live monitoring”。

验收：

- 代码和文档都说明了 initial sync 与 incremental sync 如何复用 anchors。
- API payload 继续包含 source revision、bundle ID、device metadata、timezone、source record ID / hash、freshness 和 confidence。
- 硬件测试计划中包含 background / observer delivery 的具体用例。

## Phase 4: 让 watchOS 成为可选 live mode

任务：

- 保留 `examples/mobile-ios-minimal-app/WatchApp` 作为可选 target / add-on。
- 确保 watch app 不阻塞 iPhone-only Apple Health sync。
- 改善 watchOS UI：
  - configured / unconfigured state
  - start live workout capture
  - stop live workout capture
  - live HR upload status
  - HealthKit / workout permission 缺失时的错误状态
- 确保 live workout records 包含：
  - `dataGranularity=live_signal`
  - `latencyClass=live`
  - `connectionMode=device_pairing`
  - `captureMode=direct`
  - Apple Watch source metadata
- 确保历史 HealthKit records 仍然是 `sample` 或 `episode`，并带 `latencyClass=delayed_sync` 或 `near_realtime`，而不是 `live_signal`。

验收：

- iPhone-only build path 有文档且能正常工作。
- watchOS target 能在 simulator 中构建。
- live HR 语义仍然只限于 active workout-session 记录。
- 文档明确说明 Watch app 只有在用户想要 live workout HR 时才需要安装。

## Phase 5: 对齐 API、Runtime、MCP 与 agent surface

任务：

- 验证现有 API ingest / session / status 路由足以支撑 companion app：
  - `/v1/users/:id/connect/apple-health/session`
  - `/v1/users/:id/ingest/apple-health`
  - `/v1/users/:id/sync-status`
  - timeline / explain endpoints
- 只有在 app UX 真的需要时才补充响应字段。
- 确保 MCP / OpenClaw 的表述说明：
  - Apple Health 通过 iPhone companion app 连接
  - Watch 历史样本通过 Apple Health 到达
  - live HR 需要可选的 Watch live workout mode
  - stale 或 missing data 必须显式披露

验收：

- 现有 smoke checks 继续通过。
- 任何新增 app-visible API 字段都有新测试或更新测试覆盖。
- MCP / agent 文档不夸大实时监控能力。

## Phase 6: 文档与硬件 QA

任务：

- 更新文档：
  - `README.md`
  - `docs/real-data-quickstart.md`
  - `docs/hardware-test-plan.md`
  - `examples/mobile-ios-minimal-app/README.md`
  - 以及通过 `pnpm docs:generate` 生成的 provider docs
- 增加用户向的 Apple Health setup guide：
  - 安装 iPhone app
  - 连接 profile / API
  - 授予 HealthKit 权限
  - initial sync
  - 可选 Apple Watch app 用于 live workout HR
  - stale data 与 background sync 限制的故障排查
- 增加开发者本地测试指南：
  - 用 `HOST=0.0.0.0 PORT=3000` 启动 API
  - 在 iPhone 上使用 Mac LAN IP
  - 生成 Xcode project
  - 配置 bundle IDs 和 team
  - 在 iPhone 上运行
  - 运行可选 Watch target

验收：

- 文档清晰区分本地开发中的 USB / Xcode 需求，与终端用户运行时行为。
- 硬件测试计划包含：
  - iPhone-only Apple Health 历史同步
  - 经 iPhone HealthKit 上传的 Apple Watch 历史数据
  - 可选的 Watch live workout HR
  - background / observer delivery
  - stale-data UX
  - mirrored Oura / WHOOP source handling

## Phase 7: 验证与最终交付

必需的自动化验证：

- `pnpm docs:generate`
- `pnpm build`
- `pnpm test`
- `pnpm smoke:e2e`
- `pnpm smoke:apple-health`
- `pnpm typecheck`
- `pnpm --filter @openvitals/collector-ios test`
- 在 `examples/mobile-ios-minimal-app` 中执行 `xcodegen generate`
- iPhone app 的 `xcodebuild` simulator build
- 如果生成的项目支持，watchOS target 的 `xcodebuild` simulator build

如果设备可用，再做人工硬件验证：

- iPhone app 能安装到真实 iPhone 上。
- iPhone app 会请求 HealthKit 权限。
- iPhone app 至少能上传一条真实的 heart rate、HRV SDNN、resting HR、steps、sleep 和 workout 样本（如可用）。
- Apple Watch 历史样本能通过 iPhone HealthKit 上传。
- 可选 watchOS app 能启动 workout session 并上传 live heart-rate samples。
- API timeline 与 MCP / OpenClaw 输出能诚实展示 freshness、granularity 和 source metadata。

最终交付物：

- 变更文件汇总。
- UX 决策总结：iPhone app 必需，watchOS 可选。
- 测试命令输出。
- 如果有则附上硬件证据；没有则明确列出 `pending-hardware` 清单。
- 说明 iOS background delivery timing 与 live / raw-data claims 方面的剩余限制。
