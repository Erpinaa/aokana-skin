// @ts-check
/**
 * 皮肤工程（`skin.project.json`）的加载、schema 自校验、默认值填充与保存。
 *
 * v0.2.0 起，工程文件不再"读到什么就当什么用"：加载时会跑一遍 schema 校验，
 * 把类型错误变成明确的 `errors`（带字段路径），把未知字段/可疑值变成 `warnings`，
 * 并把旧版本（schema 1）的字段迁移到当前版本。
 *
 * 设计原则：
 *  - **不丢作者字段**：未知字段原样保留（只警告），避免保存时把用户的备注/自定义键吃掉；
 *  - **errors 不阻止读取**：校验失败也返回一个尽量可用的工程对象，让预览/装配还能跑；
 *  - 所有路径字段统一成相对工程目录、`/` 分隔。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    PROJECT_SCHEMA_VERSION, PANEL_SLOTS, BUTTON_SLOTS, DEFAULT_BUTTON_POS, DEFAULT_DISPLAY,
    DEFAULT_ICON_SIZE, DEFAULT_THEME, STATES, defaultProject,
} from '../skin/spec.js';
import { ensureDir, errorText, relativeTo, resolveFrom } from '../util/fs.js';
import { clamp, intTuple, parseHexColor, skinTime } from '../util/text.js';
import { writeFileSync } from 'node:fs';

const PANEL_BY_SLOT = new Map(PANEL_SLOTS.map((s) => [s.slot, s]));
const BUTTON_BY_SLOT = new Map(BUTTON_SLOTS.map((s) => [s.slot, s]));
const SCHEME_NAMES = ['Scheme_H1', 'Scheme_V1', 'Scheme_H2', 'Scheme_V2'];

/** 工程文件的固定文件名。 */
export const PROJECT_FILE = 'skin.project.json';

/**
 * 把用户写的一个 role 值规范化。
 * @param {any} raw
 * @param {string} slot
 * @param {string} where 字段路径，用于报错定位
 * @param {string[]} errors @param {string[]} warnings
 * @returns {object|null}
 */
function normalizeRole(raw, slot, where, errors, warnings) {
    if (raw === null || raw === undefined) return null;
    // 字符串简写： "panel_h": "assets/skin1.png"
    if (typeof raw === 'string') return { source: raw };
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(where + ' 应为对象或路径字符串（收到 ' + JSON.stringify(raw) + '）');
        return null;
    }
    /** @type {Record<string, any>} */
    const role = {};
    const known = new Set(['source', 'sources', 'sheet', 'nineSlice', 'margins', 'generate', 'size', 'hue', 'states', 'scale', 'trim']);
    for (const k of Object.keys(raw)) {
        if (!known.has(k)) warnings.push(where + ' 含未知字段 `' + k + '`（会被保留但装配器不读）');
    }
    if (raw.source !== undefined) {
        if (typeof raw.source === 'string' && raw.source.trim()) role.source = raw.source.trim();
        else errors.push(where + '.source 应为非空字符串');
    }
    if (raw.sheet !== undefined) {
        if (typeof raw.sheet === 'string' && raw.sheet.trim()) role.sheet = raw.sheet.trim();
        else errors.push(where + '.sheet 应为非空字符串');
    }
    if (raw.sources !== undefined) {
        if (raw.sources && typeof raw.sources === 'object' && !Array.isArray(raw.sources)) {
            role.sources = {};
            for (const [v, p] of Object.entries(raw.sources)) {
                if (typeof p === 'string' && p.trim()) role.sources[v] = p.trim();
                else errors.push(where + '.sources.' + v + ' 应为非空字符串');
            }
        } else errors.push(where + '.sources 应为 {变体: 路径} 对象');
    }
    if (raw.generate !== undefined) role.generate = !!raw.generate;
    if (raw.size !== undefined) {
        if (raw.size && typeof raw.size === 'object') {
            const w = Number(raw.size.width), h = Number(raw.size.height);
            if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) role.size = { width: Math.round(w), height: Math.round(h) };
            else warnings.push(where + '.size 需要 {width,height} 正数，已忽略');
        } else warnings.push(where + '.size 应为 {width,height}，已忽略');
    }
    if (raw.hue !== undefined) {
        const h = Number(raw.hue);
        if (Number.isFinite(h)) role.hue = ((h % 1) + 1) % 1;
        else warnings.push(where + '.hue 应为 0..1 的数字，已忽略');
    }
    if (raw.scale !== undefined) {
        const s = Number(raw.scale);
        if (Number.isFinite(s) && s >= 1 && s <= 8) role.scale = s;
        else errors.push(where + '.scale 应为 1..8 的数字（2 表示 2 倍素材）');
    }
    if (raw.trim !== undefined) role.trim = !!raw.trim;
    if (raw.nineSlice !== undefined) {
        const ns = normalizeNineSlice(raw.nineSlice, where + '.nineSlice', errors, warnings);
        if (ns) role.nineSlice = ns;
    }
    if (raw.margins !== undefined) {
        const mg = normalizeMargins(raw.margins, where + '.margins', errors, warnings);
        if (mg) role.margins = mg;
    }
    if (raw.states !== undefined) {
        if (raw.states && typeof raw.states === 'object' && !Array.isArray(raw.states)) {
            role.states = {};
            for (const st of ['hover', 'down']) {
                if (!raw.states[st]) continue;
                if (typeof raw.states[st] !== 'object' || Array.isArray(raw.states[st])) {
                    errors.push(where + '.states.' + st + ' 应为 {变体: 路径} 对象');
                    continue;
                }
                role.states[st] = {};
                for (const [v, p] of Object.entries(raw.states[st])) {
                    if (typeof p === 'string' && p.trim()) role.states[st][v] = p.trim();
                    else errors.push(where + '.states.' + st + '.' + v + ' 应为路径字符串');
                }
            }
        } else errors.push(where + '.states 应为 {hover:{...},down:{...}} 对象');
    }
    if (!role.source && !role.sheet && !role.sources && raw.generate === undefined) role.generate = true;
    return role;
}

