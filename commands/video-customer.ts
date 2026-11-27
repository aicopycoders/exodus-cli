/**
 * #3251: what the video routes answer a beta tester, and how the CLI words it.
 *
 * These mirror the server's allowlisted bodies (CustomerCli* in
 * convex/videoRunView.ts, CustomerRunView in convex/lib/video/customerRunView.ts).
 * Every one carries `view: "customer"`, so a flow branches on the answer it got
 * and never on who the caller is. This package ships on its own schedule, so the
 * types are copied here rather than imported.
 */

import { speechIssueText } from "../lib/speechIssueText.js";

import { AUDITION_RESTART_REASON, type AuditionReview } from "../lib/template-audition.js";
export type CustomerRunStage =
  | "waiting"
  | "planning"
  | "picking"
  | "drawing"
  | "filming"
  | "editing"
  | "review"
  // Stop 4: the pilot clip is made and the run waits before the other clips.
  | "pilot"
  | "ready"
  | "failed"
  | "cancelled";

/** Mirror of the server's allowlisted exact-script evidence (CLI ships separately). */
export type SpeechSummary = {
  status: "verbatim" | "accepted-with-speech-issue" | "speech-issue" | "unverified";
  issues: {
    sceneIndex?: number;
    policy: "exact-script";
    operation: "insert" | "delete";
    expected: { startWord: number; endWord: number; text: string };
    heard: { startWord: number; endWord: number; text: string; startSec?: number; endSec?: number };
    repeated?: boolean;
  }[];
};

export function speechSummaryLines(speech?: SpeechSummary): string[] {
  if (!speech) return [];
  const labels = { verbatim: "Verbatim", "accepted-with-speech-issue": "Accepted with speech issue",
    "speech-issue": "Speech issue — review required", unverified: "Speech not verified" };
  return [labels[speech.status], ...speech.issues.map(speechIssueText)];
}

export interface CustomerRunScene {
  sceneIndex: number;
  line: string | null;
  imageUrl: string | null;
  frameStatus: "pending" | "drawing" | "ready" | "failed";
  productNote?: string;
  /** #4761: `redoEstimateUsd` to `redoEstimateMaxUsd` is the price the video's page shows on its Try again. */
  clip?: {
    status?: string;
    speech?: SpeechSummary;
    redoEstimateUsd?: number;
    redoEstimateMaxUsd?: number;
    /** #4954: the scene's voice change is being tried again on the clip it has; nothing is filmed. */
    voiceRetrying?: true;
    /** #4755: held only for its voice change, so `exodus video revoice` can try it again. Sent while the video films. */
    voiceRetry?: true;
    /** #4963: held for its voice change and another fault, so changing its voice again can't finish it. */
    voiceHeldToo?: true;
  } | null;
}

/** COP-277, #4733: one scene the cut waits on, in the server's sentence. */
/** #4755: `voice`, held only for its voice change, which `exodus video revoice` tries again without filming. */
/** `voiceLocked`, and on a kind that locks every voice, so it can't be kept as it is. `voiceToo` (#4955): held for its
 * voice change and another fault, so its Try again films a new take, which changes its voice too. */
export type CustomerHeldScene = {
  sceneIndex: number;
  sentence: string;
  take: boolean;
  unfilmed?: true;
  voice?: true;
  voiceToo?: true;
  voiceLocked?: true;
};

export type CustomerStopReason =
  | { kind: "out-of-credits" }
  | { kind: "openrouter-out-of-credits" }
  | { kind: "plan-too-big" }
  | { kind: "plan-rejected" }
  | { kind: "keys-missing"; keys: string[] }
  /** #4488: the step's own sentence, shown as it is. Absent from older servers. */
  | { kind: "stop-sentence"; sentence: string };

export interface CustomerRun {
  view: "customer";
  isTerminal: boolean;
  runId: string;
  title: string;
  card: { conceit: string; style: string } | null;
  mode: "one-shot" | "guided";
  stage: CustomerRunStage;
  templateApproval?: { audition?: AuditionReview };
  /** Door 2: present (true) only on a run from a template (convex customerRunView.ts). Absent from older servers. */
  template?: true;
  /** #3299: a Guided video's cut is ready and waits for `exodus video approve`. Absent from older servers. */
  awaitingSignOff?: boolean;
  waiting: { ahead: number; stepsDone: number } | null;
  scenes: CustomerRunScene[] | null;
  /** COP-300: `notes` are the cut's check against its own sound, in the server's sentences. Absent from older servers. */
  /**
   * COP-393: `endCard`, one line about the end card the run's lock asked for (in the film, the simple card and why, or
   * left out and why). Absent when the lock asked for none, and from older servers.
   * B-roll, inserts and overlays: `cutawayLines`, the film record's lines of the run's plan (convex customerRunView.ts).
   * Absent on a run that froze no plan, and from older servers.
   */
  video: {
    url: string;
    wordsOff: boolean;
    speech?: SpeechSummary;
    notes?: string[];
    endCard?: { state: string; line: string };
    cutawayLines?: FilmCutawayLines;
  } | null;
  canRetry: boolean;
  /** #3366: the app's cut failed with every clip done, so the video's page can cut the same clips again, free. */
  canCutAgain?: boolean;
  /** #4573: why the app's cut was refused, in the member's words; only beside Cut again. Absent from older servers. */
  cutFailure?: { sentence: string };
  stopReason: CustomerStopReason | null;
  detailsPath: string | null;
  /**
   * #4257: the scenes the final cut waits on, one sentence each. The server
   * sends such a run as "failed", since an older CLI waits through "editing".
   * Absent from older servers.
   */
  cutHolds?: string[];
  /**
   * COP-277: the same held scenes with their numbers, and whether each is a One-take take held for its words (kept
   * with `exodus video keep`, never made again on its own). Absent from older servers.
   */
  /** #4733: `unfilmed`, a scene the member's stop at the estimate left with no clip. Absent from older servers. */
  cutHeldScenes?: CustomerHeldScene[];
  /**
   * #4761: the scenes waiting on the member's keep or Try again right now, whatever else the run is doing (another
   * scene filming, the cut being made again, a cut waiting to be finished). Absent when none is, and from older servers.
   */
  waitingScenes?: CustomerHeldScene[];
  /** #4582: what the run has spent (the server's own figure, "so far" while it works) beside its estimate. */
  /** #4811: `storyboardEstimate`, at the storyboard stop, the storyboard's own estimate when it differs. Absent from older servers. */
  spend?: { spentUsd: number; estimateUsd: number | null; final: boolean; line: string; storyboardEstimate?: { usd: number; sentence: string } };
  /** #4582: the video reached its estimate and waits on the member's answer, in the server's sentence. */
  spendAsk?: { sentence: string };
  /** #4582: the member's last keep going. */
  spendWentOn?: { sentence: string };
  /** #4582: the member said stop here. */
  spendStopped?: { sentence?: string };
  /**
   * COP-218/COP-337: the run waits at its storyboard; `beforePictures` when a pictures step follows it. #4825:
   * `acceptFindings` when the check before pictures stopped it there, with the server's `notes` and what it found
   * (`findings`), which approving accepts. Absent from older servers.
   */
  planHold?: { atBoard?: boolean; beforePictures: boolean; notes?: string[]; acceptFindings?: boolean; findings?: CustomerPlanFinding[] };
  /**
   * COP-351: at that stop, the place its board drew, or tried to draw, before it: its name and look, and its picture's
   * address, null when none came out. Absent when the board drew none, and from older servers. COP-380 (C6): `check`,
   * how the check of its picture ended and the server's line about it (null when there is nothing to say), printed as
   * the server words it. Absent when it was not checked, and from older servers.
   */
  place?: { name: string; look: string; imageUrl: string | null; check?: StopPictureCheck };
  /**
   * COP-273 P7 stage 4: on a sung run filmed in calls (convex/videoRunView.ts customerRunViewOf, songCallsOfRunView), its
   * calls and the pictures each is filmed from, or the stop's own sentence. Absent on every other run.
   */
  songCalls?: unknown;
  /**
   * COP-273 P7 stage 4 fix (M2): the song step's notice in the server's own short sentences (convex/lib/video/songNotice.ts):
   * the lines the song's kept take missed, and a song that came out as another kind of music. Absent otherwise.
   */
  songNotice?: string[];
  /**
   * COP-380: at that stop, the face photo its board drew, or tried to draw, with the place (none when a person was
   * picked on the sheet), and the product cut-out (none when the product has no photo): each one's address, null when
   * none came out. Absent when the board drew none, and from older servers. COP-380 (C6): each with its `check`, as the
   * place's.
   */
  face?: { label: string; imageUrl: string | null; check?: StopPictureCheck };
  cutout?: { name: string; imageUrl: string | null; check?: StopPictureCheck };
  /**
   * COP-388 (fix 2): at that stop, a product with no photo: its name and the server's line that the takes show a plain
   * pack, printed as the server words it. Absent otherwise, and from older servers.
   */
  productNoPhoto?: { name: string; line: string };
  /**
   * COP-384: at that stop, the extra shots its board planned, each not dropped, by number, name, word, layout and price
   * (null with none). Absent when it planned none, and from older servers.
   */
  extraShots?: { shots: Array<{ n: number; label: string; word: string; layout: "full" | "split"; usd: number | null }> };
  /**
   * COP-393: at that stop, the end card the run's lock asked for, as its board drew it (its picture's address, never
   * printed), or why none was drawn, or that it was dropped. Absent when the lock asks for no card, and from older servers.
   */
  endCard?: StopEndCard;
  /** B-roll, inserts and overlays: at that stop, the plan's list and its code. Absent otherwise, and from older servers. */
  cutaways?: StopCutaways;
  /** In place of `cutaways`: the one sentence of a plan that cannot be read. */
  cutawaysUnread?: string;
}

