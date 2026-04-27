# iOS 硬件 QA Runbook

> 语言： [English](./ios-hardware-runbook.md) | [简体中文](./ios-hardware-runbook-zh.md)

这份 runbook 总结了在验证 OpenVitals iPhone companion 与可选 Apple Watch live-workout app 时，真实遇到过的环境问题、检查点和恢复步骤。它紧贴硬件路径：大多数自动化只能证明构建和 API 语义，但 Apple Health 与 Apple Watch 的最终验收仍然依赖真实设备和用户手动授予的 HealthKit 权限。

## 可以自动化的部分

开发者和 CI 可以自动化这些检查：

```bash
pnpm --filter @openvitals/collector-ios test
pnpm smoke:apple-health
```

`pnpm smoke:apple-health` 会启动一个 in-process API，并发送合成的 Apple Health / Apple Watch 形状 payload。它验证 anchored ingest 语义、mirrored-source filtering、timeline 读取、explainability，以及 live workout heart-rate records 是否被正确标记为 `dataGranularity=live_signal` 与 `latencyClass=live`。

本地开发也可以自动化 project generation、simulator build 与 simulator 启动。默认 iPhone scheme 只构建 iPhone app；watchOS app 保持在单独的可选 scheme：

```bash
cd examples/mobile-ios-minimal-app
xcodegen generate
xcodebuild -project OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsHealthKitDemo \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -project OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsWatchDemo \
  -configuration Debug \
  -destination 'generic/platform=watchOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

这些检查不能证明真实 HealthKit 访问、Apple Watch 历史样本、Apple Watch live workout heart rate、background delivery，或基于真实 Apple Health 数据的 provider-mirrored dedupe。

## 必须由人或真实设备完成的部分

- 在 iPhone 上信任这台 Mac。
- 在 iPhone 上启用 Developer Mode。
- 首次安装后，如果 iOS 要求，信任 Personal Team 的开发者 profile。
- 如果 automatic signing 需要创建证书或 provisioning profile，则在 Xcode 中登录 Apple Developer 账号。
- 在 iPhone / Apple Watch 上授予 HealthKit 权限。
- 手动启动和停止 Apple Watch live workout session。
- 确认 Health app 中确实存在 heart rate、HRV SDNN、resting heart rate、steps、sleep 和 workouts 的真实样本。

## 面向真机的本地 API 启动

让 API 绑定在局域网地址上，不要只监听 loopback。真实 iPhone / Watch 测试时应这样启动：

```bash
HOST=0.0.0.0 PORT=3000 OPENVITALS_MODE=live pnpm demo
```

查找 Mac 的局域网地址：

```bash
ipconfig getifaddr en0
```

在 iPhone 和 Watch app 中使用 `http://<Mac-LAN-IP>:3000`。`http://127.0.0.1:3000` 只适用于 Mac 自己或本地 simulator；在真实 iPhone 上，它指向的是 iPhone 本机。

硬件 QA 优先使用局域网 URL。临时 HTTPS tunnel 适合 OAuth callback 或简单 GET 探针，但对 HealthKit ingest 不稳定：这次验证中，localtunnel 出现过 `503 Tunnel Unavailable`，Cloudflare quick tunnel 在 Apple Health ingest 上出现过 `413 Payload Too Large` / `524 A timeout occurred`。如果必须用 tunnel，先用小批量 smoke 上传验证，不要把 tunnel 成功当成正常 LAN 同步成功的证据。

