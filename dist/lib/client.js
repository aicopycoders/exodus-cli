import fs from "node:fs";
import path from "node:path";
import { resolveActiveBrand } from "./layout.js";
let cachedConfig = null;
function parseEnvFile(content) {
    const result = {};
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1)
            continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}
function loadConfig() {
    let dir = process.cwd();
    for (let i = 0; i < 8; i++) {
        const envPath = path.join(dir, ".env");
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, "utf-8");
            const vars = parseEnvFile(content);
            const apiUrl = vars["EXODUS_API_URL"] ??
                vars["CONVEX_SITE_URL"] ??
                process.env["EXODUS_API_URL"] ??
                process.env["CONVEX_SITE_URL"] ??
                "";
            const apiKey = vars["EXODUS_API_KEY"] ??
                vars["VAD_API_KEY"] ??
                process.env["EXODUS_API_KEY"] ??
                process.env["VAD_API_KEY"] ??
                "";
            if (apiUrl) {
                return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    const apiUrl = process.env["EXODUS_API_URL"] ??
        process.env["CONVEX_SITE_URL"] ??
        "";
    const apiKey = process.env["EXODUS_API_KEY"] ??
        process.env["VAD_API_KEY"] ??
        "";
    return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}
function getConfig() {
    if (!cachedConfig) {
        cachedConfig = loadConfig();
    }
    return cachedConfig;
}
export function getApiUrl() {
    return getConfig().apiUrl;
}
function buildHeaders(apiKey, ccCommand, opts) {
    const headers = {
        "Content-Type": "application/json",
    };
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (!opts?.skipActiveBrand) {
        const activeBrand = opts?.activeBrandOverride ?? resolveActiveBrand().slug;
        if (activeBrand) {
            headers["X-Active-Brand"] = activeBrand;
        }
    }
    if (ccCommand) {
        const sanitized = ccCommand
            .replace(/[\r\n\t]+/g, " ")
            .replace(/[^\x20-\x7e]/g, "")
            .slice(0, 500);
        if (sanitized)
            headers["X-CC-Command"] = sanitized;
    }
    return headers;
}
export async function apiGet(path, opts) {
    const { apiUrl, apiKey } = getConfig();
    const url = `${apiUrl}${path}`;
    const res = await fetch(url, {
        method: "GET",
        headers: buildHeaders(apiKey, undefined, opts),
    });
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        const snippet = text.replace(/\s+/g, " ").trim().slice(0, 300);
        data = {
            error: `Non-JSON ${res.status} from ${path}: ${snippet}`,
            httpStatus: res.status,
        };
    }
    return { ok: res.ok, status: res.status, data: data };
}
export async function apiGetText(path, opts) {
    const { apiUrl, apiKey } = getConfig();
    const url = `${apiUrl}${path}`;
    const res = await fetch(url, {
        method: "GET",
        headers: buildHeaders(apiKey, undefined, opts),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, data: text };
}
export async function apiPost(path, body, opts) {
    const { apiUrl, apiKey } = getConfig();
    const url = `${apiUrl}${path}`;
    const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(apiKey, opts?.ccCommand),
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        const snippet = text.replace(/\s+/g, " ").trim().slice(0, 300);
        data = {
            error: `Non-JSON ${res.status} from ${path}: ${snippet}`,
            httpStatus: res.status,
        };
    }
    return { ok: res.ok, status: res.status, data: data };
}
const DEV_BACKEND_DASHBOARDS = [
    { match: "good-cod-360", dashboard: "https://dev.xo.copycoders.ai" },
];
const PROD_DASHBOARD = "https://xo.copycoders.ai";
export function resolveDashboardUrl(opts) {
    if (opts.override)
        return opts.override.replace(/\/$/, "");
    const api = opts.apiUrl ?? "";
    for (const { match, dashboard } of DEV_BACKEND_DASHBOARDS) {
        if (api.includes(match))
            return dashboard;
    }
    return PROD_DASHBOARD;
}
export function getDashboardUrl() {
    return resolveDashboardUrl({
        override: process.env["EXODUS_DASHBOARD_URL"],
        apiUrl: getConfig().apiUrl,
    });
}
async function readDashboardJson(res, path) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    }
    catch {
        const snippet = text.replace(/\s+/g, " ").trim().slice(0, 300);
        return {
            error: `Non-JSON ${res.status} from ${path}: ${snippet}`,
            httpStatus: res.status,
            contentType: res.headers.get("content-type") ?? undefined,
        };
    }
}
export async function apiGetDashboard(path, opts) {
    const { apiKey } = getConfig();
    const url = `${getDashboardUrl()}${path}`;
    const headers = buildHeaders(apiKey, undefined, {
        activeBrandOverride: opts?.activeBrandOverride,
    });
    const controller = opts?.timeoutMs ? new AbortController() : undefined;
    const timer = controller
        ? setTimeout(() => controller.abort(), opts.timeoutMs)
        : undefined;
    let res;
    try {
        res = await fetch(url, {
            method: "GET",
            headers,
            signal: controller?.signal,
        });
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
    return { ok: res.ok, status: res.status, data: await readDashboardJson(res, path) };
}
export async function apiPostDashboard(path, body, opts) {
    const { apiKey } = getConfig();
    const url = `${getDashboardUrl()}${path}`;
    const headers = buildHeaders(apiKey, undefined, {
        activeBrandOverride: opts?.activeBrandOverride,
    });
    const controller = opts?.timeoutMs ? new AbortController() : undefined;
    const timer = controller
        ? setTimeout(() => controller.abort(), opts.timeoutMs)
        : undefined;
    let res;
    try {
        res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller?.signal,
        });
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
    return { ok: res.ok, status: res.status, data: await readDashboardJson(res, path) };
}
export async function apiDeleteDashboard(path) {
    const { apiKey } = getConfig();
    const res = await fetch(`${getDashboardUrl()}${path}`, {
        method: "DELETE",
        headers: buildHeaders(apiKey),
    });
    return { ok: res.ok, status: res.status, data: await readDashboardJson(res, path) };
}
