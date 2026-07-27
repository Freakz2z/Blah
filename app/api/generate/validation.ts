/** Shared request validation for /api/generate — imported by both the
 * Worker entry (to avoid charging invalid requests against the rate limit)
 * and the route handler. Must stay free of Next.js/server-only imports. */

export const MAX_TOPIC_LENGTH = 30;

export const GENERATION_MODES = ["翻译", "回答"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const GENERATION_LENGTHS = ["精辟", "中等", "正常"] as const;
export type GenerationLength = (typeof GENERATION_LENGTHS)[number];

export const GENERATION_LENGTH_LIMITS: Record<GenerationLength, { min: number; max: number; target: number }> = {
  精辟: { min: 4, max: 8, target: 6 },
  中等: { min: 12, max: 24, target: 18 },
  正常: { min: 25, max: 48, target: 36 },
};

export function normalizeTopic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const topic = value.trim();
  if (!topic || Array.from(topic).length > MAX_TOPIC_LENGTH) return null;
  return topic;
}

export function normalizeGenerationMode(value: unknown): GenerationMode {
  return typeof value === "string" && GENERATION_MODES.includes(value as GenerationMode)
    ? value as GenerationMode
    : "翻译";
}

export function normalizeGenerationLength(value: unknown): GenerationLength {
  return typeof value === "string" && GENERATION_LENGTHS.includes(value as GenerationLength)
    ? value as GenerationLength
    : "正常";
}
