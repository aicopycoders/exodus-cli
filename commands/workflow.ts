import fs from "node:fs";
import path from "node:path";
// #1002 (--out saving) predates the #1000 `path` import — same module, second
// alias kept so neither feature's call sites churn.
import nodePath from "node:path";
import {
  apiGet,
  apiGetText,
  apiPost,
  apiPostDashboard,
  getDashboardUrl,
  type ApiResponse,
} from "../lib/client.js";
import { formatApiError } from "../lib/format.js";
import type { FlagOccurrence } from "../lib/args.js";
import { pollUntilDone, type PollOptions, type PollResult } from "../lib/poll.js";
import {
  normalizeRunStatus,
  isTerminalRunStatus,
  storedWorkflowStatusForms,
  isWorkerStoppedPark,
  LEGACY_WORKFLOW_RUN_STATUS_VALUES,
  TERMINAL_RUN_STATUSES,
  type RunStatus,
} from "../lib/runStatus.js";
import { runVerdict, type RunDeliverySummary } from "../lib/runVerdict.js";
import { runDisplayName, runHeadingWord, runTypeWord } from "../lib/runNames.js";
import { workflowToYaml, parseWorkflowText } from "../lib/workflowText.js";
import { missingRouteLine } from "../lib/route-support.js";
import { getChannel, type Channel } from "../lib/channel.js";
// #1788: the video park classifier and its next-step lines, so `--wait` stops
// at a storyboard gate / final watch with the SAME words `exodus video status`
// prints. video.ts imports ASSET_UPLOAD_POLICY from this module in return; both
// sides only touch the other's exports inside function bodies, so the ESM
// cycle never reads a binding before it is initialised.
import {
  asVideoRun,
  classifyRun,
  resolveStopAtPark,
  reviewUrl,
  scenePrefix,
  stopLines,
  type RunStop,
  type VoiceMap,
} from "./video.js";

export const helpText = `
exodus workflow — List, describe, run, inspect, import, and export saved workflows

Usage:
  exodus workflow list [--json]
  exodus workflow describe <workflowId|name> [--json]
  exodus workflow bots [--category <cat>] [--slug <slug>] [--json]
  exodus workflow templates [list] [--json]
  exodus workflow templates export <key> [--out <file>] [--json]
  exodus workflow schema [--kind <kind>] [--face <face>] [--json]
  exodus workflow run <workflowId|name> [--fill <name>] [--input key=value ...] [--input <fileField>=<path> ...] [--rig-overrides <json|@file>] [--voices <json|@voices.json>] [--voice-treatment <name|json|@file>] [--auto-approve] [--wait] [--out <dir>] [--json]
  exodus workflow status [--json]
  exodus workflow status --id <runId> [--out <dir>] [--json]
  exodus workflow cancel <runId> [--reason "..."] [--json]
  exodus workflow versions <workflowId|name> [--json]
  exodus workflow export <workflowId|name> [--version <n>] [--out <file>] [--json]
  exodus workflow validate <file> [--update <workflowId>] [--json]
  exodus workflow import <file> [--update <workflowId>] [--dry-run] [--json]
  exodus workflow triggers <workflowId|name> [--json]
  exodus workflow triggers <workflowId|name> enable <n> [--json]
  exodus workflow triggers <workflowId|name> disable <n> [--json]
  exodus workflow triggers <workflowId|name> fire [<n>] [--text "..."] [--rig-overrides <json|@file>] [--voices <json|@voices.json>] [--wait] [--json]
  exodus workflow inbox [--json]
  exodus workflow checkpoint <runId> [show] [--json]
  exodus workflow checkpoint <runId> edit <n> [--text "..." | --file <path> | (stdin)] [--json]
  exodus workflow checkpoint <runId> approve [--reject <n[,n..]>] [--wait] [--json]
  exodus workflow checkpoint <runId> retry [--note "..."] [--wait] [--json]
  exodus workflow checkpoint <runId> cancel [--reason "..."] [--json]
  exodus workflow repair <runId> retry|skip|kill [--wait] [--json]
  exodus workflow answer <runId> --slot key=value [--slot key=value ...] [--json]

Flags:
  --json                 Machine-readable JSON output
  --category <cat>       (bots) Filter the catalog to one category id
  --slug <slug>          (bots) Show a single bot's full port + param spec
  --input key=value      Repeatable workflow run input; values may contain "="
                         --input key=@path loads the value from a file (path is
                         resolved from the current directory); --input key=@@text
                         keeps a leading "@" as a literal character.
                         FILE fields (an Asset Input — "workflow describe" shows
                         them as source "asset") take a local file path instead:
                         --input hero=./photos/hero.png. The CLI uploads the file
                         and sends the stored asset in its place; a leading "@"
                         is accepted and ignored. An http(s) URL is accepted too
                         (--input hero=https://example.com/hero.png) — the server
                         fetches and registers it at launch. Pass an asset id
                         from an earlier upload to reuse it. Accepted files:
                         image PNG, JPEG, WebP, GIF (≤15MB) · video MP4, MOV,
                         WebM (≤200MB) · audio MP3, M4A, WAV, OGG (≤50MB) ·
                         document PDF, TXT, MD, DOC, DOCX (≤25MB).
                         MULTI-CHOICE fields (describe tags them "multi-select")
                         take several picks in ONE value, comma-separated:
                         --input tone=casual,punchy.
  --fill <name>          (run) Launch from a saved fill — a named set of inputs
                         saved on THIS brand's copy of the workflow. Its values
                         become the run's inputs; any --input you also pass wins
                         for that one key, so a fill is a starting point, not a
                         lock. Names are exact (case-sensitive); an unknown one
                         is rejected before the run starts. Fills are created and
                         named in the dashboard's run dialog.
  --rig-overrides <json> (run, triggers fire) Change what an Image Rig box fires
                         for THIS ONE run, without editing the saved workflow —
                         a different number of images, a different meme format,
                         a different model. Takes a JSON object keyed by the
                         box's node id, or @path to a .json file holding one:
                           --rig-overrides '{"rig_1":{"lines":{"line_1":{"count":3}}}}'
                         Add "confirmLargeRun": true beside "lines" to allow a
                         run over the brand's image safety cap — the same
                         acknowledgement the tick-box in the app asks for. A box
                         or line name the workflow doesn't have is refused
                         before anything runs, and the error names it. On
                         "triggers fire" it REPLACES the schedule's own
                         overrides for that one test fire.
  --voices <json>        (run, triggers fire) Give the ad's characters their
                         voices at the moment the run starts, instead of at the
                         storyboard review. Keyed by the names the SCRIPT uses for its
                         speakers ("HOST 1") — the planner's character ids
                         (C1, C2) do not exist yet when a run starts. Takes a
                         JSON object, or @path to a .json file holding one:
                           --voices @voices.json
                           --voices '{"HOST 1":"<voiceId>"}'
                         Same file "exodus video voices <run> --from" reads at
                         the review, so a brand keeps ONE voices.json for both.
                         A speaker the script does not have, the same speaker
                         named twice, or a voice ElevenLabs does not have stops
                         the launch before the run is created — nothing is
                         spent, and the message says which one. A workflow whose
                         script is written by a bot (so nobody knows the speaker
                         names at the start) is told to use "exodus video voices
                         <run>" at the storyboard review instead. Voice ids
                         belong to the brand's own folder — never put them in a
                         shared workflow or template.
                         A schedule can carry the same map in its YAML
                         ("voices:" beside the schedule), so a weekly ad arrives
                         already voiced. On "triggers fire" this flag REPLACES
                         the schedule's own voices for that one test fire. A
                         schedule whose voice has been deleted, or whose
                         ElevenLabs key is missing or refused, does not start at
                         all: it leaves a failed run saying which speaker and
                         what to fix, and spends nothing.
  --voice-treatment <v>  (run) Say HOW this run makes its voices. Two kinds of
                         answer. A name on its own picks a way of working that
                         uses voices you already have:
                           --voice-treatment sts-revoice
                           --voice-treatment lipsync-retarget --voices @voices.json
                         The other kind has the video model speak the lines
                         itself, in a voice you WRITE instead of one you pick.
                         Those need a description for every speaker in your
                         script, so they take a JSON object, or @path to a .json
                         file holding one:
                           --voice-treatment @voice-treatment.json
                           --voice-treatment '{"path":"native-prompt","describe":{"HOST 1":"Dry, tired baritone."}}'
                         Written voices and --voices are never used together:
                         the video model owns the voice on those runs, so
                         ElevenLabs voices would be paid for and never heard,
                         and asking for both stops the launch. Anything the run
                         could not actually do — a treatment this stack has not
                         switched on, a Video step on a model that cannot do it,
                         a missing key, a rig that shows every line as on-screen
                         text — stops the launch before the run is created, and
                         the message says which. Descriptions are chosen HERE,
                         at the start: "exodus video voices <run>" shows them at
                         the review but cannot change them.
  --auto-approve         (run) Deliberately unattended launch: every Checkpoint
                         box this run stops at is approved automatically, with
                         whatever it was holding left exactly as it is, and the
                         run record marks each stop as auto-approved so you can
                         see nobody looked. Default is to park and wait for a
                         person's verdict. This is a choice you make for ONE
                         launch — it is never a setting on the workflow itself.
  --wait                 Poll until the workflow run reaches a terminal status.
                         A video workflow's storyboard gate and final watch END
                         the wait too (exit 0): the run is parked on a decision
                         only you can make, so the command prints the same
                         "Parked: …" block and next commands "exodus video
                         status" prints. A Checkpoint / repair / slots park
                         prints its pause notice once and keeps polling so a
                         resolve from another shell carries the run on.
                         (checkpoint retry) Re-runs the step feeding the
                         Checkpoint box and waits until its fresh output is
                         ready and the run parks again — that IS its finish
                         line; a redo never runs the workflow to completion.
  --id <runId>           (status) One run's full detail. LEAVE IT OFF and status
                         prints the brand's recent runs instead — workflow name,
                         status, when it started, and the run id — which is how
                         you find the id of a run that started in the background
                         (a trigger fired it, or a promoted winner did) and
                         never stopped to ask you anything.
  --out <file>           Write the export to a file instead of stdout
  --out <dir>            (run --wait / status --id) Save every delivered output
                         of the finished run into this directory (created if
                         missing) and print the paths — text as .md, storyboards
                         and frame sets as .json, images/video/audio downloaded.
                         Unfulfilled slots are reported, never written.
  --version <n>          (export) Export a saved historical version instead of the
                         current head. <n> is the real 1-based version id from
                         "workflow versions" (a positive integer). A version
                         export intentionally carries NO triggers/description —
                         those aren't versioned, so a rollback leaves them
                         unchanged; head exports remain the only place triggers
                         appear.
  --json                 (export) Emit the legacy JSON contract body instead of
                         the default canonical YAML (escape hatch for tools that
                         still parse the old JSON export byte-for-byte)
  --update <workflowId>  (import/validate) Update this existing workflow in place
                         instead of creating a new one. Sends the contract's
                         updatedAt as an optimistic-concurrency guard — if it
                         409s, re-export the workflow, reapply edits, and retry.
  --dry-run              Preview import (validate + resolve refs) without writing.
                         Same server-side check as "workflow validate <file>" —
                         use validate as the standalone front door.
  --text "..."           (triggers fire) The input an EVENT trigger's run carries.
                         Required for event triggers; rejected for cron triggers.
                         (checkpoint edit) The replacement copy for one output.
  --file <path>          (checkpoint edit) Load the replacement copy from a file.
  --reason "..."         (cancel, checkpoint cancel) Optional reason recorded on
                         the cancel, so the run's history says why it stopped.
  --note "..."           (checkpoint retry) Optional correction for the redo
                         ("make the hook punchier"). Steps that call a model
                         follow it on the re-run; deterministic steps only
                         record it on the run's review trail.
  --reject <n[,n..]>     (checkpoint approve) Only for a Checkpoint box that is
                         reviewing a Splitter fan-out item by item. Drops those
                         ITEM numbers (the "Item N of M" headings in the show
                         listing, 1-based) and approves the rest. Rejecting is
                         filtering, not failing — the run carries on with the
                         survivors. Rejecting every item is refused: cancel
                         instead.
  --slot key=value       (answer) Repeatable. One answer per pending slot.
  --kind <kind>          (schema) Print just one node kind's ports + config rules
  --face <face>          (schema) Print just one transform face's spec

Examples:
  exodus workflow describe "Launch Flow"
  exodus workflow bots
  exodus workflow bots --category writing
  exodus workflow bots --slug new-hook-bot
  exodus workflow templates
  exodus workflow templates export complete-ad-set --out my.yaml
  exodus workflow schema
  exodus workflow schema --kind transform
  exodus workflow schema --kind splitter
  exodus workflow schema --kind collector
  exodus workflow schema --kind checkpoint
  exodus workflow schema --face collector
  exodus workflow run "Launch Flow" --input brief="new offer" --wait
  exodus workflow run "Launch Flow" --input brief=@brief.txt
  exodus workflow run "Product Shots" --input hero=./photos/hero.png --wait
  exodus workflow run "Product Shots" --input hero=https://example.com/hero.png
  exodus workflow run "Launch Flow" --fill "Weekly promo" --wait
  exodus workflow run "Launch Flow" --fill "Weekly promo" --input brief="new offer"
  exodus workflow run "Launch Flow" --auto-approve --wait
  exodus workflow run "Product Shots" --rig-overrides '{"rig_1":{"lines":{"line_1":{"count":3}}}}'
  exodus workflow run "Product Shots" --rig-overrides @rig.json --wait
  exodus workflow run "Podcast Ad" --input script=@script.txt --voices @voices.json --wait
  exodus workflow run "Podcast Ad" --input script=@script.txt --voice-treatment @voice-treatment.json --wait
  exodus workflow run "Launch Flow" --wait --out ./deliverables
  exodus workflow status                      # recent runs + their ids
  exodus workflow status --id wr_123
  exodus workflow status --id wr_123 --out ./deliverables
  exodus workflow cancel wr_123 --reason "wrong brief"
  exodus workflow versions "Launch Flow"
  exodus workflow export "Launch Flow" --out workflow.yaml
  exodus workflow export "Launch Flow" --version 3 --out v3.yaml
  exodus workflow export "Launch Flow" --json --out workflow.json
  exodus workflow validate my.yaml
  exodus workflow import workflow.yaml --dry-run
  exodus workflow import workflow.json --update wf_123
  exodus workflow triggers "Winner Flywheel"
  exodus workflow triggers "Winner Flywheel" enable 1
  exodus workflow triggers "Winner Flywheel" fire 1 --text "new offer" --wait
  exodus workflow inbox
  exodus workflow checkpoint wr_123
  exodus workflow checkpoint wr_123 edit 1 --text "tighter opener"
  exodus workflow checkpoint wr_123 approve --wait
  exodus workflow checkpoint wr_123 approve --reject 2,5 --wait
  exodus workflow checkpoint wr_123 retry --note "make the hook punchier" --wait
  exodus workflow checkpoint wr_123 cancel --reason "wrong direction"
  exodus workflow repair wr_123 retry --wait
  exodus workflow answer wr_123 --slot tone=casual --slot length=short

  # Diff two saved versions:
  exodus workflow export X --version 3 --out v3.yaml && exodus workflow export X --version 5 --out v5.yaml && diff v3.yaml v5.yaml
  # Roll a workflow back to an earlier version:
  exodus workflow export X --version 3 --out v3.yaml && exodus workflow import v3.yaml --update <id>

Notes:
  workflow describe prints the ENTRY CONTRACT — every input the workflow asks
  for, whether it's required or optional, the shape it accepts (a dropdown and
  its choices, a number, a true/false toggle; a plain text box shows no tag),
  and the author's help text. Supply those keys with --input; a value the
  contract can't accept is rejected before the run starts, naming the field.
  It also prints the EXIT contract under "Delivers" — the named results a
  finished run hands back, in the author's order: the slot's label, its key (the
  name --out files and a webhook key off), what kind of thing it is (text /
  structured data / file / set of files), and the author's note. A workflow with
  no Output node says so plainly ("Delivers: nothing — no Output node."), and
  "workflow run" repeats that as a warning before it spends the run. Against a
  backend too old to report deliveries the section is omitted entirely.
  "workflow run --fill <name>" launches from a saved fill instead of typing the
  inputs again — the fill's values fill the contract, and any --input you pass
  alongside it overrides just that key.
  Cold-start is a template, not a blank file: "workflow templates" lists the
  starters (incl. Winner Flywheel), "workflow templates export <key> --out f.yaml"
  writes the server-rendered YAML verbatim — edit it, then "workflow import f.yaml".
  "workflow schema" prints the LIVE graph vocabulary (node kinds, ports, config
  rules, transform faces, collector policy, wiring rules) from the backend you're
  deployed against, so what you author matches what will validate; --kind/--face
  narrow it, --json is the machine payload. "workflow validate <file>" checks a
  file against the live backend (it IS import --dry-run under its own door).
  "workflow run --rig-overrides" re-aims an Image Rig box for ONE run without
  touching the saved workflow: how many images a line fires, which meme format,
  which model. Node ids and line keys come from "workflow export" (or the box's
  panel in the app); anything you name that isn't there stops the launch and the
  message says which key was wrong. A trigger can carry the same payload in its
  YAML ("imageRigOverrides:" beside its schedule), so a Monday schedule and a
  Friday one can fire the same workflow at different sizes. A trigger can carry
  "voices:" the same way — the same map "workflow run --voices" takes — so a run
  that starts on a schedule arrives at the storyboard already voiced.
  "workflow run --voices" hands a video run its voices at the start, so a brand
  that always uses the same hosts stops choosing them by hand on every run. The
  file is keyed by the names the script uses for its speakers, because that is
  all that exists before the planner has run — it is the SAME voices.json
  "exodus video voices <run> --from" reads at the storyboard review, so one file
  per brand serves both moments. A speaker the script does not have, the same
  speaker named twice, or a voice ElevenLabs does not have stops the launch
  before the run exists and nothing is spent. When the storyboard is planned,
  each named speaker's character already has their voice, and "exodus video
  voices <run>" shows them set. A workflow whose script is written by a bot has
  no speaker names to key on at the start, so it is refused with a pointer at
  the review-time command. Keep voice ids in the brand's own folder, never in a
  shared workflow or template. (#1846)
  "workflow run --voice-treatment" says HOW a run makes its voices. Some ways of
  working play a voice you picked (that is today's behaviour, and it still takes
  --voices); others have the video model speak the CAST's lines itself, in voices
  you describe in words. A described voice needs one description per speaker,
  because a speaker nobody described gets a voice the model invents afresh on
  every clip, and the drift only shows up once the clips are paid for. Written
  voices and --voices are refused together, since the ElevenLabs voices would
  never be heard. Everything the run could not do — a way of working this stack
  has not switched on, a Video step whose model cannot do it, a missing key, a
  rig that shows every line as on-screen text — stops the launch before the run
  is created. The ways of working beyond the two shipped ones are switched on
  only on the test stack while they are being tried out, so a live run refuses
  them by name. Both the launch receipt and "workflow status" say which way a
  run took, and "exodus video voices <run>" shows each written voice. (#1869)
  workflow triggers are addressed by 1-based position — a trigger carries no id,
  so the CLI reads the live list from the export contract and sends a fingerprint
  of the trigger's fields as the guard; a concurrent edit fails loud rather than
  flipping the wrong trigger. Add or remove triggers by editing the YAML export.
  workflow export writes canonical YAML by default (human-diffable, key order
  fixed so equal workflows dump byte-identically); pass --json for the legacy
  JSON contract body. workflow import accepts either a YAML export or a legacy
  JSON file — same downstream, so YAML files work against the deployed API.
  workflow versions lists a workflow's saved history newest-first (up to 50);
  version numbers are real 1-based ids you pass to export --version. A version
  export intentionally carries NO triggers/description (they aren't versioned),
  so rolling back with import --update leaves them unchanged — head exports
  remain the only place triggers appear.
  workflow bots --json emits the FULL catalog response verbatim (--category /
  --slug filters are ignored in that mode). workflow bots --slug <slug> --json
  emits just that one bot's catalog JSON.
  workflow status with no --id lists the brand's recent runs — name, status,
  when it started, and the run id — and that list is the ONLY place a run that
  never stopped to ask you anything shows up. "workflow inbox" is a different
  list: it holds runs waiting on a person, so a background run whose workflow
  has no approval step finishes without ever appearing there. Take an id from
  the run list, then read it with "workflow status --id <runId>". (#933/#934)
  workflow cancel <runId> stops a run that has not finished — queued, running,
  or parked, all of it. The run stops for good and any child workflow it started
  is cancelled with it; a stop is also sent to the step still running, though
  that last part is best-effort. --reason records why on the run's history.
  A run that already finished is refused (nothing to cancel). The older
  "workflow checkpoint <runId> cancel" is the same action under its old name and
  keeps working. (#1231)
  workflow inbox lists every run parked waiting on you, badged by park kind
  (checkpoint/repair/slots/gate/legacy) and how it started (bg / trig:<event>).
  A run parked at a Checkpoint box is resolved with the "checkpoint" verbs: show
  what is waiting there, edit one output in place (edit 1 --text ...), approve
  (resume), retry (re-run the step feeding the box), or cancel. A Checkpoint is
  its own box on the canvas, sitting on a wire between two steps, so the diagram
  shows exactly where a run will stop. A require-all collector that stalled
  on a dead input is a "repair" park — retry it, skip the dead input, or kill the
  run. A run whose worker stopped partway is also a "repair" park, with nothing
  dead in it: retry carries it on from where it stopped and keeps every finished
  step, and skip is refused. (#3820) A nested sub-workflow waiting on inputs is a
  "slots" park — answer it with repeatable --slot key=value flags (run "answer"
  with no --slot to list the slot ids it wants). The "gate" verbs retired in 2.0 along with the Gate node — the
  command now prints a pointer at "checkpoint" and exits 1.
`.trim();

// ── Contract shapes (mirror convex/lib/workflow/importExport.ts) ─────────
// exodus builds standalone, so these cannot import convex/lib at runtime.
// __tests__/workflow.test.ts pins them with mutual assignment checks.

// Mirrors convex NODE_KINDS — #538 adds the Rig node and #539 adds the
// storyboard→media video kinds. Kept in lockstep so the mutual-assignment pins
// in __tests__/workflow.test.ts stay type-compatible with the widened convex
// contract.
export type WorkflowNodeKind =
  // #1072: the ONE-QUESTION input (titled "Input" in the app). The wire name
  // stays "brief" forever so every saved graph keeps loading.
  | "brief"
  // #1072: the real Brief — a multi-field intake FORM. Mirror of convex
  // NODE_KINDS. Each declared row is its own launch key, so the CLI keeps
  // addressing them exactly as it always has (`--input key=value`).
  | "brief-form"
  // The Asset Input node — mirror of convex NODE_KINDS. A source node whose
  // run-launch value is ONE uploaded file.
  | "asset"
  | "bot"
  | "primer"
  | "image"
  // #1004: the Image Rig — mirror of convex NODE_KINDS. The batch image door
  // (a firing plan of engine lines); distinct from the video/CASTS "rig" below.
  | "image-rig"
  | "rig"
  | "storyboard"
  | "reference"
  | "scene-frames"
  | "video"
  | "voiceover"
  | "output"
  // #1012: "push" and "gate" RETIRED in 2.0 — mirror of the same removal in
  // convex NODE_KINDS. Loops (bot config.loops) replaced Push; the Checkpoint
  // node ("checkpoint", below) replaced Gate.
  // #861 (MS-7): the Call node — mirror of convex NODE_KINDS.
  | "call"
  // #603 Video-module member-gate kinds (module templates only — the CLI
  // never authors them, but describe/export must round-trip them).
  | "show-set"
  | "show-cast"
  | "show-voices"
  | "product-truth"
  // #857 (MS-3): the Transform node — mirror of convex NODE_KINDS.
  | "transform"
  // #1001: the Formatter node — mirror of convex NODE_KINDS.
  | "formatter"
  // #1014: the Splitter node — mirror of convex NODE_KINDS.
  | "splitter"
  // #1020: the Collector node — mirror of convex NODE_KINDS. Closes a
  // Splitter's open fan back into one artifact. Name-collides on purpose with
  // the retired `collector` TRANSFORM FACE (the node replaces it).
  | "collector"
  // #1069: the Checkpoint node — mirror of convex NODE_KINDS. The
  // pause-for-approval as a box on a wire; it retires the per-node
  // `config.checkpoint` switch, which old graphs auto-convert away at every
  // door. (The `workflow checkpoint` verb cluster keys on the run's pauseReason
  // and is unchanged by this.)
  | "checkpoint"
  // #1073: the Prompt node — mirror of convex NODE_KINDS. "The prompt IS the
  // bot", promoted from a bot slug to a kind of its own: one provider call on
  // the workspace's own LLM key with the member's body, whose distinct
  // {{variable}} slots ARE its required input ports. It COEXISTS with the older
  // bot node carrying slug "prompt" — nothing is converted — so export/import
  // must round-trip both shapes.
  | "prompt";

/**
 * #861 (MS-7): a workflow's exposed input slot — mirror of convex/lib/workflow/
 * graph.ts WorkflowSlot. Kept in lockstep so an export/import round-trips slots.
 */
