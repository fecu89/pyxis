import type {
  DefaultReactionKey,
  ReactionCounts,
  ReactionKey,
  ReactionPolicy,
} from "@/lib/reactions/types";

const defaultKeys = new Set<DefaultReactionKey>(["LIKE", "HEART", "CELEBRATE", "LAUGH", "WOW"]);
const emojiPrefix = "EMOJI:";
const emojiLikePattern = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u;
const forbiddenCharacterPattern = /[\p{Cc}\p{Zl}\p{Zp}]/u;
const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });

export class ReactionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReactionValidationError";
  }
}

export function parseReactionPolicy(value: unknown): ReactionPolicy {
  if (value === "SINGLE" || value === "MULTIPLE") return value;
  throw new ReactionValidationError("지원하지 않는 반응 정책입니다.");
}

export function parseReactionKey(value: unknown): ReactionKey {
  if (typeof value !== "string") throw new ReactionValidationError("반응 키는 문자열이어야 합니다.");
  const normalized = value.trim().normalize("NFC");
  if (defaultKeys.has(normalized as DefaultReactionKey)) return normalized as DefaultReactionKey;
  if (!normalized.startsWith(emojiPrefix)) throw new ReactionValidationError("지원하지 않는 반응 키입니다.");

  const emoji = normalized.slice(emojiPrefix.length);
  if (!emoji || emoji.length > 64 || forbiddenCharacterPattern.test(emoji)) {
    throw new ReactionValidationError("이모지 반응 형식이 올바르지 않습니다.");
  }
  const graphemes = Array.from(segmenter.segment(emoji));
  if (graphemes.length !== 1 || graphemes[0]?.segment !== emoji || !emojiLikePattern.test(emoji)) {
    throw new ReactionValidationError("이모지 반응은 한 개의 이모지만 사용할 수 있습니다.");
  }
  return `${emojiPrefix}${emoji}`;
}

export function parseReactionCounts(value: unknown): ReactionCounts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReactionValidationError("반응 집계가 객체가 아닙니다.");
  }
  const entries = Object.entries(value);
  if (entries.length > 50) throw new ReactionValidationError("반응 종류가 너무 많습니다.");
  const counts: ReactionCounts = {};
  for (const [rawKey, rawCount] of entries) {
    const key = parseReactionKey(rawKey);
    if (counts[key] !== undefined) throw new ReactionValidationError("정규화 후 중복되는 반응 키가 있습니다.");
    if (!Number.isSafeInteger(rawCount) || Number(rawCount) < 0) {
      throw new ReactionValidationError("반응 집계는 0 이상의 안전한 정수여야 합니다.");
    }
    counts[key] = Number(rawCount);
  }
  return counts;
}
