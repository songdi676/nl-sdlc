---
description: "交互式编码入口：按 tasks.md 做 TDD 编码并通过质量门，启用 agent-teams 时并行开发"
disable-model-invocation: true
---

Invoke the nl-sdlc:coding skill and follow it exactly as presented to you. If agent-teams is enabled (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1), create a shared task list from docs/plans/<feature>/tasks.md and spawn dev-engineer teammates to claim and implement tasks in parallel (the TeammateIdle hook enforces quality gates); otherwise implement the tasks sequentially in this session.
