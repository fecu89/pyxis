# Pad Background Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pad 사진 업로드에서 파일 수신·검증·저장 이후의 WebP 변환 때문에 게시 완료가 지연되지 않도록 한다.

**Architecture:** 초기 안전 이미지와 변환 작업을 함께 저장하고 기존 커스텀 서버의 백그라운드 실행기가 작업을 임대하여 처리한다. 완성 파일로 DB 참조를 조건부 교체하고 revision 이벤트로 화면을 갱신한다. 이전 파일 정리와 실패 복구도 지속 작업으로 관리한다.

**Tech Stack:** 기존 Next/React, TypeScript, Prisma/PostgreSQL, Sharp, Node 파일 API, Node test 및 Playwright. 새 외부 서비스는 추가하지 않는다.

**Spec:** `docs/superpowers/specs/2026-09-22-pad-background-images-design.md`

## Global Constraints

- 이번 대상: Pad 게시물의 새 이미지 첨부(로그인 사용자 및 기존 허용된 손님).
- 댓글·프로필·퀴즈·설문·보드 배경의 업로드 방식과 기존 이미지의 일괄 변환은 제외한다.
- 기존 최대 4천만 픽셀 및 관리자가 정한 이미지·전체 업로드 용량 제한을 유지한다.
- 일시 실패는 최대 5회, 5초·30초·2분·10분 간격으로 재시도한다.
- 유휴 상태에서 2초 간격으로 확인하고 실행 가능한 개수만 가져온다.
- 비완료 작업 최대 256개. `FAILED`도 관리자 재시도/정리 전에는 비완료로 집계한다.
- 기존 파일은 교체 후 최소 60초 유예하고 제거한다.
- 외부 참조의 정본은 계속 `/f/첨부ID`다.
- 기존 첨부의 `imageRevision` 기본값은 0이다.
- 실제 운영 DB 마이그레이션·배포는 코드 검증 이후 별도 승인 범위다.
- `.env` 값, 실제 사용자 사진·DB는 출력하거나 테스트에 사용하지 않는다.
- 구현 시 작업 격리 절차를 먼저 적용한다. 현재 작업·승인된 설계/계획 문서를 보존한다.
- 구현 커밋/푸시는 사용자 요청 없이 자동 수행하지 않는다. 각 작업 경계에서 diff를 검토한다.

## Review Focus

1. 변환 완료 이벤트가 최초 업로드 응답보다 먼저 도착해도 revision이 되돌아가지 않는다 — Task 5.
2. 회전 JPEG와 색상 프로파일이 있는 사진에서 방향·색상은 보존하고 GPS는 제공하지 않는다 — Task 1.
3. 게시물 승인 대기·손님 작성·권한 회수 상태에서 새 파일 표현도 기존 접근 제한을 따른다 — Tasks 3, 5.
4. 보드 삭제 또는 복사와 작업 완료가 겹쳐도 파일 부활·복사본 손실이 없다 — Tasks 4, 6.
5. 경로 조회 후 파일 교체·삭제가 발생해도 진행 중 읽기가 불필요한 404로 끝나지 않는다 — Task 5.

## 파일 구조와 작업 의존성

- `lib/files/image-intake.ts`: 원본 우선 경로의 검증·메타데이터 제거·안전한 저장.
- `lib/files/image-metadata.ts`: 파일 I/O 없는 JPEG/PNG/WebP 컨테이너 검사·정리.
- `lib/files/image-job-store.ts`: 지속 작업 생성·임대·조건부 완료·재시도.
- `lib/files/image-worker.ts`: 작업 실행과 서버 시작/종료 연동.
- `lib/files/image-job-cleanup.ts`: 이전 파일 및 취소 작업의 정리·고아 파일 회수.
- `lib/files/image-transform.ts`: 기존 Sharp 설정을 보존하는 변환 함수.
- `lib/files/attachment-url.ts`: 모든 이미지 표시에 쓰는 revision URL.
- 테스트: `scripts/verify-pad-image-{intake,jobs,upload,worker,serving,reuse}.mjs`,
  `scripts/verify-pad-image-browser.mjs`, `scripts/pad-image-test-harness.mjs`.
