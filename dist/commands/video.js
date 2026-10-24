import fs from "node:fs";
import path from "node:path";
import { apiGet, apiPost, getDashboardUrl } from "../lib/client.js";
import { displayRunStatus, formatApiError } from "../lib/format.js";
import { isWorkerStoppedPark } from "../lib/runStatus.js";
import { missingRouteLine } from "../lib/route-support.js";
import { probeDurationSec } from "../lib/preflight.js";
import { ASSET_UPLOAD_POLICY, pauseAheadLine, } from "./workflow.js";
import { HELPER_LEDGER_BASE, SET_OPTION_LEDGER_BASE } from "../lib/helperLedgerBase.js";
import { customerAnswer, customerRunPage, customerStageIsWorking, customerStageLines, customerStatusLines, customerStoryboardLines, customerVoicesLines, } from "./video-customer.js";
const VOICE_MODES = ["native", "voice-first"];
function joinedOr(items) {
    if (items.length <= 1)
        return items[0] ?? "";
    return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
function joinedAnd(items) {
    if (items.length <= 1)
        return items[0] ?? "";
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
export function scriptRunPickProblem(options, conceit, style) {
    const keys = options.conceits.map((row) => row.key);
    if (!keys.includes(conceit)) {
        return keys.length === 0
            ? "This Exodus server offers no kinds of ad yet."
            : `video start --conceit must be one of ${joinedOr(keys)}.`;
    }
    const slugs = options.styles.map((row) => row.slug);
    if (!slugs.includes(style)) {
        return slugs.length === 0
            ? "This Exodus server offers no looks yet."
            : `video start --style must be one of ${joinedOr(slugs)}.`;
    }
    return null;
}
function cantSayNames(names) {
    return `the recorded voice can't say ${joinedOr(names.map((n) => `"${n}"`))}`;
}
export const helpText = `
exodus video — make a video ad from a saved workflow, pull every piece, upload your cut

The dashboard makes the PIECES of an ad: the storyboard, one picture per scene,
one voice track per scene, one video clip per scene, and a music bed if you
asked for one with --music. It does
not make the finished ad. You pull the pieces to a folder, cut them together
with whatever editing tools you like, and upload the cut back.

The whole loop, in order:

  1. exodus workflow list
     Which workflows this brand has saved. A video workflow is one that makes
     ads.

  2. exodus workflow describe <workflowId|name>
     What that workflow needs before it can run, and what it gives back.

  3. exodus workflow run <workflowId|name> --input <field>=@script.txt --wait
     Starts the ad on your script and waits. It stops when the storyboard
     needs your yes. "describe" names the field your script goes in. You can
     also settle the voices here, at the launch, instead of at step 5 — the
     launch flags all live in: exodus workflow --help

  4. exodus video storyboard <runId>
     The scene cards: what each scene says and the picture it will look like.

  5. exodus video voices <runId>
     Who is in the ad, which voice each one has, how the voices get applied
     and who pays. Add --set to give someone a voice, before any clip is made.

  6. exodus video approve <runId>          (looks right — keep going)
     Guided runs only. A One-shot run approves its own storyboard and stops
     here only when its checks find a problem.
     exodus video retry-frame <runId> --node <nodeId> --scene <n>
       Redo ONE still at the pixel gate. Neighbours stay. The gate holds.
     exodus video broll <runId>
       On a run started with --broll: the B-roll shots and the script lines.
       Add a shot on a line, move one, or remove one while the storyboard
       waits. Each change redraws only the pictures it changes, and every
       other picture stays as it was. Wait for it before you approve.

  7. exodus video status <runId>
     Where the run is and how each scene's clip turned out. If the storyboard
     failed, it also says which parts of it were accepted and why the next one
     was turned down.

     exodus video status <runId> --rejected-draft
       Prints the storyboard draft that was turned down. A record of what
       happened, thrown away by the system — never something to act on.

  8. exodus video pull <runId> --out ./ad
     Writes every piece to that folder plus a manifest.json index.

     exodus video retry-clip <runId> --scene <n>
       Redo ONE finished clip while the run waits for the cut. Everything
       else stays. A --note steers the motion, never the words. Add
       --voice-first when the words came out wrong: the line is recorded in
       the character's own voice first, then the clip is made to match it.

     exodus video revoice <runId> --all
       Redo only the VOICE on clips that kept the video model's own voice
       (for example, the run had no ElevenLabs key when they were made). The
       picture stays, no new video is made, and a clip whose voice pass
       cannot finish is kept as it was. Use --scene <n> for one clip.

  9. Make your cut from those files.

  10. exodus video upload <runId> --file cut.mp4
      Attaches your cut to the run and prints the page to watch it on. On a
      One-shot run the upload delivers the ad and you are done.

  11. Guided runs only: exodus video approve <runId>
      Or click Approve on the page from step 10. If you redid a clip after
      uploading, this stops and says which scenes changed. Upload a fresh cut,
      or add --approve-stale-cut to deliver the cut you already uploaded.

Usage:
  exodus video status <runId> [--rejected-draft] [--json]
  exodus video storyboard <runId> [--json]
  exodus video approve <runId> [--approve-stale-cut] [--json]
  exodus video retry-frame <runId> [--node <nodeId>] --scene <n> [--note "..."] [--json]
  exodus video broll <runId> [--json]
  exodus video broll add <runId> --line <id> [--note "..."] [--json]
  exodus video broll move <runId> --scene <n> --line <id> [--note "..."] [--json]
  exodus video broll remove <runId> --scene <n> [--json]
  exodus video retry-clip <runId> --scene <n> [--node <nodeId>] [--note "..."] [--voice-first] [--json]
  exodus video revoice <runId> (--scene <n> | --all) [--node <nodeId>] [--json]
  exodus video voices <runId> [--set <character>=<voice>] [--clear <character>] [--from <file.json>] [--json]
  exodus video voices [<runId>] --catalog [--json]
  exodus video pull <runId> --out <dir> [--json]
  exodus video upload <runId> --file <cut.mp4> [--duration <sec>] [--json]
  exodus video start --script <file> --conceit <kind> --style <look> [--direction "<note>"] [--frame pov] [--pacing <jump-cuts|long-take|montage>] [--voice-path <path>] [--video-model <id>] [--voice <native|voice-first>] [--music] [--broll] [--one-shot] [--director] [--wait] [--json]
  exodus video director <runId> <on|off|follow> [--json]

Options:
  --out <dir>          Folder to write the pulled pieces into (pull)
  --file <cut.mp4>     Your finished cut (upload). MP4, MOV or WebM, up to 200MB
  --duration <sec>     How long your cut is, in seconds. Only needed when the
                       length can't be read off the file itself
  --note "<text>"      How to steer one redo (retry-frame, retry-clip), or
                       what a B-roll shot should show (broll add, broll move)
  --line <id>          The script line a B-roll shot goes on (broll add,
                       broll move). exodus video broll <runId> lists the ids
  --node <nodeId>      Which scene-frames node holds the still (retry-frame;
                       admins pass it, beta testers leave it off).
                       Which video step holds the clip, when a scene has one on
                       more than one step (retry-clip, revoice)
  --scene <n>          Which scene to redo. One scene only, a whole number
                       (retry-frame, retry-clip, revoice). Which B-roll shot
                       to move or remove (broll move, broll remove)
  --all                Every finished clip that kept the video model's voice
                       (revoice)
  --voice-first        Record the scene's line in the character's own voice,
                       then make the clip to match it (retry-clip). For a clip
                       whose words came out wrong
  --approve-stale-cut  Deliver the cut you uploaded even though a clip changed
                       after you uploaded it (approve). Without it, approving
                       stops and names the scenes that changed
  --set <who>=<voice>  Give a character a voice (voices). The voice is a
                       catalog voice's name, like George, or an ElevenLabs
                       voice ID. Name the character by its ID or by the name
                       your script uses. Repeat it once per character
  --clear <who>        Take a character's voice off again (voices). Repeatable
  --from <file.json>   A file of characters and voices, by name or ID (voices).
                       --set and --clear win over the same name in the file
  --catalog            List the voices you can pick by name (voices). No run
                       needed. With a run, also the best few for each
                       character who speaks
  --rejected-draft     Print the storyboard draft the system turned down
                       (status). It was thrown away — a record only
  --script <file>      Text file of what the ad says (start). Anything works:
                       a plain transcript, a rough draft, or a description of
                       the ad. With --conceit, the server lays it out in the
                       format the video needs without changing a spoken word,
                       and says what it did. A description gets a script
                       written from it, printed, and the run starts on it. If
                       the server can't tell who says a line, it asks and
                       starts nothing. If a description is too thin to write
                       from, it says what is missing and starts nothing
  --stop-at-script     Print the script the run would start on, and start
                       nothing (start, with --conceit). To read a written or
                       laid-out script first; send it back with --script
  --rewrite-to-fit     If the script doesn't fit the kind of ad (more speakers
                       than it takes, or a rule it has), write a new script for
                       it from yours, print it, and start on it (start, with
                       --conceit). That can change every line and the names.
                       A script that fits starts as it is. With
                       --stop-at-script, it prints the new script and starts
                       nothing
  --conceit <kind>     Kind of ad (start)
  --style <look>       Look (start)
                       The server lists the kinds and looks it offers. An unknown word prints them.
  --direction "<note>" Note for the whole ad (start)
  --frame pov          Camera-as-character POV: the camera is a person in the
                       scene (start, with --conceit). Leave it off for a
                       single frame. Conversation ads only
  --pacing <pace>      jump-cuts, long-take or montage (start, with
                       --conceit). Leave it off for natural pacing. Presenter
                       ads only
  --voice-path <path>  How the voices are made (start)
  --video-model <id>   Which video model films this ad, instead of the kind of
                       ad's own default (start, with --conceit)
  --voice <mode>       voice-first (the default): the lines are recorded
                       first. native: the video model speaks the lines
                       (start, with --conceit)
  --music              Put a music bed under the ad (start). An ad has no music
                       unless you ask for it here
  --no-music           Leave the music bed off (start), which it already is
  --broll              Cut away to B-roll shots in the ad (start, with
                       --conceit). Only for accounts with B-roll switched on
  --one-shot           Make the whole video with no stop (start, with
                       --conceit). The app approves its own storyboard when
                       its checks pass and goes straight on to the clips,
                       which is the part that costs. Without it the run is
                       Guided: it stops at the storyboard for your yes
  --review-storyboard  Stop at the storyboard so you can approve it yourself
                       (start, with --conceit). This is the default, so the
                       flag changes nothing. Kept for scripts that pass it
  --director           Turn the trial director on for this ad (start, with
                       --conceit). Admins only. To switch it on or off later:
                       exodus video director <runId> on|off|follow, where
                       follow goes back to the brand's own setting
  --wait               Wait until the run needs you (start): at the
                       storyboard, or once every piece is made
  --json               Machine-readable output
  --help, -h           Print this help

Who can use what. Admins get every command here. Beta testers with video
switched on get these, on their own brands: start (--script, --conceit,
--style, --direction, --frame, --pacing, --music, --one-shot,
--review-storyboard, --stop-at-script, --rewrite-to-fit),
status, storyboard, approve (the storyboard), voices, retry-frame --scene <n> (redo one scene's
picture while the storyboard waits), pull (the finished video, each scene's
clip and voice, and the music) and upload. These stay admin-only:
start --video-model / --voice / --voice-path / --director, director,
status --rejected-draft, retry-clip, revoice and broll. start --broll works
for whoever B-roll is switched on for.
If a command answers "video isn't enabled for this key", the run id is wrong,
the command is admin-only, or video isn't switched on for your dashboard user.

Examples:
  exodus workflow list
  exodus workflow describe "Video Ad"
  exodus workflow run "Video Ad" --input script=@./script.txt --wait
  exodus video storyboard run_123
  exodus video approve run_123
  exodus video retry-frame run_123 --node frames-1 --scene 2
  exodus video broll run_123
  exodus video broll add run_123 --line L4 --note "close on the jar lid"
  exodus video retry-clip run_123 --scene 3 --note "keep the handshake in frame"
  exodus video retry-clip run_123 --scene 3 --voice-first
  exodus video revoice run_123 --all
  exodus video voices run_123
  exodus video voices --catalog
  exodus video voices run_123 --catalog
  exodus video voices run_123 --set C1=George --set "HOST 2=def456voiceid"
  exodus video voices run_123 --from voices.json
  exodus video pull run_123 --out ./ad-run_123
  exodus video upload run_123 --file ./cut.mp4
  exodus video director run_123 on
`.trim();
const SHOWS_PATH = "/api/v2/shows";
const RUNS_PATH = "/api/v2/video/runs";
const SCRIPT_RUNS_PATH = "/api/v2/video/script-runs";
const DIRECTOR_PATH = "/api/v2/video/director";
export const RUN_PATH = "/api/v2/workflow";
export const ITEMS_PATH = "/api/v2/workflow/items";
const REJECTED_DRAFT_PATH = "/api/v2/workflow/rejected-draft";
const REJECTED_DRAFT_NOT_ON_THIS_SERVER = "This Exodus server does not keep rejected drafts yet, so there is nothing to read. It arrives " +
    "with the next server update.";
const STORYBOARD_PATH = "/api/v2/video/storyboard";
const FLAG_PATH = "/api/v2/video/storyboard/flag";
const BROLL_PATH = "/api/v2/video/storyboard/broll";
const APPROVE_PATH = "/api/v2/workflow/approve";
const SCENE_RETRY_PATH = "/api/v2/workflow/scene/retry";
const SCENE_REVOICE_PATH = "/api/v2/workflow/scene/revoice";
const SCENE_VOICE_FIRST_PATH = "/api/v2/workflow/scene/voice-first";
const VOICE_FIRST_NOT_ON_THIS_SERVER = "This Exodus server cannot redo a clip voice first yet, so nothing was started and nothing " +
    "was spent. It arrives with the next server update.";
const REVOICE_NOT_ON_THIS_SERVER = "This Exodus server does not have the voice redo yet, so nothing was started and nothing " +
    "was spent. It arrives with the next server update.";
export const FINAL_PATH = "/api/v2/video/final";
export const VOICES_PATH = "/api/v2/video/voices";
export const ASSET_UPLOAD_URL_PATH = "/api/v2/workflows/asset-upload-url";
export const ASSETS_PATH = "/api/v2/workflows/assets";
function withoutJudgeFields({ judgeDetail: _d, judgeSeverity: _s, ...rest }) {
    return rest;
}
export function qcWithoutJudgeWording(qc) {
    if (!qc.takes)
        return qc;
    return {
        ...qc,
        takes: qc.takes.map(({ judgeWording: _w, heardText: _h, ...rest }) => rest),
    };
}
export const NO_TAKE_HISTORY_LINE = "no history recorded for this clip";
const TAKE_NEIGHBOUR_SENTENCE = {
    "not-applicable": () => "never compared",
    "not-attached": () => "no neighbours attached",
    "none-accepted": () => "no accepted neighbours yet",
    attached: ({ scenes }) => `compared against scene${scenes.length === 1 ? "" : "s"} ${scenes.join(", ")}`,
};
export function renderQcTakeHistory(takes) {
    if (!takes || takes.length === 0)
        return [NO_TAKE_HISTORY_LINE];
    const lines = [];
    takes.forEach((take, index) => {
        const say = TAKE_NEIGHBOUR_SENTENCE[take.neighbours.state];
        const parts = [
            take.failCodes.length ? `failed ${take.failCodes.join(", ")}` : "passed",
            ...(take.warnCodes.length ? [`warned ${take.warnCodes.join(", ")}`] : []),
            say(take.neighbours),
        ];
        const bonus = take.kind === "soft-retry" ? " (bonus take)" : "";
        lines.push(`take ${index + 1}${bonus}: ${parts.join("; ")}`);
        for (const { code, wording } of take.judgeWording ?? []) {
            lines.push(`  checker said (${code}): ${wording}`);
        }
    });
    return lines;
}
function redoLine(lastRedo) {
    return lastRedo.reason ? `${lastRedo.label}: ${lastRedo.reason}` : lastRedo.label;
}
function printDisplacedHistory(lines, lastRedo) {
    const history = lastRedo.displacedHistory;
    if (!history)
        return;
    lines.push(`       ${history.title}`);
    for (const line of history.lines)
        lines.push(`         ${line}`);
}
export function asVideoRun(data) {
    const run = (data ?? {});
    return { ...run, nodes: Array.isArray(run.nodes) ? run.nodes : [] };
}
export const defaultDeps = {
    get: (p) => apiGet(p),
    post: (p, body) => apiPost(p, body),
    mkdirp: (dir) => {
        fs.mkdirSync(dir, { recursive: true });
    },
    writeFile: (filePath, text) => fs.writeFileSync(filePath, text, "utf-8"),
    downloadToFile: async (url, filePath) => {
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    },
    readFile: (filePath) => fs.readFileSync(filePath, "utf-8"),
    readFileBytes: (filePath) => fs.readFileSync(filePath),
    statFile: (filePath) => {
        try {
            const stat = fs.statSync(filePath);
            return stat.isFile() ? { size: stat.size } : null;
        }
        catch {
            return null;
        }
    },
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
    probeDurationSec,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    dashboardUrl: getDashboardUrl(),
};
export const VIDEO_NOT_FOUND_MESSAGE = "video isn't enabled for this key\n" +
    "One of three things: that run id doesn't exist on this brand, this command is for admins only " +
    "(director, status --rejected-draft, retry-clip, revoice, broll), or video isn't " +
    "switched on for your dashboard user on this brand. Check the id first, then ask Brad.";
export function videoApiError(res) {
    const behind = missingRouteLine(res, "exodus video");
    if (behind)
        return behind;
    if (res.status === 404)
        return VIDEO_NOT_FOUND_MESSAGE;
    return formatApiError(res);
}
function adminOnlyResult(line, json) {
    return { code: 1, lines: json ? [JSON.stringify({ ok: false, error: line })] : [line] };
}
function errorResult(res, json) {
    return {
        code: 1,
        lines: json
            ? [JSON.stringify({ ok: false, status: res.status, error: videoApiError(res) })]
            : [videoApiError(res)],
    };
}
const GATE_NODE_KINDS = new Set(["scene-frames", "storyboard"]);
function isAwaitingApproval(status) {
    return status === "awaiting-approval" || status === "awaiting-review";
}
function parkedByBuilderCheckpoint(run) {
    return run.pauseReason !== undefined;
}
function parkedAtStoryboardGate(run, pausedNode) {
    return !parkedByBuilderCheckpoint(run) && GATE_NODE_KINDS.has(pausedNode.kind);
}
function parkedAtFinalWatch(run) {
    return (!parkedByBuilderCheckpoint(run) &&
        run.nodes.some((n) => n.kind === "video" && n.status === "done"));
}
function heldReason(run) {
    const verdict = run.storyboardAutoApproval;
    if (verdict?.outcome !== "held")
        return undefined;
    const reason = verdict.reason?.trim() ||
        "The app didn't approve this storyboard by itself because its checks found a problem.";
    return `${reason} (checked ${new Date(verdict.at).toISOString()})`;
}
export function classifyRun(run) {
    if (run.status === "failed")
        return { at: "failed", error: run.error };
    if (run.isTerminal)
        return { at: "finished", status: run.status };
    if (isAwaitingApproval(run.status)) {
        if (isWorkerStoppedPark(run))
            return { at: "failed", repair: true, workerStopped: true };
        if (run.pauseReason === "repair") {
            const deadNode = run.nodes.find((n) => n.status === "failed");
            const why = deadNode?.error ?? run.error;
            return {
                at: "failed",
                repair: true,
                nodeId: deadNode?.nodeId ?? run.pausedNodeId,
                ...(deadNode?.kind ? { step: deadNode.kind } : {}),
                ...(why ? { error: why } : {}),
            };
        }
        const pausedNode = run.nodes.find((n) => n.nodeId === run.pausedNodeId);
        if (pausedNode && parkedAtStoryboardGate(run, pausedNode)) {
            const held = heldReason(run);
            return {
                at: "storyboard-gate",
                nodeId: pausedNode.nodeId,
                ...(pausedNode.kind === "scene-frames"
                    ? { framesNodeId: pausedNode.nodeId }
                    : {}),
                ...(isShowAd(run) ? { showAd: true } : {}),
                ...(held ? { heldReason: held } : {}),
            };
        }
        if (parkedAtFinalWatch(run)) {
            const videoNodes = run.nodes.filter((n) => n.kind === "video");
            const autoRedoScenes = videoNodes.flatMap((n) => n.autoRedoScenes ?? []);
            const autoRedoReasons = videoNodes.flatMap((n) => n.autoRedoReasons ?? []);
            if (autoRedoScenes.length > 0) {
                return {
                    at: "running",
                    stage: "video",
                    autoRedoScenes,
                    ...(autoRedoReasons.length > 0 ? { autoRedoReasons } : {}),
                };
            }
            const missingScenes = run.nodes
                .filter((n) => n.kind === "video")
                .flatMap((n) => n.missingScenes ?? []);
            const framesNodeId = run.nodes.find((n) => n.kind === "scene-frames")?.nodeId;
            return {
                at: "final-watch",
                ...(missingScenes.length > 0 ? { missingScenes } : {}),
                ...(missingScenes.length > 0 && framesNodeId ? { framesNodeId } : {}),
            };
        }
        return { at: "paused", nodeId: run.pausedNodeId, reason: run.pauseReason };
    }
    const active = run.nodes.find((n) => n.status === "running");
    return { at: "running", stage: active?.kind ?? "starting" };
}
export function hasAttachedCut(items) {
    return items.some((i) => i.itemKind === "final" && i.status === "done");
}
export function scenesBeingRedone(run, items) {
    const scenes = new Set(run.nodes.filter((n) => n.kind === "video").flatMap((n) => n.autoRedoScenes ?? []));
    for (const i of items) {
        if (i.itemKind === "clip" &&
            i.status === "running" &&
            (i.attempt ?? 1) > 1 &&
            i.staleClaim !== true) {
            scenes.add(i.sceneIndex);
        }
    }
    return [...scenes].sort((a, b) => a - b);
}
export function resolveStop(stop, cutAttached) {
    if (stop.at !== "final-watch")
        return stop;
    return { ...stop, cutAttached };
}
export async function resolveStopAtPark(stop, runId, deps) {
    if (stop.at !== "final-watch")
        return stop;
    const res = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!res.ok)
        return resolveStop(stop, null);
    return resolveStop(stop, hasAttachedCut(res.data.items ?? []));
}
const STAGE_WORDS = {
    brief: "reading the script",
    storyboard: "writing the storyboard",
    reference: "drawing the reference still",
    "scene-frames": "drawing one picture per scene",
    voiceover: "recording the voices",
    video: "rendering the clips",
    starting: "starting up",
};
export function stageWord(stage) {
    return STAGE_WORDS[stage] ?? stage;
}
const STEP_NAMES = {
    brief: "The script read",
    storyboard: "The storyboard",
    reference: "The reference still",
    "scene-frames": "The scene pictures",
    voiceover: "The voices",
    video: "The clips",
};
export function stepName(kind) {
    if (!kind)
        return "A step in this run";
    return STEP_NAMES[kind] ?? `The ${kind} step`;
}
export function isShowAd(run) {
    return run.moduleOwned === true;
}
export function reviewUrl(dashboardUrl, run) {
    if (run.workflowId)
        return `${dashboardUrl}/workflows/${run.workflowId}/runs/${run._id}`;
    return `${dashboardUrl}/runs/${run._id}`;
}
function scenesPhrase(scenes) {
    if (scenes.length === 1)
        return `scene ${scenes[0]}`;
    return `scenes ${scenes.slice(0, -1).join(", ")} and ${scenes[scenes.length - 1]}`;
}
function missingSceneLines(missing, framesNodeId, runId, runUrl) {
    const scenes = missing.map((m) => m.sceneIndex);
    const lines = [
        `Parked: ${scenesPhrase(scenes)} ${scenes.length === 1 ? "has" : "have"} no clip yet, so the ad isn't complete.`,
    ];
    for (const { sceneIndex, pictureRefused } of missing) {
        if (!pictureRefused) {
            lines.push(`Redo clip ${sceneIndex}:     exodus video retry-clip ${runId} --scene ${sceneIndex}`);
            continue;
        }
        lines.push(`Scene ${sceneIndex}'s picture was refused by the video service as too close to an existing character, so redraw it before redoing the clip.`);
        lines.push(framesNodeId
            ? `Redraw frame ${sceneIndex}:  exodus video retry-frame ${runId} --node ${framesNodeId} --scene ${sceneIndex} --note "<what to change>"`
            : `Redraw frame ${sceneIndex}:  on the run page, ${runUrl}`);
        lines.push(`Then redo clip ${sceneIndex}: exodus video retry-clip ${runId} --scene ${sceneIndex}`);
    }
    lines.push("The ad can't be approved until every scene has a clip.", `Watch it here:   ${runUrl}`);
    return lines;
}
export function stopLines(stop, runId, runUrl) {
    if (stop.at === "storyboard-gate") {
        const lines = [
            ...(stop.heldReason ? [stop.heldReason] : []),
            "Parked: the storyboard is waiting for your yes.",
            `Read it:    exodus video storyboard ${runId}`,
            `Approve it: exodus video approve ${runId}`,
        ];
        if (stop.showAd) {
            lines.push(`Send back:  exodus video flag ${runId} --note "what's wrong"`);
        }
        if (stop.framesNodeId) {
            lines.push(`Redo one frame: exodus video retry-frame ${runId} --node ${stop.framesNodeId} --scene <n>`);
        }
        return lines;
    }
    if (stop.at === "final-watch") {
        if (stop.missingScenes?.length) {
            return missingSceneLines(stop.missingScenes, stop.framesNodeId, runId, runUrl);
        }
        if (stop.cutAttached === null) {
            return [
                "Parked: every piece is made.",
                `Couldn't check whether a cut is already uploaded. See where it stands: exodus video status ${runId}`,
                `Watch it here:   ${runUrl}`,
            ];
        }
        if (stop.cutAttached) {
            return [
                "Parked: your cut is uploaded and waiting for your approval.",
                `Approve it:      exodus video approve ${runId}`,
                `Watch it here:   ${runUrl}`,
                "Changed your mind? You can still redo a clip and upload a new cut.",
            ];
        }
        return [
            "Parked: every piece is made and the run is waiting for a cut.",
            `Pull the pieces: exodus video pull ${runId} --out ./ad-${runId}`,
            `Then upload:     exodus video upload ${runId} --file cut.mp4`,
            `Redo one clip:   exodus video retry-clip ${runId} --scene <n>`,
            `Watch it here:   ${runUrl}`,
        ];
    }
    if (stop.at === "failed") {
        if (stop.workerStopped) {
            return [
                "The worker making this ad stopped partway. Finished steps are kept.",
                `Carry on from where it stopped: exodus workflow repair ${runId} retry`,
                `Or open the run:                ${runUrl}`,
            ];
        }
        if (stop.repair) {
            if (!stop.step) {
                return [
                    "This run stopped at a step that can't be picked back up from here.",
                    "Start a fresh run to get this ad made.",
                    `Open the run:        ${runUrl}`,
                ];
            }
            return [
                `${stepName(stop.step)} failed${stop.error ? `: ${stop.error}` : "."}`,
                `Try that step again: exodus workflow repair ${runId} retry`,
                `Or open the run:     ${runUrl}`,
            ];
        }
        return [
            `This run failed${stop.error ? `: ${stop.error}` : "."}`,
            `See how far it got: exodus video status ${runId}`,
        ];
    }
    if (stop.at === "finished") {
        return [
            `This run is finished (${displayRunStatus(stop.status)}).`,
            `Pull what it made: exodus video pull ${runId} --out ./ad-${runId}`,
        ];
    }
    if (stop.at === "paused") {
        return [
            `Parked: this run is waiting on someone${stop.reason ? ` (${stop.reason})` : ""}.`,
            `Open it: ${runUrl}`,
        ];
    }
    if (stop.autoRedoScenes?.length)
        return [autoRedoLine(stop.autoRedoScenes, stop.autoRedoReasons)];
    return [`Working: ${stageWord(stop.stage)}.`];
}
function autoRedoLine(scenes, reasons = []) {
    const reasonOf = new Map(reasons.map((r) => [r.sceneIndex, r.reason]));
    const groups = new Map();
    for (const scene of [...scenes].sort((a, b) => a - b)) {
        const reason = reasonOf.get(scene);
        groups.set(reason, [...(groups.get(reason) ?? []), scene]);
    }
    const one = scenes.length === 1;
    const clauses = [...groups].map(([reason, group], i) => {
        const own = i === 0 ? ` on ${group.length === 1 ? "its" : "their"} own` : "";
        return `${scenesPhrase(group)}${own}${reason ? ` because ${reason}` : ""}`;
    });
    const listed = clauses.length === 1
        ? clauses[0]
        : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
    return (`Working: the app is redoing ${listed}. ` +
        `The ad isn't ready to watch until ${one ? "it lands" : "they land"}.`);
}
export function failedStoryboardNode(run) {
    return run.nodes.find((n) => n.kind === "storyboard" && n.status === "failed");
}
export function errorEchoesReasons(error, record) {
    if (!error || record?.kind !== "rejected")
        return false;
    const reasons = record.reasons ?? [];
    return reasons.length > 0 && reasons.every((reason) => error.includes(reason));
}
export function planFailureLines(node, runId) {
    const record = node?.planFailure;
    if (!record || !Array.isArray(record.lines) || !node)
        return [];
    const reasons = record.kind === "rejected" ? (record.reasons ?? []) : [];
    const bodyCount = Math.max(0, record.lines.length - reasons.length);
    const lines = [`What happened to the storyboard step (${node.nodeId}):`];
    record.lines.forEach((line, i) => {
        lines.push(i < bodyCount ? `  ${line}` : `    - ${line}`);
    });
    if (node?.hasRejectedDraft === true) {
        lines.push("  A rejected draft is on file. The system threw it away, so it is a record of what happened and nothing to act on.", `  Read it: exodus video status ${runId} --rejected-draft`);
    }
    return lines;
}
export const MUSIC_HEARD_CODE = "music-heard";
export const CAST_LEDGER_BASE = HELPER_LEDGER_BASE + 10000;
export const CAST_VIEW_LEDGER_BASE = CAST_LEDGER_BASE + 1000;
export function musicBedState(run) {
    if (run.musicBed === undefined)
        return "unknown";
    return run.musicBed ? "on" : "off";
}
function isPullSceneIndex(sceneIndex) {
    return sceneIndex >= 0 && sceneIndex < HELPER_LEDGER_BASE;
}
const FALLBACK_EXT = {
    image: "png",
    video: "mp4",
    audio: "mp3",
};
export function extensionFromUrl(url) {
    const withoutQuery = url.split(/[?#]/)[0];
    const match = withoutQuery.match(/\.([a-z0-9]{1,5})$/i);
    return match ? match[1].toLowerCase() : undefined;
}
function extFor(url, family) {
    return extensionFromUrl(url) ?? FALLBACK_EXT[family];
}
export function scenePrefix(sceneIndex) {
    return `scene-${String(sceneIndex).padStart(2, "0")}`;
}
function clipQcOf(item) {
    const artifact = item?.artifact;
    return artifact && artifact.type === "video" ? artifact.qc?.takes : undefined;
}
function outputsOfNodeKind(run, kind) {
    return run.nodes.filter((n) => n.kind === kind).flatMap((n) => n.outputs ?? []);
}
function clipFromArtifact(sceneIndex, artifact) {
    if (!artifact || artifact.type !== "video" || artifact.final || !artifact.videoUrl) {
        return null;
    }
    return {
        download: {
            file: `${scenePrefix(sceneIndex)}.${extFor(artifact.videoUrl, "video")}`,
            url: artifact.videoUrl,
        },
        durationSec: artifact.durationSec ?? null,
        qc: artifact.qc ?? null,
        words: artifact.words ?? null,
        revoiced: artifact.revoiced === true,
        speechTrimmed: artifact.speechTrimmed === true,
        rawStorageId: artifact.rawStorageId ?? null,
        voiceMode: artifact.voiceMode ?? null,
        voiceFirstBlockedBy: artifact.voiceFirstBlockedBy ?? null,
        voicePitchHz: artifact.voicePitchHz ?? null,
        voicePitchMethod: artifact.voicePitchMethod ?? null,
        replannedIdea: artifact.replannedIdea ?? null,
    };
}
function keyframeDownload(sceneIndex, imageUrl) {
    return {
        file: `${scenePrefix(sceneIndex)}.keyframe.${extFor(imageUrl, "image")}`,
        url: imageUrl,
    };
}
function reservedCastFrames(items) {
    const byIndex = new Map();
    for (const item of items) {
        if (item.itemKind === "frame" &&
            item.sceneIndex >= CAST_LEDGER_BASE &&
            item.sceneIndex < SET_OPTION_LEDGER_BASE) {
            byIndex.set(item.sceneIndex, item);
        }
    }
    return byIndex;
}
function castVoicePins(artifact) {
    const pins = new Map();
    let envelope = artifact?.storyboard;
    if (envelope === undefined && typeof artifact?.storyboardJson === "string") {
        try {
            envelope = JSON.parse(artifact.storyboardJson);
        }
        catch {
            return pins;
        }
    }
    const cast = envelope?.cast;
    if (!Array.isArray(cast))
        return pins;
    for (const member of cast) {
        const characterId = typeof member.characterId === "string" ? member.characterId.trim() : "";
        const voiceId = typeof member.voiceId === "string" ? member.voiceId.trim() : "";
        const description = typeof member.voiceDescription === "string" ? member.voiceDescription.trim() : "";
        if (!characterId || (!voiceId && !description))
            continue;
        const label = typeof member.voiceLabel === "string" ? member.voiceLabel.trim() : "";
        pins.set(characterId, {
            voiceId: voiceId ? voiceId : null,
            voiceLabel: voiceId && label ? label : null,
            voiceDescription: description ? description : null,
        });
    }
    return pins;
}
function lockViews(member, viewRows) {
    return (member.identityRefs ?? []).flatMap((ref) => {
        if (!ref.view)
            return [];
        const row = viewRows.find(({ artifact: art }) => art?.type !== "image"
            ? false
            : art.storageId
                ? art.storageId === ref.storageId
                : !!art.imageUrl && art.imageUrl === ref.imageUrl);
        const url = (row?.artifact?.type === "image" ? row.artifact.imageUrl : undefined) ?? ref.imageUrl;
        return url ? [{ view: ref.view, url }] : [];
    });
}
function planCastRefs(run, items, pins) {
    const ledger = reservedCastFrames(items);
    const isViewRow = ([sceneIndex, row]) => sceneIndex >= CAST_VIEW_LEDGER_BASE || (row.artifact?.type === "image" && row.artifact.view !== undefined);
    const sorted = [...ledger.entries()].sort(([a], [b]) => a - b);
    const ledgerRows = sorted.filter((r) => !isViewRow(r));
    const viewRows = sorted.filter(isViewRow).map(([, row]) => row);
    const locked = run.castLock?.cast;
    const rows = [];
    if (locked !== undefined && locked.length > 0) {
        const claimedStorageIds = new Set();
        for (const member of locked) {
            const storageId = member.identityRefs?.[0]?.storageId;
            const item = typeof storageId === "string" && storageId.length > 0
                ? ledgerRows.find(([, row]) => {
                    const art = row.artifact;
                    return art?.type === "image" && art.storageId === storageId;
                })?.[1]
                : undefined;
            if (typeof storageId === "string" && storageId.length > 0) {
                claimedStorageIds.add(storageId);
            }
            const art = item?.artifact;
            const url = (art?.type === "image" ? art.imageUrl : undefined) ??
                member.identityRefs?.[0]?.imageUrl;
            rows.push({
                characterId: member.characterId,
                name: member.name,
                url,
                status: item?.status ?? (url ? "done" : "missing"),
                error: item?.error ?? null,
                stem: `cast-${member.characterId}`,
                views: lockViews(member, viewRows),
            });
        }
        for (const [sceneIndex, item] of ledgerRows) {
            const art = item.artifact;
            const sid = art?.type === "image" ? art.storageId : undefined;
            if (typeof sid === "string" && claimedStorageIds.has(sid))
                continue;
            const url = art?.type === "image" ? art.imageUrl : undefined;
            rows.push({
                characterId: null,
                name: null,
                url,
                status: item.status,
                error: item.error ?? null,
                stem: `cast-ref-${String(sceneIndex - CAST_LEDGER_BASE).padStart(2, "0")}`,
                views: [],
            });
        }
    }
    else {
        for (const [sceneIndex, item] of ledgerRows) {
            const art = item.artifact;
            const url = art?.type === "image" ? art.imageUrl : undefined;
            rows.push({
                characterId: null,
                name: null,
                url,
                status: item.status,
                error: item.error ?? null,
                stem: `cast-ref-${String(sceneIndex - CAST_LEDGER_BASE).padStart(2, "0")}`,
                views: [],
            });
        }
    }
    const cast = [];
    const downloads = [];
    for (const row of rows) {
        const file = row.url ? `${row.stem}.${extFor(row.url, "image")}` : null;
        const pin = row.characterId ? pins.get(row.characterId) : undefined;
        const views = row.views.map((v) => ({ view: v.view, file: `${row.stem}-${v.view}.${extFor(v.url, "image")}`, url: v.url }));
        cast.push({
            characterId: row.characterId,
            name: row.name,
            file,
            status: row.status,
            error: row.error,
            voiceId: pin?.voiceId ?? null,
            voiceLabel: pin?.voiceLabel ?? null,
            voiceDescription: pin?.voiceDescription ?? null,
            ...(views.length ? { views: views.map(({ view, file: viewFile }) => ({ view, file: viewFile })) } : {}),
        });
        if (file && row.url)
            downloads.push({ file, url: row.url });
        for (const v of views)
            downloads.push({ file: v.file, url: v.url });
    }
    return { cast, downloads };
}
function isNarrationMaster(artifact) {
    return (artifact.type === "audio" &&
        artifact.sceneIndex === undefined &&
        Array.isArray(artifact.narration?.cuts));
}
function withoutLookRider(prompt) {
    return prompt.replace(/\n\nCUTAWAY STYLE: [\s\S]*$/, "");
}
function withReplannedPrompts(raw, replanned) {
    let board;
    try {
        board = JSON.parse(raw);
    }
    catch {
        return raw;
    }
    if (!Array.isArray(board.scenes))
        return raw;
    const scenes = board.scenes.map((scene) => {
        const idea = typeof scene.sceneIndex === "number" ? replanned.get(scene.sceneIndex) : undefined;
        return idea ? { ...scene, ...idea } : scene;
    });
    return JSON.stringify({ ...board, scenes }, null, 2);
}
export function planPull(run, items, opts) {
    const texts = [];
    const storyboardArtifact = run.nodes
        .flatMap((n) => n.outputs ?? [])
        .find((a) => a.type === "storyboard");
    const storyboardRaw = storyboardArtifact
        ? typeof storyboardArtifact.storyboardJson === "string"
            ? storyboardArtifact.storyboardJson
            : storyboardArtifact.storyboard !== undefined
                ? JSON.stringify(storyboardArtifact.storyboard, null, 2)
                : undefined
        : undefined;
    let reference = null;
    let productSheet = null;
    let setPlate = null;
    const filledByStage = new Map();
    for (const artifact of outputsOfNodeKind(run, "reference")) {
        if (artifact.type !== "image" || !artifact.imageUrl)
            continue;
        if (artifact.anchor === "filled-plate") {
            const holds = artifact.holds ?? [];
            const lid = artifact.lid;
            filledByStage.set(JSON.stringify([holds, lid ?? null]), { holds, url: artifact.imageUrl, ...(lid ? { lid } : {}) });
            continue;
        }
        const stem = artifact.anchor ?? "reference";
        const download = { file: `${stem}.${extFor(artifact.imageUrl, "image")}`, url: artifact.imageUrl };
        if (artifact.anchor === "product-sheet")
            productSheet = download;
        else if (artifact.anchor === "set-plate")
            setPlate = download;
        else if (!artifact.anchor)
            reference = download;
    }
    const stageKeys = [...new Set([...filledByStage.values()].map((plate) => JSON.stringify(plate.holds)))];
    const filledPlates = [...filledByStage.values()].map((plate) => ({
        holds: plate.holds,
        ...(plate.lid ? { lid: plate.lid } : {}),
        download: {
            file: `filled-plate-${stageKeys.indexOf(JSON.stringify(plate.holds)) + 1}${plate.lid ? "-lid-closed" : ""}.${extFor(plate.url, "image")}`,
            url: plate.url,
        },
    }));
    const keyframeByScene = new Map();
    for (const artifact of run.nodes.flatMap((n) => n.outputs ?? [])) {
        if (artifact.type !== "frames")
            continue;
        for (const frame of artifact.frames ?? []) {
            if (!frame.imageUrl)
                continue;
            if (!isPullSceneIndex(frame.sceneIndex))
                continue;
            keyframeByScene.set(frame.sceneIndex, keyframeDownload(frame.sceneIndex, frame.imageUrl));
        }
    }
    const voiceByScene = new Map();
    let narrationDownload = null;
    let narrationMaster = null;
    for (const artifact of outputsOfNodeKind(run, "voiceover")) {
        if (artifact.type !== "audio" || !artifact.audioUrl)
            continue;
        if (isNarrationMaster(artifact)) {
            narrationMaster = artifact;
            narrationDownload = {
                file: `narration.${extFor(artifact.audioUrl, "audio")}`,
                url: artifact.audioUrl,
            };
            continue;
        }
        if (typeof artifact.sceneIndex !== "number" || !isPullSceneIndex(artifact.sceneIndex))
            continue;
        voiceByScene.set(artifact.sceneIndex, {
            download: {
                file: `${scenePrefix(artifact.sceneIndex)}.voice.${extFor(artifact.audioUrl, "audio")}`,
                url: artifact.audioUrl,
            },
            words: artifact.words ?? null,
        });
    }
    if (narrationMaster && narrationDownload) {
        const timing = {
            takeHash: narrationMaster.narration?.takeHash,
            voiceId: narrationMaster.narration?.voiceId,
            modelId: narrationMaster.narration?.modelId,
            speed: narrationMaster.narration?.speed,
            alignment: narrationMaster.narration?.alignment,
            words: narrationMaster.words ?? [],
            cuts: (narrationMaster.narration?.cuts ?? []).map((cut) => ({
                sceneIndex: cut.sceneIndex,
                startSec: cut.startSec,
                durationSec: cut.durationSec,
                takeHash: cut.takeHash,
                file: voiceByScene.get(cut.sceneIndex)?.download.file ??
                    `${scenePrefix(cut.sceneIndex)}.voice.mp3`,
            })),
        };
        texts.push({
            file: "narration.json",
            body: `${JSON.stringify(timing, null, 2)}\n`,
        });
    }
    const clipByScene = new Map();
    let music = null;
    for (const artifact of outputsOfNodeKind(run, "video")) {
        if (artifact.type === "audio" && artifact.sceneIndex === undefined && artifact.audioUrl) {
            music = { file: `music.${extFor(artifact.audioUrl, "audio")}`, url: artifact.audioUrl };
            continue;
        }
        if (artifact.type !== "video" || typeof artifact.sceneIndex !== "number")
            continue;
        if (!isPullSceneIndex(artifact.sceneIndex))
            continue;
        const clip = clipFromArtifact(artifact.sceneIndex, artifact);
        if (!clip)
            continue;
        clipByScene.set(artifact.sceneIndex, clip);
    }
    const clipItemByScene = new Map();
    const frameItemByScene = new Map();
    const sceneFrameNodeIds = new Set(run.nodes.filter((n) => n.kind === "scene-frames").map((n) => n.nodeId));
    for (const item of items) {
        if (!isPullSceneIndex(item.sceneIndex))
            continue;
        if (item.itemKind === "clip")
            clipItemByScene.set(item.sceneIndex, item);
        if (item.itemKind === "frame" && sceneFrameNodeIds.has(item.nodeId)) {
            frameItemByScene.set(item.sceneIndex, item);
        }
    }
    for (const [sceneIndex, item] of clipItemByScene) {
        if (item.status !== "done" || clipByScene.has(sceneIndex))
            continue;
        const clip = clipFromArtifact(sceneIndex, item.artifact);
        if (!clip)
            continue;
        clipByScene.set(sceneIndex, clip);
    }
    for (const [sceneIndex, item] of frameItemByScene) {
        if (item.status !== "done" || keyframeByScene.has(sceneIndex))
            continue;
        const artifact = item.artifact;
        if (!artifact || artifact.type !== "image" || !artifact.imageUrl)
            continue;
        keyframeByScene.set(sceneIndex, keyframeDownload(sceneIndex, artifact.imageUrl));
    }
    const pendingRedo = scenesBeingRedone(run, items);
    for (const sceneIndex of pendingRedo)
        clipByScene.delete(sceneIndex);
    const replanned = new Map();
    for (const [sceneIndex, clip] of clipByScene) {
        if (!clip.replannedIdea)
            continue;
        const { imageUrl, framePrompt, videoPrompt } = clip.replannedIdea;
        keyframeByScene.set(sceneIndex, keyframeDownload(sceneIndex, imageUrl));
        if (framePrompt && videoPrompt)
            replanned.set(sceneIndex, { framePrompt, videoPrompt });
    }
    let storyboard = null;
    if (storyboardRaw !== undefined) {
        const body = replanned.size > 0 ? withReplannedPrompts(storyboardRaw, replanned) : storyboardRaw;
        storyboard = "storyboard.json";
        texts.unshift({ file: storyboard, body: body.endsWith("\n") ? body : `${body}\n` });
    }
    const sceneIndexes = [
        ...new Set([
            ...clipByScene.keys(),
            ...voiceByScene.keys(),
            ...keyframeByScene.keys(),
            ...clipItemByScene.keys(),
            ...frameItemByScene.keys(),
        ]),
    ]
        .filter((sceneIndex) => isPullSceneIndex(sceneIndex))
        .sort((a, b) => a - b);
    const scenes = sceneIndexes.map((sceneIndex) => {
        const clip = clipByScene.get(sceneIndex);
        const voice = voiceByScene.get(sceneIndex);
        const item = clipItemByScene.get(sceneIndex);
        const frameItem = frameItemByScene.get(sceneIndex);
        let source = null;
        let wordsFrom = null;
        if (clip?.words && clip.words.length > 0) {
            source = clip.words;
            wordsFrom = "clip";
        }
        else if (voice?.words && voice.words.length > 0) {
            source = voice.words;
            wordsFrom = "voice";
        }
        let words = null;
        if (source) {
            words = `${scenePrefix(sceneIndex)}.words.json`;
            texts.push({ file: words, body: `${JSON.stringify(source, null, 2)}\n` });
        }
        return {
            sceneIndex,
            durationSec: clip?.durationSec ?? null,
            clip: clip?.download.file ?? null,
            words,
            wordsFrom,
            wordsDescribe: wordsFrom === null
                ? null
                : clip?.revoiced === true && wordsFrom === "clip"
                    ? "original-performance"
                    : "this-file",
            voice: voice?.download.file ?? null,
            keyframe: keyframeByScene.get(sceneIndex)?.file ?? null,
            qc: clip?.qc ? qcWithoutJudgeWording(clip.qc) : null,
            revoiced: clip ? clip.revoiced : null,
            speechTrimmed: clip ? clip.speechTrimmed : null,
            rawStorageId: clip ? clip.rawStorageId : null,
            voiceMode: clip ? clip.voiceMode : null,
            voiceFirstBlockedBy: clip ? clip.voiceFirstBlockedBy : null,
            voicePitchHz: clip ? clip.voicePitchHz : null,
            voicePitchMethod: clip ? clip.voicePitchMethod : null,
            clipStatus: item?.status ?? "missing",
            error: item?.error ?? null,
            flagged: item?.flagged === true,
            findings: (item?.findings ?? []).map(withoutJudgeFields),
            keyframeFindings: frameItem?.findings?.map(withoutJudgeFields) ?? null,
        };
    });
    const { cast, downloads: castDownloads } = planCastRefs(run, items, castVoicePins(storyboardArtifact));
    const downloads = [
        ...(reference ? [reference] : []),
        ...(productSheet ? [productSheet] : []),
        ...(setPlate ? [setPlate] : []),
        ...filledPlates.map((p) => p.download),
        ...keyframeByScene.values(),
        ...[...voiceByScene.values()].map((v) => v.download),
        ...(narrationDownload ? [narrationDownload] : []),
        ...[...clipByScene.values()].map((c) => c.download),
        ...(music ? [music] : []),
        ...castDownloads,
    ];
    return {
        downloads,
        texts,
        manifest: {
            runId: run._id,
            pulledAt: opts.pulledAt,
            dashboardUrl: reviewUrl(opts.dashboardUrl, run),
            storyboard,
            reference: reference?.file ?? null,
            productSheet: productSheet?.file ?? null,
            setPlate: setPlate?.file ?? null,
            filledPlates: filledPlates.map((p) => ({ file: p.download.file, holds: p.holds, ...(p.lid ? { lid: p.lid } : {}) })),
            music: music?.file ?? null,
            musicBed: musicBedState(run),
            musicHeardScenes: scenes
                .filter((scene) => scene.findings.some((f) => f.code === MUSIC_HEARD_CODE))
                .map((scene) => scene.sceneIndex),
            pendingRedo,
            dropped: [...clipItemByScene.values()]
                .filter((item) => item.status === "rejected")
                .map((item) => item.sceneIndex)
                .sort((a, b) => a - b),
            cast,
            narration: narrationDownload
                ? { file: narrationDownload.file, timing: "narration.json" }
                : null,
            scenes,
            failed: [],
            ...(run.provenance?.format || run.provenance?.voice
                ? { provenance: run.provenance }
                : {}),
            ...(run.videoChoice
                ? {
                    videoChoice: {
                        videoModel: run.videoChoice.videoModel,
                        voiceMode: run.videoChoice.voiceMode,
                    },
                }
                : {}),
            ...(run.shots?.frame || run.shots?.pacing ? { shots: run.shots } : {}),
        },
    };
}
export function markPullFailure(manifest, failure) {
    manifest.failed.push(failure);
    if (manifest.storyboard === failure.file)
        manifest.storyboard = null;
    if (manifest.reference === failure.file)
        manifest.reference = null;
    if (manifest.productSheet === failure.file)
        manifest.productSheet = null;
    if (manifest.setPlate === failure.file)
        manifest.setPlate = null;
    for (const plate of manifest.filledPlates) {
        if (plate.file === failure.file)
            plate.file = null;
    }
    if (manifest.music === failure.file)
        manifest.music = null;
    for (const ref of manifest.cast) {
        if (ref.file === failure.file)
            ref.file = null;
        for (const view of ref.views ?? []) {
            if (view.file === failure.file)
                view.file = null;
        }
    }
    if (manifest.narration?.file === failure.file)
        manifest.narration = null;
    for (const scene of manifest.scenes) {
        const lostWordsSource = (scene.clip === failure.file && scene.wordsFrom === "clip") ||
            (scene.voice === failure.file && scene.wordsFrom === "voice");
        if (scene.clip === failure.file) {
            scene.clip = null;
            scene.revoiced = null;
            scene.speechTrimmed = null;
            scene.rawStorageId = null;
            scene.voiceMode = null;
            scene.voiceFirstBlockedBy = null;
            scene.voicePitchHz = null;
            scene.voicePitchMethod = null;
        }
        if (scene.voice === failure.file)
            scene.voice = null;
        if (scene.keyframe === failure.file)
            scene.keyframe = null;
        if (scene.words === failure.file || lostWordsSource) {
            scene.words = null;
            scene.wordsFrom = null;
            scene.wordsDescribe = null;
        }
    }
}
const PULL_CONCURRENCY = 4;
async function runPool(jobs, size) {
    const results = new Array(jobs.length);
    let next = 0;
    const worker = async () => {
        for (;;) {
            const index = next++;
            if (index >= jobs.length)
                return;
            results[index] = await jobs[index]();
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
    return results;
}
const DOWNLOAD_ATTEMPTS = 2;
async function downloadWithRetry(download, dir, deps) {
    let lastError = "";
    for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
        try {
            await deps.downloadToFile(download.url, path.join(dir, download.file));
            return null;
        }
        catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
        }
    }
    return { file: download.file, url: download.url, error: lastError };
}
const SETUP_LABELS = [
    { key: "set", label: "Set" },
    { key: "cast", label: "Cast" },
    { key: "voices", label: "Voices" },
];
export function missingSetupLabels(progress) {
    if (!progress)
        return [];
    return SETUP_LABELS.filter(({ key }) => progress[key] !== true).map(({ label }) => label);
}
export async function showsFlow(json, deps) {
    const res = await deps.get(SHOWS_PATH);
    if (!res.ok)
        return errorResult(res, json);
    const shows = (res.data.shows ?? []).slice();
    if (json)
        return { code: 0, lines: [JSON.stringify({ shows })] };
    if (shows.length === 0) {
        return {
            code: 0,
            lines: [
                "No Shows on this brand yet.",
                "A Show is the set, cast and voices your ads reuse. Make one in the dashboard under Video.",
            ],
        };
    }
    const idWidth = Math.max(2, ...shows.map((s) => s.id.length));
    const nameWidth = Math.max(4, ...shows.map((s) => s.name.length));
    const lines = [
        `${"id".padEnd(idWidth)}  ${"name".padEnd(nameWidth)}  state`,
        ...shows.map((show) => {
            const missing = missingSetupLabels(show.setupProgress);
            const state = show.ready === true
                ? "ready"
                : missing.length > 0
                    ? `not ready — still needs ${missing.join(", ")}`
                    : "not ready";
            return `${show.id.padEnd(idWidth)}  ${show.name.padEnd(nameWidth)}  ${state}`;
        }),
        "",
        "Start an ad on a ready Show: exodus video start --show <id> --script script.txt",
    ];
    return { code: 0, lines };
}
export async function startFlow(opts, deps) {
    let script;
    try {
        script = deps.readFile(opts.scriptFile);
    }
    catch (e) {
        return {
            code: 1,
            lines: [
                `Can't read the script file "${opts.scriptFile}": ${e instanceof Error ? e.message : String(e)}`,
            ],
        };
    }
    if (script.trim().length === 0) {
        return { code: 1, lines: [`The script file "${opts.scriptFile}" is empty.`] };
    }
    const res = await deps.post(RUNS_PATH, {
        showId: opts.showId,
        script,
        ...(opts.voicePath ? { voicePath: opts.voicePath } : {}),
        ...(opts.music === undefined ? {} : { music: opts.music }),
    });
    if (!res.ok)
        return errorResult(res, opts.json);
    const started = res.data;
    if (!started.runId) {
        return { code: 1, lines: ["The server started the ad but did not say which run it is."] };
    }
    const runId = started.runId;
    const url = started.url ?? reviewUrl(deps.dashboardUrl, { _id: runId });
    if (!opts.wait) {
        const lines = [
            `Started ad run ${runId}`,
            `Watch it: ${url}`,
            "",
            `Wait for the storyboard here instead: exodus video start … --wait`,
            `Or check in whenever:                exodus video status ${runId}`,
        ];
        return {
            code: 0,
            lines: opts.json ? [JSON.stringify({ runId, url })] : lines,
        };
    }
    return startedThenWait(runId, [`Started ad run ${runId}`, `Watch it: ${url}`], { ...opts, url }, deps);
}
async function startedThenWait(runId, head, opts, deps) {
    const stream = opts.json ? undefined : opts.onProgressLine;
    if (stream)
        for (const line of [...head, ""])
            stream(line);
    const waited = await waitFlow(runId, { json: opts.json, url: opts.url, onProgressLine: stream }, deps);
    if (opts.json || stream)
        return waited;
    return { code: waited.code, lines: [...head, "", ...waited.lines] };
}
function nonBlank(value) {
    if (value === undefined || value.trim().length === 0)
        return undefined;
    return value;
}
function isVoiceMode(value) {
    return VOICE_MODES.some((mode) => mode === value);
}
export function planMusicChoice(occurrences) {
    let music;
    for (const { flag, value } of occurrences) {
        if (flag === "no-music") {
            music = false;
            continue;
        }
        if (flag !== "music")
            continue;
        if (value === undefined || value.startsWith("--")) {
            music = true;
            continue;
        }
        const word = value.trim().toLowerCase();
        const literal = word === "true" ? true : word === "false" ? false : undefined;
        if (literal === undefined) {
            return {
                ok: false,
                line: `video start --music takes true or false, or no value at all (got "${value}").`,
            };
        }
        music = literal;
    }
    return { ok: true, music };
}
function planValueFlag(occurrences, name) {
    let value;
    for (const occurrence of occurrences) {
        if (occurrence.flag !== name)
            continue;
        const given = occurrence.value;
        if (given === undefined || given.startsWith("--") || given.trim().length === 0) {
            return { ok: false, line: `video start --${name} needs a value.` };
        }
        value = given.trim();
    }
    return { ok: true, value };
}
export function planVideoStart(flags, occurrences) {
    const showId = nonBlank(flagString(flags, "show"));
    const scriptFile = nonBlank(flagString(flags, "script"));
    const conceit = nonBlank(flagString(flags, "conceit"));
    const style = nonBlank(flagString(flags, "style"));
    if (showId && (conceit || style)) {
        return {
            kind: "usage",
            line: "Pass either --show <id>, or --conceit and --style. Not both.",
        };
    }
    if (!scriptFile) {
        return {
            kind: "usage",
            line: "video start needs --script <file>, a text file of what the ad says.",
        };
    }
    const musicChoice = planMusicChoice(occurrences);
    if (!musicChoice.ok)
        return { kind: "usage", line: musicChoice.line };
    const videoModelFlag = planValueFlag(occurrences, "video-model");
    if (!videoModelFlag.ok)
        return { kind: "usage", line: videoModelFlag.line };
    const voiceFlag = planValueFlag(occurrences, "voice");
    if (!voiceFlag.ok)
        return { kind: "usage", line: voiceFlag.line };
    const frameFlag = planValueFlag(occurrences, "frame");
    if (!frameFlag.ok)
        return { kind: "usage", line: frameFlag.line };
    const pacingFlag = planValueFlag(occurrences, "pacing");
    if (!pacingFlag.ok)
        return { kind: "usage", line: pacingFlag.line };
    const videoModel = videoModelFlag.value;
    const voiceMode = voiceFlag.value;
    const reviewStoryboardFlag = occurrences.some((o) => o.flag === "review-storyboard");
    const oneShot = occurrences.some((o) => o.flag === "one-shot");
    if (showId && reviewStoryboardFlag) {
        return {
            kind: "usage",
            line: "--review-storyboard works with --conceit, not --show. A Show's ad always stops at the storyboard for you.",
        };
    }
    if (showId && oneShot) {
        return {
            kind: "usage",
            line: "--one-shot works with --conceit, not --show. A Show's ad always stops at the storyboard for you.",
        };
    }
    if (oneShot && reviewStoryboardFlag) {
        return {
            kind: "usage",
            line: "Pass --one-shot or --review-storyboard, not both.",
        };
    }
    if (occurrences.some((o) => o.flag === "one-shot" && o.value !== undefined && !o.value.startsWith("--"))) {
        return {
            kind: "usage",
            line: "--one-shot takes no value. Leave it off to stop at the storyboard.",
        };
    }
    const directorFlags = occurrences.filter((o) => o.flag === "director");
    if (directorFlags.some((o) => o.value !== undefined && !o.value.startsWith("--"))) {
        return {
            kind: "usage",
            line: "--director takes no value. Leave it off to start without the director.",
        };
    }
    const director = directorFlags.length > 0;
    const brollFlags = occurrences.filter((o) => o.flag === "broll");
    if (brollFlags.some((o) => o.value !== undefined && !o.value.startsWith("--"))) {
        return {
            kind: "usage",
            line: "--broll takes no value. Leave it off to start without B-roll.",
        };
    }
    const broll = brollFlags.length > 0;
    const stopFlags = occurrences.filter((o) => o.flag === "stop-at-script");
    if (stopFlags.some((o) => o.value !== undefined && !o.value.startsWith("--"))) {
        return {
            kind: "usage",
            line: "--stop-at-script takes no value. Leave it off to start the run.",
        };
    }
    const stopAtScript = stopFlags.length > 0;
    if (showId && stopAtScript) {
        return {
            kind: "usage",
            line: "--stop-at-script works with --conceit, not --show. A Show's script is read as you wrote it.",
        };
    }
    const refitFlags = occurrences.filter((o) => o.flag === "rewrite-to-fit");
    if (refitFlags.some((o) => o.value !== undefined && !o.value.startsWith("--"))) {
        return {
            kind: "usage",
            line: "--rewrite-to-fit takes no value. Leave it off to start the script as you wrote it.",
        };
    }
    const rewriteToFit = refitFlags.length > 0;
    if (showId && rewriteToFit) {
        return {
            kind: "usage",
            line: "--rewrite-to-fit works with --conceit, not --show. A Show's script is read as you wrote it.",
        };
    }
    if (showId && director) {
        return {
            kind: "usage",
            line: "--director works with --conceit, not --show.",
        };
    }
    if (showId && broll) {
        return {
            kind: "usage",
            line: "--broll works with --conceit, not --show.",
        };
    }
    if (showId && (frameFlag.value || pacingFlag.value)) {
        return {
            kind: "usage",
            line: "--frame and --pacing work with --conceit, not --show.",
        };
    }
    if (showId && (videoModel || voiceMode)) {
        return {
            kind: "usage",
            line: "--video-model and --voice work with --conceit, not --show. A Show films on its own model.",
        };
    }
    if (voiceMode && !isVoiceMode(voiceMode)) {
        return {
            kind: "usage",
            line: `video start --voice must be native or voice-first (got "${voiceMode}").`,
        };
    }
    if (showId) {
        return {
            kind: "show",
            opts: {
                showId,
                scriptFile,
                voicePath: flagString(flags, "voice-path"),
                music: musicChoice.music,
                wait: flags["wait"] === true,
                json: flags["json"] === true,
            },
        };
    }
    if (!conceit) {
        return {
            kind: "usage",
            line: "video start needs --conceit <kind>.",
        };
    }
    if (!style) {
        return {
            kind: "usage",
            line: "video start needs --style <look>.",
        };
    }
    const direction = nonBlank(flagString(flags, "direction"));
    const voicePath = nonBlank(flagString(flags, "voice-path"));
    const opts = {
        scriptFile,
        conceit,
        style,
        wait: flags["wait"] === true,
        json: flags["json"] === true,
    };
    if (direction)
        opts.direction = direction;
    if (voicePath)
        opts.voicePath = voicePath;
    if (videoModel)
        opts.videoModel = videoModel;
    if (voiceMode && isVoiceMode(voiceMode))
        opts.voiceMode = voiceMode;
    if (musicChoice.music !== undefined)
        opts.music = musicChoice.music;
    if (!oneShot)
        opts.reviewStoryboard = true;
    if (director)
        opts.director = true;
    if (broll)
        opts.broll = true;
    if (stopAtScript)
        opts.stopAtScript = true;
    if (rewriteToFit)
        opts.rewriteToFit = true;
    if (frameFlag.value || pacingFlag.value) {
        opts.shots = {
            ...(frameFlag.value ? { frame: frameFlag.value } : {}),
            ...(pacingFlag.value ? { pacing: pacingFlag.value } : {}),
        };
    }
    return { kind: "script", opts };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function scriptRunOptionsOf(data) {
    if (!isRecord(data) || !Array.isArray(data.conceits) || !Array.isArray(data.styles)) {
        return null;
    }
    const conceits = [];
    for (const row of data.conceits) {
        if (!isRecord(row) || typeof row.key !== "string" || typeof row.label !== "string")
            return null;
        conceits.push({ key: row.key, label: row.label });
    }
    const styles = [];
    for (const row of data.styles) {
        if (!isRecord(row) || typeof row.slug !== "string" || typeof row.label !== "string")
            return null;
        styles.push({ slug: row.slug, label: row.label });
    }
    return { conceits, styles };
}
function isResolvedCard(value) {
    if (!isRecord(value))
        return false;
    if (!isRecord(value.conceit) || !isRecord(value.style))
        return false;
    if (typeof value.conceit.key !== "string" || typeof value.conceit.label !== "string")
        return false;
    if (typeof value.family !== "string")
        return false;
    if (!("wrapper" in value))
        return false;
    if (value.wrapper !== null && typeof value.wrapper !== "string")
        return false;
    if (typeof value.style.slug !== "string" || typeof value.style.label !== "string")
        return false;
    return true;
}
function startedVideoChoice(value) {
    if (!isRecord(value))
        return null;
    if (typeof value.videoModel !== "string" || typeof value.voiceMode !== "string")
        return null;
    return { videoModel: value.videoModel, voiceMode: value.voiceMode };
}
function stringsOf(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function isCastNote(value) {
    return isRecord(value) && typeof value.name === "string" && typeof value.description === "string";
}
function scriptTidiedOf(value) {
    if (!isRecord(value))
        return null;
    const added = isRecord(value.added) ? value.added : {};
    return {
        setAside: stringsOf(value.setAside),
        added: {
            names: stringsOf(added.names),
            descriptions: Array.isArray(added.descriptions) ? added.descriptions.filter(isCastNote) : [],
        },
    };
}
function scriptTidiedHead(tidied) {
    if (!tidied)
        return [];
    const { setAside } = tidied;
    const { names, descriptions } = tidied.added;
    return [
        "We laid your script out in the format the video needs. " +
            (setAside.length === 0
                ? "Every spoken word is unchanged."
                : "Every spoken line we kept is word for word what you wrote."),
        ...(names.length === 1 ? [`We called the person your script doesn't name ${names[0]}.`] : []),
        ...(names.length > 1 ? [`We called the people your script doesn't name ${joinedAnd(names)}.`] : []),
        ...(descriptions.length > 0
            ? [
                "We added a short note on who each person is. It's never spoken; it only guides the video:",
                ...descriptions.map(({ name, description }) => `  ${name} — ${description}`),
            ]
            : []),
        ...(setAside.length > 0
            ? [
                "We left out these lines because they don't look like part of the ad:",
                ...setAside.map((line) => `  "${line}"`),
            ]
            : []),
        "",
    ];
}
function scriptWrittenHead(written, started) {
    if (written === null)
        return [];
    return [
        started
            ? "Your file described the ad, so we wrote this script from it and started the run on it:"
            : "Your file described the ad, so we wrote this script from it:",
        "",
        ...written.split("\n").map((line) => (line ? `  ${line}` : "")),
        "",
    ];
}
function writtenOf(value) {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}
function scriptRewrittenHead(rewritten, started) {
    if (rewritten === null)
        return [];
    return [
        started
            ? "Your script didn't fit this kind of ad, so we wrote a new one from it and started the run on it:"
            : "Your script didn't fit this kind of ad, so we wrote a new one from it:",
        "",
        ...rewritten.split("\n").map((line) => (line ? `  ${line}` : "")),
        "",
    ];
}
const REWRITE_OFFER = "To have a new script written from yours for this kind of ad, run the same command with --rewrite-to-fit. " +
    "That can change every line and the names.";
function scriptNeedsCallerResult(res, json) {
    const data = res.data;
    if (!isRecord(data) || !isRecord(data.error))
        return null;
    const code = data.error.code;
    const field = code === "SCRIPT_QUESTION" ? "lines" : code === "SCRIPT_TOO_THIN" ? "missing" : null;
    if (field === null)
        return null;
    const message = formatApiError(res);
    if (json) {
        return {
            code: 1,
            lines: [
                JSON.stringify({ ok: false, status: res.status, code, error: message, [field]: stringsOf(data[field]) }),
            ],
        };
    }
    return { code: 1, lines: [message] };
}
function scriptStartRefused(res, json) {
    const data = isRecord(res.data) ? res.data : {};
    const tidied = data.tidied === undefined ? null : scriptTidiedOf(data.tidied);
    const written = writtenOf(data.written);
    const rewritten = writtenOf(data.rewritten);
    const offered = data.rewriteOffered === true;
    if (!tidied && written === null && rewritten === null && !offered)
        return errorResult(res, json);
    const script = typeof data.script === "string" ? data.script : null;
    const error = videoApiError(res);
    return {
        code: 1,
        lines: json
            ? [
                JSON.stringify({
                    ok: false,
                    status: res.status,
                    error,
                    ...(tidied ? { tidied } : {}),
                    ...(written !== null ? { written } : {}),
                    ...(rewritten !== null ? { rewritten } : {}),
                    ...(script !== null ? { script } : {}),
                    ...(offered ? { rewriteOffered: true } : {}),
                }),
            ]
            : [
                ...scriptTidiedHead(tidied),
                ...scriptWrittenHead(written, false),
                ...scriptRewrittenHead(rewritten, false),
                error,
                ...(offered ? [REWRITE_OFFER] : []),
            ],
    };
}
function stoppedAtScriptResult(data, json) {
    const script = typeof data.script === "string" ? data.script : "";
    const tidied = data.tidied === undefined ? null : scriptTidiedOf(data.tidied);
    const written = writtenOf(data.written);
    const rewritten = writtenOf(data.rewritten);
    if (json) {
        return {
            code: 0,
            lines: [
                JSON.stringify({
                    stoppedAtScript: true,
                    script,
                    ...(tidied ? { tidied } : {}),
                    ...(written !== null ? { written } : {}),
                    ...(rewritten !== null ? { rewritten } : {}),
                }),
            ],
        };
    }
    return {
        code: 0,
        lines: [
            ...scriptTidiedHead(tidied),
            rewritten !== null
                ? "Your script didn't fit this kind of ad, so we wrote a new one from it. Nothing has started."
                : written !== null
                    ? "Your file described the ad, so we wrote this script from it. Nothing has started."
                    : "This is the script the run would start on. Nothing has started.",
            "",
            ...script.split("\n").map((line) => (line ? `  ${line}` : "")),
            "",
            "To start it, save it to a file and run the same command with --script <that file> and without --stop-at-script.",
        ],
    };
}
function scriptStartedLines(runId, url, card, video, director) {
    return [
        `Started ad run ${runId}`,
        ...(card
            ? [
                `Conceit: ${card.conceit.label}`,
                `Family: ${card.family}`,
                `Wrapper: ${card.wrapper ?? ""}`,
                `Style: ${card.style.label}`,
            ]
            : ["The server did not include a resolved card."]),
        ...(video ? [`Video model: ${video.videoModel}`, `Voice: ${video.voiceMode}`] : []),
        ...(director ? ["Director: on for this ad"] : []),
        `Watch it: ${url}`,
    ];
}
function waitJsonWith(waited, facts) {
    const first = waited.lines[0];
    if (typeof first !== "string")
        return waited;
    let parsed;
    try {
        parsed = JSON.parse(first);
    }
    catch {
        return waited;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
        return waited;
    return {
        code: waited.code,
        lines: [JSON.stringify({ ...parsed, ...facts })],
    };
}
export async function startScriptFlow(opts, deps) {
    let script;
    try {
        script = deps.readFile(opts.scriptFile);
    }
    catch (e) {
        return {
            code: 1,
            lines: [
                `Can't read the script file "${opts.scriptFile}": ${e instanceof Error ? e.message : String(e)}`,
            ],
        };
    }
    if (script.trim().length === 0) {
        return { code: 1, lines: [`The script file "${opts.scriptFile}" is empty.`] };
    }
    const listed = await deps.get(SCRIPT_RUNS_PATH).catch(() => null);
    if (listed?.ok) {
        const options = scriptRunOptionsOf(listed.data);
        if (!options) {
            return adminOnlyResult("The server's list of kinds and looks could not be read.", opts.json);
        }
        const problem = scriptRunPickProblem(options, opts.conceit, opts.style);
        if (problem) {
            return opts.json ? adminOnlyResult(problem, true) : { code: 1, lines: [problem], usage: true };
        }
    }
    const res = await deps.post(SCRIPT_RUNS_PATH, {
        script,
        conceit: opts.conceit,
        style: opts.style,
        ...(opts.direction ? { direction: opts.direction } : {}),
        ...(opts.voicePath ? { voicePath: opts.voicePath } : {}),
        ...(opts.videoModel ? { videoModel: opts.videoModel } : {}),
        ...(opts.voiceMode ? { voiceMode: opts.voiceMode } : {}),
        ...(opts.music === true ? { music: true } : {}),
        ...(opts.reviewStoryboard ? { reviewStoryboard: true } : {}),
        ...(opts.director ? { director: true } : {}),
        ...(opts.broll ? { broll: true } : {}),
        ...(opts.shots ? { shots: opts.shots } : {}),
        ...(opts.stopAtScript ? { stopAtScript: true } : {}),
        ...(opts.rewriteToFit ? { rewriteToFit: true } : {}),
    });
    if (!res.ok)
        return scriptNeedsCallerResult(res, opts.json) ?? scriptStartRefused(res, opts.json);
    if (isRecord(res.data) && res.data.stoppedAtScript === true) {
        return stoppedAtScriptResult(res.data, opts.json);
    }
    const customerStart = customerAnswer(res.data);
    if (customerStart)
        return customerStartedResult(customerStart, opts, deps);
    const started = res.data;
    if (!started.runId) {
        return { code: 1, lines: ["The server started the ad but did not say which run it is."] };
    }
    const runId = started.runId;
    const url = typeof started.url === "string" ? started.url : "";
    const card = isResolvedCard(started.card) ? started.card : null;
    const video = startedVideoChoice(started.videoChoice);
    const tidied = started.tidied === undefined ? null : scriptTidiedOf(started.tidied);
    const written = writtenOf(started.written);
    const rewritten = writtenOf(started.rewritten);
    const facts = {
        card,
        ...(video ? { videoChoice: video } : {}),
        ...(tidied ? { tidied } : {}),
        ...(written !== null ? { written } : {}),
        ...(rewritten !== null ? { rewritten } : {}),
    };
    const head = [
        ...scriptTidiedHead(tidied),
        ...scriptWrittenHead(written, true),
        ...scriptRewrittenHead(rewritten, true),
    ];
    if (!opts.wait) {
        return {
            code: 0,
            lines: opts.json
                ? [JSON.stringify({ runId, url, ...facts })]
                : [
                    ...head,
                    ...scriptStartedLines(runId, url, card, video, opts.director === true),
                    "",
                    ...(opts.reviewStoryboard
                        ? ["Wait for the storyboard here instead: exodus video start … --wait"]
                        : [
                            "The app approves the storyboard itself if its checks pass. It only stops for you if they find a problem.",
                            "Wait here until it needs you:        exodus video start … --wait",
                        ]),
                    `Or check in whenever:                exodus video status ${runId}`,
                ],
        };
    }
    const waited = await startedThenWait(runId, [...head, ...scriptStartedLines(runId, url, card, video, opts.director === true)], { ...opts, url }, deps);
    return opts.json ? waitJsonWith(waited, facts) : waited;
}
async function customerStartedResult(started, opts, deps) {
    const { runId, dashboardUrl } = started;
    const tidied = started.tidied === undefined ? null : scriptTidiedOf(started.tidied);
    const written = writtenOf(started.written);
    const rewritten = writtenOf(started.rewritten);
    const head = [
        ...scriptTidiedHead(tidied),
        ...scriptWrittenHead(written, true),
        ...scriptRewrittenHead(rewritten, true),
        `Started video ${runId}`,
        `Watch it: ${dashboardUrl}`,
    ];
    if (opts.wait) {
        const waited = await startedThenWait(runId, head, { ...opts, url: dashboardUrl }, deps);
        const facts = {
            ...(tidied ? { tidied } : {}),
            ...(written !== null ? { written } : {}),
            ...(rewritten !== null ? { rewritten } : {}),
        };
        return opts.json && (tidied || written !== null || rewritten !== null) ? waitJsonWith(waited, facts) : waited;
    }
    if (opts.json)
        return { code: 0, lines: [JSON.stringify(started)] };
    return {
        code: 0,
        lines: [
            ...head,
            "",
            opts.reviewStoryboard
                ? "It stops at the storyboard for you to approve."
                : "The app approves the storyboard itself if its checks pass. It only stops for you if they find a problem.",
            `Check in whenever: exodus video status ${runId}`,
        ],
    };
}
const POLL_INTERVAL_MS = 5000;
const MAX_POLLS = 720;
export async function waitFlow(runId, opts, deps) {
    const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
    const maxPolls = opts.maxPolls ?? MAX_POLLS;
    const lines = [];
    let lastProgress = null;
    let redoSeen = false;
    const progress = (line) => {
        if (line === lastProgress)
            return;
        lastProgress = line;
        if (opts.json)
            return;
        if (opts.onProgressLine)
            opts.onProgressLine(line);
        else
            lines.push(line);
    };
    for (let poll = 0; poll < maxPolls; poll++) {
        if (poll > 0)
            await deps.sleep(interval);
        const res = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
        if (!res.ok) {
            const failed = errorResult(res, opts.json);
            return { code: failed.code, lines: [...lines, ...failed.lines] };
        }
        const customer = customerAnswer(res.data);
        if (customer) {
            const page = customerRunPage(deps.dashboardUrl, runId);
            if (customerStageIsWorking(customer.stage)) {
                progress(customerStageLines(customer, page)[0]);
                continue;
            }
            return {
                code: customer.stage === "failed" ? 1 : 0,
                lines: opts.json
                    ? [JSON.stringify(customer)]
                    : [...lines, ...customerStageLines(customer, page), `Watch it on the dashboard: ${page}`],
            };
        }
        const run = asVideoRun(res.data);
        const stop = classifyRun(run);
        if (stop.at === "running") {
            progress(stop.autoRedoScenes?.length
                ? autoRedoLine(stop.autoRedoScenes, stop.autoRedoReasons)
                : `Working: ${stageWord(stop.stage)}…`);
            continue;
        }
        let items = null;
        if (stop.at === "final-watch") {
            const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
            items = itemsRes.ok ? (itemsRes.data.items ?? []) : null;
            if (items === null && redoSeen)
                continue;
            const redoing = items ? scenesBeingRedone(run, items) : [];
            redoSeen = redoing.length > 0;
            if (redoSeen) {
                progress(`Working: redoing scene${redoing.length === 1 ? "" : "s"} ${redoing.join(", ")}…`);
                continue;
            }
        }
        const resolved = resolveStop(stop, items ? hasAttachedCut(items) : null);
        if (opts.json) {
            return {
                code: stop.at === "failed" ? 1 : 0,
                lines: [JSON.stringify({ runId, stop: resolved, status: run.status, url: opts.url })],
            };
        }
        return {
            code: stop.at === "failed" ? 1 : 0,
            lines: [...lines, ...stopLines(resolved, runId, reviewUrl(deps.dashboardUrl, run))],
        };
    }
    const timeoutLine = `Still running after ${Math.round((maxPolls * interval) / 60000)} minutes. Check in with: exodus video status ${runId}`;
    return {
        code: 0,
        lines: opts.json ? [JSON.stringify({ runId, stop: { at: "running" }, timedOut: true })] : [...lines, timeoutLine],
    };
}
const ITEM_STATUS_WORD = {
    done: "done",
    failed: "failed",
    running: "working",
    idle: "waiting",
    skipped: "skipped",
    rejected: "left out",
};
function itemWord(item) {
    if (!item)
        return "—";
    if (item.staleClaim === true)
        return "stopped";
    if (item.flagged === true)
        return "flagged";
    return ITEM_STATUS_WORD[item.status] ?? item.status;
}
const CARRYING_ON_LINE = "Waiting for a worker to carry on. Everything finished so far is kept — the run picks up from there by itself.";
function carryingOn(run) {
    return (run.status === "queued" &&
        run.nodes.some((n) => n.status !== "idle" && n.status !== "out-of-scope"));
}
export async function statusFlow(runId, json, deps) {
    const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!runRes.ok)
        return errorResult(runRes, json);
    const customer = customerAnswer(runRes.data);
    if (customer) {
        return {
            code: 0,
            lines: json ? [JSON.stringify(customer)] : customerStatusLines(customer, deps.dashboardUrl),
        };
    }
    const run = asVideoRun(runRes.data);
    const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!itemsRes.ok)
        return errorResult(itemsRes, json);
    const items = itemsRes.data.items ?? [];
    const hasFinal = hasAttachedCut(items);
    const stop = resolveStop(classifyRun(run), hasFinal);
    const failedStoryboard = failedStoryboardNode(run);
    const guidance = stopLines(stop.at === "failed" && errorEchoesReasons(stop.error, failedStoryboard?.planFailure)
        ? { ...stop, error: undefined }
        : stop, runId, reviewUrl(deps.dashboardUrl, run));
    const warnings = run.nodes
        .filter((n) => n.warning)
        .map((n) => ({ nodeId: n.nodeId, step: n.kind, warning: n.warning }));
    if (json) {
        return {
            code: 0,
            lines: [
                JSON.stringify({
                    runId,
                    status: run.status,
                    stop,
                    items,
                    hasFinal,
                    warnings,
                    guidance,
                    ...(run.musicBed === undefined ? {} : { musicBed: run.musicBed }),
                    ...(failedStoryboard?.planFailure ? { planFailure: failedStoryboard.planFailure } : {}),
                    ...(failedStoryboard?.planFailure
                        ? { storyboardNodeId: failedStoryboard.nodeId }
                        : {}),
                    ...(failedStoryboard?.hasRejectedDraft === true ? { hasRejectedDraft: true } : {}),
                    ...(run.director ? { director: run.director } : {}),
                }),
            ],
        };
    }
    const revoicedByScene = new Set();
    const voiceFirstByScene = new Set();
    const voiceFirstBlockedByScene = new Map();
    const timedOnOriginalVoice = new Set();
    for (const artifact of outputsOfNodeKind(run, "video")) {
        if (artifact.type === "video" &&
            artifact.voiceMode === "voice-first" &&
            typeof artifact.sceneIndex === "number") {
            voiceFirstByScene.add(artifact.sceneIndex);
        }
        if (artifact.type === "video" &&
            artifact.voiceFirstBlockedBy?.length &&
            typeof artifact.sceneIndex === "number") {
            voiceFirstBlockedByScene.set(artifact.sceneIndex, artifact.voiceFirstBlockedBy);
        }
        if (artifact.type === "video" && artifact.revoiced === true && typeof artifact.sceneIndex === "number") {
            revoicedByScene.add(artifact.sceneIndex);
            if ((artifact.words?.length ?? 0) > 0)
                timedOnOriginalVoice.add(artifact.sceneIndex);
        }
    }
    const byScene = new Map();
    const sceneFrameNodeIds = new Set(run.nodes.filter((n) => n.kind === "scene-frames").map((n) => n.nodeId));
    for (const item of items) {
        if (item.itemKind !== "clip" && item.itemKind !== "voiceover" && item.itemKind !== "frame") {
            continue;
        }
        if (!isPullSceneIndex(item.sceneIndex))
            continue;
        if (item.itemKind === "frame" && !sceneFrameNodeIds.has(item.nodeId))
            continue;
        const row = byScene.get(item.sceneIndex) ?? {};
        row[item.itemKind] = item;
        byScene.set(item.sceneIndex, row);
    }
    const headline = stop.at === "failed" && stop.workerStopped
        ? `Ad run ${runId} — Stopped, its worker went quiet`
        : stop.at === "failed" && stop.repair
            ? `Ad run ${runId} — Stopped, a step failed`
            : `Ad run ${runId} — ${displayRunStatus(run.status)}`;
    const lines = [
        headline,
        ...(carryingOn(run) ? [CARRYING_ON_LINE] : []),
        ...guidance,
        ...(stop.at === "running" && run.pauseAhead ? [pauseAheadLine(run.pauseAhead)] : []),
        ...planFailureLines(failedStoryboard, runId),
        ...warnings.map((w) => `Heads-up (${w.step}): ${w.warning}`),
        ...(run.director ? ["", ...directorLines(run.director)] : []),
    ];
    if (byScene.size === 0) {
        lines.push("", "No scenes yet — this run hasn't made anything to look at.");
    }
    else {
        lines.push("", "Scene  Clip      Voice     Picture");
        for (const sceneIndex of [...byScene.keys()].sort((a, b) => a - b)) {
            const row = byScene.get(sceneIndex);
            lines.push(`${String(sceneIndex).padEnd(5)}  ${itemWord(row.clip).padEnd(8)}  ${itemWord(row.voiceover).padEnd(8)}  ${itemWord(row.frame)}`);
            if (row.clip?.lastRedo) {
                lines.push(`       clip: ${redoLine(row.clip.lastRedo)}`);
                const blocked = row.clip.lastRedo.voiceFirstBlockedBy;
                if (blocked?.length) {
                    lines.push(`       clip: asked for voice first, but redone the usual way — ${cantSayNames(blocked)}`);
                }
                printDisplacedHistory(lines, row.clip.lastRedo);
            }
            if (row.clip?.lastRedo || row.clip?.flagged) {
                for (const line of renderQcTakeHistory(clipQcOf(row.clip))) {
                    lines.push(`       ${line}`);
                }
            }
            if (row.voiceover?.lastRedo) {
                lines.push(`       voice: ${redoLine(row.voiceover.lastRedo)}`);
                printDisplacedHistory(lines, row.voiceover.lastRedo);
            }
            if (row.frame?.lastRedo)
                lines.push(`       picture: ${row.frame.lastRedo.label}`);
            for (const finding of row.clip?.findings ?? []) {
                lines.push(`       ${finding.code} (${finding.severity}): ${finding.detail}`);
                const judgeSeverity = finding.judgeSeverity ?? finding.severity;
                if (finding.judgeDetail) {
                    lines.push(`         checker said (${judgeSeverity}): ${finding.judgeDetail}`);
                }
                else if (judgeSeverity !== finding.severity) {
                    lines.push(`         checker rated it ${judgeSeverity}`);
                }
            }
            if (row.clip?.error)
                lines.push(`       ${row.clip.error}`);
            const usedIdea = row.clip?.artifact?.type === "video" ? row.clip.artifact.replannedIdea : undefined;
            if (usedIdea?.framePrompt) {
                lines.push(`       clip: made from a new idea instead of the approved one. It shows: ${withoutLookRider(usedIdea.framePrompt)}`);
            }
            if (revoicedByScene.has(sceneIndex))
                lines.push("       voice: cast voice applied");
            if (voiceFirstByScene.has(sceneIndex))
                lines.push("       clip: redone voice first");
            const blockedBy = voiceFirstBlockedByScene.get(sceneIndex);
            if (blockedBy) {
                lines.push(`       clip: redone the usual way — ${cantSayNames(blockedBy)}`);
            }
            if (timedOnOriginalVoice.has(sceneIndex)) {
                lines.push("       word timings: measured on the original voice (close, not frame-exact)");
            }
            for (const finding of row.frame?.findings ?? []) {
                lines.push(`       picture: ${finding.code} (${finding.severity}): ${finding.detail}`);
            }
        }
        if (outputsOfNodeKind(run, "voiceover").some(isNarrationMaster)) {
            lines.push("Narration  master take");
        }
    }
    if (run.nodes.some((n) => n.kind === "storyboard" && n.status === "done")) {
        lines.push(...(await statusVoiceLines(runId, deps)));
    }
    lines.push("", hasFinal && stop.at === "finished"
        ? "Final cut: approved and delivered."
        : hasFinal
            ? `Final cut: uploaded. Approve it with: exodus video approve ${runId}`
            : "Final cut: not uploaded yet.");
    return { code: 0, lines };
}
const DIRECTOR_STATUS_WORDS = {
    reviewing: "Watching this run",
    waiting: "Waiting for redos to finish",
    done: "Done: ready for your approval",
    stopped: "Stopped: see the last note",
};
const DIRECTOR_PHASE_WORDS = {
    storyboard: "Storyboard",
    "final-watch": "Final watch",
};
const DIRECTOR_LOG_LINES = 3;
export function directorLines(director) {
    const switchWords = director.runSetting === null
        ? `following the brand's setting (${director.workspaceOn ? "on" : "off"})`
        : "switched for this ad";
    const log = director.log.slice(-DIRECTOR_LOG_LINES);
    return [
        `Director: ${director.on ? "on" : "off"}, ${switchWords}`,
        ...(director.on
            ? [`  ${DIRECTOR_STATUS_WORDS[director.status ?? "reviewing"]}`]
            : []),
        `  Redos: ${director.redosUsed} of ${director.redoCap}. Spent: $${director.spendUsd.toFixed(2)} of $${director.spendCapUsd.toFixed(2)}`,
        ...(log.length > 0
            ? [
                "  Latest notes:",
                ...log.map((entry) => `    ${DIRECTOR_PHASE_WORDS[entry.phase]}: ${entry.text}`),
            ]
            : []),
    ];
}
export function parseDirectorSwitch(word) {
    if (word === "on")
        return { on: true };
    if (word === "off")
        return { on: false };
    if (word === "follow")
        return { on: null };
    return null;
}
export async function directorFlow(runId, on, json, deps) {
    const res = await deps.post(DIRECTOR_PATH, { runId, on });
    const behind = missingRouteLine(res, "exodus video director");
    if (behind) {
        return {
            code: 1,
            lines: json ? [JSON.stringify({ ok: false, status: 404, error: behind })] : [behind],
        };
    }
    if (!res.ok)
        return errorResult(res, json);
    if (json)
        return { code: 0, lines: [JSON.stringify({ runId, on })] };
    const said = on === null
        ? `The director on ad run ${runId} now follows the brand's own setting.`
        : `The director is ${on ? "on" : "off"} for ad run ${runId}.`;
    return {
        code: 0,
        lines: [
            said,
            ...(on === true
                ? ["If the ad is already waiting at the storyboard or the final watch, a review starts now."]
                : []),
            `See what it is doing: exodus video status ${runId}`,
        ],
    };
}
export async function rejectedDraftFlow(runId, json, deps) {
    const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!runRes.ok)
        return errorResult(runRes, json);
    if (customerAnswer(runRes.data)) {
        return adminOnlyResult("exodus video status --rejected-draft is for admins.", json);
    }
    const node = failedStoryboardNode(asVideoRun(runRes.data));
    if (!node) {
        const note = "The storyboard on this run didn't fail, so there is no rejected draft to read.";
        return {
            code: 0,
            lines: json ? [JSON.stringify({ runId, nodeId: null, draft: null })] : [note],
        };
    }
    const res = await deps.get(`${REJECTED_DRAFT_PATH}?runId=${encodeURIComponent(runId)}&nodeId=${encodeURIComponent(node.nodeId)}`);
    if (missingRouteLine(res, "exodus video status --rejected-draft")) {
        return {
            code: 1,
            lines: json
                ? [JSON.stringify({ ok: false, status: 404, error: REJECTED_DRAFT_NOT_ON_THIS_SERVER })]
                : [REJECTED_DRAFT_NOT_ON_THIS_SERVER],
        };
    }
    if (!res.ok)
        return errorResult(res, json);
    const draft = res.data.draft ?? null;
    if (json)
        return { code: 0, lines: [JSON.stringify({ runId, nodeId: node.nodeId, draft })] };
    if (!draft)
        return { code: 0, lines: ["No rejected draft was kept for this attempt."] };
    return {
        code: 0,
        lines: [
            `REJECTED DRAFT — ad run ${runId}, step ${node.nodeId}`,
            "The system turned this draft down and threw it away. It is kept only as a record of what happened.",
            "Nothing in it is part of your ad. There is nothing here to act on or edit.",
            "",
            ...draft.split("\n"),
        ],
    };
}
export async function storyboardFlow(runId, json, deps) {
    const res = await deps.get(`${STORYBOARD_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!res.ok)
        return errorResult(res, json);
    const board = customerAnswer(res.data);
    if (board) {
        return { code: 0, lines: json ? [JSON.stringify(board)] : customerStoryboardLines(board) };
    }
    const cards = res.data;
    if (json)
        return { code: 0, lines: [JSON.stringify(cards)] };
    if (!cards.ready) {
        return {
            code: 0,
            lines: [
                "No storyboard yet — this run hasn't written one.",
                `Check where it is: exodus video status ${runId}`,
            ],
        };
    }
    const lines = [cards.title ? `Storyboard — ${cards.title}` : "Storyboard"];
    for (const warning of cards.warnings ?? [])
        lines.push(`Heads-up: ${warning}`);
    const blocks = cards.blocks ?? [];
    for (const block of blocks) {
        const label = block.family ? `${block.family} block` : `block ${block.blockId}`;
        lines.push("", block.pass === false ? `${label} — needs a look` : label);
        for (const warning of block.warnings ?? [])
            lines.push(`  Heads-up: ${warning}`);
        for (const scene of block.scenes ?? [])
            lines.push(...sceneCardLines(scene));
    }
    const loose = cards.looseScenes ?? [];
    if (loose.length > 0) {
        lines.push("", "Scenes outside any block");
        for (const scene of loose)
            lines.push(...sceneCardLines(scene));
    }
    const voiceRes = await deps
        .get(`${VOICES_PATH}?runId=${encodeURIComponent(runId)}`)
        .catch(() => null);
    if (voiceRes?.ok) {
        const sheet = (voiceRes.data ?? {});
        const cast = Array.isArray(sheet.cast) ? sheet.cast : [];
        const canChange = sheet.canChange !== false;
        if (canChange || cast.some((row) => row.voice !== null)) {
            const summary = voiceSummaryLines(cast, Array.isArray(sheet.notices) ? sheet.notices : []);
            if (summary.length > 0) {
                lines.push("", ...summary);
                if (canChange) {
                    lines.push(`set voices with: exodus video voices ${runId} --set <character>=<voice name or ID>`);
                }
            }
        }
    }
    const runRes = await deps
        .get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`)
        .catch(() => null);
    const showAd = runRes?.ok === true && isShowAd(asVideoRun(runRes.data));
    lines.push("", `approve with: exodus video approve ${runId}`);
    if (showAd) {
        lines.push(`send it back: exodus video flag ${runId} --note "what's wrong"`);
    }
    if (cards.framesNodeId) {
        lines.push(`redo one frame: exodus video retry-frame ${runId} --node ${cards.framesNodeId} --scene <n>`);
    }
    if (cards.broll === true) {
        lines.push(`change the B-roll shots: exodus video broll ${runId}`);
    }
    return { code: 0, lines };
}
function sceneCardLines(scene) {
    const head = [
        `  Scene ${scene.sceneIndex}`,
        scene.kind ? `(${scene.kind})` : "",
        typeof scene.durationSec === "number" ? `${scene.durationSec}s` : "",
    ]
        .filter(Boolean)
        .join(" ");
    const lines = [head];
    for (const turn of scene.dialogue ?? []) {
        if (!turn.line)
            continue;
        lines.push(turn.speaker ? `    ${turn.speaker}: ${turn.line}` : `    ${turn.line}`);
    }
    if (!scene.dialogue?.length && scene.voText)
        lines.push(`    "${scene.voText}"`);
    if (scene.frame?.imageUrl)
        lines.push(`    picture: ${scene.frame.imageUrl}`);
    else if (scene.frame?.status)
        lines.push(`    picture: ${scene.frame.status}`);
    return lines;
}
export async function approveFlow(runId, opts, deps) {
    const res = await deps.post(APPROVE_PATH, {
        runId,
        ...(opts.approveStaleCut ? { approveStaleCut: true } : {}),
    });
    if (!res.ok) {
        const refusal = errorResult(res, opts.json);
        const staleCut = !opts.json && videoApiError(res).includes("approve this cut anyway");
        return staleCut
            ? {
                ...refusal,
                lines: [
                    ...refusal.lines,
                    `To deliver it anyway: exodus video approve ${runId} --approve-stale-cut`,
                ],
            }
            : refusal;
    }
    const data = res.data;
    const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
    if (opts.json) {
        return { code: 0, lines: [JSON.stringify({ ok: true, runId, warnings, data: res.data })] };
    }
    const voices = data?.voices;
    const summary = voices
        ? voiceSummaryLines(Array.isArray(voices.cast) ? voices.cast : [], Array.isArray(voices.notices) ? voices.notices : [])
        : [];
    return {
        code: 0,
        lines: [
            "Approved.",
            ...warnings,
            ...(summary.length > 0 ? ["", ...summary, ""] : []),
            `See what happens next: exodus video status ${runId}`,
        ],
    };
}
export async function flagFlow(runId, note, json, deps) {
    const res = await deps.post(FLAG_PATH, { runId, note });
    if (!res.ok)
        return errorResult(res, json);
    const data = res.data;
    if (json)
        return { code: 0, lines: [JSON.stringify({ ok: true, runId, ...data })] };
    return {
        code: 0,
        lines: [
            "Sent back with your note.",
            data.strategistLooking
                ? "Someone is rewriting the storyboard now."
                : "Nobody is rewriting it yet — the note is on the run.",
            `Check back with: exodus video storyboard ${runId}`,
        ],
    };
}
export async function retryFrameFlow(runId, nodeId, sceneIndex, note, json, deps) {
    if (nodeId === undefined) {
        const board = await deps.get(`${STORYBOARD_PATH}?runId=${encodeURIComponent(runId)}`);
        if (!board.ok)
            return errorResult(board, json);
        if (!customerAnswer(board.data)) {
            return { code: 1, lines: ["video retry-frame needs --node <nodeId>."] };
        }
    }
    const res = await deps.post(SCENE_RETRY_PATH, {
        runId,
        ...(nodeId === undefined ? {} : { nodeId }),
        sceneIndex,
        ...(note ? { note } : {}),
    });
    if (!res.ok)
        return errorResult(res, json);
    if (customerAnswer(res.data)) {
        if (json)
            return { code: 0, lines: [JSON.stringify({ ok: true, runId, sceneIndex })] };
        return {
            code: 0,
            lines: [
                `Redrawing scene ${sceneIndex}'s picture. The other scenes stay as they are.`,
                ...(note ? ["Your note isn't used on this redo."] : []),
                `See it when it's done: exodus video storyboard ${runId}`,
            ],
        };
    }
    const triggerRunId = res.data.triggerRunId;
    if (json) {
        return {
            code: 0,
            lines: [
                JSON.stringify({
                    ok: true,
                    runId,
                    nodeId,
                    sceneIndex,
                    triggerRunId,
                    ...(note ? { note } : {}),
                }),
            ],
        };
    }
    return {
        code: 0,
        lines: [
            `Redoing scene ${sceneIndex} on ${nodeId}.`,
            `triggerRunId: ${triggerRunId ?? "-"}`,
            "Neighbours stay. The pixel gate holds.",
        ],
    };
}
export const BROLL_EDIT_STALE_MS = 10 * 60 * 1000;
const BROLL_OPS = ["add", "move", "remove"];
export function planBrollCommand(rest, flags) {
    const op = BROLL_OPS.find((o) => o === rest[0]);
    if (!op) {
        if (!rest[0])
            return { kind: "usage", line: "video broll needs a run id: exodus video broll <runId>" };
        return { kind: "list", runId: rest[0] };
    }
    const runId = rest[1];
    if (!runId) {
        return { kind: "usage", line: `video broll ${op} needs a run id: exodus video broll ${op} <runId>` };
    }
    const lineId = nonBlank(flagString(flags, "line"))?.trim();
    const note = nonBlank(flagString(flags, "note"))?.trim();
    const sceneRaw = flagString(flags, "scene");
    const sceneIndex = sceneRaw === undefined ? undefined : Number(sceneRaw);
    if (sceneIndex !== undefined && !(Number.isInteger(sceneIndex) && sceneIndex >= 1)) {
        return { kind: "usage", line: `video broll ${op} --scene must be a scene number, not "${sceneRaw}".` };
    }
    const withNote = note ? { note } : {};
    if (op === "add") {
        if (!lineId) {
            return { kind: "usage", line: "video broll add needs --line <id>, the script line the shot goes on." };
        }
        return { kind: "edit", runId, edit: { op, lineId, ...withNote } };
    }
    if (sceneIndex === undefined) {
        return {
            kind: "usage",
            line: `video broll ${op} needs --scene <n>, the B-roll shot to ${op}.`,
        };
    }
    if (op === "remove") {
        if (note)
            return { kind: "usage", line: "video broll remove takes no --note." };
        return { kind: "edit", runId, edit: { op, sceneIndex } };
    }
    if (!lineId) {
        return { kind: "usage", line: "video broll move needs --line <id>, the script line to move the shot to." };
    }
    return { kind: "edit", runId, edit: { op, sceneIndex, lineId, ...withNote } };
}
function seconds(value) {
    return `${Number(value.toFixed(1))}s`;
}
function brollEditLines(edit, now) {
    if (!edit || edit.landed)
        return [];
    const asked = edit.op === "move"
        ? `moving B-roll scene ${edit.sceneIndex} to line ${edit.lineId}`
        : `a new B-roll shot on line ${edit.lineId}`;
    if (edit.error !== undefined) {
        return [`The last B-roll change (${asked}) didn't work: ${edit.error}`];
    }
    if (now - edit.requestedAt >= BROLL_EDIT_STALE_MS) {
        return [`The last B-roll change (${asked}) never finished. You can ask for it again.`];
    }
    return [`Planning now: ${asked}. Then the storyboard pictures it changes are redrawn.`, BROLL_WAIT];
}
const BROLL_WAIT = "Wait for it to finish before you change another shot or approve the storyboard.";
export async function brollFlow(runId, json, deps) {
    const res = await deps.get(`${STORYBOARD_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!res.ok)
        return errorResult(res, json);
    if (customerAnswer(res.data)) {
        return adminOnlyResult("Changing the B-roll from the CLI isn't open to this key.", json);
    }
    const gate = res.data;
    if (gate.broll !== true) {
        if (json)
            return { code: 0, lines: [JSON.stringify({ runId, broll: false })] };
        return { code: 0, lines: ["This video was made without B-roll, so there are no B-roll shots to change."] };
    }
    const shots = gate.brollShots ?? [];
    const scriptLines = gate.scriptLines ?? [];
    const edit = gate.brollEdit ?? null;
    const now = deps.now();
    const planning = !!edit && edit.error === undefined && !edit.landed && now - edit.requestedAt < BROLL_EDIT_STALE_MS;
    if (json) {
        return {
            code: 0,
            lines: [JSON.stringify({ runId, broll: true, planning, brollEdit: edit, brollShots: shots, scriptLines })],
        };
    }
    if (scriptLines.length === 0) {
        return {
            code: 0,
            lines: [
                "The storyboard isn't finished yet, so there are no B-roll shots to change yet.",
                `Check where it is: exodus video status ${runId}`,
            ],
        };
    }
    const lines = brollEditLines(edit, now);
    if (lines.length > 0)
        lines.push("");
    lines.push("B-roll shots");
    if (shots.length === 0)
        lines.push("  None yet.");
    for (const shot of shots) {
        lines.push(`  Scene ${shot.sceneIndex}, on line ${shot.lineId}, ${seconds(shot.plannedSec)}: "${shot.covers}"`);
    }
    lines.push("", "Script lines (pick one by its id)");
    for (const line of scriptLines) {
        lines.push(`  ${line.lineId}  ${line.speakerId ?? "narrator"}: ${line.text}`);
    }
    lines.push("");
    if (planning) {
        lines.push(`Check again: exodus video broll ${runId}`);
    }
    else {
        lines.push(`Add a shot:    exodus video broll add ${runId} --line <id> --note "what it shows"`, `Move a shot:   exodus video broll move ${runId} --scene <n> --line <id>`, `Remove a shot: exodus video broll remove ${runId} --scene <n>`);
    }
    return { code: 0, lines };
}
export async function brollEditFlow(runId, edit, json, deps) {
    const res = await deps.post(BROLL_PATH, { runId, ...edit });
    if (!res.ok)
        return errorResult(res, json);
    const said = edit.op === "remove"
        ? `B-roll scene ${edit.sceneIndex} is gone. The storyboard pictures it changes are being redrawn.`
        : `${edit.op === "add"
            ? `Planning a B-roll shot on line ${edit.lineId}.`
            : `Moving B-roll scene ${edit.sceneIndex} to line ${edit.lineId}.`} Then the storyboard pictures it changes are redrawn.`;
    if (json) {
        return { code: 0, lines: [JSON.stringify({ runId, ...res.data, message: `${said} ${BROLL_WAIT}` })] };
    }
    return {
        code: 0,
        lines: [
            said,
            BROLL_WAIT,
            `Check on it: exodus video broll ${runId}`,
            `See the pictures: exodus video storyboard ${runId}`,
        ],
    };
}
const UPLOADED_CUT_WARNING = "The cut you already uploaded will not include the new clip. If this redo replaces the clip, " +
    "exodus video approve stops until you pull the pieces again, re-cut and upload again, " +
    "or pass --approve-stale-cut to deliver the cut you uploaded as it is.";
export function planClipRedo(run, items, target) {
    const stop = classifyRun(run);
    const found = findClipRow(run, items, target);
    if ("reason" in found)
        return { ok: false, reason: found.reason };
    const { row, uploadedCut } = found;
    const redoable = row.status === "failed" ||
        row.staleClaim === true ||
        (row.status === "done" &&
            (row.flagged === true ||
                stop.at === "final-watch" ||
                (stop.at === "running" && stop.autoRedoScenes !== undefined)));
    if (!redoable) {
        if (row.status === "done") {
            return {
                ok: false,
                reason: `Scene ${target.sceneIndex}'s clip is finished and nothing flagged it. A finished clip ` +
                    "can only be redone while the run is waiting for the final cut.",
            };
        }
        const word = ITEM_STATUS_WORD[row.status] ?? row.status;
        return {
            ok: false,
            reason: `Scene ${target.sceneIndex}'s clip is ${word}, so there is nothing to redo yet.`,
        };
    }
    return {
        ok: true,
        nodeId: row.nodeId,
        sceneIndex: target.sceneIndex,
        attempt: row.attempt ?? 0,
        warnings: uploadedCut ? [UPLOADED_CUT_WARNING] : [],
    };
}
function findClipRow(run, items, target) {
    const uploadedCut = hasAttachedCut(items);
    const rows = items.filter((i) => i.itemKind === "clip" &&
        i.sceneIndex === target.sceneIndex &&
        (target.nodeId === undefined || i.nodeId === target.nodeId));
    if (rows.length === 0) {
        return { reason: `Scene ${target.sceneIndex} has no clip to redo.` };
    }
    const nodeIds = [...new Set(rows.map((r) => r.nodeId))];
    if (nodeIds.length > 1) {
        return {
            reason: `Scene ${target.sceneIndex} has a clip on more than one step (${nodeIds.join(", ")}), ` +
                "so say which one: --node <nodeId>.",
        };
    }
    const row = rows[0];
    const node = run.nodes.find((n) => n.nodeId === row.nodeId);
    if (node?.status === "running") {
        return {
            reason: `The "${row.nodeId}" step is still making other scenes. Try again once it has finished ` +
                `(exodus video status ${run._id}).`,
        };
    }
    if (node && node.status !== "done") {
        return {
            reason: `The "${row.nodeId}" step did not finish (it is "${node.status}"), ` +
                "and one clip can only be redone on a step that finished.",
        };
    }
    if (row.status === "running" && row.staleClaim !== true) {
        return { reason: `Scene ${target.sceneIndex} is already being redone.` };
    }
    return { row, uploadedCut };
}
export async function retryClipFlow(runId, target, { note, voiceFirst = false }, json, deps) {
    const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!runRes.ok)
        return errorResult(runRes, json);
    if (customerAnswer(runRes.data)) {
        return adminOnlyResult("Redoing a finished clip is for admins. To redo a scene's picture while your storyboard " +
            `waits for you: exodus video retry-frame ${runId} --scene <n>`, json);
    }
    const run = asVideoRun(runRes.data);
    const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!itemsRes.ok)
        return errorResult(itemsRes, json);
    const items = itemsRes.data.items ?? [];
    const plan = planClipRedo(run, items, target);
    if (!plan.ok) {
        return {
            code: 1,
            lines: json ? [JSON.stringify({ ok: false, error: plan.reason })] : [plan.reason],
        };
    }
    const res = await deps.post(voiceFirst ? SCENE_VOICE_FIRST_PATH : SCENE_RETRY_PATH, {
        runId,
        nodeId: plan.nodeId,
        sceneIndex: plan.sceneIndex,
        ...(note ? { note } : {}),
    });
    if (voiceFirst && missingRouteLine(res, "exodus video retry-clip --voice-first")) {
        return {
            code: 1,
            lines: json
                ? [JSON.stringify({ ok: false, status: 404, error: VOICE_FIRST_NOT_ON_THIS_SERVER })]
                : [VOICE_FIRST_NOT_ON_THIS_SERVER],
        };
    }
    if (!res.ok)
        return errorResult(res, json);
    const triggerRunId = res.data.triggerRunId;
    const review = reviewUrl(deps.dashboardUrl, run);
    if (json) {
        return {
            code: 0,
            lines: [
                JSON.stringify({
                    ok: true,
                    runId,
                    nodeId: plan.nodeId,
                    sceneIndex: plan.sceneIndex,
                    triggerRunId,
                    attemptBefore: plan.attempt,
                    reviewUrl: review,
                    warnings: plan.warnings,
                    ...(note ? { note } : {}),
                    ...(voiceFirst ? { voiceMode: "voice-first" } : {}),
                }),
            ],
        };
    }
    return {
        code: 0,
        lines: [
            voiceFirst
                ? `Redoing scene ${plan.sceneIndex}'s clip on ${plan.nodeId}, voice first: the line is ` +
                    "recorded in the character's own voice, then the clip is made to match it. " +
                    "If the line has a made-up name the recorded voice can't say, the clip may be made " +
                    `the usual way instead, and exodus video status ${runId} will say so.`
                : `Redoing scene ${plan.sceneIndex}'s clip on ${plan.nodeId}.`,
            `triggerRunId: ${triggerRunId ?? "-"}`,
            ...(voiceFirst
                ? [
                    "Every other scene stays as it is, and so do the pictures and the script.",
                    "A speaking character with no voice yet gets one picked and saved for the whole run.",
                ]
                : ["Every other scene stays as it is, and so do the pictures, the voices and the script."]),
            ...(note
                ? ["Your note steers how this clip moves. It never changes the words that are spoken."]
                : []),
            `Watch it land: exodus video status ${runId}`,
            `Review the run: ${review}`,
            ...plan.warnings,
        ],
    };
}
function clipIsStillRaw(item) {
    const a = item.artifact;
    return ((item.status === "done" || item.staleClaim === true) &&
        a?.type === "video" &&
        a.revoiced !== true &&
        a.speechTrimmed !== true &&
        a.tailTrimmed !== true);
}
const VOICE_NOT_CHANGED_CODES = new Set(["voice-unpinned", "voice-not-applied"]);
export const VOICE_PATHS_NEVER_HEARD = new Set(["native-prompt", "omni-audio-ids", "gemini-direct"]);
async function neverHeardRunLine(runId, deps) {
    const res = await deps
        .get(`${VOICES_PATH}?runId=${encodeURIComponent(runId)}`)
        .catch(() => null);
    if (!res?.ok)
        return null;
    const path = res.data?.treatment?.path;
    if (typeof path !== "string" || !VOICE_PATHS_NEVER_HEARD.has(path))
        return null;
    return (`This run's clips are not voiced by ElevenLabs — the "${path}" way settles each voice as ` +
        "the clip is rendered — so no clip on this run has a voice pass to redo. Nothing was queued " +
        "and nothing was spent. To make a clip again from scratch, redo the clip instead.");
}
export function planClipRevoice(run, items, target) {
    const found = findClipRow(run, items, target);
    if ("reason" in found)
        return { ok: false, reason: found.reason };
    const { row, uploadedCut } = found;
    const remake = `To make the clip again from scratch: exodus video retry-clip ${run._id} --scene ${target.sceneIndex}`;
    if ((row.status !== "done" && row.staleClaim !== true) || row.artifact?.type !== "video") {
        return {
            ok: false,
            reason: `Scene ${target.sceneIndex} has no finished clip, so there is no voice to redo. ${remake}`,
        };
    }
    if (!clipIsStillRaw(row)) {
        return {
            ok: false,
            reason: `Scene ${target.sceneIndex}'s clip has already been through the voice pass, ` +
                `so it cannot go through it again. ${remake}`,
        };
    }
    return {
        ok: true,
        nodeId: row.nodeId,
        sceneIndex: target.sceneIndex,
        attempt: row.attempt ?? 0,
        warnings: uploadedCut ? [UPLOADED_CUT_WARNING] : [],
    };
}
function sceneListWords(sceneIndexes) {
    if (sceneIndexes.length === 1)
        return `Scene ${sceneIndexes[0]}`;
    return `Scenes ${sceneIndexes.slice(0, -1).join(", ")} and ${sceneIndexes[sceneIndexes.length - 1]}`;
}
export async function revoiceFlow(runId, target, json, deps) {
    const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!runRes.ok)
        return errorResult(runRes, json);
    if (customerAnswer(runRes.data)) {
        return adminOnlyResult("exodus video revoice is for admins.", json);
    }
    const run = asVideoRun(runRes.data);
    const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!itemsRes.ok)
        return errorResult(itemsRes, json);
    const items = itemsRes.data.items ?? [];
    const targets = "all" in target
        ? items
            .filter((i) => i.itemKind === "clip" &&
            clipIsStillRaw(i) &&
            (i.findings ?? []).some((f) => VOICE_NOT_CHANGED_CODES.has(f.code)))
            .sort((a, b) => a.sceneIndex - b.sceneIndex)
            .map((i) => ({ sceneIndex: i.sceneIndex, nodeId: i.nodeId }))
        : [target];
    if (targets.length === 0) {
        const note = (await neverHeardRunLine(runId, deps)) ??
            "No clip on this run is waiting for a voice pass, so nothing was started.";
        return {
            code: 0,
            lines: json ? [JSON.stringify({ ok: true, runId, scenes: [], note })] : [note],
        };
    }
    const scenes = [];
    const warnings = new Set();
    for (const one of targets) {
        const plan = planClipRevoice(run, items, one);
        if (!plan.ok) {
            scenes.push({ sceneIndex: one.sceneIndex, nodeId: one.nodeId, ok: false, error: plan.reason });
            continue;
        }
        const res = await deps.post(SCENE_REVOICE_PATH, {
            runId,
            nodeId: plan.nodeId,
            sceneIndex: plan.sceneIndex,
        });
        if (missingRouteLine(res, "exodus video revoice")) {
            return {
                code: 1,
                lines: json
                    ? [JSON.stringify({ ok: false, status: 404, error: REVOICE_NOT_ON_THIS_SERVER })]
                    : [REVOICE_NOT_ON_THIS_SERVER],
            };
        }
        if (res.ok) {
            plan.warnings.forEach((w) => warnings.add(w));
            scenes.push({
                sceneIndex: plan.sceneIndex,
                nodeId: plan.nodeId,
                ok: true,
                triggerRunId: res.data.triggerRunId,
            });
            continue;
        }
        scenes.push({
            sceneIndex: plan.sceneIndex,
            nodeId: plan.nodeId,
            ok: false,
            error: videoApiError(res),
        });
    }
    const queued = scenes.filter((r) => r.ok).length;
    const code = scenes.every((r) => r.ok) ? 0 : 1;
    const review = reviewUrl(deps.dashboardUrl, run);
    if (json) {
        return {
            code,
            lines: [
                JSON.stringify({
                    ok: code === 0,
                    runId,
                    scenes,
                    reviewUrl: review,
                    warnings: [...warnings],
                }),
            ],
        };
    }
    const refusedWith = new Map();
    for (const r of scenes) {
        if (!r.ok)
            refusedWith.set(r.error, [...(refusedWith.get(r.error) ?? []), r.sceneIndex]);
    }
    const sceneLines = scenes.flatMap((r) => {
        if (r.ok) {
            return [
                `Scene ${r.sceneIndex}: redoing the voice on ${r.nodeId}. triggerRunId: ${r.triggerRunId ?? "-"}`,
            ];
        }
        const sharing = refusedWith.get(r.error) ?? [];
        if (sharing[0] !== r.sceneIndex)
            return [];
        return [`${sceneListWords(sharing)}: not started. ${r.error}`];
    });
    if (queued === 0)
        return { code, lines: sceneLines };
    return {
        code,
        lines: [
            ...sceneLines,
            "The picture in each clip stays exactly as it is. No new video is made.",
            "The words are checked against the script, the clip is trimmed to the speech, and the chosen voice is applied. ElevenLabs bills that to your own key.",
            "If the voice pass cannot finish on a clip, that clip is kept as it was.",
            `Watch them land: exodus video status ${runId}`,
            `Review the run: ${review}`,
            ...warnings,
        ],
    };
}
export function parseVoiceFlags(occurrences, readFile) {
    const fromFile = {};
    const typed = {};
    let asked = false;
    const valueFor = (occurrence) => {
        if (occurrence.value === undefined)
            throw new Error(`--${occurrence.flag} needs a value.`);
        return occurrence.value;
    };
    for (const occurrence of occurrences) {
        if (occurrence.flag === "set") {
            const raw = valueFor(occurrence);
            const eq = raw.lastIndexOf("=");
            if (eq <= 0 || eq === raw.length - 1) {
                throw new Error("--set must look like <character>=<voice>, where the voice is a catalog voice's name " +
                    `or an ElevenLabs voice ID, for example --set C1=George (got "${raw}").`);
            }
            typed[raw.slice(0, eq).trim()] = raw.slice(eq + 1).trim();
            asked = true;
        }
        else if (occurrence.flag === "clear") {
            const raw = valueFor(occurrence);
            if (!raw.trim())
                throw new Error("--clear needs a character, for example --clear C1.");
            typed[raw.trim()] = null;
            asked = true;
        }
        else if (occurrence.flag === "from") {
            const file = valueFor(occurrence);
            let parsed;
            try {
                parsed = JSON.parse(readFile(file));
            }
            catch {
                throw new Error(`Could not read ${file} as a list of characters and voice IDs.`);
            }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error(`Could not read ${file} as a list of characters and voice IDs.`);
            }
            Object.assign(fromFile, parsed);
            asked = true;
        }
    }
    if (!asked)
        return null;
    const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const merged = {};
    for (const [who, choice] of Object.entries(fromFile)) {
        if (!Object.keys(typed).some((t) => sameName(t, who)))
            merged[who] = choice;
    }
    return { ...merged, ...typed };
}
function catalogLines(catalog) {
    const width = (pick) => Math.max(0, ...catalog.map((voice) => pick(voice).length));
    const nameWidth = width((voice) => voice.name);
    const genderWidth = width((voice) => voice.gender);
    const ageWidth = width((voice) => voice.age);
    const accentWidth = width((voice) => voice.accent);
    return [
        "Voices you can pick by name (ElevenLabs voices every account has)",
        ...catalog.map((voice) => {
            const qualities = [...voice.qualities, ...(voice.characterVoice ? ["character voice"] : [])];
            return (`  ${voice.name.padEnd(nameWidth)}  ${voice.gender.padEnd(genderWidth)}  ` +
                `${voice.age.padEnd(ageWidth)}  ${voice.accent.padEnd(accentWidth)}  ${qualities.join(", ")}`).trimEnd();
        }),
    ];
}
function catalogPickLines(cast) {
    const lines = [];
    for (const row of cast) {
        if (!row.catalogPicks || row.catalogPicks.length === 0)
            continue;
        const width = Math.max(...row.catalogPicks.map((pick) => pick.name.length));
        lines.push("", `Best fits for ${row.name} (${row.characterId})`);
        for (const pick of row.catalogPicks) {
            lines.push(`  ${pick.name.padEnd(width)}${pick.fit ? `  ${pick.fit.note}` : ""}`.trimEnd());
        }
    }
    return lines;
}
export async function voiceCatalogFlow(runId, json, deps) {
    const query = runId ? `runId=${encodeURIComponent(runId)}&check=none&catalog=1` : "catalog=1";
    const res = await deps.get(`${VOICES_PATH}?${query}`);
    if (!res.ok)
        return errorResult(res, json);
    const data = (res.data ?? {});
    if (!Array.isArray(data.catalog)) {
        return { code: 1, lines: ["This server can't list the voice catalog yet. Voice IDs still work with --set."] };
    }
    if (json)
        return { code: 0, lines: [JSON.stringify({ ok: true, ...data })] };
    const cast = Array.isArray(data.cast) ? data.cast : [];
    const set = runId ? `exodus video voices ${runId}` : "exodus video voices <runId>";
    return {
        code: 0,
        lines: [
            ...catalogLines(data.catalog),
            ...catalogPickLines(cast),
            "",
            `Pick one by name: ${set} --set <character>=<Name>`,
        ],
    };
}
export async function voicesFlow(runId, voices, json, deps) {
    const res = voices
        ? await deps.post(VOICES_PATH, { runId, voices })
        : await deps.get(`${VOICES_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!res.ok)
        return errorResult(res, json);
    const customer = customerAnswer(res.data);
    if (customer) {
        return { code: 0, lines: json ? [JSON.stringify(customer)] : customerVoicesLines(customer) };
    }
    const sheet = res.data;
    if (json)
        return { code: 0, lines: [JSON.stringify({ ok: true, ...sheet })] };
    return { code: 0, lines: voiceSheetLines(sheet) };
}
function availabilityWords(row) {
    if (!row.voice)
        return row.description ? "voice written below" : "no voice yet";
    switch (row.availability?.state) {
        case "available":
            return "ElevenLabs has it";
        case "missing":
            return "ElevenLabs does not have it";
        case "not-checked":
            return "not checked just now";
        default:
            return "not checked";
    }
}
function voiceWords(row) {
    const voice = row.voice;
    if (!voice)
        return "—";
    const words = voice.label ? `${voice.label} (${voice.voiceId})` : voice.voiceId;
    if (row.voiceFrom === "run-default")
        return `${words}, the run's default voice`;
    if (row.voiceFrom === "planner-pick")
        return `${words}, picked by the planner`;
    return words;
}
function fitWords(row) {
    return row.fit ? `  — ${row.fit.note}` : "";
}
export const VOICE_CLASH_HINT = 'To choose a voice yourself, write "voice: <Name>" on that character\'s CAST line in the script, ' +
    "or launch with --review-storyboard and change it at the storyboard stop.";
async function statusVoiceLines(runId, deps) {
    const res = await deps
        .get(`${VOICES_PATH}?runId=${encodeURIComponent(runId)}&check=none`)
        .catch(() => null);
    if (!res?.ok)
        return [];
    const sheet = (res.data ?? {});
    const cast = Array.isArray(sheet.cast) ? sheet.cast : [];
    const summary = voiceSummaryLines(cast, []);
    if (summary.length === 0)
        return [];
    const clash = cast.some((row) => row.fit?.clash === true);
    return ["", ...summary, ...(clash ? [VOICE_CLASH_HINT] : [])];
}
function voiceSummaryLines(cast, notices) {
    const rows = cast.filter((row) => row.spokenScenes > 0 || row.voice !== null);
    const width = Math.max(0, ...rows.map((row) => row.name.length));
    const lines = rows.length > 0 ? ["Voices"] : [];
    for (const row of rows) {
        lines.push(row.voice
            ? `  ${row.name.padEnd(width)}  →  ${voiceWords(row)}  ${availabilityWords(row)}${fitWords(row)}`
            : `  ${row.name.padEnd(width)}  →  no voice chosen (keeps the generated voice)`);
    }
    for (const notice of notices)
        lines.push(`Heads-up: ${notice}`);
    return lines;
}
export function voiceSheetLines(sheet) {
    const lines = [`Voices for run ${sheet.runId}`];
    if (typeof sheet.treatment.path === "string" && sheet.treatment.path !== "") {
        lines.push(`  Treatment: ${sheet.treatment.path}`);
    }
    if (sheet.cast.length === 0)
        lines.push("  Nobody is in this ad yet.");
    for (const row of sheet.cast) {
        const voice = voiceWords(row);
        lines.push(`  ${row.characterId}  ${row.name}  ${voice}  ${availabilityWords(row)}  ` +
            `speaks in ${row.spokenScenes} scene${row.spokenScenes === 1 ? "" : "s"}, ` +
            `about ${row.spokenSeconds}s${fitWords(row)}`);
        if (row.description)
            lines.push(`      written voice: ${row.description}`);
    }
    if (sheet.narrator) {
        const label = sheet.narrator.label ? `${sheet.narrator.label} ` : "";
        lines.push(`  Narrator  ${label}(${sheet.narrator.voiceId})  set on the workflow, not here`);
    }
    if (sheet.changed) {
        lines.push(sheet.changed.length > 0
            ? `Changed: ${sheet.changed.join(", ")}. Pictures and script were not touched.`
            : "Nothing changed — those voices were already set. Pictures and script were not touched.");
    }
    lines.push(`How voices are applied: ${sheet.treatment.summary}${sheet.treatment.speedChange ? "" : " No speed change."}`);
    const playsPinnedVoices = sheet.treatment.kind !== "render-owns-voice";
    const convertsClips = playsPinnedVoices && sheet.treatment.usage.clips > 0;
    if (convertsClips || sheet.treatment.usesElevenLabs === undefined) {
        lines.push(`Cost: billed to your own ElevenLabs key. ${sheet.treatment.costNote} ` +
            `About ${sheet.treatment.usage.seconds} seconds of speech across ` +
            `${sheet.treatment.usage.clips} clips will be converted.`);
    }
    else if (sheet.treatment.usesElevenLabs) {
        lines.push("Cost: the narration on this run is voiced by ElevenLabs and billed to your own key. " +
            `${sheet.treatment.costNote} The clips themselves are not converted.`);
    }
    for (const notice of sheet.notices)
        lines.push(notice);
    lines.push(sheet.canChange
        ? "You can still change voices until you approve the storyboard."
        : (sheet.whyNot ?? "Voices can no longer be changed on this run."));
    return lines;
}
function musicLines(manifest) {
    const lines = [`music: ${manifest.musicBed}`];
    if (manifest.musicHeardScenes.length > 0) {
        lines.push(`music heard in scene ${manifest.musicHeardScenes.join(", ")}`);
    }
    return lines;
}
export function planCustomerPull(run, items, meta) {
    const downloads = [];
    const take = (file, url) => {
        downloads.push({ file, url });
        return file;
    };
    const scenes = new Map();
    let music = null;
    for (const item of items) {
        if (item.kind === "music") {
            if (music === null && item.url)
                music = take(`music.${extFor(item.url, "audio")}`, item.url);
            continue;
        }
        if (!isPullSceneIndex(item.sceneIndex))
            continue;
        const scene = scenes.get(item.sceneIndex) ?? { index: item.sceneIndex, clip: null, voice: null };
        if (item.url && item.kind === "clip" && scene.clip === null) {
            scene.clip = take(`${scenePrefix(item.sceneIndex)}.${extFor(item.url, "video")}`, item.url);
        }
        if (item.url && item.kind === "voice" && scene.voice === null) {
            scene.voice = take(`${scenePrefix(item.sceneIndex)}.voice.${extFor(item.url, "audio")}`, item.url);
        }
        scenes.set(item.sceneIndex, scene);
    }
    const videoUrl = run.video?.url;
    const video = videoUrl ? take(`video.${extFor(videoUrl, "video")}`, videoUrl) : null;
    return {
        downloads,
        manifest: {
            runId: run.runId,
            pulledAt: meta.pulledAt,
            dashboardUrl: customerRunPage(meta.dashboardUrl, run.runId),
            scenes: [...scenes.values()].sort((a, b) => a.index - b.index),
            music,
            video,
        },
    };
}
async function customerPullFlow(run, dir, json, deps) {
    const runId = run.runId;
    const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!itemsRes.ok)
        return errorResult(itemsRes, json);
    const items = customerAnswer(itemsRes.data)?.items ?? [];
    const { downloads, manifest } = planCustomerPull(run, items, {
        pulledAt: new Date(deps.now()).toISOString(),
        dashboardUrl: deps.dashboardUrl,
    });
    deps.mkdirp(dir);
    const failures = (await runPool(downloads.map((download) => () => downloadWithRetry(download, dir, deps)), PULL_CONCURRENCY)).filter((f) => f !== null);
    const landed = (file) => file !== null && !failures.some((f) => f.file === file) ? file : null;
    for (const scene of manifest.scenes) {
        scene.clip = landed(scene.clip);
        scene.voice = landed(scene.voice);
    }
    manifest.music = landed(manifest.music);
    manifest.video = landed(manifest.video);
    const manifestPath = path.join(dir, "manifest.json");
    deps.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const code = failures.length > 0 ? 1 : 0;
    if (json) {
        return { code, lines: [JSON.stringify({ runId, dir, wrote: downloads.length - failures.length + 1, manifest })] };
    }
    if (downloads.length === 0) {
        return {
            code: 0,
            lines: [
                "Nothing to download yet. This video hasn't made any pieces.",
                `Check where it is: exodus video status ${runId}`,
            ],
        };
    }
    return {
        code,
        lines: [
            `Pulled ${downloads.length - failures.length + 1} files into ${dir}`,
            `Every piece is listed in ${manifestPath}.`,
            ...(manifest.video ? [] : ["The finished video isn't ready yet, so only the scene pieces came down."]),
            ...(failures.length > 0
                ? [
                    "",
                    `${failures.length} file${failures.length === 1 ? "" : "s"} did not download:`,
                    ...failures.map((f) => `  ${f.file}: ${f.error}`),
                    "Run the same command again to retry.",
                ]
                : []),
            "",
            `When your cut is ready: exodus video upload ${runId} --file cut.mp4`,
        ],
    };
}
export async function pullFlow(runId, dir, json, deps) {
    const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!runRes.ok)
        return errorResult(runRes, json);
    const customer = customerAnswer(runRes.data);
    if (customer)
        return customerPullFlow(customer, dir, json, deps);
    const run = asVideoRun(runRes.data);
    const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!itemsRes.ok)
        return errorResult(itemsRes, json);
    const items = itemsRes.data.items ?? [];
    const plan = planPull(run, items, {
        pulledAt: new Date(deps.now()).toISOString(),
        dashboardUrl: deps.dashboardUrl,
    });
    deps.mkdirp(dir);
    if (plan.downloads.length === 0 && plan.texts.length === 0) {
        deps.writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(plan.manifest, null, 2)}\n`);
        const lines = [
            "Nothing to pull yet — this run hasn't made any pieces.",
            `Wrote ${path.join(dir, "manifest.json")} anyway, so you can see what it knows.`,
            `Check where it is: exodus video status ${runId}`,
        ];
        return { code: 0, lines: json ? [JSON.stringify({ runId, files: [], manifest: plan.manifest })] : lines };
    }
    for (const text of plan.texts) {
        deps.writeFile(path.join(dir, text.file), text.body);
    }
    const failures = await runPool(plan.downloads.map((download) => () => downloadWithRetry(download, dir, deps)), PULL_CONCURRENCY);
    for (const failure of failures) {
        if (failure)
            markPullFailure(plan.manifest, failure);
    }
    deps.writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(plan.manifest, null, 2)}\n`);
    const failed = plan.manifest.failed;
    const wrote = plan.downloads.length + plan.texts.length - failed.length + 1;
    if (json) {
        return {
            code: failed.length > 0 ? 1 : 0,
            lines: [JSON.stringify({ runId, dir, wrote, manifest: plan.manifest })],
        };
    }
    const lines = [
        `Pulled ${wrote} files into ${dir}`,
        `Every piece is indexed in ${path.join(dir, "manifest.json")} — scene numbers there are the run's own.`,
        ...musicLines(plan.manifest),
    ];
    if (plan.manifest.dropped.length > 0) {
        lines.push("", `B-roll left out on purpose (no clip; the edit stays on the speaker): scene${plan.manifest.dropped.length === 1 ? "" : "s"} ${plan.manifest.dropped.join(", ")}. Cut with --skip ${plan.manifest.dropped.join(",")}.`);
    }
    for (const sceneIndex of plan.manifest.pendingRedo) {
        lines.push("", `Scene ${sceneIndex} is being redone right now; its file will change. Run \`exodus video wait ${runId}\`, then pull again.`);
    }
    const voiceFirst = plan.manifest.scenes.filter((s) => s.voiceMode === "voice-first");
    if (voiceFirst.length > 0) {
        lines.push("", `Redone voice first (the line recorded, then the clip made to match it): ` +
            `scene${voiceFirst.length === 1 ? "" : "s"} ${voiceFirst.map((s) => s.sceneIndex).join(", ")}`);
    }
    const redoneUsualWay = plan.manifest.scenes.filter((s) => s.voiceFirstBlockedBy?.length);
    if (redoneUsualWay.length > 0) {
        lines.push("", "Asked for voice first, but redone the usual way:");
        for (const scene of redoneUsualWay) {
            lines.push(`  scene ${scene.sceneIndex}: ${cantSayNames(scene.voiceFirstBlockedBy ?? [])}`);
        }
    }
    const flagged = plan.manifest.scenes.filter((s) => s.flagged);
    if (flagged.length > 0) {
        lines.push("", `${flagged.length} clip${flagged.length === 1 ? "" : "s"} came back flagged — usable, but look before you cut:`);
        for (const scene of flagged) {
            lines.push(`  scene ${scene.sceneIndex}: ${scene.findings.map((f) => f.code).join(", ") || "flagged"}`);
        }
    }
    if (failed.length > 0) {
        lines.push("", `${failed.length} file${failed.length === 1 ? "" : "s"} did not download:`);
        for (const failure of failed)
            lines.push(`  ${failure.file}: ${failure.error}`);
        lines.push("Run the same command again to retry just those.");
    }
    lines.push("", `When your cut is ready: exodus video upload ${runId} --file cut.mp4`);
    return { code: failed.length > 0 ? 1 : 0, lines };
}
const BOX_HEADER = 8;
const BOX_HEADER_64 = 16;
const FULL_BOX_PREAMBLE = 4;
const MVHD_FIELDS = {
    0: { timescale: 8, duration: 12, end: 16 },
    1: { timescale: 16, duration: 20, end: 28 },
};
const MVHD_UNKNOWN_V0 = 0xffffffff;
const MVHD_UNKNOWN_V1 = 0xffffffffffffffffn;
const MAX_BOX_DEPTH = 4;
export function parseMvhdDurationSec(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const walk = (start, end, depth) => {
        if (depth > MAX_BOX_DEPTH)
            return null;
        let p = start;
        while (p + BOX_HEADER <= end) {
            let size = view.getUint32(p);
            let header = BOX_HEADER;
            const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
            if (size === 1) {
                if (p + BOX_HEADER_64 > end)
                    return null;
                size = Number(view.getBigUint64(p + BOX_HEADER));
                header = BOX_HEADER_64;
            }
            else if (size === 0) {
                size = end - p;
            }
            if (size < header || p + size > end)
                return null;
            if (type === "mvhd") {
                const version = bytes[p + header];
                if (version !== 0 && version !== 1)
                    return null;
                const fields = MVHD_FIELDS[version];
                const base = p + header + FULL_BOX_PREAMBLE;
                if (base + fields.end > p + size)
                    return null;
                const timescale = view.getUint32(base + fields.timescale);
                if (timescale === 0)
                    return null;
                if (version === 1) {
                    const raw = view.getBigUint64(base + fields.duration);
                    if (raw === 0n || raw === MVHD_UNKNOWN_V1)
                        return null;
                    return Number(raw) / timescale;
                }
                const raw = view.getUint32(base + fields.duration);
                if (raw === 0 || raw === MVHD_UNKNOWN_V0)
                    return null;
                return raw / timescale;
            }
            if (type === "moov") {
                const found = walk(p + header, p + size, depth + 1);
                if (found !== null)
                    return found;
            }
            p += size;
        }
        return null;
    };
    return walk(0, bytes.byteLength, 0);
}
export const NO_DURATION_MESSAGE = "Can't tell how long this cut is.\n" +
    "Install ffmpeg (which brings ffprobe), or pass the length yourself: --duration <seconds>";
