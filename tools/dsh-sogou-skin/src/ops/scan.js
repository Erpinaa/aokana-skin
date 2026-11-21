// @ts-check
/**
 * 素材扫描 —— 把一堆用户图片变成 AI 可读的结构化描述。
 * 只做客观测量，不做决策；决策交给模型或用户。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scanDirectory } from '../skin/probe.js';
import { flattenSpec, suggestSlots } from '../skin/spec.js';
import { resolveFrom } from '../util/fs.js';

/**
 * 扫描一个素材目录（或工程目录的 assets/）。
 * @param {string} target
 * @param {{includeSuggestions?:boolean, recursive?:boolean}} [opts]
 */
export function scanAssets(target, opts = {}) {
    const path = resolveFrom(target);
    const dir = existsSync(join(path, 'skin.project.json')) ? join(path, 'assets') : path;
    if (!existsSync(dir)) return { ok: false, error: '目录不存在：' + dir };
    const scan = scanDirectory(dir, { recursive: opts.recursive !== false });
    const available = flattenSpec().map((s) => ({ slot: s.slot, group: s.group, label: s.label }));
    const files = scan.files.map((f) => ({
        ...f,
        suggestions: opts.includeSuggestions === false ? undefined : suggestSlots(f, available),
    }));
    return {
        ok: true,
        dir: scan.dir,
        count: files.length,
        files,
        skipped: scan.skipped,
        formatHint: files.length ? null : '目录里没有 PNG/BMP 图片。本插件零依赖，不解码 JPEG/WebP/GIF —— 请先转成 PNG。',
        next: '把选定的 slot -> 文件映射传给 skin_assign；不确定的槽位先问用户，不要瞎猜。',
    };
}
