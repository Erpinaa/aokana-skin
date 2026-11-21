// @ts-check
/**
 * 皮肤装配器：把「工程配置 + 用户素材」变成一套完整的皮肤文件 + Skin.ini。
 *
 * v0.2.0 的几条硬规矩（都是踩坑换来的，别改回去）：
 *
 *  1. **可选面板只在显式分配时存在。** bar_mask / 三张分体底图不是"顺手生成一下"的东西 ——
 *     多出来的 Scheme_H2/V2 段落等于给引擎换渲染路径（v0.1.0 每个工程都带，连真机皮肤都有）。
 *  2. **锚点（anchor）尊重工程里的 anchors 字段**；没写才按九宫格推导（闲云 v1 真机验证过
 *     `left/2, top/2` 这组推导值，所以保留为默认，不擅自改成"不写"）。
 *  3. **不修改传入的工程对象**（v0.1.0 会往 project.roles 里塞 generate:true，副作用会写回文件）。
 *  4. **素材路径失败 / 素材缺失要分清 error 与 warning**：作者显式指定的素材读不出来是 error；
 *     必需面板没素材、装配器用占位图兜底只是 warning。
 *  5. **2x 素材**：`assets.scale=2` 时先把底图缩到逻辑像素，工程里的九宫格/边距数字按逻辑像素写。
 */
import { isAbsolute, join } from 'node:path';
import { encodeIni, IniDoc, hexToBgr } from '../ssf/ini.js';
import { encodePng } from '../image/png.js';
import { encodeBmp24 } from '../image/bmp.js';
import {
    adjust, alphaBBox, autoSheetCells, clone, containFit, create, resize, trim,
} from '../image/raster.js';
import {
    PANEL_SLOTS, BUTTON_SLOTS, BUTTON_VARIANT_LABELS, STATES, defaultSkinIni,
} from './spec.js';
import { auditPanel, detectMargins, detectNineSlice } from './layout.js';
import { loadImage } from './probe.js';
import {
    placeholderBar, placeholderGeometry, placeholderIcon, placeholderPanelH, placeholderPanelV, placeholderStrip,
} from './placeholder.js';
import { badFragments, skinTime } from '../util/text.js';

const PANEL_BY_SLOT = new Map(PANEL_SLOTS.map((s) => [s.slot, s]));

/** @param {string} projectDir @param {string} rel */
function resolvePath(projectDir, rel) {
    return isAbsolute(rel) ? rel : join(projectDir, rel);
}

/**
 * 按三态策略派生一张图。
 * @param {import('../image/png.js').Raster} r @param {object|undefined} cfg
 */
function applyState(r, cfg) {
    if (!cfg || cfg.mode === 'none') return clone(r);
    const out = clone(r);
    if (cfg.mode === 'lighten') adjust(out, { brightness: 1 + (cfg.amount ?? 0.1), saturation: 0.95 });
    else if (cfg.mode === 'darken') adjust(out, { brightness: 1 - (cfg.amount ?? 0.16), saturation: 1.1 });
    else if (cfg.mode === 'tint' && cfg.color) {
        const c = /** @type {[number,number,number]} */ (cfg.color);
        for (let i = 0; i < out.data.length; i += 4) {
            if (out.data[i + 3] === 0) continue;
            out.data[i] = Math.round(out.data[i] * 0.4 + c[0] * 0.6);
            out.data[i + 1] = Math.round(out.data[i + 1] * 0.4 + c[1] * 0.6);
            out.data[i + 2] = Math.round(out.data[i + 2] * 0.4 + c[2] * 0.6);
        }
    }
    return out;
}

/**
 * @param {import('../image/png.js').Raster} r @param {'png'|'bmp'} format @param {object} project
 */
function encodeIcon(r, format, project) {
    if (format === 'bmp') {
        const bg = project.icon?.bmpBackground ?? [255, 255, 255];
        return { data: encodeBmp24(r, { background: bg }), ext: 'bmp' };
    }
    return { data: encodePng(r), ext: 'png' };
}

/**
 * 生成占位面板，并带上与之严格对应的九宫格 / 边距提示（避免让探测器去猜自己刚画的东西）。
 * @param {string} slot @param {object} role
 */
