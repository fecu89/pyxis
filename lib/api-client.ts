// Client Component에서 Route Handler를 호출할 때 쓰는 공용 fetch 헬퍼.
//
// 기존에는 컴포넌트마다 `const result = await response.json(); if (!response.ok) ...`를
// 손으로 반복 작성했는데, 서버가 502/504 같은 비-JSON 오류 본문을 돌려주면 `.json()`이
// throw하고 이게 try/catch 없이 호출돼 unhandled rejection으로 죽는 경우가 있었다.
// (사용자에게는 아무 피드백 없이 버튼만 조용히 멈춘 것처럼 보임.) 이 헬퍼는 JSON 파싱
// 실패를 안전하게 흡수하고 일관된 에러 메시지로 throw한다.
export class ApiRequestError extends Error {}

export async function requestJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : "요청을 처리하지 못했습니다.";
    throw new ApiRequestError(message);
  }
  return body as T;
}
