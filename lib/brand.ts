const configuredName = process.env.NEXT_PUBLIC_APP_NAME?.trim();

/**
 * 화면, 메타데이터와 문서 산출물에 표시하는 제품명입니다.
 * 패키지명, DB 식별자와 기존 브라우저 저장 키는 이 값에 연동하지 않습니다.
 */
export const APP_NAME = configuredName || "pyxis";
