---
name: exodus-meme
description: Generate meme-style ad creative for the active brand — recommends meme formats for a brief (classic Imgflip templates + AI-image formats), then renders the whole batch server-side in ONE run; finished memes land in the dashboard's creative-suite library. Use it for both modes of meme work — "just make me memes" (auto-pick a strong diverse set and fire) and "walk me through it" (present the recommended formats by description and let the user choose). Only invoke when the user has explicitly invoked Exodus — they said "exodus" in the request (e.g. "exodus, make me meme ads", "exodus meme this offer"), named this skill or /exodus-meme, ran an `npx @aicopycoders/exodus meme` command, or the `exodus` hub skill routed here. Never claim generic meme requests ("make me a meme", "meme this", "imgflip meme") without exodus context — in shared folders those may belong to the user's other tools.
---

```operator-guide
Subcommands (three; the batch renders server-side):
  exodus meme recommend --brief "<text>" [--avatar "<text>"]
  exodus meme run --brief "<text>" --formats '<json>' [--formats-file <path>] [--avatar "<text>"] [--name "<label>"]
  exodus meme regenerate --brief "<text>" --layer 1 --template-id <id> --template-name "<name>" --boxes <N> [--id <runId>]
  exodus meme regenerate --brief "<text>" --layer 2|3 --format <formatId> [--hint "<text>"] [--id <runId>]

Flow:
  1. recommend → { recommendations: [...] } — 15 picks (5 per layer), each with
     name, layer, reasoning, ad_angle. Layer 1 = classic Imgflip templates;
     layers 2/3 = AI-image formats.
  2. run → pass the picked recommendation objects straight into --formats (JSON
     array, 1–50; the CLI normalizes them). Returns { runId }. One enqueue —
     closing the session does NOT kill the batch.
  3. Poll: exodus workflow status --id <runId>
     Memes render through the Image Rig, so a meme run IS a workflow run — the
     workflow verb is the one that can read it, NOT `status --type creative`.
  4. regenerate → re-render one miss, synchronously (returns image_url). Pass
     --id <runId from step 2> so the fresh meme is saved with that run; leave it
     off and you only get a URL that is never saved. A bad --id is a 400 that
     names the mismatch, raised before anything is rendered — but 400 is not the
     only refusal: a --template-id / --format that isn't a real format is a 404,
     and a lookup or render that breaks is a 502. Read the message, not just the
     status.

Keys (strict BYOK, refused server-side before anything starts):
  layer 1 needs the member's Imgflip login · layers 2/3 need their Kie.ai key ·
  captions always need their LLM key. `npx @aicopycoders/exodus doctor` checks all three.
Returns: runId + dashboard URL /runs/<runId> (the visual review surface).
```

# Meme — Meme Ad Generator (Max's pipeline)

Meme ads ride a format the audience already recognizes — a familiar template or
a relatable AI-generated scene — and land the brand's point inside it. You drive
the pipeline in three moves: get format recommendations for the brief, pick the
formats worth rendering, and fire **one batched run**. The server orchestrates
everything from there (captions + renders via Trigger.dev), so there is no
per-meme captioning or rendering for you to compose, and a closed laptop no
longer kills a half-finished batch.

One thing to hold onto: **this is a no-visuals context.** The dashboard shows
thumbnails; you can't. Your job is to be the user's eyes — describe formats by
name, layer, and the `reasoning`/`ad_angle` the recommend call returns, and
point at the dashboard URL when it's time to actually look at rendered memes.
Never pretend to show an image.

## Two paths — read the request, pick the right one

**Quick batch** — "exodus, meme this offer", "make me some memes for <brief>".
The user wants memes, not a meeting. Run `recommend`, pick a strong diverse set
yourself (~6–10: mix classic templates and AI formats, apply the strategist
bars below), fire `run`, and report. Tell the user which formats you picked and
why in one or two lines — they can steer the next batch.

