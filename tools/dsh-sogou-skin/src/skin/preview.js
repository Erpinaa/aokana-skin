// @ts-check
/**
 * 预览图「辅助视图」：一页总览（preview.png）、素材总览（assets.png）、拉伸体检（stretch.png）。
 *
 * 判断皮肤真实效果请优先看 `render.png`（引擎模型真渲染）与 `zoom.png`（逐段放大）——
 * 本文件里的 `preview.png` 只是"一眼看全"的看板，**不能用来判断拉伸变形**（LESSONS 第 5 条）。
 */
import { create, paste, resize, nineSlice } from '../image/raster.js';
import { encodePng } from '../image/png.js';
import { decodePng, isPng } from '../image/png.js';
import { decodeBmp, isBmp } from '../image/bmp.js';
import { decodeIni, IniDoc, bgrToRgb, parseIniNumber, bgrToHex } from '../ssf/ini.js';
import { computeLayout, parseLayout } from './layout.js';
import { Sheet, PALETTE, fitTo } from './canvas.js';

/** @param {{name:string,data:Uint8Array}} f @returns {import('../image/png.js').Raster|null} */
function decodeEntry(f) {
    try {
        if (isPng(f.data)) return decodePng(f.data);
        if (isBmp(f.data)) return decodeBmp(f.data);
    } catch { /* 坏图跳过 */ }
    return null;
}

/** 把装配产物解成 name -> Raster。 @param {{name:string,data:Uint8Array}[]} files */
export function rasterizeFiles(files) {
    /** @type {Map<string, import('../image/png.js').Raster>} */
    const map = new Map();
    for (const f of files) {
        const r = decodeEntry(f);
        if (r) map.set(f.name, r);
    }
    return map;
}

/** @param {import('../image/png.js').Raster} r @returns {Uint8Array} */
export function toPng(r) {
    return encodePng(r);
}

/**
 * 一页总览：标题 + 三张缩略图（横排/竖排/状态栏）+ 配色卡 + 计数。
 * @param {{name:string,data:Uint8Array}[]} files 装配产物
 * @param {{title?:string, warnings?:string[], notes?:string[], designScale?:number}} [opts]
 * @returns {import('../image/png.js').Raster}
 */
