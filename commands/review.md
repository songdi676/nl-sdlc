---
description: "交互式评审入口：五轴代码评审，启用 agent-teams 时三视角并行互搏评审"
disable-model-invocation: true
---

Invoke the nl-sdlc:code-review skill and follow it exactly as presented to you. If agent-teams is enabled (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1), spawn three reviewer teammates in parallel — correctness, security, and performance perspectives — have them challenge each other's findings via messages, then merge their reports into one graded issue list for human approval; otherwise review sequentially in this session.