- 의존 순서: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6.
  DB 마이그레이션·기능 활성화는 전체 검증 이후에만 수행한다.

---

### Task 1: 재압축 없는 안전한 초기 이미지

**Files:** Create `lib/files/image-metadata.ts`, `lib/files/image-intake.ts`,
`scripts/pad-image-test-harness.mjs`, `scripts/verify-pad-image-intake.mjs`.
Inspect `lib/files/validation.ts`, `multipart.ts`, `filename.ts`, `paths.ts`.

**Interfaces:**

```ts
type RasterMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
type CleanImage =
  | { kind: "ready"; bytes: Buffer; mimeType: RasterMime; orientation: number }
  | { kind: "fallback"; reason: "animation" | "unsupported-container" };
export function stripPrivateImageMetadata(bytes: Buffer, mime: RasterMime): CleanImage;
// 손상 데이터는 예외. fallback은 정상이나 빠른 경로 미지원 형식에만 사용.
type InitialImage = {
  storagePath: string; storedName: string; originalName: string;
  mimeType: RasterMime; fileSize: number; width: number; height: number;
};
export async function prepareInitialImage(
  temporaryPath: string, directory: string, originalName: string,
): Promise<{ data: InitialImage; cleanup(): Promise<void> } | null>;
// null일 때만 변경하지 않은 수신 파일을 기존 동기 변환에 전달.
```

- [ ] 생성 fixture만 사용하는 임시 디렉터리 helper와 모듈 mock loader를 만든다.
  기존 `verify-signup-consent.mjs`의 번들/mock 패턴을 따르고 `server-only`와 Prisma를
  테스트에서 대체한다. 디렉터리는 `mkdtemp`로 만들고 해당 테스트 경로만 정리한다.
- [ ] 아래 실제 모듈 호출 테스트를 먼저 작성한다. Sharp로 단색 JPEG를 생성하고 테스트용
  GPS/XMP 메타데이터를 붙인 fixture를 사용한다. assert 대상은 버퍼와 decode 결과다.

```js
test("GPS와 설명은 제거하고 픽셀은 그대로 유지한다", async () => {
  const source = await sharp({create:{width:16,height:12,channels:3,background:"red"}})
    .jpeg().withExif({IFD0:{ImageDescription:"private-fixture"},
      IFD2:{GPSLatitudeRef:"N",GPSLatitude:"37/1 0/1 0/1"}}).toBuffer();
  const result = stripPrivateImageMetadata(source, "image/jpeg");
  assert.equal(result.kind, "ready");
  assert.equal(result.bytes.includes(Buffer.from("private-fixture")), false);
  assert.deepEqual(await sharp(result.bytes).raw().toBuffer(),
    await sharp(source).raw().toBuffer());
});
```

- [ ] `node --test scripts/verify-pad-image-intake.mjs`를 실행하여 새 함수 미구현 때문에 실패함을 확인한다.
- [ ] 컨테이너를 길이·경계 검증과 함께 순회한다. JPEG는 EXIF/XMP/IPTC/COM을 제거하고
  EXIF 방향은 새 최소 EXIF 블록에 값만 기록한다. PNG는 EXIF/텍스트 청크를 제거하고
  보존 청크의 CRC·길이를 검증한다. WebP는 EXIF/XMP를 제거하고 RIFF 길이 및 VP8X 플래그를
  다시 계산한다. JFIF/ICC 등 표시용 정보는 보존한다. 알 수 없는 위험한 구조는 제공하지 않는다.
  애니메이션/GIF의 정상 형식은 동기 변환으로 fallback한다.
- [ ] 실제 형식 whitelist와 Sharp metadata 기반 치수 검사를 적용하고 정리한 파일을 UUID
  경로로 저장한다. 메모리 사용은 정책상 파일 크기에 제한되며 헤더 길이만 믿고 할당하지 않는다.
  정책 검사는 기존 수신 단계와 함께 적용한다. 이 단계에서 WebP 인코딩을 호출하지 않는다.
