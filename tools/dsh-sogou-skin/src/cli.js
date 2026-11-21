#!/usr/bin/env node
// @ts-check
/**
 * 独立 CLI —— 不依赖 DSH 运行时，方便在没有 harness 的环境里验证与调试。
 * 命令表在 `src/commands.js`（单一真源），这里只负责解析参数、分发、处理退出码。
 *
 * 用法：node src/cli.js <命令> [参数]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCommand, helpText, parseArgv } from './commands.js';
import { errorText } from './util/fs.js';

const argv = process.argv.slice(2);
const scriptDir = dirname(fileURLToPath(import.meta.url));

/** 读 package.json 的版本号（帮助/--version 用）。 */
function version() {
    try {
        const pkg = JSON.parse(readFileSync(join(scriptDir, '..', 'package.json'), 'utf8'));
        return String(pkg.version || '0.0.0');
    } catch { return '0.0.0'; }
}

const args = parseArgv(argv);
const cmdName = args.positionals[0];
const wantHelp = args.flags.help !== undefined || args.flags.h !== undefined || cmdName === 'help';
const wantVersion = args.flags.version !== undefined || cmdName === 'version';

/** @param {string} [s] */
const out = (s = '') => process.stdout.write(s + '\n');
/** @param {string} [s] */
const err = (s = '') => process.stderr.write(s + '\n');

if (wantVersion) {
    out('dsh-sogou-skin ' + version());
    process.exit(0);
}
if (!cmdName || wantHelp) {
    out(helpText());
    process.exit(cmdName && !['help'].includes(cmdName) && wantHelp ? 0 : (cmdName ? 1 : 0));
}

const command = findCommand(cmdName);
if (!command) {
    err('未知命令：' + cmdName);
    err('');
    err(helpText());
    process.exit(2);
}

// 去掉命令名本身，让各命令用统一的下标取参数
args.positionals.shift();

try {
    // 命令可以是同步或异步（install 要等引擎对话框）
    const code = await command.run({ args, json: args.flags.json !== undefined, out, err });
    process.exitCode = typeof code === 'number' ? code : 0;
} catch (e) {
    err('执行 ' + command.name + ' 失败：' + errorText(e));
    if (process.env.DSH_SOGOU_SKIN_DEBUG) err(String(e && e.stack ? e.stack : e));
    process.exitCode = 1;
}
