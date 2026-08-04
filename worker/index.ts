/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { normalizeTopic } from "../app/api/generate/validation";

interface Env {
  ASSETS: Fetcher;
  RATE_LIMITER: DurableObjectNamespace;
  STATS?: DurableObjectNamespace;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 12;

type RateLimitRecord = { count: number; resetAt: number };

type UsageStats = { users: number; generations: number };
type UsageStatsPayload = { visitorId?: unknown };

const EMPTY_USAGE_STATS: UsageStats = { users: 0, generations: 0 };
const USAGE_STATS_KEY = "usage-stats";
const VISITOR_COOKIE = "blah-visitor";
const VISITOR_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type UsageStatsState = DurableObjectState & {
  blockConcurrencyWhile(callback: () => Promise<void>): Promise<void>;
};

function isVisitorId(value: unknown): value is string {
  return typeof value === "string" && VISITOR_ID_RE.test(value);
}

function normalizeUsageStats(value: unknown): UsageStats {
  if (!value || typeof value !== "object") return { ...EMPTY_USAGE_STATS };
  const record = value as Partial<UsageStats>;
  const users = record.users;
  const generations = record.generations;
  return {
    users: typeof users === "number" && Number.isSafeInteger(users) && users >= 0 ? users : 0,
    generations:
      typeof generations === "number" && Number.isSafeInteger(generations) && generations >= 0
        ? generations
        : 0,
  };
}

/** Global, serialised counters for the public usage summary. */
export class UsageStatsCounter {
  constructor(private readonly state: UsageStatsState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/read") {
      let snapshot: UsageStats = { ...EMPTY_USAGE_STATS };
      await this.state.blockConcurrencyWhile(async () => {
        snapshot = normalizeUsageStats(await this.state.storage.get(USAGE_STATS_KEY));
      });
      return Response.json(snapshot);
    }

    if (request.method === "POST" && url.pathname === "/record") {
      const payload = (await request.json().catch(() => null)) as UsageStatsPayload | null;
      if (!payload || !isVisitorId(payload.visitorId)) {
        return Response.json({ error: "invalid_visitor" }, { status: 400 });
      }

      let snapshot: UsageStats = { ...EMPTY_USAGE_STATS };
      await this.state.blockConcurrencyWhile(async () => {
        const current = normalizeUsageStats(await this.state.storage.get(USAGE_STATS_KEY));
        const visitorKey = `visitor:${payload.visitorId}`;
        const hasVisited = await this.state.storage.get<boolean>(visitorKey);

        snapshot = {
          users: current.users + (hasVisited ? 0 : 1),
          generations: current.generations + 1,
        };
        await this.state.storage.put(visitorKey, true);
        await this.state.storage.put(USAGE_STATS_KEY, snapshot);
      });

      return Response.json(snapshot);
    }

    return new Response("Not found", { status: 404 });
  }
}

export class RateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(): Promise<Response> {
    const now = Date.now();
    const existing = await this.state.storage.get<RateLimitRecord>("rate-limit");
    const record = !existing || now >= existing.resetAt
      ? { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
      : existing;

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

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const MAX_PAYLOAD_BYTES = 4096;

/** Reads the request body under a hard byte cap. The Content-Length header
 * can't be trusted (chunked / HTTP2 uploads may omit it), so the clone's
 * stream is read incrementally and aborted the moment it exceeds the cap —
 * never buffered unbounded. */
async function readSmallJsonPayload(request: Request): Promise<{ topic?: unknown } | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_PAYLOAD_BYTES) return null;
  const body = request.clone().body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_PAYLOAD_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as { topic?: unknown };
  } catch {
    return null;
  }
}

function getVisitorId(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === VISITOR_COOKIE && isVisitorId(value)) return value;
  }
  return null;
}

function ensureVisitorId(request: Request): { id: string; isNew: boolean } {
  const existing = getVisitorId(request);
  return existing ? { id: existing, isNew: false } : { id: crypto.randomUUID(), isNew: true };
}

function withVisitorCookie(
  response: Response,
  request: Request,
  visitorId: string,
  shouldSet: boolean,
): Response {
  if (!shouldSet) return response;

  const headers = new Headers(response.headers);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  headers.append(
    "Set-Cookie",
    `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readUsageStats(env: Env): Promise<UsageStats> {
  if (!env.STATS) throw new Error("STATS binding is not configured");
  const id = env.STATS.idFromName("global");
  const response = await env.STATS.get(id).fetch("https://blah-stats/read");
  if (!response.ok) throw new Error(`stats read failed: ${response.status}`);
  return normalizeUsageStats(await response.json().catch(() => null));
}

async function recordUsage(env: Env, visitorId: string): Promise<void> {
  if (!env.STATS) return;
  const id = env.STATS.idFromName("global");
  const response = await env.STATS.get(id).fetch("https://blah-stats/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitorId }),
  });
  if (!response.ok) throw new Error(`stats record failed: ${response.status}`);
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/stats" && request.method === "GET") {
      const visitor = ensureVisitorId(request);
      try {
        const stats = await readUsageStats(env);
        return withVisitorCookie(Response.json(stats), request, visitor.id, visitor.isNew);
      } catch (error) {
        console.warn("stats: unavailable", error);
        return withVisitorCookie(
          Response.json({ error: "stats_unavailable" }, { status: 503 }),
          request,
          visitor.id,
          visitor.isNew,
        );
      }
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      // Reject invalid payloads before touching the rate limiter so bad
      // requests can't burn a client's quota (the route re-validates).
      const payload = await readSmallJsonPayload(request);
      if (!payload || normalizeTopic(payload.topic) === null) {
        return Response.json({ error: "invalid_topic" }, { status: 400 });
      }

      const clientIp = request.headers.get("CF-Connecting-IP") ?? "anonymous";
      const limiterId = env.RATE_LIMITER.idFromName(clientIp);
      const limiterResponse = await env.RATE_LIMITER.get(limiterId).fetch("https://rate-limit/check");
      if (!limiterResponse.ok) return limiterResponse;
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const response = await handler.fetch(request, env, ctx);
    if (url.pathname === "/api/generate" && request.method === "POST" && response.ok) {
      const visitor = ensureVisitorId(request);
      try {
        await recordUsage(env, visitor.id);
      } catch (error) {
        // Usage telemetry must never turn a successful generation into an error.
        console.warn("stats: record unavailable", error);
      }
      return withVisitorCookie(response, request, visitor.id, visitor.isNew);
    }
    return response;
  },
};

export default worker;
