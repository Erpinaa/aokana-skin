# v0.2.0 开发验证记录

本文件记录 v0.2.0 重构完成后**实际执行过**的命令与输出（不是"应该能跑"）。
为了不把本机绝对路径写进仓库，输出里的路径做了脱敏：

- `<仓库>` = 本仓库根目录
- `<工程>` = 本地皮肤工程（如 `03-皮肤工程/复刻-雷电将军`）
- `<临时>` = 本次验证用的临时副本目录
- `<样本>` = 本地真实皮肤样本目录（因版权不随仓库分发）
- `<搜狗安装目录>` = 本机搜狗安装路径（如 `...\SogouYSInput\1.1.0.1278`）

验证时间：2026-10-18 · Node.js v24.21.0 · Windows。

---

## 1. 测试套件

```
$ node test/run.mjs
================ 汇总 ================
  ok   image.test.mjs          35 组断言
  ok   ssf.test.mjs            26 组断言
  ok   layout.test.mjs         27 组断言
  ok   project.test.mjs        19 组断言
  ok   assemble.test.mjs       23 组断言
  ok   render.test.mjs         20 组断言
  ok   validate.test.mjs       19 组断言

共 7 个测试文件 / 169 组断言 / 用时 3.4s
== 全部通过 ==

$ node test/run.mjs --all
  ...（前 7 个同上）...
  ok   preview.test.mjs        7 组断言
  ok   plugin.test.mjs         27 组断言
  ok   cli.test.mjs            23 组断言
  ok   e2e.test.mjs            12 组断言
  ok   docs.test.mjs           21 组断言

共 12 个测试文件 / 259 组断言 / 用时 ~21s
== 全部通过 ==
```

> 测试全部**自己造数据**（程序化占位素材 + 手工构造的 PNG/BMP/ZIP/v1/v3），
> 不读任何外部样本；运行器会检查"每个文件断言数 > 0"且输出里没有静默跳过标记。

---

## 2. 真实工程：复刻-雷电将军

命令（在 `<临时>/复刻-雷电将军` 的副本上执行，避免动原工程）：

```
$ node src/cli.js assemble <临时>/复刻-雷电将军
装配完成 -> <临时>/复刻-雷电将军/build
  文件 55 个：skin1.png, skin2.png, bar.png, skin2_1.png, skin1_2.png, skin2_2.png,
  cn1.bmp, cn2.bmp, ...（9 个启用按钮的三态图标）, Skin.ini
提示 1 条（不阻塞）：
  · [竖排候选窗底图] 可拉伸中段里有 6 处相邻列/行的稳定色差 > 35
    （y=32 Δ77、y=33 Δ39、y=400 Δ36、y=401 Δ85、y=412 Δ67 等）。
    真机上拉长后可能变成一条线或被抹开；如果那只是刻意的细节，可忽略

$ node src/cli.js validate <临时>/复刻-雷电将军
  类型 project，文件 55 个，未压缩 298.5 KB
  [建议] [Scheme_H1] 候选行下方中间区域的背景覆盖率只有 72%，…（已知反例说明）
  [建议] [Scheme_V1] 可拉伸中段里有 6 处相邻列/行的稳定色差 > 35 …
  [建议] 状态栏有 4 对按钮坐标重叠 50% 以上。**已知反例**：真实皮肤里也存在 …
  ✓ 通过：没有错误，也没有警告
  结论：校验通过（55 个文件，3 条建议）
exit=0

$ node src/cli.js preview <临时>/复刻-雷电将军
  预览已生成 -> <临时>/复刻-雷电将军/preview
    render / bgcheck / stretch / zoom / assets / preview / report  （7 件产物）
  校验通过（55 个文件，3 条建议）

$ node src/cli.js pack <临时>/复刻-雷电将军 --out <临时>/复刻-雷电将军.ssf
已打包：<临时>/复刻-雷电将军.ssf
  55 个条目，266.3 KB，zip 代际

$ node src/cli.js validate <临时>/复刻-雷电将军.ssf
  类型 ssf，文件 55 个，未压缩 298.5 KB
  ✓ 通过：没有错误，也没有警告
  结论：校验通过（55 个文件，3 条建议）

preview/ 产物：assets.png 107,662 B · bgcheck.png 624,425 B · preview.png 171,199 B
render.png 830,758 B · report.txt 4,516 B · stretch.png 782,430 B · zoom.png 266,204 B
```

