/** Shared request validation for /api/generate — imported by both the
 * Worker entry (to avoid charging invalid requests against the rate limit)
 * and the route handler. Must stay free of Next.js/server-only imports. */

export const MAX_TOPIC_LENGTH = 30;

export function normalizeTopic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const topic = value.trim();
  if (!topic || Array.from(topic).length > MAX_TOPIC_LENGTH) return null;
  return topic;
}
