import type { FlagOccurrence } from "../lib/args.js";
export declare const helpText: string;
export declare function run(flags: Record<string, string | boolean>, occurrences?: FlagOccurrence[]): Promise<void>;
