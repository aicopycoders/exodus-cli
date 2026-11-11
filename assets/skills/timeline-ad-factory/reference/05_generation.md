# 05: Generation (models, costs, gotchas)

Everything runs through Kie.ai with ONE key. 1 Kie credit = $0.005. Prices change, so the scripts read real costs back from Kie (`creditsConsumed`) after every run.

## Models used

| Job | Kie model | Notes |
|---|---|---|
| Character sheet | `gpt-image-2-text-to-image` | 16:9 grid of 6 poses |
| Storyboard panels | `gpt-image-2-image-to-image` | Character sheet(s) as reference; one image per panel, at the ad's aspect ratio |
| Voiceover (default) | `elevenlabs/text-to-speech-multilingual-v2` on Kie | Voiced line by line, measured, joined (Kie returns no word timestamps). Voice = Kie voice ID, picked by name. |
| Voiceover (option) | ElevenLabs API directly (`eleven_multilingual_v2` /with-timestamps) | User's own `ELEVENLABS_API_KEY`. One continuous read with exact word timing. Same voice IDs. |
| Video (DEFAULT) | `gemini-omni-video` (Google Omni) | Clips of 4/6/8/10s only. Panels go in as ordered reference images. |
| Video (upgrade) | `bytedance/seedance-2-5` | 5-15s clips. Panels are stitched into one horizontal strip used as a "shot list". |
| Music | Suno via `api/v1/generate` | Instrumental bed, trimmed and faded to length |

## Omni first, Seedance for winners

Real A/B on the same 1:52 ad (same script, voice and storyboards; only the video model changed):
- Seedance 2.5 at 1080p: **$92.43**
- Seedance 2.5 at 720p: ~$37 (list price)
- Omni at 1080p: **$7.98**

Seedance moves a little better. Not 11x better. Test every new concept in Omni. Re-render a proven winner in Seedance only if the user wants more motion.

Omni per-clip cost (1080p, measured): 4s = 63 credits ($0.32), 6s = 84 ($0.42), 8s = 105 ($0.53), 10s = 126 ($0.63).

## Omni prompt dialect

- **Positive language only.** Say what IS on screen ("the frame stays purely visual; screens show only colorful pictures"). Negative lists ("NO text, NO captions") prime the very artifact on Omni.
- **Ordered references:** "Image 1 shows the opening moment of this shot. Image 2 shows the final moment." Then the scene and timed beats.
- **Motion rider:** energetic continuous motion, every second has visible action, camera movement or a transformation; squash-and-stretch, anticipation and follow-through, weighty comic impacts.
- Omni adds its own audio. The scripts strip it.
- **"Protected or restricted IP" blocks come from the IMAGE, not the prompt** (tested: the same frame blocked with a one-line harmless prompt; the same prompt passed with a different frame). The usual trigger is a Pixar-style skeleton with painted sugar-skull / Day of the Dead face markings, which reads as Pixar's Coco. `gen_images.py` now forces plain, unpainted skulls on every frame, and `gen_video.py` automatically redraws any blocked frame (plain skull, wider framing) and retries. Failed tasks aren't charged.

## Seedance prompt (riders that each kill one failure)

- R1 no text: video models love burning in fake subtitles.
- R2 shot list: "The reference image is a SHOT LIST showing the N frames you must render in sequence as ONE continuous scene. Do NOT render the frame gaps."
- MOTION: no static held frames longer than 0.5s.
- PHYSICS: squash-and-stretch, anticipation, follow-through.
- BEATS: timed actions.
- GLOBAL: same character design every shot, exactly one of each character, no letters on screens or papers.
Settings: audio OFF, duration = the VO window rounded up, 5-15s.

## Gotchas we already paid for

- **Kie's voice model returns NO word timestamps** even with `timestamps: true`, and the `voice` field needs Kie's voice ID, not the name. `gen_vo.py` handles both.
- **Kie's voice service can go down** ("Internal Error, Please try again later" on every request, even one line). Finished lines are kept on re-run; with an ElevenLabs key the ad switches to ElevenLabs.

- **TTS spells out ALL-CAPS words.** `gen_vo.py` lowercases everything except a short acronym whitelist. Write numbers as spoken words in the script.
- **Captions can split number lists** ("SEVEN, / EIGHT AND NINE-FIGURE"). Avoid comma-separated numbers in the script.
- **Side characters drift more than the hero.** Give every recurring side character a reference sheet.
- **Brand logos sneak onto devices** (an Apple logo on an iMac). Add "unbranded" to every device in the set description.
- **Don't fix it in the edit.** Fix the panel or beats and re-render that one shot (`--only 5`).
- **Render everything in parallel.** Total wait = the slowest single clip, not all of them back to back.
- **Log every task ID.** `cost_report.py` turns them into a real dollar figure.
