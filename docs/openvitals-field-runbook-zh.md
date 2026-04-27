# OpenVitals 项目现场运行手册

> 语言： [English](./openvitals-field-runbook.md) | [简体中文](./openvitals-field-runbook-zh.md)


最后核对日期：2026-04-27。

这份手册记录这次把 OpenVitals 从本地 demo 推到真实 Oura、WHOOP、OpenRouter、OpenClaw、iPhone HealthKit、Apple Watch 硬件路径时遇到的步骤、坑和验证方式。目标读者是两类人：

- 开源用户：想把 OpenVitals 在自己机器上跑起来，并接入真实设备或 provider。
- 开发者 / agent：要复现长程开发、OMX 多 agent 工作流、E2E 和硬件 QA。

真实密钥、OAuth code、access token、refresh token、Apple Team ID、设备 UDID 不应写入仓库。文档只能记录变量名、获取位置、测试方法和可公开的错误处理经验。

## 1. 仓库和依赖初始化

推荐环境：

- macOS，Homebrew 可用。
- Node.js 22+。
- pnpm 10.x。
- 如果要跑 iOS / watchOS 真机，安装完整 Xcode，不是只有 Command Line Tools。

从干净仓库开始：

```bash
cd <path-to-openvitals>
git submodule update --init --recursive
pnpm install
```

如果非登录 shell 找不到 `pnpm`，先补上常见路径：

```bash
PATH=/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH
pnpm -v
```

基础验证顺序：

```bash
pnpm docs:generate
pnpm build
pnpm test
pnpm smoke:e2e
pnpm typecheck
```

常用专项验证：

```bash
pnpm smoke:apple-health
pnpm openclaw:e2e
pnpm llm:openrouter:smoke
```

注意事项：

- 不要手改 `docs/generated/`；运行 `pnpm docs:generate` 生成。
- `.env`、`.env.local`、`.env.live.local` 都应保持本地私有，不提交。
- 不要盲目 `source .env`。很多 dotenv 文件允许未转义空格、引号或注释，shell 不一定能正确解析。脚本里优先用项目内 dotenv loader，临时终端里只 `export` 当前命令需要的变量。
- 如果已经接入真实 provider，`OPENVITALS_SECRETS_KEY` 要稳定保存。更换它会导致旧 provider credential 无法解密，需要重新 OAuth。

## 2. 本地 live API 启动

开发机上本地 API：

```bash
OPENVITALS_MODE=live PORT=3000 pnpm demo
```

真机 iPhone / Apple Watch 访问 Mac 时，不要只绑定 loopback。要让设备访问局域网 IP：

```bash
HOST=0.0.0.0 PORT=3000 OPENVITALS_MODE=live pnpm demo
ipconfig getifaddr en0
```

在 iPhone / Watch app 中使用：

```text
http://<Mac-LAN-IP>:3000
```

`http://127.0.0.1:3000` 在物理 iPhone 上指向 iPhone 自己，不是 Mac。

真机硬件 QA 优先使用局域网地址。临时 HTTPS tunnel 适合 OAuth callback 或 GET 连通性探测，但这次现场验证中，localtunnel 出现过 `503 Tunnel Unavailable`，Cloudflare quick tunnel 在 Apple Health ingest 上出现过 `413 Payload Too Large` 和 `524 A timeout occurred`。如果必须用 tunnel，先跑小样本 smoke；不要把 tunnel 成功等同于正常局域网同步成功。

创建 live 用户和 agent token：

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Live User","timezone":"Asia/Shanghai","providers":["apple-health","oura","whoop"],"createTokens":true}'
```

保存响应里的 derived/full token 到本地环境变量：

```bash
export OPENVITALS_AGENT_TOKEN="<bootstrap-returned-token>"
```

常用检查：

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live/sync-status" | jq

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live&days=30" | jq
```

## 3. OpenRouter 大模型接入

OpenRouter 用于 OpenVitals 的 LLM smoke、OpenClaw / agent loop 的模型 provider 之一。官方文档说明 API key 使用 Bearer token，OpenRouter 也兼容 OpenAI 风格的 chat completions。

本地变量：

```bash
OPENROUTER_API_KEY="<openrouter-api-key>"
OPENVITALS_LLM_PROVIDER=openrouter
OPENVITALS_OPENROUTER_API_URL=https://openrouter.ai/api/v1

# 可选。留空时 smoke 会尝试选择低价 text chat model。
OPENVITALS_OPENROUTER_MODEL=""
OPENVITALS_OPENROUTER_MAX_TOKENS=8
OPENVITALS_OPENROUTER_MAX_ATTEMPTS=8
OPENVITALS_OPENROUTER_ALLOW_FREE=false
```

