/** Context-aware internet-culture library for the Toy relay.
 *
 * A term is never injected merely because it is popular. Every active item has
 * a lifecycle, a set of weighted relevance signals, and optional exclusions.
 * Selection is conservative: no clear match means no meme prompt at all.
 */

import { isSensitiveRealWorldTopic } from "./safety.ts";

export type TrendKind = "current" | "evergreen" | "seasonal" | "archive";

export interface TrendSignal {
  text: string;
  weight: number;
}

export interface SeasonalWindow {
  /** Inclusive month-day in MM-DD form, evaluated in Asia/Shanghai. */
  start: string;
  /** Inclusive month-day in MM-DD form, evaluated in Asia/Shanghai. */
  end: string;
}

export interface TrendSource {
  label: string;
  url: string;
}

export interface TrendingItem {
  id: string;
  term: string;
  aliases?: readonly string[];
  /** Self-contained usage guidance sent to the model only after selection. */
  hint: string;
  kind: TrendKind;
  family: string;
  signals: readonly TrendSignal[];
  avoidSignals?: readonly string[];
  activeFrom?: string;
  activeUntil?: string;
  seasonalWindows?: readonly SeasonalWindow[];
  priority: number;
  reviewedAt: string;
  sources: readonly TrendSource[];
}

const SINA_2026_REVIEW: TrendSource = {
  label: "新浪新闻：2026 上半年热梗盘点",
  url: "https://www.sina.cn/news/detail/5315839670881108.html",
};

const ADQUAN_2026_REVIEW: TrendSource = {
  label: "广告门：2026 上半年热梗与传播语境",
  url: "https://m.adquan.com/detail/0-361636",
};

const BILIBILI_VERIFY_CARDS: TrendSource = {
  label: "哔哩哔哩：我要验牌原版及二创",
  url: "https://www.bilibili.com/video/BV12VFYzXExE/",
};

const BILIBILI_RAISE_LOBSTER: TrendSource = {
  label: "哔哩哔哩：养龙虾语境",
  url: "https://www.bilibili.com/video/BV1Z9wWznEaa/",
};

/**
 * Editorially reviewed library. `archive` entries stay here so lifecycle
 * behavior is testable and old terms cannot silently re-enter circulation.
 */
