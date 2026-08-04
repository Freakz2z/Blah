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
  assert.match(html, /settings-toggle/);
  assert.match(html, /aria-controls="settings-panel"/);
  assert.match(html, /id="settings-panel"/);
  assert.match(html, /主题设置/);
  assert.doesNotMatch(html, /模式设置/);
  assert.doesNotMatch(html, /theme-toggle/);
  assert.doesNotMatch(html, /翻译你的话，或者认真回答它。/);

  // Mode controls
  assert.match(html, /生成模式/);
  assert.match(html, /翻译/);
  assert.match(html, /回答/);
  assert.doesNotMatch(html, /把原话变成?胡话/);
  assert.doesNotMatch(html, /用胡话(?:回答|作答)/);

  // Text input
  assert.match(html, /<label\s[^>]*for="topic"[^>]*>/i);
  assert.match(html, /id="topic"/);
  assert.match(html, /placeholder="输入一句话"/);

  // Char count — RSC wraps text segments with comment markers
  assert.match(html, /0<!.*?\/.*?30</);

  // Mental-state controls were deliberately removed from the product UI.
  assert.doesNotMatch(html, /精神状态|mood-options|mood-option|mood-/);
  assert.doesNotMatch(html, /钝角/);
  assert.doesNotMatch(html, /最差/);

  // Generation-length controls
  assert.match(html, /生成长度/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /role="radio"/);
  assert.match(html, /精辟/);
  assert.match(html, /中等/);

  // Primary button
  assert.match(html, /开始翻译/);

  // Result section
  assert.match(html, /等一句没有用的话/);
  assert.match(html, /共生成/);
  assert.doesNotMatch(html, /句胡言乱语/);
  assert.doesNotMatch(html, /人用过/);

  assert.doesNotMatch(html, /mood-track/);

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
  assert.doesNotMatch(page, /胡得太勤|再胡一次|没胡出来|先不胡|校对胡言乱语/);
  assert.match(page, /重新生成/);
  const mainStart = page.indexOf('className="main-content"');
  const primaryButton = page.indexOf("Primary button", mainStart);
  const mainControls = page.slice(mainStart, primaryButton);
  assert.match(mainControls, /main-options/);
  assert.match(mainControls, /mode-block/);
  assert.match(mainControls, /length-block/);
  assert.doesNotMatch(mainControls, /mood-block|theme-block/);

  // Layout is clean — no skeleton references
  assert.match(layout, /胡言乱语生成器/);
  assert.doesNotMatch(layout, /_sites-preview/);
  assert.doesNotMatch(layout, /react-loading-skeleton/);
  assert.match(layout, /export const viewport/);

  // Global CSS is custom, not tailwind-only
  const cssContent = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(cssContent, /胡言乱语/);
  assert.match(cssContent, /\.app-shell/);
  assert.match(cssContent, /\.result-section/);
  assert.match(cssContent, /\.primary-button/);
  assert.match(cssContent, /\.main-options/);
  assert.match(cssContent, /\.mode-block/);
  assert.match(cssContent, /\.length-block/);
  assert.doesNotMatch(cssContent, /\.mood-/);
  assert.match(cssContent, /prefers-reduced-motion/);
  assert.match(cssContent, /prefers-color-scheme:\s*dark/);
});
