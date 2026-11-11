# Timeline Ad Factory: setup

Turn a brief, a sales page, or the transcript of ANY winning ad into a finished, voiced, captioned timeline video ad. Built for Claude Code or Codex. Runs on one Kie.ai account.

## What you need

1. **Claude Code or Codex**, installed and signed in.
2. **A Kie.ai account with credits.** (Optional: an ElevenLabs API key, if you'd rather voice your ads on ElevenLabs directly, or as a backup when Kie's voice service is down.)
   **Kie:** Sign in at kie.ai, open API Keys, and copy your key. One 60-90 second ad on Google Omni usually costs a few dollars in video, plus cents for images, voice and music.
3. **Python 3.9+** and **ffmpeg** on your computer. The skill checks both on first run and walks you through installing anything missing.

## Install

**Claude Code:** copy this whole `timeline-ad-factory` folder into `~/.claude/skills/` (Mac) or `C:\Users\<you>\.claude\skills\` (Windows). Restart Claude Code. Then just ask: *"Make me a timeline ad for [product]"* or *"Turn this winning ad into timeline ads: [paste transcript]"*.

**Codex:** put this folder inside the project folder you work in, and keep the `AGENTS.md` file from this folder at the top of that project (or paste its contents into your existing `AGENTS.md`). Then ask the same way.

## First run

The skill runs `python scripts/setup_check.py`, which checks your tools and asks for your Kie.ai key once. The key is saved to a `.env` file in your folder. Keep that file private.

## How a run goes

1. **Elements:** it pulls the winning variables out of your input and proposes 3 angles. You pick.
2. **Script:** it writes the timeline script and self-checks it. You approve or edit.
3. **Storyboard:** it casts a voice that fits your market, designs the character and the set, and plans every shot. You approve.
4. **Images:** character sheet first (you approve), then every storyboard frame (you approve).
5. **Video:** voiceover, a cost estimate (you say go), clips on Google Omni by default, music, final edit with captions and date stamps, and the real cost.

Nothing that costs real money runs until you say yes.

## Omni or Seedance?

Default is **Google Omni**: about 11x cheaper than Seedance at the same resolution, and close enough in motion for testing. When an ad wins, you can re-render it on **Seedance 2.5** for extra motion: *"re-render this ad on Seedance at 720p"*.

## Files in each project

`projects/<name>/` holds `project.json` (every decision), `script.txt`, `images/`, `audio/`, `videos/`, `final/ad.mp4`, and `tasks.log` (every paid job, used for the cost report).
