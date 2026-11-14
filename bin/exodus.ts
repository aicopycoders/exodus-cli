#!/usr/bin/env node

// Load workspace .env BEFORE any module that may read process.env at import
// time. ES module imports are hoisted, so this runs before commands/* are
// dynamically imported. (S-N28: tester reported `EXODUS_SCOUT_CLIENT` in
// `.env` was being ignored because the CLI never read .env — only shell
// exports were respected.)
import { loadWorkspaceEnv } from "../lib/load-env.js";
loadWorkspaceEnv();

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getVersion } from "../lib/version.js";
import { parseArgs, type FlagOccurrence } from "../lib/args.js";

// Commands that are utilities rather than generative pipelines. Everything else
// present on disk is grouped under "Pipeline Commands".
const OTHER_COMMANDS = new Set([
  "browse",
  "status",
  "read-doc",
  "whoami",
  "brand",
  "primer",
  "foundation",
  "drive",
  "doctor",
  "init",
  "update",
  "migrate",
  "segment",
  "workflow",
  "session",
  "bank",
  "hooks",
  // Read-only windows on the brand's own synced Meta ads (#1627). They read
  // stored data rather than generating anything, so they belong beside `hooks`.
  "ads",
  "comments",
]);

// Commands kept runnable (back-compat / power users) but hidden from the
// top-level --help Pipeline list.
// `image` is the front door for static-image creation; `creative` and
// `template` are its engines — drive them via `exodus image` or call them
// directly with `exodus creative …` / `exodus template …`.
// `idea` (Idea Bank) and `swipe` (competitor watchlist) front the deferred
// "write from a source other than a brief" surface — only brief-mode writing
// ships today, so they stay runnable for power users but are unadvertised
// until that layer is production-ready.
// `video` is for admins and video beta testers only (#958, #3251). Most members
// have neither, so listing it would offer them a door they can't open; the
// people who can use it reach it through `exodus video --help` and the skill.
const HIDDEN_COMMANDS = new Set([
  "creative",
  "template",
  "idea",
  "swipe",
  "video",
]);

// Curated examples; each is shown only if its leading command is installed.
const EXAMPLES = [
  'exodus genesis run --brief "joint pain relief in 30 days" --variants 6',
  'exodus genesis run --brief brief.txt --seeds seeds.txt',
  'exodus image --ad "grounding sheets reduce inflammation"',
  'exodus image --type template --input "1. first ad ... 2. second ad ..."',
  'exodus image --type ref-match --refs k57abc123,k57def456 --subject "morning routine"',
  'exodus template ad-types',
  'exodus meme recommend --brief "grounding sheets reduce inflammation"',
  'exodus meme run --brief "grounding sheets reduce inflammation" --formats \'[...]\'',
  'exodus browse',
  'exodus hooks list --min-score 10',
  'exodus ads list --sort cost-per-result',
  'exodus comments list --ad <adId>',
  'exodus status --id <runId> --type genesis',
];

function installedCommands(): string[] {
  const here = dirname(fileURLToPath(import.meta.url)); // dist/bin
  const cmdDir = join(here, "..", "commands"); // dist/commands
  try {
    return readdirSync(cmdDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

// Derive a one-line summary from a command's own helpText first line, which is
// consistently formatted as "exodus <cmd> — <description>".
function summaryOf(helpText: string | undefined): string {
  if (!helpText) return "";
  const firstLine = helpText.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  const m = firstLine.match(/—\s*(.+)$/);
  return m ? m[1].trim() : "";
}

async function buildHelp(): Promise<string> {
  const names = installedCommands().sort();
  const present = new Set(names);

  const pipeline: Array<[string, string]> = [];
  const other: Array<[string, string]> = [];
  for (const name of names) {
    // Hidden commands stay runnable but are omitted from the help listing.
    if (HIDDEN_COMMANDS.has(name)) continue;
    let summary = "";
    try {
      const mod = await import(`../commands/${name}.js`);
      summary = summaryOf(mod.helpText);
    } catch {
      /* skip a command that fails to load rather than breaking help */
    }
    (OTHER_COMMANDS.has(name) ? other : pipeline).push([name, summary]);
  }
  other.push(["help", "Show this help message"]);

  const fmt = (rows: Array<[string, string]>) =>
    rows.map(([n, s]) => `  ${n.padEnd(18)} ${s}`.trimEnd()).join("\n");

  const commonOptions = [
    "Common Options:",
    "  --awareness <level>    Awareness level: unaware, problem-aware, solution-aware, product-aware, most-aware",
    "  --wait                 Wait for completion (default)",
    "  --no-wait              Return immediately after starting",
    "  --help, -h             Show help (top-level or per-subcommand)",
    "  --version, -v          Print the installed exodus version",
  ].join("\n");

  const examples = EXAMPLES.filter((ex) => {
    const cmd = ex.replace(/^exodus\s+/, "").split(/\s+/)[0];
    return present.has(cmd);
  });

  // Each section is a block; blank-filtered then joined with a blank line so an
  // absent optional section (e.g. multi-phase on a base install) leaves no gap.
  const sections = [
    [
      "exodus — CLI for the Viral Ad Dashboard API",
      "",
      "Usage:",
      "  exodus <command> [options]",
      "  exodus <command> --help",
    ].join("\n"),
    `Pipeline Commands:\n${fmt(pipeline)}`,
    `Other Commands:\n${fmt(other)}`,
    commonOptions,
    `Examples:\n${examples.map((e) => `  ${e}`).join("\n")}`,
  ];

  return sections.filter((s) => s.trim() !== "").join("\n\n");
}

async function main() {
  const { command, flags, occurrences } = parseArgs(process.argv);

  // Version: handled before dispatch so `--version`/`-v` isn't treated as a command.
  if (["--version", "-v", "-V", "version"].includes(command)) {
    console.log(getVersion());
    return;
  }

  // Top-level help: no command, "help" command, or --help without a subcommand.
  // Printing paths return instead of process.exit: on macOS a pipe is written
  // asynchronously, and exiting right after console.log cut `exodus video --help`
  // read through a pipe at 8192 bytes. Returning lets Node flush stdout first.
  if (!command || command === "help") {
    console.log(await buildHelp());
    return;
  }

  let commandModule: {
    run: (
      flags: Record<string, string | boolean>,
      occurrences: FlagOccurrence[],
    ) => Promise<void>;
    helpText?: string;
    /** COP-345: the part of helpText for the subcommand on the command line, or null for the whole. */
    subcommandHelp?: () => string | null;
  };
  try {
    commandModule = await import(`../commands/${command}.js`);
  } catch {
    console.error(`Unknown command: "${command}"\n`);
    console.log(await buildHelp());
    process.exitCode = 1;
    return;
  }

  // Per-subcommand help: `exodus <cmd> --help`, and `exodus <cmd> <sub> --help` where the module can tell its part (COP-345).
  if (flags["help"] === true) {
    if (commandModule.helpText) {
      console.log(commandModule.subcommandHelp?.() ?? commandModule.helpText);
    } else {
      console.log(`No detailed help is available for "${command}" yet.\n`);
      console.log(await buildHelp());
    }
    return;
  }

  if (typeof commandModule.run !== "function") {
    console.error(`Command "${command}" does not export a run() function.`);
    process.exit(1);
  }

  await commandModule.run(flags, occurrences);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