/**
 * @param {any} raw @param {string} where @param {string[]} errors @param {string[]} warnings
 * @returns {{left:number,right:number,top:number,bottom:number,modeH:number,modeV:number}|null}
 */
function normalizeNineSlice(raw, where, errors, warnings) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(where + ' 应为 {left,right,top,bottom} 对象');
        return null;
    }
    const known = new Set(['left', 'right', 'top', 'bottom', 'modeH', 'modeV', 'mode', 'confidence', 'note']);
    for (const k of Object.keys(raw)) if (!known.has(k)) warnings.push(where + ' 含未知字段 `' + k + '`');
    /** @type {any} */
    const out = {};
    for (const k of ['left', 'right', 'top', 'bottom']) {
        const v = Number(raw[k] ?? 0);
        if (!Number.isFinite(v) || v < 0) { errors.push(where + '.' + k + ' 应为非负数字'); out[k] = 0; }
        else out[k] = Math.round(v);
    }
    out.modeH = raw.modeH === 1 || raw.mode === 1 ? 1 : 0;
    out.modeV = raw.modeV === 1 ? 1 : 0;
    return out;
}

/**
 * @param {any} raw @param {string} where @param {string[]} errors @param {string[]} warnings
 */
function normalizeMargins(raw, where, errors, warnings) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        errors.push(where + ' 应为 {pinyin_marge:[t,b,l,r], zhongwen_marge:[t,b,l,r]} 对象');
        return null;
    }
    for (const k of Object.keys(raw)) {
        if (k !== 'pinyin_marge' && k !== 'zhongwen_marge') warnings.push(where + ' 含未知字段 `' + k + '`');
    }
    /** @type {any} */
    const out = {};
    for (const k of ['pinyin_marge', 'zhongwen_marge']) {
        const t = intTuple(raw[k], 4);
        if (!t || t.some((v) => v < 0)) {
            errors.push(where + '.' + k + ' 应为 4 个非负整数（top,bottom,left,right）');
            out[k] = [0, 0, 0, 0];
        } else out[k] = t;
    }
    return out;
}

/**
 * 校验并规范化工程对象。
 * @param {any} raw
 * @param {{dir?:string}} [ctx]
 * @returns {{project:any, errors:string[], warnings:string[], migrated:boolean}}
 */
