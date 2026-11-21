// @ts-check
/**
 * 候选窗/状态栏渲染器 —— 按搜狗引擎的布局模型把皮肤「真正画一遍」。
 *
 * v0.1.0 的渲染器有两个已知问题，v0.2.0 一起修掉：
 *  1. 它自己维护了一套九宫格/退化逻辑，和校验器不是同一份实现，结论会分叉；
 *     现在统一走 `layout.computeLayout()`。
 *  2. 竖排候选窗的候选词被横着排（引擎是竖着排的），而且只渲染了一个窗口宽度，
 *     看不出"窗口变高/变宽时"会发生什么。现在横排给多宽度、竖排给多候选，
 *     复原真机里看到的那种"候选多了窗口变高"的场景。
 *
 * 模型（来自真实皮肤 + 真机截图标定，详见 docs/SSF-FORMAT.md 与 docs/LESSONS.md）：
 *   1. 引擎按内容算出窗口 W×H（实测：高度 = 底图原始高度，宽度随内容 460..646）；
 *   2. 按 layout_horizontal/vertical 把底图九宫格铺到 W×H；
 *   3. 两排文字：拼音行 y = pinyin_marge[0]；
 *      候选行 y = pinyin_marge[0] + font_size + zhongwen_marge[0]；
 *   4. 状态栏底图按原尺寸绘制，按钮按 *_pos 摆放。
 */
import { create, paste, resize, fillRect, getPixel } from '../image/raster.js';
import { decodePng, isPng } from '../image/png.js';
import { decodeBmp, isBmp } from '../image/bmp.js';
import { decodeIni, IniDoc, bgrToRgb, parseIniNumber } from '../ssf/ini.js';
import { drawText, measureText } from '../image/font5x7.js';
import { computeLayout, parseLayout, REAL_WINDOW } from './layout.js';
import { Sheet, PALETTE, cropClamped } from './canvas.js';

/**
 * 把装配产物里的图片条目全部解码。
 * @param {{name:string,data:Uint8Array}[]} files
 * @returns {Map<string, import('../image/png.js').Raster>}
 */
export function decodeAll(files) {
    /** @type {Map<string, import('../image/png.js').Raster>} */
    const m = new Map();
    for (const f of files) {
        try {
            if (isPng(f.data)) m.set(f.name, decodePng(f.data));
            else if (isBmp(f.data)) m.set(f.name, decodeBmp(f.data));
        } catch { /* 坏图跳过，由调用方把缺失报出来 */ }
    }
    return m;
}

/** @param {{name:string,data:Uint8Array}[]} files */
export function readIniDoc(files) {
    const e = files.find((f) => f.name.toLowerCase() === 'skin.ini');
    return e ? new IniDoc(decodeIni(e.data)) : null;
}

/** 把 'a,b,c' 解析成数字数组。 */
function nums(s, n) {
    const a = String(s ?? '').split(',').map((x) => Number(x.trim()));
    while (a.length < n) a.push(0);
    return a;
}

/**
 * 把底图按九宫格铺到目标尺寸，并报告是否退化。
 * （保留给外部脚本的兼容 API；内部现在都直接用 computeLayout + nineSliceRaster。）
 *
 * @param {import('../image/png.js').Raster} pic
 * @param {any} ns `{left,right,top,bottom}` 或 `{layoutH,layoutV}`
 * @param {number} targetW @param {number} targetH
 */
export function stretchPanel(pic, ns, targetW, targetH) {
    const layoutH = ns.layoutH ?? [ns.modeH ?? ns.mode ?? 0, ns.left, ns.right].join(',');
    const layoutV = ns.layoutV ?? [ns.modeV ?? ns.mode ?? 0, ns.top, ns.bottom].join(',');
    const layout = computeLayout(pic, { layoutH, layoutV, targetW, targetH });
    if (layout.degenerate) {
        return {
            raster: resize(pic, layout.targetW, layout.targetH, 'bilinear'),
            degenerate: true, reason: layout.reasons.join('；'), layout,
        };
    }
    // 平铺/拉伸可能两轴不同：nineSlice 的 mode 只支持一种，这里按"横向优先平铺"处理，
    // 真实皮肤里两轴都平铺的极少（样本 0 例），遇到时用 stretch 拉伸也不会变形。
    return {
        raster: nineSliceRaster(pic, layout),
        degenerate: false, reason: '', layout,
    };
}

/**
 * 按算好的布局铺图。
 * @param {import('../image/png.js').Raster} pic
 * @param {ReturnType<typeof computeLayout>} layout
 */
export function nineSliceRaster(pic, layout) {
    const { L, R, T, B } = layout;
    const tw = layout.targetW, th = layout.targetH;
    const mode = layout.modeX === 'tile' || layout.modeY === 'tile' ? 'tile' : 'stretch';
    // 中段为 0 的边界情况：四角直接拼满（raster.nineSlice 已支持）
    return importNineSlice()(pic, tw, th, { left: L, right: R, top: T, bottom: B, mode });
}

