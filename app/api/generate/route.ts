import { NextResponse } from "next/server";
import {
  normalizeGenerationLength,
  normalizeGenerationMode,
  normalizeTopic,
  type GenerationLength,
  type GenerationMode,
} from "./validation";
import { MENTAL_STATE_PROMPTS, buildSystemPrompt, drawMechanismSets } from "./prompts";
import {
  cleanGeneratedText,
  validateGeneratedText,
  scoreGeneratedText,
  recentSimilarity,
  rememberResult,
} from "./quality";
import { fallbackForLength } from "./fallback";
import { isUnsafeGeneratedText, safeFallbackForLength } from "./safety";
import {
  requestCompletion,
  resolveProviderConfig,
  type SamplingParams,
} from "./provider";

// Three moderate-temperature candidates create useful variety without pushing
// the model into the word-salad tail that high temperatures produced.
const CANDIDATE_PARAMS: Record<
  GenerationMode,
  [SamplingParams, SamplingParams, SamplingParams]
> = {
  翻译: [
    { temperature: 0.55, topP: 0.78, maxTokens: 100, timeoutMs: 12_000 },
    { temperature: 0.7, topP: 0.82, maxTokens: 100, timeoutMs: 12_000 },
    { temperature: 0.85, topP: 0.86, maxTokens: 100, timeoutMs: 12_000 },
  ],
  回答: [
    { temperature: 0.7, topP: 0.82, maxTokens: 100, timeoutMs: 12_000 },
    { temperature: 0.9, topP: 0.88, maxTokens: 100, timeoutMs: 12_000 },
    { temperature: 1.05, topP: 0.92, maxTokens: 100, timeoutMs: 12_000 },
  ],
};
const RETRY_PARAMS: Record<GenerationMode, SamplingParams> = {
  翻译: { temperature: 0.45, topP: 0.75, maxTokens: 90, timeoutMs: 10_000 },
  回答: { temperature: 0.65, topP: 0.8, maxTokens: 90, timeoutMs: 10_000 },
};

function acceptCompletion(
  completion: { content: string; finishReason: string },
  topic: string,
  mood: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
  label: string,
): string | null {
  // Only finish_reason "stop" is trustworthy — "length" means truncation.
  if (completion.finishReason !== "stop") {
    console.warn(`generate ${label}: rejected finish_reason=${completion.finishReason}`);
    return null;
  }
  const text = cleanGeneratedText(completion.content);
  if (isUnsafeGeneratedText(text)) {
    console.warn(`generate ${label}: rejected unsafe_output`);
    return null;
  }
  const reason = validateGeneratedText(text, topic, mood, generationLength, mode);
  if (reason) {
    console.warn(`generate ${label}: rejected ${reason}`);
    return null;
  }
  return text;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    topic?: unknown;
    mood?: unknown;
    length?: unknown;
    mode?: unknown;
  };
  const topic = normalizeTopic(body.topic);
  if (!topic) return NextResponse.json({ error: "invalid_topic" }, { status: 400 });
  if (isUnsafeGeneratedText(topic)) {
    return NextResponse.json({ error: "unsafe_topic" }, { status: 400 });
  }
  const mood =
    typeof body.mood === "string" && Object.hasOwn(MENTAL_STATE_PROMPTS, body.mood)
      ? body.mood
      : "正常";
  const generationLength = normalizeGenerationLength(body.length);
  const mode = normalizeGenerationMode(body.mode);
  const historyTopic = `${mode}：${topic}`;

  const provider = resolveProviderConfig();
  if (!provider) {
    console.warn("generate: no model API key is set — serving a canned fallback line");
    await new Promise((resolve) => setTimeout(resolve, 520));
    const fallback = fallbackForLength(topic, mood, generationLength, mode);
    return NextResponse.json({
      text: isUnsafeGeneratedText(fallback) ? safeFallbackForLength(generationLength) : fallback,
    });
  }
  if (provider.provider !== provider.requestedProvider) {
    console.warn(
      `generate: ${provider.requestedProvider} unavailable — falling back to ${provider.provider}`,
    );
  }
  const draw = drawMechanismSets(mood);
  // Short and medium sentences cannot faithfully carry two mechanisms.
  // Keeping one preserves a clear absurd turn instead of forcing candidates
  // over the selected length limit.
  const candidateMechanisms = draw.candidates;

  const settled = await Promise.allSettled(
    candidateMechanisms.map((mechanisms, i) =>
      requestCompletion(
        provider,
        buildSystemPrompt(mood, mechanisms, false, generationLength, mode),
        topic,
        mode,
        CANDIDATE_PARAMS[mode][i],
      ),
    ),
  );

  const valid: Array<{ text: string; score: number; topicHit: number; length: number; index: number }> = [];
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      console.warn(`generate candidate-${index}: upstream failure`, result.reason);
      return;
    }
    const text = acceptCompletion(result.value, topic, mood, generationLength, mode, `candidate-${index}`);
    if (!text) return;
    const similarity = recentSimilarity(historyTopic, mood, text);
    if (similarity > 0.5) {
      console.warn(`generate candidate-${index}: rejected too_similar`);
      return;
    }
    const { score, topicHit, length } = scoreGeneratedText(
      text,
      topic,
      mood,
      similarity,
      candidateMechanisms[index],
      generationLength,
      mode,
    );
    valid.push({ text, score, topicHit, length, index });
  });

  valid.sort(
    (a, b) => b.score - a.score || b.topicHit - a.topicHit || b.length - a.length || a.index - b.index,
  );
  let text = valid[0]?.text;

  if (!text) {
    try {
      const retry = await requestCompletion(
        provider,
        buildSystemPrompt(mood, [draw.retry], true, generationLength, mode),
        topic,
        mode,
        RETRY_PARAMS[mode],
      );
      const retryText = acceptCompletion(retry, topic, mood, generationLength, mode, "retry");
      if (retryText && recentSimilarity(historyTopic, mood, retryText) <= 0.5) text = retryText;
    } catch (error) {
      console.warn("generate retry: upstream failure", error);
    }
  }

  // Preserve the interaction contract when all model candidates fail quality
  // validation. Every mode and length has a bounded, task-aware fallback, so a
  // transient model miss never becomes an opaque 502 for the user.
  if (!text) text = fallbackForLength(topic, mood, generationLength, mode);
  if (isUnsafeGeneratedText(text)) text = safeFallbackForLength(generationLength);
  rememberResult(historyTopic, mood, text);
  return NextResponse.json({ text });
}
