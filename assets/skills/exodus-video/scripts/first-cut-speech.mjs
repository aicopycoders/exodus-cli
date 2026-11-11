/**
 * Template talking-clip edit from measured word times.
 * Standalone so first-cut.mjs and scout scribe.ts share one policy.
 * Door 1/3/4 never call this.
 *
 * A word-to-word silence strictly over 0.8 s is jump-cut, leaving 0.18 s
 * after the earlier word and 0.12 s before the later one. The kept picture
 * starts 0.10 s before the first word and ends 0.28 s after the last.
 * An opening/closing action handle widens those edges. A protected window
 * (reveal pause, resolved action hold) is never removed. A pause the script
 * asks for — ellipsis, dash, a direction, or the laugh beat after a cued
 * line — is not jump-cut when the lines align with the words.
 *
 * Words may be {word, startSec, endSec} or {w, s, e}. Windows may be
 * {startSec, endSec} or {s, e}. Pass fps to land on whole frames: kept
 * silence only grows. Null when there is no measured word to trim to.
 */

export const TEMPLATE_INTERNAL_PAUSE_SEC = 0.8;
export const TEMPLATE_PAUSE_KEEP_AFTER_SEC = 0.18;
export const TEMPLATE_PAUSE_KEEP_BEFORE_SEC = 0.12;
export const TEMPLATE_SPEECH_LEAD_SEC = 0.1;
export const TEMPLATE_SPEECH_TAIL_SEC = 0.28;
export const DIALOGUE_BREATH_LEAD_SEC = 0.5;
export const DIALOGUE_BREATH_TAIL_SEC = 0.9;

const PAUSE_MARK = /…|\.{3,}|[—–]|-{2,}/g;
const WRITTEN_PAUSE = /…|\.{3}|[—–-]/;

const ms = (sec) => Math.round(sec * 1000) / 1000;
const spoken = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9']+/g, "");
const wordText = (word) => word?.word ?? word?.w ?? "";
const wordStart = (word) => (Number.isFinite(word?.startSec) ? word.startSec : word?.s);
const wordEnd = (word) => (Number.isFinite(word?.endSec) ? word.endSec : word?.e);
const windowStart = (window) => (Number.isFinite(window?.startSec) ? window.startSec : window?.s);
const windowEnd = (window) => (Number.isFinite(window?.endSec) ? window.endSec : window?.e);

/** Heard-word pairs whose silence the script asked for. Empty when the lines do not align. */
function askedPairs(lines, words) {
  if (!lines?.length) return new Set();
  const pieces = [];
  lines.forEach((line, li) => {
    for (const piece of String(line?.text ?? "").replace(PAUSE_MARK, " $& ").trim().split(/\s+/).filter(Boolean)) {
      pieces.push({ li, piece, spoken: spoken(piece) });
    }
  });
  const heard = [];
  words.forEach((word, i) => {
    if (isZeroDurationSpeech(word)) return;
    heard.push({ i, spoken: spoken(wordText(word)) });
  });
  let h = 0;
  const at = [];
  for (const piece of pieces) {
    if (!piece.spoken) {
      at.push(null);
      continue;
    }
    while (h < heard.length && heard[h].spoken !== piece.spoken) h++;
    if (h >= heard.length) return new Set();
    at.push(heard[h].i);
    h++;
  }
  const pairs = new Set();
  for (let p = 0; p < pieces.length; p++) {
    if (at[p] === null) continue;
    let n = p + 1;
    while (n < pieces.length && at[n] === null) n++;
    if (n >= pieces.length) break;
    const from = at[p];
    const to = at[n];
    const fromHeard = heard.findIndex((entry) => entry.i === from);
    const toHeard = heard.findIndex((entry) => entry.i === to);
    if (toHeard !== fromHeard + 1) continue;
    const between = pieces.slice(p + 1, n).map((piece) => piece.piece).join(" ");
    const fromLine = lines[pieces[p].li];
    const toLine = lines[pieces[n].li];
    if (
      WRITTEN_PAUSE.test(between) ||
      fromLine?.asksPause ||
      toLine?.asksPause ||
      (pieces[p].li !== pieces[n].li && fromLine?.cuesBeat)
    ) {
      pairs.add(`${from}:${to}`);
    }
  }
  return pairs;
}

function subtractWindows(span, windows) {
  let pieces = [span];
  for (const window of windows) {
    const start = windowStart(window);
    const end = windowEnd(window);
    if (!(end > start)) continue;
    const next = [];
    for (const piece of pieces) {
      if (end <= piece.startSec || start >= piece.endSec) {
        next.push(piece);
        continue;
      }
      if (start > piece.startSec) next.push({ startSec: piece.startSec, endSec: ms(start) });
      if (end < piece.endSec) next.push({ startSec: ms(end), endSec: piece.endSec });
    }
    pieces = next;
  }
  return pieces.filter((piece) => piece.endSec > piece.startSec + 1e-6);
}

