// @ts-check
/**
 * 安装到本机搜狗输入法 —— v0.2.0 起支持**引擎自己完成安装**的真实路径。
 *
 * 两条路：
 *
 *  ① `engine`（推荐，ime-verifier 实测有效）：
 *     `SGTool.exe -line 0 -border --appid=skinreg -install "<x.ssf>"`
 *     → 弹出标准 Win32 对话框 #32770「安装皮肤」→ 点「确定」(控件 id=1)
 *     → **引擎自己**把 .ssf 复制进 AllSkin、重建 skin_v3.dat、更新 env.ini 的
 *       ActiveSkinName、更新 SkinRecent.ini。不需要重启输入法。
 *     注意：`skin_v3.dat` 不是"渲染缓存"，只是引擎持久化的皮肤数据快照；
 *     引擎进程常驻内存持有皮肤，所以**手改文件/删缓存都不会让前台应用重载**，
 *     只有走引擎自己的安装流程才会触发重载。
 *
 *  ② `copy`（兜底）：直接把 .ssf 复制进皮肤目录。新装的皮肤要重启输入法才会被扫描到，
 *     而且**不会**切换当前皮肤 —— 适合"先放进去、用户自己切"的场景。
 *
 * 安全约束：只做安装/复制，不碰注册表、不改用户配置；对话框只会点 id=1 的「确定」。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { inspectSsf } from './build.js';
import { resolveFrom } from '../util/fs.js';
import { formatBytes } from '../util/text.js';

/** 找不到皮肤目录时给用户的定位指引（原样输出，别删）。 */
export const SOGOU_HINTS = [
    '标准版搜狗：%APPDATA%\\SogouInput\\AllSkin 或 <安装目录>\\AllSkin',
    '搜狗医生版：%USERPROFILE%\\AppData\\LocalLow\\SogouYS\\AllSkin（注意是 LocalLow，不是 Local）',
    '部分版本：%LOCALAPPDATA%\\SogouInput\\AllSkin',
    '找不到时：打开搜狗输入法 → 属性设置 → 外观 → 皮肤，看"皮肤管理"里的路径；或在文件管理器搜 AllSkin。',
];

/**
 * 计算候选的搜狗用户数据根目录（只算路径，不判断存在）。
 * @param {Record<string,string|undefined>} env
 * @param {string} [platform]
 * @returns {string[]}
 */
export function candidateRoots(env = process.env, platform = process.platform) {
    /** @type {string[]} */
    const roots = [];
    const home = env.USERPROFILE || env.HOME || '';
    const localLow = (() => {
        if (env.LOCALAPPDATA) return env.LOCALAPPDATA.replace(/[\\/]Local[\\/]?$/i, '') + '\\LocalLow';
        if (home) return join(home, 'AppData', 'LocalLow');
        return '';
    })();
    if (platform === 'win32') {
        // ① 程序安装目录（部分版本把皮肤直接装在版本子目录下）
        roots.push(
            'C:\\Program Files (x86)\\SogouYSInput',
            'C:\\Program Files\\SogouYSInput',
            'C:\\Program Files (x86)\\SogouInput',
            'C:\\Program Files\\SogouInput',
            'D:\\SogouInput',
        );
        // ② 标准版用户数据
        if (env.APPDATA) roots.push(join(env.APPDATA, 'SogouInput'), join(env.APPDATA, 'SogouYS'));
        if (env.LOCALAPPDATA) roots.push(join(env.LOCALAPPDATA, 'SogouInput'), join(env.LOCALAPPDATA, 'SogouYS'));
        // ③ LocalLow —— 实测有效：医生版把用户皮肤放在 LocalLow\SogouYS\AllSkin
        if (localLow) roots.push(join(localLow, 'SogouYS'), join(localLow, 'SogouInput'));
    } else if (platform === 'darwin') {
        if (home) roots.push(join(home, 'Library', 'Application Support', 'SogouInput'));
        roots.push('/Library/Application Support/SogouInput');
    } else {
        if (home) roots.push(join(home, '.config', 'sogou'), join(home, '.sogouinput'));
    }
    return [...new Set(roots.filter(Boolean))];
}

