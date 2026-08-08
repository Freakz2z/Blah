import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scoreGeneratedText,
  validateGeneratedText,
} from "../shared/generate/quality.ts";
import {
  TRENDING_TERMS,
  selectTrendingItems,
} from "../shared/generate/trending.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(projectRoot, "tests/fixtures/live-generation-cases.json");
const endpoint = process.env.BLAHBLAH_EVAL_ENDPOINT ?? "https://api.freakz2z.com/generate";
const concurrency = Math.max(1, Math.min(Number(process.env.BLAHBLAH_EVAL_CONCURRENCY ?? 3), 6));
const outputArgIndex = process.argv.indexOf("--out");
const timestamp = new Date().toISOString();
const defaultOutput = resolve(
  projectRoot,
  "tmp/live-eval",
  `${timestamp.replaceAll(":", "-")}.json`,
);
const outputPath = outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
  ? resolve(process.argv[outputArgIndex + 1])
  : defaultOutput;

const cases = JSON.parse(await readFile(fixturePath, "utf8"));

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function termAppears(text, term) {
  return Boolean(text) && text.toLocaleLowerCase("zh-CN").includes(term.toLocaleLowerCase("zh-CN"));
}

async function evaluateCase(item) {
  const started = performance.now();
  let response;
  let body = null;
  let networkError = null;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://www.bilibili.com",
      },
      body: JSON.stringify({ topic: item.topic, mode: item.mode, length: item.length }),
      signal: AbortSignal.timeout(30_000),
    });
    body = await response.json().catch(() => null);
  } catch (error) {
    networkError = error instanceof Error ? error.message : String(error);
  }
  const latencyMs = Math.round(performance.now() - started);
  const text = typeof body?.text === "string" ? body.text : "";
  const selected = selectTrendingItems(item.topic, new Date());
  const selectedTerms = selected.map((trend) => trend.term);
  const usedSelectedTerms = selected
    .filter((trend) => [trend.term, ...(trend.aliases ?? [])].some((term) => termAppears(text, term)))
    .map((trend) => trend.term);
  const unselectedTrendTerms = TRENDING_TERMS.filter(
    (term) => !selectedTerms.includes(term)
      && !termAppears(item.topic, term)
      && termAppears(text, term),
  );
  const invalidReason = text
    ? validateGeneratedText(text, item.topic, "正常", item.length, item.mode)
    : "missing_text";
  const score = text
    ? scoreGeneratedText(text, item.topic, 0, item.length, item.mode)
    : null;

  return {
    ...item,
    httpStatus: response?.status ?? null,
    ok: response?.ok === true && Boolean(text),
    networkError,
    error: typeof body?.error === "string" ? body.error : null,
    latencyMs,
    text,
    mechanism: typeof body?.mechanism === "string" ? body.mechanism : body?.mechanism ?? null,
    qualityPath: typeof body?.qualityPath === "string" ? body.qualityPath : null,
    qualityScore: Number.isFinite(body?.qualityScore) ? body.qualityScore : null,
    invalidReason,
    score,
    selectedTerms,
    usedSelectedTerms,
    unselectedTrendTerms,
  };
}

const results = new Array(cases.length);
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
  for (;;) {
    const index = cursor++;
    if (index >= cases.length) return;
    results[index] = await evaluateCase(cases[index]);
    const result = results[index];
    console.log([
      result.id,
      `${result.latencyMs}ms`,
      result.ok ? "ok" : `failed:${result.httpStatus ?? result.networkError}`,
      result.invalidReason ?? "contract-pass",
      result.selectedTerms.length ? `selected=${result.selectedTerms.join(",")}` : "selected=none",
      result.usedSelectedTerms.length ? `used=${result.usedSelectedTerms.join(",")}` : "used=none",
      result.text,
    ].join("\t"));
  }
}));

const latencies = results.filter((item) => item.ok).map((item) => item.latencyMs);
const qualityScores = results
  .map((item) => item.qualityScore)
  .filter((score) => Number.isFinite(score));
const summary = {
  endpoint,
  generatedAt: timestamp,
  total: results.length,
  httpSuccess: results.filter((item) => item.ok).length,
  contractPass: results.filter((item) => item.ok && item.invalidReason === null).length,
  fallbackCount: results.filter((item) => item.mechanism === "兜底").length,
  repairCount: results.filter((item) => item.qualityPath === "repair").length,
  policyCount: results.filter((item) => item.qualityPath === "policy").length,
  qualityScore: {
    average: qualityScores.length
      ? Math.round(qualityScores.reduce((sum, value) => sum + value, 0) / qualityScores.length)
      : null,
    minimum: qualityScores.length ? Math.min(...qualityScores) : null,
  },
  trendEligible: results.filter((item) => item.selectedTerms.length > 0).length,
  trendUsed: results.filter((item) => item.usedSelectedTerms.length > 0).length,
  unselectedTrendLeak: results.filter((item) => item.unselectedTrendTerms.length > 0).length,
  latencyMs: {
    average: latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : null,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    maximum: latencies.length ? Math.max(...latencies) : null,
  },
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ summary, results }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ summary, outputPath }, null, 2));

if (summary.httpSuccess !== summary.total) process.exitCode = 1;
