import assert from "node:assert/strict";
import test from "node:test";

import {
  HISTORY_LIMIT,
  prependHistory,
} from "../toy/src/history.ts";

const item = (id) => ({
  id,
  createdAt: 1_700_000_000_000,
  topic: `输入${id}`,
  text: `结果${id}。`,
  mode: "翻译",
  length: "正常",
});

test("prependHistory keeps the newest 20 records and dedups by id", () => {
  const records = Array.from({ length: HISTORY_LIMIT }, (_, index) => item(String(index)));
  const next = prependHistory(records, item("new"));
  assert.equal(next.length, HISTORY_LIMIT);
  assert.equal(next[0].id, "new");
  assert.equal(next.at(-1).id, String(HISTORY_LIMIT - 2));

  const replaced = prependHistory(next, item("new"));
  assert.equal(replaced.filter((record) => record.id === "new").length, 1);
});
