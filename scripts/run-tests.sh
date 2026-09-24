#!/bin/bash
# 测试统一入口：Newman 接口测试 + Playwright E2E。CI 与交互式共用。
# 用法: run-tests.sh [--api] [--e2e] [--base-url url] [--stub-dir dir]
set -u

DO_API=0; DO_E2E=0; BASE_URL=""; STUB_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --api) DO_API=1; shift ;;
    --e2e) DO_E2E=1; shift ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --stub-dir) STUB_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ "$DO_API" -eq 0 ] && [ "$DO_E2E" -eq 0 ] && { echo '{"overall":"fail","api":{"status":"skipped"},"e2e":{"status":"skipped"},"warnings":["至少指定 --api 或 --e2e"]}' ; exit 2; }

# 工具检测：--stub-dir 优先 → PATH 全局（command -v）→ npx 本地依赖
# （npx --no-install <tool> --version 返回 0 才算可用；检测输出静默丢弃，不污染 stdout）。
# 结果写入全局变量（不用 $(resolve …) 取结果：命令替换在子 shell 中执行，全局变量会丢失）：
#   RESOLVED=工具路径或工具名（npx 模式）；RESOLVED_MODE=0 直接执行 / 1 经 npx；RESOLVED_NPX=npx 可执行文件
RESOLVED=""; RESOLVED_MODE=0; RESOLVED_NPX=""
resolve() {
  RESOLVED=""; RESOLVED_MODE=0; RESOLVED_NPX=""
  if [ -n "$STUB_DIR" ] && [ -x "$STUB_DIR/$1" ]; then RESOLVED="$STUB_DIR/$1"; return 0; fi
  local p npx_bin=""
  if p=$(command -v "$1" 2>/dev/null); then RESOLVED="$p"; return 0; fi
  if [ -n "$STUB_DIR" ] && [ -x "$STUB_DIR/npx" ]; then npx_bin="$STUB_DIR/npx"
  else npx_bin=$(command -v npx 2>/dev/null) || true; fi
  if [ -n "$npx_bin" ] && "$npx_bin" --no-install "$1" --version >/dev/null 2>&1; then
    RESOLVED="$1"; RESOLVED_MODE=1; RESOLVED_NPX="$npx_bin"; return 0
  fi
  return 1
}

# 按 resolve 结果执行 newman / playwright（npx 模式经 RESOLVED_NPX 调用，摆脱 PATH 依赖）
NM=""; NM_MODE=0; NM_NPX=""; PW=""; PW_MODE=0; PW_NPX=""
run_newman() {
  if [ "$NM_MODE" -eq 1 ]; then "$NM_NPX" --no-install newman "$@"
  else "$NM" "$@"; fi
}
run_playwright() {
  if [ "$PW_MODE" -eq 1 ]; then "$PW_NPX" --no-install playwright "$@"
  else "$PW" "$@"; fi
}

API_STATUS=skipped; E2E_STATUS=skipped; API_REPORT=""; E2E_REPORT=""; WARNINGS='[]'
add_warning() { WARNINGS=$(printf '%s' "$WARNINGS" | sed 's/\]$/,{}/' ) ; }

# ---- 接口测试 ----
if [ "$DO_API" -eq 1 ]; then
  resolve newman
  NM="$RESOLVED"; NM_MODE="$RESOLVED_MODE"; NM_NPX="$RESOLVED_NPX"
  if [ -z "$NM" ]; then
    WARNINGS='["newman 未安装，接口测试跳过（npm i -g newman 或 npm i -D newman 安装）"]'
  else
    mkdir -p build/test-results/newman
    API_REPORT="build/test-results/newman/report.xml"
    if ls tests/api/*.postman_collection.json >/dev/null 2>&1; then
      if run_newman run tests/api/*.postman_collection.json --reporters cli,junit --reporter-junit-export "$API_REPORT" >/dev/null 2>&1; then
        API_STATUS=pass
      else
        API_STATUS=fail
      fi
    else
      WARNINGS='["tests/api/ 下无 collection 文件，接口测试跳过"]'
    fi
  fi
fi

# ---- E2E ----
if [ "$DO_E2E" -eq 1 ]; then
  resolve playwright
  PW="$RESOLVED"; PW_MODE="$RESOLVED_MODE"; PW_NPX="$RESOLVED_NPX"
  if [ -z "$PW" ]; then
    [ "$WARNINGS" = '[]' ] && WARNINGS='["playwright 未安装，E2E 跳过（npm i -D @playwright/test）"]' || WARNINGS=$(printf '%s' "$WARNINGS" | sed 's/\]$/, "playwright 未安装，E2E 跳过"]/')
  else
    if ls tests/e2e/*.spec.ts >/dev/null 2>&1; then
      if PLAYWRIGHT_BASE_URL="$BASE_URL" run_playwright test >/dev/null 2>&1; then E2E_STATUS=pass; else E2E_STATUS=fail; fi
    else
      [ "$WARNINGS" = '[]' ] && WARNINGS='["tests/e2e/ 下无 spec 文件，E2E 跳过"]' || WARNINGS=$(printf '%s' "$WARNINGS" | sed 's/\]$/, "tests/e2e/ 下无 spec 文件，E2E 跳过"]/')
    fi
  fi
fi

OVERALL=pass
[ "$API_STATUS" = fail ] || [ "$E2E_STATUS" = fail ] && OVERALL=fail

printf '{"overall":"%s","api":{"status":"%s","report":"%s"},"e2e":{"status":"%s","report":"%s"},"warnings":%s}\n' \
  "$OVERALL" "$API_STATUS" "$API_REPORT" "$E2E_STATUS" "$E2E_REPORT" "$WARNINGS"

[ "$OVERALL" = pass ] && exit 0 || exit 1
