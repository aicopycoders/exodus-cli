import {
  defaultTopLibraryDeps,
  failureOf,
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
exodus ad-templates — read Ad templates: Luke's proven ad shapes, with real example ads (read-only)

The same templates as Templates on the dashboard (Sources → Mining → Templates):
Luke's, and any copies you made of them there. Each one names what it locks in,
its beats, and real ads that follow it, with their scripts. Nothing here changes
anything or spends money.

Usage:
  exodus ad-templates list [--json]
  exodus ad-templates show <number, name or id> [--json]
  exodus ad-templates search "<words>" [--json]

Search:
  Shows the templates that have every word you typed, the closest in meaning
  first, the same way the search box on the page does.

Show:
  Takes the number, the name or the id from the list. A copy you made of a
  template keeps that template's number (and its name, if you kept it), so
  when two match, the CLI names both ids: use the id.
  Prints the template, then each example ad with its Meta Ad Library link and
  its script. In a script, words in [CAPITALS] are blanks to fill with your own
  product's details; "fills with" says what goes in each.

To make a video from an example ad:
  exodus video swipe --url "<its Meta Ad Library link>"

Notes:
  • These are not the same as \`exodus template\` (static image templates) or
    the video formats in \`exodus video --input-options\`.
  • Making your own copy of a template is done on the page.
  • If Top ads isn't turned on for your account, this says so.

Examples:
  exodus ad-templates list
  exodus ad-templates show 3
  exodus ad-templates search "before and after"
`.trim();

const VALUE_FLAGS = new Set<string>();

export interface AdTemplate {
  id?: string;
  number?: number;
  name?: string;
  owner?: string;
  format?: string | null;
  opening?: string | null;
}

export interface AdTemplateDetail extends AdTemplate {
  locks?: { field?: string; value?: string }[];
  beats?: string[] | null;
  note?: string | null;
  references?: {
    brand?: string;
    page?: string;
    oneLine?: string;
    metaAdId?: string | null;
    adLibraryUrl?: string | null;
    script?: string | null;
    fills?: { blank?: string; fills?: string }[];
  }[];
}

export function templatesTable(templates: readonly AdTemplate[]): string {
  return table(
    ["#", "name", "format", "by", "opening", "id"],
    templates.map((t) => [
      typeof t.number === "number" ? String(t.number) : "—",
      truncate(t.name, 36) || "—",
      truncate(t.format, 18) || "—",
      safeTextOr(t.owner, "—"),
      truncate(t.opening, 60) || "—",
      safeTextOr(t.id, "—"),
    ]),
  );
}

export function formatList(data: { templates?: AdTemplate[] }): string[] {
  const templates = Array.isArray(data.templates) ? data.templates : [];
  if (templates.length === 0) return ["No ad templates yet."];
  return [`Ad templates (${templates.length})`, "", templatesTable(templates), "", "One in full, with its example ads and scripts:  exodus ad-templates show <#>"];
}

export function formatSearch(data: { query?: string; templates?: AdTemplate[] }): string[] {
  const templates = Array.isArray(data.templates) ? data.templates : [];
  if (templates.length === 0) return [`No ad template has every word of "${safeText(data.query)}".`];
  return [`Search "${safeText(data.query)}": ${templates.length} ad template${templates.length === 1 ? "" : "s"}, closest first`, "", templatesTable(templates), "", "One in full:  exodus ad-templates show <#>"];
}

export function formatShow(data: { template?: AdTemplateDetail }): string[] {
  const t = data.template ?? {};
  const lines = [`${typeof t.number === "number" ? `${t.number}. ` : ""}${safeTextOr(t.name, "—")} (${safeTextOr(t.owner, "—")})`];
  if (safeText(t.format)) lines.push(`Format: ${safeText(t.format)}`);
  const locks = (t.locks ?? []).map((lock) => `  ${safeText(lock.field)}: ${safeText(lock.value)}`);
  if (locks.length > 0) lines.push("", "Locked in:", ...locks);
  const beats = (t.beats ?? []).map((beat, n) => `  ${n + 1}. ${safeText(beat)}`);
  if (beats.length > 0) lines.push("", "Beats:", ...beats);
  if (safeText(t.note)) lines.push("", "Note:", ...safeText(t.note).split("\n").map((line) => `  ${line}`));
  const refs = t.references ?? [];
  lines.push("", refs.length === 0 ? "No example ads." : `Example ads (${refs.length}):`);
  refs.forEach((ref, n) => {
    const page = safeText(ref.page);
    const brand = safeTextOr(ref.brand, "—");
    lines.push("", `${n + 1}. ${brand}${page && page.toLowerCase() !== brand.toLowerCase() ? ` — ${page}` : ""}: ${safeText(ref.oneLine)}`);
    lines.push(`   Meta Ad Library: ${safeTextOr(ref.adLibraryUrl, "(no link for this ad)")}`);
    if (safeText(ref.script)) lines.push("   Script:", ...safeText(ref.script).split("\n").map((line) => `     ${line}`));
    const fills = (ref.fills ?? []).map((fill) => `     ${safeText(fill.blank)} fills with ${safeText(fill.fills)}`);
    if (fills.length > 0) lines.push("   Blanks:", ...fills);
  });
  if (refs.some((ref) => safeText(ref.adLibraryUrl))) lines.push("", 'To make a video from an example ad:  exodus video swipe --url "<its Meta Ad Library link>"');
  return lines;
}

const BASE = "/api/v2/ad-templates";

async function flow<T>(path: string, verb: string, json: boolean, deps: TopLibraryDeps, format: (data: T) => string[]): Promise<FlowResult> {
  const res = await deps.get(path);
  const failed = failureOf(res, verb, json, deps);
  if (failed) return failed;
  if (json) return { code: 0, lines: [JSON.stringify(res.data)] };
  return { code: 0, lines: format((res.data ?? {}) as T) };
}

export const listFlow = (json: boolean, deps: TopLibraryDeps) => flow(BASE, "ad-templates list", json, deps, formatList);
export const showFlow = (which: string, json: boolean, deps: TopLibraryDeps) => flow(`${BASE}/${encodeURIComponent(which)}`, "ad-templates show", json, deps, formatShow);
export const searchFlow = (words: string, json: boolean, deps: TopLibraryDeps) => flow(`${BASE}/search?${new URLSearchParams({ q: words })}`, "ad-templates search", json, deps, formatSearch);

export async function run(flags: Record<string, string | boolean>): Promise<void> {
  const [sub, ...rest] = positionals(VALUE_FLAGS);
  const json = flags["json"] === true;
  if (!sub || sub === "help") {
    console.log(helpText);
    return;
  }
  if (sub === "list") return printResult(await listFlow(json, defaultTopLibraryDeps));
  if (sub === "show") {
    const which = rest.join(" ").trim();
    if (!which) usageError("ad-templates show needs a template's number, name or id.", "exodus ad-templates show <number, name or id> [--json]");
    return printResult(await showFlow(which, json, defaultTopLibraryDeps));
  }
  if (sub === "search") {
    const words = rest.join(" ").trim();
    if (!words) usageError("ad-templates search needs words to search for.", 'exodus ad-templates search "<words>" [--json]');
    return printResult(await searchFlow(words, json, defaultTopLibraryDeps));
  }
  console.error(`Unknown subcommand: "${sub}"\n`);
  console.log(helpText);
  process.exit(1);
}
