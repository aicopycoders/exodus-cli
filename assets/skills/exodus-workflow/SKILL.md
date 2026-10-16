---
name: exodus-workflow
description: Run, chain, build, edit, and automate saved Exodus Workflows — the multi-node automations that wire Genesis bots, primers, briefs, transforms, and image nodes together on the dashboard canvas — from the CLI. Use it to list a brand's workflows, describe what a workflow needs before running it (inputs, per-workspace primer prerequisites, outputs), run one and collect its outputs, chain one workflow's output into another's input, browse the bot catalog, author or update a workflow contract via templates → edit → validate → import, resolve runs that park (approve a run paused at a checkpoint, check the workflow inbox, repair a stalled run, answer a nested workflow's slots), continue a bot session in chat, enable/disable/fire triggers, read the brand's copy banks or promote a winner, and list versions or roll one back. Only invoke when the user has explicitly invoked Exodus: they said "exodus" in the request ("exodus, run my launch workflow", "exodus, what does this workflow need", "exodus, build a workflow that turns a swipe into hooks then ads", "list my exodus workflows", "exodus, edit that workflow", "exodus, approve that checkpoint", "exodus, check my workflow inbox", "exodus, resolve that parked run", "exodus, continue that session", "exodus, enable/fire the trigger", "exodus, read my hooks bank", "exodus, promote this winner", "exodus, list the versions / roll it back"), named this skill or /exodus-workflow, ran an `npx @aicopycoders/exodus workflow` / `session` / `bank` command, or the `exodus` hub skill routed here. Never claim generic "workflow"/"automation"/"inbox"/"promote a winner"/"continue the session" requests ("automate this", "build me a workflow", "check my inbox") without Exodus context — in shared folders those may belong to the user's other tools; if the user did not say exodus, this skill is not for them. The bare word "Genesis" without "exodus" refers to the member's own Genesis API key and personal bot recipes, NOT to Exodus.
---

```operator-guide
Core — discover & run:
  exodus workflow list [--json]                              List the brand's saved workflows
  exodus workflow describe <workflowId|name> [--json]        Inputs, prerequisites, outputs
  exodus workflow bots [--category <cat>] [--slug <slug>] [--json]   Bot catalog / one bot's spec
  exodus workflow run <workflowId|name> [--input key=value ...] [--fill <name>] [--voices <json|@file>] [--voice-treatment <name|json|@file>] [--auto-approve] [--wait] [--out <dir>] [--json]   Run it
  exodus workflow status [--id <runId>] [--out <dir>] [--json]   Poll a run / read its outputs (no --id → the brand's 25 newest runs + their ids)
  exodus workflow cancel <runId> [--reason "..."] [--json]   Stop a run that hasn't finished — queued, running, or parked
  exodus workflow export <workflowId|name> [--version <n>] [--out <file>] [--json]   Dump the contract (YAML)

Authoring:
  exodus workflow templates [list] [--json]                  List starter templates
  exodus workflow templates export <key> [--out <file>] [--json]   Write a template's YAML to edit
  exodus workflow schema [--kind <kind>] [--face <face>] [--json]   Live graph vocabulary
  exodus workflow validate <file> [--update <workflowId>] [--json]   Check a file (import --dry-run's door)
  exodus workflow import <file> [--update <workflowId>] [--dry-run] [--json]   Create/update a workflow

Parked runs:
  exodus workflow inbox [--json]                             Every run parked waiting on you
  exodus workflow checkpoint <runId> [show | edit <n> | approve [--reject <n,..>] [--wait] | retry [--note "..."] [--wait] | cancel [--reason "..."]] [--json]   Resolve a checkpoint park
  exodus workflow gate <runId>                              RETIRED in 2.0 — prints a pointer at "checkpoint" and exits 1
  exodus workflow repair <runId> retry|skip|kill [--wait] [--json]   Resolve a repair park
  exodus workflow answer <runId> [--slot key=value ...] [--json]   Answer a nested workflow's slots (no --slot → list them)

Sessions + triggers:
  exodus session list [--json]                               Chat sessions on the active brand
  exodus session show <sessionId> [--json]                   A session's turns
  exodus session chat <sessionId> "message" [--json]         Append a message, print the reply
  exodus workflow triggers <workflowId|name> [enable <n> | disable <n> | fire [<n>] [--text "..."] [--wait]] [--json]   List/flip/fire triggers

Banks + versions:
  exodus bank list [--json]                                  The brand's copy banks
  exodus bank show <key> [--json]                            One bank's entries (newest-first)
  exodus bank promote <key> [text] [--file <path>] [win/provenance flags] [--json]   Land a winner (fires the flywheel)
  exodus workflow versions <workflowId|name> [--json]        A workflow's saved history

Flag notes that add agent-level guidance (everything else is in --help):
  --input key=@path    Load an input's value from a file (path resolved from cwd);
                       key=@@text keeps a leading "@" as a literal character.
  --input key=<path>   (run) A FILE input — one `describe` reports with source
                       "asset" — takes a local file path instead of text: the CLI
                       uploads the file and sends the stored asset in its place
                       (--input hero=./photos/hero.png). An http(s) URL works too
                       (--input hero=https://example.com/hero.png) — the server
                       fetches and registers it at launch. An asset id from an
                       earlier upload is relayed as-is. Accepted: image PNG/JPEG/
                       WebP/GIF ≤15MB, video MP4/MOV/WebM ≤200MB, audio MP3/M4A/
                       WAV/OGG ≤50MB, document PDF/TXT/MD/DOC/DOCX ≤25MB.
  --voices <v>         (run, video workflows) Give each speaker in the script an
                       ElevenLabs voice from the moment the run starts, instead
                       of at the storyboard review. A JSON object keyed by the
                       names the SCRIPT uses ("HOST 1"), or @path to a file
                       holding one — the same voices.json "exodus video voices
                       <run> --from" reads, so a brand keeps one file for both.
  --voice-treatment <v>  (run, video workflows) Say HOW the run makes its voices.
                       A name on its own picks a way of working that plays a
                       voice you already have (and still takes --voices); a JSON
                       object, or @path to one, shaped {"path": "...",
                       "describe": {"HOST 1": "..."}} has the video model speak
                       the lines itself in a voice you WROTE, one description per
                       speaker. Written voices and --voices are refused together:
                       the ElevenLabs voices would be paid for and never heard.
                       Chosen at launch only — the storyboard review can show a
                       written voice but cannot change it. Anything the run could
                       not do stops the launch before the run exists. The full
                       flow is in the exodus-video skill.
  --auto-approve       (run) Send this ONE run off unattended: every Checkpoint it
                       reaches is approved for you, exactly as it stands, and the
                       run records that nobody looked. Without it a Checkpoint
                       parks and waits for a person. Never a workflow setting —
                       you choose it per launch, so ask before using it.
  --out <dir>          (run --wait / status --id) Save the finished run's delivered
                       outputs into this directory and print the paths: text as
                       .md, storyboards/frame sets as .json, images/video/audio
                       downloaded. Unfulfilled slots are reported, not written.
  --version <n>        (export) A real 1-based id from `workflow versions`; a
                       version export carries NO triggers/description.
  --reject <n,..>      (checkpoint approve) Only when the checkpoint is holding
                       one arrival per item (a Splitter fan-out). Drops those
                       item numbers —
                       the "Item N of M" headings in `checkpoint show` — and
                       approves the rest. Rejecting every item is refused.

Every workflow/session/bank verb takes --json, and that output IS the machine API —
there is no separate agent command set.

Auth: Bearer (EXODUS_API_KEY). The canvas lives on the dashboard at /workflows.
```

# Workflow — Run, Resolve, Build, and Automate Saved Workflows

