export const meta = {
  name: 'dev-task',
  description: '单任务开发单元：worktree 内 TDD 编码→质量门打回循环→三视角评审（由 /nl-sdlc:dev-flow 主 agent 按依赖分层并行调度）',
  phases: [
    { title: '编码' },
    { title: '质量门' },
    { title: '评审' },
  ],
}

const DEV_SCHEMA = {
  type: 'object',
  required: ['touched_code', 'summary'],
  properties: {
    touched_code: { type: 'boolean' },
    changed_files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    error: { type: 'string' },
  },
}
const GATE_SCHEMA = {
  type: 'object',
  required: ['overall'],
  properties: { overall: { type: 'string', enum: ['pass', 'fail'] } },
}

// dev-task 是单任务开发单元：任务读取、依赖分层、worktree 建/合/删都由主 agent
// （/nl-sdlc:dev-flow 编排协议）完成；本 workflow 不读任务文件、不建 worktree。
// args = { feature, task: {id,title,deps,acceptance,test_cases,description}, worktreePath, branch, base, mainTreePath }
//   worktreePath  任务 worktree 绝对路径（主 agent 已 git worktree add）
//   branch        worktree 内任务分支（dev/<feature>/<task-id>）
//   base          worktree 分叉出的基线 commit sha（评审 diff 范围 = base..HEAD）
//   mainTreePath  主树绝对路径（供复制 .env 等未跟踪文件）
if (!args || typeof args !== 'object' || !args.task || !args.task.id || !args.worktreePath || !args.branch || !args.base) {
  return {
    result: 'error',
    error: 'dev-task 需要对象参数 {feature, task, worktreePath, branch, base, mainTreePath}；批量开发请运行 /nl-sdlc:dev-flow <feature>，由主 agent 读取 tasks.md、按依赖分层并创建 worktree 后调度本 workflow。不要把 feature 名直接传给本 workflow。',
  }
}
const { feature, task: t, worktreePath, branch, base, mainTreePath } = args
log(`任务 ${t.id}: ${t.title}（worktree: ${worktreePath}）`)

const MAX_FIX_ROUNDS = 2

// agent() 在 API 错误（如上下文超长 500）时会直接 reject；若不捕获，异常会杀死整个 run。
// 统一转为 {result:null, error}，由调用方标记失败并透出错误摘要。
async function safeAgent(prompt, opts) {
  try {
    return { result: await agent(prompt, opts), error: null }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    log(`${(opts && opts.label) || 'agent'} 执行失败：${msg}`)
    return { result: null, error: msg }
  }
}

// 上下文预算纪律：长构建/测试输出必须先落盘再 tail，防止转录膨胀撞爆模型上下文上限。
const CONTEXT_BUDGET_RULE = '上下文预算纪律（必须遵守）：mvn/npm/pnpm 等构建、测试、质量门的长输出一律先重定向到文件再只取尾部（如 mvn -q test > .build.log 2>&1 && tail -n 40 .build.log），禁止把超长输出直接留在对话里，也禁止 cat 大文件（用 Read 的 offset/limit 只读相关片段）。'

// ---- Phase 1: 编码（worktree 内 TDD）----
phase('编码')
const devCall = await safeAgent(
  [
    '你是 dev-engineer，遵循 nl-sdlc:coding skill 实现任务。',
    `工作目录: ${worktreePath}（git worktree，分支 ${branch}）。所有读写、构建、测试、提交都发生在这个目录内，不得改动主树（${mainTreePath || '仓库主工作树'}）里的任何文件。`,
    '第 0 步 环境引导（缺什么补什么）：',
    `1. cd ${worktreePath}`,
    '2. 存在 package.json 且缺 node_modules → 运行 npm ci（无 package-lock.json 时回退 npm install，并在 summary 注明回退）',
    mainTreePath ? `3. 主树 ${mainTreePath} 存在而本 worktree 缺失的 .env* / quality-gate.yaml / scripts/quality-gate.sh，复制进来（只复制，不改动主树）` : '',
    `任务: ${JSON.stringify(t)}`,
    `feature: ${feature}`,
    `详细设计: ${worktreePath}/docs/plans/${feature}/详细设计.md`,
    CONTEXT_BUDGET_RULE,
    '要求：',
    '- 若 worktree 内已有本任务的历史改动（git status / git log 可见），基于现状继续，不要推倒重来',
    '- TDD：先写失败测试再实现；运行测试确认通过',
    '- 完成前确保质量门要读的覆盖率产物已生成：Java 侧 mvn test jacoco:report；Vue 侧 npx vitest run --coverage',
    `- 全部改动 git add + commit 到分支 ${branch}（提交信息: feat(${t.id}): ${t.title}）`,
    '- 完成后判断 touched_code：本任务是否产生了会影响质量门（编译/静态检查/覆盖率）的代码或构建配置改动？是则 true，否则（纯文档/说明类）false；改动文件列入 changed_files',
  ].filter(Boolean).join('\n'),
  { label: 'dev-' + t.id, phase: '编码', schema: DEV_SCHEMA },
)
const dev = devCall.result
if (!dev) return { result: 'error', feature, task: t.id, branch, worktreePath, devError: devCall.error || 'no-result', error: 'dev agent 未返回结果' + (devCall.error ? '：' + devCall.error : '') }
if (dev.error) return { result: 'error', feature, task: t.id, branch, worktreePath, error: dev.error }
if (!dev.touched_code) {
  return {
    result: 'no-code', feature, task: t.id, branch, worktreePath,
    touched_code: false, changed_files: dev.changed_files || [], summary: dev.summary,
    note: '纯文档/说明类任务，跳过质量门与评审',
  }
}

