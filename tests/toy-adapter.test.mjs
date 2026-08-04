import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { generateStandaloneText } from "../app/toy-local-generator.ts";

const root = new URL("../", import.meta.url);

test("Toy adapter is a static standalone bundle", async () => {
  const html = await readFile(new URL("toy/index.html", root), "utf8");
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  const localGenerator = await readFile(new URL("app/toy-local-generator.ts", root), "utf8");
  const config = await readFile(new URL("toy/vite.config.ts", root), "utf8");

  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /src="\.\/main\.tsx"/);
  assert.match(html, /__BLAHBLAH_STANDALONE_TOY__\s*=\s*true/);
  assert.match(html, /__BLAHBLAH_TOY_RELAY_URL__\s*=\s*"https:\/\/api\.freakz2z\.com"/);
  assert.doesNotMatch(html, /blah\.freakz2z\.com/);
  assert.match(page, /fetch\(`\$\{relay\}\/generate`/);
  assert.match(page, /generateStandaloneText\(clean, mode, generationLength\)/);
  assert.match(localGenerator, /fallbackForLength/);
  assert.match(config, /base:\s*["']\.\/["']/);
  assert.match(config, /dist\/toy/);

  const distRoot = new URL("dist/toy/", root);
  const distEntries = await readdir(distRoot, { recursive: true });
  const runtimeFiles = distEntries.filter((entry) => /\.(?:html|js|css)$/i.test(entry));
  assert.ok(runtimeFiles.length > 0, "Toy production files are missing");
    for (const entry of runtimeFiles) {
    const content = await readFile(new URL(entry, distRoot), "utf8");
    assert.doesNotMatch(content, /blah\.freakz2z\.com/);
    assert.doesNotMatch(content, /DEEPSEEK_API_KEY|Authorization\s*:/);
  }
});

test("local Toy compatibility fallback remains provider-free and safe", () => {
  assert.equal(
    generateStandaloneText("我今天不想上班", "翻译", "精辟"),
    "工位替我上班。",
  );
  for (const [mode, topic] of [
    ["翻译", "外面下雨了，我忘记带伞。"],
    ["回答", "为什么我的电脑总是卡住"],
  ]) {
    for (const length of ["精辟", "中等", "正常"]) {
      const text = generateStandaloneText(topic, mode, length);
      assert.ok(text.length > 0);
      assert.doesNotMatch(text, /自杀|自残|杀人|色情|黑客攻击/u);
    }
  }
  assert.throws(
    () => generateStandaloneText("我想自杀", "翻译", "正常"),
    /unsafe_topic/,
  );
});
