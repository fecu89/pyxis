// 코드 안의 모든 내부 경로 리터럴을 실제 라우트와 대조합니다.
//
//   npx tsx scripts/verify-routes.ts
//
// 이 검사가 없던 동안 quiz에서 이식한 코드가 `/quizzes`, `/sessions`, `/student-login` 같은
// 죽은 경로를 가리킨 채로 남아 있었습니다. 페이지 GET은 200이라 상태 코드만 보는 검증은
// 통과했고, 실제로 클릭하거나 저장할 때만 404가 났습니다. 링크는 눌러야 드러나므로 정적으로
// 훑는 검사가 필요합니다.
//
// 검사 대상은 "슬래시로 시작하는 문자열 리터럴" 중 내부 경로처럼 보이는 것입니다. 템플릿
// 리터럴의 `${...}` 자리는 아무 값이나 올 수 있다고 보고 동적 세그먼트로 취급합니다.

import { readdirSync, readFileSync, statSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { activeTopSection, navSectionsFor, topSectionsFor } from "@/lib/routes";

const ROOT = process.cwd();
const APP = path.join(ROOT, "app");

// 경로처럼 보이지만 라우트가 아닌 것들. 정적 자산과 외부 서비스 경로입니다.
const IGNORED_PREFIXES = [
  "/_next", "/favicon", "/icon", "/apple-icon", "/manifest", "/logo", "/robots", "/sitemap",
  "/uploads", "/fonts", "/images", "/socket.io", "/watch", "/rhwp", "/pdfjs",
  // 문서 변환 샌드박스 내부 경로입니다. 브라우저 URL이 아닙니다.
  "/run/user", "/work", "/org.openoffice",
];

// 경로 목록이나 접두사를 선언하는 파일들. 여기의 문자열은 "이 접두사로 시작하면"이라는 뜻이지
// 그 자체로 열리는 주소가 아닙니다.
const IGNORED_FILES = [
  "lib/routes.ts",            // 매니페스트와 play 접두사 목록
  "lib/realtime/namespaces.ts", // Socket.IO namespace
  "app/robots.ts",            // 색인 제외 접두사
  "scripts/verify-routes.ts",
];

// 실제 URL이 아니라 기존 URL 뒤에 붙이는 접미 경로입니다. 알 수 없는 첫 세그먼트를 전부
// 접미사로 간주하면 `/students/...` 같은 죽은 링크도 통과하므로, 접미사는 좁은 허용 목록으로만
// 관리합니다.
const RELATIVE_PATH_FRAGMENTS = new Set(["/present", "/print", "/opengraph-image", "/access-requests"]);

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".next-") || entry === "generated") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

/** app/ 아래 page.tsx·route.ts에서 실제 URL 패턴을 만듭니다. 라우트 그룹 `(x)`는 URL에서 빠집니다. */
function collectRoutes() {
  const pages: string[] = [];
  const apis: string[] = [];
  for (const file of walk(APP, (p) => /\/(page\.tsx|route\.ts)$/.test(p))) {
    const rel = path.relative(APP, file).replace(/\/(page\.tsx|route\.ts)$/, "");
    const url = "/" + rel.split("/").filter((seg) => !/^\(.*\)$/.test(seg)).join("/");
    const normalized = (url === "/" ? "/" : url.replace(/\/$/, "")) || "/";
    (normalized.startsWith("/api") ? apis : pages).push(normalized);
  }
  return { pages: [...new Set(pages)], apis: [...new Set(apis)] };
}

