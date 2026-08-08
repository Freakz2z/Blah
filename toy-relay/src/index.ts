import {
  buildRuntimePrompt,
  RUNTIME_INSTRUCTION,
} from "../../shared/generate/prompts.ts";
import {
  cleanGeneratedText,
  recentSimilarity,
  rememberResult,
  scoreGeneratedText,
  validateGeneratedText,
} from "../../shared/generate/quality.ts";
import {
  isUnsafeGeneratedText,
  safeFallbackForLength,
} from "../../shared/generate/safety.ts";
import {
  normalizeGenerationLength,
  normalizeGenerationMode,
  normalizeTopic,
  type GenerationLength,
  type GenerationMode,
} from "../../shared/generate/validation.ts";
import { fallbackForLength } from "../../shared/generate/fallback.ts";
import { VoteStore } from "./vote-store.ts";

export { VoteStore };

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const OLLAMA_ENDPOINT = "https://ollama.com/api/chat";
const OLLAMA_MODEL = "deepseek-v4-flash:0731";
const DEFAULT_MOOD = "正常";
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Loose but abuse-bounded: 3 model calls per request, so 30/min is ~90
 * model calls per minute per IP — plenty for real users, a brake on scripts. */
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_PAYLOAD_BYTES = 8 * 1024;
const OLLAMA_KEEP_ALIVE = "10m";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://www.bilibili.com",
  "https://bilibili.com",
  "https://www.bilibilitoy.com",
  "https://bilibilitoy.com",
]);

interface Env {
  OLLAMA_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  RATE_LIMITER: DurableObjectNamespace;
  VOTE_STORE: DurableObjectNamespace;
  TOY_ALLOWED_ORIGINS?: string;
  TOY_PROVIDER?: string;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface RelayPayload {
  topic?: unknown;
  mode?: unknown;
  length?: unknown;
  mechanism?: unknown;
  vote?: unknown;
}

type ProviderName = "ollama" | "deepseek";

interface ProviderConfig {
  name: ProviderName;
  apiKey: string;
}

interface ProviderCompletion {
  content: string;
  finishReason: string;
}

interface SamplingParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
}

const CANDIDATE_PARAMS: Record<
  GenerationMode,
  [SamplingParams, SamplingParams, SamplingParams]
> = {
  // Research (arXiv:2504.02858): 73% of tested LLMs peak at temperature ≤0.5 —
  // the primary candidate sits in the sweet spot. With mechanisms retired the
  // three candidates share one prompt, so temperature is the only diversity
  // lever: widen the spread so a validation-failing default doesn't sink all
  // three (a correlated failure is what forces the fallback template).
  翻译: [
    { temperature: 0.55, topP: 0.78, maxTokens: 64, timeoutMs: 15_000 },
    { temperature: 0.8, topP: 0.86, maxTokens: 64, timeoutMs: 15_000 },
    { temperature: 1.1, topP: 0.92, maxTokens: 64, timeoutMs: 15_000 },
  ],
  回答: [
    { temperature: 0.6, topP: 0.82, maxTokens: 64, timeoutMs: 15_000 },
    { temperature: 0.95, topP: 0.9, maxTokens: 64, timeoutMs: 15_000 },
    { temperature: 1.2, topP: 0.95, maxTokens: 64, timeoutMs: 15_000 },
  ],
  自由: [
    { temperature: 0.7, topP: 0.85, maxTokens: 64, timeoutMs: 15_000 },
    { temperature: 1.0, topP: 0.92, maxTokens: 64, timeoutMs: 15_000 },
    { temperature: 1.3, topP: 0.97, maxTokens: 64, timeoutMs: 15_000 },
  ],
};

function allowedOrigins(env: Env): Set<string> {
  const configured = env.TOY_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured?.length ? new Set(configured) : DEFAULT_ALLOWED_ORIGINS;
}

/** Any local dev origin (http://localhost:* / http://127.0.0.1:*) is welcome —
 * only a browser can mint a real Origin header, so this opens nothing a
 * non-browser client couldn't already do by simply omitting Origin. */
export function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export function originIsAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins(env).has(origin) || isLocalDevOrigin(origin);
}

function withCors(request: Request, response: Response, env: Env): Response {
  const origin = request.headers.get("Origin");
  // Same allowance as the request gate: whitelisted B站 origins or any local
  // dev origin. Both must agree, or the browser's CORS check would block a
  // request the gate already let through.
  if (!origin || !originIsAllowed(request, env)) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  headers.set("Vary", headers.get("Vary") ? `${headers.get("Vary")}, Origin` : "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(
  request: Request,
  env: Env,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const response = Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  return withCors(request, response, env);
}

async function readSmallJsonPayload(request: Request): Promise<RelayPayload | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_PAYLOAD_BYTES) return null;

  const body = request.body;
  if (!body) return null;

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_PAYLOAD_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" ? parsed as RelayPayload : null;
  } catch {
    return null;
  }
}

