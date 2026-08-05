import { fallbackForLength } from "../../shared/generate/fallback.ts";
import { isUnsafeGeneratedText, safeFallbackForLength } from "../../shared/generate/safety.ts";
import {
  normalizeGenerationLength,
  normalizeGenerationMode,
  normalizeTopic,
} from "../../shared/generate/validation.ts";

/**
 * This bounded fallback keeps a Toy package usable when the relay is
 * temporarily unavailable. It has no secrets or network calls.
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
