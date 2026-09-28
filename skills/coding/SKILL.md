---
name: coding
description: Use when implementing any task from docs/plans/<feature>/tasks.md in Java (Maven) or Vue 3 (Vite+TypeScript), before writing implementation code
---

# TDD 编码规范

## Overview

所有编码遵循 TDD：先写失败测试 → 实现最小代码 → 测试通过 → 重构。Java 用 JUnit 5 + Mockito，Vue 用 Vitest + Vue Test Utils。未过质量门的代码不得视为完成。

铁律：先测后码，顺序不可逆。没亲眼看到测试失败，就不算写过测试——测试一写就通过，说明它测的是已有行为，不是本任务要的新行为。

## 流程

1. 读取当前任务
   - 从 `docs/plans/<feature>/tasks.md` 取当前任务，确认验收标准与关联测试用例清单齐全
   - 任务缺字段（验收标准 / 测试用例清单）→ 报错并指明文件与缺失字段，不得静默跳过
2. 写失败测试（JUnit 5 / Vitest）
   - 按清单为每条验收标准写失败测试：Java 用 JUnit 5（Mockito 仅用于外部边界），Vue 用 Vitest + Vue Test Utils
   - 运行测试确认失败，且失败原因是功能缺失，不是语法或拼写错误
3. 实现最小代码使测试通过
   - 只写让测试通过的最小实现；测试没要求的「顺手优化」一律不做
4. 重构
   - 消除重复、改进命名，保持代码与 tests 目录内用例同步；每次重构后重跑测试确认全绿
5. 过质量门
   - 运行 `bash scripts/quality-gate.sh --scope <backend|frontend>`，全绿才提交
   - 单仓同时含 pom.xml 与 package.json 时必须用 --scope 限定当前改动侧
   - 未过门 → 修复 → 重跑；连续 2 轮无进展 → 任务失败并附诊断

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

阈值默认值（Java 80 / Vue 70）可被项目根的 `quality-gate.yaml` 覆盖（脚本自动查找项目根 `quality-gate.yaml`，其次 `templates/config/quality-gate.yaml`，也可 `--thresholds <文件>` 显式指定）；quality-gate.sh 在显式指定的阈值文件缺失时回退内置默认值并在报告 warnings 注明，此时按 warning 提示修正配置，不得假装没看见。

## Red Flags

| 想法 | 现实 |
|---|---|
| "先写实现，测试后补" | TDD 顺序不可逆，先测后码 |
| "这行代码不用测" | 验收标准涉及的代码路径必须有用例 |
| "质量门差一点没关系" | 阈值是硬性条件，不达标打回 |
| "测试写过了，失败原因不重要" | 失败原因必须是功能缺失，语法/拼写错误不算 RED |
| "重构后测试不用重跑" | 每次重构后重跑测试，绿了才进入下一步 |

## Verification

- [ ] 每个任务关联的测试用例清单已全部落地为可运行用例
- [ ] 每个测试都先失败、后通过（失败原因是功能缺失）
- [ ] `quality-gate.sh` 对应 scope 全绿
- [ ] tests 目录内用例与实现代码同步，无跳过、无孤儿测试
