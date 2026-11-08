import fs from "node:fs";
import path from "node:path";
import { apiDeleteDashboard, apiGetDashboard, apiPostDashboard } from "../lib/client.js";
import {
  sniffImageType,
  sniffBrollType,
  BRAND_IMAGE_MAX_BYTES,
  BROLL_KIT_MAX_BYTES,
} from "../lib/image-sniff.js";
import { probeDurationSec } from "../lib/preflight.js";
import {
  getActiveBrand,
  setActiveBrand,
  clearActiveBrand,
  findWorkspaceRoot,
} from "../lib/state.js";
import {
  detectLayout,
  ensureBrandDir,
  resolveActiveBrand,
  brandStateDir,
  brandDirFor,
} from "../lib/layout.js";
import { promptYesNo } from "../lib/prompts.js";
import { pkgRef } from "../lib/channel.js";

const AUTO_END_MARKER =
  "<!-- exodus:auto-section-end — manual brand notes below survive `brand use` refreshes -->";

// #3918: kinds a member uploads into the B-roll kit (convex/lib/brollKit.ts
// BROLL_KIT_UPLOAD_KINDS). Logos and product photos come from the brand record.
const BROLL_KIT_KINDS = ["screen", "result", "testimonial", "crew", "product", "legal"] as const;
type BrollKitKind = (typeof BROLL_KIT_KINDS)[number];
const BROLL_KIT_NEEDS_PERMISSION: readonly BrollKitKind[] = ["result", "testimonial"];
const BROLL_KINDS_HELP =
  "screen (app or site screen recording), result (client result), testimonial,\n" +
  "                                crew (crew or job-site footage), product (in hand or in use), legal";

export const helpText = `
exodus brand — list, switch, and inspect brands available to your CLI

Subcommands:
  exodus brand list             Show all brands your key has access to
  exodus brand create "<name>"  Create a new brand you own and switch into it
  exodus brand use <slug>       Set the active brand for this CLI
  exodus brand current          Print the active brand
  exodus brand clear            Stop overriding the brand (use the key's default)
  exodus brand delete <slug>    Delete a brand you own (asks before removing the local folder)
  exodus brand images add <files...> --kind founder|product|reference
                                Upload brand-identity images (png/jpg/webp, max 15MB each)
  exodus brand images list      Show the active brand's uploaded identity images
  exodus brand broll add <file> --kind <kind> --what "<what it shows>" [--permission]
                                Add a clip or picture to the brand's B-roll kit
                                (mp4/mov/webm up to 200MB, png/jpg/webp up to 15MB).
                                Kinds: ${BROLL_KINDS_HELP}
                                --permission (put it after the file) says you may show
                                the person; required for result and testimonial
  exodus brand broll list       Show the B-roll kit (your logo and product photos count too)
  exodus brand broll remove <id>
                                Remove one kit item (ids come from broll list)
  exodus brand show             Show the active brand's two business-type tags
  exodus brand set --sells <product|service|app|expertise|finance|other>
                   --promise <body|money|neither>
                                Change those tags (either flag alone is fine)

Any user can create and own unlimited brands (\`brand create\`) — you do NOT
need to be an admin, and brands are scoped to you (two users can have the
same brand name). Your key gives access to every brand you own; switch with
\`brand use\` (admins also see every brand). The only "locked to one brand"
case is a brand someone ELSE invited you into: you don't own it, so it's the
single brand your key sees and you can't switch away from it.

When the active brand is set, every CLI command (genesis, image, creative,
foundation, etc.) targets it via the X-Active-Brand header. In a
multi-brand install, running a command from inside a brand's subfolder
targets that brand automatically — the folder wins over \`brand use\`.
The dashboard's brand-switcher in the top-right is independent — your
CLI active brand and your dashboard active brand can differ.
`.trim();

interface Brand {
  id: string;
  slug: string;
  name: string;
  owned?: boolean;
}

interface MineResp {
  role: "admin" | "member" | "unknown";
  activeBrandId: string | null;
  activeBrandSlug: string | null;
  brands: Brand[];
}

