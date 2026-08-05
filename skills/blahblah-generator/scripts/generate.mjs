const args = process.argv.slice(2);
const options = { mode: "翻译", mood: "正常", length: "正常" };
const input = [];

for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === "--mode" || key === "--mood" || key === "--length") {
    options[key.slice(2)] = args[++i];
  } else {
    input.push(key);
  }
}

const topic = input.join(" ").trim();
if (!topic) {
  console.error(
    'Usage: node scripts/generate.mjs [--mode 翻译|回答] [--mood 正常|差|极差] [--length 精辟|中等|正常] "输入"',
  );
  process.exit(1);
}

const response = await fetch(
  process.env.BLAHBLAH_API_URL ?? "https://api.freakz2z.com/generate",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, ...options }),
  },
);
if (!response.ok) throw new Error(`BlahBlah API returned HTTP ${response.status}`);
const payload = await response.json();
if (typeof payload.text !== "string") throw new Error("BlahBlah API returned no text");
console.log(payload.text);
