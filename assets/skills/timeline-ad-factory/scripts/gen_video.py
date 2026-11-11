"""Video clips for every shot. Omni (Google) by default; Seedance 2.5 as the upgrade.
  python scripts/gen_video.py <project> --estimate                       (clip plan + cost for both models, spends nothing)
  python scripts/gen_video.py <project> [--model omni|seedance] [--resolution 1080p|720p] [--only 3,7]
Run gen_vo.py first: shot lengths come from the voiceover timestamps.
"""
import argparse, json, math, os, subprocess, sys, threading, time
from PIL import Image
import kie

ap = argparse.ArgumentParser(); ap.add_argument("project"); ap.add_argument("--model", default="omni", choices=["omni", "seedance"])
ap.add_argument("--resolution", default=""); ap.add_argument("--only", default=""); ap.add_argument("--estimate", action="store_true")
a = ap.parse_args()
root, P = kie.project(a.project)
only = {x.strip() for x in a.only.split(",") if x.strip()}
AR = P.get("aspect_ratio", "9:16")
VID = os.path.join(root, "videos"); os.makedirs(VID, exist_ok=True)
lock = threading.Lock()
def log(*x):
    with lock: print(*x, flush=True)

if any("t0" not in s for s in P["shots"]):
    raise SystemExit("Shots aren't timed yet. Run: python scripts/gen_vo.py " + a.project)

def secs(b):
    x, y = b[0].rstrip("s").split("-"); return float(x), float(y)

OMNI_LEN = (4, 6, 8, 10)
OMNI_CREDITS = {4: 63, 6: 84, 8: 105, 10: 126}          # measured at 1080p, Nov 2026
SEED_CREDITS = {"1080p": 158, "720p": 63, "480p": 28}  # per second, image input, Kie list price Nov 2026

def omni_len(span):
    for d in OMNI_LEN:
        if d >= span - 0.6: return d
    return 10

def omni_plan(s):
    """Split a shot into Omni clips (each <= 10s), on beat boundaries."""
    w = s["t1"] - s["t0"]; beats = s.get("beats") or [[f"0-{math.ceil(w)}s", " ".join(s["panels"])]]
    if w <= 10.5 or len(beats) == 1:
        return [(list(range(len(beats))), omni_len(w))]
    groups, cur, cur0 = [], [], 0.0
    scale = w / max(secs(beats[-1])[1], 0.1)
    for i, b in enumerate(beats):
        if cur and (secs(b)[1] - cur0) * scale > 10.4:
            groups.append(cur); cur = []; cur0 = secs(b)[0]
        cur.append(i)
    groups.append(cur)
    return [(g, omni_len((secs(beats[g[-1]])[1] - secs(beats[g[0]])[0]) * scale)) for g in groups]

def panel_paths(s):
    return [os.path.join(root, "images", "panels", f"shot_{s['id']:02d}_p{i+1}.png") for i in range(len(s["panels"]))]

if a.estimate:
    oc = 0; secs_seed = 0; n = 0
    print(f"{'shot':>4} {'VO secs':>8}  Omni clips")
    for s in P["shots"]:
        plan = omni_plan(s); oc += sum(OMNI_CREDITS[d] for _, d in plan); n += len(plan)
        sd = max(5, min(15, math.ceil(s["t1"] - s["t0"]))); secs_seed += sd
        print(f"{s['id']:>4} {s['t1']-s['t0']:8.1f}  {[d for _, d in plan]}")
    print(f"\nOmni 1080p:      {n} clips, ~{oc} credits = ~${oc*0.005:.2f}")
    for r in ("720p", "1080p"):
        c = secs_seed * SEED_CREDITS[r]; print(f"Seedance {r:>5}:  {len(P['shots'])} clips, ~{c} credits = ~${c*0.005:.2f}")
    print("(Estimates from Kie prices as of Nov 2026. cost_report.py gives the real number after the run.)")
    raise SystemExit

CHAR = P["character"]["lock"]
CAST = {c["name"]: c["lock"] for c in [P["character"]] + P.get("extra_cast", []) if c.get("lock")}

