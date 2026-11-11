---
name: ugc-preproduction
description: Turn a UGC script into a realistic phone-filmed video with the UGC video kit's preproduction sheet. Use when someone pastes a talking-to-camera script and wants it made into a video, or says "run the preproduction sheet", "start the sheet" or "make this UGC script into a video".
---

# UGC preproduction

One person talking to their own phone, made from a script. The kit's sheet does the work; this skill gets it running, walks the steps in order and checks what lands.

## 1. Find the kit
Look for a folder named `ugc-video-kit` (it holds `setup.sh`, `start.sh` and `ugc/lab/serve.py`). Check the project folder, then the home folder: `ls -d ~/ugc-video-kit ~/*/ugc-video-kit 2>/dev/null`. If there is none, tell the person to download `ugc-video-kit.zip` from the Generating SOP tab and unzip it outside iCloud, then stop.

## 2. Set it up the first time
If `ugc-video-kit/ugc/lab/.venv_face/bin/python` or `ugc-video-kit/models/` is missing, run `./setup.sh` in the kit folder and show what it prints. It installs Homebrew packages, the kit's Python packages and a 575 MB speech model.

## 3. Keys
The kit reads `ugc-video-kit/.env`. Check which of these are filled, without printing any key:
`grep -Ec '^(KIE_API_KEY|OPENROUTER_API_KEY)=.{8,}' .env` must say 2.
- `KIE_API_KEY` and `OPENROUTER_API_KEY` are required.
- `ELEVENLABS_API_KEY` is needed to give new people a voice.
- `FAL_KEY` is only needed for the finish with moving b-roll, music or ultra realism.
Never ask the person to paste a key into the chat. Ask them to open `.env` and paste it there.

## 4. Start a sheet
Run `./start.sh <name>` in the kit folder, one short name per video idea (letters and numbers only). It prints the address, for example `http://127.0.0.1:8796/pd?run=<name>`, and opens it. Give the person that link.

## 5. Ask once, in plain text
Ask for: the script, the product link (or a product photo), and whether to run the first take only (to check the look) or the whole video, at full or draft size. Recommend first take at draft size for a new script. Say the price before anything is run:
1. A person made from the script: about 10 cents.
2. A 25 second take: about $5, or about $2.30 at draft size.
3. A 75 second video: about $15, or about $7 at draft size.
4. Finishing a 75 second video with moving b-roll and music: about $3.50.

## 6. The steps on the sheet, in order
The person clicks; you explain each step in one line and say what you recommend.
1. Script. Paste it. Eight people are made from it on their own.
2. Who says it. Pick one of the eight. "A new person for this script" makes one more from a short description.
3. Voice. Comes with the person.
4. How it is filmed. Holding the phone, phone put down, both, or someone else films.
5. Where. One to three places. With one place, keep "the same room in every take" on.
6. Realism. Leave on.
7. Retention. Two small things happen in each take.
8. Product. Paste the link and pick a picture, or drop a photo, then pick "Use the product".
9. Hooks. Pick the opening line and the opening picture. "Test the openings" makes short drafts of just the openings.
10. Run. RIP IT. Never press it twice: check `ugc/lab/runs/` and `ps aux | grep sheet_run.py` first.

## 7. After it lands
Takes land in `ugc/lab/projects/furlife/TAKES/`, joined videos in `TESTS/SCENES/`, finished ones in `TESTS/FINISHED/`. The sheet shows them under "check for new clips" (it never refreshes by itself).
1. Check every take says every word of the script and nothing extra at the end.
2. Score each take and write what is wrong and where the fix belongs: script, person, voice, place, realism, retention, camera, product, hook.
3. Finish from the "Your runs" tab: the finish bar under each landed cycle.

## If something fails
- Read `ugc/lab/serve.log` and `ugc/lab/sheet_run.log`, last 40 lines.
- "402" or "credits" in the log: the Kie balance is too low.
- A take is missing from a joined video: it may still be rendering; wait, then check "check for new clips" again.
