"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ACHIEVEMENTS,
  achievementForValue,
  achievementProgress,
  newlyUnlockedAchievement,
  nextAchievementForValue,
  type Achievement,
} from "./achievements";
import {
  HISTORY_LIMIT,
  mergeHistory,
  prependHistory,
  type GenerationHistoryItem,
} from "./history";
import { loadCloudHistory, persistCloudHistory } from "./cloud-history";
import {
  LEADERBOARD_PERIODS,
  fetchLeaderboard,
  submitLeaderboardScore,
  type LeaderboardPeriod,
  type LeaderboardSnapshot,
} from "./leaderboard";
import { fetchUserProfile, type ToyUserProfile } from "./profile";
import {
  loadNonsenseValueCloud,
  loadThemeCloud,
  readNonsenseValueLocal,
  readThemeLocal,
  saveNonsenseValueCloud,
  saveThemeCloud,
  writeNonsenseValueLocal,
  writeThemeLocal,
  type ThemePreference,
} from "./preferences";
import { CHANGELOG } from "./changelog";
import { generateStandaloneText } from "./toy-local-generator";
import { MAX_TOPIC_LENGTH } from "../../shared/generate/validation.ts";

/* ── Constants ─────────────────────────────────── */
const MODES = ["翻译", "回答", "自由"] as const;
const LENGTH_OPTIONS = ["精辟", "中等", "正常"] as const;
const THEME_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
] as const;
const THINKING_STEPS: Record<(typeof MODES)[number], string[]> = {
  翻译: ["正在拆解原话", "正在替换正常逻辑", "正在校对生成结果", "译文有点烫，正在吹凉"],
  回答: ["正在理解问题", "正在建立不必要的联系", "正在强行得出答案", "答案有点烫，正在吹凉"],
  自由: ["正在收集灵感", "正在放飞联想", "正在整理荒诞", "灵感有点烫，正在吹凉"],
};
const MAX_CHARS = MAX_TOPIC_LENGTH;

type UsageStats = { nonsenseValue: number };

