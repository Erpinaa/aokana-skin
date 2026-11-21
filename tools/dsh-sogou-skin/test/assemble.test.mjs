// @ts-check
/**
 * 装配器测试 —— 守住几条"改回去就会重演历史 bug"的硬规矩：
 *
 *  1. 可选面板（bar_mask / 分体底图）只在显式分配时生成，绝不无条件写假的 Scheme_H2/V2；
 *  2. 默认不写 `<按钮>_display` / `layered` / `pic_mask`（真实第三方皮肤都不写）；
 *  3. 不修改传入的工程对象（v0.1.0 会偷偷往 roles 里塞 generate:true 并写回文件）；
 *  4. anchors 生效；2x 素材按逻辑像素落盘；按钮坐标缺省自动排布不重叠；
 *  5. 输出确定（同一个工程 + 固定 skinTime = 相同字节）。
 */
import { join } from 'node:path';
import { assembleProject } from '../src/ops/build.js';
import { loadProject, saveProject } from '../src/ops/project.js';
import { assembleSkin } from '../src/skin/assemble.js';
import { IniDoc, bgrToHex, parseIniNumber } from '../src/ssf/ini.js';
import { decodePng } from '../src/image/png.js';
import { makeDemoProject } from './_fixtures.mjs';
import { tmpDir, eq, ok, t, section, finish } from './_harness.mjs';

/** 从装配结果里取出 Skin.ini 文档。 */
function iniOf(res) {
    return new IniDoc(res.ini);
}
/** 从装配结果里取某个文件。 */
function fileOf(res, name) {
    return res.files.find((f) => f.name === name);
}

