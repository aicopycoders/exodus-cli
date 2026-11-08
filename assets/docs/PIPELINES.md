# Pipelines Cheat Sheet

In Claude Code you don't click buttons. You say **"exodus"** plus what you want — "exodus, write me some ads" — and the `exodus` hub skill routes you to the right pipeline. You can also invoke a specific skill directly with a slash command: `/exodus-write`, `/exodus-image`, etc.

> This doc is the CLI/skill invocation reference for the active brand workspace. For the dashboard's clickable pipeline list, see the dashboard's Creative Suite.

## All skills at a glance

| Skill | What it does |
|-------|--------------|
| exodus-write | The front door — routes brand → foundation → brief → Genesis → Doc. Start here. |
| exodus-genesis | Brief → Ad Copy (two voices; 1 pass = 2 variants, scalable via --passes) |
| exodus-image | The front door for static images — routes to exodus-creative or exodus-template. Start here for "make me images / statics". |
| exodus-creative | Creative-Suite Engines (native / copy-derived / ref-match) — when you've already picked an engine |
| exodus-template | Ad-Type Format Variations across 50 structured formats |
| exodus-meme | Meme Ad Generator — recommend formats, one batched server-side run |
| exodus-workflow | Run/build saved multi-node workflows, resolve inbox gate/repair parks, continue sessions, fire triggers, read banks + promote winners |
| exodus-hooks | Read the Scout library of hook cards — composable filters, one-card detail, pattern matches, CSV export (read-only) |
| exodus-video | Make a video ad from a script by running a saved video workflow — storyboard gate, pull every piece + manifest, cut it in whatever editor you use, upload, approve (admin-only) |
| exodus-browse | View History and Surface the Right Run |
| exodus-drive | Google Drive, Docs, Sheets via the Dashboard's OAuth |
| exodus-winners | Mine your own Meta ad account for winners (needs the Meta Ads MCP) and import them into Exodus |

---

## Method skills (Luke's thinking)

Not pipelines. These run as a conversation and shape the thinking before a pipeline fires. Call one by name or describe the job.

| Skill | Say things like |
|-------|-----------------|
| thinking-vs-build | (loads at session start) "let's think", "basic list", "just the outcomes" vs "build it", "let it rip" |
| positioning-spiral | "who do we sell this to and what's the story", "are we positioned right" |
| odf | "map the segments", "build personas from the comments", "aim this winner at a new segment" |
| mechanism | "what's the mechanism", "which ingredient leads", "name the problem" |
| find-competitors | "who's scaling in this niche", "build me a watch list" |
| patterns-and-gaps | "what patterns do you see", "what are they doing that we aren't" |
| anatomy-of-ads | "break this ad down", "tag these ads", "write me a brief" |
| copy-instincts | "make this hit harder", "what's wrong with this ad", "find the big idea" |
| bot-builder | "build me a bot that…", "turn this into a prompt", "make a node for the workflow" |
| remember-that | "remember that", "never do that again", "lock that in" |
| handoff | "handoff", "wrap up", "what did we do today", "handoff review" |

They read `STANDARDS.md` (your taste, at the workspace root) before producing anything. `remember-that` adds to it mid-session; `handoff` proposes additions at the end and writes session files to `workflow/sessions/`.

## exodus-write (start here)

**What it does:** The guided front door for copywriting. You don't need to know which command to run — say "exodus" plus what you want and the exodus-write flow figures out where you are, helps shape the brief, sets up your foundation if needed, runs Genesis, and hands back the Google Doc.

```operator-guide
No command — say "exodus" plus what you want (or /exodus-write). It sequences
the existing commands (foundation, genesis, browse, read-doc) for you.

Say things like:
  "exodus, I want to write some ads: <your idea>"
  "exodus, turn this winning ad into copy: <paste>"
  "exodus, set up a new brand and write my first ad"
  "exodus, make a variant of that last run"

Routing:
  new brand / no foundation → onboarding (foundation, optional primer prompt)
  brief or idea in hand      → straight to the Genesis writing pass
  rerun / tweak              → browse past runs + the editing menu
Works without a primer (defaults); sharper once your foundation has winning examples.
```

---

## exodus-genesis

