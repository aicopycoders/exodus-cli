import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { apiGet, apiPost, getDashboardUrl } from "../lib/client.js";
import { pollUntilDone } from "../lib/poll.js";
import { displayRunStatus, formatGenesisRun, formatError, tickerRunStatus } from "../lib/format.js";
import { formatCcCommand } from "../lib/cc-command.js";
import { resolveActiveBrand } from "../lib/layout.js";
import { captureReelAndWrite } from "../lib/reel-write.js";
import { captureSwipeAndWrite } from "../lib/ad-library-write.js";
export const helpText = `
exodus genesis — write ads with the Genesis writer (Mario + Infeed, 1 pass each by default)

Genesis is the one writing pipeline (Mario + Infeed voices → body copy → QA →
Google Doc). Write from a typed brief.

Usage:
  exodus genesis run --brief <file|"text">   Write from a typed brief
  exodus genesis hook-pref [manual|auto]     Read (no arg) or save your default
                                             hook-gate choice
  exodus genesis hooks --id <runId>          Show the hook pool of a run paused
                                             at the hook gate
  exodus genesis continue --id <runId> --hooks 1,3,5   Pick hooks and resume
  exodus genesis regenerate --id <runId> [--steering "…"]   Re-roll the hook pool
  exodus genesis --list-swipes [--limit <n>]  List saved swipes with their ids
  exodus genesis --show-swipe <id>[,<id>…] [--json]
                                             Print a saved swipe's words (read only,
                                             writes nothing)
  exodus genesis --swipe <id>                Write from a saved swipe

Every run must know whether you review hooks: pass --stop-at-hooks or
--auto-hooks, or save a default once with hook-pref. A flagless run with no
saved preference is refused.

Options:
  --brief <file|"text">       Typed brief (file path or inline string)
  --stop-at-hooks             Pause at the hook gate to review/pick hooks
  --auto-hooks                Auto-pick hooks and write straight through
  --seeds <file|"text">       Per-run creative seeds. File: one per line OR a
                              JSON array. Inline: a single seed.
  --steering "<text>"         With regenerate: re-roll guidance for the hook pool.
  --awareness <level>         unaware | problem-aware (default) | solution-aware | product-aware | most-aware
  --passes <n>                Writing passes per bot — Mario + Infeed (1-5, default 1 = 2 variants)
  --variants <n>              Advanced: raw total variant count (1-10); overrides --passes
  --ad-account <id>           Meta ad account ID for the top-ads-biased track
  --json                      With --show-swipe: print the raw swipe rows as JSON
  --no-wait                   Return immediately with the run ID
  --wait                      Poll until the run completes (default)

Examples:
  exodus genesis run --brief "joint pain relief in 30 days" --variants 6
  exodus genesis run --brief brief.txt --seeds seeds.txt
  exodus genesis --show-swipe k57abc123
`.trim();
function resolveTextFlag(raw) {
    if (typeof raw !== "string" || raw.trim() === "")
        return undefined;
    const candidate = resolve(process.cwd(), raw);
    if (existsSync(candidate)) {
        return readFileSync(candidate, "utf8").trim();
    }
    return raw.trim();
}
function resolveSeedsFlag(raw) {
    const text = resolveTextFlag(raw);
    if (!text)
        return undefined;
    if (text.startsWith("[")) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                return parsed.filter((s) => typeof s === "string" && s.trim().length > 0);
            }
        }
        catch {
        }
    }
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
}
export function buildBriefBody(brief, opts) {
    const body = {
        brief,
        awarenessLevel: opts.awarenessLevel,
        inputMethod: "brief",
    };
    if (opts.seeds && opts.seeds.length > 0)
        body.seeds = opts.seeds;
    if (typeof opts.variantCount === "number")
        body.variantCount = opts.variantCount;
    if (opts.adAccountId)
        body.adAccountId = opts.adAccountId;
    if (typeof opts.stopAtHooks === "boolean")
        body.stopAtHooks = opts.stopAtHooks;
    return body;
}
export function buildPasteBody(text, opts) {
    const body = {
        brief: text,
        awarenessLevel: opts.awarenessLevel,
        inputMethod: "paste",
        sourcePayload: { winningAd: text },
    };
    if (opts.seeds && opts.seeds.length > 0)
        body.seeds = opts.seeds;
    if (typeof opts.variantCount === "number")
        body.variantCount = opts.variantCount;
    if (opts.adAccountId)
        body.adAccountId = opts.adAccountId;
    if (typeof opts.stopAtHooks === "boolean")
        body.stopAtHooks = opts.stopAtHooks;
    return body;
}
export const VARIANT_CAP = 10;
export function parseHookSelection(raw) {
    const tokens = raw
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
    if (tokens.length === 0) {
        throw new Error("No hooks selected. Give the numbers to write, e.g. --hooks 1,3,5");
    }
    const nums = tokens.map((t) => {
        if (!/^\d+$/.test(t)) {
            throw new Error(`"${t}" is not a hook number. Pick from the printed list, e.g. --hooks 1,3,5`);
        }
        const n = parseInt(t, 10);
        if (n < 1) {
            throw new Error(`Hook numbers start at 1 (got "${t}").`);
        }
        return n;
    });
    return nums;
}
export function buildContinueBody(runId, selection) {
    const indices = Array.from(new Set(selection.map((n) => n - 1))).sort((a, b) => a - b);
    return { runId, selectedHookIndices: indices };
}
export function exceedsVariantCap(count) {
    return count > VARIANT_CAP;
}
export function buildRegenerateBody(runId, steering) {
    const trimmed = typeof steering === "string" ? steering.trim() : "";
    return trimmed ? { runId, steering: trimmed } : { runId };
}
export function formatHookPool(hooks) {
    return hooks.map((h, i) => `  ${i + 1}. ${h}`).join("\n");
}
export function resolveSwipeText(swipe) {
    const transcript = typeof swipe.transcript === "string" ? swipe.transcript.trim() : "";
    if (transcript)
        return transcript;
    return [swipe.headline, swipe.bodyText, swipe.ctaText]
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
        .join("\n\n");
}
function parseOpts(flags) {
    const awarenessLevel = flags["awareness"] ?? "problem-aware";
    const seeds = resolveSeedsFlag(flags["seeds"]);
    let variantCount;
    if (typeof flags["variants"] === "string") {
        const n = parseInt(flags["variants"], 10);
        variantCount = Number.isNaN(n) ? 2 : Math.max(1, Math.min(10, n));
    }
    else {
        let passes = 1;
        if (typeof flags["passes"] === "string") {
            const p = parseInt(flags["passes"], 10);
            passes = Number.isNaN(p) ? 1 : Math.max(1, Math.min(5, p));
        }
        variantCount = passes * 2;
    }
    const adAccountId = typeof flags["ad-account"] === "string" ? flags["ad-account"] : undefined;
    let stopAtHooks;
    if (flags["stop-at-hooks"] === true)
        stopAtHooks = true;
    else if (flags["auto-hooks"] === true)
        stopAtHooks = false;
    return { awarenessLevel, seeds, variantCount, adAccountId, stopAtHooks };
}
export function resolveGenesisAction(flags) {
    const opts = parseOpts(flags);
    const reel = typeof flags["reel"] === "string" && flags["reel"].trim() ? flags["reel"].trim() : undefined;
    const swipeUrl = typeof flags["swipe-url"] === "string" && flags["swipe-url"].trim()
        ? flags["swipe-url"].trim()
        : undefined;
    const steering = typeof flags["steering"] === "string" && flags["steering"].trim()
        ? flags["steering"].trim()
        : undefined;
    const brief = resolveTextFlag(flags["brief"]);
    const idea = typeof flags["idea"] === "string" && flags["idea"].trim() ? flags["idea"].trim() : undefined;
    const wantsBank = flags["from-bank"] === true || !!idea;
    const swipeId = typeof flags["swipe"] === "string" && flags["swipe"].trim() ? flags["swipe"].trim() : undefined;
    const wantsSwipe = flags["list-swipes"] === true || flags["swipe"] === true || !!swipeId;
    const showSwipeIds = typeof flags["show-swipe"] === "string"
        ? flags["show-swipe"]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [];
    const wantsShowSwipe = flags["show-swipe"] !== undefined;
    const sources = [
        reel ? "reel" : null,
        swipeUrl ? "swipe-url" : null,
        brief ? "brief" : null,
        wantsBank ? "bank" : null,
        wantsSwipe ? "swipe" : null,
        wantsShowSwipe ? "show-swipe" : null,
    ].filter(Boolean);
    if (sources.length === 0) {
        return {
            kind: "error",
            message: 'No source. Use one of: --brief <file|"text">, --reel "<url>", --swipe-url "<fb-url>", --from-bank [--idea <id>], or --swipe <id> / --list-swipes / --show-swipe <id>.',
        };
    }
    if (sources.length > 1) {
        return {
            kind: "error",
            message: "Choose one source: --brief, --reel, --swipe-url, --from-bank/--idea, or --swipe/--list-swipes/--show-swipe.",
        };
    }
    if (wantsShowSwipe) {
        if (showSwipeIds.length === 0) {
            return {
                kind: "error",
                message: "--show-swipe needs a swipe id. Find one with: exodus genesis --list-swipes",
            };
        }
        return { kind: "show-swipe", swipeIds: showSwipeIds, json: flags["json"] === true };
    }
    const limit = typeof flags["limit"] === "string" ? Math.max(1, parseInt(flags["limit"], 10) || 20) : 20;
    if (reel)
        return { kind: "reel", urls: [reel], opts };
    if (swipeUrl)
        return { kind: "swipe-url", urls: [swipeUrl], opts, steering };
    if (brief)
        return { kind: "submit", body: buildBriefBody(brief, opts) };
    if (swipeId)
        return { kind: "from-swipe", swipeId, opts };
    if (wantsSwipe)
        return { kind: "list-swipes", limit };
    if (idea)
        return { kind: "from-bank", ideaId: idea, opts };
    return { kind: "list-bank", limit };
}
function parsePositional() {
    const args = process.argv.slice(3);
    const out = [];
    let i = 0;
    while (i < args.length) {
        const a = args[i];
        if (a.startsWith("--")) {
            const next = args[i + 1];
            i += next !== undefined && !next.startsWith("--") ? 2 : 1;
            continue;
        }
        out.push(a);
        i++;
    }
    return out;
}
export async function run(flags) {
    const cc = formatCcCommand(process.argv.slice(2));
    const sub = parsePositional()[0];
    if (sub === "connect-instagram")
        return runConnectInstagram(flags, cc);
    if (sub === "scrape")
        return runScrape(flags, cc);
    if (sub === "hook-pref")
        return runHookPref();
    if (sub === "continue")
        return runContinue(flags, cc);
    if (sub === "regenerate")
        return runRegenerate(flags, cc);
    if (sub === "reject")
        return runReject(flags, cc);
    if (sub === "hooks")
        return runHooks(flags);
    const action = resolveGenesisAction(flags);
    const noWait = flags["wait"] === false || flags["no-wait"] === true;
    switch (action.kind) {
        case "error":
            console.error(`Error: ${action.message}`);
            process.exit(1);
            return;
        case "reel":
            return runReel(action.urls, action.opts, { noWait, cc });
        case "swipe-url":
            return runSwipeUrl(action.urls, action.opts, action.steering, { noWait, cc });
        case "list-bank":
            return listBank(action.limit);
        case "from-bank":
            return runFromBank(action.ideaId, action.opts, { noWait, cc });
        case "list-swipes":
            return listSwipes(action.limit);
        case "from-swipe":
            return runFromSwipe(action.swipeId, action.opts, { noWait, cc });
        case "show-swipe":
            return showSwipes(action.swipeIds, action.json, cc);
        case "submit":
            return submitGenesis(action.body, { noWait, cc });
    }
}
async function listBank(_limit) {
    console.error(`This command has been retired. View the idea bank in the dashboard: ${getDashboardUrl()}/idea-bank`);
    process.exit(1);
}
async function runFromBank(_ideaId, _opts, _rt) {
    console.error(`This command has been retired. Write from banked ideas in the dashboard: ${getDashboardUrl()}/idea-bank`);
    process.exit(1);
}
async function runReel(urls, opts, rt) {
    console.log(`Transcribing ${urls.length === 1 ? "the reel" : `${urls.length} reels`} → idea → Genesis…`);
    const result = await captureReelAndWrite(urls, { awarenessLevel: opts.awarenessLevel, variantCount: opts.variantCount, stopAtHooks: opts.stopAtHooks }, { cc: rt.cc });
    for (const f of result.bankedFailed) {
        console.error(`  ✗ couldn't pull an idea from ${f} (private, region-locked, or no transcript?)`);
    }
    if (result.dispatched.length === 0) {
        console.error("No reel produced a usable idea — nothing to write.");
        process.exit(1);
    }
    for (const d of result.dispatched) {
        console.log(`  ✓ banked ${d.key} from the reel → Genesis run ${d.runId}`);
    }
    if (rt.noWait || result.dispatched.length !== 1) {
        console.log("");
        console.log("Track them:  exodus idea list   (status flips to 'written' with a doc link)");
        return;
    }
    console.log("");
    await waitForGenesisRun(result.dispatched[0].runId);
}
async function runSwipeUrl(urls, opts, steering, rt) {
    console.log(`Swiping ${urls.length === 1 ? "the ad" : `${urls.length} ads`} → idea → Genesis…`);
    const result = await captureSwipeAndWrite(urls, { awarenessLevel: opts.awarenessLevel, variantCount: opts.variantCount, steering, stopAtHooks: opts.stopAtHooks }, { cc: rt.cc });
    for (const f of result.bankedFailed) {
        console.error(`  ✗ couldn't pull an idea from ${f} (inactive, image-only, or not in the Ad Library index?)`);
    }
    if (result.dispatched.length === 0) {
        console.error("No ad produced a usable idea — nothing to write.");
        process.exit(1);
    }
    for (const d of result.dispatched) {
        console.log(`  ✓ swiped ${d.key} from the ad → Genesis run ${d.runId}`);
    }
    if (rt.noWait || result.dispatched.length !== 1) {
        console.log("");
        console.log("Track them:  exodus idea list   (status flips to 'written' with a doc link)");
        return;
    }
    console.log("");
    await waitForGenesisRun(result.dispatched[0].runId);
}
function snippet(text, max = 80) {
    if (typeof text !== "string")
        return "";
    const oneLine = text.replace(/\s+/g, " ").trim();
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
async function listSwipes(limit) {
    const res = await apiGet(`/api/v2/swipe-library?limit=${limit}`);
    if (!res.ok) {
        console.log(formatError(res));
        process.exit(1);
    }
    const swipes = Array.isArray(res.data.swipes) ? res.data.swipes : [];
    if (swipes.length === 0) {
        console.log("No saved swipes for your tracked competitors.");
        console.log("Collect competitor ads first from the swipe library in the dashboard.");
        return;
    }
    console.log(`## Swipe Library (${swipes.length} ad${swipes.length === 1 ? "" : "s"})`);
    console.log("");
    for (const s of swipes) {
        const brand = s.brandName ?? "(unknown brand)";
        const fmt = s.format ? ` [${s.format}]` : "";
        const preview = snippet(resolveSwipeText(s));
        console.log(`  • ${brand}${fmt}`);
        if (preview)
            console.log(`    ${preview}`);
        console.log(`    id: ${s._id ?? "?"}`);
    }
    console.log("");
    console.log("Read one:        exodus genesis --show-swipe <id>");
    console.log("Write from one:  exodus genesis --swipe <id>");
}
export function formatSwipe(swipe) {
    const brand = swipe.brandName ?? "(unknown brand)";
    const fmt = swipe.format ? ` [${swipe.format}]` : "";
    const lines = [`## ${brand}${fmt}`, `id: ${swipe._id ?? "?"}`, ""];
    const clean = (s) => (typeof s === "string" ? s.trim() : "");
    const transcript = clean(swipe.transcript);
    if (transcript) {
        lines.push("Transcript:", transcript);
        return lines.join("\n");
    }
    if (swipe.format === "video") {
        lines.push("Transcript: none yet (Exodus transcribes mined videos about a minute after they land)");
    }
    const parts = [
        ["Headline", clean(swipe.headline)],
        ["Body", clean(swipe.bodyText)],
        ["CTA", clean(swipe.ctaText)],
    ];
    const present = parts.filter(([, v]) => v.length > 0);
    if (present.length === 0) {
        lines.push("No headline, body or CTA text on this ad.");
    }
    for (const [label, value] of present) {
        if (lines[lines.length - 1] !== "")
            lines.push("");
        lines.push(`${label}:`, value);
    }
    return lines.join("\n");
}
async function showSwipes(swipeIds, json, cc) {
    const res = await apiPost("/api/v2/swipe-library/get", { ids: swipeIds }, { ccCommand: cc });
    if (!res.ok) {
        console.log(json ? JSON.stringify({ ok: false, status: res.status, data: res.data }) : formatError(res));
        process.exit(1);
    }
    const swipes = Array.isArray(res.data.swipes) ? res.data.swipes : [];
    const found = new Set(swipes.map((s) => s._id));
    const missing = swipeIds.filter((id) => !found.has(id));
    if (json) {
        console.log(JSON.stringify({ swipes, missing }, null, 2));
    }
    else {
        swipes.forEach((s, i) => {
            if (i > 0)
                console.log("");
            console.log(formatSwipe(s));
        });
        for (const id of missing) {
            console.error(`No saved swipe found for id "${id}". List them: exodus genesis --list-swipes`);
        }
    }
    if (missing.length > 0)
        process.exit(1);
}
async function runFromSwipe(swipeId, opts, rt) {
    const res = await apiPost("/api/v2/swipe-library/get", { ids: [swipeId] }, { ccCommand: rt.cc });
    if (!res.ok) {
        console.log(formatError(res));
        process.exit(1);
    }
    const swipe = (res.data.swipes ?? [])[0];
    if (!swipe) {
        console.error(`No saved swipe found for id "${swipeId}". List them: exodus genesis --list-swipes`);
        process.exit(1);
    }
    const text = resolveSwipeText(swipe);
    if (!text) {
        console.error(`Swipe "${swipeId}" has no usable text (no transcript, headline, or body) to write from.`);
        process.exit(1);
    }
    console.log(`Writing from swipe: ${swipe.brandName ?? "competitor ad"}${swipe.format ? ` [${swipe.format}]` : ""}`);
    return submitGenesis(buildPasteBody(text, opts), rt);
}
async function submitGenesis(body, rt) {
    const res = await apiPost("/api/v2/genesis", body, {
        ccCommand: rt.cc,
    });
    if (!res.ok) {
        console.log(formatError(res));
        process.exit(1);
    }
    const runId = res.data.runId;
    if (!runId) {
        console.error("No runId returned from /api/v2/genesis");
        process.exit(1);
    }
    console.log(`Genesis run started: ${runId}`);
    if (body.seeds && body.seeds.length > 0)
        console.log(`Seeds supplied: ${body.seeds.length}`);
    if (typeof body.variantCount === "number")
        console.log(`Variant count: ${body.variantCount}`);
    if (rt.noWait) {
        console.log(`Run ID: ${runId}`);
        return;
    }
    await waitForGenesisRun(runId);
}
async function waitForGenesisRun(runId) {
    console.log("Polling for completion (variants run in parallel and finish around the same time; more passes just means more variants)...");
    const result = await pollUntilDone({
        path: `/api/v2/genesis?id=${runId}`,
        timeoutMs: 60 * 60 * 1000,
        intervalMs: 5_000,
        terminalStatuses: ["awaiting_hook_selection"],
        onProgress: (data) => {
            const status = data["status"];
            const currentStep = data["currentStep"];
            if (status) {
                process.stdout.write(`\r  ${tickerRunStatus(status)}${currentStep ? ` — ${currentStep}` : ""}        `);
            }
        },
    });
    console.log();
    if (result.data["status"] === "awaiting_hook_selection") {
        const pool = Array.isArray(result.data["hookPool"])
            ? result.data["hookPool"]
            : [];
        const dashboardUrl = getDashboardUrl();
        console.log(`\n⏸  Paused for hook selection (${pool.length} hook${pool.length === 1 ? "" : "s"}).`);
        if (pool.length > 0) {
            console.log("");
            console.log(formatHookPool(pool));
            console.log("");
        }
        console.log(`Write the ones you want:  exodus genesis continue --id ${runId} --hooks 1,3,5`);
        console.log(`(Prefer the dashboard? ${dashboardUrl}/runs/${runId})`);
        return;
    }
    console.log(formatGenesisRun(result.data));
    if (!result.ok)
        process.exit(1);
}
async function runHookPref() {
    const positionals = parsePositional();
    const pref = positionals[1];
    if (pref === undefined) {
        const res = await apiGet("/api/v2/genesis/hook-pref");
        if (!res.ok) {
            console.log(`Error: ${res.data.error ?? "Unknown error"}`);
            process.exit(1);
        }
        const cur = res.data.preference ?? null;
        if (cur === null) {
            console.log("unset");
            console.log("No saved hook preference. Runs require --stop-at-hooks or --auto-hooks until one is set.");
        }
        else {
            console.log(cur);
        }
        return;
    }
    if (pref !== "manual" && pref !== "auto") {
        console.error('Usage: exodus genesis hook-pref [manual|auto]   (no arg prints the current value)');
        console.error('  manual  Pause each run at hook selection so you choose hooks.');
        console.error('  auto    Skip hook selection and let the pipeline pick automatically.');
        process.exit(1);
    }
    const res = await apiPost("/api/v2/genesis/hook-pref", { preference: pref });
    if (!res.ok) {
        console.log(`Error: ${res.data.error ?? "Unknown error"}`);
        process.exit(1);
    }
    console.log(`Hook preference set to "${pref}".`);
    if (pref === "manual") {
        console.log("Future runs will pause at hook selection for your input.");
    }
    else {
        console.log("Future runs will select hooks automatically without pausing.");
    }
}
async function runHooks(flags) {
    const runId = typeof flags["id"] === "string" ? flags["id"].trim() : "";
    if (!runId) {
        console.error("Usage: exodus genesis hooks --id <runId>");
        process.exit(1);
    }
    const res = await apiGet(`/api/v2/genesis?id=${runId}`);
    if (!res.ok) {
        console.log(formatError(res));
        process.exit(1);
    }
    if (res.data.status !== "awaiting_hook_selection") {
        console.log(`Run ${runId} is not awaiting hook selection (status: ${displayRunStatus(res.data.status)}).`);
        return;
    }
    const pool = Array.isArray(res.data.hookPool) ? res.data.hookPool : [];
    if (pool.length === 0) {
        console.log("No hooks available for this run.");
        return;
    }
    console.log(`Hooks for run ${runId} (${pool.length}):`);
    console.log("");
    console.log(formatHookPool(pool));
    console.log("");
    console.log(`Write the ones you want:  exodus genesis continue --id ${runId} --hooks 1,3,5`);
}
async function runContinue(flags, cc) {
    const runId = typeof flags["id"] === "string" ? flags["id"].trim() : "";
    if (!runId) {
        console.error("Usage: exodus genesis continue --id <runId> --hooks 1,3,5");
        process.exit(1);
    }
    const raw = typeof flags["hooks"] === "string" ? flags["hooks"] : "";
    let selection;
    try {
        selection = parseHookSelection(raw);
    }
    catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
        return;
    }
    if (exceedsVariantCap(selection.length)) {
        console.error(`Warning: you picked ${selection.length} hooks but the pipeline writes at most ${VARIANT_CAP}. ` +
            `The ${VARIANT_CAP} lowest-numbered picks will be written and the rest dropped. ` +
            `Re-run with ${VARIANT_CAP} or fewer to control exactly which.`);
    }
    const body = buildContinueBody(runId, selection);
    const res = await apiPost("/api/v2/genesis/continue", body, { ccCommand: cc });
    if (!res.ok) {
        console.log(formatError(res));
        process.exit(1);
    }
    console.log(`Resuming run ${runId} with ${body.selectedHookIndices.length} hook${body.selectedHookIndices.length === 1 ? "" : "s"}…`);
    await waitForGenesisRun(runId);
}
async function runRegenerate(flags, cc) {
    const runId = typeof flags["id"] === "string" ? flags["id"].trim() : "";
    if (!runId) {
        console.error("Usage: exodus genesis regenerate --id <runId> [--steering \"…\"]");
        process.exit(1);
    }
    const steering = typeof flags["steering"] === "string" ? flags["steering"] : undefined;
    const body = buildRegenerateBody(runId, steering);
    const res = await apiPost("/api/v2/genesis/regenerate", body, { ccCommand: cc });
    if (!res.ok) {
        console.log(formatError(res));
        process.exit(1);
    }
    console.log(body.steering
        ? `Regenerating hooks for run ${runId} with steering…`
        : `Regenerating hooks for run ${runId}…`);
    await waitForGenesisRun(runId);
}
async function runReject(flags, cc) {
    const runId = typeof flags["id"] === "string" ? flags["id"].trim() : "";
    if (!runId) {
        console.error("Usage: exodus genesis reject --id <runId> [--superseded-by <newRunId>]");
        process.exit(1);
    }
    const supersededBy = typeof flags["superseded-by"] === "string" ? flags["superseded-by"].trim() : "";
    const res = await apiPost("/api/v2/genesis/reject", supersededBy ? { runId, supersededByRunId: supersededBy } : { runId }, { ccCommand: cc });
    if (!res.ok) {
        console.log(formatError(res));
        process.exit(1);
    }
    console.log(`Run ${runId} rejected — marked superseded. Nothing further will run.`);
    if (supersededBy)
        console.log(`Linked replacement run: ${supersededBy}`);
}
function requireActiveBrand() {
    const slug = resolveActiveBrand().slug;
    if (!slug) {
        console.error("No active brand. Pick one first:  exodus brand use <slug>");
        process.exit(1);
    }
    return slug;
}
async function runConnectInstagram(_flags, _cc) {
    console.error(`This command has been retired. Connect Instagram accounts in the dashboard: ${getDashboardUrl()}/settings`);
    process.exit(1);
}
async function runScrape(_flags, _cc) {
    console.error(`This command has been retired. Fill the idea bank from the Mining page in the dashboard: ${getDashboardUrl()}/mining`);
    process.exit(1);
}
