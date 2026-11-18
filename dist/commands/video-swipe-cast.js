import { formatApiError } from "../lib/format.js";
import { missingRouteLine } from "../lib/route-support.js";
import { describeFetchFailure } from "./video.js";
import { onOwnDashboard } from "./video-customer.js";
import { optionForJson, sectionPageLines, sheetForJson } from "./video-swipe.js";
export const SWIPE_SHEET_CAST_PATH = "/api/v2/video/swipe-sheet/cast";
const SHEET_PATH = "/api/v2/video/swipe-sheet";
const SOURCES_QUERY = "sources=recommended";
export const SHEET_CAST_LINE = "exodus video swipe sheet cast <swipeId> [--yes --max-usd <n>] [--wait] [--json]";
const CAST_ROWS = ["cast1", "cast2", "cast3"];
const OTHER_VERBS_FLAGS = new Set([
    "file", "url", "ad", "again", "one-shot", "music", "mode", "closeness", "product", "look", "script", "style", "title", "sheet", "full",
    "status", "persona", "retry-refused", "kind", "brand", "limit", "count", "sounds",
]);
export function planSheetCast(given, occurrences, opts) {
    const usage = (line) => ({ kind: "usage", line });
    const other = occurrences.find((o) => OTHER_VERBS_FLAGS.has(o.flag.replace(/^no-/, "")))?.flag;
    if (other)
        return usage(`video swipe sheet cast takes no --${other}. Its flags: --yes, --max-usd, --wait, --json.`);
    const [, swipeId, ...extra] = given;
    if (!swipeId)
        return usage(`video swipe sheet cast needs a swipe id: ${SHEET_CAST_LINE}`);
    if (extra.length > 0)
        return usage(`video swipe sheet cast takes one swipe id (got "${extra[0]}"): ${SHEET_CAST_LINE}`);
    if (opts.wait && !opts.yes)
        return usage("video swipe sheet cast --wait waits for the characters being drawn: give it with --yes, after the price.");
    const most = occurrences.filter((o) => o.flag === "max-usd").at(-1);
    let maxUsd = null;
    if (most) {
        const n = most.value !== undefined && /^\d+(\.\d+)?$/.test(most.value.trim()) ? Number(most.value.trim()) : Number.NaN;
        if (!Number.isFinite(n))
            return usage(`video swipe sheet cast --max-usd takes the price's most in dollars, such as 2.36 (got "${most.value ?? ""}").`);
        maxUsd = n;
    }
    if (opts.yes && maxUsd === null)
        return usage("video swipe sheet cast --yes needs --max-usd <n>, the most the price said. Run it without --yes first to read the price.");
    if (maxUsd !== null && !opts.yes)
        return usage("video swipe sheet cast --max-usd goes with --yes, after the price.");
    return { kind: "sheet-cast", swipeId, maxUsd, opts };
}
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const NOT_FOUND = "Not found on this brand. The id is wrong or is another brand's, video isn't switched on for your dashboard user, or this is not the brand you meant (exodus brand current). Check the id first.";
const errorLine = (res) => missingRouteLine(res, "exodus video swipe sheet cast") ?? (res.status === 404 ? NOT_FOUND : formatApiError(res));
const failed = (line, json, extra = {}) => ({
    code: 1,
    lines: json ? [JSON.stringify({ ok: false, error: line, ...extra })] : [line],
});
const mostShown = (usd) => (Math.ceil(Math.round(usd * 100_000) / 1000) / 100).toFixed(2);
const rowsOf = (sheet) => sheet.sections.flatMap((section) => section.rows).filter((row) => CAST_ROWS.includes(row.id));
const pickLine = (swipeId) => `Pick one picture for each character (free): exodus video swipe sheet set ${swipeId} cast1=<n> (cast2, cast3 for the others). The video draws that character from your picture, never as a new figure.`;
function answerOf(data) {
    if (!isRecord(data) || data.row !== "cast" || !isRecord(data.price) || !Array.isArray(data.price.lines))
        return null;
    return data;
}
function sheetOf(data) {
    return isRecord(data) && isRecord(data.sheet) && Array.isArray(data.sheet.sections) ? data.sheet : null;
}
export function castLines(sheet) {
    return rowsOf(sheet).flatMap((row) => [
        `${row.id}: ${row.optionsStatus?.sentence?.split(": ")[0] ?? row.label}`,
        ...(row.options ?? []).map((option) => `  ${option.id}: ${option.label}`),
    ]);
}
const CAST_WAIT_MS = 60 * 60_000;
const POLL_MS = 5000;
export async function swipeSheetCastFlow(plan, opts, deps) {
    const { swipeId, maxUsd } = plan;
    const again = `exodus video swipe sheet cast ${swipeId}`;
    let res;
    try {
        res = await deps.post(SWIPE_SHEET_CAST_PATH, { swipeId, ...(opts.yes ? { yes: true } : {}), ...(maxUsd !== null ? { mostUsd: maxUsd } : {}) });
    }
    catch (err) {
        const error = `The server could not be reached: ${describeFetchFailure(err)}.`;
        const look = opts.yes ? `Whether they are being drawn is not known. Read the sheet before asking again: exodus video swipe sheet ${swipeId}` : "Nothing was made.";
        return { code: 1, lines: opts.json ? [JSON.stringify({ ok: false, error, started: opts.yes ? "unknown" : false })] : [error, look] };
    }
    if (!res.ok) {
        const error = errorLine(res);
        const refused = res.status >= 400 && res.status < 500;
        const look = refused ? "Nothing was made." : `Whether they are being drawn is not known. Read the sheet before asking again: exodus video swipe sheet ${swipeId}`;
        return { code: 1, lines: opts.json ? [JSON.stringify({ ok: false, status: res.status, error, started: refused ? false : "unknown" })] : [error, look] };
    }
    const answer = answerOf(res.data);
    if (!answer)
        return failed(`The server's answer about these characters could not be read. Read the sheet: exodus video swipe sheet ${swipeId}`, opts.json);
    if (!answer.started) {
        if (opts.json)
            return { code: 0, lines: [JSON.stringify({ ok: true, started: false, price: answer.price, refusal: answer.refusal ?? null })] };
        const most = mostShown(answer.price.mostUsd);
        const next = answer.refusal ? [answer.refusal] : [`Make them (paid, on your keys, at most $${most}): ${again} --yes --max-usd ${most}`];
        return { code: 0, lines: [...answer.price.lines, "Nothing was made or paid yet.", ...next] };
    }
    const head = `Finding the song's main characters and drawing them, at most $${mostShown(answer.price.mostUsd)} on your keys.`;
    if (!opts.wait) {
        if (opts.json)
            return { code: 0, lines: [JSON.stringify({ ok: true, started: true, price: answer.price, dashboardUrl: answer.dashboardUrl ?? "" })] };
        return { code: 0, lines: [head, `See them as they are drawn: exodus video swipe sheet ${swipeId}`, pickLine(swipeId)] };
    }
    if (!opts.json)
        (opts.onProgressLine ?? (() => undefined))(head);
    const kept = opts.onProgressLine || opts.json ? [] : [head];
    let misses = 0;
    let sheet = null;
    let page = "";
    for (let waited = 0; waited <= CAST_WAIT_MS; waited += POLL_MS) {
        if (waited > 0)
            await deps.sleep(POLL_MS);
        const read = await deps.get(`${SHEET_PATH}?id=${encodeURIComponent(swipeId)}&${SOURCES_QUERY}`).catch(() => null);
        if (!read || read.status >= 500 || read.status === 429) {
            if (++misses >= 3)
                return failed(`The server did not answer three times in a row while we waited. They may still be drawn: exodus video swipe sheet ${swipeId}`, opts.json);
            continue;
        }
        misses = 0;
        if (!read.ok)
            return failed(`${errorLine(read)} They may still be drawn: exodus video swipe sheet ${swipeId}`, opts.json);
        const now = sheetOf(read.data);
        if (now)
            page = onOwnDashboard(isRecord(read.data) && typeof read.data.dashboardUrl === "string" ? read.data.dashboardUrl : "", deps.dashboardUrl);
        if (now && rowsOf(now)[0]?.optionsStatus?.making !== true) {
            sheet = now;
            break;
        }
    }
    if (!sheet) {
        return failed(`The wait ended after ${CAST_WAIT_MS / 60_000} minutes, and the characters are still being drawn: the ask goes on. See them as they are drawn: exodus video swipe sheet ${swipeId}`, opts.json);
    }
    const status = rowsOf(sheet)[0]?.optionsStatus;
    if (opts.json) {
        const characters = rowsOf(sheet).map((row) => ({ row: row.id, options: (row.options ?? []).map(optionForJson) }));
        return { code: 0, lines: [JSON.stringify({ ok: true, started: true, status: status ?? null, characters, sheet: sheetForJson(sheet), dashboardUrl: page })] };
    }
    const lines = castLines(sheet);
    const pictures = rowsOf(sheet).some((row) => (row.options ?? []).length > 0);
    return {
        code: status?.failed ? 1 : 0,
        lines: [
            ...kept,
            ...(status?.sentence ? [status.sentence] : []),
            ...(pictures ? ["Characters to pick from:", ...lines, ...sectionPageLines("See their faces:", page, "cast"), pickLine(swipeId)] : []),
        ],
    };
}
