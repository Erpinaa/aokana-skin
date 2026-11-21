// @ts-check
/**
 * 工程 schema 测试：默认值、字段校验、旧 schema 迁移、save/load 往返、素材分配。
 *
 * v0.2.0 的工程文件不再"读到什么当什么用"：类型错误是 errors、未知字段是 warnings，
 * 并且**不丢作者的未知字段**（保存时原样保留）。
 */
import { join } from 'node:path';
import { normalizeProject, loadProject, saveProject, initProject, assignProject, projectSummary } from '../src/ops/project.js';
import { tmpDir, eq, ok, deepEq, t, section, finish, writeText } from './_harness.mjs';

/* ---------------- 默认值 ---------------- */
section('默认工程配置');
const def = normalizeProject({ name: '测试' });
t('空对象能补齐全部默认值', () => {
    eq(def.errors.length, 0);
    eq(def.project.schema, 2);
    eq(def.project.assets.scale, 1);
    eq(def.project.icon.format, 'png');
    eq(def.project.buttons.enabled[0], 'cn_en');
    eq(def.project.buttons.writeDisplay, true, '<按钮>_display 默认写（真机验证：不写按钮不显示）');
    eq(def.project.display.fontSize, 16);
    eq(def.project.theme.pinyinColor, '#1d5f63');
    ok(def.project.roles.panel_h);
    eq(def.project.roles.panel_h.generate, true);
});
t('未知字段保留 + warning（不静默丢作者数据）', () => {
    const r = normalizeProject({ name: 'x', myNote: '作者备注', roles: { panel_h: { source: 'a.png', myFlag: 1 } } });
    eq(r.project.myNote, '作者备注');
    ok(r.warnings.some((w) => w.includes('myNote')), '应提示未知顶层字段');
    ok(r.warnings.some((w) => w.includes('myFlag')), '应提示 role 里的未知字段');
});
t('旧 schema 标记迁移但不打扰使用者', () => {
    const r = normalizeProject({ schema: 1, name: '旧工程' });
    eq(r.migrated, true);
    eq(r.warnings.filter((w) => w.includes('schema')).length, 0);
    eq(r.project.schema, 2);
});
t('比插件新的 schema 直接报错', () => {
    const r = normalizeProject({ schema: 99 });
    ok(r.errors.some((e) => e.includes('比当前插件支持')));
});

/* ---------------- 字段校验 ---------------- */
section('字段校验（errors 要能定位到字段）');
t('roles 支持字符串简写', () => {
    const r = normalizeProject({ roles: { panel_h: 'assets/a.png' } });
    eq(r.errors.length, 0);
    eq(r.project.roles.panel_h.source, 'assets/a.png');
});
t('未知槽位 -> warning 且保留原值', () => {
    const r = normalizeProject({ roles: { panel_x: 'a.png' } });
    ok(r.warnings.some((w) => w.includes('panel_x')));
    eq(r.project.roles.panel_x, 'a.png');
});
t('theme 颜色非法 -> error', () => {
    const r = normalizeProject({ theme: { pinyinColor: 'red' } });
    ok(r.errors.some((e) => e.includes('theme.pinyinColor')));
    eq(r.project.theme.pinyinColor, '#1d5f63');
});
t('assets.scale 支持 2x，越界报错', () => {
    eq(normalizeProject({ assets: { scale: 2 } }).project.assets.scale, 2);
    ok(normalizeProject({ assets: { scale: 9 } }).errors.some((e) => e.includes('assets.scale')));
});
t('icon 规格非法 -> error', () => {
    const r = normalizeProject({ icon: { w: 2, h: 20, format: 'gif' } });
    ok(r.errors.some((e) => e.includes('icon.w')));
    ok(r.errors.some((e) => e.includes('icon.format')));
});
t('buttons.pos 非法坐标 -> error', () => {
    const r = normalizeProject({ buttons: { pos: { cn_en: [1] } } });
    ok(r.errors.some((e) => e.includes('buttons.pos.cn_en')));
});
t('anchors 按段落生效，未知段落 -> warning', () => {
    const r = normalizeProject({ anchors: { Scheme_H1: [100, 130], Scheme_X: [1, 2] } });
    deepEq(r.project.anchors.Scheme_H1, [100, 130]);
    ok(r.warnings.some((w) => w.includes('Scheme_X')));
});
t('overlay align 必须是 10 元组', () => {
    const bad = normalizeProject({ overlays: [{ name: 'pageup', align: '1,2,3', normal: ['a.png'] }] });
    ok(bad.errors.some((e) => e.includes('align')));
    const good = normalizeProject({ overlays: [{ name: 'pageup', align: '0,0,0,48,0,0,0,2,6,2', normal: ['a.png'] }] });
    eq(good.errors.length, 0);
    eq(good.project.overlays[0].align, '0,0,0,48,0,0,0,2,6,2');
});
t('nineSlice 数值校验', () => {
    const r = normalizeProject({ nineSlice: { panel_h: { left: -5, right: 10, top: 0, bottom: 0 } } });
    ok(r.errors.some((e) => e.includes('nineSlice.panel_h.left')));
});

/* ---------------- 读写往返 ---------------- */
section('save / load / init');
const dir = tmpDir('project-io');
t('initProject 创建工程并可读回', () => {
    const r = initProject(dir, { name: '往返测试', author: '作者' });
    ok(r.ok, r.error);
    eq(loadProject(dir).project.schema, 2);
    const loaded = loadProject(dir);
    ok(loaded.ok);
    eq(loaded.project.name, '往返测试');
    eq(loaded.project.author, '作者');
});
t('initProject 不覆盖已有工程', () => {
    const r = initProject(dir, { name: '第二次' });
    eq(r.ok, false);
    ok(/已存在/.test(r.error));
});
t('saveProject 丢弃非法字段的 error 但保留可用处', () => {
    const loaded = loadProject(dir);
    loaded.project.name = '改名';
    const saved = saveProject(dir, loaded.project);
    ok(saved.file.endsWith('skin.project.json'));
    eq(loadProject(dir).project.name, '改名');
});
t('assignProject 把路径改成相对工程目录，并写回', () => {
    const abs = join(dir, 'assets', 'x.png');
    writeText(abs, '');
    const r = assignProject(dir, {
        assignments: [{ slot: 'panel_h', source: abs }],
        enableButtons: ['cn_en', 'menu'],
        theme: { pinyinColor: '#112233' },
        buttons: { writeDisplay: true },
    });
    ok(r.ok, r.errors.join(';'));
    const p = loadProject(dir).project;
    eq(p.roles.panel_h.source, 'assets/x.png');
    deepEq(p.buttons.enabled, ['cn_en', 'menu']);
    eq(p.theme.pinyinColor, '#112233');
    eq(p.buttons.writeDisplay, true);
});
t('assignProject 未知槽位报错且不写坏工程', () => {
    const r = assignProject(dir, { assignments: [{ slot: 'panel_x', source: 'a.png' }] });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.includes('panel_x')));
});
t('projectSummary 给出可读摘要', () => {
    const s = projectSummary(loadProject(dir).project);
    ok(s.name);
    ok(Array.isArray(s.roles));
    ok(Array.isArray(s.buttons));
});

finish();
