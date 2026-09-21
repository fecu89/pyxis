"use client";

import { requestJson } from "@/lib/api-client";
import { mb, type UploadPolicy } from "@/lib/files/upload-policy-shape";

// 퀴즈 이미지는 예전에 브라우저 canvas로 축소한 base64 data URL을 그대로 DB 컬럼
// (Question.imageUrl / Quiz.thumbnailUrl)에 담았습니다. 지금은 패드 첨부와 같은 규칙 —
// 파일로 올라가고 컬럼에는 주소만 남습니다(lib/quiz/image-store.ts).
//
// 축소·재인코딩을 서버 sharp로 옮긴 이유는 용량만이 아닙니다.
//   - canvas 압축은 브라우저가 보낸 MIME만 믿었습니다. 서버는 파일 시그니처를 검사하고
//     실제로 디코드해 다시 인코딩하므로, 이미지로 위장한 바이트가 우리 출처에서 서비스되지
//     않습니다.
//   - toDataURL은 지원하지 않는 형식을 조용히 PNG로 돌려줘서, 구형 Safari에서는 압축이 거의
//     안 된 채 상한에 걸리곤 했습니다. 서버는 어디서 올리든 같은 결과를 냅니다.
//   - 700KB라는 상한도 사라졌습니다. 그 숫자는 JSON 본문에 이미지를 실어 보내던 시절의
//     제약이었습니다.

/** 업로드 원본 상한. 서버와 같은 정책값이며, 여기서 먼저 걸러 헛걸음을 줄입니다. */
function maxSourceBytes(policy: UploadPolicy) {
  return mb(Math.min(policy.maxQuizImageMb, policy.maxUploadMb));
}

/**
 * 이미지를 올리고 저장된 주소를 돌려줍니다.
 *
 * `kind: "thumbnail"`은 서버가 더 작은 긴 변으로 줄이라는 뜻입니다. 썸네일은 목록에서 퀴즈
 * 개수만큼 한꺼번에 나가므로 문항 이미지보다 작아야 합니다.
 */
export async function uploadQuizImage(
  quizId: string,
  file: File,
  policy: UploadPolicy,
  options: { kind?: "thumbnail" } = {},
) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일만 올릴 수 있습니다.");
  const limit = maxSourceBytes(policy);
  if (file.size > limit) {
    throw new Error(`이미지는 ${Math.floor(limit / 1024 / 1024)}MB 이하로 올려 주세요.`);
  }

  const body = new FormData();
  body.append("file", file);
  const query = options.kind === "thumbnail" ? "?kind=thumbnail" : "";
  const result = await requestJson<{ url: string }>(
    `/api/quiz/quizzes/${encodeURIComponent(quizId)}/images${query}`,
    { method: "POST", body },
  );
  return result.url;
}
