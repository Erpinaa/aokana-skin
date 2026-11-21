// @ts-check
/**
 * 皮肤校验器 —— **全项目唯一的校验实现**（CLI `validate` 与工具 `skin_validate` 都调它）。
 *
 * 输出分三级，这是 v0.2.0 最重要的变化：
 *
 *  | 级别 | 含义 | 会不会影响退出码 |
 *  |---|---|---|
 *  | `errors` | 真错误：结构缺失、引用悬空、九宫格退化、素材读不出来 | 会（有 error 即失败） |
 *  | `warnings` | 很可能是问题：可拉伸中段有花纹、图标尺寸不一致、体积超限 | 不影响 |
 *  | `notes` | 启发式提示：已知反例存在，**不要仅凭它改图** | 不影响 |
 *
 * 这条分级是 LESSONS 第 4/17 条的直接落地：一条会在正常皮肤上报错的规则比没有规则更糟。
 * 所以凡是"可能只是作者刻意设计"的检查，一律进 `notes`，并在文案里写清已知反例。
 *
 * 支持三种输入：
 *  - 皮肤工程目录（含 skin.project.json）→ 先装配再校验
 *  - 已解包的皮肤目录（含 Skin.ini）→ 直接按文件校验
 *  - .ssf 文件 → 读容器（三代）后校验
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSkin } from '../ssf/container.js';
import { decodeIni, IniDoc, parseIniNumber } from '../ssf/ini.js';
import { decodePng, isPng } from '../image/png.js';
import { decodeBmp, isBmp } from '../image/bmp.js';
import { BUTTON_SLOTS, isKnownKey, knownSections } from '../skin/spec.js';
import { auditPanel, checkCandidateBackdrop, parseLayout } from '../skin/layout.js';
import { assembleProject, readSkinDir, STORE_SIZE_LIMIT } from './build.js';
import { loadProject } from './project.js';
import { badFragments, formatBytes, oneLine } from '../util/text.js';
import { resolveFrom } from '../util/fs.js';

const BUTTON_NAMES = new Set(BUTTON_SLOTS.map((b) => b.slot));
const IMAGE_EXT_RE = /\.(png|bmp|jpg|jpeg|gif|webp)$/i;
const HEX_RE = /^0x[0-9a-f]{1,6}$/i;

/**
 * 解码一个条目（PNG/BMP），失败返回 null。
 * @param {{name:string,data:Uint8Array}|undefined} entry
 */
function decodeEntry(entry) {
    if (!entry) return null;
    try {
        if (isPng(entry.data)) return decodePng(entry.data);
        if (isBmp(entry.data)) return decodeBmp(entry.data);
    } catch { /* 坏图由调用方报 */ }
    return null;
}

/**
 * 校验一组皮肤文件。
 * @param {{
 *   files:{name:string,data:Uint8Array}[],
 *   kind:'project'|'ssf'|'skindir',
 *   target:string,
 *   project?:any,
 *   errors?:string[], warnings?:string[], notes?:string[],
 *   iniText?:string|null,
 *   packedBytes?:number,
 * }} input
 */
