#!/usr/bin/env python3
"""重新繪製 App 圖示 (高解析度、向量式繪製，不是放大參考圖)。
顏色從 tools/icon_reference.jpg 取樣；輸出到 ../icons/。需要 Pillow 與 numpy。
用法：python3 make_icons.py
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "icons")
ref = Image.open(os.path.join(HERE, "icon_reference.jpg")).convert("RGB")
a = np.array(ref).astype(int)

def median(mask):
    return tuple(int(v) for v in np.median(a[mask], axis=0))

def upper(mask, q=80):
    px = a[mask]; keep = px.sum(axis=1) >= np.percentile(px.sum(axis=1), q)
    return tuple(int(v) for v in np.median(px[keep], axis=0))

H, Wd = a.shape[:2]
yy, xx = np.mgrid[0:H, 0:Wd]
BG = median((xx < 40) | (xx > 215) | (yy < 18) | (yy > 240))                       # 背景綠
DARK = median((xx > 62) & (xx < 190) & (yy > 125) & (yy < 160) & (a[:, :, 0] < 40)) # 體重計深色
bright = (a[:, :, 0] > 130) & (a[:, :, 2] > 150)
LIGHT = upper(bright & (xx > 75) & (xx < 185) & (yy > 85) & (yy < 190))            # 刀叉
bars = (a[:, :, 0] > 100) & (abs(a[:, :, 0] - a[:, :, 1]) < 35) & (yy > 196) & (yy < 228)
BAR = upper(bars & (xx > 55) & (xx < 210))                                          # 條碼灰
LCD = (int(BG[0] + 22), int(BG[1] + 14), int(BG[2] + 14))                            # 比背景亮一點的液晶
DIGIT = (int(DARK[0] + 3), int(DARK[1] + 15), int(DARK[2] + 10))                     # 液晶上的深色數字
boost = lambda c, k: tuple(min(255, int(v * k)) for v in c)
LIGHT, BAR = boost(LIGHT, 1.10), boost(BAR, 1.12)
print("colors:", dict(BG=BG, DARK=DARK, LIGHT=LIGHT, BAR=BAR, LCD=LCD, DIGIT=DIGIT))

def draw_icon(fraction, W=2048):
    """fraction：內容高度占畫布的比例 (一般圖示 0.80；maskable 要留安全區 0.62)"""
    img = Image.new("RGB", (W, W), BG)
    s = fraction * W / 800.0                      # 參考圖座標 (4 倍放大) → 畫布
    ox, oy = W / 2 - 520 * s, W / 2 - 510 * s
    T = lambda x, y: (ox + x * s, oy + y * s)
    d = ImageDraw.Draw(img)

    # 體重計本體
    d.rounded_rectangle([T(228, 110), T(813, 675)], radius=50 * s, fill=DARK)
    # 液晶 + 「00」七段顯示
    d.rounded_rectangle([T(370, 162), T(672, 296)], radius=9 * s, fill=LCD)
    t, g = 13, 3
    for x0 in (515, 588):
        x1, y0, y1 = x0 + 60, 184, 276
        ym = (y0 + y1) / 2
        segs = [((x0 + t + g, y0), (x1 - t - g, y0 + t)), ((x0 + t + g, y1 - t), (x1 - t - g, y1)),
                ((x0, y0 + t + g), (x0 + t, ym - g)), ((x1 - t, y0 + t + g), (x1, ym - g)),
                ((x0, ym + g), (x0 + t, y1 - t - g)), ((x1 - t, ym + g), (x1, y1 - t - g))]
        for p, q in segs:
            d.rectangle([T(*p), T(*q)], fill=DIGIT)

    def poly(pts, origin, ang):
        c, sn = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        return [T(origin[0] + x * c - y * sn, origin[1] + x * sn + y * c) for x, y in pts]

    def with_end(left, length, r):
        """沿軸向的長條 (left 為一側輪廓)，尾端接半圓"""
        cx = length - r
        arc = [(cx + r * math.cos(math.radians(t)), r * math.sin(math.radians(t))) for t in range(-90, 91, 10)]
        right = [(x, -y) for x, y in reversed(left)]
        return left + arc + right

    # 叉子 (軸向 45°，叉尖在左上、握把在右下)
    fork_origin, Lf = (352, 392), 474
    fork_left = [(90, -53), (112, -52), (132, -42), (148, -25), (162, -14), (Lf - 20, -17)]
    fork_parts = [poly(with_end(fork_left, Lf, 18), fork_origin, 45)]
    for yc in (-46, -15.5, 15.5, 46):
        fork_parts.append(poly([(2, yc - 7.5), (110, yc - 7.5), (110, yc + 7.5), (2, yc + 7.5), (0, yc + 5), (0, yc - 5)], fork_origin, 45))
    # 刀子 (軸向 135°，刀尖在右上、握把在左下)
    knife_origin, Lk = (722, 352), 520
    knife_pts = [(0, 0), (285, 17), (Lk - 17, 17)]
    def belly_w(x):                                   # 刀刃腹部的寬度：快速變寬、平緩圓弧、在護手處收回握把寬度
        if x <= 250: return 68 * (1 - (1 - x / 250.0) ** 2.2)
        return 17 + (68 - 17) * (1 - (x - 250) / 42.0) ** 2 if x < 292 else 17
    belly = [(x, -belly_w(x)) for x in range(6, 293, 6)] + [(292, -17), (Lk - 17, -17)]
    arc = [(Lk - 17 + 17 * math.cos(math.radians(t)), 17 * math.sin(math.radians(t))) for t in range(-90, 91, 10)]
    knife_poly = poly([(0, 0)] + belly + arc + [(285, 17)], knife_origin, 135)

    def mask_of(polys):
        m = Image.new("L", (W, W), 0); md = ImageDraw.Draw(m)
        for p in polys: md.polygon(p, fill=255)
        return m

    def dilate(m, r):                              # 用模糊 + 門檻值把形狀外擴約 r 像素
        return m.filter(ImageFilter.GaussianBlur(r / 1.75)).point(lambda v: 255 if v > 10 else 0)

    fork_m, knife_m = mask_of(fork_parts), mask_of([knife_poly])
    union = Image.composite(Image.new("L", (W, W), 255), fork_m, knife_m)
    img.paste(DARK, mask=dilate(union, 15 * s))   # 刀叉伸出體重計外時的深色外框
    img.paste(LIGHT, mask=fork_m)
    img.paste(DARK, mask=dilate(knife_m, 9 * s))  # 刀子壓在叉子上的分隔線
    img.paste(LIGHT, mask=knife_m)

    # 下方的條碼與像素方塊
    for x0, x1 in [(228, 248), (276, 300), (306, 324), (336, 364), (394, 424), (450, 498), (508, 554), (568, 598)]:
        d.rectangle([T(x0, 790), T(x1, 908)], fill=BAR)
    for x0, x1, y0, y1 in [(665, 712, 788, 828), (732, 776, 788, 828), (665, 712, 858, 902), (755, 804, 860, 908)]:
        d.rectangle([T(x0, y0), T(x1, y1)], fill=BAR)
    return img

def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)

os.makedirs(OUT, exist_ok=True)
std = draw_icon(0.80)          # 一般圖示、iOS 主畫面圖示
mask = draw_icon(0.62)         # maskable：內容縮小，避免被圓形 / 圓角遮罩裁掉
save(std, "icon-512.png", 512); save(std, "icon-192.png", 192); save(std, "apple-touch-icon.png", 180)
save(mask, "icon-maskable-512.png", 512)
print("icons written to", os.path.abspath(OUT))
