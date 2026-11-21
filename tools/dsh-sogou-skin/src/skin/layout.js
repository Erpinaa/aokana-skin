// @ts-check
/**
 * 九宫格 / 布局参数的**唯一真源**。
 *
 * 引擎的布局模型（全部来自真实皮肤与真机截图标定，不是推测）：
 *
 *   layout_horizontal = mode, left,  right   九宫格「不可拉伸」的左右边宽；mode 0=拉伸 1=平铺
 *   layout_vertical   = mode, top,   bottom  九宫格「不可拉伸」的上下边高
 *   pinyin_marge / zhongwen_marge = top, bottom, left, right
 *
 * 退化（整张底图被硬缩放）的判据：
 *   `left + right > 窗口宽`  或  `top + bottom > 窗口高`
 * 内缩之和【等于】窗口尺寸不是退化 —— 这时四角正好拼满、中段宽度为 0，是合法设计
 * （复刻-雷电将军原生窗口 400 宽、`left+right=400` 就是这种情况，v0.1.0 在这里判错过）。
 *
 * v0.2.0 把「夹取 + 退化判定 + 平铺/拉伸」收敛到 `computeLayout()` 一处，
 * 渲染器、校验器、拉伸体检图都调它，避免三份实现各说各话。
 */
import { getPixel } from '../image/raster.js';
import { intTuple, numberList, clamp } from '../util/text.js';

/**
 * 真机实测数据（DPI 168 / 缩放 1.75×），供文档、预览图与测试引用。
 * 来源于 `05-真机测试/报告.md` 与 docs/LESSONS.md 第 5 条。
 */
export const REAL_WINDOW = {
    dpi: 168,
    scale: 1.75,
    h1: {
        source: [650, 258],
        physical: [805, 454],
        logical: [460, 259],
        note: '纵向 259 vs 底图 258 = 1.004，高度不缩放；宽度随候选数量变化（另一次实测 646）',
    },
    /** 第二次真机实测（9 个候选、多行显示）：窗口宽度 ≈ 底图宽，高度变大。 */
    h1NineCandidates: {
        source: [720, 244],
        physical: [1247, 554],
        logical: [712.6, 316.6],
        note: '9 个候选时窗口宽度≈底图宽（712.6 vs 720），高度 316.6 > 底图 244：' +
            '引擎在底图下方自动补一块候选区背景（矩形，宽度≈候选文字块宽，颜色取玉带中下部 ≈ (184,222,205)）',
    },
    note: '窗口高度通常 = 底图原始高度、纵向不缩放；但候选多行时窗口会变高，' +
        '引擎在底图下方补一块候选区背景（颜色取自候选条下部）。宽度按内容算（实测 460 / 646 / ≈底图宽）',
};

/**
 * 解析 `layout_horizontal` / `layout_vertical`：`mode,a,b`。
 * 缺省或非法时返回全 0（mode=0 拉伸）。
 * @param {string|number[]|undefined|null} value
 * @returns {{mode:number, a:number, b:number}}
 */
export function parseLayout(value) {
    const t = intTuple(value, 3);
    if (!t) return { mode: 0, a: 0, b: 0 };
    return { mode: t[0], a: t[1], b: t[2] };
}

/**
 * 计算一次九宫格布局。
 *
 * @param {{width:number,height:number}} pic 底图
 * @param {{layoutH?:any, layoutV?:any, targetW:number, targetH:number}} opts
 * @returns {{
 *   L:number,R:number,T:number,B:number,
 *   modeX:'stretch'|'tile', modeY:'stretch'|'tile',
 *   midSrcW:number, midSrcH:number, midDstW:number, midDstH:number,
 *   degenerate:boolean, reasons:string[], clamped:string[], targetW:number, targetH:number,
 * }}
 */
