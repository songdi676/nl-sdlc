#!/bin/bash
set -u
cd "$(dirname "$0")/.."
PLUGIN_ROOT="$(pwd)"
PASS=0; FAIL=0

# session-start：输出合法 JSON 且含技能关键句
out=$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash hooks/session-start.sh)
if echo "$out" | grep -q '"hookEventName":"SessionStart"' && echo "$out" | grep -q 'nl-sdlc 任务路由'; then PASS=$((PASS+1)); echo "ok - session-start 注入"
else FAIL=$((FAIL+1)); echo "FAIL - session-start 输出异常: $out"; fi
echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s)}catch(e){console.error("FAIL - 非 JSON");process.exit(1)}console.error("ok - session-start JSON 合法")})' 2>&1 | grep -q '^ok' && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

# teammate-idle：非项目目录 → exit 0 放行（空临时目录，无 pom.xml/package.json）
S_EMPTY=$(mktemp -d)
( cd "$S_EMPTY" && bash "$PLUGIN_ROOT/hooks/teammate-idle.sh" >/dev/null 2>&1 ); code=$?
if [ "$code" -eq 0 ]; then PASS=$((PASS+1)); echo "ok - teammate-idle 非项目目录放行"
else FAIL=$((FAIL+1)); echo "FAIL - teammate-idle 应放行 (exit $code)"; fi
rm -rf "$S_EMPTY"

# teammate-idle：插件自身仓库（有 .claude-plugin/plugin.json 且无 pom.xml）→ exit 0 跳过
( cd "$PLUGIN_ROOT" && bash "$PLUGIN_ROOT/hooks/teammate-idle.sh" >/dev/null 2>&1 ); code=$?
if [ "$code" -eq 0 ]; then PASS=$((PASS+1)); echo "ok - teammate-idle 插件自身仓库跳过"
else FAIL=$((FAIL+1)); echo "FAIL - teammate-idle 插件自身仓库应跳过 (exit $code)"; fi

# teammate-idle：伪造全绿 Maven 项目 → exit 0
S=$(mktemp -d); mkdir -p "$S/sub" && touch "$S/sub/pom.xml"
mkdir -p "$S/sub/target/site/jacoco" && printf 'GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_MISSED,LINE_MISSED,LINE_COVERED\na,Example,0,0,0,0,20,80\n' > "$S/sub/target/site/jacoco/jacoco.csv"
printf '#!/bin/bash\nexit 0\n' > "$S/mvn" && chmod +x "$S/mvn"
( cd "$S/sub" && PATH="$S:$PATH" bash "$PLUGIN_ROOT/hooks/teammate-idle.sh" >/dev/null 2>&1 ); code=$?
if [ "$code" -eq 0 ]; then PASS=$((PASS+1)); echo "ok - teammate-idle 全绿放行"
else FAIL=$((FAIL+1)); echo "FAIL - teammate-idle 全绿应 exit 0 (exit $code)"; fi
rm -rf "$S"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
