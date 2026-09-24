import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const target = resolve(process.argv[2] ?? '.');
const errors = [];
const ok = (msg) => console.log(`PASS ${msg}`);
const err = (file, line, msg) => errors.push(`${file}: ${line ?? '?'}: ${msg}`);

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  const raw = text.slice(4, end);
  const fm = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const files = walk(target).filter((f) => !f.includes('node_modules') && !f.includes('.git/'));
const skills = files.filter((f) => /[\\/]skills[\\/][^\\/]+[\\/]SKILL\.md$/.test(f));
const agents = files.filter((f) => /[\\/]agents[\\/].+\.md$/.test(f));
const commands = files.filter((f) => /[\\/]commands[\\/].+\.md$/.test(f));
const workflows = files.filter((f) => /[\\/]workflows[\\/].+\.js$/.test(f));

for (const f of skills) {
  const fm = parseFrontmatter(readFileSync(f, 'utf8'));
  if (!fm) { err(f, 1, '缺少 frontmatter'); continue; }
  if (!fm.name) err(f, 1, 'SKILL.md 缺少 name');
  if (!fm.description) err(f, 1, 'SKILL.md 缺少 description');
  else {
    if (!fm.description.startsWith('Use when')) err(f, 2, 'description 必须以 Use when 开头');
    if (fm.description.length > 1024) err(f, 2, `description 超过 1024 字符（当前 ${fm.description.length}）`);
  }
  const dirName = f.split(/[\\/]/).slice(-2, -1)[0];
  if (fm.name !== dirName) err(f, 2, `name(${fm.name}) 与目录名(${dirName}) 不一致`);
}

for (const f of agents) {
  const fm = parseFrontmatter(readFileSync(f, 'utf8'));
  if (!fm) { err(f, 1, '缺少 frontmatter'); continue; }
  if (!fm.name) err(f, 1, 'agent 缺少 name');
  if (!fm.description) err(f, 1, 'agent 缺少 description');
  const body = readFileSync(f, 'utf8');
  if (!body.includes('## Composition')) err(f, '?', 'agent 正文缺少 ## Composition 块');
}

for (const f of commands) {
  const fm = parseFrontmatter(readFileSync(f, 'utf8'));
  if (!fm || !fm.description) err(f, 1, '命令缺少 frontmatter description');
  if (fm['disable-model-invocation'] !== 'true') err(f, 2, '薄壳命令必须设置 disable-model-invocation: true');
}

for (const f of workflows) {
  const text = readFileSync(f, 'utf8');
  if (!text.trimStart().startsWith('export const meta')) err(f, 1, 'workflow 必须以 export const meta 开头');
  if (!/meta\s*=\s*\{/.test(text) || !/name:\s*['"]/.test(text) || !/description:\s*['"]/.test(text))
    err(f, 1, 'workflow meta 块必须含 name 与 description');
  if (text.includes('import(')) err(f, 1, 'workflow 脚本禁止动态 import()');
}

if (errors.length) {
  for (const e of errors) console.error(e);
  console.error(`FAIL ${errors.length} 处问题`);
  process.exit(1);
}
ok(`校验通过: ${skills.length} skills, ${agents.length} agents, ${commands.length} commands, ${workflows.length} workflows`);
