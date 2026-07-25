import { NextResponse } from "next/server";

const fallbackLines = [
  "我建议先把这个问题放进括号里，等星期四带着它一起去考研。",
  "这个选题看起来很正常，直到它意识到自己其实是一根有编制的意大利面。",
  "据不可靠消息，所有认真讨论这件事的人，最后都会被分配到同一个括号里。",
  "如果今天必须得出结论，那结论大概会先去买一杯奶茶再回来。",
];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { topic?: string; mood?: string };
  const topic = body.topic?.trim();
  if (!topic || topic.length > 30) return NextResponse.json({ error: "invalid_topic" }, { status: 400 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    await new Promise((resolve) => setTimeout(resolve, 520));
    return NextResponse.json({ text: fallbackLines[Math.floor(Math.random() * fallbackLines.length)] });
  }

  const endpoint = process.env.DEEPSEEK_API_BASE ?? "https://api.deepseek.com/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
      temperature: 1.35,
      max_tokens: 100,
      messages: [
        { role: "system", content: "你是胡言乱语生成器。只输出一句中文胡言乱语，不要解释，不要引号，不要换行。必须和用户选题有关，但逻辑荒谬、语气一本正经，最多60个汉字。" },
        { role: "user", content: `选题：${topic}\n精神状态：${body.mood ?? "正常"}` },
      ],
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return NextResponse.json({ error: "upstream" }, { status: 502 });
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.replace(/[\r\n"“”]/g, "").trim();
  if (!text) return NextResponse.json({ error: "empty" }, { status: 502 });
  return NextResponse.json({ text });
}