验证：

```bash
pnpm llm:openrouter:smoke
```

经验记录：

- 只测试连通性时，用最低价模型和极小 `max_tokens`。
- 免费模型可能限流或不可用；稳定 smoke 可以设置 `OPENVITALS_OPENROUTER_ALLOW_FREE=false`。
- 命令应只输出选中的模型、简短回复和 token usage，不应打印 API key。

更多细节见 [OpenRouter LLM](./openrouter-llm-zh.md)。

## 4. Oura 凭据、OAuth 和语义

Oura 常被误写成 Aura；项目内统一使用 `Oura` 和 provider id `oura`。

需要的本地变量：

```bash
OPENVITALS_OURA_CLIENT_ID="<oura-client-id>"
OPENVITALS_OURA_CLIENT_SECRET="<oura-client-secret>"
OPENVITALS_OURA_REDIRECT_URI="http://localhost:3000/v1/connect/callback/oura"
OPENVITALS_OURA_API_URL="https://api.ouraring.com"
```

本地 OAuth 的关键点：

- Oura app 里登记的 Redirect URI 必须和请求里的 `redirect_uri` 完全一致，包括 `localhost` vs `127.0.0.1`、端口、路径。
- 如果浏览器和 API 都在同一台 Mac 上，`http://localhost:3000/v1/connect/callback/oura` 可以本地测试，因为 provider 最终是让你的浏览器跳回本机。
- 如果要让手机或外部网络完成回调，需要 ngrok、Cloudflare Tunnel 或正式 HTTPS 域名。
- 必须在已经登录 Oura 的浏览器 session 内完成授权。之前遇到过 Chrome 已登录、in-app browser 未登录导致看似拿不到 session 的情况；反过来也可能发生。
- 回调 URL 形如 `/v1/connect/callback/oura?code=...&state=...` 时，不要把一次性 `code` 写进文档或 issue。

示例授权 URL 结构：

```text
https://cloud.ouraring.com/oauth/authorize
  ?client_id=<oura-client-id>
  &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fv1%2Fconnect%2Fcallback%2Foura
  &response_type=code
  &scope=email+personal+daily+heartrate+tag+workout+session+spo2+ring_configuration+stress+heart_health
```

实际 scopes 应按最小权限原则选择；不同 Oura app / account 可用 scope 可能不同。

OpenVitals 语义要求：

- `/v2/usercollection/heartrate` 的心率行是 `dataGranularity=sample`，不是 `live_signal`。
- Daily sleep、readiness、SpO2、stress 是 provider-mediated daily summary / score。
- Oura cloud API 不应被描述成连续原始传感器流。
- 如果 Oura 同时写入 Apple Health，Apple Health 里的 Oura 记录应标为 `captureMode=mirrored`；直接 Oura cloud 数据通常应在同 metric/window 下胜出。

联通检查：

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live/sync-status" | jq

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live&source=oura&days=30" | jq
```

## 5. WHOOP 凭据、OAuth、webhook 和语义

需要的本地变量：

```bash
OPENVITALS_WHOOP_CLIENT_ID="<whoop-client-id>"
OPENVITALS_WHOOP_CLIENT_SECRET="<whoop-client-secret>"
OPENVITALS_WHOOP_REDIRECT_URI="http://127.0.0.1:3000/v1/connect/callback/whoop"
OPENVITALS_WHOOP_WEBHOOK_SECRET="<local-webhook-secret>"
```

可选覆盖：

```bash
OPENVITALS_WHOOP_API_URL="https://api.prod.whoop.com"
OPENVITALS_WHOOP_AUTH_URL="https://api.prod.whoop.com/oauth/oauth2/auth"
OPENVITALS_WHOOP_TOKEN_URL="https://api.prod.whoop.com/oauth/oauth2/token"
OPENVITALS_WHOOP_SCOPE="read:profile read:recovery read:cycles read:sleep read:workout read:body_measurement"
```

WHOOP app 创建经验：

- Developer Dashboard 里至少需要一个 redirect URL。
- OAuth 请求里的 redirect URL 必须和 Dashboard 配置一致。
- Scopes 只申请 OpenVitals 实际需要的内容。
- 创建 app 后会拿到 Client ID 和 Client Secret；secret 只进本地 `.env*`。

Webhook 是否需要：

- OAuth 和手动 sync 不依赖 webhook，可以先不配置公网 webhook。
- 如果要 provider event 驱动的同步，再配置 webhook。
- 当前如果只是用本地 shared secret 检查，要在文档和 API 输出里标注为 dev/local webhook security；不要声称已经实现官方签名验证，除非代码和官方文档都验证过。

WHOOP 数据语义：

- WHOOP cloud API 提供 recovery、cycle、sleep、workout、strain、HRV、resting HR、heart-rate-zone summary 等 provider-mediated 数据。
- 它不是连续 raw HR streaming。
- 增量同步要尊重 `updated_at`、时间窗口、分页 token、429 rate limit。
- 如果 WHOOP 同时写入 Apple Health，Apple Health 里的 WHOOP 记录应标为 `captureMode=mirrored`；直接 WHOOP cloud 数据通常应在同 metric/window 下胜出。

联通检查：

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live/sync-status" | jq

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live&source=whoop&days=30" | jq
```

