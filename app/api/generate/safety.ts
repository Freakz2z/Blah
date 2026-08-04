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

export function isUnsafeGeneratedText(text: string): boolean {
  const normalized = text.trim();
  return normalized.length > 0 && UNSAFE_OUTPUT_PATTERNS.some((pattern) => pattern.test(normalized));
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
