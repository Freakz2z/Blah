import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORY_LIMIT,
  parseHistory,
  prependHistory,
  serializeHistory,
} from "../app/history.ts";

const item = (id) => ({
  id,
  createdAt: 1_700_000_000_000,
  topic: `输入${id}`,
  text: `结果${id}。`,
  mode: "翻译",
  length: "正常",
});

test("history parser ignores malformed browser data", () => {
  assert.deepEqual(parseHistory("not-json"), []);
  assert.deepEqual(parseHistory(JSON.stringify([item("ok"), { id: "bad" }])), [item("ok")]);
});

test("history serialization and prepend keep newest 20 records", () => {
  const records = Array.from({ length: HISTORY_LIMIT }, (_, index) => item(String(index)));
  const next = prependHistory(records, item("new"));
  assert.equal(next.length, HISTORY_LIMIT);
  assert.equal(next[0].id, "new");
  assert.equal(next.at(-1).id, String(HISTORY_LIMIT - 2));
  assert.deepEqual(parseHistory(serializeHistory(next)), next);
});
