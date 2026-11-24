import type { FlagOccurrence } from "../lib/args.js";
import {
  clock,
  defaultTopLibraryDeps,
  failureOf,
  parseChoice,
  parseLimit,
  plural,
  positionals,
  printResult,
  safeText,
  safeTextOr,
  table,
  truncate,
  usageError,
  type FlowResult,
  type TopLibraryDeps,
} from "../lib/top-library.js";

export const helpText = `
exodus top-ads — read Top ads: this week's chart of top ads from top brands (read-only)

The same chart, filters and search as the Top ads page on the dashboard
(Sources → Mining → Top ads). Nothing here changes anything or spends money.

Usage:
  exodus top-ads list [--list x] [--sort x] [--brand "<name>"] [--filter "<value>"]... [--limit n] [--json]
  exodus top-ads search "<words>" [--list x] [--limit n] [--json]
  exodus top-ads show <id> [--json]
  exodus top-ads filters [--json]

List flags:
  --list <x>       top500 (the default), new (new this week) or trending
  --sort <x>       top (the list's own order, the default), newest or longest
                   (longest running)
  --brand <name>   Only this brand's ads
  --filter <value> Only ads with this value from the page's Sort & filter, e.g.
                   --filter "Pixar". Repeat it to add more: values in the same
                   row match either one, values in different rows must all
                   match. If two rows have a value with the same name, say which
                   row: --filter "Style: UGC". See every value with
                   exodus top-ads filters
  --limit <n>      How many ads to show, 1–500 (default 40)
  --json           Machine-readable JSON instead of the table

Search:
  Finds ads by what they mean as well as the words in them, the same way the
  search box on the page does, and shows the closest matches first. It searches
  the list you pick (Top 500 unless you say --list). It takes --list and
  --limit only; to narrow by brand, sort or filter, use list.

Show:
  Prints one ad: its words, its transcript, its tags and its Meta Ad Library
  link. The id is the one in the list's "id" column.

To make a video from a Top ad:
  exodus top-ads show <id>
  exodus video swipe --url "<its Meta Ad Library link>"

Notes:
  • Top ads is one chart for every member; it is updated once a week.
  • If Top ads isn't turned on for your account, every command here says so.
  • Brands you follow or hide on the page aren't read here.

Examples:
  exodus top-ads list
  exodus top-ads list --list new --sort newest
  exodus top-ads list --brand "Barkly" --filter "Pixar"
  exodus top-ads search "dog owners tired of vet bills"
  exodus top-ads show 120210000000000
`.trim();

export const LISTS = ["top500", "new", "trending"] as const;
export const SORTS = ["top", "newest", "longest"] as const;
export const MAX_LIMIT = 500;
export const VALUE_FLAGS = new Set(["list", "sort", "brand", "filter", "limit"]);

export interface TopAdsListOptions {
  list?: (typeof LISTS)[number];
  sort?: (typeof SORTS)[number];
  brand?: string;
  filters: string[];
  limit?: number;
}

/** The ad as the server sends it (convex/lib/topLibrary/cliView.ts CliTopAd). */
export interface TopAd {
  id?: string;
  metaAdId?: string | null;
  adLibraryUrl?: string | null;
  rank?: number | null;
  isNew?: boolean;
  brand?: string;
  page?: string;
  format?: string | null;
  oneLine?: string;
  why?: string | null;
  daysRunning?: number | null;
  startDate?: string | null;
  lengthSec?: number | null;
  videoUrl?: string | null;
  tags?: { field?: string; value?: string }[];
  match?: "close" | "less" | null;
}

export interface TopAdDetail extends TopAd {
  title?: string | null;
  body?: string | null;
  cta?: string | null;
  landingPage?: string | null;
  caption?: string | null;
  description?: string | null;
  concept?: string | null;
  angle?: string | null;
  hook?: string | null;
  beats?: string | null;
  transcript?: string | null;
}

/** Search takes the list and the limit only: the page's search runs over the list on screen, and the CLI's search leaves
 *  the brand, the sort and the filters to `list`. Each one given is refused, never dropped without a word. */
