# iOS Companion 指南（Apple Health + 可选 Apple Watch）

> 语言： [English](./ios-companion-guide.md) | [简体中文](./ios-companion-guide-zh.md)

OpenVitals iOS companion 是 Apple Health 的必选连接器。普通 Apple Health 同步应先安装并配置 iPhone app。Apple Watch app 是可选附加项，只在用户明确需要从 active workout session 采集 live workout heart-rate 时使用。

## 产品规则

- **iPhone app 必选**：profile / token 配置、API endpoint 配置、HealthKit 授权、历史同步、增量同步、同步状态、stale-data 警告和手动 **Sync Now** 都在 iPhone app 里完成。
- **Apple Watch app 可选**：只有在需要通过 `HKWorkoutSession` + `HKLiveWorkoutBuilder` 采集实时 workout 心率时才安装它。
- **历史 Watch 数据通过 iPhone HealthKit 上来**：Apple Watch 写入 Apple Health 的样本，会在平台同步后由 iPhone app 作为 HealthKit sample 上传。
- **终端用户不应依赖 Mac 连接**：Mac / Xcode 只用于开发、安装与硬件 QA。正常运行时，用户不应需要物理连接 Mac。

## iPhone companion UX

iPhone app 应该保持实用、偏工具形态：

1. **Profile 与 API 配置**
   - 输入或选择 OpenVitals user / profile。
   - 输入 API base URL，例如本地硬件测试时使用 `http://<Mac-LAN-IP>:3000`，或生产 API URL。
   - 在本地安全保存 user token；不要把 secret 硬编码进 app 或仓库。
2. **HealthKit onboarding**
   - 解释请求的读权限：heart rate、HRV SDNN、resting heart rate、steps、sleep、workouts。
   - 清楚展示缺失 / 部分授权状态，并提供重试路径。
3. **Initial sync**
   - 通过 `/v1/users/:id/connect/apple-health/session` 创建 Apple Health session。
   - 执行 anchored initial upload，并展示 processed、uploaded、dropped mirrored 和 failed 数量。
4. **持续同步**
   - 前台刷新、后台 / observer 触发上传和手动 **Sync Now** 都复用同一个 anchor store。
   - 从 `/v1/users/:id/sync-status` 展示 last sync time、last anchor、pending ingest batches、latest error 和 stale-data state。
5. **Mirrored-source 解释**
   - 告诉用户：写进 Apple Health 的 Oura / WHOOP 样本可能会为了审计被保留，但当 direct provider data 胜出时，会从 normalized views 中被压制。

## 可选 watchOS 实时 workout UX

watchOS app 不应阻塞 iPhone-only Apple Health sync。它的 UI 只需要围绕 live workout HR：

1. 显示已配对 iPhone app 是否已完成 API / profile / session 配置。
2. 在需要时请求 HealthKit / workout 权限。
3. 提供 **Start Live Workout HR** 和 **Stop** 两个动作。
4. 展示 upload status、最后一条心率时间戳，以及任何连接或权限错误。
5. 只有 active workout-session 的 heart-rate records 才标记为 `dataGranularity=live_signal`、`latencyClass=live`、`connectionMode=device_pairing` 和 `captureMode=direct`。

## 后台同步与 stale-data 语义

HealthKit 的后台投递由 iOS 调度。OpenVitals 的文档和 UI 应把它描述为 **background sync** 或 **near-realtime when iOS schedules delivery**，而不是“保证实时监控”。

这些标签应始终一致：

| 场景 | `dataGranularity` | `latencyClass` | 面向用户 / agent 的表述 |
| --- | --- | --- | --- |
| iPhone HealthKit 历史或增量上传 | `sample` 或 `episode` | `delayed_sync` 或 `near_realtime` | 由 iPhone app 上传的 Apple Health 样本；可能受 HealthKit / iOS 调度影响而延迟。 |
| Apple Watch 历史样本经 HealthKit 可见 | `sample` 或 `episode` | `delayed_sync` 或 `near_realtime` | 先同步进 Apple Health，再由 iPhone app 上传。 |
| Apple Watch active workout 心率 | `live_signal` | `live` | 仅在 watch workout collector session 活跃且数据足够新鲜时才算 live。 |
| 经 Apple Health 镜像的 Oura / WHOOP 样本 | `sample` 或 `episode` | `delayed_sync` 或 `near_realtime` | 平台镜像样本，不是 direct cloud live stream。 |

## 本地硬件配置清单

完整故障矩阵见 [iOS 硬件 QA Runbook](./ios-hardware-runbook-zh.md)，其中覆盖了 Xcode 平台支持、`pnpm` 路径、设备识别、Developer Mode、签名身份、bundle ID、Watch companion packaging、本地 API 网络和证据采集。

1. 在局域网地址启动 API，而不是仅绑定 loopback：
   ```bash
   HOST=0.0.0.0 PORT=3000 OPENVITALS_MODE=live pnpm --filter @openvitals/api demo
   ```
2. 初始化 live profile 并保存返回的 token。
3. 在 `examples/mobile-ios-minimal-app` 里通过 XcodeGen 生成 Xcode project。
4. 配置 bundle ID 和 Apple Developer Team ID 以启用 HealthKit entitlements。
5. 在真实 iPhone 上运行 app，填入 `http://<Mac-LAN-IP>:3000`，授予 HealthKit 权限并执行 initial sync。
6. 只有在验证 live workout HR 时才安装 / 运行 watchOS target。
7. 保存带时间戳的日志、截图或 API/MCP 输出作为硬件证据；否则硬件状态保持 `pending-hardware`。