interface ApiError {
  error?: string;
  hint?: string;
  detail?: string;
}

function fail(msg: string, code = 1): never {
  console.error(`exodus brand: ${msg}`);
  process.exit(code);
}

// Exported so `exodus init` can sync brand folders from the same list.
export async function fetchMine(): Promise<MineResp> {
  const res = await apiGetDashboard<MineResp | ApiError>("/api/brands/mine");
  if (!res.ok) {
    const body = res.data as ApiError;
    fail(body?.hint ?? body?.error ?? `HTTP ${res.status}`);
  }
  return res.data as MineResp;
}

// Like fetchMine but THROWS instead of process.exit — for callers that degrade gracefully.
export async function fetchMineOrThrow(): Promise<MineResp> {
  const res = await apiGetDashboard<MineResp | ApiError>("/api/brands/mine");
  if (!res.ok) {
    const body = res.data as ApiError;
    throw new Error(body?.hint ?? body?.error ?? `HTTP ${res.status}`);
  }
  return res.data as MineResp;
}

async function runList(): Promise<void> {
  const data = await fetchMine();
  const resolved = resolveActiveBrand();
  const effective = resolved.slug ?? data.activeBrandSlug;

  if (data.brands.length === 0) {
    console.log("No brands available for this key.");
    if (data.role === "member") {
      console.log("Ask an admin to assign you to a brand in Settings → Team.");
    }
    return;
  }

  console.log(`\nRole: ${data.role}`);
  const sourceNote =
    resolved.source === "folder" ? " (from this brand folder)" : "";
  console.log(
    `Active: ${effective ?? "(none — using key default)"}${sourceNote}\n`,
  );

  const slugWidth = Math.max(...data.brands.map((b) => b.slug.length), 4);
  for (const b of data.brands) {
    const marker = b.slug === effective ? "★" : " ";
    console.log(`  ${marker} ${b.slug.padEnd(slugWidth)}  ${b.name}`);
  }

  if (resolved.source === "folder") {
    const pointer = getActiveBrand();
    if (pointer && pointer !== resolved.slug) {
      console.log(
        `\nNote: you're inside the "${resolved.slug}" brand folder, which`,
      );
      console.log(
        `overrides the \`brand use\` pointer ("${pointer}") while you're here.`,
      );
    }
  }

  if (effective && !data.brands.some((b) => b.slug === effective)) {
    console.log(
      `\n⚠ Active brand "${effective}" is set locally but you don't have access to it.`,
    );
    console.log(`  Run \`exodus brand use <slug>\` to pick a different brand,`);
    console.log(`  or \`exodus brand clear\` to fall back to the key default.`);
  }
  console.log("");
}

interface ProfileMdResp {
  brandName: string;
  brandSlug: string;
  autoSection: string;
  manualTemplate: string;
}

// Exported so `exodus primer` can refresh the local profile after a save
// (Max R3 #5) and so `exodus init` can refresh EVERY brand folder's
// profile — keeping the write logic in one place rather than a new lib file.
// Pass opts.slug to refresh a specific brand (the request is pinned to that
// brand via X-Active-Brand and the file lands in that brand's state dir);
// omit it to refresh the active brand.
export async function refreshBrandProfileMd(opts?: { slug?: string }): Promise<{
  written: boolean;
  pathRel: string;
  reason?: string;
}> {
  const res = await apiGetDashboard<ProfileMdResp | ApiError>(
    "/api/brands/profile-md",
    opts?.slug ? { activeBrandOverride: opts.slug } : undefined,
  );
  const root = findWorkspaceRoot();
  const stateDir = brandStateDir({ slug: opts?.slug, root });
  const filePath = path.join(stateDir, "brand-profile.md");
  const pathRel = path.relative(root, filePath);

  if (!res.ok) {
    const body = res.data as ApiError;
    return {
      written: false,
      pathRel,
      reason: body?.hint ?? body?.error ?? `HTTP ${res.status}`,
    };
  }
  const data = res.data as ProfileMdResp;

  // Build the new file contents:
  //   - file missing → auto section + default manual template
  //   - file has marker → replace everything above the marker, preserve below
  //   - file present without marker → prepend auto section + marker; treat
  //     the existing file as the manual section
  let next: string;
  if (!fs.existsSync(filePath)) {
    next = `${data.autoSection}\n${data.manualTemplate}`;
  } else {
    const existing = fs.readFileSync(filePath, "utf-8");
    const idx = existing.indexOf(AUTO_END_MARKER);
    if (idx >= 0) {
      const manual = existing.slice(idx + AUTO_END_MARKER.length);
      next = `${data.autoSection}${manual}`;
    } else {
      next = `${data.autoSection}\n\n${existing.trimStart()}`;
    }
  }

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(filePath, next, "utf-8");
  return { written: true, pathRel };
}

