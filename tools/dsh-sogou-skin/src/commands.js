// @ts-check
/**
 * CLI 命令表 —— **单一真源**。
 *
 * `cli.js` 用它做参数分发与帮助文本；测试用它核对 README 里写的命令是否真实存在；
 * 文档生成也读同一份清单。这样就不会再出现「README 写了 validate，代码里没有」这类错误
 * （LESSONS 第 18 条）。
 */
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import {
    assembleProject, assembleToDisk, buildSsf, inspectSsf, pack, readSkinDir, unpackSsf,
} from './ops/build.js';
import { initProject, loadProject, saveProject, defaultSkinTime } from './ops/project.js';
import { previewProject } from './ops/preview.js';
import { repairImage } from './ops/repair.js';
import { requirementsInfo, overlayPresetsInfo } from './ops/requirements.js';
import { scanAssets } from './ops/scan.js';
import { validateTarget } from './ops/validate.js';
import { installSkin, listInstalled } from './ops/install.js';
import { formatScan } from './skin/probe.js';
import { resolveFrom } from './util/fs.js';
import { formatBytes, oneLine } from './util/text.js';

/**
 * @typedef {{positionals:string[], flags:Record<string,string|true>, flagList:(name:string)=>string[]}} CliArgs
 * @typedef {{args:CliArgs, json:boolean, out:(s?:string)=>void, err:(s?:string)=>void}} CliCtx
 * @typedef {{name:string, summary:string, usage:string, detail?:string[], run:(ctx:CliCtx)=>number|void}} CliCommand
 */

/**
 * 解析 "a b --x 1 --y --z=2"
 * @param {string[]} argv
 */
export function parseArgv(argv) {
    /** @type {string[]} */
    const positionals = [];
    /** @type {Record<string,string|true>} */
    const flags = {};
    /** @type {Map<string,string[]>} */
    const lists = new Map();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            let name;
            let value;
            if (eq > 0) { name = a.slice(2, eq); value = a.slice(eq + 1); }
            else {
                name = a.slice(2);
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith('--')) { value = next; i++; }
                else value = true;
            }
            flags[name] = value;
            const list = lists.get(name) || [];
            list.push(String(value));
            lists.set(name, list);
        } else positionals.push(a);
    }
    return { positionals, flags, flagList: (name) => lists.get(name) || [] };
}

/**
 * @param {CliCtx} ctx
 * @param {string} name @param {string} [def]
 */
function flag(ctx, name, def) {
    const v = ctx.args.flags[name];
    return v === undefined ? def : v;
}

/**
 * @param {CliCtx} ctx
 * @param {number} index
 */
function arg(ctx, index) {
    return ctx.args.positionals[index];
}

/**
 * @param {CliCtx} ctx
 * @param {string} message
 */
function fail(ctx, message) {
    ctx.err('错误：' + message);
    return 1;
}

