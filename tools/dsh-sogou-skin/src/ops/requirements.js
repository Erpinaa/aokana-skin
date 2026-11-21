// @ts-check
/**
 * 需求清单 / 规格查询 / 官方浮层预设 —— 纯只读的信息类操作。
 */
import {
    BUTTON_SLOTS, OVERLAY_PRESETS, PANEL_SLOTS, SKIN_CONFIG_CLASSES, defaultProject,
    flattenSpec, knownSections, minimalRequirements, DEFAULT_ICON_SIZE,
} from '../skin/spec.js';
import { REAL_WINDOW } from '../skin/layout.js';

/**
 * 一套皮肤需要哪些素材（按分组）。
 */
export function requirementsInfo() {
    /** @type {Map<string, any[]>} */
    const groups = new Map();
    for (const s of flattenSpec()) {
        if (!groups.has(s.group)) groups.set(s.group, []);
        groups.get(s.group).push(s);
    }
    const min = minimalRequirements();
    return {
        ok: true,
        minimal: min,
        groups: [...groups].map(([group, slots]) => ({ group, slots })),
        icon: DEFAULT_ICON_SIZE,
        counts: {
            panels: PANEL_SLOTS.length,
            requiredPanels: PANEL_SLOTS.filter((s) => s.required).length,
            buttons: BUTTON_SLOTS.length,
            knownSections: knownSections().length,
            overlayPresets: Object.keys(OVERLAY_PRESETS).length,
            configClasses: SKIN_CONFIG_CLASSES.length,
        },
        engine: REAL_WINDOW,
        hint: '用户提供素材后，用 skin_scan_assets 扫描，再用 skin_assign 分配槽位。没有素材时可以先 skin_init 并直接 skin_assemble —— 必需面板会自动用占位素材兜底。',
        projectDefaults: defaultProject({ name: '示例', author: '示例' }),
    };
}

/**
 * 官方浮层对齐预设 + 十元组逆向结论。
 */
export function overlayPresetsInfo() {
    return {
        ok: true,
        presets: OVERLAY_PRESETS,
        decoded: {
            confirmed: [
                'a[2] / a[3] = 按钮中心相对锚点的 (dx, dy) 偏移 —— 竖排里只有 a[2] 变、横排里只有 a[3] 变；三个皮肤竖排下 a[2] 之和恒为 32（两按钮居中排在 32px 带子上）',
                'a[7] / a[8] 是布局常量：横排 (2,6)，竖排 (0,8) —— 三个皮肤完全一致',
                'a[9] 与方案族相关：Scheme_*1 → 2，Scheme_*2 → 0（custom 类浮层例外）',
            ],
            unknown: 'a[0] a[1] a[4] a[5] a[6] 的确切含义未解。因此本插件原样透传 align，不做推导。',
        },
        usage: '把预设值直接传给 skin_assign 的 overlays[].align，并配好自己的箭头/图标图片。',
    };
}
