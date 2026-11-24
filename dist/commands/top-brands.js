import { defaultTopLibraryDeps, failureOf, parseLimit, plural, positionals, printResult, safeText, safeTextOr, usageError, } from "../lib/top-library.js";
export const helpText = `
exodus top-brands — read Top brands: the brands behind Top ads, by live ads (read-only)

The same list as Top brands on the dashboard (Sources → Mining → Top ads →
Top brands): each brand's live ads, how many of its ads are on this week's
chart, and its pages. Nothing here changes anything or spends money.

Usage:
  exodus top-brands list [--limit n] [--json]

Flags:
  --limit <n>   How many brands to show, 1–500 (default 40)
  --json        Machine-readable JSON instead of the list

Reading it:
  Live-ad counts are estimates, so they read approximately: "~7.4K" is about
  7,400. A brand's ads on this week's chart:  exodus top-ads list --brand "<name>"

Notes:
  • If Top ads isn't turned on for your account, this says so.
  • Brands you follow or hide on the page aren't read here.

Examples:
  exodus top-brands list
  exodus top-brands list --limit 10
`.trim();
export const MAX_LIMIT = 500;
const VALUE_FLAGS = new Set(["limit"]);
const PAGE_KINDS = { main: "main page", persona: "persona page", related: "related page" };
export function formatBrands(data) {
    if (data.state === "empty")
        return [safeTextOr(data.message, "There is no Top ads chart yet.")];
    const brands = Array.isArray(data.brands) ? data.brands : [];
    if (brands.length === 0)
        return ["No brands yet."];
    const total = typeof data.total === "number" ? data.total : brands.length;
    const lines = [`Top brands: showing ${brands.length} of ${total}, by live ads`];
    for (const brand of brands) {
        const chart = typeof brand.chartAds === "number" ? ` · ${plural(brand.chartAds, "ad")} on this week's chart` : "";
        lines.push("", `${brand.rank ?? "—"}. ${safeTextOr(brand.name, "—")} — ${safeTextOr(brand.liveAds, "—")} live ads${chart}`);
        for (const page of brand.pages ?? []) {
            const live = safeText(page.liveAds);
            const kind = PAGE_KINDS[safeText(page.kind)] ?? "page";
            lines.push(`   ${safeTextOr(page.name, "—")} (${kind})${live ? ` — ${live} live ads` : ""}`);
        }
    }
    if (total > brands.length)
        lines.push("", `More with --limit (up to ${MAX_LIMIT}).`);
    lines.push("", 'A brand\'s ads on this week\'s chart:  exodus top-ads list --brand "<name>"');
    return lines;
}
export async function listFlow(limit, json, deps) {
    const res = await deps.get(`/api/v2/top-brands${limit === undefined ? "" : `?limit=${limit}`}`);
    const failed = failureOf(res, "top-brands list", json, deps);
    if (failed)
        return failed;
    if (json)
        return { code: 0, lines: [JSON.stringify(res.data)] };
    return { code: 0, lines: formatBrands((res.data ?? {})) };
}
export async function run(flags) {
    const [sub] = positionals(VALUE_FLAGS);
    if (!sub || sub === "help") {
        console.log(helpText);
        return;
    }
    if (sub === "list") {
        const limit = parseLimit(flags["limit"], MAX_LIMIT);
        if (!limit.ok)
            usageError(limit.message, "exodus top-brands list [--limit n] [--json]");
        return printResult(await listFlow(limit.limit, flags["json"] === true, defaultTopLibraryDeps));
    }
    console.error(`Unknown subcommand: "${sub}"\n`);
    console.log(helpText);
    process.exit(1);
}