def who(s):
    return " ".join(f"The {n} is {CAST[n]} and keeps exactly this design the whole time." for n in s.get("cast", [P["character"]["name"]]) if n in CAST)

def omni_prompt(s, idx, n_img, t0, scale, skip_desc=""):
    roles = " ".join(f"Image {j+1} shows {'the opening moment' if j == 0 and n_img > 1 else ('the final moment' if j == n_img - 1 else 'a middle moment')} of this shot." for j in range(n_img))
    beats = " ".join(f"[{(secs(s['beats'][i])[0]-t0)*scale:.0f}-{(secs(s['beats'][i])[1]-t0)*scale:.0f}s] {s['beats'][i][1]}." for i in idx) if s.get("beats") else ""
    desc = " ".join(s["panels"][i] + "." for i in idx if i < len(s["panels"]))
    return (f"One continuous animated shot. The reference images are the key moments of this shot, in order. {roles} "
            f"Move smoothly from one key moment to the next as one flowing scene. {who(s)} Each character appears exactly once. "
            f"Unless described otherwise the setting is {P['set']}. Scene: {desc} {skip_desc} Timing: {beats} "
            "Energetic, continuous motion from the first frame to the last: every second has visible character action, camera movement "
            "or a transformation in progress. Big cartoon acting with squash-and-stretch, anticipation and follow-through, smooth arcs and "
            f"weighty comic impacts, at full frame rate. Biomechanics stay real: every character faces the direction they travel and walks forward, on stairs they face up the stairs while climbing and step onto the next higher step, weight shifts foot to foot, joints bend the natural way, and nothing moves in reverse. The frame stays purely visual: the animated scene is the only thing on screen, and "
            f"every monitor, screen and sheet of paper shows only colorful pictures. {P['style']}, cinematic lighting.")

def run_omni(s, res):
    panels = panel_paths(s); parts = []
    for si, (idx, d) in enumerate(omni_plan(s)):
        out = os.path.join(VID, f"shot_{s['id']:02d}_{si}.mp4"); parts.append(out)
        if os.path.exists(out) and not only: continue
        t0 = secs(s["beats"][idx[0]])[0] if s.get("beats") else 0
        t1 = secs(s["beats"][idx[-1]])[1] if s.get("beats") else d
        scale = d / max(t1 - t0, 0.1)
        img_idx = [i for i in idx if i < len(panels) and os.path.exists(panels[i])] or [0]
        refused = 0; redrawn = False
        for t in range(7):
            if refused >= 2 and not redrawn:
                # Omni's copyright filter flagged the frame(s) (usually a skull that looks like Pixar's Coco).
                # Redraw them automatically with the plain-skull rule and a wider framing, then try again.
                ids = ",".join(f"{s['id']}.{i+1}" for i in img_idx)
                log(f"[shot {s['id']}.{si}] Omni blocked the frame(s) as protected IP; redrawing {ids} and retrying")
                subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen_images.py"),
                                root, "--panels", "--only", ids, "--wider"], check=False)
                redrawn = True; refused = 0
            use = img_idx if (refused < 2 or redrawn) else img_idx[-1:]
            skip = "" if use == img_idx else "The earlier moment is described in words only."
            try:
                urls = [kie.upload(panels[i]) for i in use]
                tid = kie.create("gemini-omni-video", {"prompt": omni_prompt(s, idx, len(use), t0, scale, skip), "image_urls": urls,
                                 "duration": d, "aspect_ratio": AR, "resolution": res}, note=f"omni shot {s['id']}.{si} {d}s")
                log(f"[shot {s['id']}.{si}] omni {d}s submitted")
                kie.download(kie.first_url(kie.wait(tid, 1800, 10)), out); break
            except Exception as e:
                if "protected" in str(e).lower() or "restricted" in str(e).lower(): refused += 1
                log(f"[shot {s['id']}.{si}] retry {t}: {e}"); time.sleep(10)
    return parts

