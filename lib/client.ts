import fs from "node:fs";
import path from "node:path";
import { resolveActiveBrand } from "./layout.js";

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T;
}

interface Config {
  apiUrl: string;
  apiKey: string;
}

let cachedConfig: Config | null = null;

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadConfig(): Config {
  // Search up to 8 parent directories for a .env file (brand subfolders in
  // the multi-brand layout add depth below the install root).
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const vars = parseEnvFile(content);

      const apiUrl =
        vars["EXODUS_API_URL"] ??
        vars["CONVEX_SITE_URL"] ??
        process.env["EXODUS_API_URL"] ??
        process.env["CONVEX_SITE_URL"] ??
        "";

      const apiKey =
        vars["EXODUS_API_KEY"] ??
        vars["VAD_API_KEY"] ??
        process.env["EXODUS_API_KEY"] ??
        process.env["VAD_API_KEY"] ??
        "";

      if (apiUrl) {
        return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Fall back to environment variables only
  const apiUrl =
    process.env["EXODUS_API_URL"] ??
    process.env["CONVEX_SITE_URL"] ??
    "";
  const apiKey =
    process.env["EXODUS_API_KEY"] ??
    process.env["VAD_API_KEY"] ??
    "";

  return { apiUrl: apiUrl.replace(/\/$/, ""), apiKey };
}

function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/** The resolved EXODUS_API_URL (from .env or env vars). For error messaging. */
export function getApiUrl(): string {
  return getConfig().apiUrl;
}

function buildHeaders(
  apiKey: string,
  ccCommand?: string,
  opts?: { skipActiveBrand?: boolean; activeBrandOverride?: string },
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  // Active brand: one key + folder/pointer routing (lib/layout.ts) — the
  // brand subfolder you run from wins, else the `brand use` pointer.
  // Server-side auth honors this header for admin keys and for brands the
  // key's user OWNS; ignored otherwise (invited members stay locked to
  // their bound brand). Doctor's mismatch check sets skipActiveBrand to ask
  // whoami for the key's natural brand (without local override).
  // activeBrandOverride pins a single request to a specific brand — used by
  // `exodus update` to refresh every brand folder's profile in one pass.
  if (!opts?.skipActiveBrand) {
    const activeBrand =
      opts?.activeBrandOverride ?? resolveActiveBrand().slug;
    if (activeBrand) {
      headers["X-Active-Brand"] = activeBrand;
    }
  }
  if (ccCommand) {
    // HTTP headers must be single-line ASCII and reasonably sized.
    // Collapse whitespace, strip non-ASCII, and cap length so large --ad
    // payloads don't blow up the header.
    const sanitized = ccCommand
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[^\x20-\x7e]/g, "")
      .slice(0, 500);
    if (sanitized) headers["X-CC-Command"] = sanitized;
  }
  return headers;
}

