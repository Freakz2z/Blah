import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the nonsense generator page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();

  // Title and metadata
  assert.match(html, /<title>胡言乱语生成器<\/title>/i);
  assert.match(html, /胡言乱语生成器/);

  // Header
  assert.match(html, /theme-toggle/);

  // Mode controls
  assert.match(html, /生成模式/);
  assert.match(html, /翻译/);
  assert.match(html, /回答/);
  assert.match(html, /把原话变胡话/);
  assert.match(html, /用胡话作答/);

  // Text input
  assert.match(html, /<label\s[^>]*for="topic"[^>]*>/i);
  assert.match(html, /id="topic"/);
  assert.match(html, /placeholder="输入一句话"/);

  // Char count — RSC wraps text segments with comment markers
  assert.match(html, /0<!.*?\/.*?30</);

  // Mood slider — 3 states
  assert.match(html, /role="slider"/);
  assert.match(html, /aria-valuetext/);
  assert.match(html, /极差/);
  assert.match(html, /差/);
  assert.match(html, /正常/);
  assert.doesNotMatch(html, /钝角/);
  assert.doesNotMatch(html, /最差/);
  assert.match(html, /aria-valuenow="2"/);

  // Generation-length controls
  assert.match(html, /生成长度/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /role="radio"/);
  assert.match(html, /精辟/);
  assert.match(html, /中等/);

  // Mood label

  // Primary button
  assert.match(html, /开始翻译/);

  // Result section
  assert.match(html, /等一句没有用的话/);

  // Mood slider track
  assert.match(html, /mood-track/);

  // No skeleton / AI demo patterns
  assert.doesNotMatch(html, /react-loading-skeleton/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /Building your site/);
  assert.doesNotMatch(html, /AI 驱动/);
  assert.doesNotMatch(html, /释放你的创造力/);
  assert.doesNotMatch(html, /释放创造力/);
  assert.doesNotMatch(html, /探索无限/);
  assert.doesNotMatch(html, /下一代体验/);
  assert.doesNotMatch(html, /chatbot/i);
  assert.doesNotMatch(html, /chat-bubble/i);
});

test("keeps the preview skeleton scoped and disposable", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  // Page is the real app, not a skeleton
  assert.match(page, /胡言乱语生成器/);
  assert.match(page, /"use client"/);
  assert.doesNotMatch(page, /SkeletonPreview/);

  // Layout is clean — no skeleton references
  assert.match(layout, /胡言乱语生成器/);
  assert.doesNotMatch(layout, /_sites-preview/);
  assert.doesNotMatch(layout, /react-loading-skeleton/);
  assert.match(layout, /export const viewport/);

  // Global CSS is custom, not tailwind-only
  const cssContent = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(cssContent, /胡言乱语/);
  assert.match(cssContent, /\.app-shell/);
  assert.match(cssContent, /\.mood-/);
  assert.match(cssContent, /\.result-section/);
  assert.match(cssContent, /\.primary-button/);
  assert.match(cssContent, /\.mood-track/);
  assert.match(cssContent, /prefers-reduced-motion/);
  assert.match(cssContent, /prefers-color-scheme:\s*dark/);
});
