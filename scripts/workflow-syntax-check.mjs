// 模拟 workflow runner：脚本体被包进 async 上下文（顶层 await/return 合法），
// 直接 node --check 会对顶层 return 误报。用法: node scripts/workflow-syntax-check.mjs [file ...]
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('用法: node scripts/workflow-syntax-check.mjs <workflow.js> [...]'); process.exit(2); }
let failed = 0;
for (const f of files) {
  const s = readFileSync(f, 'utf8').replace(/^export const meta/, 'const meta');
  try {
    // 只构造不执行：解析失败（语法错）会在 new Function 时抛出
    new Function('return (async () => {\n' + s + '\n})')();
    console.log(`PASS ${f}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${f}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
