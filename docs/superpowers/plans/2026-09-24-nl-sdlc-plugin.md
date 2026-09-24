# nl-sdlc 插件实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 构建 nl-sdlc Claude Code 插件——AI Agent 驱动的 SDLC 全流程自动化（需求→编码→评审→测试→CI/CD），面向 Java(Maven)+Vue 3 团队。

**架构：** 经典三层（Skill 教怎么做 → Persona 谁来做 → Command/Workflow 何时编排）为基座；3 个原生 workflow 脚本承担确定性编排（需求/开发/测试），交互式与 CI 无头共用；agent-teams 作为交互式并行增强（实验性，关键路径外）；hooks 强制质量门与元技能注入；质量门与测试脚本 CI 无关，配三套流水线模板。

**技术栈：** Claude Code 插件格式（plugin.json + agents/skills/commands/workflows/hooks）、原生 Workflow JS 脚本（agent()/pipeline()/parallel()/phase()）、bash 脚本（Git Bash，Windows 兼容）、Node.js（校验脚本）、Maven(checkstyle/spotbugs/jacoco/Dependency-Check)、Vue 3(ESLint/vue-tsc/Vitest)、Newman、Playwright。

**Spec:** `docs/superpowers/specs/2026-09-24-nl-sdlc-plugin-design.md` —— 本计划逐条实现该 spec，执行者须同时阅读两者。

## 全局约束

以下约束来自 spec，适用于每个任务：

- **资产语言**：所有 frontmatter 的 `name`/`description` 用英文（触发路由），正文与用户可见文案用中文
- **skill 命名**：kebab-case，目录名 = name，SKILL.md 大写；description 第三人称 + "Use when" 开头、只写触发条件不写流程摘要，总长 < 1024 字符
- **agent persona 禁止互调**：persona 只能被 workflow/命令/主 agent 调用；persona 正文结尾带 `## Composition` 块（何时直接调/经何命令调/禁止从其他 persona 调）
- **质量门阈值**（默认值，`templates/config/quality-gate.yaml` 可覆盖）：Java：checkstyle 阿里 P3C 0 违规、spotbugs(含 FindSecBugs) 0 高危/中危、jacoco 行覆盖 ≥ 80%、Dependency-Check 无高危漏洞；Vue 3：ESLint 0 error、vue-tsc 通过、Vitest 覆盖率 ≥ 70%、npm audit 无高危
- **打回循环**：质量门失败 → fix → 重跑，连续 2 轮无进展 → 任务失败 + 诊断
- **3票质疑**：≥ 2/3 多数通过，最多 3 轮修订，3 轮不过输出分歧报告转人工
- **CI 原则**：CI 直接跑脚本过硬关卡（不需 AI 密钥）；AI 只做可选诊断报告（默认关闭）；CI 不自动改代码
- **hooks 优雅降级**：依赖缺失/环境不满足时输出说明性 JSON 并 exit 0，绝不阻塞会话
- **薄壳命令**：`disable-model-invocation: true`，正文一行 "Invoke the nl-sdlc:<skill> skill and follow it exactly"
- **产物路径**：需求 workflow 产出 `docs/designs/YYYY-MM-DD-<feature>-design.md`（概要设计）、`docs/plans/<feature>/详细设计.md`、`docs/plans/<feature>/tasks.md`
- **行尾**：`.gitattributes` 强制 `*.sh *.md *.json *.js *.yaml *.yml` 为 LF
- **Windows**：所有 .sh 按 Git Bash 语法编写（Claude Code 2.1.x 在 Windows 自动用 bash 执行）；所有测试命令在 Git Bash 下运行

## Review Focus

spec 未显式规定、但最容易咬人的五类输入（每条对应任务的测试已注明）：

1. **tasks.md 缺字段/格式错误** → development workflow 必须报错并指明文件与缺失字段，不得静默跳过任务（测试在 Task 15）
2. **仓库同时含 pom.xml 与 package.json（前后端同仓）** → quality-gate.sh 默认两者都查，`--scope` 可限定单侧（测试在 Task 12）
3. **Newman/Playwright 未安装** → run-tests.sh 输出说明性 JSON 并以 exit 0 警告退出，不崩溃（测试在 Task 13）
4. **阈值配置文件缺失或含非法值** → quality-gate.sh 回退内置默认值并在报告加 warning 字段（测试在 Task 12）
5. **质疑投票 agent 调用失败（返回 null）** → 该票记弃权（tallyVotes 按有效票的 2/3 计）；有效票 <2 该轮 deadlock，继续修订循环；3 轮封顶仍不通过（含死锁轮）→ 分歧报告转人工（tallyVotes 纯函数单测在 Task 14）

---

### Task 1: 插件骨架与元数据

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `.gitattributes`
- Create: `agents/.gitkeep`, `skills/.gitkeep`, `commands/.gitkeep`, `workflows/.gitkeep`, `hooks/.gitkeep`, `references/.gitkeep`, `scripts/.gitkeep`, `templates/ci/.gitkeep`, `templates/docker/.gitkeep`, `templates/config/.gitkeep`（占位，后续任务写入真实文件）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: 插件名 `nl-sdlc`（后续所有命令/工作流命名空间）、目录约定（后续任务按此写文件）

- [ ] **Step 1: 写 plugin.json**

```json
{
  "name": "nl-sdlc",
  "description": "AI Agent 驱动的 SDLC 全流程自动化插件：需求→编码→评审→测试→CI/CD，面向 Java(Maven)+Vue 3 团队",
  "version": "0.1.0",
  "author": { "name": "NewLand" },
  "license": "MIT",
  "keywords": ["sdlc", "java", "maven", "vue", "ci", "workflow", "quality-gate", "agent-teams"]
}
```

- [ ] **Step 2: 写 marketplace.json（本地自举，供 `/plugin install` 验证）**

```json
{
  "name": "nl-sdlc-marketplace",
  "owner": { "name": "NewLand" },
  "plugins": [
    { "name": "nl-sdlc", "source": "./", "description": "AI Agent 驱动的 SDLC 全流程自动化插件" }
  ]
}
```

- [ ] **Step 3: 写 .gitattributes**

```
* text=auto
*.sh text eol=lf
*.md text eol=lf
*.json text eol=lf
*.js text eol=lf
*.yaml text eol=lf
*.yml text eol=lf
```

- [ ] **Step 4: 创建全部占位目录文件**

Run: `for d in agents skills commands workflows hooks references scripts templates/ci templates/docker templates/config; do mkdir -p "$d"; touch "$d/.gitkeep"; done`

- [ ] **Step 5: 校验插件结构**

Run: `claude plugin validate .`
Expected: 输出通过，无错误。

- [ ] **Step 6: Commit**

```bash
git add .claude-plugin .gitattributes agents skills commands workflows hooks references scripts templates
git commit -m "chore: nl-sdlc 插件骨架与元数据"
```

---

### Task 2: 资产校验脚本 validate-plugin.mjs

**Files:**
- Create: `scripts/validate-plugin.mjs`
- Create: `scripts/validate-plugin-test.mjs`（node:test 测试）
- Modify: `package.json`（新增，声明 type=module、test 脚本）

**Interfaces:**
- Consumes: 无
- Produces: `node scripts/validate-plugin.mjs` → 退出码 0=通过/1=失败，失败时逐条打印 `文件: 行: 错误`。后续所有资产任务（Task 3–20）的测试步骤都运行它。

- [ ] **Step 1: 写失败测试（TDD）**

`scripts/validate-plugin-test.mjs`：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (args = [], cwd = root) =>
  execFileSync(process.execPath, [join(root, 'scripts/validate-plugin.mjs'), ...args], { cwd, encoding: 'utf8' });

test('合法资产目录全部通过', () => {
  const out = run();
  assert.match(out, /PASS/);
});

test('skill 缺 description 报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
  mkdirSync(join(dir, 'skills/bad-skill'), { recursive: true });
  writeFileSync(join(dir, 'skills/bad-skill/SKILL.md'), '---\nname: bad-skill\n---\n# bad\n');
  assert.throws(() => run([], dir), /bad-skill.*description/);
  rmSync(dir, { recursive: true, force: true });
});

test('description 非 Use when 开头报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
  mkdirSync(join(dir, 'skills/bad-desc'), { recursive: true });
  writeFileSync(join(dir, 'skills/bad-desc/SKILL.md'), '---\nname: bad-desc\ndescription: do stuff\n---\n# bad\n');
  assert.throws(() => run([], dir), /Use when/);
  rmSync(dir, { recursive: true, force: true });
});

test('agent 缺 name 报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents/x.md'), '---\ndescription: hi\n---\nbody\n');
  assert.throws(() => run([], dir), /x\.md.*name/);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test scripts/validate-plugin-test.mjs`
Expected: FAIL——`validate-plugin.mjs` 不存在。

- [ ] **Step 3: 实现校验脚本**

`scripts/validate-plugin.mjs`（校验目标目录默认取仓库根，可传参数覆盖，便于测试注入临时目录）：

```javascript
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const target = process.argv[2] ?? '.';
const errors = [];
const ok = (msg) => console.log(`PASS ${msg}`);
const err = (file, line, msg) => errors.push(`${file}: ${line ?? '?'}: ${msg}`);

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const raw = text.slice(4, end);
  const fm = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const files = walk(target).filter((f) => !f.includes('node_modules') && !f.includes('.git/'));
