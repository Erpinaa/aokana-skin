// @ts-check
/**
 * 预览出图测试：产物齐全、可解码、报告内容真实、素材改动会反映到图里。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { previewProject, PREVIEW_FILES } from '../src/ops/preview.js';
import { loadProject, saveProject } from '../src/ops/project.js';
import { makeDemoProject } from './_fixtures.mjs';
import { decodePng, isPng } from '../src/image/png.js';
import { tmpDir, eq, ok, t, section, finish } from './_harness.mjs';

const demo = makeDemoProject({ name: '预览测试' });
const r = previewProject(demo.dir);

section('预览产物');
t('previewProject 成功', () => {
    ok(r.ok, r.error);
    eq(r.files, demo.assembled.files.length);
    eq(r.validation.ok, true);
});
t('7 个产物全部落盘且是合法 PNG / 文本', () => {
    for (const key of ['render', 'zoom', 'bgcheck', 'stretch', 'assets', 'preview']) {
        const p = r.paths[key];
        ok(p && existsSync(p), key + ' 缺失：' + p);
        const bytes = readFileSync(p);
        ok(isPng(bytes), key + ' 不是 PNG');
        const img = decodePng(bytes);
        ok(img.width > 200 && img.height > 100, key + ' 尺寸异常 ' + img.width + 'x' + img.height);
        ok(statSync(p).size > 1000, key + ' 文件太小，可能是空图');
    }
    const report = readFileSync(r.paths.report, 'utf8');
    ok(report.includes('搜狗皮肤工坊'), '报告缺少标题');
    ok(report.includes('九宫格'), '报告缺少九宫格数据');
    ok(report.includes('候选条背景覆盖率'), '报告缺少候选条覆盖率');
});
t('report.txt 里的九宫格数字与装配结果一致', () => {
    const text = readFileSync(r.paths.report, 'utf8');
    const h1 = r.measure.panels.Scheme_H1;
    ok(text.includes('L=' + h1.L + ' R=' + h1.R + ' T=' + h1.T + ' B=' + h1.B), '报告里的 L/R/T/B 不对');
});
t('返回的 measure/validation 字段可供工具直接使用', () => {
    ok(r.measure.panels.Scheme_H1);
    ok(Array.isArray(r.validation.warnings));
    ok(Array.isArray(r.validation.notes));
    ok(typeof r.summary === 'string' && r.summary.length > 0);
    ok(Array.isArray(r.renderNotes));
    ok(Array.isArray(r.bgcheckIssues));
});

section('"所见即所得"：改素材必须改图');
t('换掉候选条颜色后 render.png 的字节变了', () => {
    const before = readFileSync(r.paths.render);
    // 把候选条颜色改成对比强烈的品红
    const { create, fillRect } = requireRaster();
    const { encodePng } = requirePng();
    const { decodePng } = requirePng();
    const panelPath = join(demo.dir, 'assets', 'panel_h.png');
    const img = decodePng(new Uint8Array(readFileSync(panelPath)));
    fillRect(img, 60, 80, 180, 40, [250, 0, 200, 255]);
    requireFs().writeFileSync(panelPath, Buffer.from(encodePng(img)));
    const r2 = previewProject(demo.dir);
    ok(r2.ok);
    const after = readFileSync(r2.paths.render);
    ok(!before.equals(after), '改了素材但 render.png 没变（预览没有走真实字节）');
    // 恢复现场，避免影响后续测试
    requireFs().writeFileSync(panelPath, Buffer.from(encodePng(create(240, 120))));
});
t('没有工程的目录给出明确错误', () => {
    const bad = previewProject(tmpDir('preview-missing'));
    eq(bad.ok, false);
    ok(bad.error.includes('skin.project.json'));
});

section('预览与校验一致');
t('预览里的 warnings/notes 与校验器同一来源', () => {
    const text = readFileSync(r.paths.report, 'utf8');
    const check = r.validation;
    if (check.notes.length) ok(text.includes(check.notes[0].slice(0, 12)), '报告里应包含校验器的 note');
    eq(text.includes('【错误】'), true);
});

import * as pngMod from '../src/image/png.js';
import * as rasterMod from '../src/image/raster.js';
import * as fsMod from 'node:fs';
function requirePng() { return pngMod; }
function requireRaster() { return rasterMod; }
function requireFs() { return fsMod; }
void loadProject; void saveProject; void PREVIEW_FILES;
finish();
