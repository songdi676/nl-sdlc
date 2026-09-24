import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (args = [], cwd = root) =>
  execFileSync(process.execPath, [join(root, 'scripts/validate-plugin.mjs'), ...args], { cwd, encoding: 'utf8' });

test('合法资产目录全部通过', () => {
  const out = run();
  assert.match(out, /PASS/);
});

test('skill 缺 description 报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
  mkdirSync(join(dir, 'skills/bad-skill'), { recursive: true });
  writeFileSync(join(dir, 'skills/bad-skill/SKILL.md'), '---\nname: bad-skill\n---\n# bad\n');
  assert.throws(() => run([], dir), /bad-skill.*description/);
  rmSync(dir, { recursive: true, force: true });
});

test('description 非 Use when 开头报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
  mkdirSync(join(dir, 'skills/bad-desc'), { recursive: true });
  writeFileSync(join(dir, 'skills/bad-desc/SKILL.md'), '---\nname: bad-desc\ndescription: do stuff\n---\n# bad\n');
  assert.throws(() => run([], dir), /Use when/);
  rmSync(dir, { recursive: true, force: true });
});

test('agent 缺 name 报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nlp-'));
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents/x.md'), '---\ndescription: hi\n---\nbody\n');
  assert.throws(() => run([], dir), /x\.md.*name/);
  rmSync(dir, { recursive: true, force: true });
});
