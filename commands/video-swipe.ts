/**
 * `exodus video swipe`: the dashboard's "Swipe a video" door (Door 4) from the terminal. A competitor's video ad is
 * broken down, matched to the closest kind of ad and look we make (its swipe template), written again for the
 * brand's product, and started as a video run, exactly as the dashboard's script door starts one: on the kind the
 * swipe wrote, launched via "swipe", Guided unless --one-shot.
 *
 * Four steps cost money: the breakdown (the team's keys), the template and the write (the member's own Anthropic or
 * OpenRouter key) and the start (the run's storyboard and pictures, and with --one-shot the rest of the video). The
 * CLI knows no price for any of them, so each one asks for --yes and, without it, sends nothing and says what the
 * step buys and who pays; the start also says its price for a kind whose saved sheet has one (`swipe sheet price`,
 * COP-265). The template and the write take minutes: the server answers at once with a job, and the
 * CLI polls it until the work is done or says why it stopped.
 *
 * The answers mirror convex/http.ts's swipe routes. This package ships on its own schedule, so the shapes are
 * copied here rather than imported.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FlagOccurrence } from "../lib/args.js";
import type { ApiResponse } from "../lib/client.js";
import { formatApiError } from "../lib/format.js";
import { missingRouteLine } from "../lib/route-support.js";
import { customerAnswer, customerStageIsWorking, type CustomerRun, type CustomerStart } from "./video-customer.js";
import { asVideoRun, describeFetchFailure, RUN_PATH, startedThenWait, waitFlow, type FlowResult, type VideoDeps } from "./video.js";

export const SWIPE_BREAKDOWNS_PATH = "/api/v2/video/breakdowns";
export const SWIPE_UPLOAD_URL_PATH = "/api/v2/video/breakdowns/upload-url";
export const SWIPE_TEMPLATE_PATH = "/api/v2/video/swipe-template";
export const SWIPE_PRODUCTS_PATH = "/api/v2/video/swipe-products";
export const SWIPES_PATH = "/api/v2/video/swipes";
export const SWIPE_RUNS_PATH = "/api/v2/video/swipe-runs";
/** A swipe's saved sheet (COP-265): GET ?id= reads it, POST { swipeId, picks } sets rows of it. */
export const SWIPE_SHEET_PATH = "/api/v2/video/swipe-sheet";
/** The price of a swipe's video before the yes (COP-265 part 6): GET ?id= answers { price, dashboardUrl }. Free. */
export const SWIPE_SHEET_PRICE_PATH = "/api/v2/video/swipe-sheet-price";
/**
 * COP-265 part 7: POST { swipeId, row, count?, yes? } asks for a row's options: new people (paid) or voices (one read of the voice list on the member's ElevenLabs key; no speech is made).
 */
export const SWIPE_SHEET_OPTIONS_PATH = "/api/v2/video/swipe-sheet/options";
/**
 * U6: what every call to the sheet's routes adds to its address, to say this CLI prints the source "recommended"
 * (video/lib/sheet.ts SHEET_SOURCES_PARAM). A server sends that word only to a CLI that says so, and "kind" to any other.
 */
export const SHEET_SOURCES_QUERY = "sources=recommended";
/** COP-289: GET ?breakdownId=&kind= says whether a write makes people for the sheet, and their price. Free. */
export const SWIPE_WRITE_PEOPLE_PATH = "/api/v2/video/swipe-write-people";
/** The brand's swipe library (convex/http.ts), the same free read `exodus genesis --list-swipes` makes. */
export const SWIPE_LIBRARY_PATH = "/api/v2/swipe-library";

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
  /** The breakdown's format version: "1.0", "1.1" or "1.2". */
  version?: string;
  /** How the ad is filmed (format 1.1, more fields in 1.2); absent from a breakdown of 1.0. */
  filming?: SwipeFilming;
  warnings: string[];
}

/**
 * The filming block as `?full=1` sends it (src/lib/video-breakdown/schema.ts, FilmingSchema), the fields the CLI
 * prints. Every field is optional: one that is missing was not read. The lists' values are printed as they come.
 */
export interface SwipeFilming {
  filmedBy?: string;
  movement?: string;
  cuts?: string;
  cutsPerMinute?: number;
  framing?: string;
  places?: string;
  placeList?: Array<{ setting?: string; line: string }>;
  placeLine?: string;
  props?: string[];
  light?: string;
  lightSource?: string;
  body?: string;
  captions?: { amount?: string; style?: string; position?: string; caps?: boolean };
  inserts?: Array<{ part: string; at: number; secondsOn?: number; where?: string; widthPct?: number; words?: string }>;
  brollShare?: string;
  wordsPerSecond?: number;
  firstSeconds?: string;
  hookBuilt?: string;
  endCard?: string;
  measuredStillPct?: number;
  cameraHeight?: string;
  cameraTilt?: string;
  pose?: string;
  moves?: Array<{ move: string; at: number; to?: number }>;
  held?: Array<{ thing: string; hands?: string; product?: boolean; wholeAd: boolean; from?: number; to?: number }>;
  handActions?: Array<{ does: string; things?: string; product?: boolean; from: number; to: number }>;
  personLook?: { hair?: string; hairColour?: string; skinTone?: string; build?: string; glasses?: string; facialHair?: string };
}

export interface SwipeTemplateView {
  kind: { key: string; label: string; why: string };
  look: { slug: string; label: string; why: string };
  lines: number;
  seconds: number;
  /**
   * COP-291: the kinds the server offers next to the match for this member, each with what it makes (`about`, the first
   * sentence of the kind's Description) and its reason, in the server's words. Absent from a server before it, and when
   * none is offered.
   */
  offered?: Array<{ key: string; label: string; about?: string; reason: string }>;
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
  /** As the swipe stored it; a their-format swipe's carries the member's script as sent. */
  request: { mode: ServerMode; closeness?: number; look?: string; memberScript?: string };
  /** The kind of ad the write was asked for in place of the template's pick; absent when none was named. */
  kind?: string;
  outcome: { kind: "written"; draft: SwipeDraft } | { kind: "refused"; why: string };
  /** An admin's read only: what the checks found on a refusal. */
  checksFound?: string[];
  workflowRunId: string | null;
  costUsd: number | null;
  /** False when the swipe's run failed or was cancelled, so it starts again without --again; absent from older servers. */
  runHoldsStart?: boolean;
}

export interface SwipeListRow {
  _id: string;
  breakdownId: string;
  /** When the write ended and stored the row (ms). Absent from older servers. */
  createdAt?: number;
  request: { mode: ServerMode; closeness?: number };
  workflowRunId: string | null;
  /** sourceAdId: the swipe-library ad it came from; absent from older servers. */
  source: { sourceKind: string; sourceUrl?: string; fileName?: string; sourceAdId?: string } | null;
  /** Absent from a server that lists written swipes only. */
  outcome?: { kind: "written" | "refused" };
  costUsd?: number | null;
  /** The product it was written for; null once deleted, absent from older servers. */
  product?: { id: string; name: string } | null;
}

/**
 * Who set a sheet row's value (video/lib/sheet.ts SheetFrom). U6: "recommended" is a value the server worked out for this
 * swipe, with why; it comes only because this CLI asks for it (SHEET_SOURCES_QUERY).
 */
export type SheetFrom = "you" | "their-ad" | "kind" | "recommended";

/** One row of a swipe's saved sheet, as GET /api/v2/video/swipe-sheet sends it (video/lib/sheet.ts SheetRowView). */
export interface SavedSheetRow {
  id: string;
  label: string;
  value: string | number | boolean | null;
  from: SheetFrom | null;
  why: string | null;
  /** Each a name; a person made for the member also has their picture's address, a voice its sample's address. */
  options: Array<{ id: string; label: string; pictureUrl?: string; sampleUrl?: string }> | null;
  optionsCostUsd: number | null;
  usedBy: string | null;
  readOnly: boolean;
  /**
   * Where an ask for the row's options stands (COP-265 part 7); absent from older servers. COP-289: while options are
   * made, how many the ask makes and how long ago it started, by the server's clock.
   */
  optionsStatus?: {
    making: boolean;
    sentence: string;
    spentUsd?: number;
    asksLeft?: number;
    failed?: boolean;
    noneYet?: boolean;
    count?: number;
    makingForMs?: number;
  };
  /** U6: the row's closed value for none and its words (the prop: "none", nothing in the hand); absent from older servers. */
  none?: { value: string; label: string };
  /**
   * The id of the option the row recommends, whatever value it holds: the person's voice (COP-285) or the person a
   * check of the faces picked (COP-289); absent when none, and from older servers.
   */
  recommended?: string;
}

/** A swipe's saved sheet (video/lib/sheet.ts SheetView), kept on the server; no dashboard page shows it yet. */
export interface SavedSheet {
  swipeId: string;
  kind: { key: string; label: string } | null;
  run: { id: string } | null;
  sections: Array<{ id: string; label: string; rows: SavedSheetRow[] }>;
  /** When the kind has a sheet but this member may not start the kind: the start's own sentence. Absent from older servers. */
  startRefusal?: string;
  /** Only in the answer to a set: what it changed beside the rows it named. */
  notice?: string;
}

/** One size and takes of a swipe's video, priced (convex/videoSheet.ts SheetPriceRow), or why it has no price. */
export type SwipePriceRow =
  | {
      size: string;
      takes: "all" | "first";
      filmedTakes: number;
      costUsd: number;
      maxUsd: number;
      lines: Array<{ what: string; usd: number }>;
      /** The start would refuse this one, in its own sentence (a video tester's daily cap). */
      startRefusal?: string;
    }
  | { size: string; takes: "all" | "first"; why: string };

/** The price of a swipe's video before the yes, as GET /api/v2/video/swipe-sheet-price sends it (convex/videoSheet.ts SheetPrice). */
export type SwipePrice =
  | {
      swipeId: string;
      kind: { key: string; label: string } | null;
      priced: true;
      /** Whether this server offers 480p and the first take only; false: the options are the kind's own film alone. */
      sizeChoices: boolean;
      scriptTakes: number;
      picked: Extract<SwipePriceRow, { costUsd: number }>;
      options: SwipePriceRow[];
      notes: string[];
      leavesOut: string;
      /** Why a start now would be refused whatever the size, in the start's own sentences. */
      startRefusals: string[];
      /** The swipe's video, when it has one. */
      heldBy: string | null;
      approximate: true;
    }
  | { swipeId: string; kind: { key: string; label: string } | null; priced: false; why: string };

/** COP-289: whether a write makes people to pick from on its sheet, and their price (video/lib/sheetWritePeople.ts WritePeople). */
export type WritePeople =
  | { makesPeople: false; reason: string }
  | { makesPeople: true; count: number; aboutUsd: number; mostUsd: number; paidBy: string; lines: string[] };

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
  /** The script's text, read once by whoever checked it (a sheet), and sent as it was read. */
  scriptText?: string;
  /** A kind of ad's key, written in place of the template's pick. The server takes only a kind on this ad's menu. */
  kind?: string;
  /** COP-289: the most the dry print showed for the people the write makes (--people-max-usd); absent, it makes none. */
  peopleMaxUsd?: number;
  /** COP-289: --no-people: the dry print leaves the people out, and the write makes none. */
  noPeople?: boolean;
}

export interface StartAsk {
  style?: string;
  title?: string;
  music: boolean;
  oneShot: boolean;
  /** COP-265 part 6: the most the price before the yes showed; the server refuses a start that can now cost more. */
  maxUsd?: number;
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
  | { kind: "find"; ask: FindAsk; opts: SwipeOpts }
  | { kind: "start"; swipeId: string; ask: StartAsk; again: boolean; opts: SwipeOpts }
  | { kind: "sheet"; swipeId: string; opts: SwipeOpts }
  | { kind: "sheet-set"; swipeId: string; picks: Record<string, string | null>; opts: SwipeOpts }
  | { kind: "sheet-price"; swipeId: string; opts: SwipeOpts }
  | { kind: "sheet-people"; swipeId: string; count: number | null; maxUsd: number | null; opts: SwipeOpts }
  | { kind: "sheet-voices"; swipeId: string; opts: SwipeOpts }
  | { kind: "run"; sheetFile: string; retryRefused: boolean; status: boolean; persona: string | null; opts: SwipeOpts };

const VERBS = ["status", "template", "products", "write", "show", "list", "start", "run", "find", "sheet"];

/** --mode's word: whole-ad, hook-only, their-format or new-look. */
export function parseSwipeMode(value: string): ServerMode | null {
  return SWIPE_MODES.find((m) => m.flag === value.trim().toLowerCase())?.mode ?? null;
}

/** --closeness: 1 to 5, or the step's name (mirror, close, same-beats, same-arc, pattern-only). */
export function parseCloseness(value: string): number | null {
  const word = value.trim().toLowerCase();
  return SWIPE_CLOSENESS.find((c) => String(c.step) === word || c.flag === word)?.step ?? null;
}

/** The other verbs' flags, and where a sheet says the same. */
const SHEET_FLAGS: ReadonlyArray<[string, string]> = [
  ["one-shot", 'set "oneShot" in the sheet.'],
  ["music", 'set "music" in the sheet\'s "finish".'],
  ["mode", 'set "mode" in the sheet.'],
  ["closeness", 'set "closeness" in the sheet.'],
  ["product", 'set "product" in the sheet.'],
  ["look", 'set "look" in the sheet.'],
  ["script", 'set "script" in the sheet, or a persona\'s "script".'],
  ["style", 'set "style" in the sheet.'],
  ["title", 'set "title" in the sheet.'],
  ["kind", 'set "kind" in the sheet.'],
  ["file", 'list the ad in the sheet\'s "sources".'],
  ["url", 'list the ad in the sheet\'s "sources".'],
  ["ad", 'list the ad in the sheet\'s "sources".'],
  ["full", "--full is for exodus video swipe status."],
  ["again", "a sheet never starts a swipe twice. For a second video of one swipe, use exodus video swipe start <swipeId> --again."],
];

const OFF_WORDS = new Set(["false", "no", "off", "0"]);
const ON_WORDS = new Set(["true", "yes", "on", "1"]);
const SWITCHES = ["json", "yes", "wait", "full", "music", "one-shot", "retry-refused", "status", "again"] as const;

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
  // A kind of ad is named on the write alone; any other verb refuses --kind rather than drop it (COP-255). Its word
  // may stand where the verb goes (`swipe --url L --kind x`), so the verb is the first word that is one.
  if (last("kind") !== undefined) {
    const named = rest.find((word) => VERBS.includes(word));
    if (named !== "write") return usage(kindElsewhere(named));
  }
  // COP-289 review: the people's two flags are the write's alone; any other verb refuses them rather than drop them.
  const peopleFlag = last("people-max-usd") !== undefined ? "people-max-usd" : last("people")?.flag === "no-people" ? "no-people" : null;
  if (peopleFlag !== null) {
    const named = rest.find((word) => VERBS.includes(word));
    if (named !== "write") {
      const who = named === undefined ? "video swipe --file, --url and --ad" : `video swipe ${named}`;
      return usage(
        peopleFlag === "people-max-usd"
          ? `${who} takes no --people-max-usd: it carries the people's most on exodus video swipe write --yes.`
          : `${who} takes no --no-people: it is a flag of exodus video swipe write.`,
      );
    }
  }

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
  if (verb === "find") {
    // A list buys nothing: a paid step's flag, another ad or another verb's choice is refused, never quietly dropped.
    const typedFlag = (names: readonly string[]) =>
      occurrences.find((o) => names.some((name) => o.flag === name || o.flag === `no-${name}`))?.flag;
    const paid = typedFlag(FIND_PAID_FLAGS);
    if (paid) {
      return usage(`video swipe find only lists the swipe library and buys nothing, so it takes no --${paid}. Read a picked ad with exodus video swipe --ad <id>.`);
    }
    const other = typedFlag(FIND_OTHER_FLAGS);
    if (other) return usage(`video swipe find takes no --${other}: it only lists the swipe library. Its flags are --brand, --limit and --json.`);
    // A switch's own on/off word (`--json true`) is not an id; any other word after a switch (`--json AG1`) is.
    const switchWord = (word: string) => ON_WORDS.has(word.toLowerCase()) || OFF_WORDS.has(word.toLowerCase());
    const extra = rest
      .slice(1)
      .find((word) => !(switchWord(word) && occurrences.some((o) => (SWITCHES as readonly string[]).includes(o.flag) && o.value === word)));
    if (extra !== undefined) return usage(`video swipe find takes no id (got "${extra}"). Name a competitor with --brand "<name>".`);
    const brand = value("brand");
    if (brand === null) return usage("video swipe find --brand needs a competitor's name.");
    const limitWord = value("limit");
    if (limitWord === null) return usage(`video swipe find --limit needs a number from 1 to ${FIND_MAX}.`);
    const limit = limitWord === undefined ? FIND_DEFAULT_LIMIT : /^\d+$/.test(limitWord.trim()) ? Number(limitWord.trim()) : NaN;
    if (!(limit >= 1 && limit <= FIND_MAX)) {
      return usage(`video swipe find --limit must be a whole number from 1 to ${FIND_MAX}, not "${limitWord}".`);
    }
    return { kind: "find", ask: { brand: brand?.trim() ?? null, limit }, opts };
  }
  if (verb === "run") {
    // Every choice of a run lives in its sheet: another verb's flag would be dropped, so it is refused.
    const typed = SHEET_FLAGS.find(([flag]) => last(flag) !== undefined);
    if (typed) {
      const [flag, field] = typed;
      return usage(`video swipe run takes its choices from the sheet, not from --${flag}: ${field}`);
    }
    const sheet = value("sheet");
    if (!sheet) return usage("video swipe run needs --sheet <file>, the swipe's sheet.");
    const persona = value("persona");
    if (persona === null) return usage("video swipe run --persona needs a persona's name from the sheet.");
    if (on("status") && (opts.yes || opts.wait || on("retry-refused"))) {
      return usage("video swipe run --status only reads; leave off --yes, --wait and --retry-refused.");
    }
    return { kind: "run", sheetFile: sheet.trim(), retryRefused: on("retry-refused"), status: on("status"), persona: persona?.trim() ?? null, opts };
  }
  if (verb === "sheet") return planSheet(rest.slice(1), occurrences, opts);
  if (!id) {
    const named = verb === "show" || verb === "start" ? "swipeId" : "breakdownId";
    return usage(`video swipe ${verb} needs a ${named === "swipeId" ? "swipe" : "breakdown"} id: exodus video swipe ${verb} <${named}>`);
  }
  if (verb === "status") return { kind: "status", breakdownId: id, full: on("full"), opts };
  if (verb === "template") return { kind: "template", breakdownId: id, opts };
  if (verb === "show") return { kind: "show", swipeId: id, opts };
  if (verb === "start") {
    const start = startChoicesOf({ style: value("style"), title: value("title"), music: on("music"), oneShot: on("one-shot") }, CLI_WORDS.start);
    if ("problem" in start) return usage(start.problem);
    // COP-265 part 6: the most the price before the yes showed, which the start is held to.
    const most = value("max-usd");
    if (most === null) return usage("video swipe start --max-usd needs the most the price showed, such as 4.89.");
    if (most !== undefined && !/^\d+(\.\d{1,2})?$/.test(most.trim())) {
      return usage(`video swipe start --max-usd takes a dollar amount, such as 4.89 (got "${most}").`);
    }
    const ask = most === undefined ? start.ask : { ...start.ask, maxUsd: Number(most.trim()) };
    return { kind: "start", swipeId: id, ask, again: on("again"), opts };
  }

  // write
  const product = value("product");
  if (!product) return usage("video swipe write needs --product <id>. exodus video swipe products lists them.");
  const write = writeChoicesOf(
    { mode: value("mode"), closeness: value("closeness"), look: value("look"), script: value("script") },
    CLI_WORDS.write,
  );
  if ("problem" in write) return usage(write.problem);
  const kind = value("kind");
  if (kind === null || (kind !== undefined && !kind.trim())) return usage(`video swipe write --kind needs the key of a kind of ad. ${KIND_CHECKED}`);
  // COP-289: the people the write also makes. --people-max-usd carries the most the dry print showed; --no-people, none.
  const peopleMost = value("people-max-usd");
  if (peopleMost === null) return usage("video swipe write --people-max-usd needs the people's most the write showed, such as 1.32.");
  if (peopleMost !== undefined && !/^\d+(\.\d{1,2})?$/.test(peopleMost.trim())) {
    return usage(`video swipe write --people-max-usd takes a dollar amount, such as 1.32 (got "${peopleMost}").`);
  }
  const noPeople = last("people")?.flag === "no-people";
  if (peopleMost !== undefined && noPeople) return usage("video swipe write takes --people-max-usd or --no-people, not both.");
  if (peopleMost !== undefined && !opts.yes) return usage("video swipe write --people-max-usd goes with --yes, after the price.");
  const people = { ...(peopleMost !== undefined ? { peopleMaxUsd: Number(peopleMost.trim()) } : {}), ...(noPeople ? { noPeople: true } : {}) };
  return { kind: "write", breakdownId: id, ask: { productId: product.trim(), ...write.ask, ...(kind !== undefined ? { kind: kind.trim() } : {}), ...people }, opts };
}

/** A row's id as the server takes it: a copy of video/lib/sheetSections.ts SHEET_ROW_ID, held equal by a test. */
export const SHEET_ROW_ID = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const SHEET_SET_LINE = 'exodus video swipe sheet set <swipeId> <row>=<value> [<row>=<value> ...]';
const SHEET_PRICE_LINE = "exodus video swipe sheet price <swipeId>";
const SHEET_PEOPLE_LINE = "exodus video swipe sheet people <swipeId> [--count <n>] [--yes --max-usd <n>] [--wait] [--json]";

/** The most people one ask may make: the server's own (video/lib/picks.ts SHEET_PEOPLE_MOST_PER_ASK). */
export const SHEET_PEOPLE_MOST = 8;

/**
 * `swipe sheet <swipeId>`, `swipe sheet set <swipeId> <row>=<value> ...`, `swipe sheet price <swipeId>`, and COP-265
 * part 7's `swipe sheet people <swipeId>` (new people to pick from: paid, so the price comes first and --yes makes
 * them) and `swipe sheet voices <swipeId>` (voices to hear: one read of the voice list on the member's ElevenLabs key; no speech is made). `words` are the positional words after `sheet`. A
 * row given with nothing after its `=` is cleared. Only `people` takes a paid step's flags (--count, --yes, --max-usd,
 * --wait); every other flag is refused.
 */