function makePlaceholder(slot, role) {
    // 默认色相 0.474 = 171°（青玉），与 Skin.ini 的默认主题色一致。
    const hue = role.hue ?? 0.474;
    const size = role.size || {};
    const geo = placeholderGeometry(slot, size);
    let raster;
    switch (slot) {
        case 'panel_h': raster = placeholderPanelH({ hue, ...size }); break;
        case 'panel_v': raster = placeholderPanelV({ hue, ...size }); break;
        case 'bar': raster = placeholderBar({ hue, ...size }); break;
        default: raster = placeholderStrip(size.width ?? 28, size.height ?? 27, { hue });
    }
    return { raster, nineSlice: geo.nineSlice, margins: geo.margins };
}

/**
 * 装配一套皮肤（纯内存，不写盘；写盘由 ops 层负责）。
 *
 * @param {any} project 已经过 normalizeProject 的工程对象
 * @param {string} projectDir 工程根目录（用于解析素材路径）
 * @param {{now?:Date|string}} [opts]
 * @returns {{
 *   files:{name:string,data:Uint8Array}[],
 *   ini:string,
 *   errors:string[], warnings:string[], notes:string[],
 *   layoutInfo:Record<string, any>,
 *   meta:{name:string,fileCount:number,rawBytes:number},
 * }}
 */
