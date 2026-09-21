// 업로드 상한의 모양과 기본값. 서버(lib/files/upload-policy.ts)와 화면
// (lib/files/upload-policy-client.ts)이 같은 정의를 봐야 해서 `server-only` 없이 여기 둡니다.
// DB를 읽는 코드는 서버 쪽 모듈에만 있습니다.

export type UploadPolicy = {
  /** 첨부 전체 상한. 아래 개별 상한은 이 값을 넘을 수 없습니다. */
  maxUploadMb: number;
  /**
   * 손님(비로그인) 업로드 상한. 신원이 없어 남용해도 추적할 대상이 없으므로 회원보다 좁게 잡습니다.
   *
   * 형식을 가리지 않는 값이지만, 지금 손님은 사진만 올릴 수 있어서(게시물·댓글 첨부 라우트가
   * 손님 분기에 `allowedTypes: ["IMAGE"]`를 겁니다) 실제로 걸리는 대상은 이미지뿐입니다.
   * 이미지 상한과 함께 적용돼 둘 중 작은 쪽이 최종 상한이 됩니다.
   */
  guestMaxUploadMb: number;
  /** 이미지 형식 캡. 이미지는 서버가 다시 인코딩하므로 원본이 클 이유가 적습니다. */
  maxImageUploadMb: number;
  /** 패드 배경 이미지 상한. */
  maxBoardBackgroundMb: number;
  /** 퀴즈 문항 이미지·썸네일 한 장의 상한. */
  maxQuizImageMb: number;
  /** 퀴즈 하나가 이미지로 차지할 수 있는 총량. 개당 상한만으로는 문항을 늘려 디스크를 채우는 것을 못 막습니다. */
  maxQuizImageStorageMb: number;
};

/** 정책 행이 없거나 읽지 못했을 때 쓰는 값. 정책으로 옮기기 전 코드에 박혀 있던 숫자 그대로입니다. */
export const UPLOAD_POLICY_DEFAULTS: UploadPolicy = {
  maxUploadMb: 30,
  guestMaxUploadMb: 10,
  maxImageUploadMb: 10,
  maxBoardBackgroundMb: 10,
  maxQuizImageMb: 8,
  maxQuizImageStorageMb: 256,
};

/** 관리 화면 입력과 서버 검증이 공유하는 범위. 0은 "업로드 금지"가 아니라 실수이므로 최소 1MB입니다. */
export const UPLOAD_POLICY_BOUNDS: Record<keyof UploadPolicy, { min: number; max: number }> = {
  // Next proxy 본문 상한은 이 최대값 + multipart 여유(5MB)로 잡습니다. 1회 업로드 값을
  // 30MB보다 크게 열려면 메모리·디스크·프록시 상한을 함께 재검토해야 하므로 Admin 화면에서도
  // 이 범위 안에서만 조정합니다.
  maxUploadMb: { min: 1, max: 30 },
  guestMaxUploadMb: { min: 1, max: 30 },
  maxImageUploadMb: { min: 1, max: 30 },
  maxBoardBackgroundMb: { min: 1, max: 30 },
  maxQuizImageMb: { min: 1, max: 30 },
  maxQuizImageStorageMb: { min: 16, max: 102_400 },
};

/** multipart 경계·헤더가 파일 바이트 밖에 붙으므로 전송 본문에는 이만큼 여유를 둡니다. */
export const UPLOAD_MULTIPART_HEADROOM_MB = 5;

export const UPLOAD_POLICY_KEYS = Object.keys(UPLOAD_POLICY_DEFAULTS) as (keyof UploadPolicy)[];

export function mb(value: number) {
  return value * 1024 * 1024;
}
