# OpenClaw 子模块 E2E

> 语言： [English](./openclaw-e2e.md) | [简体中文](./openclaw-e2e-zh.md)

OpenVitals 通过固定的 submodule 方式引用上游 OpenClaw 仓库，路径为 `vendor/openclaw`。当前 pin 的版本是 OpenClaw `v2026.4.24`。

## 环境准备

```bash
git submodule update --init --recursive
pnpm install
```

如果 submodule checkout 里还没有 `dist/` 产物，E2E 命令会先在本地构建 OpenClaw。

```bash
pnpm openclaw:e2e
```

## 这条 E2E 覆盖什么

`pnpm openclaw:e2e` 会在不要求真实 provider 凭据的情况下验证本地集成路径：

- 从 `vendor/openclaw/openclaw.mjs` 启动 OpenClaw CLI，并确认其能报告版本；
- 在随机 localhost 端口上启动 OpenVitals demo API；
- 生成 OpenVitals OpenClaw skill assets 和 family recovery workspace 文件；
- 把 OpenClaw MCP config 写入 `.agent-workflows/openclaw-e2e/state/openclaw.json`，其中包含 `openvitals` server entry；
- 直接通过 stdio 调用 OpenVitals MCP 的 `initialize`、`tools/list`、`health.sync_status` 和 `health.daily_brief`；
- 检查 MCP 输出中的 freshness、data-quality 和 source semantics。

命令最终会打印一个 JSON 报告，其中包括 OpenClaw 版本、生成文件、MCP tool 覆盖情况、provider env 可用性，以及被跳过的 live-test 限制。

## 不覆盖的 live 测试

这条自动化 E2E 默认不会跑完整的 OpenClaw agent loop，因为那需要配置模型 provider key，例如 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GOOGLE_API_KEY`、`GEMINI_API_KEY` 或 `OPENROUTER_API_KEY`。

它也不能代替硬件 QA 矩阵。下面这些仍需要人工完成：

- Oura OAuth 凭据和 Oura Ring 账号 / session；
- WHOOP OAuth 凭据或有效开发 token，以及 WHOOP 账号 / 设备；
- 已配对的 iPhone 和 Apple Watch，且具备历史样本与 live workout heart rate 所需的 HealthKit 权限；
- Apple Health 中存在 mirrored Oura / WHOOP 数据，以验证 dedupe。

这条 E2E 会刻意保持对 provider 的保守表述：Oura 和 WHOOP 云 API 仍视为 provider-mediated 的 delayed 数据，除非真实硬件测试证明了更强的能力；Apple Watch live heart rate 只有在 workout collector 路径中才算 live。
