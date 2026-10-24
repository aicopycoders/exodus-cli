// Preflight for `exodus pixar run`: make sure the local machine can actually
// run the pipeline before we create a run and spend minutes (and money) on it.
//
// Two checks:
//   1. Keys — auto-pull the caller's dashboard keys into .env + process.env,
//      then confirm the providers the orchestrator needs are present.
//   2. Tools — ffmpeg/ffprobe must be on PATH for the final stitch.
//
// The pure evaluators (missingRequiredKeys / muxConfigured / hasBinary) are
// kept side-effect-light so they're unit-testable; the command layer turns
// their results into operator-facing messages + machine-readable markers the
// pixar skill can pattern-match (e.g. "[exodus:preflight] missing-binaries: …").

import { spawnSync } from "node:child_process";
import {
  fetchRemoteKeys,
  mapKeysToEnvVars,
  resolveEnvFilePath,
  upsertEnvVars,
} from "./keys-sync.js";

// ── binary detection ──────────────────────────────────────────────────

/**
 * True when `name` is an executable on PATH. We judge presence by whether the
 * spawn FOUND the binary (no ENOENT), not by exit code — a tool may reject the
 * probe flag (`node` wants `--version`, not `-version`) yet still be installed.
 * `-version` is used because ffmpeg/ffprobe — the binaries we actually check —
 * accept it and exit immediately.
 */
export function hasBinary(name: string): boolean {
  try {
    const res = spawnSync(name, ["-version"], { stdio: "ignore" });
    return res.error == null;
  } catch {
    return false;
  }
}

/** A media file's length in seconds via ffprobe, or null when ffprobe is missing or can't read it. */
export function probeDurationSec(filePath: string): number | null {
  if (!hasBinary("ffprobe")) return null;
  const res = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
    { encoding: "utf-8" },
  );
  if (res.error || res.status !== 0) return null;
  const seconds = Number.parseFloat((res.stdout ?? "").trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// ── key sync ───────────────────────────────────────────────────────────

export interface KeySyncResult {
  /** env var names refreshed from the dashboard */
  pulled: string[];
  /** providers whose stored ciphertext failed to decrypt server-side */
  failed: string[];
  /** dashboard unreachable — pull skipped (treated as a soft warning) */
  error?: string;
}

/**
 * Pull the caller's dashboard keys into the workspace .env AND the current
 * process.env. load-env runs at CLI startup (before this pull), so freshly
 * added keys would otherwise not be visible to this run; the dashboard is the
 * source of truth at run time, so pulled values overwrite process.env.
 *
 * Network / dashboard failures are RETURNED as `error`, never thrown — preflight
 * treats them as a soft warning and falls back to whatever is already in .env.
 */
export async function syncKeysToEnv(): Promise<KeySyncResult> {
  let remote: Awaited<ReturnType<typeof fetchRemoteKeys>>;
  try {
    remote = await fetchRemoteKeys();
  } catch (e) {
    return { pulled: [], failed: [], error: (e as Error).message };
  }
  const { vars } = mapKeysToEnvVars(remote.keys);
  upsertEnvVars(resolveEnvFilePath(), vars);
  for (const [name, value] of Object.entries(vars)) {
    process.env[name] = value;
  }
  return { pulled: Object.keys(vars), failed: remote.failed };
}

// ── required-key evaluation (pure) ──────────────────────────────────────

export interface RequiredKey {
  label: string;
  /** the requirement is met when ANY of these env vars is set */
  anyOf: string[];
}

/** What the pixar orchestrator needs to run end-to-end. */
export const PIXAR_REQUIRED_KEYS: RequiredKey[] = [
  { label: "Genesis", anyOf: ["GENESIS_API_KEY"] },
  {
    label: "LLM (Anthropic or OpenRouter)",
    anyOf: ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"],
  },
  { label: "ElevenLabs", anyOf: ["ELEVENLABS_API_KEY"] },
  { label: "Kie.ai", anyOf: ["KIE_API_KEY"] },
];

// Mux is shared infra (final upload lands in our Mux account), not a per-student
// key — checked separately and surfaced as a warning, not a hard block.
export const PIXAR_MUX_ENV_VARS = ["MUX_TOKEN_ID", "MUX_TOKEN_SECRET"];

type Env = Record<string, string | undefined>;

function isSet(env: Env, name: string): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

/** Labels of required keys not satisfied by `env` (for the human message). */
export function missingRequiredKeys(
  env: Env,
  required: RequiredKey[] = PIXAR_REQUIRED_KEYS,
): string[] {
  return required
    .filter((r) => !r.anyOf.some((name) => isSet(env, name)))
    .map((r) => r.label);
}

/** Env var names from unsatisfied requirements (for the machine-readable marker). */
export function missingRequiredEnvVars(
  env: Env,
  required: RequiredKey[] = PIXAR_REQUIRED_KEYS,
): string[] {
  const out: string[] = [];
  for (const r of required) {
    if (!r.anyOf.some((name) => isSet(env, name))) out.push(...r.anyOf);
  }
  return out;
}

export function muxConfigured(env: Env): boolean {
  return PIXAR_MUX_ENV_VARS.every((name) => isSet(env, name));
}
