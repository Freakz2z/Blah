import { fallbackForLength } from "./api/generate/fallback.ts";
import { isUnsafeGeneratedText, safeFallbackForLength } from "./api/generate/safety.ts";
import {
  normalizeGenerationLength,
  normalizeGenerationMode,
  normalizeTopic,
} from "./api/generate/validation.ts";

/**
 * Toy's runtime must remain useful when it is opened from bilibilitoy.com,
 * where the Cloudflare Worker is intentionally not part of the execution
 * path. This is the same bounded fallback used by the Worker when no model is
 * available, kept in a browser-safe module with no secrets or network calls.
 */
export function generateStandaloneText(
  rawTopic: string,
  rawMode: string,
  rawLength: string,
): string {
  const topic = normalizeTopic(rawTopic);
  if (!topic) throw new Error("invalid_topic");
  if (isUnsafeGeneratedText(topic)) throw new Error("unsafe_topic");

  const mode = normalizeGenerationMode(rawMode);
  const generationLength = normalizeGenerationLength(rawLength);
  const text = fallbackForLength(topic, "正常", generationLength, mode);

  return isUnsafeGeneratedText(text) ? safeFallbackForLength(generationLength) : text;
}
