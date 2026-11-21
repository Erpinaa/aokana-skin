// @ts-check
/**
 * 测试基础设施 —— 全部测试共用。
 *
 * 三条硬规矩（都是被教训出来的，见 docs/LESSONS.md 第 16~20 条）：
 *  1. **测试自己造数据**：不读开发者本机的任何样本、不写仓库之外的固定路径；
 *  2. **每个测试必须真的断言**：`t()` 里抛异常才算失败，打印而不断言不算测试；
 *  3. **不允许静默跳过**：缺数据要显式失败或改成自建数据；本套件里没有"跳过"这个概念。
 */
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/** 仓库根目录（test/ 的上一级）。 */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 本次测试运行的临时目录；所有写操作都在这里面。 */
export const TMP = mkdtempSync(join(tmpdir(), 'dsh-sogou-skin-test-'));

let pass = 0;
let fail = 0;
const failures = [];

/**
 * 运行一个测试。断言失败/抛异常都记为失败。
 * @param {string} name @param {() => any} fn
 */
export function t(name, fn) {
    try {
        fn();
        pass++;
        console.log('  ok   ' + name);
    } catch (e) {
        fail++;
        const msg = e && e.message ? e.message : String(e);
        failures.push({ name, msg });
        console.log('  FAIL ' + name + ' :: ' + msg);
    }
}

/**
 * 异步测试。
 * @param {string} name @param {() => Promise<any>} fn
 */
export async function ta(name, fn) {
    try {
        await fn();
        pass++;
        console.log('  ok   ' + name);
    } catch (e) {
        fail++;
        const msg = e && e.message ? e.message : String(e);
        failures.push({ name, msg });
        console.log('  FAIL ' + name + ' :: ' + msg);
    }
}

/** @param {string} name */
export function section(name) {
    console.log('');
    console.log('--- ' + name + ' ---');
}

/** 一个测试文件结束时调用：打印汇总并设置退出码。 */
export function finish() {
    console.log('');
    if (fail) {
        console.log('== 失败 ' + fail + ' / ' + (pass + fail) + ' 项 ==');
        for (const f of failures) console.log('   - ' + f.name + ' :: ' + f.msg.split('\n')[0]);
        process.exitCode = 1;
    } else {
        console.log('== 全部通过（' + pass + ' 项断言组）==');
        process.exitCode = 0;
    }
    // 清理临时目录（失败时保留现场，方便排查）
    if (!fail) {
        try { rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }
    return { pass, fail };
}

/** 现成的 assert 再导出。 */
export { assert };

/** @param {any} actual @param {any} expected @param {string} [msg] */
export function eq(actual, expected, msg) {
    assert.strictEqual(actual, expected, msg || ('期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)));
}

/** @param {any} actual @param {any} expected @param {string} [msg] */
export function deepEq(actual, expected, msg) {
    assert.deepStrictEqual(actual, expected, msg);
}

/** @param {any} a @param {any} b @param {number} [tol] @param {string} [msg] */
export function near(a, b, tol = 2, msg) {
    assert.ok(Math.abs(a - b) <= tol, msg || (a + ' 与 ' + b + ' 差距超过 ' + tol));
}

/** @param {boolean} cond @param {string} [msg] */
export function ok(cond, msg) {
    assert.ok(cond, msg);
}

/**
 * 在 TMP 下开一个空目录。
 * @param {string} name @returns {string}
 */
export function tmpDir(name) {
    const p = join(TMP, name);
    mkdirSync(p, { recursive: true });
    return p;
}

/**
 * 跑 CLI（子进程），返回退出码与输出。测试 CLI 必须真的起进程，不能直接调函数。
 * @param {string[]} args
 * @param {{cwd?:string, env?:Record<string,string>}} [opts]
 */
export function runCli(args, opts = {}) {
    const r = spawnSync(process.execPath, [join(ROOT, 'src', 'cli.js'), ...args], {
        cwd: opts.cwd || ROOT,
        env: { ...process.env, ...(opts.env || {}) },
        encoding: 'utf8',
        timeout: 120000,
    });
    return {
        code: r.status,
        stdout: r.stdout || '',
        stderr: r.stderr || '',
        text: (r.stdout || '') + (r.stderr || ''),
    };
}

/** 读仓库里的文本文件。 @param {string} rel */
export function readRepo(rel) {
    return readFileSync(join(ROOT, rel), 'utf8');
}

/** 仓库文件是否存在。 @param {string} rel */
export function repoExists(rel) {
    try { readFileSync(join(ROOT, rel)); return true; } catch { return false; }
}

/** @param {string} rel */
export function repoJson(rel) {
    return JSON.parse(readRepo(rel));
}

/** @param {string} path @param {string} text */
export function writeText(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, 'utf8');
}

/** @param {string} path @param {Uint8Array} data */
export function writeBin(path, data) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(data));
}

/** 读二进制文件。 @param {string} path */
export function readBin(path) {
    return new Uint8Array(readFileSync(path));
}

export { readFileSync, writeFileSync, mkdirSync, join, dirname, resolve, tmpdir };