export function renderMock(files, opts = {}) {
    const rasters = rasterizeFiles(files);
    const iniEntry = files.find((f) => f.name === 'Skin.ini');
    const doc = iniEntry ? new IniDoc(decodeIni(iniEntry.data)) : null;
    const num = (s, k) => parseIniNumber(doc ? doc.get(s, k) : undefined);
    const W = 1180, H = 760;
    const sheet = new Sheet(W, H);
    sheet.heading('PREVIEW BOARD', 24, 18, { scale: 2, color: PALETTE.title });
    sheet.text('ALL VIEWS COME FROM THE ACTUAL .SSF PAYLOAD - AUTHORITATIVE VIEW: render.png', 24, 46, PALETTE.label, 1);

    /** 画一个缩略图块：标题 + 棋盘格 + 图 + 说明。 */
    const thumb = (title, raster, x, y, maxW, maxH, note) => {
        const f = fitTo(raster, maxW, maxH);
        sheet.text(title, x, y, PALETTE.accent, 1);
        sheet.checker(x, y + 12, f.w, f.h);
        sheet.blit(f.raster, x, y + 12);
        sheet.box(x - 1, y + 11, f.w + 2, f.h + 2, [80, 88, 104, 255]);
        let ty = y + 14 + f.h;
        if (note) sheet.text(note, x, ty, PALETTE.label, 1);
        return ty + 14;
    };

    // 横排候选窗缩略图
    const hPicName = doc?.get('Scheme_H1', 'pic');
    const hPic = hPicName ? rasters.get(hPicName) : null;
    if (hPic) {
        const p = parseLayout(doc?.get('Scheme_H1', 'layout_horizontal'));
        const targetW = Math.max(460, p.a + p.b + 40);
        const layout = computeLayout(hPic, {
            layoutH: doc?.get('Scheme_H1', 'layout_horizontal'),
            layoutV: doc?.get('Scheme_H1', 'layout_vertical'),
            targetW, targetH: hPic.height,
        });
        const view = layout.degenerate ? resize(hPic, targetW, hPic.height, 'bilinear') : nineSliceRasterCompat(hPic, layout);
        thumb('H1 CANDIDATE WINDOW @' + targetW + 'x' + hPic.height + (layout.degenerate ? ' DEGENERATE' : ''),
            view, 24, 76, 700, 260,
            'L=' + layout.L + ' R=' + layout.R + ' T=' + layout.T + ' B=' + layout.B);
    } else {
        sheet.text('H1 PANEL MISSING', 24, 90, PALETTE.bad, 1);
    }

    // 竖排候选窗缩略图
    const vPicName = doc?.get('Scheme_V1', 'pic');
    const vPic = vPicName ? rasters.get(vPicName) : null;
    let rightY = 76;
    if (vPic) {
        const view = resize(vPic, Math.min(vPic.width, 300), Math.round(Math.min(vPic.width, 300) / vPic.width * vPic.height), 'bilinear');
        rightY = thumb('V1 CANDIDATE WINDOW (native ' + vPic.width + 'x' + vPic.height + ')', view, 780, rightY, 340, 400, '');
    }

    // 状态栏
    const barName = doc?.get('StatusBar', 'pic');
    const bar = barName ? rasters.get(barName) : null;
    if (bar) {
        rightY = thumb('STATUSBAR (native)', bar, 780, rightY + 8, 340, 240, '');
    }

    // 配色卡
    let ly = 430;
    sheet.heading('COLORS (0xBBGGRR IN INI)', 24, ly, { color: PALETTE.title });
    ly += 18;
    for (const [label, key] of [['PINYIN', 'pinyin_color'], ['FIRST', 'zhongwen_first_color'], ['ZHONGWEN', 'zhongwen_color'], ['HINT', 'comphint_color']]) {
        const v = num('Display', key);
        if (v === undefined) continue;
        const c = bgrToRgb(v);
        paste(sheet.raster, create(22, 12, [c.r, c.g, c.b, 255]), 24, ly);
        sheet.text(label + ' ' + bgrToHex(v).toUpperCase(), 54, ly + 3, PALETTE.label, 1);
        ly += 16;
    }

    // 计数与警告
    const warns = opts.warnings || [];
    const notesArr = opts.notes || [];
    let iy = 430;
    sheet.heading('SUMMARY', 320, iy, { color: PALETTE.title });
    iy += 18;
    const lines = [
        'FILES: ' + files.length,
        'WARNINGS: ' + warns.length,
        'NOTES: ' + notesArr.length,
        'DESIGN SCALE: ' + (opts.designScale ?? 1) + 'x',
        'AUTHORITATIVE: render.png / zoom.png',
    ];
    for (const line of lines) { sheet.text(line, 320, iy, line.startsWith('AUTHORITATIVE') ? PALETTE.accent : PALETTE.label, 1); iy += 12; }
    if (warns.length) {
        sheet.text('!! WARNING TEXT IS IN preview/report.txt', 320, iy + 4, PALETTE.warn, 1);
    }
    if (opts.title) sheet.text('TITLE: ' + opts.title.toUpperCase().slice(0, 48), 24, H - 18, PALETTE.label, 1);
    return sheet.raster;
}

/** @param {import('../image/png.js').Raster} pic @param {ReturnType<typeof computeLayout>} layout */
function nineSliceRasterCompat(pic, layout) {
    const mode = layout.modeX === 'tile' || layout.modeY === 'tile' ? 'tile' : 'stretch';
    return nineSlice(pic, layout.targetW, layout.targetH,
        { left: layout.L, right: layout.R, top: layout.T, bottom: layout.B, mode });
}

/**
 * 素材总览表：把装配产物里所有图片平铺出来并标注文件名与尺寸，方便一次看全。
 * @param {{name:string,data:Uint8Array}[]} files
 * @returns {import('../image/png.js').Raster}
 */
