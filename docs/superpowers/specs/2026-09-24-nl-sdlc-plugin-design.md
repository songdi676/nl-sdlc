# nl-sdlc 插件设计文档

日期：2026-09-24
状态：已与需求方逐节确认，待最终评审

## 1. 目标与范围

`nl-sdlc` 是一个 Claude Code 插件，用 AI Agent 驱动 SDLC 全流程自动化：**需求 → 编码 → 评审 → 测试 → CI/CD**。本版本明确**不包含运维阶段**。

目标用户：NewLand 内部 Java（Maven）+ Vue 3 开发团队。

插件定义五类资产：**agents、workflows、agent-teams、skills、hooks**。参考模式来自 `superpowers` 插件（skill/command/hook 引导注入模式）与 `agent-skills` 仓库（Skill→Persona→Command 三层架构）。

## 2. 已确认的关键决策

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 运行模式 | **混合模式**：会话内交互执行（含打回修复循环），CI 无头模式复跑硬关卡 |
| 2 | 需求来源 | 仓库内 **Markdown** 文档（`docs/requirements/`），不接外部系统 |
| 3 | CI 系统 | **未定/不统一** → 质量门脚本 CI 无关 + 三套流水线模板适配 |
| 4 | E2E 框架 | **Playwright**（TypeScript 用例，无头可重复运行） |
| 5 | 接口测试 | **Postman collection + Newman**（collection 入库版本管理） |
| 6 | 评审机制 | **AI 评审 + 人工批准**；CI 硬关卡只有质量门和测试，评审在 CI 不阻塞 |
| 7 | 技术栈 | Java + **Maven**；前端 **Vue 3**（Vite + TypeScript） |
| 8 | 需求文档格式 | Markdown |
| 9 | 资产语言 | **frontmatter/description 用英文**（利于模型触发路由），正文中文 |
| 10 | 编排方案 | **方案 C**：经典三层 + 原生 workflows + agent-teams |
| 11 | Workflow 数量 | **3 个**：需求、开发、测试 |
| 12 | 3票质疑规则 | **2/3 多数通过**，最多 3 轮修订，否则转人工决策 |
| 13 | CI 中的 AI | AI 只做可选诊断报告（默认关闭），**不在 CI 中自动改代码** |
| 14 | 开发环节 teams | 开发与评审环节均使用 agent-teams（交互式增强） |

## 3. 总体架构

### 3.1 关键技术边界

- **workflow 脚本只能编排子代理（subagent）**；**agent-teams 只在交互式会话中由 lead 生成**。两者各司其职：
  - workflows：确定性编排，交互式与 CI 无头共用同一批脚本；
  - agent-teams：交互式会话中的并行协作增强（开发并行编码、评审互搏）。
- 评审收进开发 workflow（`development.js` Phase 3）；CI 中评审只出报告不阻塞。

### 3.2 插件目录结构

```
nl-sdlc/
├── .claude-plugin/plugin.json + marketplace.json   # 元数据 + 团队 marketplace
├── agents/            # 子代理/persona 定义（dev、review、security、test 角色）
├── skills/            # 每阶段一个 skill（需求分析/编码/评审/测试/交付）
├── commands/          # 薄壳斜杠命令（/nl-sdlc:req、dev、test、ship…）
├── workflows/         # 3 个 workflow 脚本（requirement.js、development.js、testing.js）
├── hooks/             # SessionStart 元技能注入 + TeammateIdle 质量门
├── references/        # 共享清单（DoD、安全清单、测试规范）——单一事实来源
├── scripts/           # 质量门执行脚本（checkstyle/spotbugs/jacoco/安全扫描/newman）
├── templates/         # CI 模板（GitLab CI/Jenkins/GHA）+ checkstyle 配置 + Dockerfile
└── evals/             # skill 触发评测用例（后续迭代）
```

### 3.3 五类资产分工

| 资产 | 职责 |
|---|---|
| **skills** | 教 agent "怎么做"：需求分析、TDD 编码、评审、测试、交付 |
| **agents** | 角色定义（persona），同一批定义同时被 workflow 子代理和 teammates 复用 |
| **workflows** | 确定性流程编排：3 个阶段脚本，交互式与 CI 共用 |
| **agent-teams** | 交互式并行协作：开发并行编码、评审互搏（实验性，关键路径外增强） |
| **hooks** | 强制门禁：SessionStart 注入元技能、TeammateIdle 打回未过门的队友 |

### 3.4 流程总览

```
需求 workflow ──► 开发 workflow ──► 测试 workflow ──► CI(docker job)
分析→概要设计(3票质疑)   编码→质量门(打回循环)→评审   接口测试→E2E→报告   构建镜像
 →详细设计+任务列表        │                │                 │
     │                    │                │                 │
产物: docs/designs/       产物: 代码+测试   产物: 测试报告     产物: Docker 镜像
     <feature>-design.md   +质量门报告
     docs/plans/<feature>/
     (详细设计.md+tasks.md)
```

