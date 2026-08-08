/** Prompt assembly for the Toy relay.
 *
 * The complete community Skill is compiled into the Worker and sent on every
 * request. The selected runtime configuration is appended last so the model
 * applies exactly one mode, mental state, length, and mechanism. Prompt copy
 * lives only in skills/blahblah-generator/SKILL.md. */

import { SKILL_SOURCE, SKILL_SPEC, SKILL_SHA256 } from "./generated-skill.ts";
import { trendingPromptSection } from "./trending.ts";
import {
  GENERATION_LENGTH_LIMITS,
  type GenerationLength,
  type GenerationMode,
} from "./validation.ts";

export { SKILL_SOURCE, SKILL_SHA256 };

export const RUNTIME_INSTRUCTION = SKILL_SPEC.runtimeInstruction;
export const COMMON_PROMPT = SKILL_SPEC.common;
export const QUALITY_GATE = SKILL_SPEC.qualityGate;
export const MODE_PROMPTS: Record<GenerationMode, string> = { ...SKILL_SPEC.modes };
const STATE_EXEMPLARS = [...SKILL_SPEC.stateExemplars];

export const MODE_MOOD_EXAMPLES: Record<GenerationMode, Record<string, string>> = {
  翻译: { ...SKILL_SPEC.modeMoodExamples["翻译"] },
  回答: { ...SKILL_SPEC.modeMoodExamples["回答"] },
  自由: { ...SKILL_SPEC.modeMoodExamples["自由"] },
};

/** Parses one 「原话|问题「X」→Y」 exemplar into its input and output parts. */
function extractExemplarParts(example: string): { input: string; output: string } {
  const inputMatch = example.match(/「([^」]+)」/);
  const output = example.split("→")[1]?.trim() ?? example.trim();
  return { input: inputMatch?.[1]?.trim() ?? "", output };
}

const EXEMPLAR_PARTS = [
  ...Object.values(MODE_MOOD_EXAMPLES).flatMap((examples) => Object.values(examples)),
].map(extractExemplarParts);

/** Permanent plagiarism baselines for all examples shown to the model. */
export const EXEMPLAR_SENTENCES = [
  ...STATE_EXEMPLARS,
  ...EXEMPLAR_PARTS.map((part) => part.output),
];

/** The exemplar inputs the examples were written from, normalized by stripping
 * trailing punctuation. When the user's topic matches one, its own exemplar
 * output is a legitimate expected answer — the plagiarism baseline must exempt
 * it, otherwise users typing the README's showcased examples always trip the
 * guard and land on the fallback. */
export const EXEMPLAR_TOPICS = new Set(
  EXEMPLAR_PARTS.filter((part) => part.input)
    .map((part) => part.input.replace(/[。！？.!?]+$/u, "")),
);

/** Exemplar outputs whose input matches the given topic (trailing punctuation
 * normalized). Empty when the topic is not an exemplar input. */
export function exemplarOutputsForTopic(topic: string): string[] {
  const normalized = topic.replace(/[。！？.!?]+$/u, "");
  if (!EXEMPLAR_TOPICS.has(normalized)) return [];
  return EXEMPLAR_PARTS.filter(
    (part) => part.input.replace(/[。！？.!?]+$/u, "") === normalized,
  ).map((part) => part.output);
}

export const MENTAL_STATE_PROMPTS: Record<string, string> = {
  ...SKILL_SPEC.mentalStates,
};
export const COMPACT_MENTAL_STATE_PROMPTS: Record<string, string> = {
  ...SKILL_SPEC.compactMentalStates,
};
export const GENERATION_LENGTH_PROMPTS: Record<GenerationLength, string> = {
  ...SKILL_SPEC.lengths,
};

function strictSuffix(generationLength: GenerationLength): string {
  const { min, max } = GENERATION_LENGTH_LIMITS[generationLength];
  return SKILL_SPEC.strictTemplate
    .replace("{{MIN}}", String(min))
    .replace("{{MAX}}", String(max));
}

/** Keep the selected appendix last so the full Skill remains the reusable
 * source of truth while the runtime configuration stays authoritative. */
export function buildRuntimePrompt(
  mood: string,
  strict = false,
  generationLength: GenerationLength = "正常",
  mode: GenerationMode = "翻译",
): string {
  const parts = [
    COMMON_PROMPT,
    generationLength !== "正常" ? COMPACT_MENTAL_STATE_PROMPTS[mood] : MENTAL_STATE_PROMPTS[mood],
    MODE_PROMPTS[mode],
    generationLength === "正常"
      ? `结构示范（只学保留原意和落梗方式，禁止复用名词）：${MODE_MOOD_EXAMPLES[mode][mood]}`
      : undefined,
    trendingPromptSection(),
    GENERATION_LENGTH_PROMPTS[generationLength],
    QUALITY_GATE,
  ];
  if (strict) parts.push(strictSuffix(generationLength));
  return parts.filter(Boolean).join("\n\n");
}

export function buildSystemPrompt(
  mood: string,
  strict = false,
  generationLength: GenerationLength = "正常",
  mode: GenerationMode = "翻译",
): string {
  const runtime = buildRuntimePrompt(mood, strict, generationLength, mode);
  return `${SKILL_SOURCE}\n\n---\n\n${RUNTIME_INSTRUCTION}\n\n${runtime}`;
}
