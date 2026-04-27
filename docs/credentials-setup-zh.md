# OpenVitals / OpenClaw 凭据获取清单

> 语言： [English](./credentials-setup.md) | [简体中文](./credentials-setup-zh.md)


最后核对日期：2026-04-26。

这份文档列出当前仓库完成真实 OpenClaw + OpenVitals E2E、Oura、WHOOP、iPhone + Apple Watch 硬件测试时需要准备的全部凭据和权限。不要把任何真实密钥提交到 Git；本仓库 `.gitignore` 已忽略 `.env` 和 `.env.*`。

完整的项目 setup、OMX 多 agent 运行、OpenRouter、Oura/WHOOP 联通、OpenClaw E2E、Xcode/iOS/watchOS 真机调试和证据保存流程见 [OpenVitals 项目现场运行手册](./openvitals-field-runbook-zh.md)。

## 0. 总览

建议先拿这些：

| 类别 | 必需项 | 用途 |
| --- | --- | --- |
| OpenVitals 本地运行 | `OPENVITALS_ADMIN_TOKEN`, `OPENVITALS_SECRETS_KEY` | live bootstrap、加密 provider credential |
| OpenVitals agent token | `OPENVITALS_AGENT_TOKEN` | 调 API/MCP；由 bootstrap 生成，不需要去第三方网站拿 |
| OpenClaw gateway | `OPENCLAW_GATEWAY_TOKEN` | 如果运行 OpenClaw gateway/control UI，需要共享密钥认证 |
| 模型 provider | 至少一个：`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `OPENROUTER_API_KEY` | OpenClaw agent loop / worker 使用模型 |
| Oura | `OPENVITALS_OURA_CLIENT_ID`, `OPENVITALS_OURA_CLIENT_SECRET`, `OPENVITALS_OURA_REDIRECT_URI` | Oura OAuth + API |
| WHOOP | `OPENVITALS_WHOOP_CLIENT_ID`, `OPENVITALS_WHOOP_CLIENT_SECRET`, `OPENVITALS_WHOOP_REDIRECT_URI`, `OPENVITALS_WHOOP_WEBHOOK_SECRET` | WHOOP OAuth + webhook |
| Apple Health / Apple Watch | Apple Developer Team、Bundle ID、HealthKit capability、设备授权 | iPhone/Watch 设备侧采集；没有云端 API key |
| Android Health Connect | Android app package/signing + Health Connect permissions | Android smoke；没有云端 API key |

## 1. 本地保存方式

建议在仓库根目录创建 `.env.live.local`，不要提交：

```bash
cd <path-to-openvitals>
touch .env.live.local
chmod 600 .env.live.local
```

如果 `.env.live.local` 内容严格是 shell `export KEY=value` 形式，可以这样加载：

```bash
set -a
source .env.live.local
set +a
```

不要盲目 `source .env`。dotenv 语法和 shell 语法不完全相同；含空格、引号、注释或非 shell 格式的值可能导致加载失败。项目脚本优先使用内置 dotenv loader，临时终端里建议只 `export` 当前命令需要的变量。

生成本地随机 secret：

```bash
openssl rand -hex 32
```

`OPENVITALS_SECRETS_KEY` 用来加密已保存的 provider credentials。开始真实连接 Oura/WHOOP 后要稳定保存；随意更换会导致旧凭据无法解密或需要重新连接。

## 2. OpenVitals 核心变量

```bash
export OPENVITALS_MODE=live
export OPENVITALS_DB_PATH=.openvitals/openvitals.sqlite
export OPENVITALS_ADMIN_TOKEN="<openssl-rand-hex-32>"
export OPENVITALS_SECRETS_KEY="<openssl-rand-hex-32>"
```

`OPENVITALS_AGENT_TOKEN` 不需要提前申请。启动 API 后通过 live bootstrap 生成：

```bash
OPENVITALS_MODE=live pnpm --filter @openvitals/api demo

curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: $OPENVITALS_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Live User","timezone":"Asia/Shanghai","providers":["apple-health","oura","whoop"],"createTokens":true}'
```

从响应里保存 derived token：

```bash
export OPENVITALS_AGENT_TOKEN="<derived-token-from-bootstrap>"
```

## 3. OpenClaw Gateway / Model Provider

### 3.1 OpenClaw gateway token

如果只跑 `pnpm openclaw:e2e`，不需要 gateway token。若要启动 OpenClaw gateway/control UI，生成一个长随机 token：

```bash
export OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 32)"
```

OpenClaw 官方文档说明 gateway shared-secret auth 使用 `gateway.auth.token` / `gateway.auth.password`，也可以用 `OPENCLAW_GATEWAY_TOKEN` / `OPENCLAW_GATEWAY_PASSWORD`。

### 3.2 模型 key，至少准备一个

OpenClaw 长程 agent loop 需要模型 provider。你可以只准备一个，优先建议 `OPENAI_API_KEY` 或 `ANTHROPIC_API_KEY`。

#### OpenAI

入口：

- API key page: <https://platform.openai.com/api-keys>
- 官方 quickstart: <https://platform.openai.com/docs/quickstart>

步骤：

1. 登录 OpenAI Platform。
2. 选择正确的 organization/project。
3. 打开 API Keys，创建新的 secret key。
4. 建议命名为 `openvitals-openclaw-local`。
5. 保存一次性显示的 key。
6. 设置：

```bash
export OPENAI_API_KEY="<openai-secret-key>"
```

注意：OpenAI 官方文档提醒 API key 是 secret，应该通过环境变量或 server-side key management 使用，不要暴露在浏览器或客户端代码中。

#### Anthropic Claude

入口：

- Console: <https://console.anthropic.com/>
- API docs: <https://platform.claude.com/docs/en/api/overview>

步骤：

1. 登录 Anthropic Console。
2. 配置 billing / workspace。
3. 在 Account Settings 或 API Keys 页面创建 key。
4. 保存 key。
5. 设置：

```bash
export ANTHROPIC_API_KEY="<anthropic-api-key>"
```

Anthropic API 请求使用 `x-api-key`，OpenClaw/SDK 通常会从 `ANTHROPIC_API_KEY` 读取。

#### Google Gemini

入口：

- Google AI Studio API key: <https://aistudio.google.com/app/apikey>
- Gemini API docs: <https://ai.google.dev/api>

步骤：

1. 登录 Google AI Studio。
2. 创建或选择 Google Cloud project。
3. 创建 API key。
4. 建议在 Google Cloud 里限制 key 的 API 范围和预算告警。
5. 设置：

```bash
export GEMINI_API_KEY="<gemini-api-key>"
# 某些工具只识别 GOOGLE_API_KEY，也可以同时设置：
export GOOGLE_API_KEY="$GEMINI_API_KEY"
```

Google 官方 Gemini API 文档说明 REST 请求使用 `x-goog-api-key` header。

#### OpenRouter

入口：

- API keys: <https://openrouter.ai/settings/keys>
- Authentication docs: <https://openrouter.ai/docs/api-reference/authentication>
- Chat completions docs: <https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request>
- Models docs: <https://openrouter.ai/docs/api/api-reference/models/get-models>

步骤：

1. 登录 OpenRouter。
2. 创建 API key。
3. 建议为 key 设置 credit limit，避免 agent 长程运行失控。
4. 设置：

```bash
export OPENROUTER_API_KEY="<openrouter-api-key>"
export OPENVITALS_LLM_PROVIDER=openrouter
export OPENVITALS_OPENROUTER_API_URL="https://openrouter.ai/api/v1"

