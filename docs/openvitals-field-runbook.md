# OpenVitals Field Runbook

> Languages: [English](./openvitals-field-runbook.md) | [简体中文](./openvitals-field-runbook-zh.md)

Last reviewed: 2026-04-27.

This runbook captures the concrete steps, failures, and verification patterns
encountered while pushing OpenVitals from local demo mode into real Oura,
WHOOP, OpenRouter, OpenClaw, iPhone HealthKit, and Apple Watch hardware paths.
It is for two audiences:

- open source users who want to run OpenVitals locally with real devices or
  providers;
- developers / agents who need to reproduce long-running development, OMX
  multi-agent workflows, E2E runs, and hardware QA.

Never record real secrets, OAuth codes, access tokens, refresh tokens, Apple
Team IDs, or device UDIDs in the repository. Keep docs limited to variable
names, source locations, test methods, and public troubleshooting knowledge.

## 1. Repository and dependency bootstrap

Recommended environment:

- macOS with Homebrew available
- Node.js 22+
- pnpm 10.x
- full Xcode, not just Command Line Tools, if you plan to run iOS / watchOS
  device builds

From a clean checkout:

```bash
cd <path-to-openvitals>
git submodule update --init --recursive
pnpm install
```

If `pnpm` is missing in a non-login shell:

```bash
PATH=/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH
pnpm -v
```

Baseline verification order:

```bash
pnpm docs:generate
pnpm build
pnpm test
pnpm smoke:e2e
pnpm typecheck
```

Useful focused checks:

```bash
pnpm smoke:apple-health
pnpm openclaw:e2e
pnpm llm:openrouter:smoke
```

Notes:

- Do not hand-edit `docs/generated/`; run `pnpm docs:generate`.
- Keep `.env`, `.env.local`, and `.env.live.local` local-only.
- Do not blindly `source .env`; use the project's dotenv loader or explicit
  `export` lines for shell sessions.
- Once real providers are connected, keep `OPENVITALS_SECRETS_KEY` stable or old
  provider credentials will stop decrypting.

## 2. Start the local live API

For local API work on the development machine:

```bash
OPENVITALS_MODE=live PORT=3000 pnpm demo
```

For physical iPhone / Apple Watch access to the Mac, do not bind only to
loopback. Expose the API on the LAN:

```bash
HOST=0.0.0.0 PORT=3000 OPENVITALS_MODE=live pnpm demo
ipconfig getifaddr en0
```

Use this URL on iPhone / Watch:

```text
http://<Mac-LAN-IP>:3000
```

On a physical iPhone, `http://127.0.0.1:3000` points back to the phone, not the
Mac.

Prefer LAN URLs for hardware QA. Temporary HTTPS tunnels are acceptable for
OAuth callbacks or simple GET probes, but they were unreliable for HealthKit
ingest in practice: `localtunnel` returned `503 Tunnel Unavailable`, and a
Cloudflare quick tunnel returned `413 Payload Too Large` / `524 A timeout
occurred` for Apple Health uploads. If you must use a tunnel, start with a
smoke-sized upload and do not confuse tunnel success with healthy LAN sync.

Create a live user and agent token:

```bash
curl -X POST "http://127.0.0.1:3000/v1/live/bootstrap" \
  -H "x-openvitals-admin: ${OPENVITALS_ADMIN_TOKEN:-openvitals-dev-admin}" \
  -H "content-type: application/json" \
  -d '{"userId":"user_live","name":"Live User","timezone":"Asia/Shanghai","providers":["apple-health","oura","whoop"],"createTokens":true}'
```

Save the returned derived / full token locally:

```bash
export OPENVITALS_AGENT_TOKEN="<bootstrap-returned-token>"
```

Useful checks:

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live/sync-status" | jq

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live&days=30" | jq
```

## 3. OpenRouter model setup

OpenRouter is one model-provider option for OpenVitals LLM smoke tests and
OpenClaw / agent-loop execution. Official docs treat the API key as a Bearer
token and expose OpenAI-compatible chat completions.

Local env:

```bash
OPENROUTER_API_KEY="<openrouter-api-key>"
OPENVITALS_LLM_PROVIDER=openrouter
OPENVITALS_OPENROUTER_API_URL=https://openrouter.ai/api/v1

