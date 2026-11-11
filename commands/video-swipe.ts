/**
 * `exodus video swipe`: the dashboard's "Swipe a video" door (Door 4) from the terminal. A competitor's video ad is
 * broken down, matched to the closest kind of ad and look we make (its swipe template), written again for the
 * brand's product, and started as a video run, exactly as the dashboard's script door starts one: on the kind the
 * swipe wrote, launched via "swipe", Guided unless --one-shot.
 *
 * Four steps cost money: the breakdown (the team's keys), the template and the write (the member's own Anthropic or
 * OpenRouter key) and the start (the run's storyboard and pictures, and with --one-shot the rest of the video). The
 * CLI knows no price for any of them, so each one asks for --yes and, without it, sends nothing and says what the
 * step buys and who pays. The template and the write take minutes: the server answers at once with a job, and the
 * CLI polls it until the work is done or says why it stopped.
 *
 * The answers mirror convex/http.ts's swipe routes. This package ships on its own schedule, so the shapes are
 * copied here rather than imported.
 */
import path from "node:path";
import type { FlagOccurrence } from "../lib/args.js";
import type { ApiResponse } from "../lib/client.js";
import { formatApiError } from "../lib/format.js";
import { missingRouteLine } from "../lib/route-support.js";
import { customerAnswer, type CustomerStart } from "./video-customer.js";
import { describeFetchFailure, startedThenWait, type FlowResult, type VideoDeps } from "./video.js";

export const SWIPE_BREAKDOWNS_PATH = "/api/v2/video/breakdowns";
export const SWIPE_UPLOAD_URL_PATH = "/api/v2/video/breakdowns/upload-url";
export const SWIPE_TEMPLATE_PATH = "/api/v2/video/swipe-template";
export const SWIPE_PRODUCTS_PATH = "/api/v2/video/swipe-products";
export const SWIPES_PATH = "/api/v2/video/swipes";
export const SWIPE_RUNS_PATH = "/api/v2/video/swipe-runs";

// ── What the routes answer (MIRRORS of convex/videoBreakdown.ts, videoSwipes.ts and http.ts) ─────────────────────

export interface SwipeBreakdown {
  _id: string;
  sourceKind: "url" | "file" | "ad";
  sourceUrl: string | null;
  fileName: string | null;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  steps: Array<{ id: string; label: string; status: "waiting" | "running" | "done" | "failed" }>;
  spentUsd: number | null;
  costIsEstimate: boolean;
  reused: boolean;
}

/** What a breakdown read from the ad, as `?full=1` sends it: the fields of VideoBreakdownSchema the CLI prints. */
export interface SwipeFull {
  source: { advertiser?: string; durationSec: number; aspectRatio: string };
  footage: {
    shots: Array<{
      id: string;
      start: number;
      end: number;
      kind: "aroll" | "cutaway";
      shotSize: string;
      camera: string;
      description: string;
    }>;
  };
  buildSheet: {
    cast: Array<{ characterId: string; name: string; embodiment: "on-screen" | "voice-only" | "behind-camera"; look: string; voice: string }>;
    script: Array<{ lineId: string; speakerId: string | null; start: number; end: number; text: string }>;
  };
  warnings: string[];
}

export interface SwipeTemplateView {
  kind: { key: string; label: string; why: string };
  look: { slug: string; label: string; why: string };
  lines: number;
  seconds: number;
}

export interface SwipeDraft {
  script: string;
  conceit: string;
  style: string;
  direction: string;
  note: { kept: string; changed: string };
  lengthGap?: { ours: number; theirs: number };
}

export interface SwipeView {
  _id: string;
  breakdownId: string;
  productId: string;
  request: { mode: ServerMode; closeness?: number; look?: string };
  outcome: { kind: "written"; draft: SwipeDraft } | { kind: "refused"; why: string };
  /** An admin's read only: what the checks found on a refusal. */
  checksFound?: string[];
  workflowRunId: string | null;
  costUsd: number | null;
}

export interface SwipeListRow {
  _id: string;
  breakdownId: string;
  request: { mode: ServerMode; closeness?: number };
  workflowRunId: string | null;
  source: { sourceKind: string; sourceUrl?: string; fileName?: string } | null;
  /** Absent from a server that lists written swipes only. */
  outcome?: { kind: "written" | "refused" };
  costUsd?: number | null;
}

// ── The dashboard's words (src/app/(dashboard)/video/_components/swipe-door-model.ts) ─────────────────────────────

type ServerMode = "whole" | "hook" | "their-format" | "new-look";

/** What to swipe, by the CLI's word, with the dashboard's label and helper word for word. */
export const SWIPE_MODES: ReadonlyArray<{ flag: string; mode: ServerMode; label: string; helper: string }> = [
  { flag: "whole-ad", mode: "whole", label: "Whole ad", helper: "Every part of their ad, rewritten for your brand." },
  { flag: "hook-only", mode: "hook", label: "Hook only", helper: "Their opening hook. The rest is new, written for your product." },
  { flag: "their-format", mode: "their-format", label: "Their format, my script", helper: "Your own words, made the way their ad is made." },
  { flag: "new-look", mode: "new-look", label: "Their script, a new look", helper: "Their ad rewritten for your brand, in a look you pick." },
];

/** The closeness dial, by number and by name, with the dashboard's name and line for each step. */
export const SWIPE_CLOSENESS: ReadonlyArray<{ step: number; flag: string; name: string; line: string }> = [
  { step: 1, flag: "mirror", name: "Mirror", line: "Same lines in the same order. Only your brand, product and claims change." },
  { step: 2, flag: "close", name: "Close", line: "Same parts in the same order, each line said in new words." },
  { step: 3, flag: "same-beats", name: "Same beats", line: "Same job for each part, in the same order. New words and new examples." },
  {
    step: 4,
    flag: "same-arc",
    name: "Same arc",
    line: "Same kind of hook and the same story arc. Parts can join, split or move to suit your product.",
  },
  { step: 5, flag: "pattern-only", name: "Pattern only", line: "Same format and structure, with a new story." },
];

