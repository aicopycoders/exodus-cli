#!/usr/bin/env node
// A plain first cut from a folder written by `exodus video pull`: the A-roll
// scenes in the manifest's order make the spine, each cutaway lays over the
// spine at the moment its cued line is spoken, a room-tone bed and the music
// bed go underneath, and one MP4 comes out ready to upload. A reaction
// cutaway is the exception: it is its own short beat in the spine right after
// its cued line ends, heard with its own sound while the speaker is silent,
// fading in across any quiet start and out rather than stopping dead.
//
//   node first-cut.mjs <pulled-dir> [--out cut.mp4] [--skip 2,5] [--no-music] [--still-fill]
//
// The audio track comes first. A narrated scene (the storyboard gives it
// narration and no on-camera line) plays its voice track and NOTHING the clip
// recorded: the voice replaces the clip's audio, and the picture is fitted to
// the voice, trimmed when the clip runs longer and held on its last frame when
// the voice runs longer. The voice itself is never altered. A dialogue scene
// keeps the audio it performed; at each join its silence before the first word
// and after the last is cut back to a short beat, read from its word times.
// Inside it, a silence over 0.6 s between two sentences is cut down to 0.5 s,
// picture and sound together, unless the script writes that pause in. A
// sound in such a break that holds no heard word (a burp, a click) is cut
// out, read from the clip's loudness, and the same rule then applies. Every
// segment is loudness-normalized to -16 LUFS before the join.
// A scene with no clip stops the cut (#3365: a customer's ad once ended on 16 s
// of frozen, silent keyframes). --skip drops scenes. --still-fill instead turns
// a scene with no clip but a keyframe into a still for the length of its voice
// track, else the storyboard's planned duration. A run whose Pacing is jump cuts (manifest.shots)
// punches in on every other cut between one speaker's scenes; a montage does
// the same where one speaker's scenes in a row play one base shot.
//
// After the render it writes the whole ad's word times beside the MP4, as
// <out>.words.json and <out>.srt, for captioning in post, and where each scene
// plays in the cut as <out>.scenes.json (#3300).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "usage: first-cut.mjs <pulled-dir> [--out cut.mp4] [--skip 2,5] [--no-music] [--still-fill]";
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 24;
const norm = (label) =>
  `[${label}]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
  `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;
/**
 * Edges the cut chooses (join trims, reaction splits, narration lengths) land
 * on whole frames, so the picture runs as long as its sound there and the
 * timeline's times are the cut's times.
 */
/**
 * #3304: the jump cut's punch-in, a centre crop of the frame scaled up this
 * much. The planner holds one framing across a jump-cut run's scenes, and a
 * montage's line-cut pieces keep their parent's (#3323), so without it those
 * cuts would be the same picture.
 */
export const PUNCH_IN_SCALE = 1.15;
const even = (n) => 2 * Math.round(n / 2);
const PUNCH_IN =
  `scale=${even(WIDTH * PUNCH_IN_SCALE)}:${even(HEIGHT * PUNCH_IN_SCALE)},crop=${WIDTH}:${HEIGHT},setsar=1`;
const floorFrame = (t) => Math.floor(t * FPS + 1e-6) / FPS;
const ceilFrame = (t) => Math.ceil(t * FPS - 1e-6) / FPS;
const stereo = "aresample=48000,aformat=channel_layouts=stereo";
/**
 * Per-segment loudness, the level every clip was normalized to before the join.
 * loudnorm stamps its output about 0.1 s late (its look-ahead), so a later
 * atrim by time kept that much less sound than picture and every join pulled
 * the sound further ahead (#2387). Re-stamping by sample count undoes it.
 * Its input is padded to 3 s, its look-ahead window: Debian's ffmpeg 5.1 (the
 * worker's) all but silenced a shorter sound (#3006). Every use trims after.
 */
const LOUDNORM = "apad=whole_dur=3,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,asetpts=N/SR/TB";
/** A fade this short at each edge of a segment's sound stops a hard cut in the room tone clicking. */
const EDGE_FADE_SEC = 0.015;
/**
 * Air after a narrator's last word. Sizing by the voice file plus 0.8 s left
 * ~1.1 s of silence at every narrator join, since the file already runs on
 * ~0.3 s past the word (#3384).
 */
export const NARRATION_JOIN_AIR_SEC = 0.25;
/**
 * Air after the last word of the line that ends the ad, spoken or narrated, so
 * it lands. A dialogue clip's own tail ran ~1.1 s of dead air (#3423).
 */
export const END_AIR_SEC = 0.5;
/** A continuous low bed under the whole ad, so the joins between clips do not read as dead air. */
const ROOM_TONE =
  "anoisesrc=color=brown:amplitude=0.0035:r=48000,highpass=f=60,lowpass=f=900,aformat=channel_layouts=stereo";
const MUSIC_VOLUME = 0.18;
/** The longest a reaction beat holds the spine (#2357); older pulls carry 4 s reaction clips. */
export const REACTION_MAX_SEC = 1.5;
/**
 * A reaction's laugh carries into the next line instead of stopping dead at
 * the join (#2406): it starts well under the speaker, at this share of its own
 * level (about -9 dB), and fades to silence over this long.
 */
export const REACTION_TAIL_SEC = 0.75;
export const REACTION_TAIL_GAIN = 0.35;
/** A reaction clip with too little sound for a tail fades out over this long instead (#2666). */
export const REACTION_FADE_OUT_SEC = 0.4;
/** The least picture a reaction beat keeps when it gives up its end to a tail (#2700). */
export const REACTION_MIN_BEAT_SEC = 1.0;
/**
 * The air a join keeps around its words (#2388): after one clip's last word, and
 * before the next clip's first, less when the same speaker carries on than when
 * someone new answers.
 */
export const JOIN_TAIL_SEC = 0.15;
export const JOIN_LEAD_SAME_SPEAKER_SEC = 0.1;
export const JOIN_LEAD_NEW_SPEAKER_SEC = 0.25;
/** The gap a cut keeps from an extra heard sound it leaves out (#2541). */
const EXTRA_CLEARANCE_SEC = 0.05;

