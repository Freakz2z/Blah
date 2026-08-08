import assert from "node:assert/strict";
import { test } from "node:test";
import { SentenceStore, SENTENCE_MAX_LENGTH } from "../toy-relay/src/sentence-store.ts";

/** Minimal stand-in for DurableObjectStorage. */
class MemoryStorage {
  constructor() {
    this.data = new Map();
  }

  async get(key) {
    return this.data.get(key);
  }

  async put(key, value) {
    this.data.set(key, value);
  }

  async list(options = {}) {
    const out = new Map();
    for (const [key, value] of this.data) {
      if (key.startsWith(options.prefix ?? "")) out.set(key, value);
    }
    return out;
  }
}

function makeStore() {
  const storage = new MemoryStorage();
  const store = new SentenceStore({ storage });
  return { store, storage };
}

function post(store, path, body) {
  return store.fetch(new Request(`https://relay-sentences${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

function submit(store, text, extra = {}) {
  return post(store, "/submit", { text, nickname: "张三", avatar: "//a", ...extra });
}

async function submitOk(store, text) {
  const response = await submit(store, text);
  assert.equal(response.status, 200);
  return (await response.json()).id;
}

async function board(store, window = "day") {
  const response = await store.fetch(
    new Request(`https://relay-sentences/leaderboard?window=${window}`),
  );
  assert.equal(response.status, 200);
  return (await response.json()).rows;
}

test("SentenceStore rejects malformed submissions and unknown routes", async () => {
  const { store } = makeStore();
  assert.equal((await submit(store, "")).status, 400);
  assert.equal((await submit(store, "字".repeat(SENTENCE_MAX_LENGTH + 1))).status, 400);
  assert.equal((await submit(store, "我想自杀")).status, 400); // unsafe
  const unknown = await store.fetch(new Request("https://relay-sentences/nope"));
  assert.equal(unknown.status, 404);
});

test("SentenceStore aggregates 1–5 ratings and ranks by average with vote tie-break", async () => {
  const { store } = makeStore();
  const idA = await submitOk(store, "周一在日历上连夜加班。");
  const idB = await submitOk(store, "减肥把体重秤调成了静音。");

  assert.equal((await post(store, "/rate", { id: idA, rating: 5 })).status, 200);
  assert.equal((await post(store, "/rate", { id: idA, rating: 3 })).status, 200);
  assert.equal((await post(store, "/rate", { id: idB, rating: 4 })).status, 200);
  assert.equal((await post(store, "/rate", { id: idB, rating: 4 })).status, 200);
  assert.equal((await post(store, "/rate", { id: idA, rating: 0 })).status, 400);
  assert.equal((await post(store, "/rate", { id: "missing", rating: 5 })).status, 404);

  const rows = await board(store);
  // A: (5+3)/2 = 4.0, B: (4+4)/2 = 4.0 → full tie → earlier submission first.
  assert.deepEqual(rows.map((row) => row.id), [idA, idB]);
  assert.equal(rows[0].rating, 4);
  assert.equal(rows[0].votes, 2);
  assert.equal(rows[0].nickname, "张三");
});

test("SentenceStore leaderboard filters by window and skips unrated sentences", async () => {
  const { store, storage } = makeStore();
  const id = await submitOk(store, "闹钟把早晨调成了静音。");
  await post(store, "/rate", { id, rating: 5 });

  // Unrated sentence stays hidden from the board.
  await submitOk(store, "没人评分的句子不该上榜。");
  assert.equal((await board(store, "day")).length, 1);

  // A stale entry (older than the day window but inside the month window) is
  // excluded from day and included in month — backdate it 10 days.
  const staleId = "stale1";
  storage.data.set(`sentence:${staleId}`, {
    id: staleId,
    text: "过期的句子",
    nickname: "张三",
    avatar: "",
    createdAt: Date.now() - 10 * 24 * 3600 * 1000,
    sum: 5,
    count: 1,
  });
  assert.equal((await board(store, "day")).length, 1);
  assert.equal((await board(store, "month")).length, 2);
});
