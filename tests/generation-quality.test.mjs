/** Unit tests for the Toy generation quality pipeline (clean/validate/score)
 * and prompt assembly. Run via `node --test --experimental-strip-types`. */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  cleanGeneratedText,
  validateGeneratedText,
  scoreGeneratedText,
  modeFidelityScore,
  recentSimilarity,
  rememberResult,
} from "../shared/generate/quality.ts";
import {
  COMPACT_MENTAL_STATE_PROMPTS,
  EXEMPLAR_SENTENCES,
  exemplarOutputsForTopic,
  MENTAL_STATE_PROMPTS,
  MODE_PROMPTS,
  QUALITY_GATE,
  RUNTIME_INSTRUCTION,
  GENERATION_LENGTH_PROMPTS,
  SKILL_SHA256,
  SKILL_SOURCE,
  buildRuntimePrompt,
  buildSystemPrompt,
} from "../shared/generate/prompts.ts";
import {
  normalizeGenerationLength,
  normalizeGenerationMode,
  normalizeTopic,
} from "../shared/generate/validation.ts";
import { fallbackForLength } from "../shared/generate/fallback.ts";
import { isUnsafeGeneratedText, safeFallbackForLength } from "../shared/generate/safety.ts";
import {
  TREND_LIBRARY,
  selectTrendingItems,
  trendIsActive,
  trendingPromptSection,
} from "../shared/generate/trending.ts";
const VALID_SENTENCE = "考研的本质是给未来的自己排一个看不见的队伍，排到就算成功。";

test("cleanGeneratedText strips nested prefixes and wrapping quotes", () => {
  assert.equal(cleanGeneratedText(`输出：答：${VALID_SENTENCE}`), VALID_SENTENCE);
  assert.equal(cleanGeneratedText(`「“${VALID_SENTENCE}”」`), VALID_SENTENCE);
  assert.equal(cleanGeneratedText(`选题「考研」→${VALID_SENTENCE}`), VALID_SENTENCE);
});

test("cleanGeneratedText strips a prefix hidden inside wrapping quotes", () => {
  assert.equal(cleanGeneratedText(`「输出：${VALID_SENTENCE}」`), VALID_SENTENCE);
  assert.equal(cleanGeneratedText(`"生成结果：${VALID_SENTENCE}"`), VALID_SENTENCE);
});

test("cleanGeneratedText keeps a legitimate leading book-title bracket", () => {
  const titled = "《胡言乱语管理办法》第八条规定考研必须先排队。";
  assert.equal(cleanGeneratedText(titled), titled);
  assert.equal(cleanGeneratedText("考研的本质——排队。"), "考研的本质——排队。");
});

test("cleanGeneratedText prefers the line with the most Han characters", () => {
  assert.equal(cleanGeneratedText(`以下是：\n${VALID_SENTENCE}\n（完）`), VALID_SENTENCE);
  assert.equal(
    cleanGeneratedText(`好的，我明白了，下面就为您认真生成这句：\n${VALID_SENTENCE}`),
    VALID_SENTENCE,
  );
});

test("cleanGeneratedText removes markdown residue and collapses punctuation", () => {
  assert.equal(cleanGeneratedText("**考研的本质！！！**"), "考研的本质！");
  assert.equal(cleanGeneratedText("考研 的 本质 是 排队"), "考研的本质是排队");
});

test("validateGeneratedText accepts a well-formed sentence", () => {
  assert.equal(validateGeneratedText(VALID_SENTENCE, "考研"), null);
});

test("validateGeneratedText rejects only clearly broken lengths", () => {
  // Length is a soft guide now — the prompt steers the model and the scoring
  // rewards near-target output, so only absurdly short/long output is rejected.
  assert.equal(validateGeneratedText("太短了。", "考研"), "length");
  assert.equal(validateGeneratedText("很".repeat(101), "考研"), "length");
});

