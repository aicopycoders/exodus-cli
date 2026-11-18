import { PROVIDER_ENV_MAP, SERVER_RESOLVED_PROVIDERS, fetchRemoteKeys, mapKeysToEnvVars, resolveEnvFilePath, upsertEnvVars, } from "../lib/keys-sync.js";
export const helpText = `
exodus keys — sync your provider API keys from the dashboard to local .env

You enter your keys once in the dashboard (Settings → Claude Code): your provider
LLM key (Anthropic or OpenRouter) plus Kie.ai. This command pulls them down
(decrypted, scoped to you) and writes them into the workspace .env so the local
manual-Genesis path (the genesis-bots skill calls bots with your provider key)
and other local tools have them — you never have to edit .env by hand.

Usage:
  exodus keys status     Show which keys are set in the dashboard vs locally
  exodus keys pull       Pull your dashboard keys into the workspace .env

Notes:
  • Uses your EXODUS_API_KEY (.env) to authenticate — run 'exodus whoami' first
    if you're unsure which account you're on.
  • Values are never printed. Only key names and statuses are shown.
  • 'pull' preserves every other line in your .env and only upserts the keys.
`.trim();
const PROVIDER_LABEL = {
    genesis: "Genesis",
    anthropic: "Anthropic",
    openrouter: "OpenRouter",
    elevenlabs: "ElevenLabs",
    kie: "Kie.ai",
    imgflip: "Imgflip",
    scrapecreators: "ScrapeCreators",
    apify: "Apify",
    browserbase: "Browserbase",
    fal: "fal.ai",
};
async function status() {
    let remote;
    try {
        remote = await fetchRemoteKeys();
    }
    catch (e) {
        console.error(`Could not reach the dashboard: ${e.message}`);
        process.exit(1);
        return;
    }
    console.log("Pipeline keys\n");
    const providers = Object.keys(PROVIDER_ENV_MAP);
    for (const provider of providers) {
        const inDashboard = provider in remote.keys;
        const envName = PROVIDER_ENV_MAP[provider];
        const localSet = !!process.env[envName];
        const label = (PROVIDER_LABEL[provider] ?? provider).padEnd(11);
        const dash = inDashboard ? "dashboard ✓" : "dashboard —";
        const local = localSet ? "local ✓" : "local —";
        console.log(`  ${label} ${dash}   ${local}   (${envName})`);
    }
    for (const provider of SERVER_RESOLVED_PROVIDERS) {
        const inDashboard = provider in remote.keys;
        const label = (PROVIDER_LABEL[provider] ?? provider).padEnd(11);
        const dash = inDashboard ? "dashboard ✓" : "dashboard —";
        console.log(`  ${label} ${dash}   server-side   (Settings → Keys; no .env)`);
    }
    if (remote.failed.length) {
        console.log(`\n⚠ Could not decrypt: ${remote.failed.join(", ")} — re-save in the dashboard.`);
    }
    console.log(`\nRun 'exodus keys pull' to write dashboard keys into your .env.`);
}
async function pull() {
    let remote;
    try {
        remote = await fetchRemoteKeys();
    }
    catch (e) {
        console.error(`Could not reach the dashboard: ${e.message}`);
        process.exit(1);
        return;
    }
    const count = Object.keys(remote.keys).length;
    if (count === 0) {
        console.log("No keys are set in the dashboard yet. Add them at Settings → Pipeline Keys, then run this again.");
        if (remote.failed.length) {
            console.log(`(Could not decrypt: ${remote.failed.join(", ")}.)`);
        }
        return;
    }
    const { vars, serverResolved, skipped } = mapKeysToEnvVars(remote.keys);
    const envPath = resolveEnvFilePath();
    const results = upsertEnvVars(envPath, vars);
    const added = results.filter((r) => r.action === "added").map((r) => r.name);
    const updated = results.filter((r) => r.action === "updated").map((r) => r.name);
    const unchanged = results.filter((r) => r.action === "unchanged").map((r) => r.name);
    console.log(`Synced ${results.length} key(s) → ${envPath}\n`);
    if (added.length)
        console.log(`  added:     ${added.join(", ")}`);
    if (updated.length)
        console.log(`  updated:   ${updated.join(", ")}`);
    if (unchanged.length)
        console.log(`  unchanged: ${unchanged.join(", ")}`);
    if (serverResolved.length) {
        console.log(`  dashboard: ${serverResolved.join(", ")} — used server-side from Settings → Keys; no .env entry needed.`);
    }
    if (skipped.length) {
        console.log(`  skipped:   ${skipped.join(", ")} (no known env var mapping)`);
    }
    if (remote.failed.length) {
        console.log(`\n⚠ Could not decrypt: ${remote.failed.join(", ")} — re-save in the dashboard.`);
    }
}
export async function run() {
    const sub = process.argv.slice(2)[1] ?? "status";
    if (sub === "pull")
        return pull();
    if (sub === "status")
        return status();
    console.error(`Unknown 'keys' sub-action: "${sub}"`);
    console.error("Usage: exodus keys status | exodus keys pull");
    process.exit(1);
}
