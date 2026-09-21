import type {
  LayoutPost,
  LayoutTableColumn,
} from "@/components/pad/layouts/types";
import type {
  PostFieldConfig,
  PostFieldValues,
} from "@/components/pad/settings/types";

function displayValue(value: PostFieldValues[string] | undefined) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  return value?.trim() || null;
}

export function createPostFieldTableColumns<Post extends LayoutPost>(
  config: PostFieldConfig,
  readValues: (post: Post) => PostFieldValues | null | undefined,
): LayoutTableColumn<Post>[] {
  return [...config.customFields]
    .filter((field) => !field.archived)
    .sort((left, right) => left.position - right.position)
    .map((field) => ({
      key: `custom:${field.id}:v${field.version}`,
      label: field.label,
      render: (post) => displayValue(readValues(post)?.[field.id]),
    }));
}
