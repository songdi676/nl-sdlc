#!/bin/bash
# quality-gate.sh 的 TDD 测试：验证退出码契约（0=pass 1=fail 2=环境/配置错误）与 JSON schema
set -u
cd "$(dirname "$0")/.."
QG="$(pwd)/scripts/quality-gate.sh"
PASS=0; FAIL=0

check() { # $1=描述 $2=期望(0/1/2) $3=stub 目录 $4=fixture 目录 $5...=参数（在 fixture 目录内运行）
  local desc="$1" want="$2" stub="$3" dir="$4"; shift 4
  local out
  out=$(cd "$dir" && bash "$QG" --stub-dir "$stub" "$@" 2>/dev/null)
  local got=$?
  if [ "$got" -eq "$want" ]; then PASS=$((PASS+1)); echo "ok - $desc"
  else FAIL=$((FAIL+1)); echo "FAIL - $desc (want exit $want, got $got; out: $out)"; fi
}

# stub: 全部工具成功
S_ALL=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_ALL/mvn"
printf '#!/bin/bash\necho "{}"\n' > "$S_ALL/dependency-check"
chmod +x "$S_ALL/mvn" "$S_ALL/dependency-check"

# stub: checkstyle 失败
S_CS=$(mktemp -d)
printf '#!/bin/bash\nif [ "$1" = "checkstyle:check" ]; then echo "checkstyle violation" >&2; exit 1; fi\nexit 0\n' > "$S_CS/mvn"
chmod +x "$S_CS/mvn"

# stub: 空（无任何工具）
S_EMPTY=$(mktemp -d)

# fixture 目录
mkdir -p target-stub-projects/backend/target/site/jacoco
touch target-stub-projects/backend/pom.xml
printf 'GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_MISSED,LINE_MISSED,LINE_COVERED\na,Example,0,0,0,0,20,80\n' > target-stub-projects/backend/target/site/jacoco/jacoco.csv
mkdir -p target-stub-projects/not-a-project

# 测试 1：Maven 项目全工具通过 → exit 0 且 JSON overall=pass
out=$(cd target-stub-projects/backend && bash "$QG" --stub-dir "$S_ALL" --scope backend 2>/dev/null)
if [ $? -eq 0 ] && echo "$out" | grep -q '"overall": *"pass"'; then PASS=$((PASS+1)); echo "ok - maven 全绿"
else FAIL=$((FAIL+1)); echo "FAIL - maven 全绿 (want exit 0 + overall=pass; out: $out)"; fi

# 测试 2：checkstyle 失败 → exit 1 且 JSON overall=fail
out=$(cd target-stub-projects/backend && bash "$QG" --stub-dir "$S_CS" --scope backend 2>/dev/null)
if [ $? -eq 1 ] && echo "$out" | grep -q '"overall": *"fail"'; then PASS=$((PASS+1)); echo "ok - checkstyle 失败返回 fail"
else FAIL=$((FAIL+1)); echo "FAIL - checkstyle 失败应 exit 1 + overall=fail (out: $out)"; fi

# 测试 3：不在 Maven/Vue 项目内 → exit 2 且无崩溃
check "非项目目录" 2 "$S_EMPTY" target-stub-projects/not-a-project --scope all

rm -rf "$S_ALL" "$S_CS" "$S_EMPTY"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
