import { z } from "zod";

const colorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable();

type BoardAccessSettings = {
  discoveryScope: "PRIVATE" | "LINK" | "PUBLIC";
  visitorPermission: "NO_ACCESS" | "READER" | "COMMENTER" | "WRITER";
  loginRequired: boolean;
};

// LINK는 비로그인 읽기가 기본이며, 관리자가 WRITER를 명시하면 손님 참여도 가능합니다.
export function normalizeBoardAccessSettings<T extends BoardAccessSettings>(
  settings: T,
  requestedPatch?: Partial<BoardAccessSettings>,
): Omit<T, keyof BoardAccessSettings> & BoardAccessSettings {
  if (settings.discoveryScope !== "LINK") return { ...settings };
  // 공개 범위만 바꾼 PATCH는 이전 PUBLIC의 쓰기 권한을 자동 승계하지 않습니다.
  const resetsImplicitPermission = requestedPatch !== undefined && requestedPatch.visitorPermission === undefined
    && (requestedPatch.discoveryScope === "LINK" || settings.loginRequired);
  const permission = resetsImplicitPermission
    ? "READER" : settings.visitorPermission;
  return { ...settings, visitorPermission: permission === "WRITER" ? "WRITER" : "READER", loginRequired: false };
}

export const createBoardSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(""),
  discoveryScope: z.enum(["PRIVATE", "LINK", "PUBLIC"]).default("PRIVATE"),
  visitorPermission: z.enum(["NO_ACCESS", "READER", "COMMENTER", "WRITER"]).default("NO_ACCESS"),
  loginRequired: z.boolean().default(true),
  // quiz 생성과 같은 방식: 교과목은 id 선택이 아니라 이름 자유 입력이고, 없던 이름이면
  // 생성 시점에 내 교과목으로 만들어집니다(app/api/boards/route.ts의 connectOrCreate).
  subjectName: z.string().trim().max(60).optional().default(""),
  memberIds: z.array(z.string().min(1)).max(100).optional().default([])
    .refine((ids) => new Set(ids).size === ids.length, "초대 멤버가 중복되었습니다."),
});

// createBoardSchema.partial()을 쓰지 않습니다: zod의 .default()는 .partial() 뒤에도 "필드 생략 시
// 기본값 채움"이 그대로 적용되어서, 일부 필드만 보내는 부분 수정(PATCH)에서 나머지 필드가 조용히
// 기본값으로 리셋되는 문제가 있었습니다. 그래서 수정용 필드는 기본값 없이 따로 정의합니다.
export const updateBoardSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  discoveryScope: z.enum(["PRIVATE", "LINK", "PUBLIC"]).optional(),
  visitorPermission: z.enum(["NO_ACCESS", "READER", "COMMENTER", "WRITER"]).optional(),
  loginRequired: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  allowReactions: z.boolean().optional(),
  allowMemberPosting: z.boolean().optional(),
  allowMemberFileUpload: z.boolean().optional(),
  guestPostsRequireApproval: z.boolean().optional(),
  // password: 문자열이면 새 비밀번호로 교체, null이면 비밀번호 보호를 끔, undefined(생략)면 그대로 둠.
  password: z.string().trim().min(6).max(100).nullable().optional(),
  state: z.enum(["ACTIVE", "FROZEN"]).optional(),
  moderationMode: z.enum(["NONE", "MANUAL", "STUDENTS_ONLY"]).optional(),
  layout: z.enum(["SECTIONS", "WALL", "GRID", "STREAM", "TIMELINE", "TABLE"]).optional(),
  sortMode: z.enum(["MANUAL", "CREATED_ASC", "CREATED_DESC", "TITLE", "RANDOM"]).optional(),
  newPostPlacement: z.enum(["START", "END"]).optional(),
  cardSize: z.enum(["SMALL", "MEDIUM", "LARGE"]).optional(),
  font: z.enum(["SANS", "SERIF", "MONO"]).optional(),
  backgroundColor: colorSchema.optional(),
  accentColor: colorSchema.optional(),
  showAuthor: z.boolean().optional(),
  showTimestamp: z.boolean().optional(),
  reactionPolicy: z.enum(["SINGLE", "MULTIPLE"]).optional(),
  attachmentDownloadPolicy: z.enum(["READERS", "MEMBERS", "EDITORS", "DISABLED"]).optional(),
  postFieldConfig: z.unknown().optional(),
  // freezeAt: ISO 문자열이면 그 시각부터 자동 동결 예약, null이면 예약 취소, 생략이면 그대로 둠.
  freezeAt: z.string().datetime().nullable().optional(),
});

export const sectionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional().default(""),
});

export const createPostSchema = z.object({
  title: z.string().trim().max(200).optional().default(""),
  body: z.string().trim().max(20_000).optional().default(""),
  fieldConfigVersion: z.number().int().positive().optional(),
  customFieldValues: z.record(z.string(), z.unknown()).optional().default({}),
  attachmentCount: z.number().int().min(0).max(20).optional().default(0),
});

export const updatePostSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().max(20_000).optional(),
  isPinned: z.boolean().optional(),
  fieldConfigVersion: z.number().int().positive().optional(),
  customFieldValues: z.record(z.string(), z.unknown()).optional(),
  attachmentCount: z.number().int().min(0).max(20).optional(),
  version: z.number().int().positive(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2_000),
  parentId: z.string().nullable().optional(),
  mentionedUserIds: z.array(z.string()).max(20).optional().default([]),
});

export const updateCommentSchema = z.object({
  body: z.string().trim().min(1).max(2_000),
  mentionedUserIds: z.array(z.string()).max(20).optional().default([]),
});

export const attachmentMetadataSchema = z.object({
  altText: z.string().trim().max(500).nullable().optional(),
  caption: z.string().trim().max(1_000).nullable().optional(),
});

export const createLinkAttachmentSchema = z.object({
  url: z.string().url().max(2_048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "HTTP(S) 링크만 첨부할 수 있습니다."),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(1_000).optional().default(""),
  previewImageUrl: z.string().url().max(2_048)
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "HTTP(S) 이미지 주소만 사용할 수 있습니다.")
    .nullable()
    .optional(),
});

export const reorderAttachmentsSchema = z.object({
  attachmentIds: z.array(z.string()).min(1).max(20).refine((ids) => new Set(ids).size === ids.length, "첨부 ID가 중복되었습니다."),
});

export const reactionMutationSchema = z.object({
  key: z.string(),
  active: z.boolean(),
});

export const reorderSchema = z.object({
  previousItemId: z.string().nullable(),
  nextItemId: z.string().nullable(),
  targetSectionId: z.string().optional(),
});