export function validateSkin(input) {
    const errors = [...(input.errors || [])];
    const warnings = [...(input.warnings || [])];
    const notes = [...(input.notes || [])];
    const files = input.files;
    /** @type {Record<string, any>} */
    const measure = { kind: input.kind, fileCount: files.length, panels: {} };

    const names = new Set(files.map((f) => f.name));
    const namesLower = new Map(files.map((f) => [f.name.toLowerCase(), f.name]));
    const exists = (n) => names.has(n) || namesLower.has(String(n).toLowerCase());

    // ---------- 1. Skin.ini 存在且可解析 ----------
    const iniEntry = files.find((f) => f.name.toLowerCase() === 'skin.ini');
    if (!iniEntry) {
        errors.push('缺少 Skin.ini —— 没有它就不是一套皮肤');
        return finish();
    }
    let doc;
    try {
        doc = new IniDoc(decodeIni(iniEntry.data));
    } catch (e) {
        errors.push('Skin.ini 解码失败：' + String(e));
        return finish();
    }
    measure.iniBytes = iniEntry.data.length;
    const sections = doc.sections();
    measure.sections = sections;

    // ---------- 2. 必需段落 ----------
    for (const sec of ['General', 'Display', 'Scheme_H1', 'Scheme_V1', 'StatusBar']) {
        if (!doc.hasSection(sec)) errors.push('缺少 [ ' + sec + ' ] 段落（引擎有回退但皮肤行为不可预期）');
    }
    const version = doc.get('General', 'skin_version');
    measure.skinVersion = version;
    if (!doc.get('General', 'skin_name')) warnings.push('[General] skin_name 为空');
    const fontSize = parseIniNumber(doc.get('Display', 'font_size'));
    measure.fontSize = fontSize ?? 16;

    // ---------- 3. 段落/键名 vs 官方词表 ----------
    const known = new Set(knownSections());
    const unknownSections = sections.filter((s) => !known.has(s));
    if (unknownSections.length) warnings.push('段落名不在官方词表内（可能是拼写错误）：' + unknownSections.join(', '));
    const unknownKeys = [];
    for (const sec of sections) {
        if (!known.has(sec)) continue;
        for (const k of Object.keys(doc.section(sec))) {
            if (!isKnownKey(sec, k)) unknownKeys.push('[' + sec + '] ' + k);
        }
    }
    if (unknownKeys.length) {
        warnings.push('键名不在官方词表内（引擎可能忽略它们）：' + unknownKeys.slice(0, 12).join(', ') +
            (unknownKeys.length > 12 ? ' 等 ' + unknownKeys.length + ' 个' : ''));
    }
    measure.unknownKeys = unknownKeys.length;

    // ---------- 4. 格式检查：layout / marge / 颜色 / pos / align ----------
    /** @param {string} sec @param {string} key @param {number} n */
    const requireTuple = (sec, key, n) => {
        const v = doc.get(sec, key);
        if (v === undefined) return;
        const list = v.split(',').map((x) => x.trim());
        if (list.length !== n || list.some((x) => x === '' || !/^-?\d+$/.test(x))) {
            errors.push('[' + sec + '] ' + key + ' 应为 ' + n + ' 个整数（收到 "' + v + '"）');
        }
    };
    for (const sec of ['Scheme_H1', 'Scheme_V1', 'Scheme_H2', 'Scheme_V2']) {
        if (!doc.hasSection(sec)) continue;
        requireTuple(sec, 'layout_horizontal', 3);
        requireTuple(sec, 'layout_vertical', 3);
        requireTuple(sec, 'pinyin_marge', 4);
        requireTuple(sec, 'zhongwen_marge', 4);
        requireTuple(sec, 'pinyin_layout_horizontal', 3);
        requireTuple(sec, 'pinyin_layout_vertical', 3);
        requireTuple(sec, 'zhongwen_layout_horizontal', 3);
        requireTuple(sec, 'zhongwen_layout_vertical', 3);
        // separator = 颜色,左,右（不是三个整数！真实皮肤里第一个是 0xBBGGRR）
        const sep = doc.get(sec, 'separator');
        if (sep !== undefined && !/^(0x[0-9a-f]{1,6}|\d+),-?\d+,-?\d+$/i.test(sep.trim())) {
            errors.push('[' + sec + '] separator 应为 颜色,左,右（收到 "' + sep + '"）');
        }
        const anchor = doc.get(sec, 'anchor');
        if (anchor !== undefined && !/^-?\d+,-?\d+$/.test(anchor.trim())) {
            errors.push('[' + sec + '] anchor 应为 x,y 两个整数（收到 "' + anchor + '"）');
        }
    }
    if (doc.hasSection('StatusBar')) {
        for (const b of BUTTON_NAMES) {
            requireTuple('StatusBar', b + '_pos', 2);
        }
    }
    for (const sec of sections) {
        for (const [k, v] of Object.entries(doc.section(sec))) {
            if (!/_color$/.test(k) && k !== 'separator') continue;
            if (k === 'separator') continue;
            const t = String(v).trim();
            if (HEX_RE.test(t)) continue;
            if (/^\d+$/.test(t)) continue;
            errors.push('[' + sec + '] ' + k + ' 颜色格式非法（收到 "' + v + '"，应为 0xBBGGRR 或十进制）');
        }
    }

    // ---------- 5. 图片引用必须存在 ----------
    /** 收集所有"像文件引用"的键值 */
    const refs = [];
    for (const sec of sections) {
        for (const [k, v] of Object.entries(doc.section(sec))) {
            if (k === 'skin_name' || k === 'skin_version' || k === 'skin_author' || k === 'skin_email' || k === 'skin_info') continue;
            if (!/\.(png|bmp|jpg|jpeg|gif|webp)(,|$)/i.test(String(v).trim())) continue;
            for (const token of String(v).split(',')) {
                const name = token.trim();
                if (name) refs.push({ sec, key: k, name });
            }
        }
    }
    for (const ref of refs) {
        if (!exists(ref.name)) errors.push('[' + ref.sec + '] ' + ref.key + ' 引用了不存在的文件：' + ref.name);
    }
    measure.refs = refs.length;
    // 反过来：包里有图但完全没人引用（只是提示，可能是预览图/缩略图）
    const referenced = new Set(refs.map((r) => r.name.toLowerCase()));
    const unused = files
        .filter((f) => IMAGE_EXT_RE.test(f.name) && !referenced.has(f.name.toLowerCase()))
        .map((f) => f.name);
    if (unused.length) {
        notes.push('有 ' + unused.length + ' 张图没有被 Skin.ini 引用（' + unused.slice(0, 5).join(', ') +
            (unused.length > 5 ? ' 等' : '') + '）。预览图/缩略图属于正常情况，其余可能是多余文件');
    }

    // ---------- 6. 九宫格体检（H1/V1 整窗；H2/V2 分体底图）----------
    const rasters = new Map();
    for (const f of files) {
        const r = decodeEntry(f);
        if (r) rasters.set(f.name.toLowerCase(), r);
    }
    /**
     * 检查一张"窗底图"：退化 + 可拉伸中段 + 两排文字/候选条背景。
     * @param {string} label @param {string} scheme @param {string} picKey
     * @param {string} hKey @param {string} vKey @param {string} margeKey
     * @param {'h'|'v'} growAxis @param {boolean} withText @param {{busyChecks?:boolean,edgeChecks?:boolean}} [auditOpts]
     */
    const checkPanel = (label, scheme, picKey, hKey, vKey, margeKey, growAxis, withText, auditOpts = {}) => {
        const picName = doc.get(scheme, picKey);
        if (!picName) return null;
        const raster = rasters.get(picName.toLowerCase());
        if (!raster) { errors.push('[' + scheme + '] ' + picKey + ' 的底图无法解码：' + picName); return null; }
        const lh = parseLayout(doc.get(scheme, hKey));
        const lv = parseLayout(doc.get(scheme, vKey));
        const ns = { left: lh.a, right: lh.b, top: lv.a, bottom: lv.b, modeH: lh.mode, modeV: lv.mode };
        const audit = auditPanel(raster, ns, { growAxis, ...auditOpts });
        for (const iss of audit.issues) {
            const msg = '[' + scheme + '] ' + iss.msg;
            if (iss.level === 'error') errors.push(msg);
            else if (iss.level === 'warn') warnings.push(msg);
            else notes.push(msg);
        }
        const marge = (doc.get(scheme, margeKey) || '0,0,0,0').split(',').map(Number);
        const fs = fontSize ?? 16;
        const row1Y = marge[0] || 0;
        const row2Y = row1Y + Math.round(fs) + (withText ? (Number((doc.get(scheme, 'zhongwen_marge') || '0,0,0,0').split(',')[0]) || 0) : 0);
        let backdrop = { coverage: 1, level: null, msg: '' };
        if (withText) {
            backdrop = checkCandidateBackdrop(raster, {
                row2Y, fontSize: fs, left: marge[2] || 0, right: marge[3] || 0, bottomFixed: lv.b,
            });
            if (backdrop.level) notes.push('[' + scheme + '] ' + backdrop.msg);
        }
        const panel = {
            pic: picName, size: raster.width + 'x' + raster.height,
            L: ns.left, R: ns.right, T: ns.top, B: ns.bottom,
            modeH: lh.mode, modeV: lv.mode,
            row1Y, row2Y,
            midW: audit.midW, midH: audit.midH,
            hDetail: +((audit.hDetail || 0) * 100).toFixed(1),
            vDetail: +((audit.vDetail || 0) * 100).toFixed(1),
            seamMaxDelta: Math.round(audit.seam?.maxDelta || 0),
            seamJumps: audit.seam?.jumps?.length || 0,
            degenerateSizes: audit.degenerateSizes,
            backdropCoverage: +backdrop.coverage.toFixed(3),
        };
        measure.panels[label] = panel;
        return panel;
    };
    // 整窗方案：pic + layout_horizontal/vertical + 两排文字
    if (doc.hasSection('Scheme_H1')) checkPanel('Scheme_H1', 'Scheme_H1', 'pic', 'layout_horizontal', 'layout_vertical', 'pinyin_marge', 'h', true);
    if (doc.hasSection('Scheme_V1')) checkPanel('Scheme_V1', 'Scheme_V1', 'pic', 'layout_horizontal', 'layout_vertical', 'pinyin_marge', 'v', true);
    // 分体方案：拼音区与候选区各自一张图、各自一套 layout；不做"候选条背景"检查（各管各的）
    const checkSplit = (scheme, growAxis) => {
        if (!doc.hasSection(scheme)) return;
        if (!doc.get(scheme, 'pinyin_pic') && !doc.get(scheme, 'zhongwen_pic')) {
            errors.push('[' + scheme + '] 既没有 pinyin_pic 也没有 zhongwen_pic（分体方案至少要一张底图）');
            return;
        }
        if (doc.get(scheme, 'pinyin_pic')) {
            checkPanel(scheme + '.pinyin', scheme, 'pinyin_pic', 'pinyin_layout_horizontal', 'pinyin_layout_vertical', 'pinyin_marge', growAxis, false, { busyChecks: false, edgeChecks: false });
        }
        if (doc.get(scheme, 'zhongwen_pic')) {
            checkPanel(scheme + '.zhongwen', scheme, 'zhongwen_pic', 'zhongwen_layout_horizontal', 'zhongwen_layout_vertical', 'zhongwen_marge', growAxis, false, { busyChecks: false, edgeChecks: false });
        }
    };
    checkSplit('Scheme_H2', 'h');
    checkSplit('Scheme_V2', 'v');
    // 整窗方案缺 pic 才是真错误（H2/V2 用 *_pic，不该套这条）
    for (const sec of ['Scheme_H1', 'Scheme_V1']) {
        if (doc.hasSection(sec) && !doc.get(sec, 'pic')) errors.push('[' + sec + '] 缺少 pic（底图）');
    }

    // ---------- 7. 状态栏按钮 ----------
    if (doc.hasSection('StatusBar')) {
        const barName = doc.get('StatusBar', 'pic');
        if (!barName) errors.push('[StatusBar] 缺少 pic（状态栏底图）');
        else if (!exists(barName)) errors.push('[StatusBar] pic 引用的文件不存在：' + barName);
        const present = BUTTON_SLOTS.filter((b) => doc.get('StatusBar', b.slot));
        measure.buttons = present.map((b) => b.slot);
        // 状态栏按钮显示开关：真机回归证明，缺 `<按钮>_display=1` 时部分搜狗版本按钮整体不显示。
        // 生成器现在默认写；这里对"手写/外部皮肤"做提示（不判失败：存在没写却能显示的版本）。
        const missingDisplay = present.filter((b) => !doc.get('StatusBar', b.slot + '_display')).map((b) => b.slot);
        if (missingDisplay.length) {
            const msg = '有 ' + missingDisplay.length + ' 个状态栏按钮没有写 `<按钮>_display=1`（' +
                missingDisplay.slice(0, 6).join(', ') + (missingDisplay.length > 6 ? ' 等' : '') +
                '）。**真机验证**：缺少这个键时部分搜狗版本上状态栏按钮会整体不显示；' +
                '如果目标版本实测正常可以忽略（已知反例：雷电将军原版样本同样没有这个键）。';
            if (input.kind === 'project') warnings.push(msg);
            else notes.push(msg);
        }
        const iconSizes = new Set();
        const posList = [];
        for (const b of present) {
            const v = String(doc.get('StatusBar', b.slot) || '');
            const first = v.split(',')[0].trim();
            const icon = first ? rasters.get(first.toLowerCase()) : null;
            if (!icon) { errors.push('[StatusBar] 按钮 ' + b.slot + ' 的图片无法解码：' + first); continue; }
            iconSizes.add(icon.width + 'x' + icon.height);
            const pos = (doc.get('StatusBar', b.slot + '_pos') || '').split(',').map(Number);
            if (pos.length === 2 && pos.every(Number.isFinite)) posList.push({ slot: b.slot, x: pos[0], y: pos[1], w: icon.width, h: icon.height });
        }
        if (iconSizes.size > 1) {
            const sizes = [...iconSizes];
            const dims = sizes.map((s) => s.split('x').map(Number));
            const ratio = Math.max(...dims.map((d) => Math.max(d[0], d[1]))) / Math.min(...dims.map((d) => Math.min(d[0], d[1])));
            if (ratio > 1.5) warnings.push('状态栏图标尺寸差异较大：' + sizes.join(' / ') + '（引擎能显示，但观感不统一）');
        }
        // 按钮重叠：真实皮肤里也存在（可能是互斥状态按钮），因此只做 note
        let overlap = 0;
        for (let i = 0; i < posList.length; i++) {
            for (let j = i + 1; j < posList.length; j++) {
                const a = posList[i], b = posList[j];
                const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
                const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
                if (ix > a.w * 0.5 && iy > a.h * 0.5) overlap++;
            }
        }
        if (overlap > 0) {
            notes.push('状态栏有 ' + overlap + ' 对按钮坐标重叠 50% 以上。**已知反例**：真实皮肤里也存在' +
                '（多状态按钮可能互斥显示），因此只作提示；请结合真机截图确认');
        }
        measure.statusButtons = present.length;
    }

    // ---------- 8. 体积 ----------
    const rawBytes = files.reduce((a, f) => a + f.data.length, 0);
    measure.rawBytes = rawBytes;
    measure.rawText = formatBytes(rawBytes);
    const packedBytes = input.packedBytes ?? null;
    if (packedBytes !== null) {
        measure.packedBytes = packedBytes;
        measure.packedText = formatBytes(packedBytes);
        if (packedBytes > STORE_SIZE_LIMIT) {
            warnings.push('皮肤包 ' + formatBytes(packedBytes) + ' 超过商店体积上限 ' + formatBytes(STORE_SIZE_LIMIT) + '（引擎不阻止，但分发前建议压缩素材）');
        }
    } else if (rawBytes > STORE_SIZE_LIMIT) {
        warnings.push('未压缩总体积 ' + formatBytes(rawBytes) + '，超过商店 600KB 上限（打包后会压缩，但仍建议留意）');
    }

    // ---------- 9. 不许出现 undefined/NaN 类坏文案（插件自身的 bug 探测器）----------
    for (const msg of [...errors, ...warnings, ...notes]) {
        const hits = badFragments(msg);
        if (hits.length) {
            errors.push('内部错误：校验文案里出现 ' + hits.join('/') + '（这是插件的 bug，请报告）：' + oneLine(msg, 120));
            break;
        }
    }

    return finish();

    /** 汇总结果。 */
    function finish() {
        const ok = errors.length === 0;
        const summary = ok
            ? '校验通过（' + files.length + ' 个文件' + (warnings.length ? '，' + warnings.length + ' 条提示' : '') +
              (notes.length ? '，' + notes.length + ' 条建议' : '') + '）'
            : errors.length + ' 个错误' + (warnings.length ? ' / ' + warnings.length + ' 条提示' : '');
        return {
            ok,
            target: input.target,
            kind: input.kind,
            fileCount: input.files.length,
            rawBytes,
            errors, warnings, notes,
            measure,
            summary,
        };
    }
}

