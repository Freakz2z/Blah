/**
 * "生成数量排行榜" backed by the Toy JS SDK's scoreboard (board 1).
 *
 * The submitted score is this browser's cumulative local generation count;
 * the platform keeps only each user's highest score per board, so
 * re-submitting the growing count just raises it. The 24h / 7d / 30d views
 * are the SDK's own period filters (day / week / month). The SDK object is
 * injectable for tests; production defaults to `window.toy`. Every call
 * degrades silently — no SDK or not logged in must never block generation.
 */

export const LEADERBOARD_BOARD = 1;

export type LeaderboardPeriod = "day" | "week" | "month";

export const LEADERBOARD_PERIODS: ReadonlyArray<{
  value: LeaderboardPeriod;
  label: string;
}> = [
  { value: "day", label: "24小时" },
  { value: "week", label: "7天" },
  { value: "month", label: "30天" },
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

/** Fire-and-forget best-effort submission of the cumulative local count. */
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