export async function apiGet<T>(
  path: string,
  opts?: { skipActiveBrand?: boolean; activeBrandOverride?: string },
): Promise<ApiResponse<T>> {
  const { apiUrl, apiKey } = getConfig();
  const url = `${apiUrl}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(apiKey, undefined, opts),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 300);
    data = {
      error: `Non-JSON ${res.status} from ${path}: ${snippet}`,
      httpStatus: res.status,
    };
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

/**
 * A GET that PRESERVES the raw response body as text — the counterpart to
 * `apiGet`, which JSON-parses every body (and mangles non-JSON into an error
 * object). Use this whenever the server renders a non-JSON payload the caller
 * must keep byte-for-byte — e.g. the canonical YAML from
 * `/api/v2/workflows/templates?key=…`, which `templates export` writes verbatim.
 * Reuses buildHeaders/getConfig exactly like apiGet; never parses `data`.
 */
export async function apiGetText(
  path: string,
  opts?: { skipActiveBrand?: boolean; activeBrandOverride?: string },
): Promise<ApiResponse<string>> {
  const { apiUrl, apiKey } = getConfig();
  const url = `${apiUrl}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(apiKey, undefined, opts),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text };
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  opts?: { ccCommand?: string }
): Promise<ApiResponse<T>> {
  const { apiUrl, apiKey } = getConfig();
  const url = `${apiUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(apiKey, opts?.ccCommand),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 300);
    data = {
      error: `Non-JSON ${res.status} from ${path}: ${snippet}`,
      httpStatus: res.status,
    };
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

// ── Dashboard (Next.js) base URL — for pipelines hosted on the Next app
//    rather than on Convex HTTP. Used by image/template/pixar.
//
// Resolution order:
//   1. Explicit EXODUS_DASHBOARD_URL override — always wins.
//   2. Auto-derive from the resolved API URL: an install pointed at a known
//      DEV backend gets that backend's DEV dashboard, so the internal team
//      doesn't have to set a second env var to route dashboard commands to dev.
//   3. Otherwise the canonical PROD alias. A paying customer's config has no
//      dev marker in its API URL, so this is byte-for-byte the old behavior —
//      the auto-derive in (2) can never fire for them.
const DEV_BACKEND_DASHBOARDS: Array<{ match: string; dashboard: string }> = [
  { match: "good-cod-360", dashboard: "https://dev.xo.copycoders.ai" },
];
const PROD_DASHBOARD = "https://xo.copycoders.ai";

export function resolveDashboardUrl(opts: {
  override?: string;
  apiUrl?: string;
}): string {
  if (opts.override) return opts.override.replace(/\/$/, "");
  const api = opts.apiUrl ?? "";
  for (const { match, dashboard } of DEV_BACKEND_DASHBOARDS) {
    if (api.includes(match)) return dashboard;
  }
  return PROD_DASHBOARD;
}

export function getDashboardUrl(): string {
  return resolveDashboardUrl({
    override: process.env["EXODUS_DASHBOARD_URL"],
    apiUrl: getConfig().apiUrl, // resolved from .env / env via loadConfig()
  });
}

// Vercel/CDN error responses (504s, 502s, etc.) return HTML, not JSON.
// Surface them as a structured error instead of crashing on JSON.parse.
async function readDashboardJson<T>(res: Response, path: string): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 300);
    return {
      error: `Non-JSON ${res.status} from ${path}: ${snippet}`,
      httpStatus: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
    } as T;
  }
}

export async function apiGetDashboard<T>(
  path: string,
  opts?: { timeoutMs?: number; activeBrandOverride?: string },
): Promise<ApiResponse<T>> {
  const { apiKey } = getConfig();
  const url = `${getDashboardUrl()}${path}`;
  const headers = buildHeaders(apiKey, undefined, {
    activeBrandOverride: opts?.activeBrandOverride,
  });
  // Optional abort timeout so callers (e.g. `update`'s brand lookups) can't hang
  // indefinitely on a slow/unreachable dashboard. Omitted elsewhere = unchanged.
  const controller = opts?.timeoutMs ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), opts!.timeoutMs)
    : undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers,
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { ok: res.ok, status: res.status, data: await readDashboardJson<T>(res, path) };
}

export async function apiPostDashboard<T>(
  path: string,
  body: unknown,
  opts?: { timeoutMs?: number; activeBrandOverride?: string },
): Promise<ApiResponse<T>> {
  const { apiKey } = getConfig();
  const url = `${getDashboardUrl()}${path}`;
  const headers = buildHeaders(apiKey, undefined, {
    activeBrandOverride: opts?.activeBrandOverride,
  });
  // Optional abort timeout so callers can bound a long-running dashboard route
  // (e.g. the sessions chat route's 300s maxDuration). Omitted elsewhere =
  // unchanged: no signal, so existing call sites behave exactly as before.
  const controller = opts?.timeoutMs ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), opts!.timeoutMs)
    : undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { ok: res.ok, status: res.status, data: await readDashboardJson<T>(res, path) };
}

export async function apiDeleteDashboard<T>(path: string): Promise<ApiResponse<T>> {
  const { apiKey } = getConfig();
  const res = await fetch(`${getDashboardUrl()}${path}`, {
    method: "DELETE",
    headers: buildHeaders(apiKey),
  });
  return { ok: res.ok, status: res.status, data: await readDashboardJson<T>(res, path) };
}
