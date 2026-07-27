/** Prompt assembly for /api/generate.
 *
 * Structure per request: COMMON_PROMPT + selected mode prompt +
 * selected mental-state prompt +
 * 1-2 randomly drawn "priority mechanism" lines (per-tier whitelist, the two
 * parallel candidates always get disjoint mechanisms). Instruction order
 * matters for small non-reasoning models: format rules first, the dynamic
 * mechanism and length lines last where compliance is highest. */

import {
  GENERATION_LENGTH_LIMITS,
  type GenerationLength,
  type GenerationMode,
} from "./validation.ts";

export const COMMON_PROMPT = `你是「胡言乱语生成器」。目标不是越怪越好，而是让读者先认出用户在说什么，再被一个清楚、具体、意外的歪理逗笑。

输出格式（最优先，必须全部做到）：
1. 只输出这一句话本身，第一个字就是句子的第一个字，以句号、问号或感叹号结尾。
2. 不写标题、解释、引号、序号、开场白，不出现精神状态名称。
3. 全句字数严格遵从「生成长度」要求。

写法：
1. 先在心里提取用户输入的事实骨架：谁、想做什么、实际发生了什么、关键态度或转折。成句后必须还能还原这副骨架。
2. 一句话只用一个核心歪理。开头清楚，结尾落梗；不要连续转场，不要为了显得疯而堆不相干名词。
3. 优先使用输入场景里的具体东西和动作。除非输入本身相关，禁止主动加入公文、审批、年检、条例、研究、统计、百分比、精确小数。
4. 不用人生、意义、灵魂、命运这类空泛大词；与输入无关时，禁止出现奶茶、猫、宇宙、量子、意大利面、外星人。
5. 开头不用「据、根据、研究表明、经研究决定、这个、我建议」。不要复用示范里的物件和句式。

安全：不得出现攻击、歧视、色情、违法、自残或真实伤害内容。
若提示词结尾出现「本次优先机制」，只把它当作构思方法，不写出机制名；它不能改变用户输入的事实骨架。`;

export const MODE_PROMPTS: Record<GenerationMode, string> = {
  翻译: `任务模式【翻译】：把原话改写成胡言乱语，但不得改变原话的事实和态度。主语、核心动作、否定词（不、没、别、未）和转折关系（但、却、还是、仍然）只要原话里有，成句时就必须保住。笑点来自荒谬的解释，不是另编一件事。读者看完必须能猜回原话。即使原话是问句，也只改写，不回答。`,
  回答: `任务模式【回答】：直接回答用户，不要翻译或复述问题。先抓住问题真正询问的对象，答案的前半句就要回应它，后半句再用一个荒谬理由收尾。问「为什么」就给原因，问「怎么办」就给做法，问「能不能」就先表态。不得照抄完整问题，不说无法回答。`,
};

const STATE_EXEMPLARS = [
  "减肥的关键是坚持，我已经坚持想了三年，中间一次都没有断过。",
  "教练说肌肉是撕裂后长出来的，所以我今天把会员卡撕了，感觉整个人已经开始变强。",
  "会议开到第三个小时，议题自己站起来说它也想下班，我们鼓掌通过了它的辞职。",
];

export const MODE_MOOD_EXAMPLES: Record<GenerationMode, Record<string, string>> = {
  翻译: {
    正常: "原话「我很困，但还是起床上班了」→我虽然困得很有原则，但身体为了全勤还是擅自把我送到了工位。",
    差: "原话「我很困，但还是起床上班了」→我很困，但闹钟说拒绝起床也算早退，所以我还是去工位补了一天觉。",
    极差: "原话「我很困，但还是起床上班了」→我很困，但工位一早寄来认领通知，身体只好带着我去公司办理失主归还。",
  },
  回答: {
    正常: "问题「为什么周一来得这么快」→因为周末把最后两小时都花在舍不得结束上，周一只好提前进场催它散会。",
    差: "问题「为什么周一来得这么快」→因为周一怕迟到，周日晚上就开始往前跑，顺便撞掉了你的两个小时。",
    极差: "问题「为什么周一来得这么快」→因为周一把日历折成了滑梯，星期天刚松手，它就抱着闹钟滑到了床头。",
  },
};

/** Permanent plagiarism baselines for all examples shown to the model. */
export const EXEMPLAR_SENTENCES = [
  ...STATE_EXEMPLARS,
  ...Object.values(MODE_MOOD_EXAMPLES).flatMap((examples) =>
    Object.values(examples).map((example) => example.split("→")[1]),
  ),
];

