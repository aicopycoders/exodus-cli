const PROD_BACKEND = "accomplished-tapir-106";
const DEV_BACKEND = "good-cod-360";
const PLACEHOLDER_MARK = "YOUR-EXODUS-BACKEND";
export function isPlaceholderApiUrl(apiUrl) {
    return !apiUrl || apiUrl.includes(PLACEHOLDER_MARK);
}
function hostLabel(apiUrl) {
    try {
        return new URL(apiUrl).host;
    }
    catch {
        return apiUrl || "(no EXODUS_API_URL set)";
    }
}
export function describeServer(apiUrl) {
    const host = hostLabel(apiUrl);
    if (isConvexHostOf(host, PROD_BACKEND))
        return `${host} (live, xo.copycoders.ai)`;
    if (isConvexHostOf(host, DEV_BACKEND))
        return `${host} (dev, dev.xo.copycoders.ai)`;
    return host;
}
function isConvexHostOf(host, deployment) {
    return host === `${deployment}.convex.site` || host === `${deployment}.convex.cloud`;
}
export function auth401Hint(apiUrl) {
    const host = hostLabel(apiUrl);
    return [
        `This API key was rejected by ${host} (HTTP 401).`,
        `Keys are environment-bound — this key may belong to the other environment.`,
        `Set EXODUS_API_URL in your .env to match the dashboard you signed up on:`,
        `  • xo.copycoders.ai      → EXODUS_API_URL=https://${PROD_BACKEND}.convex.site`,
        `  • dev.xo.copycoders.ai  → EXODUS_API_URL=https://${DEV_BACKEND}.convex.site`,
        `Then re-run \`node exodus/dist/bin/exodus.js whoami\`.`,
    ].join("\n");
}
