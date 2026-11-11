"""Storyboard review board for the approval gate: every frame next to the voiceover line it has to act out.
  python scripts/contact_sheet.py <project>            -> <project>/storyboard_board.jpg (+ storyboard_board.html)
  python scripts/contact_sheet.py <project> --final    -> frames from the finished ad, <project>/final_sheet.jpg
Show the board to the user BEFORE any video is generated. Judge each frame: does the picture literally DO its line?
"""
import html, json, os, subprocess, sys, textwrap
from PIL import Image, ImageDraw, ImageFont

root = os.path.abspath(sys.argv[1]); final = "--final" in sys.argv
_cwd, _root = (os.path.normcase(os.path.realpath(x)) for x in (os.getcwd(), root))
try: _ok = os.path.commonpath([_cwd, _root]) == _cwd
except ValueError: _ok = False
if not _ok: raise SystemExit("The project folder has to be inside the folder you're working in, e.g. projects/<name>.")
if final:
    src = os.path.join(root, "final", "ad.mp4"); out = os.path.join(root, "final_sheet.jpg")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", "fps=1/3,scale=320:-2,tile=6x6", "-frames:v", "1", out], check=True)
    print(out); raise SystemExit

P = json.load(open(os.path.join(root, "project.json"), encoding="utf-8"))
def font(sz, bold=False):
    for f in (("arialbd.ttf" if bold else "arial.ttf"), ("Arial Bold.ttf" if bold else "Arial.ttf"), "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"):
        try: return ImageFont.truetype(f, sz)
        except Exception: pass
    return ImageFont.load_default()
F_H, F_T, F_S = font(26, True), font(20), font(17)
TW = 240  # thumbnail width
rows = []
for s in P["shots"]:
    ims = []
    for i in range(len(s["panels"])):
        p = os.path.join(root, "images", "panels", f"shot_{s['id']:02d}_p{i+1}.png")
        if os.path.exists(p):
            im = Image.open(p).convert("RGB"); im = im.resize((TW, int(im.height * TW / im.width))); ims.append((i + 1, im))
    rows.append((s, ims))

W = 1500; pad = 20; text_x = pad + 3 * (TW + 12) + 10
blocks = []
for s, ims in rows:
    h_img = max([im.height for _, im in ims] or [200]) + 30
    lines = "\n".join(f"“{l}”" for l in s["lines"])
    wrapped = []
    for para in lines.split("\n"): wrapped += textwrap.wrap(para, 62) or [""]
    pw = []
    for k, ptxt in enumerate(s["panels"]): pw += textwrap.wrap(f"Panel {k+1}: {ptxt}", 80)
    h_txt = 40 + 26 * len(wrapped) + 12 + 21 * len(pw)
    blocks.append((s, ims, wrapped, pw, max(h_img, h_txt) + pad))
H = sum(b[-1] for b in blocks) + pad
S = Image.new("RGB", (W, H), (22, 18, 14)); d = ImageDraw.Draw(S); y = pad
for s, ims, wrapped, pw, h in blocks:
    d.rectangle([pad // 2, y - 6, W - pad // 2, y + h - pad + 2], outline=(70, 60, 48))
    x = pad
    for k, im in ims:
        S.paste(im, (x, y + 24)); d.text((x, y), f"panel {k}", font=F_S, fill=(246, 198, 82)); x += TW + 12
    stamp = next((st["label"] for st in P.get("stamps", []) if st.get("say", "").lower() in " ".join(s["lines"]).lower()), "")
    d.text((text_x, y), f"SHOT {s['id']}  {s.get('label','')}" + (f"   [stamp: {stamp}]" if stamp else ""), font=F_H, fill=(246, 198, 82))
    ty = y + 40
    for w in wrapped: d.text((text_x, ty), w, font=F_T, fill=(255, 255, 255)); ty += 26
    ty += 12
    for w in pw: d.text((text_x, ty), w, font=F_S, fill=(185, 173, 152)); ty += 21
    y += h
out = os.path.join(root, "storyboard_board.jpg"); S.save(out, quality=85)

# Same board as a scrollable web page (bigger images, easy to review on any screen)
cards = []
for s, ims in rows:
    imgs = "".join(f'<img src="images/panels/shot_{s["id"]:02d}_p{k}.png">' for k, _ in ims)
    cards.append(f'<div class="c"><div class="im">{imgs}</div><div class="tx"><h3>Shot {s["id"]} &middot; {html.escape(s.get("label",""))}</h3>'
                 + "".join(f'<p class="vo">&ldquo;{html.escape(l)}&rdquo;</p>' for l in s["lines"])
                 + "".join(f'<p class="pn">Panel {k+1}: {html.escape(t)}</p>' for k, t in enumerate(s["panels"])) + "</div></div>")
open(os.path.join(root, "storyboard_board.html"), "w", encoding="utf-8").write(
    "<!doctype html><meta charset='utf-8'><title>Storyboard</title><style>body{background:#16120e;color:#f4eede;font:16px Arial;margin:20px}"
    ".c{display:flex;gap:18px;border:1px solid #463c30;padding:14px;margin:0 0 16px}.im{display:flex;gap:8px}.im img{height:340px;border-radius:4px}"
    "h3{color:#f6c652;margin:0 0 8px}.vo{font-size:20px;font-weight:bold;margin:4px 0}.pn{color:#b9ad98;font-size:14px}</style>"
    f"<h1>{html.escape(P.get('name','Storyboard'))}: storyboard</h1><p>Does every frame literally DO its line? Name any frame to redo as shot.panel (e.g. 3.1).</p>"
    + "".join(cards))
print(out); print(os.path.join(root, "storyboard_board.html"))
