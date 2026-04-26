export const DEFAULT_OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_OPENROUTER_TITLE = "OpenVitals";

export type OpenVitalsChatRole = "system" | "user" | "assistant" | "tool";

export interface OpenVitalsChatMessage {
  role: OpenVitalsChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface OpenRouterConfig {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  appTitle?: string;
  siteUrl?: string;
}

export interface OpenRouterChatOptions {
  messages: OpenVitalsChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OpenRouterChatResult {
  id?: string;
  model: string;
  content: string;
  usage?: OpenRouterUsage;
  raw: unknown;
}

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    image?: string | number;
    request?: string | number;
    input_cache_read?: string | number;
    input_cache_write?: string | number;
    web_search?: string | number;
    internal_reasoning?: string | number;
    [key: string]: unknown;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string | null;
    [key: string]: unknown;
  };
  top_provider?: {
    is_moderated?: boolean;
    context_length?: number;
    max_completion_tokens?: number;
    [key: string]: unknown;
  };
  supported_parameters?: string[];
  [key: string]: unknown;
}

export interface OpenRouterModelSelection {
  model: OpenRouterModel;
  inputTokenPrice: number;
  outputTokenPrice: number;
  estimatedTokenPrice: number;
}

export interface SelectCheapestModelOptions {
  allowFree?: boolean;
  models?: OpenRouterModel[];
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function openRouterConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OpenRouterConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY || env.OPEN_ROUTER_API_KEY || "",
    apiUrl: env.OPENVITALS_OPENROUTER_API_URL || DEFAULT_OPENROUTER_API_URL,
    model: env.OPENVITALS_OPENROUTER_MODEL || env.OPENVITALS_LLM_MODEL || undefined,
    appTitle: env.OPENVITALS_OPENROUTER_TITLE || DEFAULT_OPENROUTER_TITLE,
    siteUrl: env.OPENVITALS_OPENROUTER_SITE_URL || env.OPENROUTER_SITE_URL || undefined
  };
}