export const TREND_LIBRARY: readonly TrendingItem[] = [
  {
    id: "backhand-opossum",
    term: "背手负鼠",
    hint: "用背着手淡定旁观的负鼠形象，表达松弛、看戏或事情再急也先观察一下；只适合轻松日常，不用于真实事故。",
    kind: "current",
    family: "calm-observer",
    signals: [
      { text: "松弛", weight: 8 },
      { text: "淡定", weight: 7 },
      { text: "围观", weight: 7 },
      { text: "看戏", weight: 7 },
      { text: "旁观", weight: 6 },
      { text: "发呆", weight: 5 },
      { text: "不着急", weight: 6 },
      { text: "休息", weight: 4 },
      { text: "等着", weight: 4 },
    ],
    avoidSignals: ["事故", "受伤", "报警", "失踪"],
    activeFrom: "2026-05-01",
    activeUntil: "2026-09-30",
    priority: 9,
    reviewedAt: "2026-08-08",
    sources: [SINA_2026_REVIEW, ADQUAN_2026_REVIEW],
  },
  {
    id: "verify-cards",
    term: "我要验牌",
    hint: "把核对真假、检查证据或不肯轻信写成一本正经的“验牌”；适合测试、审核、辨真伪，不要用于考试作弊或赌博建议。",
    kind: "current",
    family: "verification",
    signals: [
      { text: "验证", weight: 8 },
      { text: "核对", weight: 8 },
      { text: "检查", weight: 7 },
      { text: "真假", weight: 8 },
      { text: "证据", weight: 7 },
      { text: "怀疑", weight: 6 },
      { text: "测试", weight: 5 },
      { text: "审核", weight: 5 },
      { text: "确认", weight: 4 },
    ],
    avoidSignals: ["作弊", "赌场", "下注"],
    activeFrom: "2025-11-01",
    activeUntil: "2026-09-30",
    priority: 10,
    reviewedAt: "2026-08-08",
    sources: [BILIBILI_VERIFY_CARDS],
  },
  {
    id: "snow-mountain-fox",
    term: "雪山救狐狸",
    aliases: ["雪山救狐"],
    hint: "借“雪山救狐后故事反转”的共同语境，写帮助、报恩或回报突然走偏；必须保留原输入中的帮助关系，不复述完整故事。",
    kind: "current",
    family: "favor-return",
    signals: [
      { text: "帮忙", weight: 7 },
      { text: "帮助", weight: 7 },
      { text: "救", weight: 6 },
      { text: "报恩", weight: 9 },
      { text: "回报", weight: 7 },
      { text: "恩情", weight: 7 },
      { text: "狐狸", weight: 8 },
      { text: "雪山", weight: 8 },
    ],
    avoidSignals: ["救护车", "抢救", "伤亡", "灾区"],
    activeFrom: "2026-02-01",
    activeUntil: "2026-08-31",
    priority: 7,
    reviewedAt: "2026-08-08",
    sources: [SINA_2026_REVIEW, ADQUAN_2026_REVIEW],
  },
  {
    id: "raise-lobster",
    term: "养龙虾",
    hint: "在 AI 智能体、自动化或部署语境里，把配置和运行智能体说成“养龙虾”；只用于技术自嘲，不把普通吃虾场景强行解释成 AI。",
    kind: "current",
    family: "ai-agent",
    signals: [
      { text: "OpenClaw", weight: 10 },
      { text: "openclaw", weight: 10 },
      { text: "智能体", weight: 9 },
      { text: "agent", weight: 8 },
      { text: "AI助手", weight: 8 },
      { text: "AI 助手", weight: 8 },
      { text: "自动化", weight: 6 },
      { text: "部署", weight: 5 },
      { text: "服务器", weight: 4 },
    ],
    avoidSignals: ["吃龙虾", "小龙虾", "海鲜", "过敏"],
    activeFrom: "2026-03-01",
    activeUntil: "2026-09-30",
    priority: 8,
    reviewedAt: "2026-08-08",
    sources: [SINA_2026_REVIEW, ADQUAN_2026_REVIEW, BILIBILI_RAISE_LOBSTER],
  },
  {
    id: "ai-fruit",
    term: "AI水果",
    aliases: ["水果恋爱岛"],
    hint: "把 AI 生成的拟人水果和恋爱真人秀式关系当作轻微反差；只用于 AI、水果、配对或综艺语境，不凭空添加角色。",
    kind: "current",
    family: "ai-character",
    signals: [
      { text: "AI视频", weight: 8 },
      { text: "AI 视频", weight: 8 },
      { text: "水果", weight: 8 },
      { text: "恋爱综艺", weight: 8 },
      { text: "真人秀", weight: 7 },
      { text: "配对", weight: 6 },
      { text: "拟人", weight: 6 },
    ],
    activeFrom: "2026-03-01",
    activeUntil: "2026-08-31",
    priority: 6,
    reviewedAt: "2026-08-08",
    sources: [ADQUAN_2026_REVIEW],
  },
  {
    id: "work-flavor",
    term: "班味",
    hint: "形容上班后自然流露的疲惫感；只用于工作、自嘲和通勤语境，不用来贬低他人职业。",
    kind: "evergreen",
    family: "work-fatigue",
    signals: [
      { text: "上班", weight: 7 },
      { text: "下班", weight: 6 },
      { text: "通勤", weight: 7 },
      { text: "工位", weight: 6 },
      { text: "加班", weight: 6 },
      { text: "工作", weight: 4 },
      { text: "周一", weight: 5 },
    ],
    priority: 5,
    reviewedAt: "2026-08-08",
    sources: [],
  },
  {
    id: "read-random-reply",
    term: "已读乱回",
    hint: "形容看见消息却答非所问；适合聊天、回复和沟通错位，不用于严肃求助或紧急信息。",
    kind: "evergreen",
    family: "communication",
    signals: [
      { text: "消息", weight: 6 },
      { text: "聊天", weight: 6 },
      { text: "回复", weight: 7 },
      { text: "回答", weight: 5 },
      { text: "群聊", weight: 7 },
      { text: "微信", weight: 6 },
      { text: "看见", weight: 4 },
    ],
    avoidSignals: ["求救", "报警", "急救"],
    priority: 5,
    reviewedAt: "2026-08-08",
    sources: [],
  },
  {
    id: "sneaky-feel",
    term: "偷感",
    hint: "形容动作偷偷摸摸、带点心虚；只用于无害的小动作，不用于真实违法、跟踪或侵犯隐私。",
    kind: "evergreen",
    family: "sneaky-action",
    signals: [
      { text: "偷偷", weight: 8 },
      { text: "悄悄", weight: 7 },
      { text: "心虚", weight: 7 },
      { text: "躲着", weight: 6 },
      { text: "藏", weight: 4 },
      { text: "偷感", weight: 10 },
    ],
    avoidSignals: ["盗窃", "偷拍", "跟踪", "偷窥", "违法"],
    priority: 4,
    reviewedAt: "2026-08-08",
    sources: [],
  },
  {
    id: "hard-control",
    term: "硬控",
    hint: "形容被内容或事物牢牢吸引、停不下来；适合视频、游戏、音乐和兴趣，不用于真实控制或胁迫。",
    kind: "evergreen",
    family: "attention",
    signals: [
      { text: "停不下来", weight: 8 },
      { text: "上头", weight: 7 },
      { text: "着迷", weight: 7 },
      { text: "吸引", weight: 5 },
      { text: "刷视频", weight: 7 },
      { text: "循环播放", weight: 7 },
      { text: "沉迷", weight: 6 },
    ],
    avoidSignals: ["控制欲", "胁迫", "绑架"],
    priority: 4,
    reviewedAt: "2026-08-08",
    sources: [],
  },
  {
    id: "dog-days",
    term: "三伏天",
    hint: "只在盛夏炎热语境中，把日常动作写成连三伏天都承受不住；不要在无关季节或室内普通话题中出现。",
    kind: "seasonal",
    family: "summer-heat",
    signals: [
      { text: "热", weight: 6 },
      { text: "高温", weight: 8 },
      { text: "空调", weight: 6 },
      { text: "太阳", weight: 5 },
      { text: "中暑", weight: 7 },
      { text: "夏天", weight: 6 },
    ],
    seasonalWindows: [{ start: "07-01", end: "08-31" }],
    priority: 5,
    reviewedAt: "2026-08-08",
    sources: [],
  },
  {
    id: "school-opening",
    term: "开学",
    hint: "只在开学季的作业、课程和假期结束语境中使用，让作业或暑假先一步行动；不要泛化到普通工作安排。",
    kind: "seasonal",
    family: "school-calendar",
    signals: [
      { text: "开学", weight: 10 },
      { text: "暑假", weight: 8 },
      { text: "寒假", weight: 8 },
      { text: "作业", weight: 7 },
      { text: "返校", weight: 8 },
      { text: "上课", weight: 6 },
      { text: "老师", weight: 4 },
      { text: "学生", weight: 4 },
    ],
    seasonalWindows: [
      { start: "02-10", end: "03-15" },
      { start: "08-01", end: "09-15" },
    ],
    priority: 6,
    reviewedAt: "2026-08-08",
    sources: [],
  },
  {
    id: "crying-horse-archive",
    term: "哭哭马",
    hint: "2026 马年初的委屈脸玩偶语境；已退出默认注入，只保留生命周期记录。",
    kind: "archive",
    family: "emotion-toy",
    signals: [{ text: "委屈", weight: 6 }],
    activeFrom: "2025-12-01",
    activeUntil: "2026-05-31",
    priority: 0,
    reviewedAt: "2026-08-08",
    sources: [SINA_2026_REVIEW],
  },
  {
    id: "love-yourself-archive",
    term: "爱你老己",
    hint: "2025 年末至 2026 年初的自我关怀谐音；已退出默认注入。",
    kind: "archive",
    family: "self-care",
    signals: [{ text: "爱自己", weight: 6 }],
    activeFrom: "2025-10-01",
    activeUntil: "2026-06-30",
    priority: 0,
    reviewedAt: "2026-08-08",
    sources: [],
  },
];

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiDateParts(date: Date): { dateKey: string; monthDay: string } {
  const parts = SHANGHAI_DATE_FORMATTER.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const year = value("year");
  const month = value("month");
  const day = value("day");
  return { dateKey: `${year}-${month}-${day}`, monthDay: `${month}-${day}` };
}

