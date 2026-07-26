"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

/* ── Constants ─────────────────────────────────── */
const MOODS = ["钝角", "最差", "极差", "差", "正常"];
const LENGTH_OPTIONS = [
  { value: "精辟", range: "4–8字" },
  { value: "中等", range: "12–24字" },
  { value: "正常", range: "25–65字" },
] as const;
const THINKING_STEPS = [
  "正在理解选题",
  "正在建立不必要的联系",
  "正在强行得出结论",
  "结论有点烫，正在吹凉",
];
const MAX_CHARS = 30;

const CANVAS_SERIF =
  "'Noto Serif SC','Source Han Serif SC','Songti SC','STSong','SimSun',serif";
const CANVAS_SANS =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

/* ── Component ─────────────────────────────────── */
export default function Home() {
  const [topic, setTopic] = useState("");
  const [mood, setMood] = useState(4); /* "正常" — last index */
  const [generationLength, setGenerationLength] = useState<(typeof LENGTH_OPTIONS)[number]["value"]>("正常");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<"idle" | "thinking" | "success" | "error">("idle");
  const [thinkingStep, setThinkingStep] = useState(0);
  const [message, setMessage] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [animKey, setAnimKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  /* thinking animation — monotonic three-act narration, no wrap-around */
  useEffect(() => {
    if (
      status !== "thinking" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = window.setInterval(
      () => setThinkingStep((s) => Math.min(s + 1, THINKING_STEPS.length - 1)),
      1200,
    );
    return () => window.clearInterval(timer);
  }, [status]);

  /* feedback timer cleanup */
  useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

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
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
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
      if (status === "thinking") return;
      const clean = topic.trim();

      if (!clean) {
        setStatus("error");
        setMessage("先给这次胡言乱语定个选题。");
        inputRef.current?.focus();
        return;
      }

      if (clean.length > MAX_CHARS) {
        setStatus("error");
        setMessage(`选题有点长，控制在 ${MAX_CHARS} 个字以内。`);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setStatus("thinking");
      setThinkingStep(0);
      setMessage("");
      setCopyState("idle");

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: clean, mood: MOODS[mood], length: generationLength }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          if (payload.error === "rate_limited") {
            throw new Error(`rate_limited:${response.headers.get("Retry-After") ?? ""}`);
          }
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
        setStatus("error");
        if (err instanceof Error && err.message.startsWith("rate_limited")) {
          const seconds = err.message.split(":")[1];
          setMessage(
            seconds
              ? `胡得太勤了，${seconds} 秒后再来一次。`
              : "操作太快，稍后再胡一次。",
          );
        } else {
          setMessage("这次没胡出来，再试一次。");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [topic, mood, generationLength, status],
  );

  /* ── Copy — clipboard API with execCommand fallback ── */
  const copyResult = useCallback(async () => {
    if (!result) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(result);
      ok = true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = result;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        ok = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        ok = false;
      }
    }
    setCopyState(ok ? "copied" : "failed");
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyState("idle"), 1800);
  }, [result]);

  /* ── Save Image — theme-aware card with attribution footer ── */
  const saveImage = useCallback(async () => {
    if (!result || saveState === "saving") return;
    setSaveState("saving");

    const finish = (state: "saved" | "failed") => {
      setSaveState(state);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => setSaveState("idle"), 1800);
    };

    await document.fonts.ready;

    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue("--bg").trim() || "#f9f8f6";
    const fg = css.getPropertyValue("--fg").trim() || "#171613";
    const fgMuted = css.getPropertyValue("--fg-muted").trim() || "#716c62";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) { finish("failed"); return; }

    const padding = 48;
    const fontSize = 52;
    const footerHeight = 72;
    ctx.font = `600 ${fontSize}px ${CANVAS_SERIF}`;

    const lines = wrapText(ctx, result, 720);
    const lineHeight = fontSize * 1.5;
    const textHeight = lines.length * lineHeight;
    const realWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));

    const canvasWidth = Math.max(Math.min(realWidth, 720), 384) + padding * 2;
    const canvasHeight = Math.max(textHeight + padding * 2 + footerHeight, 420);

    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(canvasHeight * dpr);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    /* body — centered in the area above the footer */
    ctx.fillStyle = fg;
    ctx.font = `600 ${fontSize}px ${CANVAS_SERIF}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const bodyTop = (canvasHeight - footerHeight - textHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, canvasWidth / 2, bodyTop + i * lineHeight);
    });

    /* footer — separator + attribution */
    const footerTop = canvasHeight - footerHeight;
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = fg;
    ctx.fillRect(padding, footerTop, canvasWidth - padding * 2, 1);
    ctx.restore();

    ctx.font = `400 20px ${CANVAS_SANS}`;
    ctx.fillStyle = fgMuted;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(
      `「${topic.trim()}」·精神状态：${MOODS[mood]}`,
      padding,
      footerTop + footerHeight / 2,
    );
    ctx.textAlign = "right";
    ctx.fillText("胡言乱语生成器", canvasWidth - padding, footerTop + footerHeight / 2);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) { finish("failed"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `胡言乱语-${topic.trim().replace(/[\\/:*?"<>|]/g, "")}-${MOODS[mood]}.png`;
    a.click();
    URL.revokeObjectURL(url);
    finish("saved");
  }, [result, saveState, topic, mood]);

  /* ── Derived state ───────────────────────────── */
  const isOverLimit = topic.length > MAX_CHARS;
  const canGenerate = status !== "thinking";
  const hasResult = result !== "";
  const maxIndex = MOODS.length - 1;
  const fillPercent = (mood / maxIndex) * 100;

  /* ── Render ──────────────────────────────────── */
  return (
    <div className={`app-shell mood-${mood}`}>
      <div className="page-frame">
        {/* ── Header ───────────────────────────── */}
        <header className="site-header">
          <div className="site-title">
            <h1>胡言乱语生成器</h1>
            <p className="subtitle">根据你当前的精神状态，认真说一句废话。</p>
          </div>
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
        </header>

        {/* ── Main Content ──────────────────────── */}
        <div className="main-content">
          {/* Topic */}
          <form id="gen-form" className="generator-form" onSubmit={generate}>
            <div className="field-block">
              <div className="field-label-row">
                <label htmlFor="topic" className="micro-label">选题</label>
                <span
                  id="char-count"
                  role="status"
                  className={`char-count${isOverLimit ? " over-limit" : ""}`}
                >
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
                placeholder="输入选题"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="char-count"
                aria-invalid={isOverLimit || undefined}
              />
            </div>
          </form>

          {/* Mood Slider */}
          <div className="mood-block">
            <div className="mood-label-row">
              <span className="mood-label micro-label">精神状态</span>
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
                if (e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "PageDown") {
                  e.preventDefault();
                  setMood(Math.max(0, mood - 1));
                } else if (e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "PageUp") {
                  e.preventDefault();
                  setMood(Math.min(maxIndex, mood + 1));
                } else if (e.key === "Home") {
                  e.preventDefault();
                  setMood(0);
                } else if (e.key === "End") {
                  e.preventDefault();
                  setMood(maxIndex);
                }
              }}
            >
              <div
                className="mood-track-fill"
                style={{ width: `calc(${fillPercent} / 100 * (100% - 14px))` }}
              />
              <div className="mood-labels">
                {MOODS.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    className={`mood-label-item${mood === i ? " active" : ""}`}
                    style={{ left: `${(i / maxIndex) * 100}%` }}
                    onClick={() => setMood(i)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                className="mood-thumb"
                style={{ left: `calc(7px + ${fillPercent} / 100 * (100% - 14px))` }}
              />
            </div>
          </div>

          <fieldset className="length-block" disabled={status === "thinking"}>
            <legend className="micro-label">生成长度</legend>
            <div className="length-options" role="radiogroup" aria-label="生成长度">
              {LENGTH_OPTIONS.map(({ value, range }, index) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  className={`length-option${generationLength === value ? " active" : ""}`}
                  aria-checked={generationLength === value}
                  tabIndex={generationLength === value ? 0 : -1}
                  onClick={() => setGenerationLength(value)}
                  onKeyDown={(event) => {
                    const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
                      ? 1
                      : event.key === "ArrowLeft" || event.key === "ArrowUp"
                        ? -1
                        : 0;
                    if (!direction) return;
                    event.preventDefault();
                    const nextIndex = (index + direction + LENGTH_OPTIONS.length) % LENGTH_OPTIONS.length;
                    setGenerationLength(LENGTH_OPTIONS[nextIndex].value);
                    const options = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".length-option");
                    options?.[nextIndex]?.focus();
                  }}
                >
                  <span>{value}</span>
                  <small>{range}</small>
                </button>
              ))}
            </div>
          </fieldset>

          {/* Primary button — lives outside the form, submits via form attr */}
          <button
            className="primary-button"
            type="submit"
            form="gen-form"
            aria-disabled={!canGenerate || undefined}
            aria-label={status === "thinking" ? "正在生成……" : "开始胡言乱语"}
          >
            <span>{status === "thinking" ? "正在生成……" : "开始胡言乱语"}</span>
            <span className="btn-hint" aria-hidden="true">
              {status === "thinking" ? "" : "↵"}
            </span>
          </button>

          {/* ── Result ──────────────────────────── */}
          <section className="result-section" aria-live="polite">
            {status === "idle" && !hasResult && (
              <p className="empty-message">等一句没有用的话</p>
            )}

            {status === "thinking" && (
              <div className="thinking-indicator">
                <span className="thinking-dot" aria-hidden="true" />
                <span key={thinkingStep} className="thinking-text">
                  {THINKING_STEPS[thinkingStep]}
                </span>
              </div>
            )}

            {status === "error" && (
              <>
                <p className="error-message">
                  {message || "这次没胡出来，再试一次。"}
                </p>
                {!hasResult && (
                  <div className="result-actions">
                    <button type="button" onClick={() => generate()}>
                      再试一次
                    </button>
                  </div>
                )}
              </>
            )}

            {hasResult && (
              <>
                <p
                  key={animKey}
                  className={`result-text${status === "thinking" ? " stale" : " animate-in"}`}
                >
                  {result}
                </p>
                <div className="result-actions">
                  <button
                    type="button"
                    disabled={status === "thinking"}
                    onClick={() => generate()}
                  >
                    再胡一次
                  </button>
                  <button
                    type="button"
                    disabled={status === "thinking"}
                    onClick={copyResult}
                    className={
                      copyState === "copied"
                        ? "copied"
                        : copyState === "failed"
                          ? "copy-failed"
                          : ""
                    }
                  >
                    {copyState === "copied"
                      ? "已复制"
                      : copyState === "failed"
                        ? "复制失败"
                        : "复制"}
                  </button>
                  <button
                    type="button"
                    disabled={status === "thinking" || saveState === "saving"}
                    onClick={saveImage}
                    className={
                      saveState === "saving"
                        ? "saving"
                        : saveState === "saved"
                          ? "saved"
                          : saveState === "failed"
                            ? "save-failed"
                            : ""
                    }
                  >
                    {saveState === "saving"
                      ? "保存中…"
                      : saveState === "saved"
                        ? "已保存"
                        : saveState === "failed"
                          ? "保存失败"
                          : "保存图片"}
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
