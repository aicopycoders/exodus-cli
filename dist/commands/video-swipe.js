import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatApiError } from "../lib/format.js";
import { missingRouteLine } from "../lib/route-support.js";
import { customerAnswer, customerStageIsWorking } from "./video-customer.js";
import { asVideoRun, describeFetchFailure, RUN_PATH, startedThenWait, waitFlow } from "./video.js";
export const SWIPE_BREAKDOWNS_PATH = "/api/v2/video/breakdowns";
export const SWIPE_UPLOAD_URL_PATH = "/api/v2/video/breakdowns/upload-url";
export const SWIPE_TEMPLATE_PATH = "/api/v2/video/swipe-template";
export const SWIPE_PRODUCTS_PATH = "/api/v2/video/swipe-products";
export const SWIPES_PATH = "/api/v2/video/swipes";
export const SWIPE_RUNS_PATH = "/api/v2/video/swipe-runs";
export const SWIPE_LIBRARY_PATH = "/api/v2/swipe-library";
export const SWIPE_MODES = [
    { flag: "whole-ad", mode: "whole", label: "Whole ad", helper: "Every part of their ad, rewritten for your brand." },
    { flag: "hook-only", mode: "hook", label: "Hook only", helper: "Their opening hook. The rest is new, written for your product." },
    { flag: "their-format", mode: "their-format", label: "Their format, my script", helper: "Your own words, made the way their ad is made." },
    { flag: "new-look", mode: "new-look", label: "Their script, a new look", helper: "Their ad rewritten for your brand, in a look you pick." },
];
export const SWIPE_CLOSENESS = [
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
const modeOf = (mode) => SWIPE_MODES.find((m) => m.mode === mode);
const closenessOf = (step) => SWIPE_CLOSENESS.find((c) => c.step === step);
export const NO_PRICE = "The CLI prints no price for this step.";
const MEMBER_LLM_KEY = "The member's own Anthropic or OpenRouter key.";
export const PAID = {
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
export function needsYesResult(step, json, choice = []) {
    const { buys, paidBy } = PAID[step];
    if (json)
        return { code: 0, lines: [JSON.stringify({ ok: false, needsYes: true, buys, paidBy, price: null })] };
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
const VERBS = ["status", "template", "products", "write", "show", "list", "start", "run", "find"];
export function parseSwipeMode(value) {
    return SWIPE_MODES.find((m) => m.flag === value.trim().toLowerCase())?.mode ?? null;
}
export function parseCloseness(value) {
    const word = value.trim().toLowerCase();
    return SWIPE_CLOSENESS.find((c) => String(c.step) === word || c.flag === word)?.step ?? null;
}
const SHEET_FLAGS = [
    ["one-shot", 'set "oneShot" in the sheet.'],
    ["music", 'set "music" in the sheet\'s "finish".'],
    ["mode", 'set "mode" in the sheet.'],
    ["closeness", 'set "closeness" in the sheet.'],
    ["product", 'set "product" in the sheet.'],
    ["look", 'set "look" in the sheet.'],
    ["script", 'set "script" in the sheet, or a persona\'s "script".'],
    ["style", 'set "style" in the sheet.'],
    ["title", 'set "title" in the sheet.'],
    ["file", 'list the ad in the sheet\'s "sources".'],
    ["url", 'list the ad in the sheet\'s "sources".'],
    ["ad", 'list the ad in the sheet\'s "sources".'],
    ["full", "--full is for exodus video swipe status."],
];
const OFF_WORDS = new Set(["false", "no", "off", "0"]);
const ON_WORDS = new Set(["true", "yes", "on", "1"]);
const SWITCHES = ["json", "yes", "wait", "full", "music", "one-shot", "retry-refused", "status"];
export function planSwipeCommand(rest, occurrences) {
    const last = (name) => occurrences.filter((o) => o.flag === name || o.flag === `no-${name}`).at(-1);
    const switchState = (name) => {
        const typed = last(name);
        if (typed?.flag !== name)
            return false;
        const given = typed.value;
        if (given === undefined || given.startsWith("--"))
            return true;
        const word = given.trim().toLowerCase();
        if (OFF_WORDS.has(word))
            return false;
        if (ON_WORDS.has(word) || given === "swipe" || rest.includes(given))
            return true;
        return `video swipe --${name} takes true or false, or no value at all (got "${given}").`;
    };
    const switches = new Map(SWITCHES.map((name) => [name, switchState(name)]));
    const refusedSwitch = [...switches.values()].find((state) => typeof state === "string");
    if (refusedSwitch)
        return { kind: "usage", line: refusedSwitch };
    const on = (name) => switches.get(name) === true;
    const value = (name) => {
        const typed = last(name);
        if (!typed || typed.flag !== name)
            return undefined;
        return typed.value !== undefined && !typed.value.startsWith("--") && typed.value.trim() ? typed.value : null;
    };
    const opts = { json: on("json"), yes: on("yes"), wait: on("wait") };
    const usage = (line) => ({ kind: "usage", line });
    const [verb, id] = rest;
    if (verb === undefined) {
        const given = ["file", "url", "ad"].filter((name) => value(name) !== undefined);
        if (given.length !== 1) {
            return usage("video swipe needs one ad: --file <ad.mp4>, --url <link> or --ad <swipeAdId>.");
        }
        const name = given[0];
        const text = value(name);
        if (!text)
            return usage(`video swipe --${name} needs ${name === "file" ? "a video file" : name === "url" ? "a link" : "an ad id"}.`);
        const source = name === "file" ? { kind: "file", file: text } : name === "url" ? { kind: "url", url: text.trim() } : { kind: "ad", swipeAdId: text.trim() };
        return { kind: "breakdown", source, opts };
    }
    if (!VERBS.includes(verb)) {
        return usage(`video swipe ${verb} is not a swipe command. Use one of: ${VERBS.join(", ")}, or --file, --url or --ad to start.`);
    }
    if (verb === "products")
        return { kind: "products", opts };
    if (verb === "list")
        return { kind: "list", opts };
    if (verb === "find") {
        const typedFlag = (names) => occurrences.find((o) => names.some((name) => o.flag === name || o.flag === `no-${name}`))?.flag;
        const paid = typedFlag(FIND_PAID_FLAGS);
        if (paid) {
            return usage(`video swipe find only lists the swipe library and buys nothing, so it takes no --${paid}. Read a picked ad with exodus video swipe --ad <id>.`);
        }
        const other = typedFlag(FIND_OTHER_FLAGS);
        if (other)
            return usage(`video swipe find takes no --${other}: it only lists the swipe library. Its flags are --brand, --limit and --json.`);
        const switchWord = (word) => ON_WORDS.has(word.toLowerCase()) || OFF_WORDS.has(word.toLowerCase());
        const extra = rest
            .slice(1)
            .find((word) => !(switchWord(word) && occurrences.some((o) => SWITCHES.includes(o.flag) && o.value === word)));
        if (extra !== undefined)
            return usage(`video swipe find takes no id (got "${extra}"). Name a competitor with --brand "<name>".`);
        const brand = value("brand");
        if (brand === null)
            return usage("video swipe find --brand needs a competitor's name.");
        const limitWord = value("limit");
        if (limitWord === null)
            return usage(`video swipe find --limit needs a number from 1 to ${FIND_MAX}.`);
        const limit = limitWord === undefined ? FIND_DEFAULT_LIMIT : /^\d+$/.test(limitWord.trim()) ? Number(limitWord.trim()) : NaN;
        if (!(limit >= 1 && limit <= FIND_MAX)) {
            return usage(`video swipe find --limit must be a whole number from 1 to ${FIND_MAX}, not "${limitWord}".`);
        }
        return { kind: "find", ask: { brand: brand?.trim() ?? null, limit }, opts };
    }
    if (verb === "run") {
        const typed = SHEET_FLAGS.find(([flag]) => last(flag) !== undefined);
        if (typed) {
            const [flag, field] = typed;
            return usage(`video swipe run takes its choices from the sheet, not from --${flag}: ${field}`);
        }
        const sheet = value("sheet");
        if (!sheet)
            return usage("video swipe run needs --sheet <file>, the swipe's sheet.");
        const persona = value("persona");
        if (persona === null)
            return usage("video swipe run --persona needs a persona's name from the sheet.");
        if (on("status") && (opts.yes || opts.wait || on("retry-refused"))) {
            return usage("video swipe run --status only reads; leave off --yes, --wait and --retry-refused.");
        }
        return { kind: "run", sheetFile: sheet.trim(), retryRefused: on("retry-refused"), status: on("status"), persona: persona?.trim() ?? null, opts };
    }
    if (!id) {
        const named = verb === "show" || verb === "start" ? "swipeId" : "breakdownId";
        return usage(`video swipe ${verb} needs a ${named === "swipeId" ? "swipe" : "breakdown"} id: exodus video swipe ${verb} <${named}>`);
    }
    if (verb === "status")
        return { kind: "status", breakdownId: id, full: on("full"), opts };
    if (verb === "template")
        return { kind: "template", breakdownId: id, opts };
    if (verb === "show")
        return { kind: "show", swipeId: id, opts };
    if (verb === "start") {
        const start = startChoicesOf({ style: value("style"), title: value("title"), music: on("music"), oneShot: on("one-shot") }, CLI_WORDS.start);
        if ("problem" in start)
            return usage(start.problem);
        return { kind: "start", swipeId: id, ask: start.ask, opts };
    }
    const product = value("product");
    if (!product)
        return usage("video swipe write needs --product <id>. exodus video swipe products lists them.");
    const write = writeChoicesOf({ mode: value("mode"), closeness: value("closeness"), look: value("look"), script: value("script") }, CLI_WORDS.write);
    if ("problem" in write)
        return usage(write.problem);
    return { kind: "write", breakdownId: id, ask: { productId: product.trim(), ...write.ask }, opts };
}
const CLI_WORDS = {
    write: { who: "video swipe write", flag: (name) => `--${name}`, set: (name, value) => `--${name} ${value}` },
    start: { who: "video swipe start", flag: (name) => `--${name}`, set: (name, value) => `--${name} ${value}` },
};
export function writeChoicesOf(given, words) {
    const { who, flag, set } = words;
    const modeWord = given.mode;
    if (modeWord === null)
        return { problem: `${who} ${flag("mode")} needs whole-ad, hook-only, their-format or new-look.` };
    const mode = modeWord === undefined ? "whole" : parseSwipeMode(modeWord);
    if (!mode)
        return { problem: `${who} ${flag("mode")} must be whole-ad, hook-only, their-format or new-look, not "${modeWord}".` };
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
    if (look !== undefined && mode !== "new-look")
        return { problem: `${who} ${flag("look")} is only for ${set("mode", "new-look")}.` };
    if (script === null || (script === undefined && mode === "their-format")) {
        return { problem: `${who} ${set("mode", "their-format")} needs ${set("script", "<file>")}, your own script.` };
    }
    if (script !== undefined && mode !== "their-format")
        return { problem: `${who} ${flag("script")} is only for ${set("mode", "their-format")}.` };
    return {
        ask: {
            mode,
            closeness,
            ...(look ? { look: look.trim() } : {}),
            ...(script ? { scriptFile: script } : {}),
        },
    };
}
export function startChoicesOf(given, words) {
    const { who, flag, set } = words;
    if (given.style === null)
        return { problem: `${who} ${flag("style")} needs a look's slug.` };
    if (given.title === null)
        return { problem: `${who} ${flag("title")} needs a name: ${set("title", '"<name>"')}.` };
    return {
        ask: {
            ...(given.style ? { style: given.style.trim() } : {}),
            ...(given.title ? { title: given.title.trim() } : {}),
            music: given.music,
            oneShot: given.oneShot,
        },
    };
}
const SWIPE_NOT_FOUND = "Not found on this brand. The id is wrong or is another brand's, video isn't switched on for your dashboard " +
    "user, or this is not the brand you meant (exodus brand current). Check the id first.";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function swipeErrorLine(res) {
    return missingRouteLine(res, "exodus video swipe") ?? (res.status === 404 ? SWIPE_NOT_FOUND : formatApiError(res));
}
function swipeError(res, json) {
    const error = swipeErrorLine(res);
    return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error })] : [error] };
}
function failed(line, json, extra = {}) {
    return { code: 1, lines: json ? [JSON.stringify({ ok: false, error: line, ...extra })] : [line] };
}
function progress(opts) {
    const kept = [];
    return {
        say(line) {
            if (opts.json)
                return;
            if (opts.onProgressLine)
                opts.onProgressLine(line);
            else
                kept.push(line);
        },
        kept,
    };
}
const POLL_MS = 5000;
const MAX_MISSES = 3;
const missed = (res) => res.status >= 500 || res.status === 429;
async function poll(read, step, maxPolls, deps) {
    let misses = 0;
    for (let i = 0; i < maxPolls; i++) {
        if (i > 0)
            await deps.sleep(POLL_MS);
        const res = await read().catch(() => null);
        if (!res || missed(res)) {
            if (++misses >= MAX_MISSES)
                return { lost: true };
            continue;
        }
        misses = 0;
        const answer = step(res);
        if (answer)
            return answer;
    }
    return { timedOut: true };
}
const usd = (value) => `$${value.toFixed(2)}`;
const LOST = "The server did not answer three times in a row while we waited.";
function waitRefused(res, hint, json) {
    if (res.status === 404)
        return swipeError(res, json);
    const error = swipeErrorLine(res);
    return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error, mayStillFinish: hint })] : [error, hint] };
}
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const VIDEO_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
};
const BREAKDOWN_MAX_POLLS = 300;
export async function swipeBreakdownFlow(source, opts, deps) {
    const { json } = opts;
    let file = null;
    if (source.kind === "file") {
        const stat = deps.statFile(source.file);
        if (!stat)
            return failed(`Can't read ${source.file}. Check the path.`, json);
        if (stat.size === 0)
            return failed("That file is empty. Pick the video file again.", json);
        if (stat.size > MAX_FILE_BYTES)
            return failed("That file is too big. Pick a video of at most 300 MB.", json);
        const contentType = VIDEO_TYPES[path.extname(source.file).toLowerCase()];
        if (!contentType)
            return failed("That file is not a video. Pick an MP4, MOV, M4V or WebM file.", json);
        file = { contentType, size: stat.size };
    }
    if (!opts.yes)
        return needsYesResult("breakdown", json);
    let started;
    if (source.kind === "url") {
        const earlier = await deps.get(`${SWIPE_BREAKDOWNS_PATH}?url=${encodeURIComponent(source.url)}`);
        if (!earlier.ok)
            return swipeError(earlier, json);
        const found = isRecord(earlier.data) && isRecord(earlier.data.earlier) ? earlier.data.earlier.breakdownId : undefined;
        if (typeof found === "string")
            started = { breakdownId: found, existing: true };
        else {
            const res = await deps.post(SWIPE_BREAKDOWNS_PATH, { url: source.url });
            if (!res.ok)
                return swipeError(res, json);
            started = startedOf(res.data);
        }
    }
    else if (source.kind === "ad") {
        const res = await deps.post(SWIPE_BREAKDOWNS_PATH, { swipeAdId: source.swipeAdId });
        if (!res.ok)
            return swipeError(res, json);
        started = startedOf(res.data);
    }
    else {
        const minted = await deps.post(SWIPE_UPLOAD_URL_PATH, {});
        if (!minted.ok)
            return swipeError(minted, json);
        const slot = isRecord(minted.data) ? minted.data : {};
        if (typeof slot.url !== "string" || typeof slot.receiptId !== "string") {
            return failed("The server did not give an upload URL. Nothing was paid for.", json);
        }
        let stored;
        try {
            stored = await deps.uploadBytes(slot.url, file.contentType, deps.readFileBytes(source.file));
        }
        catch (err) {
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
        if (!res.ok)
            return swipeError(res, json);
        started = startedOf(res.data);
    }
    if (!started.breakdownId)
        return failed("The server did not say which breakdown it started.", json);
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
    for (const line of head)
        out.say(line);
    const waited = await waitForBreakdown(breakdownId, opts, deps, out.say);
    if (json)
        return { code: waited.code, lines: [JSON.stringify({ ok: waited.code === 0, breakdownId, existing, ...waited.json })] };
    return { code: waited.code, lines: [...out.kept, ...waited.lines] };
}
function startedOf(data) {
    const d = isRecord(data) ? data : {};
    return { breakdownId: typeof d.breakdownId === "string" ? d.breakdownId : "", existing: d.existing === true };
}
function breakdownReadOf(data) {
    if (!isRecord(data) || !isRecord(data.breakdown) || !Array.isArray(data.breakdown.steps))
        return null;
    return { breakdown: data.breakdown, template: isRecord(data.template) ? data.template : null };
}
async function waitForBreakdown(breakdownId, opts, deps, say) {
    const said = new Set();
    const ended = await poll(() => deps.get(`${SWIPE_BREAKDOWNS_PATH}?id=${encodeURIComponent(breakdownId)}`), (res) => {
        if (!res.ok)
            return { done: { refused: res } };
        const read = breakdownReadOf(res.data);
        if (!read)
            return null;
        for (const step of read.breakdown.steps) {
            if (step.status === "waiting" || said.has(step.id))
                continue;
            said.add(step.id);
            say(`  ${step.label}`);
        }
        return read.breakdown.status === "done" || read.breakdown.status === "failed" ? { done: { read } } : null;
    }, BREAKDOWN_MAX_POLLS, deps);
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
        if (refused.status === 404)
            return { code: 1, lines: [error], json: { error } };
        return { code: 1, lines: [error, hint], json: { error, mayStillFinish: hint } };
    }
    const { read } = ended.done;
    return { code: read.breakdown.status === "failed" ? 1 : 0, lines: breakdownEndLines(read), json: { breakdown: read.breakdown, template: read.template } };
}
function breakdownEndLines({ breakdown, template }) {
    if (breakdown.status === "failed") {
        return [
            `The breakdown failed: ${breakdown.error ?? "no reason was given."}`,
            "Reading the ad again is paid too: run the same exodus video swipe command with --yes, after the member's yes.",
        ];
    }
    return ["The breakdown is done.", ...spentLines(breakdown), ...nextAfterBreakdown(breakdown._id, template)];
}
function spentLines(breakdown) {
    if (breakdown.reused)
        return ["It reused answers bought before, so it cost nothing."];
    if (breakdown.spentUsd === null || breakdown.spentUsd <= 0)
        return [];
    return [`It cost ${usd(breakdown.spentUsd)}${breakdown.costIsEstimate ? " (partly an estimate)" : ""}, on the team's keys.`];
}
function nextAfterBreakdown(breakdownId, template) {
    if (template)
        return [...templateLines(template), ...nextAfterTemplate(breakdownId)];
    return [`Next, the template (paid, on the member's key; ask first): exodus video swipe template ${breakdownId} --yes`];
}
const STATUS_WORD = {
    queued: "waiting to start",
    running: "reading the ad",
    done: "done",
    failed: "failed",
};
export async function swipeStatusFlow(breakdownId, opts, deps, full = false) {
    const readPath = `${SWIPE_BREAKDOWNS_PATH}?id=${encodeURIComponent(breakdownId)}`;
    if (opts.wait) {
        const out = progress(opts);
        out.say(`Waiting for breakdown ${breakdownId}.`);
        const waited = await waitForBreakdown(breakdownId, opts, deps, out.say);
        const done = waited.json.breakdown && waited.json.breakdown.status === "done";
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
    if (!res.ok)
        return swipeError(res, opts.json);
    const read = breakdownReadOf(res.data);
    if (!read)
        return failed("The server's answer about this breakdown could not be read.", opts.json);
    if (opts.json)
        return { code: 0, lines: [JSON.stringify(res.data)] };
    const { breakdown } = read;
    const width = Math.max(...breakdown.steps.map((step) => step.status.length));
    const lines = [
        `Breakdown ${breakdown._id}: ${STATUS_WORD[breakdown.status]}`,
        `The ad: ${breakdown.sourceUrl ?? breakdown.fileName ?? "an uploaded file"}`,
        ...breakdown.steps.map((step) => `  ${step.status.padEnd(width)}  ${step.label}`),
    ];
    if (breakdown.status === "done" || breakdown.status === "failed")
        lines.push(...breakdownEndLines(read));
    else
        lines.push(`Wait for it: exodus video swipe status ${breakdown._id} --wait`);
    if (full)
        lines.push(...fullLines(isRecord(res.data) ? res.data : {}));
    return { code: 0, lines };
}
const seconds = (start, end) => `${start.toFixed(1)}-${end.toFixed(1)} s`;
const EMBODIMENT = {
    "on-screen": "on screen",
    "voice-only": "voice only",
    "behind-camera": "behind the camera",
};
export function fullLines(data) {
    if (!isRecord(data.full)) {
        const why = typeof data.fullProblem === "string" ? data.fullProblem : "This server sent nothing it read.";
        return ["", why];
    }
    const full = data.full;
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
    if (cast.length === 0)
        lines.push("  No cast listed.");
    for (const member of cast) {
        lines.push(`  ${member.name || member.characterId} (${member.characterId}), ${EMBODIMENT[member.embodiment] ?? member.embodiment}`);
        lines.push(`      Look: ${member.look}`, `      Voice: ${member.voice}`);
    }
    if (full.warnings.length > 0)
        lines.push("", "What it was not sure about:", ...full.warnings.map((warning) => `  - ${warning}`));
    return lines;
}
const TEMPLATE_MAX_POLLS = 120;
function templateLines(template) {
    return [
        `Kind of ad: ${template.kind.label} (${template.kind.key})`,
        `  ${template.kind.why}`,
        `Look: ${template.look.label} (${template.look.slug})`,
        `  ${template.look.why}`,
        `Their ad: ${template.lines} lines, about ${Math.round(template.seconds)} s.`,
    ];
}
function nextAfterTemplate(breakdownId) {
    return [
        "The swipe writes this kind of ad and no other. If the member wants another kind, say so before writing.",
        "Next: pick a product (exodus video swipe products), then write (paid, on the member's key; ask first):",
        `  exodus video swipe write ${breakdownId} --product <productId> --mode whole-ad --closeness 2 --yes`,
    ];
}
export async function swipeTemplateFlow(breakdownId, opts, deps) {
    const { json } = opts;
    if (!opts.yes)
        return needsYesResult("template", json);
    const res = await deps.post(SWIPE_TEMPLATE_PATH, { breakdownId });
    if (!res.ok)
        return swipeError(res, json);
    const answer = isRecord(res.data) ? res.data : {};
    const done = (template, costFree, kept = []) => ({
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
    if (answer.status === "stored" && isRecord(answer.template))
        return done(answer.template, true);
    if (answer.status !== "making" || typeof answer.job !== "string") {
        return failed("The server's answer about the template could not be read.", json);
    }
    const job = answer.job;
    opts.onJob?.(job);
    const out = progress(opts);
    out.say("Making the template on the member's key. It takes up to six minutes.");
    const ended = await poll(() => deps.get(`${SWIPE_TEMPLATE_PATH}?breakdownId=${encodeURIComponent(breakdownId)}&job=${encodeURIComponent(job)}`), (polled) => {
        if (!polled.ok)
            return { done: { refused: polled } };
        const state = isRecord(polled.data) ? polled.data : {};
        if (state.status === "stored" && isRecord(state.template))
            return { done: { template: state.template } };
        if (state.status === "failed")
            return { done: { error: typeof state.error === "string" ? state.error : "no reason was given." } };
        return null;
    }, TEMPLATE_MAX_POLLS, deps);
    const hint = `The template may still be made: exodus video swipe status ${breakdownId}`;
    if ("lost" in ended)
        return failed(`${LOST} ${hint}`, json);
    if ("timedOut" in ended) {
        return failed(`Still making the template after 10 minutes. Waiting costs nothing more. Check later: exodus video swipe status ${breakdownId}`, json);
    }
    const result = ended.done;
    if ("refused" in result)
        return waitRefused(result.refused, hint, json);
    if ("error" in result)
        return failed(`The template could not be made: ${result.error}`, json, { breakdownId });
    return done(result.template, false, out.kept);
}
export async function swipeProductsFlow(opts, deps) {
    const res = await deps.get(SWIPE_PRODUCTS_PATH);
    if (!res.ok)
        return swipeError(res, opts.json);
    const products = productsOf(res.data);
    if (opts.json)
        return { code: 0, lines: [JSON.stringify({ ok: true, products })] };
    if (products.length === 0)
        return { code: 0, lines: ["This brand has no products yet. Add one in the dashboard first."] };
    const width = Math.max(...products.map((p) => p.id.length));
    return {
        code: 0,
        lines: [
            "The brand's products. Write for one with --product <id>:",
            ...products.map((p) => `  ${p.id.padEnd(width)}  ${p.name}${p.description ? ` — ${p.description}` : ""}`),
        ],
    };
}
export const FIND_READ = 200;
const FIND_MAX = FIND_READ;
const FIND_DEFAULT_LIMIT = 30;
const FIRST_LINE_MAX = 60;
export const FIND_PAID_FLAGS = ["yes", "wait", "file", "url", "ad"];
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
];
const TEXT_MAX = 400;
export const FIND_KIND_LINE = "The kind of an ad is known only after it is read.";
export const FIND_EMPTY_LIBRARY = "The swipe library has no ads yet for this brand.";
function textOf(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
function cut(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
export function swipeCandidatesOf(rows, ask) {
    const videos = rows.filter((row) => isRecord(row) && typeof row._id === "string" && row.format === "video" && textOf(row.videoUrl) !== "");
    const advertisers = [];
    for (const row of videos) {
        const name = textOf(row.brandName);
        if (name && !advertisers.some((seen) => seen.toLowerCase() === name.toLowerCase()))
            advertisers.push(name);
    }
    const wanted = ask.brand?.toLowerCase() ?? null;
    const matched = wanted === null ? videos : videos.filter((row) => textOf(row.brandName).toLowerCase().includes(wanted));
    const competitors = new Set(matched.map((row) => textOf(row.brandName).toLowerCase()).filter(Boolean)).size;
    const candidates = matched.slice(0, ask.limit).map((row, i) => {
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
function windowWords(found) {
    if (!found.wholeLibrary) {
        return `the ${found.read} ads looked through in the swipe library (shared across competitors; the library may hold more)`;
    }
    return found.read === 1 ? "the only ad in the swipe library" : `all ${found.read} ads in the swipe library`;
}
function findEmptyLine(found, ask) {
    if (found.read === 0)
        return FIND_EMPTY_LIBRARY;
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
export async function swipeFindFlow(ask, opts, deps) {
    const { json } = opts;
    const res = await deps.get(`${SWIPE_LIBRARY_PATH}?limit=${FIND_READ}`);
    if (!res.ok) {
        const error = formatApiError(res);
        return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error })] : [error] };
    }
    const rows = isRecord(res.data) && Array.isArray(res.data.swipes) ? res.data.swipes : null;
    if (!rows)
        return failed("The server's answer about the swipe library could not be read.", json);
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
    if (empty)
        return { code: 0, lines: [empty] };
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
const WRITE_MAX_POLLS = 180;
function choiceLines(ask) {
    const mode = modeOf(ask.mode);
    const lines = [`Mode: ${mode.label}. ${mode.helper}`];
    if (ask.mode !== "their-format") {
        const step = closenessOf(ask.closeness);
        lines.push(`Closeness: ${step.step}, ${step.name}. ${step.line}`);
    }
    if (ask.look)
        lines.push(`New look: ${ask.look}`);
    return lines;
}
function requestOf(ask, memberScript) {
    switch (ask.mode) {
        case "their-format":
            return { mode: ask.mode, memberScript };
        case "new-look":
            return { mode: ask.mode, closeness: ask.closeness, look: ask.look };
        default:
            return { mode: ask.mode, closeness: ask.closeness };
    }
}
function costLine(swipe) {
    return swipe.costUsd !== null
        ? `It cost ${usd(swipe.costUsd)} on the member's key.`
        : "What it cost is unknown: the provider reported no usage for it.";
}
function swipeLines(swipe, after) {
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
export async function swipeWriteFlow(breakdownId, ask, opts, deps) {
    const { json } = opts;
    let memberScript = ask.scriptText;
    if (memberScript === undefined && ask.scriptFile !== undefined) {
        try {
            memberScript = deps.readFile(ask.scriptFile);
        }
        catch {
            return failed(`Can't read --script ${ask.scriptFile}. Check the path.`, json);
        }
    }
    if (memberScript !== undefined && !memberScript.trim())
        return failed(`--script ${ask.scriptFile} is empty.`, json);
    if (!opts.yes)
        return needsYesResult("write", json, choiceLines(ask));
    const res = await deps.post(SWIPES_PATH, { breakdownId, productId: ask.productId, request: requestOf(ask, memberScript) });
    if (!res.ok)
        return swipeError(res, json);
    const job = isRecord(res.data) ? res.data.job : undefined;
    if (typeof job !== "string")
        return failed("The server did not say which write it started.", json);
    opts.onJob?.(job);
    const out = progress(opts);
    out.say("Writing the brand's version on the member's key. It takes four to nine minutes.");
    const ended = await poll(() => deps.get(`${SWIPES_PATH}?job=${encodeURIComponent(job)}`), (polled) => {
        if (!polled.ok)
            return { done: { refused: polled } };
        const state = isRecord(polled.data) ? polled.data : {};
        if (state.status === "done" && isRecord(state.swipe))
            return { done: { swipe: state.swipe } };
        if (state.status === "failed")
            return { done: { error: typeof state.error === "string" ? state.error : "no reason was given." } };
        return null;
    }, WRITE_MAX_POLLS, deps);
    const hint = "The write may still finish: exodus video swipe list";
    if ("lost" in ended)
        return failed(`${LOST} ${hint}`, json);
    if ("timedOut" in ended) {
        return failed("Still writing after 15 minutes. Waiting costs nothing more. See it later: exodus video swipe list", json);
    }
    const result = ended.done;
    if ("refused" in result)
        return waitRefused(result.refused, hint, json);
    if ("error" in result)
        return failed(`The write stopped: ${result.error} Nothing was started.`, json);
    const { swipe } = result;
    const written = swipe.outcome.kind === "written";
    if (json) {
        return { code: written ? 0 : 1, lines: [JSON.stringify(written ? { ok: true, swipe } : { ok: false, refused: true, swipe })] };
    }
    return { code: written ? 0 : 1, lines: [...out.kept, ...swipeLines(swipe, "write")] };
}
export async function swipeShowFlow(swipeId, opts, deps) {
    const res = await deps.get(`${SWIPES_PATH}?id=${encodeURIComponent(swipeId)}`);
    if (!res.ok)
        return swipeError(res, opts.json);
    const swipe = isRecord(res.data) && isRecord(res.data.swipe) ? res.data.swipe : null;
    if (!swipe)
        return failed("The server's answer about this swipe could not be read.", opts.json);
    if (opts.json)
        return { code: 0, lines: [JSON.stringify({ ok: true, swipe })] };
    return { code: 0, lines: swipeLines(swipe, "show") };
}
export async function swipeListFlow(opts, deps) {
    const res = await deps.get(SWIPES_PATH);
    if (!res.ok)
        return swipeError(res, opts.json);
    const swipes = isRecord(res.data) && Array.isArray(res.data.swipes) ? res.data.swipes : [];
    if (opts.json)
        return { code: 0, lines: [JSON.stringify({ ok: true, swipes })] };
    if (swipes.length === 0)
        return { code: 0, lines: ["This brand has no swipes yet."] };
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
export async function swipeStartFlow(swipeId, ask, opts, deps) {
    const { json } = opts;
    if (!opts.yes)
        return needsYesResult(ask.oneShot ? "start-one-shot" : "start", json);
    const res = await deps.post(SWIPE_RUNS_PATH, {
        swipeId,
        ...(ask.style ? { style: ask.style } : {}),
        ...(ask.title ? { title: ask.title } : {}),
        ...(ask.music ? { music: true } : {}),
        ...(ask.oneShot ? {} : { reviewStoryboard: true }),
    });
    if (!res.ok)
        return swipeError(res, json);
    const customer = customerAnswer(res.data);
    const data = isRecord(res.data) ? res.data : {};
    const runId = customer?.runId ?? (typeof data.runId === "string" ? data.runId : "");
    const url = customer?.dashboardUrl ?? (typeof data.url === "string" ? data.url : "");
    if (!runId)
        return failed("The server started the ad but did not say which run it is.", json);
    const card = isRecord(data.card) ? data.card : null;
    const label = (value) => (isRecord(value) && typeof value.label === "string" ? value.label : null);
    const head = [
        `Started ad run ${runId} from swipe ${swipeId}`,
        ...(label(card?.conceit) ? [`Kind of ad: ${label(card?.conceit)}`] : []),
        ...(label(card?.style) ? [`Look: ${label(card?.style)}`] : []),
        `Watch it: ${url}`,
    ];
    if (opts.wait)
        return startedThenWait(runId, head, { json, url, onProgressLine: opts.onProgressLine }, deps);
    if (json)
        return { code: 0, lines: [JSON.stringify({ ok: true, runId, url })] };
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
    "characters",
    "finish",
    "oneShot",
    "style",
    "title",
    "music",
];
const FINISH_FIELDS = ["captions", "speed", "jumpCuts", "music", "endCard"];
const CAPTION_STYLES = ["auto", "none", "3-word", "by-line"];
export const SHEET_VIDEO_WARNING = 6;
const SHEET_WORDS = {
    who: "In the sheet,",
    flag: (name) => `"${name}"`,
    set: (name, value) => `"${name}": "${value.replace(/^"|"$/g, "")}"`,
};
export const sheetStatePath = (sheetFile) => `${sheetFile}.state.json`;
const personaKey = (persona) => persona?.name ?? "";
const present = (value) => value !== undefined &&
    value !== null &&
    !(typeof value === "string" && !value.trim()) &&
    !(isRecord(value) && Object.keys(value).length === 0);
const quoted = (names) => names.map((name) => `"${name}"`).join(", ");
function inSheetDir(sheetFile, file) {
    return path.isAbsolute(file) ? file : path.join(path.dirname(sheetFile), file);
}
const MEMBER_SCRIPT_MAX_CHARS = 20_000;
const sha256Of = (text) => createHash("sha256").update(text).digest("hex");
function sheetWriteOf(sheetFile, given, scriptName, deps) {
    const write = writeChoicesOf(given, SHEET_WORDS);
    if ("problem" in write)
        return write;
    if (write.ask.scriptFile === undefined)
        return { ask: write.ask, scriptSha256: null };
    const named = write.ask.scriptFile;
    const scriptFile = inSheetDir(sheetFile, named);
    let script;
    try {
        script = deps.readFile(scriptFile);
    }
    catch {
        return { problem: `Can't read ${scriptName(named)}. Check the path.` };
    }
    const capital = (sentence) => sentence.replace(/^./, (c) => c.toUpperCase());
    if (!script.trim())
        return { problem: capital(`${scriptName(named)} is empty.`) };
    if (script.length > MEMBER_SCRIPT_MAX_CHARS) {
        return { problem: capital(`${scriptName(named)} is too long: a script can have at most 20,000 characters.`) };
    }
    return { ask: { ...write.ask, scriptFile, scriptText: script }, scriptSha256: sha256Of(script) };
}
export function readSwipeSheet(sheetFile, deps) {
    let text;
    try {
        text = deps.readFile(sheetFile);
    }
    catch {
        return { problem: `Can't read the sheet ${sheetFile}. Check the path.` };
    }
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch {
        return { problem: `The sheet ${sheetFile} is not valid JSON.` };
    }
    if (!isRecord(raw))
        return { problem: `The sheet ${sheetFile} must be one JSON object.` };
    if ("persona" in raw) {
        return { problem: 'The sheet has "persona"; a sheet takes "personas" now, a list of {"name": ..., "text": ...}.' };
    }
    const unknown = Object.keys(raw).filter((name) => !SHEET_FIELDS.includes(name));
    if (unknown.length > 0) {
        return { problem: `The sheet has ${quoted(unknown)}, which this command does not know. A sheet takes ${quoted(SHEET_FIELDS)}.` };
    }
    if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
        return { problem: 'The sheet needs "sources": a list of ads, each {"url": ...}, {"ad": ...} or {"file": ...}.' };
    }
    const sources = [];
    const seen = new Map();
    for (const [index, entry] of raw.sources.entries()) {
        const n = index + 1;
        if (!isRecord(entry))
            return { problem: `Source ${n} in the sheet must be {"url": ...}, {"ad": ...} or {"file": ...}.` };
        const extra = Object.keys(entry).filter((name) => !["url", "ad", "file"].includes(name));
        if (extra.length > 0)
            return { problem: `Source ${n} in the sheet has ${quoted(extra)}; a source is only "url", "ad" or "file".` };
        const kinds = ["url", "ad", "file"].filter((name) => entry[name] !== undefined && entry[name] !== null);
        if (kinds.length === 0)
            return { problem: `Source ${n} in the sheet needs one of "url", "ad" or "file".` };
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
        if (before !== undefined)
            return { problem: `Source ${n} in the sheet is the same ad as source ${before}. List each ad once.` };
        seen.set(key, n);
        if (kind === "url")
            sources.push({ key, given: { url: key }, source: { kind: "url", url: key } });
        else if (kind === "ad")
            sources.push({ key, given: { ad: key }, source: { kind: "ad", swipeAdId: key } });
        else
            sources.push({ key, given: { file: key }, source: { kind: "file", file: inSheetDir(sheetFile, key) } });
    }
    if (present(raw.product) && typeof raw.product !== "string") {
        return { problem: 'In the sheet, "product" must be a product id. exodus video swipe products lists them.' };
    }
    const productId = typeof raw.product === "string" && raw.product.trim() ? raw.product.trim() : null;
    const given = (from, name) => {
        const value = from[name];
        if (value === undefined || value === null)
            return undefined;
        const typed = typeof value === "string" ? value : typeof value === "number" ? String(value) : JSON.stringify(value);
        return typed.trim() ? typed : null;
    };
    if (raw.personas !== undefined && raw.personas !== null && !Array.isArray(raw.personas)) {
        return { problem: 'In the sheet, "personas" must be a list of {"name": ..., "text": ...}, or [] for none.' };
    }
    const personas = [];
    for (const [index, entry] of (raw.personas ?? []).entries()) {
        const n = index + 1;
        if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name.trim()) {
            return { problem: `Persona ${n} in the sheet needs a "name".` };
        }
        const name = entry.name.trim();
        const extra = Object.keys(entry).filter((field) => !["name", "text", "script"].includes(field));
        if (extra.length > 0)
            return { problem: `Persona ${name} in the sheet has ${quoted(extra)}; a persona takes "name", "text" and "script".` };
        if (personas.some((persona) => persona.name === name))
            return { problem: `The sheet has the persona ${name} twice. Name each persona once.` };
        if (entry.text !== undefined && entry.text !== null && typeof entry.text !== "string") {
            return { problem: `Persona ${name} in the sheet: "text" must be text.` };
        }
        let write = null;
        let script = null;
        if (entry.script !== undefined && entry.script !== null) {
            if (typeof entry.script !== "string" || !entry.script.trim())
                return { problem: `Persona ${name} in the sheet: "script" needs a file.` };
            script = entry.script.trim();
            const own = sheetWriteOf(sheetFile, { mode: "their-format", closeness: undefined, look: undefined, script }, (named) => `persona ${name}'s script ${named}`, deps);
            if ("problem" in own)
                return own;
            write = own;
        }
        personas.push({ name, script, write });
    }
    const choiceFields = ["mode", "closeness", "look", "script"];
    const top = { mode: given(raw, "mode"), closeness: given(raw, "closeness"), look: given(raw, "look"), script: given(raw, "script") };
    let write = null;
    let unusedChoices = [];
    if (personas.length === 0 || personas.some((persona) => persona.write === null)) {
        const checked = sheetWriteOf(sheetFile, top, (named) => `the sheet's script ${named}`, deps);
        if ("problem" in checked)
            return checked;
        write = checked;
    }
    else {
        const theirFormat = typeof top.mode === "string" && parseSwipeMode(top.mode) === "their-format";
        const checked = writeChoicesOf({ ...top, script: top.script ?? (theirFormat ? "-" : undefined) }, SHEET_WORDS);
        if ("problem" in checked)
            return checked;
        unusedChoices = choiceFields.filter((name) => present(raw[name]));
    }
    const characters = raw.characters;
    if (characters !== undefined && characters !== null) {
        if (!isRecord(characters))
            return { problem: 'In the sheet, "characters" must be {"how": "auto"}, or left out.' };
        const extra = Object.keys(characters).filter((name) => !["how", "picked"].includes(name));
        if (extra.length > 0)
            return { problem: `In the sheet, "characters" has ${quoted(extra)}; it takes "how" and "picked".` };
        const how = characters.how ?? "auto";
        if (!["auto", "saved", "draw"].includes(how)) {
            return { problem: `In the sheet, "characters" "how" must be "auto", "saved" or "draw", not ${JSON.stringify(how)}.` };
        }
        if (characters.picked !== undefined && characters.picked !== null && !Array.isArray(characters.picked)) {
            return { problem: 'In the sheet, "characters" "picked" must be a list.' };
        }
        const picked = characters.picked ?? [];
        if (how !== "auto" || picked.length > 0) {
            const asked = how !== "auto" ? `"how": "${how}"` : "picked characters";
            return {
                problem: `In the sheet, "characters" asks for ${asked}, but characters on a swiped run aren't supported yet: the run casts its own. Use "how": "auto" with no "picked", or leave "characters" out.`,
            };
        }
    }
    const sheetCharacters = [{ index: 0, pick: null }];
    const finish = raw.finish ?? {};
    if (!isRecord(finish))
        return { problem: 'In the sheet, "finish" must be {"captions": ..., "speed": ..., ...}, or left out.' };
    const finishExtra = Object.keys(finish).filter((name) => !FINISH_FIELDS.includes(name));
    if (finishExtra.length > 0)
        return { problem: `In the sheet, "finish" has ${quoted(finishExtra)}; it takes ${quoted(FINISH_FIELDS)}.` };
    const set = (name) => finish[name] !== undefined && finish[name] !== null;
    if (set("captions") && !CAPTION_STYLES.includes(finish.captions)) {
        return { problem: `In the sheet, "finish" "captions" must be "auto", "none", "3-word" or "by-line", not ${JSON.stringify(finish.captions)}.` };
    }
    if (set("speed") && !(typeof finish.speed === "number" && finish.speed > 0)) {
        return { problem: 'In the sheet, "finish" "speed" must be a number, like 1.15.' };
    }
    for (const name of ["jumpCuts", "music", "endCard"]) {
        if (set(name) && typeof finish[name] !== "boolean")
            return { problem: `In the sheet, "finish" "${name}" must be true or false.` };
    }
    for (const name of ["music", "oneShot"]) {
        if (raw[name] !== undefined && raw[name] !== null && typeof raw[name] !== "boolean") {
            return { problem: `In the sheet, "${name}" must be true or false.` };
        }
    }
    const topMusic = typeof raw.music === "boolean" ? raw.music : undefined;
    const finishMusic = typeof finish.music === "boolean" ? finish.music : undefined;
    if (topMusic !== undefined && finishMusic !== undefined && topMusic !== finishMusic) {
        return { problem: 'The sheet has "music" twice, at the top and in "finish", and they differ. Keep the one in "finish".' };
    }
    if (present(raw.style) && typeof raw.style !== "string")
        return { problem: 'In the sheet, "style" must be a look\'s slug, or null.' };
    if (present(raw.title) && typeof raw.title !== "string")
        return { problem: 'In the sheet, "title" must be text, or null.' };
    const start = startChoicesOf({ style: given(raw, "style"), title: given(raw, "title"), music: (finishMusic ?? topMusic) === true, oneShot: raw.oneShot === true }, SHEET_WORDS);
    if ("problem" in start)
        return start;
    if (present(raw.mechanism) && !isRecord(raw.mechanism) && typeof raw.mechanism !== "string") {
        return { problem: 'In the sheet, "mechanism" must be {"name": ..., "text": ...}, or null.' };
    }
    if (present(raw.guidance) && typeof raw.guidance !== "string")
        return { problem: 'In the sheet, "guidance" must be text, or "".' };
    const notUsed = [
        ...["mechanism", "guidance"].filter((name) => present(raw[name])),
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
        },
    };
}
export function sheetVideos(sheet, only) {
    const all = sheet.personas.length > 0 ? sheet.personas : [null];
    let personas = all;
    if (only !== null) {
        const persona = sheet.personas.find((p) => p.name === only.trim());
        if (!persona) {
            return {
                problem: sheet.personas.length === 0
                    ? `The sheet has no personas, so --persona ${only} has nothing to narrow.`
                    : `The sheet has no persona named ${only}. Its personas: ${sheet.personas.map((p) => p.name).join(", ")}.`,
            };
        }
        personas = [persona];
    }
    const videos = [];
    for (const source of sheet.sources) {
        for (const persona of all) {
            for (const character of sheet.characters)
                videos.push({ n: videos.length + 1, source, persona, character });
        }
    }
    return { videos: videos.filter((video) => personas.includes(video.persona)), personas };
}
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const characterLabel = (character) => (character.pick === null ? "the run's own cast" : `character ${character.index + 1}`);
const videoLabel = (video) => `${video.source.key}, ${video.persona?.name ?? "no persona"}, ${characterLabel(video.character)}`;
function videoListLines(sheet, videos, personas) {
    const personaPart = personas[0] === null ? "1 (no persona)" : plural(personas.length, "persona", "personas");
    const castPart = sheet.characters.every((c) => c.pick === null) ? plural(sheet.characters.length, "cast", "casts") : plural(sheet.characters.length, "character", "characters");
    return [
        `${plural(videos.length, "video", "videos")} = ${plural(sheet.sources.length, "ad", "ads")} × ${personaPart} × ${castPart}:`,
        ...videos.map((video) => `  ${video.n}. ${videoLabel(video)}`),
    ];
}
const writeOf = (sheet, persona) => persona?.write ?? sheet.write;
function writtenWithOf(write, productId) {
    return {
        productId,
        mode: write.ask.mode,
        closeness: write.ask.mode === "their-format" ? null : write.ask.closeness,
        look: write.ask.look ?? null,
        scriptSha256: write.scriptSha256,
    };
}
function changesSince(before, now) {
    const changes = [];
    if (before.productId !== now.productId)
        changes.push(`product ${before.productId}, now ${now.productId}`);
    if (before.mode !== now.mode)
        changes.push(`mode ${modeOf(before.mode).flag}, now ${modeOf(now.mode).flag}`);
    else if (before.closeness !== now.closeness)
        changes.push(`closeness ${before.closeness}, now ${now.closeness}`);
    if (before.look !== now.look)
        changes.push(`look ${before.look ?? "none"}, now ${now.look ?? "none"}`);
    if (before.scriptSha256 !== now.scriptSha256)
        changes.push("the script");
    return changes;
}
function notUsedOf(sheet, personas) {
    const told = sheet.notUsed.filter((name) => !name.startsWith("finish."));
    const finish = sheet.notUsed.filter((name) => name.startsWith("finish.")).map((name) => name.slice("finish.".length));
    const unscripted = personas.filter((p) => p !== null && p.write === null).map((p) => p.name);
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
function sheetHeadLines(sheet, sheetFile, personas, product) {
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
            .filter((persona) => persona !== null && persona.script !== null)
            .map((persona) => `Persona ${persona.name}: ${modeOf("their-format").label}, from ${persona.script}.`),
        sheet.start.oneShot
            ? "One shot: the whole video with no stop. It stops only when a check finds a problem."
            : "It stops at each storyboard for the member's yes (oneShot is false or left out).",
        "Characters: each run casts its own.",
        ...(sheet.moved.includes("music") ? ['"music" is read from the top of the sheet. It has moved into "finish".'] : []),
        ...notUsedOf(sheet, personas).lines,
    ];
}
export const nodeSheetFiles = {
    createNew(file, text) {
        try {
            fs.writeFileSync(file, text, { flag: "wx" });
            return true;
        }
        catch (err) {
            if (err.code === "EEXIST")
                return false;
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
        }
        catch (err) {
            return err.code === "EPERM";
        }
    },
    realPath(file) {
        return fs.realpathSync(file);
    },
    onStop(cleanup) {
        const handlers = ["SIGINT", "SIGTERM"].map((signal) => {
            const handler = () => {
                cleanup();
                process.exit(signal === "SIGINT" ? 130 : 143);
            };
            process.once(signal, handler);
            return [signal, handler];
        });
        return () => {
            for (const [signal, handler] of handlers)
                process.off(signal, handler);
        };
    },
};
const sheetFilesOf = (deps) => deps.sheetFiles ?? nodeSheetFiles;
export const sheetLockPath = (sheetFile) => `${sheetStatePath(sheetFile)}.lock`;
const LOCK_SETTLE_MS = 250;
async function takeSheetLock(sheetFile, deps) {
    const files = sheetFilesOf(deps);
    const lockFile = sheetLockPath(sheetFile);
    const token = randomUUID();
    const text = JSON.stringify({ pid: files.pid, host: files.host, at: stamp(deps), token });
    const busy = (holder) => `Another run of this sheet holds ${lockFile} (${holder}). Two at once would buy steps twice, so this one sent nothing. If no run of this sheet is going, deleting ${lockFile} is safe; then run the command again.`;
    const holderOf = () => {
        let holder = {};
        try {
            const parsed = JSON.parse(deps.readFile(lockFile));
            if (isRecord(parsed))
                holder = parsed;
        }
        catch {
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
        }
        catch (err) {
            return err instanceof Error ? err : new Error(String(err));
        }
    };
    let note = null;
    let made = tryCreate();
    if (made === false) {
        const holder = holderOf();
        const stale = holder.pid !== null && holder.host === files.host && !files.isAlive(holder.pid);
        if (!stale)
            return { problem: busy(holder.words) };
        const still = holderOf();
        const same = holder.token !== null ? still.token === holder.token : still.token === null && still.pid === holder.pid && still.at === holder.at;
        if (!same)
            return { problem: busy(still.words) };
        files.remove(lockFile);
        made = tryCreate();
        note = `A lock left by a run that is no longer going (${holder.words}) was taken.`;
    }
    if (made === false)
        return { problem: busy(holderOf().words) };
    if (made !== true)
        return { problem: `The lock ${lockFile} could not be made (${made.message}). Nothing was sent.` };
    await deps.sleep(LOCK_SETTLE_MS);
    const after = holderOf();
    if (after.token !== token)
        return { problem: busy(after.words) };
    let released = false;
    const release = () => {
        if (released)
            return;
        released = true;
        stopWatching();
        if (holderOf().token === token)
            files.remove(lockFile);
    };
    const stopWatching = files.onStop(release);
    return { release, note };
}
const dict = () => Object.create(null);
function stateFromJson(raw) {
    if (!isRecord(raw) || raw.version !== 3)
        return 'it has no "version": 3';
    if (typeof raw.sheet !== "string")
        return '"sheet" is not text';
    if (!isRecord(raw.sources))
        return '"sources" is not an object';
    const text = (value) => value === null || typeof value === "string";
    const at = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
    const sources = dict();
    for (const [key, src] of Object.entries(raw.sources)) {
        const where = `the ad ${key}`;
        if (!isRecord(src) || !["url", "ad", "file"].includes(src.kind))
            return `${where} has no "kind"`;
        if (!text(src.breakdownId) || typeof src.templateDone !== "boolean" || !text(src.lastError) || !text(src.updatedAt)) {
            return `${where} has a field of the wrong kind`;
        }
        const sp = src.pending;
        if (sp !== null && !(isRecord(sp) && ["breakdown", "template"].includes(sp.step) && at(sp.at) && (sp.job === undefined || typeof sp.job === "string"))) {
            return `${where} has a "pending" this CLI did not write`;
        }
        if (!isRecord(src.writes))
            return `${where} has no "writes"`;
        const writes = dict();
        for (const [persona, write] of Object.entries(src.writes)) {
            const whereWrite = `${where}, persona "${persona}"`;
            if (!isRecord(write) || !text(write.swipeId) || !text(write.refused) || !text(write.lastError) || !text(write.updatedAt)) {
                return `${whereWrite} has a field of the wrong kind`;
            }
            const choices = (ww) => isRecord(ww) &&
                typeof ww.productId === "string" &&
                ["whole", "hook", "their-format", "new-look"].includes(ww.mode) &&
                (ww.closeness === null || typeof ww.closeness === "number") &&
                text(ww.look) &&
                text(ww.scriptSha256);
            if (write.writtenWith !== null && !choices(write.writtenWith))
                return `${whereWrite} has a "writtenWith" this CLI did not write`;
            if (write.swipeId !== null && write.writtenWith === null)
                return `${whereWrite} has a "swipeId" with no "writtenWith"`;
            const wp = write.pending;
            if (wp !== null &&
                !(isRecord(wp) && at(wp.at) && (wp.job === undefined || typeof wp.job === "string") && (wp.asked === undefined || choices(wp.asked)))) {
                return `${whereWrite} has a "pending" this CLI did not write`;
            }
            if (!isRecord(write.runs))
                return `${whereWrite} has no "runs"`;
            const runs = dict();
            for (const [index, run] of Object.entries(write.runs)) {
                const whereRun = `${whereWrite}, character ${index}`;
                if (!/^\d+$/.test(index) || !isRecord(run) || !text(run.runId) || !text(run.watch) || !text(run.lastError) || !text(run.updatedAt)) {
                    return `${whereRun} has a field of the wrong kind`;
                }
                const rp = run.pending;
                if (rp !== null && !(isRecord(rp) && at(rp.at) && typeof rp.swipeId === "string"))
                    return `${whereRun} has a "pending" this CLI did not write`;
                runs[index] = { ...run };
            }
            writes[persona] = { ...write, runs };
        }
        sources[key] = { ...src, writes };
    }
    return { version: 3, sheet: raw.sheet, sources };
}
function readSheetState(sheetFile, deps) {
    const file = sheetStatePath(sheetFile);
    let text;
    try {
        text = deps.readFile(file);
    }
    catch (err) {
        if (err.code === "ENOENT")
            return { state: { version: 3, sheet: path.basename(sheetFile), sources: dict() } };
        return {
            problem: `The state file ${file} is there but can't be opened (${err instanceof Error ? err.message : String(err)}). It keeps what this sheet already bought, so nothing was sent. Fix its permissions, then run the command again.`,
        };
    }
    let checked;
    try {
        checked = stateFromJson(JSON.parse(text));
    }
    catch {
        checked = "it is not valid JSON";
    }
    if (typeof checked !== "string")
        return { state: checked };
    return {
        problem: `The state file ${file} can't be read: ${checked}. Fix it, or move it away; without it the next run buys every step again, even the ones already bought.`,
    };
}
function sourceStateOf(state, item) {
    const saved = state.sources[item.key];
    if (saved && saved.kind === item.source.kind)
        return saved;
    const fresh = { kind: item.source.kind, breakdownId: null, templateDone: false, pending: null, lastError: null, updatedAt: null, writes: dict() };
    state.sources[item.key] = fresh;
    return fresh;
}
function writeStateOf(source, persona) {
    const key = personaKey(persona);
    source.writes[key] ??= { swipeId: null, writtenWith: null, refused: null, pending: null, lastError: null, updatedAt: null, runs: dict() };
    return source.writes[key];
}
function runStateOf(write, character) {
    const key = String(character.index);
    write.runs[key] ??= { runId: null, watch: null, pending: null, lastError: null, updatedAt: null };
    return write.runs[key];
}
function peekVideo(state, video) {
    const source = state.sources[video.source.key];
    const src = source && source.kind === video.source.source.kind ? source : null;
    const write = src?.writes[personaKey(video.persona)] ?? null;
    const run = write?.runs[String(video.character.index)] ?? null;
    return { src, write, run };
}
function heldIds(state) {
    const runs = new Map();
    const swipes = new Set();
    for (const src of Object.values(state.sources)) {
        for (const write of Object.values(src.writes)) {
            if (write.swipeId)
                swipes.add(write.swipeId);
            for (const run of Object.values(write.runs))
                if (run.runId)
                    runs.set(run.runId, run);
        }
    }
    return { runs, swipes };
}
function productsOf(data) {
    return isRecord(data) && Array.isArray(data.products) ? data.products : [];
}
async function sheetProduct(sheet, deps) {
    const res = await deps.get(SWIPE_PRODUCTS_PATH);
    if (!res.ok)
        return { problem: swipeErrorLine(res) };
    const products = productsOf(res.data);
    if (sheet.productId) {
        const product = products.find((row) => row.id === sheet.productId);
        if (!product)
            return { problem: `The sheet's product ${sheet.productId} is not one of this brand's products. exodus video swipe products lists them.` };
        return { product, picked: false };
    }
    if (products.length === 0)
        return { problem: "This brand has no products yet. Add one in the dashboard first." };
    if (products.length > 1) {
        return { problem: `The sheet names no product, and this brand has ${products.length}. Put one in "product": exodus video swipe products lists them.` };
    }
    return { product: products[0], picked: true };
}
function answerOf(result) {
    try {
        const data = JSON.parse(result.lines[0] ?? "");
        return isRecord(data) ? data : {};
    }
    catch {
        return {};
    }
}
const errorOf = (answer) => [answer.error, answer.mayStillFinish].filter((part) => typeof part === "string").join(" ") || "The server's answer could not be read.";
const postRefused = (answer) => typeof answer.status === "number" && answer.status >= 400 && answer.status < 500 && answer.mayStillFinish === undefined;
const minutesAgo = (ms) => {
    const minutes = Math.max(0, Math.round(ms / 60000));
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
};
async function plannedSteps(item, videos, state, sheet, productId, retryRefused, deps) {
    const startKey = sheet.start.oneShot ? "start-one-shot" : "start";
    const paid = (step, key, extra = {}) => ({ step, ...extra, buy: true, ...PAID[key] });
    const kept = (step, key, have, note, extra = {}) => ({
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
            if (read?.breakdown.status === "failed")
                breakdownId = null;
            else if (read && read.breakdown.status !== "done")
                breakdownNote = "Still being read. Nothing more is bought for it.";
            if (read?.template)
                templateDone = true;
        }
    }
    const steps = [
        breakdownId || templateDone ? kept("breakdown", "breakdown", breakdownId, breakdownNote) : paid("breakdown", "breakdown"),
        templateDone ? kept("template", "template", null, "Made before. It costs nothing again.") : paid("template", "template"),
    ];
    const personas = [...new Set(videos.map((video) => video.persona))];
    for (const persona of personas) {
        const who = { persona: persona?.name ?? null };
        const write = src?.writes[personaKey(persona)] ?? null;
        const own = videos.filter((video) => video.persona === persona);
        const starts = own.map((video) => {
            const run = peekVideo(state, video).run;
            if (run?.runId)
                return kept("start", startKey, run.runId, `Started before: run ${run.runId}. Nothing is sent again.`, { video: video.n });
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
        const changes = write?.swipeId && write.writtenWith ? changesSince(write.writtenWith, writtenWithOf(writeOf(sheet, persona), productId)) : [];
        if (write?.swipeId && changes.length > 0) {
            const was = write.refused !== null ? "refused" : "written";
            steps.push(paid("write", "write", { ...who, note: `The sheet changed since swipe ${write.swipeId} was ${was} (${changes.join("; ")}), so it is written again.` }));
        }
        else if (write?.swipeId && write.refused !== null) {
            if (!retryRefused) {
                steps.push(kept("write", "write", write.swipeId, `The writer refused it before: ${write.refused} Nothing is written again without --retry-refused.`, who), ...own.map((video) => kept("start", startKey, null, "Nothing to start: the write was refused.", { video: video.n })));
                continue;
            }
            steps.push(paid("write", "write", { ...who, note: `The writer refused it before: ${write.refused} --retry-refused writes it again.` }));
        }
        else if (write?.swipeId) {
            steps.push(kept("write", "write", write.swipeId, "Written before. It costs nothing again.", who));
        }
        else {
            steps.push(paid("write", "write", {
                ...who,
                ...(write?.pending
                    ? {
                        note: write.pending.asked && changesSince(write.pending.asked, writtenWithOf(writeOf(sheet, persona), productId)).length > 0
                            ? `A write was sent before with the earlier choices (${changesSince(write.pending.asked, writtenWithOf(writeOf(sheet, persona), productId)).join("; ")}). Its swipe is never used. ${write.pending.job
                                ? "Once its job has ended the sheet's choices now are written; while it is still writing, the run stops and writes nothing."
                                : "The sheet's choices now are written once 15 minutes have passed since it was sent; before that, the run stops and writes nothing."}`
                            : "A write was sent before and its end was not seen. The run looks for it first and writes again only when it proves none was made, or finds no trace of it after 15 minutes.",
                    }
                    : {}),
            }));
        }
        steps.push(...starts);
    }
    return steps;
}
function plannedLines(steps) {
    return steps.flatMap((step) => {
        const name = step.step === "write"
            ? `Write${step.persona ? ` for ${step.persona}` : ""}`
            : step.step === "start"
                ? `Start of video ${step.video}`
                : STEP_WORD[step.step];
        if (!step.buy)
            return [`  ${name}${step.have ? ` (${step.have})` : ""}: ${step.note}`];
        return [`  ${name}. It buys: ${step.buys}`, `    Who pays: ${step.paidBy}`, ...(step.note ? [`    ${step.note}`] : [])];
    });
}
const STEP_WORD = { breakdown: "Breakdown", template: "Template", write: "Write", start: "Start" };
class StateNotSaved extends Error {
}
const stamp = (deps) => new Date(deps.now()).toISOString();
const START_PENDING_MS = 35 * 60 * 1000;
const CLOCK_SLACK_MS = 60 * 1000;
async function runSheetSource(item, videos, ctx) {
    const { sheet, state, save, say, deps } = ctx;
    const src = sourceStateOf(state, item);
    const outcomes = new Map(videos.map((video) => [video, { video, runId: null, watch: null, refused: null, stopped: null }]));
    const stopAll = (step, why, among, who = "") => {
        say(`  ${who}Stopped at the ${step}: ${why}`);
        for (const video of among)
            outcomes.get(video).stopped = { step, why };
    };
    const touch = (row) => {
        row.updatedAt = stamp(deps);
        save();
    };
    const ageOf = (pending) => (pending ? deps.now() - Date.parse(pending.at) : 0);
    const unreachable = (err) => {
        if (err instanceof StateNotSaved)
            throw err;
        return `The server could not be reached: ${describeFetchFailure(err)}. Run the sheet again to go on where it stopped.`;
    };
    const done = () => [...outcomes.values()];
    const toRun = videos.filter((video) => {
        const run = runStateOf(writeStateOf(src, video.persona), video.character);
        if (!run.runId)
            return true;
        Object.assign(outcomes.get(video), { runId: run.runId, watch: run.watch });
        say(`  Video ${video.n}: started before, run ${run.runId}. Nothing was sent.`);
        return false;
    });
    if (toRun.length === 0)
        return done();
    let step = "breakdown";
    const stopSource = (why) => {
        src.lastError = why;
        touch(src);
        stopAll(step, why, toRun);
        return done();
    };
    try {
        if (!src.templateDone) {
            if (!src.breakdownId) {
                if (src.pending?.step === "breakdown") {
                    return stopSource(`This file's breakdown was asked for ${minutesAgo(ageOf(src.pending))} ago and its answer was not seen, so the file may already be read. Reading it again is paid: to do it anyway, take this ad's entry out of ${sheetStatePath(ctx.sheetFile)}.`);
                }
                let marked = false;
                const beforePaidAsk = () => {
                    src.pending = { step: "breakdown", at: stamp(deps) };
                    marked = true;
                    touch(src);
                };
                const started = answerOf(await swipeBreakdownFlow(item.source, { json: true, yes: true, wait: false, beforePaidAsk }, deps));
                if (started.ok !== true || typeof started.breakdownId !== "string") {
                    if (marked && postRefused(started))
                        src.pending = null;
                    return stopSource(errorOf(started));
                }
                src.breakdownId = started.breakdownId;
                src.pending = null;
                touch(src);
                say(started.existing === true
                    ? `  This ad already has a breakdown: ${src.breakdownId}. It cost nothing.`
                    : `  Breakdown ${src.breakdownId} started. It reads the ad on the team's keys, in a few minutes.`);
            }
            else {
                say(`  Breakdown ${src.breakdownId}, from before.`);
            }
            const breakdownId = src.breakdownId;
            const waited = await waitForBreakdown(breakdownId, { json: true, yes: true, wait: true }, deps, (line) => say(`  ${line}`));
            const breakdown = isRecord(waited.json.breakdown) ? waited.json.breakdown : null;
            if (breakdown?.status === "failed") {
                src.breakdownId = null;
                return stopSource(`The breakdown failed: ${breakdown.error ?? "no reason was given."} Reading the ad again is paid too.`);
            }
            if (waited.code !== 0 || breakdown?.status !== "done")
                return stopSource(waited.lines.join(" "));
            say("  The breakdown is done.");
            for (const line of spentLines(breakdown))
                say(`  ${line}`);
            step = "template";
            let template = isRecord(waited.json.template) ? waited.json.template : null;
            if (!template && src.pending?.step === "template") {
                const pending = src.pending;
                if (pending.job) {
                    const res = await deps.get(`${SWIPE_TEMPLATE_PATH}?breakdownId=${encodeURIComponent(breakdownId)}&job=${encodeURIComponent(pending.job)}`);
                    const answer = res.ok && isRecord(res.data) ? res.data : null;
                    if (!answer) {
                        return stopSource(`The template asked for ${minutesAgo(ageOf(pending))} ago could not be checked: ${res.ok ? "its answer could not be read" : swipeErrorLine(res)}. Nothing was sent again.${res.status === 404 ? goneJob(`sources[${JSON.stringify(item.key)}].pending`, ctx.sheetFile, "makes the template again") : ""}`);
                    }
                    if (answer.status === "stored" && isRecord(answer.template))
                        template = answer.template;
                    else if (answer.status === "making") {
                        return stopSource("The template asked for before is still being made, so nothing was sent again. Run the sheet again in a few minutes.");
                    }
                    else if (answer.status !== "failed") {
                        return stopSource("The template asked for before could not be checked, so nothing was sent again.");
                    }
                }
                else if (ageOf(pending) < TEMPLATE_MAX_POLLS * POLL_MS) {
                    return stopSource(`The template was asked for ${minutesAgo(ageOf(pending))} ago and its answer was not seen. It may still be being made, so nothing was sent again. Run the sheet again in a few minutes.`);
                }
                else {
                    say(`  No trace of the template asked for ${minutesAgo(ageOf(pending))} ago was found, so it is made again.`);
                }
            }
            if (template) {
                src.templateDone = true;
                src.pending = null;
                src.lastError = null;
                touch(src);
                say(`  Kind of ad: ${template.kind.label}. Look: ${template.look.label}. The template was made before, so it cost nothing.`);
            }
            else {
                const at = stamp(deps);
                src.pending = { step: "template", at };
                touch(src);
                say("  Making the template on the member's key. It takes up to six minutes.");
                let jobNamed = false;
                const onJob = (job) => {
                    src.pending = { step: "template", at, job };
                    jobNamed = true;
                    touch(src);
                };
                const made = answerOf(await swipeTemplateFlow(breakdownId, { json: true, yes: true, wait: false, onJob }, deps));
                if (made.ok !== true || !isRecord(made.template)) {
                    if (!jobNamed && postRefused(made))
                        src.pending = null;
                    return stopSource(errorOf(made));
                }
                const view = made.template;
                src.templateDone = true;
                src.pending = null;
                src.lastError = null;
                touch(src);
                say(`  Kind of ad: ${view.kind.label}. Look: ${view.look.label}.`);
            }
        }
    }
    catch (err) {
        return stopSource(unreachable(err));
    }
    const breakdownId = src.breakdownId;
    for (const persona of [...new Set(toRun.map((video) => video.persona))]) {
        const own = toRun.filter((video) => video.persona === persona);
        const who = persona ? `${persona.name}: ` : "";
        const write = writeStateOf(src, persona);
        const open = [];
        for (const video of own) {
            const run = runStateOf(write, video.character);
            if (!run.pending) {
                open.push(video);
                continue;
            }
            const settled = await settlePendingStart(video, run, outcomes.get(video), ctx).catch((err) => {
                stopRun(video, run, outcomes.get(video), unreachable(err), ctx);
                return "stopped";
            });
            if (settled === "clear")
                open.push(video);
        }
        if (open.length === 0)
            continue;
        const sheetWrite = writeOf(sheet, persona);
        const writtenWith = writtenWithOf(sheetWrite, ctx.productId);
        const stopWrite = (why) => {
            write.lastError = why;
            touch(write);
            stopAll("write", why, open, who);
        };
        let swipeId;
        try {
            const changes = write.swipeId && write.writtenWith ? changesSince(write.writtenWith, writtenWith) : [];
            if (write.swipeId && write.refused !== null && changes.length === 0 && !ctx.retryRefused) {
                for (const video of open)
                    outcomes.get(video).refused = write.refused;
                stopWrite(`The writer refused it before: ${write.refused} (swipe ${write.swipeId}). Nothing was written again; --retry-refused writes it again, which is paid.`);
                continue;
            }
            if (write.swipeId && write.refused === null && changes.length === 0) {
                swipeId = write.swipeId;
                say(`  ${who}Swipe ${swipeId}, written before.`);
            }
            else {
                if (changes.length > 0) {
                    say(`  ${who}The sheet changed since swipe ${write.swipeId} was ${write.refused !== null ? "refused" : "written"} (${changes.join("; ")}), so it is written again.`);
                }
                else if (write.swipeId && write.refused !== null) {
                    say(`  ${who}The writer refused it before. Writing it again (--retry-refused).`);
                }
                let swipe = null;
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
                    const onJob = (job) => {
                        write.pending = { at, job, asked: writtenWith };
                        jobNamed = true;
                        touch(write);
                    };
                    const wrote = answerOf(await swipeWriteFlow(breakdownId, { productId: ctx.productId, ...sheetWrite.ask }, { json: true, yes: true, wait: false, onJob }, deps));
                    if (!isRecord(wrote.swipe)) {
                        if (!jobNamed && postRefused(wrote))
                            write.pending = null;
                        stopWrite(errorOf(wrote));
                        continue;
                    }
                    swipe = wrote.swipe;
                }
                write.pending = null;
                write.swipeId = swipe._id;
                write.writtenWith = truth;
                if (swipe.outcome.kind === "refused") {
                    write.refused = swipe.outcome.why;
                    for (const video of open)
                        outcomes.get(video).refused = write.refused;
                    stopWrite(`The writer refused: ${swipe.outcome.why} (swipe ${swipe._id}). ${costLine(swipe)}`);
                    continue;
                }
                write.refused = null;
                write.lastError = null;
                touch(write);
                swipeId = swipe._id;
                say(`  ${who}Swipe ${swipeId} written. ${costLine(swipe)}`);
            }
        }
        catch (err) {
            stopWrite(unreachable(err));
            continue;
        }
        for (const video of open) {
            const run = runStateOf(write, video.character);
            await startVideo(video, run, swipeId, outcomes.get(video), ctx).catch((err) => stopRun(video, run, outcomes.get(video), unreachable(err), ctx));
        }
    }
    return done();
}
function stopRun(video, run, outcome, why, ctx) {
    run.lastError = why;
    run.updatedAt = stamp(ctx.deps);
    ctx.save();
    ctx.say(`  Video ${video.n}: stopped at the start: ${why}`);
    outcome.stopped = { step: "start", why };
}
function takeRun(video, run, outcome, runId, watch, ctx) {
    Object.assign(run, { runId, watch, pending: null, lastError: null, updatedAt: stamp(ctx.deps) });
    ctx.save();
    Object.assign(outcome, { runId, watch });
}
async function sayIfFailedAtStart(video, runId, swipeId, ctx) {
    const res = await ctx.deps.get(`${RUN_PATH}?runId=${encodeURIComponent(runId)}`).catch(() => null);
    if (!res?.ok || runStateWord(res.data) !== "failed")
        return;
    ctx.say(`  Video ${video.n}: run ${runId} failed at its start. To start this swipe again by hand (paid): exodus video swipe start ${swipeId} --yes`);
}
async function readSwipe(swipeId, deps) {
    const res = await deps.get(`${SWIPES_PATH}?id=${encodeURIComponent(swipeId)}`);
    if (!res.ok)
        return { problem: swipeErrorLine(res) };
    return isRecord(res.data) && isRecord(res.data.swipe) ? { swipe: res.data.swipe } : { problem: "Its answer could not be read." };
}
async function settlePendingStart(video, run, outcome, ctx) {
    const pending = run.pending;
    const ago = minutesAgo(ctx.deps.now() - Date.parse(pending.at));
    const read = await readSwipe(pending.swipeId, ctx.deps);
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
    if (ctx.deps.now() - Date.parse(pending.at) < START_PENDING_MS) {
        stopRun(video, run, outcome, `A start was sent ${ago} ago and its answer was not seen. It may still be starting, so nothing was sent again. Run the sheet again in a few minutes.`, ctx);
        return "stopped";
    }
    run.pending = null;
    ctx.save();
    return "clear";
}
async function startVideo(video, run, swipeId, outcome, ctx) {
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
    run.pending = { at: stamp(ctx.deps), swipeId };
    run.updatedAt = stamp(ctx.deps);
    ctx.save();
    const started = answerOf(await swipeStartFlow(swipeId, ctx.sheet.start, { json: true, yes: true, wait: false }, ctx.deps));
    if (started.ok !== true || typeof started.runId !== "string") {
        if (postRefused(started))
            run.pending = null;
        stopRun(video, run, outcome, errorOf(started), ctx);
        return;
    }
    takeRun(video, run, outcome, started.runId, typeof started.url === "string" && started.url ? started.url : null, ctx);
    ctx.say(`  Video ${video.n}: started ad run ${started.runId}. Watch it: ${outcome.watch ?? `exodus video status ${started.runId}`}`);
}
const goneJob = (entry, sheetFile, again) => ` If it stays not found, remove ${entry} from ${sheetStatePath(sheetFile)}; the next run then ${again}, which is paid.`;
function writtenWithOfSwipe(swipe) {
    const mode = swipe.request.mode;
    const script = swipe.request.memberScript;
    return {
        productId: swipe.productId,
        mode,
        closeness: mode === "their-format" ? null : (swipe.request.closeness ?? null),
        look: swipe.request.look ?? null,
        scriptSha256: mode === "their-format" && typeof script === "string" ? sha256Of(script) : null,
    };
}
async function findPendingWrite(pending, breakdownId, want, ctx, who, entry) {
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
            const swipe = answer.swipe;
            const truth = writtenWithOfSwipe(swipe);
            const scriptKnown = truth.mode !== "their-format" || truth.scriptSha256 !== null;
            const changes = changesSince(truth, want);
            if (scriptKnown && changes.length === 0)
                return { taken: { swipe, writtenWith: truth } };
            ctx.say(`  ${who}The write sent ${ago} ago ended as swipe ${swipe._id}, written with the earlier choices (${changes.join("; ") || "a script that can't be checked"}). It is not used; the sheet's choices now are written.`);
            return { taken: null };
        }
        if (answer.status === "writing")
            return { stop: "The write sent before is still writing, so nothing was sent again. Run the sheet again in a few minutes." };
        if (answer.status === "failed") {
            ctx.say(`  ${who}The write sent before stopped without a swipe: ${typeof answer.error === "string" ? answer.error : "no reason was given."}`);
            return { taken: null };
        }
        return { stop: "The write sent before could not be checked, so nothing was sent again." };
    }
    if (want.mode !== "their-format") {
        const listed = await deps.get(SWIPES_PATH);
        if (!listed.ok)
            return { stop: `The write sent ${ago} ago could not be looked for: ${swipeErrorLine(listed)} Nothing was sent again.` };
        const rows = isRecord(listed.data) && Array.isArray(listed.data.swipes) ? listed.data.swipes : [];
        const since = Date.parse(pending.at) - CLOCK_SLACK_MS;
        const held = heldIds(ctx.state).swipes;
        const matching = rows
            .filter((row) => typeof row.createdAt === "number" && row.createdAt >= since && !held.has(row._id))
            .filter((row) => row.breakdownId === breakdownId && row.request.mode === want.mode)
            .filter((row) => want.closeness === null || row.request.closeness === want.closeness)
            .slice(0, 3);
        for (const row of matching) {
            const read = await readSwipe(row._id, deps);
            if ("problem" in read)
                return { stop: `Swipe ${row._id} could not be read to check it is the write sent before: ${read.problem} Nothing was sent again.` };
            if (read.swipe.productId === want.productId && (read.swipe.request.look ?? null) === want.look) {
                return { taken: { swipe: read.swipe, writtenWith: writtenWithOfSwipe(read.swipe) } };
            }
        }
    }
    if (deps.now() - Date.parse(pending.at) < WRITE_MAX_POLLS * POLL_MS) {
        return { stop: `A write was sent ${ago} ago and its end was not seen. It may still be writing, so nothing was sent again. Run the sheet again in a few minutes.` };
    }
    ctx.say(`  ${who}No trace of the write sent ${ago} ago was found, so it is written again.`);
    return { taken: null };
}
function runStateWord(data) {
    const customer = customerAnswer(data);
    if (customer) {
        if (customer.stage === "failed" || customer.stage === "cancelled")
            return "failed";
        if (customer.stage === "ready")
            return customer.awaitingSignOff ? "waiting" : "done";
        if (customer.stage === "review")
            return customer.awaitingSignOff ? "waiting" : "storyboard";
        return customerStageIsWorking(customer.stage) ? "running" : "waiting";
    }
    const run = asVideoRun(data);
    if (run.status === "failed" || run.status === "cancelled")
        return "failed";
    if (run.isTerminal)
        return "done";
    if (run.status === "awaiting-approval" || run.status === "awaiting-review") {
        const parked = run.nodes.find((node) => node.nodeId === run.pausedNodeId);
        return run.pauseReason === undefined && parked && ["scene-frames", "storyboard"].includes(parked.kind) ? "storyboard" : "waiting";
    }
    return "running";
}
const STATE_SENTENCE = {
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
function runCostOf(data) {
    if (customerAnswer(data) || !isRecord(data) || typeof data.costUsd !== "number")
        return null;
    return { usd: data.costUsd, soFar: data.costScope === "soFar" };
}
async function sheetStatusFlow(sheet, sheetFile, videos, personas, state, opts, deps) {
    const swipes = new Map();
    const swipeOf = async (swipeId) => {
        if (!swipes.has(swipeId)) {
            const res = await deps.get(`${SWIPES_PATH}?id=${encodeURIComponent(swipeId)}`);
            swipes.set(swipeId, res.ok && isRecord(res.data) && isRecord(res.data.swipe) ? res.data.swipe : null);
        }
        return swipes.get(swipeId) ?? null;
    };
    const breakdowns = new Map();
    const breakdownOf = async (breakdownId) => {
        if (!breakdowns.has(breakdownId)) {
            const res = await deps.get(`${SWIPE_BREAKDOWNS_PATH}?id=${encodeURIComponent(breakdownId)}`);
            breakdowns.set(breakdownId, res.ok ? breakdownReadOf(res.data) : null);
        }
        return breakdowns.get(breakdownId) ?? null;
    };
    const rows = [];
    for (const video of videos) {
        const { src, write, run } = peekVideo(state, video);
        let word = "not started";
        let runCost = null;
        let writeCostUsd = null;
        let note = null;
        if (run?.runId) {
            const res = await deps.get(`${RUN_PATH}?runId=${encodeURIComponent(run.runId)}`);
            if (res.ok) {
                word = runStateWord(res.data);
                runCost = runCostOf(res.data);
            }
            else {
                word = "unread";
                note = swipeErrorLine(res);
            }
        }
        else if (write?.swipeId && write.refused !== null) {
            word = "refused";
            note = `The writer refused: ${write.refused}`;
        }
        else if (write?.swipeId) {
            word = "written";
        }
        else if (src?.templateDone) {
            word = "template";
        }
        else if (src?.breakdownId) {
            const read = await breakdownOf(src.breakdownId);
            word = read?.template ? "template" : "breakdown";
            if (read && word === "breakdown")
                note = `Breakdown ${src.breakdownId}: ${STATUS_WORD[read.breakdown.status]}.`;
        }
        if (write?.swipeId)
            writeCostUsd = (await swipeOf(write.swipeId))?.costUsd ?? null;
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
        if (note)
            lines.push(`   ${note}`);
        if (run?.runId)
            lines.push(`   Run ${run.runId}. ${run.watch ? `Watch it: ${run.watch}` : `Check it: exodus video status ${run.runId}`}`);
        else if (write?.swipeId)
            lines.push(`   Swipe ${write.swipeId}.`);
        const costs = [
            ...(writeCostUsd !== null
                ? [`the write ${usd(writeCostUsd)} on the member's key${sheet.characters.length > 1 ? ", shared by this persona's videos of this ad" : ""}`]
                : []),
            ...(run?.runId && word !== "unread"
                ? [runCost ? `the run ${usd(runCost.usd)}${runCost.soFar ? " so far" : ""}` : "the run: not reported"]
                : []),
        ];
        if (costs.length > 0)
            lines.push(`   Cost: ${costs.join("; ")}.`);
        if (lastError && !run?.runId && word !== "refused")
            lines.push(`   Last error: ${lastError}`);
    }
    return { code: 0, lines };
}
export async function swipeSheetFlow(given, opts, deps) {
    const { json } = opts;
    let sheetFile = given;
    try {
        const files = sheetFilesOf(deps);
        const real = files.realPath(given);
        if (real !== path.join(files.realPath(path.dirname(given)), path.basename(given)))
            sheetFile = real;
    }
    catch {
    }
    const read = readSwipeSheet(sheetFile, deps);
    if ("problem" in read)
        return failed(read.problem, json);
    const { sheet } = read;
    const listed = sheetVideos(sheet, opts.persona);
    if ("problem" in listed)
        return failed(listed.problem, json);
    const { videos, personas } = listed;
    if (opts.status || !opts.yes) {
        const stateRead = readSheetState(sheetFile, deps);
        if ("problem" in stateRead)
            return failed(stateRead.problem, json);
        if (opts.status)
            return sheetStatusFlow(sheet, sheetFile, videos, personas, stateRead.state, opts, deps);
        return sheetPaidFlow(sheet, sheetFile, videos, personas, stateRead.state, null, opts, deps);
    }
    const lock = await takeSheetLock(sheetFile, deps);
    if ("problem" in lock)
        return failed(lock.problem, json);
    try {
        const stateRead = readSheetState(sheetFile, deps);
        if ("problem" in stateRead)
            return failed(stateRead.problem, json);
        return await sheetPaidFlow(sheet, sheetFile, videos, personas, stateRead.state, lock.note, opts, deps);
    }
    finally {
        lock.release();
    }
}
const LOOKS_PATH = "/api/v2/video/script-runs";
const WHOAMI_PATH = "/api/v2/whoami";
async function startChecks(sheet, deps) {
    const { style, title } = sheet.start;
    if (style) {
        const res = await deps.get(LOOKS_PATH);
        if (!res.ok)
            return `The looks could not be read to check "style": ${swipeErrorLine(res)} Nothing was sent.`;
        const looks = isRecord(res.data) && Array.isArray(res.data.styles) ? res.data.styles : [];
        const slugs = looks.map((look) => look.slug).filter((slug) => typeof slug === "string");
        if (!slugs.includes(style)) {
            return `In the sheet, "style": "${style}" is not a look a swiped run can start on. The looks: ${slugs.join(", ") || "none listed"}.`;
        }
    }
    if (title) {
        const res = await deps.get(WHOAMI_PATH);
        if (!res.ok)
            return `This key could not be checked for "title": ${swipeErrorLine(res)} Nothing was sent.`;
        const role = isRecord(res.data) ? res.data.userRole : undefined;
        if (role !== "admin")
            return 'In the sheet, "title" names the ad, for admins only, and this key is not an admin\'s. Leave "title" out.';
    }
    return null;
}
const shellWord = (word) => (/^[\w./@%+=:,-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`);
async function sheetPaidFlow(sheet, sheetFile, videos, personas, state, lockNote, opts, deps) {
    const { json } = opts;
    const stateFile = sheetStatePath(sheetFile);
    for (const [index, item] of sheet.sources.entries()) {
        const src = state.sources[item.key];
        if (item.source.kind !== "file" || (src && src.kind === "file" && (src.breakdownId || src.templateDone)))
            continue;
        const checked = await swipeBreakdownFlow(item.source, { json: true, yes: false, wait: false }, deps);
        if (checked.code !== 0)
            return failed(`Source ${index + 1}: ${errorOf(answerOf(checked))}`, json);
    }
    const chosen = await sheetProduct(sheet, deps);
    if ("problem" in chosen)
        return failed(chosen.problem, json);
    const refusedStart = await startChecks(sheet, deps);
    if (refusedStart)
        return failed(refusedStart, json);
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
        const planned = [];
        for (const item of sheet.sources) {
            const own = videos.filter((video) => video.source === item);
            planned.push({ item, steps: await plannedSteps(item, own, state, sheet, product.id, opts.retryRefused, deps) });
        }
        const needsYes = planned.some(({ steps }) => steps.some((step) => step.buy));
        const warning = videos.length > SHEET_VIDEO_WARNING ? [`That is ${videos.length} videos, more than ${SHEET_VIDEO_WARNING}. Check the count with the member before the yes.`] : [];
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
                "",
                ...planned.flatMap(({ item, steps }, i) => [`Ad ${i + 1}: ${item.key}`, ...plannedLines(steps)]),
                "",
                ...(needsYes
                    ? ["The CLI prints no price for these steps.", "Nothing that costs money was sent. On the member's yes, run the same command with --yes."]
                    : ["Every step is done already. Nothing would be bought again."]),
            ],
        };
    }
    const files = sheetFilesOf(deps);
    const writeState = () => files.writeAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    const reason = (err) => (err instanceof Error ? err.message : String(err));
    try {
        writeState();
    }
    catch (err) {
        return failed(`The state file ${stateFile} can't be written (${reason(err)}), so nothing was sent.`, json);
    }
    const save = () => {
        try {
            writeState();
        }
        catch (err) {
            throw new StateNotSaved(reason(err));
        }
    };
    const out = progress(opts);
    if (lockNote)
        out.say(lockNote);
    for (const line of head)
        out.say(line);
    const ctx = { sheet, sheetFile, state, productId: product.id, retryRefused: opts.retryRefused, save, say: out.say, deps };
    const outcomes = [];
    try {
        for (const [index, item] of sheet.sources.entries()) {
            out.say("");
            out.say(`Ad ${index + 1} of ${sheet.sources.length}: ${item.key}`);
            outcomes.push(...(await runSheetSource(item, videos.filter((video) => video.source === item), ctx)));
        }
    }
    catch (err) {
        if (!(err instanceof StateNotSaved))
            throw err;
        const why = `The state file ${stateFile} could not be saved (${err.message}), so the run stopped: a step it can't keep track of could be bought twice. Once the file can be written, run the same command again; it checks every step sent before and buys none of them twice.`;
        return json ? failed(why, json) : { code: 1, lines: [...out.kept, "", why] };
    }
    let waitsOk = true;
    if (opts.wait) {
        for (const outcome of outcomes) {
            if (!outcome.runId)
                continue;
            out.say("");
            out.say(`Waiting for video ${outcome.video.n}, run ${outcome.runId}.`);
            try {
                const waited = await waitFlow(outcome.runId, { json, ...(outcome.watch ? { url: outcome.watch } : {}), ...(json ? {} : { onProgressLine: opts.onProgressLine }) }, deps);
                if (waited.code !== 0)
                    waitsOk = false;
                if (json)
                    outcome.waited = answerOf(waited);
                else
                    for (const line of waited.lines)
                        out.say(line);
            }
            catch (err) {
                waitsOk = false;
                const why = `The wait stopped: ${describeFetchFailure(err)}. The run goes on: exodus video status ${outcome.runId}`;
                if (json)
                    outcome.waited = { ok: false, error: why };
                else
                    out.say(why);
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
    const summary = outcomes.map(({ video, runId, watch, stopped }) => runId
        ? `  ${video.n}. ${videoLabel(video)}: run ${runId}. ${watch ? `Watch it: ${watch}` : `Check it: exodus video status ${runId}`}`
        : `  ${video.n}. ${videoLabel(video)}: stopped at the ${stopped?.step ?? "start"}. ${stopped?.why ?? ""}`.trimEnd());
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
export async function runSwipePlan(plan, deps, onProgressLine) {
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
            return swipeStartFlow(plan.swipeId, plan.ask, opts, deps);
        case "run":
            return swipeSheetFlow(plan.sheetFile, { ...opts, retryRefused: plan.retryRefused, status: plan.status, persona: plan.persona }, deps);
    }
}
