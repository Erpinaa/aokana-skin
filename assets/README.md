# assets/ · 皮肤素材清单（V1 竖排 / 状态栏 / 中英A 图标）

> 依据 `docs/设计稿-v0.2.md`（v0.2.2）与 `docs/images/skin_h1_asset_2x_zh.png` 的视觉，1:1 沿用名牌 / 面板 / 青色分隔线的造型。
> 全部文件为 **PNG RGBA**，按 **2× 像素**交付；相对 Skin.ini 的坐标一律使用下表里的 **1× 逻辑尺寸**。
> 透明区域 alpha=0（未填底色），可直接叠到任意背景；面板白与状态栏白是半透明的，靠 alpha 表达。

## 一、文件

| 文件 | 像素（2×） | 逻辑（1×） | 用途 |
|---|---|---|---|
| `v1/panel_v.png` | 522×428 | 261×214 | V1 竖排候选窗底图，名牌烘焙「中文」（中文版主交付） |
| `v1/panel_v_en.png` | 522×428 | 261×214 | 同上，名牌「英文」（英文版用，可选） |
| `v1/panel_v_sp.png` | 522×428 | 261×214 | 同上，名牌「双拼」（双拼版用，可选） |
| `statusbar/bar.png` | 680×100 | 340×50 | 状态栏胶囊底图，**不含任何按钮图标** |
| `icons/cn1.png` `icons/en1.png` `icons/a1.png` | 40×40 | 20×20 | 中 / 英 / A 图标，常态 |
| `icons/cn2.png` `icons/en2.png` `icons/a2.png` | 40×40 | 20×20 | 悬停态（圆底提亮） |
| `icons/cn3.png` `icons/en3.png` `icons/a3.png` | 40×40 | 20×20 | 按下态（圆底压暗） |

生成脚本：`assets/_gen/make_assets.py`（只读 `ref/dots_user.png` 与系统字体，只写 `assets/`）。

## 二、V1 竖排面板 `v1/panel_v.png`

坐标均为 1×（乘 2 得 PNG 像素）。

| 元素 | 几何 | 说明 |
|---|---|---|
| 面板 | x 6–255，y 44–206，圆角 r 10 | 白 90%：RGBA(255,255,255,230)；无描边、无阴影 |
| 三行 | 44–98 / 98–152 / 152–206 | 行高 54；第一行留给拼音，后两行放候选（多候选可平铺中段） |
| 分隔线 ×2 | y 98、y 152，粗 1.4，满面板宽 | #8FD0E6，alpha 252/255；**已烘焙，Skin.ini 不要再写 `separator`** |
| 名牌胶囊 | x 3–193，y 7–42，圆角 r 17.5（全圆角） | 水平渐变 #59D3FF → #3DB0ED（77% 处收敛），叠加 2.5% 竖直压暗（上亮下暗） |
| 名牌尾巴 | 底边 x 45–59.2 @ y 42，尖端 (50.7, 48.8) | 小三角压进面板 4.8 px，与对话框同款 |
| 名牌文字 | 墨迹高 16.4，墨迹中心 (106, 24.8) | 「中文」白色，Noto Sans SC Bold（按墨迹 bbox 精确居中） |
| 2×2 白点 | 贴回区域 2× 坐标 (40, 30)，尺寸 39×41 | 直接沿用参考裁片 `ref/dots_user.png`（自带左上灰色柔影），羽化贴回，等效 1× 直径约 4 |

- 名牌比面板左侧**外挑 3 px**：与 H1 底图「名牌略压面板左上角」的关系一致（H1 为 10.3/840，按宽度换算正好 3/261）。
- 名牌标签是**烘焙**的：中 / 英 / 双拼三套只能靠换底图切换，引擎不会把「中/英」状态字渲染进名牌。
- `panel_v_en.png`、`panel_v_sp.png` 与 `panel_v.png` 除名牌文字外完全一致，供另外两套 .ssf 使用。

## 三、状态栏底图 `statusbar/bar.png`

| 元素 | 数值 |
|---|---|
| 胶囊 | 340×50（1×），圆角 r 25（全圆角） |
| 底 | 白 92%：RGBA(255,255,255,235) |
| 边 | #B8E6F5，1.5 px **内描边**（2× 为 3 px），不改变外框尺寸 |
| 内容 | 空底图：不放任何按钮图标，按钮由 Skin.ini 的 `cn1..3 / en1..3 / a1..3` 叠上去 |

## 四、图标 `assets/icons/*.png`

| 元素 | 数值 |
|---|---|
| 画布 | 20×20（1×），圆直径 17.6 → 四周留 1.2 px 透明外圈 |
| 圆底 | 常态 #4CC3F7；悬停 #68D3FA（提亮）；按下 #35A8D6（压暗） |
| 字形 | 白色「中」「英」「A」，Noto Sans SC Bold，墨迹高 10.6，按墨迹 bbox 居中 |
| 小尺寸可读性 | 在 20×20 下逐像素回采检查（中 33 / 英 41 / A 34 个白像素，圆底 180+ 像素），字形仍可辨 |

> `a` 系列是英文/半角模式按钮（也为双拼版预留同一套按钮），与 `cn` 系列的圆底、字号、位置保持一致。

## 五、Skin.ini 用法参考

```ini
; —— 竖排候选窗 ——
[Scheme_V1]
pic=panel_v.png
; 第一行从 y=44 开始（正好是名牌高度），左右各留 6 px 对齐面板内边
layout_vertical=6,44,6

; —— 状态栏 ——
[StatusBar]
pic=bar.png
cn_en_display=1
cn_en_pos=18,15
cn1=icons/cn1.png
cn2=icons/cn2.png
cn3=icons/cn3.png
en1=icons/en1.png
en2=icons/en2.png
en3=icons/en3.png
a1=icons/a1.png
a2=icons/a2.png
a3=icons/a3.png
```

- 底图里已经画了名牌、面板、两条分隔线、四个白点，**不要再写 `separator`**，否则会多一条线。
- 2× 素材：Skin.ini 里的坐标写 1× 逻辑值即可。

## 六、重新生成与校验

```powershell
# 重新生成（字体：C:\Windows\Fonts\NotoSansSC-VF.ttf，Bold 变体；圆点：ref/dots_user.png）
& "C:\Users\洲\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" assets\_gen\make_assets.py

# 只校验（PIL 可读 / 尺寸 / RGBA / alpha 0..255 / 20x20 可辨）
& "C:\Users\洲\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe" assets\_gen\make_assets.py --check
```

渲染方式：8×（图标 16×）超采样 → 自写的**预乘 alpha 浮点降采样**（Blackman 窗 sinc）→ 去预乘 → 2× PNG。
选它而不是直接 LANCZOS，是为了避免 8bit 预乘量化在透明边缘放大出白边/暗边；已逐像素核对边缘（名牌左缘 alpha 195 处颜色仍是 #58D1FD，圆角外沿干净）。

最近一次校验：**13/13 文件通过**（3 张面板 + 1 张状态栏 + 9 个图标）。
