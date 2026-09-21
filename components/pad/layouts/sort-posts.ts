import type {
  PadSortMode,
  LayoutPost,
} from "@/components/pad/layouts/types";

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sortLayoutPosts<Post extends LayoutPost>(
  posts: Post[],
  mode: PadSortMode,
  newPostPlacement: "START" | "END",
) {
  const sorted = [...posts];
  sorted.sort((left, right) => {
    if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
    switch (mode) {
      case "CREATED_ASC":
        return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
      case "CREATED_DESC":
        return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
      case "TITLE":
        return (left.title ?? "").localeCompare(right.title ?? "", "ko") || left.id.localeCompare(right.id);
      case "RANDOM":
        return stableHash(left.id) - stableHash(right.id) || left.id.localeCompare(right.id);
      default:
        return (left.position - right.position) || left.id.localeCompare(right.id);
    }
  });
  if (mode === "MANUAL" && newPostPlacement === "START") {
    const pinned = sorted.filter((post) => post.isPinned);
    const regular = sorted.filter((post) => !post.isPinned).reverse();
    return [...pinned, ...regular];
  }
  return sorted;
}
