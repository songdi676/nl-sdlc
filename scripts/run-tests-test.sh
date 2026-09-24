#!/bin/bash
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0

# stub newman：成功
S_OK=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_OK/newman"
printf '#!/bin/bash\nexit 0\n' > "$S_OK/playwright"
chmod +x "$S_OK/newman" "$S_OK/playwright"
mkdir -p target-stub-projects/api-target && cd target-stub-projects/api-target
mkdir -p tests/api && echo '{}' > tests/api/demo.postman_collection.json

out=$(bash ../../scripts/run-tests.sh --api --e2e --base-url http://127.0.0.1:8080 --stub-dir "$S_OK" 2>/dev/null)
if [ $? -eq 0 ] && echo "$out" | grep -q '"overall":"pass"'; then PASS=$((PASS+1)); echo "ok - 全绿"
else FAIL=$((FAIL+1)); echo "FAIL - 全绿应 pass (out: $out)"; fi

# stub newman：失败
S_BAD=$(mktemp -d)
printf '#!/bin/bash\nexit 1\n' > "$S_BAD/newman"
chmod +x "$S_BAD/newman"
out=$(bash ../../scripts/run-tests.sh --api --base-url http://127.0.0.1:8080 --stub-dir "$S_BAD" 2>/dev/null)
if [ $? -eq 1 ] && echo "$out" | grep -q '"status":"fail"'; then PASS=$((PASS+1)); echo "ok - newman 失败 fail"
else FAIL=$((FAIL+1)); echo "FAIL - newman 失败应 exit 1 (out: $out)"; fi

# 工具缺失：优雅降级
S_EMPTY=$(mktemp -d)
out=$(bash ../../scripts/run-tests.sh --api --e2e --base-url http://127.0.0.1:8080 --stub-dir "$S_EMPTY" 2>/dev/null)
if [ $? -eq 0 ] && echo "$out" | grep -q '"status":"skipped"' && echo "$out" | grep -q 'newman 未安装'; then PASS=$((PASS+1)); echo "ok - 工具缺失 skipped + warning"
else FAIL=$((FAIL+1)); echo "FAIL - 工具缺失应 skipped + warning exit 0 (out: $out)"; fi

# npx 本地依赖检测：PATH 无 newman，stub npx 可用 → 检测成功，经 stub npx 走真实执行路径
S_NPX=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_NPX/npx"
chmod +x "$S_NPX/npx"
mkdir -p tests/api && echo '{}' > tests/api/demo.postman_collection.json
out=$(bash ../../scripts/run-tests.sh --api --base-url http://127.0.0.1:8080 --stub-dir "$S_NPX" 2>/dev/null)
if [ $? -eq 0 ] && echo "$out" | grep -q '"overall":"pass"' && echo "$out" | grep -q '"api":{"status":"pass"'; then PASS=$((PASS+1)); echo "ok - npx 本地依赖检测"
else FAIL=$((FAIL+1)); echo "FAIL - stub npx 应使 newman 检测成功并 pass (out: $out)"; fi

cd ../.. && rm -rf "$S_OK" "$S_BAD" "$S_EMPTY" "$S_NPX"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
