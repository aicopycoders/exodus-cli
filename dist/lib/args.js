export function parseArgs(argv) {
    const [, , rawCommand = "help", ...rest] = argv;
    const command = ["--help", "-h", "-help"].includes(rawCommand) ? "help" : rawCommand;
    const flags = {};
    const occurrences = [];
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
            occurrences.push(eq === -1
                ? { flag: key, value: next }
                : { flag: key.slice(0, eq), value: key.slice(eq + 1) });
            if (key.startsWith("no-")) {
                flags[key.slice(3)] = false;
                i++;
            }
            else if (next !== undefined && !next.startsWith("--") && next !== "-h") {
                flags[key] = next;
                i += 2;
            }
            else {
                flags[key] = true;
                i++;
            }
        }
        else {
            i++;
        }
    }
    return { command, flags, occurrences };
}
