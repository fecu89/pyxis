# Overview

이 폴더는 pyxis 구현에서 `app/files/[attachmentId]` 영역을 담당합니다.
## 이미지 파일 교체

이미지 최적화는 첨부 ID를 유지하고 내부 경로와 imageRevision만 갱신합니다. 파일을 열고
fstat·stream하여 교체 중에도 기존 요청을 유지하며, 이전 경로의 ENOENT는 권한을 포함해
한 번 재조회합니다. 캐시 ETag는 variant·revision을 구분합니다.