function mergeSpans(spans) {
  const merged = [];
  for (const span of [...spans].sort((a, b) => a.startSec - b.startSec)) {
    const prev = merged.at(-1);
    if (prev && span.startSec <= prev.endSec) prev.endSec = Math.max(prev.endSec, span.endSec);
    else merged.push({ ...span });
  }
  return merged;
}

/** Fallback lead for pre-line action prose not covered by a resolved edge window. */
export const AUTHORED_ACTION_LEAD_SEC = 1.2;
/** Fallback tail for reaction prose not covered by a resolved edge window. */
export const AUTHORED_REACTION_TAIL_SEC = 1.0;

const PRE_LINE_ACTION = /\b(?:cross(?:es)?|grabs?|sits?|taps?|installs?|leans?\s+in|hid(?:e|es|ing))\b|\bsets?\b(?:\s+\S+){0,6}\s+down\b|\btak(?:e|es|ing)\b(?:\s+\S+){0,6}\s+out\b/i;
const POST_LINE_REACTION = /\b(?:laugh(?:s|ing)?|nods?|smiles?|smiling|grins?|sighs?)\b/i;
const TIMED_BEAT = /(?:about\s+)?(\d+(?:\.\d+)?)\s*-?\s*(?:s|sec|secs|second|seconds)\b[^.;]{0,60}\b(?:silent\s+)?(?:beat|pause)\b|\b(?:silent\s+)?(?:beat|pause)\b[^.;]{0,60}(?:about\s+)?(\d+(?:\.\d+)?)\s*-?\s*(?:s|sec|secs|second|seconds)\b/i;

function directionText(value) {
  if (Array.isArray(value)) return value.map(directionText).filter(Boolean).join(" ");
  return typeof value === "string" ? value : "";
}

/**
 * What a stage direction authors, with no added seconds. Planning and the
 * trim each apply their own allowance, so the same text cannot be counted twice.
 * A numbered beat/pause before the line (or with no "after") is a lead; "after" is a tail.
 */
export function parseAuthoredBeat(direction) {
  const text = directionText(direction);
  let timedLeadSec = 0;
  let timedTailSec = 0;
  // A period inside 1.25 is not a clause break.
  for (const clause of text.split(/;|(?<!\d)\.(?!\d)/)) {
    const match = clause.match(TIMED_BEAT);
    const seconds = Number(match?.[1] ?? match?.[2]);
    if (!(seconds > 0)) continue;
    if (/\bafter\b/i.test(clause)) timedTailSec = Math.max(timedTailSec, seconds);
    else timedLeadSec = Math.max(timedLeadSec, seconds);
  }
  return {
    timedLeadSec,
    timedTailSec,
    preLineAction: PRE_LINE_ACTION.test(text),
    postLineReaction: POST_LINE_REACTION.test(text),
  };
}

function authoredDirection(opts) {
  return directionText([
    opts.direction,
    ...(opts.lines ?? []).flatMap((line) => [line?.stageDirection, line?.performanceDirection, line?.action]),
  ]);
}

/** Explicit director windows replace fallback handles only on the speech edge they cover. */
function derivedBeatHandles(opts, windows, firstStart, lastEnd) {
  const plan = parseAuthoredBeat(authoredDirection(opts));
  const coversEdge = (window) => window.kind === "director-beat" || window.kind === "action-phase";
  const leadCovered = windows.some((window) => coversEdge(window) &&
    window.startSec < firstStart && window.endSec >= firstStart);
  const tailCovered = windows.some((window) => coversEdge(window) &&
    window.startSec <= lastEnd && window.endSec > lastEnd);
  return {
    lead: leadCovered ? 0 : Math.max(plan.timedLeadSec, plan.preLineAction ? AUTHORED_ACTION_LEAD_SEC : 0),
    tail: tailCovered ? 0 : Math.max(plan.timedTailSec, plan.postLineReaction ? AUTHORED_REACTION_TAIL_SEC : 0),
  };
}

/** Both timestamps finite and no duration. An incomplete time is not this. */
export function isZeroDurationSpeech(word) {
  const start = wordStart(word);
  const end = wordEnd(word);
  return Number.isFinite(start) && Number.isFinite(end) && !(end > start);
}

/**
 * Template join anchors. A proven zero-duration token is ignored. A word with
 * only one timestamp stays, so the join does not borrow another word's clock.
 */
