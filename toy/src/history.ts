import { MAX_TOPIC_LENGTH } from "../../shared/generate/validation.ts";

export const HISTORY_LIMIT = 20;

export type HistoryMode = "翻译" | "回答" | "自由";
export type HistoryLength = "精辟" | "中等" | "正常";

export interface GenerationHistoryItem {
  id: string;
  createdAt: number;
  topic: string;
  text: string;
  mode: HistoryMode;
  length: HistoryLength;
  /** Winning mechanism name from the relay, so a restored result can still be
   * voted on. Absent for old entries and standalone-local results. */
  mechanism?: string;
}

const MODES: readonly HistoryMode[] = ["翻译", "回答", "自由"];
const LENGTHS: readonly HistoryLength[] = ["精辟", "中等", "正常"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHistoryMode(value: unknown): value is HistoryMode {
  return typeof value === "string" && MODES.includes(value as HistoryMode);
}

function isHistoryLength(value: unknown): value is HistoryLength {
  return typeof value === "string" && LENGTHS.includes(value as HistoryLength);
}

function toHistoryItem(value: unknown): GenerationHistoryItem | null {
  if (!isRecord(value)) return null;
  const { id, createdAt, topic, text, mode, length, mechanism } = value;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 100 ||
    typeof createdAt !== "number" ||
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0 ||
    typeof topic !== "string" ||
    topic.length === 0 ||
    topic.length > MAX_TOPIC_LENGTH ||
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > 500 ||
    !isHistoryMode(mode) ||
    !isHistoryLength(length)
  ) {
    return null;
  }
  const item: GenerationHistoryItem = { id, createdAt, topic, text, mode, length };
  if (typeof mechanism === "string" && mechanism.length > 0 && mechanism.length <= 20) {
    item.mechanism = mechanism;
  }
  return item;
}

/** Parse a single serialized entry (cloud storage stores one entry per key). */
export function parseHistoryEntry(raw: string): GenerationHistoryItem | null {
  try {
    return toHistoryItem(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function prependHistory(
  items: GenerationHistoryItem[],
  item: GenerationHistoryItem,
): GenerationHistoryItem[] {
  return [item, ...items.filter((existing) => existing.id !== item.id)].slice(0, HISTORY_LIMIT);
}

/** Merge the currently-visible entries (those generated while the initial load
 * was still in flight) in front of the authoritative loaded list. Used only on
 * first load so a fast generation isn't overwritten by the load result. */
export function mergeHistory(
  current: GenerationHistoryItem[],
  loaded: GenerationHistoryItem[],
): GenerationHistoryItem[] {
  const seen = new Set<string>();
  const merged: GenerationHistoryItem[] = [];
  for (const item of [...current, ...loaded]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length >= HISTORY_LIMIT) break;
  }
  return merged;
}