function planSheet(words: string[], occurrences: FlagOccurrence[], opts: SwipeOpts): SwipePlan {
  const usage = (line: string): SwipePlan => ({ kind: "usage", line });
  const typedFlag = (names: readonly string[]) =>
    occurrences.find((o) => names.some((name) => o.flag === name || o.flag === `no-${name}`))?.flag;
  // A switch's own on/off word (`--json true`) is not a word of the command.
  const switchWords = new Set(
    occurrences.filter((o) => ["json", "yes", "wait"].includes(o.flag) && o.value !== undefined).map((o) => o.value as string),
  );
  const given = words.filter((word) => !(switchWords.has(word) && (ON_WORDS.has(word.toLowerCase()) || OFF_WORDS.has(word.toLowerCase()))));
  if (given[0] === "people") {
    // --max-usd is the start's too (part 6); here it carries the most the people's price said.
    const other = typedFlag([
      ...FIND_PAID_FLAGS.filter((flag) => flag !== "yes" && flag !== "wait"),
      ...FIND_OTHER_FLAGS.filter((flag) => flag !== "max-usd"),
      "brand",
      "limit",
    ]);
    if (other) return usage(`video swipe sheet people takes no --${other}. Its flags: --count, --yes, --max-usd, --wait, --json.`);
    const [, swipeId, ...extra] = given;
    if (!swipeId) return usage(`video swipe sheet people needs a swipe id: ${SHEET_PEOPLE_LINE}`);
    if (extra.length > 0) return usage(`video swipe sheet people takes one swipe id (got "${extra[0]}"): ${SHEET_PEOPLE_LINE}`);
    const typed = occurrences.filter((o) => o.flag === "count").at(-1);
    let count: number | null = null;
    if (typed) {
      const n = typed.value !== undefined && /^\d+$/.test(typed.value.trim()) ? Number(typed.value.trim()) : Number.NaN;
      if (!(n >= 1 && n <= SHEET_PEOPLE_MOST)) return usage(`video swipe sheet people --count takes 1 to ${SHEET_PEOPLE_MOST} (got "${typed.value ?? ""}").`);
      count = n;
    }
    if (opts.wait && !opts.yes) return usage("video swipe sheet people --wait waits for people being made: give it with --yes, after the price.");
    // The yes is to a figure: the most the price said, which the server works out again and holds the yes to.
    const most = occurrences.filter((o) => o.flag === "max-usd").at(-1);
    let maxUsd: number | null = null;
    if (most) {
      const n = most.value !== undefined && /^\d+(\.\d+)?$/.test(most.value.trim()) ? Number(most.value.trim()) : Number.NaN;
      if (!Number.isFinite(n)) return usage(`video swipe sheet people --max-usd takes the price's most in dollars, such as 0.95 (got "${most.value ?? ""}").`);
      maxUsd = n;
    }
    if (opts.yes && maxUsd === null) {
      return usage("video swipe sheet people --yes needs --max-usd <n>, the most the price said. Run it without --yes first to read the price.");
    }
    if (maxUsd !== null && !opts.yes) return usage("video swipe sheet people --max-usd goes with --yes, after the price.");
    return { kind: "sheet-people", swipeId, count, maxUsd, opts };
  }
  // --count is the people's alone; --max-usd, which the start takes too, is refused below as on part 6's free verbs.
  const peopleOnly = typedFlag(["count"]);
  if (peopleOnly) return usage(`Only video swipe sheet people takes --${peopleOnly}.`);
  // The rest buys nothing and takes no other verb's choice: such a flag is refused, never quietly dropped.
  const paid = typedFlag(FIND_PAID_FLAGS);
  if (paid) return usage(`video swipe sheet is free and buys nothing, so it takes no --${paid}. Its only flag is --json.`);
  const other = typedFlag([...FIND_OTHER_FLAGS, "brand", "limit"]);
  if (other) return usage(`video swipe sheet takes no --${other}. Its only flag is --json.`);
  if (given[0] === "price") {
    const [, swipeId, ...extra] = given;
    if (!swipeId) return usage(`video swipe sheet price needs a swipe id: ${SHEET_PRICE_LINE}`);
    if (extra.length > 0) return usage(`video swipe sheet price takes one swipe id (got "${extra[0]}"): ${SHEET_PRICE_LINE}`);
    return { kind: "sheet-price", swipeId, opts };
  }
  if (given[0] === "voices") {
    const [, swipeId, ...extra] = given;
    if (!swipeId) return usage("video swipe sheet voices needs a swipe id: exodus video swipe sheet voices <swipeId> [--json]");
    if (extra.length > 0) return usage(`video swipe sheet voices takes one swipe id (got "${extra[0]}").`);
    return { kind: "sheet-voices", swipeId, opts };
  }
  if (given[0] !== "set") {
    const [swipeId, ...extra] = given;
    if (!swipeId) return usage("video swipe sheet needs a swipe id: exodus video swipe sheet <swipeId>");
    if (extra.length > 0) return usage(`video swipe sheet takes one swipe id (got "${extra[0]}"). To change a row: ${SHEET_SET_LINE}`);
    return { kind: "sheet", swipeId, opts };
  }
  const [, swipeId, ...pairs] = given;
  if (!swipeId || swipeId.includes("=")) return usage(`video swipe sheet set needs a swipe id first: ${SHEET_SET_LINE}`);
  if (pairs.length === 0) return usage(`video swipe sheet set needs a row and its value, such as notes="<your words>": ${SHEET_SET_LINE}`);
  const picks: Record<string, string | null> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    const row = at === -1 ? pair : pair.slice(0, at);
    if (at === -1 || !SHEET_ROW_ID.test(row)) {
      return usage(`video swipe sheet set takes <row>=<value>, not "${pair}". A row given as <row>= is cleared.`);
    }
    if (Object.prototype.hasOwnProperty.call(picks, row)) return usage(`video swipe sheet set names "${row}" twice. Give each row once.`);
    const value = pair.slice(at + 1);
    picks[row] = value === "" ? null : value;
  }
  return { kind: "sheet-set", swipeId, picks, opts };
}

/** How a named kind is checked, said wherever a kind is asked for. */
const KIND_CHECKED = "A kind this ad can't be made as is refused, with the kinds it can be made as, before the write is paid.";

/** The template step's kind line in a sheet run: the template's pick, and the kind the sheet names when it names one. */
const templateKindLine = (template: { kind: { label: string } }, kind: string | null) =>
  kind ? `Kind of ad: ${template.kind.label}, the template's pick; the write uses ${kind}, the sheet's kind.` : `Kind of ad: ${template.kind.label}.`;

/** Why a verb other than write takes no --kind. */
function kindElsewhere(verb: string | undefined): string {
  const onWrite = "the kind of ad is named when the swipe is written, with exodus video swipe write --kind <kind>.";
  if (verb === "run") return `video swipe run takes its choices from the sheet, not from --kind: ${SHEET_FLAGS.find(([flag]) => flag === "kind")![1]}`;
  if (verb === "start") return "video swipe start takes no --kind. A swipe starts on the kind it was written for; write it again with --kind.";
  if (verb === "find") return "video swipe find takes no --kind: it only lists the swipe library. Its flags are --brand, --limit and --json.";
  if (verb === undefined) return `video swipe --file, --url and --ad take no --kind: ${onWrite}`;
  return `video swipe ${verb} takes no --kind: ${onWrite}`;
}

/**
 * How a choice is named in a refusal: on the command line (`video swipe write --closeness ...`) or in a sheet
 * (`In the sheet, "closeness" ...`). The checks are the same either way; only the words differ.
 */
export interface ChoiceWords {
  who: string;
  flag: (name: string) => string;
  set: (name: string, value: string) => string;
}

const CLI_WORDS = {
  write: { who: "video swipe write", flag: (name: string) => `--${name}`, set: (name: string, value: string) => `--${name} ${value}` },
  start: { who: "video swipe start", flag: (name: string) => `--${name}`, set: (name: string, value: string) => `--${name} ${value}` },
} satisfies Record<string, ChoiceWords>;

/** A choice as typed: undefined when not given, null when given with no value, else its text. */
type Given = string | undefined | null;

/**
 * The write's choices, checked as the dashboard's door checks them: a known mode, closeness 1 to 5 (none for
 * their-format), a look only and always for new-look, a script only and always for their-format.
 */
export function writeChoicesOf(
  given: { mode: Given; closeness: Given; look: Given; script: Given },
  words: ChoiceWords,
): { ask: Omit<WriteAsk, "productId"> } | { problem: string } {
  const { who, flag, set } = words;
  const modeWord = given.mode;
  if (modeWord === null) return { problem: `${who} ${flag("mode")} needs whole-ad, hook-only, their-format or new-look.` };
  const mode = modeWord === undefined ? "whole" : parseSwipeMode(modeWord);
  if (!mode) return { problem: `${who} ${flag("mode")} must be whole-ad, hook-only, their-format or new-look, not "${modeWord}".` };
  const closenessWord = given.closeness;
  if (closenessWord === null) {
    return { problem: `${who} ${flag("closeness")} needs 1 to 5, or mirror, close, same-beats, same-arc or pattern-only.` };
  }
  if (mode === "their-format" && closenessWord !== undefined) {
    return { problem: `${who} ${flag("closeness")} does not apply to their-format: your own words stay as they are.` };
  }
  const closeness = closenessWord === undefined ? DEFAULT_CLOSENESS : parseCloseness(closenessWord);
  if (closeness === null) {
    return {
      problem: `${who} ${flag("closeness")} must be 1 to 5, or mirror, close, same-beats, same-arc or pattern-only, not "${closenessWord}".`,
    };
  }
  const { look, script } = given;
  if (look === null || (look === undefined && mode === "new-look")) {
    return { problem: `${who} ${set("mode", "new-look")} needs ${set("look", "<slug>")}, the new look.` };
  }
  if (look !== undefined && mode !== "new-look") return { problem: `${who} ${flag("look")} is only for ${set("mode", "new-look")}.` };
  if (script === null || (script === undefined && mode === "their-format")) {
    return { problem: `${who} ${set("mode", "their-format")} needs ${set("script", "<file>")}, your own script.` };
  }
  if (script !== undefined && mode !== "their-format") return { problem: `${who} ${flag("script")} is only for ${set("mode", "their-format")}.` };
  return {
    ask: {
      mode,
      closeness,
      ...(look ? { look: look.trim() } : {}),
      ...(script ? { scriptFile: script } : {}),
    },
  };
}

/** The start's choices: a look other than the swipe's own and a name, each with a value when given. */
export function startChoicesOf(
  given: { style: Given; title: Given; music: boolean; oneShot: boolean },
  words: ChoiceWords,
): { ask: StartAsk } | { problem: string } {
  const { who, flag, set } = words;
  if (given.style === null) return { problem: `${who} ${flag("style")} needs a look's slug.` };
  if (given.title === null) return { problem: `${who} ${flag("title")} needs a name: ${set("title", '"<name>"')}.` };
  return {
    ask: {
      ...(given.style ? { style: given.style.trim() } : {}),
      ...(given.title ? { title: given.title.trim() } : {}),
      music: given.music,
      oneShot: given.oneShot,
    },
  };
}

// ── Shared pieces ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Progress lines go out as they happen when a person is watching; otherwise they join the answer. */
export interface SwipeRunOptions extends SwipeOpts {
  onProgressLine?: (line: string) => void;
  /** Told the job a paid template or write was scheduled as, before the wait, so a stopped CLI can find it again. */
  onJob?: (job: string) => void;
  /** Called just before a file's paid breakdown is asked for, after the free upload, so it can be marked as sent. */
  beforePaidAsk?: () => void;
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
  /** A clock time (deps.now) the polling ends at, whatever the count: slow reads never stretch a wait past it. */
  untilMs?: number,
): Promise<{ done: T } | { lost: true } | { timedOut: true }> {
  let misses = 0;
  for (let i = 0; i < maxPolls; i++) {
    if (i > 0) {
      await deps.sleep(POLL_MS);
      if (untilMs !== undefined && deps.now() >= untilMs) break;
    }
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
    opts.beforePaidAsk?.();
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
  lines.push("", ...filmingLines(full.filming, full.version));
  if (full.warnings.length > 0) lines.push("", "What it was not sure about:", ...full.warnings.map((warning) => `  - ${warning}`));
  return lines;
}

const atSec = (sec: number) => `${sec.toFixed(1)} s`;
const fromTo = (from: number | undefined, to: number | undefined) =>
  from !== undefined && to !== undefined ? seconds(from, to) : from !== undefined ? `from ${atSec(from)}` : to !== undefined ? `to ${atSec(to)}` : "";
/** The parts that are there, joined: an absent or empty part is left out. */
const joinParts = (parts: Array<string | false | undefined | null>, by = ", ") => parts.filter((p): p is string => typeof p === "string" && p !== "").join(by);
/** A text on one line: each line break, with the spaces around it, becomes " / ". */
const oneLine = (text: string) => text.trim().replace(/\s*\n\s*/g, " / ");
const productWord = (product: boolean | undefined) => (product === true ? "the product" : product === false ? "not the product" : "");

/**
 * The filming block as plain lines: first one line that says which lines are the video model's reading by eye
 * (`BY_EYE`), then one line a subject, each field only when the breakdown read it: who holds the
 * camera and whether it stands still (and how that was found), its height and tilt, the pose and the moves with
 * their times, what is held and what the hands do, the person, the places, the light, the captions, what is laid
 * over the picture, the pace, the opening and the ending. A breakdown of 1.0 has no block and says so in one line.
 */
export function filmingLines(filming: SwipeFilming | undefined, version?: string): string[] {
  if (!filming || Object.keys(filming).length === 0) {
    return [
      version === "1.0"
        ? "How it is filmed: this breakdown does not say (it is of version 1.0, made before Exodus read how an ad is filmed)."
        : "How it is filmed: nothing was read.",
    ];
  }
  const f = filming;
  const out: string[] = [];
  // Every value on one line: a card's words can hold a line break.
  const line = (label: string, text: string) => {
    if (text !== "") out.push(`  ${label}: ${oneLine(text)}`);
  };
  line("Camera", f.filmedBy ?? "");
  line(
    "Measured",
    f.measuredStillPct !== undefined
      ? `in ${f.measuredStillPct}% of the moments the measure settled in the talking shots, most of the part of the frame it could read stood still and no larger part slid together (this does not prove the phone was put down: a still layer over most of the frame reads the same)`
      : "",
  );
  line("Camera height", f.cameraHeight ?? "");
  line("Camera tilt", f.cameraTilt ?? "");
  line("Camera movement", f.movement ?? "");
  line("Framing", f.framing ?? "");
  line("Pose", joinParts([f.pose, f.body && `body: ${f.body}`], "; "));
  line("Moves", (f.moves ?? []).map((m) => `${m.move} ${m.to !== undefined ? seconds(m.at, m.to) : `at ${atSec(m.at)}`}`).join("; "));
  line(
    "Holds",
    (f.held ?? [])
      .map((h) => `${h.thing} (${joinParts([h.hands && `${h.hands} ${h.hands === "one" ? "hand" : "hands"}`, productWord(h.product), h.wholeAd ? "the whole ad" : fromTo(h.from, h.to)])})`)
      .join("; "),
  );
  line(
    "Hands",
    (f.handActions ?? []).map((a) => `${seconds(a.from, a.to)} ${a.does}${a.things ? `, with ${a.things}` : ""}${a.product === undefined ? "" : ` (${productWord(a.product)})`}`).join("; "),
  );
  const p = f.personLook ?? {};
  line(
    "The person",
    joinParts([
      p.hair &&
        (p.hair === "bald" || p.hair === "shaved"
          ? `${p.hair} head`
          : p.hair === "covered"
            ? (p.hairColour ? `${p.hairColour} hair, covered` : "hair covered")
            : `${joinParts([p.hair, p.hairColour], " ")} hair`),
      p.hair === undefined && p.hairColour && `${p.hairColour} hair`,
      p.skinTone && `${p.skinTone} skin`,
      p.build && `${p.build} build`,
      p.glasses && (p.glasses === "none" ? "no glasses" : p.glasses),
      p.facialHair && (p.facialHair === "none" ? "no facial hair" : p.facialHair),
    ]),
  );
  const placeList = (f.placeList ?? []).map((place) => joinParts([place.setting, place.line], ": ")).join("; ");
  if (placeList) line(`Places${f.places ? ` (${f.places})` : ""}`, placeList);
  else line("Places", f.places ?? "");
  line("Main place", f.placeLine ?? "");
  line("In view", (f.props ?? []).join(", "));
  line("Light", joinParts([f.light, f.lightSource && `from ${f.lightSource}`]));
  const c = f.captions;
  line("Captions", c ? joinParts([c.amount, c.style, c.position, c.caps === undefined ? "" : c.caps ? "in capitals" : "not in capitals"], "; ") : "");
  if ((f.inserts ?? []).length > 0) {
    out.push("  Laid over the picture:");
    for (const i of f.inserts ?? []) {
      const when = i.secondsOn !== undefined ? `${atSec(i.at)} for ${atSec(i.secondsOn)}` : atSec(i.at);
      out.push(`    ${when}  ${joinParts([i.part, i.where, i.widthPct !== undefined && `${i.widthPct}% wide`])}${i.words ? `: ${oneLine(i.words)}` : ""}`);
    }
  }
  const perMinute = f.cutsPerMinute !== undefined ? `${f.cutsPerMinute} a minute` : "";
  line("Cuts", f.cuts ? `${f.cuts}${perMinute ? ` (${perMinute})` : ""}` : perMinute);
  line("B-roll", f.brollShare ?? "");
  line("Words", f.wordsPerSecond !== undefined ? `${f.wordsPerSecond} a second` : "");
  line("First seconds", f.firstSeconds ?? "");
  line("How the hook is built", f.hookBuilt ?? "");
  line("How it ends", f.endCard ?? "");
  return ["How it is filmed:", ...(out.length > 0 ? [BY_EYE, ...out] : ["  Nothing was read."])];
}

/**
 * Which lines of the filming block are the video model's reading by eye: all but the measured one and the two that
 * code counts (src/lib/video-breakdown/schema.ts). Cuts is counted by code, but the count holds the jump cuts the
 * model saw inside a shot (assemble.ts, unlistedCuts), so the line says so. Said once above the block, so a
 * "Camera: selfie" read by eye is not taken for a fact beside the measured line.
 */
const BY_EYE = "  (The video model's reading by eye, not proven: every line but Measured, taken from the frames; Words, counted by code; and Cuts, counted by code with the jump cuts the video model saw.)";

// ── The template ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Two tries of up to 180 s each, and the time to start: ten minutes is past the worst case. */
const TEMPLATE_MAX_POLLS = 120;

/** COP-291: the kinds the server offers next to the match, as far as they read; an entry that doesn't is left out. */
function offeredOf(template: SwipeTemplateView): NonNullable<SwipeTemplateView["offered"]> {
  const list: unknown = template.offered;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is { key: string; label: string; reason: string } =>
      isRecord(entry) && typeof entry.key === "string" && typeof entry.label === "string" && typeof entry.reason === "string",
  );
}

/**
 * COP-291: an offered kind in one line: its name, what it makes in its own words when the server sends them, why it fits
 * their ad, and how the member takes it. Choosing it is the member's.
 */
function offeredLine(kind: NonNullable<SwipeTemplateView["offered"]>[number], how: string): string {
  const about = typeof kind.about === "string" && kind.about.trim() !== "" ? ` ${kind.about.trim()}` : "";
  return `Also fits their ad: ${kind.label} (${kind.key}).${about} ${kind.reason} If the member wants it, ${how}.`;
}

/**
 * COP-291: a sheet run's lines for the kinds offered next to the match, each with the sheet's way to name it. Said only
 * for a sheet of one ad that names no kind: a sheet's kind is the kind of every ad in it, and its next run writes again,
 * which is paid. They change nothing this run writes.
 */
function sheetOfferedLines(template: SwipeTemplateView, sheet: Pick<SwipeSheet, "kind" | "sources">): string[] {
  if (sheet.kind !== null || sheet.sources.length !== 1) return [];
  return offeredOf(template).map((offered) => `  ${offeredLine(offered, `set "kind": "${offered.key}" in the sheet before its next run`)}`);
}

function templateLines(template: SwipeTemplateView): string[] {
  return [
    `Kind of ad: ${template.kind.label} (${template.kind.key})`,
    `  ${template.kind.why}`,
    ...offeredOf(template).map((kind) => offeredLine(kind, `add --kind ${kind.key} to the write`)),
    `Look: ${template.look.label} (${template.look.slug})`,
    `  ${template.look.why}`,
    `Their ad: ${template.lines} lines, about ${Math.round(template.seconds)} s.`,
  ];
}