# 可选：留空时 `pnpm llm:openrouter:smoke` 会从 /models 里选择最低价 text chat model。
export OPENVITALS_OPENROUTER_MODEL=""
export OPENVITALS_OPENROUTER_MAX_TOKENS=8
export OPENVITALS_OPENROUTER_MAX_ATTEMPTS=8
export OPENVITALS_OPENROUTER_ALLOW_FREE=true
```

标准变量名是 `OPENROUTER_API_KEY`；OpenVitals 也兼容读取本地别名 `OPEN_ROUTER_API_KEY`。

OpenRouter 使用 Bearer token；OpenVitals 的 smoke 命令使用 OpenAI-compatible `POST /chat/completions`。设置好 `.env` 后可以运行：

```bash
pnpm llm:openrouter:smoke
```

命令会读取 `.env` / `.env.local` / `.env.live.local`，不会打印 API key。它会按价格排序尝试最便宜的 text chat model；如果免费端点被限流，会继续尝试下一个候选，最后只输出所选模型、简短回复和 token usage。若想跳过免费端点，可以临时运行：

```bash
OPENVITALS_OPENROUTER_ALLOW_FREE=false pnpm llm:openrouter:smoke
```

## 4. Oura Ring OAuth/API

官方入口：

- Oura API docs: <https://cloud.ouraring.com/docs/>
- Oura OAuth docs: <https://cloud.ouraring.com/docs/authentication>
- My Applications: <https://cloud.ouraring.com/oauth/applications>

需要准备：

```bash
export OPENVITALS_OURA_CLIENT_ID="<oura-client-id>"
export OPENVITALS_OURA_CLIENT_SECRET="<oura-client-secret>"
export OPENVITALS_OURA_REDIRECT_URI="https://<your-domain>/v1/connect/callback/oura"
export OPENVITALS_OURA_API_URL="https://api.ouraring.com"
export OPENVITALS_OURA_SCOPE="personal daily heartrate workout spo2"
```

本地测试如果没有公网 HTTPS，可以用 ngrok / Cloudflare Tunnel 暴露本机 API，然后把 tunnel URL 填进 Oura app 的 Redirect URI，例如：

```bash
export OPENVITALS_OURA_REDIRECT_URI="https://<tunnel-host>/v1/connect/callback/oura"
```

步骤：

1. 用 Oura 账号登录 `cloud.ouraring.com`。
2. 打开 My Applications。
3. 创建新 OAuth application。
4. 填 Redirect URI，必须和运行时的 `OPENVITALS_OURA_REDIRECT_URI` 完全一致。
5. 复制 Client ID 和 Client Secret。
6. 配置 scopes。

Oura 官方 scopes：

- `email`：用户邮箱，可选，本项目通常不需要。
- `personal`：性别、年龄、身高、体重。
- `daily`：sleep/activity/readiness 日汇总。
- `heartrate`：Gen 3 用户心率时间序列。
- `workout`：自动检测和用户输入的 workouts。
- `tag`：用户 tags，本项目通常不需要。
- `session`：Oura app guided/unguided sessions，本项目通常不需要。
- `spo2`：睡眠期间日均 SpO2。

建议 scope：

```bash
personal daily heartrate workout spo2
```

说明：

- Oura OAuth authorize URL 是 `https://cloud.ouraring.com/oauth/authorize`。
- token URL 是 `https://api.ouraring.com/oauth/token`。
- Oura redirect URI 是白名单匹配，参数里的值必须精确匹配应用配置。
- Oura cloud data 是 provider-mediated / delayed sync，不是连续 raw sensor stream。
- Oura heart-rate rows 在 OpenVitals 中应作为 `sample`，不是 `live_signal`。

## 5. WHOOP OAuth/API

官方入口：

- WHOOP Developer Dashboard: <https://developer.whoop.com/>
- Getting Started: <https://developer.whoop.com/docs/developing/getting-started/>
- OAuth docs: <https://developer.whoop.com/docs/developing/oauth/>
- API docs/scopes: <https://developer.whoop.com/api/>

需要准备：

```bash
export OPENVITALS_WHOOP_CLIENT_ID="<whoop-client-id>"
export OPENVITALS_WHOOP_CLIENT_SECRET="<whoop-client-secret>"
export OPENVITALS_WHOOP_REDIRECT_URI="https://<your-domain>/v1/connect/callback/whoop"
export OPENVITALS_WHOOP_WEBHOOK_SECRET="<openssl-rand-hex-32>"
export OPENVITALS_WHOOP_SCOPE="offline read:sleep read:recovery read:workout read:cycles read:profile read:body_measurement"
```

本地测试同样建议用 HTTPS tunnel。如果 WHOOP Developer Dashboard 不接受 `http://127.0.0.1`，使用：

