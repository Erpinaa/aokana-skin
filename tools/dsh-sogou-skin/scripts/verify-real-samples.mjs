#!/usr/bin/env node
// @ts-check
/**
 * 真实样本验证脚本 —— **需要本机有真实皮肤文件**，所以不在 `npm test` 里跑。
 *
 * 用途：用真实数据验证"自造数据测试"覆盖不到的东西：
 *   - v1 容器（本机搜狗医生版 `skin_v3.dat` 或安装目录的 `Skin.dat`）只读 + 重打包逐字节往返；
 *   - 商店分发的 v3 .ssf、编辑器导出的明文 ZIP .ssf 的读取 + 重打包逐字节往返；
 *   - `unpack → pack` 后条目名与内容完全一致（逐字克隆的前提）。
 *
 * 用法（Windows PowerShell）：
 *   $env:SOGOU_SKIN_DAT='C:\Users\<你>\AppData\LocalLow\SogouYS\skin_v3.dat'
 *   $env:SOGOU_SKIN_SAMPLES='F:\...\00-原始样本'
 *   node scripts/verify-real-samples.mjs
 *
 * 仓库里不包含也不下载任何皮肤素材；这个脚本只读你本机已有的文件。
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readSkin, writeSkin } from '../src/ssf/container.js';
import { unpackSsf, pack } from '../src/ops/build.js';

const DAT = process.env.SOGOU_SKIN_DAT || '';
const SAMPLES = process.env.SOGOU_SKIN_SAMPLES || '';
const TMP = mkdtempSync(join(tmpdir(), 'dsh-sogou-real-'));

let pass = 0;
let fail = 0;
/** @param {string} name @param {boolean} cond @param {string} [extra] */
const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  ok   ' + name + (extra ? '  ' + extra : '')); }
    else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};

/** @param {string} file */
function entriesEqual(buf, back) {
    const a = readSkin(new Uint8Array(buf));
    return a.entries.length === back.entries.length &&
        a.entries.every((e, i) => e.name === back.entries[i].name &&
            e.data.length === back.entries[i].data.length &&
            e.data.every((v, j) => v === back.entries[i].data[j]));
}

/** @param {string} label @param {string} file */
function verifyContainer(label, file) {
    console.log('');
    console.log('=== ' + label + '：' + file + ' (' + statSync(file).size + ' B) ===');
    const buf = readFileSync(file);
    let skin;
    try {
        skin = readSkin(new Uint8Array(buf));
    } catch (e) {
        check(label + ' 可读取', false, String(e && e.message ? e.message : e));
        return;
    }
    check(label + ' 可读取', true, '格式=' + skin.format + ' 条目=' + skin.entries.length);
    // 同格式重打包再读回：条目名与内容必须逐字节一致
    try {
        const out = writeSkin(skin.entries, { format: skin.format });
        const back = readSkin(out);
        check(label + ' 重打包后条目逐字节一致', entriesEqual(buf, back), '产物 ' + out.length + ' B');
    } catch (e) {
        check(label + ' 重打包后条目逐字节一致', false, String(e && e.message ? e.message : e));
    }
    // 解包 -> 逐字重打包：v1 的 skin_v3.dat / Skin.dat 里带 skin.ini.bak 之类的非图片文件，
    // 这里验证它们也能被完整带回去（readSkinDir 不按扩展名过滤）。
    try {
        const outDir = join(TMP, basename(file).replace(/[^\w.-]/g, '_') + '_un');
        const u = unpackSsf(file, outDir);
        check(label + ' 可解包', !!(u && u.ok), u && u.ok ? u.files.length + ' 个文件' : (u && u.error));
        if (u && u.ok) {
            const repackPath = join(TMP, basename(file).replace(/[^\w.-]/g, '_') + '_repack.ssf');
            const r = pack(outDir, { out: repackPath, format: skin.format });
            check(label + ' 解包目录可逐字重打包', !!(r && r.ok), r && r.ok ? r.entries + ' 条目 / ' + r.bytes + ' B' : (r && (r.error || (r.errors || []).join(';'))));
            if (r && r.ok) {
                const back = readSkin(new Uint8Array(readFileSync(repackPath)));
                check(label + ' 解包→重打包后条目逐字节一致', entriesEqual(buf, back));
                // v1 是纯明文容器：条目顺序一致时，逐字重打包应当得到**逐字节相同**的文件
                // （这是"v1 = skin_v3.dat 真身"的最强证据）
                if (skin.format === 'v1') {
                    const a = readFileSync(file);
                    const b = readFileSync(repackPath);
                    check(label + ' v1 重打包文件逐字节相同', a.length === b.length && a.equals(b),
                        a.length + ' B vs ' + b.length + ' B');
                }
            }
        }
    } catch (e) {
        check(label + ' 解包→重打包', false, String(e && e.message ? e.message : e));
    }
}

console.log('真实样本验证（只读你本机已有的文件，不上传、不复制进仓库）');
console.log('临时目录：' + TMP);

if (DAT && existsSync(DAT)) verifyContainer('v1 容器', DAT);
else console.log('\n（未设置 SOGOU_SKIN_DAT，跳过本机 v1 容器验证）');

if (SAMPLES && existsSync(SAMPLES)) {
    for (const name of readdirSync(SAMPLES)) {
        if (!/\.(ssf|dat)$/i.test(name)) continue;
        verifyContainer('真实样本', join(SAMPLES, name));
    }
} else {
    console.log('\n（未设置 SOGOU_SKIN_SAMPLES，跳过商店/编辑器样本验证）');
}

try { rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }
console.log('');
if (fail) {
    console.log('== 失败 ' + fail + ' / ' + (pass + fail) + ' 项 ==');
    process.exitCode = 1;
} else if (!pass) {
    console.log('== 没有可验证的样本（请设置 SOGOU_SKIN_DAT / SOGOU_SKIN_SAMPLES）==');
    process.exitCode = 2;
} else {
    console.log('== 全部通过（' + pass + ' 项）==');
    process.exitCode = 0;
}
