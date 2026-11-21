// @ts-check
/**
 * 图像层测试：PNG / BMP 编解码、光栅操作、九宫格的边界语义、点阵字体。
 * 全部自建数据，不读任何外部图片。
 */
import { create, clone, getPixel, setPixel, fillRect, resize, crop, paste, containFit, nineSlice,
    replaceColor, removeBackground, alphaBBox, trim, dominantHue, normalizeHue, adjust,
    sheetCells, autoSheetCells, outline } from '../src/image/raster.js';
import { encodePng, decodePng, isPng } from '../src/image/png.js';
import { encodeBmp24, decodeBmp, isBmp } from '../src/image/bmp.js';
import { drawText, measureText, glyph, GLYPH_W, GLYPH_H } from '../src/image/font5x7.js';
import { crc32 } from '../src/util/crc32.js';
import { t, section, finish, eq, ok, deepEq, near, assert } from './_harness.mjs';

/* ---------------- PNG ---------------- */
section('PNG 编解码（8 位 RGBA 往返）');
const pngCases = [
    ['1x1 单像素', create(1, 1, [12, 34, 56, 255])],
    ['2x3 渐变', (() => {
        const r = create(2, 3);
        for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) setPixel(r, x, y, [x * 100, y * 80, 200, 255]);
        return r;
    })()],
    ['全透明', create(8, 8, [255, 0, 0, 0])],
    ['半透明块', (() => {
        const r = create(10, 10, [255, 255, 255, 255]);
        fillRect(r, 2, 2, 4, 4, [255, 0, 0, 128]);
        return r;
    })()],
    ['抗锯齿渐变 alpha', (() => {
        const r = create(16, 16);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
            setPixel(r, x, y, [x * 16, y * 16, 128, Math.round((x + y) / 30 * 255)]);
        }
        return r;
    })()],
];
for (const [name, r] of pngCases) {
    t('PNG 往返逐字节一致：' + name, () => {
        const enc = encodePng(r);
        ok(isPng(enc), '签名不符');
        const dec = decodePng(enc);
        eq(dec.width, r.width);
        eq(dec.height, r.height);
        eq(dec.data.length, r.data.length);
        for (let i = 0; i < r.data.length; i++) {
            if (dec.data[i] !== r.data[i]) assert.fail('第 ' + i + ' 个字节不同：' + dec.data[i] + ' vs ' + r.data[i]);
        }
    });
}
t('PNG 拒绝非 PNG 输入', () => {
    assert.throws(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
});
t('PNG 大图（600x400）往返', () => {
    const r = create(600, 400);
    for (let y = 0; y < 400; y++) for (let x = 0; x < 600; x++) setPixel(r, x, y, [x & 255, y & 255, (x ^ y) & 255, 255]);
    const dec = decodePng(encodePng(r));
    eq(dec.width, 600);
    eq(dec.height, 400);
    deepEq(getPixel(dec, 123, 321), getPixel(r, 123, 321));
});

/* ---------------- BMP ---------------- */
section('BMP 编解码（搜狗风格的 24bpp）');
t('20x20 -> 1254 字节（标准尺寸，无额外填充）', () => {
    eq(encodeBmp24(create(20, 20, [255, 255, 255, 255])).length, 1254);
});
t('20x20 解码兼容 +2 填充字节', () => {
    const std = encodeBmp24(create(20, 20, [255, 0, 0, 255]));
    const padded = new Uint8Array(std.length + 2);
    padded.set(std);
    padded[2] = (std.length + 2) & 0xFF;
    padded[3] = ((std.length + 2) >> 8) & 0xFF;
    const dec = decodeBmp(padded);
    eq(dec.width, 20);
    deepEq(getPixel(dec, 5, 5).slice(0, 3), [255, 0, 0]);
});
t('BMP 往返颜色与自下而上顺序', () => {
    const r = create(4, 3);
    setPixel(r, 0, 0, [255, 0, 0, 255]);
    setPixel(r, 3, 2, [0, 255, 0, 255]);
    const dec = decodeBmp(encodeBmp24(r));
    eq(dec.width, 4);
    eq(dec.height, 3);
    deepEq(getPixel(dec, 0, 0).slice(0, 3), [255, 0, 0]);
    deepEq(getPixel(dec, 3, 2).slice(0, 3), [0, 255, 0]);
});
t('BMP 半透明合成到底色（默认白底）', () => {
    const r = create(2, 1);
    setPixel(r, 0, 0, [255, 0, 0, 128]);
    const dec = decodeBmp(encodeBmp24(r));
    const p = getPixel(dec, 0, 0);
    near(p[0], 255, 1);
    near(p[1], 127, 2);
    near(p[2], 127, 2);
});
t('BMP 识图签名', () => {
    ok(isBmp(encodeBmp24(create(2, 2, [0, 0, 0, 255]))));
    ok(!isBmp(new Uint8Array([0, 1])));
});
t('BMP 拒绝压缩格式（篡改 compression 字段）', () => {
    const b = Buffer.from(encodeBmp24(create(2, 2, [1, 2, 3, 255])));
    b.writeUInt32LE(1, 30); // BI_RLE8
    assert.throws(() => decodeBmp(new Uint8Array(b)));
});

/* ---------------- Raster ---------------- */
section('光栅操作');
t('resize 尺寸（放大/缩小/等大）', () => {
    const r = create(10, 10, [1, 2, 3, 255]);
    eq(resize(r, 25, 7).width, 25);
    eq(resize(r, 25, 7).height, 7);
    eq(resize(r, 5, 5).width, 5);
    eq(resize(r, 10, 10).width, 10);
});
t('crop 越界安全（越界补透明）', () => {
    const r = crop(create(4, 4, [9, 9, 9, 255]), 2, 2, 5, 5);
    eq(r.width, 5);
    eq(r.height, 5);
    eq(getPixel(r, 0, 0)[3], 255);
    eq(getPixel(r, 4, 4)[3], 0);
});
t('paste source-over', () => {
    const d = create(4, 4, [0, 0, 0, 255]);
    const s = create(2, 2, [255, 255, 255, 255]);
    paste(d, s, 1, 1);
    deepEq(getPixel(d, 1, 1).slice(0, 3), [255, 255, 255]);
    deepEq(getPixel(d, 0, 0).slice(0, 3), [0, 0, 0]);
});
t('containFit 等比居中', () => {
    const r = containFit(create(10, 5, [255, 0, 0, 255]), 20, 20);
    eq(r.width, 20);
    eq(r.height, 20);
    eq(getPixel(r, 10, 10)[3], 255);
    eq(getPixel(r, 0, 0)[3], 0);
});
t('replaceColor 计数与替换', () => {
    const r = create(4, 4, [255, 0, 0, 255]);
    eq(replaceColor(r, [255, 0, 0, 255], 5, [0, 255, 0, 255]), 16);
    eq(getPixel(r, 0, 0)[1], 255);
});
t('removeBackground 抠四角背景色', () => {
    const r = create(8, 8, [255, 255, 255, 255]);
    fillRect(r, 3, 3, 2, 2, [255, 0, 0, 255]);
    const n = removeBackground(r, { tol: 10 });
    eq(n, 60);
    eq(getPixel(r, 0, 0)[3], 0);
    eq(getPixel(r, 3, 3)[3], 255);
});
t('alphaBBox / trim', () => {
    const r = create(10, 10);
    fillRect(r, 2, 3, 4, 5, [1, 2, 3, 255]);
    deepEq(alphaBBox(r), { x: 2, y: 3, w: 4, h: 5 });
    const tr = trim(r);
    eq(tr.width, 4);
    eq(tr.height, 5);
});
t('dominantHue 识别纯蓝 ≈ 240°', () => {
    const h = dominantHue(create(8, 8, [0, 0, 255, 255]));
    near(h * 360, 240, 12);
});
t('normalizeHue 把蓝色搬到红色', () => {
    const r = create(8, 8, [0, 0, 255, 255]);
    normalizeHue(r, 0.0);
    const p = getPixel(r, 0, 0);
    ok(p[0] > 200 && p[2] < 60, '得到 ' + p);
});
t('adjust 亮度', () => {
    const r = create(2, 2, [100, 100, 100, 255]);
    adjust(r, { brightness: 1.5 });
    eq(getPixel(r, 0, 0)[0], 150);
});
t('outline 向外加描边', () => {
    const r = create(9, 9);
    fillRect(r, 3, 3, 3, 3, [255, 0, 0, 255]);
    outline(r, [255, 255, 255, 255], 1);
    eq(getPixel(r, 2, 4)[3], 255);
    eq(getPixel(r, 1, 4)[3], 0);
});
t('sheetCells 固定网格 / autoSheetCells 空槽切分', () => {
    const fixed = sheetCells(create(20, 20, [1, 1, 1, 255]), { cols: 2, rows: 2 });
    eq(fixed.length, 4);
    eq(fixed[0].width, 10);
    const r = create(24, 24);
    fillRect(r, 1, 1, 9, 9, [255, 0, 0, 255]);
    fillRect(r, 14, 1, 9, 9, [0, 255, 0, 255]);
    fillRect(r, 1, 14, 9, 9, [0, 0, 255, 255]);
    fillRect(r, 14, 14, 9, 9, [255, 255, 0, 255]);
    eq(autoSheetCells(r, { minCell: 5 }).length, 4);
});

/* ---------------- 九宫格边界语义 ---------------- */
section('九宫格拉伸（边界语义是踩过坑的地方）');
t('四角保持原样、中段拉伸', () => {
    const src = create(10, 10);
    setPixel(src, 0, 0, [255, 0, 0, 255]); setPixel(src, 9, 0, [0, 255, 0, 255]);
    setPixel(src, 0, 9, [0, 0, 255, 255]); setPixel(src, 9, 9, [255, 255, 0, 255]);
    const out = nineSlice(src, 40, 30, { left: 2, right: 2, top: 2, bottom: 2 });
    eq(out.width, 40);
    eq(out.height, 30);
    deepEq(getPixel(out, 0, 0).slice(0, 3), [255, 0, 0]);
    deepEq(getPixel(out, 39, 0).slice(0, 3), [0, 255, 0]);
    deepEq(getPixel(out, 0, 29).slice(0, 3), [0, 0, 255]);
    deepEq(getPixel(out, 39, 29).slice(0, 3), [255, 255, 0]);
});
t('left+right === 目标宽 是合法设计（不缩放整图）', () => {
    // 复刻-雷电将军的原生窗口就是这样：650 宽底图配 L=100 R=300、窗口 400
    const src = create(11, 5, [200, 200, 200, 255]);
    setPixel(src, 0, 0, [255, 0, 0, 255]);
    const out = nineSlice(src, 10, 5, { left: 4, right: 6, top: 0, bottom: 1 });
    eq(out.width, 10);
    // 四角 1:1：左上角像素来自源图 (0,0)
    deepEq(getPixel(out, 0, 0).slice(0, 3), [255, 0, 0]);
    // 右边界（x=4）开始是右角，取自源图 x=5
    deepEq(getPixel(out, 4, 0).slice(0, 3), [200, 200, 200]);
});
t('内缩之和 > 目标尺寸时退回整图缩放', () => {
    const src = create(100, 100, [10, 20, 30, 255]);
    const out = nineSlice(src, 30, 30, { left: 40, right: 40, top: 40, bottom: 40 });
    eq(out.width, 30);
    eq(out.height, 30);
    deepEq(getPixel(out, 15, 15).slice(0, 3), [10, 20, 30]);
});
t('平铺模式铺满中段', () => {
    const src = create(6, 6);
    fillRect(src, 0, 0, 6, 6, [5, 5, 5, 255]);
    setPixel(src, 2, 2, [250, 0, 0, 255]);
    const out = nineSlice(src, 20, 20, { left: 1, right: 1, top: 1, bottom: 1, mode: 'tile' });
    let red = 0;
    for (let i = 0; i < out.data.length; i += 4) if (out.data[i] > 200 && out.data[i + 1] < 50) red++;
    ok(red > 20, '平铺后应出现多个红色像素，实际 ' + red);
});

/* ---------------- 点阵字体 ---------------- */
section('5x7 点阵字体');
t('内置字形尺寸', () => {
    eq(GLYPH_W, 5);
    eq(GLYPH_H, 7);
    ok(glyph('A'));
    ok(glyph('Z'));
    ok(glyph('0'));
    ok(glyph('('), '括号应当有字形（预览标签用得到）');
    ok(glyph('>'), '大于号应当有字形');
    ok(glyph('?'));
});
t('measureText 宽度公式', () => {
    // 每个字符 = (5+1) 点，最后去掉一个 tracking
    eq(measureText('ABCD', 1).w, 4 * 6 - 1);
    eq(measureText('ABCD', 2).w, (4 * 6 - 1) * 2);
});
t('drawText 落点与像素', () => {
    const r = create(40, 12);
    drawText(r, 'I', 2, 1, [255, 255, 255, 255], 1);
    let painted = 0;
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i + 3] > 0) painted++;
    ok(painted > 5, '应该画出笔画，实际 ' + painted + ' 像素');
    eq(getPixel(r, 0, 0)[3], 0);
});
t('非 ASCII 字符渲染成豆腐块（不是空白）', () => {
    const r = create(20, 12);
    drawText(r, '闲', 0, 0, [255, 255, 255, 255], 1);
    let painted = 0;
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i + 3] > 0) painted++;
    ok(painted > 5, '豆腐块也要有像素，实际 ' + painted);
});

/* ---------------- 其它 ---------------- */
section('公共字节工具');
t('CRC32 标准测试向量', () => {
    eq(crc32(Buffer.from('123456789', 'latin1')), 0xCBF43926);
    eq(crc32(Buffer.from('', 'latin1')), 0);
});
t('clone 是深拷贝', () => {
    const a = create(2, 2, [1, 2, 3, 255]);
    const b = clone(a);
    setPixel(b, 0, 0, [9, 9, 9, 255]);
    deepEq(getPixel(a, 0, 0).slice(0, 3), [1, 2, 3]);
});

finish();