export const MENTAL_STATE_PROMPTS: Record<string, string> = {
  正常: `当前状态【正常】：事实完全清楚，只允许一个轻微错误的解释。语气冷静，前半句像正常表达，最后一小段才露出歪理。最多一个逗号，不用疯狂意象。风格参考但不可复用：${STATE_EXEMPLARS[0]}`,
  差: `当前状态【差】：事实仍然清楚，用一个明显错误的因果把它解释歪。全句只跳一次，语气认真，结尾落在具体动作上。风格参考但不可复用：${STATE_EXEMPLARS[1]}`,
  极差: `当前状态【极差】：允许一个事物或情绪突然有主见，再接一次荒谬动作；但人物、地点和事件必须沿着同一场景推进，不能换频道，不能堆名词。风格参考但不可复用：${STATE_EXEMPLARS[2]}`,
};

/** Long-form state prompts deliberately contain detailed pacing and examples.
 * They are counterproductive for a 4–8 character result, so short mode keeps
 * the state distinction while removing every instruction that needs a setup. */
export const COMPACT_MENTAL_STATE_PROMPTS: Record<string, string> = {
  正常: "当前状态【正常】：事实不变，只加一个轻微歪理。",
  差: "当前状态【差】：事实不变，用一个错误因果收尾。",
  极差: "当前状态【极差】：事实不变，让其中一个东西突然有主见。",
};

export const GENERATION_LENGTH_PROMPTS: Record<GenerationLength, string> = {
  精辟: "生成长度【精辟】：只写4到8个汉字。用一个完整的短句或判断直接落下荒谬点，不铺垫、不用逗号、不解释；宁可删到更短，也绝不能超过8个汉字。示范（不可复用）：「括号文学」→「括号太重。」",
  中等: "生成长度【中等】：只写12到24个汉字。保留一个具体细节和一次荒谬转折，句子紧凑，不展开第二层解释。",
  正常: "生成长度【正常】：只写25到48个汉字。优先控制在30到40个汉字，一次铺垫、一次转折、立即收尾。",
};

export const MECHANISM_HINTS: Record<string, string> = {
  错误因果: "本次优先机制：错误因果——保留事实，只把原本无关的两件事认真说成因果。",
  字面误解: "本次优先机制：字面误解——挑输入中的一个普通词按物理动作理解，但不改变事件本身。",
  主客倒置: "本次优先机制：主客倒置——让场景里的物品反过来安排人，只交换主动权，不增加新场景。",
  目的倒置: "本次优先机制：目的倒置——人物照常完成原动作，却给它安上一个完全错误但具体的目的。",
  情绪实体化: "本次优先机制：情绪实体化——让输入里已有的情绪做一个具体动作，不引入第二个陌生意象。",
  细节篡位: "本次优先机制：细节篡位——让输入里最小的真实细节突然成为整件事的负责人。",
  过度认真: "本次优先机制：过度认真——把一个日常小动作执行得过分认真，但不用公文、规定或精确数字。",
  时间借口: "本次优先机制：时间借口——让输入里的时间亲自为事件找借口，只跳跃一次。",
};

/** Per-tier mechanism whitelist — a random draw from the full pool could
 * contradict the tier's voice. */
export const TIER_MECHANISMS: Record<string, string[]> = {
  正常: ["错误因果", "目的倒置", "细节篡位", "过度认真"],
  差: ["错误因果", "字面误解", "主客倒置", "目的倒置", "情绪实体化"],
  极差: ["情绪实体化", "主客倒置", "时间借口", "细节篡位", "字面误解"],
};

function strictSuffix(generationLength: GenerationLength): string {
  const { min, max } = GENERATION_LENGTH_LIMITS[generationLength];
  return `严格执行：只输出一句${min}到${max}个汉字的中文，不换行、不解释、不加引号和任何前缀，写完立即停止。`;
}

export interface MechanismDraw {
  /** Mechanism names for the three parallel candidates (always disjoint). */
  candidates: [string[], string[], string[]];
  /** Single mechanism reserved for the strict retry (unused by A/B if possible). */
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

export function buildSystemPrompt(
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
  ];
  if (strict) parts.push(strictSuffix(generationLength));
  return parts.filter(Boolean).join("\n\n");
}
