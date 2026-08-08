/**
 * "胡言乱语排行榜" — user-submitted generated sentences with 1–5 ratings,
 * served by our relay's SentenceStore DurableObject. The generated text
 * leaves the browser only when the user explicitly submits it ("投上榜");
 * guests can read the board but cannot submit or rate.
 */

export type SentenceWindow = "day" | "week" | "month";

export interface SentenceRow {
  id: string;
  text: string;
  nickname: string;
  avatar: string;
  rating: number;
  votes: number;
}

export interface SentenceSubmitProfile {
  nickname: string;
  avatar: string;
}

/** Fetch the quality board for a window. Returns `null` on failure so the
 * caller can render the muted state. */
export async function fetchSentenceBoard(
  window: SentenceWindow,
  relay: string,
  limit = 50,
): Promise<SentenceRow[] | null> {
  if (!relay) return null;
  try {
    const response = await fetch(
      `${relay}/sentences/leaderboard?window=${window}&limit=${limit}`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { rows?: unknown };
    return Array.isArray(data.rows) ? (data.rows as SentenceRow[]) : null;
  } catch {
    return null;
  }
}

/** Submit the generated sentence to the quality board. Returns false when the
 * relay is unavailable or rejects. */
export async function submitSentence(
  text: string,
  profile: SentenceSubmitProfile | null,
  relay: string,
): Promise<boolean> {
  if (!relay || !text) return false;
  try {
    const response = await fetch(`${relay}/sentences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        nickname: profile?.nickname ?? "",
        avatar: profile?.avatar ?? "",
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Rate a board sentence 1–5. Returns false when unavailable or rejected. */
export async function rateSentence(
  id: string,
  rating: number,
  relay: string,
): Promise<boolean> {
  if (!relay || !id || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return false;
  }
  try {
    const response = await fetch(`${relay}/sentences/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, rating }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
