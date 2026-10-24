---
name: exodus-video
description: Make a video ad with Exodus from the terminal. The main path is script-first: run a saved video workflow with `npx @aicopycoders/exodus workflow run`. You read and approve the storyboard, pull every finished piece (per-scene clips, the narration track and per-scene voice, keyframes, cast identity stills, word timings, the music bed) into a folder with `exodus video pull`, and upload a finished cut for approval. Exodus makes the pieces; the cut is made outside it, in whatever editor the user wants — this skill hands over the pieces and the facts about them, it does not prescribe an editor. Use it whenever the user has invoked Exodus and wants anything to do with a video ad, an ad run's clips or storyboard, "pull the pieces", "stitch it together", "make the cut", "upload my cut", or checking on a video run ("exodus, make a video ad from this script", "exodus, is my video run done", "exodus, pull the clips for run X and cut them", "exodus, what's wrong with scene 3", "exodus video status"). Also use it when the user ran an `npx @aicopycoders/exodus video` command or the `exodus` hub skill routed here. Admins get every video command; beta testers with video switched on get start, status, storyboard, approve, voices, retry-frame, pull and upload on their own brands (see "Beta testers"). "video isn't enabled for this key" means the run id is wrong, the command is admin-only, or video isn't switched on for that dashboard user, so check the id and then say so; do not retry. Never claim generic video-editing asks ("edit this mp4", "add captions to my reel") without Exodus context; in shared folders those belong to the user's other tools. Running or authoring workflows generally is `exodus-workflow`; static image ads are `exodus-image`; copy is `exodus-write`.
---

# Video: make the pieces, cut the ad, hand it back

Exodus makes the PIECES of a video ad, not the finished ad. From a script, a run
writes a storyboard, draws one picture per scene, records the voice, renders one
video clip per scene, and generates a music bed. Then it parks and waits for a
cut.

