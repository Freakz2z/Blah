import type { GenerationLength, GenerationMode } from "./validation";

function answerSubject(topic: string): string {
  const subject = topic
    .replace(/^(为什么|为何|怎么|怎样|如何|请问|能不能|可不可以|是不是|是否)/, "")
    .replace(/[？?！!。]+$/, "")
    .trim();
  return subject || "这件事";
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
  return mode === "翻译"
    ? `原话里的${topic}本来准备照常出现，走到句号门口却被通知逻辑今天轮休。`
    : `${answerSubject(topic)}是因为时间给它办了加急，周末还在窗口排队补材料。`;
}