async function runUse(slug: string): Promise<void> {
  if (!slug) fail("missing slug. usage: exodus brand use <slug>");
  const data = await fetchMine();
  const match = data.brands.find((b) => b.slug === slug);
  if (!match) {
    const available = data.brands.map((b) => b.slug).join(", ") || "(none)";
    fail(`brand "${slug}" is not in your accessible list. available: ${available}`);
  }
  setActiveBrand(slug);
  console.log(`✓ Active brand set to ${slug} (${match.name}).`);

  // Multi-brand layout: make sure the brand's subfolder exists so its
  // profile/outputs have a home. No-op in legacy installs.
  const root = findWorkspaceRoot();
  if (detectLayout(root) === "v2") {
    const ensured = ensureBrandDir(root, { slug, name: match.name });
    if (ensured.created) {
      console.log(
        `✓ Created brand folder ${path.relative(root, ensured.dir) || ensured.dir}/.`,
      );
    }
  }

  const refresh = await refreshBrandProfileMd({ slug });
  if (refresh.written) {
    console.log(`✓ Refreshed ${refresh.pathRel} from the dashboard foundation.`);
  } else {
    console.log(
      `⚠ Could not refresh ${refresh.pathRel}: ${refresh.reason}.`,
    );
    console.log(
      "  The brand was switched locally; Genesis may use stale brand context",
    );
    console.log("  until you re-run `exodus brand use` with network access.");
  }

  const resolved = resolveActiveBrand();
  if (resolved.source === "folder" && resolved.slug !== slug) {
    console.log(
      `\nHeads up: you're currently inside the "${resolved.slug}" brand folder,`,
    );
    console.log(
      `which takes precedence while you're here. Commands run from this folder`,
    );
    console.log(`still target ${resolved.slug}; run from the install root (or`);
    console.log(`the ${slug} folder) to target ${slug}.`);
  }
}

interface CreateResp {
  workspaceId?: string;
  slug?: string;
  name?: string;
  error?: string;
}

async function runCreate(name: string): Promise<void> {
  if (!name) fail('missing name. usage: exodus brand create "<name>"');

  const res = await apiPostDashboard<CreateResp>("/api/brands/create", { name });
  if (!res.ok || !res.data?.slug) {
    fail(res.data?.error ?? `HTTP ${res.status}`);
  }
  const slug = res.data.slug;
  const createdName = res.data.name ?? name;
  console.log(`✓ Brand "${createdName}" created (slug: ${slug}).`);

  // Switch the CLI into the new brand so the next command targets it.
  setActiveBrand(slug);
  console.log(`✓ Active brand set to ${slug}.`);

  // Multi-brand layout: give the brand a local folder + seed its profile, the
  // same as `brand use`. No-op in legacy single-brand installs.
  const root = findWorkspaceRoot();
  if (detectLayout(root) === "v2") {
    const ensured = ensureBrandDir(root, { slug, name: createdName });
    if (ensured.created) {
      console.log(
        `✓ Created brand folder ${path.relative(root, ensured.dir) || ensured.dir}/.`,
      );
    }
  }
  const refresh = await refreshBrandProfileMd({ slug });
  if (refresh.written) {
    console.log(`✓ Wrote ${refresh.pathRel}.`);
  }

  console.log(
    `\nNext: set up the brand's primer to unlock the pipelines —\n` +
      `  say "exodus, set up my brand primer" (or run \`npx ${pkgRef()} primer\`).`,
  );
}

