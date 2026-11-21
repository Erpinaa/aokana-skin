// @ts-check
/**
 * 搜狗皮肤「素材槽位」规格表 + 官方键名词表 + 工程默认配置。
 *
 * 设计要点：这里的 slot 是【角色】而不是文件名 —— 文件名由 Skin.ini 决定，皮肤作者可以随意命名
 * （样本 A 用 skin2_1.bmp，样本 B 用 skin1_1.png 承担同类角色）。因此插件按角色组织素材，
 * 由装配器统一分配规范文件名并同步写入 Skin.ini。
 *
 * 全部结论来自对真实样本（明文 ZIP 代际 + 商店 v3 代际 + 官方内置 Skin.dat v1 代际）的实测，
 * 详见 docs/SSF-FORMAT.md 与 docs/LESSONS.md。
 */

/** 工程文件（skin.project.json）的当前 schema 版本。 */
export const PROJECT_SCHEMA_VERSION = 2;

/** 三种交互态：后缀 1/2/3 的含义由 Skin.ini 显式声明（cn_en / cn_en_hover / cn_en_down）。 */
export const STATES = [
    { key: 'normal', suffix: 1, iniSuffix: '', label: '常态' },
    { key: 'hover', suffix: 2, iniSuffix: '_hover', label: '悬停' },
    { key: 'down', suffix: 3, iniSuffix: '_down', label: '按下' },
];

/** 图标默认尺寸（现代主流；引擎允许皮肤自定义，2007 年的老皮肤有 16×17 / 20×24）。 */
export const DEFAULT_ICON_SIZE = { w: 20, h: 20 };

/**
 * 面板类槽位。
 *
 * - `required`：不给也能装配——装配器会用程序化占位素材兜底，但会在警告里说明；
 * - `nineSlice`：是否参与九宫格拉伸（状态栏底图按原尺寸绘制，不参与）；
 * - `growAxis`：真实窗口里这根轴会不会变化。只有真正会变化的轴才需要检查拉伸健康度。
 *
 * ⚠️ 可选面板（bar_mask / 三张分体底图）**只在工程显式分配时才存在**。
 * v0.1.0 曾经无条件给每个工程生成这些槽位，导致所有产物都带一份假的 Scheme_H2/Scheme_V2
 * 段落和一张 placeholder bar_mask —— 看起来只是"多几个文件"，实际是给引擎换了渲染路径。
 */
export const PANEL_SLOTS = [
    {
        slot: 'panel_h', group: '候选窗底图', label: '横排候选窗底图',
        required: true, writableSection: 'Scheme_H1', writableKey: 'pic', defaultFile: 'skin1.png',
        // 横排候选窗只会【变宽】（打字变长），纵向尺寸通常不变 —— 只需要在横向设防
        growAxis: 'h',
        purpose: '横向候选窗的整窗背景。左侧常放可拉伸的纯色条，右侧放立绘/装饰。',
        sizeHint: '宽 400~700，高 40~300；必须带 alpha 通道',
        nineSlice: true,
    },
    {
        slot: 'panel_v', group: '候选窗底图', label: '竖排候选窗底图',
        required: true, writableSection: 'Scheme_V1', writableKey: 'pic', defaultFile: 'skin2.png',
        // 竖排候选窗只会【变高】（候选变多），横向尺寸不变
        growAxis: 'v',
        purpose: '纵向候选窗的整窗背景。通常是竖直长条 + 右下角立绘。',
        sizeHint: '宽 150~550，高 150~500；必须带 alpha 通道',
        nineSlice: true,
    },
    {
        slot: 'bar', group: '状态栏', label: '状态栏底图',
        required: true, writableSection: 'StatusBar', writableKey: 'pic', defaultFile: 'bar.png',
        purpose: '输入法状态栏（中/英、标点、菜单那一排按钮）的背景图/徽记。',
        sizeHint: '宽 100~400，高 20~200；可带 alpha。图标会按 pos 坐标叠在它上面',
        // 实测：三个皮肤（含官方默认皮肤）的 [StatusBar] 段都【没有】 layout_* 键 ——
        // 状态栏底图按原尺寸绘制、不参与九宫格拉伸。所以标 false，也不做拉伸体检。
        nineSlice: false,
    },
    {
        slot: 'bar_mask', group: '状态栏', label: '状态栏遮罩图',
        required: false, writableSection: 'StatusBar', writableKey: 'pic_mask', defaultFile: 'bar_mask.png',
        purpose: '状态栏底图的遮罩（官方默认皮肤用 bar_mask.png）。用于把底图裁成想要的形状。',
        sizeHint: '与状态栏底图同尺寸；灰度或带 alpha 的 PNG',
        nineSlice: false,
    },
    {
        slot: 'strip_h_pinyin', group: '候选窗分体底图', label: '横排-拼音串区底图',
        required: false, writableSection: 'Scheme_H2', writableKey: 'pinyin_pic', defaultFile: 'skin2_1.png',
        purpose: '只有当横排候选窗想「拼音串区」和「候选区」用不同底图时才需要（Scheme_H2）。',
        sizeHint: '很窄的小图即可，例如 28×27；用 1 像素边框标出可拉伸边界',
        nineSlice: true, growAxis: 'h',
    },
    {
        slot: 'strip_h_cand', group: '候选窗分体底图', label: '横排-候选区底图',
        required: false, writableSection: 'Scheme_H2', writableKey: 'zhongwen_pic', defaultFile: 'skin1_2.png',
        purpose: '同上，横排候选区的底图。',
        sizeHint: '很窄的小图即可，例如 6×25',
        nineSlice: true, growAxis: 'h',
    },
    {
        slot: 'strip_v_cand', group: '候选窗分体底图', label: '竖排-候选区底图',
        required: false, writableSection: 'Scheme_V2', writableKey: 'zhongwen_pic', defaultFile: 'skin2_2.png',
        purpose: '竖排候选区的底图（Scheme_V2）。',
        sizeHint: '很窄的小图即可，例如 5×115',
        nineSlice: true, growAxis: 'v',
    },
];