# Optional. When empty, smoke tries to pick a low-cost text chat model.
OPENVITALS_OPENROUTER_MODEL=""
OPENVITALS_OPENROUTER_MAX_TOKENS=8
OPENVITALS_OPENROUTER_MAX_ATTEMPTS=8
OPENVITALS_OPENROUTER_ALLOW_FREE=false
```

Verify:

```bash
pnpm llm:openrouter:smoke
```

Practical notes:

- For connectivity-only checks, use a low-cost model and tiny `max_tokens`.
- Free models may be rate limited; for stable smoke runs,
  `OPENVITALS_OPENROUTER_ALLOW_FREE=false` is safer.
- The command should print only the selected model, a short reply preview, and
  token usage, never the API key.

See [OpenRouter LLM](./openrouter-llm.md) for more detail.

## 4. Oura credentials, OAuth, and semantics

This project consistently uses `Oura` and provider ID `oura`, not `Aura`.

Local env:

```bash
OPENVITALS_OURA_CLIENT_ID="<oura-client-id>"
OPENVITALS_OURA_CLIENT_SECRET="<oura-client-secret>"
OPENVITALS_OURA_REDIRECT_URI="http://localhost:3000/v1/connect/callback/oura"
OPENVITALS_OURA_API_URL="https://api.ouraring.com"
```

Important OAuth rules:

- The redirect URI registered in the Oura app must exactly match the runtime
  `redirect_uri`, including `localhost` vs `127.0.0.1`, port, and path.
- If browser and API both run on the same Mac, `http://localhost:3000/...` is
  fine for local testing.
- For phone-side or external-network callbacks, use ngrok, Cloudflare Tunnel, or
  a real HTTPS domain.
- Complete consent in a browser session that is already signed in to Oura. One
  past failure came from being signed in on Chrome but not in an in-app browser.
- Do not copy one-time OAuth `code` values into issues or docs.

Example authorization URL shape:

```text
https://cloud.ouraring.com/oauth/authorize
  ?client_id=<oura-client-id>
  &redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fv1%2Fconnect%2Fcallback%2Foura
  &response_type=code
  &scope=email+personal+daily+heartrate+tag+workout+session+spo2+ring_configuration+stress+heart_health
```

Follow least privilege for scopes. Available scopes vary by app and account.

OpenVitals semantic rules:

- `/v2/usercollection/heartrate` rows are `dataGranularity=sample`, not
  `live_signal`.
- Daily sleep, readiness, SpO2, and stress are provider-mediated daily summaries
  or scores.
- Oura cloud API must not be described as a continuous raw sensor stream.
- If Oura also writes into Apple Health, the mirrored Apple records should be
  `captureMode=mirrored`, while direct Oura cloud data usually wins within the
  same metric / window.

Connectivity checks:

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live/sync-status" | jq

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live&source=oura&days=30" | jq
```

## 5. WHOOP credentials, OAuth, webhooks, and semantics

Local env:

```bash
OPENVITALS_WHOOP_CLIENT_ID="<whoop-client-id>"
OPENVITALS_WHOOP_CLIENT_SECRET="<whoop-client-secret>"
OPENVITALS_WHOOP_REDIRECT_URI="http://127.0.0.1:3000/v1/connect/callback/whoop"
OPENVITALS_WHOOP_WEBHOOK_SECRET="<local-webhook-secret>"
```

Optional overrides:

```bash
OPENVITALS_WHOOP_API_URL="https://api.prod.whoop.com"
OPENVITALS_WHOOP_AUTH_URL="https://api.prod.whoop.com/oauth/oauth2/auth"
OPENVITALS_WHOOP_TOKEN_URL="https://api.prod.whoop.com/oauth/oauth2/token"
OPENVITALS_WHOOP_SCOPE="read:profile read:recovery read:cycles read:sleep read:workout read:body_measurement"
```

WHOOP app setup notes:

- The developer dashboard needs at least one redirect URL.
- The OAuth request redirect URI must match the dashboard config exactly.
- Ask only for the scopes OpenVitals actually uses.
- Store client ID and secret locally only.

Webhook guidance:

- OAuth and manual sync do not require a public webhook; you can defer it.
- Configure webhooks only if you want provider-event-driven sync.
- If you currently implement only a shared-secret check, document it as dev /
  local webhook security. Do not imply official signature verification unless
  code and docs prove it.

WHOOP semantic rules:

- WHOOP cloud API provides provider-mediated recovery, cycle, sleep, workout,
  strain, HRV, resting HR, and heart-rate-zone summary data.
- It is not continuous raw HR streaming.
- Incremental sync must respect `updated_at`, windowing, pagination, and 429
  limits.
- If WHOOP also writes into Apple Health, the mirrored Apple records should be
  `captureMode=mirrored`, while direct WHOOP data usually wins within the same
  metric / window.

Connectivity checks:

```bash
curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/users/user_live/sync-status" | jq

