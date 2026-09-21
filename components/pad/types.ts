import type { PostFieldConfig, StoredPostFieldValues } from "@/lib/post-fields/types";
import type { AttachmentViewData } from "@/components/pad/attachments/types";

export type PadRole = "OWNER" | "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER" | null;
export type PadDiscoveryScope = "PRIVATE" | "LINK" | "PUBLIC";
export type PadVisitorPermission = "NO_ACCESS" | "READER" | "COMMENTER" | "WRITER";
export type PadLayoutKind = "SECTIONS" | "WALL" | "GRID" | "STREAM" | "TIMELINE" | "TABLE";
export type PadSortMode = "MANUAL" | "CREATED_ASC" | "CREATED_DESC" | "TITLE" | "RANDOM";
export type ReactionKey = "LIKE" | "HEART" | "CELEBRATE" | "LAUGH" | "WOW" | `EMOJI:${string}`;

export type AttachmentData = {
  id: string;
  type: "IMAGE" | "PDF" | "DOCUMENT" | "VIDEO" | "AUDIO" | "FILE" | "LINK";
  originalName: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  externalUrl: string | null;
  previewImageUrl: string | null;
};

export type PostData = {
  id: string;
  title: string | null;
  body: string;
  bodyFormat: "MARKDOWN" | "PLAIN_TEXT";
  status: "PENDING" | "PUBLISHED" | "REJECTED";
  moderationReason: string | null;
  customFieldValues: StoredPostFieldValues | null;
  position: number;
  isPinned: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string | null; image: string | null; isGuest: boolean };
  /**
   * 이 글을 보고 있는 사람이 작성자 본인인지. 서버가 판정해 내려 줍니다.
   * 손님 글은 작성자 식별자(guestId)를 클라이언트로 내리지 않기 때문에 — 내리면 남의 손님
   * 식별자를 그대로 알게 됩니다 — 화면에서 id를 비교하는 대신 이 값을 씁니다.
   */
  isMine: boolean;
  attachments: AttachmentViewData[];
  viewerReacted: boolean;
  reactionCount: number;
  viewerReactions: ReactionKey[];
  reactionCounts: Partial<Record<ReactionKey, number>>;
  commentCount: number;
  /**
   * 카드에 바로 보여 줄 댓글(오래된 것부터, 최대 20개). 게시물을 열지 않아도 대화가 다 보이도록
   * 목록 조회가 함께 읽어 옵니다 — 카드에서 따로 요청하지 않습니다.
   */
  comments: CardComment[];
};

/** 카드용 축약 댓글. 멘션 자동완성·수정처럼 자리가 필요한 것은 상세 화면 몫입니다. */
export type CardComment = {
  id: string;
  body: string;
  createdAt: string;
  attachments: AttachmentViewData[];
  author: { id: string; name: string | null; image: string | null; isGuest: boolean };
  isMine: boolean;
};

export type SectionData = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  version: number;
  totalPostCount: number;
  /** 다음 게시물 페이지의 기준점. null/undefined면 이 섹션은 모두 받은 상태입니다. */
  nextCursor?: string | null;
  posts: PostData[];
};

export type PadData = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  discoveryScope: PadDiscoveryScope;
  visitorPermission: PadVisitorPermission;
  loginRequired: boolean;
  hasPassword: boolean;
  state: "ACTIVE" | "FROZEN";
  moderationMode: "NONE" | "MANUAL" | "STUDENTS_ONLY";
  /** 손님(비로그인) 글을 승인 후에만 공개할지. 전체 공개 + 방문자 쓰기일 때만 의미가 있습니다. */
  guestPostsRequireApproval: boolean;
  freezeAt: string | null;
  layout: PadLayoutKind;
  sortMode: PadSortMode;
  newPostPlacement: "START" | "END";
  cardSize: "SMALL" | "MEDIUM" | "LARGE";
  font: "SANS" | "SERIF" | "MONO";
  backgroundColor: string | null;
  backgroundImageUrl: string | null;
  accentColor: string | null;
  showAuthor: boolean;
  showTimestamp: boolean;
  reactionPolicy: "SINGLE" | "MULTIPLE";
  attachmentDownloadPolicy: "READERS" | "MEMBERS" | "EDITORS" | "DISABLED";
  postFieldConfig: PostFieldConfig;
  allowComments: boolean;
  allowReactions: boolean;
  allowMemberPosting: boolean;
  allowMemberFileUpload: boolean;
  owner: { id: string; name: string | null };
  // members는 미리보기(최대 MEMBER_PREVIEW_LIMIT명)만 담고 있습니다. 정확한 전체 인원수는
  // memberCount를 쓰고, 멤버 관리(역할 변경·제거)에는 GET /api/boards/[boardId]/members로
  // 따로 전체 목록을 불러옵니다(lib/board/queries.ts, pad-settings-tabs.tsx 참고).
  memberCount: number;
  members: { role: Exclude<PadRole, null>; user: { id: string; name: string | null; loginIdentifier: string | null; image: string | null } }[];
  sections: SectionData[];
};

/** 지금 이 패드를 보고 있는 사람. 로그인 사용자이거나, 이름만 남긴 손님이거나, 아무것도 아닙니다. */
export type PadViewer = {
  userId: string | null;
  /** 보드가 손님 글쓰기를 받는 상태인지. 이름 입력 안내를 띄울지 판단합니다. */
  guestWriteOpen: boolean;
  /** 이미 이름을 남긴 손님이면 그 이름. 아직이면 null이고, 글을 쓰려 할 때 물어봅니다. */
  guestName: string | null;
};

export type PadCapabilities = {
  manageBoard: boolean;
  archiveBoard: boolean;
  viewTrash: boolean;
  createPost: boolean;
  editAnyPost: boolean;
  /** 편집 없이 삭제만 가능한 MODERATE_CONTENT 운영 권한도 구분합니다. */
  deleteAnyPost?: boolean;
  editOwnContent: boolean;
  moderateComments: boolean;
  comment: boolean;
  react: boolean;
  moderatePosts: boolean;
  downloadAttachments: boolean;
};

export type PadInitialData = {
  board: PadData;
  currentRole: PadRole;
  isFavorite: boolean;
  capabilities: PadCapabilities;
  viewer: PadViewer;
  /**
   * 조회 시점에 이미 동결 상태였는지. `state === "FROZEN"`이거나 예약 시각(`freezeAt`)이 지난
   * 경우입니다. **서버가 조회할 때 계산합니다** — 렌더 도중 `Date.now()`를 부르면 서버와
   * 클라이언트의 첫 렌더가 갈릴 수 있고, React도 렌더를 순수하게 유지하라고 요구합니다.
   */
  initialFrozen: boolean;
};
