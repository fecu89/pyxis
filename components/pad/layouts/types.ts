import type { CSSProperties, ReactNode } from "react";

export type PadLayoutKind = "SECTIONS" | "WALL" | "GRID" | "STREAM" | "TIMELINE" | "TABLE";
export type PadSortMode = "MANUAL" | "CREATED_ASC" | "CREATED_DESC" | "TITLE" | "RANDOM";
export type PadCardSize = "SMALL" | "MEDIUM" | "LARGE";
export type PadFont = "SANS" | "SERIF" | "MONO";

export type LayoutPost = {
  id: string;
  title: string | null;
  position: number;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LayoutSection<Post extends LayoutPost = LayoutPost> = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  posts: Post[];
};

export type PostRenderContext<Post extends LayoutPost = LayoutPost> = {
  section: LayoutSection<Post>;
  index: number;
  dragDisabled: boolean;
};

export type LayoutTableColumn<Post extends LayoutPost = LayoutPost> = {
  key: string;
  label: string;
  render: (post: Post) => ReactNode;
};

export type LayoutRendererProps<Post extends LayoutPost = LayoutPost> = {
  layout: PadLayoutKind;
  sections: LayoutSection<Post>[];
  sortMode?: PadSortMode;
  newPostPlacement?: "START" | "END";
  appearance?: PadAppearance;
  renderPost: (post: Post, context: PostRenderContext<Post>) => ReactNode;
  renderAddPost?: (section: LayoutSection<Post>) => ReactNode;
  renderSectionActions?: (section: LayoutSection<Post>) => ReactNode;
  renderAddSection?: () => ReactNode;
  tableColumns?: LayoutTableColumn<Post>[];
  // 더블클릭하면 섹션 제목·안내 문구를 바꿀 수 있게 합니다(사용자 요청 — 레이아웃마다 따로
  // 편집 진입점을 만들지 않고 이 콜백 하나로 통일). 안 주면(예: 관리 권한이 없으면) 더블클릭이
  // 아무 동작도 하지 않습니다.
  onEditSection?: (section: LayoutSection<Post>) => void;
};

export type PadAppearance = {
  backgroundColor?: string | null;
  backgroundImageUrl?: string | null;
  accentColor?: string | null;
  cardSize?: PadCardSize;
  font?: PadFont;
  showAuthor?: boolean;
  showTimestamp?: boolean;
};

export type PadAppearanceStyle = CSSProperties & {
  "--board-accent"?: string;
  "--board-background"?: string;
  "--board-background-image"?: string;
};
