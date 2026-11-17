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
  clip?: { speech?: SpeechSummary; redoEstimateUsd?: number; redoEstimateMaxUsd?: number } | null;
}

/** COP-277, #4733: one scene the cut waits on, in the server's sentence. */
/** #4755: `voice`, held only for its voice change, which `exodus video revoice` tries again without filming. */
/** `voiceLocked`, and on a kind that locks every voice, so it can't be kept as it is. */
export type CustomerHeldScene = { sceneIndex: number; sentence: string; take: boolean; unfilmed?: true; voice?: true; voiceLocked?: true };

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
  video: { url: string; wordsOff: boolean; speech?: SpeechSummary; notes?: string[] } | null;
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
   * address, null when none came out. Absent when the board drew none, and from older servers.
   */
  place?: { name: string; look: string; imageUrl: string | null };
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
  // A One-take take is never made again on its own; a scene with no clip has nothing to keep.
  const price = tryAgainPrice(run, scenes.filter((s) => !s.take).map((s) => s.sceneIndex));
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
  const inParens = (price: string) => (price ? ` (${price})` : "");
  const unfilmedPrice = inParens(tryAgainPrice(run, unfilmed.map((s) => s.sceneIndex)));
  const faultPrice = inParens(tryAgainPrice(run, faults.map((s) => s.sceneIndex)));
  return [
    ...scenes.map((s) => `  Scene ${s.sceneIndex}: ${s.sentence}`),
    ...(unfilmed.length > 0
      ? [`${unfilmed.length === 1 ? "Film it" : "Film each one"} with Try again on the video's page, which shows the price first${unfilmedPrice}: ${page}`]
      : []),
    ...takes.map((s) =>
      takes.length === 1
        ? `Keep it as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`
        : `Keep scene ${s.sceneIndex} as it is: exodus video keep ${run.runId} --scene ${s.sceneIndex}`,
    ),
    ...voices.flatMap((s) => [
      `Try scene ${s.sceneIndex}'s voice change again (nothing is filmed): exodus video revoice ${run.runId} --scene ${s.sceneIndex}`,
      ...(s.voiceLocked
        ? []
        : [`Or keep scene ${s.sceneIndex} in the voice it was filmed in: exodus video keep ${run.runId} --scene ${s.sceneIndex}`]),
    ]),
    ...(faults.length > 0
      ? [
          `${faults.length === 1 ? "Make it again" : "Make each one again"} with Try again, or keep it as it is, on the video's page. Try again shows the price first${faultPrice}: ${page}`,
          ...faults.map((s) => `Or keep ${faults.length === 1 ? "it" : `scene ${s.sceneIndex}`} as it is from here: exodus video keep ${run.runId} --scene ${s.sceneIndex}`),
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
  /** #4825: the run waits at its storyboard before any picture is drawn. Absent from older servers. */
  beforePictures?: true;
  /** #4825: what the check before pictures found, which approving accepts. Absent when none, and from older servers. */
  findings?: CustomerPlanFinding[];
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
    case "planning":
    case "drawing":
    case "filming":
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
          // COP-375: the run's page shows the place's picture; its own address is never printed.
          ...(run.place?.imageUrl ? [`The place:    drawn. See it: ${page}`] : []),
          `Read it:      exodus video storyboard ${id}`,
          acceptFindingsLine(id),
          `If the check is right, stop this video on its page and start a new one with your script changed: ${page}`,
        ];
      }
      // COP-351: the place too, only when the view carries it (the board drew it, or tried to, before the stop).
      if (noPictureBeforeApproval(run) && run.place) {
        return [
          "Your script, place and voice are waiting for your yes. No take is filmed before you approve.",
          run.place.imageUrl
            ? `The place:    drawn. See it: ${page}`
            : "The picture of the place didn't come out. It is drawn when you approve, before the takes are filmed.",
          `Read them:    exodus video storyboard ${id}`,
          `Approve them: exodus video approve ${id}`,
        ];
      }
      if (noPictureBeforeApproval(run)) {
        return [
          "Your script and voice are waiting for your yes. No take gets a picture before you approve.",
          `Read them:    exodus video storyboard ${id}`,
          `Approve them: exodus video approve ${id}`,
        ];
      }
      return [
        "Your storyboard is ready for your review.",
        `See it:      exodus video storyboard ${id}`,
        `Approve it:  exodus video approve ${id}`,
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

/** `page` is the run's page (customerRunPage), where the storyboard's pictures are seen (COP-375). */
export function customerStoryboardLines(board: CustomerStoryboard, page: string): string[] {
  const id = board.runId;
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
  const approve = board.findings?.length ? acceptFindingsLine(id) : `approve with: exodus video approve ${id}`;
  // COP-337: a stop that draws no picture before its approval is the takes' script, with nothing to wait for.
  if (board.noPictureBeforeApproval) {
    return [
      "Script",
      ...scriptLines(board.scenes),
      ...found,
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
      "",
      "No scene pictures are drawn before you approve. Any pictures of the people or the place were drawn already, inside the price you were shown.",
      approve,
      `pick voices: exodus video voices ${id}`,
    ];
  }
  const stillDrawing = board.scenes.some((s) => s.frameStatus === "pending" || s.frameStatus === "drawing");
  return [
    "Storyboard",
    ...board.scenes.flatMap(sceneLines),
    "",
    stillDrawing
      ? "Waiting for every scene to finish drawing before you can approve."
      : `approve with: exodus video approve ${id}`,
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
