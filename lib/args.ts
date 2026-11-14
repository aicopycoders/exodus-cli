/** One `--flag` as it was typed, which is what a repeatable flag is read from. */
export interface FlagOccurrence {
  /** The name with `--` stripped and any `=value` split off: `--input=k=v` → `input`. */
  flag: string;
  /**
   * The text after `=`, or the next word. Undefined only when nothing followed.
   * A next word that is itself a flag is still recorded here, because a flag
   * that demands a value quotes what it got: `--input must be key=value (got
   * "--wait")`.
   */
  value: string | undefined;
}

export interface ParsedArgs {
  command: string;
  /**
   * Last value wins, so a repeated flag arrives here with all but its final
   * value lost, and `--key=value` arrives as the key `key=value`. Read
   * `occurrences` for anything repeatable or written with an `=`.
   */
  flags: Record<string, string | boolean>;
  /** Every `--flag` in the order typed, bar `--help`, which never reaches a command. */
  occurrences: FlagOccurrence[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [, , rawCommand = "help", ...rest] = argv;

  // Route --help/-h/-help as the command itself to the top-level help printer.
  const command = ["--help", "-h", "-help"].includes(rawCommand) ? "help" : rawCommand;

  const flags: Record<string, string | boolean> = {};
  const occurrences: FlagOccurrence[] = [];
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg === "--help" || arg === "-h") {
      flags["help"] = true;
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      const eq = key.indexOf("=");
      occurrences.push(
        eq === -1
          ? { flag: key, value: next }
          : { flag: key.slice(0, eq), value: key.slice(eq + 1) },
      );
      if (key.startsWith("no-")) {
        // --no-wait → { wait: false }
        flags[key.slice(3)] = false;
        i++;
      } else if (next !== undefined && !next.startsWith("--") && next !== "-h") {
        // `-h` is the help switch, never a flag's value: `--json -h` taking it as
        // its value left help unset, so the command ran instead of its help.
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      i++;
    }
  }

  return { command, flags, occurrences };
}
