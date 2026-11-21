# -*- coding: utf-8 -*-
"""苍之彼方的四重奏 · 搜狗输入法皮肤素材生成器（V1 竖排 / 状态栏 / 中英 A 图标）

所有产出均为 2x PNG RGBA，1x 逻辑尺寸见 assets/README.md。
渲染方式：8x（图标 16x）超采样 -> 自写的预乘 alpha 降采样（Blackman 窗 sinc，浮点，
无振铃暗边）-> 去预乘 -> 2x PNG。

用法：
    python assets/_gen/make_assets.py [--preview DIR]
"""
import argparse
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(ROOT, "assets")
FONT_SC = r"C:\Windows\Fonts\NotoSansSC-VF.ttf"
DOTS_REF = os.path.join(ROOT, "ref", "dots_user.png")

S = 8        # 面板/状态栏超采样倍数（相对 1x 逻辑像素）
ICON_S = 16  # 图标画布小，用更高的超采样

# ----------------------------------------------------------------------------
# 调色板（与 docs/设计稿-v0.2.md / docs/images/skin_h1_asset_2x_zh.png 对齐）
# ----------------------------------------------------------------------------
BLUE_STOPS = [
    (0.00, (89, 211, 255)),
    (0.36, (87, 208, 254)),
    (0.47, (80, 199, 249)),
    (0.62, (69, 185, 242)),
    (0.77, (61, 176, 237)),
    (1.00, (61, 176, 237)),
]
PANEL_WHITE = (255, 255, 255)
PANEL_ALPHA = 230 / 255.0      # 白 90%
LINE_COLOR = (143, 208, 230)   # #8FD0E6
LINE_ALPHA = 252 / 255.0
BAR_WHITE_ALPHA = 235 / 255.0  # 白 92%
BAR_BORDER = (184, 230, 245)   # #B8E6F5
ICON_BLUE = (76, 195, 247)     # #4CC3F7
ICON_HOVER = (104, 211, 250)   # 悬停提亮
ICON_PRESS = (53, 168, 214)    # 按下压暗


# ----------------------------------------------------------------------------
# 绘制基础设施
# ----------------------------------------------------------------------------
class Buf:
    """预乘 alpha 的浮点画布：c = color * a，a ∈ [0,1]。"""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.c = np.zeros((h, w, 3), np.float32)
        self.a = np.zeros((h, w), np.float32)

    def over_flat(self, mask, color, alpha=1.0):
        m = (mask * alpha).astype(np.float32)
        c = np.asarray(color, np.float32)
        self.c = c * m[..., None] + self.c * (1.0 - m[..., None])
        self.a = m + self.a * (1.0 - m)

    def over_field(self, mask, field, alpha=1.0):
        m = (mask * alpha).astype(np.float32)
        self.c = field * m[..., None] + self.c * (1.0 - m[..., None])
        self.a = m + self.a * (1.0 - m)


def _mask(w, h):
    return Image.new("L", (w, h), 0)


def rr_mask(w, h, box, radius):
    m = _mask(w, h)
    ImageDraw.Draw(m).rounded_rectangle([int(round(v)) for v in box], radius=int(round(radius)), fill=255)
    return np.asarray(m, np.float32) / 255.0


def poly_mask(w, h, pts):
    m = _mask(w, h)
    ImageDraw.Draw(m).polygon([(int(round(x)), int(round(y))) for x, y in pts], fill=255)
    return np.asarray(m, np.float32) / 255.0


def ellipse_mask(w, h, box):
    m = _mask(w, h)
    ImageDraw.Draw(m).ellipse([int(round(v)) for v in box], fill=255)
    return np.asarray(m, np.float32) / 255.0


def load_font(px):
    f = ImageFont.truetype(FONT_SC, int(px))
    try:
        f.set_variation_by_name("Bold")
    except Exception:
        pass
    return f


