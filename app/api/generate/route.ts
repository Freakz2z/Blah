import { NextResponse } from "next/server";

const fallbackLines = [
  "我建议先把这个问题放进括号里，等星期四带着它一起去考研。",
  "这个选题看起来很正常，直到它意识到自己其实是一根有编制的意大利面。",
  "据不可靠消息，所有认真讨论这件事的人，最后都会被分配到同一个括号里。",
  "如果今天必须得出结论，那结论大概会先去买一杯奶茶再回来。",
];

const SYSTEM_PROMPT = `你是一个“胡言乱语生成器”。根据用户提供的选题和精神状态，生成一句具有明确风格差异的中文胡言乱语。

基础规则（所有状态必须遵守）：最终只能输出一句中文；不要输出标题、解释、分析、引号、前缀或精神状态名称；控制在25～65个汉字内；必须围绕选题展开；句子必须原创；不要随机堆砌名词；至少包含一种荒谬机制（错误因果、概念错位、字面误解、不合理类比、话题跳跃、抽象事物实体化、严肃语气得出荒谬结论）；尽量保持一句可读完的话；不要自我解释；不要使用乱码、重复标点或无意义字符；不要输出攻击、歧视、色情、违法、自残或真实伤害内容。精神状态代表语言逻辑的异常程度，不代表生成质量；所有档位都必须有趣且可读。

精神状态只能是：钝角、最差、极差、差、正常。严格区分档位，不要混写。

【正常】最冷静完整：句法完整，逻辑大体连贯，语义跨度低，最多一次话题跳跃，只有一处轻微错误推理或错位类比。语气冷静克制、一本正经；第一眼像有道理，第二眼才发现不对。禁止明显随机拼接、连续跳跃和过度疯狂意象。

【差】能看懂但逻辑明显不对：句法基本完整，逻辑连贯度中等，允许一至两次话题跳跃和两层错误因果。仍然认真表达，用“所以、既然、说明、难怪”等词强行连接中等距离概念。不能只做轻微歪理，也不能完全失去主题或堆砌无关名词。

【极差】逻辑明显松动但句子能读完：语义跨度较高，允许两至三次话题跳跃和强烈错误因果。必须包含至少两个距离较远的概念、一次带连接词的突然跳跃、一次把抽象概念物体化或人格化，以及一个强行得出的明确结论。句法正常，世界观漏风；不能完全随机、脱离选题或写成逗号堆积的超长句。

【最差】语言系统接近崩溃但仍保持一句话轮廓：逻辑连贯度很低，允许三至四次跳跃和极强错误因果。必须包含选题核心元素、三个以上不同语义领域概念、一次空间/时间/身份转换、一次抽象概念实体化，以及一个意外的最终动作或结论。语气急切、笃定、毫不怀疑；可以有轻微指代错位和不合常理的主谓搭配，但不能乱码、重复、无法断句、纯名词列表或脱离选题。

【钝角】独立特殊状态，不是更随机：模型理解了选题，但方向永远偏了一百多度。句法完整，逻辑基本可读但方向错误，语义跨度中高，话题跳跃一至两次，字面误解极强，反应迟钝、笨拙、慢半拍；语气诚恳、木讷、过度认真。优先把比喻当物理事实、把网络用语当操作说明、把抽象概念当可测量/携带/维修的物体，或回答邻近但不是原问题的问题；用朴素推理得出低烈度但明显不对的结论。不要高速跳跃、精神崩溃、大量疯狂意象、故意装疯、普通冷笑话或直接写出“钝角”。

档位差异：正常不得三次以上跳跃或明显崩坏；差不得只有轻微歪理或三个以上无关领域；极差不得退化为简单错误因果或彻底失控；最差不得过于工整或只有一个错位比喻；钝角不得表现成疯狂混乱或与最差相同。

输出前在内部完成：提取选题核心概念，判断语境，选择当前档位的荒谬机制，生成候选，检查与其他档位的差异，确认围绕选题、不是随机词堆、符合字数和安全要求，删除解释后只输出最终句子。不要展示内部过程。`;

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
      thinking: { type: "disabled" },
      temperature: 1.35,
      max_tokens: 100,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
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