初始化一个 live 测试用户：

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live_apple_hw","name":"Apple Hardware Test","timezone":"Asia/Shanghai","providers":["apple-health"],"createTokens":true}'
```

在 iPhone app 中使用返回的 `derived` 或 `full` token。真实 token 只应保存在本地 Keychain / secret store 里，不要进源码库。

## 工具链检查清单

必须使用完整 Xcode，而不是单独的 Command Line Tools：

```bash
xcodebuild -version
xcrun xcode-select -p
```

期望输出：

```text
/Applications/Xcode.app/Contents/Developer
```

如果 `xcode-select` 指向 `/Library/Developer/CommandLineTools`，切换过去：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

在 Xcode 首次启动时，从组件页面或设置里安装 iOS 和 watchOS platform support。只有 macOS 支持是不够的。

如果非登录 shell 里找不到 `pnpm`，把 Homebrew / local bin 路径补进 `PATH`：

```bash
PATH=/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH pnpm -v
```

不要盲目 `source .env`。很多 `.env` 文件虽然符合 dotenv 语法，但不是合法 shell 语法。优先使用显式环境变量、dotenv loader 或文档里列出的 `export`。

## Xcode 项目生成

这个 sample project 是由 `examples/mobile-ios-minimal-app/project.yml` 生成的：

```bash
cd examples/mobile-ios-minimal-app
xcodegen generate
open OpenVitalsHealthKitDemo.xcodeproj
```

`OpenVitalsHealthKitDemo.xcodeproj`、生成的 `Info.plist` 和 DerivedData 构建产物都属于生成物，`project.yml` 才是源文件。

生成出来的项目包含默认开发 bundle IDs，因此即使不继承 shell 环境变量，也能直接从 Xcode 运行：

- `OPENVITALS_IOS_BUNDLE_ID=ai.openvitals.healthkitdemo`
- `OPENVITALS_WATCH_BUNDLE_ID=ai.openvitals.healthkitdemo.watch`

对真实设备，请使用唯一 bundle ID 和真实 Team ID。只要 capability 配好并在手机上信任开发者 profile，Personal Team 也足够做本地 iPhone HealthKit 开发。推荐使用你自己的命名空间：

```bash
xcodebuild -project OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsHealthKitDemo \
  -configuration Debug \
  -destination 'id=<IOS_DEVICE_ID>' \
  DEVELOPMENT_TEAM='<TEAM_ID>' \
  PRODUCT_BUNDLE_IDENTIFIER='com.example.openvitals.healthkitdemo' \
  CODE_SIGN_STYLE=Automatic \
  build
```

或者在 Xcode build settings 里直接设置这些值。虽然项目里也提供 `OPENVITALS_APPLE_TEAM_ID` / `OPENVITALS_IOS_BUNDLE_ID` 自定义变量，但在本地真机签名时，最稳的 CLI 覆盖方式仍然是直接传 `DEVELOPMENT_TEAM=... PRODUCT_BUNDLE_IDENTIFIER=... CODE_SIGN_STYLE=Automatic`。

可选 watchOS app 需要自己的 provisioning profile 和可用的 Watch destination。如果 Personal Team provisioning 提示没有可用 Watch 设备，就先用 iPhone-only scheme 验证 HealthKit 历史同步，等配对的 Watch 在 Xcode 里出现后再回到 watchOS scheme。

## 设备识别

列出设备：

```bash
xcrun devicectl list devices
xcrun xctrace list devices
```

真实 iPhone 可用时通常会看到类似：

```text
Your iPhone (...) available iPhone...
```

如果 `devicectl` 说：

```text
No devices found.
```

检查：

- iPhone 是否通过 USB 连接，或能通过已信任的网络调试被发现；
- iPhone 是否解锁；
- iPhone 是否已经在“信任此 Mac”提示里选择信任；
- 安装 platform support 后是否至少打开过一次 Xcode；
- Developer Mode 是否已开启。

## Developer Mode

如果 `xcodebuild` 报：

```text
Developer Mode disabled
To use <iPhone> for development, enable Developer Mode in Settings -> Privacy & Security.
```

在 iPhone 上这样修复：

1. 打开 Settings。
2. 进入 Privacy & Security。
3. 打开 Developer Mode。
4. 按提示重启。
5. 重启后解锁 iPhone，再次确认 Developer Mode。

这个步骤由 iOS 故意交给用户控制，Mac 侧无法自动化完成。

## Code signing 与 provisioning

检查本地签名身份：

```bash
security find-identity -p codesigning -v
```

如果返回：

```text
0 valid identities found
```

说明 Xcode 还不能对真机构建签名。修复方式：

- 打开 Xcode -> Settings -> Accounts，登录 Apple Developer 账号；
- 在 project / target 的 Signing & Capabilities 中选择一个 Team；
- 让 Xcode 为 iOS 和 watchOS targets 自动管理 signing；
- 使用唯一 bundle IDs；
- 确认 app IDs / targets 已启用 HealthKit capability。

Simulator build 可以带 `CODE_SIGNING_ALLOWED=NO` 通过，但真机不能。

## 信任 Personal Team 构建

如果 `devicectl` 安装 app 成功，但启动失败并提示：

```text
Unable to launch ... because it has an invalid code signature, inadequate entitlements or its profile has not been explicitly trusted by the user
```

在 iPhone 上这样修复：

1. 打开 Settings。
2. 进入 General。
3. 打开 VPN & Device Management。
4. 选择 Xcode 所用账号对应的 Apple Development profile。
5. 点击 Trust。
6. 保持 iPhone 解锁并连接，然后从 Xcode 或 `devicectl` 再次启动。

这是 iOS 的用户控制安全步骤，Mac 不能代为完成。

## 启动时设备被锁定

如果 `devicectl` launch 失败并提示：

```text
Unable to launch ... because the device was not, or could not be, unlocked
SBMainWorkspace ... reason: Locked
```

说明 iPhone 在权限或 Settings 步骤后又锁屏了。解锁 iPhone，让它停留在主屏或 OpenVitals 前台，然后重新执行 launch。Mac 不能替用户解锁或绕过这个保护。

对较长的硬件 QA，建议临时把 Auto-Lock 调长：

1. Settings -> Display & Brightness。
2. Auto-Lock。
3. 测试期间选择更长时间，结束后再改回去。

## 用 launch env 预填 iPhone app

iPhone app 会读取 launch environment overrides 并持久化到本地，这样开发时就不用在手机上手输长 token：

```bash
TOKEN="$(jq -r '.tokens[] | select(.label=="derived") | .token' /tmp/openvitals-apple-bootstrap.json)"
DEVICECTL_CHILD_OPENVITALS_IOS_BASE_URL='http://<Mac-LAN-IP>:3000' \
DEVICECTL_CHILD_OPENVITALS_IOS_USER_ID='user_live_apple_hw' \
DEVICECTL_CHILD_OPENVITALS_IOS_BEARER_TOKEN="$TOKEN" \
DEVICECTL_CHILD_OPENVITALS_IOS_LOOKBACK_DAYS='30' \
DEVICECTL_CHILD_OPENVITALS_IOS_AUTO_QA='1' \
xcrun devicectl device process launch \
  --device '<IOS_DEVICE_ID>' \
  --terminate-existing \
  com.example.openvitals.healthkitdemo