interface DeleteResp {
  deletedSlug?: string;
  cascadedApiKeys?: number;
  cascadedInvites?: number;
  error?: string;
}

async function runDelete(
  slug: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (!slug) fail("missing slug. usage: exodus brand delete <slug>");
  const skipConfirm = flags.yes === true || flags.y === true;
  const purgeLocal = flags["purge-local"] === true || skipConfirm;

  if (!skipConfirm) {
    const ok = await confirmSlugTyped(slug);
    if (!ok) {
      console.log("Aborted — nothing was deleted.");
      return;
    }
  }

  const res = await apiPostDashboard<DeleteResp>("/api/brands/delete", {
    slug,
    confirmSlug: slug,
  });
  if (!res.ok) {
    fail(res.data?.error ?? `HTTP ${res.status}`);
  }
  console.log(`✓ Brand '${slug}' deleted (server).`);

  if (getActiveBrand() === slug) {
    clearActiveBrand();
    console.log("✓ Cleared local active-brand pointer (it pointed at this brand).");
  }

  const root = findWorkspaceRoot();
  if (detectLayout(root) === "v2") {
    const dir = brandDirFor(root, slug);
    if (fs.existsSync(dir)) {
      const rel = path.relative(root, dir) || dir;
      const remove = purgeLocal
        ? true
        : await promptYesNo(`Also remove the local folder ${rel}/?`, false);
      if (remove) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`✓ Removed local folder ${rel}/.`);
      } else {
        console.log(`ℹ Left local folder ${rel}/ in place — delete it yourself if you don't need the files.`);
      }
    }
  }
}

// Type the brand slug to confirm a destructive delete.
async function confirmSlugTyped(slug: string): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((resolve) => {
      rl.question(
        `This permanently deletes the brand "${slug}".\nType "${slug}" to confirm: `,
        resolve,
      );
    });
    return answer.trim() === slug;
  } finally {
    rl.close();
  }
}

function runCurrent(): void {
  const resolved = resolveActiveBrand();
  if (resolved.slug) {
    const source =
      resolved.source === "folder"
        ? "from this brand folder"
        : "from `brand use`";
    console.log(`${resolved.slug} (${source})`);
    if (resolved.source === "folder") {
      const pointer = getActiveBrand();
      if (pointer && pointer !== resolved.slug) {
        console.log(`pointer: ${pointer} (overridden while inside this folder)`);
      }
    }
  } else {
    console.log("(none — falling back to the key's default brand)");
  }
}

// Same words the dashboard shows (convex/lib/brandTags.ts). Kept here because
// the CLI is published on its own and cannot import from convex/.
const WHAT_YOU_SELL_LABELS = {
  product: "Products we ship",
  service: "A service our people do in person",
  app: "An app or software",
  expertise: "Coaching, courses or expert help",
  finance: "Insurance, loans or investing",
  other: "Something else",
} as const;

const AD_PROMISE_LABELS = {
  body: "A better body, health or looks",
  money: "Money: income, a payout, debt relief or investment returns",
  neither: "Neither",
} as const;

type WhatYouSell = keyof typeof WHAT_YOU_SELL_LABELS;
type AdPromise = keyof typeof AD_PROMISE_LABELS;

interface TagsResp {
  name: string;
  whatYouSell: WhatYouSell | null;
  adPromise: AdPromise | null;
  setBy: "ai" | "member" | null;
  unsure: true | null;
}

const SET_HINT =
  "Change them with: exodus brand set --sells <product|service|app|expertise|finance|other> --promise <body|money|neither>";