def gradient_field(w, h, x0, x1, y0, y1, stops):
    """沿名牌宽度做水平多段渐变，再叠 2.5% 竖直压暗（顶部亮、底部略深）。"""
    xs = (np.arange(w, dtype=np.float32) - x0) / max(1e-6, (x1 - x0))
    xs = np.clip(xs, 0.0, 1.0)
    ts = np.array([s[0] for s in stops], np.float32)
    cols = np.zeros((w, 3), np.float32)
    for ch in range(3):
        cols[:, ch] = np.interp(xs, ts, np.array([s[1][ch] for s in stops], np.float32))
    field = np.repeat(cols[None, :, :], h, axis=0)
    ys = (np.arange(h, dtype=np.float32) - y0) / max(1e-6, (y1 - y0))
    shade = 1.0 - 0.025 * np.clip(ys, 0.0, 1.0)
    return field * shade[:, None, None]


def centered_glyph(w, h, text, cx, cy, ink_h):
    """按墨迹 bbox 把文字精确居中到 (cx, cy)，并按指定墨迹高度归一化字号。"""
    ref = 220
    f = load_font(ref)
    tmp = Image.new("L", (w, h), 0)
    ImageDraw.Draw(tmp).text((0, 0), text, font=f, fill=255, anchor="lt")
    bb = tmp.getbbox()
    if bb is None:
        raise RuntimeError("empty glyph: " + text)
    fs = max(6, int(round(ref * ink_h / float(bb[3] - bb[1]))))
    f2 = load_font(fs)
    tmp = Image.new("L", (w, h), 0)
    ImageDraw.Draw(tmp).text((0, 0), text, font=f2, fill=255, anchor="lt")
    bb = tmp.getbbox()
    out = Image.new("L", (w, h), 0)
    out.paste(tmp.crop(bb), (int(round(cx - (bb[0] + bb[2]) / 2.0)), int(round(cy - (bb[1] + bb[3]) / 2.0))))
    return np.asarray(out, np.float32) / 255.0


# ----------------------------------------------------------------------------
# 预乘 alpha 降采样：浮点 + Blackman 窗 sinc，避免 8bit 预乘量化的边缘发白/发黑
# ----------------------------------------------------------------------------
def _weights(f, radius=2.5):
    T = int(np.ceil(radius * f))
    k = np.arange(-T, T + 1, dtype=np.float64)
    x = k / f
    win = 0.42 + 0.5 * np.cos(np.pi * x / radius) + 0.08 * np.cos(2.0 * np.pi * x / radius)
    win[np.abs(x) > radius] = 0.0
    w = np.sinc(x) * win
    w /= w.sum()
    return w.astype(np.float32), T


def _downsample_axis(src, f, axis, w, T):
    assert f % 2 == 0
    P = T + f // 2
    n_out = src.shape[axis] // f
    pad = [(P, P) if a == axis else (0, 0) for a in range(3)]
    padded = np.pad(src, pad, mode="edge")
    shape = list(src.shape)
    shape[axis] = n_out
    acc = np.zeros(shape, np.float32)
    for i, k in enumerate(range(-T, T + 1)):
        start = P + f // 2 - 1 + k
        sl = [slice(None)] * 3
        sl[axis] = slice(start, start + f * n_out, f)
        acc += np.float32(w[i]) * padded[tuple(sl)]
    return acc