export const NOT_ON_SEARCH = ["brand", "sort", "filter"] as const;

export function parseSearchFlags(flags: Record<string, string | boolean>, occurrences: readonly FlagOccurrence[]): { ok: true; options: Pick<TopAdsListOptions, "list" | "limit"> } | { ok: false; message: string } {
  const given = NOT_ON_SEARCH.filter((flag) => flags[flag] !== undefined || occurrences.some((o) => o.flag === flag));
  if (given.length > 0) {
    return {
      ok: false,
      message: `search doesn't take ${given.map((flag) => `--${flag}`).join(", ")}. It searches a whole list (--list) and shows the closest first. To narrow by brand, sort or filter, use exodus top-ads list.`,
    };
  }
  const list = parseChoice("list", flags["list"], LISTS);
  if (!list.ok) return list;
  const limit = parseLimit(flags["limit"], MAX_LIMIT);
  if (!limit.ok) return limit;
  return { ok: true, options: { list: list.value, limit: limit.limit } };
}

export function parseListFlags(flags: Record<string, string | boolean>, occurrences: readonly FlagOccurrence[]): { ok: true; options: TopAdsListOptions } | { ok: false; message: string } {
  const list = parseChoice("list", flags["list"], LISTS);
  if (!list.ok) return list;
  const sort = parseChoice("sort", flags["sort"], SORTS);
  if (!sort.ok) return sort;
  const limit = parseLimit(flags["limit"], MAX_LIMIT);
  if (!limit.ok) return limit;
  const brandRaw = flags["brand"];
  if (brandRaw !== undefined && (typeof brandRaw !== "string" || !brandRaw.trim())) return { ok: false, message: "--brand needs a brand's name" };
  const filters: string[] = [];
  for (const occurrence of occurrences) {
    if (occurrence.flag !== "filter") continue;
    const value = occurrence.value?.trim();
    if (!value || value.startsWith("--")) return { ok: false, message: '--filter needs a value from the page\'s Sort & filter, e.g. --filter "Pixar"' };
    filters.push(value);
  }
  return {
    ok: true,
    options: { list: list.value, sort: sort.value, brand: typeof brandRaw === "string" ? brandRaw.trim() : undefined, filters, limit: limit.limit },
  };
}

