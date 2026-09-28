---
name: using-nl-sdlc
description: Use when starting any SDLC work in this repo - routes the task to the correct nl-sdlc phase (requirement, coding, review, testing, delivery) and enforces the corresponding skill or workflow
---

# nl-sdlc 任务路由

<强制调用>
本仓库中的任何开发任务，必须先经本技能判断所处阶段，再调用对应 skill 或 workflow。

哪怕只有 1% 的可能与 SDLC 相关，也必须先完成路由判断。没有例外，没有"直接动手"的捷径。

跳过路由 = 跳过质量门 = 产出不可交付的代码。这不可协商。
</强制调用>

## Overview

本插件将 SDLC 分为需求→编码→评审→测试→交付五个阶段。任何开发任务必须先判断所处阶段，再调用对应 skill 或 workflow。质量门（checkstyle/spotbugs/覆盖率/安全）是编码完成的前置条件，测试通过是交付的前置条件——不存在跳过路径。

每个任务开始前自问：用户意图落在哪个阶段？查下方路由表确定载体，一次只推进一个阶段。

## 路由表

| 用户意图 | 调用 |
|---|---|
| 分析新需求 / 出设计 / 拆任务 | 用户可用 `/nl-sdlc:design`（显式调用架构设计智能体），智能体会跑 `/nl-sdlc:requirement-flow` workflow |
| 按任务编码 / 修复打回问题 | 本 skill 的「编码」节 → `nl-sdlc:coding` skill |
| 评审代码 / 安全审查 | `/nl-sdlc:review` 命令 → `nl-sdlc:code-review` skill（启用 teams 时三视角并行互搏） |
| 接口测试 / E2E / 修测试用例 | `/nl-sdlc:test` 命令（teams 并行）或 `/nl-sdlc:test-flow` workflow |
| 合并 / 交付 | `nl-sdlc:delivery` skill |

阶段与载体总览：

| 阶段 | skill | workflow 命令 |
|---|---|---|
| 需求 | `nl-sdlc:requirement-analysis` | `/nl-sdlc:requirement-flow` |
| 编码 | `nl-sdlc:coding` | `/nl-sdlc:dev-flow`（批量） |
| 评审 | `nl-sdlc:code-review` | — |
| 测试 | `nl-sdlc:testing` | `/nl-sdlc:test-flow` |
| 交付 | `nl-sdlc:delivery` | — |

判断规则：

- 意图不明确或多阶段混合 → 从最左（需求）阶段开始，一次只推进一个阶段。
- "修 bug"是编码任务：走「编码」节，修复后的代码同样要过评审与测试。
- 修测试用例本身是测试任务，走 `/nl-sdlc:test-flow`，不要当编码任务处理。

## 编码节（交互式开发会话）

编码是最高频场景。进入本节的交互式会话必须逐条执行：

1. 确认 `docs/plans/<feature>/tasks.md` 与 `详细设计.md` 存在；不存在则先跑 `/nl-sdlc:requirement-flow`
2. 遵循 `nl-sdlc:coding` skill 做 TDD 编码
3. 每个任务完成前运行 `bash scripts/quality-gate.sh`，未过门必须修复，禁止提交未过门代码
4. 若启用 agent-teams（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）：从 tasks.md 建共享任务列表，生成 dev 队友并行认领，质量门由 TeammateIdle hook 强制。评审时生成 3 个 review 队友（正确性/安全/性能视角）并行互搏；测试时生成 test 队友并行执行接口/E2E

批量开发（非交互式跑完整批任务）改跑 `/nl-sdlc:dev-flow` workflow，它同样按 tasks.md 编码并执行质量门打回循环。

## Red Flags

以下想法出现即 STOP——你正在给自己找跳过流程的理由：

| 想法 | 现实 |
|---|---|
| "这个改动太小，不用过质量门" | 质量门对所有代码生效，无例外 |
| "测试以后再补" | 测试是任务完成定义的一部分，没有"以后" |
| "直接改代码就行" | 无 tasks.md 的改动先走需求阶段 |
| "我先探索一下代码再判断阶段" | 先路由再动手，探索也是任务的一部分 |
| "这个流程我熟，不用每次查" | 流程会更新，每次都按当前 SKILL 执行 |
| "先改完这批再统一走评审" | 评审在交付路径上，跳过它没有捷径 |

## Integration

编码完成且质量门全绿 → 进入 `nl-sdlc:code-review`；评审通过且人工批准 → `nl-sdlc:delivery`。

阶段流转不跳步，前一阶段的产物是后一阶段的输入：需求产出 tasks.md → 编码产出过门代码 → 评审产出批准结论 → 测试产出通过报告 → 交付产出合并。前一阶段未完成就进入下一阶段，视为违规。
