import "server-only";

import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, open, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { cpus, homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveStoredFile } from "@/lib/files/paths";

/**
 * 오피스 문서(pptx/docx/xlsx)를 PDF로 바꿉니다.
 *
 * 기본 실행 경계는 rootless Podman입니다. 신뢰할 수 없는 문서를 여는 LibreOffice에는 앱 소스,
 * 업로드 루트, 네트워크, DB 비밀값이 보이지 않고 변환 한 건의 작업 폴더만 보입니다. 호스트에서
 * 직접 실행하는 native 모드는 개발용 호환 경로이며 명시적으로 설정해야만 켜집니다.
 */

const run = promisify(execFile);

const CONVERTIBLE = new Set([".pptx", ".docx", ".xlsx"]);
const TIMEOUT_MS = 90_000;
const MAX_INPUT_BYTES = 60 * 1024 * 1024;
const DEFAULT_IMAGE = "localhost/pyxis-document-converter:latest";
const FAILURE_CACHE_MS = 15 * 60_000;
const MAX_RECENT_FAILURES = 512;
const PREVIEW_TOUCH_INTERVAL_MS = 24 * 60 * 60_000;

type ConvertPriority = "foreground" | "background";
type Converter =
  | { kind: "podman"; binary: string; image: string }
  | { kind: "native"; binary: string };

function concurrency() {
  const configured = Number(process.env.DOCUMENT_CONVERT_CONCURRENCY ?? "");
  if (Number.isFinite(configured) && configured >= 1) return Math.min(8, Math.floor(configured));
  return Math.min(2, Math.max(1, cpus().length - 1));
}

function maxWaiting() {
  const configured = Number(process.env.DOCUMENT_CONVERT_MAX_QUEUE ?? "");
  if (Number.isFinite(configured) && configured >= 1) return Math.min(512, Math.floor(configured));
  return 64;
}

function maxBackgroundWaiting() {
  const configured = Number(process.env.DOCUMENT_CONVERT_MAX_WARMUP_QUEUE ?? "");
  if (Number.isFinite(configured) && configured >= 0) return Math.min(64, Math.floor(configured));
  return 8;
}

function maxOutputBytes() {
  const configured = Number(process.env.DOCUMENT_CONVERT_MAX_OUTPUT_MB ?? "256");
  const megabytes = Number.isFinite(configured) ? Math.min(512, Math.max(16, Math.floor(configured))) : 256;
  return megabytes * 1024 * 1024;
}

let active = 0;
const foregroundWaiting: Array<() => void> = [];
const backgroundWaiting: Array<() => void> = [];

export class DocumentConvertBusyError extends Error {
  readonly status = 503;

  constructor() {
    super("문서 변환 요청이 몰려 있습니다. 잠시 후 다시 열어 주세요.");
    this.name = "DocumentConvertBusyError";
  }
}

export class DocumentConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentConvertError";
  }
}

const inFlight = new Map<string, Promise<string>>();
const recentFailures = new Map<string, { until: number; message: string }>();

function rememberFailure(storagePath: string, message: string) {
  const now = Date.now();
  for (const [key, failure] of recentFailures) {
    if (failure.until <= now) recentFailures.delete(key);
  }
  while (recentFailures.size >= MAX_RECENT_FAILURES) {
    const oldest = recentFailures.keys().next().value as string | undefined;
    if (!oldest) break;
    recentFailures.delete(oldest);
  }
  recentFailures.set(storagePath, { until: now + FAILURE_CACHE_MS, message });
}

export function isConvertibleDocument(originalName: string) {
  return CONVERTIBLE.has(path.extname(originalName).toLowerCase());
}

function commandEnvironment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: homedir(),
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NODE_ENV: process.env.NODE_ENV,
    ...overrides,
  };
}

let converterPromise: Promise<Converter | null> | null = null;

async function findConverter(): Promise<Converter | null> {
  converterPromise ??= (async () => {
    const mode = (process.env.DOCUMENT_CONVERTER_MODE ?? "podman").trim().toLowerCase();
    if (mode === "disabled") return null;

    if (mode === "podman") {
      const binary = process.env.PODMAN_PATH?.trim() || "podman";
      const image = process.env.DOCUMENT_CONVERTER_IMAGE?.trim() || DEFAULT_IMAGE;
      try {
        await run(binary, ["image", "exists", image], {
          timeout: 15_000,
          env: commandEnvironment(),
        });
        return { kind: "podman", binary, image };
      } catch {
        return null;
      }
    }

    if (mode === "native") {
      const configured = process.env.SOFFICE_PATH?.trim();
      const candidates = configured ? [configured] : ["soffice", "libreoffice"];
      for (const binary of candidates) {
        try {
          await run(binary, ["--version"], {
            timeout: 15_000,
            env: commandEnvironment(),
          });
          return { kind: "native", binary };
        } catch {
          continue;
        }
      }
    }

    return null;
  })();
  return converterPromise;
}