```

如果怀疑 `DEVICECTL_CHILD_` 没有传进 app，可以改用显式 JSON environment flag。注意这段 JSON 含 bearer token，不要打印或提交：

```bash
ENV_JSON="$(node - <<'NODE'
const fs = require("fs");
const p = JSON.parse(fs.readFileSync("/tmp/openvitals-apple-bootstrap.json", "utf8"));
const token = p.tokens.find((row) => row.label === "full")?.token;
if (!token) process.exit(2);
process.stdout.write(JSON.stringify({
  OPENVITALS_IOS_BASE_URL: "http://<Mac-LAN-IP>:3000",
  OPENVITALS_IOS_USER_ID: "user_live_apple_hw",
  OPENVITALS_IOS_BEARER_TOKEN: token,
  OPENVITALS_IOS_LOOKBACK_DAYS: "30",
  OPENVITALS_IOS_MAX_RECORDS_PER_TYPE: "1",
  OPENVITALS_IOS_AUTO_QA: "1"
}));
NODE
)"
xcrun devicectl device process launch \
  --device '<IOS_DEVICE_ID>' \
  --terminate-existing \
  --environment-variables "$ENV_JSON" \
  com.example.openvitals.healthkitdemo
```

支持的环境变量包括：

- `OPENVITALS_IOS_BASE_URL`
- `OPENVITALS_IOS_USER_ID`
- `OPENVITALS_IOS_BEARER_TOKEN`
- `OPENVITALS_IOS_SESSION_TOKEN`
- `OPENVITALS_IOS_LOOKBACK_DAYS`
- `OPENVITALS_IOS_MAX_RECORDS_PER_TYPE`
- `OPENVITALS_IOS_AUTO_QA`

`OPENVITALS_IOS_AUTO_QA=1` 会在启动时自动执行硬件 QA 流程：请求 HealthKit 权限、创建 Apple Health session，并在用户允许系统弹窗后启动 initial anchored sync。不要在日志里打印 token，也不要提交 bootstrap JSON。

`OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1` 只适合硬件 smoke：每个 HealthKit 类型最多上传 1 条记录，并且不会推进本地 HealthKit anchor，因此后续完整同步仍然能上传完整历史。正式同步和 release 验收不要设置它。

## 查找 HealthKit 权限页

OpenVitals 第一次调用 HealthKit 时，iOS 会在 app 前台弹出 Health access sheet。这个界面属于 Apple 的隐私控制面，Mac 端不能通过 `devicectl` 帮你点掉。

在这个页面上，为 QA 打开所有所需的 read categories：

- Heart Rate
- Heart Rate Variability / HRV SDNN
- Resting Heart Rate
- Steps
- Sleep
- Workouts

如果权限页被关闭、手机锁屏，或你之后需要再次检查设置，可在 iPhone 上用这些路径：

1. Settings -> Health -> Data Access & Devices -> OpenVitals。
2. Health app -> 右上角头像 -> Privacy -> Apps -> OpenVitals。
3. 某些 iOS 版本也可从 Settings -> Privacy & Security -> Health -> OpenVitals 进入。

如果列表里还没有 OpenVitals，先打开 app 并点击一次 **Request HealthKit Permission**。iOS 常常要等 app 至少请求过一次 HealthKit，才会把它列出来。

如果 iOS 弹出 Local Network 权限，也要允许，因为真机 QA app 需要通过 `http://<Mac-LAN-IP>:3000` 访问 Mac 上的 API。之后可在 Settings -> Privacy & Security -> Local Network -> OpenVitals 里复查。