export const DEFAULT_CLOSENESS = 2;

const modeOf = (mode: ServerMode) => SWIPE_MODES.find((m) => m.mode === mode)!;
const closenessOf = (step: number) => SWIPE_CLOSENESS.find((c) => c.step === step);

// ── The paid steps ────────────────────────────────────────────────────────────────────────────────────────────────

export const NO_PRICE = "The CLI prints no price for this step.";

export type PaidStep = "breakdown" | "template" | "write" | "start" | "start-one-shot";

const MEMBER_LLM_KEY = "The member's own Anthropic or OpenRouter key.";

export const PAID: Record<PaidStep, { buys: string; paidBy: string }> = {
  breakdown: {
    buys: "A breakdown of the ad: its video read shot by shot, every word written down, and a picture of each shot.",
    paidBy: "The team's keys. Nothing is charged to the member's keys.",
  },
  template: {
    buys: "One model call that matches the ad to the closest kind of ad and look we make.",
    paidBy: MEMBER_LLM_KEY,
  },
  write: {
    buys: "The brand's version of the ad's script, written and checked. Several model calls; a refusal is paid for too.",
    paidBy: MEMBER_LLM_KEY,
  },
  start: {
    buys: "A video run up to its storyboard: the storyboard and its pictures. The voices and clips are bought only when the storyboard is approved.",
    paidBy: "The member's own keys, as for any video run.",
  },
  "start-one-shot": {
    buys: "The whole video with no stop: the storyboard, its pictures, the voices and the clips. It stops only when a check finds a problem.",
    paidBy: "The member's own keys, as for any video run.",
  },
};

/** A paid verb without --yes: nothing is sent; what the step buys and who pays, and exit 0. */
export function needsYesResult(step: PaidStep, json: boolean, choice: string[] = []): FlowResult {
  const { buys, paidBy } = PAID[step];
  if (json) return { code: 0, lines: [JSON.stringify({ ok: false, needsYes: true, buys, paidBy, price: null })] };
  return {
    code: 0,
    lines: [
      "This step costs money, so nothing was sent.",
      ...choice,
      `It buys: ${buys}`,
      `Who pays: ${paidBy}`,
      NO_PRICE,
      "Ask the member. On their yes, run the same command with --yes.",
    ],
  };
}

// ── Reading the command line ──────────────────────────────────────────────────────────────────────────────────────

export type SwipeSource = { kind: "file"; file: string } | { kind: "url"; url: string } | { kind: "ad"; swipeAdId: string };

export interface WriteAsk {
  productId: string;
  mode: ServerMode;
  closeness: number;
  look?: string;
  scriptFile?: string;
}

export interface StartAsk {
  style?: string;
  title?: string;
  music: boolean;
  oneShot: boolean;
}

export interface SwipeOpts {
  json: boolean;
  yes: boolean;
  wait: boolean;
}

export type SwipePlan =
  | { kind: "usage"; line: string }
  | { kind: "breakdown"; source: SwipeSource; opts: SwipeOpts }
  | { kind: "status"; breakdownId: string; full: boolean; opts: SwipeOpts }
  | { kind: "template"; breakdownId: string; opts: SwipeOpts }
  | { kind: "products"; opts: SwipeOpts }
  | { kind: "write"; breakdownId: string; ask: WriteAsk; opts: SwipeOpts }
  | { kind: "show"; swipeId: string; opts: SwipeOpts }
  | { kind: "list"; opts: SwipeOpts }
  | { kind: "start"; swipeId: string; ask: StartAsk; opts: SwipeOpts };

const VERBS = ["status", "template", "products", "write", "show", "list", "start"];

/** --mode's word: whole-ad, hook-only, their-format or new-look. */
export function parseSwipeMode(value: string): ServerMode | null {
  return SWIPE_MODES.find((m) => m.flag === value.trim().toLowerCase())?.mode ?? null;
}

/** --closeness: 1 to 5, or the step's name (mirror, close, same-beats, same-arc, pattern-only). */
export function parseCloseness(value: string): number | null {
  const word = value.trim().toLowerCase();
  return SWIPE_CLOSENESS.find((c) => String(c.step) === word || c.flag === word)?.step ?? null;
}

const OFF_WORDS = new Set(["false", "no", "off", "0"]);
const ON_WORDS = new Set(["true", "yes", "on", "1"]);
const SWITCHES = ["json", "yes", "wait", "full", "music", "one-shot"] as const;

/**
 * `exodus video swipe …` as a plan, or the usage line. `rest` is the positional words after `swipe`. Flags are read
 * from parseArgs's occurrences, not its flags, which file `--mode=hook-only` under the key "mode=hook-only": read
 * from flags, a paid write would quietly go out on the default mode. The last of `--x` and `--no-x` wins. A switch
 * given false, no, off or 0 is off, and true, yes, on or 1 is on. Any other word after a switch is on only when it is
 * also a positional (`--yes bd_1`); else it was typed after `=` and is refused, so `--one-shot=nope` never buys the
 * whole video. A value flag followed by nothing or by another flag has no value.
 */