export function templateJoinAnchors(words) {
  const list = words ?? [];
  const kept = list.filter((word) => !isZeroDurationSpeech(word));
  const usable = kept.length ? kept : list;
  const starts = usable.map(wordStart).filter((n) => Number.isFinite(n));
  const ends = usable.map(wordEnd).filter((n) => Number.isFinite(n));
  return {
    firstSec: starts.length ? Math.min(...starts) : undefined,
    lastSec: ends.length ? Math.max(...ends) : undefined,
  };
}

/** A measured word with a real duration. */
function positiveSpan(word) {
  if (isZeroDurationSpeech(word)) return null;
  const start = wordStart(word);
  const end = wordEnd(word);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
  return { start, end };
}
/**
 * Bind authored intent to the measured source clock, never to guessed speech
 * duration. These windows reserve picture; they do not prove an action happened.
 * Tagged words are authoritative. Legacy untagged words may bind only when the
 * complete supplied lines match the complete transcript in order.
 */
export function templateActionWindows(words, opts = {}) {
  if (!opts.actionPhases?.length && !opts.directorBeats?.length) return [];
  const list = (words ?? []).filter((word) => !isZeroDurationSpeech(word));
  const byLine = new Map();
  const add = (id, word) => {
    if (typeof id !== "string" || !id) return;
    if (!byLine.has(id)) byLine.set(id, []);
    byLine.get(id).push(word);
  };
  if (list.some((word) => typeof word.lineId === "string" && word.lineId)) {
    for (const word of list) add(word.lineId, word);
  } else {
    const expected = (opts.lines ?? []).flatMap((line) =>
      String(line?.text ?? "").split(/\s+/).map(spoken).filter(Boolean)
        .map((text) => ({ id: line.lineId, text })));
    if (expected.length === list.length && expected.every((entry, i) => entry.text === spoken(wordText(list[i])))) {
      expected.forEach((entry, i) => add(entry.id, list[i]));
    }
  }
  const cap = Number.isFinite(opts.durationSec) && opts.durationSec > 0 ? opts.durationSec : undefined;
  const anchor = (value) => {
    if (value?.boundary === "scene-start") return 0;
    if (value?.boundary === "scene-end") return cap;
    if (value?.edge !== "start" && value?.edge !== "end") return undefined;
    const line = byLine.get(value.lineId);
    if (!line?.length) return undefined;
    const times = line.map(value.edge === "start" ? wordStart : wordEnd);
    // Missing word times are uncertainty, not permission to borrow another word.
    if (!times.every(Number.isFinite)) return undefined;
    return value.edge === "start" ? Math.min(...times) : Math.max(...times);
  };
  const windows = [];
  const note = (code, entry, detail) => opts.notes?.push(
    `${code}: scene ${opts.sceneIndex ?? "unknown"} ${entry.id}: ${detail}; reservation is not observed action`);
  const bind = (entry, window, kind) => {
    if (typeof entry?.id !== "string" || !entry.id) return;
    const start = anchor(window?.start);
    const end = anchor(window?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || !(end > start)) {
      note("beat-reservation-unresolved", entry, "authored anchors have no usable source interval");
      return;
    }
    const endSec = cap === undefined ? end : Math.min(cap, end);
    if (!(endSec > start)) {
      note("beat-reservation-unresolved", entry, "authored interval is outside available source");
      return;
    }
    windows.push({ id: entry.id, kind, startSec: start, endSec });
    if (endSec < end || (window.minActionSec > 0 && endSec - start + 1e-6 < window.minActionSec)) {
      note("beat-reservation-short", entry, `${ms(endSec - start)}s available against ${window.minActionSec ?? ms(end - start)}s requested`);
    }
  };
  for (const phase of opts.actionPhases ?? []) {
    // Full-scene phases scope proof/observation, not an instruction to retain
    // every source frame. Only a separately resolved edit window reserves time.
    if (phase?.window?.start?.boundary === "scene-start" &&
        phase?.window?.end?.boundary === "scene-end") continue;
    if (phase?.required === true) bind(phase, phase.window, "action-phase");
  }
  for (const beat of opts.directorBeats ?? []) {
    if (Number.isFinite(beat?.timing?.minActionSec) && beat.timing.minActionSec > 0) {
      // A shorter measured interval cannot be repaired by inventing source time.
      bind(beat, beat.timing, "director-beat");
    } else if (typeof beat?.id === "string" && beat.id) {
      note("beat-reservation-unresolved", beat, "no positive authored acting minimum");
    }
  }
  return windows;
}