function nextAfterTemplate(breakdownId: string): string[] {
  return [
    // COP-291: --kind writes another kind this ad can be made as, offered or not, so the line says so every time.
    "The swipe writes the kind of ad it was matched to, or the one --kind names, and no other. If the member wants another kind, say so before writing.",
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
  opts.onJob?.(job);
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
  const products = productsOf(res.data);
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

// ── Finding ads to swipe ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * How many ads one find reads: the route's most. The route fills a window of up to this many rows, shared fairly
 * across the competitors (each one's newest first, convex/swipeAds.ts collectBoundedFairShare), then sorts the
 * window newest collected first. Fewer rows than this means the window held the whole library.
 */
export const FIND_READ = 200;
const FIND_MAX = FIND_READ;
const FIND_DEFAULT_LIMIT = 30;
const FIRST_LINE_MAX = 60;
/** Flags that would buy, wait on or name an ad: find refuses them. */
export const FIND_PAID_FLAGS = ["yes", "wait", "file", "url", "ad", "again"] as const;
/** The other swipe verbs' flags: find refuses them too, so no choice is dropped without a word. */
export const FIND_OTHER_FLAGS = [
  "one-shot",
  "music",
  "mode",
  "closeness",
  "product",
  "look",
  "script",
  "style",
  "title",
  "sheet",
  "full",
  "status",
  "persona",
  "retry-refused",
  "kind",
  "max-usd",
] as const;
const TEXT_MAX = 400;

export const FIND_KIND_LINE = "The kind of an ad is known only after it is read.";
export const FIND_EMPTY_LIBRARY = "The swipe library has no ads yet for this brand.";

export interface FindAsk {
  /** A case-blind piece of the advertiser's name, or null for every advertiser. */
  brand: string | null;
  /** Rows shown, 1 to 200. The counts are of every match, not of the rows shown. */
  limit: number;
}

/** One row of GET /api/v2/swipe-library (MIRROR of convex/swipeAds.ts toSwipeRow). */
export interface SwipeLibraryRow {
  _id: string;
  brandName?: string;
  format?: string;
  transcript?: string;
  bodyText?: string;
  headline?: string;
  ctaText?: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface SwipeCandidate {
  n: number;
  id: string;
  advertiser: string | null;
  /** The transcript's start, else the headline's, else the body's, on one line. */
  firstLine: string | null;
  /** Where firstLine came from: the spoken words, or the post's own text (headline or body), which is not spoken. */
  firstLineFrom: "transcript" | "post text" | null;
  /** The transcript's word count; null when there is no transcript yet. */
  words: number | null;
  /** The transcript's first 400 characters; null when there is no transcript yet. */
  text: string | null;
}

export interface SwipeCandidates {
  /** Ads the server sent: the window. */
  read: number;
  /** True when the window held every ad in the library (fewer rows than FIND_READ came back). */
  wholeLibrary: boolean;
  /** Video ads with a file, after --brand. */
  videos: number;
  /** Advertisers among those videos. */
  competitors: number;
  /** The first --limit of those videos, in the server's order (newest collected first). */
  candidates: SwipeCandidate[];
  /** Video ads with a file before --brand, and their advertisers in the order first seen. */
  allVideos: number;
  advertisers: string[];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The library's rows as options to swipe: only video ads with a file, in the server's order, so the list ranks by
 * nothing the answer does not hold. --brand keeps one advertiser's ads and narrows the counts; --limit caps the
 * rows only.
 */
export function swipeCandidatesOf(rows: unknown[], ask: FindAsk): SwipeCandidates {
  const videos = rows.filter(
    (row): row is SwipeLibraryRow => isRecord(row) && typeof row._id === "string" && row.format === "video" && textOf(row.videoUrl) !== "",
  );
  const advertisers: string[] = [];
  for (const row of videos) {
    const name = textOf(row.brandName);
    if (name && !advertisers.some((seen) => seen.toLowerCase() === name.toLowerCase())) advertisers.push(name);
  }
  const wanted = ask.brand?.toLowerCase() ?? null;
  const matched = wanted === null ? videos : videos.filter((row) => textOf(row.brandName).toLowerCase().includes(wanted));
  const competitors = new Set(matched.map((row) => textOf(row.brandName).toLowerCase()).filter(Boolean)).size;
  const candidates = matched.slice(0, ask.limit).map((row, i): SwipeCandidate => {
    const transcript = textOf(row.transcript);
    const first = transcript || textOf(row.headline) || textOf(row.bodyText);
    return {
      n: i + 1,
      id: row._id,
      advertiser: textOf(row.brandName) || null,
      firstLine: first ? cut(first, FIRST_LINE_MAX) : null,
      firstLineFrom: transcript ? "transcript" : first ? "post text" : null,
      words: transcript ? transcript.split(" ").length : null,
      text: transcript ? transcript.slice(0, TEXT_MAX) : null,
    };
  });
  return { read: rows.length, wholeLibrary: rows.length < FIND_READ, videos: matched.length, competitors, candidates, allVideos: videos.length, advertisers };
}

/** What the counts are of: the whole library, or the window the route read. */
function windowWords(found: SwipeCandidates): string {
  if (!found.wholeLibrary) {
    // A full window may hold the whole library or part of it: the route does not say which.
    return `the ${found.read} ads looked through in the swipe library (shared across competitors; the library may hold more)`;
  }
  return found.read === 1 ? "the only ad in the swipe library" : `all ${found.read} ads in the swipe library`;
}

/** Why a find has nothing to offer, or null when it has. */
function findEmptyLine(found: SwipeCandidates, ask: FindAsk): string | null {
  if (found.read === 0) return FIND_EMPTY_LIBRARY;
  if (found.allVideos === 0) {
    return found.read === 1
      ? "The only ad in the swipe library is not a video with a file."
      : `None of ${windowWords(found)} is a video with a file.`;
  }
  if (found.videos === 0) {
    const where = found.wholeLibrary ? "in the swipe library" : "looked through in the swipe library";
    return `None of the ${plural(found.allVideos, "video ad", "video ads")} ${where} is from "${ask.brand}". They are from: ${found.advertisers.join(", ")}.`;
  }
  return null;
}

/**
 * `exodus video swipe find`: video ads in the brand's swipe library to offer as options, from one free read. It
 * buys nothing and asks no yes. The answer holds no results and no kind, so it neither ranks by them nor says them.
 */
export async function swipeFindFlow(ask: FindAsk, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult> {
  const { json } = opts;
  const res = await deps.get(`${SWIPE_LIBRARY_PATH}?limit=${FIND_READ}`);
  if (!res.ok) {
    // This route is not behind the Video switch, so the swipe 404 sentence would send the member the wrong way.
    const error = formatApiError(res);
    return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error })] : [error] };
  }
  const rows = isRecord(res.data) && Array.isArray(res.data.swipes) ? (res.data.swipes as unknown[]) : null;
  if (!rows) return failed("The server's answer about the swipe library could not be read.", json);
  const found = swipeCandidatesOf(rows, ask);
  const empty = findEmptyLine(found, ask);
  const { read, wholeLibrary, videos, competitors, candidates } = found;
  if (json) {
    return {
      code: 0,
      lines: [
        JSON.stringify({ ok: true, read, wholeLibrary, videos, competitors, shown: candidates.length, candidates, ...(empty ? { empty } : {}) }),
      ],
    };
  }
  if (empty) return { code: 0, lines: [empty] };
  const width = Math.max(...candidates.map((c) => c.id.length));
  return {
    code: 0,
    lines: [
      `${plural(videos, "video ad", "video ads")}${ask.brand ? ` matching "${ask.brand}"` : ""}, from ${plural(competitors, "competitor", "competitors")}, newest collected first.`,
      `The counts are of ${windowWords(found)}.`,
      ...candidates.map((c) => {
        const said = c.firstLine ? `${c.firstLineFrom === "post text" ? "post text " : ""}"${c.firstLine}"` : "";
        const tail = c.words === null ? "no transcript yet" : plural(c.words, "word", "words");
        return `${String(c.n).padStart(4)}  ${c.id.padEnd(width)}  ${c.advertiser ?? "(advertiser unknown)"}: ${said ? `${said}  ${tail}` : tail}`;
      }),
      ...(candidates.length < videos ? [`Showing the first ${candidates.length}; --limit <n> shows up to ${FIND_MAX}.`] : []),
      "Read one (paid, on the team's keys; ask first): exodus video swipe --ad <id> --yes --wait",
      "An ad read before costs nothing to read again, unless that read failed: then reading it again is paid.",
      `${FIND_KIND_LINE} This list holds no results, so it does not rank by them.`,
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
  if (ask.kind) lines.push(kindLine(ask.kind));
  return lines;
}

const kindLine = (kind: string) => `Kind of ad: ${kind}, in place of the one the template picked.`;

/**
 * Why a swipe asked for `asked` was not written for it, or null when it was: its row keeps the kind it was asked
 * for, and a written draft is of that kind. A server without COP-255 drops the kind and writes the template's pick.
 */
function kindDropped(swipe: SwipeView, asked: string | undefined): string | null {
  if (asked === undefined) return null;
  const written = swipe.outcome.kind === "written" ? swipe.outcome.draft.conceit : null;
  if (swipe.kind === asked && (written === null || written === asked)) return null;
  const how = written === asked ? `as ${asked}, but it did not keep the kind` : `${written ? `as ${written}` : "for the template's kind"}, not ${asked}`;
  return `This server does not take a kind yet: swipe ${swipe._id} was written ${how}. Nothing was started.`;
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
    swipe.workflowRunId && swipe.runHoldsStart === false
      ? `It started run ${swipe.workflowRunId}, which failed or was cancelled: exodus video status ${swipe.workflowRunId}. Starting the swipe again is paid (ask first): exodus video swipe start ${swipe._id} --yes`
      : swipe.workflowRunId
        ? `It started run ${swipe.workflowRunId}: exodus video status ${swipe.workflowRunId}. A second video from this swipe is paid on its own and needs --again (ask first): exodus video swipe start ${swipe._id} --again --yes`
        : `Start the video (paid; ask first): exodus video swipe start ${swipe._id} --yes`,
  ];
}

/** `exodus video swipe write <breakdownId> --product <id>`: the brand's version, written on the member's key. */
export async function swipeWriteFlow(breakdownId: string, ask: WriteAsk, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult> {
  const { json } = opts;
  let memberScript: string | undefined = ask.scriptText;
  if (memberScript === undefined && ask.scriptFile !== undefined) {
    try {
      memberScript = deps.readFile(ask.scriptFile);
    } catch {
      return failed(`Can't read --script ${ask.scriptFile}. Check the path.`, json);
    }
  }
  if (memberScript !== undefined && !memberScript.trim()) return failed(`--script ${ask.scriptFile} is empty.`, json);
  if (!opts.yes) return writeNeedsYes(breakdownId, ask, json, deps);
  const res = await deps.post(SWIPES_PATH, {
    breakdownId,
    productId: ask.productId,
    request: requestOf(ask, memberScript),
    ...(ask.kind ? { kind: ask.kind } : {}),
    // COP-289: the people's most the dry print showed; the server makes them only with it, and never for more.
    ...(ask.peopleMaxUsd !== undefined ? { peopleMostUsd: ask.peopleMaxUsd } : {}),
  });
  if (!res.ok) return swipeError(res, json);
  const job = isRecord(res.data) ? res.data.job : undefined;
  if (typeof job !== "string") return failed("The server did not say which write it started.", json);
  opts.onJob?.(job);
  const out = progress(opts);
  out.say("Writing the brand's version on the member's key. It takes four to nine minutes.");
  if (ask.peopleMaxUsd !== undefined) {
    out.say(
      `Once the script is stored, the people to pick from are made, or taken from an earlier write of this ad with at most one check of their pictures paid; at most ${usd(ask.peopleMaxUsd)} on the member's keys.`,
    );
  }
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
  const dropped = kindDropped(swipe, ask.kind);
  if (dropped) return failed(dropped, json, { kindDropped: true, swipeId: swipe._id });
  const written = swipe.outcome.kind === "written";
  // COP-289: a write that carried the people's most waits for them (a few minutes at most) and shows them. A plain
  // --yes write never ends in silence: when its kind makes people, it says none were made and where their price is.
  const people =
    ask.peopleMaxUsd !== undefined
      ? written
        ? await peopleAfterWrite(swipe._id, ask.peopleMaxUsd, out, deps)
        : NONE_WITH_REFUSAL
      : written && !ask.noPeople
        ? await peopleNotAsked(breakdownId, swipe, deps)
        : null;
  if (json) {
    const answer = written ? { ok: true, swipe, ...(people ? { people: people.json } : {}) } : { ok: false, refused: true, swipe };
    return { code: written ? 0 : 1, lines: [JSON.stringify(answer)] };
  }
  const lines = swipeLines(swipe, "write");
  // The people go before the start's line, the last one; after a refusal, at the end.
  const withPeople = !people ? lines : written ? [...lines.slice(0, -1), ...people.lines, "", ...lines.slice(-1)] : [...lines, ...people.lines];
  return { code: written ? 0 : 1, lines: [...out.kept, ...withPeople] };
}

// ── The people a write makes (COP-289) ───────────────────────────────────────────────────────────────────────────────

/** The free read before the write: the people it also makes and their price, or null (none, an older server, no answer). */
async function writePeopleOf(breakdownId: string, kind: string | undefined, deps: VideoDeps): Promise<Extract<WritePeople, { makesPeople: true }> | null> {
  try {
    const res = await deps.get(`${SWIPE_WRITE_PEOPLE_PATH}?${writePeopleQuery(breakdownId, kind)}`);
    const people = res.ok && isRecord(res.data) && isRecord(res.data.people) ? res.data.people : null;
    if (!people || people.makesPeople !== true || typeof people.mostUsd !== "number" || !Array.isArray(people.lines)) return null;
    return people as unknown as Extract<WritePeople, { makesPeople: true }>;
  } catch {
    return null;
  }
}

/**
 * The write's paid-step text, and, when the write also makes people (the free read says so), what they are, their
 * price, and the yes line that carries their most (--people-max-usd), so the press is a yes to that figure. With
 * --no-people, on an older server, or for a kind or a member that makes none, the text is the write's as before.
 */
async function writeNeedsYes(breakdownId: string, ask: WriteAsk, json: boolean, deps: VideoDeps): Promise<FlowResult> {
  const plain = needsYesResult("write", json, choiceLines(ask));
  const people = ask.noPeople ? null : await writePeopleOf(breakdownId, ask.kind, deps);
  if (!people) return plain;
  const yes = `--yes --people-max-usd ${mostShown(people.mostUsd)}`;
  if (json) return { code: 0, lines: [JSON.stringify({ ...(JSON.parse(plain.lines[0]) as Record<string, unknown>), people: { ...people, yes } })] };
  return {
    code: 0,
    lines: [
      // Each part says what is true of it (COP-289 review): the write's own text calls have no figure; the people do.
      ...plain.lines.slice(0, -1).map((line) => (line === NO_PRICE ? WRITE_NO_PRICE_PEOPLE_PRICED : line)),
      ...people.lines,
      `Ask the member. On their yes, run the same command with ${yes}: people are made only with that figure, and never cost more. --yes alone, or --no-people, writes without them.`,
    ],
  };
}

/** The write's price line when the people's price is printed with it: no figure for the write's own text calls. */
const WRITE_NO_PRICE_PEOPLE_PRICED =
  "The CLI prints no price for the script's own write: its text calls on the member's key have no figure before they run. The people's price is below.";

/** How long a write waits for the people it started, and a start for people being made: a few minutes. */
const PEOPLE_MADE_WAIT_POLLS = (5 * 60_000) / POLL_MS;

/**
 * COP-289 review: after a plain --yes write (no figure, no --no-people), the same free read as the dry print's, for the
 * kind written. When that kind makes people, one line says none were made and where their price is; when the read
 * fails, that their price could not be read. An older server, or a kind or a member with no people: nothing (null).
 */
async function peopleNotAsked(breakdownId: string, swipe: SwipeView, deps: VideoDeps): Promise<{ lines: string[]; json: Record<string, unknown> } | null> {
  const kind = swipe.outcome.kind === "written" ? swipe.outcome.draft.conceit : swipe.kind;
  const priceLine = `exodus video swipe sheet people ${swipe._id}`;
  let res: ApiResponse<unknown>;
  try {
    res = await deps.get(`${SWIPE_WRITE_PEOPLE_PATH}?${writePeopleQuery(breakdownId, kind)}`);
  } catch {
    res = { ok: false, status: 0, data: null };
  }
  if (!res.ok && (res.status === 0 || res.status >= 500 || res.status === 429)) {
    // A plain --yes write never makes people: only whether this kind makes them is unknown.
    return {
      lines: [
        `No people to pick from were made with this write: its yes carried no --people-max-usd. Whether this kind of ad makes them could not be read. See their price (free): ${priceLine}`,
      ],
      json: { state: "unknown" },
    };
  }
  const people = res.ok && isRecord(res.data) && isRecord(res.data.people) ? res.data.people : null;
  if (people?.makesPeople !== true) return null;
  return {
    lines: [`No people to pick from were made with this write: its yes carried no --people-max-usd. See their price (free): ${priceLine}`],
    json: { state: "not-asked" },
  };
}

/** The free read's query: the ad, and the kind when one is named. */
const writePeopleQuery = (breakdownId: string, kind: string | undefined) =>
  `breakdownId=${encodeURIComponent(breakdownId)}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`;

/** What a write says of its people after a refusal: none were made. */
const NONE_WITH_REFUSAL = { lines: ["No people were made, and nothing was paid for them."], json: { state: "none" } };

/** The sheet's read as the people's waits make it: with the word recommended, so a recommended person reads as one. */
const peopleSheetPath = (swipeId: string) => `${SWIPE_SHEET_PATH}?id=${encodeURIComponent(swipeId)}&${SHEET_SOURCES_QUERY}`;

/**
 * Reads the swipe's sheet until its person row says no people are being made (or `waitFor` says not to wait), at most
 * `polls` times; `onWait` is told once, the first time it waits. Null when the sheet cannot be read.
 */
async function untilPeopleMade(
  swipeId: string,
  deps: VideoDeps,
  waitFor: (row: SavedSheetRow) => boolean,
  onWait: (row: SavedSheetRow) => void,
  polls = PEOPLE_MADE_WAIT_POLLS,
  /** The clock time the wait ends at (landing review: counted by the clock, not by reads). */
  untilMs = deps.now() + polls * POLL_MS,
): Promise<
  | { done: { sheet: SavedSheet; who: SavedSheetRow | undefined; waited: boolean } | null }
  | { lost: true; last?: SavedSheetRow }
  | { timedOut: true; last?: SavedSheetRow }
> {
  let waited = false;
  // The person row of the last sheet read, for what is said when the wait ends without the people (COP-289 review).
  let last: SavedSheetRow | undefined;
  const ended = await poll(
    () => deps.get(peopleSheetPath(swipeId)),
    (read) => {
      const sheet = read.ok ? sheetOf(read.data) : null;
      if (!sheet) return { done: null };
      const who = rowOfSheet(sheet.sheet, "who");
      last = who ?? last;
      if (who?.optionsStatus?.making === true && waitFor(who)) {
        if (!waited) onWait(who);
        waited = true;
        return null;
      }
      return { done: { sheet: sheet.sheet, who, waited } };
    },
    polls,
    deps,
    untilMs,
  );
  return "done" in ended ? ended : { ...ended, ...(last ? { last } : {}) };
}

/**
 * COP-289 review: what a start with no pick films, said from the person row as the server shows it, once people were
 * made: the recommended person by number; else a new person cast from the row's words, not one of the people made, and
 * how to pick one. Null when the row has no people to pick from.
 */
function startFilmsLine(who: SavedSheetRow | undefined, swipeId: string): string | null {
  if (!who || !who.options || who.options.length === 0) return null;
  const films = startFilmsOf(who);
  if (films === "picked") return `The start films person ${who.value}, your pick.`;
  if (films === "recommended") return `A start with no pick films person ${who.value}, the recommended one.`;
  // The member's own words are their pick: the start films them, with or without a number picked.
  const lead = films === "new-from-your-words" ? "The start films" : "A start with no pick films";
  return `${lead} ${castFrom(who)}, not one of these. To film one of them (free): exodus video swipe sheet set ${swipeId} who=<n>`;
}

/** What a start films, as a closed word for --json: the person picked or recommended, or a new person cast from words. */
type StartFilms = "picked" | "recommended" | "new-from-your-words" | "new-from-type" | "new-from-script";

function startFilmsOf(who: SavedSheetRow): StartFilms {
  if (typeof who.value === "number") return who.from === "you" ? "picked" : "recommended";
  if (typeof who.value === "string") return who.from === "you" ? "new-from-your-words" : "new-from-type";
  return "new-from-script";
}

/** The --json facts of a person row with people to pick from: the recommended option's id, and what a start films. */
function startFilmsJson(who: SavedSheetRow | undefined): { recommended: string | null; films: StartFilms } | null {
  return who?.options && who.options.length > 0 ? { recommended: who.recommended ?? null, films: startFilmsOf(who) } : null;
}

/** The person a start casts when the row holds words, not a person made: from whose words. */
function castFrom(who: SavedSheetRow): string {
  if (typeof who.value !== "string") return "a new person cast from the script's own words about its speaker";
  return who.from === "you" ? "a new person cast from your words on the person row" : "a new person cast from their speaker's type";
}

/**
 * After a write that carried the people's most: waits a few minutes at most while they are made, then shows where they
 * stand in the server's words (the ask's end names the person a check of the faces recommends, and why), each person
 * with their picture's address, and what to run next. A write never fails for its people.
 */
async function peopleAfterWrite(
  swipeId: string,
  mostUsd: number,
  out: { say: (line: string) => void },
  deps: VideoDeps,
): Promise<{ lines: string[]; json: Record<string, unknown> }> {
  const look = `See them: exodus video swipe sheet ${swipeId}`;
  const askLine = `Ask for them (the price first, free): exodus video swipe sheet people ${swipeId}`;
  const ended = await untilPeopleMade(swipeId, deps, () => true, (who) =>
    out.say(`${who.optionsStatus?.sentence ?? "Making the people."} Waiting for them, up to 5 minutes.`),
  );
  if ("timedOut" in ended) {
    // COP-289 review: what the server last said is going on (people made, or the taken people's pictures checked).
    const said = ended.last?.optionsStatus?.sentence?.trim();
    return { lines: [said ? `Still not done after 5 minutes: ${said} ${look}` : `The people are still being made. ${look}`], json: { mostUsd, state: "making" } };
  }
  if ("lost" in ended || ended.done === null) {
    return { lines: [`Where the people stand could not be read. ${look}`], json: { mostUsd, state: "unknown" } };
  }
  const status = ended.done.who?.optionsStatus;
  const people = peopleLines(ended.done.sheet);
  const json = { mostUsd, status: status ?? null, people: ended.done.who?.options ?? [] };
  if (!status || status.noneYet) {
    return { lines: ["No people were made with this write, and nothing was paid for them.", askLine], json: { ...json, state: "none" } };
  }
  if (people.length === 0) return { lines: [status.sentence, askLine], json: { ...json, state: "failed" } };
  // COP-289 review: people on the sheet are listed whatever the status says (taken people whose check failed are there).
  const films = startFilmsLine(ended.done.who, swipeId);
  const pick = typeof ended.done.who?.value === "number" ? [`Pick another (free): exodus video swipe sheet set ${swipeId} who=<n>`] : [];
  return {
    lines: [status.sentence, "People to pick from:", ...people, ...(films ? [films] : []), ...pick],
    json: { ...json, state: status.failed ? "failed" : "made", ...(startFilmsJson(ended.done.who) ?? {}) },
  };
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

/** When a swipe was written, in UTC to the minute: two writes of one ad are told apart by it. */
const writtenAt = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** `exodus video swipe list`: the brand's newest swipes, newest first, each with when it was written and its product; a refusal marked with what it cost. */
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
        ...(typeof row.createdAt === "number" ? [`written ${writtenAt(row.createdAt)}`] : []),
        `${mode.label}${step ? `, ${step.step} ${step.name}` : ""}`,
        ad,
        ...(row.product !== undefined ? [row.product ? `for ${row.product.name}` : "for a product since deleted"] : []),
        ...(row.workflowRunId ? [`run ${row.workflowRunId}`] : []),
        ...(row.outcome?.kind === "refused"
          ? [`refused, ${typeof row.costUsd === "number" ? `cost ${usd(row.costUsd)}` : "cost unknown"}, nothing started`]
          : []),
      ].join("  ");
    }),
  };
}

// ── The saved sheet (COP-265) ─────────────────────────────────────────────────────────────────────────────────────

const FROM_WORDS: Record<SheetFrom, string> = { you: "from you", "their-ad": "from their ad", kind: "from the kind of ad", recommended: "recommended" };

function sheetOf(data: unknown): { sheet: SavedSheet; dashboardUrl: string } | null {
  if (!isRecord(data) || !isRecord(data.sheet) || !Array.isArray(data.sheet.sections)) return null;
  return { sheet: data.sheet as unknown as SavedSheet, dashboardUrl: typeof data.dashboardUrl === "string" ? data.dashboardUrl : "" };
}

/**
 * A row's options as the member reads them. A person made for them is shown with their picture's address, a voice
 * with its sample's address, one a line; plain options on one line. COP-265 part 7: and where the ask for them stands.
 * A sheet read prints the rows alone: the offers to make people or list voices are said only when the member asks.
 */
function optionLines(row: SavedSheetRow, above: SavedSheetRow | undefined, swipeId: string): string[] {
  const lines: string[] = [];
  if (row.options === null) return lines;
  const options = row.options;
  const addressed = options.some((option) => option.pictureUrl || option.sampleUrl);
  if (addressed) {
    // People and voices made on the member's ask (COP-265 part 7): one a line, with the address to look at or hear.
    for (const option of options) {
      const address = option.pictureUrl ? `picture: ${option.pictureUrl}` : option.sampleUrl ? `sample: ${option.sampleUrl}` : "";
      lines.push(`    ${option.id}: ${option.label}${address ? `  ${address}` : ""}`);
    }
  } else if (options.length > 0 || !row.optionsStatus) {
    const cost = row.optionsCostUsd ? ` (showing them costs ${usd(row.optionsCostUsd)})` : "";
    // A row whose options follow the row above it (a place's looks) has none until that row has a value. A row whose
    // options are made on an ask says where the ask stands instead (below).
    const none = above ? `none until ${above.label.toLowerCase().replace(/^the /, "a ")} is set` : "none";
    const shown = options.length > 0 ? options.map((option) => `${option.id} (${option.label})`).join(", ") : none;
    lines.push(`    options${cost}: ${shown}`);
  }
  if (row.optionsStatus?.sentence) lines.push(`    ${row.optionsStatus.sentence}`);
  // Before the first ask for people, the free way to the price (COP-265 part 7); no cost is printed before it is said.
  // COP-289 review: also when no one was made (a write's people that could not be made) and an ask is left.
  const noneMade = row.optionsStatus && !row.optionsStatus.making && options.length === 0 && (row.optionsStatus.asksLeft ?? 0) > 0;
  if (row.id === "who" && (row.optionsStatus?.noneYet || noneMade)) lines.push(`    See the price (free): exodus video swipe sheet people ${swipeId}`);
  // COP-285: a voice row with no voice (none picked, none recommended) says how to list the voices for the person.
  if (row.id === "voice" && row.value === null) lines.push(`    List the voices: exodus video swipe sheet voices ${swipeId}`);
  return lines;
}

/** A swipe's sheet as the member reads it: each section and row, where its value comes from and why, and what reads it. */
export function sheetLines(sheet: SavedSheet, dashboardUrl: string): string[] {
  const { swipeId } = sheet;
  const page = dashboardUrl ? [`The swipe on the dashboard: ${dashboardUrl}`] : [];
  if (sheet.sections.length === 0) {
    // A member the kind's switch keeps out is told why, in the start's words; only a kind with none "has no sheet".
    const none =
      sheet.startRefusal ??
      (sheet.kind
        ? `${sheet.kind.label} (${sheet.kind.key}) has no sheet: swipe ${swipeId} has nothing to set.`
        : `Swipe ${swipeId} has no sheet: nothing to set.`);
    return [none, ...(sheet.run ? [`Its video: run ${sheet.run.id}.`] : []), ...page];
  }
  const rows = sheet.sections.flatMap((section) => section.rows);
  const lines = [`The sheet of swipe ${swipeId}${sheet.kind ? `, ${sheet.kind.label} (${sheet.kind.key})` : ""}:`];
  for (const section of sheet.sections) {
    lines.push("", section.label);
    for (const row of section.rows) {
      // A pick by number (a person or a voice made for the member) is shown with the name of what it picks.
      const picked = typeof row.value === "number" ? row.options?.find((option) => option.id === String(row.value)) : undefined;
      // A row set to its none (U6) is shown with the server's words for it.
      const none = row.none && row.value === row.none.value ? row.none : undefined;
      const value = row.value === null ? "not set" : picked ? `${row.value} (${picked.label})` : none ? `${row.value} (${none.label})` : String(row.value);
      lines.push(`  ${row.id}${row.readOnly ? ", read only" : ""}: ${value}`);
      // A source this CLI has no word for is left unsaid: the row prints with its reason alone, never "undefined".
      const fromWords = row.from && Object.prototype.hasOwnProperty.call(FROM_WORDS, row.from) ? FROM_WORDS[row.from] : null;
      if (fromWords) lines.push(`    ${fromWords}${row.why ? `: ${row.why}` : ""}`);
      else if (row.why) lines.push(`    ${row.why}`);
      lines.push(...optionLines(row, section.rows[section.rows.indexOf(row) - 1], swipeId));
      lines.push(`    ${row.usedBy ? `read by: ${row.usedBy}` : "no step reads it yet"}`);
    }
  }
  const settable = rows.filter((row) => !row.readOnly).map((row) => row.id);
  lines.push("");
  if (settable.length > 0) {
    lines.push(`Change a row (free): exodus video swipe sheet set ${swipeId} <row>=<value>, or <row>= to clear it. Rows you can set: ${settable.join(", ")}.`);
  }
  lines.push(
    ...page,
    sheet.run
      ? `Its video, run ${sheet.run.id}, keeps the sheet as it was at its start. A change now is for the next video.`
      : "Starting the video copies this sheet into it; a change after the start is for the next video.",
  );
  return lines;
}

/** `exodus video swipe sheet <swipeId>`: the swipe's saved sheet, saved on the server. Free. */
export async function swipeSheetReadFlow(swipeId: string, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult> {
  const res = await deps.get(`${SWIPE_SHEET_PATH}?id=${encodeURIComponent(swipeId)}&${SHEET_SOURCES_QUERY}`);
  if (!res.ok) return swipeError(res, opts.json);
  const read = sheetOf(res.data);
  if (!read) return failed("The server's answer about this sheet could not be read.", opts.json);
  if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, ...read })] };
  return { code: 0, lines: sheetLines(read.sheet, read.dashboardUrl) };
}

/** `exodus video swipe sheet set <swipeId> <row>=<value> ...`: sets rows of the saved sheet, all or none. Free. */
export async function swipeSheetSetFlow(
  swipeId: string,
  picks: Record<string, string | null>,
  opts: SwipeOpts,
  deps: VideoDeps,
): Promise<FlowResult> {
  // Whether the set landed is known only when the server answered it: a refusal (4xx) saved nothing; a lost
  // connection or a server error (5xx) may have saved it or not, so the sheet is read again to know.
  const readAgain = `Whether it was saved is not known. Read the sheet again: exodus video swipe sheet ${swipeId}`;
  let res: ApiResponse<unknown>;
  try {
    res = await deps.post(`${SWIPE_SHEET_PATH}?${SHEET_SOURCES_QUERY}`, { swipeId, picks });
  } catch (err) {
    const error = `The server could not be reached: ${describeFetchFailure(err)}.`;
    return { code: 1, lines: opts.json ? [JSON.stringify({ ok: false, error, saved: "unknown" })] : [error, readAgain] };
  }
  if (!res.ok) {
    if (res.status === 404) return swipeError(res, opts.json);
    const error = swipeErrorLine(res);
    const refused = res.status >= 400 && res.status < 500;
    if (opts.json) return { code: 1, lines: [JSON.stringify({ ok: false, status: res.status, error, saved: refused ? false : "unknown" })] };
    if (refused && /Nothing was (set|saved)\.$/.test(error)) return { code: 1, lines: [error] };
    return { code: 1, lines: [error, refused ? "Nothing was saved." : readAgain] };
  }
  const read = sheetOf(res.data);
  if (!read) return failed("The sheet was saved, but the server's answer could not be read: exodus video swipe sheet " + swipeId, opts.json);
  if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, saved: true, ...read })] };
  const set = Object.keys(picks).filter((row) => picks[row] !== null);
  const cleared = Object.keys(picks).filter((row) => picks[row] === null);
  // A cleared row that is back to a default and has a none (U6: the prop) says so, and names the way to none.
  const rowsNow = read.sheet.sections.flatMap((section) => section.rows);
  const backToDefault = (id: string) => {
    const row = rowsNow.find((candidate) => candidate.id === id);
    return row?.none && row.value !== null && row.from !== "you" ? row : undefined;
  };
  const plainCleared = cleared.filter((id) => !backToDefault(id));
  const said = [
    ...(set.length > 0 ? [`Saved ${set.join(", ")}.`] : []),
    ...(plainCleared.length > 0 ? [`Cleared ${plainCleared.join(", ")}.`] : []),
    ...cleared.flatMap((id) => {
      const row = backToDefault(id);
      return row?.none ? [`Cleared ${id}, so it is back to its default, ${String(row.value)}; for ${row.none.label}, set ${id}=${row.none.value}.`] : [];
    }),
  ];
  if (read.sheet.notice) said.push(read.sheet.notice);
  return { code: 0, lines: [said.join(" "), "", ...sheetLines(read.sheet, read.dashboardUrl)] };
}