curl -H "Authorization: Bearer $OPENVITALS_AGENT_TOKEN" \
  "http://127.0.0.1:3000/v1/timeline?userId=user_live&source=whoop&days=30" | jq
```

## 6. Apple Health, iPhone app, and Apple Watch app

Apple Health has no server-side cloud API key. The ingest path is:

```text
Apple Watch / Health app -> iPhone HealthKit -> OpenVitals iPhone companion -> OpenVitals API
```

Product-shape UX rules:

- The iPhone app should be the primary required connector: login, API setup,
  HealthKit permissions, historical sync, incremental sync, background delivery,
  manual Sync Now, and sync-state display all live there.
- The Apple Watch app is optional and used only for live workout heart-rate
  capture.
- Historical Apple Watch heart rate, HRV, sleep, and workouts usually upload via
  iPhone HealthKit; the watch app does not need to stay installed for that path.
- `live_signal` is reserved for active workout-session data through
  `HKWorkoutSession` / `HKLiveWorkoutBuilder`. Normal HealthKit history remains
  `sample` / `episode` with `near_realtime` or `delayed_sync`.
- The default `OpenVitalsHealthKitDemo` scheme builds only the iPhone app.
  `OpenVitalsWatchDemo` remains a separate optional scheme so Watch provisioning
  cannot block iPhone HealthKit verification.

Automatable checks:

```bash
pnpm --filter @openvitals/collector-ios test
pnpm smoke:apple-health
```

Project generation and simulator builds:

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

The Watch app can also be validated without a physical Watch by using simulator
build / install / launch checks. That proves packaging and target health, not
real HealthKit workout permissions or live uploads.

Human / hardware-only tasks remain unavoidable:

- Trusting the Mac on the iPhone
- Enabling Developer Mode on iPhone / Watch
- Signing in to Xcode with an Apple Developer team
- Having valid signing identities and provisioning profiles
- Granting HealthKit permissions on device
- Starting and stopping the Watch workout session

See the full [iOS Hardware QA Runbook](./ios-hardware-runbook.md).

## 7. Xcode details and issues seen in practice

Use full Xcode:

```bash
xcodebuild -version
xcrun xcode-select -p
```

Expected:

```text
/Applications/Xcode.app/Contents/Developer
```

If you see `/Library/Developer/CommandLineTools`, switch it:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

If `xcode-select` says the developer directory is invalid, full Xcode is not
installed at `/Applications/Xcode.app` yet.

On first launch, install iOS platform support for iPhone builds and watchOS
platform support for Apple Watch builds.

Device and signing checks:

```bash
xcrun devicectl list devices
xcrun xctrace list devices
security find-identity -p codesigning -v
```

Issues observed:

- `Developer Mode disabled`: enable it under Settings -> Privacy & Security, then
  reboot and confirm.
- `0 valid identities found`: sign in under Xcode -> Settings -> Accounts and
  enable automatic signing.
- Personal Team is fine for local iPhone HealthKit development. Use your own
  bundle ID namespace, not an unrelated company team. After install, you may
  still need to trust the Apple Development profile under
  Settings -> General -> VPN & Device Management.
- If a Personal Team Watch target says there is no eligible Watch device for the
  profile, validate iPhone-only HealthKit first and return to the Watch scheme
  later.
- Simulator builds can use `CODE_SIGNING_ALLOWED=NO`; device builds cannot.
- Physical iPhone app traffic must use the Mac LAN IP, not `127.0.0.1`.
- The most reliable CLI signing override is still
  `DEVELOPMENT_TEAM=<TEAM_ID> PRODUCT_BUNDLE_IDENTIFIER=<bundle-id> CODE_SIGN_STYLE=Automatic`.
- If `devicectl` launch says the device was locked, unlock the phone and keep it
  in the foreground. The Mac cannot unlock it for you.
- For long hardware sessions, temporarily increase Auto-Lock duration on the
  phone.
- The generated Xcode project is an artifact; `project.yml` is the source of
  truth.

You can prefill iPhone QA config through `devicectl` launch env so you do not
type long tokens on device. The app supports:

- `OPENVITALS_IOS_BASE_URL`
- `OPENVITALS_IOS_USER_ID`
- `OPENVITALS_IOS_BEARER_TOKEN`
- `OPENVITALS_IOS_SESSION_TOKEN`
- `OPENVITALS_IOS_LOOKBACK_DAYS`
- `OPENVITALS_IOS_MAX_RECORDS_PER_TYPE`
- `OPENVITALS_IOS_AUTO_QA`

`OPENVITALS_IOS_AUTO_QA=1` requests HealthKit permissions, creates the Apple
Health session, and runs initial anchored sync after the user approves the
system prompt.

`OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1` is a hardware-smoke helper only. It
caps upload volume and intentionally does not advance the local HealthKit anchor
so a later full sync can still upload the full history.

Health permission page reminders:

- The first prompt appears in front of the app and must be completed by the
  user.
- Later, find it under Settings -> Health -> Data Access & Devices -> OpenVitals
  or inside the Health app privacy lists.
- If OpenVitals is not listed yet, tap **Request HealthKit Permission** once in
  the app first.
- Allow Local Network if prompted; otherwise the phone cannot reach the Mac API
  over LAN.

If HealthKit returns but uploads time out, confirm:

- Local Network is enabled for OpenVitals on the phone.
- The API runs on `HOST=0.0.0.0`.
- Mac and iPhone share a network without VPN / firewall isolation.
- Both the Mac and iPhone Safari can open
  `http://<Mac-LAN-IP>:3000/v1/openapi.json`.