const skills = files.filter((f) => /[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/.test(f));
const agents = files.filter((f) => /[\\/]agents[\\/].+\.md$/.test(f));
const commands = files.filter((f) => /[\\/]commands[\\/].+\.md$/.test(f));
const workflows = files.filter((f) => /[\\/]workflows[\\/].+\.js$/.test(f));

for (const f of skills) {
  const fm = parseFrontmatter(readFileSync(f, 'utf8'));
  if (!fm) { err(f, 1, '缺少 frontmatter'); continue; }
  if (!fm.name) err(f, 1, 'SKILL.md 缺少 name');
  if (!fm.description) err(f, 1, 'SKILL.md 缺少 description');
  else {
    if (!fm.description.startsWith('Use when')) err(f, 2, 'description 必须以 Use when 开头');
    if (fm.description.length > 1024) err(f, 2, `description 超过 1024 字符（当前 ${fm.description.length}）`);
  }
  const dirName = f.split(/[\\/]/).slice(-2, -1)[0];
  if (fm.name !== dirName) err(f, 2, `name(${fm.name}) 与目录名(${dirName}) 不一致`);
}

for (const f of agents) {
  const fm = parseFrontmatter(readFileSync(f, 'utf8'));
  if (!fm) { err(f, 1, '缺少 frontmatter'); continue; }
  if (!fm.name) err(f, 1, 'agent 缺少 name');
  if (!fm.description) err(f, 1, 'agent 缺少 description');
  const body = readFileSync(f, 'utf8');
  if (!body.includes('## Composition')) err(f, '?', 'agent 正文缺少 ## Composition 块');
}

for (const f of commands) {
  const fm = parseFrontmatter(readFileSync(f, 'utf8'));
  if (!fm || !fm.description) err(f, 1, '命令缺少 frontmatter description');
  if (fm['disable-model-invocation'] !== 'true') err(f, 2, '薄壳命令必须设置 disable-model-invocation: true');
}

for (const f of workflows) {
  const text = readFileSync(f, 'utf8');
  if (!text.trimStart().startsWith('export const meta')) err(f, 1, 'workflow 必须以 export const meta 开头');
  if (!/meta\s*=\s*\{/.test(text) || !/name:\s*['"]/.test(text) || !/description:\s*['"]/.test(text))
    err(f, 1, 'workflow meta 块必须含 name 与 description');
  if (text.includes('import(')) err(f, 1, 'workflow 脚本禁止动态 import()');
}

if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`FAIL ${errors.length} 处问题`);
  process.exit(1);
}
ok(`校验通过: ${skills.length} skills, ${agents.length} agents, ${commands.length} commands, ${workflows.length} workflows`);
```

- [ ] **Step 4: 写 package.json 并运行测试确认通过**

```json
{ "name": "nl-sdlc", "private": true, "type": "module", "scripts": { "test": "node --test scripts/validate-plugin-test.mjs" } }
```

Run: `node --test scripts/validate-plugin-test.mjs`
Expected: PASS（3 个测试全过）。再 Run: `node scripts/validate-plugin.mjs` → 应输出 `PASS 校验通过: 0 skills, 0 agents...`（资产还没写，0 不报错）。

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-plugin.mjs scripts/validate-plugin-test.mjs package.json
git commit -m "test: 资产校验脚本（skills/agents/commands/workflows 结构校验）"
```

---

### Task 3: using-nl-sdlc 元技能（任务路由）

**Files:**
- Create: `skills/using-nl-sdlc/SKILL.md`

**Interfaces:**
- Consumes: 无
- Produces: skill 名 `using-nl-sdlc`——SessionStart hook（Task 17）注入其全文；它引用后续 skill 名：`requirement-analysis`、`coding`、`code-review`、`testing`、`delivery` 与 workflow 命令 `/nl-sdlc:requirement`、`/nl-sdlc:development`、`/nl-sdlc:test`（引用即可，被引用者稍后创建）。

- [ ] **Step 1: 写 SKILL.md**

frontmatter 与正文如下（正文节骨架 + 各节必含内容）：

```markdown
---
name: using-nl-sdlc
description: Use when starting any SDLC work in this repo - routes the task to the correct nl-sdlc phase (requirement, coding, review, testing, delivery) and enforces the corresponding skill or workflow
---

# nl-sdlc 任务路由

## Overview

本插件将 SDLC 分为需求→编码→评审→测试→交付五个阶段。任何开发任务必须先判断所处阶段，再调用对应 skill 或 workflow。质量门（checkstyle/spotbugs/覆盖率/安全）是编码完成的前置条件，测试通过是交付的前置条件——不存在跳过路径。

## 路由表

| 用户意图 | 调用 |
|---|---|
| 分析新需求 / 出设计 / 拆任务 | `/nl-sdlc:requirement` workflow |
| 按任务编码 / 修复打回问题 | 本 skill 的「编码」节 → `nl-sdlc:coding` skill |
| 评审代码 / 安全审查 | `nl-sdlc:code-review` skill |
| 接口测试 / E2E / 修测试用例 | `/nl-sdlc:test` workflow |
| 合并 / 交付 | `nl-sdlc:delivery` skill |

## 编码节（交互式开发会话）

1. 确认 `docs/plans/<feature>/tasks.md` 与 `详细设计.md` 存在；不存在则先跑 `/nl-sdlc:requirement`
2. 遵循 `nl-sdlc:coding` skill 做 TDD 编码
3. 每个任务完成前运行 `bash scripts/quality-gate.sh`，未过门必须修复，禁止提交未过门代码
4. 若启用 agent-teams（`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）：从 tasks.md 建共享任务列表，生成 dev 队友并行认领，质量门由 TeammateIdle hook 强制

## Red Flags

| 想法 | 现实 |
|---|---|
| "这个改动太小，不用过质量门" | 质量门对所有代码生效，无例外 |
| "测试以后再补" | 测试是任务完成定义的一部分 |
| "直接改代码就行" | 无 tasks.md 的改动先走需求阶段 |

## Integration

编码完成且质量门全绿 → 进入 `nl-sdlc:code-review`；评审通过且人工批准 → `nl-sdlc:delivery`。
```

- [ ] **Step 2: 运行校验**

Run: `node scripts/validate-plugin.mjs`
Expected: PASS 且 skills 计数为 1。

- [ ] **Step 3: Commit**

```bash
git add skills/using-nl-sdlc
git commit -m "feat: using-nl-sdlc 元技能（SDLC 阶段路由）"
```

---

### Task 4: requirement-analysis skill（需求分析）

**Files:**
- Create: `skills/requirement-analysis/SKILL.md`

**Interfaces:**
- Consumes: 需求文档位于 `docs/requirements/*.md`
- Produces: skill 名 `requirement-analysis`；被 `/nl-sdlc:requirement` workflow（Task 14）以文本引用，作为其需求分析 agent 的工作规范

- [ ] **Step 1: 写 SKILL.md（frontmatter + 章节骨架 + 各节必含要点）**

```markdown
---
name: requirement-analysis
description: Use when analyzing requirement documents in docs/requirements/ or producing structured requirements, acceptance criteria, or a requirements summary for a feature
---

# 需求分析

## Overview

把仓库内 `docs/requirements/` 的 Markdown 需求文档转成结构化需求：用户故事、验收标准、非功能需求，作为概要设计的输入。分析必须忠实于原文，禁止臆造原文没有的需求。

## 流程

1. 列出 `docs/requirements/` 下相关 .md 文档（用户可指定文件名）
2. 逐份通读，按模块归并
3. 输出结构化需求，每项标注来源文件与章节
4. 对原文含糊处，列出「待澄清问题清单」附在输出末尾，不得自行假设答案

## 输出格式

- 用户故事：`作为 <角色>，我想 <目标>，以便 <价值>`，每条带唯一编号 US-01…
- 验收标准：每条可验证（能写出对应的测试断言），编号 AC-01… 并与用户故事关联
- 非功能需求：性能/安全/兼容性，可量化则给出数值

## Red Flags

| 想法 | 现实 |
|---|---|
| "文档没写清楚，我自己补合理假设" | 假设进待澄清清单，不许直接写进需求 |
| "顺手把范围扩大一点" | 分析不改需求范围，扩范围是人的决定 |

## Verification

- 每条验收标准都能映射到至少一个测试用例
- 每条用户故事都有来源标注
```

- [ ] **Step 2: 运行校验**

Run: `node scripts/validate-plugin.mjs`
Expected: PASS 且 skills 计数为 2。

- [ ] **Step 3: Commit**

```bash
git add skills/requirement-analysis
git commit -m "feat: requirement-analysis 技能"
```

---

### Task 5: coding skill（TDD 编码规范）

**Files:**
- Create: `skills/coding/SKILL.md`

**Interfaces:**
- Consumes: 无
- Produces: skill 名 `coding`；被 dev-engineer persona（Task 9）、using-nl-sdlc（Task 3）引用

- [ ] **Step 1: 写 SKILL.md**

```markdown
---
name: coding
description: Use when implementing any task from docs/plans/<feature>/tasks.md in Java (Maven) or Vue 3 (Vite+TypeScript), before writing implementation code
---

# TDD 编码规范

## Overview

所有编码遵循 TDD：先写失败测试 → 实现最小代码 → 测试通过 → 重构。Java 用 JUnit 5 + Mockito，Vue 用 Vitest + Vue Test Utils。未过质量门的代码不得视为完成。

## 流程

1. 读取当前任务（含验收标准与关联测试用例清单）
2. 写失败测试（JUnit 5 / Vitest）
3. 实现最小代码使测试通过
4. 重构：保持代码与 tests 目录内用例同步
5. 运行 `bash scripts/quality-gate.sh --scope <backend|frontend>`，全绿才提交

## 质量门（Java）

| 门 | 命令 | 阈值 |
|---|---|---|
| checkstyle | `mvn checkstyle:check` | 阿里 P3C，0 违规 |
| spotbugs | `mvn spotbugs:check` | 0 高危/中危 |
| 覆盖率 | `mvn test jacoco:report jacoco:check` | 行覆盖 ≥ 80% |
| 安全 | `mvn dependency-check:check` | 无高危漏洞 |

## 质量门（Vue 3）

| 门 | 命令 | 阈值 |
|---|---|---|
| ESLint | `npm run lint` | 0 error |
| 类型 | `npx vue-tsc --noEmit` | 通过 |
| 覆盖率 | `npx vitest run --coverage` | ≥ 70% |
| 依赖安全 | `npm audit --audit-level=high` | 无高危 |

## Red Flags

| 想法 | 现实 |
|---|---|
| "先写实现，测试后补" | TDD 顺序不可逆，先测后码 |
| "这行代码不用测" | 验收标准涉及的代码路径必须有用例 |
| "质量门差一点没关系" | 阈值是硬性条件，不达标打回 |

## Verification

- 每个任务关联的测试用例清单已全部落地为可运行用例
- `quality-gate.sh` 对应 scope 全绿
```

- [ ] **Step 2: 运行校验** — Run: `node scripts/validate-plugin.mjs`，Expected: PASS 且 skills 计数为 3。

- [ ] **Step 3: Commit**

```bash
git add skills/coding
git commit -m "feat: coding 技能（TDD + 质量门规范）"
```

---

### Task 6: code-review skill（评审规范）

**Files:**
- Create: `skills/code-review/SKILL.md`

**Interfaces:**
- Consumes: 无
- Produces: skill 名 `code-review`；被 code-reviewer/security-auditor persona（Task 9）与 development workflow Phase 3（Task 15）引用

- [ ] **Step 1: 写 SKILL.md**

```markdown
---
name: code-review
description: Use when reviewing code changes against tasks.md acceptance criteria and coding standards, before merge or before human approval of a merge request
---

# 代码评审

## Overview

评审围绕五个轴：正确性（对照 tasks.md 验收标准）、可读性、架构、安全、测试充分性。评审输出分级问题清单；Critical 问题必须修复后才能进入人工批准环节。评审人必须亲自读代码验证，不得信任任何二手报告。

## 流程

1. 读取 `docs/plans/<feature>/tasks.md` 中本次变更涉及任务的验收标准
2. 通读 diff 与相关文件，逐条对照验收标准
3. 按五轴检查，每个问题标注：级别（Critical/Major/Minor/Nit）、文件、行号、修复建议
4. 输出评审报告（`docs/reviews/` 或随 MR 评论），Critical > 0 则结论为 REJECT

## 输出格式

```
结论: APPROVE | REJECT
Critical: <数量>  Major: <数量>  Minor: <数量>  Nit: <数量>
- [Critical] 文件:行 — 问题描述。修复建议: …
```

## Red Flags

| 想法 | 现实 |
|---|---|
| "报告说通过了，不用细看" | 亲自读代码，报告可能是错的 |
| "Minor 问题口头说就行" | 所有问题必须落到报告，可追踪 |
| "安全类问题让安全 agent 单独看" | 评审五轴含安全，人人负责 |

## Verification

- 每条验收标准都有对应的通过/不通过结论
- 报告中每个问题可定位到文件与行
```

- [ ] **Step 2: 运行校验** — Run: `node scripts/validate-plugin.mjs`，Expected: PASS 且 skills 计数为 4。

- [ ] **Step 3: Commit**

```bash
git add skills/code-review
git commit -m "feat: code-review 技能（五轴评审规范）"
```

---

### Task 7: testing skill（测试用例治理）

**Files:**
- Create: `skills/testing/SKILL.md`

**Interfaces:**
- Consumes: 用例目录约定 `tests/api/`（Postman collection）与 `tests/e2e/`（Playwright spec）
- Produces: skill 名 `testing`；被 test-engineer persona（Task 9）、testing workflow（Task 16）引用

- [ ] **Step 1: 写 SKILL.md**

```markdown
---
name: testing
description: Use when writing, fixing, or executing API test cases (Postman/Newman under tests/api/) or end-to-end test cases (Playwright under tests/e2e/), or when diagnosing a failed test run
---

# 测试用例治理

## Overview

测试用例与代码同等管理：存仓库、版本化、可重复运行。接口测试用 Postman collection + Newman（`tests/api/`），E2E 用 Playwright TypeScript（`tests/e2e/`）。用例来源是 tasks.md 中的用例清单；每个用例可追溯到需求编号（US/AC 编号写入用例名或测试注释）。

## 编写规范

### Postman collection（tests/api/）

- 文件名：`tests/api/<feature>.postman_collection.json`，环境文件 `tests/api/<env>.postman_environment.json`
- 每个请求命名：`AC-xx 描述`（溯源验收标准）
- 断言写在 test 脚本：状态码、响应结构、关键字段
- 新建用例后运行 `npx newman run <collection> -e <env> --reporters cli,junit --reporter-junit-export build/test-results/newman/<feature>.xml` 验证

### Playwright（tests/e2e/）

- 文件：`tests/e2e/<feature>.spec.ts`，describe/test 命名含 AC 编号
- 每个用例必须能从 baseUrl 环境变量独立运行，禁止依赖其他用例的执行顺序
- 失败自动截图：playwright.config.ts 中 `use: { screenshot: 'only-on-failure', video: 'retain-on-failure' }`
- 运行：`npx playwright test`；单用例：`npx playwright test tests/e2e/<feature>.spec.ts`

## 失败诊断流程

1. 读取失败报告与截图/录像
2. 判定失败类别：**服务 bug**（响应与设计不符、报错堆栈指向服务端）→ 打回开发附诊断；**用例问题**（选择器失效、断言写错、环境配置错误）→ 修复用例后重跑
3. 修复后单用例验证通过，再全量重跑确认无回归

## Red Flags

| 想法 | 现实 |
|---|---|
| "用例失败就删掉" | 用例即资产，只修不删（除非需求已变更） |
| "接口手工点过就行" | 用例必须可重复运行，手工验证不算数 |
| "E2E 太慢跳过" | E2E 是页面功能的验收手段，在 CI 无头运行 |

## Verification

- 每个用例可追溯到 AC 编号
- 全量用例在干净环境可重复跑通
```

- [ ] **Step 2: 运行校验** — Run: `node scripts/validate-plugin.mjs`，Expected: PASS 且 skills 计数为 5。

- [ ] **Step 3: Commit**

```bash
git add skills/testing
git commit -m "feat: testing 技能（Postman/Playwright 用例治理）"
```

---

### Task 8: delivery skill（交付与人工批准）

**Files:**
- Create: `skills/delivery/SKILL.md`

**Interfaces:**
- Consumes: 评审报告、质量门报告
- Produces: skill 名 `delivery`；被 using-nl-sdlc（Task 3）引用

- [ ] **Step 1: 写 SKILL.md**

```markdown
---
name: delivery
description: Use when preparing a merge after code review passed - running final quality gates and tests, opening or updating the merge request, and documenting the human approval requirement
---

# 交付

## Overview

交付 = 最终质量门 + 测试全绿 + MR 人工批准。交付环节 AI 不代替人做合并决定：MR 必须由人工批准后才可合并。CI 的硬关卡是质量门与测试；本 skill 负责交互式会话内的交付准备。

## 流程

1. 全量跑 `bash scripts/quality-gate.sh` 与 `bash scripts/run-tests.sh`（本地或指向测试环境）
2. 确认评审报告无未修复的 Critical 问题
3. 整理变更清单（关联的任务编号、验收标准达成情况、遗留 Minor/Nit 问题清单）
4. 创建/更新 MR，描述中写入：变更清单、质量门结果、测试结果、评审结论、遗留问题
5. 明确标注：**需人工批准后合并**，并提醒审批人核查质量门与测试在 CI 的绿灯状态

## Red Flags

| 想法 | 现实 |
|---|---|
| "质量门本地过了，CI 结果不用看" | 人工批准前必须确认 CI 绿灯，两边脚本一致但环境不同 |
| "AI 可以直接合并" | 合并决定权在人，AI 只做交付准备 |

## Verification

- MR 描述含质量门/测试/评审三项结果
- 人工批准要求已明确标注
```

- [ ] **Step 2: 运行校验** — Run: `node scripts/validate-plugin.mjs`，Expected: PASS 且 skills 计数为 6。

- [ ] **Step 3: Commit**

```bash
git add skills/delivery
git commit -m "feat: delivery 技能（交付与人工批准流程）"
```

---

### Task 9: 四个 persona 定义

**Files:**
- Create: `agents/dev-engineer.md`
- Create: `agents/code-reviewer.md`
- Create: `agents/security-auditor.md`
- Create: `agents/test-engineer.md`

**Interfaces:**
- Consumes: 无
- Produces: agent 名 `dev-engineer`、`code-reviewer`、`security-auditor`、`test-engineer`——被 workflows（Task 14–16）在 `agent()` 调用中按名引用、被主 agent 生成 teammates 时按名引用

- [ ] **Step 1: 写 dev-engineer.md**

```markdown
---
name: dev-engineer
description: Use when a task from docs/plans/<feature>/tasks.md needs implementation in Java (Maven) or Vue 3 (Vite+TypeScript) following TDD
---

你是资深 Java/Vue 开发工程师。你的工作是实现 tasks.md 中分配给你的任务。

## 工作方式

1. 遵循 `nl-sdlc:coding` skill 的 TDD 流程与质量门要求
2. 只改本任务涉及的文件，不触碰其他任务的文件所有权
3. 每个任务完成前运行 `bash scripts/quality-gate.sh --scope <backend|frontend>`，全绿才算完成
4. 验收标准逐条自查，在任务报告中逐条标注达成情况

## 报告格式

任务 ID、修改文件列表、质量门结果（贴 JSON 摘要）、验收标准逐条结论、遗留问题。

## Composition

- Invoke directly when: 单个任务编码（由 lead 或 workflow 委派）
- Invoke via: `/nl-sdlc:development` workflow 的 Phase 1，或交互式 agent-teams 的 dev 队友
- Do not invoke from another persona
```

- [ ] **Step 2: 写 code-reviewer.md**

```markdown
---
name: code-reviewer
description: Use when code changes need review across five dimensions - correctness against acceptance criteria, readability, architecture, security, and test sufficiency
---

你是资深代码评审员。遵循 `nl-sdlc:code-review` skill 的五轴评审规范。

## 纪律

- 亲自读代码验证，不信任任何二手报告
- 每个问题标注：级别（Critical/Major/Minor/Nit）、文件、行号、修复建议
- 结论 APPROVE/REJECT 以 Critical 数量为准：Critical > 0 即 REJECT

## 输出格式

```
结论: APPROVE | REJECT
Critical: N  Major: N  Minor: N  Nit: N
- [级别] 文件:行 — 问题。修复建议: …
```

## Composition

- Invoke directly when: 变更评审（workflow Phase 3 或交互式 review 队友）
- Invoke via: `/nl-sdlc:development` workflow
- Do not invoke from another persona
```

- [ ] **Step 3: 写 security-auditor.md**

```markdown
---
name: security-auditor
description: Use when code needs a security audit from an OWASP Top 10 perspective, or when reviewing authentication, authorization, input validation, injection, or dependency vulnerabilities
---

你是资深安全审计员。从 OWASP Top 10 视角审查代码与依赖。

## 检查维度

1. 注入（SQL/命令/表达式）与 XSS
2. 认证与授权缺陷（越权、弱令牌）
3. 敏感数据暴露（日志、响应、配置）
4. 反序列化与 SSRF
5. 依赖漏洞（对照 Dependency-Check 报告）
6. 前端：不安全的动态渲染、存储型 XSS、敏感信息入前端包

## 输出格式

每个发现：严重级别（Critical/Major/Minor/Nit）、文件:行、攻击场景描述、修复建议。无发现时明确输出「无安全发现」。

## Composition

- Invoke directly when: 安全审查（workflow 质量门的安全部分或交互式）
- Invoke via: `/nl-sdlc:development` workflow
- Do not invoke from another persona
```

- [ ] **Step 4: 写 test-engineer.md**

```markdown
---
name: test-engineer
description: Use when writing, fixing, or diagnosing API (Postman/Newman) or E2E (Playwright) test cases under tests/api/ and tests/e2e/, or when a test run failed and needs root-cause classification
---

你是资深测试工程师。遵循 `nl-sdlc:testing` skill 的用例治理规范。

## 职责

- 按 tasks.md 的用例清单编写/维护 Postman collection 与 Playwright spec
- 诊断失败用例，严格区分**服务 bug**（打回开发，附诊断）与**用例问题**（修用例重跑）
- 用例命名含 AC 编号，保证需求双向追溯

## 输出格式

失败分类结论、根因分析、修复动作（打回/修用例）、修复后验证结果。

## Composition

- Invoke directly when: 测试用例工作（testing workflow 或交互式）
- Invoke via: `/nl-sdlc:test` workflow
- Do not invoke from another persona
```

- [ ] **Step 5: 运行校验** — Run: `node scripts/validate-plugin.mjs`，Expected: PASS 且 agents 计数为 4。

- [ ] **Step 6: Commit**

```bash
git add agents/dev-engineer.md agents/code-reviewer.md agents/security-auditor.md agents/test-engineer.md
git commit -m "feat: 四个 persona 定义（dev/review/security/test）"
```

---

### Task 10: 薄壳斜杠命令

**Files:**
- Create: `commands/code.md`
- Create: `commands/review.md`
- Create: `commands/ship.md`

**Interfaces:**
- Consumes: skill 名 `coding`、`code-review`、`delivery`（Task 5/6/8）
- Produces: 命令 `/nl-sdlc:code`、`/nl-sdlc:review`、`/nl-sdlc:ship`（workflow 命令 `/nl-sdlc:requirement|development|testing` 由 workflows 自动注册，不在此定义，避免重名）

- [ ] **Step 1: 写 commands/code.md**

```markdown
---
description: "交互式编码入口：按 tasks.md 做 TDD 编码并通过质量门"
disable-model-invocation: true
---

Invoke the nl-sdlc:coding skill and follow it exactly as presented to you
```

- [ ] **Step 2: 写 commands/review.md**

```markdown
---
description: "交互式评审入口：五轴代码评审，输出分级问题报告"
disable-model-invocation: true
---

Invoke the nl-sdlc:code-review skill and follow it exactly as presented to you
```

- [ ] **Step 3: 写 commands/ship.md**

```markdown
---
description: "交互式交付入口：最终质量门 + 测试 + MR 人工批准准备"
disable-model-invocation: true
---

Invoke the nl-sdlc:delivery skill and follow it exactly as presented to you
```

- [ ] **Step 4: 运行校验** — Run: `node scripts/validate-plugin.mjs`，Expected: PASS 且 commands 计数为 3。

- [ ] **Step 5: Commit**

```bash
git add commands
git commit -m "feat: 薄壳斜杠命令（code/review/ship）"
```

---

### Task 11: quality-gate.sh —— 报告 schema 与 Java 门

**Files:**
- Create: `scripts/quality-gate.sh`
- Create: `scripts/quality-gate-test.sh`（bash 测试）
- Modify: `scripts/validate-plugin.mjs`（无需改；本任务测试用 bash）

**Interfaces:**
- Consumes: 无
- Produces（后续任务依赖的精确接口）:
  - 调用约定：`bash scripts/quality-gate.sh [--scope backend|frontend|all] [--thresholds <yaml>] [--stub-dir <dir>]`
  - stdout 输出**唯一一个** JSON 报告对象；退出码 0=pass、1=fail、2=环境/配置错误
  - JSON 报告 schema（全插件唯一权威格式）:
    - 单侧运行（`--scope backend|frontend`，或 `all` 但仓库只有一侧）:
      ```json
      {
        "overall": "pass" | "fail",
        "scope": "backend" | "frontend" | "all",
        "project_type": "maven" | "vue" | "none",
        "warnings": ["..."],
        "checks": [
          { "name": "checkstyle", "status": "pass" | "fail" | "skipped", "details": "...", "suggestions": ["..."] }
        ],
        "coverage": { "line": 82.5, "threshold": 80, "status": "pass" | "fail" }
      }
      ```
    - `--scope all` 且前后端同仓（pom.xml 与 package.json 并存）:
      ```json
      {
        "overall": "pass" | "fail",
        "scope": "all",
        "project_type": "both",
        "warnings": ["..."],
        "backend": { <单侧报告对象，同上方形态> },
        "frontend": { <单侧报告对象，同上方形态> }
      }
      ```
      两形态都保证含顶层 `overall` 字段（Task 15 的 GATE_SCHEMA 只依赖它）
  - `--stub-dir`：测试注入目录，其中的可执行文件（如 `mvn`）优先于 PATH——所有测试靠它模拟工具成败

- [ ] **Step 1: 写测试脚本 `scripts/quality-gate-test.sh`（TDD，先写失败场景）**

```bash
#!/bin/bash
set -u
cd "$(dirname "$0")/.."
QG="$(pwd)/scripts/quality-gate.sh"
PASS=0; FAIL=0

check() { # $1=描述 $2=期望(0/1/2) $3=stub 目录 $4=fixture 目录 $5...=参数（在 fixture 目录内运行）
  local desc="$1" want="$2" stub="$3" dir="$4"; shift 4
  local out
  out=$(cd "$dir" && bash "$QG" --stub-dir "$stub" "$@" 2>/dev/null)
  local got=$?
  if [ "$got" -eq "$want" ]; then PASS=$((PASS+1)); echo "ok - $desc"
  else FAIL=$((FAIL+1)); echo "FAIL - $desc (want exit $want, got $got; out: $out)"; fi
}

# stub: 全部工具成功
S_ALL=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_ALL/mvn"
printf '#!/bin/bash\necho "{}"\n' > "$S_ALL/dependency-check"
chmod +x "$S_ALL/mvn" "$S_ALL/dependency-check"

# stub: checkstyle 失败
S_CS=$(mktemp -d)
printf '#!/bin/bash\nif [ "$1" = "checkstyle:check" ]; then echo "checkstyle violation" >&2; exit 1; fi\nexit 0\n' > "$S_CS/mvn"
chmod +x "$S_CS/mvn"

# stub: 空（无任何工具）
S_EMPTY=$(mktemp -d)

# fixture 目录
mkdir -p target-stub-projects/backend/target/site/jacoco
touch target-stub-projects/backend/pom.xml
printf 'a,Example,0,0,0,0,20,80\n' > target-stub-projects/backend/target/site/jacoco/jacoco.csv
mkdir -p target-stub-projects/not-a-project

# 测试 1：Maven 项目全工具通过 → exit 0 且 JSON overall=pass
check "maven 全绿" 0 "$S_ALL" target-stub-projects/backend --scope backend

# 测试 2：checkstyle 失败 → exit 1 且 JSON overall=fail
out=$(cd target-stub-projects/backend && bash "$QG" --stub-dir "$S_CS" --scope backend 2>/dev/null)
if [ $? -eq 1 ] && echo "$out" | grep -q '"overall": *"fail"'; then PASS=$((PASS+1)); echo "ok - checkstyle 失败返回 fail"
else FAIL=$((FAIL+1)); echo "FAIL - checkstyle 失败应 exit 1 + overall=fail (out: $out)"; fi

# 测试 3：不在 Maven/Vue 项目内 → exit 2 且无崩溃
check "非项目目录" 2 "$S_EMPTY" target-stub-projects/not-a-project --scope all

rm -rf "$S_ALL" "$S_CS" "$S_EMPTY"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bash scripts/quality-gate-test.sh`
Expected: FAIL——quality-gate.sh 不存在。

- [ ] **Step 3: 实现 quality-gate.sh（本任务先完成 Java 门 + schema + stub 机制）**

```bash
#!/bin/bash
# 质量门统一入口：自动识别项目类型，输出 JSON 报告。交互式 hook 与 CI 共用。
# 用法: quality-gate.sh [--scope backend|frontend|all] [--thresholds <yaml>] [--stub-dir <dir>]
set -u

SCOPE="all"; THRESHOLDS_FILE=""; STUB_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPE="$2"; shift 2 ;;
    --thresholds) THRESHOLDS_FILE="$2"; shift 2 ;;
    --stub-dir) STUB_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPORT='{"overall":"fail","scope":"'"$SCOPE"'","project_type":"none","warnings":[],"checks":[],"coverage":null}'
emit() { # emit <json-report> <exit-code>  —— 只允许这一个 stdout 输出点
  echo "$1"
  exit "$2"
}

# 工具解析：stub-dir 优先
resolve() { # resolve mvn -> 路径或空
  if [ -n "$STUB_DIR" ] && [ -x "$STUB_DIR/$1" ]; then echo "$STUB_DIR/$1"
  else command -v "$1" 2>/dev/null || true; fi
}

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

HAS_POM=0; [ -f pom.xml ] && HAS_POM=1
HAS_NPM=0; [ -f package.json ] && HAS_NPM=1

if [ "$HAS_POM" -eq 0 ] && [ "$HAS_NPM" -eq 0 ]; then
  REPORT=$(printf '%s' "$REPORT" | sed 's/"project_type":"none"/"project_type":"none"/')
  emit "$REPORT" 2
fi

# ---- Java（Maven）门 ----
run_backend() {
  local MVN; MVN=$(resolve mvn)
  if [ -z "$MVN" ]; then emit '{"overall":"fail","scope":"backend","project_type":"maven","warnings":["mvn 未安装"],"checks":[],"coverage":null}' 2; fi

  local checks='[]' cs_status=pass cs_detail="0 违规" cs_sug='[]'
  local sb_status=pass sb_detail="0 高危/中危"
  local cov_status=pass cov_line=0 cov_threshold=80
  local dep_status=pass

  if ! "$MVN" checkstyle:check >/dev/null 2>&1; then
    cs_status=fail; cs_detail="checkstyle 违规（阿里 P3C）"; cs_sug='["运行 mvn checkstyle:check 查看违规明细并修复"]'
  fi
  if ! "$MVN" spotbugs:check >/dev/null 2>&1; then
    sb_status=fail
  fi
  # jacoco 行覆盖：从 target/site/jacoco/jacoco.csv 解析（缺文件按失败处理）
  # 列语义：$1=GROUP $2=CLASS $7=LINE_MISSED $8=LINE_COVERED
  if [ -f target/site/jacoco/jacoco.csv ]; then
    cov_line=$(awk -F',' 'NR>1 { im+=$7; ic+=$8 } END { if (ic+im>0) printf "%.1f", 100*ic/(ic+im); else print 0 }' target/site/jacoco/jacoco.csv)
    if ! awk -v l="$cov_line" -v t="$cov_threshold" 'BEGIN { exit !(l >= t) }'; then cov_status=fail; fi
  else
    cov_status=fail
  fi
  # Dependency-Check：本任务以脚本包装形式调用，详细扫描在 Task 19 模板中启用
  local DC; DC=$(resolve dependency-check)
  if [ -n "$DC" ] && ! "$DC" >/dev/null 2>&1; then dep_status=fail; fi

  local overall=pass
  [ "$cs_status" = fail ] || [ "$sb_status" = fail ] || [ "$cov_status" = fail ] || [ "$dep_status" = fail ] && overall=fail

  checks=$(printf '[{"name":"checkstyle","status":"%s","details":"%s","suggestions":%s},{"name":"spotbugs","status":"%s","details":"%s","suggestions":[]},{"name":"dependency-check","status":"%s","details":"%s","suggestions":[]}]' \
    "$cs_status" "$(json_escape "$cs_detail")" "$cs_sug" \
    "$sb_status" "$(json_escape "$sb_detail")" "$dep_status" "$(json_escape "无高危漏洞" )")
  printf '{"overall":"%s","scope":"backend","project_type":"maven","warnings":[],"checks":%s,"coverage":{"line":%s,"threshold":%s,"status":"%s"}}' \
    "$overall" "$checks" "$cov_line" "$cov_threshold" "$cov_status"
}

# ---- Vue 门（Task 12 实现，本任务先占位为 skipped）----
run_frontend() {
  printf '{"overall":"pass","scope":"frontend","project_type":"vue","warnings":["frontend 门在后续任务启用"],"checks":[],"coverage":null}'
}

case "$SCOPE" in
  backend)
    [ "$HAS_POM" -eq 1 ] || emit '{"overall":"fail","scope":"backend","project_type":"none","warnings":["当前目录无 pom.xml"],"checks":[],"coverage":null}' 2
    REPORT=$(run_backend) ;;
  frontend)
    [ "$HAS_NPM" -eq 1 ] || emit '{"overall":"fail","scope":"frontend","project_type":"none","warnings":["当前目录无 package.json"],"checks":[],"coverage":null}' 2
    REPORT=$(run_frontend) ;;
  all)
    case "$HAS_POM$HAS_NPM" in
      10) REPORT=$(run_backend) ;;
      01) REPORT=$(run_frontend) ;;
      11) # 前后端同仓：后端结果为主，前端结果合并（Task 12 完成合并逻辑）
          REPORT=$(run_backend) ;;
      00) emit "$REPORT" 2 ;;
    esac ;;
esac

# 按 overall 决定退出码（默认值保证非 fail 即 0）
echo "$REPORT" | grep -q '"overall":"fail"' && emit "$REPORT" 1 || emit "$REPORT" 0
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bash scripts/quality-gate-test.sh`
Expected: `3 passed, 0 failed`（fixture 的 jacoco.csv 为 8 列 `a,Example,0,0,0,0,20,80`，覆盖 80% 达标；checkstyle stub 按参数分流；非项目目录走 exit 2）。

- [ ] **Step 5: Commit**

```bash
git add scripts/quality-gate.sh scripts/quality-gate-test.sh
git commit -m "feat: quality-gate.sh Java 门（JSON 报告 schema + stub 测试机制）"
```

---

### Task 12: quality-gate.sh —— Vue 门、monorepo 合并与阈值文件

**Files:**
- Modify: `scripts/quality-gate.sh`
- Modify: `scripts/quality-gate-test.sh`
- Create: `templates/config/quality-gate.yaml`

**Interfaces:**
- Consumes: Task 11 的报告 schema 与 stub 机制
- Produces: 完整 quality-gate.sh（含 `--thresholds` 支持与 `--scope all` 的 both 项目合并逻辑）；阈值文件 `templates/config/quality-gate.yaml`

- [ ] **Step 1: 写新增失败测试（追加到 quality-gate-test.sh 末尾、`echo` 汇总之前）**

```bash
# ---- Vue 门与阈值测试 ----
S_NPM_OK=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_NPM_OK/npm"
printf '#!/bin/bash\nexit 0\n' > "$S_NPM_OK/vue-tsc"
chmod +x "$S_NPM_OK/npm" "$S_NPM_OK/vue-tsc"
mkdir -p target-stub-projects/frontend/coverage
touch target-stub-projects/frontend/package.json
echo '{"total":{"lines":{"pct":75}}}' > target-stub-projects/frontend/coverage/coverage-summary.json

# 测试 4：Vue 全绿 → exit 0 overall=pass
( cd target-stub-projects/frontend && out=$(bash "$QG" --stub-dir "$S_NPM_OK" --scope frontend 2>/dev/null); code=$?
  if [ "$code" -eq 0 ] && echo "$out" | grep -q '"overall":"pass"'; then echo "ok - vue 全绿"; exit 0
  else echo "FAIL - vue 全绿应 pass (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 测试 5：npm audit 高危 → exit 1 overall=fail
S_NPM_BAD=$(mktemp -d)
printf '#!/bin/bash\nif [ "$1" = "audit" ]; then exit 1; fi\nexit 0\n' > "$S_NPM_BAD/npm"
printf '#!/bin/bash\nexit 0\n' > "$S_NPM_BAD/vue-tsc"
chmod +x "$S_NPM_BAD/npm" "$S_NPM_BAD/vue-tsc"
( cd target-stub-projects/frontend && out=$(bash "$QG" --stub-dir "$S_NPM_BAD" --scope frontend 2>/dev/null); code=$?
  if [ "$code" -eq 1 ] && echo "$out" | grep -q '"overall":"fail"'; then echo "ok - npm audit 高危 fail"; exit 0
  else echo "FAIL - npm audit 高危应 fail (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 测试 6：阈值文件缺失 → 回退默认值并在 warnings 中注明（exit 0 全绿场景）
( cd target-stub-projects/frontend && out=$(bash "$QG" --stub-dir "$S_NPM_OK" --scope frontend --thresholds /nonexistent/qg.yaml 2>/dev/null); code=$?
  if [ "$code" -eq 0 ] && echo "$out" | grep -q '阈值文件缺失'; then echo "ok - 缺失阈值文件回退默认值"; exit 0
  else echo "FAIL - 缺失阈值文件应回退默认并在 warnings 注明 (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

# 测试 7：前后端同仓（both）--scope all → 后端失败则 overall=fail 且含 backend/frontend 子报告
S_BOTH=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_BOTH/npm"
printf '#!/bin/bash\nexit 0\n' > "$S_BOTH/vue-tsc"
printf '#!/bin/bash\nexit 1\n' > "$S_BOTH/mvn"   # 后端必失败
chmod +x "$S_BOTH/npm" "$S_BOTH/vue-tsc" "$S_BOTH/mvn"
mkdir -p target-stub-projects/both/target/site/jacoco
printf 'a,Example,0,0,0,0,20,80\n' > target-stub-projects/both/target/site/jacoco/jacoco.csv
mkdir -p target-stub-projects/both/coverage
echo '{"total":{"lines":{"pct":75}}}' > target-stub-projects/both/coverage/coverage-summary.json
touch target-stub-projects/both/pom.xml target-stub-projects/both/package.json
( cd target-stub-projects/both && out=$(bash "$QG" --stub-dir "$S_BOTH" --scope all 2>/dev/null); code=$?
  if [ "$code" -eq 1 ] && echo "$out" | grep -q '"overall":"fail"' && echo "$out" | grep -q '"backend"' && echo "$out" | grep -q '"frontend"'; then echo "ok - both 合并失败"; exit 0
  else echo "FAIL - both 合并应 fail 且含子报告 (out: $out)"; exit 1; fi )
if [ $? -eq 0 ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi

rm -rf "$S_NPM_OK" "$S_NPM_BAD" "$S_BOTH"
```

- [ ] **Step 2: 运行测试确认新用例失败**

Run: `bash scripts/quality-gate-test.sh`
Expected: 测试 4/5/6 FAIL（frontend 门还是占位 skipped 实现）。

- [ ] **Step 3: 实现 Vue 门与阈值加载（修改 run_frontend 与新增 load_thresholds）**

```bash
# 在脚本头部（REPORT 定义之前）新增全局变量与函数：
EXTRA_WARNINGS=""   # load_thresholds 填充，run_backend/run_frontend 注入其 warnings

load_thresholds() {
  # 读取 YAML 里形如 "backend_coverage: 80" 的行；文件缺失 → 内置默认值 + EXTRA_WARNINGS
  local file="$1"
  COV_BACKEND=80; COV_FRONTEND=70
  EXTRA_WARNINGS=""
  if [ -z "$file" ]; then return; fi
  if [ ! -f "$file" ]; then
    EXTRA_WARNINGS='"阈值文件缺失，使用默认值(Java 80/Vue 70)"'
    return
  fi
  local b f
  b=$(sed -n 's/^ *backend_coverage: *\([0-9][0-9]*\).*/\1/p' "$file" | head -1)
  f=$(sed -n 's/^ *frontend_coverage: *\([0-9][0-9]*\).*/\1/p' "$file" | head -1)
  [ -n "$b" ] && COV_BACKEND="$b"
  [ -n "$f" ] && COV_FRONTEND="$f"
}

# 并把 run_backend（Task 11 版）与 run_frontend 中硬编码的 "warnings":[] 替换为动态值：
#   printf ... '"warnings":[%s]' ... "${EXTRA_WARNINGS:-[]}"
# 即 run_backend 结尾 printf 的 "warnings":[] 改为 "warnings":[%s] 并追加参数 ${EXTRA_WARNINGS:-[]}；run_frontend 同理。

# run_frontend 替换为：
run_frontend() {
  local NPM; NPM=$(resolve npm)
  local VTS; VTS=$(resolve vue-tsc)
  if [ -z "$NPM" ]; then emit '{"overall":"fail","scope":"frontend","project_type":"vue","warnings":["npm 未安装"],"checks":[],"coverage":null}' 2; fi

  local lint_status=pass tsc_status=pass audit_status=pass cov_status=pass cov_threshold=${COV_FRONTEND:-70}
  local cov_line=0 cov_out
  if ! "$NPM" run lint >/dev/null 2>&1; then lint_status=fail; fi
  if [ -n "$VTS" ] && ! "$VTS" --noEmit >/dev/null 2>&1; then tsc_status=fail; fi
  if ! "$NPM" audit --audit-level=high >/dev/null 2>&1; then audit_status=fail; fi
  # Vitest 覆盖率：从 coverage/coverage-summary.json 读取 lines.pct
  if [ -f coverage/coverage-summary.json ]; then
    cov_line=$(node -e 'const s=require(process.cwd()+"/coverage/coverage-summary.json").total.lines.pct; process.stdout.write(String(Math.round(s*10)/10))' 2>/dev/null || echo 0)
    if ! awk -v l="$cov_line" -v t="$cov_threshold" 'BEGIN { exit !(l >= t) }'; then cov_status=fail; fi
  else
    cov_status=fail
  fi

  local overall=pass
  [ "$lint_status" = fail ] || [ "$tsc_status" = fail ] || [ "$audit_status" = fail ] || [ "$cov_status" = fail ] && overall=fail

  printf '{"overall":"%s","scope":"frontend","project_type":"vue","warnings":[],"checks":[{"name":"eslint","status":"%s","details":"0 error","suggestions":[]},{"name":"vue-tsc","status":"%s","details":"类型检查","suggestions":[]},{"name":"npm-audit","status":"%s","details":"无高危","suggestions":[]}],"coverage":{"line":%s,"threshold":%s,"status":"%s"}}' \
    "$overall" "$lint_status" "$tsc_status" "$audit_status" "$cov_line" "$cov_threshold" "$cov_status"
}
```

并修改 `case all` 的 `11)` 分支（Task 11 中它只跑后端）为合并实现：

```bash
  11) # 前后端同仓：两侧都跑，合并输出（见 Interfaces 的 both 形态）
      B=$(run_backend)
      F=$(run_frontend)
      B_OK=$(echo "$B" | grep -q '"overall":"pass"' && echo 1 || echo 0)
      F_OK=$(echo "$F" | grep -q '"overall":"pass"' && echo 1 || echo 0)
      OV=fail; [ "$B_OK" = 1 ] && [ "$F_OK" = 1 ] && OV=pass
      REPORT=$(printf '{"overall":"%s","scope":"all","project_type":"both","warnings":[],"backend":%s,"frontend":%s}' "$OV" "$B" "$F")
