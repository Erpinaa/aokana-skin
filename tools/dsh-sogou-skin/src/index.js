// @ts-check
/**
 * DSH 搜狗皮肤工坊 —— 插件入口。
 *
 * 刻意保持零第三方依赖：PNG/BMP 编解码、ZIP 与 v1/v3 容器、皮肤装配与预览渲染全部自实现，
 * 因此不需要构建步骤、不需要装包，直接以 ESM 被 DSH 加载即可。
 *
 * 注册内容：
 *   - 14 个 `skin_*` 工具（见 src/tools.js）
 *   - 1 个技能 `sogou-skin-authoring`（读 skills/sogou-skin-authoring/SKILL.md）
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTools } from './tools.js';

export const name = '@dsh-external/dsh-sogou-skin';

/** 需要 DSH 提供的能力。 */
export const inject = ['tools', 'skills'];

/** 配置项（不依赖 schemastery，纯默认值合并）。 */
export const defaultConfig = {
    /** 皮肤工程的默认根目录；工具里的相对路径都按它解析 */
    projectsRoot: '',
};

/**
 * 插件入口。
 * @param {any} ctx
 * @param {Partial<typeof defaultConfig>} [config]
 */
export function apply(ctx, config = {}) {
    const cfg = { ...defaultConfig, ...(config || {}) };
    const projectsRoot = cfg.projectsRoot
        ? resolve(String(cfg.projectsRoot))
        : resolve(process.cwd(), 'sogou-skins');

    const toolsResult = registerTools(ctx, { projectsRoot });
    const skillRegistered = registerSkill(ctx);

    const msg = '[sogou-skin] 已加载：' + toolsResult.registered + ' 个 skin_* 工具' +
        (skillRegistered ? ' + sogou-skin-authoring 技能' : '（技能未注册：ctx.skills 不可用）') +
        '，工程根目录 = ' + projectsRoot;
    if (ctx?.logger?.info) ctx.logger.info(msg);
    else if (!toolsResult.registered) console.log(msg);
    return { tools: toolsResult.names || [], skill: skillRegistered };
}

/**
 * 注册技能：解析 SKILL.md 的 YAML frontmatter，正文作为技能内容。
 * @param {any} ctx @returns {boolean}
 */
function registerSkill(ctx) {
    const skills = ctx?.skills;
    if (!skills || typeof skills.register !== 'function') return false;
    try {
        const dir = dirname(fileURLToPath(import.meta.url));
        const skillDir = join(dir, '..', 'skills', 'sogou-skin-authoring');
        const raw = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
        const parsed = parseSkillMarkdown(raw);
        if (!parsed) {
            ctx?.logger?.warn?.('[sogou-skin] SKILL.md 缺少 frontmatter（name/description），技能未注册');
            return false;
        }
        const disposer = skills.register({
            name: parsed.name || 'sogou-skin-authoring',
            description: parsed.description,
            content: parsed.body,
            provider: 'dsh-sogou-skin',
            source: 'bundled',
            resourceBase: { kind: 'directory', path: skillDir },
            invocation: { modelInvocable: true, userInvocable: true },
        });
        if (typeof disposer === 'function' && typeof ctx.effect === 'function') {
            ctx.effect(() => disposer, '[sogou-skin] skill sogou-skin-authoring');
        }
        return true;
    } catch (e) {
        ctx?.logger?.warn?.('[sogou-skin] 技能注册失败：' + String(e && e.message ? e.message : e));
        return false;
    }
}

/**
 * 极简 frontmatter 解析（只认 `name:` 与 `description:`，不需要引入 YAML 库）。
 * @param {string} raw
 * @returns {{name?:string, description:string, body:string}|null}
 */
export function parseSkillMarkdown(raw) {
    const lines = raw.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return null;
    let close = -1;
    for (let i = 1; i < lines.length; i++) if (lines[i].trim() === '---') { close = i; break; }
    if (close < 0) return null;
    const fm = lines.slice(1, close).join('\n');
    const get = (key) => {
        const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(fm);
        return m ? m[1].trim() : '';
    };
    const description = get('description');
    if (!description) return null;
    return {
        name: get('name') || 'sogou-skin-authoring',
        description,
        body: lines.slice(close + 1).join('\n').replace(/^\n+/, ''),
    };
}