The `[OpenVitalsHardwareQA]` console breadcrumbs are useful because they confirm
launch-env handling, auto-QA entry, and failure stage without printing tokens.

Observed smoke evidence:

```text
1-day HealthKit query results:
- heart_rate: 178
- hrv_sdnn: 2
- resting_heart_rate: 1
- steps: 31
- sleep_analysis: 9
- workouts: 0

Upload results:
- OPENVITALS_IOS_MAX_RECORDS_PER_TYPE=1
- uploaded: 5 records
- sync_status apple-health: connected
- lastIngestRecordCount: 5
- lastAcceptedRecordCount: 5
- lastDroppedRecordCount: 0
- timeline metrics: heart_rate, hrv_sdnn, resting_heart_rate, steps, sleep
```

## 8. OpenClaw submodule and E2E

OpenVitals pins OpenClaw at:

```text
vendor/openclaw
```

Initialize and run:

```bash
git submodule update --init --recursive
pnpm openclaw:e2e
```

`pnpm openclaw:e2e` verifies:

- OpenClaw CLI starts and reports its version
- OpenVitals demo API starts
- OpenVitals MCP responds over stdio to `initialize`, `tools/list`,
  `health.sync_status`, and `health.daily_brief`
- OpenClaw skill / workspace assets generate correctly
- output carries freshness, granularity, and source semantics

It does not cover:

