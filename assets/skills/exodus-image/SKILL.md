---
name: exodus-image
description: The front door for making static image ads with Exodus — and the skill that WALKS THE USER THROUGH the setup instead of guessing. When the user hands over one or more finished ads and wants statics, it presents clean menus (which ads, which engines, aspect, count, steering, template formats), confirms a final render count, and fires nothing until the user says go. Only invoke when the user has explicitly invoked Exodus: they said "exodus" in the request ("exodus, turn this copy into images", "exodus, make me some statics", "exodus, render this ad"), named this skill or /exodus-image, ran an `npx exodus` command, or the `exodus` hub skill routed here — then use it FIRST when the user wants Exodus images and hasn't already nailed down every detail. Never claim generic image requests ("make images", "I need visuals for this ad") — in shared folders those may belong to the user's other tools; if the user did not say exodus, this skill is not for them. For meme formats specifically, use `exodus-meme`. A competitor's image ad to remake for the brand ("swipe this image ad", "make their static ours", their ad's picture file, a Top ad's picture) is the `swipe` skill (`exodus swipe image`), not this: these engines render from copy and can't remake their picture. Do not jump straight to running a render — the whole point of this skill is to ask first.
---

# Image — The Guided Static-Image Flow

This skill turns "here are some ads, make me images" into a short, menu-driven
setup, then fires the right render runs. The failure it exists to kill is the
old behavior: reading one line, guessing an engine, skipping the steering
question, and firing a batch the user never got to shape. **You ask first. You
fire nothing until the user has confirmed the full spec — including steering.**

The work runs through two base commands underneath you:

- **`exodus image`** — engine-direct renders from copy (`native`, `copy-derived`).
- **`exodus template run`** — spreads copy across structured ad-type formats
  (testimonial, hero, UGC, infographic, +29). This is the command that exposes
  manual format picking, per-format counts, and the realism enhancer.

You compose those commands *after* the user has answered the menus — not before.

**Their ad's picture, remade for the brand, is not this skill.** When the user
hands over a competitor's image ad and wants it swiped (their picture with the
brand in it, at a level from L1 near-clone to L5 idea only), hand off to the
`swipe` skill, which runs `exodus swipe image`: the same Image swipe as the
dashboard's Swipe pop-up. The engines here would only render new pictures from
the ad's words, and those look nothing like the ad.

## How to ask: menus, not walls of text

Use the **AskUserQuestion** tool for every choice. That renders a clean picker
the user can click through — which is exactly what makes this feel guided
instead of like a wall of text they have to read and reply to in prose. Two
practical limits to design around:

- **Max 4 options per question, max 4 questions per call.** When a list is
  longer (the 33 formats, or more than 4 ads), don't dump it as prose — group it
  into buckets, or offer "all / a subset" and collect the subset as a follow-up.
- Every question auto-includes an **"Other"** free-text choice, so users can
  always type their own answer (a custom count, their own steering line, a
  specific format slug). Lean on that instead of trying to enumerate everything.

## Be adaptive — start where the user already is

Read the request before asking anything. Whatever the user already specified,
**pre-fill it and skip that question.** Only ask for what's genuinely still open.

- "Here's a bunch of ads, make me some images" → wide open. Walk the full flow.
- "Make me native ads from these" → engine is decided. Skip the engine question;
  confirm the ads, aspect, count, and steering, then go.
- "10 copy-derived statics of this ad, 1:1" → almost everything is set. You still
  owe them the steering question (see below), then confirm and fire.
- "Just make a dramatic woman-in-red image" — no copy, a pure visual direction →
  this is the light path. Run native straight from the direction (steering *is*
  the brief), no menu needed:
  `npx @aicopycoders/exodus image --type native --steer "<direction>"`.

The rule of thumb: the menus exist to capture decisions the user hasn't made
yet. Don't re-ask what they've already told you, and don't make a one-off
visual-direction render sit through a four-wave setup.

## Steering is always on the table

Whenever a Native engine (Native or Copy-Derived) is in the run, **always ask
the steering question.** This is the step that used to get skipped, and it's the
single biggest lever the user has over how the images come out — a direction
that every image leans into ("make it aggressive and intense", "moody, clinical",
"nasty toenail fungus, unfiltered"). Never decide steering for them and never
quietly skip it. Steering applies to the Native engines; Template gets its own
configuration (formats + realism) instead.

---

## The flow

Think of it as waves. Collapse or skip any wave whose answers the user already
gave; the order is the spine, not a script to read aloud.

### Wave 0 — Read the ads, set the frame

If the user dropped ad copy, parse it into a numbered list and give each ad a
2–4 word descriptor so the menus are legible — e.g. "Ad #1 — wife/relational",
"Ad #2 — free-T science". State a one-line read and that nothing fires until they
confirm. Stage long copy to temp files if you need to (e.g. `/tmp/exodus-ad1.txt`)
so the commands stay clean.

### Wave 1 — The basics (one AskUserQuestion call)

Ask only the still-open ones of these:

- **Which ads?** Default option "All N ads" (recommended), plus "a subset" → let
  them name which in Other. (Don't try to list more than ~3 ads as individual
  options — the 4-option cap will truncate them; all-or-subset scales.)
- **Which engines?** multiSelect — **Native** · **Copy-Derived** · **Template**.
  (Native = a straight render of the ad; Copy-Derived = variations worked off the
  copy; Template = a spread across ad-type formats.)
- **Aspect ratio(s)?** **1:1** (feed) · **4:5** · **9:16**. Note in the option
  text that Template only supports 1:1 and 9:16, so if they pick 4:5 it applies to
  the Native engines only.
- **How many per Native engine** (per ad, per aspect)? e.g. **4** (test batch) ·
  **10** · Other. Only ask if a Native engine is selected.

