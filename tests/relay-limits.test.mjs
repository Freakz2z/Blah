import assert from "node:assert/strict";
import { test } from "node:test";
import worker, {
  isLocalDevOrigin,
  originIsAllowed,
  parseJudgeChoice,
} from "../toy-relay/src/index.ts";

const EMPTY_ENV = {};

test("quality judge choices parse strictly inside the candidate range", () => {
  assert.equal(parseJudgeChoice("2", 3), 2);
  assert.equal(parseJudgeChoice('{"choice":1}', 3), 1);
  assert.equal(parseJudgeChoice("全部不合格，选择 0。", 3), 0);
  assert.equal(parseJudgeChoice("4", 3), null);
  assert.equal(parseJudgeChoice("第二个", 3), null);
});

test("local dev origins are allowed on the relay", () => {
  for (const origin of [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
  ]) {
    const request = new Request("https://relay/generate", {
      headers: { Origin: origin },
    });
    assert.equal(originIsAllowed(request, EMPTY_ENV), true, origin);
  }
});

test("non-local origins still need the whitelist", () => {
  assert.equal(isLocalDevOrigin("https://localhost:5173"), false);
  assert.equal(isLocalDevOrigin("http://evil.example"), false);
  assert.equal(isLocalDevOrigin("not-a-url"), false);

  const bilibili = new Request("https://relay/generate", {
    headers: { Origin: "https://www.bilibili.com" },
  });
  assert.equal(originIsAllowed(bilibili, EMPTY_ENV), true);

  const evil = new Request("https://relay/generate", {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(originIsAllowed(evil, EMPTY_ENV), false);
});

test("requests without an Origin header stay allowed", () => {
  const request = new Request("https://relay/generate");
  assert.equal(originIsAllowed(request, EMPTY_ENV), true);
});

test("OPTIONS preflight from a local origin gets CORS headers back", async () => {
  const response = await worker.fetch(
    new Request("https://relay/generate", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
      },
    }),
    EMPTY_ENV,
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
});

test("evil origin is rejected even on preflight", async () => {
  const response = await worker.fetch(
    new Request("https://relay/generate", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    }),
    EMPTY_ENV,
  );
  assert.equal(response.status, 403);
});
