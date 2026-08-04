import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

test("Toy adapter exposes a static root and the production API base", async () => {
  const html = await readFile(new URL("toy/index.html", root), "utf8");
  const config = await readFile(new URL("toy/vite.config.ts", root), "utf8");

  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /src="\.\/main\.tsx"/);
  assert.match(html, /__BLAHBLAH_API_BASE__\s*=\s*"https:\/\/blah\.freakz2z\.com"/);
  assert.match(config, /base:\s*["']\.\/["']/);
  assert.match(config, /dist\/toy/);
});