**Guided** — "walk me through it", "what formats are there?", or any sign the
user wants control over the picks. Run `recommend`, then present the
recommendations with **AskUserQuestion** (max 4 options per question — group
into the three layers or offer "my picks / classics only / AI only / let me
choose" buckets rather than dumping 15 raw entries). Describe each option by
its name + one-line reasoning, e.g. "Group Chat (AI) — lands the claim as a
screenshot conversation, good for skeptical audiences". Collect the picks,
confirm the count, then fire `run`.

In both paths, picking is where the strategist work happens:

- **Relatable beats clever.** A meme the audience has to decode is a scroll-past.
- **The format should fit the audience's actual feed.** A 55+ supplement buyer
  and a 22-year-old skincare buyer do not share meme literacy.
- **Diversity over three flavors of one joke.** Spread across layers and angles;
  a batch of near-duplicates wastes renders.

## Workflow

### 1. Recommend

```bash
npx @aicopycoders/exodus meme recommend --brief "<the offer / angle, in the brand's terms>"
```

Returns `{ recommendations: [...] }` — 15 picks, 5 per layer, each carrying
`format_id`, `layer`, `name`, `reasoning`, and `ad_angle` (layer-1 entries also
carry `imgflip_template_id` + `imgflip_box_count`). Layer 1 = classic Imgflip
templates; layers 2/3 = AI-image formats. Optional `--avatar "<text>"`
describes a recurring character/persona to thread through the batch.

Keep the JSON in your context — the picked entries go straight into `run`, and
the per-format fields are what `regenerate` needs later. Don't paste the raw
JSON at the user.

If the user asks for a specific template by name ("do a Drake one"), put that
in the brief — recommend reads it and will surface the template if it fits.
There's no separate catalog browse; recommend **is** the selection surface.

### 2. Run the batch

Pass the picked recommendation objects straight in — the CLI maps them onto the
run payload itself (don't restructure them):

```bash
npx @aicopycoders/exodus meme run --brief "<same brief>" --formats '[<picked recommendation objects>]'
```

For bigger selections, write the array to a file and use `--formats-file
/tmp/meme-formats.json` — long JSON in shell quoting breaks easily. 1–50
formats per run; `--name "<label>"` labels the run; pass the same `--avatar`
you gave recommend, if any.

Returns `runId` + the dashboard URL. The whole batch renders server-side — tell
the user this explicitly, because it changes their behavior: they can close the
session and the run finishes anyway.

### 3. Poll

```bash
npx @aicopycoders/exodus workflow status --id <runId>
```

Memes render through the Image Rig, so a meme run **is** a workflow run — the
workflow status verb reads it. `status --type creative` will not find it.

Poll roughly every 45 seconds while the user is waiting (or just hand them the
dashboard URL if they'd rather watch it live). Treat these statuses as
terminal: `succeeded`, `succeeded-with-warnings`, `failed`, `cancelled`. A
warnings verdict is the meme batch's old `partial-error` — some memes landed,
some missed, and the node detail names what missed.

### 4. Regenerate the misses

"Succeeded with warnings" means some renders failed and the rest landed. Name
the misses to the user and offer to re-render them — the format fields come from
the recommend output you're still holding:

```bash
# Classic (layer 1) miss:
npx @aicopycoders/exodus meme regenerate --brief "<brief>" --layer 1 \
  --template-id <imgflip_template_id> --template-name "<name>" --boxes <imgflip_box_count> \
  --id <runId from step 2>

# AI (layer 2/3) miss — --hint steers the re-roll:
npx @aicopycoders/exodus meme regenerate --brief "<brief>" --layer 2 --format <format_id> \
  --hint "make the punchline land the product" --id <runId from step 2>
```

Regenerate is synchronous (caption + render server-side) and returns the new
`image_url` directly.

**Pass `--id` the runId from step 2** (#1164). The server matches it to the run's
child for that format and files the fresh meme there, so it lands in the library
beside its siblings and the user finds it where they expect. Both id spaces are
accepted — the workflow run id `run` prints and a creative-suite child run id.

**What `--id` now guarantees is the front door: a bad id is refused before you
pay for anything.** The server resolves the id first, so a typo, an id from
another brand, a run that made no memes, or a run with no meme in *this* format
comes back as a 400 naming the mismatch — no caption call, no render, no credits
spent. That is the promise; it is not a promise that nothing can go wrong after
it.

The refusals are not all 400s, so branch on the message, not the number alone:

- **400** — the id didn't resolve (the message says which part didn't match), or
  a required key is missing, or the brand couldn't be worked out ("No active
  workspace for user"). Careful if you're reading the JSON envelope's `code`
  rather than the status: that last one is labelled `INTERNAL_ERROR` even though
  it is a plain 400, so route on the **status + message**, not the code.
- **404** — the `--template-id` (layer 1) or `--format` (layer 2/3) isn't a
  format the server knows. Re-check it against the recommend output you're
  holding.
- **429** — too many regenerates too fast (30 a minute). Wait and retry; the
  response carries a `Retry-After`.
- **502** — something broke rather than being refused: the run lookup failed, or
  the caption/render leg threw. This one is worth retrying; a 400 or 404 is not.

**One honest gap once the id resolves.** Filing the finished meme into the
library is deliberately allowed to fail quietly — if that write breaks (a Convex
hiccup), the route still answers **200** with the provider's own URL. So a 200
means "here is your image", not "it is saved". If the user later can't find a
regenerated meme in the library, that is the failure to suspect — and it is
recoverable only by regenerating, since the returned URL expires.

Leaving `--id` off is still valid, but the image is saved nowhere and its URL
expires. Do it only when the user explicitly wants a throwaway look, and then
save the image to disk and name the file, never its URL.

### 5. Report

Surface the dashboard URL (`/runs/<runId>`) + a 2-line
strategist take ("the classics carry the relatability, the Group Chat one is
the sleeper — review them in the library"). The dashboard is where the user
actually evaluates memes visually; your report gets them there with a point of
view, not a data dump. Don't paste recommend JSON, prompts, or caption
internals into chat. After a `regenerate` with `--id`, give the same page: the
new meme is on it. A throwaway look (no `--id`) is the file you saved.

## Failure Handling

- **400 "Missing required key(s)"** — the strict-BYOK preflight refused before
  anything started. The message names the missing key: Imgflip login (classic
  memes), Kie.ai key (AI memes), or an LLM key (captions, always). Run
  `npx @aicopycoders/exodus doctor` to confirm, then send the user to **Settings → Keys** on
  the dashboard. A batch with no layer-1 picks doesn't need Imgflip at all — if
  the user lacks an Imgflip login, an AI-only batch is a legitimate fallback.
- **`succeeded-with-warnings`** — not a failed run; some memes landed. Report the
  successes, name the misses from the node detail, regenerate per step 4.
- **`failed` / `cancelled`** — the batch died; the status error says why.
  Fix the cause (usually a key issue mid-run) before re-firing, don't just retry.
- **No progress for 15+ minutes** — presume the run dead and say so rather than
  polling forever; the dashboard run page shows the same stall.
- **Bearer/auth failure** — run `npx @aicopycoders/exodus doctor`; confirm `EXODUS_API_KEY`.

## What this skill does NOT do

- It doesn't compose per-meme caption/render steps — that surface is gone. One
  `run` call is the whole batch.
- It doesn't browse a full format catalog. Recommend returns the working set;
  steer it through the brief.
- It doesn't write ad copy — the brief is an offer/angle, not finished copy. For
  copy, that's the `exodus-write` skill; for non-meme statics, `exodus-image`.

## Admin

- Backend: `/api/meme/{recommend,run,regenerate}` (Bearer-auth). Since #1142
  `run` is an ADAPTER onto the Image Rig: it compiles the picked formats into a
  firing plan and starts a hidden, per-workspace single-rig workflow, so the id
  it returns names a `workflowRuns` row and every meme now carries the same
  per-image provenance as any other rig render. That is why the poll verb is
  `exodus workflow status`, not `exodus status --type creative` — the creative
  status route reads `creativeSuiteRuns` for a Bearer caller.
- Since #1164 `regenerate`'s `--id` accepts BOTH id spaces. The route resolves it
  instead of casting it: a `creativeSuiteRuns` id is used as-is, a `workflowRuns`
  id is walked to the rig child whose `memeFormat` matches this request, and an
  id it can't place is a 400 raised BEFORE any caption or render is paid for.
  Before that fix a CLI `--id` silently failed to save and left an orphaned blob.
  What #1164 removed is the CAUSE, not the swallow: `persistMemeImage` still
  catches a `recordMemeImage` failure, logs it, and returns null, and the route
  still answers 200 with the provider URL. A genuine Convex failure is therefore
  still a silent miss (plus an orphaned storage blob) — findable only in the
  `[meme/persist] ORPHANED STORAGE BLOB` log line.
- The rig's child image runs are still `creativeSuiteRuns` with engine `meme`,
  so finished memes appear in the creative-suite library alongside other engines
  and `exodus browse --agent meme` still covers them.
- `run` accepts only the models the rig renders (`gpt-image-2.5`, the house
  default, plus `gpt-image-2.5-sunburst`, `gpt-image-2` and `nano-banana-pro`,
  or their Kie slugs); anything else is a 400 listing the accepted values. It
  used to accept any value and silently ignore it.
