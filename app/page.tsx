"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  parseHistory,
  prependHistory,
  serializeHistory,
  type GenerationHistoryItem,
} from "./history";
import { generateStandaloneText } from "./toy-local-generator";

/* ── Constants ─────────────────────────────────── */
const MODES = ["翻译", "回答"] as const;
const LENGTH_OPTIONS = ["精辟", "中等", "正常"] as const;
const THEME_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
] as const;
const THINKING_STEPS: Record<(typeof MODES)[number], string[]> = {
  翻译: ["正在拆解原话", "正在替换正常逻辑", "正在校对生成结果", "译文有点烫，正在吹凉"],
  回答: ["正在理解问题", "正在建立不必要的联系", "正在强行得出答案", "答案有点烫，正在吹凉"],
};
const MAX_CHARS = 30;

const CANVAS_SERIF =
  "'Noto Serif SC','Source Han Serif SC','Songti SC','STSong','SimSun',serif";
const CANVAS_SANS =
  "-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

type UsageStats = { generations: number };
const TOY_STATS_STORAGE_KEY = "blahblah:toy-generation-count:v1";

type BlahBlahRuntimeWindow = Window & {
  __BLAHBLAH_API_BASE__?: string;
  __BLAHBLAH_STANDALONE_TOY__?: boolean;
};

const STAT_FORMATTER = new Intl.NumberFormat("zh-CN");
const HISTORY_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatStat(value: number): string {
  return STAT_FORMATTER.format(value);
}

function formatHistoryTime(timestamp: number): string {
  return HISTORY_TIME_FORMATTER.format(timestamp);
}

function appApiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const configuredBase = (window as BlahBlahRuntimeWindow).__BLAHBLAH_API_BASE__ ?? "";
  return `${configuredBase.replace(/\/+$/, "")}${path}`;
}

function isStandaloneToy(): boolean {
  return typeof window !== "undefined" &&
    Boolean((window as BlahBlahRuntimeWindow).__BLAHBLAH_STANDALONE_TOY__);
}

function readStandaloneGenerationCount(): number {
  try {
    const stored = Number(window.localStorage.getItem(TOY_STATS_STORAGE_KEY) ?? "0");
    return Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
  } catch {
    return 0;
  }
}

function incrementStandaloneGenerationCount(): number {
  const next = readStandaloneGenerationCount() + 1;
  try {
    window.localStorage.setItem(TOY_STATS_STORAGE_KEY, String(next));
  } catch {
    // Private browsing and full storage must not block local generation.
  }
  return next;
}

