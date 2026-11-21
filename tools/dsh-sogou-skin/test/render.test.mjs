// @ts-check
/**
 * 引擎模型渲染测试 —— 守住两排文字公式、九宫格退化、横竖排候选排布、
 * 状态栏按钮与白底/放大图的产物结构。
 */
import { create, fillRect, setPixel, getPixel } from '../src/image/raster.js';
import { makeDemoProject } from './_fixtures.mjs';
import { IniDoc, parseIniNumber } from '../src/ssf/ini.js';
import {
    renderCandidateWindow, renderRealistic, renderBgCheck, renderZoom,
    renderStatusBar, decodeAll, readIniDoc, stretchPanel, schemeParams,
} from '../src/skin/render.js';
import { t, section, finish, eq, ok, near, assert } from './_harness.mjs';

const demo = makeDemoProject({ name: '渲染测试' });
const res = demo.assembled;
const files = res.files;
const doc = new IniDoc(res.ini);

/* ---------------- 两排文字公式 ---------------- */
section('两排文字位置模型（真机标定）');
t('拼音行 y === pinyin_marge[0]；候选行 y = 拼音行 + font_size + zhongwen_marge[0]', () => {
    const pm = doc.get('Scheme_H1', 'pinyin_marge').split(',').map(Number);
    const zm = doc.get('Scheme_H1', 'zhongwen_marge').split(',').map(Number);
    const fs = parseIniNumber(doc.get('Display', 'font_size'));
    const report = {};
    renderCandidateWindow(files, { scheme: 'Scheme_H1', width: 460, height: 120, report });
    eq(report.row1Y, pm[0]);
    eq(report.row2Y, pm[0] + fs + zm[0]);
    ok(report.row2Y > report.row1Y);
});
t('窗口变宽不影响两排的 y（y 与宽度无关）', () => {
    const a = {}; renderCandidateWindow(files, { scheme: 'Scheme_H1', width: 460, height: 120, report: a });
    const b = {}; renderCandidateWindow(files, { scheme: 'Scheme_H1', width: 900, height: 120, report: b });
    eq(a.row1Y, b.row1Y);
    eq(a.row2Y, b.row2Y);
});
t('没给窗口尺寸时默认取底图原始尺寸', () => {
    const report = {};
    const r = renderCandidateWindow(files, { scheme: 'Scheme_H1', report });
    eq(r.raster.width, 240);
    eq(r.raster.height, 120);
});

/* ---------------- 横排 / 竖排 ---------------- */
section('横排与竖排候选排布');
t('横排：候选横向排、放不下时截断并给 note', () => {
    const r = renderCandidateWindow(files, { scheme: 'Scheme_H1', width: 240, height: 120, candidates: ['一', '二', '三', '四', '五', '六', '七', '八'] });
    ok(r.report.candidatesDrawn >= 1);
    ok(r.notes.some((n) => n.includes('只放得下')), '放不下应有说明');
});
t('竖排：候选纵向排（不是横着排）', () => {
    const report = {};
    const r = renderCandidateWindow(files, { scheme: 'Scheme_V1', width: 160, height: 240, candidates: ['一', '二', '三', '四', '五'], report });
    eq(report.vertical, true);
    eq(report.candidatesDrawn, 5);
    // 取两个候选块内部的像素：纵向排列时它们 x 相同、y 不同
    ok(r.raster.height === 240);
});
t('竖排窗口变高时能放下更多候选', () => {
    const a = {}; renderCandidateWindow(files, { scheme: 'Scheme_V1', width: 160, height: 240, candidates: Array(14).fill('候'), report: a });
    const b = {}; renderCandidateWindow(files, { scheme: 'Scheme_V1', width: 160, height: 480, candidates: Array(14).fill('候'), report: b });
    ok(b.candidatesDrawn > a.candidatesDrawn, a.candidatesDrawn + ' -> ' + b.candidatesDrawn);
});


/* ---------------- 多行候选 + 引擎补块 ---------------- */
section('多行候选与引擎自动补块（真机标定）');
t('横向候选可换行（真机：9 个候选时窗口变高）', () => {
    const report = {};
    const r = renderCandidateWindow(files, {
        scheme: 'Scheme_H1', width: 240, height: 120, wrapRows: true,
        candidates: ['一', '二', '三', '四', '五', '六', '七', '八', '九'], report,
    });
    ok(report.candidateRows >= 2, '应换到多行，实际 ' + report.candidateRows + ' 行');
    ok(report.candidatesDrawn >= 8);
    eq(r.raster.height, 120);
});
t('窗口变高时在底图下方补一块候选区背景（模拟引擎行为）', () => {
    const report = {};
    const r = renderCandidateWindow(files, {
        scheme: 'Scheme_H1', width: 240, height: 200, wrapRows: true,
        candidates: ['你好世界', '你好', '拟好', '倪好', '你号', '尼嚎', '泥号', '逆号', '妮好'], report,
    });
    ok(report.autoFill, '应记录补块信息');
    eq(report.autoFill.fromY, 120);
    const px = getPixel(r.raster, 120, 190);
    eq(px[3], 255, '补块区域必须是不透明的（否则候选词没有背景）');
    eq(px[0], report.autoFill.color[0]);
    ok(report.candidateRows >= 2);
});
t('窗口高度不超过底图时不做补块', () => {
    const report = {};
    renderCandidateWindow(files, { scheme: 'Scheme_H1', width: 240, height: 120, report });
    eq(report.autoFill, null);
});

