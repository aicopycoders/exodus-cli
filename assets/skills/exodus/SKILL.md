---
name: exodus
description: The front door for ALL Exodus requests — the done-for-you ad system (copy pipelines, image engines, brand onboarding) driven by the `npx @aicopycoders/exodus` CLI. Invoke whenever the user says "exodus" and hasn't already named a specific exodus-* skill — "exodus, write me some ads", "use exodus to make images", "set up my brand in exodus", "what can exodus do", "show me my exodus runs". This skill reads the request and routes it to the right exodus-* skill; it never does the pipeline work itself. Only invoke when the user explicitly says "exodus" (or is clearly continuing an Exodus conversation) — never claim generic copywriting/image/idea requests; in shared folders those may belong to the user's other tools. The bare word "Genesis" without "exodus" refers to the member's own Genesis API key and personal bot recipes, NOT to Exodus — if the user asks for "genesis" alone, they mean their own direct Genesis workflow, so do not route them here.
---

# Exodus — the front door

Exodus is the done-for-you ad system: pre-built pipelines that run Luke's full creative process (writing, images, onboarding) through the `npx @aicopycoders/exodus` CLI against the member's brand workspace. The member's only setup is the `EXODUS_API_KEY` already in this folder's `.env` — Exodus handles its own Genesis access internally; the user never configures a Genesis key for Exodus.

This skill ROUTES. Read what the user wants, name the destination skill, and hand off to it. Don't run pipelines from here.

## Routing map