```

并在脚本最前（while 参数解析后）调用 `load_thresholds "$THRESHOLDS_FILE"`（须在 run_backend/run_frontend 调用之前）。测试 4/5/6 的 Vue fixture（coverage/coverage-summary.json 等）已在测试脚本中预置。

- [ ] **Step 4: 运行测试确认全部通过**

Run: `bash scripts/quality-gate-test.sh`
Expected: `7 passed, 0 failed`（新增测试 7：both 合并）。

- [ ] **Step 5: 写 templates/config/quality-gate.yaml（默认阈值，供 `--thresholds` 引用）**

```yaml
# nl-sdlc 质量门阈值（复制到项目根或用 --thresholds 指定）
backend_coverage: 80   # jacoco 行覆盖率下限（%）
frontend_coverage: 70  # vitest 行覆盖率下限（%）
```

- [ ] **Step 6: Commit**

```bash
git add scripts/quality-gate.sh scripts/quality-gate-test.sh templates/config/quality-gate.yaml
git commit -m "feat: quality-gate.sh Vue 门 + 阈值文件（缺失回退默认值）"
```

---

### Task 13: run-tests.sh（Newman + Playwright 执行入口）

**Files:**
- Create: `scripts/run-tests.sh`
- Create: `scripts/run-tests-test.sh`

**Interfaces:**
- Consumes: 无
- Produces:
  - 调用约定：`bash scripts/run-tests.sh [--api] [--e2e] [--base-url http://host:port] [--stub-dir <dir>]`
  - stdout 输出唯一 JSON：`{"overall":"pass"|"fail","api":{"status":"pass"|"fail"|"skipped","report":"..."},"e2e":{"status":"pass"|"fail"|"skipped","report":"..."},"warnings":["..."]}`
  - 退出码：0=全过/有 warning、1=有用例失败、2=参数错误
  - 工具缺失（newman/playwright 未安装）→ 对应段 `skipped` + warnings 说明，退出码 0

- [ ] **Step 1: 写测试脚本 `scripts/run-tests-test.sh`**

```bash
#!/bin/bash
set -u
cd "$(dirname "$0")/.."
PASS=0; FAIL=0

# stub newman：成功
S_OK=$(mktemp -d)
printf '#!/bin/bash\nexit 0\n' > "$S_OK/newman"
printf '#!/bin/bash\nexit 0\n' > "$S_OK/playwright"
chmod +x "$S_OK/newman" "$S_OK/playwright"
mkdir -p target-stub-projects/api-target && cd target-stub-projects/api-target
mkdir -p tests/api && echo '{}' > tests/api/demo.postman_collection.json

out=$(bash ../../scripts/run-tests.sh --api --e2e --base-url http://127.0.0.1:8080 --stub-dir "$S_OK" 2>/dev/null)
if [ $? -eq 0 ] && echo "$out" | grep -q '"overall":"pass"'; then PASS=$((PASS+1)); echo "ok - 全绿"
else FAIL=$((FAIL+1)); echo "FAIL - 全绿应 pass (out: $out)"; fi

# stub newman：失败
S_BAD=$(mktemp -d)
printf '#!/bin/bash\nexit 1\n' > "$S_BAD/newman"
chmod +x "$S_BAD/newman"
out=$(bash ../../scripts/run-tests.sh --api --base-url http://127.0.0.1:8080 --stub-dir "$S_BAD" 2>/dev/null)
if [ $? -eq 1 ] && echo "$out" | grep -q '"status":"fail"'; then PASS=$((PASS+1)); echo "ok - newman 失败 fail"
else FAIL=$((FAIL+1)); echo "FAIL - newman 失败应 exit 1 (out: $out)"; fi

# 工具缺失：优雅降级
S_EMPTY=$(mktemp -d)
out=$(bash ../../scripts/run-tests.sh --api --e2e --base-url http://127.0.0.1:8080 --stub-dir "$S_EMPTY" 2>/dev/null)
if [ $? -eq 0 ] && echo "$out" | grep -q '"status":"skipped"' && echo "$out" | grep -q '"warnings"'; then PASS=$((PASS+1)); echo "ok - 工具缺失 skipped + warning"
else FAIL=$((FAIL+1)); echo "FAIL - 工具缺失应 skipped + warning exit 0 (out: $out)"; fi

cd ../.. && rm -rf "$S_OK" "$S_BAD" "$S_EMPTY"
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bash scripts/run-tests-test.sh`
Expected: FAIL——run-tests.sh 不存在。

- [ ] **Step 3: 实现 run-tests.sh**

```bash
#!/bin/bash
# 测试统一入口：Newman 接口测试 + Playwright E2E。CI 与交互式共用。
# 用法: run-tests.sh [--api] [--e2e] [--base-url url] [--stub-dir dir]
set -u

DO_API=0; DO_E2E=0; BASE_URL=""; STUB_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --api) DO_API=1; shift ;;
    --e2e) DO_E2E=1; shift ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --stub-dir) STUB_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ "$DO_API" -eq 0 ] && [ "$DO_E2E" -eq 0 ] && { echo '{"overall":"fail","api":{"status":"skipped"},"e2e":{"status":"skipped"},"warnings":["至少指定 --api 或 --e2e"]}' ; exit 2; }

resolve() {
  if [ -n "$STUB_DIR" ] && [ -x "$STUB_DIR/$1" ]; then echo "$STUB_DIR/$1"
  else command -v "$1" 2>/dev/null || true; fi
}

API_STATUS=skipped; E2E_STATUS=skipped; API_REPORT=""; E2E_REPORT=""; WARNINGS='[]'
add_warning() { WARNINGS=$(printf '%s' "$WARNINGS" | sed 's/\]$/,{}/' ) ; }

# ---- 接口测试 ----
if [ "$DO_API" -eq 1 ]; then
  NM=$(resolve newman)
  if [ -z "$NM" ]; then
    WARNINGS='["newman 未安装，接口测试跳过（npm i -g newman 安装）"]'
  else
    mkdir -p build/test-results/newman
    API_REPORT="build/test-results/newman/report.xml"
    if ls tests/api/*.postman_collection.json >/dev/null 2>&1; then
      if "$NM" run tests/api/*.postman_collection.json --reporters cli,junit --reporter-junit-export "$API_REPORT" >/dev/null 2>&1; then
        API_STATUS=pass
      else
        API_STATUS=fail
      fi
    else
      WARNINGS='["tests/api/ 下无 collection 文件，接口测试跳过"]'
    fi
  fi
fi

# ---- E2E ----
if [ "$DO_E2E" -eq 1 ]; then
  PW=$(resolve playwright)
  if [ -z "$PW" ]; then
    [ "$WARNINGS" = '[]' ] && WARNINGS='["playwright 未安装，E2E 跳过（npm i -D @playwright/test）"]' || WARNINGS=$(printf '%s' "$WARNINGS" | sed 's/\]$/, "playwright 未安装，E2E 跳过"]/')
  else
    if ls tests/e2e/*.spec.ts >/dev/null 2>&1; then
      if PLAYWRIGHT_BASE_URL="$BASE_URL" "$PW" test >/dev/null 2>&1; then E2E_STATUS=pass; else E2E_STATUS=fail; fi
    else
      [ "$WARNINGS" = '[]' ] && WARNINGS='["tests/e2e/ 下无 spec 文件，E2E 跳过"]' || WARNINGS=$(printf '%s' "$WARNINGS" | sed 's/\]$/, "tests/e2e/ 下无 spec 文件，E2E 跳过"]/')
    fi
  fi
fi

OVERALL=pass
[ "$API_STATUS" = fail ] || [ "$E2E_STATUS" = fail ] && OVERALL=fail

printf '{"overall":"%s","api":{"status":"%s","report":"%s"},"e2e":{"status":"%s","report":"%s"},"warnings":%s}\n' \
  "$OVERALL" "$API_STATUS" "$API_REPORT" "$E2E_STATUS" "$E2E_REPORT" "$WARNINGS"

[ "$OVERALL" = pass ] && exit 0 || exit 1
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bash scripts/run-tests-test.sh`
Expected: `3 passed, 0 failed`。

- [ ] **Step 5: Commit**

```bash
git add scripts/run-tests.sh scripts/run-tests-test.sh
git commit -m "feat: run-tests.sh（Newman + Playwright 统一入口，工具缺失优雅降级）"
```

---

### Task 14: requirement.js workflow（3票质疑）

**Files:**
- Create: `workflows/requirement.js`

**Interfaces:**
- Consumes: persona 名 `security-auditor`、`test-engineer`（Task 9）；需求文档 `docs/requirements/*.md`
- Produces: 命令 `/nl-sdlc:requirement`；tasks.md schema（Task 15 消费）:
  ```markdown
  ---
  feature: <feature-name>
  status: ready
  tasks:
    - id: T-01
      title: <一句话标题>
      deps: []            # 依赖的任务 id 列表
      acceptance: []      # 验收标准编号列表（AC-xx）
      test_cases: []      # 关联用例文件（tests/api/... 或 tests/e2e/...）
      description: <任务描述>
  ---
  # <feature-name> 任务列表
  ## T-01 <标题>
  <人类可读描述与验收标准>
  ```
  概要设计：`docs/designs/YYYY-MM-DD-<feature>-design.md`；详细设计与 tasks.md：`docs/plans/<feature>/`

- [ ] **Step 1: 写 requirement.js（完整脚本）**

```javascript
export const meta = {
  name: 'requirement',
  description: '需求分析→概要设计(3票质疑)→详细设计+任务列表',
  phases: [
    { title: '分析' },
    { title: '概要设计' },
    { title: '质疑投票' },
    { title: '详细设计与任务' },
  ],
}

// ---- 输出 schema ----
const STRUCTURED_REQ_SCHEMA = {
  type: 'object',
  required: ['feature', 'user_stories', 'acceptance_criteria', 'nfr', 'open_questions'],
  properties: {
    feature: { type: 'string' },
    user_stories: { type: 'array', items: { type: 'string' } },
    acceptance_criteria: { type: 'array', items: { type: 'string' } },
    nfr: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
}
const DESIGN_SCHEMA = {
  type: 'object',
  required: ['feature', 'summary', 'architecture', 'interfaces', 'data_model', 'risks'],
  properties: {
    feature: { type: 'string' },
    summary: { type: 'string' },
    architecture: { type: 'string' },
    interfaces: { type: 'array', items: { type: 'string' } },
    data_model: { type: 'string' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}
const VOTE_SCHEMA = {
  type: 'object',
  required: ['vote', 'reasons'],
  properties: {
    vote: { type: 'string', enum: ['pass', 'reject'] },
    reasons: { type: 'array', items: { type: 'string' } },
  },
}

// ---- 投票判定（纯函数，可独立验证）----
// votes: [{vote:'pass'|'reject'} | null]；返回 {result:'pass'|'reject'|'deadlock'}
function tallyVotes(votes) {
  const valid = votes.filter(Boolean)
  if (valid.length < 2) return { result: 'deadlock' }
  const passes = valid.filter((v) => v.vote === 'pass').length
  return { result: passes * 3 >= valid.length * 2 ? 'pass' : 'reject' }
}

// ---- Phase 1: 分析 ----
phase('分析')
const reqFiles = await agent(
  '列出 docs/requirements/ 目录下所有 .md 需求文档的路径（若 args 指定了文件名则只列该文件）。同时返回今天的日期（YYYY-MM-DD 格式，从你的系统时间读取）。无文档时 files 返回空数组。',
  { label: 'list-requirements', schema: { type: 'object', required: ['files', 'today'], properties: { files: { type: 'array', items: { type: 'string' } }, today: { type: 'string' } } } },
)
if (!reqFiles || !reqFiles.files.length) {
  log('docs/requirements/ 下没有需求文档，流程终止')
  return { result: 'no-requirements' }
}
const analysis = await agent(
  `遵循 nl-sdlc:requirement-analysis skill，分析以下需求文档并输出结构化需求（feature 名、用户故事、验收标准、待澄清问题）。文档: ${reqFiles.files.join(', ')}`,
  { label: 'analyze', schema: STRUCTURED_REQ_SCHEMA },
)

// ---- Phase 2: 概要设计 ----
phase('概要设计')
const date = reqFiles.today
let design = await agent(
  `基于以下结构化需求输出概要设计（架构、接口清单、数据模型、风险）。禁止超出需求范围。\n需求: ${JSON.stringify(analysis)}`,
  { label: 'outline-design', schema: DESIGN_SCHEMA },
)

// ---- Phase 3: 质疑投票（最多 3 轮，≥2/3 通过）----
phase('质疑投票')
const PERSPECTIVES = ['架构视角（模块边界、依赖、扩展性）', '安全视角（OWASP Top 10）', '测试视角（可测试性、测试策略）']
for (let round = 1; round <= 3; round++) {
  const votes = await parallel(PERSPECTIVES.map((p, i) => () =>
    agent(`你是质疑者 ${i + 1}（${p}）。对以下概要设计投票 pass/reject，reject 必须给出具体质疑理由。${round > 1 ? '这是第 ' + round + ' 轮：参考上一轮其他质疑者的意见，若设计已回应你的质疑可改投 pass。上一轮意见: ' + JSON.stringify(prevRound) : ''}\n设计: ${JSON.stringify(design)}`,
      { label: 'challenger-' + (i + 1) + '-r' + round, schema: VOTE_SCHEMA }),
  ))
  const prevRound = votes
  const tally = tallyVotes(votes)
  if (tally.result === 'pass') { log('质疑投票通过（第 ' + round + ' 轮）'); break }
  if (round === 3) {
    const report = await agent(
      `3 轮质疑投票未获 2/3 多数，整理分歧报告：汇总三轮质疑意见与设计的回应，输出转人工决策的报告文本。\n设计: ${JSON.stringify(design)}\n投票: ${JSON.stringify(votes)}`,
      { label: 'divergence-report', schema: { type: 'object', required: ['report'], properties: { report: { type: 'string' } } } },
    )
    return { result: 'divergence', design, votes, report: report.report }
  }
  design = await agent(
    `根据以下质疑意见修订概要设计（保持需求范围不变）。\n当前设计: ${JSON.stringify(design)}\n质疑意见: ${JSON.stringify(votes)}`,
    { label: 'revise-design-r' + round, schema: DESIGN_SCHEMA },
  )
}

// ---- Phase 4: 详细设计 + 任务列表 ----
phase('详细设计与任务')
const detail = await agent(
  `基于通过的概要设计，输出详细设计文档正文（模块实现方案、接口定义、数据库变更、异常处理约定），写入 docs/plans/${analysis.feature}/详细设计.md。\n概要设计: ${JSON.stringify(design)}`,
  { label: 'detail-design' },
)
const tasks = await agent(
  `基于概要/详细设计拆解开发任务，生成 docs/plans/${analysis.feature}/tasks.md（格式：YAML frontmatter 含 tasks 数组，字段 id/title/deps/acceptance/test_cases/description；正文为人类可读章节）。同时把概要设计写入 docs/designs/${date}-${analysis.feature}-design.md。`,
  { label: 'task-breakdown' },
)
return { result: 'done', feature: analysis.feature, design_path: `docs/designs/${date}-${analysis.feature}-design.md`, tasks_path: `docs/plans/${analysis.feature}/tasks.md` }
```

- [ ] **Step 2: 日期来源自检**（workflow 运行时禁止 `Date`/`Math.random`，日期必须由 agent 返回，此处静态确认无违禁调用）

Run: `node -e "const s=require('fs').readFileSync('workflows/requirement.js','utf8'); if(/(Date|Math\.random)\(/.test(s)) { console.error('FAIL 脚本含违禁调用'); process.exit(1) } console.log('ok')"`
Expected: `ok`。

- [ ] **Step 3: 语法与结构校验**

Run: `node --check workflows/requirement.js` → 无输出即通过。
Run: `node scripts/validate-plugin.mjs` → PASS 且 workflows 计数为 1。
Run: 投票纯函数验证（从脚本提取后单测）:
```bash
node -e "
function tallyVotes(votes){const valid=votes.filter(Boolean);if(valid.length<2)return{result:'deadlock'};const passes=valid.filter(v=>v.vote==='pass').length;return{result:passes*3>=valid.length*2?'pass':'reject'}}
const assert=require('assert');
assert.equal(tallyVotes([{vote:'pass'},{vote:'pass'},{vote:'reject'}]).result,'pass');
assert.equal(tallyVotes([{vote:'pass'},{vote:'reject'},{vote:'reject'}]).result,'reject');
assert.equal(tallyVotes([{vote:'pass'},{vote:'reject'}]).result,'pass');
assert.equal(tallyVotes([{vote:'pass'},{vote:'pass'},{vote:null}]).result,'pass');
assert.equal(tallyVotes([null,null,{vote:'pass'}]).result,'deadlock');
console.log('vote tally ok')
"
```
Expected: `vote tally ok`。

- [ ] **Step 4: 小规模试运行（可选验证）**

Run: `claude -p "/nl-sdlc:requirement 分析 docs/requirements/ 下文档"` 在一个含测试需求文档的临时目录执行，确认三阶段跑通、产物写入正确路径。
Expected: 产物 `docs/designs/`、`docs/plans/<feature>/详细设计.md`、`tasks.md` 存在且 frontmatter 可解析。（若环境无可用 claude -p 认证则跳过本步并记录。）

- [ ] **Step 5: Commit**

```bash
git add workflows/requirement.js
git commit -m "feat: requirement workflow（分析→概要设计→3票质疑→详细设计+任务列表）"
```

---

### Task 15: development.js workflow（质量门打回循环）

**Files:**
- Create: `workflows/development.js`

**Interfaces:**
- Consumes: persona 名 `dev-engineer`、`code-reviewer`、`security-auditor`（Task 9）；quality-gate.sh JSON 报告（Task 11/12）；tasks.md schema（Task 14）
- Produces: 命令 `/nl-sdlc:development`

- [ ] **Step 1: 写 development.js**

```javascript
export const meta = {
  name: 'development',
  description: '按 tasks.md 编码→质量门打回循环→三视角评审',
  phases: [
    { title: '任务读取' },
    { title: '编码' },
    { title: '质量门' },
    { title: '评审' },
  ],
}

const TASKS_SCHEMA = {
  type: 'object',
  required: ['feature', 'tasks'],
  properties: {
    feature: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'acceptance', 'test_cases'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          deps: { type: 'array', items: { type: 'string' } },
          acceptance: { type: 'array', items: { type: 'string' } },
          test_cases: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}
const GATE_SCHEMA = {
  type: 'object',
  required: ['overall'],
  properties: { overall: { type: 'string', enum: ['pass', 'fail'] } },
}

// ---- Phase 1: 任务读取 ----
phase('任务读取')
const taskDoc = await agent(
  '读取 docs/plans/ 下目标 feature 的 tasks.md（args 指定 feature 名；未指定则列出 docs/plans/ 下所有 feature 让用户选择最近一个）。解析其 YAML frontmatter，返回 feature 名与 tasks 数组。若文件缺失或 frontmatter 缺 tasks 字段，返回 error 字段说明缺失的路径与字段，不得编造任务。',
  { label: 'read-tasks', schema: TASKS_SCHEMA },
)
if (!taskDoc || !taskDoc.tasks || !taskDoc.tasks.length) {
  return { result: 'no-tasks', error: taskDoc && taskDoc.error ? taskDoc.error : 'tasks.md 无任务或不可解析' }
}
const taskCount = taskDoc.tasks.length
log(`共 ${taskCount} 个任务`)

// ---- Phase 2: 编码（按依赖拓扑顺序）----
phase('编码')
const results = []
for (const t of taskDoc.tasks) {
  const dev = await agent(
    `你是 dev-engineer，遵循 nl-sdlc:coding skill 实现任务。\n任务: ${JSON.stringify(t)}\nfeature: ${taskDoc.feature}\n详细设计: docs/plans/${taskDoc.feature}/详细设计.md`,
    { label: 'dev-' + t.id },
  )
  results.push({ task: t.id, dev })
}

// ---- Phase 3: 质量门（每任务：过门或打回修复 ≤2 轮）----
phase('质量门')
const MAX_FIX_ROUNDS = 2
for (const r of results) {
  let gate = await agent(
    `运行 bash scripts/quality-gate.sh --scope all，把 stdout 的 JSON 报告原样返回（含 overall）。（workflow 判定一律全量 --scope all；编码期自检可用 --scope 单侧，两者不矛盾。）`,
    { label: 'gate-' + r.task, schema: GATE_SCHEMA },
  )
  let rounds = 0
  while (gate && gate.overall === 'fail' && rounds < MAX_FIX_ROUNDS) {
    const fix = await agent(
      `质量门失败，按失败详情修复任务 ${r.task} 的代码（遵循 nl-sdlc:coding skill，修复后运行相关测试）。失败详情: ${JSON.stringify(gate)}`,
      { label: 'fix-' + r.task + '-r' + (rounds + 1) },
    )
    gate = await agent(
      `重新运行 bash scripts/quality-gate.sh --scope all，返回 JSON 报告（含 overall）。（workflow 判定一律全量 --scope all。）`,
      { label: 'gate-' + r.task + '-r' + (rounds + 1), schema: GATE_SCHEMA },
    )
    rounds++
  }
  r.gate = gate
  r.failed = !gate || gate.overall === 'fail'
}

// ---- Phase 4: 评审（三视角并行）----
phase('评审')
const okTasks = results.filter((r) => !r.failed)
const reviews = await parallel([
  () => agent(`你是 code-reviewer，遵循 nl-sdlc:code-review skill 评审本次全部变更（任务: ${okTasks.map((r) => r.task).join(', ')}），输出分级问题报告。`, { label: 'review-correctness' }),
  () => agent(`你是 security-auditor，对本次全部变更做安全审查，输出发现清单。（此步即 spec §6.1 质量门"AI security-auditor 代码审查"部分的执行点，与脚本门的 Dependency-Check 共同构成完整安全门。）`, { label: 'review-security' }),
  () => agent(`你是 code-reviewer，从可读性与架构视角评审本次变更，输出分级问题报告。`, { label: 'review-architecture' }),
])
return { result: 'done', feature: taskDoc.feature, taskResults: results, reviews, note: 'Critical 问题需打回；合并前需人工批准（见 nl-sdlc:delivery skill）' }
```

- [ ] **Step 2: 坏 tasks.md 报错路径验证（Review Focus 1 的测试）**

Run: `node --check workflows/development.js` → 通过。
Run（静态断言）:
```bash
node -e "
const s = require('fs').readFileSync('workflows/development.js','utf8');
if (!s.includes('不得编造任务')) { console.error('FAIL: 缺坏文件防护'); process.exit(1) }
if (!s.includes('MAX_FIX_ROUNDS = 2')) { console.error('FAIL: 打回轮数不是 2'); process.exit(1) }
console.log('ok')
"
```
Expected: `ok`。

- [ ] **Step 3: 结构校验** — Run: `node scripts/validate-plugin.mjs`，Expected: PASS 且 workflows 计数为 2。

- [ ] **Step 4: Commit**

```bash
git add workflows/development.js
git commit -m "feat: development workflow（编码→质量门打回循环→三视角评审）"
```

---

### Task 16: testing.js workflow

**Files:**
- Create: `workflows/testing.js`

**Interfaces:**
- Consumes: persona 名 `test-engineer`（Task 9）；run-tests.sh JSON 输出（Task 13）
- Produces: 命令 `/nl-sdlc:test`（meta.name 用 `test` 而非 `testing`，避免与 `skills/testing` 在同一命名空间注册为 `/nl-sdlc:testing` 冲突；spec §4.3 的命令名即 `/nl-sdlc:test`）

- [ ] **Step 1: 写 testing.js**

```javascript
export const meta = {
  name: 'test',
  description: '接口测试(Newman)+E2E(Playwright)执行、失败诊断与修复循环',
  phases: [
    { title: '接口测试' },
    { title: 'E2E' },
    { title: '修复循环' },
  ],
}

const TEST_RESULT_SCHEMA = {
  type: 'object',
  required: ['overall'],
  properties: {
    overall: { type: 'string', enum: ['pass', 'fail'] },
    api: { type: 'object' },
    e2e: { type: 'object' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
}
const FIX_SCHEMA = {
  type: 'object',
  required: ['classification', 'action_taken'],
  properties: {
    classification: { type: 'string', enum: ['service-bug', 'test-case-issue'] },
    action_taken: { type: 'string' },
    notes: { type: 'string' },
  },
}

const baseUrl = args && args.baseUrl ? args.baseUrl : ''
const baseArg = baseUrl ? ' --base-url ' + baseUrl : ''

// ---- Phase 1: 接口测试 ----
phase('接口测试')
const apiResult = await agent(
  `运行 bash scripts/run-tests.sh --api${baseArg}，把 stdout 的 JSON 原样返回。`,
  { label: 'api-run', schema: TEST_RESULT_SCHEMA },
)

// ---- Phase 2: E2E ----
phase('E2E')
const e2eResult = await agent(
  `运行 bash scripts/run-tests.sh --e2e${baseArg}，把 stdout 的 JSON 原样返回。`,
  { label: 'e2e-run', schema: TEST_RESULT_SCHEMA },
)

// ---- Phase 3: 失败修复循环（≤2 轮）----
phase('修复循环')
const fixes = []
if (apiResult && apiResult.overall === 'fail') {
  for (let round = 1; round <= 2; round++) {
    const fix = await agent(
      `你是 test-engineer，遵循 nl-sdlc:testing skill 诊断接口测试失败：判定失败类别（service-bug 打回开发 / test-case-issue 修用例），执行修复动作。${round === 2 ? '这是最后一轮。' : ''}\n失败结果: ${JSON.stringify(apiResult)}`,
      { label: 'api-fix-r' + round, schema: FIX_SCHEMA },
    )
    fixes.push({ phase: 'api', round, fix })
    const rerun = await agent(
      `重新运行 bash scripts/run-tests.sh --api${baseArg}，返回 JSON。`,
      { label: 'api-rerun-r' + round, schema: TEST_RESULT_SCHEMA },
    )
    if (rerun && rerun.overall === 'pass') { fixes.push({ phase: 'api', round, rerun: 'pass' }); break }
    fixes.push({ phase: 'api', round, rerun: rerun ? rerun.overall : 'error' })
  }
}
if (e2eResult && e2eResult.overall === 'fail') {
  for (let round = 1; round <= 2; round++) {
    const fix = await agent(
      `你是 test-engineer，遵循 nl-sdlc:testing skill 诊断 E2E 失败（参考截图/录像归档）：判定失败类别并执行修复。${round === 2 ? '这是最后一轮。' : ''}\n失败结果: ${JSON.stringify(e2eResult)}`,
      { label: 'e2e-fix-r' + round, schema: FIX_SCHEMA },
    )
    fixes.push({ phase: 'e2e', round, fix })
    const rerun = await agent(
      `重新运行 bash scripts/run-tests.sh --e2e${baseArg}，返回 JSON。`,
      { label: 'e2e-rerun-r' + round, schema: TEST_RESULT_SCHEMA },
    )
    if (rerun && rerun.overall === 'pass') { fixes.push({ phase: 'e2e', round, rerun: 'pass' }); break }
    fixes.push({ phase: 'e2e', round, rerun: rerun ? rerun.overall : 'error' })
  }
}

return { result: 'done', api: apiResult, e2e: e2eResult, fixes }
```

- [ ] **Step 2: 校验**

Run: `node --check workflows/testing.js` → 通过。
Run: `node scripts/validate-plugin.mjs` → PASS 且 workflows 计数为 3。

- [ ] **Step 3: Commit**

```bash
git add workflows/testing.js
git commit -m "feat: testing workflow（Newman+Playwright 执行、诊断与修复循环）"
```

---

### Task 17: Hooks（SessionStart 注入 + 质量门强制）

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/session-start.sh`
- Create: `hooks/teammate-idle.sh`
- Create: `hooks/task-completed.sh`
- Create: `hooks/hooks-test.sh`

**Interfaces:**
- Consumes: skill 名 `using-nl-sdlc`（Task 3）；quality-gate.sh（Task 11/12）；环境变量 `CLAUDE_PLUGIN_ROOT`（Claude Code 注入）
- Produces: 三个 hook 注册（SessionStart/TeammateIdle/TaskCompleted）；hook 输出约定：成功/放行 exit 0，打回 exit 2 + stderr 反馈文本，SessionStart 输出 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<skill 全文>"}}`

- [ ] **Step 1: 写 hooks.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" }]
      }
    ],
    "TeammateIdle": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/teammate-idle.sh" }]
      }
    ],
    "TaskCompleted": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/task-completed.sh" }]
      }
    ]
  }
}
```

- [ ] **Step 2: 写 session-start.sh（引导注入，参考 superpowers 模式）**

```bash
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
```

- [ ] **Step 3: 写 teammate-idle.sh（质量门强制，优雅降级）**

```bash
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
```

- [ ] **Step 4: 写 task-completed.sh（验收标准占位校验：任务完成事件防误标记）**

```bash
#!/bin/bash
# TaskCompleted：任务标记完成时提醒核对验收标准与质量门（不阻断，只注入反馈）
echo '{"hookSpecificOutput":{"hookEventName":"TaskCompleted","additionalContext":"任务完成前请确认：验收标准逐条达成且 quality-gate.sh 全绿。"}}'
exit 0
```

- [ ] **Step 5: 写 hooks-test.sh 并运行**

```bash
#!/bin/bash
set -u
cd "$(dirname "$0")/.."
PLUGIN_ROOT="$(pwd)"
PASS=0; FAIL=0

