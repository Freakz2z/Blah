/**
 * 胡言乱语值与成就规则。
 *
 * 该值同时是 KV 中的用户进度、排行榜分数和成就判定依据。门槛刻意前密后疏，
 * 让新用户能很快拿到第一枚勋章，同时保留长期目标。
 */

export interface Achievement {
  id: string;
  title: string;
  requiredValue: number;
  description: string;
  imageUrl: string;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: "first-distortion",
    title: "初次失真",
    requiredValue: 1,
    description: "现实第一次被你说得有点不对劲。",
    imageUrl: new URL("../assets/achievements/first-distortion.webp", import.meta.url).href,
  },
  {
    id: "logic-loose",
    title: "逻辑松动",
    requiredValue: 5,
    description: "你的因果关系开始学会自由活动。",
    imageUrl: new URL("../assets/achievements/logic-loose.webp", import.meta.url).href,
  },
  {
    id: "semantic-drift",
    title: "语义漂移",
    requiredValue: 20,
    description: "句子还在原地，意思已经出发。",
    imageUrl: new URL("../assets/achievements/semantic-drift.webp", import.meta.url).href,
  },
  {
    id: "language-researcher",
    title: "语言实验员",
    requiredValue: 50,
    description: "获准在常识边缘进行小规模试验。",
    imageUrl: new URL("../assets/achievements/language-researcher.webp", import.meta.url).href,
  },
  {
    id: "reality-editor",
    title: "现实改写者",
    requiredValue: 100,
    description: "现实递交了修订意见，你选择全部拒收。",
    imageUrl: new URL("../assets/achievements/reality-editor.webp", import.meta.url).href,
  },
  {
    id: "lifetime-nonsense",
    title: "终身胡言",
    requiredValue: 300,
    description: "无需证明什么，语言已经开始证明你。",
    imageUrl: new URL("../assets/achievements/lifetime-nonsense.webp", import.meta.url).href,
  },
] as const;

export function achievementForValue(value: number): Achievement | null {
  let current: Achievement | null = null;
  for (const achievement of ACHIEVEMENTS) {
    if (value < achievement.requiredValue) break;
    current = achievement;
  }
  return current;
}

export function nextAchievementForValue(value: number): Achievement | null {
  return ACHIEVEMENTS.find((achievement) => value < achievement.requiredValue) ?? null;
}

export function achievementProgress(value: number): number {
  const current = achievementForValue(value);
  const next = nextAchievementForValue(value);
  if (!next) return 1;
  const floor = current?.requiredValue ?? 0;
  return Math.max(0, Math.min(1, (value - floor) / (next.requiredValue - floor)));
}

export function newlyUnlockedAchievement(
  previousValue: number,
  nextValue: number,
): Achievement | null {
  const unlocked = ACHIEVEMENTS.filter(
    (achievement) =>
      achievement.requiredValue > previousValue && achievement.requiredValue <= nextValue,
  );
  return unlocked.at(-1) ?? null;
}
