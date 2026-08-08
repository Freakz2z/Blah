import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEGACY_COUNT_KEY,
  NONSENSE_VALUE_KEY,
  loadNonsenseValueCloud,
  saveNonsenseValueCloud,
} from "../toy/src/preferences.ts";

test("胡言乱语值优先读取新 KV，并可从旧生成数迁移", async () => {
  const sdk = {
    async getCloudStorage(keys) {
      assert.deepEqual(keys, [NONSENSE_VALUE_KEY, LEGACY_COUNT_KEY]);
      return { [NONSENSE_VALUE_KEY]: "23", [LEGACY_COUNT_KEY]: "99" };
    },
    async setCloudStorage() {},
  };
  assert.equal(await loadNonsenseValueCloud(sdk), 23);

  sdk.getCloudStorage = async () => ({ [LEGACY_COUNT_KEY]: "17" });
  assert.equal(await loadNonsenseValueCloud(sdk), 17);
});

test("非法 KV 静默降级，写入只使用胡言乱语值键", async () => {
  const writes = [];
  const sdk = {
    async getCloudStorage() {
      return { [NONSENSE_VALUE_KEY]: "-2", [LEGACY_COUNT_KEY]: "not-a-number" };
    },
    async setCloudStorage(items) {
      writes.push(items);
    },
  };
  assert.equal(await loadNonsenseValueCloud(sdk), null);
  await saveNonsenseValueCloud(42, sdk);
  assert.deepEqual(writes, [{ [NONSENSE_VALUE_KEY]: "42" }]);
  await saveNonsenseValueCloud(42, null);
});