export function templateSpeechEdit(words, opts = {}) {
  const list = words ?? [];
  const fromIndex = opts.span?.first ?? 0;
  const toIndex = opts.span ? opts.span.last : list.length - 1;
  const kept = list.slice(fromIndex, toIndex + 1);
  if (!kept.length) return null;
  const first = kept[0];
  const last = kept[kept.length - 1];
  const firstStart = isZeroDurationSpeech(first)
    ? kept.slice(1).map(positiveSpan).find(Boolean)?.start
    : wordStart(first);
  const lastEnd = isZeroDurationSpeech(last)
    ? [...kept].reverse().slice(1).map(positiveSpan).find(Boolean)?.end
    : wordEnd(last);
  let latestEnd = -Infinity;
  for (const word of kept) {
    if (isZeroDurationSpeech(word)) continue;
    const end = wordEnd(word);
    if (Number.isFinite(end)) latestEnd = Math.max(latestEnd, end);
  }
  const fps = opts.fps;
  const floorFrame = (sec) => (fps ? Math.floor(sec * fps + 1e-6) / fps : sec);
  const ceilFrame = (sec) => (fps ? Math.ceil(sec * fps - 1e-6) / fps : sec);
  const windows = [...(opts.protectedWindows ?? []), ...templateActionWindows(list, opts)];
  const beat = derivedBeatHandles(opts, windows, firstStart, latestEnd);
  // dialogueBreath has a single allowed value, so any value set asks for the longer breath.
  const breath = Boolean(opts.editingTreatment?.dialogueBreath);
  const lead = Math.max(breath ? DIALOGUE_BREATH_LEAD_SEC : TEMPLATE_SPEECH_LEAD_SEC, opts.actionLeadSec ?? 0, beat.lead);
  const tail = Math.max(breath ? DIALOGUE_BREATH_TAIL_SEC : TEMPLATE_SPEECH_TAIL_SEC, opts.actionTailSec ?? 0, beat.tail);
  const cap = opts.durationSec !== undefined && opts.durationSec > 0 ? opts.durationSec : Infinity;
  // A missing time on the boundary word is uncertain: keep that side. When the last word has an end, the tail is the latest measured end plus 0.28 s, so an earlier word that outlasts it is not cut.
  let headSec = Number.isFinite(firstStart) ? Math.max(0, floorFrame(firstStart - lead)) : 0;
  let tailSec = Number.isFinite(lastEnd) && Number.isFinite(latestEnd) ? Math.min(cap, ceilFrame(latestEnd + tail)) : cap;
  for (const window of windows) {
    const start = windowStart(window);
    const end = windowEnd(window);
    if (!(end > start)) continue;
    if (start < headSec) headSec = Math.max(0, start);
    if (end > tailSec && start < cap) tailSec = Math.min(cap, end);
  }
  headSec = ms(Number.isFinite(firstStart) ? Math.min(headSec, firstStart) : headSec);
  tailSec = ms(Number.isFinite(lastEnd) && Number.isFinite(latestEnd) ? Math.max(tailSec, Math.min(cap, latestEnd)) : tailSec);
  if (!Number.isFinite(tailSec) || !(tailSec > headSec)) return null;

  const asked = askedPairs(opts.lines, list);
  const cuts = [];
  if (opts.editingTreatment?.time === "continuous-dramatic") return { headSec, tailSec, cuts };
  const nodes = [];
  for (let i = fromIndex; i <= toIndex; i++) {
    if (isZeroDurationSpeech(list[i])) continue;
    const span = positiveSpan(list[i]);
    nodes.push(span ? { index: i, barrier: false, ...span } : { index: i, barrier: true });
  }
  let runningEnd = -Infinity;
  for (let p = 0; p + 1 < nodes.length; p++) {
    const earlier = nodes[p];
    const later = nodes[p + 1];
    // An incomplete word blocks its adjoining pairs, not the protection of
    // an earlier word whose measured end still overlaps later words.
    if (!earlier.barrier) runningEnd = Math.max(runningEnd, earlier.end);
    if (earlier.barrier || later.barrier) continue;
    // Same millisecond clock as sentenceGapCuts, so 1.4→2.2 stays 0.8 s and is kept.
    const gap = ms(later.start - runningEnd);
    if (!(gap > TEMPLATE_INTERNAL_PAUSE_SEC)) continue;
    if (asked.has(`${earlier.index}:${later.index}`)) continue;
    const startSec = ms(ceilFrame(runningEnd + TEMPLATE_PAUSE_KEEP_AFTER_SEC));
    const endSec = ms(floorFrame(later.start - TEMPLATE_PAUSE_KEEP_BEFORE_SEC));
    if (!(endSec > startSec)) continue;
    cuts.push(...subtractWindows({ startSec, endSec }, windows));
  }
  return { headSec, tailSec, cuts: mergeSpans(cuts) };
}
