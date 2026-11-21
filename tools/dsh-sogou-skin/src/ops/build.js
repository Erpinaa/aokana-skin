// @ts-check
/**
 * 装配 / 打包 / 解析 / 解包 这几个"产物操作"的唯一实现。
 *
 * CLI 与 DSH 工具都调这一层，因此**同一个操作永远只有一份逻辑**。
 * v0.1.0 里 `assemble`/`pack`/`inspect`/`unpack` 在 tools.js 与 cli.js 各写了一遍，
 * 两边参数默认值和错误处理都不一样（CLI 的 validate 甚至比工具少查一半规则）。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readSkin, writeSkin, CONTAINER_FORMATS } from '../ssf/container.js';
import { decodeIni, encodeIni, IniDoc } from '../ssf/ini.js';
import { assembleSkin, writeSkinDir } from '../skin/assemble.js';
import { loadProject } from './project.js';
import { ensureDir, ensureParent, errorText, readBytes, relativeTo, resolveFrom } from '../util/fs.js';
import { formatBytes } from '../util/text.js';

/** 打包时的商店体积上限（搜狗皮肤站历史限制 600KB；超过只提示，不阻止）。 */
export const STORE_SIZE_LIMIT = 600 * 1024;

/** 解包目录里这些文件是辅助产物，不该被打回 .ssf。 */
const SKIN_JUNK_FILES = new Set(['skin.ini.utf8.txt', 'thumbs.db', '.ds_store']);
/** 解包目录里这些后缀的临时文件不打包。 */
const SKIN_JUNK_EXT = new Set(['.tmp', '.log', '.bak']);
/** 解包时写的"条目顺序清单"文件名（点开头，readSkinDir 会忽略它本身，只读取顺序）。 */
export const ORDER_MANIFEST = '.skin-order.json';

/**
 * 读目录，得到可打包的皮肤文件清单。支持"解包目录"与"直接导出的 build 目录"。
 *
 * 打包必须是**逐字**的：`unpack → pack` 要能还原出条目名/内容完全一致的容器（用于克隆真实皮肤），
 * 所以这里不按扩展名白名单过滤，只排除解包器自己写的辅助文件与常见垃圾文件。
 * @param {string} dir
 * @returns {{ok:true, files:{name:string,data:Uint8Array}[], warnings:string[]}|{ok:false,error:string}}
 */
export function readSkinDir(dir) {
    const root = resolveFrom(dir);
    if (!existsSync(root)) return { ok: false, error: '目录不存在：' + root };
    /** @type {{name:string,data:Uint8Array}[]} */
    const files = [];
    /** @type {string[]} */
    const warnings = [];
    const walk = (d, depth) => {
        if (depth > 4) { warnings.push('目录层级过深，已跳过：' + d); return; }
        let names;
        try { names = readdirSync(d); } catch (e) { warnings.push('无法读取目录 ' + d + '：' + errorText(e)); return; }
        for (const n of names) {
            const full = join(d, n);
            let st;
            try { st = statSync(full); } catch { continue; }
            if (st.isDirectory()) { walk(full, depth + 1); continue; }
            const lower = n.toLowerCase();
            if (SKIN_JUNK_FILES.has(lower)) continue;
            if (SKIN_JUNK_EXT.has(extname(lower))) continue;
            if (lower.startsWith('.')) continue;
            const name = basename(n);
            if (files.some((f) => f.name.toLowerCase() === lower)) {
                warnings.push('文件名重复，已跳过：' + relativeTo(root, full));
                continue;
            }
            const b = readBytes(full);
            if (!b.ok) { warnings.push(b.error); continue; }
            files.push({ name, data: b.data });
        }
    };
    walk(root, 0);
    // 解包时留下的条目顺序清单：保证 `unpack → pack` 的条目顺序与原包一致（逐字克隆的前提）。
    const manifestPath = join(root, ORDER_MANIFEST);
    if (existsSync(manifestPath)) {
        try {
            const order = JSON.parse(readFileSync(manifestPath, 'utf8'));
            if (Array.isArray(order)) {
                const rank = new Map(order.map((n, i) => [String(n).toLowerCase(), i]));
                files.sort((a, b) => (rank.get(a.name.toLowerCase()) ?? 1e9) - (rank.get(b.name.toLowerCase()) ?? 1e9));
            }
        } catch (e) {
            warnings.push('条目顺序清单损坏，按目录顺序打包：' + errorText(e));
        }
    }
    return { ok: true, files, warnings };
}

/**
 * 装配一个工程（不写盘）。
 * @param {string} dir
 * @param {{now?:Date|string}} [opts]
 * @returns {{ok:true, dir:string, files:{name:string,data:Uint8Array}[], ini:string,
 *            errors:string[], warnings:string[], notes:string[], layoutInfo:any, meta:any}
 *          |{ok:false, error:string}}
 */
