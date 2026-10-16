/**
 * #3251: what the video routes answer a beta tester, and how the CLI words it.
 *
 * These mirror the server's allowlisted bodies (CustomerCli* in
 * convex/videoRunView.ts, CustomerRunView in convex/lib/video/customerRunView.ts).
 * Every one carries `view: "customer"`, so a flow branches on the answer it got
 * and never on who the caller is. This package ships on its own schedule, so the
 * types are copied here rather than imported.
 */

export type CustomerRunStage =
  | "waiting"
  | "planning"
  | "drawing"
  | "filming"
  | "editing"
  | "review"
  | "ready"
  | "failed"
  | "cancelled";

export interface CustomerRunScene {
  sceneIndex: number;
  line: string | null;
  imageUrl: string | null;
  frameStatus: "pending" | "drawing" | "ready" | "failed";
  productNote?: string;
}

export type CustomerStopReason =
  | { kind: "out-of-credits" }
  | { kind: "openrouter-out-of-credits" }
  | { kind: "plan-too-big" }
  | { kind: "keys-missing"; keys: string[] };

export interface CustomerRun {
  view: "customer";
  isTerminal: boolean;
  runId: string;
  title: string;
  card: { conceit: string; style: string } | null;
  mode: "one-shot" | "guided";
  stage: CustomerRunStage;
  /** #3299: a Guided video's cut is ready and waits for `exodus video approve`. Absent from older servers. */
  awaitingSignOff?: boolean;
  waiting: { ahead: number; stepsDone: number } | null;
  scenes: CustomerRunScene[] | null;
  video: { url: string; wordsOff: boolean } | null;
  canRetry: boolean;
  stopReason: CustomerStopReason | null;
  detailsPath: string | null;
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
}

export interface CustomerStoryboard {
  view: "customer";
  runId: string;
  stage: CustomerRunStage;
  scenes: CustomerRunScene[] | null;
}

export interface CustomerItem {
  sceneIndex: number;
  kind: "clip" | "voice" | "music";
  status: "ready" | "working" | "failed";
  url: string | null;
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
  if (reason?.kind === "keys-missing") {
    return [
      `This video stopped because ${reason.keys.length === 1 ? "a key is" : "some keys are"} missing (${reason.keys.join(", ")}).`,
      `Add ${reason.keys.length === 1 ? "it" : "them"} in Settings → API Keys, then try again from the video's page.`,
    ];
  }
  return run.canRetry
    ? ["Something went wrong making this video.", `Try again from the video's page: ${page}`]
    : ["Something went wrong making this video. Start a new one from the Video page."];
}

/** Where the run is, in the run page's words. */
export function customerStageLines(run: CustomerRun, page: string): string[] {
  const id = run.runId;
  switch (run.stage) {
    case "waiting":
      return [waitingSentence(run.waiting)];
    case "planning":
    case "drawing":
    case "filming":
    case "editing":
      return [WORKING_SENTENCE[run.stage]];
    case "review":
      return [
        "Your storyboard is ready for your review.",
        `See it:      exodus video storyboard ${id}`,
        `Approve it:  exodus video approve ${id}`,
      ];
    case "ready":
      return [
        ...(run.awaitingSignOff
          ? [
              `Your video is ready to watch: ${run.video?.url ?? page}`,
              `When you're happy with it, finish it:  exodus video approve ${id}`,
            ]
          : [`Your video is ready: ${run.video?.url ?? page}`]),
        ...(run.video?.wordsOff
          ? ["Some words may not match your script exactly. Watch it through before you post it."]
          : []),
        `Download the pieces for your own cut: exodus video pull ${id} --out ./video-${id}`,
      ];
    case "failed":
      return stoppedLines(run, page);
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
    "",
    `Watch it on the dashboard: ${page}`,
  ];
}

function sceneLines(scene: CustomerRunScene): string[] {
  const lines = [`  Scene ${scene.sceneIndex}`, `    ${scene.line ? `"${scene.line}"` : "No spoken line"}`];
  if (scene.frameStatus === "ready" && scene.imageUrl) lines.push(`    picture: ${scene.imageUrl}`);
  else if (scene.frameStatus === "failed") lines.push("    picture: couldn't be drawn");
  else lines.push("    picture: drawing…");
  if (scene.frameStatus === "ready" && scene.productNote) lines.push(`    ${scene.productNote}`);
  return lines;
}

export function customerStoryboardLines(board: CustomerStoryboard): string[] {
  const id = board.runId;
  if (board.stage !== "review" || !board.scenes) {
    return [
      "This video isn't waiting for you to review its storyboard right now.",
      `Check where it is: exodus video status ${id}`,
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
