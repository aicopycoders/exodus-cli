import fs from "node:fs";
import path from "node:path";
import { apiGetDashboard } from "./client.js";

/**
 * Pulls the caller's own pipeline keys from the dashboard
 * (GET /api/settings/keys, decrypted server-side, scoped to the API key's
 * user) and writes them into the workspace `.env` so the local Pixar host can
 * read them via process.env. The user enters keys once in the dashboard
 * (Settings → Pipeline Keys); this is the bridge to local files.
 *
 * Zero-dependency by design — exodus keeps an empty `dependencies` list, so
 * this uses node builtins only (matches lib/load-env.ts, lib/client.ts).
 */

// Maps a dashboard pipeline-key provider to the env var the Pixar pipeline
// code actually reads. Verified against scout/src/pixar/keys.ts (resolveLlmKey
// / resolveElevenLabsKey / resolveKieKey) and bot-call.ts (GENESIS_API_KEY).
export const PROVIDER_ENV_MAP: Record<string, string> = {
  genesis: "GENESIS_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  kie: "KIE_API_KEY",
};

// Providers the dashboard stores but that have NO local `.env` mapping by
// design — they're resolved server-side per run from the member's encrypted
// dashboard keys (strict BYOK), never read from process.env on the local host.
// `imgflip` is a username+password JSON blob, not a flat API key, and the old
// shared-account env fallback (IMGFLIP_USERNAME / IMGFLIP_PASSWORD) was removed
// (see src/lib/meme/imgflip.ts). So `keys pull` must NOT write it to `.env` and
// must NOT report it as an unknown-mapping skip — it's expected + already usable
// from the dashboard. (#325)
// `scrapecreators` follows the same pattern: the Wild Source scraper key is
// snapshotted onto the scraper run row server-side and decrypted in the
// Trigger worker — the local host never reads it from .env.
// `apify` is the same story (#911): the Wild Source Apify scraper key is used
// server-side per run from Settings → Keys, never from a local .env var. It
// belongs on the "used server-side; no .env entry needed" line with its
// siblings, not in the ambiguous "no known env var mapping" skip bucket.
// `browserbase` joins them (#1405): the Organic Scout research-account browser
// key is an {apiKey, projectId} JSON pair that gets decrypted server-side when a
// Door 2 run starts. The local host never reads it from .env — our own env-level
// BROWSERBASE_* vars are the internal pilot's, never the member's — so
// `keys pull` must not write it, and must not flag it as an unknown-mapping skip.
// `fal` (COP-440): the member's optional fal.ai key for One-take's ultra filter,
// snapshotted onto the run and decrypted in the Trigger worker only.
export const SERVER_RESOLVED_PROVIDERS = new Set<string>([
  "imgflip",
  "scrapecreators",
  "apify",
  "browserbase",
  "fal",
]);

export interface RemoteKeys {
  /** provider → plaintext key (only providers the user has set) */
  keys: Record<string, string>;
  /** providers whose stored ciphertext failed to decrypt server-side */
  failed: string[];
}

export async function fetchRemoteKeys(): Promise<RemoteKeys> {
  const res = await apiGetDashboard<RemoteKeys & { error?: string }>(
    "/api/settings/keys",
  );
  if (!res.ok) {
    const msg =
      (res.data as { error?: string } | null)?.error ??
      `failed to fetch keys from dashboard (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return { keys: res.data.keys ?? {}, failed: res.data.failed ?? [] };
}

/**
 * Find the nearest `.env` walking up from cwd (matches load-env / client). If
 * none exists, fall back to `<cwd>/.env` so a fresh workspace still gets one.
 */
export function resolveEnvFilePath(): string {
  let dir = process.cwd();
  for (let i = 0; i <= 5; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), ".env");
}

export interface UpsertResult {
  name: string;
  action: "added" | "updated" | "unchanged";
}

/**
 * Upsert KEY=value lines into an `.env` file, preserving every other line and
 * comment. Callers must never log the values. A value containing whitespace,
 * `#`, or quotes is double-quoted so the file stays parseable.
 */
export function upsertEnvVars(
  filePath: string,
  vars: Record<string, string>,
): UpsertResult[] {
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    content = "";
  }
  const lines = content.length ? content.split(/\r?\n/) : [];
  const results: UpsertResult[] = [];

  for (const [name, value] of Object.entries(vars)) {
    const formatted = `${name}=${formatEnvValue(value)}`;
    const idx = lines.findIndex((l) => {
      const t = l.trim();
      if (!t || t.startsWith("#")) return false;
      const eq = t.indexOf("=");
      return eq > 0 && t.slice(0, eq).trim() === name;
    });
    if (idx === -1) {
      lines.push(formatted);
      results.push({ name, action: "added" });
    } else if (lines[idx] === formatted) {
      results.push({ name, action: "unchanged" });
    } else {
      lines[idx] = formatted;
      results.push({ name, action: "updated" });
    }
  }

  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  // mode is honored only when the file is newly created; existing files keep
  // their permissions. Secrets-bearing, so create tight.
  fs.writeFileSync(filePath, out, { mode: 0o600 });
  return results;
}

/**
 * Map remote provider keys to their env-var names. A provider lands in one of
 * three buckets: written to `.env` (in PROVIDER_ENV_MAP), `serverResolved`
 * (intentionally dashboard-only, e.g. imgflip — present + usable but has no
 * `.env` mapping by design), or `skipped` (genuinely unknown — not written
 * under a guessed name). Keeping serverResolved separate stops `keys pull` from
 * flagging an expected provider as a missing-mapping problem (#325).
 */
export function mapKeysToEnvVars(
  keys: Record<string, string>,
): { vars: Record<string, string>; serverResolved: string[]; skipped: string[] } {
  const vars: Record<string, string> = {};
  const serverResolved: string[] = [];
  const skipped: string[] = [];
  for (const [provider, value] of Object.entries(keys)) {
    const envName = PROVIDER_ENV_MAP[provider];
    if (envName) vars[envName] = value;
    else if (SERVER_RESOLVED_PROVIDERS.has(provider)) serverResolved.push(provider);
    else skipped.push(provider);
  }
  return { vars, serverResolved, skipped };
}

function formatEnvValue(value: string): string {
  if (/[\s#'"]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}
