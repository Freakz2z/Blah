import assert from "node:assert/strict";
import { test } from "node:test";
import { VoteStore } from "../toy-relay/src/vote-store.ts";

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
  const store = new VoteStore({ storage });
  return { store, storage };
}

function record(store, mechanism, vote) {
  return store.fetch(new Request("https://relay-votes/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mechanism, vote }),
  }));
}

function scores(store) {
  return store
    .fetch(new Request("https://relay-votes/scores"))
    .then((response) => response.json())
    .then((data) => data.scores);
}

test("VoteStore rejects malformed votes and unknown routes", async () => {
  const { store } = makeStore();

  const empty = await record(store, "", 1);
  assert.equal(empty.status, 400);

  const badVote = await record(store, "错误因果", 0);
  assert.equal(badVote.status, 400);

  const badBody = await store.fetch(new Request("https://relay-votes/record", {
    method: "POST",
    body: "not-json",
  }));
  assert.equal(badBody.status, 400);

  const unknown = await store.fetch(new Request("https://relay-votes/nope"));
  assert.equal(unknown.status, 404);
});

test("VoteStore aggregates votes and reports Laplace-smoothed scores", async () => {
  const { store, storage } = makeStore();

  assert.equal((await record(store, "错误因果", 1)).status, 200);
  assert.equal((await record(store, "错误因果", 1)).status, 200);
  assert.equal((await record(store, "错误因果", -1)).status, 200);
  assert.equal((await record(store, "目的倒置", -1)).status, 200);
  assert.equal((await record(store, "兜底", -1)).status, 200);

  const result = await scores(store);
  // 2 up / 1 down → (2+1)/(2+1+2) = 0.6
  assert.equal(result["错误因果"], 0.6);
  // 0 up / 1 down → 1/3
  assert.ok(Math.abs(result["目的倒置"] - 1 / 3) < 1e-9);
  // Never-voted mechanisms are absent — the relay treats them as neutral weight 1.
  assert.equal(result["细节篡位"], undefined);
  assert.equal(Object.keys(result).length, 3);

  // Only counts are stored — never any user text.
  const keys = [...storage.data.keys()];
  assert.equal(keys.length, 3, `expected 3 mechanism keys, got ${keys.length}`);
  for (const key of keys) {
    assert.ok(key.startsWith("mechanism:"), `unexpected storage key ${key}`);
  }
});

test("VoteStore keeps a single upvote from locking a mechanism in", async () => {
  const { store } = makeStore();
  await record(store, "字面误解", 1);
  const result = await scores(store);
  // (1+1)/(1+0+2) = 2/3 — one fan vote alone stays short of the ceiling.
  assert.ok(Math.abs(result["字面误解"] - 2 / 3) < 1e-9);
});
