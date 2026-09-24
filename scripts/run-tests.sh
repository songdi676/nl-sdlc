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

resolve() {
  if [ -n "$STUB_DIR" ] && [ -x "$STUB_DIR/$1" ]; then echo "$STUB_DIR/$1"
  else command -v "$1" 2>/dev/null || true; fi
}

API_STATUS=skipped; E2E_STATUS=skipped; API_REPORT=""; E2E_REPORT=""; WARNINGS='[]'
add_warning() { WARNINGS=$(printf '%s' "$WARNINGS" | sed 's/\]$/,{}/' ) ; }

# ---- 接口测试 ----
if [ "$DO_API" -eq 1 ]; then
  NM=$(resolve newman)
  if [ -z "$NM" ]; then
    WARNINGS='["newman 未安装，接口测试跳过（npm i -g newman 安装）"]'
  else
    mkdir -p build/test-results/newman
    API_REPORT="build/test-results/newman/report.xml"
    if ls tests/api/*.postman_collection.json >/dev/null 2>&1; then
      if "$NM" run tests/api/*.postman_collection.json --reporters cli,junit --reporter-junit-export "$API_REPORT" >/dev/null 2>&1; then
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
  PW=$(resolve playwright)
  if [ -z "$PW" ]; then
    [ "$WARNINGS" = '[]' ] && WARNINGS='["playwright 未安装，E2E 跳过（npm i -D @playwright/test）"]' || WARNINGS=$(printf '%s' "$WARNINGS" | sed 's/\]$/, "playwright 未安装，E2E 跳过"]/')
  else
    if ls tests/e2e/*.spec.ts >/dev/null 2>&1; then
      if PLAYWRIGHT_BASE_URL="$BASE_URL" "$PW" test >/dev/null 2>&1; then E2E_STATUS=pass; else E2E_STATUS=fail; fi
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