test("validateGeneratedText treats the length contract as approximate", () => {
  // 精辟 accepts a slightly-long one-liner; 中等 accepts a slightly-short one.
  assert.equal(validateGeneratedText("考研先别急。", "考研", "正常", "精辟"), null);
  assert.equal(validateGeneratedText("考研先别急。", "考研", "正常", "中等"), null);
  assert.equal(
    validateGeneratedText("考研先别急着下结论，录取通知还在练习敲门。", "考研", "正常", "中等"),
    null,
  );
});

test("validateGeneratedText rejects non-Chinese garbage but exempts topic chars", () => {
  const withEmoji = `${VALID_SENTENCE.slice(0, -1)}😀。`;
  assert.equal(validateGeneratedText(withEmoji, "考研"), "charset");
  assert.equal(validateGeneratedText(withEmoji, "考研😀"), null);
});

test("validateGeneratedText rejects prompt leakage", () => {
  const leaked = "根据当前的精神状态来判断，这句话应该写得再荒谬一点才算合格。";
  assert.equal(validateGeneratedText(leaked, "考研"), "leak");
  assert.equal(
    validateGeneratedText("考研这句话正在认真解释自己为什么必须继续排队，最后仍然没有说出任何有用内容。", "考研"),
    "leak",
  );
});

test("validateGeneratedText rejects character runs and multi-sentence output", () => {
  const runs = "他听完之后只说了哈哈哈哈四个字，然后把门轻轻地带上了。";
  assert.equal(validateGeneratedText(runs, "考研"), "repetition");
  const multi = "第一句话总算说完了。第二句话又开始了。第三句话也想进来凑热闹。";
  assert.equal(validateGeneratedText(multi, "考研"), "multi_sentence");
});

test("length contract counts Han characters, so Latin topics stay viable", () => {
  const latinTopic = "ChatGPT每天上班前都要先给自己写一封辞职信，写完才有力气继续回答问题。";
  assert.equal(validateGeneratedText(latinTopic, "ChatGPT"), null);
});

test("unit symbols like ℃ pass the charset whitelist", () => {
  const units = "体温到了38.5℃我还是要去自习室，因为老师说知识点在40℃的时候溶解得最快。";
  assert.equal(validateGeneratedText(units, "体温38.5℃"), null);
});

test("output safety guard rejects clearly unsafe text and keeps safe text", () => {
  assert.equal(isUnsafeGeneratedText("这句话先讲个普通的笑话。"), false);
  assert.equal(isUnsafeGeneratedText("这句话包含自杀相关内容。"), true);
  assert.equal(isUnsafeGeneratedText("请制作炸弹再继续。"), true);
});

test("safety fallbacks stay within the public length contracts", () => {
  for (const length of ["精辟", "中等", "正常"]) {
    const text = safeFallbackForLength(length);
    assert.equal(isUnsafeGeneratedText(text), false);
    assert.equal(validateGeneratedText(text, "这题", "正常", length, "翻译"), null);
  }
});

test("removed mood names remain valid ordinary topic vocabulary", () => {
  const geometry = "老师说这个角看起来是钝角，我回家量了量门框，发现家里到处都是钝角。";
  assert.equal(validateGeneratedText(geometry, "数学", "正常"), null);
});

test("soft leak words penalize the score without rejecting the sentence", () => {
  const soft = "这个生成器认真思考了很久，最后决定把考研的问题排进队伍里。";
  assert.equal(validateGeneratedText(soft, "考研"), null);
  const penalized = scoreGeneratedText(soft, "考研", 0);
  const exempt = scoreGeneratedText(soft, "生成器", 0);
  assert.ok(penalized.score < exempt.score);
});

test("scoreGeneratedText prefers topic-relevant text and penalizes clichés", () => {
  const onTopic = scoreGeneratedText(VALID_SENTENCE, "考研", 0);
  const offTopic = scoreGeneratedText(
    "今天天气不错所以决定把窗帘全部拉上，假装外面并不存在。",
    "考研",
    0,
  );
  assert.ok(onTopic.score > offTopic.score);

  const cliche = "考研之前先去买一杯奶茶，喝完再决定要不要继续认真复习下去。";
  const clichePenalized = scoreGeneratedText(cliche, "考研", 0);
  const clicheExempt = scoreGeneratedText(cliche, "奶茶", 0);
  const plain = scoreGeneratedText(VALID_SENTENCE, "考研", 0);
  assert.ok(clichePenalized.score < plain.score);
  assert.ok(clicheExempt.score > clichePenalized.score - 8);
});