如果 HealthKit 已经授权，但 app 日志或界面出现：

```text
NSURLErrorDomain Code=-1001 "The request timed out."
NSErrorFailingURLStringKey=http://<Mac-LAN-IP>:3000/v1/users/.../ingest/apple-health
```

说明 HealthKit 已返回，app 也走到了上传步骤，但 iOS 无法连到 Mac API。检查：

1. iPhone Settings -> Privacy & Security -> Local Network -> OpenVitals 已开启。
2. Mac API 使用 `HOST=0.0.0.0` 启动，而不是 `127.0.0.1`。
3. iPhone 和 Mac 在同一网络，VPN / 防火墙没有隔离局域网流量。
4. Mac 侧 `curl http://<Mac-LAN-IP>:3000/v1/openapi.json` 成功。
5. iPhone Safari 也能打开 `http://<Mac-LAN-IP>:3000/v1/openapi.json`。

Mac 侧一个有用的诊断方式：

```bash
xcrun devicectl device info processes --device <IOS_DEVICE_ID> \
  | rg "OpenVitals|HealthPrivacy"
```

如果你看到了 `HealthPrivacyService`，通常说明 iPhone 正在等待 Health 权限 UI 完成。如果服务端 `/sync-status` 仍是 `authState=not_connected`，且 `/timeline` 还是空数组，通常就是用户还没完成 HealthKit 权限页。

Apple 的隐私设计并不会让 app 明确知道读权限是否被授予。空的 HealthKit query 既可能代表没权限，也可能代表确实没有对应数据，因此单看 `timelineCount=0` 不能区分两者。

使用 `--console` 启动时，app 会输出 `[OpenVitalsHardwareQA]` 前缀的 breadcrumbs，用来确认 launch env 是否传入、auto-QA 是否启动，以及失败卡在哪一步；这些日志不会打印 bearer 或 session token。

一条健康的 smoke 日志通常包含这些阶段：

```text
[OpenVitalsHardwareQA] launch env applied: base URL
[OpenVitalsHardwareQA] launch env applied: bearer token
[OpenVitalsHardwareQA] HealthKit authorization returned
[OpenVitalsHardwareQA] connector session ready
[OpenVitalsHardwareQA] HealthKit heart_rate records: ...
[OpenVitalsHardwareQA] smoke upload capped at 1 record(s) per type; local anchor will not advance
[OpenVitalsHardwareQA] uploading chunk 1/1 with 5 record(s)
[OpenVitalsHardwareQA] hardware QA sync complete
```

## 常见 Xcode 打包失败

### Missing bundle ID