// 延迟绑定，避免 ESM 循环引用时的求值顺序问题（render ← assemble 不互相依赖，这里只是防御）。
import { nineSlice as _nineSlice } from '../image/raster.js';
function importNineSlice() { return _nineSlice; }

/**
 * 取某个候选窗方案的布局参数。
 * @param {IniDoc|null} doc @param {string} scheme
 */
export function schemeParams(doc, scheme) {
    const get = (k) => (doc ? doc.get(scheme, k) : undefined);
    const lh = parseLayout(get('layout_horizontal'));
    const lv = parseLayout(get('layout_vertical'));
    const fsRaw = parseIniNumber(doc ? doc.get('Display', 'font_size') : undefined);
    const fs = fsRaw === undefined ? 16 : fsRaw;
    const color = (k, def) => {
        const v = parseIniNumber(doc ? doc.get('Display', k) : undefined);
        if (v === undefined) return def;
        const c = bgrToRgb(v);
        return [c.r, c.g, c.b];
    };
    return {
        pic: get('pic'),
        layoutH: [lh.mode, lh.a, lh.b].join(','),
        layoutV: [lv.mode, lv.a, lv.b].join(','),
        lh, lv,
        pinyin_marge: nums(get('pinyin_marge'), 4),
        zhongwen_marge: nums(get('zhongwen_marge'), 4),
        fontSize: fs,
        colorPinyin: color('pinyin_color', [40, 40, 40]),
        colorFirst: color('zhongwen_first_color', [200, 60, 60]),
        colorOther: color('zhongwen_color', [90, 90, 90]),
        vertical: scheme === 'Scheme_V1' || scheme === 'Scheme_V2',
    };
}

/**
 * 画一个候选词块（本插件不带中文字库，用色块示意候选词，是 UI 线框图的通行做法）。
 * 块宽度按候选词长度变化 —— 长词占更宽的位置，才能真实暴露"右边距不够、压到立绘上"的问题。
 * @param {import('../image/png.js').Raster} canvas
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number[]} rgb @param {number} index @param {boolean} selected
 */
function drawCandidateBlock(canvas, x, y, w, h, rgb, index, selected) {
    if (selected) fillRect(canvas, x - 2, y - 1, w + 4, h + 4, [Math.min(255, rgb[0] + 90), Math.min(255, rgb[1] + 90), Math.min(255, rgb[2] + 90), 90]);
    fillRect(canvas, x, y, w, h, [rgb[0], rgb[1], rgb[2], selected ? 235 : 165]);
    const label = String(index + 1) + '.';
    drawText(canvas, label, x + 2, y + Math.max(0, Math.round((h - 7) / 2)), [255, 255, 255, 235], 1);
}

/**
 * 渲染一个候选窗。
 * @param {{name:string,data:Uint8Array}[]} files
 * @param {{scheme?:string, width?:number, height?:number, pinyin?:string, candidates?:string[],
 *          selected?:number, report?:any, fontScale?:number}} [opts]
 * @returns {{raster:import('../image/png.js').Raster, notes:string[], report:any}}
 */
