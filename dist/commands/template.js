import { apiGet, apiPost, apiPostDashboard, getDashboardUrl } from "../lib/client.js";
import { displayRunStatus, formatError } from "../lib/format.js";
import { AD_TYPES, AD_TYPE_NAMES, REPTILE_TRIGGERS, } from "../lib/template-constants.js";
export const helpText = `
exodus template — Fernando's Template pipeline (${AD_TYPES.length} AD_TYPES, resume)

Usage:
  exodus template run --input "<ad brief or numbered ads>" [options]
  exodus template status --id <runId>
  exodus template resume --id <runId>
  exodus template ad-types
  exodus template reptile-triggers

Run options:
  --input "<text>"               Input ads block. One brief, or numbered list
                                  ("1. ad copy ... 2. ad copy ..."). Required.
  --mode auto|manual              Generation mode (default: auto)
  --render-mode images|prompts    Skip render and return prompts only (default: images)
  --aspect 1:1|9:16               Image aspect ratio (default: 1:1)
  --model gpt-image-2.5|gpt-image-2.5-sunburst|gpt-image-2|nano-banana-pro|nano-banana-2-1
                                  Kie.ai model (default: gpt-image-2.5)
  --realism off|realistic         Realism enforcement (default: off)
  --quantities <slug:N,slug:N>    Manual-mode per-type counts (e.g. "testimonial:3,hero:2")
  --requested-count N             Auto-mode total render target (optional)
  --no-wait                       (default — kickoff is fire-and-forget; poll with status)

Status options:
  --id <runId>                    Template run to read back (status + render URLs)

Resume options:
  --id <runId>                    Template run id to resume (#56 orphan finalization)

Status:
  exodus template status --id <runId> prints the run status and the rendered
  image URLs (GET /api/v2/template). Live progress is also on the dashboard URL
  printed at kickoff.

Examples:
  exodus template run --input "silver-threaded grounding sheets for inflammation"
  exodus template run --input "..." --aspect 9:16 --model nano-banana-pro --realism realistic
  exodus template run --input "..." --mode manual --quantities "testimonial:3,hero:2,ugc:4"
  exodus template status --id <runId>
  exodus template resume --id <runId>
  exodus template ad-types
`.trim();
function dashboardUrlForRun(runId) {
    return `${getDashboardUrl()}/creative-suite/template/sessions/${runId}`;
}
function runAdTypes() {
    console.log(`AD_TYPES (${AD_TYPES.length} total):`);
    console.log("");
    for (const slug of AD_TYPES) {
        const name = AD_TYPE_NAMES[slug];
        console.log(`  ${slug.padEnd(28)} ${name}`);
    }
}
function runReptileTriggers() {
    console.log(`REPTILE_TRIGGERS (${REPTILE_TRIGGERS.length} total):`);
    console.log("");
    for (const trigger of REPTILE_TRIGGERS) {
        console.log(`  ${trigger}`);
    }
}
function parseQuantities(raw) {
    const out = {};
    for (const pair of raw.split(",")) {
        const [slug, nRaw] = pair.split(":").map((s) => s.trim());
        if (!slug || !nRaw) {
            throw new Error(`Malformed --quantities entry "${pair}". Use slug:N format.`);
        }
        if (!AD_TYPES.includes(slug)) {
            throw new Error(`Unknown ad type "${slug}" in --quantities. Run \`exodus template ad-types\` for the full list.`);
        }
        const n = parseInt(nRaw, 10);
        if (!Number.isFinite(n) || n <= 0) {
            throw new Error(`--quantities count for "${slug}" must be a positive integer (got "${nRaw}").`);
        }
        out[slug] = n;
    }
    return out;
}
async function runTemplate(flags) {
    const input = typeof flags["input"] === "string" ? flags["input"] : undefined;
    if (!input || input.trim().length < 3) {
        console.error("Error: template run requires --input \"<text>\" (min 3 chars).");
        process.exit(1);
        return;
    }
    const mode = typeof flags["mode"] === "string" ? flags["mode"] : "auto";
    if (mode !== "auto" && mode !== "manual") {
        console.error(`Error: --mode must be auto | manual (got "${mode}").`);
        process.exit(1);
        return;
    }
    const renderMode = typeof flags["render-mode"] === "string" ? flags["render-mode"] : "images";
    if (renderMode !== "images" && renderMode !== "prompts") {
        console.error(`Error: --render-mode must be images | prompts (got "${renderMode}").`);
        process.exit(1);
        return;
    }
    const aspect = typeof flags["aspect"] === "string" ? flags["aspect"] : "1:1";
    if (aspect !== "1:1" && aspect !== "9:16") {
        console.error(`Error: --aspect must be 1:1 | 9:16 (got "${aspect}").`);
        process.exit(1);
        return;
    }
    const TEMPLATE_MODELS = [
        "gpt-image-2.5",
        "gpt-image-2.5-sunburst",
        "gpt-image-2",
        "nano-banana-pro",
        "nano-banana-2-1",
    ];
    const model = typeof flags["model"] === "string" ? flags["model"] : "gpt-image-2.5";
    if (!TEMPLATE_MODELS.includes(model)) {
        console.error(`Error: --model must be one of ${TEMPLATE_MODELS.join(" | ")} (got "${model}").`);
        process.exit(1);
        return;
    }
    const realism = typeof flags["realism"] === "string" ? flags["realism"] : "off";
    if (realism !== "off" && realism !== "realistic") {
        console.error(`Error: --realism must be off | realistic (got "${realism}").`);
        process.exit(1);
        return;
    }
    let manualQuantities;
    if (typeof flags["quantities"] === "string") {
        try {
            manualQuantities = parseQuantities(flags["quantities"]);
        }
        catch (e) {
            console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
            process.exit(1);
            return;
        }
    }
    if (mode === "manual" && !manualQuantities) {
        console.error("Error: --mode manual requires --quantities \"slug:N,slug:N\".");
        process.exit(1);
        return;
    }
    const requestedRaw = flags["requested-count"];
    const requestedImageCount = typeof requestedRaw === "string" ? parseInt(requestedRaw, 10) : undefined;
    if (requestedImageCount !== undefined && (!Number.isFinite(requestedImageCount) || requestedImageCount <= 0)) {
        console.error(`Error: --requested-count must be a positive integer.`);
        process.exit(1);
        return;
    }
    const who = await apiGet("/api/v2/whoami");
    if (!who.ok || !who.data.userId || !who.data.workspaceId) {
        console.error("Error: whoami failed. Check EXODUS_API_KEY and EXODUS_API_URL/CONVEX_SITE_URL.");
        console.error(formatError(who));
        process.exit(1);
        return;
    }
    const body = {
        workspaceId: who.data.workspaceId,
        submittedBy: who.data.userId,
        mode,
        renderMode,
        inputAds: input,
        aspectRatio: aspect,
        model,
        realismMode: realism,
        ...(requestedImageCount !== undefined ? { requestedImageCount } : {}),
        ...(manualQuantities ? { manualQuantities } : {}),
    };
    console.log(`Template run: brand=${who.data.workspaceSlug ?? who.data.workspaceId}, mode=${mode}, ` +
        `aspect=${aspect}, model=${model}, realism=${realism}, render=${renderMode}`);
    const res = await apiPost("/api/creative-suite-template/run", body);
    if (!res.ok) {
        console.error(formatError(res));
        process.exit(1);
        return;
    }
    const { runId, triggerRunId } = res.data;
    console.log("");
    console.log(`✓ Template run started`);
    console.log(`  runId:        ${runId}`);
    if (triggerRunId)
        console.log(`  triggerRunId: ${triggerRunId}`);
    console.log(`  dashboard:    ${dashboardUrlForRun(runId)}`);
    console.log("");
    console.log(`Poll status + pull render URLs:  exodus template status --id ${runId}`);
}
async function runResume(flags) {
    const runId = typeof flags["id"] === "string" ? flags["id"] : undefined;
    if (!runId) {
        console.error("Error: template resume requires --id <runId>.");
        process.exit(1);
        return;
    }
    const res = await apiPostDashboard(`/api/creative-suite-template/runs/${encodeURIComponent(runId)}/resume`, {});
    if (!res.ok) {
        console.error(formatError(res));
        process.exit(1);
        return;
    }
    const { resumeCandidateCount, triggerRunId } = res.data;
    console.log("");
    console.log(`✓ Resume enqueued`);
    console.log(`  runId:                ${runId}`);
    if (resumeCandidateCount !== undefined) {
        console.log(`  resumeCandidateCount: ${resumeCandidateCount}`);
    }
    if (triggerRunId)
        console.log(`  triggerRunId:         ${triggerRunId}`);
    console.log(`  dashboard:            ${dashboardUrlForRun(runId)}`);
}
export function formatRenderLines(renders) {
    if (!renders || renders.length === 0)
        return [];
    const lines = [`renders:      ${renders.length} (URLs below)`];
    renders.forEach((r, i) => {
        lines.push(`  ${String(i + 1).padStart(2)}. ${r.url}${r.adType ? `   (${r.adType})` : ""}`);
    });
    return lines;
}
async function runStatus(flags) {
    const runId = typeof flags["id"] === "string" ? flags["id"] : undefined;
    if (!runId) {
        console.error("Error: template status requires --id <runId>.");
        process.exit(1);
        return;
    }
    const res = await apiGet(`/api/v2/template?runId=${encodeURIComponent(runId)}`);
    if (!res.ok) {
        console.error(formatError(res));
        process.exit(1);
        return;
    }
    const d = res.data;
    console.log(`runId:        ${d._id ?? runId}`);
    if (d.name)
        console.log(`name:         ${d.name}`);
    console.log(`status:       ${displayRunStatus(d.status, "—")}`);
    if (d.completedImageCount !== undefined || d.requestedImageCount !== undefined) {
        console.log(`progress:     ${d.completedImageCount ?? 0} / ${d.requestedImageCount ?? "?"} completed${d.failedImageCount ? `, ${d.failedImageCount} failed` : ""}`);
    }
    if (d.errorMessage)
        console.log(`error:        ${d.errorMessage}`);
    for (const line of formatRenderLines(d.renders))
        console.log(line);
    console.log(`dashboard:    ${dashboardUrlForRun(runId)}`);
}
export async function run(flags) {
    const sub = process.argv[3] ?? "";
    if (sub === "ad-types") {
        runAdTypes();
        return;
    }
    if (sub === "reptile-triggers") {
        runReptileTriggers();
        return;
    }
    if (sub === "resume") {
        await runResume(flags);
        return;
    }
    if (sub === "status") {
        await runStatus(flags);
        return;
    }
    if (sub === "run") {
        await runTemplate(flags);
        return;
    }
    if (!sub || sub.startsWith("--")) {
        console.error("Error: template requires a subcommand (run | resume | status | ad-types | reptile-triggers).");
        console.error("");
        console.error(helpText);
        process.exit(1);
        return;
    }
    console.error(`Error: unknown template subcommand "${sub}".`);
    console.error("");
    console.error(helpText);
    process.exit(1);
}
