"""First-run setup: checks Python, Pillow, ffmpeg and curl, then saves the Kie.ai API key to .env.
Usage: python scripts/setup_check.py            (run from the folder you'll keep your projects in)"""
import os, re, shutil, subprocess, sys

ok = True
print("Checking your setup...\n")
if sys.version_info < (3, 9):
    print(f"[X] Python {sys.version.split()[0]} is too old. Install Python 3.9 or newer from python.org."); ok = False
else:
    print(f"[ok] Python {sys.version.split()[0]}")

try:
    import PIL  # noqa
    print("[ok] Pillow (image tools)")
except ImportError:
    print("[..] Installing Pillow (image tools)...")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "pillow"])
    print("[ok] Pillow installed" if r.returncode == 0 else "[X] Could not install Pillow. Run: pip install pillow"); ok &= r.returncode == 0

for tool, how in (("ffmpeg", "Mac: brew install ffmpeg   |   Windows: winget install Gyan.FFmpeg  (then close and reopen the terminal)"),
                  ("ffprobe", "comes with ffmpeg"),
                  ("curl", "ships with Mac and Windows 10+")):
    if shutil.which(tool) or shutil.which(tool + ".exe"):
        print(f"[ok] {tool}")
    else:
        print(f"[X] {tool} not found. {how}"); ok = False

env = os.path.join(os.getcwd(), ".env")
have = os.path.exists(env) and re.search(r"^[ \t]*KIE_API_KEY[ \t]*=[ \t]*\S", open(env, encoding="utf-8").read(), re.M) is not None
if have:
    print("[ok] Kie.ai API key already saved in .env")
else:
    # Exodus install: never prompt for a key (Claude can't type into a prompt, and a key must never go through the chat).
    print("\n[X] No Kie.ai API key in .env yet (kie.ai -> sign in -> API Keys). Add it one of two ways, then run this again:")
    print("    1. If the key is saved in the Exodus dashboard: npx @aicopycoders/exodus keys pull")
    print("    2. Or open .env in this folder yourself and add the line: KIE_API_KEY=your-key")
    print("    Never paste the key into the chat."); ok = False

if ok and "ELEVENLABS_API_KEY" not in open(env, encoding="utf-8").read():
    print()
    print("Optional: an ElevenLabs API key. With it you can voice ads on ElevenLabs directly (exact word timing),")
    print("and it backs up Kie if Kie's voice service is down. To add it, open .env yourself and add the line")
    print("ELEVENLABS_API_KEY=your-key (or save it in the Exodus dashboard and run: npx @aicopycoders/exodus keys pull).")

if ok:
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import kie
        bal = kie._req("https://api.kie.ai/api/v1/chat/credit").get("data")
        print(f"[ok] Kie.ai key works. Credits on the account: {bal} (about ${float(bal) * 0.005:.2f})")
    except Exception as e:
        print(f"[X] The key didn't work: {e}"); ok = False

print("\nAll set." if ok else "\nFix the [X] items above, then run this again.")