/**
 * 状态栏按钮槽位。
 * variants 里的每个名字都是一张图；Skin.ini 中用逗号连接，表示「按当前输入法状态二选一」。
 */
export const BUTTON_SLOTS = [
    { slot: 'cn_en', group: '状态栏按钮', label: '中/英切换', required: true,
      variants: ['cn', 'en', 'a'], purpose: '中文态 / 英文态 / 第三态（a 槽用途全网无文档，照抄样本即可）' },
    { slot: 'biaodian', group: '状态栏按钮', label: '标点切换', required: false,
      variants: ['cn_biaodian', 'en_biaodian'], purpose: '中文标点 / 英文标点' },
    { slot: 'quan_ban', group: '状态栏按钮', label: '全角/半角', required: false,
      variants: ['quan', 'ban'], purpose: '全角（实心圆）/ 半角（半月）' },
    { slot: 'quan_shuang', group: '状态栏按钮', label: '全拼/双拼', required: false,
      variants: ['quanpin', 'shuanpin'], purpose: '全拼 / 双拼' },
    { slot: 'fan_jian', group: '状态栏按钮', label: '简/繁', required: false,
      variants: ['jian', 'fan'], purpose: '简体 / 繁体' },
    { slot: 'softkeyboard', group: '状态栏按钮', label: '软键盘', required: false,
      variants: ['key'], purpose: '软键盘入口' },
    { slot: 'menu', group: '状态栏按钮', label: '菜单', required: false,
      variants: ['menu'], purpose: '主菜单（扳手/齿轮）' },
    { slot: 'sogousearch', group: '状态栏按钮', label: '搜索', required: false,
      variants: ['ie'], purpose: '搜狗搜索入口（放大镜）' },
    { slot: 'passport', group: '状态栏按钮', label: '账号', required: false,
      variants: ['pass', 'passon'], purpose: '未登录 / 已登录' },
    { slot: 'skinmanager', group: '状态栏按钮', label: '皮肤管理器', required: false,
      variants: ['skinmanager'], purpose: '皮肤管理器入口（新样本才有）' },
    { slot: 'voice', group: '状态栏按钮', label: '语音输入', required: false,
      variants: ['voice'], purpose: '语音输入入口（官方默认皮肤里有，第三方皮肤很少做）' },
    { slot: 'picface', group: '状态栏按钮', label: '表情/图片', required: false,
      variants: ['picface'], purpose: '表情与图片输入入口' },
    { slot: 'logo', group: '状态栏按钮', label: '品牌 Logo', required: false,
      variants: ['logo'], purpose: '状态栏左侧的品牌标识（官方默认皮肤用三态 logo1/2/3）' },
];

