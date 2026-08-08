import type { GenerationLength, GenerationMode } from "./validation";

/*
 * Local safety-net generation. It runs when the model pipeline fails or times
 * out, so it must be a decent joke on its own — never "the input plus a canned
 * tail". Twists are drawn from per-mood pools by a deterministic hash of the
 * topic, so different inputs get different endings instead of one universal
 * tail, while the same input stays stable across regenerations.
 */

const QUESTION_PREFIX =
  /^(为什么|为何|怎么|怎样|如何|请问|能不能|可不可以|是不是|是否|要不要|能否|什么是|什么叫|何为)/;

function stripQuestionPrefix(value: string): string {
  return value.replace(QUESTION_PREFIX, "");
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
  if (/能不能|可不可以|是不是|是否|要不要/.test(topic)) return "whether";
  if (/什么|哪[个里种]?/.test(topic)) return "what";
  return "other";
}

/** Truncates an answer anchor without slicing a Latin word in half —
 * 「ChatGPT」must never become「Chat」. Length contracts are counted in Han
 * characters, so a Latin run may stay whole even past the char budget. */
function truncateAnchor(value: string, maxLength: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  const isLatin = (ch: string) => /[0-9A-Za-z]/.test(ch);
  let cut = maxLength;
  if (isLatin(chars[cut - 1])) {
    while (cut > 0 && isLatin(chars[cut - 1])) cut--;
    if (cut === 0) {
      while (cut < chars.length && isLatin(chars[cut])) cut++;
    }
  } else if (cut < chars.length && isLatin(chars[cut])) {
    while (cut < chars.length && isLatin(chars[cut])) cut++;
  }
  return chars.slice(0, cut).join("");
}

/** Short, grammatical subject the answer can be anchored to. Question words,
 * possessive/particle prefixes, and trailing clauses are stripped so a topic
 * like 「怎么才能早点睡」never turns into the broken 「先让才能早点睡自己
 * 示范一遍」, and 「明天要不要开会，我该去吗」keeps only its first clause. */
function answerAnchor(topic: string, kind: string, maxAnchor: number): string {
  // Cutting at a clause boundary beats cutting mid-word, and a trailing
  // 「，我该去吗」must never leak into the anchor.
  const cleaned = topic.replace(/[。！？.!?]+$/u, "").trim();
  const head = cleaned.split(/[，,、；;：:]/)[0].trim();

  if (kind === "other") {
    // Statement: echo the first clause as the anchor.
    return truncateAnchor(head || cleaned, maxAnchor) || "这件事";
  }

  let subject = stripQuestionPrefix(head);
  if (kind === "what") {
    // 「今天吃什么」「明天穿什么」— drop the question tail, keep the anchor.
    subject = subject
      .replace(
        /(吃什么|做什么|穿什么|买什么|看什么|玩什么|用什么|是什么|叫什么|有什么|哪里|什么)/,
        "",
      )
      .trim();
    return truncateAnchor(subject, maxAnchor) || "菜单";
  }
  // Embedded question words (not at the start) — 「明天要不要开会」keeps
  // 明天开会, 「ChatGPT为什么这么慢」keeps ChatGPT, 「我该怎么办」keeps 我.
  if (kind === "whether") subject = subject.replace(/要不要|能不能|可不可以|是不是|是否/, "").trim();
  else if (kind === "how") subject = subject.replace(/该怎么办|怎么办|怎么|怎样|如何/, "").trim();
  else if (kind === "why") subject = subject.replace(/为什么|为何/, "").trim();
  // 「怎么才能…」/「怎样才能…」 — drop the modal that follows the question word.
  subject = subject.replace(/^才能/, "").trim();
  subject = subject.replace(/^(我的|我们的|你的|他的|她的|他们的|你们的)/, "");
  // 一边…一边… — keep the second activity as the anchor.
  subject = subject.replace(/^一边.+?一边/, "");
  subject = subject.split(/的|得|太|很|这么|那么|总是|一直|就|都|还|才|在|有|是/)[0];
  return truncateAnchor(subject, maxAnchor) || "这件事";
}

function hanCount(text: string): number {
  return Array.from(text).filter((char) => /[㐀-䶿一-鿿]/u.test(char)).length;
}