## 4. Workflow 设计

### 4.1 需求 `/nl-sdlc:req`（requirement.js）

```
输入: docs/requirements/*.md（可 args 指定文档）
│
├─ Phase 1 分析: 需求分析 agent → 结构化需求（用户故事、验收标准、非功能需求）
│
├─ Phase 2 概要设计: 设计 agent → 概要设计文档（架构/数据模型/接口设计）
│       │
│       └─ 3票质疑: 3 个质疑 agent 并行（架构视角/安全视角/测试视角）
│           各投一票 pass/reject+理由；第二轮起互相能看到对方的质疑再投票
│           ├─ ≥2/3 通过 → 进入 Phase 3
│           ├─ 未过 → 设计 agent 按质疑修订 → 重新投票（最多 3 轮）
│           └─ 3 轮仍不通过 → 输出分歧报告，转人工决策
│
└─ Phase 3 详细设计+任务列表: 基于通过的概要设计
     产物: docs/plans/<feature>/详细设计.md + docs/plans/<feature>/tasks.md
     （任务含依赖关系、验收标准、关联测试用例清单，格式可被开发阶段直接消费）

产物: docs/designs/YYYY-MM-DD-<feature>-design.md（概要设计）
      + docs/plans/<feature>/详细设计.md + docs/plans/<feature>/tasks.md
```

### 4.2 开发 `/nl-sdlc:dev`（development.js）

```
输入: docs/plans/<feature>/tasks.md + 详细设计.md（可 args 指定任务范围）
│
├─ Phase 1 编码: 解析任务（含依赖顺序）→ 每任务一个 dev 子代理按 TDD 编码
│
├─ Phase 2 质量门（每任务跑）: checkstyle → spotbugs → 覆盖率 → 安全扫描
│       └─ 不通过 → fix agent 修复 → 重跑质量门
│           直到通过 / 连续 2 轮无进展则任务标记失败并附诊断
│
├─ Phase 3 评审: 全部任务过门后 → 3 个评审 agent 并行（正确性/安全/性能）→ 汇总报告
│       └─ Critical 问题 → 打回对应任务重进 Phase 2
│
产物: 代码 + 质量门报告(JSON) + 评审报告
```

**交互式变体**（同一流程，agent-teams 执行）：lead 从 docs/plans/<feature>/tasks.md 建共享任务列表 → 生成 3 个 dev 队友并行认领（文件锁防冲突）→ `TeammateIdle` hook 在队友收工前跑质量门，未过门 exit 2 打回继续修 → `TaskCompleted` hook 验证验收标准 → 完成后生成 3 个 review 队友并行互搏评审 → **人工批准**后合并。

### 4.3 测试 `/nl-sdlc:test`（testing.js）

```
输入: 服务地址/环境参数（args）、tests/api/*.json（Postman collection）、tests/e2e/*.spec.ts
│
├─ Phase 1 接口测试: Newman 执行 collection
│       └─ 失败用例 → 诊断 agent 判定（服务 bug / 用例问题）
│            服务 bug → 打回开发（附诊断）；用例问题 → 修用例 → 重跑
│
├─ Phase 2 E2E: Playwright 执行用例（无头模式）
│       └─ 失败 → 诊断/修复循环，同样区分 bug 与用例问题
│
产物: 测试报告（HTML 存档 + JSON 供 CI 判定）+ 用例与需求追溯矩阵
```

测试用例与代码同等管理：存仓库、版本化、可重复运行。需求阶段产出用例清单，开发阶段按清单编写用例，测试阶段执行——三个 workflow 通过 docs/plans/<feature>/tasks.md 中的用例清单串起来。

## 5. Agent-teams 设计

### 5.1 角色定义（`agents/`，一份定义两种用法）

| 角色 | 职责 | 复用 |
|---|---|---|
| `dev-engineer` | Java/Vue TDD 编码，遵循编码 skill | dev 队友 / workflow 子代理 |
| `code-reviewer` | 多轴评审（正确性/可读性/架构） | review 队友 / workflow 子代理 |
| `security-auditor` | 安全审查（OWASP Top 10 视角） | 同上 |
| `test-engineer` | 测试用例设计、诊断、修复 | 同上 |

### 5.2 使用场景

- **开发环节**：3 个 dev 队友并行认领任务开发，质量门由 hook 强制
- **评审环节**：3 个 review 队友（正确性/安全/性能视角）并行评审 + SendMessage 互相质疑，lead 汇总后人工批准

### 5.3 实验性风险声明（写入插件文档）

