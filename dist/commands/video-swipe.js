import path from "node:path";
import { formatApiError } from "../lib/format.js";
import { missingRouteLine } from "../lib/route-support.js";
import { customerAnswer } from "./video-customer.js";
import { describeFetchFailure, startedThenWait } from "./video.js";
export const SWIPE_BREAKDOWNS_PATH = "/api/v2/video/breakdowns";
export const SWIPE_UPLOAD_URL_PATH = "/api/v2/video/breakdowns/upload-url";
export const SWIPE_TEMPLATE_PATH = "/api/v2/video/swipe-template";
export const SWIPE_PRODUCTS_PATH = "/api/v2/video/swipe-products";
export const SWIPES_PATH = "/api/v2/video/swipes";
export const SWIPE_RUNS_PATH = "/api/v2/video/swipe-runs";
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
const VERBS = ["status", "template", "products", "write", "show", "list", "start"];
export function parseSwipeMode(value) {
    return SWIPE_MODES.find((m) => m.flag === value.trim().toLowerCase())?.mode ?? null;
}
export function parseCloseness(value) {
    const word = value.trim().toLowerCase();
    return SWIPE_CLOSENESS.find((c) => String(c.step) === word || c.flag === word)?.step ?? null;
}
const OFF_WORDS = new Set(["false", "no", "off", "0"]);
const ON_WORDS = new Set(["true", "yes", "on", "1"]);
const SWITCHES = ["json", "yes", "wait", "full", "music", "one-shot"];
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
        const style = value("style");
        const title = value("title");
        if (style === null)
            return usage("video swipe start --style needs a look's slug.");
        if (title === null)
            return usage('video swipe start --title needs a name: --title "<name>".');
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
    const product = value("product");
    if (!product)
        return usage("video swipe write needs --product <id>. exodus video swipe products lists them.");
    const modeWord = value("mode");
    if (modeWord === null)
        return usage("video swipe write --mode needs whole-ad, hook-only, their-format or new-look.");
    const mode = modeWord === undefined ? "whole" : parseSwipeMode(modeWord);
    if (!mode)
        return usage(`video swipe write --mode must be whole-ad, hook-only, their-format or new-look, not "${modeWord}".`);
    const closenessWord = value("closeness");
    if (closenessWord === null)
        return usage("video swipe write --closeness needs 1 to 5, or mirror, close, same-beats, same-arc or pattern-only.");
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
    if (look !== undefined && mode !== "new-look")
        return usage("video swipe write --look is only for --mode new-look.");
    const script = value("script");
    if (script === null || (script === undefined && mode === "their-format")) {
        return usage("video swipe write --mode their-format needs --script <file>, your own script.");
    }
    if (script !== undefined && mode !== "their-format")
        return usage("video swipe write --script is only for --mode their-format.");
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
    const products = isRecord(res.data) && Array.isArray(res.data.products) ? res.data.products : [];
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
    let memberScript;
    if (ask.scriptFile !== undefined) {
        try {
            memberScript = deps.readFile(ask.scriptFile);
        }
        catch {
            return failed(`Can't read --script ${ask.scriptFile}. Check the path.`, json);
        }
        if (!memberScript.trim())
            return failed(`--script ${ask.scriptFile} is empty.`, json);
    }
    if (!opts.yes)
        return needsYesResult("write", json, choiceLines(ask));
    const res = await deps.post(SWIPES_PATH, { breakdownId, productId: ask.productId, request: requestOf(ask, memberScript) });
    if (!res.ok)
        return swipeError(res, json);
    const job = isRecord(res.data) ? res.data.job : undefined;
    if (typeof job !== "string")
        return failed("The server did not say which write it started.", json);
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
        case "start":
            return swipeStartFlow(plan.swipeId, plan.ask, opts, deps);
    }
}