An Exodus **Workflow** is a saved graph the member builds on the dashboard canvas (`/workflows`): brief and primer sources feed Genesis bots, bots feed transforms, formatters, other bots, or an image node, deposits land copy in banks, a Checkpoint box on a wire stops the run for a human's approval, and an Output node collects the deliverables. This skill is the CLI operator for those graphs — a **peer door** to the same artifact the web canvas edits. Anything you can do to a run in the browser (approve a checkpoint, repair a stall, continue a session, promote a winner), you can do here.

**The `--json` contract (read this once).** Every `workflow`, `session`, and `bank` verb takes `--json`, and that structured output **is** the machine API — there is no separate agent command set and no MCP server. Read for humans without it; parse `--json` when you need to chain or branch on the result.

**Polling a run in `--json`: the fields that matter.** `workflow status --id <runId> --json` returns the run object as-is. The keys a poll loop actually needs:

- **`status`** — the run's **stored lifecycle state**, as the machine spells it: `queued`, `running`, `awaiting-approval`, `succeeded`, `succeeded-with-warnings`, `failed`, `cancelled`. **Branch on this key, not on the printed words.** One warning: a run created before the 2.0 rename can still store the old spelling — `awaiting-review`, `completed`, `partial`, `canceled` — so treat those as the same states.
  - **The human `status:` line is a JUDGEMENT, not this raw value.** It starts from this field and then reads the rest of the run, so the two can legitimately disagree: a run stored `succeeded-with-warnings` that delivered no slot at all prints `Failed — nothing delivered`, and a run stored `awaiting-approval` that is only waiting on a child workflow prints `Running — sub-workflow`. Neither is a bug — the printed line is the honest verdict for a human, the key is the state machine. If you need the verdict a person would see, don't recompute it from `status` alone: read `counts` and `deliveries` too, or just read the human output.
- **`isTerminal`** — `true` once the run is finished for good and polling should stop. Trust this over comparing status strings yourself; a park is **not** terminal.
- **`counts`** — step tallies: `done`, `failed`, `skipped`, `total`, plus `outOfScope` on runs that deliberately skipped steps outside the run's scope (absent otherwise). **This is a final tally, not a progress meter.** It is added up once, at the moment the run reaches its end — finished, failed, or cancelled — so on a run that is `queued`, `running`, or parked the key is simply **not there**. Never build a progress readout on it; count the `nodes` array yourself if you want live progress.
- **`nodes`** — one entry per step, each with its own `nodeId`, `kind`, `status`, and `outputs`.
- **`outputs`** — the flat pile of final deliverables, the chaining surface (see §8).
- **`deliveries`** — the named, typed promises answered slot by slot (`delivered` / `unfulfilled`). Present on newer backends; when it's there, read it before `outputs`.
- **`pauseReason`** — why the run parked. **Only read it when `status` is awaiting-approval**: it is left behind on a run that was cancelled out of a park, so a terminal row can still carry a stale one. **Five values are stored, and it can also be missing altogether — so always write a fallback branch, never a switch that assumes four cases:**
  - `checkpoint`, `repair`, `slots` — each names the verb that resolves the park (`checkpoint` / `repair` / `answer`).
  - `call` — informational. The run is waiting on a child workflow and resumes by itself when the child finishes, so there is nothing for you to do (which is also why `call` parks are kept out of `inbox`).
  - `taste` — **frozen legacy**: a run that parked at the Gate box, which retired in 2.0. Nothing writes it any more, but old rows still carry it. It cannot be resumed — cancel the run and run the workflow again.
  - **absent** — an old cost-gate park, from before parks recorded a reason. The run is still alive and still approvable, but **no CLI verb resolves it**: the checkpoint/repair/answer verbs all refuse it by name ("parked at the cost gate (legacy)"). Send the user to the dashboard run page to approve it there, or cancel it.

Run `status --json` with **no** `--id` and you get `{ "runs": [...] }` instead — a lighter row per recent run, each carrying `_id`, `workflowName`, `status`, `pauseReason`, and `createdAt`. That is the list to search when you need a run's id.

**That list is capped at the 25 newest runs, and it never says so.** Nothing in the output marks the cut-off, so a run that exists but is older than the last 25 simply isn't in it. Never read an absence there as "it didn't run" on a busy brand — say "not in the 25 most recent" and, if you have the run id, check it directly with `status --id <runId>`.

**Auth is one bearer key.** `EXODUS_API_KEY` from `.env` authorizes every verb; there are no scoped tokens. If a call 401s, run `npx @aicopycoders/exodus doctor`.

## The agent operating loop

The end-to-end narrative, every step naming its verb. You rarely walk all of it — jump to the section you need — but this is the spine when you're driving a workflow from nothing to a promoted winner:

