import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchSentenceBoard,
  rateSentence,
  submitSentence,
} from "../toy/src/sentences.ts";

const ROWS = [{ id: "a1", text: "周一在日历上连夜加班。", nickname: "张三", avatar: "//a", rating: 4.5, votes: 2 }];

test("fetchSentenceBoard reads the quality board for a window", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ rows: ROWS }), { status: 200 });
  };
  try {
    const rows = await fetchSentenceBoard("day", "https://relay");
    assert.deepEqual(rows, ROWS);
    assert.match(calls[0], /\/sentences\/leaderboard\?window=day&limit=50/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchSentenceBoard returns null on failure or without a relay", async () => {
  assert.equal(await fetchSentenceBoard("week", ""), null);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  try {
    assert.equal(await fetchSentenceBoard("week", "https://relay"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitSentence posts text + display profile and reports success", async () => {
  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, id: "x1" }), { status: 200 });
  };
  try {
    const ok = await submitSentence("周一在日历上连夜加班。", { nickname: "张三", avatar: "//a" }, "https://relay");
    assert.equal(ok, true);
    assert.equal(seen[0].url, "https://relay/sentences");
    assert.deepEqual(seen[0].body, { text: "周一在日历上连夜加班。", nickname: "张三", avatar: "//a" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitSentence and rateSentence fail silently without a relay", async () => {
  assert.equal(await submitSentence("一句话", null, ""), false);
  assert.equal(await rateSentence("a1", 5, ""), false);
  assert.equal(await rateSentence("a1", 6, "https://relay"), false); // out of range
});
