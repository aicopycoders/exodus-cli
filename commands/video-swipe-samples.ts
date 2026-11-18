/**
 * COP-273 P2: `exodus video swipe sheet samples <swipeId>`, samples of the song before the full song on a Suno Pixar
 * Song swipe's sheet (the server's convex/videoSheetSamples.ts, route POST /api/v2/video/swipe-sheet/samples). Paid, so
 * the price comes first: without --yes it says what it buys, about and at most, and makes nothing; --yes --max-usd
 * <the price's most> makes them in the background, --wait waits and lists each take with its address. A take is picked
 * on the sheet with `exodus video swipe sheet set <swipeId> songSample=<n>`, which also sets the kind of music, the sound
 * and the singer to the ones it was sung in.
 *
 * Its own small helpers, and types only from video-swipe.ts, so the two files never load each other at run time.
 */
import type { FlagOccurrence } from "../lib/args.js";
import type { ApiResponse } from "../lib/client.js";
import { formatApiError } from "../lib/format.js";
import { missingRouteLine } from "../lib/route-support.js";
import { describeFetchFailure, type FlowResult, type VideoDeps } from "./video.js";
import { onOwnDashboard } from "./video-customer.js";
import { optionForJson, sectionPageLines, sheetForJson, type SavedSheet, type SwipeOpts, type SwipeRunOptions } from "./video-swipe.js";

export const SWIPE_SHEET_SAMPLES_PATH = "/api/v2/video/swipe-sheet/samples";
/** The server's words when the chooser gave no answer it could use (scout song-samples.ts SAMPLE_CHOOSER_NO_ANSWER). */
const NAME_THE_SOUNDS = "name the sounds yourself";
const SHEET_PATH = "/api/v2/video/swipe-sheet";
/** P7 stage 3: video-swipe.ts SHEET_SOURCES_QUERY, here so the two files never load each other at run time. */
const SOURCES_QUERY = "sources=recommended";
export const SHEET_SAMPLES_LINE =
  "exodus video swipe sheet samples <swipeId> [--sounds <code,code,...> | --count <n>] [--yes --max-usd <n>] [--wait] [--json]";
/** The most sounds one ask may sample: the server's own (video/lib/songSamples.ts SAMPLE_SOUNDS_MOST). */
export const SHEET_SAMPLES_MOST = 4;
/**
 * The other swipe verbs' flags (video-swipe.ts FIND_PAID_FLAGS and FIND_OTHER_FLAGS, as `swipe sheet people` refuses
 * them): typed here they are refused, never dropped in silence. Its own: --sounds, --count, --yes, --max-usd, --wait.
 */
const OTHER_VERBS_FLAGS = new Set([
  "file", "url", "ad", "again", "one-shot", "music", "mode", "closeness", "product", "look", "script", "style", "title", "sheet", "full",
  "status", "persona", "retry-refused", "kind", "brand", "limit",
]);

export interface SheetSamplesPlan {
  kind: "sheet-samples";
  swipeId: string;
  /** The member's own sounds by code; null: chosen for them. */
  sounds: string[] | null;
  count: number | null;
  maxUsd: number | null;
  opts: SwipeOpts;
}