1. **Author** — start from a template (`workflow templates`, then `templates export <key>`), edit the YAML, and pull live vocabulary with `workflow schema` as you go.
2. **Validate** — `workflow validate <file>` until it comes back clean (it's `import --dry-run` under its own door).
3. **Import** — `workflow import <file>` to create, or `import <file> --update <id>` to edit in place.
4. **Describe** — `workflow describe` to confirm inputs, prerequisites (✓/✗ primers), and outputs before spending a run.
5. **Run** — `workflow run … --wait` (streams progress, prints outputs) or omit `--wait` and poll `workflow status --id <runId>`. Inputs come from `--input key=value` flags, from `--fill <name>` (a saved fill — a named, reusable set of launch answers saved from the app's Run dialog; flags win per key when you pass both), or a mix. Launches that don't satisfy the workflow's entry contract are rejected at the door with the gap named — `describe` shows each input's type, required/optional, and accepted values. Add `--auto-approve` only when the run is meant to go start-to-finish with nobody watching: it approves every Checkpoint the run hits, unchanged, instead of stopping for a verdict. It's a per-launch choice, not a setting on the workflow, and the run keeps a record of each stop it waved through — so confirm with the user before you pass it.
6. **Notice the park** — a run can stop and wait on you. There are no webhooks in v1; you notice a park one of three ways: `run --wait` prints a pause notice naming the verb to use (the command keeps waiting — resolve from another shell, or Ctrl-C and pick it up via `inbox`), `workflow inbox` lists it, or `workflow status --id <runId>` prints `status: Awaiting approval`. One exception: a **video** workflow's storyboard gate and final watch END the wait (exit 0) and print the same `Parked: …` block `exodus video status` prints, with the next command under it — resolve with the `exodus video` verbs it names (see the `exodus-video` skill).
7. **Resolve** — `workflow checkpoint <runId> …` (the run reached a Checkpoint box), `workflow repair <runId> …` (a stalled collector), or `workflow answer <runId> …` (a nested workflow's slots).
8. **Harvest** — read deliverables with `workflow status --id <runId> --json`; read banked deposits with `bank show <key>`; keep thinking with a bot via `session chat`.
9. **Promote** — `bank promote <key>` lands the winner **and** emits the `winner-promoted` event, so any workflow with an **enabled** matching trigger starts a background run. To find out whether one actually started, run `workflow status` with **no** `--id` — the recent-run list. Don't send the user to `inbox` for this: `inbox` only holds runs waiting on a person, and a flywheel run with no approval step will never appear there (§5).

## 1. Discover & run

The mistake to avoid is firing a run blind and wasting it on a missing input or an unmet prerequisite. Always **`describe` before `run`**.

### Step 1 — List

```bash
npx @aicopycoders/exodus workflow list
```

Prints the brand's saved workflows (name, id, node/edge counts, timestamps). If the user named the workflow already, skip straight to `describe`.

### Step 2 — Describe (read inputs, prereqs, outputs)

```bash
npx @aicopycoders/exodus workflow describe "Launch Flow"
```

Accepts a workflow id **or** a name. It reports three things:

- **Inputs** — each free input the run needs: field name, source (`text`, `swipe-ad`, `swipe-bundle`, `organic-url`, `ad-url`, `asset`), whether it's required, and a description. These are the `--input key=value` pairs you'll pass. A source of **`asset`** is a **file** input — the workflow wants an actual image, video, audio clip, or document, and describe names which family it takes (e.g. `hero — asset (image), required`).
- **Prerequisites** — the per-workspace primer markers the graph's primer nodes depend on, each shown **✓ stored** or **✗ missing** for *this brand*. **If any prerequisite is ✗, warn the user before running** — the run will not produce good output (or will fail) without it. Route them to the `exodus-primer` / `exodus-foundation` skill to fill the gap first, rather than burning a run.
- **Outputs** — the deliverables the Output node collects (text or image, with labels), so you know what to expect back.

### Step 3 — Gather inputs

Fill every required input. For a free-text brief you can compose a **bespoke brief from in-session research** — the winning angle you just worked out, the swipe you analyzed — and pass it inline (`--input brief="..."`) or, if it's long, write it to a project file and pass it with `@file` (see Chain, below). For URL/swipe sources, pass the value the source expects.

**A brief wired straight into a Storyboard is a script, not a prompt.** On a video workflow whose Storyboard takes its `script` port from a Brief node, the text you pass for that brief boards VERBATIM, the same way a Show ad's pasted script does: one speaker per scene, every line rendered once in order, long lines split across clips, narrated lines rendered silent under the voice track. So it must be in the script form the `exodus-video` skill documents (an optional `DIRECTION:` block with no colon in its prose, then an optional `CAST:` block of `NAME — description` lines, then `NAME:` turns, then a `CTA:` block; `NARRATOR:` lines only for Narrated Story and Explainer). A brief that is not a script, or one that does not fit the wired rig's family, is refused at launch with the parser's own message and nothing is spent. Write the script to a file and pass it with `--input script=@script.txt`. A Storyboard fed by a bot is unaffected. This path does not tidy: if the user hands you a plain transcript, a rough draft or a description, start it with `exodus video start --script <file> --conceit …` instead, which takes the text as it is and lays it out on the server (see the `exodus-video` skill's "The script file"), or run that with `--stop-at-script` first to get the script in the format for the Brief.

**A saved rig can bring a rulebook with it.** Some saved rigs carry saved format rules: how many speakers the script may have, which checks run on the clips, how the cast is built. Point a Rig box at one of those rigs and the run follows its rules — an ensemble rig seats more speakers than the usual three, a talking-head rig seats one. The start receipt says which rulebook ran:

```
Format rules: Ensemble Talking Head, version ensemble-e1-provisional-2026-07 (from the "rig_1" Rig box).
```

`workflow status` says the same line later, and `video pull` writes the same facts into `manifest.json` under `provenance`. Nothing prints the rules themselves — they are the house's, not the brand's — only whose they were and which version ran.

Three things to know before you wire one:

- **One run, one rulebook.** If any Rig box's rig carries rules, every Rig box in the workflow has to point at that same saved rig. A second box on a different rig, or a box with its knobs set in place, refuses the launch with a sentence naming every box. Nothing is spent.
- **Some rulebooks aren't released yet.** A rig that is still being built refuses a member's launch and names itself. Only an admin can start a run on one. Duplicating that rig doesn't get around it — the copy still reads the original's rules, so the answer is the same.
- **The rig's video model is advice, not a change.** When the rig is normally filmed with a different video model than the one your Video step is set to, the receipt says so in one line and the run uses YOUR setting. Change the Video step yourself if you want the rig's.

For an **`asset` (file) input, pass the path to a local file** and the CLI does the uploading for you — mint, push the bytes, register, then start the run with the stored asset:

```bash
npx @aicopycoders/exodus workflow run "Product Shots" --input hero=./photos/hero.png --wait
```

A bare path is the argument (a leading `@` is accepted and ignored — a file field never text-expands). Accepted files: **image** PNG/JPEG/WebP/GIF ≤15MB · **video** MP4/MOV/WebM ≤200MB · **audio** MP3/M4A/WAV/OGG ≤50MB · **document** PDF/TXT/MD/DOC/DOCX ≤25MB. **Every file you passed is checked first — all of them — before a single byte moves**, so one bad path can't leave the others half-uploaded; you get every problem in one message and fix them in one edit. If an upload itself dies partway, the message names the asset ids that DID land so you can pass those instead of re-uploading them.

There is no file picker and no prompt: a required file input with no `--input` fails immediately, naming the flag to pass. If you already uploaded the file on an earlier run, pass the asset id instead of the path and it's relayed as-is.

One edge case worth knowing: the CLI reads the workflow's input list before it uploads anything. If that read fails (the server is down or flaking) and any value you passed looks like a file path, the run stops right there rather than sending your path as literal text. Retry, or pass an already-uploaded asset id.

### Step 4 — Run and collect

```bash
npx @aicopycoders/exodus workflow run "Launch Flow" --input brief="new cortisol offer, problem-aware" --wait
```

`--wait` polls to a terminal status and prints the run's collected outputs — text inline, image URLs. Without `--wait` the command returns the `runId` and you poll it yourself:

```bash
npx @aicopycoders/exodus workflow status --id <runId>
```

There is no way to run only part of a graph: a run executes the whole workflow or it doesn't start.

**Read the `Deliveries:` block first.** Each Output node on the canvas is a named, typed promise — "Final ad copy · text", "Hero image · asset" — and a finished run answers every one of them: `delivered` with the artifacts underneath, or `unfulfilled` with the reason the upstream node gave. That block is the honest scorecard; the `Outputs:` block below it is the same artifacts as one flat pile, kept for chaining. If a run says `Succeeded` but a slot says `unfulfilled`, the workflow did NOT deliver what it promised — say so.

**Save the deliverables to disk with `--out <dir>`** (works on `run --wait` and on `status --id`):

```bash
npx @aicopycoders/exodus workflow run "Launch Flow" --input brief="new offer" --wait --out ./deliverables
npx @aicopycoders/exodus workflow status --id <runId> --out ./deliverables
```

Every delivered slot becomes a file named `<workflow>-<runId tail>-<slot key>.<ext>` — text as `.md`, storyboards and frame sets as `.json`, images/video/audio downloaded from their URLs — and each written path is printed. Unfulfilled slots are reported, never written. The directory is created if it doesn't exist.

Report the outputs plus a short take. Don't call a run "done" off the kickoff line alone. **`status` prints one `status:` line, and it says one of seven words:** `Queued`, `Running`, `Awaiting approval`, `Succeeded`, `Succeeded with warnings`, `Failed`, `Cancelled`. Some of them carry a short "why" after a dash — `Awaiting approval — needs repair`, `Awaiting approval — needs inputs`, `Running — sub-workflow` (it's waiting on a child workflow, not on you), `Failed — nothing delivered` (steps failed AND not one promised slot arrived, so it is not a success no matter what the run row says). `Succeeded with warnings` means some steps were skipped or failed but the run still delivered. `Awaiting approval` means it **parked** and is waiting on you (see the next section). Read `status` before declaring victory.

## 2. Runs that park

A run doesn't always finish on its own — it can **park** and wait for a human decision. There are three actionable park kinds:

- **checkpoint** — the run reached a **Checkpoint** box on the canvas and is holding there until you approve what's flowing through it.
- **repair** — a require-all collector stalled on a dead input and needs a decision.
- **slots** — a nested sub-workflow is waiting on inputs (slot answers).

**No webhooks in v1 — nothing parks silently, but nothing pings you either.** You find parks three ways: `run --wait` prints a pause notice naming the verb to use (a builder park is not terminal — the command keeps polling so it can resume after you resolve; resolve from another shell, or Ctrl-C and pick it up via `inbox`. A **video** workflow's storyboard gate and final watch are the exception: they end the wait with exit 0 and the `Parked: …` block `exodus video status` prints, next command included); `workflow inbox` lists every parked run badged by kind (`checkpoint`/`repair`/`slots`; the badge `gate` shows up only on a pre-2.0 run parked at the retired Gate node — those can't be resumed, cancel and run the workflow again) and how it started (`bg`, `trig:<event>`); or `workflow status --id <runId>` prints `status: Awaiting approval`.

### `inbox` vs the run list — two different questions

**`inbox` answers one question: what is waiting on a person?** For that job it is the right list — how a run started makes no difference to it. A run fired by a trigger, by a promote's flywheel, or in the background shows up there when it parks for a decision, exactly like a run you launched by hand.

Two limits worth knowing before you treat an empty inbox as proof of anything:

- **A run waiting on a child workflow is deliberately left out.** That is the `call` park — the parent resumes by itself when the child finishes, so there is nothing for you to decide and it is filtered out on purpose. It is still parked; it just isn't your problem.
- **The inbox shows the 50 newest parked runs**, and prints no notice when it hits that ceiling. On a brand with more parks than that, the oldest ones fall off the end.

**What `inbox` does not list is work that isn't waiting on anybody.** A queued run, a running run, and any automation that ran start-to-finish without an approval step never appear there — not because they're hidden, but because there is nothing for you to decide. Plenty of workflows are built that way on purpose; the shipped **Winner Flywheel** starter is one (brief → splitter → output, no Checkpoint box anywhere), so its run *can never* show up in `inbox`. An empty inbox after a promote means "nothing needs you", not "nothing ran".

**To see runs that aren't waiting on you, run `workflow status` with no `--id`.** That prints the brand's recent runs — newest first, one row each with the run's own name (the name you gave it, else the first line of its brief, else the workflow's name), its type ("Copy run" or "Workflow"), its status, the **date** it started, and its **run id**. That bare list is how you discover a background run at all, including one that started and finished while you weren't looking; take the id from it and `status --id <runId>` for the full detail.

