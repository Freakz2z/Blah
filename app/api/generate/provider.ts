import type { GenerationMode } from "./validation";

export interface SamplingParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
}

export type ModelProvider = "ollama" | "deepseek";

export interface ProviderConfig {
  provider: ModelProvider;
  requestedProvider: ModelProvider;
  endpoint: string;
  apiKey: string;
  model: string;
}

interface ProviderEnvironment {
  MODEL_PROVIDER?: string;
  OLLAMA_API_KEY?: string;
  OLLAMA_API_BASE?: string;
  OLLAMA_MODEL?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_API_BASE?: string;
  DEEPSEEK_MODEL?: string;
}

export function resolveProviderConfig(
  env: ProviderEnvironment = process.env,
): ProviderConfig | null {
  const requestedProvider: ModelProvider =
    env.MODEL_PROVIDER === "deepseek" ? "deepseek" : "ollama";

  const ollama = env.OLLAMA_API_KEY
    ? {
        provider: "ollama" as const,
        endpoint: env.OLLAMA_API_BASE ?? "https://ollama.com/api/chat",
        apiKey: env.OLLAMA_API_KEY,
        model: env.OLLAMA_MODEL ?? "deepseek-v4-flash",
      }
    : null;
  const deepseek = env.DEEPSEEK_API_KEY
    ? {
        provider: "deepseek" as const,
        endpoint: env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com/chat/completions",
        apiKey: env.DEEPSEEK_API_KEY,
        model: env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      }
    : null;

  const selected =
    requestedProvider === "ollama" ? (ollama ?? deepseek) : (deepseek ?? ollama);
  return selected ? { ...selected, requestedProvider } : null;
}

export function buildProviderPayload(
  config: Pick<ProviderConfig, "provider" | "model">,
  systemPrompt: string,
  topic: string,
  mode: GenerationMode,
  params: SamplingParams,
): Record<string, unknown> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `模式：${mode}\n输入：${topic}` },
  ];

  if (config.provider === "ollama") {
    return {
      model: config.model,
      stream: false,
      think: false,
      messages,
      options: {
        temperature: params.temperature,
        top_p: params.topP,
        num_predict: params.maxTokens,
        stop: ["\n"],
      },
    };
  }

  return {
    model: config.model,
    thinking: { type: "disabled" },
    temperature: params.temperature,
    top_p: params.topP,
    frequency_penalty: 0.15,
    max_tokens: params.maxTokens,
    stop: ["\n"],
    messages,
  };
}

export function parseProviderResponse(
  provider: ModelProvider,
  data: unknown,
): { content: string; finishReason: string } {
  if (!data || typeof data !== "object") return { content: "", finishReason: "" };

  if (provider === "ollama") {
    const response = data as {
      message?: { content?: unknown };
      done?: unknown;
      done_reason?: unknown;
    };
    return {
      content: typeof response.message?.content === "string" ? response.message.content : "",
      finishReason:
        typeof response.done_reason === "string"
          ? response.done_reason
          : response.done === true
            ? "stop"
            : "",
    };
  }

  const response = data as {
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  };
  const choice = response.choices?.[0];
  return {
    content: typeof choice?.message?.content === "string" ? choice.message.content : "",
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "",
  };
}

export async function requestCompletion(
  config: ProviderConfig,
  systemPrompt: string,
  topic: string,
  mode: GenerationMode,
  params: SamplingParams,
): Promise<{ content: string; finishReason: string }> {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildProviderPayload(config, systemPrompt, topic, mode, params)),
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) throw new Error(`${config.provider}_upstream_${response.status}`);
  return parseProviderResponse(config.provider, await response.json());
}
