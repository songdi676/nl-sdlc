#!/bin/bash
# TeammateIdle：队友收工前跑质量门。未过门 exit 2 打回；非项目目录/脚本缺失 exit 0 放行
QG="$(dirname "$0")/../scripts/quality-gate.sh"
if [ ! -f "$QG" ]; then
  echo '{"result":"skip","reason":"quality-gate.sh 缺失"}' >&2
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
  echo "质量门未通过，请继续修复直到全绿：$OUT" >&2
  exit 2
fi
exit 0
