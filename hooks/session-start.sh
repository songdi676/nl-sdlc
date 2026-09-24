#!/bin/bash
# SessionStart：注入 using-nl-sdlc 元技能全文，强制路由意识
SKILL="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/skills/using-nl-sdlc/SKILL.md"
if [ ! -f "$SKILL" ]; then
  echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"nl-sdlc 插件已安装（using-nl-sdlc 技能文件缺失，请重新安装插件）"}}'
  exit 0
fi
# JSON 转义技能全文
CONTENT=$(sed 's/\\/\\\\/g; s/"/\\"/g' "$SKILL" | tr '\n' ' ' | sed 's/\r//g')
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<nl-sdlc-plugin>\\n%s"}}' "$CONTENT"
exit 0