/**
 * 探测本机实际存在的皮肤目录。
 * @param {{env?:Record<string,string|undefined>, platform?:NodeJS.Platform,
 *          exists?:(p:string)=>boolean, readdir?:(p:string)=>string[],
 *          roots?:string[]}} [opts]
 * @returns {{dirs:string[], searched:string[]}}
 */
export function detectSkinDirs(opts = {}) {
    const env = opts.env ?? process.env;
    const platform = opts.platform ?? process.platform;
    const exists = opts.exists ?? existsSync;
    const readdir = opts.readdir ?? readdirSync;
    const roots = opts.roots ?? candidateRoots(env, platform);
    /** @type {string[]} */
    const dirs = [];
    for (const root of roots) {
        if (!root || !exists(root)) continue;
        const direct = join(root, 'AllSkin');
        if (exists(direct)) dirs.push(direct);
        try {
            for (const sub of readdir(root)) {
                const p = join(root, sub, 'AllSkin');
                if (exists(p)) dirs.push(p);
            }
        } catch { /* 没权限就跳过 */ }
    }
    return { dirs: [...new Set(dirs)], searched: roots };
}

/**
 * 在本机安装目录里找 SGTool.exe（引擎的安装器入口）。
 * @param {{roots?:string[], platform?:NodeJS.Platform, exists?:(p:string)=>boolean,
 *          readdir?:(p:string)=>string[]}} [opts]
 * @returns {string|null}
 */
export function detectSgtool(opts = {}) {
    const platform = opts.platform ?? process.platform;
    if (platform !== 'win32') return null;
    const exists = opts.exists ?? existsSync;
    const readdir = opts.readdir ?? readdirSync;
    const roots = opts.roots ?? candidateRoots({ ...process.env }, platform).filter((r) => /Sogou(YS)?Input/i.test(r));
    /** 在 root、root\*、root\*\* 里找 SGTool.exe */
    const findIn = (dir, depth) => {
        if (!exists(dir)) return null;
        const direct = join(dir, 'SGTool.exe');
        if (exists(direct)) return direct;
        if (depth <= 0) return null;
        let names = [];
        try { names = readdir(dir); } catch { return null; }
        // 版本号目录多半排在后面；倒序遍历一次即可
        for (const n of names) {
            const p = join(dir, n);
            let st;
            try { st = statSync(p); } catch { continue; }
            if (!st.isDirectory()) continue;
            const hit = findIn(p, depth - 1);
            if (hit) return hit;
        }
        return null;
    };
    for (const root of roots) {
        const hit = findIn(root, 2);
        if (hit) return hit;
    }
    return null;
}

/**
 * 生成"调用 SGTool 并点确定"的 PowerShell 脚本。
 *
 * 纯 Win32 API（user32.dll）：
 *  - `FindWindow` 找 `#32770` 对话框（标题含「安装皮肤」，兼容中英文）；
 *  - `GetDlgItem(hwnd, 1)` 拿「确定」按钮；
 *  - `SendMessage(btn, BM_CLICK=0x00F5, 0, 0)` 点击。
 *
 * 之所以用 PowerShell 而不是 Node 原生：零依赖约束下，Node 无法直接调 user32。
 * @param {string} sgtool @param {string} ssfFile @param {{timeoutMs?:number}} [opts]
 */