/** The word rule the planner sized every line with (scout models.ts wordCount). */
export function wordCount(text) {
  const trimmed = (text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function lineWordCounts(storyboard) {
  const counts = new Map();
  for (const line of storyboard?.script ?? []) {
    if (typeof line?.lineId === "string") counts.set(line.lineId, wordCount(line.text));
  }
  return counts;
}

const wordToken = (word) => String(word ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * #3175: one spoken word a script and a scribe spell differently ("ok", "Okay").
 * #3460: "alright" maps to the scribe's "All right" once its halves are joined.
 */
const SAME_WORD_SPELLINGS = new Map([
  ["ok", "okay"],
  ["alright", "allright"],
]);

/** The spoken tokens of one written word; empty for pure punctuation. */
function spokenWords(word) {
  const core = String(word ?? "").toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  // #3133: a scribe writes a spoken "glowmist dot com" as "Glowmist.com".
  const parts = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z]{2,})+$/.test(core)
    ? core.split(".").flatMap((part, i) => (i ? ["dot", part] : [part]))
    : [core];
  return parts.map(wordToken).filter(Boolean).map((t) => SAME_WORD_SPELLINGS.get(t) ?? t);
}

/** { tokens, sourceIndex }: tokens[i] came from written word sourceIndex[i]. */
function spokenTokens(words) {
  const tokens = [];
  const sourceIndex = [];
  words.forEach((word, i) => {
    for (const token of spokenWords(word)) {
      tokens.push(token);
      sourceIndex.push(i);
    }
  });
  return { tokens, sourceIndex };
}

/** An ellipsis or a dash, which a writer may type with no space around it (scout scribe.ts PAUSE_MARK). */
const PAUSE_MARK = /…|\.{3,}|[—–]|-{2,}/g;
const scriptWords = (text) => (text ?? "").replace(PAUSE_MARK, " $& ").split(/\s+/).filter(Boolean);

const MAX_JOINED_WORDS = 3;
const MIN_SLIP_WORD_LENGTH = 7;

/**
 * #2300: a scribe writes a made-up name the script spells as one word
 * ("FreshKeep") as two ("Fresh keep"), or the other way round. Joins each run
 * of 2-3 neighbouring tokens whose concatenation is a token of the other side,
 * longest first. #2520: a run one slip off one of the other side's names joins
 * too, unless a join also starts at the next token, or (#3058) its first token
 * is a word the other side already has. Mirrors scout scribe.ts joinSplitWords.
 */
function joinSplitWords(side, otherSide, otherNames = []) {
  const other = new Set(otherSide);
  const fuzzy = (r) => otherNames.some((name) => sameWord(name, r, true));
  const run = (i, k) => (i + k <= side.tokens.length ? side.tokens.slice(i, i + k).join("") : undefined);
  const joinStartsAt = (i) => {
    for (let k = MAX_JOINED_WORDS; k >= 2; k--) {
      const r = run(i, k);
      if (r !== undefined && (other.has(r) || fuzzy(r))) return true;
    }
    return false;
  };
  const tokens = [];
  const sourceIndex = [];
  const lastSourceIndex = [];
  for (let i = 0; i < side.tokens.length; ) {
    let take = 1;
    for (let k = MAX_JOINED_WORDS; k >= 2; k--) {
      const r = run(i, k);
      if (r === undefined) continue;
      if (other.has(r) || (fuzzy(r) && !joinStartsAt(i + 1) && !other.has(side.tokens[i]))) {
        take = k;
        break;
      }
    }
    tokens.push(side.tokens.slice(i, i + take).join(""));
    sourceIndex.push(side.sourceIndex[i]);
    lastSourceIndex.push(side.sourceIndex[i + take - 1]);
    i += take;
  }
  return { tokens, sourceIndex, lastSourceIndex };
}

/**
 * Which written words read as names: a capital inside the word, or a leading
 * capital where no sentence starts. "I" and "I'm" are never names.
 */
function nameLikeWords(words) {
  return words.map((word, i) => {
    const bare = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (/^I(['’][a-z]+)?$/.test(bare)) return false;
    if (/[A-Z]/.test(bare.slice(1))) return true;
    const sentenceStart = i === 0 || /[.!?]["')\]]*$/.test(words[i - 1]);
    return /^[A-Z]/.test(bare) && !sentenceStart;
  });
}

/**
 * #2441: one letter off on a long name is a slip; #3035: so is a spelling of
 * the same sound, and #3415 a final z after a vowel for an s ("Inez", "Ines").
 */
function sameWord(scripted, heard, nameLike) {
  if (scripted === heard || soundKey(scripted) === soundKey(heard)) return true;
  if (!nameLike || scripted.length < MIN_SLIP_WORD_LENGTH) return false;
  const [short, long] = scripted.length <= heard.length ? [scripted, heard] : [heard, scripted];
  if (long.length - short.length > 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  const rest = short.length === long.length ? i + 1 : i;
  return short.slice(rest) === long.slice(i + 1);
}

const soundKey = (token) =>
  token
    .replace(/ph/g, "f")
    .replace(/ck|q|c(?![eiy])/g, "k")
    .replace(/(?<=\w{3})oe$/, "o")
    .replace(/(?<=[aeiou])z$/, "s");

/**
 * Where the script's first complete, in-order delivery sits in the heard
 * words, or null. heardTokenOf/heardWordOf give the heard token and word that
 * deliver each (joined) script token; spokenWords lists every heard word that
 * carries a token. #3140: one scripted word misheard as another is paired with
 * the heard word in its place when the next scripted word follows it, but an
 * exact delivery wins. Mirrors scout scribe.ts alignScript.
 */
function alignScript(words, written) {
  const scripted = spokenTokens(written);
  const heardWords = spokenTokens(words.map((w) => w.w));
  const nameLike = nameLikeWords(written);
  const names = scripted.tokens.filter((_, t) => nameLike[scripted.sourceIndex[t]]);
  const heard = joinSplitWords(heardWords, scripted.tokens, names);
  const expected = joinSplitWords(scripted, heard.tokens);
  if (expected.tokens.length === 0 || heard.tokens.length === 0) return null;
  const matches = (e, h) =>
    h < heard.tokens.length && sameWord(expected.tokens[e], heard.tokens[h], nameLike[expected.sourceIndex[e]]);
  const pair = (allowMisheard) => {
    const tokenOf = [];
    let j = 0;
    for (let e = 0; e < expected.tokens.length; e++) {
      const misheard = allowMisheard && !matches(e, j) && e + 1 < expected.tokens.length && matches(e + 1, j + 1);
      if (!misheard) while (j < heard.tokens.length && !matches(e, j)) j++;
      if (j === heard.tokens.length) return null;
      tokenOf.push(j++);
    }
    return tokenOf;
  };
  const heardTokenOf = pair(false) ?? pair(true);
  if (!heardTokenOf) return null;
  return {
    expected,
    heard,
    heardTokenOf,
    heardWordOf: heardTokenOf.map((j) => heard.sourceIndex[j]),
    spokenWords: [...new Set(heardWords.sourceIndex)],
  };
}

/**
 * #2541: the indexes of the heard words that deliver the first and last
 * scripted word, matching the script in order at its earliest delivery, or null
 * when the whole script is not heard that way. #3058: a last word heard split
 * in two ends on its second half.
 */
export function scriptedSpan(words, lineTexts) {
  const aligned = alignScript(words, lineTexts.flatMap(scriptWords));
  if (!aligned) return null;
  const { heard, heardWordOf, heardTokenOf } = aligned;
  return { first: heardWordOf[0], last: heard.lastSourceIndex[heardTokenOf.at(-1)] };
}

/** #2544, #3423: a silence between two sentences longer than this is cut down to the kept length. */
export const SENTENCE_GAP_MAX_SEC = 0.6;
export const SENTENCE_GAP_KEEP_SEC = 0.5;
/** A pause the script writes in: an ellipsis, a dash, or a hyphen standing between words. */
const WRITTEN_PAUSE = /…|\.{3}|[—–-]/;
const SENTENCE_END = /[.?!]/;
/** A heard word that ends a sentence; a heard ellipsis does not (scout scribe.ts HEARD_SENTENCE_END). */
const HEARD_SENTENCE_END = /(?<!\.)[.?!]["'”’)\]]*$/;
/** A heard abbreviation keeps its period mid-sentence ("2p.m.", "U.S.", "Dr."). */
const HEARD_ABBREVIATION = /^[\d:]*(?:\p{L}\.){2,}$|^(?:mr|mrs|ms|dr|st|vs|etc|jr|sr)\.$/iu;

function heardSentenceEnd(word) {
  const bare = String(word ?? "").replace(/^["'“‘(\[]+|["'”’)\]]+$/g, "");
  return HEARD_SENTENCE_END.test(bare) && !HEARD_ABBREVIATION.test(bare);
}
/**
 * #2554: loudness windows, and the levels that read as a sound and as quiet;
 * SETTLED_WINDOWS quiet windows in a row (200 ms) end a sound (scout trim.ts).
 */
const LEVEL_WINDOW_SEC = 0.02;
const SOUND_DB = -35;
const QUIET_DB = -50;
const SETTLED_WINDOWS = 10;
/**
 * #2666: in a gap gone quiet, a fainter sound counts when it stands this far
 * over the gap's median level and reaches FAINT_SOUND_DB, so a grunt in near
 * silence goes while a soft breath and room tone stay (scout trim.ts).
 */
const SOUND_OVER_FLOOR_DB = 25;
const FAINT_SOUND_DB = -45;
/** The directions that ask for a pause (scout clip-qc.ts PAUSE_DIRECTION, NO_PAUSE_DIRECTION, lineWrittenPause). */
const PAUSE_DIRECTION =
  /\bpaus(e|es|ed|ing)\b|\bsilence\b|\(beat\)|\b(a|one|brief|short|quick|small|little|long)\s+beat\b|\bbeat\s*(,|before|after|then)/i;
const NO_PAUSE_DIRECTION =
  /\b(no|not|without|never|don'?t|avoid\w*)\b[^.;]*\b(beats?|paus\w*|silence)\b|\bpause-?(free|less)\b/i;

export function asksPause(line) {
  const direction = `${line?.stageDirection ?? ""} ${line?.performanceDirection ?? ""}`;
  return PAUSE_DIRECTION.test(direction) && !NO_PAUSE_DIRECTION.test(direction);
}

/**
 * #2544: the silences inside one clip to cut, as [{ s, e, after, gap }] in the
 * clip's own time. A heard silence over SENTENCE_GAP_MAX_SEC between two
 * scripted words at a sentence break (a new line, or . ? ! between them) keeps
 * half of SENTENCE_GAP_KEEP_SEC after the earlier word and half before the
 * later one; the rest goes. #3460: a speaker can end a sentence where the
 * script writes a comma, so an earlier word the scribe heard end one counts.
 * Kept: a pause the script writes in (a mark between the words, or a
 * direction on either line asking for one), the laugh beat
 * after a line a reaction is cued to, and any gap with another heard sound in
 * it. Nothing is cut when the script is not heard in order.
 *
 * #2554: given the clip's loudness ({ windowSec, db } from 0), a sound in a
 * break that holds no heard word is cut too, whatever the break's length, and
 * the silence left follows the same rule. Every span of one break carries that
 * break's gap, the silence it keeps, and whether a sound went.
 *
 * lines: [{ text, asksPause, cuesBeat }] in the order the clip speaks them.
 */
export function sentenceGapCuts(words, lines, levels = null) {
  const written = [];
  const pieces = [];
  let between = "";
  lines.forEach((line, li) => {
    for (const piece of scriptWords(line.text)) {
      written.push(piece);
      if (!wordToken(piece)) {
        between += ` ${piece}`;
        pieces.push(null);
        continue;
      }
      const [, lead, trail] = piece.match(/^([^\p{L}\p{N}]*).*?([^\p{L}\p{N}]*)$/u);
      pieces.push({ li, before: between + lead });
      between = trail;
    }
    between += " ";
  });
  const aligned = alignScript(words ?? [], written);
  if (!aligned) return [];
  const { expected, heardTokenOf, heardWordOf, spokenWords: spoken } = aligned;
  const cuts = [];
  for (let t = 0; t + 1 < heardWordOf.length; t++) {
    if (heardTokenOf[t + 1] !== heardTokenOf[t] + 1) continue;
    const to = heardWordOf[t + 1];
    if (heardWordOf[t] === to) continue;
    // A joined script token keeps its first word's line and lead-in.
    const [a, b] = [pieces[expected.sourceIndex[t]], pieces[expected.sourceIndex[t + 1]]];
    const newLine = a.li !== b.li;
    // A name heard split in two (#2300) ends on its last heard word.
    const [earlier, later] = [words[spoken.findLast((w) => w < to)], words[to]];
    if (!newLine && !SENTENCE_END.test(b.before) && !heardSentenceEnd(earlier.w)) continue;
    if (WRITTEN_PAUSE.test(b.before) || lines[a.li].asksPause || lines[b.li].asksPause) continue;
    if (newLine && lines[a.li].cuesBeat) continue;
    const gap = later.s - earlier.e;
    const heard = levels && soundBetween(levels, earlier.e, later.s);
    // A sound's frame edges widen the cut, so none of it is left in.
    const sound = heard && { s: Math.max(floorFrame(heard.s), ceilFrame(earlier.e)), e: ceilFrame(heard.e) };
    const removed = sound ? sound.e - sound.s : 0;
    const spans = sound ? [sound] : [];
    if (gap - removed > SENTENCE_GAP_MAX_SEC + 1e-6) {
      // Placed on the gap with the sound already out, then moved back past it.
      // Frame edges only ever widen what is kept, so the silence left stays
      // between the kept length and the longest allowed.
      const back = (t) => (sound && t > sound.s ? t + removed : t);
      const s = back(ceilFrame(earlier.e + SENTENCE_GAP_KEEP_SEC / 2));
      const e = back(floorFrame(later.s - removed - SENTENCE_GAP_KEEP_SEC / 2));
      if (e > s) spans.push({ s, e });
    }
    const merged = [];
    for (const span of spans.sort((x, y) => x.s - y.s)) {
      const prev = merged.at(-1);
      if (prev && span.s <= prev.e + 1e-6) prev.e = Math.max(prev.e, span.e);
      else merged.push({ ...span });
    }
    const kept = gap - merged.reduce((sum, c) => sum + c.e - c.s, 0);
    for (const { s, e } of merged) cuts.push({ s, e, after: earlier.w, gap, kept, sound: Boolean(sound) });
  }
  return cuts;
}

/**
 * #2554: a sound between two words that holds no heard word, from where the
 * earlier word fades under QUIET_DB to where SETTLED_WINDOWS of quiet resume
 * before the later word, or null when there is none or it runs into the later
 * word. A sound heard only against the gap's quiet (#2666) must come after the
 * gap settles, so the earlier word's own release stays. Mirrors scout trim.ts
 * soundBetween.
 */
function soundBetween(levels, fromSec, toSec) {
  const { db, windowSec } = levels;
  const windowAt = (sec) => Math.floor(sec / windowSec + 1e-9);
  const last = Math.min(windowAt(toSec), db.length);
  let quiet = windowAt(fromSec);
  while (quiet < last && db[quiet] >= QUIET_DB) quiet++;
  const gap = db.slice(quiet, last).sort((a, b) => a - b);
  const faint = Math.min(SOUND_DB, Math.max(FAINT_SOUND_DB, gap[gap.length >> 1] + SOUND_OVER_FLOOR_DB));
  const calm = settledQuiet(db, quiet);
  const loud = (i) => db[i] >= (calm >= 0 && i >= calm + SETTLED_WINDOWS ? faint : SOUND_DB);
  let resumed = -1;
  for (let i = quiet; i < last; i = resumed + SETTLED_WINDOWS) {
    while (i < last && !loud(i)) i++;
    if (i >= last) break;
    const settled = settledQuiet(db, i);
    if (settled < 0 || settled + SETTLED_WINDOWS > last) break;
    resumed = settled;
  }
  return resumed < 0 ? null : { s: quiet * windowSec, e: resumed * windowSec };
}

/** Scanning forward from `from`, the first window of the first run of SETTLED_WINDOWS quiet windows, or -1. */
function settledQuiet(db, from) {
  let run = 0;
  for (let i = from; i < db.length; i++) {
    run = db[i] < QUIET_DB ? run + 1 : 0;
    if (run === SETTLED_WINDOWS) return i - (SETTLED_WINDOWS - 1);
  }
  return -1;
}

/** Per-20 ms RMS loudness (dBFS) of mono s16 PCM, digital silence reading -120 (scout ffmpeg-clip.ts audioLevelsFromPcm). */
export function levelsFromPcm(pcm, sampleRate) {
  const perWindow = Math.round(sampleRate * LEVEL_WINDOW_SEC);
  const db = [];
  for (let from = 0; from < pcm.length; from += perWindow) {
    const to = Math.min(pcm.length, from + perWindow);
    let sumSq = 0;
    for (let i = from; i < to; i++) sumSq += pcm[i] * pcm[i];
    const rms = Math.sqrt(sumSq / (to - from)) / 32768;
    db.push(rms > 0 ? Math.max(-120, 20 * Math.log10(rms)) : -120);
  }
  return { windowSec: LEVEL_WINDOW_SEC, db };
}

/** A clip's loudness windows, or null when its audio cannot be decoded; `filter` shapes the sound first. */
function clipLevels(file, filter = null) {
  const res = spawnSync(
    "ffmpeg",
    [
      "-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "16000",
      ...(filter ? ["-af", filter] : []), "-f", "s16le", "-",
    ],
    { maxBuffer: 1 << 28 },
  );
  if (res.status !== 0 || !res.stdout?.length) return null;
  const bytes = new Uint8Array(res.stdout.subarray(0, res.stdout.length & ~1));
  return levelsFromPcm(new Int16Array(bytes.buffer), 16000);
}

/**
 * Take each own-sound clip's long sentence gaps out of its timeline: its words
 * move onto the cut timeline and it runs shorter, so every later step (join
 * trims, reaction splits, cue times, captions) works in cut time. The renderer
 * removes seg.cuts from the picture and the sound before anything else.
 */
function tightenSentenceGaps(spine, reactionCues, scriptLines, readLevels) {
  for (const seg of spine) {
    if (seg.source !== "clip" || seg.audio !== "clip" || !seg.words?.length) continue;
    const lines = seg.lineIds.map((id) => ({
      text: scriptLines.get(id)?.text,
      asksPause: asksPause(scriptLines.get(id)),
      cuesBeat: reactionCues.has(id),
    }));
    const cuts = sentenceGapCuts(seg.words, lines, readLevels(seg.file));
    if (cuts.length === 0) continue;
    const removedBefore = (t) => cuts.reduce((sum, c) => sum + (c.e <= t ? c.e - c.s : 0), 0);
    const removed = removedBefore(Infinity);
    seg.cuts = cuts.map(({ s, e }) => ({ s, e }));
    seg.words = seg.words.map((w) => ({ ...w, s: w.s - removedBefore(w.s), e: w.e - removedBefore(w.s) }));
    seg.seconds -= removed;
    seg.clipSeconds -= removed;
    seg.note = withHow(
      seg.note,
      [
        ...new Set(
          cuts.map((c) =>
            c.sound
              ? `sound after "${c.after}" cut, pause ${c.gap.toFixed(2)}s -> ${c.kept.toFixed(2)}s`
              : `pause after "${c.after}" tightened ${c.gap.toFixed(2)}s -> ${c.kept.toFixed(2)}s`,
          ),
        ),
      ],
    );
  }
}

const withHow = (note, how) =>
  note.endsWith(")") ? `${note.slice(0, -1)}, ${how.join(", ")})` : `${note} (${how.join(", ")})`;

const CUTAWAY_KINDS = new Set(["cutaway", "insert"]);

const hasText = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * A narrated scene: on a script-bound storyboard (one that carries the member's
 * script lines) the scene has narration and no on-camera line. That is the same
 * fact the server uses to leave a narrator scene's clip mute and its voice track
 * separate. A storyboard without script lines predates that rule: its voiced
 * clips were lip-synced to the voice on the server, so they keep their own audio.
 */
export function narratedScene(scene, storyboard) {
  const scriptBound = Array.isArray(storyboard?.script) && storyboard.script.length > 0;
  const spoken = (Array.isArray(scene?.dialogue) ? scene.dialogue : []).some(
    (turn) => hasText(turn?.line) || hasText(turn?.text),
  );
  return scriptBound && hasText(scene?.voText) && !spoken;
}

export function scenePlans(storyboard) {
  const plans = new Map();
  for (const scene of storyboard?.scenes ?? []) {
    if (typeof scene?.sceneIndex !== "number") continue;
    const speakers = (Array.isArray(scene.dialogue) ? scene.dialogue : [])
      .filter((turn) => hasText(turn?.line) || hasText(turn?.text))
      .map((turn) => (hasText(turn.speaker) ? turn.speaker.trim() : null));
    plans.set(scene.sceneIndex, {
      firstSpeaker: speakers[0] ?? null,
      lastSpeaker: speakers.at(-1) ?? null,
      baseShotId: hasText(scene.baseShotId) ? scene.baseShotId.trim() : null,
      cutaway: CUTAWAY_KINDS.has(scene.kind),
      narrated: narratedScene(scene, storyboard),
      lineIds: Array.isArray(scene.lineIds) ? scene.lineIds : [],
      cueLineId: typeof scene.cueLineId === "string" ? scene.cueLineId : null,
      cutawayType: typeof scene.cutawayType === "string" ? scene.cutawayType : null,
      durationSec: typeof scene.durationSec === "number" ? scene.durationSec : null,
      actionTailSec: typeof scene.actionTailSec === "number" && scene.actionTailSec > 0 ? scene.actionTailSec : 0,
    });
  }
  return plans;
}

/**
 * Fit a picture to its voice track. The segment runs to where the voice stops
 * speaking (spokenEndSec) plus airSec, to the next whole frame; the voice is
 * never altered, only cut in the silence after that point. A clip that runs
 * longer is trimmed; a clip that runs shorter holds its last frame for the
 * difference. A still (no clip) simply runs that length. A scene marked with
 * actionTailSec keeps that long after the voice, up to the clip's end, so the
 * set-down it ends on is seen (#3199).
 */
export function fitNarration({ clipSeconds, spokenEndSec, airSec, actionTailSec = 0 }) {
  const aired = ceilFrame(spokenEndSec + airSec);
  if (clipSeconds === null) return { seconds: aired, holdSec: 0, trimmedBy: 0 };
  const target = Math.max(aired, Math.min(clipSeconds, ceilFrame(spokenEndSec + actionTailSec)));
  if (target <= clipSeconds) {
    return { seconds: target, holdSec: 0, trimmedBy: clipSeconds - target };
  }
  return { seconds: target, holdSec: target - clipSeconds, trimmedBy: 0 };
}

export function cueOffsetOnSpine(spine, counts, cueLineId) {
  for (const seg of spine) {
    const idx = seg.lineIds.indexOf(cueLineId);
    if (idx === -1) continue;
    let precedingWords = 0;
    for (let i = 0; i < idx; i++) precedingWords += counts.get(seg.lineIds[i]) ?? 0;
    let totalWords = 0;
    for (const id of seg.lineIds) totalWords += counts.get(id) ?? 0;

    let within = 0;
    let method = "proportion";
    if (seg.words && seg.words.length > 0) {
      within = Math.max(0, seg.words[Math.min(precedingWords, seg.words.length - 1)]?.s ?? 0);
      method = "words";
    } else if (totalWords > 0) {
      within = (precedingWords / totalWords) * seg.seconds;
    }
    within = Math.min(within, seg.seconds);
    return { startSec: seg.startSec + within, method, spineSceneIndex: seg.sceneIndex };
  }
  return null;
}

/**
 * Where a segment's spoken cue line ends, in seconds into the segment, or null
 * when the segment does not speak it. A cue line that closes the segment ends
 * where the segment does.
 */
export function cueEndInSegment(seg, counts, cueLineId) {
  const idx = seg.lineIds.indexOf(cueLineId);
  if (idx === -1) return null;
  if (idx === seg.lineIds.length - 1) return seg.seconds;
  let through = 0;
  let totalWords = 0;
  seg.lineIds.forEach((id, i) => {
    const n = counts.get(id) ?? 0;
    totalWords += n;
    if (i <= idx) through += n;
  });
  if (seg.words && seg.words.length > 0) {
    const last = seg.words[Math.min(Math.max(through - 1, 0), seg.words.length - 1)];
    return Math.min(Math.max(0, last?.e ?? 0), seg.seconds);
  }
  return totalWords > 0 ? (through / totalWords) * seg.seconds : seg.seconds;
}

/**
 * Cut the dead air out of each join between clips that play their own sound: a
 * clip's lead-in silence stacked on the previous clip's tail ran past a second
 * (#2388). Each side comes back to a beat that reads as one conversation, a
 * longer one when someone new answers. Only ever shortens, never into a word.
 * The ad's first lead-in comes back to the same-speaker beat too, since a clip
 * can hum before its first word (#2666); its last tail comes back to
 * END_AIR_SEC (#3423), and a clip whose closing line cues a reaction is not the
 * ad's end, since the beat follows it. Trims land on whole frames so the
 * picture and its sound stay the same length.
 *
 * The beat is measured from the clip's scripted words when the script is heard
 * in order, and a cut stops short of a sound made up before or after the line
 * ("Hmm", "Um"), even at the ad's own edges (#2541). Sounds inside the line stay.
 * A scene the storyboard marks with actionTailSec keeps that long after its last
 * word, so the action it ends on (her setting the mat down, #3199) is seen.
 */
function trimJoins(spine, reactionCues, scriptLines) {
  spine.forEach((seg, k) => {
    if (seg.source !== "clip" || seg.audio !== "clip" || !seg.words?.length) return;
    const prev = spine[k - 1];
    const sameSpeaker = Boolean(prev?.lastSpeaker) && prev.lastSpeaker === seg.firstSpeaker;
    const lead = sameSpeaker || !prev ? JOIN_LEAD_SAME_SPEAKER_SEC : JOIN_LEAD_NEW_SPEAKER_SEC;
    const span = scriptedSpan(seg.words, seg.lineIds.map((id) => scriptLines.get(id)?.text));
    const line = span ? seg.words.slice(span.first, span.last + 1) : seg.words;
    const before = span ? seg.words.slice(0, span.first) : [];
    const after = span ? seg.words.slice(span.last + 1) : [];
    const firstWord = Math.min(...line.map((w) => w.s));
    const lastWord = Math.max(...line.map((w) => w.e));
    let inSec = Math.max(0, floorFrame(firstWord - lead));
    if (before.length > 0) {
      const clear = ceilFrame(Math.max(...before.map((w) => w.e)) + EXTRA_CLEARANCE_SEC);
      inSec = Math.max(inSec, Math.min(clear, floorFrame(firstWord)));
    }
    const endsAd = k === spine.length - 1 && !reactionCues.has(seg.lineIds.at(-1));
    const tailSec = Math.max(endsAd ? END_AIR_SEC : JOIN_TAIL_SEC, seg.actionTailSec ?? 0);
    let outSec = ceilFrame(lastWord + tailSec);
    if (after.length > 0) {
      const clear = floorFrame(Math.min(...after.map((w) => w.s)) - EXTRA_CLEARANCE_SEC);
      outSec = Math.min(outSec, Math.max(clear, ceilFrame(lastWord)));
    }
    outSec = Math.min(seg.seconds, outSec);
    if (outSec <= inSec) return;
    const how = [];
    if (inSec > 0) how.push(`lead-in trimmed ${inSec.toFixed(2)}s`);
    if (outSec < seg.seconds) how.push(`tail trimmed ${(seg.seconds - outSec).toFixed(2)}s`);
    if (how.length === 0) return;
    const kept = seg.words.filter((w) => w.s < outSec && w.e > inSec);
    if (before.some((w) => !kept.includes(w))) how.push("extra sound before the line trimmed");
    if (after.some((w) => !kept.includes(w))) how.push("extra sound after the line trimmed");
    seg.inSec = inSec;
    seg.seconds = outSec - inSec;
    seg.words = kept.map((w) => ({ ...w, s: w.s - inSec, e: w.e - inSec }));
    seg.note = withHow(seg.note, how);
  });
}

/**
 * Where a narrated segment stops speaking, and the air it keeps after (#3384).
 * voiceWords are word times taken from the voice track itself. Without them
 * the end of the voice file stands in for the last word, its own trailing
 * silence counted as part of the air.
 */
function narrationEnd(voiceSeconds, voiceWords, endsAd) {
  return {
    spokenEndSec: voiceWords?.length ? Math.max(...voiceWords.map((w) => w.e)) : voiceSeconds,
    airSec: endsAd ? END_AIR_SEC : NARRATION_JOIN_AIR_SEC,
  };
}

const holdFor = (seg) =>
  seg.source === "clip" ? Math.max(0, seg.seconds - Math.max(0, seg.clipSeconds - seg.inSec)) : 0;

/**
 * Put a reaction beat into the spine right after its cue line ends, splitting
 * the segment that speaks it when more lines follow in that segment. Returns
 * the scene that speaks the cue, or null when no segment does.
 */
function placeReaction(spine, counts, reaction) {
  for (let k = 0; k < spine.length; k++) {
    const seg = spine[k];
    if (seg.reaction) continue;
    const cueEnd = cueEndInSegment(seg, counts, reaction.cueLineId);
    if (cueEnd === null) continue;
    const cut = Math.min(seg.seconds, ceilFrame(cueEnd));
    const beat = {
      sceneIndex: reaction.sceneIndex, source: reaction.source, file: reaction.file,
      clipSeconds: reaction.source === "clip" ? reaction.seconds : null, inSec: 0,
      seconds: Math.min(reaction.seconds, REACTION_MAX_SEC), holdSec: 0,
      audio: reaction.hasAudio ? "clip" : "silence", voice: null, words: null, lineIds: [],
      reaction: { cueLineId: reaction.cueLineId, cueSceneIndex: seg.sceneIndex },
    };
    if (cut >= seg.seconds - 0.05) {
      spine.splice(k + 1, 0, beat);
      return seg.sceneIndex;
    }
    const idx = seg.lineIds.indexOf(reaction.cueLineId);
    const head = {
      ...seg, seconds: cut, lineIds: seg.lineIds.slice(0, idx + 1),
      words: seg.words ? seg.words.filter((w) => w.s < cut) : null,
      note: `${seg.note}, until ${reaction.cueLineId} ends at ${cut.toFixed(2)}s`,
    };
    const tail = {
      ...seg, inSec: seg.inSec + cut, seconds: seg.seconds - cut, lineIds: seg.lineIds.slice(idx + 1),
      words: seg.words
        ? seg.words.filter((w) => w.s >= cut).map((w) => ({ ...w, s: w.s - cut, e: w.e - cut }))
        : null,
      note: `${seg.note}, resumed at ${cut.toFixed(2)}s after reaction ${reaction.sceneIndex}`,
    };
    head.holdSec = holdFor(head);
    tail.holdSec = holdFor(tail);
    spine.splice(k, 1, head, beat, tail);
    return seg.sceneIndex;
  }
  return null;
}

/**
 * The sound a reaction beat carries under the next segment (#2406), as a J/L
 * cut: the picture moves on early and the clip's sound from where it stops
 * plays under the next line. A clip that ends with its beat gives up the
 * beat's end, down to REACTION_MIN_BEAT_SEC, rather than replaying sound the
 * beat already played, which was heard as a stutter (#2666, #2700). Shortens
 * the beat, so it runs before the spine's start times are set. Null when
 * under 0.4 s of sound would carry over; the beat fades itself out then.
 */
function carveReactionTail(seg, next) {
  const clipLen = seg.clipSeconds ?? seg.seconds;
  const overlap =
    Math.round(Math.min(REACTION_TAIL_SEC, clipLen - seg.inSec - REACTION_MIN_BEAT_SEC, next.seconds) * 1000) / 1000;
  if (overlap < REACTION_FADE_OUT_SEC) return null;
  seg.seconds = Math.min(seg.seconds, Math.round((clipLen - seg.inSec - overlap) * 1000) / 1000);
  return { fromSec: seg.inSec + seg.seconds, seconds: overlap, gain: REACTION_TAIL_GAIN };
}

/**
 * #2666: how long a reaction beat fades in. A generated laugh clip can hum
 * before the laugh starts, so the fade runs across that quiet start, up to its
 * first sound; without the clip's loudness it is the plain edge fade.
 */
function quietStart(levels, seconds) {
  const first = levels ? levels.db.findIndex((d) => d >= SOUND_DB) : -1;
  return first > 0 ? Math.min(seconds, Math.max(EDGE_FADE_SEC, first * levels.windowSec)) : EDGE_FADE_SEC;
}

/**
 * Alternate one speaker's scenes in a row between the plain frame and the
 * punch-in, so every cut between them visibly moves in or out. Any other cut
 * starts the alternation again. Marked before reactions split a scene, so both
 * halves keep their scene's frame.
 */
function markPunchIns(spine, sameShot) {
  let punched = false;
  spine.forEach((seg, k) => {
    const prev = spine[k - 1];
    punched = Boolean(prev) && sameShot(prev, seg) && !punched;
    if (punched) seg.punchIn = true;
  });
}

const sameSpeaker = (prev, seg) => Boolean(prev.lastSpeaker && seg.firstSpeaker === prev.lastSpeaker);

/**
 * The pacings whose edit punches in, each with when a scene plays on in the
 * shot of the one before it. Jump cuts film every scene in one framing. A
 * montage changes shot on every cut, except where the line cut split a long
 * line into pieces that keep their parent's base shot (#3317, #3323).
 */
const PUNCH_IN_RUNS = new Map([
  ["jump-cuts", sameSpeaker],
  ["montage", (prev, seg) =>
    sameSpeaker(prev, seg) && Boolean(seg.baseShotId) && seg.baseShotId === prev.baseShotId],
]);

/**
 * #3365: the scenes the cut cannot be made without, by number. A scene the
 * storyboard plans needs a clip unless --skip names it, even one the pull has
 * no row for. A scene it does not plan is a row a re-board left behind, so it
 * is no loss. With no storyboard, every scene the pull lists counts.
 */
export function scenesWithNoClip({ manifest, storyboard, skip, exists = Boolean }) {
  const planned = [...scenePlans(storyboard).keys()];
  const listed = (manifest?.scenes ?? []).map((scene) => scene.sceneIndex);
  const clipped = new Set(
    (manifest?.scenes ?? []).filter((scene) => exists(scene.clip)).map((scene) => scene.sceneIndex),
  );
  return [...new Set(planned.length > 0 ? planned : listed)]
    .filter((n) => !skip.has(n) && !clipped.has(n))
    .sort((a, b) => a - b);
}

export function buildTimeline({
  manifest, storyboard, skip, probe, exists, readWords, readLevels = () => null, stillFill = false,
}) {
  const plans = scenePlans(storyboard);
  const counts = lineWordCounts(storyboard);
  const spine = [];
  const cutaways = [];
  const waiting = [];
  const dropped = [];
  const missing = new Set(scenesWithNoClip({ manifest, storyboard, skip, exists }));
  const filled = new Set();
  // A narrated segment is first fitted as a join; the one that ends the ad is
  // refitted once the spine is known.
  const refits = new Map();

  for (const scene of manifest?.scenes ?? []) {
    const n = scene.sceneIndex;
    const plan = plans.get(n) ?? {
      cutaway: false, lineIds: [], cueLineId: null, cutawayType: null, durationSec: null,
      firstSpeaker: null, lastSpeaker: null,
    };
    if (skip.has(n)) {
      dropped.push({ n, reason: `scene ${n}: skipped by --skip` });
      continue;
    }
    const nothing = `nothing to cut with (clip ${scene.clipStatus}${scene.error ? `: ${scene.error}` : ""})`;

    if (plan.cutaway) {
      const cue = { cueLineId: plan.cueLineId, reaction: plan.cutawayType === "reaction" };
      if (exists(scene.clip)) {
        const clip = probe(scene.clip);
        waiting.push({
          sceneIndex: n, source: "clip", file: scene.clip,
          seconds: clip.seconds, hasAudio: clip.hasAudio, ...cue,
        });
      } else if (stillFill && exists(scene.keyframe)) {
        filled.add(n);
        waiting.push({
          sceneIndex: n, source: "still", file: scene.keyframe,
          seconds: plan.durationSec ?? 4, hasAudio: false, ...cue,
        });
      } else if (!missing.has(n)) {
        dropped.push({ n, reason: `cutaway ${n}: ${nothing}` });
      }
      continue;
    }

    const narrated = plan.narrated || scene.wordsFrom === "voice";
    const voice = exists(scene.voice) ? scene.voice : null;
    const flag = scene.flagged ? " (flagged)" : "";

    if (exists(scene.clip)) {
      const clip = probe(scene.clip);
      const base = {
        sceneIndex: n, source: "clip", file: scene.clip, clipSeconds: clip.seconds, inSec: 0,
        lineIds: plan.lineIds, firstSpeaker: plan.firstSpeaker, lastSpeaker: plan.lastSpeaker,
        baseShotId: plan.baseShotId ?? null, actionTailSec: plan.actionTailSec ?? 0,
      };
      if (voice && (narrated || !clip.hasAudio)) {
        const voiceSeconds = probe(voice).seconds;
        const words = readWords(scene.words);
        // A clip's own word times describe the clip, not the voice that replaces its audio.
        const voiceWords = scene.wordsFrom === "voice" ? words : null;
        const fitted = (endsAd) => {
          const fit = fitNarration({
            clipSeconds: clip.seconds, ...narrationEnd(voiceSeconds, voiceWords, endsAd),
            actionTailSec: plan.actionTailSec ?? 0,
          });
          const how = [];
          if (fit.trimmedBy > 0.05) how.push(`clip trimmed ${clip.seconds.toFixed(1)}s -> ${fit.seconds.toFixed(1)}s`);
          if (fit.holdSec > 0.05) how.push(`last frame held ${fit.holdSec.toFixed(1)}s`);
          return {
            seconds: fit.seconds, holdSec: fit.holdSec,
            note: `${flag}, ${voice} replaces the clip's audio${how.length ? ` (${how.join(", ")})` : ""}`,
          };
        };
        const seg = { ...base, audio: "narration", voice, words, ...fitted(false) };
        spine.push(seg);
        refits.set(seg, fitted);
      } else if (narrated) {
        spine.push({
          ...base, audio: "silence", voice: null, seconds: clip.seconds, holdSec: 0,
          words: null,
          note: `${flag}, narrated scene without its voice track: the clip's own audio is muted`,
        });
      } else if (clip.hasAudio) {
        spine.push({
          ...base, audio: "clip", voice: null, seconds: clip.seconds, holdSec: 0,
          words: readWords(scene.words), note: `${flag}, its own dialogue`,
        });
      } else {
        spine.push({
          ...base, audio: "silence", voice: null, seconds: clip.seconds, holdSec: 0,
          words: null, note: `${flag}, silent clip`,
        });
      }
      continue;
    }
    if (stillFill && exists(scene.keyframe)) {
      filled.add(n);
      const voiceSeconds = voice ? probe(voice).seconds : 0;
      // #1689: on a narrated scene the words are the voice track's, and the
      // voice starts where the segment does, so they need no offset here.
      const words = voice ? readWords(scene.words) : null;
      const voiceWords = scene.wordsFrom === "voice" ? words : null;
      const fitted = (endsAd) => {
        const seconds = voice
          ? fitNarration({ clipSeconds: null, ...narrationEnd(voiceSeconds, voiceWords, endsAd) }).seconds
          : plan.durationSec ?? 4;
        return {
          seconds,
          note: `${flag}${voice ? ` + ${voice}` : ", silent"} (${seconds.toFixed(1)}s, clip ${scene.clipStatus})`,
        };
      };
      const seg = {
        sceneIndex: n, source: "still", file: scene.keyframe, clipSeconds: null, inSec: 0,
        audio: voice ? "narration" : "silence", voice, holdSec: 0,
        lineIds: plan.lineIds, firstSpeaker: plan.firstSpeaker, lastSpeaker: plan.lastSpeaker,
        baseShotId: plan.baseShotId ?? null, words, ...fitted(false),
      };
      spine.push(seg);
      if (voice) refits.set(seg, fitted);
      continue;
    }
    if (!missing.has(n)) dropped.push({ n, reason: `scene ${n}: ${nothing}` });
  }
  const unfilled = [...missing].filter((n) => !filled.has(n));
  if (unfilled.length > 0) {
    const listed = new Map((manifest?.scenes ?? []).map((scene) => [scene.sceneIndex, scene]));
    throw new FirstCutError(1, noClipRefusal(unfilled.map((n) => {
      const scene = listed.get(n);
      return {
        n,
        keyframe: Boolean(scene) && exists(scene.keyframe),
        status: scene ? `clip ${scene.clipStatus}${scene.error ? `: ${scene.error}` : ""}` : "clip missing",
      };
    })));
  }

  const sameShot = PUNCH_IN_RUNS.get(manifest?.shots?.pacing);
  if (sameShot) markPunchIns(spine, sameShot);

  const noCue = (c) =>
    c.cueLineId ? `${c.cueLineId} is spoken by no scene in the cut` : "the storyboard names no cue line";

  // Sentence gaps and then joins are closed first so a reaction beat lands
  // right after its cue line ends in the trimmed clip. Reactions change the
  // spine, so they go in before any overlay is placed on it.
  const scriptLines = new Map((storyboard?.script ?? []).map((line) => [line?.lineId, line]));
  const reactionCues = new Set(waiting.filter((w) => w.reaction).map((w) => w.cueLineId));
  const last = spine.at(-1);
  if (refits.has(last) && !reactionCues.has(last.lineIds.at(-1))) Object.assign(last, refits.get(last)(true));
  tightenSentenceGaps(spine, reactionCues, scriptLines, readLevels);
  trimJoins(spine, reactionCues, scriptLines);
  for (const c of waiting.filter((w) => w.reaction)) {
    if (!c.cueLineId || placeReaction(spine, counts, c) === null) {
      dropped.push({ n: c.sceneIndex, reason: `cutaway ${c.sceneIndex}: ${noCue(c)}` });
    }
  }
  spine.forEach((seg, k) => {
    if (!seg.reaction || seg.audio !== "clip") return;
    const tail = spine[k + 1] ? carveReactionTail(seg, spine[k + 1]) : null;
    if (tail) seg.reaction.tail = tail;
    else seg.fadeOutSec = Math.min(REACTION_FADE_OUT_SEC, seg.seconds);
    seg.fadeInSec = quietStart(readLevels(seg.file), seg.seconds);
  });
  let total = 0;
  for (const seg of spine) {
    seg.startSec = total;
    total += seg.seconds;
  }
  spine.forEach((seg, k) => {
    if (seg.reaction?.tail) seg.reaction.tail.atSec = spine[k + 1].startSec;
  });

  for (const c of waiting.filter((w) => !w.reaction)) {
    const cue = c.cueLineId ? cueOffsetOnSpine(spine, counts, c.cueLineId) : null;
    if (!cue) {
      dropped.push({ n: c.sceneIndex, reason: `cutaway ${c.sceneIndex}: ${noCue(c)}` });
      continue;
    }
    cutaways.push({ ...c, startSec: cue.startSec, method: cue.method, spineSceneIndex: cue.spineSceneIndex });
  }
  cutaways.sort((a, b) => a.startSec - b.startSec);
  const beats = spine.filter((seg) => seg.reaction);
  for (let i = 0; i < cutaways.length; i++) {
    const c = cutaways[i];
    const stops = [];
    const next = cutaways[i + 1];
    if (next) stops.push({ at: next.startSec, by: `cutaway ${next.sceneIndex} starts` });
    const beat = beats.find((b) => b.startSec >= c.startSec);
    if (beat) stops.push({ at: beat.startSec, by: `reaction ${beat.sceneIndex} starts` });
    stops.push({ at: total, by: "the ad ends" });
    const stop = stops.reduce((a, b) => (b.at < a.at ? b : a));
    if (c.startSec + c.seconds > stop.at) {
      c.seconds = Math.max(0, stop.at - c.startSec);
      c.cutShortBy = stop.by;
    }
  }

  return {
    spine,
    cutaways,
    left: dropped.sort((a, b) => a.n - b.n).map((d) => d.reason),
  };
}

/** #3365: why the cut stopped on scenes with no clip, and the person's three ways on. */
function noClipRefusal(missing) {
  const scenes = missing.map((m) => `scene ${m.n} (${m.status})`).join(", ");
  const skip = `--skip ${missing.map((m) => m.n).join(",")}`;
  const bare = missing.filter((m) => !m.keyframe).map((m) => m.n);
  const ways = bare.length === missing.length
    ? `Wait for the clips and pull again, or leave them out with ${skip}.`
    : `Wait for the clips and pull again, leave them out with ${skip}, ` +
      "or hold each one's keyframe on screen instead with --still-fill (under its voice track if it has one, " +
      "else silent for its planned length)." +
      (bare.length > 0 ? ` --still-fill cannot cover scene ${bare.join(", ")}, which has no keyframe either.` : "");
  return `No clip for ${scenes}. ${ways}`;
}

function sec(n) {
  return (Number.isFinite(n) ? Math.max(0, n) : 0).toFixed(3);
}

export function buildFfmpegArgs(timeline, { resolve, music, out }) {
  const inputs = [];
  let count = 0;
  const addInput = (...args) => {
    inputs.push(...args);
    return count++;
  };
  const filters = [];
  const pairs = [];
  const tails = [];

  for (const seg of timeline.spine) {
    const i =
      seg.source === "clip"
        ? addInput("-i", resolve(seg.file))
        : addInput("-loop", "1", "-t", String(seg.seconds), "-i", resolve(seg.file));
    const fit = [];
    const inSec = seg.inSec ?? 0;
    // #2544: sentence gaps come out first, the picture by frame number and the
    // sound by the same times, so everything after works on the cut timeline.
    const cuts = seg.cuts ?? [];
    let heard = `[${i}:a]${stereo},`;
    if (cuts.length > 0) {
      const frames = cuts.map((c) => `between(n\\,${Math.round(c.s * FPS)}\\,${Math.round(c.e * FPS) - 1})`);
      fit.push(`select=not(${frames.join("+")}),setpts=N/FRAME_RATE/TB`);
      const kept = [0, ...cuts.flatMap((c) => [c.s, c.e])];
      const pieces = cuts.length + 1;
      filters.push(`[${i}:a]${stereo},asplit=${pieces}${Array.from({ length: pieces }, (_, p) => `[ap${i}_${p}]`).join("")}`);
      for (let p = 0; p < pieces; p++) {
        const end = p < cuts.length ? `:end=${kept[2 * p + 1].toFixed(6)}` : "";
        filters.push(`[ap${i}_${p}]atrim=start=${kept[2 * p].toFixed(6)}${end},asetpts=PTS-STARTPTS[aq${i}_${p}]`);
      }
      filters.push(
        `${Array.from({ length: pieces }, (_, p) => `[aq${i}_${p}]`).join("")}concat=n=${pieces}:v=0:a=1[ac${i}]`,
      );
      heard = `[ac${i}]`;
    }
    if (seg.source === "clip" && seg.clipSeconds !== null) {
      const shown = seg.seconds - seg.holdSec;
      if (inSec > 0.001 || shown < seg.clipSeconds - 0.01) {
        // By frame number: a time printed to the millisecond can round past the
        // frame it names and drop it.
        const from = Math.round(inSec * FPS);
        fit.push(`trim=start_frame=${from}:end_frame=${Math.round((inSec + shown) * FPS)},setpts=PTS-STARTPTS`);
      }
    }
    if (seg.holdSec > 0.01) fit.push(`tpad=stop_mode=clone:stop_duration=${sec(seg.holdSec)}`);
    if (seg.punchIn) fit.push(PUNCH_IN);
    filters.push(`${norm(`${i}:v`)}${fit.length ? `,${fit.join(",")}` : ""}[v${i}]`);
    // A segment split around a reaction beat starts partway into its sound too.
    const skipIn = inSec > 0.001 ? `atrim=start=${sec(inSec)},asetpts=PTS-STARTPTS,` : "";
    const [fadeIn, fadeOut] = [seg.fadeInSec ?? EDGE_FADE_SEC, seg.fadeOutSec ?? EDGE_FADE_SEC];
    // A cubic rise keeps a reaction's quiet start near silent until its laugh (#2666).
    const rise = fadeIn > EDGE_FADE_SEC ? ":curve=cub" : "";
    const fitLength =
      `apad,atrim=0:${sec(seg.seconds)},afade=t=in:d=${sec(fadeIn)}${rise},` +
      `afade=t=out:st=${sec(seg.seconds - fadeOut)}:d=${sec(fadeOut)}`;
    const fitSound = `${LOUDNORM},${fitLength}`;
    if (seg.audio === "narration") {
      const v = addInput("-i", resolve(seg.voice));
      filters.push(`[${v}:a]${stereo},${skipIn}${fitSound}[a${i}]`);
    } else if (seg.audio === "clip" && seg.reaction?.tail) {
      // The tail is cut from the same loudness-normalized sound as the beat,
      // ducked, faded out, and laid in at the join; the next line's own sound
      // plays at full level over it (#2406).
      const t = seg.reaction.tail;
      filters.push(`${heard}${skipIn}${LOUDNORM},asplit=2[as${i}][at${i}]`);
      filters.push(`[as${i}]${fitLength}[a${i}]`);
      filters.push(
        `[at${i}]atrim=start=${sec(t.fromSec - inSec)}:duration=${sec(t.seconds)},asetpts=PTS-STARTPTS,` +
          `volume=${t.gain},afade=t=in:d=${EDGE_FADE_SEC},afade=t=out:st=0:d=${sec(t.seconds)},` +
          `adelay=delays=${Math.round(t.atSec * 1000)}:all=1[tail${i}]`,
      );
      tails.push(`[tail${i}]`);
    } else if (seg.audio === "clip") {
      filters.push(`${heard}${skipIn}${fitSound}[a${i}]`);
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${sec(seg.seconds)}[a${i}]`);
    }
    pairs.push(`[v${i}][a${i}]`);
  }

  filters.push(`${pairs.join("")}concat=n=${pairs.length}:v=1:a=1[vcat][voicecat]`);
  // The sound is padded or cut to the picture's exact length, so every stream
  // ends on its own. No -shortest: ffmpeg 8 held the whole ad's frames for it,
  // and Debian's ffmpeg 5.1 (the worker's) never ended at all (#2988).
  const pictureSec = timeline.spine.reduce((sum, seg) => sum + seg.seconds, 0);
  filters.push(`[voicecat]apad,atrim=end=${pictureSec.toFixed(6)}[voice]`);

  let videoLabel = "vcat";
  timeline.cutaways.forEach((c, j) => {
    const i =
      c.source === "clip"
        ? addInput("-i", resolve(c.file))
        : addInput("-loop", "1", "-t", String(c.seconds), "-i", resolve(c.file));
    const end = c.startSec + c.seconds;
    filters.push(
      `${norm(`${i}:v`)},trim=0:${sec(c.seconds)},setpts=PTS-STARTPTS+${sec(c.startSec)}/TB[cv${j}]`,
    );
    // eof_action=pass keeps the spine showing once the cutaway's frames end.
    filters.push(
      `[${videoLabel}][cv${j}]overlay=enable=between(t\\,${sec(c.startSec)}\\,${sec(end)}):eof_action=pass[ov${j}]`,
    );
    videoLabel = `ov${j}`;
  });

  filters.push(`${ROOM_TONE}[room]`);
  const beds = ["[room]", ...tails];
  if (music) {
    const m = addInput("-stream_loop", "-1", "-i", music);
    filters.push(`[${m}:a]${stereo},volume=${MUSIC_VOLUME}[bed]`);
    beds.push("[bed]");
  }
  filters.push(
    `[voice]${beds.join("")}amix=inputs=${beds.length + 1}:duration=first:dropout_transition=0:normalize=0[mix]`,
  );
  const audioLabel = "mix";

  return [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    out,
  ];
}

const roundMs = (n) => Math.round(n * 1000) / 1000;

/**
 * #3300: every stretch of the cut where a scene is the picture, in order. A
 * cutaway covers the whole frame, so the spine scene under it is off screen
 * there and its placement splits around it. A scene split around a reaction
 * beat, or shown twice, has one entry per stretch.
 */
export function sceneTimes(timeline) {
  const covers = timeline.cutaways
    .filter((c) => c.seconds > 0)
    .map((c) => ({ from: c.startSec, to: c.startSec + c.seconds }));
  const visible = timeline.spine.flatMap((seg) => {
    let pieces = [{ from: seg.startSec, to: seg.startSec + seg.seconds }];
    for (const c of covers) {
      pieces = pieces.flatMap((p) =>
        c.to <= p.from || c.from >= p.to
          ? [p]
          : [{ from: p.from, to: c.from }, { from: c.to, to: p.to }].filter((q) => q.to > q.from),
      );
    }
    return pieces.map((p) => ({ sceneIndex: seg.sceneIndex, startSec: p.from, seconds: p.to - p.from }));
  });
  return [...visible, ...timeline.cutaways]
    .map((p) => ({ scene: p.sceneIndex, startSec: roundMs(p.startSec), seconds: roundMs(p.seconds) }))
    .filter((p) => p.seconds > 0)
    .sort((a, b) => a.startSec - b.startSec);
}

export function wordRows(timeline) {
  const rows = [];
  for (const seg of timeline.spine) {
    for (const w of seg.words ?? []) {
      const text = (w.w ?? "").trim();
      const start = seg.startSec + w.s;
      const end = seg.startSec + w.e;
      if (text && end > start) {
        rows.push({ text, start: roundMs(start), end: roundMs(end), scene: seg.sceneIndex });
      }
    }
  }
  return rows;
}

const SRT_MAX_WORDS = 5;
const SRT_GAP_SEC = 1.0;

export function srtCues(rows) {
  const cues = [];
  let cue = [];
  for (let i = 0; i < rows.length; i++) {
    cue.push(rows[i]);
    const next = rows[i + 1];
    const ends =
      !next ||
      /[.!?,;:]$/.test(rows[i].text) ||
      cue.length >= SRT_MAX_WORDS ||
      next.scene !== rows[i].scene ||
      next.start - rows[i].end > SRT_GAP_SEC;
    if (ends) {
      cues.push(cue);
      cue = [];
    }
  }
  return cues;
}

export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n, width) => String(n).padStart(width, "0");
  return (
    `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:` +
    `${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`
  );
}

export function toSrt(rows) {
  return srtCues(rows)
    .map((cue, i) => {
      const text = cue.map((r) => r.text).join(" ");
      return `${i + 1}\n${srtTime(cue[0].start)} --> ${srtTime(cue[cue.length - 1].end)}\n${text}\n`;
    })
    .join("\n");
}

export function sidecarPaths(outPath) {
  const dir = path.dirname(outPath);
  const base = path.basename(outPath, path.extname(outPath));
  return {
    words: path.join(dir, `${base}.words.json`),
    srt: path.join(dir, `${base}.srt`),
    scenes: path.join(dir, `${base}.scenes.json`),
  };
}

export function inTheCut(timeline) {
  const rows = [];
  for (const seg of timeline.spine) {
    const label = seg.source === "clip" ? seg.file : `still ${seg.file}`;
    if (seg.reaction) {
      const sound = seg.audio === "clip" ? "its own sound" : "silent: the clip has no sound";
      const tail = seg.reaction.tail;
      const fadeIn =
        seg.fadeInSec > EDGE_FADE_SEC ? `, fading in over its quiet first ${seg.fadeInSec.toFixed(2)}s` : "";
      const fadeOut = tail
        ? `, fading out under the next line at ${tail.atSec.toFixed(2)}s over ${tail.seconds.toFixed(2)}s`
        : seg.fadeOutSec ? `, fading out over its last ${seg.fadeOutSec.toFixed(2)}s` : "";
      const fades = fadeIn + fadeOut;
      rows.push({
        n: seg.sceneIndex,
        line:
          `reaction ${seg.sceneIndex}: ${label} for ${seg.seconds.toFixed(1)}s after ` +
          `${seg.reaction.cueLineId} in scene ${seg.reaction.cueSceneIndex}, ${sound}${fades}`,
      });
      continue;
    }
    rows.push({ n: seg.sceneIndex, line: `scene ${seg.sceneIndex}: ${label}${seg.note}` });
  }
  for (const c of timeline.cutaways) {
    const label = c.source === "clip" ? c.file : `still ${c.file}`;
    const how =
      c.method === "words"
        ? "word times"
        : `proportion: scene ${c.spineSceneIndex} has no word times`;
    const cut = c.cutShortBy ? `, cut short where ${c.cutShortBy}` : "";
    rows.push({
      n: c.sceneIndex,
      line:
        `cutaway ${c.sceneIndex}: ${label} at ${c.startSec.toFixed(2)}s for ${c.seconds.toFixed(1)}s, ` +
        `cued to ${c.cueLineId} in scene ${c.spineSceneIndex} (${how})${cut}`,
    });
  }
  return rows.sort((a, b) => a.n - b.n).map((r) => r.line);
}

/**
 * #2666: a generated clip can hum or click where nobody speaks, and the cut
 * plays that stretch with nothing over it. A hum is HUM_BAND's share of the
 * sound (the 1 kHz whine heard before a first word) holding for HUM_MIN_SEC
 * over HUM_FLOOR_DB; a click is a sound of at most CLICK_MAX_WINDOWS with
 * quiet on both sides, loud as the gap cutter reads a sound in near silence.
 */
export const HUM_BAND = "highpass=f=800,highpass=f=800,lowpass=f=1500,lowpass=f=1500";
// White noise measures about -13.5 dB through HUM_BAND at 16 kHz (-10.6 dB on
// paper), and the four hums #2666 was calibrated on held -6 to -10 dB.
const HUM_SHARE_DB = -10;
const HUM_FLOOR_DB = -70;
const HUM_MIN_SEC = 0.16;
const CLICK_MAX_WINDOWS = 3;

/**
 * Where the cut plays a clip's sound with no word in it, in the clip's own
 * time: before a dialogue clip's first word, after its last, and a reaction's
 * quiet start (under its cubic fade-in when the cut fades it).
 */
function edgeStretches(seg, levels) {
  const inSec = seg.inSec ?? 0;
  if (seg.reaction) {
    const quiet = quietStart(levels, seg.seconds);
    if (quiet <= EDGE_FADE_SEC) return [];
    const fadeIn = seg.fadeInSec ?? 0;
    return [{ side: "before its laugh", from: inSec, to: inSec + quiet, at: seg.startSec, fadeIn }];
  }
  if (!seg.words?.length) return [];
  // inSec and the words are on the clip's timeline with its sentence gaps
  // taken out; the levels are the file's own, so each edge goes back through
  // the cuts before it.
  const raw = (t) => {
    let at = t;
    for (const c of seg.cuts ?? []) if (c.s <= at) at += c.e - c.s;
    return at;
  };
  const first = seg.words[0].s;
  const last = Math.max(...seg.words.map((w) => w.e));
  const shown = seg.seconds - (seg.holdSec ?? 0);
  return [
    { side: "before its first word", from: raw(inSec), to: raw(inSec + first), at: seg.startSec, fadeIn: 0 },
    {
      side: "after its last word", from: raw(inSec + last), to: raw(inSec + shown),
      at: seg.startSec + last, fadeIn: 0,
    },
  ];
}

/**
 * The hums and clicks the cut plays at the edges of its clips, one line each,
 * for the caller to listen to. It never changes the cut. readEdgeLevels(file)
 * gives { windowSec, db, bandDb } from time 0, or null.
 */
export function edgeSounds(timeline, readEdgeLevels) {
  const found = [];
  for (const seg of timeline.spine) {
    if (seg.source !== "clip" || seg.audio !== "clip") continue;
    const levels = readEdgeLevels(seg.file);
    if (!levels) continue;
    const { windowSec, db, bandDb } = levels;
    for (const stretch of edgeStretches(seg, levels)) {
      const from = Math.ceil(stretch.from / windowSec - 1e-9);
      const to = Math.min(db.length, Math.floor(stretch.to / windowSec + 1e-9));
      if (to - from < 2) continue;
      const heard = [];
      for (let i = from; i < to; i++) {
        const into = (i + 0.5) * windowSec - stretch.from;
        const faded = stretch.fadeIn > 0 && into < stretch.fadeIn;
        const gain = faded ? 60 * Math.log10(Math.max(1e-3, into / stretch.fadeIn)) : 0;
        heard.push({ i, db: db[i] + gain, share: bandDb[i] - db[i] });
      }
      const cutAt = (i) => stretch.at + i * windowSec - stretch.from;
      const where = `scene ${seg.sceneIndex}, ${stretch.side}`;
      let run = 0;
      let longest = { length: 0, end: 0 };
      heard.forEach((w, k) => {
        run = w.db >= HUM_FLOOR_DB && w.share >= HUM_SHARE_DB ? run + 1 : 0;
        if (run > longest.length) longest = { length: run, end: k };
      });
      if (longest.length * windowSec >= HUM_MIN_SEC - 1e-9) {
        const start = heard[longest.end - longest.length + 1].i;
        found.push(
          `${where}: a hum for ${(longest.length * windowSec).toFixed(2)}s at ${cutAt(start).toFixed(2)}s in the cut`,
        );
      }
      const sorted = heard.map((w) => w.db).sort((a, b) => a - b);
      const loud = Math.max(FAINT_SOUND_DB, sorted[sorted.length >> 1] + SOUND_OVER_FLOOR_DB);
      for (let k = 1; k < heard.length - 1; k++) {
        if (heard[k].db < loud || heard[k - 1].db >= QUIET_DB) continue;
        let end = k;
        while (end < heard.length && heard[end].db >= loud) end++;
        if (end < heard.length && heard[end].db < QUIET_DB && end - k <= CLICK_MAX_WINDOWS) {
          found.push(`${where}: a click at ${cutAt(heard[k].i).toFixed(2)}s in the cut`);
        }
        k = end;
      }
    }
  }
  return found;
}

export function noWordTimes(timeline) {
  const rows = timeline.spine
    .filter((seg) => !seg.words || seg.words.length === 0)
    .map((seg) => `scene ${seg.sceneIndex} (${seg.reaction ? "reaction" : "no words.json"})`);
  for (const c of timeline.cutaways) rows.push(`scene ${c.sceneIndex} (cutaway)`);
  return rows;
}

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

/** A refusal the CLI prints to stderr and exits with `code`, so another caller can do the same or not. */
export class FirstCutError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FirstCutError";
    this.code = code;
  }
}

function parseArgs(argv) {
  const opts = { dir: undefined, out: undefined, skip: new Set(), music: true, stillFill: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--skip") opts.skip = new Set((argv[++i] ?? "").split(",").filter(Boolean).map(Number));
    else if (a === "--no-music") opts.music = false;
    else if (a === "--still-fill") opts.stillFill = true;
    else if (a.startsWith("--")) fail(2, `unknown flag ${a}\n${USAGE}`);
    else if (opts.dir === undefined) opts.dir = a;
    else fail(2, `unexpected argument ${a}\n${USAGE}`);
  }
  if (!opts.dir) fail(2, USAGE);
  return opts;
}

/**
 * The whole cut, as the CLI makes it, for any caller (#2988: the worker cuts a
 * Video-page run with this). Renders `out` (default <dir>/cut.mp4) and its word
 * sidecars, and throws FirstCutError where the CLI would exit. The CLI's report
 * is printed by main() from what this returns.
 */
export function firstCut({ dir, out: outOpt, skip = new Set(), music: musicOn = true, stillFill = false }) {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    if (spawnSync(bin, ["-version"]).status !== 0) {
      throw new FirstCutError(2, `${bin} is not installed. Install ffmpeg (brew install ffmpeg / apt install ffmpeg).`);
    }
  }
  const encoders = spawnSync("ffmpeg", ["-hide_banner", "-encoders"]).stdout?.toString() ?? "";
  if (!/\blibx264\b/.test(encoders)) {
    throw new FirstCutError(2, "This ffmpeg has no libx264 encoder (H.264). Install a full ffmpeg build: brew install ffmpeg / apt install ffmpeg.");
  }

  const manifestPath = path.join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new FirstCutError(2, `${manifestPath} not found. Run: exodus video pull <runId> --out ${dir}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const out = path.resolve(outOpt ?? path.join(dir, "cut.mp4"));
  const here = (file) => path.join(dir, file);
  const exists = (file) => Boolean(file) && existsSync(here(file));

  const readJson = (file) => {
    if (!exists(file)) return null;
    try {
      return JSON.parse(readFileSync(here(file), "utf8"));
    } catch {
      return null;
    }
  };
  const probe = (file) => {
    const raw = execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_type,duration:stream_disposition=attached_pic:format=duration", "-of", "json", here(file),
    ]).toString();
    const info = JSON.parse(raw);
    // A clip's container runs a few ms past its picture on the audio's padding;
    // the picture is what the cut shows, so its length is the clip's length.
    const picture = Number((info.streams ?? []).find((s) => s.codec_type === "video" && !s.disposition?.attached_pic)?.duration);
    return {
      seconds: picture > 0 ? picture : Number(info.format?.duration ?? 0),
      hasAudio: (info.streams ?? []).some((s) => s.codec_type === "audio"),
    };
  };

  const storyboard = readJson(manifest.storyboard);
  if (!storyboard) {
    console.error(`Warning: ${manifest.storyboard ?? "storyboard.json"} is missing or unreadable, so every scene is cut as A-roll and no cutaway is placed.`);
  }
  const timeline = buildTimeline({
    manifest,
    storyboard,
    skip,
    stillFill,
    probe,
    exists,
    readWords: (file) => {
      const rows = readJson(file);
      return Array.isArray(rows) && rows.length > 0 ? rows : null;
    },
    readLevels: (file) => clipLevels(here(file)),
  });
  if (timeline.spine.length === 0) {
    throw new FirstCutError(1, `No scene has a clip or a keyframe. Check: exodus video status ${manifest.runId}`);
  }

  const music = musicOn && exists(manifest.music) ? manifest.music : null;
  const ffmpegArgs = buildFfmpegArgs(timeline, {
    resolve: here,
    music: music ? here(music) : null,
    out,
  });
  const res = spawnSync("ffmpeg", ffmpegArgs, { stdio: "inherit" });
  if (res.status !== 0) {
    const quoted = ffmpegArgs.map((a) => (/[\s\[\];]/.test(a) ? `'${a}'` : a)).join(" ");
    throw new FirstCutError(1, `ffmpeg failed. The command it ran:\n  ffmpeg ${quoted}`);
  }

  const rows = wordRows(timeline);
  const sidecars = sidecarPaths(out);
  if (rows.length > 0) {
    writeFileSync(sidecars.words, `${JSON.stringify(rows, null, 2)}\n`);
    writeFileSync(sidecars.srt, toSrt(rows));
  } else {
    rmSync(sidecars.words, { force: true });
    rmSync(sidecars.srt, { force: true });
  }
  writeFileSync(sidecars.scenes, `${JSON.stringify(sceneTimes(timeline), null, 2)}\n`);

  const duration = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out,
  ]).toString().trim();
  return { out, durationSec: Number(duration), manifest, timeline, music, rows, sidecars };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let cut;
  try {
    cut = firstCut(opts);
  } catch (e) {
    if (e instanceof FirstCutError) fail(e.code, e.message);
    throw e;
  }
  const { out, durationSec, manifest, timeline, music, rows, sidecars } = cut;
  const here = (file) => path.join(opts.dir, file);

  console.log(`Wrote ${out} (${durationSec.toFixed(1)}s, ${WIDTH}x${HEIGHT})`);
  console.log("In the cut:");
  for (const line of inTheCut(timeline)) console.log("  " + line);
  if (timeline.left.length > 0) {
    console.log("Left out:");
    for (const line of timeline.left) console.log("  " + line);
  }
  if (rows.length > 0) {
    const scenes = [...new Set(rows.map((r) => r.scene))].join(", ");
    console.log(
      `Words: ${rows.length} words from scenes ${scenes} -> ${path.basename(sidecars.words)}, ${path.basename(sidecars.srt)}`,
    );
  } else {
    console.log("Words: none delivered, no caption files written");
  }
  const silent = noWordTimes(timeline);
  if (silent.length > 0) console.log(`No word times: ${silent.join(", ")}`);
  const edges = edgeSounds(timeline, (file) => {
    const levels = clipLevels(here(file));
    const band = levels && clipLevels(here(file), HUM_BAND);
    return band ? { ...levels, bandDb: band.db } : null;
  });
  if (edges.length > 0) {
    console.log("Sound at the edges (listen before uploading; the cut is unchanged):");
    for (const line of edges) console.log("  " + line);
  }
  console.log(`Room tone: under the whole ad. Music bed: ${music ?? "none"}`);
  console.log(`Upload it: exodus video upload ${manifest.runId} --file ${out}`);
}

// #2988: the basename test too, because a bundler that inlines this file into
// its entry would otherwise run the CLI inside whatever imported it.
if (
  process.argv[1] &&
  path.basename(process.argv[1]) === "first-cut.mjs" &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