function printTags(t: TagsResp): void {
  console.log(`Brand: ${t.name}`);
  if (!t.whatYouSell || !t.adPromise) {
    console.log("Business type: not set yet. The video will guess from your script.");
    console.log(SET_HINT);
    return;
  }
  console.log(`What you sell: ${WHAT_YOU_SELL_LABELS[t.whatYouSell]} (${t.whatYouSell})`);
  console.log(`What the ad promises: ${AD_PROMISE_LABELS[t.adPromise]} (${t.adPromise})`);
  if (t.setBy === "member") {
    console.log("Set by: a person on your team");
  } else {
    console.log("Set by: AI, from your brand info");
    if (t.unsure) {
      console.log("Please check these. The AI had little to go on.");
    }
  }
  console.log(SET_HINT);
}

function failResponse(status: number, data: unknown): never {
  const body = data as ApiError;
  fail(body?.hint ?? body?.detail ?? body?.error ?? `HTTP ${status}`);
}

async function runShow(): Promise<void> {
  const res = await apiGetDashboard<TagsResp | ApiError>("/api/brands/tags");
  if (!res.ok) failResponse(res.status, res.data);
  printTags(res.data as TagsResp);
}

async function runSet(flags: Record<string, string | boolean>): Promise<void> {
  const body: { whatYouSell?: WhatYouSell; adPromise?: AdPromise } = {};
  if (flags.sells !== undefined) {
    if (typeof flags.sells !== "string" || !Object.hasOwn(WHAT_YOU_SELL_LABELS, flags.sells)) {
      fail(`--sells must be one of: ${Object.keys(WHAT_YOU_SELL_LABELS).join(", ")}`);
    }
    body.whatYouSell = flags.sells as WhatYouSell;
  }
  if (flags.promise !== undefined) {
    if (typeof flags.promise !== "string" || !Object.hasOwn(AD_PROMISE_LABELS, flags.promise)) {
      fail(`--promise must be one of: ${Object.keys(AD_PROMISE_LABELS).join(", ")}`);
    }
    body.adPromise = flags.promise as AdPromise;
  }
  if (!body.whatYouSell && !body.adPromise) {
    fail(`nothing to change. ${SET_HINT}`);
  }
  const res = await apiPostDashboard<TagsResp | ApiError>("/api/brands/tags", body);
  if (!res.ok) failResponse(res.status, res.data);
  console.log("✓ Saved.");
  printTags(res.data as TagsResp);
}

function runClear(): void {
  clearActiveBrand();
  console.log("✓ Cleared local active brand. Falling back to the key's default.");
  const resolved = resolveActiveBrand();
  if (resolved.source === "folder") {
    console.log(
      `Note: you're inside the "${resolved.slug}" brand folder — commands run`,
    );
    console.log("from here still target it (the folder wins over the pointer).");
  }
}

// ── Subcommand: images (DEV-2) ────────────────────────────────────
// Bearer-authed brand-identity uploads so onboarding agents never need the
// dashboard UI. Validation is content-based (magic bytes) and per-file: one
// bad file is skipped with a reason, the rest go through. Bytes go straight
// to Convex storage via minted upload URLs — they never proxy through Vercel.

const BRAND_IMAGE_KINDS = ["founder", "product", "reference"] as const;
type BrandImageKind = (typeof BRAND_IMAGE_KINDS)[number];

interface BrandImageEntry {
  storageId: string;
  url: string | null;
  size?: number;
  contentType?: string;
}

interface BrandImagesListResponse {
  brand: string;
  founder: BrandImageEntry[];
  product: BrandImageEntry[];
  reference: BrandImageEntry[];
  error?: string;
}

interface AttachResponse {
  added: number;
  skipped: { storageId: string; reason: string }[];
  total: number;
  error?: string;
}