export async function canConvertDocuments() {
  return (await findConverter()) !== null;
}

async function acquireSlot(priority: ConvertPriority) {
  if (active < concurrency()) {
    active += 1;
    return;
  }

  const waitingCount = foregroundWaiting.length + backgroundWaiting.length;
  if (waitingCount >= maxWaiting()) throw new DocumentConvertBusyError();
  if (priority === "background" && backgroundWaiting.length >= maxBackgroundWaiting()) {
    throw new DocumentConvertBusyError();
  }

  await new Promise<void>((resolve) => {
    (priority === "foreground" ? foregroundWaiting : backgroundWaiting).push(resolve);
  });
}

function releaseSlot() {
  active = Math.max(0, active - 1);
  const next = foregroundWaiting.shift() ?? backgroundWaiting.shift();
  if (next) {
    // 다음 작업에 슬롯을 먼저 예약해야 새 요청이 사이에 끼어 동시성 상한을 넘지 않습니다.
    active += 1;
    next();
  }
}

export function convertQueueState() {
  return {
    active,
    waiting: foregroundWaiting.length + backgroundWaiting.length,
    foregroundWaiting: foregroundWaiting.length,
    backgroundWaiting: backgroundWaiting.length,
    concurrency: concurrency(),
    maxWaiting: maxWaiting(),
  };
}

export function previewPathFor(storagePath: string) {
  return `${storagePath}.preview.pdf`;
}

export async function findExistingPreview(storagePath: string) {
  const absolute = resolveStoredFile(previewPathFor(storagePath));
  try {
    const info = await stat(/* turbopackIgnore: true */ absolute);
    if (!info.isFile() || info.size <= 0) return null;
    if (Date.now() - info.mtimeMs >= PREVIEW_TOUCH_INTERVAL_MS) {
      const now = new Date();
      await utimes(/* turbopackIgnore: true */ absolute, now, now).catch(() => undefined);
    }
    return absolute;
  } catch {
    return null;
  }
}

export async function ensurePdfPreview(
  storagePath: string,
  originalName: string,
  options: { priority?: ConvertPriority } = {},
): Promise<string> {
  const existing = await findExistingPreview(storagePath);
  if (existing) return existing;

  const failure = recentFailures.get(storagePath);
  if (failure && failure.until > Date.now()) throw new DocumentConvertError(failure.message);
  if (failure) recentFailures.delete(storagePath);

  const pending = inFlight.get(storagePath);
  if (pending) return pending;
  // acquireSlot까지는 파일 stat·변환기 확인 같은 비동기 단계가 있어, 폭주 시 모든 요청이 그 앞에
  // Promise로 쌓일 수 있습니다. 큐 진입 전에도 전체 고유 작업 수를 같은 상한으로 막습니다.
  if (inFlight.size >= concurrency() + maxWaiting()) throw new DocumentConvertBusyError();

  const job = convert(storagePath, originalName, options.priority ?? "foreground")
    .then((result) => {
      recentFailures.delete(storagePath);
      return result;
    })
    .catch((reason: unknown) => {
      if (reason instanceof DocumentConvertError) {
        rememberFailure(storagePath, reason.message);
      }
      throw reason;
    })
    .finally(() => inFlight.delete(storagePath));
  inFlight.set(storagePath, job);
  return job;
}

