import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOUD_HISTORY_KEY_PREFIX,
  CLOUD_LOAD_TIMEOUT_MS,
  cloudHistoryKey,
  cloudKeysToRemove,
  cloudRecordToHistory,
  historyToCloudRecord,
  loadCloudHistory,
  persistCloudHistory,
} from "../toy/src/cloud-history.ts";
import {
  HISTORY_LIMIT,
  mergeHistory,
  parseHistoryEntry,
} from "../toy/src/history.ts";

function entry(overrides = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    createdAt: 1723000000000,
    topic: "考研",
    text: "考研的本质是给未来的自己排一个看不见的队伍。",
    mode: "翻译",
    length: "正常",
    mechanism: "错误因果",
    ...overrides,
  };
}

function makeCloudSdk() {
  const data = new Map();
  return {
    data,
    sdk: {
      async getCloudStorage(keys) {
        if (keys && keys.length > 0) {
          const out = {};
          for (const key of keys) if (data.has(key)) out[key] = data.get(key);
          return out;
        }
        return Object.fromEntries(data);
      },
      async setCloudStorage(items) {
        for (const [key, value] of Object.entries(items)) data.set(key, value);
      },
      async removeCloudStorage(keys) {
        for (const key of keys) data.delete(key);
      },
    },
  };
}

test("historyToCloudRecord keeps newest-first slots capped at HISTORY_LIMIT", () => {
  const items = Array.from({ length: 25 }, (_, i) => entry({ id: `id-${i}` }));
  const record = historyToCloudRecord(items);
  const slots = Object.keys(record);
  assert.equal(slots.length, HISTORY_LIMIT);
  assert.deepEqual(slots.slice(0, 3), ["h-0", "h-1", "h-2"]);
  // Newest (index 0) sits at h-0.
  assert.equal(parseHistoryEntry(record["h-0"]).id, "id-0");
  assert.equal(parseHistoryEntry(record[`h-${HISTORY_LIMIT - 1}`]).id, `id-${HISTORY_LIMIT - 1}`);
});

test("cloud round-trip preserves order and fields", () => {
  const items = [entry({ text: "第一句" }), entry({ id: "id-2", text: "第二句" })];
  const back = cloudRecordToHistory(historyToCloudRecord(items));
  assert.equal(back.length, 2);
  assert.deepEqual(back, items);
});

test("oversized legacy entries are skipped for the cloud but keep order", () => {
  const huge = entry({ text: "很".repeat(300) }); // ~900+ bytes UTF-8
  const items = [huge, entry({ id: "id-ok", text: "正常长度" })];
  const record = historyToCloudRecord(items);
  // Huge entry dropped; the kept entry re-slots to h-0, no gap.
  assert.equal(Object.keys(record).length, 1);
  assert.equal(parseHistoryEntry(record["h-0"]).id, "id-ok");
});

test("cloudRecordToHistory sorts by slot and tolerates gaps and junk keys", () => {
  const record = {
    "h-2": JSON.stringify(entry({ id: "oldest" })),
    "h-0": JSON.stringify(entry({ id: "newest" })),
    "platform:reserved": "ignored",
    "h-xx": "ignored",
    "h-1": "not-json",
  };
  const items = cloudRecordToHistory(record);
  assert.deepEqual(
    items.map((item) => item.id),
    ["newest", "oldest"],
  );
});

test("cloudRecordToHistory stops at HISTORY_LIMIT", () => {
  const record = {};
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    record[cloudHistoryKey(i)] = JSON.stringify(entry({ id: `id-${i}` }));
  }
  assert.equal(cloudRecordToHistory(record).length, HISTORY_LIMIT);
});

test("cloudKeysToRemove trims slots beyond the new record", () => {
  const record = historyToCloudRecord([entry()]); // 1 slot
  assert.deepEqual(cloudKeysToRemove(record, 4), ["h-1", "h-2", "h-3"]);
  assert.deepEqual(cloudKeysToRemove(record, 1), []);
  assert.deepEqual(cloudKeysToRemove(record, 0), []);
});