// ── The price before the yes (COP-265 part 6) ───────────────────────────────────────────────────────────────────

function priceOf(data: unknown): { price: SwipePrice; dashboardUrl: string } | null {
  if (!isRecord(data) || !isRecord(data.price) || typeof data.price.priced !== "boolean") return null;
  const price = data.price as unknown as SwipePrice;
  if (price.priced && (!isRecord(price.picked) || !Array.isArray(price.options))) return null;
  return { price, dashboardUrl: typeof data.dashboardUrl === "string" ? data.dashboardUrl : "" };
}

type PricedSwipe = Extract<SwipePrice, { priced: true }>;

/** A line's dollars: whole cents as cents, a half cent kept (Kie bills a credit as half a cent). */
const lineUsd = (value: number) => (Math.abs(value * 100 - Math.round(value * 100)) < 1e-6 ? usd(value) : `$${value.toFixed(3)}`);

/** What one combination films, in the member's words. */
function filmWords(row: { size: string; takes: "all" | "first" }, scriptTakes: number): string {
  if (row.takes === "first" && scriptTakes > 1) return `${row.size}, the first take only`;
  return `${row.size}, ${scriptTakes === 1 ? "its one take" : `all ${scriptTakes} takes`}`;
}

/** One combination's price, or why it has none, and the start's refusal of it. */
function priceWords(row: SwipePriceRow): string {
  if ("why" in row) return `no price: ${row.why}`;
  return `about ${usd(row.costUsd)}, at most ${usd(row.maxUsd)}${row.startRefusal ? `. The start refuses it: ${row.startRefusal}` : ""}`;
}

/** The options worth a line: a script of one take has no first take apart from the whole, so that row is left out. */
function distinctOptions(price: PricedSwipe): SwipePriceRow[] {
  return price.scriptTakes > 1 ? price.options : price.options.filter((row) => row.takes === "all");
}

/** Whether an option the start would take costs less than the sheet's rows. */
function cheaperOption(price: PricedSwipe): boolean {
  return price.options.some((row) => !("why" in row) && !row.startRefusal && row.costUsd < price.picked.costUsd);
}

/** The price at the sheet's rows, as the start's paid-step text and `sheet price` both say it. */
function pickedPriceLine(price: PricedSwipe): string {
  return `about ${usd(price.picked.costUsd)}, at most ${usd(price.picked.maxUsd)} (${filmWords(price.picked, price.scriptTakes)}, as the swipe's sheet stands)`;
}

/** How to change the size and the takes, named from the answer's own options. */
function changeLine(price: PricedSwipe): string {
  if (!price.sizeChoices) return "This server offers the kind's own size and every take for now: 480p and the first take only are not switched on.";
  const rows = distinctOptions(price);
  const sizes = [...new Set(rows.map((row) => row.size))];
  const takes = [...new Set(rows.map((row) => row.takes))];
  const parts = [`size=<${sizes.join(" or ")}>`, ...(takes.length > 1 ? [`takes=<${takes.join(" or ")}>`] : [])];
  return `Change it (free): exodus video swipe sheet set ${price.swipeId} ${parts.join(" ")}. The start films what the sheet says then.`;
}

/**
 * What "at most" means, said once. The worker's limits count per storyboard (scout ugc-one-take-steps.ts): a change
 * asked for after the takes are filmed (a new voice, the storyboard made again) is a new request and is paid on top.
 */
const AT_MOST =
  "At most: every take and every picture ordered twice, the most the run orders for one storyboard. A change asked for after the takes are filmed, such as a new voice or the storyboard made again, films them again and is paid on top.";

/** Why the start would be refused whatever the size, and the video the swipe already has (a fact, said once). */
function refusalLines(price: PricedSwipe): string[] {
  return [
    ...price.startRefusals.map((why) => `The start would be refused now: ${why}`),
    ...(price.heldBy ? [`This swipe already has a video, run ${price.heldBy}: a start makes a second, paid video only with --again.`] : []),
  ];
}

/** A swipe's price as the member reads it. */
export function priceLines(price: SwipePrice, dashboardUrl: string): string[] {
  const page = dashboardUrl ? [`The swipe on the dashboard: ${dashboardUrl}`] : [];
  if (!price.priced) return [`No price for the video of swipe ${price.swipeId}: ${price.why}`, ...page];
  const lines = [
    `The video of swipe ${price.swipeId}${price.kind ? `, ${price.kind.label} (${price.kind.key})` : ""}, before the yes:`,
    `Price: ${pickedPriceLine(price)}.`,
    ...(price.picked.startRefusal ? [`The start refuses it: ${price.picked.startRefusal}`] : []),
    ...price.picked.lines.map((line) => `  ${line.what}: ${lineUsd(line.usd)}`),
    "",
    ...(price.sizeChoices ? ["Each size:", ...distinctOptions(price).map((row) => `  ${filmWords(row, price.scriptTakes)}: ${priceWords(row)}`), ""] : []),
    ...price.notes,
    price.leavesOut,
    AT_MOST,
    ...refusalLines(price),
    changeLine(price),
    ...page,
  ];
  return lines.filter((line, i) => !(line === "" && lines[i - 1] === ""));
}

/** `exodus video swipe sheet price <swipeId>`: the price of the swipe's video before the yes. Free. */
export async function swipeSheetPriceFlow(swipeId: string, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult> {
  const res = await deps.get(`${SWIPE_SHEET_PRICE_PATH}?id=${encodeURIComponent(swipeId)}`);
  if (!res.ok) return swipeError(res, opts.json);
  const read = priceOf(res.data);
  if (!read) return failed("The server's answer about this price could not be read.", opts.json);
  if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, ...read })] };
  return { code: 0, lines: priceLines(read.price, read.dashboardUrl) };
}

/**
 * The start's paid-step text: what it buys, who pays, and, for a kind whose saved sheet has a price, the whole video's
 * price, when it is paid, and the line to run on the member's yes. That line carries the most shown (--max-usd), so the
 * server refuses a start that can now cost more (the sheet changed since). The price is a free read; when it cannot be
 * had (an older server, a refusal, no connection), the text says the CLI prints none, as before. Nothing is started
 * either way.
 */
async function startNeedsYes(
  swipeId: string,
  step: PaidStep,
  json: boolean,
  again: boolean,
  choice: string[],
  deps: VideoDeps,
): Promise<FlowResult> {
  let price: SwipePrice | null = null;
  try {
    const res = await deps.get(`${SWIPE_SHEET_PRICE_PATH}?id=${encodeURIComponent(swipeId)}`);
    price = res.ok ? (priceOf(res.data)?.price ?? null) : null;
  } catch {
    price = null;
  }
  if (!price?.priced) return needsYesResult(step, json, choice);
  const { buys, paidBy } = PAID[step];
  if (json) return { code: 0, lines: [JSON.stringify({ ok: false, needsYes: true, buys, paidBy, price })] };
  const when = step === "start-one-shot"
    ? "paid from the start: the whole video is made with no stop"
    : "paid once the storyboard is approved: the run stops there first";
  return {
    code: 0,
    lines: [
      "This step costs money, so nothing was sent.",
      ...choice,
      `It buys: ${buys}`,
      `Who pays: ${paidBy}`,
      `The whole video's price: ${pickedPriceLine(price)}, ${when}.`,
      ...(price.picked.startRefusal ? [`The start refuses it: ${price.picked.startRefusal}`] : []),
      price.leavesOut,
      AT_MOST,
      ...price.startRefusals.map((why) => `The start would be refused now: ${why}`),
      // With --again the second video is what was asked for, and the choice line above says so.
      ...(price.heldBy && !again ? [`This swipe already has a video, run ${price.heldBy}: this start is refused, and a second, paid video needs --again.`] : []),
      ...(cheaperOption(price) ? [`For less, set the sheet first (free): exodus video swipe sheet price ${swipeId} lists each size.`] : []),
      `Ask the member. On their yes, run the same command with --yes --max-usd ${price.picked.maxUsd.toFixed(2)}: the start is refused if it can now cost more.`,
    ],
  };
}

// ── Options asked for on the sheet (COP-265 part 7) ──────────────────────────────────────────────────────────────

/** The server's answer to an ask for options (convex/videoSheet.ts OptionsAnswer, with the sheet's page). */
interface OptionsAnswer {
  row: "who" | "voice";
  started?: boolean;
  price?: { count: number; mostUsd: number; lines: string[] };
  refusal?: string | null;
  ids?: string[];
  listed?: number;
  sheet: SavedSheet;
  dashboardUrl: string;
}

function optionsAnswerOf(data: unknown): OptionsAnswer | null {
  const read = sheetOf(data);
  if (!read || !isRecord(data) || (data.row !== "who" && data.row !== "voice")) return null;
  return { ...(data as unknown as OptionsAnswer), sheet: read.sheet, dashboardUrl: read.dashboardUrl };
}

const rowOfSheet = (sheet: SavedSheet, id: string) => sheet.sections.flatMap((section) => section.rows).find((row) => row.id === id);

/** People made, one a line: the number to pick them by, their name and who they are, and their picture's address. */
function peopleLines(sheet: SavedSheet): string[] {
  const row = rowOfSheet(sheet, "who");
  return (row?.options ?? []).map((option) => `  ${option.id}: ${option.label}${option.pictureUrl ? `  picture: ${option.pictureUrl}` : ""}`);
}

/** How long --wait waits for people: eight people, each a cast call and a face Kie may take 10 minutes on, twice. */
const PEOPLE_WAIT_POLLS = (45 * 60_000) / POLL_MS;

/**
 * `exodus video swipe sheet people <swipeId> [--count n] [--yes] [--wait]`: new people to pick from for the person
 * row, each one short text call on the member's model key and one face picture on their Kie key. Without --yes it
 * says the price and what it buys, and nothing is made or paid. With it the server makes them in the background;
 * --wait waits until they are made and shows each with their picture's address.
 */
/** The most as the price says it: rounded up to the cent, so no line says less than the price showed. */
const mostShown = (mostUsd: number) => (Math.ceil(Math.round(mostUsd * 100_000) / 1000) / 100).toFixed(2);

export async function swipeSheetPeopleFlow(
  swipeId: string,
  count: number | null,
  maxUsd: number | null,
  opts: SwipeRunOptions,
  deps: VideoDeps,
): Promise<FlowResult> {
  const again = `exodus video swipe sheet people ${swipeId}${count !== null ? ` --count ${count}` : ""}`;
  let res: ApiResponse<unknown>;
  try {
    res = await deps.post(`${SWIPE_SHEET_OPTIONS_PATH}?${SHEET_SOURCES_QUERY}`, {
      swipeId,
      row: "who",
      ...(count !== null ? { count } : {}),
      ...(opts.yes ? { yes: true } : {}),
      ...(maxUsd !== null ? { mostUsd: maxUsd } : {}),
    });
  } catch (err) {
    const error = `The server could not be reached: ${describeFetchFailure(err)}.`;
    // A yes that got no answer may have started the people: the sheet says, so they are never asked for twice.
    const look = opts.yes ? `Whether they are being made is not known. Read the sheet before asking again: exodus video swipe sheet ${swipeId}` : "Nothing was made.";
    return { code: 1, lines: opts.json ? [JSON.stringify({ ok: false, error, started: opts.yes ? "unknown" : false })] : [error, look] };
  }
  if (!res.ok) {
    if (res.status === 404) return swipeError(res, opts.json);
    const error = swipeErrorLine(res);
    const refused = res.status >= 400 && res.status < 500;
    const look = refused ? "Nothing was made." : `Whether they are being made is not known. Read the sheet before asking again: exodus video swipe sheet ${swipeId}`;
    return { code: 1, lines: opts.json ? [JSON.stringify({ ok: false, status: res.status, error, started: refused ? false : "unknown" })] : [error, look] };
  }
  const answer = optionsAnswerOf(res.data);
  if (!answer?.price) return failed(`The server's answer about these people could not be read. Read the sheet: exodus video swipe sheet ${swipeId}`, opts.json);
  if (!answer.started) {
    if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, started: false, price: answer.price, refusal: answer.refusal ?? null })] };
    // The figure the yes carries is the price's most, rounded up to the cent as the price prints it.
    const most = mostShown(answer.price.mostUsd);
    const next = answer.refusal
      ? [answer.refusal]
      : [`Make them (paid, on your keys, at most $${most}): ${again} --yes --max-usd ${most}`];
    return { code: 0, lines: [...answer.price.lines, "Nothing was made or paid yet.", ...next] };
  }
  const ids = answer.ids ?? [];
  const head = [
    `Making ${ids.length === 1 ? "1 new person" : `${ids.length} new people`}, numbers ${ids.join(", ")}, at most $${mostShown(answer.price.mostUsd)} on your keys.`,
  ];
  if (!opts.wait) {
    const lines = [...head, `See them as they are made: exodus video swipe sheet ${swipeId}`, `Pick one: exodus video swipe sheet set ${swipeId} who=<n>`];
    return { code: 0, lines: opts.json ? [JSON.stringify({ ok: true, started: true, ids, price: answer.price, sheet: answer.sheet, dashboardUrl: answer.dashboardUrl })] : lines };
  }
  const out = progress(opts);
  for (const line of head) out.say(line);
  const ended = await poll<{ sheet: SavedSheet; dashboardUrl: string } | { refused: ApiResponse<unknown> }>(
    () => deps.get(`${SWIPE_SHEET_PATH}?id=${encodeURIComponent(swipeId)}&${SHEET_SOURCES_QUERY}`),
    (read) => {
      if (!read.ok) return { done: { refused: read } };
      const sheet = sheetOf(read.data);
      if (!sheet) return null;
      return rowOfSheet(sheet.sheet, "who")?.optionsStatus?.making === true ? null : { done: sheet };
    },
    PEOPLE_WAIT_POLLS,
    deps,
  );
  const stillGoing = `They may still be made: exodus video swipe sheet ${swipeId}`;
  if ("lost" in ended) return failed(`${LOST} ${stillGoing}`, opts.json);
  if ("timedOut" in ended) return failed(`The people are still being made. ${stillGoing}`, opts.json);
  if ("refused" in ended.done) return waitRefused(ended.done.refused, stillGoing, opts.json);
  const { sheet, dashboardUrl } = ended.done;
  const status = rowOfSheet(sheet, "who")?.optionsStatus;
  if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, started: true, ids, status: status ?? null, sheet, dashboardUrl })] };
  const people = peopleLines(sheet);
  return {
    // An ask that made no one or stopped before it finished ends the wait as a failure.
    code: status?.failed ? 1 : 0,
    lines: [
      ...out.kept,
      ...(status?.sentence ? [status.sentence] : []),
      ...(people.length > 0 ? ["People to pick from:", ...people, `Pick one: exodus video swipe sheet set ${swipeId} who=<n>`] : []),
    ],
  };
}

/**
 * Why a start held to `maxUsd` cannot be sent: this server has no price before the yes (an older server, which ignores
 * maxUsd), or the CLI could not reach it to ask. Null when the server can hold the start to the price.
 */
async function maxUsdUnsupported(swipeId: string, maxUsd: number, deps: VideoDeps): Promise<string | null> {
  const cannot = `so it can't hold this start to ${usd(maxUsd)}, and nothing was started.`;
  try {
    const res = await deps.get(`${SWIPE_SHEET_PRICE_PATH}?id=${encodeURIComponent(swipeId)}`);
    return missingRouteLine(res, "exodus video swipe start --max-usd") ? `This server has no price before the yes, ${cannot}` : null;
  } catch {
    return `The server could not be asked whether it holds a start to a price, ${cannot}`;
  }
}

/**
 * COP-285: which voice the sheet recommends, from the row's own fields: the recommended value with its reason and that a
 * start with no pick films it; the member's own pick over it; or the reason none is recommended. Nothing from a server
 * that sends neither.
 */
function recommendedVoiceLines(row: SavedSheetRow): string[] {
  const labelOf = (id: string) => row.options?.find((option) => option.id === id)?.label ?? id;
  if (row.from === "recommended" && typeof row.value === "number") {
    return [`Recommended: ${row.value} (${labelOf(String(row.value))}).${row.why ? ` ${row.why}` : ""} A start with no pick films it.`];
  }
  if (row.recommended !== undefined && row.from === "you" && row.value !== null) {
    const picked = String(row.value) === row.recommended ? "You picked it, so a start films it." : `You picked ${row.value}, so a start films your pick.`;
    return [`Recommended: ${row.recommended} (${labelOf(row.recommended)}). ${picked}`];
  }
  return row.value === null && row.why ? [row.why] : [];
}

/**
 * `exodus video swipe sheet voices <swipeId>`: the voices on the member's ElevenLabs account that fit the person, best
 * fit first, and the one the sheet recommends. One read of the voice list on the member's ElevenLabs key; no speech is
 * made.
 */
export async function swipeSheetVoicesFlow(swipeId: string, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult> {
  const res = await deps.post(`${SWIPE_SHEET_OPTIONS_PATH}?${SHEET_SOURCES_QUERY}`, { swipeId, row: "voice" });
  if (!res.ok) return swipeError(res, opts.json);
  const answer = optionsAnswerOf(res.data);
  if (!answer) return failed(`The server's answer about the voices could not be read. Read the sheet: exodus video swipe sheet ${swipeId}`, opts.json);
  const row = rowOfSheet(answer.sheet, "voice");
  if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, voices: row?.options ?? [], status: row?.optionsStatus ?? null, sheet: answer.sheet, dashboardUrl: answer.dashboardUrl })] };
  const voices = (row?.options ?? []).map((option) => `  ${option.id}: ${option.label}${option.sampleUrl ? `  sample: ${option.sampleUrl}` : ""}`);
  return {
    code: 0,
    lines: [
      ...(row?.optionsStatus?.sentence ? [row.optionsStatus.sentence] : []),
      ...voices,
      ...(row ? recommendedVoiceLines(row) : []),
      ...(voices.length > 0 ? [`Pick one (free): exodus video swipe sheet set ${swipeId} voice=<n>. The video is then filmed in that voice.`] : []),
    ],
  };
}

// ── The start ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * COP-289: before a start, whether people to pick from are being made for the swipe while the person row is not the
 * member's own pick; if so, waits a few minutes at most for them, saying so. Null when there was nothing to wait for or
 * the sheet could not be read (an older server): the start goes on as before.
 */
async function peopleBeforeStart(
  swipeId: string,
  opts: SwipeRunOptions,
  deps: VideoDeps,
): Promise<{ lines: string[]; stillMaking: boolean; waited: boolean; who?: SavedSheetRow } | null> {
  let first: ReturnType<typeof sheetOf> = null;
  try {
    const res = await deps.get(peopleSheetPath(swipeId));
    first = res.ok ? sheetOf(res.data) : null;
  } catch {
    first = null;
  }
  const who = first ? rowOfSheet(first.sheet, "who") : undefined;
  if (!who) return null;
  if (!who.optionsStatus?.making || who.from === "you") {
    // COP-289 review: nothing to wait for, and the sheet has people: still one line on who the start films.
    const films = startFilmsLine(who, swipeId);
    return films ? { lines: [films], stillMaking: false, waited: false, who } : null;
  }
  // COP-289 review: the wait is counted from the ask's own start, 5 minutes in all, so an ask whose worker went quiet
  // costs a member one wait, not one a start. An older server says no age: the start then waits 5 minutes, said so.
  const aged = typeof who.optionsStatus.makingForMs === "number";
  const leftMs = PEOPLE_MADE_WAIT_MS - (aged ? Math.max(0, who.optionsStatus.makingForMs ?? 0) : 0);
  if (leftMs <= 0) return { lines: [goesOnLine(who, aged)], stillMaking: true, waited: false, who };
  const out = progress(opts);
  out.say(
    checksOnly(who, aged)
      ? "The pictures of the people to pick from are being checked for this swipe. The start waits for the check, until 5 minutes after it started, so a start with no pick films the one it recommends."
      : `People to pick from are being made for this swipe. The start waits for them, ${aged ? "until 5 minutes after they were asked for" : "up to 5 minutes"}, so a start with no pick films the one a check of their faces recommends.`,
  );
  const ended = await untilPeopleMade(swipeId, deps, (row) => row.from !== "you", () => undefined, Math.ceil(leftMs / POLL_MS), deps.now() + leftMs);
  if ("timedOut" in ended || "lost" in ended || ended.done === null) {
    // Said from the last sheet read: a pick that came in during the wait is what the start films.
    const last = ("timedOut" in ended || "lost" in ended ? ended.last : undefined) ?? who;
    const why = "timedOut" in ended ? undefined : "Where the people stand could not be read";
    return { lines: [...out.kept, goesOnLine(last, aged, why)], stillMaking: true, waited: true, who: last };
  }
  const sentence = ended.done.who?.optionsStatus?.sentence;
  const films = startFilmsLine(ended.done.who, swipeId);
  return { lines: [...out.kept, ...(sentence ? [sentence] : []), ...(films ? [films] : [])], stillMaking: false, waited: true, who: ended.done.who };
}

/** How long a start may wait for people, counted from when they were asked for. */
const PEOPLE_MADE_WAIT_MS = 5 * 60_000;

/** Said when the start goes on while people are still being made: why, and plainly what it films. */
/**
 * COP-289 review: an ask that only checks taken people. A server that gives an ask's age gives a count for every ask
 * that makes people, so an aged ask being made with no count makes no one: it checks the pictures of people taken.
 */
const checksOnly = (who: SavedSheetRow, aged: boolean) => aged && who.optionsStatus?.making === true && typeof who.optionsStatus.count !== "number";

function goesOnLine(who: SavedSheetRow, aged: boolean, why?: string): string {
  const checking = checksOnly(who, aged);
  why ??= checking
    ? "The check of their pictures is still running 5 minutes after it started"
    : aged
      ? "The people are still being made 5 minutes after they were asked for"
      : "The people are still being made after 5 minutes";
  const films =
    typeof who.value === "number"
      ? who.from === "you"
        ? `it films person ${who.value}, your pick`
        : `it films person ${who.value}, the recommended one`
      : `it films ${castFrom(who)}, not one of ${checking ? "these" : "the people being made"}`;
  return `${why}, so the start goes on with the sheet as it stands now: ${films}. They stay on the sheet for a next video.`;
}

/** A start's answer after it waited for people: what the wait said first; with --json, whether they were still being made. */
function withPeopleWait(
  result: FlowResult,
  people: { lines: string[]; stillMaking: boolean; waited: boolean; who?: SavedSheetRow },
  json: boolean,
): FlowResult {
  if (!json) return { ...result, lines: [...people.lines, ...result.lines] };
  if (result.lines.length !== 1) return result;
  const films = startFilmsJson(people.who);
  try {
    const answer = JSON.parse(result.lines[0]) as Record<string, unknown>;
    return {
      ...result,
      lines: [JSON.stringify({ ...answer, ...(people.waited || people.stillMaking ? { peopleWait: { stillMaking: people.stillMaking } } : {}), ...(films ? { startFilms: films } : {}) })],
    };
  } catch {
    return result;
  }
}

/** The server's code for a start refused because the swipe already has a video (convex/lib/swipeStart.ts). */
export const SWIPE_ALREADY_STARTED_CODE = "SWIPE_ALREADY_STARTED";

/** The run named by the start's refusal of a swipe that already has a video, or null for any other answer. */
export function alreadyStartedOf(res: ApiResponse<unknown>): { runId: string; url: string } | null {
  if (res.ok || res.status !== 409 || !isRecord(res.data) || !isRecord(res.data.error)) return null;
  const { code, runId, url } = res.data.error;
  if (code !== SWIPE_ALREADY_STARTED_CODE || typeof runId !== "string" || !runId) return null;
  return { runId, url: typeof url === "string" ? url : "" };
}

/**
 * `exodus video swipe start <swipeId>`: the run the swipe holds, started as the dashboard's script door starts it.
 * `again` is the member asking for a second video of a swipe that already has one; without it the server refuses
 * such a start and names the run, and nothing is started.
 */
