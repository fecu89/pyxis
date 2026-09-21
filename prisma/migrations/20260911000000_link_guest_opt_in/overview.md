# 링크공개 손님 글쓰기 opt-in

새 LINK/WRITER 정책을 배포하기 전에 기존 LINK 행(보관된 패드 포함)을 READER/loginRequired=false로
정규화합니다. 과거에는 저장값과 관계없이 LINK가 읽기 전용이었으므로, 과거 WRITER 값을 그대로
해석하면 배포만으로 방문자 권한이 열릴 수 있습니다. 테이블·컬럼 추가나 게시물 삭제는 없습니다.

`yarn prisma migrate deploy`를 새 앱 전환 전에 실행합니다. Prisma 이력에 한 번 기록되며,
이후 관리자가 켠 손님 쓰기 설정은 재배포할 때 초기화하지 않습니다.