export function computeLayout(pic, opts) {
    const W = pic.width;
    const H = pic.height;
    const targetW = Math.max(1, Math.round(opts.targetW));
    const targetH = Math.max(1, Math.round(opts.targetH));
    const lh = parseLayout(opts.layoutH);
    const lv = parseLayout(opts.layoutV);
    const clamped = [];

    // 内缩先夹到源图之内：真实皮肤里内缩之和可以超过源图尺寸
    // （苍翠欲滴 layout_horizontal=1,30,95，30+95=125 > 底图宽 120），引擎显然是夹住处理的。
    let L = Math.max(0, Math.round(lh.a));
    if (L > W - 1) { clamped.push('left ' + L + '→' + (W - 1)); L = W - 1; }
    let R = Math.max(0, Math.round(lh.b));
    if (R > W - 1 - L) { clamped.push('right ' + R + '→' + (W - 1 - L)); R = W - 1 - L; }
    let T = Math.max(0, Math.round(lv.a));
    if (T > H - 1) { clamped.push('top ' + T + '→' + (H - 1)); T = H - 1; }
    let B = Math.max(0, Math.round(lv.b));
    if (B > H - 1 - T) { clamped.push('bottom ' + B + '→' + (H - 1 - T)); B = H - 1 - T; }

    const modeX = lh.mode === 1 ? 'tile' : 'stretch';
    const modeY = lv.mode === 1 ? 'tile' : 'stretch';
    const midSrcW = W - L - R;
    const midSrcH = H - T - B;
    const midDstW = targetW - L - R;
    const midDstH = targetH - T - B;

    const reasons = [];
    // 注意是【严格大于】：L+R == targetW 时中段为 0，四角正好拼满，合法。
    if (L + R > targetW) reasons.push('左右内缩 ' + (L + R) + ' > 目标宽 ' + targetW);
    if (T + B > targetH) reasons.push('上下内缩 ' + (T + B) + ' > 目标高 ' + targetH);

    return {
        L, R, T, B, modeX, modeY,
        midSrcW, midSrcH, midDstW, midDstH,
        degenerate: reasons.length > 0,
        reasons, clamped, targetW, targetH,
    };
}

/**
 * 一组「真实量级」的窗口尺寸，用于退化探测。
 *
 * 依据（真机实测 + docs/LESSONS.md 第 5 条）：
 *  - 横排候选窗：高度 ≈ 底图高（实测 251~268 vs 258），但**内容很少时会自适应变矮** ——
 *    历史上 `layout_vertical` 内缩偏大（0,168,12，和 180）就是在这个场景下退化的，
 *    所以横排额外探测一个紧凑高度 168。
 *  - 竖排候选窗：高度只会随候选变多而**变大**，宽度不变，因此不探测"变矮"；
 *    它的固定区（top/bottom）本来就是按底图原高设计的。
 *
 * @param {'h'|'v'} growAxis
 * @param {number} picW @param {number} picH
 * @returns {[number,number][]}
 */
export function realisticSizes(growAxis, picW, picH) {
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {[number,number][]} */
    const out = [];
    const add = (w, h) => {
        const ww = Math.max(8, Math.round(w));
        const hh = Math.max(8, Math.round(h));
        const key = ww + 'x' + hh;
        if (seen.has(key)) return;
        seen.add(key);
        out.push([ww, hh]);
    };
    if (growAxis === 'h') {
        // 横向候选窗：打字越多越宽（真机实测 460 / 646），高度基本 = 底图高，内容少时可变矮。
        // 宽度下限取 460（真机实测的最小值）：再小就属于"引擎根本不会给出"的尺寸，
        // 拿它去判退化会把真实商店皮肤误判（原神—雷电将军 L+R=418，但在 460+ 的窗口里完全正常）。
        const compactH = Math.max(40, Math.min(picH, 168));
        const widths = [460, 640, 900];
        // 真机实测：候选很多时窗口宽度会接近底图宽（712.6 vs 720），因此把底图宽也纳入探测。
        const nativeW = Math.round(picW);
        if (!widths.includes(nativeW)) widths.push(nativeW);
        const heights = [compactH, Math.max(40, picH - 2), picH, picH + 80, picH + 120];
        for (const w of widths) for (const h of heights) add(w, h);
    } else {
        // 竖向候选窗：候选越多越高，宽度不变（不再探测"变矮"，避免对正常皮肤误报）。
        const heights = [picH, picH + 120, picH + 240, picH + 400];
        const widths = [Math.max(8, picW - 2), picW, picW + 120];
        for (const w of widths) for (const h of heights) add(w, h);
    }
    return out;
}