export type WorkflowSlotState = "locked" | "auto" | "ask" | "inferred";
export interface WorkflowSlot {
  id: string;
  label: string;
  state: WorkflowSlotState;
  nodeId: string;
  configKey: string;
  value?: string;
  hint?: string;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

/**
 * #862 (MS-8): a workflow's automatic trigger — mirror of convex/lib/workflow/
 * graph.ts WorkflowTrigger (a workflow PROPERTY, not a node). Kept in lockstep
 * so an export/import round-trips triggers.
 */
// The event vocabulary — mirror of convex WORKFLOW_TRIGGER_EVENTS. A literal
// union (not string) so the mutual-assignment pin holds; a new platform event
// is a one-line addition here in lockstep with the convex catalog.
export type WorkflowTriggerEvent = "winner-promoted";
// A trigger's two optional payloads. The CLI only carries them between the file
// and the server, which owns every rule about what is legal in them — but they
// are mirrored in full rather than left opaque, because the mutual-assignment
// pin below is what stops an export/import from silently dropping one.

/** Mirror of convex ImageRigLineOverride (#1084) — a per-run patch to ONE
 *  firing line, merged field-wise into the stored one. */
export interface ImageRigLineOverride {
  count?: number;
  aspects?: string[];
  adType?: string;
  style?: string;
  memeFormat?: string;
  steering?: string;
  copyPin?: string;
}

/** Mirror of convex ImageRigPlanOverride — a WHOLE-plan replacement. */
export interface ImageRigPlanOverride {
  lines?: unknown[];
  steering?: string;
  defaultAspects?: string[];
  defaultStyle?: string;
  model?: string;
  confirmLargeRun?: boolean;
}

/** Mirror of convex ImageRigNodeOverride — what one Image Rig node accepts. */
export interface ImageRigNodeOverride {
  plan?: ImageRigPlanOverride;
  lines?: Record<string, ImageRigLineOverride>;
  confirmLargeRun?: boolean;
  model?: string;
}

/** Mirror of convex ImageRigOverrides — one entry per Image Rig node re-aimed. */
export type ImageRigOverrides = Record<string, ImageRigNodeOverride>;

/** Mirror of convex VoiceRequest (#1863) — one launch voice as the STORED list
 *  holds it, keyed by the speaker name the run's own script declares. */
export interface VoiceRequest {
  who: string;
  choice: { kind: "pin"; voiceId: string; label?: string } | { kind: "clear" };
}

/** Mirror of convex TriggerVoiceMap — the same voices as a member AUTHORS them,
 *  identical to a voices.json: a string pins, an object pins with a label, null
 *  clears. */
export type TriggerVoiceMap = Record<
  string,
  string | { voiceId: string; label?: string } | null
>;

export type WorkflowTrigger =
  | {
      type: "event";
      event: WorkflowTriggerEvent;
      enabled: boolean;
      imageRigOverrides?: ImageRigOverrides;
      voices?: VoiceRequest[];
    }
  | {
      type: "cron";
      cron: string;
      enabled: boolean;
      imageRigOverrides?: ImageRigOverrides;
      voices?: VoiceRequest[];
    };

type WithoutVoices<T> = T extends unknown ? Omit<T, "voices"> : never;

/**
 * Mirror of convex WorkflowContractTrigger (#1863): a trigger AS IT READS IN A
 * CONTRACT file. Identical to the stored union except `voices`, which an export
 * writes — and a member authors — as the voices.json map, so a workflow file
 * reads like the voices file beside it.
 */
export type WorkflowContractTrigger = WithoutVoices<WorkflowTrigger> & {
  voices?: TriggerVoiceMap;
};

export interface WorkflowContractJson {
  contract: "exodus-workflow";
  version: number;
  /** Update anchors (#509) — present on exports; PURELY meta, not graph. */
  workflowId?: string;
  updatedAt?: string;
  name: string;
  description?: string;
  /** #861 (MS-7): exposed slots — optional, omitted when absent (mirror). */
  slots?: WorkflowSlot[];
  /** #862 (MS-8): triggers — optional, omitted when absent (mirror). In a FILE,
   *  so `voices` is the authored map (#1863), not the stored list. */
  triggers?: WorkflowContractTrigger[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface UnresolvedWorkflowRef {
  nodeId: string;
  ref: "persona" | "primer";
  value: string;
  message: string;
}

export interface WorkflowImportResult {
  name: string;
  created: boolean;
  workflowId?: string;
  nodeCount: number;
  edgeCount: number;
  // #921: the trigger set LIVE on the workflow after this import (in update mode
  // a contract that omits the key leaves the existing triggers, so this echoes
  // those). The CLI flags any ENABLED one — an import must never silently arm a
  // background-run rule. Optional ON THE TYPE only (deployed CLIs mirror this
  // interface and predate the field); importWorkflow always populates it.
  triggers?: WorkflowTrigger[];
  unresolved: UnresolvedWorkflowRef[];
  warnings: string[];
}

// ── Graph validation + import error mirrors (convex/lib/workflow/graph.ts +
//    importExport.ts). The dry-run/import surface hands these to an agent so it
//    can repair a contract without reading the validator source. ──────────────

export type GraphIssueCode =
  | "bad-shape"
  | "unknown-kind"
  | "duplicate-node-id"
  | "dangling-edge"
  | "unknown-port"
  | "type-mismatch"
  | "duplicate-input"
  // #1000: two launch inputs claim the same field name and at least one is an
  // Asset Input — the run-start binding rewrites that field into the frozen
  // upload payload, so a second reader of it would get JSON, not an asset id.
  | "duplicate-input-key"
  // (#1012 removed "session-fan-out" — no node kind consumes a session wire.)
  | "cycle"
  | "missing-required-input"
  | "bad-config"
  // #861 (MS-7): a defect in a workflow's exposed slot sheet.
  | "bad-slot"
  // #862 (MS-8): a malformed workflow trigger (unknown event / invalid cron).
  | "bad-trigger"
  // #1014: a Splitter with another Splitter upstream (no nested splits in v1).
  | "nested-split"
  | "fan-overlap"
  // #1014: a node downstream of a Splitter whose kind can't run once per item.
  | "lane-ineligible"
  // #1074: an Image Rig in a Splitter's OPEN fan whose COMBINED spend — the
  // Splitter's item cap × the rig's per-firing tally — busts the rig's caps
  // (50 images, or 200 with `confirmLargeRun`). A rig after a Collector fires
  // once for the whole fan and is unrestricted.
  | "fan-image-budget"
  // #1020: a Collector whose inputs don't all come from inside one Splitter's
  // open fan — it has nothing to close, or a stray wire arrived from outside
  // the fan (merging unrelated branches is a Formatter's job, not this one).
  | "collector-unpaired"
  // #1097: a structural Splitter AIMED at a field (config.sourceField) but fed
  // from a Formatter extract node's FIELD output port. That wire already
  // carries just that field's values, so there is no payload left to look a
  // field up in — clear the field name, or feed it one whole JSON payload.
  | "splitter-field-conflict"
  // #519: a wire into a brand-primer port with a Brief set to "swipe-ad" or
  // "swipe-bundle" anywhere on its upstream rail. Competitor ads are what the
  // swiper bots read FROM, never the brand's own voice, and running them
  // through the Primer Extractor/Summarizer does not launder them. Feed the
  // port a "summary" Primer (or the brand's own materials) and keep the swipe
  // Brief on the swipe port.
  | "competitor-source";

export interface GraphIssue {
  code: GraphIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
  /** The input/output port the defect is about, when it names one (#510). */
  portId?: string;
  /** Imperative, concrete remedy: the exact edit that fixes this issue (#510). */
  remedy?: string;
}

export type WorkflowImportErrorCode =
  | "invalid-graph"
  | "conflict"
  | "forbidden"
  | "not-found";

/** The Convex-side structured failure (importExport.ts) — mirrored for lockstep. */
export interface WorkflowImportError {
  code: WorkflowImportErrorCode;
  message: string;
  issues?: GraphIssue[];
  currentUpdatedAt?: string;
}

// ── Bot catalog mirrors (convex/lib/workflow/catalog.ts) ──────────────────────

// Mirrors convex PortType — #538 adds the Rig node's "rig" output, #539 adds
// the storyboard/frames/video/audio video wire types, and #603 adds the
// show-setup chain's "show" ordering wire.
export type WorkflowPortType =
  | "text"
  | "primer"
  | "image"
  | "rig"
  | "storyboard"
  | "frames"
  | "video"
  | "audio"
  // An uploaded document (Asset Input node) — its own wire type.
  | "document"
  | "show"
  // #855 (MS-1): the session handle wire (a session-mode Bot's output; no node
  // kind consumes it since #1012 retired Gate and Push).
  | "session";
export type WorkflowPrimerKind = "body" | "hook" | "headline" | "summary";

/** Mirror of convex videoModels.ts DurationSpec (catalog videoModels axis, #539). */
export type WorkflowDurationSpec =
  | { kind: "fixed"; values: number[] }
  | { kind: "range"; min: number; max: number };

/** Mirror of convex catalog.ts CatalogVideoModel (#539). */
export interface CatalogVideoModel {
  id: string;
  label: string;
  durations: WorkflowDurationSpec;
  audioTogglable: boolean;
  /** Per-model legal config.aspectRatio values (#892 — validator envelope). */
  aspectRatios: string[];
  /** Per-model legal config.resolution values (Kling's are modes std/pro). */
  resolutions: string[];
}
export type WorkflowParamKind =
  | "select"
  | "text"
  | "textarea"
  | "toggle"
  | "number"
  | "multiselect";

export interface CatalogInput {
  id: string;
  label: string;
  accepts: WorkflowPortType[];
  required: boolean;
  multi?: boolean;
  primerKinds?: WorkflowPrimerKind[];
}

export interface CatalogParam {
  key: string;
  label: string;
  kind: WorkflowParamKind;
  options?: string[];
  min?: number;
  max?: number;
  required?: boolean;
  help?: string;
  default?: string;
}

export interface CatalogBot {
  slug: string;
  name: string;
  blurb: string;
  category: string;
  categoryLabel: string;
  inputs: CatalogInput[];
  params: CatalogParam[];
  outputType: string;
}

export interface WorkflowCatalog {
  catalog: "exodus-workflow-catalog";
  version: 1;
  bots: CatalogBot[];
  vocabulary: {
    nodeKinds: string[];
    briefSources: string[];
    primerKinds: string[];
    /** #1258: the body kind's optional awareness lanes (config.primerAwareness). */
    primerAwarenessLanes: string[];
    imageModels: string[];
    aspectRatios: string[];
    imageQuantityModes: string[];
    videoModels: CatalogVideoModel[];
    categories: Array<{ id: string; label: string }>;
  };
  customBot: {
    slug: "custom";
    configKey: "customSlug";
    inputs: CatalogInput[];
    summaryOnlySlugs: string[];
    notes: string;
  };
  promptBot: {
    slug: "prompt";
    configKey: "promptText";
    inputs: CatalogInput[];
    notes: string;
  };
}

// ── Describe contract mirrors (convex/lib/workflow/describe.ts) ────────────────

export type WorkflowBriefSource =
  | "text"
  | "swipe-ad"
  | "swipe-bundle"
  | "organic-url"
  | "ad-url";

/** Mirror of convex graph.ts MEDIA_TYPES — an Asset Input node's file family. */
export type WorkflowMediaType = "image" | "video" | "audio" | "document";

/**
 * #1013: the widget/value shape a Brief declares — mirror of convex/lib/workflow/
 * graph.ts EntryFieldType. A literal union (not string) so the mutual-assignment
 * pin in __tests__/workflow.test.ts holds.
 */
export type WorkflowEntryFieldType =
  | "text"
  | "select"
  | "number"
  | "toggle"
  // #1150: a dropdown that takes SEVERAL answers. Its value is still ONE
  // string — the picks comma-joined — so `--input key=a,b` is the whole story
  // and nothing on the wire had to learn about lists.
  | "multi-select";

export interface WorkflowInputDescriptor {
  fieldName: string;
  nodeId: string;
  /**
   * #1072: the words a person reads beside the box, when the author wrote any.
   * The CLI stays KEY-addressed (`--input key=value`) — this only labels the
   * key when we print the field list. Omitted when unauthored, so a pre-#1072
   * describe payload renders exactly as before.
   */
  label?: string;
  /** "asset" = an uploaded file (an Asset Input node), not typed copy. */
  source: WorkflowBriefSource | "asset";
  required: boolean;
  description?: string;
  /**
   * #1013: the widget/value shape the launch doors enforce. Set only when it
   * isn't the plain "text" box, so a pre-#1013 describe payload is unchanged.
   */
  type?: WorkflowEntryFieldType;
  /** For type === "select"/"multi-select": the values the caller may pick. */
  options?: string[];
  /**
   * #1150: this dropdown's list is OPEN — an answer nobody listed is legal, so
   * `--input key=<anything non-blank>` passes the server's launch gate. Set
   * only when true; absent means a closed list.
   */
  allowOther?: boolean;
  /**
   * #1150: this dropdown's choices live in a workspace LIBRARY ("personas"
   * today), not in the graph. describe resolves the live rows into `options`
   * before it answers, so the printed choices are current names — this only
   * says where they came from, and that the server checks the answer against
   * the library at launch.
   */
  optionsSource?: string;
  bundleSize?: number;
  /** For source === "asset": which file family the upload must be. */
  assetType?: WorkflowMediaType;
}

export interface WorkflowPrerequisiteDescriptor {
  primerKind: WorkflowPrimerKind;
  nodeIds: string[];
}

export interface WorkflowOutputDescriptor {
  // #539: the Output collector accepts every deliverable type the pipeline can
  // produce (a `rig` output is plumbing and never collected). Mirror of
  // convex/lib/workflow/describe.ts WorkflowOutputDescriptor (pinned by
  // exodus/commands/__tests__/workflow.test.ts).
  type: "text" | "image" | "video" | "audio" | "document" | "frames" | "storyboard";
  label: string;
  nodeId: string;
  botSlug?: string;
  /** #855: the producing output port (e.g. "loop" on a Bot running Loops) — lets a
   *  consumer keep a multi-port node's deliverables apart. */
  port?: string;
}

/**
 * #1082 (Exit Contract in describe): ONE named delivery slot the workflow
 * PROMISES — the static counterpart to a run's WorkflowRunDelivery (which adds
 * whether the slot actually arrived). Mirror of the describe route's
 * `deliveries` entry.
 *
 * `type` reuses WorkflowOutputSlotType (declared with the run-side delivery
 * below) so the two stay one vocabulary.
 */
export interface WorkflowDeliveryDescriptor {
  /** Stable kebab slug — the name `--out` files and the webhook key off. */
  key: string;
  label: string;
  type: WorkflowOutputSlotType;
  /** The author's one-line note about what lands in this slot. */
  description?: string;
  /** 0-based presentation index. */
  order: number;
}

/** The describe HTTP response: the derived contract + this brand's stored flags. */
export interface WorkflowDescribeResponse {
  workflowId: string;
  name: string;
  description?: string;
  updatedAt: string;
  inputs: WorkflowInputDescriptor[];
  prerequisites: Array<WorkflowPrerequisiteDescriptor & { stored: boolean }>;
  outputs: WorkflowOutputDescriptor[];
  /**
   * #1082: the EXIT contract — the workflow's named delivery slots. OPTIONAL on
   * purpose: a published CLI binary talks to backends that predate the field, so
   * `undefined` means "this backend can't say" (render exactly as before) while
   * `[]` means "this workflow promises nothing" — two different facts that must
   * never collapse into one.
   */
  deliveries?: WorkflowDeliveryDescriptor[];
  /**
   * #518: plain-language sentences about the WORKFLOW ITSELF that a reader must
   * see before they read the contract below — today, exactly one: the graph
   * builds the brand primer out of competitor swipe material, which the run
   * doors refuse (#519).
   *
   * OPTIONAL for the same reason `deliveries` is: a published CLI binary talks
   * to backends that predate the field, so `undefined` means "this backend
   * can't say" (render exactly as before) while `[]` means "nothing to warn
   * about" — two different facts that must never collapse into one.
   */
  warnings?: string[];
}

// ── Template + schema on-ramp mirrors (#892) ──────────────────────────────

/**
 * One row of the templates list (GET /api/v2/workflows/templates). `module` is
 * present only on module-owned templates (e.g. "video"); the CLI badges those
 * and notes their runs start from the show surfaces. Contracts are omitted from
 * the list — fetch a single template's YAML/JSON with `?key=`.
 */
export interface WorkflowTemplateListItem {
  key: string;
  label: string;
  description: string;
  module?: string;
}

export interface WorkflowTemplatesResponse {
  templates: WorkflowTemplateListItem[];
}

// ── HTTP projections ─────────────────────────────────────────────────────

export interface WorkflowListItem {
  _id: string;
  name: string;
  description?: string;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
  // Cross-brand share (#523): set on a workflow surfaced at a NON-home brand —
  // a live reference the owner enabled here from another brand. Older backends
  // omit these fields, so both stay optional.
  isCrossBrand?: boolean;
  homeBrandName?: string | null;
}

export interface WorkflowListResponse {
  workflows: WorkflowListItem[];
}

/**
 * #894: one row of a workflow's saved-version history. `version` is a REAL,
 * 1-based identifier the server assigns on each save — NOT a display index, so
 * it is shown and passed to `export --version` unchanged.
 */
export interface WorkflowVersion {
  version: number;
  name: string;
  savedAt: string;
  savedByName?: string;
}

/** The versions HTTP response. Some wrappers return a bare array; handle both. */
export interface WorkflowVersionsResponse {
  versions: WorkflowVersion[];
}

// A workflow run's status, in EITHER vocabulary. #994 renamed the stored
// values (awaiting-review→awaiting-approval, completed→succeeded,
// partial→succeeded-with-warnings, canceled→cancelled), but a published CLI
// meets both old and new backends, so both forms stay assignable — and EVERY
// comparison in this file goes through normalizeRunStatus rather than testing a
// literal. #539's two extra states survive the rename: "awaiting-approval"
// (parked, waiting on a human — NONterminal) and "cancelled" (terminal).
export type WorkflowRunStatus =
  | RunStatus
  | (typeof LEGACY_WORKFLOW_RUN_STATUS_VALUES)[number];
export type WorkflowNodeRunStatus = "idle" | "running" | "done" | "failed" | "skipped";

/**
 * #1014: an artifact's LANE IDENTITY — which item of a Splitter's fan-out it
 * belongs to. `index` is 0-based; `total` is the item count stamped when the
 * item was emitted, so "Item 3 of 7" needs no second lookup. Absent on every
 * artifact from an ordinary (un-fanned) node — that absence is exactly how the
 * runner knows to execute a node once instead of once per item.
 */
export interface ArtifactItemIdentity {
  index: number;
  total: number;
}

export type WorkflowArtifact =
  // #891: a retired Gate node's selection-port candidates were text
  // artifacts carrying `port: "selection"`; `humanEdited` flips once a reviewer
  // hand-edits one. Both optional so non-gate text artifacts stay shape-compatible.
  | {
      type: "text";
      text: string;
      label?: string;
      port?: string;
      humanEdited?: boolean;
      item?: ArtifactItemIdentity;
    }
  | { type: "primer"; text: string; primerKind: string; item?: ArtifactItemIdentity }
  | { type: "image"; storageId: string; imageUrl?: string; item?: ArtifactItemIdentity }
  // #855 (MS-1) / #926: a session handle recorded on a session-mode Bot's
  // outputs (port "session"). Read-only since #1012 retired the two node kinds
  // that consumed session wires — it deep-links the chat surface (mirror of
  // convex graph.ts).
  | {
      type: "session";
      sessionId: string;
      label?: string;
      port?: string;
      item?: ArtifactItemIdentity;
    };

/**
 * A FINAL deliverable (#508): a producing node's artifact wired into the Output
 * collector, flattened to the top level of the run so an agent can chain a run's
 * results without re-deriving the graph. Text carries the full chaining surface.
 */
export interface WorkflowRunOutput {
  nodeId: string;
  botSlug?: string;
  type: "text" | "image" | "video" | "audio" | "document" | "frames" | "storyboard";
  label: string;
  text?: string;
  imageUrl?: string;
  imageId?: string;
  // #539 video pipeline deliverables — kept in lockstep with the canonical
  // convex/workflows.ts WorkflowRunOutputEntry (see the assignability guards in
  // exodus/commands/__tests__/workflow.test.ts).
  videoUrl?: string;
  audioUrl?: string;
  durationSec?: number;
  sceneIndex?: number;
  // True on the stitched final ad video (#550) — distinguishes it from clips.
  final?: boolean;
  // #1747: the word timings the artifact itself carries (a clip's own dialogue
  // or a narration track's), seconds from the start of that media.
  words?: Array<{ w: string; s: number; e: number }>;
  frames?: Array<{ sceneIndex: number; imageUrl?: string }>;
  storyboardJson?: string;
  // An uploaded document passed straight through from an Asset Input node.
  documentUrl?: string;
  filename?: string;
  mimeType?: string;
  // #1078: what the MACHINE made, when a member changed this artifact at a
  // review stop. Present only on a hand-changed deliverable, so an untouched
  // run's payload is byte-identical to what it always shipped.
  humanEdited?: boolean;
  originalText?: string;
  originalImageUrl?: string;
  originalVideoUrl?: string;
}

/**
 * #1002: the delivery type of one Output slot — what KIND of result it promises.
 * Mirror of convex/lib/workflow/graph.ts OutputSlotType.
 */
export type WorkflowOutputSlotType = "text" | "structured" | "asset" | "collection";

/**
 * #1002 (Exit Contract): ONE promised result of a run — an Output node's named,
 * typed delivery slot, plus whether it actually arrived.
 *
 * `outputs` above is a flat bag of everything that reached any Output collector;
 * this is the workflow's exit CONTRACT answered slot by slot, so the CLI can say
 * what is missing (`unfulfilled`, with the producing node's error) and not just
 * what showed up. Kept in lockstep with the canonical convex/workflows.ts
 * WorkflowRunDelivery (see the assignability guards in
 * exodus/commands/__tests__/workflow.test.ts).
 */
export interface WorkflowRunDelivery {
  key: string;
  label: string;
  type: WorkflowOutputSlotType;
  description?: string;
  order: number;
  /** The Output node that owns this slot (not the producing node). */
  nodeId: string;
  status: "delivered" | "unfulfilled";
  error?: string;
  artifacts: WorkflowRunOutput[];
}

export interface WorkflowRunNode {
  nodeId: string;
  kind: string;
  /** The Genesis bot a Bot node ran (server-provided); absent on other kinds. */
  botSlug?: string;
  status: WorkflowNodeRunStatus;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  outputs: WorkflowArtifact[];
}

export interface WorkflowCounts {
  done: number;
  failed: number;
  skipped: number;
  total: number;
}

/**
 * #893: a chat session spun up by a session-mode Bot during this run. The
 * status surface lists these so an operator/agent can continue the conversation
 * with `exodus session chat`. Optional — older backends omit the field.
 */
export interface WorkflowRunSession {
  sessionId: string;
  nodeId: string;
  title: string;
  botSlug: string;
}

/**
 * #891: WHY a run parked. "taste" = a LEGACY park at the retired Gate node
 * (#1012 — nothing emits it now, but frozen runs carry it and the CLI still has
 * to say something honest about them); "repair" = a require-all collector stalled
 * on a dead input; "slots" = a nested child awaiting the member's slot answers;
 * "call" = a parent parked on a child (never actionable, filtered out of the
 * inbox). Absent on legacy video cost-gate parks.
 * #998 adds "checkpoint": the run has reached a Checkpoint box and is holding
 * there for the member's approve / edit / retry / cancel — the `workflow
 * checkpoint` cluster. (#1069 turned the pause-for-approval into that dedicated
 * box, sitting on a wire between two steps; it used to be a per-node switch.
 * The reason word on the wire never changed, so both park shapes — a frozen run
 * from before the change, and a new one — resolve through the same verbs.)
 */
export type WorkflowPauseReason =
  | "taste"
  | "repair"
  | "slots"
  | "call"
  | "checkpoint";

/**
 * #891: a slot a "slots"-parked run awaits — mirror of convex
 * workflows.ts PendingSlot. Only `id` is load-bearing for the CLI answer verb.
 */
export interface WorkflowPendingSlot {
  id: string;
  label?: string;
  state?: string;
  nodeId?: string;
  configKey?: string;
  value?: string;
  hint?: string;
}

/**
 * #1869 — whose saved format rules a run followed. The server's member-safe
 * projection (convex/lib/workflow/runProvenance.ts), mirrored here because the
 * CLI builds standalone; the mirror is pinned to the original by a compile-time
 * assignment in exodus/__tests__/workflow.test.ts.
 *
 * Every field is optional to READ: a backend older than #1869 sends no
 * provenance at all, and the CLI then prints nothing about the rules.
 */
export interface RunFormatProvenance {
  via: "show" | "rig-node";
  nodeId?: string;
  rigId: string;
  rigName: string;
  rulesFrom?: { rigId: string; rigName: string };
  specVersion: string | null;
}

/**
 * #1869 — how a run makes its voices, and who decided. A Show decided at setup;
 * a Show-less launch decided when it started. `unreadable` means the stamp on
 * the run is damaged, which is printed rather than hidden: such a run renders
 * nothing and the member should hear why.
 */
export type VoicePath =
  | "sts-revoice"
  | "lipsync-retarget"
  | "native-prompt"
  | "omni-audio-ids"
  | "gemini-direct"
  | "voice-first";

export type RunVoiceProvenance =
  | { source: "show"; path: VoicePath }
  | {
      source: "launch";
      path: VoicePath;
      descriptions: { speaker: string; description: string }[];
    }
  | { source: "unreadable" };

export interface RunProvenance {
  format: RunFormatProvenance | null;
  voice: RunVoiceProvenance | null;
}

/**
 * The one sentence every surface says about a run's format rules — the launch
 * receipt, `workflow status` and the pull manifest's human line. Read
 * defensively: whatever the backend sends that is not this shape prints nothing
 * at all, which is what an older backend sends.
 */
export function formatRulesLine(provenance: unknown): string | undefined {
  const format = (provenance as RunProvenance | undefined)?.format;
  if (!format || typeof format !== "object") return undefined;
  const { rigName, specVersion, nodeId, rulesFrom } = format;
  if (typeof rigName !== "string" || rigName === "") return undefined;
  const version =
    typeof specVersion === "string" && specVersion !== ""
      ? `, version ${specVersion}`
      : "";
  const where =
    typeof nodeId === "string" && nodeId !== ""
      ? ` (from the "${nodeId}" Rig box)`
      : " (from the Show's rig)";
  const borrowed =
    rulesFrom && typeof rulesFrom.rigName === "string"
      ? ` The rules come from "${rulesFrom.rigName}".`
      : "";
  return `Format rules: ${rigName}${version}${where}.${borrowed}`;
}

export interface WorkflowRun {
  _id: string;
  workflowId: string;
  workflowName: string;
  /**
   * #1347: the run's OWN name, and the module face that launched it. All
   * three already ride `projectRun`, conditionally — the CLI simply never
   * declared them. Every run of the hidden "+ New → Copy" face shares one
   * `workflowName`, so without them this screen lists them all under the same
   * word. Optional for deploy skew as much as for absence: an older backend
   * sends none of them, and the naming rules fall back to `workflowName`.
   */
  runTitle?: string;
  title?: string;
  moduleKey?: string;
  status: WorkflowRunStatus;
  error?: string;
  counts?: WorkflowCounts;
  inputs: Record<string, string>;
  triggerRunId?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  isTerminal: boolean;
  nodes: WorkflowRunNode[];
  /** Flattened final deliverables (#508) — present on the run-detail response. */
  outputs?: WorkflowRunOutput[];
  /**
   * #1002: the run's named, typed delivery slots. Optional — an older backend
   * omits the field entirely, so every render must tolerate its absence.
   */
  deliveries?: WorkflowRunDelivery[];
  /**
   * #1261: the COUNTED twin of `deliveries` — how many of the run's promised
   * slots arrived. The recent-runs LIST gets this instead of the full contract
   * (a list must never ship every run's artifacts), and it is exactly what the
   * shared verdict needs, so the list and the detail reach the same word.
   * Absent on the run detail (which carries `deliveries` itself) and on any
   * backend older than #1261 — absent means "can't say", never "nothing".
   */
  deliverySummary?: RunDeliverySummary;
  /** #893: chat sessions this run opened (session-mode bots). */
  sessions?: WorkflowRunSession[];
  // #891: the park surface. Present on a parked run-detail; the
  // checkpoint/repair/answer verbs preflight against these.
  pauseReason?: WorkflowPauseReason;
  pausedNodeId?: string;
  pendingSlots?: WorkflowPendingSlot[];
  /**
   * #1079: the checkpoint stops a `--auto-approve` launch released with nobody
   * looking, in release order. Optional — absent on every ordinary run and on
   * older backends that predate the flag.
   */
  autoApprovals?: { nodeId: string; approvedAt: number }[];
  /**
   * #1869: whose saved format rules this run followed. Absent when it followed
   * none, and on every backend older than #1869.
   */
  provenance?: RunProvenance;
  /**
   * #1883: the approval stop this run is still headed for. The server owns the
   * whole predicate, so absence is the wire shape of a run that is already
   * parked there, one that was approved, a terminal run, a run nothing will
   * stop (#1893 d: neither the author's gate switch nor the direction fence),
   * a board whose worker recorded no fence verdict, and every backend older
   * than #1883. A promise is therefore worth acting on and silence is not
   * worth reading anything into. `after` says what has been rendered by the
   * time it parks: "frames" means the cheap pictures came first, "storyboard"
   * means nothing was drawn yet. `selfApproves` (#2587): a paste-a-script run
   * checks its own storyboard at that stop and goes on by itself when every
   * check passes, so it only truly pauses when one fails. Absent on runs that
   * wait for a click, and on every backend older than #2587.
   */
  pauseAhead?: { nodeId: string; after: "frames" | "storyboard"; selfApproves?: true };
}

/** #1883: the one sentence both status commands say about a coming pause. */
export function pauseAheadLine(ahead: NonNullable<WorkflowRun["pauseAhead"]>): string {
  if (ahead.after === "frames" && ahead.selfApproves) {
    return "When the frames are ready, the app checks the storyboard and approves it itself if the checks pass, then goes on to the voices and clips. It only stops for your approval if a check finds a problem. The reference, cast and scene pictures are made first (a few cents each).";
  }
  return ahead.after === "frames"
    ? "This run will pause for your approval once the frames are ready. The reference, cast and scene pictures are made first (a few cents each). Nothing bigger is spent until you approve."
    : "This run will pause for your approval once the storyboard is written. Nothing is spent on pictures, voices or clips until you approve.";
}

export type WorkflowRunProjection = Omit<WorkflowRun, "nodes"> & { nodes?: never };

interface WorkflowRunStartResponse {
  runId: string;
  triggerRunId: string;
  /**
   * #1082: additive, optional server-side heads-ups about the run that just
   * launched. The CLI's own describe pre-check is the primary mechanism (it
   * works against backends that never send this), so anything here that repeats
   * a warning already said is dropped — see serverWarningsToPrint.
   */
  warnings?: string[];
  /**
   * #1846: the voices the server actually attached to this run, echoed back so
   * the launch receipt can say them. An array (not a map) because a speaker
   * name is free text and need not be ASCII.
   */
  launchVoices?: Array<{ speaker: string; voiceId: string; label?: string }>;
  /**
   * #1869: the saved format rules this run froze, and anything worth knowing
   * about the run that started — never a reason it didn't. Both absent on a run
   * that froze no rules, and on every backend older than #1869.
   */
  format?: RunFormatProvenance;
  /**
   * #1869: how this run makes its voices, echoed back off the row it froze so
   * the receipt can never describe a treatment the run did not actually take.
   * Absent on a run started without one, and on every backend older than #1869.
   */
  voice?: RunVoiceProvenance;
  advisories?: string[];
}

export interface WorkflowRunDeps {
  get: (path: string) => Promise<ApiResponse<unknown>>;
  // Raw-text GET (#892): preserves a non-JSON body byte-for-byte — the seam the
  // `templates export` verb uses so server-rendered YAML is written verbatim.
  getText: (path: string) => Promise<ApiResponse<string>>;
  post: (path: string, body: unknown) => Promise<ApiResponse<unknown>>;
  readFile: (path: string) => string;
  writeFile: (path: string, text: string) => void;
  poll: (opts: PollOptions) => Promise<PollResult>;
  // #1002 (`--out <dir>`): the two seams delivery-file saving needs beyond
  // writeFile — creating the target directory, and pulling an asset off its
  // storage URL onto disk. Optional so existing test deps stay valid; the real
  // fs/fetch implementations below are the fallback when a caller omits them.
  mkdirp?: (dir: string) => void;
  downloadToFile?: (url: string, path: string) => Promise<void>;
  // The Next.js dashboard chat route seam (like `session chat`). Optional, and
  // currently unused by the workflow verbs — its one consumer was the retired
  // Gate node's "push" step-1 (#1012). Kept so `session`-shaped deps stay
  // interchangeable and existing test deps stay valid.
  postDashboard?: (
    path: string,
    body: unknown,
    opts?: { timeoutMs?: number },
  ) => Promise<ApiResponse<unknown>>;
  // The dashboard base URL for the "resolve in the app" pause pointer + reject
  // fallbacks. Optional: waitForRun falls back to resolving it from the API URL.
  dashboardUrl?: string;
  // ── Asset Input file uploads (Stage 3B) ────────────────────────────────
  // Three optional seams so `--input hero=./photo.png` can push real bytes and
  // still be testable with plain fakes. Optional so existing deps stay valid;
  // when they're absent the CLI degrades to passing the value through (an
  // asset id) rather than pretending it uploaded something.
  /** Stat a local file. Returns null when there is no such FILE (dir included). */
  statFile?: (filePath: string) => { size: number } | null;
  /** Read a local file's RAW bytes — asset uploads are binary, never utf-8. */
  readFileBytes?: (filePath: string) => Uint8Array;
  /** POST raw bytes to a minted Convex upload URL; resolves the storage id. */
  uploadBytes?: (
    uploadUrl: string,
    contentType: string,
    bytes: Uint8Array,
  ) => Promise<{ ok: boolean; status: number; storageId?: string; body?: string }>;
}

export interface FlowResult {
  code: number;
  lines: string[];
}

interface RunFlowOptions {
  inputs: Record<string, string>;
  // #1259: no scoping option lives here any more. #860's `terminalNodeIds`
  // (run only the upstream closure of some end nodes) was repealed by #1222 —
  // a run now executes the whole workflow or it doesn't start — so the CLI no
  // longer has a partial-run payload to send. `--terminal` is refused before
  // any request is made (rejectTerminalFlag).
  /**
   * #1013: the NAME of a saved fill on this brand's copy of the workflow. The
   * server loads its stored values as the launch payload; anything in `inputs`
   * still wins key-by-key. Blank/undefined sends no fill (unchanged behavior).
   */
  fill?: string;
  /**
   * #1079: launch this ONE run unattended — the server auto-approves every
   * Checkpoint the run reaches, artifact unchanged, instead of parking for a
   * human. Per-launch only: it is never stored on the workflow, so undefined /
   * false is the ordinary park-and-wait run and sends nothing at all.
   */
  autoApprove?: boolean;
  /**
   * #1084 (F2): re-aim this ONE run's Image Rig boxes — more images, a different
   * meme format, a different model — without editing the saved workflow. Already
   * parsed from `--rig-overrides` (JSON or @file) by the time it lands here;
   * undefined sends nothing at all, so an ordinary run's body is unchanged.
   */
  imageRigOverrides?: Record<string, unknown>;
  /**
   * #1846: the voices this run starts with, keyed by the script's speaker names
   * (the planner's C1/C2 ids don't exist yet at launch). Already parsed from
   * `--voices` (JSON or @file) by the time it lands here; undefined sends
   * nothing at all, so an ordinary run's body is unchanged.
   */
  voices?: VoiceMap;
  /**
   * #1869: HOW this run makes its voices, and on the describing paths what each
   * speaker should sound like. Already parsed from `--voice-treatment` (a bare
   * path name, JSON, or @file) by the time it lands here; undefined sends
   * nothing at all, so an ordinary run's body is unchanged.
   */
  voiceTreatment?: VoiceTreatmentBody;
  wait: boolean;
  json: boolean;
  // #1002: with --wait, save the terminal run's delivered outputs into this dir.
  out?: string;
  onProgressLine?: (line: string) => void;
  /**
   * #1082: where pre-launch heads-ups go. STDERR in the real CLI, so they show
   * up in --json mode too without ever landing inside the JSON on stdout. Never
   * blocking — a warning is said and the run launches anyway.
   */
  onWarningLine?: (line: string) => void;
}

const LIST_PATH = "/api/v2/workflows";
const RUN_PATH = "/api/v2/workflows/run";
const STATUS_PATH = "/api/v2/workflow";
const EXPORT_PATH = "/api/v2/workflows/export";
const IMPORT_PATH = "/api/v2/workflows/import";
const DESCRIBE_PATH = "/api/v2/workflows/describe";
// Asset Input uploads (Stage 3B): mint an upload URL, then register the stored
// blob. The register call answers with the assetId a run's `inputs` carries for
// that field — the CLI never sends a raw storage id to the run route.
const ASSET_UPLOAD_URL_PATH = "/api/v2/workflows/asset-upload-url";
const ASSETS_PATH = "/api/v2/workflows/assets";
const CATALOG_PATH = "/api/v2/workflows/catalog";
// #893 (MS-8 triggers): set-enabled + fire. LIST reads the export contract's
// `.triggers` (describe doesn't carry them) — so no separate list path here.
const TRIGGERS_SET_ENABLED_PATH = "/api/v2/workflows/triggers/set-enabled";
const TRIGGERS_FIRE_PATH = "/api/v2/workflows/triggers/fire";
// #892 authoring on-ramps: two new pure-read routes.
const TEMPLATES_PATH = "/api/v2/workflows/templates";
const SCHEMA_PATH = "/api/v2/workflows/schema";
// #894: version history (up to 50, newest-first) + versioned export.
const VERSIONS_PATH = "/api/v2/workflows/versions";
const VERSIONS_CAP = 50;
// #891: the review inbox + approve/repair/answer action routes. (#1012: the
// three /workflow/gate/* routes retired with the Gate node — the server answers
// them 410 with a pointer at the checkpoint verbs.)
const INBOX_PATH = "/api/v2/workflow/inbox";
const APPROVE_PATH = "/api/v2/workflow/approve";
const CANCEL_PATH = "/api/v2/workflow/cancel";
const ANSWER_PATH = "/api/v2/workflow/answer";
const REPAIR_RETRY_PATH = "/api/v2/workflow/repair/retry";
const REPAIR_SKIP_PATH = "/api/v2/workflow/repair/skip";
// #998 (checkpoint cluster): the two NEW routes. Approve and cancel reuse
// APPROVE_PATH / CANCEL_PATH unchanged — a checkpoint park resolves through the
// same doors every other park does.
const CHECKPOINT_RETRY_PATH = "/api/v2/workflow/checkpoint/retry";
const CHECKPOINT_EDIT_PATH = "/api/v2/workflow/checkpoint/edit";
// #1014: per-item resolution of a checkpoint that is reviewing a Splitter
// fan-out. Only `approve --reject` uses it; a plain approve still goes through
// APPROVE_PATH, so nothing changes for a checkpoint with no items.
const CHECKPOINT_RESOLVE_ITEMS_PATH = "/api/v2/workflow/checkpoint/resolve-items";
// The run page in the web app — the "resolve in the app" pointer target.
const RUN_PAGE_PREFIX = "/runs/";

const VALUE_FLAGS = new Set([
  "id",
  "input",
  "out",
  "category",
  "slug",
  "update",
  // #1259: --terminal is REFUSED now (partial runs were repealed by #1222), but
  // it stays listed here so parsePositional still skips its value — otherwise
  // `run --terminal out-a "Flow"` would read "out-a" as the workflow name and
  // complain about the wrong thing instead of naming the dead flag.
  "terminal",
  // #1013: `workflow run <ref> --fill <name>` takes a saved fill's name.
  "fill",
  // #893: `workflow triggers <ref> fire --text "..."` takes a value.
  "text",
  // #892: schema section filters.
  "kind",
  "face",
  "version",
  // #891: value-taking flags on the checkpoint/repair/answer verbs, so
  // parsePositional skips their values when extracting positionals.
  "file",
  "reason",
  "slot",
  // #1014: `workflow checkpoint <runId> approve --reject 2,5` takes a value.
  "reject",
  // #1084 (F2): `workflow run <ref> --rig-overrides <json|@file>` takes a value.
  "rig-overrides",
  // #1846: `workflow run <ref> --voices <json|@voices.json>` takes a value.
  "voices",
  // #1869: `workflow run <ref> --voice-treatment <path|json|@file>` takes one.
  "voice-treatment",
  // #1144: `workflow checkpoint <runId> retry --note "..."` takes a value.
  "note",
]);

/** #1002: `mkdir -p` for the `--out <dir>` target. */
function defaultMkdirp(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * #1002: pull one asset (image/video/audio) off its resolved storage URL onto
 * disk. Buffered rather than streamed — deliverables are ad-sized, and a whole
 * buffer keeps a failed fetch from leaving a half-written file behind.
 */
async function defaultDownloadToFile(url: string, path: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path, buf);
}

const defaultDeps: WorkflowRunDeps = {
  get: (path) => apiGet<unknown>(path),
  getText: (path) => apiGetText(path),
  post: (path, body) => apiPost<unknown>(path, body),
  readFile: (path) => fs.readFileSync(path, "utf-8"),
  writeFile: (path, text) => fs.writeFileSync(path, text, "utf-8"),
  poll: (opts) => pollUntilDone(opts),
  mkdirp: defaultMkdirp,
  downloadToFile: defaultDownloadToFile,
  postDashboard: (path, body, opts) => apiPostDashboard<unknown>(path, body, opts),
  // getDashboardUrl honors an explicit EXODUS_DASHBOARD_URL override before the
  // API-URL auto-derive — the same target apiPostDashboard actually hits.
  dashboardUrl: getDashboardUrl(),
  statFile: (filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() ? { size: stat.size } : null;
    } catch {
      return null;
    }
  },
  readFileBytes: (filePath) => fs.readFileSync(filePath),
  // Same shape as the winners import upload (commands/winners.ts): a plain POST
  // of the bytes to the minted URL, which answers `{ storageId }`.
  uploadBytes: async (uploadUrl, contentType, bytes) => {
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new Blob([bytes as BlobPart]),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, body };
    }
    const parsed = (await res.json().catch(() => ({}))) as { storageId?: string };
    return { ok: true, status: res.status, storageId: parsed.storageId };
  },
};