# session-start：输出合法 JSON 且含技能关键句
out=$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash hooks/session-start.sh)
if echo "$out" | grep -q '"hookEventName":"SessionStart"' && echo "$out" | grep -q 'nl-sdlc 任务路由'; then PASS=$((PASS+1)); echo "ok - session-start 注入"
else FAIL=$((FAIL+1)); echo "FAIL - session-start 输出异常: $out"; fi
echo "$out" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s)}catch(e){console.error("FAIL - 非 JSON");process.exit(1)}console.error("ok - session-start JSON 合法")}' 2>&1 | grep -q '^ok' && PASS=$((PASS+1)) || FAIL=$((FAIL+1))

# teammate-idle：非项目目录 → exit 0 放行（在插件根目录跑，无 pom.xml/package.json）
out=$(bash hooks/teammate-idle.sh 2>/dev/null); code=$?
if [ "$code" -eq 0 ]; then PASS=$((PASS+1)); echo "ok - teammate-idle 非项目目录放行"
else FAIL=$((FAIL+1)); echo "FAIL - teammate-idle 应放行 (exit $code)"; fi

# teammate-idle：伪造全绿 Maven 项目 → exit 0
S=$(mktemp -d); mkdir -p "$S/sub" && touch "$S/sub/pom.xml"
mkdir -p "$S/sub/target/site/jacoco" && printf 'a,Example,0,0,0,0,20,80\n' > "$S/sub/target/site/jacoco/jacoco.csv"
printf '#!/bin/bash\nexit 0\n' > "$S/mvn" && chmod +x "$S/mvn"
( cd "$S/sub" && PATH="$S:$PATH" bash "$PLUGIN_ROOT/hooks/teammate-idle.sh" >/dev/null 2>&1 ); code=$?
if [ "$code" -eq 0 ]; then PASS=$((PASS+1)); echo "ok - teammate-idle 全绿放行"
else FAIL=$((FAIL+1)); echo "FAIL - teammate-idle 全绿应 exit 0 (exit $code)"; fi
rm -rf "$S"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
```

Run: `bash hooks/hooks-test.sh`
Expected: `4 passed, 0 failed`。（若伪造 Maven 场景的路径拼接在实施中不成立，修正为插件根绝对路径后复跑。）

- [ ] **Step 6: 运行插件级校验** — Run: `claude plugin validate .`，Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add hooks/hooks.json hooks/session-start.sh hooks/teammate-idle.sh hooks/task-completed.sh hooks/hooks-test.sh
git commit -m "feat: hooks（SessionStart 元技能注入 + TeammateIdle 质量门强制）"
```