### Wave 2 — Configuration (branch on the engines chosen)

- If **Native and/or Copy-Derived** is in the run → ask **steering** (always):
  how do they want to provide it? Options: **one direction for all** · **per-ad
  steering** (you'll menu each ad next) · **none**. The words are theirs — if they
  pick "one direction" or "per-ad", collect the actual text in Other or in Wave 3.
- If **Template** is in the run → ask **mode** (**Auto** = you spread the formats,
  they give a total count per ad · **Manual** = they pick the formats and the
  count per format), and the **realism enhancer** (**On** pushes photoreal output ·
  **Off**). In Auto, the count question means "total images per ad"; in Manual it
  means "per format" — say which in the option text so it isn't ambiguous.

### Wave 3 — Per-ad steering (only if they chose "per-ad")

One AskUserQuestion question per ad (batch into multiple calls if more than 4
ads). For each ad, read it and offer **2–3 suggested steering directions you
derive from that ad's angle** plus Other so they can type their own. You're a
strategist here — propose real angles ("lean into the relational stakes",
"clinical, data-forward", "visceral before/after"), don't offer generic filler.

### Wave 4 — Template formats (only if Template + Manual)

Present the 33 formats as a **menu grouped into purpose buckets**, never as a
prose dump. Offer these top-level choices first:

- **Smart pick (recommended)** — you choose the high-converting DR set that fits
  these ads (e.g. testimonial · founder-note · before-after · comparison ·
  scientific · statistics · cost-of-inaction · problem-solution). Fastest path,
  and usually the right one.
- **Pick categories** — multiSelect over the 8 buckets below.
- **Specific formats** — they name slugs in Other.
- **All 33** — the full spread (watch the cap; see Wave 5).

The 8 buckets (slugs the `--quantities` flag expects):

| Bucket | Formats |
|---|---|
| Social proof | testimonial · multi-testimonial · ugc · comment · happy-avatar |
| Authority / story | founder-note · handwritten · holding-sign · writing-on-body |
| News | native-news · breaking-news · screenshot |
| Data / science | scientific · statistics · infographic · comparison · before-after |
| Listicle / steps | step-by-step · carousel · quiz-interactive · post-it-notes |
| Problem framing | problem-solution · cost-of-inaction |
| Product | product-breakdown · hero · receipt |
| Bold / graphic | bold · headline · meme · collage · lofi · animation · sale-promotional-offer |

(For the full named list, `npx @aicopycoders/exodus template ad-types` prints all 33.)

### Wave 5 — Confirm the math, then fire

Before running anything, show a compact **render-count summary** so the user sees
exactly what they're about to get:

```
Engine          Per ad   × N ads   Total
Native (steered)   10        4        40
Copy-Derived       10        4        40
Template (8 fmt×2) 16        4        64
                                  ─────────
                                   144 images
```

**The 50-image cap:** a single Template run tops out at 50 images. If the manual
counts or auto target for an ad would exceed 50, say so plainly and either trim
or split across runs — don't let it fail silently at the backend. Auto mode also
caps at 50 per run.

Then wait for a clear "go" and fire the commands.

---

## Building the commands

Compose these only after the confirm. Use `npx @aicopycoders/exodus`.

**Native / Copy-Derived** — one invocation per selected ad (the single `--ad`
slot is why per-ad steering works), repeated per aspect:

```bash
npx @aicopycoders/exodus image --type native --ad "<ad copy>" --variations 10 --aspect 1:1 --steer "<direction>"
npx @aicopycoders/exodus image --type copy-derived --ad "<ad copy>" --variations 10 --aspect 1:1 --steer "<direction>"
```

Flags: `--type native|copy-derived`, `--ad "<copy>"`, `--variations N`,
`--aspect 1:1|4:5|9:16`, `--steer "<direction>"` (drop `--steer` if they chose
"none"), `--name "<label>"` (optional).

**Template** — drive `exodus template run` (not `image --type template`), because
it's the path that exposes mode, per-format counts, and realism. One run per ad,
or pass a numbered list of ads in one `--input`:

```bash
# Manual: pick formats + per-format counts
npx @aicopycoders/exodus template run --input "<ad copy>" --mode manual \
  --quantities "testimonial:2,founder-note:2,before-after:2,comparison:2" \
  --aspect 1:1 --realism realistic

# Auto: you spread formats, --requested-count is the total per ad
npx @aicopycoders/exodus template run --input "<ad copy>" --mode auto --requested-count 16 --aspect 1:1
```

Flags: `--input "<copy or numbered list>"`, `--mode auto|manual`,
`--quantities "slug:N,slug:N"` (manual), `--requested-count N` (auto),
`--aspect 1:1|9:16`, `--realism off|realistic`. Slugs must come from the 33
above; `--quantities` rejects unknown ones.

During long batches, surface progress as runs kick off rather than going silent.

## Report

When the runs are enqueued, the CLI prints a dashboard URL and runId per run.
Report that plus a 1–2 line take, then stop — the kickoff confirms the run
*started*, not that renders are done. Native/Copy-Derived poll with
`npx @aicopycoders/exodus creative status --id <runId>`; Template progress shows live on the
dashboard (no CLI status endpoint). Everything lands in the creative-suite
library.

## What this skill does NOT do

- It doesn't fire before the user confirms the spec. Guessing the run and
  skipping steering is the exact failure this skill replaces.
- It doesn't mine image concepts from a bare idea with no copy. If there's no
  copy and no clear visual direction, route to the `exodus-write` skill to produce
  copy first, then come back here.
- It doesn't write ad copy. Native/Copy-Derived/Template all render *from* copy
  you already have (or a pure visual direction for the light native path).
- It is not for memes. Meme ads ride familiar meme formats — use the
  `exodus-meme` skill for those.
