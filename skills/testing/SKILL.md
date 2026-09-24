---
name: testing
description: Use when writing, fixing, or executing API test cases (Postman/Newman under tests/api/) or end-to-end test cases (Playwright under tests/e2e/), or when diagnosing a failed test run
---

# 测试用例治理

## Overview

测试用例与代码同等管理：存仓库、版本化、可重复运行。接口测试用 Postman collection + Newman（`tests/api/`），E2E 用 Playwright TypeScript（`tests/e2e/`）。用例来源是 tasks.md 中的用例清单；每个用例可追溯到需求编号（US/AC 编号写入用例名或测试注释）。

铁律：用例即资产，只修不删。用例清单里的每一条都必须落地为可运行用例——没有用例覆盖的验收标准不算完成。

## 编写规范

### Postman collection（tests/api/）

- 文件名：`tests/api/<feature>.postman_collection.json`，环境文件 `tests/api/<env>.postman_environment.json`
- 每个请求命名：`AC-xx 描述`（溯源验收标准）
- 断言写在 test 脚本：状态码、响应结构、关键字段
- 新建用例后运行 `npx newman run <collection> -e <env> --reporters cli,junit --reporter-junit-export build/test-results/newman/<feature>.xml` 验证

补充规则：token、密码等敏感信息只放环境变量文件，禁止进 collection；请求地址一律引用环境变量，不得硬编码具体环境。

### Playwright（tests/e2e/）

- 文件：`tests/e2e/<feature>.spec.ts`，describe/test 命名含 AC 编号
- 每个用例必须能从 baseUrl 环境变量独立运行，禁止依赖其他用例的执行顺序
- 失败自动截图：playwright.config.ts 中 `use: { screenshot: 'only-on-failure', video: 'retain-on-failure' }`
- 运行：`npx playwright test`；单用例：`npx playwright test tests/e2e/<feature>.spec.ts`

补充规则：等待用 web-first 断言（如 `expect(locator).toBeVisible()`），禁止 sleep 固定时长；定位器优先 role/text，少用脆弱的深层 CSS 选择器。

## 失败诊断流程

1. 读取失败报告与截图/录像
2. 判定失败类别：**服务 bug**（响应与设计不符、报错堆栈指向服务端）→ 打回开发附诊断；**用例问题**（选择器失效、断言写错、环境配置错误）→ 修复用例后重跑
3. 修复后单用例验证通过，再全量重跑确认无回归

判定靠证据不靠猜：没有截图/录像/响应体佐证的「偶发失败」按用例问题处理，修复后连续两次全量重跑无重现才可关闭。

## Red Flags

| 想法 | 现实 |
|---|---|
| "用例失败就删掉" | 用例即资产，只修不删（除非需求已变更） |
| "接口手工点过就行" | 用例必须可重复运行，手工验证不算数 |
| "E2E 太慢跳过" | E2E 是页面功能的验收手段，在 CI 无头运行 |

## Verification

- [ ] 每个用例可追溯到 AC 编号
- [ ] 全量用例在干净环境可重复跑通