export function assembleProject(dir, opts = {}) {
    const loaded = loadProject(dir);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const res = assembleSkin(loaded.project, loaded.dir, opts);
    return {
        ok: true,
        dir: loaded.dir,
        project: loaded.project,
        projectErrors: loaded.errors,
        projectWarnings: loaded.warnings,
        migrated: loaded.migrated,
        files: res.files,
        ini: res.ini,
        errors: [...loaded.errors, ...res.errors],
        warnings: [...loaded.warnings, ...res.warnings],
        notes: res.notes,
        layoutInfo: res.layoutInfo,
        meta: res.meta,
    };
}

/**
 * 装配并写盘到工程 outDir。
 * @param {string} dir
 * @param {{now?:Date|string, writeFiles?:boolean, outDir?:string}} [opts]
 */
export function assembleToDisk(dir, opts = {}) {
    const res = assembleProject(dir, opts);
    if (!res.ok) return res;
    const outDir = opts.outDir || join(res.dir, res.project.outDir || 'build');
    if (opts.writeFiles !== false) writeSkinDir(outDir, res.files);
    return { ...res, outDir: opts.writeFiles === false ? null : outDir };
}

/**
 * 把一份"皮肤文件清单"打包成 .ssf。
 * @param {{name:string,data:Uint8Array}[]} files
 * @param {{format?:'zip'|'v3'|'v1', template?:string|null, sdLocal?:Buffer|null, sdCentral?:Buffer|null}} [opts]
 * @returns {{data:Uint8Array, format:string, bytes:number, warnings:string[], entries:number}}
 */
export function buildSsf(files, opts = {}) {
    const format = opts.format ?? 'zip';
    if (!CONTAINER_FORMATS.includes(format)) throw new Error('未知的打包代际：' + format + '（可选 ' + CONTAINER_FORMATS.join(' / ') + '）');
    const warnings = [];
    let sdLocal = opts.sdLocal;
    let sdCentral = opts.sdCentral;
    if (opts.template) {
        try {
            const t = readSkin(new Uint8Array(readFileSync(opts.template)));
            if (t.sd && t.sd.local) { sdLocal = t.sd.local; sdCentral = t.sd.central ?? undefined; }
            else warnings.push('模板 ' + basename(opts.template) + ' 是 ' + t.format + ' 代际，没有 SD 字段可继承');
        } catch (e) {
            warnings.push('读取模板失败：' + errorText(e));
        }
    }
    const data = writeSkin(files.map((f) => ({ name: f.name, data: f.data })), { format, sdLocal, sdCentral, ut: true });
    return { data, format, bytes: data.length, warnings, entries: files.length };
}

/**
 * 读入一个 .ssf（任意代际）。
 * @param {string} file
 * @returns {{ok:true, file:string, generation:string, version:number|null, format:string,
 *            entries:{name:string,data:Uint8Array}[], sd:any, padBytes:number, warnings:string[]}
 *          |{ok:false, error:string}}
 */
export function readSsf(file) {
    const path = resolveFrom(file);
    const b = readBytes(path);
    if (!b.ok) return { ok: false, error: b.error };
    try {
        const skin = readSkin(b.data);
        return {
            ok: true, file: path, generation: skin.generation, version: skin.version,
            format: skin.format, entries: skin.entries, sd: skin.sd, padBytes: skin.paddingBytes ?? 0,
            warnings: [],
        };
    } catch (e) {
        return { ok: false, error: '解析失败：' + errorText(e) };
    }
}

/**
 * 解析 .ssf 的结构信息（条目 / 图片清单 / Skin.ini 文本）。
 * @param {string} file
 */
export function inspectSsf(file) {
    const skin = readSsf(file);
    if (!skin.ok) return skin;
    const iniEntry = skin.entries.find((e) => e.name.toLowerCase() === 'skin.ini');
    const doc = iniEntry ? new IniDoc(decodeIni(iniEntry.data)) : null;
    const images = skin.entries
        .filter((e) => /\.(png|bmp|jpg|jpeg|gif|webp)$/i.test(e.name))
        .map((e) => ({ name: e.name, bytes: e.data.length }));
    return {
        ok: true,
        file: skin.file,
        format: skin.format,
        generation: skin.generation,
        version: skin.version,
        entries: skin.entries.length,
        entryList: skin.entries.map((e) => ({ name: e.name, bytes: e.data.length })),
        images,
        ini: doc ? doc.toString() : null,
        doc,
        padBytes: skin.padBytes,
    };
}

/**
 * 解包 .ssf 到目录，并额外写一份 UTF-8 的 Skin.ini 便于查看。
 * @param {string} file @param {string} [outDir]
 */