export function buildEngineInstallScript(sgtool, ssfFile, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 30000;
    const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    return `
$ErrorActionPreference = 'Stop'
$src = ${q(sgtool)}
$ssf = ${q(ssfFile)}
$timeoutMs = ${timeoutMs}
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
}
"@
function Find-InstallDialog() {
  $script:found = [IntPtr]::Zero
  $cb = [Win32+EnumWindowsProc]{
    param($h, $l)
    if ($h -ne [IntPtr]::Zero) {
      $cls = New-Object System.Text.StringBuilder 256
      [Win32]::GetClassName($h, $cls, 256) | Out-Null
      if ($cls.ToString() -eq '#32770') {
        $t = New-Object System.Text.StringBuilder 512
        [Win32]::GetWindowText($h, $t, 512) | Out-Null
        $title = $t.ToString()
        if ($title -match '安装|install' -or $title -eq '') { $script:found = $h; return $false }
      }
    }
    return $true
  }
  [Win32]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
  return $script:found
}
$proc = Start-Process -FilePath $src -ArgumentList @('-line','0','-border','--appid=skinreg','-install',$ssf) -PassThru
$deadline = (Get-Date).AddMilliseconds($timeoutMs)
$hwnd = [IntPtr]::Zero
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 150
  $hwnd = Find-InstallDialog
  if ($hwnd -ne [IntPtr]::Zero) { break }
  if ($proc.HasExited -and $hwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 400; $hwnd = Find-InstallDialog; if ($hwnd -ne [IntPtr]::Zero) { break } }
}
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output (@{ ok = $false; reason = 'no-dialog'; exited = $proc.HasExited; exitCode = $(if ($proc.HasExited) { $proc.ExitCode } else { $null }) } | ConvertTo-Json -Compress)
  exit 0
}
$btn = [Win32]::GetDlgItem($hwnd, 1)
if ($btn -eq [IntPtr]::Zero) {
  Write-Output (@{ ok = $false; reason = 'no-ok-button'; hwnd = $hwnd.ToInt64() } | ConvertTo-Json -Compress)
  exit 0
}
[Win32]::SendMessage($btn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
# 等安装收尾（引擎写 AllSkin / skin_v3.dat / env.ini）
$proc.WaitForExit(8000) | Out-Null
Start-Sleep -Milliseconds 600
Write-Output (@{ ok = $true; hwnd = $hwnd.ToInt64(); button = $btn.ToInt64(); clicked = $true; exited = $proc.HasExited } | ConvertTo-Json -Compress)
`.trim();
}

/**
 * 跑一段 PowerShell 脚本并解析它输出的最后一行 JSON。
 * @param {string} script @param {{spawnImpl?:Function}} [opts]
 * @returns {Promise<{ok:boolean, data?:any, error?:string, raw?:string}>}
 */
async function runPowerShell(script, opts = {}) {
    const spawnImpl = opts.spawnImpl || spawn;
    return await new Promise((resolve) => {
        /** @type {string[]} */
        const out = [];
        let err = '';
        let child;
        try {
            child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) {
            resolve({ ok: false, error: '无法启动 powershell.exe：' + String(e) });
            return;
        }
        if (child.stdout) child.stdout.on('data', (d) => out.push(String(d)));
        if (child.stderr) child.stderr.on('data', (d) => { err += String(d); });
        child.on('error', (e) => resolve({ ok: false, error: 'powershell 启动失败：' + String(e) }));
        child.on('close', (code) => {
            const raw = out.join('').trim();
            const lines = raw.split(/\r?\n/).filter(Boolean);
            let data = null;
            for (let i = lines.length - 1; i >= 0; i--) {
                try { data = JSON.parse(lines[i]); break; } catch { /* 继续找 */ }
            }
            resolve({ ok: code === 0 && !!data, data, error: err.trim() || undefined, raw });
        });
    });
}

/**
 * 引擎安装路径：SGTool → 安装皮肤对话框 → 确定。
 * @param {{file:string, sgtool?:string|null, timeoutMs?:number,
 *          detectOpts?:any, spawnImpl?:Function}} args
 */
