import { formatApiError } from "../lib/format.js";
import { missingRouteLine } from "../lib/route-support.js";
import { describeFetchFailure } from "./video.js";
import { onOwnDashboard } from "./video-customer.js";
import { optionForJson, sectionPageLines, sheetForJson } from "./video-swipe.js";
export const SWIPE_SHEET_SAMPLES_PATH = "/api/v2/video/swipe-sheet/samples";
const NAME_THE_SOUNDS = "name the sounds yourself";
const SHEET_PATH = "/api/v2/video/swipe-sheet";
const SOURCES_QUERY = "sources=recommended";
export const SHEET_SAMPLES_LINE = "exodus video swipe sheet samples <swipeId> [--sounds <code,code,...> | --count <n>] [--yes --max-usd <n>] [--wait] [--json]";
export const SHEET_SAMPLES_MOST = 4;
const OTHER_VERBS_FLAGS = new Set([
    "file", "url", "ad", "again", "one-shot", "music", "mode", "closeness", "product", "look", "script", "style", "title", "sheet", "full",
    "status", "persona", "retry-refused", "kind", "brand", "limit",
]);
export function planSheetSamples(given, occurrences, opts) {
    const usage = (line) => ({ kind: "usage", line });
    const other = occurrences.find((o) => OTHER_VERBS_FLAGS.has(o.flag.replace(/^no-/, "")))?.flag;
    if (other)
        return usage(`video swipe sheet samples takes no --${other}. Its flags: --sounds, --count, --yes, --max-usd, --wait, --json.`);
    const [, swipeId, ...extra] = given;
    if (!swipeId)
        return usage(`video swipe sheet samples needs a swipe id: ${SHEET_SAMPLES_LINE}`);
    if (extra.length > 0)
        return usage(`video swipe sheet samples takes one swipe id (got "${extra[0]}"); name the sounds with --sounds: ${SHEET_SAMPLES_LINE}`);
    const typedSounds = occurrences.filter((o) => o.flag === "sounds").at(-1);
    let sounds = null;
    if (typedSounds) {
        const codes = (typedSounds.value ?? "").split(",").map((code) => code.trim()).filter(Boolean);
        if (codes.length < 1 || codes.length > SHEET_SAMPLES_MOST || (typedSounds.value ?? "").startsWith("--")) {
            return usage(`video swipe sheet samples --sounds takes 1 to ${SHEET_SAMPLES_MOST} sound codes, with commas between them, as the sheet lists them (got "${typedSounds.value ?? ""}").`);
        }
        sounds = codes;
    }
    const typedCount = occurrences.filter((o) => o.flag === "count").at(-1);
    let count = null;
    if (typedCount) {
        if (sounds)
            return usage("video swipe sheet samples takes --sounds or --count, not both: --count is how many sounds to choose for you.");
        const n = typedCount.value !== undefined && /^\d+$/.test(typedCount.value.trim()) ? Number(typedCount.value.trim()) : Number.NaN;
        if (!(n >= 1 && n <= SHEET_SAMPLES_MOST))
            return usage(`video swipe sheet samples --count takes 1 to ${SHEET_SAMPLES_MOST} (got "${typedCount.value ?? ""}").`);
        count = n;
    }
    if (opts.wait && !opts.yes)
        return usage("video swipe sheet samples --wait waits for samples being made: give it with --yes, after the price.");
    const most = occurrences.filter((o) => o.flag === "max-usd").at(-1);
    let maxUsd = null;
    if (most) {
        const n = most.value !== undefined && /^\d+(\.\d+)?$/.test(most.value.trim()) ? Number(most.value.trim()) : Number.NaN;
        if (!Number.isFinite(n))
            return usage(`video swipe sheet samples --max-usd takes the price's most in dollars, such as 1.04 (got "${most.value ?? ""}").`);
        maxUsd = n;
    }
    if (opts.yes && maxUsd === null)
        return usage("video swipe sheet samples --yes needs --max-usd <n>, the most the price said. Run it without --yes first to read the price.");
    if (maxUsd !== null && !opts.yes)
        return usage("video swipe sheet samples --max-usd goes with --yes, after the price.");
    return { kind: "sheet-samples", swipeId, sounds, count, maxUsd, opts };
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const NOT_FOUND = "Not found on this brand. The id is wrong or is another brand's, video isn't switched on for your dashboard user, or this is not the brand you meant (exodus brand current). Check the id first.";
const errorLine = (res) => missingRouteLine(res, "exodus video swipe sheet samples") ?? (res.status === 404 ? NOT_FOUND : formatApiError(res));
const failed = (line, json, extra = {}) => ({
    code: 1,
    lines: json ? [JSON.stringify({ ok: false, error: line, ...extra })] : [line],
});
const mostShown = (usd) => (Math.ceil(Math.round(usd * 100_000) / 1000) / 100).toFixed(2);
const sampleRowOf = (sheet) => sheet.sections.flatMap((section) => section.rows).find((row) => row.id === "songSample");
const pickLine = (swipeId) => `Pick one (free): exodus video swipe sheet set ${swipeId} songSample=<n>. It sets the kind of music, the sound and the singer to the ones it was sung in, and the full song is sung in its style.`;
function answerOf(data) {
    if (!isRecord(data) || data.row !== "songSample" || !isRecord(data.price) || !Array.isArray(data.price.lines))
        return null;
    return data;
}
function sheetOf(data) {
    return isRecord(data) && isRecord(data.sheet) && Array.isArray(data.sheet.sections) ? data.sheet : null;
}
export function takeLines(sheet) {
    return (sampleRowOf(sheet)?.options ?? []).map((option) => `  ${option.id}: ${option.label}`);
}
const SAMPLES_WAIT_MS = 45 * 60_000;
const POLL_MS = 5000;
export async function swipeSheetSamplesFlow(plan, opts, deps) {
    const { swipeId, sounds, count, maxUsd } = plan;
    const again = `exodus video swipe sheet samples ${swipeId}${sounds ? ` --sounds ${sounds.join(",")}` : count !== null ? ` --count ${count}` : ""}`;
    let res;
    try {
        res = await deps.post(SWIPE_SHEET_SAMPLES_PATH, {
            swipeId,
            ...(sounds ? { sounds } : {}),
            ...(count !== null ? { count } : {}),
            ...(opts.yes ? { yes: true } : {}),
            ...(maxUsd !== null ? { mostUsd: maxUsd } : {}),
        });
    }
    catch (err) {
        const error = `The server could not be reached: ${describeFetchFailure(err)}.`;
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
    if (!answer)
        return failed(`The server's answer about these samples could not be read. Read the sheet: exodus video swipe sheet ${swipeId}`, opts.json);
    if (!answer.started) {
        if (opts.json)
            return { code: 0, lines: [JSON.stringify({ ok: true, started: false, price: answer.price, refusal: answer.refusal ?? null })] };
        const most = mostShown(answer.price.mostUsd);
        const next = answer.refusal ? [answer.refusal] : [`Make them (paid, on your keys, at most $${most}): ${again} --yes --max-usd ${most}`];
        return { code: 0, lines: [...answer.price.lines, "Nothing was made or paid yet.", ...next] };
    }
    const ids = answer.ids ?? [];
    const pairs = ids.length === answer.price.count * 4 ? ", four a sound in two pairs (a third pair, when one is ordered, adds two more)" : "";
    const head = `Making samples of ${answer.price.count === 1 ? "1 sound" : `${answer.price.count} sounds`}, takes ${ids[0]} to ${ids.at(-1)}${pairs}, at most $${mostShown(answer.price.mostUsd)} on your keys.`;
    if (!opts.wait) {
        if (opts.json)
            return { code: 0, lines: [JSON.stringify({ ok: true, started: true, ids, price: answer.price, dashboardUrl: answer.dashboardUrl ?? "" })] };
        return { code: 0, lines: [head, `Hear them as they are made: exodus video swipe sheet ${swipeId}`, pickLine(swipeId)] };
    }
    if (!opts.json)
        (opts.onProgressLine ?? (() => undefined))(head);
    const kept = opts.onProgressLine || opts.json ? [] : [head];
    let misses = 0;
    let sheet = null;
    let page = "";
    for (let waited = 0; waited <= SAMPLES_WAIT_MS; waited += POLL_MS) {
        if (waited > 0)
            await deps.sleep(POLL_MS);
        const read = await deps.get(`${SHEET_PATH}?id=${encodeURIComponent(swipeId)}&${SOURCES_QUERY}`).catch(() => null);
        if (!read || read.status >= 500 || read.status === 429) {
            if (++misses >= 3)
                return failed(`The server did not answer three times in a row while we waited. They may still be made: exodus video swipe sheet ${swipeId}`, opts.json);
            continue;
        }
        misses = 0;
        if (!read.ok)
            return failed(`${errorLine(read)} They may still be made: exodus video swipe sheet ${swipeId}`, opts.json);
        const now = sheetOf(read.data);
        if (now)
            page = onOwnDashboard(isRecord(read.data) && typeof read.data.dashboardUrl === "string" ? read.data.dashboardUrl : "", deps.dashboardUrl);
        if (now && sampleRowOf(now)?.optionsStatus?.making !== true) {
            sheet = now;
            break;
        }
    }
    if (!sheet) {
        return failed(`The wait ended after ${SAMPLES_WAIT_MS / 60_000} minutes, and the samples are still being made: the ask goes on. Hear them as they are made: exodus video swipe sheet ${swipeId}`, opts.json);
    }
    const status = sampleRowOf(sheet)?.optionsStatus;
    if (opts.json) {
        const takes = (sampleRowOf(sheet)?.options ?? []).map(optionForJson);
        return { code: 0, lines: [JSON.stringify({ ok: true, started: true, ids, status: status ?? null, takes, sheet: sheetForJson(sheet), dashboardUrl: page })] };
    }
    const takes = takeLines(sheet);
    const nameThem = status?.sentence?.includes(NAME_THE_SOUNDS) ? [`Name them with: exodus video swipe sheet samples ${swipeId} --sounds <code,code,...>`] : [];
    return {
        code: status?.failed ? 1 : 0,
        lines: [
            ...kept,
            ...(status?.sentence ? [status.sentence] : []),
            ...nameThem,
            ...(takes.length > 0 ? ["Samples to hear:", ...takes, ...sectionPageLines("Hear them:", page, "song"), pickLine(swipeId)] : []),
        ],
    };
}
