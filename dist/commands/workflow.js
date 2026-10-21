import fs from "node:fs";
import path from "node:path";
import nodePath from "node:path";
import { apiGet, apiGetText, apiPost, apiPostDashboard, getDashboardUrl, } from "../lib/client.js";
import { formatApiError } from "../lib/format.js";
import { pollUntilDone } from "../lib/poll.js";
import { normalizeRunStatus, isTerminalRunStatus, storedWorkflowStatusForms, isWorkerStoppedPark, TERMINAL_RUN_STATUSES, } from "../lib/runStatus.js";
import { runVerdict } from "../lib/runVerdict.js";
import { runDisplayName, runHeadingWord, runTypeWord } from "../lib/runNames.js";
import { workflowToYaml, parseWorkflowText } from "../lib/workflowText.js";
import { missingRouteLine } from "../lib/route-support.js";
import { getChannel } from "../lib/channel.js";
import { asVideoRun, classifyRun, resolveStopAtPark, reviewUrl, scenePrefix, stopLines, } from "./video.js";
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
export function formatRulesLine(provenance) {
    const format = provenance?.format;
    if (!format || typeof format !== "object")
        return undefined;
    const { rigName, specVersion, nodeId, rulesFrom } = format;
    if (typeof rigName !== "string" || rigName === "")
        return undefined;
    const version = typeof specVersion === "string" && specVersion !== ""
        ? `, version ${specVersion}`
        : "";
    const where = typeof nodeId === "string" && nodeId !== ""
        ? ` (from the "${nodeId}" Rig box)`
        : " (from the Show's rig)";
    const borrowed = rulesFrom && typeof rulesFrom.rigName === "string"
        ? ` The rules come from "${rulesFrom.rigName}".`
        : "";
    return `Format rules: ${rigName}${version}${where}.${borrowed}`;
}
export function pauseAheadLine(ahead) {
    if (ahead.after === "frames" && ahead.selfApproves) {
        return "When the frames are ready, the app checks the storyboard and approves it itself if the checks pass, then goes on to the voices and clips. It only stops for your approval if a check finds a problem. The reference, cast and scene pictures are made first (a few cents each).";
    }
    return ahead.after === "frames"
        ? "This run will pause for your approval once the frames are ready. The reference, cast and scene pictures are made first (a few cents each). Nothing bigger is spent until you approve."
        : "This run will pause for your approval once the storyboard is written. Nothing is spent on pictures, voices or clips until you approve.";
}
const LIST_PATH = "/api/v2/workflows";
const RUN_PATH = "/api/v2/workflows/run";
const STATUS_PATH = "/api/v2/workflow";
const EXPORT_PATH = "/api/v2/workflows/export";
const IMPORT_PATH = "/api/v2/workflows/import";
const DESCRIBE_PATH = "/api/v2/workflows/describe";
const ASSET_UPLOAD_URL_PATH = "/api/v2/workflows/asset-upload-url";
const ASSETS_PATH = "/api/v2/workflows/assets";
const CATALOG_PATH = "/api/v2/workflows/catalog";
const TRIGGERS_SET_ENABLED_PATH = "/api/v2/workflows/triggers/set-enabled";
const TRIGGERS_FIRE_PATH = "/api/v2/workflows/triggers/fire";
const TEMPLATES_PATH = "/api/v2/workflows/templates";
const SCHEMA_PATH = "/api/v2/workflows/schema";
const VERSIONS_PATH = "/api/v2/workflows/versions";
const VERSIONS_CAP = 50;
const INBOX_PATH = "/api/v2/workflow/inbox";
const APPROVE_PATH = "/api/v2/workflow/approve";
const CANCEL_PATH = "/api/v2/workflow/cancel";
const ANSWER_PATH = "/api/v2/workflow/answer";
const REPAIR_RETRY_PATH = "/api/v2/workflow/repair/retry";
const REPAIR_SKIP_PATH = "/api/v2/workflow/repair/skip";
const CHECKPOINT_RETRY_PATH = "/api/v2/workflow/checkpoint/retry";
const CHECKPOINT_EDIT_PATH = "/api/v2/workflow/checkpoint/edit";
const CHECKPOINT_RESOLVE_ITEMS_PATH = "/api/v2/workflow/checkpoint/resolve-items";
const RUN_PAGE_PREFIX = "/runs/";
const VALUE_FLAGS = new Set([
    "id",
    "input",
    "out",
    "category",
    "slug",
    "update",
    "terminal",
    "fill",
    "text",
    "kind",
    "face",
    "version",
    "file",
    "reason",
    "slot",
    "reject",
    "rig-overrides",
    "voices",
    "voice-treatment",
    "note",
]);
function defaultMkdirp(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
async function defaultDownloadToFile(url, path) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`download failed with HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path, buf);
}
const defaultDeps = {
    get: (path) => apiGet(path),
    getText: (path) => apiGetText(path),
    post: (path, body) => apiPost(path, body),
    readFile: (path) => fs.readFileSync(path, "utf-8"),
    writeFile: (path, text) => fs.writeFileSync(path, text, "utf-8"),
    poll: (opts) => pollUntilDone(opts),
    mkdirp: defaultMkdirp,
    downloadToFile: defaultDownloadToFile,
    postDashboard: (path, body, opts) => apiPostDashboard(path, body, opts),
    dashboardUrl: getDashboardUrl(),
    statFile: (filePath) => {
        try {
            const stat = fs.statSync(filePath);
            return stat.isFile() ? { size: stat.size } : null;
        }
        catch {
            return null;
        }
    },
    readFileBytes: (filePath) => fs.readFileSync(filePath),
    uploadBytes: async (uploadUrl, contentType, bytes) => {
        const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": contentType },
            body: new Blob([bytes]),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { ok: false, status: res.status, body };
        }
        const parsed = (await res.json().catch(() => ({})));
        return { ok: true, status: res.status, storageId: parsed.storageId };
    },
};
function asErrorResult(res, json) {
    return {
        code: 1,
        lines: json
            ? [JSON.stringify({ ok: false, status: res.status, data: res.data })]
            : [formatApiError(res)],
    };
}
function resolveIdErrorResult(e, json) {
    if (e instanceof WorkflowResolveError) {
        return {
            code: 1,
            lines: json
                ? [JSON.stringify({ ok: false, status: e.status, data: e.data })]
                : [e.message],
        };
    }
    const message = e instanceof Error ? e.message : String(e);
    return {
        code: 1,
        lines: json
            ? [JSON.stringify({ ok: false, status: 0, data: { error: { message } } })]
            : [message],
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dateOnly(value) {
    if (!value)
        return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return String(value);
    return parsed.toISOString().slice(0, 10);
}
function table(headers, rows) {
    const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)));
    const fmt = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();
    return [fmt(headers), fmt(headers.map((h) => "-".repeat(h.length))), ...rows.map(fmt)].join("\n");
}
function statusIcon(status) {
    if (status === "completed" || status === "done")
        return "✓";
    if (status === "failed")
        return "✗";
    if (status === "skipped")
        return "-";
    return "…";
}
function truncateText(text, max = 200) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, max - 3).trimEnd()}...`;
}
function formatCounts(counts) {
    if (!counts)
        return "";
    return `done=${counts.done}/${counts.total}, failed=${counts.failed}, skipped=${counts.skipped}`;
}
function outputLines(output) {
    if (output.type === "text")
        return [`    text: ${truncateText(output.text)}`];
    if (output.type === "primer") {
        return [`    primer:${output.primerKind}: ${truncateText(output.text)}`];
    }
    if (output.type === "image") {
        const url = output.imageUrl ?? output.storageId;
        return url ? [`    image: ${url}`] : [];
    }
    return [];
}
function progressLine(node, parked = false) {
    const err = node.error ? ` — error: ${node.error}` : "";
    if (parked) {
        return `  ⏸ ${node.nodeId} (${node.kind}) awaiting approval`;
    }
    return `  ${statusIcon(node.status)} ${node.nodeId} (${node.kind}) ${node.status}${err}`;
}
function gateParkedNodeId(status, pauseReason, pausedNodeId) {
    if (!status || normalizeRunStatus(status) !== "awaiting-approval")
        return undefined;
    if (pauseReason === "taste" || pauseReason === "checkpoint" || pauseReason === undefined) {
        return pausedNodeId;
    }
    return undefined;
}
const RETIRED_GATE_VERB_POINTER = "The Gate node retired in 2.0 — runs now pause at a Checkpoint box on the canvas. " +
    "Use: exodus workflow checkpoint <runId> [approve|edit|retry|cancel]";
