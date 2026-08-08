import test from "node:test";
import assert from "node:assert/strict";

import {
  TREND_MAX_REVIEW_AGE_DAYS,
  selectTrendingItems,
  trendLibraryHealth,
  trendingPromptSection,
} from "../shared/generate/trending.ts";

const REVIEW_DAY = new Date("2026-08-08T04:00:00Z");

const CASES = [
  { topic: "这个测试结果是真是假，帮我核对一下", include: ["我要验牌"] },
  { topic: "审核的时候再确认一遍证据", include: ["我要验牌"] },
  { topic: "部署一个AI智能体到服务器", include: ["养龙虾"] },
  { topic: "OpenClaw自动化助手又掉线了", include: ["养龙虾"] },
  { topic: "朋友帮了我，我想好好回报他", include: ["雪山救狐狸"] },
  { topic: "我在雪山救了一只狐狸", include: ["雪山救狐狸"] },
  { topic: "这只拟人水果在AI视频里参加恋爱综艺", include: ["AI水果"] },
  { topic: "周一通勤上班，刚坐到工位就累了", include: ["班味"] },
  { topic: "群聊里看见消息却一直答非所问", include: ["已读乱回"] },
  { topic: "我悄悄把零食藏进抽屉，莫名心虚", include: ["偷感"] },
  { topic: "这个视频太上头了，我刷得停不下来", include: ["硬控"] },
  { topic: "夏天高温，空调也救不了我", include: ["三伏天"] },
  { topic: "暑假作业还没写完就要返校", include: ["开学"] },
  { topic: "我想学习二叉树的层序遍历", exact: [] },
  { topic: "今天做了番茄炒蛋", exact: [] },
  { topic: "晚上去吃小龙虾和海鲜", exclude: ["养龙虾"] },
  { topic: "考试时怎么作弊验牌", exclude: ["我要验牌"] },
  { topic: "有人偷拍和偷窥，偷感很重", exclude: ["偷感"] },
  { topic: "他用控制欲胁迫我", exclude: ["硬控"] },
  { topic: "朋友出车祸正在医院抢救", exact: [] },
  { topic: "地震灾区需要帮助和救援", exact: [] },
];

test("curated relevance matrix keeps meme injection precise", () => {
  for (const item of CASES) {
    const terms = selectTrendingItems(item.topic, REVIEW_DAY).map((trend) => trend.term);
    for (const term of item.include ?? []) {
      assert.ok(terms.includes(term), `${JSON.stringify(item.topic)} should include ${term}; got ${terms}`);
    }
    for (const term of item.exclude ?? []) {
      assert.ok(!terms.includes(term), `${JSON.stringify(item.topic)} should exclude ${term}; got ${terms}`);
    }
    if (item.exact) assert.deepEqual(terms, item.exact, `${JSON.stringify(item.topic)} should match exactly`);
  }
});

test("prompt appendix never exposes editorial metadata or more than two terms", () => {
  for (const item of CASES) {
    const selected = selectTrendingItems(item.topic, REVIEW_DAY);
    const prompt = trendingPromptSection(item.topic, REVIEW_DAY);
    assert.ok(selected.length <= 2);
    assert.ok(!prompt.includes("reviewedAt"));
    assert.ok(!prompt.includes("http"));
    if (selected.length === 0) assert.equal(prompt, "");
  }
});

test(`live current library passes the ${TREND_MAX_REVIEW_AGE_DAYS}-day editorial freshness gate`, () => {
  const health = trendLibraryHealth(new Date());
  assert.ok(health.activeCurrentIds.length >= 3, "fewer than three current terms remain active");
  assert.deepEqual(health.inactiveCurrentIds, [], "current terms expired; archive or refresh them");
  assert.deepEqual(health.staleCurrentIds, [], "current terms need editorial re-review");
});
