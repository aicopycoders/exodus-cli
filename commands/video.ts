import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { apiGet, apiPost, getDashboardUrl, type ApiResponse } from "../lib/client.js";
import { displayRunStatus, formatApiError } from "../lib/format.js";
import { missingRouteLine } from "../lib/route-support.js";
import { hasBinary } from "../lib/preflight.js";
import type { FlagOccurrence } from "../lib/args.js";
import {
  ASSET_UPLOAD_POLICY,
  pauseAheadLine,
  type RunProvenance,
  type WorkflowRun,
} from "./workflow.js";
import { HELPER_LEDGER_BASE, SET_OPTION_LEDGER_BASE } from "../lib/helperLedgerBase.js";
import {
  customerAnswer,
  customerRunPage,
  customerStageIsWorking,
  customerStageLines,
  customerStatusLines,
  customerStoryboardLines,
  customerVoicesLines,
  type CustomerFinal,
  type CustomerItem,
  type CustomerItems,
  type CustomerOk,
  type CustomerRun,
  type CustomerStart,
  type CustomerStoryboard,
  type CustomerVoices,
  type ScriptTidied,
} from "./video-customer.js";

const VOICE_MODES = ["native", "voice-first"] as const;
type VoiceMode = (typeof VOICE_MODES)[number];

function joinedOr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

function joinedAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The kinds and looks `GET /api/v2/video/script-runs` hands the CLI. */
export type ScriptRunOptions = {
  conceits: { key: string; label: string }[];
  styles: { slug: string; label: string }[];
};

/**
 * A usage line when `conceit` or `style` is not one the server offered, or
 * null when both are. The conceit is judged first. The words are the server's,
 * in the order it sent them.
 */