错误：

```text
Simulator device failed to install the application.
Missing bundle ID.
```

原因：生成的 Xcode project 使用了只在 shell 中存在的 bundle ID 变量，而 Xcode GUI 没有继承这些环境变量。

修复：在 `project.yml` 中保留默认的 `OPENVITALS_IOS_BUNDLE_ID` 和 `OPENVITALS_WATCH_BUNDLE_ID`，或者在 Xcode build settings / `xcodebuild` 中显式设置。

### Watch companion bundle identifier missing

错误：

```text
The Watch app within this app must specify the key WKCompanionAppBundleIdentifier
```

原因：嵌入的 watchOS app 没有声明 iPhone app 的 bundle identifier。

修复：在 `project.yml` 的 watchOS target Info.plist properties 中设置：

```yaml
WKCompanionAppBundleIdentifier: "$(OPENVITALS_IOS_BUNDLE_ID)"
```

修改后重新运行 `xcodegen generate`。

## 运行 iPhone companion

在 iPhone app 中：

1. 把 API base URL 设置为 `http://<Mac-LAN-IP>:3000`。
2. 设置 User ID，例如 `user_live_apple_hw`。
3. 粘贴 bootstrap 返回的 bearer token。
4. 如果还没有 session token，就先留空。
5. 点击 Save。
6. 点击 Request HealthKit Permission。
7. 授权 heart rate、HRV SDNN、resting heart rate、steps、sleep 和 workouts。
8. 点击 Connect Apple Health Session。
9. 点击 Initial Sync。
10. 点击 Refresh Sync Status。

在 Mac 上验证：

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live_apple_hw/sync-status" | jq

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live_apple_hw&days=30" | jq
```

预期 timeline entries 应包含真实 HealthKit samples，且具备 unit、timestamp、source revision bundle ID、device metadata、source record ID、anchor state 和 `captureMode=direct`。

这次硬件 smoke 中采集到的证据示例：

```text
HealthKit query counts for 1-day lookback:
- heart_rate: 178
- hrv_sdnn: 2
- resting_heart_rate: 1
- steps: 31
- sleep_analysis: 9
- workouts: 0

Smoke upload:
- OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1
- Uploaded: 5 records
- sync_status apple-health: connected
- lastIngestRecordCount: 5
- lastAcceptedRecordCount: 5
- lastDroppedRecordCount: 0
- timeline metrics: heart_rate, hrv_sdnn, resting_heart_rate, steps, sleep
```

## Apple Watch 历史数据

watchOS app 不是上传历史 Apple Watch 数据的前提。历史样本的路径是：

```text
Apple Watch -> Apple Health on iPhone -> OpenVitals iPhone companion -> OpenVitals API
```

只要 Watch 已把 heart rate、workout、sleep 或其他支持样本写进 Apple Health，在 iPhone app 里点击 Sync Now，再查看 `/v1/timeline` 即可。

历史 Watch 数据应继续保持 `sample` 或 `episode`，`latencyClass=delayed_sync` 或 `near_realtime`。不要把它标成 `live_signal`。

## Apple Watch 实时 workout HR

watchOS app 只用于明确的 live workout heart-rate capture。它应当：

1. 使用与 iPhone app 相同的 API base URL、user ID、bearer token 和 session token。
2. 在 Watch 上请求 HealthKit / workout 权限。
3. 启动 `HKWorkoutSession` 和 `HKLiveWorkoutBuilder`。
4. 在 workout 活跃期间上传心率记录。
5. 当用户点击 Stop 时干净结束。

验证：

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live_apple_hw&days=1" \
  | jq '.[] | select(.metric=="live_workout_heart_rate")'
```

预期记录：

- `metric=live_workout_heart_rate`
- `dataGranularity=live_signal`
- `latencyClass=live`
- `captureMode=direct`
- tags 中包含 `connection_mode:device_pairing` 与 `source_product:apple_watch`

### Watch App Simulator / Generic Build 验证

当真实 Apple Watch 还没在 Xcode 中可见时，仍然可以先运行这些非硬件检查来尽早发现打包和目标架构问题：

