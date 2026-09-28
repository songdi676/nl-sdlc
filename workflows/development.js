export const meta = {
  name: 'dev-flow',
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
    error: { type: 'string' },
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
const featureArg = args && args.feature ? args.feature : '未指定'
const taskDoc = await agent(
  `读取 docs/plans/ 下目标 feature 的 tasks.md。用户指定的 feature 名：${featureArg}；若为 未指定 则列出 docs/plans/ 下所有 feature 让用户选择最近一个。解析其 YAML frontmatter，返回 feature 名与 tasks 数组。若文件缺失或 frontmatter 缺 tasks 字段，必须返回 {feature:'', tasks:[], error:'<缺失的路径与字段>'} 形态（error 写具体缺失路径与字段），不得编造任务。`,
  { label: 'read-tasks', schema: TASKS_SCHEMA },
)
if (!taskDoc || !taskDoc.tasks || !taskDoc.tasks.length) {
  // 错误形态 {feature:'', tasks:[], error:...} 满足 schema（error 未入 required，tasks 可为空数组），此分支原样透出具体缺失路径与字段
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