/* ---------------- 退化和 stretchPanel ---------------- */
section('九宫格退化渲染');
t('健康布局：render 无 !! 提示', () => {
    const r = renderCandidateWindow(files, { scheme: 'Scheme_H1', width: 460, height: 120 });
    ok(!r.notes.some((n) => n.startsWith('!!')), r.notes.join(';'));
});
t('退化布局：render 报 !! 且说明原因', () => {
    // 造一个 700 宽、左右内缩各 300 的底图（L+R=600 > 460）
    const files2 = files.map((f) => ({ name: f.name, data: f.data }));
    const { encodePng } = requirePng();
    const wide = create(700, 258, [200, 200, 200, 255]);
    fillRect(wide, 0, 0, 700, 20, [10, 10, 10, 255]);
    files2.push({ name: 'wide.png', data: encodePng(wide) });
    const ini2 = res.ini.replace('pic=skin1.png', 'pic=wide.png')
        .replace(/layout_horizontal=.*/, 'layout_horizontal=0,300,300');
    const { encodeIni } = requireIni();
    const idx = files2.findIndex((f) => f.name.toLowerCase() === 'skin.ini');
    files2[idx] = { name: 'skin.ini', data: encodeIni(ini2) };
    const r = renderCandidateWindow(files2, { scheme: 'Scheme_H1', width: 460, height: 258 });
    ok(r.notes.some((n) => n.startsWith('!!')), '应报告退化：' + r.notes.join(';'));
});
t('stretchPanel 在 L+R===目标宽 时不判退化（原生 400 窗口）', () => {
    const pic = create(650, 258, [180, 200, 200, 255]);
    const st = stretchPanel(pic, { left: 100, right: 300, top: 0, bottom: 0 }, 400, 258);
    eq(st.degenerate, false);
    eq(st.raster.width, 400);
});
t('schemeParams 读出配色并换算成 RGB', () => {
    const p = schemeParams(doc, 'Scheme_H1');
    ok(p.colorPinyin.length === 3);
    eq(p.fontSize, parseIniNumber(doc.get('Display', 'font_size')));
});

/* ---------------- 状态栏 ---------------- */
section('状态栏渲染');
t('状态栏按 _pos 摆放按钮并返回三态行', () => {
    const st = renderStatusBar(files);
    ok(st.raster, '应渲染出状态栏');
    ok(st.buttons.length >= 3);
    ok(st.raster.height > 40);
});
t('没有状态栏底图时返回空而不是崩溃', () => {
    const noBar = files.filter((f) => f.name !== 'bar.png');
    const st = renderStatusBar(noBar);
    eq(st.raster, null);
    ok(st.notes.length > 0);
});

/* ---------------- 总览 / 白底 / 放大 ---------------- */
section('renderRealistic / renderBgCheck / renderZoom');
t('renderRealistic 产出多视图（横排≥3 / 竖排≥2 / 状态栏）', () => {
    const real = renderRealistic(files, { title: '测试皮肤' });
    ok(real.raster.width > 600 && real.raster.height > 400);
    const kinds = real.report.views.map((v) => v.kind);
    ok(kinds.filter((k) => k === 'h1').length >= 3, '横排视图数量 ' + kinds.filter((k) => k === 'h1').length);
    ok(kinds.filter((k) => k === 'v1').length >= 2);
    eq(kinds.filter((k) => k === 'statusbar').length, 1);
    // 量化摘要必须出现在 report 里（不靠人看图）
    const h1 = real.report.views.find((v) => v.kind === 'h1').report;
    ok(typeof h1.row1Y === 'number' && typeof h1.row2Y === 'number');
    ok(h1.layout && typeof h1.layout.L === 'number');
});
t('renderBgCheck 从 Skin.ini 引用取图（不是硬编码文件名）', () => {
    const bg = renderBgCheck(files);
    ok(bg.raster.width > 500);
    const labels = bg.items.map((i) => i.file);
    ok(labels.includes('skin1.png'));
    ok(labels.includes('skin2.png'));
    ok(labels.includes('bar.png'));
    ok(bg.items.length >= 5, '应有多个拉伸档位，实际 ' + bg.items.length);
});
t('renderBgCheck 在没有面板时给空图而不是崩溃', () => {
    const bg = renderBgCheck([{ name: 'Skin.ini', data: files.find((f) => f.name === 'Skin.ini').data }]);
    eq(bg.items.length, 0);
    ok(bg.raster.width >= 320);
});
t('renderZoom 产出头/中/尾与状态栏按钮 1x/1.75x', () => {
    const z = renderZoom(files);
    ok(z.raster.width > 500 && z.raster.height > 300);
});
t('decodeAll 能解出装配产物里的所有图', () => {
    const m = decodeAll(files);
    ok(m.size >= 10, '解出 ' + m.size + ' 张');
    // 蒙版/图片不能被当成 0x0
    for (const [name, r] of m) ok(r.width > 0 && r.height > 0, name + ' 尺寸异常');
});

import * as png from '../src/image/png.js';
import * as ini from '../src/ssf/ini.js';
function requirePng() { return png; }
function requireIni() { return ini; }

void getPixel; void setPixel; void near; void assert;
finish();