```bash
export OPENVITALS_WHOOP_REDIRECT_URI="https://<tunnel-host>/v1/connect/callback/whoop"
```

步骤：

1. 用 WHOOP 账号登录 Developer Dashboard。
2. 创建 Team。
3. 创建 App。
4. 配置 Redirect URI，OAuth 请求里的 redirect URI 必须和 Dashboard 里配置的值匹配。
5. 配置 scopes。至少要覆盖 sleep/recovery/workout；建议加 cycles/profile/body measurement，方便后续完整解释。
6. 创建完成后保存 Client ID 和 Client Secret。
7. 如果配置 webhook，生成本地 `OPENVITALS_WHOOP_WEBHOOK_SECRET`；当前仓库用它做 dev/local shared-secret 校验，不要把它当成官方生产签名机制。

WHOOP 官方 OAuth 端点：

- Authorization URL: `https://api.prod.whoop.com/oauth/oauth2/auth`
- Token URL: `https://api.prod.whoop.com/oauth/oauth2/token`
- API base: `https://api.prod.whoop.com/developer/v2`

WHOOP 官方 scopes 里和本项目相关的有：

- `read:recovery`：Recovery score、HRV、RHR 等。
- `read:cycles`：physiological cycle、day strain、average HR。
- `read:workout`：workout strain、average HR、HR zones 等。
- `read:sleep`：sleep performance、sleep stages 等。
- `read:profile`：name/email。
- `read:body_measurement`：height/weight/max HR。
- `offline`：请求 refresh token，长程同步需要。

说明：

- WHOOP cloud API 是 provider-mediated sleep/recovery/workout/cycle summary data，不是连续 raw HR stream。
- 若只想先跑最小路径，`offline read:sleep read:recovery read:workout` 已符合当前 connector 默认值。
- 若要更完整的日简报/解释，建议申请完整推荐 scope。

开发 fallback：

```bash
export OPENVITALS_WHOOP_ACCESS_TOKEN="<temporary-dev-access-token>"
export OPENVITALS_WHOOP_BRIDGE_URL="<optional-bridge-url>"
```

这两个只建议调试/迁移使用，正式路径仍应走 per-user OAuth。

## 6. Apple Health / Apple Watch

Apple HealthKit 没有服务器 API key。OpenVitals 的 Apple path 是 device-side ingest：iPhone/Watch app 读取 HealthKit 后上传到本地 API。

官方入口：

- HealthKit overview: <https://developer.apple.com/documentation/healthkit>
- Setting up HealthKit: <https://developer.apple.com/documentation/healthkit/setting-up-healthkit>
- requestAuthorization: <https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization(toshare:read:)>
- HKWorkoutSession: <https://developer.apple.com/documentation/healthkit/hkworkoutsession>
- HKLiveWorkoutBuilder: <https://developer.apple.com/documentation/healthkit/hkliveworkoutbuilder>

需要准备：

| 项 | 获取方式 |
| --- | --- |
| Apple Developer Team ID | Apple Developer account / Xcode Account |
| iOS Bundle ID | Apple Developer portal 或 Xcode automatic signing |
| watchOS Bundle ID | 如果要 Apple Watch live workout path，需要 watch target |
| HealthKit capability | Xcode target -> Signing & Capabilities -> `+ Capability` -> HealthKit |
| Info.plist usage text | `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription` |
| 真机 | iPhone；live workout 还需要 paired Apple Watch |

需要在 app 里请求 HealthKit read permission：

- Heart rate
- HRV SDNN
- Resting heart rate
- Step count
- Sleep analysis
- Workouts

Apple 官方文档要点：

- 使用 HealthKit 前要 enable HealthKit capability。
- 要用 `HKHealthStore.requestAuthorization(toShare:read:)` 请求读/写权限。
- 必须配置 HealthKit usage description，否则请求授权时 app 会崩溃。
- Apple Watch live HR 需要 active workout path：`HKWorkoutSession` + `HKLiveWorkoutBuilder`。

OpenVitals 需要的不是 secret，而是上传 payload 时的 provenance：