// ---- Phase 2: 质量门（worktree 内全量 + 打回修复 ≤2 轮）----
phase('质量门')
async function gateAgent(round) {
  const { result, error } = await safeAgent(
    `在 ${worktreePath} 内运行 bash scripts/quality-gate.sh --scope all，把 stdout 的 JSON 报告原样返回（含 overall）。（workflow 判定一律全量 --scope all；编码期自检可用 --scope 单侧，两者不矛盾。）${CONTEXT_BUDGET_RULE}`,
    { label: 'gate-' + t.id + (round ? '-r' + round : ''), phase: '质量门', schema: GATE_SCHEMA },
  )
  return { report: result, error }
}
let g = await gateAgent(0)
let gate = g.report
let gateError = g.error
let fixRounds = 0
while (gate && gate.overall === 'fail' && fixRounds < MAX_FIX_ROUNDS) {
  await safeAgent(
    `质量门失败，在 ${worktreePath} 内按失败详情修复任务 ${t.id} 的代码（遵循 nl-sdlc:coding skill；修复后运行相关测试、重新生成覆盖率产物，并把改动 commit 到分支 ${branch}）。失败详情: ${JSON.stringify(gate)}${CONTEXT_BUDGET_RULE}`,
    { label: 'fix-' + t.id + '-r' + (fixRounds + 1), phase: '质量门' },
  )
  g = await gateAgent(fixRounds + 1)
  gate = g.report
  gateError = g.error
  fixRounds++
}
if (!gate || gate.overall === 'fail') {
  return {
    result: 'gate-failed', feature, task: t.id, branch, worktreePath,
    touched_code: true, changed_files: dev.changed_files || [], gate, gateError, fixRounds, summary: dev.summary,
    note: 'worktree 保留未合入；修复后以相同 args 重跑 dev-task（复用该 worktree）',
  }
}

// ---- Phase 3: 评审（三视角并行，范围 = base..HEAD 分支 diff）----
phase('评审')
const diffCmd = `在 ${worktreePath} 内运行 git diff ${base}..HEAD 查看全部变更`
const reviews = await parallel([
  () => safeAgent(`你是 code-reviewer，遵循 nl-sdlc:code-review skill。评审范围: ${diffCmd}（任务 ${t.id} ${t.title} 的全部变更），对照其验收标准 ${JSON.stringify(t.acceptance || [])} 输出分级问题报告。`, { label: 'review-correctness-' + t.id, phase: '评审' }).then((r) => ({ perspective: 'correctness', ...r })),
  () => safeAgent(`你是 security-auditor。评审范围: ${diffCmd}（任务 ${t.id} ${t.title} 的全部变更），做安全审查（OWASP Top 10），输出发现清单。（此步即 spec §6.1 质量门"AI security-auditor 代码审查"部分的执行点，与脚本门的 Dependency-Check 共同构成完整安全门。）`, { label: 'review-security-' + t.id, phase: '评审' }).then((r) => ({ perspective: 'security', ...r })),
  () => safeAgent(`你是 code-reviewer。评审范围: ${diffCmd}（任务 ${t.id} ${t.title} 的全部变更），从可读性与架构视角输出分级问题报告。`, { label: 'review-architecture-' + t.id, phase: '评审' }).then((r) => ({ perspective: 'architecture', ...r })),
])
return {
  result: 'done', feature, task: t.id, branch, worktreePath,
  touched_code: true, changed_files: dev.changed_files || [], gate, fixRounds, summary: dev.summary,
  reviews: reviews.filter(Boolean),
  note: '主 agent 可把分支 ' + branch + ' 合入主树当前分支；Critical 评审问题需打回修复；交付合并前需人工批准（见 nl-sdlc:delivery skill）',
}