/**
 * 中间可拉伸区域的「细节密度」：相邻像素差异超过阈值的比例。
 * 越接近 0 说明这块区域越平，拉伸越不会看出破绽。
 * @param {import('../image/png.js').Raster} r
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {'h'|'v'} axis 拉伸方向：'h' 沿水平拉（比较同一行相邻像素），'v' 沿垂直拉
 * @param {number} [tol]
 * @returns {number} 0..1
 */
export function detailDensity(r, x, y, w, h, axis, tol = 14) {
    if (w < 2 || h < 2) return 0;
    let busy = 0;
    let total = 0;
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            const a = getPixel(r, xx, yy);
            const b = axis === 'h' ? getPixel(r, xx + 1, yy) : getPixel(r, xx, yy + 1);
            // 两端都透明的像素对直接【不参与统计】—— 否则大片透明会把"细节密度"稀释掉。
            if (a[3] < 8 && b[3] < 8) continue;
            total++;
            if (Math.abs(a[0] - b[0]) > tol || Math.abs(a[1] - b[1]) > tol ||
                Math.abs(a[2] - b[2]) > tol || Math.abs(a[3] - b[3]) > tol) busy++;
        }
    }
    return total ? busy / total : 0;
}

/**
 * 在可拉伸中段里找「相邻列/行颜色跳变」—— 其实就是接缝与花纹进入拉伸区的量化检测。
 *
 * 原理：拉伸中段里如果存在**稳定的颜色跳变**（一整列和旁边一整列明显不同），
 * 拉宽之后它会被横向抹开成一条渐变的线，或把花纹扯变形。
 * 只统计两边都不透明的像素对，透明区不算。
 *
 * @param {import('../image/png.js').Raster} r
 * @param {{L:number,R:number,T:number,B:number}} ns
 * @param {'h'|'v'} axis
 * @param {number} [threshold] 相邻列平均色差阈值
 * @returns {{jumps:{at:number,delta:number}[], maxDelta:number}}
 */
export function findStretchJumps(r, ns, axis, threshold = 35) {
    const { L, R, T, B } = ns;
    /** @type {{at:number,delta:number}[]} */
    const jumps = [];
    let maxDelta = 0;
    if (axis === 'h') {
        const x0 = L;
        const x1 = r.width - R - 1;
        const y0 = T;
        const y1 = r.height - B;
        if (x1 - x0 < 4 || y1 - y0 < 4) return { jumps, maxDelta };
        for (let x = x0; x < x1; x++) {
            let n = 0, s0 = [0, 0, 0], s1 = [0, 0, 0];
            for (let y = y0; y < y1; y++) {
                const a = getPixel(r, x, y);
                const b = getPixel(r, x + 1, y);
                if (a[3] < 128 || b[3] < 128) continue;
                n++;
                s0[0] += a[0]; s0[1] += a[1]; s0[2] += a[2];
                s1[0] += b[0]; s1[1] += b[1]; s1[2] += b[2];
            }
            if (n < Math.max(4, Math.round((y1 - y0) * 0.2))) continue;
            const d = Math.max(
                Math.abs(s0[0] - s1[0]), Math.abs(s0[1] - s1[1]), Math.abs(s0[2] - s1[2])) / n;
            if (d > maxDelta) maxDelta = d;
            if (d > threshold) jumps.push({ at: x, delta: Math.round(d) });
        }
    } else {
        const y0 = T;
        const y1 = r.height - B - 1;
        const x0 = L;
        const x1 = r.width - R;
        if (y1 - y0 < 4 || x1 - x0 < 4) return { jumps, maxDelta };
        for (let y = y0; y < y1; y++) {
            let n = 0, s0 = [0, 0, 0], s1 = [0, 0, 0];
            for (let x = x0; x < x1; x++) {
                const a = getPixel(r, x, y);
                const b = getPixel(r, x, y + 1);
                if (a[3] < 128 || b[3] < 128) continue;
                n++;
                s0[0] += a[0]; s0[1] += a[1]; s0[2] += a[2];
                s1[0] += b[0]; s1[1] += b[1]; s1[2] += b[2];
            }
            if (n < Math.max(4, Math.round((x1 - x0) * 0.2))) continue;
            const d = Math.max(
                Math.abs(s0[0] - s1[0]), Math.abs(s0[1] - s1[1]), Math.abs(s0[2] - s1[2])) / n;
            if (d > maxDelta) maxDelta = d;
            if (d > threshold) jumps.push({ at: y, delta: Math.round(d) });
        }
    }
    return { jumps, maxDelta };
}