export function formatPauseNotice(pauseReason, runId, dashboardUrl, { workerStopped = false } = {}) {
    if (!pauseReason) {
        return [
            "  ⏸ paused at the cost gate — approve or edit the storyboard in the web app to continue.",
        ];
    }
    if (pauseReason === "call") {
        return ["  ⏸ waiting on a child workflow run — it resumes on its own."];
    }
    if (pauseReason === "checkpoint") {
        return [
            "  ⏸ paused at a checkpoint — what's flowing through it is waiting on your approval.",
            `     Resolve here:  exodus workflow checkpoint ${runId}`,
            `     Or in the app: ${dashboardUrl}${RUN_PAGE_PREFIX}${runId}`,
        ];
    }
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
    const resolveVerb = pauseReason === "repair"
        ? `exodus workflow repair ${runId} retry|skip|kill`
        : `exodus workflow answer ${runId} --slot key=value`;
    return [
        "  ⏸ paused for review — waiting on you.",
        `     Resolve here:  ${resolveVerb}`,
        `     Or in the app: ${dashboardUrl}${RUN_PAGE_PREFIX}${runId}`,
    ];
}
function expandInputValue(key, value, readFile) {
    if (value.startsWith("@@"))
        return value.slice(1);
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
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`--input ${key}: could not read file "${filePath}": ${msg}`);
        }
    }
    return value;
}
function normalizeMultiValue(value) {
    return value
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .join(", ");
}
export function parseRawInputFlags(occurrences) {
    const inputs = {};
    for (const { flag, value } of occurrences) {
        if (flag !== "input")
            continue;
        if (!value)
            throw new Error("--input requires key=value");
        const eq = value.indexOf("=");
        if (eq <= 0)
            throw new Error(`--input must be key=value (got "${value}")`);
        const key = value.slice(0, eq).trim();
        if (!key)
            throw new Error(`--input must include a key (got "${value}")`);
        inputs[key] = value.slice(eq + 1);
    }
    return inputs;
}
export function parseInputFlags(occurrences, readFile) {
    const inputs = parseRawInputFlags(occurrences);
    for (const [key, value] of Object.entries(inputs)) {
        inputs[key] = expandInputValue(key, value, readFile);
    }
    return inputs;
}
const MB = 1024 * 1024;
export const ASSET_UPLOAD_POLICY = {
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
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        maxBytes: 25 * MB,
        accepts: "PDF, TXT, Markdown, DOC, DOCX",
    },
};
const MEDIA_FAMILIES = ["image", "video", "audio", "document"];
function sizeLabel(bytes) {
    return `${(bytes / MB).toFixed(1)}MB`;
}
function capLabel(bytes) {
    return `${Math.round(bytes / MB)}MB`;
}
function assetMimeFor(filePath, assetType) {
    const ext = path.extname(filePath).toLowerCase();
    if (!ext)
        return null;
    for (const family of assetType ? [assetType] : MEDIA_FAMILIES) {
        const mime = ASSET_UPLOAD_POLICY[family].mimeByExtension[ext];
        if (mime)
            return { mime, family };
    }
    return null;
}
function acceptedLabel(assetType) {
    if (assetType) {
        const policy = ASSET_UPLOAD_POLICY[assetType];
        return `${assetType} files (${policy.accepts}, up to ${capLabel(policy.maxBytes)})`;
    }
    return MEDIA_FAMILIES.map((family) => `${family} (${ASSET_UPLOAD_POLICY[family].accepts})`).join(", ");
}
function looksLikePath(value) {
    if (value.includes("/") || value.includes("\\"))
        return true;
    if (value.startsWith("~"))
        return true;
    return /\.[A-Za-z0-9]{1,8}$/.test(value);
}
function planAssetUpload(field, filePath, size, assetType, deps) {
    const name = path.basename(filePath);
    const picked = assetMimeFor(filePath, assetType);
    if (!picked) {
        throw new Error(`--input ${field}: can't tell what kind of file "${name}" is — ${field} takes ${acceptedLabel(assetType)}`);
    }
    const { maxBytes } = ASSET_UPLOAD_POLICY[picked.family];
    if (size > maxBytes) {
        throw new Error(`--input ${field}: "${name}" is ${sizeLabel(size)} — over the ${capLabel(maxBytes)} limit for ${picked.family} uploads`);
    }
    if (!deps.readFileBytes || !deps.uploadBytes) {
        throw new Error(`--input ${field}: cannot upload files here (no file access)`);
    }
    return { field, filePath, name, size, mime: picked.mime, family: picked.family };
}
async function pushAssetFile(plan, deps) {
    const { field, name } = plan;
    const mint = await deps.post(ASSET_UPLOAD_URL_PATH, {});
    if (!mint.ok) {
        throw new Error(missingRouteLine(mint, "workflow file inputs") ?? formatApiError(mint));
    }
    const minted = mint.data;
    if (!minted.uploadUrl) {
        throw new Error(`--input ${field}: the server did not return an upload URL for "${name}"`);
    }
    if (!minted.receiptId) {
        throw new Error(`--input ${field}: the server did not return an upload receipt for "${name}"`);
    }
    let bytes;
    try {
        bytes = deps.readFileBytes(plan.filePath);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`--input ${field}: could not read file "${plan.filePath}": ${msg}`);
    }
    const put = await deps.uploadBytes(minted.uploadUrl, plan.mime, bytes);
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
        throw new Error(missingRouteLine(registered, "workflow file inputs") ?? formatApiError(registered));
    }
    const data = registered.data;
    if (!data.assetId) {
        throw new Error(`--input ${field}: the server did not return an asset id for "${name}"`);
    }
    return { assetId: data.assetId, mediaType: data.mediaType ?? plan.family };
}
function formatInputProblems(problems) {
    if (problems.length === 1)
        return problems[0];
    return [
        `${problems.length} of the --input values can't be used:`,
        ...problems.map((line) => `  ${line}`),
    ].join("\n");
}
function withReusableAssetIds(message, done) {
    if (done.length === 0)
        return message;
    const flags = done.map((d) => `--input ${d.field}=${d.assetId}`).join(" ");
    return (`${message}\n` +
        `These files did upload — pass their ids to skip re-uploading them: ${flags}`);
}
function looksLikeFileArgument(value, deps) {
    if (value.startsWith("@@"))
        return false;
    if (value.startsWith("@"))
        return true;
    if ((deps.statFile?.(value) ?? null) !== null)
        return true;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value))
        return false;
    if (/\s/.test(value))
        return false;
    return looksLikePath(value);
}
export const NO_DELIVERIES_WARNING = "Warning: this workflow has no Output node — the run will finish with no named " +
    "deliveries (nothing for --out to save, and nothing to send to a webhook).";
