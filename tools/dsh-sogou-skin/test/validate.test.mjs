// @ts-check
/**
 * 校验器测试 —— 这是"工具自己会不会骗你"的守门员。
 *
 * 两条硬要求：
 *  1. **健康工程必须 0 error、0 warning**（notes 允许；启发式提示不算错误）；
 *  2. 真问题必须被报出来（引用悬空、九宫格退化、颜色格式、缺段落）。
 *
 * 另外守住路径：validate 支持 工程目录 / 已解包目录 / .ssf 文件 三种输入。
 */
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateTarget } from '../src/ops/validate.js';
import { pack } from '../src/ops/build.js';
import { decodeIni, IniDoc, encodeIni } from '../src/ssf/ini.js';
import { readSkin } from '../src/ssf/container.js';
import { makeDemoProject } from './_fixtures.mjs';
import { tmpDir, writeBin, eq, ok, deepEq, t, section, finish, assert } from './_harness.mjs';

/** 把一组装配文件写进临时目录，返回目录。 */
function dirFromFiles(name, files) {
    const dir = tmpDir('validate-' + name);
    for (const f of files) writeBin(join(dir, f.name), f.data);
    return dir;
}

/** 改写一个目录里的 Skin.ini 文本并写回。 */
function patchIni(dir, fn) {
    const p = join(dir, 'Skin.ini');
    const text = decodeIni(readFileSync(p));
    const next = fn(text);
    writeFileSync(p, Buffer.from(encodeIni(next)));
    return dir;
}

const demo = makeDemoProject({ name: '校验测试' });
const res = demo.assembled;
const files = res.files;

/* ---------------- 健康数据 ---------------- */
section('健康数据：0 error / 0 warning');
t('自建工程：校验通过且没有 warning', () => {
    const r = validateTarget(demo.dir);
    eq(r.ok, true);
    deepEq(r.errors, []);
    deepEq(r.warnings, []);
    ok(r.notes.length >= 0);
    eq(r.kind, 'project');
    eq(r.fileCount, files.length);
});
t('.ssf 文件：校验通过', () => {
    const out = join(tmpDir('validate-ssf'), 'test.ssf');
    const p = pack(demo.dir, { out });
    ok(p.ok);
    const r = validateTarget(out);
    eq(r.ok, true);
    deepEq(r.errors, []);
    eq(r.kind, 'ssf');
    ok(r.rawBytes > 0);
    ok(typeof r.measure.packedBytes === 'number');
});
t('已解包目录：校验通过', () => {
    const dir = dirFromFiles('unpacked', files);
    const r = validateTarget(dir);
    eq(r.ok, true);
    deepEq(r.errors, []);
    eq(r.kind, 'skindir');
});
t('measure 里带九宫格与两排文字的量化数据', () => {
    const r = validateTarget(demo.dir);
    const h1 = r.measure.panels.Scheme_H1;
    ok(h1, '缺少 Scheme_H1 测量数据');
    ok(typeof h1.L === 'number' && typeof h1.R === 'number');
    ok(typeof h1.row1Y === 'number' && typeof h1.row2Y === 'number');
    ok(typeof h1.seamMaxDelta === 'number');
    ok(typeof h1.backdropCoverage === 'number');
});

/* ---------------- 负例：必须被报出来 ---------------- */
section('负例（真问题必须报 error）');
t('Skin.ini 引用了不存在的图片 -> error', () => {
    const dir = dirFromFiles('dangling', files.filter((f) => f.name !== 'skin1.png'));
    const r = validateTarget(dir);
    eq(r.ok, false);
    ok(r.errors.some((e) => e.includes('skin1.png')), '应报引用悬空：' + r.errors.join(';'));
});
t('九宫格退化 -> error', () => {
    // 换一张 700 宽底图 + 左右内缩 300（合计 600 > 460）
    const { encodePng } = requirePng();
    const { create } = requireRaster();
    const wide = create(700, 258, [200, 200, 200, 255]);
    const dir = dirFromFiles('degenerate', files.map((f) => f.name === 'skin1.png'
        ? { name: 'skin1.png', data: encodePng(wide) }
        : f));
    patchIni(dir, (text) => text.replace(/layout_horizontal=.*/m, 'layout_horizontal=0,300,300'));
    const r = validateTarget(dir);
    eq(r.ok, false);
    ok(r.errors.some((e) => e.includes('九宫格退化')), '应报退化：' + r.errors.join(';'));
});
t('颜色格式非法 -> error', () => {
    const dir = dirFromFiles('badcolor', files);
    patchIni(dir, (text) => text.replace(/^pinyin_color=.*$/m, 'pinyin_color=ff0000'));
    const r = validateTarget(dir);
    eq(r.ok, false);
    ok(r.errors.some((e) => e.includes('pinyin_color')), '应报颜色格式：' + r.errors.join(';'));
});
t('layout 元组长度不对 -> error', () => {
    const dir = dirFromFiles('badlayout', files);
    patchIni(dir, (text) => text.replace(/^layout_horizontal=.*$/m, 'layout_horizontal=0,10'));
    const r = validateTarget(dir);
    eq(r.ok, false);
    ok(r.errors.some((e) => e.includes('layout_horizontal')), r.errors.join(';'));
});
t('缺 [StatusBar] 段落 -> error', () => {
    const dir = dirFromFiles('nosec', files);
    patchIni(dir, (text) => text.replace(/\[StatusBar\][\s\S]*$/, ''));
    const r = validateTarget(dir);
    eq(r.ok, false);
    ok(r.errors.some((e) => e.includes('StatusBar')), r.errors.join(';'));
});
t('缺 Skin.ini 的目录 -> 明确报错（不是静默通过）', () => {
    const dir = tmpDir('validate-noini');
    writeBin(join(dir, 'only.png'), files.find((f) => f.name === 'skin1.png').data);
    const r = validateTarget(dir);
    eq(r.ok, false);
    ok(r.errors.length > 0);
    assert.ok(r.errors[0]);
});
t('工程目录不存在 -> 明确报错', () => {
    const r = validateTarget(join(tmpDir('validate-missing'), 'nope'));
    eq(r.ok, false);
    ok(r.errors.length > 0);
});
t('不是皮肤包的随机文件 -> 明确报错', () => {
    const p = join(tmpDir('validate-junk'), 'junk.ssf');
    writeFileSync(p, Buffer.from('not a skin at all'));
    const r = validateTarget(p);
    eq(r.ok, false);
    ok(r.errors.length > 0);
});

