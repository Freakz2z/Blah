import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACHIEVEMENTS,
  achievementForValue,
  achievementProgress,
  newlyUnlockedAchievement,
  nextAchievementForValue,
} from "../toy/src/achievements.ts";

test("achievement thresholds stay ordered and cover the intended progression", () => {
  assert.deepEqual(
    ACHIEVEMENTS.map((achievement) => achievement.requiredValue),
    [1, 5, 20, 50, 100, 300],
  );
  assert.equal(new Set(ACHIEVEMENTS.map((achievement) => achievement.id)).size, 6);
  assert.equal(new Set(ACHIEVEMENTS.map((achievement) => achievement.imageUrl)).size, 6);
  assert.ok(ACHIEVEMENTS.every((achievement) => achievement.imageUrl.endsWith(".webp")));
});

test("achievementForValue and nextAchievementForValue meet at each threshold", () => {
  assert.equal(achievementForValue(0), null);
  assert.equal(nextAchievementForValue(0)?.title, "初次失真");
  assert.equal(achievementForValue(20)?.title, "语义漂移");
  assert.equal(nextAchievementForValue(20)?.title, "语言实验员");
  assert.equal(achievementForValue(999)?.title, "终身胡言");
  assert.equal(nextAchievementForValue(999), null);
});

test("progress is segment-based and reaches one at the final achievement", () => {
  assert.equal(achievementProgress(0), 0);
  assert.equal(achievementProgress(1), 0);
  assert.equal(achievementProgress(3), 0.5);
  assert.equal(achievementProgress(300), 1);
});

test("newlyUnlockedAchievement reports the highest crossed threshold", () => {
  assert.equal(newlyUnlockedAchievement(0, 1)?.title, "初次失真");
  assert.equal(newlyUnlockedAchievement(4, 5)?.title, "逻辑松动");
  assert.equal(newlyUnlockedAchievement(5, 19), null);
  assert.equal(newlyUnlockedAchievement(0, 50)?.title, "语言实验员");
});
