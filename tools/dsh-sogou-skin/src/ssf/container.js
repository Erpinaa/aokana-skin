// @ts-check
/**
 * 搜狗 `.ssf` 容器的读写 —— **三代**全支持。
 *
 * | 代际 | 魔数 | 正文 | 现实来源 |
 * |---|---|---|---|
 * | A | `PK\x03\x04` | 标准 ZIP（条目带搜狗私有 `SD` 扩展字段） | 皮肤编辑器导出 |
 * | C | `"Skin" + u32(1)` | 明文内层文件表（无压缩、无加密） | 官方内置 `Skin.dat` |
 * | B | `"Skin" + u32(3)` | AES-256-CBC（公开密钥）+ zlib + 内层文件表 | 商店下载/分发 |
 *
 * 三代都没有签名/HMAC，因此重新打包后的产物在密码学上与原产物不可区分。
 *
 * 内层文件表（C/B 两代共用，v3 只是把它压缩+加密了一层）：
 * ```
 *   u32 totalSize        内层总长度
 *   u32 offsetTableSize  偏移表字节数（= 条目数 × 4）
 *   u32 offsets[]        每个条目相对内层起点的绝对偏移
 *   每项：u32 nameLen + UTF-16LE 文件名 + u32 contentLen + 内容
 * ```
 *
 * ⚠️ v0.1.0 的文档写了"三代全部可读写"，但代码在 `readSkin()` 里对 v1 直接抛错
 * （`暂不支持 "Skin" v1 容器`）。那是典型的"文档写了不存在的东西"（LESSONS 第 18 条），
 * v0.2.0 真正实现了它，并用自建数据做了往返测试。
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { isZip, readZip, writeZip } from './zip.js';

/** 公开的 v3 容器密钥（在 kimtoy / ssf2fcitx / ssfconv / unSSF 四个开源项目中均可见）。 */
export const V3_KEY = Buffer.from('5236461AD38503669045162879033623DDBE6F03FF04E3CAD57FFCA350E49ED9', 'hex');
export const V3_IV = Buffer.from('E07AAD35E090AA038A51FD05DF8C5D0F', 'hex');
const SKIN_MAGIC = Buffer.from('Skin', 'latin1');

/** 支持的容器代际；顺序即推荐顺序（明文 ZIP 最通用，v3 与商店一致，v1 用于官方 Skin.dat）。 */
export const CONTAINER_FORMATS = /** @type {const} */ (['zip', 'v3', 'v1']);

/**
 * @param {Uint8Array} u8
 * @returns {{generation:'zip'|'skin'|'unknown', version:number|null}}
 */
export function detectFormat(u8) {
    if (isZip(u8)) return { generation: 'zip', version: null };
    if (u8.length >= 8 && Buffer.from(u8.subarray(0, 4)).equals(SKIN_MAGIC)) {
        const version = Buffer.from(u8.subarray(4, 8)).readUInt32LE(0);
        return { generation: 'skin', version };
    }
    return { generation: 'unknown', version: null };
}

/**
 * 把代际标识转成统一的展示名。
 * @param {'zip'|'skin'|'unknown'} generation @param {number|null} version
 * @returns {string}
 */
export function formatLabel(generation, version) {
    if (generation === 'zip') return 'zip';
    if (generation === 'skin') return 'v' + version;
    return 'unknown';
}

/** @param {Uint8Array} u8 @returns {Uint8Array} */
export function decryptV3(u8) {
    if (u8.length < 9) throw new Error('v3 容器太短');
    const body = Buffer.from(u8.buffer, u8.byteOffset + 8, u8.byteLength - 8);
    if (body.length % 16 !== 0) throw new Error('v3 密文长度不是 16 的倍数（' + body.length + '），可能不是 v3 容器');
    const d = createDecipheriv('aes-256-cbc', V3_KEY, V3_IV);
    d.setAutoPadding(false);
    return Uint8Array.from(Buffer.concat([d.update(body), d.final()]));
}

/**
 * 二分求 zlib 流真实长度（尾部可能有零填充，inflateSync 会容忍多余尾字节的若干情况）。
 * @param {Buffer} z
 * @returns {number}
 */
