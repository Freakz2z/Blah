import {
  buildSystemPrompt,
  drawMechanismSets,
} from "../../app/api/generate/prompts.ts";
import {
  cleanGeneratedText,
  recentSimilarity,
  rememberResult,
  scoreGeneratedText,
  validateGeneratedText,
} from "../../app/api/generate/quality.ts";
import {
  isUnsafeGeneratedText,
  safeFallbackForLength,
} from "../../app/api/generate/safety.ts";
import {
  normalizeGenerationLength,
  normalizeGenerationMode,
  normalizeTopic,
  type GenerationLength,
  type GenerationMode,
} from "../../app/api/generate/validation.ts";
import { fallbackForLength } from "../../app/api/generate/fallback.ts";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_MOOD = "正常";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const MAX_PAYLOAD_BYTES = 8 * 1024;

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://www.bilibili.com",
  "https://bilibili.com",
  "https://www.bilibilitoy.com",
  "https://bilibilitoy.com",
]);

interface Env {
  DEEPSEEK_API_KEY?: string;
  RATE_LIMITER: DurableObjectNamespace;
  TOY_ALLOWED_ORIGINS?: string;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
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
}

interface DeepSeekCompletion {
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
  翻译: [
    { temperature: 0.55, topP: 0.78, maxTokens: 100, timeoutMs: 12_000 },
    { temperature: 0.7, topP: 0.82, maxTokens: 100, timeoutMs: 12_000 },
    { temperature: 0.85, topP: 0.86, maxTokens: 100, timeoutMs: 12_000 },
  ],
  回答: [
    { temperature: 0.7, topP: 0.82, maxTokens: 100, timeoutMs: 12_000 },
    { temperature: 0.9, topP: 0.88, maxTokens: 100, timeoutMs: 12_000 },
    { temperature: 1.05, topP: 0.92, maxTokens: 100, timeoutMs: 12_000 },
  ],
};

const RETRY_PARAMS: Record<GenerationMode, SamplingParams> = {
  翻译: { temperature: 0.45, topP: 0.75, maxTokens: 90, timeoutMs: 10_000 },
  回答: { temperature: 0.65, topP: 0.8, maxTokens: 90, timeoutMs: 10_000 },
};

function allowedOrigins(env: Env): Set<string> {
  const configured = env.TOY_ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured?.length ? new Set(configured) : DEFAULT_ALLOWED_ORIGINS;
}

function originIsAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins(env).has(origin);
}

function withCors(request: Request, response: Response, env: Env): Response {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).has(origin)) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
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

async function requestDeepSeek(
  apiKey: string,
  systemPrompt: string,
  topic: string,
  mode: GenerationMode,
  params: SamplingParams,
): Promise<DeepSeekCompletion> {
  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      thinking: { type: "disabled" },
      temperature: params.temperature,
      top_p: params.topP,
      max_tokens: params.maxTokens,
      stop: ["\n"],
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `模式：${mode}\n输入：${topic}` },
      ],
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) {
    console.warn(`deepseek upstream returned ${response.status}`);
    throw new Error(`deepseek_upstream_${response.status}`);
  }

  const data = await response.json().catch(() => null) as {
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
  completion: DeepSeekCompletion,
  topic: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
): string | null {
  if (completion.finishReason !== "stop") return null;
  const text = cleanGeneratedText(completion.content);
  if (isUnsafeGeneratedText(text)) return null;
  return validateGeneratedText(text, topic, DEFAULT_MOOD, generationLength, mode) ? null : text;
}

async function generateWithDeepSeek(
  apiKey: string,
  topic: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
): Promise<string> {
  const draw = drawMechanismSets(DEFAULT_MOOD);
  const settled = await Promise.allSettled(
    draw.candidates.map((mechanisms, index) =>
      requestDeepSeek(
        apiKey,
        buildSystemPrompt(DEFAULT_MOOD, mechanisms, false, generationLength, mode),
        topic,
        mode,
        CANDIDATE_PARAMS[mode][index],
      ),
    ),
  );

  const historyKey = `${mode}：${topic}`;
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
    const similarity = recentSimilarity(historyKey, DEFAULT_MOOD, text);
    if (similarity > 0.5) return;
    const { score, topicHit, length } = scoreGeneratedText(
      text,
      topic,
      DEFAULT_MOOD,
      similarity,
      draw.candidates[index],
      generationLength,
      mode,
    );
    valid.push({ text, score, topicHit, length, index });
  });

  valid.sort(
    (a, b) => b.score - a.score || b.topicHit - a.topicHit || b.length - a.length || a.index - b.index,
  );
  let text = valid[0]?.text;

  if (!text) {
    try {
      const retry = await requestDeepSeek(
        apiKey,
        buildSystemPrompt(DEFAULT_MOOD, [draw.retry], true, generationLength, mode),
        topic,
        mode,
        RETRY_PARAMS[mode],
      );
      const retryText = acceptCompletion(retry, topic, generationLength, mode);
      if (retryText && recentSimilarity(historyKey, DEFAULT_MOOD, retryText) <= 0.5) {
        text = retryText;
      }
    } catch (error) {
      console.warn("deepseek retry failed", error instanceof Error ? error.message : "unknown");
    }
  }

  // A bounded local fallback keeps the Toy usable during a transient provider
  // miss, while successful requests always come from DeepSeek.
  if (!text) text = fallbackForLength(topic, DEFAULT_MOOD, generationLength, mode);
  if (isUnsafeGeneratedText(text)) text = safeFallbackForLength(generationLength);
  rememberResult(historyKey, DEFAULT_MOOD, text);
  return text;
}

export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

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
      return jsonResponse(request, env, {
        ok: true,
        model: DEEPSEEK_MODEL,
        thinking: "disabled",
        configured: Boolean(env.DEEPSEEK_API_KEY),
      });
    }

    if (request.method !== "POST" || url.pathname !== "/generate") {
      return jsonResponse(request, env, { error: "not_found" }, 404);
    }

    const payload = await readSmallJsonPayload(request);
    const topic = normalizeTopic(payload?.topic);
    if (!topic) return jsonResponse(request, env, { error: "invalid_topic" }, 400);
    if (isUnsafeGeneratedText(topic)) {
      return jsonResponse(request, env, { error: "unsafe_topic" }, 400);
    }
    if (!env.DEEPSEEK_API_KEY) {
      return jsonResponse(request, env, { error: "provider_not_configured" }, 503);
    }

    const clientIp = request.headers.get("CF-Connecting-IP") ?? "anonymous";
    const limiterId = env.RATE_LIMITER.idFromName(clientIp);
    const limiterResponse = await env.RATE_LIMITER.get(limiterId).fetch("https://relay-rate-limit/check");
    if (!limiterResponse.ok) return withCors(request, limiterResponse, env);

    const mode = normalizeGenerationMode(payload?.mode);
    const generationLength = normalizeGenerationLength(payload?.length);

    try {
      const text = await generateWithDeepSeek(env.DEEPSEEK_API_KEY, topic, generationLength, mode);
      return jsonResponse(request, env, { text });
    } catch (error) {
      console.warn("toy relay failed", error instanceof Error ? error.message : "unknown");
      return jsonResponse(request, env, { error: "upstream_unavailable" }, 502);
    }
  },
};

export default worker;
