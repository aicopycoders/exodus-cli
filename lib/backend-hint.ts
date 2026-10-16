// Stable infra identifiers for the two Exodus stacks. Mirrors the dev marker
// in client.ts's DEV_BACKEND_DASHBOARDS; kept local so this module stays a
// dependency-free pure helper that doctor + whoami can both import.
const PROD_BACKEND = "accomplished-tapir-106";
const DEV_BACKEND = "good-cod-360";
const PLACEHOLDER_MARK = "YOUR-EXODUS-BACKEND";

/** True when EXODUS_API_URL is unset or still the shipped placeholder. */
export function isPlaceholderApiUrl(apiUrl: string): boolean {
  return !apiUrl || apiUrl.includes(PLACEHOLDER_MARK);
}

function hostLabel(apiUrl: string): string {
  try {
    return new URL(apiUrl).host;
  } catch {
    return apiUrl || "(no EXODUS_API_URL set)";
  }
}

/** #3237: which server a command talks to, by host, naming the two Exodus stacks. */
export function describeServer(apiUrl: string): string {
  const host = hostLabel(apiUrl);
  if (isConvexHostOf(host, PROD_BACKEND)) return `${host} (live, xo.copycoders.ai)`;
  if (isConvexHostOf(host, DEV_BACKEND)) return `${host} (dev, dev.xo.copycoders.ai)`;
  return host;
}

function isConvexHostOf(host: string, deployment: string): boolean {
  return host === `${deployment}.convex.site` || host === `${deployment}.convex.cloud`;
}

/**
 * Actionable message for an auth failure. A bare "HTTP 401" sent a prior
 * operator chasing a "dead key"; the real cause is almost always a key sent
 * to the wrong (environment-bound) backend. Name the host and give the exact
 * EXODUS_API_URL for each environment.
 */
export function auth401Hint(apiUrl: string): string {
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
