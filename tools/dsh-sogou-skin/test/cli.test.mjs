// @ts-check
/**
 * CLI 契约测试 —— 真的起子进程跑每一条命令。
 *
 * 这一层专门防 LESSONS 第 18 条："文档里写着一个不存在的东西，不会报错"。
 * 帮助文本由 src/commands.js 生成，测试逐条执行命令表里的命令，并核对 README 的清单。
 */
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { COMMANDS, commandNames, commandTable, helpText, parseArgv } from '../src/commands.js';
import { runCli, tmpDir, eq, ok, deepEq, t, section, finish, readRepo } from './_harness.mjs';
import { makeDemoProject } from './_fixtures.mjs';

section('命令表');
t('命令表非空且名字唯一', () => {
    ok(COMMANDS.length >= 14, '命令数 ' + COMMANDS.length);
    eq(new Set(commandNames()).size, COMMANDS.length);
    for (const c of COMMANDS) {
        ok(c.name && c.summary && c.usage, '命令缺少 name/summary/usage');
        ok(typeof c.run === 'function', c.name + ' 缺少 run');
    }
});
t('帮助文本包含全部命令与用法', () => {
    const help = helpText();
    for (const c of commandTable()) {
        ok(help.includes(c.usage), '帮助里缺少用法：' + c.usage);
        ok(help.includes(c.summary), '帮助里缺少摘要：' + c.name);
    }
});
t('parseArgv 支持 --key value / --key=value / 重复 flag', () => {
    const a = parseArgv(['assemble', 'dir', '--format', 'v3', '--out=x.ssf', '--set', 'a=1', '--set', 'b=2']);
    deepEq(a.positionals, ['assemble', 'dir']);
    eq(a.flags.format, 'v3');
    eq(a.flags.out, 'x.ssf');
    deepEq(a.flagList('set'), ['a=1', 'b=2']);
});
t('README 里列出的 CLI 命令与代码一致', () => {
    const readme = readRepo('README.md');
    const names = commandNames();
    // README 的"全部命令"代码块里必须出现每一条命令的 usage 片段
    for (const c of COMMANDS) {
        ok(readme.includes('cli.js ' + c.name), 'README 没有介绍命令 ' + c.name);
    }
    // 反向：README 里出现的 "cli.js xxx" 必须是真实命令
    const mentioned = [...readme.matchAll(/cli\.js ([a-z][a-z-]*)/g)].map((m) => m[1]);
    for (const m of mentioned) ok(names.includes(m), 'README 写了不存在的命令：' + m);
});

section('逐条执行 CLI 命令（子进程）');
const root = tmpDir('cli');
const proj = join(root, 'proj');
const ssf = join(root, 'out.ssf');
const un = join(root, 'unpacked');
const installDir = tmpDir('cli-install');