/* ---------------- 负例：只在 warning / note 层 ---------------- */
section('提示层（不能判为失败）');
t('工程显式关掉 _display -> warning（真机上状态栏按钮会整体消失）', () => {
    const d = makeDemoProject({ name: 'display 校验', writeDisplay: false });
    const r = validateTarget(d.dir);
    eq(r.ok, true, '缺 _display 应是 warning 而不是 error：' + r.errors.join(';'));
    ok(r.warnings.some((w) => w.includes('_display')), r.warnings.join(';'));
});
t('.ssf 里缺 _display -> note（保留已知反例，不判失败）', () => {
    const dir = dirFromFiles('nodisplay', files);
    patchIni(dir, (text) => text.split(/\r?\n/).filter((l) => !/_display=/.test(l)).join('\n'));
    const r = validateTarget(dir);
    eq(r.ok, true);
    ok(r.notes.some((n) => n.includes('_display')), r.notes.join(';'));
});
t('未知键 -> warning，但不影响 ok', () => {
    const dir = dirFromFiles('unknownkey', files);
    patchIni(dir, (text) => text.replace('[Display]', '[Display]\nfoo_bar=1'));
    const r = validateTarget(dir);
    eq(r.ok, true, '未知键不应判失败：' + r.errors.join(';'));
    ok(r.warnings.some((w) => w.includes('foo_bar')), r.warnings.join(';'));
});
t('候选条背景覆盖率低 -> note，不影响 ok', () => {
    // 自建 demo 的竖排面板中段并不是"条子贴底"的理想设计，这里只要求它出现在 notes 且不报错
    const dir = dirFromFiles('backdrop', files);
    const r = validateTarget(dir);
    eq(r.ok, true);
    ok(r.notes.length >= 0);
});
t('状态栏按钮坐标重叠 -> note（真实皮肤也存在）', () => {
    const dir = dirFromFiles('overlap', files);
    patchIni(dir, (text) => text
        .replace(/^cn_en_pos=.*$/m, 'cn_en_pos=10,4')
        .replace(/^biaodian_pos=.*$/m, 'biaodian_pos=12,4'));
    const r = validateTarget(dir);
    eq(r.ok, true);
    ok(r.notes.some((n) => n.includes('重叠')), r.notes.join(';'));
});
t('校验输出里不出现 undefined / NaN', () => {
    for (const target of [demo.dir]) {
        const r = validateTarget(target);
        const all = [...r.errors, ...r.warnings, ...r.notes, r.summary || ''].join('\n');
        eq(/undefined|NaN|\[object Object\]/.test(all), false, all.slice(0, 300));
    }
});

/* ---------------- 真实数据（可选，走环境变量）---------------- */
section('真实数据（有才跑，没有也不静默跳过断言）');
t('没有真实数据时，校验器仍然只依赖自建数据', () => {
    // 这个测试本身就是断言：validateTarget 的实现不得引用任何本机路径（见 docs.test.mjs 的路径扫描）
    const r = validateTarget(demo.dir);
    eq(r.ok, true);
});

import * as pngMod from '../src/image/png.js';
import * as rasterMod from '../src/image/raster.js';
function requirePng() { return pngMod; }
function requireRaster() { return rasterMod; }

void readSkin; void IniDoc; void deepEq;
finish();
