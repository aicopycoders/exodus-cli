"""Voiceover, then exact timing for every shot and stamp.
Two voice providers (project.json -> "voice": {"provider": "kie" | "elevenlabs", "name": ...}):
  kie (default, needs only the Kie key): each script line is voiced separately (with the lines around it as
      continuity hints so it reads as one performance), measured, and joined. Shot timing is exact.
  elevenlabs (needs ELEVENLABS_API_KEY in .env): the whole script in one read, with exact word timestamps.
Usage:
  python scripts/gen_vo.py <project>                    (reads script.txt -> audio/vo.mp3 + audio/words.json, times all shots)
  python scripts/gen_vo.py <project> --test-voice NAME  (one line in that voice -> audio/test_NAME.mp3)
  python scripts/gen_vo.py <project> --retime           (re-time shots from the existing audio files)
"""
import argparse, base64, json, os, re, subprocess, threading, time, urllib.request
import kie
from voices import VOICES   # name -> voice ID (same IDs on Kie and ElevenLabs). Preview: https://static.aiquickdraw.com/elevenlabs/voice/<ID>.mp3

ap = argparse.ArgumentParser(); ap.add_argument("project"); ap.add_argument("--test-voice", default="")
ap.add_argument("--retime", action="store_true"); a = ap.parse_args()
root, P = kie.project(a.project)
AUD = os.path.join(root, "audio"); os.makedirs(AUD, exist_ok=True)
MODEL = "elevenlabs/text-to-speech-multilingual-v2"
ACR = set(P.get("acronyms", ["AI"]))
V = P.get("voice", {})

def voice_id(v):
    if v in VOICES.values(): return v
    k = next((n for n in VOICES if n.lower() == v.lower()), None)
    if not k: raise SystemExit(f"Unknown voice '{v}'. Pick one of: {', '.join(VOICES)}")
    return VOICES[k]

PRON = P.get("pronounce", {})   # e.g. {"softgels": "soft jells", "CoQ10": "co Q ten"}: what the VOICE says for tricky words

def speakable(line):
    line = line.replace("(", "").replace(")", "")
    for w, say in PRON.items():
        line = re.sub(r"(?i)" + re.escape(w) + r"", say, line)
    return re.sub(r"\b[A-Z][A-Z']+\b", lambda m: m.group(0) if m.group(0) in ACR else m.group(0).lower(), line).strip()

def norm(w):
    return re.sub(r"[^a-z0-9']", "", w.lower())

def duration(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                capture_output=True, text=True).stdout.strip())

def eleven_key():
    if os.environ.get("ELEVENLABS_API_KEY"): return os.environ["ELEVENLABS_API_KEY"].strip()
    for pth in (os.path.join(os.getcwd(), ".env"), os.path.join(kie.SKILL, ".env")):
        if os.path.exists(pth):
            m = re.search(r"^[ \t]*ELEVENLABS_API_KEY[ \t]*=[ \t]*(\S[^\r\n]*?)[ \t\r]*$", open(pth, encoding="utf-8").read(), re.M)
            if m: return m.group(1).strip().strip("\"'")
    return None

def settings():
    return {"stability": V.get("stability", 0.38), "similarity_boost": V.get("similarity_boost", 0.8),
            "style": V.get("style", 0.4), "speed": V.get("speed", 1.0)}

def kie_line(text, voice, out, prev="", nxt=""):
    inp = {"text": text, "voice": voice_id(voice), **settings(), "previous_text": prev[-1000:], "next_text": nxt[:1000]}
    last = None
    for t in range(4):
        try:
            tid = kie.create(MODEL, inp, note="voiceover line")
            kie.download(kie.first_url(kie.wait(tid, 600, 4)), out); return
        except Exception as e:
            last = e; time.sleep(15 * (t + 1))
    raise RuntimeError(f"Kie voice failed: {last}")

def eleven_full(text, voice, out):
    st = settings()
    body = {"text": text, "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": st["stability"], "similarity_boost": st["similarity_boost"], "style": st["style"],
                               "use_speaker_boost": True, "speed": st["speed"]}}
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id(voice)}/with-timestamps",
                                 data=json.dumps(body).encode(), headers={"xi-api-key": eleven_key(), "Content-Type": "application/json"})
    j = json.loads(urllib.request.urlopen(req, timeout=300).read())
    open(out, "wb").write(base64.b64decode(j["audio_base64"]))
    al = j["alignment"]; words, cur = [], None
    for c, s, e in zip(al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]):
        if c.isspace():
            if cur: words.append(cur); cur = None
            continue
        if cur is None: cur = {"w": c, "s": s, "e": e}
        else: cur["w"] += c; cur["e"] = e
    if cur: words.append(cur)
    return words

def spread(text, t0, t1):
    """Words inside one line, spread across the line's measured time by length."""
    ws = text.split(); chars = sum(len(w) + 1 for w in ws) or 1; t = t0; out = []
    for w in ws:
        d = (t1 - t0) * (len(w) + 1) / chars; out.append({"w": w, "s": round(t, 3), "e": round(t + d * 0.92, 3)}); t += d
    return out

provider = (V.get("provider") or "kie").lower()
voice = V.get("name") or "Brian"
if provider == "elevenlabs" and not eleven_key():
    raise SystemExit("voice.provider is 'elevenlabs' but no ELEVENLABS_API_KEY is in .env. Add it, or set provider to 'kie'.")