const R = (args) => runCli(args);
t('--help 退出码 0 且打印命令表', () => {
    const r = R(['--help']);
    eq(r.code, 0);
    ok(r.stdout.includes('DSH 搜狗皮肤工坊 CLI'));
});
t('--version 打印版本号', () => {
    const r = R(['--version']);
    eq(r.code, 0);
    ok(/dsh-sogou-skin \d+\.\d+\.\d+/.test(r.stdout), r.stdout.trim());
});
t('未知命令退出码 2', () => {
    const r = R(['definitely-not-a-command']);
    eq(r.code, 2);
    ok(r.stderr.includes('未知命令'));
});
t('requirements --json 输出合法 JSON', () => {
    const r = R(['requirements', '--json']);
    eq(r.code, 0);
    const info = JSON.parse(r.stdout);
    ok(info.ok);
    ok(info.groups.length >= 3);
    ok(info.minimal.slots.includes('panel_h'));
});
t('init 创建工程', () => {
    const r = R(['init', proj, '--name', 'CLI 测试', '--author', '测试']);
    eq(r.code, 0, r.stderr);
    ok(existsSync(join(proj, 'skin.project.json')));
    ok(existsSync(join(proj, 'assets')));
    ok(existsSync(join(proj, 'preview')));
});
t('scan 扫描空素材目录不崩', () => {
    const r = R(['scan', proj, '--json']);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    eq(info.count, 0);
});
// 给工程塞一套自建素材（用夹具的临时工程，避免手写素材）
const demo = makeDemoProject({ name: 'CLI 素材' });
const assetNames = readdirSync(join(demo.dir, 'assets'));
for (const n of assetNames) {
    // 直接复制文件
    const { copyFileSync } = requireFs();
    copyFileSync(join(demo.dir, 'assets', n), join(proj, 'assets', n));
}
t('assemble --json 装配成功', () => {
    const r = R(['assemble', proj, '--json']);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    ok(info.ok);
    ok(info.fileCount > 5);
});
t('validate --json 退出码 0 + ok:true', () => {
    const r = R(['validate', proj, '--json']);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    eq(info.ok, true);
    eq(info.errors.length, 0);
});
t('preview --json 生成 7 个产物', () => {
    const r = R(['preview', proj, '--json']);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    ok(info.ok);
    for (const k of ['render', 'zoom', 'bgcheck', 'stretch', 'assets', 'preview', 'report']) {
        ok(existsSync(info.paths[k]), k + ' 缺失');
    }
});
t('pack --json 打包 zip 并回读', () => {
    const r = R(['pack', proj, '--json', '--out', ssf]);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    ok(info.ok);
    eq(info.format, 'zip');
    ok(existsSync(ssf));
});
t('pack --format v3 打包加密代际', () => {
    const v3 = join(root, 'out.store.ssf');
    const r = R(['pack', proj, '--json', '--format', 'v3', '--out', v3]);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    eq(info.format, 'v3');
    eq(JSON.parse(R(['inspect', v3, '--json']).stdout).format, 'v3');
});
t('inspect --json 列出条目与 Skin.ini', () => {
    const r = R(['inspect', ssf, '--json']);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    ok(info.ok);
    ok(info.entries > 5);
    ok(info.ini.includes('[General]'));
});
t('unpack 解包并可 validate', () => {
    const r = R(['unpack', ssf, un]);
    eq(r.code, 0, r.stderr);
    ok(existsSync(join(un, 'Skin.ini')));
    ok(existsSync(join(un, 'Skin.ini.utf8.txt')));
    const v = R(['validate', un, '--json']);
    eq(v.code, 0, v.stderr);
});
t('repair 串联两个操作生成新图', () => {
    const src = join(proj, 'assets', 'cn.png');
    const out = join(root, 'icon.fixed.png');
    const r = R(['repair', src, '--op', '{"op":"trim"}', '--op', '{"op":"containFit","width":20,"height":20}', '--out', out, '--json']);
    eq(r.code, 0, r.stderr);
    ok(existsSync(out));
    const info = JSON.parse(r.stdout);
    eq(info.size, '20x20');
});
t('install --dry-run 不写文件', () => {
    const r = R(['install', ssf, '--dry-run', '--mode', 'copy', '--target', installDir, '--json']);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    eq(info.dryRun, true);
    eq(existsSync(join(installDir, 'out.ssf')), false);
});
t('install --mode copy 真复制 + list 能列出', () => {
    const r = R(['install', ssf, '--mode', 'copy', '--target', installDir, '--json']);
    eq(r.code, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    eq(info.method, 'copy');
    ok(existsSync(join(installDir, 'out.ssf')));
    const l = R(['list', '--target', installDir, '--json']);
    eq(l.code, 0, l.stderr);
    eq(JSON.parse(l.stdout).total, 1);
});
t('overlay-presets --json 给出 15 组预设', () => {
    const r = R(['overlay-presets', '--json']);
    eq(r.code, 0);
    const info = JSON.parse(r.stdout);
    eq(Object.keys(info.presets).length, 15);
});
t('demo 一条龙生成工程+预览+皮肤包', () => {
    const dir = join(root, 'demo');
    const r = R(['demo', dir]);
    eq(r.code, 0, r.stderr);
    ok(existsSync(join(dir, 'skin.project.json')));
    ok(existsSync(join(dir, 'preview', 'render.png')));
    const ssfs = readdirSync(dir).filter((n) => n.endsWith('.ssf'));
    eq(ssfs.length, 1);
    const v = R(['validate', join(dir, ssfs[0]), '--json']);
    eq(v.code, 0, v.stderr);
});
t('validate 对坏目录返回非零退出码', () => {
    const bad = join(root, 'bad');
    requireFs().mkdirSync(bad, { recursive: true });
    const r = R(['validate', bad]);
    eq(r.code, 1);
    ok(r.stdout.includes('[错误]'));
});

import * as fsMod from 'node:fs';
function requireFs() { return fsMod; }
finish();