export function renderSheet(files) {
    const items = [...rasterizeFiles(files)].map(([name, r]) => ({ name, r }));
    const icons = items.filter((i) => i.r.width <= 64 && i.r.height <= 64);
    const panels = items.filter((i) => !(i.r.width <= 64 && i.r.height <= 64));
    const iconCols = 10;
    const cell = 64;
    const iconRows = Math.max(1, Math.ceil(icons.length / iconCols));
    const panelW = panels.length ? Math.min(720, Math.max(...panels.map((p) => p.r.width))) : 0;
    const panelH = panels.reduce((a, p) => a + Math.min(p.r.height, 140) + 18, 0);
    const W = Math.max(780, panelW + 40, iconCols * (cell + 8) + 40);
    const H = 56 + panelH + iconRows * (cell + 18) + 30;
    const sheet = new Sheet(W, H, [22, 22, 28, 255]);
    sheet.heading('ASSET SHEET  ' + files.length + ' FILES', 20, 16, { scale: 2 });

    let y = 50;
    for (const p of panels) {
        const scale = Math.min(1, 700 / p.r.width, 140 / p.r.height);
        const w = Math.max(1, Math.round(p.r.width * scale));
        const h = Math.max(1, Math.round(p.r.height * scale));
        const rr = scale === 1 ? p.r : resize(p.r, w, h, 'bilinear');
        sheet.checker(20, y, rr.width, rr.height);
        sheet.blit(rr, 20, y);
        sheet.text(p.name.toUpperCase() + '  ' + p.r.width + 'X' + p.r.height, 20 + rr.width + 10, y + 4, [150, 210, 255, 255], 1);
        y += Math.min(p.r.height, 140) + 18;
    }
    let ix = 20;
    let iy = y + 8;
    sheet.text('ICONS / STRIPS', 20, iy - 11, [200, 200, 214, 255], 1);
    for (const it of icons) {
        sheet.checker(ix, iy, cell, cell, 8);
        const scale = Math.max(1, Math.min(3, Math.floor(cell / Math.max(it.r.width, it.r.height)) || 1));
        const rr = resize(it.r, it.r.width * scale, it.r.height * scale, 'nearest');
        sheet.blit(rr, ix + Math.round((cell - rr.width) / 2), iy + Math.round((cell - rr.height) / 2));
        sheet.text(it.name.replace(/\.[a-z]+$/i, '').toUpperCase().slice(0, 9), ix, iy + cell + 2, [170, 170, 190, 255], 1);
        ix += cell + 8;
        if (ix + cell > W - 20) { ix = 20; iy += cell + 18; }
    }
    return sheet.raster;
}

/**
 * 拉伸测试条 —— 「输入长文本/候选变多时，边角与中段会不会变形」的专用体检图。
 *
 * 按【真实会变化的方向】拉伸：
 *   H1 只变宽 → 在 460 / 646 / 900 三个宽度下渲染（高度 = 底图高）；
 *   V1 只变高 → 在 picH / picH+200 / picH+400 三个高度下渲染（宽度 = 底图宽）。
 * 红色导引线标出不可拉伸边界，蓝色半透明带标出可拉伸中段。
 *
 * @param {{name:string,data:Uint8Array}[]} files
 * @param {{title?:string}} [opts]
 * @returns {import('../image/png.js').Raster}
 */
