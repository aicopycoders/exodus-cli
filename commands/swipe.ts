import fs from "node:fs";
import { apiGet, apiPost } from "../lib/client.js";
import { displayRunStatus, formatError } from "../lib/format.js";

export const helpText = `
exodus swipe — Swipe pipeline lifecycle + competitor watchlist

The Swipe pipeline produces a weekly Google Doc per brand of Mirror-style
creative inspired by your watchlist's top competitor ads.

Usage:
  exodus swipe run                                       Trigger a run for the active brand
  exodus swipe mine [--batch N]                          Mine your brand's competitors on your own Scrape Creators key (default batch=50)
  exodus swipe status <runId>                            Poll a run by id
  exodus swipe latest                                    Show the latest run for the active brand
  exodus swipe history [--limit N]                       Show recent runs (default 20, max 100)

  exodus swipe brands list                               Show the watchlist
  exodus swipe brands add "<Name>" [flags]               Add a competitor
  exodus swipe brands remove <id>                        Remove a competitor (use 'list' to find id)
  exodus swipe brands toggle <id>                        Pause / resume a competitor
  exodus swipe brands bulk-import <csvFile>              Bulk add from CSV

Lifecycle flags:
  --json                                                 Machine-readable JSON output (lifecycle subcommands)
  --batch <n>                                            Watchlist batch size for 'mine' (1-500, default 50)

Brand-add flags:
  --ig <handle>           Instagram handle (@ optional)
  --fb <pageId>           Facebook page ID
  --website <url>         Brand site (optional)
  --cat <category>        Free-form category
  --youtube <handle>      YouTube handle (@ optional)

Notes:
  • All operations scope to your active brand. Check with: exodus brand current
  • 'swipe run' returns the runId immediately; the pipeline runs async.
    Poll with 'swipe status <id>' or call 'swipe latest' once done.
  • Brand watchlist drives selection. Pausing a brand stops new scrapes
    without losing history. Removing deletes the entry — past ads remain.
  • CSV format: name,igHandle,fbPageId,category[,website][,youtubeHandle]

Examples:
  exodus swipe run
  exodus swipe status qn7eccmtrq3cn0khz6wpcaeyf186jn97
  exodus swipe latest --json
  exodus swipe brands list
  exodus swipe brands add "AG1" --ig drinkag1 --fb 123456789 --cat supplements
`.trim();

interface BrandRow {
  id: string;
  name: string;
  igHandle?: string;
  fbPageId?: string;
  website?: string;
  category?: string;
  youtubeHandle?: string;
  lastScrapedAt?: string;
}

interface SwipeRunStatusResponse {
  runId?: string;
  workspaceId?: string;
  targetBrandSlug?: string;
  status?: string;
  triggeredBy?: string;
  adsSelectedCount?: number;
  perAdSummary?: Array<{ adId: string; status: string; error?: string }>;
  docUrl?: string;
  fallbackMarkdown?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  triggerRunId?: string;
}

interface SwipeHistoryRow {
  runId: string;
  status: string;
  triggeredBy: string;
  docUrl?: string;
  adsSelectedCount: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export async function run(
  flags: Record<string, string | boolean>,
): Promise<void> {
  const positional = parsePositional();
  const [sub, ...rest] = positional;

  // Lifecycle subcommands (new)
  if (sub === "run") return runRunPipeline(flags);
  if (sub === "mine") return runMinePipeline(flags);
  if (sub === "status") return runStatus(rest, flags);
  if (sub === "latest") return runLatest(flags);
  if (sub === "history") return runHistory(flags);

  // Brand watchlist subcommands — preserved under `brands` namespace
  if (sub === "brands") {
    const [brandSub, ...brandRest] = rest;
    if (!brandSub || brandSub === "list") return runBrandsList();
    if (brandSub === "add") return runBrandsAdd(brandRest, flags);
    if (brandSub === "remove") return runBrandsRemove(brandRest);
    if (brandSub === "toggle") return runBrandsToggle(brandRest);
    if (brandSub === "bulk-import") return runBrandsBulkImport(brandRest);
    console.error(`Unknown brands subcommand: "${brandSub}"\n`);
    console.log(helpText);
    process.exit(1);
  }

  // No subcommand → default help (avoid silently-listing brands as v1 did,
  // since the namespace now spans both lifecycle and watchlist).
  if (!sub) {
    console.log(helpText);
    return;
  }

  console.error(`Unknown subcommand: "${sub}"\n`);
  console.log(helpText);
  process.exit(1);
}

// Argv parser: pull out positionals after the "swipe" command itself.
function parsePositional(): string[] {
  const args = process.argv.slice(3); // drop node, script, "swipe"
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith("--")) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    out.push(a);
    i++;
  }
  return out;
}

