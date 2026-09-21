#!/usr/bin/env bash
# Blog와 같은 별도 distDir 빌드 → PM2 전환. 전환 때는 짧은 재시작이 발생합니다.
set -euo pipefail
cd "$(dirname "$0")/.."

deploy_app="${PM2_APP:-pyxis}"
deploy_port="${PORT:-3001}"
deploy_timeout="${DEPLOY_HEALTH_TIMEOUT:-30}"
[[ "$deploy_port" =~ ^[0-9]+$ && "$deploy_timeout" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid port or health timeout." >&2; exit 1; }

# 이 파일은 삭제하지 않습니다. 잠긴 inode를 바꾸면 동시 배포가 통과할 수 있습니다.
exec 9>.deploy.lock
flock -n 9 || { echo "Another Pyxis deployment is running." >&2; exit 1; }

deploy_state="$(pm2 jlist 9>&- | node scripts/deploy-state.mjs "$deploy_app")"
mapfile -t deploy_dirs <<< "$deploy_state"
current="${deploy_dirs[0]}"
target="${deploy_dirs[1]}"
[[ ! -L "$current" && ! -L "$target" && -s "$current/BUILD_ID" ]] || { echo "Invalid release directory." >&2; exit 1; }
current_build="$(<"$current/BUILD_ID")"
deploy_url="http://127.0.0.1:$deploy_port"

healthy() {
  local build_id="$1"
  [[ "$build_id" =~ ^[A-Za-z0-9_-]+$ ]] || return 1
  # 새 빌드 고유 URL도 확인해야 이전 서버/다른 포트의 200을 성공으로 오인하지 않습니다.
  [[ "$(curl -fsS --max-time 3 -w '%{http_code}' -o /dev/null "$deploy_url/_next/static/$build_id/_buildManifest.js" 2>/dev/null)" == 200 ]] \
    && [[ "$(curl -fsS --max-time 3 -w '%{http_code}' -o /dev/null "$deploy_url/" 2>/dev/null)" == 200 ]]
}

wait_healthy() {
  local build_id="$1" deadline=$((SECONDS + deploy_timeout))
  while (( SECONDS < deadline )); do
    if healthy "$build_id"; then return 0; fi
    sleep 1
  done
  return 1
}

healthy "$current_build" || { echo "Current build is not healthy on port $deploy_port; no changes made." >&2; exit 1; }

deploy_backup="$(mktemp -d "${TMPDIR:-/tmp}/pyxis-deploy.XXXXXX")"
cp tsconfig.json "$deploy_backup/tsconfig.json"
if [[ -f next-env.d.ts ]]; then cp next-env.d.ts "$deploy_backup/next-env.d.ts"; fi
deploy_switch_started=false
deploy_success=false

restore_config() {
  cp "$deploy_backup/tsconfig.json" tsconfig.json
  if [[ -f "$deploy_backup/next-env.d.ts" ]]; then cp "$deploy_backup/next-env.d.ts" next-env.d.ts; fi
}

finish() {
  local status=$?
  trap - EXIT INT TERM
  restore_config || status=1
  if [[ "$deploy_switch_started" == true && "$deploy_success" != true ]]; then
    echo "Deployment failed; restoring $current." >&2
    if NEXT_DIST_DIR="$current" pm2 restart "$deploy_app" --update-env 9>&- && wait_healthy "$current_build"; then
      echo "Previous build restored: $current" >&2
    else
      echo "Rollback needs attention: pm2 logs $deploy_app" >&2
    fi
    status=1
  fi
  echo "Deployment backup: $deploy_backup"
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Build $target while serving $current"
if [[ -e "$target" ]]; then mv -- "$target" "$deploy_backup/previous-dist"; fi
# Next가 생성하는 타입은 이번 빌드 하나만 검사합니다. 지운 라우트가 이전 distDir의
# validator.ts에 남아 있더라도 다음 배포를 막지 않게 하고, 종료 시 원본 설정을 복원합니다.
node --input-type=module - "$target" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const target = process.argv[2];
const config = JSON.parse(readFileSync("tsconfig.json", "utf8"));
config.include = (config.include ?? []).filter((entry) => !/^\.next(?:-[^/]+)?\//.test(entry));
config.include.push(`${target}/types/**/*.ts`, `${target}/dev/types/**/*.ts`);
writeFileSync("tsconfig.json", `${JSON.stringify(config, null, 2)}\n`);
NODE
NEXT_DIST_DIR="$target" yarn build
restore_config
[[ -s "$target/BUILD_ID" ]] || { echo "Build did not produce $target/BUILD_ID." >&2; exit 1; }
target_build="$(<"$target/BUILD_ID")"
[[ -s "$target/static/$target_build/_buildManifest.js" ]] || { echo "Build manifest is missing." >&2; exit 1; }

# 빌드 중 외부에서 앱을 전환했다면 활성 산출물을 잘못 판단한 상태이므로 중단합니다.
[[ "$(pm2 jlist 9>&- | node scripts/deploy-state.mjs "$deploy_app")" == "$deploy_state" ]] \
  || { echo "Serving build changed during deployment; refusing to switch." >&2; exit 1; }
echo "Switch $deploy_app to $target"
deploy_switch_started=true
# PM2 데몬/앱이 lock FD를 물려받아 다음 배포를 영구 차단하지 않도록 닫습니다.
NEXT_DIST_DIR="$target" pm2 restart "$deploy_app" --update-env 9>&-
wait_healthy "$target_build" || { echo "New build did not become healthy." >&2; exit 1; }
running_state="$(pm2 jlist 9>&- | node scripts/deploy-state.mjs "$deploy_app")"
[[ "${running_state%%$'\n'*}" == "$target" ]] || { echo "Server ignored NEXT_DIST_DIR." >&2; exit 1; }
deploy_success=true
pm2 save 9>&-
echo "Deployed $target (build $target_build); previous build remains at $current."
