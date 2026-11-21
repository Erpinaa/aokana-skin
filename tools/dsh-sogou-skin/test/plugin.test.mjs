// @ts-check
/**
 * 插件契约测试：注册 14 个工具 + 1 个技能；参数 schema 合法；每个工具真能执行；
 * 工具出错时返回 `{ok:false,error}` 而不是抛异常（模型侧不会被异常打断）。
 */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { apply, parseSkillMarkdown, name, inject, defaultConfig } from '../src/index.js';
import { encodePng } from '../src/image/png.js';
import { create, fillRect } from '../src/image/raster.js';
import { makeDemoProject } from './_fixtures.mjs';
import { readRepo, tmpDir, eq, ok, deepEq, t, section, finish, ta, writeBin } from './_harness.mjs';

const TOOL_NAMES = [
    'skin_requirements', 'skin_init', 'skin_scan_assets', 'skin_assign', 'skin_assemble',
    'skin_preview', 'skin_repair', 'skin_pack', 'skin_inspect', 'skin_unpack',
    'skin_validate', 'skin_overlay_presets', 'skin_install', 'skin_list_installed',
];

/** 建立假的 DSH ctx，收集注册结果。 */
function makeCtx() {
    /** @type {any[]} */
    const tools = [];
    /** @type {any[]} */
    const skills = [];
    let effects = 0;
    const ctx = {
        logger: { info() {}, warn() {} },
        tools: { register: (def) => tools.push(def) },
        skills: { register: (spec) => { skills.push(spec); return () => {}; } },
        effect: () => { effects++; },
    };
    const ret = apply(ctx, { projectsRoot: tmpDir('projects-root') });
    return { ctx, tools, skills, ret, effects: () => effects };
}

const { tools, skills, ret } = makeCtx();
const byName = new Map(tools.map((t2) => [t2.name, t2]));

section('注册');
t('插件元信息', () => {
    eq(name, '@dsh-external/dsh-sogou-skin');
    deepEq(inject, ['tools', 'skills']);
    eq(defaultConfig.projectsRoot, '');
});
t('注册恰好 14 个工具，名字与约定一致', () => {
    eq(tools.length, 14);
    deepEq(tools.map((t2) => t2.name).sort(), [...TOOL_NAMES].sort());
    eq(ret.tools.length, 14);
});
t('每个工具有中文描述、合法 parameters schema、执行函数', () => {
    for (const tool of tools) {
        ok(typeof tool.description === 'string' && tool.description.length > 12, tool.name + ' 描述太短');
        ok(/[\u4e00-\u9fa5]/.test(tool.description), tool.name + ' 描述应为中文（对模型友好）');
        ok(tool.parameters && typeof tool.parameters === 'object', tool.name + ' 缺少 parameters');
        eq(tool.parameters.type, 'object');
        ok(typeof tool.execute === 'function', tool.name + ' 缺少 execute');
        ok(tool.output && typeof tool.output.render === 'function', tool.name + ' 缺少 output.render');
        ok(['read', 'write', 'destroy', 'idempotent'].includes(tool.behavior), tool.name + ' behavior 非法');
    }
});
t('只读工具有 isConcurrencySafe，写工具没有', () => {
    for (const tool of tools) {
        if (tool.behavior === 'read') ok(typeof tool.isConcurrencySafe === 'function', tool.name);
        else eq(tool.isConcurrencySafe, undefined, tool.name);
    }
});
t('技能 sogou-skin-authoring 注册成功且带目录资源', () => {
    eq(skills.length, 1);
    eq(skills[0].name, 'sogou-skin-authoring');
    ok(skills[0].description.length > 20);
    ok(skills[0].content.includes('搜狗皮肤'), '技能正文应包含工作流内容');
    eq(skills[0].source, 'bundled');
    ok(skills[0].resourceBase.path.endsWith('sogou-skin-authoring'));
    eq(skills[0].invocation.modelInvocable, true);
});
t('SKILL.md frontmatter 可解析', () => {
    const raw = readRepo('skills/sogou-skin-authoring/SKILL.md');
    const parsed = parseSkillMarkdown(raw);
    ok(parsed, 'frontmatter 解析失败');
    eq(parsed.name, 'sogou-skin-authoring');
    ok(parsed.description.length > 10);
    ok(parsed.body.length > 1000);
});
t('ctx.tools 不可用时安全降级（返回 registered: 0）', () => {
    const r = apply({ logger: { info() {}, warn() {} } }, {});
    eq(r.tools.length, 0);
});

