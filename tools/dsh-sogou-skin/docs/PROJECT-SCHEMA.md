# `skin.project.json` 工程文件说明

皮肤工程是一套「素材 + 配置」的目录：

```
my-skin/
├── skin.project.json      ← 本文件
├── assets/                ← 你的图片素材（PNG / BMP）
├── build/                 ← assemble 的产物（可删，可重建）
└── preview/               ← preview 的产物（可删，可重建）
```

`skin.project.json` 是**唯一真源**：改配置改这里，再 `assemble`，不要直接改 `build/Skin.ini`。
插件加载时会做 schema 自校验：

- **类型错误**进 `errors`（带字段路径，例如 `theme.pinyinColor 应为 #rrggbb 颜色`）；
- **未知字段**进 `warnings`，但**保存时原样保留**（不会丢作者的备注）；
- `schema: 1` 的旧工程会自动迁移到 2（只补默认值，不改你写的字段）。

---

## 最小可用工程

```json
{
  "schema": 2,
  "name": "我的皮肤",
  "author": "我",
  "assets": { "scale": 1 },
  "roles": {
    "panel_h": { "source": "assets/panel_h.png" },
    "panel_v": { "source": "assets/panel_v.png" },
    "bar": { "source": "assets/bar.png" },
    "cn_en": { "generate": true }
  },
  "buttons": { "enabled": ["cn_en"] },
  "theme": { "pinyinColor": "#155a60", "firstColor": "#0d7d6d", "zhongwenColor": "#2b6a6e", "compHintColor": "#a8802c" }
}
```

`generate: true` 表示"用程序化占位素材"，所以即使一张图都没有也能装配出可安装的皮肤。

---

## 顶层字段

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `schema` | number | `2` | 工程格式版本；1 会自动迁移 |
| `name` / `author` / `info` / `email` | string | 见默认值 | 写进 `[General]` |
| `skinVersion` | string | `"1.0"` | 写进 `skin_version`（可选）|
| `skinTime` | string | 当天 | 写进 `skin_time`，格式 `YYYY.MM.DD`；测试里用来固定输出 |
| `assetDir` | string | `"assets"` | 素材目录（相对工程根）|
| `outDir` | string | `"build"` | 装配产物目录 |
| `autoGenerate` | boolean | `true` | 必需面板缺素材时是否用占位图兜底；`false` 时缺失即报 error |
| `assets` | object | `{ "scale": 1 }` | `scale: 2` 表示素材按 2 倍设计（见下）|
| `roles` | object | 必需面板占位 | 槽位 → 素材分配（见下）|
| `buttons` | object | `{enabled:["cn_en"],pos:{},writeDisplay:false}` | 状态栏按钮（见下）|
| `icon` | object | `{w:20,h:20,format:"png",bmpBackground:[255,255,255]}` | 图标规格 |
| `states` | object | hover=lighten 0.10 / down=darken 0.16 | 三态自动推导策略 |
| `display` | object | `{fontSize:16,fontCh:"微软雅黑",fontEn:"Arial",useGdip:true,aero:false,glow:false,largeFontSupport:true}` | `[Display]` 段 |
| `theme` | object | 青玉/暗金四色 | `#rrggbb`，装配时换算成 `0xBBGGRR` 写进 Skin.ini |
| `nineSlice` | object | `{}` | 按槽位覆盖九宫格：`{"panel_h":{"left":100,"right":300,"top":33,"bottom":11,"modeH":0,"modeV":0}}` |
| `anchors` | object | `{}` | 按段落覆盖窗口锚点：`{"Scheme_H1":[100,130]}`；不给则按 `left/2,top/2` 推导 |
| `overlays` | array | `[]` | 候选窗浮层按钮（见下）|
| `layered` | boolean | 不写 | 显式写 `[Scheme_*] layered=1/0`（真实第三方皮肤都不用）|
| `overlayDisplay` | boolean | 不写 | 是否给浮层按钮写 `_display=1` |
| `useBarMask` | boolean | `false` | 是否把 `bar_mask` 写成 `[StatusBar] pic_mask` |
| `hue` | number | `0.474` | 占位素材色相（0..1），0.474 ≈ 171° 青玉 |

---

## 槽位（`roles`）

槽位名固定，来自真实样本统计（见 `skin_requirements`）：

**面板**（`source` 单张图 / `generate` 占位）：
`panel_h`（横排候选窗底图，必需）、`panel_v`（竖排候选窗底图，必需）、
`bar`（状态栏底图，必需）、`bar_mask`（状态栏遮罩，可选）、
`strip_h_pinyin` / `strip_h_cand`（Scheme_H2 分体底图，**成对**才生效）、
`strip_v_cand`（Scheme_V2 候选区底图）。

