// @ts-check
/**
 * 九宫格 / 布局模型测试 —— 守住整个项目最贵的几条结论。
 *
 * 核心不变量：
 *  - `L+R > 目标宽` 才退化；`L+R === 目标宽` 是合法设计（原生 400 窗口就是这么工作的）；
 *  - 内缩先夹到源图尺寸内（真实皮肤会写超过源图的内缩）；
 *  - 只在真正会变化的那根轴上检查"零内缩/中段花纹"；
 *  - 候选条背景覆盖是启发式（只出 note，不能当判定）。
 */
import { create, fillRect, setPixel } from '../src/image/raster.js';
import { computeLayout, parseLayout, realisticSizes, detailDensity, findStretchJumps,
    auditPanel, detectNineSlice, detectMargins, findFlatBand, checkCandidateBackdrop,
    REAL_WINDOW } from '../src/skin/layout.js';
import { t, section, finish, eq, ok, deepEq, near } from './_harness.mjs';

/** 画一张带头/中/尾的横排面板。 */
function panelH({ width = 240, height = 120, head = 60, tail = 60 } = {}) {
    const r = create(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (x < head) setPixel(r, x, y, ((x + y) % 6 < 3) ? [10, 10, 10, 255] : [240, 240, 240, 255]);
        else if (x >= width - tail) setPixel(r, x, y, [90, 60, 140, 255]);
        else setPixel(r, x, y, [180, 200, 200, 255]);
    }
    return r;
}

/* ---------------- parseLayout ---------------- */
section('layout 解析');
t('解析 mode,a,b 三元组', () => {
    deepEq(parseLayout('0,100,300'), { mode: 0, a: 100, b: 300 });
    deepEq(parseLayout('1,30,95'), { mode: 1, a: 30, b: 95 });
    deepEq(parseLayout(undefined), { mode: 0, a: 0, b: 0 });
    deepEq(parseLayout('坏数据'), { mode: 0, a: 0, b: 0 });
});
t('parseLayout 支持数组形式（工程配置里写过）', () => {
    deepEq(parseLayout([0, 12, 34]), { mode: 0, a: 12, b: 34 });
});

/* ---------------- computeLayout ---------------- */
section('computeLayout（唯一真源）');
t('常规拉伸：夹取 + 中段尺寸', () => {
    const pic = create(650, 258);
    const l = computeLayout(pic, { layoutH: '0,100,300', layoutV: '0,33,11', targetW: 460, targetH: 258 });
    eq(l.L, 100); eq(l.R, 300); eq(l.T, 33); eq(l.B, 11);
    eq(l.midSrcW, 250); eq(l.midDstW, 60);
    eq(l.degenerate, false);
});
t('L+R === 目标宽 判为合法（不是退化）', () => {
    const pic = create(650, 258);
    const l = computeLayout(pic, { layoutH: '0,100,300', layoutV: '0,33,11', targetW: 400, targetH: 258 });
    eq(l.degenerate, false);
    eq(l.midDstW, 0);
});
t('L+R > 目标宽 判为退化，并给出原因', () => {
    const pic = create(650, 258);
    const l = computeLayout(pic, { layoutH: '0,100,300', layoutV: '0,0,1', targetW: 399, targetH: 258 });
    eq(l.degenerate, true);
    ok(l.reasons.length > 0);
    ok(/左右内缩/.test(l.reasons[0]), '原因：' + l.reasons.join(';'));
});
t('T+B > 目标高 判为退化（历史上的"整图纵向压扁"）', () => {
    const pic = create(650, 258);
    // 被改坏的那组：0,168,12 -> T+B=180，只要窗口高 < 180 就退化
    const l = computeLayout(pic, { layoutH: '0,0,1', layoutV: '0,168,12', targetW: 460, targetH: 168 });
    eq(l.degenerate, true);
    ok(/上下内缩/.test(l.reasons.join(';')));
});
t('内缩超过源图时先夹取（苍翠欲滴 30+95 > 120）', () => {
    const pic = create(120, 87);
    const l = computeLayout(pic, { layoutH: '1,30,95', layoutV: '0,0,0', targetW: 400, targetH: 87 });
    ok(l.L + l.R <= pic.width - 1, '夹取后 L+R 不应超过源图宽-1，实际 ' + l.L + '+' + l.R);
    ok(l.clamped.length > 0, '应记录夹取动作');
    eq(l.degenerate, false);
    eq(l.modeX, 'tile');
});
t('mode 1 解析成平铺', () => {
    const pic = create(120, 87);
    const l = computeLayout(pic, { layoutH: '1,30,95', layoutV: '0,0,0', targetW: 400, targetH: 87 });
    eq(l.modeX, 'tile');
    eq(l.modeY, 'stretch');
});
t('非正的目标尺寸被兜住', () => {
    const pic = create(10, 10);
    const l = computeLayout(pic, { layoutH: '0,0,0', layoutV: '0,0,0', targetW: 0, targetH: -5 });
    ok(l.targetW >= 1 && l.targetH >= 1);
});

