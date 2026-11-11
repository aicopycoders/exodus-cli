"""Director Test on the rendered clips, BEFORE final assembly.
  python scripts/review_clips.py <project> [--only 3,7]   -> <project>/review/shot_XX.jpg (one strip per shot, ~2 frames per second)
                                                              + <project>/review/all_clips.jpg (every strip stacked, labeled)
Look at every strip and answer the Director Test for each shot (see reference/04_storyboard.md):
  - Is each character FACING the direction they move? (No walking up stairs backwards, no moonwalking.)
  - Do bodies move like real bodies? (Feet on the ground, knees and elbows bend the right way, weight supported, nobody floating.)
  - Any extra or missing limbs/fingers, melting faces, duplicate characters, or a character who shouldn't be there?
  - Any words, letters or logos that crept in?
  - Does the clip act out its line? Right location, costume and props?
Re-render failures with: python scripts/gen_video.py <project> --only <ids>  (fix the panel or beats first if the frame caused it)
"""
import glob, json, os, subprocess, sys
from PIL import Image, ImageDraw

root = os.path.abspath(sys.argv[1])
_cwd, _root = (os.path.normcase(os.path.realpath(x)) for x in (os.getcwd(), root))
try: _ok = os.path.commonpath([_cwd, _root]) == _cwd
except ValueError: _ok = False
if not _ok: raise SystemExit("The project folder has to be inside the folder you're working in, e.g. projects/<name>.")
only = set()
if "--only" in sys.argv: only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
P = json.load(open(os.path.join(root, "project.json"), encoding="utf-8"))
R = os.path.join(root, "review"); os.makedirs(R, exist_ok=True)
strips = []
for s in P["shots"]:
    if only and str(s["id"]) not in only: continue
    src = os.path.join(root, "videos", f"shot_{s['id']:02d}.mp4")
    if not os.path.exists(src): print(f"shot {s['id']}: no clip yet"); continue
    out = os.path.join(R, f"shot_{s['id']:02d}.jpg")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", "fps=2,scale=180:-2,tile=10x1", "-frames:v", "1", out], check=True)
    strips.append((s, out))
if strips:
    ims = [(s, Image.open(p).convert("RGB")) for s, p in strips]
    W = max(im.width for _, im in ims); H = sum(im.height + 30 for _, im in ims)
    S = Image.new("RGB", (W, H), (20, 16, 12)); d = ImageDraw.Draw(S); y = 0
    for s, im in ims:
        d.text((6, y + 8), f"SHOT {s['id']} {s.get('label','')}: " + " / ".join(s["lines"])[:150], fill=(246, 198, 82))
        S.paste(im, (0, y + 30)); y += im.height + 30
    out = os.path.join(R, "all_clips.jpg"); S.save(out, quality=82); print(out)