const MB = 1024 * 1024;
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_BACKOFF_MS = [500, 1500];
const UPLOAD_STEP_LABEL = {
    mint: "asking the server for an upload slot",
    store: "sending the file to storage",
    register: "registering the uploaded file",
    attach: "attaching the cut to the run",
};
export function describeFetchFailure(err) {
    if (!(err instanceof Error))
        return String(err);
    const parts = [];
    let cause = err.cause;
    for (let depth = 0; depth < 2 && cause && typeof cause === "object"; depth++) {
        const level = cause;
        const code = typeof level.code === "string" && level.code ? level.code : undefined;
        const message = typeof level.message === "string" && level.message ? level.message : undefined;
        if (code && message)
            parts.push(`${code}: ${message}`);
        else if (code)
            parts.push(code);
        else if (message)
            parts.push(message);
        cause = level.cause;
    }
    return parts.length > 0 ? `${err.message} (${parts.join("; ")})` : err.message;
}
async function withUploadRetry(step, deps, fn) {
    let cause = "";
    for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
        try {
            return { ok: true, value: await fn() };
        }
        catch (e) {
            cause = describeFetchFailure(e);
            const wait = UPLOAD_BACKOFF_MS[attempt - 1];
            if (attempt < UPLOAD_ATTEMPTS && wait !== undefined)
                await deps.sleep(wait);
        }
    }
    return { ok: false, step, attempts: UPLOAD_ATTEMPTS, cause };
}
function uploadRetryResult(failed, json) {
    if (json) {
        return {
            code: 1,
            lines: [
                JSON.stringify({
                    ok: false,
                    step: failed.step,
                    attempts: failed.attempts,
                    error: failed.cause,
                }),
            ],
        };
    }
    return {
        code: 1,
        lines: [
            `Upload failed while ${UPLOAD_STEP_LABEL[failed.step]} (${failed.attempts} tries): ${failed.cause}`,
            "Check your connection and run the same command again.",
        ],
    };
}
const CUT_SCENES_MAX = 200;
const CUT_WORDS_MAX = 2000;
const isTime = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
function cutScene(row) {
    const r = row;
    return r && Number.isInteger(r.scene) && isTime(r.startSec) && isTime(r.seconds) && r.seconds > 0
        ? { scene: r.scene, startSec: r.startSec, seconds: r.seconds }
        : null;
}
function cutWord(row) {
    const r = row;
    return r &&
        typeof r.text === "string" &&
        r.text.trim() !== "" &&
        isTime(r.start) &&
        isTime(r.end) &&
        r.end >= r.start &&
        Number.isInteger(r.scene)
        ? { text: r.text, start: r.start, end: r.end, scene: r.scene }
        : null;
}
function readSidecar(file, parse, max, deps) {
    let rows;
    try {
        rows = JSON.parse(deps.readFile(file));
    }
    catch {
        return null;
    }
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > max)
        return null;
    const parsed = rows.map(parse);
    return parsed.every((r) => r !== null) ? parsed : null;
}
export function cutSidecars(filePath, deps) {
    const base = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)));
    const cutScenes = readSidecar(`${base}.scenes.json`, cutScene, CUT_SCENES_MAX, deps);
    const cutWords = readSidecar(`${base}.words.json`, cutWord, CUT_WORDS_MAX, deps);
    return { ...(cutScenes ? { cutScenes } : {}), ...(cutWords ? { cutWords } : {}) };
}
export async function uploadFlow(runId, filePath, durationFlag, json, deps) {
    const stat = deps.statFile(filePath);
    if (!stat)
        return { code: 1, lines: [`No such file: ${filePath}`] };
    const policy = ASSET_UPLOAD_POLICY.video;
    const ext = path.extname(filePath).toLowerCase();
    const mime = policy.mimeByExtension[ext];
    if (!mime) {
        return {
            code: 1,
            lines: [`"${path.basename(filePath)}" isn't a video file the dashboard accepts. It takes ${policy.accepts}.`],
        };
    }
    if (stat.size > policy.maxBytes) {
        return {
            code: 1,
            lines: [
                `"${path.basename(filePath)}" is ${(stat.size / MB).toFixed(1)}MB — the limit is ${Math.round(policy.maxBytes / MB)}MB.`,
                "Export it smaller and try again.",
            ],
        };
    }
    let asked = null;
    if (durationFlag !== undefined) {
        asked = Number.parseFloat(durationFlag);
        if (!Number.isFinite(asked) || asked <= 0) {
            return { code: 1, lines: [`--duration must be a number of seconds, not "${durationFlag}".`] };
        }
    }
    let bytes;
    try {
        bytes = deps.readFileBytes(filePath);
    }
    catch (e) {
        return {
            code: 1,
            lines: [`Can't read "${filePath}": ${e instanceof Error ? e.message : String(e)}`],
        };
    }
    const durationSec = asked ?? deps.probeDurationSec(filePath) ?? parseMvhdDurationSec(bytes);
    if (durationSec === null)
        return { code: 1, lines: [NO_DURATION_MESSAGE] };
    const timing = cutSidecars(filePath, deps);
    const minting = await withUploadRetry("mint", deps, () => deps.post(ASSET_UPLOAD_URL_PATH, {}));
    if (!minting.ok)
        return uploadRetryResult(minting, json);
    const mint = minting.value;
    if (!mint.ok)
        return errorResult(mint, json);
    const minted = mint.data;
    const uploadUrl = minted.uploadUrl;
    const receiptId = minted.receiptId;
    if (!uploadUrl || !receiptId) {
        return { code: 1, lines: ["The server did not hand back a place to upload to."] };
    }
    const storing = await withUploadRetry("store", deps, () => deps.uploadBytes(uploadUrl, mime, bytes));
    if (!storing.ok)
        return uploadRetryResult(storing, json);
    const put = storing.value;
    if (!put.ok || !put.storageId) {
        const detail = put.body ? `: ${put.body.slice(0, 200)}` : "";
        return { code: 1, lines: [`Upload failed (HTTP ${put.status})${detail}`] };
    }
    const storageId = put.storageId;
    const registering = await withUploadRetry("register", deps, () => deps.post(ASSETS_PATH, {
        storageId,
        receiptId,
        filename: path.basename(filePath),
    }));
    if (!registering.ok)
        return uploadRetryResult(registering, json);
    const registered = registering.value;
    if (!registered.ok)
        return errorResult(registered, json);
    const asset = registered.data;
    const assetId = asset.assetId;
    if (!assetId) {
        return { code: 1, lines: ["The server stored the file but did not say what to call it."] };
    }
    const attaching = await withUploadRetry("attach", deps, () => deps.post(FINAL_PATH, {
        runId,
        assetId,
        durationSec,
        ...timing,
    }));
    if (!attaching.ok)
        return uploadRetryResult(attaching, json);
    const attached = attaching.value;
    if (!attached.ok)
        return errorResult(attached, json);
    const customerFinal = customerAnswer(attached.data);
    if (customerFinal) {
        const { finalWatchUrl, delivered } = customerFinal;
        if (json) {
            return {
                code: 0,
                lines: [JSON.stringify({ ok: true, runId, assetId, durationSec, finalWatchUrl, delivered })],
            };
        }
        return {
            code: 0,
            lines: [
                `Uploaded your cut (${durationSec.toFixed(1)}s).${delivered ? " Your video is delivered." : ""}`,
                `Watch it here: ${finalWatchUrl}`,
            ],
        };
    }
    const final = attached.data;
    const finalWatchUrl = final.finalWatchUrl ?? reviewUrl(deps.dashboardUrl, { _id: runId });
    const delivered = final.delivered === true;
    if (json) {
        return {
            code: 0,
            lines: [JSON.stringify({ ok: true, runId, assetId, durationSec, finalWatchUrl, delivered })],
        };
    }
    const uploaded = `Uploaded your cut (${durationSec.toFixed(1)}s).`;
    return {
        code: 0,
        lines: delivered
            ? [`${uploaded} Your ad is delivered.`, `Watch it here: ${finalWatchUrl}`]
            : [
                uploaded,
                `Watch it here: ${finalWatchUrl}`,
                `Approve it there, or run: exodus video approve ${runId}`,
            ],
    };
}
const VALUE_FLAGS = new Set([
    "show",
    "script",
    "conceit",
    "style",
    "direction",
    "voice-path",
    "video-model",
    "voice",
    "frame",
    "pacing",
    "note",
    "out",
    "file",
    "duration",
    "node",
    "scene",
    "line",
    "set",
    "clear",
    "from",
]);
export function parsePositional(args = process.argv.slice(3)) {
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
function flagString(flags, name) {
    const value = flags[name];
    return typeof value === "string" ? value : undefined;
}
async function printResult(result) {
    for (const line of result.lines)
        console.log(line);
    if (result.code !== 0)
        process.exit(result.code);
}
function usage(line) {
    console.error(`Error: ${line}`);
    process.exit(1);
}
export async function run(flags, occurrences) {
    const [sub, ...rest] = parsePositional();
    const json = flags["json"] === true;
    if (!sub) {
        console.log(helpText);
        return;
    }
    if (sub === "shows")
        return printResult(await showsFlow(json, defaultDeps));
    if (sub === "start") {
        const plan = planVideoStart(flags, occurrences);
        if (plan.kind === "usage")
            usage(plan.line);
        const onProgressLine = (line) => console.log(line);
        if (plan.kind === "show") {
            return printResult(await startFlow({ ...plan.opts, onProgressLine }, defaultDeps));
        }
        const started = await startScriptFlow({ ...plan.opts, onProgressLine }, defaultDeps);
        if (started.usage)
            usage(started.lines[0] ?? "");
        return printResult(started);
    }
    if (sub === "broll") {
        const plan = planBrollCommand(rest, flags);
        if (plan.kind === "usage")
            usage(plan.line);
        if (plan.kind === "list")
            return printResult(await brollFlow(plan.runId, json, defaultDeps));
        return printResult(await brollEditFlow(plan.runId, plan.edit, json, defaultDeps));
    }
    const runId = rest[0];
    const needsRunId = [
        "status",
        "storyboard",
        "approve",
        "flag",
        "retry-frame",
        "retry-clip",
        "revoice",
        "voices",
        "pull",
        "upload",
        "director",
    ];
    if (sub === "voices" && flags["catalog"] !== undefined && flags["catalog"] !== false) {
        return printResult(await voiceCatalogFlow(runId, json, defaultDeps));
    }
    if (needsRunId.includes(sub) && !runId) {
        usage(`video ${sub} needs a run id: exodus video ${sub} <runId>`);
    }
    if (sub === "status") {
        if (flags["rejected-draft"] !== undefined && flags["rejected-draft"] !== false) {
            return printResult(await rejectedDraftFlow(runId, json, defaultDeps));
        }
        return printResult(await statusFlow(runId, json, defaultDeps));
    }
    if (sub === "storyboard")
        return printResult(await storyboardFlow(runId, json, defaultDeps));
    if (sub === "director") {
        const choice = parseDirectorSwitch(rest[1]);
        if (!choice)
            usage(`video director needs on, off or follow: exodus video director ${runId} on`);
        return printResult(await directorFlow(runId, choice.on, json, defaultDeps));
    }
    if (sub === "approve") {
        return printResult(await approveFlow(runId, { json, approveStaleCut: flags["approve-stale-cut"] === true }, defaultDeps));
    }
    if (sub === "flag") {
        const note = flagString(flags, "note");
        if (!note)
            usage('video flag needs --note "<what is wrong>".');
        return printResult(await flagFlow(runId, note, json, defaultDeps));
    }
    if (sub === "retry-frame") {
        const nodeId = nonBlank(flagString(flags, "node"));
        const sceneRaw = flagString(flags, "scene");
        if (sceneRaw === undefined) {
            usage("video retry-frame needs --scene <n>, the scene index to redo.");
        }
        const sceneIndex = Number(sceneRaw);
        if (!Number.isFinite(sceneIndex)) {
            usage("video retry-frame --scene must be a number.");
        }
        return printResult(await retryFrameFlow(runId, nodeId, sceneIndex, flagString(flags, "note"), json, defaultDeps));
    }
    if (sub === "retry-clip") {
        const sceneRaw = flagString(flags, "scene");
        if (sceneRaw === undefined) {
            usage("video retry-clip needs --scene <n>, the scene whose clip to redo.");
        }
        const sceneIndex = Number(sceneRaw);
        if (!Number.isInteger(sceneIndex)) {
            usage(`video retry-clip --scene must be a whole scene number, not "${sceneRaw}".`);
        }
        return printResult(await retryClipFlow(runId, { sceneIndex, nodeId: flagString(flags, "node") }, { note: flagString(flags, "note"), voiceFirst: flags["voice-first"] === true }, json, defaultDeps));
    }
    if (sub === "revoice") {
        const sceneRaw = flagString(flags, "scene");
        const all = flags["all"] === true;
        if (all === (sceneRaw !== undefined)) {
            usage("video revoice needs one of --scene <n> (one clip) or --all (every clip that kept the video model's voice).");
        }
        if (all)
            return printResult(await revoiceFlow(runId, { all: true }, json, defaultDeps));
        const sceneIndex = Number(sceneRaw);
        if (!Number.isInteger(sceneIndex)) {
            usage(`video revoice --scene must be a whole scene number, not "${sceneRaw}".`);
        }
        return printResult(await revoiceFlow(runId, { sceneIndex, nodeId: flagString(flags, "node") }, json, defaultDeps));
    }
    if (sub === "voices") {
        let voices;
        try {
            voices = parseVoiceFlags(occurrences, defaultDeps.readFile);
        }
        catch (err) {
            usage(err.message);
        }
        return printResult(await voicesFlow(runId, voices, json, defaultDeps));
    }
    if (sub === "pull") {
        const dir = flagString(flags, "out");
        if (!dir)
            usage("video pull needs --out <dir>, the folder to write the pieces into.");
        return printResult(await pullFlow(runId, dir, json, defaultDeps));
    }
    if (sub === "upload") {
        const file = flagString(flags, "file");
        if (!file)
            usage("video upload needs --file <cut.mp4>.");
        return printResult(await uploadFlow(runId, file, flagString(flags, "duration"), json, defaultDeps));
    }
    console.error(`Unknown subcommand: "${sub}"\n`);
    console.log(helpText);
    process.exit(1);
}