// ── Lifecycle ────────────────────────────────────────────────────────

async function runRunPipeline(flags: Record<string, string | boolean>): Promise<void> {
  const json = !!flags["json"];
  const res = await apiPost<{ runId?: string; triggerRunId?: string; status?: string; error?: { message?: string } }>(
    "/api/v2/swipe/run",
    {},
  );
  if (!res.ok || !res.data.runId) {
    if (json) {
      console.log(JSON.stringify({ ok: false, status: res.status, data: res.data }));
    } else {
      console.log(formatError(res));
    }
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify({ ok: true, runId: res.data.runId, triggerRunId: res.data.triggerRunId, status: res.data.status }));
    return;
  }
  console.log(`Run started: ${res.data.runId}`);
  console.log(`  status:        ${displayRunStatus(res.data.status, "Running")}`);
  if (res.data.triggerRunId) console.log(`  triggerRunId:  ${res.data.triggerRunId}`);
  console.log(`\nPoll:    exodus swipe status ${res.data.runId}`);
  console.log(`Latest:  exodus swipe latest`);
}

async function runMinePipeline(flags: Record<string, string | boolean>): Promise<void> {
  const json = !!flags["json"];
  const batchRaw = flags["batch"];
  const batchSize =
    typeof batchRaw === "string"
      ? Math.max(1, Math.min(500, parseInt(batchRaw, 10) || 50))
      : 50;
  const res = await apiPost<{ triggerRunId?: string; batchSize?: number; error?: { message?: string } }>(
    "/api/v2/swipe/mine",
    { batchSize },
  );
  if (!res.ok || !res.data.triggerRunId) {
    if (json) console.log(JSON.stringify({ ok: false, status: res.status, data: res.data }));
    else console.log(formatError(res));
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify({ ok: true, triggerRunId: res.data.triggerRunId, batchSize: res.data.batchSize }));
    return;
  }
  console.log(`Mine started: triggerRunId=${res.data.triggerRunId}`);
  console.log(`  batchSize:  ${res.data.batchSize ?? batchSize}`);
  console.log(`\nMines your brand's active competitors, one at a time, on your own Scrape Creators key.`);
  console.log(`Check progress:  exodus swipe brands list`);
}

async function runStatus(positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  const runId = positional[0];
  if (!runId) {
    console.error("Error: runId is required");
    console.log("Usage: exodus swipe status <runId>");
    process.exit(1);
  }
  const json = !!flags["json"];
  const res = await apiGet<SwipeRunStatusResponse>(`/api/v2/swipe/status/${encodeURIComponent(runId)}`);
  if (!res.ok) {
    if (json) console.log(JSON.stringify({ ok: false, status: res.status, data: res.data }));
    else console.log(formatError(res));
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify({ ok: true, ...res.data }));
    return;
  }
  printRunStatus(res.data);
}

async function runLatest(flags: Record<string, string | boolean>): Promise<void> {
  const json = !!flags["json"];
  const res = await apiGet<SwipeRunStatusResponse>("/api/v2/swipe/latest");
  if (!res.ok) {
    if (res.status === 404) {
      if (json) console.log(JSON.stringify({ ok: false, status: 404, error: "no runs yet" }));
      else console.log("No swipe runs yet for the active brand. Trigger one: exodus swipe run");
      process.exit(1);
    }
    if (json) console.log(JSON.stringify({ ok: false, status: res.status, data: res.data }));
    else console.log(formatError(res));
    process.exit(1);
  }
  if (json) {
    console.log(JSON.stringify({ ok: true, ...res.data }));
    return;
  }
  printRunStatus(res.data);
  // Spec: latest must ALWAYS return something. Show fallback markdown header
  // if the Doc creation failed but writers succeeded.
  if (!res.data.docUrl && res.data.fallbackMarkdown) {
    console.log("\nDoc creation failed; fallback markdown follows (first 500 chars):");
    console.log(res.data.fallbackMarkdown.slice(0, 500));
  }
}