export function planSwipeCommand(rest: string[], occurrences: FlagOccurrence[]): SwipePlan {
  const last = (name: string) => occurrences.filter((o) => o.flag === name || o.flag === `no-${name}`).at(-1);
  const switchState = (name: string): boolean | string => {
    const typed = last(name);
    if (typed?.flag !== name) return false;
    const given = typed.value;
    if (given === undefined || given.startsWith("--")) return true;
    const word = given.trim().toLowerCase();
    if (OFF_WORDS.has(word)) return false;
    // "swipe" itself is a positional too: `exodus video --json swipe list`.
    if (ON_WORDS.has(word) || given === "swipe" || rest.includes(given)) return true;
    return `video swipe --${name} takes true or false, or no value at all (got "${given}").`;
  };
  const switches = new Map(SWITCHES.map((name) => [name, switchState(name)] as const));
  const refusedSwitch = [...switches.values()].find((state): state is string => typeof state === "string");
  if (refusedSwitch) return { kind: "usage", line: refusedSwitch };
  const on = (name: (typeof SWITCHES)[number]): boolean => switches.get(name) === true;
  const value = (name: string): string | undefined | null => {
    const typed = last(name);
    if (!typed || typed.flag !== name) return undefined;
    return typed.value !== undefined && !typed.value.startsWith("--") && typed.value.trim() ? typed.value : null;
  };
  const opts: SwipeOpts = { json: on("json"), yes: on("yes"), wait: on("wait") };
  const usage = (line: string): SwipePlan => ({ kind: "usage", line });
  const [verb, id] = rest;

  if (verb === undefined) {
    const given = (["file", "url", "ad"] as const).filter((name) => value(name) !== undefined);
    if (given.length !== 1) {
      return usage("video swipe needs one ad: --file <ad.mp4>, --url <link> or --ad <swipeAdId>.");
    }
    const name = given[0];
    const text = value(name);
    if (!text) return usage(`video swipe --${name} needs ${name === "file" ? "a video file" : name === "url" ? "a link" : "an ad id"}.`);
    const source: SwipeSource =
      name === "file" ? { kind: "file", file: text } : name === "url" ? { kind: "url", url: text.trim() } : { kind: "ad", swipeAdId: text.trim() };
    return { kind: "breakdown", source, opts };
  }
  if (!VERBS.includes(verb)) {
    return usage(`video swipe ${verb} is not a swipe command. Use one of: ${VERBS.join(", ")}, or --file, --url or --ad to start.`);
  }
  if (verb === "products") return { kind: "products", opts };
  if (verb === "list") return { kind: "list", opts };
  if (!id) {
    const named = verb === "show" || verb === "start" ? "swipeId" : "breakdownId";
    return usage(`video swipe ${verb} needs a ${named === "swipeId" ? "swipe" : "breakdown"} id: exodus video swipe ${verb} <${named}>`);
  }
  if (verb === "status") return { kind: "status", breakdownId: id, full: on("full"), opts };
  if (verb === "template") return { kind: "template", breakdownId: id, opts };
  if (verb === "show") return { kind: "show", swipeId: id, opts };
  if (verb === "start") {
    const style = value("style");
    const title = value("title");
    if (style === null) return usage("video swipe start --style needs a look's slug.");
    if (title === null) return usage('video swipe start --title needs a name: --title "<name>".');
    return {
      kind: "start",
      swipeId: id,
      ask: {
        ...(style ? { style: style.trim() } : {}),
        ...(title ? { title: title.trim() } : {}),
        music: on("music"),
        oneShot: on("one-shot"),
      },
      opts,
    };
  }

  // write
  const product = value("product");
  if (!product) return usage("video swipe write needs --product <id>. exodus video swipe products lists them.");
  const modeWord = value("mode");
  if (modeWord === null) return usage("video swipe write --mode needs whole-ad, hook-only, their-format or new-look.");
  const mode = modeWord === undefined ? "whole" : parseSwipeMode(modeWord);
  if (!mode) return usage(`video swipe write --mode must be whole-ad, hook-only, their-format or new-look, not "${modeWord}".`);
  const closenessWord = value("closeness");
  if (closenessWord === null) return usage("video swipe write --closeness needs 1 to 5, or mirror, close, same-beats, same-arc or pattern-only.");
  if (mode === "their-format" && closenessWord !== undefined) {
    return usage("video swipe write --closeness does not apply to their-format: your own words stay as they are.");
  }
  const closeness = closenessWord === undefined ? DEFAULT_CLOSENESS : parseCloseness(closenessWord);
  if (closeness === null) {
    return usage(`video swipe write --closeness must be 1 to 5, or mirror, close, same-beats, same-arc or pattern-only, not "${closenessWord}".`);
  }
  const look = value("look");
  if (look === null || (look === undefined && mode === "new-look")) {
    return usage("video swipe write --mode new-look needs --look <slug>, the new look.");
  }
  if (look !== undefined && mode !== "new-look") return usage("video swipe write --look is only for --mode new-look.");
  const script = value("script");
  if (script === null || (script === undefined && mode === "their-format")) {
    return usage("video swipe write --mode their-format needs --script <file>, your own script.");
  }
  if (script !== undefined && mode !== "their-format") return usage("video swipe write --script is only for --mode their-format.");
  return {
    kind: "write",
    breakdownId: id,
    ask: {
      productId: product.trim(),
      mode,
      closeness,
      ...(look ? { look: look.trim() } : {}),
      ...(script ? { scriptFile: script } : {}),
    },
    opts,
  };
}

// ── Shared pieces ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Progress lines go out as they happen when a person is watching; otherwise they join the answer. */
export interface SwipeRunOptions extends SwipeOpts {
  onProgressLine?: (line: string) => void;
}

const SWIPE_NOT_FOUND =
  "Not found on this brand. The id is wrong or is another brand's, video isn't switched on for your dashboard " +
  "user, or this is not the brand you meant (exodus brand current). Check the id first.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function swipeErrorLine(res: ApiResponse<unknown>): string {
  return missingRouteLine(res, "exodus video swipe") ?? (res.status === 404 ? SWIPE_NOT_FOUND : formatApiError(res));
}

function swipeError(res: ApiResponse<unknown>, json: boolean): FlowResult {
  const error = swipeErrorLine(res);
  return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error })] : [error] };
}

function failed(line: string, json: boolean, extra: Record<string, unknown> = {}): FlowResult {
  return { code: 1, lines: json ? [JSON.stringify({ ok: false, error: line, ...extra })] : [line] };
}

/** Lines said while the command waits, out at once to a watching person, else kept for the answer. */
function progress(opts: SwipeRunOptions) {
  const kept: string[] = [];
  return {
    say(line: string) {
      if (opts.json) return;
      if (opts.onProgressLine) opts.onProgressLine(line);
      else kept.push(line);
    },
    kept,
  };
}

const POLL_MS = 5000;
/** Missed polls in a row (a dropped connection, a server error, a rate limit) before the wait gives up. */
const MAX_MISSES = 3;

