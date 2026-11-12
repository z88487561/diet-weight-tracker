#!/usr/bin/env python3
"""依原始碼用到的 Tailwind 顏色 class，產生深色模式 (html.dark) 覆蓋規則。
用法：python3 gen_dark.py <專案根目錄> <colors.json>   (輸出到 stdout)
規則：
  bg-white            → 卡片深色底
  bg / border  50~300 → 深色底 / 邊框 (slate 用固定色階；彩色用半透明色塊，疊在任何底色上都成立)
  text 500~900        → 同色系較亮的色階 (實心按鈕 bg-*-500~900 與 text-white 不動)
"""
import re, sys, os, json
root, colors_path = sys.argv[1], sys.argv[2]
pal = json.load(open(colors_path))
text = "\n".join(open(os.path.join(root, f), encoding="utf-8").read() for f in ("index.html", "js/weight.js"))

FAM = "slate|gray|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose"
TOK = re.compile(r'(?<![\w\-:/\[])((?:(?:hover|focus|active|disabled|focus-within):)*)(bg|text|border(?:-[lrtbxy])?|ring|divide)-(white|' + FAM + r')(?:-(\d{2,3}))?(?:/(\d{1,3}))?(?![\w\-/])')

CARD = "#1e293b"
SLATE_BG = {"50": "#0f172a", "100": "#243146", "200": "#334155", "300": "#475569"}
SLATE_TEXT = {"300": "#64748b", "400": "#7d8ba1", "500": "#94a3b8", "600": "#aab6c8", "700": "#cbd5e1", "800": "#e2e8f0", "900": "#f1f5f9"}
SLATE_BORDER = {"100": "#273449", "200": "#334155", "300": "#475569"}
BG_A = {"50": .12, "100": .18, "200": .28, "300": .40}
BD_A = {"50": .20, "100": .25, "200": .35, "300": .50}
TXT = {"500": "400", "600": "400", "700": "300", "800": "200", "900": "100"}
SIDE = {"l": ["left"], "r": ["right"], "t": ["top"], "b": ["bottom"], "x": ["left", "right"], "y": ["top", "bottom"]}
PSEUDO = {"hover": ":hover", "focus": ":focus", "active": ":active", "disabled": ":disabled", "focus-within": ":focus-within"}

def rgba(h, a):
    return "rgba(%d,%d,%d,%.3f)" % (int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), a)

def esc(tok):
    return re.sub(r'([:/\.\[\]%])', r'\\\1', tok)

def declarations(util, fam, shade, op):
    base = util.split("-")[0]
    side = util.split("-")[1] if "-" in util else None
    k = (op / 100.0) if op else 1.0
    if fam == "white":
        return [("background-color", rgba(CARD, k) if op else CARD)] if base == "bg" else None
    if fam in ("slate", "gray"):
        if base == "bg": c = SLATE_BG.get(shade); return [("background-color", rgba(c, k) if op else c)] if c else None
        if base == "text": c = SLATE_TEXT.get(shade); return [("color", c)] if c else None
        c = SLATE_BORDER.get(shade)
    else:
        c500 = pal[fam]["500"]
        if base == "bg":
            a = BG_A.get(shade); return [("background-color", rgba(c500, a * k))] if a else None
        if base == "text":
            t = TXT.get(shade); return [("color", pal[fam][t])] if t else None
        a = BD_A.get(shade); c = rgba(c500, a) if a else None
        # 單側的強調色條 (例如 border-l-amber-400) 要保留原色，否則會被卡片的 border-color 規則蓋掉
        if side and not c and base == "border" and shade in pal[fam]:
            return [("border-%s-color" % s2, pal[fam][shade]) for s2 in SIDE[side]]
    if not c: return None
    if base == "ring": return [("--tw-ring-color", c)]
    if side: return [("border-%s-color" % s, c) for s in SIDE[side]]
    return [("border-color", c)]

rules = {}
for m in TOK.finditer(text):
    variants, util, fam, shade, op = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
    if fam != "white" and not shade: continue
    d = declarations(util, fam, shade, int(op) if op else None)
    if not d: continue
    token = m.group(0)
    sel = "html.dark ." + esc(token) + "".join(PSEUDO[v] for v in variants.split(":") if v)
    if util == "divide": sel += " > :not([hidden]) ~ :not([hidden])"
    rules[sel] = d

out = ["", "/* ===== 深色模式 (由 tools/gen_dark.py 自動產生) ===== */"]
# 單側邊框 (border-l-* …) 要排在整圈邊框之後，同樣的優先權下才不會被蓋掉
def order(sel): return (1 if re.search(r"\.border-[lrtbxy]-", sel) else 0, sel)
for sel in sorted(rules, key=order):
    out.append("%s{%s}" % (sel, ";".join("%s:%s" % kv for kv in rules[sel])))
out.append("""
/* ===== 深色模式：手寫部分 ===== */
html.dark{background-color:#0f172a}
html.dark .w-card{background-color:#1e293b;border-color:#273449}
html.dark .w-inp{background-color:#0f172a;border-color:#334155}
html.dark .w-lbl{color:#94a3b8}
html.dark .w-btn-s{background-color:#243146;color:#cbd5e1}
html.dark .w-btn-s:hover{background-color:#334155}
html.dark ::placeholder{color:#64748b;opacity:1}
html.dark #toast{background-color:#475569}
html.dark .c-grid{stroke:#334155}
html.dark .c-mu{fill:#94a3b8}
html.dark .c-dot{stroke:#1e293b}
html.dark details>summary::after{color:#64748b}
html.dark select option{background-color:#1e293b;color:#e2e8f0}
html.dark input[type=date]::-webkit-calendar-picker-indicator,html.dark input[type=datetime-local]::-webkit-calendar-picker-indicator,html.dark input[type=time]::-webkit-calendar-picker-indicator{filter:invert(.85)}
""")
sys.stdout.write("\n".join(out))
sys.stderr.write("dark rules: %d\n" % len(rules))
