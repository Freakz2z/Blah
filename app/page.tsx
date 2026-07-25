"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

const moods = ["最差", "极差", "差", "正常", "好", "极好", "最好"];
const thinkingLines = ["正在理解选题", "正在建立不必要的联系", "正在强行得出结论"];

export default function Home() {
  const [topic, setTopic] = useState("");
  const [mood, setMood] = useState(3);
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<"idle" | "thinking" | "success" | "error">("idle");
  const [thinkingStep, setThinkingStep] = useState(0);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status !== "thinking") return;
    const timer = window.setInterval(() => setThinkingStep((step) => (step + 1) % thinkingLines.length), 650);
    return () => window.clearInterval(timer);
  }, [status]);

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    const cleanTopic = topic.trim();
    if (!cleanTopic) {
      setStatus("error");
      setMessage("先给这次胡言乱语定个选题。");
      inputRef.current?.focus();
      return;
    }
    if (cleanTopic.length > 30) {
      setStatus("error");
      setMessage("选题有点长，控制在 30 个字以内。");
      return;
    }

    setStatus("thinking");
    setThinkingStep(0);
    setMessage("");
    setCopied(false);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: cleanTopic, mood: moods[mood] }),
      });
      if (!response.ok) throw new Error("generation");
      const data = (await response.json()) as { text?: string };
      if (!data.text) throw new Error("empty");
      setResult(data.text);
      setStatus("success");
    } catch {
      setResult("");
      setStatus("error");
      setMessage("这次没胡出来，再试一次。");
    }
  }

  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function saveImage() {
    if (!result || saving) return;
    setSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#f4f1eb";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#20201d";
      context.font = "28px Arial, sans-serif";
      context.fillText("胡言乱语生成器 / RESULT", 120, 120);
      context.fillStyle = "#d4573b";
      context.fillRect(120, 152, 88, 5);
      context.fillStyle = "#20201d";
      context.font = "56px Arial, sans-serif";
      const words = result.match(/.{1,20}/g) ?? [result];
      words.forEach((line, index) => context.fillText(line, 120, 360 + index * 84));
      context.font = "22px Arial, sans-serif";
      context.fillStyle = "#77736b";
      context.fillText(`选题：${topic}    精神状态：${moods[mood]}`, 120, 770);
      const link = document.createElement("a");
      link.download = "胡言乱语.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    }
    setSaving(false);
  }

  return (
    <main className={`app-shell mood-${mood} status-${status}`}>
      <div className="page-frame">
        <header className="site-header">
          <div>
            <h1>胡言乱语生成器</h1>
            <p className="subtitle">根据你当前的精神状态，认真说一句废话。</p>
          </div>
        </header>

        <div className="work-area">
          <form className="generator-form" onSubmit={generate}>
            <div className="field-block">
              <div className="field-title"><label htmlFor="topic">选题</label><span className="char-count">{topic.length}/30</span></div>
              <input
                ref={inputRef}
                id="topic"
                value={topic}
                maxLength={31}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="例如：疯狂星期四、括号文学、考研"
                aria-describedby="topic-hint"
              />
              <p id="topic-hint" className="field-hint">最多 30 个字</p>
            </div>

            <div className="field-block mood-block">
              <div className="field-title"><span id="mood-label">精神状态</span><span className="mood-note">这里表示状态，不是质量</span></div>
              <div className="mood-picker" role="radiogroup" aria-labelledby="mood-label">
                <div className="mood-line" aria-hidden="true"><span /></div>
                <div className="mood-options">
                  {moods.map((label, index) => (
                    <button
                      type="button"
                      key={label}
                      role="radio"
                      aria-checked={mood === index}
                      className={mood === index ? "selected" : ""}
                      onClick={() => setMood(index)}
                    ><span className="mood-dot" /><span>{label}</span></button>
                  ))}
                </div>
              </div>
            </div>

            <button className="primary-button" type="submit" disabled={status === "thinking"}>
              <span>{status === "thinking" ? thinkingLines[thinkingStep] : "开始胡言乱语"}</span>
              <span className="button-state" aria-hidden="true">{status === "thinking" ? "···" : "↵"}</span>
            </button>
          </form>

          <section className="result-section" aria-live="polite" aria-busy={status === "thinking"}>
            <span className="result-label">结果</span>
            {status === "idle" && !result && <p className="empty-result">等一句<br />没有用的话。</p>}
            {status === "thinking" && <div className="thinking-state"><span className="thinking-marker" />{thinkingLines[thinkingStep]}</div>}
            {status === "error" && <p className="error-message">{message}</p>}
            {status === "success" && result && (
              <>
                <p className="result-text">{result}</p>
                <div className="result-actions">
                  <button type="button" onClick={() => generate()}>再胡一次</button>
                  <button type="button" onClick={copyResult}>{copied ? "已复制" : "复制"}</button>
                  <button type="button" onClick={saveImage}>{saving ? "保存中…" : "保存图片"}</button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