**结论**：真实工程 0 error、0 warning；3 条 notes 都是启发式提示且带已知反例说明。

---

## 3. 真实工程：闲云 v1

```
$ node src/cli.js assemble <临时>/闲云
装配完成 -> <临时>/闲云/build
  文件 52 个：skin1.png, skin2.png, bar.png, 9 个按钮的三态图标(共 48 张), Skin.ini
  （没有 bar_mask、没有分体底图、没有 [Scheme_H2]/[Scheme_V2] —— 工程没声明）

$ node src/cli.js validate <临时>/闲云
  类型 project，文件 52 个，未压缩 304.5 KB
  ✓ 通过：没有错误，也没有警告
  结论：校验通过（52 个文件）
exit=0

$ node src/cli.js preview <临时>/闲云
  预览已生成 -> <临时>/闲云/preview  （7 件产物，同上）
  校验通过（52 个文件）

$ node src/cli.js pack <临时>/闲云 --out <临时>/闲云.ssf
已打包：<临时>/闲云.ssf
  52 个条目，313.1 KB，zip 代际

$ node src/cli.js validate <临时>/闲云.ssf
  类型 ssf，文件 52 个，未压缩 304.5 KB
  ✓ 通过：没有错误，也没有警告

preview/ 产物：assets.png 137,477 B · bgcheck.png 628,406 B · preview.png 223,537 B
render.png 820,114 B · report.txt 2,747 B · stretch.png 641,287 B · zoom.png 319,877 B
```

**结论**：工程 → 装配 → 预览 → 打包 → 再校验，全链路零 error 零 warning。

---

## 4. 真实样本容器验证（三代）

命令：

```powershell
$env:SOGOU_SKIN_DAT='C:\Users\<用户>\AppData\LocalLow\SogouYS\skin_v3.dat'
$env:SOGOU_SKIN_SAMPLES='<样本>'
node scripts/verify-real-samples.mjs
```

输出（真实执行）：

```
真实样本验证（只读你本机已有的文件，不上传、不复制进仓库）

=== v1 容器：<用户目录>\AppData\LocalLow\SogouYS\skin_v3.dat (313,803 B) ===
  ok   v1 容器 可读取  格式=v1 条目=52
  ok   v1 容器 重打包后条目逐字节一致  产物 313803 B
  ok   v1 容器 可解包  52 个文件
  ok   v1 容器 解包目录可逐字重打包  52 条目 / 313803 B
  ok   v1 容器 解包→重打包后条目逐字节一致
  ok   v1 容器 v1 重打包文件逐字节相同  313803 B vs 313803 B

=== 真实样本：<样本>/原神—雷电将军.ssf (302,440 B) ===
  ok   真实样本 可读取  格式=v3 条目=17
  ok   真实样本 重打包后条目逐字节一致  产物 302472 B
  ok   真实样本 可解包  17 个文件
  ok   真实样本 解包目录可逐字重打包  17 条目 / 302472 B
  ok   真实样本 解包→重打包后条目逐字节一致

=== 真实样本：<样本>/雷电将军影宝.ssf (281,685 B) ===
  ok   真实样本 可读取  格式=zip 条目=53
  ok   真实样本 重打包后条目逐字节一致  产物 282688 B
  ok   真实样本 可解包  53 个文件
  ok   真实样本 解包目录可逐字重打包  53 条目 / 282688 B
  ok   真实样本 解包→重打包后条目逐字节一致

== 全部通过（16 项）==
```