Two things about that list you have to know before you answer a question with it:

- **It stops at the 25 newest runs and says nothing about the ones it dropped.** On a brand that runs a lot, "did my promote start a run?" can read as *no* when the honest answer is "yes, but more than 25 runs ago". Treat a miss as "not in the last 25", not as "never happened".
- **The `created` column is a date with no clock time** (`2026-08-15`). Every run started today looks identical, so it cannot tell you whether a run started before or after something else you did a few minutes ago. Use the ordering instead — the list is newest-first, so a run kicked off by your promote is at or near the top.

```bash
npx @aicopycoders/exodus workflow status          # recent runs: name, status, created, run id
npx @aicopycoders/exodus workflow status --id <runId>   # one run in full
npx @aicopycoders/exodus workflow inbox           # only the runs waiting on a person
```

### Stopping a run early — `workflow cancel`

**A run you want to stop does not have to be parked.** `workflow cancel <runId>` stops any run that hasn't finished — waiting in the queue, halfway through, or parked at a checkpoint, all the same verb:

```bash
npx @aicopycoders/exodus workflow cancel <runId> --reason "wrong brief"
```

This is the verb to reach for the moment a run is going the wrong way. A run costs money the entire time it is queued or running, so you do **not** have to wait for it to reach a Checkpoint before you can pull the plug.

What cancelling guarantees: the run is marked cancelled and will not advance another step, and any sub-workflow it started is cancelled with it. What it does **not** guarantee: that the step already mid-flight dies instantly. A stop is sent to the worker, but that hop is best-effort — if it doesn't land, the step can finish what it was already doing before everything comes to rest. So cancel promptly, and don't promise the user that a half-finished image or video was stopped mid-render.

- **`--reason "..."`** is optional and recorded on the run's history, so anyone reading it later sees why it stopped. Use it.
- **A run that already finished is refused** — the CLI relays the server's own sentence ("This run has already finished — there is nothing to cancel."). That is a statement of fact, not an error to work around.
- **Get the run id from `workflow status`** (no `--id`) if you don't have it in front of you.
- **`workflow checkpoint <runId> cancel` still works** and does exactly the same thing — it's the older name for this, kept so existing habits and scripts don't break.

### The `gate` verbs retired in 2.0

`exodus workflow gate …` no longer does anything: the Gate node it drove was
removed. Running it prints a pointer at `workflow checkpoint` and exits 1.

A run that parked at a Gate box **before** 2.0 is frozen there — it can't be
resumed, because the step it's waiting on no longer exists. Cancel it and run the
workflow again:

```bash
npx @aicopycoders/exodus workflow cancel <runId> --reason "legacy gate park"
```

### Checkpoint parks — show / edit / approve / retry / cancel

A **Checkpoint** is its own box on the canvas, sitting on a wire between two steps: the step before it finishes, the work reaches the Checkpoint, and the whole run stops there until a human signs off. Because it's a box you can see, the diagram tells you exactly where a run will stop. **The park itself waits indefinitely** — nothing on the server expires it, and the sweep that kills stalled runs deliberately skips parked ones, so a run can sit at a Checkpoint for days and lose nothing. **The `--wait` command watching it does not wait that long:** after about an hour of polling it gives up, exits non-zero, and prints `Timed out waiting. Check later: exodus workflow status --id <runId>`. That is the *command* ending, not the run — the run is still parked exactly where it was, and `inbox` or `status --id` picks it back up. A Checkpoint is never approved automatically — not in a background run, not in a triggered one. The single exception is a run someone launched with `run --auto-approve`, which is an explicit "nobody is watching this one" choice made at launch time; those runs approve each Checkpoint as they reach it and mark the stop as auto-approved.

The box itself does no work: whatever arrives goes straight back out, unchanged, the moment you approve.

There are **no candidates to pick** — there's held work to read and either bless, fix, or redo. Outputs are numbered **1-based**:

```bash
npx @aicopycoders/exodus workflow checkpoint <runId>                  # show what's waiting at the checkpoint
npx @aicopycoders/exodus workflow checkpoint <runId> edit 1 --text "tighter opener"   # rewrite an output in place
npx @aicopycoders/exodus workflow checkpoint <runId> approve --wait   # sign off, the run continues
npx @aicopycoders/exodus workflow checkpoint <runId> retry --note "make the hook punchier" --wait   # redo the step feeding it
npx @aicopycoders/exodus workflow checkpoint <runId> cancel --reason "wrong direction"   # stop the run here
```

- **`edit`** takes `--text`, `--file <path>`, or piped stdin. It does **not** resume the run — edit first, then `approve`.
- **`retry`** discards what's waiting and re-runs the step **feeding** the checkpoint (re-running the checkpoint itself would hand back the identical text, since it only passes things through). The run parks right back at the *same* checkpoint with the fresh output — that re-park **is** the success. So `retry --wait` finishes as soon as the new output is ready, prints it, and hands you back the same four choices; it does **not** wait for the run to complete (it never would). Review the fresh output and `approve` when you're happy. Add **`--note "..."`** to say what was wrong: a step that calls a model is given the note on the re-run, and every step records it on the run's review trail either way.
- **`cancel`** stops the run for good, recording your reason — the same audit trail the web uses. It is the same action as the top-level `workflow cancel <runId>`, so you can use either; the top-level one is the one to remember, because it also works on a run that hasn't parked.