function configuredProviders(env: Env): ProviderConfig[] {
  const selected = env.TOY_PROVIDER?.trim().toLowerCase();
  const useOllama = selected !== "deepseek";
  const useDeepSeek = selected !== "ollama";
  const providers: ProviderConfig[] = [];
  if (useOllama && env.OLLAMA_API_KEY) {
    providers.push({ name: "ollama", apiKey: env.OLLAMA_API_KEY });
  }
  if (useDeepSeek && env.DEEPSEEK_API_KEY) {
    providers.push({ name: "deepseek", apiKey: env.DEEPSEEK_API_KEY });
  }
  return providers;
}

function buildToyPrompt(
  generationLength: GenerationLength,
  mode: GenerationMode,
): string {
  return `${RUNTIME_INSTRUCTION}\n\n${buildRuntimePrompt(
    DEFAULT_MOOD,
    false,
    generationLength,
    mode,
  )}`;
}

async function readOllamaStream(response: Response): Promise<ProviderCompletion> {
  if (!response.body) return { content: "", finishReason: "" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason = "";

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as {
      message?: { content?: unknown };
      done?: unknown;
      done_reason?: unknown;
    };
    if (typeof chunk.message?.content === "string") content += chunk.message.content;
    if (typeof chunk.done_reason === "string") finishReason = chunk.done_reason;
    else if (chunk.done === true) finishReason = "stop";
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }
  buffer += decoder.decode();
  consumeLine(buffer);

  return { content, finishReason };
}

async function requestCompletion(
  provider: ProviderConfig,
  systemPrompt: string,
  topic: string,
  mode: GenerationMode,
  params: SamplingParams,
): Promise<ProviderCompletion> {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `模式：${mode}\n输入：${topic}` },
  ];
  const isOllama = provider.name === "ollama";
  const response = await fetch(isOllama ? OLLAMA_ENDPOINT : DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(isOllama
      ? {
          model: OLLAMA_MODEL,
          stream: true,
          think: false,
          keep_alive: OLLAMA_KEEP_ALIVE,
          messages,
          options: {
            temperature: params.temperature,
            top_p: params.topP,
            num_predict: params.maxTokens,
            stop: ["\n"],
          },
        }
      : {
          model: DEEPSEEK_MODEL,
          thinking: { type: "disabled" },
          temperature: params.temperature,
          top_p: params.topP,
          max_tokens: params.maxTokens,
          stop: ["\n"],
          stream: false,
          messages,
        }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) {
    console.warn(`${provider.name} upstream returned ${response.status}`);
    throw new Error(`${provider.name}_upstream_${response.status}`);
  }

  if (isOllama) return readOllamaStream(response);

  const data = await response.json().catch(() => null) as {
    message?: { content?: unknown };
    done?: unknown;
    done_reason?: unknown;
    choices?: Array<{
      message?: { content?: unknown };
      finish_reason?: unknown;
    }>;
  } | null;

  const choice = data?.choices?.[0];
  return {
    content: typeof choice?.message?.content === "string" ? choice.message.content : "",
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "",
  };
}

function acceptCompletion(
  completion: ProviderCompletion,
  topic: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
): string | null {
  if (completion.finishReason !== "stop") return null;
  const text = cleanGeneratedText(completion.content);
  if (isUnsafeGeneratedText(text)) return null;
  return validateGeneratedText(text, topic, DEFAULT_MOOD, generationLength, mode) ? null : text;
}

interface GeneratedResult {
  text: string;
  /** Winning mechanism name, or null when no model result survived (fallback). */
  mechanism: string | null;
}

async function generateWithProvider(
  provider: ProviderConfig,
  topic: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
): Promise<GeneratedResult | null> {
  const candidateParams = CANDIDATE_PARAMS[mode];
  const settled = await Promise.allSettled(
    candidateParams.map((params, index) =>
      requestCompletion(
        provider,
        buildToyPrompt(generationLength, mode),
        topic,
        mode,
        params,
      ),
    ),
  );

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(
        `${provider.name} candidate-${index} failed`,
        result.reason instanceof Error ? result.reason.message : "unknown",
      );
    }
  });

  const valid: Array<{
    text: string;
    score: number;
    topicHit: number;
    length: number;
    index: number;
  }> = [];

  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const text = acceptCompletion(result.value, topic, generationLength, mode);
    if (!text) return;
    // The bare topic (not the mode-prefixed history key) is what the exemplar
    // exclusion in recentSimilarity matches against — a prefixed key would let
    // the model's verbatim exemplar plagiarism through as a "repeat" and force
    // the fallback for showcase topics.
    const similarity = recentSimilarity(topic, DEFAULT_MOOD, text);
    if (similarity > 0.5) return;
    const { score, topicHit, length } = scoreGeneratedText(
      text,
      topic,
      similarity,
      generationLength,
      mode,
    );
    valid.push({ text, score, topicHit, length, index });
  });

  valid.sort(
    (a, b) => b.score - a.score || b.topicHit - a.topicHit || b.length - a.length || a.index - b.index,
  );
  const text = valid[0]?.text;

  if (!text || isUnsafeGeneratedText(text)) return null;
  rememberResult(topic, DEFAULT_MOOD, text);
  return { text, mechanism: null };
}