export async function installViaEngine(args) {
    const sgtool = args.sgtool !== undefined ? args.sgtool : detectSgtool(args.detectOpts || {});
    if (!sgtool) return { ok: false, error: '没有找到 SGTool.exe（搜狗安装器入口），无法走引擎安装' };
    if (!existsSync(sgtool)) return { ok: false, error: 'SGTool.exe 不存在：' + sgtool };
    const script = buildEngineInstallScript(sgtool, args.file, { timeoutMs: args.timeoutMs });
    const r = await runPowerShell(script, { spawnImpl: args.spawnImpl });
    if (!r.ok) return { ok: false, error: r.error || 'powershell 执行失败', raw: r.raw };
    const data = r.data || {};
    if (!data.ok) {
        return {
            ok: false,
            sgtool,
            error: data.reason === 'no-dialog'
                ? 'SGTool 没有弹出「安装皮肤」对话框（可能被安全软件拦截，或该 .ssf 已被引擎拒绝）'
                : '没找到安装对话框的「确定」按钮（控件 id=1）',
            detail: data,
        };
    }
    return { ok: true, method: 'engine', sgtool, dialog: { hwnd: data.hwnd, button: data.button, clicked: !!data.clicked } };
}

/**
 * 复制路径（兜底）：把 .ssf 复制进皮肤目录。需要重启输入法才会被扫描到。
 * @param {{file:string, targets:string[], dryRun?:boolean}} args
 */
export function installViaCopy(args) {
    const written = [];
    for (const dir of args.targets) {
        const dest = join(dir, basename(args.file));
        if (args.dryRun) { written.push({ dir, dest, written: false, exists: existsSync(dest) }); continue; }
        try {
            mkdirSync(dir, { recursive: true });
            copyFileSync(args.file, dest);
            written.push({ dir, dest, written: true, exists: true });
        } catch (e) {
            written.push({ dir, dest, written: false, error: String(e && e.message ? e.message : e) });
        }
    }
    return written;
}

/**
 * 安装一个 .ssf。
 *
 * 模式：
 *  - `auto`（默认）：优先引擎安装；失败回落复制，并在结果里说明；
 *  - `engine`：只走引擎安装（真实"安装并切换"路径）；
 *  - `copy`：只复制（旧行为，需要用户自己重启/切换）。
 *
 * @param {{file:string, target?:string, dryRun?:boolean, mode?:'auto'|'engine'|'copy',
 *          env?:Record<string,string|undefined>, platform?:NodeJS.Platform,
 *          roots?:string[], sgtool?:string|null, detectOpts?:any,
 *          spawnImpl?:Function, timeoutMs?:number}} args
 * @returns {Promise<any>}
 */