/** `/quiz/[quizId]/edit` 같은 패턴을 정규식으로. 동적 세그먼트는 한 조각을 받습니다. */
function toMatcher(route: string) {
  const source = route
    .split("/")
    .map((seg) => {
      if (/^\[\.\.\..+\]$/.test(seg)) return "(?:[^/]+/?)*";      // catch-all
      if (/^\[.+\]$/.test(seg)) return "[^/]+";                    // 동적 세그먼트
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${source}$`);
}

function main() {
  const teacher = { role: "TEACHER" as const, systemPermissions: [] };
  assert.equal(activeTopSection("/dashboard"), "dashboard");
  assert.equal(activeTopSection("/courses"), "dashboard");
  assert.equal(activeTopSection("/courses/example"), "dashboard");
  assert.equal(topSectionsFor(teacher).map((section) => String(section.key)).includes("course"), false);
  assert.deepEqual(
    navSectionsFor(teacher, "dashboard").flatMap((section) => section.items.map((item) => item.def.id)),
    ["dashboard", "courseList"],
  );
  assert.deepEqual(
    navSectionsFor(teacher, "quiz").flatMap((section) => section.items.map((item) => item.def.id)),
    ["quizList", "quizViewFavorites", "quizActivities", "quizDiscover"],
  );
  assert.deepEqual(
    navSectionsFor({ role: "STUDENT", systemPermissions: [] }, "quiz").flatMap((section) => section.items.map((item) => item.def.id)),
    ["quizList", "quizViewFavorites", "quizAssignments"],
  );
  assert.deepEqual(
    navSectionsFor(teacher, "form").flatMap((section) => section.items.map((item) => item.def.id)),
    ["formList"],
  );

  const { pages, apis } = collectRoutes();
  const pageMatchers = pages.map(toMatcher);
  const apiMatchers = apis.map(toMatcher);

  const sources = walk(ROOT, (p) =>
    /\.(ts|tsx)$/.test(p)
    && !IGNORED_FILES.some((f) => p.endsWith(f))
    && (p.includes("/app/") || p.includes("/components/") || p.includes("/lib/") || p.includes("/utils/")));

  const problems: { file: string; line: number; literal: string }[] = [];

  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((lineText, index) => {
      // 주석 줄은 건너뜁니다 — 설명에 옛 경로가 남는 건 링크가 아닙니다.
      if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) return;
      // 따옴표·백틱으로 감싼 슬래시 시작 문자열
      for (const match of lineText.matchAll(/["'`](\/[A-Za-z0-9_\-/[\]${}.]*)(?:[?#][^"'`]*)?["'`]/g)) {
        const literal = match[1];
        if (literal === "/" || IGNORED_PREFIXES.some((p) => literal.startsWith(p))) continue;
        // 템플릿 보간은 어떤 값이든 올 수 있으므로 동적 세그먼트로 봅니다.
        const probe = literal.replace(/\$\{[^}]*\}/g, "__dyn__");
        if (probe.includes("__dyn__") && probe.split("/").some((s) => s.includes("__dyn__") && s !== "__dyn__")) {
          // `/b/${slug}-suffix` 처럼 세그먼트 일부만 동적인 경우는 판정하지 않습니다.
          continue;
        }
        const candidate = probe.replace(/__dyn__/g, "x").replace(/\/$/, "") || "/";
        if (RELATIVE_PATH_FRAGMENTS.has(candidate)) continue;
        // 첫 세그먼트가 동적이면(`/${section}/...`, `/api/${kind}/...`) 무엇이든 될 수 있어
        // 정적으로 판정할 수 없습니다.
        const segs = probe.split("/");
        if (segs[1] === "__dyn__" || (segs[1] === "api" && segs[2] === "__dyn__")) continue;
        const matchers = candidate.startsWith("/api") ? apiMatchers : pageMatchers;
        if (!matchers.some((m) => m.test(candidate))) {
          problems.push({ file: path.relative(ROOT, file), line: index + 1, literal });
        }
      }
    });
  }

  console.log(`라우트: 페이지 ${pages.length}개 · API ${apis.length}개`);
  console.log("대시보드·교과목 및 퀴즈·설문 사이드바 계층이 일치합니다.");
  if (!problems.length) {
    console.log("모든 내부 경로 리터럴이 실제 라우트와 일치합니다.");
    return;
  }
  console.log(`\n실제 라우트와 맞지 않는 경로 ${problems.length}건:`);
  for (const p of problems) console.log(`  ${p.file}:${p.line}  ${p.literal}`);
  process.exitCode = 1;
}

main();