/** 占位图标上的文字标签（没有中文字库，只能用 ASCII 缩写）。 */
export const BUTTON_VARIANT_LABELS = {
    cn: 'CN', en: 'EN', a: 'A', cn_biaodian: '.,', en_biaodian: '.,',
    quan: 'F', ban: 'H', quanpin: 'QP', shuanpin: 'SP', jian: 'J', fan: 'F',
    key: 'KB', menu: 'M', ie: 'S', pass: 'P', passon: 'P', skinmanager: 'SM',
    voice: 'MIC', picface: 'EMO', logo: 'LOGO',
};

/**
 * 覆盖层按钮（overlay）—— 它们不是「状态栏按钮」，而是**画在候选窗内部**的浮层，
 * 因此放在 [Scheme_H1]/[Scheme_V1]/[Scheme_H2]/[Scheme_V2] 里，且用 10 元组的
 * `<名字>_align` 定位而不是 `<名字>_pos=x,y`。
 */
export const OVERLAY_SLOTS = [
    { slot: 'pageup', scope: 'scheme', variants: ['ov_pageup_on', 'ov_pageup_off'],
      alignExample: 'H1: 0,0,0,48,0,0,0,2,6,2', purpose: '候选翻页-上一页' },
    { slot: 'pagedown', scope: 'scheme', variants: ['ov_pagedown_on', 'ov_pagedown_off'],
      alignExample: 'H1: 0,0,0,32,0,0,0,2,6,2', purpose: '候选翻页-下一页' },
    { slot: 'sugg', scope: 'scheme', variants: ['opensugg', 'closesugg'],
      alignExample: 'H1: 0,0,0,9,0,0,0,2,6,2', purpose: '展开/收起更多候选' },
    { slot: 'custom0', scope: 'scheme', variants: ['ov_custom01'],
      alignExample: 'H1: 1,0,0,1,1,0,0,2,6,1', purpose: '用户自定义浮层按钮（custom0..N）' },
];

/**
 * 官方浮层定位预设 —— 从本机 **5 个内置皮肤**（医生版 Skin.dat、标准版 Skin.dat / SkinDark /
 * TrendySkin / TrendySkinDark）里逐条抽出的 77 个 `*_align` 十元组，去重后的代表值。
 *
 * ## 十元组的部分逆向结论（有实证，但未完全解开）
 *
 * 记 `a[0..9]`：
 * - ✅ `a[2]` / `a[3]` = 按钮中心的 (dx, dy) 偏移。竖排里只有 a[2] 变、横排里只有 a[3] 变；
 *   三个皮肤竖排下 a[2] 之和恒为 32（两按钮居中排在 32px 带子上）。
 * - ✅ `a[7]` / `a[8]` 是布局常量：横排=(2,6)、竖排=(0,8)。
 * - ✅ `a[9]` 与方案族相关：`Scheme_*1` → 2，`Scheme_*2` → 0（custom 类浮层例外）。
 * - ❓ `a[0] a[1] a[4] a[5] a[6]` 的确切含义未解。
 *
 * ## 因此本插件的策略：原样透传
 * 不猜、不改、不重新计算。用户要么直接选下面的官方预设，要么从任意现成皮肤里抄一组数值。
 */
export const OVERLAY_PRESETS = {
    'H1-pageup-医生版': '0,0,0,48,0,0,0,2,6,2',
    'H1-pagedown-医生版': '0,0,0,32,0,0,0,2,6,2',
    'H1-sugg-医生版': '0,0,0,9,0,0,0,2,6,2',
    'H1-pageup-标准版': '0,0,0,38,0,0,0,2,6,2',
    'H1-pagedown-标准版': '0,0,0,24,0,0,0,2,6,2',
    'H1-custom0-标准版': '1,3,2,2,1,0,0,2,5,0',
    'V1-pageup-医生版': '0,8,8,0,0,2,1,0,8,2',
    'V1-pagedown-医生版': '0,8,24,0,0,2,1,0,8,2',
    'V1-pageup-标准版': '0,8,7,0,0,2,1,0,8,2',
    'V1-pagedown-标准版': '0,8,25,0,0,2,1,0,8,2',
    'V2-cand_pageup-标准版': '0,8,10,0,0,2,1,0,5,0',
    'V2-cand_pagedown-标准版': '0,8,25,0,0,2,1,0,5,0',
    'H2-cand_pageup-标准版': '0,0,0,24,0,0,0,0,6,0',
    'H2-cand_pagedown-标准版': '0,0,14,8,0,0,0,0,6,0',
    '通用-custom0': '1,0,0,1,1,0,0,2,6,1',
};

