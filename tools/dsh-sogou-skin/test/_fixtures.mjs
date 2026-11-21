// @ts-check
/**
 * 测试夹具 —— **自建数据**的工厂函数。
 *
 * 不读任何真实皮肤/素材：所有面板、图标都是用像素画出来的（纯函数 + 临时目录），
 * 因此测试在干净 checkout、无网络、无外部样本的机器上也能完整跑断言。
 */
import { join } from 'node:path';
import { create, fillRect, setPixel } from '../src/image/raster.js';
import { encodePng } from '../src/image/png.js';
import { encodeBmp24 } from '../src/image/bmp.js';
import { initProject } from '../src/ops/project.js';
import { assembleProject } from '../src/ops/build.js';
import { tmpDir, writeBin } from './_harness.mjs';

/**
 * 画一张"横排候选窗"测试底图：
 *  - 左侧 0..head 是带花纹的固定区（细节密度高，用来测零内缩告警）
 *  - 中间是纯色可拉伸带
 *  - 右侧 tail 是立绘示意（带图案）
 *  - 底部候选条贴到图片底边（可配置不贴底，用来测候选条背景检查）
 * @param {{width?:number,height?:number,head?:number,tail?:number,barTop?:number,barH?:number,
 *          barToBottom?:boolean,barColor?:number[],bgColor?:number[]}} [opts]
 */
export function makePanelH(opts = {}) {
    const W = opts.width ?? 240;
    const H = opts.height ?? 120;
    const head = opts.head ?? 60;
    const tail = opts.tail ?? 60;
    const barTop = opts.barTop ?? H - 40;
    const barH = opts.barH ?? 40;
    const barColor = opts.barColor ?? [170, 220, 210, 255];
    const bg = opts.bgColor ?? [40, 80, 90, 255];
    const r = create(W, H);
    // 固定头：斜线花纹（有细节）
    for (let y = 0; y < H; y++) for (let x = 0; x < head; x++) {
        setPixel(r, x, y, ((x + y) % 8 < 3) ? bg : [20, 50, 60, 255]);
    }
    // 可拉伸中段：纯色（允许轻微渐变 —— 渐变不算花纹）
    for (let y = 0; y < H; y++) for (let x = head; x < W - tail; x++) {
        const t = (x - head) / Math.max(1, W - head - tail);
        setPixel(r, x, y, [Math.round(160 + 30 * t), Math.round(210 + 20 * t), Math.round(205 + 15 * t), 255]);
    }
    // 固定尾：立绘示意（大色块 + 图案）
    for (let y = 0; y < H; y++) for (let x = W - tail; x < W; x++) {
        setPixel(r, x, y, ((x * 3 + y * 5) % 11 < 4) ? [90, 60, 140, 255] : [50, 40, 90, 255]);
    }
    // 候选条
    fillRect(r, head, barTop, W - tail - head + 10, opts.barToBottom === false ? barH : H - barTop, barColor);
    return r;
}

/**
 * 画一张"竖排候选窗"测试底图。
 * @param {{width?:number,height?:number,top?:number,bottom?:number,barX?:number,barW?:number}} [opts]
 */
export function makePanelV(opts = {}) {
    const W = opts.width ?? 160;
    const H = opts.height ?? 240;
    const top = opts.top ?? 50;
    const bottom = opts.bottom ?? 50;
    const barX = opts.barX ?? 12;
    const barW = opts.barW ?? 90;
    const r = create(W, H);
    // 顶部固定区
    for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) {
        setPixel(r, x, y, ((x + y) % 7 < 2) ? [70, 120, 130, 255] : [40, 90, 100, 255]);
    }
    // 中段纯色条
    fillRect(r, barX, top, barW, H - top - bottom, [190, 230, 220, 255]);
    // 中段右侧留白（透明）+ 一点装饰
    for (let y = top; y < H - bottom; y += 9) for (let x = barX + barW + 10; x < W - 4; x += 13) {
        setPixel(r, x, y, [200, 180, 120, 255]);
    }
    // 底部固定区
    for (let y = H - bottom; y < H; y++) for (let x = 0; x < W; x++) {
        setPixel(r, x, y, ((x * 2 + y) % 9 < 3) ? [60, 100, 110, 255] : [30, 70, 80, 255]);
    }
    return r;
}

/** 画一枚 20x20 的状态栏图标（带透明圆角底 + 实心标记）。 */
export function makeIcon(opts = {}) {
    const W = opts.width ?? 20;
    const H = opts.height ?? 20;
    const c = opts.color ?? [30, 110, 120, 255];
    const r = create(W, H);
    const rad = Math.min(5, Math.floor(Math.min(W, H) / 4));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const cx = x < rad ? rad - x : (x >= W - rad ? x - (W - rad - 1) : 0);
        const cy = y < rad ? rad - y : (y >= H - rad ? y - (H - rad - 1) : 0);
        if (cx > 0 && cy > 0 && (cx * cx + cy * cy) > rad * rad + rad) continue;
        const mark = Math.abs(x - W / 2) < 3 && Math.abs(y - H / 2) < 3;
        setPixel(r, x, y, mark ? [255, 230, 150, 255] : c);
    }
    return r;
}