export function assembleSkin(project, projectDir, opts = {}) {
    /** @type {{name:string,data:Uint8Array}[]} */
    const files = [];
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const notes = [];
    /** @type {Record<string, any>} */
    const layoutInfo = {};

    /** 加入一个文件；同名重复时：内容相同则跳过，不同则报 error。 */
    const addFile = (name, data) => {
        const dup = files.find((f) => f.name === name);
        if (dup) {
            if (dup.data.length === data.length && dup.data.every((v, i) => v === data[i])) return name;
            errors.push('文件名冲突：' + name + '（两个不同来源想写同一个文件名，后一个已跳过）');
            return name;
        }
        files.push({ name, data });
        return name;
    };

    const roles = project.roles || {};
    const designScale = Math.max(1, Number(project.assets?.scale) || 1);
    const iconW = project.icon?.w ?? 20;
    const iconH = project.icon?.h ?? 20;
    const iconFormat = project.icon?.format ?? 'png';

    // ---------- 0. Skin.ini 骨架 ----------
    const theme = project.theme || {};
    const iniColors = {
        pinyin_color: '0x' + hexToBgr(theme.pinyinColor || '#000000').toString(16).padStart(6, '0'),
        zhongwen_first_color: '0x' + hexToBgr(theme.firstColor || '#000000').toString(16).padStart(6, '0'),
        zhongwen_color: '0x' + hexToBgr(theme.zhongwenColor || '#000000').toString(16).padStart(6, '0'),
        comphint_color: '0x' + hexToBgr(theme.compHintColor || '#000000').toString(16).padStart(6, '0'),
    };
    const doc = new IniDoc(defaultSkinIni({
        name: project.name,
        version: project.skinVersion || '1.0',
        author: project.author,
        info: project.info,
        email: project.email,
        time: project.skinTime || skinTime(opts.now),
        display: project.display,
        iniColors,
    }));

    // ---------- 1. 面板 ----------
    const panelFile = {};
    /** @type {import('../image/png.js').Raster|null} */
    let barRaster = null;
    for (const spec of PANEL_SLOTS) {
        const role = roles[spec.slot];
        // 可选面板：没显式分配就不存在。
        if (!role && !spec.required) continue;

        /** @type {import('../image/png.js').Raster} */
        let raster;
        let origin;
        /** @type {{raster:import('../image/png.js').Raster, nineSlice:object, margins:object|null}|null} */
        let hint = null;

        const explicitSource = role && role.source;
        if (explicitSource) {
            const abs = resolvePath(projectDir, explicitSource);
            const loaded = loadImage(abs);
            if (!loaded.ok) {
                errors.push('面板 ' + spec.slot + '（' + spec.label + '）的素材读取失败：' + loaded.error);
                if (!spec.required) {
                    warnings.push('面板 ' + spec.slot + ' 因此被跳过，相关段落不会写入 Skin.ini');
                    continue;
                }
                hint = makePlaceholder(spec.slot, role);
                raster = hint.raster;
                origin = 'placeholder';
            } else {
                raster = loaded.raster;
                origin = abs;
            }
        } else if (role && (role.sheet || role.sources)) {
            errors.push('面板 ' + spec.slot + ' 不支持 sheet/sources（面板请用 source 指定单张底图）');
            if (!spec.required) continue;
            hint = makePlaceholder(spec.slot, role);
            raster = hint.raster;
            origin = 'placeholder';
        } else {
            if (!role && project.autoGenerate === false) {
                errors.push('缺少必需面板「' + spec.label + '」（' + spec.slot + '），且工程关闭了 autoGenerate');
                continue;
            }
            hint = makePlaceholder(spec.slot, role || {});
            raster = hint.raster;
            origin = 'placeholder';
            if (!role) warnings.push('缺少必需面板「' + spec.label + '」（' + spec.slot + '），已用占位图代替');
        }

        // 2x 素材：先缩到逻辑像素，工程里的 nineSlice / margins 数字才是对的。
        const scale = Math.max(1, Number(role?.scale ?? designScale) || 1);
        if (scale > 1) {
            const w = Math.max(1, Math.round(raster.width / scale));
            const h = Math.max(1, Math.round(raster.height / scale));
            raster = resize(raster, w, h, 'bilinear');
        }
        if (role?.trim) raster = trim(raster, 8);

        // 面板一律输出 PNG（保留 alpha）
        const name = spec.defaultFile;
        addFile(name, encodePng(raster));
        panelFile[spec.slot] = name;
        if (spec.slot === 'bar') barRaster = raster;

        // ---- 反推/继承布局参数 ----
        const fromProject = role?.nineSlice || (project.nineSlice && project.nineSlice[spec.slot]) || null;
        /** @type {any} */
        const ns = fromProject
            ? { ...fromProject, note: '来自工程配置', confidence: 1 }
            : (hint?.nineSlice
                ? { ...hint.nineSlice, note: '占位图自带导引线', confidence: 1, modeH: 0, modeV: 0 }
                : { ...detectNineSlice(raster, { axis: spec.growAxis === 'v' ? 'v' : 'h' }), modeH: 0, modeV: 0 });
        const margins = role?.margins || hint?.margins || detectMargins(raster, {});

        // 九宫格体检：只有真正会用九宫格拉伸的面板才查
        const audit = spec.nineSlice === false
            ? { ok: true, issues: [], skipped: true, hDetail: 0, vDetail: 0, midW: 0, midH: 0, seam: { jumps: [], maxDelta: 0 } }
            : auditPanel(raster, ns, { growAxis: spec.growAxis || 'h' });
        for (const iss of audit.issues) {
            const msg = '[' + spec.label + '] ' + (iss.msg || iss.code || '（未提供说明）');
            if (iss.level === 'error') errors.push(msg);
            else if (iss.level === 'warn') warnings.push(msg);
            else notes.push(msg);
        }
        if (spec.nineSlice !== false && !fromProject && !hint && ns.confidence < 0.6) {
            warnings.push(spec.label + ' 的九宫格边界是猜的（' + ns.note + '），请在预览图里复核');
        }
        // 接缝的量化数据放进 report，预览/校验可以直接引用
        const seam = audit.seam || { jumps: [], maxDelta: 0 };
        if (seam.maxDelta > 20 && !seam.jumps.length) {
            notes.push('[' + spec.label + '] 可拉伸中段的最大相邻列/行色差 ' + Math.round(seam.maxDelta) + '（未超过 35 的报警线，仅记录）');
        }
        layoutInfo[spec.slot] = {
            file: name,
            origin,
            size: raster.width + 'x' + raster.height,
            designScale: scale,
            nineSlice: {
                left: Math.round(ns.left), right: Math.round(ns.right),
                top: Math.round(ns.top), bottom: Math.round(ns.bottom),
                modeH: ns.modeH ?? 0, modeV: ns.modeV ?? 0,
                confidence: ns.confidence ?? 1, note: ns.note || '',
            },
            margins,
            audit: {
                skipped: !!audit.skipped,
                hDetail: +(audit.hDetail || 0).toFixed(3),
                vDetail: +(audit.vDetail || 0).toFixed(3),
                midW: audit.midW || 0, midH: audit.midH || 0,
                degenerateSizes: audit.degenerateSizes || [],
                seamMaxDelta: Math.round(seam.maxDelta || 0),
                seamJumps: seam.jumps?.length || 0,
            },
        };
    }

    // ---------- 2. 候选窗段落 ----------
    const setLayered = (sec) => {
        if (project.layered === true) doc.set(sec, 'layered', '1');
        else if (project.layered === false) doc.set(sec, 'layered', '0');
    };
    /**
     * 写一个整窗方案的布局键。
     * @param {string} sec @param {string} pic @param {any} info @param {boolean} withAnchor
     */
    const writeScheme = (sec, pic, info, withAnchor) => {
        setLayered(sec);
        doc.set(sec, 'pic', pic);
        doc.set(sec, 'layout_horizontal', (info.nineSlice.modeH ?? 0) + ',' + info.nineSlice.left + ',' + info.nineSlice.right);
        doc.set(sec, 'layout_vertical', (info.nineSlice.modeV ?? 0) + ',' + info.nineSlice.top + ',' + info.nineSlice.bottom);
        doc.set(sec, 'pinyin_marge', info.margins.pinyin_marge.join(','));
        doc.set(sec, 'zhongwen_marge', info.margins.zhongwen_marge.join(','));
        if (withAnchor) {
            // 锚点：工程显式给了就用工程；否则沿用 v0.1.0 的推导值（left/2, top/2，闲云 v1 真机验证过）。
            const explicit = project.anchors?.[sec];
            const anchor = explicit || [Math.round(info.nineSlice.left / 2), Math.round((info.nineSlice.modeV === 1 ? 0 : info.nineSlice.top) / 2)];
            doc.set(sec, 'anchor', anchor.join(','));
        }
    };

    if (layoutInfo.panel_h) writeScheme('Scheme_H1', panelFile.panel_h, layoutInfo.panel_h, true);
    if (layoutInfo.panel_v) writeScheme('Scheme_V1', panelFile.panel_v, layoutInfo.panel_v, false);

    // 分体底图（H2/V2）—— 只有作者显式分配了才写。
    const hasH2 = !!layoutInfo.strip_h_pinyin && !!layoutInfo.strip_h_cand;
    if (layoutInfo.strip_h_pinyin && !layoutInfo.strip_h_cand) {
        warnings.push('只分配了「横排-拼音串区底图」而缺「横排-候选区底图」，Scheme_H2 已跳过');
    }
    if (layoutInfo.strip_h_cand && !layoutInfo.strip_h_pinyin) {
        warnings.push('只分配了「横排-候选区底图」而缺「横排-拼音串区底图」，Scheme_H2 已跳过');
    }
    if (hasH2) {
        setLayered('Scheme_H2');
        const a = layoutInfo.strip_h_pinyin.nineSlice;
        const b = layoutInfo.strip_h_cand.nineSlice;
        doc.set('Scheme_H2', 'pinyin_pic', panelFile.strip_h_pinyin);
        doc.set('Scheme_H2', 'pinyin_layout_horizontal', (a.modeH ?? 0) + ',' + a.left + ',' + a.right);
        doc.set('Scheme_H2', 'pinyin_layout_vertical', (a.modeV ?? 0) + ',' + a.top + ',' + a.bottom);
        doc.set('Scheme_H2', 'pinyin_marge', layoutInfo.strip_h_pinyin.margins.pinyin_marge.join(','));
        doc.set('Scheme_H2', 'zhongwen_pic', panelFile.strip_h_cand);
        doc.set('Scheme_H2', 'zhongwen_layout_horizontal', (b.modeH ?? 0) + ',' + b.left + ',' + b.right);
        doc.set('Scheme_H2', 'zhongwen_layout_vertical', (b.modeV ?? 0) + ',' + b.top + ',' + b.bottom);
        doc.set('Scheme_H2', 'zhongwen_marge', layoutInfo.strip_h_cand.margins.zhongwen_marge.join(','));
    }
    if (layoutInfo.strip_v_cand) {
        setLayered('Scheme_V2');
        const c = layoutInfo.strip_v_cand.nineSlice;
        if (layoutInfo.strip_h_pinyin) {
            const a = layoutInfo.strip_h_pinyin.nineSlice;
            doc.set('Scheme_V2', 'pinyin_pic', panelFile.strip_h_pinyin);
            doc.set('Scheme_V2', 'pinyin_layout_horizontal', (a.modeH ?? 0) + ',' + a.left + ',' + a.right);
            doc.set('Scheme_V2', 'pinyin_layout_vertical', (a.modeV ?? 0) + ',' + a.top + ',' + a.bottom);
            doc.set('Scheme_V2', 'pinyin_marge', layoutInfo.strip_h_pinyin.margins.pinyin_marge.join(','));
        }
        doc.set('Scheme_V2', 'zhongwen_pic', panelFile.strip_v_cand);
        doc.set('Scheme_V2', 'zhongwen_layout_horizontal', (c.modeH ?? 0) + ',' + c.left + ',' + c.right);
        doc.set('Scheme_V2', 'zhongwen_layout_vertical', (c.modeV ?? 0) + ',' + c.top + ',' + c.bottom);
        doc.set('Scheme_V2', 'zhongwen_marge', layoutInfo.strip_v_cand.margins.zhongwen_marge.join(','));
    }

    // ---------- 3. 状态栏 ----------
    if (panelFile.bar) doc.set('StatusBar', 'pic', panelFile.bar);
    if (layoutInfo.bar_mask) {
        doc.set('StatusBar', 'pic_mask', panelFile.bar_mask);
    } else if (project.useBarMask) {
        warnings.push('工程开了 useBarMask 但没有分配 bar_mask 素材，[StatusBar] pic_mask 未写入');
    }

    // ---------- 4. 状态栏按钮 ----------
    const enabled = (project.buttons && project.buttons.enabled) || ['cn_en'];
    const posMap = (project.buttons && project.buttons.pos) || {};
    const writeDisplay = project.buttons?.writeDisplay !== false;
    /** 已成功写出的按钮数 —— 未显式给坐标时按顺序自动排布，避免所有按钮挤在同一个点。 */
    let buttonIndex = 0;
    for (const bspec of BUTTON_SLOTS) {
        if (!enabled.includes(bspec.slot)) continue;
        const role = roles[bspec.slot] || null;
        const variants = bspec.variants;
        /** @type {Record<string, import('../image/png.js').Raster>} */
        const base = {};

        if (!role || role.generate || (!role.source && !role.sheet && !role.sources)) {
            if (!role) {
                if (project.autoGenerate === false) {
                    warnings.push('按钮「' + bspec.label + '」在启用列表里但没有素材，且工程关闭了 autoGenerate，已跳过');
                    continue;
                }
                warnings.push('按钮「' + bspec.label + '」在启用列表里但没有素材，已用占位图');
            }
            for (const v of variants) {
                base[v] = placeholderIcon(BUTTON_VARIANT_LABELS[v] || v.slice(0, 2).toUpperCase(), {
                    width: iconW, height: iconH, hue: project.hue ?? 0.474, state: 'normal',
                });
            }
        } else if (role.sheet) {
            const loaded = loadImage(resolvePath(projectDir, role.sheet));
            if (!loaded.ok) {
                errors.push('按钮 ' + bspec.slot + ' 的拼图读取失败：' + loaded.error);
                continue;
            }
            const cells = autoSheetCells(loaded.raster, { minCell: Math.max(6, Math.floor(iconW / 2)) });
            if (cells.length < variants.length) {
                warnings.push(bspec.slot + ' 自动切分只得到 ' + cells.length + ' 块，需要 ' + variants.length +
                    ' 块（' + variants.join('/') + '），多余的用占位图补齐');
            }
            variants.forEach((v, i) => {
                base[v] = cells[i] || placeholderIcon(BUTTON_VARIANT_LABELS[v] || v.slice(0, 2).toUpperCase(), { width: iconW, height: iconH });
            });
        } else if (role.sources) {
            for (const v of variants) {
                const src = role.sources[v];
                if (!src) {
                    warnings.push(bspec.slot + ' 缺少变体「' + v + '」的素材，用占位图代替');
                    base[v] = placeholderIcon(BUTTON_VARIANT_LABELS[v] || v.slice(0, 2).toUpperCase(), { width: iconW, height: iconH });
                    continue;
                }
                const loaded = loadImage(resolvePath(projectDir, src));
                if (!loaded.ok) { errors.push('按钮 ' + bspec.slot + '/' + v + ' 的素材读取失败：' + loaded.error); continue; }
                base[v] = loaded.raster;
            }
        } else if (role.source) {
            const loaded = loadImage(resolvePath(projectDir, role.source));
            if (!loaded.ok) {
                errors.push('按钮 ' + bspec.slot + ' 的素材读取失败：' + loaded.error);
                continue;
            }
            if (variants.length === 1) base[variants[0]] = loaded.raster;
            else {
                const cells = autoSheetCells(loaded.raster, { minCell: Math.max(6, Math.floor(iconW / 2)) });
                variants.forEach((v, i) => { base[v] = cells[i] || loaded.raster; });
                if (cells.length < variants.length) {
                    warnings.push(bspec.slot + ' 从单张图切出 ' + cells.length + ' 块 < 需要的 ' + variants.length + ' 块');
                }
            }
        }

        /** @type {Record<string, string[]>} */
        const stateFiles = { normal: [], hover: [], down: [] };
        let missing = false;
        for (const v of variants) {
            const src = base[v];
            if (!src) { missing = true; continue; }
            // 归一尺寸：等比缩放后居中贴到 iconW×iconH 透明画布
            const fitted = containFit(src, iconW, iconH, 'bilinear');
            for (const st of STATES) {
                // 优先用作者显式提供的该状态原图；没有才由常态推导
                const explicit = role?.states && role.states[st.key] && role.states[st.key][v];
                let baseForState = fitted;
                if (explicit) {
                    const el = loadImage(resolvePath(projectDir, explicit));
                    if (el.ok) baseForState = containFit(el.raster, iconW, iconH, 'bilinear');
                    else errors.push('按钮 ' + bspec.slot + '/' + v + ' 的' + st.label + '原图读取失败：' + el.error);
                }
                let img = (st.key === 'normal' || explicit) ? baseForState : applyState(baseForState, (project.states || {})[st.key]);
                // 三态图如果整块是透明的，补一个最低可见底板（避免"按下时按钮凭空消失"）
                const bb = alphaBBox(img, 8);
                if (!bb && st.key !== 'normal' && !explicit) {
                    img = applyState(fitted, { mode: st.key === 'hover' ? 'lighten' : 'darken', amount: 0.08 });
                }
                const enc = encodeIcon(img, iconFormat, project);
                const fname = v + st.suffix + '.' + enc.ext;
                addFile(fname, enc.data);
                stateFiles[st.key].push(fname);
            }
        }
        if (missing) warnings.push(bspec.slot + ' 有变体没有可用素材，该按钮可能显示不全');
        if (!stateFiles.normal.length) {
            warnings.push('按钮 ' + bspec.slot + ' 没有任何可用素材，已跳过');
            continue;
        }
        // 坐标：工程显式给了就用；否则按「状态栏底图宽度」自动排布（不再全部挤到 [20,1]）。
        const pos = posMap[bspec.slot] || autoButtonPos(buttonIndex, { barW: barRaster?.width ?? 122, iconW, iconH });
        buttonIndex++;
        const posError = !Array.isArray(pos) || pos.length !== 2 || pos.some((v) => !Number.isFinite(Number(v)));
        if (posError) errors.push('按钮 ' + bspec.slot + ' 的坐标非法：' + JSON.stringify(pos));
        const pos2 = posError ? [2, 2] : pos.map((v) => Math.round(Number(v)));
        if (writeDisplay) doc.set('StatusBar', bspec.slot + '_display', '1');
        doc.set('StatusBar', bspec.slot + '_pos', pos2.join(','));
        doc.set('StatusBar', bspec.slot, stateFiles.normal.join(','));
        if (stateFiles.hover.length) doc.set('StatusBar', bspec.slot + '_hover', stateFiles.hover.join(','));
        if (stateFiles.down.length) doc.set('StatusBar', bspec.slot + '_down', stateFiles.down.join(','));
    }

    // ---------- 5. 候选窗浮层（overlay）----------
    // 这些键用 10 元组 *_align 定位而不是 _pos。本插件【原样透传】作者给的数值，不做任何推导。
    const overlays = project.overlays || [];
    const overlaySections = new Set();
    /** @type {Map<string, Set<string>>} */
    const usedNames = new Map();
    for (const ov of overlays) {
        const sec = ov.section || 'Scheme_H1';
        if (!/^\d+(,\d+){9}$/.test(String(ov.align).trim())) {
            warnings.push('浮层 ' + ov.name + ' 的 align 必须是 10 个整数（收到 "' + ov.align + '"），已跳过');
            continue;
        }
        /** @param {string[]|undefined} list @param {number} suffix */
        const pick = (list, suffix) => {
            const out = [];
            for (const rel of list || []) {
                const loaded = loadImage(resolvePath(projectDir, rel));
                if (!loaded.ok) {
                    errors.push('浮层 ' + ov.name + ' 的图片读取失败：' + loaded.error);
                    continue;
                }
                // 文件名：浮层名 + 原文件名，避免与状态栏图标重名
                const base = String(rel).split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
                let nm = ov.name + '_' + base + suffix + '.png';
                const set = usedNames.get(sec) || new Set();
                usedNames.set(sec, set);
                let n = 2;
                while (set.has(nm)) nm = ov.name + '_' + base + suffix + '_' + (n++) + '.png';
                set.add(nm);
                addFile(nm, encodePng(loaded.raster));
                out.push(nm);
            }
            return out;
        };
        const stFiles = {
            normal: pick(ov.normal, 1),
            hover: pick(ov.hover, 2),
            down: pick(ov.down, 3),
        };
        if (!stFiles.normal.length) { warnings.push('浮层 ' + ov.name + ' 没有常态图，已跳过'); continue; }
        if (!stFiles.hover.length) stFiles.hover = stFiles.normal;
        if (!stFiles.down.length) stFiles.down = stFiles.normal;
        if (project.overlayDisplay) doc.set(sec, ov.name + '_display', '1');
        doc.set(sec, ov.name + '_align', String(ov.align).trim());
        doc.set(sec, ov.name, stFiles.normal.join(','));
        doc.set(sec, ov.name + '_hover', stFiles.hover.join(','));
        doc.set(sec, ov.name + '_down', stFiles.down.join(','));
        overlaySections.add(sec);
    }
    for (const sec of overlaySections) {
        const nCustom = overlays.filter((o) => (o.section || 'Scheme_H1') === sec && /^custom/.test(o.name || '')).length;
        if (nCustom) doc.set(sec, 'custom_cnt', String(nCustom));
    }

    // ---------- 6. 落盘数据 ----------
    const ini = doc.toString();
    // LESSONS 第 3 条：任何 undefined/NaN 出现在输出里都当 bug。
    const iniHits = badFragments(ini);
    if (iniHits.length) errors.push('生成的 Skin.ini 里出现坏文案 ' + iniHits.join('/') + '（这是插件的 bug，请报告）');
    addFile('Skin.ini', encodeIni(ini, { crlf: true }));
    const rawBytes = files.reduce((a, f) => a + f.data.length, 0);
    return { files, ini, errors, warnings, notes, layoutInfo, meta: { name: project.name, fileCount: files.length, rawBytes } };
}

/**
 * 未显式给坐标时的自动排布：沿状态栏底图宽度从左往右排，排不下就换行。
 * @param {number} index @param {{barW:number, iconW:number, iconH:number}} dim
 * @returns {[number, number]}
 */
function autoButtonPos(index, dim) {
    const stepX = dim.iconW + 3;
    const perRow = Math.max(1, Math.floor((dim.barW - 2) / stepX));
    const col = index % perRow;
    const row = Math.floor(index / perRow);
    return [2 + col * stepX, 2 + row * (dim.iconH + 2)];
}

/**
 * 把装配结果写成一个皮肤目录（供 CLI/工具落盘）。
 * @param {string} outDir
 * @param {{name:string,data:Uint8Array}[]} files
 */
export function writeSkinDir(outDir, files) {
    return writeFilesCompat(outDir, files);
}

// 延迟 import，避免与 ops 层形成环。
import { writeFiles } from '../util/fs.js';
/** @param {string} outDir @param {{name:string,data:Uint8Array}[]} files */
function writeFilesCompat(outDir, files) {
    return writeFiles(outDir, files);
}

