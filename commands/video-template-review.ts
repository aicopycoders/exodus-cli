/**
 * Door 2 review only. C02 dispatches these four `exodus video template` verbs
 * here with raw args AFTER `template`: review, select-person, approve, approve-song, redo-picture.
 * Redo reads the saved server quote; without --yes (or with --dry-run) it never POSTs.
 */
import { apiGet, apiPost, type ApiResponse } from "../lib/client.js";

const REVIEW = "/api/v2/video/template-review";
type Transport = { get(path: string): Promise<ApiResponse<unknown>>; post(path: string, body: unknown): Promise<ApiResponse<unknown>> };
type Result = { code: number; lines: string[] };
type Review = { checkpoint?: { nodeId: string }; reviewItems: { pictureId: string; producerNodeId: string; asset: { url: string }; maximumUsd: number }[] };
const verbs = ["review", "select-person", "approve", "approve-song", "redo-picture"];
const values = ["note", "checkpoint", "max-usd", "master-sha", "lyric-sha", "track", "storage-id"];

export async function templateReviewFlow(args: string[], deps: Transport = { get: apiGet, post: apiPost }): Promise<Result> {
  const json = args.includes("--json"), flags: Record<string, string | boolean> = {}, words: string[] = [];
  function answer(data: unknown, code = 0): Result {
    return { code, lines: [JSON.stringify(data, null, json ? undefined : 2)] };
  }
  function fail(code: string, message: string): Result { return answer({ error: { code, message } }, 1); }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) { words.push(arg); continue; }
    const eq = arg.indexOf("="), key = arg.slice(2, eq < 0 ? undefined : eq);
    if (Object.hasOwn(flags, key)) return fail("USAGE", `Duplicate --${key}.`);
    if (values.includes(key)) {
      const value = eq < 0 ? args[++i] : arg.slice(eq + 1);
      if (!value || value.startsWith("--")) return fail("USAGE", `--${key} needs a value.`);
      flags[key] = value;
    } else if (["json", "yes", "dry-run"].includes(key) && eq < 0) flags[key] = true;
    else return fail("USAGE", `Unknown flag ${arg}.`);
  }
  const [verb, runId, itemId] = words;
  if (!verbs.includes(verb) || !runId || words.length !== (["select-person", "redo-picture"].includes(verb) ? 3 : 2)) return fail("USAGE", "Use template review <runId>, select-person <runId> <personId>, approve <runId> --checkpoint ID, or redo-picture <runId> <pictureId> [--note text] [--yes --max-usd N].");
  if (verb !== "redo-picture" && (flags.note !== undefined || flags["max-usd"] !== undefined || flags.yes !== undefined)) return fail("USAGE", "--note, --max-usd and --yes are only for redo-picture.");
  if (!["approve", "approve-song"].includes(verb) && flags.checkpoint !== undefined) return fail("USAGE", "--checkpoint is only for approval.");
  if (["approve", "approve-song"].includes(verb) && !flags.checkpoint) return fail("USAGE", "Approve requires the exact --checkpoint ID from review.");
  const songFlags = ["master-sha", "lyric-sha", "track", "storage-id"];
  if (verb !== "approve-song" && songFlags.some(flag => flags[flag] !== undefined)) return fail("USAGE", "Song identity flags are only for approve-song.");
  if (verb === "approve-song" && (!/^[a-f0-9]{64}$/.test(String(flags["master-sha"])) || !/^[a-f0-9]{64}$/.test(String(flags["lyric-sha"])) || flags.track === undefined || !Number.isSafeInteger(Number(flags.track)) || Number(flags.track) < 0 || !flags["storage-id"])) return fail("USAGE", "approve-song requires --checkpoint, --master-sha, --lyric-sha, --track and --storage-id from the whole master you listened to.");
  const cap = flags["max-usd"] === undefined ? undefined : Number(flags["max-usd"]);
  if (cap !== undefined && (!Number.isFinite(cap) || cap <= 0)) return fail("USAGE", "--max-usd must be a positive finite number.");
  if (typeof flags.note === "string" && flags.note.length > 600) return fail("USAGE", "--note must be at most 600 characters.");
  const dryRun = flags["dry-run"] === true || (verb === "redo-picture" && flags.yes !== true);
  if (verb === "redo-picture" && !dryRun && cap === undefined) return fail("USAGE", "A paid redo requires --yes --max-usd N.");
  let current: ApiResponse<unknown>;
  try { current = await deps.get(`${REVIEW}?runId=${encodeURIComponent(runId)}`); }
  catch { return fail("READ_FAILED", "Could not read this review. Nothing was submitted."); }
  if (!current.ok) return answer(current.data, 1);
  if (verb === "review") return answer(current.data);
  const data = current.data as { review?: Review; dashboardUrl?: string };
  if (!data.review) return fail("INVALID_RESPONSE", "The server did not return a template review.");
  let body: Record<string, unknown>, path = REVIEW;
  if (verb === "select-person") body = { action: "select-person", runId, personId: itemId };
  else if (verb === "approve") body = { action: "approve", runId, checkpoint: flags.checkpoint };
  else if (verb === "approve-song") body = { action: "approve-song", runId, checkpoint: flags.checkpoint, identity: { masterSha256: flags["master-sha"], lyricSha256: flags["lyric-sha"], track: Number(flags.track) }, storageId: flags["storage-id"] };
  else {
    const item = data.review.reviewItems.find(item => item.pictureId === itemId);
    if (!data.review.checkpoint || !item) return fail("NO_QUOTE", "This picture does not have a current held redo quote. Read the review again.");
    if (cap !== undefined && cap < item.maximumUsd) return fail("CAP_TOO_LOW", `This picture's maximum is $${item.maximumUsd}; --max-usd is lower.`);
    body = { runId, pictureId: itemId, nodeId: item.producerNodeId, expectedAssetUrl: item.asset.url, maximumUsd: item.maximumUsd, maxUsd: cap ?? item.maximumUsd, ...(flags.note ? { correctionNote: flags.note } : {}), yes: true };
    path = "/api/v2/video/template-review-redo";
  }
  if (dryRun) {
    const nextArgs = ["exodus", "video", "template", verb, runId, ...(itemId ? [itemId] : []), ...(["approve", "approve-song"].includes(verb) ? ["--checkpoint", String(flags.checkpoint)] : []), ...(verb === "approve-song" ? songFlags.flatMap(flag => [`--${flag}`, String(flags[flag])]) : []), ...(verb === "redo-picture" ? ["--yes", "--max-usd", String(body.maxUsd), ...(flags.note ? ["--note", String(flags.note)] : [])] : [])];
    const nextCommand = nextArgs.map(value => /^[a-zA-Z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`).join(" ");
    return answer({ dryRun: true, operation: verb, ...body, yes: false, dashboardUrl: data.dashboardUrl, nextCommand });
  }
  try {
    const response = await deps.post(path, body);
    return answer(response.data, response.ok ? 0 : 1);
  } catch { return fail("OUTCOME_UNKNOWN", "The write response was lost. Read template review before submitting anything again; the operation may have succeeded."); }
}

export async function runTemplateReviewCommand(args: string[]): Promise<void> {
  const result = await templateReviewFlow(args);
  for (const line of result.lines) console.log(line);
  if (result.code) process.exitCode = result.code;
}
