"""Final assembly: fit every shot to its voiceover window, burn in captions + date stamps + end card, mix voice and music.
  python scripts/assemble.py <project>          -> <project>/final/ad.mp4 (+ ad_preview.mp4, small enough to send to a phone)
"""
import json, os, re, subprocess, sys
import kie

root, P = kie.project(sys.argv[1])
SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}
W, H = SIZES.get(P.get("aspect_ratio", "9:16"), (1080, 1920))
FIN = os.path.join(root, "final"); os.makedirs(FIN, exist_ok=True)
VID = os.path.join(root, "videos")

def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                capture_output=True, text=True).stdout.strip())

# 1) fit each shot to its VO window
parts = []
for s in P["shots"]:
    src = os.path.join(VID, f"shot_{s['id']:02d}.mp4")
    if not os.path.exists(src): raise SystemExit(f"Missing video for shot {s['id']}. Run gen_video.py --only {s['id']}")
    w = s["t1"] - s["t0"]; f = w / dur(src); out = os.path.join(VID, f"fit_{s['id']:02d}.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-an", "-vf",
                    f"setpts={f:.5f}*PTS,scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps=30,format=yuv420p",
                    "-t", f"{w:.3f}", "-c:v", "libx264", "-preset", "fast", "-crf", "18", out], check=True)
    parts.append(out); print(f"shot {s['id']}: fitted to {w:.2f}s (speed x{1/f:.2f})")
open(os.path.join(VID, "concat.txt"), "w").write("".join(f"file '{os.path.basename(p)}'\n" for p in parts))
pic = os.path.join(FIN, "_picture.mp4")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(VID, "concat.txt"), "-c", "copy", pic], check=True)
total = dur(pic)

# 2) captions, stamps, end card (ASS subtitles; the AI never renders text)
def ts(t):
    t = max(t, 0); return f"{int(t//3600)}:{int(t%3600//60):02d}:{t%60:05.2f}"
words = json.load(open(os.path.join(root, "audio", "words.json"), encoding="utf-8"))
chunks, cc = [], []
for k, wd in enumerate(words):
    cc.append(wd)
    gap = words[k + 1]["s"] - wd["e"] if k + 1 < len(words) else 9
    if len(cc) >= 4 or gap > 0.4 or wd["w"].endswith((".", ",", "?", "!", "...")):
        chunks.append(cc); cc = []
if cc: chunks.append(cc)
cap, stamp, cta = int(H * 0.04), int(H * 0.075), int(H * 0.045)
marg = int(H * 0.22) if H > W else int(H * 0.07)   # keep vertical captions above the feed's UI
L = ["[Script Info]", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "", "[V4+ Styles]",
     "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
     f"Style: Cap,Arial Black,{cap},&H00FFFFFF,&H00101010,&H96000000,-1,6,0,2,60,60,{marg}",
     f"Style: Stamp,Arial Black,{stamp},&H0016C8F5,&H00101010,&H96000000,-1,9,3,8,60,60,{int(H*0.12)}",
     f"Style: CTA,Arial Black,{cta},&H0016C8F5,&H00101010,&HC8000000,-1,6,0,5,70,70,0",
     "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
end_lines = [x for x in P.get("end_card", []) if x]
end_t = total - 3.5 if end_lines else total + 1
for k, c in enumerate(chunks):
    t0 = c[0]["s"]; t1 = c[-1]["e"] + 0.1
    if k + 1 < len(chunks): t1 = min(t1, chunks[k + 1][0]["s"] - 0.01)
    if t0 >= end_t: continue
    txt = " ".join(w["w"] for w in c).upper().replace("{", "").replace("}", "")
    for w, say in P.get("pronounce", {}).items():   # captions show the real word, not the phonetic spelling
        txt = re.sub(r"(?i)" + re.escape(say) + r"", w.upper(), txt)
    L.append(f"Dialogue: 0,{ts(t0)},{ts(min(t1, end_t))},Cap,,0,0,0,,{txt}")
for st in P.get("stamps", []):
    if st.get("at") is None: continue
    L.append(f"Dialogue: 1,{ts(st['at']-0.15)},{ts(st['at']+2.8)},Stamp,,0,0,0,,"
             f"{{\\fad(120,300)\\t(0,180,\\fscx118\\fscy118)\\t(180,360,\\fscx100\\fscy100)}}{st['label']}")
if end_lines:
    body = "\\N".join(x.upper() if i == 0 else "{\\c&HFFFFFF&}" + x for i, x in enumerate(end_lines))
    L.append(f"Dialogue: 2,{ts(end_t)},{ts(total)},CTA,,0,0,0,,{{\\fad(300,0)}}{body}")
open(os.path.join(FIN, "captions.ass"), "w", encoding="utf-8").write("\n".join(L))

# 3) mix + burn (run inside the final folder so the subtitles path has no drive letters to escape)
music = os.path.join(root, "audio", "music.mp3")
inputs = ["-i", "_picture.mp4", "-i", os.path.join(root, "audio", "vo.mp3")]
fc = ["[1:a]volume=1.0[v]"]; labels = ["[v]"]
if os.path.exists(music):
    inputs += ["-stream_loop", "-1", "-i", music]
    fc.append(f"[2:a]volume=-17dB,afade=t=in:d=1,afade=t=out:st={max(total-3,0):.2f}:d=3[m]"); labels.append("[m]")
fc.append("[0:v]subtitles=captions.ass[vout]")
fc.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0,alimiter=limit=0.95[aout]")
subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc), "-map", "[vout]", "-map", "[aout]",
                "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.2f}", "ad.mp4"],
               check=True, cwd=FIN)
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", "ad.mp4", "-vf", ("scale=720:-2" if H > W else "scale=1280:-2"), "-c:v", "libx264",
                "-preset", "veryfast", "-crf", "27", "-c:a", "aac", "-b:a", "128k", "ad_preview.mp4"], check=True, cwd=FIN)
print(f"Final ad: {os.path.join(FIN, 'ad.mp4')}  ({total:.1f}s)")
print(f"Phone preview: {os.path.join(FIN, 'ad_preview.mp4')}")
print("Next: python scripts/contact_sheet.py " + sys.argv[1] + " --final   and   python scripts/cost_report.py " + sys.argv[1])
