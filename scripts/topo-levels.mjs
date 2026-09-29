#!/usr/bin/env node
// 任务依赖拓扑分层（Kahn）：供主 agent 的 /nl-sdlc:dev-flow 编排使用，避免 LLM 心算依赖图。
// 用法: node scripts/topo-levels.mjs [tasks.json]   （不带文件参数时从 stdin 读）
// 输入: JSON 任务数组，每项至少 {id: string, deps?: string[]}（多余字段忽略）
// 输出: stdout 单行 JSON —— 成功 {"levels":[["t1","t2"],["t3"]]}；失败 {"error":"..."} 且退出码 1
import { readFileSync } from 'node:fs';

const die = (error) => {
  console.log(JSON.stringify({ error }));
  process.exit(1);
};

const raw = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
let tasks;
try {
  tasks = JSON.parse(raw);
} catch (e) {
  die('输入不是合法 JSON：' + e.message);
}
if (!Array.isArray(tasks) || !tasks.length) die('输入应为非空任务数组');
for (const t of tasks) {
  if (!t || typeof t.id !== 'string' || !t.id) die('存在缺 id 的任务');
}
const ids = tasks.map((t) => t.id);
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
if (dup.length) die('存在重复的任务 id: ' + [...new Set(dup)].join(', '));
const set = new Set(ids);
const missing = tasks.flatMap((t) => (t.deps || []).filter((d) => !set.has(d)));
if (missing.length) die('存在不存在的依赖 id: ' + [...new Set(missing)].join(', '));

const inDegree = new Map(tasks.map((t) => [t.id, (t.deps || []).length]));
const children = new Map(tasks.map((t) => [t.id, []]));
for (const t of tasks) for (const d of t.deps || []) children.get(d).push(t.id);
let frontier = tasks.filter((t) => !(t.deps || []).length).map((t) => t.id);
const levels = [];
while (frontier.length) {
  levels.push(frontier);
  const next = [];
  for (const id of frontier) {
    for (const c of children.get(id)) {
      inDegree.set(c, inDegree.get(c) - 1);
      if (inDegree.get(c) === 0) next.push(c);
    }
  }
  frontier = next;
}
if (levels.reduce((n, l) => n + l.length, 0) < tasks.length) {
  const seen = new Set(levels.flat());
  die('任务依赖存在环: ' + tasks.filter((t) => !seen.has(t.id)).map((t) => t.id).join(', '));
}
console.log(JSON.stringify({ levels }));