export function noDeliveriesWarning(described) {
    if (!isRecord(described))
        return undefined;
    const deliveries = described["deliveries"];
    if (Array.isArray(deliveries)) {
        return deliveries.length === 0 ? NO_DELIVERIES_WARNING : undefined;
    }
    return undefined;
}
export function serverWarningsToPrint(serverWarnings, alreadyPrinted) {
    if (!Array.isArray(serverWarnings))
        return [];
    const key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const printedKeys = new Set(alreadyPrinted.map(key));
    const saidNoDeliveries = alreadyPrinted.includes(NO_DELIVERIES_WARNING);
    const out = [];
    for (const raw of serverWarnings) {
        if (typeof raw !== "string")
            continue;
        const text = raw.trim();
        if (text === "")
            continue;
        const k = key(text);
        if (printedKeys.has(k))
            continue;
        if (saidNoDeliveries && (k.includes("no output node") || k.includes("no named deliver"))) {
            continue;
        }
        printedKeys.add(k);
        out.push(text);
    }
    return out;
}
async function prepareRunInputs(workflowId, raw, deps, note) {
    const described = await deps.get(`${DESCRIBE_PATH}?id=${encodeURIComponent(workflowId)}`);
    if (!described.ok) {
        const fileish = Object.keys(raw).filter((key) => looksLikeFileArgument(raw[key], deps));
        if (fileish.length > 0) {
            const reason = formatApiError(described).split("\n")[0];
            throw new Error(`--input ${fileish.join(", ")}: couldn't confirm this workflow's inputs ` +
                `(describe failed: ${reason}) — retry, or pass an already-uploaded asset id ` +
                `instead of a file path.`);
        }
        const text = {};
        for (const [key, value] of Object.entries(raw)) {
            text[key] = expandInputValue(key, value, deps.readFile);
        }
        return { inputs: text, warnings: [] };
    }
    const warnings = [];
    const noDeliveries = noDeliveriesWarning(described.data);
    if (noDeliveries)
        warnings.push(noDeliveries);
    const descriptors = described.data.inputs ?? [];
    const assetFields = new Map();
    const multiFields = new Set();
    for (const descriptor of descriptors) {
        if (descriptor?.source === "asset")
            assetFields.set(descriptor.fieldName, descriptor);
        if (descriptor?.type === "multi-select")
            multiFields.add(descriptor.fieldName);
    }
    const missing = [...assetFields.values()].filter((d) => d.required && (raw[d.fieldName] ?? "").trim() === "");
    if (missing.length > 0) {
        const names = missing.map((d) => d.fieldName).join(", ");
        const first = missing[0];
        throw new Error(`Missing required file input(s): ${names}. Pass each one as a local file ` +
            `or a URL — e.g. --input ${first.fieldName}=./path/to/file or ` +
            `--input ${first.fieldName}=https://…` +
            (first.assetType ? ` (${acceptedLabel(first.assetType)})` : ""));
    }
    const prepared = {};
    const planned = [];
    const problems = [];
    for (const [key, value] of Object.entries(raw)) {
        const descriptor = assetFields.get(key);
        if (!descriptor) {
            try {
                const expanded = expandInputValue(key, value, deps.readFile);
                prepared[key] = multiFields.has(key)
                    ? normalizeMultiValue(expanded)
                    : expanded;
            }
            catch (e) {
                problems.push(e instanceof Error ? e.message : String(e));
            }
            continue;
        }
        if (/^https?:\/\//i.test(value)) {
            prepared[key] = value;
            continue;
        }
        const hinted = value.startsWith("@");
        const candidate = hinted ? value.slice(1) : value;
        const stat = deps.statFile?.(candidate) ?? null;
        if (!stat) {
            if (hinted || looksLikePath(candidate)) {
                problems.push(`--input ${key}: file not found: ${candidate}`);
                continue;
            }
            prepared[key] = value;
            continue;
        }
        try {
            planned.push(planAssetUpload(key, candidate, stat.size, descriptor.assetType, deps));
        }
        catch (e) {
            problems.push(e instanceof Error ? e.message : String(e));
        }
    }
    if (problems.length > 0)
        throw new Error(formatInputProblems(problems));
    const done = [];
    for (const plan of planned) {
        let uploaded;
        try {
            uploaded = await pushAssetFile(plan, deps);
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            throw new Error(withReusableAssetIds(message, done));
        }
        note(`  uploaded ${plan.name} → ${plan.field} (${uploaded.mediaType}, ${sizeLabel(plan.size)})`);
        prepared[plan.field] = uploaded.assetId;
        done.push({ field: plan.field, assetId: uploaded.assetId });
    }
    return { inputs: prepared, warnings };
}
export function rejectTerminalFlag(occurrences) {
    if (occurrences.some((o) => o.flag === "terminal")) {
        throw new Error("--terminal is no longer supported: a run now executes the whole " +
            "workflow or it doesn't start. Re-run without --terminal.");
    }
}
export function parseAutoApproveFlag(args) {
    for (const arg of args) {
        if (arg === "--auto-approve")
            return true;
        if (arg.startsWith("--auto-approve=")) {
            throw new Error("--auto-approve takes no value — pass it bare");
        }
    }
    return false;
}
export function parseRigOverridesFlag(occurrences, readFile) {
    let raw;
    for (const { flag, value } of occurrences) {
        if (flag !== "rig-overrides")
            continue;
        if (value === undefined || value.startsWith("--")) {
            throw new Error("--rig-overrides requires JSON or @path/to/file.json");
        }
        raw = value;
    }
    if (raw === undefined)
        return undefined;
    let text = raw.trim();
    if (!text)
        throw new Error("--rig-overrides requires JSON or @path/to/file.json");
    if (text.startsWith("@@")) {
        text = text.slice(1);
    }
    else if (text.startsWith("@")) {
        const filePath = text.slice(1);
        if (!filePath) {
            throw new Error("--rig-overrides @<file> needs a file path after \"@\"");
        }
        if (!readFile) {
            throw new Error(`--rig-overrides: cannot load @${filePath} here (no file access)`);
        }
        try {
            text = readFile(filePath);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`--rig-overrides: could not read file "${filePath}": ${msg}`);
        }
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`--rig-overrides is not valid JSON: ${msg}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("--rig-overrides must be a JSON object keyed by Image Rig node id, e.g. '{\"rig_1\":{\"lines\":{\"line_1\":{\"count\":3}}}}'");
    }
    return parsed;
}
export function parseVoicesFlag(occurrences, readFile) {
    let raw;
    for (const { flag, value } of occurrences) {
        if (flag !== "voices")
            continue;
        if (value === undefined || value.startsWith("--")) {
            throw new Error("--voices requires JSON or @path/to/voices.json");
        }
        raw = value;
    }
    if (raw === undefined)
        return undefined;
    let text = raw.trim();
    if (!text)
        throw new Error("--voices requires JSON or @path/to/voices.json");
    if (text.startsWith("@@")) {
        text = text.slice(1);
    }
    else if (text.startsWith("@")) {
        const filePath = text.slice(1);
        if (!filePath) {
            throw new Error("--voices @<file> needs a file path after \"@\"");
        }
        if (!readFile) {
            throw new Error(`--voices: cannot load @${filePath} here (no file access)`);
        }
        try {
            text = readFile(filePath);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`--voices: could not read file "${filePath}": ${msg}`);
        }
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`--voices is not valid JSON: ${msg}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("--voices must be a JSON object keyed by the script's speaker names, e.g. {\"HOST 1\":\"<voiceId>\"}");
    }
    return parsed;
}
export function parseVoiceTreatmentFlag(occurrences, readFile) {
    const usage = "--voice-treatment requires a treatment name, JSON, or @path/to/voice-treatment.json";
    let raw;
    for (const { flag, value } of occurrences) {
        if (flag !== "voice-treatment")
            continue;
        if (value === undefined || value.startsWith("--"))
            throw new Error(usage);
        raw = value;
    }
    if (raw === undefined)
        return undefined;
    let text = raw.trim();
    if (!text)
        throw new Error(usage);
    let fromFile = false;
    if (text.startsWith("@@")) {
        text = text.slice(1);
    }
    else if (text.startsWith("@")) {
        const filePath = text.slice(1);
        if (!filePath) {
            throw new Error("--voice-treatment @<file> needs a file path after \"@\"");
        }
        if (!readFile) {
            throw new Error(`--voice-treatment: cannot load @${filePath} here (no file access)`);
        }
        try {
            text = readFile(filePath);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`--voice-treatment: could not read file "${filePath}": ${msg}`);
        }
        fromFile = true;
    }
    if (!fromFile && !text.startsWith("{"))
        return { path: text };
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`--voice-treatment is not valid JSON: ${msg}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error('--voice-treatment must be a treatment name, or a JSON object like {"path":"native-prompt","describe":{"HOST 1":"..."}}');
    }
    return parsed;
}
export function parseFillFlag(occurrences) {
    let name;
    for (const { flag, value } of occurrences) {
        if (flag !== "fill")
            continue;
        if (value === undefined || value.startsWith("--")) {
            throw new Error("--fill requires a saved fill's name");
        }
        const trimmed = value.trim();
        if (!trimmed)
            throw new Error("--fill requires a saved fill's name");
        name = trimmed;
    }
    return name;
}
export function formatWorkflowList(workflows) {
    if (workflows.length === 0)
        return "No workflows found for the active brand.";
    return table(["name", "nodes", "edges", "updated", "id"], workflows.map((w) => [
        w.isCrossBrand && w.homeBrandName ? `${w.name} · from ${w.homeBrandName}` : w.name,
        String(w.nodeCount),
        String(w.edgeCount),
        dateOnly(w.updatedAt),
        w._id,
    ]));
}
const RECENT_RUNS_PAGE = 25;
export function formatRecentRuns(runs) {
    if (runs.length === 0)
        return "No workflow runs found for the active brand.";
    const rows = table(["run", "type", "status", "created", "id"], runs.map((r) => [
        runDisplayName(r),
        runTypeWord(r),
        runVerdict(r),
        dateOnly(r.createdAt),
        r._id,
    ]));
    const notes = [];
    if (runs.length >= RECENT_RUNS_PAGE) {
        notes.push(`Showing the ${RECENT_RUNS_PAGE} newest runs — there may be older ones this list doesn't reach.`);
    }
    if (runs.some((r) => !isTerminalRunStatus(r.status))) {
        notes.push(`Stop one that's still going: exodus workflow cancel <id> --reason "..."`);
    }
    return notes.length > 0 ? `${rows}\n\n${notes.join("\n")}` : rows;
}
export function formatWorkflowVersions(versions) {
    if (versions.length === 0) {
        return "no saved versions yet — versions start recording on the workflow's next save";
    }
    const lines = versions.map((v) => {
        const by = v.savedByName ? ` · by ${v.savedByName}` : "";
        return `v${v.version} · ${v.name} · saved ${dateOnly(v.savedAt)}${by}`;
    });
    if (versions.length === VERSIONS_CAP) {
        lines.push("");
        lines.push(`(showing the ${VERSIONS_CAP} most recent versions — older versions may exist beyond this cap)`);
    }
    return lines.join("\n");
}
export function formatImportSummary(result, mode = {}) {
    const lines = [];
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
    if (result.workflowId)
        lines.push(`workflowId:  ${result.workflowId}`);
    lines.push(`nodes:       ${result.nodeCount}`);
    lines.push(`edges:       ${result.edgeCount}`);
    if (result.triggers && result.triggers.length > 0) {
        lines.push("");
        const enabledCount = result.triggers.filter((t) => t.enabled).length;
        lines.push(`Triggers (${result.triggers.length}):`);
        for (const t of result.triggers) {
            const detail = t.type === "event" ? `event (${t.event})` : `cron (${t.cron})`;
            if (t.enabled) {
                const fires = t.type === "event"
                    ? t.event === "winner-promoted"
                        ? "fires on every promote"
                        : `fires on ${t.event}`
                    : `fires on schedule ${t.cron}`;
                lines.push(`  ⚠ ${detail} — ENABLED, ${fires}`);
            }
            else {
                lines.push(`  ${detail} — disabled`);
            }
        }
        if (enabledCount > 0) {
            lines.push(`  ⚠ ${enabledCount} enabled trigger${enabledCount === 1 ? "" : "s"} armed — a background run may start on the owner's keys. Disable with: exodus workflow triggers <id> disable <n>`);
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
        for (const warning of result.warnings)
            lines.push(`  ${warning}`);
    }
    return lines.join("\n");
}
export function formatWorkflowRun(run) {
    const lines = [];
    const counts = formatCounts(run.counts);
    lines.push(`${runHeadingWord(run)} — ${runDisplayName(run)}`);
    lines.push(`runId:        ${run._id}`);
    lines.push(`workflowId:   ${run.workflowId}`);
    if (run.triggerRunId)
        lines.push(`triggerRunId: ${run.triggerRunId}`);
    lines.push(`status:       ${runVerdict(run)}${counts ? ` (${counts})` : ""}`);
    if (run.isTerminal)
        lines.push("terminal:     yes");
    const rulesLine = formatRulesLine(run.provenance);
    if (rulesLine)
        lines.push(rulesLine);
    const treatmentLine = voiceTreatmentLine(run.provenance);
    if (treatmentLine)
        lines.push(treatmentLine);
    if (run.error)
        lines.push(`error:        ${run.error}`);
    if (Object.keys(run.inputs ?? {}).length > 0) {
        const inputs = Object.entries(run.inputs).map(([k, v]) => `${k}=${v}`).join(", ");
        lines.push(`inputs:       ${inputs}`);
    }
    if (run.autoApprovals && run.autoApprovals.length > 0) {
        lines.push(`auto-approved: ${run.autoApprovals.length} checkpoint stop${run.autoApprovals.length === 1 ? "" : "s"} (${run.autoApprovals.map((a) => a.nodeId).join(", ")}) — launched with --auto-approve, nobody reviewed these`);
    }
    if (run.pauseAhead) {
        lines.push("");
        lines.push(pauseAheadLine(run.pauseAhead));
    }
    const parkedNodeId = gateParkedNodeId(run.status, run.pauseReason, run.pausedNodeId);
    if (run.nodes.length > 0) {
        lines.push("");
        lines.push(`Nodes (${run.nodes.length}):`);
        for (const node of run.nodes) {
            lines.push(progressLine(node, parkedNodeId !== undefined && node.nodeId === parkedNodeId));
            for (const output of node.outputs)
                lines.push(...outputLines(output));
        }
    }
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
            lines.push(...runOutputLines(output, parkedNodeId !== undefined && output.nodeId === parkedNodeId));
        }
    }
    if (run.sessions && run.sessions.length > 0) {
        lines.push("");
        lines.push(`Sessions (${run.sessions.length}):`);
        for (const s of run.sessions) {
            lines.push(`  session: ${s.sessionId} · "${s.title}" · continue: exodus session chat ${s.sessionId} "..."`);
        }
    }
    return lines.join("\n");
}
const NOT_YET_APPROVED = "awaiting approval, not yet approved";
function runOutputLines(output, awaitingReview = false) {
    const slug = output.botSlug ? ` (${output.botSlug})` : "";
    const review = awaitingReview ? ` — ${NOT_YET_APPROVED}` : "";
    if (output.type === "image") {
        return [`  ${output.label} [image]${slug}: ${output.imageUrl ?? output.imageId ?? "(no url)"}${review}`];
    }
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
    const note = normalized.length > 400 ? "\n    (truncated — use --json for the full text)" : "";
    return [`  ${output.label} [text]${slug}${review}:`, `    ${body}${note}`];
}
function deliveryLines(delivery, parkedNodeId) {
    const heldArtifact = (a) => parkedNodeId !== undefined && a.nodeId === parkedNodeId;
    const held = delivery.status === "delivered" && delivery.artifacts.some(heldArtifact);
    const status = held
        ? `held — ${NOT_YET_APPROVED}`
        : delivery.status === "unfulfilled" && delivery.error
            ? `unfulfilled — ${delivery.error}`
            : delivery.status;
    const lines = [`  ${delivery.label} (${delivery.key}) · ${delivery.type} · ${status}`];
    for (const artifact of delivery.artifacts) {
        for (const line of runOutputLines(artifact, heldArtifact(artifact))) {
            lines.push(`  ${line}`);
        }
    }
    return lines;
}
const ASSET_FALLBACK_EXT = {
    image: "png",
    video: "mp4",
    audio: "mp3",
};
export function workflowFilenameSlug(name) {
    const slug = (name ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return slug || "workflow";
}
function extensionFromUrl(url) {
    const withoutQuery = url.split(/[?#]/)[0];
    const m = withoutQuery.match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toLowerCase() : undefined;
}
function planArtifactFile(artifact) {
    if (artifact.type === "text") {
        return { kind: "text", ext: "md", body: artifact.text ?? "" };
    }
    if (artifact.type === "storyboard") {
        const json = artifact.storyboardJson;
        if (!json)
            return { kind: "none", reason: "no storyboard JSON on this artifact" };
        return { kind: "text", ext: "json", body: json.endsWith("\n") ? json : `${json}\n` };
    }
    if (artifact.type === "frames") {
        return {
            kind: "text",
            ext: "json",
            body: `${JSON.stringify(artifact.frames ?? [], null, 2)}\n`,
        };
    }
    const url = artifact.type === "image"
        ? (artifact.imageUrl ?? undefined)
        : artifact.type === "video"
            ? artifact.videoUrl
            : artifact.type === "document"
                ?
                    artifact.documentUrl
                : artifact.audioUrl;
    if (!url)
        return { kind: "none", reason: "no downloadable URL on this artifact" };
    const filenameExt = artifact.type === "document" && artifact.filename
        ? extensionFromUrl(artifact.filename)
        : undefined;
    return {
        kind: "download",
        ext: filenameExt ??
            extensionFromUrl(url) ??
            ASSET_FALLBACK_EXT[artifact.type] ??
            "bin",
        url,
    };
}
function artifactFileSuffixes(artifacts) {
    const sceneBearing = artifacts.some((a) => typeof a.sceneIndex === "number" || a.final === true);
    if (!sceneBearing) {
        return artifacts.map((_, i) => ({
            suffix: i === 0 ? "" : `-${i + 1}`,
            renamed: false,
        }));
    }
    const taken = new Set();
    let fullCount = 0;
    return artifacts.map((a, i) => {
        let suffix;
        if (typeof a.sceneIndex === "number") {
            suffix = `-${scenePrefix(a.sceneIndex)}`;
        }
        else if (a.final === true) {
            suffix = "-final";
        }
        else if (a.type === "audio") {
            fullCount += 1;
            suffix = fullCount === 1 ? "-full" : `-full-${fullCount}`;
        }
        else {
            suffix = i === 0 ? "" : `-${i + 1}`;
        }
        if (taken.has(suffix)) {
            let fallback = `${suffix}-${i + 1}`;
            while (taken.has(fallback))
                fallback = `${fallback}-${i + 1}`;
            suffix = fallback;
            taken.add(suffix);
            return { suffix, renamed: true };
        }
        taken.add(suffix);
        return { suffix, renamed: false };
    });
}
export async function saveDeliveries(run, dir, deps) {
    const paths = [];
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
    const lines = [`Saved deliveries to ${dir}:`];
    for (const delivery of deliveries) {
        if (delivery.status !== "delivered" || delivery.artifacts.length === 0) {
            const why = delivery.error !== undefined
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
            const file = nodePath.join(dir, `${stem}-${workflowFilenameSlug(delivery.key)}${suffix}.${plan.ext}`);
            try {
                if (plan.kind === "text")
                    deps.writeFile(file, plan.body);
                else
                    await downloadToFile(plan.url, file);
                lines.push(`  wrote    ${file}${renamed ? " — renamed to avoid a collision" : ""}`);
                paths.push(file);
            }
            catch (e) {
                lines.push(`  failed   ${file} — ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }
    lines.push(`${paths.length} file${paths.length === 1 ? "" : "s"} written.`);
    return { lines, paths };
}
function inputValueHint(input) {
    const open = input.allowOther ? ", or your own answer" : "";
    if (input.type === "select") {
        const options = input.options ?? [];
        return options.length > 0 ? `one of: ${options.join(", ")}${open}` : undefined;
    }
    if (input.type === "multi-select") {
        const options = input.options ?? [];
        return options.length > 0
            ? `one or more of: ${options.join(", ")} (comma-separated)${open}`
            : undefined;
    }
    if (input.type === "toggle")
        return "true or false";
    return undefined;
}
export function deliveryTypeWord(type) {
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
export function deliveryContractLines(deliveries) {
    if (deliveries === undefined)
        return [];
    if (deliveries.length === 0)
        return ["Delivers: nothing — no Output node."];
    const lines = [`Delivers (${deliveries.length}):`];
    const ordered = deliveries
        .map((delivery, index) => ({ delivery, index }))
        .sort((a, b) => (a.delivery.order ?? a.index) - (b.delivery.order ?? b.index) || a.index - b.index)
        .map((entry) => entry.delivery);
    for (const delivery of ordered) {
        lines.push(`  ${delivery.label} (${delivery.key}) — ${deliveryTypeWord(delivery.type)}`);
        if (delivery.description)
            lines.push(`      ${delivery.description}`);
    }
    return lines;
}
export function formatDescribe(res) {
    const lines = [];
    lines.push(`Workflow — ${res.name}`);
    lines.push(`workflowId:  ${res.workflowId}`);
    if (res.description)
        lines.push(`description:  ${res.description}`);
    lines.push(`updated:     ${dateOnly(res.updatedAt)}`);
    if (res.warnings && res.warnings.length > 0) {
        lines.push("");
        lines.push(`✗ ${res.warnings.length === 1 ? "Warning" : "Warnings"}:`);
        for (const warning of res.warnings)
            lines.push(`  ✗ ${warning}`);
    }
    lines.push("");
    lines.push(`Inputs (${res.inputs.length}):`);
    if (res.inputs.length === 0) {
        lines.push("  (none — this workflow takes no run inputs)");
    }
    else {
        for (const input of res.inputs) {
            const req = input.required ? "required" : "optional";
            const type = input.type && input.type !== "text" ? ` (${input.type})` : "";
            const bundle = input.bundleSize !== undefined ? `, bundle=${input.bundleSize}` : "";
            const family = input.source === "asset" && input.assetType ? ` (${input.assetType})` : "";
            const label = input.label ? ` (${input.label})` : "";
            lines.push(`  ${input.fieldName}${label} — ${input.source}${family}${type}, ${req}${bundle}`);
            const hint = inputValueHint(input);
            if (hint)
                lines.push(`      ${hint}`);
            if (input.description)
                lines.push(`      ${input.description}`);
        }
    }
    lines.push("");
    lines.push(`Prerequisites (${res.prerequisites.length}):`);
    if (res.prerequisites.length === 0) {
        lines.push("  (none — no stored primers required)");
    }
    else {
        for (const prereq of res.prerequisites) {
            const mark = prereq.stored ? "✓ stored" : "✗ MISSING";
            lines.push(`  ${mark}  ${prereq.primerKind} primer  (nodes: ${prereq.nodeIds.join(", ")})`);
        }
        const missing = res.prerequisites.filter((p) => !p.stored);
        if (missing.length > 0) {
            lines.push("");
            lines.push(`  ✗ ${missing.length} primer(s) not stored for this brand — add ${missing
                .map((p) => `"${p.primerKind}"`)
                .join(", ")} before running, or those nodes fail.`);
        }
    }
    lines.push("");
    lines.push(`Outputs (${res.outputs.length}):`);
    if (res.outputs.length === 0) {
        lines.push("  (none wired into an Output node)");
    }
    else {
        for (const output of res.outputs) {
            const slug = output.botSlug ? ` (${output.botSlug})` : "";
            lines.push(`  ${output.label} [${output.type}]${slug}`);
        }
    }
    const delivers = deliveryContractLines(res.deliveries);
    if (delivers.length > 0) {
        lines.push("");
        lines.push(...delivers);
    }
    return lines.join("\n");
}
function formatBotVocabulary(catalog) {
    const v = catalog.vocabulary;
    const lines = [];
    lines.push("Vocabulary:");
    lines.push(`  node kinds:    ${v.nodeKinds.join(", ")}`);
    lines.push(`  brief sources: ${v.briefSources.join(", ")}`);
    lines.push(`  primer kinds:  ${v.primerKinds.join(", ")}`);
    if (v.primerAwarenessLanes?.length) {
        lines.push(`  body primer awareness lanes (config.primerAwareness, body kind only): ${v.primerAwarenessLanes.join(", ")}`);
    }
    lines.push(`  image models:  ${v.imageModels.join(", ")}`);
    lines.push(`  aspect ratios: ${v.aspectRatios.join(", ")}`);
    lines.push(`  custom bot:    set a bot node's slug to "${catalog.customBot.slug}" and ` +
        `config.${catalog.customBot.configKey}=<genesis-slug> to reach any bot not listed here.`);
    lines.push(`  prompt bot:    set a bot node's slug to "${catalog.promptBot.slug}" and ` +
        `config.${catalog.promptBot.configKey}=<your instructions> — the prompt IS the bot ` +
        "(runs on the workspace's own LLM key, not Genesis).");
    return lines.join("\n");
}
export function formatBotsList(catalog, category) {
    const bots = category
        ? catalog.bots.filter((b) => b.category === category)
        : catalog.bots;
    if (bots.length === 0) {
        const known = catalog.vocabulary.categories.map((c) => c.id).join(", ");
        return category
            ? `No bots in category "${category}". Known categories: ${known}`
            : "No bots in the catalog.";
    }
    const lines = [];
    let currentCategory = null;
    for (const bot of bots) {
        if (bot.category !== currentCategory) {
            if (currentCategory !== null)
                lines.push("");
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
export function formatBotDetail(bot) {
    const lines = [];
    lines.push(`${bot.name}  (slug: ${bot.slug})`);
    lines.push(`category:    ${bot.categoryLabel} (${bot.category})`);
    lines.push(`blurb:       ${bot.blurb}`);
    lines.push(`outputType:  ${bot.outputType}`);
    lines.push("");
    lines.push(`Input ports (${bot.inputs.length}):`);
    if (bot.inputs.length === 0) {
        lines.push("  (none)");
    }
    else {
        for (const input of bot.inputs) {
            const bits = [`accepts ${input.accepts.join("/")}`, input.required ? "required" : "optional"];
            if (input.multi)
                bits.push("multi");
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
    }
    else {
        for (const param of bot.params) {
            const bits = [param.kind];
            if (param.options && param.options.length > 0)
                bits.push(`options: ${param.options.join("|")}`);
            if (param.min !== undefined)
                bits.push(`min ${param.min}`);
            if (param.max !== undefined)
                bits.push(`max ${param.max}`);
            if (param.required)
                bits.push("required");
            if (param.default !== undefined)
                bits.push(`default "${param.default}"`);
            lines.push(`  config.${param.key} — ${param.label} (${bits.join(", ")})`);
            if (param.help)
                lines.push(`      ${param.help}`);
        }
    }
    return lines.join("\n");
}
function firstLine(text) {
    const nl = text.indexOf("\n");
    return (nl === -1 ? text : text.slice(0, nl)).trim();
}
export function formatTemplatesList(templates) {
    if (templates.length === 0)
        return "No workflow templates available on this backend.";
    const lines = [
        table(["key", "label", "description"], templates.map((t) => [
            t.key,
            t.module ? `${t.label} [${t.module} module]` : t.label,
            firstLine(t.description ?? ""),
        ])),
    ];
    if (templates.some((t) => t.module)) {
        lines.push("");
        lines.push("Templates badged [<module> module] are owned by a module (e.g. video) — " +
            "their runs start from the show surfaces, not `workflow run`. Export one to " +
            "study or adapt its graph.");
    }
    lines.push("");
    lines.push("Export one to start authoring: exodus workflow templates export <key> --out my.yaml");
    return lines.join("\n");
}
const SCHEMA_LABEL_KEYS = ["kind", "face", "type", "name", "id", "code", "key", "label"];
function schemaEntryLabel(entry) {
    for (const key of SCHEMA_LABEL_KEYS) {
        const v = entry[key];
        if (typeof v === "string" && v)
            return { key, value: v };
    }
    return undefined;
}
function schemaValueLines(value, indent) {
    if (value === null || value === undefined)
        return [`${indent}(none)`];
    if (Array.isArray(value)) {
        if (value.length === 0)
            return [`${indent}(none)`];
        const lines = [];
        for (const el of value) {
            if (isRecord(el)) {
                const label = schemaEntryLabel(el);
                if (label) {
                    const parked = el["parked"] === true;
                    lines.push(`${indent}- ${label.value}${parked ? " (parked)" : ""}`);
                    const rest = { ...el };
                    delete rest[label.key];
                    if (parked)
                        delete rest["parked"];
                    lines.push(...schemaValueLines(rest, `${indent}    `));
                }
                else {
                    lines.push(`${indent}-`);
                    lines.push(...schemaValueLines(el, `${indent}    `));
                }
            }
            else {
                lines.push(`${indent}- ${String(el)}`);
            }
        }
        return lines;
    }
    if (isRecord(value)) {
        const entries = Object.entries(value);
        if (entries.length === 0)
            return [`${indent}(none)`];
        const lines = [];
        for (const [k, v] of entries) {
            if (isRecord(v) || Array.isArray(v)) {
                lines.push(`${indent}${k}:`);
                lines.push(...schemaValueLines(v, `${indent}    `));
            }
            else {
                lines.push(`${indent}${k}: ${String(v)}`);
            }
        }
        return lines;
    }
    return [`${indent}${String(value)}`];
}
const SCHEMA_SECTIONS = [
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
function schemaSectionValue(payload, keys) {
    for (const key of keys) {
        if (payload[key] !== undefined)
            return { key, value: payload[key] };
    }
    return undefined;
}
export function formatSchema(payload) {
    const lines = [];
    const version = payload["version"];
    lines.push(`Workflow schema${version !== undefined ? ` (version ${version})` : ""}`);
    for (const section of SCHEMA_SECTIONS) {
        const found = schemaSectionValue(payload, section.keys);
        if (!found)
            continue;
        lines.push("");
        lines.push(`${section.title}:`);
        lines.push(...schemaValueLines(found.value, "  "));
    }
    return lines.join("\n");
}
function schemaEntryIds(value) {
    if (!Array.isArray(value))
        return [];
    const ids = [];
    for (const el of value) {
        if (isRecord(el)) {
            const label = schemaEntryLabel(el);
            if (label)
                ids.push(label.value);
        }
        else if (typeof el === "string") {
            ids.push(el);
        }
    }
    return ids;
}
function formatSchemaFilter(payload, sectionKeys, axis, wanted) {
    const found = schemaSectionValue(payload, sectionKeys);
    const list = found && Array.isArray(found.value) ? found.value : [];
    const match = list.find((el) => {
        if (!isRecord(el))
            return typeof el === "string" && el === wanted;
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
        if (label)
            delete rest[label.key];
        lines.push(...schemaValueLines(rest, "  "));
    }
    return { code: 0, lines };
}
function graphIssueLines(issue) {
    const node = issue.nodeId ? ` [node ${issue.nodeId}]` : "";
    const port = issue.portId ? ` [port ${issue.portId}]` : "";
    const edge = !issue.nodeId && issue.edgeId ? ` [edge ${issue.edgeId}]` : "";
    const out = [`${issue.code}${node}${edge}${port}: ${issue.message}`];
    if (issue.remedy)
        out.push(`  fix: ${issue.remedy}`);
    return out;
}
function formatImportError(res) {
    const data = isRecord(res.data) ? res.data : {};
    const err = isRecord(data.error) ? data.error : {};
    const code = typeof err.code === "string" ? err.code : undefined;
    const message = typeof err.message === "string" ? err.message : "Import failed";
    if (code === "INVALID_GRAPH") {
        const issues = Array.isArray(data.issues) ? data.issues : [];
        const lines = [`Import rejected — invalid graph: ${message}`];
        if (issues.length > 0) {
            lines.push("");
            lines.push(`Issues (${issues.length}):`);
            for (const issue of issues)
                lines.push(...graphIssueLines(issue));
        }
        return lines.join("\n");
    }
    if (code === "CONFLICT") {
        const lines = [`Import conflict — ${message}`];
        if (typeof data.currentUpdatedAt === "string") {
            lines.push(`current updatedAt: ${data.currentUpdatedAt}`);
        }
        const remedy = typeof data.remedy === "string"
            ? data.remedy
            : "Re-export the workflow, reapply your edits, and import again with the fresh updatedAt.";
        lines.push(`fix: ${remedy}`);
        return lines.join("\n");
    }
    return formatApiError(res);
}
class WorkflowResolveError extends Error {
    status;
    data;
    constructor(status, data, message) {
        super(message);
        this.status = status;
        this.data = data;
        this.name = "WorkflowResolveError";
    }
}
export async function resolveWorkflowId(ref, deps) {
    const res = await deps.get(LIST_PATH);
    if (!res.ok)
        throw new WorkflowResolveError(res.status, res.data, formatApiError(res));
    const workflows = res.data.workflows ?? [];
    const byName = workflows.find((w) => w.name.toLowerCase() === ref.toLowerCase());
    if (byName)
        return byName._id;
    const byId = workflows.find((w) => w._id === ref);
    if (byId)
        return byId._id;
    const message = `No workflow named "${ref}" on this brand — run: exodus workflow list`;
    throw new WorkflowResolveError(404, { error: { code: "NOT_FOUND", message } }, message);
}
export async function listFlow(json, deps) {
    const res = await deps.get(LIST_PATH);
    if (!res.ok)
        return asErrorResult(res, json);
    const data = res.data;
    return {
        code: 0,
        lines: json ? [JSON.stringify(data)] : [formatWorkflowList(data.workflows ?? [])],
    };
}
export async function describeFlow(workflowRef, opts, deps) {
    let workflowId;
    try {
        workflowId = await resolveWorkflowId(workflowRef, deps);
    }
    catch (e) {
        return resolveIdErrorResult(e, opts.json ?? false);
    }
    const res = await deps.get(`${DESCRIBE_PATH}?id=${encodeURIComponent(workflowId)}`);
    if (!res.ok)
        return asErrorResult(res, opts.json);
    if (opts.json)
        return { code: 0, lines: [JSON.stringify(res.data)] };
    return { code: 0, lines: [formatDescribe(res.data)] };
}
export async function botsFlow(opts, deps) {
    const res = await deps.get(CATALOG_PATH);
    if (!res.ok)
        return asErrorResult(res, opts.json);
    const catalog = res.data;
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
    if (opts.json)
        return { code: 0, lines: [JSON.stringify(catalog)] };
    return { code: 0, lines: [formatBotsList(catalog, opts.category)] };
}
function launchVoicesLine(attached) {
    if (!Array.isArray(attached))
        return undefined;
    const said = [];
    for (const raw of attached) {
        if (!raw || typeof raw !== "object")
            continue;
        const { speaker, voiceId, label } = raw;
        if (typeof speaker !== "string" || typeof voiceId !== "string")
            continue;
        said.push(`${speaker} → ${typeof label === "string" && label !== "" ? label : voiceId}`);
    }
    return said.length > 0 ? `Voices: ${said.join(", ")}` : undefined;
}
export function voiceTreatmentLine(provenance) {
    const voice = provenance?.voice;
    if (!voice || typeof voice !== "object")
        return undefined;
    if (voice.source === "unreadable") {
        return ("Voice treatment: the setting saved when this run started cannot be read, so no " +
            "clip will be made. Start the run again.");
    }
    const path = voice.path;
    if (typeof path !== "string" || path === "")
        return undefined;
    const where = voice.source === "show" ? "from its Show" : "chosen at launch";
    const described = voice.source === "launch" && Array.isArray(voice.descriptions) && voice.descriptions.length > 0
        ? `. Written voices: ${voice.descriptions.map((d) => d.speaker).join(", ")}`
        : "";
    return `Voice treatment: ${path} (${where})${described}`;
}
export async function runFlow(workflowRef, opts, deps) {
    let workflowId;
    try {
        workflowId = await resolveWorkflowId(workflowRef, deps);
    }
    catch (e) {
        return resolveIdErrorResult(e, opts.json ?? false);
    }
    const preface = [];
    let prepared;
    try {
        prepared = await prepareRunInputs(workflowId, opts.inputs, deps, (line) => {
            if (opts.json)
                return;
            if (opts.onProgressLine)
                opts.onProgressLine(line);
            else
                preface.push(line);
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            code: 1,
            lines: opts.json
                ?
                    [JSON.stringify({ ok: false, status: 400, data: { error: { code: "BAD_REQUEST", message } } })]
                : [...preface, message],
        };
    }
    const inputs = prepared.inputs;
    const warned = [];
    for (const warning of prepared.warnings) {
        warned.push(warning);
        opts.onWarningLine?.(warning);
    }
    const body = {
        workflowId,
        ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
        ...(opts.fill && opts.fill.trim() !== "" ? { fill: opts.fill.trim() } : {}),
        ...(opts.autoApprove === true ? { autoApprove: true } : {}),
        ...(opts.imageRigOverrides ? { imageRigOverrides: opts.imageRigOverrides } : {}),
        ...(opts.voices ? { voices: opts.voices } : {}),
        ...(opts.voiceTreatment ? { voiceTreatment: opts.voiceTreatment } : {}),
        launchedVia: "cli",
    };
    const start = await deps.post(RUN_PATH, body);
    if (!start.ok)
        return asErrorResult(start, opts.json);
    const data = start.data;
    for (const warning of serverWarningsToPrint(data?.warnings, warned)) {
        warned.push(warning);
        opts.onWarningLine?.(warning);
    }
    const base = { ...data, workflowId };
    if (opts.json && !opts.wait)
        return { code: 0, lines: [JSON.stringify(base)] };
    const voicesLine = launchVoicesLine(data?.launchVoices);
    const provenance = { format: data?.format ?? null, voice: data?.voice ?? null };
    const rulesLine = formatRulesLine(provenance);
    const treatmentLine = voiceTreatmentLine(provenance);
    const advisories = Array.isArray(data?.advisories)
        ? data.advisories.filter((line) => typeof line === "string")
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
        if (opts.out !== undefined && !opts.json) {
            lines.push(`Nothing saved to ${opts.out} yet — the run is still going. Add --wait, or save later: exodus workflow status --id ${data.runId} --out ${opts.out}`);
        }
        return { code: 0, lines };
    }
    if (!opts.json && opts.onProgressLine) {
        for (const line of lines)
            opts.onProgressLine(line);
        lines.length = 0;
    }
    const waited = await waitForRun(data.runId, { json: opts.json, onProgressLine: opts.onProgressLine, jsonBase: base, out: opts.out }, deps);
    if (opts.json)
        return waited;
    return { code: waited.code, lines: [...lines, ...waited.lines] };
}
const WAIT_TERMINAL_STATUSES = TERMINAL_RUN_STATUSES.flatMap((s) => storedWorkflowStatusForms(s));
function isParkedSnapshot(raw) {
    const status = raw["status"];
    return typeof status === "string" && normalizeRunStatus(status) === "awaiting-approval";
}
function videoParkStop(raw) {
    if (!isParkedSnapshot(raw))
        return undefined;
    const stop = classifyRun(asVideoRun(raw));
    return stop.at === "storyboard-gate" || stop.at === "final-watch" ? stop : undefined;
}
async function waitForRun(runId, opts, deps) {
    const seen = new Map();
    let pausedNotified = false;
    let autoRedoNotified;
    const landOnPark = opts.landOnPark;
    const isLandingPark = (raw) => (landOnPark !== undefined && raw["pauseReason"] === landOnPark.pauseReason) ||
        videoParkStop(raw) !== undefined;
    const pollResult = await deps.poll({
        path: `${STATUS_PATH}?runId=${encodeURIComponent(runId)}`,
        intervalMs: 3_000,
        timeoutMs: 60 * 60 * 1000,
        terminalStatuses: [
            ...WAIT_TERMINAL_STATUSES,
            ...storedWorkflowStatusForms("awaiting-approval"),
        ],
        isDone: (raw) => !isParkedSnapshot(raw) || isLandingPark(raw),
        onProgress: (raw) => {
            if (opts.json || !opts.onProgressLine)
                return;
            const parked = isParkedSnapshot(raw);
            const isLanding = isLandingPark(raw);
            const autoRedo = parked ? classifyRun(asVideoRun(raw)) : undefined;
            if (autoRedo?.at === "running" && autoRedo.autoRedoScenes) {
                const line = `  ${stopLines(autoRedo, runId, "")[0]}`;
                if (line !== autoRedoNotified) {
                    autoRedoNotified = line;
                    opts.onProgressLine(line);
                }
            }
            else if (parked && !pausedNotified && !isLanding) {
                pausedNotified = true;
                const dashboardUrl = deps.dashboardUrl ?? getDashboardUrl();
                const pauseReason = raw["pauseReason"];
                const workerStopped = isWorkerStoppedPark({
                    status: raw["status"],
                    pauseReason,
                    error: raw["error"],
                });
                for (const line of formatPauseNotice(pauseReason, runId, dashboardUrl, { workerStopped })) {
                    opts.onProgressLine(line);
                }
            }
            const parkedNodeId = autoRedo?.at === "running"
                ? undefined
                : gateParkedNodeId(raw["status"], raw["pauseReason"], raw["pausedNodeId"]);
            const nodes = Array.isArray(raw["nodes"]) ? raw["nodes"] : [];
            for (const node of nodes) {
                const isParked = parkedNodeId !== undefined && node.nodeId === parkedNodeId;
                const renderKey = `${node.status}:${isParked}`;
                if (seen.get(node.nodeId) === renderKey)
                    continue;
                seen.set(node.nodeId, renderKey);
                opts.onProgressLine(progressLine(node, isParked));
            }
        },
    });
    const terminalRun = !pollResult.timedOut &&
        isRecord(pollResult.data) &&
        typeof pollResult.data["_id"] === "string"
        ? pollResult.data
        : undefined;
    const saved = opts.out !== undefined && terminalRun
        ? await saveDeliveries(terminalRun, opts.out, deps)
        : undefined;
    const parkStop = !pollResult.timedOut && isRecord(pollResult.data)
        ? videoParkStop(pollResult.data)
        : undefined;
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
    }
    else {
        lines.push(`Polling failed: ${JSON.stringify(pollResult.data)}`);
    }
    if (saved)
        lines.push("", ...saved.lines);
    if (landOnPark &&
        isRecord(pollResult.data) &&
        typeof pollResult.data["status"] === "string" &&
        normalizeRunStatus(pollResult.data["status"]) === "awaiting-approval" &&
        pollResult.data["pauseReason"] === landOnPark.pauseReason) {
        const dashboardUrl = deps.dashboardUrl ?? getDashboardUrl();
        lines.push("", landOnPark.headline, ...formatPauseNotice(landOnPark.pauseReason, runId, dashboardUrl).slice(1));
    }
    if (videoStop) {
        const review = reviewUrl(deps.dashboardUrl ?? getDashboardUrl(), asVideoRun(pollResult.data));
        lines.push("", ...stopLines(videoStop, runId, review));
    }
    return { code: pollResult.ok ? 0 : 1, lines };
}
export async function statusFlow(opts, deps) {
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
    if (!res.ok)
        return asErrorResult(res, opts.json);
    const saved = opts.out !== undefined && opts.id
        ? await saveDeliveries(res.data, opts.out, deps)
        : undefined;
    if (opts.json) {
        const payload = saved ? { ...res.data, saved: saved.paths } : res.data;
        return { code: 0, lines: [JSON.stringify(payload)] };
    }
    if (opts.id) {
        const lines = [formatWorkflowRun(res.data)];
        if (saved)
            lines.push("", ...saved.lines);
        return { code: 0, lines };
    }
    const runs = (res.data.runs ?? []);
    return { code: 0, lines: [formatRecentRuns(runs)] };
}
export async function exportFlow(workflowRef, opts, deps) {
    let workflowId;
    try {
        workflowId = await resolveWorkflowId(workflowRef, deps);
    }
    catch (e) {
        return resolveIdErrorResult(e, opts.json ?? false);
    }
    const versionParam = opts.version !== undefined ? `&version=${encodeURIComponent(String(opts.version))}` : "";
    const res = await deps.get(`${EXPORT_PATH}?id=${encodeURIComponent(workflowId)}${versionParam}`);
    if (!res.ok)
        return asErrorResult(res, false);
    const doc = opts.json
        ? JSON.stringify(res.data, null, 2)
        : workflowToYaml(res.data);
    if (opts.out) {
        const text = doc.endsWith("\n") ? doc : `${doc}\n`;
        deps.writeFile(opts.out, text);
        return { code: 0, lines: [`Wrote workflow contract to ${opts.out}.`] };
    }
    return { code: 0, lines: [doc.endsWith("\n") ? doc.slice(0, -1) : doc] };
}
export function parseVersionFlag(flags) {
    const raw = flags["version"];
    if (raw === undefined)
        return undefined;
    if (typeof raw !== "string")
        throw new Error("--version requires a positive integer");
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--version must be a positive integer (got "${raw}")`);
    }
    return n;
}
export async function versionsFlow(workflowRef, opts, deps, channel = getChannel()) {
    let workflowId;
    try {
        workflowId = await resolveWorkflowId(workflowRef, deps);
    }
    catch (e) {
        return resolveIdErrorResult(e, opts.json ?? false);
    }
    const res = await deps.get(`${VERSIONS_PATH}?id=${encodeURIComponent(workflowId)}`);
    const unsupported = missingRouteLine(res, "workflow versions", channel);
    if (unsupported)
        return { code: 1, lines: [unsupported] };
    if (!res.ok)
        return asErrorResult(res, opts.json);
    if (opts.json)
        return { code: 0, lines: [JSON.stringify(res.data)] };
    const body = res.data;
    const versions = Array.isArray(body)
        ? body
        : (body.versions ?? []);
    return { code: 0, lines: [formatWorkflowVersions(versions)] };
}
function buildImportBody(file, opts, deps) {
    let text;
    try {
        text = deps.readFile(file);
    }
    catch {
        return { error: { code: 1, lines: [`Error: file not found: ${file}`] } };
    }
    let parsed;
    try {
        parsed = parseWorkflowText(text);
    }
    catch (e) {
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
    const body = { ...parsed };
    delete body.dryRun;
    delete body.targetWorkflowId;
    delete body.expectedUpdatedAt;
    if (opts.dryRun)
        body.dryRun = true;
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
async function runImport(file, opts, deps) {
    const built = buildImportBody(file, { dryRun: opts.dryRun, update: opts.update }, deps);
    if ("error" in built)
        return built.error;
    const res = await deps.post(IMPORT_PATH, built.body);
    if (!res.ok) {
        return {
            code: 1,
            lines: opts.json
                ? [JSON.stringify({ ok: false, status: res.status, data: res.data })]
                : [formatImportError(res)],
        };
    }
    const data = res.data;
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
export function triggerExpect(t) {
    return t.type === "event"
        ? { type: "event", event: t.event }
        : { type: "cron", cron: t.cron };
}
function triggerDetail(t) {
    return t.type === "event" ? t.event : t.cron;
}
const NO_TRIGGERS = "no triggers — add them via `exodus workflow export` / `import`";
export function formatTriggers(triggers) {
    if (triggers.length === 0)
        return NO_TRIGGERS;
    return triggers
        .map((t, i) => {
        const state = t.enabled ? "enabled" : "disabled";
        return `${i + 1} · ${t.type} · ${triggerDetail(t)} · ${state}`;
    })
        .join("\n");
}
function triggerErrorResult(res, verb, json) {
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
async function fetchTriggers(workflowId, deps) {
    const res = await deps.get(`${EXPORT_PATH}?id=${encodeURIComponent(workflowId)}`);
    if (!res.ok)
        return { ok: false, res };
    const triggers = res.data.triggers ?? [];
    return { ok: true, triggers };
}
export async function triggersListFlow(workflowRef, opts, deps) {
    let workflowId;
    try {
        workflowId = await resolveWorkflowId(workflowRef, deps);
    }
    catch (e) {
        return resolveIdErrorResult(e, opts.json ?? false);
    }
    const fetched = await fetchTriggers(workflowId, deps);
    if (!fetched.ok)
        return triggerErrorResult(fetched.res, "workflow triggers", opts.json);
    if (opts.json) {
        return {
            code: 0,
            lines: [JSON.stringify(fetched.triggers.map((t, i) => ({ n: i + 1, ...t })))],
        };
    }
    return { code: 0, lines: [formatTriggers(fetched.triggers)] };
}
function triggerIndexError(message, triggers, json) {
    if (json) {
        return {
            code: 1,
            lines: [JSON.stringify({ ok: false, error: message, triggers: triggers.map((t, i) => ({ n: i + 1, ...t })) })],
        };
    }
    return { code: 1, lines: [message, "", formatTriggers(triggers)] };
}
export async function triggersSetEnabledFlow(workflowRef, n, enabled, opts, deps) {
    const verb = `workflow triggers ${enabled ? "enable" : "disable"}`;
    let workflowId;
    try {
        workflowId = await resolveWorkflowId(workflowRef, deps);
    }
    catch (e) {
        return resolveIdErrorResult(e, opts.json ?? false);
    }
    const fetched = await fetchTriggers(workflowId, deps);
    if (!fetched.ok)
        return triggerErrorResult(fetched.res, verb, opts.json);
    const triggers = fetched.triggers;
    const idx = n - 1;
    if (idx < 0 || idx >= triggers.length) {
        return triggerIndexError(`Trigger ${n} is out of range — this workflow has ${triggers.length} trigger(s).`, triggers, opts.json);
    }
    const res = await deps.post(TRIGGERS_SET_ENABLED_PATH, {
        workflowId,
        triggerIndex: idx,
        enabled,
        expect: triggerExpect(triggers[idx]),
    });
    if (!res.ok)
        return triggerErrorResult(res, verb, opts.json);
    if (opts.json)
        return { code: 0, lines: [JSON.stringify(res.data)] };
    const lines = [`Trigger ${n} ${enabled ? "enabled" : "disabled"}.`];
    const warnings = res.data?.warnings;
    if (Array.isArray(warnings)) {
        for (const w of warnings) {
            if (typeof w === "string")
                lines.push(`  ⚠ ${w}`);
        }
    }
    return { code: 0, lines };
}
export async function triggersFireFlow(workflowRef, opts, deps) {
    const verb = "workflow triggers fire";
    let workflowId;
    try {
        workflowId = await resolveWorkflowId(workflowRef, deps);
    }
    catch (e) {
        return resolveIdErrorResult(e, opts.json ?? false);
    }
    const fetched = await fetchTriggers(workflowId, deps);
    if (!fetched.ok)
        return triggerErrorResult(fetched.res, verb, opts.json);
    const triggers = fetched.triggers;
    if (triggers.length === 0) {
        return { code: 1, lines: [`This workflow has no triggers. ${NO_TRIGGERS}`] };
    }
    let idx;
    if (opts.n !== undefined) {
        idx = opts.n - 1;
        if (idx < 0 || idx >= triggers.length) {
            return triggerIndexError(`Trigger ${opts.n} is out of range — this workflow has ${triggers.length} trigger(s).`, triggers, opts.json);
        }
    }
    else if (triggers.length === 1) {
        idx = 0;
    }
    else {
        return triggerIndexError(`This workflow has ${triggers.length} triggers — specify which one to fire (e.g. \`fire 1\`).`, triggers, opts.json);
    }
    const t = triggers[idx];
    const n = idx + 1;
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
        ...(opts.imageRigOverrides
            ? { imageRigOverrides: opts.imageRigOverrides }
            : {}),
        ...(opts.voices ? { voices: opts.voices } : {}),
    });
    if (!res.ok)
        return triggerErrorResult(res, verb, opts.json);
    const runId = res.data.runId;
    const base = { runId, workflowId };
    if (!opts.wait) {
        if (opts.json)
            return { code: 0, lines: [JSON.stringify(base)] };
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
        for (const line of startLines)
            opts.onProgressLine(line);
    }
    const waited = await waitForRun(runId, { json: opts.json, onProgressLine: opts.onProgressLine, jsonBase: base }, deps);
    if (opts.json)
        return waited;
    const prefix = opts.onProgressLine ? [] : startLines;
    return { code: waited.code, lines: [...prefix, ...waited.lines] };
}
export async function importFlow(file, opts, deps) {
    return runImport(file, opts, deps);
}
export async function validateFlow(file, opts, deps) {
    return runImport(file, { dryRun: true, json: opts.json, update: opts.update, validate: true }, deps);
}
export async function templatesListFlow(json, deps) {
    const res = await deps.get(TEMPLATES_PATH);
    if (!res.ok) {
        const missing = missingRouteLine(res, "workflow templates");
        if (missing)
            return { code: 1, lines: [missing] };
        return asErrorResult(res, json);
    }
    const data = res.data;
    if (json)
        return { code: 0, lines: [JSON.stringify(data)] };
    return { code: 0, lines: [formatTemplatesList(data.templates ?? [])] };
}
export async function templatesExportFlow(key, opts, deps) {
    const query = opts.json
        ? `?key=${encodeURIComponent(key)}&format=json`
        : `?key=${encodeURIComponent(key)}`;
    const res = await deps.getText(`${TEMPLATES_PATH}${query}`);
    if (!res.ok) {
        let parsedBody = res.data;
        try {
            parsedBody = JSON.parse(res.data);
        }
        catch {
        }
        const missing = missingRouteLine({ ...res, data: parsedBody }, "workflow templates export");
        if (missing)
            return { code: 1, lines: [missing] };
        return { code: 1, lines: [formatTextError(res)] };
    }
    const doc = res.data;
    if (opts.out) {
        const text = doc.endsWith("\n") ? doc : `${doc}\n`;
        deps.writeFile(opts.out, text);
        return { code: 0, lines: [`Wrote template "${key}" to ${opts.out}.`] };
    }
    return { code: 0, lines: [doc.endsWith("\n") ? doc.slice(0, -1) : doc] };
}
function formatTextError(res) {
    const body = res.data;
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        const snippet = body.replace(/\s+/g, " ").trim().slice(0, 300);
        return formatApiError({ ok: false, status: res.status, data: snippet || "(empty response)" });
    }
    return formatApiError({ ok: false, status: res.status, data: parsed });
}
export async function schemaFlow(opts, deps) {
    const res = await deps.get(SCHEMA_PATH);
    if (!res.ok) {
        const missing = missingRouteLine(res, "workflow schema");
        if (missing)
            return { code: 1, lines: [missing] };
        return asErrorResult(res, opts.json);
    }
    if (opts.json)
        return { code: 0, lines: [JSON.stringify(res.data)] };
    const payload = isRecord(res.data) ? res.data : {};
    if (opts.kind !== undefined) {
        return formatSchemaFilter(payload, ["nodeKinds"], "kind", opts.kind);
    }
    if (opts.face !== undefined) {
        return formatSchemaFilter(payload, ["transformFaces"], "face", opts.face);
    }
    return { code: 0, lines: [formatSchema(payload)] };
}
export function formatAge(value, now = Date.now()) {
    if (value === undefined || value === null)
        return "-";
    const t = typeof value === "number" ? value : Date.parse(value);
    if (Number.isNaN(t))
        return "-";
    const sec = Math.max(0, Math.floor((now - t) / 1000));
    if (sec < 60)
        return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60)
        return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24)
        return `${hr}h`;
    return `${Math.floor(hr / 24)}d`;
}
export function parkBadge(pauseReason) {
    if (pauseReason === "taste")
        return "gate";
    if (pauseReason === "repair")
        return "repair";
    if (pauseReason === "slots")
        return "slots";
    if (pauseReason === "checkpoint")
        return "checkpoint";
    return "legacy";
}
export function invocationBadge(row) {
    if (row.triggeredBy)
        return `trig:${row.triggeredBy.event ?? row.triggeredBy.type}`;
    if (row.invocationMode === "background")
        return "bg";
    return "";
}
const NO_INBOX = "Nothing waiting on you — the review inbox is empty.";
export function formatInbox(rows, now = Date.now()) {
    if (rows.length === 0)
        return NO_INBOX;
    return table(["run", "workflow", "kind", "node", "via", "age"], rows.map((r) => [
        r._id,
        r.workflowName || "(unnamed)",
        parkBadge(r.pauseReason),
        r.pausedNodeId ?? "-",
        invocationBadge(r) || "-",
        formatAge(r.createdAt, now),
    ]));
}
export async function inboxFlow(json, deps) {
    const res = await deps.get(INBOX_PATH);
    if (!res.ok)
        return triggerErrorResult(res, "workflow inbox", json);
    const data = res.data;
    const rows = data.runs ?? [];
    return { code: 0, lines: json ? [JSON.stringify(rows)] : [formatInbox(rows)] };
}
function errLine(message, json, status) {
    return {
        code: 1,
        lines: [
            json
                ? JSON.stringify({ ok: false, ...(status ? { status } : {}), error: message })
                : message,
        ],
    };
}
function okLine(message, payload, json) {
    return { code: 0, lines: [json ? JSON.stringify(payload) : message] };
}
function asWorkflowRun(data) {
    return isRecord(data) && typeof data["_id"] === "string"
        ? data
        : undefined;
}
function describePark(run) {
    if (normalizeRunStatus(run.status) !== "awaiting-approval") {
        return `status: ${runVerdict(run)}`;
    }
    switch (run.pauseReason) {
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
const PARK_LABEL = {
    taste: "a retired Gate review",
    repair: "a repair",
    slots: "slot answers",
    call: "a child workflow",
    checkpoint: "a checkpoint approval",
};
async function preflightPark(runId, expected, verb, json, deps) {
    const res = await deps.get(`${STATUS_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!res.ok)
        return { ok: false, result: triggerErrorResult(res, verb, json) };
    const run = asWorkflowRun(res.data);
    if (!run) {
        return { ok: false, result: errLine(`Could not read run ${runId}.`, json) };
    }
    const allowed = Array.isArray(expected)
        ? expected
        : [expected];
    if (normalizeRunStatus(run.status) !== "awaiting-approval" ||
        run.pauseReason === undefined ||
        !allowed.includes(run.pauseReason)) {
        return {
            ok: false,
            result: errLine(`Run ${runId} is not parked for ${PARK_LABEL[allowed[0]]} — it is ${describePark(run)}.`, json),
        };
    }
    return { ok: true, run };
}
function checkpointOutputs(run) {
    const node = (run.nodes ?? []).find((x) => x.nodeId === run.pausedNodeId);
    if (!node)
        return [];
    const out = [];
    let n = 0;
    (node.outputs ?? []).forEach((a, idx) => {
        if (a.type !== "text")
            return;
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
function checkpointItemIndexes(outputs) {
    const seen = new Set();
    for (const o of outputs)
        if (o.item)
            seen.add(o.item.index);
    return [...seen].sort((a, b) => a - b);
}
function checkpointNode(run) {
    return (run.nodes ?? []).find((x) => x.nodeId === run.pausedNodeId);
}
function checkpointOutputRow(o, indent) {
    const label = o.label ? ` [${o.label}]` : "";
    const edited = o.humanEdited ? "  (edited)" : "";
    return `${indent}${o.n}.${label} ${truncateText(o.text, 200)}${edited}`;
}
function formatCheckpointOutputs(outputs) {
    if (outputs.length === 0)
        return "  (this step produced no text to review)";
    const indexes = checkpointItemIndexes(outputs);
    if (indexes.length === 0) {
        return outputs.map((o) => checkpointOutputRow(o, "  ")).join("\n");
    }
    const lines = [];
    for (const index of indexes) {
        const rows = outputs.filter((o) => o.item?.index === index);
        const total = rows[0]?.item?.total ?? indexes.length;
        lines.push(`  Item ${index + 1} of ${total}`);
        for (const row of rows)
            lines.push(checkpointOutputRow(row, "    "));
    }
    const shared = outputs.filter((o) => !o.item);
    if (shared.length > 0) {
        lines.push("  Not tied to an item");
        for (const row of shared)
            lines.push(checkpointOutputRow(row, "    "));
    }
    return lines.join("\n");
}
function checkpointRangeError(num, count, json) {
    const range = count > 0 ? ` (valid: 1–${count})` : "";
    return errLine(`Output ${num} is out of range — this step has ${count} text output${count === 1 ? "" : "s"}${range}.`, json);
}
export async function checkpointShowFlow(runId, opts, deps) {
    const pf = await preflightPark(runId, "checkpoint", "workflow checkpoint", opts.json, deps);
    if (!pf.ok)
        return pf.result;
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
    const itemsNote = itemIndexes.length > 0
        ? [
            `This step ran once per item (${itemIndexes.length} of them). Approve keeps every item;`,
            "reject drops the ones you name and the run carries on with the rest.",
            "",
        ]
        : [];
    const rejectLine = itemIndexes.length > 0
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
export function parseRejectItems(raw) {
    const bad = (why) => ({
        ok: false,
        message: `${why} --reject takes the item numbers you see in "checkpoint show", like --reject 2 or --reject 2,5.`,
    });
    if (raw === undefined || raw.trim() === "")
        return bad("--reject needs at least one item number.");
    const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (parts.length === 0)
        return bad("--reject needs at least one item number.");
    const items = [];
    for (const part of parts) {
        if (!/^\d+$/.test(part))
            return bad(`"${part}" isn't an item number.`);
        const n = Number(part);
        if (n < 1)
            return bad("Items are numbered from 1.");
        if (!items.includes(n))
            items.push(n);
    }
    return { ok: true, items: items.sort((a, b) => a - b) };
}
export async function checkpointApproveFlow(runId, opts, deps) {
    let rejectItems;
    if (opts.reject !== undefined) {
        const parsed = parseRejectItems(opts.reject);
        if (!parsed.ok)
            return errLine(parsed.message, opts.json);
        rejectItems = parsed.items;
    }
    const pf = await preflightPark(runId, "checkpoint", "workflow checkpoint approve", opts.json, deps);
    if (!pf.ok)
        return pf.result;
    if (rejectItems === undefined) {
        const res = await deps.post(APPROVE_PATH, { runId });
        if (!res.ok)
            return triggerErrorResult(res, "workflow checkpoint approve", opts.json);
        const triggerRunId = res.data.triggerRunId;
        return resumeAndMaybeWait(runId, triggerRunId, ["Checkpoint approved — the run resumes."], opts, deps);
    }
    const rejections = rejectItems.map((n) => n - 1);
    const res = await deps.post(CHECKPOINT_RESOLVE_ITEMS_PATH, { runId, rejections });
    if (!res.ok)
        return triggerErrorResult(res, "workflow checkpoint approve", opts.json);
    const data = (res.data ?? {});
    const rejected = (data.rejected ?? rejections).map((i) => i + 1).sort((a, b) => a - b);
    const kept = data.remaining ?? 0;
    const total = kept + rejected.length;
    return resumeAndMaybeWait(runId, data.triggerRunId, [`Approved — kept ${kept} of ${total} items (rejected: ${rejected.join(", ")}).`], opts, deps, undefined, { rejected, remaining: kept });
}
export async function checkpointEditFlow(runId, n, sources, opts, deps) {
    const provided = [sources.text, sources.file, sources.stdin].filter((x) => x !== undefined);
    if (provided.length === 0) {
        return errLine("Provide the replacement text via one of --text, --file <path>, or piped stdin.", opts.json);
    }
    if (provided.length > 1) {
        return errLine("Provide the replacement text via exactly one of --text, --file, or stdin — not several.", opts.json);
    }
    let text;
    if (sources.text !== undefined) {
        text = sources.text;
    }
    else if (sources.file !== undefined) {
        try {
            text = deps.readFile(sources.file);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return errLine(`Could not read file "${sources.file}": ${msg}`, opts.json);
        }
    }
    else {
        text = sources.stdin;
    }
    const pf = await preflightPark(runId, "checkpoint", "workflow checkpoint edit", opts.json, deps);
    if (!pf.ok)
        return pf.result;
    const outputs = checkpointOutputs(pf.run);
    const target = outputs.find((o) => o.n === n);
    if (!target)
        return checkpointRangeError(n, outputs.length, opts.json);
    const res = await deps.post(CHECKPOINT_EDIT_PATH, {
        runId,
        nodeId: pf.run.pausedNodeId,
        outputIndex: target.outputIndex,
        text,
    });
    if (!res.ok)
        return triggerErrorResult(res, "workflow checkpoint edit", opts.json);
    return okLine(`Edited output ${n} at ${pf.run.pausedNodeId}. Approve to continue: exodus workflow checkpoint ${runId} approve --wait`, { ok: true, runId, nodeId: pf.run.pausedNodeId, outputIndex: target.outputIndex }, opts.json);
}
export async function checkpointRetryFlow(runId, opts, deps) {
    const pf = await preflightPark(runId, "checkpoint", "workflow checkpoint retry", opts.json, deps);
    if (!pf.ok)
        return pf.result;
    const note = opts.note?.trim();
    const res = await deps.post(CHECKPOINT_RETRY_PATH, {
        runId,
        ...(note ? { note } : {}),
    });
    if (!res.ok)
        return triggerErrorResult(res, "workflow checkpoint retry", opts.json);
    const triggerRunId = res.data.triggerRunId;
    return resumeAndMaybeWait(runId, triggerRunId, ["Redoing the step that feeds this checkpoint — its old output is discarded."], opts, deps, {
        pauseReason: "checkpoint",
        headline: "  ⏸ The step re-ran — its fresh output is waiting on your approval.",
    });
}
export async function cancelRunFlow(runId, opts, deps) {
    const res = await deps.post(CANCEL_PATH, {
        runId,
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
    });
    if (!res.ok)
        return triggerErrorResult(res, opts.verb ?? "workflow cancel", opts.json);
    return okLine(`Canceled — run ${runId} is marked cancelled and won't go any further. Any sub-workflow it started is cancelled too, and a stop was sent to the step still running.`, { ok: true, runId }, opts.json);
}
export async function checkpointCancelFlow(runId, opts, deps) {
    return cancelRunFlow(runId, { ...opts, verb: "workflow checkpoint cancel" }, deps);
}
export async function repairFlow(runId, action, opts, deps) {
    const verb = `workflow repair ${action}`;
    const pf = await preflightPark(runId, "repair", verb, opts.json, deps);
    if (!pf.ok)
        return pf.result;
    if (action === "skip" && isWorkerStoppedPark(pf.run)) {
        return errLine(`Run ${runId} has nothing to skip — its worker stopped partway. ` +
            `Carry on from where it stopped (finished steps are kept): exodus workflow repair ${runId} retry`, opts.json);
    }
    if (action === "kill") {
        const res = await deps.post(CANCEL_PATH, { runId });
        if (!res.ok)
            return triggerErrorResult(res, verb, opts.json);
        return okLine(`Repair killed — run ${runId} canceled.`, { ok: true, runId }, opts.json);
    }
    const path = action === "retry" ? REPAIR_RETRY_PATH : REPAIR_SKIP_PATH;
    const res = await deps.post(path, { runId });
    if (!res.ok)
        return triggerErrorResult(res, verb, opts.json);
    const triggerRunId = res.data.triggerRunId;
    return resumeAndMaybeWait(runId, triggerRunId, [`Repair ${action} started — the run resumes.`], opts, deps);
}
async function resumeAndMaybeWait(runId, triggerRunId, headline, opts, deps, landOnPark, extraJson) {
    const base = { runId, triggerRunId, ...(extraJson ?? {}) };
    const startLines = [
        ...headline,
        `runId:        ${runId}`,
        `triggerRunId: ${triggerRunId ?? "-"}`,
        `Poll: exodus workflow status --id ${runId}`,
    ];
    if (!opts.wait) {
        if (opts.json)
            return { code: 0, lines: [JSON.stringify(base)] };
        return { code: 0, lines: startLines };
    }
    if (!opts.json && opts.onProgressLine) {
        for (const line of startLines)
            opts.onProgressLine(line);
    }
    const waited = await waitForRun(runId, {
        json: opts.json,
        onProgressLine: opts.onProgressLine,
        jsonBase: base,
        ...(landOnPark ? { landOnPark } : {}),
    }, deps);
    if (opts.json)
        return waited;
    const prefix = opts.onProgressLine ? [] : startLines;
    return { code: waited.code, lines: [...prefix, ...waited.lines] };
}
export function parseSlotFlags(occurrences) {
    const values = {};
    for (const { flag, value } of occurrences) {
        if (flag !== "slot")
            continue;
        if (!value)
            throw new Error("--slot requires key=value");
        const eq = value.indexOf("=");
        if (eq <= 0)
            throw new Error(`--slot must be key=value (got "${value}")`);
        const key = value.slice(0, eq).trim();
        if (!key)
            throw new Error(`--slot must include a key (got "${value}")`);
        values[key] = value.slice(eq + 1);
    }
    return values;
}
export async function answerFlow(runId, values, opts, deps) {
    const pf = await preflightPark(runId, "slots", "workflow answer", opts.json, deps);
    if (!pf.ok)
        return pf.result;
    const pending = pf.run.pendingSlots ?? [];
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
    if (!res.ok)
        return triggerErrorResult(res, "workflow answer", opts.json);
    return okLine(`Answered ${Object.keys(values).length} slot(s) for run ${runId} — the child resumes.`, { ok: true, runId, values }, opts.json);
}
function flagString(flags, name) {
    const v = flags[name];
    return typeof v === "string" ? v : undefined;
}
function parsePositional(args = process.argv.slice(3)) {
    const out = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2).split("=", 1)[0] ?? "";
            if (!arg.includes("=") && VALUE_FLAGS.has(key))
                i += 2;
            else
                i++;
            continue;
        }
        out.push(arg);
        i++;
    }
    return out;
}
async function printResult(result) {
    for (const line of result.lines)
        console.log(line);
    if (result.code !== 0)
        process.exit(result.code);
}
async function readAllStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf-8");
}
async function maybeReadStdin(flags) {
    if (flagString(flags, "text") !== undefined || flagString(flags, "file") !== undefined) {
        return undefined;
    }
    if (process.stdin.isTTY)
        return undefined;
    const raw = await readAllStdin();
    if (raw.length === 0)
        return undefined;
    return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
}
export async function run(flags, occurrences) {
    const positional = parsePositional();
    const [sub, ...rest] = positional;
    const json = !!flags["json"];
    if (!sub) {
        console.log(helpText);
        return;
    }
    if (sub === "list")
        return printResult(await listFlow(json, defaultDeps));
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
        return printResult(await botsFlow({ category: flagString(flags, "category"), slug: flagString(flags, "slug"), json }, defaultDeps));
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
            return printResult(await templatesExportFlow(key, { out: flagString(flags, "out"), json }, defaultDeps));
        }
        console.error(`Unknown templates action: "${action}"`);
        console.log("Usage: exodus workflow templates [list] | exodus workflow templates export <key>");
        process.exit(1);
    }
    if (sub === "schema") {
        return printResult(await schemaFlow({ json, kind: flagString(flags, "kind"), face: flagString(flags, "face") }, defaultDeps));
    }
    if (sub === "validate") {
        const file = rest[0];
        if (!file) {
            console.error("Error: workflow validate requires <file>.");
            console.log("Usage: exodus workflow validate <file> [--update <workflowId>] [--json]");
            process.exit(1);
        }
        return printResult(await validateFlow(file, { json, update: flagString(flags, "update") }, defaultDeps));
    }
    if (sub === "run") {
        const workflowRef = rest[0];
        if (!workflowRef) {
            console.error("Error: workflow run requires <workflowId|name>.");
            console.log("Usage: exodus workflow run <workflowId|name> [--fill <name>] [--input key=value ...] [--input <fileField>=./path/to/file ...] [--rig-overrides <json|@file>] [--voices <json|@voices.json>] [--voice-treatment <name|json|@file>] [--auto-approve] [--wait] [--json]");
            process.exit(1);
        }
        let inputs;
        let fill;
        let autoApprove;
        let imageRigOverrides;
        let voices;
        let voiceTreatment;
        try {
            inputs = parseRawInputFlags(occurrences);
            rejectTerminalFlag(occurrences);
            fill = parseFillFlag(occurrences);
            autoApprove = parseAutoApproveFlag(process.argv.slice(3));
            imageRigOverrides = parseRigOverridesFlag(occurrences, defaultDeps.readFile);
            voices = parseVoicesFlag(occurrences, defaultDeps.readFile);
            voiceTreatment = parseVoiceTreatmentFlag(occurrences, defaultDeps.readFile);
        }
        catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
            process.exit(1);
        }
        return printResult(await runFlow(workflowRef, {
            inputs,
            fill,
            autoApprove,
            imageRigOverrides,
            voices,
            voiceTreatment,
            wait: flags["wait"] === true,
            json,
            out: flagString(flags, "out"),
            onProgressLine: (line) => console.log(line),
            onWarningLine: (line) => console.error(line),
        }, defaultDeps));
    }
    if (sub === "status") {
        return printResult(await statusFlow({ id: flagString(flags, "id"), json, out: flagString(flags, "out") }, defaultDeps));
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
        let version;
        try {
            version = parseVersionFlag(flags);
        }
        catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
            process.exit(1);
        }
        return printResult(await exportFlow(workflowRef, { out: flagString(flags, "out"), json, version }, defaultDeps));
    }
    if (sub === "import") {
        const file = rest[0];
        if (!file) {
            console.error("Error: workflow import requires <file>.");
            console.log("Usage: exodus workflow import <file> [--update <workflowId>] [--dry-run] [--json]");
            process.exit(1);
        }
        return printResult(await importFlow(file, { dryRun: flags["dry-run"] === true, json, update: flagString(flags, "update") }, defaultDeps));
    }
    if (sub === "inbox") {
        return printResult(await inboxFlow(json, defaultDeps));
    }
    if (sub === "gate") {
        console.error(RETIRED_GATE_VERB_POINTER);
        process.exit(1);
    }
    if (sub === "checkpoint") {
        const runId = rest[0];
        if (!runId) {
            console.error("Error: workflow checkpoint requires <runId>.");
            console.log('Usage: exodus workflow checkpoint <runId> [show | edit <n> | approve [--reject <n,..>] | retry | cancel]');
            process.exit(1);
        }
        const action = rest[1];
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
            return printResult(await checkpointEditFlow(runId, n, { text: flagString(flags, "text"), file: flagString(flags, "file"), stdin }, { json }, defaultDeps));
        }
        if (action === "approve") {
            return printResult(await checkpointApproveFlow(runId, {
                wait: flags["wait"] === true,
                json,
                onProgressLine: (line) => console.log(line),
                ...(flags["reject"] !== undefined
                    ? { reject: flagString(flags, "reject") ?? "" }
                    : {}),
            }, defaultDeps));
        }
        if (action === "retry") {
            return printResult(await checkpointRetryFlow(runId, {
                wait: flags["wait"] === true,
                json,
                ...(flags["note"] !== undefined
                    ? { note: flagString(flags, "note") }
                    : {}),
                onProgressLine: (line) => console.log(line),
            }, defaultDeps));
        }
        if (action === "cancel") {
            return printResult(await checkpointCancelFlow(runId, { reason: flagString(flags, "reason"), json }, defaultDeps));
        }
        console.error(`Error: unknown checkpoint action "${action}" (expected show, edit, approve, retry, or cancel).`);
        process.exit(1);
    }
    if (sub === "cancel") {
        const runId = rest[0];
        if (!runId) {
            console.error("Error: workflow cancel requires <runId>.");
            console.log('Usage: exodus workflow cancel <runId> [--reason "..."] [--json]');
            process.exit(1);
        }
        return printResult(await cancelRunFlow(runId, { reason: flagString(flags, "reason"), json }, defaultDeps));
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
        return printResult(await repairFlow(runId, action, { wait: flags["wait"] === true, json, onProgressLine: (line) => console.log(line) }, defaultDeps));
    }
    if (sub === "answer") {
        const runId = rest[0];
        if (!runId) {
            console.error("Error: workflow answer requires <runId>.");
            console.log("Usage: exodus workflow answer <runId> --slot key=value [--slot key=value ...]");
            process.exit(1);
        }
        let values;
        try {
            values = parseSlotFlags(occurrences);
        }
        catch (e) {
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
        if (!action)
            return printResult(await triggersListFlow(workflowRef, { json }, defaultDeps));
        if (action === "enable" || action === "disable") {
            const n = parseTriggerIndex(rest[2]);
            if (n === undefined) {
                console.error(`Error: workflow triggers ${action} requires a 1-based trigger number <n>.`);
                console.log(`Usage: exodus workflow triggers <workflowId|name> ${action} <n>`);
                process.exit(1);
            }
            return printResult(await triggersSetEnabledFlow(workflowRef, n, action === "enable", { json }, defaultDeps));
        }
        if (action === "fire") {
            let n;
            if (rest[2] !== undefined) {
                n = parseTriggerIndex(rest[2]);
                if (n === undefined) {
                    console.error(`Error: trigger number must be a positive integer (got "${rest[2]}").`);
                    process.exit(1);
                }
            }
            let fireOverrides;
            let fireVoices;
            try {
                fireOverrides = parseRigOverridesFlag(occurrences, defaultDeps.readFile);
                fireVoices = parseVoicesFlag(occurrences, defaultDeps.readFile);
            }
            catch (e) {
                console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
                process.exit(1);
            }
            return printResult(await triggersFireFlow(workflowRef, {
                n,
                text: flagString(flags, "text"),
                imageRigOverrides: fireOverrides,
                voices: fireVoices,
                wait: flags["wait"] === true,
                json,
                onProgressLine: (line) => console.log(line),
            }, defaultDeps));
        }
        console.error(`Error: unknown triggers action "${action}" (expected enable, disable, or fire).`);
        console.log("Usage: exodus workflow triggers <workflowId|name> [enable|disable <n> | fire [<n>]] [--json]");
        process.exit(1);
    }
    console.error(`Unknown subcommand: "${sub}"\n`);
    console.log(helpText);
    process.exit(1);
}
function parseTriggerIndex(raw) {
    if (raw === undefined)
        return undefined;
    if (!/^\d+$/.test(raw))
        return undefined;
    const n = Number(raw);
    return n >= 1 ? n : undefined;
}