/**
 * COP-393: the end card at the stop, as the server sends it (CustomerRunView.endCard on status, CustomerCliStoryboard
 * .endCard with `drawn` on the storyboard). Its states and the check's are plain strings, so a newer server's never
 * break this CLI; the note is the server's own sentence.
 */
export type StopEndCard =
  | {
      state: "ready";
      imageUrl?: string | null;
      drawn?: boolean;
      layout: string;
      words: ReadonlyArray<{ label: string; words: string }>;
      check: { state: string; labelWords?: string };
      note: string;
      /** The simple card's reason, when another note took the note's place. */
      simpleNote?: string;
    }
  | { state: "none"; reason: string; note: string }
  | { state: "dropped"; note: string };

/** COP-393: the check's state, in the stop's words: for the team's CLI only (`check: true`). */
const END_CARD_CHECK_WORDS: Readonly<Record<string, string>> = { passed: "passed", failed: "failed", unchecked: "not checked" };

/**
 * COP-393: the end card's lines at the stop, in line with the pictures' (COP-375: never its address; the page shows it):
 * its layout's name, its words by slot, the check's state for the team's CLI only (COP-470 part 14, Dani's rule: a
 * member reads what is wrong, never what we check), the server's one note, and how to drop it. A card not drawn
 * says its reason and how the film ends; a dropped one says so. None when the server sent none.
 */
export function endCardLines(card: StopEndCard | undefined, id: string, page: string, opts: { check?: boolean } = {}): string[] {
  if (!card) return [];
  const label = "The end card: ";
  const under = " ".repeat(label.length);
  // The board's reason names the card itself ("The end card was not drawn: ..."), so it is said as it is.
  if (card.state === "none") return [`${card.reason} ${card.note}`];
  if (card.state === "dropped") return [`${label}${card.note}`];
  if (card.state !== "ready") return [];
  const drawn = card.drawn ?? (card.imageUrl !== null && card.imageUrl !== undefined);
  return [
    `${label}${card.layout}. ${drawn ? `See it: ${page}` : "Its picture can't be shown here."}`,
    ...card.words.map((word) => `${under}${word.label}: ${word.words}`),
    ...(opts.check ? [`${under}Check: ${END_CARD_CHECK_WORDS[card.check.state] ?? card.check.state}`] : []),
    `${under}${card.note}`,
    ...(card.simpleNote ? [`${under}${card.simpleNote}`] : []),
    `Drop it:      exodus video drop-card ${id}`,
  ];
}

/** P7 stage 4 fix (M2): the song step's notice, each sentence a heads-up; nothing for a value this CLI cannot read. */
function songNoticeLines(notice: unknown): string[] {
  return Array.isArray(notice) ? notice.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => `Heads-up: ${s}`) : [];
}

/**
 * P7 stage 4: the server's sentences for a run filmed in calls, copied word for word (video/lib/songCalls.ts
 * SONG_CALL_NEW_VIDEO, SONG_CALL_NO_SCENE_PICTURES; the CLI package does not import video/lib). video-song-calls-stop.test.ts
 * holds each equal to the server's.
 */
export const SONG_CALL_NEW_VIDEO = "A new video makes the whole ad again, at its own price, shown before you start.";
export const SONG_CALL_NO_SCENE_PICTURES =
  "This video is filmed from the pictures of its people and places, one clip for every one to three sung lines, so no picture of a scene was drawn.";
/** What the server refuses on such a run (songCallSceneRedoRefused), said as a fact with its way on. */
export const SONG_CALL_NO_ONE_SCENE = `One scene's clip or picture can't be made again on its own. ${SONG_CALL_NEW_VIDEO}`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** One picture of a call in the member's words, by its kind (video/lib/songCalls.ts SongCallPictureKind). */
function callPictureWords(picture: Record<string, unknown>): string {
  const who = typeof picture.characterId === "string" ? picture.characterId : "a person";
  switch (picture.kind) {
    case "character-sheet": return `the sheet of ${who}`;
    case "character-picture": return `the picture of ${who}`;
    case "product-sheet": return "the product's sheet";
    case "product-plate": return "the product's picture";
    case "props-sheet": return "the props' sheet";
    case "place-view":
      return `${typeof picture.place === "string" ? picture.place : "a place"}${typeof picture.view === "string" ? `, view ${picture.view}` : ""}${picture.lit === true ? ", lit" : ""}`;
    default: return typeof picture.kind === "string" ? picture.kind : "a picture";
  }
}

/**
 * P7 stage 4: the storyboard stop of a run filmed in calls, from its `songCalls` (video/lib/songCallsOfRun.ts
 * SongCallsView, or `{ problem }`): no scene picture was drawn (scout scene-frames.ts), the pictures each call is filmed
 * from, the view's notes, and that no scene is made again on its own. The stop's own sentence when it has a problem.
 * P10 finding 22: the server's sentence (`notYet`) while the places are still to be drawn, as at the stop the check
 * before pictures makes at the board, in place of the calls. Nothing for a value this CLI cannot read.
 * COP-375 (dev's #4911), the lead's ruling of Nov 17: each picture by what it is, never its address; `page`, the
 * video's page, which draws each call's pictures (run-song-stop.tsx), is said after them ("See the pictures:", as the
 * storyboard says it). No page line when there is none.
 */
/** Landing #5000 (COP-402): the stop says its clips cannot be filmed, so the server refuses an approve and none is offered. */
export function songCallsProblem(songCalls: unknown): boolean {
  return isObject(songCalls) && typeof songCalls.problem === "string";
}

export function songCallStopLines(songCalls: unknown, page = ""): string[] {
  if (!isObject(songCalls)) return [];
  if (typeof songCalls.problem === "string") return [songCalls.problem];
  if (typeof songCalls.notYet === "string") return [songCalls.notYet];
  if (!Array.isArray(songCalls.calls)) return [];
  const lines = [SONG_CALL_NO_SCENE_PICTURES, "The pictures each video call is filmed from:"];
  let drawn = false;
  for (const call of songCalls.calls.filter(isObject)) {
    const scenes = Array.isArray(call.scenes) ? call.scenes : [];
    const pictures = Array.isArray(call.pictures) ? call.pictures.filter(isObject) : [];
    lines.push(`  Call ${String(call.n)} (${scenes.length === 1 ? "scene" : "scenes"} ${scenes.join(", ")}): ${pictures.length === 1 ? "1 picture" : `${pictures.length} pictures`}`);
    for (const picture of pictures) lines.push(`    ${callPictureWords(picture)}`);
    drawn = drawn || pictures.length > 0;
  }
  if (drawn && page) lines.push(`See the pictures: ${page}`);
  const notes = Array.isArray(songCalls.notes) ? songCalls.notes.filter((note): note is string => typeof note === "string" && note.trim() !== "") : [];
  return [...lines, ...notes, SONG_CALL_NO_ONE_SCENE];
}

