#!/bin/bash
# TaskCompleted：任务标记完成时验证质量门与验收标准（spec §4.2）。
# 质量门未过 exit 2 阻止完成；非项目目录/脚本缺失/环境不满足 exit 0 优雅放行；
# 全绿时输出 hookSpecificOutput 提醒核对验收标准。
QG="$(dirname "$0")/../scripts/quality-gate.sh"
if [ ! -f "$QG" ]; then
  echo '{"result":"skip","reason":"quality-gate.sh 缺失"}' >&2
  exit 0
fi
# 插件自身仓库（有插件清单但无业务项目特征）：跳过质量门，避免对插件自身 package.json
# 误跑 Vue 门导致任务永远无法标记完成
if [ -f .claude-plugin/plugin.json ] && [ ! -f pom.xml ]; then
  echo "quality gate skip: nl-sdlc 插件自身仓库" >&2
  exit 0
fi
OUT=$(bash "$QG" --scope all 2>/dev/null)
CODE=$?
if [ "$CODE" -eq 2 ]; then
  # 环境不满足（如非 Maven/Vue 项目目录）：放行
  echo "quality gate skip: $OUT" >&2
  exit 0
fi
if [ "$CODE" -ne 0 ]; then
  echo "质量门未通过，任务不能标记完成：$OUT" >&2
  exit 2
fi
echo '{"hookSpecificOutput":{"hookEventName":"TaskCompleted","additionalContext":"任务完成前请确认：验收标准逐条达成"}}'
exit 0
