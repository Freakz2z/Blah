"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

/* ── Constants ─────────────────────────────────── */
const MODES = ["翻译", "回答"] as const;
const MOODS = ["极差", "差", "正常"];
const LENGTH_OPTIONS = ["精辟", "中等", "正常"] as const;
const THEME_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
] as const;
const THINKING_STEPS: Record<(typeof MODES)[number], string[]> = {
  翻译: ["正在拆解原话", "正在替换正常逻辑", "正在校对胡言乱语", "译文有点烫，正在吹凉"],
  回答: ["正在理解问题", "正在建立不必要的联系", "正在强行得出答案", "答案有点烫，正在吹凉"],
};
const MAX_CHARS = 30;

const CANVAS_SERIF =
  "'Noto Serif SC','Source Han Serif SC','Songti SC','STSong','SimSun',serif";
const CANVAS_SANS =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

type UsageStats = { users: number; generations: number };

const STAT_FORMATTER = new Intl.NumberFormat("zh-CN");

function formatStat(value: number): string {
  return STAT_FORMATTER.format(value);
}

/* ── Component ─────────────────────────────────── */
export default function Home() {
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("翻译");
  const [mood, setMood] = useState(2); /* "正常" — last index */
  const [generationLength, setGenerationLength] = useState<(typeof LENGTH_OPTIONS)[number]>("正常");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState<"idle" | "thinking" | "success" | "error">("idle");
  const [thinkingStep, setThinkingStep] = useState(0);
  const [message, setMessage] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [animKey, setAnimKey] = useState(0);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState<UsageStats | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const statsRequestRef = useRef(0);

  const loadStats = useCallback(async () => {
    const requestId = ++statsRequestRef.current;
    try {
      const response = await fetch("/api/stats", { cache: "no-store" });
      if (!response.ok) throw new Error("stats_unavailable");
      const data = (await response.json()) as Partial<UsageStats>;
      const users = data.users;
      const generations = data.generations;
      if (
        typeof users !== "number" ||
        typeof generations !== "number" ||
        !Number.isSafeInteger(users) ||
        !Number.isSafeInteger(generations) ||
        users < 0 ||
        generations < 0
      ) {
        throw new Error("invalid_stats");
      }
      if (requestId === statsRequestRef.current) {
        setStats({ users, generations });
      }
    } catch {
      if (requestId === statsRequestRef.current) setStats(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStats(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStats]);

  /* thinking animation — monotonic three-act narration, no wrap-around */
  useEffect(() => {
    if (
      status !== "thinking" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = window.setInterval(
      () => setThinkingStep((s) => Math.min(s + 1, THINKING_STEPS[mode].length - 1)),
      1200,
    );
    return () => window.clearInterval(timer);
  }, [status, mode]);

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

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettingsOpen(false);
      settingsButtonRef.current?.focus();
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        settingsPanelRef.current?.contains(target) ||
        settingsButtonRef.current?.contains(target)
      )
        return;
      setSettingsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [settingsOpen]);

  /* ── Generate ────────────────────────────────── */
  const generate = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (status === "thinking") return;
      const clean = topic.trim();

      if (!clean) {
        setStatus("error");
        setMessage(mode === "翻译" ? "先输入一句要翻译的话。" : "先输入一个要回答的问题。");
        inputRef.current?.focus();
        return;
      }

      if (clean.length > MAX_CHARS) {
        setStatus("error");
        setMessage(`输入有点长，控制在 ${MAX_CHARS} 个字以内。`);
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
          body: JSON.stringify({
            topic: clean,
            mode,
            mood: MOODS[mood],
            length: generationLength,
          }),
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
        void loadStats();
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
    [topic, mode, mood, generationLength, status, loadStats],
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
      `${mode}「${topic.trim()}」·精神状态：${MOODS[mood]}`,
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
    a.download = `胡言乱语-${mode}-${topic.trim().replace(/[\\/:*?"<>|]/g, "")}-${MOODS[mood]}.png`;
    a.click();
    URL.revokeObjectURL(url);
    finish("saved");
  }, [result, saveState, topic, mode, mood]);

  /* ── Derived state ───────────────────────────── */
  const isOverLimit = topic.length > MAX_CHARS;
  const canGenerate = status !== "thinking";
  const hasResult = result !== "";

  /* ── Render ──────────────────────────────────── */
  return (
    <div className={`app-shell mood-${mood}`}>
      <div className="page-frame">
        {/* ── Header ───────────────────────────── */}
        <header className="site-header">
          <div className="site-title">
            <h1>胡言乱语生成器</h1>
          </div>
          <button
            ref={settingsButtonRef}
            className={`settings-toggle${settingsOpen ? " active" : ""}`}
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label={settingsOpen ? "关闭设置" : "打开设置"}
            aria-expanded={settingsOpen}
            aria-controls="settings-panel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
            </svg>
          </button>

          <div
            ref={settingsPanelRef}
            id="settings-panel"
            className="settings-popover"
            role="dialog"
            aria-label="设置"
            hidden={!settingsOpen}
          >
            <div className="settings-header">
              <span>设置</span>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(false);
                  settingsButtonRef.current?.focus();
                }}
                aria-label="关闭设置"
              >
                ×
              </button>
            </div>

            <div className="settings-content">
              <fieldset className="setting-block theme-block">
                <legend className="micro-label">主题设置</legend>
                <div className="theme-options" role="radiogroup" aria-label="主题设置">
                  {THEME_OPTIONS.map((option, index) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      className={`theme-option${theme === option.value ? " active" : ""}`}
                      aria-checked={theme === option.value}
                      tabIndex={theme === option.value ? 0 : -1}
                      onClick={() => setTheme(option.value)}
                      onKeyDown={(event) => {
                        const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? 1
                          : event.key === "ArrowLeft" || event.key === "ArrowUp"
                            ? -1
                            : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const nextIndex = (index + direction + THEME_OPTIONS.length) % THEME_OPTIONS.length;
                        setTheme(THEME_OPTIONS[nextIndex].value);
                        const options = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".theme-option");
                        options?.[nextIndex]?.focus();
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mode-block" disabled={status === "thinking"}>
                <legend className="micro-label">模式设置</legend>
                <div className="mode-options" role="radiogroup" aria-label="生成模式">
                  {MODES.map((value, index) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      className={`mode-option${mode === value ? " active" : ""}`}
                      aria-checked={mode === value}
                      tabIndex={mode === value ? 0 : -1}
                      onClick={() => {
                        setMode(value);
                        setResult("");
                        setStatus("idle");
                        setMessage("");
                      }}
                      onKeyDown={(event) => {
                        const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? 1
                          : event.key === "ArrowLeft" || event.key === "ArrowUp"
                            ? -1
                            : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const nextIndex = (index + direction + MODES.length) % MODES.length;
                        setMode(MODES[nextIndex]);
                        setResult("");
                        setStatus("idle");
                        const options = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".mode-option");
                        options?.[nextIndex]?.focus();
                      }}
                    >
                      <span>{value}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="mood-block" disabled={status === "thinking"}>
                <legend className="micro-label">精神状态</legend>
                <div className="mood-options" role="radiogroup" aria-label="精神状态">
                  {MOODS.map((value, index) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      className={`mood-option${mood === index ? " active" : ""}`}
                      aria-checked={mood === index}
                      tabIndex={mood === index ? 0 : -1}
                      onClick={() => setMood(index)}
                      onKeyDown={(event) => {
                        const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? 1
                          : event.key === "ArrowLeft" || event.key === "ArrowUp"
                            ? -1
                            : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const nextIndex = (index + direction + MOODS.length) % MOODS.length;
                        setMood(nextIndex);
                        const options = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".mood-option");
                        options?.[nextIndex]?.focus();
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="length-block" disabled={status === "thinking"}>
                <legend className="micro-label">生成长度</legend>
                <div className="length-options" role="radiogroup" aria-label="生成长度">
                  {LENGTH_OPTIONS.map((value, index) => (
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
                        setGenerationLength(LENGTH_OPTIONS[nextIndex]);
                        const options = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".length-option");
                        options?.[nextIndex]?.focus();
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
        </header>

        {/* ── Main Content ──────────────────────── */}
        <div className="main-content">
          {/* Input */}
          <form id="gen-form" className="generator-form" onSubmit={generate}>
            <div className="field-block">
              <div className="field-label-row">
                <label htmlFor="topic" className="micro-label">
                  {mode === "翻译" ? "原话" : "问题"}
                </label>
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
                placeholder={mode === "翻译" ? "输入一句话" : "输入一个问题"}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="char-count"
                aria-invalid={isOverLimit || undefined}
              />
            </div>
          </form>

          {/* Primary button — lives outside the form, submits via form attr */}
          <button
            className="primary-button"
            type="submit"
            form="gen-form"
            aria-disabled={!canGenerate || undefined}
            aria-label={status === "thinking" ? `正在${mode}……` : `开始${mode}`}
          >
            <span>{status === "thinking" ? `正在${mode}……` : `开始${mode}`}</span>
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
                  {THINKING_STEPS[mode][thinkingStep]}
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

        <footer className="site-footer" aria-label="使用统计" aria-live="polite">
          <span>{stats ? formatStat(stats.users) : "—"} 人用过</span>
          <span className="site-footer-divider" aria-hidden="true">·</span>
          <span>共生成 {stats ? formatStat(stats.generations) : "—"} 句胡言乱语</span>
        </footer>
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
