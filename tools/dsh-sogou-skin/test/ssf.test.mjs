// @ts-check
/**
 * 容器层测试：ZIP 结构不变量、三代容器（zip / v3 / v1）往返、Skin.ini 编解码。
 *
 * 全部自建数据；真实样本（本机 Skin.dat / 商店 .ssf）的读取在 docs/VERIFY.md 里单独记录，
 * 因为仓库里不允许放版权素材，测试环境也不能假设存在。
 */
import { readSkin, writeSkin, detectFormat, formatLabel, decryptV3, encryptV3,
    parseV3Plain, parseInnerTable, buildInnerTable, wrapV1, findZlibEnd, V3_KEY, V3_IV } from '../src/ssf/container.js';
import { readZip, writeZip, crc32, isZip, SD_ID, SD_LOCAL_BODY, SD_CENTRAL_BODY } from '../src/ssf/zip.js';
import { decodeIni, encodeIni, IniDoc, bgrToRgb, rgbToBgr, hexToBgr, bgrToHex, parseIniNumber } from '../src/ssf/ini.js';
import { encodePng } from '../src/image/png.js';
import { create } from '../src/image/raster.js';
import { t, section, finish, eq, ok, deepEq, assert } from './_harness.mjs';

/** 造一组自建条目（含一张真 PNG 与一份真 Skin.ini）。 */
function makeEntries() {
    const png = encodePng(create(4, 3, [10, 20, 30, 255]));
    const ini = encodeIni('[General]\r\nskin_name=自建测试\r\n\r\n[Display]\r\nfont_size=16\r\n');
    return [
        { name: 'skin1.png', data: png },
        { name: 'Skin.ini', data: ini },
        { name: 'note.txt', data: new TextEncoder().encode('hello 你好') },
    ];
}

/* ---------------- ZIP ---------------- */
section('ZIP 代际（明文，带搜狗私有 SD 字段）');
const entries = makeEntries();
t('手工写出的 ZIP 可被自己的读取器逐字节还原', () => {
    const z = writeZip(entries);
    ok(isZip(z), '缺少 PK\\x03\\x04 签名');
    const back = readZip(z);
    eq(back.entries.length, entries.length);
    for (let i = 0; i < entries.length; i++) {
        eq(back.entries[i].name, entries[i].name);
        deepEq(Array.from(back.entries[i].data), Array.from(entries[i].data));
    }
});
t('默认带 SD 私有字段（本地 104 字节 / 中央 4 字节）', () => {
    const back = readZip(writeZip(entries));
    eq(back.sdLocal.length, 104);
    eq(back.sdCentral.length, 4);
    deepEq(Array.from(back.sdLocal.subarray(0, 4)), Array.from(SD_LOCAL_BODY.subarray(0, 4)));
    deepEq(Array.from(back.sdCentral), Array.from(SD_CENTRAL_BODY));
    eq(SD_ID.toString('latin1'), 'SD');
});
t('SD 字段可以关闭（社区工具产出的皮肤就不带它）', () => {
    const z = writeZip(entries, { sdLocal: null, sdCentral: null });
    const back = readZip(z);
    eq(back.sdLocal, null);
    eq(back.sdCentral, null);
    eq(back.entries.length, entries.length);
});
t('ZIP 结构不变量：条目顺序 / 压缩方法 / version 字段 / UT 时间戳', () => {
    const z = writeZip(entries);
    const b = Buffer.from(z);
    // 逐条解析本地头
    let off = 0;
    const seen = [];
    while (off + 4 <= b.length && b.readUInt32LE(off) === 0x04034b50) {
        const verNeeded = b.readUInt16LE(off + 4);
        const method = b.readUInt16LE(off + 8);
        const nlen = b.readUInt16LE(off + 26);
        const elen = b.readUInt16LE(off + 28);
        const csize = b.readUInt32LE(off + 18);
        const name = b.toString('utf8', off + 30, off + 30 + nlen);
        seen.push({ name, method, verNeeded });
        off += 30 + nlen + elen + csize;
    }
    eq(seen.length, entries.length);
    deepEq(seen.map((s) => s.name), entries.map((e) => e.name));
    // 小文本压不动时用 STORED(0)/version 10；其余 DEFLATE(8)/version 20
    for (const s of seen) {
        ok(s.method === 0 || s.method === 8, s.name + ' 压缩方法异常');
        eq(s.verNeeded, s.method === 0 ? 10 : 20);
    }
});
t('CRC32 写入正确（与标准测试向量一致）', () => {
    eq(crc32(Buffer.from('123456789')), 0xCBF43926);
    const z = writeZip([{ name: 'a.txt', data: new TextEncoder().encode('123456789') }], { sdLocal: null });
    const back = readZip(z);
    eq(new TextDecoder().decode(back.entries[0].data), '123456789');
});

