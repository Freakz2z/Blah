"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

/* ── Constants ─────────────────────────────────── */
const MOODS = ["钝角", "最差", "极差", "差", "正常"];
const THINKING_STEPS = ["正在理解选题", "正在建立不必要的联系", "正在强行得出结论"];
const MAX_CHARS = 30;

/* ── Component ─────────────────────────────────── */
export default function Home() {
  const [topic, setTopic] = useState("");
  const [mood, setMood] = useState(4); /* "正常" — last index */
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<"idle" | "thinking" | "success" | "error">("idle");
  const [thinkingStep, setThinkingStep] = useState(0);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  /* thinking animation */
  useEffect(() => {
    if (status !== "thinking") return;
    const timer = window.setInterval(
      () => setThinkingStep((s) => (s + 1) % THINKING_STEPS.length),
      580,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  /* ── Theme toggle ───────────────────────────── */
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((t) => (t === "auto" ? "light" : t === "light" ? "dark" : "auto"));
  }, []);

  /* ── Slider logic ────────────────────────────── */
  const getMoodFromPosition = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return mood;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * (MOODS.length - 1));
  }, [mood]);

  const handleTrackPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* synthetic */ }
    setDragging(true);
    setMood(getMoodFromPosition(e.clientX));
  }, [getMoodFromPosition]);

  const handleTrackPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setMood(getMoodFromPosition(e.clientX));
  }, [dragging, getMoodFromPosition]);

  const handleTrackPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  /* ── Generate ────────────────────────────────── */
  const generate = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const clean = topic.trim();

      if (!clean) {
        setStatus("error");
        setResult("");
        setMessage("先给这次胡言乱语定个选题。");
        inputRef.current?.focus();
        return;
      }

      if (clean.length > MAX_CHARS) {
        setStatus("error");
        setResult("");
        setMessage(`选题有点长，控制在 ${MAX_CHARS} 个字以内。`);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("thinking");
      setThinkingStep(0);
      setMessage("");
      setCopied(false);

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: clean, mood: MOODS[mood] }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "upstream");
        }
        const data = (await response.json()) as { text?: string };

        if (controller.signal.aborted) return;

        if (!data.text?.trim()) throw new Error("empty");
        setResult(data.text.trim());
        setStatus("success");
        setAnimKey((k) => k + 1);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResult("");
        setStatus("error");
        setMessage(
          err instanceof Error && err.message === "rate_limited"
            ? "操作太快，稍后再胡一次。"
            : "这次没胡出来，再试一次。",
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [topic, mood],
  );

  /* ── Copy ────────────────────────────────────── */
  const copyResult = useCallback(async () => {
    if (!result) return;
    try { await navigator.clipboard.writeText(result); } catch { /* ok */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [result]);

  /* ── Save Image — pure result only ──────────── */
  const saveImage = useCallback(async () => {
    if (!result || saving) return;
    setSaving(true);

    await new Promise((r) => window.setTimeout(r, 80));

    const isDark = document.documentElement.getAttribute("data-theme") === "dark"
      || (document.documentElement.getAttribute("data-theme") !== "light"
        && window.matchMedia("(prefers-color-scheme: dark)").matches);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) { setSaving(false); return; }

    const padding = 48;
    const fontSize = 52;
    ctx.font = `600 ${fontSize}px 'Noto Serif SC', 'Songti SC', 'PingFang SC', serif`;

    const maxWidth = 720;
    const lines = wrapText(ctx, result, maxWidth);
    const lineHeight = fontSize * 1.5;
    const textHeight = lines.length * lineHeight;

    const canvasWidth = maxWidth + padding * 2;
    const canvasHeight = textHeight + padding * 2;

    const dpr = 2;
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = isDark ? "#131210" : "#f9f8f6";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    ctx.fillStyle = isDark ? "#ebe8e2" : "#171613";
    ctx.font = `600 ${fontSize}px 'Noto Serif SC', 'Songti SC', 'PingFang SC', serif`;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      ctx.fillText(line, padding, padding + i * lineHeight);
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) { setSaving(false); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "胡言乱语.png";
    a.click();
    URL.revokeObjectURL(url);
    setSaving(false);
  }, [result, saving]);

  /* ── Derived state ───────────────────────────── */
  const isOverLimit = topic.length > MAX_CHARS;
  const canGenerate = status !== "thinking";
  const hasResult = status === "success" && result;
  const maxIndex = MOODS.length - 1;
  const fillPercent = (mood / maxIndex) * 100;

  /* ── Render ──────────────────────────────────── */
  return (
    <div className={`app-shell mood-${mood}`}>
      <div className="page-frame">
        {/* ── Header ───────────────────────────── */}
        <header className="site-header">
          <button
            className="theme-toggle"
            type="button"
            onClick={cycleTheme}
            aria-label={
              theme === "auto"
                ? "当前：跟随系统，点击切换亮色"
                : theme === "light"
                  ? "当前：亮色模式，点击切换暗色"
                  : "当前：暗色模式，点击切换自动"
            }
          >
            {theme === "auto" ? "◐" : theme === "light" ? "○" : "●"}
          </button>
          <h1>胡言乱语生成器</h1>
        </header>

        {/* ── Main Content ──────────────────────── */}
        <div className="main-content">
          {/* Topic */}
          <form className="generator-form" onSubmit={generate}>
            <div className="field-block">
              <div className="field-label-row">
                <label htmlFor="topic">选题</label>
                <span className={`char-count${isOverLimit ? " over-limit" : ""}`}>
                  {topic.length}/{MAX_CHARS}
                </span>
              </div>
              <input
                ref={inputRef}
                id="topic"
                className="topic-input"
                type="text"
                value={topic}
                maxLength={MAX_CHARS + 1}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="例如：疯狂星期四、括号文学、考研…"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </form>

          {/* Mood Slider */}
          <div className="mood-block">
            <div className="mood-label-row">
              <span className="mood-label">精神状态</span>
            </div>

            <div
              ref={trackRef}
              className={`mood-track${dragging ? " dragging" : ""}`}
              role="slider"
              aria-label="精神状态"
              aria-valuemin={0}
              aria-valuemax={maxIndex}
              aria-valuenow={mood}
              aria-valuetext={MOODS[mood]}
              tabIndex={0}
              onPointerDown={handleTrackPointerDown}
              onPointerMove={handleTrackPointerMove}
              onPointerUp={handleTrackPointerUp}
              onPointerCancel={handleTrackPointerUp}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  setMood(Math.max(0, mood - 1));
                } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setMood(Math.min(maxIndex, mood + 1));
                }
              }}
            >
              <div className="mood-track-fill" style={{ width: `${fillPercent}%` }} />
              <div className="mood-labels">
                {MOODS.map((label, i) => (
                  <span
                    key={label}
                    className={`mood-label-item${mood === i ? " active" : ""}`}
                    style={{ left: `${(i / maxIndex) * 100}%` }}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="mood-thumb" style={{ left: `${fillPercent}%` }} />
            </div>
          </div>

          {/* Primary button */}
          <button
            className="primary-button"
            type="submit"
            disabled={!canGenerate}
            onClick={() => generate()}
            aria-label={
              status === "thinking" ? THINKING_STEPS[thinkingStep] : "开始胡言乱语"
            }
          >
            <span>
              {status === "thinking" ? THINKING_STEPS[thinkingStep] : "开始胡言乱语"}
            </span>
            <span className="btn-hint" aria-hidden="true">
              {status === "thinking" ? "" : "↵"}
            </span>
          </button>

          {/* ── Result ──────────────────────────── */}
          <section
            className="result-section"
            aria-live="polite"
            aria-busy={status === "thinking"}
          >
            {status === "idle" && !result && (
              <p className="empty-message">等一句没有用的话</p>
            )}

            {status === "thinking" && (
              <div className="thinking-indicator">
                <span className="thinking-dot" aria-hidden="true" />
                {THINKING_STEPS[thinkingStep]}
              </div>
            )}

            {status === "error" && (
              <p className="error-message" role="alert">
                {message || "这次没胡出来，再试一次。"}
              </p>
            )}

            {hasResult && (
              <>
                <p key={animKey} className="result-text animate-in">
                  {result}
                </p>
                <div className="result-actions">
                  <button type="button" onClick={() => generate()}>
                    再胡一次
                  </button>
                  <button
                    type="button"
                    onClick={copyResult}
                    className={copied ? "copied" : ""}
                  >
                    {copied ? "已复制" : "复制"}
                  </button>
                  <button
                    type="button"
                    onClick={saveImage}
                    className={saving ? "saving" : ""}
                    disabled={saving}
                  >
                    {saving ? "保存中…" : "保存图片"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Canvas text wrapping helper ──────────────── */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const char of text) {
    const test = current + char;
    if (ctx.measureText(test).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = char;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
