# nl-sdlc 使用手册

AI Agent 驱动的 SDLC 全流程自动化插件：需求 → 编码 → 评审 → 测试 → CI/CD。
本手册面向已安装 Claude Code 的团队成员，只讲操作步骤；机制原理见 `docs/superpowers/specs/2026-09-24-nl-sdlc-plugin-design.md`（注意：本手册与 README 中的命令名为准，spec 中的 `/nl-sdlc:req|dev|test` 是早期示意名）。

适用技术栈：Java（Maven）+ Vue 3（Vite + TypeScript）。

**术语速览**：`-flow` 结尾的是自动化流程命令：`/nl-sdlc:requirement-flow`、`/nl-sdlc:test-flow` 是确定性 workflow；`/nl-sdlc:dev-flow` 由主 agent 编排、按依赖分层并行调度 `dev-task` 单任务 workflow（worktree 隔离）；其余是交互式薄壳命令，背后是 skill（指导 agent 工作的规范）与 agent（角色智能体）：`/nl-sdlc:design`（架构设计入口，显式调用架构设计智能体 → 智能体跑 requirement-flow）、`/nl-sdlc:code`、`/nl-sdlc:review`、`/nl-sdlc:test`、`/nl-sdlc:ship`；agent-teams 是实验性的多会话并行协作（code/review/test 启用后自动使用）。

**执行机制速览**：Claude Code 运行多步骤任务有四种机制，区别在于**谁掌握计划**：

| | 子代理 | Skills | Agent teams | 工作流 |
|---|---|---|---|---|
| 它是什么 | Claude 生成的工作者 | Claude 遵循的指令 | 监督对等会话的主导代理 | 运行时执行的脚本 |
| 谁决定接下来运行什么 | Claude，逐轮 | Claude，遵循提示 | 主导代理，逐轮 | 脚本 |
| 中间结果在哪里 | Claude 的上下文窗口 | Claude 的上下文窗口 | 共享任务列表 | 脚本变量 |
| 什么是可重复的 | 工作者定义 | 指令 | 团队定义 | 编排本身 |
| 规模 | 每轮几个委派任务 | 与子代理相同 | 少数几个长期运行的对等体 | 每次运行数十到数百个代理 |
| 中断 | 重启轮次 | 重启轮次 | 队友继续运行 | 在同一会话中可恢复 |

前三种机制里 Claude 是编排者：它逐轮决定接下来生成或分配什么，每个中间结果都进入上下文窗口；**工作流把计划移入代码**——脚本持有循环、分支和中间结果本身，Claude 的上下文只保留最终答案。本插件的对应关系：

| 机制 | 本插件中的用途 |
|---|---|
| 工作流（确定性） | `requirement-flow`、`test-flow`、`dev-task`（单任务）；`dev-flow` 由主 agent 逐层编排、并行启动 dev-task |
| Agent teams（实验性） | 启用 teams 后，`code` / `review` / `test` 由队友并行执行 |
| Skill（工作规范） | `code`（coding）、`review`（code-review）、`test`（testing）背后的执行规范 |
| 子代理 | 架构设计智能体（`design` 显式调用）、各 flow 内部的分析 / 质疑 / 开发 / 评审 agent |

---

## 1. 插件安装与启用

### 1.1 安装插件

`marketplace.json` 位于**插件仓库**（本项目）的 `.claude-plugin/` 目录下——先 clone 插件仓库（或按团队分发方式获取其副本），在插件仓库根目录执行：

```bash
claude plugin marketplace add ./.claude-plugin/marketplace.json
claude plugin install nl-sdlc@nl-sdlc-marketplace
```

安装后可用命令：`/nl-sdlc:design`、`/nl-sdlc:requirement-flow`、`/nl-sdlc:dev-flow`、`/nl-sdlc:dev-task`、`/nl-sdlc:test-flow`、`/nl-sdlc:code`、`/nl-sdlc:review`、`/nl-sdlc:test`、`/nl-sdlc:ship`。

### 1.1.1 升级插件（已安装旧版时）

插件仓库更新后（例如拉取了本仓库最新代码），执行：

