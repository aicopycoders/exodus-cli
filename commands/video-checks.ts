/**
 * COP-470, the checks engine: `exodus video checks <runId>`. It reads GET /api/v2/video/checks, which answers by the
 * key's tier (convex/videoChecksHttp.ts):
 * - a member's key gets the summary (part 13, Dani's rule of Nov 25: a member learns how many checks ran and what is
 *   wrong, never which checks we run or how we check): the count line, then what needs a look, was kept, fixed or
 *   noted, in the server's plain words (convex/lib/video/checks/summary.ts), then how many others passed;
 * - an admin's key gets every saved answer whole, printed by station and item: the check, pass, fail with each fault's
 *   id and sentence, or unknown and why, and what follows.
 *
 * The answer's types mirror the server's (summary.ts MemberCheckSummary, the table's rows). This package ships on its
 * own schedule, so they are copied here rather than imported. A status or a word this file does not know is printed as
 * it came, never a crash.
 */
import { videoApiError, type FlowResult, type VideoDeps } from "./video.js";

export const CHECKS_PATH = "/api/v2/video/checks";
export const NO_CHECK_ANSWERS = "No check answers are saved for this video.";
export const MORE_CHECK_ANSWERS = "This video has more check answers than one read shows; these are the first.";

/** One fault of an admin's row (`fault`, `onFail`), or of an older member row (`follows`). */
export interface CheckAnswerFault {
  fault?: string;
  follows?: string;
  onFail?: { do: string };
  findingCode?: string | null;
  say?: string;
}

/** The member's summary (convex/lib/video/checks/summary.ts MemberCheckSummary). */
export interface CheckSummary {
  ran: number;
  passed: number;
  fixed: number;
  noted: number;
  look: number;
  kept: number;
  items: Array<{ kind: string; scene?: number; title: string; text: string }>;
  delivered?: boolean;
  others?: Array<{ scene: number; text: string | null }>;
  more?: true;
}

export type CheckAnswer = {
  station: string;
  item: string;
  attempt: number;
  check: string;
  version: number;
  savedAt: number;
  /** Who answered: an admin's row says it; a fail by the runner under a check is how a fix of that check ended. */
  by?: string;
  /** How a fix of the check ended, beside the check's own answer (the server sends it after that answer). */
  fixEnded?: boolean;
} & (
  | { status: "pass" }
  | { status: "fail"; faults: CheckAnswerFault[] }
  | { status: "unknown"; why: string; does: string; findingCode?: string; say?: string }
  | { status: "unmeasured"; why: string }
  | { status: "not-applicable" }
  | { status: "not-finished" }
);

/** What follows a fault whose sentence the member reads. */
const FOLLOWS: Readonly<Record<string, string>> = {
  note: "a note only",
  fix: "a fix by code",
  redo: "made again",
  hold: "held for a person",
};
/** A fault whose sentence the member does not read today: only what follows it. */
const FAULT_WITHOUT_SENTENCE: Readonly<Record<string, string>> = {
  note: "A note of our checks.",
  fix: "Our checks fixed this.",
  redo: "Our checks had this made again.",
  hold: "Our checks held this.",
};
const UNKNOWN_DOES: Readonly<Record<string, string>> = {
  "go-on": "the video goes on",
  hold: "held for a person",
  "leave-out": "left out, and the video goes on",
};
const UNKNOWN_WHY: Readonly<Record<string, string>> = {
  "no-answer": "no answer came",
  lost: "the answer was lost",
  "cannot-tell": "it could not tell",
  "could-not-run": "the check could not run",
};
const UNMEASURED_WHY: Readonly<Record<string, string>> = {
  "switched-off": "switched off",
  "not-needed": "not needed",
};

/** The plain words for a value, or the value itself when this file does not know it. */
function wordsFor(table: Readonly<Record<string, string>>, value: unknown): string {
  const key = String(value);
  return Object.hasOwn(table, key) ? table[key] : key;
}

/** A sentence with its own full stop, so a line never ends in two. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function faultLine(fault: CheckAnswerFault): string {
  const follows = fault.follows ?? fault.onFail?.do;
  const id = fault.fault ? `[${fault.fault}] ` : "";
  if (fault.say) return `      - ${id}${sentence(fault.say)} Follows: ${wordsFor(FOLLOWS, follows)}.`;
  const plain = Object.hasOwn(FAULT_WITHOUT_SENTENCE, String(follows)) ? FAULT_WITHOUT_SENTENCE[String(follows)] : null;
  return `      - ${id}${plain ?? `Our checks found something; what follows: ${String(follows)}.`}`;
}

/**
 * How a fix of a check ended, raised under the check beside its own answer: the table's own test of it
 * (video/lib/checks/table.ts `raisedKeyOf` is not empty), copied here, as this package copies the server's types. The
 * kept paid take, which the runner raises under its own name (`runner`), is an answer of its own.
 */
function fixEnded(answer: CheckAnswer): boolean {
  if (answer.status !== "fail" || answer.check === "runner") return false;
  if (answer.fixEnded === true) return true;
  return answer.by === "runner";
}

/** A fail's fault lines; an entry that is no object is skipped. */
function faultLines(faults: unknown): string[] {
  return (Array.isArray(faults) ? faults : []).filter((fault): fault is CheckAnswerFault => typeof fault === "object" && fault !== null).map(faultLine);
}

