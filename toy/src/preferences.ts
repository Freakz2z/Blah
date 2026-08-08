/**
 * Per-user cross-device preferences via the Toy JS SDK cloud storage, with
 * localStorage as a fast cache.
 *
 * The SDK cloud storage is isolated per (logged-in user, Toy) and follows the
 * login across devices — so the theme and the leaderboard's 胡言乱语值
 * sync across devices instead of living only in this browser's localStorage.
 * Every call degrades silently: no SDK, not logged in, or an API failure keeps
 * the localStorage cache as the source of truth.
 */

export const THEME_KEY = "theme";
export const NONSENSE_VALUE_KEY = "nonsense-value-v1";
export const LEGACY_COUNT_KEY = "gen-count";

const THEME_LOCAL_KEY = "blahblah:theme:v1";
const NONSENSE_VALUE_LOCAL_KEY = "blahblah:nonsense-value:v1";
const LEGACY_COUNT_LOCAL_KEY = "blahblah:toy-generation-count:v1";

export type ThemePreference = "auto" | "light" | "dark";

export interface ToyPrefsSdk {
  getCloudStorage(keys?: string[]): Promise<Record<string, string>>;
  setCloudStorage(items: Record<string, string>): Promise<void>;
}

function toySdk(): ToyPrefsSdk | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { toy?: unknown }).toy;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as ToyPrefsSdk).getCloudStorage !== "function"
  ) {
    return null;
  }
  return candidate as ToyPrefsSdk;
}

/* ── Theme ─────────────────────────────────────── */

export function readThemeLocal(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_LOCAL_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

export function writeThemeLocal(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_LOCAL_KEY, theme);
  } catch {
    // Private browsing must not block the theme.
  }
}

/** Load the cloud theme, or `null` when unavailable. */
export async function loadThemeCloud(
  sdk: ToyPrefsSdk | null = toySdk(),
): Promise<ThemePreference | null> {
  if (!sdk) return null;
  try {
    const record = await sdk.getCloudStorage([THEME_KEY]);
    const value = record[THEME_KEY];
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Best-effort cloud write of the theme. */
export async function saveThemeCloud(
  theme: ThemePreference,
  sdk: ToyPrefsSdk | null = toySdk(),
): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.setCloudStorage({ [THEME_KEY]: theme });
  } catch {
    // Best-effort — the localStorage cache still holds the value.
  }
}

/* ── 胡言乱语值（KV + 排行榜唯一分数）──────────── */

function parseNonsenseValue(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Read the canonical cache, falling back once to the old generation-count
 * cache so existing users keep their progress. */
export function readNonsenseValueLocal(): number {
  try {
    const current = parseNonsenseValue(
      window.localStorage.getItem(NONSENSE_VALUE_LOCAL_KEY),
    );
    if (current !== null) return current;
    return parseNonsenseValue(window.localStorage.getItem(LEGACY_COUNT_LOCAL_KEY)) ?? 0;
  } catch {
    return 0;
  }
}

export function writeNonsenseValueLocal(value: number): void {
  try {
    window.localStorage.setItem(NONSENSE_VALUE_LOCAL_KEY, String(value));
  } catch {
    // Private browsing must not block generation or achievements.
  }
}

/** Load the canonical KV value. When it does not exist yet, migrate from the
 * old `gen-count` key without making the user start over. */
export async function loadNonsenseValueCloud(
  sdk: ToyPrefsSdk | null = toySdk(),
): Promise<number | null> {
  if (!sdk) return null;
  try {
    const record = await sdk.getCloudStorage([NONSENSE_VALUE_KEY, LEGACY_COUNT_KEY]);
    return (
      parseNonsenseValue(record[NONSENSE_VALUE_KEY]) ??
      parseNonsenseValue(record[LEGACY_COUNT_KEY])
    );
  } catch {
    return null;
  }
}

/** Best-effort write of the leaderboard/achievement value to Toy KV. */
export async function saveNonsenseValueCloud(
  value: number,
  sdk: ToyPrefsSdk | null = toySdk(),
): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.setCloudStorage({ [NONSENSE_VALUE_KEY]: String(value) });
  } catch {
    // Best-effort — the localStorage cache still holds the value.
  }
}