**What it does:** Take a brief through Luke's full Genesis writing process — two voices (Mario × Brand + Infeed × Brand). Default is 1 pass per bot = 2 variants; add `--passes` to widen coverage (pass 2 brings in the Top-Ads-biased primer). Also accepts per-run seeds extracted from a source ad.

```operator-guide
Inputs:
  --brief <file|"text"> (required) — path to a text file OR an inline brief string
Optional:
  --seeds <file|"text"> — per-run creative seeds (file: one per line or JSON array; inline: one string)
  --awareness — unaware | problem-aware (default) | solution-aware | product-aware
  --passes <n> — writing passes per bot (1–5, default 1). 1 pass = 2 variants
                 (1 Mario×Brand + 1 Infeed×Brand); pass 2 adds the Top-Ads-biased primer
  --variants <n> — advanced: raw total count (1–10) that overrides --passes
  --ad-account <id> — Meta ad account for the top-ads-biased track (defaults to first active account)
  --no-wait — return immediately with the run ID
Returns: Google Doc URL printed to stdout when the run completes
Examples:
  exodus genesis run --brief brief.txt --seeds seeds.txt
  exodus genesis run --brief "Grounding sheets help joint pain" --awareness problem-aware --passes 2
```

---

## exodus-image (start here for statics)

**What it does:** The front door for static image ads. Just say "exodus" plus what
you want — "exodus, make me some statics from this ad", "exodus, render AD-001" —
and Claude reads the request and runs the right engine: **exodus-creative**
(renders straight from copy, or matches a reference image) or **exodus-template**
(one piece of copy spread across 50 ad-type formats). You don't pick the engine;
the request decides it. Use the engines below directly only when you already know
exactly which one you want.

**Say something like:** "exodus, make me some image ads from this copy" · "exodus,
render this ad as statics" · "exodus, spread AD-001 across ad formats" · "exodus,
make ads that look like this library image".

---

## exodus-creative

