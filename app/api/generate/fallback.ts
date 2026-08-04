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

function answerKind(topic: string): "why" | "how" | "whether" | "what" | "other" {
  if (/为什么|为何/.test(topic)) return "why";
  if (/怎么|怎样|如何|怎么办/.test(topic)) return "how";
  if (/能不能|可不可以|是不是|是否/.test(topic)) return "whether";
  if (/什么|哪[个里种]?/.test(topic)) return "what";
  return "other";
}

function conciseTranslation(topic: string): string {
  if (/上班|工作|工位/.test(topic)) return "工位替我上班。";
  if (/困|睡|起床/.test(topic)) return "困意先起床。";
  if (/下雨|雨伞|带伞|忘.*伞/.test(topic)) return "雨伞正在躲雨。";
  if (/减肥|体重/.test(topic)) return "体重假装没听见。";
  if (/迟到|赶不上/.test(topic)) return "时间先迟到了。";
  return "理由抢先到了。";
}

function conciseAnswer(topic: string): string {
  const answers = {
    why: "因为时间抄近路。",
    how: "先让事情示范。",
    whether: "可以，后果值班。",
    what: "先选菜单指的。",
    other: "日历已经答应。",
  };
  return answers[answerKind(topic)];
}

export function fallbackForLength(
  topic: string,
  mood: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
): string {
  if (generationLength === "精辟") {
    return mode === "翻译" ? conciseTranslation(topic) : conciseAnswer(topic);
  }
  if (generationLength === "中等") {
    if (mode === "翻译") {
      const core = sentenceFragment(topic, 12);
      const endings: Record<string, string> = {
        正常: "，只是理由比事情晚到一步。",
        差: "，因为原因临时改了主意。",
        极差: "，结果事情反过来安排了我。",
      };
      return `${core}${endings[mood] ?? endings["正常"]}`;
    }
    const subject = sentenceFragment(answerSubject(topic), 10);
    const answers = {
      why: `因为${subject}让时间偷偷走了近路。`,
      how: `先让${subject}自己示范一遍。`,
      whether: `可以，${subject}先替你承担后果。`,
      what: `今天就选菜单最先指到的那样。`,
      other: `${subject}，日历昨晚已经答应了。`,
    };
    return answers[answerKind(topic)];
  }
  if (mode === "翻译") {
    const core = sentenceFragment(topic, 18);
    const endings: Record<string, string> = {
      正常: "，只是理由今天比事情晚到半步，结局只好先按原样发生。",
      差: "，因为原因临时改了主意，事情只好认真执行错误答案。",
      极差: "，结果事情突然有了自己的安排，还顺手把我写进了结局。",
    };
    return `${core}${endings[mood] ?? endings["正常"]}`;
  }

  const subject = sentenceFragment(answerSubject(topic), 14);
  const answers = {
    why: `因为${subject}把原因留在昨天，结论只好提前赶到今天。`,
    how: `先让${subject}自己做一遍，不会的部分再让现场临时发挥。`,
    whether: `可以，${subject}负责发生，后果负责假装从来没有见过你。`,
    what: `今天就吃最先想到的那样，菜单已经替你把剩下的犹豫划掉了。`,
    other: `${subject}，因为日历昨晚替它答应了，今天只好过来兑现。`,
  };
  return answers[answerKind(topic)];
}
