/** Unit tests for the /api/generate quality pipeline (clean/validate/score)
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
} from "../app/api/generate/quality.ts";
import {
  COMPACT_MENTAL_STATE_PROMPTS,
  EXEMPLAR_SENTENCES,
  MENTAL_STATE_PROMPTS,
  MODE_PROMPTS,
  QUALITY_GATE,
  RUNTIME_INSTRUCTION,
  GENERATION_LENGTH_PROMPTS,
  MECHANISM_HINTS,
  TIER_MECHANISMS,
  SKILL_SHA256,
  SKILL_SOURCE,
  buildRuntimePrompt,
  buildSystemPrompt,
  drawMechanismSets,
} from "../app/api/generate/prompts.ts";
import {
  normalizeGenerationLength,
  normalizeGenerationMode,
  normalizeTopic,
} from "../app/api/generate/validation.ts";
import { fallbackForLength } from "../app/api/generate/fallback.ts";
import { isUnsafeGeneratedText, safeFallbackForLength } from "../app/api/generate/safety.ts";
import {
  buildProviderPayload,
  parseProviderResponse,
  resolveProviderConfig,
} from "../app/api/generate/provider.ts";

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

test("validateGeneratedText rejects out-of-range lengths", () => {
  assert.equal(validateGeneratedText("太短了。", "考研"), "length");
  assert.equal(validateGeneratedText("很".repeat(49), "考研"), "length");
});

test("validateGeneratedText applies the selected generation-length contract", () => {
  assert.equal(validateGeneratedText("考研先别急。", "考研", "正常", "精辟"), null);
  assert.equal(validateGeneratedText("考研先别急。", "考研", "正常", "中等"), "length");
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
  const penalized = scoreGeneratedText(soft, "考研", "正常", 0);
  const exempt = scoreGeneratedText(soft, "生成器", "正常", 0);
  assert.ok(penalized.score < exempt.score);
});

test("scoreGeneratedText prefers topic-relevant text and penalizes clichés", () => {
  const onTopic = scoreGeneratedText(VALID_SENTENCE, "考研", "正常", 0);
  const offTopic = scoreGeneratedText(
    "今天天气不错所以决定把窗帘全部拉上，假装外面并不存在。",
    "考研",
    "正常",
    0,
  );
  assert.ok(onTopic.score > offTopic.score);

  const cliche = "考研之前先去买一杯奶茶，喝完再决定要不要继续认真复习下去。";
  const clichePenalized = scoreGeneratedText(cliche, "考研", "正常", 0);
  const clicheExempt = scoreGeneratedText(cliche, "奶茶", "正常", 0);
  const plain = scoreGeneratedText(VALID_SENTENCE, "考研", "正常", 0);
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
  for (const exemplar of EXEMPLAR_SENTENCES) {
    assert.ok(recentSimilarity("减肥", "正常", exemplar) > 0.5);
  }
});

test("prompt tables are internally consistent", () => {
  assert.deepEqual(Object.keys(MENTAL_STATE_PROMPTS).sort(), ["差", "极差", "正常"].sort());
  assert.deepEqual(
    Object.keys(TIER_MECHANISMS).sort(),
    Object.keys(MENTAL_STATE_PROMPTS).sort(),
  );
  for (const names of Object.values(TIER_MECHANISMS)) {
    for (const name of names) assert.ok(MECHANISM_HINTS[name], `missing hint for ${name}`);
  }
});

test("drawMechanismSets keeps candidates disjoint and inside the tier whitelist", () => {
  for (const mood of Object.keys(TIER_MECHANISMS)) {
    for (let i = 0; i < 50; i++) {
      const draw = drawMechanismSets(mood);
      const [a, b, c] = draw.candidates;
      const all = [...a, ...b, ...c, draw.retry];
      for (const name of all) assert.ok(TIER_MECHANISMS[mood].includes(name));
      for (const name of a) assert.ok(!b.includes(name), "candidates must be disjoint");
      for (const name of a) assert.ok(!c.includes(name), "candidates must be disjoint");
      for (const name of b) assert.ok(!c.includes(name), "candidates must be disjoint");
    }
  }
});

test("buildSystemPrompt layers common, mode, tier, mechanism, and strict parts", () => {
  const prompt = buildSystemPrompt("极差", ["情绪实体化"], false, "正常", "回答");
  assert.ok(prompt.startsWith(SKILL_SOURCE));
  assert.match(prompt, /# 本次网站运行配置（最高优先级）/);
  assert.ok(prompt.includes(MODE_PROMPTS["回答"]));
  assert.ok(prompt.includes(MENTAL_STATE_PROMPTS["极差"]));
  assert.ok(prompt.includes(MECHANISM_HINTS["情绪实体化"]));
  assert.match(prompt, /问题「为什么周一来得这么快」/);
  assert.ok(!prompt.endsWith("写完立即停止。"));
  assert.ok(buildSystemPrompt("极差", ["情绪实体化"], true).includes("严格执行"));
  assert.ok(buildSystemPrompt("极差", ["情绪实体化"], false, "精辟").includes(GENERATION_LENGTH_PROMPTS["精辟"]));
  assert.ok(buildSystemPrompt("极差", ["情绪实体化"], false, "精辟").includes(COMPACT_MENTAL_STATE_PROMPTS["极差"]));
});

test("compiled Skill is fresh and included verbatim in every website prompt", () => {
  const source = readFileSync(
    new URL("../skills/blahblah-generator/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.equal(SKILL_SOURCE, source);
  assert.equal(createHash("sha256").update(source).digest("hex"), SKILL_SHA256);
});

test("runtime appendix applies the Skill quality gate to every configuration", () => {
  const cases = [
    ["正常", ["错误因果"], false, "正常", "翻译"],
    ["极差", ["情绪实体化"], false, "正常", "回答"],
    ["正常", ["错误因果"], false, "精辟", "翻译"],
    ["差", ["错误因果"], true, "中等", "回答"],
  ];
  for (const args of cases) {
    const prompt = buildRuntimePrompt(...args);
    assert.ok(prompt.includes(QUALITY_GATE));
    assert.match(prompt, /原意可辨或回答切题 > 一句一梗/);
    assert.match(prompt, /若换成任何输入仍然成立/);
  }
  assert.ok(buildSystemPrompt("正常", ["错误因果"]).includes(RUNTIME_INSTRUCTION));
});

test("normalizeTopic trims and enforces the 30-codepoint limit", () => {
  assert.equal(normalizeTopic("  考研  "), "考研");
  assert.equal(normalizeTopic(""), null);
  assert.equal(normalizeTopic("   "), null);
  assert.equal(normalizeTopic(42), null);
  assert.equal(normalizeTopic("字".repeat(31)), null);
  assert.equal(normalizeTopic("字".repeat(30)), "字".repeat(30));
});

test("normalizeGenerationLength defaults invalid values to 正常", () => {
  assert.equal(normalizeGenerationLength("精辟"), "精辟");
  assert.equal(normalizeGenerationLength("很长"), "正常");
  assert.equal(normalizeGenerationLength(undefined), "正常");
});

test("normalizeGenerationMode accepts two modes and defaults invalid values to 翻译", () => {
  assert.equal(normalizeGenerationMode("翻译"), "翻译");
  assert.equal(normalizeGenerationMode("回答"), "回答");
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

test("normal translation fallback joins after source punctuation cleanly", () => {
  const text = fallbackForLength("外面下雨了，我忘记带伞。", "极差", "正常", "翻译");
  assert.equal(text.includes("。，"), false);
  assert.equal(text.startsWith("外面下雨了，我忘记带伞，"), true);
});

test("translation fidelity preserves negation and contrast", () => {
  const topic = "我今天不想上班，但还是准时到了公司";
  const faithful = "我今天不想上班，但身体为了全勤还是准时把我送到了公司。";
  const drifted = "公司今天召开临时会议，工位决定替所有员工完成一整天的正常工作。";
  const changedFact = "我今天不想上班，但闹钟替我办了迟到手续，公司只好把工位寄回家。";
  assert.equal(validateGeneratedText(faithful, topic, "正常", "正常", "翻译"), null);
  assert.equal(validateGeneratedText(drifted, topic, "正常", "正常", "翻译"), "mode");
  assert.equal(validateGeneratedText(changedFact, topic, "正常", "正常", "翻译"), "mode");
  assert.ok(modeFidelityScore(faithful, topic, "翻译") > modeFidelityScore(drifted, topic, "翻译") + 30);
});

test("answer mode rewards direct relevance and rejects question repetition", () => {
  const topic = "为什么周一总是来得这么快？";
  const answer = "因为周末一直舍不得下班，周一只好提前进场把它从日历上请走。";
  const repeated = "为什么周一总是来得这么快其实就是问题本身，答案决定继续保持沉默。";
  assert.equal(validateGeneratedText(answer, topic, "正常", "正常", "回答"), null);
  assert.equal(validateGeneratedText(repeated, topic, "正常", "正常", "回答"), "leak");
  assert.ok(modeFidelityScore(answer, topic, "回答") > modeFidelityScore(repeated, topic, "回答"));
  assert.equal(
    validateGeneratedText(
      "周一把日历折成滑梯，闹钟一松手就滑到了床头，顺便提前叫醒了整个房间。",
      topic,
      "正常",
      "正常",
      "回答",
    ),
    "mode",
  );
  assert.equal(
    validateGeneratedText(
      "夜宵负责填饱肚子，减肥负责填饱计划。",
      "能不能一边减肥一边吃夜宵？",
      "正常",
      "中等",
      "回答",
    ),
    "mode",
  );
});

test("scoring penalizes bureaucratic and numeric filler", () => {
  const topic = "为什么周一来得快";
  const clean = "因为周末还在赖床，周一只好提前到门口替它按响闹钟。";
  const bloated = "根据第七条正式规定，周一按百分之三点七的流程提前完成年检。";
  const cleanScore = scoreGeneratedText(clean, topic, "正常", 0, ["错误因果"], "正常", "回答");
  const bloatedScore = scoreGeneratedText(bloated, topic, "正常", 0, ["错误因果"], "正常", "回答");
  assert.ok(cleanScore.score > bloatedScore.score);
  assert.equal(validateGeneratedText(bloated, topic, "正常", "正常", "回答"), "style");
});

test("scoring demotes generic punchline crutches and stacked explanations", () => {
  const topic = "我忘记带伞了";
  const specific = "我忘记带伞了，雨只好逐滴提醒我今天出门没有屋顶。";
  const generic = "我忘记带伞了，所以雨天负责给我的借口办理加急手续。";
  const specificScore = scoreGeneratedText(specific, topic, "差", 0, ["错误因果"]);
  const genericScore = scoreGeneratedText(generic, topic, "差", 0, ["错误因果"]);
  assert.ok(specificScore.score > genericScore.score);
});

test("Ollama Cloud is preferred with the same deepseek-v4-flash model", () => {
  const config = resolveProviderConfig({
    OLLAMA_API_KEY: "ollama-test-key",
    DEEPSEEK_API_KEY: "deepseek-test-key",
  });
  assert.deepEqual(config, {
    provider: "ollama",
    requestedProvider: "ollama",
    endpoint: "https://ollama.com/api/chat",
    apiKey: "ollama-test-key",
    model: "deepseek-v4-flash",
  });
});

test("provider resolution keeps DeepSeek as a safe temporary fallback", () => {
  const config = resolveProviderConfig({ DEEPSEEK_API_KEY: "deepseek-test-key" });
  assert.equal(config.provider, "deepseek");
  assert.equal(config.requestedProvider, "ollama");
  assert.equal(resolveProviderConfig({}), null);
});

test("Ollama payload and response use the native cloud API contract", () => {
  const payload = buildProviderPayload(
    { provider: "ollama", model: "deepseek-v4-flash" },
    "system prompt",
    "今天不想上班",
    "翻译",
    { temperature: 0.55, topP: 0.78, maxTokens: 100, timeoutMs: 12_000 },
  );
  assert.equal(payload.model, "deepseek-v4-flash");
  assert.equal(payload.stream, false);
  assert.equal(payload.think, false);
  assert.deepEqual(payload.options, {
    temperature: 0.55,
    top_p: 0.78,
    num_predict: 100,
    stop: ["\n"],
  });
  assert.deepEqual(
    parseProviderResponse("ollama", {
      message: { content: "生成结果。" },
      done: true,
      done_reason: "stop",
    }),
    { content: "生成结果。", finishReason: "stop" },
  );
});

test("DeepSeek payload remains available for rollback", () => {
  const payload = buildProviderPayload(
    { provider: "deepseek", model: "deepseek-v4-flash" },
    "system prompt",
    "今天不想上班",
    "回答",
    { temperature: 0.7, topP: 0.82, maxTokens: 100, timeoutMs: 12_000 },
  );
  assert.deepEqual(payload.thinking, { type: "disabled" });
  assert.equal(payload.max_tokens, 100);
  assert.equal(payload.frequency_penalty, 0.15);
});