export function renderStretchTest(files, opts = {}) {
    const rasters = rasterizeFiles(files);
    const iniEntry = files.find((f) => f.name.toLowerCase() === 'skin.ini');
    const doc = iniEntry ? new IniDoc(decodeIni(iniEntry.data)) : null;

    /** @type {{sec:string,picName:string,pic:import('../image/png.js').Raster,
     *   lh:any,lv:any,axis:'wide'|'tall',items:{label:string,raster:import('../image/png.js').Raster,W:number,H:number}[]}[]} */
    const rows = [];
    for (const sec of ['Scheme_H1', 'Scheme_V1']) {
        const picName = doc ? doc.get(sec, 'pic') : null;
        const pic = picName ? rasters.get(picName) : null;
        if (!pic) continue;
        const lh = parseLayout(doc.get(sec, 'layout_horizontal'));
        const lv = parseLayout(doc.get(sec, 'layout_vertical'));
        const axis = sec === 'Scheme_H1' ? 'wide' : 'tall';
        const layouts = [];
        if (axis === 'wide') {
            const minW = Math.max(460, lh.a + lh.b + 40);
            for (const w of [minW, minW + 186, minW + 440]) {
                const layout = computeLayout(pic, { layoutH: doc.get(sec, 'layout_horizontal'), layoutV: doc.get(sec, 'layout_vertical'), targetW: w, targetH: pic.height });
                layouts.push({ label: 'W' + w, raster: layout.degenerate ? resize(pic, w, pic.height, 'bilinear') : nineSliceRasterCompat(pic, layout), layout });
            }
        } else {
            for (const h of [pic.height, pic.height + 200, pic.height + 400]) {
                const layout = computeLayout(pic, { layoutH: doc.get(sec, 'layout_horizontal'), layoutV: doc.get(sec, 'layout_vertical'), targetW: pic.width, targetH: h });
                layouts.push({ label: 'H' + h, raster: layout.degenerate ? resize(pic, pic.width, h, 'bilinear') : nineSliceRasterCompat(pic, layout), layout });
            }
        }
        rows.push({
            sec, picName, pic, lh, lv, axis,
            items: layouts.map((l) => ({ label: l.label, raster: l.raster, W: l.layout.targetW, H: l.layout.targetH })),
            layoutOf: (i) => layouts[i].layout,
        });
    }
    if (!rows.length) {
        const s = new Sheet(520, 120);
        s.heading('STRETCH TEST: NO PANELS', 16, 20, { scale: 2 });
        return s.raster;
    }

    const pad = 18, gap = 16, headH = 34, labelH = 14;
    const rowWidths = rows.map((r) => r.axis === 'wide'
        ? Math.max(...r.items.map((i) => i.W))
        : r.items.reduce((a, i) => a + i.W + gap, -gap));
    const W = pad * 2 + Math.max(...rowWidths, 700);
    const rowHeights = rows.map((r) => r.axis === 'wide'
        ? r.items.reduce((a, i) => a + headH + i.H + 8, 0)
        : headH + Math.max(...r.items.map((i) => i.H)) + 8);
    const H = 52 + rowHeights.reduce((a, b) => a + b + gap, 0);
    const sheet = new Sheet(W, H);
    sheet.heading('STRETCH TEST', pad, 14, { scale: 2 });
    sheet.text((opts.title || 'EACH PANEL PULLED ALONG ITS REAL AXIS - CORNERS MUST NOT DEFORM').toUpperCase(), pad, 36, PALETTE.label, 1);

    let y = 52;
    for (let ri = 0; ri < rows.length; ri++) {
        const row = rows[ri];
        const firstLayout = row.layoutOf(0);
        sheet.text(row.sec + '  ' + row.picName + '  ' + row.pic.width + 'x' + row.pic.height +
            '   L=' + firstLayout.L + ' R=' + firstLayout.R + ' T=' + firstLayout.T + ' B=' + firstLayout.B +
            '   -> ' + (row.axis === 'wide' ? 'PULL WIDER' : 'PULL TALLER'),
            pad, y, PALETTE.accent, 1);
        let ly = y + headH;
        let lx = pad;
        for (let ii = 0; ii < row.items.length; ii++) {
            const it = row.items[ii];
            const layout = row.layoutOf(ii);
            const deg = layout.degenerate;
            sheet.checker(lx, ly, it.W, it.H);
            sheet.blit(it.raster, lx, ly);
            sheet.box(lx - 1, ly - 1, it.W + 2, it.H + 2, deg ? [255, 110, 110, 255] : [80, 88, 104, 255]);
            // 可拉伸中段高亮 + 不可拉伸边界
            if (row.axis === 'wide') {
                const bw = Math.max(0, it.W - layout.L - layout.R);
                if (bw > 1) sheet.box(lx + layout.L, ly + Math.round(it.H / 2) - 7, bw, 14, [120, 220, 255, 70]);
                if (layout.L > 0) sheet.box(lx + layout.L, ly, 1, it.H, [255, 80, 80, 220]);
                if (layout.R > 0) sheet.box(lx + it.W - layout.R, ly, 1, it.H, [255, 80, 80, 220]);
            } else {
                const bh = Math.max(0, it.H - layout.T - layout.B);
                if (bh > 1) sheet.box(lx + Math.round(it.W / 2) - 7, ly + layout.T, 14, bh, [120, 220, 255, 70]);
                if (layout.T > 0) sheet.box(lx, ly + layout.T, it.W, 1, [255, 80, 80, 220]);
                if (layout.B > 0) sheet.box(lx, ly + it.H - layout.B, it.W, 1, [255, 80, 80, 220]);
            }
            sheet.text(it.label + (deg ? ' DEGENERATE' : ''), lx, ly + it.H + 3, deg ? PALETTE.bad : PALETTE.label, 1);
            if (row.axis === 'wide') ly += it.H + 8 + labelH;
            else lx += it.W + gap;
        }
        y += headH + rowHeights[ri] + gap;
    }
    return sheet.raster;
}
