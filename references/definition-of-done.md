# Definition of Done（任务完成定义）

一个任务只有同时满足以下全部条件才算完成：

1. 实现代码存在且关联测试全部通过
2. `bash scripts/quality-gate.sh --scope all` 输出 overall=pass（Java：checkstyle 0 违规 / spotbugs 0 高危中危 / jacoco ≥80% / 无高危依赖漏洞；Vue：ESLint 0 error / vue-tsc 通过 / Vitest ≥70% / npm audit 无高危）
3. 验收标准逐条达成并有测试或证据对应
4. 测试用例清单中的用例已落地（tests/api/ 或 tests/e2e/）
5. 变更已提交 git
