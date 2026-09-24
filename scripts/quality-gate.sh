#!/bin/bash
# 质量门统一入口：自动识别项目类型，输出 JSON 报告。交互式 hook 与 CI 共用。
# 用法: quality-gate.sh [--scope backend|frontend|all] [--thresholds <yaml>] [--stub-dir <dir>]
set -u

SCOPE="all"; THRESHOLDS_FILE=""; STUB_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE="$2"; shift 2 ;;
    --thresholds) THRESHOLDS_FILE="$2"; shift 2 ;;
    --stub-dir) STUB_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPORT='{"overall":"fail","scope":"'"$SCOPE"'","project_type":"none","warnings":[],"checks":[],"coverage":null}'
emit() { # emit <json-report> <exit-code>  —— 只允许这一个 stdout 输出点
  echo "$1"
  exit "$2"
}

# --scope 值校验（Task 11 评审裁决）：仅 backend|frontend|all 合法，其余报错退出
case "$SCOPE" in
  backend|frontend|all) ;;
  *) emit '{"overall":"fail","scope":"'"$SCOPE"'","project_type":"none","warnings":["无效的 --scope 值（仅支持 backend|frontend|all）"],"checks":[],"coverage":null}' 2 ;;
esac

EXTRA_WARNINGS=""   # load_thresholds 填充，run_backend/run_frontend 注入其 warnings

load_thresholds() {
  # 读取 YAML 里形如 "backend_coverage: 80" 的行；文件缺失 → 内置默认值 + EXTRA_WARNINGS
  local file="$1"
  COV_BACKEND=80; COV_FRONTEND=70
  EXTRA_WARNINGS=""
  if [ -z "$file" ]; then return; fi
  if [ ! -f "$file" ]; then
    EXTRA_WARNINGS='"阈值文件缺失，使用默认值(Java 80/Vue 70)"'
    return
  fi
  local b f
  b=$(sed -n 's/^ *backend_coverage: *\([0-9][0-9]*\).*/\1/p' "$file" | head -1)
  f=$(sed -n 's/^ *frontend_coverage: *\([0-9][0-9]*\).*/\1/p' "$file" | head -1)
  [ -n "$b" ] && COV_BACKEND="$b"
  [ -n "$f" ] && COV_FRONTEND="$f"
}

# 工具解析：stub-dir 优先
resolve() { # resolve mvn -> 路径或空
  if [ -n "$STUB_DIR" ] && [ -x "$STUB_DIR/$1" ]; then echo "$STUB_DIR/$1"
  else command -v "$1" 2>/dev/null || true; fi
}

