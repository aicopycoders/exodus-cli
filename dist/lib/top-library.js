import { apiGet, getApiUrl } from "./client.js";
import { auth401Hint } from "./backend-hint.js";
import { getChannel } from "./channel.js";
import { formatApiError } from "./format.js";
import { missingRouteLine } from "./route-support.js";
export { safeText, safeTextOr, table, truncate } from "./meta-ads.js";
export const defaultTopLibraryDeps = {
    get: (path) => apiGet(path, { skipActiveBrand: true }),
    channel: getChannel(),
    apiUrl: () => getApiUrl(),
};
export const NOT_ON_LINE = "Top ads, Top brands and Ad templates aren't turned on for your account yet.";
export function failureOf(res, verb, json, deps) {
    if (res.ok)
        return undefined;
    if (json)
        return { code: 1, lines: [JSON.stringify({ ok: false, status: res.status, data: res.data })] };
    const unsupported = missingRouteLine(res, verb, deps.channel);
    if (unsupported)
        return { code: 1, lines: [unsupported] };
    const lines = [formatApiError(res)];
    if (res.status === 401)
        lines.push("", auth401Hint(deps.apiUrl()));
    if (res.status === 403)
        lines.push(NOT_ON_LINE);
    return { code: 1, lines };
}
export function positionals(valueFlags, args = process.argv.slice(3)) {
    const out = [];
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
export function parseLimit(raw, max) {
    if (raw === undefined)
        return { ok: true };
    const n = typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > max)
        return { ok: false, message: `--limit must be a whole number from 1 to ${max} (got "${String(raw)}")` };
    return { ok: true, limit: n };
}
export function parseChoice(flag, raw, choices) {
    if (raw === undefined)
        return { ok: true };
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (choices.includes(value))
        return { ok: true, value: value };
    return { ok: false, message: `--${flag} must be one of: ${choices.join(", ")} (got "${String(raw)}")` };
}
export function printResult(result) {
    for (const line of result.lines)
        console.log(line);
    for (const warning of result.warnings ?? [])
        console.error(warning);
    if (result.code !== 0)
        process.exit(result.code);
}
export function usageError(message, usage) {
    console.error(`Error: ${message}`);
    console.log(`Usage: ${usage}`);
    process.exit(1);
}
export function clock(sec) {
    if (typeof sec !== "number" || !Number.isFinite(sec))
        return null;
    const s = Math.max(0, Math.round(sec));
    const two = (n) => String(n).padStart(2, "0");
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
