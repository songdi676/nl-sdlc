#!/bin/bash
# TaskCompleted：任务标记完成时提醒核对验收标准与质量门（不阻断，只注入反馈）
echo '{"hookSpecificOutput":{"hookEventName":"TaskCompleted","additionalContext":"任务完成前请确认：验收标准逐条达成且 quality-gate.sh 全绿。"}}'
exit 0