export async function swipeStartFlow(
  swipeId: string,
  ask: StartAsk,
  opts: SwipeRunOptions,
  deps: VideoDeps,
  again = false,
  waitPeople = false,
): Promise<FlowResult> {
  const { json } = opts;
  if (!opts.yes) {
    return startNeedsYes(
      swipeId,
      ask.oneShot ? "start-one-shot" : "start",
      json,
      again,
      again ? ["With --again: a second video from this swipe, even if it already has one. It is paid on its own."] : [],
      deps,
    );
  }
  // COP-289: while the swipe's people are being made, the start waits for them, a few minutes at most, so it takes the
  // sheet as it stands once they are made; then it starts as it always does.
  const people = waitPeople ? await peopleBeforeStart(swipeId, opts, deps) : null;
  if (people) return withPeopleWait(await swipeStartFlow(swipeId, ask, opts, deps, again), people, json);
  // COP-265 part 6: a server without the price before the yes ignores maxUsd and would start the video unheld, so a
  // start held to a price first asks the price's route (a free read) and starts nothing where it is missing.
  if (ask.maxUsd !== undefined) {
    const unheld = await maxUsdUnsupported(swipeId, ask.maxUsd, deps);
    if (unheld) return failed(unheld, json);
  }
  const res = await deps.post(SWIPE_RUNS_PATH, {
    swipeId,
    ...(ask.style ? { style: ask.style } : {}),
    ...(ask.title ? { title: ask.title } : {}),
    ...(ask.music ? { music: true } : {}),
    // Guided unless --one-shot, as the dashboard sends it.
    ...(ask.oneShot ? {} : { reviewStoryboard: true }),
    ...(again ? { again: true } : {}),
    ...(ask.maxUsd !== undefined ? { maxUsd: ask.maxUsd } : {}),
  });
  const held = alreadyStartedOf(res);
  if (held) {
    const error = `Swipe ${swipeId} already has a video, so nothing was started: run ${held.runId}.`;
    if (json) return { code: 1, lines: [JSON.stringify({ ok: false, status: res.status, error, alreadyStarted: held })] };
    return {
      code: 1,
      lines: [
        error,
        held.url ? `Watch it: ${held.url}` : `Check it: exodus video status ${held.runId}`,
        `A second video from this swipe is paid on its own. Only on the member's yes to a second video: exodus video swipe start ${swipeId} --again --yes`,
      ],
    };
  }
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

// ── The sheet: the whole swipe from one file ──────────────────────────────────────────────────────────────────────

/**
 * `exodus video swipe run --sheet <file>`: every paid step of a swipe, for one ad or many, from one JSON file
 * answered once (version 3 of the sheet, SWIPE-ONE-SHEET-PLAN section 4). The videos are every pair of a persona and
 * a character, for each ad, in the file's order. Each ad gets one breakdown and one template, each ad and persona one
 * write, and each video one run of its persona's swipe. Each step is the verb's own flow, run with --json so its
 * answer can be read; a state file beside the sheet keeps what each step bought, so a second run goes on where the
 * first stopped and never buys a step twice.
 */
export const SHEET_FIELDS = [
  "sources",
  "product",
  "personas",
  "mechanism",
  "guidance",
  "mode",
  "closeness",
  "look",
  "script",
  "kind",
  "characters",
  "finish",
  "oneShot",
  "style",
  "title",
  "music",
] as const;

const FINISH_FIELDS = ["captions", "speed", "jumpCuts", "music", "endCard"] as const;
const CAPTION_STYLES = ["auto", "none", "3-word", "by-line"];

/** Above this many videos the plan says the count again before the yes (Dani's call, plan section 1). */
export const SHEET_VIDEO_WARNING = 6;

const SHEET_WORDS: ChoiceWords = {
  who: "In the sheet,",
  flag: (name) => `"${name}"`,
  set: (name, value) => `"${name}": "${value.replace(/^"|"$/g, "")}"`,
};

export interface SheetSource {
  /** The source's own value (its link, ad id or file path as the sheet writes it): its key in the state file. */
  key: string;
  /** The entry as the sheet wrote it, for --json. */
  given: { url: string } | { ad: string } | { file: string };
  source: SwipeSource;
}

/** One write's choices, and the fingerprint of its script, so a changed script is written again. */
interface SheetWrite {
  ask: Omit<WriteAsk, "productId">;
  scriptSha256: string | null;
}

export interface SheetPersona {
  name: string;
  /** Its own script as the sheet names it. Then its write is their-format with that script, whatever "mode" says. */
  script: string | null;
  write: SheetWrite | null;
}

/**
 * One character of the video list. Today a swiped run takes no saved characters, so the list is the run's own cast
 * only (pick null). When the start takes them, each picked character is one entry with its pick, passed to the start.
 */
export interface SheetCharacter {
  index: number;
  pick: { elements: unknown[]; voices: unknown[] } | null;
}

export interface SwipeSheet {
  sources: SheetSource[];
  productId: string | null;
  personas: SheetPersona[];
  /** The sheet's own write choices: for no persona and for a persona with no script. Null when none uses them. */
  write: SheetWrite | null;
  /** The sheet's choices no write uses, because every persona has its own script. */
  unusedChoices: string[];
  characters: SheetCharacter[];
  start: StartAsk;
  /** What the server doesn't take yet: mechanism, guidance and the finish fields other than music. */
  notUsed: string[];
  /** Fields read from their old place: the top-level "music". */
  moved: string[];
  /** The kind of ad every write is for, in place of the template's pick; null when the sheet names none. */
  kind: string | null;
}

export interface SheetVideo {
  n: number;
  source: SheetSource;
  persona: SheetPersona | null;
  character: SheetCharacter;
}

/** What a swipe was written with. A sheet that asks for other choices does not reuse that write. */
export interface WrittenWith {
  productId: string;
  mode: ServerMode;
  closeness: number | null;
  look: string | null;
  scriptSha256: string | null;
  /** The kind of ad named in place of the template's pick; absent when none was. */
  kind?: string;
}

export type SheetStep = "breakdown" | "template" | "write" | "start";

/**
 * A paid ask that was sent and whose end was not seen. A rerun proves what became of it before it buys the step
 * again: by the job the server named (a template or a write), by the swipe the start was for, or, when the CLI was
 * stopped before any answer, by what was stored since `at`. What it cannot prove, it does not buy again.
 */
export interface SourcePending {
  step: "breakdown" | "template";
  at: string;
  job?: string;
}
export interface WritePending {
  at: string;
  job?: string;
  /** The choices that write was sent with, so a swipe it made is never taken for other choices. */
  asked?: WrittenWith;
}
export interface StartPending {
  at: string;
  swipeId: string;
  /** The server's clock when the start was sent (its swipe read just before), so the wait doesn't hang on this one's. */
  serverAt?: number;
}

/** One video's run: per ad, persona and character. */
export interface SheetRunState {
  runId: string | null;
  /** The run's "Watch it" link. */
  watch: string | null;
  pending: StartPending | null;
  lastError: string | null;
  updatedAt: string | null;
}

/** One write: per ad and persona, shared by that persona's videos. */
export interface SheetWriteState {
  swipeId: string | null;
  writtenWith: WrittenWith | null;
  /** The writer's sentence when it refused. It is not written again without --retry-refused or a changed sheet. */
  refused: string | null;
  pending: WritePending | null;
  lastError: string | null;
  updatedAt: string | null;
  /** Keyed by the character's index ("0" is the run's own cast). */
  runs: Record<string, SheetRunState>;
}

/** One ad: its breakdown and template, shared by all its videos. */
export interface SheetSourceState {
  kind: SwipeSource["kind"];
  breakdownId: string | null;
  templateDone: boolean;
  /** A file's breakdown or the template, asked for and not seen to end. */
  pending: SourcePending | null;
  lastError: string | null;
  updatedAt: string | null;
  /** Keyed by the persona's name; "" is the write with no persona. */
  writes: Record<string, SheetWriteState>;
}

export interface SheetState {
  version: 3;
  sheet: string;
  sources: Record<string, SheetSourceState>;
}

export const sheetStatePath = (sheetFile: string) => `${sheetFile}.state.json`;

const personaKey = (persona: SheetPersona | null) => persona?.name ?? "";

const present = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  !(typeof value === "string" && !value.trim()) &&
  !(isRecord(value) && Object.keys(value).length === 0);

const quoted = (names: readonly string[]) => names.map((name) => `"${name}"`).join(", ");

function inSheetDir(sheetFile: string, file: string): string {
  return path.isAbsolute(file) ? file : path.join(path.dirname(sheetFile), file);
}

const MEMBER_SCRIPT_MAX_CHARS = 20_000;

const sha256Of = (text: string) => createHash("sha256").update(text).digest("hex");

/** A write's choices from words as typed, checked as swipe write checks them, with its script read and fingerprinted. */
function sheetWriteOf(
  sheetFile: string,
  given: { mode: Given; closeness: Given; look: Given; script: Given },
  scriptName: (named: string) => string,
  deps: VideoDeps,
): SheetWrite | { problem: string } {
  const write = writeChoicesOf(given, SHEET_WORDS);
  if ("problem" in write) return write;
  if (write.ask.scriptFile === undefined) return { ask: write.ask, scriptSha256: null };
  const named = write.ask.scriptFile;
  const scriptFile = inSheetDir(sheetFile, named);
  let script: string;
  try {
    script = deps.readFile(scriptFile);
  } catch {
    return { problem: `Can't read ${scriptName(named)}. Check the path.` };
  }
  const capital = (sentence: string) => sentence.replace(/^./, (c) => c.toUpperCase());
  if (!script.trim()) return { problem: capital(`${scriptName(named)} is empty.`) };
  // The server's own cap on a member's script (MEMBER_SCRIPT_MAX_CHARS, convex/http.ts), said before anything is paid.
  if (script.length > MEMBER_SCRIPT_MAX_CHARS) {
    return { problem: capital(`${scriptName(named)} is too long: a script can have at most 20,000 characters.`) };
  }
  // The text read here is the text the write sends and the fingerprint records: the file is never read again.
  return { ask: { ...write.ask, scriptFile, scriptText: script }, scriptSha256: sha256Of(script) };
}

/** Reads and checks a sheet. Every problem is one plain sentence, and nothing is sent. */
export function readSwipeSheet(sheetFile: string, deps: VideoDeps): { sheet: SwipeSheet } | { problem: string } {
  let text: string;
  try {
    text = deps.readFile(sheetFile);
  } catch {
    return { problem: `Can't read the sheet ${sheetFile}. Check the path.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problem: `The sheet ${sheetFile} is not valid JSON.` };
  }
  if (!isRecord(raw)) return { problem: `The sheet ${sheetFile} must be one JSON object.` };
  if ("persona" in raw) {
    return { problem: 'The sheet has "persona"; a sheet takes "personas" now, a list of {"name": ..., "text": ...}.' };
  }
  const unknown = Object.keys(raw).filter((name) => !(SHEET_FIELDS as readonly string[]).includes(name));
  if (unknown.length > 0) {
    return { problem: `The sheet has ${quoted(unknown)}, which this command does not know. A sheet takes ${quoted(SHEET_FIELDS)}.` };
  }

  // The ads.
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    return { problem: 'The sheet needs "sources": a list of ads, each {"url": ...}, {"ad": ...} or {"file": ...}.' };
  }
  const sources: SheetSource[] = [];
  const seen = new Map<string, number>();
  for (const [index, entry] of raw.sources.entries()) {
    const n = index + 1;
    if (!isRecord(entry)) return { problem: `Source ${n} in the sheet must be {"url": ...}, {"ad": ...} or {"file": ...}.` };
    const extra = Object.keys(entry).filter((name) => !["url", "ad", "file"].includes(name));
    if (extra.length > 0) return { problem: `Source ${n} in the sheet has ${quoted(extra)}; a source is only "url", "ad" or "file".` };
    const kinds = (["url", "ad", "file"] as const).filter((name) => entry[name] !== undefined && entry[name] !== null);
    if (kinds.length === 0) return { problem: `Source ${n} in the sheet needs one of "url", "ad" or "file".` };
    if (kinds.length > 1) {
      return { problem: `Source ${n} in the sheet has both ${quoted(kinds).replace(", ", " and ")}; give exactly one of "url", "ad" or "file".` };
    }
    const kind = kinds[0];
    const value = entry[kind];
    if (typeof value !== "string" || !value.trim()) {
      return { problem: `Source ${n} in the sheet: "${kind}" needs ${kind === "url" ? "a link" : kind === "ad" ? "an ad id" : "a video file's path"}.` };
    }
    const key = value.trim();
    const before = seen.get(key);
    if (before !== undefined) return { problem: `Source ${n} in the sheet is the same ad as source ${before}. List each ad once.` };
    seen.set(key, n);
    if (kind === "url") sources.push({ key, given: { url: key }, source: { kind: "url", url: key } });
    else if (kind === "ad") sources.push({ key, given: { ad: key }, source: { kind: "ad", swipeAdId: key } });
    else sources.push({ key, given: { file: key }, source: { kind: "file", file: inSheetDir(sheetFile, key) } });
  }

  if (present(raw.product) && typeof raw.product !== "string") {
    return { problem: 'In the sheet, "product" must be a product id. exodus video swipe products lists them.' };
  }
  const productId = typeof raw.product === "string" && raw.product.trim() ? raw.product.trim() : null;
  if (raw.kind !== undefined && raw.kind !== null && (typeof raw.kind !== "string" || !raw.kind.trim())) {
    return { problem: `In the sheet, "kind" must be the key of a kind of ad, or null. ${KIND_CHECKED}` };
  }
  // Every write of the sheet, a persona's own script too, is written for this kind.
  const named = typeof raw.kind === "string" ? { kind: raw.kind.trim() } : {};

  // The sheet's choices as typed, in the words swipe write and swipe start check: absent or null is not given,
  // an empty string is given with no value.
  const given = (from: Record<string, unknown>, name: string): Given => {
    const value = from[name];
    if (value === undefined || value === null) return undefined;
    const typed = typeof value === "string" ? value : typeof value === "number" ? String(value) : JSON.stringify(value);
    return typed.trim() ? typed : null;
  };

  // The personas. A persona with its own script is written their-format with it.
  if (raw.personas !== undefined && raw.personas !== null && !Array.isArray(raw.personas)) {
    return { problem: 'In the sheet, "personas" must be a list of {"name": ..., "text": ...}, or [] for none.' };
  }
  const personas: SheetPersona[] = [];
  for (const [index, entry] of ((raw.personas as unknown[] | null | undefined) ?? []).entries()) {
    const n = index + 1;
    if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name.trim()) {
      return { problem: `Persona ${n} in the sheet needs a "name".` };
    }
    const name = entry.name.trim();
    const extra = Object.keys(entry).filter((field) => !["name", "text", "script"].includes(field));
    if (extra.length > 0) return { problem: `Persona ${name} in the sheet has ${quoted(extra)}; a persona takes "name", "text" and "script".` };
    if (personas.some((persona) => persona.name === name)) return { problem: `The sheet has the persona ${name} twice. Name each persona once.` };
    if (entry.text !== undefined && entry.text !== null && typeof entry.text !== "string") {
      return { problem: `Persona ${name} in the sheet: "text" must be text.` };
    }
    let write: SheetWrite | null = null;
    let script: string | null = null;
    if (entry.script !== undefined && entry.script !== null) {
      if (typeof entry.script !== "string" || !entry.script.trim()) return { problem: `Persona ${name} in the sheet: "script" needs a file.` };
      script = entry.script.trim();
      const own = sheetWriteOf(
        sheetFile,
        { mode: "their-format", closeness: undefined, look: undefined, script },
        (file) => `persona ${name}'s script ${file}`,
        deps,
      );
      if ("problem" in own) return own;
      write = { ...own, ask: { ...own.ask, ...named } };
    }
    personas.push({ name, script, write });
  }

  // The sheet's own write choices. They are checked always, so a typo is said now; their script is read only when
  // a write uses them.
  const choiceFields = ["mode", "closeness", "look", "script"] as const;
  const top = { mode: given(raw, "mode"), closeness: given(raw, "closeness"), look: given(raw, "look"), script: given(raw, "script") };
  let write: SheetWrite | null = null;
  let unusedChoices: string[] = [];
  if (personas.length === 0 || personas.some((persona) => persona.write === null)) {
    const checked = sheetWriteOf(sheetFile, top, (file) => `the sheet's script ${file}`, deps);
    if ("problem" in checked) return checked;
    write = { ...checked, ask: { ...checked.ask, ...named } };
  } else {
    // Every persona has its own script, so a their-format sheet needs no script of its own here.
    const theirFormat = typeof top.mode === "string" && parseSwipeMode(top.mode) === "their-format";
    const checked = writeChoicesOf({ ...top, script: top.script ?? (theirFormat ? "-" : undefined) }, SHEET_WORDS);
    if ("problem" in checked) return checked;
    unusedChoices = choiceFields.filter((name) => present(raw[name]));
  }

  // The characters. Saved or drawn characters are refused until a swiped run's start takes them.
  const characters = raw.characters;
  if (characters !== undefined && characters !== null) {
    if (!isRecord(characters)) return { problem: 'In the sheet, "characters" must be {"how": "auto"}, or left out.' };
    const extra = Object.keys(characters).filter((name) => !["how", "picked"].includes(name));
    if (extra.length > 0) return { problem: `In the sheet, "characters" has ${quoted(extra)}; it takes "how" and "picked".` };
    const how = characters.how ?? "auto";
    if (!["auto", "saved", "draw"].includes(how as string)) {
      return { problem: `In the sheet, "characters" "how" must be "auto", "saved" or "draw", not ${JSON.stringify(how)}.` };
    }
    if (characters.picked !== undefined && characters.picked !== null && !Array.isArray(characters.picked)) {
      return { problem: 'In the sheet, "characters" "picked" must be a list.' };
    }
    const picked = (characters.picked as unknown[] | null | undefined) ?? [];
    if (how !== "auto" || picked.length > 0) {
      const asked = how !== "auto" ? `"how": "${how}"` : "picked characters";
      return {
        problem: `In the sheet, "characters" asks for ${asked}, but characters on a swiped run aren't supported yet: the run casts its own. Use "how": "auto" with no "picked", or leave "characters" out.`,
      };
    }
  }
  const sheetCharacters: SheetCharacter[] = [{ index: 0, pick: null }];

  // The finish. Only music reaches a swiped run's start today; the rest is said, not dropped.
  const finish = raw.finish ?? {};
  if (!isRecord(finish)) return { problem: 'In the sheet, "finish" must be {"captions": ..., "speed": ..., ...}, or left out.' };
  const finishExtra = Object.keys(finish).filter((name) => !(FINISH_FIELDS as readonly string[]).includes(name));
  if (finishExtra.length > 0) return { problem: `In the sheet, "finish" has ${quoted(finishExtra)}; it takes ${quoted(FINISH_FIELDS)}.` };
  const set = (name: string) => finish[name] !== undefined && finish[name] !== null;
  if (set("captions") && !CAPTION_STYLES.includes(finish.captions as string)) {
    return { problem: `In the sheet, "finish" "captions" must be "auto", "none", "3-word" or "by-line", not ${JSON.stringify(finish.captions)}.` };
  }
  if (set("speed") && !(typeof finish.speed === "number" && finish.speed > 0)) {
    return { problem: 'In the sheet, "finish" "speed" must be a number, like 1.15.' };
  }
  for (const name of ["jumpCuts", "music", "endCard"]) {
    if (set(name) && typeof finish[name] !== "boolean") return { problem: `In the sheet, "finish" "${name}" must be true or false.` };
  }
  for (const name of ["music", "oneShot"] as const) {
    if (raw[name] !== undefined && raw[name] !== null && typeof raw[name] !== "boolean") {
      return { problem: `In the sheet, "${name}" must be true or false.` };
    }
  }
  const topMusic = typeof raw.music === "boolean" ? raw.music : undefined;
  const finishMusic = typeof finish.music === "boolean" ? finish.music : undefined;
  if (topMusic !== undefined && finishMusic !== undefined && topMusic !== finishMusic) {
    return { problem: 'The sheet has "music" twice, at the top and in "finish", and they differ. Keep the one in "finish".' };
  }
  if (present(raw.style) && typeof raw.style !== "string") return { problem: 'In the sheet, "style" must be a look\'s slug, or null.' };
  if (present(raw.title) && typeof raw.title !== "string") return { problem: 'In the sheet, "title" must be text, or null.' };
  const start = startChoicesOf(
    { style: given(raw, "style"), title: given(raw, "title"), music: (finishMusic ?? topMusic) === true, oneShot: raw.oneShot === true },
    SHEET_WORDS,
  );
  if ("problem" in start) return start;

  if (present(raw.mechanism) && !isRecord(raw.mechanism) && typeof raw.mechanism !== "string") {
    return { problem: 'In the sheet, "mechanism" must be {"name": ..., "text": ...}, or null.' };
  }
  if (present(raw.guidance) && typeof raw.guidance !== "string") return { problem: 'In the sheet, "guidance" must be text, or "".' };
  const notUsed = [
    ...(["mechanism", "guidance"] as const).filter((name) => present(raw[name])),
    ...FINISH_FIELDS.filter((name) => name !== "music" && set(name)).map((name) => `finish.${name}`),
  ];

  return {
    sheet: {
      sources,
      productId,
      personas,
      write,
      unusedChoices,
      characters: sheetCharacters,
      start: start.ask,
      notUsed,
      moved: topMusic !== undefined ? ["music"] : [],
      kind: typeof raw.kind === "string" ? raw.kind.trim() : null,
    },
  };
}

/**
 * Every video of the sheet, in its order: ads, then personas, then characters. `only` keeps one persona's videos,
 * each with its number in the whole sheet, so a video's number never changes.
 */