**Authoring one** (when you're building or editing a graph from the CLI): add a `checkpoint` node and put it **on the wire** — producer → checkpoint `in`, checkpoint `out` → whoever used to receive it. `in` accepts any wire type so the box drops onto any wire; `out` is typed by `config.passType`, which must name the **same type as the wire feeding it** (`text` is the default and by far the common case). Get that wrong and `validate` returns `bad-config` naming the wire's real type.

```yaml
- id: approve-hooks
  kind: checkpoint
  config:
    passType: text
```

**Older workflows convert themselves.** Before this, a pause-for-approval was a hidden switch inside a step's settings. Any graph that still carries one is rewritten automatically — the switched step becomes that step followed by a Checkpoint box — the moment it's opened, saved, imported, or restored. Never author the old `checkpoint` config key; it's dropped on sight. Runs that finished (or parked) under the old shape are left exactly as they are, and a run parked the old way still resolves through these same verbs.

#### When the work arrived once per item (a Splitter fan-out)

If a Splitter (below) sits upstream, the checkpoint saw **one arrival per item**, and `show` groups what's waiting under **`Item 1 of 7`**-style headings. The run still parks **once**, after every lane has finished — you review the whole batch in one sitting.

The numbering does **not** restart per item: rows are numbered straight through, so `edit 4` still means row 4 wherever it sits. What's new is that you can drop whole items:

```bash
npx @aicopycoders/exodus workflow checkpoint <runId>                        # grouped by item
npx @aicopycoders/exodus workflow checkpoint <runId> approve --reject 2 --wait      # keep all but item 2
npx @aicopycoders/exodus workflow checkpoint <runId> approve --reject 2,5 --wait    # drop items 2 and 5
```

- `--reject` takes the **item numbers you see** (1-based, comma-separated) — not row numbers, not the 0-based indexes in `--json`.
- **Rejecting is filtering, not failing.** The dropped items disappear from the batch and the run carries on with the survivors; nothing is marked failed and no warning is raised. Say it that way to the user: "kept 5 of 7."
- **Approve with no `--reject` keeps everything** — the ordinary approve, unchanged.
- **Rejecting every item is refused.** If nothing is worth keeping, stop the run instead (`workflow cancel <runId> --reason "..."`) — that's the honest action, and the CLI relays the server's message telling you so.
- `edit <n>` works inside a fan exactly as it does anywhere else; edit the rows you want to fix, then approve (with or without `--reject`).

### Repair parks — retry / skip / kill

```bash
npx @aicopycoders/exodus workflow repair <runId> retry   # re-run the dead input
npx @aicopycoders/exodus workflow repair <runId> skip    # drop the dead input, continue with the rest
npx @aicopycoders/exodus workflow repair <runId> kill    # give up on the run
```

Add `--wait` to `retry`/`kill` to poll through to the next terminal state or park.

### Slot parks — answer

A nested sub-workflow waiting on inputs is a **slots** park. Run `answer` with **no** `--slot` to list the pending slot ids, then supply them:

```bash
npx @aicopycoders/exodus workflow answer <runId>                              # list the slot ids it wants
npx @aicopycoders/exodus workflow answer <runId> --slot tone=casual --slot length=short
```

## 3. Sessions

Some bots run in **session-mode**: their run leaves behind a live chat session you can keep talking to. You don't create sessions here — they're born from runs — but you can list, read, and continue them:

```bash
npx @aicopycoders/exodus session list                        # sessions on the active brand
npx @aicopycoders/exodus session show sess_123               # the session's turns
npx @aicopycoders/exodus session chat sess_123 "make the hook punchier"   # one-shot: append + print reply
```

`session chat` is a one-shot append-and-reply, not an interactive REPL — one message, one reply per call. **Replies can take minutes** (the chat route's budget is ~5 minutes), so don't treat a long wait as a hang. The `workflow status` output names the session tied to a run — that's your run→chat jump when you want to keep thinking past what a run produced.

## 4. Triggers

A **trigger** makes a workflow run itself — on a schedule (cron) or on a platform event (e.g. a promoted winner). Triggers live on the workflow and are addressed by **1-based position**, not by id:

```bash
npx @aicopycoders/exodus workflow triggers "Winner Flywheel"            # numbered list
npx @aicopycoders/exodus workflow triggers "Winner Flywheel" enable 1  # flip one switch on
npx @aicopycoders/exodus workflow triggers "Winner Flywheel" disable 1 # flip it off
npx @aicopycoders/exodus workflow triggers "Winner Flywheel" fire 1 --text "fake winner copy" --wait
```

- **`enable`/`disable` flip exactly one switch** — never rewrite a trigger by re-importing the whole contract to toggle it. The CLI reads the live trigger list and sends a **fingerprint** of the trigger's fields as a guard, so if the workflow changed under you the flip **fails loud** rather than hitting the wrong trigger. If it fails, re-list and retry.
- **Add or remove triggers by editing the YAML export** (they live in the head export) and re-importing — enable/disable never adds or removes, only toggles.
- **`fire`** starts a **real** background run on the workflow owner's keys. An event trigger's `fire` needs `--text` (the input the event would carry); a cron trigger's `fire` rejects `--text`. Its checkpoints park into the **inbox** like any other run.

**The ruled test flow:** author the workflow with the trigger **disabled** → `fire <n> --text "fake winner copy"` to dry-fire it and watch the run (checkpoints land in the inbox) → `enable <n>` once you're happy with what it produces.

## 5. Banks + the flywheel

**Banks** are the brand's copy libraries (hooks, body, headlines, …) that primers and workflows fold in. A fresh brand starts with six, all empty.

```bash
npx @aicopycoders/exodus bank list                 # the brand's banks + entry counts
npx @aicopycoders/exodus bank show hooks           # entries, newest-first, with source + win metrics
npx @aicopycoders/exodus bank promote hooks "Stop scrolling — your knees will thank you"
```

`bank promote` lands a winning line **and fires the Winner Flywheel** — it emits the `winner-promoted` event with **exact web parity and no opt-out**. Any workflow with an enabled matching trigger then starts a background run. Promote reads text from an argument, `--file <path>`, or stdin (one of the three), and takes optional flags for awareness tagging (`--awareness`, body bank), win metrics (`--spend`, `--roas`, `--ctr`, `--note`), and provenance (`--run`, `--node`) — see `bank promote --help`.

**Two honest things to tell the user after a promote.**

**First: a promote often fires nothing, and that is the default.** The event goes out every time, but it only starts a run if some workflow on this brand has a `winner-promoted` trigger that is **switched on**. The shipped **Winner Flywheel** starter arrives with its trigger **disabled** on purpose — so on a brand that imported it and never enabled it, a promote lands the line and stops there. Check before you promise a run: `workflow triggers "Winner Flywheel"` shows the switch, and `workflow triggers "Winner Flywheel" enable 1` flips it on.

**Second: check the run list, not the inbox.** `inbox` holds runs that are waiting on a person. The Winner Flywheel is three steps — brief → splitter → output — with **no Checkpoint box anywhere**, so its run has nothing to ask you and never lands in the inbox; it just runs and finishes. Looking for it there and finding nothing tells you nothing. Look here instead:

```bash
npx @aicopycoders/exodus workflow triggers "Winner Flywheel"   # is the switch even on?
npx @aicopycoders/exodus bank promote hooks "…"                # land the winner
npx @aicopycoders/exodus workflow status                       # did a run start? (25 newest runs + ids)
npx @aicopycoders/exodus workflow status --id <runId>          # what it produced
```

Run it **right after** the promote: that list holds only the 25 newest runs, with no clock time on the rows, so the fresh run is only easy to spot while it's still near the top.

## 6. Versions

Every import saves a **version**. You can list a workflow's history and export any past version:

```bash
npx @aicopycoders/exodus workflow versions "Launch Flow"         # saved history, newest-first
npx @aicopycoders/exodus workflow export "Launch Flow" --version 3 --out v3.yaml
```

Version numbers are real **1-based ids** from `versions` (not offsets). Two patterns:

```bash
# Diff two saved versions
npx @aicopycoders/exodus workflow export X --version 3 --out v3.yaml
npx @aicopycoders/exodus workflow export X --version 5 --out v5.yaml
diff v3.yaml v5.yaml

# Roll back to an earlier version
npx @aicopycoders/exodus workflow export X --version 3 --out v3.yaml
npx @aicopycoders/exodus workflow import v3.yaml --update <id>
```

A version export **intentionally carries no triggers or description** — those aren't versioned, so a rollback leaves them unchanged; the head export (`export` with no `--version`) is the only place triggers appear. Exporting a backup before a destructive `--update` is still good habit, but rollback is a real, supported move now.

## 7. Build & edit — author a workflow contract

Cold-start is a **template, not a blank file** — there is no `workflow new`. Learn the vocabulary live (`workflow schema` replaces any notion of a static schema doc), start from a template, and treat `validate` as your compiler loop. The loop: pick a starter → export it → edit → check the schema for vocabulary → `validate` until clean → `import` → review on the canvas.

### Step 1 — Learn the bot catalog and the graph vocabulary

```bash
npx @aicopycoders/exodus workflow bots                     # full catalog, grouped by category
npx @aicopycoders/exodus workflow bots --slug new-hook-bot # one bot's full port + param spec
npx @aicopycoders/exodus workflow schema                   # LIVE node kinds, ports, config rules, faces, wiring rules
npx @aicopycoders/exodus workflow schema --kind transform  # one node kind
npx @aicopycoders/exodus workflow schema --kind formatter  # the Formatter's two modes, bounds, and notes
npx @aicopycoders/exodus workflow schema --kind splitter   # the Splitter's three modes, the item cap, and the lane rules
npx @aicopycoders/exodus workflow schema --kind checkpoint # the Checkpoint box: its two ports and config.passType
npx @aicopycoders/exodus workflow schema --face splitter   # one transform face's ports + spec
```

Per bot you get its **input ports** (id, what it `accepts` — `text` / `primer` / `image`, whether it's required, and for primer ports which `primerKinds` gate it), its **params**, and its output type. `workflow schema` prints the **live** graph grammar from the backend you're deployed against — node kinds, port ids, config rules, transform faces, collector policy, wiring rules — so what you author matches what will validate. This is always current; pull it fresh rather than trusting memory.

**Faces now carry a `retired` flag.** `schema` (and `schema --face <face>`) reports it per face. Five faces are retired — `parser` (Parser/Extractor), `edit-shorten` (Shorten), the old `formatter` reshaper, and (newest) `splitter` (Splitter (Text)) and `decomposer`. **Retired means "no new ones," not "broken":** they still validate, still run, and every existing graph that names one keeps working unchanged, so never rewrite a member's graph to get rid of one. Just don't author a fresh one — use the `formatter` node kind instead of `parser`/`formatter`, and the `splitter` **node kind** instead of the `splitter`/`decomposer` faces (both below). The ad-hoc edit-pass buttons on finished run results, Shorten included, are a different surface and are unaffected.

### Step 2 — Start from a template

```bash
npx @aicopycoders/exodus workflow templates                          # list the starters (incl. Winner Flywheel)
npx @aicopycoders/exodus workflow templates export complete-ad-set --out my.yaml
```

`templates export` writes the server-rendered YAML verbatim — a real, valid graph to edit down, not a stub. You can also learn the format by exporting an existing workflow (`workflow export "Launch Flow" --out launch.yaml`); export writes **canonical YAML** by default (fixed key order, so equal workflows dump byte-identically and diffs stay clean). Pass `--json` on export for the legacy JSON contract; import reads either.

The contract is `nodes` (each with `id`, `kind`, a `config`, and optional `position`) and `edges` (`source`/`sourceHandle` → `target`/`targetHandle`, the handles being **port ids**). **Node positions are optional** — omit them and the server auto-layouts on import. An export also carries `workflowId` + `updatedAt` at the top — those are update anchors, not part of the graph.

### Step 3 — Validate like a compiler loop

```bash
npx @aicopycoders/exodus workflow validate my.yaml
```

`validate` is the front door; `import --dry-run` is the same check under a different door. It **needs network + login** — there is no offline validation, ever. It returns compiler-style issues, each naming the **node id**, the **port id** where relevant, and a concrete **remedy**. Codes include `dangling-edge`, `unknown-port`, `type-mismatch`, `missing-required-input`, `duplicate-input`, `cycle`, `unknown-kind`, `bad-config`, and the three Splitter lane rules `nested-split`, `lane-ineligible`, and `fan-overlap`. Fix, re-run `validate`, repeat until clean.

### Step 4 — Import (create or update)

```bash
npx @aicopycoders/exodus workflow import my.yaml                 # create a new workflow
npx @aicopycoders/exodus workflow import my.yaml --update wf_123 # update in place
```

Then **tell the user to review it on the canvas at `/workflows`** — the CLI writes the graph; the human eye confirms it reads right.

**The 409 rule.** `--update` sends the export's `updatedAt` as an optimistic-concurrency guard. If the workflow moved on the dashboard since your export, the import 409s. Re-export the current workflow, reapply your edits onto the fresh contract, and import again — never force past a 409, or you'll clobber their change.

### The `formatter` node — guarantee the shape of what comes out

Reach for a `formatter` node whenever the next step needs a **known shape**: a rendered layout, or named fields split onto their own wires. Two modes on one kind, chosen by `config.mode`. Its ports are **derived from its config** in both modes, so edit the config and the handles change — re-check your edges after any edit.

**`mode: template`** — deterministic, no model call. Write a layout with `{{variable}}` slots; **each distinct slot becomes a required `text` input port named for the variable**, and the single output port is `formatted`. Same inputs → identical output, every time. A slot that gets nothing renders empty and warns; it never fails the run.

```yaml
- id: assemble
  kind: formatter
  config:
    mode: template
    template: |
      HOOK: {{hook}}

      {{body}}

      CTA: {{cta}}
```

Ports: inputs `hook`, `body`, `cta` (all required, one wire each); output `formatted`.

**`mode: extract`** — the AI reads loose text, the node **validates the answer against your declaration**. Declare 1–12 fields; **each field key becomes its own output port**, and the one input port is `source` (required, accepts many wires — their texts are joined). A `list` field emits **one artifact per element** on its port, so downstream nodes get hooks one at a time, not one blob.

```yaml
# Winner ad text in → hooks, offer, and a mechanism line out, each on its own wire.
- id: mine-winner
  kind: formatter
  config:
    mode: extract
    temperature: 0.2      # 0..1, default 0.2
    maxRetries: 2         # 0..3, default 2 → up to 3 model attempts
    fields:
      - { key: hooks, label: Hooks, type: list, required: true }
      - { key: offer, label: Offer, type: text, required: true }
      - { key: mechanism, label: Mechanism, type: text, required: false }
```

Ports: input `source`; outputs `hooks`, `offer`, `mechanism`. Wire `sourceHandle: hooks` into a hook-consuming bot.

**The contract that makes it worth using: extract mode never emits a wrong shape.** If the reply isn't a JSON object with exactly the declared keys, correctly typed, and non-empty where you marked `required`, the node re-asks the model with the exact violations attached. `maxRetries` counts those re-asks *after* the first attempt (default `2` = up to 3 attempts). When the budget is spent the node **fails the run** with the last answer and its errors on the failure note — it never passes nonconforming output downstream. Tell the user that plainly when an extract node fails: the model couldn't produce the declared shape, so the node refused to guess.

**Field rules** (each row needs all three of `key`/`type`/`required`): `key` is letters, digits, spaces, underscores, hyphens, ≤40 chars, unique in the list; `type` is `text`, `number`, or `list`; `required` must be an explicit `true`/`false`. `label` is optional and defaults to the key.

### The `splitter` node — one thing in, N parallel lanes out

A **Splitter** turns one thing into many. Feed it a list (or text a model can cut into pieces) and it emits N **items** — and here is the part that matters: **every box after it runs once per item.** Five items means five copies of the same downstream chain running side by side, like five assembly lines. Each piece of work knows its own number, so the run view and the CLI can say "Item 3 of 7".

It has the same ports in every mode: one required input `source` (it accepts several wires), one output `items`. Three modes, picked by `config.mode`:

- **`structural`** — no model call. Whatever artifacts arrive on `source` **are** the items. This is the natural partner of a Formatter `list` field, which already emits one artifact per element. (A single artifact whose text is a JSON list of strings gets exploded too.)
- **`rule`** — no model call. Joins the incoming text and cuts it on a `delimiter`: `newline`, `blank-line`, `numbered` (1. 2. 3. list markers), or `custom` plus a `customPattern` (a **literal** separator, not a regular expression).
- **`semantic`** — the only mode that calls a model. Your `instruction` says what counts as one item ("separate this into ad concepts"); the reply must be a clean list, and a bad one is re-asked before the node gives up. Set `model` to pick which writing model does the cutting; leave it out for the default one.

```yaml
- id: split-modules
  kind: splitter
  config:
    mode: semantic
    instruction: "Break this winning ad into its reusable modules — hook, mechanism, proof, offer, CTA. One module per item."
    maxItems: 25
```

**Aiming a `structural` Splitter at one field.** A bot that answers in JSON usually hands you a whole payload — `{"hooks": ["…", "…"], "notes": "…"}` — and splitting *that* gives you one item: the blob. Set `sourceField: hooks` and the Splitter reaches inside and splits **just that list** instead, ignoring everything else. If several payloads arrive on the wire, their lists are pooled in the order they landed.

```yaml
- id: split-hooks
  kind: splitter
  config:
    mode: structural
    sourceField: hooks
    maxItems: 25
```

Two things to know. First, an aimed Splitter is **strict**: every payload arriving has to be a JSON object that actually has that field, and the field has to hold a list of text. Anything else stops the step with a plain sentence naming the field — it never quietly falls back to splitting the raw payload, because a one-item fan that "worked" is the worst possible answer. Second, don't aim a Splitter that's fed **from a Formatter field**: that wire already carries the values one by one, so there's nothing left to reach inside, and the run is blocked (`splitter-field-conflict`) with a note telling you to clear the field name. Leave `sourceField` out entirely for the original behaviour — whatever arrives *is* the list. The field name is one word, up to 60 characters, not a path.

**`maxItems` is a hard cap and it is required in every mode** (default 25, raise it to at most 100 deliberately — you cannot remove it). Going over the cap **fails the node loudly** with the real count ("Splitter produced 61 items; cap is 25"). It never quietly trims the list: silent data loss is worse than a visible failure. Producing **zero** items fails too, for the same reason.

**Reviewing a fan item by item.** Put a **Checkpoint node inside the fan** and the run parks once, after all the lanes finish, and you approve or reject **each item**. Rejecting is filtering, not failing — the lanes below a rejected item simply never run. See "When the work arrived once per item" above.

**Three rules the validator enforces — all three scoped to a Splitter's OPEN fan** (the chain running once per item, which ends at the Collector that closes it):

- **No split inside an open fan** (`nested-split`) — a Splitter can't sit inside another Splitter's open fan. An artifact carries exactly one item number, so items-of-items has nowhere to live. The way through is **sequential**: close the first fan with a Collector, then split the combined result again. That is fully legal.
- **One open fan per node** (`fan-overlap`) — no node may sit inside two different Splitters' open fans at once. Their item numbering is unrelated, so the lanes can't merge mid-fan. Two fans that have **each closed through their own Collector** may merge downstream freely.
- **Lane eligibility** (`lane-ineligible`) — every node inside the open fan must be a `bot`, `formatter`, `transform`, `checkpoint`, or `output` node. Video nodes, Call nodes, and the video member-gate kinds are blocked, because running them once per item would corrupt state they keep per node. The `collector` kind is **exempt** (it ends the lane rather than running in it), and **after** a Collector any kind at all is allowed again — video, Call, all of it.

**One lane failing doesn't sink the batch.** If a lane exhausts its retries, that item drops out and the others carry on; the step ends `done` with a warning naming the casualties. Only *every* item failing fails the step. (A Collector downstream can be told to be stricter than that — see the next section.)

**The old cards are gone, the old graphs are fine.** The `splitter` (Splitter (Text)) and `decomposer` **transform faces** are retired — they put N snippets on one wire and ran downstream **once**, which is a different thing entirely. Existing workflows that use them keep running exactly as before, and there is no migration; just don't author new ones. The Winner Flywheel starter has been rebuilt on the Splitter node, so its Output step now files each module separately.

**Blocks Run** (`bad-config`, so `validate` catches it): no/unknown `mode`; template mode with an empty template, over 20000 characters, or more than 12 distinct slots; extract mode with fewer than 1 or more than 12 fields, a bad/duplicate key, a bad type, a non-boolean `required`, a `temperature` outside 0..1, or a `maxRetries` outside 0..3. A template slot with no wire into it is `missing-required-input` — same block, different code.

### The `collector` node — close the lanes

A **Collector** is the Splitter's other half. Where a Splitter opens N lanes, a Collector waits for all of them and folds them back into **one** result. That result carries no item number, which is the whole point: **after a Collector the run is ordinary again.** Anything may follow it, you may split again, and two fans that each closed through their own Collector may merge.

Its ports are fixed in every mode: one required input `items` (a whole fan lands on that single port), one output `combined`. Three modes, picked by `config.mode`:

- **`assemble`** — no model call. Stitches the surviving items into one block, in order, joined by `separator` (`newline`, `blank-line`, or `custom` plus a literal `customSeparator`; newline if you say nothing). An optional `itemTemplate` wraps each item, with the slots `{{item.value}}`, `{{item.index}}` (1-based), and `{{item.total}}`.
- **`list`** — no model call. Emits one artifact whose text is JSON: the items with their numbers, a count, and what dropped out. Use it when the next step wants structure, not prose. It is the only mode that puts the dropped detail *in* the artifact.
- **`synthesize`** — the only mode that calls a model. Your `instruction` says what the merge should produce; the model writes one new piece out of every item. Set `model` to pick which writing model does the merging, or leave it out for the default one; `temperature` and `maxRetries` work here too.

```yaml
- id: fold-modules
  kind: collector
  config:
    mode: assemble
    separator: blank-line
    itemTemplate: |
      ### Module {{item.index}} of {{item.total}}
      {{item.value}}
    onBranchFailure: survivors
    minItems: 2
```

**The lane policies ride every mode.** `onBranchFailure: survivors` (the default) carries on with whatever made it through and warns you who didn't; `strict` stops the run right there if any lane broke. `minItems` (default 1, up to 100) is a floor that applies under **both** policies — fewer survivors than that and the node fails, so a fan where everything died can never quietly hand you an empty result. `ordering` is `index` (the Splitter's original order, the default) or `arrival` (whichever lane finished first).

**A rejection is never a failure.** An item the user rejected at a checkpoint was filtered on purpose, so it never trips `strict` — it only counts against `minItems` by not being there. The node's warning spells the difference out, and it's the sentence to quote back to a user asking why the run kept going: *"Collected 7 of 10 items — items 2 and 5 rejected at your checkpoint; item 8 failed."*

**Every wire into a Collector must come from inside ONE Splitter's open fan** (`collector-unpaired`, blocks Run) — the Splitter itself or a node running in its lanes. A Collector with nothing split upstream has no fan to close, and a Brief wired straight into one is merging unrelated branches, which is a Formatter's job in template mode, not a Collector's.

**The old card is gone, the old graphs are fine.** The `collector` **transform face** is retired — it compiled whatever text arrived on merged wires and ran once, which is a different job from closing a lane fan. Existing workflows using the face keep running unchanged and there is no migration; author the `collector` **node** instead. Note the vocabulary split while you're at it: the node reads `onBranchFailure`, and the legacy `onFailedInput` key is rejected on it outright.

**Blocks Run** (`bad-config`): no/unknown `mode`; assemble mode with an illegal `separator`, an empty or over-200-character `customSeparator` on `custom`, or an `itemTemplate` over 4000 characters; synthesize mode with an empty or over-2000-character `instruction`, a `temperature` outside 0..1, or a `maxRetries` outside 0..3; any mode with an illegal `onBranchFailure`/`ordering`, a `minItems` outside 1..100, or a stray `onFailedInput`.

### Authoring gotchas

A hand-picked list of the traps that bite first. `workflow schema` is authoritative on any conflict with what's written here:

- **Edge handles are port ids** — `sourceHandle`/`targetHandle` name a **port**, not a node id or a label. An edge only connects if the target port `accepts` the source port's type.
- **Required inputs hard-block** — a run refuses to start until every required input is supplied; there's no "run anyway".
- **Transform faces are sealed** — each face has fixed, per-face **output port ids** you must wire from by name; `workflow schema --face <face>` prints them, along with whether the face is `retired`.
- **Don't author a retired face** — `parser`, `edit-shorten`, the old `formatter` face, `splitter` / `decomposer`, and now `collector` are no longer offered; author a `formatter` node (parser/formatter), a `splitter` node (splitter/decomposer), or a `collector` node instead. Existing graphs that use them keep running, so leave those alone.
- **The fan rules are scoped to the OPEN fan** — inside a Splitter's open fan (the chain up to the Collector that closes it) you may not place another Splitter (`nested-split`), every node must be a `bot`, `formatter`, `transform`, `checkpoint`, or `output` (`lane-ineligible`), and no node may sit in two Splitters' open fans at once (`fan-overlap`). Close the fan with a Collector and all three restrictions lift: split again, run any kind, merge two collected fans.
- **A Collector must be paired** — every wire into a `collector` node has to come from inside one Splitter's open fan, or it's `collector-unpaired` and the run is blocked. To merge branches that were never split, use a Formatter in template mode.
- **Don't aim a Splitter at a Formatter field** — a `structural` Splitter with `sourceField` set, fed from a Formatter field, is `splitter-field-conflict` and the run is blocked. That wire already hands over the values one at a time, so there's no payload left to reach into. Clear the field name, or feed the Splitter one whole JSON payload instead.
- **A Checkpoint's declared type must match the wire feeding it** — a `checkpoint` node's `config.passType` (default `text`) has to be the type arriving on `in`, or it's `bad-config` and the run is blocked. And never author the old per-node `checkpoint` switch key: it's retired, and any graph still carrying it is auto-converted into Checkpoint nodes on the way in.
- **A Formatter's handles come from its own config** — template slots name its inputs, field keys name its outputs. Change the config and old edges go `unknown-port`.
- **`session` outputs have nowhere to wire** — a session-typed output exists so you can re-open the chat from the run page; no node kind accepts a session wire.
- **Deposit shapes are strict** — a deposit's config must match the target bank's expected shape exactly, or import rejects it.
- **Empty defaults are deliberately invalid** — `rig`, `call`, `transform`, `bot`, and `formatter` nodes ship with empty config placeholders that fail validation on purpose; you MUST fill them, not leave them.
- **Quote YAML that looks numeric or boolean** — `"true"`, `"3.0"`, `"01"` need quotes or the parser coerces them to the wrong type.
- **A 409 on `--update` means re-export first** — reapply your edits onto the fresh contract; don't force.

## 8. Chain — feed one workflow's output into the next

The chaining surface is the run's flattened outputs. After a `--wait` run (or once `status` shows terminal), pull the machine-readable outputs:

```bash
npx @aicopycoders/exodus workflow status --id <runId> --json
```

The response carries a top-level `outputs` array — each entry is `{ nodeId, botSlug?, type, label, text?, imageUrl?, imageId? }`. Extract the text you want (e.g. `.outputs[].text`) and pass it into the next workflow's input:

```bash
# Inline, for short outputs
npx @aicopycoders/exodus workflow run "Ad Writer" --input hooks="<text from run A>" --wait
```

**The file-as-persistence convention.** For anything reusable or long — a brief, a sales letter, a hook pool — write the text to a **markdown file in the project** and pass it with `@file`. This is the deliberate v1 alternative to a server-side store: the file *is* the persistence layer, versioned in the project alongside the brand's other artifacts.

```bash
# Save run A's text output to a project file, then feed it to workflow B
npx @aicopycoders/exodus workflow status --id <runId> --json   # copy .outputs[].text into state/hooks.md
npx @aicopycoders/exodus workflow run "Ad Writer" --input hooks=@state/hooks.md --wait
```

`@path` is resolved from the current directory. If the literal value you need actually starts with `@`, escape it as `@@` (e.g. `--input handle=@@brand` passes the string `@brand`).

For persistence that lives *inside* Exodus rather than in a file, remember **banks**: a run can deposit copy into a bank, and you read it back with `bank show <key>` — that's the server-side equivalent of the file convention.

## Direct HTTP (if you're scripting past the CLI)

The same contract is on the v2 API, so a script can skip the CLI:

- **Export:** `GET /api/v2/workflows/export?id=<workflowId>&format=yaml` returns the canonical YAML (`text/yaml`); drop `format` (or `format=json`) for the legacy JSON body.
- **Import:** `POST /api/v2/workflows/import`. A JSON object body carries the contract *plus* the control fields inline (`dryRun`, `targetWorkflowId`, `expectedUpdatedAt`). A raw **YAML** body is the contract text alone — pass the control fields as **query params** instead (`?dryRun=true&targetWorkflowId=<id>&expectedUpdatedAt=<ts>`).

The inbox/checkpoint/session/bank verbs have v2 routes too, but the CLI is the maintained path — reach for HTTP only when you're already scripting, and prefer the CLI's `--json` output over hand-rolling routes. Both are Bearer-auth'd (`EXODUS_API_KEY`) like every v2 route.

## Failure handling

- **`describe` shows a ✗ prerequisite** — don't run yet. Fill the primer via `exodus-primer` / `exodus-foundation`, then re-check `describe`.
- **Run comes back `Succeeded with warnings` or `Failed`** — read `status --id <runId>` (drop `--json` for a readable view) to see which node failed and why **before re-running**. "Succeeded with warnings" still has usable outputs; harvest them first. `Failed — nothing delivered` means the run produced none of what it promised.
- **A verb refuses because the run isn't in that state** — the checkpoint/repair/answer verbs check the run first and name its **actual** state (e.g. "parked for repair" when you tried a checkpoint verb). Read the state it reports and switch to the matching verb, or check `inbox` for what's actually pending. **`cancel` is the exception on purpose**: it doesn't care what state the run is in, only that it hasn't finished.
- **Trigger fingerprint mismatch** — the workflow changed since you listed its triggers. Re-list (`workflow triggers <wf>`) and retry the enable/disable/fire against the fresh numbering.
- **`validate` / `import` errors** — fix the exact node/port each issue names using its remedy; don't guess. `validate` needs network + login — there is no offline check.
- **`import --update` 409** — re-export, reapply, re-import. This is a conflict, not a bug.
- **After a promote, and no run appeared** — first check the trigger is actually enabled (`workflow triggers "<workflow>"`); the Winner Flywheel starter ships **disabled**. If it is on, look in the **recent-run list** (`workflow status`, no `--id`), not in `inbox` — a flywheel run has no approval step, so it finishes without ever appearing in the inbox.
- **Auth / whoami failure** — run `npx @aicopycoders/exodus doctor` and confirm `EXODUS_API_KEY`.
- **Wrong brand** — workflows, sessions, and banks are per-brand. `npx @aicopycoders/exodus brand current` to confirm you're on the brand you think you are; switch with the `exodus-brand` skill.

## Not the right skill for

- **Running a single Genesis writing pass** (brief → copy in two voices) — that's `exodus-genesis`. Reach here when the member has a *saved multi-node workflow* to run or build.
- **One-off image renders** — `exodus-image` / `exodus-creative` / `exodus-template`.
- **Building the primer a workflow depends on** — `exodus-primer` (winning ads) or `exodus-foundation` (no ads).
- **Finding a past run's output doc** — `exodus-browse`.