- 需 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 启用
- Windows 使用 in-process 模式（分屏不支持）
- 队友会话无法恢复；团队协作中途失败时**回退 workflow 模式**（`/nl-sdlc:dev` 重跑），两条路径产出同一批产物

## 6. 质量门设计

统一入口 `scripts/quality-gate.sh`：自动识别项目类型（Maven/前端）跑对应门，输出机器可读 JSON 报告。**交互式 hook 与 CI 共用同一脚本**，判定结果一致。

### 6.1 Java（Maven）——四项全过才算过门

| 门 | 工具 | 默认阈值 |
|---|---|---|
| 代码风格 | checkstyle（阿里 P3C 规则，可换公司规则） | 0 违规 |
| 静态分析 | spotbugs（含 FindSecBugs 安全规则） | 0 高危/中危 |
| 单元测试覆盖率 | jacoco（行覆盖） | ≥ 80% |
| 安全审查 | Dependency-Check 依赖漏洞 + AI security-auditor 代码审查 | 无高危漏洞 |

### 6.2 Vue 3（对称轻量门）

ESLint（vue3-recommended）0 error、`vue-tsc` 类型检查、Vitest 覆盖率 ≥ 70%、`npm audit` 无高危。

### 6.3 打回循环

任何一门不过 → 附 JSON 失败详情打回 → fix agent 修复 → 重跑 → 最多 2 轮无进展则任务标记失败并附诊断（交互式同规则）。阈值集中在 `templates/config/quality-gate.yaml` 可配置。

## 7. 测试工具链

- **接口测试**：`tests/api/` 存 Postman collection + 环境文件；Newman 执行，输出 JUnit 格式报告供 CI 判定
- **E2E**：`tests/e2e/*.spec.ts`；Playwright 无头执行，失败自动截图/录像归档
- **用例治理**：test-engineer skill 指导用例编写；用例与需求双向追溯

## 8. CI/CD 集成

### 8.1 原则

CI 里确定性门直接跑脚本（与交互式同一脚本，CI 不需要 AI 密钥即过硬关卡）；AI 只做可选诊断，**不在 CI 中自动改代码**（避免无人审核的提交）。AI 修复能力用在交互式本地（打回循环当场修）。

### 8.2 流水线模板（`templates/ci/`，三套：GitLab CI / Jenkinsfile / GitHub Actions）

```
stages: [quality, test, docker]
quality:   quality-gate.sh（任一不过 → 流水线红，附 JSON 报告）
test:      run-tests.sh（Newman 接口测试 + Playwright 无头 E2E，失败用例附截图/录像归档）
ai-report: 可选 job，失败时 claude -p 生成诊断报告（默认关闭，需配置 API 密钥）
docker:    多阶段构建 → 推送镜像（仅 quality+test 全绿后执行）
```

### 8.3 Docker 制品

- `templates/docker/`：Java 后端 Dockerfile（Maven 多阶段构建 → JRE 精简镜像）、Vue 前端 Dockerfile（Node 构建 → Nginx 静态镜像，含 SPA history 路由）
- 镜像标签：`{registry}/{project}:{版本号}-{commit}`
- 只保证镜像构建与推送；部署编排不做（运维排除）

## 9. 错误处理

| 场景 | 处理 |
|---|---|
| 质量门失败 | JSON 报告附修复建议 → 打回循环，2 轮无进展 → 任务失败 + 诊断 |
| 3票质疑不过 | 最多 3 轮 → 分歧报告转人工决策 |
| workflow 中断 | 同会话可恢复；CI 重跑幂等（产物路径确定） |
| agent-teams 失败 | 回退 workflow 模式重跑，产物互通 |
| hook 依赖缺失 | 优雅降级：输出说明性 JSON 并 exit 0，不阻塞会话 |

## 10. 明确不做（YAGNI）

- ❌ 运维阶段（部署、监控、告警）
- ❌ 外部需求系统对接（Jira 等）——需求 skill 留扩展位，本版只读仓库内文档
- ❌ 非 Java/Vue 技术栈
- ❌ evals 评测套件、多宿主分发（Codex/Gemini）——后续迭代

## 11. 参考模式

- `superpowers` 插件：SessionStart hook 引导注入元技能；薄壳斜杠命令（`disable-model-invocation`）；skill description 只写触发条件；Red Flags 对照表防跳步
- `agent-skills`：Skill（怎么做）→ Persona（谁来做）→ Command（何时编排）三层架构；persona 禁止互调；并行 fan-out + merge 唯一多 agent 模式；Rationalizations 表；共享 references 单源化
- 官方 workflows：确定性编排、保存为命令、插件分发
- 官方 agent-teams：subagent 定义复用为 teammate 角色、TeammateIdle/TaskCompleted hook 强制质量门