export function normalizeProject(raw, ctx = {}) {
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
            project: defaultProject({}),
            errors: ['skin.project.json 的顶层必须是对象（收到 ' + JSON.stringify(raw) + '）'],
            warnings, migrated: false,
        };
    }
    const base = defaultProject({});
    const project = { ...base, ...raw };
    let migrated = false;

    const schema = Number(raw.schema ?? 1);
    if (!Number.isFinite(schema) || schema < 1) {
        warnings.push('schema 字段非法（' + JSON.stringify(raw.schema) + '），按 1 处理');
    } else if (schema > PROJECT_SCHEMA_VERSION) {
        errors.push('工程 schema ' + schema + ' 比当前插件支持的 ' + PROJECT_SCHEMA_VERSION + ' 更新，请升级插件');
    } else if (schema < PROJECT_SCHEMA_VERSION) {
        // 只在返回值里标记，不打扰使用者：旧工程不需要立刻改写，插件会按新默认值补齐。
        migrated = true;
    }
    project.schema = PROJECT_SCHEMA_VERSION;

    for (const k of Object.keys(raw)) {
        if (k in base) continue;
        warnings.push('未知工程字段 `' + k + '`（会被保留，但插件不读）');
    }
    for (const [k, def] of [['name', '我的皮肤'], ['author', '匿名'], ['info', ''], ['email', '']]) {
        if (typeof project[k] !== 'string') { errors.push(k + ' 应为字符串'); project[k] = project[k] ?? def; }
    }
    for (const k of ['assetDir', 'outDir']) {
        if (typeof project[k] !== 'string' || !project[k].trim()) { errors.push(k + ' 应为非空字符串'); project[k] = base[k]; }
    }
    project.autoGenerate = project.autoGenerate !== false;
    project.useBarMask = !!project.useBarMask;

    // ---- assets.scale ----
    const assets = project.assets && typeof project.assets === 'object' ? project.assets : {};
    const scale = Number(assets.scale ?? 1);
    if (!Number.isFinite(scale) || scale < 1 || scale > 8) {
        errors.push('assets.scale 应为 1..8 的数字（2 表示素材按 2 倍设计）');
        project.assets = { scale: 1 };
    } else project.assets = { ...assets, scale };

    // ---- roles ----
    project.roles = {};
    let roles;
    if (raw.roles === undefined) {
        // 没写 roles 的工程（例如手写的最小工程）继承默认的"必需面板占位"配置，
        // 否则用户会看到一堆"缺少必需面板"的警告。
        roles = JSON.parse(JSON.stringify(base.roles));
    } else if (raw.roles && typeof raw.roles === 'object' && !Array.isArray(raw.roles)) {
        roles = raw.roles;
    } else {
        errors.push('roles 应为对象（槽位 -> 素材）');
        roles = {};
    }
    for (const [slot, value] of Object.entries(roles)) {
        const known = PANEL_BY_SLOT.has(slot) || BUTTON_BY_SLOT.has(slot);
        if (!known) { warnings.push('未知槽位 `' + slot + '`（会被保留，但装配器不认）'); project.roles[slot] = value; continue; }
        const role = normalizeRole(value, slot, 'roles.' + slot, errors, warnings);
        if (role) project.roles[slot] = role;
    }

    // ---- buttons ----
    const btns = raw.buttons && typeof raw.buttons === 'object' ? raw.buttons : {};
    const enabled = Array.isArray(btns.enabled) ? btns.enabled : base.buttons.enabled;
    project.buttons = { enabled: [], pos: {}, writeDisplay: btns.writeDisplay !== false };
    for (const s of enabled) {
        if (typeof s !== 'string') { errors.push('buttons.enabled 里含非字符串项'); continue; }
        if (!BUTTON_BY_SLOT.has(s)) { warnings.push('buttons.enabled 里的 `' + s + '` 不是已知按钮槽位，已忽略'); continue; }
        project.buttons.enabled.push(s);
    }
    const pos = btns.pos && typeof btns.pos === 'object' ? btns.pos : {};
    for (const [slot, value] of Object.entries(pos)) {
        if (!BUTTON_BY_SLOT.has(slot)) { warnings.push('buttons.pos 里的 `' + slot + '` 不是已知按钮槽位，已忽略'); continue; }
        const rawLen = Array.isArray(value) ? value.length : String(value ?? '').split(',').length;
        if (rawLen !== 2) { errors.push('buttons.pos.' + slot + ' 应为 [x,y] 两个整数'); continue; }
        const t = intTuple(value, 2);
        if (!t || t.some((v) => v < 0)) { errors.push('buttons.pos.' + slot + ' 应为 [x,y] 非负整数'); continue; }
        project.buttons.pos[slot] = t;
    }

    // ---- icon ----
    const icon = raw.icon && typeof raw.icon === 'object' ? raw.icon : {};
    const iw = Number(icon.w ?? DEFAULT_ICON_SIZE.w);
    const ih = Number(icon.h ?? DEFAULT_ICON_SIZE.h);
    if (!Number.isFinite(iw) || iw < 4 || iw > 128) errors.push('icon.w 应为 4..128 的数字');
    if (!Number.isFinite(ih) || ih < 4 || ih > 128) errors.push('icon.h 应为 4..128 的数字');
    const fmt = icon.format ?? 'png';
    if (fmt !== 'png' && fmt !== 'bmp') errors.push('icon.format 只能是 "png" 或 "bmp"（收到 ' + JSON.stringify(fmt) + '）');
    const bg = intTuple(icon.bmpBackground, 3);
    project.icon = {
        w: Number.isFinite(iw) && iw >= 4 && iw <= 128 ? Math.round(iw) : DEFAULT_ICON_SIZE.w,
        h: Number.isFinite(ih) && ih >= 4 && ih <= 128 ? Math.round(ih) : DEFAULT_ICON_SIZE.h,
        format: fmt === 'bmp' ? 'bmp' : 'png',
        bmpBackground: bg && bg.every((v) => v >= 0 && v <= 255) ? bg : [255, 255, 255],
    };

    // ---- states ----
    project.states = { ...base.states };
    if (raw.states !== undefined) {
        if (!raw.states || typeof raw.states !== 'object') errors.push('states 应为对象');
        else {
            for (const st of ['hover', 'down']) {
                if (!raw.states[st]) continue;
                const cfg = raw.states[st];
                const mode = cfg.mode ?? 'lighten';
                if (!['lighten', 'darken', 'tint', 'none'].includes(mode)) {
                    errors.push('states.' + st + '.mode 只能是 lighten/darken/tint/none');
                    continue;
                }
                project.states[st] = {
                    mode,
                    amount: Number.isFinite(Number(cfg.amount)) ? Number(cfg.amount) : (st === 'hover' ? 0.1 : 0.16),
                    ...(cfg.color ? { color: cfg.color } : {}),
                };
            }
        }
    }

    // ---- display ----
    const disp = raw.display && typeof raw.display === 'object' ? raw.display : {};
    const fontSize = Number(disp.fontSize ?? DEFAULT_DISPLAY.fontSize);
    if (!Number.isFinite(fontSize) || fontSize < 6 || fontSize > 96) errors.push('display.fontSize 应为 6..96 的数字');
    project.display = {
        fontSize: Number.isFinite(fontSize) && fontSize >= 6 && fontSize <= 96 ? Math.round(fontSize) : DEFAULT_DISPLAY.fontSize,
        fontCh: typeof disp.fontCh === 'string' && disp.fontCh ? disp.fontCh : DEFAULT_DISPLAY.fontCh,
        fontEn: typeof disp.fontEn === 'string' && disp.fontEn ? disp.fontEn : DEFAULT_DISPLAY.fontEn,
        useGdip: disp.useGdip !== false,
        aero: !!disp.aero,
        glow: !!disp.glow,
        largeFontSupport: disp.largeFontSupport !== false,
    };

    // ---- theme ----
    const theme = raw.theme && typeof raw.theme === 'object' ? raw.theme : {};
    project.theme = {};
    for (const k of ['pinyinColor', 'firstColor', 'zhongwenColor', 'compHintColor']) {
        const v = theme[k] ?? DEFAULT_THEME[k];
        if (!parseHexColor(v)) {
            errors.push('theme.' + k + ' 应为 #rrggbb 颜色（收到 ' + JSON.stringify(v) + '）');
            project.theme[k] = DEFAULT_THEME[k];
        } else project.theme[k] = v;
    }

    // ---- nineSlice ----
    project.nineSlice = {};
    if (raw.nineSlice !== undefined) {
        if (!raw.nineSlice || typeof raw.nineSlice !== 'object' || Array.isArray(raw.nineSlice)) {
            errors.push('nineSlice 应为 {槽位: {left,right,top,bottom}} 对象');
        } else {
            for (const [slot, value] of Object.entries(raw.nineSlice)) {
                if (!PANEL_BY_SLOT.has(slot)) { warnings.push('nineSlice 里的 `' + slot + '` 不是面板槽位，已忽略'); continue; }
                const ns = normalizeNineSlice(value, 'nineSlice.' + slot, errors, warnings);
                if (ns) project.nineSlice[slot] = ns;
            }
        }
    }

    // ---- anchors ----
    project.anchors = {};
    if (raw.anchors !== undefined) {
        if (!raw.anchors || typeof raw.anchors !== 'object' || Array.isArray(raw.anchors)) {
            errors.push('anchors 应为 {Scheme_xx: [x,y]} 对象');
        } else {
            for (const [sec, value] of Object.entries(raw.anchors)) {
                if (!SCHEME_NAMES.includes(sec)) { warnings.push('anchors 里的 `' + sec + '` 不是候选窗段落，已忽略'); continue; }
                const t = intTuple(value, 2);
                if (!t || t.some((v) => v < 0)) errors.push('anchors.' + sec + ' 应为 [x,y] 非负整数');
                else project.anchors[sec] = t;
            }
        }
    }

    // ---- overlays ----
    project.overlays = [];
    if (raw.overlays !== undefined) {
        if (!Array.isArray(raw.overlays)) errors.push('overlays 应为数组');
        else for (let i = 0; i < raw.overlays.length; i++) {
            const o = raw.overlays[i] || {};
            const where = 'overlays[' + i + ']';
            const section = o.section ?? 'Scheme_H1';
            if (!SCHEME_NAMES.includes(section)) { errors.push(where + '.section 非法（' + JSON.stringify(section) + '）'); continue; }
            if (typeof o.name !== 'string' || !o.name) { errors.push(where + '.name 缺失'); continue; }
            const align = Array.isArray(o.align) ? o.align.join(',') : String(o.align ?? '').trim();
            if (!/^\d+(,\d+){9}$/.test(align)) { errors.push(where + '.align 必须是 10 个非负整数（收到 ' + JSON.stringify(o.align) + '）'); continue; }
            const list = (v, k) => {
                if (v === undefined) return [];
                if (!Array.isArray(v)) { errors.push(where + '.' + k + ' 应为路径数组'); return []; }
                return v.filter((p) => typeof p === 'string' && p.trim());
            };
            const normal = list(o.normal, 'normal');
            if (!normal.length) { errors.push(where + '.normal 至少要有 1 张图'); continue; }
            project.overlays.push({
                section, name: o.name, align,
                normal, hover: list(o.hover, 'hover'), down: list(o.down, 'down'),
            });
        }
    }

    // ---- 其它标量 ----
    const hue = Number(raw.hue ?? 0.474);
    if (!Number.isFinite(hue)) errors.push('hue 应为 0..1 的数字');
    project.hue = Number.isFinite(hue) ? ((hue % 1) + 1) % 1 : 0.474;
    if (raw.skinTime !== undefined && (typeof raw.skinTime !== 'string' || !/^\d{4}\.\d{2}\.\d{2}$/.test(raw.skinTime))) {
        errors.push('skinTime 应为 "YYYY.MM.DD" 字符串（收到 ' + JSON.stringify(raw.skinTime) + '）');
    }
    if (raw.skinVersion !== undefined) {
        const v = raw.skinVersion;
        if (typeof v !== 'string' && typeof v !== 'number') errors.push('skinVersion 应为字符串或数字');
        else project.skinVersion = String(v);
    }
    for (const k of ['layered', 'overlayDisplay']) {
        if (raw[k] !== undefined && typeof raw[k] !== 'boolean') errors.push(k + ' 应为布尔值');
        else if (raw[k] !== undefined) project[k] = raw[k];
    }

    return { project, errors, warnings, migrated };
}