- [ ] 방향 1–8, ICC, PNG 텍스트, WebP XMP, 잘린 청크, 위조 MIME, 초과 픽셀,
  애니메이션 fallback 테스트를 추가해 모두 통과시킨다. 관련 diff를 검토한다.

### Task 2: 지속 작업과 임대 계약

**Files:** Modify `prisma/schema/pad.prisma`; create migration
`prisma/migrations/20260922010000_pad_image_jobs/migration.sql`,
`lib/files/image-job-store.ts`, `scripts/verify-pad-image-jobs.mjs`.
Regenerate tracked `generated/prisma` only with the existing generator.

**Interfaces:**

```ts
type ImageJobClaim = {
  id: string; attachmentId: string; boardId: string; postId: string;
  inputPath: string; leaseToken: string; attempts: number;
};
export async function enqueueImageJob(tx: Prisma.TransactionClient,
  input: {attachmentId: string; boardId: string; postId: string; inputPath: string}): Promise<void>;
export async function claimImageJob(now: Date): Promise<ImageJobClaim | null>;
export async function renewImageJob(claim: ImageJobClaim, now: Date): Promise<boolean>;
export async function failImageJob(claim: ImageJobClaim, code: string, now: Date): Promise<void>;
```

- [ ] 상태 전이를 fake clock 및 mock transaction으로 테스트한다.

```js
test("재시도는 최대 다섯 번이다", () => {
  assert.deepEqual([1,2,3,4,5].map(retryDelayMs), [5000,30000,120000,600000,null]);
});
// image-job-store.ts에서 export function retryDelayMs(attempt: number): number | null 구현.
```

- [ ] `node --test scripts/verify-pad-image-jobs.mjs`로 RED를 확인한다.
- [ ] `Attachment.imageRevision Int @default(0)`과 `ImageProcessingJob`을 추가한다.
  job의 필드는 id, attachmentId(unique), boardId, postId, inputPath, status,
  attempts, availableAt, leaseToken, leaseExpiresAt, outputPath, thumbnailPath,
  cleanupAfter, lastErrorCode, createdAt, updatedAt이다. 경로 기록 보존을 위해
  Attachment 삭제 cascade 관계를 만들지 않는다. `(status, availableAt)` 인덱스를 둔다.
- [ ] 트랜잭션 advisory lock으로 enqueue의 최대 256개 검사를 직렬화한다.
  claim은 아래 원리로 한 행을 잠그고 새 토큰과 2분 임대를 저장한다. 20초마다 갱신한다.

```sql
SELECT "id" FROM "ImageProcessingJob"
WHERE ("status" = 'PENDING' AND "availableAt" <= $1)
   OR ("status" = 'PROCESSING' AND "leaseExpiresAt" < $1)
ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1;
```

- [ ] 두 연결의 claim 경쟁, 토큰 만료 후 오래된 complete/fail 거절, enqueue 256/257 경계는
  격리 PostgreSQL에서 검증한다. 테스트 전용 URL을 명시하지 않으면 DB 테스트는 실행을 거절한다.
  로컬 운영 `.env`의 DATABASE_URL을 fallback으로 사용하지 않는다.
- [ ] Prisma 생성과 타입 검사를 수행한다. 생성물의 불필요한 포맷 변경을 제거하고 diff를 검토한다.

### Task 3: 변환을 기다리지 않는 Pad 업로드 응답

**Files:** Modify `lib/files/store-upload.ts`, `lib/files/validation.ts`,
`app/api/posts/[postId]/attachments/route.ts`; create `scripts/verify-pad-image-upload.mjs`.

**Interfaces:** `storeAttachmentUpload`의 options에 `deferImageProcessing?: boolean`을
추가한다. 기본 false. 반환값에는 `pendingImage: boolean`을 추가한다. `data`에는 실제
제공할 표현의 MIME·경로·크기가 들어간다. Task 1의 `prepareInitialImage`와 Task 2의
`enqueueImageJob`을 사용한다. 새 기능 설정은 `PAD_BACKGROUND_IMAGES_ENABLED=true`다.

