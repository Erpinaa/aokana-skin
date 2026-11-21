// @ts-check
/**
 * 素材修复 / 小图片编辑器 —— `skin_repair` 与 CLI `repair` 的唯一实现。
 *
 * 这些操作原本散在 tools.js 里，CLI 无法复用。现在集中到 ops 层：
 * 输入一张图 + 一串操作，按顺序执行，输出一张图，返回每一步的日志与客观特征。
 */
import { existsSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import * as R from '../image/raster.js';
import { encodePng } from '../image/png.js';
import { encodeBmp24 } from '../image/bmp.js';
import { loadImage, probeImage } from '../skin/probe.js';
import { ensureParent, errorText, resolveFrom } from '../util/fs.js';
import { formatBytes } from '../util/text.js';

/** 支持的修复操作名（与工具 schema 的 enum 保持一致）。 */
export const REPAIR_OPS = [
    'removeBackground', 'replaceColor', 'crop', 'resize', 'containFit', 'trim',
    'normalizeHue', 'hueShift', 'adjust', 'outline', 'flatten', 'blur', 'describe',
];

/** @param {string} hex @returns {[number,number,number]} */
function parseHex(hex) {
    const h = String(hex).replace('#', '').trim();
    if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error('颜色应为 #rrggbb（收到 ' + JSON.stringify(hex) + '）');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 执行一串修图操作。
 * @param {{src:string, out?:string, ops:any[]}} args
 * @returns {{ok:true, out:string, size:string, bytes:number, log:string[], probe:any}
 *          |{ok:false, error:string, log:string[]}}
 */
export function repairImage(args) {
    const src = resolveFrom(args.src);
    const log = [];
    if (!existsSync(src)) return { ok: false, error: '输入图片不存在：' + src, log };
    const loaded = loadImage(src);
    if (!loaded.ok) return { ok: false, error: loaded.error, log };
    let r = loaded.raster;
    const inputProbe = probeImage(r);
    log.push('读入 ' + src + '  ' + r.width + 'x' + r.height + '  ' + loaded.format);

    for (const op of args.ops || []) {
        const name = op && op.op;
        if (!name) return { ok: false, error: '操作缺少 op 字段', log };
        try {
            switch (name) {
                case 'removeBackground': {
                    const n = R.removeBackground(r, { tol: op.tol ?? 18, feather: op.feather ?? 0 });
                    log.push('removeBackground tol=' + (op.tol ?? 18) + ' feather=' + (op.feather ?? 0) + ' -> 移除 ' + n + ' 像素');
                    break;
                }
                case 'replaceColor': {
                    const t = parseHex(op.target);
                    const rep = op.replacement ? parseHex(op.replacement) : null;
                    const n = R.replaceColor(r, [t[0], t[1], t[2], 255], op.tol ?? 12, rep ? [rep[0], rep[1], rep[2], 255] : null);
                    log.push('replaceColor -> ' + n + ' 像素');
                    break;
                }
                case 'crop':
                    r = R.crop(r, op.x ?? 0, op.y ?? 0, op.width ?? r.width, op.height ?? r.height);
                    log.push('crop -> ' + r.width + 'x' + r.height);
                    break;
                case 'resize':
                    r = R.resize(r, op.width ?? r.width, op.height ?? r.height, 'bilinear');
                    log.push('resize -> ' + r.width + 'x' + r.height);
                    break;
                case 'containFit':
                    r = R.containFit(r, op.width ?? 20, op.height ?? 20, 'bilinear');
                    log.push('containFit -> ' + r.width + 'x' + r.height);
                    break;
                case 'trim':
                    r = R.trim(r, op.tol ?? 2);
                    log.push('trim -> ' + r.width + 'x' + r.height);
                    break;
                case 'normalizeHue': {
                    const moved = R.normalizeHue(r, op.turns ?? 0.5);
                    log.push('normalizeHue -> 位移 ' + (moved * 360).toFixed(0) + '°');
                    break;
                }
                case 'hueShift':
                    R.hueShift(r, op.turns ?? 0);
                    log.push('hueShift ' + ((op.turns ?? 0) * 360).toFixed(0) + '°');
                    break;
                case 'adjust':
                    R.adjust(r, { brightness: op.brightness ?? 1, saturation: op.saturation ?? 1, contrast: op.contrast ?? 1 });
                    log.push('adjust brightness=' + (op.brightness ?? 1) + ' saturation=' + (op.saturation ?? 1) + ' contrast=' + (op.contrast ?? 1));
                    break;
                case 'outline': {
                    const c = parseHex(op.color || '#ffffff');
                    R.outline(r, [c[0], c[1], c[2], 255], op.thickness ?? 1);
                    log.push('outline thickness=' + (op.thickness ?? 1));
                    break;
                }
                case 'flatten': {
                    const bg = op.color ? parseHex(op.color) : [255, 255, 255];
                    for (let i = 0; i < r.data.length; i += 4) {
                        const a = r.data[i + 3] / 255;
                        r.data[i] = Math.round(r.data[i] * a + bg[0] * (1 - a));
                        r.data[i + 1] = Math.round(r.data[i + 1] * a + bg[1] * (1 - a));
                        r.data[i + 2] = Math.round(r.data[i + 2] * a + bg[2] * (1 - a));
                        r.data[i + 3] = 255;
                    }
                    log.push('flatten -> ' + bg.join(','));
                    break;
                }
                case 'blur':
                    R.blur(r, op.radius ?? 2);
                    log.push('blur radius=' + (op.radius ?? 2));
                    break;
                case 'describe':
                    log.push('describe: ' + JSON.stringify(probeImage(r)));
                    break;
                default:
                    return { ok: false, error: '未知操作：' + name + '（支持 ' + REPAIR_OPS.join(' / ') + '）', log };
            }
        } catch (e) {
            return { ok: false, error: '操作 ' + name + ' 失败：' + errorText(e), log };
        }
    }

    const out = resolveFrom(args.out || src.replace(/\.[^.]+$/, '') + '.edited.png');
    const ext = extname(out).toLowerCase() === '.bmp' ? '.bmp' : '.png';
    let data;
    try {
        data = ext === '.bmp' ? encodeBmp24(r) : encodePng(r);
        ensureParent(out);
        writeFileSync(out, Buffer.from(data));
    } catch (e) {
        return { ok: false, error: '写出失败：' + errorText(e), log };
    }
    return {
        ok: true,
        out,
        size: r.width + 'x' + r.height,
        bytes: data.length,
        sizeText: formatBytes(data.length),
        format: ext === '.bmp' ? 'bmp' : 'png',
        log,
        input: inputProbe,
        probe: probeImage(r),
    };
}
