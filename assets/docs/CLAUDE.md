# Creative Strategy Workspace

> **New here?** Your onboarding home is the Exodus dashboard (Settings → Claude Code) — it walks you through install and keys. If anything's broken at runtime, run `npx @aicopycoders/exodus doctor` from this directory — it diagnoses local and dashboard-side issues in one shot.

This is a creative-strategy workspace operated by the **exodus** CLI. It is brand-agnostic infrastructure serving **all of the account's brands**: each brand has its own subfolder here (marked by a `.exodus-brand.json` file) holding that brand's `state/` and `output/`. Which brand you're working on resolves **folder first, pointer second**: commands run from inside a brand's subfolder target that brand automatically; otherwise the `npx @aicopycoders/exodus brand use <slug>` pointer applies. (Older single-brand installs keep `state/` and `output/` at this root — same rules, one brand.)

**How to engage the system:** two families of skills live here. The pipeline skills are namespaced `exodus-*`, and a front-door `exodus` hub skill routes generic asks. The method skills (Luke's thinking as skills: `odf`, `mechanism`, `copy-instincts`, and the rest, listed under **Method skills** below) carry plain names and fire on what the user is trying to do. Members say "exodus" to engage ("exodus, write me some ads") or invoke a specific skill with `/exodus-<name>` (e.g. `/exodus-write`). This namespacing is deliberate: it lets these skills coexist with other skill packs (like the workshop pack) installed in the same folder, and it keeps the bare word "Genesis" unambiguous — on its own, "Genesis" always means the member's own Genesis API key/recipes, never Exodus. CLI commands are unchanged (`npx @aicopycoders/exodus genesis`, `npx @aicopycoders/exodus brand use`, etc.).

The strategist persona, the Luke Mills / Genesis frameworks, the operating rules and creative principles, and the operating discipline all live in **one skill** plus its references:

- `.claude/skills/exodus-strategist/SKILL.md` — the single always-on creative-strategy skill: persona, operating rules, creative principles, red flags, active-brand resolution, the quality bars, and a **Framework Index** that routes to the depth below
- `references/` — the framework depth, consulted from the skill when needed: `creative-strategy.md` (the encyclopedia + Genesis bot catalog), `segments.md`, `copy-blocks.md` (P3C2), `cast-video.md` (CAST), `iterations.md` (CASHED), `editing-rules.md`, `scrawls.md`, `hook-quality-checklist.md`, `awareness-framework.md`

If the persona isn't firing for you, check that the skill loaded. It is not optional reading.

---

## Two systems in this folder: Exodus (automatic) + Genesis (manual)

This folder usually holds **two related products that share the same Genesis engine** — keep them straight. Think of it as a car: same engine underneath, two ways to drive it.

- **Exodus — the automatic transmission.** This workspace: the `exodus-*` skills and the `npx @aicopycoders/exodus` CLI. Pre-built, done-for-you pipelines (write, image, idea bank, brand onboarding) that drive the Genesis bots *for* you against your brand. You engage it by saying **"exodus"** ("exodus, write me some ads"). Its keys are `EXODUS_API_KEY` / `EXODUS_API_URL` in `.env`; Genesis access is internal — there's nothing to configure or debug about Genesis for Exodus to work.

- **Genesis (standalone) — the manual transmission.** A separate skill at `.claude/skills/genesis-bots` that calls the *same* Genesis copywriting / research / strategy bots **directly** with the member's own `gen_` key — you pick a bot and prompt it yourself. It reads `GENESIS_API_KEY` plus a provider key (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`) from `.env`. This is the member's own workflow, **not** owned by the `exodus-*` skills. (It may not be installed in every folder — check for the `genesis-bots` skill.)

**Routing rule:** "exodus …" → the Exodus pipelines below. Bare **"genesis"**, "run the bots", or a named bot slug → the `genesis-bots` skill (the member's direct workflow — never route it into Exodus). If someone clearly just wants ads and doesn't know which system they have, ask one question — "drive the Genesis bots directly, or run an Exodus pipeline?" — rather than guessing.

**Provider key:** the manual Genesis bots need a provider key in `.env`. `npx @aicopycoders/exodus keys pull` syncs your dashboard provider + image keys down for you (the install runs it; safe to re-run anytime keys change). Exodus's own pipelines don't need it locally — they run server-side.

---

## Multi-Brand Operating Notes

Any user can create and own unlimited brands — `npx @aicopycoders/exodus brand create "<name>"` (or the dashboard); it is NOT admin-only, and brand names are scoped per user (two users can each have an "Evergreen Fitness"). One account key then switches across every brand the user owns (admins: every brand). The only exception is a brand someone ELSE invited the user into — they don't own it, so their key stays pinned to just that one. Never tell a user they can't make brands or are "locked to one brand" just because their key shows `role: member`. The active brand resolves **folder > pointer > key default**: being inside a brand's subfolder wins, then the `brand use` pointer, then the key's default brand.

- **Identify the active brand:** `npx @aicopycoders/exodus brand current` (also says whether it came from the folder or the pointer)
- **List accessible brands:** `npx @aicopycoders/exodus brand list`
- **Create a new brand:** `npx @aicopycoders/exodus brand create "<name>"` — creates it server-side, switches you in, and sets up its local subfolder
- **Switch brand:** `npx @aicopycoders/exodus brand use <slug>` — or just work from inside that brand's subfolder
- **Business type (what it sells, what the ad promises):** `npx @aicopycoders/exodus brand show`; change with `npx @aicopycoders/exodus brand set --sells <product|service|app|expertise|finance|other> --promise <body|money|neither>`. The video picks its B-roll from these.
- **New brand created on the dashboard?** `npx @aicopycoders/exodus@latest init` creates its subfolder and pulls its profile
- **Update the CLI + skills:** `npx @aicopycoders/exodus@latest update` — the only command that refreshes `.claude/skills/` and the workspace docs (`doctor` reports health but never rewrites them)
- **Brand voice / ICP / offer:** the active brand's `state/brand-profile.md` (inside its subfolder; at this root on older single-brand installs) — read this at session start and after any switch. If it doesn't match the active brand, the exodus-strategist skill will prompt to refresh.

Don't carry voice or proven angles across brands — each brand is its own creative universe.

---

## Available Pipelines

### Exodus pipelines (automatic)

These are the **Exodus** pipelines — the automatic system that drives the Genesis bots for you. Use them to generate and analyze creative. Each has its own skill directory in `.claude/skills/`. Invoke them by saying "exodus" plus what you want, or directly with `/exodus-<name>`.

| Pipeline | Skill | When to Use |
|----------|-----------|-------------|
| **Write** | `exodus-write` | **Start here for copywriting.** Say what you want ("exodus, write me some ads"); it routes new-brand → foundation → brief → genesis → Doc and sequences the whole flow. |
| **Genesis** | `exodus-genesis` | Brief → ad copy in two voices (Mario + Infeed). Default 1 pass = 2 variants; scale with `--passes` (pass 2 adds the Top-Ads-biased primer). |
| **Image** | `exodus-image` | **Start here for static images.** Say what you want; it reads the request and routes to the right engine — `exodus-creative` (renders from copy) or `exodus-template` (50 ad-type formats). |
| **Creative** | `exodus-creative` | A specific creative-suite engine (native / copy-derived renders from copy, or ref-match to a reference image) when you've already picked one. Otherwise start at **Image**. |
| **Template** | `exodus-template` | Finished ad copy → many static ads across 50 structured formats (testimonial, hero, UGC…). Otherwise start at **Image**. |
| **Meme** | `exodus-meme` | Meme ads — recommends formats for a brief, then one batched run renders AI-image and classic Imgflip-template memes server-side. |
| **Workflow** | `exodus-workflow` | Run and build saved multi-node workflow automations from the CLI, resolve checkpoint/repair parks from the inbox, continue bot sessions, fire triggers, and read banks or promote winners. |
| **Hooks** | `exodus-hooks` | Read the Scout library — the hook cards captured from Instagram outliers. Compose filters (score, lane, validation status, language, hook type, recency), inspect one card, find cards sharing a hook pattern, export to CSV. Read-only. |
| **Video** | `exodus-video` | Make a video ad from a script by running a saved video workflow (`npx @aicopycoders/exodus workflow run`). Choose the voices as the run starts: `--voices` gives each speaker an ElevenLabs voice, `--voice-treatment` says how the voices are made (including having the video model speak a voice you wrote). Then read and approve the storyboard, `npx @aicopycoders/exodus video pull` every piece (per-scene clips, narration and per-scene voice, keyframes, cast stills, word timings, music bed) plus a manifest, cut them in whatever editor you use (a bundled script is one option), upload the cut and approve it. Admin-only. |
| **Browse** | `exodus-browse` | View history and retrieve past outputs |
| **Drive** | `exodus-drive` | Read/write Google Docs, Sheets, and Drive files via `npx @aicopycoders/exodus drive` (uses the dashboard's Google OAuth — no local CLI) |
| **Swipe / Mining** | (no skill; CLI only) | The competitor watch list behind the Mining page: `npx @aicopycoders/exodus swipe brands list`, `swipe brands bulk-import <csv>` (checks each brand and starts collecting its ads), `swipe brands add "<Name>" --fb <pageId>` (adds one brand and starts checking it the same way), `swipe run` / `swipe mine`. There is no `competitors` verb. |
| **Ads** | `exodus-ads` | Read your own live Meta ads once the account is connected on the dashboard — `npx @aicopycoders/exodus ads list` (sort by cost per result, spend or CTR), `ads show <adId>` (copy, both windows, media links, comment counts), `npx @aicopycoders/exodus comments list` (already commenter-redacted), and `npx @aicopycoders/exodus winners definition` (what this brand means by a winner). Read-only; no Meta login or MCP needed. |
| **Winners** | `exodus-winners` | Mine your own Meta ad account for winning ads and import them into Exodus as generative fuel — interview, visual confirmation, `npx @aicopycoders/exodus winners import`. A brand whose Meta account is connected reads its ads and its winner definition straight from Exodus; only an unconnected brand needs the Meta Ads MCP. |

For the operator-facing quick reference on how to invoke these in Claude Code, see `PIPELINES.md` in the workspace root.

### Method skills (Luke's thinking, in Claude Code)

These are not pipelines. They are Luke's methods written as skills, so the thinking that happens *before* a pipeline runs (who to sell to, what the mechanism is, which competitors matter, what patterns the account shows) happens with the same discipline every time. They run as a conversation with whatever data the user has; some push results into Exodus through the CLI. Anything they write lands inside the active brand's subfolder (`<brand>/state/` for decided artifacts, `<brand>/inputs/` for research), so run `brand current` first. Invoke one by name (`/odf`) or just describe the job.

| Skill | When to Use |
|-------|-------------|
| `thinking-vs-build` | Load first whenever a session does method work (positioning, research, critique). The two modes (think: short lists, one axis per message, propose then the user cuts; build: the full thing, no check-ins) and how to tell which one a message is in. |
| `positioning-spiral` | Positioning a product before any ads: cycles through features, targets, research, catalog, and thinking until segments, mechanisms, and story hang together. Calls the four station skills below. |
| `odf` | Who to sell to. Outcome × Demographic × Facet, one axis at a time. MAP (build the grid), PERSONAS (named humans that live in Exodus), HORIZONTAL (aim a winner at a new segment). Pushes with `npx @aicopycoders/exodus segment`. |
| `mechanism` | The product's unique mechanism of the problem and of the solution, per segment. Uses the Genesis mechanism bots for breadth (needs `GENESIS_API_KEY` plus a provider key), works as a conversation without them. |
| `find-competitors` | Who is actually strong in a niche, on Meta first and Amazon second. Ranked competitor sheet and a watch list. Optional scripts for Atria and the Meta Ad Library via Apify (each needs its own key; they bill per result and say the plan back before spending). |
| `patterns-and-gaps` | What repeats and matters across own ads, competitor ads, organic content, and research, read layer by layer, and the three kinds of gap. |
| `anatomy-of-ads` | The parts list of an ad (Messaging × Creative). Write a brief, dissect any ad into the same parts, tag a batch so patterns can be counted. Also the vocabulary the other skills use. |
| `swipe` | Swipe a winning ad for the active brand at one of three closeness levels (1 same scene, 2 new scene same beats, 3 same bones new drama). Gathers the ad, product, and level, then calls the `swipe-narrative-agent` Genesis bot (needs `GENESIS_API_KEY` plus a provider key). |
| `copy-instincts` | See, Attract, Make. Run on a draft that already exists (hook, ad, mechanism paragraph) to take it from good to great. |
| `bot-builder` | Build a custom bot the way Luke and Mario build the Genesis bots (SEAK), and put it where it runs: an Exodus workflow Prompt node, a Genesis bot, or a skill. |
| `remember-that` | Bank one reaction mid-session ("remember that", "never do X") into `STANDARDS.md`, and push approved winning lines to the matching Exodus bank. |
| `handoff` | End a session: scrape the chat into `workflow/sessions/`, propose standards, write a resume prompt, update the one-page workflow. "handoff review" reads the sessions back. |
| `segment-grid` | The earlier segment-grid kit. Superseded by `odf`; kept for existing hand-off docs. |

**Standards and handoff.** `STANDARDS.md` at the workspace root is the user's taste, written where the system always reads it. Every method skill reads it before producing anything and grades its draft against it. The install creates it once from a template and never overwrites it. Mid-session, "remember that" banks a reaction through `remember-that`. At the end of a session, "handoff" scrapes the chat and proposes standards; nothing is written without a yes. At the start of a session, check the newest file in `workflow/sessions/` (if the folder exists); when it has a **Resume** section, offer to continue from it.

### Genesis bots (manual)

The same folder usually also carries **`genesis-bots`** — the *manual* way to drive the same Genesis bots. You pick a bot and prompt it yourself with the member's own `gen_` key, chaining bots by hand (buyer profile → creative brief → ad hooks → ads). It is **not** an `exodus-*` skill and is **never** invoked by saying "exodus".

| Skill | When to Use |
|-------|-------------|
| `genesis-bots` | The user says bare **"genesis"**, "run the bots", "openclaw", or names a bot slug, and wants to call a Genesis copywriting / research / strategy / image-prompt bot directly. Needs `GENESIS_API_KEY` plus a provider key (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`) in `.env` — see **Dashboard** below. May not be installed in every folder — check for the skill directory before assuming it's there. |

Route a bare-"genesis" ask to this skill and an "exodus …" ask to the pipelines above — never cross the two. If someone clearly just wants ads and doesn't know which system they have, ask one question ("drive the Genesis bots directly, or run an Exodus pipeline?") rather than guessing.

---

## Awareness Level Routing

Every ad targets an audience at a specific awareness level. Getting this right is one of the highest-leverage decisions in creative strategy.

> `--awareness` sets the audience awareness level for a Genesis run (unaware / problem-aware / solution-aware / product-aware). Pick the level the idea is actually written for.

| Level | Audience State | Ad Approach |
|-------|---------------|-------------|
| **Unaware** | Doesn't know they have a problem | Shock, pattern interrupt, reveal |
| **Problem-Aware** | Knows the problem, not the solution | Educate, validate, agitate |
| **Solution-Aware** | Knows solutions exist, not ours | Compare, differentiate, position |
| **Product-Aware** | Knows the brand, hasn't bought yet | Offer, urgency, social proof |

Routing detail and signal patterns live in `.claude/skills/exodus-strategist/SKILL.md` and `references/creative-strategy.md`.

---

## Dashboard

This workspace connects to a live dashboard for:
- Settings management (defaults, account connections)
- **Pipeline keys** — your provider LLM key (Anthropic or OpenRouter) plus Kie.ai, entered once in Settings → Pipeline Keys
- Google Drive credentials (where outputs are saved)
- Run history and output retrieval
- Ad account connections (e.g. the Genesis top-ads-biased track)
- Brand admin (switching, profile management)

The dashboard URL and your `EXODUS_API_KEY` live in `.env`.

**Keys & setup.** Exodus's own pipelines run server-side and need nothing beyond `EXODUS_API_KEY` — there's no provider key to configure for them. The **manual `genesis-bots` path** (and other local tools) *do* need a provider key in `.env`. Enter your keys once in the dashboard, then pull them down:

- `npx @aicopycoders/exodus keys pull` — writes your dashboard provider + Kie.ai keys into `.env` (the install runs this for you; safe to re-run anytime a key changes). It only upserts the keys and preserves the rest of the file.
- `npx @aicopycoders/exodus keys status` — shows which keys are set in the dashboard vs locally. Values are never printed.

---

## Reviewing Run Output

When you need to review a run's creative output, always read it via `npx @aicopycoders/exodus read-doc <runId>`. This walks every tab of the Google Doc and gives you the full output as markdown.

Do **not** use the Drive MCP as your first choice — it only sees tab 1 and will misreport the run as empty. If `npx @aicopycoders/exodus read-doc` exits with code 2 (`unavailable`), fall back to the Drive MCP using the URL printed by the command, and warn the user in your summary that you only saw tab 1.

---

## Tool Feedback

This workspace is also a testbed for the CLI and pipelines. When you run a pipeline and hit a gap — a missing input, missing output, missing filter, awkward flow — log it per the **Tool Feedback Protocol** in `.claude/skills/exodus-strategist/SKILL.md`. Your feedback drives the next round of pipeline improvements.
