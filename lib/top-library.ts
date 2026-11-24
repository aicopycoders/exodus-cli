// COP-466: what `exodus top-ads`, `exodus top-brands` and `exodus ad-templates` share: the calls, the error lines, and
// reading flags and words off the command line. The server shapes every answer (convex/lib/topLibrary/cliView.ts) as
// the signed-in pages show it; these commands only print it.
import type { ApiResponse } from "./client.js";
import { apiGet, getApiUrl } from "./client.js";
import { auth401Hint } from "./backend-hint.js";
import { getChannel, type Channel } from "./channel.js";
import { formatApiError } from "./format.js";
import { missingRouteLine } from "./route-support.js";
import type { FlowResult } from "./meta-ads.js";

export type { FlowResult } from "./meta-ads.js";
export { safeText, safeTextOr, table, truncate } from "./meta-ads.js";

export interface TopLibraryDeps {
  get: (path: string) => Promise<ApiResponse<unknown>>;
  channel: Channel;
  apiUrl: () => string;
}

export const defaultTopLibraryDeps: TopLibraryDeps = {
  get: (path) => apiGet<unknown>(path, { skipActiveBrand: true }),
  channel: getChannel(),
  apiUrl: () => getApiUrl(),
};

/** What to say when Top ads isn't on for this account: the server's own sentence, then what it means here. */
export const NOT_ON_LINE = "Top ads, Top brands and Ad templates aren't turned on for your account yet.";

/** The failed answer as lines: an old backend, a bad key, Top ads not on for this account, or the server's words. */
export function failureOf(res: ApiResponse<unknown>, verb: string, json: boolean, deps: TopLibraryDeps): FlowResult | undefined {
  if (res.ok) return undefined;
  if (json) return { code: 1, lines: [JSON.stringify({ ok: false, status: res.status, data: res.data })] };
  const unsupported = missingRouteLine(res, verb, deps.channel);
  if (unsupported) return { code: 1, lines: [unsupported] };
  const lines = [formatApiError(res)];
  if (res.status === 401) lines.push("", auth401Hint(deps.apiUrl()));
  if (res.status === 403) lines.push(NOT_ON_LINE);
  return { code: 1, lines };
}

/** Positionals after the command word, skipping each value flag's value. */
export function positionals(valueFlags: ReadonlySet<string>, args = process.argv.slice(3)): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2).split("=", 1)[0] ?? "";
      i += !arg.includes("=") && valueFlags.has(key) ? 2 : 1;
      continue;
    }
    out.push(arg);
    i++;
  }
  return out;
}

/** `--limit`, a whole number from 1 to `max`, or undefined when not given. */
export function parseLimit(raw: string | boolean | undefined, max: number): { ok: true; limit?: number } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true };
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) return { ok: false, message: `--limit must be a whole number from 1 to ${max} (got "${String(raw)}")` };
  return { ok: true, limit: n };
}

/** One choice of a fixed set, or undefined when not given. */
export function parseChoice<C extends string>(flag: string, raw: string | boolean | undefined, choices: readonly C[]): { ok: true; value?: C } | { ok: false; message: string } {
  if (raw === undefined) return { ok: true };
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if ((choices as readonly string[]).includes(value)) return { ok: true, value: value as C };
  return { ok: false, message: `--${flag} must be one of: ${choices.join(", ")} (got "${String(raw)}")` };
}

export function printResult(result: FlowResult): void {
  for (const line of result.lines) console.log(line);
  for (const warning of result.warnings ?? []) console.error(warning);
  if (result.code !== 0) process.exit(result.code);
}

export function usageError(message: string, usage: string): never {
  console.error(`Error: ${message}`);
  console.log(`Usage: ${usage}`);
  process.exit(1);
}

/** The length as a player shows it (the page's clock): "0:45", "1:01:42". */
export function clock(sec: unknown): string | null {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return null;
  const s = Math.max(0, Math.round(sec));
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
