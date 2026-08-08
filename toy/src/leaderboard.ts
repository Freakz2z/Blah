/**
 * 「胡言乱语榜」由 Toy JS SDK 的数字排行榜（board 1）提供。
 *
 * 提交值是登录用户的胡言乱语值；每次有效生成加 1。平台会保留各周期内用户提交过的
 * 最高分。总榜 / 月榜 / 周榜 / 日榜直接对应 SDK 的 all / month / week / day。
 * SDK 可在测试中注入，生产环境默认使用 `window.toy`。任何排行榜故障都不能
 * 阻塞生成流程。
 */

export const LEADERBOARD_BOARD = 1;

export type LeaderboardPeriod = "all" | "month" | "week" | "day";

export const LEADERBOARD_PERIODS: ReadonlyArray<{
  value: LeaderboardPeriod;
  label: string;
}> = [
  { value: "all", label: "总榜" },
  { value: "month", label: "月榜" },
  { value: "week", label: "周榜" },
  { value: "day", label: "日榜" },
];

/** A hanging SDK call must not leave the rank tab stuck on "加载中". */
export const LEADERBOARD_FETCH_TIMEOUT_MS = 4000;

export interface LeaderboardRow {
  rank: number;
  score: number;
  nickname: string;
  avatar: string;
}

export interface MyLeaderboardRank {
  ranked: boolean;
  rank: number;
  score: number;
}

export interface ToyLeaderboardSdk {
  submitScore(req: { board?: number; score: number }): Promise<{ score: number }>;
  getRankList(req?: {
    board?: number;
    period?: string;
    limit?: number;
  }): Promise<LeaderboardRow[]>;
  getMyRank(req?: { board?: number; period?: string }): Promise<MyLeaderboardRank>;
}

function toySdk(): ToyLeaderboardSdk | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { toy?: unknown }).toy;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as ToyLeaderboardSdk).submitScore !== "function"
  ) {
    return null;
  }
  return candidate as ToyLeaderboardSdk;
}

/** Fire-and-forget best-effort submission of the canonical 胡言乱语值. */
export async function submitLeaderboardScore(
  score: number,
  sdk: ToyLeaderboardSdk | null = toySdk(),
): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.submitScore({ board: LEADERBOARD_BOARD, score });
  } catch {
    // Not logged in, consent pending, or service unavailable — the next
    // generation retries. Never block the generation flow.
  }
}

export interface LeaderboardSnapshot {
  /** Top-`limit` rows of the board for the period, highest first. */
  list: LeaderboardRow[];
  /** My own rank; `null` when the call failed (e.g. not logged in). */
  mine: MyLeaderboardRank | null;
}

/** Fetch the board for a period plus my rank. Returns `null` when the SDK is
 * absent, the call fails, or it times out, so the caller can render the muted
 * state. */
export async function fetchLeaderboard(
  period: LeaderboardPeriod = "week",
  limit = 10,
  sdk: ToyLeaderboardSdk | null = toySdk(),
  timeoutMs: number = LEADERBOARD_FETCH_TIMEOUT_MS,
): Promise<LeaderboardSnapshot | null> {
  if (!sdk) return null;
  const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("leaderboard_fetch_timeout")), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  try {
    const [list, mine] = await Promise.all([
      withTimeout(sdk.getRankList({ board: LEADERBOARD_BOARD, period, limit })),
      sdk.getMyRank({ board: LEADERBOARD_BOARD, period }).catch(() => null),
    ]);
    return { list, mine };
  } catch {
    return null;
  }
}
