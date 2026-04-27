# OpenRouter LLM

> 语言： [English](./openrouter-llm.md) | [简体中文](./openrouter-llm-zh.md)

OpenVitals 在 `@openvitals/llm` 里包含一个轻量的 OpenRouter adapter。它使用 OpenRouter 兼容 OpenAI 的 Chat Completions 接口，并能从 OpenRouter 的 models endpoint 中挑出低成本 text chat model 用于 smoke test。

OpenRouter 官方参考：

- Chat completions: <https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request>
- Models endpoint: <https://openrouter.ai/docs/api/api-reference/models/get-models>
- Authentication: <https://openrouter.ai/docs/api-reference/authentication>

## 环境变量

把下面这些值写入 `.env`、`.env.local` 或 `.env.live.local`：

```bash
OPENROUTER_API_KEY="<openrouter-api-key>"
OPENVITALS_LLM_PROVIDER=openrouter

# 可选。留空时，smoke test 会从 /models 中自动选择最便宜的 text chat model。
OPENVITALS_OPENROUTER_MODEL=""
OPENVITALS_LLM_MODEL=""

OPENVITALS_OPENROUTER_API_URL=https://openrouter.ai/api/v1
OPENVITALS_OPENROUTER_SITE_URL=http://127.0.0.1:3000
OPENVITALS_OPENROUTER_TITLE=OpenVitals
OPENVITALS_OPENROUTER_MAX_TOKENS=8
OPENVITALS_OPENROUTER_MAX_ATTEMPTS=8
OPENVITALS_OPENROUTER_ALLOW_FREE=true
```

`OPENROUTER_API_KEY` 是 OpenRouter 的标准变量名。OpenVitals 也兼容本地别名 `OPEN_ROUTER_API_KEY`。

`OPENVITALS_OPENROUTER_MODEL` 的优先级高于 `OPENVITALS_LLM_MODEL`。如果你需要稳定可复现的行为，就填写明确的 model ID；如果你希望 smoke test 自动挑选当前最便宜的 text chat model，就保持为空。

## Smoke Test

```bash
pnpm llm:openrouter:smoke
```

这个命令会加载本地 env 文件，在不打印 key 的前提下确认 key 存在，按价格排序 text chat models，依次尝试最低价候选，发起一个 `max_tokens=8` 的极小 chat request，并输出包含 selected model、content preview 和 token usage 的 JSON 摘要。

如果你想在某次运行中强制指定模型：

```bash
OPENVITALS_OPENROUTER_MODEL="<model-id>" pnpm llm:openrouter:smoke
```

如果你想跳过更容易被限流的免费端点：

```bash
OPENVITALS_OPENROUTER_ALLOW_FREE=false pnpm llm:openrouter:smoke
```