**结论**：

- `skin_v3.dat` 的真实格式是 v1（`"Skin"+u32(1)` 明文内层）；
- v1 **解包→重打包后与原文件逐字节相同**（313,803 = 313,803）；
- v3 与 zip 的条目名/顺序/内容在重打包后完全一致（体积差异只来自压缩实现）。

---

## 5. 官方内置皮肤（v1）只读校验

```
$ node src/cli.js inspect "<搜狗安装目录>\Skin.dat"
文件：<搜狗安装目录>\Skin.dat
代际：v1（70 个条目）
图片：68 张

$ node src/cli.js validate "<搜狗安装目录>\Skin.dat"
校验 <搜狗安装目录>\Skin.dat
  类型 ssf，文件 70 个，未压缩 103.2 KB
  [建议] 有 28 张图没有被 Skin.ini 引用（big_closesugg1.png …）…
  [建议] [Scheme_H1] 候选行下方中间区域的背景覆盖率只有 50% …（已知反例说明）
  [建议] 状态栏有 66 对按钮坐标重叠 50% 以上。**已知反例**：真实皮肤里也存在 …
  ✓ 通过：没有错误，也没有警告
  结论：校验通过（70 个文件，3 条建议）
exit=0
```

**结论**：官方默认皮肤（v1 明文容器）可被完整解析并零 error 校验通过。

---

## 6. 真实样本 .ssf 的零误报验证

```
$ node src/cli.js validate <样本>/雷电将军影宝.ssf
  类型 ssf，文件 53 个，未压缩 310.1 KB
  [建议] ×3（候选条背景覆盖率 / 中段色差 / 按钮重叠，均带已知反例说明）
  ✓ 通过：没有错误，也没有警告
exit=0

$ node src/cli.js validate <样本>/原神—雷电将军.ssf
  类型 ssf，文件 17 个，未压缩 298.3 KB
  [建议] [Scheme_H1] 候选行下方中间区域背景覆盖率 73% …（已知反例说明）
  ✓ 通过：没有错误，也没有警告
exit=0
```

---

## 7. 安装路径（引擎安装 + 复制兜底）

`skin_install` / `cli install` 的 `--dry-run` 只做探测、不写文件、不弹窗：

```
$ node src/cli.js install "<临时>/复刻-雷电将军.ssf" --dry-run
[dry-run] 皮肤包：<临时>/复刻-雷电将军.ssf（zip，53 条目）
安装方式：engine  SGTool=<搜狗安装目录>\SGTool.exe
计划：engine：SGTool 安装并点确定（引擎自动复制+切换），失败时回落 copy
  将写入 <搜狗安装目录>\AllSkin\复刻-雷电将军.ssf
  将写入 C:\Users\<用户>\AppData\LocalLow\SogouYS\AllSkin\复刻-雷电将军.ssf
这是 dry-run：没有写文件、没有弹窗。去掉 dryRun 才会真的安装。
```

- 真正安装（`--mode engine` / 默认 `auto`）由 ime-verifier 在真机上验证：
  `SGTool.exe -line 0 -border --appid=skinreg -install x.ssf` → 自动点「安装皮肤」的「确定」
  → 引擎完成复制、重建 `skin_v3.dat`、切换当前皮肤（无需重启）。
- 本记录不包含"实际安装"步骤，因为那会改变本机输入法的皮肤状态；
  安装流程的真机证据见 `05-真机测试/报告.md`（由 ime-verifier 维护）。

---

## 8. CLI 全命令冒烟

`test/cli.test.mjs` 会在临时目录里**逐条起子进程**执行：

```
requirements / init / scan / assemble / validate / preview / pack / inspect /
unpack / repair / install(--dry-run, --mode copy) / list / overlay-presets / demo
```

