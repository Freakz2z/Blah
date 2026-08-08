/**
 * Cloud-storage-backed generation history sync.
 *
 * History lives per (logged-in user, Toy) in the Toy JS SDK's cloud storage —
 * the 128-key-per-user quota comfortably holds the 20 history entries plus a
 * few preference keys. One key per entry — `h-0`…`h-19`, newest first —
 * because a single key's 1024-byte value cap cannot hold all 20 entries and
 * per-entry keys preserve the same 20-item limit as the localStorage mirror.
 *
 * The SDK object is injectable for tests; production defaults to `window.toy`.
 * Every entry point degrades silently: no SDK, not logged in, or an API
 * failure must never block generation — the caller treats a failed load as an
 * empty history (history is login-only; guests simply have none).
 */

import {
  HISTORY_LIMIT,
  parseHistoryEntry,
  type GenerationHistoryItem,
} from "./history.ts";

export const CLOUD_HISTORY_KEY_PREFIX = "h-";

/** SDK value cap is 1024 bytes; this margin leaves room for JSON/encoding
 * growth and keeps worst-case Chinese-heavy entries comfortably inside. */
const MAX_CLOUD_ENTRY_BYTES = 900;

/** A hanging JSB bridge must not block the history load forever. */
export const CLOUD_LOAD_TIMEOUT_MS = 4000;

export interface ToyHistorySdk {
  getCloudStorage(keys?: string[]): Promise<Record<string, string>>;
  setCloudStorage(items: Record<string, string>): Promise<void>;
  removeCloudStorage(keys: string[]): Promise<void>;
}

function toySdk(): ToyHistorySdk | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { toy?: unknown }).toy;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as ToyHistorySdk).getCloudStorage !== "function"
  ) {
    return null;
  }
  return candidate as ToyHistorySdk;
}

export function cloudHistoryKey(index: number): string {
  return `${CLOUD_HISTORY_KEY_PREFIX}${index}`;
}

/** Newest-first entries → `{ "h-0": json, "h-1": json, … }`. Entries whose
 * serialized form would exceed the SDK byte cap are skipped (defensive: the
 * length contract caps generated text at 48 chars, but legacy localStorage
 * entries can be longer). */
export function historyToCloudRecord(
  items: GenerationHistoryItem[],
): Record<string, string> {
  const record: Record<string, string> = {};
  const encoder = new TextEncoder();
  let slot = 0;
  for (const item of items.slice(0, HISTORY_LIMIT)) {
    const json = JSON.stringify(item);
    if (encoder.encode(json).length > MAX_CLOUD_ENTRY_BYTES) continue;
    record[cloudHistoryKey(slot)] = json;
    slot += 1;
  }
  return record;
}

/** Cloud record → newest-first entries. Keys are sorted by slot number, so a
 * gap left by a failed write degrades to fewer entries instead of disorder. */
export function cloudRecordToHistory(
  record: Record<string, string>,
): GenerationHistoryItem[] {
  const slots = Object.keys(record)
    .filter((key) => key.startsWith(CLOUD_HISTORY_KEY_PREFIX))
    .map((key) => Number(key.slice(CLOUD_HISTORY_KEY_PREFIX.length)))
    .filter((slot) => Number.isSafeInteger(slot) && slot >= 0)
    .sort((a, b) => a - b);
  const items: GenerationHistoryItem[] = [];
  for (const slot of slots) {
    const item = parseHistoryEntry(record[cloudHistoryKey(slot)] ?? "");
    if (item) items.push(item);
    if (items.length >= HISTORY_LIMIT) break;
  }
  return items;
}

/** Keys to delete when the history shrinks: any slot between the new record's
 * count and the previously-known count. */
export function cloudKeysToRemove(
  record: Record<string, string>,
  previousSlots: number,
): string[] {
  const keys: string[] = [];
  for (let slot = Object.keys(record).length; slot < previousSlots; slot++) {
    keys.push(cloudHistoryKey(slot));
  }
  return keys;
}

/** Upsert the whole history and trim orphan slots. Returns the new slot count
 * (unchanged on failure) so the caller can track trimming state. */
export async function persistCloudHistory(
  items: GenerationHistoryItem[],
  previousSlots: number,
  sdk: ToyHistorySdk | null = toySdk(),
): Promise<number> {
  if (!sdk) return previousSlots;
  try {
    const record = historyToCloudRecord(items);
    await sdk.setCloudStorage(record);
    const remove = cloudKeysToRemove(record, previousSlots);
    if (remove.length > 0) await sdk.removeCloudStorage(remove);
    return Object.keys(record).length;
  } catch {
    return previousSlots;
  }
}

/** Load the cloud history. Returns `null` when unavailable (no SDK, not logged
 * in, timed out, or the call failed) so the caller can fall back to an empty
 * history — an empty cloud record is authoritative and returns `[]`. */
export async function loadCloudHistory(
  sdk: ToyHistorySdk | null = toySdk(),
  timeoutMs: number = CLOUD_LOAD_TIMEOUT_MS,
): Promise<GenerationHistoryItem[] | null> {
  if (!sdk) return null;
  try {
    const record = await new Promise<Record<string, string>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("cloud_load_timeout")), timeoutMs);
      sdk.getCloudStorage().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
    return cloudRecordToHistory(record);
  } catch {
    return null;
  }
}
