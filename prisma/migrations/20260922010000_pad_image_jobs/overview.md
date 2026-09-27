# Pad 이미지 처리 작업

Attachment에 imageRevision(기본 0), 새 ImageProcessingJob 테이블과 조회 인덱스를 추가합니다.
기존 첨부를 재인코딩하거나 사용자 데이터를 변경하지 않는 추가형 마이그레이션입니다.
작업 테이블에는 첨부 cascade FK를 두지 않아 삭제 이후에도 파일 정리 경로가 남습니다.
운영 적용 순서는 `docs/pad-background-images.md`를 참고하세요.
