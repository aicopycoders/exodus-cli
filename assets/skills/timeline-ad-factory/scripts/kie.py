"""Minimal Kie.ai client shared by every script. Reads KIE_API_KEY from the environment or a .env file
(current folder, then the skill folder). Logs every task id to <project>/tasks.log for cost_report.py."""
import json, os, re, shutil, subprocess, sys, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.dirname(HERE)

def _load_key():
    if os.environ.get("KIE_API_KEY"):
        return os.environ["KIE_API_KEY"].strip()
    for p in (os.path.join(os.getcwd(), ".env"), os.path.join(SKILL, ".env")):
        if os.path.exists(p):
            m = re.search(r"^[ \t]*KIE_API_KEY[ \t]*=[ \t]*(\S[^\r\n]*?)[ \t\r]*$", open(p, encoding="utf-8").read(), re.M)
            if m:
                return m.group(1).strip().strip("\"'")
    sys.exit("No Kie.ai API key found. Run: python scripts/setup_check.py")

KEY = _load_key()

def _env_value(name):
    v = os.environ.get(name, "").strip()
    for p in (os.path.join(os.getcwd(), ".env"), os.path.join(SKILL, ".env")):
        if not v and os.path.exists(p):
            m = re.search(rf"^[ \t]*{name}[ \t]*=[ \t]*(\S[^\r\n]*?)[ \t\r]*$", open(p, encoding="utf-8").read(), re.M)
            v = m.group(1).strip().strip("\"'") if m else ""
    return v

try: _ELEVEN = _env_value("ELEVENLABS_API_KEY")
except Exception: _ELEVEN = ""

def _hide_keys(text):
    for v in (KEY, _ELEVEN):
        if v: text = text.replace(v, "***")
    return text

class _HideKeys:
    # Everything the scripts print, errors and exit messages included, goes through here, so no key is ever shown.
    def __init__(self, f): self._f = f
    def write(self, s): return self._f.write(_hide_keys(s))
    def __getattr__(self, n): return getattr(self._f, n)
sys.stdout, sys.stderr = _HideKeys(sys.stdout), _HideKeys(sys.stderr)

def _plain(t, e, tb):
    # One plain sentence instead of a traceback.
    where, msg = "", str(e)
    while tb is not None:
        if os.path.dirname(os.path.abspath(tb.tb_frame.f_code.co_filename)) == HERE:
            where = f" in {os.path.basename(tb.tb_frame.f_code.co_filename)} line {tb.tb_lineno}"
        tb = tb.tb_next
    sys.stderr.write(f"Stopped{where}: {t.__name__}: {msg}\n")
sys.excepthook = _plain
threading.excepthook = lambda x: _plain(x.exc_type, x.exc_value, x.exc_traceback)

class _DropKeysOnRedirect(urllib.request.HTTPRedirectHandler):
    # A redirect never carries the Kie or ElevenLabs key to another address.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            for h in ("Authorization", "Xi-api-key"):
                new.headers.pop(h, None); new.unredirected_hdrs.pop(h, None)
        return new
urllib.request.install_opener(urllib.request.build_opener(_DropKeysOnRedirect))

H = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
LOG = None  # set by scripts to <project>/tasks.log

def _req(url, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=H, method="POST" if data else "GET")
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read())

def _log(kind, tid, note=""):
    if LOG:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": time.time(), "kind": kind, "task": tid, "note": note}) + "\n")

def create(model, inp, note=""):
    last = None
    for a in range(5):
        try:
            j = _req("https://api.kie.ai/api/v1/jobs/createTask", {"model": model, "input": inp})
            if j.get("code") == 200:
                tid = j["data"]["taskId"]
                try: _log(model, tid, note)
                except OSError: pass  # the task is already bought: a log failure must not buy it again
                return tid
            last = f"{j.get('code')} {j.get('msg')}"
            if j.get("code") in (401, 402):  # bad key / no credits: retrying won't help
                break
        except Exception as e:
            last = str(e)
        time.sleep(5 * (a + 1))
    raise RuntimeError(f"createTask failed for {model}: {last}")

def wait(tid, timeout=1800, poll=8):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            d = _req(f"https://api.kie.ai/api/v1/jobs/recordInfo?taskId={tid}", timeout=30)["data"]
        except Exception:
            time.sleep(poll); continue
        if d.get("state") == "success":
            rj = d.get("resultJson"); rj = json.loads(rj) if isinstance(rj, str) else (rj or {})
            return rj
        if d.get("state") == "fail":
            raise RuntimeError(f"task failed: {d.get('failMsg')}")
        time.sleep(poll)
    raise RuntimeError(f"timeout waiting for {tid}")

def first_url(rj):
    for f in ("resultUrls", "urls", "imageUrls", "audioUrls", "output", "audio_url", "url"):
        v = rj.get(f)
        if v:
            return v[0] if isinstance(v, list) else v
    raise RuntimeError(f"no url in result: {str(rj)[:300]}")

def record(tid):
    return _req(f"https://api.kie.ai/api/v1/jobs/recordInfo?taskId={tid}", timeout=30)["data"]

MAX_DOWNLOAD = 2 * 1024 ** 3  # 2 GB per file
def download(url, out):
    # https only, into the file the caller names (always inside the project), with a size and a 20-minute limit.
    if not str(url).startswith("https://"):
        raise RuntimeError("Kie sent a download link that isn't https, so it wasn't downloaded")
    t0, n, part = time.time(), 0, out + ".part"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp, open(part, "wb") as f:
            if not resp.geturl().startswith("https://"):
                raise RuntimeError("Kie's download link redirected away from https, so it wasn't downloaded")
            while True:
                b = resp.read1(1 << 20)  # returns as data arrives, so the time limit is checked while it trickles
                if not b: break
                n += len(b)
                if n > MAX_DOWNLOAD or time.time() - t0 > 1200:
                    raise RuntimeError("the download was too big or too slow, so it was stopped")
                f.write(b)
        os.replace(part, out)
    finally:
        if os.path.exists(part): os.remove(part)

def upload(path, upath="timeline-ad-factory"):
    curl = shutil.which("curl") or shutil.which("curl.exe")
    if not curl:
        sys.exit("curl is needed to upload images to Kie (it ships with Mac and Windows 10+).")
    out = subprocess.run([curl, "-s", "--max-time", "120", "-X", "POST",
                          "https://kieai.redpandaai.co/api/file-stream-upload",
                          "-H", f"Authorization: Bearer {KEY}", "-F", 'file=@"' + path.replace("\\", "\\\\").replace('"', '\\"') + '"', "-F", f"uploadPath={upath}"],
                         capture_output=True, text=True).stdout
    d = json.loads(out)["data"]
    return d.get("downloadUrl") or d.get("fileUrl") or d.get("url")

def inside(base, p):
    base, p = (os.path.normcase(os.path.realpath(x)) for x in (base, p))
    try: return os.path.commonpath([base, p]) == base
    except ValueError: return False

def project(path):
    """Load project.json and point the task log at the project folder."""
    global LOG
    path = os.path.abspath(path)
    if not inside(os.getcwd(), path):
        sys.exit("The project folder has to be inside the folder you're working in, e.g. projects/<name>.")
    LOG = os.path.join(path, "tasks.log")
    return path, json.load(open(os.path.join(path, "project.json"), encoding="utf-8"))

def save(path, P):
    json.dump(P, open(os.path.join(path, "project.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
