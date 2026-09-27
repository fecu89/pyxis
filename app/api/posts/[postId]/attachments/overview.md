# 첨부 업로드 API 개요

이 라우트는 게시물과 보드 권한을 먼저 확인한 후 단일 multipart 파일을 로컬 임시 파일로 스트리밍합니다. 이미지는 Sharp 처리 큐에서 WebP 본문과 WebP 썸네일로 변환하고 원본을 제거하며, 문서는 검증 후 원자적으로 최종 경로로 이동합니다. DB 저장에 실패하면 생성된 임시·최종 파일을 모두 정리합니다.
## 원본 우선 이미지 저장

PAD_BACKGROUND_IMAGES_ENABLED=true일 때 검증·메타데이터 정리를 마친 초기 이미지와
ImageProcessingJob을 함께 저장하여 변환 전에 응답합니다. 큐 상한 초과는 503/Retry-After이며
첨부와 작업 저장 실패 시 파일을 정리합니다. 자세한 운영 조건은 docs/pad-background-images.md 참고.