// ── Pure helpers ─────────────────────────────────────────────────────────

function asErrorResult(res: ApiResponse<unknown>, json: boolean): FlowResult {
  return {
    code: 1,
    lines: json
      ? [JSON.stringify({ ok: false, status: res.status, data: res.data })]
      // #913: the 2.0 verbs render server errors as the clean one-liner their
      // sibling verbs use (message + remedy), never the legacy `## Error` block.
      : [formatApiError(res)],
  };
}

/**
 * #931: resolveWorkflowId's failures (a name/id miss, or a failed workflow-list
 * fetch) must honor --json exactly like every other error path. Previously each
 * flow's catch emitted a bare `e.message` string even under --json, so a parsing
 * agent got an unparseable line. resolveWorkflowId throws {@link WorkflowResolveError}
 * carrying the same `{ status, data }` an ApiResponse would, so here we can emit
 * the identical `{ ok: false, status, data }` envelope asErrorResult produces —
 * or, in human mode, the clean one-liner + remedy.
 */
function resolveIdErrorResult(e: unknown, json: boolean): FlowResult {
  if (e instanceof WorkflowResolveError) {
    return {
      code: 1,
      lines: json
        ? [JSON.stringify({ ok: false, status: e.status, data: e.data })]
        : [e.message],
    };
  }
  // A non-resolve error still shouldn't leak a bare string under --json.
  const message = e instanceof Error ? e.message : String(e);
  return {
    code: 1,
    lines: json
      ? [JSON.stringify({ ok: false, status: 0, data: { error: { message } } })]
      : [message],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dateOnly(value: string | number | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString().slice(0, 10);
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const fmt = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
  return [fmt(headers), fmt(headers.map((h) => "-".repeat(h.length))), ...rows.map(fmt)].join("\n");
}

/**
 * Icon for a NODE status (idle/running/done/failed/skipped) — a separate,
 * unrenamed vocabulary from the run statuses #994 governs. Never call this with
 * a run status; run statuses render via runStatusLabel.
 */
function statusIcon(status: string | undefined): string {
  if (status === "completed" || status === "done") return "✓";
  if (status === "failed") return "✗";
  if (status === "skipped") return "-";
  return "…";
}

function truncateText(text: string, max = 200): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3).trimEnd()}...`;
}

function formatCounts(counts: WorkflowCounts | undefined): string {
  if (!counts) return "";
  return `done=${counts.done}/${counts.total}, failed=${counts.failed}, skipped=${counts.skipped}`;
}

function outputLines(output: WorkflowArtifact): string[] {
  if (output.type === "text") return [`    text: ${truncateText(output.text)}`];
  if (output.type === "primer") {
    return [`    primer:${output.primerKind}: ${truncateText(output.text)}`];
  }
  if (output.type === "image") {
    // #923: a text-only run's session/empty artifacts once rendered a bare
    // `image: undefined` line — omit a port with no value entirely.
    const url = output.imageUrl ?? output.storageId;
    return url ? [`    image: ${url}`] : [];
  }
  // #926: a session handle carries no reviewer-facing text — nothing to print
  // in the node output list (and never a `<port>: undefined` line).
  return [];
}

/**
 * One node status line. #923/#929: while the run is parked (awaiting approval)
 * on THIS node, the node row itself already reads `done` (the step finishes
 * before the human resolves) — but the pausedNodeId is the truth, so
 * render it as `⏸ … awaiting approval` rather than a misleading `✓ … done`.
 * The node's own status word (idle/running/done/failed/skipped) is a separate
 * vocabulary from the run statuses #994 governs and prints as-is.
 */
function progressLine(node: WorkflowRunNode, parked = false): string {
  const err = node.error ? ` — error: ${node.error}` : "";
  if (parked) {
    return `  ⏸ ${node.nodeId} (${node.kind}) awaiting approval`;
  }
  return `  ${statusIcon(node.status)} ${node.nodeId} (${node.kind}) ${node.status}${err}`;
}

/**
 * #931: which node (if any) should render as `⏸ awaiting approval` — and get the
 * `— awaiting approval, not yet approved` outputs suffix. ONLY a review park
 * qualifies: a "checkpoint" park, a legacy video cost-gate park (absent
 * pauseReason), or a legacy "taste" park at the retired Gate node (#1012).
 * "repair", "slots", and "call" parks are ALSO parked but their paused node holds
 * nothing to review (a repair collector is deliberately idle), so those node rows
 * stay as-is — the pause banner above already names the reason. Returns the
 * paused node id when the override applies, else undefined.
 * #998: a "checkpoint" park qualifies too — the parked row settles `done` while
 * the run waits on the member, so it must read `⏸ awaiting approval` and its
 * outputs must NOT read as approved until the member says so. (#1069: on a new
 * run that row is the Checkpoint box itself; on a frozen pre-#1069 run it is the
 * step that carried the old switch. Same treatment either way.)
 *
 * #994: the status test normalizes, so a pre-rename backend's "awaiting-review"
 * and a renamed backend's "awaiting-approval" behave identically.
 */
function gateParkedNodeId(
  status: string | undefined,
  pauseReason: WorkflowPauseReason | undefined,
  pausedNodeId: string | undefined,
): string | undefined {
  if (!status || normalizeRunStatus(status) !== "awaiting-approval") return undefined;
  if (pauseReason === "taste" || pauseReason === "checkpoint" || pauseReason === undefined) {
    return pausedNodeId;
  }
  return undefined;
}

// #1249's verdict picker moved to ../lib/runVerdict.ts (#1261) so the run
// DETAIL, the recent-runs LIST and the verb refusals all read it from one
// place — the list used to compute its own word and disagreed with the detail
// about the very same run.

/**
 * The one-line pointer every retired-Gate surface prints (#1012). Kept as a
 * single constant so the CLI verb, the pause banner, and the docs never drift.
 */
const RETIRED_GATE_VERB_POINTER =
  "The Gate node retired in 2.0 — runs now pause at a Checkpoint box on the canvas. " +
  "Use: exodus workflow checkpoint <runId> [approve|edit|retry|cancel]";

/**
 * #891: the pause banner a --wait loop prints once when a run parks. The
 * verb-specific "Resolve here" line is dispatched on `pauseReason`:
 *   - "repair" → the repair verb
 *   - "slots" → the answer verb
 *   - "checkpoint" (#998) → the checkpoint cluster
 *   - "taste" → a LEGACY park at the retired Gate node (#1012): there is no verb
 *     that can resume it, so say so and point at cancel-and-re-run.
 *   - absent (legacy video cost-gate park) → keep the original storyboard copy.
 * `runId` + `dashboardUrl` build the "resolve in the app" pointer.
 * `workerStopped` (#3820) marks the repair park whose worker went silent: it has
 * no dead input to skip, so only retry and kill are offered.
 */
export function formatPauseNotice(
  pauseReason: WorkflowPauseReason | undefined,
  runId: string,
  dashboardUrl: string,
  { workerStopped = false }: { workerStopped?: boolean } = {},
): string[] {
  // Legacy cost-gate park — byte-identical to the pre-#891 wording.
  if (!pauseReason) {
    return [
      "  ⏸ paused at the cost gate — approve or edit the storyboard in the web app to continue.",
    ];
  }
  // A "call" park is a parent waiting on its child sub-workflow — NOTHING for
  // the member to do (the inbox filters these too). Never point at a verb that
  // would only refuse the run.
  if (pauseReason === "call") {
    return ["  ⏸ waiting on a child workflow run — it resumes on its own."];
  }
  // #998: a checkpoint park means the run reached a Checkpoint box — say exactly
  // that, then point at the checkpoint verb (same 3-line shape).
  if (pauseReason === "checkpoint") {
    return [
      "  ⏸ paused at a checkpoint — what's flowing through it is waiting on your approval.",
      `     Resolve here:  exodus workflow checkpoint ${runId}`,
      `     Or in the app: ${dashboardUrl}${RUN_PAGE_PREFIX}${runId}`,
    ];
  }
  // #1012: a LEGACY "taste" park sits at a Gate node that no longer exists, so
  // the run can never be resumed — only cancelled. Say that plainly rather than
  // pointing at a verb that would refuse it.
  if (pauseReason === "taste") {
    return [
      "  ⏸ paused at a Gate box, which retired in 2.0. Approvals now happen at a Checkpoint box.",
      `     Cancel it here: exodus workflow cancel ${runId}`,
      `     Or in the app:  ${dashboardUrl}${RUN_PAGE_PREFIX}${runId}`,
      "     Then run the workflow again.",
    ];
  }
  if (pauseReason === "repair" && workerStopped) {
    return [
      "  ⏸ the worker stopped partway — retry carries on from where it stopped, finished steps are kept.",
      `     Resolve here:  exodus workflow repair ${runId} retry|kill`,
      `     Or in the app: ${dashboardUrl}${RUN_PAGE_PREFIX}${runId}`,
    ];
  }
  const resolveVerb =
    pauseReason === "repair"
      ? `exodus workflow repair ${runId} retry|skip|kill`
      : `exodus workflow answer ${runId} --slot key=value`;
  return [
    "  ⏸ paused for review — waiting on you.",
    `     Resolve here:  ${resolveVerb}`,
    `     Or in the app: ${dashboardUrl}${RUN_PAGE_PREFIX}${runId}`,
  ];
}

/**
 * Expand a single `--input` value (#508):
 *   - `@@literal` → the literal text `@literal` (one `@` stripped, escape hatch).
 *   - `@path`     → the contents of the file at `path` (resolved from the cwd by
 *                   `readFile`); a missing/unreadable file throws, naming the path.
 *   - anything else is returned untouched.
 * `readFile` is optional so the pure parser stays testable; the run command
 * always injects `deps.readFile`.
 */
function expandInputValue(
  key: string,
  value: string,
  readFile?: (path: string) => string,
): string {
  if (value.startsWith("@@")) return value.slice(1);
  if (value.startsWith("@")) {
    const filePath = value.slice(1);
    if (!filePath) {
      throw new Error(`--input ${key}=@<file> needs a file path after "@"`);
    }
    if (!readFile) {
      throw new Error(`--input ${key}: cannot load @${filePath} here (no file access)`);
    }
    try {
      return readFile(filePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`--input ${key}: could not read file "${filePath}": ${msg}`);
    }
  }
  return value;
}

/**
 * #1150: put a MULTI-CHOICE value into the canonical encoding — the picks
 * comma-joined, trimmed, empties dropped — so `a,b`, `a, b` and a trailing
 * comma all leave this CLI as the one string every other door sends.
 *
 * The reference pair is `splitMultiValue`/`joinMultiValue`
 * (src/components/workflows/runForm.ts), which the run dialog, the +New modal
 * and the chat card all share; exodus cannot import from src/, so these two
 * lines are the mirror of them and must stay word-for-word equivalent.
 *
 * It normalizes only — it VALIDATES nothing. This CLI deliberately checks no
 * membership (an option list can change between describe and launch); the
 * server's launch gate is the authority, and its rejection names the field.
 */
function normalizeMultiValue(value: string): string {
  return value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join(", ");
}

/**
 * Split the repeatable `--input key=value` flags into a map, WITHOUT expanding
 * `@path` values (Stage 3B). The run verb parses raw and expands later, once
 * `describe` has said which fields are Asset Inputs — for those, a bare path is
 * the argument itself and must never be slurped in as utf-8 text.
 */
export function parseRawInputFlags(occurrences: FlagOccurrence[]): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const { flag, value } of occurrences) {
    if (flag !== "input") continue;
    if (!value) throw new Error("--input requires key=value");
    const eq = value.indexOf("=");
    if (eq <= 0) throw new Error(`--input must be key=value (got "${value}")`);
    const key = value.slice(0, eq).trim();
    if (!key) throw new Error(`--input must include a key (got "${value}")`);
    inputs[key] = value.slice(eq + 1);
  }
  return inputs;
}

export function parseInputFlags(
  occurrences: FlagOccurrence[],
  readFile?: (path: string) => string,
): Record<string, string> {
  const inputs = parseRawInputFlags(occurrences);
  for (const [key, value] of Object.entries(inputs)) {
    inputs[key] = expandInputValue(key, value, readFile);
  }
  return inputs;
}

// ── Asset Input file uploads (Stage 3B) ───────────────────────────────────

/** Bytes per megabyte, spelled out so the caps below read as MB. */
const MB = 1024 * 1024;

/**
 * Mirror of convex/lib/workflow/assetPolicy.ts ASSET_MEDIA_POLICY, plus the
 * extension→MIME map only the CLI needs: a browser file picker hands the server
 * a content type, but a shell path carries nothing but a suffix, so the CLI
 * derives the type from the extension and the server re-derives the truth from
 * the stored bytes. exodus builds standalone, so this is a copy — the lockstep
 * test in exodus/__tests__/workflow.test.ts pins every MIME + cap here to the
 * convex original so the two can never drift.
 */
export const ASSET_UPLOAD_POLICY: Record<
  WorkflowMediaType,
  { mimeByExtension: Record<string, string>; maxBytes: number; accepts: string }
> = {
  image: {
    mimeByExtension: {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    },
    maxBytes: 15 * MB,
    accepts: "PNG, JPEG, WebP, GIF",
  },
  video: {
    mimeByExtension: {
      ".mp4": "video/mp4",
      ".m4v": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
    },
    maxBytes: 200 * MB,
    accepts: "MP4, MOV, WebM",
  },
  audio: {
    mimeByExtension: {
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
    },
    maxBytes: 50 * MB,
    accepts: "MP3, M4A, WAV, OGG",
  },
  document: {
    mimeByExtension: {
      ".pdf": "application/pdf",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".doc": "application/msword",
      ".docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    maxBytes: 25 * MB,
    accepts: "PDF, TXT, Markdown, DOC, DOCX",
  },
};

/** Mirror of convex graph.ts MEDIA_TYPES, in the same order. */
const MEDIA_FAMILIES: WorkflowMediaType[] = ["image", "video", "audio", "document"];

/** Bytes rendered the way a person reads them ("1.4MB"). */
function sizeLabel(bytes: number): string {
  return `${(bytes / MB).toFixed(1)}MB`;
}

/** A family's cap as human copy ("15MB"). */
function capLabel(bytes: number): string {
  return `${Math.round(bytes / MB)}MB`;
}

/**
 * The content type to declare for a local file, honoring the field's declared
 * family when it has one (so a .mp4 handed to an audio port is caught here, not
 * three minutes into an upload). Null = an extension we don't accept.
 */
function assetMimeFor(
  filePath: string,
  assetType: WorkflowMediaType | undefined,
): { mime: string; family: WorkflowMediaType } | null {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return null;
  for (const family of assetType ? [assetType] : MEDIA_FAMILIES) {
    const mime = ASSET_UPLOAD_POLICY[family].mimeByExtension[ext];
    if (mime) return { mime, family };
  }
  return null;
}

/** "image files (PNG, JPEG, WebP, GIF)" — what this field will actually take. */
function acceptedLabel(assetType: WorkflowMediaType | undefined): string {
  if (assetType) {
    const policy = ASSET_UPLOAD_POLICY[assetType];
    return `${assetType} files (${policy.accepts}, up to ${capLabel(policy.maxBytes)})`;
  }
  return MEDIA_FAMILIES.map(
    (family) => `${family} (${ASSET_UPLOAD_POLICY[family].accepts})`,
  ).join(", ");
}

/**
 * True when a value READS like a filesystem path — it has a directory
 * separator, a leading "~", or a short extension-like suffix. A stored asset id
 * has none of those, so a path-shaped value that isn't on disk is a typo worth
 * failing on rather than an opaque id worth relaying to the server.
 */
function looksLikePath(value: string): boolean {
  if (value.includes("/") || value.includes("\\")) return true;
  if (value.startsWith("~")) return true;
  return /\.[A-Za-z0-9]{1,8}$/.test(value);
}

/** One local file that PASSED every client-side check and is cleared to upload. */
interface PlannedAssetUpload {
  field: string;
  filePath: string;
  /** The basename, i.e. what the member sees quoted in messages. */
  name: string;
  size: number;
  mime: string;
  family: WorkflowMediaType;
}

/**
 * Every client-side check for ONE local file, with no network in it.
 *
 * Split out from the upload itself so the run flow can check EVERY file before
 * the first byte moves: a bad third file used to strand two already-registered
 * assets (orphan rows the member had no way to reuse). Throws a line written
 * for the person who picked the file.
 */
function planAssetUpload(
  field: string,
  filePath: string,
  size: number,
  assetType: WorkflowMediaType | undefined,
  deps: WorkflowRunDeps,
): PlannedAssetUpload {
  const name = path.basename(filePath);
  const picked = assetMimeFor(filePath, assetType);
  if (!picked) {
    throw new Error(
      `--input ${field}: can't tell what kind of file "${name}" is — ${field} takes ${acceptedLabel(assetType)}`,
    );
  }
  const { maxBytes } = ASSET_UPLOAD_POLICY[picked.family];
  if (size > maxBytes) {
    throw new Error(
      `--input ${field}: "${name}" is ${sizeLabel(size)} — over the ${capLabel(maxBytes)} limit for ${picked.family} uploads`,
    );
  }
  if (!deps.readFileBytes || !deps.uploadBytes) {
    throw new Error(`--input ${field}: cannot upload files here (no file access)`);
  }
  return { field, filePath, name, size, mime: picked.mime, family: picked.family };
}

/**
 * Push ONE already-checked file up as a workflow asset: mint an upload URL →
 * POST the bytes → register the stored blob. Returns the assetId the run body
 * carries.
 *
 * The mint hands back a `receiptId` alongside the URL and the register call
 * MUST echo it — that's how the server binds the blob it stored to the mint it
 * issued, so a stray storage id can't be claimed by someone else's register.
 */
async function pushAssetFile(
  plan: PlannedAssetUpload,
  deps: WorkflowRunDeps,
): Promise<{ assetId: string; mediaType: WorkflowMediaType }> {
  const { field, name } = plan;
  const mint = await deps.post(ASSET_UPLOAD_URL_PATH, {});
  if (!mint.ok) {
    throw new Error(missingRouteLine(mint, "workflow file inputs") ?? formatApiError(mint));
  }
  const minted = mint.data as { uploadUrl?: string; receiptId?: string };
  if (!minted.uploadUrl) {
    throw new Error(`--input ${field}: the server did not return an upload URL for "${name}"`);
  }
  if (!minted.receiptId) {
    throw new Error(`--input ${field}: the server did not return an upload receipt for "${name}"`);
  }

  let bytes: Uint8Array;
  try {
    bytes = deps.readFileBytes!(plan.filePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`--input ${field}: could not read file "${plan.filePath}": ${msg}`);
  }
  const put = await deps.uploadBytes!(minted.uploadUrl, plan.mime, bytes);
  if (!put.ok || !put.storageId) {
    const detail = put.body ? `: ${put.body.slice(0, 200)}` : "";
    throw new Error(`--input ${field}: upload of "${name}" failed (HTTP ${put.status})${detail}`);
  }

  const registered = await deps.post(ASSETS_PATH, {
    storageId: put.storageId,
    receiptId: minted.receiptId,
    filename: name,
  });
  if (!registered.ok) {
    throw new Error(
      missingRouteLine(registered, "workflow file inputs") ?? formatApiError(registered),
    );
  }
  const data = registered.data as { assetId?: string; mediaType?: WorkflowMediaType };
  if (!data.assetId) {
    throw new Error(`--input ${field}: the server did not return an asset id for "${name}"`);
  }
  return { assetId: data.assetId, mediaType: data.mediaType ?? plan.family };
}

/**
 * One error line per bad `--input`, or a short list when several are bad — the
 * member fixes them all in one edit instead of discovering them one run at a
 * time. Each line already starts with `--input <field>:`, so the list needs no
 * extra labeling.
 */
function formatInputProblems(problems: string[]): string {
  if (problems.length === 1) return problems[0];
  return [
    `${problems.length} of the --input values can't be used:`,
    ...problems.map((line) => `  ${line}`),
  ].join("\n");
}

/**
 * When an upload dies partway, the files that already registered are real and
 * reusable — name their ids so the next attempt skips them instead of leaving
 * orphaned rows nobody can point at.
 */
function withReusableAssetIds(
  message: string,
  done: Array<{ field: string; assetId: string }>,
): string {
  if (done.length === 0) return message;
  const flags = done.map((d) => `--input ${d.field}=${d.assetId}`).join(" ");
  return (
    `${message}\n` +
    `These files did upload — pass their ids to skip re-uploading them: ${flags}`
  );
}

/**
 * True when an `--input` value reads like it points at a LOCAL FILE rather than
 * being the value itself. Used only on the describe-failed path, where nothing
 * tells us which fields are Asset Inputs, so it has to be conservative in both
 * directions:
 *   - `@@literal` is the documented "keep the @" escape — never a path.
 *   - a leading `@`, or a file that actually exists on disk, is decisive.
 *   - a URL is never a local path, and neither is anything with whitespace in
 *     it (that's prose — a brief, not a filename). #1095 makes that exclusion
 *     load-bearing: a URL is a legitimate asset value the server fetches at
 *     intake, so a describe outage must not block it.
 */
function looksLikeFileArgument(value: string, deps: WorkflowRunDeps): boolean {
  if (value.startsWith("@@")) return false;
  if (value.startsWith("@")) return true;
  if ((deps.statFile?.(value) ?? null) !== null) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (/\s/.test(value)) return false;
  return looksLikePath(value);
}

/**
 * #1082: the one-line heads-up a run deserves when the workflow promises
 * NOTHING. Spelled once so the pre-launch warning and any test that pins it
 * can't drift.
 */
export const NO_DELIVERIES_WARNING =
  "Warning: this workflow has no Output node — the run will finish with no named " +
  "deliveries (nothing for --out to save, and nothing to send to a webhook).";

/**
 * #1082: decide, from the describe response the run flow already fetches,
 * whether to warn BEFORE the run is spent.
 *
 * The rule is deliberately conservative — "no deliveries" has to be a fact the
 * payload states, never something inferred:
 *   - `deliveries: []`      → warn (the backend says: no named slots).
 *   - `deliveries: [...]`   → silent.
 *   - no `deliveries` key   → silent. A pre-#1082 backend's `outputs: []` is
 *     NOT the same fact (codex review): `outputs` lists WIRED producers, so a
 *     workflow whose only Output node is unwired also reports `outputs: []`
 *     while still declaring a named (unfulfilled) slot — warning on it would
 *     tell that member their Output node doesn't exist. A false alarm before a
 *     real run is worse than no warning at all.
 */
export function noDeliveriesWarning(described: unknown): string | undefined {
  if (!isRecord(described)) return undefined;
  const deliveries = described["deliveries"];
  if (Array.isArray(deliveries)) {
    return deliveries.length === 0 ? NO_DELIVERIES_WARNING : undefined;
  }
  return undefined;
}

/**
 * #1082: fold the run-start response's optional `warnings: string[]` (an
 * additive server field) in with what the CLI already warned about locally,
 * dropping anything that would say the same thing twice.
 *
 * The local describe pre-check is the PRIMARY mechanism — it works against a
 * backend too old to send `warnings` at all — so on a tie the local wording
 * wins and the server's copy is dropped. Matching is on a punctuation-blind key
 * plus a topic guard, because the two sides word the same fact differently.
 */