/**
 * 九宫格体检 —— 把「输入长文本时窗体被拉长、边角变形」变成可检测的硬指标。
 *
 * 输出分三级：
 *  - `error`：退化（真机上必然整图缩放/变形）；
 *  - `warn`：很可能出问题（可拉伸中段细节过多、该设内缩的一侧是 0 且有装饰）；
 *  - `note`：启发式提示（已知反例存在，不要仅凭它改图）。
 *
 * @param {import('../image/png.js').Raster} r
 * @param {{left:number,right:number,top:number,bottom:number,modeH?:number,modeV?:number}} ns
 * @param {{growAxis?:'h'|'v', busyThreshold?:number, sizes?:[number,number][]}} [opts]
 */
export function auditPanel(r, ns, opts = {}) {
    const growAxis = opts.growAxis || 'h';
    const busyChecks = opts.busyChecks !== false;
    const edgeChecks = opts.edgeChecks !== false;
    const busyThreshold = opts.busyThreshold ?? 0.35;
    /** @type {{level:'error'|'warn'|'note',code:string,msg:string}[]} */
    const issues = [];
    const W = r.width;
    const H = r.height;
    const isMainPanel = W >= 64 && H >= 48;
    if (!isMainPanel) {
        return { ok: true, issues, skipped: true, degenerateSizes: [], maxDetail: 0, seam: { jumps: [], maxDelta: 0 } };
    }

    const layoutH = [ns.modeH ?? 0, ns.left, ns.right].join(',');
    const layoutV = [ns.modeV ?? 0, ns.top, ns.bottom].join(',');
    const sizes = opts.sizes || realisticSizes(growAxis, W, H);
    const bad = [];
    for (const [w, h] of sizes) {
        const layout = computeLayout(r, { layoutH, layoutV, targetW: w, targetH: h });
        if (layout.degenerate) bad.push(w + 'x' + h + '（' + layout.reasons.join('；') + '）');
    }
    if (bad.length) {
        issues.push({
            level: 'error', code: 'nine-slice-degenerate',
            msg: '九宫格退化：在 ' + bad.length + ' 组真实量级尺寸下内缩之和 ≥ 窗口尺寸，引擎只能整图缩放 → ' +
                '底图被压扁拉长。命中：' + bad.slice(0, 4).join(' / ') + (bad.length > 4 ? ' 等' : '') +
                '。**只在真正会变的那根轴上设内缩，另一轴给 0,0,1**',
        });
    }

    const midW = W - Math.round(ns.left) - Math.round(ns.right);
    const midH = H - Math.round(ns.top) - Math.round(ns.bottom);
    const x = Math.max(0, Math.round(ns.left));
    const y = Math.max(0, Math.round(ns.top));
    const hDetail = midW > 2 && midH > 2 ? detailDensity(r, x, y, midW - 1, midH, 'h') : 0;
    const vDetail = midW > 2 && midH > 2 ? detailDensity(r, x, y, midW, midH - 1, 'v') : 0;
    if (growAxis === 'h' && busyChecks && midW > 2 && hDetail > busyThreshold) {
        issues.push({
            level: 'warn', code: 'busy-middle-h',
            msg: '可水平拉伸区里细节偏多（相邻像素差异 ' + Math.round(hDetail * 100) + '%）—— ' +
                '里面可能混进了图案或装饰，拉长时会被拉变形。装饰应全部限制在头/尾，把 left/right 调到装饰的实际宽度',
        });
    }
    if (growAxis === 'v' && busyChecks && midH > 2 && vDetail > busyThreshold) {
        issues.push({
            level: 'warn', code: 'busy-middle-v',
            msg: '可垂直拉伸区里细节偏多（' + Math.round(vDetail * 100) + '%），同上：装饰只放头尾',
        });
    }

    // 该设内缩的边是 0，而那一侧确实有带细节的内容 —— 拉伸时尖角/箭头会被拉变形。
    const edgeProblem = (side) => {
        if (!edgeChecks) return null;
        const sideOnGrowAxis = growAxis === 'h' ? (side === 'left' || side === 'right') : (side === 'top' || side === 'bottom');
        if (!sideOnGrowAxis) return null;
        const size = (side === 'left' || side === 'right') ? W : H;
        const strip = Math.max(4, Math.round(size * 0.12));
        const x0 = side === 'left' ? 0 : side === 'right' ? W - strip : 0;
        const y0 = side === 'top' ? 0 : side === 'bottom' ? H - strip : 0;
        const w = (side === 'left' || side === 'right') ? strip : W;
        const h = (side === 'top' || side === 'bottom') ? strip : H;
        let content = 0, total = 0;
        for (let yy = y0; yy < y0 + h; yy++) {
            for (let xx = x0; xx < x0 + w; xx++) {
                total++;
                if (getPixel(r, xx, yy)[3] > 16) content++;
            }
        }
        const ratio = total ? content / total : 0;
        if (ratio < 0.05) return null;
        const detail = detailDensity(r, x0, y0, Math.max(1, w - 1), h, 'h');
        if (detail < 0.06) return null;   // 有内容但是纯色/渐变，拉伸无害
        return { ratio, detail };
    };
    for (const [side, value, label] of [
        ['left', ns.left, '左端'], ['right', ns.right, '右端'],
        ['top', ns.top, '上端'], ['bottom', ns.bottom, '下端'],
    ]) {
        if (value !== 0) continue;
        const p = edgeProblem(side);
        if (!p) continue;
        issues.push({
            level: 'warn', code: side + '-zero',
            msg: label + '边宽 = 0，但该侧有可见且有细节的内容（不透明占比 ' + Math.round(p.ratio * 100) +
                '%，细节密度 ' + Math.round(p.detail * 100) + '%）。**窗体沿该轴拉长时，' + label +
                '的尖角/箭头/圆角会被拉变形** —— 把 ' + side + ' 设为该装饰的实际像素宽度',
        });
    }

    // 接缝/花纹进入可拉伸中段的量化检测（启发式，只报 note）
    const seam = findStretchJumps(r, { L: Math.round(ns.left), R: Math.round(ns.right), T: Math.round(ns.top), B: Math.round(ns.bottom) }, growAxis);
    if (seam.jumps.length) {
        const list = seam.jumps.slice(0, 5).map((j) => (growAxis === 'h' ? 'x=' : 'y=') + j.at + ' Δ' + j.delta).join('、');
        issues.push({
            level: 'note', code: 'stretch-jump',
            msg: '可拉伸中段里有 ' + seam.jumps.length + ' 处相邻列/行的稳定色差 > 35（' + list +
                (seam.jumps.length > 5 ? ' 等' : '') + '）。真机上拉长后可能变成一条线或被抹开；' +
                '如果那只是刻意的细节，可忽略',
        });
    }

    return {
        ok: issues.filter((i) => i.level === 'error').length === 0,
        issues,
        skipped: false,
        degenerateSizes: bad,
        midW, midH, hDetail, vDetail,
        seam,
    };
}