/**
 * 加载工程。
 * @param {string} dir 工程目录（含 skin.project.json）
 * @returns {{ok:true, dir:string, file:string, project:any, errors:string[], warnings:string[], migrated:boolean}
 *          |{ok:false, error:string}}
 */
export function loadProject(dir) {
    const root = resolveFrom(dir);
    const file = join(root, PROJECT_FILE);
    if (!existsSync(file)) return { ok: false, error: '找不到工程文件：' + file + '（先用 init 建一个新工程）' };
    let raw;
    try {
        raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
        return { ok: false, error: '工程文件不是合法 JSON：' + file + '：' + errorText(e) };
    }
    const norm = normalizeProject(raw, { dir: root });
    return { ok: true, dir: root, file, project: norm.project, errors: norm.errors, warnings: norm.warnings, migrated: norm.migrated };
}

/**
 * 保存工程（会先跑一次规范化，写回 schema 最新版）。
 * @param {string} dir
 * @param {any} project
 * @returns {{file:string, errors:string[], warnings:string[]}}
 */
export function saveProject(dir, project) {
    const root = resolveFrom(dir);
    const norm = normalizeProject(project, { dir: root });
    ensureDir(root);
    const file = join(root, PROJECT_FILE);
    writeFileSync(file, JSON.stringify(norm.project, null, 2) + '\n', 'utf8');
    return { file, errors: norm.errors, warnings: norm.warnings };
}