/** [StatusBar] 里除按钮外还有这几个键（来自官方默认皮肤）。 */
export const STATUSBAR_EXTRA_KEYS = {
    pic_mask: '状态栏底图的遮罩图（官方默认皮肤用 bar_mask.png）',
    flash_cnt: 'Flash 皮肤专用：动画数量',
};

/** 状态栏按钮默认排布（照抄样本 A，单位像素，从 bar.png 左上角起算）。 */
export const DEFAULT_BUTTON_POS = {
    cn_en: [23, 1], quan_ban: [43, 1], biaodian: [63, 1], softkeyboard: [83, 1],
    menu: [100, 1], fan_jian: [102, 1], sogousearch: [126, 1], quan_shuang: [126, 1],
    passport: [100, 1], skinmanager: [100, 4],
    voice: [12, 4], picface: [12, 5], logo: [0, 4],
};

/** [Display] 段的默认字体/开关。工程里可以逐项覆盖（v0.2.0 起生效）。 */
export const DEFAULT_DISPLAY = {
    fontSize: 16,
    fontCh: '微软雅黑',
    fontEn: 'Arial',
    useGdip: true,
    aero: false,
    glow: false,
    largeFontSupport: true,
};

/**
 * 默认配色（#rrggbb，写进 Skin.ini 时换算成 0xBBGGRR）。
 * 这是一套中性的青玉/暗金，和程序化占位素材的配色一致。
 */
export const DEFAULT_THEME = {
    pinyinColor: '#1d5f63',
    firstColor: '#0f4a52',
    zhongwenColor: '#2a6f74',
    compHintColor: '#b08a40',
};

/**
 * 官方键名词表 —— 由**搜狗输入法医生版自带的默认皮肤**（Skin.dat，70 个条目，
 * 内含 8964 字节的 Skin.ini）逐个键提取而来，再与两个真实样本合并。
 * 这是目前能拿到的最权威的键名清单，`skin_validate` 用它来发现拼错的键。
 */
const STATIC_KEYS = {
    General: ['skin_name', 'skin_version', 'skin_author', 'skin_email', 'skin_time', 'skin_info',
        'skin_id', 'class', 'class_id', 'tag', 'preview_square', 'preview_comp'],
    Display: ['font_size', 'font_ch', 'font_en', 'pinyin_color', 'zhongwen_first_color', 'zhongwen_color',
        'comphint_color', 'use_gdip', 'aero', 'glow', 'default_skin', 'LargeFontSupport',
        'ninehint_color', 'clear_edge'],
    Scheme_H1: ['layered', 'pic', 'layout_horizontal', 'layout_vertical', 'separator', 'seperatorui',
        'to_left_right', 'pinyin_marge', 'zhongwen_marge', 'anchor', 'transparent_color_enable',
        'transparent_color', 'click_color', 'click_color_enable', 'opaque', 'custom_cnt', 'widget_cnt'],
    Scheme_V1: ['layered', 'pic', 'layout_horizontal', 'layout_vertical', 'separator', 'seperatorui',
        'to_left_right', 'pinyin_marge', 'zhongwen_marge', 'anchor', 'transparent_color_enable',
        'transparent_color', 'click_color', 'click_color_enable', 'opaque', 'custom_cnt', 'widget_cnt'],
    Scheme_H2: ['layered', 'pinyin_pic', 'zhongwen_pic', 'pinyin_layout_horizontal', 'pinyin_layout_vertical',
        'pinyin_marge', 'zhongwen_layout_horizontal', 'zhongwen_layout_vertical', 'zhongwen_marge',
        'transparent_color_enable', 'transparent_color', 'click_color', 'click_color_enable', 'opaque',
        'comp_custom_cnt', 'cand_custom_cnt', 'widget_cnt'],
    Scheme_V2: ['layered', 'pinyin_pic', 'zhongwen_pic', 'pinyin_layout_horizontal', 'pinyin_layout_vertical',
        'pinyin_marge', 'zhongwen_layout_horizontal', 'zhongwen_layout_vertical', 'zhongwen_marge',
        'transparent_color_enable', 'transparent_color', 'click_color', 'click_color_enable', 'opaque',
        'comp_custom_cnt', 'cand_custom_cnt', 'widget_cnt'],
    StatusBar: ['pic', 'pic_mask', 'pic_preview', 'flash_cnt', 'webpage_url', 'widget_cnt'],
};

