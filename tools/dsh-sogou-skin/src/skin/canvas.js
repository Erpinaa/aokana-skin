// @ts-check
/**
 * 预览图用的「画布工具」—— 所有出图模块共用同一套排版/贴图/标注实现。
 *
 * 为什么单独一层：v0.1.0 里 render.js 与 preview.js 各自实现了一份 blit/棋盘格/缩放，
 * 结果两边对透明度的处理不一致（bgcheck 的标注还会互相重叠）。v0.2.0 收敛到这里，
 * 谁要画预览图都只用这些函数。
 *
 * 画布统一是 `{width,height,data}` 的 Raster（RGBA8，直通 alpha，**不做预乘**）。
 */
import { create, fillRect, paste, resize } from '../image/raster.js';
import { drawText, measureText } from '../image/font5x7.js';

/** 常用配色（深色 UI 风格）。 */
export const PALETTE = {
    bg: [18, 20, 24, 255],
    panel: [28, 31, 37, 255],
    panelAlt: [36, 39, 46, 255],
    grid: [58, 62, 72, 255],
    gridAlt: [46, 50, 58, 255],
    title: [238, 240, 248, 255],
    label: [150, 158, 175, 255],
    accent: [120, 200, 235, 255],
    ok: [140, 225, 180, 255],
    warn: [255, 200, 110, 255],
    bad: [255, 120, 120, 255],
};

/**
 * 一个简单的画布包装。
 */
export class Sheet {
    /** @param {number} width @param {number} height @param {number[]} [fill] */
    constructor(width, height, fill = PALETTE.bg) {
        this.raster = create(width, height, fill);
        this.width = this.raster.width;
        this.height = this.raster.height;
    }

    /**
     * 在 (x,y) 画一行 5x7 点阵文字。
     * @param {string} text @param {number} x @param {number} y
     * @param {number[]} [color] @param {number} [scale]
     * @returns {number} 文本宽度
     */
    text(text, x, y, color = PALETTE.label, scale = 1) {
        drawText(this.raster, String(text), Math.round(x), Math.round(y), /** @type {any} */ (color), scale);
        return measureText(String(text), scale).w;
    }

    /**
     * 画标题（带一条下划线，便于快速区分区块）。
     * @param {string} text @param {number} x @param {number} y
     * @param {{color?:number[], scale?:number, rule?:boolean}} [opts]
     */
    heading(text, x, y, opts = {}) {
        const scale = opts.scale ?? 1;
        const w = this.text(text, x, y, opts.color ?? PALETTE.title, scale);
        if (opts.rule !== false) {
            fillRect(this.raster, x, y + 7 * scale + 2, w, 1, [90, 100, 120, 200]);
        }
        return w;
    }

    /**
     * 把一张图画到画布上（source-over，透明像素保留）。
     * @param {import('../image/png.js').Raster} src
     * @param {number} x @param {number} y
     */
    blit(src, x, y) {
        paste(this.raster, src, Math.round(x), Math.round(y));
    }

    /**
     * 画棋盘格背景（用于展示透明区域）。
     * @param {number} x @param {number} y @param {number} w @param {number} h @param {number} [cell]
     */
    checker(x, y, w, h, cell = 8) {
        for (let yy = 0; yy < h; yy += cell) {
            for (let xx = 0; xx < w; xx += cell) {
                const c = (((xx / cell | 0) + (yy / cell | 0)) % 2) ? PALETTE.grid : PALETTE.gridAlt;
                fillRect(this.raster, x + xx, y + yy,
                    Math.min(cell, w - xx), Math.min(cell, h - yy), c);
            }
        }
    }

    /**
     * 画一个带 1px 边框的块。
     * @param {number} x @param {number} y @param {number} w @param {number} h
     * @param {number[]} [color]
     */
    box(x, y, w, h, color = [70, 76, 88, 255]) {
        fillRect(this.raster, x, y, w, 1, color);
        fillRect(this.raster, x, y + h - 1, w, 1, color);
        fillRect(this.raster, x, y, 1, h, color);
        fillRect(this.raster, x + w - 1, y, 1, h, color);
    }

    /**
     * 画一段文字说明（自动换行：按字符数硬折，点阵字体只支持 ASCII）。
     * @param {string} text @param {number} x @param {number} y
     * @param {{maxChars?:number, color?:number[], lineH?:number, maxLines?:number}} [opts]
     * @returns {number} 结束 y
     */
    paragraph(text, x, y, opts = {}) {
        const maxChars = opts.maxChars ?? 88;
        const lineH = opts.lineH ?? 10;
        const color = opts.color ?? PALETTE.label;
        const maxLines = opts.maxLines ?? 99;
        const lines = wrapAscii(String(text), maxChars).slice(0, maxLines);
        let cy = y;
        for (const line of lines) { this.text(line, x, cy, color, 1); cy += lineH; }
        return cy;
    }
}

/**
 * 按字符数折行（点阵字体没有中文字形，中文渲染出来是豆腐块 —— 所以出图里的文案一律用英文/数字，
 * 中文说明写进 preview/report.txt）。
 * @param {string} text @param {number} maxChars
 * @returns {string[]}
 */
export function wrapAscii(text, maxChars) {
    /** @type {string[]} */
    const out = [];
    for (const raw of String(text).split(/\n/)) {
        let line = '';
        for (const word of raw.split(/(\s+)/)) {
            if ((line + word).length <= maxChars) { line += word; continue; }
            if (line.trim()) out.push(line.trimEnd());
            if (word.length > maxChars) {
                // 超长单词硬切
                let rest = word;
                while (rest.length > maxChars) { out.push(rest.slice(0, maxChars)); rest = rest.slice(maxChars); }
                line = rest;
            } else line = word.trimStart();
        }
        out.push(line.trimEnd());
    }
    return out;
}

/**
 * 把图缩到不超过 maxW×maxH（保持比例，1:1 优先）。
 * @param {import('../image/png.js').Raster} r
 * @param {number} maxW @param {number} maxH
 * @returns {{raster:import('../image/png.js').Raster, scale:number, w:number, h:number}}
 */
export function fitTo(r, maxW, maxH) {
    const scale = Math.min(1, maxW / r.width, maxH / r.height);
    const w = Math.max(1, Math.round(r.width * scale));
    const h = Math.max(1, Math.round(r.height * scale));
    return { raster: scale === 1 ? r : resize(r, w, h, 'bilinear'), scale, w, h };
}

/** 从图里裁一块，越界自动夹取。 */
export function cropClamped(r, x, y, w, h) {
    const x0 = Math.max(0, Math.min(r.width - 1, Math.round(x)));
    const y0 = Math.max(0, Math.min(r.height - 1, Math.round(y)));
    const ww = Math.max(1, Math.min(r.width - x0, Math.round(w)));
    const hh = Math.max(1, Math.min(r.height - y0, Math.round(h)));
    const out = create(ww, hh);
    for (let yy = 0; yy < hh; yy++) {
        for (let xx = 0; xx < ww; xx++) {
            const s = ((y0 + yy) * r.width + (x0 + xx)) * 4;
            const d = (yy * ww + xx) * 4;
            out.data[d] = r.data[s]; out.data[d + 1] = r.data[s + 1];
            out.data[d + 2] = r.data[s + 2]; out.data[d + 3] = r.data[s + 3];
        }
    }
    return out;
}