- `HKSourceRevision.bundleIdentifier`
- device info
- timezone
- unit
- HealthKit sample UUID / source record hash
- anchor state
- 对 Oura/WHOOP mirrored into Apple Health 的记录，标 `captureMode="mirrored"`，并保留 bundle/source metadata。

## 7. Android Health Connect

当前 v0.6 里 Android Health Connect 是 iOS path 之后的 smoke test，不需要云端 API key。需要的是 Android app 权限和用户授权。

需要准备：

- Android app package name。
- Debug/release signing key。
- Health Connect permissions for metrics used in smoke test。
- Android device or emulator with Health Connect available。

OpenVitals 中同样应保留 source/provenance/anchor-like sync metadata；不要把 Health Connect samples 描述成 cloud live stream。

## 8. 推荐 `.env.live.local` 模板

```bash
# Core
export OPENVITALS_MODE=live
export OPENVITALS_DB_PATH=.openvitals/openvitals.sqlite
export OPENVITALS_ADMIN_TOKEN="<generate-with-openssl-rand-hex-32>"
export OPENVITALS_SECRETS_KEY="<generate-with-openssl-rand-hex-32>"

# Filled after /v1/live/bootstrap
export OPENVITALS_AGENT_TOKEN="<derived-token-from-bootstrap>"

# OpenClaw gateway, only needed if running gateway/control UI
export OPENCLAW_GATEWAY_TOKEN="<generate-with-openssl-rand-hex-32>"

# Model provider: at least one
export OPENAI_API_KEY=""
export ANTHROPIC_API_KEY=""
export GEMINI_API_KEY=""
export GOOGLE_API_KEY=""
export OPENROUTER_API_KEY=""
export OPENVITALS_LLM_PROVIDER="openrouter"
export OPENVITALS_OPENROUTER_MODEL=""
export OPENVITALS_OPENROUTER_API_URL="https://openrouter.ai/api/v1"
export OPENVITALS_OPENROUTER_SITE_URL="http://127.0.0.1:3000"
export OPENVITALS_OPENROUTER_TITLE="OpenVitals"
export OPENVITALS_OPENROUTER_MAX_TOKENS=8
export OPENVITALS_OPENROUTER_MAX_ATTEMPTS=8
export OPENVITALS_OPENROUTER_ALLOW_FREE=true

# Oura
export OPENVITALS_OURA_CLIENT_ID=""
export OPENVITALS_OURA_CLIENT_SECRET=""
export OPENVITALS_OURA_REDIRECT_URI="https://<your-domain-or-tunnel>/v1/connect/callback/oura"
export OPENVITALS_OURA_API_URL="https://api.ouraring.com"
export OPENVITALS_OURA_SCOPE="personal daily heartrate workout spo2"

# WHOOP
export OPENVITALS_WHOOP_CLIENT_ID=""
export OPENVITALS_WHOOP_CLIENT_SECRET=""
export OPENVITALS_WHOOP_REDIRECT_URI="https://<your-domain-or-tunnel>/v1/connect/callback/whoop"
export OPENVITALS_WHOOP_WEBHOOK_SECRET="<generate-with-openssl-rand-hex-32>"
export OPENVITALS_WHOOP_SCOPE="offline read:sleep read:recovery read:workout read:cycles read:profile read:body_measurement"
```

## 9. 获取完成后的验证顺序

1. 先只设置一个模型 key，跑：

```bash
pnpm openclaw:e2e
```

2. 设置 OpenVitals core env，启动 live API，跑 bootstrap，保存 `OPENVITALS_AGENT_TOKEN`。
3. 配置 Oura app + env，跑 Oura connect/start + callback + sync。
4. 配置 WHOOP app + env，跑 WHOOP connect/start + callback + sync。
5. 用 iPhone collector 跑 Apple Health historical ingest。
6. 用 Apple Watch workout collector 跑 live HR。
7. 打开 Oura/WHOOP 写入 Apple Health，上传 mirrored samples，验证 dedupe。

不要把 Oura/WHOOP 云端数据描述为 continuous raw sensor stream；只有 Apple Watch active workout collector 产生的 heart-rate path 才能作为 live signal。