---

### Task 18: CI 流水线模板（三套）

**Files:**
- Create: `templates/ci/gitlab-ci.yml`
- Create: `templates/ci/Jenkinsfile`
- Create: `templates/ci/github-actions.yml`

**Interfaces:**
- Consumes: quality-gate.sh、run-tests.sh（Task 11/12/13）——模板中以仓库根相对路径引用
- Produces: 三套流水线：stages quality → test → docker；quality/test 失败即红；docker 仅全绿后执行

- [ ] **Step 1: 写 gitlab-ci.yml**

```yaml
# 使用说明：复制到项目根 .gitlab-ci.yml，runner 需支持 docker 执行器
stages: [quality, test, docker]

variables:
  MAVEN_IMAGE: maven:3.9-eclipse-temurin-17
  NODE_IMAGE: node:20

quality-backend:
  stage: quality
  image: $MAVEN_IMAGE
  script:
    - mvn checkstyle:check spotbugs:check test jacoco:report jacoco:check
    - mvn dependency-check:check
  artifacts:
    when: always
    reports:
      junit: target/surefire-reports/TEST-*.xml

quality-frontend:
  stage: quality
  image: $NODE_IMAGE
  script:
    - npm ci
    - npm run lint
    - npx vue-tsc --noEmit
    - npx vitest run --coverage
    - npm audit --audit-level=high

test-api:
  stage: test
  image: $NODE_IMAGE
  script:
    - npm i -g newman
    - newman run tests/api/*.postman_collection.json --reporters cli,junit --reporter-junit-export build/test-results/newman/report.xml
  artifacts:
    when: always
    reports:
      junit: build/test-results/newman/report.xml

test-e2e:
  stage: test
  image: mcr.microsoft.com/playwright:v1.40.0-jammy
  script:
    - npm ci
    - npx playwright install --with-deps chromium
    - npx playwright test
  artifacts:
    when: always
    paths: [test-results/]

docker-build:
  stage: docker
  image: docker:24
  services: [docker:24-dind]
  script:
    - docker build -f templates/docker/Dockerfile.java -t ${CI_REGISTRY_IMAGE}:${CI_COMMIT_TAG:-latest} .
    - docker build -f templates/docker/Dockerfile.vue -t ${CI_REGISTRY_IMAGE}-web:${CI_COMMIT_TAG:-latest} .
    - docker push ${CI_REGISTRY_IMAGE}:${CI_COMMIT_TAG:-latest}
    - docker push ${CI_REGISTRY_IMAGE}-web:${CI_COMMIT_TAG:-latest}
  only: [main, tags]

# 可选 AI 诊断 job（默认关闭：去掉注释启用，需配置 ANTHROPIC_API_KEY 变量）
# ai-report:
#   stage: test
#   image: $NODE_IMAGE
#   script:
#     - npm i -g @anthropic-ai/claude-code
#     - claude -p "分析本次流水线失败原因并输出诊断报告" --allowedTools "Bash,Read,Grep,Glob"
#   when: on_failure
```