export function sheetVideos(sheet: SwipeSheet, only: string | null): { videos: SheetVideo[]; personas: Array<SheetPersona | null> } | { problem: string } {
  const all: Array<SheetPersona | null> = sheet.personas.length > 0 ? sheet.personas : [null];
  let personas = all;
  if (only !== null) {
    const persona = sheet.personas.find((p) => p.name === only.trim());
    if (!persona) {
      return {
        problem:
          sheet.personas.length === 0
            ? `The sheet has no personas, so --persona ${only} has nothing to narrow.`
            : `The sheet has no persona named ${only}. Its personas: ${sheet.personas.map((p) => p.name).join(", ")}.`,
      };
    }
    personas = [persona];
  }
  const videos: SheetVideo[] = [];
  for (const source of sheet.sources) {
    for (const persona of all) {
      for (const character of sheet.characters) videos.push({ n: videos.length + 1, source, persona, character });
    }
  }
  return { videos: videos.filter((video) => personas.includes(video.persona)), personas };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const characterLabel = (character: SheetCharacter) => (character.pick === null ? "the run's own cast" : `character ${character.index + 1}`);

const videoLabel = (video: SheetVideo) => `${video.source.key}, ${video.persona?.name ?? "no persona"}, ${characterLabel(video.character)}`;

/** "4 videos = 2 ads × 2 personas × 1 cast", then one numbered line per video. */
function videoListLines(sheet: SwipeSheet, videos: SheetVideo[], personas: Array<SheetPersona | null>): string[] {
  const personaPart = personas[0] === null ? "1 (no persona)" : plural(personas.length, "persona", "personas");
  const castPart = sheet.characters.every((c) => c.pick === null) ? plural(sheet.characters.length, "cast", "casts") : plural(sheet.characters.length, "character", "characters");
  return [
    `${plural(videos.length, "video", "videos")} = ${plural(sheet.sources.length, "ad", "ads")} × ${personaPart} × ${castPart}:`,
    ...videos.map((video) => `  ${video.n}. ${videoLabel(video)}`),
  ];
}

/** The persona's write, or the sheet's own when it has no script. */
const writeOf = (sheet: SwipeSheet, persona: SheetPersona | null): SheetWrite => persona?.write ?? sheet.write!;

function writtenWithOf(write: SheetWrite, productId: string): WrittenWith {
  return {
    productId,
    mode: write.ask.mode,
    closeness: write.ask.mode === "their-format" ? null : write.ask.closeness,
    look: write.ask.look ?? null,
    scriptSha256: write.scriptSha256,
    ...(write.ask.kind ? { kind: write.ask.kind } : {}),
  };
}

/** What changed since a write, in words; empty when the write still fits the sheet. */
function changesSince(before: WrittenWith, now: WrittenWith): string[] {
  const changes: string[] = [];
  if (before.productId !== now.productId) changes.push(`product ${before.productId}, now ${now.productId}`);
  if (before.mode !== now.mode) changes.push(`mode ${modeOf(before.mode).flag}, now ${modeOf(now.mode).flag}`);
  else if (before.closeness !== now.closeness) changes.push(`closeness ${before.closeness}, now ${now.closeness}`);
  if (before.look !== now.look) changes.push(`look ${before.look ?? "none"}, now ${now.look ?? "none"}`);
  if (before.scriptSha256 !== now.scriptSha256) changes.push("the script");
  if ((before.kind ?? null) !== (now.kind ?? null)) changes.push(`kind ${before.kind ?? "the template's"}, now ${now.kind ?? "the template's"}`);
  return changes;
}

/** The "not used yet" lines, and the same as data for --json. */
function notUsedOf(sheet: SwipeSheet, personas: Array<SheetPersona | null>): { lines: string[]; names: string[] } {
  const told = sheet.notUsed.filter((name) => !name.startsWith("finish."));
  const finish = sheet.notUsed.filter((name) => name.startsWith("finish.")).map((name) => name.slice("finish.".length));
  const unscripted = personas.filter((p): p is SheetPersona => p !== null && p.write === null).map((p) => p.name);
  const lines = [
    ...(told.length > 0
      ? [`In the sheet and not used yet: ${told.join(", ")}. The video writer doesn't read them yet, so the run goes on without them.`]
      : []),
    ...(unscripted.length > 0
      ? [
          `The video writer doesn't read a persona yet: ${unscripted.join(", ")} ${unscripted.length === 1 ? "has" : "have"} no script, so ${unscripted.length === 1 ? "its" : "each one's"} write is the sheet's own request, and ${unscripted.length === 1 ? "its videos differ" : "their videos differ"} from the others only as two writes of the same request differ.`,
        ]
      : []),
    ...(finish.length > 0 ? [`In "finish" and not used yet: ${finish.join(", ")}. A swiped run's start takes only music today.`] : []),
    ...(sheet.unusedChoices.length > 0
      ? [`Every persona has its own script, so the sheet's ${sheet.unusedChoices.join(", ")} ${sheet.unusedChoices.length === 1 ? "is" : "are"} not used.`]
      : []),
  ];
  return {
    lines,
    names: [...told, ...unscripted.map((name) => `persona:${name}`), ...sheet.notUsed.filter((name) => name.startsWith("finish.")), ...sheet.unusedChoices],
  };
}

function sheetHeadLines(
  sheet: SwipeSheet,
  sheetFile: string,
  personas: Array<SheetPersona | null>,
  product: { name: string; id: string; picked: boolean } | null,
): string[] {
  const usesSheetWrite = personas.some((persona) => persona === null || persona.write === null);
  return [
    `The sheet ${sheetFile}.`,
    ...(product === null
      ? []
      : [
          product.picked
            ? `The sheet names no product, so it uses the brand's only one: ${product.name} (${product.id}).`
            : `Product: ${product.name} (${product.id}).`,
        ]),
    ...(usesSheetWrite && sheet.write ? choiceLines({ productId: "", ...sheet.write.ask }) : []),
    ...personas
      .filter((persona): persona is SheetPersona => persona !== null && persona.script !== null)
      .map((persona) => `Persona ${persona.name}: ${modeOf("their-format").label}, from ${persona.script}.`),
    // Every write has the sheet's kind; said with the choices above, or here when only personas' scripts are written.
    ...(!usesSheetWrite && sheet.kind ? [kindLine(sheet.kind)] : []),
    sheet.start.oneShot
      ? "One shot: the whole video with no stop. It stops only when a check finds a problem."
      : "It stops at each storyboard for the member's yes (oneShot is false or left out).",
    "Characters: each run casts its own.",
    ...(sheet.moved.includes("music") ? ['"music" is read from the top of the sheet. It has moved into "finish".'] : []),
    ...notUsedOf(sheet, personas).lines,
  ];
}

// ── The sheet's state file and its lock ──

/** The file system steps a run of a sheet needs beyond VideoDeps. Tests pass their own; the CLI uses node's. */
export interface SheetFiles {
  /** Creates the file only when none is there. False when one is. */
  createNew(file: string, text: string): boolean;
  remove(file: string): void;
  /** Writes a temporary file and renames it over the old one, so a stopped CLI never leaves half a file. */
  writeAtomic(file: string, text: string): void;
  pid: number;
  /** This machine's name: a pid means nothing on another host. */
  host: string;
  isAlive(pid: number): boolean;
  /** The file a path names once every link in it is followed. Throws when there is none. */
  realPath(file: string): string;
  /** The names in a folder; none when it can't be read. */
  listDir(dir: string): string[];
  /** Runs `cleanup` when the CLI is stopped (Ctrl-C, a kill) and then exits. Returns the call that takes it off. */
  onStop(cleanup: () => void): () => void;
}

export type SheetDeps = VideoDeps & { sheetFiles?: SheetFiles };

export const nodeSheetFiles: SheetFiles = {
  createNew(file, text) {
    try {
      fs.writeFileSync(file, text, { flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  },
  remove(file) {
    fs.rmSync(file, { force: true });
  },
  writeAtomic(file, text) {
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, text, "utf-8");
    fs.renameSync(temporary, file);
  },
  pid: process.pid,
  host: os.hostname(),
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  realPath(file) {
    return fs.realpathSync(file);
  },
  listDir(dir) {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
  onStop(cleanup) {
    const handlers = (["SIGINT", "SIGTERM"] as const).map((signal) => {
      const handler = () => {
        cleanup();
        process.exit(signal === "SIGINT" ? 130 : 143);
      };
      process.once(signal, handler);
      return [signal, handler] as const;
    });
    return () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
  },
};

const sheetFilesOf = (deps: VideoDeps) => (deps as SheetDeps).sheetFiles ?? nodeSheetFiles;

export const sheetLockPath = (sheetFile: string) => `${sheetStatePath(sheetFile)}.lock`;

/** How long a new lock settles before it is read back, so two copies that took a stale lock at once find out. */
const LOCK_SETTLE_MS = 250;

/** Held, made with wx like the lock, by the one copy replacing a stale lock; any other copy then refuses. */
export const sheetTakeoverPath = (sheetFile: string) => `${sheetLockPath(sheetFile)}.takeover`;

/**
 * One run of a sheet at a time: two at once would buy every step twice and overwrite each other's state. The lock
 * holds the pid, the host, the time and a token of its own. A lock whose pid is no longer alive on this host was left
 * by a run that was killed, and is taken. Any other lock (alive, from another host, or unreadable) refuses, and says
 * when deleting it is safe. A stale lock is replaced only while holding the takeover file, made with wx too: of two
 * copies that find the same stale lock, one replaces it, and the other then finds a live lock and refuses. A new lock
 * is still read back after a moment: only the copy whose token is still there goes on.
 */
async function takeSheetLock(sheetFile: string, deps: VideoDeps): Promise<{ release: () => void; note: string | null } | { problem: string }> {
  const files = sheetFilesOf(deps);
  const lockFile = sheetLockPath(sheetFile);
  const token = randomUUID();
  const text = JSON.stringify({ pid: files.pid, host: files.host, at: stamp(deps), token });
  const busy = (holder: string) =>
    `Another run of this sheet holds ${lockFile} (${holder}). Two at once would buy steps twice, so this one sent nothing. If no run of this sheet is going, deleting ${lockFile} is safe; then run the command again.`;
  const holderOf = (): { pid: number | null; host: string | null; at: string; token: string | null; words: string } => {
    let holder: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(deps.readFile(lockFile));
      if (isRecord(parsed)) holder = parsed;
    } catch {
      // Said as "it can't be read" below.
    }
    const pid = typeof holder.pid === "number" ? holder.pid : null;
    const host = typeof holder.host === "string" ? holder.host : null;
    const at = typeof holder.at === "string" ? holder.at : "an unknown time";
    return {
      pid,
      host,
      at,
      token: typeof holder.token === "string" ? holder.token : null,
      words: pid === null ? "it can't be read" : `pid ${pid}${host ? ` on ${host}` : ""}, since ${at}`,
    };
  };
  const tryCreate = () => {
    try {
      return files.createNew(lockFile, text);
    } catch (err) {
      return err instanceof Error ? err : new Error(String(err));
    }
  };
  let note: string | null = null;
  let made = tryCreate();
  if (made === false) {
    const holder = holderOf();
    const stale = holder.pid !== null && holder.host === files.host && !files.isAlive(holder.pid);
    if (!stale) return { problem: busy(holder.words) };
    const takeoverFile = sheetTakeoverPath(sheetFile);
    let takeover: boolean | Error;
    try {
      takeover = files.createNew(takeoverFile, text);
    } catch (err) {
      takeover = err instanceof Error ? err : new Error(String(err));
    }
    if (takeover !== true) {
      return {
        problem:
          takeover === false
            ? `Another run of this sheet is taking over the lock ${lockFile} left by a run that is no longer going, so this one sent nothing. If no run of this sheet is going, deleting ${takeoverFile} and ${lockFile} is safe; then run the command again.`
            : `The lock ${lockFile} could not be taken over (${takeover.message}). Nothing was sent.`,
      };
    }
    try {
      // Read again under the takeover file: a copy that took the stale lock first has its own fresh one there now.
      const still = holderOf();
      const same = holder.token !== null ? still.token === holder.token : still.token === null && still.pid === holder.pid && still.at === holder.at;
      if (!same) return { problem: busy(still.words) };
      files.remove(lockFile);
      made = tryCreate();
    } finally {
      files.remove(takeoverFile);
    }
    note = `A lock left by a run that is no longer going (${holder.words}) was taken.`;
  }
  if (made === false) return { problem: busy(holderOf().words) };
  if (made !== true) return { problem: `The lock ${lockFile} could not be made (${made.message}). Nothing was sent.` };
  await deps.sleep(LOCK_SETTLE_MS);
  const after = holderOf();
  if (after.token !== token) return { problem: busy(after.words) };
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    stopWatching();
    // Only our own lock is removed.
    if (holderOf().token === token) files.remove(lockFile);
  };
  const stopWatching = files.onStop(release);
  return { release, note };
}

/** A record with no prototype, so a persona named "constructor" or "__proto__" is only ever a key. */
const dict = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

/**
 * The state file, checked field by field and copied into records with no prototype. A file this CLI did not write is
 * refused, with what is wrong, rather than read as if it said nothing was bought.
 */
function stateFromJson(raw: unknown): SheetState | string {
  if (!isRecord(raw) || raw.version !== 3) return 'it has no "version": 3';
  if (typeof raw.sheet !== "string") return '"sheet" is not text';
  if (!isRecord(raw.sources)) return '"sources" is not an object';
  const text = (value: unknown) => value === null || typeof value === "string";
  const at = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));
  const sources = dict<SheetSourceState>();
  for (const [key, src] of Object.entries(raw.sources)) {
    const where = `the ad ${key}`;
    if (!isRecord(src) || !["url", "ad", "file"].includes(src.kind as string)) return `${where} has no "kind"`;
    if (!text(src.breakdownId) || typeof src.templateDone !== "boolean" || !text(src.lastError) || !text(src.updatedAt)) {
      return `${where} has a field of the wrong kind`;
    }
    const sp = src.pending;
    if (sp !== null && !(isRecord(sp) && ["breakdown", "template"].includes(sp.step as string) && at(sp.at) && (sp.job === undefined || typeof sp.job === "string"))) {
      return `${where} has a "pending" this CLI did not write`;
    }
    if (!isRecord(src.writes)) return `${where} has no "writes"`;
    const writes = dict<SheetWriteState>();
    for (const [persona, write] of Object.entries(src.writes)) {
      const whereWrite = `${where}, persona "${persona}"`;
      if (!isRecord(write) || !text(write.swipeId) || !text(write.refused) || !text(write.lastError) || !text(write.updatedAt)) {
        return `${whereWrite} has a field of the wrong kind`;
      }
      const choices = (ww: unknown) =>
        isRecord(ww) &&
        typeof ww.productId === "string" &&
        ["whole", "hook", "their-format", "new-look"].includes(ww.mode as string) &&
        (ww.closeness === null || typeof ww.closeness === "number") &&
        text(ww.look) &&
        text(ww.scriptSha256) &&
        (ww.kind === undefined || typeof ww.kind === "string");
      if (write.writtenWith !== null && !choices(write.writtenWith)) return `${whereWrite} has a "writtenWith" this CLI did not write`;
      // This CLI keeps a swipe id only with the choices it was written with; without them a changed sheet can't be seen.
      if (write.swipeId !== null && write.writtenWith === null) return `${whereWrite} has a "swipeId" with no "writtenWith"`;
      const wp = write.pending;
      if (
        wp !== null &&
        !(isRecord(wp) && at(wp.at) && (wp.job === undefined || typeof wp.job === "string") && (wp.asked === undefined || choices(wp.asked)))
      ) {
        return `${whereWrite} has a "pending" this CLI did not write`;
      }
      if (!isRecord(write.runs)) return `${whereWrite} has no "runs"`;
      const runs = dict<SheetRunState>();
      for (const [index, run] of Object.entries(write.runs)) {
        const whereRun = `${whereWrite}, character ${index}`;
        if (!/^\d+$/.test(index) || !isRecord(run) || !text(run.runId) || !text(run.watch) || !text(run.lastError) || !text(run.updatedAt)) {
          return `${whereRun} has a field of the wrong kind`;
        }
        const rp = run.pending;
        if (
          rp !== null &&
          !(isRecord(rp) && at(rp.at) && typeof rp.swipeId === "string" && (rp.serverAt === undefined || (typeof rp.serverAt === "number" && Number.isFinite(rp.serverAt))))
        ) {
          return `${whereRun} has a "pending" this CLI did not write`;
        }
        runs[index] = { ...(run as unknown as SheetRunState) };
      }
      writes[persona] = { ...(write as unknown as SheetWriteState), runs };
    }
    sources[key] = { ...(src as unknown as SheetSourceState), writes };
  }
  return { version: 3, sheet: raw.sheet, sources };
}

/** The saved state; `missing` when no state file is there, so nothing this sheet bought before is known. */
function readSheetState(sheetFile: string, deps: VideoDeps): { state: SheetState; missing: boolean } | { problem: string } {
  const file = sheetStatePath(sheetFile);
  let text: string;
  try {
    text = deps.readFile(file);
  } catch (err) {
    // Only a state file that is not there means nothing was bought. One that is there and can't be read (its
    // permissions, a folder in its place) would be overwritten by the first save and every step bought again.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: { version: 3, sheet: path.basename(sheetFile), sources: dict() }, missing: true };
    }
    return {
      problem: `The state file ${file} is there but can't be opened (${err instanceof Error ? err.message : String(err)}). It keeps what this sheet already bought, so nothing was sent. Fix its permissions, then run the command again.`,
    };
  }
  let checked: SheetState | string;
  try {
    checked = stateFromJson(JSON.parse(text));
  } catch {
    checked = "it is not valid JSON";
  }
  if (typeof checked !== "string") return { state: checked, missing: false };
  return {
    problem: `The state file ${file} can't be read: ${checked}. Fix it, or move it away; without it the next run buys every step again, even the ones already bought.`,
  };
}

function sourceStateOf(state: SheetState, item: SheetSource): SheetSourceState {
  const saved = state.sources[item.key];
  if (saved && saved.kind === item.source.kind) return saved;
  // A saved entry of another kind (a link where a file was) starts again.
  const fresh: SheetSourceState = { kind: item.source.kind, breakdownId: null, templateDone: false, pending: null, lastError: null, updatedAt: null, writes: dict() };
  state.sources[item.key] = fresh;
  return fresh;
}

function writeStateOf(source: SheetSourceState, persona: SheetPersona | null): SheetWriteState {
  const key = personaKey(persona);
  source.writes[key] ??= { swipeId: null, writtenWith: null, refused: null, pending: null, lastError: null, updatedAt: null, runs: dict() };
  return source.writes[key];
}

function runStateOf(write: SheetWriteState, character: SheetCharacter): SheetRunState {
  const key = String(character.index);
  write.runs[key] ??= { runId: null, watch: null, pending: null, lastError: null, updatedAt: null };
  return write.runs[key];
}

/** Reads a video's states without adding them to the file. */
function peekVideo(state: SheetState, video: SheetVideo) {
  const source = state.sources[video.source.key];
  const src = source && source.kind === video.source.source.kind ? source : null;
  const write = src?.writes[personaKey(video.persona)] ?? null;
  const run = write?.runs[String(video.character.index)] ?? null;
  return { src, write, run };
}

/** Every run id and every swipe id the state holds, so one is never taken for a second video or persona. */
function heldIds(state: SheetState): { runs: Map<string, SheetRunState>; swipes: Set<string> } {
  const runs = new Map<string, SheetRunState>();
  const swipes = new Set<string>();
  for (const src of Object.values(state.sources)) {
    for (const write of Object.values(src.writes)) {
      if (write.swipeId) swipes.add(write.swipeId);
      for (const run of Object.values(write.runs)) if (run.runId) runs.set(run.runId, run);
    }
  }
  return { runs, swipes };
}

// ── Shared pieces of the sheet's steps ──

type SwipeProduct = { id: string; name: string; description?: string };

function productsOf(data: unknown): SwipeProduct[] {
  return isRecord(data) && Array.isArray(data.products) ? (data.products as SwipeProduct[]) : [];
}

/** The sheet's product, checked against the brand's list; with none named, the brand's only product. */
async function sheetProduct(sheet: SwipeSheet, deps: VideoDeps): Promise<{ product: SwipeProduct; picked: boolean } | { problem: string }> {
  const res = await deps.get(SWIPE_PRODUCTS_PATH);
  if (!res.ok) return { problem: swipeErrorLine(res) };
  const products = productsOf(res.data);
  if (sheet.productId) {
    const product = products.find((row) => row.id === sheet.productId);
    if (!product) return { problem: `The sheet's product ${sheet.productId} is not one of this brand's products. exodus video swipe products lists them.` };
    return { product, picked: false };
  }
  if (products.length === 0) return { problem: "This brand has no products yet. Add one in the dashboard first." };
  if (products.length > 1) {
    return { problem: `The sheet names no product, and this brand has ${products.length}. Put one in "product": exodus video swipe products lists them.` };
  }
  return { product: products[0], picked: true };
}

/** The one JSON line a verb's flow answers with --json. */
function answerOf(result: FlowResult): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(result.lines[0] ?? "");
    return isRecord(data) ? data : {};
  } catch {
    return {};
  }
}

const errorOf = (answer: Record<string, unknown>) =>
  [answer.error, answer.mayStillFinish].filter((part): part is string => typeof part === "string").join(" ") || "The server's answer could not be read.";

/**
 * The server refused the paid ask itself with a 4xx, so nothing of it runs on and a rerun may ask again. Callers use it
 * only while no job was named: once the server named a job the ask was taken and is paid, and any answer to a read
 * that follows it (the job, the list, the swipe), whatever its status, leaves the ask marked as sent.
 * The swipe routes answer any error they catch with a 400 too (swipeRouteFailure), not only a refusal. That is still
 * safe: the template and write answer only after scheduling their job; the start links its run to the swipe
 * (linkRun) before it queues the paid worker (startScriptRun), so a start that made a paid run is found on the swipe.
 */
const postRefused = (answer: Record<string, unknown>) =>
  typeof answer.status === "number" && answer.status >= 400 && answer.status < 500 && answer.mayStillFinish === undefined;

const minutesAgo = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
};

// ── Without --yes: the plan ──

interface PlannedStep {
  step: SheetStep;
  /** The write's persona, and the start's video. */
  persona?: string | null;
  video?: number;
  buy: boolean;
  buys: string;
  paidBy: string;
  /** The id this step already has, when it is not bought again. */
  have?: string;
  note?: string;
}

/** What a run of the sheet would buy for one ad's videos, from the state and the free reads only. */
async function plannedSteps(
  item: SheetSource,
  videos: SheetVideo[],
  state: SheetState,
  sheet: SwipeSheet,
  productId: string,
  retryRefused: boolean,
  deps: VideoDeps,
): Promise<PlannedStep[]> {
  const startKey: PaidStep = sheet.start.oneShot ? "start-one-shot" : "start";
  const paid = (step: SheetStep, key: PaidStep, extra: Partial<PlannedStep> = {}): PlannedStep => ({ step, ...extra, buy: true, ...PAID[key] });
  const kept = (step: SheetStep, key: PaidStep, have: string | null, note: string, extra: Partial<PlannedStep> = {}): PlannedStep => ({
    step,
    ...extra,
    buy: false,
    ...PAID[key],
    ...(have ? { have } : {}),
    note,
  });
  const src = peekVideo(state, videos[0]).src;
  const allStarted = videos.every((video) => peekVideo(state, video).run?.runId);
  let breakdownId = src?.breakdownId ?? null;
  let breakdownNote = "Read before. It costs nothing again.";
  let templateDone = src?.templateDone ?? false;
  if (!templateDone && !allStarted) {
    if (!breakdownId && item.source.kind === "url") {
      const earlier = await deps.get(`${SWIPE_BREAKDOWNS_PATH}?url=${encodeURIComponent(item.source.url)}`);
      const found = earlier.ok && isRecord(earlier.data) && isRecord(earlier.data.earlier) ? earlier.data.earlier.breakdownId : undefined;
      if (typeof found === "string") {
        breakdownId = found;
        breakdownNote = "This brand broke this link down before. It costs nothing again.";
      }
    }
    if (breakdownId) {
      const res = await deps.get(`${SWIPE_BREAKDOWNS_PATH}?id=${encodeURIComponent(breakdownId)}`);
      const read = res.ok ? breakdownReadOf(res.data) : null;
      if (read?.breakdown.status === "failed") breakdownId = null;
      else if (read && read.breakdown.status !== "done") breakdownNote = "Still being read. Nothing more is bought for it.";
      if (read?.template) templateDone = true;
    }
  }
  const steps: PlannedStep[] = [
    breakdownId || templateDone ? kept("breakdown", "breakdown", breakdownId, breakdownNote) : paid("breakdown", "breakdown"),
    templateDone ? kept("template", "template", null, "Made before. It costs nothing again.") : paid("template", "template"),
  ];
  const personas = [...new Set(videos.map((video) => video.persona))];
  for (const persona of personas) {
    const who = { persona: persona?.name ?? null };
    const write = src?.writes[personaKey(persona)] ?? null;
    const own = videos.filter((video) => video.persona === persona);
    const starts = own.map((video): PlannedStep => {
      const run = peekVideo(state, video).run;
      if (run?.runId) return kept("start", startKey, run.runId, `Started before: run ${run.runId}. Nothing is sent again.`, { video: video.n });
      return paid("start", startKey, {
        video: video.n,
        ...(run?.pending
          ? { note: `A start was sent before and its answer was not seen. The run reads swipe ${run.pending.swipeId} first and starts nothing if it has a run, or if the start may still be going.` }
          : {}),
      });
    });
    if (own.every((video) => peekVideo(state, video).run?.runId)) {
      steps.push(kept("write", "write", write?.swipeId ?? null, "Written before.", who), ...starts);
      continue;
    }
    // A sheet changed since an earlier write, refused or not, writes again; an unchanged refusal waits for --retry-refused.
    const changes = write?.swipeId && write.writtenWith ? changesSince(write.writtenWith, writtenWithOf(writeOf(sheet, persona), productId)) : [];
    if (write?.swipeId && changes.length > 0) {
      const was = write.refused !== null ? "refused" : "written";
      steps.push(paid("write", "write", { ...who, note: `The sheet changed since swipe ${write.swipeId} was ${was} (${changes.join("; ")}), so it is written again.` }));
    } else if (write?.swipeId && write.refused !== null) {
      if (!retryRefused) {
        steps.push(
          kept("write", "write", write.swipeId, `The writer refused it before: ${write.refused} Nothing is written again without --retry-refused.`, who),
          ...own.map((video) => kept("start", startKey, null, "Nothing to start: the write was refused.", { video: video.n })),
        );
        continue;
      }
      steps.push(paid("write", "write", { ...who, note: `The writer refused it before: ${write.refused} --retry-refused writes it again.` }));
    } else if (write?.swipeId) {
      steps.push(kept("write", "write", write.swipeId, "Written before. It costs nothing again.", who));
    } else {
      steps.push(
        paid("write", "write", {
          ...who,
          ...(write?.pending
            ? {
                note:
                  write.pending.asked && changesSince(write.pending.asked, writtenWithOf(writeOf(sheet, persona), productId)).length > 0
                    ? `A write was sent before with the earlier choices (${changesSince(write.pending.asked, writtenWithOf(writeOf(sheet, persona), productId)).join("; ")}). Its swipe is never used. ${
                        write.pending.job
                          ? "Once its job has ended the sheet's choices now are written; while it is still writing, the run stops and writes nothing."
                          : "The sheet's choices now are written once 15 minutes have passed since it was sent; before that, the run stops and writes nothing."
                      }`
                    : "A write was sent before and its end was not seen. The run looks for it first and writes again only when it proves none was made, or finds no trace of it after 15 minutes.",
              }
            : {}),
        }),
      );
    }
    steps.push(...starts);
  }
  return steps;
}

function plannedLines(steps: PlannedStep[]): string[] {
  return steps.flatMap((step) => {
    const name =
      step.step === "write"
        ? `Write${step.persona ? ` for ${step.persona}` : ""}`
        : step.step === "start"
          ? `Start of video ${step.video}`
          : STEP_WORD[step.step];
    if (!step.buy) return [`  ${name}${step.have ? ` (${step.have})` : ""}: ${step.note}`];
    return [`  ${name}. It buys: ${step.buys}`, `    Who pays: ${step.paidBy}`, ...(step.note ? [`    ${step.note}`] : [])];
  });
}

const STEP_WORD: Record<SheetStep, string> = { breakdown: "Breakdown", template: "Template", write: "Write", start: "Start" };

// ── With --yes: the steps ──

interface VideoOutcome {
  video: SheetVideo;
  runId: string | null;
  watch: string | null;
  refused: string | null;
  stopped: { step: SheetStep; why: string } | null;
  waited?: unknown;
}