```bash
xcrun devicectl list devices
xcrun xctrace list devices
xcodebuild -project examples/mobile-ios-minimal-app/OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsWatchDemo \
  -showdestinations
xcodebuild -project examples/mobile-ios-minimal-app/OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsWatchDemo \
  -configuration Debug \
  -destination 'id=<WATCH_SIMULATOR_ID>' \
  CODE_SIGNING_ALLOWED=NO build
xcrun simctl boot <WATCH_SIMULATOR_ID>
xcrun simctl install <WATCH_SIMULATOR_ID> \
  ~/Library/Developer/Xcode/DerivedData/OpenVitalsHealthKitDemo-*/Build/Products/Debug-watchsimulator/OpenVitalsWatchDemo.app
xcrun simctl launch <WATCH_SIMULATOR_ID> ai.openvitals.healthkitdemo.watch
xcrun simctl io <WATCH_SIMULATOR_ID> screenshot /tmp/openvitals-watch-sim.png
xcodebuild -project examples/mobile-ios-minimal-app/OpenVitalsHealthKitDemo.xcodeproj \
  -scheme OpenVitalsWatchDemo \
  -configuration Debug \
  -destination 'generic/platform=watchOS' \
  CODE_SIGNING_ALLOWED=NO build
```

健康的 simulator 证据包括：

- `xcodebuild` 能在 watchOS Simulator destination 上成功；
- `xcrun simctl install` 和 `xcrun simctl launch` 成功；
- 截图中能看到 `OpenVitals` watch app 与 optional live HR setup form；
- app bundle 声明了 `WKApplication=true`、`CFBundleIdentifier=ai.openvitals.healthkitdemo.watch`、`WKCompanionAppBundleIdentifier=ai.openvitals.healthkitdemo`；
- `xcodebuild` 也能通过 `generic/platform=watchOS`，证明 watchOS device architectures 的编译链路没坏。

这些检查仍不能证明 HealthKit workout 权限、真实 Apple Watch 传感器样本或 live heart-rate upload。如果 `devicectl`、`xctrace` 与 `xcodebuild -showdestinations` 只看到 iPhone 和 simulator placeholder，而没有真实 Watch destination，那么物理 Watch 路径依然是 blocked。

## Background Delivery

HealthKit background delivery 由 iOS 控制。请把它视为 scheduler-mediated background sync，而不是保证实时监控。

测试步骤：

1. 先执行 Initial Sync。
2. 点击 Enable HealthKit Background Delivery。
3. 生成或等待一个新的 HealthKit sample。
4. 把 app 切到后台。
5. 等待 iOS 调度投递。
6. 如果测试窗口内 iOS 没调度，就用 Sync Now 证明同一套 anchors 支持 incremental upload。

手动 Sync Now 只能证明 anchor reuse 与 incremental ingestion；它不等于 OS-scheduled background delivery 已被验证。

## Mirrored Oura / WHOOP Data

如果 Oura 或 WHOOP 会写入 Apple Health：

- iPhone companion 应把这些记录以上传 `captureMode=mirrored`；
- 保留原始 source app bundle ID，例如 `com.ouraring.oura` 或 `com.whoop.mobile`；
- 在同一 metric / window 上，direct Oura / WHOOP 通常应压过 mirrored Apple Health 副本；
- `/v1/explain/...` 应写出 winner、被抑制的 mirrored source 和原因。

不要把 mirrored Oura / WHOOP Apple Health samples 描述成 direct Apple Watch data。

## 需要保存的证据

发布验收时，保存带时间戳的证据：

- `xcrun devicectl list devices`，证明真实 iPhone 可用；
- iPhone target 的 Xcode build / run 结果或 `xcodebuild` 输出；
- HealthKit 权限弹窗或 Settings -> Health -> Data Access & Devices 的截图；
- iPhone app 的 Initial Sync 状态；
- `/v1/users/:id/sync-status` 响应；
- 含真实 HealthKit records 的 `/v1/timeline` 响应；
- Watch app 正在推 live workout HR 时的截图；
- 含 `live_workout_heart_rate` 且标记为 `live_signal` 的 `/v1/timeline` 响应；
- 如果存在 mirrored Apple Health records，再保存 dedupe / explain 输出。

在这些证据出现之前，`docs/hardware-test-plan-zh.md` 中的相关硬件条目都应保持 `pending-hardware`。
