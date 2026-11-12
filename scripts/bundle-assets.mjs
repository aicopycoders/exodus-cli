// Copies the skill + reference sources from the monorepo into the package's
// assets/ dir so they ship inside the npm tarball. Run by `prepack` (before
// npm packs/publishes) and on demand via `npm run bundle-assets`.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const exodusDir = dirname(dirname(fileURLToPath(import.meta.url))); // exodus/
const repoRoot = dirname(exodusDir);
const skillsSrc = join(repoRoot, "workspace", ".claude", "skills");
const refsSrc = join(repoRoot, "workspace", "references");
const docSrcs = [
  join(repoRoot, "workspace", "CLAUDE.md"),
  join(repoRoot, "workspace", "PIPELINES.md"),
];
const standardsSrc = join(repoRoot, "workspace", "STANDARDS.md");

const assetsDir = join(exodusDir, "assets");
const skillsDest = join(assetsDir, "skills");
const refsDest = join(assetsDir, "references");
const docsDest = join(assetsDir, "docs");
const templatesDest = join(assetsDir, "templates");

// ── Forbidden patterns (client-name leak-check) ───────────────────────────
const FORBIDDEN = [/grounding co\b/i, /grounding company/i, /matt beard/i];

// ── Member-facing references allowlist ────────────────────────────────────
// workspace/references/ doubles as a drop zone for internal research notes
// (wayfinder probes, vendor comparisons) that must never ship to members.
// Only the framework docs the workspace CLAUDE.md points members at are
// bundled; everything else is skipped by default (2026.7.200-beta.7 shipped
// five internal docs, one with client data, because this copied the whole dir).
const MEMBER_REFERENCES = new Set([
  "awareness-framework.md",
  "cast-video.md",
  "copy-blocks.md",
  "creative-strategy.md",
  "editing-rules.md",
  "hook-quality-checklist.md",
  "iterations.md",
  "scrawls.md",
  "segments.md",
]);

/** Recursively yield all file paths under dir. */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

// ── Copy skills ──────────────────────────────────────────────────────────
if (!existsSync(skillsSrc)) {
  if (existsSync(skillsDest)) {
    // Public-repo layout: assets already bundled, no monorepo workspace present.
    console.log(
      "bundle-assets: source absent, assets already present — skipping copy"
    );
    // Fall through to leak-check below.
  } else {
    // Neither source nor existing assets: hard error.
    console.error(`bundle-assets: skill source not found at ${skillsSrc}`);
    process.exit(1);
  }
} else {
  // Monorepo layout: (re)build assets from source.
  rmSync(assetsDir, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });

  cpSync(skillsSrc, skillsDest, {
    recursive: true,
    filter: (src) => !/__pycache__|\.pyc$/.test(src),
  });
  if (existsSync(refsSrc)) {
    mkdirSync(refsDest, { recursive: true });
    const skipped = [];
    for (const entry of readdirSync(refsSrc, { withFileTypes: true })) {
      if (entry.isFile() && MEMBER_REFERENCES.has(entry.name)) {
        cpSync(join(refsSrc, entry.name), join(refsDest, entry.name));
      } else {
        skipped.push(entry.name);
      }
    }
    if (skipped.length > 0) {
      console.log(
        `bundle-assets: skipped non-member references: ${skipped.join(", ")}`
      );
    }
  }

  mkdirSync(docsDest, { recursive: true });
  for (const docSrc of docSrcs) {
    if (existsSync(docSrc)) cpSync(docSrc, join(docsDest, basename(docSrc)));
  }

  if (existsSync(standardsSrc)) {
    mkdirSync(templatesDest, { recursive: true });
    cpSync(standardsSrc, join(templatesDest, "STANDARDS.md"));
  }

  console.log(`bundle-assets: copied skills + docs -> ${assetsDir}`);
}

if (!existsSync(join(templatesDest, "STANDARDS.md"))) {
  console.error(
    "bundle-assets: assets/templates/STANDARDS.md is missing — members would get no taste file (source: workspace/STANDARDS.md)"
  );
  process.exit(1);
}

// ── Leak-check: scan every file in assetsDir ────────────────────────────
const offenders = [];
if (existsSync(assetsDir)) {
  for (const filePath of walk(assetsDir)) {
    try {
      const text = readFileSync(filePath, "utf8");
      if (FORBIDDEN.some((re) => re.test(text))) {
        offenders.push(filePath);
      }
    } catch {
      // Binary or unreadable — skip.
    }
  }
}

if (offenders.length > 0) {
  console.error("bundle-assets: forbidden client literal found in bundled output:");
  for (const f of offenders) console.error("  " + f);
  console.error(
    "bundle-assets: forbidden client literal found in bundled output (see above) — neutralize before publishing"
  );
  process.exit(1);
}

console.log("bundle-assets: leak-check passed");

// ── Kit text check: a kit's prompt text stays on the server ───────────────
// The check of video/lib/__tests__/kits-not-shipped.test.ts, without the test
// runner, on what this package ships: no sentence of the kit text
// (video/lib/kits/index.ts lists its files) in any file npm packs, that is the
// paths package.json "files" names (the built dist/ and the assets/ above)
// plus package.json and README. It runs in the monorepo, known by the check or
// by the kit list being there, whether or not the skills are; there a missing
// check or a missing kit list stops the pack instead of turning the check off.
// The public release repo has neither: scripts/sync-public-cli.sh bundles and
// checks the assets in the monorepo, then checks what it copied there before it
// commits.
const kitGuard = join(repoRoot, "scripts", "kit-text.mjs");
const kitIndex = join(repoRoot, "video", "lib", "kits", "index.ts");
if (existsSync(kitGuard) || existsSync(kitIndex)) {
  let describeHit, result;
  try {
    const guard = await import(pathToFileURL(kitGuard).href);
    describeHit = guard.describeHit;
    result = guard.packedKitText(repoRoot);
  } catch (error) {
    console.error(`bundle-assets: the kit text check could not run: ${error?.message ?? error}`);
    process.exit(1);
  }
  const { sentences, files, hits } = result;
  if (hits.length > 0) {
    console.error("bundle-assets: kit prompt text found in files this package ships:");
    for (const hit of hits) console.error("  " + describeHit(hit));
    console.error(
      "bundle-assets: kit text stays on the server. Take the sentences above out of those files, then pack again."
    );
    process.exit(1);
  }
  console.log(
    `bundle-assets: kit text check passed (${sentences} sentences, ${files} files the package ships)`
  );
} else {
  console.log(
    "bundle-assets: kit text check skipped: no kit sources here (the assets were checked when they were bundled in the monorepo)"
  );
}