function ensureMinimumHanLength(text: string, minimum: number, suffix: string): string {
  if (hanCount(text) >= minimum) return text;
  return `${text.replace(/[。！？.!?]+$/u, "")}，${suffix}`;
}

/** Deterministic pool pick — same topic+mood always picks the same twist, but
 * different topics spread across the pool instead of sharing one tail. */
function pick<T>(pool: readonly T[], key: string): T {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length];
}

/* ── 精辟 (4–8 hanzi) ─────────────────────────────────────────────────── */

/** 问候/致谢/道别等寒暄短句没有可歪的事实骨架，改写必须保持同一个寒暄动作
 * 本身，且满足各长度契约（正常档需要 25–48 个汉字）。 */
const FORMULA_TOPIC_RE =
  /^(你好|您好|哈喽|嗨|早上好|早安|下午好|晚上好|晚安|谢谢|感谢|再见|拜拜|抱歉|对不起)/;

const FORMULA_CATEGORY: Array<[RegExp, string]> = [
  [/谢谢|感谢/, "谢谢"],
  [/早上|早安/, "早上好"],
  [/晚安/, "晚安"],
  [/再见|拜拜/, "再见"],
  [/你好|您好|哈喽|嗨/, "你好"],
];

const FORMULA_REWRITES: Record<string, Record<GenerationLength, string>> = {
  你好: {
    精辟: "你好，问候先欠着。",
    中等: "你好，这份问候先存在我这，醒后再转交。",
    正常: "你好，问候我替你收下了，等嘴醒了再当面补上，这份心意先存在我这。",
  },
  谢谢: {
    精辟: "谢意先送达。",
    中等: "谢谢，心意先替你签收，快递晚点送到。",
    正常: "谢谢，谢意我先替你签收了，等快递不罢工再当面转达，心意先存在驿站。",
  },
  早上好: {
    精辟: "早晨先签到。",
    中等: "早上好，早晨替我打了卡，人还赖在被窝。",
    正常: "早上好，早晨先替我上班打卡，人还在梦里补觉，等醒了再补一声招呼。",
  },
  晚安: {
    精辟: "睡意先上岗。",
    中等: "晚安，睡意先替我值夜班，被窝负责守岗。",
    正常: "晚安，睡意先替我值整夜班，天亮了再换我回来，被子替我守着床。",
  },
  再见: {
    精辟: "告别先出发。",
    中等: "再见，告别先替我跑一趟，门先替我关上。",
    正常: "再见，告别先替我出了门，等下次见面再补道别，门把手替我带上了。",
  },
};

function formulaTranslation(topic: string, generationLength: GenerationLength): string {
  const matched = FORMULA_TOPIC_RE.exec(topic)?.[1] ?? "你好";
  const category = FORMULA_CATEGORY.find(([re]) => re.test(matched))?.[1] ?? "你好";
  return FORMULA_REWRITES[category][generationLength];
}

function conciseTranslation(topic: string): string {
  if (/上班|工作|工位/.test(topic)) return "工位替我上班。";
  if (/困|睡|起床/.test(topic)) return "困意先起床。";
  if (/下雨|雨伞|带伞|忘.*伞/.test(topic)) return "雨伞正在躲雨。";
  if (/减肥|体重/.test(topic)) return "体重假装没听见。";
  if (/迟到|赶不上/.test(topic)) return "时间先迟到了。";
  if (/吃|饿|夜宵|外卖/.test(topic)) return "筷子先上岗。";
  if (/猫/.test(topic)) return "猫先原谅我了。";
  if (/考试|学习|作业/.test(topic)) return "知识点先逃课。";
  if (/手机|电脑|充电/.test(topic)) return "电量先告急了。";
  return pick(["理由抢先到了。", "时间抄近路了。", "事情先发生了。", "借口先到岗了。"], topic);
}

function conciseAnswer(topic: string): string {
  const answers = {
    why: ["因为时间抄近路。", "因为结论先到站。"],
    how: ["先让事情示范。", "先让步骤自己动。"],
    whether: ["可以，后果值班。", "可以，先试再说。"],
    what: ["先选菜单指的。", "答案在菜单上。"],
    other: ["日历已经答应。", "事情自己会来。"],
  };
  return pick(answers[answerKind(topic)], topic);
}

/* ── 中等 (12–24 hanzi) twist pools ───────────────────────────────────── */