- real model calls in a full OpenClaw agent loop unless provider keys are set
- real Oura / WHOOP OAuth
- iPhone / Apple Watch HealthKit permissions on physical hardware

See [OpenClaw Submodule E2E](./openclaw-e2e.md).

## 9. OMX / agent workflow long runs

Do not cram long task briefs into the command line; put them in a file:

```bash
pnpm agent:workflow start --description-file docs/agent-tasks/openvitals-v0.6.md
```

Generate or refresh the OMX team plan:

```bash
pnpm agent:workflow omx-plan \
  --run openvitals-v0.6 \
  --phase all \
  --workers 6 \
  --model gpt-5.5 \
  --reasoning xhigh
```

Start from a tmux leader pane:

```bash
pnpm agent:workflow omx-run \
  --run openvitals-v0.6 \
  --phase all \
  --workers 6 \
  --model gpt-5.5 \
  --reasoning xhigh \
  --start
```

You can also pass model launch args explicitly to workers:

```bash
OMX_TEAM_WORKER_LAUNCH_ARGS='--model gpt-5.5 -c model_reasoning_effort="xhigh"' \
pnpm agent:workflow omx-run --run openvitals-v0.6 --phase all --workers 6 --start
```

Issues encountered:

- `Team mode requires running inside tmux current leader pane`: enter tmux and
  start from the leader pane.
- `leader_workspace_dirty_for_worktrees`: clean, commit, or stash the leader
  worktree first; never revert someone else's unrelated changes.
- `failed to create worker pane ... no space for new pane`: reduce worker count,
  enlarge the window, shrink font size, or use less concurrency.
- If workers look idle, inspect the leader pane, worker mailbox, and
  `.agent-workflows/<run>/reports/`. If everything is idle and verify has
  passed, the team may still require an explicit shutdown.
- Old sessions can be removed with:

```bash
tmux ls
tmux kill-session -t <session-name>
```

If OMX exposes shutdown, prefer running it from the leader:

```bash
omx team shutdown <team-session-name>
```

Acceptance check:

```bash
pnpm agent:workflow verify --run openvitals-v0.6
```

Reports land under:

```text
.agent-workflows/openvitals-v0.6/reports/
```

Agents must not fabricate hardware-gate success. Without real Oura / WHOOP /
iPhone / Watch evidence, mark the status `pending-hardware` and state the
missing proof explicitly.

See [Agent Orchestrator](./agent-orchestrator.md).

## 10. Data semantics and promise boundaries

Keep these boundaries intact across open source docs and agent copy:

- OpenVitals is a wellness / coaching data plane, not a diagnostic system or
  medical device.
- Distinguish provider raw payload, platform sample, normalized episode, daily
  summary, score, and live signal.
- Oura / WHOOP cloud data is provider-mediated and usually delayed sync / daily,
  not continuous raw sensor streaming.
- Apple Watch live HR is `live_signal` only while the live workout collector is
  actively running.
- iPhone HealthKit background delivery is iOS-scheduled, not server-side polling
  of HealthKit.
- Mirrored Apple Health records must retain provenance, but normalized views
  should avoid double counting against direct Oura / WHOOP.
- API / MCP / dashboard / explanation outputs should expose freshness,
  confidence, granularity, latency, and capture mode.

## 11. Evidence capture template

For every real acceptance run, save evidence like this in an issue, PR, or QA
report:

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

## 12. Official references

- Oura Cloud API authentication: <https://cloud.ouraring.com/docs/authentication>
- Oura applications: <https://cloud.ouraring.com/oauth/applications>
- WHOOP getting started: <https://developer.whoop.com/docs/developing/getting-started/>
- WHOOP OAuth: <https://developer.whoop.com/docs/developing/oauth>
- WHOOP API reference: <https://developer.whoop.com/api>
- OpenRouter authentication: <https://openrouter.ai/docs/api-reference/authentication>
- OpenRouter chat completions: <https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request>
- Apple Developer Mode: <https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device>
- Apple device pairing with Xcode: <https://developer.apple.com/documentation/xcode/pairing-your-devices-with-xcode>
