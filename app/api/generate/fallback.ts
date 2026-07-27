import type { GenerationLength, GenerationMode } from "./validation";

function answerSubject(topic: string): string {
  const subject = topic
    .replace(/^(为什么|为何|怎么|怎样|如何|请问|能不能|可不可以|是不是|是否)/, "")
    .replace(/[？?！!。]+$/, "")
    .trim();
  return subject || "这件事";
}

function sentenceFragment(value: string, maxLength: number): string {
  return Array.from(
    value
      .replace(/[。！？.!?]+/gu, "，")
      .replace(/[，、；：,;:]+$/u, "")
      .replace(/[，,]{2,}/gu, "，")
      .trim(),
  )
    .slice(0, maxLength)
    .join("");
}

function answerKind(topic: string): "why" | "how" | "whether" | "other" {
  if (/为什么|为何/.test(topic)) return "why";
  if (/怎么|怎样|如何|怎么办/.test(topic)) return "how";
  if (/能不能|可不可以|是不是|是否/.test(topic)) return "whether";
  return "other";
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
    if (mode === "翻译") {
      const core = sentenceFragment(topic, 12);
      const endings: Record<string, string> = {
        正常: "，只是理由还没睡醒。",
        差: "，因为借口临时失踪了。",
        极差: "，结果借口反过来指挥我。",
      };
      return `${core}${endings[mood] ?? endings["正常"]}`;
    }
    const subject = sentenceFragment(answerSubject(topic), 10);
    const answers = {
      why: `${subject}，时间偷偷走了近路。`,
      how: `先让${subject}自己示范一遍。`,
      whether: `可以，${subject}先替你承担后果。`,
      other: `${subject}，日历昨晚已经答应了。`,
    };
    return answers[answerKind(topic)];
  }
  if (mode === "翻译") {
    const core = sentenceFragment(topic, 18);
    const endings: Record<string, string> = {
      正常: "，只是理由今天比事情晚到了半步，结局只好先照常发生。",
      差: "，因为借口先把正常原因藏进了口袋最深处。",
      极差: "，结果借口突然站起来，当场接管了整个现场。",
    };
    return `${core}${endings[mood] ?? endings["正常"]}`;
  }

  const subject = sentenceFragment(answerSubject(topic), 14);
  const answers = {
    why: `${subject}，是因为正常理由留在昨天，结论只好提前赶到今天。`,
    how: `先让${subject}自己做一遍，不会的部分再交给借口现场发挥。`,
    whether: `可以，${subject}负责发生，后果负责假装从来没有见过你。`,
    other: `${subject}，因为日历昨晚替它答应了，今天只好过来兑现。`,
  };
  return answers[answerKind(topic)];
}