async function convert(storagePath: string, originalName: string, priority: ConvertPriority): Promise<string> {
  if (!isConvertibleDocument(originalName)) {
    throw new DocumentConvertError("미리보기를 만들 수 없는 형식입니다.");
  }
  const converter = await findConverter();
  if (!converter) throw new DocumentConvertError("이 서버에는 격리된 문서 변환기가 준비되어 있지 않습니다.");

  const source = resolveStoredFile(storagePath);
  const info = await stat(/* turbopackIgnore: true */ source);
  if (!info.isFile() || info.size <= 0 || info.size > MAX_INPUT_BYTES) {
    throw new DocumentConvertError("파일이 너무 크거나 올바른 문서 파일이 아닙니다.");
  }

  await acquireSlot(priority);
  let workspace: string | null = null;
  try {
    workspace = await mkdtemp(path.join(/* turbopackIgnore: true */ tmpdir(), "pyxis-convert-"));
    const profile = path.join(/* turbopackIgnore: true */ workspace, "profile");
    await writeConverterProfile(profile);

    // Next 프로세스는 OOXML을 열지 않습니다. 압축 해제와 파싱은 자원 제한이 걸린 컨테이너만 합니다.
    const extension = path.extname(originalName).toLowerCase();
    const input = path.join(/* turbopackIgnore: true */ workspace, `input${extension}`);
    await copyFile(/* turbopackIgnore: true */ source, input);

    if (converter.kind === "podman") {
      await runPodmanConversion(converter, workspace, extension);
    } else {
      await runNativeConversion(converter, workspace, input, profile);
    }

    const produced = path.join(/* turbopackIgnore: true */ workspace, "input.pdf");
    await assertSafePdfArtifact(produced);

    const target = resolveStoredFile(previewPathFor(storagePath));
    await rename(/* turbopackIgnore: true */ produced, target);
    return target;
  } catch (reason) {
    if (reason instanceof DocumentConvertError || reason instanceof DocumentConvertBusyError) throw reason;
    const timedOut = reason instanceof Error && (
      ("killed" in reason && reason.killed === true)
      || ("signal" in reason && reason.signal === "SIGTERM")
    );
    throw new DocumentConvertError(timedOut ? "변환이 시간을 초과했습니다." : "문서를 PDF로 바꾸지 못했습니다.");
  } finally {
    releaseSlot();
    if (workspace) await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runPodmanConversion(converter: Extract<Converter, { kind: "podman" }>, workspace: string, extension: string) {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
  const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
  const mount = `type=bind,source=${workspace},destination=/work,rw`;
  const tmpfs = "/tmp:rw,noexec,nosuid,nodev,size=256m";

  await run(converter.binary, [
    "run",
    "--rm",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--cap-drop=all",
    "--security-opt=no-new-privileges",
    "--pids-limit=256",
    "--memory=768m",
    "--memory-swap=768m",
    "--cpus=1.5",
    `--timeout=${Math.ceil(TIMEOUT_MS / 1000)}`,
    "--userns=keep-id",
    `--user=${uid}:${gid}`,
    `--tmpfs=${tmpfs}`,
    `--mount=${mount}`,
    "--env=HOME=/tmp/home",
    "--env=LANG=C.UTF-8",
    "--env=LC_ALL=C.UTF-8",
    converter.image,
    "--headless",
    "--norestore",
    "--nolockcheck",
    "--nodefault",
    "--nologo",
    "-env:UserInstallation=file:///work/profile",
    "--convert-to",
    "pdf",
    "--outdir",
    "/work",
    `/work/input${extension}`,
  ], {
    timeout: TIMEOUT_MS + 15_000,
    maxBuffer: 8 * 1024 * 1024,
    env: commandEnvironment(),
  });
}

async function runNativeConversion(
  converter: Extract<Converter, { kind: "native" }>,
  workspace: string,
  input: string,
  profile: string,
) {
  await run(converter.binary, [
    "--headless",
    "--norestore",
    "--nolockcheck",
    "--nodefault",
    "--nologo",
    `-env:UserInstallation=file://${profile}`,
    "--convert-to",
    "pdf",
    "--outdir",
    workspace,
    input,
  ], {
    timeout: TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    // native 모드에서도 DB·인증·PII 비밀값은 LibreOffice 프로세스에 전달하지 않습니다.
    env: commandEnvironment({ HOME: workspace, TMPDIR: workspace }),
  });
}

async function assertSafePdfArtifact(filePath: string) {
  const info = await lstat(/* turbopackIgnore: true */ filePath).catch(() => null);
  if (!info?.isFile() || info.size < 5 || info.size > maxOutputBytes()) {
    throw new DocumentConvertError("변환 결과가 올바른 PDF 파일이 아닙니다.");
  }

  const handle = await open(/* turbopackIgnore: true */ filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 5 || header.toString("ascii") !== "%PDF-") {
      throw new DocumentConvertError("변환 결과가 올바른 PDF 파일이 아닙니다.");
    }
  } finally {
    await handle.close();
  }
}

async function writeConverterProfile(profile: string) {
  const userDir = path.join(/* turbopackIgnore: true */ profile, "user");
  await mkdir(userDir, { recursive: true });
  const registry = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetProxyType" oor:op="fuse"><value>1</value></prop></item>
 <item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPProxyName" oor:op="fuse"><value>127.0.0.1</value></prop></item>
 <item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPProxyPort" oor:op="fuse"><value>1</value></prop></item>
 <item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPSProxyName" oor:op="fuse"><value>127.0.0.1</value></prop></item>
 <item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPSProxyPort" oor:op="fuse"><value>1</value></prop></item>
 <item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetFTPProxyName" oor:op="fuse"><value>127.0.0.1</value></prop></item>
 <item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetFTPProxyPort" oor:op="fuse"><value>1</value></prop></item>
 <item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetNoProxy" oor:op="fuse"><value></value></prop></item>
 <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
 <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;
  await writeFile(path.join(/* turbopackIgnore: true */ userDir, "registrymodifications.xcu"), registry, "utf8");
}

export function warmUpPdfPreview(storagePath: string, originalName: string) {
  if (!isConvertibleDocument(originalName)) return;
  void (async () => {
    try {
      if (!(await canConvertDocuments())) return;
      await ensurePdfPreview(storagePath, originalName, { priority: "background" });
    } catch {
      // 미리 만들기는 최선 노력입니다. 실패해도 업로드 응답과 첫 열람은 정상적으로 이어집니다.
    }
  })();
}