async function generateWithProviders(
  providers: ProviderConfig[],
  topic: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
): Promise<GeneratedResult> {
  for (const provider of providers) {
    const result = await generateWithProvider(
      provider,
      topic,
      generationLength,
      mode,
    );
    if (result) return result;
    console.warn(`${provider.name} produced no quality-approved result; trying next provider`);
  }

  const fallback = fallbackForLength(topic, DEFAULT_MOOD, generationLength, mode);
  const text = isUnsafeGeneratedText(fallback) ? safeFallbackForLength(generationLength) : fallback;
  return { text, mechanism: "兜底" };
}

export class RateLimiter {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(): Promise<Response> {
    const now = Date.now();
    const current = await this.state.storage.get<RateLimitRecord>("rate-limit");
    const record = !current || now >= current.resetAt
      ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
      : current;

    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    record.count += 1;
    await this.state.storage.put("rate-limit", record);
    return new Response(null, { status: 204 });
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!originIsAllowed(request, env)) {
      return jsonResponse(request, env, { error: "origin_not_allowed" }, 403);
    }

    if (request.method === "OPTIONS") {
      return withCors(request, new Response(null, { status: 204 }), env);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const providers = configuredProviders(env);
      const enabledProviders = new Set(providers.map((provider) => provider.name));
      return jsonResponse(request, env, {
        ok: true,
        primary: providers[0]?.name ?? null,
        providers: {
          ollama: enabledProviders.has("ollama"),
          deepseek: enabledProviders.has("deepseek"),
        },
        models: {
          ollama: OLLAMA_MODEL,
          deepseek: DEEPSEEK_MODEL,
        },
        thinking: "disabled",
        configured: providers.length > 0,
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(request, env, { error: "not_found" }, 404);
    }

    if (url.pathname === "/feedback") {
      const payload = await readSmallJsonPayload(request);
      const mechanism = typeof payload?.mechanism === "string" ? payload.mechanism.trim() : "";
      const vote = payload?.vote === 1 ? 1 : payload?.vote === -1 ? -1 : 0;
      if (!mechanism || vote === 0) {
        return jsonResponse(request, env, { error: "invalid_vote" }, 400);
      }

      // Same per-IP budget as generation — a throttled client can't spam votes.
      const clientIp = request.headers.get("CF-Connecting-IP") ?? "anonymous";
      const limiterId = env.RATE_LIMITER.idFromName(clientIp);
      const limiterResponse = await env.RATE_LIMITER.get(limiterId).fetch("https://relay-rate-limit/check");
      if (!limiterResponse.ok) return withCors(request, limiterResponse, env);

      const voteId = env.VOTE_STORE.idFromName("global");
      const recordResponse = await env.VOTE_STORE.get(voteId).fetch("https://relay-votes/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mechanism, vote }),
      });
      if (!recordResponse.ok) {
        return jsonResponse(request, env, { error: "vote_store_unavailable" }, 502);
      }
      return jsonResponse(request, env, { ok: true });
    }

    if (url.pathname !== "/generate") {
      return jsonResponse(request, env, { error: "not_found" }, 404);
    }

    const payload = await readSmallJsonPayload(request);
    const topic = normalizeTopic(payload?.topic);
    if (!topic) return jsonResponse(request, env, { error: "invalid_topic" }, 400);
    if (isUnsafeGeneratedText(topic)) {
      return jsonResponse(request, env, { error: "unsafe_topic" }, 400);
    }
    const providers = configuredProviders(env);
    if (providers.length === 0) {
      return jsonResponse(request, env, { error: "provider_not_configured" }, 503);
    }

    const clientIp = request.headers.get("CF-Connecting-IP") ?? "anonymous";
    const limiterId = env.RATE_LIMITER.idFromName(clientIp);
    const limiterResponse = await env.RATE_LIMITER.get(limiterId).fetch("https://relay-rate-limit/check");
    if (!limiterResponse.ok) return withCors(request, limiterResponse, env);

    const mode = normalizeGenerationMode(payload?.mode);
    const generationLength = normalizeGenerationLength(payload?.length);

    try {
      const { text, mechanism } = await generateWithProviders(
        providers,
        topic,
        generationLength,
        mode,
      );
      return jsonResponse(request, env, { text, mechanism });
    } catch (error) {
      console.warn("toy relay failed", error instanceof Error ? error.message : "unknown");
      return jsonResponse(request, env, { error: "upstream_unavailable" }, 502);
    }
  },
};

export default worker;