- [ ] **Step 2: 写 Jenkinsfile（declarative，等价流水线）**

```groovy
pipeline {
  agent none
  environment { ANTHROPIC_API_KEY = credentials('anthropic-api-key') /* 仅 ai-report 需要 */ }
  stages {
    stage('quality-backend') {
      agent { docker { image 'maven:3.9-eclipse-temurin-17' } }
      steps {
        sh 'mvn checkstyle:check spotbugs:check test jacoco:report jacoco:check'
        sh 'mvn dependency-check:check'
      }
      post { always { junit 'target/surefire-reports/TEST-*.xml' } }
    }
    stage('quality-frontend') {
      agent { docker { image 'node:20' } }
      steps {
        sh 'npm ci && npm run lint && npx vue-tsc --noEmit && npx vitest run --coverage && npm audit --audit-level=high'
      }
    }
    stage('test-api') {
      agent { docker { image 'node:20' } }
      steps {
        sh 'npm i -g newman && newman run tests/api/*.postman_collection.json --reporters cli,junit --reporter-junit-export build/test-results/newman/report.xml'
      }
      post { always { junit 'build/test-results/newman/report.xml' } }
    }
    stage('test-e2e') {
      agent { docker { image 'mcr.microsoft.com/playwright:v1.40.0-jammy' } }
      steps {
        sh 'npm ci && npx playwright install --with-deps chromium && npx playwright test'
      }
      post { always { archiveArtifacts artifacts: 'test-results/**', allowEmptyArchive: true } }
    }
    stage('docker-build') {
      when { branch 'main' }
      steps {
        sh 'docker build -f templates/docker/Dockerfile.java -t registry/${env.JOB_NAME}:latest .'
        sh 'docker build -f templates/docker/Dockerfile.vue -t registry/${env.JOB_NAME}-web:latest .'
        sh 'docker push registry/${env.JOB_NAME}:latest && docker push registry/${env.JOB_NAME}-web:latest'
      }
    }
  }
}
```