section('14 个工具实跑（自建工程）');
const demo = makeDemoProject({ name: '工具测试' });
const projectDir = demo.dir;
const run = async (toolName, args) => byName.get(toolName).execute(args);
const outSsf = join(tmpDir('tool-pack'), 'tool.ssf');
const unpackDir = join(tmpDir('tool-unpack'), 'skin');
const iconPng = join(tmpDir('tool-repair'), 'icon.png');
const iconRaster = create(20, 20);
fillRect(iconRaster, 2, 2, 16, 16, [20, 180, 120, 255]);
writeBin(iconPng, encodePng(iconRaster));
const installTarget = tmpDir('tool-install-target');
const actions = [
    ['skin_requirements', {}, 'read'],
    ['skin_overlay_presets', {}, 'read'],
    ['skin_scan_assets', { dir: projectDir }, 'read'],
    ['skin_assemble', { dir: projectDir }, 'write'],
    ['skin_validate', { dir: projectDir }, 'read'],
    ['skin_preview', { dir: projectDir }, 'write'],
    ['skin_pack', { dir: projectDir, out: outSsf, format: 'v3' }, 'write'],
    ['skin_inspect', { file: outSsf }, 'read'],
    ['skin_unpack', { file: outSsf, outDir: unpackDir }, 'write'],
    ['skin_validate', { file: outSsf }, 'read'],
    ['skin_repair', { src: iconPng, ops: [{ op: 'trim' }, { op: 'containFit', width: 20, height: 20 }] }, 'write'],
    ['skin_install', { file: outSsf, dryRun: true, mode: 'copy', target: installTarget }, 'write'],
    ['skin_list_installed', { target: installTarget }, 'read'],
    ['skin_init', { dir: join(tmpDir('tool-init'), 'new') }, 'write'],
    ['skin_assign', { dir: join(tmpDir('tool-init'), 'new'), assignments: [{ slot: 'panel_h', generate: true }] }, 'write'],
];
for (const [toolName, args, behavior] of actions) {
    await ta('执行 ' + toolName + '（' + behavior + '）', async () => {
        const tool = byName.get(toolName);
        ok(tool, '工具未注册：' + toolName);
        const r = await tool.execute(args);
        ok(r && typeof r === 'object', toolName + ' 没有返回对象');
        eq(r.ok, true, toolName + ' 返回失败：' + (r.error || JSON.stringify(r.errors || r.warnings)));
    });
}
await ta('skin_assign 未知槽位返回 ok:false（不抛异常）', async () => {
    const r = await byName.get('skin_assign').execute({ dir: projectDir, assignments: [{ slot: 'nope', source: 'a.png' }] });
    eq(r.ok, false);
    ok(r.error || r.errors.length);
});
await ta('skin_validate 缺参数时给可读错误', async () => {
    const r = await byName.get('skin_validate').execute({});
    eq(r.ok, false);
    ok(/dir|file/.test(r.error));
});
await ta('skin_pack 遇到不存在的目录返回 ok:false', async () => {
    const r = await byName.get('skin_pack').execute({ dir: join(tmpDir('none'), 'nope') });
    eq(r.ok, false);
    ok(r.error);
});
await ta('skin_install dryRun 不写文件、不弹窗', async () => {
    const r = await byName.get('skin_install').execute({ file: outSsf, dryRun: true, mode: 'copy', target: installTarget });
    eq(r.ok, true);
    eq(r.dryRun, true);
    eq(existsSync(join(installTarget, 'tool.ssf')), false, 'dryRun 不应写文件');
});
await ta('skin_list_installed 能列出刚复制的皮肤', async () => {
    const first = await byName.get('skin_install').execute({ file: outSsf, mode: 'copy', target: installTarget });
    ok(first.ok, first.error);
    eq(first.method, 'copy');
    const list = await byName.get('skin_list_installed').execute({ target: installTarget });
    eq(list.total, 1);
    eq(list.dirs[0].skins[0].format, 'v3');
});


finish();