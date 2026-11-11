"""Character sheets and storyboard panels via GPT-Image-2 on Kie.
  python scripts/gen_images.py <project> --sheet [--only hero,wife]   (re-runs: delete the png to regenerate)
  python scripts/gen_images.py <project> --panels [--only 3,7]        (each panel = its own image at the ad's aspect ratio)
  python scripts/gen_images.py <project> --panels --only 3.1,9.2      (redo single panels: shot.panel)
  Per-panel cast: a shot can set "panel_cast": [["wife"], ["dad","wife"]] so only those characters appear in each panel.
"""
import argparse, os, threading, time
import kie

ap = argparse.ArgumentParser(); ap.add_argument("project"); ap.add_argument("--sheet", action="store_true")
ap.add_argument("--panels", action="store_true"); ap.add_argument("--only", default=""); ap.add_argument("--wider", action="store_true", help="redraw as a medium-wide shot (used after a copyright block)")
a = ap.parse_args()
root, P = kie.project(a.project)
only = [x.strip() for x in a.only.split(",") if x.strip()]
os.makedirs(os.path.join(root, "images", "panels"), exist_ok=True)
lock = threading.Lock()
def log(*x):
    with lock: print(*x, flush=True)

CLEAN = "NO text, NO labels, NO letters, NO numbers, NO watermarks, NO subtitles anywhere; screens and papers show only colorful abstract pictures."
# Omni's copyright filter blocks frames that look like Pixar's Coco (skeleton + painted sugar-skull face). Keep every skull plain.
ORIGINAL = ("An ORIGINAL character design: every skull is plain, smooth ivory bone with NO face paint, NO sugar-skull or Day of the Dead "
            "markings, NO decorative patterns or flowers on the bones. ")

def cast_all():
    return [P["character"]] + [c for c in P.get("extra_cast", []) if c.get("lock")]

def sheet_path(name):
    if any(ch in name for ch in '/\\:*?"<>|'): raise SystemExit(f"Character name '{name}' can't contain / \\ : * ? \" < > | (it becomes a file name).")
    return os.path.join(root, "images", f"sheet_{name}.png")

def make_sheet(c):
    out = sheet_path(c["name"])
    if os.path.exists(out): log(f"[sheet {c['name']}] exists, skipping (delete it to redo)"); return
    prompt = ORIGINAL + (c.get("sheet_prompt") or (f"{P['style']} character model sheet of ONE original character: {c['lock']}. "
              "A clean 3x2 grid of SIX full-body poses with a big expression range on a neutral warm-grey studio background. "
              "Cinematic three-point lighting, charming not scary, EXACTLY ONE character per pose. " + CLEAN))
    tid = kie.create("gpt-image-2-text-to-image", {"prompt": prompt, "aspect_ratio": "16:9"}, note=f"sheet {c['name']}")
    kie.download(kie.first_url(kie.wait(tid, 600, 5)), out); log(f"[sheet {c['name']}] done -> {out}")

def make_panel(s, i, text, urls):
    out = os.path.join(root, "images", "panels", f"shot_{s['id']:02d}_p{i+1}.png")
    if only and str(s["id"]) not in only and f"{s['id']}.{i+1}" not in only: return
    if os.path.exists(out) and not only: return
    pc = s.get("panel_cast", [])
    names = pc[i] if i < len(pc) and pc[i] else s.get("cast", [P["character"]["name"]])
    who = " ".join(f"The {c['name']} is {c['lock']}, matching its reference sheet EXACTLY." for c in cast_all() if c["name"] in names)
    who += " Only these characters appear in this frame." 
    prompt = (f"A single cinematic {P['style']} movie still. {ORIGINAL}{who} Unless described otherwise the setting is {P['set']}. "
              f"SCENE (follow the location described here over the default setting): {text}. " + ("Frame it as a MEDIUM-WIDE shot with the characters smaller in frame. " if a.wider else "") + "Big readable cartoon acting, one clear moment. EXACTLY ONE of each character. Body mechanics are physically correct: every character faces the direction they are moving, weight is on the feet, knees and elbows bend naturally, nothing floats. {CLEAN}")
    for t in range(3):
        try:
            tid = kie.create("gpt-image-2-image-to-image", {"prompt": prompt, "image_urls": urls, "aspect_ratio": P.get("aspect_ratio", "9:16")},
                             note=f"panel {s['id']}.{i+1}")
            kie.download(kie.first_url(kie.wait(tid, 600, 5)), out); log(f"[shot {s['id']} panel {i+1}] done"); return
        except Exception as e:
            log(f"[shot {s['id']} panel {i+1}] retry {t}: {e}"); time.sleep(8)
    log(f"[shot {s['id']} panel {i+1}] FAILED")

for c in cast_all(): sheet_path(c["name"])  # check every name before anything is bought
if a.sheet:
    ths = [threading.Thread(target=make_sheet, args=(c,)) for c in cast_all() if not only or c["name"] in only]
    [t.start() for t in ths]; [t.join() for t in ths]

if a.panels:
    missing = [c["name"] for c in cast_all() if not os.path.exists(sheet_path(c["name"]))]
    if missing: raise SystemExit(f"Make and approve the character sheet(s) first: {missing}")
    sheet_urls = {c["name"]: kie.upload(sheet_path(c["name"])) for c in cast_all()}
    ths = []
    for s in P["shots"]:
        if only and str(s["id"]) not in only and not any(o.startswith(f"{s['id']}.") for o in only): continue
        urls = [sheet_urls[n] for n in s.get("cast", [P["character"]["name"]]) if n in sheet_urls] or [sheet_urls[P["character"]["name"]]]
        for i, text in enumerate(s["panels"]):
            t = threading.Thread(target=make_panel, args=(s, i, text, urls)); t.start(); ths.append(t); time.sleep(1)
    [t.join() for t in ths]
    log("panels done. Next: python scripts/contact_sheet.py " + a.project)
