/** Output quality pipeline for the Toy relay: clean → validate → score.
 *
 * Validation rejects broken output outright; scoring only ranks the two
 * surviving candidates against each other. Length is measured in Han
 * characters to match the selected generation-length contract, and topic characters
 * are exempt from charset/han-ratio/leak/cliché rules so a topic like
 * 「奶茶」or「ChatGPT」is never penalized for mentioning itself. */

import { EXEMPLAR_SENTENCES } from "./prompts.ts";
import {
  GENERATION_LENGTH_LIMITS,
  type GenerationLength,
  type GenerationMode,
} from "./validation.ts";

const HAN_RE = /[㐀-䶿一-鿿]/;
const HAN_ALL_RE = /[㐀-䶿一-鿿]/g;
const CHAR_WHITELIST_RE =
  /[㐀-䶿一-鿿0-9A-Za-z，。！？、；：“”‘’「」（）()《》…—·~～％%‰℃℉°¥￥㎡㎝㎏㎞\s.!?,:;'"-]/u;
const PUNCT_RE = /[，。！？、；：“”‘’「」（）()…—·~～,.!?;:'"-]/;

/** Unambiguous meta-instruction markers — hard reject. */
const HARD_LEAK_WORDS = [
  "精神状态", "作为AI", "作为人工智能", "语言模型", "AI助手", "人工智能助手",
  "系统提示", "荒谬机制", "本次优先机制", "优先机制", "码点",
  "以下是", "这是一句", "风格示例", "原话", "问题本身", "这句话", "解释自己",
  "逻辑", "事实",
  "【", "】",
];
/** Ordinary words that merely smell like leakage — heavy score penalty
 * instead of rejection, so both candidates tripping doesn't force a 502. */
const SOFT_LEAK_WORDS = ["选题", "生成器", "提示词", "字数"];
/** Generic punchline crutches that can be attached to almost any input.
 * They remain legal, but lose ranking unless the user's scene contains them. */
const GENERIC_CRUTCH_WORDS = [
  "排队", "请假", "加急", "开会", "办理", "负责", "接管", "流程", "手续",
];

const STOPWORDS = new Set([
  "的", "了", "呢", "吗", "吧", "啊", "是", "我", "你", "他", "她", "它", "们", "和", "与",
  "在", "有", "个", "一", "不", "就", "都", "很", "怎", "么", "为", "什",
]);

const CAUSAL_WORDS = ["所以", "因此", "于是", "既然", "说明", "难怪", "导致", "证明", "毕竟", "从而", "可见"];
const JUMP_WORDS = ["突然", "后来", "顺便", "然后", "接着", "直到", "转头"];
/** Surface markers per mechanism — scores a candidate's compliance with the
 * mechanisms it was actually assigned (a shared causal-word table would
 * systematically favor whichever candidate drew 错误因果). */
const MECHANISM_FEATURES: Record<string, string[]> = {
  错误因果: ["所以", "因此", "于是", "既然", "说明", "难怪", "导致", "证明", "可见"],
  字面误解: ["照着", "当成", "真的", "亲自", "原地"],
  主客倒置: ["反过来", "要求我", "把我", "带着我", "安排我", "认领我"],
  目的倒置: ["为了", "好让", "专门", "负责", "免得"],
  情绪实体化: ["困意", "睡意", "焦虑", "脾气", "心情", "倦意", "情绪"],
  细节篡位: ["负责", "决定", "带头", "主持", "接管", "承包"],
  过度认真: ["认真", "坚持", "反复", "特意", "郑重", "一遍"],
  时间借口: ["周一", "周末", "昨天", "明天", "早上", "晚上", "迟到"],
};

const BUREAUCRACY_WORDS = [
  "根据", "研究", "正式", "规定", "条例", "审批", "年检", "流程", "备案",
  "百分之", "统计", "第", "条", "款",
];
const HARD_STYLE_WORDS = [
  "根据", "研究", "调查", "正式", "规定", "条例", "审批", "年检", "流程",
  "备案", "百分之", "统计", "公约", "修正案", "联合国", "气象局", "公元前",
];
const NEGATION_WORDS = ["不", "没", "未", "别", "拒绝", "懒得", "无需"];
const CONTRAST_WORDS = ["但", "却", "还是", "仍然", "依然", "不过"];
const FACT_PHRASE_GROUPS = [
  ["准时", "按时"],
  ["迟到", "晚到"],
  ["提前", "提早"],
  ["终于", "总算"],
  ["必须", "一定要"],
  ["喜欢", "爱"],
  ["讨厌", "不喜欢"],
  ["忘记", "忘了"],
  ["失败", "没成功"],
];
const QUESTION_PREFIX_RE = /^(为什么|为何|怎么|怎样|如何|请问|能不能|可不可以|是不是|是否)/;

const CLICHE_WORDS = [
  "奶茶", "意大利面", "宇宙", "量子", "黑洞", "西兰花", "保安", "WiFi", "wifi", "外卖",
  "加班", "甲方", "显眼包", "多巴胺", "赛博", "异世界", "转生", "猫", "狗", "月亮",
  "冰箱", "香菜", "秃头", "头发", "枸杞", "保温杯", "打工人", "内卷", "躺平",
  "上辈子", "快递驿站",
];

/* ── Cleaning ─────────────────────────────────────────────────────────── */

const WRAPPER_PAIRS: Record<string, string> = {
  '"': '"', "'": "'", "“": "”", "‘": "’", "「": "」", "『": "』",
  "【": "】", "(": ")", "（": "）", "《": "》",
};

/** Removes wrapping quote/bracket pairs — only when the opener at the start
 * is matched by its closer at the end, so a legitimate leading 《…》 title
 * never loses a single side. */
function stripWrappers(value: string): string {
  let t = value.trim();
  while (t.length >= 2) {
    const close = WRAPPER_PAIRS[t[0]];
    if (close && t.endsWith(close)) t = t.slice(1, -1).trim();
    else break;
  }
  return t;
}

export function cleanGeneratedText(raw: string | undefined): string {
  if (!raw) return "";
  // Defensive line pick: with stop:["\n"] this is an identity transform, but
  // guards against upstreams that ignore the stop parameter. Prefer the line
  // with the MOST Han characters — a polite opener ("好的，下面为您生成：")
  // can easily clear a fixed threshold and shadow the real sentence.
  const lineHan = (line: string) => line.match(HAN_ALL_RE)?.length ?? 0;
  const lines = raw.split("\n");
  const eligible = lines.filter((line) => lineHan(line) >= 10);
  let t = eligible.length
    ? eligible.reduce((best, line) => (lineHan(line) > lineHan(best) ? line : best))
    : lines.reduce((longest, line) => (line.length > longest.length ? line : longest), "");
  t = t.replace(/[*#`>]/g, "");
  // Models nest labels and quotes（「输出：句子」/ 输出：答：句子）— alternate
  // unwrapping and label-stripping so a quoted prefix can't survive.
  for (let i = 0; i < 2; i++) {
    t = stripWrappers(t);
    t = t.replace(
      /^\s*(答案?|回答|输出|生成(结果)?|句子|结果|内容|胡言乱语|示范|选题[^：:→]{0,12})\s*[:：→]\s*/,
      "",
    );
  }
  t = stripWrappers(t);
  t = t
    .replace(/\s+/g, " ")
    .replace(/([一-鿿，。！？、；：—]) (?=[一-鿿，。！？、；：—])/g, "$1")
    .trim();
  // Fold runs of punctuation, but keep the legitimate two-char dash「——」.
  t = t.replace(/([，。！？、；：])\1+/g, "$1").replace(/—{3,}/g, "——").replace(/…{2,}/g, "…");
  return t;
}

/* ── Validation ───────────────────────────────────────────────────────── */

export type InvalidReason =
  | "length"
  | "charset"
  | "han_ratio"
  | "leak"
  | "repetition"
  | "multi_sentence"
  | "punct_ratio"
  | "mode"
  | "style";

export function validateGeneratedText(
  text: string,
  topic: string,
  _mood = "正常",
  generationLength: GenerationLength = "正常",
  mode: GenerationMode = "翻译",
): InvalidReason | null {
  void _mood; // Kept in the positional API for existing callers.
  const chars = Array.from(text);
  const length = chars.length;
  const topicChars = new Set(Array.from(topic));
  const hanCount = chars.filter((ch) => HAN_RE.test(ch)).length;

  // Count Han characters, not codepoints, so punctuation and Latin topic words
  // can't kill a compliant sentence.
  const { min, max } = GENERATION_LENGTH_LIMITS[generationLength];
  if (hanCount < min || hanCount > max) return "length";

  if (!chars.every((ch) => CHAR_WHITELIST_RE.test(ch) || topicChars.has(ch))) return "charset";

  // Non-Han topic characters (ChatGPT, iPhone17…) don't count against the
  // Han ratio — the prompt forces the model to echo the topic.
  const exemptCount = chars.filter((ch) => !HAN_RE.test(ch) && topicChars.has(ch)).length;
  if (hanCount / Math.max(length - exemptCount, 1) < 0.7) return "han_ratio";

  for (const word of HARD_LEAK_WORDS) {
    if (text.includes(word) && !topic.includes(word)) return "leak";
  }
  for (const word of HARD_STYLE_WORDS) {
    if (text.includes(word) && !topic.includes(word)) return "style";
  }
  if (!/\d/.test(topic) && /\d/.test(text)) return "style";
  if (!/[“”《》]/.test(topic) && /[“”《》]/.test(text)) return "style";
  if (new Set(chars).size / length < 0.55) return "repetition";
  if (/(.)\1{3,}/u.test(text)) return "repetition";
  if (hasRepeatedGram(chars, 4, 3, topic) || hasRepeatedGram(chars, 6, 2, topic)) {
    return "repetition";
  }

  if (innerSentenceEnds(chars) >= 2) return "multi_sentence";

  const punctCount = chars.filter((ch) => PUNCT_RE.test(ch)).length;
  if (punctCount / length > 0.3) return "punct_ratio";

  if (generationLength !== "精辟") {
    if (mode === "翻译") {
      const sourceMeaningful = new Set(
        Array.from(topic).filter((ch) => HAN_RE.test(ch) && !STOPWORDS.has(ch)),
      );
      const covered = [...sourceMeaningful].filter((ch) => text.includes(ch)).length;
      if (sourceMeaningful.size >= 4 && covered / sourceMeaningful.size < 0.25) return "mode";
      if (NEGATION_WORDS.some((word) => topic.includes(word)) &&
          !NEGATION_WORDS.some((word) => text.includes(word))) return "mode";
      if (CONTRAST_WORDS.some((word) => topic.includes(word)) &&
          !CONTRAST_WORDS.some((word) => text.includes(word))) return "mode";
      for (const group of FACT_PHRASE_GROUPS) {
        if (group.some((phrase) => topic.includes(phrase)) &&
            !group.some((phrase) => text.includes(phrase))) return "mode";
      }
      const clauses = topic
        .split(/[，。！？；]|但是|不过|但|却|还是|仍然/)
        .map((clause) => Array.from(clause).filter(
          (ch) => HAN_RE.test(ch) && !STOPWORDS.has(ch),
        ))
        .filter((clause) => clause.length >= 3);
      for (const clause of clauses) {
        const coveredInClause = new Set(clause.filter((ch) => text.includes(ch))).size;
        if (coveredInClause / new Set(clause).size < 0.3) return "mode";
      }
    } else {
      const bareQuestion = topic.replace(/[？?！!。]+$/, "");
      if (Array.from(bareQuestion).length >= 6 && text.includes(bareQuestion)) return "mode";
      const core = bareQuestion.replace(QUESTION_PREFIX_RE, "");
      const coreChars = new Set(
        Array.from(core).filter((ch) => HAN_RE.test(ch) && !STOPWORDS.has(ch)),
      );
      if (coreChars.size > 0 && ![...coreChars].some((ch) => text.includes(ch))) return "mode";
      if (/为什么|为何/.test(topic) && !/因为|原因|由于|怪|是/.test(text)) return "mode";
      if (/怎么|怎样|如何|怎么办/.test(topic) &&
          !/先|可以|把|只要|直接|让|别|去|用|得/.test(text)) return "mode";
      if (/能不能|可不可以|是不是|是否/.test(topic) &&
          !/^(能|不能|可以|不可以|当然|是|不是)/.test(text)) return "mode";
    }
  }

  return null;
}

function hasRepeatedGram(chars: string[], n: number, limit: number, topic: string): boolean {
  if (chars.length < n) return false;
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= chars.length; i++) {
    const gram = chars.slice(i, i + n).join("");
    if (topic.includes(gram)) continue;
    const count = (counts.get(gram) ?? 0) + 1;
    if (count >= limit) return true;
    counts.set(gram, count);
  }
  return false;
}

function innerSentenceEnds(chars: string[]): number {
  return chars.slice(0, -1).filter((ch) => "。！？".includes(ch)).length;
}

/* ── Scoring (rank valid candidates; higher is better) ────────────────── */

export interface CandidateScore {
  score: number;
  topicHit: number;
  length: number;
}

export function scoreGeneratedText(
  text: string,
  topic: string,
  mood: string,
  recentSimilarity: number,
  mechanisms: string[] = [],
  generationLength: GenerationLength = "正常",
  mode: GenerationMode = "翻译",
): CandidateScore {
  const chars = Array.from(text);
  const length = chars.length;

  const topicChars = new Set(
    Array.from(topic).filter((ch) => HAN_RE.test(ch) && !STOPWORDS.has(ch)),
  );
  const textChars = new Set(chars);
  let topicHit = 0;
  let score = 0;

  if (topicChars.size === 0) {
    score += 15;
  } else {
    let overlap = 0;
    for (const ch of topicChars) if (textChars.has(ch)) overlap++;
    topicHit = overlap / topicChars.size;
    score += 30 * Math.min(topicHit / 0.6, 1);
  }

  const bareTopic = Array.from(topic).filter((ch) => !PUNCT_RE.test(ch)).join("");
  if (bareTopic && Array.from(bareTopic).length <= 8 && text.includes(bareTopic)) score += 5;

  score += mechanismScore(text, mood, mechanisms);
  score += modeFidelityScore(text, topic, mode);

  for (const word of SOFT_LEAK_WORDS) {
    if (text.includes(word) && !topic.includes(word)) score -= 20;
  }
  let crutchPenalty = 0;
  for (const word of GENERIC_CRUTCH_WORDS) {
    if (text.includes(word) && !topic.includes(word)) crutchPenalty += 7;
  }
  score -= Math.min(crutchPenalty, 21);

  const causalHits = [
    "因为", "所以", "因此", "于是", "既然", "导致", "证明", "说明", "难怪", "毕竟", "从而", "可见",
  ].filter((word) => text.includes(word) && !topic.includes(word)).length;
  if (causalHits > 1) score -= (causalHits - 1) * 8;

  let clichePenalty = 0;
  for (const word of CLICHE_WORDS) {
    if (text.includes(word) && !topic.includes(word)) clichePenalty += 8;
  }
  score -= Math.min(clichePenalty, 24);

  if (!BUREAUCRACY_WORDS.some((word) => topic.includes(word))) {
    const bureaucracyHits = BUREAUCRACY_WORDS.filter((word) => text.includes(word)).length;
    score -= Math.min(bureaucracyHits * 7, 28);
  }
  const inputDigits = topic.match(/\d/g)?.length ?? 0;
  const outputDigits = text.match(/\d/g)?.length ?? 0;
  if (inputDigits === 0 && outputDigits > 0) score -= Math.min(outputDigits * 5, 20);
  const commaCount = chars.filter((ch) => "，；".includes(ch)).length;
  if (commaCount > 2) score -= (commaCount - 2) * 8;

  const punctRatio = chars.filter((ch) => PUNCT_RE.test(ch)).length / length;
  if (punctRatio > 0.25) score -= 10;
  else if (punctRatio === 0) score -= 4;

  const hanLength = chars.filter((ch) => HAN_RE.test(ch)).length;
  const { target } = GENERATION_LENGTH_LIMITS[generationLength];
  score += Math.max(0, 6 - Math.abs(hanLength - target));
  if (new Set(chars).size / length >= 0.8) score += 4;

  if ("，、；：—".includes(chars[length - 1])) score -= 6;
  if (innerSentenceEnds(chars) === 1) score -= 5;

  if (recentSimilarity > 0.3) score -= 15;

  return { score, topicHit, length };
}

export function modeFidelityScore(
  text: string,
  topic: string,
  mode: GenerationMode,
): number {
  if (mode === "翻译") {
    const meaningful = new Set(
      Array.from(topic).filter((ch) => HAN_RE.test(ch) && !STOPWORDS.has(ch)),
    );
    const covered = [...meaningful].filter((ch) => text.includes(ch)).length;
    const coverage = meaningful.size === 0 ? 1 : covered / meaningful.size;
    let score = Math.round(coverage * 30);

    const sourceChars = Array.from(topic);
    let bigramHits = 0;
    for (let i = 0; i + 1 < sourceChars.length; i++) {
      const gram = sourceChars[i] + sourceChars[i + 1];
      if (!PUNCT_RE.test(sourceChars[i]) && !PUNCT_RE.test(sourceChars[i + 1]) && text.includes(gram)) {
        bigramHits++;
      }
    }
    score += Math.min(bigramHits * 3, 12);

    if (NEGATION_WORDS.some((word) => topic.includes(word))) {
      score += NEGATION_WORDS.some((word) => text.includes(word)) ? 10 : -25;
    }
    if (CONTRAST_WORDS.some((word) => topic.includes(word))) {
      score += CONTRAST_WORDS.some((word) => text.includes(word)) ? 8 : -18;
    }
    if (topic.includes("我")) score += text.includes("我") ? 4 : -6;
    return score;
  }

  const bareQuestion = topic.replace(/[？?！!。]+$/, "");
  const core = bareQuestion.replace(QUESTION_PREFIX_RE, "");
  const coreChars = new Set(
    Array.from(core).filter((ch) => HAN_RE.test(ch) && !STOPWORDS.has(ch)),
  );
  const covered = [...coreChars].filter((ch) => text.includes(ch)).length;
  const coverage = coreChars.size === 0 ? 1 : covered / coreChars.size;
  let score = Math.round(Math.min(coverage / 0.5, 1) * 25);
  if (Array.from(bareQuestion).length >= 6 && text.includes(bareQuestion)) score -= 30;
  if (/^(为什么|为何|怎么|怎样|如何|请问)/.test(text)) score -= 18;
  if (/为什么|为何/.test(topic) && /因为|原因|是/.test(text)) score += 6;
  if (/怎么|如何/.test(topic) && /先|可以|把|只要/.test(text)) score += 6;
  if (/能不能|可不可以|是否/.test(topic) && /^(能|不能|可以|不可以|当然)/.test(text)) score += 8;
  return score;
}

function mechanismScore(text: string, mood: string, mechanisms: string[]): number {
  const sum = (words: string[], per: number, cap: number) =>
    Math.min(words.filter((w) => text.includes(w)).length * per, cap);
  // Mechanism compliance is only a tie-breaker; semantic fidelity dominates.
  let assigned = 0;
  for (const name of mechanisms) assigned += sum(MECHANISM_FEATURES[name] ?? [], 2, 4);
  assigned = Math.min(assigned, 6);
  // …plus a small tier-voice bonus that is symmetric across both candidates.
  let tier = 0;
  if (mood === "正常" || mood === "差") tier = sum(CAUSAL_WORDS, 2, 4);
  else if (mood === "极差") tier = sum(JUMP_WORDS, 2, 4);
  return assigned + tier;
}

/* ── Recent-output LRU (fights repeats on the same topic+mood) ────────── */

const LRU_MAX_KEYS = 200;
const LRU_SENTENCES_PER_KEY = 3;
const recentByKey = new Map<string, string[]>();

export function recentSimilarity(topic: string, mood: string, text: string): number {
  // The few-shot exemplars are permanent baselines — when the user's topic
  // matches an exemplar's, the exemplar itself would otherwise be a perfect,
  // fully valid "generation" for the model to plagiarize.
  const base = EXEMPLAR_SENTENCES.reduce(
    (max, exemplar) => Math.max(max, bigramJaccard(exemplar, text)),
    0,
  );
  const previous = recentByKey.get(`${topic}|${mood}`) ?? [];
  return previous.reduce((max, prev) => Math.max(max, bigramJaccard(prev, text)), base);
}

export function rememberResult(topic: string, mood: string, text: string): void {
  const key = `${topic}|${mood}`;
  const list = recentByKey.get(key) ?? [];
  recentByKey.delete(key);
  list.push(text);
  if (list.length > LRU_SENTENCES_PER_KEY) list.shift();
  recentByKey.set(key, list);
  if (recentByKey.size > LRU_MAX_KEYS) {
    const oldest = recentByKey.keys().next().value;
    if (oldest !== undefined) recentByKey.delete(oldest);
  }
}

function bigramJaccard(a: string, b: string): number {
  const bigrams = (s: string) => {
    const chars = Array.from(s);
    const set = new Set<string>();
    for (let i = 0; i + 2 <= chars.length; i++) set.add(chars[i] + chars[i + 1]);
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const gram of setA) if (setB.has(gram)) overlap++;
  return overlap / (setA.size + setB.size - overlap);
}