export function scriptRunPickProblem(
  options: ScriptRunOptions,
  conceit: string,
  style: string,
): string | null {
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

function cantSayNames(names: readonly string[]): string {
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
  exodus video retry-clip <runId> --scene <n> [--node <nodeId>] [--note "..."] [--voice-first] [--json]
  exodus video revoice <runId> (--scene <n> | --all) [--node <nodeId>] [--json]
  exodus video voices <runId> [--set <character>=<voice>] [--clear <character>] [--from <file.json>] [--json]
  exodus video voices [<runId>] --catalog [--json]
  exodus video pull <runId> --out <dir> [--json]
  exodus video upload <runId> --file <cut.mp4> [--duration <sec>] [--json]
  exodus video start --script <file> --conceit <kind> --style <look> [--direction "<note>"] [--frame pov] [--pacing <jump-cuts|long-take|montage>] [--voice-path <path>] [--video-model <id>] [--voice <native|voice-first>] [--music] [--one-shot] [--director] [--wait] [--json]
  exodus video director <runId> <on|off|follow> [--json]

Options:
  --out <dir>          Folder to write the pulled pieces into (pull)
  --file <cut.mp4>     Your finished cut (upload). MP4, MOV or WebM, up to 200MB
  --duration <sec>     How long your cut is, in seconds. Only needed when the
                       length can't be read off the file itself
  --note "<text>"      How to steer one redo (retry-frame, retry-clip)
  --node <nodeId>      Which scene-frames node holds the still (retry-frame;
                       admins pass it, beta testers leave it off).
                       Which video step holds the clip, when a scene has one on
                       more than one step (retry-clip, revoice)
  --scene <n>          Which scene to redo. One scene only, a whole number
                       (retry-frame, retry-clip, revoice)
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
                       starts nothing
  --stop-at-script     Print the script the run would start on, and start
                       nothing (start, with --conceit). To read a written or
                       laid-out script first; send it back with --script
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
--review-storyboard, --stop-at-script),
status, storyboard, approve (the storyboard), voices, retry-frame --scene <n> (redo one scene's
picture while the storyboard waits), pull (the finished video, each scene's
clip and voice, and the music) and upload. These stay admin-only:
start --video-model / --voice / --voice-path / --director, director,
status --rejected-draft, retry-clip and revoice.
If a command answers "video isn't enabled for this key", the run id is wrong,
the command is admin-only, or video isn't switched on for your dashboard user.

Examples:
  exodus workflow list
  exodus workflow describe "Video Ad"
  exodus workflow run "Video Ad" --input script=@./script.txt --wait
  exodus video storyboard run_123
  exodus video approve run_123
  exodus video retry-frame run_123 --node frames-1 --scene 2
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
// #1902: the rejected planner reply, fetched on demand and never on the poll.
// It is up to 100k chars, so the run read carries only a flag saying one exists.
const REJECTED_DRAFT_PATH = "/api/v2/workflow/rejected-draft";
const REJECTED_DRAFT_NOT_ON_THIS_SERVER =
  "This Exodus server does not keep rejected drafts yet, so there is nothing to read. It arrives " +
  "with the next server update.";
const STORYBOARD_PATH = "/api/v2/video/storyboard";
const FLAG_PATH = "/api/v2/video/storyboard/flag";
const APPROVE_PATH = "/api/v2/workflow/approve";
const SCENE_RETRY_PATH = "/api/v2/workflow/scene/retry";
// #1858: the voice-only redo has its OWN route. /scene/retry drops fields it
// does not know, so asking an older server for a voice redo through it would
// buy a full paid redo of the clip. An older server answers 404 here instead.
const SCENE_REVOICE_PATH = "/api/v2/workflow/scene/revoice";
// #2299: its own route for the same reason as the voice redo's.
const SCENE_VOICE_FIRST_PATH = "/api/v2/workflow/scene/voice-first";
const VOICE_FIRST_NOT_ON_THIS_SERVER =
  "This Exodus server cannot redo a clip voice first yet, so nothing was started and nothing " +
  "was spent. It arrives with the next server update.";
const REVOICE_NOT_ON_THIS_SERVER =
  "This Exodus server does not have the voice redo yet, so nothing was started and nothing " +
  "was spent. It arrives with the next server update.";
export const FINAL_PATH = "/api/v2/video/final";
export const VOICES_PATH = "/api/v2/video/voices";
export const ASSET_UPLOAD_URL_PATH = "/api/v2/workflows/asset-upload-url";
export const ASSETS_PATH = "/api/v2/workflows/assets";

export interface ClipWord {
  w: string;
  s: number;
  e: number;
}

/** #1716: what happened about neighbours on ONE take. MIRROR of
 *  QcTakeNeighbours in convex/lib/workflow/qcTakes.ts — exodus compiles
 *  standalone (tsconfig rootDir ".") and cannot import the canonical type. */
export type ClipQcTakeNeighbours =
  | { state: "not-applicable" }
  | { state: "not-attached" }
  | { state: "none-accepted" }
  | { state: "attached"; scenes: number[] };

/** #1716: one take of a clip. MIRROR of QcTake in
 *  convex/lib/workflow/qcTakes.ts. `kind` stays a plain string union of what
 *  the server sends today; an older CLI reading a newer record is why every
 *  field here is read, never re-derived. */
export interface ClipQcTake {
  kind: "take" | "soft-retry";
  failCodes: string[];
  warnCodes: string[];
  neighbours: ClipQcTakeNeighbours;
  /** The checker's own words. Admin-only, exactly like ClipFinding.judgeDetail
   *  (#1784), and never written into a pull manifest. */
  judgeWording?: { code: string; wording: string }[];
  /** #2520: what the transcript heard on a take whose words failed. Admin-only
   *  like `judgeWording`, and never written into a pull manifest. */
  heardText?: string;
}

export interface ClipQc {
  verdict: "pass" | "fail";
  attempts: number;
  /** #1711/#1714: the accepted neighbour scenes this take was judged against
   *  for continuity. Absent on a scene that is never compared (a cutaway, a
   *  demo scene, a run with no locked set); empty when it is compared and
   *  nothing was attached to the shipped take. */
  neighbours?: number[];
  /** #1716: every take, first take first, `takes.length === attempts`. Absent
   *  on a clip recorded before that ticket — which reads as "no history
   *  recorded for this clip", never as an empty list. */
  takes?: ClipQcTake[];
}

export interface ClipFinding {
  check: string;
  code: string;
  severity: "fail" | "warn";
  detail: string;
  /** #1784: the checker's own words, and the severity it gave before the
   *  identity rule forced a fail. Admin-only: shown by `status`, never written
   *  into a pull manifest. */
  judgeDetail?: string;
  judgeSeverity?: "fail" | "warn";
}

/** A finding without the admin-only checker fields (#1784). */
function withoutJudgeFields({ judgeDetail: _d, judgeSeverity: _s, ...rest }: ClipFinding): ClipFinding {
  return rest;
}

/** #1716: a clip's QC stamp with the checker's words (and, #2520, what the
 *  transcript heard) out of its take history.
 *  Applied to the pull manifest under the SAME rule as `withoutJudgeFields` —
 *  unconditionally, because the checker's words are never written into a pulled
 *  file whoever is pulling. */
export function qcWithoutJudgeWording(qc: ClipQc): ClipQc {
  if (!qc.takes) return qc;
  return {
    ...qc,
    takes: qc.takes.map(({ judgeWording: _w, heardText: _h, ...rest }) => rest),
  };
}

/** #1716: the line a clip with no recorded history reads as. LOCKSTEP with
 *  NO_TAKE_HISTORY_LINE in convex/lib/workflow/qcTakes.ts and with the same
 *  sentence in scripts/video-qa/prove-consistency.sh. */
export const NO_TAKE_HISTORY_LINE = "no history recorded for this clip";

const TAKE_NEIGHBOUR_SENTENCE: {
  [S in ClipQcTakeNeighbours["state"]]: (
    neighbours: Extract<ClipQcTakeNeighbours, { state: S }>,
  ) => string;
} = {
  "not-applicable": () => "never compared",
  "not-attached": () => "no neighbours attached",
  "none-accepted": () => "no accepted neighbours yet",
  attached: ({ scenes }) =>
    `compared against scene${scenes.length === 1 ? "" : "s"} ${scenes.join(", ")}`,
};

/** #1716: the take history as plain lines. LOCKSTEP MIRROR of
 *  renderQcTakeHistory in convex/lib/workflow/qcTakes.ts — the literal lines
 *  are pinned by this package's tests and by that module's, so a wording change
 *  that reaches only one side fails a test. */
export function renderQcTakeHistory(takes: ClipQcTake[] | undefined): string[] {
  if (!takes || takes.length === 0) return [NO_TAKE_HISTORY_LINE];
  const lines: string[] = [];
  takes.forEach((take, index) => {
    const say = TAKE_NEIGHBOUR_SENTENCE[take.neighbours.state] as (
      n: ClipQcTakeNeighbours,
    ) => string;
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

function redoLine(lastRedo: { label: string; reason?: string }): string {
  return lastRedo.reason ? `${lastRedo.label}: ${lastRedo.reason}` : lastRedo.label;
}

function printDisplacedHistory(
  lines: string[],
  lastRedo: { displacedHistory?: { title: string; lines: string[] } },
) {
  const history = lastRedo.displacedHistory;
  if (!history) return;
  lines.push(`       ${history.title}`);
  for (const line of history.lines) lines.push(`         ${line}`);
}

/** A SUBSET of the server's artifact union (convex/schema.ts): exodus compiles
 *  standalone (tsconfig rootDir ".") and cannot import the canonical type. */
export type ArtifactSubset =
  | { type: "storyboard"; storyboard?: unknown; storyboardJson?: string }
  | { type: "frames"; frames?: Array<{ sceneIndex: number; imageUrl?: string }> }
  | {
      type: "image";
      imageUrl?: string;
      storageId?: string;
      anchor?: "set-plate" | "product-sheet" | "filled-plate" | "product-plate" | "layout-plate";
      /** #2868: a filled plate's objects, as their lines read. */
      holds?: string[];
      /** #3080: a filled plate drawn with its holder's lid closed. */
      lid?: "closed";
      /** COP-6: a layout plate's camera: "wide" or "seat:<characterId>". */
      camera?: string;
      /** COP-6: a cast member's view from another angle, on its own row in the cast band. */
      view?: "side" | "back" | "three-quarter";
    }
  | {
      type: "video";
      sceneIndex?: number;
      videoUrl?: string;
      durationSec?: number;
      words?: ClipWord[];
      qc?: ClipQc;
      final?: boolean;
      /** #1708: the cast voice was applied over the generated voice. */
      revoiced?: boolean;
      /** #1708: the clip was trimmed to its spoken words. */
      speechTrimmed?: boolean;
      /** #801: off-script speech was cut from the end of the clip. */
      tailTrimmed?: boolean;
      /** #1858: the generator's own file, kept on record when the voice pass
       *  replaced the clip file. */
      rawStorageId?: string;
      /** #2299: the clip was redone voice first. */
      voiceMode?: "voice-first";
      /** #2534: voice first was asked, but these made-up names kept the redo the usual way. */
      voiceFirstBlockedBy?: string[];
      /** #2692: the finished take's median speaking pitch (Hz) and how it was read. */
      voicePitchHz?: number;
      voicePitchMethod?: string;
    }
  | {
      type: "audio";
      sceneIndex?: number;
      audioUrl?: string;
      durationSec?: number;
      /** #1689: narration word timings, seconds from the start of this track. */
      words?: ClipWord[];
      narration?: {
        takeHash: string;
        voiceId?: string;
        modelId?: string;
        speed?: number;
        alignment?: "elevenlabs-timestamps";
        cuts?: Array<{
          sceneIndex: number;
          startSec: number;
          durationSec: number;
          takeHash: string;
        }>;
      };
    }
  | { type: "text" | "primer" | "session" | "document" };

/**
 * #1902: the record of what happened to a storyboard step that failed, as the
 * server composed it (convex/lib/workflow/planFailure.ts). `lines` is the
 * member-facing copy, authored THERE and printed verbatim here, because the run
 * page prints the same strings — that is how the two surfaces cannot word one
 * failure differently.
 *
 * Every field but `lines` is tolerant: `kind` stays a plain string so a new kind
 * the server starts sending does not break a CLI that shipped before it, and the
 * counts are optional so an older or fuller record still parses. Absent on a
 * step that did not fail, and on every backend older than this field.
 */
export interface PlanFailureRecord {
  kind: string;
  partsTotal?: number;
  acceptedParts?: number;
  acceptedScenes?: number;
  failedPart?: number;
  /** The contract violations, which are the tail of `lines` on a "rejected" record. */
  reasons?: string[];
  lines: string[];
}

export interface VideoRunNode {
  nodeId: string;
  kind: string;
  status: "idle" | "running" | "done" | "failed" | "skipped" | "out-of-scope";
  error?: string;
  /** A member-safe note on a step that still finished (the dashboard shows it on the step). */
  warning?: string;
  /** #1902: what happened when this step failed, in words a member can read. */
  planFailure?: PlanFailureRecord;
  /** #1902: there is a rejected draft on file that this caller may read. The
   *  server sends it to entitled callers only, and sends NOTHING otherwise — an
   *  absence here is a plain absence, never "there is something you may not
   *  see". */
  hasRejectedDraft?: boolean;
  outputs?: ArtifactSubset[];
  /** #2266: scenes of this step with nothing delivered, read by the server off
   *  the same ledger and outputs its warning is built from. `pictureRefused`
   *  marks a scene whose picture the video service refused, which a clip redo
   *  alone cannot fix. Absent when none are missing, and on older backends. */
  missingScenes?: MissingScene[];
  /** #2616: scenes the app is still redoing on its own: the automatic word,
   *  picture and missing-scene redos, and a redo a customer asked for. Absent
   *  when none are, and on older backends. */
  autoRedoScenes?: number[];
  /** #3088: why each of those scenes is being redone, as a clause that reads
   *  after "because". Absent alongside `autoRedoScenes`, and on older backends. */
  autoRedoReasons?: AutoRedoReason[];
}

export interface AutoRedoReason {
  sceneIndex: number;
  reason: string;
}

export interface MissingScene {
  sceneIndex: number;
  pictureRefused: boolean;
}

/** The park vocabulary of BUILDER checkpoints. A video gate is none of them, so
 *  the presence of any one of these rules a video gate out. */
export type BuilderPauseReason = "taste" | "repair" | "slots" | "call" | "checkpoint";

export interface PullCastLockMember {
  characterId: string;
  name: string;
  look?: string;
  /** The front still first; COP-6: then the member's views from other angles, each naming its view. */
  identityRefs?: Array<{ storageId?: string; imageUrl?: string; view?: string }>;
}

export interface PullCastLock {
  mintedAt: number;
  styleSlug?: string;
  cast: PullCastLockMember[];
}

export interface VideoRun {
  _id: string;
  status: string;
  isTerminal: boolean;
  error?: string;
  pauseReason?: BuilderPauseReason;
  pausedNodeId?: string;
  nodes: VideoRunNode[];
  /** #1883: the approval stop a still-running run is headed for. Server-decided. */
  pauseAhead?: WorkflowRun["pauseAhead"];
  castLock?: PullCastLock | null;
  /**
   * #1869: whose saved format rules this run followed (`runProvenance`). Read
   * as-is and written straight into the pull manifest — it is names, ids and a
   * version, never the rules themselves. Absent on a run that followed none and
   * on every backend older than #1869.
   */
  provenance?: RunProvenance;
  /**
   * #2247: whether this run has a music bed, as the run itself reports it.
   * Absent on every backend older than #2247 and on runs started before it —
   * and an absence is "nobody recorded it", never "off". A run that predates
   * the field had a bed whenever its Show said so, which is not knowable here.
   */
  musicBed?: boolean;
  /** #2282: the video model and voice mode a paste-a-script run used. Absent on
   *  every other run and on backends older than #2282. */
  videoChoice?: RunVideoChoice;
  /** #3304: the Frame and Pacing a paste-a-script run asked for. Absent means
   *  Single frame and Natural, and on backends older than #3304. */
  shots?: RunShots;
  /** #2587: the app's one-time verdict on approving a paste-a-script run's
   *  storyboard itself. Absent on a run the member chose to review by hand, on
   *  every other kind of run, and on backends older than #2587. */
  storyboardAutoApproval?: { outcome: "approved" | "held"; at: number; reason?: string };
  /** The saved workflow this run executed (`projectRun`, convex/workflows.ts). */
  workflowId?: string;
  /** #1851: set only when the run's workflow row is module-owned, which is what
   *  a Show ad run is. The CLI is never told the `showId`, so this is the only
   *  thing here that tells a Show ad apart from a member's own workflow run. */
  moduleOwned?: boolean;
  /** #2598: the director's panel (`projectDirector`, convex/lib/director.ts).
   *  Absent on non-video runs and on backends older than #2598. */
  director?: RunDirector;
}

export interface RunDirector {
  on: boolean;
  /** This run's own switch. null follows the brand's setting. */
  runSetting: boolean | null;
  workspaceOn: boolean;
  status: "reviewing" | "waiting" | "done" | "stopped" | null;
  redosUsed: number;
  redoCap: number;
  spendUsd: number;
  spendCapUsd: number;
  log: { at: number; phase: "storyboard" | "final-watch"; text: string }[];
}

/** Every read of a run goes through here. A run whose node list is missing or
 *  malformed reads as a run that has not made anything, never as a crash. */
export function asVideoRun(data: unknown): VideoRun {
  const run = (data ?? {}) as VideoRun;
  return { ...run, nodes: Array.isArray(run.nodes) ? run.nodes : [] };
}

export interface NodeItem {
  nodeId: string;
  sceneIndex: number;
  itemKind: string;
  status: string;
  error?: string;
  attempt?: number;
  flagged?: boolean;
  findings?: ClipFinding[];
  /** #1870: the server's own verdict that this row has been "running" so long
   *  its worker must be dead. The threshold lives there and only there, because
   *  this package ships on its own release schedule. Absent on older backends,
   *  and absent means a running row is a running row. */
  staleClaim?: boolean;
  /** #1855: what this row's last redo did. `label` is the finished sentence,
   *  composed by the server and printed VERBATIM, because the run page prints
   *  the same string — that is how the two surfaces cannot word it differently.
   *  `outcome` stays a plain string on purpose: a new outcome the server starts
   *  sending must not break a CLI that shipped before it. Absent on a row never
   *  redone, and on every backend older than this field. */
  lastRedo?: {
    take: number;
    outcome: string;
    label: string;
    /** #2309: why a redo that errored failed. Absent on older backends. */
    reason?: string;
    /** #2535: a turned-down voice-first ask kept on the run's lane, and the names that kept it there. */
    voiceFirstBlockedBy?: string[];
    displacedHistory?: { title: string; lines: string[] };
  };
  /** Optional resolved media from listNodeItems (ledger clips + cast identity stills). */
  artifact?: ArtifactSubset;
}

export interface ShowRow {
  id: string;
  name: string;
  status?: string;
  medium?: string;
  styleSlug?: string;
  ready?: boolean;
  setupProgress?: { set?: boolean; cast?: boolean; voices?: boolean };
}

export interface FlowResult {
  code: number;
  lines: string[];
  /** Set when `lines` is a usage error, printed on stderr the way `usage` does. */
  usage?: true;
}

export interface VideoDeps {
  get: (path: string) => Promise<ApiResponse<unknown>>;
  post: (path: string, body: unknown) => Promise<ApiResponse<unknown>>;
  mkdirp: (dir: string) => void;
  writeFile: (filePath: string, text: string) => void;
  downloadToFile: (url: string, filePath: string) => Promise<void>;
  readFile: (filePath: string) => string;
  readFileBytes: (filePath: string) => Uint8Array;
  statFile: (filePath: string) => { size: number } | null;
  uploadBytes: (
    uploadUrl: string,
    contentType: string,
    bytes: Uint8Array,
  ) => Promise<{ ok: boolean; status: number; storageId?: string; body?: string }>;
  probeDurationSec: (filePath: string) => number | null;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  dashboardUrl: string;
}

function defaultProbeDurationSec(filePath: string): number | null {
  if (!hasBinary("ffprobe")) return null;
  const res = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" },
  );
  if (res.error || res.status !== 0) return null;
  const seconds = Number.parseFloat((res.stdout ?? "").trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export const defaultDeps: VideoDeps = {
  get: (p) => apiGet<unknown>(p),
  post: (p, body) => apiPost<unknown>(p, body),
  mkdirp: (dir) => {
    fs.mkdirSync(dir, { recursive: true });
  },
  writeFile: (filePath, text) => fs.writeFileSync(filePath, text, "utf-8"),
  downloadToFile: async (url, filePath) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
  },
  readFile: (filePath) => fs.readFileSync(filePath, "utf-8"),
  readFileBytes: (filePath) => fs.readFileSync(filePath),
  statFile: (filePath) => {
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() ? { size: stat.size } : null;
    } catch {
      return null;
    }
  },
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
  probeDurationSec: defaultProbeDurationSec,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  dashboardUrl: getDashboardUrl(),
};

/** The video gate answers a plain 404 rather than a 403, so a key that may not
 *  use video and a run id that does not exist are the same answer on the wire.
 *  Both causes are named because neither can be ruled out from here. */
export const VIDEO_NOT_FOUND_MESSAGE =
  "video isn't enabled for this key\n" +
  "One of three things: that run id doesn't exist on this brand, this command is for admins only " +
  "(director, status --rejected-draft, retry-clip, revoice), or video isn't " +
  "switched on for your dashboard user on this brand. Check the id first, then ask Brad.";

export function videoApiError(res: ApiResponse<unknown>): string {
  const behind = missingRouteLine(res, "exodus video");
  if (behind) return behind;
  if (res.status === 404) return VIDEO_NOT_FOUND_MESSAGE;
  return formatApiError(res);
}

function adminOnlyResult(line: string, json: boolean): FlowResult {
  return { code: 1, lines: json ? [JSON.stringify({ ok: false, error: line })] : [line] };
}

function errorResult(res: ApiResponse<unknown>, json: boolean): FlowResult {
  return {
    code: 1,
    lines: json
      ? [JSON.stringify({ ok: false, status: res.status, error: videoApiError(res) })]
      : [videoApiError(res)],
  };
}

export type RunStop =
  // #2616: `autoRedoScenes` is a final watch the app's own redo has not
  // finished with, so it is not ready to watch yet.
  | { at: "running"; stage: string; autoRedoScenes?: number[]; autoRedoReasons?: AutoRedoReason[] }
  // #1908: `showAd` is optional so a run snapshot taken before this shipped
  // still parses, and reads as the reduced block rather than crashing.
  | {
      at: "storyboard-gate";
      nodeId?: string;
      framesNodeId?: string;
      showAd?: true;
      /** #2587: why the app would not approve its own storyboard, as the
       *  server wrote it for the member. */
      heldReason?: string;
    }
  // #2266: `missingScenes` is absent when every scene has a clip. `framesNodeId`
  // is the step whose stills a refused picture is redrawn on.
  | { at: "final-watch"; missingScenes?: MissingScene[]; framesNodeId?: string }
  | { at: "paused"; nodeId?: string; reason?: string }
  // #1687: a "repair" park rides the FAILED arm rather than a new one of its
  // own. A run parked for repair has a dead step in it — `wait` must exit
  // nonzero, `status` must say failed, and a retry is what fixes it. Every
  // consumer already treats `at: "failed"` that way, so the honest reading is
  // the default one; a separate arm would let any consumer that forgot about
  // it quietly call a dead run a success. `repair` only adds the detail that
  // this failure is a repair park, and `step`/`nodeId` name which step died.
  // #2168: `step` is therefore what makes the park retryable. Named ⇒ that step
  // died and `exodus workflow repair <run> retry` redoes it; absent ⇒ no step
  // in the list failed, the server refuses that retry, and only a fresh run
  // moves this ad on.
  | { at: "failed"; error?: string; repair?: true; nodeId?: string; step?: string }
  | { at: "finished"; status: string };

/**
 * #1704: a stop with everything its wording needs. The final watch is the one
 * stop whose next step does not follow from the run alone — it depends on
 * whether a cut is already attached, and only the ledger knows that. So
 * `classifyRun` leaves that arm incomplete, `resolveStop` completes it, and
 * `stopLines` takes THIS type. A caller cannot render a final watch without
 * first saying which of its THREE states the run is in.
 *
 * `cutAttached: null` is "we could not find out" — the ledger read failed. It
 * is its own state on purpose: folding it into `false` is what made a run whose
 * cut IS uploaded tell the member to pull the pieces and upload a cut, which is
 * the exact contradiction this ticket exists to remove.
 */
export type ResolvedStop =
  | Exclude<RunStop, { at: "final-watch" }>
  | (Extract<RunStop, { at: "final-watch" }> & { cutAttached: boolean | null });

const GATE_NODE_KINDS = new Set(["scene-frames", "storyboard"]);

function isAwaitingApproval(status: string): boolean {
  return status === "awaiting-approval" || status === "awaiting-review";
}

function parkedByBuilderCheckpoint(run: VideoRun): boolean {
  return run.pauseReason !== undefined;
}

function parkedAtStoryboardGate(run: VideoRun, pausedNode: VideoRunNode): boolean {
  return !parkedByBuilderCheckpoint(run) && GATE_NODE_KINDS.has(pausedNode.kind);
}

function parkedAtFinalWatch(run: VideoRun): boolean {
  return (
    !parkedByBuilderCheckpoint(run) &&
    run.nodes.some((n) => n.kind === "video" && n.status === "done")
  );
}

function heldReason(run: VideoRun): string | undefined {
  const verdict = run.storyboardAutoApproval;
  if (verdict?.outcome !== "held") return undefined;
  const reason =
    verdict.reason?.trim() ||
    "The app didn't approve this storyboard by itself because its checks found a problem.";
  // Judged once: a picture redone after this time is not counted in it.
  return `${reason} (checked ${new Date(verdict.at).toISOString()})`;
}

export function classifyRun(run: VideoRun): RunStop {
  if (run.status === "failed") return { at: "failed", error: run.error };
  if (run.isTerminal) return { at: "finished", status: run.status };
  if (isAwaitingApproval(run.status)) {
    // #1687: a "repair" park is a FAILURE wearing a park's clothes. The
    // storyboard node died, its siblings were skipped, and the run stalled on
    // the collector waiting for someone to retry or skip — so the run status
    // says awaiting-approval and `pausedNodeId` points at the collector, which
    // made nothing and explains nothing. Read the dead step out of the node
    // list instead, and report the failure it actually is.
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

/**
 * #1704: the ONE definition of "a cut is attached". The final-watch guidance,
 * the final-cut footer and the `hasFinal` field all read it, and `retry-clip`'s
 * "your uploaded cut will not include this" warning reads it too, so no surface
 * can decide a run has a cut by a rule of its own.
 */
export function hasAttachedCut(items: NodeItem[]): boolean {
  return items.some((i) => i.itemKind === "final" && i.status === "done");
}

/**
 * #2608: the scenes whose clip is about to be replaced: the app's automatic
 * word redo (the run's `autoRedoScenes`, #2616) and a running redo someone
 * asked for. A redo claim moves `attempt` past 1; a first render left "running"
 * by a lost ledger write is not a redo (#1893). A dead worker's row is not a
 * redo in flight (#1870), or it would hold `wait` open for good.
 */
export function scenesBeingRedone(run: VideoRun, items: NodeItem[]): number[] {
  const scenes = new Set(
    run.nodes.filter((n) => n.kind === "video").flatMap((n) => n.autoRedoScenes ?? []),
  );
  for (const i of items) {
    if (
      i.itemKind === "clip" &&
      i.status === "running" &&
      (i.attempt ?? 1) > 1 &&
      i.staleClaim !== true
    ) {
      scenes.add(i.sceneIndex);
    }
  }
  return [...scenes].sort((a, b) => a - b);
}

/** #1704: fill in the one fact `classifyRun` cannot see. `cutAttached` comes
 *  from `hasAttachedCut`, or is null when the ledger could not be read. */
export function resolveStop(
  stop: RunStop,
  cutAttached: boolean | null,
): ResolvedStop {
  if (stop.at !== "final-watch") return stop;
  return { ...stop, cutAttached };
}

/**
 * #1704: the same resolution for a surface that polls the run and nothing else.
 * It reads the ledger ONCE, at the moment it has actually parked at the final
 * watch — not on every poll, and not at all for any other stop. A ledger read
 * that FAILS resolves to null, not false: these surfaces know the run is parked
 * and nothing else, and "waiting for a cut" is a claim, not a fallback.
 */
export async function resolveStopAtPark(
  stop: RunStop,
  runId: string,
  deps: Pick<VideoDeps, "get">,
): Promise<ResolvedStop> {
  if (stop.at !== "final-watch") return stop;
  const res = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!res.ok) return resolveStop(stop, null);
  return resolveStop(stop, hasAttachedCut((res.data as { items?: NodeItem[] }).items ?? []));
}

const STAGE_WORDS: Record<string, string> = {
  brief: "reading the script",
  storyboard: "writing the storyboard",
  reference: "drawing the reference still",
  "scene-frames": "drawing one picture per scene",
  voiceover: "recording the voices",
  video: "rendering the clips",
  starting: "starting up",
};

export function stageWord(stage: string): string {
  return STAGE_WORDS[stage] ?? stage;
}

/** #1687: the same steps STAGE_WORDS names, as the SUBJECT of a sentence —
 *  "The storyboard failed", not "The writing the storyboard failed". */
const STEP_NAMES: Record<string, string> = {
  brief: "The script read",
  storyboard: "The storyboard",
  reference: "The reference still",
  "scene-frames": "The scene pictures",
  voiceover: "The voices",
  video: "The clips",
};

export function stepName(kind: string | undefined): string {
  if (!kind) return "A step in this run";
  return STEP_NAMES[kind] ?? `The ${kind} step`;
}

/** #1908: `exodus video flag` is refused on any run whose row carries no
 *  `showId` (`prepareStoryboardFlag`, convex/videoModule.ts). The CLI is never
 *  told showId, and `moduleOwned` is all it gets. At a storyboard gate the two
 *  facts agree. The only module-owned workflows that reach that gate are the
 *  Show ones (show-ad, and the show-setup founding ad), and both stamp showId
 *  at creation. copy-face, meme-rig and the organic moves have no storyboard or
 *  scene-frames node to park on. An absent marker means "not a Show ad", on
 *  purpose. */
export function isShowAd(run: Pick<VideoRun, "moduleOwned">): boolean {
  return run.moduleOwned === true;
}

/**
 * #1851, #2352: the ONE place the CLI composes a link to a run's review page.
 * It never links the /video page. A paste-a-script run is module-owned but has
 * no Show, and /video ignores `?ad=` while Shows are switched off, so that link
 * landed members on an empty page. Every run opens on its own workflow run page,
 * or on the canonical /runs/<id> forwarder when all the caller holds is a run id.
 */
export function reviewUrl(
  dashboardUrl: string,
  run: Pick<VideoRun, "_id" | "workflowId">,
): string {
  if (run.workflowId) return `${dashboardUrl}/workflows/${run.workflowId}/runs/${run._id}`;
  return `${dashboardUrl}/runs/${run._id}`;
}

/** "scene 3" / "scenes 3 and 5" / "scenes 1, 3 and 5". */
function scenesPhrase(scenes: number[]): string {
  if (scenes.length === 1) return `scene ${scenes[0]}`;
  return `scenes ${scenes.slice(0, -1).join(", ")} and ${scenes[scenes.length - 1]}`;
}

/**
 * #2266: the final-watch park while scenes have no clip. A scene whose picture
 * the video service refused gets the frame redraw first, because a clip redo
 * alone resends the picture that was refused.
 */
function missingSceneLines(
  missing: MissingScene[],
  framesNodeId: string | undefined,
  runId: string,
  runUrl: string,
): string[] {
  const scenes = missing.map((m) => m.sceneIndex);
  const lines = [
    `Parked: ${scenesPhrase(scenes)} ${scenes.length === 1 ? "has" : "have"} no clip yet, so the ad isn't complete.`,
  ];
  for (const { sceneIndex, pictureRefused } of missing) {
    if (!pictureRefused) {
      lines.push(`Redo clip ${sceneIndex}:     exodus video retry-clip ${runId} --scene ${sceneIndex}`);
      continue;
    }
    lines.push(
      `Scene ${sceneIndex}'s picture was refused by the video service as too close to an existing character, so redraw it before redoing the clip.`,
    );
    lines.push(
      framesNodeId
        ? `Redraw frame ${sceneIndex}:  exodus video retry-frame ${runId} --node ${framesNodeId} --scene ${sceneIndex} --note "<what to change>"`
        : `Redraw frame ${sceneIndex}:  on the run page, ${runUrl}`,
    );
    lines.push(`Then redo clip ${sceneIndex}: exodus video retry-clip ${runId} --scene ${sceneIndex}`);
  }
  lines.push(
    "The ad can't be approved until every scene has a clip.",
    `Watch it here:   ${runUrl}`,
  );
  return lines;
}

export function stopLines(stop: ResolvedStop, runId: string, runUrl: string): string[] {
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
      lines.push(
        `Redo one frame: exodus video retry-frame ${runId} --node ${stop.framesNodeId} --scene <n>`,
      );
    }
    return lines;
  }
  if (stop.at === "final-watch") {
    // #2266: a scene with no clip outranks every cut state below. "Every piece
    // is made" would be false, and the server refuses the approval anyway.
    if (stop.missingScenes?.length) {
      return missingSceneLines(stop.missingScenes, stop.framesNodeId, runId, runUrl);
    }
    // #1704: the ledger read failed, so every command below would be a guess —
    // "upload a cut" to someone who already has one, or "approve" to someone
    // who has nothing to approve. Say what IS known, and name the one command
    // that looks again.
    if (stop.cutAttached === null) {
      return [
        "Parked: every piece is made.",
        `Couldn't check whether a cut is already uploaded. See where it stands: exodus video status ${runId}`,
        `Watch it here:   ${runUrl}`,
      ];
    }
    // #1704: the cut is in, so the next step is the approval — not the pull and
    // upload the member has already done. The redo road stays open in one line,
    // because the common case is that the cut is right. Nothing here promises
    // the approval will be allowed; the server decides that (#1856).
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
    // #1687: a repair park names the step that died and offers the retry,
    // instead of the old "waiting on someone (repair)" — nobody was waiting,
    // and there was nothing to wait for.
    if (stop.repair) {
      // #2168: the retry redoes the steps that FAILED, and the server refuses
      // it outright when none did. With no step named there is nothing to
      // retry, so say so plainly rather than offer a command that throws.
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
  if (stop.autoRedoScenes?.length) return [autoRedoLine(stop.autoRedoScenes, stop.autoRedoReasons)];
  return [`Working: ${stageWord(stop.stage)}.`];
}

/**
 * #3088: scenes grouped by why they are being redone, each group placed by its
 * lowest scene. A scene the backend gave no reason for (an older backend)
 * gets no "because" rather than a guessed one.
 */
function autoRedoLine(scenes: number[], reasons: AutoRedoReason[] = []): string {
  const reasonOf = new Map(reasons.map((r) => [r.sceneIndex, r.reason]));
  const groups = new Map<string | undefined, number[]>();
  for (const scene of [...scenes].sort((a, b) => a - b)) {
    const reason = reasonOf.get(scene);
    groups.set(reason, [...(groups.get(reason) ?? []), scene]);
  }
  const one = scenes.length === 1;
  const clauses = [...groups].map(([reason, group], i) => {
    const own = i === 0 ? ` on ${group.length === 1 ? "its" : "their"} own` : "";
    return `${scenesPhrase(group)}${own}${reason ? ` because ${reason}` : ""}`;
  });
  const listed =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
  return (
    `Working: the app is redoing ${listed}. ` +
    `The ad isn't ready to watch until ${one ? "it lands" : "they land"}.`
  );
}

/**
 * #1902: the step the failure record belongs to. ONE finder, read by the status
 * block, the --json object and the draft fetch alike, so the three can never
 * disagree about which step is being talked about.
 *
 * Deliberately not routed through `classifyRun`: that one names a dead step only
 * for a repair park or a failed run, and a storyboard can fail on a run that is
 * still running or already parked elsewhere. The record shows wherever it exists.
 */
export function failedStoryboardNode(run: VideoRun): VideoRunNode | undefined {
  return run.nodes.find((n) => n.kind === "storyboard" && n.status === "failed");
}

/**
 * #1902: an entitled reader's storyboard error carries the violations verbatim,
 * which the record below re-renders as a list. A surface that prints BOTH says
 * the same thing twice, the first time with the contract module's prefix on it.
 * Detected by content rather than by that prefix, which is the contract's
 * business — the same test the run page folds the duplicate away by
 * (src/components/run-detail/node-drawer.tsx).
 */
export function errorEchoesReasons(
  error: string | undefined,
  record: PlanFailureRecord | undefined,
): boolean {
  if (!error || record?.kind !== "rejected") return false;
  const reasons = record.reasons ?? [];
  return reasons.length > 0 && reasons.every((reason) => error.includes(reason));
}

/**
 * #1902: the failure record as a block of screen lines, or nothing at all when
 * the server sent no record. Nothing is re-worded here: `lines` is printed as it
 * arrived, indented under a header.
 */
export function planFailureLines(node: VideoRunNode | undefined, runId: string): string[] {
  const record = node?.planFailure;
  if (!record || !Array.isArray(record.lines) || !node) return [];

  // The reasons are the TAIL of `lines` on a rejected record (planFailure.ts
  // pushes them last), which is how they can be set out as a list without this
  // surface deciding which line is a reason.
  const reasons = record.kind === "rejected" ? (record.reasons ?? []) : [];
  const bodyCount = Math.max(0, record.lines.length - reasons.length);

  // #2133: a run can hold two storyboard steps, so the record names its own
  // step rather than leaving "which storyboard?" for the reader to guess.
  const lines = [`What happened to the storyboard step (${node.nodeId}):`];
  record.lines.forEach((line, i) => {
    lines.push(i < bodyCount ? `  ${line}` : `    - ${line}`);
  });
  if (node?.hasRejectedDraft === true) {
    lines.push(
      "  A rejected draft is on file. The system threw it away, so it is a record of what happened and nothing to act on.",
      `  Read it: exodus video status ${runId} --rejected-draft`,
    );
  }
  return lines;
}

export interface PullDownload {
  file: string;
  url: string;
}

export interface PullTextFile {
  file: string;
  body: string;
}

export interface ManifestScene {
  sceneIndex: number;
  durationSec: number | null;
  clip: string | null;
  words: string | null;
  /** Which media the timings in `words` are relative to: the clip's own sound,
   *  or the scene's voice track. Null when no word times were delivered. */
  wordsFrom: "clip" | "voice" | null;
  /** #1848: what those times actually describe. "this-file" — they were measured
   *  on the very file `wordsFrom` names, so they hold to the frame.
   *  "original-performance" — the clip's cast voice was swapped in AFTER the
   *  times were measured, so they describe the take that was replaced: close,
   *  but not frame-exact, and nothing re-measures them. Null when no words came. */
  wordsDescribe: "original-performance" | "this-file" | null;
  voice: string | null;
  keyframe: string | null;
  qc: ClipQc | null;
  /** #1708: true when the cast voice was applied over the clip's generated voice,
   *  false when the clip kept it, null when there is no clip. */
  revoiced: boolean | null;
  /** #1708: true when the clip was trimmed to its spoken words; null without a clip. */
  speechTrimmed: boolean | null;
  /** #1858: the stored file the video model made, when the voice pass replaced
   *  the clip with a new file. Null when the clip IS that file, or there is none. */
  rawStorageId: string | null;
  /** #2299: "voice-first" when the clip was redone voice first (its line
   *  recorded, then the picture made to match). Null otherwise or without a clip. */
  voiceMode: "voice-first" | null;
  /** #2534: the made-up names that kept a requested voice-first redo the usual
   *  way. Null otherwise or without a clip. */
  voiceFirstBlockedBy: string[] | null;
  /** #3051: the take's median speaking pitch (Hz) that the per-character pitch
   *  check compared, and how it was read. Null when unmeasured or without a clip. */
  voicePitchHz: number | null;
  voicePitchMethod: string | null;
  /** The clip ledger row's status (pending/running/done/failed), or "missing"
   *  when the run never wrote one. */
  clipStatus: string;
  error: string | null;
  flagged: boolean;
  findings: ClipFinding[];
  /** #1708: what the picture check found on the scene's keyframe (its frame row),
   *  null when the frame row carries no findings list at all, i.e. nobody checked. */
  keyframeFindings: ClipFinding[] | null;
}

export interface PullFailure {
  file: string;
  url: string;
  error: string;
}

export interface ManifestCastRef {
  characterId: string | null;
  name: string | null;
  file: string | null;
  /** The ledger row's status, or "missing" when no row and no downloadable URL. */
  status: string;
  error: string | null;
  /** #1845: the ElevenLabs voice this character was given before the clips were
   *  made, read off the run's storyboard. Null when nobody chose one — those
   *  clips keep the voice the video model invents. */
  voiceId: string | null;
  voiceLabel: string | null;
  /** #1869: how this character is meant to SOUND, in words, on a run whose video
   *  model speaks the lines itself. Null when nobody wrote one. */
  voiceDescription: string | null;
  /** COP-6: the character's views from other angles, beside its front still. Only when there are any. */
  views?: ManifestCastView[];
}

/** COP-6: one view of a character, in its own file; null when its download failed. */
export interface ManifestCastView {
  view: string;
  file: string | null;
}

export type MusicBedState = "on" | "off" | "unknown";

export interface RunVideoChoice {
  videoModel: string;
  videoModelLabel: string;
  voiceMode: string;
  voiceModeLabel: string;
}

/** #2247/#819: the per-clip warning a run raises when the video model baked
 *  music into a scene. Matched by code, never by its wording. */
export const MUSIC_HEARD_CODE = "music-heard";

export interface ManifestFilledPlate {
  file: string | null;
  holds: string[];
  /** #3080: the stage's plate with its holder's lid closed, which its closed-lid scenes copy. */
  lid?: "closed";
}

export interface VideoManifest {
  runId: string;
  pulledAt: string;
  dashboardUrl: string;
  storyboard: string | null;
  reference: string | null;
  /** #2674: the drawn product and the empty room every storyboard picture is
   *  built from (#2627). Null on a run that made neither. */
  productSheet: string | null;
  setPlate: string | null;
  /** #2874: the holder drawn filled (#2868), in stage order, and the objects
   *  each holds. A stage whose plate failed its check is absent, so the file
   *  number counts kept plates; `holds` names the stage. */
  filledPlates: ManifestFilledPlate[];
  music: string | null;
  /**
   * #2247: what the run says about its bed, which is a different question from
   * the `music` filename above — a run can say "on" and still have no bed file
   * yet, or lose the file to a failed download. "unknown" is a run made before
   * the run carried the answer; it is not "off".
   */
  musicBed: MusicBedState;
  /**
   * #2247: the scenes whose clip came back with music baked into it by the
   * video model, from the run's own per-clip measurement (#819). Same scene
   * numbers as `scenes[].sceneIndex`, so a run with no bed can be checked scene
   * by scene rather than only by the absence of a bed file.
   */
  musicHeardScenes: number[];
  /**
   * #2608: scenes a redo is making again right now. Their clip and its words
   * are left out, because the file the run holds is the take being replaced.
   */
  pendingRedo: number[];
  cast: ManifestCastRef[];
  /** Continuous master take, or null when the run has only per-scene VO. */
  narration: { file: string; timing: string } | null;
  scenes: ManifestScene[];
  failed: PullFailure[];
  /**
   * #1869: the record of which rulebook made this cut. Written only when the
   * run carried one, so a manifest from a run that followed none is unchanged.
   */
  provenance?: RunProvenance;
  /** #2282: which video model and voice mode made the clips. Written only when
   *  the run recorded them. */
  videoChoice?: { videoModel: string; voiceMode: string };
  /** #3304: the run's Frame and Pacing, which the cut follows (a "jump-cuts"
   *  pacing is cut with punch-ins). Written only when the run asked for one. */
  shots?: RunShots;
}

/** #3304: the run's Frame ("pov") and Pacing ("jump-cuts", "long-take", "montage"). */
export interface RunShots {
  frame?: string;
  pacing?: string;
}

export const CAST_LEDGER_BASE = HELPER_LEDGER_BASE + 10000;

/**
 * COP-6: the cast band's view rows: a member's side, back and three-quarter
 * views at CAST_VIEW_LEDGER_BASE + 10 * slot + 1..3, beside its front still at
 * CAST_LEDGER_BASE + slot (scout character-views.ts viewRow).
 */
export const CAST_VIEW_LEDGER_BASE = CAST_LEDGER_BASE + 1000;

export function musicBedState(run: VideoRun): MusicBedState {
  if (run.musicBed === undefined) return "unknown";
  return run.musicBed ? "on" : "off";
}

function isPullSceneIndex(sceneIndex: number): boolean {
  return sceneIndex >= 0 && sceneIndex < HELPER_LEDGER_BASE;
}

export interface PullPlan {
  downloads: PullDownload[];
  texts: PullTextFile[];
  manifest: VideoManifest;
}

const FALLBACK_EXT: Record<string, string> = {
  image: "png",
  video: "mp4",
  audio: "mp3",
};

export function extensionFromUrl(url: string): string | undefined {
  const withoutQuery = url.split(/[?#]/)[0];
  const match = withoutQuery.match(/\.([a-z0-9]{1,5})$/i);
  return match ? match[1].toLowerCase() : undefined;
}

function extFor(url: string, family: "image" | "video" | "audio"): string {
  return extensionFromUrl(url) ?? FALLBACK_EXT[family];
}

export function scenePrefix(sceneIndex: number): string {
  return `scene-${String(sceneIndex).padStart(2, "0")}`;
}

/** #1716: the QC stamp on a ledger row's clip, when it has one. */
function clipQcOf(item: NodeItem | undefined): ClipQcTake[] | undefined {
  const artifact = item?.artifact;
  return artifact && artifact.type === "video" ? artifact.qc?.takes : undefined;
}

function outputsOfNodeKind(run: VideoRun, kind: string): ArtifactSubset[] {
  return run.nodes.filter((n) => n.kind === kind).flatMap((n) => n.outputs ?? []);
}

type SceneClipPull = {
  download: PullDownload;
  durationSec: number | null;
  qc: ClipQc | null;
  words: ClipWord[] | null;
  revoiced: boolean;
  speechTrimmed: boolean;
  rawStorageId: string | null;
  voiceMode: "voice-first" | null;
  voiceFirstBlockedBy: string[] | null;
  voicePitchHz: number | null;
  voicePitchMethod: string | null;
};

function clipFromArtifact(
  sceneIndex: number,
  artifact: ArtifactSubset | undefined,
): SceneClipPull | null {
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
  };
}

function keyframeDownload(sceneIndex: number, imageUrl: string): PullDownload {
  return {
    file: `${scenePrefix(sceneIndex)}.keyframe.${extFor(imageUrl, "image")}`,
    url: imageUrl,
  };
}

function reservedCastFrames(items: NodeItem[]): Map<number, NodeItem> {
  const byIndex = new Map<number, NodeItem>();
  for (const item of items) {
    // Cast identity stills only ([CAST_LEDGER_BASE, SET_OPTION_LEDGER_BASE)).
    // Set-gate room options (SET_OPTION_LEDGER_BASE) and cast-gate option
    // renders (CAST_OPTION_LEDGER_BASE) are spend/render records, not cast
    // references (#2202), so they must not leak into the pull manifest as
    // cast-ref files.
    if (
      item.itemKind === "frame" &&
      item.sceneIndex >= CAST_LEDGER_BASE &&
      item.sceneIndex < SET_OPTION_LEDGER_BASE
    ) {
      byIndex.set(item.sceneIndex, item);
    }
  }
  return byIndex;
}

/** What one character's voice is, as the storyboard records it: the #1845
 *  pinned ElevenLabs voice, the #1869 written one, or both. */
interface CastVoiceRecord {
  voiceId: string | null;
  voiceLabel: string | null;
  voiceDescription: string | null;
}

/** #1845/#1869: each character's voice, keyed by character id. It lives on the
 *  storyboard envelope's `cast[]` (convex/lib/workflow/castVoices.ts), not on
 *  the cast lock, so it is read off the storyboard artifact the pull already
 *  has. A storyboard that never carried a cast yields nothing. */
function castVoicePins(
  artifact: Extract<ArtifactSubset, { type: "storyboard" }> | undefined,
): Map<string, CastVoiceRecord> {
  const pins = new Map<string, CastVoiceRecord>();
  let envelope: unknown = artifact?.storyboard;
  if (envelope === undefined && typeof artifact?.storyboardJson === "string") {
    try {
      envelope = JSON.parse(artifact.storyboardJson);
    } catch {
      return pins;
    }
  }
  const cast = (envelope as { cast?: unknown } | undefined)?.cast;
  if (!Array.isArray(cast)) return pins;
  for (const member of cast as Array<Record<string, unknown>>) {
    const characterId = typeof member.characterId === "string" ? member.characterId.trim() : "";
    const voiceId = typeof member.voiceId === "string" ? member.voiceId.trim() : "";
    const description =
      typeof member.voiceDescription === "string" ? member.voiceDescription.trim() : "";
    if (!characterId || (!voiceId && !description)) continue;
    const label = typeof member.voiceLabel === "string" ? member.voiceLabel.trim() : "";
    pins.set(characterId, {
      voiceId: voiceId ? voiceId : null,
      voiceLabel: voiceId && label ? label : null,
      voiceDescription: description ? description : null,
    });
  }
  return pins;
}

/**
 * COP-6: a lock member's views, in the lock's order (side, back, three-quarter).
 * Each is the member's own entry on the lock, never a row's slot: rows outlive
 * a re-run, so a slot can still hold an earlier member's view. Like the front,
 * a view downloads from the ledger row holding the same picture (the same
 * storage id, or the same link on a row with none), else from the lock's own
 * link. A view row no member holds is never listed, nor one with no picture.
 */
function lockViews(member: PullCastLockMember, viewRows: ReadonlyArray<NodeItem>): Array<{ view: string; url: string }> {
  return (member.identityRefs ?? []).flatMap((ref) => {
    if (!ref.view) return [];
    const row = viewRows.find(({ artifact: art }) =>
      art?.type !== "image"
        ? false
        : art.storageId
          ? art.storageId === ref.storageId
          : !!art.imageUrl && art.imageUrl === ref.imageUrl,
    );
    const url = (row?.artifact?.type === "image" ? row.artifact.imageUrl : undefined) ?? ref.imageUrl;
    return url ? [{ view: ref.view, url }] : [];
  });
}

function planCastRefs(
  run: VideoRun,
  items: NodeItem[],
  pins: Map<string, CastVoiceRecord>,
): { cast: ManifestCastRef[]; downloads: PullDownload[] } {
  const ledger = reservedCastFrames(items);
  // COP-6: a view row rides its member's entry, never one of its own.
  const isViewRow = ([sceneIndex, row]: [number, NodeItem]) =>
    sceneIndex >= CAST_VIEW_LEDGER_BASE || (row.artifact?.type === "image" && row.artifact.view !== undefined);
  const sorted = [...ledger.entries()].sort(([a], [b]) => a - b);
  const ledgerRows = sorted.filter((r) => !isViewRow(r));
  const viewRows = sorted.filter(isViewRow).map(([, row]) => row);
  const locked = run.castLock?.cast;
  const rows: Array<{
    characterId: string | null;
    name: string | null;
    url: string | undefined;
    status: string;
    error: string | null;
    stem: string;
    views: Array<{ view: string; url: string }>;
  }> = [];

  if (locked !== undefined && locked.length > 0) {
    const claimedStorageIds = new Set<string>();
    for (const member of locked) {
      const storageId = member.identityRefs?.[0]?.storageId;
      const item =
        typeof storageId === "string" && storageId.length > 0
          ? ledgerRows.find(([, row]) => {
              const art = row.artifact;
              return art?.type === "image" && art.storageId === storageId;
            })?.[1]
          : undefined;
      if (typeof storageId === "string" && storageId.length > 0) {
        claimedStorageIds.add(storageId);
      }
      // Prefer the ledger artifact URL when present (same source other pull files use).
      // Fall back to the lock URL for reused stills that wrote no new ledger row.
      const art = item?.artifact;
      const url =
        (art?.type === "image" ? art.imageUrl : undefined) ??
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
      if (typeof sid === "string" && claimedStorageIds.has(sid)) continue;
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
  } else {
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

  const cast: ManifestCastRef[] = [];
  const downloads: PullDownload[] = [];
  for (const row of rows) {
    const file = row.url ? `${row.stem}.${extFor(row.url, "image")}` : null;
    const pin = row.characterId ? pins.get(row.characterId) : undefined;
    // COP-6: cast-<characterId>-<view>, beside the front's cast-<characterId>.
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
    if (file && row.url) downloads.push({ file, url: row.url });
    for (const v of views) downloads.push({ file: v.file, url: v.url });
  }
  return { cast, downloads };
}

function isNarrationMaster(artifact: ArtifactSubset): boolean {
  return (
    artifact.type === "audio" &&
    artifact.sceneIndex === undefined &&
    Array.isArray(artifact.narration?.cuts)
  );
}

export function planPull(
  run: VideoRun,
  items: NodeItem[],
  opts: { pulledAt: string; dashboardUrl: string },
): PullPlan {
  const texts: PullTextFile[] = [];

  const storyboardArtifact = run.nodes
    .flatMap((n) => n.outputs ?? [])
    .find((a): a is Extract<ArtifactSubset, { type: "storyboard" }> => a.type === "storyboard");
  let storyboard: string | null = null;
  if (storyboardArtifact) {
    const raw =
      typeof storyboardArtifact.storyboardJson === "string"
        ? storyboardArtifact.storyboardJson
        : storyboardArtifact.storyboard !== undefined
          ? JSON.stringify(storyboardArtifact.storyboard, null, 2)
          : undefined;
    if (raw !== undefined) {
      storyboard = "storyboard.json";
      texts.push({ file: storyboard, body: raw.endsWith("\n") ? raw : `${raw}\n` });
    }
  }

  // Every slot below holds AT MOST ONE artifact, the last the run emitted. A
  // retaken scene emits a second artifact, sometimes in a different container
  // (.mov replacing .mp4), so keying on the slot rather than on the filename is
  // what stops the older take being downloaded as a file nothing indexes.
  // #2627: the set plate and product sheet ride on the reference node beside
  // the reference picture, told apart only by their `anchor`.
  let reference: PullDownload | null = null;
  let productSheet: PullDownload | null = null;
  let setPlate: PullDownload | null = null;
  // #2874: keyed by what the stage holds, because the outputs carry no stage
  // number and a stage whose plate failed its check is left out of them.
  // #3080: a stage's closed-lid plate is its own entry, named for that stage.
  const filledByStage = new Map<string, { holds: string[]; url: string; lid?: "closed" }>();
  for (const artifact of outputsOfNodeKind(run, "reference")) {
    if (artifact.type !== "image" || !artifact.imageUrl) continue;
    if (artifact.anchor === "filled-plate") {
      const holds = artifact.holds ?? [];
      const lid = artifact.lid;
      filledByStage.set(JSON.stringify([holds, lid ?? null]), { holds, url: artifact.imageUrl, ...(lid ? { lid } : {}) });
      continue;
    }
    const stem = artifact.anchor ?? "reference";
    const download = { file: `${stem}.${extFor(artifact.imageUrl, "image")}`, url: artifact.imageUrl };
    if (artifact.anchor === "product-sheet") productSheet = download;
    else if (artifact.anchor === "set-plate") setPlate = download;
    else if (!artifact.anchor) reference = download;
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

  const keyframeByScene = new Map<number, PullDownload>();
  for (const artifact of run.nodes.flatMap((n) => n.outputs ?? [])) {
    if (artifact.type !== "frames") continue;
    for (const frame of artifact.frames ?? []) {
      if (!frame.imageUrl) continue;
      if (!isPullSceneIndex(frame.sceneIndex)) continue;
      keyframeByScene.set(frame.sceneIndex, keyframeDownload(frame.sceneIndex, frame.imageUrl));
    }
  }

  const voiceByScene = new Map<number, { download: PullDownload; words: ClipWord[] | null }>();
  let narrationDownload: PullDownload | null = null;
  let narrationMaster: Extract<ArtifactSubset, { type: "audio" }> | null = null;
  for (const artifact of outputsOfNodeKind(run, "voiceover")) {
    if (artifact.type !== "audio" || !artifact.audioUrl) continue;
    if (isNarrationMaster(artifact)) {
      narrationMaster = artifact;
      narrationDownload = {
        file: `narration.${extFor(artifact.audioUrl, "audio")}`,
        url: artifact.audioUrl,
      };
      continue;
    }
    if (typeof artifact.sceneIndex !== "number" || !isPullSceneIndex(artifact.sceneIndex)) continue;
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
        file:
          voiceByScene.get(cut.sceneIndex)?.download.file ??
          `${scenePrefix(cut.sceneIndex)}.voice.mp3`,
      })),
    };
    texts.push({
      file: "narration.json",
      body: `${JSON.stringify(timing, null, 2)}\n`,
    });
  }

  const clipByScene = new Map<number, SceneClipPull>();
  let music: PullDownload | null = null;
  for (const artifact of outputsOfNodeKind(run, "video")) {
    if (artifact.type === "audio" && artifact.sceneIndex === undefined && artifact.audioUrl) {
      music = { file: `music.${extFor(artifact.audioUrl, "audio")}`, url: artifact.audioUrl };
      continue;
    }
    if (artifact.type !== "video" || typeof artifact.sceneIndex !== "number") continue;
    if (!isPullSceneIndex(artifact.sceneIndex)) continue;
    const clip = clipFromArtifact(artifact.sceneIndex, artifact);
    if (!clip) continue;
    clipByScene.set(artifact.sceneIndex, clip);
  }

  const clipItemByScene = new Map<number, NodeItem>();
  const frameItemByScene = new Map<number, NodeItem>();
  // The reference node also writes a "frame" row (scene 0); only the scene-frames
  // node's rows are scene keyframes.
  const sceneFrameNodeIds = new Set(
    run.nodes.filter((n) => n.kind === "scene-frames").map((n) => n.nodeId),
  );
  for (const item of items) {
    if (!isPullSceneIndex(item.sceneIndex)) continue;
    if (item.itemKind === "clip") clipItemByScene.set(item.sceneIndex, item);
    if (item.itemKind === "frame" && sceneFrameNodeIds.has(item.nodeId)) {
      frameItemByScene.set(item.sceneIndex, item);
    }
  }

  for (const [sceneIndex, item] of clipItemByScene) {
    if (item.status !== "done" || clipByScene.has(sceneIndex)) continue;
    const clip = clipFromArtifact(sceneIndex, item.artifact);
    if (!clip) continue;
    clipByScene.set(sceneIndex, clip);
  }
  for (const [sceneIndex, item] of frameItemByScene) {
    if (item.status !== "done" || keyframeByScene.has(sceneIndex)) continue;
    const artifact = item.artifact;
    if (!artifact || artifact.type !== "image" || !artifact.imageUrl) continue;
    keyframeByScene.set(sceneIndex, keyframeDownload(sceneIndex, artifact.imageUrl));
  }

  const pendingRedo = scenesBeingRedone(run, items);
  for (const sceneIndex of pendingRedo) clipByScene.delete(sceneIndex);

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

  const scenes: ManifestScene[] = sceneIndexes.map((sceneIndex) => {
    const clip = clipByScene.get(sceneIndex);
    const voice = voiceByScene.get(sceneIndex);
    const item = clipItemByScene.get(sceneIndex);
    const frameItem = frameItemByScene.get(sceneIndex);
    // #1689: a narrated scene's timings ride on its voice track. The clip wins
    // when both exist, because a clip with its own dialogue is what plays; the
    // voice track only fills a silent clip.
    let source: ClipWord[] | null = null;
    let wordsFrom: "clip" | "voice" | null = null;
    if (clip?.words && clip.words.length > 0) {
      source = clip.words;
      wordsFrom = "clip";
    } else if (voice?.words && voice.words.length > 0) {
      source = voice.words;
      wordsFrom = "voice";
    }
    let words: string | null = null;
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
      // #1848: nothing re-measures a clip's word times after its cast voice is
      // swapped in, so say which take they describe rather than let a cut tool
      // assume they were measured on the file it is about to play.
      wordsDescribe:
        wordsFrom === null
          ? null
          : clip?.revoiced === true && wordsFrom === "clip"
            ? "original-performance"
            : "this-file",
      voice: voice?.download.file ?? null,
      keyframe: keyframeByScene.get(sceneIndex)?.file ?? null,
      // #1716: the take history rides the manifest with the checker's own words
      // taken out — the same rule `withoutJudgeFields` applies to the findings
      // just below, and for the same reason.
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

  const { cast, downloads: castDownloads } = planCastRefs(
    run,
    items,
    castVoicePins(storyboardArtifact),
  );

  const downloads: PullDownload[] = [
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

export function markPullFailure(manifest: VideoManifest, failure: PullFailure): void {
  manifest.failed.push(failure);
  if (manifest.storyboard === failure.file) manifest.storyboard = null;
  if (manifest.reference === failure.file) manifest.reference = null;
  if (manifest.productSheet === failure.file) manifest.productSheet = null;
  if (manifest.setPlate === failure.file) manifest.setPlate = null;
  for (const plate of manifest.filledPlates) {
    if (plate.file === failure.file) plate.file = null;
  }
  if (manifest.music === failure.file) manifest.music = null;
  for (const ref of manifest.cast) {
    if (ref.file === failure.file) ref.file = null;
    for (const view of ref.views ?? []) {
      if (view.file === failure.file) view.file = null;
    }
  }
  if (manifest.narration?.file === failure.file) manifest.narration = null;
  for (const scene of manifest.scenes) {
    // #1689: the word times are relative to ONE file. If that file never
    // landed, the cut would play the other track and read these times against
    // it, so the times go with the file they were measured on.
    const lostWordsSource =
      (scene.clip === failure.file && scene.wordsFrom === "clip") ||
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
    if (scene.voice === failure.file) scene.voice = null;
    if (scene.keyframe === failure.file) scene.keyframe = null;
    if (scene.words === failure.file || lostWordsSource) {
      scene.words = null;
      scene.wordsFrom = null;
      scene.wordsDescribe = null;
    }
  }
}

const PULL_CONCURRENCY = 4;

async function runPool<T>(jobs: Array<() => Promise<T>>, size: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= jobs.length) return;
      results[index] = await jobs[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker));
  return results;
}

const DOWNLOAD_ATTEMPTS = 2;

async function downloadWithRetry(
  download: PullDownload,
  dir: string,
  deps: VideoDeps,
): Promise<PullFailure | null> {
  let lastError = "";
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      await deps.downloadToFile(download.url, path.join(dir, download.file));
      return null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { file: download.file, url: download.url, error: lastError };
}

const SETUP_LABELS: Array<{ key: "set" | "cast" | "voices"; label: string }> = [
  { key: "set", label: "Set" },
  { key: "cast", label: "Cast" },
  { key: "voices", label: "Voices" },
];

export function missingSetupLabels(progress: ShowRow["setupProgress"]): string[] {
  if (!progress) return [];
  return SETUP_LABELS.filter(({ key }) => progress[key] !== true).map(({ label }) => label);
}

export async function showsFlow(json: boolean, deps: VideoDeps): Promise<FlowResult> {
  const res = await deps.get(SHOWS_PATH);
  if (!res.ok) return errorResult(res, json);
  const shows = ((res.data as { shows?: ShowRow[] }).shows ?? []).slice();
  if (json) return { code: 0, lines: [JSON.stringify({ shows })] };
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
      const state =
        show.ready === true
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

export interface StartOptions {
  showId: string;
  scriptFile: string;
  voicePath?: string;
  /** #2247: see `planMusicChoice`. Undefined is "nobody said". */
  music?: boolean;
  wait: boolean;
  json: boolean;
  onProgressLine?: (line: string) => void;
}

export interface ScriptStartOptions {
  scriptFile: string;
  conceit: string;
  style: string;
  direction?: string;
  voicePath?: string;
  videoModel?: string;
  voiceMode?: VoiceMode;
  /** #2247: see `planMusicChoice`. Undefined is "nobody said". */
  music?: boolean;
  /** #2587: stop at the storyboard for the member. Absent, the app approves
   *  its own storyboard when its checks pass. Set unless --one-shot is given
   *  (Guided is the default since Oct 14, 2026). */
  reviewStoryboard?: true;
  /** #2675: start with the trial director on for this run (admins only). */
  director?: true;
  /** #3304: --frame / --pacing, sent as typed. The server judges them against
   *  the kind of ad and refuses one it can't follow. */
  shots?: RunShots;
  /** COP-47: print the script the run would start on, and start nothing. */
  stopAtScript?: true;
  wait: boolean;
  json: boolean;
  onProgressLine?: (line: string) => void;
}

export type VideoStartPlan =
  | { kind: "usage"; line: string }
  | { kind: "show"; opts: StartOptions }
  | { kind: "script"; opts: ScriptStartOptions };

export async function startFlow(opts: StartOptions, deps: VideoDeps): Promise<FlowResult> {
  let script: string;
  try {
    script = deps.readFile(opts.scriptFile);
  } catch (e) {
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
    // A Show's own setting is the default here, so both answers have to travel.
    ...(opts.music === undefined ? {} : { music: opts.music }),
  });
  if (!res.ok) return errorResult(res, opts.json);
  const started = res.data as { runId?: string; url?: string };
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

/** #3237: a human --wait prints the start lines and each stage change as they happen. */
async function startedThenWait(
  runId: string,
  head: string[],
  opts: { json: boolean; url: string; onProgressLine?: (line: string) => void },
  deps: VideoDeps,
): Promise<FlowResult> {
  const stream = opts.json ? undefined : opts.onProgressLine;
  if (stream) for (const line of [...head, ""]) stream(line);
  const waited = await waitFlow(runId, { json: opts.json, url: opts.url, onProgressLine: stream }, deps);
  if (opts.json || stream) return waited;
  return { code: waited.code, lines: [...head, "", ...waited.lines] };
}

function nonBlank(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}

function isVoiceMode(value: string): value is VoiceMode {
  return VOICE_MODES.some((mode) => mode === value);
}

export type MusicChoice = { ok: true; music: boolean | undefined } | { ok: false; line: string };

/**
 * #2247: the music answer as one tri-state. `--music` is on, `--no-music` is
 * off, `--music=true|false` and `--music true|false` write the same two answers
 * out, and undefined is "nobody said" — which each door reads as its own
 * default: a Show keeps the Show's setting, a paste-a-script run gets no bed.
 *
 * Read from `occurrences`, not `flags`: #2258 found that `parseArgs` files
 * `--music=false` under the whole key `music=false`, so a reader of `flags`
 * alone sees no music answer at all and quietly starts the run with a bed.
 * Last one typed wins, the rule `flags` already follows.
 */
export function planMusicChoice(occurrences: FlagOccurrence[]): MusicChoice {
  let music: boolean | undefined;
  for (const { flag, value } of occurrences) {
    if (flag === "no-music") {
      music = false;
      continue;
    }
    if (flag !== "music") continue;
    // `parseArgs` records the next word here even when that word is itself a
    // flag, so `--music --wait` is a bare `--music`, not `--music "--wait"`.
    if (value === undefined || value.startsWith("--")) {
      music = true;
      continue;
    }
    const word = value.trim().toLowerCase();
    // Two literal comparisons, not a map lookup: an object map would answer
    // `--music=constructor` from the prototype chain and let it through.
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

type ValueFlag = { ok: true; value: string | undefined } | { ok: false; line: string };

/**
 * #2282: a flag that must carry a value, read from `occurrences` so that
 * `--video-model=veo3` counts (parseArgs files it under the whole key) and a
 * bare `--video-model` or `--video-model --wait` is refused. Dropping either
 * would start a paid run on the recipe's default. Last one typed wins.
 */
function planValueFlag(occurrences: FlagOccurrence[], name: string): ValueFlag {
  let value: string | undefined;
  for (const occurrence of occurrences) {
    if (occurrence.flag !== name) continue;
    const given = occurrence.value;
    if (given === undefined || given.startsWith("--") || given.trim().length === 0) {
      return { ok: false, line: `video start --${name} needs a value.` };
    }
    value = given.trim();
  }
  return { ok: true, value };
}

export function planVideoStart(
  flags: Record<string, string | boolean>,
  occurrences: FlagOccurrence[],
): VideoStartPlan {
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
  if (!musicChoice.ok) return { kind: "usage", line: musicChoice.line };
  const videoModelFlag = planValueFlag(occurrences, "video-model");
  if (!videoModelFlag.ok) return { kind: "usage", line: videoModelFlag.line };
  const voiceFlag = planValueFlag(occurrences, "voice");
  if (!voiceFlag.ok) return { kind: "usage", line: voiceFlag.line };
  const frameFlag = planValueFlag(occurrences, "frame");
  if (!frameFlag.ok) return { kind: "usage", line: frameFlag.line };
  const pacingFlag = planValueFlag(occurrences, "pacing");
  if (!pacingFlag.ok) return { kind: "usage", line: pacingFlag.line };
  const videoModel = videoModelFlag.value;
  const voiceMode = voiceFlag.value;
  // Guided is the default (Luke, Oct 14): the run stops at the storyboard
  // unless --one-shot asks for the whole video in one go. --review-storyboard
  // asks for the default and stays accepted for the scripts that pass it.
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
  // #2675: `--director false` must not start a paid review, so any value is refused.
  if (directorFlags.some((o) => o.value !== undefined && !o.value.startsWith("--"))) {
    return {
      kind: "usage",
      line: "--director takes no value. Leave it off to start without the director.",
    };
  }
  const director = directorFlags.length > 0;
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
  if (showId && director) {
    return {
      kind: "usage",
      line: "--director works with --conceit, not --show.",
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
  const opts: ScriptStartOptions = {
    scriptFile,
    conceit,
    style,
    wait: flags["wait"] === true,
    json: flags["json"] === true,
  };
  if (direction) opts.direction = direction;
  if (voicePath) opts.voicePath = voicePath;
  if (videoModel) opts.videoModel = videoModel;
  if (voiceMode && isVoiceMode(voiceMode)) opts.voiceMode = voiceMode;
  if (musicChoice.music !== undefined) opts.music = musicChoice.music;
  if (!oneShot) opts.reviewStoryboard = true;
  if (director) opts.director = true;
  if (stopAtScript) opts.stopAtScript = true;
  if (frameFlag.value || pacingFlag.value) {
    opts.shots = {
      ...(frameFlag.value ? { frame: frameFlag.value } : {}),
      ...(pacingFlag.value ? { pacing: pacingFlag.value } : {}),
    };
  }
  return { kind: "script", opts };
}

interface ResolvedCard {
  conceit: { key: string; label: string };
  family: string;
  wrapper: string | null;
  style: { slug: string; label: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The options body, or null when it is not `{ conceits, styles }` of labeled rows. */
function scriptRunOptionsOf(data: unknown): ScriptRunOptions | null {
  if (!isRecord(data) || !Array.isArray(data.conceits) || !Array.isArray(data.styles)) {
    return null;
  }
  const conceits: ScriptRunOptions["conceits"] = [];
  for (const row of data.conceits) {
    if (!isRecord(row) || typeof row.key !== "string" || typeof row.label !== "string") return null;
    conceits.push({ key: row.key, label: row.label });
  }
  const styles: ScriptRunOptions["styles"] = [];
  for (const row of data.styles) {
    if (!isRecord(row) || typeof row.slug !== "string" || typeof row.label !== "string") return null;
    styles.push({ slug: row.slug, label: row.label });
  }
  return { conceits, styles };
}

function isResolvedCard(value: unknown): value is ResolvedCard {
  if (!isRecord(value)) return false;
  if (!isRecord(value.conceit) || !isRecord(value.style)) return false;
  if (typeof value.conceit.key !== "string" || typeof value.conceit.label !== "string") return false;
  if (typeof value.family !== "string") return false;
  if (!("wrapper" in value)) return false;
  if (value.wrapper !== null && typeof value.wrapper !== "string") return false;
  if (typeof value.style.slug !== "string" || typeof value.style.label !== "string") return false;
  return true;
}

interface StartedVideoChoice {
  videoModel: string;
  voiceMode: string;
}

function startedVideoChoice(value: unknown): StartedVideoChoice | null {
  if (!isRecord(value)) return null;
  if (typeof value.videoModel !== "string" || typeof value.voiceMode !== "string") return null;
  return { videoModel: value.videoModel, voiceMode: value.voiceMode };
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isCastNote(value: unknown): value is { name: string; description: string } {
  return isRecord(value) && typeof value.name === "string" && typeof value.description === "string";
}

/** COP-47: the start answer's tidy notes, or null when the server started the script as sent. */
function scriptTidiedOf(value: unknown): ScriptTidied | null {
  if (!isRecord(value)) return null;
  const added = isRecord(value.added) ? value.added : {};
  return {
    setAside: stringsOf(value.setAside),
    added: {
      names: stringsOf(added.names),
      descriptions: Array.isArray(added.descriptions) ? added.descriptions.filter(isCastNote) : [],
    },
  };
}

/** COP-47: what the server's tidy did to the script, in Door 1's words, then a blank line. */
function scriptTidiedHead(tidied: ScriptTidied | null): string[] {
  if (!tidied) return [];
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

/** COP-47: a script the server wrote from a description, printed in full. */
function scriptWrittenHead(written: string | null, started: boolean): string[] {
  if (written === null) return [];
  return [
    started
      ? "Your file described the ad, so we wrote this script from it and started the run on it:"
      : "Your file described the ad, so we wrote this script from it:",
    "",
    ...written.split("\n").map((line) => (line ? `  ${line}` : "")),
    "",
  ];
}

function writtenOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * COP-47: the answer that starts nothing because the script needs the caller
 * first: a line nobody says (SCRIPT_QUESTION). Null for any other refusal.
 */
function scriptQuestionResult(res: ApiResponse<unknown>, json: boolean): FlowResult | null {
  const data = res.data;
  if (!isRecord(data) || !isRecord(data.error) || data.error.code !== "SCRIPT_QUESTION") return null;
  const message = formatApiError(res);
  const lines = stringsOf(data.lines);
  if (json) {
    return {
      code: 1,
      lines: [JSON.stringify({ ok: false, status: res.status, code: "SCRIPT_QUESTION", error: message, lines })],
    };
  }
  return { code: 1, lines: [message] };
}

/**
 * COP-47: a start the server refused. When it laid the script out or wrote it
 * first, the notes come ahead of the refusal, since the refusal reads that
 * script, and --json carries it so it can be sent back without a second layout.
 */
function scriptStartRefused(res: ApiResponse<unknown>, json: boolean): FlowResult {
  const data = isRecord(res.data) ? res.data : {};
  const tidied = data.tidied === undefined ? null : scriptTidiedOf(data.tidied);
  const written = writtenOf(data.written);
  if (!tidied && written === null) return errorResult(res, json);
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
            ...(script !== null ? { script } : {}),
          }),
        ]
      : [...scriptTidiedHead(tidied), ...scriptWrittenHead(written, false), error],
  };
}

/** COP-47: --stop-at-script: the script the run would start on, and nothing started. */
function stoppedAtScriptResult(data: Record<string, unknown>, json: boolean): FlowResult {
  const script = typeof data.script === "string" ? data.script : "";
  const tidied = data.tidied === undefined ? null : scriptTidiedOf(data.tidied);
  const written = writtenOf(data.written);
  if (json) {
    return {
      code: 0,
      lines: [
        JSON.stringify({
          stoppedAtScript: true,
          script,
          ...(tidied ? { tidied } : {}),
          ...(written !== null ? { written } : {}),
        }),
      ],
    };
  }
  return {
    code: 0,
    lines: [
      ...scriptTidiedHead(tidied),
      written !== null
        ? "Your file described the ad, so we wrote this script from it. Nothing has started."
        : "This is the script the run would start on. Nothing has started.",
      "",
      ...script.split("\n").map((line) => (line ? `  ${line}` : "")),
      "",
      "To start it, save it to a file and run the same command with --script <that file> and without --stop-at-script.",
    ],
  };
}

function scriptStartedLines(
  runId: string,
  url: string,
  card: ResolvedCard | null,
  video: StartedVideoChoice | null,
  director: boolean,
): string[] {
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

/** The start's own facts added to the one JSON answer a --json --wait prints. */
function waitJsonWith(waited: FlowResult, facts: Record<string, unknown>): FlowResult {
  const first = waited.lines[0];
  if (typeof first !== "string") return waited;
  let parsed: unknown;
  try {
    parsed = JSON.parse(first);
  } catch {
    return waited;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return waited;
  return {
    code: waited.code,
    lines: [JSON.stringify({ ...parsed, ...facts })],
  };
}

export async function startScriptFlow(
  opts: ScriptStartOptions,
  deps: VideoDeps,
): Promise<FlowResult> {
  let script: string;
  try {
    script = deps.readFile(opts.scriptFile);
  } catch (e) {
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

  // The list only lets the CLI refuse a bad word before the upload. When it
  // can't be read (an older server without the route, a failing one, or no
  // answer at all), post
  // anyway: the server refuses a word it does not offer.
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
    // #2247: a paste-a-script run has no bed unless it is asked for, so "off"
    // and "nobody said" are the same request. Only "on" has anything to send.
    ...(opts.music === true ? { music: true } : {}),
    ...(opts.reviewStoryboard ? { reviewStoryboard: true } : {}),
    ...(opts.director ? { director: true } : {}),
    ...(opts.shots ? { shots: opts.shots } : {}),
    ...(opts.stopAtScript ? { stopAtScript: true } : {}),
  });
  if (!res.ok) return scriptQuestionResult(res, opts.json) ?? scriptStartRefused(res, opts.json);
  if (isRecord(res.data) && res.data.stoppedAtScript === true) {
    return stoppedAtScriptResult(res.data, opts.json);
  }
  const customerStart = customerAnswer<CustomerStart>(res.data);
  if (customerStart) return customerStartedResult(customerStart, opts, deps);
  const started = res.data as {
    runId?: string;
    url?: string;
    card?: unknown;
    videoChoice?: unknown;
    tidied?: unknown;
    written?: unknown;
  };
  if (!started.runId) {
    return { code: 1, lines: ["The server started the ad but did not say which run it is."] };
  }
  const runId = started.runId;
  const url = typeof started.url === "string" ? started.url : "";
  const card = isResolvedCard(started.card) ? started.card : null;
  const video = startedVideoChoice(started.videoChoice);
  const tidied = started.tidied === undefined ? null : scriptTidiedOf(started.tidied);
  const written = writtenOf(started.written);
  const facts = {
    card,
    ...(video ? { videoChoice: video } : {}),
    ...(tidied ? { tidied } : {}),
    ...(written !== null ? { written } : {}),
  };
  const head = [...scriptTidiedHead(tidied), ...scriptWrittenHead(written, true)];

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

  const waited = await startedThenWait(
    runId,
    [...head, ...scriptStartedLines(runId, url, card, video, opts.director === true)],
    { ...opts, url },
    deps,
  );
  return opts.json ? waitJsonWith(waited, facts) : waited;
}

async function customerStartedResult(
  started: CustomerStart,
  opts: ScriptStartOptions,
  deps: VideoDeps,
): Promise<FlowResult> {
  const { runId, dashboardUrl } = started;
  const tidied = started.tidied === undefined ? null : scriptTidiedOf(started.tidied);
  const written = writtenOf(started.written);
  const head = [
    ...scriptTidiedHead(tidied),
    ...scriptWrittenHead(written, true),
    `Started video ${runId}`,
    `Watch it: ${dashboardUrl}`,
  ];
  if (opts.wait) {
    const waited = await startedThenWait(runId, head, { ...opts, url: dashboardUrl }, deps);
    const facts = { ...(tidied ? { tidied } : {}), ...(written !== null ? { written } : {}) };
    return opts.json && (tidied || written !== null) ? waitJsonWith(waited, facts) : waited;
  }
  if (opts.json) return { code: 0, lines: [JSON.stringify(started)] };
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

export async function waitFlow(
  runId: string,
  opts: {
    json: boolean;
    url?: string;
    intervalMs?: number;
    maxPolls?: number;
    onProgressLine?: (line: string) => void;
  },
  deps: VideoDeps,
): Promise<FlowResult> {
  const interval = opts.intervalMs ?? POLL_INTERVAL_MS;
  const maxPolls = opts.maxPolls ?? MAX_POLLS;
  const lines: string[] = [];
  let lastProgress: string | null = null;
  let redoSeen = false;
  const progress = (line: string): void => {
    if (line === lastProgress) return;
    lastProgress = line;
    if (opts.json) return;
    if (opts.onProgressLine) opts.onProgressLine(line);
    else lines.push(line);
  };

  for (let poll = 0; poll < maxPolls; poll++) {
    if (poll > 0) await deps.sleep(interval);
    const res = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!res.ok) {
      const failed = errorResult(res, opts.json);
      return { code: failed.code, lines: [...lines, ...failed.lines] };
    }
    const customer = customerAnswer<CustomerRun>(res.data);
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
      progress(
        stop.autoRedoScenes?.length
          ? autoRedoLine(stop.autoRedoScenes, stop.autoRedoReasons)
          : `Working: ${stageWord(stop.stage)}…`,
      );
      continue;
    }
    let items: NodeItem[] | null = null;
    if (stop.at === "final-watch") {
      const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
      items = itemsRes.ok ? ((itemsRes.data as { items?: NodeItem[] }).items ?? []) : null;
      // #2608: a redo someone asked for leaves the run parked at the final
      // watch, so only the scene rows show its clip is still being made. A
      // failed read mid-redo proves nothing finished, so it keeps waiting too.
      if (items === null && redoSeen) continue;
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

const ITEM_STATUS_WORD: Record<string, string> = {
  done: "done",
  failed: "failed",
  running: "working",
  idle: "waiting",
  skipped: "skipped",
};

function itemWord(item: NodeItem | undefined): string {
  if (!item) return "—";
  // #1870: first, because nothing clears `flagged` when a redo dies. A flagged
  // clip whose redo stopped would otherwise still read "flagged", hiding the
  // one thing the member has to act on. The grid has one word per cell, so it
  // says the true one and the redo commands take the scene again.
  if (item.staleClaim === true) return "stopped";
  if (item.flagged === true) return "flagged";
  return ITEM_STATUS_WORD[item.status] ?? item.status;
}

/**
 * #1903: a queued run that has ALREADY worked — an approved gate, a retry, or a
 * long step handing itself to a fresh worker. "Queued" alone reads like nothing
 * has happened yet, which is what made a hand-over look like a loss. Same rule
 * and same words as the run page's queued sentence.
 */
const CARRYING_ON_LINE =
  "Waiting for a worker to carry on. Everything finished so far is kept — the run picks up from there by itself.";

function carryingOn(run: VideoRun): boolean {
  return (
    run.status === "queued" &&
    run.nodes.some((n) => n.status !== "idle" && n.status !== "out-of-scope")
  );
}

export async function statusFlow(
  runId: string,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!runRes.ok) return errorResult(runRes, json);
  const customer = customerAnswer<CustomerRun>(runRes.data);
  if (customer) {
    return {
      code: 0,
      lines: json ? [JSON.stringify(customer)] : customerStatusLines(customer, deps.dashboardUrl),
    };
  }
  const run = asVideoRun(runRes.data);

  const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!itemsRes.ok) return errorResult(itemsRes, json);
  const items = (itemsRes.data as { items?: NodeItem[] }).items ?? [];

  // #1704: one fact, read once, driving the guidance block, the footer and the
  // `hasFinal` field alike — the three used to be able to contradict each other.
  const hasFinal = hasAttachedCut(items);
  const stop = resolveStop(classifyRun(run), hasFinal);

  // #1902: what happened to a storyboard that failed. Read once, printed below
  // and reported in --json from the one node, so the screen and the machine
  // answer cannot describe different steps.
  const failedStoryboard = failedStoryboardNode(run);

  // This is the one surface that prints the record UNDER the stop, so it is the
  // one that can drop the raw error the record restates. `wait` keeps its error:
  // it prints no record, so there the error is the whole story. The `stop` the
  // --json object carries is untouched either way.
  const guidance = stopLines(
    stop.at === "failed" && errorEchoesReasons(stop.error, failedStoryboard?.planFailure)
      ? { ...stop, error: undefined }
      : stop,
    runId,
    reviewUrl(deps.dashboardUrl, run),
  );

  const warnings = run.nodes
    .filter((n) => n.warning)
    .map((n) => ({ nodeId: n.nodeId, step: n.kind, warning: n.warning }));

  if (json) {
    return {
      code: 0,
      // #1704: `guidance` is the very array the human render prints below, so a
      // machine reader and a person are told the next step by one derivation.
      lines: [
        JSON.stringify({
          runId,
          status: run.status,
          stop,
          items,
          hasFinal,
          warnings,
          guidance,
          // #2247: whether this run has a bed. Absent when the server said
          // nothing, under the same rule as the two fields below — an absence
          // is "this backend does not say", never "off".
          ...(run.musicBed === undefined ? {} : { musicBed: run.musicBed }),
          // Both fields stay ABSENT when the server sent none. An empty record
          // would read as "nothing happened", and an explicit
          // `hasRejectedDraft: false` would tell an unentitled caller there is
          // something here they may not see.
          ...(failedStoryboard?.planFailure ? { planFailure: failedStoryboard.planFailure } : {}),
          // #2133: which step the failure record belongs to — a run can hold
          // two storyboard steps, and the record must name its own.
          ...(failedStoryboard?.planFailure
            ? { storyboardNodeId: failedStoryboard.nodeId }
            : {}),
          ...(failedStoryboard?.hasRejectedDraft === true ? { hasRejectedDraft: true } : {}),
          ...(run.director ? { director: run.director } : {}),
        }),
      ],
    };
  }

  const revoicedByScene = new Set<number>();
  const voiceFirstByScene = new Set<number>();
  const voiceFirstBlockedByScene = new Map<number, string[]>();
  // #1848: a revoiced clip that also carries word times — those times were
  // measured on the take the cast voice replaced, and nothing re-measures them.
  const timedOnOriginalVoice = new Set<number>();
  for (const artifact of outputsOfNodeKind(run, "video")) {
    if (
      artifact.type === "video" &&
      artifact.voiceMode === "voice-first" &&
      typeof artifact.sceneIndex === "number"
    ) {
      voiceFirstByScene.add(artifact.sceneIndex);
    }
    if (
      artifact.type === "video" &&
      artifact.voiceFirstBlockedBy?.length &&
      typeof artifact.sceneIndex === "number"
    ) {
      voiceFirstBlockedByScene.set(artifact.sceneIndex, artifact.voiceFirstBlockedBy);
    }
    if (artifact.type === "video" && artifact.revoiced === true && typeof artifact.sceneIndex === "number") {
      revoicedByScene.add(artifact.sceneIndex);
      if ((artifact.words?.length ?? 0) > 0) timedOnOriginalVoice.add(artifact.sceneIndex);
    }
  }

  const byScene = new Map<number, { clip?: NodeItem; voiceover?: NodeItem; frame?: NodeItem }>();
  const sceneFrameNodeIds = new Set(
    run.nodes.filter((n) => n.kind === "scene-frames").map((n) => n.nodeId),
  );
  for (const item of items) {
    if (item.itemKind !== "clip" && item.itemKind !== "voiceover" && item.itemKind !== "frame") {
      continue;
    }
    if (item.sceneIndex < 0) continue;
    if (item.itemKind === "frame" && !sceneFrameNodeIds.has(item.nodeId)) continue;
    const row = byScene.get(item.sceneIndex) ?? {};
    row[item.itemKind] = item;
    byScene.set(item.sceneIndex, row);
  }

  // #1687: a repair park's raw status is still "awaiting-approval", so the
  // headline read "Awaiting approval" over a run whose storyboard was dead.
  // The classification is the honest headline for that one case.
  const headline =
    stop.at === "failed" && stop.repair
      ? `Ad run ${runId} — Stopped, a step failed`
      : `Ad run ${runId} — ${displayRunStatus(run.status)}`;
  const lines = [
    headline,
    ...(carryingOn(run) ? [CARRYING_ON_LINE] : []),
    ...guidance,
    // #1883: "Working" alone reads like a run going straight through, and a
    // healthy gated run was cancelled over exactly that.
    ...(stop.at === "running" && run.pauseAhead ? [pauseAheadLine(run.pauseAhead)] : []),
    ...planFailureLines(failedStoryboard, runId),
    ...warnings.map((w) => `Heads-up (${w.step}): ${w.warning}`),
    ...(run.director ? ["", ...directorLines(run.director)] : []),
  ];

  if (byScene.size === 0) {
    lines.push("", "No scenes yet — this run hasn't made anything to look at.");
  } else {
    lines.push("", "Scene  Clip      Voice     Picture");
    for (const sceneIndex of [...byScene.keys()].sort((a, b) => a - b)) {
      const row = byScene.get(sceneIndex)!;
      lines.push(
        `${String(sceneIndex).padEnd(5)}  ${itemWord(row.clip).padEnd(8)}  ${itemWord(row.voiceover).padEnd(8)}  ${itemWord(row.frame)}`,
      );
      // #1855: a redo that fails its checks keeps the original take and leaves
      // the row reading "done", so the grid word alone cannot say whether the
      // member got a new take. The outcome goes first, above the findings that
      // explain it, and names the column it belongs to.
      if (row.clip?.lastRedo) {
        lines.push(`       clip: ${redoLine(row.clip.lastRedo)}`);
        const blocked = row.clip.lastRedo.voiceFirstBlockedBy;
        if (blocked?.length) {
          lines.push(`       clip: asked for voice first, but redone the usual way — ${cantSayNames(blocked)}`);
        }
        printDisplacedHistory(lines, row.clip.lastRedo);
      }
      // #1716: the take history hangs UNDER the redo outcome, so the two read
      // as one record of what this clip went through rather than as two
      // competing ones. Printed only where a reason is already being shown —
      // a flagged clip, or one somebody redid — so an ordinary run grows no
      // noise. A clip from before #1716 says so in as many words.
      if (row.clip?.lastRedo || row.clip?.flagged) {
        for (const line of renderQcTakeHistory(clipQcOf(row.clip))) {
          lines.push(`       ${line}`);
        }
      }
      if (row.voiceover?.lastRedo) {
        lines.push(`       voice: ${redoLine(row.voiceover.lastRedo)}`);
        printDisplacedHistory(lines, row.voiceover.lastRedo);
      }
      if (row.frame?.lastRedo) lines.push(`       picture: ${row.frame.lastRedo.label}`);
      for (const finding of row.clip?.findings ?? []) {
        lines.push(`       ${finding.code} (${finding.severity}): ${finding.detail}`);
        // #1784: what the checker itself said, when it adds something.
        const judgeSeverity = finding.judgeSeverity ?? finding.severity;
        if (finding.judgeDetail) {
          lines.push(`         checker said (${judgeSeverity}): ${finding.judgeDetail}`);
        } else if (judgeSeverity !== finding.severity) {
          lines.push(`         checker rated it ${judgeSeverity}`);
        }
      }
      if (row.clip?.error) lines.push(`       ${row.clip.error}`);
      // #1708: the cast voice applied, and what the picture check found.
      if (revoicedByScene.has(sceneIndex)) lines.push("       voice: cast voice applied");
      if (voiceFirstByScene.has(sceneIndex)) lines.push("       clip: redone voice first");
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

  lines.push(
    "",
    hasFinal && stop.at === "finished"
      ? "Final cut: approved and delivered."
      : hasFinal
        ? `Final cut: uploaded. Approve it with: exodus video approve ${runId}`
        : "Final cut: not uploaded yet.",
  );
  return { code: 0, lines };
}

// The run page's Director panel words (director-panel.tsx), so the two agree.
const DIRECTOR_STATUS_WORDS: Record<NonNullable<RunDirector["status"]>, string> = {
  reviewing: "Watching this run",
  waiting: "Waiting for redos to finish",
  done: "Done: ready for your approval",
  stopped: "Stopped: see the last note",
};
const DIRECTOR_PHASE_WORDS: Record<RunDirector["log"][number]["phase"], string> = {
  storyboard: "Storyboard",
  "final-watch": "Final watch",
};
const DIRECTOR_LOG_LINES = 3;

/** #2675: the Director panel as `video status` prints it, newest notes last. */
export function directorLines(director: RunDirector): string[] {
  const switchWords =
    director.runSetting === null
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

export type DirectorSwitch = boolean | null;

/** `on`, `off` or `follow` (the brand's own setting), or null for anything else. */
export function parseDirectorSwitch(word: string | undefined): { on: DirectorSwitch } | null {
  if (word === "on") return { on: true };
  if (word === "off") return { on: false };
  if (word === "follow") return { on: null };
  return null;
}

/** #2675: the run page's Director switch, from the CLI. */
export async function directorFlow(
  runId: string,
  on: DirectorSwitch,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const res = await deps.post(DIRECTOR_PATH, { runId, on });
  const behind = missingRouteLine(res, "exodus video director");
  if (behind) {
    return {
      code: 1,
      lines: json ? [JSON.stringify({ ok: false, status: 404, error: behind })] : [behind],
    };
  }
  if (!res.ok) return errorResult(res, json);
  if (json) return { code: 0, lines: [JSON.stringify({ runId, on })] };
  const said =
    on === null
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

/**
 * #1902: the planner reply a failed storyboard step had turned down.
 *
 * It is printed and nothing else. It is never written into a pull manifest or
 * any other file, for the same reason the checker's own words are not
 * (`withoutJudgeFields`): a draft nobody accepted must not end up somewhere it
 * can be mistaken for the ad, or edited and handed back.
 */
export async function rejectedDraftFlow(
  runId: string,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!runRes.ok) return errorResult(runRes, json);
  // #3251: the customer read has no steps, so it would always say nothing failed.
  if (customerAnswer<CustomerRun>(runRes.data)) {
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

  const res = await deps.get(
    `${REJECTED_DRAFT_PATH}?runId=${encodeURIComponent(runId)}&nodeId=${encodeURIComponent(node.nodeId)}`,
  );
  // An older backend has never heard of the path and answers a plain 404. A
  // deployed route that will not show this caller a draft answers the semantic
  // shape instead, and falls through to the usual video wording.
  if (missingRouteLine(res, "exodus video status --rejected-draft")) {
    return {
      code: 1,
      lines: json
        ? [JSON.stringify({ ok: false, status: 404, error: REJECTED_DRAFT_NOT_ON_THIS_SERVER })]
        : [REJECTED_DRAFT_NOT_ON_THIS_SERVER],
    };
  }
  if (!res.ok) return errorResult(res, json);

  const draft = (res.data as { draft?: string | null }).draft ?? null;
  if (json) return { code: 0, lines: [JSON.stringify({ runId, nodeId: node.nodeId, draft })] };
  if (!draft) return { code: 0, lines: ["No rejected draft was kept for this attempt."] };
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

interface GateSceneCard {
  sceneIndex: number;
  kind?: string;
  dialogue?: { speaker?: string; line?: string }[];
  voText?: string;
  durationSec?: number;
  frame?: { status?: string; imageUrl?: string; attempt?: number } | null;
}

interface GateCards {
  ready: boolean;
  title?: string;
  warnings?: string[];
  blocks?: Array<{ blockId: string; family?: string; pass?: boolean; warnings?: string[]; scenes?: GateSceneCard[] }>;
  looseScenes?: GateSceneCard[];
  runId?: string;
  paused?: boolean;
  /** Scene-frames node id when the pixel gate names it. */
  framesNodeId?: string | null;
}

export async function storyboardFlow(
  runId: string,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const res = await deps.get(`${STORYBOARD_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!res.ok) return errorResult(res, json);
  const board = customerAnswer<CustomerStoryboard>(res.data);
  if (board) {
    return { code: 0, lines: json ? [JSON.stringify(board)] : customerStoryboardLines(board) };
  }
  const cards = res.data as GateCards;
  if (json) return { code: 0, lines: [JSON.stringify(cards)] };

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
  for (const warning of cards.warnings ?? []) lines.push(`Heads-up: ${warning}`);

  const blocks = cards.blocks ?? [];
  for (const block of blocks) {
    const label = block.family ? `${block.family} block` : `block ${block.blockId}`;
    lines.push("", block.pass === false ? `${label} — needs a look` : label);
    for (const warning of block.warnings ?? []) lines.push(`  Heads-up: ${warning}`);
    for (const scene of block.scenes ?? []) lines.push(...sceneCardLines(scene));
  }
  const loose = cards.looseScenes ?? [];
  if (loose.length > 0) {
    lines.push("", "Scenes outside any block");
    for (const scene of loose) lines.push(...sceneCardLines(scene));
  }

  // #1845: the voices ride the storyboard stop, so a person sees who speaks with
  // what before approving instead of having to know about a second command. A
  // second, NON-FATAL read: an older backend, a 404 or an empty cast prints
  // nothing and the storyboard is unaffected.
  // The catch matters as much as the `ok` check: a dropped connection throws.
  const voiceRes = await deps
    .get(`${VOICES_PATH}?runId=${encodeURIComponent(runId)}`)
    .catch(() => null);
  if (voiceRes?.ok) {
    const sheet = (voiceRes.data ?? {}) as Partial<CastVoiceSheet>;
    const cast = Array.isArray(sheet.cast) ? sheet.cast : [];
    const canChange = sheet.canChange !== false;
    // A run whose voices are owned elsewhere (a Show) has nothing to act on, so
    // it stays quiet unless somebody already pinned a voice worth seeing.
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

  // #1908: the cards say nothing about who owns the run, and `video flag` is a
  // Show-ad-only door. So a THIRD non-fatal read, for the one line it decides.
  // A refusal or a dropped connection costs the send-back line and nothing else.
  const runRes = await deps
    .get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`)
    .catch(() => null);
  const showAd = runRes?.ok === true && isShowAd(asVideoRun(runRes.data));

  lines.push("", `approve with: exodus video approve ${runId}`);
  if (showAd) {
    lines.push(`send it back: exodus video flag ${runId} --note "what's wrong"`);
  }
  if (cards.framesNodeId) {
    lines.push(
      `redo one frame: exodus video retry-frame ${runId} --node ${cards.framesNodeId} --scene <n>`,
    );
  }
  return { code: 0, lines };
}

function sceneCardLines(scene: GateSceneCard): string[] {
  const head = [
    `  Scene ${scene.sceneIndex}`,
    scene.kind ? `(${scene.kind})` : "",
    typeof scene.durationSec === "number" ? `${scene.durationSec}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [head];
  for (const turn of scene.dialogue ?? []) {
    if (!turn.line) continue;
    lines.push(turn.speaker ? `    ${turn.speaker}: ${turn.line}` : `    ${turn.line}`);
  }
  if (!scene.dialogue?.length && scene.voText) lines.push(`    "${scene.voText}"`);
  if (scene.frame?.imageUrl) lines.push(`    picture: ${scene.frame.imageUrl}`);
  else if (scene.frame?.status) lines.push(`    picture: ${scene.frame.status}`);
  return lines;
}

export async function approveFlow(
  runId: string,
  opts: { json: boolean; approveStaleCut: boolean },
  deps: VideoDeps,
): Promise<FlowResult> {
  const res = await deps.post(APPROVE_PATH, {
    runId,
    // #1856: the server refuses a cut its clips have moved past. Only the member's
    // own --approve-stale-cut overrides that, so the key is sent only when they
    // typed the flag. It is never defaulted and never inferred from the run.
    ...(opts.approveStaleCut ? { approveStaleCut: true } : {}),
  });
  // #1845: a refused approve (a chosen voice ElevenLabs is certain is gone) comes
  // back 400 with one plain sentence — printed as-is, exit 1, nothing approved.
  // #1856: an out-of-date cut is refused the same way. The server's sentence
  // says "approve this cut anyway"; on the command line that is one flag, so
  // name it rather than leave the member to find it in the help.
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
  const data = res.data as {
    voices?: { cast?: CastVoiceRow[]; notices?: string[] };
    warnings?: string[];
  } | null;
  // #1856: things the member should know about the approve that went through
  // anyway, worded by the server. Absent on older backends.
  const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
  if (opts.json) {
    return { code: 0, lines: [JSON.stringify({ ok: true, runId, warnings, data: res.data })] };
  }
  // #1845: approving is the last moment a wrong voice can still be caught, so the
  // receipt names the voice each speaking character got. Absent on older backends
  // and on approves that are not the storyboard stop.
  const voices = data?.voices;
  const summary = voices
    ? voiceSummaryLines(
        Array.isArray(voices.cast) ? voices.cast : [],
        Array.isArray(voices.notices) ? voices.notices : [],
      )
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

export async function flagFlow(
  runId: string,
  note: string,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const res = await deps.post(FLAG_PATH, { runId, note });
  if (!res.ok) return errorResult(res, json);
  const data = res.data as { strategistLooking?: boolean };
  if (json) return { code: 0, lines: [JSON.stringify({ ok: true, runId, ...data })] };
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

export async function retryFrameFlow(
  runId: string,
  nodeId: string | undefined,
  sceneIndex: number,
  note: string | undefined,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  // #3251: a beta tester's redo never names a step (the server finds it), so
  // only their storyboard answer can say whether --node may be left off.
  if (nodeId === undefined) {
    const board = await deps.get(`${STORYBOARD_PATH}?runId=${encodeURIComponent(runId)}`);
    if (!board.ok) return errorResult(board, json);
    if (!customerAnswer<CustomerStoryboard>(board.data)) {
      return { code: 1, lines: ["video retry-frame needs --node <nodeId>."] };
    }
  }
  const res = await deps.post(SCENE_RETRY_PATH, {
    runId,
    ...(nodeId === undefined ? {} : { nodeId }),
    sceneIndex,
    ...(note ? { note } : {}),
  });
  if (!res.ok) return errorResult(res, json);
  if (customerAnswer<CustomerOk>(res.data)) {
    if (json) return { code: 0, lines: [JSON.stringify({ ok: true, runId, sceneIndex })] };
    return {
      code: 0,
      lines: [
        `Redrawing scene ${sceneIndex}'s picture. The other scenes stay as they are.`,
        ...(note ? ["Your note isn't used on this redo."] : []),
        `See it when it's done: exodus video storyboard ${runId}`,
      ],
    };
  }
  const triggerRunId = (res.data as { triggerRunId?: string }).triggerRunId;
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

export type ClipRedoPlan =
  | { ok: true; nodeId: string; sceneIndex: number; attempt: number; warnings: string[] }
  | { ok: false; reason: string };

export interface ClipRedoTarget {
  sceneIndex: number;
  nodeId?: string;
}

// #1856: guidance before the redo, not a second verdict. The server decides at
// approve time whether the uploaded cut is out of date, and this names the one
// flag that gets past that refusal.
const UPLOADED_CUT_WARNING =
  "The cut you already uploaded will not include the new clip. If this redo replaces the clip, " +
  "exodus video approve stops until you pull the pieces again, re-cut and upload again, " +
  "or pass --approve-stale-cut to deliver the cut you uploaded as it is.";

/**
 * #1851: decide a clip redo before anything is enqueued. The server's
 * `getSceneRetryContext` is the authority and its refusals are printed verbatim;
 * this mirrors its rules so the usual mistakes (a clip that is already being
 * redone, a step still rendering its other scenes, a finished clip on a run that
 * is nowhere near its final watch) cost a read rather than a queued task and a
 * silent no-op. A delivered ad is left to the server: the run payload carries no
 * approval stamp, and a done `final` row does not prove one.
 */
export function planClipRedo(
  run: VideoRun,
  items: NodeItem[],
  target: ClipRedoTarget,
): ClipRedoPlan {
  const stop = classifyRun(run);
  const found = findClipRow(run, items, target);
  if ("reason" in found) return { ok: false, reason: found.reason };
  const { row, uploadedCut } = found;

  // #1870: a redo the server has called dead is a failure nobody recorded, and
  // the server retries it like one whatever the run is parked at.
  const redoable =
    row.status === "failed" ||
    row.staleClaim === true ||
    (row.status === "done" &&
      (row.flagged === true ||
        stop.at === "final-watch" ||
        // #2616: still parked at the final watch while the automatic redo lands.
        (stop.at === "running" && stop.autoRedoScenes !== undefined)));
  if (!redoable) {
    if (row.status === "done") {
      return {
        ok: false,
        reason:
          `Scene ${target.sceneIndex}'s clip is finished and nothing flagged it. A finished clip ` +
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

/** The one clip row a redo names, or why it cannot be worked on right now. The
 *  rules both kinds of redo share: the row exists on exactly one step, that step
 *  has finished, and nobody is already redoing the scene. */
function findClipRow(
  run: VideoRun,
  items: NodeItem[],
  target: ClipRedoTarget,
): { row: NodeItem; uploadedCut: boolean } | { reason: string } {
  const uploadedCut = hasAttachedCut(items);

  const rows = items.filter(
    (i) =>
      i.itemKind === "clip" &&
      i.sceneIndex === target.sceneIndex &&
      (target.nodeId === undefined || i.nodeId === target.nodeId),
  );
  if (rows.length === 0) {
    return { reason: `Scene ${target.sceneIndex} has no clip to redo.` };
  }
  const nodeIds = [...new Set(rows.map((r) => r.nodeId))];
  if (nodeIds.length > 1) {
    return {
      reason:
        `Scene ${target.sceneIndex} has a clip on more than one step (${nodeIds.join(", ")}), ` +
        "so say which one: --node <nodeId>.",
    };
  }
  const row = rows[0];

  const node = run.nodes.find((n) => n.nodeId === row.nodeId);
  if (node?.status === "running") {
    return {
      reason:
        `The "${row.nodeId}" step is still making other scenes. Try again once it has finished ` +
        `(exodus video status ${run._id}).`,
    };
  }
  if (node && node.status !== "done") {
    return {
      reason:
        `The "${row.nodeId}" step did not finish (it is "${node.status}"), ` +
        "and one clip can only be redone on a step that finished.",
    };
  }
  if (row.status === "running" && row.staleClaim !== true) {
    return { reason: `Scene ${target.sceneIndex} is already being redone.` };
  }
  return { row, uploadedCut };
}

/** How one clip redo is steered. `voiceFirst` (#2299) records the line first. */
export interface ClipRedoOptions {
  note?: string;
  voiceFirst?: boolean;
}

export async function retryClipFlow(
  runId: string,
  target: ClipRedoTarget,
  { note, voiceFirst = false }: ClipRedoOptions,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!runRes.ok) return errorResult(runRes, json);
  if (customerAnswer<CustomerRun>(runRes.data)) {
    return adminOnlyResult(
      "Redoing a finished clip is for admins. To redo a scene's picture while your storyboard " +
        `waits for you: exodus video retry-frame ${runId} --scene <n>`,
      json,
    );
  }
  const run = asVideoRun(runRes.data);

  const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!itemsRes.ok) return errorResult(itemsRes, json);
  const items = (itemsRes.data as { items?: NodeItem[] }).items ?? [];

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
  // Never fall back to /scene/retry: that buys the ordinary redo instead.
  if (voiceFirst && missingRouteLine(res, "exodus video retry-clip --voice-first")) {
    return {
      code: 1,
      lines: json
        ? [JSON.stringify({ ok: false, status: 404, error: VOICE_FIRST_NOT_ON_THIS_SERVER })]
        : [VOICE_FIRST_NOT_ON_THIS_SERVER],
    };
  }
  if (!res.ok) return errorResult(res, json);
  const triggerRunId = (res.data as { triggerRunId?: string }).triggerRunId;
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

/** Has this clip's file already been changed by the voice pass? The pass works on
 *  the video model's own file, so a clip it has touched cannot go through again. */
function clipIsStillRaw(item: NodeItem): boolean {
  const a = item.artifact;
  return (
    // #1870: a stopped voice redo never let go of the clip it was working on,
    // so that clip is still the generator's own and still re-performable.
    (item.status === "done" || item.staleClaim === true) &&
    a?.type === "video" &&
    a.revoiced !== true &&
    a.speechTrimmed !== true &&
    a.tailTrimmed !== true
  );
}

/**
 * What a clip's checks say when its voice should have been changed and was not.
 * `speech-check-skipped` is deliberately NOT here: it also lands on clips whose
 * audio the render or a later step owns, where there is no voice change to redo
 * and a pass would bill a transcription to change nothing.
 */
const VOICE_NOT_CHANGED_CODES = new Set(["voice-unpinned", "voice-not-applied"]);

/**
 * #1888: the voice paths the server refuses a redo on, mirroring its
 * `VOICE_PATH_NEEDS[path].pins === "never-heard"` test. The sheet's other two
 * fields answer different questions and would both be wrong here:
 * `usesElevenLabs` is true on a described run that still bills for narration,
 * and `treatment.kind` follows `revoicesAfterRender`, which calls
 * lipsync-retarget render-owned even though a redo there is allowed.
 */
export const VOICE_PATHS_NEVER_HEARD = new Set(["native-prompt", "omni-audio-ids", "gemini-direct"]);

/**
 * #1888: the run-level twin of the server's per-scene refusal, for the one
 * caller that never reaches the route to hear it. Null when the sheet cannot be
 * read or the run's path allows a redo, so a harmless "nothing to do" is never
 * turned into an error.
 */
async function neverHeardRunLine(runId: string, deps: VideoDeps): Promise<string | null> {
  // `get` is a bare fetch and rejects on a dropped connection. This read only
  // picks the wording of a no-op, so it must never be what fails the command.
  const res = await deps
    .get(`${VOICES_PATH}?runId=${encodeURIComponent(runId)}`)
    .catch(() => null);
  if (!res?.ok) return null;
  const path = (res.data as { treatment?: { path?: string | null } } | null)?.treatment?.path;
  if (typeof path !== "string" || !VOICE_PATHS_NEVER_HEARD.has(path)) return null;
  return (
    `This run's clips are not voiced by ElevenLabs — the "${path}" way settles each voice as ` +
    "the clip is rendered — so no clip on this run has a voice pass to redo. Nothing was queued " +
    "and nothing was spent. To make a clip again from scratch, redo the clip instead."
  );
}

/**
 * #1858: decide a voice-only redo before anything is queued. Mirrors the
 * server's rule the way `planClipRedo` mirrors its own: a finished clip whose
 * file is still the video model's own. The server stays the authority.
 */
export function planClipRevoice(
  run: VideoRun,
  items: NodeItem[],
  target: ClipRedoTarget,
): ClipRedoPlan {
  const found = findClipRow(run, items, target);
  if ("reason" in found) return { ok: false, reason: found.reason };
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
      reason:
        `Scene ${target.sceneIndex}'s clip has already been through the voice pass, ` +
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

export type RevoiceTarget = ClipRedoTarget | { all: true };

/** "Scene 3", "Scenes 3 and 4", "Scenes 3, 4 and 9". */
function sceneListWords(sceneIndexes: number[]): string {
  if (sceneIndexes.length === 1) return `Scene ${sceneIndexes[0]}`;
  return `Scenes ${sceneIndexes.slice(0, -1).join(", ")} and ${sceneIndexes[sceneIndexes.length - 1]}`;
}

type RevoiceSceneResult =
  | { sceneIndex: number; nodeId?: string; ok: true; triggerRunId?: string }
  | { sceneIndex: number; nodeId?: string; ok: false; error: string };

/** One request per scene, so one scene's refusal never costs the others. */
export async function revoiceFlow(
  runId: string,
  target: RevoiceTarget,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!runRes.ok) return errorResult(runRes, json);
  if (customerAnswer<CustomerRun>(runRes.data)) {
    return adminOnlyResult("exodus video revoice is for admins.", json);
  }
  const run = asVideoRun(runRes.data);

  const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!itemsRes.ok) return errorResult(itemsRes, json);
  const items = (itemsRes.data as { items?: NodeItem[] }).items ?? [];

  const targets: ClipRedoTarget[] =
    "all" in target
      ? items
          .filter(
            (i) =>
              i.itemKind === "clip" &&
              clipIsStillRaw(i) &&
              (i.findings ?? []).some((f) => VOICE_NOT_CHANGED_CODES.has(f.code)),
          )
          .sort((a, b) => a.sceneIndex - b.sceneIndex)
          .map((i) => ({ sceneIndex: i.sceneIndex, nodeId: i.nodeId }))
      : [target];

  if (targets.length === 0) {
    const note =
      (await neverHeardRunLine(runId, deps)) ??
      "No clip on this run is waiting for a voice pass, so nothing was started.";
    return {
      code: 0,
      lines: json ? [JSON.stringify({ ok: true, runId, scenes: [], note })] : [note],
    };
  }

  const scenes: RevoiceSceneResult[] = [];
  const warnings = new Set<string>();
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
    // The route itself is missing, which is true of every scene alike. Stop
    // here, and never reach for /scene/retry: that one makes new paid video.
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
        triggerRunId: (res.data as { triggerRunId?: string }).triggerRunId,
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
  // A refusal about the whole run (no key saved, the ad already delivered) comes
  // back word for word on every scene, so scenes that heard the same sentence
  // share one line, placed where the first of them would have been.
  const refusedWith = new Map<string, number[]>();
  for (const r of scenes) {
    if (!r.ok) refusedWith.set(r.error, [...(refusedWith.get(r.error) ?? []), r.sceneIndex]);
  }
  const sceneLines = scenes.flatMap((r) => {
    if (r.ok) {
      return [
        `Scene ${r.sceneIndex}: redoing the voice on ${r.nodeId}. triggerRunId: ${r.triggerRunId ?? "-"}`,
      ];
    }
    const sharing = refusedWith.get(r.error) ?? [];
    if (sharing[0] !== r.sceneIndex) return [];
    return [`${sceneListWords(sharing)}: not started. ${r.error}`];
  });
  if (queued === 0) return { code, lines: sceneLines };
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

export interface CastVoiceRow {
  characterId: string;
  name: string;
  /** The voice this character's clips are converted to: their own, else the
   *  run's default (#1858). */
  voice: { voiceId: string; label?: string } | null;
  voiceFrom?: "own-pin" | "planner-pick" | "run-default";
  availability?:
    | { state: "available"; providerName: string }
    | { state: "missing" }
    | { state: "not-checked"; why: string };
  /** #1869: this character's WRITTEN voice, on a run whose video model speaks
   *  the lines itself. Absent when nobody wrote one. */
  description?: string;
  /** #3610: how the voice suits the character's description, when there is
   *  something to say. A clash is worth the member's attention. */
  fit?: { note: string; clash: boolean };
  /** #3234: the catalog voices that suit this character best, best first.
   *  Only on a character who speaks, and only from a server that sends them. */
  catalogPicks?: Array<{ voiceId: string; name: string; fit?: { note: string; clash: boolean } }>;
  spokenScenes: number;
  spokenSeconds: number;
}

export interface CastVoiceSheet {
  runId: string;
  canChange: boolean;
  whyNot?: string;
  cast: CastVoiceRow[];
  narrator: { voiceId: string; label?: string } | null;
  treatment: {
    /**
     * #1869: what happens to a pinned voice, and which setting decided. Both
     * optional to READ — a backend older than #1869 sends neither `path` nor,
     * before it, `kind`, and the sheet then prints only the summary sentence.
     */
    kind?: string;
    path?: string | null;
    /**
     * #1869: whether ANYTHING on this run still goes to ElevenLabs. A run whose
     * cast is voiced by the video model can still have its narration recorded
     * there, and that is the bill. Optional to READ: a backend older than #1869
     * sends nothing and the cost line prints as it always did.
     */
    usesElevenLabs?: boolean;
    summary: string;
    provider: string;
    model: string;
    speedChange: boolean;
    costNote: string;
    usage: { clips: number; seconds: number };
  };
  notices: string[];
  changed?: string[];
}

/** What `--set`, `--clear` and `--from` add up to: the map the route wants. */
export type VoiceMap = Record<string, string | { voiceId: string; label?: string } | null>;

/**
 * Returns null for "just show me", which is what a bare `video voices <runId>`
 * means. `--set`/`--clear` win over `--from`, so a file can be overridden on the
 * spot without editing it.
 */
export function parseVoiceFlags(
  occurrences: FlagOccurrence[],
  readFile: (path: string) => string,
): VoiceMap | null {
  const fromFile: VoiceMap = {};
  const typed: VoiceMap = {};
  let asked = false;

  const valueFor = (occurrence: FlagOccurrence): string => {
    if (occurrence.value === undefined) throw new Error(`--${occurrence.flag} needs a value.`);
    return occurrence.value;
  };

  for (const occurrence of occurrences) {
    if (occurrence.flag === "set") {
      const raw = valueFor(occurrence);
      // Split on the LAST "=" so a character label containing one still parses.
      const eq = raw.lastIndexOf("=");
      if (eq <= 0 || eq === raw.length - 1) {
        throw new Error(
          "--set must look like <character>=<voice>, where the voice is a catalog voice's name " +
            `or an ElevenLabs voice ID, for example --set C1=George (got "${raw}").`,
        );
      }
      typed[raw.slice(0, eq).trim()] = raw.slice(eq + 1).trim();
      asked = true;
    } else if (occurrence.flag === "clear") {
      const raw = valueFor(occurrence);
      if (!raw.trim()) throw new Error("--clear needs a character, for example --clear C1.");
      typed[raw.trim()] = null;
      asked = true;
    } else if (occurrence.flag === "from") {
      const file = valueFor(occurrence);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFile(file));
      } catch {
        throw new Error(`Could not read ${file} as a list of characters and voice IDs.`);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Could not read ${file} as a list of characters and voice IDs.`);
      }
      Object.assign(fromFile, parsed as VoiceMap);
      asked = true;
    }
  }
  if (!asked) return null;
  // The cast lives on the server, so the only identity known here is the name as
  // typed: a file entry is replaced when a flag names it the same way, whatever
  // the case or spacing. "HOST 2" in the file and --set C2 both reach the server,
  // which refuses the pair by name rather than guessing which one was meant.
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const merged: VoiceMap = {};
  for (const [who, choice] of Object.entries(fromFile)) {
    if (!Object.keys(typed).some((t) => sameName(t, who))) merged[who] = choice;
  }
  return { ...merged, ...typed };
}

/** #3234: one voice anyone can pick by name, as the server lists it. */
export interface CatalogVoiceEntry {
  voiceId: string;
  name: string;
  gender: string;
  age: string;
  accent: string;
  qualities: string[];
  characterVoice: boolean;
}

function catalogLines(catalog: CatalogVoiceEntry[]): string[] {
  const width = (pick: (voice: CatalogVoiceEntry) => string) =>
    Math.max(0, ...catalog.map((voice) => pick(voice).length));
  const nameWidth = width((voice) => voice.name);
  const genderWidth = width((voice) => voice.gender);
  const ageWidth = width((voice) => voice.age);
  const accentWidth = width((voice) => voice.accent);
  return [
    "Voices you can pick by name (ElevenLabs voices every account has)",
    ...catalog.map((voice) => {
      const qualities = [...voice.qualities, ...(voice.characterVoice ? ["character voice"] : [])];
      return (
        `  ${voice.name.padEnd(nameWidth)}  ${voice.gender.padEnd(genderWidth)}  ` +
        `${voice.age.padEnd(ageWidth)}  ${voice.accent.padEnd(accentWidth)}  ${qualities.join(", ")}`
      ).trimEnd();
    }),
  ];
}

function catalogPickLines(cast: CastVoiceRow[]): string[] {
  const lines: string[] = [];
  for (const row of cast) {
    if (!row.catalogPicks || row.catalogPicks.length === 0) continue;
    const width = Math.max(...row.catalogPicks.map((pick) => pick.name.length));
    lines.push("", `Best fits for ${row.name} (${row.characterId})`);
    for (const pick of row.catalogPicks) {
      lines.push(`  ${pick.name.padEnd(width)}${pick.fit ? `  ${pick.fit.note}` : ""}`.trimEnd());
    }
  }
  return lines;
}

/**
 * #3234: `video voices --catalog`. The list lives on the server, beside the
 * name lookup `--set` uses, so the two can never disagree.
 */
export async function voiceCatalogFlow(
  runId: string | undefined,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const query = runId ? `runId=${encodeURIComponent(runId)}&check=none&catalog=1` : "catalog=1";
  const res = await deps.get(`${VOICES_PATH}?${query}`);
  if (!res.ok) return errorResult(res, json);
  const data = (res.data ?? {}) as { catalog?: unknown; cast?: unknown };
  if (!Array.isArray(data.catalog)) {
    return { code: 1, lines: ["This server can't list the voice catalog yet. Voice IDs still work with --set."] };
  }
  if (json) return { code: 0, lines: [JSON.stringify({ ok: true, ...data })] };
  const cast = Array.isArray(data.cast) ? (data.cast as CastVoiceRow[]) : [];
  const set = runId ? `exodus video voices ${runId}` : "exodus video voices <runId>";
  return {
    code: 0,
    lines: [
      ...catalogLines(data.catalog as CatalogVoiceEntry[]),
      ...catalogPickLines(cast),
      "",
      `Pick one by name: ${set} --set <character>=<Name>`,
    ],
  };
}

/** One flow for the one verb: no voices means look, voices means set. */
export async function voicesFlow(
  runId: string,
  voices: VoiceMap | null,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const res = voices
    ? await deps.post(VOICES_PATH, { runId, voices })
    : await deps.get(`${VOICES_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!res.ok) return errorResult(res, json);
  const customer = customerAnswer<CustomerVoices>(res.data);
  if (customer) {
    return { code: 0, lines: json ? [JSON.stringify(customer)] : customerVoicesLines(customer) };
  }
  const sheet = res.data as CastVoiceSheet;
  if (json) return { code: 0, lines: [JSON.stringify({ ok: true, ...sheet })] };
  return { code: 0, lines: voiceSheetLines(sheet) };
}

function availabilityWords(row: CastVoiceRow): string {
  // #1869: a character with a written voice HAS a voice — it is just not one
  // ElevenLabs holds, so "no voice yet" would be flatly wrong.
  if (!row.voice) return row.description ? "voice written below" : "no voice yet";
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

/** One character's voice, spelled the same way everywhere it is shown. */
function voiceWords(row: Pick<CastVoiceRow, "voice" | "voiceFrom">): string {
  const voice = row.voice;
  if (!voice) return "—";
  const words = voice.label ? `${voice.label} (${voice.voiceId})` : voice.voiceId;
  if (row.voiceFrom === "run-default") return `${words}, the run's default voice`;
  if (row.voiceFrom === "planner-pick") return `${words}, picked by the planner`;
  return words;
}

/** #3610: why this voice suits the character, or doesn't, as a trailing clause. */
function fitWords(row: Pick<CastVoiceRow, "fit">): string {
  return row.fit ? `  — ${row.fit.note}` : "";
}

export const VOICE_CLASH_HINT =
  'To choose a voice yourself, write "voice: <Name>" on that character\'s CAST line in the script, ' +
  "or launch with --review-storyboard and change it at the storyboard stop.";

/**
 * #3610: the Voices block `video status` prints once the storyboard is made, so
 * a run that approved its own storyboard still says who speaks with what and
 * why. A failed or unreadable read prints nothing: status never fails over it.
 */
async function statusVoiceLines(runId: string, deps: VideoDeps): Promise<string[]> {
  // check=none: skip the ElevenLabs lookup so status never waits on it. An
  // older server ignores it and answers with the lookup done.
  const res = await deps
    .get(`${VOICES_PATH}?runId=${encodeURIComponent(runId)}&check=none`)
    .catch(() => null);
  if (!res?.ok) return [];
  const sheet = (res.data ?? {}) as Partial<CastVoiceSheet>;
  const cast = Array.isArray(sheet.cast) ? sheet.cast : [];
  const summary = voiceSummaryLines(cast, []);
  if (summary.length === 0) return [];
  const clash = cast.some((row) => row.fit?.clash === true);
  return ["", ...summary, ...(clash ? [VOICE_CLASH_HINT] : [])];
}

/** #1845: the compact "Voices" block the storyboard stop and the approve receipt
 *  share — one line per character who speaks or already has a voice, then the
 *  sheet's own notices. Empty when there is nothing worth saying. */
function voiceSummaryLines(cast: CastVoiceRow[], notices: string[]): string[] {
  const rows = cast.filter((row) => row.spokenScenes > 0 || row.voice !== null);
  // A note can arrive with no rows at all (the approve's check could not run),
  // and it must still be read — only the "Voices" heading needs rows under it.
  const width = Math.max(0, ...rows.map((row) => row.name.length));
  const lines = rows.length > 0 ? ["Voices"] : [];
  for (const row of rows) {
    lines.push(
      row.voice
        ? `  ${row.name.padEnd(width)}  →  ${voiceWords(row)}  ${availabilityWords(row)}${fitWords(row)}`
        : `  ${row.name.padEnd(width)}  →  no voice chosen (keeps the generated voice)`,
    );
  }
  for (const notice of notices) lines.push(`Heads-up: ${notice}`);
  return lines;
}

export function voiceSheetLines(sheet: CastVoiceSheet): string[] {
  const lines = [`Voices for run ${sheet.runId}`];
  // #1869: name the way this run makes its voices, when the server says which.
  if (typeof sheet.treatment.path === "string" && sheet.treatment.path !== "") {
    lines.push(`  Treatment: ${sheet.treatment.path}`);
  }
  if (sheet.cast.length === 0) lines.push("  Nobody is in this ad yet.");
  for (const row of sheet.cast) {
    const voice = voiceWords(row);
    lines.push(
      `  ${row.characterId}  ${row.name}  ${voice}  ${availabilityWords(row)}  ` +
        `speaks in ${row.spokenScenes} scene${row.spokenScenes === 1 ? "" : "s"}, ` +
        `about ${row.spokenSeconds}s${fitWords(row)}`,
    );
    // #1869: a written voice is the whole answer on a described run, so it gets
    // its own line rather than being squeezed into the row above.
    if (row.description) lines.push(`      written voice: ${row.description}`);
  }
  if (sheet.narrator) {
    const label = sheet.narrator.label ? `${sheet.narrator.label} ` : "";
    lines.push(`  Narrator  ${label}(${sheet.narrator.voiceId})  set on the workflow, not here`);
  }
  if (sheet.changed) {
    lines.push(
      sheet.changed.length > 0
        ? `Changed: ${sheet.changed.join(", ")}. Pictures and script were not touched.`
        : "Nothing changed — those voices were already set. Pictures and script were not touched.",
    );
  }
  lines.push(`How voices are applied: ${sheet.treatment.summary}${sheet.treatment.speedChange ? "" : " No speed change."}`);
  // #1869 + #1876: `usage` counts only the CAST clips ElevenLabs voices, so the
  // counters are the honest answer when there is at least one of them and this
  // run plays its pinned voices at all. Zero counters beside a real narration
  // bill would read as "this costs nothing", which is what a described run
  // prints and what a lipsync run whose only speaker is the narrator would have
  // printed. An older backend sends no `usesElevenLabs`, and then this prints
  // exactly as it always did.
  const playsPinnedVoices = sheet.treatment.kind !== "render-owns-voice";
  const convertsClips = playsPinnedVoices && sheet.treatment.usage.clips > 0;
  if (convertsClips || sheet.treatment.usesElevenLabs === undefined) {
    lines.push(
      `Cost: billed to your own ElevenLabs key. ${sheet.treatment.costNote} ` +
        `About ${sheet.treatment.usage.seconds} seconds of speech across ` +
        `${sheet.treatment.usage.clips} clips will be converted.`,
    );
  } else if (sheet.treatment.usesElevenLabs) {
    lines.push(
      "Cost: the narration on this run is voiced by ElevenLabs and billed to your own key. " +
        `${sheet.treatment.costNote} The clips themselves are not converted.`,
    );
  }
  for (const notice of sheet.notices) lines.push(notice);
  lines.push(
    sheet.canChange
      ? "You can still change voices until you approve the storyboard."
      : (sheet.whyNot ?? "Voices can no longer be changed on this run."),
  );
  return lines;
}

/** #2247: the bed, then the scenes the video model put music into by itself.
 *  The second is why "music: off" can still need a listen. */
function musicLines(manifest: VideoManifest): string[] {
  const lines = [`music: ${manifest.musicBed}`];
  if (manifest.musicHeardScenes.length > 0) {
    lines.push(`music heard in scene ${manifest.musicHeardScenes.join(", ")}`);
  }
  return lines;
}

/**
 * #3251: what a beta tester's pull writes. Only the files for their own cut and
 * where each one landed; a field reaches this manifest only by being named here.
 */
export interface CustomerManifest {
  runId: string;
  pulledAt: string;
  dashboardUrl: string;
  scenes: Array<{ index: number; clip: string | null; voice: string | null }>;
  music: string | null;
  video: string | null;
}

export function planCustomerPull(
  run: CustomerRun,
  items: CustomerItem[],
  meta: { pulledAt: string; dashboardUrl: string },
): { downloads: PullDownload[]; manifest: CustomerManifest } {
  const downloads: PullDownload[] = [];
  const take = (file: string, url: string): string => {
    downloads.push({ file, url });
    return file;
  };
  const scenes = new Map<number, CustomerManifest["scenes"][number]>();
  let music: string | null = null;
  for (const item of items) {
    if (item.kind === "music") {
      if (music === null && item.url) music = take(`music.${extFor(item.url, "audio")}`, item.url);
      continue;
    }
    if (!isPullSceneIndex(item.sceneIndex)) continue;
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

async function customerPullFlow(
  run: CustomerRun,
  dir: string,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const runId = run.runId;
  const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!itemsRes.ok) return errorResult(itemsRes, json);
  const items = customerAnswer<CustomerItems>(itemsRes.data)?.items ?? [];
  const { downloads, manifest } = planCustomerPull(run, items, {
    pulledAt: new Date(deps.now()).toISOString(),
    dashboardUrl: deps.dashboardUrl,
  });

  deps.mkdirp(dir);
  const failures = (
    await runPool(
      downloads.map((download) => () => downloadWithRetry(download, dir, deps)),
      PULL_CONCURRENCY,
    )
  ).filter((f): f is PullFailure => f !== null);
  // A file that did not land is not in the folder, so the manifest must not point at it.
  const landed = (file: string | null) =>
    file !== null && !failures.some((f) => f.file === file) ? file : null;
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

export async function pullFlow(
  runId: string,
  dir: string,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const runRes = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!runRes.ok) return errorResult(runRes, json);
  const customer = customerAnswer<CustomerRun>(runRes.data);
  if (customer) return customerPullFlow(customer, dir, json, deps);
  const run = asVideoRun(runRes.data);

  const itemsRes = await deps.get(`${ITEMS_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!itemsRes.ok) return errorResult(itemsRes, json);
  const items = (itemsRes.data as { items?: NodeItem[] }).items ?? [];

  const plan = planPull(run, items, {
    pulledAt: new Date(deps.now()).toISOString(),
    dashboardUrl: deps.dashboardUrl,
  });

  deps.mkdirp(dir);

  // The manifest lands even for a run that has made nothing yet, so `--out` is
  // always a folder something can read rather than sometimes an empty one.
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

  const failures = await runPool(
    plan.downloads.map((download) => () => downloadWithRetry(download, dir, deps)),
    PULL_CONCURRENCY,
  );
  for (const failure of failures) {
    if (failure) markPullFailure(plan.manifest, failure);
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
  for (const sceneIndex of plan.manifest.pendingRedo) {
    lines.push(
      "",
      `Scene ${sceneIndex} is being redone right now; its file will change. Run \`exodus video wait ${runId}\`, then pull again.`,
    );
  }
  const voiceFirst = plan.manifest.scenes.filter((s) => s.voiceMode === "voice-first");
  if (voiceFirst.length > 0) {
    lines.push(
      "",
      `Redone voice first (the line recorded, then the clip made to match it): ` +
        `scene${voiceFirst.length === 1 ? "" : "s"} ${voiceFirst.map((s) => s.sceneIndex).join(", ")}`,
    );
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
    lines.push(
      "",
      `${flagged.length} clip${flagged.length === 1 ? "" : "s"} came back flagged — usable, but look before you cut:`,
    );
    for (const scene of flagged) {
      lines.push(`  scene ${scene.sceneIndex}: ${scene.findings.map((f) => f.code).join(", ") || "flagged"}`);
    }
  }
  if (failed.length > 0) {
    lines.push("", `${failed.length} file${failed.length === 1 ? "" : "s"} did not download:`);
    for (const failure of failed) lines.push(`  ${failure.file}: ${failure.error}`);
    lines.push("Run the same command again to retry just those.");
  }
  lines.push("", `When your cut is ready: exodus video upload ${runId} --file cut.mp4`);
  return { code: failed.length > 0 ? 1 : 0, lines };
}

// ISO/IEC 14496-12 box layout. A box is a 32-bit size then a 4-char type; a
// size of 1 means the real size is a 64-bit value after the type, and 0 means
// "to the end". A full box (mvhd is one) then carries a version byte and three
// flag bytes before its fields, whose widths are what the version selects.
const BOX_HEADER = 8;
const BOX_HEADER_64 = 16;
const FULL_BOX_PREAMBLE = 4;
const MVHD_FIELDS = {
  0: { timescale: 8, duration: 12, end: 16 },
  1: { timescale: 16, duration: 20, end: 28 },
} as const;
// ISO writes all-ones when it does not know the duration. Taken at face value
// that is 49 days, which would be posted to the run as the length of the cut.
const MVHD_UNKNOWN_V0 = 0xffffffff;
const MVHD_UNKNOWN_V1 = 0xffffffffffffffffn;
// A corrupt file can nest containers as deep as its own byte count allows, and
// this walk recurses. Real files nest one level here.
const MAX_BOX_DEPTH = 4;

export function parseMvhdDurationSec(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const walk = (start: number, end: number, depth: number): number | null => {
    if (depth > MAX_BOX_DEPTH) return null;
    let p = start;
    while (p + BOX_HEADER <= end) {
      let size = view.getUint32(p);
      let header = BOX_HEADER;
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      if (size === 1) {
        if (p + BOX_HEADER_64 > end) return null;
        size = Number(view.getBigUint64(p + BOX_HEADER));
        header = BOX_HEADER_64;
      } else if (size === 0) {
        size = end - p;
      }
      if (size < header || p + size > end) return null;
      if (type === "mvhd") {
        const version = bytes[p + header];
        if (version !== 0 && version !== 1) return null;
        const fields = MVHD_FIELDS[version];
        const base = p + header + FULL_BOX_PREAMBLE;
        // Bounded by the box's OWN declared end, so a truncated mvhd reads its
        // timescale off a sibling box instead of returning a plausible lie.
        if (base + fields.end > p + size) return null;
        const timescale = view.getUint32(base + fields.timescale);
        if (timescale === 0) return null;
        if (version === 1) {
          const raw = view.getBigUint64(base + fields.duration);
          if (raw === 0n || raw === MVHD_UNKNOWN_V1) return null;
          return Number(raw) / timescale;
        }
        const raw = view.getUint32(base + fields.duration);
        if (raw === 0 || raw === MVHD_UNKNOWN_V0) return null;
        return raw / timescale;
      }
      if (type === "moov") {
        const found = walk(p + header, p + size, depth + 1);
        if (found !== null) return found;
      }
      p += size;
    }
    return null;
  };
  return walk(0, bytes.byteLength, 0);
}

export const NO_DURATION_MESSAGE =
  "Can't tell how long this cut is.\n" +
  "Install ffmpeg (which brings ffprobe), or pass the length yourself: --duration <seconds>";

const MB = 1024 * 1024;

const UPLOAD_ATTEMPTS = 3;
/** Waits between attempt 1 -> 2 and attempt 2 -> 3. */
const UPLOAD_BACKOFF_MS = [500, 1500];

type UploadStep = "mint" | "store" | "register" | "attach";

const UPLOAD_STEP_LABEL: Record<UploadStep, string> = {
  mint: "asking the server for an upload slot",
  store: "sending the file to storage",
  register: "registering the uploaded file",
  attach: "attaching the cut to the run",
};

/** #1695: a dropped socket makes `fetch` throw, and the thrown error's own
 *  message is always the useless "fetch failed" — the real reason (ECONNRESET,
 *  UND_ERR_SOCKET) sits one or two `cause` levels down, and undici sometimes
 *  nests it. Dig it out so a bug report can name what actually broke. */
export function describeFetchFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [];
  let cause: unknown = (err as { cause?: unknown }).cause;
  for (let depth = 0; depth < 2 && cause && typeof cause === "object"; depth++) {
    const level = cause as { code?: unknown; message?: unknown; cause?: unknown };
    const code = typeof level.code === "string" && level.code ? level.code : undefined;
    const message = typeof level.message === "string" && level.message ? level.message : undefined;
    if (code && message) parts.push(`${code}: ${message}`);
    else if (code) parts.push(code);
    else if (message) parts.push(message);
    cause = level.cause;
  }
  return parts.length > 0 ? `${err.message} (${parts.join("; ")})` : err.message;
}

type UploadAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; step: UploadStep; attempts: number; cause: string };

/** #1695: only a THROWN failure is retried. A throw from `fetch` means the
 *  request never got an answer (dropped socket, DNS blip), which a second try
 *  often fixes. A returned non-ok response IS an answer — a 403 says no, and
 *  asking again just gets the same no — so those keep their existing one-shot
 *  error paths untouched. */
async function withUploadRetry<T>(
  step: UploadStep,
  deps: VideoDeps,
  fn: () => Promise<T>,
): Promise<UploadAttempt<T>> {
  let cause = "";
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      cause = describeFetchFailure(e);
      const wait = UPLOAD_BACKOFF_MS[attempt - 1];
      if (attempt < UPLOAD_ATTEMPTS && wait !== undefined) await deps.sleep(wait);
    }
  }
  return { ok: false, step, attempts: UPLOAD_ATTEMPTS, cause };
}

function uploadRetryResult(
  failed: { step: UploadStep; attempts: number; cause: string },
  json: boolean,
): FlowResult {
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

/** #3300: one placement of a scene in the cut, as first-cut's <base>.scenes.json writes it. */
export interface CutScene {
  scene: number;
  startSec: number;
  seconds: number;
}

/** #3300: one spoken word on the cut's timeline, as first-cut's <base>.words.json writes it. */
export interface CutWord {
  text: string;
  start: number;
  end: number;
  scene: number;
}

// The server's caps (convex/lib/video/cutTiming.ts). A sidecar past them is
// left behind, so the cut still uploads.
const CUT_SCENES_MAX = 200;
const CUT_WORDS_MAX = 2000;

const isTime = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

function cutScene(row: unknown): CutScene | null {
  const r = row as Partial<CutScene> | null;
  return r && Number.isInteger(r.scene) && isTime(r.startSec) && isTime(r.seconds) && r.seconds > 0
    ? { scene: r.scene!, startSec: r.startSec, seconds: r.seconds }
    : null;
}

function cutWord(row: unknown): CutWord | null {
  const r = row as Partial<CutWord> | null;
  return r &&
    typeof r.text === "string" &&
    r.text.trim() !== "" &&
    isTime(r.start) &&
    isTime(r.end) &&
    r.end >= r.start &&
    Number.isInteger(r.scene)
    ? { text: r.text, start: r.start, end: r.end, scene: r.scene! }
    : null;
}

/** Every row of a sidecar, or null when it is missing, malformed, empty or too long. */
function readSidecar<T>(file: string, parse: (row: unknown) => T | null, max: number, deps: VideoDeps): T[] | null {
  let rows: unknown;
  try {
    rows = JSON.parse(deps.readFile(file));
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > max) return null;
  const parsed = rows.map(parse);
  return parsed.every((r): r is T => r !== null) ? parsed : null;
}

/**
 * #3300: the timing first-cut wrote beside the cut, for the customer's edit
 * list and editor folder. A hand-edited cut has none, and uploads without it.
 */
export function cutSidecars(filePath: string, deps: VideoDeps): { cutScenes?: CutScene[]; cutWords?: CutWord[] } {
  const base = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)));
  const cutScenes = readSidecar(`${base}.scenes.json`, cutScene, CUT_SCENES_MAX, deps);
  const cutWords = readSidecar(`${base}.words.json`, cutWord, CUT_WORDS_MAX, deps);
  return { ...(cutScenes ? { cutScenes } : {}), ...(cutWords ? { cutWords } : {}) };
}

export async function uploadFlow(
  runId: string,
  filePath: string,
  durationFlag: string | undefined,
  json: boolean,
  deps: VideoDeps,
): Promise<FlowResult> {
  const stat = deps.statFile(filePath);
  if (!stat) return { code: 1, lines: [`No such file: ${filePath}`] };

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

  let asked: number | null = null;
  if (durationFlag !== undefined) {
    asked = Number.parseFloat(durationFlag);
    if (!Number.isFinite(asked) || asked <= 0) {
      return { code: 1, lines: [`--duration must be a number of seconds, not "${durationFlag}".`] };
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = deps.readFileBytes(filePath);
  } catch (e) {
    return {
      code: 1,
      lines: [`Can't read "${filePath}": ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const durationSec =
    asked ?? deps.probeDurationSec(filePath) ?? parseMvhdDurationSec(bytes);
  if (durationSec === null) return { code: 1, lines: [NO_DURATION_MESSAGE] };
  const timing = cutSidecars(filePath, deps);

  const minting = await withUploadRetry("mint", deps, () => deps.post(ASSET_UPLOAD_URL_PATH, {}));
  if (!minting.ok) return uploadRetryResult(minting, json);
  const mint = minting.value;
  if (!mint.ok) return errorResult(mint, json);
  const minted = mint.data as { uploadUrl?: string; receiptId?: string };
  const uploadUrl = minted.uploadUrl;
  const receiptId = minted.receiptId;
  if (!uploadUrl || !receiptId) {
    return { code: 1, lines: ["The server did not hand back a place to upload to."] };
  }

  // #1695: a retry here reuses the slot minted above. The bytes never reached
  // storage, so the slot is unspent; re-minting would only leak a receipt.
  const storing = await withUploadRetry("store", deps, () =>
    deps.uploadBytes(uploadUrl, mime, bytes),
  );
  if (!storing.ok) return uploadRetryResult(storing, json);
  const put = storing.value;
  if (!put.ok || !put.storageId) {
    const detail = put.body ? `: ${put.body.slice(0, 200)}` : "";
    return { code: 1, lines: [`Upload failed (HTTP ${put.status})${detail}`] };
  }
  const storageId = put.storageId;

  const registering = await withUploadRetry("register", deps, () =>
    deps.post(ASSETS_PATH, {
      storageId,
      receiptId,
      filename: path.basename(filePath),
    }),
  );
  if (!registering.ok) return uploadRetryResult(registering, json);
  const registered = registering.value;
  if (!registered.ok) return errorResult(registered, json);
  const asset = registered.data as { assetId?: string };
  const assetId = asset.assetId;
  if (!assetId) {
    return { code: 1, lines: ["The server stored the file but did not say what to call it."] };
  }

  const attaching = await withUploadRetry("attach", deps, () =>
    deps.post(FINAL_PATH, {
      runId,
      assetId,
      durationSec,
      ...timing,
    }),
  );
  if (!attaching.ok) return uploadRetryResult(attaching, json);
  const attached = attaching.value;
  if (!attached.ok) return errorResult(attached, json);
  const customerFinal = customerAnswer<CustomerFinal>(attached.data);
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
  const final = attached.data as { finalWatchUrl?: string; delivered?: boolean };
  const finalWatchUrl = final.finalWatchUrl ?? reviewUrl(deps.dashboardUrl, { _id: runId });
  // #2980: a One-shot run is delivered by the upload itself. Absent on older
  // backends, where the upload never delivers.
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
  "set",
  "clear",
  "from",
]);

export function parsePositional(args = process.argv.slice(3)): string[] {
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

function flagString(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

async function printResult(result: FlowResult): Promise<void> {
  for (const line of result.lines) console.log(line);
  if (result.code !== 0) process.exit(result.code);
}

function usage(line: string): never {
  console.error(`Error: ${line}`);
  process.exit(1);
}

export async function run(
  flags: Record<string, string | boolean>,
  occurrences: FlagOccurrence[],
): Promise<void> {
  const [sub, ...rest] = parsePositional();
  const json = flags["json"] === true;

  if (!sub) {
    console.log(helpText);
    return;
  }

  if (sub === "shows") return printResult(await showsFlow(json, defaultDeps));

  if (sub === "start") {
    const plan = planVideoStart(flags, occurrences);
    if (plan.kind === "usage") usage(plan.line);
    const onProgressLine = (line: string): void => console.log(line);
    if (plan.kind === "show") {
      return printResult(await startFlow({ ...plan.opts, onProgressLine }, defaultDeps));
    }
    const started = await startScriptFlow({ ...plan.opts, onProgressLine }, defaultDeps);
    if (started.usage) usage(started.lines[0] ?? "");
    return printResult(started);
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
  // Not `=== true`: `--catalog` typed before the run id takes the id as its
  // value in `flags`, though the id still reaches `rest` as a positional.
  if (sub === "voices" && flags["catalog"] !== undefined && flags["catalog"] !== false) {
    return printResult(await voiceCatalogFlow(runId, json, defaultDeps));
  }
  if (needsRunId.includes(sub) && !runId) {
    usage(`video ${sub} needs a run id: exodus video ${sub} <runId>`);
  }

  if (sub === "status") {
    // Not `=== true`: `--rejected-draft` typed BEFORE the run id swallows the id
    // as its value (lib/args.ts), and silently printing the ordinary status to
    // someone who asked for the draft is the worst answer available.
    if (flags["rejected-draft"] !== undefined && flags["rejected-draft"] !== false) {
      return printResult(await rejectedDraftFlow(runId, json, defaultDeps));
    }
    return printResult(await statusFlow(runId, json, defaultDeps));
  }
  if (sub === "storyboard") return printResult(await storyboardFlow(runId, json, defaultDeps));
  if (sub === "director") {
    const choice = parseDirectorSwitch(rest[1]);
    if (!choice) usage(`video director needs on, off or follow: exodus video director ${runId} on`);
    return printResult(await directorFlow(runId, choice.on, json, defaultDeps));
  }
  if (sub === "approve") {
    return printResult(
      await approveFlow(
        runId,
        { json, approveStaleCut: flags["approve-stale-cut"] === true },
        defaultDeps,
      ),
    );
  }

  if (sub === "flag") {
    const note = flagString(flags, "note");
    if (!note) usage('video flag needs --note "<what is wrong>".');
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
    return printResult(
      await retryFrameFlow(runId, nodeId, sceneIndex, flagString(flags, "note"), json, defaultDeps),
    );
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
    return printResult(
      await retryClipFlow(
        runId,
        { sceneIndex, nodeId: flagString(flags, "node") },
        { note: flagString(flags, "note"), voiceFirst: flags["voice-first"] === true },
        json,
        defaultDeps,
      ),
    );
  }

  if (sub === "revoice") {
    const sceneRaw = flagString(flags, "scene");
    const all = flags["all"] === true;
    if (all === (sceneRaw !== undefined)) {
      usage(
        "video revoice needs one of --scene <n> (one clip) or --all (every clip that kept the video model's voice).",
      );
    }
    if (all) return printResult(await revoiceFlow(runId, { all: true }, json, defaultDeps));
    const sceneIndex = Number(sceneRaw);
    if (!Number.isInteger(sceneIndex)) {
      usage(`video revoice --scene must be a whole scene number, not "${sceneRaw}".`);
    }
    return printResult(
      await revoiceFlow(runId, { sceneIndex, nodeId: flagString(flags, "node") }, json, defaultDeps),
    );
  }

  if (sub === "voices") {
    let voices: VoiceMap | null;
    try {
      voices = parseVoiceFlags(occurrences, defaultDeps.readFile);
    } catch (err) {
      usage((err as Error).message);
    }
    return printResult(await voicesFlow(runId, voices, json, defaultDeps));
  }

  if (sub === "pull") {
    const dir = flagString(flags, "out");
    if (!dir) usage("video pull needs --out <dir>, the folder to write the pieces into.");
    return printResult(await pullFlow(runId, dir, json, defaultDeps));
  }

  if (sub === "upload") {
    const file = flagString(flags, "file");
    if (!file) usage("video upload needs --file <cut.mp4>.");
    return printResult(
      await uploadFlow(runId, file, flagString(flags, "duration"), json, defaultDeps),
    );
  }

  console.error(`Unknown subcommand: "${sub}"\n`);
  console.log(helpText);
  process.exit(1);
}