function insideSeasonalWindow(monthDay: string, window: SeasonalWindow): boolean {
  if (window.start <= window.end) return monthDay >= window.start && monthDay <= window.end;
  return monthDay >= window.start || monthDay <= window.end;
}

function trendIsActiveAt(
  item: TrendingItem,
  parts: { dateKey: string; monthDay: string },
): boolean {
  if (item.kind === "archive") return false;
  const { dateKey, monthDay } = parts;
  if (item.activeFrom && dateKey < item.activeFrom) return false;
  if (item.activeUntil && dateKey > item.activeUntil) return false;
  if (item.kind === "seasonal") {
    return Boolean(item.seasonalWindows?.some((window) => insideSeasonalWindow(monthDay, window)));
  }
  return true;
}

export function trendIsActive(item: TrendingItem, date = new Date()): boolean {
  return trendIsActiveAt(item, shanghaiDateParts(date));
}

function includesNormalized(topic: string, signal: string): boolean {
  return topic.toLocaleLowerCase("zh-CN").includes(signal.toLocaleLowerCase("zh-CN"));
}

function exactMention(item: TrendingItem, topic: string): boolean {
  return [item.term, ...(item.aliases ?? [])].some((term) => includesNormalized(topic, term));
}

function relevanceScore(item: TrendingItem, topic: string): number {
  if (item.avoidSignals?.some((signal) => includesNormalized(topic, signal))) return -Infinity;
  if (exactMention(item, topic)) return 100 + item.priority;
  const signalScore = item.signals.reduce(
    (score, signal) => score + (includesNormalized(topic, signal.text) ? signal.weight : 0),
    0,
  );
  return signalScore >= 4 ? signalScore + item.priority / 10 : -Infinity;
}