export function createOpenRouterClient(config: OpenRouterConfig, fetchImpl: FetchLike = globalThis.fetch) {
  const normalizedConfig = normalizeOpenRouterConfig(config);

  const requestJson = async (route: string, init: RequestInit = {}) => {
    assertOpenRouterApiKey(normalizedConfig);
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${normalizedConfig.apiKey}`);
    if (!headers.has("content-type") && init.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (normalizedConfig.siteUrl) {
      headers.set("http-referer", normalizedConfig.siteUrl);
    }
    if (normalizedConfig.appTitle) {
      headers.set("x-openrouter-title", normalizedConfig.appTitle);
      headers.set("x-title", normalizedConfig.appTitle);
    }

    const response = await fetchImpl(joinOpenRouterUrl(normalizedConfig.apiUrl, route), {
      ...init,
      headers
    });
    const text = await response.text();
    const body = parseJson(text);
    if (!response.ok) {
      throw new Error(`OpenRouter request failed (${response.status}): ${renderOpenRouterError(body, text)}`);
    }
    return body;
  };

  return {
    config: normalizedConfig,

    async listModels(): Promise<OpenRouterModel[]> {
      const body = await requestJson("/models", { method: "GET" });
      if (!isRecord(body) || !Array.isArray(body.data)) {
        throw new Error("OpenRouter /models response did not include a data array");
      }
      return body.data.filter(isOpenRouterModel);
    },

    async selectCheapestModel(options: SelectCheapestModelOptions = {}): Promise<OpenRouterModelSelection> {
      const allowFree = options.allowFree ?? true;
      const models = options.models ?? (await this.listModels());
      const candidates = rankOpenRouterModelsByPrice(models, { allowFree });

      const selected = candidates[0];
      if (!selected) {
        throw new Error("No priced OpenRouter text chat models were available for cheapest-model selection");
      }
      return selected;
    },

    async chat(options: OpenRouterChatOptions): Promise<OpenRouterChatResult> {
      const model = options.model ?? normalizedConfig.model;
      if (!model) {
        throw new Error("OpenRouter model is required. Set OPENVITALS_OPENROUTER_MODEL or pass model explicitly.");
      }
      if (options.messages.length === 0) {
        throw new Error("OpenRouter chat requires at least one message");
      }

      const body = await requestJson("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: options.messages,
          temperature: options.temperature,
          max_tokens: options.maxTokens
        })
      });

      const content = extractAssistantContent(body);
      return {
        id: isRecord(body) && typeof body.id === "string" ? body.id : undefined,
        model: isRecord(body) && typeof body.model === "string" ? body.model : model,
        content,
        usage: isRecord(body) && isRecord(body.usage) ? (body.usage as OpenRouterUsage) : undefined,
        raw: body
      };
    }
  };
}

export function rankOpenRouterModelsByPrice(
  models: OpenRouterModel[],
  options: Pick<SelectCheapestModelOptions, "allowFree"> = {}
): OpenRouterModelSelection[] {
  const allowFree = options.allowFree ?? true;
  return models
    .filter(isTextChatModel)
    .map((model) => {
      const inputTokenPrice = parseOpenRouterPrice(model.pricing?.prompt);
      const outputTokenPrice = parseOpenRouterPrice(model.pricing?.completion);
      if (inputTokenPrice === null || outputTokenPrice === null) {
        return null;
      }
      const estimatedTokenPrice = inputTokenPrice + outputTokenPrice;
      if (!allowFree && estimatedTokenPrice === 0) {
        return null;
      }
      return {
        model,
        inputTokenPrice,
        outputTokenPrice,
        estimatedTokenPrice
      };
    })
    .filter((candidate): candidate is OpenRouterModelSelection => candidate !== null)
    .sort((a, b) => {
      if (a.estimatedTokenPrice !== b.estimatedTokenPrice) {
        return a.estimatedTokenPrice - b.estimatedTokenPrice;
      }
      return a.model.id.localeCompare(b.model.id);
    });
}

export function parseOpenRouterPrice(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function isTextChatModel(model: OpenRouterModel): boolean {
  const inputModalities = model.architecture?.input_modalities;
  const outputModalities = model.architecture?.output_modalities;
  const hasTextInput = !inputModalities || inputModalities.includes("text");
  const hasTextOutput = !outputModalities || outputModalities.includes("text");
  const searchableName = `${model.id} ${model.name ?? ""}`;
  const looksSpecializedNonChat = /(^|[/:\s-])(embed(ding|dings)?|ocr|image|audio|tts|transcri(be|ption)|moderation|rerank)([/:\s.-]|$)/i.test(
    searchableName
  );
  return hasTextInput && hasTextOutput && !looksSpecializedNonChat;
}

function normalizeOpenRouterConfig(config: OpenRouterConfig): Required<Pick<OpenRouterConfig, "apiKey" | "apiUrl" | "appTitle">> &
  Omit<OpenRouterConfig, "apiKey" | "apiUrl" | "appTitle"> {
  return {
    ...config,
    apiKey: config.apiKey,
    apiUrl: trimTrailingSlash(config.apiUrl || DEFAULT_OPENROUTER_API_URL),
    appTitle: config.appTitle || DEFAULT_OPENROUTER_TITLE
  };
}

function assertOpenRouterApiKey(config: OpenRouterConfig) {
  if (!config.apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter requests");
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function joinOpenRouterUrl(apiUrl: string, route: string) {
  return `${trimTrailingSlash(apiUrl)}/${route.replace(/^\/+/, "")}`;
}

function parseJson(text: string) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function renderOpenRouterError(body: unknown, fallback: string) {
  if (isRecord(body)) {
    if (typeof body.error === "string") {
      return body.error;
    }
    if (isRecord(body.error) && typeof body.error.message === "string") {
      return body.error.message;
    }
    if (typeof body.message === "string") {
      return body.message;
    }
  }
  return fallback || "empty response";
}

function extractAssistantContent(body: unknown) {
  if (!isRecord(body) || !Array.isArray(body.choices)) {
    throw new Error("OpenRouter chat response did not include choices");
  }
  const firstChoice = body.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("OpenRouter chat response did not include an assistant message");
  }
  const content = firstChoice.message.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (isRecord(part) && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function isOpenRouterModel(value: unknown): value is OpenRouterModel {
  return isRecord(value) && typeof value.id === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