| The user wants… | Route to |
|---|---|
| Write ad copy, has a brief, "where do I start" | `exodus-write` (the copy front door — it sequences onboarding → writing) |
| Run the full writing pipeline on a brief | `exodus-genesis` |
| Static image ads ("make images", "statics", "render this ad") | `exodus-image` (the image front door — it menus engines and confirms before firing) |
| A specific image engine they already chose | `exodus-creative` (native / copy-derived / ref-match) or `exodus-template` (33 ad-type formats) |
| Meme ads ("exodus, meme this offer", "make me meme ads") | `exodus-meme` |
| Run / chain / build / edit a saved workflow, enable/fire its triggers, or roll back a version ("run my workflow", "what does this workflow need", "build a workflow that…", "list my workflows", "enable/fire the trigger", "roll back my workflow", "workflow versions") | `exodus-workflow` |
| Check the workflow inbox or review/resolve a parked run — checkpoint or repair ("check my workflow inbox", "approve that checkpoint", "approve the run", "repair that run") | `exodus-workflow` |
| Continue a bot chat session ("continue that session", "chat with the bot session", "list my sessions") | `exodus-workflow` |
| Read copy banks or promote a winner ("show my hook bank", "list my banks", "promote this winner") | `exodus-workflow` |
| Onboard a new brand / build the primer | `exodus-primer` (with winning ads) or `exodus-foundation` (no ads yet) |
| List/switch/troubleshoot brands | `exodus-brand` |
| Read the Scout hook library — "what do my 15×+ hooks have in common", "show me my Spanish on-screen hooks", "why did that reel score 22×", "export my hooks to a spreadsheet" | `exodus-hooks` (read-only; promoting a card is a dashboard act) |
| Make a video ad, or anything about a Show or a video run — "start a video ad from this script", "is my video run done", "pull the clips and cut them", "upload my cut", "what's wrong with scene 3" (`exodus video`) | `exodus-video` (admin-only on the dashboard; it drives start → storyboard → pull → cut → upload) |
| Write UGC talking-to-camera ad SCRIPTS, no video yet — "write me a UGC script", "swipe this UGC ad", "write me a yapper ad", "use a UGC template" | `ugc-ads` (the front door: it picks `ugc-swipe`, `ugc-template` or `ugc-write`; they call the UGC bots on Genesis and need `GENESIS_API_KEY` plus a provider key in `.env`). Turning a finished script into a video is the row above (`exodus-video`), or `ugc-preproduction` when the member runs the separate UGC video kit ("run the preproduction sheet") |
| Make an animated TIMELINE video ad on the member's own Kie.ai key, without the word "exodus" — "make me a timeline ad", "a skeleton timeline ad", "a Day 1 / Week 2 / Month 3 ad", "turn this winning ad into timeline ads" | `timeline-ad-factory` (Mario's skill: script, storyboard and video on the member's own `KIE_API_KEY` in `.env`; it stops for a yes before each stage and shows a price before the video, but re-rendering a failed clip and the music spend without another yes; it does not use Exodus's video engine). "exodus, make a skeleton timeline video" is the video row above (`exodus-video`, its skeleton timeline template) |
| See past runs / find an output | `exodus-browse` |
| Open or create Google Docs/Sheets | `exodus-drive` |
| Read their OWN live Meta ads and their numbers — "what are my cheapest ads", "where is my spend going", "show me that ad", "what are people saying in the comments on my ads" (`exodus ads` / `exodus comments`) | `exodus-ads` (read-only; already synced by the dashboard, no Meta MCP needed) |
| Import their OWN winning ads from their Meta ad account ("import my winners", "mine my ad account for winners", "exodus winners") | `exodus-winners` (it checks first whether the brand's Meta account is connected — if it is, it reads `exodus ads` and `exodus winners definition` instead of a Meta MCP) |
| Figure out WHO to sell to, segments, personas, "map the market" | `odf` (or `positioning-spiral` when no coherent positioning exists yet) |
| The product's mechanism, "why does this work", "which ingredient leads" | `mechanism` |
| Who the real competitors are, a watch list | `find-competitors` |
| What patterns the ads show, what competitors do that we don't | `patterns-and-gaps` |
| Break an ad down, tag a batch, write a brief | `anatomy-of-ads` |
| Make an existing draft hit harder, "what's wrong with this ad" | `copy-instincts` |
| Build a bot or a workflow prompt node | `bot-builder` |
| "remember that", "never do that again" | `remember-that` |
| "handoff", "wrap up", "what did we do today" | `handoff` |
| Add competitors to the Mining page / watch list, see who is on it ("add these brands to mining", "put Brace Direct on the watch list") | run `npx @aicopycoders/exodus swipe brands bulk-import <csv>` (one brand: `swipe brands add "<Name>" --fb <pageId>`; `swipe brands list` to see the list). There is no `competitors` verb. |
| Update the CLI + skills ("update exodus", "run an exodus update") | run `npx @aicopycoders/exodus@latest update` — the ONLY command that refreshes skills; `doctor` checks health but never rewrites them |

The method skills above are Luke's thinking as skills; they run as a conversation and are listed in `CLAUDE.md` under **Method skills**. If a custom pipeline skill is installed in this folder (any additional `exodus-*` directory under `.claude/skills/`), it routes the same way — match the user's words to that skill's description.

For any creative judgment along the way (awareness calls, hook critique, which pipeline fits), `exodus-strategist` is the operating persona — it activates with the work.

## Two systems, one folder — keep them straight

Think of it as a car: **Genesis is the manual transmission** — the member calls the copywriting
bots directly with their own `gen_` key and shifts every gear themselves. **Exodus is the
automatic** — same engine underneath (it drives those same Genesis bots), but the pre-built
`npx @aicopycoders/exodus` pipelines do the driving. A member who doesn't know the internals just wants their
ads; your job is to put them in the right one.

Members often have TWO ways to use the Genesis bots, and they may both live in this folder:

1. **Exodus (this system)** — automatic. Pre-built pipelines, `npx @aicopycoders/exodus` commands, `EXODUS_API_KEY` in `.env`. Genesis access is internal — there is nothing to configure, fix, or debug about Genesis keys for Exodus. If an Exodus command fails, run `npx @aicopycoders/exodus doctor` first and follow what it prints.
2. **The member's own Genesis API workflow** — manual. Their personal `gen_` key (`GENESIS_API_KEY` in `.env`) calling `gas.copycoders.ai` directly, usually via their own skills/recipes from the workshop. That workflow is NOT Exodus and is not owned by the exodus-* skills.

When the user says "genesis" without "exodus", they mean #2 — leave it to their own tooling. Never paste a `gen_` key into Exodus configuration, never register any of these URLs as an MCP server, and never invent constraints about either system that aren't documented in these skills or printed by the CLI.

## If the request is ambiguous

Ask one short question ("Do you want this through Exodus, or your own Genesis bots?") rather than guessing — in shared folders, guessing wrong sends the user down the wrong system entirely.
