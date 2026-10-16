import { apiGet, getApiUrl } from "../lib/client.js";
import { resolveActiveBrand } from "../lib/layout.js";
import { auth401Hint, describeServer } from "../lib/backend-hint.js";

interface WhoamiResponse {
  userId: string | null;
  userEmail: string | null;
  userRole: "admin" | "member" | null;
  keyPrefix: string | null;
  workspaceId: string | null;
  workspaceSlug: string | null;
  workspaceName: string | null;
  foundationReady: boolean;
  foundationMissing: string[];
}

export const helpText = `
exodus whoami — show identity and brand context for the current API key

Usage:
  exodus whoami

Reads EXODUS_API_KEY from your .env (or env var) and asks the dashboard which
workspace this key is bound to. Prints:
  • Server (the EXODUS_API_URL host it talks to, and whether that is live or dev)
  • Brand (workspace slug + name)
  • User email + role
  • Whether the brand has full Genesis foundation knowledge filled in

Run this BEFORE any pipeline command to confirm you're pointed at the right
brand. If "foundation: NOT READY" appears, ask an admin to complete the
brand's foundation in the dashboard at Library → Materials → Primers
(/library/materials?section=primer).
`.trim();

export async function run(): Promise<void> {
  const res = await apiGet<WhoamiResponse>("/api/v2/whoami");
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.error(auth401Hint(getApiUrl()));
    } else {
      const message =
        (res.data as { error?: string } | null)?.error ??
        `whoami failed (HTTP ${res.status})`;
      console.error(message);
    }
    process.exit(1);
  }
  const d = res.data;
  const ready = d.foundationReady ? "READY" : "NOT READY";
  const missing = d.foundationMissing.length
    ? `\n  missing:    ${d.foundationMissing.join(", ")}`
    : "";
  // Owners and admins can both steer the brand now (folder or pointer);
  // show the local resolution whenever one is set.
  const resolved = resolveActiveBrand();
  const sourceNote =
    resolved.source === "folder" ? " (brand folder)" : "";
  const activeLine = resolved.slug
    ? `\nactive:     ${resolved.slug}${sourceNote}${
        resolved.slug !== d.workspaceSlug ? "  ← X-Active-Brand override" : ""
      }`
    : d.userRole === "admin"
      ? `\nactive:     (key default)`
      : "";
  console.log(`
server:     ${describeServer(getApiUrl())}
brand:      ${d.workspaceName ?? "—"} (${d.workspaceSlug ?? "—"})
user:       ${d.userEmail ?? "—"} (${d.userRole ?? "—"})
key:        ${d.keyPrefix ?? "—"}${activeLine}
foundation: ${ready}${missing}
`.trim());
}
