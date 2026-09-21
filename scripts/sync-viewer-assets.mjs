import { createRequire } from "node:module";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 문서 뷰어가 실행 중에 따로 읽어 가는 자산을 `public/`으로 복사합니다.
 *  - pdf.js: 워커 + cmaps + 표준 폰트 + 디코더 WASM → `public/pdfjs/`
 *  - rhwp(한글 문서): WASM 하나 → `public/rhwp/`
 *
 * 번들러에 맡기지 않고 정적 파일로 두는 이유가 둘 있습니다.
 *  ① CSP가 `default-src 'self'`라서 워커·WASM·폰트가 모두 **같은 출처**여야 합니다.
 *  ② 워커 로딩 방식이 Turbopack과 webpack에서 다릅니다. `/pdfjs/...` 고정 경로를 쓰면
 *     둘 다에서 똑같이 동작하고, 번들러를 바꿔도 깨지지 않습니다.
 *
 * 합쳐서 12MB가 넘어 저장소에 커밋하지 않고(.gitignore) 설치·빌드 때 복사합니다. 복사본에는
 * 버전을 적어 두고 같은 버전이면 건너뜁니다 — 패키지를 올렸을 때 옛 자산이 남아 조용히
 * 어긋나는 일을 막습니다.
 */

const require = createRequire(import.meta.url);

/** 대상 폴더가 이미 같은 버전이면 건너뜁니다. 아니면 비우고 새로 만듭니다. */
async function prepare(packageName, folder) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const { version } = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const target = path.join(process.cwd(), "public", folder);
  const stampPath = path.join(target, "VERSION");
  const current = await readFile(stampPath, "utf8").catch(() => null);
  if (current?.trim() === version) return null;
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  return { source: path.dirname(packageJsonPath), target, stampPath, version };
}

const pdfjs = await prepare("pdfjs-dist", "pdfjs");
if (pdfjs) {
  const { source, target, stampPath, version } = pdfjs;

  // 워커: 필수. 파싱·렌더링이 전부 여기서 돕니다.
  await cp(path.join(source, "build/pdf.worker.min.mjs"), path.join(target, "pdf.worker.min.mjs"));
  // cmaps: 폰트를 품지 않은 CJK PDF의 글자를 찾는 표입니다. 한국어 문서에는 사실상 필수입니다.
  await cp(path.join(source, "cmaps"), path.join(target, "cmaps"), { recursive: true });
  // standard_fonts: PDF가 표준 14종 폰트를 품지 않고 참조만 할 때 씁니다.
  await cp(path.join(source, "standard_fonts"), path.join(target, "standard_fonts"), { recursive: true });
  // wasm: JBIG2·JPEG2000·색 프로파일 디코더. 스캔한 공문서가 이 형식을 자주 씁니다.
  await cp(path.join(source, "wasm"), path.join(target, "wasm"), { recursive: true });
  await writeFile(stampPath, `${version}\n`, "utf8");
  console.log(`pdf.js 자산 ${version} → public/pdfjs/`);
}

const rhwp = await prepare("@rhwp/core", "rhwp");
if (rhwp) {
  const { source, target, stampPath, version } = rhwp;
  // 한글(HWP·HWPX) 파서·렌더러 본체. 6.9MB라 화면에서는 반드시 지연 로딩합니다.
  await cp(path.join(source, "rhwp_bg.wasm"), path.join(target, "rhwp_bg.wasm"));
  await writeFile(stampPath, `${version}\n`, "utf8");
  console.log(`rhwp 자산 ${version} → public/rhwp/`);
}
