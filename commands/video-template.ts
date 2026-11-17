import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { apiGet, apiPost, getDashboardUrl, type ApiResponse } from "../lib/client.js";
import { SUBROW_IDS, UNIVERSAL_IDS, VALUE_LIMITS, NUMBER_ROWS, STRING_LIST_ROWS, BOOLEAN_ROWS, RAW_TEXT_ROWS, validRowValue, wireObject, type SheetRow } from "../lib/template-sheet-meta.js";

type Result = { code: number; lines: string[] };
type Transport = {
  get(path: string): Promise<ApiResponse<unknown>>;
  post(path: string, body: unknown): Promise<ApiResponse<unknown>>;
  readFile(path: string): string;
  uuid(): string;
  sleep(ms: number): Promise<void>;
  dashboardUrl: string;
  /** Said at once, before the next request, on standard error (so --json output stays one document). */
  notice?(line: string): void;
};
const BASE = "/api/v2/video/";
const valueFlags = ["draft-id", "revision", "values", "phase", "operation", "max-usd", "attempt-id", "request-id"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BELOW_QUOTE_NOTICE = "This cap is below the quote: it may hold the run before the script or storyboard completes and is never topped up.";
const ids = new Set<string>([...UNIVERSAL_IDS, ...SUBROW_IDS]);
const defaults = (): Transport => ({ get: apiGet, post: apiPost, readFile: file => fs.readFileSync(file, "utf8"), uuid: randomUUID, sleep, dashboardUrl: getDashboardUrl(),
  notice: line => { process.stderr.write(`${line}\n`); } });

function sheetFrom(data: unknown) {
  const envelope = wireObject(data), sheet = wireObject(envelope.sheet ?? data);
  if (typeof sheet.sheetId !== "string" || !Number.isSafeInteger(sheet.revision) || Number(sheet.revision) < 0 || !Array.isArray(sheet.rows)) throw new Error("The server did not return a sheet and revision.");
  const rows: SheetRow[] = sheet.rows.map(item => {
    const row = wireObject(item);
    if (typeof row.id !== "string" || !ids.has(row.id) || typeof row.editable !== "boolean" || !["ready", "needs-input", "unsupported", "later"].includes(String(row.status)) || !Object.hasOwn(row, "value")) throw new Error("The server returned an invalid sheet row.");
    const editor = row.editor === undefined ? undefined : wireObject(row.editor);
    if (editor && typeof editor.kind !== "string") throw new Error("The server returned an invalid editor.");
    return { id: row.id, value: row.value, editable: row.editable, locked: row.locked === true, status: String(row.status), ...(editor ? { editor: { kind: String(editor.kind) } } : {}) };
  });
  return { sheetId: sheet.sheetId, revision: Number(sheet.revision), rows, recipe: sheet.recipe, holds: Array.isArray(sheet.holds) ? sheet.holds : undefined, problems: Array.isArray(sheet.problems) ? sheet.problems : undefined };
}

/** Keep row recovery details, never transport extras or private error fields. */
function sheetFailure(payload: Record<string, unknown>): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return payload;
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "INVALID_ROWS") return payload;
  const problems = "problems" in error && Array.isArray(error.problems) ? error.problems.flatMap(problem =>
    problem && typeof problem === "object" && typeof problem.id === "string" && typeof problem.code === "string" && typeof problem.message === "string"
      ? [{ id: problem.id, code: problem.code, message: problem.message }] : []) : [];
  return { error: { code: error.code, message: "message" in error && typeof error.message === "string" ? error.message : "Correct the held sheet choices before saving.", ...(problems.length ? { problems } : {}) } };
}