/**
 * 搜狗皮肤配置层的类结构 —— 从 UIPlugin.dll 的 RTTI 里直接读出来的（命名空间 SkinConfigFile）。
 * 这解释了 ini 里每个键最终被解析成什么类型：
 *
 *   SkinTypeBase ── 所有配置项的基类
 *   ├─ SkinInt / SkinBool / SkinStr / SkinColor      标量
 *   ├─ SkinPos            → 按钮位置 `_pos=x,y`
 *   ├─ SkinAlign          → 浮层对齐（那个十元组）
 *   ├─ SkinAlignEx        → 对齐的扩展形式
 *   ├─ SkinSeperator      → `separator=颜色,左,右`
 *   ├─ SkinToLeftRight    → `to_left_right`（样本皮肤里从未出现）
 *   ├─ SkinImage / SkinSplit / SkinFlashs            图像相关
 *   ├─ SkinBtn / SkinBtnUi / SkinBtnComponent        按钮
 *   └─ SkinBtnsComponent / SkinBtnsCustom            按钮集合
 *
 * 引擎解析多整数用的格式串是 `%d,%d,%d,%d` 与 `%d,%d,%d,%d,%d,%d`。
 */
export const SKIN_CONFIG_CLASSES = [
    'SkinTypeBase', 'SkinInt', 'SkinBool', 'SkinStr', 'SkinColor', 'SkinPos', 'SkinAlign', 'SkinAlignEx',
    'SkinSeperator', 'SkinToLeftRight', 'SkinImage', 'SkinSplit', 'SkinFlashs',
    'SkinBtn', 'SkinBtnUi', 'SkinBtnComponent', 'SkinBtnsComponent', 'SkinBtnsCustom',
];

/** 动态键：状态栏按钮的三态 + 显示开关 + 位置；以及候选窗内的浮层按钮。 */
const DYNAMIC_PATTERNS = [
    /^[a-z0-9_]+_display$/,          // cn_en_display
    /^[a-z0-9_]+_pos$/,              // cn_en_pos=x,y
    /^[a-z0-9_]+_hover$/,            // cn_en_hover
    /^[a-z0-9_]+_down$/,             // cn_en_down
    /^[a-z0-9_]+_align$/,            // pageup_align=十元组
    /^(comp_|cand_)?custom\d+(_display|_align)?$/,   // custom0 / comp_custom0_align
    /^(comp_|cand_)?custom_cnt$/,
    /^(comp_|cand_)?(pageup|pagedown)(_display|_align|_hover|_down)?$/,
    /^sugg(_display|_align|_hover|_down)?$/,
];

/** [StatusBar] 里裸键名就是按钮槽位名，例如 cn_en=cn1.png,en1.png,a1.png */
const BUTTON_NAMES = new Set(BUTTON_SLOTS.map((b) => b.slot));

/**
 * 判断一个键是否在官方词表内。
 * @param {string} section @param {string} key
 * @returns {boolean}
 */
export function isKnownKey(section, key) {
    const statics = STATIC_KEYS[section];
    if (statics && statics.includes(key)) return true;
    if (section === 'StatusBar' && BUTTON_NAMES.has(key)) return true;
    for (const re of DYNAMIC_PATTERNS) if (re.test(key)) return true;
    return false;
}

/** @returns {string[]} 已知段落名（顺序 = 官方默认皮肤里的顺序） */
export function knownSections() { return Object.keys(STATIC_KEYS); }

/** @returns {string[]} 某个段落的静态已知键 */
export function knownKeysOf(section) { return STATIC_KEYS[section] ? [...STATIC_KEYS[section]] : []; }

/**
 * 插件内置的默认 Skin.ini 骨架（[General] + [Display]；其余段落由装配器按工程内容追加）。
 * @param {object} [meta]
 * @returns {string}
 */