/**
 * 在可拉伸方向上找「完全平坦」的最长连续带。
 * @param {import('../image/png.js').Raster} r
 * @param {{axis?:'h'|'v',tol?:number,flatRatio?:number}} [opts]
 */
export function findFlatBand(r, opts = {}) {
    const axis = opts.axis || 'h';
    const tol = opts.tol ?? 12;
    const flatRatio = opts.flatRatio ?? 0.75;
    const W = r.width;
    const H = r.height;
    const n = axis === 'h' ? W - 1 : H - 1;
    const span = axis === 'h' ? H : W;
    /** @type {number[]} */
    const flat = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
        let same = 0;
        let counted = 0;
        for (let j = 0; j < span; j++) {
            const a = axis === 'h' ? getPixel(r, i, j) : getPixel(r, j, i);
            const b = axis === 'h' ? getPixel(r, i + 1, j) : getPixel(r, j, i + 1);
            // 两端都透明的像素对不参与统计 —— 否则大片透明区会被误判成"平坦带"
            if (a[3] < 8 && b[3] < 8) continue;
            counted++;
            if (Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol &&
                Math.abs(a[2] - b[2]) <= tol && Math.abs(a[3] - b[3]) <= tol) same++;
        }
        flat[i] = counted ? same / counted : 0;
    }
    let bestStart = -1;
    let bestEnd = -1;
    let cur = -1;
    for (let i = 0; i <= n; i++) {
        const ok = i < n && flat[i] >= flatRatio;
        if (ok && cur < 0) cur = i;
        else if (!ok && cur >= 0) {
            if (bestStart < 0 || (i - cur) > (bestEnd - bestStart)) { bestStart = cur; bestEnd = i; }
            cur = -1;
        }
    }
    if (bestStart < 0 || bestEnd - bestStart < 4) return null;
    const score = flat.slice(bestStart, bestEnd).reduce((a, b) => a + b, 0) / (bestEnd - bestStart);
    const spanLen = axis === 'h' ? W : H;
    return {
        start: bestStart, end: bestEnd, score,
        left: axis === 'h' ? bestStart : 0,
        right: axis === 'h' ? spanLen - bestEnd : 0,
        top: axis === 'v' ? bestStart : 0,
        bottom: axis === 'v' ? spanLen - bestEnd : 0,
    };
}