def strip(s):
    """Seedance takes ONE reference image: stitch the panels side by side into a shot-list strip."""
    ims = [Image.open(p).convert("RGB") for p in panel_paths(s) if os.path.exists(p)]
    h = 720; ims = [im.resize((int(im.width * h / im.height), h)) for im in ims]; gap = 16
    S = Image.new("RGB", (sum(im.width for im in ims) + gap * (len(ims) - 1), h), "black"); x = 0
    for im in ims: S.paste(im, (x, 0)); x += im.width + gap
    out = os.path.join(VID, f"strip_{s['id']:02d}.png"); S.save(out); return out, len(ims)

def run_seedance(s, res):
    out = os.path.join(VID, f"shot_{s['id']:02d}_0.mp4")
    if os.path.exists(out) and not only: return [out]
    sp, n = strip(s); d = max(5, min(15, math.ceil(s["t1"] - s["t0"])))
    beats = " ".join(f"[{b[0]}] {b[1]}." for b in s.get("beats", []))
    prompt = ("ABSOLUTELY NO SUBTITLES, NO CAPTIONS, NO OVERLAY TEXT, NO BURNED-IN TYPOGRAPHY OF ANY KIND. The output frame contains ONLY the rendered scene. "
              "This is a SILENT video for separate audio overlay in post-production. "
              f"The reference image is a SHOT LIST showing the {n} frames you must render in sequence as ONE continuous scene. Do NOT render the frame gaps "
              "or any storyboard layout in your output. Animate ONLY the scene content, transitioning smoothly between the frames in order, full-frame single composition. "
              "Aggressive motion throughout, NO static held frames longer than 0.5s, every second has visible character action OR camera movement OR transformation in progress. "
              "PHYSICS: squash-and-stretch on every action, anticipation and follow-through, smooth arcs, weight-believable comic impacts. NO stop-motion, NO freeze frames. "
              "BIOMECHANICS: every character faces the direction they travel and walks FORWARD, never backward; climbing stairs = facing up the stairs; joints bend naturally; nothing moves in reverse. "
              f"{beats} GLOBAL: Maintain exact storyboard continuity. {who(s)} EXACTLY ONE of each character, NO twins. NO visible storyboard panel borders, NO panel numbers, "
              "NO titles, NO subtitles, NO logos, NO letters on screens or papers. Continuous animated motion at full frame rate.")
    for t in range(3):
        try:
            tid = kie.create("bytedance/seedance-2-5", {"prompt": prompt, "reference_image_urls": [kie.upload(sp)], "aspect_ratio": AR,
                             "resolution": res, "duration": d, "generate_audio": False}, note=f"seedance shot {s['id']} {d}s")
            log(f"[shot {s['id']}] seedance {d}s submitted")
            kie.download(kie.first_url(kie.wait(tid, 2400, 12)), out); break
        except Exception as e:
            log(f"[shot {s['id']}] retry {t}: {e}"); time.sleep(15)
    return [out]

def run(s):
    try:
        res = a.resolution or ("1080p" if a.model == "omni" else "720p")
        parts = run_omni(s, res) if a.model == "omni" else run_seedance(s, res)
        if not all(os.path.exists(p) for p in parts): log(f"[shot {s['id']}] INCOMPLETE, re-run with --only {s['id']}"); return
        lst = os.path.join(VID, f"shot_{s['id']:02d}_list.txt")
        open(lst, "w").write("".join(f"file '{os.path.basename(p)}'\n" for p in parts))
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-an", "-c:v", "libx264", "-preset", "fast",
                        "-crf", "18", "-pix_fmt", "yuv420p", os.path.join(VID, f"shot_{s['id']:02d}.mp4")], check=True)
        log(f"[shot {s['id']}] DONE")
    except Exception as e:
        log(f"[shot {s['id']}] FAILED: {e}")

ths = []
for s in P["shots"]:
    if only and str(s["id"]) not in only: continue
    t = threading.Thread(target=run, args=(s,)); t.start(); ths.append(t); time.sleep(2)
for t in ths: t.join()
P["video_model"] = a.model; kie.save(root, P)
print("All shots attempted. Next: python scripts/gen_music.py " + a.project + "  (optional), then python scripts/assemble.py " + a.project)
