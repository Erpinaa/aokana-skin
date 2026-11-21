// @ts-check
/**
 * 注册给 DSH 的工具面 —— 每个工具都是 ops 层的一次调用，只负责：
 *   1. 把工具参数里可能相对的路径解析成绝对路径；
 *   2. 调对应 ops 函数；
 *   3. 把异常变成 `{ok:false, error}` 返回（而不是抛给模型）。
 *
 * 「怎么组合素材、怎么判断审美」这类决策留给模型；工具只做可验证的操作。
 * v0.2.0 起 tools.js 不再自己实现任何业务逻辑（v0.1.0 里它和 cli.js 是两份实现）。
 */
import { isAbsolute, resolve } from 'node:path';
import { assembleToDisk, pack, inspectSsf, unpackSsf } from './ops/build.js';
import { assignProject, initProject } from './ops/project.js';
import { previewProject } from './ops/preview.js';
import { repairImage } from './ops/repair.js';
import { requirementsInfo, overlayPresetsInfo } from './ops/requirements.js';
import { scanAssets } from './ops/scan.js';
import { validateTarget } from './ops/validate.js';
import { installSkin, listInstalled, SOGOU_HINTS } from './ops/install.js';
import { errorText } from './util/fs.js';

/** 统一的工具输出渲染：结构化结果 → 文本块。 */
function textRender(_args, value) {
    if (typeof value === 'string') return [{ type: 'text', text: value }];
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/**
 * @param {any} ctx DSH 插件上下文
 * @param {{projectsRoot:string}} env
 * @returns {{registered:number, names:string[], reason?:string}}
 */
export function registerTools(ctx, env) {
    const tools = ctx?.tools;
    if (!tools || typeof tools.register !== 'function') {
        return { registered: 0, names: [], reason: 'ctx.tools 服务不可用' };
    }
    /** @type {string[]} */
    const names = [];

    /**
     * @param {string} name @param {string} description
     * @param {'read'|'write'|'destroy'|'idempotent'} behavior
     * @param {object} parameters
     * @param {(args:any)=>any} execute
     */
    const reg = (name, description, behavior, parameters, execute) => {
        tools.register({
            name,
            description,
            behavior,
            parameters,
            readOnly: behavior === 'read',
            idempotent: behavior !== 'write',
            destructive: behavior === 'destroy',
            output: { schema: { type: 'object' }, render: textRender },
            execute: async (args) => {
                try {
                    return await execute(args || {});
                } catch (e) {
                    return { ok: false, error: errorText(e) };
                }
            },
            ...(behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
        });
        names.push(name);
    };

    /** 路径解析：工具参数里的相对路径按 projectsRoot 解析。 */
    const abs = (p) => {
        if (typeof p !== 'string' || !p.trim()) throw new Error('路径不能为空');
        return isAbsolute(p) ? resolve(p) : resolve(env.projectsRoot || process.cwd(), p);
    };

    // ---------------- 1. 需求清单（read）----------------
    reg('skin_requirements',
        '列出制作一套搜狗输入法皮肤需要哪些素材：分组、必需/可选、用途、尺寸建议、三态变体，以及工程配置的默认值。做皮肤的第一步。不需要任何参数。',
        'read',
        { type: 'object', properties: {}, additionalProperties: false },
        async () => requirementsInfo());

    // ---------------- 2. 新建工程（write）----------------
    reg('skin_init',
        '新建一个搜狗皮肤工程（skin.project.json + assets/ + preview/ 目录 + 默认工程配置）。已有工程会报错，不会覆盖。建好后直接 skin_assemble 即可用程序化占位素材跑通全流程。',
        'write',
        {
            type: 'object',
            properties: {
                dir: { type: 'string', description: '工程目录；相对路径按项目的 projectsRoot 解析' },
                name: { type: 'string', description: '皮肤名' },
                author: { type: 'string', description: '作者' },
                info: { type: 'string', description: '皮肤简介' },
            },
            required: ['dir'],
        },
        async (args) => {
            const dir = abs(args.dir);
            const res = initProject(dir, { name: args.name, author: args.author, info: args.info });
            if (!res.ok) return res;
            return {
                ok: true,
                dir: res.dir,
                projectFile: res.file,
                project: res.project,
                next: '把图片放进 ' + res.dir + '/assets/，再 skin_scan_assets → skin_assign；没有素材也可以直接 skin_assemble 用占位图。',
            };
        });

    // ---------------- 3. 扫描素材（read）----------------
    reg('skin_scan_assets',
        '扫描一个素材目录里所有 PNG/BMP 图片，输出每张图的客观特征（尺寸/是否带 alpha/主导色相/内容区/格式），并给出「它最适合哪个槽位」的建议。AI 据此决定如何组合。',
        'read',
        {
            type: 'object',
            properties: {
                dir: { type: 'string', description: '素材目录，或皮肤工程目录（会自动用其 assets/）' },
                includeSuggestions: { type: 'boolean', description: '是否附带槽位建议（默认 true）' },
            },
            required: ['dir'],
        },
        async (args) => scanAssets(abs(args.dir), { includeSuggestions: args.includeSuggestions }));

    // ---------------- 4. 分配槽位（write）----------------
    reg('skin_assign',
        '把素材文件分配到皮肤槽位，并写回 skin.project.json。一次可以分配多个槽位；也支持改主题色、启停状态栏按钮、配置浮层按钮、2x 素材缩放。未指定的槽位不会被动。',
        'write',
        {
            type: 'object',
            properties: {
                dir: { type: 'string', description: '工程目录' },
                assignments: {
                    type: 'array',
                    description: '槽位分配列表',
                    items: {
                        type: 'object',
                        properties: {
                            slot: { type: 'string', description: '槽位名，如 panel_h / panel_v / bar / cn_en' },
                            source: { type: 'string', description: '单张素材路径（相对工程目录或 projectsRoot）' },
                            sources: { type: 'object', description: '按变体分别给图，如 {"cn":"a.png","en":"b.png"}' },
                            sheet: { type: 'string', description: '拼图：由插件自动切分成各变体' },
                            states: { type: 'object', description: '显式三态图：{"hover":{"cn":"a2.png"},"down":{...}}' },
                            nineSlice: { type: 'object', description: '九宫格边界 {left,right,top,bottom,modeH,modeV}；不给则自动探测' },
                            margins: { type: 'object', description: '{pinyin_marge:[t,b,l,r], zhongwen_marge:[t,b,l,r]}' },
                            generate: { type: 'boolean', description: '用占位图' },
                            scale: { type: 'number', description: '该槽位素材的倍数（2 = 2x 素材，装配时缩到逻辑像素）' },
                            hue: { type: 'number', description: '占位素材色相 0..1' },
                            size: { type: 'object', description: '占位素材尺寸 {width,height}' },
                            trim: { type: 'boolean', description: '装配前裁掉透明边' },
                        },
                        required: ['slot'],
                    },
                },
                enableButtons: { type: 'array', items: { type: 'string' }, description: '启用哪些状态栏按钮（顺序即显示顺序）' },
                buttons: { type: 'object', description: '按钮开关：{writeDisplay:true, pos:{cn_en:[x,y]}}。writeDisplay 默认 false —— 真实第三方皮肤都不写 <按钮>_display' },
                theme: { type: 'object', description: '配色（#rrggbb），例如 {"pinyinColor":"#155a60"}' },
                overlays: {
                    type: 'array',
                    description: '候选窗浮层按钮（翻页/展开更多候选/自定义）。align 是 10 元组，本插件原样透传不做推导；可直接用 skin_overlay_presets 里的官方预设值。',
                    items: {
                        type: 'object',
                        properties: {
                            section: { type: 'string', enum: ['Scheme_H1', 'Scheme_V1', 'Scheme_H2', 'Scheme_V2'] },
                            name: { type: 'string', description: '如 pageup / pagedown / sugg / custom0；H2/V2 里可用 cand_ 或 comp_ 前缀' },
                            align: { type: 'string', description: '10 个整数，逗号分隔，例如 0,0,0,48,0,0,0,2,6,2' },
                            normal: { type: 'array', items: { type: 'string' }, description: '常态图（可多张，引擎按输入法状态二选一）' },
                            hover: { type: 'array', items: { type: 'string' } },
                            down: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['name', 'align', 'normal'],
                    },
                },
                assets: { type: 'object', description: '素材缩放设置，例如 {"scale":2}（2x 素材，装配时缩到逻辑像素）' },
                icon: { type: 'object', description: '图标规格 {w,h,format:"png"|"bmp"}' },
                display: { type: 'object', description: '[Display] 段设置 {fontSize,fontCh,fontEn,...}' },
                anchors: { type: 'object', description: '窗口锚点 {Scheme_H1:[x,y],...}；不给则按九宫格推导' },
                nineSlice: { type: 'object', description: '按槽位给九宫格 {panel_h:{left,right,top,bottom}}' },
            },
            required: ['dir', 'assignments'],
        },
        async (args) => {
            const dir = abs(args.dir);
            return assignProject(dir, {
                assignments: args.assignments || [],
                enableButtons: args.enableButtons,
                buttons: args.buttons,
                theme: args.theme,
                overlays: args.overlays,
                assets: args.assets,
                icon: args.icon,
                display: args.display,
                anchors: args.anchors,
                nineSlice: args.nineSlice,
            });
        });

    // ---------------- 5. 装配（write）----------------
    reg('skin_assemble',
        '按工程配置装配出完整皮肤：尺寸归一、格式转换、三态派生、九宫格推导/体检、Skin.ini 生成。产物写入工程 build/ 目录。不会写入任何工程里没有声明的可选段落。',
        'write',
        {
            type: 'object',
            properties: {
                dir: { type: 'string', description: '皮肤工程目录（含 skin.project.json）' },
                writeFiles: { type: 'boolean', description: '是否落盘（默认 true）' },
            },
            required: ['dir'],
        },
        async (args) => {
            const res = assembleToDisk(abs(args.dir), { writeFiles: args.writeFiles !== false });
            if (!res.ok) return res;
            return {
                ok: res.errors.length === 0,
                dir: res.dir,
                outDir: res.outDir,
                fileCount: res.files.length,
                files: res.files.map((f) => ({ name: f.name, bytes: f.data.length })),
                rawBytes: res.meta.rawBytes,
                errors: res.errors,
                warnings: res.warnings,
                notes: res.notes,
                layout: Object.fromEntries(Object.entries(res.layoutInfo).map(([k, v]) => [k, {
                    size: v.size, designScale: v.designScale,
                    nineSlice: v.nineSlice, margins: v.margins, audit: v.audit,
                }])),
                ini: res.ini,
            };
        });

    // ---------------- 6. 预览（write）----------------
    reg('skin_preview',
        '生成皮肤预览图（写入工程 preview/）：render.png 引擎模型真渲染、zoom.png 逐段放大、bgcheck.png 白底/黑底对照、stretch.png 拉伸体检、assets.png 素材总览、preview.png 总览看板、report.txt 量化报告。返回文件路径与校验结果，可用 read_image 查看图片。',
        'write',
        {
            type: 'object',
            properties: {
                dir: { type: 'string', description: '皮肤工程目录' },
                sheet: { type: 'boolean', description: '是否输出素材总览 assets.png（默认 true）' },
                width: { type: 'number', description: '已废弃：预览宽度自适应，此参数会被忽略' },
            },
            required: ['dir'],
        },
        async (args) => {
            const res = previewProject(abs(args.dir), { sheet: args.sheet });
            if (!res.ok) return res;
            return {
                ok: res.validation.ok,
                dir: res.dir,
                previewDir: res.previewDir,
                paths: res.paths,
                fileCount: res.files,
                rawBytes: res.rawBytes,
                summary: res.summary,
                renderNotes: res.renderNotes,
                zoomNotes: res.zoomNotes,
                bgcheckIssues: res.bgcheckIssues,
                errors: res.validation.errors,
                warnings: res.warnings,
                notes: res.notes,
                measure: res.measure,
                hint: '**先看 render.png**（真实布局/候选贴底）→ zoom.png（像素细节）→ stretch.png（拉伸）→ bgcheck.png（勾边底色）。report.txt 里有量化数据与全部提示。',
            };
        });

    // ---------------- 7. 修图（write）----------------
    reg('skin_repair',
        '对单张素材做细节修复与编辑（内置小图片编辑器）。支持去背景色键、替换颜色、裁剪、缩放、等比适应、去透明边、色相迁移/归一、亮度饱和对比调整、加描边、模糊、拼图切分。可一次串联多个操作。',
        'write',
        {
            type: 'object',
            properties: {
                src: { type: 'string', description: '输入图片路径（PNG 或 BMP）' },
                out: { type: 'string', description: '输出图片路径（.png 或 .bmp）；默认在输入旁生成 .edited.png' },
                ops: {
                    type: 'array',
                    description: '按顺序执行的操作',
                    items: {
                        type: 'object',
                        properties: {
                            op: {
                                type: 'string',
                                enum: ['removeBackground', 'replaceColor', 'crop', 'resize', 'containFit', 'trim',
                                    'normalizeHue', 'hueShift', 'adjust', 'outline', 'flatten', 'blur', 'describe'],
                            },
                            tol: { type: 'number' }, color: { type: 'string', description: '#rrggbb' },
                            x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
                            target: { type: 'string' }, replacement: { type: 'string' },
                            turns: { type: 'number' }, brightness: { type: 'number' }, saturation: { type: 'number' },
                            contrast: { type: 'number' }, thickness: { type: 'number' }, feather: { type: 'number' },
                            radius: { type: 'number' },
                        },
                        required: ['op'],
                    },
                },
            },
            required: ['src', 'ops'],
        },
        async (args) => {
            const res = repairImage({
                src: abs(args.src),
                out: args.out ? abs(args.out) : undefined,
                ops: args.ops || [],
            });
            return res;
        });

    // ---------------- 8. 打包（write）----------------
    reg('skin_pack',
        '把皮肤工程打包成 .ssf。format=zip 产出明文 ZIP 代际（皮肤编辑器可再打开、社区通行）；format=v3 产出商店加密代际；format=v1 产出官方 Skin.dat 用的明文内层代际。也支持传入一个「已解包的皮肤目录」（含 Skin.ini）做逐字重打包，用于克隆/改造真实皮肤。',
        'write',
        {
            type: 'object',
            properties: {
                dir: { type: 'string', description: '工程目录，或含 Skin.ini 的已解包皮肤目录' },
                out: { type: 'string', description: '.ssf 输出路径；默认写到目标目录下' },
                format: { type: 'string', enum: ['zip', 'v3', 'v1'], description: '默认 zip' },
                template: { type: 'string', description: '可选：从某个已有 .ssf 继承私有 SD 字段（仅 zip 代际有效）' },
                set: { type: 'object', description: '可选：重打包时改六个身份字段，如 {"skin_name":"新名字"}' },
            },
            required: ['dir'],
        },
        async (args) => pack(abs(args.dir), {
            format: args.format,
            out: args.out ? abs(args.out) : undefined,
            template: args.template ? abs(args.template) : undefined,
            set: args.set,
        }));

    // ---------------- 9. 解析皮肤包（read）----------------
    reg('skin_inspect',
        '解析一个 .ssf 皮肤包：识别代际（明文 ZIP / 加密 v3 / Skin.dat v1）、列出全部条目与体积、输出完整 Skin.ini。可用来「拿别人的皮肤当参考」。',
        'read',
        {
            type: 'object',
            properties: { file: { type: 'string', description: '.ssf 文件路径（也接受 Skin.dat）' } },
            required: ['file'],
        },
        async (args) => inspectSsf(abs(args.file)));

    // ---------------- 10. 解包（write）----------------
    reg('skin_unpack',
        '把 .ssf 解包到目录（v3 加密代际会自动解密，v1 也支持），并额外导出一份 UTF-8 的 Skin.ini 便于查看。解包后可以用 skin_pack 逐字打回。',
        'write',
        {
            type: 'object',
            properties: {
                file: { type: 'string', description: '.ssf 文件路径' },
                outDir: { type: 'string', description: '解包目录；默认在文件旁生成 <名字>_unpacked/' },
            },
            required: ['file'],
        },
        async (args) => unpackSsf(abs(args.file), args.outDir ? abs(args.outDir) : undefined));

    // ---------------- 11. 校验（read）----------------
    reg('skin_validate',
        '校验一套皮肤是否完整可用：工程配置、Skin.ini 结构与键名、图片引用、九宫格退化、可拉伸中段、候选条背景、图标尺寸、体积。支持输入工程目录、已解包皮肤目录或 .ssf 文件。结果分 errors/warnings/notes 三级，只有 errors 代表真的坏了。',
        'read',
        {
            type: 'object',
            properties: {
                dir: { type: 'string', description: '工程目录 / 已解包皮肤目录 / .ssf 文件路径（三选一，参数名沿用 dir 以向后兼容）' },
                file: { type: 'string', description: '同 dir，可直接传 .ssf 路径' },
            },
            required: [],
        },
        async (args) => {
            const target = args.file || args.dir;
            if (!target) return { ok: false, error: '请提供 dir（工程目录/皮肤目录）或 file（.ssf 路径）' };
            return validateTarget(abs(target));
        });

    // ---------------- 12. 浮层预设（read）----------------
    reg('skin_overlay_presets',
        '列出从本机 5 个官方内置皮肤里抽出的 *_align 十元组预设，以及目前对十元组语义的逆向结论。做候选窗翻页/展开浮层时从这里取值，不要自己编。',
        'read',
        { type: 'object', properties: {}, additionalProperties: false },
        async () => overlayPresetsInfo());

    // ---------------- 13. 安装到本机（write）----------------
    reg('skin_install',
        '把 .ssf 安装到本机搜狗输入法。默认走引擎自己的安装路径（SGTool.exe → 「安装皮肤」对话框 → 确定），由引擎自动完成复制、重建 skin_v3.dat、切换当前皮肤，不需要重启输入法；找不到 SGTool 时回落为复制到皮肤目录（需用户自己切换/重启）。可用 dryRun 先看会做什么。',
        'write',
        {
            type: 'object',
            properties: {
                file: { type: 'string', description: '.ssf 皮肤包路径' },
                target: { type: 'string', description: '可选：手动指定皮肤目录，覆盖自动探测（仅 copy 模式使用）' },
                mode: {
                    type: 'string', enum: ['auto', 'engine', 'copy'],
                    description: 'auto（默认，优先引擎安装、失败回落复制）/ engine（只走引擎安装）/ copy（只复制）',
                },
                dryRun: { type: 'boolean', description: '只探测与计划，不写文件、不弹窗（默认 false）' },
            },
            required: ['file'],
        },
        async (args) => installSkin({
            file: abs(args.file),
            target: args.target ? abs(args.target) : undefined,
            mode: args.mode || 'auto',
            dryRun: !!args.dryRun,
        }));

    // ---------------- 14. 列出已装（read）----------------
    reg('skin_list_installed',
        '列出本机搜狗输入法皮肤目录里已安装的 .ssf 皮肤（含代际与条目数）。找不到时会给出各版本的常见目录与自行定位方法。',
        'read',
        {
            type: 'object',
            properties: { target: { type: 'string', description: '可选：手动指定皮肤目录' } },
            additionalProperties: false,
        },
        async (args) => listInstalled({ target: args.target ? abs(args.target) : undefined }));

    return { registered: names.length, names, searchedHints: SOGOU_HINTS };
}
