import path from "node:path";

export function getUploadRoot() {
  return process.env.UPLOAD_DIR
    ? path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "data", "uploads");
}

export function resolveStoredFile(storagePath: string) {
  const root = getUploadRoot();
  const resolved = path.resolve(/* turbopackIgnore: true */ root, storagePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("허용되지 않은 파일 경로입니다.");
  }
  return resolved;
}

export function createPostUploadDirectory(boardId: string, postId: string) {
  return path.join(/* turbopackIgnore: true */ getUploadRoot(), "boards", boardId, "posts", postId);
}

export function createFormUploadDirectory(formId: string, userId: string) {
  if (!RESOURCE_ID_LIKE.test(formId) || !RESOURCE_ID_LIKE.test(userId)) throw new Error("설문 파일 경로가 올바르지 않습니다.");
  return path.join(/* turbopackIgnore: true */ getUploadRoot(), "forms", formId, "users", userId);
}

// 실제 카카오 로그인(lib/auth/auth-options.ts의 최초 가입 시 randomUUID() 사용)으로 만들어진
// 사용자 ID는 하이픈이 들어간 UUID 형식이고, 시드 계정 등은 Prisma 기본값인 cuid(하이픈 없음)
// 형식입니다. 둘 다 통과해야 하므로 하이픈도 허용하되, 경로 조작에 쓰일 수 있는 문자(/, \, .. 등)는
// 여전히 전부 막습니다.
const RESOURCE_ID_LIKE = /^[a-z0-9-]+$/i;

export function getAvatarDirectory(userId: string) {
  if (!RESOURCE_ID_LIKE.test(userId)) throw new Error("사용자 ID 형식이 올바르지 않습니다.");
  return path.join(/* turbopackIgnore: true */ getUploadRoot(), "avatars", userId);
}

export function getAvatarPath(userId: string) {
  return path.join(/* turbopackIgnore: true */ getAvatarDirectory(userId), "avatar.webp");
}

export function getBoardUploadDirectory(boardId: string) {
  if (!RESOURCE_ID_LIKE.test(boardId)) throw new Error("패드 ID 형식이 올바르지 않습니다.");
  return path.join(/* turbopackIgnore: true */ getUploadRoot(), "boards", boardId);
}

export function getBoardBackgroundPath(boardId: string) {
  return path.join(/* turbopackIgnore: true */ getBoardUploadDirectory(boardId), "background.webp");
}

/** 전체관리자가 올린 라이브 퀴즈 BGM·효과음 전용 디렉터리입니다. */
export function getQuizLiveAudioDirectory() {
  return path.join(/* turbopackIgnore: true */ getUploadRoot(), "system", "quiz-live-audio");
}

// 퀴즈 이미지(문항 이미지·썸네일)는 퀴즈 하나당 디렉터리 하나에 모읍니다. 문항별로 나누지
// 않는 이유: 편집기는 아직 저장되지 않은 문항(clientId만 있는 상태)에도 이미지를 올릴 수
// 있어서, 업로드 시점에 확정된 ID는 quizId뿐입니다. 저장 시 참조되지 않은 파일은 남으므로
// 퀴즈 저장과 주기 sweep가 훑어서 정리합니다(lib/quiz/image-store.ts, lib/quiz/image-sweep.ts).
export function getQuizUploadDirectory(quizId: string) {
  if (!RESOURCE_ID_LIKE.test(quizId)) throw new Error("퀴즈 ID 형식이 올바르지 않습니다.");
  return path.join(/* turbopackIgnore: true */ getUploadRoot(), "quiz", quizId);
}

// 파일명은 우리가 만든 `{uuid}.webp`/`{uuid}.jpg`만 허용합니다. 이 값은 URL 경로에서 그대로
// 들어오므로 `..`이나 구분자가 섞이면 업로드 루트 밖을 읽을 수 있습니다.
//
// 확장자가 둘인 이유: 문항 이미지는 앱 안에서만 쓰여 가장 작은 webp로 두지만, 퀴즈 썸네일은
// og:image로도 나가는데 카카오톡 등 일부 링크 미리보기가 webp를 렌더하지 못합니다.
const QUIZ_IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|jpg)$/i;

export function isQuizImageName(name: string) {
  return QUIZ_IMAGE_NAME.test(name);
}

export function getQuizImagePath(quizId: string, name: string) {
  if (!isQuizImageName(name)) throw new Error("이미지 이름 형식이 올바르지 않습니다.");
  return path.join(/* turbopackIgnore: true */ getQuizUploadDirectory(quizId), name);
}

export function toStoragePath(absolutePath: string) {
  const root = getUploadRoot();
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("업로드 루트 밖의 경로입니다.");
  return relative.split(path.sep).join("/");
}