/** A server error or a rate limit says nothing about the job, which goes on: the poll is missed, not answered. */
const missed = (res: ApiResponse<unknown>) => res.status >= 500 || res.status === 429;

/**
 * Polls `read` every five seconds until it says it is done, at most `maxPolls` times. A poll that throws, gets no
 * answer, or gets a 5xx or a 429 counts as missed; three in a row end the wait with `lost`.
 */
async function poll<T>(
  read: () => Promise<ApiResponse<unknown>>,
  step: (res: ApiResponse<unknown>) => { done: T } | null,
  maxPolls: number,
  deps: VideoDeps,
): Promise<{ done: T } | { lost: true } | { timedOut: true }> {
  let misses = 0;
  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) await deps.sleep(POLL_MS);
    const res = await read().catch(() => null);
    if (!res || missed(res)) {
      if (++misses >= MAX_MISSES) return { lost: true };
      continue;
    }
    misses = 0;
    const answer = step(res);
    if (answer) return answer;
  }
  return { timedOut: true };
}

const usd = (value: number) => `$${value.toFixed(2)}`;

const LOST = "The server did not answer three times in a row while we waited.";

/**
 * A wait that ended on the server's error. A 404 is the row gone or not this brand's. Any other error says nothing
 * about the paid work, which may still finish: `hint` says where to look, so the member does not pay for it twice.
 */
function waitRefused(res: ApiResponse<unknown>, hint: string, json: boolean): FlowResult {
  if (res.status === 404) return swipeError(res, json);
  const error = swipeErrorLine(res);
  return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error, mayStillFinish: hint })] : [error, hint] };
}

// ── The breakdown ─────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 300 * 1024 * 1024;
const VIDEO_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};
/** A breakdown silent for 20 minutes is failed by the server's sweep; the wait gives it five more. */
const BREAKDOWN_MAX_POLLS = 300;

