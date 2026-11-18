import fs from "node:fs";
import path from "node:path";
import { apiGetDashboard } from "./client.js";
export const PROVIDER_ENV_MAP = {
    genesis: "GENESIS_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    elevenlabs: "ELEVENLABS_API_KEY",
    kie: "KIE_API_KEY",
};
export const SERVER_RESOLVED_PROVIDERS = new Set([
    "imgflip",
    "scrapecreators",
    "apify",
    "browserbase",
    "fal",
]);
export async function fetchRemoteKeys() {
    const res = await apiGetDashboard("/api/settings/keys");
    if (!res.ok) {
        const msg = res.data?.error ??
            `failed to fetch keys from dashboard (HTTP ${res.status})`;
        throw new Error(msg);
    }
    return { keys: res.data.keys ?? {}, failed: res.data.failed ?? [] };
}
export function resolveEnvFilePath() {
    let dir = process.cwd();
    for (let i = 0; i <= 5; i++) {
        const candidate = path.join(dir, ".env");
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return path.join(process.cwd(), ".env");
}
export function upsertEnvVars(filePath, vars) {
    let content = "";
    try {
        content = fs.readFileSync(filePath, "utf8");
    }
    catch {
        content = "";
    }
    const lines = content.length ? content.split(/\r?\n/) : [];
    const results = [];
    for (const [name, value] of Object.entries(vars)) {
        const formatted = `${name}=${formatEnvValue(value)}`;
        const idx = lines.findIndex((l) => {
            const t = l.trim();
            if (!t || t.startsWith("#"))
                return false;
            const eq = t.indexOf("=");
            return eq > 0 && t.slice(0, eq).trim() === name;
        });
        if (idx === -1) {
            lines.push(formatted);
            results.push({ name, action: "added" });
        }
        else if (lines[idx] === formatted) {
            results.push({ name, action: "unchanged" });
        }
        else {
            lines[idx] = formatted;
            results.push({ name, action: "updated" });
        }
    }
    let out = lines.join("\n");
    if (!out.endsWith("\n"))
        out += "\n";
    fs.writeFileSync(filePath, out, { mode: 0o600 });
    return results;
}
export function mapKeysToEnvVars(keys) {
    const vars = {};
    const serverResolved = [];
    const skipped = [];
    for (const [provider, value] of Object.entries(keys)) {
        const envName = PROVIDER_ENV_MAP[provider];
        if (envName)
            vars[envName] = value;
        else if (SERVER_RESOLVED_PROVIDERS.has(provider))
            serverResolved.push(provider);
        else
            skipped.push(provider);
    }
    return { vars, serverResolved, skipped };
}
function formatEnvValue(value) {
    if (/[\s#'"]/.test(value)) {
        return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
}
