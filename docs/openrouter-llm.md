# OpenRouter LLM

OpenVitals includes a small OpenRouter adapter in `@openvitals/llm`. It uses OpenRouter's OpenAI-compatible Chat Completions endpoint and can list OpenRouter models to pick a low-cost text chat model for a smoke test.

Official OpenRouter references:

- Chat completions: <https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request>
- Models endpoint: <https://openrouter.ai/docs/api/api-reference/models/get-models>
- Authentication: <https://openrouter.ai/docs/api-reference/authentication>

## Environment

Add these values to `.env`, `.env.local`, or `.env.live.local`:

```bash
OPENROUTER_API_KEY="<openrouter-api-key>"
OPENVITALS_LLM_PROVIDER=openrouter

# Optional. If unset, the smoke test selects the cheapest priced text chat model from /models.
OPENVITALS_OPENROUTER_MODEL=""
OPENVITALS_LLM_MODEL=""

OPENVITALS_OPENROUTER_API_URL=https://openrouter.ai/api/v1
OPENVITALS_OPENROUTER_SITE_URL=http://127.0.0.1:3000
OPENVITALS_OPENROUTER_TITLE=OpenVitals
OPENVITALS_OPENROUTER_MAX_TOKENS=8
OPENVITALS_OPENROUTER_MAX_ATTEMPTS=8
OPENVITALS_OPENROUTER_ALLOW_FREE=true
```

`OPENROUTER_API_KEY` is the standard OpenRouter variable. `OPEN_ROUTER_API_KEY` is also accepted as a local compatibility alias.

`OPENVITALS_OPENROUTER_MODEL` takes precedence over `OPENVITALS_LLM_MODEL`. Use an explicit model ID when you need reproducible behavior; leave it empty when you want the smoke test to select the cheapest available priced text chat model.

## Smoke Test

```bash
pnpm llm:openrouter:smoke
```

The command loads local env files, confirms the key is present without printing it, ranks text chat models by price, tries the cheapest candidates until one responds, sends a tiny `max_tokens=8` chat request, and prints a JSON summary with the selected model, content preview, and token usage.

To force a specific model for one run:

```bash
OPENVITALS_OPENROUTER_MODEL="<model-id>" pnpm llm:openrouter:smoke
```

To skip free endpoints that are more likely to be rate-limited:

```bash
OPENVITALS_OPENROUTER_ALLOW_FREE=false pnpm llm:openrouter:smoke
```