/* ---------------- v3 ---------------- */
section('v3 代际（AES-256-CBC + zlib）');
t('v3 头部为 "Skin" + u32(3)', () => {
    const data = writeSkin(entries, { format: 'v3' });
    eq(Buffer.from(data.subarray(0, 4)).toString('latin1'), 'Skin');
    eq(Buffer.from(data.subarray(4, 8)).readUInt32LE(0), 3);
    eq((data.length - 8) % 16, 0);
});
t('v3 往返：条目名与内容逐字节一致', () => {
    const data = writeSkin(entries, { format: 'v3' });
    const back = readSkin(data);
    eq(back.format, 'v3');
    eq(back.version, 3);
    eq(back.entries.length, entries.length);
    for (let i = 0; i < entries.length; i++) {
        eq(back.entries[i].name, entries[i].name);
        deepEq(Array.from(back.entries[i].data), Array.from(entries[i].data));
    }
});
t('v3 内层重建与原内层逐字节一致（说明格式推导正确）', () => {
    const data = writeSkin(entries, { format: 'v3' });
    const plain = decryptV3(data);
    const declared = Buffer.from(plain).readUInt32LE(0);
    const inflated = requireZlib().inflateSync(Buffer.from(plain.subarray(4)));
    eq(inflated.length, declared);
    const rebuilt = buildInnerTable(entries.map((e) => ({ name: e.name, data: e.data })));
    deepEq(Array.from(rebuilt), Array.from(inflated));
});
t('v3 公开密钥常量正确（与四个开源实现一致的长度）', () => {
    eq(V3_KEY.length, 32);
    eq(V3_IV.length, 16);
});
t('v3 密文长度不是 16 的倍数时报错', () => {
    const bad = Buffer.alloc(8 + 15);
    bad.write('Skin', 0, 'latin1');
    bad.writeUInt32LE(3, 4);
    assert.throws(() => readSkin(new Uint8Array(bad)), /16 的倍数/);
});
t('findZlibEnd 对完整 zlib 流返回全长（zlib 容忍尾部填充）', () => {
    const z = requireZlib().deflateSync(Buffer.from('0123456789'));
    eq(findZlibEnd(z), z.length);
    // 真正需要二分的场景是"inflate 失败"的尾部垃圾；这里直接验证不会因填充而崩溃
    const padded = Buffer.concat([z, Buffer.alloc(7, 0xFF)]);
    const end = findZlibEnd(padded);
    ok(end > 0 && end <= padded.length, 'findZlibEnd 应返回 1..长度 之间的值，实际 ' + end);
});

/* ---------------- v1 ---------------- */
section('v1 代际（官方 Skin.dat 的明文内层）');
t('v1 头部为 "Skin" + u32(1)，正文是明文内层', () => {
    const data = writeSkin(entries, { format: 'v1' });
    eq(Buffer.from(data.subarray(0, 4)).toString('latin1'), 'Skin');
    eq(Buffer.from(data.subarray(4, 8)).readUInt32LE(0), 1);
    const inner = data.subarray(8);
    eq(Buffer.from(inner).readUInt32LE(0), inner.length); // totalSize 自洽
    eq(Buffer.from(inner).readUInt32LE(4), entries.length * 4); // 偏移表大小
});
t('v1 往返：条目名与内容逐字节一致', () => {
    const data = writeSkin(entries, { format: 'v1' });
    const back = readSkin(data);
    eq(back.format, 'v1');
    eq(back.version, 1);
    eq(back.entries.length, entries.length);
    for (let i = 0; i < entries.length; i++) {
        eq(back.entries[i].name, entries[i].name);
        deepEq(Array.from(back.entries[i].data), Array.from(entries[i].data));
    }
});
t('v1 与 v3 共用同一个内层解析器', () => {
    const inner = buildInnerTable(entries);
    const parsed = parseInnerTable(inner);
    eq(parsed.length, entries.length);
    eq(parsed[1].name, 'Skin.ini');
    const v1 = wrapV1(inner);
    const back = readSkin(v1);
    deepEq(back.entries.map((e) => e.name), entries.map((e) => e.name));
});
t('v1 内层长度字段被篡改时报错（不静默读半截）', () => {
    const inner = Buffer.from(buildInnerTable(entries));
    inner.writeUInt32LE(999999, 0);
    const bad = wrapV1(new Uint8Array(inner));
    assert.throws(() => readSkin(bad), /长度不符/);
});
t('未知的 "Skin" 版本给出明确错误', () => {
    const bad = Buffer.alloc(16);
    bad.write('Skin', 0, 'latin1');
    bad.writeUInt32LE(9, 4);
    assert.throws(() => readSkin(new Uint8Array(bad)), /暂不支持.*v9/);
});

