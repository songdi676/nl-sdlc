# 测试检查清单

- 接口用例：Postman collection 存 tests/api/，命名含 AC 编号，断言覆盖状态码/结构/关键字段
- E2E 用例：Playwright spec 存 tests/e2e/，可从 baseUrl 独立运行，不依赖执行顺序
- 用例可重复运行：干净环境可跑通；CI 中无头执行
- 失败分类：先判服务 bug 还是用例问题，再决定打回或修用例
- 追溯：每个用例可映射到 AC 编号