**What it does:** Generate static creative images through the creative-suite engines — native (render image ads straight from ad copy), copy-derived (renders derived from copy variations), and ref-match (match the look of one or more reference images you've uploaded to the library).

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

---

## exodus-template

**What it does:** Turn finished ad copy into many static ad images spread across structured ad-type formats (testimonial, hero, UGC, logo, infographic, and 45 more). Runs Fernando's 5-stage Template pipeline — give it one brief or a numbered list of ads and it generates format variations, then renders them.

```operator-guide
Subcommands:
  exodus template run --input "<text>" [options]   Kick off a run
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
  --requested-count N   auto-mode total render target (optional)

Returns:
  runId + dashboard URL. POST-only — there is NO CLI status endpoint yet.
  Live progress renders in the dashboard at /creative-suite/template/sessions/<runId>.
```

---

## exodus-meme

**What it does:** Generate meme-style ad creative for the active brand — recommends meme formats for a brief, then renders the whole batch server-side in one run (AI image memes via Kie.ai, classic Imgflip-template memes on the member's Imgflip login).

```operator-guide
Subcommands:
  exodus meme recommend --brief "<text>" [--avatar "<text>"]
  exodus meme run --brief "<text>" --formats '<json>' [--avatar "<text>"] [--name "<label>"]
  exodus meme regenerate --brief "<text>" --layer 1|2|3 <format fields> [--hint "<text>"] [--id <runId>]

Typical flow:
  1. recommend  → { recommendations: [...] } — 15 picks (5 per layer) with
                  name, layer, reasoning, ad_angle. Layer 1 = classic Imgflip
                  templates; layers 2/3 = AI-image formats.
  2. run        → pass the picked recommendation objects straight into
                  --formats (JSON array, 1–50). One enqueue; the batch renders
                  server-side via Trigger.dev — closing the session won't kill it.
  3. poll       → exodus status --id <runId> --type creative
                  (terminal: complete | partial-error | error)
  4. regenerate → re-render a single miss (layer 1: --template-id
                  --template-name --boxes; layer 2/3: --format [--hint]).

Keys (strict BYOK, preflighted server-side): classic memes need the member's
Imgflip login; AI memes need their Kie.ai key; captions always need an LLM key.
Returns: runId + dashboard URL /creative-suite/runs/<runId> (results land in the library).
```

---

## exodus-workflow

**What it does:** Run, chain, build, and edit saved multi-node Exodus Workflows from the CLI — the automations that wire Genesis bots, primers, briefs, and image nodes together on the dashboard canvas. Also resolves runs that park at a gate or repair step (from the inbox), continues bot chat sessions, enables/fires triggers, reads copy banks, and promotes a winner (which fires the Winner Flywheel).

```operator-guide
Say something like:
  "exodus, run my launch workflow"
  "exodus, what does this workflow need"
  "exodus, check my workflow inbox"
  "exodus, review that gate" / "exodus, approve the run"
  "exodus, continue that session"
  "exodus, promote this winner"

Representative commands:
  exodus workflow list
  exodus workflow run <wf> --wait
  exodus workflow inbox
  exodus workflow gate <runId> pick 3,7 | edit 4 | push "punchier" | approve | reject
  exodus session list | show | chat
  exodus bank list | show <key> | promote <key>
Every workflow/session/bank verb takes --json — that output is the machine API.

A video workflow whose Rig box points at a rig with saved format rules follows
them — how many speakers the script may have, which checks run, how the cast is
built. The start receipt and `workflow status` name the rulebook and its version;
`video pull` writes the same facts into manifest.json. Every Rig box in the
workflow has to point at the same saved rig, or the launch refuses and nothing
is spent.
```

---

## exodus-hooks

**What it does:** Reads the Scout library — the brand's pool of hook cards captured from Instagram outliers. Filters compose, so one query answers "10×+, on-screen hooks, Spanish, under 14 days". Read-only; promoting a card is a dashboard act.

```operator-guide
Commands:
  exodus hooks list [filters] [--limit n] [--json]      the filtered slice
  exodus hooks show <ref> [--json]                      one full card
  exodus hooks find-similar <ref> [--json]              cards sharing the hook pattern
  exodus hooks explain-score <ref>                      the evidence behind the score
  exodus hooks export --csv|--json [filters] [--out f]  the whole filtered corpus
Filters (compose):
  --min-score N · --lane relative|absolute|velocity|evergreen
  --status unproven|corroborated|cross-validated|saturated|virgin-market
  --lifecycle new|reviewed|promoted|tested|killed · --creator <handle>
  --language xx · --market xx · --via paste|seed|expansion|spotter · --days N
  --extract pending|complete|partial|failed|skipped · --has spoken|onscreen|caption
  --pattern "text" · --limit N (default 50, max 200)
<ref>: card id, Instagram shortcode, or post URL
Returns: a table, --json data, or an exported CSV/JSON file
```

---

## exodus-video

**What it does:** Makes a video ad from a script, in pieces. You run a saved video workflow (`exodus workflow run <name> --input <field>=@script.txt`). The run stops for your cut only if its video node sets `finalWatch: true` (defaults to off — check with `exodus workflow export`, not `describe`), and video gates are approved with `exodus video approve`, not `workflow checkpoint approve`. The run writes the storyboard, draws a picture per scene, records the voice, renders a clip per scene and generates a music bed, then parks for a cut. The CLI pulls the pieces to a folder with a `manifest.json`; you cut them in whatever editor you use; the upload attaches the cut for approval. Admin-only.

**Voices.** Two separate choices, both made when the run starts and both refused before the run is created if anything is wrong, so a mistake costs nothing. `--voices @voices.json` says WHICH ElevenLabs voice each speaker gets, keyed by the names the script uses (`HOST 1`) — the same file `exodus video voices <run> --from` reads at the review, so one file per brand serves both moments. `--voice-treatment` says HOW the voices are made: a name on its own for a way of working that plays a voice you picked, or a `voice-treatment.json` shaped `{"path": "...", "describe": {"HOST 1": "Dry, tired baritone."}}` for the ways where the video model speaks the CAST's lines itself in voices you WROTE. A written voice needs one description per speaker, and it cannot be changed at the storyboard review — that is what the `--voice-treatment` flag at launch is for. The two never combine: written voices plus `--voices` is refused, because those ElevenLabs voices would be paid for and never heard. A written voice covers the CAST's lines only: a narrated scene is still recorded by ElevenLabs on the member's own key, so a script with `NARRATOR:` turns still needs the key and still costs ElevenLabs money. Ways of working beyond the two shipped ones are switched on only on the test stack while they are being tried out.

```operator-guide
Start:
  exodus workflow list / describe <name>                               find it and see what it needs
  exodus workflow run <workflowId|name> --input <field>=@script.txt [--wait]   start it; --wait stops at the storyboard gate
  exodus workflow run <workflowId|name> --input <field>=@script.txt --voices @voices.json   ... and give each speaker an ElevenLabs voice up front
  exodus workflow run <workflowId|name> --input <field>=@script.txt --voice-treatment @voice-treatment.json   ... or have the video model speak voices you WROTE
Then:
  exodus video storyboard <runId> [--json]                             the scene cards
  exodus video voices <runId> [--set <who>=<voiceId>] [--clear <who>] [--from <f>] [--json]  who speaks, with whose voice
  exodus video approve <runId> [--json]                                approve the storyboard, or the uploaded cut
  exodus video retry-frame <runId> --node <nodeId> --scene <n> [--note "<t>"] [--json]  redo one still at the pixel gate
  exodus video broll <runId> [add --line <id> | move --scene <n> --line <id> | remove --scene <n>] [--note "<t>"] [--json]  direct a B-roll run's shots at the storyboard
  exodus video status <runId> [--json]                                 the park and each scene's clip/voice/picture
  exodus video pull <runId> --out <dir> [--json]                       every piece + manifest.json
  exodus video retry-clip <runId> --scene <n> [--node <nodeId>] [--note "<t>"] [--json]  redo one clip at the final watch
  exodus video revoice <runId> (--scene <n> | --all) [--node <nodeId>] [--json]  redo only the voice on finished clips; no new video
  exodus video upload <runId> --file <cut.mp4> [--duration <s>] [--json]   attach the cut (MP4/MOV/WebM, 200 MB)
Cut: your choice of tool — Exodus does not stitch or mix. One option ships with the skill:
  node .claude/skills/exodus-video/scripts/first-cut.mjs <dir> [--skip n,m] [--no-music] [--out f]
Returns: park lines with the exact next command (--wait ends on either video park, exit 0); pull writes files + manifest.json
```

---

## exodus-browse

**What it does:** View past pipeline runs and pull outputs from previous sessions.

```operator-guide
Inputs:
  none required — defaults to recent runs across all pipelines
Flags:
  --limit (default: 20) — max runs to list
  --agent — filter by agent: genesis | creative | template | meme
Returns: terminal table of recent runs with timestamps, agents, statuses, and Doc URLs
```

---

## exodus-drive

**What it does:** Read and write Google Drive / Docs / Sheets via the dashboard's existing OAuth, using `npx @aicopycoders/exodus drive` subcommands.

```operator-guide
Subcommands (use the one that matches intent):
  get-doc <docId>             Read a Google Doc by ID
  get-sheet <sheetId>         Read a spreadsheet range
  list-files                  Search/list Drive files
  create-doc <title>          Create a new Google Doc
  batch-update <docId>        Apply Docs API requests (insertText, etc.)
For pipeline-run docs, use:
  npx @aicopycoders/exodus read-doc <runId> — walks every tab, renders to markdown
Returns: structured JSON forwarded from Google's APIs (or markdown for read-doc)
```

---

## exodus-winners

**What it does:** Mines your own Meta ad account for winning ads and imports them into Exodus as generative fuel. Your agent session needs the official Meta Ads MCP connected (`https://mcp.facebook.com/ads` — OAuth with your own Facebook login); the skill interviews you (no numeric questions), finds the ads carrying ~80% of your lifetime results, confirms each pick visually, then pushes a winner package through the CLI. Imported winners surface in generation selection with their verdict.

```operator-guide
Subcommands:
  exodus winners import <file.json | ->   Push a winner package (- reads stdin)
  exodus winners status <importId>        Re-poll an import later
  exodus winners list                     Winners Exodus already holds

Import flags:
  --dry-run    Would-create vs would-update per winner; zero writes
  --no-wait    Return the importId immediately instead of polling
  --json       Machine-readable output

Requires: Meta Ads MCP in the session (mining) + your Scrape Creators key in
Settings → Keys (the own-page match scrape bills your account).
Say things like: "exodus, import my winning ads" · "exodus, mine my ad
account for winners" · "exodus, which winners does Exodus already hold?"
```
