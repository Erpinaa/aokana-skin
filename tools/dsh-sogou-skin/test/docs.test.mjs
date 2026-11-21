// @ts-check
/**
 * 文档 / 元数据一致性测试 —— 防"文档里写着一个不存在的东西"（LESSONS 第 18 条）。
 *
 * 检查：
 *  - 版本号在 package.json / dsh.plugin.json / CHANGELOG 三处一致；
 *  - 工具清单在 package.json、dsh.plugin.json、实际注册结果三处一致；
 *  - README 里提到的命令/工具都真实存在，且 README 引用的文件都在仓库里；
 *  - 仓库不含本机绝对路径、皮肤素材、二进制资产、临时文件；
 *  - package.json 的 scripts 指向真实文件；入口/安装 patch 存在。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { apply } from '../src/index.js';
import { COMMANDS, commandNames } from '../src/commands.js';
import { readRepo, repoJson, t, section, finish, eq, ok, deepEq, ROOT, assert } from './_harness.mjs';

const pkg = repoJson('package.json');
const plugin = repoJson('dsh.plugin.json');
const changelog = readRepo('CHANGELOG.md');
const readme = readRepo('README.md');

section('版本与元数据');
t('版本号 0.2.0 且三处一致', () => {
    eq(pkg.version, '0.2.0');
    eq(plugin.version, '0.2.0');
    ok(changelog.includes('## [0.2.0]'), 'CHANGELOG 缺少 0.2.0 章节');
});
t('package.json 基本字段', () => {
    eq(pkg.name, '@dsh-external/dsh-sogou-skin');
    eq(pkg.type, 'module');
    ok(pkg.main && existsSync(join(ROOT, pkg.main)), 'main 指向的文件不存在：' + pkg.main);
    ok(pkg.license === 'MIT');
    ok(pkg.engines && pkg.engines.node, '缺少 engines.node');
    ok(pkg.files.includes('src') && pkg.files.includes('skills') && pkg.files.includes('docs'));
    ok(pkg.files.includes('dsh.plugin.json') && pkg.files.includes('cordis.patch.yml'));
    ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, '运行时不允许第三方依赖');
});
t('scripts 指向真实存在的脚本', () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
        ok(typeof cmd === 'string' && cmd.length > 0, 'script ' + name + ' 为空');
        const m = /node\s+(\S+)/.exec(cmd);
        if (m) ok(existsSync(join(ROOT, m[1])), 'script ' + name + ' 引用了不存在的文件：' + m[1]);
    }
    ok(pkg.scripts.test && pkg.scripts['test:all'], '缺少 test / test:all');
});
t('dsh 插件入口与 bundle patch 存在', () => {
    ok(plugin.id === pkg.name);
    ok(plugin.main && existsSync(join(ROOT, plugin.main)), 'dsh.plugin.json main 不存在');
    eq(pkg.dsh.bundle.patch, './cordis.patch.yml');
    const patch = readRepo('cordis.patch.yml');
    ok(patch.includes(pkg.name), 'cordis.patch.yml 没有引用包名');
    ok(!/11 个 skin_\*/.test(patch), 'cordis.patch.yml 里的工具数注释过期了');
    ok(patch.includes('14 个 skin_*'), 'cordis.patch.yml 应写明 14 个工具');
});
t('package.json 的 dshx.contributes 与 dsh.plugin.json 一致', () => {
    const a = pkg.dshx.contributes.tools;
    const b = plugin.contributes.tools;
    deepEq(a, b);
    deepEq(pkg.dshx.contributes.skills, plugin.contributes.skills);
    eq(plugin.contributes.skills[0], 'sogou-skin-authoring');
});

section('工具清单 = 实际注册结果');
const registered = [];
apply({
    logger: { info() {}, warn() {} },
    tools: { register: (d) => registered.push(d.name) },
    skills: { register: () => () => {} },
    effect: () => {},
}, {});
t('三处工具清单完全一致', () => {
    deepEq(registered, pkg.dshx.contributes.tools);
    deepEq(registered, plugin.contributes.tools);
    eq(registered.length, 14);
});
t('README 的工具表覆盖全部工具', () => {
    for (const name of registered) ok(readme.includes('`' + name + '`'), 'README 缺少工具 ' + name);
});

