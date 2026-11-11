"""Instrumental music bed through Suno on Kie. Optional, but it lifts the ad a lot.
  python scripts/gen_music.py <project>
Reads project.json "music": {"style": "...", "title": "..."}. If missing, builds a default from the ad's style.
Write the style as an emotional ARC that follows the script, e.g.
  "playful animated-film score, mischievous pizzicato intro, building bouncy momentum, triumphant brass swagger, warm tender moment near the end, bold final hit"
Saves two takes to audio/ and picks take 1 as audio/music.mp3 (swap it if take 2 is better).
"""
import json, os, shutil, sys, time, urllib.request
import kie

root, P = kie.project(sys.argv[1])
if "--estimate" in sys.argv[2:]:
    raise SystemExit("gen_music.py has no --estimate: it spends when run (Suno through Kie, about $0.10 or less per song).")
m = P.get("music") or {}
style = m.get("style") or ("upbeat playful animated-film score for a Pixar-style comedy ad, curious intro, building momentum, "
                           "triumphant swagger, short warm moment, bold final hit, instrumental only")
body = {"customMode": True, "instrumental": True, "style": style[:950], "title": (m.get("title") or P.get("name", "Timeline Ad"))[:80],
        "model": "V5", "negativeTags": "vocals, singing, choir, rap", "callBackUrl": "https://example.com/callback"}
j = kie._req("https://api.kie.ai/api/v1/generate", body)
if j.get("code") != 200:
    body["model"] = "V4_5PLUS"; j = kie._req("https://api.kie.ai/api/v1/generate", body)
if j.get("code") != 200: raise SystemExit(f"Suno request failed: {j}")
tid = j["data"]["taskId"]; kie._log("suno", tid, "music")
os.makedirs(os.path.join(root, "audio"), exist_ok=True)
for _ in range(90):
    time.sleep(10)
    d = kie._req(f"https://api.kie.ai/api/v1/generate/record-info?taskId={tid}")["data"]
    st = d.get("status") or ""
    print(st, flush=True)
    if st == "SUCCESS":
        outs = []
        for i, s in enumerate(d["response"]["sunoData"]):
            o = os.path.join(root, "audio", f"music_take{i+1}.mp3"); kie.download(s["audioUrl"], o); outs.append(o)
        shutil.copy(outs[0], os.path.join(root, "audio", "music.mp3"))
        print("Saved:", *outs, sep="\n  "); print("Using take 1 as audio/music.mp3"); break
    if "FAIL" in st or "ERROR" in st: raise SystemExit(f"Suno failed: {d}")
