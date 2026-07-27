/** Unit tests for the /api/generate quality pipeline (clean/validate/score)
 * and prompt assembly. Run via `node --test --experimental-strip-types`. */
import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanGeneratedText,
  validateGeneratedText,
  scoreGeneratedText,
  recentSimilarity,
  rememberResult,
} from "../app/api/generate/quality.ts";
import {
  COMMON_PROMPT,
  COMPACT_MENTAL_STATE_PROMPTS,
  EXEMPLAR_SENTENCES,
  MENTAL_STATE_PROMPTS,
  MODE_PROMPTS,
  GENERATION_LENGTH_PROMPTS,
  MECHANISM_HINTS,
  TIER_MECHANISMS,
  buildSystemPrompt,
  drawMechanismSets,
} from "../app/api/generate/prompts.ts";
import {
  normalizeGenerationLength,
  normalizeGenerationMode,
  normalizeTopic,
} from "../app/api/generate/validation.ts";

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
  assert.equal(validateGeneratedText("很".repeat(66), "考研"), "length");
});

test("validateGeneratedText applies the selected generation-length contract", () => {
  assert.equal(validateGeneratedText("考研先别急。", "考研", "正常", "精辟"), null);
  assert.equal(validateGeneratedText("考研先别急。", "考研", "正常", "中等"), "length");
  assert.equal(
    validateGeneratedText("考研先别急着下结论，它正排队解释自己。", "考研", "正常", "中等"),
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
  assert.equal(validateGeneratedText(units, "考研"), null);
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
      const [a, b] = draw.candidates;
      const all = [...a, ...b, draw.retry];
      for (const name of all) assert.ok(TIER_MECHANISMS[mood].includes(name));
      for (const name of a) assert.ok(!b.includes(name), "candidates must be disjoint");
    }
  }
});

test("buildSystemPrompt layers common, mode, tier, mechanism, and strict parts", () => {
  const prompt = buildSystemPrompt("极差", ["抽象实体化"], false, "正常", "回答");
  assert.ok(prompt.startsWith(COMMON_PROMPT));
  assert.ok(prompt.includes(MODE_PROMPTS["回答"]));
  assert.ok(!prompt.includes(MODE_PROMPTS["翻译"]));
  assert.ok(prompt.includes(MENTAL_STATE_PROMPTS["极差"]));
  assert.ok(prompt.includes(MECHANISM_HINTS["抽象实体化"]));
  assert.ok(!prompt.includes("严格执行"));
  assert.ok(buildSystemPrompt("极差", ["抽象实体化"], true).includes("严格执行"));
  assert.ok(buildSystemPrompt("极差", ["抽象实体化"], false, "精辟").includes(GENERATION_LENGTH_PROMPTS["精辟"]));
  assert.ok(buildSystemPrompt("极差", ["抽象实体化"], false, "精辟").includes(COMPACT_MENTAL_STATE_PROMPTS["极差"]));
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
