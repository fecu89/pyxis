import { readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_DIRS = new Set([".next-prod", ".next-a", ".next-b"]);

function inspectProcess(pid) {
  try {
    return {
      cwd: readlinkSync(`/proc/${pid}/cwd`),
      args: readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0"),
      env: Object.fromEntries(readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean).map((entry) => {
        const split = entry.indexOf("=");
        return [entry.slice(0, split), entry.slice(split + 1)];
      })),
      children: readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number),
    };
  } catch {
    return null;
  }
}

// yarn의 PM2 환경에는 start 스크립트가 설정한 NEXT_DIST_DIR가 없을 수 있습니다.
// 실제 server.ts 프로세스까지 확인하고, 활성 빌드를 확인할 수 없으면 추측하지 않습니다.
export function resolveDeployment(apps, name, root, inspect = inspectProcess) {
  const matches = apps.filter((app) => app.name === name);
  if (matches.length !== 1) throw new Error(`Expected exactly one PM2 app named '${name}'.`);
  const app = matches[0];
  if (app.pm2_env.status !== "online" || !app.pid) throw new Error(`PM2 app '${name}' is not online.`);
  if (path.resolve(app.pm2_env.pm_cwd) !== root) throw new Error(`PM2 app '${name}' belongs to another project.`);
  const releases = new Set();
  const visited = new Set();
  function visit(pid) {
    if (visited.has(pid)) return;
    visited.add(pid);
    const process = inspect(pid);
    if (!process) return;
    if (process.cwd === root && process.args.some((arg) => arg === "server.ts" || arg === path.join(root, "server.ts"))) {
      if (process.env.NODE_ENV !== "production") throw new Error("Refusing to deploy over a development server.");
      if (!RELEASE_DIRS.has(process.env.NEXT_DIST_DIR)) throw new Error("Unknown active NEXT_DIST_DIR; refusing to overwrite a build.");
      releases.add(process.env.NEXT_DIST_DIR);
    }
    process.children.forEach(visit);
  }
  visit(app.pid);
  if (releases.size !== 1) throw new Error("Cannot uniquely identify the serving build from the PM2 process tree.");
  const [current] = releases;
  return { current, target: current === ".next-a" ? ".next-b" : ".next-a" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const state = resolveDeployment(JSON.parse(readFileSync(0, "utf8")), process.argv[2], process.cwd());
    console.log(state.current);
    console.log(state.target);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