export function findZlibEnd(z) {
    try { inflateSync(z); return z.length; } catch { /* 尾部有垃圾，需要缩短 */ }
    let lo = 1;
    let hi = z.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        let ok = false;
        try { inflateSync(z.subarray(0, mid)); ok = true; } catch { ok = false; }
        if (ok) hi = mid; else lo = mid + 1;
    }
    return lo;
}

/**
 * 解析 v3 明文层（u32 长度 + zlib 流 + 零填充）。同时给 v1 复用其内层解析。
 * @param {Uint8Array} plain
 * @returns {{entries:{name:string,data:Uint8Array}[], declaredSize:number, paddingBytes:number}}
 */
export function parseV3Plain(plain) {
    const pb = Buffer.from(plain.buffer, plain.byteOffset, plain.byteLength);
    const declaredSize = pb.readUInt32LE(0);
    const inflated = inflateSync(pb.subarray(4));
    // 明文 = u32(长度) + zlib 流 + 零填充(对齐 16 字节)。zlib 流长度用二分法确定。
    const paddingBytes = pb.length - 4 - findZlibEnd(pb.subarray(4));
    if (inflated.length !== declaredSize) {
        throw new Error('v3 内层长度不符：头部声明 ' + declaredSize + '，实际 ' + inflated.length);
    }
    return { entries: parseInnerTable(inflated), declaredSize, paddingBytes };
}

/**
 * 解析**明文内层文件表**（v1 容器正文 / v3 解压后的内容）。
 * @param {Buffer|Uint8Array} inner
 * @returns {{name:string,data:Uint8Array}[]}
 */
export function parseInnerTable(inner) {
    const b = Buffer.from(inner.buffer, inner.byteOffset, inner.byteLength);
    if (b.length < 8) throw new Error('内层文件表太短（' + b.length + ' 字节）');
    const totalSize = b.readUInt32LE(0);
    if (totalSize !== b.length) throw new Error('内层文件表长度不符：头部声明 ' + totalSize + '，实际 ' + b.length);
    const tableSize = b.readUInt32LE(4);
    if (tableSize % 4 !== 0) throw new Error('内层偏移表长度不是 4 的倍数（' + tableSize + '）');
    const count = tableSize / 4;
    if (8 + tableSize > b.length) throw new Error('内层偏移表越界（' + count + ' 项）');
    /** @type {{name:string,data:Uint8Array}[]} */
    const entries = [];
    for (let i = 0; i < count; i++) {
        const o = b.readUInt32LE(8 + i * 4);
        if (o + 8 > b.length) throw new Error('内层条目 ' + i + ' 偏移越界（' + o + '）');
        const nl = b.readUInt32LE(o);
        if (o + 4 + nl > b.length) throw new Error('内层条目 ' + i + ' 文件名越界');
        const name = b.toString('utf16le', o + 4, o + 4 + nl);
        const cl = b.readUInt32LE(o + 4 + nl);
        const start = o + 4 + nl + 4;
        if (start + cl > b.length) throw new Error('内层条目 ' + i + '（' + name + '）内容越界');
        entries.push({ name, data: Uint8Array.from(b.subarray(start, start + cl)) });
    }
    return entries;
}

/**
 * 组装 v3/v1 共用的明文内层文件表。
 * @param {{name:string,data:Uint8Array}[]} entries
 * @returns {Uint8Array}
 */