/** @type {CliCommand[]} */
export const COMMANDS = [
    {
        name: 'requirements',
        summary: '列出做皮肤需要哪些素材、工程默认值、引擎窗口标定数据',
        usage: 'requirements [--json]',
        run(ctx) {
            const info = requirementsInfo();
            if (ctx.json) { ctx.out(JSON.stringify(info, null, 2)); return 0; }
            const min = info.minimal;
            ctx.out('=== 做一套搜狗皮肤需要哪些素材 ===');
            ctx.out('');
            ctx.out('【最小可用】' + min.summary);
            ctx.out('  必需槽位：' + min.slots.join(', '));
            ctx.out('');
            for (const g of info.groups) {
                ctx.out('【' + g.group + '】');
                for (const s of g.slots) {
                    ctx.out('  ' + (s.required ? '[必需] ' : '[可选] ') + s.slot.padEnd(18) + s.label);
                    ctx.out('         用途：' + s.purpose);
                    ctx.out('         建议：' + s.sizeHint);
                    if (s.variants) ctx.out('         变体：' + s.variants.join(' / ') + '（每个变体都要常态/悬停/按下三态）');
                }
                ctx.out('');
            }
            ctx.out('引擎窗口模型：' + info.engine.note);
            return 0;
        },
    },
    {
        name: 'init',
        summary: '新建皮肤工程（skin.project.json + assets/ + preview/）',
        usage: 'init <dir> [--name 名字] [--author 作者] [--info 简介]',
        run(ctx) {
            const dir = resolveFrom(arg(ctx, 0) || '.');
            const res = initProject(dir, {
                name: /** @type {string|undefined} */ (flag(ctx, 'name')),
                author: /** @type {string|undefined} */ (flag(ctx, 'author')),
                info: /** @type {string|undefined} */ (flag(ctx, 'info')),
            });
            if (!res.ok) return fail(ctx, res.error);
            if (ctx.json) { ctx.out(JSON.stringify(res, null, 2)); return 0; }
            ctx.out('已创建皮肤工程：' + res.dir);
            ctx.out('  skin.project.json  —— 工程配置（素材分配、配色、按钮开关）');
            ctx.out('  assets/            —— 把你的图片素材放进这里');
            ctx.out('  preview/           —— 预览图输出目录');
            ctx.out('');
            ctx.out('下一步：node src/cli.js scan "' + res.dir + '"');
            return 0;
        },
    },
    {
        name: 'scan',
        summary: '扫描素材目录，输出每张图的客观特征与槽位建议',
        usage: 'scan <dir> [--json]',
        run(ctx) {
            const target = resolveFrom(arg(ctx, 0) || '.');
            const scan = scanAssets(target);
            if (!scan.ok) return fail(ctx, scan.error);
            if (ctx.json) { ctx.out(JSON.stringify(scan, null, 2)); return 0; }
            ctx.out('扫描目录：' + scan.dir);
            ctx.out('可用图片 ' + scan.count + ' 张，跳过 ' + scan.skipped.length + ' 个文件');
            ctx.out('');
            if (scan.count) ctx.out(formatScan(scan));
            if (scan.skipped.length) {
                ctx.out('');
                ctx.out('跳过的文件：');
                for (const s of scan.skipped.slice(0, 20)) ctx.out('  ' + basename(s.path) + '  ' + s.reason);
            }
            return 0;
        },
    },
    {
        name: 'assemble',
        summary: '按工程配置装配出皮肤目录（写入 build/）',
        usage: 'assemble <projectDir> [--no-write] [--json]',
        run(ctx) {
            const dir = resolveFrom(arg(ctx, 0) || '.');
            const writeFiles = ctx.args.flags['no-write'] === undefined;
            const res = assembleToDisk(dir, { writeFiles });
            if (!res.ok) return fail(ctx, res.error);
            if (ctx.json) {
                ctx.out(JSON.stringify({
                    ok: res.errors.length === 0, dir: res.dir, outDir: res.outDir,
                    fileCount: res.files.length, warnings: res.warnings, notes: res.notes,
                    errors: res.errors, ini: res.ini,
                }, null, 2));
                return res.errors.length ? 1 : 0;
            }
            ctx.out('装配完成 -> ' + (res.outDir || '（未写盘）'));
            ctx.out('  文件 ' + res.files.length + ' 个：' + res.files.map((f) => f.name).join(', '));
            if (res.errors.length) {
                ctx.out('');
                ctx.out('错误 ' + res.errors.length + ' 条：');
                for (const e of res.errors) ctx.out('  [错误] ' + e);
            }
            if (res.warnings.length) {
                ctx.out('');
                ctx.out('警告 ' + res.warnings.length + ' 条：');
                for (const w of res.warnings) ctx.out('  ! ' + w);
            }
            if (res.notes.length) {
                ctx.out('');
                ctx.out('提示 ' + res.notes.length + " 条（不阻塞）：");
                for (const n of res.notes) ctx.out('  · ' + n);
            }
            ctx.out('');
            ctx.out('--- 生成的 Skin.ini ---');
            ctx.out(res.ini);
            return res.errors.length ? 1 : 0;
        },
    },
    {
        name: 'validate',
        summary: '校验工程 / 已解包皮肤目录 / .ssf（错误返回非零退出码）',
        usage: 'validate <projectDir|unpackedDir|file.ssf> [--json]',
        run(ctx) {
            const target = arg(ctx, 0);
            if (!target) { ctx.err('用法：validate <projectDir|unpackedDir|file.ssf>'); return 2; }
            const res = validateTarget(resolveFrom(target));
            if (ctx.json) { ctx.out(JSON.stringify(res, null, 2)); return res.ok ? 0 : 1; }
            ctx.out('校验 ' + res.target);
            ctx.out('  类型 ' + res.kind + '，文件 ' + res.fileCount + ' 个，未压缩 ' + formatBytes(res.rawBytes));
            for (const e of res.errors || []) ctx.out('  [错误] ' + e);
            for (const w of res.warnings || []) ctx.out('  [提示] ' + w);
            for (const n of res.notes || []) ctx.out('  [建议] ' + n);
            if (res.ok && !(res.warnings || []).length) ctx.out('  ✓ 通过：没有错误，也没有警告');
            ctx.out('  结论：' + res.summary);
            return res.ok ? 0 : 1;
        },
    },
    {
        name: 'preview',
        summary: '生成预览图套件（render/zoom/bgcheck/stretch/assets/preview + report.txt）',
        usage: 'preview <projectDir> [--no-sheet] [--json]',
        run(ctx) {
            const dir = resolveFrom(arg(ctx, 0) || '.');
            const res = previewProject(dir, { sheet: ctx.args.flags['no-sheet'] === undefined });
            if (!res.ok) return fail(ctx, res.error);
            if (ctx.json) { ctx.out(JSON.stringify(res, null, 2)); return res.validation.ok ? 0 : 1; }
            ctx.out('预览已生成 -> ' + res.previewDir);
            for (const [k, p] of Object.entries(res.paths)) ctx.out('  ' + k.padEnd(8) + p);
            ctx.out('');
            ctx.out('  ' + res.summary);
            if (res.renderNotes?.length) {
                ctx.out('');
                ctx.out('渲染提示：');
                for (const n of res.renderNotes.slice(0, 8)) ctx.out('  ' + n);
            }
            if ((res.warnings || []).length) {
                ctx.out('');
                ctx.out('警告：');
                for (const w of res.warnings) ctx.out('  ! ' + w);
            }
            if ((res.notes || []).length) {
                ctx.out('');
                ctx.out('建议：');
                for (const n of res.notes) ctx.out('  · ' + n);
            }
            return res.validation.ok ? 0 : 1;
        },
    },
    {
        name: 'pack',
        summary: '打包成 .ssf（zip / v3 / v1），也支持逐字重打包已解包目录',
        usage: 'pack <projectDir|unpackedDir> [--format zip|v3|v1] [--out x.ssf] [--template t.ssf] [--set k=v] [--json]',
        run(ctx) {
            const dir = resolveFrom(arg(ctx, 0) || '.');
            /** @type {Record<string,string>} */
            const set = {};
            for (const kv of ctx.args.flagList('set')) {
                const i = kv.indexOf('=');
                if (i > 0) set[kv.slice(0, i)] = kv.slice(i + 1);
            }
            const res = pack(dir, {
                format: /** @type {any} */ (flag(ctx, 'format')),
                out: flag(ctx, 'out') ? resolveFrom(String(flag(ctx, 'out'))) : undefined,
                template: flag(ctx, 'template') ? resolveFrom(String(flag(ctx, 'template'))) : undefined,
                set,
            });
            if (!res.ok && res.error) return fail(ctx, res.error);
            if (ctx.json) { ctx.out(JSON.stringify(res, null, 2)); return res.errors?.length ? 1 : 0; }
            ctx.out('已打包：' + res.out);
            ctx.out('  ' + res.entries + ' 个条目，' + formatBytes(res.bytes) + '，' + res.format + ' 代际');
            for (const w of res.warnings || []) ctx.out('  ! ' + w);
            if (res.errors?.length) for (const e of res.errors) ctx.out('  [错误] ' + e);
            return res.errors?.length ? 1 : 0;
        },
    },
    {
        name: 'inspect',
        summary: '解析 .ssf：代际、条目清单、完整 Skin.ini',
        usage: 'inspect <file.ssf> [--json]',
        run(ctx) {
            const file = arg(ctx, 0);
            if (!file) { ctx.err('用法：inspect <file.ssf>'); return 2; }
            const info = inspectSsf(resolveFrom(file));
            if (!info.ok) return fail(ctx, info.error);
            if (ctx.json) {
                ctx.out(JSON.stringify({
                    ok: true, file: info.file, format: info.format, generation: info.generation,
                    version: info.version, entries: info.entries, entryList: info.entryList,
                    images: info.images, ini: info.ini,
                }, null, 2));
                return 0;
            }
            ctx.out('文件：' + info.file);
            ctx.out('代际：' + info.format + '（' + info.entries + ' 个条目）');
            ctx.out('图片：' + info.images.length + ' 张');
            ctx.out('');
            for (const e of info.entryList) ctx.out('  ' + e.name.padEnd(34) + e.bytes + ' B');
            if (info.ini) { ctx.out(''); ctx.out('--- Skin.ini ---'); ctx.out(info.ini); }
            return 0;
        },
    },
    {
        name: 'unpack',
        summary: '解包 .ssf 到目录（v3 自动解密），另存 UTF-8 Skin.ini',
        usage: 'unpack <file.ssf> [outDir]',
        run(ctx) {
            const file = arg(ctx, 0);
            if (!file) { ctx.err('用法：unpack <file.ssf> [outDir]'); return 2; }
            const res = unpackSsf(resolveFrom(file), arg(ctx, 1) ? resolveFrom(arg(ctx, 1)) : undefined);
            if (!res.ok) return fail(ctx, res.error);
            if (ctx.json) { ctx.out(JSON.stringify(res, null, 2)); return 0; }
            ctx.out('已解包 ' + res.files.length + ' 个文件 -> ' + res.outDir + '（' + res.format + ' 代际）');
            ctx.out('Skin.ini 另存了一份 UTF-8 副本：Skin.ini.utf8.txt');
            return 0;
        },
    },
    {
        name: 'repair',
        summary: '对单张素材做修复（去背景/裁剪/缩放/色相/描边…），操作可串联',
        usage: 'repair <src> [--out 输出] [--op \'{"op":"removeBackground","tol":20}\']... [--json]',
        run(ctx) {
            const src = arg(ctx, 0);
            if (!src) { ctx.err('用法：repair <src> [--out 输出] [--op JSON]...'); return 2; }
            /** @type {any[]} */
            const ops = [];
            for (const raw of ctx.args.flagList('op')) {
                try { ops.push(JSON.parse(raw)); } catch { return fail(ctx, '--op 需要合法 JSON：' + raw); }
            }
            if (!ops.length) return fail(ctx, '至少给一个 --op，例如 --op \'{"op":"trim"}\'');
            const res = repairImage({ src: resolveFrom(src), out: flag(ctx, 'out') ? resolveFrom(String(flag(ctx, 'out'))) : undefined, ops });
            if (!res.ok) return fail(ctx, res.error + (res.log?.length ? '\n' + res.log.join('\n') : ''));
            if (ctx.json) { ctx.out(JSON.stringify(res, null, 2)); return 0; }
            for (const line of res.log) ctx.out('  ' + line);
            ctx.out('已写出：' + res.out + '（' + res.size + '，' + res.sizeText + '）');
            return 0;
        },
    },
    {
        name: 'install',
        summary: '装到本机搜狗（优先走引擎安装并自动切换；可 --mode copy 只复制）',
        usage: 'install <file.ssf> [--mode auto|engine|copy] [--target 目录] [--dry-run]',
        async run(ctx) {
            const file = arg(ctx, 0);
            if (!file) { ctx.err('用法：install <file.ssf> [--mode auto|engine|copy] [--target 目录] [--dry-run]'); return 2; }
            const res = await installSkin({
                file: resolveFrom(file),
                target: flag(ctx, 'target') ? resolveFrom(String(flag(ctx, 'target'))) : undefined,
                mode: /** @type {any} */ (flag(ctx, 'mode')) || 'auto',
                dryRun: ctx.args.flags['dry-run'] !== undefined,
            });
            if (ctx.json) { ctx.out(JSON.stringify(res, null, 2)); return res.ok ? 0 : 1; }
            ctx.out((res.dryRun ? '[dry-run] ' : '') + '皮肤包：' + res.file + '（' + res.format + '，' + res.entries + ' 条目）');
            ctx.out('安装方式：' + (res.method || res.plannedMethod || '（未执行）') + (res.engine ? '  SGTool=' + (res.engine.sgtool || '未找到') : ''));
            if (res.plan) ctx.out('计划：' + res.plan);
            for (const t of (res.writePlan || [])) {
                ctx.out('  ' + (t.written ? '已写入 ' : (res.dryRun ? '将写入 ' : '失败 ')) + t.dest + (t.error ? '  ' + t.error : ''));
            }
            if (res.error) ctx.out('错误：' + res.error);
            if (res.note) ctx.out(res.note);
            return res.ok ? 0 : 1;
        },
    },
    {
        name: 'list',
        summary: '列出本机已安装的搜狗皮肤',
        usage: 'list [--target 目录] [--json]',
        run(ctx) {
            const res = listInstalled({ target: flag(ctx, 'target') ? resolveFrom(String(flag(ctx, 'target'))) : undefined });
            if (ctx.json) { ctx.out(JSON.stringify(res, null, 2)); return 0; }
            if (!res.total) { ctx.out('没有在常见位置找到 .ssf 皮肤。'); if (res.hint) ctx.out(res.hint); return 0; }
            for (const d of res.dirs) {
                ctx.out('[' + d.dir + '] ' + d.count + ' 个');
                for (const s of d.skins) ctx.out('  ' + s.name.padEnd(40) + (s.bytes ? formatBytes(s.bytes).padStart(9) : '') + '  ' + (s.format || s.error || ''));
            }
            return 0;
        },
    },
    {
        name: 'overlay-presets',
        summary: '列出官方浮层 *_align 十元组预设与逆向结论',
        usage: 'overlay-presets [--json]',
        run(ctx) {
            const info = overlayPresetsInfo();
            if (ctx.json) { ctx.out(JSON.stringify(info, null, 2)); return 0; }
            ctx.out('官方浮层对齐预设（原样透传给 overlays[].align）：');
            for (const [k, v] of Object.entries(info.presets)) ctx.out('  ' + k.padEnd(28) + v);
            ctx.out('');
            ctx.out('已确认：');
            for (const c of info.decoded.confirmed) ctx.out('  · ' + c);
            ctx.out('未解：' + info.decoded.unknown);
            return 0;
        },
    },
    {
        name: 'demo',
        summary: '一条龙演示：建工程 → 占位素材装配 → 预览 → 打包',
        usage: 'demo <dir> [--name 名字] [--format zip|v3|v1]',
        run(ctx) {
            const dir = resolveFrom(arg(ctx, 0) || 'demo-skin');
            if (existsSync(join(dir, 'skin.project.json'))) return fail(ctx, '目录里已有工程：' + dir + '（demo 不覆盖已有工程）');
            const init = initProject(dir, { name: /** @type {string|undefined} */ (flag(ctx, 'name')) || '演示皮肤', author: 'DSH 搜狗皮肤工坊' });
            if (!init.ok) return fail(ctx, init.error);
            // 默认工程已含必需占位槽位；这里再多开几个按钮，让演示更像真实皮肤。
            const loaded = loadProject(dir);
            if (!loaded.ok) return fail(ctx, loaded.error);
            const project = loaded.project;
            project.skinTime = defaultSkinTime();
            project.buttons.enabled = ['cn_en', 'quan_ban', 'biaodian', 'softkeyboard', 'menu', 'fan_jian'];
            for (const b of project.buttons.enabled) project.roles[b] = { generate: true };
            saveProject(dir, project);
            const created = assembleProject(dir, {});
            if (!created.ok) return fail(ctx, created.error);
            const res = previewProject(dir);
            if (!res.ok) return fail(ctx, res.error);
            const format = /** @type {any} */ (flag(ctx, 'format')) || 'zip';
            const built = pack(dir, { format });
            if (!built.ok && built.error) return fail(ctx, built.error);
            ctx.out('演示工程已生成：' + dir);
            ctx.out('  条目 ' + created.files.length + ' 个，未压缩 ' + formatBytes(created.meta.rawBytes));
            ctx.out('  预览 ' + res.previewDir);
            for (const p of Object.values(res.paths)) ctx.out('    ' + p);
            ctx.out('  皮肤包 ' + built.out + '（' + formatBytes(built.bytes) + '，' + built.format + '）');
            if (created.warnings.length) { ctx.out(''); for (const w of created.warnings) ctx.out('  ! ' + w); }
            return 0;
        },
    },
];

/** 按名字取命令。 @param {string} name */
export function findCommand(name) {
    return COMMANDS.find((c) => c.name === name) || null;
}

/** 生成帮助文本（READ 一致性测试会解析它）。 */
export function helpText() {
    const lines = [];
    lines.push('DSH 搜狗皮肤工坊 CLI');
    lines.push('');
    lines.push('用法：node src/cli.js <命令> [参数]');
    lines.push('');
    lines.push('命令：');
    const width = Math.max(...COMMANDS.map((c) => c.usage.length));
    for (const c of COMMANDS) lines.push('  ' + c.usage.padEnd(width + 2) + c.summary);
    lines.push('');
    lines.push('通用：--json 输出机器可读 JSON；--help 显示本帮助。');
    return lines.join('\n');
}

/** 导出给测试：检查 README 与实际命令是否一致。 */
export function commandNames() {
    return COMMANDS.map((c) => c.name);
}

/** 导出给测试/文档：命令摘要表。 */
export function commandTable() {
    return COMMANDS.map((c) => ({ name: c.name, usage: c.usage, summary: c.summary }));
}

// 未使用但保留：给未来命令做"按目标类型分派"的辅助
export { readSkinDir, buildSsf, oneLine };
