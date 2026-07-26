import { NextResponse } from "next/server";
import { normalizeGenerationLength, normalizeTopic, type GenerationLength } from "./validation";
import { MENTAL_STATE_PROMPTS, buildSystemPrompt, drawMechanismSets } from "./prompts";
import {
  cleanGeneratedText,
  validateGeneratedText,
  scoreGeneratedText,
  recentSimilarity,
  rememberResult,
} from "./quality";

const fallbackLines = [
  "我建议先把这个问题放进括号里，等星期四带着它一起去考研。",
  "这个选题看起来很正常，直到它意识到自己其实是一根有编制的意大利面。",
  "据不可靠消息，所有认真讨论这件事的人，最后都会被分配到同一个括号里。",
  "如果今天必须得出结论，那结论大概会先去买一杯奶茶再回来。",
];

function fallbackForLength(topic: string, generationLength: GenerationLength): string {
  if (generationLength === "精辟") {
    const core = Array.from(topic).slice(0, 4).join("");
    return `${core}先别着急。`;
  }
  if (generationLength === "中等") {
    const core = Array.from(topic).slice(0, 6).join("");
    return `${core}先别急着下结论，它正排队解释自己。`;
  }
  return fallbackLines[Math.floor(Math.random() * fallbackLines.length)];
}

interface SamplingParams {
  temperature: number;
  topP: number;
  maxTokens: number;
  timeoutMs: number;
}

// Dual temperatures pull the two candidates apart stylistically (mean ≈ 1.35);
// top_p trims the garbage tail that high temperature would otherwise sample.
const CANDIDATE_PARAMS: [SamplingParams, SamplingParams] = [
  { temperature: 1.25, topP: 0.95, maxTokens: 100, timeoutMs: 12_000 },
  { temperature: 1.45, topP: 0.95, maxTokens: 100, timeoutMs: 12_000 },
];
const RETRY_PARAMS: SamplingParams = { temperature: 1.0, topP: 0.9, maxTokens: 90, timeoutMs: 10_000 };

async function requestCompletion(
  endpoint: string,
  apiKey: string,
  systemPrompt: string,
  topic: string,
  params: SamplingParams,
): Promise<{ content: string; finishReason: string }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      thinking: { type: "disabled" },
      temperature: params.temperature,
      top_p: params.topP,
      frequency_penalty: 0.3,
      max_tokens: params.maxTokens,
      stop: ["\n"],
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `选题：${topic}` },
      ],
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) throw new Error(`upstream_${response.status}`);
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    finishReason: data.choices?.[0]?.finish_reason ?? "",
  };
}

function acceptCompletion(
  completion: { content: string; finishReason: string },
  topic: string,
  mood: string,
  generationLength: GenerationLength,
  label: string,
): string | null {
  // Only finish_reason "stop" is trustworthy — "length" means truncation.
  if (completion.finishReason !== "stop") {
    console.warn(`generate ${label}: rejected finish_reason=${completion.finishReason}`);
    return null;
  }
  const text = cleanGeneratedText(completion.content);
  const reason = validateGeneratedText(text, topic, mood, generationLength);
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
  };
  const topic = normalizeTopic(body.topic);
  if (!topic) return NextResponse.json({ error: "invalid_topic" }, { status: 400 });
  const mood =
    typeof body.mood === "string" && Object.hasOwn(MENTAL_STATE_PROMPTS, body.mood)
      ? body.mood
      : "正常";
  const generationLength = normalizeGenerationLength(body.length);

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn("generate: DEEPSEEK_API_KEY is not set — serving a canned fallback line");
    await new Promise((resolve) => setTimeout(resolve, 520));
    return NextResponse.json({ text: fallbackForLength(topic, generationLength) });
  }

  const endpoint = process.env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com/chat/completions";
  const draw = drawMechanismSets(mood);
  // Short and medium sentences cannot faithfully carry two mechanisms.
  // Keeping one preserves a clear absurd turn instead of forcing candidates
  // over the selected length limit.
  const candidateMechanisms: [string[], string[]] = generationLength !== "正常"
    ? [[draw.candidates[0][0]], [draw.candidates[1][0]]]
    : draw.candidates;

  const settled = await Promise.allSettled(
    candidateMechanisms.map((mechanisms, i) =>
      requestCompletion(
        endpoint,
        apiKey,
        buildSystemPrompt(mood, mechanisms, false, generationLength),
        topic,
        CANDIDATE_PARAMS[i],
      ),
    ),
  );

  const valid: Array<{ text: string; score: number; topicHit: number; length: number; index: number }> = [];
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      console.warn(`generate candidate-${index}: upstream failure`, result.reason);
      return;
    }
    const text = acceptCompletion(result.value, topic, mood, generationLength, `candidate-${index}`);
    if (!text) return;
    const similarity = recentSimilarity(topic, mood, text);
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
        endpoint,
        apiKey,
        buildSystemPrompt(mood, [draw.retry], true, generationLength),
        topic,
        RETRY_PARAMS,
      );
      const retryText = acceptCompletion(retry, topic, mood, generationLength, "retry");
      if (retryText && recentSimilarity(topic, mood, retryText) <= 0.5) text = retryText;
    } catch (error) {
      console.warn("generate retry: upstream failure", error);
    }
  }

  if (!text) return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  rememberResult(topic, mood, text);
  return NextResponse.json({ text });
}