/**
 * COP-380 (C6): how the check of a picture drawn before the stop ended, as the server sends it: its state (a plain
 * string, so a state a newer server sends never breaks this CLI) and the line the run's page shows under the picture,
 * null when there is nothing to say.
 */
export interface StopPictureCheck {
  state?: string;
  line: string | null;
}

/** COP-351, COP-380: the pictures a One-take board drew, or tried to draw, before its stop: each one's address, or null. */
export interface StopPictures {
  face?: { imageUrl: string | null; check?: StopPictureCheck };
  place?: { imageUrl: string | null; check?: StopPictureCheck };
  cutout?: { imageUrl: string | null; check?: StopPictureCheck };
}

/** COP-380: one picture drawn before the stop, as the stop's lines name it. */
export interface StopPictureLine {
  /** What it is, in the line that says what waits for the yes ("the script, the face, the place and the voice"). */
  noun: string;
  drawn: boolean;
  /** Drawn: its line with the page that shows it (COP-375: never its own address). Not drawn: the sentence that says so. */
  line: string;
  /** COP-380 (C6): a drawn picture's check line, under its line, when the check left something to say. */
  check?: string;
}

/** COP-380 (C6): each picture's lines: its own, then its check's when there is one. */
export function stopPictureText(pictures: readonly StopPictureLine[]): string[] {
  return pictures.flatMap((picture) => [picture.line, ...(picture.check ? [picture.check] : [])]);
}

const STOP_PICTURES = [
  { key: "face", noun: "face", label: "The face:     ", missed: "The face photo didn't come out. It is drawn when you approve, before the takes are filmed." },
  { key: "place", noun: "place", label: "The place:    ", missed: "The picture of the place didn't come out. It is drawn when you approve, before the takes are filmed." },
  { key: "cutout", noun: "product cut-out", label: "The cut-out:  ", missed: "The product cut-out didn't come out. It is drawn when you approve, before the takes are filmed." },
] as const;

/**
 * COP-351, COP-380: at a One-take run's storyboard stop, the pictures its board drew, or tried to draw, before it, in
 * the order the run's page shows them (the face, the place, the cut-out), each with its line. Empty when the board drew
 * none (a run from before).
 */
export function stopPictureLines(pictures: StopPictures, page: string): StopPictureLine[] {
  return STOP_PICTURES.flatMap(({ key, noun, label, missed }) => {
    const picture = pictures[key];
    if (!picture) return [];
    const drawn = picture.imageUrl !== null;
    // COP-380 (C6): the check's line sits under the picture's, in line with its words.
    const check = drawn && picture.check?.line ? `${" ".repeat(label.length)}${picture.check.line}` : undefined;
    return [{ noun, drawn, line: drawn ? `${label}drawn. See it: ${page}` : missed, ...(check ? { check } : {}) }];
  });
}

/** COP-388 (fix 2): the line for a product with no photo, under the pictures' lines, in line with their words. */
export function noPhotoLines(run: { productNoPhoto?: { line: string } }): string[] {
  return run.productNoPhoto ? [`The product:  ${run.productNoPhoto.line}`] : [];
}