/**
 * 新建工程：写 skin.project.json + assets/ + preview/ 目录。
 * 不覆盖已有工程 —— 保护作者正在改的工程是硬要求。
 * @param {string} dir
 * @param {{name?:string, author?:string, info?:string, email?:string}} [meta]
 * @returns {{ok:true, dir:string, file:string, project:any} | {ok:false, error:string}}
 */
export function initProject(dir, meta = {}) {
    const root = resolveFrom(dir);
    if (existsSync(join(root, PROJECT_FILE))) {
        return { ok: false, error: '工程已存在：' + join(root, PROJECT_FILE) + '（如需重建请先手动删除该文件）' };
    }
    const project = defaultProject({
        name: meta.name || undefined,
        author: meta.author || undefined,
        info: meta.info || undefined,
        email: meta.email || undefined,
    });
    // 占位素材的"开关"就是 roles 里的 generate:true —— 真正画图发生在装配时，
    // 这样 init 是瞬时的，也不会在用户还没素材时先塞一堆 PNG 进 assets/。
    ensureDir(join(root, project.assetDir));
    ensureDir(join(root, 'preview'));
    const saved = saveProject(root, project);
    return { ok: true, dir: root, file: saved.file, project: saved.errors.length ? normalizeProject(project, { dir: root }).project : project };
}