/** Only what was asked for; the server's defaults own the rest. */
export function listQuery(options: TopAdsListOptions): string {
  const params = new URLSearchParams();
  if (options.list) params.set("list", options.list);
  if (options.sort) params.set("sort", options.sort);
  if (options.brand) params.set("brand", options.brand);
  for (const filter of options.filters) params.append("filter", filter);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const MATCH_WORDS = { close: "close", less: "less close" } as const;

/** The id a member types back: the Meta ad id when it has one (shorter, and what Meta shows), else ours. */
const idOf = (ad: TopAd): string => safeText(ad.metaAdId) || safeTextOr(ad.id, "—");

function days(ad: TopAd): string {
  return typeof ad.daysRunning === "number" ? `${ad.daysRunning}d` : "—";
}

export function adsTable(ads: readonly TopAd[], withMatch = false): string {
  const headers = ["#", ...(withMatch ? ["match"] : []), "brand", "format", "running", "ad", "id"];
  return table(
    headers,
    ads.map((ad) => [
      typeof ad.rank === "number" ? String(ad.rank) : ad.isNew ? "new" : "—",
      ...(withMatch ? [ad.match ? MATCH_WORDS[ad.match] : "—"] : []),
      truncate(ad.brand, 22) || "—",
      truncate(ad.format, 18) || "—",
      days(ad),
      truncate(ad.oneLine, 50) || "—",
      idOf(ad),
    ]),
  );
}

type ListAnswer = { state?: string; message?: string; weekLabel?: string; list?: string; sort?: string; brand?: string; total?: number; ads?: TopAd[] };

export function formatList(data: ListAnswer): string[] {
  if (data.state === "empty") return [safeTextOr(data.message, "There is no Top ads chart yet.")];
  const ads = Array.isArray(data.ads) ? data.ads : [];
  const scope = [safeText(data.list), safeText(data.brand), safeText(data.weekLabel)].filter(Boolean).join(" — ");
  if (ads.length === 0) return [`No ads match on ${scope || "this list"}.`];
  const total = typeof data.total === "number" ? data.total : ads.length;
  const lines = [`Top ads: ${scope} · ${safeText(data.sort) || "Top today"} · showing ${ads.length} of ${total}`, "", adsTable(ads)];
  if (total > ads.length) lines.push("", `More with --limit (up to ${MAX_LIMIT}).`);
  lines.push("", "One ad in full, with its Meta Ad Library link:  exodus top-ads show <id>");
  return lines;
}

type SearchAnswer = { state?: string; message?: string; weekLabel?: string; kind?: string; query?: string; list?: string; total?: number; ads?: TopAd[] };

export function formatSearch(data: SearchAnswer): string[] {
  if (data.state === "empty") return [safeTextOr(data.message, "There is no Top ads chart yet.")];
  const ads = Array.isArray(data.ads) ? data.ads : [];
  const week = safeText(data.weekLabel);
  const where = `${safeText(data.list) || "Top 500"}${week ? ` (${week})` : ""}`;
  if (ads.length === 0) return [`Nothing on ${where} matches "${safeText(data.query)}".`];
  const total = typeof data.total === "number" ? data.total : ads.length;
  const lines = [`Search "${safeText(data.query)}" on ${where}: ${plural(total, "match", "matches")}${total > ads.length ? `, showing ${ads.length}` : ""}`];
  if (data.kind === "keyword") lines.push("Search by meaning didn't answer just now, so these are the ads with your words in them.");
  if (data.kind === "sections") lines.push('The "match" column says how close each ad is to what you searched for: close, or less close.');
  lines.push("", adsTable(ads, data.kind === "sections"), "", "One ad in full:  exodus top-ads show <id>");
  return lines;
}

function section(lines: string[], label: string, text: unknown): void {
  const clean = safeText(text);
  if (!clean) return;
  lines.push("", `${label}:`, ...clean.split("\n").map((line) => `  ${line}`));
}

export function formatShow(data: { weekLabel?: string; ad?: TopAdDetail }): string[] {
  const ad = data.ad ?? {};
  const brand = safeTextOr(ad.brand, "—");
  const page = safeText(ad.page);
  const lines = [page && page.toLowerCase() !== brand.toLowerCase() ? `${brand} — ${page}` : brand, safeText(ad.oneLine)];
  const facts = [
    typeof ad.rank === "number" ? `#${ad.rank} on Top ads` : null,
    ad.isNew ? "New" : null,
    safeText(ad.why) || null,
    typeof ad.daysRunning === "number" ? `running ${plural(ad.daysRunning, "day")}` : null,
    safeText(ad.format) || null,
    clock(ad.lengthSec),
  ].filter(Boolean);
  if (facts.length > 0) lines.push(facts.join(" · "));
  if (safeText(data.weekLabel)) lines.push(`Top ads chart: ${safeText(data.weekLabel)}`);
  lines.push("", `Meta Ad Library: ${safeTextOr(ad.adLibraryUrl, "(no link for this ad)")}`);
  if (safeText(ad.videoUrl)) lines.push(`Video: ${safeText(ad.videoUrl)}`);
  section(lines, "Headline", ad.title);
  section(lines, "Text", ad.body);
  section(lines, "Button", ad.cta);
  section(lines, "Landing page", ad.landingPage);
  section(lines, "Caption", ad.caption);
  section(lines, "What happens", ad.description);
  section(lines, "Concept", ad.concept);
  section(lines, "Angle", ad.angle);
  section(lines, "Hook", ad.hook);
  section(lines, "Beats", ad.beats);
  section(lines, "Transcript", ad.transcript);
  const tags = (ad.tags ?? []).map((tag) => `${safeText(tag.field)}: ${safeText(tag.value)}`).filter((tag) => tag !== ": ");
  if (tags.length > 0) lines.push("", "Tags:", ...tags.map((tag) => `  ${tag}`));
  if (safeText(ad.adLibraryUrl)) lines.push("", `To make a video from this ad:  exodus video swipe --url "${safeText(ad.adLibraryUrl)}"`);
  return lines;
}

export function formatFilters(data: { rows?: { label?: string; values?: string[] }[] }): string[] {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (rows.length === 0) return ["There are no filters yet: there is no Top ads chart."];
  const lines = ["Sort & filter values, by row. Use one with: exodus top-ads list --filter \"<value>\""];
  for (const row of rows) {
    lines.push("", `${safeText(row.label)}:`);
    for (const value of row.values ?? []) lines.push(`  ${safeText(value)}`);
  }
  return lines;
}

// ── Flows ──────────────────────────────────────────────────────────────────

const BASE = "/api/v2/top-ads";

async function flow<T>(path: string, verb: string, json: boolean, deps: TopLibraryDeps, format: (data: T) => string[]): Promise<FlowResult> {
  const res = await deps.get(path);
  const failed = failureOf(res, verb, json, deps);
  if (failed) return failed;
  if (json) return { code: 0, lines: [JSON.stringify(res.data)] };
  return { code: 0, lines: format((res.data ?? {}) as T) };
}

export const listFlow = (options: TopAdsListOptions, json: boolean, deps: TopLibraryDeps) => flow<ListAnswer>(`${BASE}${listQuery(options)}`, "top-ads list", json, deps, formatList);

export function searchFlow(words: string, options: Pick<TopAdsListOptions, "list" | "limit">, json: boolean, deps: TopLibraryDeps): Promise<FlowResult> {
  const params = new URLSearchParams({ q: words });
  if (options.list) params.set("list", options.list);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  return flow<SearchAnswer>(`${BASE}/search?${params}`, "top-ads search", json, deps, formatSearch);
}

export const showFlow = (id: string, json: boolean, deps: TopLibraryDeps) => flow(`${BASE}/${encodeURIComponent(id)}`, "top-ads show", json, deps, formatShow);

export const filtersFlow = (json: boolean, deps: TopLibraryDeps) => flow(`${BASE}/filters`, "top-ads filters", json, deps, formatFilters);

// ── Dispatch ───────────────────────────────────────────────────────────────

const LIST_USAGE = 'exodus top-ads list [--list top500|new|trending] [--sort top|newest|longest] [--brand "<name>"] [--filter "<value>"]... [--limit n] [--json]';
const SEARCH_USAGE = 'exodus top-ads search "<words>" [--list top500|new|trending] [--limit n] [--json]';

export async function run(flags: Record<string, string | boolean>, occurrences: FlagOccurrence[] = []): Promise<void> {
  const [sub, ...rest] = positionals(VALUE_FLAGS);
  const json = flags["json"] === true;
  if (!sub || sub === "help") {
    console.log(helpText);
    return;
  }
  if (sub === "list") {
    const parsed = parseListFlags(flags, occurrences);
    if (!parsed.ok) usageError(parsed.message, LIST_USAGE);
    return printResult(await listFlow(parsed.options, json, defaultTopLibraryDeps));
  }
  if (sub === "search") {
    const words = rest.join(" ").trim();
    if (!words) usageError("top-ads search needs words to search for.", SEARCH_USAGE);
    const parsed = parseSearchFlags(flags, occurrences);
    if (!parsed.ok) usageError(parsed.message, SEARCH_USAGE);
    return printResult(await searchFlow(words, parsed.options, json, defaultTopLibraryDeps));
  }
  if (sub === "show") {
    const id = rest[0];
    if (!id) usageError("top-ads show needs an ad's id (from exodus top-ads list).", "exodus top-ads show <id> [--json]");
    return printResult(await showFlow(id, json, defaultTopLibraryDeps));
  }
  if (sub === "filters") return printResult(await filtersFlow(json, defaultTopLibraryDeps));
  console.error(`Unknown subcommand: "${sub}"\n`);
  console.log(helpText);
  process.exit(1);
}