/**
 * 找出图像里最大的一块近似纯色区域（在降采样网格上做，避免逐像素爆开销）。
 * @param {import('../image/png.js').Raster} r
 * @param {{tol?:number, grid?:number}} [opts]
 */
export function detectSolidRegion(r, opts = {}) {
    const tol = opts.tol ?? 12;
    const grid = opts.grid ?? 160;
    const step = Math.max(1, Math.ceil(Math.max(r.width, r.height) / grid));
    /** @type {Map<number, {n:number,minX:number,maxX:number,minY:number,maxY:number}>} */
    const buckets = new Map();
    for (let y = 0; y < r.height; y += step) {
        for (let x = 0; x < r.width; x += step) {
            const [pr, pg, pb, pa] = getPixel(r, x, y);
            if (pa < 200) continue;
            // 量化到 5 位/通道，容忍轻微渐变与噪点
            const key = ((pr >> 3) << 10) | ((pg >> 3) << 5) | (pb >> 3);
            let b = buckets.get(key);
            if (!b) { b = { n: 0, minX: x, maxX: x, minY: y, maxY: y }; buckets.set(key, b); }
            b.n++;
            if (x < b.minX) b.minX = x;
            if (x > b.maxX) b.maxX = x;
            if (y < b.minY) b.minY = y;
            if (y > b.maxY) b.maxY = y;
        }
    }
    let best = null;
    for (const [key, b] of buckets) {
        const area = (b.maxX - b.minX + step) * (b.maxY - b.minY + step);
        // 用「桶内像素数 / 包围盒面积」衡量纯净度，避免选中稀疏但包围盒巨大的颜色
        const density = b.n / Math.max(1, area / (step * step));
        const score = b.n * density;
        if (!best || score > best.score) {
            best = {
                score, n: b.n,
                x: b.minX, y: b.minY,
                w: b.maxX - b.minX + step, h: b.maxY - b.minY + step,
                color: [((key >> 10) & 31) << 3, ((key >> 5) & 31) << 3, (key & 31) << 3],
                coverage: +(b.n / ((r.width / step) * (r.height / step))).toFixed(3),
            };
        }
    }
    if (!best) return null;
    // 按容差把包围盒向外扩一点，吸收抗锯齿边
    return {
        x: Math.max(0, best.x - tol),
        y: Math.max(0, best.y - tol),
        w: Math.min(r.width - Math.max(0, best.x - tol), best.w + tol * 2),
        h: Math.min(r.height - Math.max(0, best.y - tol), best.h + tol * 2),
        color: best.color,
        coverage: best.coverage,
    };
}