## 6. Apple Health、iPhone App 和 Apple Watch App

Apple Health 没有服务器端云 API key。OpenVitals 必须通过用户设备侧授权采集：

```text
Apple Watch / Health app -> iPhone HealthKit -> OpenVitals iPhone companion -> OpenVitals API
```

合理 UX：

- iPhone app 应作为主要必装连接器：登录、配置 API、请求 HealthKit 权限、历史同步、增量同步、后台投递、手动 Sync Now、展示同步状态。
- Apple Watch app 应作为可选组件：只在用户需要 live workout heart-rate capture 时安装和使用。
- 历史 Apple Watch 心率、HRV、睡眠、workout 通常通过 iPhone HealthKit 被 iPhone app 上传，不需要 Watch app 常驻。
- `live_signal` 只用于 active workout session 中的 `HKWorkoutSession` / `HKLiveWorkoutBuilder` 路径。普通 HealthKit 历史样本是 `sample` / `episode`，延迟类别是 `near_realtime` 或 `delayed_sync`。
- 默认 `OpenVitalsHealthKitDemo` scheme 只构建 iPhone app。`OpenVitalsWatchDemo` 是独立可选 scheme，避免 iPhone HealthKit 验证被 Watch provisioning profile 阻塞。

自动化可覆盖：

```bash
pnpm --filter @openvitals/collector-ios test
pnpm smoke:apple-health
```

Xcode project 生成和 simulator build：

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

Apple Watch app 可以在没有真表时先做构建、安装和启动验证；下面命令从仓库根目录运行：

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

这类自动化只能证明：

- Watch simulator target 能编译。
- Watch app 能安装和启动。
- 截图能看到 `OpenVitals` 和 optional live HR setup 表单。
- app bundle 里有 `WKApplication=true`、`CFBundleIdentifier=ai.openvitals.healthkitdemo.watch`、`WKCompanionAppBundleIdentifier=ai.openvitals.healthkitdemo`。
- `generic/platform=watchOS` 能编译，说明真机架构编译链路没坏。

它不能证明真实 HealthKit workout 权限、Apple Watch 传感器样本、live workout HR 上传。如果 `devicectl`、`xctrace` 和 `xcodebuild -showdestinations` 只看到 iPhone、watchOS simulator placeholder，而没有物理 Apple Watch destination，就不能把 Watch live HR 硬件验收标为完成；需要先让已配对 Apple Watch 解锁、开启 Developer Mode，并出现在 Xcode destinations 中。

真机验证仍需要人和硬件：

- iPhone 信任 Mac。
- iPhone / Apple Watch 开启 Developer Mode。
- Xcode 登录 Apple Developer Team。
- 本机存在有效 code signing identity / provisioning profile。
- 用户在 iPhone / Watch 上授予 HealthKit 权限。
- 用户启动和停止 Watch live workout session。

完整步骤和错误处理见 [iOS Hardware QA Runbook](./ios-hardware-runbook-zh.md)。

## 7. Xcode 细节和已遇到的错误

必须安装完整 Xcode：

```bash
xcodebuild -version
xcrun xcode-select -p
```

期望：

```text
/Applications/Xcode.app/Contents/Developer
```

如果看到：

```text
/Library/Developer/CommandLineTools
```

切换：

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

如果报：

```text
xcode-select: error: invalid developer directory '/Applications/Xcode.app/Contents/Developer'
```