async function runHistory(flags: Record<string, string | boolean>): Promise<void> {
  const json = !!flags["json"];
  const limitRaw = flags["limit"];
  const limit = typeof limitRaw === "string" ? Math.max(1, Math.min(100, parseInt(limitRaw, 10) || 20)) : 20;
  const res = await apiGet<{ runs?: SwipeHistoryRow[]; error?: { message?: string } }>(
    `/api/v2/swipe/history?limit=${limit}`,
  );
  if (!res.ok) {
    if (json) console.log(JSON.stringify({ ok: false, status: res.status, data: res.data }));
    else console.log(formatError(res));
    process.exit(1);
  }
  const runs = res.data.runs ?? [];
  if (json) {
    console.log(JSON.stringify({ ok: true, runs }));
    return;
  }
  if (runs.length === 0) {
    console.log("No swipe runs yet. Trigger one: exodus swipe run");
    return;
  }
  console.log(`Recent runs (${runs.length}):`);
  for (const r of runs) {
    const when = r.startedAt ? new Date(r.startedAt).toLocaleString() : "?";
    const doc = r.docUrl ? `  doc=${r.docUrl}` : r.error ? `  error=${r.error}` : "";
    console.log(
      `  ${r.runId}  ${displayRunStatus(r.status, "—")}  ads=${r.adsSelectedCount}  by=${r.triggeredBy}  ${when}${doc}`,
    );
  }
}

function printRunStatus(r: SwipeRunStatusResponse): void {
  console.log(`Run ${r.runId ?? "?"}`);
  console.log(`  brand:    ${r.targetBrandSlug ?? "?"}`);
  console.log(`  status:   ${displayRunStatus(r.status, "?")}`);
  console.log(`  by:       ${r.triggeredBy ?? "?"}`);
  console.log(`  ads:      ${r.adsSelectedCount ?? 0}`);
  if (r.startedAt) console.log(`  started:  ${new Date(r.startedAt).toLocaleString()}`);
  if (r.completedAt) console.log(`  finished: ${new Date(r.completedAt).toLocaleString()}`);
  if (r.docUrl) console.log(`  doc:      ${r.docUrl}`);
  if (r.error) console.log(`  error:    ${r.error}`);
  if (r.perAdSummary && r.perAdSummary.length > 0) {
    const done = r.perAdSummary.filter((s) => s.status === "done").length;
    const failed = r.perAdSummary.filter((s) => s.status === "failed").length;
    console.log(`  perAd:    ${done} done, ${failed} failed, ${r.perAdSummary.length - done - failed} pending`);
  }
}

// ── Brand watchlist (preserved behavior, renamespaced under 'brands') ─

async function runBrandsList(): Promise<void> {
  const res = await apiGet<{ brands?: BrandRow[]; count?: number; error?: string }>(
    "/api/v2/brands",
  );
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  const brands = res.data.brands ?? [];
  if (brands.length === 0) {
    console.log("No brands on your watchlist yet.");
    console.log("Add one:  exodus swipe brands add \"<Brand Name>\" --fb <pageId>");
    return;
  }

  console.log(`Watchlist (${brands.length}):`);
  for (const b of brands) {
    const sources = [
      b.igHandle ? `ig=@${b.igHandle}` : null,
      b.fbPageId ? `fb=${b.fbPageId}` : null,
      b.youtubeHandle ? `yt=${b.youtubeHandle}` : null,
      b.website ? `web=${b.website.replace(/^https?:\/\//, "")}` : null,
    ]
      .filter(Boolean)
      .join("  ");
    const cat = b.category ? `[${b.category}]` : "";
    const last = b.lastScrapedAt
      ? `last=${new Date(b.lastScrapedAt).toLocaleDateString()}`
      : "never-scraped";
    console.log(`  ${b.id}  ${b.name} ${cat}`);
    if (sources) console.log(`    ${sources}`);
    console.log(`    ${last}`);
  }
}