- [ ] **Step 3: 写 github-actions.yml**

```yaml
name: nl-sdlc pipeline
on:
  push: { branches: [main] }
  pull_request:
jobs:
  quality-backend:
    runs-on: ubuntu-latest
    container: maven:3.9-eclipse-temurin-17
    steps:
      - uses: actions/checkout@v4
      - run: mvn checkstyle:check spotbugs:check test jacoco:report jacoco:check
      - run: mvn dependency-check:check
  quality-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run lint && npx vue-tsc --noEmit && npx vitest run --coverage && npm audit --audit-level=high
  test-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm i -g newman && newman run tests/api/*.postman_collection.json --reporters cli,junit --reporter-junit-export build/test-results/newman/report.xml
  test-e2e:
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v1.40.0-jammy
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npx playwright install --with-deps chromium && npx playwright test
  docker-build:
    needs: [quality-backend, quality-frontend, test-api, test-e2e]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - run: docker build -f templates/docker/Dockerfile.java -t ${REGISTRY}/${GITHUB_REPOSITORY}:latest .
      - run: docker build -f templates/docker/Dockerfile.vue -t ${REGISTRY}/${GITHUB_REPOSITORY}-web:latest .
```

- [ ] **Step 4: 语法校验**

Run: `node scripts/validate-plugin.mjs` → PASS（模板不在校验范围，仍跑一遍确认无回归）。
Run: YAML 语法检查：`node -e "const y=require('fs').readFileSync('templates/ci/gitlab-ci.yml','utf8'); if(!y.includes('stages:')) process.exit(1); console.log('ok')"` → `ok`（实施环境若无 yaml 库，此浅校验即可）。

