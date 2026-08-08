/**
 * Per-user cross-device preferences via the Toy JS SDK cloud storage, with
 * localStorage as a fast cache.
 *
 * The SDK cloud storage is isolated per (logged-in user, Toy) and follows the
 * login across devices — so the theme and the cumulative generation count
 * sync across devices instead of living only in this browser's localStorage.
 * Every call degrades silently: no SDK, not logged in, or an API failure keeps
 * the localStorage cache as the source of truth.
 */

export const THEME_KEY = "theme";
export const COUNT_KEY = "gen-count";

const THEME_LOCAL_KEY = "blahblah:theme:v1";
const COUNT_LOCAL_KEY = "blahblah:toy-generation-count:v1";

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

/* ── Generation count ──────────────────────────── */

export function readCountLocal(): number {
  try {
    const stored = Number(window.localStorage.getItem(COUNT_LOCAL_KEY) ?? "0");
    return Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
  } catch {
    return 0;
  }
}

export function writeCountLocal(count: number): void {
  try {
    window.localStorage.setItem(COUNT_LOCAL_KEY, String(count));
  } catch {
    // Private browsing must not block local generation.
  }
}

/** Load the cloud count, or `null` when unavailable. */
export async function loadCountCloud(
  sdk: ToyPrefsSdk | null = toySdk(),
): Promise<number | null> {
  if (!sdk) return null;
  try {
    const record = await sdk.getCloudStorage([COUNT_KEY]);
    const value = Number(record[COUNT_KEY]);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/** Best-effort cloud write of the count. */
export async function saveCountCloud(
  count: number,
  sdk: ToyPrefsSdk | null = toySdk(),
): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.setCloudStorage({ [COUNT_KEY]: String(count) });
  } catch {
    // Best-effort — the localStorage cache still holds the value.
  }
}