type BlahBlahRuntimeWindow = Window & {
  __BLAHBLAH_TOY_RELAY_URL__?: string;
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

function toyRelayUrl(): string {
  if (typeof window === "undefined") return "";
  return ((window as BlahBlahRuntimeWindow).__BLAHBLAH_TOY_RELAY_URL__ ?? "").replace(/\/+$/, "");
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
  const [mechanism, setMechanism] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "thinking" | "success" | "error">("idle");
  const [thinkingStep, setThinkingStep] = useState(0);
  const [message, setMessage] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [animKey, setAnimKey] = useState(0);
  const [theme, setTheme] = useState<ThemePreference>(() => readThemeLocal());
  const [activeTab, setActiveTab] = useState<"home" | "rank" | "mine">("home");
  /** Whether the composer's mode/length options are expanded. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Whether the 游戏说明 modal is open. */
  const [helpOpen, setHelpOpen] = useState(false);
  /** Whether the 更新日志 modal is open. */
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [achievementToast, setAchievementToast] = useState<Achievement | null>(null);
  const [history, setHistory] = useState<GenerationHistoryItem[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [profile, setProfile] = useState<ToyUserProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardSnapshot | null>(null);
  const [leaderboardState, setLeaderboardState] = useState<
    "idle" | "loading" | "ready" | "failed" | "unsupported"
  >("idle");
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const changelogButtonRef = useRef<HTMLButtonElement>(null);
  const changelogCloseRef = useRef<HTMLButtonElement>(null);
  /** Whether each dialog has been opened at least once, so closing it returns
   * focus to its button without stealing focus on first mount. */
  const helpWasOpenRef = useRef(false);
  const changelogWasOpenRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  /** How many `h-N` slots the cloud currently holds, so shrinking history can
   * trim the orphaned keys. */
  const cloudHistorySlotsRef = useRef(0);
  /** Serializes cloud writes so overlapping history changes can't interleave a
   * stale snapshot over a newer one. */
  const cloudPersistQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  /** Lets a stale refresh know it has been superseded. */
  const leaderboardSeqRef = useRef(0);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setStats({ nonsenseValue: readNonsenseValueLocal() }),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  /* Cross-device sync: merge the local cache and Toy KV by maximum value. The
     old gen-count KV is read inside loadNonsenseValueCloud for migration. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cloudTheme, cloudValue] = await Promise.all([
        loadThemeCloud(),
        loadNonsenseValueCloud(),
      ]);
      if (cancelled) return;
      if (cloudTheme) {
        setTheme(cloudTheme);
        writeThemeLocal(cloudTheme);
      }
      const localValue = readNonsenseValueLocal();
      const mergedValue = Math.max(localValue, cloudValue ?? 0);
      writeNonsenseValueLocal(mergedValue);
      setStats({ nonsenseValue: mergedValue });
      if (cloudValue !== mergedValue) {
        void saveNonsenseValueCloud(mergedValue);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    if (!achievementToast) return;
    const timer = window.setTimeout(() => setAchievementToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [achievementToast]);

  /* Best-effort login detection: reuses an existing profile consent without a
     gesture; the first-time consent dialog is requested when 我的 opens. */
  useEffect(() => {
    void fetchUserProfile().then(setProfile);
  }, []);

  /* Generation history is login-only cloud sync (no localStorage fallback):
     guests simply have no history. History lives in the SDK cloud storage
     (per-user, within the 128-key quota). History text never reaches the
     stats API. */
  useEffect(() => {
    let cancelled = false;
    const loadTimer = window.setTimeout(() => {
      void (async () => {
        const cloud = await loadCloudHistory();
        if (cancelled) return;
        cloudHistorySlotsRef.current = cloud?.length ?? 0;
        // Merge — never replace — so an entry generated while the cloud read
        // was still in flight isn't dropped.
        setHistory((current) => mergeHistory(current, cloud ?? []));
        setHistoryReady(true);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
    };
  }, []);

  useEffect(() => {
    if (!historyReady) return;
    // Serialize cloud writes: each queued task re-reads the slot count at run
    // time, so overlapping history changes can't interleave a stale snapshot
    // over a newer one.
    cloudPersistQueueRef.current = cloudPersistQueueRef.current.then(async () => {
      const slots = await persistCloudHistory(history, cloudHistorySlotsRef.current);
      cloudHistorySlotsRef.current = slots;
    });
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

  /* copy feedback timer cleanup */
  useEffect(
    () => () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
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

  /* ── 弹窗（游戏说明 / 更新日志）: Escape to close, lock body scroll ── */
  useEffect(() => {
    if (!helpOpen && !changelogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
        setChangelogOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [helpOpen, changelogOpen]);

  /* Move focus into the open dialog, back to its button on close. */
  useEffect(() => {
    if (helpOpen) {
      helpWasOpenRef.current = true;
      helpCloseRef.current?.focus();
    } else if (helpWasOpenRef.current) {
      helpWasOpenRef.current = false;
      helpButtonRef.current?.focus();
    }
    if (changelogOpen) {
      changelogWasOpenRef.current = true;
      changelogCloseRef.current?.focus();
    } else if (changelogWasOpenRef.current) {
      changelogWasOpenRef.current = false;
      changelogButtonRef.current?.focus();
    }
  }, [helpOpen, changelogOpen]);

  /* ── Generate ────────────────────────────────── */
  /** Auto-grow the topic textarea with content: 1 line → 1-line height, up to
   * 4 lines, then it scrolls inside the box (CSS caps max-height). */
  const resizeTopicInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (activeTab === "home") resizeTopicInput();
  }, [activeTab, topic, resizeTopicInput]);
  const generate = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (status === "thinking") return;
      const clean = topic.replace(/\s+/g, " ").trim();

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
        const relay = toyRelayUrl();
        let generatedText = "";
        let generatedMechanism: string | null = null;

        if (relay) {
          const response = await fetch(`${relay}/generate`, {
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
            throw new Error(payload.error ?? "toy_relay_unavailable");
          }
          const data = (await response.json()) as { text?: string; mechanism?: string | null };
          generatedText = data.text?.trim() ?? "";
          generatedMechanism =
            typeof data.mechanism === "string" && data.mechanism.trim()
              ? data.mechanism.trim()
              : null;
        } else {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 320));
          if (controller.signal.aborted) return;
          generatedText = generateStandaloneText(clean, mode, generationLength).trim();
        }

        if (controller.signal.aborted) return;

        if (!generatedText) throw new Error("empty");
        setResult(generatedText);
        setMechanism(generatedMechanism);
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
        if (generatedMechanism) historyItem.mechanism = generatedMechanism;
        setHistory((items) => prependHistory(items, historyItem));
        const previousValue = readNonsenseValueLocal();
        const nextValue = previousValue + 1;
        writeNonsenseValueLocal(nextValue);
        setStats({ nonsenseValue: nextValue });
        void saveNonsenseValueCloud(nextValue);
        const unlockedAchievement = newlyUnlockedAchievement(previousValue, nextValue);
        if (unlockedAchievement) setAchievementToast(unlockedAchievement);
        // Report every successful generation so a user who stops after this
        // result is not left one or more points behind. It remains best-effort
        // and never blocks the result shown.
        void submitLeaderboardScore(nextValue);
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
        } else if (err instanceof Error && err.message === "provider_not_configured") {
          setMessage("AI 服务正在配置中，请稍后再试。");
        } else if (err instanceof Error && err.message === "upstream_unavailable") {
          setMessage("AI 服务暂时不可用，请稍后再试。");
        } else {
          setMessage("这次没有生成出来，请再试一次。");
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [topic, mode, generationLength, status],
  );

  /* ── Mode switching ───────────────────────────── */
  const changeMode = useCallback((nextMode: (typeof MODES)[number]) => {
    setMode(nextMode);
    setResult("");
    setMechanism(null);
    setStatus("idle");
    setMessage("");
    setSettingsOpen(false);
  }, []);

  const restoreHistory = useCallback((item: GenerationHistoryItem) => {
    abortRef.current?.abort();
    setTopic(item.topic);
    setMode(item.mode);
    setGenerationLength(item.length);
    setResult(item.text);
    setMechanism(item.mechanism ?? null);
    setStatus("success");
    setMessage("");
    setCopyState("idle");
    setAnimKey((key) => key + 1);
    setActiveTab("home");
  }, []);

  const removeHistoryItem = useCallback((id: string) => {
    setHistory((items) => items.filter((item) => item.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    if (!window.confirm("确定清空全部历史记录吗？")) return;
    setHistory([]);
  }, []);

  /* ── 胡言乱语榜 — canonical 胡言乱语值 via Toy SDK board 1 ── */
  const refreshLeaderboard = useCallback(async () => {
    const seq = ++leaderboardSeqRef.current;
    if (typeof window === "undefined" || !window.toy) {
      if (seq !== leaderboardSeqRef.current) return;
      setLeaderboardState("unsupported");
      setLeaderboard(null);
      return;
    }
    setLeaderboardState("loading");
    const snapshot = await fetchLeaderboard(period);
    if (seq !== leaderboardSeqRef.current) return; // superseded by a newer refresh
    if (!snapshot) {
      setLeaderboardState("failed");
      setLeaderboard(null);
      return;
    }
    setLeaderboard(snapshot);
    setLeaderboardState("ready");
  }, [period]);

  /* Fetch the board when the 排行 tab opens or its period changes. */
  useEffect(() => {
    if (activeTab !== "rank") return;
    void refreshLeaderboard();
  }, [activeTab, refreshLeaderboard]);

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

  /* ── Derived state ───────────────────────────── */
  const isOverLimit = topic.length > MAX_CHARS;
  const hasResult = result !== "";
  const nonsenseValue = stats?.nonsenseValue ?? 0;
  const currentAchievement = achievementForValue(nonsenseValue);
  const nextAchievement = nextAchievementForValue(nonsenseValue);
  const displayedAchievement = currentAchievement ?? ACHIEVEMENTS[0];
  const progress = achievementProgress(nonsenseValue);

  /* ── Render ──────────────────────────────────── */
  return (
    <div className="app-shell">
      <div className="page-frame">
        {/* ── Main Content ──────────────────────── */}
        <div className={`main-content tab-${activeTab}`}>
          {activeTab === "home" && (
            <>
          {/* ── 游戏说明 / 更新日志 (top corners) ─────── */}
          <div className="home-topbar">
            <button
              ref={helpButtonRef}
              type="button"
              className="help-button"
              onClick={() => setHelpOpen(true)}
            >
              <svg className="help-button-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
                <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.8" />
                <path d="M12 17h.01" />
              </svg>
              游戏说明
            </button>
            <button
              ref={changelogButtonRef}
              type="button"
              className="help-button"
              onClick={() => setChangelogOpen(true)}
            >
              <svg className="help-button-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 8v4l3 2M5.4 5.4A9 9 0 1 1 3 12" />
                <path d="M3 5v4h4" />
              </svg>
              更新日志
            </button>
          </div>

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
                </div>
              </>
            )}
          </section>

          {/* ── Composer — 单一输入区 + 下方「生成」按钮 ── */}
          <div className="composer-block">
          <form id="gen-form" className="composer" onSubmit={generate}>
            <button
              type="button"
              className="composer-settings"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              aria-controls="composer-options"
              aria-label={`模式 ${mode}，点击切换`}
            >
              <span className="composer-settings-label">
                {mode}
                <span
                  className={`composer-settings-arrow${settingsOpen ? " open" : ""}`}
                  aria-hidden="true"
                >
                  ▾
                </span>
                {generationLength}
              </span>
            </button>

            <div
              id="composer-options"
              className={`composer-options${settingsOpen ? " open" : ""}`}
            >
              <fieldset className="mode-block composer-segment" disabled={status === "thinking"}>
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
                      onClick={() => changeMode(value)}
                      onKeyDown={(event) => {
                        const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? 1
                          : event.key === "ArrowLeft" || event.key === "ArrowUp"
                            ? -1
                            : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const nextIndex = (index + direction + MODES.length) % MODES.length;
                        changeMode(MODES[nextIndex]);
                        const options = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".mode-option");
                        options?.[nextIndex]?.focus();
                      }}
                    >
                      <span>{value}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="length-block composer-segment" disabled={status === "thinking"}>
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

            <div className="composer-input-row">
              <textarea
                ref={inputRef}
                id="topic"
                className="topic-input"
                rows={1}
                value={topic}
                maxLength={MAX_CHARS + 1}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={
                  mode === "翻译"
                    ? "输入一句话"
                    : mode === "回答"
                      ? "输入一个问题"
                      : "输入一个灵感"
                }
                autoComplete="off"
                spellCheck={false}
                aria-describedby="char-count"
                aria-invalid={isOverLimit || undefined}
                onKeyDown={(event) => {
                  // 回车提交，Shift+回车换行
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void generate();
                  }
                }}
              />
            </div>

            <div className="composer-footer">
              <span
                id="char-count"
                role="status"
                className={`char-count${isOverLimit ? " over-limit" : ""}`}
              >
                {topic.length}/{MAX_CHARS}
              </span>
            </div>
          </form>

            <button
              className="primary-button"
              type="submit"
              form="gen-form"
              aria-disabled={status === "thinking" || undefined}
              aria-label={status === "thinking" ? `正在${mode}……` : `开始${mode}`}
            >
              <span>{status === "thinking" ? `正在${mode}……` : `开始${mode}`}</span>
            </button>
          </div>
            </>
          )}

          {activeTab === "rank" && (
            <section className="tab-page" aria-label="排行">
              <h2 className="tab-page-title">胡言乱语榜</h2>

              <div className="period-switch" role="radiogroup" aria-label="统计周期">
                {LEADERBOARD_PERIODS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    role="radio"
                    className={`period-option${period === entry.value ? " active" : ""}`}
                    aria-checked={period === entry.value}
                    onClick={() => setPeriod(entry.value)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              {leaderboardState === "loading" && (
                <p className="leaderboard-empty">榜单加载中…</p>
              )}
              {leaderboardState === "failed" && (
                <p className="leaderboard-empty">榜单暂时不可用，请稍后再试。</p>
              )}
              {leaderboardState === "unsupported" && (
                <p className="leaderboard-empty">当前环境暂不支持胡言乱语榜。</p>
              )}
              {leaderboardState === "ready" && leaderboard && (
                <>
                  {leaderboard.list.length === 0 ? (
                    <p className="leaderboard-empty">这个周期还没有人上榜，来做第一个。</p>
                  ) : (
                    <ol className="leaderboard-list">
                      {leaderboard.list.map((row) => (
                        <li key={row.rank} className="leaderboard-row">
                          <span
                            className={`leaderboard-rank${
                              row.rank <= 3 ? ` top-${row.rank}` : ""
                            }`}
                          >
                            {row.rank}
                          </span>
                          <img
                            className="leaderboard-avatar"
                            src={row.avatar}
                            alt=""
                            loading="lazy"
                            referrerPolicy="no-referrer"
                          />
                          <span className="leaderboard-name">{row.nickname}</span>
                          <span className="leaderboard-score">{formatStat(row.score)} 点</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="leaderboard-mine" role="status">
                    {!profile
                      ? "登录后可参与胡言乱语榜。"
                      : leaderboard.mine?.ranked
                        ? `我的排名：#${leaderboard.mine.rank} · ${formatStat(leaderboard.mine.score)} 点`
                        : "我还没上榜，多积累一些胡言乱语值试试。"}
                  </p>
                </>
              )}
            </section>
          )}

          {activeTab === "mine" && (
            <section className="tab-page" aria-label="我的">
              <div className="profile-card">
                {profile ? (
                  <img
                    className="profile-avatar"
                    src={profile.avatar}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="profile-avatar profile-avatar-empty" aria-hidden="true" />
                )}
                <div className="profile-meta">
                  <span className="profile-name">{profile ? profile.nickname : "未登录"}</span>
                  <span className="profile-count">
                    胡言乱语值 {stats ? formatStat(stats.nonsenseValue) : "—"}
                  </span>
                  <span className="profile-note">
                    {profile ? "已同步到 Toy KV" : "登录后同步排行榜、成就与历史记录"}
                  </span>
                </div>
                {!profile && (
                  <button
                    type="button"
                    className="profile-login-button"
                    onClick={() => void fetchUserProfile().then(setProfile)}
                  >
                    登录
                  </button>
                )}
              </div>

              <section className="achievement-section" aria-labelledby="achievement-title">
                <div className="achievement-section-header">
                  <h3 id="achievement-title" className="micro-label">成就勋章</h3>
                  <span className="achievement-value">{formatStat(nonsenseValue)} 点</span>
                </div>

                <div className="achievement-current">
                  <img
                    className={`achievement-badge achievement-badge-large${currentAchievement ? "" : " locked"}`}
                    src={displayedAchievement.imageUrl}
                    alt={`${displayedAchievement.title}${currentAchievement ? "，已获得" : "，尚未获得"}`}
                  />
                  <div className="achievement-current-copy">
                    <span className="achievement-current-kicker">
                      {currentAchievement ? "当前成就" : "第一枚勋章"}
                    </span>
                    <strong>{displayedAchievement.title}</strong>
                    <p>{displayedAchievement.description}</p>
                    <div
                      className="achievement-progress"
                      role="progressbar"
                      aria-label={nextAchievement ? `距离${nextAchievement.title}的进度` : "成就完成进度"}
                      aria-valuemin={0}
                      aria-valuemax={(nextAchievement?.requiredValue ?? nonsenseValue) || 1}
                      aria-valuenow={Math.min(
                        nonsenseValue,
                        nextAchievement?.requiredValue ?? nonsenseValue,
                      )}
                    >
                      <span style={{ transform: `scaleX(${progress})` }} />
                    </div>
                    <span className="achievement-next-copy">
                      {nextAchievement
                        ? `再获得 ${nextAchievement.requiredValue - nonsenseValue} 点，解锁「${nextAchievement.title}」`
                        : "全部成就已获得"}
                    </span>
                  </div>
                </div>

                <ul className="achievement-grid" aria-label="全部成就">
                  {ACHIEVEMENTS.map((achievement) => {
                    const unlocked = nonsenseValue >= achievement.requiredValue;
                    return (
                      <li
                        key={achievement.id}
                        className={`achievement-card${unlocked ? " unlocked" : " locked"}`}
                        aria-label={`${achievement.title}，${unlocked ? "已获得" : `需要 ${achievement.requiredValue} 点`}`}
                      >
                        <img
                          className="achievement-badge"
                          src={achievement.imageUrl}
                          alt=""
                          loading="lazy"
                        />
                        <div className="achievement-card-copy">
                          <strong>{achievement.title}</strong>
                          <span>{achievement.requiredValue} 点</span>
                          <p>{achievement.description}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

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
                      onClick={() => {
                        setTheme(option.value);
                        writeThemeLocal(option.value);
                        void saveThemeCloud(option.value);
                      }}
                      onKeyDown={(event) => {
                        const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? 1
                          : event.key === "ArrowLeft" || event.key === "ArrowUp"
                            ? -1
                            : 0;
                        if (!direction) return;
                        event.preventDefault();
                        const nextIndex = (index + direction + THEME_OPTIONS.length) % THEME_OPTIONS.length;
                        const nextTheme = THEME_OPTIONS[nextIndex].value;
                        setTheme(nextTheme);
                        writeThemeLocal(nextTheme);
                        void saveThemeCloud(nextTheme);
                        const options = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".theme-option");
                        options?.[nextIndex]?.focus();
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <section className="history-section" aria-label="历史记录">
                <div className="history-section-header">
                  <h3 className="micro-label">历史记录</h3>
                  <div className="history-section-actions">
                    <span className="history-count-label">
                      {profile ? `${history.length}/${HISTORY_LIMIT}` : "登录后可见"}
                    </span>
                    {profile && history.length > 0 && (
                      <button type="button" onClick={clearHistory}>清空</button>
                    )}
                  </div>
                </div>
                {!profile ? (
                  <p className="history-empty">登录后可查看和同步历史记录</p>
                ) : history.length === 0 ? (
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
              </section>
            </section>
          )}
        </div>
      </div>

      <nav className="tab-bar" aria-label="页面导航">
          <button
            type="button"
            className={`tab-item${activeTab === "home" ? " active" : ""}`}
            onClick={() => setActiveTab("home")}
            aria-current={activeTab === "home" ? "page" : undefined}
          >
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11.2 12 3l9 8.2M5.4 9.7V21h13.2V9.7" />
            </svg>
            <span>主页</span>
          </button>
          <button
            type="button"
            className={`tab-item${activeTab === "rank" ? " active" : ""}`}
            onClick={() => setActiveTab("rank")}
            aria-current={activeTab === "rank" ? "page" : undefined}
          >
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
              <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
            </svg>
            <span>排行</span>
          </button>
          <button
            type="button"
            className={`tab-item${activeTab === "mine" ? " active" : ""}`}
            onClick={() => {
              setActiveTab("mine");
              // Gesture context — lets the platform show the first-time
              // profile consent dialog if it hasn't been granted yet.
              void fetchUserProfile().then(setProfile);
            }}
            aria-current={activeTab === "mine" ? "page" : undefined}
          >
            <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.6 3.9-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
            </svg>
            <span>我的</span>
          </button>
      </nav>

      {achievementToast && (
        <div className="achievement-toast" role="status" aria-live="polite">
          <img
            className="achievement-badge achievement-toast-badge"
            src={achievementToast.imageUrl}
            alt=""
            aria-hidden="true"
          />
          <span>
            <small>新成就已获得</small>
            <strong>{achievementToast.title}</strong>
          </span>
        </div>
      )}

      {/* ── 游戏说明 modal ──────────────────────── */}
      {helpOpen && (
        <div className="help-overlay" onClick={() => setHelpOpen(false)}>
          <div
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="游戏说明"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="help-header">
              <h2 className="help-title">游戏说明</h2>
              <button
                ref={helpCloseRef}
                type="button"
                className="help-close"
                onClick={() => setHelpOpen(false)}
                aria-label="关闭游戏说明"
              >
                ×
              </button>
            </div>
            <div className="help-body">
              <section className="help-section">
                <h3>怎么玩</h3>
                <ol>
                  <li>在输入框写一句话、一个问题或一个灵感。</li>
                  <li>点输入框上方的「翻译 · 正常」按钮，切换模式和长度。</li>
                  <li>点「开始生成」，得到一句胡言乱语。</li>
                  <li>每次有效生成会增加 1 点胡言乱语值，并自动计入排行榜。</li>
                </ol>
              </section>
              <section className="help-section">
                <h3>模式</h3>
                <dl>
                  <dt>翻译</dt>
                  <dd>把原话改写成胡话，事实和态度不变，读者能猜回原话。</dd>
                  <dt>回答</dt>
                  <dd>直接回答你的问题，答案一本正经地荒谬。</dd>
                  <dt>自由</dt>
                  <dd>把输入当灵感自由发挥，只求一句和输入有关的荒诞话。</dd>
                </dl>
              </section>
              <section className="help-section">
                <h3>长度</h3>
                <dl>
                  <dt>精辟</dt>
                  <dd>4–8 个字左右，一句话直接落点。</dd>
                  <dt>中等</dt>
                  <dd>12–24 个字左右，一个事实加一次转折。</dd>
                  <dt>正常</dt>
                  <dd>25–48 个字左右，一次铺垫、一次转折、立即收尾。</dd>
                </dl>
              </section>
              <section className="help-section">
                <h3>排行榜</h3>
                <dl>
                  <dt>胡言乱语榜</dt>
                  <dd>按胡言乱语值排名，提供总榜 / 月榜 / 周榜 / 日榜。</dd>
                </dl>
              </section>
              <section className="help-section">
                <h3>登录</h3>
                <p>登录后可以参与胡言乱语榜，历史记录也会同步到云端。</p>
              </section>
            </div>
          </div>
        </div>
      )}
      {/* ── 更新日志 modal ──────────────────────── */}
      {changelogOpen && (
        <div className="help-overlay" onClick={() => setChangelogOpen(false)}>
          <div
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="更新日志"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="help-header">
              <h2 className="help-title">更新日志</h2>
              <button
                ref={changelogCloseRef}
                type="button"
                className="help-close"
                onClick={() => setChangelogOpen(false)}
                aria-label="关闭更新日志"
              >
                ×
              </button>
            </div>
            <div className="help-body changelog-body">
              {CHANGELOG.map((entry) => (
                <section className="changelog-entry" key={entry.version}>
                  <h3 className="changelog-version">
                    {entry.version}
                    <time dateTime={entry.date}>{entry.date}</time>
                  </h3>
                  <ul className="changelog-list">
                    {entry.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