说明完整 Xcode 还没装好，或者路径不是 `/Applications/Xcode.app`。先从 App Store / Apple Developer 下载并完成首次启动。

Xcode 首次启动的 “Select the components you want to get started with”：

- 只做 macOS 工具不够。
- 要 build/run iPhone app，选 iOS platform support。
- 要 build/run Apple Watch app，选 watchOS platform support。

设备和签名检查：

```bash
xcrun devicectl list devices
xcrun xctrace list devices
security find-identity -p codesigning -v
```

已遇到的问题：

- `Developer Mode disabled`：在 iPhone / Watch 的 Settings -> Privacy & Security -> Developer Mode 开启，重启并确认。
- `0 valid identities found`：Xcode 尚未配置 Apple Developer 账号或签名证书；打开 Xcode -> Settings -> Accounts，登录并启用 automatic signing。
- Personal Team 可以用于本地 iPhone HealthKit 开发；使用自己的 bundle id namespace，不要误用无关公司 team。安装后如果 iOS 拦截启动，需要在 iPhone 的 Settings -> General -> VPN & Device Management 里信任 Apple Development profile。
- 如果 Personal Team 构建 Watch target 报没有可用于 profile 的 Watch 设备，先用 iPhone-only scheme 验证 HealthKit 历史同步；等 paired Watch 在 Xcode 可用后再跑可选 watchOS scheme。
- simulator 可以 `CODE_SIGNING_ALLOWED=NO`，真机不行。
- 物理 iPhone app 访问 API 时不能使用 `127.0.0.1`，要用 Mac 局域网 IP。
- 真机签名的 CLI 覆盖最稳方式是直接传 `DEVELOPMENT_TEAM=<TEAM_ID> PRODUCT_BUNDLE_IDENTIFIER=<bundle-id> CODE_SIGN_STYLE=Automatic`。项目里也有 `OPENVITALS_APPLE_TEAM_ID` / `OPENVITALS_IOS_BUNDLE_ID` build setting，但在本机测试中直接传这两个自定义变量没有被 signing 阶段可靠解析。
- 如果 `devicectl` launch 报 `Unable to launch ... because the device was not, or could not be, unlocked` 或 `SBMainWorkspace ... reason: Locked`，说明 iPhone 在权限/Settings 步骤后锁屏了。解锁 iPhone，保持亮屏或让 OpenVitals 在前台，再重新 launch；Mac 不能代替用户解锁。
- 真机 QA 时间较长时，可以临时在 iPhone 的 Settings -> Display & Brightness -> Auto-Lock 里调长锁屏时间，测完再恢复。
- 生成的 Xcode project 是产物，`project.yml` 才是源文件。

iPhone app 支持通过 `devicectl` launch environment 预填硬件 QA 配置，避免在手机上手输长 token：

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

如果怀疑 `DEVICECTL_CHILD_` 环境变量没有进入 app，可以改用 `devicectl` 的显式 JSON environment flag。注意这段 JSON 包含 bearer token，不要打印到日志或提交到仓库：

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

支持的 app 环境变量是 `OPENVITALS_IOS_BASE_URL`、`OPENVITALS_IOS_USER_ID`、`OPENVITALS_IOS_BEARER_TOKEN`、`OPENVITALS_IOS_SESSION_TOKEN`、`OPENVITALS_IOS_LOOKBACK_DAYS`、`OPENVITALS_IOS_MAX_RECORDS_PER_TYPE`、`OPENVITALS_IOS_AUTO_QA`。`OPENVITALS_IOS_AUTO_QA=1` 会在启动后请求 HealthKit 权限，并在用户允许系统弹窗后创建 Apple Health session、执行 initial anchored sync。`DEVICECTL_CHILD_` 前缀只用于从 Mac 传给设备进程。

`OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1` 只用于硬件 smoke：每个 HealthKit 类型最多上传 1 条记录，并且不会推进本地 HealthKit anchor，因此后续完整同步仍然可以上传完整历史。正常同步和 release 验收不要设置这个变量。

HealthKit 权限页查找路径：