/** 画一条状态栏底图。 */
export function makeBar(opts = {}) {
    const W = opts.width ?? 160;
    const H = opts.height ?? 40;
    const r = create(W, H);
    fillRect(r, 0, 0, W, H, [26, 62, 70, 235]);
    fillRect(r, 1, 1, W - 2, 1, [150, 200, 210, 180]);
    return r;
}

/**
 * 生成一张 PNG（BMP 也可以）图片文件。
 * @param {string} dir @param {string} name @param {any} raster
 */
export function savePng(dir, name, raster) {
    const p = join(dir, name);
    writeBin(p, encodePng(raster));
    return p;
}

/** 存成 24bpp BMP（用于测图标格式）。 */
export function saveBmp(dir, name, raster) {
    const p = join(dir, name);
    writeBin(p, encodeBmp24(raster, { background: [255, 255, 255] }));
    return p;
}

/**
 * 造一套完整、自洽、能通过校验的工程。
 * 所有素材都是程序化画的，`scale` 用于模拟 2x 素材。
 * @param {{dir?:string,name?:string,scale?:number,useRealAssets?:boolean,
 *          enableButtons?:string[], writeDisplay?:boolean}} [opts]
 * @returns {{dir:string, project:any, assets:string, assembled:any}}
 */
export function makeDemoProject(opts = {}) {
    const dir = opts.dir || tmpDir('demo-' + Math.random().toString(36).slice(2, 8));
    const init = initProject(dir, { name: opts.name || '测试皮肤', author: '测试', info: '自建数据' });
    if (!init.ok) throw new Error('初始化工程失败：' + init.error);
    const assets = join(dir, 'assets');
    const scale = opts.scale ?? 1;
    const S = (r) => scale === 1 ? r : upscale(r, scale);

    savePng(assets, 'panel_h.png', S(makePanelH({ width: 240, height: 120 })));
    savePng(assets, 'panel_v.png', S(makePanelV({ width: 160, height: 240 })));
    savePng(assets, 'bar.png', S(makeBar({ width: 160, height: 40 })));
    for (const [v, color] of [['cn', [30, 110, 120, 255]], ['en', [120, 90, 40, 255]], ['a', [80, 80, 90, 255]]]) {
        savePng(assets, v + '.png', S(makeIcon({ color })));
        savePng(assets, v + '2.png', S(makeIcon({ color: [color[0] + 30, color[1] + 30, color[2] + 30, 255] })));
        savePng(assets, v + '3.png', S(makeIcon({ color: [color[0] - 20, color[1] - 20, color[2] - 20, 255] })));
    }
    for (const b of ['biaodian', 'quan_ban', 'fan_jian', 'softkeyboard', 'menu']) {
        savePng(assets, b + '1.png', S(makeIcon({ color: [60, 120, 130, 255] })));
    }
    const project = {
        schema: 2,
        name: opts.name || '测试皮肤',
        author: '测试',
        info: '自建数据',
        email: '',
        skinTime: '2026.01.01',
        assets: { scale },
        roles: {
            panel_h: { source: 'assets/panel_h.png' },
            panel_v: { source: 'assets/panel_v.png' },
            bar: { source: 'assets/bar.png' },
            cn_en: { sources: { cn: 'assets/cn.png', en: 'assets/en.png', a: 'assets/a.png' }, states: { hover: { cn: 'assets/cn2.png', en: 'assets/en2.png', a: 'assets/a2.png' }, down: { cn: 'assets/cn3.png', en: 'assets/en3.png', a: 'assets/a3.png' } } },
            biaodian: { source: 'assets/biaodian1.png' },
            quan_ban: { source: 'assets/quan_ban1.png' },
        },
        buttons: { enabled: opts.enableButtons || ['cn_en', 'biaodian', 'quan_ban'], pos: {}, writeDisplay: opts.writeDisplay !== false },
        icon: { w: 20, h: 20, format: 'png' },
        theme: { pinyinColor: '#155a60', firstColor: '#0d7d6d', zhongwenColor: '#2b6a6e', compHintColor: '#a8802c' },
    };
    const { saveProject } = requireProject();
    saveProject(dir, project);
    const assembled = assembleProject(dir);
    return { dir, project: assembled.ok ? assembled.project : project, assets, assembled };
}

/** 最近邻放大（模拟 2x 素材；真实素材不会这样，测试只要尺寸对）。 */
function upscale(r, k) {
    const out = create(r.width * k, r.height * k);
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
        const s = ((Math.floor(y / k)) * r.width + Math.floor(x / k)) * 4;
        const d = (y * out.width + x) * 4;
        out.data[d] = r.data[s]; out.data[d + 1] = r.data[s + 1];
        out.data[d + 2] = r.data[s + 2]; out.data[d + 3] = r.data[s + 3];
    }
    return out;
}

// 延迟 import，避免夹具在模块顶层就拉起整个 ops 依赖链
import * as projectOps from '../src/ops/project.js';
function requireProject() { return projectOps; }