async function runImagesAdd(
  files: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const kind = typeof flags["kind"] === "string" ? (flags["kind"] as string) : "";
  if (!BRAND_IMAGE_KINDS.includes(kind as BrandImageKind)) {
    console.error(
      `Error: brand images add requires --kind ${BRAND_IMAGE_KINDS.join("|")}. ` +
        `(Logo stays a dashboard upload — it replaces rather than appends.)`,
    );
    process.exit(1);
    return;
  }
  if (files.length === 0) {
    console.error("Error: brand images add requires at least one file.");
    process.exit(1);
    return;
  }

  // Client-side validation first: content sniff + size cap, per file.
  const valid: { file: string; buf: Buffer; mime: string }[] = [];
  const skipped: { file: string; reason: string }[] = [];
  for (const file of files) {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(file);
    } catch {
      skipped.push({ file, reason: "unreadable (does the path exist?)" });
      continue;
    }
    if (buf.length > BRAND_IMAGE_MAX_BYTES) {
      skipped.push({
        file,
        reason: `too large (${(buf.length / 1024 / 1024).toFixed(1)}MB > 15MB)`,
      });
      continue;
    }
    const sniffed = sniffImageType(buf);
    if (!sniffed) {
      skipped.push({ file, reason: "not a png/jpg/webp (content check failed)" });
      continue;
    }
    valid.push({ file, buf, mime: sniffed.mime });
  }
  for (const s of skipped) {
    console.error(`  skipped ${path.basename(s.file)}: ${s.reason}`);
  }
  if (valid.length === 0) {
    console.error("Error: no valid image files to upload.");
    process.exit(1);
    return;
  }

  // Mint one upload URL per valid file, then POST bytes straight to storage.
  const mint = await apiPostDashboard<{ urls: string[]; error?: string }>(
    "/api/brands/images/upload-url",
    { count: valid.length },
  );
  if (!mint.ok || !Array.isArray(mint.data.urls)) {
    console.error(`Error: ${mint.data.error ?? `HTTP ${mint.status} minting upload URLs`}`);
    process.exit(1);
    return;
  }
  const storageIds: string[] = [];
  const uploadedFiles: string[] = [];
  for (let i = 0; i < valid.length; i++) {
    const { file, buf, mime } = valid[i];
    try {
      const res = await fetch(mint.data.urls[i], {
        method: "POST",
        headers: { "Content-Type": mime },
        body: new Uint8Array(buf),
      });
      const body = JSON.parse(await res.text()) as { storageId?: string };
      if (!res.ok || !body.storageId) throw new Error(`HTTP ${res.status}`);
      storageIds.push(body.storageId);
      uploadedFiles.push(file);
    } catch (err) {
      console.error(
        `  skipped ${path.basename(file)}: storage upload failed (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }
  if (storageIds.length === 0) {
    console.error("Error: every storage upload failed.");
    process.exit(1);
    return;
  }

  const attach = await apiPostDashboard<AttachResponse>("/api/brands/images", {
    kind,
    storageIds,
  });
  if (!attach.ok) {
    console.error(`Error: ${attach.data.error ?? `HTTP ${attach.status} attaching images`}`);
    process.exit(1);
    return;
  }
  for (const s of attach.data.skipped ?? []) {
    console.error(`  server skipped ${s.storageId}: ${s.reason}`);
  }
  for (const f of uploadedFiles) console.log(`  uploaded ${path.basename(f)}`);
  console.log(
    `✓ ${kind}: ${attach.data.added} added (brand now has ${attach.data.total} ${kind} image${attach.data.total === 1 ? "" : "s"})`,
  );
}

async function runImagesList(): Promise<void> {
  const res = await apiGetDashboard<BrandImagesListResponse>("/api/brands/images");
  if (!res.ok) {
    console.error(`Error: ${res.data.error ?? `HTTP ${res.status}`}`);
    process.exit(1);
    return;
  }
  console.log(`brand: ${res.data.brand}`);
  for (const kind of BRAND_IMAGE_KINDS) {
    const entries = res.data[kind] ?? [];
    console.log(`${kind}: ${entries.length}`);
    for (const e of entries) {
      console.log(`  ${e.url ?? e.storageId}`);
    }
  }
}

// ── Subcommand: broll (#3918) ─────────────────────────────────────
// The brand's B-roll kit: its own clips and pictures that video ads may cut
// to. Same upload path as `brand images`: content sniff, one minted URL,
// bytes straight to Convex storage, then the route records the item.

export type BrollAddArgs =
  | { ok: true; file: string; kind: BrollKitKind; what: string; permission: boolean }
  | { ok: false; error: string };

export function parseBrollAdd(files: string[], flags: Record<string, string | boolean>): BrollAddArgs {
  if (typeof flags["permission"] === "string") {
    return { ok: false, error: "--permission takes no value; put it after the file" };
  }
  if (files.length !== 1) {
    return { ok: false, error: "brand broll add takes exactly one file" };
  }
  const kind = flags["kind"];
  if (typeof kind !== "string" || !BROLL_KIT_KINDS.includes(kind as BrollKitKind)) {
    return {
      ok: false,
      error:
        `brand broll add requires --kind ${BROLL_KIT_KINDS.join("|")}` +
        (kind === "logo" ? " (the logo is uploaded on the dashboard and is already in the kit)" : ""),
    };
  }
  const what = typeof flags["what"] === "string" ? flags["what"].trim() : "";
  if (!what) {
    return { ok: false, error: 'brand broll add requires --what "<what it shows>"' };
  }
  const permission = flags["permission"] === true;
  if (BROLL_KIT_NEEDS_PERMISSION.includes(kind as BrollKitKind) && !permission) {
    return {
      ok: false,
      error: `--kind ${kind} needs --permission: you must have permission to show this person`,
    };
  }
  return { ok: true, file: files[0], kind: kind as BrollKitKind, what, permission };
}

interface BrollKitListItem {
  id: string;
  kind: string;
  media: "video" | "image";
  description: string;
  durationSec?: number;
  url: string | null;
}

interface BrollKitListResponse {
  brand: string;
  items: BrollKitListItem[];
  logo: boolean;
  productPhotos: number;
  error?: string;
}

async function runBrollAdd(files: string[], flags: Record<string, string | boolean>): Promise<void> {
  const parsed = parseBrollAdd(files, flags);
  if (!parsed.ok) fail(`${parsed.error}`);
  const { file, kind, what, permission } = parsed;

  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    fail(`can't read ${file} (does the path exist?)`);
  }
  if (size > BROLL_KIT_MAX_BYTES.video) {
    fail(`${path.basename(file)} is too large (${(size / 1024 / 1024).toFixed(1)}MB > 200MB)`);
  }
  const buf = fs.readFileSync(file);
  const sniffed = sniffBrollType(buf);
  if (!sniffed) fail(`${path.basename(file)} is not an mp4/mov/webm video or png/jpg/webp picture`);
  if (buf.length > BROLL_KIT_MAX_BYTES[sniffed.media]) {
    fail(`${path.basename(file)} is too large (a ${sniffed.media} can be up to ${BROLL_KIT_MAX_BYTES[sniffed.media] / 1024 / 1024}MB)`);
  }
  const durationSec = sniffed.media === "video" ? probeDurationSec(file) : null;

  const mint = await apiPostDashboard<{ url?: string; receiptId?: string; error?: string }>(
    "/api/brands/broll/upload-url",
    {},
  );
  if (!mint.ok || !mint.data.url || !mint.data.receiptId) fail(`${mint.data.error ?? `HTTP ${mint.status} getting an upload URL`}`);
  const upload = await fetch(mint.data.url, {
    method: "POST",
    headers: { "Content-Type": sniffed.mime },
    body: new Uint8Array(buf),
  });
  const uploaded = (await upload.json().catch(() => ({}))) as { storageId?: string };
  if (!upload.ok || !uploaded.storageId) fail(`storage upload failed (HTTP ${upload.status})`);

  const add = await apiPostDashboard<{ id?: string; error?: string }>("/api/brands/broll", {
    storageId: uploaded.storageId,
    receiptId: mint.data.receiptId,
    kind,
    description: what,
    ...(permission ? { permission: true } : {}),
    ...(durationSec !== null ? { durationSec } : {}),
  });
  if (!add.ok) fail(`${add.data.error ?? `HTTP ${add.status} adding to the kit`}`);
  const length = durationSec !== null ? `, ${durationSec.toFixed(1)}s` : "";
  console.log(`✓ added ${path.basename(file)} as ${kind} (${sniffed.media}${length}) — id ${add.data.id}`);
}

async function runBrollList(): Promise<void> {
  const res = await apiGetDashboard<BrollKitListResponse>("/api/brands/broll");
  if (!res.ok) fail(`${res.data.error ?? `HTTP ${res.status}`}`);
  const { brand, items, logo, productPhotos } = res.data;
  console.log(`brand: ${brand}`);
  console.log(`B-roll kit: ${items.length} item${items.length === 1 ? "" : "s"}`);
  for (const item of items) {
    const length = item.durationSec !== undefined ? ` ${item.durationSec.toFixed(1)}s` : "";
    console.log(`  ${item.id}  ${item.kind} (${item.media}${length})  ${item.description}`);
  }
  console.log(`also in the kit: ${logo ? "logo, " : ""}${productPhotos} product photo${productPhotos === 1 ? "" : "s"}`);
}

async function runBrollRemove(id: string | undefined): Promise<void> {
  if (!id) fail("brand broll remove requires an item id (see brand broll list)");
  const res = await apiDeleteDashboard<{ error?: string }>(`/api/brands/broll?id=${encodeURIComponent(id)}`);
  if (!res.ok) fail(`${res.data.error ?? `HTTP ${res.status}`}`);
  console.log(`✓ removed ${id}`);
}

async function runBroll(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const sub = args[0];
  if (sub === "add") return runBrollAdd(args.slice(1), flags);
  if (sub === "list" || sub === undefined) return runBrollList();
  if (sub === "remove") return runBrollRemove(args[1]);
  fail(`broll: unknown subcommand "${sub}" (use add | list | remove)`);
}

/**
 * True positionals after `exodus brand` — walks argv with the SAME pairing
 * rules as bin/exodus.ts parseArgs, so a value-taking flag's value (`--kind
 * founder`) is skipped along with its flag. The legacy `startsWith("--")`
 * filter in run() keeps flag VALUES, which is harmless for the older
 * subcommands (their positionals precede any flags) but would turn `--kind
 * founder` into a phantom file path here.
 */
function imagesPositionals(): string[] {
  const rest = process.argv.slice(3);
  const out: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (key.startsWith("no-")) {
        i++;
      } else if (next !== undefined && !next.startsWith("--")) {
        i += 2; // value-taking flag: skip the value too
      } else {
        i++;
      }
      continue;
    }
    out.push(arg);
    i++;
  }
  return out;
}