section('README 的内容');
t('README 提到全部 CLI 命令，且没有写不存在的命令', () => {
    const names = commandNames();
    for (const c of COMMANDS) ok(readme.includes('cli.js ' + c.name), 'README 缺少命令 ' + c.name);
    const mentioned = [...readme.matchAll(/cli\.js ([a-z][a-z-]*)/g)].map((m) => m[1]);
    for (const m of mentioned) ok(names.includes(m), 'README 写了不存在的命令：' + m);
});
t('README 引用的文件全部存在', () => {
    const refs = new Set();
    for (const m of readme.matchAll(/\]\(([^)#]+?)\)/g)) refs.add(m[1]);
    for (const m of readme.matchAll(/src="([^"]+)"/g)) refs.add(m[1]);
    for (const ref of refs) {
        if (/^https?:/.test(ref) || ref.startsWith('#')) continue;
        const p = join(ROOT, ref.split('#')[0]);
        ok(existsSync(p), 'README 引用了不存在的文件：' + ref);
    }
});
t('README 写明零第三方依赖且不含素材', () => {
    ok(readme.includes('零第三方依赖') || readme.includes('零依赖'));
    ok(readme.includes('ASSET_NOTICE.md'));
    ok(/不含任何素材|不包含任何素材/.test(readme));
});
t('README 的测试清单与实际测试文件一致', () => {
    const files = readdirSync(join(ROOT, 'test')).filter((n) => n.endsWith('.test.mjs'));
    ok(files.length >= 10, '测试文件数量 ' + files.length);
    for (const f of files) ok(readme.includes(f) || readme.includes(f.replace('.test.mjs', '')), 'README 没提到测试 ' + f);
});
t('CHANGELOG 记录 v0.2.0 的关键修复（防回归说明）', () => {
    for (const kw of ['v1', '可选面板', 'anchors', '九宫格', '误报', '假通过']) {
        ok(changelog.includes(kw), 'CHANGELOG 0.2.0 缺少关键条目：' + kw);
    }
});

section('仓库卫生');
/** 需要扫描的文本文件（排除 .git、依赖、临时产物目录）。 */
function listTextFiles() {
    const out = [];
    const skipDirs = new Set(['.git', 'node_modules', 'preview', 'build', 'sogou-skins', 'tmp']);
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            const rel = relative(ROOT, full).split('\\').join('/');
            if (rel.startsWith('examples/out/')) continue;
            const st = statSync(full);
            if (st.isDirectory()) { if (!skipDirs.has(name)) walk(full); continue; }
            const ext = extname(name).toLowerCase();
            if (['.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.txt'].includes(ext) || name === '.gitignore') out.push({ rel, full, ext });
        }
    };
    walk(ROOT);
    return out;
}
const textFiles = listTextFiles();
t('没有本机绝对路径（F:\\Deepseek_harness / C:\\Users\\<user>）', () => {
    const bad = [];
    for (const f of textFiles) {
        const text = readFileSync(f.full, 'utf8');
        if (/F:[\\/]Deepseek_harness/.test(text)) bad.push(f.rel + ' (F:\\Deepseek_harness)');
        if (/C:[\\/]Users[\\/]\d+/.test(text)) bad.push(f.rel + ' (C:\\Users\\<user>)');
    }
    assert.deepStrictEqual(bad, []);
});
t('没有皮肤素材 / 立绘 / 二进制资产（docs/images 的代码生成图除外）', () => {
    const forbidden = /\.(ssf|bmp|jpg|jpeg|webp|gif|dat|zip|7z|rar|mp4|wav|pyc)$/i;
    const bad = [];
    for (const f of textFiles) if (forbidden.test(f.rel)) bad.push(f.rel);
    // 二进制图片只允许 docs/images/*.png（由 docs/make-images.mjs 生成）
    const walkImgs = (dir) => {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            const rel = relative(ROOT, full).split('\\').join('/');
            const st = statSync(full);
            if (st.isDirectory()) {
                if (rel.startsWith('examples/out')) continue;
                if (!['.git', 'node_modules', 'preview', 'build'].includes(name)) walkImgs(full);
                continue;
            }
            if (/\.(png|bmp|jpg|jpeg|webp|gif)$/i.test(name) && !/^docs\/images\/[^/]+\.png$/.test(rel)) bad.push(rel);
        }
    };
    walkImgs(ROOT);
    assert.deepStrictEqual(bad, []);
});
t('没有 __pycache__ / node_modules / 临时文件进仓库', () => {
    const bad = textFiles.filter((f) => /__pycache__|node_modules\/|\.tmp$|\.log$|\.bak$/.test(f.rel));
    deepEq(bad.map((f) => f.rel), []);
});
t('.gitignore 挡住了工程产物与素材', () => {
    const gi = readRepo('.gitignore');
    for (const p of ['build/', 'preview/', '*.ssf', 'node_modules/']) ok(gi.includes(p), '.gitignore 缺少 ' + p);
});
t('LICENSE 与 ASSET_NOTICE 存在且口径一致', () => {
    const license = readRepo('LICENSE');
    ok(/MIT License/i.test(license));
    const notice = readRepo('ASSET_NOTICE.md');
    ok(notice.includes('素材'));
    ok(/不包含|不含/.test(notice));
});
t('docs/images 的说明图都由 make-images.mjs 生成', () => {
    ok(existsSync(join(ROOT, 'docs', 'make-images.mjs')));
    const names = readdirSync(join(ROOT, 'docs', 'images')).sort();
    const script = readRepo('docs/make-images.mjs');
    for (const n of names) ok(script.includes(n.replace(/\.png$/, '')), 'make-images.mjs 没有生成 ' + n);
});
t('SKILL.md frontmatter 合格', () => {
    const raw = readRepo('skills/sogou-skin-authoring/SKILL.md');
    const lines = raw.split(/\r?\n/);
    eq(lines[0].trim(), '---');
    const close = lines.indexOf('---', 1);
    ok(close > 1);
    const fm = lines.slice(1, close).join('\n');
    ok(/^name: sogou-skin-authoring$/m.test(fm));
    ok(/^description: .{10,}$/m.test(fm));
});

section('代码卫生');
t('没有 TODO / FIXME / 调试残留', () => {
    for (const f of textFiles.filter((x) => (x.ext === '.js' || x.ext === '.mjs') && x.rel !== 'test/docs.test.mjs')) {
        const text = readFileSync(f.full, 'utf8');
        ok(!/TODO|FIXME|XXX/.test(text), f.rel + ' 里有 TODO/FIXME');
    }
});
t('所有 JS 源文件语法合法（node --check 等价）', () => {
    const { spawnSync } = requireChild();
    const files = textFiles.filter((x) => (x.ext === '.js' || x.ext === '.mjs') && !x.rel.startsWith('examples/out/'));
    ok(files.length > 20, '源文件数量异常：' + files.length);
    for (const f of files) {
        const r = spawnSync(process.execPath, ['--check', f.full], { encoding: 'utf8' });
        eq(r.status, 0, f.rel + ' 语法错误：' + (r.stderr || '').slice(0, 300));
    }
});

import * as child from 'node:child_process';
function requireChild() { return child; }
void dirname;
finish();
