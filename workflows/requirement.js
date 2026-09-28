export const meta = {
  name: 'requirement-flow',
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
const fileArg = args && typeof args === 'string' ? args.trim() : '未指定'
const reqFiles = await agent(
  `列出 docs/requirements/ 目录下所有 .md 需求文档的路径；若用户指定了文件（用户输入: ${fileArg}，非"未指定"时从中提取文件名/路径），只列该文件。同时返回今天的日期（YYYY-MM-DD 格式，从你的系统时间读取）。无文档时 files 返回空数组。`,
  { label: 'list-requirements', schema: { type: 'object', required: ['files', 'today'], properties: { files: { type: 'array', items: { type: 'string' } }, today: { type: 'string' } } } },
)
if (!reqFiles || !reqFiles.files.length) {
  log('docs/requirements/ 下没有需求文档，流程终止')
  return { result: 'no-requirements' }
}
const analysis = await agent(
  `遵循 nl-sdlc:requirement-analysis skill，分析以下需求文档并输出结构化需求（feature 名、用户故事、验收标准、待澄清问题）。注意：feature 字段只写简短功能名（如「用户登录」），禁止把来源文档标注写进 feature（来源标注只用于用户故事/验收标准等条目）。文档: ${reqFiles.files.join(', ')}`,
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
// 修复 brief 原缺陷：prevRound 若在循环体内用 const 声明，第 2 轮引用时处于 TDZ，抛 ReferenceError；改为循环外 let 声明
let prevRound = null
for (let round = 1; round <= 3; round++) {
  const votes = await parallel(PERSPECTIVES.map((p, i) => () =>
    agent(`你是质疑者 ${i + 1}（${p}）。对以下概要设计投票 pass/reject，reject 必须给出具体质疑理由。${round > 1 ? '这是第 ' + round + ' 轮：参考上一轮其他质疑者的意见，若设计已回应你的质疑可改投 pass。上一轮意见: ' + JSON.stringify(prevRound) : ''}\n设计: ${JSON.stringify(design)}`,
      { label: 'challenger-' + (i + 1) + '-r' + round, schema: VOTE_SCHEMA }),
  ))
  prevRound = votes
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
