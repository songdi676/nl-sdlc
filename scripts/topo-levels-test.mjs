import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(root, 'scripts/topo-levels.mjs');
const run = (input) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script], { input, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') };
  }
};

test('无依赖任务全部在第 0 层（保持原顺序）', () => {
  const { code, out } = run('[{"id":"a"},{"id":"b"},{"id":"c"}]');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { levels: [['a', 'b', 'c']] });
});

test('按依赖拓扑分层', () => {
  const { code, out } = run('[{"id":"t1"},{"id":"t2","deps":["t1"]},{"id":"t3","deps":["t1"]},{"id":"t4","deps":["t2","t3"]}]');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { levels: [['t1'], ['t2', 't3'], ['t4']] });
});

test('deps 缺省视为无依赖', () => {
  const { code, out } = run('[{"id":"x","title":"t"},{"id":"y","deps":["x"]}]');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out), { levels: [['x'], ['y']] });
});

test('依赖 id 不存在报错', () => {
  const { code, out } = run('[{"id":"a"},{"id":"b","deps":["zzz"]}]');
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /zzz/);
});

test('依赖成环报错', () => {
  const { code, out } = run('[{"id":"a","deps":["b"]},{"id":"b","deps":["a"]}]');
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /环/);
});

test('自依赖视为环', () => {
  const { code, out } = run('[{"id":"a","deps":["a"]}]');
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /环/);
});

test('重复 id 报错', () => {
  const { code, out } = run('[{"id":"a"},{"id":"a"}]');
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /重复/);
});

test('非法 JSON 报错', () => {
  const { code, out } = run('not json');
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /JSON/);
});

test('空数组报错', () => {
  const { code, out } = run('[]');
  assert.equal(code, 1);
  assert.match(JSON.parse(out).error, /非空/);
});
