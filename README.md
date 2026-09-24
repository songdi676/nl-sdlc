# nl-sdlc

AI Agent 驱动的 SDLC 全流程自动化插件：需求 → 编码 → 评审 → 测试 → CI/CD。
面向 Java(Maven) + Vue 3 技术栈。

## 安装

```bash
claude plugin marketplace add .claude-plugin/marketplace.json
claude plugin install nl-sdlc@nl-sdlc-marketplace
```

## 启用 agent-teams（实验性，可选）

在 settings.json 中设置 `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`。
Windows 使用 in-process 模式。团队协作失败时回退：直接运行 `/nl-sdlc:development` 重跑。

## 使用

| 命令 | 作用 |
|---|---|
| `/nl-sdlc:requirement` | 需求分析 → 概要设计（3票质疑，2/3 通过）→ 详细设计 + tasks.md |
| `/nl-sdlc:development` | 按 tasks.md 编码 → 质量门打回循环 → 三视角评审 |
| `/nl-sdlc:test` | Newman 接口测试 + Playwright E2E，失败诊断与修复 |
| `/nl-sdlc:code` | 交互式单阶段入口：编码 |
| `/nl-sdlc:review` | 交互式单阶段入口：评审 |
| `/nl-sdlc:ship` | 交互式单阶段入口：发布 |

E2E 用例运行时，`playwright.config.ts` 应读 `process.env.PLAYWRIGHT_BASE_URL` 作为 baseURL（`--base-url` 通过该环境变量传递）。

## 质量门（默认阈值，`templates/config/quality-gate.yaml` 可调）

Java: checkstyle(P3C) 0 违规 · spotbugs 0 高危/中危 · jacoco ≥80% · 无高危依赖漏洞
Vue: ESLint 0 error · vue-tsc 通过 · Vitest ≥70% · npm audit 无高危

阈值配置口径与 `scripts/quality-gate.sh` 一致：Java 覆盖率阈值需在 pom.xml 的 jacoco rules 配置（checkstyle 用阿里 P3C，需在 pom 配置规则）；Vue 覆盖率阈值在 vitest 配置。

## CI 集成

复制 `templates/ci/` 下对应模板到项目（GitLab CI / Jenkins / GitHub Actions）。
CI 硬关卡 = quality + test 两个 stage；`ai-report` job 可选开启（失败时 AI 诊断，需配置 ANTHROPIC_API_KEY）。CI 不自动改代码。

CI 模板内联命令与插件 `scripts/quality-gate.sh`、`scripts/run-tests.sh` 的判定口径一致；阈值配置见 `templates/config/quality-gate.yaml`。

CI 模板的 docker build 以项目根为构建上下文，并用 `-f templates/docker/Dockerfile.*` 指定 Dockerfile，因此 `templates/` 目录结构需原位保留（不得拍平）。`templates/ci/` 与 `templates/docker/` 复制到项目后按模板头部注释使用；模板自包含运行。

## 实验性声明

agent-teams 功能依赖 Claude Code 实验特性（CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1），
存在会话无法恢复等已知限制；workflow 路径是稳定的兜底方案。