export async function installSkin(args) {
    const file = resolveFrom(args.file);
    if (!existsSync(file)) return { ok: false, error: '找不到皮肤包：' + file };
    const info = inspectSsf(file);
    if (!info.ok) return { ok: false, error: '不是合法皮肤包：' + info.error };
    const mode = args.mode || 'auto';
    const platform = args.platform ?? process.platform;
    const detectOpts = { env: args.env, platform, roots: args.roots, ...(args.detectOpts || {}) };
    const sgtool = platform === 'win32' ? (args.sgtool !== undefined ? args.sgtool : detectSgtool(detectOpts)) : null;
    const detected = args.target
        ? { dirs: [resolveFrom(args.target)], searched: [] }
        : detectSkinDirs(detectOpts);

    const base = {
        file,
        format: info.format,
        version: info.version,
        entries: info.entries,
        bytes: info.entryList.reduce((a, e) => a + e.bytes, 0),
        sizeText: formatBytes(info.entryList.reduce((a, e) => a + e.bytes, 0)),
        mode,
        dryRun: !!args.dryRun,
        engine: {
            available: !!sgtool,
            sgtool: sgtool || null,
            note: sgtool
                ? '将调用 SGTool 安装并由引擎自动完成复制/重建 skin_v3.dat/切换皮肤'
                : '没有找到 SGTool.exe，只能走复制路径',
        },
        targets: detected.dirs,
        searched: SOGOU_HINTS,
    };

    // dry-run：只报计划，不做任何写操作、不弹任何窗口
    if (args.dryRun) {
        const planned = mode === 'copy' ? 'copy' : (sgtool ? 'engine' : 'copy');
        const plan = planned === 'copy'
            ? 'copy：复制到 ' + (detected.dirs.join(' / ') || '（未探测到皮肤目录，请用 target 指定）')
            : 'engine：SGTool 安装并点确定（引擎自动复制+切换），失败时回落 copy';
        return {
            ...base,
            ok: true,
            plannedMethod: planned,
            plan,
            writePlan: detected.dirs.map((dir) => ({ dir, dest: join(dir, basename(file)), written: false })),
            note: '这是 dry-run：没有写文件、没有弹窗。去掉 dryRun 才会真的安装。',
        };
    }

    // 引擎安装
    if (mode !== 'copy' && sgtool) {
        const engine = await installViaEngine({
            file, sgtool,
            timeoutMs: args.timeoutMs,
            detectOpts,
            spawnImpl: args.spawnImpl,
        });
        if (engine.ok) {
            return {
                ...base,
                ok: true,
                method: 'engine',
                dialog: engine.dialog,
                note: '已通过引擎自己的安装流程完成安装并切换皮肤（不需要重启输入法）。' +
                    '如果皮肤列表里仍显示旧样子，先确认选中的就是新皮肤。',
            };
        }
        base.engine.error = engine.error;
        if (mode === 'engine') return { ...base, ok: false, error: engine.error, detail: engine.detail };
        // auto 模式回落 copy
    }

    if (!detected.dirs.length) {
        return {
            ...base,
            ok: false,
            method: null,
            error: '没有找到本机搜狗输入法的皮肤目录，也无法走引擎安装（SGTool 未找到）。' +
                '请用 target 手动指定，或确认已安装搜狗输入法。',
        };
    }
    const written = installViaCopy({ file, targets: detected.dirs, dryRun: false });
    const ok = written.some((w) => w.written);
    return {
        ...base,
        ok,
        method: 'copy',
        writePlan: written,
        note: ok
            ? '文件已复制进皮肤目录。复制路径**不会**自动切换皮肤：到「属性设置 → 皮肤」里选中它，' +
              '或重启输入法让它被扫描到。真正的"安装并切换"请走引擎安装（需要本机有 SGTool.exe）。'
            : '复制失败：' + written.map((w) => w.error || w.dest).join('; '),
        warning: base.engine.error ? ('引擎安装失败已回落复制：' + base.engine.error) : undefined,
    };
}

/**
 * 列出本机已安装的皮肤。
 * @param {{target?:string, env?:Record<string,string|undefined>, platform?:NodeJS.Platform,
 *          roots?:string[], exists?:(p:string)=>boolean, readdir?:(p:string)=>string[]}} [args]
 */
export function listInstalled(args = {}) {
    const exists = args.exists ?? existsSync;
    const readdir = args.readdir ?? readdirSync;
    const detected = args.target
        ? { dirs: [resolveFrom(args.target)], searched: [] }
        : detectSkinDirs({ env: args.env, platform: args.platform, roots: args.roots, exists, readdir });
    const out = [];
    for (const dir of detected.dirs) {
        const items = [];
        if (exists(dir)) {
            let names = [];
            try { names = readdir(dir); } catch { names = []; }
            for (const n of names) {
                if (!/\.ssf$/i.test(n)) continue;
                const p = join(dir, n);
                let meta = {};
                try {
                    const i = inspectSsf(p);
                    meta = i.ok ? { format: i.format, version: i.version, entries: i.entries, bytes: statSync(p).size } : { error: i.error };
                } catch (e) { meta = { error: String(e) }; }
                items.push({ name: n, ...meta });
            }
        }
        out.push({ dir, exists: exists(dir), count: items.length, skins: items });
    }
    const total = out.reduce((a, d) => a + d.count, 0);
    return {
        ok: true,
        dirs: out,
        total,
        searched: detected.searched,
        hint: total ? null : '没有在常见位置找到任何 .ssf 皮肤。' + SOGOU_HINTS.join('  '),
    };
}
