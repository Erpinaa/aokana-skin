// @ts-check
/**
 * 解析/格式化小工具：数字列表、颜色、尺寸、文本。
 *
 * 这三类转换在装配、校验、渲染、修复里都要用，集中在这里避免各处写法漂移
 * （历史上 layout 的三元组与 marge 的四元组就因为两处手写解析而语义混淆过）。
 */

/**
 * 把 "1, 2 ,3" 解析成数字数组；容忍 undefined/null/空串。
 * @param {string|number[]|undefined|null} value
 * @returns {number[]}
 */
export function numberList(value) {
    if (Array.isArray(value)) return value.map((v) => Number(v));
    if (value === undefined || value === null || value === '') return [];
    return String(value).split(',').map((x) => Number(x.trim()));
}

/**
 * 解析定长整数元组（不足补 0，多余截断）。非数字返回 null。
 * @param {string|number[]|undefined|null} value
 * @param {number} n
 * @returns {number[]|null}
 */
export function intTuple(value, n) {
    const list = numberList(value);
    if (!list.length) return null;
    for (const v of list) if (!Number.isFinite(v)) return null;
    const out = list.slice(0, n).map((v) => Math.round(v));
    while (out.length < n) out.push(0);
    return out;
}

/**
 * 解析 `#rrggbb` / `rrggbb` 颜色。
 * @param {string|undefined|null} value
 * @returns {[number,number,number]|null}
 */
export function parseHexColor(value) {
    if (!value) return null;
    const h = String(value).trim().replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** @param {number} n @param {number} lo @param {number} hi */
export function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

/**
 * 人类可读体积。
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '?';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/**
 * 把多行文本压成一行（用于日志/表格）。
 * @param {string} s @param {number} [max]
 */
export function oneLine(s, max = 120) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/**
 * 生成一段可复现的 `skin_time`（YYYY.MM.DD）。测试里传入固定日期即可得到确定输出。
 * @param {Date|string|undefined} [now]
 * @returns {string}
 */
export function skinTime(now) {
    const d = now instanceof Date ? now : (typeof now === 'string' ? new Date(now) : new Date());
    const t = Number.isNaN(d.getTime()) ? new Date() : d;
    const p = (n) => String(n).padStart(2, '0');
    return t.getFullYear() + '.' + p(t.getMonth() + 1) + '.' + p(t.getDate());
}

/**
 * 判断字符串里是否含有 `undefined` / `NaN` 这类"坏文案"。
 * LESSONS 第 3 条：一行读不出内容的警告会掩盖真正的警告，因此把它做成可自动检查的谓词。
 * @param {string} s
 * @returns {string[]} 命中的坏片段
 */
export function badFragments(s) {
    const hits = [];
    for (const frag of ['undefined', 'NaN', '[object Object]']) {
        if (String(s).includes(frag)) hits.push(frag);
    }
    return hits;
}