export function unpackSsf(file, outDir) {
    const path = resolveFrom(file);
    const skin = readSsf(path);
    if (!skin.ok) return skin;
    const out = resolveFrom(outDir || basename(path).replace(/\.[^.]+$/, '') + '_unpacked');
    ensureDir(out);
    try {
        for (const e of skin.entries) {
            const dest = join(out, e.name);
            ensureParent(dest);
            writeFileSync(dest, Buffer.from(e.data));
        }
        const ini = skin.entries.find((e) => e.name.toLowerCase() === 'skin.ini');
        if (ini) writeFileSync(join(out, 'Skin.ini.utf8.txt'), decodeIni(ini.data), 'utf8');
        // 记录条目顺序：`unpack → pack` 是"逐字克隆"的官方路径，顺序也必须还原
        writeFileSync(join(out, ORDER_MANIFEST), JSON.stringify(skin.entries.map((e) => e.name), null, 2) + '\n', 'utf8');
    } catch (e) {
        return { ok: false, error: '解包写入失败：' + errorText(e) };
    }
    return { ok: true, outDir: out, format: skin.format, files: skin.entries.map((e) => e.name) };
}

/**
 * 打包一个工程，或打包一个"已存在的皮肤目录"（含 Skin.ini 的目录 → 逐字打包）。
 *
 * @param {string} target 工程目录 / 皮肤目录
 * @param {{format?:'zip'|'v3'|'v1', out?:string, template?:string, maxBytes?:number,
 *          set?:Record<string,string>, now?:Date|string}} [opts]
 * @returns {{ok:true, out:string, bytes:number, format:string, entries:number, warnings:string[],
 *            errors:string[], ini:string|null, sizeWarning:string|null}
 *          |{ok:false, error:string, warnings?:string[], errors?:string[]}}
 */
export function pack(target, opts = {}) {
    const dir = resolveFrom(target);
    const format = opts.format ?? 'zip';
    /** @type {string[]} */
    let warnings = [];
    /** @type {string[]} */
    let errors = [];
    /** @type {{name:string,data:Uint8Array}[]} */
    let files;
    /** @type {string} */
    let defaultName;
    let ini = null;

    const projectFile = join(dir, 'skin.project.json');
    if (existsSync(projectFile)) {
        const res = assembleProject(dir, { now: opts.now });
        if (!res.ok) return res;
        files = res.files;
        warnings = [...res.warnings];
        errors = [...res.errors];
        defaultName = (res.project.name || 'skin') + (format === 'v3' ? '.store.ssf' : '.ssf');
        ini = res.ini;
    } else if (existsSync(join(dir, 'Skin.ini'))) {
        const read = readSkinDir(dir);
        if (!read.ok) return read;
        files = read.files;
        warnings = [...read.warnings];
        defaultName = basename(dir) + '.ssf';
        const iniEntry = files.find((f) => f.name.toLowerCase() === 'skin.ini');
        ini = iniEntry ? decodeIni(iniEntry.data) : null;
    } else {
        return {
            ok: false,
            error: '目录里既没有 skin.project.json，也没有 Skin.ini：' + dir +
                '\n  · 做皮肤请先 `init` 建工程；\n  · 想逐字克隆/重打包别人的皮肤，请先用 `unpack` 解包，再把解包目录传给 pack。',
            warnings, errors,
        };
    }

    // 可选：重打包时改身份字段（克隆流程：unpack → pack --set skin_name=...）
    if (opts.set && Object.keys(opts.set).length) {
        if (!ini) return { ok: false, error: '没有 Skin.ini，无法改写身份字段', warnings, errors };
        const doc = new IniDoc(ini);
        const allowed = new Set(['skin_name', 'skin_version', 'skin_author', 'skin_email', 'skin_time', 'skin_info']);
        for (const [k, v] of Object.entries(opts.set)) {
            if (!allowed.has(k)) { warnings.push('--set 不接受字段 ' + k + '（只允许六个身份字段）'); continue; }
            doc.set('General', k, v);
        }
        ini = doc.toString();
        const data = encodeIni(ini);
        const idx = files.findIndex((f) => f.name.toLowerCase() === 'skin.ini');
        if (idx >= 0) files[idx] = { name: files[idx].name, data };
    }

    const out = resolveFrom(opts.out || join(dir, defaultName));
    let built;
    try {
        built = buildSsf(files, { format, template: opts.template ? resolveFrom(opts.template) : null });
    } catch (e) {
        return { ok: false, error: errorText(e), warnings, errors };
    }
    ensureParent(out);
    writeFileSync(out, Buffer.from(built.data));
    // 立刻回读校验（"打完必须回读"是硬规矩）
    let entries = built.entries;
    try {
        const back = readSkin(built.data);
        entries = back.entries.length;
    } catch (e) {
        return { ok: false, error: '打包回读失败（这是插件的 bug，请报告）：' + errorText(e), warnings, errors };
    }
    const limit = opts.maxBytes ?? STORE_SIZE_LIMIT;
    const sizeWarning = built.bytes > limit
        ? '产物 ' + formatBytes(built.bytes) + ' 超过商店体积上限 ' + formatBytes(limit) + '（引擎本身不阻止，但分发前建议压缩素材）'
        : null;
    if (sizeWarning) warnings.push(sizeWarning);
    return {
        ok: errors.length === 0,
        out, bytes: built.bytes, format: built.format, entries,
        warnings: [...warnings, ...built.warnings],
        errors, ini, sizeWarning,
    };
}