/**
 * 校验任意目标：工程目录 / 已解包皮肤目录 / .ssf 文件。
 * @param {string} target
 * @param {{now?:Date|string}} [opts]
 */
export function validateTarget(target, opts = {}) {
    const path = resolveFrom(target);
    if (!existsSync(path)) return { ok: false, target: path, kind: 'missing', error: '路径不存在：' + path, errors: ['路径不存在：' + path], warnings: [], notes: [] };

    // .ssf 文件
    if (!path.endsWith('/') && !isDirectory(path)) {
        let skin;
        try {
            skin = readSkin(new Uint8Array(readFileSync(path)));
        } catch (e) {
            return { ok: false, target: path, kind: 'ssf', error: '不是合法皮肤包：' + String(e && e.message ? e.message : e), errors: ['不是合法皮肤包：' + String(e)], warnings: [], notes: [] };
        }
        return validateSkin({
            files: skin.entries.map((e) => ({ name: e.name, data: e.data })),
            kind: 'ssf', target: path, packedBytes: readFileSync(path).length,
            errors: [], warnings: [], notes: [],
        });
    }

    // 皮肤工程目录
    if (existsSync(join(path, 'skin.project.json'))) {
        const res = assembleProject(path, opts);
        if (!res.ok) return { ok: false, target: path, kind: 'project', errors: [res.error], warnings: [], notes: [] };
        return validateSkin({
            files: res.files, kind: 'project', target: path, project: res.project,
            errors: [], warnings: [], notes: [],
            iniText: res.ini,
        });
    }

    // 已解包皮肤目录
    if (existsSync(join(path, 'Skin.ini')) || existsSync(join(path, 'skin.ini'))) {
        const read = readSkinDir(path);
        if (!read.ok) return { ok: false, target: path, kind: 'skindir', errors: [read.error], warnings: [], notes: [] };
        return validateSkin({
            files: read.files, kind: 'skindir', target: path,
            errors: [], warnings: read.warnings, notes: [],
        });
    }

    const loaded = loadProject(path);
    return {
        ok: false, target: path, kind: 'unknown',
        errors: [loaded.ok ? '目录里没有 skin.project.json，也没有 Skin.ini' : loaded.error],
        warnings: [], notes: [],
    };
}

/** @param {string} p */
function isDirectory(p) {
    try { return statSync(p).isDirectory(); } catch { return false; }
}