There is no server-side stitch and no server-side mix. Nothing joins the clips,
nothing sets levels, nothing burns in captions
(`scout/src/workflow/video/music-bed.ts` states the ruling: "the cut, and the
mix, happen outside from the pieces the CLI pulls"). You pull the pieces, cut
them wherever you like, and upload the result. Approving the upload is what
makes it the ad.

Your job in this skill is to drive that loop, hand over the pieces with the
facts about them, and make whatever cut the user asked for. **How to edit is the
user's call, not this skill's** — see "Cutting the ad".

This file ships on the member's machine. It holds commands, the manifest's
shape, and recipes for the cut. It does not hold prompt text, house primers,
judge wording, or model instructions.

## How a run starts

The ad is a saved workflow in the brand, started script-first with `exodus
workflow run`. From there the same nodes render, `video status` reads the run,
`video pull` writes the folder, and `video upload` and `approve` finish it.

A Show is no longer required. `exodus video start` starts from a script, a
conceit, and a style. The same parks follow: it stops at the storyboard for the
user's yes, unless it was started with `--one-shot` (see "What costs money"). The full line is under
"Starting a run". An optional `--direction` note is whole-ad rules, and that
note cannot contain a colon. "The script file" shows the right form and the
wrong one.

**The kinds of ad.** `--conceit` takes one of the kinds the server offers. The
server's list is the truth, and nothing prints it on request. Pass a key it
doesn't offer and the refusal names every key it does: `video start --conceit
must be one of …`. Nothing is spent on a refused start. Today the server offers
15 formats and then Custom:

| Key | Kind |
|---|---|
| `podcast` | Podcast |
| `ugc` | UGC talking head |
| `stage` | Speaking on stage |
| `street` | Street interview |
| `personification` | Personification |
| `news-broadcast` | News Broadcast |
| `court-tv` | Court TV |
| `soap-opera` | Soap Opera |
| `storytime` | Storytime While Doing a Task |
| `customer-service-call` | Customer Service Call |
| `debate-circle` | Debate Circle |
| `talk-show-panel` | Talk Show Panel |
| `infomercial` | Infomercial |
| `dating-show` | Dating Show |
| `game-show` | Game Show |
| `custom` | Custom |

Custom builds the ad from the script itself. A script with no `CAST:` runs as a
voice-over, and a script with people runs as a scene. Voice-over and Scene are
not on the menu by name; Custom is the way to them. A narrator-only script fits
Custom alone. If the refusal lists different keys from this table, the server
is right and this table is stale.

The Rig box on that workflow is where the run's Conceit and Style come from.
Conceit is the family plus Wrapper, Narrator Person, and Delivery. Style is the
look. Narrated Story is the voice-over family and Acted Story is the dialogue
family (`familyTree.ts`). Those family names stay the code's names.

## Before anything

- `npx @aicopycoders/exodus video --help` and `workflow --help` are the
  authoritative flag lists. The `video` verb is hidden from the top-level
  `--help` because most members can't use it; that is expected, not a broken
  install.
- **Who can use video.** Admins get everything in this file. A beta tester
  (video switched on for their dashboard user) gets a smaller set on their own
  brands, listed under "Beta testers" below. Two refusals:
  - "video isn't enabled for this key", from a `video` verb, has three causes
    the CLI cannot tell apart: the run id does not exist on this brand, the
    command is admin-only, or video isn't switched on for this user. Check the
    id first, then check the command against "Beta testers".
  - "Video workflows aren't available on your account. Ask an admin if you need
    video.", from `workflow run`, is unambiguous. `startRun` refuses any graph
    containing a video node for a non-admin, beta testers included. A beta
    tester starts with `exodus video start` instead.

  No flag or retry fixes either one.

## Beta testers

A beta tester's key gets the same video the dashboard's Video page makes, and
never how it is made. Every answer to them says `"view": "customer"`, and the
CLI words it the way the run page does. On their own brands they can:

- `video start --script <file> --conceit <key> --style <slug>` with
  `--direction`, `--frame`, `--pacing`, `--music`, `--one-shot`, `--review-storyboard`, `--stop-at-script`, `--rewrite-to-fit` and `--wait`. Any other start
  flag is refused with one sentence naming it. The answer is the run id and the
  link to the video's page, plus what the server did to the script: laid a
  plain transcript out, or wrote a script from a description (see "The script
  file"). `--stop-at-script` prints that script and starts nothing.
- `video status <runId>`: where the video is, in plain words (waiting in line,
  planning, drawing, storyboard ready for review, filming, ready with its link,
  or stopped and why). `--json` prints the server's answer as it came.
- `video storyboard <runId>`: each scene's line and picture, while the
  storyboard waits for review.
- `video approve <runId>`: approves the storyboard. Nothing else.
- `video voices <runId>`: who speaks, their current voice, and the voices on
  the tester's own ElevenLabs account. `--set <character>=<voiceId>` picks one,
  until the storyboard is approved.
- `video retry-frame <runId> --scene <n>`: redraws one scene's picture while
  the storyboard waits. No `--node`; the server finds the step.
- `video pull <runId> --out <dir>`: the finished video (`video.<ext>`), each
  scene's clip (`scene-NN.<ext>`) and voice (`scene-NN.voice.<ext>`), and the
  music (`music.<ext>`), with a `manifest.json` holding only `runId`,
  `pulledAt`, `dashboardUrl`, `scenes` (`index`, `clip`, `voice`), `music` and
  `video`. A file that did not download is `null` there. Nothing else in "The
  handover" below applies to them.
- `video upload <runId> --file <cut>`: attaches their cut and prints the page
  to watch it on.

Admin-only, answered "video isn't enabled for this key" (or, for retry-clip and
revoice, a sentence saying they are for admins): `director`,
`status --rejected-draft`, `retry-clip`, `revoice`, `broll`, and the start flags
`--video-model`, `--voice`, `--voice-path` and `--director`.
`--broll` works for whoever B-roll is switched on for, beta testers included,
but nothing open to them changes the shots the app plans (see "B-roll").
- Other failures: `npx @aicopycoders/exodus doctor` first, then follow what it prints.
- `ffprobe` on the PATH lets `upload` read the cut's length by itself. Without
  it, `upload` falls back to parsing an MP4's own header, and for anything else
  you must pass `--duration <sec>`. Editing tools have their own requirements on
  top of that — the bundled script needs a full `ffmpeg` with `libx264` and
  exits 2 if it is missing.
- The brand matters. A workflow belongs to one brand, so `exodus workflow list`
  shows the active brand's only. Wrong list means wrong brand; `exodus brand use
  <slug>`.

## The loop

Run each line as `npx @aicopycoders/exodus …`; `exodus` below is shorthand.

**Starting a run.** The workflow is already saved in the brand — find it and
read what it wants before you run it, because the script's input field is named
by the workflow, not by this skill.

```operator-guide
exodus workflow list                                      the brand's workflows
exodus workflow describe <workflowId|name>                what inputs it needs
exodus workflow run <workflowId|name> --input <field>=@script.txt --wait
                                                          start, stop at the storyboard gate
exodus workflow run <workflowId|name> --input <field>=@script.txt --voices @voices.json --wait
                                                          same, with the brand's voices already chosen
exodus workflow run <workflowId|name> --input <field>=@script.txt --voice-treatment @voice-treatment.json --wait
                                                          same, with the video model speaking voices you WROTE
exodus video status <runId>                               where it is, per scene
exodus video start --script <file> --conceit <kind> --style <look> [--direction "…"] [--frame pov] [--pacing <jump-cuts|long-take|montage>] [--voice-path <path>] [--video-model <id>] [--voice native] [--music] [--broll] [--one-shot] [--director] [--stop-at-script] [--rewrite-to-fit] [--wait]
                                                          start from a script and the kinds the server offers.
                                                          The file can be a plain transcript, a draft or a
                                                          description: the server tidies it (see "The script
                                                          file"). --stop-at-script prints the tidied or
                                                          written script and starts nothing.
                                                          No music bed unless you pass --music.
                                                          --broll cuts away to B-roll shots, for
                                                          accounts with B-roll switched on. At the
                                                          storyboard, `video broll` adds, moves or
                                                          removes a shot (see "Reading the storyboard
                                                          gate").
                                                          --frame pov (conversation conceits) and --pacing
                                                          (presenter conceits) change the shots; a conceit
                                                          that can't follow one refuses it.
                                                          It stops at the storyboard for the user's yes
                                                          (Guided, the default). --one-shot makes the
                                                          whole video: the app approves its own storyboard
                                                          when its checks pass and goes straight on to the
                                                          clips, which is the part that costs. It stops
                                                          then only when a check finds a problem, and says
                                                          why. --review-storyboard is the default and
                                                          changes nothing.
                                                          Each conceit has its own video model and voice;
                                                          --video-model / --voice override them for one run.
                                                          --director turns the trial director on (admins only)
exodus video director <runId> on|off|follow               the trial director for one run (admins only);
                                                          follow = the brand's own setting. status shows
                                                          what it is doing and its last three notes
```

**From the storyboard on.**

```operator-guide
exodus video storyboard <runId>                           read the scene cards
exodus video voices <runId>                               who speaks and with whose voice
exodus video voices <runId> --set <character>=<voiceId>   give a character a voice
exodus video approve <runId>                              keep going
exodus video retry-frame <runId> --node <nodeId> --scene <n>  redo one still at the pixel gate
                                                          (a beta tester leaves --node off)
exodus video broll <runId>                                B-roll run: the shots, and the script lines by id
exodus video broll add <runId> --line <id> [--note "…"]   plan a new B-roll shot on that line
exodus video broll move <runId> --scene <n> --line <id> [--note "…"]
                                                          move B-roll scene n to another line
exodus video broll remove <runId> --scene <n>             take B-roll scene n out
exodus video status <runId>                               where it is, per scene
exodus video pull <runId> --out ./ad-<runId>              every piece + manifest.json
exodus video retry-clip <runId> --scene <n> [--node <nodeId>] [--note "…"] [--voice-first]
                                                          redo one clip at the final watch
exodus video revoice <runId> --all | --scene <n>          redo only the voice; no new video
                                                          … make the cut (your choice of tool)
exodus video upload <runId> --file ./ad-<runId>/cut.mp4   attach it
exodus video approve <runId>                              make it the ad
```

Every command takes `--json`. Read `--json` when you need to decide something
from the output; read the plain form when you are relaying it to the user.

**Read a run's position with `exodus video status`.** It is the richest reader —
every scene's clip, voice and picture, with the findings. A `--wait` that landed
already printed the same stop block, and `workflow inbox` lists a parked video
run, but neither shows the per-scene detail, and the checkpoint verbs cannot
resolve a video park — see "What the CLI can and cannot do".

**Where a run can stop.** The two video parks come in order when the run has
both. The storyboard gate is first. You read the cards there and you set the
voices there. Approving that gate releases the voices and the clips. That is the
expensive part. The final watch is next, after the pieces exist, and only when
the video node sets `finalWatch: true`. That park is for the cut. You pull, you
cut, and you upload. Approving the upload makes it the ad. A node with
`finalWatch` off skips the second park and the run finishes.

Five stops, each with the exact next command printed
under it:

- storyboard gate: needs `approve`. When the stop block prints a `Redo one
  frame:` line with a node id, one still can be redone first with `retry-frame`;
  a gate parked before the stills are drawn has nothing to redraw. When the run
  has B-roll (`storyboard` ends with a `change the B-roll shots:` line), offer
  to add a shot on a line with a note, move one, or remove one with `video
  broll`. Each change redraws only the pictures it changes, so wait for it to
  finish before you approve.
- final watch: every piece is made; needs `pull`, a cut, and `upload`. Once a
  cut is uploaded the stop block leads with `approve` instead, and `status
  --json` says which state it is in (`stop.cutAttached`, plus the same next-step
  lines under `guidance`). It is also
  the one park where a finished clip can be redone, with `retry-clip`. A run
  only reaches this park if its video node sets `finalWatch: true` — otherwise
  it skips straight to finished. If a scene has no clip, the stop block names
  it instead (`stop.missingScenes` in `--json`) and approval is refused until
  it has one. A scene whose picture the video service refused needs
  `retry-frame --note` before `retry-clip`; the clip redo alone resends the
  refused picture.
- paused: a builder checkpoint neither video verb resolves —
  `exodus workflow checkpoint <runId>` is the verb for that one.
- failed: `status` shows how far it got, and a `--wait` that was running exits
  1 with the error. Tell the user; do not start another run on your own.
  When the storyboard is the step that failed, `status` adds a "What happened
  to the storyboard" block: which parts of the plan were accepted, which part
  was turned down, and why (#1902). Relay it as written. On an admin key it may
  also offer `status <runId> --rejected-draft`. That prints the draft the system
  threw away. It is a record only: never build on it, edit it, or re-run it.
- finished: pull what it made.

**`--wait` stops at both video parks** (#1818). `workflow run --wait` ends at
the storyboard gate and again at the final watch, exits 0, and closes with the
same `Parked:` block and next commands that `exodus video status` prints. Under
`--json` the line carries an
additive `stop` field in the same shape `video status --json` uses, so branch on
`stop.at` rather than re-deriving the park. Every other park still prints its
notice once and keeps polling, so a resolve from another shell carries the run
on — a Checkpoint park is `exodus workflow checkpoint <runId>`, not a video verb.

`exodus video status` prints these stop lines any time, so an agent that lost a
`--wait` terminal picks up from `status` alone. `--wait` gives up after 60
minutes with "Still running after 60 minutes" and exit 0; that is not done, so
check `status` before treating it as finished. Do not poll `status` in a tight
loop; a full run is several minutes.

**What costs money.** Every run writes the storyboard first and then draws the
reference, cast and scene pictures. Each picture is a few cents and each scene
draws a few to choose from: about 25 cents on a small test, and it can approach
a dollar on a longer ad. The expensive part comes after the storyboard: the
voices and the clips. What happens at that point depends on how the run
started.

- A paste-a-script run (`exodus video start --conceit …`) stops at the
  storyboard for the user's yes by default (Guided). Started with
  `--one-shot`, it checks its own storyboard once the pictures are drawn. When
  every check passes, the app approves the storyboard itself and goes straight
  on to the voices and the clips, with no stop. It stops for the user only when
  a check finds a problem, and the stop block says why in plain words. Ask the
  user before passing `--one-shot`: it spends the whole video in one go.
  `status` prints "the app checks the storyboard and approves it itself if the
  checks pass" on a run headed that way. `--review-storyboard` is the default
  and changes nothing.
- A Show run (`video start --show`) and a saved workflow run (`workflow run`)
  still pause at the storyboard for approval. Approving is what releases the
  voices and the clips. `status` prints "This run will pause for your approval
  once the frames are ready" on a run headed for that pause.

Either way, a run still drawing pictures is healthy and already spending a
little. Do not cancel it because nothing has happened yet. `workflow list`,
`workflow describe`, `video status`, `storyboard` and `pull` are free reads; run
them as often as you like. Never start a second run to "retry" without the user
asking; tell them what failed instead.

**`--auto-approve` does not cover either video gate.** It releases Checkpoint
boxes only (`convex/workflows.ts:7266` keys on `pauseReason === "checkpoint"`),
and the storyboard gate and the final watch carry no pause reason. An unattended
`workflow run --auto-approve` still stops dead at the storyboard gate — which is the
safe behaviour, since nothing should approve paid rendering or ship an uncut ad
on its own.

## What the CLI can and cannot do

Verified against the CLI and the server, not assumed. Everything here is
about the admin tools; a beta tester has only what "Beta testers" lists. Five
things worth knowing before you promise a user anything:

- **A workflow only stops for your cut if its video node asks to.** `finalWatch`
  defaults to `false` (`convex/lib/workflow/catalog.ts:780`), and the run only
  parks for a final watch when it is `true`. Without it the run renders every
  piece and runs straight to the end, and `video upload` answers "This ad isn't
  waiting for your final cut right now." You can still `pull` the pieces and cut
  them, but there is nothing to attach the cut to. **Check this before you
  promise a user an upload**, with `exodus workflow export <workflowId|name>`:
  the export carries every node's `config` verbatim, so look for the `video`
  node and a `finalWatch: true` under it. The key is optional, so *absent* means
  off just as much as `false` does. `exodus workflow describe` does NOT answer
  this — it returns only name, inputs, prerequisites and outputs, no node
  config. If `finalWatch` is off the workflow needs editing (`exodus-workflow`);
  no flag on `workflow run` turns it on.
- **`exodus video approve` is the verb at a video gate, not the checkpoint
  cluster.** `workflow checkpoint approve|edit|retry` preflight on
  `pauseReason === "checkpoint"` (`exodus/commands/workflow.ts:4487-4519`), and
  both video gates park with no pause reason at all, so those verbs refuse
  client-side with "Run … is not parked for a checkpoint approval — it is parked
  at the cost gate (legacy)." `exodus video approve` posts straight through.
  `exodus workflow cancel` also works at a video gate; it has no preflight.

- **Nothing sends the storyboard back with a note.** There is **no** CLI path
  that returns a run's storyboard for a rewrite, and none that rewrites its
  scenes, script or prompts — the whole-envelope edit mutation is wired only to
  the dashboard's gate screen, not to any API route. The one exception is
  voices: `exodus video voices --set` writes the cast's voice choices in place
  and nothing else (see "Giving the characters voices"). A single still can be
  redrawn with `exodus video retry-frame`. For everything else the storyboard is
  approve-or-cancel from the terminal: `exodus workflow cancel <runId>` and run
  again with a better script, or edit the workflow.
  The stop block a parked run prints may still offer a `Send back:` line. A
  workflow ad refuses it, so never run it and never offer it to the user.
- **`--wait` lands on both video parks, but only those.** Since #1818 every
  `--wait` caller — `workflow run`, `triggers fire`, `checkpoint approve|retry`,
  `repair retry|skip` — ends at a storyboard gate or a final watch, exits 0, and
  prints the same `Parked:` block `video status` does
  (`videoParkStop`, `exodus/commands/workflow.ts`). A Checkpoint, repair or
  slots park is still not a landing: it prints its notice once and the loop
  keeps polling, so a resolve from another shell carries the run on. Do not read
  a park banner mid-poll as the wait having finished.
- **Every link the CLI prints follows the run.** A run opens on
  `/workflows/<workflowId>/runs/<runId>`. Since #1851 the manifest's
  `dashboardUrl`, the link in every park block and the link `upload` prints are
  all minted that way, so they agree. When all the CLI holds is a run id it
  mints `/runs/<runId>`, the canonical forwarder, which lands on the same page.

## The script file

**Pass the user's text as it is.** `exodus video start --script <file> --conceit …`
takes whatever the user gave you: a plain transcript, a rough draft, lines with
no names, voice-over labels, a title line, notes, a colon inside a spoken line,
or just a description of the ad they want. Save it to a file unchanged and start.
Do not add `CAST:`, `CTA:` or `NAME:` labels by hand, and do not rewrite it into
the format below first. The server tidies it the same way the dashboard does
when a person pastes a script, and it never changes a spoken word.

What the CLI prints, and what you tell the user:

- **Already in the format:** it starts as it is. No AI call, nothing printed
  about the script.
- **Laid out:** "We laid your script out in the format the video needs.", any
  speaker label it added (`SPEAKER`, `SPEAKER 1`), a short note on who each
  person is, and any line it left out as not part of the ad (a title, a stage
  note, a timestamp). The run has already started. Tell the user about a
  left-out line in one sentence. `--json` carries the same facts under
  `tidied` (`setAside`, `added.names`, `added.descriptions`).
- **Written from a description:** the file only described the ad, so the
  server wrote a script for it, printed it in full, and started the run on it.
  Show the user that script. `--json` carries it under `written`.
- **A question (`SCRIPT_QUESTION`, exit 1, nothing started):** the server
  can't tell who says a line. The error names the line, and `--json` lists them
  under `lines`. Ask the user who says it, put the name in front of that line
  (`SAM: …`), and run the same command again.
- **Too thin (`SCRIPT_TOO_THIN`, exit 1, nothing started):** the file only
  described the ad, and there wasn't enough in it to write a script from. The
  error says what is missing, in the dashboard's words ("There isn't enough
  here to write a script from. Tell us what the product is."), and `--json`
  lists the gaps under `missing` (`product`, `speaker`, `what-happens`). Ask
  the user for what it names, add it to the file, and run the same command
  again.
- **Today's refusal (exit 1, nothing started):** the user has no working AI
  key for the tidy, the AI call failed, or the server could not write a usable
  script from a description. The answer is the format's own message (for
  example "Line 1 has no speaker"). Ask the user for more detail about the ad,
  or for their AI key in Settings, or lay the file out in the format below
  yourself. A description
  that reports what someone says ("a guy says it stopped his crash") is
  sometimes refused this way (#3747): describe the ad without the reported
  words, or give the lines as a draft, and run it again.
- **The start refused the tidied script** (for example two speakers for a
  one-person kind of ad): the notes come first, then the refusal, and `--json`
  carries the tidied script under `script`. Fix that script and send it. It is
  already in the format, so it is not tidied or paid for again.
- **The script doesn't fit the kind of ad** (too many speakers, or a rule the
  kind of ad has): the refusal says `--rewrite-to-fit` can fix it, and
  `--json` carries `rewriteOffered: true`. Ask the user before you add the
  flag: the server then writes a new script for that kind of ad from theirs
  (the dashboard's "Rewrite to fit"), which can change every line and the
  names, starts the run on it, and prints it (`rewritten` in `--json`). Show
  the user that script. To let them read it first, add `--stop-at-script` too.
  If the rewrite can't be made, nothing starts and the error says why
  (`SCRIPT_NOT_REWRITTEN`). The other way out is a kind of ad made for the
  script's cast.

**`--stop-at-script`** prints the script the run would start on and starts
nothing (exit 0). A question or a description too thin to write from answers
as above instead (exit 1). Use it when the user wants to read a written or
laid-out script before anything is spent. To go ahead, save the printed script to a file
and run the same command with `--script <that file>` and without the flag.
`--json` answers `{ stoppedAtScript: true, script, tidied?, written? }`.

The tidy spends the user's own AI key, one short call. A Show run (`--show`)
is not tidied: a Show reads the script as written.

### The exact format (optional)

A file already in this format skips the tidy: no AI call. You never need to
write it, but use it when you are writing a script from scratch for the user,
or when the tidy can't run.

Plain text. An optional `DIRECTION:` block may open the file, before `CAST:` or
the first spoken line. Then a `CAST:` block naming the speakers, one line per
turn, then a `CTA:` block.

`DIRECTION:` carries whole-ad rules and no spoken words. The header is its own
line. The lines under it are the rules. The block ends at a blank line, at
`CAST:`, at `CTA:`, or at the first line that names a speaker. A second
`DIRECTION:` block is refused. So is a `DIRECTION:` after the first spoken line.
An empty block is refused too. The error code is `malformed-direction`.

Do not put a colon inside direction prose. The reader splits a line at its first
colon to find a speaker, so a colon in that prose is read as a name.

Right.

```
DIRECTION:
Nobody looks at the camera. The product stays on the table until the last line.
```

Wrong.

```
DIRECTION:
Rule: nobody looks at the camera.
```

The wrong line is not direction. `Rule` is read as the speaker, and the
block above it is empty, so the file is refused.

The planner sizes every line at 2.5 words per second (`WORD_LADDER_WPS`), so a
turn near 14 words plans a clip near 6 seconds. If a line does get truncated in
its clip, the manifest says so (`speech-cutoff`). That finding means the clip
cut the words off. Redo the clip. Do not speed the speech or cut it short to
hide the finding. The product rule is under "What the product actually
requires".

```
CAST:
THE EYES — a pair of tired cartoon eyeballs who stare at screens all day
THE SOFTGEL — a cheerful little capsule who knows how to fix that

THE EYES: Ten hours of screens today. Everything looks blurry and dry.
THE SOFTGEL: That's screen strain. Your eyes are begging for a break.

CTA:
THE SOFTGEL: Tap below and give your eyes ClearBlink.
```

The dash in a `CAST:` line is the parser's own separator. The example above
already shows that dash. A cast line may separate the name from the description
with an em dash, an en dash, or a hyphen with a space on each side. Keep that
dash on cast lines. A reader who strips it makes the line fail.

Do not use a long dash in words a character says, or in words shown on screen.
Synthesised speech reads a long dash oddly, and so does burned-in text. In the
exact format a spoken line is `NAME: what they say`; a file that is not in the
format is tidied into it.

### Directing a line

A spoken line can carry two kinds of note. Neither is required.

- **How the line is said goes in parentheses.** The voice acts it out.
- **What happens on camera goes in square brackets.** The storyboard plans the
  shot around it.

```
MIA: (whispering, excited) I can't believe this actually worked.
MIA: [holds the jar up to the camera] This is the one.
MIA: [leans in] (quietly) Don't tell my sister.
```

A note may sit anywhere on the line. It comes out of the spoken words, so the
voice never says it. Several notes of one kind on a line are joined. Notes work
on `CTA:` lines and on narrator lines too. They do not work on `CAST:` lines,
where anything in brackets is just part of the description.

How the voice uses a delivery note. By default a run records each line first,
on the Eleven v4 voices, which take the note as a short cue in front of the
line. The cue is the note's first clause, at most six words. A full stop,
colon, semicolon, question mark, exclamation mark, or a dash with a space on
each side ends the clause. A comma does not, so `whispering, excited` reaches
the voice whole. Keep the note short and put the part that matters first. Put
one delivery note on a line: two are joined with a semicolon, so the voice
hears only the first.

Right.

```
MIA: (whispering, excited) I can't believe this actually worked.
```

Wrong.

```
MIA: (She is whispering. She can barely contain how excited she is) I can't believe this actually worked.
```

The wrong note reaches the voice as `[she is whispering]`. The excitement is
lost.

In a narrated scene the whole narration is read as one part, so it takes one
cue: the note on the first narrator line in that scene.

What the reader refuses, with the code `malformed-direction`:

- an empty note, `()` or `[]`
- a square bracket that is never closed, or a stray `]`
- a line with no spoken words left once the notes come out

An unclosed `(` is not refused. It is read as ordinary words, and the voice
says it. Check every `(` has its `)`.

Both ways in read the notes the same way: `exodus video start --script` and
`exodus workflow run --input <field>=@script.txt`. Only `video start` tidies a
file that is not in the format; a workflow's Brief must already be in it. The second holds only when
the script goes straight from a Brief into the Storyboard. In a workflow where a
bot writes or rewrites the script first, the notes are not read this way, and
the bot may drop them or leave them in the spoken words.

With `--voice native` (admins only) the video model speaks the lines itself and
nothing is recorded first, so the six-word cue above does not apply.

**A line with no note still gets a natural read.** A note is the surest way to
get a particular delivery. The storyboard planner may add a note of its own to
a line you left plain. A note you wrote always wins over the planner's.

When you help the user write or tidy a script, suggest a delivery note where
the tone carries the ad: the hook, the turn, the CTA. Do not put a note on every
line. A note on every line reads as a script nobody trusted.

**How many speakers you may have depends on the rig.** Three by default. A rig
that carries saved format rules sets its own number: an ensemble rig seats more,
a talking-head rig seats one. Over the number, the launch refuses before
anything is spent and says both figures ("4 speakers — this format supports 3").
The rulebook the run followed is on the start receipt, on `workflow status`, and
in `manifest.json` under `provenance`.

## Reading the storyboard gate

`storyboard <runId>` prints one card per scene: who speaks, the
line, the planned duration, and whether its picture is drawn. Under the cards it
also lists the voices — one line per character who speaks or already has a voice
— so the user can see who sounds like whom before paying for the clips. Read it
for the user, then ask one question.

The question is approve or don't. If the storyboard is wrong, say so plainly and
let the user decide between approving anyway, redrawing a single still when
the stop block offers it (`exodus video retry-frame <runId> --node <nodeId>
--scene <n>`, with the node id that block prints), cancelling
(`exodus workflow cancel <runId>`) and re-running with a better script, or
changing the workflow. Approving is what releases the voices and the clips — the
expensive part — so do not approve a storyboard you have just told the user is
wrong.

**When the run has B-roll.** The storyboard ends with `change the B-roll shots:
exodus video broll <runId>`. Run that: it lists each B-roll shot (its scene
number, the line it sits on, the words it covers and its seconds) and every
script line with its id. Tell the user which lines have a shot, then offer three
changes:

- add a shot on a line, with a note on what it should show:
  `exodus video broll add <runId> --line <id> --note "what it shows"`
- move a shot to another line:
  `exodus video broll move <runId> --scene <n> --line <id>`, with an optional
  `--note`
- remove a shot: `exodus video broll remove <runId> --scene <n>`

An add or a move plans the shot on a worker, and then the storyboard pictures it
changes are redrawn. A remove saves at once, and the pictures it changes are
redrawn too. Every other picture comes back as it was. While a shot is being
planned, `video broll` says so and the server refuses another change. Run `video broll <runId>` again until it no longer says
it is planning, then read the storyboard again before you ask about approving.
If it says the last change didn't work, pass its sentence to the user as it
came. Do not approve while a shot is still being planned.

Do not approve on the user's behalf unless they told you to run the whole loop
unattended.

## B-roll

B-roll is a short shot the picture cuts away to while the speaker's voice keeps
going: the product, how it works inside the body, a result, a proof. Most top
ads use it. A run makes none unless it was started with `--broll`, and only an
account with B-roll switched on can pass it. The choice is fixed when the run
starts; it cannot be turned on afterwards.

**When to start with `--broll`.** Offer it whenever the script talks about
something a picture could show: the product, the mechanism, a before and after,
a number or a result. Leave it off when the user wants nothing but the person
talking. The app plans the shots and decides how many; it may plan few or none.
To direct the shots, start Guided (the default). `--one-shot` approves its own
storyboard, so nobody gets to change the B-roll.

**Reviewing and directing it.** At the storyboard gate, `video broll` lists the
shots and the lines, and adds, moves or removes one (see "Reading the
storyboard gate"). That is admin-only: a beta tester sees the shots in the
storyboard and can approve it, or stop the run on the video's page, but cannot
change them. A note on an add or a move says what the
shot should show, in one or two plain sentences ("close on the jar lid
twisting off", "the cream sinking into the skin, seen from inside"). Keep it
under 500 characters.

**The look.** A stylized ad (claymation, Pixar, anime, any animated style)
keeps its own look in every B-roll shot and goes closer or inside the body
instead. It changes look only when a note asks for a different one. A realistic, live-action ad may use any look a shot needs: a clean 3D
medical render, an animated diagram, a stock-footage look. Pass the user's
wish in the note; the app keeps or drops it by this rule.

**A shot that fails.** The app first tries a new idea for the shot, then a still
picture with a slow zoom. If both fail it leaves the shot out and the speaker
stays on screen. An admin's `pull` names those scenes and lists them under `dropped` in the
manifest. They have no clip, so cut with `--skip <those numbers>`.

## Giving the characters voices

By default a workflow run's characters have no voice of their own. A character
without one gets the run's default voice (the workflow's narrator voice) when the
run has one; with no default either, the clip keeps the voice the video model
invents. `exodus video voices` shows which of the three applies, and it is where you
fix the mapping. Fix it before you approve the storyboard gate. Approving that
gate locks the mapping, and `exodus video voices` refuses afterwards. On a
finished clip whose voice was never applied, the later command is `exodus video
revoice`, and that pass bills again. A clip that already went through the voice
pass is refused there. Use `retry-clip` for that one. See "Redoing only the
voice on finished clips".

```
exodus video voices <runId>
exodus video voices <runId> --json
exodus video voices <runId> --set C1=abc123voiceid --set "HOST 2=def456voiceid"
exodus video voices <runId> --from voices.json
exodus video voices <runId> --clear C2
```

Read it first. With no flags it prints one line per character: the character's
ID, the name the script uses, the voice chosen, whether ElevenLabs actually has
that voice on the user's account, and how many scenes that character speaks in.
Under it: how the voices get applied, who pays, and anything worth knowing before
approving.

Name a character either way. `C1` is the ID the planner handed out; `HOST 1` is
the name the script uses. Both work, and the name is the portable one — the same
voices file works on every run of that brand because the planner may hand out the
IDs differently each time.

**What `--set` changes.** The voice choices, and nothing else. The script, the
scene pictures and the run itself are left exactly as they were — no re-boarding,
no picture is redrawn, nothing is charged. A character whose voice was already
what you asked for reports "Nothing changed".

**What it refuses, and why nothing is written when it does.** A character name
nobody in the cast answers to, a voice ID with a space in it (people paste the
voice's *name* by mistake), and a voice ID ElevenLabs is certain it does not have
on that account. Each refusal says the plain reason and saves nothing. If
ElevenLabs simply cannot be reached, the choice IS saved and the output says the
check could not be made — a provider outage never blocks the run.

**Approving checks the voices one last time.** `video approve` re-checks every
chosen voice before the clips are paid for. If ElevenLabs is certain one of them
is gone — deleted from the account, or the account changed — the approve is
refused in one plain sentence, nothing is approved and the command exits 1. Fix
it by choosing another voice (`video voices <runId> --set <character>=<voiceId>`)
or clearing that character (`--clear <character>`, which lets the clip keep the
voice the video model makes), then approve again. When the approve goes through,
the receipt lists each speaking character and the voice they got, plus any
`Heads-up:` lines worth reading — that is the last moment a wrong voice is cheap
to fix.

**The voices file.** A plain JSON object, keyed by the names the script uses:

```json
{
  "HOST 1": { "voiceId": "abc123voiceid", "label": "First host" },
  "HOST 2": { "voiceId": "def456voiceid", "label": "Second host" }
}
```

A bare string works instead of the object when you do not care about the label
(`"HOST 1": "abc123voiceid"`), and `null` clears that character's voice. `--set`
and `--clear` win over the same name in the file, so one entry can be overridden
without editing it. Use the name the file uses: if the file says `HOST 2` and the
flag says `C2`, that is one character named two ways, and the whole request is
refused with a sentence saying so. Voice IDs belong to the user's own ElevenLabs account and to that brand's
folder — never put a brand's voice IDs in a shared workflow or template.

**One file, two moments.** A brand keeps a single `voices.json` in its own
folder. Hand it to the run at the start with `exodus workflow run <workflow>
--voices @voices.json` when the script is one the user supplied (it names its
speakers, so `HOST 1` means something before the planner has run), or hand it in
at the storyboard review with `exodus video voices <runId> --from voices.json`.
Launching with voices refuses before the run is created — nothing is spent — if
a speaker is not in the script, the same speaker is named twice, or ElevenLabs
is certain it does not have one of the voices; a workflow whose script is
written by a bot is refused with a pointer at the review-time command, because
nobody knows the speaker names yet. When the storyboard arrives, the voices are
already set and `exodus video voices <runId>` shows them.

**Choosing how the voices are made.** `--voice-treatment` on `workflow run` says
HOW a run makes its voices, and it is the only way. Two
kinds of answer.

A name on its own picks a way of working that plays a voice you already have,
and still pairs with `--voices`:

```
exodus workflow run "Podcast Ad" --input script=@script.txt \
  --voice-treatment lipsync-retarget --voices @voices.json
```

The other kind has the video model speak the CAST's lines itself, in voices you
WRITE. Those take a `voice-treatment.json`, which is the whole request body:

```json
{
  "path": "native-prompt",
  "describe": {
    "BUDGET": "Dry, tired middle-aged baritone. Slight rasp. Deadpan, unhurried.",
    "PIGGY BANK": "Bright quick alto, a little smug, crisp consonants."
  }
}
```

```
exodus workflow run "Podcast Ad" --input script=@script.txt \
  --voice-treatment @voice-treatment.json
```

Every speaker in the script needs a description. One left out gets a voice the
model invents afresh on every clip, and that drift only shows up once the clips
are paid for, so the launch refuses instead.

**The narration is not part of this.** A describing treatment changes how the
CAST's lines are voiced. A scene with narration (`voText`) is still recorded by
ElevenLabs on the member's own key by the Voiceover step, exactly as it always
was — so a run with `NARRATOR:` turns still needs an ElevenLabs key, and still
costs ElevenLabs money. `exodus video voices <runId>` says which of the two
shapes a run is, and only claims nothing is sent to ElevenLabs when nothing is.

**What refuses, all before the run is created, so nothing is spent.**

- A treatment name that does not exist. The message lists the ones that do.
- A describing treatment with a speaker undescribed, a speaker the script does
  not have, the same speaker described twice, or an empty description.
- Written voices plus `--voices`. The video model owns the voice on those runs,
  so the ElevenLabs voices would be paid for and never heard.
- Descriptions on a treatment that plays voices you picked instead.
- A workflow whose script is written by a bot. Nobody knows the speaker names
  yet, so there is nothing to describe.
- A workflow with no Video step, a Video step whose model cannot do what was
  asked, or a Video step with nothing wired into its voiceover port when the
  treatment needs one.
- No Google AI key on the account, for the treatment that renders through
  Google directly.
- A rig that shows every line on screen as text. No clip speaks, so there is no
  voice to treat.

**Still being tested.** Everything beyond the two shipped ways of working is
switched on only on the test stack while it is being tried out. On the live
stack those names refuse by name, and the message says which two to use
instead. That is a property of the stack, not of the workflow, so the same
saved workflow behaves differently on each — and a retry asks again rather than
copying, so a run retried after a treatment was switched off refuses.

**A sub-workflow chooses none of this.** When a Call box runs another workflow
inside this one, the child run carries no voice treatment: it renders the
shipped default, whatever the parent was started with. A treatment is a choice a
person made at a keyboard for one run, and nobody made it for the sub-workflow.

**Written voices cannot be changed at the review.** They are chosen when the run
starts. `exodus video voices <runId>` on a described run names the treatment and
prints each written voice, and says plainly that `--voice-treatment` at launch is
what changes them. Do not set a voice path in node config. Node config does
not set the treatment.

**Where it shows up afterwards.** The launch receipt and `exodus workflow status`
both print one line naming the treatment and the speakers who got a written
voice. `manifest.json` from `exodus video pull` carries the same under
`provenance.voice`, and each cast entry carries its `voiceDescription`.

**The JSON receipt** (`--json`), the same shape for reading and for setting:

```
ok                    true
runId
changed[]             the characters whose voice actually moved (set only)
canChange             false once the run has left the storyboard review
whyNot                why, in one sentence, when canChange is false
treatment.path        which way of making voices this run froze, or null
treatment.kind        "performance-then-conversion", "voiceover-then-lipsync" or
                      "render-owns-voice"
treatment.pinsHeard   true when the chosen ElevenLabs voices are heard on this
                      run; false only for "render-owns-voice"
cast[]                one per character
  characterId, name
  voice               { voiceId, label }: the voice this character's clips are
                      converted to. null only when they have no voice of their
                      own AND the run has no default voice
  voiceFrom           "own-pin" or "run-default"; absent when voice is null
  description         the WRITTEN voice, when the run was given one
  availability        { state: "available" | "missing" | "not-checked", … }
  spokenScenes        how many scenes this character speaks in
  spokenSeconds       those scenes' planned seconds — what ElevenLabs bills on
narrator              the one fallback voice, set on the workflow, not here
treatment             how the voices reach the clips: summary, provider, model,
                      speedChange, billedTo, estimatedCostUsd, costNote,
                      usage { clips, seconds }, keyOnRun
notices[]             plain sentences worth reading before approving
```

A failure is the same shape every `video` verb uses:
`{ "ok": false, "status": 400, "error": "<one plain sentence>" }`, exit 1.

**Before you approve, read `notices`.** The ones that cost the user something:
a character who speaks but has no voice of their own and no run default to fall
back on (those clips keep their generated voice), no ElevenLabs key saved on the run (no voice can be applied at all), and
a voice ElevenLabs no longer has.

`estimatedCostUsd` is always null. Exodus cannot price a voice conversion yet;
ElevenLabs bills the user's own account by audio length, and `usage` gives the
length. Do not invent a number.

## The handover: what `pull` gives you

`pull` writes a flat folder and a `manifest.json` that indexes it. The manifest
is the data you decide from; the filenames are its values. Scene numbers are the
run's own. Every `pull` re-downloads and overwrites every file, so running it
again is always safe.

```
storyboard.json          the whole storyboard envelope (see below)
reference.<ext>          the reference still the scene pictures were drawn from
cast-<characterId>.<ext> one identity still per locked cast member
cast-ref-NN.<ext>        an identity still the cast lock does not claim
scene-NN.keyframe.<ext>  the picture scene NN's clip was animated from
scene-NN.<ext>           the clip for scene NN, usually .mp4
scene-NN.voice.<ext>     the voice track for scene NN, when one was delivered
scene-NN.words.json      [{w, s, e}] word timings for that scene's speech
narration.mp3            one continuous narrator take of the whole script
narration.json           that take's settings, master-timeline words, and the
                         per-scene ranges it was cut into
music.<ext>              the music bed
manifest.json            the index below
```

`manifest.json`:

```
runId, pulledAt, dashboardUrl        the run and the page that opens it:
                                     /workflows/<workflowId>/runs/<runId>
storyboard, reference, music         filenames, or null when not delivered
musicBed                             on | off | unknown — whether the RUN has a
                                     music bed, which is not the same question
                                     as the `music` filename above. "unknown" is
                                     a run made before the run carried the
                                     answer; it is not "off"
musicHeardScenes[]                   scene numbers whose clip came back with
                                     music the video model baked in. A run with
                                     the bed off can still list scenes here, and
                                     those are the ones to listen to
pendingRedo[]                        scene numbers the app is redoing right
                                     now. Their clip and words are left out,
                                     because the file on the run is the take
                                     being replaced: run `exodus video wait`,
                                     then pull again
dropped[]                            B-roll scene numbers the app left out
                                     after a new idea and a still both failed.
                                     They have no clip on purpose: cut with
                                     `--skip` and stay on the speaker
narration                            { file, timing }, or null on a per-scene run
cast[]                               one per identity still
  characterId, name                  from the run's cast lock; null for an
                                     unclaimed ledger still
  file, status, error
  voiceId, voiceLabel                the ElevenLabs voice this character was
                                     given before the clips were made; null when
                                     nobody chose one
scenes[]                             one per scene, in order
  sceneIndex, durationSec            the run's number and the clip's real length
  clip, voice, keyframe, words       filenames, or null
  wordsFrom                          clip | voice — which file the word times are
                                     measured against; null when none came
  wordsDescribe                      this-file | original-performance — whether
                                     those times were measured on the file you
                                     have, or on the take a cast voice replaced;
                                     null when no words came
  clipStatus                         done | failed | running | pending | missing
  error                              why the clip failed, when it did
  flagged, findings[]                QC verdict: {check, code, severity: fail|warn, detail}
  keyframeFindings[]                 the same, from the picture check; null when
                                     nobody checked the picture
  qc                                 {verdict, attempts} from the renderer
  revoiced                           the cast's pinned voice replaced the clip's
                                     generated voice; null when there is no clip
  speechTrimmed                      the clip was re-cut to its spoken words
                                     (0.5 s before the first, 0.8 s after the
                                     last); null when there is no clip
  rawStorageId                       the stored file the video model made, kept
                                     on record when the voice pass replaced the
                                     clip with a new file; null when the clip IS
                                     that file, or there is no clip
  voiceMode                          "voice-first" when the clip was redone voice
                                     first (its line recorded, then the clip made
                                     to match it); null otherwise
provenance                           which saved rulebook this run followed:
                                     {format: {via, nodeId, rigId, rigName,
                                     rulesFrom, specVersion}}. Absent when the
                                     run followed none. `nodeId` is the Rig box
                                     that chose it; `rulesFrom` names the rig the
                                     rules were borrowed from when the picked
                                     rig is a copy. Names, ids and a version
                                     only — never the rules themselves
failed[]                             files that did not download: {file, url, error}
```

### What each piece is

**The clips** (`scene-NN.<ext>`). The finished take, already trimmed and
revoiced where the run did that — not a raw render you have to repair.
`durationSec` is its real measured length. Whether the clip carries sound
depends on the scene; see "Which scenes carry their voice where" below.

**The storyboard** (`storyboard.json`). The intended cut, in the planner's own
terms. `script[]` is the ad's spoken words in order — `{lineId, speakerId, text}`,
with `speakerId: null` meaning narrator VO. Each scene carries `sceneIndex`,
`durationSec`, `dialogue[]`, `voText`, `notes`, and `lineIds` (the script lines
that scene renders). A scene with `kind: "cutaway"` carries `cueLineId` and a
`cutawayType` instead. Most cutaways are a picture-only takeover of the frame
while the spoken track underneath keeps running, so they add no audio and take
no place in the running order. A `cutawayType: "reaction"` cutaway is the room
reacting out loud to its cue line: it is its own short beat after that line,
heard with its own sound while the speaker is silent. The
envelope also carries `overlays[]` (each with a `cueLineId` and a `placement`)
and `audio` (`roomTone`, `music`, `sfxCues[]`) — the planner's notes on what
should sit on top. The image and motion prompts (`framePrompt`, `videoPrompt`,
`referencePrompt`) reach an admin key in full. A caller who cannot use video on
this brand gets them stripped before the file arrives. They are private Style
fragment IP (`redactVideoIp` in `convex/workflows.ts`). Style pack is the
retired name.

**The narration track** (`narration.mp3` + `narration.json`). Present when the
run recorded continuously: every narrated scene's `voText` joined into one
script and read by ElevenLabs in a single pass at speed 1.15 — one take, one
pace, start to finish. `narration.json` carries `takeHash`, `voiceId`,
`modelId`, `speed`, `alignment: "elevenlabs-timestamps"`, the master's word
timings, and `cuts[]`: for each scene, `startSec` and `durationSec` **into
narration.mp3**. Runs go per-scene instead when any scene has on-camera
dialogue, when the voiceover node is configured `take: "per-scene"`, or on an
older storyboard carrying no `script[]`; then there is no `narration.mp3` and
each scene's voice is its own recording. That choice is made from the storyboard
and the node config (`planNarration`).

**The per-scene voice tracks** (`scene-NN.voice.<ext>`). On a continuous run
these are cut out of `narration.mp3` itself — the same audio, sliced at the
ranges in `narration.json` with a 0.2 s pad and a boundary at the midpoint of
each gap. They are not separate performances. On a per-scene run each one is its
own ElevenLabs render.

**Which scenes carry their voice where.** A scene whose storyboard entry has a
non-empty `voText` is a narrator scene: its clip is rendered silent and the
voice arrives as a separate track. A scene with on-camera `dialogue[]` has the
speech inside the clip — under the default voice treatment the video model's
invented voice is then replaced, in place, with the cast member's pinned
ElevenLabs voice (that is `revoiced: true`). Other treatments leave the render
owning its own audio, e.g. lip-sync retargeting a VO track onto the video. The
treatment is frozen on the run when it starts, and there is exactly one flag
that sets it: `--voice-treatment` on `workflow run` (see **Choosing how the
voices are made**). Node config never sets it. Nothing on the canvas sets a
voice treatment, and a run that was given none renders the default. Read
`wordsFrom` and `revoiced` per scene rather than assuming.

**Word timings** (`scene-NN.words.json`). Seconds from the start of the file
`wordsFrom` names, always. `wordsFrom: "clip"` is an ElevenLabs Scribe
(`scribe_v1`) transcription of that clip's own audio, taken blind — the model
never sees the script — and re-based if the clip was speech-trimmed.
`wordsFrom: "voice"` is the ElevenLabs alignment of the continuous master,
re-based to the start of that scene's cut; on a per-scene run it is instead a
blind Scribe pass over that scene's own voice track. Nothing is aligned to the
finished ad — that timeline does not exist until you make it.

**How far to trust them** (`wordsDescribe`). `"this-file"` means the times were
measured on the very file `wordsFrom` names, so they hold to the frame: cut
captions and cue points straight off them. `"original-performance"` means the
scene's clip was re-voiced *after* its words were timed — the times describe the
take the cast voice replaced. The words and their order are right and the timing
is close, but nothing re-measures it, so check any cut that has to land on a
single frame. A clip carrying a `voice-timing-shifted` warning is the same thing
with a measured gap: the swapped audio came back a different length, so treat
that scene's times as a rough guide and watch it before you trust it. Nothing in
the pipeline speeds audio or video up or slows it down to make the two agree —
the timings are reported honestly instead.

**Cast identity stills** (`cast-*.<ext>`). A full-body identity still per cast
member, on a plain neutral background in the run's style, minted once and
frozen onto the run as its cast lock. Every scene picture was anchored to these,
which is why the same character holds across scenes. `cast-<characterId>` is a
locked member; `cast-ref-NN` is a still from the same minting the lock does not
claim. Useful as reference when you cut, and as the thing to point at when a QC
finding says `wrong-character`.

**The music bed** (`music.<ext>`). One continuous track for the whole ad,
generated by Eleven Music after the last clip lands, at the landed clips' summed
length plus a 3-second safety pad. One track per ad, never per-scene. It is
never mixed into any clip and never levelled — gain, fade and ducking are the
cut-maker's decisions. A music failure degrades to a warning rather than
blocking the run.

### Reading it before you cut

- `clipStatus: "done"` with a `clip` filename: the scene is cuttable.
- `wordsFrom: "voice"`, or a scene whose storyboard entry has `voText` and no
  on-camera line: the clip is picture only and the voice track is the sound.
  Do not use that clip's own audio.
- `wordsDescribe: "original-performance"`: the word times were measured before
  that clip's cast voice was swapped in. Close, not frame-exact — say so if the
  user is cutting captions to the frame.
- `manifest.narration` present: listen to `narration.mp3` end to end, then the
  joins between adjacent `scene-NN.voice` files, before you trust the cut.
  Matching voice IDs and a one-speaker diarization result do not prove
  continuity (#1802).
- `flagged: true` is a warning, not a block. The clip was delivered anyway; the
  findings say what the QC model saw (`wrong-character`, `eyeline-off`,
  `set-drift`, `speech-cutoff`, `framing-off`, `voice-timing-shifted`). Tell the
  user which scenes are flagged and why, and let them decide whether to keep,
  trim, drop or redo each one (`retry-clip`, see "Redoing one clip at the final
  watch").
  A `speech-cutoff` on the CTA scene is the one to worry about; the ad's last
  words are missing. `status` shows the checker's own wording behind each
  finding; the manifest carries only the verdict.
- A `pass` verdict is not a review. The checks are often optimistic. Watch the
  frames and listen to the audio before you call the run good. Two checks fail
  the wrong way. A cast-count check can reject a silent
  listener who belongs in the shot. A clip check can flag a clip that is fine.
  Read the finding, then watch the scene.
- `clipStatus: "failed"` or `"missing"` with a `keyframe`: `durationSec` is null
  (it comes from the clip), but the scene can still hold its place as a still —
  for the length of its voice track, or the storyboard's planned duration when
  there is no voice.
- `clipStatus: "running"` or `"pending"`: pull again later. `status` says when
  the run parks at the final watch, which means nothing is still rendering.
- `failed[]` non-empty: run the same `pull` again.

## Redoing one clip at the final watch

`retry-clip` re-renders ONE scene's clip on the run that already made it. There
is no second run, no new storyboard and no re-render of anything else.

```
exodus video retry-clip <runId> --scene 3
exodus video retry-clip <runId> --scene 3 --note "keep both hands in frame on the handshake"
exodus video retry-clip <runId> --scene 3 --node video-2
exodus video retry-clip <runId> --scene 3 --voice-first
```

`--node` is only needed when a run has clips for that scene on two video steps;
the CLI asks for it by name when it does.

**When it is allowed.** A failed clip, once the step that made it has finished. A
finished clip, only while the run is parked at the final watch, or when QC
flagged it (`flagged: true` in `status` and in the manifest). Everything else is
refused in one plain sentence before any task is queued: a step still rendering
its other scenes or one that failed outright, a scene already being redone, a
finished clip on a run that is not at its final watch. An ad that is already
delivered is refused by the server, in its own sentence.

**What stays untouched.** Every other scene's clip, every keyframe, the cast
pins, the voices and the approved script. The redone clip re-renders from the
same keyframe with the same voice path the first take used, so it comes back
revoiced and trimmed the same way, with fresh findings and fresh word timings.

**A `--note` steers the motion, never the words.** It is folded into that
scene's motion prompt only (`withRedoDirection`,
`scout/src/trigger/workflow-scene-retry.ts`); the spoken line still comes from
the approved storyboard. Asking for different words in a note will not change
them. If the script's words are wrong, that is a new run.

**`--voice-first` fixes a clip that said its line wrong** (#2299). It is for a
clip whose findings include `speech-mismatch`, `speech-repeat`,
`speech-after-line`, `speech-extra-words` or `speech-long-pause`. The scene's line is recorded in each
speaker's pinned ElevenLabs voice, and MiniMax (`minimax-h3/reference-to-video`)
makes the clip to match the recording. Only that clip changes; the word check
and the other checks still run on it. It needs an ElevenLabs key and a voice for
every speaker in the scene, and it is refused for a scene with no spoken line.
The clip then reads `clip: redone voice first` in `status`, carries
`voiceMode: "voice-first"` in the manifest, and is listed in the `pull` summary.

**A redo whose take fails the checks keeps the original clip.** On a finished
clip the row stays `done` with the ORIGINAL take and only its findings are
refreshed, because a worse take must never replace a delivered one. So never
report that the clip changed without reading `status` again: under the scene it
prints what the redo did, `new take accepted (take N)` or `new take rejected,
original kept (take N)`, and `status --json` carries the same sentence on the
row as `lastRedo.label`. A row with no `lastRedo` was redone before outcomes
were recorded; for those, pull and compare the file before and after.

**Re-cut afterwards.** A cut you already uploaded still holds the old clip, and
the CLI says so when that is the case. Pull again, re-cut and upload again before
anyone approves.

## Redoing only the voice on finished clips

`revoice` puts clips that are already paid for back through the voice pass: the
spoken words are checked against the script, the clip is trimmed to the speech,
and the chosen voice is applied. It makes no new video, so the picture cannot
change and no video credits are spent. ElevenLabs bills the voice work to the
member's own key.

```
exodus video revoice <runId> --all
exodus video revoice <runId> --scene 3
```

**When to reach for it.** `status` shows talking clips with `voice-unpinned` or
`voice-not-applied` (usually next to `speech-check-skipped`), and the manifest
shows `revoiced: false` with no words file. The usual cause is a run that had no ElevenLabs key when its
clips were made. `voices <runId>` says so: "This run has no ElevenLabs key saved".

**It finds the key by itself.** Before queuing anything, the server gives the run
the ElevenLabs key saved on the run owner's account, if the run has none. When
there is no saved key either, nothing is queued and the refusal says where to add
one (Settings → Keys). Approving a storyboard does the same top-up, so an older
run parked at its storyboard is fixed before any clip is paid for.

**`--all` picks the clips that need it.** Every finished clip whose file is still
the video model's own and whose findings carry `voice-unpinned` or
`voice-not-applied`, the two codes that mean a voice change should have happened
and did not. `speech-check-skipped` alone does not qualify: it also lands on
clips whose sound the video model or a later step owns, where there is no voice
to change and a pass would bill a transcription for nothing. `--scene <n>` is
not filtered this way; the server decides. It sends one request per scene, tries
every one, and reports each. Scenes refused with the same sentence share one
line (a run with no key prints that sentence once); `--json` keeps one entry per
scene.

**What is refused.** A clip that already went through the voice pass (`revoiced`,
`speechTrimmed` or a trimmed tail): the pass would trim or convert it twice. Use
`retry-clip` to make that clip again from scratch. A failed clip, a scene already
being redone, a step still rendering, and an ad already delivered.

**An older server starts nothing.** The voice redo has its own server route and
its own worker task. A server or worker from before it existed cannot run it, and
the CLI never falls back to `retry-clip`'s route, which would make new paid video.
You get one sentence saying the server does not have the voice redo yet, and
nothing is queued or spent.

**A clip is never lost.** The clip stays on its row the whole time. If the voice
pass cannot finish, the clip, its findings and its cost are left as they were and
one warning, `revoice-not-finished`, is added. Run it again. If ElevenLabs refuses
the key, the clip comes back unchanged with `voice-not-applied`.

**If the word check now fails.** The voiced clip is still delivered, and the scene
is flagged with the finding, because the picture is the same one the ad already
had. Decide from `status`: keep it, or `retry-clip` it.

**Afterwards.** Pull again. Each voiced scene now has `revoiced: true`, a words
file, and `rawStorageId` naming the original file. Re-cut and upload again if a
cut was already uploaded; the CLI says so when that is the case.

## Cutting the ad

Editing is the part every user does differently, and the team is deliberately
still finding out what works. Nothing below is the house way. Ask the user which
they want; if they have not said and are not around, say which you used and why.

- **The bundled script** — `node .claude/skills/exodus-video/scripts/first-cut.mjs
  ./ad-<runId>`, path from the workspace root (from a brand subfolder, prefix
  `../`). A plain assembly with no editing decisions in it, for seeing the whole
  ad end to end quickly. Read "What the bundled script does" before you run it.
- **HyperFrames** — HTML/CSS compositions rendered to video. Suits an ad that
  needs captions, title cards, overlays or motion graphics laid over the clips.
  It is a separate skill pack; check that a `hyperframes` skill is installed
  before offering it. The cut is made outside Exodus. `exodus video pull` is the
  handover. The folder it writes is what the next tool reads. When a HyperFrames
  skill pack is installed, that pack is the route for an HTML and CSS
  composition. Do not look for a stitch inside Exodus.
- **An NLE over MCP** — DaVinci Resolve publishes an MCP server, so a timeline
  can be built in a real editor and the user can carry on by hand afterwards.
  Suits a user who wants to keep editing after you stop. Check what MCP servers
  are actually connected first; do not assume one is there.
- **ffmpeg by hand** — full control with nothing extra to install. Suits a trim,
  a reorder, an aspect change, or anything the others make awkward.

Whatever you use, the only thing the product requires of the output is that
`upload` accepts it (see below).

### What the storyboard asks the cut to do

Read these out of `storyboard.json` before you build anything, in any tool:

- **Running order.** A-roll scenes (no `kind`, or `kind: "aroll"`) in
  `sceneIndex` order are the spine. Their summed length is the ad's length.
- **Cutaways.** `kind: "cutaway"` + `cueLineId`: lay the picture over the spine
  at the moment that script line is spoken, taking no audio and no place in the
  running order. To find the moment, locate the A-roll scene whose `lineIds`
  contain the cue line, then read the start time of the first word of that line
  out of that scene's `words.json`. A B-roll cutaway (one with `broll`) starts
  0.5 s before the first word of `broll.covers` instead (even if that reaches
  back into the scene before, but never into a reaction or before 0 s), and
  holds through its last word or for `broll.plannedSec`, whichever is longer,
  0.8 s to 4 s; a shot planned longer than 4 s (a talking character) holds at
  least `broll.plannedSec`. The next cutaway, a reaction or the ad's end cuts
  it short.
- **Reactions.** A cutaway with `cutawayType: "reaction"` is the exception. Do
  not lay it over the speech. Put it into the running order as its own beat
  right after its cue line ends, play its own sound (the audience laughing),
  keep it to about 1.5 s, then carry on with the speaker. Nobody talks during
  it. When more lines follow the cue line in the same scene, cut that scene
  where the cue line's last word ends in its `words.json` and put the reaction
  between the two halves.
- **Overlays and SFX.** `overlays[]` and `audio.sfxCues[]` are cued the same
  way, by `cueLineId`. Nothing renders them for you.
- **Jump cuts.** When `manifest.json` has `shots.pacing: "jump-cuts"`, every
  scene was filmed from the same framing on purpose. Punch in about 15% on
  every other cut between one speaker's scenes, so each cut visibly moves in
  or out. The bundled script does this for you.
- **Captions.** Nothing is burned into any clip. Captions belong in post; the
  word timings are what an editor imports to build them.

### What the bundled script does

State this to the user before you run it, so they know what the cut does with
the pieces:

- **It cuts the picture to the voice, and never the other way round.** A
  narrated scene's segment runs to the narrator's last word plus a beat of air:
  about 0.25 s before the next scene, 0.5 s when it ends the ad. The last word
  comes from the voice track's own word timings; when the scene has none, the
  end of the voice file stands in for it. A clip that runs longer is trimmed; a
  clip that runs shorter holds its last frame for the difference. The narration
  is never sped up or slowed down, so every scene plays at the speed it was
  recorded, and the word times are handed on as they were measured. The voice
  file is cut only in the silence after its last word, never inside a word.
- **It closes the dead air at the joins.** A clip that plays its own dialogue
  keeps about 0.15 s after its last word and about 0.1 s before its first (0.25 s
  when a different speaker answers), read from its `words.json`, so one clip
  runs into the next like one conversation. It only ever shortens a clip's
  silence and never cuts into a word. The ad's first clip also opens about 0.1 s
  before its first word, so a hum a clip makes before anyone speaks is not the
  first thing heard. The clip that ends the ad keeps about 0.5 s after its last
  word, the same beat a narrator line gets there, or longer when the storyboard
  marks an action after the line. A narrated scene, a still and a reaction beat
  keep their length.
- **It shortens long pauses between sentences inside one clip.** A silence over
  0.6 s between two sentences is cut down to about 0.5 s, picture and sound
  together, unless the script writes the pause in (an ellipsis or a dash), a
  direction asks for one, or a reaction's laugh follows the line.
- **It fades the audience reaction in and out.** A reaction beat fades in
  across any quiet start before its laugh (a generated laugh clip can hum
  there). When a line follows, the picture moves on early and the laugh's own
  remaining sound plays on under that line, quieter and fading out: up to
  0.75 s, and the beat keeps at least 1 s of picture (a 1.5 s clip shows 1 s
  and carries its last 0.5 s). A beat that ends the ad, or has under 0.4 s to
  carry, fades out over its last 0.4 s instead.
- **It ignores the continuous master.** It reads only `scene-NN.voice` files;
  it never opens `narration.mp3` or `manifest.narration`. A tool that lays the
  master down whole and cuts the pictures to it keeps the read intact.
- Otherwise: A-roll in manifest order as the spine, each reaction put in as its
  own beat of at most 1.5 s right after its cue line with its own sound, each
  other cutaway laid over the spine at its cued word (falling back to a
  proportional estimate when the scene has no word times, and saying which
  method it used), a narrated scene's voice
  replacing whatever the clip recorded, a dialogue scene keeping its performed
  line, everything normalized to 1080×1920
  at 24 fps and −16 LUFS per segment, a generated room-tone bed under the whole
  ad, and the music bed underneath at low level. Output is H.264 + AAC in an MP4
  with `-movflags +faststart`.
- **It stops when a scene has no clip.** A scene the storyboard plans that is
  still being made, never started, or failed stops the cut, which names each
  one. Wait for the clip and pull again, leave the scene out with `--skip`, or
  pass `--still-fill` to hold that scene's keyframe on screen instead: under its
  voice track if it has one, else silent for its planned length. The still is
  only ever made when asked for, because a run of them reads as a broken ad.
- Flags: `--out <file>`, `--skip 2,5`, `--no-music`, `--still-fill`. It prints what went in,
  what was left out and why, and the upload command. When a clip hums or
  clicks where nobody speaks at an edge the cut plays, it lists each one under
  "Sound at the edges" with its time in the cut. That is a warning to listen
  there; the cut is made anyway.
- Beside the MP4 it writes `cut.words.json` (every spoken word of the finished
  ad with its start and end) and `cut.srt` (the same words grouped into subtitle
  lines), named from the `--out` basename. Those times are on the finished ad's
  timeline, each scene's own word times offset by where that scene starts in the
  cut, less any lead-in trimmed at the join, and otherwise unaltered. Scenes with no word times leave
  gaps and are named in the report; when no scene delivered any, neither file is
  written. It always writes `cut.scenes.json` too: where each scene plays in the
  cut, one `{scene, startSec, seconds}` entry per placement. `exodus video
  upload` sends `cut.scenes.json` and `cut.words.json` with the cut when they
  sit beside it, so the customer's edit list shows each scene's time on screen
  and their editor folder gets the captions. These sidecars are the script's own
  output — another tool will not produce them.

Before uploading anything, from any tool, check what you made:
`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 cut.mp4`
should be close to the sum of the scene durations you kept (the bundled
script's cut runs somewhat shorter, by the silence it trimmed at the joins). A cut that is a few
seconds long when five clips went in means a filter dropped inputs; do not
upload it.

## What the product actually requires

These are the system's rules. They hold no matter which tool made the cut.

**`upload` accepts** `.mp4`, `.m4v`, `.mov` or `.webm`, up to 200 MB. The server
re-derives the type from the stored bytes and rejects anything that is not video.
The length comes from `--duration` if you pass it, else `ffprobe`, else the MP4
header; when none of those works the CLI says so and asks for `--duration`. The
length you give is recorded as stated and never measured against the file, so
give a real one.

**`upload` only works at the final watch.** The run has to be parked there with
its video step done, or the server answers "This ad isn't waiting for your final
cut right now." That park exists only when the video node sets
`finalWatch: true`. Uploading again replaces the
previous cut in place rather than adding a second one. Upload does not move the
run; it stays parked until someone approves.

**Approving is what makes it the ad, and it is one-way.** `approve` at the final
watch stamps the run delivered and resumes it. After that the server refuses any
further upload ("This ad is already delivered — nothing to change"). So approve
only when the user has seen the cut or told you to run unattended.

**Nothing checks that the cut matches the approved ad.** The server verifies
that the file is a video and that the run is at the right gate. It never
compares the cut against the script or the storyboard. The approved spoken copy
and the approved narration are therefore not the editor's to change — reordering
lines, re-recording narration, or cutting words out of the CTA will ship,
silently. Cut the pictures to the words, not the words to the pictures. If the
words are wrong, that is a new run, not an edit.

Never stretch speech, speed it up, slow it down, or cut it short so it fits a
clip. That is a product rule, and it holds for every tool that makes the cut,
including the bundled script. If the audio does not fit, redo the clip with
`exodus video retry-clip`. Do not repair the fit in the editor.

## Reporting to the user

Lead with where the run is and what it needs from them. Then, when you pulled
or cut: how many scenes, which are flagged and why in one line each, what you
left out, which tool you cut with and anything it changed, the cut's length, and
the exact command or link for the next step. Never paste the manifest;
summarize it.