/**
 * 由「最长无花纹带」反推九宫格边界。
 * @param {import('../image/png.js').Raster} r
 * @param {{axis?:'h'|'v',tol?:number,flatRatio?:number,fallback?:object}} [opts]
 * @returns {{left:number,right:number,top:number,bottom:number,confidence:number,note:string}}
 */
export function detectNineSlice(r, opts = {}) {
    const W = r.width;
    const H = r.height;
    const axis = opts.axis || 'h';
    const fb = opts.fallback || {};
    const solid = detectSolidRegion(r, opts);
    // 首选：直接找图上「相邻像素一致」的最长连续带。
    // 九宫格中段本来就该是一段没有花纹的区域，拉长时把它抻开、其余部分原地不动。
    // 这比"最大纯色块的包围盒"精确得多 —— 后者会把带花纹的区域也算进去，拉长时花纹被抹开。
    const hb = findFlatBand(r, { axis: 'h', tol: opts.tol ?? 4, flatRatio: opts.flatRatio ?? 0.92 });
    const vb = findFlatBand(r, { axis: 'v', tol: opts.tol ?? 4, flatRatio: opts.flatRatio ?? 0.92 });
    if (axis === 'v') {
        if (vb && vb.end - vb.start >= 6) {
            return {
                left: fb.left ?? 0, right: fb.right ?? 0,
                top: vb.top, bottom: vb.bottom,
                confidence: 0.9,
                note: '纵向拉伸：可拉伸区 y∈[' + vb.start + ',' + vb.end + ')，' +
                    (vb.end - vb.start) + 'px 无花纹',
            };
        }
    } else if (hb && hb.end - hb.start >= 6) {
        return {
            left: hb.left, right: hb.right,
            top: fb.top ?? 0, bottom: fb.bottom ?? 0,
            confidence: 0.9,
            note: '横向拉伸：可拉伸区 x∈[' + hb.start + ',' + hb.end + ')，' +
                (hb.end - hb.start) + 'px 无花纹，拉伸时不会把图案抹开',
        };
    }
    if (!solid) {
        return { left: 0, right: 0, top: 0, bottom: 0, confidence: 0, note: '没有找到不透明纯色区，未推导九宫格' };
    }
    let left = solid.x;
    let right = W - (solid.x + solid.w);
    let top = solid.y;
    let bottom = H - (solid.y + solid.h);
    const note = [];
    // 夹到合理区间：任何一边都不该超过 62%，否则等于整图不可拉伸
    const clampNote = (v, total, name) => {
        const max = Math.round(total * 0.62);
        if (v < 0) { note.push(name + ' 为负已归零'); return 0; }
        if (v > max) { note.push(name + ' 超过 62%（' + v + '→' + max + '）'); return max; }
        return v;
    };
    left = clampNote(left, W, 'left');
    right = clampNote(right, W, 'right');
    top = clampNote(top, H, 'top');
    bottom = clampNote(bottom, H, 'bottom');
    if (left + right >= W - 4) {
        note.push('左右边界吃满整幅宽度，退化为「左侧可拉伸、右侧保留」');
        left = Math.round(W * 0.25);
        right = Math.round(W * 0.45);
    }
    const confidence = solid.coverage > 0.08 ? 0.8 : 0.45;
    return { left, right, top, bottom, confidence, note: note.join('；') || '由最大纯色区反推' };
}

/**
 * 由纯色区反推文字区内边距（top, bottom, left, right）。
 * @param {import('../image/png.js').Raster} r
 * @param {{pad?:number,rowGap?:number,tol?:number}} [opts]
 */