/** `exodus video swipe --file | --url | --ad`: start a breakdown, or find the one this ad already has. */
export async function swipeBreakdownFlow(source: SwipeSource, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult> {
  const { json } = opts;
  let file: { contentType: string; size: number } | null = null;
  if (source.kind === "file") {
    // A file the server would refuse is refused here, before the yes is asked and before any byte is sent.
    const stat = deps.statFile(source.file);
    if (!stat) return failed(`Can't read ${source.file}. Check the path.`, json);
    if (stat.size === 0) return failed("That file is empty. Pick the video file again.", json);
    if (stat.size > MAX_FILE_BYTES) return failed("That file is too big. Pick a video of at most 300 MB.", json);
    const contentType = VIDEO_TYPES[path.extname(source.file).toLowerCase()];
    if (!contentType) return failed("That file is not a video. Pick an MP4, MOV, M4V or WebM file.", json);
    file = { contentType, size: stat.size };
  }
  if (!opts.yes) return needsYesResult("breakdown", json);

  let started: { breakdownId: string; existing: boolean };
  if (source.kind === "url") {
    // The dashboard offers this brand's earlier breakdown of the same link before it reads the link again.
    const earlier = await deps.get(`${SWIPE_BREAKDOWNS_PATH}?url=${encodeURIComponent(source.url)}`);
    if (!earlier.ok) return swipeError(earlier, json);
    const found = isRecord(earlier.data) && isRecord(earlier.data.earlier) ? earlier.data.earlier.breakdownId : undefined;
    if (typeof found === "string") started = { breakdownId: found, existing: true };
    else {
      const res = await deps.post(SWIPE_BREAKDOWNS_PATH, { url: source.url });
      if (!res.ok) return swipeError(res, json);
      started = startedOf(res.data);
    }
  } else if (source.kind === "ad") {
    const res = await deps.post(SWIPE_BREAKDOWNS_PATH, { swipeAdId: source.swipeAdId });
    if (!res.ok) return swipeError(res, json);
    started = startedOf(res.data);
  } else {
    const minted = await deps.post(SWIPE_UPLOAD_URL_PATH, {});
    if (!minted.ok) return swipeError(minted, json);
    const slot = isRecord(minted.data) ? minted.data : {};
    if (typeof slot.url !== "string" || typeof slot.receiptId !== "string") {
      return failed("The server did not give an upload URL. Nothing was paid for.", json);
    }
    let stored: Awaited<ReturnType<VideoDeps["uploadBytes"]>>;
    try {
      stored = await deps.uploadBytes(slot.url, file!.contentType, deps.readFileBytes(source.file));
    } catch (err) {
      return failed(`Upload failed while sending the file to storage: ${describeFetchFailure(err)}. Nothing was paid for. Run the same command again.`, json);
    }
    if (!stored.ok || !stored.storageId) {
      return failed(`Upload failed (HTTP ${stored.status}). Nothing was paid for. Run the same command again.`, json);
    }
    const res = await deps.post(SWIPE_BREAKDOWNS_PATH, {
      storageId: stored.storageId,
      receiptId: slot.receiptId,
      fileName: path.basename(source.file),
    });
    if (!res.ok) return swipeError(res, json);
    started = startedOf(res.data);
  }
  if (!started.breakdownId) return failed("The server did not say which breakdown it started.", json);

  const { breakdownId, existing } = started;
  const head = existing
    ? [`This ad already has a breakdown: ${breakdownId}. It cost nothing.`]
    : [`Breakdown ${breakdownId} started. It reads the ad on the team's keys, in a few minutes.`];
  if (!opts.wait) {
    return {
      code: 0,
      lines: json
        ? [JSON.stringify({ ok: true, breakdownId, existing })]
        : [...head, `Follow it: exodus video swipe status ${breakdownId} --wait`],
    };
  }
  const out = progress(opts);
  for (const line of head) out.say(line);
  const waited = await waitForBreakdown(breakdownId, opts, deps, out.say);
  if (json) return { code: waited.code, lines: [JSON.stringify({ ok: waited.code === 0, breakdownId, existing, ...waited.json })] };
  return { code: waited.code, lines: [...out.kept, ...waited.lines] };
}

function startedOf(data: unknown): { breakdownId: string; existing: boolean } {
  const d = isRecord(data) ? data : {};
  return { breakdownId: typeof d.breakdownId === "string" ? d.breakdownId : "", existing: d.existing === true };
}

type BreakdownRead = { breakdown: SwipeBreakdown; template: SwipeTemplateView | null };

function breakdownReadOf(data: unknown): BreakdownRead | null {
  if (!isRecord(data) || !isRecord(data.breakdown) || !Array.isArray(data.breakdown.steps)) return null;
  return { breakdown: data.breakdown as unknown as SwipeBreakdown, template: isRecord(data.template) ? (data.template as unknown as SwipeTemplateView) : null };
}

/** Waits for a breakdown to end, saying each step's label once as it starts. */
async function waitForBreakdown(
  breakdownId: string,
  opts: SwipeRunOptions,
  deps: VideoDeps,
  say: (line: string) => void,
): Promise<{ code: number; lines: string[]; json: Record<string, unknown> }> {
  const said = new Set<string>();
  const ended = await poll<{ read: BreakdownRead } | { refused: ApiResponse<unknown> }>(
    () => deps.get(`${SWIPE_BREAKDOWNS_PATH}?id=${encodeURIComponent(breakdownId)}`),
    (res) => {
      if (!res.ok) return { done: { refused: res } };
      const read = breakdownReadOf(res.data);
      if (!read) return null;
      for (const step of read.breakdown.steps) {
        if (step.status === "waiting" || said.has(step.id)) continue;
        said.add(step.id);
        say(`  ${step.label}`);
      }
      return read.breakdown.status === "done" || read.breakdown.status === "failed" ? { done: { read } } : null;
    },
    BREAKDOWN_MAX_POLLS,
    deps,
  );
  const hint = `The breakdown may still finish: exodus video swipe status ${breakdownId}`;
  if ("lost" in ended) {
    const error = `${LOST} ${hint}`;
    return { code: 1, lines: [error], json: { error } };
  }
  if ("timedOut" in ended) {
    const line = `Still reading after 25 minutes. Check later: exodus video swipe status ${breakdownId}`;
    return { code: 0, lines: [line], json: { stillRunning: true } };
  }
  if ("refused" in ended.done) {
    const { refused } = ended.done;
    const error = swipeErrorLine(refused);
    if (refused.status === 404) return { code: 1, lines: [error], json: { error } };
    return { code: 1, lines: [error, hint], json: { error, mayStillFinish: hint } };
  }
  const { read } = ended.done;
  return { code: read.breakdown.status === "failed" ? 1 : 0, lines: breakdownEndLines(read), json: { breakdown: read.breakdown, template: read.template } };
}

function breakdownEndLines({ breakdown, template }: BreakdownRead): string[] {
  if (breakdown.status === "failed") {
    return [
      `The breakdown failed: ${breakdown.error ?? "no reason was given."}`,
      "Reading the ad again is paid too: run the same exodus video swipe command with --yes, after the member's yes.",
    ];
  }
  return ["The breakdown is done.", ...spentLines(breakdown), ...nextAfterBreakdown(breakdown._id, template)];
}

function spentLines(breakdown: SwipeBreakdown): string[] {
  if (breakdown.reused) return ["It reused answers bought before, so it cost nothing."];
  if (breakdown.spentUsd === null || breakdown.spentUsd <= 0) return [];
  return [`It cost ${usd(breakdown.spentUsd)}${breakdown.costIsEstimate ? " (partly an estimate)" : ""}, on the team's keys.`];
}

function nextAfterBreakdown(breakdownId: string, template: SwipeTemplateView | null): string[] {
  if (template) return [...templateLines(template), ...nextAfterTemplate(breakdownId)];
  return [`Next, the template (paid, on the member's key; ask first): exodus video swipe template ${breakdownId} --yes`];
}

const STATUS_WORD: Record<SwipeBreakdown["status"], string> = {
  queued: "waiting to start",
  running: "reading the ad",
  done: "done",
  failed: "failed",
};

/**
 * `exodus video swipe status <breakdownId>`: where it stands, step by step; --wait waits for it to end. --full adds
 * what the breakdown read from the ad: each shot, the script with who says each line, and the cast.
 */
export async function swipeStatusFlow(breakdownId: string, opts: SwipeRunOptions, deps: VideoDeps, full = false): Promise<FlowResult> {
  const readPath = `${SWIPE_BREAKDOWNS_PATH}?id=${encodeURIComponent(breakdownId)}`;
  if (opts.wait) {
    const out = progress(opts);
    out.say(`Waiting for breakdown ${breakdownId}.`);
    const waited = await waitForBreakdown(breakdownId, opts, deps, out.say);
    // What it read is asked for once, at the end: the polls stay small.
    const done = waited.json.breakdown && (waited.json.breakdown as SwipeBreakdown).status === "done";
    const extra = full && done ? await deps.get(`${readPath}&full=1`).catch(() => null) : null;
    const fullPart = extra?.ok && isRecord(extra.data) ? extra.data : {};
    if (opts.json) {
      return {
        code: waited.code,
        lines: [
          JSON.stringify({
            ok: waited.code === 0,
            breakdownId,
            ...waited.json,
            ...("full" in fullPart ? { full: fullPart.full } : {}),
            ...("fullProblem" in fullPart ? { fullProblem: fullPart.fullProblem } : {}),
          }),
        ],
      };
    }
    const fullText = !full || !done ? [] : extra?.ok ? fullLines(fullPart) : ["", "What the breakdown read could not be fetched. Ask again: exodus video swipe status " + breakdownId + " --full"];
    return { code: waited.code, lines: [...out.kept, ...waited.lines, ...fullText] };
  }
  const res = await deps.get(full ? `${readPath}&full=1` : readPath);
  if (!res.ok) return swipeError(res, opts.json);
  const read = breakdownReadOf(res.data);
  if (!read) return failed("The server's answer about this breakdown could not be read.", opts.json);
  if (opts.json) return { code: 0, lines: [JSON.stringify(res.data)] };
  const { breakdown } = read;
  const width = Math.max(...breakdown.steps.map((step) => step.status.length));
  const lines = [
    `Breakdown ${breakdown._id}: ${STATUS_WORD[breakdown.status]}`,
    `The ad: ${breakdown.sourceUrl ?? breakdown.fileName ?? "an uploaded file"}`,
    ...breakdown.steps.map((step) => `  ${step.status.padEnd(width)}  ${step.label}`),
  ];
  if (breakdown.status === "done" || breakdown.status === "failed") lines.push(...breakdownEndLines(read));
  else lines.push(`Wait for it: exodus video swipe status ${breakdown._id} --wait`);
  if (full) lines.push(...fullLines(isRecord(res.data) ? res.data : {}));
  return { code: 0, lines };
}

const seconds = (start: number, end: number) => `${start.toFixed(1)}-${end.toFixed(1)} s`;
const EMBODIMENT: Record<SwipeFull["buildSheet"]["cast"][number]["embodiment"], string> = {
  "on-screen": "on screen",
  "voice-only": "voice only",
  "behind-camera": "behind the camera",
};

/**
 * What the breakdown read, as plain lines: each shot (its number, cut times, a-roll or cutaway, framing and camera,
 * its description), the script with who says each line, the cast, and what it was not sure about. No pictures: the
 * route sends none. `data` is the route's answer; without `full` it says why there is nothing to show.
 */
export function fullLines(data: Record<string, unknown>): string[] {
  if (!isRecord(data.full)) {
    const why = typeof data.fullProblem === "string" ? data.fullProblem : "This server sent nothing it read.";
    return ["", why];
  }
  const full = data.full as unknown as SwipeFull;
  const { shots } = full.footage;
  const { cast, script } = full.buildSheet;
  const nameOf = new Map(cast.map((member) => [member.characterId, member.name || member.characterId]));
  const about = [full.source.advertiser, `${Math.round(full.source.durationSec)} s`, full.source.aspectRatio].filter(Boolean).join(", ");
  const lines = ["", `What Exodus read from the ad (${about}):`, "", `Shots (${shots.length}):`];
  for (const shot of shots) {
    const number = shot.id.replace(/^s/, "");
    lines.push(`  ${number.padStart(2)}  ${seconds(shot.start, shot.end)}  ${shot.kind === "aroll" ? "a-roll" : "cutaway"}, ${shot.shotSize}, ${shot.camera}`);
    lines.push(`      ${shot.description}`);
  }
  lines.push("", "Script (who says each line):");
  for (const line of script) {
    const who = line.speakerId === null ? "Narrator (voice-over)" : (nameOf.get(line.speakerId) ?? line.speakerId);
    lines.push(`  ${line.lineId.padEnd(4)}${seconds(line.start, line.end)}  ${who}: ${line.text}`);
  }
  lines.push("", "Cast:");
  if (cast.length === 0) lines.push("  No cast listed.");
  for (const member of cast) {
    lines.push(`  ${member.name || member.characterId} (${member.characterId}), ${EMBODIMENT[member.embodiment] ?? member.embodiment}`);
    lines.push(`      Look: ${member.look}`, `      Voice: ${member.voice}`);
  }
  if (full.warnings.length > 0) lines.push("", "What it was not sure about:", ...full.warnings.map((warning) => `  - ${warning}`));
  return lines;
}

// ── The template ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Two tries of up to 180 s each, and the time to start: ten minutes is past the worst case. */
const TEMPLATE_MAX_POLLS = 120;

function templateLines(template: SwipeTemplateView): string[] {
  return [
    `Kind of ad: ${template.kind.label} (${template.kind.key})`,
    `  ${template.kind.why}`,
    `Look: ${template.look.label} (${template.look.slug})`,
    `  ${template.look.why}`,
    `Their ad: ${template.lines} lines, about ${Math.round(template.seconds)} s.`,
  ];
}

function nextAfterTemplate(breakdownId: string): string[] {
  return [
    "The swipe writes this kind of ad and no other. If the member wants another kind, say so before writing.",
    "Next: pick a product (exodus video swipe products), then write (paid, on the member's key; ask first):",
    `  exodus video swipe write ${breakdownId} --product <productId> --mode whole-ad --closeness 2 --yes`,
  ];
}

/** `exodus video swipe template <breakdownId>`: the kind of ad and look the ad matched; made once, then kept. */
export async function swipeTemplateFlow(breakdownId: string, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult> {
  const { json } = opts;
  if (!opts.yes) return needsYesResult("template", json);
  const res = await deps.post(SWIPE_TEMPLATE_PATH, { breakdownId });
  if (!res.ok) return swipeError(res, json);
  const answer = isRecord(res.data) ? res.data : {};
  const done = (template: SwipeTemplateView, costFree: boolean, kept: string[] = []): FlowResult => ({
    code: 0,
    lines: json
      ? [JSON.stringify({ ok: true, breakdownId, template, costFree })]
      : [
          ...kept,
          ...templateLines(template),
          ...(costFree ? ["This template was already made, so it cost nothing."] : []),
          ...nextAfterTemplate(breakdownId),
        ],
  });
  if (answer.status === "stored" && isRecord(answer.template)) return done(answer.template as unknown as SwipeTemplateView, true);
  if (answer.status !== "making" || typeof answer.job !== "string") {
    return failed("The server's answer about the template could not be read.", json);
  }
  const job = answer.job;
  const out = progress(opts);
  out.say("Making the template on the member's key. It takes up to six minutes.");
  const ended = await poll<{ refused: ApiResponse<unknown> } | { template: SwipeTemplateView } | { error: string }>(
    () => deps.get(`${SWIPE_TEMPLATE_PATH}?breakdownId=${encodeURIComponent(breakdownId)}&job=${encodeURIComponent(job)}`),
    (polled) => {
      if (!polled.ok) return { done: { refused: polled } };
      const state = isRecord(polled.data) ? polled.data : {};
      if (state.status === "stored" && isRecord(state.template)) return { done: { template: state.template as unknown as SwipeTemplateView } };
      if (state.status === "failed") return { done: { error: typeof state.error === "string" ? state.error : "no reason was given." } };
      return null;
    },
    TEMPLATE_MAX_POLLS,
    deps,
  );
  const hint = `The template may still be made: exodus video swipe status ${breakdownId}`;
  if ("lost" in ended) return failed(`${LOST} ${hint}`, json);
  if ("timedOut" in ended) {
    return failed(`Still making the template after 10 minutes. Waiting costs nothing more. Check later: exodus video swipe status ${breakdownId}`, json);
  }
  const result = ended.done;
  if ("refused" in result) return waitRefused(result.refused, hint, json);
  if ("error" in result) return failed(`The template could not be made: ${result.error}`, json, { breakdownId });
  return done(result.template, false, out.kept);
}

// ── Products ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** `exodus video swipe products`: the brand's products a swipe can be written for. */
export async function swipeProductsFlow(opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult> {
  const res = await deps.get(SWIPE_PRODUCTS_PATH);
  if (!res.ok) return swipeError(res, opts.json);
  const products = isRecord(res.data) && Array.isArray(res.data.products) ? (res.data.products as Array<{ id: string; name: string; description?: string }>) : [];
  if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, products })] };
  if (products.length === 0) return { code: 0, lines: ["This brand has no products yet. Add one in the dashboard first."] };
  const width = Math.max(...products.map((p) => p.id.length));
  return {
    code: 0,
    lines: [
      "The brand's products. Write for one with --product <id>:",
      ...products.map((p) => `  ${p.id.padEnd(width)}  ${p.name}${p.description ? ` — ${p.description}` : ""}`),
    ],
  };
}