/** `swipe sheet samples ...` read from the words after `sheet` and the flags typed, or the usage line that refuses it. */
export function planSheetSamples(given: string[], occurrences: FlagOccurrence[], opts: SwipeOpts): SheetSamplesPlan | { kind: "usage"; line: string } {
  const usage = (line: string) => ({ kind: "usage" as const, line });
  const other = occurrences.find((o) => OTHER_VERBS_FLAGS.has(o.flag.replace(/^no-/, "")))?.flag;
  if (other) return usage(`video swipe sheet samples takes no --${other}. Its flags: --sounds, --count, --yes, --max-usd, --wait, --json.`);
  const [, swipeId, ...extra] = given;
  if (!swipeId) return usage(`video swipe sheet samples needs a swipe id: ${SHEET_SAMPLES_LINE}`);
  if (extra.length > 0) return usage(`video swipe sheet samples takes one swipe id (got "${extra[0]}"); name the sounds with --sounds: ${SHEET_SAMPLES_LINE}`);
  const typedSounds = occurrences.filter((o) => o.flag === "sounds").at(-1);
  let sounds: string[] | null = null;
  if (typedSounds) {
    const codes = (typedSounds.value ?? "").split(",").map((code) => code.trim()).filter(Boolean);
    if (codes.length < 1 || codes.length > SHEET_SAMPLES_MOST || (typedSounds.value ?? "").startsWith("--")) {
      return usage(`video swipe sheet samples --sounds takes 1 to ${SHEET_SAMPLES_MOST} sound codes, with commas between them, as the sheet lists them (got "${typedSounds.value ?? ""}").`);
    }
    sounds = codes;
  }
  const typedCount = occurrences.filter((o) => o.flag === "count").at(-1);
  let count: number | null = null;
  if (typedCount) {
    if (sounds) return usage("video swipe sheet samples takes --sounds or --count, not both: --count is how many sounds to choose for you.");
    const n = typedCount.value !== undefined && /^\d+$/.test(typedCount.value.trim()) ? Number(typedCount.value.trim()) : Number.NaN;
    if (!(n >= 1 && n <= SHEET_SAMPLES_MOST)) return usage(`video swipe sheet samples --count takes 1 to ${SHEET_SAMPLES_MOST} (got "${typedCount.value ?? ""}").`);
    count = n;
  }
  if (opts.wait && !opts.yes) return usage("video swipe sheet samples --wait waits for samples being made: give it with --yes, after the price.");
  const most = occurrences.filter((o) => o.flag === "max-usd").at(-1);
  let maxUsd: number | null = null;
  if (most) {
    const n = most.value !== undefined && /^\d+(\.\d+)?$/.test(most.value.trim()) ? Number(most.value.trim()) : Number.NaN;
    if (!Number.isFinite(n)) return usage(`video swipe sheet samples --max-usd takes the price's most in dollars, such as 1.04 (got "${most.value ?? ""}").`);
    maxUsd = n;
  }
  if (opts.yes && maxUsd === null) return usage("video swipe sheet samples --yes needs --max-usd <n>, the most the price said. Run it without --yes first to read the price.");
  if (maxUsd !== null && !opts.yes) return usage("video swipe sheet samples --max-usd goes with --yes, after the price.");
  return { kind: "sheet-samples", swipeId, sounds, count, maxUsd, opts };
}

// ── The flow ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface SamplesPrice {
  count: number;
  aboutUsd: number;
  mostUsd: number;
  lines: string[];
}
interface SamplesAnswer {
  row: "songSample";
  started: boolean;
  price: SamplesPrice;
  refusal: string | null;
  ids: string[];
  dashboardUrl?: string;
}
type SheetRow = SavedSheet["sections"][number]["rows"][number];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const NOT_FOUND =
  "Not found on this brand. The id is wrong or is another brand's, video isn't switched on for your dashboard user, or this is not the brand you meant (exodus brand current). Check the id first.";
const errorLine = (res: ApiResponse<unknown>) => missingRouteLine(res, "exodus video swipe sheet samples") ?? (res.status === 404 ? NOT_FOUND : formatApiError(res));
const failed = (line: string, json: boolean, extra: Record<string, unknown> = {}): FlowResult => ({
  code: 1,
  lines: json ? [JSON.stringify({ ok: false, error: line, ...extra })] : [line],
});
/** The most as the price says it: rounded up to the cent, so no line says less than the price showed. */
const mostShown = (usd: number) => (Math.ceil(Math.round(usd * 100_000) / 1000) / 100).toFixed(2);
const sampleRowOf = (sheet: SavedSheet): SheetRow | undefined => sheet.sections.flatMap((section) => section.rows).find((row) => row.id === "songSample");
const pickLine = (swipeId: string) =>
  `Pick one (free): exodus video swipe sheet set ${swipeId} songSample=<n>. It sets the kind of music, the sound and the singer to the ones it was sung in, and the full song is sung in its style.`;

