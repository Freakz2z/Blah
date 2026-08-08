/** Curated trending-meme library for the Toy relay.
 *
 * Unlike the generation protocol (SKILL.md), this file holds volatile content:
 * current Chinese internet memes and seasonal hot topics. It is injected into
 * the runtime prompt as *optional* flavor material — the model may use a meme
 * as the twist, but never at the expense of the input's fact skeleton. The
 * quality scorer also consults this file so trending terms are exempt from the
 * stale-cliché penalty.
 *
 * MAINTENANCE: memes go stale in weeks. Refresh this list every 1–2 months.
 * Prefer widely-known, non-political terms; skip anything divisive. Keep each
 * `hint` self-contained so a model with a stale knowledge cutoff can still use
 * the term correctly. */

export interface TrendingItem {
  /** The meme term or hot topic as it appears in a sentence. */
  term: string;
  /** One or two sentences: what it means and how to deploy it in a joke. */
  hint: string;
  /** Optional example of the term used naturally. */
  example?: string;
}

/** Current internet memes (2025–2026), non-political and usable as humor material. */
export const TRENDING_MEMES: readonly TrendingItem[] = [
  {
    term: "圆头耄耋",
    hint: "谐音「圆头猫爹」：脑袋圆、脾气大的猫（尤其橘猫），被赋予家长式威严的人设。可写「它家那只圆头耄耋在旁边冷眼旁观」。",
  },
  {
    term: "高雅人士",
    hint: "一只被 AI 做成跳《但愿人长久》舞的企鹅表情包，「笨拙又优雅」的反差感。可用「笨拙地保持高雅」的句式。",
  },
  {
    term: "旋转猫",
    hint: "oiiai猫：一张呆立猫图配上 oiiaioiiai 声不断旋转的魔性电子梗。适合形容「停不下来、在原地打转」。",
  },
  {
    term: "爱你老己",
    hint: "谐音「爱你老己」（爱你+自己）：表达自我宠爱、反内耗的口号。可用「今天先爱你老己」这类自我关怀句式。",
  },
  {
    term: "高速运转的机械进入中国",
    hint: "东北口音一本正经播报荒诞新闻的句式，把不相关的词硬凑成貌似合理的话。可仿其「一本正经说胡话」的语气。",
  },
  {
    term: "意大利面拌42号混凝土",
    hint: "同样是东北口音荒诞新闻体，形容把毫不相干的东西强行组合还煞有介事。可写「它把X和Y像意大利面拌混凝土一样搅在一起」。",
  },
  {
    term: "东方明珠防御塔",
    hint: "调侃上海消费主义：在东方明珠下喝廉价饮品会被「防御塔射击」。适合写「太便宜会被东方明珠锁定的」句式。",
  },
  {
    term: "弗雷尔卓德",
    hint: "《英雄联盟》里的极寒之地，被网友用来代指东北，带自嘲与冷到极致的意味。适合形容「冷」或「东北」。",
  },
  {
    term: "XX一定要有XX",
    hint: "「盒饭一定要有菜和饭」式的废话总结句，听着有道理其实是废话。可用「X一定要有Y，这样才显得X」的句式制造废话感。",
  },
  {
    term: "大公公掉粪坑啦",
    hint: "电影《刀见笑》台词，被 AI 整活视频带火的荒诞梗，适合形容「突然传来一句没头没尾的坏消息」。",
  },
  {
    term: "city不city",
    hint: "「洋气不洋气、时髦不时髦」的询问句式，常带点调侃。可用「很city」夸人或自嘲。",
  },
  {
    term: "班味",
    hint: "上班族自嘲：指上班后整个人散发出的疲惫感。可用「班味」形容「上班上到人味都没了」。",
  },
  {
    term: "牛马",
    hint: "打工人自嘲：指被工作压榨、身不由己的人。可用「牛马」自嘲式形容忙碌或身不由己。",
  },
  {
    term: "已读乱回",
    hint: "收到消息但答非所问、敷衍回应。可用「已读乱回」形容敷衍或心不在焉的回应。",
  },
  {
    term: "偷感",
    hint: "偷偷摸摸做事的既视感，带点心虚或低调。可用「偷感很重」形容偷偷摸摸。",
  },
  {
    term: "硬控",
    hint: "被某事物牢牢控制住、挪不开眼。可用「被X硬控」句式形容被吸引住。",
  },
  {
    term: "天塌了",
    hint: "夸张表达大事不好、天要塌了。可用「天塌了」夸张形容小事被当成大事。",
  },
];

/** Seasonal / evergreen hot topics the model may reference as a fresh anchor.
 * Rotate with the calendar; keep each entry self-explanatory. */
export const TRENDING_TOPICS: readonly TrendingItem[] = [
  {
    term: "三伏天",
    hint: "盛夏最热时段。适合写「热到三伏天都开始加班」式的夸张。",
  },
  {
    term: "开学",
    hint: "八月下旬至九月初的开学季焦虑。可用「作业/暑假先开学」的拟人。",
  },
  {
    term: "奥运会",
    hint: "夏季体育盛事。可用「把日常琐事比作参赛/申办」的句式。",
  },
];

/** Deterministic daily rotation: a stable subset of memes per day keeps the
 * prompt fresh without churning every request. Same date → same subset, so
 * regenerations stay consistent within a day. */
export function rotatedMemes(date = new Date()): readonly TrendingItem[] {
  const dayKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let hash = 0;
  for (let i = 0; i < dayKey.length; i++) hash = (hash * 31 + dayKey.charCodeAt(i)) >>> 0;
  const count = Math.min(6, TRENDING_MEMES.length);
  const pool = [...TRENDING_MEMES];
  const picked: TrendingItem[] = [];
  for (let i = 0; i < count; i++) {
    const index = hash % pool.length;
    picked.push(pool[index]);
    pool.splice(index, 1);
    hash = (hash * 31 + 7) >>> 0;
  }
  return picked;
}

/** Builds the optional trending section appended to the runtime prompt. */
export function trendingPromptSection(): string {
  const memes = rotatedMemes().map(
    (item) => `- ${item.term}：${item.hint}`,
  );
  const topics = TRENDING_TOPICS.map(
    (item) => `- ${item.term}：${item.hint}`,
  );
  return [
    "可选素材（按需使用，不用也可以）：",
    "流行梗：",
    ...memes,
    "当前热点：",
    ...topics,
    "使用规则：梗或热点只能充当「歪」的角度，必须服务于输入里的事实；",
    "输入本身与任何梗无关时不要硬塞；一旦使用就直接写进句子，不解释梗本身。",
  ].join("\n");
}

/** All terms (memes + topics) for scoring lookups. */
export const TRENDING_TERMS: readonly string[] = [
  ...TRENDING_MEMES.map((item) => item.term),
  ...TRENDING_TOPICS.map((item) => item.term),
];

/** True when the term appears in the text as a standalone unit. Handles the
 * 「XX一定要有XX」form by matching the leading fragment. */
export function textContainsTrendingTerm(text: string, term: string): boolean {
  if (!text) return false;
  if (term.includes("XX")) {
    const prefix = term.split("XX")[0];
    return prefix.length > 0 && text.includes(prefix);
  }
  return text.includes(term);
}

/** Terms from the trending library that appear in the output but not in the
 * topic — i.e. memes the model actually injected on its own. */
export function injectedTrendingTerms(text: string, topic: string): string[] {
  return TRENDING_TERMS.filter(
    (term) => textContainsTrendingTerm(text, term) && !topic.includes(term),
  );
}
