import { cp, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platform = process.argv[2];
const testRoot = process.env.BLAHBLAH_SKILL_INSTALL_ROOT;
const roots = testRoot
  ? {
      codex: resolve(testRoot, "codex"),
      claude: resolve(testRoot, "claude"),
      openclaw: resolve(testRoot, "openclaw"),
    }
  : {
      codex: resolve(homedir(), ".agents/skills"),
      claude: resolve(homedir(), ".claude/skills"),
      openclaw: resolve(homedir(), ".openclaw/skills"),
    };
if (!roots[platform]) {
  console.error("Usage: node scripts/install.mjs codex|claude|openclaw");
  process.exit(1);
}

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(roots[platform], "blahblah-generator");
await mkdir(roots[platform], { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log(`Installed blahblah-generator for ${platform}: ${target}`);