if a.test_voice:
    first = next(l for l in open(os.path.join(root, "script.txt"), encoding="utf-8").read().splitlines() if l.strip())
    out = os.path.join(AUD, f"test_{a.test_voice.replace(' ', '_')}.mp3")
    if provider == "elevenlabs": eleven_full(speakable(first), a.test_voice, out)
    else: kie_line(speakable(first), a.test_voice, out)
    print(out); raise SystemExit

lines = [l.strip() for l in open(os.path.join(root, "script.txt"), encoding="utf-8").read().splitlines() if l.strip()]
spoken = [speakable(l) for l in lines]
vo = os.path.join(AUD, "vo.mp3"); wj = os.path.join(AUD, "words.json"); lj = os.path.join(AUD, "lines.json")

if not a.retime:
    if provider == "elevenlabs":
        words = eleven_full("\n".join(spoken), voice, vo)
        idx = 0; line_spans = []
        for sp in spoken:
            n = len(sp.split()); seg = words[idx: idx + n] or words[-1:]
            line_spans.append([seg[0]["s"], seg[-1]["e"]]); idx += n
        if abs(idx - len(words)) > 3:
            print(f"[warn] script has {idx} words but the voice returned {len(words)}. Check numbers/acronyms were read right.")
    else:
        LD = os.path.join(AUD, "lines"); os.makedirs(LD, exist_ok=True)
        outs = [os.path.join(LD, f"line_{i:02d}.mp3") for i in range(len(spoken))]
        errs = []
        def job(i):
            try:
                if not os.path.exists(outs[i]):
                    kie_line(spoken[i], voice, outs[i], " ".join(spoken[max(0, i - 2):i]), " ".join(spoken[i + 1:i + 3]))
            except Exception as e:
                errs.append((i, e))
        ths = [threading.Thread(target=job, args=(i,)) for i in range(len(spoken))]
        for t in ths: t.start(); time.sleep(0.5)
        for t in ths: t.join()
        if errs:
            if eleven_key():
                P.setdefault("voice", {})["provider"] = "elevenlabs"; kie.save(root, P)
                raise SystemExit(f"Kie's voice service failed on {len(errs)} line(s). This ad is now set to use your ElevenLabs key: re-run gen_vo.py.")
            raise SystemExit(f"Kie's voice service failed on {len(errs)} line(s): {errs[0][1]}. Re-run in a few minutes "
                             "(finished lines are kept), or add ELEVENLABS_API_KEY to .env and set voice.provider to 'elevenlabs'.")
        # trim each line's leading/trailing silence, then join with a short natural pause
        GAP = 0.18; parts = []; line_spans = []; t = 0.0
        for i, o in enumerate(outs):
            tr = os.path.join(LD, f"trim_{i:02d}.wav")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", o, "-af",
                            "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
                            "-ar", "44100", "-ac", "1", tr], check=True)
            d = duration(tr); line_spans.append([round(t, 3), round(t + d, 3)]); t += d + GAP; parts.append(tr)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", str(GAP),
                        os.path.join(LD, "gap.wav")], check=True)
        lst = os.path.join(LD, "concat.txt")
        open(lst, "w").write("".join(f"file '{os.path.basename(p)}'\nfile 'gap.wav'\n" for p in parts))
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c:a", "libmp3lame", "-q:a", "2", vo], check=True)
        words = []
        for sp, (s0, s1) in zip(spoken, line_spans): words += spread(sp, s0, s1)
    json.dump(words, open(wj, "w", encoding="utf-8"), indent=1)
    json.dump(line_spans, open(lj, "w"))

words = json.load(open(wj, encoding="utf-8")); line_spans = json.load(open(lj))
total = duration(vo)

# Shots consume script lines in order (works even when two lines are identical, like "Nothing.").
shots = P["shots"]; ptr = 0
for k, s in enumerate(shots):
    start = None
    for l in s["lines"]:
        if ptr >= len(lines) or lines[ptr] != l.strip():
            got = lines[ptr] if ptr < len(lines) else "(end of script)"
            raise SystemExit(f"Shot {s['id']}: expected script line '{got}' but project.json has '{l}'. Shot lines must copy script.txt exactly, in order.")
        if start is None: start = line_spans[ptr][0]
        ptr += 1
    s["t0"] = 0.0 if k == 0 else round(start, 3)
if ptr != len(lines): raise SystemExit(f"{len(lines) - ptr} script line(s) aren't in any shot. Every line needs a shot.")
for k, s in enumerate(shots):
    s["t1"] = shots[k + 1]["t0"] if k + 1 < len(shots) else round(total, 3)
ws = [norm(w["w"]) for w in words]
for st in P.get("stamps", []):
    target = [norm(w) for w in speakable(st["say"]).split()]
    hit = next((i for i in range(len(ws)) if ws[i:i + len(target)] == target), None)
    st["at"] = round(words[hit]["s"], 3) if hit is not None else None
    if hit is None: print(f"[warn] stamp '{st['say']}' not found in the voiceover")
P["vo_seconds"] = round(total, 2); kie.save(root, P)
print(f"Voiceover ({provider}, {voice}): {total:.1f}s  ->  {vo}")
for s in shots: print(f"  shot {s['id']:>2} {s.get('label',''):<10} {s['t0']:7.2f} - {s['t1']:7.2f}  ({s['t1']-s['t0']:.1f}s)")
