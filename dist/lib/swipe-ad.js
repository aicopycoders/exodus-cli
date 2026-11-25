import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { apiGetDashboard, apiPostDashboard, getDashboardUrl } from "./client.js";
import { formatApiError } from "./format.js";
export const TEXT_PATH = "/api/v2/swipe/text";
export const IMAGE_PATH = "/api/v2/swipe/image";
export const ADS_PATH = "/api/v2/swipe/ads";
export const UPLOAD_URL_PATH = "/api/v2/swipe/ads/upload-url";
export const RUNS_PATH = "/api/v2/swipe/runs";
export const LEVELS = ["L1", "L2", "L3", "L4", "L5"];
export const PIECES = ["transcript", "body", "headline", "hook"];
export const AWARENESS = ["unaware", "problem-aware", "solution-aware", "product-aware", "most-aware"];
const ASPECTS = ["1:1", "9:16"];
const TEXT_MAX = 1000;
export function defaultSwipeAdDeps() {
    return {
        post: (p, body) => apiPostDashboard(p, body, { timeoutMs: 90_000 }),
        get: (p) => apiGetDashboard(p, { timeoutMs: 30_000 }),
        upload: async (url, bytes, contentType) => {
            const res = await fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body: new Blob([bytes]) });
            const data = (await res.json().catch(() => ({})));
            if (!res.ok || !data.storageId)
                throw new Error(`the picture upload failed (${res.status})`);
            return data.storageId;
        },
        readText: (file) => fs.readFileSync(file, "utf8"),
        readBytes: (file) => new Uint8Array(fs.readFileSync(file)),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        newId: () => randomUUID(),
        dashboardUrl: getDashboardUrl(),
        say: (line) => process.stderr.write(`${line}\n`),
    };
}
export const VALUE_FLAGS = new Set([
    "levels", "piece", "persona", "mechanism", "awareness", "direction", "image-direction", "aspect", "refs", "model",
    "top-ad", "transcript", "body", "headline", "cta", "link", "brand-name", "image", "timeout",
]);
const usage = (line) => ({ code: 1, lines: [line, "See: exodus swipe --help"], usage: true });
export function parseLevels(raw) {
    const out = [];
    for (const part of raw.split(/[,\s]+/).filter(Boolean)) {
        const m = /^(L[1-5])(?:[=:](\d+))?$/i.exec(part);
        if (!m)
            return `--levels takes levels like "L1=2,L3=1" (got "${part}")`;
        const level = m[1].toUpperCase();
        const count = m[2] === undefined ? 1 : Number(m[2]);
        if (!Number.isInteger(count) || count < 0 || count > 10)
            return `each level's count is 0 to 10 (got "${part}")`;
        if (out.some((l) => l.level === level))
            return `${level} is named twice in --levels`;
        if (count > 0)
            out.push({ level, count });
    }
    if (out.length === 0)
        return "--levels needs at least one level with a count above 0";
    return out;
}
function textOf(value, flag, deps) {
    if (value === undefined)
        return undefined;
    if (typeof value !== "string" || !value.trim())
        return { error: `--${flag} needs text (or @file)` };
    if (!value.startsWith("@"))
        return value;
    try {
        return deps.readText(value.slice(1));
    }
    catch {
        return { error: `--${flag}: can't read ${value.slice(1)}` };
    }
}
const isError = (v) => typeof v === "object" && v !== null && "error" in v;
export function planSource(ids, flags, deps) {
    const paste = {};
    for (const flag of ["transcript", "body", "headline", "cta", "link", "brand-name"]) {
        const value = textOf(flags[flag], flag, deps);
        if (isError(value))
            return value;
        if (value !== undefined)
            paste[flag === "brand-name" ? "brandName" : flag] = value;
    }
    const image = flags["image"];
    if (image !== undefined && (typeof image !== "string" || !image))
        return { error: "--image needs a picture file" };
    const top = flags["top-ad"];
    const pasted = Object.keys(paste).length > 0 || typeof image === "string";
    const given = [ids.length > 0, top !== undefined, pasted].filter(Boolean).length;
    if (given === 0) {
        return { error: "Name the ad: a swipe-library ad id, --top-ad <id or link>, or the ad itself (--transcript/--body/--headline and/or --image)." };
    }
    if (given > 1 || ids.length > 1)
        return { error: "Name one ad: an id, --top-ad, or a pasted ad, not more than one." };
    if (ids.length === 1)
        return { kind: "id", swipeAdId: ids[0] };
    if (top !== undefined) {
        if (typeof top !== "string" || !top.trim())
            return { error: "--top-ad needs a Top ads id or its Meta Ad Library link" };
        return { kind: "top", topAd: top.trim() };
    }
    if (!paste.transcript && !paste.body && !paste.headline && typeof image !== "string") {
        return { error: "A pasted ad needs its words (--transcript, --body or --headline) or its picture (--image)." };
    }
    return { kind: "paste", fields: paste, ...(typeof image === "string" ? { image } : {}) };
}
function planPieces(raw) {
    if (raw === undefined)
        return {};
    if (typeof raw !== "string" || !raw.trim())
        return { error: `--piece takes ${PIECES.join(", ")} or all` };
    const names = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (names.length === 1 && names[0] === "all")
        return { field: "all" };
    for (const name of names) {
        if (!PIECES.includes(name))
            return { error: `--piece takes ${PIECES.join(", ")} or all (got "${name}")` };
    }
    const unique = [...new Set(names)];
    if (unique.length === 1)
        return { field: unique[0] };
    return { field: "all", fields: unique };
}
export function planSwipe(kind, ids, flags, deps) {
    const source = planSource(ids, flags, deps);
    if (isError(source))
        return usage(source.error);
    let levels;
    if (flags["levels"] === undefined) {
        if (kind !== "text")
            return usage(`Say how many at each level, e.g. --levels "L1=1,L3=1" (an image swipe makes a picture for each).`);
        levels = [{ level: "L1", count: 1 }];
    }
    else {
        const parsed = typeof flags["levels"] === "string" ? parseLevels(flags["levels"]) : "--levels needs a value";
        if (typeof parsed === "string")
            return usage(parsed);
        levels = parsed;
    }
    const brandOff = flags["brand-info"] === false ? { includeBrandContext: false } : {};
    const str = (flag) => {
        const v = flags[flag];
        if (v === undefined)
            return undefined;
        return typeof v === "string" && v.trim() ? v.trim() : { error: `--${flag} needs a value` };
    };
    const persona = str("persona");
    if (isError(persona))
        return usage(persona.error);
    let text;
    if (kind !== "image") {
        const pieces = planPieces(flags["piece"]);
        if (isError(pieces))
            return usage(pieces.error);
        const mechanism = textOf(flags["mechanism"], "mechanism", deps);
        if (isError(mechanism))
            return usage(mechanism.error);
        const direction = textOf(flags["direction"], "direction", deps);
        if (isError(direction))
            return usage(direction.error);
        for (const [flag, value] of [["mechanism", mechanism], ["direction", direction]]) {
            if (value && value.trim().length > TEXT_MAX) {
                return usage(`--${flag} is ${value.trim().length} characters; the most the swipe takes is ${TEXT_MAX}, as on the dashboard. Shorten it.`);
            }
        }
        const awareness = str("awareness");
        if (isError(awareness))
            return usage(awareness.error);
        if (awareness && !AWARENESS.includes(awareness)) {
            return usage(`--awareness takes ${AWARENESS.join(", ")} (left out: the same as the source ad)`);
        }
        text = {
            ...pieces,
            ...(persona ? { persona } : {}),
            ...(mechanism?.trim() ? { mechanism: mechanism.trim() } : {}),
            ...(awareness ? { awareness } : {}),
            ...(direction?.trim() ? { direction: direction.trim() } : {}),
            ...brandOff,
        };
    }
    else if (flags["piece"] !== undefined || flags["mechanism"] !== undefined || flags["awareness"] !== undefined) {
        return usage("--piece, --mechanism and --awareness are for the words: exodus swipe text (or whole)");
    }
    let image;
    if (kind !== "text") {
        const direction = textOf(flags[kind === "image" ? "direction" : "image-direction"], kind === "image" ? "direction" : "image-direction", deps);
        if (isError(direction))
            return usage(direction.error);
        const aspect = str("aspect");
        if (isError(aspect))
            return usage(aspect.error);
        if (aspect && !ASPECTS.includes(aspect))
            return usage(`--aspect takes ${ASPECTS.join(" or ")}`);
        const refs = str("refs");
        if (isError(refs))
            return usage(refs.error);
        const model = str("model");
        if (isError(model))
            return usage(model.error);
        image = {
            ...(persona ? { persona } : {}),
            ...(direction?.trim() ? { direction: direction.trim() } : {}),
            ...(aspect ? { aspectRatio: aspect } : {}),
            ...(refs ? { referenceImageIds: refs.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
            ...(model ? { model } : {}),
            ...brandOff,
        };
    }
    else if (flags["aspect"] !== undefined || flags["refs"] !== undefined || flags["image-direction"] !== undefined) {
        return usage("--aspect, --refs and --image-direction are for the picture: exodus swipe image (or whole)");
    }
    let timeoutMs = 20 * 60_000;
    if (flags["timeout"] !== undefined) {
        const minutes = Number(flags["timeout"]);
        if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 120)
            return usage("--timeout is minutes, 1 to 120");
        timeoutMs = minutes * 60_000;
    }
    return { kind, source, levels, ...(text ? { text } : {}), ...(image ? { image } : {}), wait: flags["wait"] !== false, json: !!flags["json"], timeoutMs };
}
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function errorLine(res) {
    if (res.status === 404 && isRecord(res.data) && typeof res.data.httpStatus === "number") {
        return "This dashboard doesn't have the command-line swipe yet (it needs the COP-467 update). Swipe on the dashboard for now.";
    }
    if (res.status === 401)
        return "Your key wasn't accepted. Check it with: exodus doctor";
    return formatApiError(res);
}
const retryable = (res) => !res || res.status >= 500;
const POST_TRIES = 3;
async function postOnce(deps, p, body) {
    let last = null;
    for (let i = 0; i < POST_TRIES; i++) {
        if (i > 0)
            await deps.sleep(2000 * i);
        last = await deps.post(p, body).catch(() => null);
        if (!retryable(last))
            return last;
    }
    return last ?? { ok: false, status: 0, data: { error: "The dashboard didn't answer." } };
}
const PICTURE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const PICTURE_MAX_BYTES = 15 * 1024 * 1024;
export async function resolveAd(source, deps) {
    if (source.kind === "id")
        return { swipeAdId: source.swipeAdId };
    let body;
    if (source.kind === "top") {
        body = { topAd: source.topAd };
    }
    else {
        body = { ...source.fields };
        if (source.image) {
            const type = PICTURE_TYPES[path.extname(source.image).toLowerCase()];
            if (!type)
                return { error: `--image must be a .png, .jpg or .webp picture (got ${source.image})` };
            let bytes;
            try {
                bytes = deps.readBytes(source.image);
            }
            catch {
                return { error: `can't read ${source.image}` };
            }
            if (bytes.byteLength > PICTURE_MAX_BYTES) {
                return { error: `${source.image} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; the most a swipe takes is 15 MB.` };
            }
            const urlRes = await postOnce(deps, UPLOAD_URL_PATH, {});
            if (!urlRes.ok || !isRecord(urlRes.data) || typeof urlRes.data.uploadUrl !== "string" || typeof urlRes.data.receiptId !== "string") {
                return { error: errorLine(urlRes) };
            }
            body.receiptId = urlRes.data.receiptId;
            try {
                body.imageStorageId = await deps.upload(urlRes.data.uploadUrl, bytes, type);
            }
            catch (e) {
                return { error: e instanceof Error ? e.message : String(e) };
            }
        }
    }
    const res = await postOnce(deps, ADS_PATH, body);
    if (!res.ok || !isRecord(res.data) || typeof res.data.swipeAdId !== "string")
        return { error: errorLine(res) };
    return { swipeAdId: res.data.swipeAdId, ...(source.kind === "top" ? { note: "Top ad" } : {}) };
}
const PIECE_LABEL = { transcript: "Spoken script", body: "Body copy", headline: "Headline", hook: "Hook" };
export function printRun(view, dashboardUrl) {
    const head = `${view.kind === "text" ? "Text" : "Image"} swipe ${view.runId}: ${view.status}${view.total !== null ? `, ${view.done} of ${view.total}` : ""}`;
    const lines = [head];
    if (view.error && view.status === "failed")
        lines.push(`Why: ${view.error}`);
    if (view.partial)
        lines.push(`Some didn't come out: ${view.partial}`);
    for (const s of view.swipes) {
        lines.push("", `── ${PIECE_LABEL[s.piece] ?? s.piece} · ${s.level} #${s.n} ──`, s.copy);
    }
    if (view.images.length) {
        lines.push("");
        for (const im of view.images)
            lines.push(`${im.label ? `${im.label}: ` : ""}${im.url}`);
    }
    lines.push("", `On the dashboard: ${dashboardUrl}/creative-suite/runs/${view.runId}`);
    return lines;
}
const POLL_MS = 5000;
async function waitForRun(runId, deps, until) {
    let misses = 0;
    let said = -1;
    for (;;) {
        const res = await deps.get(`${RUNS_PATH}/${encodeURIComponent(runId)}`).catch(() => null);
        if (!res || res.status >= 500 || res.status === 429) {
            if (++misses >= 3)
                return { lost: `The dashboard didn't answer three times in a row. The swipe goes on; read it later with: exodus swipe result ${runId}` };
        }
        else if (!res.ok || !isRecord(res.data)) {
            return { lost: errorLine(res) };
        }
        else {
            misses = 0;
            const view = res.data;
            if (view.isTerminal)
                return view;
            if (view.done !== said) {
                said = view.done;
                deps.say?.(`${runId}: ${view.status}${view.total !== null ? `, ${view.done} of ${view.total} done` : ""}…`);
            }
        }
        if (deps.now() + POLL_MS > until) {
            return { lost: `Still running after the wait. Read it later with: exodus swipe result ${runId}` };
        }
        await deps.sleep(POLL_MS);
    }
}
function textBody(swipeAdId, plan, requestId, wholeAdId) {
    const t = plan.text ?? {};
    return {
        swipeAdId,
        ...(t.field ? { field: t.field } : {}),
        ...(t.fields ? { fields: t.fields } : {}),
        levels: plan.levels,
        ...(t.persona ? { persona: t.persona } : {}),
        ...(t.mechanism ? { mechanism: t.mechanism } : {}),
        ...(t.awareness ? { awareness: t.awareness } : {}),
        ...(t.direction ? { direction: t.direction } : {}),
        ...(t.includeBrandContext === false ? { includeBrandContext: false } : {}),
        idempotencyKey: requestId,
        ...(wholeAdId ? { wholeAdId } : {}),
    };
}
function imageBody(swipeAdId, plan, requestId, wholeAdId) {
    const i = plan.image ?? {};
    return {
        swipeAdId,
        levels: plan.levels,
        ...(i.aspectRatio ? { aspectRatio: i.aspectRatio } : {}),
        ...(i.referenceImageIds?.length ? { referenceImageIds: i.referenceImageIds } : {}),
        ...(i.model ? { model: i.model } : {}),
        ...(i.persona ? { persona: i.persona } : {}),
        ...(i.direction ? { direction: i.direction } : {}),
        ...(i.includeBrandContext === false ? { includeBrandContext: false } : {}),
        idempotencyKey: requestId,
        ...(wholeAdId ? { wholeAdId } : {}),
    };
}
async function start(half, body, deps) {
    const res = await postOnce(deps, half === "text" ? TEXT_PATH : IMAGE_PATH, body);
    if (res.ok && isRecord(res.data) && typeof res.data.runId === "string")
        return { half, runId: res.data.runId };
    return { half, error: errorLine(res) };
}
export async function swipeFlow(plan, deps) {
    const fail = (line, extra = {}) => ({
        code: 1,
        lines: plan.json ? [JSON.stringify({ ok: false, error: line, ...extra })] : [line],
    });
    const ad = await resolveAd(plan.source, deps);
    if (isError(ad))
        return fail(ad.error);
    const wholeAdId = plan.kind === "whole" ? deps.newId() : undefined;
    const halves = plan.kind === "whole" ? ["image", "text"] : [plan.kind];
    const started = await Promise.all(halves.map((half) => start(half, half === "text" ? textBody(ad.swipeAdId, plan, deps.newId(), wholeAdId) : imageBody(ad.swipeAdId, plan, deps.newId(), wholeAdId), deps)));
    const runs = started.filter((s) => "runId" in s);
    const refused = started.filter((s) => "error" in s);
    const made = plan.source.kind === "id" ? {} : { swipeAdId: ad.swipeAdId };
    if (runs.length === 0)
        return fail(refused.map((r) => (halves.length > 1 ? `${r.half}: ${r.error}` : r.error)).join("\n"), made);
    const wholeLink = wholeAdId ? `${deps.dashboardUrl}/creative-suite/runs/whole-ad/${encodeURIComponent(wholeAdId)}` : null;
    if (!plan.wait) {
        const lines = plan.json
            ? [JSON.stringify({ ok: refused.length === 0, swipeAdId: ad.swipeAdId, runs, refused, ...(wholeAdId ? { wholeAdId } : {}) })]
            : [
                ...runs.map((r) => `${r.half === "text" ? "Text" : "Image"} swipe started: ${r.runId}`),
                ...refused.map((r) => `${r.half === "text" ? "Text" : "Image"} swipe refused: ${r.error}`),
                `Read it when it's done: exodus swipe result ${runs[0].runId}`,
                ...(wholeLink ? [`The whole ad on the dashboard: ${wholeLink}`] : []),
            ];
        return { code: refused.length ? 1 : 0, lines };
    }
    for (const r of runs)
        deps.say?.(`${r.half === "text" ? "Text" : "Image"} swipe started: ${r.runId} (on your own keys). Waiting for it…`);
    const until = deps.now() + plan.timeoutMs;
    const views = await Promise.all(runs.map((r) => waitForRun(r.runId, deps, until)));
    const done = views.filter((v) => !("lost" in v));
    const lost = views.flatMap((v) => ("lost" in v ? [v.lost] : []));
    const ok = refused.length === 0 && lost.length === 0 && done.every((v) => v.status !== "failed");
    if (plan.json) {
        return { code: ok ? 0 : 1, lines: [JSON.stringify({ ok, swipeAdId: ad.swipeAdId, ...(wholeAdId ? { wholeAdId } : {}), runs: done, refused, waits: lost })] };
    }
    const lines = [];
    for (const v of done)
        lines.push(...printRun(v, deps.dashboardUrl), "");
    for (const r of refused)
        lines.push(`${r.half === "text" ? "Text" : "Image"} swipe refused: ${r.error}`);
    for (const l of lost)
        lines.push(l);
    if (wholeLink)
        lines.push(`The whole ad on the dashboard: ${wholeLink}`);
    while (lines.length && lines[lines.length - 1] === "")
        lines.pop();
    return { code: ok ? 0 : 1, lines };
}
export async function addFlow(source, json, deps) {
    const ad = await resolveAd(source, deps);
    if (isError(ad))
        return { code: 1, lines: json ? [JSON.stringify({ ok: false, error: ad.error })] : [ad.error] };
    return {
        code: 0,
        lines: json
            ? [JSON.stringify({ ok: true, swipeAdId: ad.swipeAdId })]
            : [`Swipe ad: ${ad.swipeAdId}`, `Swipe it: exodus swipe text ${ad.swipeAdId}  (or image / whole)`],
    };
}
export async function resultFlow(runId, json, deps) {
    const res = await deps.get(`${RUNS_PATH}/${encodeURIComponent(runId)}`).catch(() => null);
    if (!res)
        return { code: 1, lines: ["The dashboard didn't answer. Try again in a moment."] };
    if (!res.ok || !isRecord(res.data)) {
        const line = errorLine(res);
        return { code: 1, lines: json ? [JSON.stringify({ ok: false, status: res.status, error: line })] : [line] };
    }
    const view = res.data;
    if (json)
        return { code: 0, lines: [JSON.stringify(view)] };
    return { code: 0, lines: printRun(view, deps.dashboardUrl) };
}
export const swipeAdHelp = `
Swipe an ad with the dashboard's own swipe (the same as the Swipe pop-up: Text, Image, Whole ad),
on your own keys. Nothing here uses Genesis bots; those have their own commands.

  exodus swipe text  <ad> [--levels "L1=2,L3=1"] [--piece transcript|body|headline|hook|all|a,b]
                          [--persona "<saved persona>"] [--mechanism "<text or @file>"]
                          [--awareness unaware|problem-aware|solution-aware|product-aware|most-aware]
                          [--direction "<text or @file>"] [--no-brand-info]
  exodus swipe image <ad> --levels "L1=1,L3=1" [--persona "<saved persona>"] [--direction "<visual steer>"]
                          [--aspect 1:1|9:16] [--refs <imageId,imageId>] [--model <slug>] [--no-brand-info]
  exodus swipe whole <ad> --levels "L1=1" [the text flags] [--image-direction "<visual steer>"] [--aspect ...]
  exodus swipe add   <ad>                    Make a swipe-library ad and print its id (free)
  exodus swipe result <runId>                Read a swipe run (finished or still going)

<ad> is one of:
  <swipe-ad id>                              An ad in your swipe library (exodus genesis --list-swipes)
  --top-ad <id or Meta Ad Library link>      A Top ads ad (exodus top-ads show <id>)
  --transcript/--body/--headline "<text or @file>" [--cta ..] [--brand-name "<their brand>"] [--image <file>]
                                             (a picture: .png, .jpg or .webp, up to 15 MB)
                                             The ad itself: its words, its picture, or both

Levels: L1 keeps the ad nearly line for line with your brand swapped in; L5 keeps only its idea. Up to 10 a level,
20 a run (all the copy counts each piece). Text starts at L1=1; image and whole need --levels.
Persona, mechanism, awareness and direction are the pop-up's fields; --no-brand-info is its "Use my brand info"
unticked (swap the brand name only). Leave --piece out for the piece the pop-up opens on.

Each run spends on your own keys (text: your OpenRouter + Genesis keys; image: your Kie and OpenRouter keys), as on the
dashboard. The command waits for it (--no-wait to return at once, --timeout <minutes>) and prints the swipes;
--json for the machine-readable answer. A re-sent request never runs twice.
`.trim();
export async function runSwipeAd(sub, ids, flags, _occurrences = [], deps = defaultSwipeAdDeps()) {
    if (sub === "result") {
        if (ids.length !== 1)
            return usage("Usage: exodus swipe result <runId>");
        return resultFlow(ids[0], !!flags["json"], deps);
    }
    if (sub === "add") {
        const source = planSource(ids, flags, deps);
        if (isError(source))
            return usage(source.error);
        return addFlow(source, !!flags["json"], deps);
    }
    const plan = planSwipe(sub, ids, flags, deps);
    if ("code" in plan)
        return plan;
    return swipeFlow(plan, deps);
}
