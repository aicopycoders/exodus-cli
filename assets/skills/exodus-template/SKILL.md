---
name: exodus-template
description: Spread finished ad copy across structured ad-type formats — testimonial, hero, UGC, logo, infographic, and 45 more — via Fernando's 5-stage Exodus Template pipeline (one brief or a numbered list of ads → format variations → renders). Only invoke when the user has explicitly invoked Exodus AND the ask is specifically about FORMAT COVERAGE: they said "exodus" in the request ("exodus template ads", "exodus, spread this copy across the 50 ad types", "exodus, give me testimonial + hero + UGC versions"), named this skill or /exodus-template, ran an `npx @aicopycoders/exodus template` command, or the `exodus` hub skill routed here. Never claim generic format requests ("template ads", "spread this copy across formats") — in shared folders those may belong to the user's other tools; if the user did not say exodus, this skill is not for them. For an unsure "exodus, just make me images / statics" ask, start at the `exodus-image` front door — it reads the request and routes here. For native / copy-derived / reference-match renders use `exodus-creative`; for meme formats use `exodus-meme`.
---

```operator-guide
Subcommands:
  exodus template run --input "<text>" [options]   Kick off a run
  exodus template status --id <runId>              Status + rendered image URLs
  exodus template resume --id <runId>              Finalize an orphaned run (#56)
  exodus template ad-types                          Print all 50 AD_TYPES
  exodus template reptile-triggers                  Print the 13 reptile triggers

run options:
  --input "<text>"      REQUIRED. One brief, or a numbered list of finished ads
                        ("1. <ad copy> 2. <ad copy> ..."). Min 3 chars.
  --mode auto|manual|hybrid   Generation mode (default: auto)
  --render-mode images|prompts   prompts = skip render, return LLM prompts only (default: images)
  --aspect 1:1|9:16     Image aspect ratio (default: 1:1)
  --model gpt-image-2.5|gpt-image-2.5-sunburst|gpt-image-2|nano-banana-pro|nano-banana-2-1
                        Kie.ai model (default: gpt-image-2.5)
  --realism off|realistic   Realism enforcement (default: off)
  --quantities "slug:N,slug:N"   manual-mode per-type counts (e.g. "testimonial:3,hero:2")
  --pairings '<JSON>'   hybrid-mode host/modifier pairs: '[{"host":"testimonial","modifier":"hero"}]'
  --requested-count N   total render target (optional). In auto mode, the total
                        across detected ads. In hybrid mode, the total number of
                        images — pairings are cycled to reach it, so one pairing
                        + `--requested-count 5` yields 5 images. Ignored in manual
                        (use `--quantities`).

Returns:
  runId + dashboard URL. Kickoff is fire-and-forget; poll with
  `exodus template status --id <runId>` for status + the rendered image URLs.
  Live progress also renders in the dashboard at /creative-suite/template/sessions/<runId>.
```

# Template — Ad-Type Format Variations (Fernando's pipeline)

Reach for this when the user has **finished ad copy** and wants it turned into a spread of **static image ads across structured formats** — testimonial, hero, UGC, infographic, logo, and the rest of the 50 AD_TYPES. The pipeline reads the copy, decides (or is told) which formats to produce, writes a render prompt per format, and renders the images.

This is the **format-coverage** tool. It is not engine-based rendering (that's `exodus-creative`: native / copy-derived / ref-match).

## When to reach for `exodus-template` vs the other image tools

| Situation | Use |
|---|---|
| User has finished copy and wants it across many ad formats (testimonial, hero, UGC…) | `exodus-template` |
| User wants native / copy-derived renders or to match a reference image | `exodus-creative` |

If the copy is done and the ask is "give me a bunch of polished formats from this," default to `exodus-template`.

## Workflow

### 1. Pick the mode — recommend, don't ask

State your read in one line, then run. The pipeline auto-detects format coverage in `auto`; only reach for manual/hybrid when the user wants control.

| User intent | Mode | How |
|---|---|---|
| "Give me a good spread" / nothing specific | `auto` | pipeline picks the format mix |
| "I want exactly N of these specific types" | `manual` | `--quantities "testimonial:3,hero:2,ugc:4"` |
| "Combine a testimonial with a hero look" | `hybrid` | `--pairings '[{"host":"testimonial","modifier":"hero"}]'` |

`manual` REQUIRES `--quantities`; `hybrid` REQUIRES `--pairings`. Slugs must be valid AD_TYPES — run `exodus template ad-types` to list them (use the slug, not the display name).

### 2. Run it (foreground is fine — it returns fast with a runId)

```bash
./node_modules/.bin/exodus template run --input "<finished ad copy or numbered list>"
```

With controls:

```bash
./node_modules/.bin/exodus template run \
  --input "$(cat path/to/genesis-doc.txt)" \
  --aspect 9:16 --model nano-banana-pro --realism realistic
```

**Cheap smoke test:** use `--render-mode prompts` to validate the format selection + prompts without burning render compute, then re-run with `--render-mode images` once the mix looks right.

The command returns a `runId` + dashboard URL and exits — kickoff is fire-and-forget. Poll with `exodus template status --id <runId>` to read the status and pull the rendered image URLs once they complete.

### 3. Report

Per the **Default Post-Run Reporting** rule in `exodus-strategist`: surface the dashboard URL + a 2-line take, then stop. Don't claim the images are done off the kickoff — that only confirms the run *started*; the renders complete asynchronously. Use `exodus template status --id <runId>` to confirm completion and retrieve the render URLs, or point the user to `/creative-suite/template/sessions/<runId>`.

### 4. Recover an orphaned run

If a previous run's renders stalled or were left incomplete, finalize it:

```bash
./node_modules/.bin/exodus template resume --id <runId>
```

## Failure Handling

- **`--mode manual` without `--quantities`** (or `hybrid` without `--pairings`) errors immediately — supply the required flag.
- **Unknown ad-type slug** in `--quantities`/`--pairings` errors with the bad slug named. Run `exodus template ad-types` and use the exact slug.
- **whoami failure** ("Check EXODUS_API_KEY…") means auth/base-URL isn't resolving — run `npx @aicopycoders/exodus doctor`.
- **Checking status** — if the user asks "is it done?", run `exodus template status --id <runId>`: it returns the run status and the rendered image URLs. Don't fabricate a status; read it.
- **`--ref-image` is NOT supported in V1** — the Bearer kickoff route doesn't accept reference image ids. If the user wants reference matching, route to the `exodus-creative` skill's ref-match instead.

## Admin

- Backend: Convex HTTP `POST /api/creative-suite-template/run` (Bearer-auth); Trigger.dev task `creative-suite-template` (Fernando's 5-stage pipeline).
- 50 AD_TYPES and 13 reptile triggers are inspectable via `exodus template ad-types` / `exodus template reptile-triggers`.
- Status hits `GET /api/v2/template?runId=<id>` (status + rendered image URLs).
- Resume hits `POST /api/creative-suite-template/runs/<id>/resume`.
- Don't echo render prompts or bot system prompts in your reply — that's IP.