/* ---------------- 统一入口 ---------------- */
section('统一入口 detectFormat / readSkin / writeSkin');
t('detectFormat 识别三代', () => {
    deepEq(detectFormat(writeSkin(entries, { format: 'zip' })).generation, 'zip');
    deepEq(detectFormat(writeSkin(entries, { format: 'v3' })).version, 3);
    deepEq(detectFormat(writeSkin(entries, { format: 'v1' })).version, 1);
    eq(detectFormat(new Uint8Array([1, 2, 3])).generation, 'unknown');
    eq(formatLabel('zip', null), 'zip');
    eq(formatLabel('skin', 3), 'v3');
    eq(formatLabel('skin', 1), 'v1');
});
t('readSkin 对垃圾数据给出可读错误', () => {
    assert.throws(() => readSkin(new Uint8Array([0xde, 0xad, 0xbe, 0xef])), /无法识别/);
});
t('writeSkin 拒绝未知格式', () => {
    assert.throws(() => writeSkin(entries, { format: 'rar' }), /未知的容器代际/);
});
t('encryptV3 的明文按 16 字节对齐', () => {
    const data = encryptV3(buildInnerTable(entries));
    eq((data.length - 8) % 16, 0);
    const plain = decryptV3(data);
    eq((plain.length) % 16, 0);
    ok(parseV3Plain(plain).entries.length === entries.length);
});

/* ---------------- Skin.ini ---------------- */
section('Skin.ini 编解码');
t('UTF-16LE + BOM 编码往返', () => {
    const text = '[General]\r\nskin_name=闲云·青玉\r\nskin_info=中文测试\r\n';
    const u8 = encodeIni(text);
    eq(u8[0], 0xFF);
    eq(u8[1], 0xFE);
    const back = decodeIni(u8);
    ok(back.includes('闲云·青玉'));
    ok(back.includes('\r\n'));
});
t('CRLF 与 LF 都能解析（两种真实样本都有）', () => {
    const crlf = new IniDoc(decodeIni(encodeIni('[A]\r\nx=1\r\n', { crlf: true })));
    const lf = new IniDoc(decodeIni(encodeIni('[A]\r\nx=1\r\n', { crlf: false })));
    eq(crlf.get('A', 'x'), '1');
    eq(lf.get('A', 'x'), '1');
});
t('颜色是 0xBBGGRR（Windows COLORREF），不是 RGB', () => {
    // 0xdc5258 -> R=0x58 G=0x52 B=0xdc
    deepEq(bgrToRgb(0xdc5258), { r: 0x58, g: 0x52, b: 0xdc });
    eq(rgbToBgr({ r: 0x58, g: 0x52, b: 0xdc }), 0xdc5258);
    eq(hexToBgr('#5852dc'), 0xdc5258);
    eq(bgrToHex(0xdc5258), '#5852dc');
});
t('parseIniNumber 支持 0x 十六进制与十进制、短写', () => {
    eq(parseIniNumber('0xdc5258'), 0xdc5258);
    eq(parseIniNumber('16'), 16);
    eq(parseIniNumber('0x72ff'), 0x72ff);
    eq(parseIniNumber(undefined), undefined);
});
t('IniDoc 保留段落顺序，set 新键插在本段末尾', () => {
    const doc = new IniDoc('[A]\r\na=1\r\nb=2\r\n\r\n[B]\r\nc=3\r\n');
    doc.set('A', 'x', '9');
    doc.set('B', 'y', '8');
    const lines = doc.toString().split('\n').map((s) => s.trim()).filter(Boolean);
    deepEq(lines.slice(0, 6), ['[A]', 'a=1', 'b=2', 'x=9', '[B]', 'c=3']);
});
t('IniDoc 新建段落前补空行、toObject/section 可读', () => {
    const doc = new IniDoc('[A]\r\na=1\r\n');
    doc.set('C', 'k', 'v');
    ok(doc.toString().includes('a=1\r\n\r\n[C]') || doc.toString().includes('a=1\n\n[C]'));
    deepEq(doc.toObject(), { A: { a: '1' }, C: { k: 'v' } });
    deepEq(doc.section('A'), { a: '1' });
    ok(doc.hasSection('C'));
    ok(!doc.hasSection('D'));
});

import * as zlib from 'node:zlib';
function requireZlib() { return zlib; }

finish();