// ── The write ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The write's deadline is nine minutes (convex/lib/workflow/swipeScript.ts DEADLINE_MS); fifteen is past it. */
const WRITE_MAX_POLLS = 180;

function choiceLines(ask: WriteAsk): string[] {
  const mode = modeOf(ask.mode);
  const lines = [`Mode: ${mode.label}. ${mode.helper}`];
  if (ask.mode !== "their-format") {
    const step = closenessOf(ask.closeness)!;
    lines.push(`Closeness: ${step.step}, ${step.name}. ${step.line}`);
  }
  if (ask.look) lines.push(`New look: ${ask.look}`);
  return lines;
}

function requestOf(ask: WriteAsk, memberScript: string | undefined): Record<string, unknown> {
  switch (ask.mode) {
    case "their-format":
      return { mode: ask.mode, memberScript };
    case "new-look":
      return { mode: ask.mode, closeness: ask.closeness, look: ask.look };
    default:
      return { mode: ask.mode, closeness: ask.closeness };
  }
}

/** What a try cost, written or refused: a refusal was paid for too. A row with no cost had no usage reported. */
function costLine(swipe: SwipeView): string {
  return swipe.costUsd !== null
    ? `It cost ${usd(swipe.costUsd)} on the member's key.`
    : "What it cost is unknown: the provider reported no usage for it.";
}