/* ---------------- 自建工程 ---------------- */
section('默认装配（自建数据）');
const demo = makeDemoProject({ name: '装配测试' });
const res = demo.assembled;
t('装配成功且 0 error', () => {
    ok(res.ok, res.error);
    eq(res.errors.length, 0, res.errors.join(';'));
    ok(res.files.length > 5);
});
t('只写入声明过的段落：没有 bar_mask / H2 / V2', () => {
    const doc = iniOf(res);
    ok(doc.hasSection('Scheme_H1'));
    ok(doc.hasSection('Scheme_V1'));
    ok(doc.hasSection('StatusBar'));
    ok(!doc.hasSection('Scheme_H2'), '不应写假的 Scheme_H2');
    ok(!doc.hasSection('Scheme_V2'), '不应写假的 Scheme_V2');
    ok(!fileOf(res, 'bar_mask.png'), '不应生成 bar_mask.png');
    ok(!fileOf(res, 'skin2_1.png'), '不应生成分体底图');
    ok(!doc.get('StatusBar', 'pic_mask'), '不应写 pic_mask');
});
t('默认写 <按钮>_display（真机验证：不写按钮不显示），但不写 layered', () => {
    const doc = iniOf(res);
    eq(doc.get('StatusBar', 'cn_en_display'), '1');
    eq(doc.get('StatusBar', 'biaodian_display'), '1');
    ok(!doc.get('Scheme_H1', 'layered'), '默认不应写 layered');
});
t('面板文件名规范且 Skin.ini 引用都存在', () => {
    const doc = iniOf(res);
    const names = new Set(res.files.map((f) => f.name));
    eq(doc.get('Scheme_H1', 'pic'), 'skin1.png');
    eq(doc.get('Scheme_V1', 'pic'), 'skin2.png');
    eq(doc.get('StatusBar', 'pic'), 'bar.png');
    for (const k of ['pic']) {
        ok(names.has(doc.get('Scheme_H1', k)));
        ok(names.has(doc.get('Scheme_V1', k)));
    }
    ok(names.has(doc.get('StatusBar', 'pic')));
    ok(names.has('Skin.ini'));
});
t('真机守护：启用 N 个按钮 → Skin.ini 必须有 N 条 <btn>_display=1', () => {
    const doc = iniOf(res);
    const enabled = ['cn_en', 'biaodian', 'quan_ban'];
    for (const b of enabled) {
        eq(doc.get('StatusBar', b + '_display'), '1', b + ' 缺少 _display（真机上状态栏按钮会整体消失）');
    }
    // 反向：Skin.ini 里出现的 display 条数必须等于启用按钮数
    const displayCount = Object.keys(doc.section('StatusBar')).filter((k) => k.endsWith('_display')).length;
    eq(displayCount, enabled.length);
});
t('[StatusBar] 的第一条键是 pic（保真：与 v0.1/真实皮肤一致）', () => {
    const lines = res.ini.split('\n').map((s) => s.trim()).filter(Boolean);
    const start = lines.indexOf('[StatusBar]');
    ok(start >= 0);
    ok(lines[start + 1].startsWith('pic='), '第一条键应为 pic=，实际 ' + lines[start + 1]);
});
t('三态图标全部生成且尺寸一致（20x20）', () => {
    for (const base of ['cn', 'en', 'a']) {
        for (const suffix of [1, 2, 3]) {
            const f = fileOf(res, base + suffix + '.png');
            ok(f, '缺少 ' + base + suffix + '.png');
            const r = decodePng(f.data);
            eq(r.width, 20);
            eq(r.height, 20);
        }
    }
    const doc = iniOf(res);
    eq(doc.get('StatusBar', 'cn_en'), 'cn1.png,en1.png,a1.png');
    eq(doc.get('StatusBar', 'cn_en_hover'), 'cn2.png,en2.png,a2.png');
    eq(doc.get('StatusBar', 'cn_en_down'), 'cn3.png,en3.png,a3.png');
});
t('按钮坐标缺省时自动排布且互不重叠', () => {
    const doc = iniOf(res);
    const buttons = ['cn_en', 'biaodian', 'quan_ban'];
    const rects = buttons.map((b) => {
        const pos = doc.get('StatusBar', b + '_pos').split(',').map(Number);
        return { b, x: pos[0], y: pos[1] };
    });
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            ok(!(Math.abs(rects[i].x - rects[j].x) < 20 && Math.abs(rects[i].y - rects[j].y) < 20),
                rects[i].b + ' 与 ' + rects[j].b + ' 坐标重叠');
        }
    }
    ok(rects.every((r) => r.x >= 0 && r.y >= 0));
});
t('配色按 BGR 写入 Skin.ini', () => {
    const doc = iniOf(res);
    const raw = doc.get('Display', 'pinyin_color');
    const v = parseIniNumber(raw);
    eq(bgrToHex(v), '#155a60');
});
t('两排文字位置按真机公式写好', () => {
    const doc = iniOf(res);
    const pm = doc.get('Scheme_H1', 'pinyin_marge').split(',').map(Number);
    const zm = doc.get('Scheme_H1', 'zhongwen_marge').split(',').map(Number);
    const fs = parseIniNumber(doc.get('Display', 'font_size'));
    ok(pm[0] > 0, '拼音行应有绝对 y');
    ok(pm[0] + fs + zm[0] > pm[0], '候选行必须在拼音行下方');
    ok(Array.isArray(pm) && pm.length === 4);
});
t('装配器不修改传入的工程对象', () => {
    const dir = tmpDir('no-mutate');
    const d = makeDemoProject({ dir, name: '不可变测试' });
    const before = JSON.stringify(d.project.roles);
    assembleSkin(JSON.parse(JSON.stringify(d.project)), dir);
    eq(JSON.stringify(d.project.roles), before, 'roles 被装配器改写了');
});

/* ---------------- 按需段落 ---------------- */
section('按需生成可选段落');
t('显式分配分体底图后才写 H2/V2', () => {
    const dir = tmpDir('strips');
    const d = makeDemoProject({ dir, name: '分体底图测试' });
    const p = loadProject(dir).project;
    p.roles.strip_h_pinyin = { source: 'assets/panel_h.png' };
    p.roles.strip_h_cand = { source: 'assets/panel_v.png' };
    p.roles.strip_v_cand = { source: 'assets/panel_v.png' };
    saveProject(dir, p);
    const r = assembleProject(dir);
    ok(r.ok);
    const doc = iniOf(r);
    ok(doc.hasSection('Scheme_H2'), '应写 H2');
    ok(doc.hasSection('Scheme_V2'), '应写 V2');
    ok(fileOf(r, 'skin2_1.png'), '应生成分体拼音底图');
});
t('显式开启 useBarMask 后才写 pic_mask', () => {
    const dir = tmpDir('barmask');
    makeDemoProject({ dir, name: '遮罩测试' });
    const p = loadProject(dir).project;
    p.roles.bar_mask = { source: 'assets/bar.png' };
    p.useBarMask = true;
    saveProject(dir, p);
    const r = assembleProject(dir);
    const doc = iniOf(r);
    eq(doc.get('StatusBar', 'pic_mask'), 'bar_mask.png');
});
t('显式 writeDisplay=false 才不写 _display（少数版本不需要时可以关）', () => {
    const dir = tmpDir('display-off');
    makeDemoProject({ dir, name: 'display 测试', writeDisplay: false });
    const r = assembleProject(dir);
    const doc = iniOf(r);
    eq(doc.get('StatusBar', 'cn_en_display'), undefined);
});
t('显式 layered=true 才写 layered', () => {
    const dir = tmpDir('layered');
    makeDemoProject({ dir, name: 'layered 测试' });
    const p = loadProject(dir).project;
    p.layered = true;
    saveProject(dir, p);
    const doc = iniOf(assembleProject(dir));
    eq(doc.get('Scheme_H1', 'layered'), '1');
});

