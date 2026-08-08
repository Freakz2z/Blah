/**
 * SentenceStore — a DurableObject holding user-submitted "胡言乱语" sentences
 * and their 1–5 ratings, for the 胡言乱语排行榜.
 *
 * Each sentence is stored as one key with aggregated rating sum/count; the
 * leaderboard scans them, filters by age window, and ranks by average rating
 * (tie-break: more votes first). Extracted as a plain class (no parameter
 * properties) so node --experimental-strip-types can import it in tests.
 */

import { isUnsafeGeneratedText } from "../../shared/generate/safety.ts";

const SENTENCE_PREFIX = "sentence:";
export const SENTENCE_MAX_LENGTH = 48;
export const RATING_MIN = 1;
export const RATING_MAX = 5;

const WINDOW_MS: Record<string, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

export interface SentenceEntry {
  id: string;
  text: string;
  nickname: string;
  avatar: string;
  createdAt: number;
  sum: number;
  count: number;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

export class SentenceStore {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/submit") {
      return this.submit(await request.json().catch(() => null));
    }
    if (request.method === "POST" && url.pathname === "/rate") {
      return this.rate(await request.json().catch(() => null));
    }
    if (request.method === "GET" && url.pathname === "/leaderboard") {
      const window = url.searchParams.get("window") ?? "day";
      const limitRaw = url.searchParams.get("limit") ?? "50";
      return this.leaderboard(window, limitRaw);
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  async submit(payload: unknown): Promise<Response> {
    const body = (payload ?? {}) as {
      text?: unknown;
      nickname?: unknown;
      avatar?: unknown;
    };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const nickname =
      typeof body.nickname === "string" && body.nickname.trim()
        ? body.nickname.trim().slice(0, 30)
        : "匿名";
    const avatar = typeof body.avatar === "string" ? body.avatar.slice(0, 300) : "";
    if (!text || Array.from(text).length > SENTENCE_MAX_LENGTH) {
      return Response.json({ error: "invalid_sentence" }, { status: 400 });
    }
    if (isUnsafeGeneratedText(text)) {
      return Response.json({ error: "unsafe_sentence" }, { status: 400 });
    }
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const entry: SentenceEntry = {
      id,
      text,
      nickname,
      avatar,
      createdAt: Date.now(),
      sum: 0,
      count: 0,
    };
    await this.state.storage.put(`${SENTENCE_PREFIX}${id}`, entry);
    return Response.json({ ok: true, id });
  }

  async rate(payload: unknown): Promise<Response> {
    const body = (payload ?? {}) as { id?: unknown; rating?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    const rating = body.rating;
    if (
      !id ||
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < RATING_MIN ||
      rating > RATING_MAX
    ) {
      return Response.json({ error: "invalid_rating" }, { status: 400 });
    }
    const key = `${SENTENCE_PREFIX}${id}`;
    const entry = await this.state.storage.get<SentenceEntry>(key);
    if (!entry) return Response.json({ error: "not_found" }, { status: 404 });
    entry.sum += rating;
    entry.count += 1;
    await this.state.storage.put(key, entry);
    return Response.json({ ok: true });
  }

  async leaderboard(window: string, limitRaw: string): Promise<Response> {
    const ms = WINDOW_MS[window] ?? WINDOW_MS.day;
    const limit = Math.max(1, Math.min(parseInt(limitRaw, 10) || 50, 100));
    const cutoff = Date.now() - ms;
    const stored = await this.state.storage.list<SentenceEntry>({ prefix: SENTENCE_PREFIX });
    const rows: Array<{
      id: string;
      text: string;
      nickname: string;
      avatar: string;
      rating: number;
      votes: number;
      createdAt: number;
    }> = [];
    for (const [, entry] of stored) {
      if (entry.count < 1 || entry.createdAt < cutoff) continue;
      rows.push({
        id: entry.id,
        text: entry.text,
        nickname: entry.nickname,
        avatar: entry.avatar,
        rating: entry.sum / entry.count,
        votes: entry.count,
        createdAt: entry.createdAt,
      });
    }
    rows.sort(
      (a, b) =>
        b.rating - a.rating || b.votes - a.votes || a.createdAt - b.createdAt,
    );
    return Response.json({ rows: rows.slice(0, limit) });
  }
}