function swipeLines(swipe: SwipeView, after: "write" | "show"): string[] {
  if (swipe.outcome.kind === "refused") {
    return [
      `The writer refused: ${swipe.outcome.why}`,
      ...(swipe.checksFound?.length ? ["What the checks found:", ...swipe.checksFound.map((p) => `  - ${p}`)] : []),
      `Swipe ${swipe._id} keeps this refusal: exodus video swipe show ${swipe._id}`,
      costLine(swipe),
      "Nothing was started.",
      ...(after === "write" ? ["Writing again is paid too: the same exodus video swipe write line, after the member's yes."] : []),
    ];
  }
  const { draft } = swipe.outcome;
  return [
    `Swipe ${swipe._id} written.`,
    `Kind of ad: ${draft.conceit}`,
    `Look: ${draft.style}`,
    "",
    draft.script,
    "",
    ...(draft.direction.trim() ? [`Direction: ${draft.direction}`] : []),
    `Kept: ${draft.note.kept}`,
    `Changed: ${draft.note.changed}`,
    ...(draft.lengthGap ? [`Length: ours is about ${draft.lengthGap.ours} s, theirs about ${draft.lengthGap.theirs} s.`] : []),
    costLine(swipe),
    "",
    swipe.workflowRunId
      ? `It started run ${swipe.workflowRunId}: exodus video status ${swipe.workflowRunId}. Another start is a second, paid video.`
      : `Start the video (paid; ask first): exodus video swipe start ${swipe._id} --yes`,
  ];
}

/** `exodus video swipe write <breakdownId> --product <id>`: the brand's version, written on the member's key. */
export async function swipeWriteFlow(breakdownId: string, ask: WriteAsk, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult> {
  const { json } = opts;
  let memberScript: string | undefined;
  if (ask.scriptFile !== undefined) {
    try {
      memberScript = deps.readFile(ask.scriptFile);
    } catch {
      return failed(`Can't read --script ${ask.scriptFile}. Check the path.`, json);
    }
    if (!memberScript.trim()) return failed(`--script ${ask.scriptFile} is empty.`, json);
  }
  if (!opts.yes) return needsYesResult("write", json, choiceLines(ask));
  const res = await deps.post(SWIPES_PATH, { breakdownId, productId: ask.productId, request: requestOf(ask, memberScript) });
  if (!res.ok) return swipeError(res, json);
  const job = isRecord(res.data) ? res.data.job : undefined;
  if (typeof job !== "string") return failed("The server did not say which write it started.", json);
  const out = progress(opts);
  out.say("Writing the brand's version on the member's key. It takes four to nine minutes.");
  const ended = await poll<{ refused: ApiResponse<unknown> } | { swipe: SwipeView } | { error: string }>(
    () => deps.get(`${SWIPES_PATH}?job=${encodeURIComponent(job)}`),
    (polled) => {
      if (!polled.ok) return { done: { refused: polled } };
      const state = isRecord(polled.data) ? polled.data : {};
      if (state.status === "done" && isRecord(state.swipe)) return { done: { swipe: state.swipe as unknown as SwipeView } };
      if (state.status === "failed") return { done: { error: typeof state.error === "string" ? state.error : "no reason was given." } };
      return null;
    },
    WRITE_MAX_POLLS,
    deps,
  );
  const hint = "The write may still finish: exodus video swipe list";
  if ("lost" in ended) return failed(`${LOST} ${hint}`, json);
  if ("timedOut" in ended) {
    return failed("Still writing after 15 minutes. Waiting costs nothing more. See it later: exodus video swipe list", json);
  }
  const result = ended.done;
  if ("refused" in result) return waitRefused(result.refused, hint, json);
  if ("error" in result) return failed(`The write stopped: ${result.error} Nothing was started.`, json);
  const { swipe } = result;
  const written = swipe.outcome.kind === "written";
  if (json) {
    return { code: written ? 0 : 1, lines: [JSON.stringify(written ? { ok: true, swipe } : { ok: false, refused: true, swipe })] };
  }
  return { code: written ? 0 : 1, lines: [...out.kept, ...swipeLines(swipe, "write")] };
}

/** `exodus video swipe show <swipeId>`: one swipe again. */
export async function swipeShowFlow(swipeId: string, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult> {
  const res = await deps.get(`${SWIPES_PATH}?id=${encodeURIComponent(swipeId)}`);
  if (!res.ok) return swipeError(res, opts.json);
  const swipe = isRecord(res.data) && isRecord(res.data.swipe) ? (res.data.swipe as unknown as SwipeView) : null;
  if (!swipe) return failed("The server's answer about this swipe could not be read.", opts.json);
  if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, swipe })] };
  return { code: 0, lines: swipeLines(swipe, "show") };
}