- 第一次请求时，iOS 会在 OpenVitals 前台弹出 Health access 页面；Mac 端不能代点。
- 如果弹窗被关掉或手机锁屏后找不到，打开 iPhone 的 Settings -> Health -> Data Access & Devices -> OpenVitals。
- 也可以从 Health app 进入：点右上角头像 -> Privacy -> Apps -> OpenVitals。
- 有些 iOS 版本也能从 Settings -> Privacy & Security -> Health -> OpenVitals 进入。
- 如果列表里没有 OpenVitals，先打开 OpenVitals app 并点一次 `Request HealthKit Permission`，iOS 通常要等 app 首次请求 HealthKit 后才把它列出来。
- 如果出现 Local Network 权限，也要允许；真机 app 通过 `http://<Mac-LAN-IP>:3000` 访问 Mac API。
- 如果后来要重新检查 Local Network，打开 iPhone Settings -> Privacy & Security -> Local Network -> OpenVitals。

如果 HealthKit 已授权，但 app 日志或界面出现：

```text
NSURLErrorDomain Code=-1001 "The request timed out."
NSErrorFailingURLStringKey=http://<Mac-LAN-IP>:3000/v1/users/.../ingest/apple-health
```

说明 HealthKit 已经返回，app 已走到上传步骤，但 iOS 无法连到 Mac API。检查：

- iPhone Settings -> Privacy & Security -> Local Network -> OpenVitals 已打开。
- API 使用 `HOST=0.0.0.0` 启动，而不是只绑 `127.0.0.1`。
- iPhone 和 Mac 在同一网络，VPN/防火墙没有隔离局域网。
- Mac 侧 `curl http://<Mac-LAN-IP>:3000/v1/openapi.json` 能成功。
- iPhone Safari 也能打开 `http://<Mac-LAN-IP>:3000/v1/openapi.json`。

现场判断方法：如果 `xcrun devicectl device info processes` 里看到 `HealthPrivacyService`，而服务端 `/sync-status` 仍是 `authState=not_connected`、`/timeline` 仍是空数组，通常就是 HealthKit 权限页还没有完成。Apple 出于隐私设计不让 app 明确知道用户是否授予 read 权限；空查询既可能是没权限，也可能是真的没有对应数据。

用 `devicectl --console` 启动时，app 会输出 `[OpenVitalsHardwareQA]` 前缀的硬件 QA breadcrumbs，用于确认 launch env 是否进入 app、auto-QA 是否启动、失败卡在哪一步；日志不会打印 bearer/session token。

健康的硬件 smoke 日志应该能看到这些阶段：

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

本次真机 smoke 证据：

```text
1-day HealthKit 查询结果：
- heart_rate: 178
- hrv_sdnn: 2
- resting_heart_rate: 1
- steps: 31
- sleep_analysis: 9
- workouts: 0

上传结果：
- OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1
- uploaded: 5 records
- sync_status apple-health: connected
- lastIngestRecordCount: 5
- lastAcceptedRecordCount: 5
- lastDroppedRecordCount: 0
- timeline metrics: heart_rate, hrv_sdnn, resting_heart_rate, steps, sleep
```

## 8. OpenClaw 子模块和 E2E

OpenVitals 把 OpenClaw pin 在：

```text
vendor/openclaw
```

初始化：

```bash
git submodule update --init --recursive
pnpm openclaw:e2e
```

`pnpm openclaw:e2e` 会验证：

- OpenClaw CLI 能启动并报告版本。
- OpenVitals demo API 能启动。
- OpenVitals MCP server 可以通过 stdio 处理 `initialize`、`tools/list`、`health.sync_status`、`health.daily_brief`。
- OpenClaw skill/workspace assets 能生成。
- 输出的数据包含 freshness、granularity、source semantics。

它不覆盖：

- 真实 OpenClaw agent loop 的模型调用，除非配置 OpenAI / Anthropic / Gemini / OpenRouter key。
- 真实 Oura / WHOOP OAuth。
- iPhone / Apple Watch 硬件 HealthKit 授权。

更多细节见 [OpenClaw Submodule E2E](./openclaw-e2e-zh.md)。

## 9. OMX / agent workflow 长程任务

长任务不要塞在命令行里，放到文件：

```bash
pnpm agent:workflow start --description-file docs/agent-tasks/openvitals-v0.6.md
```

生成或更新 OMX team plan：

```bash
pnpm agent:workflow omx-plan \
  --run openvitals-v0.6 \
  --phase all \
  --workers 6 \
  --model gpt-5.5 \
  --reasoning xhigh
```

从 tmux leader pane 启动：

```bash
pnpm agent:workflow omx-run \
  --run openvitals-v0.6 \
  --phase all \
  --workers 6 \
  --model gpt-5.5 \
  --reasoning xhigh \
  --start
```

