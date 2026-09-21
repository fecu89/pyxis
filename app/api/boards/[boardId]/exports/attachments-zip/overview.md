# 첨부 ZIP 내보내기 API

이 폴더는 보드 첨부 전체를 ZIP 스트림으로 내려주는 `GET` Route Handler를 담당합니다. 보드 관리 권한과 `attachmentDownloadPolicy`를 `requireAttachmentZipAccess`로 모두 확인하며, `archiver` 결과를 버퍼 전체로 모으지 않고 응답 스트림으로 전달합니다. LINK 첨부와 로컬 파일 경로 구성은 `lib/exports/`가 처리합니다.