function answerOf(data: unknown): SamplesAnswer | null {
  if (!isRecord(data) || data.row !== "songSample" || !isRecord(data.price) || !Array.isArray(data.price.lines)) return null;
  return data as unknown as SamplesAnswer;
}
function sheetOf(data: unknown): SavedSheet | null {
  return isRecord(data) && isRecord(data.sheet) && Array.isArray(data.sheet.sections) ? (data.sheet as unknown as SavedSheet) : null;
}
/**
 * Each take one a line: its number, what was heard and its sound. COP-375 (dev's #4911): never a take's own address;
 * the swipe's page on the song (`&sheet=song`) plays them, said after the list.
 */
export function takeLines(sheet: SavedSheet): string[] {
  return (sampleRowOf(sheet)?.options ?? []).map((option) => `  ${option.id}: ${option.label}`);
}

/** How long --wait waits: a chooser call cut off at 4 minutes, Kie's songs and eight listens. */
const SAMPLES_WAIT_MS = 45 * 60_000;
const POLL_MS = 5000;

export async function swipeSheetSamplesFlow(plan: SheetSamplesPlan, opts: SwipeRunOptions, deps: VideoDeps): Promise<FlowResult> {
  const { swipeId, sounds, count, maxUsd } = plan;
  const again = `exodus video swipe sheet samples ${swipeId}${sounds ? ` --sounds ${sounds.join(",")}` : count !== null ? ` --count ${count}` : ""}`;
  let res: ApiResponse<unknown>;
  try {
    res = await deps.post(SWIPE_SHEET_SAMPLES_PATH, {
      swipeId,
      ...(sounds ? { sounds } : {}),
      ...(count !== null ? { count } : {}),
      ...(opts.yes ? { yes: true } : {}),
      ...(maxUsd !== null ? { mostUsd: maxUsd } : {}),
    });
  } catch (err) {
    const error = `The server could not be reached: ${describeFetchFailure(err)}.`;
    // A yes that got no answer may have started the samples: the sheet says, so they are never asked for twice.
    const look = opts.yes ? `Whether they are being made is not known. Read the sheet before asking again: exodus video swipe sheet ${swipeId}` : "Nothing was made.";
    return { code: 1, lines: opts.json ? [JSON.stringify({ ok: false, error, started: opts.yes ? "unknown" : false })] : [error, look] };
  }
  if (!res.ok) {
    const error = errorLine(res);
    const refused = res.status >= 400 && res.status < 500;
    const look = refused ? "Nothing was made." : `Whether they are being made is not known. Read the sheet before asking again: exodus video swipe sheet ${swipeId}`;
    return { code: 1, lines: opts.json ? [JSON.stringify({ ok: false, status: res.status, error, started: refused ? false : "unknown" })] : [error, look] };
  }
  const answer = answerOf(res.data);
  if (!answer) return failed(`The server's answer about these samples could not be read. Read the sheet: exodus video swipe sheet ${swipeId}`, opts.json);
  if (!answer.started) {
    if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, started: false, price: answer.price, refusal: answer.refusal ?? null })] };
    const most = mostShown(answer.price.mostUsd);
    const next = answer.refusal ? [answer.refusal] : [`Make them (paid, on your keys, at most $${most}): ${again} --yes --max-usd ${most}`];
    return { code: 0, lines: [...answer.price.lines, "Nothing was made or paid yet.", ...next] };
  }
  const ids = answer.ids ?? [];
  // P7 stage 4: the server orders two pairs a sound (convex/videoSheetSamples.ts, count x SAMPLE_PAIRS rows of two take
  // numbers) and books a third pair later, only for a sound heard as another kind of music; read off the ids it sent,
  // so an older server's two takes a sound reads as before.
  const pairs = ids.length === answer.price.count * 4 ? ", four a sound in two pairs (a third pair, when one is ordered, adds two more)" : "";
  const head = `Making samples of ${answer.price.count === 1 ? "1 sound" : `${answer.price.count} sounds`}, takes ${ids[0]} to ${ids.at(-1)}${pairs}, at most $${mostShown(answer.price.mostUsd)} on your keys.`;
  if (!opts.wait) {
    if (opts.json) return { code: 0, lines: [JSON.stringify({ ok: true, started: true, ids, price: answer.price, dashboardUrl: answer.dashboardUrl ?? "" })] };
    return { code: 0, lines: [head, `Hear them as they are made: exodus video swipe sheet ${swipeId}`, pickLine(swipeId)] };
  }
  if (!opts.json) (opts.onProgressLine ?? (() => undefined))(head);
  const kept = opts.onProgressLine || opts.json ? [] : [head];
  let misses = 0;
  let sheet: SavedSheet | null = null;
  // P7 stage 3: the sheet's page, from the last sheet read, as the people's ask answers it (video-swipe.ts sheetOf).
  let page = "";
  for (let waited = 0; waited <= SAMPLES_WAIT_MS; waited += POLL_MS) {
    if (waited > 0) await deps.sleep(POLL_MS);
    const read = await deps.get(`${SHEET_PATH}?id=${encodeURIComponent(swipeId)}&${SOURCES_QUERY}`).catch(() => null);
    if (!read || read.status >= 500 || read.status === 429) {
      if (++misses >= 3) return failed(`The server did not answer three times in a row while we waited. They may still be made: exodus video swipe sheet ${swipeId}`, opts.json);
      continue;
    }
    misses = 0;
    if (!read.ok) return failed(`${errorLine(read)} They may still be made: exodus video swipe sheet ${swipeId}`, opts.json);
    const now = sheetOf(read.data);
    if (now) page = onOwnDashboard(isRecord(read.data) && typeof read.data.dashboardUrl === "string" ? read.data.dashboardUrl : "", deps.dashboardUrl);
    if (now && sampleRowOf(now)?.optionsStatus?.making !== true) {
      sheet = now;
      break;
    }
  }
  // P7 stage 3 fix (S7, D16): as the characters' wait ends (video-swipe-cast.ts): the ask goes on, and where to look.
  if (!sheet) {
    return failed(
      `The wait ended after ${SAMPLES_WAIT_MS / 60_000} minutes, and the samples are still being made: the ask goes on. Hear them as they are made: exodus video swipe sheet ${swipeId}`,
      opts.json,
    );
  }
  const status = sampleRowOf(sheet)?.optionsStatus;
  // COP-375: each take as dev's sheet --json says it (optionForJson, sheetForJson): whether it has a sample, no address.
  if (opts.json) {
    const takes = (sampleRowOf(sheet)?.options ?? []).map(optionForJson);
    return { code: 0, lines: [JSON.stringify({ ok: true, started: true, ids, status: status ?? null, takes, sheet: sheetForJson(sheet), dashboardUrl: page })] };
  }
  const takes = takeLines(sheet);
  // Fix round 2, R7 C: the server says in plain words to name the sounds (both doors show it); the CLI adds its flag.
  const nameThem = status?.sentence?.includes(NAME_THE_SOUNDS) ? [`Name them with: exodus video swipe sheet samples ${swipeId} --sounds <code,code,...>`] : [];
  return {
    // An ask that made no take or stopped before it finished ends the wait as a failure.
    code: status?.failed ? 1 : 0,
    lines: [
      ...kept,
      ...(status?.sentence ? [status.sentence] : []),
      ...nameThem,
      // COP-375: the takes by number and name, then the swipe's page on the song, where they play (as the voices' ask).
      ...(takes.length > 0 ? ["Samples to hear:", ...takes, ...sectionPageLines("Hear them:", page, "song"), pickLine(swipeId)] : []),
    ],
  };
}
