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

/** Resolve --brief / --seeds: returns inline value, file contents, or empty. */
function resolveTextFlag(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const candidate = resolve(process.cwd(), raw);
  if (existsSync(candidate)) {
    return readFileSync(candidate, "utf8").trim();
  }
  return raw.trim();
}

function resolveSeedsFlag(raw: unknown): string[] | undefined {
  const text = resolveTextFlag(raw);
  if (!text) return undefined;
  // Try JSON array first
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.filter((s) => typeof s === "string" && s.trim().length > 0);
      }
    } catch {
      // fall through to line-split
    }
  }
  // Otherwise split on lines (skip blanks + #-prefixed comments)
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

// ── Request shapes ───────────────────────────────────────────────

export interface GenesisOpts {
  awarenessLevel: string;
  seeds?: string[];
  variantCount?: number;
  adAccountId?: string;
  stopAtHooks?: boolean;
}

export interface GenesisBody {
  brief: string;
  awarenessLevel: string;
  inputMethod: "brief" | "paste";
  sourcePayload?: { winningAd?: string };
  seeds?: string[];
  variantCount?: number;
  adAccountId?: string;
  stopAtHooks?: boolean;
}

/** Body for a typed-brief run (inputMethod "brief"). */
export function buildBriefBody(brief: string, opts: GenesisOpts): GenesisBody {
  const body: GenesisBody = {
    brief,
    awarenessLevel: opts.awarenessLevel,
    inputMethod: "brief",
  };
  if (opts.seeds && opts.seeds.length > 0) body.seeds = opts.seeds;
  if (typeof opts.variantCount === "number") body.variantCount = opts.variantCount;
  if (opts.adAccountId) body.adAccountId = opts.adAccountId;
  if (typeof opts.stopAtHooks === "boolean") body.stopAtHooks = opts.stopAtHooks;
  return body;
}

/**
 * Body for a swipe-sourced run (inputMethod "paste"). A swipe is a saved
 * competitor ad — rich text, no reel URL — so it can't use a reel path.
 * Genesis takes the pasted text as a winning ad to model after ("make more
 * like this") and deposits the result into the Genesis idea bank as a full
 * Genesis doc (Mario + Infeed variants). `brief` carries the text so the
 * HTTP route's non-empty-brief check passes; sourcePayload.winningAd is the
 * authoritative source Genesis reads.
 */
export function buildPasteBody(text: string, opts: GenesisOpts): GenesisBody {
  const body: GenesisBody = {
    brief: text,
    awarenessLevel: opts.awarenessLevel,
    inputMethod: "paste",
    sourcePayload: { winningAd: text },
  };
  if (opts.seeds && opts.seeds.length > 0) body.seeds = opts.seeds;
  if (typeof opts.variantCount === "number") body.variantCount = opts.variantCount;
  if (opts.adAccountId) body.adAccountId = opts.adAccountId;
  if (typeof opts.stopAtHooks === "boolean") body.stopAtHooks = opts.stopAtHooks;
  return body;
}

// ── Hook gate (in-Claude-Code review) ───────────────────────────
//
// The pipeline-variant cap. Selecting more than this many hooks would be
// silently truncated by the backend (genesis-pipeline-continue), so the CLI/
// skill warns and confirms instead. Mirror of the cap in the Trigger pipeline.
export const VARIANT_CAP = 10;

/**
 * Parse a user hook selection ("1,3,5" / "1 3 5") into the 1-based numbers the
 * user typed (matching the printed numbered list). Throws on empty input or any
 * non-positive / non-integer token so the caller can show usage. Order is
 * preserved here; dedupe + sort happen in buildContinueBody.
 */