export function serverWarningsToPrint(
  serverWarnings: unknown,
  alreadyPrinted: string[],
): string[] {
  if (!Array.isArray(serverWarnings)) return [];
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const printedKeys = new Set(alreadyPrinted.map(key));
  const saidNoDeliveries = alreadyPrinted.includes(NO_DELIVERIES_WARNING);
  const out: string[] = [];
  for (const raw of serverWarnings) {
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (text === "") continue;
    const k = key(text);
    if (printedKeys.has(k)) continue;
    // Same fact, different words: our pre-check already covered it.
    if (saidNoDeliveries && (k.includes("no output node") || k.includes("no named deliver"))) {
      continue;
    }
    printedKeys.add(k);
    out.push(text);
  }
  return out;
}

/**
 * Turn the RAW `--input` values into the values the run route wants (Stage 3B).
 *
 * Asset Input fields (`source: "asset"` in describe) take a LOCAL FILE PATH:
 * the CLI uploads it and substitutes the returned assetId. Every other field
 * keeps the historical `@path` text-expansion. A required asset field with no
 * `--input` fails here, before a run is spent, naming the flag to pass — the
 * CLI has no interactive prompts by design.
 *
 * #1095: an asset field also accepts an http(s) URL. That one is relayed as
 * typed — intake fetches, validates and registers it server-side — so the CLI
 * neither stats nor uploads it.
 *
 * The describe fetch is a COURTESY preflight, but only for TEXT: if it fails we
 * fall through to the pre-3B behavior (expand `@path`, relay values verbatim)
 * — unless a value looks like a local file, in which case there is no honest
 * fallback (a path would ride as literal text, and `@./photo.png` would slurp
 * binary into the JSON body) and we stop instead of spending a doomed run.
 *
 * Uploads run in TWO passes: every local file is checked first, then — and only
 * then — the bytes move. That way a bad third file can't leave the first two
 * registered with nothing pointing at them.
 *
 * #1082: the same describe payload also answers "does this workflow promise
 * anything?", so the returned `warnings` ride back out with the prepared inputs
 * — the caller prints them to stderr before spending the run. Warnings never
 * block: they are said once and the launch continues.
 */
interface PreparedRunInputs {
  inputs: Record<string, string>;
  /** #1082: pre-launch heads-ups, in the order they should be said. */
  warnings: string[];
}

async function prepareRunInputs(
  workflowId: string,
  raw: Record<string, string>,
  deps: WorkflowRunDeps,
  note: (line: string) => void,
): Promise<PreparedRunInputs> {
  const described = await deps.get(`${DESCRIBE_PATH}?id=${encodeURIComponent(workflowId)}`);
  if (!described.ok) {
    const fileish = Object.keys(raw).filter((key) => looksLikeFileArgument(raw[key], deps));
    if (fileish.length > 0) {
      const reason = formatApiError(described).split("\n")[0];
      throw new Error(
        `--input ${fileish.join(", ")}: couldn't confirm this workflow's inputs ` +
          `(describe failed: ${reason}) — retry, or pass an already-uploaded asset id ` +
          `instead of a file path.`,
      );
    }
    const text: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      text[key] = expandInputValue(key, value, deps.readFile);
    }
    // Describe failed, so we know nothing about the exit contract either — no
    // warning, same as pre-#1082.
    return { inputs: text, warnings: [] };
  }

  // #1082: the exit-contract pre-check. Computed here (the only place describe
  // is read on the run path) and carried out with the inputs.
  const warnings: string[] = [];
  const noDeliveries = noDeliveriesWarning(described.data);
  if (noDeliveries) warnings.push(noDeliveries);

  const descriptors = (described.data as Partial<WorkflowDescribeResponse>).inputs ?? [];
  const assetFields = new Map<string, WorkflowInputDescriptor>();
  // #1150: the multi-choice fields, by key. Their answer is ONE string (the
  // picks comma-joined), and this is the only place the CLI knows which fields
  // those are — describe is what says so.
  const multiFields = new Set<string>();
  for (const descriptor of descriptors) {
    if (descriptor?.source === "asset") assetFields.set(descriptor.fieldName, descriptor);
    if (descriptor?.type === "multi-select") multiFields.add(descriptor.fieldName);
  }

  // #1259: this check used to be skipped for a `--terminal` (scoped) run, whose
  // closure might not contain the Asset Input node at all. #1222 repealed
  // partial runs — every run covers the whole graph — so a required file input
  // left blank is always a miss, and the check always runs.
  const missing = [...assetFields.values()].filter(
    (d) => d.required && (raw[d.fieldName] ?? "").trim() === "",
  );
  if (missing.length > 0) {
    const names = missing.map((d) => d.fieldName).join(", ");
    const first = missing[0];
    throw new Error(
      `Missing required file input(s): ${names}. Pass each one as a local file ` +
        `or a URL — e.g. --input ${first.fieldName}=./path/to/file or ` +
        `--input ${first.fieldName}=https://…` +
        (first.assetType ? ` (${acceptedLabel(first.assetType)})` : ""),
    );
  }

  // ── Pass 1: settle every value locally, collecting EVERY problem ─────────
  const prepared: Record<string, string> = {};
  const planned: PlannedAssetUpload[] = [];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const descriptor = assetFields.get(key);
    if (!descriptor) {
      try {
        const expanded = expandInputValue(key, value, deps.readFile);
        // #1150: a multi-choice answer is normalized AFTER any @file expansion
        // — the list may well have come out of a file — so what leaves this CLI
        // is the same string the run dialog would have sent.
        prepared[key] = multiFields.has(key)
          ? normalizeMultiValue(expanded)
          : expanded;
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      }
      continue;
    }
    // #1095: an http(s) URL is a launch value the SERVER settles — intake
    // fetches, type/size-checks and registers it before the run starts. The
    // CLI's only job is to not mistake one for a file path (looksLikePath is
    // true for anything with a "/"), so relay it untouched.
    if (/^https?:\/\//i.test(value)) {
      prepared[key] = value;
      continue;
    }
    // A bare path is the natural argument for a file field, but someone in the
    // `@file` habit will type one anyway — strip a single leading "@" and treat
    // it as an explicit "this is a path" signal.
    const hinted = value.startsWith("@");
    const candidate = hinted ? value.slice(1) : value;
    const stat = deps.statFile?.(candidate) ?? null;
    if (!stat) {
      // Path-shaped but not on disk = a typo. Failing here beats letting the
      // server reject it as an unreadable asset id.
      if (hinted || looksLikePath(candidate)) {
        problems.push(`--input ${key}: file not found: ${candidate}`);
        continue;
      }
      // Otherwise it's an asset id from an earlier upload — relay it untouched.
      prepared[key] = value;
      continue;
    }
    try {
      planned.push(planAssetUpload(key, candidate, stat.size, descriptor.assetType, deps));
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (problems.length > 0) throw new Error(formatInputProblems(problems));

  // ── Pass 2: nothing can fail locally now, so move the bytes ──────────────
  const done: Array<{ field: string; assetId: string }> = [];
  for (const plan of planned) {
    let uploaded: { assetId: string; mediaType: WorkflowMediaType };
    try {
      uploaded = await pushAssetFile(plan, deps);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(withReusableAssetIds(message, done));
    }
    note(`  uploaded ${plan.name} → ${plan.field} (${uploaded.mediaType}, ${sizeLabel(plan.size)})`);
    prepared[plan.field] = uploaded.assetId;
    done.push({ field: plan.field, assetId: uploaded.assetId });
  }
  return { inputs: prepared, warnings };
}

/**
 * #1259: `--terminal <nodeId>` (#860) used to scope a run to the upstream
 * closure of some end nodes. #1222 repealed partial runs — the server refuses
 * ANY launch that would skip a step — so the flag can no longer do anything but
 * fail. It is still READ purely so an old script gets one plain sentence here
 * instead of a raw server error after a round trip. The flag is no longer
 * advertised in the help text.
 *
 * Throws when the flag appears in any form (`--terminal id`, `--terminal=id`,
 * or bare); returns silently when it doesn't.
 */
export function rejectTerminalFlag(occurrences: FlagOccurrence[]): void {
  if (occurrences.some((o) => o.flag === "terminal")) {
    throw new Error(
      "--terminal is no longer supported: a run now executes the whole " +
        "workflow or it doesn't start. Re-run without --terminal.",
    );
  }
}

/**
 * Detect the bare `--auto-approve` flag (#1079) off the raw argv — the one flag
 * still read that way. It takes no value, so `--auto-approve=yes` has to fail
 * loud rather than be guessed at, and a parsed occurrence cannot tell that form
 * apart from `--auto-approve yes` (both carry the value "yes"). Only the words
 * themselves keep the two apart. Presence is otherwise the whole truth: the
 * flag takes no value, so seeing it at all means it was passed — a strict
 * `=== true` check against the shared flags map would instead read
 * `run --auto-approve "Flow"` as `{"auto-approve": "Flow"}` and silently launch
 * ATTENDED, which is the one failure nobody is around to notice.
 */
export function parseAutoApproveFlag(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--auto-approve") return true;
    if (arg.startsWith("--auto-approve=")) {
      throw new Error("--auto-approve takes no value — pass it bare");
    }
  }
  return false;
}

/**
 * Read the `--rig-overrides <json|@file.json>` flag (#1084 F2) — the per-run
 * Image Rig re-aim a launch carries. Accepts both `--rig-overrides '<json>'` and
 * `--rig-overrides=@plan.json`; `@path` reads the file (the `--input`
 * convention), and `@@` escapes a literal leading `@`.
 *
 * The JSON is parsed HERE, before the run is requested, for one reason: a typo
 * in a payload should cost a shell error, not a round trip that comes back as an
 * opaque 400. WHAT the payload points at is still the server's call — it is the
 * only side that has the graph — so this parse only insists the text is an
 * object. Returns undefined when the flag was never passed.
 */
export function parseRigOverridesFlag(
  occurrences: FlagOccurrence[],
  readFile?: (path: string) => string,
): Record<string, unknown> | undefined {
  let raw: string | undefined;
  for (const { flag, value } of occurrences) {
    if (flag !== "rig-overrides") continue;
    if (value === undefined || value.startsWith("--")) {
      throw new Error("--rig-overrides requires JSON or @path/to/file.json");
    }
    // Last one wins, matching how the shared flags map treats a repeated flag.
    raw = value;
  }
  if (raw === undefined) return undefined;

  let text = raw.trim();
  if (!text) throw new Error("--rig-overrides requires JSON or @path/to/file.json");
  if (text.startsWith("@@")) {
    text = text.slice(1);
  } else if (text.startsWith("@")) {
    const filePath = text.slice(1);
    if (!filePath) {
      throw new Error("--rig-overrides @<file> needs a file path after \"@\"");
    }
    if (!readFile) {
      throw new Error(
        `--rig-overrides: cannot load @${filePath} here (no file access)`,
      );
    }
    try {
      text = readFile(filePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`--rig-overrides: could not read file "${filePath}": ${msg}`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`--rig-overrides is not valid JSON: ${msg}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "--rig-overrides must be a JSON object keyed by Image Rig node id, e.g. '{\"rig_1\":{\"lines\":{\"line_1\":{\"count\":3}}}}'",
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Read the `--voices <json|@voices.json>` flag (#1846) — the voices a run carries
 * from the moment it starts, keyed by the names the script gives its speakers
 * ("HOST 1"), because the planner's character ids (C1, C2) do not exist yet.
 * Same file `exodus video voices <run> --from` reads at the storyboard review,
 * so a brand keeps one voices.json for both.
 *
 * Parsed HERE, before anything is requested, for the `--rig-overrides` reason: a
 * JSON typo should cost a shell error, not a round trip. WHICH speakers and
 * voices are real is the server's call — it holds the script and the member's
 * ElevenLabs account — so this only insists the text is an object.
 */
export function parseVoicesFlag(
  occurrences: FlagOccurrence[],
  readFile?: (path: string) => string,
): VoiceMap | undefined {
  let raw: string | undefined;
  for (const { flag, value } of occurrences) {
    if (flag !== "voices") continue;
    if (value === undefined || value.startsWith("--")) {
      throw new Error("--voices requires JSON or @path/to/voices.json");
    }
    // Last one wins, matching how the shared flags map treats a repeated flag.
    raw = value;
  }
  if (raw === undefined) return undefined;

  let text = raw.trim();
  if (!text) throw new Error("--voices requires JSON or @path/to/voices.json");
  if (text.startsWith("@@")) {
    text = text.slice(1);
  } else if (text.startsWith("@")) {
    const filePath = text.slice(1);
    if (!filePath) {
      throw new Error("--voices @<file> needs a file path after \"@\"");
    }
    if (!readFile) {
      throw new Error(`--voices: cannot load @${filePath} here (no file access)`);
    }
    try {
      text = readFile(filePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`--voices: could not read file "${filePath}": ${msg}`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`--voices is not valid JSON: ${msg}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      "--voices must be a JSON object keyed by the script's speaker names, e.g. {\"HOST 1\":\"<voiceId>\"}",
    );
  }
  return parsed as VoiceMap;
}

/**
 * The `--voice-treatment` wire body (#1869) — a sibling of `voices`, never a
 * member of it. `describe` is a map keyed by the script's speaker names, so a
 * brand's voice-treatment.json IS this object.
 */
export interface VoiceTreatmentBody {
  path: string;
  describe?: Record<string, string>;
}

/**
 * Read the `--voice-treatment <path | json | @file>` flag (#1869) — how this
 * run makes its voices.
 *
 * A path on its own is the whole answer for the treatments that use voices you
 * already have (`--voice-treatment lipsync-retarget`, which still pairs with
 * `--voices`). The treatments where the video model speaks from written words
 * need a description per speaker, which is the JSON form.
 *
 * Parsed HERE, before anything is requested, for the `--voices` reason: a JSON
 * typo should cost a shell error, not a round trip. WHICH treatments and
 * speakers are real is the server's call — it holds the script, the graph and
 * the member's keys — so this only insists the text names something.
 */
export function parseVoiceTreatmentFlag(
  occurrences: FlagOccurrence[],
  readFile?: (path: string) => string,
): VoiceTreatmentBody | undefined {
  const usage =
    "--voice-treatment requires a treatment name, JSON, or @path/to/voice-treatment.json";
  let raw: string | undefined;
  for (const { flag, value } of occurrences) {
    if (flag !== "voice-treatment") continue;
    if (value === undefined || value.startsWith("--")) throw new Error(usage);
    // Last one wins, matching how the shared flags map treats a repeated flag.
    raw = value;
  }
  if (raw === undefined) return undefined;

  let text = raw.trim();
  if (!text) throw new Error(usage);
  let fromFile = false;
  if (text.startsWith("@@")) {
    text = text.slice(1);
  } else if (text.startsWith("@")) {
    const filePath = text.slice(1);
    if (!filePath) {
      throw new Error("--voice-treatment @<file> needs a file path after \"@\"");
    }
    if (!readFile) {
      throw new Error(`--voice-treatment: cannot load @${filePath} here (no file access)`);
    }
    try {
      text = readFile(filePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`--voice-treatment: could not read file "${filePath}": ${msg}`);
    }
    fromFile = true;
  }
  // A bare word is the whole treatment, and which words are real is the
  // server's call. Only a file, or text that opens an object, is JSON.
  if (!fromFile && !text.startsWith("{")) return { path: text };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`--voice-treatment is not valid JSON: ${msg}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      '--voice-treatment must be a treatment name, or a JSON object like {"path":"native-prompt","describe":{"HOST 1":"..."}}',
    );
  }
  return parsed as VoiceTreatmentBody;
}

/**
 * Read the `--fill <name>` flag (#1013) — the saved fill a run launches from.
 * Accepts both `--fill name` and `--fill=name`, mirroring the `--input` parse
 * convention; a fill silently dropped would launch the WRONG run. Returns
 * undefined when the flag was never passed; throws when it was passed empty.
 */
export function parseFillFlag(occurrences: FlagOccurrence[]): string | undefined {
  let name: string | undefined;
  for (const { flag, value } of occurrences) {
    if (flag !== "fill") continue;
    // A bare trailing `--fill`, or one followed by another flag, names nothing.
    if (value === undefined || value.startsWith("--")) {
      throw new Error("--fill requires a saved fill's name");
    }
    const trimmed = value.trim();
    if (!trimmed) throw new Error("--fill requires a saved fill's name");
    // Last one wins, matching how the shared flags map treats a repeated flag.
    name = trimmed;
  }
  return name;
}

export function formatWorkflowList(workflows: WorkflowListItem[]): string {
  if (workflows.length === 0) return "No workflows found for the active brand.";
  return table(
    ["name", "nodes", "edges", "updated", "id"],
    workflows.map((w) => [
      // Badge a cross-brand row so it's clear it lives in another brand (#523).
      w.isCrossBrand && w.homeBrandName ? `${w.name} · from ${w.homeBrandName}` : w.name,
      String(w.nodeCount),
      String(w.edgeCount),
      dateOnly(w.updatedAt),
      w._id,
    ]),
  );
}

// The server's default page size for the bare `workflow status` run list
// (convex/workflows.ts listRuns clamps `limit ?? 25`). The CLI sends no limit,
// so a page of exactly this many rows means "there is probably more".
const RECENT_RUNS_PAGE = 25;

export function formatRecentRuns(runs: WorkflowRunProjection[]): string {
  if (runs.length === 0) return "No workflow runs found for the active brand.";
  // #1347: the first column is the RUN's name, not its workflow's — a page of
  // copy runs was 25 rows reading "Copy run". The kind moved to its own column
  // because it is a different fact from the name and every row has one.
  const rows = table(
    ["run", "type", "status", "created", "id"],
    // #994: the ruled display word, never the raw stored value. #1249: with the
    // park detail when the projection carries pauseReason — a row the server
    // sends without it degrades to the bare ruled word. #1261: the SAME shared
    // verdict the run detail prints, fed the server's `deliverySummary` so the
    // "Failed — nothing delivered" demotion reaches this screen too.
    runs.map((r) => [
      runDisplayName(r),
      runTypeWord(r),
      runVerdict(r),
      dateOnly(r.createdAt),
      r._id,
    ]),
  );
  const notes: string[] = [];
  // #934: the server caps this list at 25 (convex/workflows.ts listRuns) and the
  // CLI has no --limit, so a full page is very likely a TRUNCATED page. Say so.
  // This screen is now the documented way to answer "did my promote start a
  // run?", and a silent cut turns "older than the newest 25" into "nothing ran"
  // — the exact false negative #933 exists to stop. Its sibling
  // formatWorkflowVersions has always printed a notice; this one never did.
  if (runs.length >= RECENT_RUNS_PAGE) {
    notes.push(
      `Showing the ${RECENT_RUNS_PAGE} newest runs — there may be older ones this list doesn't reach.`,
    );
  }
  // #1231: this table is where someone watching a job burn money actually
  // looks, so the off switch is named HERE and not only in --help. Shown only
  // when something on screen can still be stopped — a footer that never applies
  // is noise, and noise is how a real hint gets skipped.
  if (runs.some((r) => !isTerminalRunStatus(r.status))) {
    notes.push(`Stop one that's still going: exodus workflow cancel <id> --reason "..."`);
  }
  return notes.length > 0 ? `${rows}\n\n${notes.join("\n")}` : rows;
}

export function formatWorkflowVersions(versions: WorkflowVersion[]): string {
  if (versions.length === 0) {
    return "no saved versions yet — versions start recording on the workflow's next save";
  }
  // version numbers are REAL 1-based ids — printed verbatim, never a row index.
  const lines = versions.map((v) => {
    const by = v.savedByName ? ` · by ${v.savedByName}` : "";
    return `v${v.version} · ${v.name} · saved ${dateOnly(v.savedAt)}${by}`;
  });
  if (versions.length === VERSIONS_CAP) {
    lines.push("");
    lines.push(
      `(showing the ${VERSIONS_CAP} most recent versions — older versions may exist beyond this cap)`,
    );
  }
  return lines.join("\n");
}