/* ---------------- anchors / 2x / 确定性 ---------------- */
section('anchors / 2x / 确定性');
t('工程 anchors 生效（复刻场景：原版 anchor=100,130）', () => {
    const dir = tmpDir('anchors');
    makeDemoProject({ dir, name: '锚点测试' });
    const p = loadProject(dir).project;
    p.anchors = { Scheme_H1: [100, 130] };
    saveProject(dir, p);
    const doc = iniOf(assembleProject(dir));
    eq(doc.get('Scheme_H1', 'anchor'), '100,130');
});
t('未给 anchors 时按九宫格推导（与真机验证过的行为一致）', () => {
    const dir = tmpDir('anchor-default');
    makeDemoProject({ dir, name: '默认锚点' });
    const res2 = assembleProject(dir);
    const doc = iniOf(res2);
    const anchor = doc.get('Scheme_H1', 'anchor');
    ok(/^\d+,\d+$/.test(anchor), 'anchor 应为 x,y 两个整数，实际 ' + anchor);
    const L = parseInt(doc.get('Scheme_H1', 'layout_horizontal').split(',')[1], 10);
    eq(parseInt(anchor.split(',')[0], 10), Math.round(L / 2));
});
t('assets.scale=2 时素材缩到逻辑像素，Skin.ini 数字不变', () => {
    const dir = tmpDir('scale2');
    makeDemoProject({ dir, name: '2x 测试', scale: 2 });
    const res2 = assembleProject(dir);
    ok(res2.ok, res2.error);
    const panel = fileOf(res2, 'skin1.png');
    const r = decodePng(panel.data);
    eq(r.width, 240, '2x 的 480 宽素材应缩到 240');
    eq(r.height, 120);
    const doc = iniOf(res2);
    // 九宫格数字是逻辑像素（源图 240 宽里的 left=60）
    eq(doc.get('Scheme_H1', 'layout_horizontal').split(',')[1], '60');
});
t('同一工程 + 固定 skinTime 两次装配字节一致', () => {
    const dir = tmpDir('deterministic');
    makeDemoProject({ dir, name: '确定性' });
    const a = assembleProject(dir);
    const b = assembleProject(dir);
    eq(a.files.length, b.files.length);
    for (let i = 0; i < a.files.length; i++) {
        eq(a.files[i].name, b.files[i].name);
        eq(Buffer.from(a.files[i].data).equals(Buffer.from(b.files[i].data)), true, a.files[i].name + ' 两次装配不一致');
    }
    eq(a.ini, b.ini);
});

/* ---------------- 错误处理 ---------------- */
section('错误处理');
t('显式指定的素材缺失 -> error（不是静默占位）', () => {
    const dir = tmpDir('missing-asset');
    makeDemoProject({ dir, name: '缺素材' });
    const p = loadProject(dir).project;
    p.roles.panel_h = { source: 'assets/不存在.png' };
    saveProject(dir, p);
    const r = assembleProject(dir);
    ok(r.errors.some((e) => e.includes('不存在.png')), '应报素材缺失：' + r.errors.join(';'));
});
t('autoGenerate=false 且缺必需面板 -> error', () => {
    const dir = tmpDir('no-auto');
    makeDemoProject({ dir, name: '不自动占位' });
    const p = loadProject(dir).project;
    p.autoGenerate = false;
    delete p.roles.panel_h;
    saveProject(dir, p);
    const r = assembleProject(dir);
    ok(r.errors.some((e) => e.includes('autoGenerate')), '应报缺少必需面板：' + r.errors.join(';'));
});
t('生成的 Skin.ini 不含 undefined / NaN', () => {
    const bad = res.ini.match(/undefined|NaN|\[object Object\]/g);
    eq(bad, null);
});
t('工程不存在时返回可读错误', () => {
    const r = assembleProject(join(tmpDir('nope'), 'missing'));
    eq(r.ok, false);
    ok(/找不到工程文件/.test(r.error));
});

finish();