/* ---------------- realisticSizes ---------------- */
section('真实量级探测尺寸');
t('横排：包含真机 460 宽与紧凑高度 168', () => {
    const sizes = realisticSizes('h', 650, 258);
    ok(sizes.some(([w]) => w === 460), '缺少真机实测的 460 宽');
    ok(sizes.some(([w, h]) => w === 460 && h === 168), '缺少紧凑高度 168（历史翻车场景）');
    ok(sizes.every(([w]) => w >= 460), '不应探测 <460 的宽度（真机不会给那么窄）');
});
t('竖排：只向上加高、不探测变矮（避免对正常皮肤误报）', () => {
    const sizes = realisticSizes('v', 340, 420);
    ok(sizes.every(([, h]) => h >= 420), '竖排高度不应小于底图高');
    ok(sizes.some(([, h]) => h > 420), '应包含"候选变多窗口加高"的尺寸');
});

/* ---------------- detail / seam ---------------- */
section('中段细节与接缝检测');
t('detailDensity：纯色中段 ≈ 0，花纹头 ≈ 高', () => {
    const r = panelH();
    const mid = detailDensity(r, 60, 0, 120, 120, 'h');
    const head = detailDensity(r, 0, 0, 59, 120, 'h');
    ok(mid < 0.02, '中段细节密度应接近 0，实际 ' + mid);
    ok(head > 0.3, '头部花纹细节密度应较高，实际 ' + head);
});
t('透明区不参与统计（否则大片透明会稀释出假平坦）', () => {
    // 全透明子区域里没有任何"相邻像素对"可统计 -> 0，而不是被当成平坦
    const r = create(100, 20);
    fillRect(r, 10, 10, 20, 5, [255, 255, 255, 255]);
    eq(detailDensity(r, 0, 0, 40, 8, 'h'), 0);
    // 有内容的地方仍然是 > 0（不会被整幅透明区稀释掉）
    ok(detailDensity(r, 8, 8, 24, 9, 'h') > 0.05);
});
t('findStretchJumps 能抓到中段里的稳定色差', () => {
    const r = create(120, 40, [180, 200, 200, 255]);
    for (let y = 0; y < 40; y++) for (let x = 60; x < 120; x++) setPixel(r, x, y, [40, 40, 40, 255]);
    const jumps = findStretchJumps(r, { L: 10, R: 10, T: 0, B: 0 }, 'h');
    ok(jumps.jumps.length >= 1, '应检测到跳变，实际 ' + jumps.jumps.length);
    eq(jumps.jumps[0].at, 59);
});
t('平滑渐变不应被判成跳变', () => {
    const r = create(120, 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 120; x++) setPixel(r, x, y, [100 + x, 150, 180, 255]);
    const jumps = findStretchJumps(r, { L: 10, R: 10, T: 0, B: 0 }, 'h');
    eq(jumps.jumps.length, 0);
});