async function runImages(
  args: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const sub = args[0];
  if (sub === "add") {
    await runImagesAdd(args.slice(1), flags);
    return;
  }
  if (sub === "list" || sub === undefined) {
    await runImagesList();
    return;
  }
  console.error(`exodus brand images: unknown subcommand "${sub}" (use add | list)`);
  process.exit(1);
}

export async function run(
  flags: Record<string, string | boolean>,
): Promise<void> {
  const positionals = process.argv.slice(3).filter((a) => !a.startsWith("--"));
  const sub = positionals[0];
  const arg = positionals[1];

  switch (sub) {
    case "images":
      await runImages(imagesPositionals().slice(1), flags);
      return;
    case "broll":
      await runBroll(imagesPositionals().slice(1), flags);
      return;
    case "list":
    case undefined:
      await runList();
      return;
    case "create":
      // Join remaining positionals so unquoted multi-word names still work
      // (`exodus brand create Matt Beard` → "Matt Beard").
      await runCreate(positionals.slice(1).join(" ").trim());
      return;
    case "use":
      await runUse(arg ?? "");
      return;
    case "delete":
      await runDelete(arg ?? "", flags);
      return;
    case "current":
      runCurrent();
      return;
    case "clear":
      runClear();
      return;
    case "show":
      await runShow();
      return;
    case "set":
      await runSet(flags);
      return;
    default:
      console.error(`exodus brand: unknown subcommand "${sub}"\n`);
      console.log(helpText);
      process.exit(1);
  }
}