- [ ] **Step 5: Commit**

```bash
git add templates/ci
git commit -m "feat: CI 流水线模板（GitLab CI/Jenkins/GitHub Actions 三套）"
```

---

### Task 19: Dockerfile 模板

**Files:**
- Create: `templates/docker/Dockerfile.java`
- Create: `templates/docker/Dockerfile.vue`

**Interfaces:**
- Consumes: 无
- Produces: 多阶段构建镜像；标签策略 `{registry}/{project}:{版本}-{commit}`（由 CI 模板拼接）

- [ ] **Step 1: 写 Dockerfile.java**

```dockerfile
# Java 后端镜像：Maven 多阶段构建 → JRE 精简运行镜像
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml ./
RUN mvn -q dependency:go-offline
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

- [ ] **Step 2: 写 Dockerfile.vue**

```dockerfile
# Vue 前端镜像：Node 构建 → Nginx 静态服务（含 SPA history 路由）
FROM node:20 AS build
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.25-alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

并在同目录写 `templates/docker/nginx.conf`：

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
}
```

- [ ] **Step 3: Commit**

```bash
git add templates/docker
git commit -m "feat: Dockerfile 模板（Java 多阶段构建 + Vue/Nginx）"
```

---

### Task 20: references 共享清单 + README

**Files:**
- Create: `references/definition-of-done.md`
- Create: `references/security-checklist.md`
- Create: `references/testing-checklist.md`
- Create: `README.md`（覆盖原内容）

**Interfaces:**
- Consumes: 全局约束中的阈值与流程（本任务把它们固化为共享清单，供各 skill/persona 引用）
- Produces: 安装与使用文档

- [ ] **Step 1: 写 definition-of-done.md**

```markdown
# Definition of Done（任务完成定义）

一个任务只有同时满足以下全部条件才算完成：

1. 实现代码存在且关联测试全部通过
2. `bash scripts/quality-gate.sh --scope all` 输出 overall=pass（Java：checkstyle 0 违规 / spotbugs 0 高危中危 / jacoco ≥80% / 无高危依赖漏洞；Vue：ESLint 0 error / vue-tsc 通过 / Vitest ≥70% / npm audit 无高危）
3. 验收标准逐条达成并有测试或证据对应
4. 测试用例清单中的用例已落地（tests/api/ 或 tests/e2e/）
5. 变更已提交 git
```

- [ ] **Step 2: 写 security-checklist.md**

```markdown
# 安全检查清单

- 输入校验：所有外部输入（请求参数、文件上传、前端输入）有服务端校验
- 注入防护：SQL 使用参数化查询；禁止字符串拼接命令执行
- XSS：前端渲染使用 Vue 默认插值，禁用 v-html 拼接未净化内容
- 认证授权：接口有认证与资源归属校验，无越权路径
- 敏感数据：日志/异常/响应不输出密钥、令牌、身份证号等
- 依赖：Dependency-Check 无高危漏洞；npm audit --audit-level=high 通过
- 反序列化/SSRF：不受信数据不直接反序列化；服务端请求 URL 白名单
```

- [ ] **Step 3: 写 testing-checklist.md**

```markdown
# 测试检查清单

- 接口用例：Postman collection 存 tests/api/，命名含 AC 编号，断言覆盖状态码/结构/关键字段
- E2E 用例：Playwright spec 存 tests/e2e/，可从 baseUrl 独立运行，不依赖执行顺序
- 用例可重复运行：干净环境可跑通；CI 中无头执行
- 失败分类：先判服务 bug 还是用例问题，再决定打回或修用例
- 追溯：每个用例可映射到 AC 编号
```

- [ ] **Step 4: 写 README.md**

```markdown
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
| `/nl-sdlc:code` `/nl-sdlc:review` `/nl-sdlc:ship` | 交互式单阶段入口 |

## 质量门（默认阈值，`templates/config/quality-gate.yaml` 可调）

Java: checkstyle(P3C) 0 违规 · spotbugs 0 高危/中危 · jacoco ≥80% · 无高危依赖漏洞
Vue: ESLint 0 error · vue-tsc 通过 · Vitest ≥70% · npm audit 无高危

## CI 集成

复制 `templates/ci/` 下对应模板到项目（GitLab CI / Jenkins / GitHub Actions）。
CI 硬关卡 = quality + test 两个 stage；`ai-report` job 可选开启（失败时 AI 诊断，需配置 ANTHROPIC_API_KEY）。CI 不自动改代码。

## 实验性声明

agent-teams 功能依赖 Claude Code 实验特性（CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1），
存在会话无法恢复等已知限制；workflow 路径是稳定的兜底方案。
```

- [ ] **Step 5: 全量校验与回归**

Run: `node scripts/validate-plugin.mjs` → PASS（6 skills、4 agents、3 commands、3 workflows）。
Run: `bash scripts/quality-gate-test.sh` → `6 passed, 0 failed`。
Run: `bash scripts/run-tests-test.sh` → `3 passed, 0 failed`。
Run: `bash hooks/hooks-test.sh` → `4 passed, 0 failed`。
Run: `claude plugin validate .` → 通过。

- [ ] **Step 6: Commit**

```bash
git add references README.md
git commit -m "docs: 共享清单（DoD/安全/测试）+ README 安装与 CI 集成指南"
```

---

## 完成标准（全部任务后）

- [ ] `claude plugin validate .` 通过
- [ ] 三个测试脚本全绿：quality-gate-test.sh（7）、run-tests-test.sh（3）、hooks-test.sh（4）
- [ ] `node scripts/validate-plugin.mjs` 报告 6 skills / 4 agents / 3 commands / 3 workflows
- [ ] 在演示项目（Maven 后端 + Vue 前端）中完成一次端到端演练：`/nl-sdlc:requirement` → `/nl-sdlc:development` → `/nl-sdlc:test` → CI 模板跑通 → Docker 镜像构建成功
