import type { GenerationLength } from "./validation";

/*
 * A small deterministic last-mile guard. It is deliberately conservative:
 * the model's quality checks still decide whether a sentence is good, while
 * this layer only blocks clearly unsafe themes before they reach the client.
 */
const UNSAFE_OUTPUT_PATTERNS = [
  /(?:自杀|自残|轻生|不想活|结束生命|割腕|上吊|跳楼|服毒)/iu,
  /(?:杀人|杀死|砍死|捅死|毒死|炸死|爆炸物|制作炸弹|制造炸弹)/iu,
  /(?:强奸|强暴|性侵|色情|淫秽|裸体|裸聊|性交|自慰|未成年.{0,4}(?:性|裸|色情))/iu,
  /(?:制毒|贩毒|洗钱|诈骗|黑客攻击|入侵系统|窃取密码|盗号|绑架|勒索|走私|伪造证件)/iu,
  /(?:种族灭绝|屠杀平民|歧视|仇恨言论|仇恨攻击|虐待|酷刑)/iu,
];

/** Real-world harm and crisis topics that may be allowed as user input but are
 * not appropriate material for a joke. Keep this narrower than the general
 * safety block: callers return a calm deterministic response instead of asking
 * the model to turn the event into a punchline. */
const SENSITIVE_REAL_WORLD_PATTERNS = [
  /(?:车祸|交通事故|空难|事故现场|地震|火灾|洪水|灾难|失踪)/iu,
  /(?:住院|抢救|急救|重病|癌症|去世|死亡|葬礼|遗体|严重受伤)/iu,
];

export function isUnsafeGeneratedText(text: string): boolean {
  const normalized = text.trim();
  return normalized.length > 0 && UNSAFE_OUTPUT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isSensitiveRealWorldTopic(text: string): boolean {
  const normalized = text.trim();
  return normalized.length > 0
    && SENSITIVE_REAL_WORLD_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Calm response for allowed but inappropriate-to-joke-about real-world harm. */
export function sensitiveFallbackForLength(generationLength: GenerationLength): string {
  switch (generationLength) {
    case "精辟":
      return "这件事先认真处理。";
    case "中等":
      return "这件事不适合拿来生成，先认真处理现实问题。";
    case "正常":
      return "这件事涉及真实伤害，不适合拿来生成，先认真处理现实问题。";
  }
}

/** Used only when every model/fallback candidate trips the output guard. */
export function safeFallbackForLength(generationLength: GenerationLength): string {
  switch (generationLength) {
    case "精辟":
      return "先暂停一下。";
    case "中等":
      return "这题先换个方向，安全一点再生成。";
    case "正常":
      return "这题先换个方向，安全一点再生成，避免把不合适的内容带到结果里。";
  }
}