/** "the script, the place and the voice". */
export function listedWords(words: readonly string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** COP-384: the extra shots a One-take board planned, as the stop lists them, and how to drop one. */
export function extraShotLines(run: Pick<CustomerRun, "extraShots">, id: string): string[] {
  const shots = run.extraShots?.shots ?? [];
  if (shots.length === 0) return [];
  const layout = { full: "full screen", split: "split screen" } as const;
  return [
    // #5099: in development and untested (Brad's rule), as the sheet's row says.
    `Extra shots:  ${shots.length} planned, cut in while the voice carries on (in development, untested).`,
    ...shots.map((shot) => `  ${shot.n}. ${shot.label}, on "${shot.word}", ${layout[shot.layout]}${shot.usd !== null ? `, $${shot.usd.toFixed(2)}` : ""}`),
    `Drop one:     exodus video drop-shot ${id} --shot <n>`,
  ];
}

/**
 * B-roll, inserts and overlays (plan 4.5): the plan's list at the storyboard stop, as the server sends it
 * (convex/lib/video/customerRunView.ts CustomerRunView.cutaways, built by video/lib/cutawayPlan.ts cutawayStopListOf).
 * Plain strings, so a newer server's values never break this CLI; the heading and the sentences are the server's own.
 */
export interface StopCutaways {
  /** The feature's short name, which says "in development, untested" once. */
  title: string;
  /** That the pictures are made after the takes, so the yes is for the plan. */
  note: string;
  code: string;
  rows: ReadonlyArray<{
    n: number;
    key: string;
    label: string;
    words: readonly string[];
    lineId: string;
    word: string;
    maker: string;
    layout?: string;
    /** The server's words for the layout; the CLI keeps none of its own. */
    layoutLabel?: string;
    layoutNote?: string;
    arrow: boolean;
    price: string;
    dropped: boolean;
    burst?: string;
    /** The row's small line, one sentence the server builds from the parts above; printed as it is. */
    line: string;
  }>;
  /** The kept items' total in one sentence, when the server sends it; printed as it is. */
  totalLine?: string | null;
  left: ReadonlyArray<{ sentence: string }>;
}

/**
 * The plan's lines, the one print of the stop's list for `exodus video storyboard` and `exodus video status` (the
 * member's and the team's): its title and note (the server's; the title says "in development, untested" once), one line
 * an item by the number `drop-item --item` takes, its label and its small line as the server words them, the total
 * sentence when the server sends it, the items left out at planning, then the code, the approve line with the code
 * (`approve`, when the caller prints its approve here) and the drop line. The CLI's own words are only "Dropped." and
 * the commands.
 */
export function cutawayLines(list: StopCutaways | undefined, id: string, opts: { readonly approve?: string } = {}): string[] {
  if (!list) return [];
  const rowLine = (row: StopCutaways["rows"][number]) => `  ${row.n}. ${row.label}: ${row.line}${row.dropped ? " Dropped." : ""}`;
  const kept = list.rows.some((row) => !row.dropped);
  return [
    list.title,
    list.note,
    ...(list.rows.length > 0 ? list.rows.map(rowLine) : ["  No item was planned."]),
    ...(list.totalLine ? [`  ${list.totalLine}`] : []),
    ...(list.left.length > 0 ? ["  Left out at planning:", ...list.left.map((one) => `    ${one.sentence}`)] : []),
    `Code:         ${list.code}`,
    ...(opts.approve ? [withItemsCode(opts.approve, id, list)] : []),
    ...(kept ? [`Drop one:     exodus video drop-item ${id} --item <n> --items ${list.code}`] : []),
  ];
}

/**
 * A plan that cannot be read: the server's one sentence, in place of the list (`cutawaysUnread`). The approve then needs
 * no code, so the plain approve line stands.
 */
export function cutawayUnreadLines(read: { readonly cutaways?: StopCutaways; readonly cutawaysUnread?: string }): string[] {
  return !read.cutaways && read.cutawaysUnread ? [read.cutawaysUnread] : [];
}

/** The film record's lines of a run's b-roll, inserts and overlays, as the server sends them (video/lib CutawayFilmLines). */
export interface FilmCutawayLines {
  readonly heading?: string;
  readonly lines: readonly string[];
}

/**
 * B-roll, inserts and overlays after the film: the server's heading, then one line an item, each in the server's words.
 * Read by both status prints (the beta tester's and the team's), right after the end card's line. Nothing when the
 * server sent none, so every other run prints as it did.
 */
export function filmCutawayLines(film: FilmCutawayLines | undefined): string[] {
  if (!film) return [];
  return [...(film.heading ? [film.heading] : []), ...film.lines.filter((line) => line.trim() !== "").map((line) => `  ${line}`)];
}

/** An approve line with the plan's code, when the stop lists a plan: the server refuses an approve without it. */
export function withItemsCode(line: string, id: string, list: StopCutaways | undefined): string {
  return list ? line.replace(`exodus video approve ${id}`, `exodus video approve ${id} --items ${list.code}`) : line;
}

/**
 * COP-337: the run waits at its storyboard with no pictures step after it (a One-take run's), so no take gets a
 * picture before the approval. The server's rule (convex/lib/video/customerRunView.ts noPictureBeforeApproval).
 */
function noPictureBeforeApproval(run: CustomerRun): boolean {
  return run.stage === "review" && run.planHold?.atBoard === true && run.planHold.beforePictures !== true;
}

/**
 * #4582: a regular video that reached its estimate waits on the member: the server's sentence, then the two commands.
 * Read by both status prints (the beta tester's and the admin's). A member's Claude shows these to the member and runs
 * one only on the member's own answer (workspace/.claude/skills/exodus-video/SKILL.md).
 */
export function spendAskLines(
  run: { spendAsk?: { sentence: string }; spendWentOn?: { sentence: string }; spendStopped?: { at?: number; sentence?: string } },
  runId: string,
): string[] {
  if (run.spendAsk) {
    return [
      `Waiting for you: ${run.spendAsk.sentence}`,
      `Keep going: exodus video keep-going ${runId}`,
      `Stop here:  exodus video stop-here ${runId}`,
    ];
  }
  if (run.spendStopped) return [run.spendStopped.sentence ?? SPEND_STOPPED_LINE];
  if (run.spendWentOn) return [run.spendWentOn.sentence];
  return [];
}

export const SPEND_STOPPED_LINE = "You stopped this video at its estimate. The app films nothing more on its own.";

/** #4257: the final cut waits for the customer to keep or remake a scene. */
export function customerCutHeld(run: CustomerRun): boolean {
  return (run.cutHolds?.length ?? 0) > 0;
}

function heldLines(run: CustomerRun, page: string): string[] {
  const holds = run.cutHolds ?? [];
  const scenes = run.cutHeldScenes;
  const one = (scenes?.length ?? holds.length) === 1;
  const head = `Held: the final video wasn't made yet. ${one ? "This scene needs" : "These scenes need"} you first:`;
  if (!scenes?.length) {
    // P7 stage 4 fix (S5): an older server's hold on a run filmed in calls: no scene is made again on its own.
    if (run.songCalls !== undefined) {
      return [head, ...holds.map((hold) => `  ${hold}`), SONG_CALL_NO_ONE_SCENE, `${one ? "Keep it" : "Keep each one"} as it is on the video's page: ${page}`];
    }
    return [head, ...holds.map((hold) => `  ${hold}`), `${one ? "Make it again" : "Make each one again"}, or keep it as it is, on the video's page: ${page}`];
  }
  return [head, ...heldSceneChoiceLines(run, scenes, page)];
}

/**
 * #4761: the scenes waiting on the member while the run does something else (another scene filming, the cut being
 * made again) or while its cut waits to be finished: the server's own list (`waitingScenes`). Empty when none is
 * waiting, and when the held cut's own list already says them (the "failed" stage with `cutHolds`).
 */
export function waitingSceneLines(run: CustomerRun, page: string): string[] {
  const scenes = run.waitingScenes;
  if (!scenes?.length || customerCutHeld(run)) return [];
  return [
    `${scenes.length === 1 ? "This scene needs" : "These scenes need"} you before your video can be finished:`,
    ...heldSceneChoiceLines(run, scenes, page),
  ];
}

/**
 * #4761: what `exodus video approve` adds under the server's refusal on a video waiting on scenes, from the server's
 * list (the held cut's, or else `waitingScenes`): each scene's finding, the page's Try again price and the keep
 * commands. The refusal already says the two ways out, so they are not said again. Empty when none waits.
 */
export function approveWaitingLines(run: CustomerRun, page: string): string[] {
  const scenes = run.cutHeldScenes?.length ? run.cutHeldScenes : run.waitingScenes;
  if (!scenes?.length) return [];
  // A One-take take is never made again on its own; a scene with no clip has nothing to keep; (#4954) a scene held only
  // for its voice change tries the voice change again, which films nothing and has no filming price.
  const price = tryAgainPrice(run, scenes.filter((s) => !s.take && !s.voice).map((s) => s.sceneIndex));
  return [
    ...scenes.map((s) => `  Scene ${s.sceneIndex}: ${s.sentence}`),
    price ? `On the video's page, Try again costs ${price}: ${page}` : `The video's page: ${page}`,
    ...scenes
      .filter((s) => !s.unfilmed && !s.voiceLocked)
      .map((s) => `Keep scene ${s.sceneIndex} as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
  ];
}

/**
 * #4761: the price the video's page shows on Try again for these scenes, from the server's figures (each scene's
 * `redoEstimateUsd` to `redoEstimateMaxUsd`); empty unless the server sent both for every one.
 */
function tryAgainPrice(run: CustomerRun, sceneIndexes: readonly number[]): string {
  const prices = sceneIndexes.map((n) => {
    const clip = run.scenes?.find((s) => s.sceneIndex === n)?.clip;
    return typeof clip?.redoEstimateUsd === "number" && typeof clip.redoEstimateMaxUsd === "number"
      ? `$${clip.redoEstimateUsd.toFixed(2)} to $${clip.redoEstimateMaxUsd.toFixed(2)}`
      : null;
  });
  if (prices.length === 0 || prices.some((p) => p === null)) return "";
  return prices.length === 1 ? prices[0]! : prices.map((p, i) => `${p} for scene ${sceneIndexes[i]}`).join(", ");
}

/** Each held or waiting scene's sentence, then how to answer it: keep it from here, or Try again on the page. */
function heldSceneChoiceLines(run: CustomerRun, scenes: readonly CustomerHeldScene[], page: string): string[] {
  // COP-277: a One-take take is kept as it is from here; it cannot be made again on its own.
  const takes = scenes.filter((s) => s.take);
  // #4733: a scene with no clip has nothing to keep: it is filmed from the page, which shows its price first.
  const unfilmed = scenes.filter((s) => s.unfilmed);
  // #4755: a scene held for its voice change is answered from here either way; nothing is filmed for it.
  const voices = scenes.filter((s) => s.voice && !s.take && !s.unfilmed);
  const faults = scenes.filter((s) => !s.take && !s.unfilmed && !s.voice);
  const keepable = faults.filter((s) => !s.voiceLocked);
  // P7 stage 4: on a run filmed in calls no scene's clip is filmed or made again on its own (the server refuses it,
  // songCallSceneRedoRefused): the way on is a new video, said once; keeping a scene as it is stays.
  const calls = run.songCalls !== undefined;
  const inParens = (price: string) => (price ? ` (${price})` : "");
  const unfilmedPrice = inParens(tryAgainPrice(run, unfilmed.map((s) => s.sceneIndex)));
  const faultPrice = inParens(tryAgainPrice(run, faults.map((s) => s.sceneIndex)));
  return [
    ...scenes.map((s) => `  Scene ${s.sceneIndex}: ${s.sentence}`),
    ...(calls && (unfilmed.length > 0 || faults.length > 0) ? [SONG_CALL_NO_ONE_SCENE] : []),
    ...(unfilmed.length > 0 && !calls
      ? [`${unfilmed.length === 1 ? "Film it" : "Film each one"} with Try again on the video's page, which shows the price first${unfilmedPrice}: ${page}`]
      : []),
    ...takes.map((s) =>
      takes.length === 1
        ? `Keep it as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`
        : `Keep scene ${s.sceneIndex} as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`,
    ),
    ...voices.flatMap((s) => [
      `Try scene ${s.sceneIndex}'s voice change again (nothing is filmed; ${VOICE_RETRY_COST}): exodus video revoice ${run.runId} --scene ${s.sceneIndex}`,
      ...(s.voiceLocked
        ? []
        : [`Or keep scene ${s.sceneIndex} in the voice it was filmed in: exodus video keep ${run.runId} --scene ${s.sceneIndex}`]),
    ]),
    ...(faults.length > 0
      ? [
          // #4955: a scene that can't be kept in its filmed voice (voiceLocked) is only made again.
          ...(calls ? [] : [`${faults.length === 1 ? "Make it again" : "Make each one again"} with Try again${keepable.length > 0 ? ", or keep it as it is," : ""} on the video's page. Try again shows the price first${faultPrice}: ${page}`]),
          ...keepable.map((s) => `Or keep ${faults.length === 1 ? "it" : `scene ${s.sceneIndex}`} as it is from here: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
        ]
      : []),
    ...(takes.length > 0 && faults.length === 0 && unfilmed.length === 0
      ? [`${takes.length === 1 ? "Watch it first:  " : "Watch them first:"} ${page}`]
      : []),
  ];
}

/**
 * COP-47: what the server's tidy did to a script it laid out before the start,
 * on both tiers' start answers (ScriptRunTidied in convex/videoRunView.ts).
 */
export interface ScriptTidied {
  /** Lines of the file left out as not part of the ad. */
  setAside: string[];
  /** Cast words the file never said: labels for unnamed speakers, and descriptions. */
  added: { names: string[]; descriptions: { name: string; description: string }[] };
}

export interface CustomerStart {
  view: "customer";
  runId: string;
  dashboardUrl: string;
  /** Only when the server laid the script out (COP-47). */
  tidied?: ScriptTidied;
  /** Only when the file described an ad: the script written from it, which the run started on (COP-47). */
  written?: string;
  /** Only with --rewrite-to-fit, when the script didn't fit: the script rewritten to fit, which the run started on (COP-75). */
  rewritten?: string;
}

export interface CustomerStoryboard {
  view: "customer";
  runId: string;
  stage: CustomerRunStage;
  scenes: CustomerRunScene[] | null;
  /** COP-337: no take gets a picture before this approval, and the approve is open. Absent from older servers. */
  noPictureBeforeApproval?: true;
  /**
   * COP-273 P7 stage 3 (convex/videoRunView.ts CustomerCliStoryboard): the run films one video call for one to three
   * sung lines, so a redo of one scene's picture is refused and none is offered. Absent from older servers.
   */
  filmsCalls?: true;
  /** COP-273 P7 stage 4 fix (M2): the run view's `songNotice`, as it is. Absent otherwise, and from older servers. */
  songNotice?: string[];
  /** #4825: the run waits at its storyboard before any picture is drawn. Absent from older servers. */
  beforePictures?: true;
  /** #4825: what the check before pictures found, which approving accepts. Absent when none, and from older servers. */
  findings?: CustomerPlanFinding[];
  /**
   * COP-387: the long or product words of a One-take script the brand's dictionary has no "said as" for yet, as the
   * script writes them. Absent when none, and from older servers.
   */
  hardWords?: string[];
  /** COP-381: take 1's openings to pick from on a One-take run, the first picked. Absent otherwise, and from older servers. */
  openings?: StoryboardOpening[];
  /** COP-381 landing review (#4995): their code, which an approve with --opening sends back with --openings. */
  openingsDigest?: string;
  /**
   * COP-380 landing: the face, the place and the cut-out a One-take board drew, or tried to draw, before this stop, each
   * drawn or not and the line its check left (never an address: the run's page shows them). Absent otherwise.
   */
  pictures?: { face?: StoryboardPicture; place?: StoryboardPicture; cutout?: StoryboardPicture };
  /** COP-388 landing: a product with no photo, its server's line. Absent otherwise, and from older servers. */
  productNoPhoto?: { name: string; line: string };
  /** COP-393: the end card the board drew, drawn or not (never its address). Absent otherwise, and from older servers. */
  endCard?: StopEndCard;
  /** B-roll, inserts and overlays: the plan's list and its code. Absent otherwise, and from older servers. */
  cutaways?: StopCutaways;
  /** In place of `cutaways`: the one sentence of a plan that cannot be read. */
  cutawaysUnread?: string;
}

/** COP-381: one opening a storyboard offers to pick from, in plain words, as the server sends it. */
/** COP-380 landing: one picture drawn before the stop, as the storyboard answer names it. */
export interface StoryboardPicture {
  drawn: boolean;
  check?: string;
}

/** COP-380 landing: the storyboard's pictures as the status command's lines print them (stopPictureLines). */
function storyboardPictureLines(pictures: CustomerStoryboard["pictures"], page: string): string[] {
  if (!pictures) return [];
  const as = (picture: StoryboardPicture | undefined) =>
    picture ? { imageUrl: picture.drawn ? page : null, ...(picture.check ? { check: { line: picture.check } } : {}) } : undefined;
  const lines = stopPictureText(stopPictureLines({ face: as(pictures.face), place: as(pictures.place), cutout: as(pictures.cutout) }, page));
  return lines.length > 0 ? ["", ...lines] : [];
}

export interface StoryboardOpening {
  name: string;
  seen: string;
  words: string | null;
}

/**
 * COP-381: take 1's openings to pick from, numbered as --opening takes them, the first picked, and the approve that
 * picks another. Nothing for a storyboard with one opening or none. Landing review (#4995): the approve carries the
 * openings' code (--openings), so a pick names an opening of the storyboard listed here, never of one made again since.
 * COP-380 landing: at a stop the check before filming holds (`acceptFindings`), the pick carries --accept-findings, as the
 * approve there must, or the server refuses it.
 */
export function openingLines(openings: readonly StoryboardOpening[] | undefined, id: string, digest?: string, acceptFindings = false, itemsCode?: string): string[] {
  if (!openings || openings.length < 2) return [];
  return [
    "",
    `Take 1's opening, its first 2 seconds: pick 1 of ${openings.length}. Opening 1 is picked.`,
    ...openings.flatMap((opening, i) => [
      `  ${i + 1}. ${opening.name}`,
      `     ${opening.seen}`,
      ...(opening.words ? [`     Words on screen: "${opening.words}"`] : []),
    ]),
    // COP-380 landing: at a held stop the pick says what it accepts, as the approve line does (acceptFindingsLine).
    acceptFindings
      ? `pick another opening, accepting what the check found:  exodus video approve ${id} --opening <n>${digest ? ` --openings ${digest}` : ""}${itemsCode ? ` --items ${itemsCode}` : ""} --accept-findings`
      : `pick another opening: exodus video approve ${id} --opening <n>${digest ? ` --openings ${digest}` : ""}${itemsCode ? ` --items ${itemsCode}` : ""}`,
  ];
}

/** COP-393: the end card's lines on `exodus video storyboard`, where the member approves, after a blank line. */
function storyboardEndCardLines(board: { endCard?: StopEndCard; runId: string }, page: string): string[] {
  const lines = endCardLines(board.endCard, board.runId, page);
  return lines.length > 0 ? ["", ...lines] : [];
}

/** COP-388 landing: the no-photo line on `exodus video storyboard`, where the member approves, after a blank line. */
function storyboardNoPhotoLines(board: { productNoPhoto?: { line: string } }): string[] {
  return board.productNoPhoto ? ["", ...noPhotoLines(board)] : [];
}

/**
 * COP-387: the script's long or product words with no "said as" yet, and the command that adds how one is said
 * (`exodus brand dictionary add`, the Dictionary's own add); a row added before the approve is said in this video's
 * takes. None with no such word.
 */
function hardWordLines(words: readonly string[] | undefined): string[] {
  if (!words?.length) return [];
  return [
    "",
    `Long or product words with no "said as" yet: ${words.join(", ")}`,
    `Add how one is said, before you approve: exodus brand dictionary add "${words[0]}" --say "<how it is said>"`,
    "A change to a word already in your dictionary applies from the next video.",
  ];
}

/** #4825: one thing the check before pictures found, in the server's sentence, with the scenes it names. */
export interface CustomerPlanFinding {
  text: string;
  scenes: number[];
}

/** #4825: each finding on its own line, led by the scenes it names ("Scene 4:", "Scenes 2 and 4:"). */
function findingLines(findings: readonly CustomerPlanFinding[] | undefined): string[] {
  return (findings ?? []).map((f) => {
    const n = f.scenes;
    const where = n.length === 0 ? "" : n.length === 1 ? `Scene ${n[0]}: ` : `Scenes ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}: `;
    return `  ${where}${f.text}`;
  });
}

/** #4825: the approve that goes on past the check's findings, said with what it means. */
function acceptFindingsLine(id: string): string {
  return `Go on anyway, accepting what the check found:  exodus video approve ${id} --accept-findings`;
}

export interface CustomerItem {
  sceneIndex: number;
  kind: "clip" | "voice" | "music";
  status: "ready" | "working" | "failed";
  url: string | null;
  speech?: SpeechSummary;
  /** COP-273 P4f: a ready clip that is one video call of one to three sung lines: where its lines start in the call's stretch (s). */
  songCall?: { sceneIndex: number; fromSec: number; seconds: number };
}

export interface CustomerItems {
  view: "customer";
  items: CustomerItem[];
}

export interface CustomerVoices {
  view: "customer";
  runId: string;
  canChange: boolean;
  whyNot: string | null;
  cast: Array<{
    characterId: string;
    name: string;
    voice: { voiceId: string; name: string | null } | null;
  }>;
  options: Array<{ voiceId: string; name: string; description?: string }>;
}

export interface CustomerOk {
  view: "customer";
  ok: true;
}

export interface CustomerFinal {
  view: "customer";
  finalWatchUrl: string;
  delivered: boolean;
}

/** The one check every flow makes on a response body: is this the customer tier's answer? */
export function customerAnswer<T extends { view: "customer" }>(data: unknown): T | null {
  return typeof data === "object" && data !== null && (data as { view?: unknown }).view === "customer"
    ? (data as T)
    : null;
}

/** The customer's run page. The start answer names it; every other answer is built from the run id. */
export function customerRunPage(dashboardUrl: string, runId: string): string {
  return `${dashboardUrl}/video/runs/${runId}`;
}

/**
 * COP-319: a link the server built, on the dashboard this CLI talks to (EXODUS_DASHBOARD_URL): its path and query
 * kept, its host the CLI's, as the run links are. The server builds links on its own host, which a sandbox without
 * DASHBOARD_URL gives as http://localhost:3000. Only an http or https link is moved; an empty, unreadable or other link
 * is left as it is. The path, query and fragment are kept as the server wrote them, character for character (landing
 * review: rebuilding them through URL re-encoded characters such as `<`).
 */
export function onOwnDashboard(serverUrl: string, dashboardUrl: string): string {
  if (serverUrl === "" || dashboardUrl === "") return serverUrl;
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return serverUrl;
  } catch {
    return serverUrl;
  }
  const rest = serverUrl.replace(/^https?:\/\/[^/?#]*/i, "");
  return `${dashboardUrl.replace(/\/+$/, "")}${rest}`;
}

/** Stages a waiting CLI keeps polling through; any other stage needs the customer. */
export function customerStageIsWorking(stage: CustomerRunStage): boolean {
  return (
    stage === "waiting" ||
    stage === "planning" ||
    stage === "drawing" ||
    stage === "filming" ||
    stage === "editing"
  );
}

/**
 * #4954: what a voice-only Try again costs: the voice change and its listens on the member's ElevenLabs key, and the
 * accent listen on the run's spend (about $0.20 at most, when the listen needs a reference voice). No check runs again.
 */
export const VOICE_RETRY_COST = "it costs only cents";

/**
 * #4954: the filming sentence, unless a scene's voice change is being tried again: that films nothing, so it is said
 * as what it is, alone when nothing else is being made.
 */
function filmingSentence(run: CustomerRun): string {
  const scenes = run.scenes ?? [];
  const voice = scenes.filter((s) => s.clip?.voiceRetrying).map((s) => s.sceneIndex);
  if (voice.length === 0) return WORKING_SENTENCE.filming;
  const names = voice.length === 1 ? `scene ${voice[0]}'s voice` : `the voices of scenes ${voice.slice(0, -1).join(", ")} and ${voice.at(-1)}`;
  const filming = scenes.some((s) => (s.clip?.status === "generating" || s.clip?.status === "queued") && !s.clip.voiceRetrying);
  return filming
    ? `${WORKING_SENTENCE.filming} We're also changing ${names} again on the clip${voice.length === 1 ? " it has" : "s they have"}; nothing is filmed for ${voice.length === 1 ? "it" : "them"}.`
    : `Changing ${names} again on the clip${voice.length === 1 ? " it already has" : "s they already have"}. Nothing is filmed.`;
}

const WORKING_SENTENCE: Record<"planning" | "drawing" | "filming" | "editing", string> = {
  planning: "Planning your video: reading your script and planning each scene.",
  drawing: "Drawing your scenes. Each one is drawn before filming starts.",
  filming: "Filming your scenes. Each scene is being turned into a video clip.",
  editing: "Putting it all together. Your clips are being joined into one video.",
};

function waitingSentence(waiting: CustomerRun["waiting"]): string {
  const ahead = waiting?.ahead ?? 0;
  const start = waiting && waiting.stepsDone > 0 ? "Waiting to continue." : "Waiting to start.";
  const line = ahead > 0 ? ` ${ahead} ${ahead === 1 ? "video is" : "videos are"} ahead of this one.` : "";
  return `${start}${line} It starts as soon as a spot opens.`;
}

function stoppedLines(run: CustomerRun, page: string): string[] {
  const reason = run.stopReason;
  if (reason?.kind === "out-of-credits") {
    return [
      "Video making is paused on our side. Our video service ran out of credits partway through this video. This isn't anything you did, and the team has been told.",
      `Once it's back, try again from the video's page: ${page}`,
    ];
  }
  if (reason?.kind === "openrouter-out-of-credits") {
    return [
      "Your OpenRouter balance is too low to finish this video.",
      "Add credits to your OpenRouter account at openrouter.ai, then try again from the video's page. The OpenRouter key this video uses is in Settings → API Keys.",
    ];
  }
  if (reason?.kind === "plan-too-big") {
    return [
      "This video's plan came out too big to make in one go.",
      `Try again from the video's page and it will be planned fresh: ${page} If it stops here again, try a shorter script.`,
    ];
  }
  if (reason?.kind === "plan-rejected") {
    return [
      "This video's plan didn't pass our checks.",
      `Try again from the video's page: ${page} If it stops here again, try a shorter script or another kind of ad.`,
    ];
  }
  if (reason?.kind === "keys-missing") {
    return [
      `This video stopped because ${reason.keys.length === 1 ? "a key is" : "some keys are"} missing (${reason.keys.join(", ")}).`,
      `Add ${reason.keys.length === 1 ? "it" : "them"} in Settings → API Keys, then try again from the video's page.`,
    ];
  }
  if (reason?.kind === "stop-sentence") {
    return [
      "Here's why this video stopped.",
      reason.sentence,
      run.canRetry ? `Try again from the video's page: ${page}` : "Start a new one from the Video page.",
    ];
  }
  if (run.cutFailure && run.canCutAgain) {
    return [
      "The final cut didn't work.",
      run.cutFailure.sentence,
      `All your clips are done. Cut again from the video's page; it makes no new clips and costs nothing: ${page}`,
    ];
  }
  return run.canRetry
    ? ["Something went wrong making this video.", `Try again from the video's page: ${page}`]
    : ["Something went wrong making this video. Start a new one from the Video page."];
}

/**
 * COP-344: what the final approve does, said where the CLI offers it (the final watch's stop, a Guided video's "finish
 * it") with the meaning of the run page's Finish here (run-clips.tsx) and the video skill's Approve line. A person's
 * sign-off is stamped with its approver (convex workflows.ts claimRunForApprovalInner), so the delivery is not one a
 * redo reopens (autoCut.ts reopenableDelivery), and a retry, a clip redo or an upload on it is refused. No code posts a
 * video to an ad account. Never "nowhere": a delivery also goes to a Drive folder or a webhook its workflow names, and
 * a video tester's to the eval app.
 * A run from a template does not say it can't be undone: a preparation redo may reopen its delivery after the approve
 * (convex templatePreparationJournal.ts reopenPreparationForMemberRedo, workflows.ts resetCheckpointNode).
 */
const FOR_GOOD = "It can't be undone; a change after it is a new run.";

export function finalApproveLines(template: boolean): string[] {
  return [
    template ? "Approving makes this cut the run's finished video." : `Approving makes this cut the run's finished video. ${FOR_GOOD}`,
    // The final watch's own guard (#1704): no pull or upload line beside a cut already in.
    "Nothing is posted to an ad account; the video stays on its page.",
  ];
}

/** COP-344: said once the final approve went through, in place of a bare "Approved.". */
export function finalApprovedLines(template: boolean): string[] {
  return [
    template ? "Approved. This cut is now the run's finished video." : `Approved. This cut is now the run's finished video. ${FOR_GOOD}`,
    "Nothing is posted to an ad account. The video stays on its page, and exodus video pull saves it.",
  ];
}

/** Where the run is, in the run page's words. */
export function customerStageLines(run: CustomerRun, page: string): string[] {
  const id = run.runId;
  const audition = run.templateApproval?.audition;
  if (audition) return [
    `Audition held: planned scenes ${audition.sceneIndexes.join(", ")}. Watch their clips on ${page}`,
    audition.invalidated ? "The bound inputs changed. Start a new run; the remaining batch was not ordered."
      : audition.retryBlocked ? AUDITION_RESTART_REASON
      : audition.ready ? `Accept only after watching: exodus video approve ${id} --audition ${audition.digest}`
      : `Approve another paid attempt for failed audition takes only: exodus video approve ${id}. Completed takes are kept; the remaining batch stays held.`,
  ];
  switch (run.stage) {
    // #4761: a scene already waiting on the member is said whatever else the run is doing.
    case "waiting":
      return [waitingSentence(run.waiting), ...waitingSceneLines(run, page)];
    case "filming":
      return [filmingSentence(run), ...waitingSceneLines(run, page)];
    case "planning":
    case "drawing":
    case "editing":
      return [WORKING_SENTENCE[run.stage], ...waitingSceneLines(run, page)];
    case "picking":
      return ["This video is waiting for its picks: a face, a voice and a room for each part. The team makes them for now."];
    case "pilot":
      return [
        "Your pilot clip is being checked: one clip is made first, so a wrong voice or face is caught before the others are made. The team checks it, and redoes it if needed, before the others are made.",
        `Watch it here: ${page}`,
      ];
    case "review":
      // #4825: the check before pictures stopped the video here (a One-shot one too, as its start promised).
      if (run.planHold?.acceptFindings) {
        return [
          ...(run.planHold.notes?.length ? run.planHold.notes : ["The app's check found a problem with this plan."]),
          ...findingLines(run.planHold.findings),
          // COP-375: the run's page shows the place's picture; its own address is never printed. COP-380: and the face
          // photo's and the cut-out's. COP-380 (C6): each with its check's line.
          ...stopPictureText(stopPictureLines(run, page).filter((picture) => picture.drawn)),
          // COP-388 landing: a product with no photo is said at this stop too.
          ...noPhotoLines(run),
          // COP-393: the end card the board drew, and how to drop it.
          ...endCardLines(run.endCard, id, page),
          // B-roll, inserts and overlays: the plan's list, whose code the approve below must carry (a Guided board held
          // for a short take, COP-386).
          ...cutawayLines(run.cutaways, id),
          ...cutawayUnreadLines(run),
          `Read it:      exodus video storyboard ${id}`,
          withItemsCode(acceptFindingsLine(id), id, run.cutaways),
          `If the check is right, stop this video on its page and start a new one with your script changed: ${page}`,
        ];
      }
      // COP-351: the place too, only when the view carries it (the board drew it, or tried to, before the stop). COP-380:
      // and the face photo and the cut-out it drew with it.
      const pictures = noPictureBeforeApproval(run) ? stopPictureLines(run, page) : [];
      // COP-393: the end card is named among them only when one is shown.
      const card = run.endCard?.state === "ready" ? ["end card"] : [];
      if (pictures.length > 0) {
        return [
          `Your ${listedWords(["script", ...pictures.map((picture) => picture.noun), ...card, "voice"])} are waiting for your yes. No take is filmed before you approve.`,
          ...stopPictureText(pictures),
          ...noPhotoLines(run),
          ...endCardLines(run.endCard, id, page),
          ...extraShotLines(run, id),
          `Read them:    exodus video storyboard ${id}`,
          // B-roll, inserts and overlays: with a plan, its list, its code and the approve that carries it (cutawayLines).
          ...(run.cutaways ? cutawayLines(run.cutaways, id, { approve: `Approve them: exodus video approve ${id}` }) : [...cutawayUnreadLines(run), `Approve them: exodus video approve ${id}`]),
        ];
      }
      if (noPictureBeforeApproval(run)) {
        return [
          card.length > 0
            ? "Your script, end card and voice are waiting for your yes. No take gets a picture before you approve."
            : "Your script and voice are waiting for your yes. No take gets a picture before you approve.",
          ...noPhotoLines(run),
          ...endCardLines(run.endCard, id, page),
          ...extraShotLines(run, id),
          `Read them:    exodus video storyboard ${id}`,
          // B-roll, inserts and overlays: with a plan, its list, its code and the approve that carries it (cutawayLines).
          ...(run.cutaways ? cutawayLines(run.cutaways, id, { approve: `Approve them: exodus video approve ${id}` }) : [...cutawayUnreadLines(run), `Approve them: exodus video approve ${id}`]),
        ];
      }
      return [
        "Your storyboard is ready for your review.",
        // P7 stage 4 fix (M2): what the song step said of the kept take, read first.
        ...songNoticeLines(run.songNotice),
        // B-roll, inserts and overlays: the list above the approve whose code it carries (Neon, landing review).
        ...cutawayLines(run.cutaways, id),
        ...cutawayUnreadLines(run),
        `See it:      exodus video storyboard ${id}`,
        ...(songCallsProblem(run.songCalls) ? [] : [withItemsCode(`Approve it:  exodus video approve ${id}`, id, run.cutaways)]),
        // P7 stage 4: a sung run filmed in calls: the pictures each call is filmed from (none on any other run).
        ...songCallStopLines(run.songCalls, page),
      ];
    case "ready":
      return [
        ...(run.awaitingSignOff
          ? [
              // COP-375: the finished video's own address is never printed; the block ends with its page.
              "Your video is ready to watch.",
              // #4761: the finish refuses while a scene waits on the member (a flagged clip nobody kept).
              ...waitingSceneLines(run, page),
              waitingSceneLines(run, page).length > 0
                ? `Once each one is answered and you're happy with the video, finish it:  exodus video approve ${id}`
                : `When you're happy with it, finish it:  exodus video approve ${id}`,
            ]
          : ["Your video is ready."]),
        ...speechSummaryLines(run.video?.speech),
        ...(run.video?.notes ?? []),
        // COP-393: what became of the end card the lock asked for, after the cut's own notes.
        ...(run.video?.endCard ? [run.video.endCard.line] : []),
        // B-roll, inserts and overlays: what became of each planned item, and what it cost.
        ...filmCutawayLines(run.video?.cutawayLines),
        ...(run.video?.wordsOff
          ? ["Some words may not match your script exactly. Watch it through before you post it."]
          : []),
        // COP-344: after the cut's own notes, which a convex test reads right under the finish line.
        // #4761: not while a scene waits on the member, since the finish refuses until each one is answered.
        ...(run.awaitingSignOff && waitingSceneLines(run, page).length === 0 ? finalApproveLines(run.template === true) : []),
        `Download the pieces for your own cut: exodus video pull ${id} --out ./video-${id}`,
      ];
    case "failed":
      return run.cutHolds?.length ? heldLines(run, page) : stoppedLines(run, page);
    case "cancelled":
      return ["This video was stopped."];
  }
}

export function customerStatusLines(run: CustomerRun, dashboardUrl: string): string[] {
  const page = customerRunPage(dashboardUrl, run.runId);
  return [
    `Video ${run.runId}: ${run.title}`,
    ...(run.card ? [`${run.card.conceit}, ${run.card.style}`] : []),
    run.mode === "guided" ? "Storyboard first" : "In one go",
    "",
    ...customerStageLines(run, page),
    ...(run.spend ? [run.spend.line, ...(run.spend.storyboardEstimate ? [run.spend.storyboardEstimate.sentence] : [])] : []),
    ...spendAskLines(run, run.runId),
    ...(run.scenes ?? []).flatMap(scene => scene.clip?.speech
      ? [`Scene ${scene.sceneIndex} speech:`, ...speechSummaryLines(scene.clip.speech).map(line => `  ${line}`)] : []),
    "",
    `Watch it on the dashboard: ${page}`,
  ];
}

/** COP-375: whether each scene's picture is drawn, never its address; the run's page shows the pictures. */
function sceneLines(scene: CustomerRunScene): string[] {
  const lines = [`  Scene ${scene.sceneIndex}`, `    ${scene.line ? `"${scene.line}"` : "No spoken line"}`];
  if (scene.frameStatus === "ready" && scene.imageUrl) lines.push("    picture: drawn");
  else if (scene.frameStatus === "failed") lines.push("    picture: couldn't be drawn");
  else lines.push("    picture: drawing…");
  if (scene.frameStatus === "ready" && scene.productNote) lines.push(`    ${scene.productNote}`);
  return lines;
}

/**
 * `page` is the run's page (customerRunPage), where the storyboard's pictures are seen (COP-375).
 * P7 stage 4 fix (S6): `songCalls` is the run answer's (customerRunViewOf), read by `exodus video storyboard` on a run
 * filmed in calls: status lists the calls' pictures only once the board step is done, never at a storyboard held for a
 * review first, so the pointer to status is said only when they are listed.
 */
export function customerStoryboardLines(board: CustomerStoryboard, page: string, songCalls?: unknown): string[] {
  const id = board.runId;
  const notice = songNoticeLines(board.songNotice);
  if (board.stage !== "review" || !board.scenes) {
    return [
      "This video isn't waiting for you to review its storyboard right now.",
      `Check where it is: exodus video status ${id}`,
    ];
  }
  const scriptLines = (scenes: CustomerRunScene[]) =>
    scenes.flatMap((scene) => [`  Scene ${scene.sceneIndex}`, `    ${scene.line ? `"${scene.line}"` : "No spoken line"}`]);
  // #4825: the check before pictures' findings, which the approve below accepts.
  const found = board.findings?.length ? ["", "What the app's check found:", ...findingLines(board.findings)] : [];
  const approve = withItemsCode(board.findings?.length ? acceptFindingsLine(id) : `approve with: exodus video approve ${id}`, id, board.cutaways);
  // B-roll, inserts and overlays: the plan's list, where the member approves, after a blank line.
  const unread = cutawayUnreadLines(board);
  const cutaways = board.cutaways ? ["", ...cutawayLines(board.cutaways, id)] : unread.length > 0 ? ["", ...unread] : [];
  // COP-337: a stop that draws no picture before its approval is the takes' script, with nothing to wait for.
  if (board.noPictureBeforeApproval) {
    return [
      "Script",
      ...scriptLines(board.scenes),
      ...found,
      // COP-380 landing: the face, the place and the cut-out drawn before this stop, with their checks.
      ...storyboardPictureLines(board.pictures, page),
      // COP-388 landing: a product with no photo, under the pictures.
      ...storyboardNoPhotoLines(board),
      // COP-393: the end card the board drew, and how to drop it.
      ...storyboardEndCardLines(board, page),
      ...hardWordLines(board.hardWords),
      ...cutaways,
      // COP-381: take 1's openings to pick from, numbered.
      ...openingLines(board.openings, id, board.openingsDigest, (board.findings?.length ?? 0) > 0, board.cutaways?.code),
      "",
      "No take gets a picture before you approve.",
      approve,
      `pick voices: exodus video voices ${id}`,
    ];
  }
  // #4825: a stop before any picture (the check before pictures stopped the plan) has no picture to wait for.
  if (board.beforePictures) {
    return [
      "Storyboard",
      ...scriptLines(board.scenes),
      ...found,
      ...hardWordLines(board.hardWords),
      ...storyboardNoPhotoLines(board),
      ...storyboardEndCardLines(board, page),
      ...cutaways,
      "",
      "No scene pictures are drawn before you approve. Any pictures of the people or the place were drawn already, inside the price you were shown.",
      approve,
      // COP-273 P9 again, fix: a run filmed in calls is sung, and the song is its voice: no voice to pick.
      ...(board.filmsCalls ? [] : [`pick voices: exodus video voices ${id}`]),
    ];
  }
  // P7 stage 4: a run filmed in calls draws no scene picture (scout scene-frames.ts: no output, the stop kept), so no
  // scene is "drawing" and the approve is open; the song step ran before this stop, so the voice door is shut
  // (convex/lib/workflow/castVoices.ts voiceDoor "clips-started"), and a song has no voice to pick: none is offered.
  if (board.filmsCalls) {
    const listed = isObject(songCalls) && Array.isArray(songCalls.calls);
    const problem = isObject(songCalls) && typeof songCalls.problem === "string" ? songCalls.problem : null;
    return [
      "Storyboard",
      ...board.scenes.flatMap((scene) => [`  Scene ${scene.sceneIndex}`, `    ${scene.line ? `"${scene.line}"` : "No spoken line"}`]),
      "",
      ...notice,
      SONG_CALL_NO_SCENE_PICTURES,
      listed
        ? `See the pictures each video call is filmed from: exodus video status ${id}`
        : problem ?? "No picture a video call is filmed from is listed yet.",
      SONG_CALL_NO_ONE_SCENE,
      ...cutaways,
      withItemsCode(`approve with: exodus video approve ${id}`, id, board.cutaways),
    ];
  }
  const stillDrawing = board.scenes.some((s) => s.frameStatus === "pending" || s.frameStatus === "drawing");
  return [
    "Storyboard",
    ...board.scenes.flatMap(sceneLines),
    ...hardWordLines(board.hardWords),
    ...storyboardNoPhotoLines(board),
    ...cutaways,
    "",
    ...notice,
    stillDrawing
      ? "Waiting for every scene to finish drawing before you can approve."
      : withItemsCode(`approve with: exodus video approve ${id}`, id, board.cutaways),
    `redo one scene's picture: exodus video retry-frame ${id} --scene <n>`,
    `pick voices: exodus video voices ${id}`,
    `See the pictures: ${page}`,
  ];
}

export function customerVoicesLines(voices: CustomerVoices): string[] {
  const lines = [`Voices for video ${voices.runId}`];
  if (voices.cast.length === 0) lines.push("  Nobody speaks in this video yet.");
  for (const member of voices.cast) {
    const voice = member.voice
      ? `${member.voice.name ?? "a voice you picked"} (${member.voice.voiceId})`
      : "no voice chosen yet";
    lines.push(`  ${member.characterId}  ${member.name}  ${voice}`);
  }
  if (voices.canChange) {
    lines.push("", voices.options.length > 0 ? "Voices you can pick:" : "Your ElevenLabs account has no voices to pick from.");
    for (const option of voices.options) {
      lines.push(`  ${option.voiceId}  ${option.name}${option.description ? `: ${option.description}` : ""}`);
    }
    lines.push(
      "",
      `Pick one: exodus video voices ${voices.runId} --set <character>=<voiceId>`,
      "You can change voices until you approve the storyboard.",
    );
  } else {
    lines.push("", voices.whyNot ?? "Voices can no longer be changed on this video.");
  }
  return lines;
}