function createHistoryId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/* ── Component ─────────────────────────────────── */
export default function Home() {
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<(typeof MODES)[number]>("翻译");
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<GenerationHistoryItem[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [stats, setStats] = useState<UsageStats | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyPanelRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const statsRequestRef = useRef(0);

  const loadStats = useCallback(async () => {
    const requestId = ++statsRequestRef.current;
    if (isStandaloneToy()) {
      if (requestId === statsRequestRef.current) {
        setStats({ generations: readStandaloneGenerationCount() });
      }
      return;
    }

    try {
      const response = await fetch(appApiUrl("/api/stats"), { cache: "no-store" });
      if (!response.ok) throw new Error("stats_unavailable");
      const data = (await response.json()) as Partial<UsageStats>;
      const generations = data.generations;
      if (
        typeof generations !== "number" ||
        !Number.isSafeInteger(generations) ||
        generations < 0
      ) {
        throw new Error("invalid_stats");
      }
      if (requestId === statsRequestRef.current) {
        setStats({ generations });
      }
    } catch {
      if (requestId === statsRequestRef.current) setStats(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStats(), 0);
    return () => window.clearTimeout(timer);
  }, [loadStats]);

  /* Browser-only generation history. It never reaches the Worker or stats API. */
  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      let stored = "";
      try {
        stored = window.localStorage.getItem(HISTORY_STORAGE_KEY) ?? "";
      } catch {
        stored = "";
      }
      setHistory(parseHistory(stored));
      setHistoryReady(true);
    }, 0);

    const syncFromAnotherTab = (event: StorageEvent) => {
      if (event.key === HISTORY_STORAGE_KEY) setHistory(parseHistory(event.newValue));
    };
    window.addEventListener("storage", syncFromAnotherTab);
    return () => {
      window.clearTimeout(loadTimer);
      window.removeEventListener("storage", syncFromAnotherTab);
    };
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, serializeHistory(history));
    } catch {
      // Private browsing and full storage must not block generation.
    }
  }, [history, historyReady]);

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
    if (!settingsOpen && !historyOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (historyOpen) {
        setHistoryOpen(false);
        historyButtonRef.current?.focus();
      } else {
        setSettingsOpen(false);
        settingsButtonRef.current?.focus();
      }
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        (settingsOpen &&
          (settingsPanelRef.current?.contains(target) ||
            settingsButtonRef.current?.contains(target))) ||
        (historyOpen &&
          (historyPanelRef.current?.contains(target) ||
            historyButtonRef.current?.contains(target)))
      )
        return;
      setSettingsOpen(false);
      setHistoryOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [historyOpen, settingsOpen]);

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
        const standaloneToy = isStandaloneToy();
        let generatedText = "";

        if (standaloneToy) {
          // Preserve the small thinking beat without introducing a network
          // request into the static Toy package.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 320));
          if (controller.signal.aborted) return;
          generatedText = generateStandaloneText(clean, mode, generationLength).trim();
        } else {
          const response = await fetch(appApiUrl("/api/generate"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topic: clean,
              mode,
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
          generatedText = data.text?.trim() ?? "";
        }

        if (controller.signal.aborted) return;

        if (!generatedText) throw new Error("empty");
        setResult(generatedText);
        setStatus("success");
        setAnimKey((k) => k + 1);
        const historyItem: GenerationHistoryItem = {
          id: createHistoryId(),
          createdAt: Date.now(),
          topic: clean,
          text: generatedText,
          mode,
          length: generationLength,
        };
        setHistory((items) => prependHistory(items, historyItem));
        if (standaloneToy) {
          setStats({ generations: incrementStandaloneGenerationCount() });
        } else {
          void loadStats();
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
        if (err instanceof Error && err.message.startsWith("rate_limited")) {
          const seconds = err.message.split(":")[1];
          setMessage(
            seconds
              ? `生成太频繁了，${seconds} 秒后再来一次。`
              : "操作太快，稍后再生成。",
          );
        } else if (err instanceof Error && err.message === "unsafe_topic") {
          setMessage("这个题目暂时不能生成，请换个普通话题。");
        } else {
          setMessage("这次没有生成出来，请再试一次。");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [topic, mode, generationLength, status, loadStats],
  );

  const restoreHistory = useCallback((item: GenerationHistoryItem) => {
    abortRef.current?.abort();
    setTopic(item.topic);
    setMode(item.mode);
    setGenerationLength(item.length);
    setResult(item.text);
    setStatus("success");
    setMessage("");
    setCopyState("idle");
    setAnimKey((key) => key + 1);
    setHistoryOpen(false);
    historyButtonRef.current?.focus();
  }, []);

  const removeHistoryItem = useCallback((id: string) => {
    setHistory((items) => items.filter((item) => item.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    if (!window.confirm("确定清空全部历史记录吗？")) return;
    setHistory([]);
  }, []);

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
      `${mode}「${topic.trim()}」`,
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
    a.download = `胡言乱语-${mode}-${topic.trim().replace(/[\\/:*?"<>|]/g, "")}.png`;
    a.click();
    URL.revokeObjectURL(url);
    finish("saved");
  }, [result, saveState, topic, mode]);

  /* ── Derived state ───────────────────────────── */
  const isOverLimit = topic.length > MAX_CHARS;
  const canGenerate = status !== "thinking";
  const hasResult = result !== "";
  const standaloneToy = isStandaloneToy();

  /* ── Render ──────────────────────────────────── */
  return (
    <div className="app-shell">
      <div className="page-frame">
        {/* ── Header ───────────────────────────── */}
        <header className="site-header">
          <div className="site-title">
            <h1>胡言乱语生成器</h1>
          </div>
          <button
            ref={historyButtonRef}
            className={`settings-toggle history-toggle${historyOpen ? " active" : ""}`}
            type="button"
            onClick={() => {
              setHistoryOpen((open) => !open);
              setSettingsOpen(false);
            }}
            aria-label={historyOpen ? "关闭历史记录" : "打开历史记录"}
            aria-expanded={historyOpen}
            aria-controls="history-panel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 7v5l3 2M5.4 5.4A9 9 0 1 1 3 12" />
              <path d="M3 5v4h4" />
            </svg>
            {history.length > 0 && <span className="history-count">{history.length}</span>}
          </button>
          <button
            ref={settingsButtonRef}
            className={`settings-toggle${settingsOpen ? " active" : ""}`}
            type="button"
            onClick={() => {
              setSettingsOpen((open) => !open);
              setHistoryOpen(false);
            }}
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
            </div>
          </div>

          <div
            ref={historyPanelRef}
            id="history-panel"
            className="settings-popover history-popover"
            role="dialog"
            aria-label="历史记录"
            hidden={!historyOpen}
          >
            <div className="settings-header">
              <span>历史记录</span>
              <div className="history-header-actions">
                <span className="history-count-label">{history.length}/{HISTORY_LIMIT}</span>
                {history.length > 0 && (
                  <button type="button" onClick={clearHistory}>清空</button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setHistoryOpen(false);
                    historyButtonRef.current?.focus();
                  }}
                  aria-label="关闭历史记录"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="history-content">
              {history.length === 0 ? (
                <p className="history-empty">还没有生成记录</p>
              ) : (
                <div className="history-list" role="list" aria-label="生成历史">
                  {history.map((item) => (
                    <div className="history-item" role="listitem" key={item.id}>
                      <button
                        type="button"
                        className="history-item-main"
                        onClick={() => restoreHistory(item)}
                        aria-label={`恢复 ${item.text}`}
                      >
                        <span className="history-item-meta">
                          <span>{item.mode} · {item.length}</span>
                          <time dateTime={new Date(item.createdAt).toISOString()}>
                            {formatHistoryTime(item.createdAt)}
                          </time>
                        </span>
                        <span className="history-item-result">{item.text}</span>
                        <span className="history-item-topic">{item.topic}</span>
                      </button>
                      <button
                        type="button"
                        className="history-item-delete"
                        onClick={() => removeHistoryItem(item.id)}
                        aria-label={`删除 ${item.text}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ── Main Content ──────────────────────── */}
        <div className="main-content">
          {/* Input */}
          <form id="gen-form" className="generator-form" onSubmit={generate}>
            <div className="field-block">
              <div className="field-label-row">
                <label htmlFor="topic" className="visually-hidden">
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

          <div className="main-options">
            <fieldset className="mode-block" disabled={status === "thinking"}>
              <legend className="visually-hidden">生成模式</legend>
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

            <fieldset className="length-block" disabled={status === "thinking"}>
              <legend className="visually-hidden">生成长度</legend>
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
                  {message || "这次没有生成出来，请再试一次。"}
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
                    重新生成
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
          <span>{standaloneToy ? "本机已生成" : "共生成"} {stats ? formatStat(stats.generations) : "—"} 句</span>
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
