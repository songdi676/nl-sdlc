export const meta = {
  name: 'test-flow',
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

// args 兼容两种形态：斜杠命令传入的字符串（`/nl-sdlc:test-flow --base-url http://host:8080`），
// 或 Workflow 工具显式传入的对象（args={baseUrl:"http://host:8080"}）。
let baseUrl = ''
if (args && typeof args === 'string') {
  const m = args.match(/--base-url\s+(\S+)/)
  if (m) baseUrl = m[1]
} else if (args && typeof args === 'object' && args.baseUrl) {
  baseUrl = String(args.baseUrl)
}
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
// 跟踪最后一轮 rerun 结果：修复成功后 return 的是 rerun 的 pass 对象，
// 避免返回首轮陈旧 fail 对象导致消费方误判
let lastApi = null
let lastE2e = null
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
    if (rerun && rerun.overall === 'pass') { lastApi = rerun; fixes.push({ phase: 'api', round, rerun: 'pass' }); break }
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
    if (rerun && rerun.overall === 'pass') { lastE2e = rerun; fixes.push({ phase: 'e2e', round, rerun: 'pass' }); break }
    fixes.push({ phase: 'e2e', round, rerun: rerun ? rerun.overall : 'error' })
  }
}

return { result: 'done', api: lastApi || apiResult, e2e: lastE2e || e2eResult, fixes }