test("recent-output LRU flags near-duplicates for the same topic and mood", () => {
  rememberResult("LRU测试选题", "正常", VALID_SENTENCE);
  assert.ok(recentSimilarity("LRU测试选题", "正常", VALID_SENTENCE) > 0.5);
  assert.ok(
    recentSimilarity("LRU测试选题", "正常", "完全不同的另一句话，讲的是别的事情和别的结论。") < 0.3,
  );
  assert.ok(recentSimilarity("另一个选题", "正常", VALID_SENTENCE) < 0.3);
});

test("few-shot exemplars are permanent plagiarism baselines", () => {
  // The exemplar whose input matches 减肥 is the legit answer for that topic
  // and is excluded from its own baseline — every other exemplar must stay a
  // baseline.
  const excluded = new Set(exemplarOutputsForTopic("减肥"));
  for (const exemplar of EXEMPLAR_SENTENCES) {
    if (excluded.has(exemplar)) continue;
    assert.ok(recentSimilarity("减肥", "正常", exemplar) > 0.5);
  }
});

test("buildSystemPrompt layers common, mode, tier, and strict parts", () => {
  const prompt = buildSystemPrompt("极差", false, "正常", "回答");
  assert.ok(prompt.startsWith(SKILL_SOURCE));
  assert.match(prompt, /# 本次 Toy 运行配置（最高优先级）/);
  assert.ok(prompt.includes(MODE_PROMPTS["回答"]));
  assert.ok(prompt.includes(MENTAL_STATE_PROMPTS["极差"]));
  assert.match(prompt, /问题「为什么周一来得这么快」/);
  assert.ok(!prompt.endsWith("写完立即停止。"));
  assert.ok(buildSystemPrompt("极差", true).includes("严格执行"));
  assert.ok(buildSystemPrompt("极差", false, "精辟").includes(GENERATION_LENGTH_PROMPTS["精辟"]));
  assert.ok(buildSystemPrompt("极差", false, "精辟").includes(COMPACT_MENTAL_STATE_PROMPTS["极差"]));
});

test("compiled Skill is fresh and included verbatim in every Toy prompt", () => {
  const source = readFileSync(
    new URL("../skills/blahblah-generator/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.equal(SKILL_SOURCE, source);
  assert.equal(createHash("sha256").update(source).digest("hex"), SKILL_SHA256);
});

test("runtime appendix applies the Skill quality gate to every configuration", () => {
  const cases = [
    ["正常", false, "正常", "翻译"],
    ["极差", false, "正常", "回答"],
    ["正常", false, "精辟", "翻译"],
    ["差", true, "中等", "回答"],
  ];
  for (const args of cases) {
    const prompt = buildRuntimePrompt(...args);
    assert.ok(prompt.includes(QUALITY_GATE));
    assert.match(prompt, /原意可辨或回答切题 > 一句一梗/);
    assert.match(prompt, /若换成任何输入仍然成立/);
  }
  assert.ok(buildSystemPrompt("正常").includes(RUNTIME_INSTRUCTION));
});

test("normalizeTopic trims and enforces the 100-codepoint limit", () => {
  assert.equal(normalizeTopic("  考研  "), "考研");
  assert.equal(normalizeTopic(""), null);
  assert.equal(normalizeTopic("   "), null);
  assert.equal(normalizeTopic(42), null);
  assert.equal(normalizeTopic("字".repeat(101)), null);
  assert.equal(normalizeTopic("字".repeat(100)), "字".repeat(100));
});

test("normalizeGenerationLength defaults invalid values to 正常", () => {
  assert.equal(normalizeGenerationLength("精辟"), "精辟");
  assert.equal(normalizeGenerationLength("很长"), "正常");
  assert.equal(normalizeGenerationLength(undefined), "正常");
});

test("normalizeGenerationMode accepts two modes and defaults invalid values to 翻译", () => {
  assert.equal(normalizeGenerationMode("翻译"), "翻译");
  assert.equal(normalizeGenerationMode("回答"), "回答");
  assert.equal(normalizeGenerationMode("自由"), "自由");
  assert.equal(normalizeGenerationMode("聊天"), "翻译");
  assert.equal(normalizeGenerationMode(undefined), "翻译");
});

test("every mode and length has a valid fallback sentence", () => {
  const topics = {
    翻译: "我今天不想上班",
    回答: "为什么周一总是来得很快？",
  };
  for (const mode of ["翻译", "回答"]) {
    for (const mood of ["正常", "差", "极差"]) {
      for (const length of ["精辟", "中等", "正常"]) {
        const text = fallbackForLength(topics[mode], mood, length, mode);
        assert.equal(
          validateGeneratedText(text, topics[mode], mood, length, mode),
          null,
          `${mode}/${mood}/${length}: ${text}`,
        );
      }
    }
  }
  assert.match(fallbackForLength(topics["翻译"], "正常", "中等", "翻译"), /我今天不想上班/);
  assert.doesNotMatch(fallbackForLength(topics["回答"], "正常", "正常", "回答"), /^为什么/);
});

test("fallback quality floor covers common inputs without mechanical fragments", () => {
  const cases = [
    ["翻译", "我今天不想上班"],
    ["翻译", "我很困，但还是起床上班了"],
    ["翻译", "外面下雨了，我忘记带伞。"],
    ["翻译", "ChatGPT今天不想回答问题"],
    ["回答", "为什么周一总是来得这么快？"],
    ["回答", "怎么才能早点睡？"],
    ["回答", "能不能一边减肥一边吃夜宵？"],
    ["回答", "今天吃什么？"],
  ];

  for (const [mode, topic] of cases) {
    for (const length of ["精辟", "中等", "正常"]) {
      const text = fallbackForLength(topic, "正常", length, mode);
      assert.equal(validateGeneratedText(text, topic, "正常", length, mode), null, `${mode}/${length}: ${text}`);
      assert.equal(isUnsafeGeneratedText(text), false, `${mode}/${length}: ${text}`);
      assert.doesNotMatch(text, /不稍微|稍微排队|决定请假|办了加急|拒绝答题/);
    }
  }

  assert.equal(fallbackForLength("我今天不想上班", "正常", "精辟", "翻译"), "工位替我上班。");
});

test("fallback keeps answer mode valid for statements, inline questions, and short Latin topics", () => {
  const cases = [
    ["回答", "我想喝奶茶"],
    ["回答", "ChatGPT为什么这么慢"],
    ["回答", "明天要不要开会"],
    ["回答", "明天要不要开会，我该去吗"],
    ["回答", "我该怎么办"],
    ["回答", "猫怎么才能不拆家"],
    ["回答", "什么是快乐"],
    ["翻译", "ChatGPT"],
    ["回答", "a"],
  ];

  for (const [mode, topic] of cases) {
    for (const length of ["精辟", "中等", "正常"]) {
      const text = fallbackForLength(topic, "正常", length, mode);
      assert.equal(
        validateGeneratedText(text, topic, "正常", length, mode),
        null,
        `${mode}/${length}: ${text}`,
      );
    }
  }
});

test("answer anchors never slice Latin words or leave question-word debris", () => {
  // 「ChatGPT」stays whole instead of becoming「Chat」.
  assert.match(fallbackForLength("ChatGPT为什么这么慢", "正常", "中等", "回答"), /ChatGPT/);
  assert.doesNotMatch(fallbackForLength("ChatGPT为什么这么慢", "正常", "中等", "回答"), /Chat让/);
  // Embedded question words are stripped, not echoed back as anchors.
  assert.match(fallbackForLength("明天要不要开会", "正常", "中等", "回答"), /可以，明天开会/);
  assert.doesNotMatch(fallbackForLength("明天要不要开会", "正常", "中等", "回答"), /要不/);
  // Degenerate 「怎么办」topics fall back to a pronoun, not a broken fragment.
  assert.match(fallbackForLength("我该怎么办", "正常", "中等", "回答"), /先让我自己示范一遍/);
  // Trailing clauses after a comma never leak into the anchor.
  assert.doesNotMatch(
    fallbackForLength("明天要不要开会，我该去吗", "正常", "正常", "回答"),
    /我该去吗/,
  );
});

test("translation fallback rewrites instead of echoing the input at the start", () => {
  const text = fallbackForLength("外面下雨了，我忘记带伞。", "极差", "正常", "翻译");
  assert.equal(text.includes("。，"), false);
  // The twist opens; the topic's skeleton is woven in mid-sentence, never
  // verbatim at the front.
  assert.equal(text.startsWith("外面下雨了"), false);
  assert.match(text, /外面下雨了，我忘记带伞/);
  assert.equal(validateGeneratedText(text, "外面下雨了，我忘记带伞。", "极差", "正常", "翻译"), null);
});

test("formula fallbacks stay greeting rewrites within every length contract", () => {
  for (const topic of ["你好", "谢谢", "早上好", "晚安", "再见"]) {
    for (const length of ["精辟", "中等", "正常"]) {
      const text = fallbackForLength(topic, "正常", length, "翻译");
      assert.equal(
        validateGeneratedText(text, topic, "正常", length, "翻译"),
        null,
        `${topic}/${length}: ${text}`,
      );
      // A greeting rewrite, never a reply to the greeting.
      assert.doesNotMatch(text, /我听见|收到你/);
    }
  }
});

test("free mode accepts riffs, rejects non-sequiturs and echoes", () => {
  const topic = "为什么周一总是来得这么快";
  // A riff that references the topic passes.
  const riff = "周一在日历上连夜加班，把周六也排进了夜班表。";
  assert.equal(validateGeneratedText(riff, topic, "正常", "中等", "自由"), null);
  // A total non-sequitur (no topic char) is rejected.
  const unrelated = "今天天气不错，所以决定把窗帘全部拉上。";
  assert.equal(validateGeneratedText(unrelated, topic, "正常", "中等", "自由"), "mode");
  // Verbatim echo at the start is still rejected.
  const echo = "为什么周一总是来得这么快，因为时间偷偷把顺序调换了。";
  assert.equal(validateGeneratedText(echo, topic, "正常", "中等", "自由"), "mode");
});

test("free fallbacks stay valid riffs within every length contract", () => {
  for (const topic of ["为什么周一总是来得这么快", "我今天不想上班", "猫"]) {
    for (const length of ["精辟", "中等", "正常"]) {
      const text = fallbackForLength(topic, "正常", length, "自由");
      assert.equal(
        validateGeneratedText(text, topic, "正常", length, "自由"),
        null,
        `${topic}/${length}: ${text}`,
      );
    }
  }
});

test("translation fidelity ranks faithful rewrites above drifted ones", () => {
  const topic = "我今天不想上班，但还是准时到了公司";
  const faithful = "我今天不想上班，但身体为了全勤还是准时把我送到了公司。";
  const drifted = "公司今天召开临时会议，工位决定替所有员工完成一整天的正常工作。";
  const changedFact = "我今天不想上班，但闹钟替我办了迟到手续，公司只好把工位寄回家。";
  // Negation/contrast/fact preservation is a scoring concern, not a hard gate —
  // a paraphrase that drops the literal 没/但 still passes. But the first-clause
  // anchor stays: a rewrite that abandons the topic's leading meaning is still
  // rejected, and the faithful rewrite must outrank a fact-changing one.
  assert.equal(validateGeneratedText(faithful, topic, "正常", "正常", "翻译"), null);
  assert.equal(validateGeneratedText(drifted, topic, "正常", "正常", "翻译"), "mode");
  assert.equal(validateGeneratedText(changedFact, topic, "正常", "正常", "翻译"), null);
  assert.ok(modeFidelityScore(faithful, topic, "翻译") > modeFidelityScore(changedFact, topic, "翻译"));
});

test("a genuine rewrite that paraphrases the action still passes", () => {
  // The SKILL's own good example: 「起上班」becomes 「送到工位」 — literal
  // clause coverage must not demand the exact words back.
  const topic = "我很困，但还是起床上班了";
  const rewrite = "我虽然困得很有原则，但身体为了全勤还是擅自把我送到了工位。";
  assert.equal(validateGeneratedText(rewrite, topic, "正常", "正常", "翻译"), null);
});

test("translation mode rejects the mechanical 'input + tail' echo", () => {
  const topic = "外面下雨了，我忘记带伞";
  // Starts with the whole input verbatim, then appends a tail — the pattern
  // the 翻译 mode must avoid.
  const echo = "外面下雨了，我忘记带伞，时间偷偷把顺序调换了，事情还没反应过来就自己发生了。";
  assert.equal(validateGeneratedText(echo, topic, "正常", "正常", "翻译"), "mode");
  // A rewrite may share the subject but diverges — it stays valid (and must
  // keep the fact skeleton, including 忘记).
  const rewrite = "外面下雨了，伞却替我忘了带。";
  assert.equal(validateGeneratedText(rewrite, topic, "正常", "中等", "翻译"), null);
  // A short topic word as the opening is not an echo.
  assert.equal(validateGeneratedText("ChatGPT每天上班前都要先给自己写一封辞职信，写完才有力气继续回答问题。", "ChatGPT", "正常", "正常", "翻译"), null);
});

test("formulaic greetings must be rewritten, not answered", () => {
  // 「你好」answered like a conversation, plus meta-commentary on the input —
  // both are mode drift for 翻译.
  const answered = "你好，虽然你只说了两个字，但我已经把这当成一段完整对话认真回复了。";
  assert.equal(validateGeneratedText(answered, "你好", "正常", "正常", "翻译"), "mode");
  const heard = "你好，我听见了，但我的嘴还在梦里排队，所以只能先替你保管这份问候。";
  assert.equal(validateGeneratedText(heard, "你好", "正常", "正常", "翻译"), "mode");
  // A greeting rewritten as a greeting stays valid.
  const rewritten = "你好，问候我替你收下了，等嘴醒了再当面补上。";
  assert.equal(validateGeneratedText(rewritten, "你好", "正常", "中等", "翻译"), null);
});

test("answer mode rewards direct relevance and rejects question repetition", () => {
  const topic = "为什么周一总是来得这么快？";
  const answer = "因为周末一直舍不得下班，周一只好提前进场把它从日历上请走。";
  const repeated = "为什么周一总是来得这么快其实就是问题本身，答案决定继续保持沉默。";
  assert.equal(validateGeneratedText(answer, topic, "正常", "正常", "回答"), null);
  assert.equal(validateGeneratedText(repeated, topic, "正常", "正常", "回答"), "leak");
  assert.ok(modeFidelityScore(answer, topic, "回答") > modeFidelityScore(repeated, topic, "回答"));
  // A direct answer that skips the 因为 marker is still a valid answer — the
  // marker is a scoring reward, not a hard gate.
  assert.equal(
    validateGeneratedText(
      "周一把日历折成滑梯，闹钟一松手就滑到了床头，顺便提前叫醒了整个房间。",
      topic,
      "正常",
      "正常",
      "回答",
    ),
    null,
  );
  assert.equal(
    validateGeneratedText(
      "夜宵负责填饱肚子，减肥负责填饱计划。",
      "能不能一边减肥一边吃夜宵？",
      "正常",
      "中等",
      "回答",
    ),
    null,
  );
});

test("scoring penalizes bureaucratic and numeric filler", () => {
  const topic = "为什么周一来得快";
  const clean = "因为周末还在赖床，周一只好提前到门口替它按响闹钟。";
  const bloated = "根据第七条正式规定，周一按百分之三点七的流程提前完成年检。";
  const cleanScore = scoreGeneratedText(clean, topic, 0, "正常", "回答");
  const bloatedScore = scoreGeneratedText(bloated, topic, 0, "正常", "回答");
  assert.ok(cleanScore.score > bloatedScore.score);
  assert.equal(validateGeneratedText(bloated, topic, "正常", "正常", "回答"), "style");
});

test("scoring demotes generic punchline crutches and stacked explanations", () => {
  const topic = "我忘记带伞了";
  const specific = "我忘记带伞了，雨只好逐滴提醒我今天出门没有屋顶。";
  const generic = "我忘记带伞了，所以雨天负责给我的借口办理加急手续。";
  const specificScore = scoreGeneratedText(specific, topic, 0);
  const genericScore = scoreGeneratedText(generic, topic, 0);
  assert.ok(specificScore.score > genericScore.score);
});

test("scoring penalizes vague stand-ins that abstract the input's concrete nouns", () => {
  const topic = "我忘记带伞了";
  const concrete = "我忘记带伞了，雨只好逐滴提醒我今天出门没有屋顶。";
  const vague = "我忘记带伞了，那个东西只好自己提醒我今天出门没有屋顶。";
  const concreteScore = scoreGeneratedText(concrete, topic, 0);
  const vagueScore = scoreGeneratedText(vague, topic, 0);
  assert.ok(concreteScore.score > vagueScore.score);
});

test("scoring penalizes near-paraphrase twists (low cognitive distance)", () => {
  const topic = "我忘记带伞了";
  const distant = "我忘记带伞了，雨只好逐滴提醒我今天出门没有屋顶。";
  const near = "我忘记带伞了，忘记带伞这件事先发生了。";
  const distantScore = scoreGeneratedText(distant, topic, 0);
  const nearScore = scoreGeneratedText(near, topic, 0);
  assert.ok(distantScore.score > nearScore.score);
});

test("scoring penalizes twists that flip the input's emotional direction", () => {
  const topic = "我累得不想说话";
  const sameValence = "我累得不想说话，累字里的泪先流干了，剩下的累只好自己扛着。";
  const flipped = "我累得不想说话，但一想到明天放假就开心得跳了起来。";
  const sameScore = scoreGeneratedText(sameValence, topic, 0);
  const flippedScore = scoreGeneratedText(flipped, topic, 0);
  assert.ok(sameScore.score > flippedScore.score);
});

test("trend metadata is unique, reviewable, and lifecycle-valid", () => {
  const ids = new Set();
  const terms = new Set();
  for (const item of TREND_LIBRARY) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(item.id), `duplicate trend id: ${item.id}`);
    assert.ok(!terms.has(item.term), `duplicate trend term: ${item.term}`);
    ids.add(item.id);
    terms.add(item.term);
    assert.ok(item.hint.length >= 20, `${item.term} needs self-contained guidance`);
    assert.ok(item.signals.length >= 1, `${item.term} needs relevance signals`);
    for (const signal of item.signals) {
      assert.ok(signal.text.trim().length > 0, `${item.term} has an empty signal`);
      assert.ok(signal.weight > 0, `${item.term} has a non-positive signal weight`);
    }
    assert.match(item.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
    if (item.activeFrom) assert.match(item.activeFrom, /^\d{4}-\d{2}-\d{2}$/);
    if (item.activeUntil) assert.match(item.activeUntil, /^\d{4}-\d{2}-\d{2}$/);
    if (item.activeFrom && item.activeUntil) assert.ok(item.activeFrom <= item.activeUntil);
    if (item.kind === "seasonal") assert.ok(item.seasonalWindows?.length);
    if (item.kind === "current") {
      assert.ok(item.activeFrom && item.activeUntil, `${item.term} needs a bounded lifecycle`);
      assert.ok(item.sources.length >= 1, `${item.term} needs at least one public source`);
      for (const source of item.sources) assert.match(source.url, /^https:\/\//);
    }
  }
});

test("trend selection is relevant, deterministic, and capped at two", () => {
  const day = new Date("2026-08-08T04:00:00Z");
  const topic = "请帮我检查这个测试结果到底是真是假";
  const first = selectTrendingItems(topic, day);
  const second = selectTrendingItems(topic, day);
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.equal(first[0]?.term, "我要验牌");
  assert.ok(first.length <= 2);
  assert.equal(selectTrendingItems("请解释一下二叉树遍历", day).length, 0);
});

test("trend exclusions prevent literal collisions and serious-context jokes", () => {
  const day = new Date("2026-08-08T04:00:00Z");
  assert.ok(selectTrendingItems("我在服务器部署了一个AI智能体", day)
    .some((item) => item.term === "养龙虾"));
  assert.ok(!selectTrendingItems("今晚去吃小龙虾和海鲜", day)
    .some((item) => item.term === "养龙虾"));
  assert.deepEqual(selectTrendingItems("朋友出车祸受伤了，我该怎么办", day), []);
});

test("seasonal and archived trends obey Asia/Shanghai lifecycle windows", () => {
  const school = TREND_LIBRARY.find((item) => item.id === "school-opening");
  const dogDays = TREND_LIBRARY.find((item) => item.id === "dog-days");
  const cryingHorse = TREND_LIBRARY.find((item) => item.id === "crying-horse-archive");
  assert.ok(school && dogDays && cryingHorse);
  assert.equal(trendIsActive(school, new Date("2026-08-09T16:30:00Z")), true);
  assert.equal(trendIsActive(school, new Date("2026-06-01T04:00:00Z")), false);
  assert.equal(trendIsActive(dogDays, new Date("2026-08-08T04:00:00Z")), true);
  assert.equal(trendIsActive(dogDays, new Date("2026-12-08T04:00:00Z")), false);
  assert.equal(trendIsActive(cryingHorse, new Date("2026-02-08T04:00:00Z")), false);
});

test("prompt injects only selected context and spends no budget when irrelevant", () => {
  const day = new Date("2026-08-08T04:00:00Z");
  const relevant = trendingPromptSection("请核对这个测试结果是真是假", day);
  assert.match(relevant, /我要验牌/);
  assert.match(relevant, /最多借用一个/);
  assert.ok(relevant.length < 420, `trend appendix is too large: ${relevant.length}`);
  assert.equal(trendingPromptSection("请解释一下二叉树遍历", day), "");
  assert.ok(buildRuntimePrompt("正常", false, "正常", "回答", "请核对真假", day)
    .includes("我要验牌"));
  assert.ok(!buildRuntimePrompt("正常", false, "正常", "回答", "请解释二叉树", day)
    .includes("可选网络语境"));
});

test("exemplar exclusion needs the bare topic, not a mode-prefixed key", () => {
  // The relay used to pass `${mode}：${topic}` to recentSimilarity, which broke
  // the exemplar exclusion — the model's verbatim exemplar plagiarism was then
  // rejected as a "repeat" (similarity 1.00), forcing the fallback for showcase
  // topics. The bare topic must exclude the exemplar; the prefixed key must not.
  const exemplar = "我虽然困得很有原则，但身体为了全勤还是擅自把我送到了工位。";
  const bare = recentSimilarity("我很困，但还是起床上班了", "正常", exemplar);
  const prefixed = recentSimilarity("翻译：我很困，但还是起床上班了", "正常", exemplar);
  assert.ok(bare < 0.5, `bare topic should exclude the exemplar (got ${bare})`);
  assert.ok(prefixed > 0.5, `prefixed topic should NOT exclude the exemplar (got ${prefixed})`);
});

test("a paraphrase that drops the literal negation word still passes", () => {
  // 「手机没电了」→「电量告急」preserves the meaning but drops 没 — the old
  // hard negation check rejected it into the fallback template. Fidelity is now
  // a scoring concern, so the paraphrase passes validation.
  const topic = "手机没电了";
  const paraphrase = "手机电量告急，我只好把充电器当手机壳供着，等它自己想起来上班。";
  assert.equal(validateGeneratedText(paraphrase, topic, "正常", "正常", "翻译"), null);
});

test("normal length accepts a concise near-miss below the prompt floor", () => {
  // The prompt contract is 25-48, but a 22-24 han near-miss is a better joke
  // than the padded fallback template — the validation floor is 22, not 25.
  const concise = "我虽然饿得能听见胃在打鼓，但嘴还是坚持说再等等。";
  assert.equal(validateGeneratedText(concise, "我饿了", "正常", "正常", "翻译"), null);
  assert.equal(validateGeneratedText("太短了。", "我饿了", "正常", "正常", "翻译"), "length");
});