也可以通过 worker launch args 显式传模型：

```bash
OMX_TEAM_WORKER_LAUNCH_ARGS='--model gpt-5.5 -c model_reasoning_effort="xhigh"' \
pnpm agent:workflow omx-run --run openvitals-v0.6 --phase all --workers 6 --start
```

已遇到的问题和处理：

- `Team mode requires running inside tmux current leader pane`：先进入 tmux，再从 leader pane 运行。
- `leader_workspace_dirty_for_worktrees`：worktree 模式要求 leader 工作树干净。先 commit、stash 或清理自己的未提交改动。不要回滚别人改动。
- `failed to create worker pane ... no space for new pane`：tmux pane 空间不足。减少 worker 数量到 5 或 6，调大窗口、缩小字体，或改用更少并发。
- worker 看似没动静时，先看 leader pane、worker mailbox 和 `.agent-workflows/<run>/reports/`。如果所有 worker 都报告 idle 且 verify 已通过，team 不一定会自动退出；由 leader 执行 shutdown。
- 停掉遗留 session：

```bash
tmux ls
tmux kill-session -t <session-name>
```

如果 OMX 提供 shutdown 命令，优先从 leader 使用：

```bash
omx team shutdown <team-session-name>
```

验收：

```bash
pnpm agent:workflow verify --run openvitals-v0.6
```

验证报告在：

```text
.agent-workflows/openvitals-v0.6/reports/
```

硬件 gate 不应由 agent 编造通过。没有 Oura/WHOOP/iPhone/Watch 的真实证据时，应标为 pending-hardware，并写清楚需要什么证据。

更多细节见 [Agent Orchestrator](./agent-orchestrator-zh.md)。

## 10. 数据语义和用户承诺边界

开源项目和 agent 文案必须保持这些边界：

- OpenVitals 是 wellness/coaching data plane，不是诊断系统或医疗器械。
- Provider raw payload、platform sample、normalized episode、daily summary、score、live signal 要区分。
- Oura / WHOOP cloud 数据是 provider-mediated，通常是 delayed sync / daily，不是连续 raw sensor stream。
- Apple Watch live HR 只有在 live workout collector 路径运行时才是 `live_signal`。
- iPhone HealthKit 后台投递是系统调度，不是服务器随时 polling HealthKit。
- mirrored Apple Health records 必须保留 provenance，但 normalized views 应避免和 direct Oura / WHOOP 双计。
- API / MCP / dashboard / explanation 输出中应暴露 freshness、confidence、granularity、latency、capture mode。

## 11. 证据保存模板

每次真实验收都应保存这些证据到 issue、PR 或 release QA report：

```text
Run:
Date/time:
Commit:
Machine:
OpenVitals mode:

Commands:
- pnpm docs:generate
- pnpm build
- pnpm test
- pnpm smoke:e2e
- pnpm typecheck
- pnpm smoke:apple-health
- pnpm openclaw:e2e
- pnpm llm:openrouter:smoke

Provider evidence:
- Oura OAuth completed: yes/no
- Oura sync_status excerpt:
- Oura timeline excerpt:
- WHOOP OAuth completed: yes/no
- WHOOP sync_status excerpt:
- WHOOP timeline excerpt:

Apple evidence:
- xcrun devicectl list devices excerpt:
- iPhone app build/run result:
- HealthKit permission screenshot:
- Initial Sync status:
- Apple Watch live workout screenshot:
- live_workout_heart_rate timeline excerpt:

Dedupe evidence:
- Oura mirrored Apple Health case:
- WHOOP mirrored Apple Health case:
- explain_dedupe output:

Limitations:
- Missing hardware:
- Missing provider scope:
- Stale data:
- Manual step not completed:
```

## 12. 官方参考

- Oura Cloud API authentication: <https://cloud.ouraring.com/docs/authentication>
- Oura applications: <https://cloud.ouraring.com/oauth/applications>
- WHOOP getting started: <https://developer.whoop.com/docs/developing/getting-started/>
- WHOOP OAuth: <https://developer.whoop.com/docs/developing/oauth>
- WHOOP API reference: <https://developer.whoop.com/api>
- OpenRouter authentication: <https://openrouter.ai/docs/api-reference/authentication>
- OpenRouter chat completions: <https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request>
- Apple Developer Mode: <https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device>
- Apple device pairing with Xcode: <https://developer.apple.com/documentation/xcode/pairing-your-devices-with-xcode>
