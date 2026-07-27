import type { GenerationLength, GenerationMode } from "./validation";

function answerSubject(topic: string): string {
  const subject = topic
    .replace(/^(为什么|为何|怎么|怎样|如何|请问|能不能|可不可以|是不是|是否)/, "")
    .replace(/[？?！!。]+$/, "")
    .trim();
  return subject || "这件事";
}

function sentenceFragment(value: string, maxLength: number): string {
  return Array.from(value.replace(/[，。！？、；：,.!?;:]+$/u, "").trim())
    .slice(0, maxLength)
    .join("");
}

export function fallbackForLength(
  topic: string,
  mood: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
): string {
  if (generationLength === "精辟") {
    const core = Array.from(mode === "翻译" ? topic : answerSubject(topic))
      .slice(0, mode === "翻译" ? 4 : 2)
      .join("");
    const endings: Record<GenerationMode, Record<string, string>> = {
      翻译: {
        正常: "稍微排队。",
        差: "决定请假。",
        极差: "开始罢工。",
      },
      回答: {
        正常: "办了加急。",
        差: "正在请假。",
        极差: "拒绝答题。",
      },
    };
    return `${core}${endings[mode][mood] ?? endings[mode]["正常"]}`;
  }
  if (generationLength === "中等") {
    const core = Array.from(mode === "翻译" ? topic : answerSubject(topic))
      .slice(0, mode === "翻译" ? 12 : 6)
      .join("");
    return mode === "翻译"
      ? `原话里的${core}正在排队解释自己。`
      : `${core}是因为时间给它办了加急。`;
  }
  if (mode === "翻译") {
    const core = sentenceFragment(topic, 18);
    const endings: Record<string, string> = {
      正常: "，只是这句话把逻辑落在家里，事情本身还是照常发生了。",
      差: "，因为理由先跑去躲雨，事情只能自己把结局说完。",
      极差: "，结果逻辑忘了带伞，事实只好淋着雨把自己送到终点。",
    };
    return `${core}${endings[mood] ?? endings["正常"]}`;
  }

  return `${sentenceFragment(answerSubject(topic), 16)}，因为日历怕它迟到，昨晚就偷偷把出发时间改早了整整一天。`;
}
