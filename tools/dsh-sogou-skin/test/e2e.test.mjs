// @ts-check
/**
 * 端到端测试：从工程到"能装的 .ssf"再回到皮肤目录，验证整条流水线与逐字克隆能力。
 *
 * 覆盖：
 *  - 组装 → 打包（zip / v3 / v1）→ 解析 → 解包 → 逐字重打包；
 *  - 解包目录重打包的条目名/顺序/内容与原包完全一致；
 *  - v1 明文容器重打包后**逐字节相同**；
 *  - `pack --set` 只改六个身份字段，其余键值零差异；
 *  - 校验器认自己产出的 .ssf。
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { assembleProject, pack, inspectSsf, unpackSsf, readSkinDir } from '../src/ops/build.js';
import { validateTarget } from '../src/ops/validate.js';
import { makeDemoProject } from './_fixtures.mjs';
import { readSkin } from '../src/ssf/container.js';
import { decodeIni, IniDoc } from '../src/ssf/ini.js';
import { tmpDir, eq, ok, t, ta, section, finish } from './_harness.mjs';

const demo = makeDemoProject({ name: '端到端测试' });
const out = tmpDir('e2e-out');

/** @param {string} path */
function iniOf(path) {
    const entries = readSkin(new Uint8Array(readFileSync(path))).entries;
    return new IniDoc(decodeIni(entries.find((e) => e.name.toLowerCase() === 'skin.ini').data));
}

/** 比较两个 .ssf 的条目（名/顺序/内容）。 */
function sameEntries(a, b) {
    const A = readSkin(new Uint8Array(readFileSync(a)));
    const B = readSkin(new Uint8Array(readFileSync(b)));
    if (A.entries.length !== B.entries.length) return '条目数不同 ' + A.entries.length + ' vs ' + B.entries.length;
    for (let i = 0; i < A.entries.length; i++) {
        if (A.entries[i].name !== B.entries[i].name) return '第 ' + i + ' 个条目名不同：' + A.entries[i].name + ' vs ' + B.entries[i].name;
        const x = A.entries[i].data;
        const y = B.entries[i].data;
        if (x.length !== y.length) return A.entries[i].name + ' 内容长度不同';
        for (let j = 0; j < x.length; j++) if (x[j] !== y[j]) return A.entries[i].name + ' 内容不同（字节 ' + j + '）';
    }
    return null;
}

section('装配 → 打包 → 解析');
const asm = assembleProject(demo.dir);
t('装配成功', () => {
    ok(asm.ok, asm.error);
    eq(asm.errors.length, 0, asm.errors.join(';'));
});
const zipPath = join(out, 'skin.zip.ssf');
const v3Path = join(out, 'skin.v3.ssf');
const v1Path = join(out, 'skin.v1.ssf');
t('打包 zip / v3 / v1 三种代际', () => {
    for (const [format, path] of [['zip', zipPath], ['v3', v3Path], ['v1', v1Path]]) {
        const r = pack(demo.dir, { format, out: path });
        ok(r.ok, format + ': ' + (r.error || r.errors.join(';')));
        eq(r.format, format);
        eq(r.entries, asm.files.length);
    }
});
t('inspect 能识别三种代际并读出 Skin.ini', () => {
    for (const [format, path] of [['zip', zipPath], ['v3', v3Path], ['v1', v1Path]]) {
        const info = inspectSsf(path);
        ok(info.ok, format);
        eq(info.format, format);
        eq(info.entries, asm.files.length);
        ok(info.ini.includes('[General]'));
    }
});
t('校验器对自己打出的三种包全部 0 error', () => {
    for (const path of [zipPath, v3Path, v1Path]) {
        const r = validateTarget(path);
        eq(r.ok, true, path + '：' + r.errors.join(';'));
        eq(r.errors.length, 0);
    }
});
t('打包体积提示存在（不阻止）', () => {
    const r = pack(demo.dir, { out: join(out, 'size.ssf') });
    eq(r.sizeWarning, null, '小皮肤不应超体积上限');
});

section('解包 → 逐字重打包');
t('解包后重打包：条目名/顺序/内容完全一致（zip）', () => {
    const dir = join(out, 'unzip');
    const u = unpackSsf(zipPath, dir);
    ok(u.ok, u.error);
    const repack = join(out, 'repack.zip.ssf');
    const r = pack(dir, { out: repack, format: 'zip' });
    ok(r.ok, r.error);
    eq(sameEntries(zipPath, repack), null);
});
t('解包后重打包：v3 条目完全一致', () => {
    const dir = join(out, 'unv3');
    ok(unpackSsf(v3Path, dir).ok);
    const repack = join(out, 'repack.v3.ssf');
    ok(pack(dir, { out: repack, format: 'v3' }).ok);
    eq(sameEntries(v3Path, repack), null);
});
t('v1 明文容器：解包→重打包后**文件逐字节相同**', () => {
    const dir = join(out, 'unv1');
    ok(unpackSsf(v1Path, dir).ok);
    // 清掉解包器写的辅助文件（模拟"作者的干净目录"）
    const repack = join(out, 'repack.v1.ssf');
    const r = pack(dir, { out: repack, format: 'v1' });
    ok(r.ok, r.error);
    const a = readFileSync(v1Path);
    const b = readFileSync(repack);
    ok(a.equals(b), 'v1 重打包应与原文件逐字节相同（' + a.length + ' vs ' + b.length + '）');
});
t('解包目录里的顺序清单不被打进包（点文件被忽略）', () => {
    const read = readSkinDir(join(out, 'unv3'));
    ok(read.ok);
    ok(!read.files.some((f) => f.name.startsWith('.')), '点文件不应进包');
});

section('身份字段改写（克隆流程）');
t('pack --set 只改六个身份字段', () => {
    const dir = join(out, 'unv3');
    const clonePath = join(out, 'clone.ssf');
    const r = pack(dir, {
        out: clonePath, format: 'zip',
        set: { skin_name: '克隆件', skin_author: '测试作者', skin_time: '2026.01.01', skin_version: '9.9' },
    });
    ok(r.ok, r.error);
    const a = iniOf(v3Path);
    const b = iniOf(clonePath);
    eq(b.get('General', 'skin_name'), '克隆件');
    eq(b.get('General', 'skin_author'), '测试作者');
    const identity = new Set(['skin_name', 'skin_version', 'skin_author', 'skin_email', 'skin_time', 'skin_info']);
    let diff = 0;
    for (const sec of a.sections()) {
        for (const [k, v] of Object.entries(a.section(sec))) {
            if (identity.has(k)) continue;
            if (b.get(sec, k) !== v) diff++;
        }
    }
    eq(diff, 0, '身份字段之外不应有差异');
});
t('pack --set 拒绝非身份字段（防止改坏配置）', () => {
    const dir = join(out, 'unv3');
    const r = pack(dir, { out: join(out, 'badset.ssf'), set: { layout_horizontal: '0,1,1' } });
    ok(r.warnings.some((w) => w.includes('layout_horizontal')), r.warnings.join(';'));
});

section('CLI 与库的一致性');
await ta('CLI inspect 输出的条目数与库一致', async () => {
    const { runCli } = await import('./_harness.mjs');
    const r = runCli(['inspect', v3Path, '--json']);
    eq(r.code, 0);
    eq(JSON.parse(r.stdout).entries, asm.files.length);
});

finish();