- [ ] 실제 업로드 route를 mock 인증/DB와 임시 파일로 호출하고 변환 호출 수가 0임을 검증한다.
  helper는 harness에 `uploadPostImage({featureEnabled, imageBytes})`로 정의하며
  실제 `POST`에 FormData를 보내고 `{response, transformCalls, jobs, files}`를 반환한다.

```js
test("변환 없이 수신 완료를 응답하고 작업을 남긴다", async () => {
  const imageBytes = await sharp({create:{width:16,height:12,channels:3,background:"blue"}})
    .jpeg().toBuffer();
  const result = await uploadPostImage({featureEnabled:true, imageBytes});
  assert.equal(result.response.status, 201);
  assert.equal(result.transformCalls, 0);
  assert.equal(result.jobs.length, 1);
});
```

- [ ] `node --test scripts/verify-pad-image-upload.mjs`로 기존 동기 호출에 대한 실패를 확인한다.
- [ ] Pad 게시물 route에서만 feature flag를 읽는다. safe intake가 성공하면 재인코딩 없이
  반환하고 첨부 생성 트랜잭션 내부에 작업을 생성한다. unsupported 정상 이미지만 기존 경로로
  처리한다. 원본 MIME를 강제 WebP로 기록하지 않는다.
- [ ] 작업 enqueue 실패 시 첨부 트랜잭션 rollback과 파일 cleanup을 확인한다. 큐 초과는
  503 + Retry-After: 5를 반환한다. 손님 제한·승인 대기·필수 첨부·동결 검사는 유지한다.
- [ ] 기능 OFF, 문서 업로드, 손님 5개/회원 20개 제한, 금지 이미지, 실패 후 임시 파일 정리,
  API 부분 실패 응답을 테스트하고 기존 `verify:upload-policy`, `verify:multipart-limits`를
  운영 DB 접근이 없는지 검사한 뒤 실행한다. 변경 diff를 검토한다.

### Task 4: 변환 실행과 안전한 교체·정리

**Files:** Create `lib/files/image-transform.ts`, `image-worker.ts`, `image-job-cleanup.ts`,
`scripts/verify-pad-image-worker.mjs`; modify `server.ts`, `lib/files/processing-queue.ts`,
`lib/files/store-upload.ts`, `lib/files/pad-trash-sweep.ts`, `lib/files/cleanup.ts`,
`app/api/admin/attachments/[attachmentId]/purge/route.ts` and image-job-store from Task 2.

**Interfaces:**

```ts
type ImageOutput = {storagePath: string; thumbnailPath: string; storedName: string;
  fileSize: number; width: number; height: number};
export async function transformImage(inputPath: string, outputStem: string): Promise<ImageOutput>;
export async function commitImageJob(claim: ImageJobClaim, output: ImageOutput, now: Date): Promise<boolean>;
export async function runImageJobOnce(now: Date): Promise<boolean>;
export function startPadImageWorker(): { stop(): Promise<void> };
export async function cleanupImageJobs(now: Date): Promise<void>;
export async function cancelAttachmentImageJobs(attachmentIds: string[]): Promise<void>;
```

- [ ] 실행기 fixture는 `claim → transform → commit → event → delayed cleanup`의 각 단계를
  Promise barrier로 멈출 수 있게 만든다. 실패 전후 DB 참조와 파일 존재 여부를 검증하고
  기존 게이트와 같은 프로세스에서 active count도 측정한다.
- [ ] RED를 확인한다: `node --test scripts/verify-pad-image-worker.mjs`.
- [ ] Sharp 설정을 공유 함수로 추출한다. 본문 2560px/quality82/effort4, 썸네일
  960px/quality76/effort3, rotate·withoutEnlargement를 유지한다.
- [ ] claim별 UUID 출력 경로에 기록하고 두 파일 확정 후 commit한다.
  commit은 board/post/attachment/job을 일정 순서로 잠그고 삭제 상태·입력 경로·leaseToken을
  다시 확인한다. attachment 갱신과 CLEANUP_PENDING/cleanupAfter 갱신을 같은 트랜잭션에 둔다.