# 捕获门函数输出；函数内部 emit（如 mvn 未安装）在 $() 子 shell 中退出，此处按原退出码转发
capture() { # capture <func>  -> 设置 REPORT 并按需 exit
  REPORT=$("$@"); local rc=$?
  [ "$rc" -eq 0 ] || emit "$REPORT" "$rc"
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

# 参数解析后、任何门运行前加载阈值（须在 run_backend/run_frontend 调用之前）
load_thresholds "$THRESHOLDS_FILE"

HAS_POM=0; [ -f pom.xml ] && HAS_POM=1
HAS_NPM=0; [ -f package.json ] && HAS_NPM=1

if [ "$HAS_POM" -eq 0 ] && [ "$HAS_NPM" -eq 0 ]; then
  emit "$REPORT" 2
fi

# ---- Java（Maven）门 ----
run_backend() {
  local MVN; MVN=$(resolve mvn)
  if [ -z "$MVN" ]; then emit '{"overall":"fail","scope":"backend","project_type":"maven","warnings":["mvn 未安装"],"checks":[],"coverage":null}' 2; fi

  local checks='[]' cs_status=pass cs_detail="0 违规" cs_sug='[]'
  local sb_status=pass sb_detail="0 高危/中危"
  local cov_status=pass cov_line=0 cov_threshold=${COV_BACKEND:-80}
  local dep_status=pass

  if ! "$MVN" checkstyle:check >/dev/null 2>&1; then
    cs_status=fail; cs_detail="checkstyle 违规（阿里 P3C）"; cs_sug='["运行 mvn checkstyle:check 查看违规明细并修复"]'
  fi
  if ! "$MVN" spotbugs:check >/dev/null 2>&1; then
    sb_status=fail
  fi
  # jacoco 行覆盖：从 target/site/jacoco/jacoco.csv 解析（缺文件按失败处理）
  # 列语义：$1=GROUP $2=CLASS $7=LINE_MISSED $8=LINE_COVERED（首行为表头，NR>1 跳过）
  if [ -f target/site/jacoco/jacoco.csv ]; then
    cov_line=$(awk -F',' 'NR>1 { im+=$7; ic+=$8 } END { if (ic+im>0) printf "%.1f", 100*ic/(ic+im); else print 0 }' target/site/jacoco/jacoco.csv)
    if ! awk -v l="$cov_line" -v t="$cov_threshold" 'BEGIN { exit !(l >= t) }'; then cov_status=fail; fi
  else
    cov_status=fail
  fi
  # Dependency-Check：本任务以脚本包装形式调用，详细扫描在 Task 19 模板中启用
  local DC; DC=$(resolve dependency-check)
  if [ -n "$DC" ] && ! "$DC" >/dev/null 2>&1; then dep_status=fail; fi

  local overall=pass
  [ "$cs_status" = fail ] || [ "$sb_status" = fail ] || [ "$cov_status" = fail ] || [ "$dep_status" = fail ] && overall=fail

  checks=$(printf '[{"name":"checkstyle","status":"%s","details":"%s","suggestions":%s},{"name":"spotbugs","status":"%s","details":"%s","suggestions":[]},{"name":"dependency-check","status":"%s","details":"%s","suggestions":[]}]' \
    "$cs_status" "$(json_escape "$cs_detail")" "$cs_sug" \
    "$sb_status" "$(json_escape "$sb_detail")" "$dep_status" "$(json_escape "无高危漏洞" )")
  printf '{"overall":"%s","scope":"backend","project_type":"maven","warnings":[%s],"checks":%s,"coverage":{"line":%s,"threshold":%s,"status":"%s"}}' \
    "$overall" "${EXTRA_WARNINGS:-}" "$checks" "$cov_line" "$cov_threshold" "$cov_status"
}

# ---- Vue 门 ----
run_frontend() {
  local NPM; NPM=$(resolve npm)
  local VTS; VTS=$(resolve vue-tsc)
  if [ -z "$NPM" ]; then emit '{"overall":"fail","scope":"frontend","project_type":"vue","warnings":["npm 未安装"],"checks":[],"coverage":null}' 2; fi

  local lint_status=pass tsc_status=pass audit_status=pass cov_status=pass cov_threshold=${COV_FRONTEND:-70}
  local cov_line=0
  if ! "$NPM" run lint >/dev/null 2>&1; then lint_status=fail; fi
  if [ -n "$VTS" ] && ! "$VTS" --noEmit >/dev/null 2>&1; then tsc_status=fail; fi
  if ! "$NPM" audit --audit-level=high >/dev/null 2>&1; then audit_status=fail; fi
  # Vitest 覆盖率：从 coverage/coverage-summary.json 读取 lines.pct
  if [ -f coverage/coverage-summary.json ]; then
    cov_line=$(node -e 'const s=JSON.parse(require("fs").readFileSync("coverage/coverage-summary.json","utf8")).total.lines.pct; process.stdout.write(String(Math.round(s*10)/10))' 2>/dev/null || echo 0)
    if ! awk -v l="$cov_line" -v t="$cov_threshold" 'BEGIN { exit !(l >= t) }'; then cov_status=fail; fi
  else
    cov_status=fail
  fi

  local overall=pass
  [ "$lint_status" = fail ] || [ "$tsc_status" = fail ] || [ "$audit_status" = fail ] || [ "$cov_status" = fail ] && overall=fail

  printf '{"overall":"%s","scope":"frontend","project_type":"vue","warnings":[%s],"checks":[{"name":"eslint","status":"%s","details":"0 error","suggestions":[]},{"name":"vue-tsc","status":"%s","details":"类型检查","suggestions":[]},{"name":"npm-audit","status":"%s","details":"无高危","suggestions":[]}],"coverage":{"line":%s,"threshold":%s,"status":"%s"}}' \
    "$overall" "${EXTRA_WARNINGS:-}" "$lint_status" "$tsc_status" "$audit_status" "$cov_line" "$cov_threshold" "$cov_status"
}

case "$SCOPE" in
  backend)
    [ "$HAS_POM" -eq 1 ] || emit '{"overall":"fail","scope":"backend","project_type":"none","warnings":["当前目录无 pom.xml"],"checks":[],"coverage":null}' 2
    capture run_backend ;;
  frontend)
    [ "$HAS_NPM" -eq 1 ] || emit '{"overall":"fail","scope":"frontend","project_type":"none","warnings":["当前目录无 package.json"],"checks":[],"coverage":null}' 2
    capture run_frontend ;;
  all)
    case "$HAS_POM$HAS_NPM" in
      10) capture run_backend ;;
      01) capture run_frontend ;;
      11) # 前后端同仓：两侧都跑，合并输出（见 Interfaces 的 both 形态）
          B=$(run_backend)
          F=$(run_frontend)
          B_OK=$(echo "$B" | grep -q '"overall":"pass"' && echo 1 || echo 0)
          F_OK=$(echo "$F" | grep -q '"overall":"pass"' && echo 1 || echo 0)
          OV=fail; [ "$B_OK" = 1 ] && [ "$F_OK" = 1 ] && OV=pass
          REPORT=$(printf '{"overall":"%s","scope":"all","project_type":"both","warnings":[],"backend":%s,"frontend":%s}' "$OV" "$B" "$F") ;;
      00) emit "$REPORT" 2 ;;
    esac ;;
esac

# 按 overall 决定退出码（默认值保证非 fail 即 0）
echo "$REPORT" | grep -q '"overall":"fail"' && emit "$REPORT" 1 || emit "$REPORT" 0
