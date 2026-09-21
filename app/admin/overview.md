# Overview

pyxis 관리자 센터 라우트입니다. `layout.tsx`는 인증·공통 사이드바만 담당하고 `/admin/users`, `/admin/approvals`, `/admin/audit`, `/admin/settings` 같은 하위 페이지가 자기 데이터만 조회합니다. Server Component가 매 요청 최신 역할·상태·시스템 권한을 확인하고, 권한 없는 사용자에게 404 대신 필요한 권한과 요청 방법을 안내합니다.

예전 `/admin?tab=approvals` 주소는 `/admin/approvals`로 리다이렉트합니다. 전체관리자는 모든 학교 신청을 보고, 학교 대표교사는 자기 학교 신청만 조회·승인·반려할 수 있습니다.