function stableTieBreak(topic: string, dateKey: string, id: string): number {
  const input = `${topic}\u0000${dateKey}\u0000${id}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function selectTrendingItems(
  rawTopic: string,
  date = new Date(),
  limit = 2,
): readonly TrendingItem[] {
  const topic = rawTopic.trim();
  if (!topic || limit <= 0) return [];

  if (isSensitiveRealWorldTopic(topic)) return [];

  const dateParts = shanghaiDateParts(date);
  const { dateKey } = dateParts;
  const ranked = TREND_LIBRARY
    .filter((item) => trendIsActiveAt(item, dateParts))
    .map((item) => ({
      item,
      score: relevanceScore(item, topic),
      tie: stableTieBreak(topic, dateKey, item.id),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score || b.item.priority - a.item.priority || a.tie - b.tie);

  const selected: TrendingItem[] = [];
  const families = new Set<string>();
  for (const entry of ranked) {
    if (families.has(entry.item.family)) continue;
    selected.push(entry.item);
    families.add(entry.item.family);
    if (selected.length >= Math.min(limit, 2)) break;
  }
  return selected;
}

/** Compact prompt appendix. No relevant item means no appendix and no token cost. */
export function trendingPromptSection(topic: string, date = new Date()): string {
  const selected = selectTrendingItems(topic, date);
  if (selected.length === 0) return "";
  return [
    "可选网络语境（最多借用一个；不用通常比硬塞更好）：",
    ...selected.map((item) => `- ${item.term}：${item.hint}`),
    "只在它与输入中的具体人、物或动作直接相关时使用；不得仅复述梗名，不解释出处，不改变原意或情绪方向。",
  ].join("\n");
}

export const TRENDING_TERMS: readonly string[] = TREND_LIBRARY.flatMap(
  (item) => [item.term, ...(item.aliases ?? [])],
);

/** Build-time editorial gate: current terms must be re-reviewed frequently. */
export const TREND_MAX_REVIEW_AGE_DAYS = 45;

export interface TrendLibraryHealth {
  activeCurrentIds: readonly string[];
  inactiveCurrentIds: readonly string[];
  staleCurrentIds: readonly string[];
}

export function trendLibraryHealth(date = new Date()): TrendLibraryHealth {
  const dateParts = shanghaiDateParts(date);
  const { dateKey } = dateParts;
  const today = Date.parse(`${dateKey}T00:00:00Z`);
  const currentItems = TREND_LIBRARY.filter((item) => item.kind === "current");
  const activeCurrentIds = currentItems
    .filter((item) => trendIsActiveAt(item, dateParts))
    .map((item) => item.id);
  const inactiveCurrentIds = currentItems
    .filter((item) => !trendIsActiveAt(item, dateParts))
    .map((item) => item.id);
  const staleCurrentIds = currentItems
    .filter((item) => {
      const reviewed = Date.parse(`${item.reviewedAt}T00:00:00Z`);
      return !Number.isFinite(reviewed)
        || (today - reviewed) / 86_400_000 > TREND_MAX_REVIEW_AGE_DAYS;
    })
    .map((item) => item.id);
  return { activeCurrentIds, inactiveCurrentIds, staleCurrentIds };
}