/**
 * 工程的人类可读摘要（用于 CLI/工具输出）。
 * @param {any} project
 */
export function projectSummary(project) {
    const enabled = project.buttons?.enabled || [];
    const roles = Object.keys(project.roles || {});
    return {
        name: project.name,
        author: project.author,
        schema: project.schema,
        assetDir: project.assetDir,
        outDir: project.outDir,
        roleCount: roles.length,
        roles,
        buttons: enabled,
        icon: project.icon,
        designScale: project.assets?.scale ?? 1,
        theme: project.theme,
    };
}

/** 默认的 `skin_time`（测试可传固定日期获得确定输出）。 */
export function defaultSkinTime(now) {
    return skinTime(now);
}

const ROLE_KEYS = ['source', 'sources', 'sheet', 'nineSlice', 'margins', 'generate', 'size', 'hue', 'states', 'scale', 'trim'];

/** 把外部传入的路径（相对 cwd 或工程目录）变成相对工程目录。 */
function toProjectRelative(projectDir, p) {
    if (typeof p !== 'string' || !p.trim()) return p;
    return relativeTo(projectDir, resolveFrom(p, projectDir));
}

/**
 * 把素材分配到槽位 / 改主题 / 启停按钮 / 配置浮层，并保存工程。
 *
 * @param {string} dir 工程目录
 * @param {{
 *   assignments?: any[],
 *   enableButtons?: string[],
 *   theme?: Record<string,string>,
 *   overlays?: any[],
 *   icon?: any, display?: any, assets?: any, anchors?: any, nineSlice?: any,
 * }} args
 * @returns {{ok:boolean, dir:string, applied:string[], missingRequired:string[],
 *            errors:string[], warnings:string[], project?:any, error?:string}}
 */