export function parseHookSelection(raw: string): number[] {
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

/**
 * Build the POST /api/v2/genesis/continue request body. The user picks 1-based
 * numbers (as printed); the API expects 0-based indices into the pool. Dedupe +
 * sort ascending so the body is canonical regardless of how the user typed it.
 */
export function buildContinueBody(
  runId: string,
  selection: number[],
): { runId: string; selectedHookIndices: number[] } {
  const indices = Array.from(new Set(selection.map((n) => n - 1))).sort((a, b) => a - b);
  return { runId, selectedHookIndices: indices };
}

/** True when a selection exceeds the pipeline variant cap (warn, don't truncate). */
export function exceedsVariantCap(count: number): boolean {
  return count > VARIANT_CAP;
}

/**
 * Build the POST /api/v2/genesis/regenerate request body. Steering is optional:
 * a bare `regenerate` re-rolls with the brand steering, while `--steering "…"`
 * adds the strategist's re-roll guidance (additive on the backend). The
 * steering field is omitted entirely when empty/whitespace so a bare re-roll
 * sends a clean body.
 */
export function buildRegenerateBody(
  runId: string,
  steering?: string,
): { runId: string; steering?: string } {
  const trimmed = typeof steering === "string" ? steering.trim() : "";
  return trimmed ? { runId, steering: trimmed } : { runId };
}

/**
 * Render the hook pool as a flat, 1-based numbered list — hook text ONLY. No
 * ratings, tags, voice labels, or agent opinion (locked decision, spec §5). The
 * driving skill prints this verbatim and the user picks by number.
 */
export function formatHookPool(hooks: string[]): string {
  return hooks.map((h, i) => `  ${i + 1}. ${h}`).join("\n");
}

/** Fields of a swipeAd the CLI needs to turn a swipe into writable ad text. */
export interface SwipeRow {
  _id?: string;
  brandName?: string;
  format?: string;
  transcript?: string;
  bodyText?: string;
  headline?: string;
  ctaText?: string;
}

/**
 * Resolve the writable text from a saved swipe. Video swipes carry a Gemini
 * transcript (the richest source); otherwise assemble the on-image copy from
 * headline + body + CTA. Returns "" when the swipe has no usable text so the
 * caller can fail with guidance.
 */
export function resolveSwipeText(swipe: SwipeRow): string {
  const transcript = typeof swipe.transcript === "string" ? swipe.transcript.trim() : "";
  if (transcript) return transcript;
  return [swipe.headline, swipe.bodyText, swipe.ctaText]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

export type GenesisAction =
  | { kind: "submit"; body: GenesisBody }
  | { kind: "reel"; urls: string[]; opts: GenesisOpts }
  | { kind: "swipe-url"; urls: string[]; opts: GenesisOpts; steering?: string }
  | { kind: "list-bank"; limit: number }
  | { kind: "from-bank"; ideaId: string; opts: GenesisOpts }
  | { kind: "list-swipes"; limit: number }
  | { kind: "from-swipe"; swipeId: string; opts: GenesisOpts }
  | { kind: "show-swipe"; swipeIds: string[]; json: boolean }
  | { kind: "error"; message: string };

function parseOpts(flags: Record<string, string | boolean>): GenesisOpts {
  const awarenessLevel = (flags["awareness"] as string | undefined) ?? "problem-aware";
  const seeds = resolveSeedsFlag(flags["seeds"]);
  // Variant count resolution. The friendly knob is --passes (writing passes per
  // bot): 1 pass = 1 Mario + 1 Infeed = 2 variants. --variants is an advanced raw
  // total override that wins when both are supplied. parseInt("0") is a valid 0,
  // so guard NaN explicitly (not `|| n`) or `--passes 0`/`--variants 0` would fall
  // through to the default instead of clamping to the minimum.
  let variantCount: number;
  if (typeof flags["variants"] === "string") {
    const n = parseInt(flags["variants"], 10);
    variantCount = Number.isNaN(n) ? 2 : Math.max(1, Math.min(10, n));
  } else {
    let passes = 1;
    if (typeof flags["passes"] === "string") {
      const p = parseInt(flags["passes"], 10);
      passes = Number.isNaN(p) ? 1 : Math.max(1, Math.min(5, p));
    }
    variantCount = passes * 2;
  }
  const adAccountId = typeof flags["ad-account"] === "string" ? (flags["ad-account"] as string) : undefined;
  let stopAtHooks: boolean | undefined;
  if (flags["stop-at-hooks"] === true) stopAtHooks = true;
  else if (flags["auto-hooks"] === true) stopAtHooks = false;
  return { awarenessLevel, seeds, variantCount, adAccountId, stopAtHooks };
}

/**
 * Map CLI flags to a single Genesis action. Pure (no I/O beyond resolving
 * --brief/--seeds files), so the source routing is unit-testable.
 */
export function resolveGenesisAction(flags: Record<string, string | boolean>): GenesisAction {
  const opts = parseOpts(flags);

  const reel =
    typeof flags["reel"] === "string" && flags["reel"].trim() ? (flags["reel"] as string).trim() : undefined;
  // Basic swipe: a pasted Facebook Ad Library URL. --steering carries what the
  // user wants to model from the ad, folded into the brief at dispatch.
  const swipeUrl =
    typeof flags["swipe-url"] === "string" && flags["swipe-url"].trim()
      ? (flags["swipe-url"] as string).trim()
      : undefined;
  const steering =
    typeof flags["steering"] === "string" && flags["steering"].trim()
      ? (flags["steering"] as string).trim()
      : undefined;
  const brief = resolveTextFlag(flags["brief"]);
  const idea =
    typeof flags["idea"] === "string" && flags["idea"].trim() ? (flags["idea"] as string).trim() : undefined;
  const wantsBank = flags["from-bank"] === true || !!idea;
  const swipeId =
    typeof flags["swipe"] === "string" && flags["swipe"].trim() ? (flags["swipe"] as string).trim() : undefined;
  // Bare --swipe (no id) and --list-swipes both browse the library, mirroring
  // how bare --from-bank lists the bank.
  const wantsSwipe = flags["list-swipes"] === true || flags["swipe"] === true || !!swipeId;
  // --show-swipe <id>[,<id>…] reads a saved swipe's words without writing.
  const showSwipeIds =
    typeof flags["show-swipe"] === "string"
      ? (flags["show-swipe"] as string)
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
      message:
        'No source. Use one of: --brief <file|"text">, --reel "<url>", --swipe-url "<fb-url>", --from-bank [--idea <id>], or --swipe <id> / --list-swipes / --show-swipe <id>.',
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

  const limit =
    typeof flags["limit"] === "string" ? Math.max(1, parseInt(flags["limit"], 10) || 20) : 20;

  if (reel) return { kind: "reel", urls: [reel], opts };
  if (swipeUrl) return { kind: "swipe-url", urls: [swipeUrl], opts, steering };
  if (brief) return { kind: "submit", body: buildBriefBody(brief, opts) };
  // Swipe mode (write from <id>, or browse when no id):
  if (swipeId) return { kind: "from-swipe", swipeId, opts };
  if (wantsSwipe) return { kind: "list-swipes", limit };
  // Bank mode (write from <id>, or browse when no id):
  if (idea) return { kind: "from-bank", ideaId: idea, opts };
  return { kind: "list-bank", limit };
}

// ── Runtime ──────────────────────────────────────────────────────

interface BankIdeaRow {
  _id?: string;
  hook?: string;
  sourceUrl?: string;
  sourceUsername?: string;
  relevanceScore?: number;
  status?: string;
  useCount?: number;
}

/** Positional sub-actions (parseArgs drops positionals; mirror swipe.ts). */
function parsePositional(): string[] {
  const args = process.argv.slice(3); // drop node, script, "genesis"
  const out: string[] = [];
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

export async function run(flags: Record<string, string | boolean>): Promise<void> {
  const cc = formatCcCommand(process.argv.slice(2));
  const sub = parsePositional()[0];

  // Mode 3 subcommands (positional, like `exodus swipe run`).
  if (sub === "connect-instagram") return runConnectInstagram(flags, cc);
  if (sub === "scrape") return runScrape(flags, cc);
  if (sub === "hook-pref") return runHookPref();
  if (sub === "continue") return runContinue(flags, cc);
  if (sub === "regenerate") return runRegenerate(flags, cc);
  if (sub === "reject") return runReject(flags, cc);
  if (sub === "hooks") return runHooks(flags);

  // Otherwise (no subcommand, or "run"): the writing modes (1, 2, brief).
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

/**
 * RETIRED: listBank called deleted route (/api/v2/scout/bank).
 * The idea bank now lives in the dashboard. #1904
 */
async function listBank(_limit: number): Promise<void> {
  console.error(`This command has been retired. View the idea bank in the dashboard: ${getDashboardUrl()}/idea-bank`);
  process.exit(1);
}

/**
 * RETIRED: runFromBank called deleted route (/api/v2/scout/bank/ideas).
 * The idea bank now lives in the dashboard. #1904
 */
async function runFromBank(
  _ideaId: string,
  _opts: GenesisOpts,
  _rt: { noWait: boolean; cc: string | undefined },
): Promise<void> {
  console.error(`This command has been retired. Write from banked ideas in the dashboard: ${getDashboardUrl()}/idea-bank`);
  process.exit(1);
}

/**
 * Mode 1 — write ads from a pasted reel. Transcribes the reel into an Idea Bank
 * "organic" idea, then writes it through the standard Genesis writer (brief-mode).
 * A reel is just another Genesis input — it never touches the viral-ads pipeline.
 */
async function runReel(
  urls: string[],
  opts: GenesisOpts,
  rt: { noWait: boolean; cc: string | undefined },
): Promise<void> {
  console.log(
    `Transcribing ${urls.length === 1 ? "the reel" : `${urls.length} reels`} → idea → Genesis…`,
  );
  const result = await captureReelAndWrite(
    urls,
    { awarenessLevel: opts.awarenessLevel, variantCount: opts.variantCount, stopAtHooks: opts.stopAtHooks },
    { cc: rt.cc },
  );
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

  // Wait only for a single foreground run; multi-reel writes are fire-and-forget.
  if (rt.noWait || result.dispatched.length !== 1) {
    console.log("");
    console.log("Track them:  exodus idea list   (status flips to 'written' with a doc link)");
    return;
  }
  console.log("");
  await waitForGenesisRun(result.dispatched[0].runId);
}

/**
 * Basic swipe — scrape a pasted Facebook Ad Library URL into an Idea Bank idea,
 * then write it through the standard Genesis writer (brief-mode), mirroring
 * `--reel`. `steering` (what the user wants to model from the ad) rides along as
 * the idea's notes so it folds into the brief as a Direction block.
 */
async function runSwipeUrl(
  urls: string[],
  opts: GenesisOpts,
  steering: string | undefined,
  rt: { noWait: boolean; cc: string | undefined },
): Promise<void> {
  console.log(
    `Swiping ${urls.length === 1 ? "the ad" : `${urls.length} ads`} → idea → Genesis…`,
  );
  const result = await captureSwipeAndWrite(
    urls,
    { awarenessLevel: opts.awarenessLevel, variantCount: opts.variantCount, steering, stopAtHooks: opts.stopAtHooks },
    { cc: rt.cc },
  );
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

  // Wait only for a single foreground run; multi-ad writes are fire-and-forget.
  if (rt.noWait || result.dispatched.length !== 1) {
    console.log("");
    console.log("Track them:  exodus idea list   (status flips to 'written' with a doc link)");
    return;
  }
  console.log("");
  await waitForGenesisRun(result.dispatched[0].runId);
}

/** A swipe-library row as returned by /api/v2/swipe-library for listing. */
interface SwipeListRow extends SwipeRow {
  imageUrl?: string;
  videoUrl?: string;
}

/** Truncate to a single short preview line. */
function snippet(text: string | undefined, max = 80): string {
  if (typeof text !== "string") return "";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** List saved swipes for the active brand's tracked competitors (browse). */
async function listSwipes(limit: number): Promise<void> {
  const res = await apiGet<{ swipes?: SwipeListRow[]; error?: string }>(
    `/api/v2/swipe-library?limit=${limit}`,
  );
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
    if (preview) console.log(`    ${preview}`);
    console.log(`    id: ${s._id ?? "?"}`);
  }
  console.log("");
  console.log("Read one:        exodus genesis --show-swipe <id>");
  console.log("Write from one:  exodus genesis --swipe <id>");
}

/**
 * Render one saved swipe for reading. The transcript comes first when there is
 * one (video swipes). A video without one yet says so, because mined videos are
 * transcribed about a minute after they land. The on-ad copy (headline, body,
 * CTA) follows whenever the transcript is missing.
 */
export function formatSwipe(swipe: SwipeRow): string {
  const brand = swipe.brandName ?? "(unknown brand)";
  const fmt = swipe.format ? ` [${swipe.format}]` : "";
  const lines = [`## ${brand}${fmt}`, `id: ${swipe._id ?? "?"}`, ""];
  const clean = (s: string | undefined) => (typeof s === "string" ? s.trim() : "");
  const transcript = clean(swipe.transcript);
  if (transcript) {
    lines.push("Transcript:", transcript);
    return lines.join("\n");
  }
  if (swipe.format === "video") {
    lines.push("Transcript: none yet (Exodus transcribes mined videos about a minute after they land)");
  }
  const parts: Array<[string, string]> = [
    ["Headline", clean(swipe.headline)],
    ["Body", clean(swipe.bodyText)],
    ["CTA", clean(swipe.ctaText)],
  ];
  const present = parts.filter(([, v]) => v.length > 0);
  if (present.length === 0) {
    lines.push("No headline, body or CTA text on this ad.");
  }
  for (const [label, value] of present) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(`${label}:`, value);
  }
  return lines.join("\n");
}

/** `exodus genesis --show-swipe <id>[,<id>…]` — print saved swipes by id. Read only. */
async function showSwipes(swipeIds: string[], json: boolean, cc: string | undefined): Promise<void> {
  const res = await apiPost<{ swipes?: SwipeListRow[]; error?: string }>(
    "/api/v2/swipe-library/get",
    { ids: swipeIds },
    { ccCommand: cc },
  );
  if (!res.ok) {
    // --json errors use the sibling commands' shape (swipe.ts, segment.ts).
    console.log(json ? JSON.stringify({ ok: false, status: res.status, data: res.data }) : formatError(res));
    process.exit(1);
  }
  const swipes = Array.isArray(res.data.swipes) ? res.data.swipes : [];
  const found = new Set(swipes.map((s) => s._id));
  const missing = swipeIds.filter((id) => !found.has(id));
  if (json) {
    console.log(JSON.stringify({ swipes, missing }, null, 2));
  } else {
    swipes.forEach((s, i) => {
      if (i > 0) console.log("");
      console.log(formatSwipe(s));
    });
    for (const id of missing) {
      console.error(`No saved swipe found for id "${id}". List them: exodus genesis --list-swipes`);
    }
  }
  // Any id that didn't come back is a failure, so a script never mistakes a
  // partial read for a whole one.
  if (missing.length > 0) process.exit(1);
}

/** Resolve a saved swipe's text, then write it through the Genesis paste path. */
async function runFromSwipe(
  swipeId: string,
  opts: GenesisOpts,
  rt: { noWait: boolean; cc: string | undefined },
): Promise<void> {
  const res = await apiPost<{ swipes?: SwipeListRow[]; error?: string }>(
    "/api/v2/swipe-library/get",
    { ids: [swipeId] },
    { ccCommand: rt.cc },
  );
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

/** POST the run to the dashboard and (by default) stream progress to completion. */
async function submitGenesis(
  body: GenesisBody,
  rt: { noWait: boolean; cc: string | undefined },
): Promise<void> {
  const res = await apiPost<{ runId?: string; error?: string }>("/api/v2/genesis", body, {
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
  if (body.seeds && body.seeds.length > 0) console.log(`Seeds supplied: ${body.seeds.length}`);
  if (typeof body.variantCount === "number") console.log(`Variant count: ${body.variantCount}`);

  if (rt.noWait) {
    console.log(`Run ID: ${runId}`);
    return;
  }
  await waitForGenesisRun(runId);
}

/** Poll a started Genesis run to completion and print the final document. */
async function waitForGenesisRun(runId: string): Promise<void> {
  console.log("Polling for completion (variants run in parallel and finish around the same time; more passes just means more variants)...");
  const result = await pollUntilDone({
    path: `/api/v2/genesis?id=${runId}`,
    // 60 min cap — comfortably above the worst case at the 10-variant ceiling.
    timeoutMs: 60 * 60 * 1000,
    intervalMs: 5_000,
    terminalStatuses: ["awaiting_hook_selection"],
    onProgress: (data) => {
      const status = (data as Record<string, unknown>)["status"];
      const currentStep = (data as Record<string, unknown>)["currentStep"];
      if (status) {
        process.stdout.write(
          `\r  ${tickerRunStatus(status)}${currentStep ? ` — ${currentStep}` : ""}        `,
        );
      }
    },
  });
  console.log();
  if (result.data["status"] === "awaiting_hook_selection") {
    const pool = Array.isArray((result.data as Record<string, unknown>)["hookPool"])
      ? ((result.data as Record<string, unknown>)["hookPool"] as string[])
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
  if (!result.ok) process.exit(1);
}

/** `exodus genesis hook-pref [manual|auto]` — read (no arg) or set the user's
 *  hook selection preference. No arg prints the current value ("manual"/"auto"/
 *  "unset") on the first line so the driving skill can branch on it. */
async function runHookPref(): Promise<void> {
  const positionals = parsePositional();
  const pref = positionals[1] as string | undefined;

  // No arg → READ the saved preference.
  if (pref === undefined) {
    const res = await apiGet<{ preference?: "manual" | "auto" | null; error?: string }>(
      "/api/v2/genesis/hook-pref",
    );
    if (!res.ok) {
      console.log(`Error: ${(res.data as { error?: string }).error ?? "Unknown error"}`);
      process.exit(1);
    }
    const cur = (res.data as { preference?: "manual" | "auto" | null }).preference ?? null;
    if (cur === null) {
      console.log("unset");
      console.log("No saved hook preference. Runs require --stop-at-hooks or --auto-hooks until one is set.");
    } else {
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
  const res = await apiPost<{ ok?: boolean; error?: string }>(
    "/api/v2/genesis/hook-pref",
    { preference: pref },
  );
  if (!res.ok) {
    console.log(`Error: ${(res.data as { error?: string }).error ?? "Unknown error"}`);
    process.exit(1);
  }
  console.log(`Hook preference set to "${pref}".`);
  if (pref === "manual") {
    console.log("Future runs will pause at hook selection for your input.");
  } else {
    console.log("Future runs will select hooks automatically without pausing.");
  }
}

/**
 * `exodus genesis hooks --id <runId>` — re-fetch and print the hook pool for a
 * paused run. The recovery/fresh-session path: re-hydrate the numbered list so
 * the user (or a cold agent) can pick without the original pause output.
 */
async function runHooks(flags: Record<string, string | boolean>): Promise<void> {
  const runId = typeof flags["id"] === "string" ? (flags["id"] as string).trim() : "";
  if (!runId) {
    console.error("Usage: exodus genesis hooks --id <runId>");
    process.exit(1);
  }
  const res = await apiGet<{ status?: string; hookPool?: string[]; error?: string }>(
    `/api/v2/genesis?id=${runId}`,
  );
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  if (res.data.status !== "awaiting_hook_selection") {
    console.log(
      `Run ${runId} is not awaiting hook selection (status: ${displayRunStatus(res.data.status)}).`,
    );
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

/**
 * `exodus genesis continue --id <runId> --hooks 1,3,5` — resume a paused run
 * with the chosen hooks (one ad per hook), then poll to completion. The user
 * picks 1-based numbers from the printed list; the API takes 0-based indices.
 */
async function runContinue(
  flags: Record<string, string | boolean>,
  cc: string | undefined,
): Promise<void> {
  const runId = typeof flags["id"] === "string" ? (flags["id"] as string).trim() : "";
  if (!runId) {
    console.error("Usage: exodus genesis continue --id <runId> --hooks 1,3,5");
    process.exit(1);
  }
  const raw = typeof flags["hooks"] === "string" ? (flags["hooks"] as string) : "";
  let selection: number[];
  try {
    selection = parseHookSelection(raw);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
    return;
  }

  if (exceedsVariantCap(selection.length)) {
    console.error(
      `Warning: you picked ${selection.length} hooks but the pipeline writes at most ${VARIANT_CAP}. ` +
        `The ${VARIANT_CAP} lowest-numbered picks will be written and the rest dropped. ` +
        `Re-run with ${VARIANT_CAP} or fewer to control exactly which.`,
    );
  }

  const body = buildContinueBody(runId, selection);
  const res = await apiPost<{ ok?: boolean; error?: string }>(
    "/api/v2/genesis/continue",
    body,
    { ccCommand: cc },
  );
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  console.log(`Resuming run ${runId} with ${body.selectedHookIndices.length} hook${body.selectedHookIndices.length === 1 ? "" : "s"}…`);
  await waitForGenesisRun(runId);
}

/**
 * `exodus genesis regenerate --id <runId> [--steering "…"]` — re-roll the hook
 * pool of a paused run, optionally with steering ("lead with the cost, not the
 * shame"). The run re-fires Phase 1 and re-pauses; we poll until it lands back
 * at the gate and reprint the fresh numbered pool so the user can pick or
 * re-roll again. Unlimited rounds.
 */
async function runRegenerate(
  flags: Record<string, string | boolean>,
  cc: string | undefined,
): Promise<void> {
  const runId = typeof flags["id"] === "string" ? (flags["id"] as string).trim() : "";
  if (!runId) {
    console.error("Usage: exodus genesis regenerate --id <runId> [--steering \"…\"]");
    process.exit(1);
  }
  const steering = typeof flags["steering"] === "string" ? (flags["steering"] as string) : undefined;
  const body = buildRegenerateBody(runId, steering);
  const res = await apiPost<{ ok?: boolean; error?: string }>(
    "/api/v2/genesis/regenerate",
    body,
    { ccCommand: cc },
  );
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  console.log(
    body.steering
      ? `Regenerating hooks for run ${runId} with steering…`
      : `Regenerating hooks for run ${runId}…`,
  );
  // The run re-pauses at awaiting_hook_selection; waitForGenesisRun treats that
  // as terminal and reprints the fresh pool.
  await waitForGenesisRun(runId);
}

/**
 * `exodus genesis reject --id <runId>` — abandon a paused run outright (#340).
 * For "these all suck and I don't want another roll": the run lands in the
 * terminal "superseded" status (not failed, not awaiting anything) instead of
 * sitting at the hook gate forever. If the user started a replacement run,
 * pass --superseded-by <newRunId> to link the two.
 */
async function runReject(
  flags: Record<string, string | boolean>,
  cc: string | undefined,
): Promise<void> {
  const runId = typeof flags["id"] === "string" ? (flags["id"] as string).trim() : "";
  if (!runId) {
    console.error("Usage: exodus genesis reject --id <runId> [--superseded-by <newRunId>]");
    process.exit(1);
  }
  const supersededBy =
    typeof flags["superseded-by"] === "string" ? (flags["superseded-by"] as string).trim() : "";
  const res = await apiPost<{ ok?: boolean; error?: string }>(
    "/api/v2/genesis/reject",
    supersededBy ? { runId, supersededByRunId: supersededBy } : { runId },
    { ccCommand: cc },
  );
  if (!res.ok) {
    console.log(formatError(res));
    process.exit(1);
  }
  console.log(`Run ${runId} rejected — marked superseded. Nothing further will run.`);
  if (supersededBy) console.log(`Linked replacement run: ${supersededBy}`);
}

/** Resolve the active brand slug (folder > pointer) or exit with guidance. */
function requireActiveBrand(): string {
  const slug = resolveActiveBrand().slug;
  if (!slug) {
    console.error("No active brand. Pick one first:  exodus brand use <slug>");
    process.exit(1);
  }
  return slug;
}

/**
 * RETIRED: connect-instagram called deleted routes (/api/v2/genesis/instagram/connect/*).
 * The Instagram connection flow now lives in the dashboard. #1411
 */
async function runConnectInstagram(
  _flags: Record<string, string | boolean>,
  _cc: string | undefined,
): Promise<void> {
  console.error(`This command has been retired. Connect Instagram accounts in the dashboard: ${getDashboardUrl()}/settings`);
  process.exit(1);
}

/**
 * RETIRED: scrape (and scrape --organic) called deleted routes (/api/v2/scout/*).
 * The idea-bank scraping flow now lives in the dashboard Mining page. #1904
 */
async function runScrape(
  _flags: Record<string, string | boolean>,
  _cc: string | undefined,
): Promise<void> {
  console.error(`This command has been retired. Fill the idea bank from the Mining page in the dashboard: ${getDashboardUrl()}/mining`);
  process.exit(1);
}
