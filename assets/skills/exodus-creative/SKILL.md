---
name: exodus-creative
description: Run a SPECIFIC Exodus creative-suite engine when the user has already chosen one — native (render image ads straight from ad copy), copy-derived (renders derived from copy variations), or ref-match (match the look of reference images already in the brand library). Only invoke when the user has explicitly invoked Exodus AND names the engine or asks precisely for it: they said "exodus" in the request ("exodus native creative", "exodus, ref-match this library image", "exodus copy-derived images"), named this skill or /exodus-creative, ran an `npx @aicopycoders/exodus creative` command, or the `exodus` hub skill routed here. Never claim generic creative requests ("creative suite", "make ads that look like this image") — in shared folders those may belong to the user's other tools; if the user did not say exodus, this skill is not for them. For an unsure "exodus, just make me some images / statics" ask, start at the `exodus-image` front door — it reads the request and routes here. For a spread across structured ad-type formats use `exodus-template`; for meme formats use `exodus-meme`. A competitor's image ad remade for the brand ("swipe this image ad", their picture with our brand in it) is the `swipe` skill (`exodus swipe image`), not ref-match: ref-match needs pictures already in the brand library and copies their look, not the ad.
---

```operator-guide
Subcommands:
  exodus creative native --ad "<text>" [options]         Render image ads from ad copy
  exodus creative copy-derived --ad "<text>" [options]   Renders derived from copy variations
  exodus creative ref-match --refs <id,id,...> [options] Match the look of reference image(s)
  exodus creative status --id <runId>                    Poll a run

Shared options (kickoffs):
  --variations N        Renders to generate (default: engine-specific)
  --aspect 1:1|4:5|9:16   Image aspect ratio (default: 1:1)
  --name "<label>"      Custom run name (otherwise auto-generated)
  --ad-group <id>       Attach to an existing ad-group

ref-match additional options:
  --refs <id,id,...>    REQUIRED. Comma-separated creativeSuiteImages ids
                        (the images must already be in the dashboard library)
  --subject "<text>"    Optional subject hint
  --objects <id,id,...> Optional object-overlay image ids

Returns: runId + dashboard URL (/creative-suite/runs/<runId>).
Status: `exodus creative status --id <runId>` → engine, status, completed/total, isTerminal.
Auth: Bearer (kickoff via Convex HTTP; status via dashboard route).
```

# Creative — Creative-Suite Engines (Max's pipeline)

Three engines that turn copy (or a reference image) into static renders, without the SCRAWLS concept-mining pass:

- **`native`** — render image ads straight from the ad copy you pass in `--ad`.
- **`copy-derived`** — renders derived from variations of that copy.
- **`ref-match`** — match the visual style of one or more **reference images already in the brand's library** (`--refs <imageIds>`), optionally with a subject hint and object overlays.

Unlike `exodus-template` (structured ad-type formats), `exodus-creative` is the engine-direct path — fastest when the user already knows the copy or has a reference look to match.

## When to reach for `exodus-creative` vs the other image tools

| Situation | Use |
|---|---|
| "Render images from this ad copy" / "native creative" | `creative native` |
| "Give me variations derived off this copy" | `creative copy-derived` |
| "Make ads that look like this image" (ref already uploaded) | `creative ref-match --refs <ids>` |
| Spread across ad-type formats (testimonial, hero, UGC…) | the `exodus-template` skill |

## Workflow

### 1. Pick the engine, state your read, run

**Native / copy-derived** (copy in `--ad`, min 3 chars):

```bash
./node_modules/.bin/exodus creative native --ad "<finished ad copy>" --variations 10
./node_modules/.bin/exodus creative copy-derived --ad "<finished ad copy>" --aspect 9:16
```

**Ref-match** (reference image ids must already exist in the library):

```bash
./node_modules/.bin/exodus creative ref-match --refs k57abc123,k57def456 --subject "morning routine"
```

To get reference image ids, the user uploads to the dashboard library first (Settings → library) — there's **no Bearer upload route**, so the CLI can't upload for them. If they hand you a local file, tell them to upload it in the dashboard and give you the resulting id.

### 2. Poll status (only if asked)

```bash
./node_modules/.bin/exodus creative status --id <runId>
```

Returns engine, status (with `(terminal)` when done), `completed / total` render counts, and any error. The dashboard renders the same data live, so prefer linking it over polling in a loop.

### 3. Report

Surface the dashboard URL (`/creative-suite/runs/<runId>`) + a 2-line take per the **Default Post-Run Reporting** rule. Don't claim renders are finished off the kickoff line — the kickoff only confirms the run started. Check `status` (or the dashboard) before calling it done.

## Failure Handling

- **`native`/`copy-derived` without `--ad`** (or under 3 chars) errors — supply the copy.
- **`ref-match` without `--refs`** errors — supply at least one library image id.
- **Bad/aspect value** — `--aspect` must be `1:1`, `4:5`, or `9:16`.
- **whoami/auth failure** — run `npx @aicopycoders/exodus doctor`; confirm `EXODUS_API_KEY`.
- **Reference id not found** — the id must be a real `creativeSuiteImages` id from the brand's library; re-upload via the dashboard and use the returned id.
- **"variance" (L1–L5) is NOT an engine here** — only `native | copy-derived | ref-match` are valid. Don't invent a variance engine.

## Admin

- Backend: Convex HTTP `POST /api/creative-suite/run` (Bearer-auth) with engine-specific Trigger.dev fanout; status via dashboard `GET /api/creative-suite/runs/[id]` (Bearer, Max QA #34).
- Reference images live in `creativeSuiteImages`; upload is dashboard-only for now.
- Runs appear in the creative-suite library alongside template + meme output.
- Don't echo render prompts or bot system prompts in your reply.
