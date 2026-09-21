import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

async function main() {
  const [
    workspaceLayout,
    dashboardChrome,
    topNav,
    appSidebar,
    homeActions,
    padGrid,
    formList,
    formRootPage,
    quizLibrary,
    quizLibraryLayout,
    quizLibraryPage,
    quizPage,
    quizDiscoverPage,
    quizLibraryData,
    reportActivityLayout,
    reportRootPage,
    routesSource,
    adminPage,
    adminLayout,
    adminShell,
    adminUsersPage,
    adminAuditPage,
    adminSettingsPage,
    adminAudioPage,
    adminBoardsPage,
    adminQuizzesPage,
    adminFormsPage,
    adminError,
    adminThemePanel,
    notificationBell,
    mediaCapture,
    hwpViewer,
    officeViewer,
    selectableList,
    appDialog,
    documentConvert,
    socketServer,
    serverRateLimit,
    authSecurity,
    proxySource,
    formEditor,
    quizEditor,
    quizSessionLauncher,
    formFieldCard,
    formAnswerFields,
    padCanvas,
    lazyPostComposer,
    boardQueries,
    postCard,
    sortablePostCard,
    sectionColumn,
    flatBoard,
    padEvents,
    boardEventRoute,
    sseStream,
    boardMembersRoute,
    listDrag,
    sortableOrderAnswer,
    uiPageLayout,
    uiFeedback,
    uiDataDisplay,
    adminPagination,
    adminResourceUi,
    quizActivitiesPage,
    quizAssignmentsPage,
    pageNumberNavigation,
    platformPolicy,
    grading,
    rosterPanel,
    formResponseSummary,
    formShareDialog,
    padActivityPanel,
    padInviteLinks,
    memberGroupInvite,
    quizCollectionRoute,
    quizSessionCollectionRoute,
    joinSessionCard,
  ] = await Promise.all([
    read("app/(workspace)/layout.tsx"),
    read("components/shell/dashboard-chrome.tsx"),
    read("components/shell/top-nav.tsx"),
    read("components/shell/app-sidebar.tsx"),
    read("components/home/home-actions.tsx"),
    read("components/home/pad-grid.tsx"),
    read("components/forms/form-list.tsx"),
    read("app/(workspace)/forms/(library)/page.tsx"),
    read("components/quiz/quiz-library.tsx"),
    read("app/(workspace)/quiz/(library)/layout.tsx"),
    read("app/(workspace)/quiz/(library)/quiz-library-page.tsx"),
    read("app/(workspace)/quiz/(library)/page.tsx"),
    read("app/(workspace)/quiz/(library)/discover/page.tsx"),
    read("lib/quiz/library-page.ts"),
    read("app/(workspace)/report/(activity)/layout.tsx"),
    read("app/(workspace)/report/(activity)/page.tsx"),
    read("lib/routes.ts"),
    read("app/admin/page.tsx"),
    read("app/admin/layout.tsx"),
    read("components/admin/admin-shell.tsx"),
    read("app/admin/users/page.tsx"),
    read("app/admin/audit/page.tsx"),
    read("app/admin/settings/page.tsx"),
    read("app/admin/audio/page.tsx"),
    read("app/admin/boards/page.tsx"),
    read("app/admin/quizzes/page.tsx"),
    read("app/admin/forms/page.tsx"),
    read("app/admin/error.tsx"),
    read("components/admin/theme-panel.tsx"),
    read("components/notifications/notification-bell.tsx"),
    read("components/pad/attachments/media-capture.tsx"),
    read("components/pad/attachments/hwp-viewer.tsx"),
    read("components/pad/attachments/office-viewer.tsx"),
    read("components/ui/selectable-list.tsx"),
    read("components/ui/app-dialog.tsx"),
    read("lib/files/document-convert.ts"),
    read("lib/realtime/socket-server.ts"),
    read("lib/security/rate-limit.ts"),
    read("lib/auth/security.ts"),
    read("proxy.ts"),
    read("components/forms/form-editor.tsx"),
    read("components/quiz/quiz-editor.tsx"),
    read("components/quiz/quiz-session-launcher.tsx"),
    read("components/forms/field-card.tsx"),
    read("components/forms/answer-fields.tsx"),
    read("components/pad/pad-canvas.tsx"),
    read("components/pad/lazy-post-composer.tsx"),
    read("lib/board/queries.ts"),
    read("components/pad/post-card.tsx"),
    read("components/pad/sortable-post-card.tsx"),
    read("components/pad/section-column.tsx"),
    read("components/pad/pad-flat-board.tsx"),
    read("components/pad/use-pad-events.ts"),
    read("app/api/boards/[boardId]/events/route.ts"),
    read("lib/realtime/sse-stream.ts"),
    read("app/api/boards/[boardId]/members/route.ts"),
    read("lib/editor/use-list-drag.ts"),
    read("components/quiz/sortable-order-answer.tsx"),
    read("components/ui/page-layout.tsx"),
    read("components/ui/feedback.tsx"),
    read("components/ui/data-display.tsx"),
    read("components/admin/shared/admin-pagination.tsx"),
    read("components/admin/resources/resource-manager-ui.tsx"),
    read("app/(workspace)/quiz/activities/page.tsx"),
    read("app/(workspace)/quiz/assignments/page.tsx"),
    read("components/ui/page-number-navigation.tsx"),
    read("lib/security/platform-policy.ts"),
    read("lib/quiz/grading.ts"),
    read("components/courses/roster-panel.tsx"),
    read("components/forms/response-summary.tsx"),
    read("components/forms/share-dialog.tsx"),
    read("components/pad/pad-activity-panel.tsx"),
    read("components/pad/pad-invite-links.tsx"),
    read("components/pad/settings/member-group-invite.tsx"),
    read("app/api/quiz/quizzes/route.ts"),
    read("app/api/quiz/sessions/route.ts"),
    read("components/quiz/join-session-card.tsx"),
  ]);
  const [formSummary, sitemapSource, boardAccessRequests, boardInviteLinks, boardPendingPosts, padSettingsTabs, padAccessRequests, hostSessionReport, participationViews, quizSessionDialog, padReuseDialog, modalSource] = await Promise.all([
    read("lib/forms/summary.ts"),
    read("app/sitemap.ts"),
    read("app/api/boards/[boardId]/access-requests/route.ts"),
    read("app/api/boards/[boardId]/invite-links/route.ts"),
    read("app/api/boards/[boardId]/pending-posts/route.ts"),
    read("components/pad/settings/pad-settings-tabs.tsx"),
    read("components/pad/pad-access-requests.tsx"),
    read("components/quiz/host-session-report.tsx"),
    read("components/quiz/participation-views.tsx"),
    read("components/quiz/quiz-session-dialog.tsx"),
    read("components/home/pad-reuse-dialog.tsx"),
    read("components/ui/modal.tsx"),
  ]);

  assert(!workspaceLayout.includes("getDashboardHomeData"), "공용 workspace 레이아웃이 패드 홈 전체를 조회하면 안 됩니다.");
  assert(!workspaceLayout.includes("getCourseDashboardData"), "공용 workspace 레이아웃이 교과목 목록을 조회하면 안 됩니다.");
  assert(workspaceLayout.includes("getNotificationSummary"), "공용 셸은 알림 요약만 SSR해야 합니다.");
  assert(!dashboardChrome.includes("CreateBoardActionsProvider"), "패드 생성 Provider는 /pad 경계 밖으로 새면 안 됩니다.");
  assert(!dashboardChrome.includes("HomeAuthActionsProvider"), "인증 셸이 로그인 폼 모달을 번들에 포함하면 안 됩니다.");
  assert(topNav.includes("prefetch={false}") && appSidebar.includes("prefetch={false}"), "상주 내비게이션이 모든 제품 라우트를 첫 화면에서 prefetch하면 안 됩니다.");
  assert(!appSidebar.includes("useSearchParams"), "사이드바 화면 전환이 쿼리 기반이면 모든 검색 파라미터 변경에 셸이 다시 렌더링됩니다.");
  assert(homeActions.includes("dynamic(() => import") && homeActions.includes("loginOpen ?"), "공개 랜딩의 로그인 폼은 열 때만 로드해야 합니다.");
  const [formListCard, contentCard] = await Promise.all([read("components/forms/form-list-card.tsx"), read("components/ui/content-card.tsx")]);
  assert(padGrid.includes("prefetch={false}") && quizLibrary.includes("prefetch={false}")
    && formList.includes("<FormListCard") && formListCard.includes("<ContentCard") && contentCard.includes("prefetch={false}"),
  "반복 콘텐츠 카드가 모든 상세 라우트를 첫 화면에서 prefetch하면 안 됩니다.");

  assert(adminPage.includes("legacyAdminSection") && adminPage.includes("redirect("), "admin 루트는 레거시 tab 호환과 하위 라우트 이동만 담당해야 합니다.");
  assert(!adminPage.includes("getAdminUserPage") && !adminPage.includes("getAuditLogPage") && !adminPage.includes("readAdminSettings"), "admin 루트가 기능별 데이터를 직접 조회하면 안 됩니다.");
  assert(adminLayout.includes("AdminShell") && !adminLayout.includes("getAdminUserPage") && !adminLayout.includes("getTeacherApprovalCount"), "admin layout은 인증·공통 셸 외 목록 데이터를 조회하면 안 됩니다.");
  assert(adminShell.includes('href={ADMIN_SECTION_PATHS[id]}') && adminShell.includes("prefetch={false}") && !adminShell.includes("fetch("), "admin 셸은 정식 하위 링크만 그리고 다른 페이지를 미리 요청하면 안 됩니다.");
  assert(adminUsersPage.includes("getAdminUserPage") && adminAuditPage.includes("getAuditLogPage"), "admin 사용자·감사 라우트가 자기 조회를 소유해야 합니다.");
  assert(adminSettingsPage.includes("readAdminSettings") && !adminSettingsPage.includes("getPublicQuizLiveAudioSettings"), "admin 정책 라우트가 사운드 설정까지 함께 읽으면 안 됩니다.");
  assert(adminAudioPage.includes("getPublicQuizLiveAudioSettings") && !adminAudioPage.includes("readAdminSettings"), "admin 사운드 라우트가 정책 설정까지 함께 읽으면 안 됩니다.");
  assert(adminBoardsPage.includes("getAdminBoardPage") && adminQuizzesPage.includes("getAdminQuizPage") && adminFormsPage.includes("getAdminFormPage"), "admin 전체 콘텐츠는 리소스별 서버 라우트로 분리되어야 합니다.");
  assert(quizLibraryLayout.includes("Suspense") && quizLibraryPage.includes("renderQuizLibraryPage"), "퀴즈 보관함 하위 라우트는 공통 스트리밍 layout을 공유해야 합니다.");
  assert(quizDiscoverPage.includes('tab: "discover"') && quizLibraryPage.includes("parseLibraryParams(await searchParams, options.tab, options.view)"), "퀴즈 탐색은 독립 서버 라우트여야 합니다.");
  assert(routesSource.includes('path: "/quiz/favorites"') && routesSource.includes('path: "/quiz/discover"') && !routesSource.includes("readonly query?"), "화면 전환용 쿼리가 라우트 매니페스트에 남으면 안 됩니다.");
  assert(quizPage.includes('tab === "discover"') && quizPage.includes("legacyQuizLibraryView"), "예전 퀴즈 tab/view URL은 새 라우트로 호환되어야 합니다.");
  assert(proxySource.includes('pathname === "/quiz"') && proxySource.includes("legacyQuizLibraryView") && proxySource.includes("redirectWithoutLegacySearch"), "예전 퀴즈 URL은 페이지 렌더 전에 리다이렉트해야 합니다.");
  assert(quizLibrary.includes('discover ? "/quiz/discover" : QUIZ_LIBRARY_PATHS[params.view]') && !quizLibrary.includes('search.set("view"'), "퀴즈 보기는 경로로, 검색·정렬만 쿼리로 이동해야 합니다.");
  assert(quizLibraryData.includes('if (params.tab === "discover")') && quizLibraryData.includes("viewCounts: {}"), "퀴즈 탐색이 내 보관함 집계를 함께 조회하면 안 됩니다.");
  // 학생/관리자 분기와 layout의 children 전달은 verify-learning-routes에서 실제 실행합니다.
  assert(formRootPage.includes("legacyFormListView") && routesSource.includes('path: "/forms/open"'), "설문 상태별 정식 라우트와 기존 URL 호환을 유지해야 합니다.");
  assert(reportActivityLayout.includes("PageHeader") && reportRootPage.includes("legacyReportActivityType") && routesSource.includes('path: "/report/quizzes"'), "활동 종류별 리포트는 공통 layout 아래 정식 라우트여야 합니다.");
  assert(adminError.includes("router.back()") && adminError.includes("이전으로") && !adminError.includes("내 패드로"), "관리자 오류 화면은 패드가 아니라 이전 화면으로 돌아가야 합니다.");
  assert(adminThemePanel.includes("applyRootBrandTheme(savedRef.current)"), "테마 탭을 떠날 때 저장된 브랜드 색을 기본 파랑으로 지우면 안 됩니다.");
  assert(![uiPageLayout, uiFeedback, uiDataDisplay].some((source) => ["quiz", "pad", "forms", "admin", "courses", "home"].some((feature) => source.includes(`@/components/${feature}`))), "공용 UI가 제품 기능 폴더를 역으로 의존하면 안 됩니다.");
  assert(adminPagination.includes("pageWindow") && adminPagination.includes("AdminPageNavigation") && adminResourceUi.includes("ResourceManagerFilters"), "admin 공용 목록 프리미티브가 사라졌습니다.");
  assert(quizActivitiesPage.includes("take: SESSION_PAGE_SIZE") && quizAssignmentsPage.includes("take: ASSIGNMENT_PAGE_SIZE") && pageNumberNavigation.includes("PageNumberNavigation"), "누적되는 퀴즈 세션·과제 목록은 공용 서버 페이지 경계를 가져야 합니다.");
  assert([quizCollectionRoute, quizSessionCollectionRoute].every((source) => source.includes("take: pageSize") && source.includes("pageSize: z.coerce.number().int().min(1).max(100).default(50)")), "호환용 퀴즈·세션 컬렉션 API도 무제한 목록을 반환하면 안 됩니다.");
  assert(quizCollectionRoute.includes("CREATE_QUIZ_BODY_MAX_BYTES") && quizSessionCollectionRoute.includes("CREATE_SESSION_BODY_MAX_BYTES"), "퀴즈·세션 생성 JSON은 실제 스트림 본문 상한을 가져야 합니다.");
  assert(notificationBell.includes("detailsLoaded"), "알림 상세 목록은 벨을 열 때 지연 조회해야 합니다.");
  assert(notificationBell.includes("document.visibilityState") && notificationBell.includes("source?.close()"), "숨은 탭이 개인 알림 SSE 연결을 계속 점유하면 안 됩니다.");
  assert(mediaCapture.includes("streamGenerationRef"), "늦게 도착한 MediaStream을 폐기하는 세대 검사가 없습니다.");
  assert(hwpViewer.includes("controller.abort()"), "HWP 대용량 다운로드가 언마운트 때 취소되지 않습니다.");
  assert(officeViewer.includes("controller.abort()"), "Office 변환 확인 요청이 언마운트 때 취소되지 않습니다.");
  assert(selectableList.includes("signal: AbortSignal") && selectableList.includes("controller.abort()"), "페이지 목록의 오래된 검색 요청을 취소해야 합니다.");
  assert(appDialog.includes("dynamic(() => import"), "전역 대화상자 표면은 처음 사용할 때만 로드해야 합니다.");
  assert(documentConvert.includes("MAX_RECENT_FAILURES"), "문서 변환 실패 캐시는 상한을 가져야 합니다.");
  assert(socketServer.includes("MAX_PUBLIC_EVENT_LIMITERS") && socketServer.includes(".dispose()"), "공개 소켓 rate limiter 캐시는 상한과 정리 경로를 가져야 합니다.");
  assert(socketServer.includes("loadSessionForJoin") && socketServer.includes("pendingJoinSessionLoads"), "한 반의 동시 소켓 입장이 동일한 세션 전문 SELECT를 반복하면 안 됩니다.");
  assert(socketServer.includes("loadAnswerContextForSubmission") && socketServer.includes("pendingAnswerContexts"), "동시에 몰린 답안이 현재 세션·문항 SELECT를 참가자마다 반복하면 안 됩니다.");
  assert(socketServer.includes('emitToSessionHosts(io, sessionId, "answer:progress"') && socketServer.includes('emitToSessionHosts(io, sessionId, "participation:update"'), "호스트 전용 퀴즈 집계를 학생 전체 room에 방송하면 안 됩니다.");
  assert(socketServer.includes("question: currentQuestion") && grading.includes("params.question ?? await loadGradingQuestion"), "답안 검증과 채점이 같은 문항을 두 번 SELECT하면 안 됩니다.");
  assert(serverRateLimit.includes("limitersByPolicy") && serverRateLimit.includes("MAX_RATE_LIMIT_POLICIES") && !serverRateLimit.includes("limitersByName"), "동적 scope마다 rate limiter와 interval을 만들면 안 됩니다.");
  assert(platformPolicy.includes("pendingLoad?.generation === generation") && platformPolicy.includes("generation += 1"), "100명 동시 연결의 보안 정책 조회를 합치고 변경 중 낡은 캐시를 차단해야 합니다.");
  assert(platformPolicy.includes("loadedFromDatabase && generation === loadGeneration"), "DB 실패 때 쓴 플랫폼 기본값을 정상 정책처럼 캐시하면 안 됩니다.");
  assert(authSecurity.includes("login-ip-failure"), "학교 공용 IP에는 로그인 실패만 누적해야 합니다.");
  assert(formEditor.includes("dynamic(() => loadFormSettingsPanel()") && formEditor.includes("settingsOpen ? <FormSettingsPanel") && formEditor.includes("sectionTargetSignature"), "설문 편집기의 닫힌 패널과 섹션 후보 계산이 매 입력의 초기 비용으로 돌아오면 안 됩니다.");
  assert(quizEditor.includes("dynamic(() => import(\"@/components/quiz/quiz-editor-preview\")") && !quizEditor.includes("from \"@/components/quiz/play-session\""), "퀴즈 편집기가 실제 플레이 화면을 초기 청크에 포함하면 안 됩니다.");
  assert(quizEditor.includes("dynamic(() => import(\"@/components/quiz/image-pin\")"), "핀 정답 영역 도구는 열 때만 로드해야 합니다.");
  assert(quizLibrary.includes("dynamic(() => import(\"@/components/ui/selectable-list\")"), "퀴즈 공유·할당 후보 목록은 모달에서만 로드해야 합니다.");
  assert(quizSessionLauncher.includes("dynamic(() => loadQuizSessionDialog()"), "카드마다 세션 생성 모달 상태를 초기화하면 안 됩니다.");
  assert(formFieldCard.includes("dynamic(() => import(\"@/components/forms/signature-pad\")") && formAnswerFields.includes("dynamic(() => import(\"@/components/forms/signature-pad\")"), "서명 캔버스 엔진은 서명 문항에서만 로드해야 합니다.");
  assert(lazyPostComposer.includes("import(\"@/components/pad/post-composer\")") && padCanvas.includes("LazyPostComposer") && !padCanvas.includes("from \"@/components/pad/post-composer\""), "패드 작성기와 첨부 도구는 작성 의도가 생긴 뒤 로드해야 합니다.");
  assert(boardQueries.includes("SECTION_POST_PAGE_SIZE + 1") && padCanvas.includes("/posts?cursor=") && padCanvas.includes("controller.abort()"), "패드 첫 응답과 이어받기 요청은 섹션별 페이지 경계를 가져야 합니다.");
  assert(postCard.includes("memo(function PostCard") && sectionColumn.includes("memo(function SectionColumn"), "상위 UI 상태 변경이 전체 패드 카드 트리를 다시 렌더하면 안 됩니다.");
  assert(!postCard.includes("from \"@dnd-kit") && sortablePostCard.includes("useSortable") && sectionColumn.includes("postSortingEnabled") && sectionColumn.includes("dragDisabled={dragDisabled}") && flatBoard.includes("dragDisabled={dragDisabled}") && padCanvas.includes("canReorderLoadedPosts"), "읽기 전용 PostCard가 DnD를 포함하거나, 활성 정렬 목록의 이동 불가 카드가 drop 기준 측정에서 빠지면 안 됩니다.");
  assert(padEvents.includes("document.visibilityState") && padEvents.includes("syncAfterVisibilityPause"), "숨은 패드 탭은 SSE를 놓고 복귀 때 서버 정본으로 수렴해야 합니다.");
  assert(!padEvents.includes('from "next/navigation"') && !padEvents.includes("router.refresh()") && padCanvas.includes("applyBoardEventDelta") && padCanvas.includes("/realtime-snapshot"), "패드 SSE가 전체 RSC 새로고침으로 돌아가면 안 됩니다.");
  assert(boardEventRoute.includes("subscribe(emit, close)") && boardEventRoute.includes("close();") && sseStream.includes("close: () => void"), "접근 변경 뒤 기존 SSE를 닫고 재연결 권한 검사를 거쳐야 합니다.");
  assert(boardMembersRoute.includes("delivery: { public: false") && boardMembersRoute.includes("recipientUserIds"), "한 멤버 변경이 모든 학생 연결에 스냅샷을 요구하면 안 됩니다.");
  assert(listDrag.includes("startBlockingTouchScroll") && listDrag.includes('window.addEventListener("pointermove", move, { passive: true })'), "편집기 드래그 훅이 평상시 스크롤을 non-passive 리스너로 막으면 안 됩니다.");
  assert(sortableOrderAnswer.includes("if (!dragging) return;") && sortableOrderAnswer.includes('window.addEventListener("pointermove", movePointer, { passive: true })'), "순서형 답안의 스크롤 차단은 실제 드래그 중에만 켜야 합니다.");
  for (const source of [rosterPanel, formResponseSummary, formShareDialog, padActivityPanel, padInviteLinks, memberGroupInvite]) {
    assert(source.includes("AbortController") && source.includes("controller.abort()"), "닫히거나 페이지가 바뀐 패널의 지연 GET 요청을 취소해야 합니다.");
  }
  assert(joinSessionCard.includes("AbortController") && joinSessionCard.includes("autoJoinStarted.current = false"), "로그인 퀴즈 자동 입장은 effect 취소 시 요청과 재실행 잠금을 함께 정리해야 합니다.");
  assert(formSummary.includes("SUMMARY_ANSWER_PAGE_SIZE") && formSummary.includes("take: SUMMARY_ANSWER_PAGE_SIZE") && formSummary.includes("cursor: { id: cursor }"), "설문 요약이 모든 답변을 한 번에 메모리에 올리면 안 됩니다.");
  assert(sitemapSource.includes("SITEMAP_CONTENT_LIMIT") && sitemapSource.includes("take: boardTake") && sitemapSource.includes("take: postTake"), "공개 콘텐츠 사이트맵은 검색 엔진 한도와 같은 DB 조회 상한을 가져야 합니다.");
  assert([boardMembersRoute, boardAccessRequests, boardInviteLinks, boardPendingPosts].every((source) => source.includes("take:") && source.includes("totalCount")), "누적되는 패드 관리 목록 API는 DB 페이지 경계와 전체 개수를 반환해야 합니다.");
  assert(padSettingsTabs.includes("멤버 더 보기") && padAccessRequests.includes("요청 더 보기") && padInviteLinks.includes("초대 링크 더 보기"), "페이지 경계를 둔 패드 관리 목록에는 이어보기 UI가 있어야 합니다.");
  assert(hostSessionReport.includes("ParticipantCards") && hostSessionReport.includes("ReportPinDistribution") && !hostSessionReport.includes('from "@/components/quiz/image-pin"'), "퀴즈 결과는 모바일 카드와 가벼운 핀 전용 뷰어를 사용해야 합니다.");
  assert(participationViews.includes('dynamic(() => import("@/components/quiz/image-pin")'), "참여 결과의 핀 분포 도구는 DROP_PIN 결과에서만 로드해야 합니다.");
  assert([quizEditor, quizSessionDialog, padReuseDialog].every((source) => source.includes('from "@/components/ui/modal"')), "커스텀 모달이 공통 포커스·ESC·스크롤 잠금을 우회하면 안 됩니다.");
  assert(modalSource.includes("createPortal(modal, document.body)") && !modalSource.includes("bottomPanel && typeof document"), "공용 모달은 nav·transform stacking context에 갇히지 않도록 종류와 관계없이 body 포털을 사용해야 합니다.");

  console.log("성능 경계 정적 검증을 통과했습니다.");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "성능 경계 검증에 실패했습니다.");
  process.exitCode = 1;
});
