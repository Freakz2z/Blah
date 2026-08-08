import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEADERBOARD_BOARD,
  LEADERBOARD_PERIODS,
  fetchLeaderboard,
  submitLeaderboardScore,
} from "../toy/src/leaderboard.ts";

const ROWS = [
  { rank: 1, score: 100, nickname: "第一名", avatar: "//p0.hdslb.com/a.png" },
  { rank: 2, score: 42, nickname: "第二名", avatar: "//p0.hdslb.com/b.png" },
];

function makeSdk({ mine = { ranked: true, rank: 2, score: 42 } } = {}) {
  return {
    submitted: [],
    async submitScore(req) {
      this.submitted.push(req);
      return { score: req.score };
    },
    async getRankList(req) {
      this.rankListReq = req;
      return ROWS;
    },
    async getMyRank() {
      if (mine === null) throw new Error("unauthorized");
      return mine;
    },
  };
}

test("fetchLeaderboard passes the period through and returns list + my rank", async () => {
  const sdk = makeSdk();
  const snapshot = await fetchLeaderboard("day", 10, sdk);
  assert.equal(snapshot.list, ROWS);
  assert.deepEqual(snapshot.mine, { ranked: true, rank: 2, score: 42 });
  assert.deepEqual(sdk.rankListReq, {
    board: LEADERBOARD_BOARD,
    period: "day",
    limit: 10,
  });
});

test("fetchLeaderboard defaults to the week period", async () => {
  const sdk = makeSdk();
  await fetchLeaderboard(undefined, 10, sdk);
  assert.equal(sdk.rankListReq.period, "week");
});

test("every advertised period is a real SDK period", () => {
  const values = LEADERBOARD_PERIODS.map((entry) => entry.value);
  assert.deepEqual(values, ["all", "month", "week", "day"]);
});

test("fetchLeaderboard tolerates a failing getMyRank but keeps the list", async () => {
  const sdk = makeSdk({ mine: null });
  const snapshot = await fetchLeaderboard("week", 10, sdk);
  assert.equal(snapshot.list, ROWS);
  assert.equal(snapshot.mine, null);
});

test("fetchLeaderboard returns null without a SDK or on board failure", async () => {
  assert.equal(await fetchLeaderboard("week", 10, null), null);
  const broken = {
    async getRankList() {
      throw new Error("service down");
    },
    async getMyRank() {
      throw new Error("nope");
    },
  };
  assert.equal(await fetchLeaderboard("week", 10, broken), null);
});

test("fetchLeaderboard times out instead of hanging the rank tab", async () => {
  const hanging = {
    async getRankList() {
      return new Promise(() => {}); // never settles
    },
    async getMyRank() {
      throw new Error("unauthorized");
    },
  };
  assert.equal(await fetchLeaderboard("week", 10, hanging, 20), null);
});

test("submitLeaderboardScore submits the absolute score and swallows failures", async () => {
  const sdk = makeSdk();
  await submitLeaderboardScore(7, sdk);
  assert.deepEqual(sdk.submitted, [{ board: 1, score: 7 }]);

  const broken = {
    async submitScore() {
      throw new Error("not logged in");
    },
  };
  await submitLeaderboardScore(9, broken); // must not throw
  await submitLeaderboardScore(9, null); // must not throw
});