**状态栏按钮**（`source` / `sources` 按变体 / `sheet` 拼图自动切分 / `generate`）：
`cn_en`（必需，变体 cn/en/a）、`biaodian`、`quan_ban`、`quan_shuang`、`fan_jian`、
`softkeyboard`、`menu`、`sogousearch`、`passport`、`skinmanager`、`voice`、`picface`、`logo`。

一个 role 可以是：

```json
"panel_h": "assets/skin1.png"                       // 字符串简写
"panel_h": { "source": "assets/skin1.png" }         // 完整写法
"cn_en": {
  "sources": { "cn": "assets/cn1.png", "en": "assets/en1.png", "a": "assets/a1.png" },
  "states":  { "hover": { "cn": "assets/cn2.png" }, "down": { "cn": "assets/cn3.png" } }
}
```

其它 role 字段：

| 字段 | 说明 |
|---|---|
| `nineSlice` | 该槽位的九宫格（`left/right/top/bottom/modeH/modeV`），覆盖顶层 `nineSlice` |
| `margins` | 该槽位的文字边距 `{pinyin_marge:[t,b,l,r], zhongwen_marge:[t,b,l,r]}`，**顺序是 top,bottom,left,right** |
| `scale` | 该槽位素材倍数（2 = 2x），覆盖 `assets.scale` |
| `trim` | 装配前裁掉透明边 |
| `size` | 占位素材尺寸 `{width,height}` |
| `hue` | 该槽位占位素材色相 |

> **按需生成**：没有分配的 `bar_mask` / 分体底图，**不会**出现在产物里 ——
> 相关段落（`pic_mask` / `[Scheme_H2]` / `[Scheme_V2]`）也不会写。
> 这是有意的：真实第三方皮肤不用的键，插件也不替你加。

---

## 两侧素材约定（`assets.scale`）

素材按 **2 倍尺寸**出图时：

```json
"assets": { "scale": 2 }
```

- `assets/` 里放 2x 图（例如设计稿 1440×520）；
- 装配时先缩到逻辑像素（720×260）再写 `.ssf`；
- **`nineSlice` / `margins` / 坐标数字仍按逻辑像素写**（120/270 就写 120/270，不要写 240/540）。

只给单个槽位开也行：`"roles": { "panel_h": { "source": "...", "scale": 2 } }`。
默认 `scale: 1`，插件**不会自动猜** —— 1x 素材就什么都不要写。

---

## 按钮（`buttons`）

```json
"buttons": {
  "enabled": ["cn_en", "biaodian", "quan_ban", "menu"],
  "pos": { "cn_en": [23, 1], "menu": [100, 1] },
  "writeDisplay": false
}
```

| 字段 | 说明 |
|---|---|
| `enabled` | 启用哪些按钮（顺序即显示顺序）。不给素材的按钮会用占位图标并给出 warning |
| `pos` | `<按钮>_pos = x,y`。**没写的按钮会自动按状态栏底图宽度排布**，不再全部挤到 `[20,1]` |
| `writeDisplay` | 是否写 `<按钮>_display=1`。**默认 false**：真实第三方皮肤都不写这个键 |

---

## 浮层按钮（`overlays`）

候选窗内部的翻页 / 展开更多 / 自定义按钮，用 **10 元组 `_align`** 定位（不是 `_pos`）：

```json
"overlays": [
  { "section": "Scheme_H1", "name": "pageup", "align": "0,0,0,48,0,0,0,2,6,2",
    "normal": ["assets/arrow_up.png"], "hover": [], "down": [] }
]
```

- `section`：`Scheme_H1` / `Scheme_V1` / `Scheme_H2` / `Scheme_V2`
- `align`：10 个整数；**原样透传，插件不做推导**（十元组只被部分逆向，
  官方预设见 `skin_overlay_presets`）
- `normal` / `hover` / `down`：图片路径数组；没给 hover/down 时复用 normal

---

## 三态（`states`）

只给一张常态图时，插件推导悬停/按下：

```json
"states": {
  "hover": { "mode": "lighten", "amount": 0.10 },
  "down":  { "mode": "darken",  "amount": 0.16 }
}
```

`mode` 可选 `lighten` / `darken` / `tint`（配 `color`）/ `none`。
更精确的做法是给 `role.states` 显式每态图片。

---

## 命令行常用操作

```bash
node src/cli.js init ./my-skin --name 我的皮肤
node src/cli.js scan ./my-skin
node src/cli.js assemble ./my-skin
node src/cli.js validate ./my-skin       # 0 error 才是通过
node src/cli.js preview ./my-skin        # 先看 preview/render.png
node src/cli.js pack ./my-skin --out my-skin.ssf
```

AI/DSH 里对应的工具是 `skin_init` / `skin_scan_assets` / `skin_assign` /
`skin_assemble` / `skin_validate` / `skin_preview` / `skin_pack`。
