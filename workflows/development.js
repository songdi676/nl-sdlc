export const meta = {
  name: 'dev-flow',
  description: '按 tasks.md 编码→质量门打回循环→三视角评审（按依赖并行）',
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
const DEV_SCHEMA = {
  type: 'object',
  required: ['touched_code', 'summary'],
  properties: {
    touched_code: { type: 'boolean' },
    changed_files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

// ---- Phase 1: 任务读取 ----
phase('任务读取')
// args 可能是斜杠命令传入的字符串（`/nl-sdlc:dev-flow 用户登录` → args="用户登录"），
// 也可能是 Workflow 工具显式传入的对象（args={feature:"用户登录"}）；两种形态都兼容，
// 否则 featureArg 恒为「未指定」导致 feature 名丢失（与 requirement.js 的字符串处理保持一致）。
let featureArg = '未指定'
if (args && typeof args === 'string' && args.trim()) featureArg = args.trim()
else if (args && typeof args === 'object' && args.feature) featureArg = String(args.feature)
const taskDoc = await agent(
  `读取 docs/plans/ 下目标 feature 的 tasks.md。用户指定的 feature 名：${featureArg}；若为 未指定 则自动选择 docs/plans/ 下唯一（或最近创建的）feature。解析其 YAML frontmatter，返回 feature 名与 tasks 数组。若文件缺失或 frontmatter 缺 tasks 字段，必须返回 {feature:'', tasks:[], error:'<缺失的路径与字段>'} 形态（error 写具体缺失路径与字段），不得编造任务。`,
  { label: 'read-tasks', schema: TASKS_SCHEMA, phase: '任务读取' },
)
if (!taskDoc || !taskDoc.tasks || !taskDoc.tasks.length) {
  // 错误形态 {feature:'', tasks:[], error:...} 满足 schema（error 未入 required，tasks 可为空数组），此分支原样透出具体缺失路径与字段
  return { result: 'no-tasks', error: taskDoc && taskDoc.error ? taskDoc.error : 'tasks.md 无任务或不可解析' }
}
const tasks = taskDoc.tasks.map((t) => ({ ...t, deps: t.deps || [] }))
const byId = new Map(tasks.map((t) => [t.id, t]))
log(`共 ${tasks.length} 个任务`)

// ---- 依赖拓扑分层（Kahn）----
const missingDeps = tasks.flatMap((t) => t.deps.filter((d) => !byId.has(d)))
if (missingDeps.length) {
  return { result: 'error', feature: taskDoc.feature, error: 'tasks.md 中存在不存在的依赖 id：' + [...new Set(missingDeps)].join(', ') }
}
const levels = []
const inDegree = new Map(tasks.map((t) => [t.id, t.deps.length]))
const children = new Map(tasks.map((t) => [t.id, []]))
for (const t of tasks) for (const d of t.deps) children.get(d).push(t.id)
let frontier = tasks.filter((t) => t.deps.length === 0).map((t) => t.id)
while (frontier.length) {
  levels.push(frontier)
  const next = []
  for (const id of frontier) {
    for (const c of children.get(id)) {
      inDegree.set(c, inDegree.get(c) - 1)
      if (inDegree.get(c) === 0) next.push(c)
    }
  }
  frontier = next
}
if (levels.reduce((n, l) => n + l.length, 0) < tasks.length) {
  const seen = new Set(levels.flat())
  const leftover = tasks.filter((t) => !seen.has(t.id)).map((t) => t.id)
  return { result: 'error', feature: taskDoc.feature, error: '任务依赖存在环，无法拓扑排序：' + leftover.join(', ') }
}

// ---- 工具函数 ----
const MAX_FIX_ROUNDS = 2

async function devAgent(t) {
  const dev = await agent(
    `你是 dev-engineer，遵循 nl-sdlc:coding skill 实现任务。\n任务: ${JSON.stringify(t)}\nfeature: ${taskDoc.feature}\n详细设计: docs/plans/${taskDoc.feature}/详细设计.md\n\n完成后判断：本任务是否产生了会影响质量门（编译/静态检查/覆盖率）的代码或构建配置改动？是则 touched_code=true，否则（纯文档/说明类）false；并把改动文件列到 changed_files。`,
    { label: 'dev-' + t.id, phase: '编码', schema: DEV_SCHEMA },
  )
  return { id: t.id, dev }
}

async function gateAgent(id, round) {
  return agent(
    `运行 bash scripts/quality-gate.sh --scope all，把 stdout 的 JSON 报告原样返回（含 overall）。（workflow 判定一律全量 --scope all；编码期自检可用 --scope 单侧，两者不矛盾。）`,
    { label: 'gate-' + id + (round ? '-r' + round : ''), phase: '质量门', schema: GATE_SCHEMA },
  )
}

async function gateWithFix(id) {
  let gate = await gateAgent(id, 0)
  let rounds = 0
  while (gate && gate.overall === 'fail' && rounds < MAX_FIX_ROUNDS) {
    await agent(
      `质量门失败，按失败详情修复任务 ${id} 的代码（遵循 nl-sdlc:coding skill，修复后运行相关测试）。失败详情: ${JSON.stringify(gate)}`,
      { label: 'fix-' + id + '-r' + (rounds + 1), phase: '质量门' },
    )
    gate = await gateAgent(id, rounds + 1)
    rounds++
  }
  return { gate, failed: !gate || gate.overall === 'fail', fixRounds: rounds }
}

async function reviewTask(id) {
  const t = byId.get(id)
  const reviews = await parallel([
    () => agent(`你是 code-reviewer，遵循 nl-sdlc:code-review skill 评审任务 ${id}（${t.title}）的变更，对照其验收标准 ${JSON.stringify(t.acceptance)} 输出分级问题报告。`, { label: 'review-correctness-' + id, phase: '评审' }),
    () => agent(`你是 security-auditor，对任务 ${id}（${t.title}）的变更做安全审查（OWASP Top 10），输出发现清单。（此步即 spec §6.1 质量门"AI security-auditor 代码审查"部分的执行点，与脚本门的 Dependency-Check 共同构成完整安全门。）`, { label: 'review-security-' + id, phase: '评审' }),
    () => agent(`你是 code-reviewer，从可读性与架构视角评审任务 ${id}（${t.title}）的变更，输出分级问题报告。`, { label: 'review-architecture-' + id, phase: '评审' }),
  ])
  return { task: id, reviews }
}

// ---- Phase 2+3: 编码 + 质量门（按依赖层级：层内 dev 并行 → 层内 gate 并行；层间 gate 完成才放行依赖层）----
const taskResults = new Map()
const allReviews = []
let pendingReviews = []

for (const level of levels) {
  // 同一 parallel 里并行跑「本层全部 dev」+「上一层遗留的评审」，实现评审与下一层开发重叠
  const devCount = level.length
  const combined = await parallel([
    ...level.map((id) => () => devAgent(byId.get(id))),
    ...pendingReviews.splice(0),
  ])
  const devDone = combined.slice(0, devCount)
  const reviewDone = combined.slice(devCount)
  allReviews.push(...reviewDone.filter(Boolean))

  // 归集本层 dev 结果：区分「涉代码（要过门）」/「无代码（跳过门与评审）」/「dev 失败」
  const devById = new Map()
  const toGate = []
  for (let i = 0; i < level.length; i++) {
    const id = level[i]
    const dev = devDone[i] ? devDone[i].dev : null
    if (!dev) { taskResults.set(id, { task: id, dev: null, failed: true, skipped: false }); continue }
    devById.set(id, dev)
    if (!dev.touched_code) { taskResults.set(id, { task: id, dev, failed: false, skipped: true, skipReason: 'no-code' }); continue }
    toGate.push(id)
  }

  // 本层质量门（此时层内 dev 全部完成、上一层 gate 已过，仓库处于一致状态）
  const gateResults = await parallel(toGate.map((id) => () => gateWithFix(id)))
  for (let i = 0; i < toGate.length; i++) {
    const id = toGate[i]
    const g = gateResults[i]
    const gate = g ? g.gate : null
    const failed = g ? g.failed : true
    taskResults.set(id, { task: id, dev: devById.get(id), gate, failed, skipped: false, fixRounds: g ? g.fixRounds : 0 })
    if (!failed) pendingReviews.push(() => reviewTask(id))
  }
}

// 最后一层无后继，遗留评审单独并行跑完
phase('评审')
const tail = await parallel(pendingReviews.splice(0))
allReviews.push(...tail.filter(Boolean))

const orderedResults = tasks.map((t) => taskResults.get(t.id)).filter(Boolean)
return {
  result: 'done',
  feature: taskDoc.feature,
  taskResults: orderedResults,
  reviews: allReviews,
  note: 'Critical 问题需打回；合并前需人工批准（见 nl-sdlc:delivery skill）',
}
