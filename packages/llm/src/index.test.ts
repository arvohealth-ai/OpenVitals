import {
  createOpenRouterClient,
  isTextChatModel,
  openRouterConfigFromEnv,
  parseOpenRouterPrice,
  rankOpenRouterModelsByPrice
} from "./index.js";

describe("OpenRouter LLM adapter", () => {
  it("loads OpenRouter config from OpenVitals env names", () => {
    const config = openRouterConfigFromEnv({
      OPENROUTER_API_KEY: "or-test",
      OPENVITALS_OPENROUTER_API_URL: "https://example.test/api/v1",
      OPENVITALS_OPENROUTER_MODEL: "cheap/model",
      OPENVITALS_OPENROUTER_TITLE: "OpenVitals Test",
      OPENVITALS_OPENROUTER_SITE_URL: "https://openvitals.test"
    });

    expect(config).toEqual({
      apiKey: "or-test",
      apiUrl: "https://example.test/api/v1",
      model: "cheap/model",
      appTitle: "OpenVitals Test",
      siteUrl: "https://openvitals.test"
    });
  });

  it("accepts the local OPEN_ROUTER_API_KEY alias", () => {
    expect(openRouterConfigFromEnv({ OPEN_ROUTER_API_KEY: "or-alias" }).apiKey).toBe("or-alias");
  });

  it("selects the lowest priced text chat model", async () => {
    const client = createOpenRouterClient(
      { apiKey: "or-test" },
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              model("expensive/model", "0.001", "0.002"),
              model("free/model", "0", "0"),
              model("cheap/model", "0.000001", "0.000002"),
              {
                id: "embedding/model",
                pricing: { prompt: "0", completion: "0" },
                architecture: { input_modalities: ["text"], output_modalities: ["embedding"] }
              }
            ]
          }),
          { status: 200 }
        )
      )
    );

    await expect(client.selectCheapestModel()).resolves.toMatchObject({
      model: { id: "free/model" },
      estimatedTokenPrice: 0
    });
    await expect(client.selectCheapestModel({ allowFree: false })).resolves.toMatchObject({
      model: { id: "cheap/model" },
      estimatedTokenPrice: 0.000003
    });
  });

  it("sends chat completions through the OpenRouter-compatible endpoint", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(String(_input)).toBe("https://router.test/api/v1/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer or-test");
      expect(headers.get("content-type")).toBe("application/json");
      expect(headers.get("http-referer")).toBe("https://openvitals.test");
      expect(headers.get("x-openrouter-title")).toBe("OpenVitals Test");
      expect(headers.get("x-title")).toBe("OpenVitals Test");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "cheap/model",
        messages: [{ role: "user", content: "ping" }],
        temperature: 0,
        max_tokens: 8
      });

      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "cheap/model",
          choices: [{ message: { role: "assistant", content: "ok" } }],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
        }),
        { status: 200 }
      );
    });

    const client = createOpenRouterClient(
      {
        apiKey: "or-test",
        apiUrl: "https://router.test/api/v1/",
        model: "cheap/model",
        appTitle: "OpenVitals Test",
        siteUrl: "https://openvitals.test"
      },
      fetchMock
    );

    await expect(
      client.chat({
        messages: [{ role: "user", content: "ping" }],
        temperature: 0,
        maxTokens: 8
      })
    ).resolves.toMatchObject({
      id: "chatcmpl-test",
      model: "cheap/model",
      content: "ok",
      usage: { total_tokens: 4 }
    });
  });

  it("fails clearly when the API key is missing", async () => {
    const client = createOpenRouterClient({ apiKey: "" }, vi.fn());
    await expect(client.listModels()).rejects.toThrow("OPENROUTER_API_KEY");
  });

  it("parses prices and filters non-chat models", () => {
    expect(parseOpenRouterPrice("0.000001")).toBe(0.000001);
    expect(parseOpenRouterPrice("")).toBeNull();
    expect(isTextChatModel(model("text/model", "0", "0"))).toBe(true);
    expect(
      isTextChatModel({
        id: "text-embedding/model",
        pricing: { prompt: "0", completion: "0" },
        architecture: { input_modalities: ["text"], output_modalities: ["embedding"] }
      })
    ).toBe(false);
    expect(isTextChatModel(model("baidu/qianfan-ocr-fast-20260420:free", "0", "0"))).toBe(false);
  });

  it("ranks priced text chat models by estimated token price", () => {
    expect(
      rankOpenRouterModelsByPrice([
        model("b/model", "0.2", "0.2"),
        model("a/model", "0.1", "0.1"),
        model("free/model", "0", "0")
      ]).map((selection) => selection.model.id)
    ).toEqual(["free/model", "a/model", "b/model"]);
  });
});

function model(id: string, prompt: string, completion: string) {
  return {
    id,
    pricing: { prompt, completion },
    architecture: { input_modalities: ["text"], output_modalities: ["text"] }
  };
}