export function renderCandidateWindow(files, opts = {}) {
    const doc = readIniDoc(files);
    const rasters = decodeAll(files);
    const scheme = opts.scheme || 'Scheme_H1';
    const notes = [];
    const report = opts.report || {};
    if (!doc) {
        const c = create(320, 60, [60, 60, 68, 255]);
        drawText(c, 'NO SKIN.INI', 8, 8, [255, 160, 160, 255], 1);
        return { raster: c, notes: ['没有 Skin.ini'], report };
    }
    const p = schemeParams(doc, scheme);
    const pic = p.pic ? rasters.get(p.pic) : null;
    if (!pic) {
        const c = create(320, 60, [60, 60, 68, 255]);
        drawText(c, scheme + ': NO PIC', 8, 8, [255, 160, 160, 255], 1);
        return { raster: c, notes: [scheme + ' 没有 pic 或图片缺失'], report };
    }
    const W = Math.max(8, Math.round(opts.width ?? pic.width));
    const H = Math.max(8, Math.round(opts.height ?? pic.height));
    // 两排文字（真机标定公式）—— 先算出来，后面取样补块颜色要用
    const row1Y = p.pinyin_marge[0];
    const row2Y = row1Y + Math.round(p.fontSize) + p.zhongwen_marge[0];
    const blockH = Math.round(p.fontSize * 1.15);
    const lineH = Math.max(blockH + 6, Math.round(p.fontSize * 1.55));

    // 真机实测：横排候选窗在多行候选时**窗口会变高**，但底图仍按原高绘制，
    // 引擎在底图下方补一块候选区背景（矩形，颜色取自玉带中下部）。
    const growsTaller = !p.vertical && H > pic.height + 1;
    const drawH = growsTaller ? pic.height : H;
    const layout = computeLayout(pic, { layoutH: p.layoutH, layoutV: p.layoutV, targetW: W, targetH: drawH });
    const canvas = create(W, H, [0, 0, 0, 0]);
    let autoFill = null;
    if (layout.degenerate) {
        canvas.data.set(resize(pic, W, drawH, 'bilinear').data);
        notes.push('!! 九宫格退化（' + layout.reasons.join('；') + '）→ 引擎只能整图缩放，必然变形');
    } else {
        canvas.data.set(nineSliceRaster(pic, layout).data);
    }
    if (growsTaller) {
        // 取样：可拉伸中段的中间区域、底图最下面若干行的不透明像素平均值。
        // 真机实测引擎补块颜色 ≈ 玉带中下部 (184,222,205)；取平均比取单点更接近。
        const sx0 = Math.max(0, Math.min(pic.width - 1, layout.L + Math.round((pic.width - layout.L - layout.R) * 0.25)));
        const sx1 = Math.max(sx0, Math.min(pic.width - 1, layout.L + Math.round((pic.width - layout.L - layout.R) * 0.75)));
        let fill = [200, 224, 214, 255];
        let n = 0, sr = 0, sg = 0, sb = 0;
        const y1 = pic.height;
        const y0 = Math.max(row2Y, pic.height - 14);
        for (let yy = y0; yy < y1; yy += 2) {
            for (let xx = sx0; xx <= sx1; xx += 2) {
                const px = getPixel(pic, xx, yy);
                if (px[3] < 200) continue;
                n++; sr += px[0]; sg += px[1]; sb += px[2];
            }
        }
        if (n > 0) fill = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n), 255];
        fillRect(canvas, 0, pic.height, W, H - pic.height, fill);
        autoFill = { fromY: pic.height, color: fill.slice(0, 3), sampledPixels: n };
    }

    const fontScale = Math.max(1, Math.min(4, Math.round((opts.fontScale ?? 1) * p.fontSize / 7)));
    if (opts.pinyin) {
        drawText(canvas, String(opts.pinyin).toUpperCase(), p.pinyin_marge[2], Math.max(0, row1Y),
            [...p.colorPinyin, 255], fontScale);
    }

    const cands = Array.isArray(opts.candidates) ? opts.candidates : ['一', '二', '三', '四', '五'];
    // 块宽随候选词长度变化：中文按每个字 ≈ font_size 估算（引擎真实排版也是按字宽推进的）
    const blockWidth = (s) => {
        const len = Math.max(1, [...String(s)].length);
        return Math.max(Math.round(p.fontSize * 1.2), Math.min(Math.round(p.fontSize * (0.95 * len + 0.7)), Math.round(W * 0.55)));
    };
    let drawn = 0;
    let overflow = false;
    let rowsUsed = 1;
    if (p.vertical) {
        let y = row2Y;
        for (let i = 0; i < cands.length; i++) {
            const bw = blockWidth(cands[i]);
            if (y + blockH > H - p.zhongwen_marge[1]) { overflow = true; break; }
            drawCandidateBlock(canvas, p.zhongwen_marge[2], y, bw, blockH,
                i === (opts.selected ?? 0) ? p.colorFirst : p.colorOther, i, i === (opts.selected ?? 0));
            drawn++;
            y += lineH;
        }
    } else {
        const wrapRows = opts.wrapRows === true;
        const rowLineH = blockH + Math.round(p.fontSize * 0.5);
        let x = p.zhongwen_marge[2];
        let line = 0;
        const rightLimit = W - p.zhongwen_marge[3];
        for (let i = 0; i < cands.length; i++) {
            const bw = blockWidth(cands[i]);
            if (x + bw > rightLimit) {
                if (!wrapRows) { overflow = true; break; }
                line++;
                x = p.zhongwen_marge[2];
            }
            const y = row2Y + line * rowLineH;
            if (y + blockH > H - p.zhongwen_marge[1]) { overflow = true; break; }
            drawCandidateBlock(canvas, x, y, bw, blockH,
                i === (opts.selected ?? 0) ? p.colorFirst : p.colorOther, i, i === (opts.selected ?? 0));
            drawn++;
            rowsUsed = line + 1;
            x += bw + Math.round(p.fontSize * 0.45);
        }
    }
    if (overflow) notes.push('窗口只放得下 ' + drawn + ' 个候选（真机上引擎会把窗口加高/加宽，本图按给定尺寸截断）');

    Object.assign(report, {
        scheme, pic: p.pic, picSize: pic.width + 'x' + pic.height, target: W + 'x' + H,
        layout, row1Y, row2Y, pinyin_marge: p.pinyin_marge, zhongwen_marge: p.zhongwen_marge,
        fontSize: p.fontSize, candidatesDrawn: drawn, candidateRows: rowsUsed,
        degenerate: layout.degenerate, vertical: p.vertical, autoFill,
    });
    return { raster: canvas, notes, report };
}

/**
 * 渲染状态栏（底图按原尺寸 + 按钮按 _pos 摆放）+ 按钮三态对照条。
 * @param {{name:string,data:Uint8Array}[]} files
 * @returns {{raster:import('../image/png.js').Raster|null, notes:string[], buttons:string[]}}
 */