```bash
cd <插件仓库> && git pull        # 拉取插件最新代码
claude plugin update nl-sdlc@nl-sdlc-marketplace   # 若 update 不可用，重新执行 marketplace add + install
```

**升级后必做**：重新执行 [1.3 资产落地](#13-资产落地必做)——把更新后的 `scripts/`、`templates/`、`quality-gate.yaml` 重新复制进业务项目，否则业务项目里的脚本还是旧版本。

### 1.2 （可选）启用 agent-teams 并行开发

在项目级 `.claude/settings.json`（或用户级 `~/.claude/settings.json`）中设置：

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

- Windows 使用 in-process 模式即可（分屏模式不支持）。
- agent-teams 为实验性功能：协作中途失败时，直接运行 `/nl-sdlc:dev-flow <feature>` 以编排模式重跑（已合回的任务自动跳过，见 4.1），两条路径产物互通。

### 1.3 资产落地（必做）

插件脚本不会自动出现在业务项目里，需要把以下文件复制进项目（建议用 git submodule 或统一的分发脚本管理插件仓库）：

| 复制到业务项目 | 用途与注意 |
|---|---|
| `scripts/quality-gate.sh` → 项目根 `scripts/` | 质量门脚本（本手册所有 `bash scripts/...` 命令的前提） |
| `scripts/run-tests.sh` → 项目根 `scripts/` | 测试执行脚本 |
| `scripts/topo-levels.mjs` → 项目根 `scripts/` | 任务依赖拓扑分层（`/nl-sdlc:dev-flow` 编排的输入） |
| `templates/config/quality-gate.yaml` → 项目根 | 阈值配置（自动生效，见 4.3） |
| `templates/ci/` 按 CI 系统选一个 | 需改名/移位：GitLab → 项目根 `.gitlab-ci.yml`；Jenkins → 项目根 `Jenkinsfile`；GHA → `.github/workflows/` |
| `templates/docker/` | Dockerfile 模板（见 7.2，**目录结构原位保留**，不拍平） |

（hooks 不需要复制：插件安装后由 Claude Code 自动从插件目录加载。）

### 1.4 环境前置条件

**机器侧**：Windows 使用 Git Bash 执行脚本命令；`node`、`mvn`、`npm` 在 PATH 中。

**项目侧**：
- 后端 `pom.xml`：配置 checkstyle（阿里 P3C 规则）、spotbugs（含 FindSecBugs）、jacoco rules（行覆盖率 ≥ 80%）、dependency-check-maven 插件（org.owasp，本地与 CI 都用 `mvn dependency-check:check`）。
- 前端 `package.json`：含 `lint` script；Vitest 配置覆盖率阈值 ≥ 70% 且 `coverage` reporter 含 `json-summary`；`package-lock.json` 需入库（CI 用 `npm ci`）。
- `playwright.config.ts`：`baseURL` 读 `process.env.PLAYWRIGHT_BASE_URL`（`--base-url` 参数通过该环境变量传递）。

---

## 2. 快速上手：一个 feature 的完整旅程

以"用户登录"为例：

1. **准备**：完成第 1 章安装与资产落地；把需求写入 `docs/requirements/用户登录.md`（目录必须存在且非空，否则 workflow 直接终止）。
2. **需求**：运行 `/nl-sdlc:design`（显式调用架构设计智能体，智能体会跑需求流程；也可直接 `/nl-sdlc:requirement-flow 分析 docs/requirements/ 下文档`）→ 产出概要设计（3票质疑通过）、详细设计、`docs/plans/用户登录/tasks.md`。注意 feature 名由分析 agent 生成，后续命令要引用它（见 3）。
3. **开发**：`/nl-sdlc:dev-flow 用户登录`（编排模式：worktree 隔离并行，见 4.1）或交互式编码；质量门不过自动打回修复。
4. **评审**：`/nl-sdlc:review`；人工在 MR 上批准。
5. **测试**：编写 `tests/api/*.postman_collection.json` 与 `tests/e2e/*.spec.ts`（用例编写见 6.1），运行 `/nl-sdlc:test --base-url <测试环境地址>`（交互式，teams 并行；也可 `/nl-sdlc:test-flow --base-url <地址>` 走确定性流程）。
6. **交付**：`/nl-sdlc:ship` 做最终质量门与测试 → CI 绿灯 → 人工批准合并。
7. **镜像**：CI 的 docker stage 全绿后自动构建并推送镜像。

首次跑完整个流程通常需要较长时间（3票质疑、全量质量门、测试都是实打实的执行），预留充足时间。

---

## 3. 需求阶段：`/nl-sdlc:requirement-flow`

**步骤：**

1. 把需求文档（Markdown）放入 `docs/requirements/`。
2. 运行（两种入口，二选一）：

   ```
   /nl-sdlc:design
   ```

   （架构设计入口——显式调用架构设计智能体，智能体自动跑需求流程；适合把设计工作整体交给智能体）

   或直接跑 workflow：

   ```
   /nl-sdlc:requirement-flow 分析 docs/requirements/ 下文档
   ```

   或指定文件：`/nl-sdlc:requirement-flow 分析 docs/requirements/用户登录.md`

3. 流程自动执行：需求分析 → 概要设计 → **3票质疑**（三个视角并行评审设计，≥2/3 通过才算过；每轮未过会修订设计重投，最多 3 轮投票/2 次修订）→ 详细设计 + 任务列表。

**检查产物：**

| 产物 | 路径 |
|---|---|
| 概要设计 | `docs/designs/YYYY-MM-DD-<feature>-design.md` |
| 详细设计 | `docs/plans/<feature>/详细设计.md` |
| 任务列表 | `docs/plans/<feature>/tasks.md` |

**注意：**
- **feature 名是分析 agent 自动生成的**（如"用户登录"），并直接用作 `docs/plans/<feature>/` 目录名——后续 `/nl-sdlc:dev-flow <feature>` 必须与之一致。跑完需求 workflow 后先看产物目录名，再决定开发命令的参数。
- 3 票质疑 3 轮仍不通过时，流程在会话中输出分歧报告并停下，需人工决策（报告是会话返回值，不落盘）。
- `tasks.md` 的 frontmatter 含任务数组（依赖、验收标准、测试用例清单），是开发阶段的输入，不要手工删改字段。

---

## 4. 开发阶段

### 4.1 编排模式：`/nl-sdlc:dev-flow`

```bash
/nl-sdlc:dev-flow 用户登录
```

由主 agent 编排（不再是单个长 workflow）：

1. 读 `docs/plans/<feature>/tasks.md`，跑 `node scripts/topo-levels.mjs` 按 `deps` 拓扑分层（依赖缺失/成环直接报错停下）。
2. **逐层开发，worktree 隔离**：每个任务一个 `.claude/worktrees/<feature>-<task-id>`（分支 `dev/<feature>/<task-id>`），同层任务并行跑 `dev-task` 单任务 workflow——内部依次 TDD 编码 → 质量门（worktree 内全量 `--scope all`，不过打回修复最多 2 轮）→ 三视角评审（评审范围 = 该任务分支 diff）。worktree 内自动补依赖（有 `package.json` 跑 `npm ci`；Maven 走全局 `~/.m2` 无需安装）并复制 `.env` 等未跟踪文件。
3. 每个任务过门后由主 agent 合回当前分支并删除 worktree；依赖任务等前置合回后从新 tip 建 worktree。门未过的任务保留 worktree，可按报告中的 args 重跑。
4. 全部完成后主树重新生成覆盖率产物并跑一次收尾全量门，汇总各任务评审清单（Critical 置顶）。

纯文档/说明类任务（不产生代码改动）自动跳过质量门与评审。合入的是当前分支（与旧版直接提交到当前分支的行为一致）；交付合并前仍需人工批准（见第 5 节）。

### 4.2 交互式模式：`/nl-sdlc:code`

适合手工推进：agent 按 `nl-sdlc:coding` 技能做 TDD 编码，每任务完成前跑 `bash scripts/quality-gate.sh`，全绿才提交。

若启用了 agent-teams：主会话会生成 dev 队友并行认领任务；队友收工前 TeammateIdle hook 强制跑质量门，未过门自动打回继续修。**注意**：hook 固定跑 `--scope all`——单仓（前后端同仓）时队友只改后端，也可能因前端尚未生成覆盖率报告被打回；两侧的覆盖率报告都要先生成好。

### 4.3 手动跑质量门

```bash
bash scripts/quality-gate.sh --scope backend    # 只看后端
bash scripts/quality-gate.sh --scope frontend   # 只看前端
bash scripts/quality-gate.sh --scope all        # 全量（默认）
```

- 必须在含 `pom.xml`（后端）或 `package.json`（前端）的目录执行。
- 退出码：`0`=通过；`1`=有门不过；`2`=环境/配置错误（不在项目目录、mvn/npm 缺失、非法参数）。
- **注意退出码 2 的双层语义**：脚本 exit 2 = 环境问题（TeammateIdle/TaskCompleted hook 遇到它会放行）；hook exit 2 = 打回/阻止完成。看到"exit 2"先分清是哪个层级。
- 失败详情看 stdout 的 JSON：`checks[].details` 与 `checks[].suggestions` 给修复指引；覆盖率失败看 `coverage.hint`。**前后端同仓（monorepo）时报告是嵌套形态**：顶层只有 `overall/backend/frontend`，`checks` 与 `coverage` 在各子对象下（如 `backend.checks[]`）。
- **先跑覆盖率报告**：脚本只读现成报告，不生成——后端先 `mvn test jacoco:report`（生成 `target/site/jacoco/jacoco.csv`），前端先 `npx vitest run --coverage`（生成 `coverage/coverage-summary.json`），否则覆盖率门必然失败。
- 阈值：Java 行覆盖率 ≥80%、Vue ≥70%。修改项目根的 `quality-gate.yaml` 后自动生效（脚本默认查找项目根 `quality-gate.yaml`，其次 `templates/config/quality-gate.yaml`；也可 `--thresholds <文件>` 显式指定）。注意 CI 侧阈值在 pom.xml jacoco rules / vitest 配置中，两处保持同步。

---

## 5. 评审与交付

### 5.1 评审：`/nl-sdlc:review`

按 `nl-sdlc:code-review` 技能做五轴评审（正确性/可读性/架构/安全/测试充分性），输出分级问题清单（Critical/Major/Minor/Nit）。

若启用了 agent-teams：生成 3 个 review 队友（正确性/安全/性能视角）**并行评审并互相质疑**对方发现，主会话合并为一份分级问题清单——比单视角评审更全面。

**规则：** Critical 问题必须修复后才能进入人工批准环节；评审报告以 MR 评论或 `docs/reviews/` 形式留存。

### 5.2 交付：`/nl-sdlc:ship`

1. 全量跑质量门与测试。
2. 确认评审无未修复 Critical。
3. 创建/更新 MR：描述含变更清单、质量门结果、测试结果、评审结论、遗留问题。
4. **人工批准后合并**——合并决定权在人；批准前确认 CI 的质量门与测试 job 绿灯（GitLab 是 quality/test 两个 stage；Jenkins 是顺序 stage；GitHub Actions 是并行 job，确认全部绿且 docker-build 成功）。

---

## 6. 测试阶段：`/nl-sdlc:test` 与 `/nl-sdlc:test-flow`

### 6.1 用例编写（按 `nl-sdlc:testing` 技能规范）

注意区分两类测试：**单元测试**（JUnit/Vitest，开发阶段按 TDD 编写，进质量门覆盖率统计）与**验收用例**（Newman/Playwright，本节内容，测试阶段执行）。

**接口测试**（Postman collection，存 `tests/api/`）：

- 文件名：`tests/api/<feature>.postman_collection.json`；环境文件 `tests/api/<env>.postman_environment.json`。
- 请求命名含验收标准编号：`AC-xx 描述`。
- 当前 `run-tests.sh` 不传 `-e` 环境文件——请求地址用 collection 内变量或直接写测试环境地址。

**E2E**（Playwright，存 `tests/e2e/`）：

- 文件名：`tests/e2e/<feature>.spec.ts`——**必须放在 `tests/e2e/` 顶层**（不递归匹配），**必须 `.spec.ts` 后缀**。
- 每个用例必须可从 `baseUrl` 独立运行，不依赖执行顺序。

### 6.2 执行（两个入口）

**交互式（推荐，启用 teams 时并行）**：

```bash
/nl-sdlc:test --base-url http://测试环境:8080
```

调用 testing skill；启用 agent-teams 时生成 test 队友并行执行接口/E2E，否则回退到下面的 workflow。

**确定性流程**：

```bash
/nl-sdlc:test-flow --base-url http://测试环境:8080
```

workflow 读取命令后的 `--base-url <url>` 参数，自动执行：Newman 接口测试 → Playwright E2E（无头）→ 失败用例自动诊断（服务 bug 打回开发 / 用例问题修用例重跑，各最多 2 轮）。

### 6.3 手动跑测试

```bash
bash scripts/run-tests.sh --api --e2e --base-url http://localhost:8080
```

- 必须显式传 `--api` / `--e2e`（至少一个）——**没传 `--e2e` 时 E2E 静默跳过且无警告**。
- 跳过（带 warnings 说明，退出码 0，注意查看）的情况：工具不可用（`npm i -g newman`；`npm i -D @playwright/test`，本地依赖也支持）、`tests/api/` 无 collection、`tests/e2e/` 无 `.spec.ts`。
- 退出码：`0`=通过/跳过；`1`=有用例失败；`2`=参数错误。

---

## 7. CI/CD 与 Docker 镜像

### 7.1 接入 CI

从 `templates/ci/` 选择流水线模板复制到项目：

| CI 系统 | 文件 | 做法与前提 |
|---|---|---|
| GitLab CI | `gitlab-ci.yml` | 复制为项目根 `.gitlab-ci.yml`；runner 需 docker 执行器 |
| Jenkins | `Jenkinsfile` | 置于项目根；需 Docker Pipeline 插件、可跑 docker 的 agent（docker.sock 由 agent 配置提供）、JUnit 插件；镜像推送前需自行配置 registry 登录凭据 |
| GitHub Actions | `github-actions.yml` | 放入 `.github/workflows/`；推送到 ghcr.io（自动登录） |

流水线：`quality`（质量门，任一不过即红）→ `test`（Newman + Playwright 无头）→ `docker`（仅前两步全绿后构建推送；GHA 为并行 job 由 docker-build 的 needs 聚合）。

**注意：**
- CI 模板内联命令与插件脚本判定口径一致（同命令同阈值）；CI 不自动改代码。
- **本地与 CI 对"无用例"的态度不同**：`run-tests.sh` 无 collection/spec 时跳过并 warning（退出码 0），而 CI 模板直接跑 `newman run tests/api/*.postman_collection.json` / `npx playwright test`，无匹配文件会失败。上线前确保用例文件已提交。
- `ai-report` job：**仅 GitLab 模板**有（默认注释掉，启用需配置 `ANTHROPIC_API_KEY`）；Jenkins 模板只有一行注释掉的凭据声明（启用前先在 Jenkins 建 Secret text 凭据 `anthropic-api-key`）；GHA 模板没有此 job。
- 推送地址与凭据按团队仓库调整（GHA 用 ghcr.io 时仓库名需小写）。

### 7.2 Docker 镜像

- Java 后端：`templates/docker/Dockerfile.java`（Maven 多阶段构建 → JRE 精简镜像）。
- Vue 前端：`templates/docker/Dockerfile.vue` + `nginx.conf`（Node 构建 → Nginx 静态镜像，含 SPA 路由）。
- **构建约定**：以**项目根为构建上下文** + `-f templates/docker/Dockerfile.*`；`templates/` 目录结构原位保留，不要拍平、不要只复制 Dockerfile 到别处。
- 注意 `.dockerignore`：若项目配置了它，确保没有排除 `templates/`。
- 镜像标签（三套 CI 口径不同）：GitLab `:{tag 或短 commit}`；Jenkins `:{BUILD_NUMBER}-{commit 前 7 位}`；GHA `:{分支名}-{commit 完整 sha}`。
- **docker stage 仅在 main 分支/tag 触发**（GitLab `only: [main, tags]`、Jenkins `when { branch 'main' }`、GHA `if: refs/heads/main`）——MR 上不会出镜像，合并到 main 后才有。
- `Dockerfile.java` 假定**单模块 Maven**（`COPY pom.xml` + `COPY src` + 单个 `target/*.jar`）；多模块项目需自行调整。

---

## 8. 目录与产物速查

| 目录/文件 | 用途 |
|---|---|
| `docs/requirements/` | 需求文档（Markdown），需求阶段的输入 |
| `docs/designs/` | 概要设计产物 |
| `docs/plans/<feature>/` | 详细设计.md + tasks.md |
| `tests/api/` | Postman collection + 环境文件 |
| `tests/e2e/` | Playwright spec（仅顶层 .spec.ts） |
| `scripts/quality-gate.sh` | 质量门统一入口（复制到项目根） |
| `scripts/run-tests.sh` | 测试统一入口（复制到项目根） |
| `quality-gate.yaml` | 阈值配置（项目根，自动查找） |
| `templates/ci/` | 三套 CI 流水线模板 |
| `templates/docker/` | Dockerfile 模板 + nginx.conf |
| `references/` | DoD / 安全检查清单 / 测试检查清单 |

---

## 9. 常见问题排查

| 现象 | 处理 |
|---|---|
| 质量门一直打回 | 看 JSON 输出的 `checks[].details` 与 `checks[].suggestions`（各门失败时给出具体命令）；覆盖率失败看 `coverage.hint`。多数细节问题需自跑底层工具看完整输出：`mvn checkstyle:check`、`mvn spotbugs:check`、`npm run lint`、`npx vue-tsc --noEmit`、`npm audit` |
| 覆盖率门必失败 | 先跑 `mvn test jacoco:report` / `npx vitest run --coverage` 生成报告再跑质量门（见 4.3） |
| `bash scripts/quality-gate.sh` 找不到文件 | 未做资产落地（见 1.3）；把插件仓库的 `scripts/` 复制进项目 |
| 非项目目录报 exit 2 | 在项目根（有 pom.xml 或 package.json 的目录）执行 |
| 接口测试被跳过 | `npm i -g newman` 或加本地 devDependency；确认 `tests/api/` 有 collection |
| E2E 被跳过 | 三种原因：没传 `--e2e`（静默跳过）；playwright 不可用（`npm i -D @playwright/test`）；`tests/e2e/` 顶层没有 `.spec.ts` |
| E2E 失败但用例写对了 | 检查 `playwright.config.ts` 的 baseURL 是否读 `process.env.PLAYWRIGHT_BASE_URL`——否则 `--base-url` 不生效 |
| 本地测试绿、CI 红 | 本地无用例文件时跳过不失败、CI 无匹配文件会失败（见 7.1）；确保用例已提交 |
| 改了 quality-gate.yaml 不生效 | 确认文件在项目根；CI 侧阈值在 pom.xml jacoco rules / vitest 配置中，两处同步 |
| agent-teams 队友卡住/失败 | 直接运行 `/nl-sdlc:dev-flow <feature>` 重跑（已合回任务自动跳过，见 4.1；实验性功能的兜底路径） |
| dev-task 门未过想重跑 | 以报告中附的相同 args 再调一次 dev-task（复用保留的 worktree，基于现状继续） |
| 3票质疑一直不通过 | 查看会话中输出的分歧报告，按质疑修订需求/设计后重新运行 |
| `/nl-sdlc:dev-flow 找不到任务` | feature 名与需求阶段产物目录名不一致——以 `docs/plans/` 下实际目录名为准 |
| 覆盖率不达标 | 补齐单元测试；阈值调整改 `quality-gate.yaml`（CI 侧同步） |

---

## 附：实验性声明

- agent-teams 依赖 Claude Code 实验特性（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`），存在会话无法恢复等已知限制；workflow 路径是稳定的兜底方案。
- 三个 workflow（requirement/development/test）为确定性的核心路径；agent-teams 为交互式增强，两者产物互通。
