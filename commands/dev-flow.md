---
description: "批量开发编排入口：主 agent 读 tasks.md、按依赖分层，worktree 隔离并行调度 dev-task 单任务工作流，逐层合回并收尾全量门"
disable-model-invocation: true
---

批量开发由你（主 agent）编排；`dev-task` workflow 是单任务开发单元（worktree 内 TDD 编码 → 质量门打回 ≤2 轮 → 三视角评审），一次调用只负责一个任务。命令后的参数是 feature 名；未指定时：`docs/plans/` 下仅一个 feature 则取之，多个则列出让用户选择。

## 编排协议

1. **读任务**：Read `docs/plans/<feature>/tasks.md`，解析 YAML frontmatter 的 tasks 数组（字段 id/title/deps/acceptance/test_cases/description）。文件缺失或缺 tasks 字段 → 报错并指明路径与字段后停止，不得编造任务。
2. **拓扑分层**：把任务数组（至少含 id 与 deps 字段）经 heredoc 传给 `node scripts/topo-levels.mjs`（不带文件参数时读 stdin）：
   ```bash
   node scripts/topo-levels.mjs <<'EOF'
   [{"id":"t1","deps":[]},{"id":"t2","deps":["t1"]}]
   EOF
   ```
   输出 `{"levels":[[...],[...]]}` → 按层开发；输出 `{"error":...}`（依赖缺失/成环）→ 原样报告并停止。
3. **逐层开发（worktree 隔离）**：首层 base = 当前 `git rev-parse HEAD`；后续层 base = 上一层全部合回后的新 HEAD。对每一层：
   1. 层内每个任务 i：
      - `git worktree add .claude/worktrees/<feature>-<task-id> -b dev/<feature>/<task-id> <base>`（目录或分支已存在 = 上次失败重跑的现场 → 复用，跳过 add）
      - 调用 Workflow 工具：name `dev-task`，args `{feature, task: <该任务完整对象>, worktreePath: <worktree 绝对路径>, branch: "dev/<feature>/<task-id>", base: <base sha>, mainTreePath: <主树绝对路径>}`
      - **同一层所有任务在同一条消息里并行发起**（多个 Workflow 调用）
   2. 每个 dev-task 完成通知到达后按到达顺序逐个处理（合入必须串行）：
      - 合入前确认主树干净：`git status --porcelain` 为空；不干净 → 暂停合入，问用户怎么处理
      - `result: done` 或 `no-code` → `git merge dev/<feature>/<task-id> --no-edit`；冲突由你解决（解决不了问用户）→ `git worktree remove .claude/worktrees/<feature>-<task-id>` → `git branch -d dev/<feature>/<task-id>`
      - `result: gate-failed` 或 `error` → 不合入，保留 worktree，记入待汇报（附重跑 args）
   3. 层内全部处理完 → 进入下一层
4. **收尾**：全部层完成 → 主树重新生成覆盖率产物（有 pom.xml → `mvn test jacoco:report`；有 package.json → `npx vitest run --coverage`）→ 跑一次全量门 `bash scripts/quality-gate.sh --scope all` → 向用户汇总：每任务 dev 摘要、质量门结果（含 fixRounds）、三视角评审分级清单（Critical 置顶）、失败任务与保留的 worktree/重跑方式。提示：Critical 问题需打回修复；交付合并前需人工批准（见 nl-sdlc:delivery skill）。

## 纪律

- 不得跳过拓扑分层全量并行：依赖任务必须等前置任务合回后、从新 tip 建 worktree
- 不得改动 tasks.md 的字段
- 重跑失败任务 = 以相同 args 再调一次 dev-task（复用已有 worktree，dev agent 基于现状继续）
- 中途恢复：先 `git branch --list 'dev/<feature>/*'` 与 `git worktree list` 对账，已合回（无分支且无 worktree）的任务视为完成，从未完成任务继续
- Workflow 工具解析不到 dev-task → 停止并提示用户检查插件安装，不要手工模拟开发流程
