/** Vote aggregation DurableObject for the Toy relay.
 *
 * Counts 👍/👎 per mechanism (plus「兜底」for fallback outputs) in DO storage.
 * Only counts and mechanism names are persisted — never the generated text,
 * honoring the README's "历史文本不会发送给统计接口" promise.
 *
 * Extracted from index.ts so the pure aggregation logic can be unit-tested
 * under node --experimental-strip-types, which cannot parse parameter
 * properties. */

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface VoteRecord {
  up: number;
  down: number;
}

const MECHANISM_PREFIX = "mechanism:";

/** Laplace-smoothed approval (0..1): one unvoted mechanism scores 0.5, so a
 * lone fan vote can never lock a mechanism in — it needs a consistent margin. */
export function laplaceScore(record: VoteRecord): number {
  return (record.up + 1) / (record.up + record.down + 2);
}

export class VoteStore {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/scores") {
      const list = await this.state.storage.list<VoteRecord>({ prefix: MECHANISM_PREFIX });
      const scores: Record<string, number> = {};
      for (const [key, record] of list) {
        scores[key.slice(MECHANISM_PREFIX.length)] = laplaceScore(record);
      }
      return Response.json({ scores });
    }

    if (request.method === "POST" && url.pathname === "/record") {
      const body = await request.json().catch(() => null) as
        { mechanism?: unknown; vote?: unknown } | null;
      const mechanism = typeof body?.mechanism === "string" ? body.mechanism.trim() : "";
      const vote = body?.vote === 1 ? 1 : body?.vote === -1 ? -1 : 0;
      if (!mechanism || vote === 0) return Response.json({ error: "invalid_vote" }, { status: 400 });

      const key = MECHANISM_PREFIX + mechanism;
      const record = (await this.state.storage.get<VoteRecord>(key)) ?? { up: 0, down: 0 };
      if (vote === 1) record.up += 1;
      else record.down += 1;
      await this.state.storage.put(key, record);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