/* ---------------- auditPanel ---------------- */
section('九宫格体检（三级输出）');
t('健康面板：0 error', () => {
    const r = panelH();
    const a = auditPanel(r, { left: 60, right: 60, top: 0, bottom: 0 }, { growAxis: 'h' });
    eq(a.issues.filter((i) => i.level === 'error').length, 0);
    ok(a.ok);
});
t('退化会报 error（真机上必然变形）', () => {
    // 700 宽的底图、左右内缩各 300（合计 600 > 真机最小窗口宽 460）—— 九宫格装不下
    const r = create(700, 258, [180, 200, 200, 255]);
    const a = auditPanel(r, { left: 300, right: 300, top: 0, bottom: 0 }, { growAxis: 'h' });
    const errs = a.issues.filter((i) => i.level === 'error');
    eq(errs.length, 1);
    eq(errs[0].code, 'nine-slice-degenerate');
});
t('可拉伸中段混进花纹 -> warn busy-middle', () => {
    const r = panelH();
    // 把整个中段涂成噪点（模拟装饰进入拉伸区）
    for (let y = 0; y < 120; y++) for (let x = 60; x < 180; x++) setPixel(r, x, y, ((x + y) % 4 < 2) ? [0, 0, 0, 255] : [255, 255, 255, 255]);
    const a = auditPanel(r, { left: 60, right: 60, top: 0, bottom: 0 }, { growAxis: 'h' });
    ok(a.issues.some((i) => i.code === 'busy-middle-h'), '应报 busy-middle-h');
});
t('该设内缩的边为 0 且有装饰 -> warn（只在会变化的那根轴上报）', () => {
    const r = panelH();
    const a = auditPanel(r, { left: 0, right: 60, top: 0, bottom: 0 }, { growAxis: 'h' });
    ok(a.issues.some((i) => i.code === 'left-zero'), '应报 left-zero');
    const b = auditPanel(r, { left: 60, right: 60, top: 0, bottom: 0 }, { growAxis: 'h' });
    ok(!b.issues.some((i) => i.code === 'top-zero'), '横排不应检查上端的零内缩');
});
t('分体底图可以关掉 edge/busy 检查（只查退化）', () => {
    const r = panelH();
    const a = auditPanel(r, { left: 0, right: 0, top: 0, bottom: 0 }, { growAxis: 'h', busyChecks: false, edgeChecks: false });
    ok(!a.issues.some((i) => i.code === 'left-zero'));
    ok(!a.issues.some((i) => i.code === 'busy-middle-h'));
});
t('小图（分体底图/图标）直接跳过体检', () => {
    const r = create(20, 20, [1, 2, 3, 255]);
    const a = auditPanel(r, { left: 0, right: 0, top: 0, bottom: 0 }, { growAxis: 'h' });
    eq(a.skipped, true);
    eq(a.issues.length, 0);
});

/* ---------------- 探测 ---------------- */
section('九宫格自动探测');
t('findFlatBand 在纯色中段找到最长平坦带', () => {
    const r = panelH();
    const band = findFlatBand(r, { axis: 'h', tol: 4, flatRatio: 0.92 });
    ok(band, '应找到平坦带');
    ok(band.start >= 55 && band.start <= 65, '平坦带起点应在头部边界附近，实际 ' + band.start);
    ok(band.end <= 185, '平坦带终点应在尾部之前，实际 ' + band.end);
});
t('detectNineSlice 横向：left/right 推在装饰边界附近', () => {
    const r = panelH();
    const ns = detectNineSlice(r, { axis: 'h' });
    ok(ns.confidence >= 0.45);
    ok(Math.abs(ns.left - 60) < 15, 'left 应接近 60，实际 ' + ns.left);
    ok(Math.abs(ns.right - 60) < 15, 'right 应接近 60，实际 ' + ns.right);
});
t('detectMargins 的 zhongwen_marge[0] 是行间距而不是绝对 y', () => {
    const r = create(200, 100, [0, 0, 0, 0]);
    fillRect(r, 20, 20, 160, 60, [200, 200, 200, 255]);
    const m = detectMargins(r, {});
    ok(m.zhongwen_marge[0] <= 12, '候选行间距应是小值（5~8 量级），实际 ' + m.zhongwen_marge[0]);
    ok(m.pinyin_marge[0] >= 8, '拼音行是绝对 y，应落在面板上部（不是 4 那种默认值），实际 ' + m.pinyin_marge[0]);
});

/* ---------------- 候选条背景 ---------------- */
section('候选条背景覆盖（启发式）');
t('背景充足时不告警', () => {
    const r = create(200, 100, [180, 200, 200, 255]);
    const c = checkCandidateBackdrop(r, { row2Y: 40, fontSize: 16, left: 10, right: 10, bottomFixed: 0 });
    near(c.coverage, 1, 0.01);
    eq(c.level, null);
});
t('背景不足时只出 note，且文案里带已知反例', () => {
    const r = create(200, 100);
    const c = checkCandidateBackdrop(r, { row2Y: 40, fontSize: 16, left: 10, right: 10, bottomFixed: 11 });
    eq(c.level, 'note');
    ok(/已知|反例|不要仅凭/.test(c.msg), 'note 文案应提醒这不是判定：' + c.msg);
});
t('真机标定常量存在且自洽', () => {
    eq(REAL_WINDOW.dpi, 168);
    near(REAL_WINDOW.h1.logical[0], 460, 0);
    near(REAL_WINDOW.h1.logical[1], 259, 0);
    near(REAL_WINDOW.h1.logical[1] / REAL_WINDOW.h1.source[1], 1, 0.01);
    // 第二次实测：9 个候选时窗口接近底图宽、高度变大（多行候选）
    near(REAL_WINDOW.h1NineCandidates.logical[0] / REAL_WINDOW.h1NineCandidates.source[0], 1, 0.02);
    ok(REAL_WINDOW.h1NineCandidates.logical[1] > REAL_WINDOW.h1NineCandidates.source[1], '多行候选时窗口应变高');
});

finish();