export function assignProject(dir, args) {
    const loaded = loadProject(dir);
    if (!loaded.ok) return { ok: false, dir: resolveFrom(dir), applied: [], missingRequired: [], errors: [loaded.error], warnings: [], error: loaded.error };
    const root = loaded.dir;
    const project = JSON.parse(JSON.stringify(loaded.project));
    const errors = [...loaded.errors];
    const warnings = [...loaded.warnings];
    const applied = [];

    for (const raw of args.assignments || []) {
        const slot = raw && raw.slot;
        if (typeof slot !== 'string' || !slot) { errors.push('assignments 里有缺少 slot 的项，已跳过'); continue; }
        if (!PANEL_BY_SLOT.has(slot) && !BUTTON_BY_SLOT.has(slot)) {
            errors.push('未知槽位：' + slot + '（可用槽位见 skin_requirements）');
            continue;
        }
        /** @type {Record<string, any>} */
        const role = {};
        for (const k of ROLE_KEYS) if (raw[k] !== undefined) role[k] = raw[k];
        if (typeof role.source === 'string') role.source = toProjectRelative(root, role.source);
        if (typeof role.sheet === 'string') role.sheet = toProjectRelative(root, role.sheet);
        if (role.sources && typeof role.sources === 'object') {
            role.sources = Object.fromEntries(Object.entries(role.sources).map(([k, v]) => [k, toProjectRelative(root, String(v))]));
        }
        if (role.states && typeof role.states === 'object') {
            role.states = Object.fromEntries(Object.entries(role.states).map(([st, map]) => [
                st, Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, toProjectRelative(root, String(v))])),
            ]));
        }
        project.roles[slot] = role;
        applied.push(slot);
    }
    if (Array.isArray(args.enableButtons)) project.buttons.enabled = args.enableButtons;
    if (args.buttons && typeof args.buttons === 'object') {
        if (typeof args.buttons.writeDisplay === 'boolean') project.buttons.writeDisplay = args.buttons.writeDisplay;
        if (args.buttons.pos && typeof args.buttons.pos === 'object') {
            for (const [k, v] of Object.entries(args.buttons.pos)) {
                const t = intTuple(v, 2);
                if (t) project.buttons.pos[k] = t;
            }
        }
    }
    if (args.theme && typeof args.theme === 'object') project.theme = { ...project.theme, ...args.theme };
    if (args.icon && typeof args.icon === 'object') project.icon = { ...project.icon, ...args.icon };
    if (args.display && typeof args.display === 'object') project.display = { ...project.display, ...args.display };
    if (args.assets && typeof args.assets === 'object') project.assets = { ...project.assets, ...args.assets };
    if (args.anchors && typeof args.anchors === 'object') project.anchors = { ...project.anchors, ...args.anchors };
    if (args.nineSlice && typeof args.nineSlice === 'object') project.nineSlice = { ...project.nineSlice, ...args.nineSlice };
    if (Array.isArray(args.overlays)) {
        project.overlays = args.overlays.map((o) => ({
            section: o.section || 'Scheme_H1',
            name: o.name,
            align: Array.isArray(o.align) ? o.align.join(',') : String(o.align ?? '').trim(),
            normal: (o.normal || []).map((p) => toProjectRelative(root, p)),
            hover: (o.hover || []).map((p) => toProjectRelative(root, p)),
            down: (o.down || []).map((p) => toProjectRelative(root, p)),
        }));
    }
    const saved = saveProject(root, project);
    errors.push(...saved.errors);
    warnings.push(...saved.warnings);
    const required = PANEL_SLOTS.filter((s) => s.required).map((s) => s.slot);
    const missingRequired = required.filter((s) => !project.roles[s]);
    return {
        ok: errors.length === 0,
        dir: root,
        applied,
        missingRequired,
        errors,
        warnings,
        project,
        file: saved.file,
        hint: missingRequired.length
            ? '这些必需槽位还没有素材：' + missingRequired.join(', ') + '（装配时会用占位图代替）'
            : '必需素材齐了，可以 skin_assemble 了。',
    };
}

export { clamp, STATES };
