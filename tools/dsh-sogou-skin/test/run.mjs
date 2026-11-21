// @ts-check
/**
 * 测试运行器 —— 逐个测试文件起独立子进程跑，真实退出码 + 真实断言结果。
 *
 * 为什么要起子进程：v0.1.0 的测试是"一条 `node a && node b` 命令串"，而且有几个文件
 * 是整份打印、从不设置退出码。这个 runner 额外做两道校验防"假通过"：
 *   1. 每个文件必须打印 `== 全部通过（N 项断言组）==`，且 N > 0；
 *   2. 输出里出现 `FAIL` 或 `跳过` 一律判失败（本套件不允许静默跳过）。
 *
 * 用法：
 *   node test/run.mjs          # 单元/契约测试（快）
 *   node test/run.mjs --all    # 再加集成测试（CLI 全命令、端到端、文档一致性）
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = join(ROOT, 'test');

/** 单元/契约层：纯函数与模块级行为，全部自建数据。 */
const UNIT = [
    'image.test.mjs',
    'ssf.test.mjs',
    'layout.test.mjs',
    'project.test.mjs',
    'assemble.test.mjs',
    'render.test.mjs',
    'validate.test.mjs',
];

/** 集成层：真起 CLI 进程、真跑端到端、核对文档与元数据。 */
const INTEGRATION = [
    'preview.test.mjs',
    'plugin.test.mjs',
    'cli.test.mjs',
    'e2e.test.mjs',
    'docs.test.mjs',
];

const all = process.argv.includes('--all');
const files = all ? [...UNIT, ...INTEGRATION] : UNIT;

console.log('dsh-sogou-skin 测试' + (all ? '（--all 含集成）' : '') + '：' + files.length + ' 个文件');
console.log('');

/** @type {{file:string, code:number, ok:boolean, reason:string, pass:number}[]} */
const results = [];
const started = Date.now();

for (const file of files) {
    const path = join(TEST_DIR, file);
    if (!existsSync(path)) {
        results.push({ file, code: -1, ok: false, reason: '文件不存在', pass: 0 });
        console.log('== FAIL ' + file + '：文件不存在');
        continue;
    }
    console.log('======== ' + file + ' ========');
    const r = spawnSync(process.execPath, [path], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const out = (r.stdout || '') + (r.stderr || '');
    process.stdout.write(out);
    const m = /== 全部通过（(\d+) 项断言组）==/.exec(out);
    const passCount = m ? Number(m[1]) : 0;
    let ok = true;
    let reason = '';
    if (r.status !== 0) { ok = false; reason = '退出码 ' + r.status; }
    else if (!m) { ok = false; reason = '没有打印"全部通过"汇总（可能整份没跑断言）'; }
    else if (passCount <= 0) { ok = false; reason = '断言组数量为 0'; }
    else if (/^  FAIL /m.test(out)) { ok = false; reason = '输出里有 FAIL'; }
    else if (/(^|\n)\s*--\s*跳过/.test(out) || /(^|\n)\s*SKIP[: ]/.test(out)) { ok = false; reason = '输出里有静默跳过标记（本套件不允许）'; }
    results.push({ file, code: r.status ?? -1, ok, reason, pass: passCount });
    console.log('');
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const failed = results.filter((r) => !r.ok);
const totalAssertions = results.reduce((a, r) => a + r.pass, 0);

console.log('================ 汇总 ================');
for (const r of results) {
    console.log((r.ok ? '  ok   ' : '  FAIL ') + r.file.padEnd(24) + r.pass + ' 组断言' + (r.reason ? '  (' + r.reason + ')' : ''));
}
console.log('');
console.log('共 ' + results.length + ' 个测试文件 / ' + totalAssertions + ' 组断言 / 用时 ' + seconds + 's');

if (failed.length) {
    console.log('== 失败 ' + failed.length + ' 个文件 ==');
    process.exitCode = 1;
} else {
    console.log('== 全部通过 ==');
    process.exitCode = 0;
}