export function renderStatusBar(files) {
    const doc = readIniDoc(files);
    const rasters = decodeAll(files);
    const notes = [];
    if (!doc) return { raster: null, notes: ['没有 Skin.ini'], buttons: [] };
    const barName = doc.get('StatusBar', 'pic');
    const bar = barName ? rasters.get(barName) : null;
    if (!bar) return { raster: null, notes: ['状态栏底图缺失，状态栏预览已跳过'], buttons: [] };

    // 找出 Skin.ini 里实际写了的按钮（顺序按官方槽位顺序）
    const order = ['cn_en', 'biaodian', 'quan_ban', 'quan_shuang', 'fan_jian', 'softkeyboard', 'menu', 'sogousearch', 'passport', 'skinmanager', 'voice', 'picface', 'logo'];
    const buttons = order.filter((b) => doc.get('StatusBar', b));
    let maxX = bar.width, maxY = bar.height;
    for (const b of buttons) {
        const pos = nums(doc.get('StatusBar', b + '_pos'), 2);
        maxX = Math.max(maxX, pos[0] + 28);
        maxY = Math.max(maxY, pos[1] + 28);
    }
    // 三态对照：每行一个按钮的 N/H/D
    const rowH = 26;
    const W = Math.max(bar.width, 260);
    const H = Math.max(bar.height, maxY) + 22 + buttons.length * rowH;
    const canvas = create(W, H, [32, 34, 40, 255]);
    paste(canvas, bar, 0, 0);
    drawText(canvas, 'STATUSBAR ' + bar.width + 'x' + bar.height, 2, Math.max(0, Math.max(bar.height, maxY) + 4), [150, 200, 230, 255], 1);
    for (const b of buttons) {
        const pos = nums(doc.get('StatusBar', b + '_pos'), 2);
        const v = doc.get('StatusBar', b);
        const img = v ? rasters.get(v.split(',')[0]) : null;
        if (!img) { notes.push('状态栏按钮 ' + b + ' 的图片缺失：' + v); continue; }
        paste(canvas, img, pos[0], pos[1]);
    }
    let y = Math.max(bar.height, maxY) + 18;
    const labelW = 58;
    for (const b of buttons) {
        drawText(canvas, b.toUpperCase().slice(0, 9), 2, y + 4, [180, 190, 210, 255], 1);
        let x = labelW;
        for (const [suffix, tag] of [['', 'N'], ['_hover', 'H'], ['_down', 'D']]) {
            const v = doc.get('StatusBar', b + suffix) || doc.get('StatusBar', b);
            const img = v ? rasters.get(v.split(',')[0]) : null;
            if (img) {
                paste(canvas, img, x, y + 2);
                drawText(canvas, tag, x + img.width + 2, y + 8, [140, 150, 168, 255], 1);
                x += img.width + 14;
            }
        }
        y += rowH;
    }
    return { raster: canvas, notes, buttons };
}

/**
 * 「真实渲染」总览 —— 直接把按引擎模型渲染的结果拼成一张图。
 *
 * 视图（全部走真实的九宫格 + marge + pos 路径）：
 *   · 横排候选窗 ×3：真机量级 460 宽 / 646 宽 / 646 宽但窗口变高（候选多行）
 *   · 竖排候选窗 ×2：9 个候选 / 14 个候选（后者会暴露"候选条没贴底"）
 *   · 状态栏 + 按钮三态
 *
 * @param {{name:string,data:Uint8Array}[]} files
 * @param {{title?:string}} [opts]
 */
