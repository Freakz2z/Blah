/** Prompt assembly for the Toy relay.
 *
 * The complete community Skill is compiled into the Worker and sent on every
 * request. The selected runtime configuration is appended last so the model
 * applies exactly one mode, mental state, length, and mechanism. Prompt copy
 * lives only in skills/blahblah-generator/SKILL.md. */

import { SKILL_SOURCE, SKILL_SPEC, SKILL_SHA256 } from "./generated-skill.ts";
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
};

/** Permanent plagiarism baselines for all examples shown to the model. */
export const EXEMPLAR_SENTENCES = [
  ...STATE_EXEMPLARS,
  ...Object.values(MODE_MOOD_EXAMPLES).flatMap((examples) =>
    Object.values(examples).map((example) => example.split("→")[1]),
  ),
];

export const MENTAL_STATE_PROMPTS: Record<string, string> = {
  ...SKILL_SPEC.mentalStates,
};
export const COMPACT_MENTAL_STATE_PROMPTS: Record<string, string> = {
  ...SKILL_SPEC.compactMentalStates,
};
export const GENERATION_LENGTH_PROMPTS: Record<GenerationLength, string> = {
  ...SKILL_SPEC.lengths,
};
export const MECHANISM_HINTS: Record<string, string> = {
  ...SKILL_SPEC.mechanisms,
};
export const TIER_MECHANISMS: Record<string, string[]> = Object.fromEntries(
  Object.entries(SKILL_SPEC.mechanismPools).map(([mood, names]) => [mood, [...names]]),
);

function strictSuffix(generationLength: GenerationLength): string {
  const { min, max } = GENERATION_LENGTH_LIMITS[generationLength];
  return SKILL_SPEC.strictTemplate
    .replace("{{MIN}}", String(min))
    .replace("{{MAX}}", String(max));
}

export interface MechanismDraw {
  /** Mechanism names for the three parallel candidates (always disjoint). */
  candidates: [string[], string[], string[]];
  /** Single mechanism reserved for the strict retry. */
  retry: string;
}

export function drawMechanismSets(mood: string): MechanismDraw {
  const pool = [...TIER_MECHANISMS[mood]];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const candidates: [string[], string[], string[]] = [[pool[0]], [pool[1]], [pool[2]]];
  const retry = pool[3] ?? pool[Math.floor(Math.random() * pool.length)];
  return { candidates, retry };
}

/** Keep the selected appendix last so the full Skill remains the reusable
 * source of truth while the runtime configuration stays authoritative. */
export function buildRuntimePrompt(
  mood: string,
  mechanisms: string[],
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
    mechanisms.map((name) => MECHANISM_HINTS[name]).join("\n"),
    GENERATION_LENGTH_PROMPTS[generationLength],
    QUALITY_GATE,
  ];
  if (strict) parts.push(strictSuffix(generationLength));
  return parts.filter(Boolean).join("\n\n");
}

export function buildSystemPrompt(
  mood: string,
  mechanisms: string[],
  strict = false,
  generationLength: GenerationLength = "正常",
  mode: GenerationMode = "翻译",
): string {
  const runtime = buildRuntimePrompt(mood, mechanisms, strict, generationLength, mode);
  return `${SKILL_SOURCE}\n\n---\n\n${RUNTIME_INSTRUCTION}\n\n${runtime}`;
}