/** `exodus video swipe list`: the brand's newest swipes, a refusal marked with what it cost. */
export async function swipeListFlow(opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult> {
  const res = await deps.get(SWIPES_PATH);
  if (!res.ok) return swipeError(res, opts.json);
  const swipes = isRecord(res.data) && Array.isArray(res.data.swipes) ? (res.data.swipes as SwipeListRow[]) : [];
  if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, swipes })] };
  if (swipes.length === 0) return { code: 0, lines: ["This brand has no swipes yet."] };
  return {
    code: 0,
    lines: swipes.map((row) => {
      const mode = modeOf(row.request.mode);
      const step = row.request.closeness !== undefined ? closenessOf(row.request.closeness) : undefined;
      const ad = row.source?.sourceUrl ?? row.source?.fileName ?? "an ad";
      return [
        row._id,
        `${mode.label}${step ? `, ${step.step} ${step.name}` : ""}`,
        ad,
        ...(row.workflowRunId ? [`run ${row.workflowRunId}`] : []),
        ...(row.outcome?.kind === "refused"
          ? [`refused, ${typeof row.costUsd === "number" ? `cost ${usd(row.costUsd)}` : "cost unknown"}, nothing started`]
          : []),
      ].join("  ");
    }),
  };
}

// ── The start ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** `exodus video swipe start <swipeId>`: the run the swipe holds, started as the dashboard's script door starts it. */
export async function swipeStartFlow(swipeId: string, ask: StartAsk, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult> {
  const { json } = opts;
  if (!opts.yes) return needsYesResult(ask.oneShot ? "start-one-shot" : "start", json);
  const res = await deps.post(SWIPE_RUNS_PATH, {
    swipeId,
    ...(ask.style ? { style: ask.style } : {}),
    ...(ask.title ? { title: ask.title } : {}),
    ...(ask.music ? { music: true } : {}),
    // Guided unless --one-shot, as the dashboard sends it.
    ...(ask.oneShot ? {} : { reviewStoryboard: true }),
  });
  if (!res.ok) return swipeError(res, json);
  const customer = customerAnswer<CustomerStart>(res.data);
  const data = isRecord(res.data) ? res.data : {};
  const runId = customer?.runId ?? (typeof data.runId === "string" ? data.runId : "");
  const url = customer?.dashboardUrl ?? (typeof data.url === "string" ? data.url : "");
  if (!runId) return failed("The server started the ad but did not say which run it is.", json);
  const card = isRecord(data.card) ? data.card : null;
  const label = (value: unknown) => (isRecord(value) && typeof value.label === "string" ? value.label : null);
  const head = [
    `Started ad run ${runId} from swipe ${swipeId}`,
    ...(label(card?.conceit) ? [`Kind of ad: ${label(card?.conceit)}`] : []),
    ...(label(card?.style) ? [`Look: ${label(card?.style)}`] : []),
    `Watch it: ${url}`,
  ];
  if (opts.wait) return startedThenWait(runId, head, { json, url, onProgressLine: opts.onProgressLine }, deps);
  if (json) return { code: 0, lines: [JSON.stringify({ ok: true, runId, url })] };
  return {
    code: 0,
    lines: [
      ...head,
      "",
      ask.oneShot
        ? "The app approves the storyboard itself if its checks pass. It only stops for you if they find a problem."
        : "It stops at the storyboard for the member's yes. Nothing else is bought before then.",
      `Check in whenever: exodus video status ${runId}`,
    ],
  };
}

// ── Dispatch ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Runs a plan the planner made; a usage plan is the caller's to print. */
export async function runSwipePlan(
  plan: Exclude<SwipePlan, { kind: "usage" }>,
  deps: VideoDeps,
  onProgressLine?: (line: string) => void,
): Promise<FlowResult> {
  const opts = { ...plan.opts, ...(onProgressLine ? { onProgressLine } : {}) };
  switch (plan.kind) {
    case "breakdown":
      return swipeBreakdownFlow(plan.source, opts, deps);
    case "status":
      return swipeStatusFlow(plan.breakdownId, opts, deps, plan.full);
    case "template":
      return swipeTemplateFlow(plan.breakdownId, opts, deps);
    case "products":
      return swipeProductsFlow(opts, deps);
    case "write":
      return swipeWriteFlow(plan.breakdownId, plan.ask, opts, deps);
    case "show":
      return swipeShowFlow(plan.swipeId, opts, deps);
    case "list":
      return swipeListFlow(opts, deps);
    case "start":
      return swipeStartFlow(plan.swipeId, plan.ask, opts, deps);
  }
}