export function renderRealistic(files, opts = {}) {
    const doc = readIniDoc(files);
    const rasters = decodeAll(files);
    /** @type {string[]} */
    const notes = [];
    const report = { views: [], notes };

    if (!doc) {
        const s = new Sheet(640, 160);
        s.heading('RENDER: NO SKIN.INI', 20, 20, { scale: 2 });
        return { raster: s.raster, notes: ['没有 Skin.ini'], report };
    }

    const h1 = schemeParams(doc, 'Scheme_H1');
    const v1 = schemeParams(doc, 'Scheme_V1');
    const hPic = h1.pic ? rasters.get(h1.pic) : null;
    const vPic = v1.pic ? rasters.get(v1.pic) : null;
    if (!hPic) notes.push('缺少横排候选窗底图');
    if (!vPic) notes.push('缺少竖排候选窗底图');

    const views = [];
    if (hPic) {
        const lh = parseLayout(h1.layoutH);
        const minW = Math.max(460, lh.a + lh.b + 40);
        const sizes = [[minW, hPic.height], [minW + 186, hPic.height], [minW + 186, hPic.height + 140]];
        const labels = [
            'H1 REAL-MIN ' + sizes[0][0] + 'x' + sizes[0][1],
            'H1 WIDE ' + sizes[1][0] + 'x' + sizes[1][1],
            'H1 TALL (many rows) ' + sizes[2][0] + 'x' + sizes[2][1],
        ];
        sizes.forEach(([w, h], i) => {
            const r = renderCandidateWindow(files, {
                scheme: 'Scheme_H1', width: w, height: h,
                pinyin: 'ni hao',
                candidates: i === 2 ? ['一', '二', '三', '四', '五', '六', '七', '八'] : ['一', '二', '三', '四', '五', '六'],
                selected: 0,
            });
            notes.push(...r.notes);
            views.push({ kind: 'h1', label: labels[i], raster: r.raster, report: r.report });
        });
        // 真实机（9 个候选）：窗口宽度 ≈ 底图宽、高度变大；引擎在底图下方自动补候选区背景。
        // 这一档专门用来核对"多行候选时窗口变高 + 补块颜色"是否自然衔接。
        const wrappedW = Math.min(Math.max(hPic.width, 460), 1200);
        const wrapped = renderCandidateWindow(files, {
            scheme: 'Scheme_H1', width: wrappedW, height: hPic.height + 80,
            pinyin: 'ni hao', candidates: ['你好世界', '你好', '拟好', '倪好', '你号', '尼嚎', '泥号', '逆号', '妮好'],
            selected: 0, wrapRows: true,
        });
        notes.push(...wrapped.notes);
        views.push({
            kind: 'h1', label: 'H1 WRAPPED 9 CANDS ' + wrappedW + 'x' + (hPic.height + 80) + ' (window grows)',
            raster: wrapped.raster, report: wrapped.report,
        });
        // 长拼音串 + 长候选词：专查左右留白会不会溢出到立绘区
        const longView = renderCandidateWindow(files, {
            scheme: 'Scheme_H1', width: sizes[1][0], height: hPic.height,
            pinyin: 'nihaoshijie', candidates: ['你好世界', '你好', '拟好', '倪好', '你号'], selected: 0,
        });
        notes.push(...longView.notes);
        longView.report.overflowWords = longView.notes.length > 0;
        views.push({
            kind: 'h1', label: 'H1 LONG PINYIN+CANDIDATES ' + sizes[1][0] + 'x' + hPic.height,
            raster: longView.raster, report: longView.report,
        });
    }
    if (vPic) {
        const sizes = [[vPic.width, vPic.height], [vPic.width, vPic.height + 240]];
        const labels = ['V1 ' + vPic.width + 'x' + vPic.height + ' (9 cands)', 'V1 TALLER ' + vPic.width + 'x' + (vPic.height + 240) + ' (14 cands)'];
        sizes.forEach(([w, h], i) => {
            const r = renderCandidateWindow(files, {
                scheme: 'Scheme_V1', width: w, height: h,
                pinyin: 'ni hao', candidates: Array.from({ length: i === 0 ? 9 : 14 }, () => '候'),
                selected: 0,
            });
            notes.push(...r.notes);
            views.push({ kind: 'v1', label: labels[i], raster: r.raster, report: r.report });
        });
    }
    const status = renderStatusBar(files);
    notes.push(...status.notes);
    if (status.raster) views.push({ kind: 'statusbar', label: 'STATUSBAR + 3-STATE', raster: status.raster, report: { buttons: status.buttons } });
    report.views = views.map((v) => ({ kind: v.kind, label: v.label, report: v.report }));
    report.rows = { row1Y: views.find((v) => v.kind === 'h1')?.report?.row1Y, row2Y: views.find((v) => v.kind === 'h1')?.report?.row2Y };

    // ---------- 排版：左列横排视图，右列状态栏 + 竖排视图 ----------
    const pad = 18, gap = 14, labelH = 14, headH = 46;
    const leftStack = views.filter((v) => v.kind === 'h1');
    const statusView = views.find((v) => v.kind === 'statusbar');
    const rightViews = views.filter((v) => v.kind === 'v1');
    const colLeftW = Math.max(...leftStack.map((v) => v.raster.width), 460);
    const rightW = Math.max(
        statusView ? statusView.raster.width : 0,
        ...rightViews.map((v) => v.raster.width), 200);
    const leftH = leftStack.reduce((a, v) => a + labelH + v.raster.height + gap, 0);
    const rightH = (statusView ? labelH + statusView.raster.height + gap : 0) +
        rightViews.reduce((a, v) => a + labelH + v.raster.height + gap, 0);
    const W = pad * 2 + colLeftW + gap + rightW;
    const H = headH + Math.max(leftH, rightH) + 30 + pad;
    const sheet = new Sheet(Math.max(W, 720), Math.max(H, 320));
    sheet.heading((opts.title || 'RENDERED BY ENGINE MODEL').toUpperCase(), pad, 14, { scale: 2, color: PALETTE.title });

    /** 画一个视图：标签 + 棋盘格 + 图 + 边框。 */
    const put = (v, x, y) => {
        sheet.text(v.label, x, y - labelH + 2, PALETTE.accent, 1);
        sheet.checker(x, y, v.raster.width, v.raster.height);
        sheet.blit(v.raster, x, y);
        sheet.box(x - 1, y - 1, v.raster.width + 2, v.raster.height + 2, [70, 78, 92, 255]);
    };
    let ly = headH;
    for (const v of leftStack) {
        put(v, pad, ly + labelH);
        ly += labelH + v.raster.height + gap;
    }
    let ry = headH;
    if (statusView) {
        put(statusView, pad + colLeftW + gap, ry + labelH);
        ry += labelH + statusView.raster.height + gap;
    }
    for (const v of rightViews) {
        put(v, pad + colLeftW + gap, ry + labelH);
        ry += labelH + v.raster.height + gap;
    }

    // ---- 量化摘要（ASCII，便于 read_image 时直接读）----
    const sy = H - 22;
    const h1Report = report.views.find((v) => v.kind === 'h1')?.report;
    if (h1Report) {
        const l = h1Report.layout;
        sheet.text('L=' + l.L + ' R=' + l.R + ' T=' + l.T + ' B=' + l.B +
            '   rows: y1=' + h1Report.row1Y + ' y2=' + h1Report.row2Y +
            '   degenerate=' + (l.degenerate ? 'YES' : 'no') +
            '   notes=' + notes.length, pad, sy, PALETTE.label, 1);
    }
    if (notes.length) {
        sheet.text('!! ' + notes.length + ' NOTE(S) - see preview/report.txt', pad, sy - 10, PALETTE.warn, 1);
    }
    return { raster: sheet.raster, notes, report };
}

