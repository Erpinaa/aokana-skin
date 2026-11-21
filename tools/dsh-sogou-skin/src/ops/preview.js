// @ts-check
/**
 * 预览出图调度：装配 → 校验 → 出 6 张图 + 1 份中文报告。
 *
 * 产物固定写入 `<工程>/preview/`：
 *   render.png    引擎模型真渲染（多宽度/多候选/状态栏三态）  ← 判断效果的首选
 *   zoom.png      头/中/尾、候选条下沿、状态栏按钮 1x/1.75x 逐段放大
 *   bgcheck.png   白底/黑底对照（按真机宽度拉伸后）
 *   stretch.png   拉伸体检（沿真实变化方向）
 *   assets.png    素材总览
 *   preview.png   一页总览（看板，不用于判断变形）
 *   report.txt    中文量化报告（窗口/九宫格/接缝/候选条覆盖率/全部 errors/warnings/notes）
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleProject } from './build.js';
import { validateSkin } from './validate.js';
import { renderBgCheck, renderRealistic, renderZoom } from '../skin/render.js';
import { renderMock, renderSheet, renderStretchTest, toPng } from '../skin/preview.js';
import { ensureDir } from '../util/fs.js';
import { formatBytes } from '../util/text.js';

/** 预览产物文件名（对外契约：只增不改）。 */
export const PREVIEW_FILES = {
    render: 'render.png',
    zoom: 'zoom.png',
    bgcheck: 'bgcheck.png',
    stretch: 'stretch.png',
    assets: 'assets.png',
    preview: 'preview.png',
    report: 'report.txt',
};

/**
 * 生成一份预览。
 * @param {string} dir 工程目录
 * @param {{sheet?:boolean, now?:Date|string, outDir?:string}} [opts]
 */
export function previewProject(dir, opts = {}) {
    const res = assembleProject(dir, { now: opts.now });
    if (!res.ok) return { ok: false, error: res.error };
    const previewDir = opts.outDir || join(res.dir, 'preview');
    ensureDir(previewDir);

    const paths = {};
    const write = (key, raster) => {
        const p = join(previewDir, PREVIEW_FILES[key]);
        writeFileSync(p, Buffer.from(toPng(raster)));
        paths[key] = p;
        return p;
    };

    const real = renderRealistic(res.files, { title: res.project.name || 'SKIN' });
    write('render', real.raster);
    const bg = renderBgCheck(res.files);
    write('bgcheck', bg.raster);
    const stretch = renderStretchTest(res.files, { title: res.project.name || '' });
    write('stretch', stretch);
    const zoom = renderZoom(res.files);
    write('zoom', zoom.raster);
    if (opts.sheet !== false) {
        write('assets', renderSheet(res.files));
    }
    const mock = renderMock(res.files, {
        title: res.project.name || '',
        warnings: res.warnings,
        notes: res.notes,
        designScale: res.project.assets?.scale ?? 1,
    });
    write('preview', mock);

    // 校验（复用唯一校验器，保证"预览里说的"和"validate 说的"一致）
    const check = validateSkin({
        files: res.files, kind: 'project', target: res.dir, project: res.project,
        errors: [], warnings: [], notes: [],
    });

    const report = buildReport(res, check, real, bg, zoom);
    const reportPath = join(previewDir, PREVIEW_FILES.report);
    writeFileSync(reportPath, report, 'utf8');
    paths.report = reportPath;

    return {
        ok: true,
        dir: res.dir,
        previewDir,
        paths,
        files: res.files.length,
        rawBytes: res.meta.rawBytes,
        renderNotes: real.notes,
        zoomNotes: zoom.notes,
        bgcheckIssues: bg.worst,
        validation: { ok: check.ok, errors: check.errors, warnings: check.warnings, notes: check.notes },
        warnings: [...check.warnings],
        notes: [...check.notes],
        measure: check.measure,
        summary: check.summary,
    };
}

/**
 * 中文量化报告（给人和 AI 读，不是给图读的）。
 * @param {any} res @param {any} check @param {any} real @param {any} bg @param {any} zoom
 */
function buildReport(res, check, real, bg, zoom) {
    const L = [];
    const add = (s = '') => L.push(s);
    add('搜狗皮肤工坊 · 预览报告');
    add('====================');
    add('');
    add('工程：' + res.dir);
    add('皮肤：' + (res.project.name || '') + '  /  作者：' + (res.project.author || ''));
    add('文件：' + res.files.length + ' 个，未压缩 ' + formatBytes(res.meta.rawBytes));
    add('素材缩放：' + (res.project.assets?.scale ?? 1) + 'x');
    add('');
    add('【结论】' + check.summary);
    add('');
    add('【九宫格与两排文字】');
    for (const [scheme, p] of Object.entries(check.measure.panels || {})) {
        add('  ' + scheme + '  底图 ' + p.pic + ' ' + p.size);
        add('    layout: L=' + p.L + ' R=' + p.R + ' T=' + p.T + ' B=' + p.B +
            '（modeH=' + p.modeH + ' modeV=' + p.modeV + '）');
        add('    文字: 拼音行 y=' + p.row1Y + '  候选行 y=' + p.row2Y + '（font_size=' + check.measure.fontSize + '）');
        add('    可拉伸中段: ' + p.midW + 'x' + p.midH +
            '  细节密度: 横 ' + p.hDetail + '% / 纵 ' + p.vDetail + '%');
        add('    中段相邻列/行最大色差: ' + p.seamMaxDelta + '（>' + 35 + ' 的跳变 ' + p.seamJumps + ' 处）');
        add('    候选条背景覆盖率: ' + Math.round((p.backdropCoverage || 0) * 100) + '%');
        add('    退化尺寸: ' + (p.degenerateSizes.length ? p.degenerateSizes.join(' / ') : '无'));
    }
    add('');
    add('【错误】' + (check.errors.length ? '' : ' 无'));
    for (const e of check.errors) add('  [ERROR] ' + e);
    add('【警告】' + (check.warnings.length ? '' : ' 无'));
    for (const w of check.warnings) add('  [WARN ] ' + w);
    add('【建议】' + (check.notes.length ? '' : ' 无'));
    for (const n of check.notes) add('  [NOTE ] ' + n);
    add('');
    add('【渲染视图】');
    for (const v of real.report.views || []) {
        add('  ' + v.label);
        if (v.report?.layout) {
            add('      target=' + v.report.target + '  degenerate=' + (v.report.degenerate ? 'YES' : 'no') +
                '  rows=' + v.report.row1Y + '/' + v.report.row2Y + '  candidates=' + v.report.candidatesDrawn);
        }
    }
    add('');
    add('【白底对照】');
    if (!bg.worst.length) add('  未发现"画面明亮但边缘明显偏暗"的面板。');
    for (const w of bg.items) add('  ok ' + w.label);
    for (const n of bg.notes) add('  [WARN ] ' + n);
    add('');
    add('【放大检查】');
    for (const n of zoom.notes) add('  [NOTE ] ' + n);
    if (!zoom.notes.length) add('  见 zoom.png：头/中/尾三点三段 + 状态栏按钮 1x/1.75x。');
    add('');
    add('判断顺序：render.png（真实布局/候选贴底）→ zoom.png（像素细节）→ stretch.png（拉伸）→ bgcheck.png（勾边底色）→ assets.png（素材规格）。');
    add('preview.png 只是总览看板，不能用来判断拉伸变形。');
    return L.join('\n') + '\n';
}