test("persistCloudHistory upserts, trims orphans, and reports slot count", async () => {
  const { data, sdk } = makeCloudSdk();
  const first = [entry({ id: "a" }), entry({ id: "b" })];
  const slots1 = await persistCloudHistory(first, 0, sdk);
  assert.equal(slots1, 2);
  assert.equal(data.get("h-0"), JSON.stringify(first[0]));

  // Shrink to one entry: h-1 must be removed.
  const slots2 = await persistCloudHistory([entry({ id: "a" })], slots1, sdk);
  assert.equal(slots2, 1);
  assert.ok(data.has("h-0"));
  assert.ok(!data.has("h-1"));
});

test("persistCloudHistory and loadCloudHistory degrade silently without a SDK", async () => {
  assert.equal(await persistCloudHistory([entry()], 3, null), 3);
  assert.equal(await loadCloudHistory(null), null);
});

test("persistCloudHistory failure keeps previous slot count", async () => {
  const broken = {
    async setCloudStorage() {
      throw new Error("not logged in");
    },
    async removeCloudStorage() {
      throw new Error("nope");
    },
  };
  assert.equal(await persistCloudHistory([entry()], 7, broken), 7);
});

test("loadCloudHistory reads slots back as newest-first entries", async () => {
  const { data, sdk } = makeCloudSdk();
  data.set("h-0", JSON.stringify(entry({ id: "newest" })));
  data.set("h-1", JSON.stringify(entry({ id: "oldest" })));
  data.set("unrelated", "ignored");
  const items = await loadCloudHistory(sdk);
  assert.deepEqual(
    items.map((item) => item.id),
    ["newest", "oldest"],
  );
});

test("loadCloudHistory failure returns null so the caller can fall back", async () => {
  const broken = {
    async getCloudStorage() {
      throw new Error("unauthorized");
    },
  };
  assert.equal(await loadCloudHistory(broken), null);
});

test("an empty cloud record is authoritative-empty, not a failure", async () => {
  const { data, sdk } = makeCloudSdk(); // no keys written
  const items = await loadCloudHistory(sdk);
  assert.deepEqual(items, []);
  // Distinguish from the null-on-failure contract that triggers the fallback.
  assert.notEqual(items, null);
});

test("loadCloudHistory times out instead of hanging the fallback", async () => {
  const hanging = {
    getCloudStorage() {
      return new Promise(() => {}); // never settles
    },
  };
  assert.equal(await loadCloudHistory(hanging, 20), null);
  assert.equal(CLOUD_LOAD_TIMEOUT_MS > 0, true);
});

test("key format stays inside the SDK contract [a-zA-Z0-9_-]", () => {
  for (let i = 0; i < 20; i++) {
    const key = cloudHistoryKey(i);
    assert.match(key, /^[a-zA-Z0-9_-]+$/);
    assert.equal(key.startsWith(CLOUD_HISTORY_KEY_PREFIX), true);
  }
});

test("mergeHistory keeps entries generated during load ahead of the loaded list", () => {
  const fresh = entry({ id: "gen-during-load", text: "加载期间生成的" });
  const loaded = [entry({ id: "cloud-newest" }), entry({ id: "cloud-older" })];
  const merged = mergeHistory([fresh], loaded);
  assert.deepEqual(
    merged.map((item) => item.id),
    ["gen-during-load", "cloud-newest", "cloud-older"],
  );
});

test("mergeHistory dedups by id and caps at HISTORY_LIMIT", () => {
  const loaded = Array.from({ length: HISTORY_LIMIT }, (_, i) => entry({ id: `c-${i}` }));
  const merged = mergeHistory([loaded[0], loaded[1]], loaded); // duplicates
  assert.equal(merged.length, HISTORY_LIMIT);
  assert.equal(new Set(merged.map((item) => item.id)).size, merged.length);
});