/**
 * 白底 / 黑底对照 —— **黑边类缺陷只在白底暴露**。
 *
 * v0.2.0 起按真机窗口宽度出图：横排候选窗分别在 ≈460 / ≈646 逻辑像素宽下渲染后再铺白/黑底，
 * 竖排给"原生高 / 多候选加高"两档。这样既能看到勾边颜色问题，也能看到拉伸后的边缘。
 * 图名从 Skin.ini 实际引用取（不再硬编码 bar.png / skin1.png）。
 *
 * @param {{name:string,data:Uint8Array}[]} files
 * @param {{includeStatusBar?:boolean}} [opts]
 * @returns {{raster:import('../image/png.js').Raster, items:any[], worst:any[], notes:string[]}}
 */
export function renderBgCheck(files, opts = {}) {
    const doc = readIniDoc(files);
    const rasters = decodeAll(files);
    /** @type {{label:string,file:string,raster:import('../image/png.js').Raster,source:import('../image/png.js').Raster}[]} */
    const items = [];
    const add = (label, name, scheme) => {
        const src = name ? rasters.get(name) : null;
        if (!src) return;
        if (!scheme) {
            items.push({ label, file: name, raster: src, source: src });
            return;
        }
        const p = schemeParams(doc, scheme);
        const lh = parseLayout(p.layoutH);
        const lv = parseLayout(p.layoutV);
        const targets = scheme === 'Scheme_V1'
            ? [[src.width, src.height], [src.width, src.height + 240]]
            : [[Math.max(460, lh.a + lh.b + 40), src.height], [Math.max(646, lh.a + lh.b + 200), src.height]];
        for (const [w, h] of targets) {
            const layout = computeLayout(src, { layoutH: p.layoutH, layoutV: p.layoutV, targetW: w, targetH: h });
            const raster = layout.degenerate ? resize(src, w, h, 'bilinear') : nineSliceRaster(src, layout);
            items.push({ label: label + ' @' + w + 'x' + h, file: name, raster, source: src });
        }
    };
    add('H1 PANEL', doc?.get('Scheme_H1', 'pic'), 'Scheme_H1');
    add('V1 PANEL', doc?.get('Scheme_V1', 'pic'), 'Scheme_V1');
    if (opts.includeStatusBar !== false) {
        add('STATUSBAR', doc?.get('StatusBar', 'pic'));
        add('BAR MASK', doc?.get('StatusBar', 'pic_mask'));
    }
    add('H2 PINYIN', doc?.get('Scheme_H2', 'pinyin_pic'));
    add('H2 CAND', doc?.get('Scheme_H2', 'zhongwen_pic'));
    add('V2 CAND', doc?.get('Scheme_V2', 'zhongwen_pic'));
    const notes = [];
    if (!items.length) {
        const s = new Sheet(520, 100);
        s.heading('BG CHECK: NO PANELS', 16, 20, { scale: 2 });
        return { raster: s.raster, items, worst: [], notes: ['没有可对照的面板图'] };
    }

    // 量化：半透明边缘 vs 不透明内部的平均亮度。
    // 只有【内部很亮、边缘却很暗】才可能是"近黑勾边"；柔和的深色投影/立绘阴影不算。
    // 这条只是启发式：正常皮肤里也有大面积的柔和半透明边（外发光、羽化），所以阈值放得很保守。
    /** @param {import('../image/png.js').Raster} raster */
    const edgeMetric = (raster) => {
        let n = 0, sum = 0, inum = 0, isum = 0;
        for (let i = 0; i < raster.data.length; i += 4) {
            const al = raster.data[i + 3];
            const luma = (raster.data[i] + raster.data[i + 1] + raster.data[i + 2]) / 3;
            if (al >= 40 && al <= 200) { sum += luma; n++; }
            else if (al > 230) { isum += luma; inum++; }
        }
        const edge = n ? Math.round(sum / n) : 0;
        const interior = inum ? Math.round(isum / inum) : 0;
        const flag = (n > 200 && interior > 170 && edge < 80) ? 'DARK EDGE?' : 'ok';
        return { avgEdgeLuma: edge, avgInterior: interior, semi: n, flag };
    };
    const metrics = items.map((it) => ({ name: it.label, file: it.file, ...edgeMetric(it.source) }));
    const worst = metrics.filter((m) => m.flag !== 'ok');
    for (const w of worst) {
        notes.push('白底暗边待确认：' + w.file + ' 半透明边缘平均亮度 ' + w.avgEdgeLuma + '，内部 ' + w.avgInterior +
            '（' + w.semi + ' 个边缘像素）。可能是近黑勾边；**也可能只是柔和的深色外发光/立绘阴影**，' +
            '请打开 zoom.png 与白底那一格判断，不要仅凭这条改图。');
    }

    const pad = 14, gap = 10, labelH = 16, metricH = 13, rowGap = 14;
    const maxW = Math.max(...items.map((it) => it.raster.width));
    const colW = maxW + pad * 2;
    const W = pad * 2 + colW * 2 + gap;
    const H = 36 + items.reduce((a, it) => a + labelH + it.raster.height + metricH + rowGap, 0) + pad;
    const sheet = new Sheet(W, H, [96, 100, 108, 255]);
    sheet.heading('BG CHECK - LEFT: ON WHITE / RIGHT: ON BLACK', pad, 10, { scale: 1, color: [235, 236, 242, 255] });

    let y = 36;
    for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const m = metrics[idx];
        const cellH = it.raster.height;
        for (let ci = 0; ci < 2; ci++) {
            const bg = ci === 0 ? [255, 255, 255] : [0, 0, 0];
            const x = pad + ci * (colW + gap);
            fillRect(sheet.raster, x, y + labelH, colW, cellH, [...bg, 255]);
            paste(sheet.raster, it.raster, x + Math.round((colW - it.raster.width) / 2), y + labelH);
            sheet.text(it.label + ' ON ' + (ci ? 'BLACK' : 'WHITE'), x, y + 1, [225, 228, 238, 255], 1);
        }
        const flagColor = m.flag === 'ok' ? PALETTE.ok : PALETTE.bad;
        // 量化行放在两张图下面单独一行，避免和右侧面板图形/标签叠在一起
        sheet.text('edge ' + m.avgEdgeLuma + ' vs interior ' + m.avgInterior + ' (' + m.semi + ' px)  ' + m.flag +
            (m.flag === 'ok' ? '' : '  <- confirm in zoom.png / report.txt'),
            pad, y + labelH + cellH + 2, flagColor, 1);
        y += labelH + cellH + metricH + rowGap;
    }
    return { raster: sheet.raster, items, worst, notes };
}

