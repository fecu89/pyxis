import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // 이 프로젝트는 개발(.next)과 빌드(.next-prod) 산출물을 분리합니다(structure.md 1장).
    // 기본 무시 목록은 `.next`만 알아서, 한 번이라도 빌드하면 lint가 생성 코드 3,700여 개를
    // 함께 검사해 실제 오류가 경고 3만 건에 묻혔습니다. dist 접두사 전체를 무시합니다.
    ".next-*/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 문서 뷰어가 실행 중에 읽는 벤더 자산(pdf.js 워커, rhwp WASM 글루). node_modules에서
    // 그대로 복사한 minified 코드라 우리가 고칠 것이 없는데, 검사하면 한 줄이 60만 칼럼이라
    // 오류 수천 건으로 실제 문제를 덮습니다(.next-* 때와 같은 종류).
    "public/pdfjs/**",
    "public/rhwp/**",
  ]),
]);

export default eslintConfig;
