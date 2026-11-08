# @aicopycoders/exodus

The Exodus CLI + Claude Code skills for the Copycoders ad pipeline. It drives the
Genesis creative bots, workflows, banks, and image/meme pipelines against your
brand — from your terminal and from Claude Code.

You don't install it globally. Run it with `npx` from your workspace folder.

## Quickstart

```bash
# 1. Scaffold (or refresh) the workspace in the current folder
npx -y @aicopycoders/exodus@beta init
```

`init` creates the workspace (the `.claude/` skills, docs, and your brand
subfolder) and prints the next steps. The `@beta` tag is the dev/preview channel;
drop it (`@aicopycoders/exodus`) for the stable release channel.

### Connect your account

1. Open the Exodus dashboard → **Settings → Claude Code**.
2. Copy the `.env` snippet it shows you (your `EXODUS_API_KEY` + dashboard URL)
   and paste it into a `.env` file in your workspace folder.
3. Pull your provider keys down so the local tools have them:

   ```bash
   npx -y @aicopycoders/exodus@beta keys pull
   ```

   This writes your dashboard provider + image keys into `.env` (it only upserts
   those keys and preserves the rest of the file). Values are never printed.

### Check everything is wired up

```bash
npx -y @aicopycoders/exodus@beta doctor
```

`doctor` diagnoses local and dashboard-side issues in one shot — keys, workspace
health, CLI currency — and tells you exactly what to fix.

### Listen to and approve a run's Song

A run that sings its ad holds one Song master. Listen before motion starts:

- `video song <runId>` prints the Song's sha256s, its lyric, which lyric lines
  were heard, and whether it can be approved. It never downloads the audio.
- `video song approve <runId> --master <masterSha256>` approves exactly the
  master you listened to. If the run now holds a different one, nothing is
  approved.
- `video song import <runId> --file song.mp3 --lyric @lyric.txt --rights "<who
  owns it and consents>" [--from <s> --to <s>]` uses your own recording as the
  Song. The rights statement is kept as written, and the server records you,
  the signed-in member, as the person who confirmed it. Write the lyric one
  line per scene. A line nobody can hear on the recording keeps the Song from
  being approved.

## Where to go next

- `npx -y @aicopycoders/exodus@beta --help` — the full command surface.
- `npx -y @aicopycoders/exodus@beta workflow --help` — run, build, and automate
  saved multi-node workflows; resolve gate/repair parks from the inbox; read
  banks and promote winners.
- `npx -y @aicopycoders/exodus@beta hooks --help` — browse the Organic Scout
  hook library: filter by score, lane, validation status and more; explain a
  score; find cards sharing a hook pattern; export to CSV or JSON. Read-only.
- `npx -y @aicopycoders/exodus@beta ads --help` — read your own live Meta ads
  once the ad account is connected on the dashboard: `ads list` sorts them by
  cost per result, spend or CTR (lifetime, or `--since 90d`), and
  `ads show <adId>` prints the copy, both windows, the media links and the
  comment counts. Read-only — no Meta login needed.
- `npx -y @aicopycoders/exodus@beta comments --help` — read the comments on
  those ads, on Facebook and Instagram. Commenter names and links are stripped
  before storage; you get the words only. Read-only.
- `npx -y @aicopycoders/exodus@beta winners definition` — what this brand means
  by "a winner" for one ad account: the campaign roles, the rule, the dials and
  the last run's summary, exactly as confirmed on the dashboard.

Inside Claude Code, just say **"exodus"** plus what you want
("exodus, write me some ads") and the skills route the rest.