/**
 * 逐段放大图 —— "看一眼原始像素到底长什么样"。
 *
 * 把每张主面板按九宫格边界切成 头 / 中 / 尾 三段，分别放大 2~3 倍；
 * 状态栏额外给一个「第一个按钮 4 倍放大」和「按钮区 2 倍放大」。
 * 这一步专门用来看抗锯齿、勾边、接缝、图标边缘这些在 1:1 下看不清的细节。
 *
 * @param {{name:string,data:Uint8Array}[]} files
 * @returns {{raster:import('../image/png.js').Raster, notes:string[]}}
 */
/**
 * 逐段放大图 —— "看一眼原始像素到底长什么样"。
 *
 * 把每张主面板按九宫格边界切成 头 / 中 / 尾（竖排是 上 / 中 / 下）三段放大；
 * 状态栏给「整体 1x」与「每个按钮 1.0x / 1.75x（模拟 DPI 168 放大）」两版。
 * 专门用来看抗锯齿、勾边、接缝、图标边缘这些在 1:1 下看不清的细节。
 *
 * @param {{name:string,data:Uint8Array}[]} files
 * @returns {{raster:import('../image/png.js').Raster, notes:string[]}}
 */
export function renderZoom(files) {
    const doc = readIniDoc(files);
    const rasters = decodeAll(files);
    const notes = [];
    /** @type {{title:string, parts:{label:string,raster:import('../image/png.js').Raster}[]}[]} */
    const rows = [];

    const addParts = (title, scheme, vertical) => {
        const p = schemeParams(doc, scheme);
        const pic = p.pic ? rasters.get(p.pic) : null;
        if (!pic) return;
        const lh = parseLayout(p.layoutH);
        const lv = parseLayout(p.layoutV);
        const W = pic.width, H = pic.height;
        const parts = [];
        const zoom = (crop, label) => {
            // 放大倍数：优先 2x，但要保证放大后长边不超过 520px，避免图幅爆炸
            const maxDim = Math.max(crop.width, crop.height);
            const scale = Math.max(1, Math.min(2, Math.floor(520 / maxDim) || 1));
            const scaled = scale === 1 ? crop : resize(crop, crop.width * scale, crop.height * scale, 'nearest');
            parts.push({ label: label + ' x' + scale, raster: scaled });
        };
        if (!vertical) {
            const headEnd = Math.min(W, Math.max(80, lh.a + 30));
            const tailStart = Math.max(headEnd + 20, W - Math.max(80, lh.b + 30));
            const midStart = Math.max(0, Math.floor((lh.a + W - lh.b) / 2) - 110);
            zoom(cropClamped(pic, 0, 0, headEnd, H), 'HEAD');
            zoom(cropClamped(pic, midStart, 0, Math.min(220, W - midStart), H), 'MIDDLE');
            zoom(cropClamped(pic, tailStart, 0, W - tailStart, H), 'TAIL');
        } else {
            const topEnd = Math.min(H, Math.max(80, lv.a + 30));
            const botStart = Math.max(topEnd + 20, H - Math.max(80, lv.b + 30));
            const midStart = Math.max(0, Math.floor((lv.a + H - lv.b) / 2) - 100);
            zoom(cropClamped(pic, 0, 0, W, topEnd), 'TOP');
            zoom(cropClamped(pic, 0, midStart, W, Math.min(170, H - midStart)), 'MIDDLE');
            zoom(cropClamped(pic, 0, botStart, W, H - botStart), 'BOTTOM');
        }
        rows.push({ title, parts });
    };
    addParts('H1 SEGMENTS (HEAD / MIDDLE / TAIL)', 'Scheme_H1', false);
    addParts('V1 SEGMENTS (TOP / MIDDLE / BOTTOM)', 'Scheme_V1', true);

    const status = renderStatusBar(files);
    if (status.raster) {
        rows.push({ title: 'STATUSBAR 1x', parts: [{ label: 'BAR 1x', raster: status.raster }] });
        // 状态栏按钮的 1.0x / 1.75x（DPI 168）对照 —— 20px 图标在真机上会被放大，看糊不糊
        const buttonParts = [];
        const order = ['cn_en', 'biaodian', 'quan_ban', 'quan_shuang', 'fan_jian', 'softkeyboard', 'menu', 'sogousearch', 'passport'];
        for (const b of order) {
            const v = doc?.get('StatusBar', b);
            const img = v ? rasters.get(v.split(',')[0]) : null;
            if (!img) continue;
            buttonParts.push({ label: b.slice(0, 8).toUpperCase() + ' 1x', raster: img });
            buttonParts.push({
                label: b.slice(0, 8).toUpperCase() + ' 1.75x',
                raster: resize(img, Math.max(1, Math.round(img.width * 1.75)), Math.max(1, Math.round(img.height * 1.75)), 'bilinear'),
            });
        }
        if (buttonParts.length) rows.push({ title: 'STATUSBAR BUTTONS @1x / @1.75x (DPI168)', parts: buttonParts });
    }

    if (!rows.length) {
        const s = new Sheet(520, 100);
        s.heading('ZOOM: NO PANELS', 16, 20, { scale: 2 });
        return { raster: s.raster, notes: ['没有可放大的面板'] };
    }

    // ---------- 流式排版：一行放不下就换行，标签宽度计入单元格宽度 ----------
    const pad = 16, gap = 18, titleH = 18, labelH = 12, maxRowW = 1400;
    /** @type {{row:any, lines:{cells:{part:any,cellW:number}[], w:number, h:number}[]}[]} */
    const plans = [];
    for (const row of rows) {
        /** @type {{cells:{part:any,cellW:number}[], w:number, h:number}[]} */
        const lines = [];
        let cells = [];
        let x = 0;
        let lineH = 0;
        for (const part of row.parts) {
            const labelW = measureText(part.label + '  ' + part.raster.width + 'x' + part.raster.height, 1).w;
            const cellW = Math.max(part.raster.width, labelW);
            if (cells.length && x + cellW > maxRowW) {
                lines.push({ cells, w: x, h: lineH });
                cells = []; x = 0; lineH = 0;
            }
            cells.push({ part, cellW });
            x += cellW + gap;
            lineH = Math.max(lineH, part.raster.height);
        }
        if (cells.length) lines.push({ cells, w: Math.max(0, x - gap), h: lineH });
        plans.push({ row, lines });
    }
    const contentW = Math.max(...plans.flatMap((p) => p.lines.map((l) => l.w)), 560);
    const W = pad * 2 + contentW;
    const H = 44 + plans.reduce((a, p) => a + titleH + p.lines.reduce((b, l) => b + l.h + labelH + 10, 0) + gap, 0) + pad;
    const sheet = new Sheet(W, H);
    sheet.heading('ZOOM - PIXEL-LEVEL DETAIL', pad, 12, { scale: 2 });
    let y = 44;
    for (const plan of plans) {
        sheet.text(plan.row.title, pad, y, PALETTE.accent, 1);
        y += titleH;
        for (const line of plan.lines) {
            let x = pad;
            const lineH = line.h;
            for (const cell of line.cells) {
                const part = cell.part;
                sheet.checker(x, y, part.raster.width, part.raster.height);
                sheet.blit(part.raster, x, y);
                sheet.box(x - 1, y - 1, part.raster.width + 2, part.raster.height + 2, [80, 88, 104, 255]);
                sheet.text(part.label + '  ' + part.raster.width + 'x' + part.raster.height,
                    x, y + lineH + 2, PALETTE.label, 1);
                x += cell.cellW + gap;
            }
            y += lineH + labelH + 10;
        }
        y += gap;
    }
    return { raster: sheet.raster, notes };
}

export { REAL_WINDOW };