async function runBrandsAdd(
  positional: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const name = positional[0];
  if (!name) {
    console.error("Error: brand name is required");
    console.log("Usage: exodus swipe brands add \"<Brand Name>\" [--ig handle] [--fb pageId]");
    process.exit(1);
  }

  const body: Record<string, unknown> = { name };
  const ig = strFlag(flags, "ig");
  const fb = strFlag(flags, "fb");
  const website = strFlag(flags, "website");
  const cat = strFlag(flags, "cat") ?? strFlag(flags, "category");
  const yt = strFlag(flags, "youtube") ?? strFlag(flags, "yt");
  if (ig) body.igHandle = ig.replace(/^@/, "");
  if (fb) body.fbPageId = fb;
  if (website) body.website = website;
  if (cat) body.category = cat;
  if (yt) body.youtubeHandle = yt.replace(/^@/, "");

  const res = await apiPost<{
    ok?: boolean;
    added?: number;
    // #1366 — whether the server started looking the brand up (BYOK research
    // on the caller's own Scrape Creators key) and, when it didn't, why.
    researching?: boolean;
    warning?: string;
    error?: string;
  }>("/api/v2/brands", body);
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  if (res.data.researching) {
    console.log(`Added "${name}". Finding its Ad Library page and mining its ads now.`);
  } else {
    console.log(`Added "${name}".`);
    if (res.data.warning) console.log(`  ${res.data.warning}`);
  }
}

async function runBrandsRemove(positional: string[]): Promise<void> {
  const id = positional[0];
  if (!id) {
    console.error("Error: brand id is required (run 'exodus swipe brands list' to find it)");
    process.exit(1);
  }
  const res = await apiPost<{ ok?: boolean; error?: string }>(
    "/api/v2/brands/remove",
    { id },
  );
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  console.log(`Removed brand ${id}.`);
}

async function runBrandsToggle(positional: string[]): Promise<void> {
  const id = positional[0];
  if (!id) {
    console.error("Error: brand id is required (run 'exodus swipe brands list' to find it)");
    process.exit(1);
  }
  const res = await apiPost<{ ok?: boolean; isActive?: boolean; error?: string }>(
    "/api/v2/brands/toggle",
    { id },
  );
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  const status = res.data.isActive ? "active" : "paused";
  console.log(`Brand ${id} now ${status}.`);
}

async function runBrandsBulkImport(positional: string[]): Promise<void> {
  const csvPath = positional[0];
  if (!csvPath) {
    console.error("Error: csv file path is required");
    console.log("Usage: exodus swipe brands bulk-import <path-to-csv>");
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`Error: file not found: ${csvPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, "utf-8");
  const brands = parseCsv(text);
  if (brands.length === 0) {
    console.error("Error: no rows parsed. CSV must have at least one row with a 'name' column.");
    process.exit(1);
  }

  const res = await apiPost<{
    ok?: boolean;
    added?: number;
    skipped?: number;
    total?: number;
    error?: string;
  }>("/api/v2/brands/bulk", { brands });
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  console.log(
    `Imported ${res.data.added ?? 0} new brand(s). Skipped ${res.data.skipped ?? 0} duplicate(s).`,
  );
}

// Tiny CSV parser. First non-empty line is the header. Recognized columns:
// name (required), igHandle, fbPageId, website, category, youtubeHandle.
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];

  const headerLine = lines[0];
  const headers = headerLine.split(",").map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    if (cells.length === 0 || !cells[0]) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      const v = cells[j] ?? "";
      if (!h || !v) continue;
      if (h === "igHandle" || h === "youtubeHandle") {
        row[h] = v.replace(/^@/, "");
      } else {
        row[h] = v;
      }
    }
    if (row.name) rows.push(row);
  }
  return rows;
}

function strFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}