def downsample(c, a, tw, th, f, radius=2.5):
    """c: 预乘颜色 (h,w,3)；a: alpha (h,w)。返回 2x 尺寸的 RGBA 图像。"""
    w, T = _weights(f, radius)
    for axis in (1, 0):
        c = _downsample_axis(c, f, axis, w, T)
        a = _downsample_axis(a[..., None], f, axis, w, T)[..., 0]
    a = np.clip(a, 0.0, 1.0)
    rgb = c / np.maximum(a, 1e-6)[..., None]
    rgb = np.clip(rgb, 0.0, 255.0)
    rgb[a < 2e-3] = 0.0
    rgba = np.dstack([np.clip(rgb + 0.5, 0, 255).astype(np.uint8),
                      np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


# ----------------------------------------------------------------------------
# 1) V1 竖排面板：261x214 @1x（2x = 522x428）
# ----------------------------------------------------------------------------
V1_W, V1_H = 261.0, 214.0
PANEL = (6.0, 44.0, 255.0, 206.0)   # 三行：44-98 / 98-152 / 152-206，行高 54
PANEL_R = 10.0
PLATE = (3.0, 7.0, 193.0, 42.0)     # 名牌胶囊：190x35，r=17.5
PLATE_R = 17.5
TAIL_BASE = (45.0, 59.2)
TAIL_TIP = (50.7, 48.8)
LINE_Y = (98.0, 152.0)
LINE_TH = 1.4
NAME_CENTER = (106.0, 24.8)
NAME_INK_H = 16.4                   # 「中文」墨迹高度（1x）
DOTS_POS_2X = (40, 30)              # 白点裁片贴回位置（2x）
DOTS_SIZE_2X = (39, 41)             # 与 H1 素材同一裁片尺寸


def build_panel_v(name_text="中文"):
    w, h = int(V1_W * S), int(V1_H * S)
    buf = Buf(w, h)
    # 半透明白面板
    buf.over_flat(rr_mask(w, h, [PANEL[0] * S, PANEL[1] * S, PANEL[2] * S, PANEL[3] * S], PANEL_R * S),
                  PANEL_WHITE, PANEL_ALPHA)
    # 两条 #8FD0E6 分隔线（满宽）
    for y in LINE_Y:
        buf.over_flat(rr_mask(w, h, [PANEL[0] * S, (y - LINE_TH / 2) * S, PANEL[2] * S, (y + LINE_TH / 2) * S], 0.0),
                      LINE_COLOR, LINE_ALPHA)
    # 蓝色胶囊名牌 + 小尾巴
    mask = rr_mask(w, h, [PLATE[0] * S, PLATE[1] * S, PLATE[2] * S, PLATE[3] * S], PLATE_R * S)
    mask = np.maximum(mask, poly_mask(w, h, [(TAIL_BASE[0] * S, PLATE[3] * S),
                                             (TAIL_BASE[1] * S, PLATE[3] * S),
                                             (TAIL_TIP[0] * S, TAIL_TIP[1] * S)]))
    mask = np.maximum(mask, ellipse_mask(w, h, [(TAIL_TIP[0] - 1.3) * S, (TAIL_TIP[1] - 1.3) * S,
                                                (TAIL_TIP[0] + 1.3) * S, (TAIL_TIP[1] + 1.3) * S]))
    field = gradient_field(w, h, PLATE[0] * S, PLATE[2] * S, PLATE[1] * S, PLATE[3] * S, BLUE_STOPS)
    buf.over_field(mask, field)
    # 名牌文字：白色 Bold
    buf.over_flat(centered_glyph(w, h, name_text, NAME_CENTER[0] * S, NAME_CENTER[1] * S, NAME_INK_H * S),
                  (255, 255, 255), 1.0)
    img = downsample(buf.c, buf.a, int(V1_W * 2), int(V1_H * 2), S // 2)
    # 2x2 白点：沿用参考裁片（自带左上灰色柔影），羽化贴回
    if os.path.exists(DOTS_REF):
        dots = Image.open(DOTS_REF).convert("RGB").resize(DOTS_SIZE_2X, Image.LANCZOS)
        dw, dh = DOTS_SIZE_2X
        dm = Image.new("L", (dw, dh), 0)
        ImageDraw.Draw(dm).rounded_rectangle([1, 1, dw - 2, dh - 2], radius=6, fill=255)
        dm = dm.filter(ImageFilter.GaussianBlur(1.5))
        img.paste(dots, DOTS_POS_2X, dm)
    return img


# ----------------------------------------------------------------------------
# 2) 状态栏底图：340x50 @1x（2x = 680x100）
# ----------------------------------------------------------------------------
BAR_W, BAR_H = 340.0, 50.0
BAR_BORDER_W = 1.5


def build_statusbar():
    w, h = int(BAR_W * S), int(BAR_H * S)
    buf = Buf(w, h)
    outer = rr_mask(w, h, [0, 0, w - 1, h - 1], (BAR_H / 2) * S)
    buf.over_flat(outer, PANEL_WHITE, BAR_WHITE_ALPHA)
    bw = BAR_BORDER_W * S
    inner = rr_mask(w, h, [bw, bw, w - 1 - bw, h - 1 - bw], (BAR_H / 2 - BAR_BORDER_W) * S)
    ring = np.clip(outer - inner, 0.0, 1.0)
    buf.over_flat(ring, BAR_BORDER, 1.0)
    return downsample(buf.c, buf.a, int(BAR_W * 2), int(BAR_H * 2), S // 2)


# ----------------------------------------------------------------------------
# 3) 中 / 英 / A 图标：20x20 @1x（2x = 40x40）
# ----------------------------------------------------------------------------
ICON_SIZE = 20.0
ICON_D = 17.6
ICON_INK_H = 10.6


def build_icon(text, color, glyph_h=ICON_INK_H):
    w = h = int(ICON_SIZE * ICON_S)
    buf = Buf(w, h)
    cx = cy = ICON_SIZE / 2 * ICON_S
    r = ICON_D / 2 * ICON_S
    buf.over_flat(ellipse_mask(w, h, [cx - r, cy - r, cx + r, cy + r]), color, 1.0)
    buf.over_flat(centered_glyph(w, h, text, cx, cy, glyph_h * ICON_S), (255, 255, 255), 1.0)
    return downsample(buf.c, buf.a, int(ICON_SIZE * 2), int(ICON_SIZE * 2), ICON_S // 2)


# ----------------------------------------------------------------------------
# 输出
# ----------------------------------------------------------------------------
EXPECT = {
    "v1/panel_v.png": (522, 428),
    "v1/panel_v_en.png": (522, 428),
    "v1/panel_v_sp.png": (522, 428),
    "statusbar/bar.png": (680, 100),
}
for _stem in ("cn", "en", "a"):
    for _i in (1, 2, 3):
        EXPECT["icons/%s%d.png" % (_stem, _i)] = (40, 40)


def check_assets():
    """验收：PIL 能读、尺寸正确、alpha 正常、20x20 下图标仍可辨。"""
    bad = []
    for rel, (ew, eh) in EXPECT.items():
        p = os.path.join(ASSETS, rel)
        if not os.path.exists(p):
            bad.append((rel, "missing")); continue
        try:
            im = Image.open(p); im.load()
        except Exception as exc:  # noqa: BLE001
            bad.append((rel, "unreadable: %s" % exc)); continue
        arr = np.array(im.convert("RGBA"))
        al = arr[..., 3]
        msg = []
        if im.mode != "RGBA":
            msg.append("mode=%s" % im.mode)
        if im.size != (ew, eh):
            msg.append("size=%s expect=%s" % (im.size, (ew, eh)))
        if al.min() != 0 or al.max() != 255:
            msg.append("alpha range=%d..%d" % (al.min(), al.max()))
        if arr[0, 0, 3] != 0:
            msg.append("corner not transparent")
        if rel.startswith("icons/"):
            small = im.convert("RGBA").resize((20, 20), Image.LANCZOS)
            s = np.array(small).astype(int)
            white = ((s[..., :3] > 205).all(axis=2) & (s[..., 3] > 200)).sum()
            blue = ((s[..., 3] > 200) & (s[..., :3] < 205).any(axis=2)).sum()
            if white < 8 or blue < 60:
                msg.append("20x20 too faint (white=%d blue=%d)" % (white, blue))
            print("  %-20s white@20=%d blue@20=%d" % (rel, white, blue))
        if msg:
            bad.append((rel, "; ".join(msg)))
    for rel, why in bad:
        print("FAIL", rel, "-", why)
    print("check: %d/%d files OK" % (len(EXPECT) - len(bad), len(EXPECT)))
    return 0 if not bad else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", default=os.path.join(os.environ.get("TEMP", "/tmp"), "aokana_preview"))
    ap.add_argument("--check", action="store_true", help="只校验已产出的素材，不重新渲染")
    args = ap.parse_args()

    if args.check:
        raise SystemExit(check_assets())

    os.makedirs(os.path.join(ASSETS, "v1"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, "statusbar"), exist_ok=True)
    os.makedirs(os.path.join(ASSETS, "icons"), exist_ok=True)

    # 中文版为主交付；英文 / 双拼版名牌字不同，一并产出供三套 .ssf 使用
    panel = build_panel_v("中文")
    panel.save(os.path.join(ASSETS, "v1", "panel_v.png"))
    build_panel_v("英文").save(os.path.join(ASSETS, "v1", "panel_v_en.png"))
    build_panel_v("双拼").save(os.path.join(ASSETS, "v1", "panel_v_sp.png"))

    bar = build_statusbar()
    bar.save(os.path.join(ASSETS, "statusbar", "bar.png"))

    icons = {}
    for text, stem in (("中", "cn"), ("英", "en"), ("A", "a")):
        for idx, col in ((1, ICON_BLUE), (2, ICON_HOVER), (3, ICON_PRESS)):
            im = build_icon(text, col)
            im.save(os.path.join(ASSETS, "icons", "%s%d.png" % (stem, idx)))
            icons[(stem, idx)] = im

    # ---- 预览（只写临时目录，不进 assets） ----
    os.makedirs(args.preview, exist_ok=True)
    sheet = Image.new("RGBA", (1500, 1120), (232, 244, 249, 255))
    d = ImageDraw.Draw(sheet)
    d.rectangle([0, 0, 1500, 8], fill=(76, 195, 247, 255))
    sheet.alpha_composite(panel, (40, 40))
    sheet.alpha_composite(bar, (40, 520))
    tmp_bar = Image.new("RGBA", (340, 50), (0, 0, 0, 0))
    tmp_bar.alpha_composite(bar.resize((340, 50), Image.LANCZOS))
    for i, key in enumerate([("cn", 1), ("a", 1), ("en", 1), ("cn", 3), ("a", 3)]):
        tmp_bar.alpha_composite(icons[key].resize((20, 20), Image.LANCZOS), (24 + i * 40, 15))
    sheet.alpha_composite(tmp_bar.resize((680, 100), Image.LANCZOS), (760, 520))
    for i, key in enumerate([("cn", 1), ("en", 1), ("a", 1), ("cn", 2), ("en", 2), ("a", 2), ("cn", 3), ("en", 3), ("a", 3)]):
        sheet.alpha_composite(icons[key], (40 + i * 62, 700))
    for i, key in enumerate([("cn", 1), ("en", 1), ("a", 3)]):
        ic1 = icons[key].resize((20, 20), Image.LANCZOS)
        sheet.alpha_composite(ic1.resize((160, 160), Image.NEAREST), (40 + i * 200, 860))
    f = load_font(22)
    d.text((40, 490), "bar.png 680x100 @2x", font=f, fill=(30, 72, 96))
    d.text((40, 10), "panel_v.png 522x428 @2x", font=f, fill=(30, 72, 96))
    d.text((760, 650), "icons 40x40 @2x (1x = 20x20)", font=f, fill=(30, 72, 96))
    d.text((40, 820), "1x 实际像素 x8", font=f, fill=(30, 72, 96))
    sheet.convert("RGB").save(os.path.join(args.preview, "sheet.png"))
    print("done ->", ASSETS)
    raise SystemExit(check_assets())


if __name__ == "__main__":
    main()