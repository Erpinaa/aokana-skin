# 测试

**全部测试不需要任何外部素材**，在干净 checkout 里可直接运行：

```
node test/run.mjs          # 单元 / 契约测试（7 个文件）
node test/run.mjs --all    # 再加集成测试（5 个文件：CLI 全命令、端到端、文档一致性）
```

也可以走 npm（如果你本机有 npm）：

```
npm test
npm run test:all
```

## 硬规矩：不允许"跳过"，也不允许"只打印不断言"

这套测试被重写过一次，因为 v0.1.0 吃过两次亏（见 `docs/LESSONS.md` 第 16、21 条）：

1. 有测试整份 `process.exit(0)`，退出码好看，但**一条断言都没跑**；
2. 有测试把断言写在不存在的字段上（`a.errors` 恒为 `undefined`），**永远是绿的**；
3. 有测试硬编码开发者本机路径，在别人机器上必然崩。

现在的规矩：

- 测试**自己造数据**（程序化占位素材、手工构造的 PNG/BMP/ZIP/v1/v3 容器）；
- 每个文件必须打印非零断言数，运行器会核对；
- 输出里出现 `FAIL` 或"跳过"一律判失败 —— **缺数据就改成自建数据，不允许静默跳过**；
- 涉及真实样本的验证不在测试里，走 `scripts/verify-real-samples.mjs`（需环境变量指路），
  结果记录在 `docs/VERIFY.md`。

## 单元 / 契约测试

| 文件 | 守住什么 |
|---|---|
| `image.test.mjs` | PNG/BMP 往返、光栅操作、九宫格边界语义（含 `L+R===目标宽` 合法）、点阵字体 |
| `ssf.test.mjs` | ZIP 结构不变量、三代容器往返、v1/v3 内层表、Skin.ini 编解码与 BGR |
| `layout.test.mjs` | 九宫格唯一真源（夹取/退化/平铺）、中段细节与接缝检测、候选条背景启发式 |
| `project.test.mjs` | 工程 schema 校验、默认值、旧 schema 迁移、未知字段保留、素材分配 |
| `assemble.test.mjs` | 按需生成段落、不写 `_display`/`layered`/`pic_mask`、anchors/2x/确定性、不改传入对象 |
| `render.test.mjs` | 两排文字公式、横/竖排候选、退化渲染、状态栏、白底与放大图 |
| `validate.test.mjs` | 健康数据 0 error 0 warning；真问题必须报；提示层不判失败；三种输入形态 |

## 集成测试

| 文件 | 守住什么 |
|---|---|
| `preview.test.mjs` | 7 个预览产物齐全可解码、报告数字真实、"改素材必改图" |
| `plugin.test.mjs` | 14 工具 + 技能注册、schema、错误返回、每个工具实跑 |
| `cli.test.mjs` | 真起子进程跑每条 CLI 命令；README 命令清单与代码一致；退出码 |
| `e2e.test.mjs` | 装配→打包（zip/v3/v1）→解包→逐字重打包；v1 字节相同；克隆只改身份字段 |
| `docs.test.mjs` | 版本/工具清单三处一致、README 引用存在、无本机路径/素材/临时文件、无 TODO |

## 为什么测试这么"分散"

它们大多不是"写完代码补的测试"，而是**开发过程中用来定位问题的探针**被固化下来的 ——
比如 `layout.test.mjs` 里的 `L+R===目标宽` 用例，来自"复刻-雷电将军原生窗口被渲染成废图"的 bug。
它们保留了当时的判据，也就能防止那些问题复发。

## 可选：真实样本验证

仓库里没有版权素材，但你可以用本机已有的真实文件验证容器实现：

```powershell
$env:SOGOU_SKIN_DAT='C:\Users\<你>\AppData\LocalLow\SogouYS\skin_v3.dat'
$env:SOGOU_SKIN_SAMPLES='D:\你的皮肤样本'
node scripts/verify-real-samples.mjs
```

它会做「读取 → 同格式重打包 → 解包 → 逐字重打包」并逐字节对比。