interface SheetContext {
  sheet: SwipeSheet;
  sheetFile: string;
  state: SheetState;
  productId: string;
  retryRefused: boolean;
  /** Writes the state file. Each step calls it as soon as it ends. Throws StateNotSaved when it can't. */
  save: () => void;
  say: (line: string) => void;
  deps: VideoDeps;
}

/** The state file could not be saved mid-run. Nothing catches it on the way out: the run stops there. */
class StateNotSaved extends Error {}

const stamp = (deps: VideoDeps) => new Date(deps.now()).toISOString();

/**
 * How long a start, sent and not seen to answer, may still be starting. The start runs `startScriptRun` inside the
 * request (convex/http.ts swipe-runs), and the swipe names its run (`linkRun`) only after the voice checks. Convex
 * stops an action after 30 minutes in its own runtime and 10 in Node (docs.convex.dev/production/state/limits, as
 * quoted in docs/vendors/convex.md on 2026-10-01). 35 minutes is past both, so a start with no run by then made none.
 */
const START_PENDING_MS = 35 * 60 * 1000;
/** The server's clock and this one may differ a little; a swipe stored this long before a write was sent still counts. */
const CLOCK_SLACK_MS = 60 * 1000;

/** One ad's paid steps, in order: its breakdown and template, then each persona's write, then each video's start. */
async function runSheetSource(item: SheetSource, videos: SheetVideo[], ctx: SheetContext): Promise<VideoOutcome[]> {
  const { sheet, state, save, say, deps } = ctx;
  const src = sourceStateOf(state, item);
  const outcomes = new Map<SheetVideo, VideoOutcome>(
    videos.map((video) => [video, { video, runId: null, watch: null, refused: null, stopped: null }]),
  );
  const stopAll = (step: SheetStep, why: string, among: SheetVideo[], who = "") => {
    say(`  ${who}Stopped at the ${step}: ${why}`);
    for (const video of among) outcomes.get(video)!.stopped = { step, why };
  };
  const touch = (row: { updatedAt: string | null }) => {
    row.updatedAt = stamp(deps);
    save();
  };
  const ageOf = (pending: { at: string } | null) => (pending ? deps.now() - Date.parse(pending.at) : 0);
  const unreachable = (err: unknown) => {
    // A state file that can't be saved is not the server's fault, and the run must not go on past it.
    if (err instanceof StateNotSaved) throw err;
    return `The server could not be reached: ${describeFetchFailure(err)}. Run the sheet again to go on where it stopped.`;
  };
  const done = () => [...outcomes.values()];

  // Videos started before are not touched again.
  const toRun = videos.filter((video) => {
    const run = runStateOf(writeStateOf(src, video.persona), video.character);
    if (!run.runId) return true;
    Object.assign(outcomes.get(video)!, { runId: run.runId, watch: run.watch });
    say(`  Video ${video.n}: started before, run ${run.runId}. Nothing was sent.`);
    return false;
  });
  if (toRun.length === 0) return done();

  // The breakdown, and the template it may already have.
  let step: SheetStep = "breakdown";
  const stopSource = (why: string) => {
    src.lastError = why;
    touch(src);
    stopAll(step, why, toRun);
    return done();
  };
  try {
    if (!src.templateDone) {
      if (!src.breakdownId) {
        if (src.pending?.step === "breakdown") {
          // Only a file's breakdown is marked: the server finds a link's or an ad's again for nothing. No free read
          // finds a file's breakdown, so it is not bought again unasked.
          return stopSource(
            `This file's breakdown was asked for ${minutesAgo(ageOf(src.pending))} ago and its answer was not seen, so the file may already be read. Reading it again is paid: to do it anyway, take this ad's entry out of ${sheetStatePath(ctx.sheetFile)}.`,
          );
        }
        // A file is marked only once its free upload is done and the paid breakdown is about to be asked for; a link
        // or an ad needs no mark.
        let marked = false;
        const beforePaidAsk = () => {
          src.pending = { step: "breakdown", at: stamp(deps) };
          marked = true;
          touch(src);
        };
        const started = answerOf(await swipeBreakdownFlow(item.source, { json: true, yes: true, wait: false, beforePaidAsk }, deps));
        if (started.ok !== true || typeof started.breakdownId !== "string") {
          if (marked && postRefused(started)) src.pending = null;
          return stopSource(errorOf(started));
        }
        src.breakdownId = started.breakdownId;
        src.pending = null;
        touch(src);
        say(
          started.existing === true
            ? `  This ad already has a breakdown: ${src.breakdownId}. It cost nothing.`
            : `  Breakdown ${src.breakdownId} started. It reads the ad on the team's keys, in a few minutes.`,
        );
      } else {
        say(`  Breakdown ${src.breakdownId}, from before.`);
      }
      const breakdownId = src.breakdownId;
      const waited = await waitForBreakdown(breakdownId, { json: true, yes: true, wait: true }, deps, (line) => say(`  ${line}`));
      const breakdown = isRecord(waited.json.breakdown) ? (waited.json.breakdown as unknown as SwipeBreakdown) : null;
      if (breakdown?.status === "failed") {
        // A failed breakdown is not kept: running the sheet again reads the ad again, which is paid.
        src.breakdownId = null;
        return stopSource(`The breakdown failed: ${breakdown.error ?? "no reason was given."} Reading the ad again is paid too.`);
      }
      if (waited.code !== 0 || breakdown?.status !== "done") return stopSource(waited.lines.join(" "));
      say("  The breakdown is done.");
      for (const line of spentLines(breakdown)) say(`  ${line}`);

      step = "template";
      let template = isRecord(waited.json.template) ? (waited.json.template as unknown as SwipeTemplateView) : null;
      if (!template && src.pending?.step === "template") {
        const pending = src.pending;
        if (pending.job) {
          // The job the server named says what became of the template asked for before.
          const res = await deps.get(`${SWIPE_TEMPLATE_PATH}?breakdownId=${encodeURIComponent(breakdownId)}&job=${encodeURIComponent(pending.job)}`);
          const answer = res.ok && isRecord(res.data) ? res.data : null;
          if (!answer) {
            return stopSource(
              `The template asked for ${minutesAgo(ageOf(pending))} ago could not be checked: ${res.ok ? "its answer could not be read" : swipeErrorLine(res)}. Nothing was sent again.${res.status === 404 ? goneJob(`sources[${JSON.stringify(item.key)}].pending`, ctx.sheetFile, "makes the template again") : ""}`,
            );
          }
          if (answer.status === "stored" && isRecord(answer.template)) template = answer.template as unknown as SwipeTemplateView;
          else if (answer.status === "making") {
            return stopSource("The template asked for before is still being made, so nothing was sent again. Run the sheet again in a few minutes.");
          } else if (answer.status !== "failed") {
            return stopSource("The template asked for before could not be checked, so nothing was sent again.");
          }
        } else if (ageOf(pending) < TEMPLATE_MAX_POLLS * POLL_MS) {
          return stopSource(
            `The template was asked for ${minutesAgo(ageOf(pending))} ago and its answer was not seen. It may still be being made, so nothing was sent again. Run the sheet again in a few minutes.`,
          );
        } else {
          say(`  No trace of the template asked for ${minutesAgo(ageOf(pending))} ago was found, so it is made again.`);
        }
      }
      if (template) {
        src.templateDone = true;
        src.pending = null;
        src.lastError = null;
        touch(src);
        say(`  ${templateKindLine(template, sheet.kind)} Look: ${template.look.label}. The template was made before, so it cost nothing.`);
        for (const line of sheetOfferedLines(template, sheet)) say(line);
      } else {
        const at = stamp(deps);
        src.pending = { step: "template", at };
        touch(src);
        say("  Making the template on the member's key. It takes up to six minutes.");
        let jobNamed = false;
        const onJob = (job: string) => {
          src.pending = { step: "template", at, job };
          jobNamed = true;
          touch(src);
        };
        const made = answerOf(await swipeTemplateFlow(breakdownId, { json: true, yes: true, wait: false, onJob }, deps));
        if (made.ok !== true || !isRecord(made.template)) {
          if (!jobNamed && postRefused(made)) src.pending = null;
          return stopSource(errorOf(made));
        }
        const view = made.template as unknown as SwipeTemplateView;
        src.templateDone = true;
        src.pending = null;
        src.lastError = null;
        touch(src);
        say(`  ${templateKindLine(view, sheet.kind)} Look: ${view.look.label}.`);
        for (const line of sheetOfferedLines(view, sheet)) say(line);
      }
    }
  } catch (err) {
    return stopSource(unreachable(err));
  }

  const breakdownId = src.breakdownId!;
  for (const persona of [...new Set(toRun.map((video) => video.persona))]) {
    const own = toRun.filter((video) => video.persona === persona);
    const who = persona ? `${persona.name}: ` : "";
    const write = writeStateOf(src, persona);

    // A video whose start was sent and not seen to answer is settled first: it may already be a video, and then no
    // write and no start is bought for it, even when the sheet changed since.
    const open: SheetVideo[] = [];
    for (const video of own) {
      const run = runStateOf(write, video.character);
      if (!run.pending) {
        open.push(video);
        continue;
      }
      const settled = await settlePendingStart(video, run, outcomes.get(video)!, ctx).catch((err: unknown) => {
        stopRun(video, run, outcomes.get(video)!, unreachable(err), ctx);
        return "stopped" as const;
      });
      if (settled === "clear") open.push(video);
    }
    if (open.length === 0) continue;

    const sheetWrite = writeOf(sheet, persona);
    const writtenWith = writtenWithOf(sheetWrite, ctx.productId);
    const stopWrite = (why: string) => {
      write.lastError = why;
      touch(write);
      stopAll("write", why, open, who);
    };
    let swipeId: string;
    try {
      // The write, once for this ad and persona. A sheet changed since an earlier write, refused or not, writes again.
      const changes = write.swipeId && write.writtenWith ? changesSince(write.writtenWith, writtenWith) : [];
      if (write.swipeId && write.refused !== null && changes.length === 0 && !ctx.retryRefused) {
        for (const video of open) outcomes.get(video)!.refused = write.refused;
        stopWrite(`The writer refused it before: ${write.refused} (swipe ${write.swipeId}). Nothing was written again; --retry-refused writes it again, which is paid.`);
        continue;
      }
      if (write.swipeId && write.refused === null && changes.length === 0) {
        swipeId = write.swipeId;
        say(`  ${who}Swipe ${swipeId}, written before.`);
      } else {
        if (changes.length > 0) {
          say(`  ${who}The sheet changed since swipe ${write.swipeId} was ${write.refused !== null ? "refused" : "written"} (${changes.join("; ")}), so it is written again.`);
        } else if (write.swipeId && write.refused !== null) {
          say(`  ${who}The writer refused it before. Writing it again (--retry-refused).`);
        }
        let swipe: SwipeView | null = null;
        // What the swipe was really written with, kept as its writtenWith.
        let truth = writtenWith;
        if (write.pending) {
          const entry = `sources[${JSON.stringify(item.key)}].writes[${JSON.stringify(personaKey(persona))}].pending`;
          const found = await findPendingWrite(write.pending, breakdownId, writtenWith, ctx, who, entry);
          if ("stop" in found) {
            stopWrite(found.stop);
            continue;
          }
          if (found.taken) {
            swipe = found.taken.swipe;
            truth = found.taken.writtenWith;
            say(`  ${who}The write sent before has ended: swipe ${swipe._id}.`);
          }
        }
        if (!swipe) {
          const at = stamp(deps);
          write.pending = { at, asked: writtenWith };
          touch(write);
          say(`  ${who}Writing the brand's version on the member's key. It takes four to nine minutes.`);
          let jobNamed = false;
          const onJob = (job: string) => {
            write.pending = { at, job, asked: writtenWith };
            jobNamed = true;
            touch(write);
          };
          const wrote = answerOf(
            // A sheet run makes no people with its writes (COP-289): no figure, and no read of their price.
            await swipeWriteFlow(breakdownId, { productId: ctx.productId, ...sheetWrite.ask, noPeople: true }, { json: true, yes: true, wait: false, onJob }, deps),
          );
          if (!isRecord(wrote.swipe)) {
            if (!jobNamed && postRefused(wrote)) write.pending = null;
            stopWrite(errorOf(wrote));
            continue;
          }
          swipe = wrote.swipe as unknown as SwipeView;
        }
        write.pending = null;
        write.swipeId = swipe._id;
        // The kind as the swipe itself keeps it; a write that asked for one and lost it has stopped above.
        const recorded: WrittenWith = { ...truth };
        delete recorded.kind;
        if (typeof swipe.kind === "string") recorded.kind = swipe.kind;
        write.writtenWith = recorded;
        if (swipe.outcome.kind === "refused") {
          write.refused = swipe.outcome.why;
          for (const video of open) outcomes.get(video)!.refused = write.refused;
          stopWrite(`The writer refused: ${swipe.outcome.why} (swipe ${swipe._id}). ${costLine(swipe)}`);
          continue;
        }
        write.refused = null;
        write.lastError = null;
        touch(write);
        swipeId = swipe._id;
        say(`  ${who}Swipe ${swipeId} written. ${costLine(swipe)}`);
      }
    } catch (err) {
      stopWrite(unreachable(err));
      continue;
    }

    // One start per video of this persona, each reusing its swipe.
    for (const video of open) {
      const run = runStateOf(write, video.character);
      await startVideo(video, run, swipeId, outcomes.get(video)!, ctx).catch((err: unknown) =>
        stopRun(video, run, outcomes.get(video)!, unreachable(err), ctx),
      );
    }
  }
  return done();
}

function stopRun(video: SheetVideo, run: SheetRunState, outcome: VideoOutcome, why: string, ctx: SheetContext) {
  run.lastError = why;
  run.updatedAt = stamp(ctx.deps);
  ctx.save();
  ctx.say(`  Video ${video.n}: stopped at the start: ${why}`);
  outcome.stopped = { step: "start", why };
}

function takeRun(video: SheetVideo, run: SheetRunState, outcome: VideoOutcome, runId: string, watch: string | null, ctx: SheetContext) {
  Object.assign(run, { runId, watch, pending: null, lastError: null, updatedAt: stamp(ctx.deps) });
  ctx.save();
  Object.assign(outcome, { runId, watch });
}

/**
 * A run taken from its swipe may be one the server made and then failed to queue: every rerun would take it again.
 * That is said, with the command that starts the swipe again by hand. A read that fails adds nothing.
 */
async function sayIfFailedAtStart(video: SheetVideo, runId: string, swipeId: string, ctx: SheetContext) {
  const res = await ctx.deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`).catch(() => null);
  if (!res?.ok || runStateWord(res.data) !== "failed") return;
  ctx.say(`  Video ${video.n}: run ${runId} failed at its start. To start this swipe again by hand (paid): exodus video swipe start ${swipeId} --yes`);
}

/**
 * The swipe as the server has it now, with the server's clock when it says it (older servers don't), or the sentence
 * saying why it could not be read.
 */
async function readSwipe(swipeId: string, deps: VideoDeps): Promise<{ swipe: SwipeView; serverNow: number | null } | { problem: string }> {
  const res = await deps.get(`${SWIPES_PATH}?id=${encodeURIComponent(swipeId)}`);
  if (!res.ok) return { problem: swipeErrorLine(res) };
  if (!isRecord(res.data) || !isRecord(res.data.swipe)) return { problem: "Its answer could not be read." };
  const now = res.data.now;
  return { swipe: res.data.swipe as unknown as SwipeView, serverNow: typeof now === "number" && Number.isFinite(now) ? now : null };
}

/**
 * How long ago a start was sent. This machine's clock can jump forward (a laptop waking, a time correction) and make a
 * young start look old, so when the server told its own time at the send and again now, the smaller of the two counts.
 */
function startAge(pending: StartPending, serverNow: number | null, deps: VideoDeps): number {
  const local = deps.now() - Date.parse(pending.at);
  return pending.serverAt !== undefined && serverNow !== null ? Math.min(local, serverNow - pending.serverAt) : local;
}

/**
 * A start that was sent and not seen to answer. The swipe that start was for is read first. A run on it is this
 * video's run. A swipe that can't be read, or a start still young, stops the video. Only an old start that left no
 * run is cleared, and the video goes on. A server that refuses a second start of a swipe (#4315) would refuse it
 * anyway, and the start that follows takes the run it names; this wait is for a server from before that.
 */
async function settlePendingStart(video: SheetVideo, run: SheetRunState, outcome: VideoOutcome, ctx: SheetContext): Promise<"taken" | "stopped" | "clear"> {
  const pending = run.pending!;
  const read = await readSwipe(pending.swipeId, ctx.deps);
  const ago = minutesAgo(startAge(pending, "problem" in read ? null : read.serverNow, ctx.deps));
  if ("problem" in read) {
    stopRun(video, run, outcome, `A start was sent ${ago} ago and its answer was not seen, and swipe ${pending.swipeId} could not be read to check it: ${read.problem} Nothing was sent again.`, ctx);
    return "stopped";
  }
  const runId = read.swipe.workflowRunId;
  if (runId) {
    const holder = heldIds(ctx.state).runs.get(runId);
    if (holder && holder !== run) {
      stopRun(video, run, outcome, `Swipe ${pending.swipeId} has run ${runId}, which is another video's in this sheet. One swipe is one video, so nothing was sent.`, ctx);
      return "stopped";
    }
    takeRun(video, run, outcome, runId, null, ctx);
    ctx.say(`  Video ${video.n}: the start sent ${ago} ago went through: run ${runId}, from swipe ${pending.swipeId}. Nothing was sent again. Check it: exodus video status ${runId}`);
    await sayIfFailedAtStart(video, runId, pending.swipeId, ctx);
    return "taken";
  }
  if (startAge(pending, read.serverNow, ctx.deps) < START_PENDING_MS) {
    stopRun(video, run, outcome, `A start was sent ${ago} ago and its answer was not seen. It may still be starting, so nothing was sent again. Run the sheet again in a few minutes.`, ctx);
    return "stopped";
  }
  run.pending = null;
  ctx.save();
  return "clear";
}

/**
 * One video's start. The swipe is read first, every time: a swipe that already has a run (started by a start whose
 * answer was lost, or from another door) gives that run to this video, and nothing is sent. One swipe is one video.
 */
async function startVideo(video: SheetVideo, run: SheetRunState, swipeId: string, outcome: VideoOutcome, ctx: SheetContext) {
  const read = await readSwipe(swipeId, ctx.deps);
  if ("problem" in read) {
    stopRun(video, run, outcome, `Swipe ${swipeId} could not be read to check it has no run yet: ${read.problem} Nothing was sent.`, ctx);
    return;
  }
  const existing = read.swipe.workflowRunId;
  if (existing) {
    const holder = heldIds(ctx.state).runs.get(existing);
    if (holder && holder !== run) {
      stopRun(video, run, outcome, `Swipe ${swipeId} already has run ${existing}, which is another video's in this sheet. One swipe is one video, so nothing was sent.`, ctx);
      return;
    }
    takeRun(video, run, outcome, existing, null, ctx);
    ctx.say(`  Video ${video.n}: swipe ${swipeId} already has run ${existing}; it is this video's run. Nothing was sent. Check it: exodus video status ${existing}`);
    await sayIfFailedAtStart(video, existing, swipeId, ctx);
    return;
  }
  run.pending = { at: stamp(ctx.deps), swipeId, ...(read.serverNow !== null ? { serverAt: read.serverNow } : {}) };
  run.updatedAt = stamp(ctx.deps);
  ctx.save();
  // Today every video runs with its own cast. When a swiped run takes characters, video.character.pick goes here.
  // Never with `again`: one swipe is one video, and the server refuses a second start of it.
  const started = answerOf(await swipeStartFlow(swipeId, ctx.sheet.start, { json: true, yes: true, wait: false }, ctx.deps));
  const held = isRecord(started.alreadyStarted) && typeof started.alreadyStarted.runId === "string" ? started.alreadyStarted : null;
  if (held) {
    // The swipe got its video between the read above and this start (another door, a start whose answer was lost).
    const heldRunId = held.runId as string;
    const holder = heldIds(ctx.state).runs.get(heldRunId);
    if (holder && holder !== run) {
      stopRun(video, run, outcome, `Swipe ${swipeId} already has run ${heldRunId}, which is another video's in this sheet. One swipe is one video, so nothing was sent again.`, ctx);
      return;
    }
    takeRun(video, run, outcome, heldRunId, typeof held.url === "string" && held.url ? held.url : null, ctx);
    ctx.say(`  Video ${video.n}: swipe ${swipeId} already has run ${heldRunId}; it is this video's run. Nothing more was started. Check it: exodus video status ${heldRunId}`);
    return;
  }
  if (started.ok !== true || typeof started.runId !== "string") {
    if (postRefused(started)) run.pending = null;
    stopRun(video, run, outcome, errorOf(started), ctx);
    return;
  }
  takeRun(video, run, outcome, started.runId, typeof started.url === "string" && started.url ? started.url : null, ctx);
  ctx.say(`  Video ${video.n}: started ad run ${started.runId}. Watch it: ${outcome.watch ?? `exodus video status ${started.runId}`}`);
}

/**
 * A job the server no longer finds may never be found again (its record is gone, or this is another member's key):
 * the sentence says which mark to take out of the state file, and that the next run then buys the step again.
 */
const goneJob = (entry: string, sheetFile: string, again: string) =>
  ` If it stays not found, remove ${entry} from ${sheetStatePath(sheetFile)}; the next run then ${again}, which is paid.`;

/**
 * What a swipe's own row says it was written with. A their-format swipe's request carries the script as it was sent
 * (convex/videoSwipes.ts swipeView), so its fingerprint is the script's own; a row without it reads as unknown (null).
 */
function writtenWithOfSwipe(swipe: SwipeView): WrittenWith {
  const mode = swipe.request.mode;
  const script = swipe.request.memberScript;
  return {
    productId: swipe.productId,
    mode,
    closeness: mode === "their-format" ? null : (swipe.request.closeness ?? null),
    look: swipe.request.look ?? null,
    scriptSha256: mode === "their-format" && typeof script === "string" ? sha256Of(script) : null,
    ...(typeof swipe.kind === "string" ? { kind: swipe.kind } : {}),
  };
}

/**
 * A write sent before whose end was not seen. With its job, the server says exactly what became of it; the swipe it
 * made is taken only when its own request, script included, is what the sheet asks now.
 * Otherwise it was written with the earlier choices: it is said, not taken, and the new choices are written. Without a
 * job (the CLI was stopped before the server answered), only a swipe of this breakdown with the same request, stored
 * after the write was sent and held by no other write of the sheet, is taken; never for their-format, whose script a
 * listed swipe can't prove. Any read that fails stops. Only a failed job, or an old write that left no trace, writes
 * again.
 */
async function findPendingWrite(
  pending: WritePending,
  breakdownId: string,
  want: WrittenWith,
  ctx: SheetContext,
  who: string,
  /** Where this write's mark sits in the state file, for the sentence that says how to let it go. */
  entry: string,
): Promise<{ taken: { swipe: SwipeView; writtenWith: WrittenWith } | null } | { stop: string }> {
  const { deps } = ctx;
  const ago = minutesAgo(deps.now() - Date.parse(pending.at));
  if (pending.job) {
    const res = await deps.get(`${SWIPES_PATH}?job=${encodeURIComponent(pending.job)}`);
    const answer = res.ok && isRecord(res.data) ? res.data : null;
    if (!answer) {
      return {
        stop: `The write sent ${ago} ago could not be checked: ${res.ok ? "its answer could not be read" : swipeErrorLine(res)}. Nothing was sent again.${res.status === 404 ? goneJob(entry, ctx.sheetFile, "writes it again") : ""}`,
      };
    }
    if (answer.status === "done" && isRecord(answer.swipe)) {
      const swipe = answer.swipe as unknown as SwipeView;
      // A server that dropped the kind the sheet still asks for: never the member's earlier choice, never bought
      // again. Once the sheet names another kind, or none, the swipe is judged by the sheet's choices now.
      const sameKind = (want.kind ?? null) === (pending.asked?.kind ?? null);
      const dropped = sameKind ? kindDropped(swipe, pending.asked?.kind) : null;
      if (dropped) return { stop: dropped };
      // Compared and recorded from the swipe's own request, script included: never from what this CLI meant to send.
      const truth = writtenWithOfSwipe(swipe);
      const scriptKnown = truth.mode !== "their-format" || truth.scriptSha256 !== null;
      const changes = changesSince(truth, want);
      if (scriptKnown && changes.length === 0) return { taken: { swipe, writtenWith: truth } };
      ctx.say(
        `  ${who}The write sent ${ago} ago ended as swipe ${swipe._id}, written with the earlier choices (${changes.join("; ") || "a script that can't be checked"}). It is not used; the sheet's choices now are written.`,
      );
      return { taken: null };
    }
    if (answer.status === "writing") return { stop: "The write sent before is still writing, so nothing was sent again. Run the sheet again in a few minutes." };
    if (answer.status === "failed") {
      ctx.say(`  ${who}The write sent before stopped without a swipe: ${typeof answer.error === "string" ? answer.error : "no reason was given."}`);
      return { taken: null };
    }
    return { stop: "The write sent before could not be checked, so nothing was sent again." };
  }
  if (want.mode !== "their-format") {
    const listed = await deps.get(SWIPES_PATH);
    if (!listed.ok) return { stop: `The write sent ${ago} ago could not be looked for: ${swipeErrorLine(listed)} Nothing was sent again.` };
    const rows = isRecord(listed.data) && Array.isArray(listed.data.swipes) ? (listed.data.swipes as SwipeListRow[]) : [];
    const since = Date.parse(pending.at) - CLOCK_SLACK_MS;
    const held = heldIds(ctx.state).swipes;
    const matching = rows
      .filter((row) => typeof row.createdAt === "number" && row.createdAt >= since && !held.has(row._id))
      .filter((row) => row.breakdownId === breakdownId && row.request.mode === want.mode)
      .filter((row) => want.closeness === null || row.request.closeness === want.closeness)
      .slice(0, 3);
    for (const row of matching) {
      const read = await readSwipe(row._id, deps);
      if ("problem" in read) return { stop: `Swipe ${row._id} could not be read to check it is the write sent before: ${read.problem} Nothing was sent again.` };
      if (read.swipe.productId === want.productId && (read.swipe.request.look ?? null) === want.look && (read.swipe.kind ?? null) === (want.kind ?? null)) {
        return { taken: { swipe: read.swipe, writtenWith: writtenWithOfSwipe(read.swipe) } };
      }
    }
  }
  if (deps.now() - Date.parse(pending.at) < WRITE_MAX_POLLS * POLL_MS) {
    return { stop: `A write was sent ${ago} ago and its end was not seen. It may still be writing, so nothing was sent again. Run the sheet again in a few minutes.` };
  }
  // The brand's list holds its newest swipes only, and this clock may run ahead of the server's: a write can leave no
  // trace that is found. Past the write's own deadline, one more write (cents) is bought rather than a stuck video.
  ctx.say(`  ${who}No trace of the write sent ${ago} ago was found, so it is written again.`);
  return { taken: null };
}

