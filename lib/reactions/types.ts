export type DefaultReactionKey = "LIKE" | "HEART" | "CELEBRATE" | "LAUGH" | "WOW";
export type ReactionKey = DefaultReactionKey | `EMOJI:${string}`;
export type ReactionPolicy = "SINGLE" | "MULTIPLE";

export type ReactionCounts = Partial<Record<ReactionKey, number>>;

export const defaultReactionOptions: { key: DefaultReactionKey; emoji: string; label: string }[] = [
  { key: "LIKE", emoji: "👍", label: "좋아요" },
  { key: "HEART", emoji: "❤️", label: "하트" },
  { key: "CELEBRATE", emoji: "🎉", label: "축하" },
  { key: "LAUGH", emoji: "😄", label: "웃음" },
  { key: "WOW", emoji: "😮", label: "놀라워요" },
];
