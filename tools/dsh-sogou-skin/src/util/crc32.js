// @ts-check
/**
 * CRC32（IEEE 802.3 多项式 0xEDB88320）。
 *
 * PNG 分块与 ZIP 条目都要用它。原本这个函数住在 `ssf/zip.js` 里，被 `image/png.js` 反向引用，
 * 造成「图像层依赖容器层」的层次倒挂；v0.2.0 把公共字节工具提到 `util/`，两层都只依赖它。
 *
 * 刻意不用 `zlib.crc32`：本插件要兼容 Node 18，而该 API 是 Node 20.15+ 才有的。
 */

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
    }
    return table;
})();

/**
 * @param {Uint8Array} buf
 * @returns {number} 无符号 32 位 CRC
 */
export function crc32(buf) {
    let c = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
    return (c ^ -1) >>> 0;
}