export function detectMargins(r, opts = {}) {
    const pad = opts.pad ?? 4;
    const solid = detectSolidRegion(r, opts);
    if (!solid) {
        return {
            pinyin_marge: [pad, pad, pad, Math.round(r.width * 0.4)],
            zhongwen_marge: [pad, pad, pad, Math.round(r.width * 0.4)],
            note: '未找到纯色区，使用保守默认',
        };
    }
    const top = solid.y + pad;
    const bottom = Math.max(pad, r.height - (solid.y + solid.h) + pad);
    const left = solid.x + pad;
    // 右侧留白给立绘：底图右边缘到纯色区右边缘的距离
    const artReserve = r.width - (solid.x + solid.w);
    const pinyin_marge = [top, bottom, left, Math.max(pad, Math.round(artReserve * 0.15))];
    // ⚠️ zhongwen_marge[0] 是【候选行相对拼音行的间距】，不是绝对 y！
    // 位置公式：候选行 y = pinyin_marge[0] + font_size + zhongwen_marge[0]
    // 真实皮肤里这个值是 5~8（雷电将军 7、原神 8）。
    const rowGap = opts.rowGap ?? 6;
    const zhongwen_marge = [rowGap, bottom, left, Math.max(pad, artReserve)];
    return {
        pinyin_marge, zhongwen_marge,
        note: '由纯色区 ' + solid.x + ',' + solid.y + ' ' + solid.w + 'x' + solid.h + ' 反推；请用预览图复核',
    };
}

/**
 * 候选词背景覆盖检查 —— 候选词会往条子下方掉，那一片必须有背景。
 *
 * **这是启发式提示，不是判定。** 已知反例：复刻-雷电将军底图最底部中间区域 0% 不透明，
 * 但真机渲染完全正常（靠 `layout_vertical` 的底部固定区兜住了）。
 * 因此只输出 `note`，并永远带上这个反例说明，避免后人照着去改一张正常的皮肤。
 *
 * @param {import('../image/png.js').Raster} r
 * @param {{row2Y:number,fontSize:number,left:number,right:number,bottomFixed:number}} opts
 * @returns {{coverage:number, level:'note'|null, msg:string}}
 */
export function checkCandidateBackdrop(r, opts) {
    const x0 = clamp(Math.round(opts.left), 0, r.width - 1);
    const x1 = clamp(Math.round(r.width - opts.right), x0 + 1, r.width);
    const y0 = clamp(Math.round(opts.row2Y), 0, r.height - 1);
    let opaque = 0, total = 0;
    for (let y = y0; y < r.height; y++) {
        for (let x = x0; x < x1; x++) {
            total++;
            if (getPixel(r, x, y)[3] > 40) opaque++;
        }
    }
    const coverage = total ? opaque / total : 0;
    const bottomFixed = Math.round(opts.bottomFixed) || 0;
    if (coverage >= 0.85) return { coverage, level: null, msg: '' };
    const hint = bottomFixed >= 4
        ? '当前 layout_vertical 的底部固定区 = ' + bottomFixed + 'px，引擎会用那一段把颜色带下去；' +
          '复刻-雷电将军同款情况，真机渲染正常。**不要仅凭这条就去改一张正常的皮肤。**'
        : '而且 layout_vertical 的底部固定区 = 0，引擎没有可兜底的区域。';
    return {
        coverage,
        level: 'note',
        msg: '候选行下方中间区域的背景覆盖率只有 ' + Math.round(coverage * 100) + '%（候选词会往下排）。' +
            hint + '请结合 render.png 的多候选视图确认。',
    };
}

/** 供外部展示用：总结一段九宫格数值的人类可读形式。 */
export function describeLayout(ns) {
    const h = [ns.modeH ?? 0, Math.round(ns.left ?? 0), Math.round(ns.right ?? 0)].join(',');
    const v = [ns.modeV ?? 0, Math.round(ns.top ?? 0), Math.round(ns.bottom ?? 0)].join(',');
    return 'layout_horizontal=' + h + '  layout_vertical=' + v + '（mode 0=拉伸 1=平铺）';
}

/** 保留 numberList 的再导出，方便老调用方从 layout 模块取。 */
export { numberList };