export function defaultSkinIni(meta = {}) {
    const display = { ...DEFAULT_DISPLAY, ...(meta.display || {}) };
    const theme = { ...DEFAULT_THEME, ...(meta.theme || {}) };
    // 注意颜色是 0xBBGGRR（Windows COLORREF），不是 RGB —— 换算在装配器里做。
    return [
        '[General]',
        'skin_name=' + (meta.name || '我的皮肤'),
        'skin_version=' + (meta.version || '1.0'),
        'skin_author=' + (meta.author || '匿名'),
        'skin_email=' + (meta.email || ''),
        'skin_time=' + (meta.time || ''),
        'skin_info=' + (meta.info || '用 DSH 搜狗皮肤工坊生成'),
        '',
        '[Display]',
        'font_size=' + display.fontSize,
        'font_ch=' + display.fontCh,
        'font_en=' + display.fontEn,
        'pinyin_color=' + (meta.iniColors?.pinyin_color ?? '0x000000'),
        'zhongwen_first_color=' + (meta.iniColors?.zhongwen_first_color ?? '0x000000'),
        'zhongwen_color=' + (meta.iniColors?.zhongwen_color ?? '0x000000'),
        'comphint_color=' + (meta.iniColors?.comphint_color ?? '0x000000'),
        'use_gdip=' + (display.useGdip ? 1 : 0),
        'aero=' + (display.aero ? 1 : 0),
        'glow=' + (display.glow ? 1 : 0),
        'LargeFontSupport=' + (display.largeFontSupport ? 1 : 0),
        '',
    ].join('\n');
}

/**
 * 默认皮肤工程配置（v0.2.0 schema）。
 *
 * 注意 `roles` 里默认给必需槽位写了 `{ generate: true }`：这样 `skin_init` 之后
 * 立刻 `skin_assemble` 就能得到一套可安装的皮肤，不会因为"还没有素材"而失败。
 * @param {object} [meta]
 */
export function defaultProject(meta = {}) {
    return {
        schema: PROJECT_SCHEMA_VERSION,
        name: meta.name || '我的皮肤',
        author: meta.author || '匿名',
        info: meta.info || '用 DSH 搜狗皮肤工坊生成',
        email: meta.email || '',
        /** 素材目录（相对工程根） */
        assetDir: 'assets',
        /** 产物目录（相对工程根） */
        outDir: 'build',
        /** 必需面板缺失时是否自动用占位素材兜底（默认 true） */
        autoGenerate: true,
        /** 素材缩放：2 表示素材是按 2 倍设计的，装配时先缩到逻辑像素再写 Skin.ini */
        assets: { scale: 1 },
        /** 角色 -> 素材分配；字符串简写等价于 { source: '...' } */
        roles: {
            panel_h: { generate: true },
            panel_v: { generate: true },
            bar: { generate: true },
            cn_en: { generate: true },
        },
        /** 状态栏按钮启用列表与坐标（pos 会与自动排布结合，不必逐个写全） */
        buttons: {
            enabled: ['cn_en'],
            pos: {},
            /**
             * 是否写 `<按钮>_display=1`。**默认 true** —— 这是真机验证出来的硬要求：
             * 不写这个键时，部分搜狗版本（本机医生版实测）状态栏按钮整体不显示。
             * SKILL 五·九 里也记录过同样的坑。只有你明确知道自己不需要时才置 false。
             */
            writeDisplay: true,
        },
        /** 图标规格（PNG 带 alpha 最稳；BMP 是 24 位无 alpha，只能靠色键） */
        icon: { ...DEFAULT_ICON_SIZE, format: 'png', bmpBackground: [255, 255, 255] },
        /** 三态生成策略：只给一张常态图时，由插件推导悬停/按下 */
        states: {
            hover: { mode: 'lighten', amount: 0.10 },
            down: { mode: 'darken', amount: 0.16 },
        },
        /** [Display] 段设置 */
        display: { ...DEFAULT_DISPLAY },
        /** 配色（#rrggbb），会换算成 BGR 写进 Skin.ini */
        theme: { ...DEFAULT_THEME },
        /** 九宫格可拉伸边；{} = 自动探测。可含 modeH/modeV（0=拉伸 1=平铺） */
        nineSlice: {},
        /** 窗口锚点（{Scheme_H1:[x,y],...}）；不给则由九宫格推导（与真机验证过的行为一致） */
        anchors: {},
        /** 候选窗浮层按钮 */
        overlays: [],
        /** 是否写 <按钮>_display=1（多数真实第三方皮肤会写，可关） */
        useBarMask: false,
        /** 占位素材的色相（0..1），默认 0.474 = 171° 青玉 */
        hue: 0.474,
        // ---- 以下是"可选的显式覆盖"，默认不写进工程文件 ----
        /** 显式指定 [General] skin_time（YYYY.MM.DD）；不给则用当天日期 */
        skinTime: undefined,
        /** 显式指定 [General] skin_version；不给则 1.0 */
        skinVersion: undefined,
        /** 是否写 layered=1（默认：不写，真实第三方皮肤都不用） */
        layered: undefined,
        /** 是否给浮层按钮写 _display=1（默认：不写） */
        overlayDisplay: undefined,
    };
}