/** The lines of one answer: its check and what it said, and a fail's faults under it; a fix's end says so. */
function answerLines(answer: CheckAnswer): string[] {
  if (fixEnded(answer) && answer.status === "fail") {
    return [`    ${answer.check} (attempt ${answer.attempt}), how its fix ended:`, ...faultLines(answer.faults)];
  }
  const head = `    ${answer.check} (attempt ${answer.attempt}):`;
  switch (answer.status) {
    case "pass":
      return [`${head} pass`];
    case "fail":
      return [`${head} fail`, ...faultLines(answer.faults)];
    case "unknown": {
      const said = answer.say ? ` ${sentence(answer.say)}` : "";
      return [`${head} unknown, ${wordsFor(UNKNOWN_WHY, answer.why)}.${said} Follows: ${wordsFor(UNKNOWN_DOES, answer.does)}.`];
    }
    case "unmeasured":
      return [`${head} not measured, ${wordsFor(UNMEASURED_WHY, answer.why)}`];
    case "not-applicable":
      return [`${head} does not apply`];
    case "not-finished":
      return [`${head} not finished in this leg; the item waits for the next`];
    default:
      return [`${head} ${String((answer as { status?: unknown }).status)}`];
  }
}

/** One video's answers, station by station and item by item, in the order the server sends them (the run's order). */
export function checkAnswerLines(runId: string, answers: readonly CheckAnswer[], more = false): string[] {
  if (answers.length === 0) return [NO_CHECK_ANSWERS];
  const lines = [`Check answers for video ${runId}:`];
  let station: string | null = null;
  let item: string | null = null;
  for (const answer of answers) {
    if (answer.station !== station) {
      station = answer.station;
      item = null;
      lines.push("", `Station: ${station}`);
    }
    if (answer.item !== item) {
      item = answer.item;
      lines.push(`  Item ${item}`);
    }
    lines.push(...answerLines(answer));
  }
  if (more) lines.push("", MORE_CHECK_ANSWERS);
  return lines;
}

/**
 * "21 checks ran on this video: 17 passed, 3 fixed or noted, 1 kept by you." (numbers only, as the run page says). With
 * more answers than the server read (`more`) no number is exact: "At least 1000 checks ran on this video."
 */
export function summaryCountLine(summary: CheckSummary): string {
  const when = summary.delivered === false ? "so far" : "on this video";
  if (summary.more) return `At least ${summary.ran} ${summary.ran === 1 ? "check" : "checks"} ran ${when}.`;
  const parts = [`${summary.passed} passed`];
  if (summary.noted > 0) parts.push(`${summary.fixed + summary.noted} fixed or noted`);
  else if (summary.fixed > 0) parts.push(`${summary.fixed} fixed for you`);
  if (summary.look > 0) parts.push(`${summary.look} ${summary.look === 1 ? "needs" : "need"} your look`);
  if (summary.kept > 0) parts.push(`${summary.kept} kept by you`);
  return `${summary.ran} ${summary.ran === 1 ? "check" : "checks"} ran ${when}: ${parts.join(", ")}.`;
}

const KIND_ORDER = ["look", "kept", "fixed", "noted"];

/** A member's summary: the count line, each thing to know in the server's words, then how many others passed. */
export function summaryLines(runId: string, summary: CheckSummary | null): string[] {
  if (!summary || !(summary.ran > 0)) return [NO_CHECK_ANSWERS];
  const items = Array.isArray(summary.items) ? summary.items : [];
  const ordered = [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const lines = [`Checks of video ${runId}: ${summaryCountLine(summary)}`];
  if (ordered.length > 0 || summary.passed > 0) lines.push("");
  const others = Array.isArray(summary.others) ? summary.others : [];
  for (const item of ordered) {
    const scene = item.kind === "look" && typeof item.scene === "number" ? `Scene ${item.scene}: ` : "";
    // A reason the saved answers do not hold the scene for, said after the first of its look items.
    const other = scene && ordered.find((i) => i.kind === "look" && i.scene === item.scene) === item ? others.find((o) => o.scene === item.scene)?.text : null;
    lines.push(`  ${scene}${item.title} ${item.text}${other ? ` ${other}` : ""}`);
  }
  if (summary.passed > 0) {
    lines.push(summary.more ? "  Other checks passed." : `  ${summary.passed} ${ordered.length > 0 ? "other " : ""}${summary.passed === 1 ? "check" : "checks"} passed.`);
  }
  return lines;
}

export async function checksFlow(runId: string, json: boolean, deps: Pick<VideoDeps, "get">): Promise<FlowResult> {
  const res = await deps.get(`${CHECKS_PATH}?runId=${encodeURIComponent(runId)}`);
  if (!res.ok) {
    const line = videoApiError(res);
    return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error: line })] : [line] };
  }
  const body = res.data as { view?: unknown; results?: unknown; summary?: unknown; more?: unknown } | null;
  if (body?.view === "member" && body.summary !== undefined && (body.summary === null || typeof body.summary === "object")) {
    const summary = body.summary as CheckSummary | null;
    if (json) return { code: 0, lines: [JSON.stringify({ runId, summary })] };
    return { code: 0, lines: summaryLines(runId, summary) };
  }
  const answers = body?.results;
  if (!Array.isArray(answers)) {
    const line = "The server's answer had no list of check answers. Try again in a minute.";
    return { code: 1, lines: json ? [JSON.stringify({ ok: false, error: line })] : [line] };
  }
  const more = body?.more === true;
  if (json) return { code: 0, lines: [JSON.stringify({ runId, results: answers, ...(more ? { more: true } : {}) })] };
  const shown = answers.filter((answer): answer is CheckAnswer => typeof answer === "object" && answer !== null);
  return { code: 0, lines: checkAnswerLines(runId, shown, more) };
}
