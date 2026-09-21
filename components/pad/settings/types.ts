import type {
  PadAppearance,
  PadLayoutKind,
  PadSortMode,
} from "@/components/pad/layouts/types";
import type { PostFieldConfig } from "@/lib/post-fields/types";

export type {
  CustomPostFieldDefinition,
  CustomPostFieldKind,
  PostFieldConfig,
  PostFieldValue,
  PostFieldValues,
  StoredPostFieldValue,
  StoredPostFieldValues,
  SystemPostFieldSettings,
} from "@/lib/post-fields/types";

export type PadPresentationSettings = PadAppearance & {
  layout: PadLayoutKind;
  sortMode: PadSortMode;
  newPostPlacement: "START" | "END";
};

export const defaultPostFieldConfig: PostFieldConfig = {
  version: 1,
  title: { visible: true, required: false, placeholder: "한눈에 들어오는 제목" },
  body: { visible: true, required: false, placeholder: "무엇을 발견했나요?" },
  attachment: { visible: true, required: false, placeholder: "이미지나 파일을 첨부하세요." },
  customFields: [],
};