export function buildInnerTable(entries) {
    const parts = [];
    const headerSize = 8 + entries.length * 4;
    let cursor = headerSize;
    const offsets = [];
    for (const e of entries) {
        offsets.push(cursor);
        const nameBuf = Buffer.from(e.name, 'utf16le');
        const data = Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        cursor += 4 + nameBuf.length + 4 + data.length;
    }
    const head = Buffer.alloc(headerSize);
    head.writeUInt32LE(cursor, 0);
    head.writeUInt32LE(entries.length * 4, 4);
    offsets.forEach((o, i) => head.writeUInt32LE(o, 8 + i * 4));
    parts.push(head);
    for (const e of entries) {
        const nameBuf = Buffer.from(e.name, 'utf16le');
        const data = Buffer.from(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        const pre = Buffer.alloc(4);
        pre.writeUInt32LE(nameBuf.length, 0);
        const len = Buffer.alloc(4);
        len.writeUInt32LE(data.length, 0);
        parts.push(pre, nameBuf, len, data);
    }
    return Uint8Array.from(Buffer.concat(parts));
}

/** v0.1.0 的导出名保留，避免外部脚本 import 失败。 */
export const buildV3Inner = buildInnerTable;

/**
 * 加密成 v3 容器。明文 = u32(解压后长度) + zlib(内层)，再零填充到 16 字节倍数。
 * @param {Uint8Array} inner
 * @param {{padding?:number|null}} [opts] padding 为 null 表示不做零填充（仅当长度已对齐时可省）
 * @returns {Uint8Array}
 */
export function encryptV3(inner, opts = {}) {
    const compressed = deflateSync(Buffer.from(inner.buffer, inner.byteOffset, inner.byteLength), { level: 9 });
    const sizeField = Buffer.alloc(4);
    sizeField.writeUInt32LE(inner.length, 0);
    let plain = Buffer.concat([sizeField, compressed]);
    const remain = plain.length % 16;
    if (remain !== 0) {
        const padTo = opts.padding === null ? remain : (opts.padding ?? (16 - remain));
        plain = Buffer.concat([plain, Buffer.alloc(padTo)]);
    }
    if (plain.length % 16 !== 0) throw new Error('v3 明文未能对齐到 16 字节');
    const c = createCipheriv('aes-256-cbc', V3_KEY, V3_IV);
    c.setAutoPadding(false);
    const cipher = Buffer.concat([c.update(plain), c.final()]);
    return Uint8Array.from(Buffer.concat([skinHead(3), cipher]));
}

/**
 * 包成 v1 容器：`"Skin" + u32(1)` + 明文内层文件表。
 * @param {Uint8Array} inner
 * @returns {Uint8Array}
 */
export function wrapV1(inner) {
    return Uint8Array.from(Buffer.concat([skinHead(1), Buffer.from(inner.buffer, inner.byteOffset, inner.byteLength)]));
}

/** @param {number} version */
function skinHead(version) {
    const head = Buffer.alloc(8);
    SKIN_MAGIC.copy(head, 0);
    head.writeUInt32LE(version, 4);
    return head;
}

/**
 * 统一读取入口。
 * @param {Uint8Array} u8
 * @returns {{generation:'zip'|'skin'|'unknown', version:number|null, format:'zip'|'v3'|'v1',
 *   entries:{name:string,data:Uint8Array,ts?:number}[], sd:{local:Buffer|null,central:Buffer|null}|null, paddingBytes?:number}}
 */
export function readSkin(u8) {
    const fmt = detectFormat(u8);
    if (fmt.generation === 'zip') {
        const z = readZip(u8);
        return { generation: 'zip', version: null, format: 'zip', entries: z.entries, sd: { local: z.sdLocal, central: z.sdCentral } };
    }
    if (fmt.generation === 'skin') {
        if (fmt.version === 3) {
            const { entries, paddingBytes } = parseV3Plain(decryptV3(u8));
            return { generation: 'skin', version: 3, format: 'v3', entries, sd: null, paddingBytes };
        }
        if (fmt.version === 1) {
            const inner = u8.subarray(8);
            return { generation: 'skin', version: 1, format: 'v1', entries: parseInnerTable(inner), sd: null };
        }
        throw new Error('暂不支持 "Skin" v' + fmt.version + ' 容器（本插件支持明文 ZIP、v3 与 v1）');
    }
    throw new Error('无法识别的文件：既不是 ZIP（PK\\x03\\x04），也不是 "Skin" 容器（三代都不匹配）');
}

/**
 * 统一写出入口。
 * @param {{name:string,data:Uint8Array,ts?:number}[]} entries
 * @param {{format?:'zip'|'v3'|'v1', sdLocal?:Buffer|null, sdCentral?:Buffer|null, level?:number, ut?:boolean}} [opts]
 * @returns {Uint8Array}
 */
export function writeSkin(entries, opts = {}) {
    const format = opts.format ?? 'zip';
    if (format === 'v3') {
        return encryptV3(buildInnerTable(entries.map((e) => ({ name: e.name, data: e.data }))));
    }
    if (format === 'v1') {
        return wrapV1(buildInnerTable(entries.map((e) => ({ name: e.name, data: e.data }))));
    }
    if (format !== 'zip') throw new Error('未知的容器代际：' + format + '（可选 zip / v3 / v1）');
    return writeZip(entries, opts);
}