const MEDIUM_TRANSLATION_TWISTS: Record<string, readonly string[]> = {
  正常: [
    "只是理由晚到了一步。",
    "原因临时改了主意。",
    "结局决定先不发生了。",
    "时间决定原地等你。",
    "计划偷偷换了执行人。",
    "事情的顺序被打乱了。",
  ],
  差: [
    "因为原因临时改了主意。",
    "导致结局提前发生了。",
    "所以结果只好先发生了。",
    "可见理由比事情早到。",
  ],
  极差: [
    "结果事情反过来安排了我。",
    "连原因都开始有脾气了。",
    "结局自己站起来宣布了。",
    "事情开始有自己的安排。",
  ],
};

const MEDIUM_ANSWER_TEMPLATES: Record<string, string> = {
  why: "因为{subject}让时间偷偷走了近路。",
  how: "先让{subject}自己示范一遍。",
  whether: "可以，{subject}先替你承担后果。",
  what: "{subject}，先让菜单替你做主。",
  other: "{subject}，日历昨晚已经答应了。",
};

/* ── 正常 (25–48 hanzi) twist pools ───────────────────────────────────── */

const LONG_TRANSLATION_TWISTS: Record<string, readonly string[]> = {
  正常: [
    "只是理由今天比事情晚到半步，结局只好先按原样发生。",
    "因为原因临时改了主意，事情只好认真执行了错误的答案。",
    "时间偷偷把顺序调换了，事情还没反应过来就自己发生了。",
    "理由抢先到场替事情签了到，结局只好假装什么都没看见。",
    "计划在最后一秒改了剧本，事情只好硬着头皮重新演一遍。",
    "连原因都懒得解释了，事情干脆自己安排了一遍结局。",
  ],
  差: [
    "因为原因临时改了主意，事情只好认真执行了一个错误版本。",
    "于是结果比原计划提前到了，结局只好把错的地方当成对的。",
    "导致事情在最后一刻换了执行人，原定的结局只好延期发生。",
    "可见理由一直在误导时间，真正的顺序反而被落下了。",
  ],
  极差: [
    "结果事情突然有了自己的安排，还顺手把我写进了结局。",
    "连原因都开始有主见，主动替整件事重新排了一遍顺序。",
    "结局自己站起来宣布换角，原来的计划只好在旁边鼓掌。",
    "事情半夜改了主意，第二天一早就按新剧本把我安排了。",
  ],
};

const LONG_ANSWER_TEMPLATES: Record<string, string> = {
  why: "因为{subject}把原因留在昨天，结论只好提前赶到今天，剩下的事明天自己圆场。",
  how: "先让{subject}自己做一遍，不会的部分再让现场临时发挥，最后让结论自己认领。",
  whether: "可以，{subject}先替你扛着后果，结论不满意明天再改，体重假装没上秤。",
  what: "{subject}，先让菜单替你做主，剩下的犹豫明天统一收走。",
  other: "{subject}，因为日历昨晚替它答应了，今天只好过来兑现。",
};

function specificAnswerFallback(
  topic: string,
  generationLength: GenerationLength,
): string | null {
  if (/(?:手机|平板|电脑).*(?:没电|电量|充电)|(?:没电|电量|充电).*(?:手机|平板|电脑)/u.test(topic)) {
    switch (generationLength) {
      case "精辟":
        return "先给手机喂电。";
      case "中等":
        return "先给手机接上电，让充电器替它叫醒电量。";
      case "正常":
        return "先给手机接上电，让充电器替它叫醒电量，醒来后再继续装忙。";
    }
  }
  if (/(?:短视频|刷视频).*(?:停不下来|停止|戒掉)|(?:停止|戒掉).*(?:短视频|刷视频)/u.test(topic)) {
    switch (generationLength) {
      case "精辟":
        return "先把视频关掉。";
      case "中等":
        return "先把短视频关掉，让手指下班后找不到工位。";
      case "正常":
        return "先把短视频关掉，再把手机放远，让手指下班后找不到原来的工位。";
    }
  }
  return null;
}

