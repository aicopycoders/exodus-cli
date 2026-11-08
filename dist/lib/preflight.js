import { spawnSync } from "node:child_process";
import { fetchRemoteKeys, mapKeysToEnvVars, resolveEnvFilePath, upsertEnvVars, } from "./keys-sync.js";
export function hasBinary(name) {
    try {
        const res = spawnSync(name, ["-version"], { stdio: "ignore" });
        return res.error == null;
    }
    catch {
        return false;
    }
}
export function probeDurationSec(filePath) {
    if (!hasBinary("ffprobe"))
        return null;
    const res = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath], { encoding: "utf-8" });
    if (res.error || res.status !== 0)
        return null;
    const seconds = Number.parseFloat((res.stdout ?? "").trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
export async function syncKeysToEnv() {
    let remote;
    try {
        remote = await fetchRemoteKeys();
    }
    catch (e) {
        return { pulled: [], failed: [], error: e.message };
    }
    const { vars } = mapKeysToEnvVars(remote.keys);
    upsertEnvVars(resolveEnvFilePath(), vars);
    for (const [name, value] of Object.entries(vars)) {
        process.env[name] = value;
    }
    return { pulled: Object.keys(vars), failed: remote.failed };
}
export const PIXAR_REQUIRED_KEYS = [
    { label: "Genesis", anyOf: ["GENESIS_API_KEY"] },
    {
        label: "LLM (Anthropic or OpenRouter)",
        anyOf: ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"],
    },
    { label: "ElevenLabs", anyOf: ["ELEVENLABS_API_KEY"] },
    { label: "Kie.ai", anyOf: ["KIE_API_KEY"] },
];
export const PIXAR_MUX_ENV_VARS = ["MUX_TOKEN_ID", "MUX_TOKEN_SECRET"];
function isSet(env, name) {
    const v = env[name];
    return typeof v === "string" && v.trim().length > 0;
}
export function missingRequiredKeys(env, required = PIXAR_REQUIRED_KEYS) {
    return required
        .filter((r) => !r.anyOf.some((name) => isSet(env, name)))
        .map((r) => r.label);
}
export function missingRequiredEnvVars(env, required = PIXAR_REQUIRED_KEYS) {
    const out = [];
    for (const r of required) {
        if (!r.anyOf.some((name) => isSet(env, name)))
            out.push(...r.anyOf);
    }
    return out;
}
export function muxConfigured(env) {
    return PIXAR_MUX_ENV_VARS.every((name) => isSet(env, name));
}