- [ ] 2초 timer와 기존 gate로 실행 수를 제한한다. startup에서만 시작하고 singleton을 유지한다.
  shutdown에서는 새 claim을 중단하고 진행 중 작업을 유한 시간 기다린다. 강제 종료는 lease로 복구한다.
- [ ] cleanup은 현재 참조 중인 파일을 삭제하지 않는다. 삭제 API·관리자 purge·board sweep은
  job에 기록된 모든 파일을 처리하고 cleanup 성공까지 job을 남긴다. 삭제된 대상의 worker 출력은
  해당 worker가 정리한다. 1시간 이상 된 미참조 임시 파일만 주기 회수하고 active job의
  input/output은 제외한다. 탐색은 upload root 아래로 제한하고 symlink를 따라가지 않는다.
- [ ] 5회 실패, 재시작, lease 탈취, 한쪽 출력만 성공, DB rollback, 삭제 경합, cleanup 실패,
  동기 업로드를 포함한 총 동시성을 검증하고 diff를 검토한다.

### Task 5: 안전한 파일 제공과 모든 화면의 이미지 revision 반영

**Files:** Modify `app/(play)/f/[attachmentId]/route.ts`, `lib/board/post-snapshot.ts`,
`components/pad/types.ts`, `components/pad/attachments/types.ts`,
`components/pad/reconcile-sections.ts`, `components/pad/attachments/attachment-viewer.tsx`,
`components/pad/post-card.tsx`, `components/pad/post-content-blocks.ts`,
`components/pad/post-composer.tsx`, `components/pad/attachments/upload-queue-list.tsx`,
`components/pad/export/pad-print-view.tsx`, `components/pad/export/pad-presentation.tsx`.
Create `lib/files/attachment-url.ts`, `scripts/verify-pad-image-serving.mjs`,
`scripts/verify-pad-image-browser.mjs`.

**Interfaces:**

```ts
export function attachmentImageUrl(
  attachment: {id: string; imageRevision?: number}, variant?: "thumbnail",
): string;
// /f/{id}?v={revision} 또는 /f/{id}?v={revision}&variant=thumbnail
```

- [ ] URL과 revision 단조성을 테스트한다. 오래된 attachment.created, 갱신 event, POST/PATCH 응답,
  full snapshot을 역순으로 적용해도 같은 ID의 높은 revision 이미지 정보를 유지한다.

```js
test("revision URL로 브라우저가 이미지를 다시 가져온다", () => {
  assert.equal(attachmentImageUrl({id:"fixture",imageRevision:2},"thumbnail"),
    "/f/fixture?v=2&variant=thumbnail");
});
```

- [ ] `node --test scripts/verify-pad-image-serving.mjs`와 브라우저 fixture에서 RED를 확인한다.
- [ ] DB select/DTO/첨부 응답에 revision을 추가한다. 기존 fixture 호환을 위해 UI 타입은 optional,
  URL helper는 누락을 0으로 취급한다. event에서 갱신할 것은 이미지 속성뿐이며 caption이나
  altText를 오래된 snapshot으로 되돌리지 않는다. 본문 저장 문자열은 유지하고 표시 시 URL을 해석한다.
- [ ] 파일을 open한 뒤 fstat·stream한다. 실패하면 한 번만 최신 행과 권한을 다시 확인하고
  재open한다. Range/304/기존 HEAD 동작과 handle close를 검증한다. ETag는 variant도 구분하며
  권한 검사 전에 304를 반환하지 않는다.
- [ ] worker가 commit 후 `attachment.updated`를 기존 delivery 규칙으로 발행한다.
  알림 누락·재접속 시 기존 snapshot 동기화로 최신 revision을 얻는지 확인한다.
- [ ] Playwright에서 변환을 멈춘 상태로 게시 완료·사진 표시를 확인하고 변환을 재개한 후
  카드/상세/본문 이미지 갱신을 확인한다. 동시 mock upload 30건의 응답이 worker barrier에
  의존하지 않는지 확인한다.