// ── --status ──

export type SheetVideoState =
  | "not started"
  | "breakdown"
  | "template"
  | "written"
  | "refused"
  | "running"
  | "storyboard"
  | "waiting"
  | "done"
  | "failed"
  | "unread";

/** Where a run stands, from either read of it: the admin run or a beta tester's customer view. */
function runStateWord(data: unknown): SheetVideoState {
  const customer = customerAnswer<CustomerRun>(data);
  if (customer) {
    if (customer.stage === "failed" || customer.stage === "cancelled") return "failed";
    if (customer.stage === "ready") return customer.awaitingSignOff ? "waiting" : "done";
    if (customer.stage === "review") return customer.awaitingSignOff ? "waiting" : "storyboard";
    return customerStageIsWorking(customer.stage) ? "running" : "waiting";
  }
  const run = asVideoRun(data);
  if (run.status === "failed" || run.status === "cancelled") return "failed";
  if (run.isTerminal) return "done";
  if (run.status === "awaiting-approval" || run.status === "awaiting-review") {
    const parked = run.nodes.find((node) => node.nodeId === run.pausedNodeId);
    return run.pauseReason === undefined && parked && ["scene-frames", "storyboard"].includes(parked.kind) ? "storyboard" : "waiting";
  }
  return "running";
}

const STATE_SENTENCE: Record<SheetVideoState, string> = {
  "not started": "not started",
  breakdown: "the breakdown is not done yet",
  template: "the template is made; not written yet",
  written: "written; not started yet",
  refused: "refused",
  running: "running",
  storyboard: "at the storyboard, waiting for the member's yes",
  waiting: "waiting for the member",
  done: "done",
  failed: "failed",
  unread: "the run could not be read",
};

/**
 * A run's cost as the admin run read sends it (`costUsd` with `costScope`, convex/workflows.ts getRun): "so far"
 * while it goes on, final once it ends. A beta tester's customer view carries no cost, so it reads as none.
 */
function runCostOf(data: unknown): { usd: number; soFar: boolean } | null {
  if (customerAnswer<CustomerRun>(data) || !isRecord(data) || typeof data.costUsd !== "number") return null;
  return { usd: data.costUsd, soFar: data.costScope === "soFar" };
}

/** `--status`: each video's state from the state file and the server's free reads, with any cost the server reports. */
async function sheetStatusFlow(sheet: SwipeSheet, sheetFile: string, videos: SheetVideo[], personas: Array<SheetPersona | null>, state: SheetState, opts: SwipeOpts, deps: VideoDeps): Promise<FlowResult> {
  const swipes = new Map<string, SwipeView | null>();
  const swipeOf = async (swipeId: string) => {
    if (!swipes.has(swipeId)) {
      const res = await deps.get(`${SWIPES_PATH}?id=${encodeURIComponent(swipeId)}`);
      swipes.set(swipeId, res.ok && isRecord(res.data) && isRecord(res.data.swipe) ? (res.data.swipe as unknown as SwipeView) : null);
    }
    return swipes.get(swipeId) ?? null;
  };
  const breakdowns = new Map<string, BreakdownRead | null>();
  const breakdownOf = async (breakdownId: string) => {
    if (!breakdowns.has(breakdownId)) {
      const res = await deps.get(`${SWIPE_BREAKDOWNS_PATH}?id=${encodeURIComponent(breakdownId)}`);
      breakdowns.set(breakdownId, res.ok ? breakdownReadOf(res.data) : null);
    }
    return breakdowns.get(breakdownId) ?? null;
  };
  const rows = [];
  for (const video of videos) {
    const { src, write, run } = peekVideo(state, video);
    let word: SheetVideoState = "not started";
    let runCost: { usd: number; soFar: boolean } | null = null;
    let writeCostUsd: number | null = null;
    let note: string | null = null;
    if (run?.runId) {
      const res = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(run.runId)}`);
      if (res.ok) {
        word = runStateWord(res.data);
        runCost = runCostOf(res.data);
      } else {
        word = "unread";
        note = swipeErrorLine(res);
      }
    } else if (write?.swipeId && write.refused !== null) {
      word = "refused";
      note = `The writer refused: ${write.refused}`;
    } else if (write?.swipeId) {
      word = "written";
    } else if (src?.templateDone) {
      word = "template";
    } else if (src?.breakdownId) {
      const read = await breakdownOf(src.breakdownId);
      word = read?.template ? "template" : "breakdown";
      if (read && word === "breakdown") note = `Breakdown ${src.breakdownId}: ${STATUS_WORD[read.breakdown.status]}.`;
    }
    if (write?.swipeId) writeCostUsd = (await swipeOf(write.swipeId))?.costUsd ?? null;
    const lastError = run?.lastError ?? write?.lastError ?? src?.lastError ?? null;
    rows.push({ video, word, run, write, src, runCost, writeCostUsd, note, lastError });
  }
  if (opts.json) {
    return {
      code: 0,
      lines: [
        JSON.stringify({
          ok: true,
          sheet: sheetFile,
          state: sheetStatePath(sheetFile),
          videos: rows.map(({ video, word, run, write, src, runCost, writeCostUsd, lastError }) => ({
            n: video.n,
            source: video.source.given,
            persona: video.persona?.name ?? null,
            character: video.character.index,
            state: word,
            breakdownId: src?.breakdownId ?? null,
            swipeId: write?.swipeId ?? null,
            refused: write?.refused ?? null,
            runId: run?.runId ?? null,
            url: run?.watch ?? null,
            cost: { writeUsd: writeCostUsd, runUsd: runCost?.usd ?? null, runSoFar: runCost ? runCost.soFar : null },
            lastError,
          })),
        }),
      ],
    };
  }
  const lines = [`The sheet ${sheetFile}.`, videoListLines(sheet, videos, personas)[0].replace(/:$/, "."), ""];
  for (const { video, word, run, write, runCost, writeCostUsd, note, lastError } of rows) {
    lines.push(`${video.n}. ${videoLabel(video)}: ${STATE_SENTENCE[word]}.`);
    if (note) lines.push(`   ${note}`);
    if (run?.runId) lines.push(`   Run ${run.runId}. ${run.watch ? `Watch it: ${run.watch}` : `Check it: exodus video status ${run.runId}`}`);
    else if (write?.swipeId) lines.push(`   Swipe ${write.swipeId}.`);
    const costs = [
      ...(writeCostUsd !== null
        ? [`the write ${usd(writeCostUsd)} on the member's key${sheet.characters.length > 1 ? ", shared by this persona's videos of this ad" : ""}`]
        : []),
      ...(run?.runId && word !== "unread"
        ? [runCost ? `the run ${usd(runCost.usd)}${runCost.soFar ? " so far" : ""}` : "the run: not reported"]
        : []),
    ];
    if (costs.length > 0) lines.push(`   Cost: ${costs.join("; ")}.`);
    if (lastError && !run?.runId && word !== "refused") lines.push(`   Last error: ${lastError}`);
  }
  return { code: 0, lines };
}

// ── The command ──

export interface SheetFlowOptions extends SwipeRunOptions {
  retryRefused: boolean;
  status: boolean;
  persona: string | null;
}

/** `exodus video swipe run --sheet <file>`: the whole swipe from one sheet. */
export async function swipeSheetFlow(given: string, opts: SheetFlowOptions, deps: VideoDeps): Promise<FlowResult> {
  const { json } = opts;
  // A sheet that is itself a link is run as the file it links to, so two names for one sheet share one state file
  // and one lock. Any other path is kept as typed: a linked folder already leads to the same state file and lock.
  let sheetFile = given;
  try {
    const files = sheetFilesOf(deps);
    const real = files.realPath(given);
    if (real !== path.join(files.realPath(path.dirname(given)), path.basename(given))) sheetFile = real;
  } catch {
    // No such file: reading the sheet says so.
  }
  const read = readSwipeSheet(sheetFile, deps);
  if ("problem" in read) return failed(read.problem, json);
  const { sheet } = read;
  const listed = sheetVideos(sheet, opts.persona);
  if ("problem" in listed) return failed(listed.problem, json);
  const { videos, personas } = listed;
  if (opts.status || !opts.yes) {
    // A read and the plan take no lock and write nothing.
    const stateRead = readSheetState(sheetFile, deps);
    if ("problem" in stateRead) return failed(stateRead.problem, json);
    if (opts.status) return sheetStatusFlow(sheet, sheetFile, videos, personas, stateRead.state, opts, deps);
    return sheetPaidFlow(sheet, sheetFile, videos, personas, stateRead.state, null, opts, deps, stateRead.missing);
  }
  // One run of a sheet at a time; the state is read under the lock, so it is the one the last run left.
  const lock = await takeSheetLock(sheetFile, deps);
  if ("problem" in lock) return failed(lock.problem, json);
  try {
    const stateRead = readSheetState(sheetFile, deps);
    if ("problem" in stateRead) return failed(stateRead.problem, json);
    return await sheetPaidFlow(sheet, sheetFile, videos, personas, stateRead.state, lock.note, opts, deps);
  } finally {
    lock.release();
  }
}

const LOOKS_PATH = "/api/v2/video/script-runs";
const WHOAMI_PATH = "/api/v2/whoami";

/**
 * What the start would refuse only after every write is paid, checked first with free reads: a look the start does
 * not offer (the same list `exodus video start` reads), and a title on a key that isn't an admin's.
 */
async function startChecks(sheet: SwipeSheet, deps: VideoDeps): Promise<string | null> {
  const { style, title } = sheet.start;
  if (style) {
    const res = await deps.get(LOOKS_PATH);
    if (!res.ok) return `The looks could not be read to check "style": ${swipeErrorLine(res)} Nothing was sent.`;
    const looks = isRecord(res.data) && Array.isArray(res.data.styles) ? (res.data.styles as Array<{ slug?: unknown }>) : [];
    const slugs = looks.map((look) => look.slug).filter((slug): slug is string => typeof slug === "string");
    if (!slugs.includes(style)) {
      return `In the sheet, "style": "${style}" is not a look a swiped run can start on. The looks: ${slugs.join(", ") || "none listed"}.`;
    }
  }
  if (title) {
    // The start refuses a title from a customer key (convex/http.ts swipe-runs). A key that got past the products read
    // is an admin or a customer, and an admin is exactly a user whose role is "admin" (callerCanUseVideo,
    // convex/lib/authz.ts), so a role other than admin is a customer key here.
    const res = await deps.get(WHOAMI_PATH);
    if (!res.ok) return `This key could not be checked for "title": ${swipeErrorLine(res)} Nothing was sent.`;
    const role = isRecord(res.data) ? res.data.userRole : undefined;
    if (role !== "admin") return 'In the sheet, "title" names the ad, for admins only, and this key is not an admin\'s. Leave "title" out.';
  }
  return null;
}

/**
 * Said before the yes when what this sheet bought before may be forgotten, so the yes would buy it again (#4339):
 * no state file beside the sheet while the brand already has swipes of its ads; a state file beside it left under an
 * older name of the sheet; and saved writes or starts under a persona no longer in the sheet. Warns only: the plan
 * still lists those steps as paid, and the member decides.
 */
async function lostProgressLines(
  sheet: SwipeSheet,
  sheetFile: string,
  state: SheetState,
  missing: boolean,
  planned: Array<{ item: SheetSource; steps: PlannedStep[] }>,
  deps: VideoDeps,
): Promise<string[]> {
  const stateName = path.basename(sheetStatePath(sheetFile));
  const lines: string[] = [];
  if (missing) {
    const dir = path.dirname(sheetFile);
    const leftBehind = sheetFilesOf(deps)
      .listDir(dir)
      .filter((name) => name.endsWith(".state.json") && name !== stateName)
      .map((name) => ({ name, sheetName: name.slice(0, -".state.json".length) }))
      .filter(({ sheetName }) => sheetName && deps.statFile(path.join(dir, sheetName)) === null);
    for (const { name, sheetName } of leftBehind) {
      lines.push(
        `A saved progress file, ${name}, is beside this sheet for a sheet named ${sheetName} that is no longer there. If this sheet was renamed from ${sheetName}, rename ${name} to ${stateName} before the yes; without it the yes buys every step below again.`,
      );
    }
    const res = await deps.get(SWIPES_PATH);
    const rows = res.ok && isRecord(res.data) && Array.isArray(res.data.swipes) ? (res.data.swipes as SwipeListRow[]) : [];
    const ours = rows.filter((row) => {
      if (row.outcome?.kind === "refused") return false;
      return planned.some(({ item, steps }) => {
        const breakdownId = steps.find((step) => step.step === "breakdown")?.have;
        if (breakdownId && row.breakdownId === breakdownId) return true;
        if (item.source.kind === "url") return row.source?.sourceUrl === item.source.url;
        if (item.source.kind === "file") return row.source?.fileName === path.basename(item.source.file);
        return row.source?.sourceAdId === item.source.swipeAdId;
      });
    });
    if (ours.length > 0) {
      const named = ours.map((row) => (row.workflowRunId ? `${row._id} (video run ${row.workflowRunId})` : `${row._id} (no video yet)`)).join(", ");
      lines.push(
        `No saved progress was found beside this sheet (${stateName}), but this brand already has swipes of these ads: ${named}. The yes writes and starts them again, which is paid. If this sheet was run before from another folder or under another name, put its saved progress here as ${stateName} first.`,
      );
    }
    return lines;
  }
  const inSheet = new Set(sheet.personas.length > 0 ? sheet.personas.map((persona) => persona.name) : [""]);
  for (const item of sheet.sources) {
    const src = state.sources[item.key];
    if (!src) continue;
    for (const [key, write] of Object.entries(src.writes)) {
      if (inSheet.has(key)) continue;
      const runs = Object.values(write.runs);
      const runIds = runs.map((run) => run.runId).filter((id): id is string => id !== null);
      const unseen = runs.map((run) => run.pending?.swipeId).filter((id): id is string => id !== undefined);
      if (!write.swipeId && !write.pending && runIds.length === 0 && unseen.length === 0) continue;
      const who = key ? `persona "${key}"` : "the write with no persona";
      const had = [
        ...(write.swipeId ? [`swipe ${write.swipeId}`] : []),
        ...runIds.map((id) => `video run ${id}`),
      ];
      lines.push(
        [
          `The saved progress for ${item.key} has ${who}, which is no longer in the sheet${had.length > 0 ? ` (${had.join(", ")})` : ""}. If it was renamed, the yes writes and starts it again under its new name, which is paid.`,
          ...unseen.map((id) => `It also has a start for it whose answer was never seen: check exodus video swipe show ${id} before the yes.`),
          ...(write.pending ? ["It also has a write for it whose end was never seen: check exodus video swipe list before the yes."] : []),
        ].join(" "),
      );
    }
  }
  return lines;
}

/** A path as the member can paste it back into a shell. */
const shellWord = (word: string) => (/^[\w./@%+=:,-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`);

/** The plan (no lock) or, with --yes and the lock held, the paid steps. */
async function sheetPaidFlow(
  sheet: SwipeSheet,
  sheetFile: string,
  videos: SheetVideo[],
  personas: Array<SheetPersona | null>,
  state: SheetState,
  lockNote: string | null,
  opts: SheetFlowOptions,
  deps: VideoDeps,
  stateMissing = false,
): Promise<FlowResult> {
  const { json } = opts;
  const stateFile = sheetStatePath(sheetFile);

  // The whole sheet is checked before anything is sent: each file as the breakdown checks it, the product, and what
  // the start would refuse.
  for (const [index, item] of sheet.sources.entries()) {
    const src = state.sources[item.key];
    if (item.source.kind !== "file" || (src && src.kind === "file" && (src.breakdownId || src.templateDone))) continue;
    const checked = await swipeBreakdownFlow(item.source, { json: true, yes: false, wait: false }, deps);
    if (checked.code !== 0) return failed(`Source ${index + 1}: ${errorOf(answerOf(checked))}`, json);
  }
  const chosen = await sheetProduct(sheet, deps);
  if ("problem" in chosen) return failed(chosen.problem, json);
  const refusedStart = await startChecks(sheet, deps);
  if (refusedStart) return failed(refusedStart, json);
  const product = { id: chosen.product.id, name: chosen.product.name, picked: chosen.picked };
  const head = [...sheetHeadLines(sheet, sheetFile, personas, product), "", ...videoListLines(sheet, videos, personas)];
  const notUsed = notUsedOf(sheet, personas).names;
  const count = { videos: videos.length, ads: sheet.sources.length, personas: personas.filter(Boolean).length, characters: sheet.characters.length };
  const videosJson = videos.map((video) => ({
    n: video.n,
    source: video.source.given,
    persona: video.persona?.name ?? null,
    character: video.character.index,
  }));

  if (!opts.yes) {
    const planned: Array<{ item: SheetSource; steps: PlannedStep[] }> = [];
    for (const item of sheet.sources) {
      const own = videos.filter((video) => video.source === item);
      planned.push({ item, steps: await plannedSteps(item, own, state, sheet, product.id, opts.retryRefused, deps) });
    }
    const needsYes = planned.some(({ steps }) => steps.some((step) => step.buy));
    const warning =
      videos.length > SHEET_VIDEO_WARNING ? [`That is ${videos.length} videos, more than ${SHEET_VIDEO_WARNING}. Check the count with the member before the yes.`] : [];
    const progressLost = await lostProgressLines(sheet, sheetFile, state, stateMissing, planned, deps);
    if (json) {
      return {
        code: 0,
        lines: [
          JSON.stringify({
            ok: true,
            needsYes,
            sheet: sheetFile,
            state: stateFile,
            product,
            count,
            videos: videosJson,
            ...(warning.length > 0 ? { warning: warning[0] } : {}),
            ...(progressLost.length > 0 ? { progressLost } : {}),
            notUsed,
            moved: sheet.moved,
            sources: planned.map(({ item, steps }) => ({ source: item.given, steps })),
            price: null,
          }),
        ],
      };
    }
    return {
      code: 0,
      lines: [
        ...head,
        ...warning,
        ...progressLost,
        "",
        ...planned.flatMap(({ item, steps }, i) => [`Ad ${i + 1}: ${item.key}`, ...plannedLines(steps)]),
        "",
        ...(needsYes
          ? [
              ...(sheet.kind
                ? [`The sheet's kind, ${sheet.kind}, is checked against each ad at its write, after that ad's breakdown and template are paid.`]
                : []),
              "The CLI prints no price for these steps.",
              "Nothing that costs money was sent. On the member's yes, run the same command with --yes.",
            ]
          : ["Every step is done already. Nothing would be bought again."]),
      ],
    };
  }

  // The state file must be writable before the first paid step: a step whose id can't be kept would be bought again.
  const files = sheetFilesOf(deps);
  const writeState = () => files.writeAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));
  try {
    writeState();
  } catch (err) {
    return failed(`The state file ${stateFile} can't be written (${reason(err)}), so nothing was sent.`, json);
  }
  const save = () => {
    try {
      writeState();
    } catch (err) {
      throw new StateNotSaved(reason(err));
    }
  };

  const out = progress(opts);
  if (lockNote) out.say(lockNote);
  for (const line of head) out.say(line);
  const ctx: SheetContext = { sheet, sheetFile, state, productId: product.id, retryRefused: opts.retryRefused, save, say: out.say, deps };
  const outcomes: VideoOutcome[] = [];
  try {
    for (const [index, item] of sheet.sources.entries()) {
      out.say("");
      out.say(`Ad ${index + 1} of ${sheet.sources.length}: ${item.key}`);
      outcomes.push(...(await runSheetSource(item, videos.filter((video) => video.source === item), ctx)));
    }
  } catch (err) {
    if (!(err instanceof StateNotSaved)) throw err;
    // Every paid ask is marked in the file before it is sent, and a mark that can't be saved stops the ask, so the
    // file on disk is enough for the next run to check what was sent before it buys anything.
    const why = `The state file ${stateFile} could not be saved (${err.message}), so the run stopped: a step it can't keep track of could be bought twice. Once the file can be written, run the same command again; it checks every step sent before and buys none of them twice.`;
    return json ? failed(why, json) : { code: 1, lines: [...out.kept, "", why] };
  }

  // With --wait, each run is followed once every run is started, so no video waits on the one before it. A wait that
  // fails is said for its video; the others are still waited on and summed up.
  let waitsOk = true;
  if (opts.wait) {
    for (const outcome of outcomes) {
      if (!outcome.runId) continue;
      out.say("");
      out.say(`Waiting for video ${outcome.video.n}, run ${outcome.runId}.`);
      try {
        const waited = await waitFlow(
          outcome.runId,
          { json, ...(outcome.watch ? { url: outcome.watch } : {}), ...(json ? {} : { onProgressLine: opts.onProgressLine }) },
          deps,
        );
        if (waited.code !== 0) waitsOk = false;
        if (json) outcome.waited = answerOf(waited);
        else for (const line of waited.lines) out.say(line);
      } catch (err) {
        waitsOk = false;
        const why = `The wait stopped: ${describeFetchFailure(err)}. The run goes on: exodus video status ${outcome.runId}`;
        if (json) outcome.waited = { ok: false, error: why };
        else out.say(why);
      }
    }
  }

  const code = outcomes.every((outcome) => outcome.runId !== null) && waitsOk ? 0 : 1;
  if (json) {
    return {
      code,
      lines: [
        JSON.stringify({
          ok: code === 0,
          sheet: sheetFile,
          state: stateFile,
          product,
          count,
          notUsed,
          moved: sheet.moved,
          videos: outcomes.map(({ video, runId, watch, refused, stopped, waited }) => {
            const { src, write } = peekVideo(state, video);
            return {
              n: video.n,
              source: video.source.given,
              persona: video.persona?.name ?? null,
              character: video.character.index,
              breakdownId: src?.breakdownId ?? null,
              swipeId: write?.swipeId ?? null,
              runId,
              url: watch,
              refused,
              stopped,
              ...(waited !== undefined ? { waited } : {}),
            };
          }),
        }),
      ],
    };
  }
  const summary = outcomes.map(({ video, runId, watch, stopped }) =>
    runId
      ? `  ${video.n}. ${videoLabel(video)}: run ${runId}. ${watch ? `Watch it: ${watch}` : `Check it: exodus video status ${runId}`}`
      : `  ${video.n}. ${videoLabel(video)}: stopped at the ${stopped?.step ?? "start"}. ${stopped?.why ?? ""}`.trimEnd(),
  );
  return {
    code,
    lines: [
      ...out.kept,
      "",
      "Summary:",
      ...summary,
      `Where each video stands is kept in ${stateFile}. Run the same command again to go on where it stopped; no step is bought twice.`,
      `See each video's state: exodus video swipe run --sheet ${shellWord(sheetFile)} --status`,
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
    case "find":
      return swipeFindFlow(plan.ask, opts, deps);
    case "start":
      return swipeStartFlow(plan.swipeId, plan.ask, opts, deps, plan.again, true);
    case "sheet":
      return swipeSheetReadFlow(plan.swipeId, opts, deps);
    case "sheet-set":
      return swipeSheetSetFlow(plan.swipeId, plan.picks, opts, deps);
    case "sheet-price":
      return swipeSheetPriceFlow(plan.swipeId, opts, deps);
    case "sheet-people":
      return swipeSheetPeopleFlow(plan.swipeId, plan.count, plan.maxUsd, opts, deps);
    case "sheet-voices":
      return swipeSheetVoicesFlow(plan.swipeId, opts, deps);
    case "run":
      return swipeSheetFlow(plan.sheetFile, { ...opts, retryRefused: plan.retryRefused, status: plan.status, persona: plan.persona }, deps);
  }
}
