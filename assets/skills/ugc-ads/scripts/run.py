#!/usr/bin/env python3
"""Run a UGC bot on Genesis and check what comes back. Shared by the ugc-swipe, ugc-template and ugc-write skills.

  python3 -I run.py swipe    --brand B --product FILE|TEXT --ad FILE|TEXT [--level 1|2|3] [--mode options|write] [--pick N|TEXT] [--count N]
  python3 -I run.py template --brand B --product FILE|TEXT [--type "Failed-Fixes Story, Live Demo"|auto] [--mode hooks|write] [--hook N|TEXT] [--person TEXT]
  python3 -I run.py write    --brand B --product FILE|TEXT [--mode angles|write] [--angle N|TEXT] [--buyer --problem --mechanism --proof --offer TEXT]
  common: [--count N] [--length SECONDS] [--notes TEXT] [--fallback yes|no] [--dry]

Calls the agent slug through .claude/skills/genesis-bots/scripts/genesis-stream.mjs (one stream at a time). If the Anthropic key is capped,
retries through OpenRouter (slug@anthropic/claude-sonnet-5.5). Checks each script: spoken word count against the length, the product named,
no dashes, no expert speaker. Saves ugc/<brand>/<kind>-<time>/ (request.txt, raw.md, scripts.md, check.txt).
Exit: 0 ok, 3 a check failed (script still shown), 4 capped and fallback off, 1 bot error, 2 usage."""
import argparse, datetime, json, os, re, subprocess, sys
SLUG = {"swipe": "ugc-swipe-agent", "template": "ugc-template-agent", "write": "ugc-write-agent"}
def root():
    d = os.getcwd()
    while d != "/":
        if os.path.exists(f"{d}/.claude/skills/genesis-bots/scripts/genesis-stream.mjs"): return d
        d = os.path.dirname(d)
    sys.exit("genesis-bots skill not found above this folder")
def text(v):
    if v and os.path.isfile(v):
        f = os.path.realpath(v)
        if not f.startswith(os.path.realpath(R) + os.sep): print(f"{v} is outside this project folder, so it was not read; save it inside the project and run again."); sys.exit(2)
        if any(x.startswith(".") for x in os.path.relpath(f, os.path.realpath(R)).split(os.sep)): print(f"{v} is a hidden file or in a hidden folder (like .env), so it was not read."); sys.exit(2)
        try: return open(f).read().strip()
        except (OSError, UnicodeDecodeError): print(f"Could not read {v}; check the file and run again."); sys.exit(2)
    return (v or "").strip()
INJECT = re.compile(r"(ignore (all |any )?(previous|prior) instructions|system prompt|you are (now )?an? (assistant|ai|bot)|repeat your (prompt|instructions))", re.I)
def scrub(s):
    lines = [l for l in s.splitlines() if not INJECT.search(l)]
    if len(lines) != len(s.splitlines()): print("note: dropped lines addressed to an assistant from the input")
    return "\n".join(lines)
p = argparse.ArgumentParser(); p.add_argument("kind", choices=SLUG)
for a in ["brand", "product", "ad", "level", "mode", "pick", "type", "hook", "person", "angle", "buyer", "problem", "mechanism", "proof", "offer", "count", "length", "notes", "fallback"]: p.add_argument("--" + a)
p.add_argument("--dry", action="store_true"); o = p.parse_args()
if not o.product: sys.exit("need --product")
if o.kind == "swipe" and not o.ad: sys.exit("swipe needs --ad")
R = root(); brand = re.sub(r"[^A-Za-z0-9_-]+", "-", o.brand or "").strip("-") or "brand"
req = []
if o.kind == "swipe": req.append("AD:\n" + scrub(text(o.ad)))
req.append("PRODUCT:\n" + scrub(text(o.product)))
for k in ["buyer", "problem", "mechanism", "proof", "offer", "pick", "type", "hook", "person", "angle", "notes"]:
    v = getattr(o, k)
    if v: req.append(f"{k.upper()}: {scrub(text(v))}")
for k in ["level", "mode", "count", "length"]:
    v = getattr(o, k)
    if v: req.append(f"{k.upper()}: {v}")
request = "\n\n".join(req)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
out = f"{R}/ugc/{brand}/{o.kind}-{stamp}"; os.makedirs(out, exist_ok=True)
open(f"{out}/request.txt", "w").write(request)
if o.dry: print(request); print(f"\n(dry run, saved {out}/request.txt)"); sys.exit(0)
stream = f"{R}/.claude/skills/genesis-bots/scripts/genesis-stream.mjs"
def go(model, env):
    try: r = subprocess.run(["node", stream, model, f"{out}/request.txt", f"{out}/raw.md"], cwd=R, env=env, capture_output=True, text=True, timeout=900)
    except FileNotFoundError: print("bot error: Node.js is not installed (no node command), so the bot was not called; install Node.js and run again."); sys.exit(1)
    except subprocess.TimeoutExpired: print("bot error: the bot did not answer within 15 minutes, so the call was stopped."); sys.exit(1)
    body = open(f"{out}/raw.md").read() if os.path.exists(f"{out}/raw.md") else ""
    return r.returncode, body, (r.stderr or r.stdout)[-600:]
env = dict(os.environ); code, body, err = go(SLUG[o.kind], env)
capped = bool(re.search(r"usage limit|credit balance|rate.?limit|quota", err + body[:300], re.I))
if (code or not body.strip()) and capped:
    if (o.fallback or "yes").lower().startswith("n"): print("Anthropic key is capped and fallback is off."); sys.exit(4)
    env["ANTHROPIC_API_KEY"] = ""; code, body, err = go(SLUG[o.kind] + "@anthropic/claude-sonnet-5.5", env)
if code or not body.strip(): print("bot error:", err.strip()[:400]); sys.exit(1)
blocks = re.findall(r"```[a-z]*\n(.*?)```", body, re.S) or ([body] if "SCRIPT:" in body else [])
names = [w for w in re.findall(r"[A-Z][\w+&'-]{2,}", text(o.product).split("\n")[0])][:3]
checks, bad = [], False
for i, b in enumerate(blocks, 1):
    words = len(re.findall(r"[A-Za-z0-9']+", b)); secs = int(o.length) if o.length else 0
    issues = []
    if secs and not (secs * 3.3 * .7 <= words <= secs * 3.3 * 1.3): issues.append(f"{words} words for {secs}s (aim {round(secs*3.3)})")
    if not secs and not 100 <= words <= 320: issues.append(f"{words} words, outside the 45 to 90 second default")
    if re.search(r"[—–]", b): issues.append("has dashes")
    if re.search(r"[\[\]()]", b): issues.append("has tags")
    if re.search(r"\b(as a (doctor|nurse|dermatologist|pharmacist|vet|trainer|scientist)|I'?m a (doctor|nurse|dermatologist|pharmacist|vet)|in scrubs|lab coat)\b", b, re.I): issues.append("expert speaker")
    if names and not any(n.lower() in b.lower() for n in names): issues.append("product not named: " + "/".join(names))
    checks.append(f"script {i}: {words} words (about {round(words/3.3)}s)" + (" · " + "; ".join(issues) if issues else " · ok")); bad |= bool(issues)
open(f"{out}/scripts.md", "w").write("\n\n".join(f"```\n{b.strip()}\n```" for b in blocks) if blocks else body)
open(f"{out}/check.txt", "w").write("\n".join(checks) or "options / hooks / angles: no script checks")
print(body.strip()); print("\n---\n" + ("\n".join(checks) if checks else "(no scripts to check)")); print(f"saved {out}")
sys.exit(3 if bad else 0)