- [ ] 업로드 진행률 99% 이후에는 ‘저장 확인 중’으로 표시하고 게시 완료 후 변환 spinner를 남기지 않는다.
  부분 실패의 기존 재시도 UI는 유지한다. 손님 승인 대기·비회원·권한 회수에 따른 접근 거절을 검증한다.

### Task 6: 복사·회귀 검증과 운영 문서

**Files:** Modify `lib/board-reuse/clone-board.ts`, `lib/exports/attachments-zip.ts`,
`lib/exports/data.ts`, `package.json`, `.env.example`, `README.md`, `lib/files/overview.md`,
`components/pad/attachments/overview.md`, `app/api/posts/[postId]/attachments/overview.md`,
`app/(play)/f/[attachmentId]/overview.md`, `prisma/migrations/overview.md`.
Create `scripts/verify-pad-image-reuse.mjs`, `docs/pad-background-images.md` and migration overview.

- [ ] 처리 대기 중 JPEG의 복사와 export를 테스트한다. 현재 표현의 확장자/MIME/bytes를 일치시키고
  job은 복제하지 않는다. 원본 이미지가 교체·삭제되어도 복사한 이미지는 읽을 수 있어야 한다.
- [ ] `node --test scripts/verify-pad-image-reuse.mjs`의 RED를 확인한다. copy는 open한 handle을
  사용하거나 실패 시 최신 attachment를 재조회한다. 복사본 DB 저장 실패 시 복사본만 정리한다.
- [ ] `.env.example`에 비밀값 없이 `PAD_BACKGROUND_IMAGES_ENABLED=false`와 용도를 추가한다.
  운영 문서에 migration→새 app→설정 ON 순서, OFF 시 동기 fallback, FAILED 작업 수·
  대기시간·여유 용량 감시, DB 기록을 유지하는 재시도 절차를 기록한다. 기존 `.env`는 변경하지 않는다.
- [ ] Node 테스트 6개와 browser 테스트를 실행하는 `verify:pad-images` 명령을 추가한다.
  테스트 DB가 없으면 통합 검증 미실시를 명시하고 성공으로 보고하지 않는다.
- [ ] 차례로 실행하여 출력을 확인한다:

```bash
yarn verify:pad-images
yarn verify:pad-realtime
yarn verify:post-content
yarn verify:routes
yarn tsc --noEmit
yarn lint
git diff --check
```

- [ ] 고유한 `.next-verify` 하위 경로로 `NEXT_DIST_DIR`를 지정하고 production build한다.
  실행 전 tsconfig와 next-env 상태를 기록하고 build가 추가한 임시 include만 되돌린다.
  다른 upload 소비자는 mock storage/DB fixture로 동기 처리가 유지되는지 검증한다.
- [ ] 전체 변경을 독립 리뷰하고 지적 사항을 재현 테스트와 함께 수정한다. README와 overview를
  구현 결과에 맞춰 갱신하고 미검증 항목과 운영 migration/배포 미실시 여부를 보고한다.

## 실행 방법 제안

이 변경은 upload·worker·cleanup·파일 제공 간 계약이 밀접하므로 같은 담당자가 순서대로
구현하는 Native 방식을 권장한다. 마지막에 독립 리뷰를 수행한다. Subagent-driven 방식을
선택하더라도 작업 경계에서 검토하며 같은 파일을 동시에 변경하지 않는다.

**현재 상태(2026-09-27):** 사용자 요청에 따라 현재 폴더에서 구현하고 독립 리뷰의 두 이벤트
경합을 재현·수정했다. 위 체크리스트는 원래 계획이며, 실제 검증 범위와 차이는
[운영 문서](../../pad-background-images.md)의 검증/구현 판단을 따른다.
이후 별도 사용자 승인으로 DB 백업·미적용 마이그레이션 적용·환경변수 활성화와
`yarn deploy`를 완료했다. 실행 프로세스와 내·외부 HTTP 응답까지 확인했으며 커밋·푸시는 하지 않았다.