export function formatImportSummary(
  result: WorkflowImportResult,
  mode: { dryRun?: boolean; update?: boolean; validate?: boolean } = {},
): string {
  const lines: string[] = [];
  // `validate` is import --dry-run under a different door (#879 ruling 3): same
  // server validation, only the heading changes from "dry-run preview" wording.
  const heading = mode.validate
    ? "Workflow validation passed:"
    : mode.dryRun
      ? "Workflow import preview:"
      : result.created
        ? "Workflow imported."
        : mode.update
          ? "Workflow updated."
          : "Workflow import preview:";
  lines.push(heading);
  lines.push(`name:        ${result.name}`);
  if (result.workflowId) lines.push(`workflowId:  ${result.workflowId}`);
  lines.push(`nodes:       ${result.nodeCount}`);
  lines.push(`edges:       ${result.edgeCount}`);

  // #921: report the trigger set this import installed, WARNING loudly on any
  // enabled one — a CLI import must never silently arm a background-run rule.
  // Older servers omit the field entirely (nothing to show); an empty array
  // means "no triggers", also nothing to warn about.
  if (result.triggers && result.triggers.length > 0) {
    lines.push("");
    const enabledCount = result.triggers.filter((t) => t.enabled).length;
    lines.push(`Triggers (${result.triggers.length}):`);
    for (const t of result.triggers) {
      const detail = t.type === "event" ? `event (${t.event})` : `cron (${t.cron})`;
      if (t.enabled) {
        const fires =
          t.type === "event"
            ? t.event === "winner-promoted"
              ? "fires on every promote"
              : `fires on ${t.event}`
            : `fires on schedule ${t.cron}`;
        lines.push(`  ⚠ ${detail} — ENABLED, ${fires}`);
      } else {
        lines.push(`  ${detail} — disabled`);
      }
    }
    if (enabledCount > 0) {
      lines.push(
        `  ⚠ ${enabledCount} enabled trigger${enabledCount === 1 ? "" : "s"} armed — a background run may start on the owner's keys. Disable with: exodus workflow triggers <id> disable <n>`,
      );
    }
  }

  if (result.unresolved.length > 0) {
    lines.push("");
    lines.push(`Unresolved references (${result.unresolved.length}):`);
    for (const ref of result.unresolved) {
      lines.push(`  ${ref.nodeId.padEnd(20)} ${ref.ref.padEnd(7)} ${ref.value} — ${ref.message}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push(`Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) lines.push(`  ${warning}`);
  }

  return lines.join("\n");
}

export function formatWorkflowRun(run: WorkflowRun): string {
  const lines: string[] = [];
  const counts = formatCounts(run.counts);
  lines.push(`${runHeadingWord(run)} — ${runDisplayName(run)}`);
  lines.push(`runId:        ${run._id}`);
  lines.push(`workflowId:   ${run.workflowId}`);
  if (run.triggerRunId) lines.push(`triggerRunId: ${run.triggerRunId}`);
  // #994: the ruled display word (Succeeded / Succeeded with warnings / …),
  // never the raw stored value in either vocabulary.
  // #935: labelled `status:` — the SAME name the `--json` payload's top-level
  // key uses and the same name the recent-runs table's column header uses, so
  // "the status" means one thing on all three screens. (It was `verdict:` here
  // only, which sent poll loops hunting a `.verdict` JSON field that never
  // existed.) The value is unchanged: still the shared runVerdict() word.
  lines.push(`status:       ${runVerdict(run)}${counts ? ` (${counts})` : ""}`);
  if (run.isTerminal) lines.push("terminal:     yes");
  // #1869: the rulebook this run followed and how it makes its voices. Both
  // silent when the run froze neither.
  const rulesLine = formatRulesLine(run.provenance);
  if (rulesLine) lines.push(rulesLine);
  const treatmentLine = voiceTreatmentLine(run.provenance);
  if (treatmentLine) lines.push(treatmentLine);
  if (run.error) lines.push(`error:        ${run.error}`);
  if (Object.keys(run.inputs ?? {}).length > 0) {
    const inputs = Object.entries(run.inputs).map(([k, v]) => `${k}=${v}`).join(", ");
    lines.push(`inputs:       ${inputs}`);
  }
  // #1079: an --auto-approve launch — say WHICH stops were waved through with
  // nobody looking, so "it finished" never quietly means "it was reviewed".
  if (run.autoApprovals && run.autoApprovals.length > 0) {
    lines.push(
      `auto-approved: ${run.autoApprovals.length} checkpoint stop${
        run.autoApprovals.length === 1 ? "" : "s"
      } (${run.autoApprovals.map((a) => a.nodeId).join(", ")}) — launched with --auto-approve, nobody reviewed these`,
    );
  }

  // #1883: a gated run draws its cheap pictures BEFORE it parks, and nothing
  // used to say the pause was coming — a reader watching a healthy run render
  // for minutes had no way to tell it apart from one running straight through,
  // and cancelled it. The server decides whether the stop is still ahead (it
  // alone can see the graph); this only speaks what it was told.
  if (run.pauseAhead) {
    // Its own paragraph: it is a sentence, and the header above it is a column
    // of `key: value` lines a reader skims rather than reads.
    lines.push("");
    lines.push(pauseAheadLine(run.pauseAhead));
  }

  // #923/#929: while the run is parked at a REVIEW stop (a checkpoint, or a
  // legacy park), the pausedNodeId is the truth even though its node row already
  // reads `done` — flag it (and its outputs) so nothing reads as
  // finished/approved before the human resolves.
  // #931: branch on the park KIND — repair/slots/call parks are also parked
  // awaiting approval, but their paused node holds nothing to review, so they
  // must NOT be relabeled.
  const parkedNodeId = gateParkedNodeId(
    run.status,
    run.pauseReason,
    run.pausedNodeId,
  );

  if (run.nodes.length > 0) {
    lines.push("");
    lines.push(`Nodes (${run.nodes.length}):`);
    for (const node of run.nodes) {
      lines.push(progressLine(node, parkedNodeId !== undefined && node.nodeId === parkedNodeId));
      for (const output of node.outputs) lines.push(...outputLines(output));
    }
  }

  // #1002 (Exit Contract): the workflow's PROMISED results, answered slot by
  // slot — named, typed, and explicit about what did NOT arrive. Rendered above
  // the flat `Outputs:` bag, which stays exactly as it was for back-compat.
  // Optional on the wire: an older backend omits `deliveries` entirely.
  if (run.deliveries && run.deliveries.length > 0) {
    lines.push("");
    lines.push(`Deliveries (${run.deliveries.length}):`);
    for (const delivery of run.deliveries) {
      lines.push(...deliveryLines(delivery, parkedNodeId));
    }
  }

  if (run.outputs && run.outputs.length > 0) {
    lines.push("");
    lines.push(`Outputs (${run.outputs.length}):`);
    for (const output of run.outputs) {
      lines.push(
        ...runOutputLines(
          output,
          parkedNodeId !== undefined && output.nodeId === parkedNodeId,
        ),
      );
    }
  }

  // #893: continue any chat sessions this run opened.
  if (run.sessions && run.sessions.length > 0) {
    lines.push("");
    lines.push(`Sessions (${run.sessions.length}):`);
    for (const s of run.sessions) {
      lines.push(
        `  session: ${s.sessionId} · "${s.title}" · continue: exodus session chat ${s.sessionId} "..."`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * The one unapproved-content phrase — the Outputs artifact suffix and the
 * Deliveries held header both speak it (#929/#1249), and sharing the literal
 * is what keeps the two sections from ever drifting apart.
 */
const NOT_YET_APPROVED = "awaiting approval, not yet approved";

/**
 * Render one flattened final deliverable — the chaining surface (#508).
 * #929: when the run is parked and this deliverable belongs to the parked node,
 * `awaitingReview` flags it so an agent harvesting outputs from a run that is
 * awaiting approval can't mistake unreviewed output for approved copy.
 */
function runOutputLines(output: WorkflowRunOutput, awaitingReview = false): string[] {
  const slug = output.botSlug ? ` (${output.botSlug})` : "";
  const review = awaitingReview ? ` — ${NOT_YET_APPROVED}` : "";
  if (output.type === "image") {
    return [`  ${output.label} [image]${slug}: ${output.imageUrl ?? output.imageId ?? "(no url)"}${review}`];
  }
  // #539 media deliverables — one line each; the JSON output carries full detail.
  if (output.type === "video") {
    const tag = output.final === true ? "final video" : "video";
    return [`  ${output.label} [${tag}]${slug}: ${output.videoUrl ?? "(no url)"}${review}`];
  }
  if (output.type === "audio") {
    return [`  ${output.label} [audio]${slug}: ${output.audioUrl ?? "(no url)"}${review}`];
  }
  if (output.type === "document") {
    const name = output.filename ? ` ${output.filename}` : "";
    return [
      `  ${output.label} [document]${slug}:${name} ${output.documentUrl ?? "(no url)"}${review}`,
    ];
  }
  if (output.type === "frames") {
    const n = output.frames?.length ?? 0;
    return [`  ${output.label} [frames]${slug}: ${n} scene${n === 1 ? "" : "s"}${review}`];
  }
  if (output.type === "storyboard") {
    return [`  ${output.label} [storyboard]${slug}: use --json for the scene plan${review}`];
  }
  const raw = output.text ?? "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  const body = truncateText(raw, 400);
  const note =
    normalized.length > 400 ? "\n    (truncated — use --json for the full text)" : "";
  return [`  ${output.label} [text]${slug}${review}:`, `    ${body}${note}`];
}

/**
 * #1002: render ONE delivery slot — the header line names the slot the way the
 * workflow's author named it (`label (key) · type · status`), and the artifacts
 * that filled it follow indented beneath, reusing the same one-line-per-artifact
 * rendering the flat Outputs block uses. An unfulfilled slot has no artifacts,
 * so its header carries the producer's error instead — that missing-result
 * report is the whole point of the contract.
 */
function deliveryLines(
  delivery: WorkflowRunDelivery,
  parkedNodeId?: string,
): string[] {
  // #1249: the backend counts a settled checkpoint row as a done producer, so
  // a slot fed through an UNAPPROVED checkpoint arrives marked "delivered"
  // while the Output node is still idle. The parked node is the truth (#923):
  // when the slot's artifacts come off that node's wire, render the hold —
  // this section and the Outputs section must never disagree about the same
  // delivery. A slot fed by some OTHER, already-resolved producer on the same
  // parked run stays "delivered".
  const heldArtifact = (a: WorkflowRunOutput) =>
    parkedNodeId !== undefined && a.nodeId === parkedNodeId;
  const held = delivery.status === "delivered" && delivery.artifacts.some(heldArtifact);
  const status = held
    ? `held — ${NOT_YET_APPROVED}`
    : delivery.status === "unfulfilled" && delivery.error
      ? `unfulfilled — ${delivery.error}`
      : delivery.status;
  const lines = [`  ${delivery.label} (${delivery.key}) · ${delivery.type} · ${status}`];
  for (const artifact of delivery.artifacts) {
    // runOutputLines already indents by 2; nest one level under the slot header.
    // A held slot's artifacts carry the same #929 flag the Outputs block shows.
    for (const line of runOutputLines(artifact, heldArtifact(artifact))) {
      lines.push(`  ${line}`);
    }
  }
  return lines;
}

// ── delivery file saving — `--out <dir>` (#1002) ──────────────────────────

/**
 * #1002: what a `--out <dir>` save did. `lines` is the human report (one line
 * per file written or slot skipped); `paths` is just the files that landed, so
 * --json callers get the machine list.
 */
export interface DeliverySaveResult {
  lines: string[];
  paths: string[];
}

/** Extension to fall back on when an asset URL carries none. */
const ASSET_FALLBACK_EXT: Record<string, string> = {
  image: "png",
  video: "mp4",
  audio: "mp3",
};

/**
 * Slugify a workflow name for the filename stem. Always yields something
 * filesystem-safe — an all-punctuation name degrades to "workflow".
 */
export function workflowFilenameSlug(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "workflow";
}

/** The extension an asset URL declares, if it declares one (query string aside). */
function extensionFromUrl(url: string): string | undefined {
  const withoutQuery = url.split(/[?#]/)[0];
  const m = withoutQuery.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : undefined;
}

type ArtifactPlan =
  | { kind: "text"; ext: string; body: string }
  | { kind: "download"; ext: string; url: string }
  | { kind: "none"; reason: string };

/**
 * Decide how ONE artifact becomes a file. Driven by the artifact's own media
 * type rather than the slot's declared type, because the artifact is what
 * actually has to be serialized: text → .md, storyboard/frames → .json
 * (the scene plan / frame index verbatim), image|video|audio → download the
 * resolved storage URL, extension taken from the URL when it has one.
 */
function planArtifactFile(artifact: WorkflowRunOutput): ArtifactPlan {
  if (artifact.type === "text") {
    return { kind: "text", ext: "md", body: artifact.text ?? "" };
  }
  if (artifact.type === "storyboard") {
    const json = artifact.storyboardJson;
    if (!json) return { kind: "none", reason: "no storyboard JSON on this artifact" };
    return { kind: "text", ext: "json", body: json.endsWith("\n") ? json : `${json}\n` };
  }
  if (artifact.type === "frames") {
    // A frame set is a list of per-scene image URLs. Saving the INDEX keeps one
    // slot to one file (the -2/-3 suffix scheme stays per-artifact); the URLs in
    // it are the door to the images themselves.
    return {
      kind: "text",
      ext: "json",
      body: `${JSON.stringify(artifact.frames ?? [], null, 2)}\n`,
    };
  }
  const url =
    artifact.type === "image"
      ? (artifact.imageUrl ?? undefined)
      : artifact.type === "video"
        ? artifact.videoUrl
        : artifact.type === "document"
          ? // #1000: an uploaded document delivered through a slot downloads
            // like any other asset; its own filename supplies the extension.
            artifact.documentUrl
          : artifact.audioUrl;
  if (!url) return { kind: "none", reason: "no downloadable URL on this artifact" };
  const filenameExt =
    artifact.type === "document" && artifact.filename
      ? extensionFromUrl(artifact.filename)
      : undefined;
  return {
    kind: "download",
    ext:
      filenameExt ??
      extensionFromUrl(url) ??
      ASSET_FALLBACK_EXT[artifact.type] ??
      "bin",
    url,
  };
}

/**
 * #1953: the per-artifact filename suffix for ONE delivery slot, named after
 * what each artifact IS rather than where it sat in the array — matching the
 * run page's deliveries rail (`-scene-NN`, `-full`, `-final`) word for word.
 * A slot whose artifacts carry no scene information (copy, documents, images,
 * storyboards) keeps today's positional counter byte-for-byte, `-2` included.
 *
 * `renamed` is true when an identity name collided with an earlier artifact's
 * and the old positional counter was appended instead, so the caller can say
 * so rather than silently overwrite. Pure so it is unit-testable on its own.
 */
function artifactFileSuffixes(
  artifacts: readonly WorkflowRunOutput[],
): Array<{ suffix: string; renamed: boolean }> {
  const sceneBearing = artifacts.some(
    (a) => typeof a.sceneIndex === "number" || a.final === true,
  );
  if (!sceneBearing) {
    return artifacts.map((_, i) => ({
      suffix: i === 0 ? "" : `-${i + 1}`,
      renamed: false,
    }));
  }

  const taken = new Set<string>();
  let fullCount = 0;
  return artifacts.map((a, i) => {
    let suffix: string;
    if (typeof a.sceneIndex === "number") {
      suffix = `-${scenePrefix(a.sceneIndex)}`;
    } else if (a.final === true) {
      suffix = "-final";
    } else if (a.type === "audio") {
      // A scene-less audio in a scene-bearing slot is the whole-ad take (or an
      // uploaded track — the rail treats them the same), numbered like the rail.
      fullCount += 1;
      suffix = fullCount === 1 ? "-full" : `-full-${fullCount}`;
    } else {
      suffix = i === 0 ? "" : `-${i + 1}`;
    }

    if (taken.has(suffix)) {
      // Two artifacts resolved to the same name (e.g. two takes of scene 3) —
      // append the old positional counter rather than overwrite.
      let fallback = `${suffix}-${i + 1}`;
      while (taken.has(fallback)) fallback = `${fallback}-${i + 1}`;
      suffix = fallback;
      taken.add(suffix);
      return { suffix, renamed: true };
    }
    taken.add(suffix);
    return { suffix, renamed: false };
  });
}

/**
 * #1002 (`--out <dir>`): write every DELIVERED output of a terminal run to
 * files under `dir`, named `<workflow-slug>-<runId tail>-<key>[-n].<ext>`. The
 * slot `key` is unique within the run, so the name is stable and collision-free
 * across slots; a slot carrying several artifacts suffixes -2, -3, … .
 *
 * Nothing here throws: a run that isn't finished, a backend with no
 * `deliveries`, an unfulfilled slot, and a failed download all come back as a
 * reported line so the operator learns exactly what did and didn't land.
 */
export async function saveDeliveries(
  run: WorkflowRun,
  dir: string,
  deps: WorkflowRunDeps,
): Promise<DeliverySaveResult> {
  const paths: string[] = [];

  if (!run.isTerminal) {
    return {
      paths,
      lines: [
        `Nothing saved — this run isn't finished yet (${run.status}). Try again once it is: exodus workflow status --id ${run._id} --out ${dir}`,
      ],
    };
  }

  const deliveries = run.deliveries ?? [];
  if (deliveries.length === 0) {
    return {
      paths,
      lines: [
        "Nothing saved — this run has no named delivery slots. Either the workflow has no Output nodes, or the backend it ran on predates named outputs.",
      ],
    };
  }

  const mkdirp = deps.mkdirp ?? defaultMkdirp;
  const downloadToFile = deps.downloadToFile ?? defaultDownloadToFile;
  mkdirp(dir);

  const stem = `${workflowFilenameSlug(run.workflowName)}-${run._id.slice(-8)}`;
  const lines: string[] = [`Saved deliveries to ${dir}:`];

  for (const delivery of deliveries) {
    if (delivery.status !== "delivered" || delivery.artifacts.length === 0) {
      const why =
        delivery.error !== undefined
          ? `unfulfilled: ${delivery.error}`
          : delivery.status === "delivered"
            ? "delivered but empty"
            : "unfulfilled";
      lines.push(`  skipped  ${delivery.label} (${delivery.key}) — ${why}`);
      continue;
    }
    const suffixes = artifactFileSuffixes(delivery.artifacts);
    for (let i = 0; i < delivery.artifacts.length; i++) {
      const plan = planArtifactFile(delivery.artifacts[i]);
      const { suffix, renamed } = suffixes[i];
      if (plan.kind === "none") {
        lines.push(`  skipped  ${delivery.label} (${delivery.key})${suffix} — ${plan.reason}`);
        continue;
      }
      // The backend guarantees kebab keys, but a filename must never trust the
      // wire: re-slug locally so a malformed key can't escape the target dir.
      const file = nodePath.join(
        dir,
        `${stem}-${workflowFilenameSlug(delivery.key)}${suffix}.${plan.ext}`,
      );
      try {
        if (plan.kind === "text") deps.writeFile(file, plan.body);
        else await downloadToFile(plan.url, file);
        lines.push(`  wrote    ${file}${renamed ? " — renamed to avoid a collision" : ""}`);
        paths.push(file);
      } catch (e) {
        lines.push(`  failed   ${file} — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  lines.push(`${paths.length} file${paths.length === 1 ? "" : "s"} written.`);
  return { lines, paths };
}

// ── describe rendering (#506) ────────────────────────────────────────────

/**
 * #1013: the accepted-value hint for one typed input, worded exactly like the
 * server's launch rejection ("expected one of: a, b", "expected true or false")
 * so what describe promises and what a rejected run says line up. Undefined for
 * a plain text box and for a number (the type tag on the header line says it
 * all).
 */
function inputValueHint(input: WorkflowInputDescriptor): string | undefined {
  // #1150: an OPEN list ("Other…") accepts an answer that is on no list at all,
  // so the hint has to say so — otherwise describe reads as a closed menu and
  // nobody discovers the answer they actually want is allowed. A LIBRARY list
  // needs no extra words: describe already resolved the live rows into
  // `options`, so the ordinary "one of: …" IS the current, true list.
  const open = input.allowOther ? ", or your own answer" : "";
  if (input.type === "select") {
    const options = input.options ?? [];
    return options.length > 0 ? `one of: ${options.join(", ")}${open}` : undefined;
  }
  if (input.type === "multi-select") {
    // The value is ONE string: the picks comma-joined. Say the separator — it
    // is the difference between `--input key=a,b` and a rejected run.
    const options = input.options ?? [];
    return options.length > 0
      ? `one or more of: ${options.join(", ")} (comma-separated)${open}`
      : undefined;
  }
  if (input.type === "toggle") return "true or false";
  return undefined;
}

/**
 * #1082: the delivery slot's type in WORDS. The wire vocabulary
 * (text/structured/asset/collection) is authoring shorthand; describe is read by
 * people deciding what a run will hand back, so spell it.
 *
 * An unknown value (a newer backend growing a fifth type) prints verbatim rather
 * than being dropped or mislabelled.
 */
export function deliveryTypeWord(type: string): string {
  switch (type) {
    case "text":
      return "text";
    case "structured":
      return "structured data";
    case "asset":
      return "file";
    case "collection":
      return "set of files";
    default:
      return type;
  }
}

/**
 * #1082: the "Delivers" block — the workflow's EXIT contract, one line per named
 * slot in the author's presentation order, with the author's note indented under
 * it. Pure so the shape is unit-testable without a describe round-trip.
 *
 * Returns [] for `undefined` (a backend that predates the field — the caller
 * must then print nothing at all, keeping old output byte-for-byte), and the
 * plain "nothing" line for `[]` (a workflow with no Output node, which IS a
 * fact worth printing).
 */
export function deliveryContractLines(
  deliveries: WorkflowDeliveryDescriptor[] | undefined,
): string[] {
  if (deliveries === undefined) return [];
  if (deliveries.length === 0) return ["Delivers: nothing — no Output node."];
  const lines: string[] = [`Delivers (${deliveries.length}):`];
  // `order` is the author's presentation index; sort by it rather than trusting
  // array order, and fall back to array order for ties/missing values.
  const ordered = deliveries
    .map((delivery, index) => ({ delivery, index }))
    .sort((a, b) => (a.delivery.order ?? a.index) - (b.delivery.order ?? b.index) || a.index - b.index)
    .map((entry) => entry.delivery);
  for (const delivery of ordered) {
    lines.push(`  ${delivery.label} (${delivery.key}) — ${deliveryTypeWord(delivery.type)}`);
    if (delivery.description) lines.push(`      ${delivery.description}`);
  }
  return lines;
}

export function formatDescribe(res: WorkflowDescribeResponse): string {
  const lines: string[] = [];
  lines.push(`Workflow — ${res.name}`);
  lines.push(`workflowId:  ${res.workflowId}`);
  if (res.description) lines.push(`description:  ${res.description}`);
  lines.push(`updated:     ${dateOnly(res.updatedAt)}`);

  // #518: warnings go FIRST — above Inputs, right under the identity block —
  // because they change how everything below reads. The motivating case is a
  // stale workflow whose own saved input description says the swipe bundle is
  // "read to build the brand primer": member-authored prose in the database
  // that describe copies verbatim (see the `input.description` line below).
  // That sentence can't be rewritten from here, and shouldn't be — so the
  // warning at the top is what makes it readable in context.
  // Absent field (a pre-#518 backend) prints nothing at all; `[]` prints
  // nothing either — describe renders exactly as it always did.
  if (res.warnings && res.warnings.length > 0) {
    lines.push("");
    lines.push(`✗ ${res.warnings.length === 1 ? "Warning" : "Warnings"}:`);
    for (const warning of res.warnings) lines.push(`  ✗ ${warning}`);
  }

  lines.push("");
  lines.push(`Inputs (${res.inputs.length}):`);
  if (res.inputs.length === 0) {
    lines.push("  (none — this workflow takes no run inputs)");
  } else {
    for (const input of res.inputs) {
      const req = input.required ? "required" : "optional";
      // #1013: a Brief that declares a widget (select/number/toggle) is always a
      // TEXT-sourced field, so the tag refines the source rather than replacing
      // it. Omitted for a plain text box — that line renders exactly as pre-#1013.
      const type = input.type && input.type !== "text" ? ` (${input.type})` : "";
      const bundle =
        input.bundleSize !== undefined ? `, bundle=${input.bundleSize}` : "";
      // An asset field takes a FILE, so name the family it accepts — that's the
      // difference between "--input hero=text" and "--input hero=./hero.png".
      const family = input.source === "asset" && input.assetType ? ` (${input.assetType})` : "";
      // #1072: the authored question, when there is one. The KEY still leads —
      // that is what `--input key=value` takes — and the label just says what
      // the key is asking for.
      const label = input.label ? ` (${input.label})` : "";
      lines.push(
        `  ${input.fieldName}${label} — ${input.source}${family}${type}, ${req}${bundle}`,
      );
      const hint = inputValueHint(input);
      if (hint) lines.push(`      ${hint}`);
      // #518: this is the AUTHOR'S OWN prose out of the saved graph
      // (config.description on the Brief node), printed verbatim. It can be
      // stale or plain wrong — the #518 workflow's says its swipe bundle is
      // "read to build the brand primer", which is exactly the thing that no
      // longer runs. Rewriting a member's words in the database is not on the
      // table, so the honesty lives in the warning block at the TOP instead.
      if (input.description) lines.push(`      ${input.description}`);
    }
  }

  lines.push("");
  lines.push(`Prerequisites (${res.prerequisites.length}):`);
  if (res.prerequisites.length === 0) {
    lines.push("  (none — no stored primers required)");
  } else {
    for (const prereq of res.prerequisites) {
      const mark = prereq.stored ? "✓ stored" : "✗ MISSING";
      lines.push(`  ${mark}  ${prereq.primerKind} primer  (nodes: ${prereq.nodeIds.join(", ")})`);
    }
    const missing = res.prerequisites.filter((p) => !p.stored);
    if (missing.length > 0) {
      lines.push("");
      lines.push(
        `  ✗ ${missing.length} primer(s) not stored for this brand — add ${missing
          .map((p) => `"${p.primerKind}"`)
          .join(", ")} before running, or those nodes fail.`,
      );
    }
  }

  lines.push("");
  lines.push(`Outputs (${res.outputs.length}):`);
  if (res.outputs.length === 0) {
    lines.push("  (none wired into an Output node)");
  } else {
    for (const output of res.outputs) {
      const slug = output.botSlug ? ` (${output.botSlug})` : "";
      lines.push(`  ${output.label} [${output.type}]${slug}`);
    }
  }

  // #1082: the EXIT contract, under the raw collected-outputs bag above. Only
  // when the backend actually sent the field — against a pre-#1082 backend this
  // block is absent entirely and describe prints exactly what it always did.
  const delivers = deliveryContractLines(res.deliveries);
  if (delivers.length > 0) {
    lines.push("");
    lines.push(...delivers);
  }

  return lines.join("\n");
}

// ── bot catalog rendering (#507) ──────────────────────────────────────────

function formatBotVocabulary(catalog: WorkflowCatalog): string {
  const v = catalog.vocabulary;
  const lines: string[] = [];
  lines.push("Vocabulary:");
  lines.push(`  node kinds:    ${v.nodeKinds.join(", ")}`);
  lines.push(`  brief sources: ${v.briefSources.join(", ")}`);
  lines.push(`  primer kinds:  ${v.primerKinds.join(", ")}`);
  // #1258: tolerant read — a pre-#1258 server omits the lanes.
  if (v.primerAwarenessLanes?.length) {
    lines.push(
      `  body primer awareness lanes (config.primerAwareness, body kind only): ${v.primerAwarenessLanes.join(", ")}`,
    );
  }
  lines.push(`  image models:  ${v.imageModels.join(", ")}`);
  lines.push(`  aspect ratios: ${v.aspectRatios.join(", ")}`);
  lines.push(
    `  custom bot:    set a bot node's slug to "${catalog.customBot.slug}" and ` +
      `config.${catalog.customBot.configKey}=<genesis-slug> to reach any bot not listed here.`,
  );
  lines.push(
    `  prompt bot:    set a bot node's slug to "${catalog.promptBot.slug}" and ` +
      `config.${catalog.promptBot.configKey}=<your instructions> — the prompt IS the bot ` +
      "(runs on the workspace's own LLM key, not Genesis).",
  );
  return lines.join("\n");
}

export function formatBotsList(
  catalog: WorkflowCatalog,
  category?: string,
): string {
  const bots = category
    ? catalog.bots.filter((b) => b.category === category)
    : catalog.bots;
  if (bots.length === 0) {
    const known = catalog.vocabulary.categories.map((c) => c.id).join(", ");
    return category
      ? `No bots in category "${category}". Known categories: ${known}`
      : "No bots in the catalog.";
  }

  const lines: string[] = [];
  let currentCategory: string | null = null;
  for (const bot of bots) {
    if (bot.category !== currentCategory) {
      if (currentCategory !== null) lines.push("");
      lines.push(`${bot.categoryLabel} (${bot.category})`);
      currentCategory = bot.category;
    }
    lines.push(`  ${bot.slug} — ${bot.blurb}`);
  }

  if (!category) {
    lines.push("");
    lines.push(formatBotVocabulary(catalog));
  }
  return lines.join("\n");
}

export function formatBotDetail(bot: CatalogBot): string {
  const lines: string[] = [];
  lines.push(`${bot.name}  (slug: ${bot.slug})`);
  lines.push(`category:    ${bot.categoryLabel} (${bot.category})`);
  lines.push(`blurb:       ${bot.blurb}`);
  lines.push(`outputType:  ${bot.outputType}`);

  lines.push("");
  lines.push(`Input ports (${bot.inputs.length}):`);
  if (bot.inputs.length === 0) {
    lines.push("  (none)");
  } else {
    for (const input of bot.inputs) {
      const bits = [`accepts ${input.accepts.join("/")}`, input.required ? "required" : "optional"];
      if (input.multi) bits.push("multi");
      if (input.primerKinds && input.primerKinds.length > 0) {
        bits.push(`primer-gate: ${input.primerKinds.join("/")}`);
      }
      lines.push(`  ${input.id} — ${bits.join(", ")}`);
    }
  }

  lines.push("");
  lines.push(`Params (${bot.params.length}):`);
  if (bot.params.length === 0) {
    lines.push("  (none)");
  } else {
    for (const param of bot.params) {
      const bits: string[] = [param.kind];
      if (param.options && param.options.length > 0) bits.push(`options: ${param.options.join("|")}`);
      if (param.min !== undefined) bits.push(`min ${param.min}`);
      if (param.max !== undefined) bits.push(`max ${param.max}`);
      if (param.required) bits.push("required");
      if (param.default !== undefined) bits.push(`default "${param.default}"`);
      lines.push(`  config.${param.key} — ${param.label} (${bits.join(", ")})`);
      if (param.help) lines.push(`      ${param.help}`);
    }
  }

  return lines.join("\n");
}

// ── templates rendering (#892) ────────────────────────────────────────────

/** First line only — the list stays one row per template. */
function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return (nl === -1 ? text : text.slice(0, nl)).trim();
}

export function formatTemplatesList(templates: WorkflowTemplateListItem[]): string {
  if (templates.length === 0) return "No workflow templates available on this backend.";
  const lines = [
    table(
      ["key", "label", "description"],
      templates.map((t) => [
        t.key,
        // Badge a module-owned template so it's clear its runs start elsewhere.
        t.module ? `${t.label} [${t.module} module]` : t.label,
        firstLine(t.description ?? ""),
      ]),
    ),
  ];
  if (templates.some((t) => t.module)) {
    lines.push("");
    lines.push(
      "Templates badged [<module> module] are owned by a module (e.g. video) — " +
        "their runs start from the show surfaces, not `workflow run`. Export one to " +
        "study or adapt its graph.",
    );
  }
  lines.push("");
  lines.push("Export one to start authoring: exodus workflow templates export <key> --out my.yaml");
  return lines.join("\n");
}

// ── schema rendering (#892) ───────────────────────────────────────────────
// The schema payload is treated as opaque-ish JSON: rendered generically so a
// future additive server field never breaks the human view. Known sections are
// printed in the reference-doc order; anything else the server adds is ignored
// by the human view but always present under --json.

const SCHEMA_LABEL_KEYS = ["kind", "face", "type", "name", "id", "code", "key", "label"] as const;

/** The identifying key/value of a schema entry object, if it has one. */
function schemaEntryLabel(entry: Record<string, unknown>): { key: string; value: string } | undefined {
  for (const key of SCHEMA_LABEL_KEYS) {
    const v = entry[key];
    if (typeof v === "string" && v) return { key, value: v };
  }
  return undefined;
}

/** Generic, resilient renderer for any JSON value under a schema section. */
function schemaValueLines(value: unknown, indent: string): string[] {
  if (value === null || value === undefined) return [`${indent}(none)`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}(none)`];
    const lines: string[] = [];
    for (const el of value) {
      if (isRecord(el)) {
        const label = schemaEntryLabel(el);
        if (label) {
          // #1012: a PARKED node kind still ships in the schema (old graphs must
          // stay readable) — it just isn't offered as a new card. Flag it on the
          // header line instead of burying `parked: true` in the detail block.
          const parked = el["parked"] === true;
          lines.push(`${indent}- ${label.value}${parked ? " (parked)" : ""}`);
          const rest = { ...el };
          delete rest[label.key];
          if (parked) delete rest["parked"];
          lines.push(...schemaValueLines(rest, `${indent}    `));
        } else {
          lines.push(`${indent}-`);
          lines.push(...schemaValueLines(el, `${indent}    `));
        }
      } else {
        lines.push(`${indent}- ${String(el)}`);
      }
    }
    return lines;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [`${indent}(none)`];
    const lines: string[] = [];
    for (const [k, v] of entries) {
      if (isRecord(v) || Array.isArray(v)) {
        lines.push(`${indent}${k}:`);
        lines.push(...schemaValueLines(v, `${indent}    `));
      } else {
        lines.push(`${indent}${k}: ${String(v)}`);
      }
    }
    return lines;
  }
  return [`${indent}${String(value)}`];
}

// title → candidate payload keys, in the reference-doc section order.
const SCHEMA_SECTIONS: Array<{ title: string; keys: string[] }> = [
  { title: "Graph contract version", keys: ["graphVersion"] },
  { title: "Port types", keys: ["portTypes"] },
  { title: "Node kinds", keys: ["nodeKinds"] },
  { title: "Transform faces", keys: ["transformFaces"] },
  { title: "Collector policy", keys: ["collectorPolicy"] },
  { title: "Deposits", keys: ["deposits"] },
  { title: "Slots", keys: ["slots"] },
  { title: "Triggers", keys: ["triggers"] },
  { title: "Edge / graph rules", keys: ["edgeRules", "graphRules"] },
  {
    title: "Bots",
    keys: ["botsPointer", "botsPointerNote", "bots-pointer-note", "botsNote", "bots"],
  },
];

function schemaSectionValue(
  payload: Record<string, unknown>,
  keys: string[],
): { key: string; value: unknown } | undefined {
  for (const key of keys) {
    if (payload[key] !== undefined) return { key, value: payload[key] };
  }
  return undefined;
}

export function formatSchema(payload: Record<string, unknown>): string {
  const lines: string[] = [];
  const version = payload["version"];
  lines.push(`Workflow schema${version !== undefined ? ` (version ${version})` : ""}`);
  for (const section of SCHEMA_SECTIONS) {
    const found = schemaSectionValue(payload, section.keys);
    if (!found) continue;
    lines.push("");
    lines.push(`${section.title}:`);
    lines.push(...schemaValueLines(found.value, "  "));
  }
  return lines.join("\n");
}

/** Collect the identifiers of a schema list section (for filter miss messages). */
function schemaEntryIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const el of value) {
    if (isRecord(el)) {
      const label = schemaEntryLabel(el);
      if (label) ids.push(label.value);
    } else if (typeof el === "string") {
      ids.push(el);
    }
  }
  return ids;
}

/**
 * Render just one entry of a list-shaped schema section, matched by identifier.
 * `label` names the axis ("kind"/"face") for the not-found message. Returns a
 * FlowResult so the miss is a clean exit-1 line listing the valid values.
 */
function formatSchemaFilter(
  payload: Record<string, unknown>,
  sectionKeys: string[],
  axis: string,
  wanted: string,
): FlowResult {
  const found = schemaSectionValue(payload, sectionKeys);
  const list = found && Array.isArray(found.value) ? found.value : [];
  const match = list.find((el) => {
    if (!isRecord(el)) return typeof el === "string" && el === wanted;
    const label = schemaEntryLabel(el);
    return label?.value === wanted;
  });
  if (match === undefined) {
    const valid = schemaEntryIds(found?.value).join(", ") || "(none)";
    return { code: 1, lines: [`Unknown ${axis} "${wanted}". Valid ${axis}s: ${valid}`] };
  }
  const title = axis === "kind" ? "Node kind" : "Transform face";
  const lines = [`${title}: ${wanted}`];
  if (isRecord(match)) {
    const label = schemaEntryLabel(match);
    const rest = { ...match };
    if (label) delete rest[label.key];
    lines.push(...schemaValueLines(rest, "  "));
  }
  return { code: 0, lines };
}

// ── import error rendering (#509/#510) ────────────────────────────────────

/** A compiler-style line per graph issue, with an indented remedy when present. */
function graphIssueLines(issue: GraphIssue): string[] {
  const node = issue.nodeId ? ` [node ${issue.nodeId}]` : "";
  const port = issue.portId ? ` [port ${issue.portId}]` : "";
  const edge = !issue.nodeId && issue.edgeId ? ` [edge ${issue.edgeId}]` : "";
  const out = [`${issue.code}${node}${edge}${port}: ${issue.message}`];
  if (issue.remedy) out.push(`  fix: ${issue.remedy}`);
  return out;
}

/** Human rendering for every import error code (INVALID_GRAPH / CONFLICT / …). */
function formatImportError(res: ApiResponse<unknown>): string {
  const data = isRecord(res.data) ? res.data : {};
  const err = isRecord(data.error) ? data.error : {};
  const code = typeof err.code === "string" ? err.code : undefined;
  const message = typeof err.message === "string" ? err.message : "Import failed";

  if (code === "INVALID_GRAPH") {
    const issues = Array.isArray(data.issues) ? (data.issues as GraphIssue[]) : [];
    const lines = [`Import rejected — invalid graph: ${message}`];
    if (issues.length > 0) {
      lines.push("");
      lines.push(`Issues (${issues.length}):`);
      for (const issue of issues) lines.push(...graphIssueLines(issue));
    }
    return lines.join("\n");
  }

  if (code === "CONFLICT") {
    const lines = [`Import conflict — ${message}`];
    if (typeof data.currentUpdatedAt === "string") {
      lines.push(`current updatedAt: ${data.currentUpdatedAt}`);
    }
    const remedy =
      typeof data.remedy === "string"
        ? data.remedy
        : "Re-export the workflow, reapply your edits, and import again with the fresh updatedAt.";
    lines.push(`fix: ${remedy}`);
    return lines.join("\n");
  }

  // FORBIDDEN / NOT_FOUND / BAD_REQUEST / anything else → the shared clean render.
  return formatApiError(res);
}

// ── Network-touching flows (dependency-injected for tests) ───────────────

/**
 * #931: thrown by resolveWorkflowId so each flow's catch can render a structured
 * `{ ok: false, status, data }` envelope under --json (via {@link resolveIdErrorResult}),
 * matching every other error path — instead of leaking a bare human string.
 * `message` stays the clean human one-liner + remedy for non-JSON mode.
 */
class WorkflowResolveError extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowResolveError";
  }
}

export async function resolveWorkflowId(ref: string, deps: WorkflowRunDeps): Promise<string> {
  const res = await deps.get(LIST_PATH);
  // The list fetch itself failed — carry the server response through so --json
  // callers get the same `{ status, data }` envelope every server error yields.
  if (!res.ok) throw new WorkflowResolveError(res.status, res.data, formatApiError(res));
  const workflows = (res.data as WorkflowListResponse).workflows ?? [];
  // A NAME (case-insensitive) resolves to its id.
  const byName = workflows.find((w) => w.name.toLowerCase() === ref.toLowerCase());
  if (byName) return byName._id;
  // A raw id the member passed directly is only trusted when it's a workflow
  // actually visible to this brand (present in the list, cross-brand rows
  // included). #919: never fall through to sending an unrecognized name/id as
  // the `id` param — the server rejects it as "id is not a valid workflow id",
  // which reads like a CLI plumbing failure when the member passed a name. Fail
  // client-side with the remedy instead.
  const byId = workflows.find((w) => w._id === ref);
  if (byId) return byId._id;
  // #931: a client-side miss synthesizes a NOT_FOUND envelope (mirroring the
  // server error shape asErrorResult renders) so --json stays parseable.
  const message = `No workflow named "${ref}" on this brand — run: exodus workflow list`;
  throw new WorkflowResolveError(
    404,
    { error: { code: "NOT_FOUND", message } },
    message,
  );
}

export async function listFlow(json: boolean, deps: WorkflowRunDeps): Promise<FlowResult> {
  const res = await deps.get(LIST_PATH);
  if (!res.ok) return asErrorResult(res, json);
  const data = res.data as WorkflowListResponse;
  return {
    code: 0,
    lines: json ? [JSON.stringify(data)] : [formatWorkflowList(data.workflows ?? [])],
  };
}

export async function describeFlow(
  workflowRef: string,
  opts: { json: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  let workflowId: string;
  try {
    workflowId = await resolveWorkflowId(workflowRef, deps);
  } catch (e) {
    // #931: honor --json — a name/id miss is a structured envelope, not a bare line.
    return resolveIdErrorResult(e, opts.json ?? false);
  }

  const res = await deps.get(`${DESCRIBE_PATH}?id=${encodeURIComponent(workflowId)}`);
  if (!res.ok) return asErrorResult(res, opts.json);
  if (opts.json) return { code: 0, lines: [JSON.stringify(res.data)] };
  return { code: 0, lines: [formatDescribe(res.data as WorkflowDescribeResponse)] };
}

export async function botsFlow(
  opts: { category?: string; slug?: string; json: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const res = await deps.get(CATALOG_PATH);
  if (!res.ok) return asErrorResult(res, opts.json);
  const catalog = res.data as WorkflowCatalog;

  if (opts.slug) {
    const bot = catalog.bots.find((b) => b.slug === opts.slug);
    if (!bot) {
      const line = opts.json
        ? JSON.stringify({ ok: false, error: `unknown bot slug "${opts.slug}"` })
        : `No bot with slug "${opts.slug}" in the catalog. Run "exodus workflow bots" to list them.`;
      return { code: 1, lines: [line] };
    }
    return { code: 0, lines: [opts.json ? JSON.stringify(bot) : formatBotDetail(bot)] };
  }

  // --json (with or without --category) always emits the FULL catalog verbatim.
  if (opts.json) return { code: 0, lines: [JSON.stringify(catalog)] };
  return { code: 0, lines: [formatBotsList(catalog, opts.category)] };
}

/**
 * #1846: the one line a launch receipt says about the voices it attached. The
 * label comes first because that is the word the member wrote in voices.json;
 * the id is all there is when the file gave only an id and ElevenLabs could not
 * be reached to name it. Read defensively — an older backend sends nothing.
 */
function launchVoicesLine(attached: unknown): string | undefined {
  if (!Array.isArray(attached)) return undefined;
  const said: string[] = [];
  for (const raw of attached) {
    if (!raw || typeof raw !== "object") continue;
    const { speaker, voiceId, label } = raw as Record<string, unknown>;
    if (typeof speaker !== "string" || typeof voiceId !== "string") continue;
    said.push(`${speaker} → ${typeof label === "string" && label !== "" ? label : voiceId}`);
  }
  return said.length > 0 ? `Voices: ${said.join(", ")}` : undefined;
}

/**
 * #1869: the one sentence every surface says about how a run makes its voices —
 * the launch receipt, `workflow status` and the pull manifest's human line.
 * Read defensively: whatever the backend sends that is not this shape prints
 * nothing at all, which is what a backend older than #1869 sends.
 */
export function voiceTreatmentLine(provenance: unknown): string | undefined {
  const voice = (provenance as RunProvenance | undefined)?.voice;
  if (!voice || typeof voice !== "object") return undefined;
  if (voice.source === "unreadable") {
    return (
      "Voice treatment: the setting saved when this run started cannot be read, so no " +
      "clip will be made. Start the run again."
    );
  }
  // Read as unknown: the mirror's closed union is what the server sends today,
  // not what an older or newer one might.
  const path: unknown = voice.path;
  if (typeof path !== "string" || path === "") return undefined;
  const where = voice.source === "show" ? "from its Show" : "chosen at launch";
  const described =
    voice.source === "launch" && Array.isArray(voice.descriptions) && voice.descriptions.length > 0
      ? `. Written voices: ${voice.descriptions.map((d) => d.speaker).join(", ")}`
      : "";
  return `Voice treatment: ${path} (${where})${described}`;
}

export async function runFlow(
  workflowRef: string,
  opts: RunFlowOptions,
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  let workflowId: string;
  try {
    workflowId = await resolveWorkflowId(workflowRef, deps);
  } catch (e) {
    // #931: honor --json — a name/id miss is a structured envelope, not a bare line.
    return resolveIdErrorResult(e, opts.json ?? false);
  }

  // Stage 3B: `opts.inputs` arrives RAW. Asset fields upload their local file
  // and become an assetId here; every other field gets the `@path` expansion.
  // Upload notes stream immediately when the caller streams (they happen before
  // the run exists); otherwise they ride ahead of the returned lines.
  const preface: string[] = [];
  let prepared: PreparedRunInputs;
  try {
    prepared = await prepareRunInputs(
      workflowId,
      opts.inputs,
      deps,
      (line) => {
        if (opts.json) return;
        if (opts.onProgressLine) opts.onProgressLine(line);
        else preface.push(line);
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      code: 1,
      lines: opts.json
        ? // Same envelope asErrorResult renders, so --json stays parseable for a
          // client-side refusal too (#931's rule).
          [JSON.stringify({ ok: false, status: 400, data: { error: { code: "BAD_REQUEST", message } } })]
        : [...preface, message],
    };
  }
  const inputs = prepared.inputs;

  // #1082: say the pre-launch heads-up BEFORE the run is spent — on both the
  // --wait and no-wait paths, and in --json mode too (it goes to stderr, so it
  // can't corrupt the JSON on stdout). It never prompts and never aborts.
  const warned: string[] = [];
  for (const warning of prepared.warnings) {
    warned.push(warning);
    opts.onWarningLine?.(warning);
  }

  const body = {
    workflowId,
    ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
    // #1013: reuse a saved fill by name. Sent alongside `inputs` — the server
    // merges the fill first and lets each explicit input override its key — and
    // omitted entirely when no --fill was passed, so an ordinary run's body is
    // byte-identical to pre-#1013.
    ...(opts.fill && opts.fill.trim() !== "" ? { fill: opts.fill.trim() } : {}),
    // #1079: unattended launch — the server auto-approves every Checkpoint this
    // run reaches. Only ever sent as `true`: omitted when the flag is absent, so
    // an ordinary run's body stays byte-identical to pre-#1079 and no backend
    // can read an explicit `false` as anything but the default.
    ...(opts.autoApprove === true ? { autoApprove: true } : {}),
    // #1084 (F2): the per-run Image Rig re-aim, relayed as the object the flag
    // parsed. A SIBLING of `inputs` (inputs are strings; this is structured), and
    // omitted when the flag wasn't passed, so an ordinary run's body is
    // byte-identical to pre-#1084. The server judges what it points at — it is
    // the only side holding the graph — and answers with the exact key path.
    ...(opts.imageRigOverrides ? { imageRigOverrides: opts.imageRigOverrides } : {}),
    // #1846: the voices this run starts with. A SIBLING of `inputs` for the
    // same reason the rig re-aim is one — inputs are clamped to strings — and
    // omitted when --voices wasn't passed. The server judges the speaker names
    // against the script and the voice ids against the member's ElevenLabs
    // account, and refuses before the run row exists, so nothing is spent.
    ...(opts.voices ? { voices: opts.voices } : {}),
    // #1869: how this run makes its voices. A SIBLING of `voices`, not a merge:
    // a treatment that plays chosen voices takes both, and one where the video
    // model speaks from written words refuses the pair outright rather than
    // charging for voices it would never play. Omitted when the flag wasn't
    // passed, so an ordinary run's body is byte-identical to pre-#1869.
    ...(opts.voiceTreatment ? { voiceTreatment: opts.voiceTreatment } : {}),
    // #1089: name the SURFACE this run was fired from so the Runs board's
    // Launched-via filter can tell a terminal launch from a script hitting the
    // same v2 route. Sent unconditionally (unlike the flags above) because it
    // describes the client, not the launch — every `exodus workflow run` is a
    // CLI run. The route only ever honours the exact string "cli" and downgrades
    // anything else to "programmatic", so an older backend that doesn't know the
    // field simply ignores it and the run starts exactly as it does today.
    launchedVia: "cli",
  };
  const start = await deps.post(RUN_PATH, body);
  if (!start.ok) return asErrorResult(start, opts.json);

  const data = start.data as WorkflowRunStartResponse;
  // #1082: relay any server-side warning the local pre-check didn't already
  // cover. Same stderr seam, so --json stdout stays one clean object.
  for (const warning of serverWarningsToPrint(data?.warnings, warned)) {
    warned.push(warning);
    opts.onWarningLine?.(warning);
  }
  const base = { ...data, workflowId };
  if (opts.json && !opts.wait) return { code: 0, lines: [JSON.stringify(base)] };

  const voicesLine = launchVoicesLine(data?.launchVoices);
  // #1869: what rulebook this run is following, and any heads-up that comes
  // with it. Both silent on a run that froze no rules.
  const provenance = { format: data?.format ?? null, voice: data?.voice ?? null };
  const rulesLine = formatRulesLine(provenance);
  const treatmentLine = voiceTreatmentLine(provenance);
  const advisories = Array.isArray(data?.advisories)
    ? data.advisories.filter((line): line is string => typeof line === "string")
    : [];
  const lines = opts.json
    ? []
    : [
        ...preface,
        "Workflow run started.",
        `runId:        ${data.runId}`,
        `triggerRunId: ${data.triggerRunId}`,
        ...(rulesLine ? [rulesLine] : []),
        ...advisories,
        ...(voicesLine ? [voicesLine] : []),
        ...(treatmentLine ? [treatmentLine] : []),
        `Poll: exodus workflow status --id ${data.runId}`,
      ];

  if (!opts.wait) {
    // #1002: nothing to save yet — files only exist once the run finishes, so
    // say so rather than leaving an empty directory and a silent flag.
    if (opts.out !== undefined && !opts.json) {
      lines.push(
        `Nothing saved to ${opts.out} yet — the run is still going. Add --wait, or save later: exodus workflow status --id ${data.runId} --out ${opts.out}`,
      );
    }
    return { code: 0, lines };
  }

  if (!opts.json && opts.onProgressLine) {
    for (const line of lines) opts.onProgressLine(line);
    lines.length = 0;
  }

  const waited = await waitForRun(
    data.runId,
    { json: opts.json, onProgressLine: opts.onProgressLine, jsonBase: base, out: opts.out },
    deps,
  );
  // In --json mode waitForRun's single line is complete on its own. In human
  // mode, prepend whatever start lines weren't already streamed via onProgress.
  if (opts.json) return waited;
  return { code: waited.code, lines: [...lines, ...waited.lines] };
}

/**
 * #893: the shared run-wait loop used by `workflow run --wait` and
 * `workflow triggers … fire --wait`. Polls the status endpoint to a terminal
 * state, streaming per-node progress (and the cost-gate pause line once) via
 * `onProgressLine` in human mode. Returns the terminal render:
 *   - --json: one line, `{ ...jsonBase, result, timedOut }`.
 *   - human:  a timeout pointer, or ["", formatWorkflowRun(run)].
 *
 * #998 `landOnPark`: some waits are DESIGNED to end on a park rather than on a
 * finished run — `checkpoint retry` re-runs the step feeding the checkpoint and
 * the run parks straight back at the same checkpoint with fresh output. For those, that park IS the
 * success, so it must stop the loop (opt-in only: without this option every
 * `awaiting-review` stays non-terminal exactly as before).
 *
 * #1788: one exception applies to EVERY caller — a video run parked at its
 * storyboard gate or final watch ends the wait (see videoParkStop below).
 */
/**
 * The statuses `--wait` treats as the end of the run, spelled in BOTH
 * vocabularies (#994): the canonical four plus their pre-rename stored twins
 * (completed / partial / canceled). poll.ts normalizes anyway; passing the full
 * set keeps the wire contract visible and pins it in the tests — one published
 * CLI binary has to work against a pre-migration backend and a renamed one.
 */
const WAIT_TERMINAL_STATUSES: string[] = TERMINAL_RUN_STATUSES.flatMap((s) =>
  storedWorkflowStatusForms(s),
);

/** A run snapshot parked at awaiting-approval, in either wire vocabulary (#994). */
function isParkedSnapshot(raw: Record<string, unknown>): boolean {
  const status = raw["status"];
  return typeof status === "string" && normalizeRunStatus(status) === "awaiting-approval";
}

type VideoParkStop = Extract<RunStop, { at: "storyboard-gate" | "final-watch" }>;

/**
 * #1788: the two parks EVERY `--wait` ends on, whichever verb is waiting. A
 * video run parks at its storyboard gate and again at the final watch with no
 * `pauseReason` at all — the builder vocabulary (checkpoint / repair / slots /
 * call) never describes them — and both are decisions only the caller can
 * make: nothing resumes the run until someone approves or flags the
 * storyboard, or uploads a cut. Polling through them meant an agent driving
 * `workflow run --wait` was never told the run had parked and burned to the
 * 60-minute cap. Classified by the same `classifyRun` that `exodus video
 * status` / `video wait` use, so the stop and its next-step lines are one
 * vocabulary on both routes. Every other park is NOT a stop here: a Checkpoint
 * / repair / slots park prints its banner once and the loop keeps polling so a
 * resolve from another shell or the app carries the run on to its finish, and
 * a "call" park (a parent waiting on its child run) resumes on its own.
 */
function videoParkStop(raw: Record<string, unknown>): VideoParkStop | undefined {
  if (!isParkedSnapshot(raw)) return undefined;
  const stop = classifyRun(asVideoRun(raw));
  return stop.at === "storyboard-gate" || stop.at === "final-watch" ? stop : undefined;
}

async function waitForRun(
  runId: string,
  opts: {
    json: boolean;
    onProgressLine?: (line: string) => void;
    jsonBase: Record<string, unknown>;
    /**
     * When set, a run sitting at `awaiting-review` with THIS pauseReason is the
     * successful terminal state: the loop stops there, exits 0, and the human
     * render closes with `headline` + the park's resolve pointer instead of the
     * mid-poll pause banner. Every other status behaves exactly as it does
     * without the option — `queued`/`running` keep polling, and a park for some
     * OTHER reason keeps polling too (it isn't the landing this verb promised).
     */
    landOnPark?: { pauseReason: WorkflowPauseReason; headline: string };
    // #1002: `--out <dir>` — save the terminal run's delivered outputs to files.
    out?: string;
  },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  // #931: keyed on the RENDERED state (`${status}:${parked}`), not status alone —
  // see the dedup note in the poll loop below.
  const seen = new Map<string, string>();
  let pausedNotified = false;
  let autoRedoNotified: string | undefined;
  const landOnPark = opts.landOnPark;
  // The park this wait ENDS on: the one `landOnPark` names (#998), or a video
  // storyboard-gate / final-watch park (#1788). Any other park keeps polling.
  const isLandingPark = (raw: Record<string, unknown>): boolean =>
    (landOnPark !== undefined && raw["pauseReason"] === landOnPark.pauseReason) ||
    videoParkStop(raw) !== undefined;
  const pollResult = await deps.poll({
    path: `${STATUS_PATH}?runId=${encodeURIComponent(runId)}`,
    intervalMs: 3_000,
    timeoutMs: 60 * 60 * 1000,
    // A cancelled run is terminal (#539) so a web-cancelled run stops the wait
    // instead of polling to timeout. A run awaiting approval stays NONterminal
    // by default — it resumes after a web approval — but we surface it once
    // (below) so the operator knows to go approve.
    // #994: spell the terminal set in BOTH vocabularies. A published CLI polls
    // pre-rename backends (completed/partial/canceled) and renamed ones
    // (succeeded/succeeded-with-warnings/cancelled) alike; poll.ts already
    // normalizes, and passing them explicitly keeps the wire contract visible.
    // #998/#1788: the awaiting-approval forms join the terminal set and the
    // isDone guard below narrows the stop to the parks this wait lands on —
    // the one `landOnPark` names, and a video gate / final watch. (pollUntilDone
    // requires BOTH the status check and isDone to agree, so the guard must
    // pass every non-park terminal status straight through.)
    terminalStatuses: [
      ...WAIT_TERMINAL_STATUSES,
      ...storedWorkflowStatusForms("awaiting-approval"),
    ],
    isDone: (raw: Record<string, unknown>) => !isParkedSnapshot(raw) || isLandingPark(raw),
    onProgress: (raw) => {
      if (opts.json || !opts.onProgressLine) return;
      const parked = isParkedSnapshot(raw);
      // #998/#1788: when THIS park is the landing, the closing render below
      // announces it — don't also fire the "you've been interrupted" banner
      // mid-poll.
      const isLanding = isLandingPark(raw);
      // #2616: a final watch the automatic word redo is still changing is not a
      // pause to act on. Say what is coming instead of the cost-gate banner.
      const autoRedo = parked ? classifyRun(asVideoRun(raw)) : undefined;
      if (autoRedo?.at === "running" && autoRedo.autoRedoScenes) {
        const line = `  ${stopLines(autoRedo, runId, "")[0]}`;
        if (line !== autoRedoNotified) {
          autoRedoNotified = line;
          opts.onProgressLine(line);
        }
      } else if (parked && !pausedNotified && !isLanding) {
        pausedNotified = true;
        // #891: dispatch the pause banner on WHY the run parked. The dashboard
        // URL comes from the injected deps (override → dev.xo → xo, same
        // resolution the dashboard client uses), with a fallback for deps that
        // don't carry it.
        const dashboardUrl = deps.dashboardUrl ?? getDashboardUrl();
        const pauseReason = raw["pauseReason"] as WorkflowPauseReason | undefined;
        const workerStopped = isWorkerStoppedPark({
          status: raw["status"] as string | undefined,
          pauseReason,
          error: raw["error"] as string | undefined,
        });
        for (const line of formatPauseNotice(pauseReason, runId, dashboardUrl, { workerStopped })) {
          opts.onProgressLine(line);
        }
      }
      // #923/#929: while parked at a review stop, the paused node streams as
      // `⏸ awaiting approval` rather than a misleading `✓ done` (matches the final
      // formatWorkflowRun). #931: branch on the park KIND, same as the final
      // render — repair/slots/call parks leave their paused node as-is.
      const parkedNodeId =
        autoRedo?.at === "running"
          ? undefined
          : gateParkedNodeId(
              raw["status"] as string | undefined,
              raw["pauseReason"] as WorkflowPauseReason | undefined,
              raw["pausedNodeId"] as string | undefined,
            );
      const nodes = Array.isArray(raw["nodes"]) ? (raw["nodes"] as WorkflowRunNode[]) : [];
      for (const node of nodes) {
        // #931: dedup on the RENDERED state, not status alone. A parked node can
        // reach `done` while the run is still `running`, then the run flips to
        // awaiting-approval with the node STILL `done` — keying on status alone
        // suppressed the ⏸ transition. Fold the parked flag into the key so the
        // transition to parked always emits.
        const isParked = parkedNodeId !== undefined && node.nodeId === parkedNodeId;
        const renderKey = `${node.status}:${isParked}`;
        if (seen.get(node.nodeId) === renderKey) continue;
        seen.set(node.nodeId, renderKey);
        opts.onProgressLine(progressLine(node, isParked));
      }
    },
  });

  // #1002: `--out <dir>` — the terminal run's delivered outputs land on disk
  // before we render, so both modes can report exactly which files were written.
  const terminalRun =
    !pollResult.timedOut &&
    isRecord(pollResult.data) &&
    typeof pollResult.data["_id"] === "string"
      ? (pollResult.data as unknown as WorkflowRun)
      : undefined;
  const saved =
    opts.out !== undefined && terminalRun
      ? await saveDeliveries(terminalRun, opts.out, deps)
      : undefined;

  // #1788: landed on a video storyboard gate / final watch. `stop` rides the
  // --json line (additive, only on this landing) in the same shape `exodus
  // video status --json` and `video wait --json` already use, so an agent can
  // branch on `stop.at` instead of re-deriving the park from the raw run.
  const parkStop =
    !pollResult.timedOut && isRecord(pollResult.data)
      ? videoParkStop(pollResult.data)
      : undefined;
  // #1704: a final watch reads differently once a cut is attached, and only the
  // ledger knows. Resolved after the poll loop, so the extra read happens once
  // per wait — and by the same function `exodus video status` uses, so neither
  // surface can invent its own rule for what "a cut is attached" means.
  const videoStop = parkStop ? await resolveStopAtPark(parkStop, runId, deps) : undefined;

  if (opts.json) {
    return {
      code: pollResult.ok ? 0 : 1,
      lines: [
        JSON.stringify({
          ...opts.jsonBase,
          result: pollResult.data,
          timedOut: pollResult.timedOut,
          ...(videoStop ? { stop: videoStop } : {}),
          // Additive, and only when --out was passed: the paths that landed.
          ...(saved ? { saved: saved.paths } : {}),
        }),
      ],
    };
  }

  if (pollResult.timedOut) {
    return {
      code: 1,
      lines: [`Timed out waiting. Check later: exodus workflow status --id ${runId}`],
    };
  }

  const lines = [""];
  if (terminalRun) {
    lines.push(formatWorkflowRun(terminalRun));
  } else {
    lines.push(`Polling failed: ${JSON.stringify(pollResult.data)}`);
  }
  if (saved) lines.push("", ...saved.lines);

  // #998: landed on the park this verb was waiting for — say so plainly and
  // point at the verb that resolves it (reusing the pause notice's pointer
  // lines, minus its generic "you've been interrupted" headline).
  if (
    landOnPark &&
    isRecord(pollResult.data) &&
    typeof pollResult.data["status"] === "string" &&
    normalizeRunStatus(pollResult.data["status"]) === "awaiting-approval" &&
    pollResult.data["pauseReason"] === landOnPark.pauseReason
  ) {
    const dashboardUrl = deps.dashboardUrl ?? getDashboardUrl();
    lines.push(
      "",
      landOnPark.headline,
      ...formatPauseNotice(landOnPark.pauseReason, runId, dashboardUrl).slice(1),
    );
  }

  // #1788: landed on a video storyboard gate / final watch — close with the
  // exact "Parked: …" block `exodus video status` prints for that stop, so the
  // next command is named right here instead of the loop polling to timeout.
  if (videoStop) {
    // #1851: the link belongs to this run, so it is composed from the run the
    // poll just read rather than from the dashboard root alone.
    const review = reviewUrl(
      deps.dashboardUrl ?? getDashboardUrl(),
      asVideoRun(pollResult.data),
    );
    lines.push("", ...stopLines(videoStop, runId, review));
  }

  return { code: pollResult.ok ? 0 : 1, lines };
}

export async function statusFlow(
  // #1002: --out <dir> saves the run's delivered outputs to files. It needs a
  // specific run, so it only pairs with --id.
  opts: { id?: string; json: boolean; out?: string },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  if (opts.out !== undefined && !opts.id) {
    return {
      code: 1,
      lines: [
        "--out saves ONE run's outputs, so it needs the run: exodus workflow status --id <runId> --out <dir>",
      ],
    };
  }

  const path = opts.id ? `${STATUS_PATH}?runId=${encodeURIComponent(opts.id)}` : STATUS_PATH;
  const res = await deps.get(path);
  if (!res.ok) return asErrorResult(res, opts.json);

  const saved =
    opts.out !== undefined && opts.id
      ? await saveDeliveries(res.data as WorkflowRun, opts.out, deps)
      : undefined;

  if (opts.json) {
    // Additive, and only when --out was passed: the paths that landed.
    const payload = saved ? { ...(res.data as object), saved: saved.paths } : res.data;
    return { code: 0, lines: [JSON.stringify(payload)] };
  }

  if (opts.id) {
    const lines = [formatWorkflowRun(res.data as WorkflowRun)];
    if (saved) lines.push("", ...saved.lines);
    return { code: 0, lines };
  }
  const runs = ((res.data as { runs?: WorkflowRunProjection[] }).runs ?? []);
  return { code: 0, lines: [formatRecentRuns(runs)] };
}

export async function exportFlow(
  workflowRef: string,
  // #894: --version pins the export to a saved historical version (real 1-based
  // id). Omitted → the head export (the only export that carries triggers).
  opts: { out?: string; json?: boolean; version?: number },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  let workflowId: string;
  try {
    workflowId = await resolveWorkflowId(workflowRef, deps);
  } catch (e) {
    // #931: honor --json — a name/id miss is a structured envelope, not a bare line.
    return resolveIdErrorResult(e, opts.json ?? false);
  }

  const versionParam =
    opts.version !== undefined ? `&version=${encodeURIComponent(String(opts.version))}` : "";
  const res = await deps.get(
    `${EXPORT_PATH}?id=${encodeURIComponent(workflowId)}${versionParam}`,
  );
  if (!res.ok) return asErrorResult(res, false);
  // The GET still returns the JSON contract; the wire form is chosen locally.
  // Default: canonical YAML (workflowToYaml). --json: the legacy pretty JSON,
  // byte-exact with every prior release, for tools that still parse it.
  const doc = opts.json
    ? JSON.stringify(res.data, null, 2)
    : workflowToYaml(res.data as WorkflowContractJson);
  if (opts.out) {
    // YAML from js-yaml already ends in a newline; JSON does not — normalize to
    // exactly one trailing newline either way.
    const text = doc.endsWith("\n") ? doc : `${doc}\n`;
    deps.writeFile(opts.out, text);
    return { code: 0, lines: [`Wrote workflow contract to ${opts.out}.`] };
  }
  // printResult console.logs each line (appending "\n") — strip the YAML dump's
  // own terminator so `export … > file` stays byte-identical to --out.
  return { code: 0, lines: [doc.endsWith("\n") ? doc.slice(0, -1) : doc] };
}

/**
 * Validate the `--version <n>` flag client-side: it must be a positive integer
 * (a real 1-based version id). Returns the parsed number, or undefined when the
 * flag is absent; throws with a clear message on a non-positive/non-integer.
 */
export function parseVersionFlag(flags: Record<string, string | boolean>): number | undefined {
  const raw = flags["version"];
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new Error("--version requires a positive integer");
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--version must be a positive integer (got "${raw}")`);
  }
  return n;
}

export async function versionsFlow(
  workflowRef: string,
  opts: { json: boolean },
  deps: WorkflowRunDeps,
  channel: Channel = getChannel(),
): Promise<FlowResult> {
  let workflowId: string;
  try {
    workflowId = await resolveWorkflowId(workflowRef, deps);
  } catch (e) {
    // #931: honor --json — a name/id miss is a structured envelope, not a bare line.
    return resolveIdErrorResult(e, opts.json ?? false);
  }

  const res = await deps.get(`${VERSIONS_PATH}?id=${encodeURIComponent(workflowId)}`);
  const unsupported = missingRouteLine(res, "workflow versions", channel);
  if (unsupported) return { code: 1, lines: [unsupported] };
  if (!res.ok) return asErrorResult(res, opts.json);
  if (opts.json) return { code: 0, lines: [JSON.stringify(res.data)] };

  // Some wrappers return a bare array instead of { versions: [...] }.
  const body = res.data;
  const versions = Array.isArray(body)
    ? (body as WorkflowVersion[])
    : ((body as WorkflowVersionsResponse).versions ?? []);
  return { code: 0, lines: [formatWorkflowVersions(versions)] };
}

/**
 * Build the import request body from a file (#863). Shared verbatim by `import`
 * and `validate` (#879 ruling 3) so both send a byte-identical body — the alias
 * is pinned by test. Returns either the ready `body` or a terminal FlowResult
 * for the read/parse/anchor failures (identical messages either door hits).
 */
function buildImportBody(
  file: string,
  opts: { dryRun: boolean; update?: string },
  deps: WorkflowRunDeps,
): { body: Record<string, unknown> } | { error: FlowResult } {
  let text: string;
  try {
    text = deps.readFile(file);
  } catch {
    return { error: { code: 1, lines: [`Error: file not found: ${file}`] } };
  }

  // Accept EITHER a canonical YAML export or a legacy JSON file (#863). The
  // parsed value is a plain JSON tree that gets posted as a JSON body unchanged,
  // so YAML files import against the CURRENT deployed API with zero server work.
  let parsed: unknown;
  try {
    parsed = parseWorkflowText(text);
  } catch (e) {
    // parseWorkflowText throws "workflow file is not valid YAML or JSON[: detail]";
    // re-prefix with the file name, keeping only the parser's detail so the phrase
    // isn't doubled.
    const raw = e instanceof Error ? e.message : String(e);
    const detail = raw.replace(/^workflow file is not valid YAML or JSON:?\s*/, "");
    const suffix = detail ? `: ${detail}` : "";
    return { error: { code: 1, lines: [`Error: ${file} is not valid YAML or JSON${suffix}`] } };
  }

  if (!isRecord(parsed)) {
    return {
      error: {
        code: 1,
        lines: [`Error: ${file} is not a workflow contract (expected a JSON object).`],
      },
    };
  }

  // The contract carries workflowId/updatedAt as meta (the backend peels them
  // into meta); strip only the transport control fields so a hand-edited file
  // can't smuggle them in.
  const body: Record<string, unknown> = { ...parsed };
  delete body.dryRun;
  delete body.targetWorkflowId;
  delete body.expectedUpdatedAt;
  if (opts.dryRun) body.dryRun = true;

  if (opts.update) {
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined;
    if (!updatedAt) {
      return {
        error: {
          code: 1,
          lines: [
            `Error: ${file} has no "updatedAt" anchor, so drift can't be detected. ` +
              `Re-export the workflow first (exodus workflow export <id> --out ${file}) and retry --update.`,
          ],
        },
      };
    }
    body.targetWorkflowId = opts.update;
    body.expectedUpdatedAt = updatedAt;
  }

  return { body };
}

/**
 * The shared import/validate runtime: build the body, POST it, render the
 * result. `validate` (#879 ruling 3) is exactly this with dryRun forced on and
 * a "validation" heading — no non-dry-run door — so it can't diverge from
 * `import --dry-run`.
 */
async function runImport(
  file: string,
  opts: { dryRun: boolean; json: boolean; update?: string; validate?: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const built = buildImportBody(file, { dryRun: opts.dryRun, update: opts.update }, deps);
  if ("error" in built) return built.error;

  const res = await deps.post(IMPORT_PATH, built.body);
  if (!res.ok) {
    return {
      code: 1,
      lines: opts.json
        ? [JSON.stringify({ ok: false, status: res.status, data: res.data })]
        : [formatImportError(res)],
    };
  }
  const data = res.data as WorkflowImportResult;
  return {
    code: 0,
    lines: opts.json
      ? [JSON.stringify(data)]
      : [
          formatImportSummary(data, {
            dryRun: opts.dryRun,
            update: !!opts.update,
            validate: opts.validate,
          }),
        ],
  };
}

// ── Triggers (#893 / MS-8) ───────────────────────────────────────────────
// Triggers carry NO ids — position (1-based to the user) + a fingerprint of
// the trigger's own fields IS the addressing scheme. The CLI reads the live
// trigger list from the export contract in the SAME invocation it acts, and
// sends that fingerprint as `expect`, so a concurrent edit fails loud
// server-side instead of flipping the wrong trigger.

/** A trigger in either form. Every display path below reads only `type`,
 *  `event`/`cron` and `enabled` — the keys both forms share. */
type AnyTrigger = WorkflowTrigger | WorkflowContractTrigger;

/** The `expect` fingerprint the server matches a trigger against by position. */
export function triggerExpect(t: AnyTrigger): {
  type: string;
  event?: string;
  cron?: string;
} {
  return t.type === "event"
    ? { type: "event", event: t.event }
    : { type: "cron", cron: t.cron };
}

function triggerDetail(t: AnyTrigger): string {
  return t.type === "event" ? t.event : t.cron;
}

const NO_TRIGGERS =
  "no triggers — add them via `exodus workflow export` / `import`";

/** One numbered (1-based) row per trigger: `n · type · detail · enabled|disabled`. */
export function formatTriggers(triggers: AnyTrigger[]): string {
  if (triggers.length === 0) return NO_TRIGGERS;
  return triggers
    .map((t, i) => {
      const state = t.enabled ? "enabled" : "disabled";
      return `${i + 1} · ${t.type} · ${triggerDetail(t)} · ${state}`;
    })
    .join("\n");
}

/** Compose the error FlowResult for a triggers verb (missing-route aware). */
function triggerErrorResult(
  res: ApiResponse<unknown>,
  verb: string,
  json: boolean,
): FlowResult {
  const missing = missingRouteLine(res, verb);
  if (missing) {
    return {
      code: 1,
      lines: json
        ? [JSON.stringify({ ok: false, status: res.status, error: missing })]
        : [missing],
    };
  }
  return asErrorResult(res, json);
}

/** Fetch the workflow's export contract and pull its trigger list. */
async function fetchTriggers(
  workflowId: string,
  deps: WorkflowRunDeps,
): Promise<{ ok: true; triggers: WorkflowContractTrigger[] } | { ok: false; res: ApiResponse<unknown> }> {
  const res = await deps.get(`${EXPORT_PATH}?id=${encodeURIComponent(workflowId)}`);
  if (!res.ok) return { ok: false, res };
  const triggers = (res.data as WorkflowContractJson).triggers ?? [];
  return { ok: true, triggers };
}

export async function triggersListFlow(
  workflowRef: string,
  opts: { json: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  let workflowId: string;
  try {
    workflowId = await resolveWorkflowId(workflowRef, deps);
  } catch (e) {
    // #931: honor --json — a name/id miss is a structured envelope, not a bare line.
    return resolveIdErrorResult(e, opts.json ?? false);
  }
  const fetched = await fetchTriggers(workflowId, deps);
  if (!fetched.ok) return triggerErrorResult(fetched.res, "workflow triggers", opts.json);

  if (opts.json) {
    // Machine-friendly: the raw trigger array with its 1-based position stamped.
    return {
      code: 0,
      lines: [JSON.stringify(fetched.triggers.map((t, i) => ({ n: i + 1, ...t })))],
    };
  }
  return { code: 0, lines: [formatTriggers(fetched.triggers)] };
}

/** Shared render for an out-of-range / ambiguous <n> — echoes the live list. */
function triggerIndexError(
  message: string,
  triggers: AnyTrigger[],
  json: boolean,
): FlowResult {
  if (json) {
    return {
      code: 1,
      lines: [JSON.stringify({ ok: false, error: message, triggers: triggers.map((t, i) => ({ n: i + 1, ...t })) })],
    };
  }
  return { code: 1, lines: [message, "", formatTriggers(triggers)] };
}

export async function triggersSetEnabledFlow(
  workflowRef: string,
  n: number,
  enabled: boolean,
  opts: { json: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const verb = `workflow triggers ${enabled ? "enable" : "disable"}`;
  let workflowId: string;
  try {
    workflowId = await resolveWorkflowId(workflowRef, deps);
  } catch (e) {
    // #931: honor --json — a name/id miss is a structured envelope, not a bare line.
    return resolveIdErrorResult(e, opts.json ?? false);
  }
  const fetched = await fetchTriggers(workflowId, deps);
  if (!fetched.ok) return triggerErrorResult(fetched.res, verb, opts.json);

  const triggers = fetched.triggers;
  const idx = n - 1;
  if (idx < 0 || idx >= triggers.length) {
    return triggerIndexError(
      `Trigger ${n} is out of range — this workflow has ${triggers.length} trigger(s).`,
      triggers,
      opts.json,
    );
  }

  const res = await deps.post(TRIGGERS_SET_ENABLED_PATH, {
    workflowId,
    triggerIndex: idx,
    enabled,
    expect: triggerExpect(triggers[idx]),
  });
  if (!res.ok) return triggerErrorResult(res, verb, opts.json);

  if (opts.json) return { code: 0, lines: [JSON.stringify(res.data)] };
  const lines = [`Trigger ${n} ${enabled ? "enabled" : "disabled"}.`];
  // #1260: the server's arming advisories — e.g. enabling a schedule on a
  // workflow whose required input has no saved default, which would reject
  // every fire at the door. Same rendering as the import summary's warnings;
  // absent from an older backend, so guard the shape.
  const warnings = (res.data as { warnings?: unknown } | null)?.warnings;
  if (Array.isArray(warnings)) {
    for (const w of warnings) {
      if (typeof w === "string") lines.push(`  ⚠ ${w}`);
    }
  }
  return { code: 0, lines };
}

interface TriggerFireResponse {
  runId: string;
}

export async function triggersFireFlow(
  workflowRef: string,
  opts: {
    n?: number;
    text?: string;
    /**
     * #1084 (F2): a per-FIRE Image Rig re-aim. It REPLACES whatever the trigger
     * definition carries rather than merging with it, so a test fire can say
     * "this schedule, but aim the rig here instead" in one command. Omitted =
     * the fire simulates the schedule faithfully, its own overrides included.
     */
    imageRigOverrides?: Record<string, unknown>;
    /**
     * #1863: a per-FIRE voices map, with the same precedence as the re-aim
     * above — it REPLACES whatever voices the trigger definition carries rather
     * than merging with them. Omitted = the fire simulates the schedule
     * faithfully, its own voices included.
     */
    voices?: VoiceMap;
    wait: boolean;
    json: boolean;
    onProgressLine?: (line: string) => void;
  },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const verb = "workflow triggers fire";
  let workflowId: string;
  try {
    workflowId = await resolveWorkflowId(workflowRef, deps);
  } catch (e) {
    // #931: honor --json — a name/id miss is a structured envelope, not a bare line.
    return resolveIdErrorResult(e, opts.json ?? false);
  }
  const fetched = await fetchTriggers(workflowId, deps);
  if (!fetched.ok) return triggerErrorResult(fetched.res, verb, opts.json);

  const triggers = fetched.triggers;
  if (triggers.length === 0) {
    return { code: 1, lines: [`This workflow has no triggers. ${NO_TRIGGERS}`] };
  }

  // <n> is optional only when there's exactly one trigger; otherwise ambiguous.
  let idx: number;
  if (opts.n !== undefined) {
    idx = opts.n - 1;
    if (idx < 0 || idx >= triggers.length) {
      return triggerIndexError(
        `Trigger ${opts.n} is out of range — this workflow has ${triggers.length} trigger(s).`,
        triggers,
        opts.json,
      );
    }
  } else if (triggers.length === 1) {
    idx = 0;
  } else {
    return triggerIndexError(
      `This workflow has ${triggers.length} triggers — specify which one to fire (e.g. \`fire 1\`).`,
      triggers,
      opts.json,
    );
  }

  const t = triggers[idx];
  const n = idx + 1;

  // Preflight the server's rules with friendlier copy.
  if (t.type === "event" && (opts.text === undefined || opts.text === "")) {
    return {
      code: 1,
      lines: [
        `Trigger ${n} fires on the "${t.event}" event — pass --text with the input this run should carry.`,
      ],
    };
  }
  if (t.type === "cron" && opts.text !== undefined) {
    return {
      code: 1,
      lines: [`Trigger ${n} is a cron trigger ("${t.cron}") — it takes no --text.`],
    };
  }

  const res = await deps.post(TRIGGERS_FIRE_PATH, {
    workflowId,
    triggerIndex: idx,
    expect: triggerExpect(t),
    ...(opts.text !== undefined ? { text: opts.text } : {}),
    // #1084 (F2): the per-fire re-aim, when the caller passed one.
    ...(opts.imageRigOverrides
      ? { imageRigOverrides: opts.imageRigOverrides }
      : {}),
    // #1863: the per-fire voices, as the MAP — the route parses it into the
    // list Convex can carry, exactly as the run route does.
    ...(opts.voices ? { voices: opts.voices } : {}),
  });
  if (!res.ok) return triggerErrorResult(res, verb, opts.json);

  const runId = (res.data as TriggerFireResponse).runId;
  const base = { runId, workflowId };

  if (!opts.wait) {
    if (opts.json) return { code: 0, lines: [JSON.stringify(base)] };
    return {
      code: 0,
      lines: [
        `Trigger ${n} fired.`,
        `runId:  ${runId}`,
        "This run executes as the workflow OWNER in the background.",
        `Poll: exodus workflow status --id ${runId}`,
      ],
    };
  }

  const startLines = [
    `Trigger ${n} fired.`,
    `runId:  ${runId}`,
    "This run executes as the workflow OWNER in the background.",
    `Poll: exodus workflow status --id ${runId}`,
  ];
  if (!opts.json && opts.onProgressLine) {
    for (const line of startLines) opts.onProgressLine(line);
  }

  const waited = await waitForRun(
    runId,
    { json: opts.json, onProgressLine: opts.onProgressLine, jsonBase: base },
    deps,
  );
  if (opts.json) return waited;
  const prefix = opts.onProgressLine ? [] : startLines;
  return { code: waited.code, lines: [...prefix, ...waited.lines] };
}

export async function importFlow(
  file: string,
  opts: { dryRun: boolean; json: boolean; update?: string },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  return runImport(file, opts, deps);
}

/**
 * `workflow validate <file>` — an alias of `import --dry-run` (#879 ruling 3):
 * the SAME body builder, the same server validation, the same issue rendering
 * and exit codes, just a validation heading and no write path. Network + login
 * required; there is no vendored graph validator in the CLI, ever.
 */
export async function validateFlow(
  file: string,
  opts: { json: boolean; update?: string },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  return runImport(
    file,
    { dryRun: true, json: opts.json, update: opts.update, validate: true },
    deps,
  );
}

// ── templates + schema flows (#892) ───────────────────────────────────────

export async function templatesListFlow(
  json: boolean,
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const res = await deps.get(TEMPLATES_PATH);
  if (!res.ok) {
    const missing = missingRouteLine(res, "workflow templates");
    if (missing) return { code: 1, lines: [missing] };
    return asErrorResult(res, json);
  }
  const data = res.data as WorkflowTemplatesResponse;
  if (json) return { code: 0, lines: [JSON.stringify(data)] };
  return { code: 0, lines: [formatTemplatesList(data.templates ?? [])] };
}

export async function templatesExportFlow(
  key: string,
  opts: { out?: string; json?: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  // ?key= returns canonical YAML by default; &format=json returns the contract
  // JSON. Fetch as RAW TEXT and pass it through untouched — the server is the
  // single renderer (no client-side re-render via lib/workflowText.ts), so a
  // `templates export` file is byte-identical to what /export?format=yaml
  // produces for the imported result (#892 trap).
  const query = opts.json
    ? `?key=${encodeURIComponent(key)}&format=json`
    : `?key=${encodeURIComponent(key)}`;
  const res = await deps.getText(`${TEMPLATES_PATH}${query}`);
  if (!res.ok) {
    // The raw-text seam delivers even an app-level apiError 404 (unknown key)
    // as a JSON STRING body; missingRouteLine (route-support) inspects object
    // shapes, so parse first or the semantic 404 would read as a missing route.
    let parsedBody: unknown = res.data;
    try {
      parsedBody = JSON.parse(res.data);
    } catch {
      // Not JSON — leave the raw string; a router 404 stays a missing route.
    }
    const missing = missingRouteLine(
      { ...res, data: parsedBody },
      "workflow templates export",
    );
    if (missing) return { code: 1, lines: [missing] };
    return { code: 1, lines: [formatTextError(res)] };
  }

  const doc = res.data;
  if (opts.out) {
    // Match exportFlow's parity: exactly one trailing newline in the file.
    const text = doc.endsWith("\n") ? doc : `${doc}\n`;
    deps.writeFile(opts.out, text);
    return { code: 0, lines: [`Wrote template "${key}" to ${opts.out}.`] };
  }
  // printResult console.logs the line (re-appending "\n"); strip one trailing
  // newline so `templates export … > file` stays byte-identical to --out.
  return { code: 0, lines: [doc.endsWith("\n") ? doc.slice(0, -1) : doc] };
}

/**
 * Render an error from a RAW-text endpoint. The body is a string; if it parses
 * to our apiError envelope, reuse the clean one-liner render (#913: surfaces the
 * 404's message, e.g. templates "unknown key" naming the valid keys — NOT the
 * legacy `## Error` markdown block). Otherwise print the raw body so nothing is
 * swallowed.
 */
function formatTextError(res: ApiResponse<string>): string {
  const body = res.data;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const snippet = body.replace(/\s+/g, " ").trim().slice(0, 300);
    return formatApiError({ ok: false, status: res.status, data: snippet || "(empty response)" });
  }
  return formatApiError({ ok: false, status: res.status, data: parsed });
}

export async function schemaFlow(
  opts: { json: boolean; kind?: string; face?: string },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const res = await deps.get(SCHEMA_PATH);
  if (!res.ok) {
    const missing = missingRouteLine(res, "workflow schema");
    if (missing) return { code: 1, lines: [missing] };
    return asErrorResult(res, opts.json);
  }
  // --json emits the raw payload verbatim, whatever additive fields it carries.
  if (opts.json) return { code: 0, lines: [JSON.stringify(res.data)] };

  const payload = isRecord(res.data) ? res.data : {};
  if (opts.kind !== undefined) {
    return formatSchemaFilter(payload, ["nodeKinds"], "kind", opts.kind);
  }
  if (opts.face !== undefined) {
    return formatSchemaFilter(payload, ["transformFaces"], "face", opts.face);
  }
  return { code: 0, lines: [formatSchema(payload)] };
}

// ── Park cluster (#891) ──────────────────────────────────────────────────
// The member's review surface over parked workflow runs: the inbox, the
// checkpoint verbs (show / edit / approve / retry / cancel), the require-all
// repair verbs (retry / skip / kill), and the nested-slot answer verb. Every
// ACTION verb maps a missing-route 404 to the honest #896 line via
// triggerErrorResult (the shared missing-route helper).
// (#1012: the Gate-node decision verbs that lived here — show / pick / edit /
// push / approve / reject — retired with the node kind. `workflow gate` now
// prints a pointer at the checkpoint verbs and exits 1.)

/** GET /api/v2/workflow/inbox → one actionable-park row per run. */
export interface WorkflowInboxRow {
  _id: string;
  workflowId: string;
  workflowName: string;
  pausedNodeId?: string;
  pausedNodeKind?: string;
  // Present as-is on new parks; absent = a legacy video cost-gate park.
  pauseReason?: "taste" | "repair" | "slots" | "checkpoint";
  counts?: WorkflowCounts;
  createdAt: number | string;
  queuedAt?: number | string;
  hasShow?: boolean;
  invocationMode?: "live" | "background";
  triggeredBy?: { type: "event" | "cron"; event?: string };
  pendingSlotsCount?: number;
}

export interface WorkflowInboxResponse {
  runs: WorkflowInboxRow[];
}

/**
 * A coarse relative age ("3d" / "5h" / "2m" / "9s"); `now` is injectable so the
 * inbox render is deterministic under test. Mirrors session.ts's formatAge.
 */
export function formatAge(value: number | string | undefined, now = Date.now()): string {
  if (value === undefined || value === null) return "-";
  const t = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(t)) return "-";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/**
 * The park-kind badge. Ruling (#891): "taste" → `gate` (now a LEGACY park at the
 * retired Gate node, #1012), "repair"/"slots" as-is, and an ABSENT pauseReason →
 * `legacy` (a video cost-gate park). Never badge an absent reason as `gate`.
 * #998: "checkpoint" as-is — the run is holding at a Checkpoint box, resolved by
 * its own verb cluster.
 */
export function parkBadge(pauseReason: string | undefined): string {
  if (pauseReason === "taste") return "gate";
  if (pauseReason === "repair") return "repair";
  if (pauseReason === "slots") return "slots";
  if (pauseReason === "checkpoint") return "checkpoint";
  return "legacy";
}

/** The invocation badge for background/triggered runs; blank for a live run. */
export function invocationBadge(row: WorkflowInboxRow): string {
  if (row.triggeredBy) return `trig:${row.triggeredBy.event ?? row.triggeredBy.type}`;
  if (row.invocationMode === "background") return "bg";
  return "";
}

const NO_INBOX = "Nothing waiting on you — the review inbox is empty.";

export function formatInbox(rows: WorkflowInboxRow[], now = Date.now()): string {
  if (rows.length === 0) return NO_INBOX;
  return table(
    ["run", "workflow", "kind", "node", "via", "age"],
    rows.map((r) => [
      // #928: print the FULL runId — it's the handle every resolve verb needs
      // (gate/repair/answer). shortId's ellipsis left the human view a dead end.
      r._id,
      r.workflowName || "(unnamed)",
      parkBadge(r.pauseReason),
      r.pausedNodeId ?? "-",
      invocationBadge(r) || "-",
      formatAge(r.createdAt, now),
    ]),
  );
}

export async function inboxFlow(json: boolean, deps: WorkflowRunDeps): Promise<FlowResult> {
  const res = await deps.get(INBOX_PATH);
  if (!res.ok) return triggerErrorResult(res, "workflow inbox", json);
  const data = res.data as WorkflowInboxResponse;
  const rows = data.runs ?? [];
  return { code: 0, lines: json ? [JSON.stringify(rows)] : [formatInbox(rows)] };
}

// ── Shared preflight + error helpers ──────────────────────────────────────

/** One error FlowResult, structured under --json, bare line in human mode. */
function errLine(message: string, json: boolean, status?: number): FlowResult {
  return {
    code: 1,
    lines: [
      json
        ? JSON.stringify({ ok: false, ...(status ? { status } : {}), error: message })
        : message,
    ],
  };
}

/** One success FlowResult; --json carries the given structured payload. */
function okLine(message: string, payload: Record<string, unknown>, json: boolean): FlowResult {
  return { code: 0, lines: [json ? JSON.stringify(payload) : message] };
}

function asWorkflowRun(data: unknown): WorkflowRun | undefined {
  return isRecord(data) && typeof data["_id"] === "string"
    ? (data as unknown as WorkflowRun)
    : undefined;
}

/** Human phrase for a run's ACTUAL park state — used when a preflight fails. */
function describePark(run: WorkflowRun): string {
  // #994: normalize before testing, and name a non-parked state with the ruled
  // display word rather than the raw stored value. #1261: through the SHARED
  // verdict, so a refusal can't call a run "Succeeded with warnings" while its
  // own status screen calls it Failed. (Park detail can't apply on this branch
  // — the run is not awaiting approval.)
  if (normalizeRunStatus(run.status) !== "awaiting-approval") {
    return `status: ${runVerdict(run)}`;
  }
  switch (run.pauseReason) {
    // #1012: a LEGACY park at the retired Gate node — unresumable, cancel only.
    case "taste":
      return "parked at a Gate box, which retired in 2.0 (cancel and re-run)";
    case "repair":
      return "parked for repair";
    case "slots":
      return "parked for slot answers";
    case "call":
      return "parked on a child workflow";
    case "checkpoint":
      return `parked at a checkpoint (use: exodus workflow checkpoint ${run._id})`;
    default:
      return "parked at the cost gate (legacy)";
  }
}

const PARK_LABEL: Record<WorkflowPauseReason, string> = {
  // #1012: legacy only — the runner never emits "taste" any more.
  taste: "a retired Gate review",
  repair: "a repair",
  slots: "slot answers",
  call: "a child workflow",
  checkpoint: "a checkpoint approval",
};

/**
 * Preflight a checkpoint/repair/answer verb: GET the run detail and confirm it is
 * parked for the EXPECTED reason. A mismatch names the run's actual state so the
 * error is self-explaining. The GET hits the pre-existing run route, so a
 * missing-route 404 here means the whole backend is behind — still #896-mapped.
 */
async function preflightPark(
  runId: string,
  expected: WorkflowPauseReason | readonly WorkflowPauseReason[],
  verb: string,
  json: boolean,
  deps: WorkflowRunDeps,
): Promise<{ ok: true; run: WorkflowRun } | { ok: false; result: FlowResult }> {
  const res = await deps.get(`${STATUS_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!res.ok) return { ok: false, result: triggerErrorResult(res, verb, json) };
  const run = asWorkflowRun(res.data);
  if (!run) {
    return { ok: false, result: errLine(`Could not read run ${runId}.`, json) };
  }
  // A verb normally expects exactly one park reason; cancel also accepts the
  // legacy "taste" park (#1012) — the mismatch message names the primary one.
  const allowed = Array.isArray(expected)
    ? (expected as readonly WorkflowPauseReason[])
    : [expected as WorkflowPauseReason];
  // #994: normalize so the preflight passes against pre- and post-rename backends.
  if (
    normalizeRunStatus(run.status) !== "awaiting-approval" ||
    run.pauseReason === undefined ||
    !allowed.includes(run.pauseReason)
  ) {
    return {
      ok: false,
      result: errLine(
        `Run ${runId} is not parked for ${PARK_LABEL[allowed[0]]} — it is ${describePark(run)}.`,
        json,
      ),
    };
  }
  return { ok: true, run };
}

// ── Checkpoint verbs (#998) ───────────────────────────────────────────────
//
// A checkpoint park is a run that reached a Checkpoint box — its own node kind
// ("checkpoint", #1069), sitting on a wire between two steps and passing what
// arrives straight through once it is approved. The run parks with pauseReason
// "checkpoint" and waits — indefinitely — for the member to approve what is
// waiting there, hand-edit it first, re-run the step feeding the box, or cancel
// the run. (Graphs authored before #1069 carried a per-node switch instead;
// those auto-convert to a box, and frozen runs that parked on the old switch
// still resolve through these same verbs.)
//
// The one exception is a run launched with `--auto-approve` (#1079): that run
// was deliberately sent off unattended, so the server approves each Checkpoint
// the moment it is reached — artifact untouched, stop recorded as
// auto-approved — and the run never parks for these verbs at all.
//
// It is NOT a Gate node: there are no selection-port candidates and nothing to
// "pick". What the member reviews is the plain text held at the box, so the
// numbering below covers EVERY text artifact the parked node carries.

/**
 * One reviewable output held at the checkpoint, numbered 1-based for the
 * member, each carrying its index into the node's FULL outputs array — which is
 * what /checkpoint/edit's `outputIndex` means. Non-text artifacts (images,
 * session handles, …) are skipped in the NUMBERING but still occupy their real
 * index, so `n` and `outputIndex` diverge exactly as they should.
 */
interface CheckpointOutput {
  n: number;
  outputIndex: number;
  text: string;
  label?: string;
  humanEdited: boolean;
  /**
   * #1014: present when this output came out of a Splitter lane. Grouping the
   * listing by it is PRESENTATION ONLY — `n` keeps counting straight through
   * every text output so `edit <n>` means the same thing it always did.
   */
  item?: ArtifactItemIdentity;
}

function checkpointOutputs(run: WorkflowRun): CheckpointOutput[] {
  const node = (run.nodes ?? []).find((x) => x.nodeId === run.pausedNodeId);
  if (!node) return [];
  const out: CheckpointOutput[] = [];
  let n = 0;
  (node.outputs ?? []).forEach((a, idx) => {
    // Only a text artifact is editable (the server's editNodeTextArtifact
    // refuses anything else), so only text artifacts get a number.
    if (a.type !== "text") return;
    n += 1;
    out.push({
      n,
      outputIndex: idx,
      text: a.text,
      label: a.label,
      humanEdited: !!a.humanEdited,
      ...(a.item ? { item: a.item } : {}),
    });
  });
  return out;
}

/**
 * #1014: the DISTINCT lane items on a checkpoint's outputs, ascending by index.
 * Empty for an ordinary checkpoint — which is the switch between the flat
 * listing and the item-grouped one, and between plain approve and `--reject`.
 */
function checkpointItemIndexes(outputs: CheckpointOutput[]): number[] {
  const seen = new Set<number>();
  for (const o of outputs) if (o.item) seen.add(o.item.index);
  return [...seen].sort((a, b) => a - b);
}

/** The parked step's node row, for the "which step is this?" header. */
function checkpointNode(run: WorkflowRun): WorkflowRunNode | undefined {
  return (run.nodes ?? []).find((x) => x.nodeId === run.pausedNodeId);
}

/** One numbered output row — the same shape flat or grouped, so `n` never moves. */
function checkpointOutputRow(o: CheckpointOutput, indent: string): string {
  const label = o.label ? ` [${o.label}]` : "";
  const edited = o.humanEdited ? "  (edited)" : "";
  return `${indent}${o.n}.${label} ${truncateText(o.text, 200)}${edited}`;
}

/**
 * Human list of the step's outputs (truncated); full text lives in --json.
 *
 * #1014: when the outputs carry lane identity, the SAME numbered rows are
 * grouped under "Item N of M" headings so the member can see which lane each
 * one came from. The numbering is untouched — row 4 is still `edit 4` — because
 * the grouping is a view over one flat, index-addressed list, not a renumbering.
 * Outputs with no item (a shared artifact the node emitted once) are listed last
 * under their own heading rather than being silently folded into item 1.
 */
function formatCheckpointOutputs(outputs: CheckpointOutput[]): string {
  if (outputs.length === 0) return "  (this step produced no text to review)";
  const indexes = checkpointItemIndexes(outputs);
  if (indexes.length === 0) {
    return outputs.map((o) => checkpointOutputRow(o, "  ")).join("\n");
  }
  const lines: string[] = [];
  for (const index of indexes) {
    const rows = outputs.filter((o) => o.item?.index === index);
    // `total` is stamped on the artifact at emit time — read it off the row
    // rather than counting what survived, so a culled batch still reads honestly.
    const total = rows[0]?.item?.total ?? indexes.length;
    lines.push(`  Item ${index + 1} of ${total}`);
    for (const row of rows) lines.push(checkpointOutputRow(row, "    "));
  }
  const shared = outputs.filter((o) => !o.item);
  if (shared.length > 0) {
    lines.push("  Not tied to an item");
    for (const row of shared) lines.push(checkpointOutputRow(row, "    "));
  }
  return lines.join("\n");
}

/** Out-of-range error for a checkpoint output number, naming the real range. */
function checkpointRangeError(num: number, count: number, json: boolean): FlowResult {
  const range = count > 0 ? ` (valid: 1–${count})` : "";
  return errLine(
    `Output ${num} is out of range — this step has ${count} text output${count === 1 ? "" : "s"}${range}.`,
    json,
  );
}

export async function checkpointShowFlow(
  runId: string,
  opts: { json: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const pf = await preflightPark(runId, "checkpoint", "workflow checkpoint", opts.json, deps);
  if (!pf.ok) return pf.result;
  const outputs = checkpointOutputs(pf.run);
  const node = checkpointNode(pf.run);
  const itemIndexes = checkpointItemIndexes(outputs);
  if (opts.json) {
    return {
      code: 0,
      lines: [
        JSON.stringify({
          runId,
          pausedNodeId: pf.run.pausedNodeId,
          pausedNodeKind: node?.kind,
          ...(node?.botSlug ? { botSlug: node.botSlug } : {}),
          // #1014: 0-based item indexes present on this step's outputs, so an
          // agent can build `--reject` (1-based) without re-deriving them.
          ...(itemIndexes.length > 0 ? { itemIndexes } : {}),
          outputs: outputs.map((o) => ({
            n: o.n,
            text: o.text,
            ...(o.label ? { label: o.label } : {}),
            humanEdited: o.humanEdited,
            ...(o.item ? { item: o.item } : {}),
          })),
        }),
      ],
    };
  }
  const stepLabel = node
    ? `${node.nodeId} (${node.botSlug ? `${node.kind}: ${node.botSlug}` : node.kind})`
    : (pf.run.pausedNodeId ?? "-");
  const itemsNote =
    itemIndexes.length > 0
      ? [
          `This step ran once per item (${itemIndexes.length} of them). Approve keeps every item;`,
          "reject drops the ones you name and the run carries on with the rest.",
          "",
        ]
      : [];
  const rejectLine =
    itemIndexes.length > 0
      ? [`Reject:  exodus workflow checkpoint ${runId} approve --reject 2 --wait`]
      : [];
  return {
    code: 0,
    lines: [
      `Checkpoint — ${pf.run.workflowName}`,
      `runId:      ${runId}`,
      `step:       ${stepLabel}`,
      "",
      "The run is holding at this checkpoint until you say go.",
      "",
      ...itemsNote,
      `Its output (${outputs.length}):`,
      formatCheckpointOutputs(outputs),
      "",
      `Approve: exodus workflow checkpoint ${runId} approve --wait`,
      ...rejectLine,
      `Edit:    exodus workflow checkpoint ${runId} edit 1 --text "..."`,
      `Redo:    exodus workflow checkpoint ${runId} retry --wait`,
      `Cancel:  exodus workflow cancel ${runId} --reason "..."`,
    ],
  };
}

/**
 * #1014: parse `--reject 2,5` into the ITEM NUMBERS the member sees ("Item 2 of
 * 7" → 2), 1-based, deduped and ascending. Syntax only — whether an item exists
 * on this checkpoint, and whether rejecting them all is allowed, is the server's
 * ruling (duplicating it here would drift). Returns a friendly message instead
 * of a number list when the flag is unusable.
 */
export function parseRejectItems(
  raw: string | undefined,
): { ok: true; items: number[] } | { ok: false; message: string } {
  const bad = (why: string) => ({
    ok: false as const,
    message: `${why} --reject takes the item numbers you see in "checkpoint show", like --reject 2 or --reject 2,5.`,
  });
  if (raw === undefined || raw.trim() === "") return bad("--reject needs at least one item number.");
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return bad("--reject needs at least one item number.");
  const items: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return bad(`"${part}" isn't an item number.`);
    const n = Number(part);
    // Items are counted from 1 for the member, exactly like `edit <n>`.
    if (n < 1) return bad("Items are numbered from 1.");
    if (!items.includes(n)) items.push(n);
  }
  return { ok: true, items: items.sort((a, b) => a - b) };
}

export async function checkpointApproveFlow(
  runId: string,
  opts: {
    wait: boolean;
    json: boolean;
    onProgressLine?: (line: string) => void;
    /** #1014: the raw `--reject` flag value, unparsed (e.g. "2,5"). */
    reject?: string;
  },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  // Parse BEFORE the network: a typo'd flag should cost nothing and say so.
  let rejectItems: number[] | undefined;
  if (opts.reject !== undefined) {
    const parsed = parseRejectItems(opts.reject);
    if (!parsed.ok) return errLine(parsed.message, opts.json);
    rejectItems = parsed.items;
  }

  const pf = await preflightPark(
    runId,
    "checkpoint",
    "workflow checkpoint approve",
    opts.json,
    deps,
  );
  if (!pf.ok) return pf.result;

  // Without --reject this is the plain approve, byte-for-byte as it always was:
  // a checkpoint park approves through the SAME route every other park uses.
  if (rejectItems === undefined) {
    const res = await deps.post(APPROVE_PATH, { runId });
    if (!res.ok) return triggerErrorResult(res, "workflow checkpoint approve", opts.json);
    const triggerRunId = (res.data as { triggerRunId?: string }).triggerRunId;
    return resumeAndMaybeWait(
      runId,
      triggerRunId,
      ["Checkpoint approved — the run resumes."],
      opts,
      deps,
    );
  }

  // With --reject it is the per-item door. The member counts items from 1; the
  // route speaks the artifact's own 0-based `item.index`, so convert here — the
  // one place the two numberings meet.
  const rejections = rejectItems.map((n) => n - 1);
  const res = await deps.post(CHECKPOINT_RESOLVE_ITEMS_PATH, { runId, rejections });
  if (!res.ok) return triggerErrorResult(res, "workflow checkpoint approve", opts.json);
  const data = (res.data ?? {}) as {
    triggerRunId?: string;
    rejected?: number[];
    remaining?: number;
  };
  // Echo the SERVER's accounting (it deduped and culled), re-based to 1 for the
  // member. Falling back to what we sent keeps the line honest on an old backend.
  const rejected = (data.rejected ?? rejections).map((i) => i + 1).sort((a, b) => a - b);
  const kept = data.remaining ?? 0;
  const total = kept + rejected.length;
  return resumeAndMaybeWait(
    runId,
    data.triggerRunId,
    [`Approved — kept ${kept} of ${total} items (rejected: ${rejected.join(", ")}).`],
    opts,
    deps,
    undefined,
    { rejected, remaining: kept },
  );
}

export async function checkpointEditFlow(
  runId: string,
  n: number,
  sources: { text?: string; file?: string; stdin?: string },
  opts: { json: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const provided = [sources.text, sources.file, sources.stdin].filter((x) => x !== undefined);
  if (provided.length === 0) {
    return errLine(
      "Provide the replacement text via one of --text, --file <path>, or piped stdin.",
      opts.json,
    );
  }
  if (provided.length > 1) {
    return errLine(
      "Provide the replacement text via exactly one of --text, --file, or stdin — not several.",
      opts.json,
    );
  }

  let text: string;
  if (sources.text !== undefined) {
    text = sources.text;
  } else if (sources.file !== undefined) {
    try {
      text = deps.readFile(sources.file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errLine(`Could not read file "${sources.file}": ${msg}`, opts.json);
    }
  } else {
    text = sources.stdin as string;
  }

  const pf = await preflightPark(runId, "checkpoint", "workflow checkpoint edit", opts.json, deps);
  if (!pf.ok) return pf.result;
  const outputs = checkpointOutputs(pf.run);
  const target = outputs.find((o) => o.n === n);
  if (!target) return checkpointRangeError(n, outputs.length, opts.json);

  // The route's outputIndex indexes the node's FULL outputs array (non-text
  // artifacts included), never the numbered text subset.
  const res = await deps.post(CHECKPOINT_EDIT_PATH, {
    runId,
    nodeId: pf.run.pausedNodeId,
    outputIndex: target.outputIndex,
    text,
  });
  if (!res.ok) return triggerErrorResult(res, "workflow checkpoint edit", opts.json);
  return okLine(
    `Edited output ${n} at ${pf.run.pausedNodeId}. Approve to continue: exodus workflow checkpoint ${runId} approve --wait`,
    { ok: true, runId, nodeId: pf.run.pausedNodeId, outputIndex: target.outputIndex },
    opts.json,
  );
}

export async function checkpointRetryFlow(
  runId: string,
  opts: {
    wait: boolean;
    json: boolean;
    // #1144: why the step is being sent back. Model-backed steps follow it on
    // the redo; deterministic ones only record it on the review trail.
    note?: string;
    onProgressLine?: (line: string) => void;
  },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const pf = await preflightPark(runId, "checkpoint", "workflow checkpoint retry", opts.json, deps);
  if (!pf.ok) return pf.result;
  // Throws away what is waiting at the box and runs the step feeding it again
  // (#1069 — a Checkpoint only passes things through, so re-running the box
  // itself would hand back the identical text); the run parks right back here
  // with the fresh output.
  const note = opts.note?.trim();
  const res = await deps.post(CHECKPOINT_RETRY_PATH, {
    runId,
    ...(note ? { note } : {}),
  });
  if (!res.ok) return triggerErrorResult(res, "workflow checkpoint retry", opts.json);
  const triggerRunId = (res.data as { triggerRunId?: string }).triggerRunId;
  // --wait therefore LANDS ON THE FRESH PARK — a successful redo never reaches a
  // finished run, so waiting for one would poll for an hour and then report a
  // false timeout. The retry route only returns once the run has been reset to
  // queued, so the first checkpoint park we see while polling is the new one.
  return resumeAndMaybeWait(
    runId,
    triggerRunId,
    ["Redoing the step that feeds this checkpoint — its old output is discarded."],
    opts,
    deps,
    {
      pauseReason: "checkpoint",
      headline: "  ⏸ The step re-ran — its fresh output is waiting on your approval.",
    },
  );
}

/**
 * #1231 — stop a run that has not finished. THE one cancel implementation;
 * `workflow cancel <runId>` and the older `workflow checkpoint <runId> cancel`
 * are two doors onto it.
 *
 * There is deliberately NO preflight here. The old checkpoint-only door ran
 * `preflightPark(runId, ["checkpoint","taste"])` first, which refused a queued
 * or running run ("… is not parked for a checkpoint approval — it is status:
 * Running.") and never reached the route at all — so the CLI could not stop a
 * run that was actively spending money, even though the server has accepted
 * exactly that since #1217. The server owns the only real precondition ("has
 * this run already finished?"), it states it in a sentence written for a
 * member, and `triggerErrorResult` relays that sentence verbatim. A second,
 * CLI-side opinion about which runs are cancellable could only be wrong.
 *
 * (Cancelling cascades to any queued/running child sub-workflow in the same
 * transaction, and schedules a best-effort stop of the in-flight worker — see
 * convex/workflows.ts cancelWorkflowRun / cancelTriggerRun.)
 */
export async function cancelRunFlow(
  runId: string,
  opts: { reason?: string; json: boolean; verb?: string },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const res = await deps.post(CANCEL_PATH, {
    runId,
    ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
  });
  if (!res.ok) return triggerErrorResult(res, opts.verb ?? "workflow cancel", opts.json);
  // Deliberately does NOT promise the worker died. The run row is cancelled
  // transactionally, and any queued/running child is cancelled with it — those
  // are facts. Stopping the in-flight worker is a separate best-effort hop
  // (convex/workflows.ts cancelTriggerRun): it warns and returns when
  // TRIGGER_API_KEY is unset, when Trigger answers non-2xx, and when the call
  // throws. Claiming the kill would be a guarantee the system doesn't make.
  return okLine(
    `Canceled — run ${runId} is marked cancelled and won't go any further. Any sub-workflow it started is cancelled too, and a stop was sent to the step still running.`,
    { ok: true, runId },
    opts.json,
  );
}

/**
 * The `workflow checkpoint <runId> cancel` door (#998). Kept verbatim so nobody's
 * muscle memory (or script) breaks; it delegates to {@link cancelRunFlow}.
 *
 * #1012 context: this door has always accepted a legacy "taste" park too — a run
 * frozen at a retired Gate box can't be approved anymore, and the pause notice
 * sends members here to cancel it. With the preflight gone (#1231) that is no
 * longer a special case: every non-terminal run is cancellable from either door.
 */
export async function checkpointCancelFlow(
  runId: string,
  opts: { reason?: string; json: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  return cancelRunFlow(
    runId,
    { ...opts, verb: "workflow checkpoint cancel" },
    deps,
  );
}

// ── Repair verbs ──────────────────────────────────────────────────────────

export async function repairFlow(
  runId: string,
  action: "retry" | "skip" | "kill",
  opts: { wait: boolean; json: boolean; onProgressLine?: (line: string) => void },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const verb = `workflow repair ${action}`;
  const pf = await preflightPark(runId, "repair", verb, opts.json, deps);
  if (!pf.ok) return pf.result;
  if (action === "skip" && isWorkerStoppedPark(pf.run)) {
    return errLine(
      `Run ${runId} has nothing to skip — its worker stopped partway. ` +
        `Carry on from where it stopped (finished steps are kept): exodus workflow repair ${runId} retry`,
      opts.json,
    );
  }

  if (action === "kill") {
    // Kill cancels with NO reason (a repair kill is not a taste rejection).
    const res = await deps.post(CANCEL_PATH, { runId });
    if (!res.ok) return triggerErrorResult(res, verb, opts.json);
    return okLine(`Repair killed — run ${runId} canceled.`, { ok: true, runId }, opts.json);
  }

  const path = action === "retry" ? REPAIR_RETRY_PATH : REPAIR_SKIP_PATH;
  const res = await deps.post(path, { runId });
  if (!res.ok) return triggerErrorResult(res, verb, opts.json);
  const triggerRunId = (res.data as { triggerRunId?: string }).triggerRunId;
  return resumeAndMaybeWait(
    runId,
    triggerRunId,
    [`Repair ${action} started — the run resumes.`],
    opts,
    deps,
  );
}

/**
 * Shared tail for the resume verbs (approve / repair retry|skip): print the new
 * triggerRunId, and if --wait re-enter the existing poll loop with the resumed
 * run. The resume returns a NEW triggerRunId; waitForRun polls the same runId.
 *
 * `landOnPark` (#998, optional) is passed straight through to waitForRun for the
 * one verb whose resume is EXPECTED to re-park — `checkpoint retry`. Every other
 * caller omits it and keeps today's "poll until the run finishes" behavior.
 *
 * `extraJson` (#1014, optional) folds verb-specific receipt fields into the JSON
 * base — the per-item approve reports what it culled. Human output is unaffected.
 */
async function resumeAndMaybeWait(
  runId: string,
  triggerRunId: string | undefined,
  headline: string[],
  opts: { wait: boolean; json: boolean; onProgressLine?: (line: string) => void },
  deps: WorkflowRunDeps,
  landOnPark?: { pauseReason: WorkflowPauseReason; headline: string },
  extraJson?: Record<string, unknown>,
): Promise<FlowResult> {
  const base = { runId, triggerRunId, ...(extraJson ?? {}) };
  const startLines = [
    ...headline,
    `runId:        ${runId}`,
    `triggerRunId: ${triggerRunId ?? "-"}`,
    `Poll: exodus workflow status --id ${runId}`,
  ];

  if (!opts.wait) {
    if (opts.json) return { code: 0, lines: [JSON.stringify(base)] };
    return { code: 0, lines: startLines };
  }

  if (!opts.json && opts.onProgressLine) {
    for (const line of startLines) opts.onProgressLine(line);
  }
  const waited = await waitForRun(
    runId,
    {
      json: opts.json,
      onProgressLine: opts.onProgressLine,
      jsonBase: base,
      ...(landOnPark ? { landOnPark } : {}),
    },
    deps,
  );
  if (opts.json) return waited;
  const prefix = opts.onProgressLine ? [] : startLines;
  return { code: waited.code, lines: [...prefix, ...waited.lines] };
}

// ── Answer verb (nested-slot parks) ───────────────────────────────────────

/** Collect the repeatable `--slot key=value` flag into a values map. */
export function parseSlotFlags(occurrences: FlagOccurrence[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { flag, value } of occurrences) {
    if (flag !== "slot") continue;
    if (!value) throw new Error("--slot requires key=value");
    const eq = value.indexOf("=");
    if (eq <= 0) throw new Error(`--slot must be key=value (got "${value}")`);
    const key = value.slice(0, eq).trim();
    if (!key) throw new Error(`--slot must include a key (got "${value}")`);
    values[key] = value.slice(eq + 1);
  }
  return values;
}

export async function answerFlow(
  runId: string,
  values: Record<string, string>,
  opts: { json: boolean },
  deps: WorkflowRunDeps,
): Promise<FlowResult> {
  const pf = await preflightPark(runId, "slots", "workflow answer", opts.json, deps);
  if (!pf.ok) return pf.result;
  const pending = pf.run.pendingSlots ?? [];

  // No --slot flags → show what this run is waiting on (the slot ids).
  if (Object.keys(values).length === 0) {
    if (opts.json) {
      return { code: 0, lines: [JSON.stringify({ runId, pendingSlots: pending })] };
    }
    const lines = [`Run ${runId} is waiting on ${pending.length} slot answer(s):`];
    for (const s of pending) {
      const label = s.label ? ` — ${s.label}` : "";
      const hint = s.hint ? ` (${s.hint})` : "";
      lines.push(`  ${s.id}${label}${hint}`);
    }
    lines.push("", `Answer: exodus workflow answer ${runId} --slot ${pending[0]?.id ?? "key"}=value`);
    return { code: 0, lines };
  }

  const res = await deps.post(ANSWER_PATH, { runId, values });
  if (!res.ok) return triggerErrorResult(res, "workflow answer", opts.json);
  return okLine(
    `Answered ${Object.keys(values).length} slot(s) for run ${runId} — the child resumes.`,
    { ok: true, runId, values },
    opts.json,
  );
}

// ── Command dispatch ─────────────────────────────────────────────────────

function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" ? v : undefined;
}

function parsePositional(args = process.argv.slice(3)): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2).split("=", 1)[0] ?? "";
      if (!arg.includes("=") && VALUE_FLAGS.has(key)) i += 2;
      else i++;
      continue;
    }
    out.push(arg);
    i++;
  }
  return out;
}

async function printResult(result: FlowResult): Promise<void> {
  for (const line of result.lines) console.log(line);
  if (result.code !== 0) process.exit(result.code);
}

/** Read all of stdin to a string. */
async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Resolve piped stdin as an edit source: only when neither --text nor --file
 * was given AND stdin is not a TTY (i.e. it was piped/redirected). A single
 * trailing newline is stripped. Returns undefined when stdin isn't a source.
 */
async function maybeReadStdin(
  flags: Record<string, string | boolean>,
): Promise<string | undefined> {
  if (flagString(flags, "text") !== undefined || flagString(flags, "file") !== undefined) {
    return undefined;
  }
  if (process.stdin.isTTY) return undefined;
  const raw = await readAllStdin();
  if (raw.length === 0) return undefined;
  return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
}

export async function run(
  flags: Record<string, string | boolean>,
  occurrences: FlagOccurrence[],
): Promise<void> {
  const positional = parsePositional();
  const [sub, ...rest] = positional;
  const json = !!flags["json"];

  if (!sub) {
    console.log(helpText);
    return;
  }

  if (sub === "list") return printResult(await listFlow(json, defaultDeps));

  if (sub === "describe") {
    const workflowRef = rest[0];
    if (!workflowRef) {
      console.error("Error: workflow describe requires <workflowId|name>.");
      console.log("Usage: exodus workflow describe <workflowId|name> [--json]");
      process.exit(1);
    }
    return printResult(await describeFlow(workflowRef, { json }, defaultDeps));
  }

  if (sub === "bots") {
    return printResult(
      await botsFlow(
        { category: flagString(flags, "category"), slug: flagString(flags, "slug"), json },
        defaultDeps,
      ),
    );
  }

  if (sub === "templates") {
    const action = rest[0];
    if (!action || action === "list") {
      return printResult(await templatesListFlow(json, defaultDeps));
    }
    if (action === "export") {
      const key = rest[1];
      if (!key) {
        console.error("Error: workflow templates export requires <key>.");
        console.log("Usage: exodus workflow templates export <key> [--out <file>] [--json]");
        process.exit(1);
      }
      return printResult(
        await templatesExportFlow(key, { out: flagString(flags, "out"), json }, defaultDeps),
      );
    }
    console.error(`Unknown templates action: "${action}"`);
    console.log("Usage: exodus workflow templates [list] | exodus workflow templates export <key>");
    process.exit(1);
  }

  if (sub === "schema") {
    return printResult(
      await schemaFlow(
        { json, kind: flagString(flags, "kind"), face: flagString(flags, "face") },
        defaultDeps,
      ),
    );
  }

  if (sub === "validate") {
    const file = rest[0];
    if (!file) {
      console.error("Error: workflow validate requires <file>.");
      console.log("Usage: exodus workflow validate <file> [--update <workflowId>] [--json]");
      process.exit(1);
    }
    return printResult(
      await validateFlow(file, { json, update: flagString(flags, "update") }, defaultDeps),
    );
  }

  if (sub === "run") {
    const workflowRef = rest[0];
    if (!workflowRef) {
      console.error("Error: workflow run requires <workflowId|name>.");
      console.log(
        "Usage: exodus workflow run <workflowId|name> [--fill <name>] [--input key=value ...] [--input <fileField>=./path/to/file ...] [--rig-overrides <json|@file>] [--voices <json|@voices.json>] [--voice-treatment <name|json|@file>] [--auto-approve] [--wait] [--json]",
      );
      process.exit(1);
    }
    let inputs: Record<string, string>;
    let fill: string | undefined;
    let autoApprove: boolean;
    let imageRigOverrides: Record<string, unknown> | undefined;
    let voices: VoiceMap | undefined;
    let voiceTreatment: VoiceTreatmentBody | undefined;
    try {
      // Stage 3B: parse RAW. runFlow expands `@path` text inputs and uploads
      // file inputs once describe has said which fields are which.
      inputs = parseRawInputFlags(occurrences);
      // #1259: --terminal (partial runs, #860) was repealed by #1222. Refuse it
      // HERE, before a single request goes out, so an old script gets one plain
      // sentence instead of a raw server error.
      rejectTerminalFlag(occurrences);
      fill = parseFillFlag(occurrences);
      // #1079: --auto-approve alone still reads the raw words, because only they
      // tell `--auto-approve=yes` (refused) from `--auto-approve yes` (the flag
      // plus a positional). See parseAutoApproveFlag.
      autoApprove = parseAutoApproveFlag(process.argv.slice(3));
      // #1084 (F2): --rig-overrides is parsed HERE, before anything is
      // requested — a JSON typo must cost a shell error, not a run.
      imageRigOverrides = parseRigOverridesFlag(occurrences, defaultDeps.readFile);
      // #1846: --voices is parsed here for the same reason — a typo in the
      // brand's voices.json must cost a shell error, not a run.
      voices = parseVoicesFlag(occurrences, defaultDeps.readFile);
      // #1869: and --voice-treatment, for the same reason again.
      voiceTreatment = parseVoiceTreatmentFlag(occurrences, defaultDeps.readFile);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    return printResult(
      await runFlow(
        workflowRef,
        {
          inputs,
          // #1013: reuse a saved fill by name; --input still wins per key.
          fill,
          // #1079: parsed off the raw argv above (parseAutoApproveFlag), never
          // the shared flags map. No VALUE_FLAGS entry either — that set only
          // exists so parsePositional can skip a flag's VALUE, and this flag
          // takes none.
          autoApprove,
          // #1084 (F2): the per-run Image Rig re-aim, parsed above.
          imageRigOverrides,
          // #1846: the voices this run starts with, parsed above.
          voices,
          // #1869: how this run makes them, parsed above.
          voiceTreatment,
          wait: flags["wait"] === true,
          json,
          // #1002: --out saves the finished run's deliverables (needs --wait).
          out: flagString(flags, "out"),
          onProgressLine: (line) => console.log(line),
          // #1082: warnings go to STDERR — visible in a terminal, and harmless
          // to a `--json` consumer piping stdout.
          onWarningLine: (line) => console.error(line),
        },
        defaultDeps,
      ),
    );
  }

  if (sub === "status") {
    return printResult(
      await statusFlow(
        { id: flagString(flags, "id"), json, out: flagString(flags, "out") },
        defaultDeps,
      ),
    );
  }

  if (sub === "versions") {
    const workflowRef = rest[0];
    if (!workflowRef) {
      console.error("Error: workflow versions requires <workflowId|name>.");
      console.log("Usage: exodus workflow versions <workflowId|name> [--json]");
      process.exit(1);
    }
    return printResult(await versionsFlow(workflowRef, { json }, defaultDeps));
  }

  if (sub === "export") {
    const workflowRef = rest[0];
    if (!workflowRef) {
      console.error("Error: workflow export requires <workflowId|name>.");
      console.log("Usage: exodus workflow export <workflowId|name> [--out <file>] [--version <n>]");
      process.exit(1);
    }
    let version: number | undefined;
    try {
      version = parseVersionFlag(flags);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    return printResult(
      await exportFlow(workflowRef, { out: flagString(flags, "out"), json, version }, defaultDeps),
    );
  }

  if (sub === "import") {
    const file = rest[0];
    if (!file) {
      console.error("Error: workflow import requires <file>.");
      console.log("Usage: exodus workflow import <file> [--update <workflowId>] [--dry-run] [--json]");
      process.exit(1);
    }
    return printResult(
      await importFlow(
        file,
        { dryRun: flags["dry-run"] === true, json, update: flagString(flags, "update") },
        defaultDeps,
      ),
    );
  }

  // ── Park cluster (#891) ────────────────────────────────────────────────

  if (sub === "inbox") {
    return printResult(await inboxFlow(json, defaultDeps));
  }

  // #1012: the Gate node retired in 2.0, and with it every `workflow gate`
  // subverb. The command stays mounted so an old script (or muscle memory) gets
  // a pointer instead of "unknown subcommand", and exits non-zero so an
  // automation that still calls it FAILS rather than quietly doing nothing.
  if (sub === "gate") {
    console.error(RETIRED_GATE_VERB_POINTER);
    process.exit(1);
  }

  // ── Checkpoint cluster (#998) ──────────────────────────────────────────

  if (sub === "checkpoint") {
    const runId = rest[0];
    if (!runId) {
      console.error("Error: workflow checkpoint requires <runId>.");
      console.log('Usage: exodus workflow checkpoint <runId> [show | edit <n> | approve [--reject <n,..>] | retry | cancel]');
      process.exit(1);
    }
    const action = rest[1];

    // No action (or an explicit `show`) → print the paused step and its output.
    if (!action || action === "show") {
      return printResult(await checkpointShowFlow(runId, { json }, defaultDeps));
    }

    if (action === "edit") {
      const n = parseTriggerIndex(rest[2]);
      if (n === undefined) {
        console.error("Error: checkpoint edit needs a 1-based output number <n>.");
        console.log(`Usage: exodus workflow checkpoint <runId> edit <n> [--text "..." | --file <path> | (stdin)]`);
        process.exit(1);
      }
      const stdin = await maybeReadStdin(flags);
      return printResult(
        await checkpointEditFlow(
          runId,
          n,
          { text: flagString(flags, "text"), file: flagString(flags, "file"), stdin },
          { json },
          defaultDeps,
        ),
      );
    }

    if (action === "approve") {
      return printResult(
        await checkpointApproveFlow(
          runId,
          {
            wait: flags["wait"] === true,
            json,
            onProgressLine: (line) => console.log(line),
            // #1014: passed raw — the flow parses it, so a bad value comes back
            // as a normal (--json-shaped) error instead of a bare exit.
            ...(flags["reject"] !== undefined
              ? { reject: flagString(flags, "reject") ?? "" }
              : {}),
          },
          defaultDeps,
        ),
      );
    }

    if (action === "retry") {
      return printResult(
        await checkpointRetryFlow(
          runId,
          {
            wait: flags["wait"] === true,
            json,
            // #1144: ride the redo with a correction the re-run can follow.
            ...(flags["note"] !== undefined
              ? { note: flagString(flags, "note") }
              : {}),
            onProgressLine: (line) => console.log(line),
          },
          defaultDeps,
        ),
      );
    }

    if (action === "cancel") {
      return printResult(
        await checkpointCancelFlow(runId, { reason: flagString(flags, "reason"), json }, defaultDeps),
      );
    }

    console.error(`Error: unknown checkpoint action "${action}" (expected show, edit, approve, retry, or cancel).`);
    process.exit(1);
  }

  // #1231: cancel is its own top-level verb — a run does NOT have to be parked
  // to be stopped, so burying it under `checkpoint` hid it from exactly the
  // person watching a queued or running job burn money. The checkpoint door
  // above still works and reaches the same flow.
  if (sub === "cancel") {
    const runId = rest[0];
    if (!runId) {
      console.error("Error: workflow cancel requires <runId>.");
      console.log('Usage: exodus workflow cancel <runId> [--reason "..."] [--json]');
      process.exit(1);
    }
    return printResult(
      await cancelRunFlow(runId, { reason: flagString(flags, "reason"), json }, defaultDeps),
    );
  }

  if (sub === "repair") {
    const runId = rest[0];
    if (!runId) {
      console.error("Error: workflow repair requires <runId>.");
      console.log("Usage: exodus workflow repair <runId> retry|skip|kill [--wait]");
      process.exit(1);
    }
    const action = rest[1];
    if (action !== "retry" && action !== "skip" && action !== "kill") {
      console.error(`Error: workflow repair needs an action (retry, skip, or kill)${action ? ` — got "${action}"` : ""}.`);
      console.log("Usage: exodus workflow repair <runId> retry|skip|kill [--wait]");
      process.exit(1);
    }
    return printResult(
      await repairFlow(
        runId,
        action,
        { wait: flags["wait"] === true, json, onProgressLine: (line) => console.log(line) },
        defaultDeps,
      ),
    );
  }

  if (sub === "answer") {
    const runId = rest[0];
    if (!runId) {
      console.error("Error: workflow answer requires <runId>.");
      console.log("Usage: exodus workflow answer <runId> --slot key=value [--slot key=value ...]");
      process.exit(1);
    }
    let values: Record<string, string>;
    try {
      values = parseSlotFlags(occurrences);
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    return printResult(await answerFlow(runId, values, { json }, defaultDeps));
  }

  if (sub === "triggers") {
    const workflowRef = rest[0];
    if (!workflowRef) {
      console.error("Error: workflow triggers requires <workflowId|name>.");
      console.log("Usage: exodus workflow triggers <workflowId|name> [enable|disable <n> | fire [<n>]] [--json]");
      process.exit(1);
    }
    const action = rest[1];

    // No action → LIST.
    if (!action) return printResult(await triggersListFlow(workflowRef, { json }, defaultDeps));

    if (action === "enable" || action === "disable") {
      const n = parseTriggerIndex(rest[2]);
      if (n === undefined) {
        console.error(`Error: workflow triggers ${action} requires a 1-based trigger number <n>.`);
        console.log(`Usage: exodus workflow triggers <workflowId|name> ${action} <n>`);
        process.exit(1);
      }
      return printResult(
        await triggersSetEnabledFlow(workflowRef, n, action === "enable", { json }, defaultDeps),
      );
    }

    if (action === "fire") {
      // <n> optional; when present it must be a valid 1-based index.
      let n: number | undefined;
      if (rest[2] !== undefined) {
        n = parseTriggerIndex(rest[2]);
        if (n === undefined) {
          console.error(`Error: trigger number must be a positive integer (got "${rest[2]}").`);
          process.exit(1);
        }
      }
      // #1084 (F2): same parse the run verb uses — a bad payload must fail
      // here, before a run fires on the owner's keys.
      let fireOverrides: Record<string, unknown> | undefined;
      // #1863: and the per-fire voices, parsed here for the same reason.
      let fireVoices: VoiceMap | undefined;
      try {
        fireOverrides = parseRigOverridesFlag(occurrences, defaultDeps.readFile);
        fireVoices = parseVoicesFlag(occurrences, defaultDeps.readFile);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      return printResult(
        await triggersFireFlow(
          workflowRef,
          {
            n,
            text: flagString(flags, "text"),
            imageRigOverrides: fireOverrides,
            voices: fireVoices,
            wait: flags["wait"] === true,
            json,
            onProgressLine: (line) => console.log(line),
          },
          defaultDeps,
        ),
      );
    }

    console.error(`Error: unknown triggers action "${action}" (expected enable, disable, or fire).`);
    console.log("Usage: exodus workflow triggers <workflowId|name> [enable|disable <n> | fire [<n>]] [--json]");
    process.exit(1);
  }

  console.error(`Unknown subcommand: "${sub}"\n`);
  console.log(helpText);
  process.exit(1);
}

/** Parse a user-facing 1-based trigger number; undefined if not a positive int. */
function parseTriggerIndex(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= 1 ? n : undefined;
}