并断言：退出码、关键产物存在、`--json` 输出可解析、README 的命令清单与代码一致。
`test/e2e.test.mjs` 另外验证：装配 → 打包（zip / v3 / v1）→ 解包 → 逐字重打包，
以及 `pack --set` 克隆时"除六个身份字段外零差异"。

---

## 8.4 生成器结构守护（两个真实工程各跑一遍后的实测）

用最终代码重新装配两个真实工程后，直接读产物 Skin.ini：

| 工程 | `[StatusBar]` 第一条键 | `<btn>_display=1` 条数 | 段落数 | 说明 |
|---|---|---|---|---|
| 复刻-雷电将军 | `pic=bar.png` | 9 | 7（含 H2/V2，工程显式分配了分体底图）| 按需生成 |
| 闲云 | `pic=bar.png` | 9 | 5（无 H2/V2，工程没分配分体底图）| 按需生成 |

- 状态栏按钮显示开关默认写入（真机要求，见 8.5）；
- `[StatusBar]` 的 `pic` 保持第一条（保真）；
- 没声明的可选段落不会出现（闲云只有 5 段；v0.1 会多出假的 H2/V2 与 bar_mask）。

---

## 8.5 状态栏 `_display=1` 真机 A/B（v0.2 回归与修复）

skin-designer / ime-verifier 在本机医生版 1.1.0.1278 上做的 A/B（真机截图证据）：

| 产物 | Skin.ini 状态栏 | 真机结果 |
|---|---|---|
| v0.1 闲云 1.0 | 9 个启用按钮各有一条 `<btn>_display=1` | 9 个按钮**正常显示** |
| v0.2 早期产物 | 默认不写 `_display` | 9 个按钮**全部消失** |
| v0.2 + `buttons.writeDisplay: true` 重装 | 重新写入 9 条 `_display=1` | 9 个按钮**恢复显示** |

**修复**：装配器恢复为默认写 `<btn>_display=1`（与 v0.1 一致；可用
`buttons.writeDisplay: false` 关闭）；测试新增守护"启用 N 个按钮 → Skin.ini 必须有
N 条 `<btn>_display=1`"；校验器对缺少 display 的工程给 warning；
`[StatusBar]` 里 `pic` 保持为第一条键（保真）。

> 证据包（本机路径）：`...\AllSkin\闲云2.0-加display-测试版.ssf` vs
> `...\AllSkin\闲云·青玉-2.0.ssf`（由 ime-verifier 保管，不随仓库分发）。

同时记录本次真机新增的窗口标定（用于 render/validate）：

- 横排候选窗 9 个候选（多行显示）：窗口物理 1247×554 → 逻辑 **712.6×316.6**，对应底图 **720×244**；
  即**宽度≈底图宽、高度会变大**；
- 多行候选时引擎在底图下方**自动补一块候选区背景**（矩形，宽度≈候选文字块宽，
  颜色取玉带中下部 ≈ `(184,222,205)`）。`render.png` 的 `H1 WRAPPED 9 CANDS` 视图已按此模拟。

---

## 9. 复现方式

```powershell
# 单元 + 集成测试（无需任何外部数据）
node test/run.mjs --all

# 真实工程验证（把 <工程> 换成你自己的工程目录）
$tmp = Join-Path $env:TEMP ('verify-' + [guid]::NewGuid())
Copy-Item -Recurse <工程> $tmp
node src/cli.js assemble $tmp
node src/cli.js validate $tmp
node src/cli.js preview  $tmp
node src/cli.js pack     $tmp --out "$tmp\out.ssf"
node src/cli.js validate "$tmp\out.ssf"

# 真实容器验证（可选，需要本机有真实皮肤文件）
$env:SOGOU_SKIN_DAT='C:\Users\<你>\AppData\LocalLow\SogouYS\skin_v3.dat'
$env:SOGOU_SKIN_SAMPLES='D:\你的样本目录'
node scripts/verify-real-samples.mjs
```