function translationFallback(
  topic: string,
  mood: string,
  generationLength: GenerationLength,
): string {
  // 寒暄短句优先走专用改写，避免掉进通用的「话题骨架 + 尾巴」结构。
  if (FORMULA_TOPIC_RE.test(topic)) return formulaTranslation(topic, generationLength);

  if (generationLength === "精辟") return conciseTranslation(topic);

  // Rewrites, not echoes: the twist opens and the topic's core is woven in
  // mid-sentence — 翻译 results must not start with the input verbatim.
  if (generationLength === "中等") {
    const twist = pick(
      MEDIUM_TRANSLATION_TWISTS[mood] ?? MEDIUM_TRANSLATION_TWISTS["正常"],
      topic,
    ).replace(/[。！？.!?]+$/u, "");
    const core = sentenceFragment(topic, Math.max(0, 24 - hanCount(twist)));
    return ensureMinimumHanLength(`${twist}，${core}。`, 12, "结果还在路上。");
  }

  const twist = pick(
    LONG_TRANSLATION_TWISTS[mood] ?? LONG_TRANSLATION_TWISTS["正常"],
    topic,
  ).replace(/[。！？.!?]+$/u, "");
  const core = sentenceFragment(topic, Math.max(0, 39 - hanCount(twist)));
  return ensureMinimumHanLength(`${twist}，${core}，先按原样发生了。`, 25, "事情还会继续发生。");
}

function answerFallback(
  topic: string,
  mood: string,
  generationLength: GenerationLength,
): string {
  const specific = specificAnswerFallback(topic, generationLength);
  if (specific) return specific;
  if (generationLength === "精辟") return conciseAnswer(topic);

  const kind = answerKind(topic);
  // The anchor gets more room at 正常 length, where templates run ~30 han.
  const maxAnchor = generationLength === "正常" ? 10 : 6;
  const subject = answerAnchor(topic, kind, maxAnchor);
  if (generationLength === "中等") {
    const template = MEDIUM_ANSWER_TEMPLATES[kind];
    return ensureMinimumHanLength(template.replaceAll("{subject}", subject), 12, "结果先在旁边等着。");
  }
  const template = LONG_ANSWER_TEMPLATES[kind];
  return ensureMinimumHanLength(template.replaceAll("{subject}", subject), 25, "事情稍后也会自己补上。");
}

/* ── 自由模式兜底：输入是灵感，歪理开场 + 灵感中置 ── */

const FREE_TWISTS: Record<string, readonly string[]> = {
  正常: [
    "灵感先到站，把顺序重新排了一遍",
    "脑洞先开门，把门后的想法都放了出来",
    "联想先出发，沿着输入绕了一大圈",
    "思路先绕路，把直路留给别人走",
    "想象力先上岗，替现实值了一整天的班",
  ],
  差: [
    "灵感半路迷路了",
    "脑洞只开了一半",
    "联想跑错了方向",
  ],
  极差: [
    "灵感直接罢工了",
    "脑洞把门反锁了",
    "联想开始自己编故事",
  ],
};

function freeFallback(
  topic: string,
  mood: string,
  generationLength: GenerationLength,
): string {
  if (generationLength === "精辟") {
    const subject = sentenceFragment(topic, 6) || "灵感";
    const ending = pick(
      ["先学会偷懒。", "拒绝按定义来。", "把正经忘了。", "决定反着工作。"],
      topic,
    );
    return `${subject}${ending}`;
  }
  if (generationLength === "中等") {
    const twist = pick(FREE_TWISTS[mood] ?? FREE_TWISTS["正常"], topic)
      .replace(/[。！？.!?]+$/u, "");
    const core = sentenceFragment(topic, Math.max(0, 23 - hanCount(twist)));
    return ensureMinimumHanLength(`${twist}，${core}。`, 12, "结果还在路上。");
  }
  const twist = pick(FREE_TWISTS[mood] ?? FREE_TWISTS["正常"], topic)
    .replace(/[。！？.!?]+$/u, "");
  const core = sentenceFragment(topic, Math.max(0, 31 - hanCount(twist)));
  return ensureMinimumHanLength(
    `${twist}，${core}，先按原样发生了，剩下的交给灵感自己安排。`,
    25,
    "事情还会继续发生。",
  );
}

export function fallbackForLength(
  topic: string,
  mood: string,
  generationLength: GenerationLength,
  mode: GenerationMode,
): string {
  if (mode === "翻译") return translationFallback(topic, mood, generationLength);
  if (mode === "回答") return answerFallback(topic, mood, generationLength);
  return freeFallback(topic, mood, generationLength);
}