/** Parse row values using public row metadata, without loading any server/provider modules. */
function rowValue(row: SheetRow, input: unknown, text: boolean): unknown {
  if (input === null) return null;
  let value: unknown = input;
  if (text) {
    const raw = String(input);
    if (row.id === "script" && !raw.trimStart().startsWith("{")) value = { text: raw };
    else if (RAW_TEXT_ROWS.includes(row.id)) value = raw;
    else if (/^[\[{]/.test(raw)) value = JSON.parse(raw);
    else if (row.editor?.kind === "pronunciations" || row.id === "skeleton.pronunciations") {
      const entries = raw.split(",").map(pair => {
        const at = pair.indexOf("=");
        if (at <= 0 || at === pair.length - 1) throw new Error(`${row.id} needs word=say pairs, comma separated, or a JSON object.`);
        return [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
      });
      if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error(`Duplicate pronunciation in ${row.id}.`);
      value = Object.fromEntries(entries);
    } else if (row.editor?.kind === "number" || typeof row.value === "number" || NUMBER_ROWS.includes(row.id)) {
      if (!raw.trim()) throw new Error(`${row.id} needs a finite number.`);
      value = Number(raw);
    } else if (typeof row.value === "boolean" || BOOLEAN_ROWS.includes(row.id)) {
      if (raw !== "true" && raw !== "false") throw new Error(`${row.id} needs true or false.`);
      value = raw === "true";
    } else if (STRING_LIST_ROWS.includes(row.id) || row.editor?.kind === "multi-select" && row.id !== "people.elements" && row.id !== "voice") value = raw.split(",").map(item => item.trim());
    else if (row.editor?.kind === "script") value = { text: raw };
    else if (["product", "voice", "custom"].includes(row.editor?.kind ?? "") && row.value !== null && typeof row.value === "object") throw new Error(`${row.id} needs JSON; use --values file.json.`);
    else value = raw;
  }
  function bounded(item: unknown, depth = 0): boolean {
    if (depth > 5) return false;
    if (typeof item === "string") return item.length <= VALUE_LIMITS.text;
    if (typeof item === "number") return Number.isFinite(item);
    if (typeof item === "boolean") return true;
    if (Array.isArray(item)) return item.length <= (row.id === "script" ? VALUE_LIMITS.rows : VALUE_LIMITS.list) && item.every(entry => bounded(entry, depth + 1));
    return item !== null && typeof item === "object" && Object.keys(item).length <= VALUE_LIMITS.map && Object.entries(item).every(([key, entry]) => !["__proto__", "constructor", "prototype"].includes(key) && bounded(entry, depth + 1));
  }
  if (!bounded(value)) throw new Error(`${row.id} has an invalid or oversized value.`);
  if ((row.editor?.kind === "number" || typeof row.value === "number") && typeof value !== "number") throw new Error(`${row.id} needs a number.`);
  if (typeof row.value === "boolean" && typeof value !== "boolean") throw new Error(`${row.id} needs a boolean.`);
  if (!validRowValue(row.id, value)) throw new Error(`${row.id} has the wrong wire value kind; structured lists/objects need JSON.`);
  return value;
}

/** Public command seam: transport injection keeps offline CLI acceptance provider-free. */
export async function templateCommandFlow(args: string[], deps: Transport = defaults()): Promise<Result> {
  const json = args.includes("--json"), flags: Record<string, string | boolean> = {}, words: string[] = [];
  const answer = (data: unknown, code = 0): Result => ({ code, lines: [JSON.stringify(data, null, json ? undefined : 2)] });
  const fail = (code: string, message: string, extra: object = {}): Result => answer({ ok: false, error: { code, message }, ...extra }, 1);
  let dashboardUrl = `${deps.dashboardUrl}/video?door=template`;
  let confirmedRunId: string | undefined;
  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith("--")) { words.push(arg); continue; }
      const eq = arg.indexOf("="), key = arg.slice(2, eq < 0 ? undefined : eq);
      if (Object.hasOwn(flags, key)) throw new Error(`Duplicate --${key}.`);
      if (valueFlags.includes(key)) {
        const value = eq < 0 ? args[++i] : arg.slice(eq + 1);
        if (!value || value.startsWith("--")) throw new Error(`--${key} needs a value.`);
        flags[key] = value;
      } else if (["yes", "dry-run", "json", "wait"].includes(key) && eq < 0) flags[key] = true;
      else throw new Error(`Unknown flag ${arg}.`);
    }
    const [verb, sub, ...tail] = words;
    const sheetVerb = verb === "sheet";
    const sheetId = sheetVerb ? tail[0] : sub;
    if (sheetId && (!sheetVerb || ["get", "set", "clear"].includes(sub))) dashboardUrl += `&sheetId=${encodeURIComponent(sheetId)}`;
    const allowed = new Set(["json", "dry-run", ...(sheetVerb && sub === "create" ? ["draft-id"] : []), ...(sheetVerb && ["set", "clear"].includes(sub) ? ["revision", "values"] : []), ...(verb === "price" ? ["phase", "operation"] : []), ...(verb === "script" ? ["operation", "yes", "max-usd"] : []), ...(verb === "start" ? ["yes", "max-usd", "attempt-id", "request-id", "wait"] : [])]);
    for (const key of Object.keys(flags)) if (!allowed.has(key)) throw new Error(`--${key} is not valid for this command.`);
    const dry = flags["dry-run"] === true;
    const read = async (path: string): Promise<unknown> => {
      let response: ApiResponse<unknown>;
      try { response = await deps.get(path.startsWith("/") ? path : BASE + path); } catch { throw { readFailed: true }; }
      if (!response.ok) throw { response };
      return response.data;
    };
    const write = async (path: string, body: object): Promise<Result> => {
      let response: ApiResponse<unknown>;
      const readBack = path === "template-sheets" ? "exodus video template sheet list" : `exodus video template sheet get ${sheetId}`;
      const unknown = () => fail("OUTCOME_UNKNOWN", `Outcome unknown; read back before submitting again: ${readBack}`, { saved: "unknown", dashboardUrl, readBack, request: body });
      try { response = await deps.post(BASE + path, body); } catch { return unknown(); }
      if (!response.ok && response.status >= 500) return unknown();
      let payload: Record<string, unknown>;
      try {
        payload = wireObject(response.data);
        if (response.ok) {
          if (payload.error !== undefined || payload.ok === false) return unknown();
          if (path.endsWith("-prepare")) {
            if (typeof payload.quoteId !== "string" || !payload.quoteId || typeof payload.maximumUsd !== "number" || !Number.isFinite(payload.maximumUsd) || payload.maximumUsd < 0) return unknown();
          } else if (path.endsWith("-start")) {
            if (typeof payload.runId !== "string" || !payload.runId) return unknown();
          } else sheetFrom(payload);
        }
      } catch { return unknown(); }
      if (!response.ok) payload = sheetFailure(payload);
      return answer({ ...payload, ok: response.ok, dashboardUrl: typeof payload.dashboardUrl === "string" ? payload.dashboardUrl : dashboardUrl, ...(!response.ok ? { status: response.status, saved: false } : {}) }, response.ok ? 0 : 1);
    };
    if (verb === "list" && words.length === 1) return answer({ ok: true, data: await read("templates"), dashboardUrl });
    if (sheetVerb && sub === "list" && words.length === 2) return answer({ ok: true, data: await read("template-sheets"), dashboardUrl });
    if (sheetVerb && sub === "create" && words.length === 3) {
      const draftId = String(flags["draft-id"] ?? deps.uuid());
      if (!UUID.test(draftId)) throw new Error("--draft-id must be a UUID.");
      const request = { templateId: tail[0], draftId };
      return dry ? answer({ ok: true, dryRun: true, saved: false, operation: "create", request, dashboardUrl, validation: "Local preview only; server validates template access on save." }) : write("template-sheets", request);
    }
    if (!sheetId) throw new Error("Use exodus video template list, sheet list|create|get|set|clear, price, script, or start. See exodus video help.");
    if (sheetVerb && ["get", "set", "clear"].includes(sub)) {
      if (sub === "get" && words.length !== 3) throw new Error("Use sheet get <sheetId>.");
      const current = await read(`template-sheet?id=${encodeURIComponent(sheetId)}`);
      const sheet = sheetFrom(current);
      if (sub === "get") {
        const payload = wireObject(current);
        return answer({ ...payload, ok: true, dashboardUrl: typeof payload.dashboardUrl === "string" ? payload.dashboardUrl : dashboardUrl });
      }
      const revision = flags.revision === undefined ? sheet.revision : Number(flags.revision);
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("--revision must be a nonnegative integer.");
      const inputs: { id: string; value: unknown; text: boolean }[] = [];
      if (flags.values) {
        if (sub !== "set") throw new Error("--values is only for sheet set.");
        const file = JSON.parse(deps.readFile(String(flags.values)));
        if (!file || Array.isArray(file) || typeof file !== "object") throw new Error("--values needs a JSON object keyed by row ID.");
        inputs.push(...Object.entries(file).map(([id, value]) => ({ id, value, text: false })));
      }
      for (const token of tail.slice(1)) {
        const at = token.indexOf("=");
        if (sub === "set" && at < 1) throw new Error("Set rows as row=value; use clear to restore defaults.");
        inputs.push(sub === "clear" ? { id: token, value: null, text: false } : { id: token.slice(0, at), value: token.slice(at + 1), text: true });
      }
      if (!inputs.length || inputs.length > VALUE_LIMITS.rows || new Set(inputs.map(item => item.id)).size !== inputs.length) throw new Error("Supply distinct rows within the sheet row limit.");
      const rows = inputs.map(input => {
        const row = sheet.rows.find(row => row.id === input.id);
        if (!ids.has(input.id) || !row) throw new Error(`Unknown row ${input.id}.`);
        if (!row.editable || row.locked || ["unsupported", "later"].includes(row.status)) throw new Error(`${input.id} is not editable.`);
        return { id: row.id, value: rowValue(row, input.value, input.text) };
      });
      if (Buffer.byteLength(JSON.stringify(rows)) > VALUE_LIMITS.draftBytes) throw new Error("Sheet values exceed the draft byte limit.");
      const request = { sheetId, expectedRevision: revision, rows };
      return dry ? answer({ ok: true, dryRun: true, saved: false, operation: sub, request, revision, dashboardUrl, validation: "Local preview only; server validates the complete selection on save." }) : write("template-sheet", request);
    }
    if (["price", "script", "start"].includes(verb) && words.length === 2) {
      const phase = verb === "price" ? String(flags.phase ?? "production") : verb === "script" ? "script" : "production";
      if (!["script", "production"].includes(phase)) throw new Error("--phase must be script or production.");
      const operation = flags.operation;
      if (phase === "script" && !["write", "rewrite", "reapprove"].includes(String(operation))) throw new Error("Script phase requires --operation write|rewrite|reapprove.");
      if (phase === "production" && operation !== undefined) throw new Error("--operation is only for the script phase.");
      const sheet = sheetFrom(await read(`template-sheet?id=${encodeURIComponent(sheetId)}`));
      const query = new URLSearchParams({ id: sheetId, revision: String(sheet.revision), phase, ...(operation ? { operation: String(operation) } : {}) });
      const priced = await read(`template-sheet-price?${query}`);
      const envelope = wireObject(priced), price = wireObject(envelope.price);
      const estimate = price.estimatedUsd, maximum = price.maximumUsd;
      if (typeof price.priced !== "boolean" || !(estimate === null || typeof estimate === "number" && Number.isFinite(estimate) && estimate >= 0) || !(maximum === null || typeof maximum === "number" && Number.isFinite(maximum) && maximum >= 0) || price.holds !== undefined && !Array.isArray(price.holds)) throw new Error("The server did not return a pure sheet price.");
      if (typeof envelope.dashboardUrl === "string") dashboardUrl = envelope.dashboardUrl;
      if (verb === "price") return answer({ ok: true, price, revision: sheet.revision, dashboardUrl });
      const cap = flags["max-usd"] === undefined ? maximum : Number(flags["max-usd"]);
      if (cap !== null && (!Number.isFinite(cap) || cap < 0)) throw new Error("--max-usd must be a nonnegative finite number.");
      let capNotice = cap !== null && maximum !== null && cap < maximum ? BELOW_QUOTE_NOTICE : undefined;
      const holds = [...(sheet.holds ?? sheet.problems ?? []), ...(Array.isArray(price.holds) ? price.holds : [])];
      const launchAttemptId = verb === "start" ? String(flags["attempt-id"] ?? deps.uuid()) : undefined;
      if (launchAttemptId && !UUID.test(launchAttemptId)) throw new Error("--attempt-id must be a UUID.");
      const requestId = String(flags["request-id"] ?? deps.uuid());
      if (!UUID.test(requestId)) throw new Error("--request-id must be a UUID.");
      const nextCommand = `exodus video template ${verb} ${sheetId}${operation ? ` --operation ${operation}` : ""} --yes --max-usd ${cap ?? "<cap>"}${launchAttemptId ? ` --attempt-id ${launchAttemptId} --request-id ${requestId}` : ""}${flags.wait ? " --wait" : ""}`;
      if (dry || flags.yes !== true) return answer({ ok: true, dryRun: true, operation: operation ?? "start", phase, capUsd: cap, capNotice, holds, price, revision: sheet.revision, launchAttemptId, requestId, dashboardUrl, nextCommand });
      if (flags["max-usd"] === undefined) throw new Error("Authorization requires --yes --max-usd N.");
      if (!price.priced || cap === null || maximum === null) return fail("UNPRICED", "This operation has no executable local price.", { holds, dashboardUrl });
      if (holds.length) return fail("HELD", "Resolve the sheet holds before authorizing this operation.", { holds, dashboardUrl });
      if (cap > maximum) return fail("CAP_TOO_HIGH", "The accepted cap cannot exceed the quote maximum.", { price, dashboardUrl });
      if (cap === 0 && maximum > 0) return fail("CAP_TOO_LOW", "A positive quote requires a positive --max-usd cap; zero is only for a free script operation.", { price, dashboardUrl });
      const common = { sheetId, expectedRevision: sheet.revision };
      const prepared = await write("template-sheet-prepare", { ...common, phase, ...(operation ? { operation } : {}), ...(launchAttemptId ? { launchAttemptId } : {}), requestId, yes: true });
      if (prepared.code) return prepared;
      const authority = wireObject(JSON.parse(prepared.lines[0]));
      if (!authority.quoteId) return fail("INVALID_RESPONSE", "Preparation did not return quote authority; no script/start was submitted.", { dashboardUrl, launchAttemptId, requestId });
      if (typeof authority.maximumUsd === "number" && cap > authority.maximumUsd) return fail("CAP_TOO_HIGH", "The accepted cap exceeds the prepared maximum; no script/start was submitted.", { dashboardUrl, launchAttemptId, requestId });
      if (typeof authority.maximumUsd === "number") capNotice = cap < authority.maximumUsd ? BELOW_QUOTE_NOTICE : undefined;
      // #4944: say it before the run or script starts, not only in the answer after.
      if (capNotice) deps.notice?.(capNotice);
      const submitted = await write(`template-sheet-${verb}`, { ...common, quoteId: authority.quoteId, maximumUsd: cap, ...(operation ? { operation } : {}), ...(launchAttemptId ? { launchAttemptId, requestId } : {}), yes: true });
      const started = wireObject(JSON.parse(submitted.lines[0]));
      if (submitted.code || !flags.wait || typeof started.runId !== "string") return capNotice ? answer({ ...started, capNotice }, submitted.code) : submitted;
      confirmedRunId = started.runId;
      for (;;) {
        if (!sheet.recipe) {
          const current = await read(`/api/v2/workflow?runId=${encodeURIComponent(started.runId)}`);
          const status = wireObject(current);
          const state = typeof status.stage === "string" ? status.stage : typeof status.status === "string" ? status.status : undefined;
          const audition = status.templateApproval && wireObject(status.templateApproval).audition;
          if (!state) return fail("INVALID_RESPONSE", "The server did not return a run status.", { runId: started.runId, dashboardUrl });
          if (!["waiting", "planning", "drawing", "filming", "editing", "pending", "queued", "running"].includes(state) || audition) return answer({ ok: !["failed", "cancelled"].includes(state), runId: started.runId, status: state, capNotice, dashboardUrl: `${deps.dashboardUrl}/video/runs/${encodeURIComponent(started.runId)}` }, ["failed", "cancelled"].includes(state) ? 1 : 0);
          await deps.sleep(2000);
          continue;
        }
        const current = await read(`template-review?runId=${encodeURIComponent(started.runId)}`);
        const payload = wireObject(current), review = wireObject(payload.review);
        if (typeof review.status !== "string") return fail("INVALID_RESPONSE", "The server did not return a run status.", { runId: started.runId, dashboardUrl });
        if (review.checkpoint || !["pending", "queued", "running"].includes(review.status)) {
          return answer({ ...payload, ok: !["failed", "cancelled"].includes(review.status), capNotice, dashboardUrl: typeof payload.dashboardUrl === "string" ? payload.dashboardUrl : dashboardUrl }, ["failed", "cancelled"].includes(review.status) ? 1 : 0);
        }
        await deps.sleep(2000);
      }
    }
    throw new Error("Unknown template command or wrong number of arguments.");
  } catch (error) {
    if (error && typeof error === "object" && "readFailed" in error) return fail("READ_FAILED", confirmedRunId ? `Video ${confirmedRunId} started, but waiting failed. Read exodus video template review ${confirmedRunId}.` : "Could not read the server; nothing was submitted.", { dashboardUrl, ...(confirmedRunId ? { runId: confirmedRunId } : {}) });
    if (error && typeof error === "object" && "response" in error) {
      const response = error.response as ApiResponse<unknown>;
      return answer({ ok: false, ...sheetFailure(response.data as Record<string, unknown>), status: response.status, dashboardUrl }, 1);
    }
    return fail("INVALID_INPUT", error instanceof Error ? error.message : "Could not read the server response; nothing was submitted.", { dashboardUrl });
  }
}

export async function runTemplateCommand(args: string[]): Promise<void> {
  const result = await templateCommandFlow(args);
  for (const line of result.lines) console.log(line);
  if (result.code) process.exitCode = result.code;
}
