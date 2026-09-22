import type { NavItemView, NavSectionView, TopSectionView } from "@/lib/nav-view";
import { COURSE_LIST_PATH, DASHBOARD_PATH, PAD_HOME_PATH, QUIZ_ASSIGNMENTS_PATH } from "@/lib/route-paths";

// Cookie scope, not a navigable page/API endpoint.
export const AUTH_API_COOKIE_PATH = "/api/auth/";

// 경로·구역·권한을 한곳에 선언하고 사이드바, `proxy.ts`, 링크 생성기가 함께 읽습니다.
// 메뉴 정의가 컴포넌트 JSX에, 접근 규칙이 프록시에 따로 있으면 둘이 조용히 어긋나
// "메뉴엔 보이는데 들어가면 403"이 생깁니다. 한곳에서 선언하면 그 표류가 구조적으로 막힙니다.
//
// 이 모듈은 `proxy.ts`(Node 런타임)와 Client Component 양쪽에서 평가되므로 React,
// lucide-react, `server-only`에 절대 의존하면 안 됩니다. 아이콘은 문자열 키로만 담고 실제
// 컴포넌트 매핑은 `components/shell/nav-icons.tsx`가 가집니다.
//
// `proxy.ts`의 `config.matcher`는 Next가 빌드 시점에 AST로 정적 추출하므로 여기서 만들 수
// 없습니다. 매처는 리터럴로 둡니다.

export type UserRole = "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";

export type SystemPermission =
  | "VIEW_USERS" | "CHANGE_NON_ADMIN_ROLES" | "SUSPEND_USERS" | "REVOKE_USER_SESSIONS"
  | "VIEW_USER_PII" | "VIEW_AUDIT_LOG"
  | "VIEW_ALL_BOARDS" | "EDIT_ANY_CONTENT" | "MODERATE_CONTENT" | "CREATE_CONTENT_ANYWHERE"
  | "MANAGE_BOARD_SETTINGS" | "TRANSFER_BOARD_OWNERSHIP"
  | "VIEW_ALL_QUIZZES" | "EDIT_ANY_QUIZ" | "MANAGE_ANY_SESSION" | "ISSUE_STUDENT_ACCOUNTS";

/**
 * `app/` 라우트 그룹과 1:1로 대응하는 구역. 그룹 이름은 URL에서 지워지므로 프록시는 요청이
 * 어느 그룹에 속하는지 알 수 없고, 대신 이 선언과 경로 접두사로 판정합니다.
 *
 * - `marketing` 공개 소개. 로그인·온보딩 게이트를 적용하지 않습니다.
 * - `auth`      로그인·가입 완료 전 단계. 프록시가 여기로 보냅니다.
 * - `workspace` 로그인 필수 + 사이드바 셸.
 * - `focus`     로그인 필수, 셸 없음(편집기·호스트 콘솔 같은 전체화면).
 * - `play`      짧은 공개 참여 URL. 세션이 없어도 열리고, 승인 대기 계정은 게스트로 참여합니다.
 */
export type RouteZone = "marketing" | "auth" | "workspace" | "focus" | "play";

export type NavIconKey =
  | "home" | "search" | "quiz" | "activity" | "assignment"
  | "pad" | "star" | "archive" | "report" | "students" | "writeup" | "admin" | "form"
  | "subject";

export type NavSectionKey = "primary" | "dashboard" | "quiz" | "pad" | "form" | "report" | "admin";

/**
 * 상단 navbar의 최상위 섹션. 사이드바는 **선택된 섹션 안에서만** 하위 라우팅을 그립니다.
 * 대부분 접두사 하나를 쓰지만, 대시보드처럼 독립 URL을 유지하는 교과목까지 품는 섹션은
 * 여러 접두사를 가질 수 있습니다.
 */
export type TopSectionKey = "dashboard" | "quiz" | "pad" | "form" | "report";

export type TopSection = {
  readonly key: TopSectionKey;
  readonly label: string;
  readonly path: string;
  /** 이 접두사 중 하나로 시작하면 해당 섹션이 활성입니다. */
  readonly prefixes: readonly string[];
  readonly icon: NavIconKey;
  /** 사이드바에 그릴 섹션 키. 없으면 이 섹션에는 사이드바가 없습니다. */
  readonly sidebar?: NavSectionKey;
  readonly roles?: readonly UserRole[];
};

