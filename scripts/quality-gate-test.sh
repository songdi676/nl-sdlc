#!/bin/bash
# quality-gate.sh 的 TDD 测试：验证退出码契约（0=pass 1=fail 2=环境/配置错误）与 JSON schema
set -u
cd "$(dirname "$0")/.."
QG="$(pwd)/scripts/quality-gate.sh"
PASS=0; FAIL=0

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

# 测试 3：不在 Maven/Vue 项目内 → exit 2、JSON project_type=none 且无崩溃
out=$(cd target-stub-projects/not-a-project && bash "$QG" --stub-dir "$S_EMPTY" --scope all 2>/dev/null)
if [ $? -eq 2 ] && echo "$out" | grep -q '"project_type":"none"'; then PASS=$((PASS+1)); echo "ok - 非项目目录 project_type=none"
else FAIL=$((FAIL+1)); echo "FAIL - 非项目目录应 exit 2 + project_type=none (out: $out)"; fi

# ---- Vue 门与阈值测试 ----
S_NPM_OK=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_NPM_OK/npm"
printf '#!/bin/bash\nexit 0\n' > "$S_NPM_OK/vue-tsc"
chmod +x "$S_NPM_OK/npm" "$S_NPM_OK/vue-tsc"
mkdir -p target-stub-projects/frontend/coverage
touch target-stub-projects/frontend/package.json
echo '{"total":{"lines":{"pct":75}}}' > target-stub-projects/frontend/coverage/coverage-summary.json

# 测试 4：Vue 全绿 → exit 0 overall=pass
( cd target-stub-projects/frontend && out=$(bash "$QG" --stub-dir "$S_NPM_OK" --scope frontend 2>/dev/null); code=$?
  if [ "$code" -eq 0 ] && echo "$out" | grep -q '"overall":"pass"'; then echo "ok - vue 全绿"; exit 0
  else echo "FAIL - vue 全绿应 pass (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 测试 5：npm audit 高危 → exit 1 overall=fail
S_NPM_BAD=$(mktemp -d)
printf '#!/bin/bash\nif [ "$1" = "audit" ]; then exit 1; fi\nexit 0\n' > "$S_NPM_BAD/npm"
printf '#!/bin/bash\nexit 0\n' > "$S_NPM_BAD/vue-tsc"
chmod +x "$S_NPM_BAD/npm" "$S_NPM_BAD/vue-tsc"
( cd target-stub-projects/frontend && out=$(bash "$QG" --stub-dir "$S_NPM_BAD" --scope frontend 2>/dev/null); code=$?
  if [ "$code" -eq 1 ] && echo "$out" | grep -q '"overall":"fail"'; then echo "ok - npm audit 高危 fail"; exit 0
  else echo "FAIL - npm audit 高危应 fail (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 测试 6：阈值文件缺失 → 回退默认值并在 warnings 中注明（exit 0 全绿场景）
( cd target-stub-projects/frontend && out=$(bash "$QG" --stub-dir "$S_NPM_OK" --scope frontend --thresholds /nonexistent/qg.yaml 2>/dev/null); code=$?
  if [ "$code" -eq 0 ] && echo "$out" | grep -q '阈值文件缺失'; then echo "ok - 缺失阈值文件回退默认值"; exit 0
  else echo "FAIL - 缺失阈值文件应回退默认并在 warnings 注明 (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 测试 7：前后端同仓（both）--scope all → 后端失败则 overall=fail 且含 backend/frontend 子报告
S_BOTH=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_BOTH/npm"
printf '#!/bin/bash\nexit 0\n' > "$S_BOTH/vue-tsc"
printf '#!/bin/bash\nexit 1\n' > "$S_BOTH/mvn"   # 后端必失败
chmod +x "$S_BOTH/npm" "$S_BOTH/vue-tsc" "$S_BOTH/mvn"
mkdir -p target-stub-projects/both/target/site/jacoco
printf 'a,Example,0,0,0,0,20,80\n' > target-stub-projects/both/target/site/jacoco/jacoco.csv
mkdir -p target-stub-projects/both/coverage
echo '{"total":{"lines":{"pct":75}}}' > target-stub-projects/both/coverage/coverage-summary.json
touch target-stub-projects/both/pom.xml target-stub-projects/both/package.json
( cd target-stub-projects/both && out=$(bash "$QG" --stub-dir "$S_BOTH" --scope all 2>/dev/null); code=$?
  if [ "$code" -eq 1 ] && echo "$out" | grep -q '"overall":"fail"' && echo "$out" | grep -q '"backend"' && echo "$out" | grep -q '"frontend"'; then echo "ok - both 合并失败"; exit 0
  else echo "FAIL - both 合并应 fail 且含子报告 (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 测试 10（回归）：both 项目后端工具缺失（stub 无 mvn + PATH 隔离）→ exit 2 且含 backend/frontend 子报告
S_BOTH_NO_MVN=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_BOTH_NO_MVN/npm"
printf '#!/bin/bash\nexit 0\n' > "$S_BOTH_NO_MVN/vue-tsc"
chmod +x "$S_BOTH_NO_MVN/npm" "$S_BOTH_NO_MVN/vue-tsc"
( cd target-stub-projects/both && out=$(PATH=/usr/bin:/bin bash "$QG" --stub-dir "$S_BOTH_NO_MVN" --scope all 2>/dev/null); code=$?
  if [ "$code" -eq 2 ] && echo "$out" | grep -q '"backend"' && echo "$out" | grep -q '"frontend"' && echo "$out" | grep -q 'mvn 未安装'; then echo "ok - both 后端工具缺失 exit 2"; exit 0
  else echo "FAIL - both 后端工具缺失应 exit 2 且含子报告 (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
rm -rf "$S_BOTH_NO_MVN"

rm -rf "$S_NPM_OK" "$S_NPM_BAD" "$S_BOTH"

# ---- 补充裁决测试（Task 11 评审）----
# 测试 8：非法 --scope（非 backend|frontend|all）→ exit 2 且 JSON project_type=none
out=$(cd target-stub-projects/backend && bash "$QG" --stub-dir "$S_ALL" --scope mobile 2>/dev/null)
if [ $? -eq 2 ] && echo "$out" | grep -q '"project_type":"none"'; then PASS=$((PASS+1)); echo "ok - 非法 scope exit 2"
else FAIL=$((FAIL+1)); echo "FAIL - 非法 scope 应 exit 2 + project_type=none (out: $out)"; fi

# 测试 9：Maven 项目但 PATH 隔离找不到 mvn → exit 2（resolve 经 command -v 兜底为空）
S_NO_MVN=$(mktemp -d)
out=$(cd target-stub-projects/backend && PATH=/usr/bin:/bin bash "$QG" --stub-dir "$S_NO_MVN" --scope backend 2>/dev/null)
if [ $? -eq 2 ] && echo "$out" | grep -q '"project_type":"maven"'; then PASS=$((PASS+1)); echo "ok - mvn 缺失 exit 2"
else FAIL=$((FAIL+1)); echo "FAIL - mvn 缺失应 exit 2 + project_type=maven (out: $out)"; fi
rm -rf "$S_NO_MVN"

rm -rf "$S_ALL" "$S_CS" "$S_EMPTY"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