/**
 * 最小可用皮肤：只有这些是「不给就做不出来」的。
 * @returns {{slots:string[], summary:string}}
 */
export function minimalRequirements() {
    return {
        slots: ['panel_h', 'panel_v', 'bar', 'cn_en'],
        summary: '最小可用皮肤 = 横排候选窗底图 + 竖排候选窗底图 + 状态栏底图 + 中/英切换图标。' +
            '其余按钮可以逐个追加；不给的按钮不会出现在状态栏上。',
    };
}

/**
 * 把规格表拍平成便于展示/遍历的数组。
 * @returns {{slot:string,group:string,label:string,required:boolean,purpose:string,sizeHint:string,variants:string[]|null}[]}
 */
export function flattenSpec() {
    const out = [];
    for (const p of PANEL_SLOTS) {
        out.push({
            slot: p.slot, group: p.group, label: p.label, required: p.required,
            purpose: p.purpose, sizeHint: p.sizeHint, variants: null,
        });
    }
    for (const b of BUTTON_SLOTS) {
        out.push({
            slot: b.slot, group: b.group, label: b.label, required: b.required,
            purpose: b.purpose,
            sizeHint: '建议每个变体 ' + DEFAULT_ICON_SIZE.w + '×' + DEFAULT_ICON_SIZE.h +
                '；格式 PNG（带透明）或 24 位 BMP（用色键透明）',
            variants: b.variants,
        });
    }
    return out;
}

/**
 * 依据图片的客观特征，猜它最适合哪个槽位。返回按置信度降序的候选，供 AI/用户确认。
 * @param {{width:number,height:number,hasAlpha:boolean,aspect:number}} probe
 * @param {{slot:string,group:string,label:string}[]} [available] 尚未被占用的槽位
 * @returns {{slot:string,confidence:number,reason:string}[]}
 */
export function suggestSlots(probe, available) {
    const cands = (available && available.length ? available : flattenSpec())
        .filter((s) => s.slot !== 'cn_en');
    const out = [];
    const add = (slot, confidence, reason) => {
        if (cands.some((c) => c.slot === slot)) out.push({ slot, confidence, reason });
    };
    const a = probe.aspect;
    const px = probe.width + '×' + probe.height;
    if (probe.width >= 300 && a >= 1.8) add('panel_h', 0.9, '宽幅横向长图（' + px + '），像横排候选窗底图');
    if (probe.height >= 150 && a <= 0.9) add('panel_v', 0.85, '竖向长图（' + px + '），像竖排候选窗底图');
    if (probe.width >= 90 && probe.width <= 420 && probe.height >= 18 && probe.height <= 220 && a >= 1.0) {
        add('bar', 0.7, '中小尺寸横向图（' + px + '），像状态栏底图');
    }
    if (!probe.hasAlpha && probe.width >= 40) {
        // 没有 alpha 的面板在深色桌面上会露白底 —— 这是真实返工过的坑
        add('bar', 0.3, '没有 alpha 通道（' + px + '），作为面板时四周可能会露出不透明底色，建议先抠图');
    }
    if (probe.width <= 64 && probe.height <= 64 && a >= 0.6 && a <= 1.7) {
        add('cn_en', 0.6, '小方图（' + px + '），像状态栏图标');
    }
    if (probe.width <= 48 && probe.height >= 30) {
        add('strip_h_pinyin', 0.4, '窄长小图，可能是分体底图');
        add('strip_h_cand', 0.4, '窄长小图，可能是分体底图');
        add('strip_v_cand', 0.4, '窄长小图，可能是分体底图');
    }
    return out.sort((x, y) => y.confidence - x.confidence);
}