export const TOP_SECTIONS = [
  // 교과목은 독립 콘텐츠보다 퀴즈·패드·학생을 묶는 수업 기준에 가깝습니다. 상세 URL은 기존
  // 링크 호환을 위해 /courses로 유지하되, 상단에서는 대시보드 영역으로 판정합니다.
  { key: "dashboard", label: "대시보드", path: "/dashboard", prefixes: ["/dashboard", "/courses"], icon: "report", sidebar: "dashboard" },
  { key: "quiz", label: "퀴즈", path: "/quiz", prefixes: ["/quiz"], icon: "quiz", sidebar: "quiz" },
  { key: "pad", label: "패드", path: "/pad", prefixes: ["/pad"], icon: "pad", sidebar: "pad" },
  // 학생은 응답 가능한 설문 목록만 봅니다. 편집·타인 응답 관리는 별도 서버 권한 경계입니다.
  { key: "form", label: "설문", path: "/forms", prefixes: ["/forms"], icon: "form", sidebar: "form" },
  // 생기부 문안(옛 /recode)은 이 섹션의 사이드바 한 줄로 들어옵니다. 재료가 전부 리포트의
  // Activity라서 섹션을 따로 차지할 이유가 없었고, 상단 섹션 판정이 URL 접두사 기반이라
  // 사이드바로 내리려면 경로도 /report 아래로 와야 했습니다.
  { key: "report", label: "리포트", path: "/report", prefixes: ["/report"], icon: "report", sidebar: "report" },
] as const satisfies readonly TopSection[];

/** 상단 섹션이 그리는 사이드바 키. `as const`가 좁힌 타입을 선언 타입으로 넓혀서 읽습니다. */
export function sidebarKeyFor(section: TopSectionKey | null): NavSectionKey | null {
  if (!section) return null;
  return (TOP_SECTIONS as readonly TopSection[]).find((s) => s.key === section)?.sidebar ?? null;
}

export function activeTopSection(pathname: string): TopSectionKey | null {
  return TOP_SECTIONS
    .flatMap((section) => section.prefixes.map((prefix) => ({ section, prefix })))
    .filter(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0]?.section.key ?? null;
}

export function topSectionsFor(user: NavUser): TopSection[] {
  // `as const`가 항목마다 리터럴 타입으로 좁혀 roles가 없는 항목에서는 속성 접근이 막히므로
  // 순회할 때만 선언 타입으로 넓힙니다.
  return (TOP_SECTIONS as readonly TopSection[]).filter((s) => !s.roles || s.roles.includes(user.role));
}

export type RouteDef = {
  /** 코드에서 참조하는 안정 식별자. URL이 바뀌어도 이 값은 유지합니다. */
  readonly id: string;
  /** 동적 세그먼트는 `:param`으로 씁니다(next.config의 redirects와 같은 표기). */
  readonly path: string;
  readonly zone: RouteZone;
  /** 사이드바에 노출할 때만 채웁니다. 없으면 메뉴에 나타나지 않습니다. */
  readonly nav?: {
    readonly section: NavSectionKey;
    readonly label: string;
    readonly icon: NavIconKey;
    /** `prefix`면 하위 경로에서도 활성으로 봅니다. 기본값은 정확히 일치. */
    readonly match?: "exact" | "prefix";
    readonly order: number;
    /** 값이 있으면 그 id의 항목 **아래에 들여쓴 하위 항목**으로 그립니다. */
    readonly parent?: string;
    /** 개수 배지를 붙일 키. 화면이 올려 주는 집계(`useNavCounts`)에서 이 키를 찾습니다. */
    readonly countKey?: string;
  };
  /** 비어 있으면 "로그인만 필요". 프록시가 JWT만으로 값싸게 볼 수 있는 거친 판정입니다. */
  readonly roles?: readonly UserRole[];
  /** 정밀 판정. `getCurrentUser()`가 필요하므로 프록시가 아니라 레이아웃·페이지가 씁니다. */
  readonly permission?: SystemPermission;
};

