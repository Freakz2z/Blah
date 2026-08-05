export const HISTORY_STORAGE_KEY = "blahblah:generation-history:v1";
export const HISTORY_LIMIT = 20;

export type HistoryMode = "翻译" | "回答";
export type HistoryLength = "精辟" | "中等" | "正常";

export interface GenerationHistoryItem {
  id: string;
  createdAt: number;
  topic: string;
  text: string;
  mode: HistoryMode;
  length: HistoryLength;
}

const MODES: readonly HistoryMode[] = ["翻译", "回答"];
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
  const { id, createdAt, topic, text, mode, length } = value;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 100 ||
    typeof createdAt !== "number" ||
    !Number.isSafeInteger(createdAt) ||
    createdAt <= 0 ||
    typeof topic !== "string" ||
    topic.length === 0 ||
    topic.length > 30 ||
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > 500 ||
    !isHistoryMode(mode) ||
    !isHistoryLength(length)
  ) {
    return null;
  }
  return { id, createdAt, topic, text, mode, length };
}

export function parseHistory(raw: string | null): GenerationHistoryItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toHistoryItem)
      .filter((item): item is GenerationHistoryItem => item !== null)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function serializeHistory(items: GenerationHistoryItem[]): string {
  return JSON.stringify(items.slice(0, HISTORY_LIMIT));
}

export function prependHistory(
  items: GenerationHistoryItem[],
  item: GenerationHistoryItem,
): GenerationHistoryItem[] {
  return [item, ...items.filter((existing) => existing.id !== item.id)].slice(0, HISTORY_LIMIT);
}
