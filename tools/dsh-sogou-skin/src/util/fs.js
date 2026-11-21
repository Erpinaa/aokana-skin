// @ts-check
/**
 * 文件系统与路径小工具 —— 全项目共用的唯一实现。
 *
 * 约定：
 *  - 所有对外输出（日志、JSON、错误信息）里的路径都用【调用方传入的绝对路径】原样展示，
 *    方便用户直接复制；
 *  - 工程内部的相对路径统一用 `/` 分隔（写进 skin.project.json 时跨平台稳定）；
 *  - 目录创建一律 recursive，不假设父目录存在。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * 把可能相对的路径解析成绝对路径。
 * @param {string} p
 * @param {string} [base]
 * @returns {string}
 */
export function resolveFrom(p, base = process.cwd()) {
    if (typeof p !== 'string' || !p.trim()) throw new Error('路径不能为空');
    return isAbsolute(p) ? resolve(p) : resolve(base, p);
}

/**
 * 把绝对路径变成相对 `base` 的路径，并统一成 `/` 分隔。
 * 如果目标不在 base 之内，原样返回绝对路径（不伪造相对路径）。
 * @param {string} base @param {string} target
 * @returns {string}
 */
export function relativeTo(base, target) {
    const b = resolve(base);
    const t = resolve(target);
    const rel = relative(b, t);
    if (!rel) return '.';
    if (rel.startsWith('..') || isAbsolute(rel)) return t.split(sep).join('/');
    return rel.split(sep).join('/');
}

/**
 * 确保目录存在。
 * @param {string} dir
 * @returns {string}
 */
export function ensureDir(dir) {
    mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * 确保某个文件的父目录存在。
 * @param {string} file
 * @returns {string}
 */
export function ensureParent(file) {
    return ensureDir(dirname(file));
}

/**
 * 把 `{name,data}[]` 写进目录（`name` 会被当作目录内的纯文件名使用，不允许带路径）。
 * @param {string} outDir
 * @param {{name:string,data:Uint8Array}[]} files
 * @returns {string} outDir
 */
export function writeFiles(outDir, files) {
    ensureDir(outDir);
    for (const f of files) {
        const name = String(f.name || '').trim();
        if (!name || name.includes('/') || name.includes('\\')) {
            throw new Error('非法的文件名（不允许包含路径分隔符）：' + JSON.stringify(f.name));
        }
        writeFileSync(join(outDir, name), Buffer.from(f.data));
    }
    return outDir;
}

/**
 * 读文件为 Uint8Array，失败时返回带上下文的错误对象而不是抛异常。
 * @param {string} path
 * @returns {{ok:true,data:Uint8Array}|{ok:false,error:string}}
 */
export function readBytes(path) {
    try {
        return { ok: true, data: new Uint8Array(readFileSync(path)) };
    } catch (e) {
        return { ok: false, error: '读取失败 ' + path + '：' + errorText(e) };
    }
}

/** @param {unknown} e */
export function errorText(e) {
    if (e && typeof e === 'object' && 'message' in e) return String(/** @type {any} */ (e).message);
    return String(e);
}