// 현재 URL을 한곳에 선언합니다. 경로가 바뀌면 여기만 고쳐 사이드바와 링크가 함께
// 따라오게 합니다.
//
// 검색은 퀴즈·패드를 함께 훑으므로 라벨 없는 `primary`에 두고, 나머지는 도메인별 섹션으로
// 나눕니다.
export const ROUTES = [
  // ── marketing ────────────────────────────────────────────────
  { id: "home", path: "/", zone: "marketing" },
  { id: "guide", path: "/guide", zone: "marketing" },
  { id: "terms", path: "/terms", zone: "marketing" },
  { id: "privacy", path: "/privacy", zone: "marketing" },

  // ── auth ─────────────────────────────────────────────────────
  { id: "login", path: "/login", zone: "auth" },
  { id: "onboarding", path: "/onboarding", zone: "auth" },
  { id: "approvalPending", path: "/approval-pending", zone: "auth" },
  { id: "changePassword", path: "/change-password", zone: "auth" },

  // ── workspace ────────────────────────────────────────────────
  // 대시보드 — 퀴즈·패드를 아우르는 통합 현황. 로그인 후 기본 도착지입니다.
  { id: "dashboard", path: "/dashboard", zone: "workspace",
    nav: { section: "dashboard", label: "전체 현황", icon: "home", match: "exact", order: 10 } },

  // 교과목 — 학생·퀴즈·패드를 한 수업 단위로 묶습니다. 개별 교과목은 사이드바가 목록으로 그립니다.
  { id: "courseList", path: "/courses", zone: "workspace",
    nav: { section: "dashboard", label: "교과목", icon: "subject", match: "exact", order: 20 } },
  { id: "courseDetail", path: "/courses/:subjectId", zone: "workspace" },

  // 패드
  { id: "padList", path: "/pad", zone: "workspace",
    nav: { section: "pad", label: "내 패드", icon: "pad", match: "exact", order: 10 } },
  { id: "favorites", path: "/pad/favorites", zone: "workspace",
    nav: { section: "pad", label: "즐겨찾기", icon: "star", match: "exact", order: 20 } },
  { id: "archived", path: "/pad/archived", zone: "workspace",
    nav: { section: "pad", label: "보관된 패드", icon: "archive", match: "exact", order: 30 } },
  { id: "folder", path: "/pad/folders/:folderId", zone: "workspace" },
  // 예전 독립 검색 주소의 북마크 호환용. 페이지가 패드 목록(`/pad`)으로 redirect합니다.
  { id: "search", path: "/search", zone: "workspace" },

  // 퀴즈 — 사이드바에는 보관함·즐겨찾기·진행·탐색처럼 서로 다른 목적지만 둡니다. 할당 여부와
  // 발행 상태는 본문의 필터 칩이 담당하고, 기존 정식 하위 경로는 북마크 호환을 위해 유지합니다.
  { id: "quizList", path: "/quiz", zone: "workspace",
    nav: { section: "quiz", label: "내 퀴즈", icon: "quiz", match: "exact", order: 10 } },
  { id: "quizViewFavorites", path: "/quiz/favorites", zone: "workspace",
    nav: { section: "quiz", label: "즐겨찾기", icon: "star", order: 20, countKey: "FAVORITES" } },
  { id: "quizViewAssigned", path: "/quiz/assigned", zone: "workspace" },
  { id: "quizViewUnassigned", path: "/quiz/unassigned", zone: "workspace" },
  { id: "quizViewDraft", path: "/quiz/drafts", zone: "workspace" },
  { id: "quizNew", path: "/quiz/new", zone: "workspace" },
  { id: "quizDetail", path: "/quiz/:quizId", zone: "workspace" },
  // 교사가 연 세션의 결과 화면입니다. `quizAssignments`와 정반대로 학생에게는 뜨면 안 됩니다 —
  // roles를 안 걸었더니 학생 사이드바에도 "진행·기록"이 뜨고, 누르면 페이지가 /j로 튕겨서
  // "눌렀는데 딴 데로 간다"가 됐습니다. 학생이 볼 것은 `할당 퀴즈`입니다.
  { id: "quizActivities", path: "/quiz/activities", zone: "workspace",
    roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"],
    nav: { section: "quiz", label: "진행·기록", icon: "activity", match: "prefix", order: 30 } },
  { id: "quizActivity", path: "/quiz/activities/:sessionId", zone: "workspace",
    roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  { id: "quizActivityReport", path: "/quiz/activities/:sessionId/report", zone: "workspace",
    roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  // 학생 전용입니다. roles를 안 걸면 교사·관리자 사이드바에도 뜨는데 페이지는 학생만 받으므로
  // "메뉴엔 보이는데 눌러도 안 열린다"가 됩니다 — 매니페스트가 막으려던 바로 그 모양입니다.
  // 교사가 낸 할당 퀴즈는 `/quiz/activities`(진행·기록)에서 봅니다.
  { id: "quizAssignments", path: "/quiz/assignments", zone: "workspace", roles: ["STUDENT"],
    nav: { section: "quiz", label: "할당 퀴즈", icon: "assignment", match: "exact", order: 30 } },
  // 탐색은 보관함과 데이터 범위가 다른 독립 화면이므로 정식 하위 라우트로 둡니다.
  { id: "quizDiscover", path: "/quiz/discover", zone: "workspace",
    roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"],
    nav: { section: "quiz", label: "퀴즈 탐색", icon: "search", match: "exact", order: 40 } },
  // 설문 — 상태별 보기는 본문의 필터 칩이 담당합니다. 정식 하위 경로는 북마크와 필터 상태를
  // 유지하되 사이드바에는 반복하지 않습니다.
  { id: "formList", path: "/forms", zone: "workspace",
    nav: { section: "form", label: "내 설문", icon: "form", match: "exact", order: 10 } },
  { id: "formViewOpen", path: "/forms/open", zone: "workspace", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  { id: "formViewDraft", path: "/forms/drafts", zone: "workspace", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  { id: "formViewClosed", path: "/forms/closed", zone: "workspace", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  { id: "formDetail", path: "/forms/:formId", zone: "workspace", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  { id: "formResponses", path: "/forms/:formId/responses", zone: "workspace", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  { id: "formResponseQuestions", path: "/forms/:formId/responses/questions", zone: "workspace", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  { id: "formResponseIndividual", path: "/forms/:formId/responses/individual", zone: "workspace", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },

  // 리포트 — 퀴즈와 패드의 활동을 한 흐름으로 봅니다.
  { id: "report", path: "/report", zone: "workspace",
    nav: { section: "report", label: "활동 리포트", icon: "report", match: "exact", order: 10 } },
  { id: "reportQuizzes", path: "/report/quizzes", zone: "workspace",
    nav: { section: "report", label: "퀴즈", icon: "quiz", order: 11, parent: "report" } },
  { id: "reportPads", path: "/report/pads", zone: "workspace",
    nav: { section: "report", label: "패드", icon: "pad", order: 12, parent: "report" } },
  { id: "reportForms", path: "/report/forms", zone: "workspace",
    nav: { section: "report", label: "설문", icon: "form", order: 13, parent: "report" } },
  { id: "reportStudents", path: "/report/students", zone: "workspace",
    nav: { section: "report", label: "학생 기록", icon: "students", match: "prefix", order: 20 } },
  { id: "reportStudent", path: "/report/students/:studentId", zone: "workspace" },
  { id: "reportMyHistory", path: "/report/students/me", zone: "workspace" },
  // 활동 기록으로 생활기록부 문안을 만듭니다. 학생 개인정보를 다루므로 교사 이상만 봅니다.
  { id: "reportWriteup", path: "/report/writeup", zone: "workspace",
    roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"],
    nav: { section: "report", label: "생기부 작성", icon: "writeup", match: "exact", order: 30 } },

  { id: "profile", path: "/profile", zone: "workspace" },
  // 관리 콘솔은 자체 layout과 하위 라우트를 사용합니다. 앱 셸에서는 하단 아이콘으로만
  // 진입하므로 여기에는 최상위 인증 경계만 선언하고 세부 메뉴는 admin layout이 그립니다.
  { id: "admin", path: "/admin", zone: "workspace", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },

  // ── focus (셸 없는 전체화면) ─────────────────────────────────
  { id: "quizEdit", path: "/quiz/:quizId/edit", zone: "focus" },
  { id: "formEdit", path: "/forms/:formId/edit", zone: "focus", roles: ["SUPER_ADMIN", "ADMIN", "TEACHER"] },
  { id: "quizHost", path: "/quiz/host/:sessionId", zone: "focus" },

  // ── play ─────────────────────────────────────────────────────
  // 참여 주소는 손으로 치거나 QR·프로젝터로 봅니다. 그래서 한 글자 세그먼트를 씁니다 —
  // 짧아서만이 아니라, 프록시의 "인증 건너뛰기" 판정이 작은 접두사 목록 비교로 끝나기 때문입니다.
  { id: "joinEntry", path: "/j", zone: "play" },
  { id: "joinWithPin", path: "/j/:pin", zone: "play" },
  // 로그인 세션과 공개 세션이 같은 라우트입니다. 예전에는 `/join`·`/public/join`으로 갈려
  // 서로에게 리다이렉트해서 정상 참여에도 왕복이 끼었습니다.
  { id: "playSession", path: "/p/:sessionId", zone: "play" },
  { id: "playSessionReport", path: "/p/:sessionId/report", zone: "play" },
  { id: "board", path: "/b/:slug", zone: "play" },
  { id: "boardPost", path: "/b/:slug/posts/:postId", zone: "play" },
  { id: "boardPresent", path: "/b/:slug/present", zone: "play" },
  { id: "boardPrint", path: "/b/:slug/print", zone: "play" },
  { id: "boardCopy", path: "/b/:slug/copy", zone: "play" },
  { id: "invite", path: "/i/:token", zone: "play" },
  { id: "fileStream", path: "/f/:attachmentId", zone: "play" },
  { id: "formFill", path: "/s/:slug", zone: "play" },
  { id: "formDone", path: "/s/:slug/done", zone: "play" },
  { id: "shortLink", path: "/go/:slug", zone: "play" },
] as const satisfies readonly RouteDef[];

export type RouteId = (typeof ROUTES)[number]["id"];

const BY_ID = new Map<string, RouteDef>(ROUTES.map((route) => [route.id, route]));
const MARKETING_PATHS = new Set(
  (ROUTES as readonly RouteDef[])
    .filter((route) => route.zone === "marketing")
    .map((route) => route.path),
);

/**
 * 타입 안전 링크 생성기. 흩어진 문자열 리터럴을 이걸로 대체하면 경로가 바뀔 때 매니페스트
 * 한곳만 고치면 됩니다.
 */
export function href(id: RouteId, params?: Record<string, string | number>): string {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`알 수 없는 라우트: ${id}`);
  const path = def.path.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
    const value = params?.[key];
    if (value === undefined) throw new Error(`라우트 ${id}에 필요한 파라미터가 없습니다: ${key}`);
    return encodeURIComponent(String(value));
  });
  return path;
}

// `play` 구역의 URL 접두사. 라우트 그룹 이름은 URL에서 지워지므로 프록시는 이 목록으로만
// "공개 참여 화면"을 알 수 있습니다.
const PLAY_PREFIXES = ["/b", "/f", "/go", "/i", "/j", "/p", "/s"] as const;

export function isPlayPath(pathname: string): boolean {
  return PLAY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** 로그인·온보딩·가입 승인 상태와 관계없이 열리는 공개 소개 화면입니다. */
export function isMarketingPath(pathname: string): boolean {
  return MARKETING_PATHS.has(pathname);
}

/** 인증을 아예 요구하지 않는 API. `play` 페이지의 API 짝입니다. */
export function isOpenApiPath(pathname: string): boolean {
  return pathname === "/api/public" || pathname.startsWith("/api/public/");
}

export function isActive(def: RouteDef, pathname: string): boolean {
  const pathMatches = def.nav?.match === "prefix"
    ? pathname === def.path || pathname.startsWith(`${def.path}/`)
    : pathname === def.path;
  return pathMatches;
}

// ── 사이드바 ───────────────────────────────────────────────────

export type NavUser = {
  readonly role: UserRole;
  readonly systemPermissions: readonly SystemPermission[];
};

/**
 * 메뉴에 보일지 판정합니다. `lib/auth/authorization.ts`의 `hasSystemPermission`과 같은 규칙
 * (전체관리자는 무조건 통과)을 클라이언트에서 재현한 것입니다.
 *
 * 이건 **메뉴를 숨기는 용도일 뿐**이고 실제 경계는 각 페이지와 API가 다시 검사합니다.
 */
function isVisible(def: RouteDef, user: NavUser): boolean {
  if (def.roles && !def.roles.includes(user.role)) return false;
  if (def.permission && user.role !== "SUPER_ADMIN" && !user.systemPermissions.includes(def.permission)) return false;
  return true;
}

export const NAV_SECTION_LABELS: Record<NavSectionKey, string | null> = {
  // 상단 navbar가 섹션을 구분하므로 사이드바에는 머리글을 두지 않습니다 — 같은 이름이 두 번
  // 나오면 "패드 > 패드"처럼 읽힙니다. 하위 묶음이 여럿인 섹션이 생기면 그때 라벨을 넣습니다.
  primary: null,
  dashboard: null,
  quiz: null,
  pad: null,
  form: null,
  report: null,
  admin: null,
};

/** 사이드바 한 줄. `children`이 있으면 그 아래에 들여쓴 하위 항목을 그립니다. */
export type NavNode = {
  readonly def: RouteDef;
  readonly children: readonly RouteDef[];
};

export type NavSection = {
  readonly key: NavSectionKey;
  readonly label: string | null;
  readonly items: readonly NavNode[];
};

const SECTION_ORDER: readonly NavSectionKey[] = ["primary", "dashboard", "quiz", "pad", "form", "report", "admin"];

/**
 * 사이드바에 그릴 항목입니다. **현재 상단 섹션 안의 것만** 돌려줍니다 — 상단 navbar가 섹션을
 * 전환하고 사이드바는 그 안에서만 이동하는 2단 구조라, 전 섹션을 한 줄에 쌓으면 두 층이
 * 같은 일을 하게 됩니다.
 *
 * `section`을 넘기지 않으면(예: 상단 섹션이 없는 화면) 빈 배열입니다.
 */
export function navSectionsFor(user: NavUser, section?: NavSectionKey | null): NavSection[] {
  if (!section) return [];
  const grouped = new Map<NavSectionKey, RouteDef[]>();
  // `as const`가 각 항목을 리터럴 타입으로 좁혀 `nav`가 없는 항목에서는 속성 접근이 막히므로,
  // 순회할 때만 선언 타입으로 넓힙니다(`href`의 id 자동완성은 그대로 유지됩니다).
  for (const def of ROUTES as readonly RouteDef[]) {
    if (!def.nav || def.nav.section !== section || !isVisible(def, user)) continue;
    const items = grouped.get(def.nav.section) ?? [];
    items.push(def);
    grouped.set(def.nav.section, items);
  }
  return SECTION_ORDER.flatMap((key) => {
    const items = grouped.get(key);
    if (!items?.length) return [];
    const sorted = [...items].sort((a, b) => a.nav!.order - b.nav!.order);
    // 부모가 안 보이는(권한이 없어 걸러진) 하위 항목은 함께 사라집니다. 부모 없이 떠 있으면
    // 무엇의 필터인지 읽을 수 없습니다.
    const roots = sorted.filter((def) => !def.nav!.parent);
    return [{
      key,
      label: NAV_SECTION_LABELS[key],
      items: roots.map((def) => ({
        def,
        children: sorted.filter((child) => child.nav!.parent === def.id),
      })),
    }];
  });
}


// ── 셸에 내려보내는 뷰 데이터 ──────────────────────────────────────────────────
// 상단바·사이드바는 활성 표시 때문에 클라이언트 컴포넌트여야 합니다(레이아웃은 라우트 이동 시
// 다시 렌더링되지 않으므로 서버가 계산한 활성 값은 곧 낡습니다). 그런데 셸이 이 파일에서
// 함수 하나만 import해도 **라우트 표 47개가 통째로** 클라이언트 번들에 실립니다.
//
// 그래서 서버가 여기서 "보이는 항목만" 평범한 데이터로 만들어 내려보내고, 클라이언트는
// lib/nav-view.ts의 순수 함수로 활성만 계산합니다. 클라이언트에 매니페스트가 없으니 서버와
// 어긋날 수가 없습니다 — 실제로 어긋나서 hydration 불일치가 났던 적이 있습니다.

function toNavItemView(def: RouteDef): NavItemView {
  return {
    id: def.id,
    href: href(def.id as RouteId),
    label: def.nav!.label,
    icon: def.nav!.icon,
    ...(def.nav!.countKey ? { countKey: def.nav!.countKey } : {}),
    path: def.path,
    match: def.nav!.match === "prefix" ? "prefix" : "exact",
  };
}

/** 상단 섹션을 그리는 데 필요한 것만. 역할 필터는 서버에서 끝냅니다. */
export function topSectionViewsFor(user: NavUser): TopSectionView[] {
  return topSectionsFor(user).map((section) => ({
    key: section.key,
    label: section.label,
    href: section.path,
    icon: section.icon,
    prefixes: section.prefixes,
  }));
}

/** 한 상단 섹션 안의 사이드바 항목. 권한으로 걸러진 결과만 나갑니다. */
export function navSectionViewsFor(user: NavUser, topSectionKey: string | null): NavSectionView[] {
  const sidebar = sidebarKeyFor(topSectionKey as TopSectionKey | null);
  return navSectionsFor(user, sidebar).map((section) => ({
    key: section.key,
    label: section.label,
    groups: section.items.map(({ def, children }) => ({
      item: toNavItemView(def),
      children: children.map(toNavItemView),
    })),
  }));
}

/**
 * 상단 섹션 **전부**의 사이드바 항목을 미리 만들어 둡니다.
 *
 * 한 섹션만 보내면 될 것 같지만 안 됩니다 — 레이아웃은 라우트를 옮겨도 다시 렌더링되지 않으므로
 * (그게 사이드바·SSE가 안 끊기는 이유입니다) 서버가 고른 섹션은 /pad → /quiz 이동 직후 낡습니다.
 * 그래서 서버는 "보일 수 있는 것 전부"를 주고, 클라이언트가 pathname으로 그중 하나를 고릅니다.
 * 그래도 라우트 표 47개 대신 메뉴에 실제로 뜨는 항목만 나가므로 매니페스트는 넘어가지 않습니다.
 */
export function navSectionViewsByTopSection(user: NavUser): Record<string, NavSectionView[]> {
  const result: Record<string, NavSectionView[]> = {};
  for (const section of topSectionsFor(user)) {
    if (!section.sidebar) continue;
    result[section.key] = navSectionViewsFor(user, section.key);
  }
  return result;
}

// 기존 코드가 쓰던 두 상수는 매니페스트에서 파생시켜 유지합니다. 공개 랜딩(`/`)과 로그인 후
// 작업공간(`/dashboard`)을 문자열 수준에서도 구분해야, 루트를 다시 대시보드 의미로 쓰기
// 시작했을 때 OAuth·온보딩·브랜드 링크가 뒤섞이는 일을 막을 수 있습니다.
export const PUBLIC_HOME_PATH = href("home");
// 클라이언트가 쓰는 고정 경로는 lib/route-paths.ts에 따로 둡니다(그쪽은 아무것도 import하지
// 않아서 매니페스트를 끌고 오지 않습니다). 여기서는 **매니페스트와 어긋나지 않는지 확인**한 뒤
// 그대로 다시 내보냅니다 — 두 곳에 손으로 적힌 값이 조용히 갈라지는 걸 막습니다.
for (const [label, literal, id] of [
  ["DASHBOARD_PATH", DASHBOARD_PATH, "dashboard"],
  ["PAD_HOME_PATH", PAD_HOME_PATH, "padList"],
  ["COURSE_LIST_PATH", COURSE_LIST_PATH, "courseList"],
  ["QUIZ_ASSIGNMENTS_PATH", QUIZ_ASSIGNMENTS_PATH, "quizAssignments"],
] as const) {
  const fromManifest = href(id as RouteId);
  if (literal !== fromManifest) {
    throw new Error(`lib/route-paths.ts의 ${label}(${literal})가 매니페스트(${fromManifest})와 다릅니다.`);
  }
}
export { DASHBOARD_PATH, PAD_HOME_PATH, COURSE_LIST_PATH, QUIZ_ASSIGNMENTS_PATH };
