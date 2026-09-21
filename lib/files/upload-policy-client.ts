"use client";

import { UPLOAD_POLICY_DEFAULTS, type UploadPolicy } from "@/lib/files/upload-policy-shape";

// 화면이 쓰는 업로드 상한. 서버(lib/files/upload-policy.ts)와 같은 값을 보게 하는 것이 전부입니다.
//
// 예전에는 클라이언트에 상수가 따로 박혀 있었습니다(file-rules.ts의 형식별 캡, 배경 10MB,
// 퀴즈 이미지 8MB). 그러면 관리자가 정책을 바꿔도 화면은 옛 숫자로 안내하고, 파일 선택창은
// 받아 주는데 서버가 거절하는 상태가 생깁니다.
//
// 값이 거의 안 바뀌므로 탭당 한 번만 받아 모듈 수준에서 재사용합니다. 실패하면 옮기기 전
// 기본값으로 계속 동작합니다 — 상한 안내가 조금 어긋나도 서버가 최종 판정을 하므로 안전합니다.

let inflight: Promise<UploadPolicy> | null = null;
let resolved: UploadPolicy | null = null;

export function cachedUploadPolicy(): UploadPolicy {
  return resolved ?? UPLOAD_POLICY_DEFAULTS;
}

export function fetchUploadPolicy(): Promise<UploadPolicy> {
  if (resolved) return Promise.resolve(resolved);
  if (inflight) return inflight;
  inflight = fetch("/api/upload-policy")
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error("정책을 불러오지 못했습니다."))))
    .then((value: UploadPolicy) => {
      resolved = { ...UPLOAD_POLICY_DEFAULTS, ...value };
      return resolved;
    })
    .catch(() => UPLOAD_POLICY_DEFAULTS)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
