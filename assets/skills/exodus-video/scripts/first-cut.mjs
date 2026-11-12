#!/usr/bin/env node
// A plain first cut from a folder written by `exodus video pull`: the A-roll
// scenes in the manifest's order make the spine, each cutaway lays over the
// spine at the moment its cued line is spoken, a room-tone bed and the music
// bed go underneath, and one MP4 comes out ready to upload. A reaction
// cutaway is the exception: it is its own short beat in the spine right after
// its cued line ends, heard with its own sound while the speaker is silent,
// fading in across any quiet start and out rather than stopping dead. A B-roll
// cutaway lays over just the words it covers, from the first to the last.
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
//
// A kind can turn on finishing settings, which reach this file as the
// manifest's `finishing` (see finishingOf). Without it the cut is the one
// described above, byte for byte. The same holds for its sound settings, which
// reach this file as the manifest's `sound` (see soundOf), and for a voice
// that is one song laid whole, the manifest's `wholeVoice` (see wholeVoiceOf).
// Trusted template songs without a separate underlay meter the voice alone
// (bedLufs=null), without inventing a bed for cutChecks. Other doors are unchanged.
// Trusted external-audio templates may use a recorded retained-frame hold for billed-source fit.
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { planText, READOUT_INSET_BOX } from "./first-cut-text.mjs";
import { createTextRenderer, measuredTextAss, textFrameWindow } from "./first-cut-text-render.mjs";
import { isZeroDurationSpeech, templateActionWindows, templateJoinAnchors, templateSpeechEdit, TEMPLATE_SPEECH_LEAD_SEC, TEMPLATE_SPEECH_TAIL_SEC } from "./first-cut-speech.mjs";

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
/**
 * pacePass: the finished cut plays at `speed`, picture and sound, and every
 * second piece of the spine is a centre crop scaled up by `zoom`, a small zoom
 * step at each cut. The manifest's paceSpeed, within PACE_SPEED_RANGE, plays
 * it at its own speed instead.
 */
export const PACE_PASS = { speed: 1.12, zoom: 1.07 };
export const PACE_SPEED_RANGE = { min: 1.02, max: 1.25 };
const paceSpeedOk = (v) => Number.isFinite(v) && v >= PACE_SPEED_RANGE.min && v <= PACE_SPEED_RANGE.max;

/**
 * The pace record's note for a paceSpeed the cut does not use (pacePass off,
 * or not a speed in PACE_SPEED_RANGE), or null. The worker calls it too, for a
 * run's stored paceSpeed that never reached the manifest.
 */
export function paceSpeedNote(finishing) {
  if (!isObject(finishing) || finishing.paceSpeed === undefined) return null;
  const v = finishing.paceSpeed;
  const shown = typeof v === "number" ? String(v) : JSON.stringify(v);
  if (finishing.pacePass !== true) return `paceSpeed ${shown} is read only with pacePass, which is off, so it was not used`;
  return paceSpeedOk(v) ? null
    : `paceSpeed ${shown} is not a speed from ${PACE_SPEED_RANGE.min} to ${PACE_SPEED_RANGE.max}, so it was not used`;
}
const PACE_ZOOM =
  `scale=${even(WIDTH * PACE_PASS.zoom)}:${even(HEIGHT * PACE_PASS.zoom)},crop=${WIDTH}:${HEIGHT},setsar=1`;
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
/**
 * talkTrim: the most air a talking clip keeps after its last word, the ad's
 * last line included. A join keeps JOIN_TAIL_SEC already, which is less.
 */
export const TALK_TRIM_SEC = 0.3;
/** A continuous low bed under the whole ad, so the joins between clips do not read as dead air. */
const ROOM_TONE =
  "anoisesrc=color=brown:amplitude=0.0035:r=48000,highpass=f=60,lowpass=f=900,aformat=channel_layouts=stereo";
const MUSIC_VOLUME = 0.18;
/** Legacy reaction default without an authored source endpoint/reservation (#2357). */
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
/**
 * A B-roll shot arrives this long before the first word it covers, the lead the
 * top ads use and the planner teaches (#3936).
 */
export const BROLL_LEAD_SEC = 0.5;
/**
 * A B-roll shot holds over the words it covers (#3912) or for its planned
 * length, whichever runs longer (#3936), but never shorter than the eye needs
 * to read it nor so long it drags; a shot planned past the longest hold (a
 * talking character) keeps its planned length.
 */
export const BROLL_MIN_HOLD_SEC = 0.8;
export const BROLL_MAX_HOLD_SEC = 4;

/**
 * The finishing settings (a kind's cutPace, captions, cards, finishLoudness).
 * cutPace: at most PACE_GAP_MAX_SEC of air where a new speaker answers; a pause
 * over PACE_SPLIT_PAUSE_SEC where one line ends and the next begins is cut to
 * PACE_GAP_MAX_SEC and the take is split there, every other piece punched in;
 * the cut sped up, at most SPEED_MAX, when it runs past the kind's
 * targetSeconds; and a pace report. A speed under SPEED_FLOOR is not worth
 * the change and is left at 1.
 */
export const PACE_GAP_MAX_SEC = 0.35;
export const PACE_SPLIT_PAUSE_SEC = 0.45;
export const SPEED_MAX = 1.15;
const SPEED_FLOOR = 1.02;
/** A shot longer than this counts as long in the pace report. */
export const LONG_SHOT_SEC = 4;
/** A pause in the voice at least this long is one the pace report reads. */
const PACE_PAUSE_SEC = 0.2;
/** A card lands this long before the first word of the line it is cued to. */
export const CARD_LEAD_SEC = 0.07;
/** finishLoudness: the whole mix's target, and the true peak a cut may not pass after it. */
export const FINISH_LUFS = -14;
export const FINISH_TRUE_PEAK = -1.5;
export const FINISH_LRA = 11;
export const TRUE_PEAK_MAX_DB = -1;
/**
 * limitPeaks: after the loudness pass, the sound oversampled 4x through a
 * limiter at 0.8 (about -1.9 dB), so a peak between two samples is caught too.
 * The cut is still measured after and refused over TRUE_PEAK_MAX_DB. Its
 * resample is pinned to stereo, as every one after loudnorm is (loudnessApplyArgs).
 */
export const PEAK_LIMITER = "aresample=192000,aformat=channel_layouts=stereo,alimiter=limit=0.8:level=false:attack=2:release=60";
/**
 * jumpCut: inside a talking clip, a pause over maxGap between two heard words
 * is cut down, keeping keepAfter after the earlier word and keepBefore before
 * the later one. It rides
 * the sentence-gap cut, so a pause the script writes in, one a direction asks
 * for and a reaction's beat stay whole there too.
 */
export const JUMP_CUT = { maxGap: 0.8, keepAfter: 0.18, keepBefore: 0.12 };

/** jumpCut on one pause, from `endSec` to `startSec`: the span it takes out, or null when it keeps the pause whole. */
export function jumpCutSpan(endSec, startSec, jump = JUMP_CUT) {
  if (!(startSec - endSec > jump.maxGap + 1e-6)) return null;
  const s = endSec + jump.keepAfter;
  const e = startSec - jump.keepBefore;
  return e > s ? { s, e } : null;
}

/** Plan 14's on/off cut checks, each read only with cutChecks; paceCheck also carries its numbers. */
const PLAN_14_CHECKS = ["floorCheck", "flashCheck", "levelStepCheck", "voFitCheck", "dashGapCheck", "nameCheck"];
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** paceCheck's numbers: PACE_BARS', each replaced by the manifest's own where it gives a number above 0 and at most 10. */
function paceBarsOf(raw) {
  const own = isObject(raw) ? raw : {};
  return Object.fromEntries(
    PACE_BAR_KEYS.map((key) => [key, Number.isFinite(own[key]) && own[key] > 0 && own[key] <= 10 ? own[key] : PACE_BARS[key]]),
  );
}

/**
 * The manifest's finishing settings, or null when none is on. The worker
 * writes them from the run's frozen kind settings, so a redo of the run cuts
 * with the same ones. A setting added after the first four is present only
 * when it is on and can act (captionsByLine needs captions).
 */
export function finishingOf(manifest) {
  const f = manifest?.finishing;
  if (!f || typeof f !== "object") return null;
  const on = {
    cutPace: f.cutPace === true,
    captions: f.captions === true,
    cards: f.cards === true,
    finishLoudness: f.finishLoudness === true,
  };
  const added = {
    ...(on.captions && f.captionsByLine === true ? { captionsByLine: true } : {}),
    ...(f.cleanVoice === true ? { cleanVoice: true } : {}),
    ...(on.finishLoudness && f.limitPeaks === true ? { limitPeaks: true } : {}),
    ...(Number.isFinite(f.brollMinSec) && f.brollMinSec > 0 ? { brollMinSec: f.brollMinSec } : {}),
    ...(f.speedUpSlowBroll === true ? { speedUpSlowBroll: true } : {}),
    ...(f.cutChecks === true ? { cutChecks: true } : {}),
    ...(f.cutChecks === true && f.blipCheck === true ? { blipCheck: true } : {}),
    ...(f.cutChecks === true && f.freezeCheck === true ? { freezeCheck: true } : {}),
    ...Object.fromEntries(PLAN_14_CHECKS.filter((key) => f.cutChecks === true && f[key] === true).map((key) => [key, true])),
    ...(f.cutChecks === true && (f.paceCheck === true || isObject(f.paceCheck)) ? { paceCheck: paceBarsOf(f.paceCheck) } : {}),
    // Plan 14: the end card from the pack photo, and the record of whether the brand reached the ad (brandOf).
    ...(f.endCardLayers === true ? { endCardLayers: true } : {}),
    ...(f.brandCheck === true ? { brandCheck: true } : {}),
    ...(f.jumpCut === true ? { jumpCut: true } : {}),
    ...(f.talkTrim === true ? { talkTrim: true } : {}),
    ...(on.captions && f.captionsByLine === true && f.captionColours === true ? { captionColours: true } : {}),
    ...(f.pacePass === true ? { pacePass: true } : {}),
    ...(f.pacePass === true && paceSpeedOk(f.paceSpeed) ? { paceSpeed: f.paceSpeed } : {}),
  };
  if (!Object.values(on).some(Boolean) && Object.keys(added).length === 0) return null;
  const target = f.targetSeconds;
  return on.cutPace && Number.isFinite(target) && target > 0 ? { ...on, targetSeconds: target, ...added } : { ...on, ...added };
}

/**
 * The sound settings (a kind's soundEffects, roomTone, music "suno" and
 * musicOnlyMaster), as the manifest's `sound`: the files the worker made for
 * this run. A sound lands SOUND_LEAD_SEC before the first word of the line it
 * is cued to, SOUND_UNDER_DB under the voice there. A room-tone bed runs from
 * its set's first scene (the first bed from the start) to the next bed, looped,
 * BED_UNDER_DB under the voice, in place of the brown-noise room tone; a bed
 * quieter than BED_FLOOR_LUFS, or with no loudness to measure, is left out and
 * noted. With `duck` the music sits MUSIC_UNDER_DB under the voice and a
 * sidechain compressor keyed on the voice ducks it (DUCK). With
 * musicOnlyMaster a second file beside the cut carries the cut's picture and
 * the music alone, at FINISH_LUFS. The voice's level is SEGMENT_LUFS where
 * every segment is levelled to it, else each segment's file is measured.
 */
export const SOUND_UNDER_DB = 10;
export const SOUND_LEAD_SEC = 0.03;
const SOUND_FALLBACK_DB = -22;
export const BED_UNDER_DB = 24;
export const BED_FLOOR_LUFS = -70;
const BED_FADE_SEC = 0.15;
export const MUSIC_UNDER_DB = 16.8;
const MUSIC_FALLBACK_DB = -20;
export const DUCK = { threshold: 0.05, ratio: 2.5, attack: 20, release: 350 };
/**
 * cleanVoice: the voice's chain (rumble cut, light noise reduction, de-essing,
 * gentle compression), and what happens to the room, sounds and music under
 * it: down UNDER_VOICE.db, trimmed under `highpass` and over `lowpass` Hz, and
 * ducked by a compressor keyed on the cleaned voice. It is the one duck: the
 * music's own (DUCK) is left out. A reaction's tail is a voice, so it is
 * neither cleaned nor ducked.
 */
export const VOICE_CLEAN =
  "highpass=f=90,afftdn=nr=8:nf=-38,deesser=i=0.35,acompressor=threshold=0.125:ratio=2.5:attack=8:release=150:makeup=1.5";
export const UNDER_VOICE = { db: -6, highpass: 60, lowpass: 9000, duck: { threshold: 0.03, ratio: 5, attack: 15, release: 300 } };
const CLEAN_FILTERS = ["highpass", "lowpass", "afftdn", "deesser", "acompressor", "sidechaincompress"];
const SEGMENT_LUFS = -16;
/** A voice at or under this is no level to set a sound against. */
const VOICE_FLOOR_LUFS = -60;

/** Parse selected sound files; firstCut supplies the single actual song-master decision. */
export function soundOf(manifest, songMaster = false) {
  const s = songMaster ? {} : manifest?.sound ?? {};
  const roomTone = songMaster ? false : manifest?.roomTone;
  if ((!s || typeof s !== "object") && roomTone !== false) return null;
  const listed = (xs, ok) => (Array.isArray(xs) ? xs.filter((x) => typeof x?.file === "string" && ok(x)) : []);
  const sound = {
    effects: listed(s.effects, (x) => typeof x.cueLineId === "string"),
    beds: roomTone === false ? [] : listed(s.beds, (x) => Number.isFinite(x.fromScene)),
    duck: s.duck === true,
    musicOnlyMaster: s.musicOnlyMaster === true,
    ...(typeof roomTone === "boolean" ? { roomTone } : {}),
  };
  return sound.effects.length || sound.beds.length || sound.duck || sound.musicOnlyMaster || roomTone === false ? sound : null;
}

/** The voice's level over segments [{ seconds, lufs }], added by power and weighted by length. */
export function voiceLufsOf(levels) {
  const heard = levels.filter((l) => Number.isFinite(l.lufs) && l.seconds > 0);
  const total = heard.reduce((t, l) => t + l.seconds, 0);
  if (total <= 0) return null;
  return round2(10 * Math.log10(heard.reduce((t, l) => t + l.seconds * 10 ** (l.lufs / 10), 0) / total));
}

const heardVoice = (lufs) => Number.isFinite(lufs) && lufs > VOICE_FLOOR_LUFS;

/** The gain (dB) that puts a sound `underDb` under the voice; `fallback` when either level is unknown. */
export function gainUnder(voiceLufs, underDb, soundLufs, fallback) {
  return heardVoice(voiceLufs) && Number.isFinite(soundLufs) ? round2(voiceLufs - underDb - soundLufs) : fallback;
}

/**
 * Where each sound and bed plays and how loud, from the cut's timeline.
 * `measure(file)` is a file's loudness in LUFS, or null.
 */
export function soundPlan(sound, timeline, storyboard, { levelled, measure, template = false }) {
  const notes = [];
  const spine = timeline.spine;
  const pictureSec = spine.reduce((t, seg) => t + seg.seconds, 0);
  const segLufs = spine.map((seg) => {
    if (seg.audio !== "narration" && seg.audio !== "clip") return null;
    return levelled ? SEGMENT_LUFS : measure(seg.audio === "narration" ? seg.voice : seg.file);
  });
  const voiceLufs = voiceLufsOf(spine.map((seg, k) => ({ seconds: seg.seconds, lufs: segLufs[k] })));
  const counts = lineWordCounts(storyboard);
  const effects = [];
  for (const e of sound.effects) {
    const timed = timeline.narratedShotList === true || [e.offsetSec, e.durationSec, e.volumeDb].some(Number.isFinite);
    const heard = timed ? wordRows(timeline).filter((word) => word.lineId === e.cueLineId) : [];
    const cue = timed
      ? heard.length ? { startSec: Math.min(...heard.map((word) => word.start)) + (e.offsetSec ?? 0) } : null
      : cueOffsetOnSpine(spine, counts, e.cueLineId);
    if (!cue) {
      if (timed && (!template || e.required === true)) throw new SourceMapRefusal("A timed sound has no actual canonical cue word", [
        { severity: "refuse", code: "sound-cue-unmeasured", scene: null, detail: e.cueLineId },
      ]);
      notes.push(`${template && timed ? "sound-cue-unmeasured: " : ""}the sound cued to ${e.cueLineId} is left out: the cut does not speak that line`);
      continue;
    }
    const k = spine.findIndex((seg) => cue.startSec < seg.startSec + seg.seconds);
    if (timed && (cue.startSec < 0 || cue.startSec >= pictureSec ||
      (Number.isFinite(e.durationSec) && (!(e.durationSec > 0) || cue.startSec + e.durationSec > pictureSec + 1e-7)))) {
      if (template && e.required !== true) {
        notes.push(`sound-cue-window: optional sound ${e.file} omitted outside the retained cut clock`);
        continue;
      }
      throw new SourceMapRefusal("An authored sound window lies outside the complete audio/picture clock", [
        { severity: "refuse", code: "sound-cue-window", scene: null, detail: e.cueLineId },
      ]);
    }
    const under = Number.isFinite(e.underDb) ? e.underDb : SOUND_UNDER_DB;
    effects.push({
      ...(timeline.mapped || timed ? e : {}),
      file: e.file, cueLineId: e.cueLineId,
      // A mapped cut keeps the intended heard cue independent from the actual file placement.
      ...(timeline.mapped || timed || e.source ? { plannedOnsetSec: r6(cue.startSec) } : {}),
      atSec: timeline.mapped || timed
        ? (Math.round(cue.startSec * EDIT_SAMPLE_RATE) - Math.round((e.source?.eventWindow?.fromSec ?? 0) * EDIT_SAMPLE_RATE)) / EDIT_SAMPLE_RATE
        : roundMs(Math.max(0, cue.startSec - SOUND_LEAD_SEC)),
      gainDb: Number.isFinite(e.volumeDb) ? e.volumeDb : gainUnder(segLufs[k] ?? voiceLufs, under, measure(e.file), SOUND_FALLBACK_DB),
    });
  }
  const bedRef = heardVoice(voiceLufs) ? voiceLufs : FINISH_LUFS;
  const heard = [];
  for (const b of sound.beds) {
    const seg = spine.find((x) => x.sceneIndex === b.fromScene);
    const lufs = measure(b.file);
    if (!seg) notes.push(`the bed for scene ${b.fromScene} is left out: that scene is not in the cut`);
    else if (!Number.isFinite(lufs) || lufs < BED_FLOOR_LUFS) {
      notes.push(`the bed ${b.file} is left out: ${Number.isFinite(lufs) ? `${lufs} LUFS is under ${BED_FLOOR_LUFS}` : "it has no loudness to measure"}`);
    } else {
      const under = Number.isFinite(b.underDb) ? b.underDb : BED_UNDER_DB;
      heard.push({ ...(timeline.mapped ? b : {}), file: b.file, fromScene: b.fromScene, from: seg.startSec, gainDb: round2(bedRef - under - lufs) });
    }
  }
  heard.sort((a, b) => a.from - b.from);
  const beds = heard.map((b, k) => {
    const startSec = k === 0 ? 0 : timeline.mapped ? b.from : roundMs(b.from);
    const end = k + 1 < heard.length ? heard[k + 1].from : pictureSec;
    return {
      ...(timeline.mapped ? b : {}), file: b.file, fromScene: b.fromScene, startSec,
      seconds: timeline.mapped ? end - startSec : roundMs(Math.max(0.1, end - startSec)), gainDb: b.gainDb,
    };
  });
  return { voiceLufs, effects, beds, notes };
}

/** The music's gain under the voice when it is ducked. */
export function duckedMusicGain(voiceLufs, musicLufs) {
  return gainUnder(voiceLufs, MUSIC_UNDER_DB, musicLufs, MUSIC_FALLBACK_DB);
}

/** musicOnlyMaster: the cut's picture as it is, with the music alone in place of the mix. */
export function musicOnlyMasterArgs(cut, music, seconds, gainDb, out) {
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-i", cut, "-stream_loop", "-1", "-i", music,
    "-filter_complex", `[1:a]${stereo},atrim=0:${sec(seconds)},asetpts=PTS-STARTPTS,volume=${gainDb}dB[music]`,
    "-map", "0:v:0", "-map", "[music]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  ];
}

/** How much a cut of `seconds` is sped up to come near the kind's target length: 1 when it is not. */
export function speedFor(seconds, targetSeconds) {
  if (!(targetSeconds > 0) || !(seconds > 0)) return 1;
  const want = Math.min(SPEED_MAX, seconds / targetSeconds);
  return want > SPEED_FLOOR ? roundMs(want) : 1;
}

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
 * #3671: the #3558 words that sound the same ("your", "you're") are one spoken
 * word, as in scout scribe.ts.
 */
const SAME_WORD_SPELLINGS = new Map([
  ["ok", "okay"],
  ["alright", "allright"],
  ["youre", "your"],
  ["theyre", "their"],
  ["there", "their"],
  ["too", "to"],
]);

/**
 * A word as people say it, read as its written long form, as in scout
 * scribe.ts SPOKEN_FORMS: "go get 'em" is "go get them", "gonna" is "going to".
 */
const SPOKEN_FORMS = new Map([
  ["em", ["them"]], ["gonna", ["going", "to"]], ["wanna", ["want", "to"]], ["gotta", ["got", "to"]],
  ["kinda", ["kind", "of"]], ["sorta", ["sort", "of"]], ["lemme", ["let", "me"]], ["gimme", ["give", "me"]],
  ["cause", ["because"]], ["cuz", ["because"]], ["til", ["until"]], ["till", ["until"]], ["ya", ["you"]],
  ["yeah", ["yes"]], ["yep", ["yes"]],
]);

/**
 * #3433: the number reading of scout spokenNumbers.ts, so a script's "$29" and a
 * scribe's "twenty nine dollars" line up here as they do in the server's cut.
 * Mirrors numericWords and its tables.
 */
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINAL_ONES = [
  "zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh",
  "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth",
  "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
  "nineteenth",
];
const ORDINAL_TENS = [
  "", "", "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth",
  "seventieth", "eightieth", "ninetieth",
];
const NUMBER_WORDS = new Set([
  ...ONES,
  ...TENS.filter(Boolean),
  "hundred",
  ...ORDINAL_ONES,
  ...ORDINAL_TENS.filter(Boolean),
]);

/** Null from 1000 up: "2026" has no single spoken form, so it stays written on both sides. */
function cardinalWords(n) {
  if (!Number.isInteger(n) || n < 0 || n >= 1000) return null;
  if (n < 20) return [ONES[n]];
  if (n < 100) {
    const unit = n % 10;
    const tens = TENS[Math.floor(n / 10)];
    return unit === 0 ? [tens] : [tens, ONES[unit]];
  }
  const rest = n % 100 === 0 ? [] : (cardinalWords(n % 100) ?? []);
  return [ONES[Math.floor(n / 100)], "hundred", ...rest];
}

function ordinalWords(n) {
  if (!Number.isInteger(n) || n < 0 || n >= 100) return null;
  if (n < 20) return [ORDINAL_ONES[n]];
  const unit = n % 10;
  const tens = Math.floor(n / 10);
  return unit === 0 ? [ORDINAL_TENS[tens]] : [TENS[tens], ORDINAL_ONES[unit]];
}

const asInt = (digits) => Number.parseInt(digits.replace(/,/g, ""), 10);

function clockWords(hourDigits, minuteDigits) {
  const hour = cardinalWords(asInt(hourDigits));
  if (!hour) return null;
  if (minuteDigits === undefined) return hour;
  const minute = asInt(minuteDigits);
  if (minute === 0) return hour;
  if (minute < 10) return [...hour, "oh", ONES[minute]];
  return [...hour, ...(cardinalWords(minute) ?? [])];
}

/** Spoken words for a written number form ("2:30", "2pm", "20%", "$5.50", "3rd", "1,000"), or null. */
function numericWords(core) {
  const time = /^(\d{1,2}):(\d{2})$/.exec(core);
  if (time) return clockWords(time[1], time[2]);

  const meridiem = /^(\d{1,2})(?::(\d{2}))?([ap])\.?m\.?$/.exec(core);
  if (meridiem) {
    const clock = clockWords(meridiem[1], meridiem[2]);
    return clock ? [...clock, `${meridiem[3]}m`] : null;
  }

  const percent = /^(\d[\d,]*)%$/.exec(core);
  if (percent) {
    const amount = cardinalWords(asInt(percent[1]));
    return amount ? [...amount, "percent"] : null;
  }

  const money = /^\$(\d[\d,]*)(?:\.(\d{2}))?$/.exec(core);
  if (money) {
    const amount = asInt(money[1]);
    const dollars = cardinalWords(amount);
    if (!dollars) return null;
    const unit = amount === 1 ? "dollar" : "dollars";
    const cents = money[2] === undefined ? 0 : asInt(money[2]);
    if (cents === 0) return [...dollars, unit];
    return [...dollars, unit, ...(cardinalWords(cents) ?? [])];
  }

  const ordinal = /^(\d+)(?:st|nd|rd|th)$/.exec(core);
  if (ordinal) return ordinalWords(asInt(ordinal[1]));

  if (/^\d[\d,]*$/.test(core)) return cardinalWords(asInt(core));
  return null;
}

/** The spoken tokens of one written word, before SAME_WORD_SPELLINGS; empty for pure punctuation. */
function spokenForms(word) {
  const lower = String(word ?? "").toLowerCase();
  // "twenty-five", "3-pack", "F-150" split; "e-mail" stays whole.
  if (lower.includes("-")) {
    const parts = lower.split("-").filter(Boolean);
    const isNumber = (p) => /\d/.test(p) || NUMBER_WORDS.has(p.replace(/[^a-z]/g, ""));
    if (parts.length > 1 && parts.some(isNumber)) return parts.flatMap(spokenForms);
  }
  // Keep a leading "$" and a trailing "%". They decide how the number is said.
  const core = lower.replace(/^[^\p{L}\p{N}$]+/u, "").replace(/[^\p{L}\p{N}%]+$/u, "");
  const numeric = numericWords(core);
  if (numeric) return numeric;
  // #3133: a scribe writes a spoken "glowmist dot com" as "Glowmist.com".
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z]{2,})+$/.test(core)) {
    return core.split(".").flatMap((part, i) => [...(i ? ["dot"] : []), ...spokenForms(part)]);
  }
  const plain = wordToken(core);
  // "F150" must read the same as "F-150", which the hyphen split above expands.
  if (/\p{L}/u.test(plain) && /\p{N}/u.test(plain)) {
    return (plain.match(/\p{L}+|\p{N}+/gu) ?? []).flatMap(spokenForms);
  }
  return plain ? [plain] : [];
}

/** The spoken tokens of one written word; empty for pure punctuation. */
function spokenWords(word) {
  return spokenForms(word).flatMap((t) => SPOKEN_FORMS.get(t) ?? [t]).map((t) => SAME_WORD_SPELLINGS.get(t) ?? t);
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
 *
 * lineGap ({ max, keep }, cutPace): where one line ends and the next begins,
 * a silence over `max` is cut to `keep` instead, and that break's last span
 * carries `atLine`, the index of the line after it, where the take is split.
 *
 * jump (JUMP_CUT, the jumpCut setting): any pause over jump.maxGap between two
 * script words, inside a sentence too, keeps jump.keepAfter after the earlier
 * word and jump.keepBefore before the later one instead (jumpCutSpan), on
 * whole frames. The pauses kept above stay kept.
 */
export function sentenceGapCuts(words, lines, levels = null, lineGap = null, jump = null) {
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
    const sentenceBreak = newLine || SENTENCE_END.test(b.before) || heardSentenceEnd(earlier.w);
    // Inside a sentence only jumpCut acts, and only on a pause over its longest.
    if (!sentenceBreak && !(jump && jumpCutSpan(earlier.e, later.s, jump))) continue;
    if (WRITTEN_PAUSE.test(b.before) || lines[a.li].asksPause || lines[b.li].asksPause) continue;
    if (newLine && lines[a.li].cuesBeat) continue;
    const gap = later.s - earlier.e;
    const heard = levels && soundBetween(levels, earlier.e, later.s);
    // A sound's frame edges widen the cut, so none of it is left in.
    const sound = heard && { s: Math.max(floorFrame(heard.s), ceilFrame(earlier.e)), e: ceilFrame(heard.e) };
    const removed = sound ? sound.e - sound.s : 0;
    const spans = sound ? [sound] : [];
    const [gapMax, gapKeep] =
      lineGap && newLine ? [lineGap.max, lineGap.keep] : [SENTENCE_GAP_MAX_SEC, SENTENCE_GAP_KEEP_SEC];
    // jumpCut: a pause over its longest keeps its two edges, with a sound in it taken out whole.
    const jumped = Boolean(jump) && gap - removed > jump.maxGap + 1e-6;
    const paused = jumped || (sentenceBreak && gap - removed > gapMax + 1e-6);
    if (paused) {
      // Placed on the gap with the sound already out, then moved back past it.
      // Frame edges only ever widen what is kept, so the silence left stays
      // between the kept length and the longest allowed.
      const back = (t) => (sound && t > sound.s ? t + removed : t);
      const [keepAfter, keepBefore] = jumped ? [jump.keepAfter, jump.keepBefore] : [gapKeep / 2, gapKeep / 2];
      const s = back(ceilFrame(earlier.e + keepAfter));
      const e = back(floorFrame(later.s - removed - keepBefore));
      if (e > s) spans.push({ s, e });
    }
    const merged = [];
    for (const span of spans.sort((x, y) => x.s - y.s)) {
      const prev = merged.at(-1);
      if (prev && span.s <= prev.e + 1e-6) prev.e = Math.max(prev.e, span.e);
      else merged.push({ ...span });
    }
    const kept = gap - merged.reduce((sum, c) => sum + c.e - c.s, 0);
    const split = lineGap && newLine && paused ? b.li : null;
    merged.forEach(({ s, e }, m) => {
      const cut = { s, e, after: earlier.w, gap, kept, sound: Boolean(sound) };
      cuts.push(split !== null && m === merged.length - 1 ? { ...cut, atLine: split } : cut);
    });
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
/** Decoded final-mix levels; callers must not attribute an event to these whole-mix windows. */
export const measureCutAudio = (file) => clipLevels(file);

function tightenSentenceGaps(spine, reactionCues, scriptLines, readLevels, lineGap = null, jump = null, templateBoard = null, editingTreatment = null, notes = []) {
  for (const seg of spine) {
    if (seg.source !== "clip" || seg.audio !== "clip" || !seg.words?.length || seg.fixedLength) continue;
    const lines = seg.lineIds.map((id) => ({
      lineId: id,
      text: scriptLines.get(id)?.text,
      stageDirection: scriptLines.get(id)?.stageDirection,
      performanceDirection: scriptLines.get(id)?.performanceDirection,
      asksPause: asksPause(scriptLines.get(id)),
      cuesBeat: reactionCues.has(id),
    }));
    const scene = templateBoard?.scenes?.find((entry) => entry.sceneIndex === seg.sceneIndex);
    const edit = templateBoard && !seg.wholeVoice ? templateSpeechEdit(seg.words, {
      durationSec: seg.seconds, lines, actionLeadSec: seg.actionLeadSec ?? 0,
      actionTailSec: seg.actionTailSec ?? 0, fps: FPS,
      direction: [templateBoard?.stageDirection, scene?.sceneDirection, scene?.shotDirection?.action, scene?.subjectAction],
      actionPhases: scene?.actionPhases, directorBeats: scene?.directorBeats,
      notes, sceneIndex: seg.sceneIndex,
      editingTreatment,
    }) : null;
    const sentenceCuts = templateBoard
      ? edit && lineGap ? sentenceGapCuts(seg.words, lines, null, lineGap) : []
      : sentenceGapCuts(seg.words, lines, readLevels(seg.file), lineGap, jump);
    const jumpCuts = (edit?.cuts ?? []).map((gap) => ({
      s: gap.startSec, e: gap.endSec, after: "speech", gap: gap.endSec - gap.startSec, kept: 0,
      atLine: sentenceCuts.find((cut) => cut.s < gap.endSec && cut.e > gap.startSec)?.atLine,
    }));
    const heardCuts = templateBoard ? jumpCuts : sentenceCuts.sort((a, b) => a.s - b.s);
    if (edit) seg.templateSpeech = edit;
    // The measured map: on whole slots of the clip's own picture, so both lose the same frames.
    const cuts = seg.map?.picture ? cutsOnSlots(heardCuts, seg.map.deltaSec) : heardCuts;
    if (edit) {
      const removedBefore = (t) => cuts.reduce((sum, cut) => sum + Math.max(0, Math.min(t, cut.e) - cut.s), 0);
      seg.templateSpeech = { headSec: edit.headSec - removedBefore(edit.headSec), tailSec: edit.tailSec - removedBefore(edit.tailSec) };
    }
    if (cuts.length === 0) continue;
    const removedBefore = (t) => cuts.reduce((sum, c) => sum + (c.e <= t ? c.e - c.s : 0), 0);
    const removed = removedBefore(Infinity);
    seg.cuts = cuts.map(({ s, e, slots }) => (slots ? { s, e, slots } : { s, e }));
    // cutPace: where the take is split, in its time once the gaps are out.
    const splits = cuts.filter((c) => c.atLine !== undefined).map((c) => ({ at: c.s - removedBefore(c.s), line: c.atLine }));
    if (splits.length > 0) seg.splits = splits;
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

/** A voiced suffix belongs to the final explicit source continuation, not necessarily its picture home. */
function finalWordTailScene(storyboard, beat) {
  const bindings = (storyboard?.pictureBindings ?? []).filter((binding) => binding.beatId === beat.id);
  const finalLineId = bindings.length === 1 ? bindings[0].lineIds?.at(-1) : null;
  const scenes = (storyboard?.scenes ?? []).filter((scene) => bindings.length
    ? finalLineId && scene.lineIds?.includes(finalLineId)
    : scene.planningBeatIds?.includes(beat.id));
  return scenes.length === 1 ? scenes[0] : null;
}

/**
 * Flexible beats are quote capacity, not mandatory pictures. P2 validates the
 * approved program's required jobs/prerequisites/order before persisting the
 * board. Bind only its actual contiguous slots here; reservations are planning
 * minima, never measured source or final clocks.
 */
function selectedPictureJobs(manifest, board, budget = manifest?.planningBudget) {
  if (manifest?.templateMotion?.enabled !== true || !budget?.pictureRange) return null;
  const groups = new Map();
  for (const scene of board?.scenes ?? []) {
    if (scene.broll || scene.kind === "cutaway") continue;
    const n = scene.planPicture;
    if (!Number.isInteger(n) || n < 1 || n > budget.pictureRange.max ||
      !Number.isFinite(scene.planSeconds) || scene.planSeconds <= 0) {
      return null; // Invalid planning projection is not missing playable media.
    }
    const owners = groups.get(n) ?? [];
    owners.push(scene);
    groups.set(n, owners);
  }
  const count = groups.size;
  // Selected sources, not the requested target, own the finished edit length.
  if (!count) return null;
  return [...groups].sort(([a], [b]) => a - b).map(([n, owners]) => ({
    id: budget.beats[n - 1]?.id ?? `picture-${n}`, owners,
    reservedSeconds: owners.reduce((sum, scene) => sum + scene.planSeconds, 0),
  }));
}

export function scenePlans(storyboard, planningBudget = null, selectedJobs = null) {
  const plans = new Map();
  const suffixes = new Map();
  for (const beat of planningBudget?.beats ?? []) {
    if (!(beat.picture?.finalWordTailSec > 0)) continue;
    const owner = finalWordTailScene(storyboard, beat);
    if (owner) suffixes.set(owner.sceneIndex, Math.max(suffixes.get(owner.sceneIndex) ?? 0, beat.picture.finalWordTailSec));
  }
  for (const scene of storyboard?.scenes ?? []) {
    if (typeof scene?.sceneIndex !== "number") continue;
    const reserved = (planningBudget?.beats ?? []).filter((beat) => scene.planningBeatIds?.includes(beat.id));
    const sequential = reserved.filter((beat) => beat.silent?.composition === "sequential");
    const overlay = reserved.some((beat) => beat.silent?.composition === "overlay");
    const reservation = reserved.reduce((sum, beat) => sum + (beat.silent?.seconds ?? beat.picture?.seconds ?? 0), 0);
    const speakers = (Array.isArray(scene.dialogue) ? scene.dialogue : [])
      .filter((turn) => hasText(turn?.line) || hasText(turn?.text))
      .map((turn) => (hasText(turn.speaker) ? turn.speaker.trim() : null));
    plans.set(scene.sceneIndex, {
      firstSpeaker: speakers[0] ?? null,
      lastSpeaker: speakers.at(-1) ?? null,
      baseShotId: hasText(scene.baseShotId) ? scene.baseShotId.trim() : null,
      cutaway: CUTAWAY_KINDS.has(scene.kind) && sequential.length === 0,
      narrated: narratedScene(scene, storyboard),
      lineIds: Array.isArray(scene.lineIds) ? scene.lineIds : [],
      cueLineId: typeof scene.cueLineId === "string" ? scene.cueLineId : null,
      cutawayType: typeof scene.cutawayType === "string" ? scene.cutawayType : null,
      durationSec: typeof scene.durationSec === "number" ? scene.durationSec : null,
      actionTailSec: Math.max(
        typeof scene.actionTailSec === "number" && scene.actionTailSec > 0 ? scene.actionTailSec : 0,
        suffixes.get(scene.sceneIndex) ?? 0,
      ),
      actionLeadSec: typeof scene.actionLeadSec === "number" && scene.actionLeadSec > 0 ? scene.actionLeadSec : 0,
      ...(planningBudget ? {
        editSeconds: selectedJobs
          ? selectedJobs.find((job) => job.owners.includes(scene)) ? scene.planSeconds : null
          : reservation || null,
        overlay,
      } : {}),
      sourceShot: Number.isInteger(scene.sourceShot) && scene.sourceShot > 0 ? scene.sourceShot : null,
      broll:
        hasText(scene.broll?.covers) && Number.isFinite(scene.broll?.plannedSec) && scene.broll.plannedSec > 0
          ? { covers: scene.broll.covers, plannedSec: scene.broll.plannedSec }
          : null,
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

/** Where a segment's cue line sits among its words, or null when the segment does not speak it. */
function lineInSegment(seg, counts, cueLineId) {
  const idx = seg.lineIds.indexOf(cueLineId);
  if (idx === -1) return null;
  let before = 0;
  let total = 0;
  seg.lineIds.forEach((id, i) => {
    const n = counts.get(id) ?? 0;
    total += n;
    if (i < idx) before += n;
  });
  return { idx, before, words: counts.get(cueLineId) ?? 0, total };
}

/**
 * When the segment's word number `i` starts (edge "s") or ends ("e"), in
 * seconds into the segment: from its word times, else its share of the words.
 */
function wordTimeInSegment(seg, i, total, edge) {
  let at = 0;
  if (seg.words && seg.words.length > 0) {
    at = Math.max(0, seg.words[Math.min(Math.max(i, 0), seg.words.length - 1)]?.[edge] ?? 0);
  } else if (total > 0) {
    at = ((edge === "e" ? i + 1 : i) / total) * seg.seconds;
  }
  return Math.min(at, seg.seconds);
}

const timesFrom = (seg) => (seg.words && seg.words.length > 0 ? "words" : "proportion");

export function cueOffsetOnSpine(spine, counts, cueLineId) {
  for (const seg of spine) {
    const line = lineInSegment(seg, counts, cueLineId);
    if (!line) continue;
    return {
      startSec: seg.startSec + wordTimeInSegment(seg, line.before, line.total, "s"),
      method: timesFrom(seg),
      spineSceneIndex: seg.sceneIndex,
    };
  }
  return null;
}

/**
 * Where a segment's spoken cue line ends, in seconds into the segment, or null
 * when the segment does not speak it. A cue line that closes the segment ends
 * where the segment does.
 */
export function cueEndInSegment(seg, counts, cueLineId) {
  const line = lineInSegment(seg, counts, cueLineId);
  if (!line) return null;
  if (line.idx === seg.lineIds.length - 1) return seg.seconds;
  const through = line.before + line.words;
  if (seg.words && seg.words.length > 0) return wordTimeInSegment(seg, through - 1, line.total, "e");
  return line.total > 0 ? (through / line.total) * seg.seconds : seg.seconds;
}

/** The sub-words of a text the way scout contract.ts brollCoversLine splits them. */
const coverParts = (text) => String(text ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The first and last of `words` that hold the covered words, or null. Matched
 * on sub-words as the contract does, so "proven answer" is found in
 * "clinically-proven answer" and starts on "clinically-proven".
 */
function coveredRun(words, covers) {
  const parts = words.flatMap((word, i) => coverParts(word).map((part) => ({ part, i })));
  const want = coverParts(covers);
  if (want.length === 0) return null;
  for (let k = 0; k + want.length <= parts.length; k++) {
    if (want.every((w, j) => parts[k + j].part === w)) {
      return { first: parts[k].i, last: parts[k + want.length - 1].i };
    }
  }
  return null;
}

/**
 * When the covered words are heard, in seconds into the segment, read by
 * aligning the script to the transcript: "$29" is heard as three words, so the
 * script's word count points at the wrong one (#3912). Null when the segment
 * has no word times or the script does not align.
 */
function heardCovers(seg, texts, cueLineId, covers) {
  if (!seg.words || seg.words.length === 0) return null;
  const lines = seg.lineIds.map((id) => scriptWords(texts.get(id)));
  const idx = seg.lineIds.indexOf(cueLineId);
  const run = coveredRun(lines[idx], covers);
  const aligned = run ? alignScript(seg.words, lines.flat()) : null;
  if (!aligned) return null;
  const offset = lines.slice(0, idx).reduce((n, words) => n + words.length, 0);
  const { expected, heard, heardTokenOf, heardWordOf } = aligned;
  const first = expected.lastSourceIndex.findIndex((i) => i >= offset + run.first);
  const last = expected.sourceIndex.findLastIndex((i) => i <= offset + run.last);
  if (first === -1 || last < first) return null;
  const at = (i, edge) => Math.min(Math.max(0, seg.words[i]?.[edge] ?? 0), seg.seconds);
  return { startSec: at(heardWordOf[first], "s"), endSec: at(heard.lastSourceIndex[heardTokenOf[last]], "e") };
}

/**
 * #3912: a B-roll shot's place in its segment. It starts BROLL_LEAD_SEC before
 * the first word it covers, which can fall before the segment's own start
 * (#3936), and holds through the last word or for its planned length,
 * whichever is longer, between BROLL_MIN_HOLD_SEC and BROLL_MAX_HOLD_SEC, or
 * for its planned length when that runs longer than the cap. Covered words the
 * line does not say leave it at the line's start for its planned length.
 * `texts` maps each line id to its script text. Null when the segment does not
 * speak the cue line.
 */
export function brollWindow(seg, counts, cueLineId, texts, broll) {
  const line = lineInSegment(seg, counts, cueLineId);
  if (!line) return null;
  const method = timesFrom(seg);
  const run = coveredRun((texts.get(cueLineId) ?? "").trim().split(/\s+/), broll.covers);
  if (!run) {
    return {
      startSec: wordTimeInSegment(seg, line.before, line.total, "s"),
      holdSec: broll.plannedSec, method, found: false,
    };
  }
  const heard = heardCovers(seg, texts, cueLineId, broll.covers);
  const wordSec = heard?.startSec ?? wordTimeInSegment(seg, line.before + run.first, line.total, "s");
  const endSec = heard?.endSec ?? wordTimeInSegment(seg, line.before + run.last, line.total, "e");
  const startSec = wordSec - BROLL_LEAD_SEC;
  const span = Math.max(0, endSec - startSec);
  const holdSec = broll.plannedSec > BROLL_MAX_HOLD_SEC
    ? Math.max(span, broll.plannedSec)
    : Math.min(Math.max(span, broll.plannedSec, BROLL_MIN_HOLD_SEC), BROLL_MAX_HOLD_SEC);
  return { startSec, holdSec, method, found: true };
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
 * word, so the action it ends on (her setting the mat down, #3199) is seen, and
 * one marked with actionLeadSec keeps that long before its first word, so the
 * action it opens on (the dog stepping onto the mat, #3272) is seen.
 *
 * talkTrim: no talking clip keeps more than TALK_TRIM_SEC of air after its last
 * word, the ad's last one included; a scene's actionTailSec still holds.
 */
function trimJoins(spine, reactionCues, scriptLines, gapMax = null, talkTrim = false) {
  // cutPace: the beat before someone new answers shrinks so the join holds at most gapMax of air.
  const newSpeakerLead = gapMax === null
    ? JOIN_LEAD_NEW_SPEAKER_SEC
    : Math.min(JOIN_LEAD_NEW_SPEAKER_SEC, roundMs(gapMax - JOIN_TAIL_SEC));
  spine.forEach((seg, k) => {
    if (seg.source !== "clip" || seg.audio !== "clip" || !seg.words?.length || seg.fixedLength) return;
    const prev = spine[k - 1];
    const sameSpeaker = Boolean(prev?.lastSpeaker) && prev.lastSpeaker === seg.firstSpeaker;
    const lead = seg.templateSpeech ? TEMPLATE_SPEECH_LEAD_SEC : sameSpeaker || !prev ? JOIN_LEAD_SAME_SPEAKER_SEC : newSpeakerLead;
    const span = scriptedSpan(seg.words, seg.lineIds.map((id) => scriptLines.get(id)?.text));
    const line = span ? seg.words.slice(span.first, span.last + 1) : seg.words;
    const before = span ? seg.words.slice(0, span.first) : [];
    const after = span ? seg.words.slice(span.last + 1) : [];
    // Filter on the original word clock before extending a mapped word to its
    // final phoneme: a zero-duration token must not become a speech anchor.
    const anchors = seg.templateSpeech ? templateJoinAnchors(line
      .filter((word) => !isZeroDurationSpeech(word))
      .map((word) => seg.map ? { ...word, e: wordEnd(word) } : word)) : null;
    const firstWord = anchors ? anchors.firstSec ?? 0 : Math.min(...line.map((w) => w.s));
    const lastWord = anchors ? anchors.lastSec ?? seg.seconds : Math.max(...line.map((w) => seg.map ? wordEnd(w) : w.e));
    let inSec = Math.max(0, floorFrame(firstWord - Math.max(lead, seg.actionLeadSec ?? 0)));
    if (seg.templateSpeech) inSec = Math.min(inSec, seg.templateSpeech.headSec);
    if (before.length > 0) {
      const clear = ceilFrame(Math.max(...before.map((w) => w.e)) + EXTRA_CLEARANCE_SEC);
      inSec = Math.max(inSec, Math.min(clear, floorFrame(firstWord)));
    }
    const endsAd = k === spine.length - 1 && !reactionCues.has(seg.lineIds.at(-1));
    const airSec = endsAd ? END_AIR_SEC : JOIN_TAIL_SEC;
    const tailSec = Math.max(seg.templateSpeech ? TEMPLATE_SPEECH_TAIL_SEC : talkTrim ? Math.min(airSec, TALK_TRIM_SEC) : airSec, seg.actionTailSec ?? 0);
    let outSec = ceilFrame(lastWord + tailSec);
    if (seg.templateSpeech) outSec = Math.max(outSec, seg.templateSpeech.tailSec);
    if (after.length > 0) {
      const clear = floorFrame(Math.min(...after.map((w) => w.s)) - EXTRA_CLEARANCE_SEC);
      outSec = Math.min(outSec, Math.max(clear, ceilFrame(lastWord)));
    }
    outSec = Math.min(seg.seconds, outSec);
    // The measured map: a scripted word the clip's own picture ends before is lost media, said, never trimmed away quietly.
    if (seg.map) {
      const lost = line.filter((w) => (!seg.templateSpeech || !isZeroDurationSpeech(w)) && w.e > outSec + 1e-6);
      if (lost.length > 0) seg.lostWords = lost.map((w) => ({ w: w.w, s: w.s, e: w.e, pictureEndSec: outSec }));
    }
    if (outSec <= inSec) return;
    const how = [];
    if (inSec > 0) how.push(`lead-in trimmed ${inSec.toFixed(2)}s`);
    if (outSec < seg.seconds) how.push(`tail trimmed ${(seg.seconds - outSec).toFixed(2)}s`);
    if (how.length === 0) return;
    const kept = seg.words.filter((w) => w.s < outSec && w.e > inSec);
    if (before.some((w) => !kept.includes(w))) how.push("extra sound before the line trimmed");
    if (after.some((w) => !kept.includes(w))) how.push("extra sound after the line trimmed");
    // An unscripted word cut off before or after the line is not speech the beat must keep.
    if (seg.templateSpeech) seg.templateSpeech = { headSec: Math.max(seg.templateSpeech.headSec, inSec), tailSec: Math.min(seg.templateSpeech.tailSec, outSec) };
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
function narrationEnd(voiceSeconds, voiceWords, endsAd, measured = false) {
  return {
    spokenEndSec: voiceWords?.length ? Math.max(...voiceWords.map((w) => measured ? wordEnd(w) : w.e)) : voiceSeconds,
    airSec: endsAd ? END_AIR_SEC : NARRATION_JOIN_AIR_SEC,
  };
}

const holdFor = (seg) =>
  seg.source === "clip" ? Math.max(0, seg.seconds - Math.max(0, seg.clipSeconds - seg.inSec)) : 0;

function refusePictureHolds(short) {
  if (short.length) throw new SourceMapRefusal(
    "The selected voice/action clock outlasts its available picture; supply real footage rather than frozen fill",
    short.map((seg) => ({
      severity: "refuse", code: "picture-hold", scene: seg.sceneIndex,
      detail: `${seg.file} needs ${seg.seconds}s, but only ${seg.seconds - seg.holdSec}s of retained source remains`,
    })),
  );
}

/** Prefer the reaction's directed interval, never a union of unrelated proof/action windows. */
function reserveReactionPicture(reaction, scene, words, notes) {
  const windows = templateActionWindows(words, {
    durationSec: reaction.seconds, actionPhases: scene?.actionPhases, directorBeats: scene?.directorBeats,
    notes, sceneIndex: reaction.sceneIndex,
  });
  const directed = windows.filter((window) => window.kind === "director-beat");
  const candidates = directed.length ? directed : windows;
  // Only one interval (or its unambiguous contained refinement) selects picture.
  // Disjoint reservations cannot supply a made-up continuous reaction endpoint.
  const window = candidates.find((candidate) => candidates.every((other) =>
    other.startSec <= candidate.startSec && other.endSec >= candidate.endSec));
  if (candidates.length && !window) notes.push(
    `reaction-reservation-unresolved: scene ${reaction.sceneIndex} has multiple distinct reaction windows; no combined endpoint was invented`);
  if (window) {
    const from = Math.max(0, floorFrame(window.startSec));
    const to = Math.min(reaction.seconds, ceilFrame(window.endSec));
    reaction.inSec = from;
    reaction.visualSeconds = to - from;
  } else if (reaction.reservedSeconds > 0) {
    reaction.inSec = 0;
    reaction.visualSeconds = Math.min(reaction.seconds, ceilFrame(reaction.reservedSeconds));
    if (reaction.reservedSeconds > reaction.seconds) notes.push(
      `reaction-reservation-short: scene ${reaction.sceneIndex} uses only available source picture`);
  }
}

/**
 * Put a reaction beat into the spine right after its cue line ends, splitting
 * the segment that speaks it when more lines follow in that segment. Returns
 * the scene that speaks the cue, or null when no segment does.
 */
function placeReaction(spine, counts, reaction) {
  for (let k = 0; k < spine.length; k++) {
    const seg = spine[k];
    if (seg.reaction || seg.nativeWordClockOverrun) continue;
    const cueEnd = cueEndInSegment(seg, counts, reaction.cueLineId);
    if (cueEnd === null) continue;
    const cut = Math.min(seg.seconds, ceilFrame(cueEnd));
    const beat = {
      sceneIndex: reaction.sceneIndex, source: reaction.source, file: reaction.file,
      // The measured map: a measured beat's own sound runs deltaSec ahead of its picture's slots.
      clipSeconds: reaction.source !== "clip" ? null
        : reaction.map && reaction.hasAudio ? Math.max(0, reaction.seconds - reaction.map.deltaSec) : reaction.seconds,
      inSec: (reaction.inSec ?? 0) - (reaction.visualSeconds > 0 && reaction.hasAudio ? reaction.map?.deltaSec ?? 0 : 0),
      ...(reaction.map ? { map: reaction.map } : {}),
      seconds: reaction.visualSeconds ?? Math.min(reaction.seconds, REACTION_MAX_SEC), holdSec: 0,
      audio: reaction.hasAudio ? "clip" : "silence", voice: null, words: null, lineIds: [],
      reaction: { cueLineId: reaction.cueLineId, cueSceneIndex: seg.sceneIndex,
        ...(reaction.visualSeconds > 0 ? { visualSeconds: reaction.visualSeconds } : {}) },
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
    Math.round(Math.min(REACTION_TAIL_SEC, clipLen - seg.inSec - (seg.reaction.visualSeconds ?? REACTION_MIN_BEAT_SEC), next.seconds) * 1000) / 1000;
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

/** pacePass: every second piece of the spine zooms, where no punch-in does already. Answers the cut's note, which names `speed`. */
export function paceZooms(spine, speed) {
  let zoomed = 0;
  spine.forEach((seg, k) => {
    if (k % 2 === 0 || seg.punchIn) return;
    seg.paceZoom = true;
    zoomed += 1;
  });
  return `pacePass: the cut plays at ${speed}x and ${zoomed} piece${zoomed === 1 ? "" : "s"} zoom ${PACE_PASS.zoom}x`;
}

/** cutPace: two pieces of one take, back to back. */
const samePiece = (prev, seg) =>
  Boolean(prev.piece && seg.piece && prev.file === seg.file && prev.piece.take === seg.piece.take);

/**
 * cutPace: split each take at the pauses tightenSentenceGaps marked, where one
 * line ends and the next begins, so the pieces join as a jump cut. Each piece
 * plays its own lines, on whole frames, from the same file.
 */
function splitAtPauses(spine) {
  for (let k = spine.length - 1; k >= 0; k--) {
    const seg = spine[k];
    const marks = seg.splits ?? [];
    delete seg.splits;
    const at = marks
      .map((m) => ({ t: Math.round((m.at - seg.inSec) * FPS) / FPS, line: m.line }))
      .filter((m) => m.t > 0 && m.t < seg.seconds);
    if (at.length === 0) continue;
    const edges = [0, ...at.map((m) => m.t), seg.seconds];
    const lineEdges = [0, ...at.map((m) => m.line), seg.lineIds.length];
    const of = edges.length - 1;
    const pieces = edges.slice(0, -1).map((from, j) => {
      const to = edges[j + 1];
      const piece = {
        ...seg,
        inSec: seg.inSec + from,
        seconds: to - from,
        lineIds: seg.lineIds.slice(lineEdges[j], lineEdges[j + 1]),
        words: seg.words
          ? seg.words.filter((w) => w.s >= from && w.s < to).map((w) => ({ ...w, s: w.s - from, e: w.e - from }))
          : null,
        piece: { take: seg.sceneIndex, n: j + 1, of },
        note: `${seg.note}, piece ${j + 1} of ${of}`,
      };
      piece.holdSec = holdFor(piece);
      return piece;
    });
    spine.splice(k, 1, ...pieces);
  }
}

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

/** Only an explicitly selected terminal hold may freeze a retained frame.
 * A format name, discarded tail or source EOF cannot create this binding. */
function selectedEditorialHold(manifest, storyboard, sceneIndex) {
  const permission = manifest?.outputPermission;
  if (permission?.ending?.mode !== "native" || permission.ending.kind !== "editorial-hold") return null;
  const scenes = storyboard?.scenes ?? [];
  const scene = scenes.at(-1);
  const hold = scene?.editorialHold;
  const selected = selectedPictureJobs(manifest, storyboard)?.at(-1);
  const beat = manifest.planningBudget?.beats?.at(-1);
  const bound = selected
    ? selected.owners.at(-1) === scene && scene.planSeconds === hold?.seconds
    : scene?.planningBeatIds?.includes(beat?.id) && beat?.picture?.seconds === hold?.seconds;
  if (scene?.sceneIndex !== sceneIndex || hold?.boundary !== "retained-end" ||
    !Number.isInteger(hold.sourceSceneIndex) || scenes.at(-2)?.sceneIndex !== hold.sourceSceneIndex ||
    !(hold.seconds > 0) || !Number.isFinite(hold.seconds) ||
    !bound) return null;
  return hold;
}

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
  for (const scene of storyboard?.scenes ?? []) {
    const hold = selectedEditorialHold(manifest, storyboard, scene.sceneIndex);
    if (hold && !skip.has(hold.sourceSceneIndex) && clipped.has(hold.sourceSceneIndex)) clipped.add(scene.sceneIndex);
  }
  return [...new Set(planned.length > 0 ? planned : listed)]
    .filter((n) => !skip.has(n) && !clipped.has(n))
    .sort((a, b) => a - b);
}

/**
 * A kind's songAsVoice: the voice is one track, a song, laid whole under the
 * picture and never cut, and each narrated scene lasts its own stretch of it
 * (the pulled narration.json's cuts, which run on from one another to the
 * song's end). Null, and the cut is today's, without the manifest's
 * `wholeVoice` or without the pulled narration. `alignment` is the pulled
 * master's own word-clock provenance: ElevenLabs TTS writes
 * "elevenlabs-timestamps"; a Suno song master's words are Scribe ASR and
 * carry none.
 */
export function wholeVoiceOf(manifest, readJson, exists) {
  if (manifest?.wholeVoice !== true || !exists(manifest.narration?.file)) return null;
  const timing = readJson(manifest.narration.timing);
  const cuts = timing?.cuts;
  if (!Array.isArray(cuts) || cuts.length === 0) return null;
  return {
    file: manifest.narration.file,
    seconds: Math.max(...cuts.map((c) => c.startSec + c.durationSec)),
    starts: new Map(cuts.map((c) => [c.sceneIndex, c.startSec])),
    ...(typeof timing.alignment === "string" ? { alignment: timing.alignment } : {}),
  };
}

/** Read the existing pulled master/scene words before any finishing sound order.
 * This is the same clock consumed by firstCut, not a planned timing substitute. */
export function narrationFinishClock({ dir, manifest, storyboard }) {
  const exists = (file) => typeof file === "string" && existsSync(path.join(dir, file));
  const readJson = (file) => {
    if (!exists(file)) return null;
    try { return JSON.parse(readFileSync(path.join(dir, file), "utf8")); } catch { return null; }
  };
  const refuse = (detail) => { throw new SourceMapRefusal("Approved continuous narration requires its actual canonical clock", [
    { severity: "refuse", code: "narration-clock-unmeasured", scene: null, detail },
  ]); };
  const whole = wholeVoiceOf(manifest, readJson, exists);
  if (!whole || manifest.sourceMap !== true || !storyboard) refuse("the approved whole narration, timing and measured cut are required");
  const cuts = readJson(manifest.narration.timing)?.cuts;
  const plans = scenePlans(storyboard, manifest.planningBudget);
  const scenes = (storyboard.scenes ?? []).filter((scene) => !plans.get(scene.sceneIndex)?.cutaway);
  if (!Array.isArray(cuts) || cuts.length !== scenes.length) refuse("every planned scene needs exactly one actual narration interval");
  const words = [];
  let end = 0;
  for (const [index, scene] of scenes.entries()) {
    const take = manifest.scenes.find((entry) => entry.sceneIndex === scene.sceneIndex);
    const interval = cuts[index];
    const local = readJson(take?.words);
    if (interval.sceneIndex !== scene.sceneIndex || !Number.isFinite(interval.startSec) ||
      interval.startSec < end - 1e-6 || !Number.isFinite(interval.durationSec) || interval.durationSec <= 0 ||
      take?.wordsFrom !== "voice" || !exists(take.voice) || !Array.isArray(local) || !local.length) {
      refuse(`scene ${scene.sceneIndex} lacks its ordered actual audio/word interval`);
    }
    const ids = [];
    let lastEnd = 0;
    for (const word of local) {
      if (!hasText(word.w) || !hasText(word.lineId) || !scene.lineIds?.includes(word.lineId) ||
        !Number.isFinite(word.s) || !Number.isFinite(word.e) || word.s < lastEnd ||
        word.e <= word.s || word.e > interval.durationSec + 1e-6) refuse(`scene ${scene.sceneIndex} has an invalid or untagged actual word`);
      if (ids.at(-1) !== word.lineId) ids.push(word.lineId);
      lastEnd = word.e;
      words.push({ ...word, s: r6(word.s + interval.startSec), e: r6(word.e + interval.startSec) });
    }
    if (ids.length !== scene.lineIds.length || ids.some((id, i) => id !== scene.lineIds[i])) refuse(`scene ${scene.sceneIndex} is missing canonical line coverage`);
    end = interval.startSec + interval.durationSec;
  }
  const audio = clockOf(measureMedia(path.join(dir, whole.file))).audio;
  if (!audio || end > audio.decodedSec + 1 / EDIT_SAMPLE_RATE) refuse("narration intervals exceed the decoded approved master EOF");
  return { durationSec: audio.decodedSec, words, cuts };
}

const roundFrame = (t) => Math.round(t * FPS) / FPS;

/**
 * Lays the spine on the whole voice. Each scene with a stretch of the voice
 * runs from its stretch's start to the next one's, the last to the voice's
 * end, on whole frames, its clip trimmed or its last frame held to fit. A
 * scene with no stretch (no line) between two that have one keeps its clip
 * but takes its time from the scene before it, never past that scene's last
 * word, so every later line still lands on its words; one with no room left
 * is dropped. Scenes before the first stretch play first and the voice starts
 * after them. Returns where the voice starts and what was dropped.
 *
 * The measured map (`whole.measured`): `whole.seconds` is the song's decoded length, so
 * its last stretch carries the whole musical tail; each stretch is returned
 * as frames into the song (`intervals`), the scenes between stretches keep the
 * length given here (`fixedLength`: no later trim may move a line off its
 * words), and a stretch that is not inside the decoded song, or not after the
 * one before, is a `problem`, never a guess.
 */
export function fitWholeVoice(spine, whole) {
  const on = spine.flatMap((seg, k) => (whole.starts.has(seg.sceneIndex) ? [k] : []));
  if (on.length === 0) return null;
  const startSec = spine.slice(0, on[0]).reduce((t, seg) => t + seg.seconds, 0);
  const gone = new Set();
  const intervals = [];
  const problems = [];
  on.forEach((k, j) => {
    const seg = spine[k];
    const next = on[j + 1];
    const from = j === 0 ? 0 : roundFrame(whole.starts.get(seg.sceneIndex));
    const to = next === undefined ? ceilFrame(whole.seconds) : roundFrame(whole.starts.get(spine[next].sceneIndex));
    const spoken = Math.max(1 / FPS, ceilFrame(Math.max(0, ...(seg.words ?? []).map((w) => w.e))));
    let room = Math.max(0, to - from - spoken);
    let given = 0;
    for (const b of next === undefined ? [] : spine.slice(k + 1, next)) {
      if (whole.measured) b.fixedLength = true;
      const seconds = Math.min(b.seconds, floorFrame(room));
      if (seconds < 1 / FPS) {
        gone.add(b);
        continue;
      }
      if (seconds < b.seconds) b.note = withHow(b.note, [`cut to ${seconds.toFixed(2)}s to keep the voice on its lines`]);
      b.seconds = seconds;
      b.holdSec = holdFor(b);
      room -= seconds;
      given += seconds;
    }
    seg.seconds = to - from - given;
    seg.holdSec = holdFor(seg);
    seg.wholeVoice = true;
    if (!whole.measured) {
      // Canonical tagged words belong to the actual song-cut start, not the
      // rounded picture boundary. Leave legacy unowned word records unchanged.
      const shift = whole.starts.get(seg.sceneIndex) - from;
      if (shift && seg.words?.some((word) => hasText(word.lineId))) {
        seg.words = seg.words.map((word) => hasText(word.lineId)
          ? { ...word, s: word.s + shift, e: word.e + shift } : word);
      }
    }
    seg.note = withHow(seg.note, [`on the whole voice from ${from.toFixed(2)}s to ${to.toFixed(2)}s`]);
    if (whole.measured) {
      const at = whole.starts.get(seg.sceneIndex);
      const before = j === 0 ? null : intervals.at(-1);
      if (!Number.isFinite(at) || at < 0 || at >= whole.seconds) {
        problems.push(`scene ${seg.sceneIndex}'s stretch starts at ${at}s, outside the song's decoded ${r6(whole.seconds)}s`);
      } else if (before && Math.round(from * FPS) <= before.fromFrame) {
        problems.push(`scene ${seg.sceneIndex}'s stretch does not start after scene ${before.scene}'s`);
      }
      intervals.push({ scene: seg.sceneIndex, fromFrame: Math.round(from * FPS), toFrame: Math.round(to * FPS) });
    }
  });
  const dropped = spine
    .filter((seg) => gone.has(seg))
    .map((seg) => ({ n: seg.sceneIndex, reason: `scene ${seg.sceneIndex}: no room left between two lines of the voice` }));
  for (let k = spine.length - 1; k >= 0; k--) if (gone.has(spine[k])) spine.splice(k, 1);
  return { startSec, dropped, ...(whole.measured ? { intervals, problems } : {}) };
}

/**
 * The manifest's `sourceAd` (a kind's shotCopy with a source record), or null:
 * the record's shot times, its caption style, hook box and card boxes. The
 * worker writes it; a member's own pull has none, so their cut is today's.
 */
export function sourceAdOf(manifest) {
  const a = manifest?.sourceAd;
  if (!a || typeof a !== "object" || !(a.seconds > 0) || !Array.isArray(a.shots) || a.shots.length === 0) return null;
  return {
    ...a,
    cards: Array.isArray(a.cards) ? a.cards : [],
    pictures: Array.isArray(a.pictures) ? a.pictures : [],
  };
}

/**
 * The copied shots laid on the cut. Each scene names the shot it copies (the
 * storyboard's sourceShot). A spine scene and the shots after it that no spine
 * scene copies (its cutaways) make one group, the source's voice running over
 * them as ours does; shots before the first spine scene join its group. Each
 * group's stretch of the source maps evenly onto its stretch of the cut, so a
 * cutaway lands at its shot's own place in the group. Returns
 * [{ shots: [n...], src: [t0, t1], cut: [c0, c1] }], in order.
 */
export function sourceGroups(spine, sourceAd, shotOf) {
  const entries = [...sourceAd.shots].sort((a, b) => a.n - b.n);
  const onSpine = new Map();
  for (const seg of spine) {
    const n = shotOf(seg.sceneIndex);
    if (n === null || !entries.some((e) => e.n === n)) continue;
    const at = onSpine.get(n) ?? { c0: Infinity, c1: -Infinity };
    onSpine.set(n, { c0: Math.min(at.c0, seg.startSec), c1: Math.max(at.c1, seg.startSec + seg.seconds) });
  }
  const heads = entries.filter((e) => onSpine.has(e.n));
  return heads.map((head, i) => {
    const next = heads[i + 1];
    const shots = entries.filter((e) => (i === 0 || e.n >= head.n) && (!next || e.n < next.n));
    const src0 = i === 0 ? Math.min(head.t0, shots[0].t0) : head.t0;
    const src1 = next ? next.t0 : Math.max(...shots.map((e) => e.t1));
    const cut1 = next ? onSpine.get(next.n).c0 : onSpine.get(head.n).c1;
    return { shots: shots.map((e) => e.n), src: [src0, src1], cut: [roundMs(onSpine.get(head.n).c0), roundMs(cut1)] };
  });
}

/** A time of the source ad on the cut, through its group (the first or last group's ends past them). */
export function mapSourceTime(groups, t) {
  if (groups.length === 0) return t;
  const g = groups.find((x) => t < x.src[1]) ?? groups.at(-1);
  const span = g.src[1] - g.src[0];
  const k = span > 0 ? (g.cut[1] - g.cut[0]) / span : 1;
  return Math.min(g.cut[1], Math.max(g.cut[0], g.cut[0] + (t - g.src[0]) * k));
}

/**
 * B29/B31 (only with the manifest's `sourceMap`): the one clock model the
 * map records and the renderer cuts, read from what each file decodes to and
 * never from a container duration, a stream's start_time or an assumed rate.
 *
 * Picture: every decoded frame's integer pts in its stream's time base. The
 * mapped render re-stamps the first decoded frame to 0 and resamples with
 * MAP_PICTURE (fps=24:round=up), which shows on edit slot n the last decoded
 * frame whose pts is at or before n/24 and makes slots while n/24 is before the
 * last frame's pts plus its duration. So a decoded frame's first slot is
 * ceil(pts * 24): 24 fps, 30 fps, VFR and a nonzero first pts are one rule,
 * and the map names the decoded frame index each slot shows.
 *
 * Sound: every decoded frame's pts and nb_samples. Samples with a negative pts
 * are encoder priming the container asks a player to skip, so the sound's
 * zero (and its words', the clock the scribe heard) is the first sample after
 * them, said explicitly as primingSamples. Every sound is resampled to
 * EDIT_SAMPLE_RATE, where one edit frame is exactly SAMPLES_PER_FRAME samples,
 * and cut by sample count. A clip's sound meets its picture by the pts gap of
 * the two zeros (deltaSec, rounded to one edit sample), so picture slot n
 * meets edit sample zeroSample + n * SAMPLES_PER_FRAME, before and after any
 * sentence gap, which comes out of both by whole slots.
 */
const MEDIA_ENTRIES =
  "stream=index,codec_type,time_base,sample_rate:stream_disposition=attached_pic:" +
  "frame=stream_index,media_type,pts,best_effort_timestamp,duration,pkt_duration,nb_samples";
export const EDIT_SAMPLE_RATE = 48000;
export const SAMPLES_PER_FRAME = EDIT_SAMPLE_RATE / FPS;
/** One AAC frame: the most the encoder's own priming and padding may move the rendered sound. The picture gets no allowance. */
export const RENDER_SAMPLE_TOLERANCE = 1024;
const MAP_PICTURE = `fps=${FPS}:round=up`;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const safeInt = (v) => {
  const n = typeof v === "number" ? v : v === undefined || v === null || v === "" ? Number.NaN : Number(v);
  return Number.isSafeInteger(n) ? n : null;
};
const timeBaseOf = (v) => {
  const m = /^(\d+)\/(\d+)$/.exec(String(v ?? ""));
  return m && Number(m[1]) > 0 && Number(m[2]) > 0 ? { num: Number(m[1]), den: Number(m[2]) } : null;
};
/** ceil(a / b) for integers a >= 0, b > 0, exactly: the float quotient corrected by one either way. */
function ceilDiv(a, b) {
  let c = Math.ceil(a / b);
  if ((c - 1) * b >= a) c -= 1;
  else if (c * b < a) c += 1;
  return c;
}
const stampOf = (f) => safeInt(f.pts) ?? safeInt(f.best_effort_timestamp);
const notAfter = (ticks) => ticks.findIndex((t, i) => i > 0 && t !== null && ticks[i - 1] !== null && t <= ticks[i - 1]);

function pictureClock(stream, frames) {
  const problems = [];
  const tb = timeBaseOf(stream.time_base);
  const ticks = frames.map(stampOf);
  if (!tb) problems.push("the picture stream names no time base");
  if (frames.length === 0) problems.push("the picture decodes no frame");
  const unstamped = ticks.filter((t) => t === null).length;
  if (unstamped > 0) problems.push(`${unstamped} decoded picture frame(s) carry no timestamp`);
  const back = notAfter(ticks);
  if (back > 0) problems.push(`decoded picture frame ${back} does not come after frame ${back - 1}`);
  const last = frames.at(-1);
  const lastTicks = last ? safeInt(last.duration) ?? safeInt(last.pkt_duration) : null;
  if (last && !(lastTicks > 0)) problems.push("the last decoded picture frame carries no duration, so where the picture ends is not known");
  if (problems.length > 0) return { problems, frames: frames.length };
  const sec = (t) => (t * tb.num) / tb.den;
  const rel = ticks.map((t) => t - ticks[0]);
  const slot = (r) => ceilDiv(r * FPS * tb.num, tb.den);
  const endTicks = rel.at(-1) + lastTicks;
  return {
    problems, timeBase: `${tb.num}/${tb.den}`, frames: frames.length,
    originSec: sec(ticks[0]), endSec: sec(endTicks), ptsSec: rel.map(sec), slots: rel.map(slot), endSlot: slot(endTicks),
  };
}

function soundClock(stream, frames) {
  const problems = [];
  const tb = timeBaseOf(stream.time_base);
  const sampleRate = safeInt(stream.sample_rate);
  const ticks = frames.map(stampOf);
  const counts = frames.map((f) => safeInt(f.nb_samples));
  if (!tb) problems.push("the sound stream names no time base");
  if (!(sampleRate > 0)) problems.push("the sound stream names no sample rate");
  if (frames.length === 0) problems.push("the sound decodes no sample");
  const unstamped = ticks.filter((t) => t === null).length;
  if (unstamped > 0) problems.push(`${unstamped} decoded sound frame(s) carry no timestamp`);
  const uncounted = counts.filter((n) => !(n > 0)).length;
  if (uncounted > 0) problems.push(`${uncounted} decoded sound frame(s) carry no sample count`);
  const back = notAfter(ticks);
  if (back > 0) problems.push(`decoded sound frame ${back} does not come after frame ${back - 1}`);
  if (problems.length > 0) return { problems };
  const sec = (t) => (t * tb.num) / tb.den;
  const samples = counts.reduce((a, b) => a + b, 0);
  const spanned = Math.round((sec(ticks.at(-1)) - sec(ticks[0])) * sampleRate) + counts.at(-1);
  // Describe only positive, measured holes. Overlaps, unstamped frames and
  // missing samples cannot be repaired by a padding-only operation.
  const paddingGaps = [];
  let overlaps = false;
  for (let i = 1; i < ticks.length; i++) {
    const missing = Math.round(sec(ticks[i] - ticks[i - 1]) * sampleRate) - counts[i - 1];
    if (missing < -1) overlaps = true;
    if (missing > 1) paddingGaps.push({ startSec: sec(ticks[i - 1]) + counts[i - 1] / sampleRate,
      endSec: sec(ticks[i]), samples: missing });
  }
  // A gap or overlap in the sound's own clock is at least one coded frame; less is the time base's rounding.
  if (Math.abs(spanned - samples) > Math.max(1, Math.min(...counts) / 2)) {
    return { problems: [`the ${samples} decoded samples do not fill the sound's own clock of ${spanned}: it has a gap or an overlap`],
      ...(!overlaps && paddingGaps.length ? { paddingGaps, sampleRate } : {}) };
  }
  const originSec = sec(ticks[0]);
  const primingSamples = originSec < 0 ? Math.min(samples, Math.round(-originSec * sampleRate)) : 0;
  const toEdit = (n) => Math.round((n * EDIT_SAMPLE_RATE) / sampleRate);
  return {
    problems, timeBase: `${tb.num}/${tb.den}`, sampleRate, originSec, samples, primingSamples,
    zeroSec: originSec + primingSamples / sampleRate,
    decodedSec: (samples - primingSamples) / sampleRate,
    edit: { priming: toEdit(primingSamples), samples: toEdit(samples) },
  };
}

/**
 * ffprobe json (streams + decoded frames, integer pts) -> { picture, audio }:
 * null where the file has no such stream, else that stream's clock or the
 * `problems` that keep it from being one. Nothing missing is filled in.
 */
export function parseMedia(info) {
  const streams = info?.streams ?? [];
  const pick = (type) => streams.find((s) => s.codec_type === type && !s.disposition?.attached_pic);
  const framesOf = (s) => (info?.frames ?? []).filter((f) => f.stream_index === s.index);
  const video = pick("video");
  const audio = pick("audio");
  return {
    picture: video ? pictureClock(video, framesOf(video)) : null,
    audio: audio ? soundClock(audio, framesOf(audio)) : null,
  };
}

/** The decoded frame MAP_PICTURE shows on picture slot n: the last whose first slot is at or before n. */
export function frameAtSlot(picture, n) {
  let lo = 0;
  let hi = picture.slots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (picture.slots[mid] <= n) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function measureMedia(file) {
  const res = spawnSync("ffprobe", ["-v", "error", "-show_entries", MEDIA_ENTRIES, "-of", "json", file], {
    encoding: "utf8", maxBuffer: 1 << 30,
  });
  if (res.status !== 0) return null;
  try {
    return parseMedia(JSON.parse(res.stdout));
  } catch {
    return null;
  }
}

/** Pad only observed timestamp holes, never stretch or compact retained sound.
 * This preserves the presentation clock used by pictures and word sidecars:
 * their mapping through the repair is identity, including after every gap. */
function repairFinalClock(file) {
  const decoded = measureMedia(file);
  if (!decoded?.picture || decoded.picture.problems.length || !decoded.audio?.paddingGaps?.length) return null;
  const repaired = `${file}.clock-repair.mp4`;
  try {
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", file,
      "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
      "-af", "aresample=48000:async=1:min_hard_comp=0:max_soft_comp=0:first_pts=0,asetpts=N/SR/TB",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", repaired];
    if (spawnSync("ffmpeg", args, { stdio: "inherit" }).status !== 0) return false;
    const measured = measureMedia(repaired);
    if (!measured?.picture || measured.picture.problems.length || !measured.audio || measured.audio.problems.length) return false;
    renameSync(repaired, file);
    return decoded.audio.paddingGaps;
  } finally { rmSync(repaired, { force: true }); }
}

/** One local EOF edit of measured -50 dB slack; resolved acting and an explicit
 * silent editorial close stay. Source files/hashes never change. */
function trimTemplateTerminalSilence(file, timeline, manifest, board, notes) {
  const rows = wordRows(timeline);
  if (!rows.length || rows.some((row) => !Number.isFinite(row.start) || !Number.isFinite(row.end)) ||
    timeline.spine.some((seg) => seg.nativeWordClockOverrun ||
      (seg.words ?? []).some((word) => !Number.isFinite(word.s) || !Number.isFinite(word.e)))) {
    notes.push("terminal-silence-unmeasured: no reliable complete word clock; the playable ending was retained");
    return false;
  }
  const words = rows.filter((row) => row.end > row.start);
  if (!words.length) {
    notes.push("terminal-silence-unmeasured: no positive word interval; the playable ending was retained");
    return false;
  }
  const media = measureMedia(file);
  if (!media?.picture || media.picture.problems.length || !media.audio || media.audio.problems.length) {
    notes.push("terminal-silence-unmeasured: final decoded media clocks are unavailable; the playable ending was retained");
    return false;
  }
  if (media.picture.endSec <= Math.max(...words.map((row) => row.end)) + .3) return false;
  const read = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-vn", "-af",
    "silencedetect=noise=-50dB:d=0.25", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 8 << 20 });
  if (read.status !== 0) {
    notes.push("terminal-silence-unmeasured: the local silence read was unavailable; the playable cut was retained");
    return false;
  }
  let open = null, silenceStart = null;
  const audioEnd = media.audio.zeroSec + media.audio.decodedSec;
  for (const event of read.stderr.matchAll(/silence_(start|end):\s*([-+\d.eE]+)/g)) {
    const at = Number(event[2]);
    if (!Number.isFinite(at)) continue;
    if (event[1] === "start") open = at;
    else {
      if (open !== null && at >= audioEnd - 2 / EDIT_SAMPLE_RATE) silenceStart = open;
      open = null;
    }
  }
  if (open !== null) silenceStart = open;
  if (silenceStart === null) return false;
  let lastWord = Math.max(...words.map((row) => row.end));
  for (const seg of timeline.spine) for (const word of seg.words ?? []) {
    if (word.e > word.s && Number.isFinite(wordEnd(word))) lastWord = Math.max(lastWord, seg.startSec + wordEnd(word));
  }
  const authoredEnd = Math.max(0, ...timeline.spine.filter((seg) => seg.templateSpeech).map((seg) =>
    Math.min(seg.startSec + seg.seconds, seg.startSec + seg.templateSpeech.tailSec - (seg.inSec ?? 0))));
  // A selected narration reservation's real picture air was retained on
  // purpose (reservedNarration, fixedLength); quiet after the voice is not
  // trimmable terminal silence there. Only actual source frames count, never a hold.
  const reservedEnd = timeline.reservedNarration ? Math.max(0, ...timeline.spine
    .filter((seg) => seg.audio === "narration" && seg.fixedLength)
    .map((seg) => seg.startSec + Math.max(0, seg.seconds - (seg.holdSec ?? 0)))) : 0;
  const resolvedEnd = Math.max(0, ...[...timeline.spine, ...timeline.cutaways].flatMap((seg) =>
    (seg.motionProtection?.resolvedWindows ?? []).map((window) => window.endSec)));
  if (Math.max(authoredEnd, reservedEnd, resolvedEnd) > silenceStart + 1 / FPS) notes.push(
    `terminal-silence-authored: measured -50dB EOF silence starts ${silenceStart.toFixed(3)}s; ` +
    `resolved picture/acting reservation retained through ${Math.max(authoredEnd, reservedEnd, resolvedEnd).toFixed(3)}s, not claimed observed`);
  const frames = Math.max(Math.ceil(silenceStart * FPS - 1e-6),
    Math.floor((lastWord + .3) * FPS + 1e-6), Math.ceil(authoredEnd * FPS - 1e-6),
    Math.ceil(reservedEnd * FPS - 1e-6), Math.ceil(resolvedEnd * FPS - 1e-6));
  if (frames >= media.picture.frames || frames <= 0) return false;
  const endSec = frames / FPS;
  const spine = timeline.spine.filter((seg) => seg.startSec < endSec).map((seg) => {
    let next = seg;
    if (seg.startSec + seg.seconds > endSec) {
      next = { ...seg, seconds: endSec - seg.startSec };
      next.holdSec = holdFor(next);
      if (seg.map) next.map = { ...seg.map, residualFrames: 0 };
    }
    const tail = next.reaction?.tail;
    if (tail && tail.atSec + tail.seconds > endSec) next = { ...next, reaction: { ...next.reaction,
      tail: tail.atSec < endSec ? { ...tail, seconds: endSec - tail.atSec } : null } };
    return next;
  });
  const cutaways = timeline.cutaways.filter((shot) => shot.startSec < endSec).map((shot) =>
    shot.startSec + shot.seconds > endSec ? { ...shot, seconds: endSec - shot.startSec } : shot);
  let map = null;
  if (timeline.sourceMap) {
    const previous = timeline.sourceMap, whole = previous.wholeVoice;
    const retainedSamples = whole ? Math.max(0, frames * SAMPLES_PER_FRAME - whole.startSample) : 0;
    map = buildSourceMap({
      spine, cutaways, pictureFrames: frames, sourceMeta: manifest.sourceMeta ?? null,
      scriptLines: new Map((board?.script ?? []).map((line) => [line.lineId, line])),
      wholeVoice: whole && timeline.wholeVoice?.clock ? {
        file: timeline.wholeVoice.file, clock: timeline.wholeVoice.clock, declaredSec: whole.declaredSec,
        startFrame: whole.startFrame, retainedSamples, problems: [],
        intervals: whole.intervals.filter((interval) => spine.some((seg) => seg.wholeVoice && seg.sceneIndex === interval.scene))
          .map((interval) => ({ ...interval, toFrame: Math.min(interval.toFrame, frames - whole.startFrame) })),
      } : null,
    });
    map.sources = previous.sources;
    const hashes = new Map(map.sources.map((source) => [source.file, source.sha256]));
    for (const source of [...map.audibleSources, ...map.mutedPictures]) source.sha256 = hashes.get(source.file) ?? null;
    map.findings.push({ severity: "declared", code: "terminal-silence-trimmed", scene: null,
      detail: `retained edit ends at ${endSec}s; original source clocks and file hashes are unchanged` });
  }
  const trimmed = `${file}.terminal-trim.mp4`;
  try {
    const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", file,
      "-map", "0:v:0", "-map", "0:a:0", "-vf", `trim=end_frame=${frames},setpts=PTS-STARTPTS`,
      "-af", `atrim=end_sample=${frames * SAMPLES_PER_FRAME},asetpts=N/SR/TB`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", trimmed], { stdio: "inherit" });
    if (result.status !== 0) {
      notes.push("terminal-silence-untrimmed: the local EOF edit failed; the original playable cut was retained");
      return false;
    }
    const measured = measureMedia(trimmed);
    if (!measured?.picture || measured.picture.problems.length || measured.picture.frames !== frames ||
      !measured.audio || measured.audio.problems.length) {
      notes.push("terminal-silence-untrimmed: the local EOF edit could not prove its media clocks; the original playable cut was retained");
      return false;
    }
    renameSync(trimmed, file);
    timeline.spine = spine;
    timeline.cutaways = cutaways;
    if (map) timeline.sourceMap = map;
    notes.push(`terminal-silence-trimmed: removed ${(media.picture.endSec - endSec).toFixed(3)}s of measured final-mix silence; ` +
      `last word ends ${lastWord.toFixed(3)}s, final picture ends ${endSec.toFixed(3)}s; words and non-silent music retained`);
    return true;
  } finally { rmSync(trimmed, { force: true }); }
}

/**
 * A file's clocks as the cut uses them; `measured` false when it could not be
 * read at all. deltaSec: the sound's zero minus the picture's first frame, in
 * pts, on whole edit samples. zeroSample: the edit sample of the decoded sound
 * (priming counted, as the filter counts it) that meets picture slot 0.
 */
export function clockOf(media) {
  const picture = media?.picture && media.picture.problems.length === 0 ? media.picture : null;
  const audio = media?.audio && media.audio.problems.length === 0 ? media.audio : null;
  const deltaSamples = picture && audio ? Math.round((audio.zeroSec - picture.originSec) * EDIT_SAMPLE_RATE) : 0;
  return {
    measured: Boolean(media), media: media ?? null, picture, audio,
    deltaSec: deltaSamples / EDIT_SAMPLE_RATE,
    zeroSample: (audio?.edit.priming ?? 0) - deltaSamples,
  };
}

/** Why a clock cannot carry a route, or null: `need` is "picture" or "audio". */
function clockProblem(clock, need) {
  if (!clock?.measured) return "its decoded frames and samples could not be read";
  const stream = clock.media[need];
  if (!stream) return `it has no ${need === "picture" ? "picture" : "sound"} stream`;
  return stream.problems.length > 0 ? stream.problems.join("; ") : null;
}

/**
 * A sentence gap cut on a clip's own word clock, moved inward to whole slots
 * of its picture (never into the words it lies between) and back, so the
 * picture and the sound lose the same slots and the words after it move by
 * exactly that. A cut under one slot is dropped.
 */
function cutsOnSlots(cuts, deltaSec) {
  return cuts.flatMap((c) => {
    const from = Math.ceil((c.s + deltaSec) * FPS - 1e-6);
    const to = Math.floor((c.e + deltaSec) * FPS + 1e-6);
    return to > from ? [{ ...c, s: from / FPS - deltaSec, e: to / FPS - deltaSec, slots: [from, to] }] : [];
  });
}

const removedSlots = (cuts) => (cuts ?? []).reduce((n, c) => n + (c.slots ? c.slots[1] - c.slots[0] : 0), 0);

/** A post-cut picture slot back on the clip's own slots: every cut that starts at or before it is added back. */
function preCutSlot(cuts, m) {
  let removed = 0;
  for (const c of cuts ?? []) if (c.slots && c.slots[0] - removed <= m) removed += c.slots[1] - c.slots[0];
  return m + removed;
}

/**
 * A word's last sound on its own clock: where the scribe gave phonemes, the
 * last one's end (kept as phoneEndAfterSec, so it moves with the word);
 * otherwise the word's end, which is no proof of its last phoneme.
 */
const wordEnd = (w) => w.e + Math.max(0, w.phoneEndAfterSec ?? 0);
export function withPhonemeEnds(words) {
  if (!Array.isArray(words)) return words;
  return words.map((w) => {
    const ends = (Array.isArray(w?.phonemes) ? w.phonemes : []).map((p) => Number(p?.e)).filter(Number.isFinite);
    return ends.length > 0 ? { ...w, phoneEndAfterSec: Math.max(...ends) - w.e } : w;
  });
}

/**
 * The measured map: each piece on whole slots of its own picture and whole frames of the
 * edit. A piece's picture starts on a slot of its post-cut picture and its
 * sound's in-point is derived from that slot, its words moved with it, so
 * picture and sound never part by a rounding. Ends are rounded cumulatively,
 * so the edit never drifts more than a frame whatever the number of pieces;
 * never inside a piece's last word, and never past the picture it has unless
 * a word needs it (holdSec, which the map refuses).
 */
function snapToFrames(spine) {
  let exact = 0;
  let frame = 0;
  for (const seg of spine) {
    exact += seg.seconds;
    let available = Infinity;
    if (seg.editorialHold) {
      const source = spine[spine.indexOf(seg) - 1];
      const clock = source && pieceClock(source);
      if (!source || source.sceneIndex !== seg.editorialHold.sourceSceneIndex || source.editorialHold ||
        !clock.picture || clock.picture.shown !== clock.frames || clock.frames < 1) {
        throw new SourceMapRefusal("The selected editorial hold has no retained source-frame provenance", [
          { severity: "refuse", code: "editorial-hold-source-unproven", scene: seg.sceneIndex, detail: "the immediately preceding selected source must retain a complete measured picture interval" },
        ]);
      }
      const sourceSlot = preCutSlot(source.cuts, clock.picture.inSlot + clock.frames - 1);
      seg.editorialHold = { ...seg.editorialHold, sourceSlot, sourceFrame: frameAtSlot(source.map.picture, sourceSlot) };
      seg.file = source.file;
      seg.map = { ...seg.map, picture: source.map.picture, media: source.map.media, slot: sourceSlot, availableSlots: Infinity };
    }
    if (seg.source === "clip" && seg.map?.picture && !seg.editorialHold) {
      const own = seg.audio === "clip";
      const delta = own ? seg.map.deltaSec : 0;
      const slot = Math.max(0, Math.round(((seg.inSec ?? 0) + delta) * FPS));
      const inSec = slot / FPS - delta;
      const shift = (seg.inSec ?? 0) - inSec;
      if (own && seg.words) seg.words = seg.words.map((w) => ({ ...w, s: w.s + shift, e: w.e + shift }));
      seg.inSec = inSec;
      available = Math.max(0, seg.map.picture.endSlot - removedSlots(seg.cuts) - slot);
      seg.map = { ...seg.map, slot, availableSlots: available };
    }
    const words = seg.words ?? [];
    const lastEnd = words.length ? Math.max(...words.map(wordEnd)) : 0;
    // A song word may continue over a picture cut; the master is never split.
    const needed = !seg.songOnly && lastEnd > 0 ? Math.ceil(lastEnd * FPS - 1e-6) : 0;
    let end = Math.max(Math.round(exact * FPS), frame + needed, frame + 1);
    // A stretch of a whole voice has the song's length, not the clip's: short picture there is a hold, refused.
    const fixed = seg.wholeVoice || seg.fixedLength;
    if (!fixed && end - frame > available && available >= Math.max(needed, 1)) end = frame + available;
    if (seg.editorialHold && end - frame !== Math.ceil(seg.editorialHold.seconds * FPS - 1e-6)) {
      throw new SourceMapRefusal("The selected editorial hold does not fit its authorized clock", [
        { severity: "refuse", code: "editorial-hold-clock-mismatch", scene: seg.sceneIndex,
          detail: "the continuing narration/word clock cannot be shortened or padded by changing the selected retained-frame hold" },
      ]);
    }
    seg.map = { ...(seg.map ?? {}), residualFrames: end - exact * FPS };
    seg.seconds = (end - frame) / FPS;
    seg.holdSec = Math.max(0, end - frame - available) / FPS;
    if (seg.reaction?.tail) seg.reaction.tail.fromSec = seg.inSec + seg.seconds;
    frame = end;
  }
}

/**
 * The one reading of a piece on the measured clocks, which the map records
 * and the renderer cuts: its post-cut picture slots and the sentence-gap slots
 * taken out first; its sound's edit samples, derived from the picture slot
 * (a clip's own sound) or from the same slot of its voice (narration). Sample
 * ranges past what decodes are silence the map names, never a word.
 */
export function pieceClock(seg) {
  const m = seg.map ?? null;
  const frames = Math.round(seg.seconds * FPS);
  const out = { frames, picture: null, sound: null };
  if (seg.source !== "clip" || !m?.picture || !Number.isInteger(m.slot)) return out;
  const cutSlots = (seg.cuts ?? []).filter((c) => c.slots).map((c) => c.slots);
  out.picture = { inSlot: m.slot, shown: seg.editorialHold ? frames : Math.min(frames, m.availableSlots), cutSlots };
  const own = seg.audio === "clip";
  const clock = own ? m : seg.audio === "narration" && !seg.wholeVoice ? m.voice ?? null : null;
  if (!clock?.audio) return out;
  const zero = own ? m.zeroSample : clock.audio.edit.priming;
  const from = zero + (seg.editorialHold ? 0 : m.slot * SAMPLES_PER_FRAME);
  const cutSamples = own ? cutSlots.map(([s, e]) => [zero + s * SAMPLES_PER_FRAME, zero + e * SAMPLES_PER_FRAME]) : [];
  out.sound = {
    zeroSample: zero, fromSample: from, toSample: from + frames * SAMPLES_PER_FRAME, cutSamples,
    available: clock.audio.edit.samples - cutSamples.reduce((n, [s, e]) => n + e - s, 0),
  };
  return out;
}

/** A time on the edit side of a piece's sentence-gap cuts, back on the source's own word clock. */
function sourceTimeOf(seg, t, isEnd) {
  const post = t + (seg.inSec ?? 0);
  let removed = 0;
  for (const c of seg.cuts ?? []) {
    const at = c.s - removed;
    if (isEnd ? post > at + 1e-9 : post >= at - 1e-9) removed += c.e - c.s;
  }
  return post + removed;
}
/** Source clips visible in the decoded cut; authored windows remain reservations, never action receipts. */
function directorCutProjection(cut, board) {
  const map = cut?.sourceMap;
  const measured = map?.fps === FPS && Number.isInteger(map.frames) && map.render?.frames === map.frames;
  const overlays = map?.overlays ?? [];
  const graphics = [];
  if (cut?.text?.directives) {
    const d = cut.text.directives;
    for (const card of [...(d.cards ?? []), d.hook, d.endCard]) if (card?.proof?.presentation === "full-frame") {
      const clock = textFrameWindow(card.in, card.out);
      graphics.push({ startFrame: clock.startFrame, frames: clock.frames });
    }
  }
  const covers = graphics.length ? [...overlays, ...graphics] : overlays;
  const pieces = map?.pieces ?? [];
  const spine = cut?.timeline?.spine ?? [];
  const segments = [];
  let known = true;
  const append = (sceneIndex, sourceFrom, sourceTo, finalFrom, finalTo, hidden = covers) => {
    let visible = [{ from: finalFrom, to: finalTo }];
    for (const overlay of hidden) {
      const from = overlay.startFrame / FPS, to = (overlay.startFrame + overlay.frames) / FPS;
      visible = visible.flatMap((span) => to <= span.from || from >= span.to ? [span]
        : [{ from: span.from, to: from }, { from: to, to: span.to }].filter((s) => s.to > s.from));
    }
    for (const span of visible) if (span.to > span.from) {
      const rate = (sourceTo - sourceFrom) / (finalTo - finalFrom);
      segments.push({ sceneIndex, sourceStartSec: r6(sourceFrom + (span.from - finalFrom) * rate),
        sourceEndSec: r6(sourceFrom + (span.to - finalFrom) * rate), finalStartSec: r6(span.from), finalEndSec: r6(span.to) });
    }
  };
  if (measured) {
    for (const piece of pieces) {
      if (piece.route?.picture !== "clip") continue;
      const picture = piece.picture, source = piece.source?.picture;
      if (!picture || !source) { known = false; continue; }
      if (picture.editorialHold) {
        const slot = picture.editorialHold.sourceSlot;
        append(piece.sceneIndex, slot / FPS, (slot + 1) / FPS,
          piece.edit.startFrame / FPS, (piece.edit.startFrame + piece.edit.frames) / FPS);
        continue;
      }
      const cuts = (picture.cutSlots ?? []).map((slots) => ({ slots }));
      let post = picture.inSlot, at = piece.edit.startFrame, left = piece.edit.frames;
      while (left > 0) {
        const from = preCutSlot(cuts, post);
        const next = cuts.find((c) => c.slots[0] > from)?.slots[0] ?? source.slots;
        const count = Math.min(left, next - from, source.slots - from);
        if (!(count > 0)) {
          if (picture.heldFrames >= left && source.slots > 0) {
            append(piece.sceneIndex, (source.slots - 1) / FPS, source.slots / FPS, at / FPS, (at + left) / FPS);
          } else known = false;
          break;
        }
        append(piece.sceneIndex, from / FPS, (from + count) / FPS, at / FPS, (at + count) / FPS);
        post += count; at += count; left -= count;
      }
    }
    for (const [index, overlay] of overlays.entries()) {
      if (overlay.source !== "clip") continue;
      const owner = cut.timeline.cutaways?.find((s) => s.sceneIndex === overlay.scene &&
        (s.startSec === undefined || Math.round(s.startSec * FPS) === overlay.startFrame));
      const available = owner?.map?.picture?.endSlot;
      const inSec = owner?.inSec ?? 0;
      if (!(available > 0) || (inSec + overlay.frames / FPS) * FPS > available) { known = false; continue; }
      append(overlay.scene, inSec, inSec + overlay.frames / FPS,
        overlay.startFrame / FPS, (overlay.startFrame + overlay.frames) / FPS, [...overlays.slice(index + 1), ...graphics]);
    }
  }
  const bound = [];
  for (const scene of board?.scenes ?? []) {
    if (!scene.directorBeats?.length && !scene.actionPhases?.length) continue;
    const source = pieces.find((p) => p.sceneIndex === scene.sceneIndex && p.source?.picture);
    const delta = source?.route.audio === "clip" ? source.source.audioMinusPictureSec : 0;
    if (!source || !Number.isFinite(delta)) continue;
    const rows = [], seen = new Set();
    for (const seg of spine) if (seg.sceneIndex === scene.sceneIndex) for (const word of seg.words ?? []) {
      const s = sourceTimeOf(seg, word.s, false) + delta, e = sourceTimeOf(seg, word.e, true) + delta;
      const key = `${word.lineId}:${word.w}:${s}:${e}`;
      if (!seen.has(key)) { seen.add(key); rows.push({ ...word, s, e }); }
    }
    rows.sort((a, b) => a.s - b.s);
    const ids = scene.lineIds ?? spine.filter((s) => s.sceneIndex === scene.sceneIndex).flatMap((s) => s.lineIds ?? []);
    const windows = templateActionWindows(rows, {
      durationSec: source.source.picture.endSec,
      lines: (board.script ?? []).filter((line) => ids.includes(line.lineId)),
      actionPhases: scene.actionPhases, directorBeats: scene.directorBeats,
    });
    for (const window of windows) bound.push({ ...window, sceneIndex: scene.sceneIndex,
      startSec: r6(window.startSec), endSec: r6(window.endSec) });
  }
  segments.sort((a, b) => a.finalStartSec - b.finalStartSec || a.sceneIndex - b.sceneIndex);
  const kept = measured && known ? segments : undefined;
  const reservations = [];
  for (const scene of board?.scenes ?? []) {
    const requested = [...(scene.directorBeats ?? []), ...(scene.actionPhases ?? []).filter((p) => p.required)];
    if (!requested.length) continue;
    const windows = bound.filter((w) => w.sceneIndex === scene.sceneIndex);
    if (!kept || requested.some((p) => !windows.some((w) => w.id === p.id))) {
      // Missing clocks do not justify invented placements or a graphic over unknown acting.
      for (const span of sceneTimes({ spine, cutaways: cut?.timeline?.cutaways ?? [] }, true)) {
        if (span.scene === scene.sceneIndex && span.seconds > 0) reservations.push({ startSec: span.startSec, endSec: span.startSec + span.seconds });
      }
    } else for (const window of windows) for (const seg of kept) {
      const from = Math.max(window.startSec, seg.sourceStartSec), to = Math.min(window.endSec, seg.sourceEndSec);
      if (seg.sceneIndex !== scene.sceneIndex || !(to > from)) continue;
      const rate = (seg.finalEndSec - seg.finalStartSec) / (seg.sourceEndSec - seg.sourceStartSec);
      reservations.push({ startSec: seg.finalStartSec + (from - seg.sourceStartSec) * rate,
        endSec: seg.finalStartSec + (to - seg.sourceStartSec) * rate });
    }
  }
  return { ...(kept ? { segments: kept } : {}), beatWindows: bound.filter((w) => w.kind === "director-beat")
    .map((w) => ({ sceneIndex: w.sceneIndex, beatId: w.id, startSec: w.startSec, endSec: w.endSec })), reservations };
}

/** Transport only: bound intention plus actual kept clips, with no claimed endpoint observation. */
export function directorCutEvidence(cut, board) {
  const { reservations, ...evidence } = directorCutProjection(cut, board);
  const graphics = [];
  const text = cut?.text?.directives;
  if (text) for (const card of [...(text.cards ?? []), text.hook, text.endCard]) {
    if (card?.proof?.presentation !== "full-frame") continue;
    const clock = textFrameWindow(card.in, card.out);
    graphics.push({ sceneIndex: null, source: "graphic", startSec: clock.startFrame / FPS, seconds: clock.frames / FPS });
  }
  return { ...evidence, ...finalSetupAdjacency(cut?.timeline ?? { spine: [], cutaways: [] }, board, graphics) };
}

/** Each script line a piece speaks, as its own part: `lineId@scene.piece`, unique when a line is split across scenes or takes. */
function lineParts(seg, scriptLines) {
  const ids = seg.lineIds ?? [];
  const words = seg.words ?? [];
  const n = seg.piece?.n ?? 1;
  const parts = [];
  let cursor = 0;
  for (const lineId of ids) {
    const part = `${lineId}@${seg.sceneIndex}.${n}`;
    const remaining = words.slice(cursor);
    const span = remaining.length === 0 ? null
      : ids.length === 1 ? { first: 0, last: remaining.length - 1 }
      : scriptedSpan(remaining, [scriptLines.get(lineId)?.text]);
    if (!span) {
      parts.push({ part, lineId, measured: false });
      continue;
    }
    const heard = remaining.slice(span.first, span.last + 1);
    const s = Math.min(...heard.map((x) => x.s));
    const e = Math.max(...heard.map(wordEnd));
    const last = heard.find((x) => wordEnd(x) === e);
    parts.push({
      part, lineId, measured: true, words: heard.length, firstWord: cursor + span.first, lastWord: cursor + span.last,
      sourceSpan: scriptLines.get(lineId)?.sourceSpan ?? null,
      local: { startSec: s, endSec: e },
      src: { startSec: r6(sourceTimeOf(seg, s, false)), endSec: r6(sourceTimeOf(seg, e, true)) },
      edit: {
        startSec: r6(seg.startSec + s), endSec: r6(seg.startSec + e),
        startFrame: Math.floor((seg.startSec + s) * FPS + 1e-6),
        lastFrame: Math.ceil((seg.startSec + e) * FPS - 1e-6) - 1,
      },
      endEvidence: Number.isFinite(last?.phoneEndAfterSec) ? "phoneme" : "asr-word-end",
    });
    cursor += span.last + 1;
  }
  return parts;
}

/**
 * Where a planned action lead or tail stands. Only a picture event measured on
 * the clip's own decoded picture clock (the manifest scene's actionEvidence:
 * { leadStartSec, tailEndSec }, seconds from its first decoded frame) can show
 * it kept; a word time or the planned length is no evidence.
 */
function actionOf(wantedSec, eventSec, shownSec, isLead) {
  if (!(wantedSec > 0)) return { wantedSec: 0, status: "not-asked" };
  if (!Number.isFinite(eventSec) || !shownSec) return { wantedSec, status: "unproven", eventSec: null };
  const kept = isLead ? shownSec.fromSec <= eventSec + 1e-9 : shownSec.toSec >= eventSec - 1e-9;
  return { wantedSec, status: kept ? "kept" : "short", eventSec: r6(eventSec), shownSec: { fromSec: r6(shownSec.fromSec), toSec: r6(shownSec.toSec) } };
}

/**
 * The measured source-to-edit map: for every piece of the spine, its picture
 * and sound routes, the decoded frame range and sample range it plays, where it
 * sits on the edit's frame and sample grid, the script-line parts it speaks,
 * its action lead/tail evidence; then the overlays and the whole voice. Every
 * number is the one the renderer cuts with (pieceClock). `findings` are what
 * it could not honor; each "refuse" stops the cut (SourceMapRefusal): nothing
 * unmeasured, frozen, padded into a song or cut out of one is delivered.
 * "declared" ones are measured facts the cut carries out, said.
 */
export function buildSourceMap({ spine, cutaways, scriptLines, wholeVoice = null, pictureFrames, sourceMeta = null }) {
  const findings = [];
  const flag = (severity, code, seg, detail) =>
    findings.push({ severity, code, scene: seg?.sceneIndex ?? null, detail });
  // What the cut lets be heard, from the route each piece actually plays, and
  // the pictures whose own sound it does not: no listen to a source may count
  // for a muted picture. Owner, accepted lines and storage id are only what
  // the pull's sourceMeta says of that exact file, else null (unknown).
  const audibleSources = [];
  const mutedPictures = [];
  const metaOf = (file) => {
    const meta = sourceMeta && typeof sourceMeta === "object" ? sourceMeta[file] : null;
    return {
      owner: typeof meta?.owner === "string" ? meta.owner : null,
      acceptedLineIds: Array.isArray(meta?.acceptedLineIds) ? meta.acceptedLineIds.filter((id) => typeof id === "string") : null,
      storageId: typeof meta?.storageId === "string" ? meta.storageId : null,
      // The producing artifact's own kind, only as the pull states it: a whole voice is never labelled a song here.
      kind: ["native-clip", "voiceover", "song-master"].includes(meta?.kind) ? meta.kind : null,
    };
  };
  const pieces = spine.map((seg) => {
    const m = seg.map ?? null;
    const startFrame = Math.round(seg.startSec * FPS);
    const clock = pieceClock(seg);
    const { frames } = clock;
    const own = seg.audio === "clip";
    const voiced = seg.audio === "narration" && !seg.wholeVoice;
    if (seg.source === "still") flag("refuse", "still-picture", seg, "a keyframe held as a still has no decoded clock: it is one frozen frame");
    const noPicture = seg.source === "clip" ? clockProblem(m, "picture") : null;
    if (noPicture) flag("refuse", "unmeasured-picture", seg, `${seg.file}: ${noPicture}`);
    const noSound = own ? clockProblem(m, "audio") : voiced ? clockProblem(m?.voice, "audio") : null;
    if (noSound) flag("refuse", own ? "unmeasured-sound" : "unmeasured-voice", seg, `${own ? seg.file : seg.voice}: ${noSound}`);
    for (const w of seg.lostWords ?? []) {
      flag("refuse", "word-past-picture-eof", seg, `"${w.w}" ends at ${r6(w.e)}s on its sound's clock, after the clip's picture ends at ${r6(w.pictureEndSec)}s`);
    }
    const parts = lineParts(seg, scriptLines);
    const spoken = parts.filter((p) => p.measured);
    if ((seg.lineIds?.length ?? 0) > 0 && spoken.length < seg.lineIds.length) {
      const unplaced = parts.filter((p) => !p.measured).map((p) => p.part).join(", ");
      flag("refuse", "unmeasured-words", seg, `no heard word times place ${unplaced}`);
    }

    let picture = null;
    let shownSec = null;
    if (clock.picture) {
      const pic = m.picture;
      const { inSlot, shown } = clock.picture;
      const pre = (k) => seg.editorialHold ? seg.editorialHold.sourceSlot : preCutSlot(seg.cuts, inSlot + k);
      let repeated = 0;
      let skipped = 0;
      let prev = null;
      for (let k = 0; k < shown; k++) {
        const i = frameAtSlot(pic, pre(k));
        if (prev !== null && i === prev.i) repeated++;
        else if (prev !== null && pre(k) === prev.slot + 1) skipped += Math.max(0, i - prev.i - 1);
        prev = { i, slot: pre(k) };
      }
      const first = shown > 0 ? frameAtSlot(pic, pre(0)) : null;
      const last = shown > 0 ? frameAtSlot(pic, pre(shown - 1)) : null;
      picture = {
        inSlot: pre(0), lastSlot: shown > 0 ? pre(shown - 1) : null,
        firstFrame: first, lastFrame: last,
        firstPtsSec: first === null ? null : r6(pic.ptsSec[first]), lastPtsSec: last === null ? null : r6(pic.ptsSec[last]),
        cutSlots: clock.picture.cutSlots, repeatedSlots: repeated, skippedFrames: skipped, heldFrames: frames - shown,
      };
      if (seg.editorialHold) picture.editorialHold = {
        sourceSceneIndex: seg.editorialHold.sourceSceneIndex, sourceSlot: seg.editorialHold.sourceSlot,
        sourceFrame: seg.editorialHold.sourceFrame, frames, boundary: "retained-end",
      };
      if (shown > 0) shownSec = { fromSec: pre(0) / FPS, toSec: (pre(shown - 1) + 1) / FPS };
      if (frames > shown) {
        flag(seg.templateNarrationHold ? "declared" : "refuse",
          seg.templateNarrationHold ? "template-audio-source-reservation" : "picture-hold", seg,
          `${frames - shown} edit frame(s) past the clip's last decoded frame (slot ${pic.endSlot}) ${seg.templateNarrationHold
            ? "explicitly repeat its retained last frame to preserve approved narration without buying more footage"
            : "would be a frozen copy"}`);
      }
    }
    let sound = null;
    if (clock.sound) {
      const { fromSample, toSample, available } = clock.sound;
      sound = {
        ...clock.sound,
        leadSilenceSamples: Math.max(0, -fromSample), tailSilenceSamples: Math.max(0, toSample - available),
      };
      if (sound.leadSilenceSamples > 0) flag("declared", "sound-starts-late", seg, `the decoded sound starts ${sound.leadSilenceSamples} samples into the piece`);
      if (sound.tailSilenceSamples > 0) flag("declared", "sound-ends-early", seg, `the decoded sound ends ${sound.tailSilenceSamples} samples before the piece`);
      for (const p of spoken) {
        const endSample = fromSample + Math.ceil(p.local.endSec * EDIT_SAMPLE_RATE - 1e-6);
        if (endSample > available) {
          flag("refuse", "word-past-audio-eof", seg, `${p.part} ends on sample ${endSample} but the sound decodes ${available}`);
        }
        if (fromSample + Math.floor(p.local.startSec * EDIT_SAMPLE_RATE + 1e-6) < (own ? m.audio : m.voice.audio).edit.priming) {
          flag("refuse", "word-before-sound", seg, `${p.part} starts before the sound's first presented sample`);
        }
      }
    }
    // Song captions belong to the continuous master's clock, not the picture
    // piece they happen to accompany; still refuse words past that audio EOF.
    const wordLimit = seg.songOnly && wholeVoice?.clock?.audio
      ? wholeVoice.startFrame + Math.ceil(wholeVoice.clock.audio.decodedSec * FPS - 1e-6)
      : startFrame + frames;
    for (const p of spoken) {
      if (p.local.startSec < -1e-6) flag("refuse", "word-before-piece", seg, `${p.part} starts ${r6(-p.local.startSec)}s before its piece`);
      if (p.edit.lastFrame >= wordLimit) {
        flag("refuse", seg.songOnly ? "word-past-audio-eof" : "word-past-piece", seg, `${p.part}'s last word ends on frame ${p.edit.lastFrame}, after its ${seg.songOnly ? "song master" : "piece"}'s ${wordLimit - 1}`);
      }
    }
    const ev = seg.actionEvidence ?? null;
    const action = {
      lead: actionOf(seg.actionLeadSec ?? 0, Number(ev?.leadStartSec), shownSec, true),
      tail: actionOf(seg.actionTailSec ?? 0, Number(ev?.tailEndSec), shownSec, false),
    };
    for (const [side, a] of Object.entries(action)) {
      if (a.status === "unproven") flag("refuse", `action-${side}-unproven`, seg, `the storyboard asks ${a.wantedSec}s of action ${side} and no picture event was measured to show it is kept`);
      if (a.status === "short") flag("refuse", `action-${side}-short`, seg, `the measured action ${side === "lead" ? "starts" : "ends"} at ${a.eventSec}s, outside the picture the piece shows`);
    }
    const pieceId = seg.piece ? `${seg.sceneIndex}.${seg.piece.n}` : String(seg.sceneIndex);
    if (seg.source === "clip" && !own) mutedPictures.push({ file: seg.file, sceneIndex: seg.sceneIndex, piece: pieceId });
    if (sound) {
      const file = own ? seg.file : seg.voice;
      audibleSources.push({
        file, route: own ? "clip" : "narration", sceneIndex: seg.sceneIndex, sceneIndexes: [seg.sceneIndex], piece: pieceId,
        edit: { fromSample: startFrame * SAMPLES_PER_FRAME + sound.leadSilenceSamples, toSample: (startFrame + frames) * SAMPLES_PER_FRAME - sound.tailSilenceSamples },
        source: { fromSample: Math.max(0, sound.fromSample), toSample: Math.min(sound.toSample, sound.available), cutSamples: sound.cutSamples },
        // A reaction's tail: the same file heard on past its beat, under the next line.
        ...(own && seg.reaction?.tail ? {
          tail: {
            editFromSample: Math.round(seg.reaction.tail.atSec * FPS) * SAMPLES_PER_FRAME,
            samples: Math.round(seg.reaction.tail.seconds * EDIT_SAMPLE_RATE),
          },
        } : {}),
        lineParts: spoken.map((p) => p.part),
        ...metaOf(file),
      });
    }
    const media = m?.media ?? null;
    const audioClock = own ? m?.audio : voiced ? m?.voice?.audio : null;
    return {
      piece: seg.piece ? `${seg.sceneIndex}.${seg.piece.n}` : String(seg.sceneIndex),
      sceneIndex: seg.sceneIndex,
      route: { picture: seg.source, audio: seg.wholeVoice ? "whole-voice" : seg.audio, file: seg.file, voice: seg.voice ?? null },
      source: media ? {
        picture: m.picture ? {
          timeBase: m.picture.timeBase, originSec: r6(m.picture.originSec), frames: m.picture.frames,
          endSec: r6(m.picture.endSec), slots: m.picture.endSlot,
        } : null,
        audio: audioClock ? {
          timeBase: audioClock.timeBase, sampleRate: audioClock.sampleRate, originSec: r6(audioClock.originSec),
          samples: audioClock.samples, primingSamples: audioClock.primingSamples, decodedSec: r6(audioClock.decodedSec),
        } : null,
        audioMinusPictureSec: own ? r6(m.deltaSec) : null,
      } : null,
      edit: {
        startFrame, frames, startSample: startFrame * SAMPLES_PER_FRAME, samples: frames * SAMPLES_PER_FRAME,
        residualFrames: r6(m?.residualFrames ?? 0),
      },
      picture,
      sound,
      lineParts: parts.map(({ local, ...p }) => p),
      action,
    };
  });
  const overlays = cutaways.map((c) => {
    const startFrame = Math.round(c.startSec * FPS);
    const frames = Math.round(c.seconds * FPS);
    if (c.source === "still") flag("refuse", "still-picture", c, "a keyframe laid over the cut has no decoded clock: it is one frozen frame");
    const problem = c.source === "clip" ? clockProblem(c.map, "picture") : null;
    if (problem) flag("refuse", "unmeasured-picture", c, `${c.file}: ${problem}`);
    const pic = problem ? null : c.map?.picture ?? null;
    const inSlot = Math.round((c.inSec ?? 0) * FPS);
    if (pic && inSlot + frames > pic.endSlot) flag("refuse", "picture-hold", c, `the overlay needs ${inSlot + frames} slots, its clip decodes ${pic.endSlot}`);
    if (c.source === "clip") mutedPictures.push({ file: c.file, sceneIndex: c.sceneIndex, piece: null });
    return {
      scene: c.sceneIndex, source: c.source, method: c.method ?? null, onPiece: c.spineSceneIndex ?? null,
      startFrame, frames, startSec: r6(c.startSec), seconds: r6(c.seconds),
      picture: pic && frames > 0 ? { firstFrame: frameAtSlot(pic, inSlot), lastFrame: frameAtSlot(pic, Math.min(inSlot + frames, pic.endSlot) - 1) } : null,
    };
  });
  let whole = null;
  if (wholeVoice) {
    const c = wholeVoice.clock;
    const problem = clockProblem(c, "audio");
    whole = {
      file: wholeVoice.file, startFrame: wholeVoice.startFrame, startSample: wholeVoice.startFrame * SAMPLES_PER_FRAME,
      declaredSec: r6(wholeVoice.declaredSec), intervals: wholeVoice.intervals,
    };
    if (problem) flag("refuse", "unmeasured-whole-voice", null, `${wholeVoice.file}: ${problem}`);
    for (const p of wholeVoice.problems) flag("refuse", "whole-voice-interval", null, p);
    if (!problem) {
      const sourceSamples = c.audio.edit.samples - c.audio.edit.priming;
      const songSamples = Math.min(sourceSamples, wholeVoice.retainedSamples ?? sourceSamples);
      const endSample = whole.startSample + songSamples;
      const pictureSamples = pictureFrames * SAMPLES_PER_FRAME;
      Object.assign(whole, {
        sampleRate: c.audio.sampleRate, primingSamples: c.audio.primingSamples, decodedSec: r6(c.audio.decodedSec),
        samples: songSamples, endSample, pictureEndSample: pictureSamples,
        ...(songSamples < sourceSamples ? { trimmedSilenceSamples: sourceSamples - songSamples } : {}),
      });
      // One retained master input, never per-scene slices; only measured terminal silence may be omitted.
      audibleSources.push({
        file: wholeVoice.file, route: "whole-voice", sceneIndex: null,
        sceneIndexes: pieces.filter((p) => p.route.audio === "whole-voice").map((p) => p.sceneIndex), piece: "whole-voice",
        edit: { fromSample: whole.startSample, toSample: Math.min(endSample, pictureSamples) },
        source: { fromSample: c.audio.edit.priming, toSample: c.audio.edit.priming + songSamples, cutSamples: [] },
        lineParts: pieces.filter((p) => p.route.audio === "whole-voice").flatMap((p) => p.lineParts.filter((l) => l.measured).map((l) => l.part)),
        ...metaOf(wholeVoice.file),
      });
      if (endSample > pictureSamples) {
        flag("refuse", "whole-voice-tail-cut", null, `the song ends on edit sample ${endSample} but the picture on ${pictureSamples}: its tail would be cut, never stretched`);
      } else if (pictureSamples - endSample >= SAMPLES_PER_FRAME) {
        flag("refuse", "whole-voice-short", null, `the picture runs ${pictureSamples - endSample} samples past the song's last decoded sample; the song is never padded or looped to fill it`);
      }
      for (const iv of wholeVoice.intervals) {
        const seg = spine.find((s) => s.wholeVoice && s.sceneIndex === iv.scene);
        const at = seg ? Math.round(seg.startSec * FPS) - wholeVoice.startFrame : null;
        if (at !== iv.fromFrame) {
          flag("refuse", "whole-voice-drift", seg ?? null, `scene ${iv.scene} starts ${at} frames into the song, its stretch of it at ${iv.fromFrame}`);
        }
      }
    }
  }
  return {
    version: "source-edit-map.v2", fps: FPS, sampleRate: EDIT_SAMPLE_RATE, samplesPerFrame: SAMPLES_PER_FRAME,
    clock: "edit frames at 1/24 s and edit samples at 48 kHz from 0, before any loudness pass; a picture slot is ceil(pts*24) of the clip's first decoded frame; a sound's zero is its first decoded sample after any negative-pts priming, and word times count from it",
    frames: pictureFrames, samples: pictureFrames * SAMPLES_PER_FRAME, pieces, overlays, wholeVoice: whole,
    audibleSources, mutedPictures, findings,
  };
}

/**
 * The rendered cut against its map, on what the output decodes to: its
 * picture exactly the map's frames, each on the 1/24 s grid from the first,
 * and its sound the map's samples and start within RENDER_SAMPLE_TOLERANCE
 * (one AAC frame, the encoder's own priming and padding). Every piece's picture
 * is cut to at most its frames and its sound padded to exactly its samples, so
 * the whole cut's counts holding is every boundary holding. No container
 * duration is read.
 */
export function renderFindings(map, decoded, planningBudget = null) {
  const findings = [];
  const refuse = (code, detail) => findings.push({ severity: "refuse", code, scene: null, detail });
  const render = { frames: null, frameDelta: null, samples: null, sampleDelta: null, soundStartSamples: null };
  const pic = decoded?.picture ?? null;
  const aud = decoded?.audio ?? null;
  if (!decoded) refuse("render-unmeasured", "the rendered cut's decoded frames and samples could not be read");
  if (decoded && (!pic || pic.problems.length > 0)) refuse("render-picture-clock", pic ? pic.problems.join("; ") : "the cut has no picture");
  if (decoded && (!aud || aud.problems.length > 0)) refuse("render-sound-clock", aud ? aud.problems.join("; ") : "the cut has no sound");
  if (pic && pic.problems.length === 0) {
    render.frames = pic.frames;
    render.frameDelta = map ? pic.frames - map.frames : null;
    if (map && render.frameDelta !== 0) refuse("render-frames", `the cut decodes ${pic.frames} frames, its map ${map.frames}`);
    const off = pic.ptsSec.findIndex((t, k) => Math.abs(t * FPS - k) > 1e-3);
    if (off >= 0) refuse("render-picture-grid", `rendered frame ${off} is at ${r6(pic.ptsSec[off])}s, off the 1/24 s grid`);
  }
  if (aud && aud.problems.length === 0) {
    render.samples = Math.round(((aud.samples - aud.primingSamples) * EDIT_SAMPLE_RATE) / aud.sampleRate);
    render.sampleDelta = map ? render.samples - map.samples : null;
    if (map && Math.abs(render.sampleDelta) > RENDER_SAMPLE_TOLERANCE) {
      refuse("render-samples", `the cut decodes ${render.samples} samples, its map ${map.samples}`);
    }
    if (pic && pic.problems.length === 0) {
      render.soundStartSamples = Math.round((aud.zeroSec - pic.originSec) * EDIT_SAMPLE_RATE);
      if (Math.abs(render.soundStartSamples) > RENDER_SAMPLE_TOLERANCE) {
        refuse("render-av-start", `the cut's sound starts ${render.soundStartSamples} samples from its first frame`);
      }
    }
  }
  if (!planningBudget) return { findings, render };
  const overrun = planningBudget.overrun ?? { name: "none", seconds: 0 };
  const ceilingSeconds = planningBudget.targetSeconds + overrun.seconds;
  // The selected budget is a maximum, never a request to pad or shorten.
  // Counts certify seconds only on the actual complete decoded 24 fps clock.
  const measured = Number.isSafeInteger(render.frames) && render.frames > 0 &&
    pic?.ptsSec.length === render.frames && pic.ptsSec.every((t, k) => Number.isFinite(t) && Math.abs(t * FPS - k) <= 1e-3) &&
    Number.isFinite(pic.endSec) && Math.abs(pic.endSec * FPS - render.frames) <= 1e-3 &&
    (!map || render.frameDelta === 0) && Number.isFinite(ceilingSeconds) &&
    !findings.some((finding) => ["render-unmeasured", "render-picture-clock", "render-picture-grid", "render-frames"].includes(finding.code));
  const planningTiming = {
    basis: "decoded-final-picture-clock",
    finalSha256: null,
    planned: { targetSeconds: planningBudget.targetSeconds, overrun: { ...overrun }, ceilingSeconds },
    decoded: measured ? { frames: render.frames, fps: FPS, seconds: render.frames / FPS } : null,
    status: !measured ? "unknown" : render.frames > ceilingSeconds * FPS + 1e-7 ? "over-budget" : "within-budget",
  };
  if (planningTiming.status === "unknown") refuse("planning-budget-clock-unmeasured", "the selected final total budget cannot be checked without a complete valid decoded final picture clock on the measured 24 fps grid");
  if (planningTiming.status === "over-budget") findings.push({
    severity: "refuse", code: "planning-budget-exceeded", scene: null,
    nextActions: ["choose-longer-target"],
    detail: `The measured final cut is ${roundMs(planningTiming.decoded.seconds)}s; allowed ${planningBudget.targetSeconds}s + ${overrun.name} ${overrun.seconds}s = ${ceilingSeconds}s. Choose a longer target and re-approve its plan. Re-cutting unchanged selected clips repeats this refusal. Approved words and actions are retained; they are not truncated or sped up to fit.`,
  });
  return { findings, render, planningTiming };
}

/** Budget-only measurement of an actual final file, including unmapped cuts.
 * No source map is synthesized. Both existing render routes already emit 24fps. */
export function measureCutPlanningTiming(file, planningBudget) {
  let finalSha256 = null;
  try { finalSha256 = createHash("sha256").update(readFileSync(file)).digest("hex"); }
  catch { /* Unavailable actual bytes cannot inherit a known decoded receipt. */ }
  const result = renderFindings(null, measureMedia(file), planningBudget);
  const findings = result.findings.filter((finding) => ["planning-budget-clock-unmeasured", "planning-budget-exceeded"].includes(finding.code));
  const planningTiming = { ...result.planningTiming, finalSha256 };
  if (!finalSha256) {
    planningTiming.status = "unknown";
    planningTiming.decoded = null;
    if (!findings.some((finding) => finding.code === "planning-budget-clock-unmeasured")) findings.push({
      severity: "refuse", code: "planning-budget-clock-unmeasured", scene: null,
      detail: "the actual final bytes could not be hashed, so the final decoded timing is not byte-bound",
    });
  }
  return { planningTiming, findings };
}

/**
 * Compression is opt-in for continuous drama. Try the ordinary edit without
 * touching media; accept it only when existing cue-owned pictures actually
 * hide every removed-time join. Otherwise rebuild with intact interior time.
 */
export function buildTimeline(args) {
  const motion = args.manifest?.templateMotion;
  const treatment = motion?.enabled === true ? motion.editingTreatment : null;
  if (treatment?.time !== "continuous-dramatic" || treatment.compressPauses !== true) return assembleTimeline(args);
  let candidate;
  try {
    candidate = assembleTimeline({ ...args, manifest: { ...args.manifest, templateMotion: {
      ...motion, selectedCapture: true, editingTreatment: { ...treatment, time: "tight" },
    } } });
  } catch (err) {
    if (!(err instanceof SourceMapRefusal)) throw err;
  }
  const uncovered = candidate?.spine.some((seg) => {
    let removed = 0;
    return (seg.cuts ?? []).some((cut) => {
      const at = seg.startSec + cut.s - removed - seg.inSec;
      removed += cut.e - cut.s;
      if (at < seg.startSec - 1e-6 || at > seg.startSec + seg.seconds + 1e-6) return false;
      return !candidate.cutaways.some((cover) =>
        cover.source === "clip" && cover.file !== seg.file && cover.cueLineId &&
        cover.startSec <= at - 1 / FPS && cover.startSec + cover.seconds >= at + 1 / FPS);
    });
  });
  if (candidate && !uncovered) return candidate;
  const timeline = assembleTimeline(args);
  timeline.notes.push("continuous-dramatic: missing available alternate coverage for compression; retained continuous source time");
  return timeline;
}

function assembleTimeline({
  manifest, storyboard, skip, probe, exists, readWords, readLevels = () => null, stillFill = false, finish = null,
  wholeVoice = null, sourceAd = null, measure = null,
}) {
  if (measure) {
    // The measured map: a word's last phoneme end rides with the word through every shift.
    const heard = readWords;
    readWords = (file) => withPhonemeEnds(heard(file));
  }
  const selectedJobs = selectedPictureJobs(manifest, storyboard);
  const template = manifest?.templateMotion?.enabled === true;
  const notes = [];
  if (template && manifest.planningBudget?.pictureRange && !selectedJobs) {
    notes.push("selected-picture-reservation: invalid planning projection; the cut uses its retained scene clocks");
  }
  if (selectedJobs) {
    const reserved = selectedJobs.reduce((sum, job) => sum + job.reservedSeconds, 0);
    const requested = manifest.planningBudget?.targetSeconds;
    if (Number.isFinite(requested) && Math.abs(reserved - requested) > .001) {
      notes.push(`selected-picture-target: ${reserved}s reserved against ${requested}s requested; the finished cut uses its retained source clocks`);
    }
    for (const scene of selectedJobs.flatMap((job) => job.owners)) {
      if (Number.isFinite(scene.durationSec) && scene.durationSec < scene.planSeconds) {
        notes.push(`selected-picture-source-reservation: scene ${scene.sceneIndex} planned ${scene.durationSec}s of source against a ${scene.planSeconds}s reservation; final coverage is measured from retained media`);
      }
    }
  }
  // Narrated template reservations own picture time, not the short master read.
  // Reuse the pulled per-scene slices of that same approved take, placing each
  // at its picture start and leaving the remaining picture air to the music bed.
  const reservedNarration = Boolean(wholeVoice && selectedJobs && manifest?.templateMotion?.narratedShotList === true);
  const nativeBudget = !measure && manifest?.templateMotion?.enabled === true ? manifest.planningBudget : null;
  const plans = scenePlans(storyboard, measure || selectedJobs ? manifest.planningBudget : nativeBudget, selectedJobs);
  const counts = lineWordCounts(storyboard);
  const spine = [];
  const cutaways = [];
  const waiting = [];
  const dropped = [];
  const missing = new Set(scenesWithNoClip({ manifest, storyboard, skip, exists }));
  // Frozen template-video audio ownership, supplied by the worker from the
  // run's voiceMode/songAsVoice. Discard applies to EVERY picture, including
  // wordless inserts and reactions; a stray voice file cannot replace native dialogue.
  const discardClipAudio = manifest?.clipAudio === "discard";
  const keepClipAudio = manifest?.clipAudio === "keep";
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
    const editorialHold = measure ? selectedEditorialHold(manifest, storyboard, n) : null;
    if (editorialHold) {
      const source = spine.at(-1);
      if (source?.sceneIndex !== editorialHold.sourceSceneIndex || !source.map?.picture) throw new SourceMapRefusal(
        "The selected editorial hold has no measured preceding picture", [
          { severity: "refuse", code: "editorial-hold-source-unproven", scene: n, detail: "hold binding cannot use an absent, skipped or unrelated source" },
        ]);
      const voice = !keepClipAudio && exists(scene.voice) ? scene.voice : null;
      const vm = voice ? clockOf(measure(voice)) : null;
      spine.push({
        sceneIndex: n, source: "clip", file: source.file, clipSeconds: editorialHold.seconds, inSec: 0,
        seconds: editorialHold.seconds, holdSec: 0, fixedLength: true, editorialHold,
        audio: voice ? "narration" : "silence", voice, map: { ...source.map, ...(vm ? { voice: vm } : {}) },
        words: scene.wordsFrom === "voice" ? readWords(scene.words) : null,
        lineIds: plan.lineIds, firstSpeaker: null, lastSpeaker: null, actionLeadSec: 0, actionTailSec: 0,
        note: ", explicitly selected editorial hold of the preceding retained frame",
      });
      continue;
    }

    if (plan.cutaway) {
      const cue = {
        cueLineId: plan.cueLineId, reaction: plan.cutawayType === "reaction" && !plan.overlay, broll: plan.broll ?? null,
        ...(measure && plan.editSeconds ? { reservedSeconds: plan.editSeconds } : {}),
      };
      if (exists(scene.clip)) {
        const clip = probe(scene.clip);
        const m = measure ? clockOf(measure(scene.clip)) : null;
        const reaction = {
          sceneIndex: n, source: "clip", file: scene.clip,
          seconds: m ? (m.picture ? m.picture.endSlot / FPS : 0) : clip.seconds, hasAudio: clip.hasAudio && !discardClipAudio, ...cue,
          ...(m ? { map: m } : {}),
        };
        if (template && plan.cutawayType === "reaction") {
          const authored = storyboard.scenes.find((s) => s.sceneIndex === n);
          const delta = m?.deltaSec ?? 0;
          const words = scene.wordsFrom === "clip" ? (readWords(scene.words) ?? [])
            .map((w) => ({ ...w, s: w.s + delta, e: w.e + delta })) : [];
          if (plan.editSeconds > 0) reaction.reservedSeconds = plan.editSeconds;
          reserveReactionPicture(reaction, authored, words, notes);
          if (plan.overlay) {
            reaction.seconds = reaction.visualSeconds ?? Math.min(reaction.seconds, REACTION_MAX_SEC);
            reaction.reactionOverlay = true;
          }
        }
        waiting.push(reaction);
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

    const narrated = !keepClipAudio && (discardClipAudio || plan.narrated || scene.wordsFrom === "voice");
    const voice = !keepClipAudio && exists(scene.voice) ? scene.voice : null;
    const flag = scene.flagged ? " (flagged)" : "";
    if (measure && scene.words && scene.wordsDescribe === "original-performance") {
      throw new SourceMapRefusal("The word observation describes a replaced performance, not the selected audible bytes", [
        { severity: "refuse", code: "word-source-mismatch", scene: n, detail: scene.words },
      ]);
    }

    if (exists(scene.clip)) {
      const clip = probe(scene.clip);
      // The measured map: the picture's length is its slots on the edit grid, never the container's.
      const m = measure ? clockOf(measure(scene.clip)) : null;
      const pictureSec = m ? (m.picture ? m.picture.endSlot / FPS : 0) : clip.seconds;
      const authored = storyboard?.scenes?.find((entry) => entry.sceneIndex === n);
      const productProof = authored?.mechanismCoverage?.length ||
        authored?.protectedVisualConstraints?.some((constraint) => constraint.subject === "claim") ||
        storyboard?.overlays?.some((overlay) => overlay.proof?.actionPhaseId &&
          authored?.actionPhases?.some((phase) => phase.id === overlay.proof.actionPhaseId));
      const fitFinding = scene.templateAudioSourceReservation;
      const templateNarrationHold = manifest?.videoChoice?.videoModel === "template-video" &&
        discardClipAudio && (!manifest.wholeVoice || manifest.templateMotion?.narratedShotList === true) && !productProof &&
        fitFinding?.check === "technical" && fitFinding?.severity === "warn" &&
        fitFinding?.code === "template-audio-source-reservation";
      const base = {
        sceneIndex: n, source: "clip", file: scene.clip, clipSeconds: pictureSec, inSec: 0,
        ...(m ? { map: m, ...(scene.actionEvidence ? { actionEvidence: scene.actionEvidence } : {}) } : {}),
        lineIds: plan.lineIds, firstSpeaker: plan.firstSpeaker, lastSpeaker: plan.lastSpeaker,
        baseShotId: plan.baseShotId ?? null, actionTailSec: plan.actionTailSec ?? 0,
        actionLeadSec: plan.actionLeadSec ?? 0,
      };
      if (voice && (narrated || !clip.hasAudio)) {
        const vm = m ? clockOf(measure(voice)) : null;
        const voiceSeconds = vm ? (vm.audio ? vm.audio.decodedSec : 0) : probe(voice).seconds;
        const words = readWords(scene.words);
        // A clip's own word times describe the clip, not the voice that replaces its audio.
        const voiceWords = scene.wordsFrom === "voice" ? words : null;
        const fitted = (endsAd) => {
          const fit = fitNarration({
            clipSeconds: base.clipSeconds, ...narrationEnd(voiceSeconds, voiceWords, endsAd, Boolean(m)),
            actionTailSec: plan.actionTailSec ?? 0,
          });
          if (templateNarrationHold) {
            fit.seconds = Math.max(fit.seconds, voiceSeconds);
            fit.holdSec = Math.max(0, fit.seconds - base.clipSeconds);
          }
          const how = [];
          if (fit.trimmedBy > 0.05) how.push(`clip trimmed ${clip.seconds.toFixed(1)}s -> ${fit.seconds.toFixed(1)}s`);
          if (fit.holdSec > 0.05) how.push(`last frame held ${fit.holdSec.toFixed(1)}s`);
          return {
            seconds: fit.seconds, holdSec: fit.holdSec,
            note: `${flag}, ${voice} replaces the clip's audio${how.length ? ` (${how.join(", ")})` : ""}`,
          };
        };
        const seg = {
          ...base, audio: "narration", voice, words: m ? voiceWords : words, ...fitted(false),
          ...(template ? { sourceWords: voiceWords } : {}),
          ...(templateNarrationHold ? { templateNarrationHold: true } : {}),
          ...(vm ? { map: { ...m, voice: vm } } : {}),
        };
        spine.push(seg);
        refits.set(seg, fitted);
      } else if (narrated) {
        spine.push({
          ...base, audio: "silence", voice: null, seconds: base.clipSeconds, holdSec: 0,
          words: null,
          note: `${flag}, narrated scene without its voice track: the clip's own audio is muted`,
        });
      } else if (clip.hasAudio) {
        // A clip's own words are on its sound's clock: its picture runs deltaSec behind it.
        const ownSec = m ? Math.max(0, pictureSec - m.deltaSec) : clip.seconds;
        const words = readWords(scene.words);
        spine.push({
          ...base, clipSeconds: ownSec,
          audio: "clip", voice: null, seconds: ownSec, holdSec: 0,
          words, note: `${flag}, its own dialogue`,
          // The take's own heard words and sound length before any edit, so
          // the final can show which source audio it kept (spokenLineFulfillment).
          ...(template ? { sourceWords: words, sourceSec: ownSec } : {}),
        });
      } else {
        spine.push({
          ...base, audio: "silence", voice: null, seconds: base.clipSeconds, holdSec: 0,
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
        ...(template ? { sourceWords: voiceWords } : {}),
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

  // The measured map: the song's last stretch ends on its own decoded last sample, never
  // narration.json's declared length, and its stretches are checked against it.
  const wholeClock = wholeVoice && measure ? clockOf(measure(wholeVoice.file)) : null;
  const laid = wholeClock
    ? { ...wholeVoice, declaredSec: wholeVoice.seconds, seconds: wholeClock.audio ? wholeClock.audio.decodedSec : wholeVoice.seconds, measured: true }
    : wholeVoice;
  const whole = laid && !reservedNarration ? fitWholeVoice(spine, laid) : null;
  if (whole) dropped.push(...whole.dropped);
  if (whole && (manifest?.templateMotion?.narratedShotList === true ||
    (manifest?.templateMotion?.enabled === true && laid.measured))) {
    // Picture cuts (including the song's 150ms lead-in) round to frames;
    // captions remain on the untouched master word clock, not that rounded cut.
    for (const seg of spine) {
      if (!seg.wholeVoice) continue;
      const shift = wholeVoice.starts.get(seg.sceneIndex) - whole.intervals.find((interval) => interval.scene === seg.sceneIndex).fromFrame / FPS;
      if (seg.words) seg.words = seg.words.map((word) => ({ ...word, s: r6(word.s + shift), e: r6(word.e + shift) }));
      if (manifest?.templateMotion?.enabled === true && manifest.templateMotion.narratedShotList !== true) seg.songOnly = true;
    }
  }
  // Keeping a trusted song's real EOF never authorizes invented terminal
  // frames. The mapped route already refuses unavailable picture; refuse the
  // same shortage before fitWholeVoice's legacy holdSec can become tpad.
  if (whole && !measure && manifest?.templateMotion?.enabled === true) {
    const short = spine.filter((seg) => seg.wholeVoice && seg.holdSec > 1e-6);
    if (short.length) throw new SourceMapRefusal(
      "The whole song outlasts its available picture; supply enough real footage without shortening the song or freezing its ending",
      short.map((seg) => ({
        severity: "refuse", code: "whole-voice-picture-short", scene: seg.sceneIndex,
        detail: `${seg.file} needs ${seg.seconds}s to retain the whole song, but only ${seg.seconds - seg.holdSec}s of real picture remains`,
      })),
    );
  }

  const sameShot = PUNCH_IN_RUNS.get(manifest?.shots?.pacing);
  // Trusted selected capture owns framing; selected editing treatment separately
  // owns temporal continuity. Neither authorizes an invented alternate angle.
  const preserveCapture = manifest?.templateMotion?.enabled === true &&
    (manifest.templateMotion.selectedCapture === true || manifest.templateMotion.editingTreatment?.time === "continuous-dramatic");
  if (sameShot && !preserveCapture) markPunchIns(spine, sameShot);

  const noCue = (c) =>
    c.cueLineId ? `${c.cueLineId} is spoken by no scene in the cut` : "the storyboard names no cue line";

  // Sentence gaps and then joins are closed first so a reaction beat lands
  // right after its cue line ends in the trimmed clip. Reactions change the
  // spine, so they go in before any overlay is placed on it.
  const scriptLines = new Map((storyboard?.script ?? []).map((line) => [line?.lineId, line]));
  const reactionCues = new Set(waiting.filter((w) => w.reaction).map((w) => w.cueLineId));
  const last = spine.at(-1);
  if (!whole && refits.has(last) && !reactionCues.has(last.lineIds.at(-1))) Object.assign(last, refits.get(last)(true));
  if (template) {
    // A native take already owns its available speech bytes. An allowance or
    // ASR timestamp beyond EOF cannot authorize another purchase or strand it.
    for (const seg of spine) {
      if (seg.source !== "clip" || seg.audio !== "clip" || seg.wholeVoice) continue;
      const lastWord = Math.max(0, ...(seg.words ?? []).map(wordEnd));
      const required = lastWord + (seg.actionTailSec ?? 0);
      if (required <= seg.clipSeconds + 1e-6) continue;
      notes.push(`native-source-clock: scene ${seg.sceneIndex} requests ${required.toFixed(2)}s against ${seg.clipSeconds.toFixed(2)}s retained source; ` +
        "available clip audio is retained, discretionary action/reaction tail ends at source EOF");
      seg.actionTailSec = Math.min(seg.actionTailSec ?? 0, Math.max(0, seg.clipSeconds - lastWord));
      if (lastWord > seg.clipSeconds + 1e-6) {
        const unmeasured = seg.words.filter((word) => wordEnd(word) > seg.clipSeconds + 1e-6);
        notes.push(`native-source-clock: scene ${seg.sceneIndex} retains its entire clip/audio; out-of-file word observations remain unmeasured: ${JSON.stringify(unmeasured)}`);
        seg.words = seg.words.filter((word) => wordEnd(word) <= seg.clipSeconds + 1e-6);
        seg.nativeWordClockOverrun = true;
        seg.fixedLength = true;
        seg.seconds = seg.clipSeconds;
      }
    }
  }
  const pace = finish?.cutPace === true;
  const lineGap = pace ? { max: PACE_SPLIT_PAUSE_SEC, keep: PACE_GAP_MAX_SEC } : null;
  // jumpCut stays off a template launch's cut, whose selected clocks and windows hold their real time.
  const jump = finish?.jumpCut && manifest?.templateMotion?.enabled !== true ? JUMP_CUT : null;
  tightenSentenceGaps(spine, reactionCues, scriptLines, readLevels, lineGap, jump, template ? storyboard : null,
    template ? manifest.templateMotion.editingTreatment : null, notes);
  trimJoins(spine, reactionCues, scriptLines, pace ? PACE_GAP_MAX_SEC : null, finish?.talkTrim === true);
  if (pace) {
    // The pieces of one take alternate between the plain frame and the
    // punch-in, and a jump-cut run's alternation carries on across them.
    splitAtPauses(spine);
    if (!preserveCapture) {
      for (const seg of spine) delete seg.punchIn;
      markPunchIns(spine, (prev, seg) => samePiece(prev, seg) || Boolean(sameShot?.(prev, seg)));
    }
  }
  for (const c of waiting.filter((w) => w.reaction)) {
    if (whole) {
      dropped.push({ n: c.sceneIndex, reason: `cutaway ${c.sceneIndex}: a reaction beat would stop the voice laid whole` });
      if (template) notes.push(`reaction-overlay-unselected: scene ${c.sceneIndex} needs an explicit overlay cue; whole-master timing was retained`);
      continue;
    }
    if (!c.cueLineId || placeReaction(spine, counts, c) === null) {
      dropped.push({ n: c.sceneIndex, reason: `cutaway ${c.sceneIndex}: ${noCue(c)}` });
    }
  }
  spine.forEach((seg, k) => {
    if (!seg.reaction || seg.audio !== "clip") return;
    const tail = spine[k + 1] ? carveReactionTail(seg, spine[k + 1]) : null;
    if (tail) seg.reaction.tail = tail;
    else seg.fadeOutSec = Math.min(REACTION_FADE_OUT_SEC, seg.seconds);
    const levels = readLevels(seg.file);
    seg.fadeInSec = quietStart(levels && seg.inSec > 0
      ? { ...levels, db: levels.db.slice(Math.floor(seg.inSec / levels.windowSec)) } : levels, seg.seconds);
  });
  // A copied shot no voice runs in lasts its shot's length, its clip trimmed or its last frame held.
  const shotOf = (n) => plans.get(n)?.sourceShot ?? null;
  const shotSec = (n) => {
    const e = sourceAd?.shots.find((x) => x.n === shotOf(n));
    return e ? e.t1 - e.t0 : null;
  };
  if (sourceAd && !measure) {
    for (const seg of spine) {
      const len = seg.audio === "silence" && !seg.reaction && !seg.fixedLength ? shotSec(seg.sceneIndex) : null;
      if (len === null) continue;
      seg.seconds = ceilFrame(len);
      seg.holdSec = holdFor(seg);
      seg.note = withHow(seg.note, [`its source shot's ${len.toFixed(2)}s`]);
    }
  }
  if (measure || selectedJobs || nativeBudget) {
    const takes = new Map();
    for (const seg of spine) {
      const same = takes.get(seg.sceneIndex) ?? [];
      same.push(seg);
      takes.set(seg.sceneIndex, same);
    }
    for (const pieces of takes.values()) {
      if (pieces.length > 1) pieces.forEach((seg, i) => { seg.piece = { take: seg.sceneIndex, n: i + 1, of: pieces.length }; });
    }
    for (const pieces of takes.values()) {
      const seg = pieces.at(-1);
      // A template talking take is word-led, never padded back to its planning
      // reservation after the speech edit. Explicit action handles were retained.
      if (template && seg.source === "clip" && seg.audio === "clip" && (seg.templateSpeech || seg.nativeWordClockOverrun)) continue;
      const reserved = plans.get(seg.sceneIndex)?.editSeconds;
      if (reserved > 0 && !seg.wholeVoice) {
        // Reserve once per take. Earlier pieces must stop at their split: extending
        // one would play source speech that the resumed piece will play again.
        const before = pieces.slice(0, -1).reduce((sum, piece) => sum + piece.seconds, 0);
        if (manifest?.templateMotion?.enabled === true && seg.source === "clip" && seg.audio === "clip") {
          // A full-picture reservation can need the real pre-speech frames
          // trimJoins removed. Restore those before asking for frozen fill,
          // without replaying source already used by an earlier split piece.
          const previous = pieces.at(-2);
          const earliest = previous ? previous.inSec + previous.seconds : 0;
          const inSec = Math.min(seg.inSec, Math.max(earliest, floorFrame(seg.clipSeconds - (ceilFrame(reserved) - before))));
          const shift = seg.inSec - inSec;
          if (shift > 0) {
            seg.inSec = inSec;
            seg.words = seg.words?.map((word) => ({ ...word, s: word.s + shift, e: word.e + shift }));
            seg.note = withHow(seg.note, [`pre-speech ${shift.toFixed(2)}s restored for the reservation`]);
          }
        }
        const lastWord = Math.max(0, ...(seg.words ?? []).map(wordEnd));
        const nativePicture = manifest?.templateMotion?.enabled === true && seg.source === "clip" && seg.audio === "clip";
        const available = Math.max(0, seg.clipSeconds - seg.inSec);
        const pictureReservation = nativePicture
          ? Math.min(ceilFrame(reserved) - before, available)
          : reservedNarration && seg.source === "clip" && seg.audio === "narration"
            ? Math.min(ceilFrame(reserved) - before, floorFrame(available))
            : ceilFrame(reserved) - before;
        const required = lastWord + (seg.actionTailSec ?? 0);
        // Frame rounding is editorial air, not missing speech/action. Retain an
        // in-bounds native ending even when EOF falls between edit frames.
        const proofEnd = nativePicture && required <= available
          ? Math.min(ceilFrame(required), available) : ceilFrame(required);
        const narrationAir = seg.templateNarrationHold ? seg.seconds
          : reservedNarration && seg.audio === "narration"
            ? Math.min(seg.seconds, floorFrame(Math.max(0, seg.clipSeconds - seg.inSec))) : 0;
        seg.seconds = Math.max(pieces.length > 1 ? seg.seconds : narrationAir,
          pictureReservation, proofEnd);
        seg.fixedLength = true;
        seg.holdSec = holdFor(seg); // only explicitly authorized narration holds survive the measured map
      }
    }
  }
  // Unstamped frozen fill remains refused. Billed-source narration fit, genuine
  // stills and selected editorial holds are explicit and keep distinct records;
  // whole-song shortages were checked above.
  if (!measure && manifest?.templateMotion?.enabled === true) {
    const short = spine.filter((seg) =>
      seg.source === "clip" && !seg.wholeVoice && !seg.editorialHold && !seg.templateNarrationHold && seg.holdSec > 0);
    refusePictureHolds(short);
  }
  if (measure) snapToFrames(spine);
  let total = 0;
  for (const seg of spine) {
    seg.startSec = total;
    total += seg.seconds;
  }
  spine.forEach((seg, k) => {
    if (seg.reaction?.tail) seg.reaction.tail.atSec = spine[k + 1].startSec;
  });
  const groups = sourceAd && !measure ? sourceGroups(spine, sourceAd, shotOf) : null;

  const lineTexts = new Map([...scriptLines].map(([id, line]) => [id, line?.text]));
  const beats = spine.filter((seg) => seg.reaction);
  const reservedThrough = new Map();
  for (const c of waiting.filter((w) => !w.reaction)) {
    // A copied shot lands where its shot sits in the source, through its group.
    const copied = groups?.length ? sourceAd.shots.find((e) => e.n === shotOf(c.sceneIndex)) : null;
    if (copied) {
      const startSec = roundMs(mapSourceTime(groups, copied.t0));
      const span = roundMs(mapSourceTime(groups, copied.t1) - startSec);
      cutaways.push({
        ...c, startSec, method: "source", sourceShot: copied.n,
        seconds: c.source === "clip" ? Math.min(span, c.seconds) : span,
      });
      continue;
    }
    let cue = c.cueLineId ? cueOffsetOnSpine(spine, counts, c.cueLineId) : null;
    if (measure && c.cueLineId) {
      const owner = spine.find((seg) => seg.lineIds?.includes(c.cueLineId));
      const part = owner ? lineParts(owner, scriptLines).find((p) => p.lineId === c.cueLineId && p.measured) : null;
      cue = part ? { startSec: part.edit.startSec, method: "words", spineSceneIndex: owner.sceneIndex, owner } : null;
      if (!cue && template && owner) {
        cue = { startSec: owner.startSec, method: "scene", spineSceneIndex: owner.sceneIndex, owner };
        notes.push(`cutaway-clock-unmeasured: scene ${c.sceneIndex} uses its retained cue-owner picture boundary, not an invented word time`);
      }
      if (!cue) throw new SourceMapRefusal("The cutaway has no measured owner-word clock; a proportional placement is not delivered", [
        { severity: "refuse", code: "cutaway-clock-unmeasured", scene: c.sceneIndex, detail: c.cueLineId },
      ]);
    }
    if (!cue) {
      dropped.push({ n: c.sceneIndex, reason: `cutaway ${c.sceneIndex}: ${noCue(c)}` });
      continue;
    }
    const placed = { ...c, startSec: cue.startSec, method: cue.method, spineSceneIndex: cue.spineSceneIndex };
    const seg = c.broll ? cue.owner ?? spine.find((s) => s.lineIds.includes(c.cueLineId)) : null;
    const win = seg
      ? brollWindow(seg, counts, c.cueLineId, lineTexts, c.broll)
      : null;
    if (win) {
      // A shot's lead may reach back into the segment before, never into a reaction beat or before the ad.
      const floor = Math.max(0, ...beats.filter((b) => b.startSec < seg.startSec).map((b) => b.startSec + b.seconds));
      placed.startSec = Math.max(floor, seg.startSec + win.startSec);
      placed.method = win.method;
      placed.seconds = c.source === "clip" ? Math.min(win.holdSec, c.seconds) : win.holdSec;
      placed.coversFound = win.found;
    }
    if (measure && c.reservedSeconds > 0) {
      const key = c.cueLineId;
      placed.startSec = Math.max(placed.startSec, reservedThrough.get(key) ?? placed.startSec);
      placed.seconds = c.reactionOverlay ? Math.min(ceilFrame(c.reservedSeconds), c.seconds) : ceilFrame(c.reservedSeconds);
      const owner = cue.owner;
      if (template && owner) {
        placed.seconds = Math.min(placed.seconds, Math.max(0, owner.startSec + owner.seconds - placed.startSec));
        if (placed.seconds < c.reservedSeconds) notes.push(`overlay-owner-window-short: scene ${c.sceneIndex} reflowed within its unchanged audible source`);
      }
      if (!owner || placed.startSec + placed.seconds > owner.startSec + owner.seconds + 1e-7) {
        throw new SourceMapRefusal("The selected overlay cannot return within its unchanged audible source", [
          { severity: "refuse", code: "overlay-owner-window-short", scene: c.sceneIndex, detail: "the authored picture reservation crosses its retained cue owner's return boundary; no words or elapsed silence are inserted" },
        ]);
      }
      reservedThrough.set(key, placed.startSec + placed.seconds);
    }
    if (c.reactionOverlay && template) {
      const owner = cue.owner ?? spine.find((s) => s.lineIds.includes(c.cueLineId));
      const scene = storyboard.scenes.find((s) => s.sceneIndex === owner?.sceneIndex);
      const windows = owner ? templateActionWindows(owner.words ?? [], {
        durationSec: owner.seconds, actionPhases: scene?.actionPhases, directorBeats: scene?.directorBeats,
        notes, sceneIndex: owner.sceneIndex,
      }) : [];
      if (windows.some((w) => placed.startSec < owner.startSec + w.endSec &&
        placed.startSec + placed.seconds > owner.startSec + w.startSec)) {
        notes.push(`reaction-overlay-action-conflict: scene ${c.sceneIndex} cannot cover its cue owner's reserved acting; master timing retained`);
        continue;
      }
      if (placed.seconds < c.visualSeconds) notes.push(
        `reaction-reservation-short: scene ${c.sceneIndex} cannot fit its complete visual window without changing the master`);
    }
    cutaways.push(placed);
  }
  if (measure) {
    for (const c of cutaways) {
      c.startSec = Math.round(c.startSec * FPS) / FPS;
      c.seconds = Math.round(c.seconds * FPS) / FPS;
    }
  }
  cutaways.sort((a, b) => a.startSec - b.startSec);
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
      if (measure && c.reservedSeconds > 0 && !template) throw new SourceMapRefusal("The selected overlay reservation does not fit its retained cue window", [
        { severity: "refuse", code: "overlay-reservation-short", scene: c.sceneIndex, detail: `${c.reservedSeconds}s is required before ${stop.by}; speech is not paused or extended to make room` },
      ]);
      c.seconds = Math.max(0, stop.at - c.startSec);
      c.cutShortBy = stop.by;
      if (template) notes.push(`overlay-reservation-short: scene ${c.sceneIndex} trimmed before ${stop.by}`);
    }
  }
  if (measure) {
    // The measured map: each overlay on whole edit frames, and no longer than its clip's slots.
    for (const c of cutaways) {
      const from = Math.round(c.startSec * FPS);
      const slots = c.map?.picture ? Math.max(0, c.map.picture.endSlot - Math.round((c.inSec ?? 0) * FPS)) : Infinity;
      if (c.reservedSeconds > 0 && c.seconds * FPS > slots + 1e-6 && !template) throw new SourceMapRefusal("The selected overlay source is shorter than its authored reservation", [
        { severity: "refuse", code: "overlay-source-short", scene: c.sceneIndex, detail: `${c.reservedSeconds}s requires decoded picture coverage, not frozen fill` },
      ]);
      const to = Math.min(Math.round((c.startSec + c.seconds) * FPS), Math.round(total * FPS), from + slots);
      c.startSec = from / FPS;
      c.seconds = Math.max(0, to - from) / FPS;
      if (template && c.reservedSeconds > c.seconds) notes.push(`overlay-source-short: scene ${c.sceneIndex} uses only decoded retained picture`);
    }
  }

  if (manifest?.templateMotion?.enabled === true) {
    // Picture splits/reorders never authorize replaying an audible source span.
    // Use original source coordinates, undoing sentence-gap edits for each piece.
    const heardSpans = new Map();
    for (const seg of spine) {
      if (seg.wholeVoice || !["clip", "narration"].includes(seg.audio)) continue;
      const file = seg.audio === "clip" ? seg.file : seg.voice;
      if (!file) continue;
      let spans = [{ from: sourceTimeOf(seg, 0, false), to: sourceTimeOf(seg, seg.seconds, true) }];
      if (seg.audio === "clip") for (const c of seg.cuts ?? []) {
        spans = spans.flatMap((span) => c.e <= span.from || c.s >= span.to ? [span]
          : [{ from: span.from, to: c.s }, { from: c.e, to: span.to }].filter((s) => s.to > s.from));
      }
      const previous = heardSpans.get(file) ?? [];
      if (spans.some((span) => previous.some((prior) => {
        const sameSpeaker = Boolean(seg.firstSpeaker) && seg.firstSpeaker === prior.lastSpeaker;
        const handles = JOIN_TAIL_SEC + (sameSpeaker ? JOIN_LEAD_SAME_SPEAKER_SEC : JOIN_LEAD_NEW_SPEAKER_SEC);
        return Math.min(span.to, prior.to) - Math.max(span.from, prior.from) > handles + 1 / EDIT_SAMPLE_RATE;
      }))) {
        throw new SourceMapRefusal("The cut would repeat source audio beyond its join handles", [
          { severity: "refuse", code: "repeated-source-audio", scene: seg.sceneIndex, detail: `${file}: only the existing join tail/lead handles may overlap; use a picture-only insert over the unchanged audible spine for reused pictures` },
        ]);
      }
      heardSpans.set(file, [...previous, ...spans.map((span) => ({ ...span, lastSpeaker: seg.lastSpeaker }))]);
    }
    for (const c of cutaways) {
      const plan = plans.get(c.sceneIndex);
      const authored = plan?.editSeconds ?? plan?.broll?.plannedSec ?? plan?.durationSec;
      const minimum = authored > 0 ? Math.min(BROLL_MIN_HOLD_SEC, authored) : BROLL_MIN_HOLD_SEC;
      if (c.seconds + 1e-6 < minimum) notes.push(`unauthored-picture-flash: scene ${c.sceneIndex}: ${c.seconds}s retained; ${minimum}s preferred`);
    }
    // Repair only edit-created slivers, never intentionally authored short beats.
    // Extending a muted picture leaves the audible spine and its word clock alone.
    const boardScenes = new Map((storyboard?.scenes ?? []).map((s) => [s.sceneIndex, s]));
    const available = (c) => waiting.find((w) => w.sceneIndex === c.sceneIndex)?.seconds ?? 0;
    for (const shot of sceneTimes({ spine, cutaways }, true)) {
      const owner = spine.find((seg) => seg.sceneIndex === shot.scene &&
        seg.startSec <= shot.startSec && seg.startSec + seg.seconds >= shot.startSec + shot.seconds - 1e-6);
      if (!owner || owner.seconds < BROLL_MIN_HOLD_SEC || shot.seconds >= BROLL_MIN_HOLD_SEC) continue;
      const scene = boardScenes.get(shot.scene);
      if (scene?.actionPhases?.some((p) => p.required) || owner.actionLeadSec > 0 || owner.actionTailSec > 0) {
        notes.push(`unauthored-picture-flash: scene ${shot.scene}: the insert intersects an authored action window`);
        continue;
      }
      const next = cutaways.find((c) => Math.abs(c.startSec - shot.startSec - shot.seconds) < 1e-6);
      const prev = cutaways.find((c) => Math.abs(c.startSec + c.seconds - shot.startSec) < 1e-6);
      const cover = [next, prev].find((c) => c && c.seconds + shot.seconds <= available(c) + 1e-6 &&
        !(c.reservedSeconds > 0));
      if (!cover && next && shot.startSec === 0 && !(next.reservedSeconds > 0)) {
        // A cue-led opening insert may start on frame zero instead of exposing
        // a few creator frames; keep its real source duration, never freeze it.
        next.startSec = 0;
        continue;
      }
      if (!cover) {
        notes.push(`unauthored-picture-flash: scene ${shot.scene}: ${shot.seconds}s exposed by the insert; no additional footage purchased`);
        continue;
      }
      if (cover === next) cover.startSec = shot.startSec;
      cover.seconds += shot.seconds;
    }
    if (manifest.outputPermission?.ending?.mode === "native") {
      const terminal = terminalTemplateScene(manifest, storyboard);
      const last = sceneTimes({ spine, cutaways }, true).at(-1);
      if (!terminal || last?.scene !== terminal.sceneIndex) throw new SourceMapRefusal("The required final picture does not survive the cut", [
        { severity: "refuse", code: "required-endpoint-missing", scene: terminal?.sceneIndex ?? null, detail: "the selected terminal product/character/CTA picture must remain visible through EOF" },
      ]);
    }
  }

  const wholeAt = whole && measure ? spine.find((seg) => seg.wholeVoice) : null;
  const sourceMap = measure
    ? buildSourceMap({
        spine, cutaways, scriptLines, pictureFrames: Math.round(total * FPS), sourceMeta: manifest?.sourceMeta ?? null,
        wholeVoice: whole ? {
          file: wholeVoice.file, clock: wholeClock, declaredSec: wholeVoice.seconds,
          startFrame: wholeAt ? Math.round(wholeAt.startSec * FPS) : Math.round(whole.startSec * FPS),
          intervals: whole.intervals ?? [], problems: whole.problems ?? [],
        } : null,
      })
    : null;
  const wholeStartSec = sourceMap?.wholeVoice ? sourceMap.wholeVoice.startFrame / FPS : whole?.startSec;
  return {
    spine,
    cutaways,
    notes,
    left: dropped.sort((a, b) => a.n - b.n).map((d) => d.reason),
    ...(whole ? { wholeVoice: {
      file: wholeVoice.file, startSec: wholeStartSec, ...(wholeClock ? { clock: wholeClock } : {}),
      ...(manifest?.templateMotion?.enabled === true && manifest.templateMotion.narratedShotList !== true ? { songOnly: true } : {}),
      // A template song master's words are Scribe ASR on its own clock, not a
      // TTS alignment: line proof there is the retained master window
      // (spokenLineFulfillment). Narrated shot lists and aligned TTS stay token-exact.
      ...(manifest?.templateMotion?.enabled === true && manifest.templateMotion.narratedShotList !== true &&
        wholeVoice.alignment !== "elevenlabs-timestamps"
        ? { asrWords: { starts: [...wholeVoice.starts], seconds: laid.seconds } } : {}),
    } } : {}),
    ...(groups ? { sourceGroups: groups } : {}),
    ...(manifest?.templateMotion?.narratedShotList === true ? { narratedShotList: true } : {}),
    ...(reservedNarration ? { reservedNarration: true } : {}),
    ...(sourceMap ? { mapped: true, sourceMap } : {}),
  };
}

/** The selected terminal picture, not whichever available clip happens to finish. */
function terminalTemplateScene(manifest, board) {
  const jobs = selectedPictureJobs(manifest, board);
  const beat = manifest.planningBudget?.beats?.at(-1);
  return jobs ? jobs.at(-1)?.owners.at(-1)
    : beat ? (board?.scenes ?? []).findLast((scene) => scene.planningBeatIds?.includes(beat.id))
      : board?.scenes?.at(-1);
}

/**
 * Enabled only for a server-stamped template launch. These selected obligations
 * require preservation, not proof that an action succeeded or permission to
 * freeze contact, completion or a living tail.
 */
function protectTemplateMotion(timeline, manifest, board, notes = []) {
  if (manifest.templateMotion?.enabled !== true) return;
  const protection = new Map();
  const selectedJobs = selectedPictureJobs(manifest, board);
  const pictures = sceneTimes(timeline, true), rows = wordRows(timeline);
  for (const scene of board?.scenes ?? []) {
    const evidence = {};
    const phases = (scene.actionPhases ?? []).filter((p) => p.required === true && hasText(p.id) &&
      ["contact", "completion", "interior-hold", "living-tail"].includes(p.kind) && p.window);
    if (phases.length) evidence.actionPhases = phases;
    if (scene.actionLeadSec > 0) evidence.actionLeadSec = scene.actionLeadSec;
    if (scene.actionTailSec > 0) evidence.actionTailSec = scene.actionTailSec;
    const beats = (manifest.planningBudget?.beats ?? []).filter((b) => scene.planningBeatIds?.includes(b.id) &&
      (b.picture || b.silent));
    if (beats.length) evidence.planningBeats = beats;
    const selected = selectedJobs?.find((job) => job.owners.includes(scene));
    if (selected) evidence.selectedPicture = {
      id: selected.id, job: scene.planJob ?? null, seconds: scene.planSeconds,
      action: scene.subjectAction || scene.videoPrompt,
    };
    const facts = (board.protectedVisualConstraints ?? []).find((c) => c.sceneIndex === scene.sceneIndex)?.facts
      ?.filter((f) => f.subject === "action" && f.kind === "fact" && hasText(f.quote) && f.source);
    if (facts?.length) evidence.approvedActions = facts;
    const obligations = board.mechanismPlan?.kind === "required" ? board.mechanismPlan.obligations : [];
    const mechanism = (scene.mechanismCoverage ?? []).flatMap((coverage) => {
      const obligation = obligations.find((o) => o.id === coverage.obligationId);
      return obligation && coverage.phases?.length ? [{ coverage, obligation }] : [];
    });
    if (mechanism.length) evidence.mechanism = mechanism;
    const listener = manifest.templateMotion.listeners?.find((s) => s.sceneIndex === scene.sceneIndex);
    if (listener) evidence.listener = listener;
    if (scene.cutawayType === "reaction") evidence.reaction = { cueLineId: scene.cueLineId };
    const terminal = manifest.planningBudget?.beats?.at(-1);
    if (manifest.outputPermission?.ending?.mode === "native" &&
      (selectedJobs ? selectedJobs.at(-1)?.owners.at(-1) === scene
        : terminal ? scene.planningBeatIds?.includes(terminal.id) : scene === board.scenes.at(-1))) {
      evidence.ending = manifest.outputPermission.ending;
    }
    const segments = [...timeline.spine, ...timeline.cutaways].filter((s) => s.sceneIndex === scene.sceneIndex);
    const visible = pictures.filter((p) => p.scene === scene.sceneIndex).flatMap((p) => {
      const source = segments.find((s) => s.source === "clip" && s.startSec <= p.startSec + 1e-6 &&
        s.startSec + s.seconds >= p.startSec + p.seconds - 1e-6);
      const endSec = source ? Math.min(p.startSec + p.seconds, source.startSec + source.seconds - (source.holdSec ?? 0)) : 0;
      return endSec > p.startSec ? [{ startSec: p.startSec, endSec }] : [];
    });
    if (visible.length) {
      const start = visible[0].startSec, end = visible.at(-1).endSec;
      const localWords = rows.filter((row) => row.scene === scene.sceneIndex)
        .map((row) => ({ w: row.text, s: row.start - start, e: row.end - start, lineId: row.lineId }));
      const windows = templateActionWindows(localWords, {
        durationSec: end - start, actionPhases: phases, directorBeats: scene.directorBeats,
        notes, sceneIndex: scene.sceneIndex,
      }).map((w) => ({ ...w, startSec: start + w.startSec, endSec: start + w.endSec }));
      if (evidence.ending?.kind === "silent-editorial-close") windows.push({ id: "selected-ending", startSec: start, endSec: end });
      for (const seg of segments) if (seg.reaction?.visualSeconds > 0 || (seg.reactionOverlay && seg.visualSeconds > 0)) {
        windows.push({ id: "resolved-reaction", startSec: seg.startSec, endSec: seg.startSec + seg.seconds });
      }
      const resolved = windows.filter((window) => {
        let at = window.startSec;
        for (const span of visible) {
          if (span.endSec <= at) continue;
          if (span.startSec > at + 1e-6) return false;
          at = Math.max(at, span.endSec);
          if (at >= window.endSec - 1e-6) return true;
        }
        return false;
      });
      if (resolved.length) evidence.resolvedWindows = resolved;
    }
    if (Object.keys(evidence).length) protection.set(scene.sceneIndex, evidence);
  }
  for (const segment of [...timeline.spine, ...timeline.cutaways]) {
    const evidence = protection.get(segment.sceneIndex);
    if (evidence) segment.motionProtection = evidence;
  }
}

/** Final-clock locations for the existing probe, with only localized stillness
 * permissions. A quiet picture cannot excuse missing audible words underneath. */
function templateMotionReport(timeline, board, speed) {
  const segments = [...timeline.cutaways, ...timeline.spine];
  const shots = sceneTimes(timeline).map((shot) => {
    const segment = segments.find((s) =>
      s.sceneIndex === shot.scene && s.startSec <= shot.startSec + 0.001 &&
      s.startSec + s.seconds >= shot.startSec + shot.seconds - 0.001);
    return {
      sceneIndex: shot.scene, startSec: shot.startSec / speed, seconds: shot.seconds / speed,
      file: segment?.file ?? null, speed: (segment?.speed ?? 1) * speed,
      ...(segment?.motionProtection ? { protection: segment.motionProtection } : {}),
    };
  });
  const holds = [];
  const addHold = (sceneIndex, startSec, endSec, basis) => {
    for (const shot of shots.filter((s) => s.sceneIndex === sceneIndex)) {
      const start = Math.max(startSec / speed, shot.startSec);
      const end = Math.min(endSec / speed, shot.startSec + shot.seconds);
      if (!(end > start)) continue;

      for (const seg of timeline.spine) {
        const from = Math.max(start, seg.startSec / speed);
        const to = Math.min(end, (seg.startSec + seg.seconds) / speed);
        if (to > from) holds.push({ sceneIndex, startSec: from, seconds: to - from, basis,
          silent: !timeline.wholeVoice && seg.audio === "silence" });
      }
    }
  };
  for (const seg of timeline.spine) {
    if (seg.editorialHold?.sourceFrame !== undefined) {
      addHold(seg.sceneIndex, seg.startSec, seg.startSec + seg.seconds, "selected-retained-frame");
    }
  }
  const temporal = resolveTemporalRequirements({ timeline }, board ?? {});
  for (const requirement of temporal.requirements) {
    if (requirement.kind !== "interior-hold") continue;
    const owner = temporal.owners.find((o) => o.id === requirement.id);
    if (owner) addHold(owner.sceneIndex, requirement.startSec, requirement.endSec, requirement.id);
  }
  return { shots, holds };
}

/**
 * brollMinSec: a cutaway on screen for less than `minSec` of the finished ad
 * (its time in the cut over `speed`) is left out, and the shot before it plays
 * on over its time: the cutaway that ends where it starts, its last frame held
 * if its clip runs out, else the scene under it. `clipSeconds(file)` is a
 * clip's length. Returns a line for each cutaway left out.
 */
export function holdBroll(timeline, minSec, speed, clipSeconds) {
  const kept = [];
  const left = [];
  for (const c of timeline.cutaways) {
    const shown = c.seconds / speed;
    if (c.motionProtection || shown >= minSec - 1e-6) {
      kept.push(c);
      continue;
    }
    const why = `cutaway ${c.sceneIndex}: ${shown.toFixed(2)}s on screen, under the ${minSec}s B-roll minimum, so it is left out and`;
    const before = kept.at(-1);
    if (before && !before.motionProtection && Math.abs(before.startSec + before.seconds - c.startSec) < 0.5 / FPS) {
      before.seconds = roundMs(c.startSec + c.seconds - before.startSec);
      if (c.cutShortBy) before.cutShortBy = c.cutShortBy;
      else delete before.cutShortBy;
      const hold = before.source === "clip" ? roundMs(before.seconds - clipSeconds(before.file)) : 0;
      if (hold > 0) before.holdSec = hold;
      left.push(`${why} cutaway ${before.sceneIndex} plays on over it`);
    } else {
      left.push(`${why} the scene under it plays on`);
    }
  }
  timeline.cutaways = kept;
  return left;
}

/** speedUpSlowBroll: the most a slow cutaway is sped up. */
export const SLOW_SHOT_SPEED_MAX = 1.6;

/**
 * speedUpSlowBroll: every shot's motion is read off its clip before the render
 * (`motionOf(file, fromSec, seconds)`), and a cutaway that slowShots finds slow
 * plays its clip faster, at most SLOW_SHOT_SPEED_MAX, so it shows more of its
 * clip in the same time on screen. A cutaway whose clip is no longer than its
 * time on screen cannot be, and is noted. Returns a line for each slow cutaway.
 */
export function speedUpSlowBroll(timeline, motionOf, clipSeconds) {
  const shots = [
    ...timeline.spine
      .filter((seg) => seg.source === "clip")
      .map((seg) => ({ n: seg.sceneIndex, role: roleOf(seg), file: seg.file, from: seg.inSec ?? 0, sec: seg.seconds - (seg.holdSec ?? 0) })),
    ...timeline.cutaways
      .filter((c) => c.source === "clip")
      .map((c) => ({ n: c.sceneIndex, role: "b-roll", file: c.file, from: 0, sec: c.seconds, cutaway: c })),
  ].filter((s) => s.sec > 0);
  const measured = shots.map((s) => ({ ...s, motion: motionOf(s.file, s.from, s.sec) }));
  const notes = [];
  for (const slow of slowShots(measured)) {
    const c = slow.cutaway;
    if (!c || c.motionProtection) continue;
    const have = clipSeconds(c.file);
    if (!(have > c.seconds + 0.05)) {
      notes.push(`cutaway ${c.sceneIndex} barely moves, but its clip (${have.toFixed(2)}s) is no longer than its time on screen (${c.seconds.toFixed(2)}s), so it plays as it is`);
      continue;
    }
    c.speed = roundMs(Math.min(have / c.seconds, SLOW_SHOT_SPEED_MAX));
    notes.push(`cutaway ${c.sceneIndex} barely moves, so it plays ${c.speed}x faster: ${(c.seconds * c.speed).toFixed(2)}s of its clip in ${c.seconds.toFixed(2)}s`);
  }
  return notes;
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

/** The measured map: the picture re-stamped from its first decoded frame, then resampled by MAP_PICTURE (see pieceClock). */
const mappedNorm = (label) =>
  `[${label}]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
  `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS,${MAP_PICTURE},format=yuv420p`;

/**
 * The measured map: one piece cut on pieceClock's numbers, the same the map records:
 * the picture's sentence-gap slots out, then its slots from inSlot for the
 * piece's frames; its sound re-stamped from its first decoded sample, the same
 * gaps out by sample, then from fromSample, with silence only where the map
 * says the decoded sound is not there, and exactly the piece's samples long.
 * Only explicitly authorized retained-frame holds repeat picture; sound is
 * never stretched or sped. Returns the piece's concat pair.
 */
function mappedPiece(seg, i, { addInput, filters, tails, level, resolve }) {
  const clock = pieceClock(seg);
  const samples = clock.frames * SAMPLES_PER_FRAME;
  const fit = [];
  if (seg.editorialHold) {
    fit.push(`trim=start_frame=${seg.editorialHold.sourceSlot}:end_frame=${seg.editorialHold.sourceSlot + 1},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${clock.frames - 1},trim=end_frame=${clock.frames}`);
  } else if (clock.picture) {
    const { inSlot, cutSlots } = clock.picture;
    if (cutSlots.length > 0) {
      fit.push(`select=not(${cutSlots.map(([s, e]) => `between(n\\,${s}\\,${e - 1})`).join("+")}),setpts=N/FRAME_RATE/TB`);
    }
    fit.push(`trim=start_frame=${inSlot}:end_frame=${inSlot + clock.frames},setpts=PTS-STARTPTS`);
    if (seg.templateNarrationHold && clock.frames > clock.picture.shown) {
      fit.push(`tpad=stop_mode=clone:stop=${clock.frames - clock.picture.shown},trim=end_frame=${clock.frames}`);
    }
  }
  if (seg.punchIn) fit.push(PUNCH_IN);
  filters.push(`${mappedNorm(`${i}:v`)}${fit.length ? `,${fit.join(",")}` : ""}[v${i}]`);
  const s = clock.sound;
  if (!s) {
    filters.push(`anullsrc=r=${EDIT_SAMPLE_RATE}:cl=stereo,atrim=end_sample=${samples}[a${i}]`);
    return `[v${i}][a${i}]`;
  }
  const input = seg.audio === "clip" ? i : addInput("-i", resolve(seg.voice));
  let heard = `[${input}:a]${stereo},asetpts=PTS-STARTPTS,`;
  if (s.cutSamples.length > 0) {
    const kept = [0, ...s.cutSamples.flat()];
    const pieces = s.cutSamples.length + 1;
    filters.push(`${heard}asplit=${pieces}${Array.from({ length: pieces }, (_, p) => `[ap${i}_${p}]`).join("")}`);
    for (let p = 0; p < pieces; p++) {
      const end = p < s.cutSamples.length ? `:end_sample=${kept[2 * p + 1]}` : "";
      filters.push(`[ap${i}_${p}]atrim=start_sample=${kept[2 * p]}${end},asetpts=PTS-STARTPTS[aq${i}_${p}]`);
    }
    filters.push(`${Array.from({ length: pieces }, (_, p) => `[aq${i}_${p}]`).join("")}concat=n=${pieces}:v=0:a=1[ac${i}]`);
    heard = `[ac${i}]`;
  }
  const start = Math.max(0, s.fromSample);
  const lead = Math.max(0, -s.fromSample);
  const tail = seg.audio === "clip" ? seg.reaction?.tail ?? null : null;
  // A reaction's tail plays on from where its beat stops, so its beat's sound is not ended here.
  const end = tail ? "" : `:end_sample=${Math.max(start, s.toSample)}`;
  const head = `${heard}atrim=start_sample=${start}${end},asetpts=PTS-STARTPTS${lead > 0 ? `,adelay=delays=${lead}S:all=1` : ""}`;
  const [fadeIn, fadeOut] = [seg.fadeInSec ?? EDGE_FADE_SEC, seg.fadeOutSec ?? EDGE_FADE_SEC];
  const rise = fadeIn > EDGE_FADE_SEC ? ":curve=cub" : "";
  const fitLength =
    `apad,atrim=end_sample=${samples},afade=t=in:d=${sec(fadeIn)}${rise},` +
    `afade=t=out:st=${sec(seg.seconds - fadeOut)}:d=${sec(fadeOut)}`;
  if (!tail) {
    filters.push(`${head},${level},${fitLength}[a${i}]`);
    return `[v${i}][a${i}]`;
  }
  const tailSamples = Math.round(tail.seconds * EDIT_SAMPLE_RATE);
  filters.push(`${head},${level},asplit=2[as${i}][at${i}]`);
  filters.push(`[as${i}]${fitLength}[a${i}]`);
  filters.push(
    `[at${i}]atrim=start_sample=${samples}:end_sample=${samples + tailSamples},asetpts=PTS-STARTPTS,` +
      `volume=${tail.gain},afade=t=in:d=${EDGE_FADE_SEC},afade=t=out:st=0:d=${sec(tail.seconds)},` +
      `adelay=delays=${Math.round(tail.atSec * FPS) * SAMPLES_PER_FRAME}S:all=1[tail${i}]`,
  );
  tails.push(`[tail${i}]`);
  return `[v${i}][a${i}]`;
}

/**
 * The render. `finish` (null: today's render) carries the finishing settings'
 * part of it: levelSegments false leaves each segment's sound as it is for the
 * whole mix's loudness pass, `ass` names the captions and cards file burned in
 * (read from the folder ffmpeg runs in), `speed` over 1 speeds the whole
 * cut, picture and sound, after the burn, `clean` (cleanVoice) is the voice's
 * chain and the duck under it, and `meters` (cutChecks) names the two files
 * the voice and everything under it are also written to.
 */
export function buildFfmpegArgs(timeline, { resolve, music, out, finish = null, sound = null }) {
  const level = finish && finish.levelSegments === false ? "anull" : LOUDNORM;
  const inputs = [];
  let count = 0;
  const addInput = (...args) => {
    inputs.push(...args);
    return count++;
  };
  const filters = [];
  const pairs = [];
  const tails = [];
  // The measured map: every piece, overlay and the whole voice on pieceClock's numbers.
  const mapped = timeline.mapped === true;

  for (const seg of timeline.spine) {
    const i =
      seg.source === "clip"
        ? addInput("-i", resolve(seg.file))
        : addInput("-loop", "1", "-t", String(seg.seconds), "-i", resolve(seg.file));
    if (mapped) {
      pairs.push(mappedPiece(seg, i, { addInput, filters, tails, level, resolve }));
      continue;
    }
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
    if (seg.paceZoom) fit.push(PACE_ZOOM);
    filters.push(`${norm(`${i}:v`)}${fit.length ? `,${fit.join(",")}` : ""}[v${i}]`);
    // A segment split around a reaction beat starts partway into its sound too.
    const skipIn = inSec > 0.001 ? `atrim=start=${sec(inSec)},asetpts=PTS-STARTPTS,` : "";
    const [fadeIn, fadeOut] = [seg.fadeInSec ?? EDGE_FADE_SEC, seg.fadeOutSec ?? EDGE_FADE_SEC];
    // A cubic rise keeps a reaction's quiet start near silent until its laugh (#2666).
    const rise = fadeIn > EDGE_FADE_SEC ? ":curve=cub" : "";
    const fitLength =
      `apad,atrim=0:${sec(seg.seconds)},afade=t=in:d=${sec(fadeIn)}${rise},` +
      `afade=t=out:st=${sec(seg.seconds - fadeOut)}:d=${sec(fadeOut)}`;
    const fitSound = `${level},${fitLength}`;
    if (seg.wholeVoice) {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${sec(seg.seconds)}[a${i}]`);
    } else if (seg.audio === "narration") {
      const v = addInput("-i", resolve(seg.voice));
      filters.push(`[${v}:a]${stereo},${skipIn}${fitSound}[a${i}]`);
    } else if (seg.audio === "clip" && seg.reaction?.tail) {
      // The tail is cut from the same loudness-normalized sound as the beat,
      // ducked, faded out, and laid in at the join; the next line's own sound
      // plays at full level over it (#2406).
      const t = seg.reaction.tail;
      filters.push(`${heard}${skipIn}${level},asplit=2[as${i}][at${i}]`);
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
  // The measured map: the spoken sound is exactly the picture's samples, and a song laid
  // whole is its own decoded samples from its first scene's frame, whole: never
  // padded, looped or cut (the map refused a picture it would not fit).
  const pictureSamples = timeline.spine.reduce((n, seg) => n + Math.round(seg.seconds * FPS), 0) * SAMPLES_PER_FRAME;
  const toPicture = mapped ? `atrim=end_sample=${pictureSamples}` : `atrim=end=${pictureSec.toFixed(6)}`;
  if (timeline.wholeVoice) {
    // The voice laid whole from where its first scene starts, under the spine's own sound.
    const k = addInput("-i", resolve(timeline.wholeVoice.file));
    filters.push(`[voicecat]apad,${toPicture}[spoken]`);
    if (mapped) {
      const delay = Math.round(timeline.wholeVoice.startSec * FPS) * SAMPLES_PER_FRAME;
      filters.push(
        `[${k}:a]${stereo},asetpts=PTS-STARTPTS,atrim=start_sample=${timeline.wholeVoice.clock?.audio?.edit.priming ?? 0},` +
          `asetpts=PTS-STARTPTS,${level}${delay > 0 ? `,adelay=delays=${delay}S:all=1` : ""}[whole]`,
      );
    } else {
      filters.push(
        `[${k}:a]${stereo},${level},adelay=delays=${Math.round(timeline.wholeVoice.startSec * 1000)}:all=1,` +
          `apad,atrim=end=${pictureSec.toFixed(6)}[whole]`,
      );
    }
    filters.push("[spoken][whole]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[voice]");
  } else {
    filters.push(`[voicecat]apad,${toPicture}[voice]`);
  }

  let videoLabel = "vcat";
  timeline.cutaways.forEach((c, j) => {
    const i =
      c.source === "clip"
        ? addInput("-i", resolve(c.file))
        : addInput("-loop", "1", "-t", String(c.seconds), "-i", resolve(c.file));
    const end = c.startSec + c.seconds;
    if (mapped) {
      // The measured map: the overlay's own slots from its first decoded frame, on the edit's frames.
      const [from, frames] = [Math.round(c.startSec * FPS), Math.round(c.seconds * FPS)];
      const inSlot = Math.round((c.inSec ?? 0) * FPS);
      filters.push(`${mappedNorm(`${i}:v`)},trim=${inSlot ? `start_frame=${inSlot}:` : ""}end_frame=${inSlot + frames},setpts=PTS-STARTPTS+${from}/(${FPS}*TB)[cv${j}]`);
      filters.push(
        `[${videoLabel}][cv${j}]overlay=enable=between(t\\,${(from / FPS).toFixed(6)}\\,${((from + frames - 0.5) / FPS).toFixed(6)}):eof_action=pass[ov${j}]`,
      );
      videoLabel = `ov${j}`;
      return;
    }
    // speedUpSlowBroll: a slow cutaway plays faster; brollMinSec: one that plays on past its clip holds its last frame.
    const faster = c.speed > 1 ? `,setpts=PTS/${c.speed}` : "";
    const hold = c.holdSec > 0 ? `,tpad=stop_mode=clone:stop_duration=${sec(c.holdSec)}` : "";
    filters.push(
      `${norm(`${i}:v`)}${faster}${hold},trim=${c.inSec ? sec(c.inSec) : 0}:${sec((c.inSec ?? 0) + c.seconds)},setpts=PTS-STARTPTS+${sec(c.startSec)}/TB[cv${j}]`,
    );
    // eof_action=pass keeps the spine showing once the cutaway's frames end.
    filters.push(
      `[${videoLabel}][cv${j}]overlay=enable=between(t\\,${sec(c.startSec)}\\,${sec(end)}):eof_action=pass[ov${j}]`,
    );
    videoLabel = `ov${j}`;
  });

  // A copied ad's product cards: the product sheet picture fitted into each source box, for its time.
  (finish?.pictures ?? []).forEach((p, j) => {
    const k = addInput("-loop", "1", "-t", sec(p.endSec), "-i", resolve(p.file));
    const w = Math.round((p.box[2] - p.box[0]) * WIDTH);
    const h = Math.round((p.box[3] - p.box[1]) * HEIGHT);
    filters.push(`[${k}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba[pic${j}]`);
    filters.push(
      `[${videoLabel}][pic${j}]overlay=x=${Math.round(p.box[0] * WIDTH)}+(${w}-overlay_w)/2:y=${Math.round(p.box[1] * HEIGHT)}+(${h}-overlay_h)/2` +
        `:enable=between(t\\,${sec(p.startSec)}\\,${sec(p.endSec)}):eof_action=pass[pin${j}]`,
    );
    videoLabel = `pin${j}`;
  });
  // endCardLayers: the brand's ground over the whole frame, then the pack photo in its box, pushing in slowly.
  if (finish?.endCard) {
    const e = finish.endCard;
    const box = END_CARD_PHOTO_BOX;
    const w = even((box[2] - box[0]) * WIDTH);
    const h = even((box[3] - box[1]) * HEIGHT);
    const frames = Math.max(1, Math.round(e.seconds * FPS));
    const k = addInput("-loop", "1", "-t", sec(e.seconds), "-i", resolve(e.file));
    filters.push(`color=c=0x${e.colors.background}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${sec(e.out)},format=yuv420p[ecground]`);
    filters.push(`[${videoLabel}][ecground]overlay=enable=between(t\\,${sec(e.in)}\\,${sec(e.out)}):eof_action=pass[ecg]`);
    filters.push(
      `[${k}:v]fps=${FPS},scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x${e.colors.background},setsar=1,` +
        `zoompan=z=1+${END_CARD_PUSH_IN}*on/${frames}:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=1:s=${w}x${h}:fps=${FPS},` +
        `format=yuv420p,fade=t=in:st=0:d=${END_CARD_PHOTO_FADE_SEC},setpts=PTS-STARTPTS+${sec(e.in)}/TB[ecpic]`,
    );
    filters.push(
      `[ecg][ecpic]overlay=x=${Math.round(box[0] * WIDTH)}:y=${Math.round(box[1] * HEIGHT)}:enable=between(t\\,${sec(e.in)}\\,${sec(e.out)}):eof_action=pass[ecard]`,
    );
    videoLabel = "ecard";
  }
  if (finish?.ass) {
    filters.push(`[${videoLabel}]subtitles=filename=${finish.ass}[burned]`);
    videoLabel = "burned";
  }
  const speed = finish?.speed > 1 ? finish.speed : null;
  if (speed) {
    filters.push(`[${videoLabel}]setpts=PTS/${speed}[faster]`);
    videoLabel = "faster";
  }

  const beds = [];
  if (sound?.beds?.length) {
    sound.beds.forEach((b, j) => {
      const k = addInput("-stream_loop", "-1", "-i", resolve(b.file));
      const samples = Math.round(b.seconds * EDIT_SAMPLE_RATE);
      const delay = Math.round(b.startSec * EDIT_SAMPLE_RATE);
      filters.push(timeline.mapped
        ? `[${k}:a]${stereo},asetpts=PTS-STARTPTS,atrim=start_sample=${b.sourcePrimingSamples ?? 0}:end_sample=${samples + (b.sourcePrimingSamples ?? 0)},asetpts=PTS-STARTPTS,volume=${b.gainDb}dB,` +
          `afade=t=in:ns=${Math.round(BED_FADE_SEC * EDIT_SAMPLE_RATE)},afade=t=out:ss=${Math.max(0, samples - Math.round(BED_FADE_SEC * EDIT_SAMPLE_RATE))}:ns=${Math.round(BED_FADE_SEC * EDIT_SAMPLE_RATE)},` +
          `adelay=delays=${delay}S:all=1[set${j}]`
        : `[${k}:a]${stereo},atrim=0:${sec(b.seconds)},asetpts=PTS-STARTPTS,volume=${b.gainDb}dB,` +
          `afade=t=in:d=${BED_FADE_SEC},afade=t=out:st=${sec(Math.max(0, b.seconds - BED_FADE_SEC))}:d=${BED_FADE_SEC},` +
          `adelay=delays=${Math.round(b.startSec * 1000)}:all=1[set${j}]`,
      );
      beds.push(`[set${j}]`);
    });
  } else if (sound?.roomTone !== false && (!timeline.mapped || !timeline.wholeVoice) && !timeline.wholeVoice?.songOnly) {
    filters.push(timeline.mapped
      ? `${ROOM_TONE},atrim=end_sample=${Math.round(pictureSec * EDIT_SAMPLE_RATE)}[room]`
      : `${ROOM_TONE}[room]`);
    beds.push("[room]");
  }
  beds.push(...tails);
  (sound?.effects ?? []).forEach((e, j) => {
    const k = addInput("-i", resolve(e.file));
    const atSample = Math.round(e.atSec * EDIT_SAMPLE_RATE);
    const skip = Math.max(0, -atSample);
    const delay = Math.max(0, atSample);
    const endSample = Number.isFinite(e.durationSec) ? skip + (e.sourcePrimingSamples ?? 0) + Math.round(e.durationSec * EDIT_SAMPLE_RATE) : null;
    filters.push(timeline.mapped || Number.isFinite(e.durationSec) || Number.isFinite(e.offsetSec)
      ? `[${k}:a]${stereo},asetpts=PTS-STARTPTS,atrim=start_sample=${skip + (e.sourcePrimingSamples ?? 0)}${endSample === null ? "" : `:end_sample=${endSample}`},asetpts=PTS-STARTPTS,volume=${e.gainDb}dB,adelay=delays=${delay}S:all=1[sfx${j}]`
      : `[${k}:a]${stereo},volume=${e.gainDb}dB,adelay=delays=${Math.round(e.atSec * 1000)}:all=1[sfx${j}]`);
    beds.push(`[sfx${j}]`);
  });
  let voice = "[voice]";
  const clean = finish?.clean ?? null;
  if (music) {
    const m = addInput("-stream_loop", "-1", "-i", music);
    const duck = clean ? null : sound?.music?.duck;
    const fades = timeline.narratedShotList
      ? `,afade=t=in:d=${Math.min(1, pictureSec)},afade=t=out:st=${sec(Math.max(0, pictureSec - 3))}:d=${Math.min(3, pictureSec)}` : "";
    if (duck) {
      filters.push("[voice]asplit=2[voiced][duckkey]");
      filters.push(timeline.mapped
        ? `[${m}:a]${stereo},asetpts=PTS-STARTPTS,atrim=start_sample=${timeline.musicPrimingSamples ?? 0}:end_sample=${Math.round(pictureSec * EDIT_SAMPLE_RATE) + (timeline.musicPrimingSamples ?? 0)},asetpts=PTS-STARTPTS,volume=${sound.music.gainDb}dB${fades}[bedraw]`
        : `[${m}:a]${stereo},atrim=0:${pictureSec.toFixed(6)},asetpts=PTS-STARTPTS,volume=${sound.music.gainDb}dB${fades}[bedraw]`);
      filters.push(
        `[bedraw][duckkey]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=${duck.attack}:release=${duck.release}[bed]`,
      );
      voice = "[voiced]";
    } else if (clean && sound?.music) {
      filters.push(`[${m}:a]${stereo},atrim=0:${pictureSec.toFixed(6)},asetpts=PTS-STARTPTS,volume=${sound.music.gainDb}dB[bed]`);
    } else {
      filters.push(timeline.mapped
        ? `[${m}:a]${stereo},asetpts=PTS-STARTPTS,atrim=start_sample=${timeline.musicPrimingSamples ?? 0}:end_sample=${Math.round(pictureSec * EDIT_SAMPLE_RATE) + (timeline.musicPrimingSamples ?? 0)},asetpts=PTS-STARTPTS,volume=${timeline.narratedShotList ? "-17dB" : MUSIC_VOLUME}${fades}[bed]`
        : `[${m}:a]${stereo},volume=${MUSIC_VOLUME}[bed]`);
    }
    beds.push("[bed]");
  }
  let under = beds;
  if (clean) {
    // Each bed is trimmed to the picture, then ducked on its own by the same key, which ducks their sum the same.
    const ducked = beds.filter((label) => !tails.includes(label));
    const u = clean.under;
    filters.push(`[voice]${clean.voice},asplit=${ducked.length + 1}[voiced]${ducked.map((_, j) => `[vkey${j}]`).join("")}`);
    ducked.forEach((label, j) => {
      filters.push(`${label}atrim=end=${pictureSec.toFixed(6)},highpass=f=${u.highpass},lowpass=f=${u.lowpass},volume=${u.db}dB[uc${j}]`);
      filters.push(
        `[uc${j}][vkey${j}]sidechaincompress=threshold=${u.duck.threshold}:ratio=${u.duck.ratio}:attack=${u.duck.attack}:release=${u.duck.release}[ud${j}]`,
      );
    });
    voice = "[voiced]";
    under = [...ducked.map((_, j) => `[ud${j}]`), ...tails];
  }
  if (finish?.meters) {
    // cutChecks: the voice, and everything under it mixed, each also written alone to be measured.
    filters.push(`${voice}asplit=2[metered][vmeter]`);
    voice = "[metered]";
    under = under.map((label, j) => {
      filters.push(`${label}asplit=2[mu${j}][mb${j}]`, `[mb${j}]atrim=end=${pictureSec.toFixed(6)}[mt${j}]`);
      return `[mu${j}]`;
    });
    // Explicit ambience-off and trusted template songs can have no underlay.
    // Meter only real streams; preserve the historical graph when unspecified.
    if (under.length || (finish.meters.allowAbsentBed !== true && sound?.roomTone !== false)) filters.push(
      `${under.map((_, j) => `[mt${j}]`).join("")}amix=inputs=${under.length}:duration=longest:dropout_transition=0:normalize=0[bedmeter]`,
    );
  }
  filters.push(
    `${voice}${under.join("")}amix=inputs=${under.length + 1}:duration=first:dropout_transition=0:normalize=0[mix]`,
  );
  let audioLabel = "mix";
  if (speed) {
    filters.push(`[mix]atempo=${speed}[mixfaster]`);
    audioLabel = "mixfaster";
  }

  return [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    out,
    ...(finish?.meters
      ? ["-map", "[vmeter]", "-c:a", "pcm_s16le", finish.meters.voice,
          ...(under.length || (finish.meters.allowAbsentBed !== true && sound?.roomTone !== false) ? ["-map", "[bedmeter]", "-c:a", "pcm_s16le", finish.meters.bed] : [])]
      : []),
  ];
}

const roundMs = (n) => Math.round(n * 1000) / 1000;

/**
 * Authored setup identity on the pictures actually visible in the final edit.
 * Source clocks prove continuity, not that a director watched an alternate angle.
 * Later cutaways occlude earlier pictures exactly as the renderer overlays them.
 */
export function finalSetupAdjacency(timeline, board, graphics = []) {
  const scenes = new Map((board?.scenes ?? []).map((scene) => [scene.sceneIndex, scene]));
  const overlays = [...(timeline.cutaways ?? []), ...graphics].filter((seg) => seg.seconds > 0);
  const setupSegments = [];
  const sourceAt = (seg, local, isEnd) => {
    if (seg.source !== "clip" || seg.editorialHold || seg.holdSec > 0) return null;
    if (!seg.map?.picture || !Number.isInteger(seg.map.slot)) return sourceTimeOf(seg, local, isEnd);
    const post = seg.map.slot + Math.round(local * FPS);
    let removed = 0;
    for (const cut of seg.cuts ?? []) {
      if (!cut.slots) return null;
      const at = cut.slots[0] - removed;
      if (isEnd ? post > at : post >= at) removed += cut.slots[1] - cut.slots[0];
    }
    return (post + removed) / FPS;
  };
  const append = (seg, hidden, overlay = false) => {
    const scene = scenes.get(seg.sceneIndex);
    const from = seg.startSec, to = from + seg.seconds;
    if (!Number.isFinite(from) || !(to > from)) return;
    const edges = [from, to];
    let removed = 0;
    let removedSlots = 0;
    for (const cut of overlay ? [] : seg.cuts ?? []) {
      const mapped = Number.isInteger(seg.map?.slot) && cut.slots;
      const at = mapped ? from + (cut.slots[0] - removedSlots - seg.map.slot) / FPS
        : from + cut.s - removed - (seg.inSec ?? 0);
      removed += cut.e - cut.s;
      if (mapped) removedSlots += cut.slots[1] - cut.slots[0];
      if (at > from && at < to) edges.push(at);
    }
    edges.sort((a, b) => a - b);
    let visible = edges.slice(0, -1).map((start, i) => ({ from: start, to: edges[i + 1] }));
    for (const cover of hidden) {
      const start = cover.startSec, end = start + cover.seconds;
      visible = visible.flatMap((span) => end <= span.from || start >= span.to ? [span]
        : [{ from: span.from, to: start }, { from: end, to: span.to }].filter((piece) => piece.to > piece.from));
    }
    for (const span of visible) setupSegments.push({
      sceneIndex: seg.sceneIndex, file: seg.file ?? null,
      setId: hasText(scene?.setId) ? scene.setId.trim() : null,
      anchorEditEpoch: hasText(scene?.anchorEditEpoch) ? scene.anchorEditEpoch.trim() : null,
      baseShotId: hasText(scene?.baseShotId) ? scene.baseShotId.trim() : null,
      finalStartSec: r6(span.from), finalEndSec: r6(span.to),
      sourceStartSec: sourceAt(seg, span.from - from, false),
      sourceEndSec: sourceAt(seg, span.to - from, true),
      identity: "authored", clock: seg.map?.picture ? "mapped" : "timeline",
    });
  };
  for (const seg of timeline.spine ?? []) append(seg, overlays);
  overlays.forEach((seg, index) => append(seg, overlays.slice(index + 1), true));
  setupSegments.sort((a, b) => a.finalStartSec - b.finalStartSec);
  const setupJoins = [];
  for (let index = 1; index < setupSegments.length; index++) {
    const left = setupSegments[index - 1], right = setupSegments[index];
    if (Math.abs(left.finalEndSec - right.finalStartSec) > 1e-6) continue;
    const continuous = left.file && left.file === right.file && Number.isFinite(left.sourceEndSec) &&
      Number.isFinite(right.sourceStartSec) && Math.abs(left.sourceEndSec - right.sourceStartSec) < 1e-6;
    const known = left.baseShotId && right.baseShotId;
    const different = known && (left.baseShotId !== right.baseShotId ||
      left.setId && right.setId && left.setId !== right.setId);
    const same = known && left.baseShotId === right.baseShotId && left.setId === right.setId &&
      left.anchorEditEpoch === right.anchorEditEpoch;
    setupJoins.push({ atSec: right.finalStartSec, left: index - 1, right: index,
      kind: continuous ? "continuous-same-source" : different ? "different-setup" : same ? "discontinuous-same-setup" : "unknown" });
  }
  return { setupSegments, setupJoins };
}

/**
 * #3300: every stretch of the cut where a scene is the picture, in order. A
 * cutaway covers the whole frame, so the spine scene under it is off screen
 * there and its placement splits around it. A scene split around a reaction
 * beat, or shown twice, has one entry per stretch.
 */
export function sceneTimes(timeline, exact = false) {
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
    .map((p) => timeline.mapped || exact
      ? { scene: p.sceneIndex, startSec: p.startSec, seconds: p.seconds }
      : { scene: p.sceneIndex, startSec: roundMs(p.startSec), seconds: roundMs(p.seconds) })
    .filter((p) => p.seconds > 0)
    .sort((a, b) => a.startSec - b.startSec);
}

/** Each retained word row beside the spine piece and source word index it came from. */
function segmentWordRows(timeline) {
  const rows = [];
  for (const seg of timeline.spine) {
    const pieceId = seg.piece ? `${seg.sceneIndex}.${seg.piece.n}` : String(seg.sceneIndex);
    const parts = timeline.sourceMap?.pieces.find((p) => p.piece === pieceId)?.lineParts ?? [];
    for (const [index, w] of (seg.words ?? []).entries()) {
      const text = (w.w ?? "").trim();
      const start = seg.startSec + w.s;
      const end = seg.startSec + (timeline.mapped ? wordEnd(w) : w.e);
      if (text && end > start) {
        const owner = parts.find((p) => p.measured && index >= p.firstWord && index <= p.lastWord);
        rows.push({ seg, index, row: timeline.mapped
          ? {
              text, start: r6(start), end: r6(end), scene: seg.sceneIndex, lineId: w.lineId ?? owner?.lineId ?? null,
              partId: owner?.sourceSpan?.partId ?? owner?.part ?? null,
            }
          : { text, start: roundMs(start), end: roundMs(end), scene: seg.sceneIndex, ...(hasText(w.lineId) ? { lineId: w.lineId } : {}) } });
      }
    }
  }
  return rows;
}

export function wordRows(timeline) {
  return segmentWordRows(timeline).map(({ row }) => row);
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
    const covers = !c.broll
      ? ""
      : c.coversFound
        ? `, B-roll covering "${c.broll.covers}"`
        : `, B-roll: "${c.broll.covers}" is not in the line, so it starts with the line for its planned ${c.broll.plannedSec}s`;
    rows.push({
      n: c.sceneIndex,
      line:
        `cutaway ${c.sceneIndex}: ${label} at ${c.startSec.toFixed(2)}s for ${c.seconds.toFixed(1)}s, ` +
        `cued to ${c.cueLineId} in scene ${c.spineSceneIndex} (${how})${covers}${cut}`,
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

// ---- finishing: captions and cards drawn by code, the pace report, the loudness pass ----

const pad2 = (n) => String(n).padStart(2, "0");
const round2 = (n) => Math.round(n * 100) / 100;
const assTime = (t) => {
  const cs = Math.round(Math.max(0, t) * 100);
  return `${Math.floor(cs / 360000)}:${pad2(Math.floor(cs / 6000) % 60)}:${pad2(Math.floor(cs / 100) % 60)}.${pad2(cs % 100)}`;
};
const assText = (s) => String(s).replace(/[{}\\]/g, "").replace(/\s*[\r\n]+\s*/g, " ").trim();

/** A caption screen never holds words across a pause longer than this, so a silent beat shows none. */
export const CAPTION_BREAK_SEC = 0.8;

/**
 * Caption screens from the cut's words: a few words a screen (`cap`, a source
 * record's caption style, else 3), never across a pause, each up until 0.25 s
 * after its last word or the next screen. `words`: [{ text, start, end }].
 */
export function captionScreens(words, cap = null) {
  const per = Math.max(1, Math.round(cap?.wordsPerLine?.median ?? 3));
  const caps = /all-caps|capitals|upper/i.test(cap?.style ?? "");
  const chunks = [];
  let cur = [];
  for (const w of words) {
    if (cur.length && (cur.length >= per || w.start - cur.at(-1).end > CAPTION_BREAK_SEC)) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((ws, k) => {
    const next = chunks[k + 1]?.[0];
    const text = ws.map((w) => assText(w.text)).join(" ").replace(/[.,;:]+$/, "");
    return {
      text: caps ? text.toUpperCase() : text,
      s: ws[0].start,
      e: roundMs(Math.min(ws.at(-1).end + 0.25, next?.start ?? Infinity)),
    };
  });
}

/**
 * captionsByLine: a caption screen holds the words of one script line only, a
 * few a screen (`cap`, a source record's caption style, else 3), breaks on a
 * pause over CAPTION_LINE_GAP_SEC, stays up CAPTION_TAIL_SEC after its last
 * word at most and goes off CAPTION_CLEAR_SEC before the next comes on. A
 * screen shorter than CAPTION_MIN_SEC joins the next one of its line, else the
 * one before, one word over the few at most. `words`: [{ text, start, end, line }].
 */
export const CAPTION_LINE_GAP_SEC = 0.5;
export const CAPTION_TAIL_SEC = 0.15;
export const CAPTION_CLEAR_SEC = 0.02;
export const CAPTION_MIN_SEC = 0.35;
/** captionsByLine: the caption font is at most this share of the frame's height (69 px of 1920). */
export const CAPTION_MAX_SHARE = 0.036;
/** captionColours: the speakers' caption colours in the order they first speak (ASS, &HBBGGRR&): white, yellow, cyan. */
export const CAPTION_COLOURS = ["&HFFFFFF&", "&H00FFFF&", "&HFFFF00&"];
/** captionColours: a coloured screen's black edge, at least this thick, so yellow or cyan still reads on a light picture. */
export const CAPTION_COLOUR_MIN_OUTLINE = 4;

/**
 * captionColours: each line caption screen (lineCaptionScreens) in its
 * speaker's colour, so a viewer follows who talks when one of them is off
 * screen. The speaker is the screen's script line's speakerId, a narrator's
 * line (no speakerId) one speaker of its own; the colours go in the order the
 * speakers first speak and start again after the last. A screen whose line
 * the script does not hold stays as it is.
 */
export function colourScreens(screens, storyboard) {
  const speakerOf = new Map((storyboard?.script ?? []).map((line) => [line?.lineId, line?.speakerId ?? null]));
  const order = [];
  return screens.map((c) => {
    if (!speakerOf.has(c.line)) return c;
    const who = speakerOf.get(c.line);
    if (!order.includes(who)) order.push(who);
    return { ...c, colour: CAPTION_COLOURS[order.indexOf(who) % CAPTION_COLOURS.length] };
  });
}

export function lineCaptionScreens(words, cap = null) {
  const per = Math.max(1, Math.round(cap?.wordsPerLine?.median ?? 3));
  const caps = /all-caps|capitals|upper/i.test(cap?.style ?? "");
  let chunks = [];
  let cur = [];
  for (const w of words) {
    const last = cur.at(-1);
    // Script words timed by one heard word ("twenty five" for "25") stay on one screen.
    const oneHeard = last && w.line === last.line && w.start === last.start && w.end === last.end;
    if (last && !oneHeard && (cur.length >= per || w.line !== last.line || w.start - last.end > CAPTION_LINE_GAP_SEC)) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  for (let k = 0; k < chunks.length; k++) {
    const c = chunks[k];
    if (c.at(-1).end - c[0].start >= CAPTION_MIN_SEC) continue;
    const next = chunks[k + 1];
    const prev = chunks[k - 1];
    const joins = (a, b) => a && b && b[0].line === a[0].line && b[0].start - a.at(-1).end <= CAPTION_LINE_GAP_SEC && a.length + b.length <= per + 1;
    if (joins(c, next)) {
      chunks[k + 1] = [...c, ...next];
      chunks[k] = null;
    } else if (joins(prev, c)) {
      chunks[k - 1] = [...prev, ...c];
      chunks[k] = null;
    }
  }
  chunks = chunks.filter(Boolean);
  return chunks.map((ws, k) => {
    const next = chunks[k + 1]?.[0];
    const text = ws.map((w) => assText(w.text)).join(" ").replace(/[.,;:]+$/, "");
    const off = next ? next.start - CAPTION_CLEAR_SEC : Infinity;
    const e = Math.min(Math.max(ws[0].start + 0.12, ws.at(-1).end + CAPTION_TAIL_SEC), off);
    return { text: caps ? text.toUpperCase() : text, s: roundMs(ws[0].start), e: roundMs(e), line: ws[0].line };
  });
}

/**
 * captionsByLine: the cut's words in its own time, each with the script line
 * it belongs to. Where a segment's script is heard in order (alignScript),
 * they are the script's words as written, each timed by the heard words that
 * say it; elsewhere they are the heard words, each on the line its place among
 * the script's words gives it, the way a cue line is found (lineInSegment).
 */
export function lineWords(timeline, storyboard) {
  const texts = new Map((storyboard?.script ?? []).map((line) => [line?.lineId, line?.text]));
  const counts = lineWordCounts(storyboard);
  const rows = [];
  for (const seg of timeline.spine) {
    const heard = seg.words ?? [];
    if (heard.length === 0) continue;
    const at = (t) => roundMs(seg.startSec + t);
    const lines = seg.lineIds.map((id) => scriptWords(texts.get(id)));
    const aligned = lines.some((l) => l.length > 0) ? alignScript(heard, lines.flat()) : null;
    if (aligned) {
      const lineOf = lines.flatMap((ws, j) => ws.map(() => seg.lineIds[j]));
      const { expected, heard: tokens, heardTokenOf } = aligned;
      lines.flat().forEach((text, i) => {
        const said = heardTokenOf.filter((_, e) => expected.sourceIndex[e] <= i && i <= expected.lastSourceIndex[e]);
        if (said.length === 0) return;
        const start = at(heard[tokens.sourceIndex[said[0]]].s);
        const end = at(heard[tokens.lastSourceIndex[said.at(-1)]].e);
        if (end > start) rows.push({ text, start, end, line: lineOf[i] });
      });
      continue;
    }
    const ends = [];
    let n = 0;
    for (const id of seg.lineIds) ends.push((n += counts.get(id) ?? 0));
    heard.forEach((w, i) => {
      const text = (w.w ?? "").trim();
      const start = at(w.s);
      const end = at(w.e);
      if (!text || end <= start) return;
      const j = ends.findIndex((last) => Math.min(i, n - 1) < last);
      rows.push({ text, start, end, line: seg.lineIds[j] ?? seg.lineIds.at(-1) ?? `scene ${seg.sceneIndex}` });
    });
  }
  return rows;
}

/**
 * One ASS file for the burn: the caption screens in their band, the cards in
 * their boxes, the hook box and the end card. Boxes are [x0, y0, x1, y1] as
 * shares of the frame. Every word on screen is the script's or the storyboard's.
 */
export function editAss({ captions = [], cap = null, cards = [], hook = null, endCard = null, endLayers = null, capMaxShare = null }, W = WIDTH, H = HEIGHT) {
  const thick = /thick black outline/i.test(cap?.style ?? "");
  const y = cap?.place ? Math.round(((cap.place[0] + cap.place[1]) / 2) * H) : Math.round(H * 0.7);
  const capSize = Math.min(Math.round(H * (thick ? 0.05 : 0.034)), capMaxShare ? Math.round(H * capMaxShare) : Infinity);
  const box = (b) => `\\pos(${Math.round(((b[0] + b[2]) / 2) * W)},${Math.round(((b[1] + b[3]) / 2) * H)})`;
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Helvetica,${capSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,${thick ? 7 : 1.5},${thick ? 4 : 2},5,60,60,0,1`,
    "Style: Card,Helvetica,60,&H00141414,&H00141414,&H00FFFFFF,&H50000000,-1,0,0,0,100,100,0,0,3,18,4,5,0,0,0,1",
    `Style: End,Helvetica,${Math.round(H * 0.045)},&H00FFFFFF,&H00FFFFFF,&H20101010,&H00000000,-1,0,0,0,100,100,2,0,3,40,0,5,0,0,0,1`,
    ...(endLayers ? endCardStyles(endLayers.colors, H) : []), "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...captions.map((c) => `Dialogue: 1,${assTime(c.s)},${assTime(c.e)},Cap,,0,0,0,,{\\pos(${W / 2},${y})${c.colour ? `\\c${c.colour}${thick ? "" : `\\bord${CAPTION_COLOUR_MIN_OUTLINE}`}` : ""}}${c.text}`),
    ...cards.filter((c) => c.label).map((c) => `Dialogue: 2,${assTime(c.in)},${assTime(c.out)},Card,,0,0,0,,{${box(c.box)}\\fs${Math.round(H * 0.036)}\\fad(60,0)}${assText(c.label)}`),
    ...(hook?.text ? [`Dialogue: 3,${assTime(hook.in)},${assTime(hook.out)},Card,,0,0,0,,{${box(hook.box)}\\fs${Math.round(H * 0.026)}}${assText(hook.text)}`] : []),
    ...(endCard ? [`Dialogue: 4,${assTime(endCard.in)},${assTime(endCard.out)},End,,0,0,0,,{\\pos(${W / 2},${H / 2})\\fad(120,0)}${assText(endCard.text)}`] : []),
    ...(endLayers ? endCardDialogues(endLayers, W, H) : []),
  ].join("\n") + "\n";
}

/**
 * Where a card sits when the storyboard says it only in words (`placement`).
 * A source record's own boxes take their place once a run can carry one.
 */
const CARD_BOXES = [
  [/full|centre|center|middle/i, [0.08, 0.44, 0.92, 0.56]],
  [/lower|bottom/i, [0.08, 0.56, 0.92, 0.64]],
];
const CARD_BOX_TOP = [0.08, 0.14, 0.92, 0.24];
export const cardBox = (placement) => CARD_BOXES.find(([words]) => words.test(placement ?? ""))?.[1] ?? CARD_BOX_TOP;
/** Overlays that are pictures, not words: no file for them reaches the cut, so none is drawn. */
const PICTURE_OVERLAY = /screenshot|chart/i;
/** The end card holds the ad's last this many seconds. */
export const END_CARD_SEC = 2;

/**
 * The storyboard's on-screen words (its overlays) as cards: each lands
 * CARD_LEAD_SEC before the first word of the line it is cued to and holds
 * through that line, at least BROLL_MIN_HOLD_SEC. The CTA's own overlay is
 * the end card instead (endCardOf). An overlay cued to a line no segment
 * speaks is left out.
 */
export function storyboardCards(storyboard, timeline) {
  const counts = lineWordCounts(storyboard);
  const ctaId = storyboard?.cta?.overlayId;
  const cards = [];
  for (const o of storyboard?.overlays ?? []) {
    if (!hasText(o?.text) || !hasText(o?.cueLineId) || o.overlayId === ctaId || PICTURE_OVERLAY.test(o.type ?? "")) continue;
    const seg = timeline.spine.find((s) => !s.reaction && s.lineIds.includes(o.cueLineId));
    const cue = seg ? cueOffsetOnSpine(timeline.spine, counts, o.cueLineId) : null;
    if (!cue) continue;
    const at = roundMs(Math.max(0, cue.startSec - CARD_LEAD_SEC));
    const lineEnd = seg.startSec + (cueEndInSegment(seg, counts, o.cueLineId) ?? seg.seconds);
    cards.push({
      n: cards.length + 1, label: o.text.trim(), box: cardBox(o.placement),
      in: at, out: roundMs(Math.max(lineEnd, at + BROLL_MIN_HOLD_SEC)), on: `line ${o.cueLineId}`,
    });
  }
  return cards;
}

/**
 * A copied ad's on-screen words in the source's own places: the storyboard's
 * overlays, in script order, land in the record's card boxes one for one, at
 * the card's times on the cut; the overlay placed "hook" goes in the record's
 * hook box. Cards with no overlay of ours, and overlays with no card, are
 * left out and noted.
 */
export function sourceAdEdit(storyboard, sourceAd, groups) {
  const at = (t) => roundMs(mapSourceTime(groups, t));
  const order = new Map((storyboard?.script ?? []).map((line, i) => [line?.lineId, i]));
  const ctaId = storyboard?.cta?.overlayId;
  const words = (storyboard?.overlays ?? []).filter(
    (o) => hasText(o?.text) && o.overlayId !== ctaId && !PICTURE_OVERLAY.test(o.type ?? ""),
  );
  const hookOverlay = words.find((o) => /hook/i.test(o.placement ?? "")) ?? null;
  const texts = words
    .filter((o) => o !== hookOverlay)
    .sort((a, b) => (order.get(a.cueLineId) ?? Infinity) - (order.get(b.cueLineId) ?? Infinity));
  const cards = sourceAd.cards.flatMap((c, k) => {
    const o = texts[k];
    if (!o) return [];
    const from = at(c.tIn);
    return [{ n: k + 1, label: o.text.trim(), box: c.box, in: from, out: Math.max(at(c.tOut), roundMs(from + BROLL_MIN_HOLD_SEC)), on: `source card ${c.n}` }];
  });
  const notes = [];
  if (sourceAd.cards.length > texts.length) notes.push(`${sourceAd.cards.length - texts.length} of the source's cards had no overlay of ours, so they were not drawn`);
  if (texts.length > sourceAd.cards.length) notes.push(`${texts.length - sourceAd.cards.length} overlays had no source card to land in, so they were not drawn`);
  const hook = sourceAd.hook && hookOverlay
    ? { text: hookOverlay.text.trim(), box: sourceAd.hook.box, in: at(sourceAd.hook.tIn), out: at(sourceAd.hook.tOut) }
    : null;
  if (sourceAd.hook && !hookOverlay) notes.push("the source has a hook box and the storyboard no overlay placed \"hook\", so none was drawn");
  return { cards, hook, notes };
}

/** The CTA overlay's words over the ad's last END_CARD_SEC, or null when the storyboard has none. */
export function endCardOf(storyboard, seconds) {
  const ctaId = storyboard?.cta?.overlayId;
  const overlay = ctaId ? (storyboard?.overlays ?? []).find((o) => o?.overlayId === ctaId) : null;
  if (!hasText(overlay?.text)) return null;
  return { text: overlay.text.trim(), in: roundMs(Math.max(0, seconds - END_CARD_SEC)), out: roundMs(seconds + 1) };
}

/**
 * COP-217: the source ad's own shots for the pace report. A fast-cut ad's shot list joins its short shots into fewer
 * entries (the worker's sourceShots), so `shots` is the list the board copies and `adShots`, when the worker wrote
 * it, the ad's real cuts.
 */
export function sourceAdPaceShots(sourceAd) {
  return Array.isArray(sourceAd?.adShots) && sourceAd.adShots.length > 0 ? sourceAd.adShots : sourceAd.shots;
}

/**
 * endCardLayers and brandCheck (Plan 14): the manifest's `brand`, written by
 * the worker beside `finishing`: the product's pack photo it downloaded
 * (`packPhoto`, a file in the folder), the product's name, the scenes whose
 * picture the pull's rule draws from that photo (`photoScenes`), the end
 * card's length and the brand's colours (hex), each optional. Null when the
 * manifest has none, so a cut without it is the one it always was.
 */
export const END_CARD_LAYERS_SEC = 6;
export const END_CARD_MIN_SEC = 5;
export const END_CARD_MAX_SEC = 8;
/** The end card's colours when the brand gives none: a near-black ground, white words, a white call-to-action box. */
export const END_CARD_COLORS = { background: "111111", text: "FFFFFF", accent: "FFFFFF" };
/** Where the pack photo sits on the end card, as shares of the frame, and how far it pushes in across the card. */
export const END_CARD_PHOTO_BOX = [0.1, 0.1, 0.9, 0.56];
export const END_CARD_PUSH_IN = 0.05;
/** The words build in one after another, this far apart, after the photo has faded in. */
const END_CARD_WORD_STEP_SEC = 0.6;
const END_CARD_PHOTO_FADE_SEC = 0.4;
/** A spoken call to action longer than this many words is too long to letter; the card then shows none. */
const END_CARD_CTA_MAX_WORDS = 8;

const hexColour = (value) => (typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().replace(/^#/, "").toUpperCase() : null);

export function brandOf(manifest) {
  const b = manifest?.brand;
  if (!b || typeof b !== "object") return null;
  const text = (v) => (hasText(v) ? v.trim() : null);
  const colors = b.colors && typeof b.colors === "object" ? b.colors : {};
  const seconds = Number.isFinite(b.endCardSec) ? Math.min(END_CARD_MAX_SEC, Math.max(END_CARD_MIN_SEC, b.endCardSec)) : END_CARD_LAYERS_SEC;
  return {
    packPhoto: text(b.packPhoto),
    productName: text(b.productName),
    photoScenes: Array.isArray(b.photoScenes) ? b.photoScenes.filter((n) => Number.isInteger(n)) : [],
    endCardSec: seconds,
    colors: {
      background: hexColour(colors.background) ?? END_CARD_COLORS.background,
      text: hexColour(colors.text) ?? END_CARD_COLORS.text,
      accent: hexColour(colors.accent) ?? END_CARD_COLORS.accent,
    },
  };
}

/**
 * The end card's words, each the storyboard's own or null: the headline is the
 * product's name, the offer an overlay the storyboard types or places as an
 * offer, price, deal or guarantee, and the call to action the CTA's overlay,
 * else its spoken line when that is short enough to letter.
 */
export function endCardWords(storyboard, productName = null) {
  const overlays = storyboard?.overlays ?? [];
  const ctaId = storyboard?.cta?.overlayId;
  const ctaOverlay = ctaId ? overlays.find((o) => o?.overlayId === ctaId) : null;
  const spokenId = storyboard?.cta?.spokenLineId;
  const spoken = spokenId ? (storyboard?.script ?? []).find((l) => l?.lineId === spokenId)?.text : null;
  const offer = overlays.find(
    (o) => o?.overlayId !== ctaId && hasText(o?.text) && /offer|discount|price|deal|guarantee|promo/i.test(`${o.type ?? ""} ${o.placement ?? ""}`),
  );
  const headline = hasText(storyboard?.product?.name) ? storyboard.product.name.trim() : hasText(productName) ? productName.trim() : null;
  const shortSpoken = hasText(spoken) && spoken.trim().split(/\s+/).length <= END_CARD_CTA_MAX_WORDS ? spoken.trim() : null;
  return {
    headline,
    offer: hasText(offer?.text) ? offer.text.trim() : null,
    cta: hasText(ctaOverlay?.text) ? ctaOverlay.text.trim() : shortSpoken,
  };
}

/**
 * endCardLayers: the ad's last `endCardSec` seconds of screen time (`speed`
 * is the cut's speed-up, applied after) become the end card: the brand's
 * ground colour, the pack photo pushing in slowly, and the words drawn by
 * code over it. The sound runs on under it as cut, so the call to action is
 * heard over the card. Never more than half the ad. Null without a pack photo.
 */
export function endCardLayersOf(brand, storyboard, pictureSec, speed = 1) {
  if (!brand?.packPhoto) return null;
  const seconds = Math.min(brand.endCardSec * speed, pictureSec / 2);
  if (!(seconds > 0)) return null;
  const at = roundMs(Math.max(0, pictureSec - seconds));
  return {
    file: brand.packPhoto,
    in: at,
    out: roundMs(pictureSec + 1),
    seconds: roundMs(pictureSec - at),
    words: endCardWords(storyboard, brand.productName),
    colors: brand.colors,
  };
}

/** An ASS colour (&HAABBGGRR) from a hex RRGGBB. */
const assColour = (hex, alpha = "00") => `&H${alpha}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;

/** The end card's three word styles, in the brand's colours. */
function endCardStyles(colors, H) {
  const text = assColour(colors.text);
  return [
    `Style: EndHead,Helvetica,${Math.round(H * 0.05)},${text},${text},&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,5,60,60,0,1`,
    `Style: EndOffer,Helvetica,${Math.round(H * 0.034)},${text},${text},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1`,
    // The call to action sits in a box of the accent colour, its words in the ground colour.
    `Style: EndCta,Helvetica,${Math.round(H * 0.036)},${assColour(colors.background)},${assColour(colors.background)},${assColour(colors.accent)},${assColour(colors.accent)},-1,0,0,0,100,100,1,0,3,28,0,5,60,60,0,1`,
  ];
}

/** The end card's words, building in one after another after the photo. */
function endCardDialogues(e, W, H) {
  const rows = [
    ["EndHead", e.words.headline, 0.64],
    ["EndOffer", e.words.offer, 0.71],
    ["EndCta", e.words.cta, 0.82],
  ].filter(([, words]) => hasText(words));
  return rows.map(([style, words, y], k) => {
    const from = roundMs(e.in + END_CARD_PHOTO_FADE_SEC + k * END_CARD_WORD_STEP_SEC);
    return `Dialogue: 5,${assTime(from)},${assTime(e.out)},${style},,0,0,0,,{\\pos(${W / 2},${Math.round(H * y)})\\fad(250,0)}${assText(words)}`;
  });
}

/** Caption screens stop where the end card starts: its words are the card's, not the caption band's. */
export function captionsBeforeEndCard(screens, e) {
  if (!e) return screens;
  return screens.filter((c) => c.s < e.in).map((c) => (c.e > e.in ? { ...c, e: e.in } : c));
}

/** Whether every word of `name`, in order, is among the heard words (case, accents and punctuation aside). */
export function nameHeard(rows, name) {
  const fold = (t) => String(t).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const want = fold(name).split(" ").filter(Boolean);
  if (want.length === 0) return null;
  const heard = rows.flatMap((r) => fold(r.text).split(" ").filter(Boolean));
  for (let i = 0; i + want.length <= heard.length; i++) {
    if (want.every((w, k) => heard[i + k] === w)) return true;
  }
  return false;
}

/**
 * brandCheck: what the cut records about the brand, and only records: the
 * pack photo reached the folder; the scenes whose picture the pull's rule
 * draws from it; whether the end card carries it; whether the product's name
 * is among the heard words (null with no name to look for).
 */
export function brandRecord({ brand, packPhoto, endLayers, rows }) {
  const name = brand?.productName ?? null;
  return {
    packPhoto,
    photoScenes: packPhoto ? (brand?.photoScenes ?? []) : [],
    photoReachedScene: packPhoto && (brand?.photoScenes ?? []).length > 0,
    endCardPicture: Boolean(endLayers),
    productName: name,
    productNameHeard: name ? nameHeard(rows, name) : null,
  };
}

/**
 * The pace report: cuts a minute, mean and longest shot, shots over
 * LONG_SHOT_SEC, words a minute and pauses over 0.3 s, against a source ad's
 * when there is one (each source figure null when not). Shots are
 * [{ start, end }] or [{ t0, t1 }]; silences [{ s, e }].
 */
export function paceReport({ ourShots, srcShots = null, ourSec, srcSec = null, ourWords = 0, srcWords = 0, ourSilences = [], speed = 1 }) {
  const lens = (xs) => xs.map((s) => round2((s.end ?? s.t1) - (s.start ?? s.t0)));
  const o = lens(ourShots);
  const sr = srcShots && srcSec ? lens(srcShots) : null;
  const mean = (a) => (a.length ? round2(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const long = (a) => a.filter((x) => x > LONG_SHOT_SEC + 0.05).length;
  return {
    seconds: { ours: round2(ourSec), source: sr ? round2(srcSec) : null, ratio: sr ? roundMs(ourSec / srcSec) : null },
    speed,
    cutsPerMin: { ours: round2(((ourShots.length - 1) / ourSec) * 60), source: sr ? round2(((srcShots.length - 1) / srcSec) * 60) : null },
    meanShotSec: { ours: mean(o), source: sr ? mean(sr) : null },
    longestShotSec: { ours: Math.max(0, ...o), source: sr ? Math.max(0, ...sr) : null },
    over4s: { ours: long(o), source: sr ? long(sr) : null },
    wordsPerMin: { ours: ourWords ? round2((ourWords / ourSec) * 60) : null, source: srcWords && srcSec ? round2((srcWords / srcSec) * 60) : null },
    deadAir: {
      over03s: ourSilences.filter((x) => x.e - x.s > 0.3).length,
      longestSec: round2(Math.max(0, ...ourSilences.map((x) => x.e - x.s))),
    },
  };
}

/** The pauses in the cut's voice, from its word times: every gap of PACE_PAUSE_SEC or more between two words. */
export function voicePauses(rows) {
  const pauses = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].start - rows[i - 1].end >= PACE_PAUSE_SEC) pauses.push({ s: rows[i - 1].end, e: rows[i].start });
  }
  return pauses;
}

// ---- cutChecks: the finished cut checked before anyone grades it ----

/**
 * The bars a checked cut is held to. voiceOverBedDb and the slow-shot ratio
 * are guesses, to be tuned against the graders' notes on the cuts they mark.
 * blipSec (blipCheck), freezeSec and freezeYavg (freezeCheck) are guesses too:
 * a freeze is picture whose frame-to-frame change (motionArgs' YAVG) stays
 * under freezeYavg for freezeSec or longer.
 */
export const CHECK_BARS = { voiceOverBedDb: 10, minBrollSec: 1.2, truePeak: -1.0, lufs: -14, blipSec: 1.0, freezeSec: 1.0, freezeYavg: 0.2 };
/** A shot is slow when it moves under this share of the cut's median motion, or under SLOW_SHOT_FLOOR. */
const SLOW_SHOT_RATIO = 0.35;
const SLOW_SHOT_FLOOR = 0.6;
/** A phrase of this many words said again within REPEAT_WITHIN words is a repeat. */
const REPEAT_WORDS = 3;
const REPEAT_WITHIN = 14;
const NUMBER_WORDS_AS_DIGITS = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twenty: "20", thirty: "30" };
/** A heard word as the checks compare it: lower case, no punctuation, a number word as its digits. */
export const checkWord = (s) => {
  const t = String(s).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9%$]/g, "");
  return NUMBER_WORDS_AS_DIGITS[t] ?? t;
};

/** Caption screens that hold words of two script lines. `words` carry their line (lineWords). */
export function lineMixes(screens, words) {
  return screens
    .filter((c) => new Set(words.filter((w) => w.start >= c.s - 0.01 && w.start < c.e).map((w) => w.line)).size > 1)
    .map((c) => ({ s: c.s, text: c.text }));
}

/** A phrase of REPEAT_WORDS or more words said again within REPEAT_WITHIN words. `heard`: [{ w, s }]. */
export function repeats(heard) {
  const t = heard.map((h) => checkWord(h.w));
  const out = [];
  for (let i = 0; i + REPEAT_WORDS <= t.length; i++) {
    const phrase = t.slice(i, i + REPEAT_WORDS).join(" ");
    for (let j = i + REPEAT_WORDS; j + REPEAT_WORDS <= Math.min(t.length, i + REPEAT_WORDS + REPEAT_WITHIN); j++) {
      if (t.slice(j, j + REPEAT_WORDS).join(" ") === phrase) {
        out.push({ phrase, firstAt: roundMs(heard[i].s), againAt: roundMs(heard[j].s) });
        i += REPEAT_WORDS - 1;
        break;
      }
    }
  }
  return out;
}

/** B-roll and narrated shots on screen for less than CHECK_BARS.minBrollSec. `shots`: [{ n, role, start, end }]. */
export function shortShots(shots, minSec = CHECK_BARS.minBrollSec) {
  return shots
    .filter((s) => ["b-roll", "overlay", "vo-enactment"].includes(s.role) && s.end - s.start < minSec)
    .map((s) => ({ n: s.n, role: s.role, at: s.start, sec: roundMs(s.end - s.start) }));
}

/**
 * blipCheck: shots of any role on screen for less than `minSec` of the cut,
 * unless the source ad cut its own shot as short. `shots`: [{ n, role, start,
 * end, srcSec }], srcSec the length of the source shot the scene copies, or
 * null when there is none to compare with (then every short shot is named).
 */
export function blips(shots, minSec = CHECK_BARS.blipSec) {
  return shots
    .filter((s) => s.end - s.start < minSec && (s.srcSec == null || s.srcSec >= minSec))
    .map((s) => ({ n: s.n, role: s.role, at: s.start, sec: roundMs(s.end - s.start), srcSec: s.srcSec == null ? null : roundMs(s.srcSec) }));
}

/**
 * Shots whose motion is far under the cut's median. A shot of someone talking
 * to camera (a-roll) sits still at natural speed, so it is never slow here.
 * `motion`: [{ n, role, sec, motion }].
 */
export function slowShots(motion) {
  const values = motion.map((m) => m.motion).filter((x) => x != null).sort((a, b) => a - b);
  if (!values.length) return [];
  const median = values[Math.floor(values.length / 2)];
  return motion
    .filter((m) => m.role !== "a-roll" && m.motion != null && m.sec >= 1 && (m.motion < median * SLOW_SHOT_RATIO || m.motion < SLOW_SHOT_FLOOR))
    .map((m) => ({ ...m, median: roundMs(median) }));
}

/** The voice's loudness over the rest's, in dB; null when the voice is silent, 60 when the rest is. */
export const voiceOverBed = (voiceLufs, bedLufs) =>
  voiceLufs == null || bedLufs == null || voiceLufs < -60 ? null : bedLufs < -60 ? 60 : roundMs(voiceLufs - bedLufs);

/** What fails the bars, in words; the cut passes when nothing does. */
export function checkVerdict(c, bars = CHECK_BARS) {
  const fails = [];
  if (c.lineMixes?.length) fails.push(`${c.lineMixes.length} caption screens mix two lines`);
  if (c.voiceOverBedDb != null && c.voiceOverBedDb < bars.voiceOverBedDb) fails.push(`voice ${c.voiceOverBedDb} dB over the bed (bar ${bars.voiceOverBedDb})`);
  if (c.repeats?.length) fails.push(`${c.repeats.length} phrase(s) said twice`);
  if (c.shortShots?.length) fails.push(`${c.shortShots.length} b-roll shot(s) under ${bars.minBrollSec} s`);
  if (c.slowShots === null) fails.push("shot motion could not be measured");
  else if (c.slowShots?.length) fails.push(`${c.slowShots.length} slow shot(s)`);
  if (c.blips?.length) fails.push(`${c.blips.length} blip(s) under ${bars.blipSec} s`);
  if (c.freezes?.length) fails.push(`${c.freezes.length} freeze(s) of ${bars.freezeSec} s or more`);
  if (c.floors?.cards.length) fails.push(`${c.floors.cards.length} card(s) on screen outside ${FLOOR_BARS.cardMinSec} to ${FLOOR_BARS.cardMaxSec} s`);
  if (c.floors?.leads.length) fails.push(`${c.floors.leads.length} shot(s) after a card under ${FLOOR_BARS.leadSec} s before the first word`);
  if (c.floors?.dialogue.length) fails.push(`${c.floors.dialogue.length} dialogue take(s) under ${FLOOR_BARS.dialogueMinSec} s`);
  if (c.floors?.shortTakes.length) fails.push(`${c.floors.shortTakes.length} take(s) over ${FLOOR_BARS.shortTakeShare * 100}% short of plan`);
  if (c.flashes?.length) fails.push(`${c.flashes.length} flash(es) under ${FLASH_BARS.maxSec} s`);
  if (c.levelSteps === null) fails.push("the cut's sound levels could not be read");
  else if (c.levelSteps?.length) fails.push(`${c.levelSteps.length} level step(s) over ${LEVEL_STEP_BARS.maxStepDb} dB at a cut`);
  if (c.voFits?.length) fails.push(`${c.voFits.length} voice-over fit(s) broken`);
  if (c.dashGaps?.length) fails.push(`${c.dashGaps.length} dash gap(s) over ${DASH_BARS.maxGapSec} s`);
  if (c.paceBreaks?.lines.length) fails.push(`${c.paceBreaks.lines.length} line(s) outside the pace band`);
  if (c.paceBreaks?.gaps.length) fails.push(`${c.paceBreaks.gaps.length} gap(s) between lines outside their band`);
  if (c.names?.missing.length) fails.push(`${c.names.missing.length} name(s) not heard`);
  if (c.truePeak != null && c.truePeak > bars.truePeak) fails.push(`true peak ${c.truePeak} dBTP (bar ${bars.truePeak})`);
  if (c.lufs != null && Math.abs(c.lufs - bars.lufs) > 1) fails.push(`loudness ${c.lufs} LUFS (bar ${bars.lufs} ± 1)`);
  return { pass: !fails.length, fails };
}

/** Frame-to-frame change of a file's picture, on a 90 px wide copy, printed per frame. `from`/`seconds` read a stretch. */
export function motionArgs(file, from = null, seconds = null) {
  return [
    "-hide_banner", "-nostats",
    ...(from !== null ? ["-ss", sec(from)] : []), ...(seconds !== null ? ["-t", sec(seconds)] : []),
    "-i", file, "-an",
    "-vf", "scale=90:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
    "-f", "null", "-",
  ];
}

/** motionArgs' printout as [{ t, y }]: each frame's time and its mean change. */
export function readMotion(stdout) {
  const rows = [];
  let t = null;
  for (const line of String(stdout ?? "").split("\n")) {
    const time = line.match(/pts_time:([\d.]+)/);
    if (time) {
      t = Number(time[1]);
      continue;
    }
    const y = line.match(/YAVG=([\d.]+)/);
    if (y && t !== null) rows.push({ t, y: Number(y[1]) });
  }
  return rows;
}

/** Each shot's mean motion, its first and last 0.1 s left out so a cut is not counted as motion. */
export function motionByShot(rows, shots) {
  return shots.map((s) => {
    const v = rows.filter((r) => r.t > s.start + 0.1 && r.t < s.end - 0.1).map((r) => r.y);
    return { n: s.n, role: s.role, at: roundMs(s.start), sec: roundMs(s.end - s.start), motion: v.length ? roundMs(v.reduce((x, y) => x + y, 0) / v.length) : null };
  });
}

/**
 * freezeCheck: each stretch of consecutive frames whose change (readMotion's
 * rows, [{ t, y }]) stays under `still` for `minSec` or longer. A stretch runs
 * from its first still frame to the next frame that moves, or to one frame past
 * the last when the cut ends still.
 */
export function freezes(rows, { minSec = CHECK_BARS.freezeSec, still = CHECK_BARS.freezeYavg } = {}) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (!(rows[i].y < still)) continue;
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].y < still) j++;
    const step = j > 0 ? rows[j].t - rows[j - 1].t : 0;
    const end = j + 1 < rows.length ? rows[j + 1].t : rows[j].t + step;
    if (end - rows[i].t >= minSec - 1e-9) out.push({ at: roundMs(rows[i].t), sec: roundMs(end - rows[i].t) });
    i = j;
  }
  return out;
}

/** The length of the source ad's shot `n`, or null when there is no source record or no such shot. */
const sourceShotSec = (sourceAd, n) => {
  const e = n == null ? null : sourceAd?.shots.find((x) => x.n === n);
  return e ? e.t1 - e.t0 : null;
};

// ---- Plan 14: record-only cut checks from Luke's rulebook, each under cutChecks ----

/**
 * The bars Plan 14's cut checks hold a cut to. The numbers are Luke's
 * (microdrama rulebook RB5.8, P-7, RB9.4, RB1.6, RB5.4, RB5.1 to RB5.3); how
 * each maps onto this cut, where a card is an overlay on a line and a take is
 * a scene, is a guess until a graded cut tunes it. spikeYavg and
 * spikeOverMedian (flashCheck) are guesses of our own.
 */
export const FLOOR_BARS = { cardMinSec: 2.5, cardMaxSec: 3.0, leadSec: 1.0, dialogueMinSec: 8, shortTakeShare: 0.25 };
export const FLASH_BARS = { maxSec: 0.2, spikeYavg: 12, spikeOverMedian: 4 };
export const LEVEL_STEP_BARS = { maxStepDb: 3, sideSec: 0.5, minQuietSec: 0.1, wordClearSec: 0.05 };
export const VO_FIT_BARS = { leadSec: 0.3 };
export const DASH_BARS = { maxGapSec: 0.15, sameTakeMaxSec: 0.3 };
/** paceCheck's numbers; a format may set any of the first six (settings.ts paceCheck). */
export const PACE_BARS = { minWps: 2.3, maxWps: 2.7, minGapSec: 0.3, maxGapSec: 0.6, beatMaxSec: 1.2, hookMaxGapSec: 1.5, minLineWords: 4 };
export const PACE_BAR_KEYS = ["minWps", "maxWps", "minGapSec", "maxGapSec", "beatMaxSec", "hookMaxGapSec"];

/**
 * floorCheck (RB5.8): a card on screen outside cardMinSec to cardMaxSec; the
 * first shot after a card whose first word comes under leadSec into it; a
 * dialogue take under dialogueMinSec that does not end on a reaction beat; a
 * take more than shortTakeShare under its planned length. All times are the
 * finished cut's. `cards`: [{ n, label, in, out }]; `shots`: [{ n, start, end }];
 * `rows`: the cut's words [{ start }]; `takes`: takesOf's [{ n, at, sec,
 * takeSec, planSec, dialogue, endsOnReaction }].
 */
export function floors({ cards, shots, rows, takes }, bars = FLOOR_BARS) {
  const cardsOut = cards
    .map((c) => ({ n: c.n, label: c.label, at: roundMs(c.in), sec: roundMs(c.out - c.in) }))
    .filter((c) => c.sec < bars.cardMinSec - 1e-9 || c.sec > bars.cardMaxSec + 1e-9);
  const leads = [];
  for (const c of cards) {
    const shot = shots.find((s) => s.start >= c.out - 1e-3);
    const word = shot ? rows.find((r) => r.start >= shot.start - 1e-3) : null;
    if (!word) continue;
    const lead = roundMs(word.start - shot.start);
    if (lead < bars.leadSec) leads.push({ card: c.n, n: shot.n, at: roundMs(shot.start), leadSec: lead });
  }
  const dialogue = takes
    .filter((t) => t.dialogue && !t.endsOnReaction && t.sec < bars.dialogueMinSec)
    .map((t) => ({ n: t.n, at: roundMs(t.at), sec: roundMs(t.sec) }));
  const shortTakes = takes
    .filter((t) => t.planSec > 0 && t.takeSec < t.planSec * (1 - bars.shortTakeShare))
    .map((t) => ({ n: t.n, sec: roundMs(t.takeSec), planSec: roundMs(t.planSec) }));
  return { cards: cardsOut, leads, dialogue, shortTakes };
}

/**
 * floorCheck's takes from the spine: each run of segments of one scene (a take
 * split at its pauses is one take), whether it is the scene's own dialogue,
 * and whether a reaction beat follows it; then each cutaway. `sec` is its time
 * in the finished cut; `takeSec` its own length before any speed-up, which is
 * what its plan (the storyboard's durationSec) is read against.
 */
export function takesOf(timeline, plans, speed = 1) {
  const takes = [];
  timeline.spine.forEach((seg, i) => {
    if (seg.reaction) return;
    const last = takes.at(-1);
    const endsOnReaction = Boolean(timeline.spine[i + 1]?.reaction);
    if (last && last.n === seg.sceneIndex && last.lastSeg === i - 1) {
      Object.assign(last, { takeSec: last.takeSec + seg.seconds, lastSeg: i, endsOnReaction });
      return;
    }
    takes.push({
      n: seg.sceneIndex, start: seg.startSec, takeSec: seg.seconds, dialogue: seg.audio === "clip",
      planSec: plans.get(seg.sceneIndex)?.durationSec ?? 0, lastSeg: i, endsOnReaction,
    });
  });
  for (const c of timeline.cutaways) {
    takes.push({ n: c.sceneIndex, start: c.startSec, takeSec: c.seconds, dialogue: false, planSec: plans.get(c.sceneIndex)?.durationSec ?? 0, endsOnReaction: false });
  }
  return takes.map(({ lastSeg, start, ...t }) => ({ ...t, at: start / speed, sec: t.takeSec / speed }));
}

/**
 * flashCheck (P-7, Plan 13's 0.12 s piece and one-frame leaks): every shot on
 * screen under maxSec (a one-frame piece included), and every single frame of
 * picture the motion read shows as a flash: a change into it and a change out
 * of it, both a cut's size (spikeYavg, and spikeOverMedian times the cut's
 * median change), as when a clip's first frame is another picture. A frame
 * flash inside a short shot already named is not named twice.
 */
export function flashes(shots, motion, bars = FLASH_BARS) {
  const out = shots
    .filter((s) => s.end - s.start < bars.maxSec - 1e-9)
    .map((s) => ({ n: s.n, at: roundMs(s.start), sec: roundMs(s.end - s.start), from: "shot" }));
  const values = motion.map((m) => m.y).sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : 0;
  const spike = (r) => r && r.y >= bars.spikeYavg && r.y >= median * bars.spikeOverMedian;
  for (let i = 0; i + 1 < motion.length; i++) {
    if (!spike(motion[i]) || !spike(motion[i + 1])) continue;
    const at = motion[i].t;
    const sec = motion[i + 1].t - at;
    if (!out.some((f) => at >= f.at - 1 / FPS && at < f.at + f.sec + 1 / FPS)) out.push({ n: null, at: roundMs(at), sec: roundMs(sec), from: "frame" });
    i++;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The power mean of some loudness windows, in dB. */
const meanDb = (db) => 10 * Math.log10(db.reduce((sum, d) => sum + 10 ** (d / 10), 0) / db.length);

/**
 * levelStepCheck (RB9.4, V-5): at each cut, the sound with no word in it just
 * before and just after (sideSec each side, clear of every word by
 * wordClearSec), and the step between them; a step over maxStepDb is named. A
 * cut with under minQuietSec of such sound on either side cannot be read and
 * is left out. `levels`: the finished cut's { windowSec, db }; `cuts`: [{ n, at }].
 */
export function levelSteps(levels, cuts, rows, bars = LEVEL_STEP_BARS) {
  const { windowSec, db } = levels;
  const busy = (t) => rows.some((r) => t >= r.start - bars.wordClearSec && t <= r.end + bars.wordClearSec);
  const side = (from, to) => {
    const kept = [];
    for (let k = Math.max(0, Math.floor(from / windowSec)); k < Math.min(db.length, Math.ceil(to / windowSec)); k++) {
      const mid = (k + 0.5) * windowSec;
      if (mid >= from && mid < to && !busy(mid)) kept.push(db[k]);
    }
    return kept.length * windowSec >= bars.minQuietSec - 1e-9 ? meanDb(kept) : null;
  };
  const out = [];
  for (const c of cuts) {
    const before = side(c.at - bars.sideSec, c.at);
    const after = side(c.at, c.at + bars.sideSec);
    if (before === null || after === null) continue;
    const step = round2(after - before);
    if (Math.abs(step) > bars.maxStepDb) out.push({ n: c.n, at: roundMs(c.at), stepDb: step, beforeDb: round2(before), afterDb: round2(after) });
  }
  return out;
}

/**
 * voFitCheck (RB1.6): each voice-over take's first word starts leadSec or more
 * after the last word heard before it, and its last word ends inside its take.
 * `takes`: [{ n, start, end }] in cut time; `rows`: the cut's words [{ start, end, scene }].
 */
export function voFits(takes, rows, bars = VO_FIT_BARS) {
  const out = [];
  for (const t of takes) {
    const own = rows.filter((r) => r.scene === t.n && r.start >= t.start - 1e-3 && r.start < t.end);
    if (own.length === 0) continue;
    const first = own[0];
    const last = own.at(-1);
    const before = rows.filter((r) => !own.includes(r) && r.start < first.start).at(-1);
    if (before && first.start - before.end < bars.leadSec - 1e-9) {
      out.push({ n: t.n, at: roundMs(first.start), early: roundMs(first.start - before.end) });
    }
    if (last.end > t.end + 1e-3) out.push({ n: t.n, at: roundMs(last.end), late: roundMs(last.end - t.end) });
  }
  return out;
}

/** A line the script ends on a dash: the next speaker cuts in. */
const ENDS_ON_DASH = /(?:[—–]|-{1,2})["'”’)\]]*\s*$/;
/** A line the script ends on an ellipsis: a beat after it. */
const ENDS_ON_ELLIPSIS = /(?:…|\.{3})["'”’)\]]*\s*$/;

/**
 * Each heard script line in the cut, in time order: its first and last word,
 * its word count, and the take it was heard in. `words`: lineWords' rows in
 * cut time, [{ text, start, end, line }]; `takeOf`: line id to scene.
 */
export function heardLines(words, script, takeOf = () => null) {
  const byLine = new Map();
  for (const w of words) {
    if (!byLine.has(w.line)) byLine.set(w.line, []);
    byLine.get(w.line).push(w);
  }
  const scripted = new Map((script ?? []).filter((l) => typeof l?.lineId === "string").map((l) => [l.lineId, l]));
  return [...byLine.entries()]
    .filter(([id]) => scripted.has(id))
    .map(([id, ws]) => ({
      line: scripted.get(id), id, start: ws[0].start, end: Math.max(...ws.map((w) => w.end)), words: ws.length, take: takeOf(id),
    }))
    .sort((a, b) => a.start - b.start);
}

/**
 * dashGapCheck (RB5.4, RB5.9): a line the script ends on a dash, and the
 * next heard line another speaker says: the gap from the dashed line's last
 * word to the cut-in's first, named when over maxGapSec. `sameTake` marks a
 * gap inside one take, the one Luke's pace judge rejects over sameTakeMaxSec.
 */
export function dashGaps(lines, bars = DASH_BARS) {
  const out = [];
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    if (!next || !ENDS_ON_DASH.test(l.line.text ?? "") || next.line.speakerId === l.line.speakerId) return;
    const gap = roundMs(next.start - l.end);
    if (gap <= bars.maxGapSec + 1e-9) return;
    const sameTake = l.take != null && l.take === next.take;
    out.push({ line: l.id, next: next.id, at: roundMs(l.end), gapSec: gap, sameTake, ...(sameTake && gap > bars.sameTakeMaxSec ? { rolled: true } : {}) });
  });
  return out;
}

/**
 * paceCheck (RB5.1 to RB5.3): each heard line of minLineWords or more spoken
 * at minWps to maxWps words a second, first word to last; the gap between two
 * heard lines from minGapSec to maxGapSec, up to beatMaxSec where the script
 * asks for a beat (a direction, or a line ending on an ellipsis), and under
 * hookMaxGapSec after the first line. A gap after a dash is dashGapCheck's.
 */
export function paceBreaks(lines, bars = PACE_BARS) {
  const words = lines
    .filter((l) => l.words >= bars.minLineWords && l.end > l.start)
    .map((l) => ({ line: l.id, at: roundMs(l.start), wps: round2(l.words / (l.end - l.start)) }))
    .filter((l) => l.wps < bars.minWps || l.wps > bars.maxWps);
  const gaps = [];
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    if (!next || ENDS_ON_DASH.test(l.line.text ?? "")) return;
    const gap = roundMs(next.start - l.end);
    if (i === 0) {
      if (gap > bars.hookMaxGapSec + 1e-9) gaps.push({ line: l.id, next: next.id, at: roundMs(l.end), gapSec: gap, hook: true });
      return;
    }
    const beat = asksPause(l.line) || asksPause(next.line) || ENDS_ON_ELLIPSIS.test(l.line.text ?? "");
    const max = beat ? bars.beatMaxSec : bars.maxGapSec;
    if (gap < bars.minGapSec - 1e-9 || gap > max + 1e-9) gaps.push({ line: l.id, next: next.id, at: roundMs(l.end), gapSec: gap, ...(beat ? { beat: true } : {}) });
  });
  return { lines: words, gaps };
}

/** A title before a name ("Mrs. Hughes"): its period ends no sentence. */
const TITLE = /^(Mr|Mrs|Ms|Dr|St)\.$/;
/** A name as the check compares it: lower case, letters and digits only, no possessive. */
const nameToken = (word) => wordToken(String(word ?? "").replace(/['’]s$/i, ""));

/**
 * The script's names: every word that reads as one (nameLikeWords: a capital
 * inside it, or a leading capital where no sentence starts) anywhere in the
 * script, and each capitalized word of a cast member's name, so the same word
 * at a line's start counts too.
 */
export function scriptNames(script, cast = []) {
  const names = new Set();
  for (const member of cast ?? []) {
    for (const word of String(member?.name ?? "").split(/\s+/)) {
      const token = nameToken(word);
      if (/^[A-Z]/.test(word) && token && !/^\d+$/.test(token)) names.add(token);
    }
  }
  for (const line of script ?? []) {
    const words = scriptWords(line?.text).map((w) => (TITLE.test(w) ? w.slice(0, -1) : w));
    nameLikeWords(words).forEach((isName, i) => {
      const token = nameToken(words[i]);
      if (isName && token && !/^\d+$/.test(token)) names.add(token);
    });
  }
  return names;
}

/**
 * nameCheck (RB3.10): every name the script gives a take survives in what
 * the scribe heard in that take, as asr-name-roundtrip does for the product's
 * name: the same word, the same sound, one slip on a long name, or written as
 * two heard words. `takes`: [{ n, lineIds, heard: [word] }], one per scene;
 * `cast`: the storyboard's [{ name }].
 */
export function namesNotHeard(takes, script, cast = []) {
  const known = scriptNames(script, cast);
  const texts = new Map((script ?? []).map((l) => [l?.lineId, l?.text]));
  let checked = 0;
  const missing = [];
  for (const t of takes) {
    const heard = t.heard.map(nameToken).filter(Boolean);
    const joined = heard.join("");
    for (const id of t.lineIds) {
      for (const word of scriptWords(texts.get(id))) {
        const name = nameToken(word);
        if (!known.has(name) || !/^[A-Z]/.test(word.replace(/^[^A-Za-z0-9]+/, ""))) continue;
        checked++;
        const found = heard.some((h) => sameWord(name, h, true) || h === `${name}s`) || (name.length >= 5 && joined.includes(name));
        if (!found) missing.push({ n: t.n, line: id, name: word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") });
      }
    }
  }
  return { checked, missing };
}

/**
 * Plan 14's checks a finished cut is put through, each only when `finish`
 * turns it on, every time in the finished cut's (after `speed`). The script's
 * lines are read off the clips' scribe words (lineWords), as the captions are.
 */
function plan14Checks({ timeline, storyboard, rows, shots, motion, out, finish, cards, speed }) {
  const faster = (t) => roundMs(t / speed);
  const script = storyboard?.script ?? [];
  const takeOfLine = new Map();
  for (const seg of timeline.spine) for (const id of seg.lineIds ?? []) if (!takeOfLine.has(id)) takeOfLine.set(id, seg.sceneIndex);
  const lines = finish?.dashGapCheck || finish?.paceCheck
    ? heardLines(lineWords(timeline, storyboard).map((w) => ({ ...w, start: faster(w.start), end: faster(w.end) })), script, (id) => takeOfLine.get(id) ?? null)
    : [];
  const byScene = new Map();
  for (const seg of timeline.spine) {
    if (seg.reaction) continue;
    const take = byScene.get(seg.sceneIndex) ?? { n: seg.sceneIndex, lineIds: [], heard: [] };
    take.lineIds.push(...(seg.lineIds ?? []).filter((id) => !take.lineIds.includes(id)));
    take.heard.push(...(seg.words ?? []).map((w) => w.w));
    byScene.set(seg.sceneIndex, take);
  }
  const levels = finish?.levelStepCheck ? clipLevels(out) : null;
  return {
    ...(finish?.floorCheck
      ? {
        floors: floors({
          cards: cards.map((c) => ({ ...c, in: faster(c.in), out: faster(c.out) })),
          shots, rows, takes: takesOf(timeline, scenePlans(storyboard), speed),
        }),
      }
      : {}),
    ...(finish?.flashCheck ? { flashes: flashes(shots, motion) } : {}),
    // null: the cut's sound could not be decoded, so no cut was read.
    ...(finish?.levelStepCheck ? { levelSteps: levels ? levelSteps(levels, shots.slice(1).map((s) => ({ n: s.n, at: s.start })), rows) : null } : {}),
    // A song laid whole is one voice-over the length of the ad, so it has no takes to fit.
    ...(finish?.voFitCheck
      ? {
        voFits: timeline.wholeVoice ? [] : voFits(
          timeline.spine.filter((seg) => seg.audio === "narration").map((seg) => ({ n: seg.sceneIndex, start: faster(seg.startSec), end: faster(seg.startSec + seg.seconds) })),
          rows,
        ),
      }
      : {}),
    ...(finish?.dashGapCheck ? { dashGaps: dashGaps(lines) } : {}),
    ...(finish?.paceCheck ? { paceBreaks: paceBreaks(lines, { ...PACE_BARS, ...finish.paceCheck }) } : {}),
    ...(finish?.nameCheck ? { names: namesNotHeard([...byScene.values()], script, storyboard?.cast) } : {}),
  };
}

/** The part a spine segment plays on screen, as the checks read shots: a scene speaking its own lines (or a reaction) is a-roll. */
const roleOf = (seg) => (seg.reaction || seg.audio === "clip" ? "a-roll" : seg.audio === "narration" ? "vo-enactment" : "b-roll");

/**
 * cutChecks: the finished cut against CHECK_BARS. `screens` are the caption
 * screens burned in (null for none), `rows` and `scenes` the cut's words and
 * shots as written beside it, `levels` the voice's and the bed's loudness from
 * the render. Caption sync is not checked: it needs a transcription of the
 * finished cut of its own, and the cut's words are the ones its captions came from.
 * With blipCheck and freezeCheck in `finish`, the checks also name blips (each
 * shot's source length found through `shotOf`, the storyboard's sourceShot, in
 * `sourceAd`) and freezes; with them off, their keys are absent. The same holds
 * for Plan 14's checks, floorCheck to nameCheck: `cards` are the text cards
 * burned in and `speed` the cut's speed-up, so every time they name is the
 * finished cut's. `endCard` (endCardLayers) is the pack-photo end card: its
 * slow push-in is still picture by design, so freezeCheck reads only the
 * picture before it.
 */
function checkCut({ timeline, storyboard, screens, rows, scenes, out, loudness, levels, finish = null, sourceAd = null, shotOf = () => null, cards = [], speed = 1, endCard = null }) {
  const roles = new Map(timeline.spine.map((seg) => [seg.sceneIndex, roleOf(seg)]));
  for (const c of timeline.cutaways) roles.set(c.sceneIndex, "b-roll");
  const shots = scenes.map((p) => ({ n: p.scene, role: roles.get(p.scene) ?? "b-roll", start: p.startSec, end: roundMs(p.startSec + p.seconds) }));
  const read = spawnSync("ffmpeg", motionArgs(out), { encoding: "utf8", maxBuffer: 1 << 28 });
  const motion = read.status === 0 ? readMotion(read.stdout) : [];
  const finished = loudness ? { i: loudness.lufs, tp: loudness.truePeak } : measureLoudness(out);
  const checks = {
    lineMixes: screens ? lineMixes(screens, lineWords(timeline, storyboard)) : null,
    // A song laid whole is the voice and the music at once, so it has no level over a bed.
    voiceOverBedDb: timeline.wholeVoice ? null : voiceOverBed(levels.voiceLufs, levels.bedLufs),
    voiceLufs: levels.voiceLufs,
    bedLufs: levels.bedLufs,
    repeats: repeats(rows.map((r) => ({ w: r.text, s: r.start }))),
    shortShots: shortShots(shots),
    // null: ffmpeg could not read the motion, so no shot was checked.
    slowShots: motion.length ? slowShots(motionByShot(motion, shots)) : null,
    ...(finish?.blipCheck ? { blips: blips(shots.map((s) => ({ ...s, srcSec: sourceShotSec(sourceAd, shotOf(s.n)) }))) } : {}),
    ...(finish?.freezeCheck ? { freezes: freezes(endCard ? motion.filter((r) => r.t < endCard.in / speed) : motion) } : {}),
    ...plan14Checks({ timeline, storyboard, rows, shots, motion, out, finish, cards, speed }),
    lufs: finished ? round2(finished.i) : null,
    truePeak: finished ? round2(finished.tp) : null,
  };
  return { ...checks, verdict: checkVerdict(checks) };
}

const LOUDNORM_TARGET = `I=${FINISH_LUFS}:TP=${FINISH_TRUE_PEAK}:LRA=${FINISH_LRA}`;

/** finishLoudness, pass one: measure a file's sound. Its numbers come back on stderr as JSON. */
export function loudnessMeasureArgs(file) {
  return ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", `loudnorm=${LOUDNORM_TARGET}:print_format=json`, "-f", "null", "-"];
}

/** loudnorm's measured numbers out of its printed JSON, or null when any is missing or not a number (a silent file). */
export function readLoudness(stderr) {
  const block = String(stderr ?? "").match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!block) return null;
  let raw;
  try {
    raw = JSON.parse(block[0]);
  } catch {
    return null;
  }
  const measured = {
    i: Number(raw.input_i), tp: Number(raw.input_tp), lra: Number(raw.input_lra),
    thresh: Number(raw.input_thresh), offset: Number(raw.target_offset),
  };
  return Object.values(measured).every(Number.isFinite) ? measured : null;
}

/**
 * finishLoudness, pass two: the whole mix normalized with pass one's numbers,
 * the picture copied as it is. Without them (pass one could not read the
 * sound) loudnorm runs on its own, in one pass. `limiter` (limitPeaks) runs
 * after it.
 * Every resample after loudnorm is pinned to stereo, which the mix is (each
 * sound joins it through `stereo`). Without the pin Debian's ffmpeg 5.1, the
 * worker's, stops the pass: "Cannot select channel layout for the link between
 * filters". ffmpeg 8 makes the same sound either way.
 */
export function loudnessApplyArgs(mix, measured, out, limiter = null) {
  const second = measured
    ? `:measured_I=${measured.i}:measured_TP=${measured.tp}:measured_LRA=${measured.lra}` +
      `:measured_thresh=${measured.thresh}:offset=${measured.offset}:linear=true`
    : "";
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-i", mix,
    "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
    "-af", `loudnorm=${LOUDNORM_TARGET}${second}${limiter ? `,${limiter}` : ""},${stereo}`,
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  ];
}

/** Why a finished cut is refused for its loudness, or null when its true peak is at or under TRUE_PEAK_MAX_DB. */
export function truePeakRefusal(measured) {
  if (!measured) return "The cut's loudness could not be measured after the loudness pass, so it was not attached";
  if (measured.tp <= TRUE_PEAK_MAX_DB) return null;
  return `The cut's true peak is ${measured.tp.toFixed(2)} dBTP after the loudness pass, over the ${TRUE_PEAK_MAX_DB} dBTP limit, so it was not attached`;
}

function measureLoudness(file) {
  const res = spawnSync("ffmpeg", loudnessMeasureArgs(file), { encoding: "utf8", maxBuffer: 1 << 26 });
  return res.status === 0 ? readLoudness(res.stderr) : null;
}

/** A sound file's loudness pass one, padded to 3 s as LOUDNORM is, so a short sound still measures. */
export function soundLevelArgs(file) {
  return ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-af", `apad=whole_dur=3,loudnorm=${LOUDNORM_TARGET}:print_format=json`, "-f", "null", "-"];
}

function measureLufs(file) {
  const res = spawnSync("ffmpeg", soundLevelArgs(file), { encoding: "utf8", maxBuffer: 1 << 26 });
  const measured = res.status === 0 ? readLoudness(res.stderr) : null;
  return measured ? round2(measured.i) : null;
}

/** ffmpeg's first printed line, as a sentence, or how it stopped when it printed nothing. */
function ffmpegReason(res) {
  const line = String(res.stderr ?? "").split("\n").map((l) => l.trim()).find(Boolean);
  if (line) return /[.!?]$/.test(line) ? line : `${line}.`;
  return res.signal ? `it was stopped by ${res.signal}.` : "it printed no reason.";
}

/** Both passes on the mix, then the finished cut measured again. A receipt may
 * retain that final observation without changing the legacy mastering result. */
export function finishLoudnessPass(mix, out, limiter = null, onMeasured = null) {
  const measured = measureLoudness(mix);
  const args = loudnessApplyArgs(mix, measured, out, limiter);
  const res = spawnSync("ffmpeg", args, { stdio: ["inherit", "inherit", "pipe"], encoding: "utf8", maxBuffer: 1 << 26 });
  if (res.status !== 0) {
    // ffmpeg's words still reach the log, and its reason leads the error:
    // a run keeps only the first 500 characters of a failed cut's message.
    if (res.stderr) process.stderr.write(res.stderr);
    const quoted = args.map((a) => (/[\s\[\];]/.test(a) ? `'${a}'` : a)).join(" ");
    throw new FirstCutError(1, `ffmpeg failed on the loudness pass: ${ffmpegReason(res)} The command it ran:\n  ffmpeg ${quoted}`);
  }
  const finished = measureLoudness(out);
  const refusal = truePeakRefusal(finished);
  if (refusal) throw new LoudnessRefusal(refusal, finished);
  onMeasured?.(finished);
  return { lufs: round2(finished.i), truePeak: round2(finished.tp), passes: measured ? 2 : 1, ...(limiter ? { limited: true } : {}) };
}

/** The filters of `names` this ffmpeg does not have. */
function missingFilters(names) {
  const listed = spawnSync("ffmpeg", ["-hide_banner", "-filters"]).stdout?.toString() ?? "";
  return names.filter((name) => !new RegExp(`^\\s*\\S+\\s+${name}\\s`, "m").test(listed));
}

/** Whether this ffmpeg has a filter (the captions and cards need `subtitles`, which needs libass). */
function hasFilter(name) {
  return missingFilters([name]).length === 0;
}

/**
 * The files the finishing settings write beside the cut: the pace record, the
 * mix before the loudness pass, and the voice and bed cutChecks measures.
 */
export function finishPaths(outPath) {
  const dir = path.dirname(outPath);
  const base = path.basename(outPath, path.extname(outPath));
  return {
    pace: path.join(dir, `${base}.pace.json`),
    mix: path.join(dir, `${base}.mix${path.extname(outPath)}`),
    sound: path.join(dir, `${base}.sound.json`),
    master: path.join(dir, `${base}.music-only${path.extname(outPath)}`),
    voice: path.join(dir, `${base}.voice.wav`),
    bed: path.join(dir, `${base}.bed.wav`),
  };
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

/** finishLoudness: the finished cut's true peak is over TRUE_PEAK_MAX_DB, or could not be measured. */
export class LoudnessRefusal extends FirstCutError {
  constructor(message, measured) {
    super(1, message);
    this.name = "LoudnessRefusal";
    this.measured = measured ?? null;
  }
}

/** The measured map found a required word, frame or tail the cut cannot hold on its real clocks. */
export class SourceMapRefusal extends FirstCutError {
  constructor(message, findings) {
    super(1, message);
    this.name = "SourceMapRefusal";
    this.findings = findings;
  }
}

/** Throws SourceMapRefusal for the map's refusals; its "declared" findings are carried out and recorded. */
function refuseUnholdable(map, deferredScenes = new Set()) {
  const refused = map.findings.filter((f) => f.severity === "refuse" &&
    !(deferredScenes.has(f.scene) && ["action-lead-unproven", "action-tail-unproven"].includes(f.code)));
  if (refused.length === 0) return;
  const lines = refused.map((f) => `  ${f.scene === null ? "cut" : `scene ${f.scene}`}: ${f.code}: ${f.detail}`);
  throw new SourceMapRefusal(
    `The source-to-edit map cannot hold the cut without hiding a clock (no unauthorized speed-up, stretch or frozen frame is used):\n${lines.join("\n")}`,
    refused,
  );
}

/** The decoded clocks of each file, measured once; `files` lists every file read, for the map's byte record. */
function mediaReader(here, exists) {
  const seen = new Map();
  const read = (file) => {
    if (!seen.has(file)) seen.set(file, exists(file) ? measureMedia(here(file)) : null);
    return seen.get(file);
  };
  read.files = () => [...seen.keys()];
  return read;
}

export const sourceMapPath = (outPath) =>
  path.join(path.dirname(outPath), `${path.basename(outPath, path.extname(outPath))}.source-map.json`);

/** A required text/fulfillment obligation cannot be claimed as delivered. */
export class TextFinishRefusal extends FirstCutError {
  constructor(holds) {
    super(1, `The finish is held; no partial cut is delivered:\n${holds.map((h) => `  ${h.id}: ${h.code}: ${h.reason}`).join("\n")}`);
    this.name = "TextFinishRefusal";
    this.holds = holds;
  }
}

// Build Sheet boxes are normalized XYWH; text rendering and sourceAd use XYXY.
// Convert only storyboard-owned geometry. Leave invalid values for the renderer
// to refuse rather than clamping or replacing an authored box.
const storyboardTextBox = (box) => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
  ? [box[0], box[1], box[0] + box[2], box[1] + box[3]] : box;

/** Author-selected geometry is planned layout, not an observation of source pixels. */
export function textMaterial(cut, board, policy) {
  const words = wordRows(cut.timeline);
  const sourceAd = sourceAdOf(cut.manifest);
  const permission = policy.outputPermission;
  const selection = { outputPermission: permission };
  if (permission?.ending) selection.ending = { ...permission.ending };
  const items = [];
  const pictureHolds = [];
  const skippedPictures = [];
  let cardIndex = 0;
  const order = new Map((board.script ?? []).map((line, index) => [line.lineId, index]));
  const ordered = [...(board.overlays ?? [])].sort((a, b) =>
    (order.get(a.cueLineId) ?? Infinity) - (order.get(b.cueLineId) ?? Infinity));
  for (const o of ordered) {
    const authored = o.render ?? {};
    const template = cut.manifest?.templateMotion?.enabled === true;
    // Saved boards can still request a full-frame phone readout. It is an
    // editorial inset, not tracked screen evidence or replacement scene pixels.
    const readoutInset = template && o.proof?.kind === "readout" && (authored.provenance ?? "post") === "post";
    const proof = template ? (readoutInset ? { ...o.proof, presentation: "lower-panel" } : o.proof) : undefined;
    if (PICTURE_OVERLAY.test(o.type ?? "")) {
      const missing = { id: o.overlayId, code: "picture-overlay-undelivered", reason: "the authored screenshot/chart has no delivered selected picture asset; literal text is not a picture substitute" };
      if (authored.required === true) pictureHolds.push(missing);
      else skippedPictures.push(missing);
      continue;
    }
    if (!hasText(o.text) && authored.required !== true) continue;
    const heard = words.filter((w) => w.lineId === o.cueLineId);
    const isHook = o.type === "question-sticker" || /hook/i.test(o.placement ?? "");
    const isEnd = o.overlayId === board.cta?.overlayId && !proof;
    const isOffer = o.type === "offer";
    if (policy.cards === false && !["physical-readout", "authentic-lettering"].includes(authored.provenance)) {
      const missing = { id: o.overlayId, code: "cards-not-selected", reason: "the frozen cards setting is off; permission alone does not select a graphic" };
      if (authored.required === true) pictureHolds.push(missing);
      else skippedPictures.push(missing);
      continue;
    }
    // Only ordinary unboxed cards consume source-reference card geometry.
    // CTA/offer selections and authored boxes have their own layout authority.
    const refBox = authored.box || isEnd || isOffer ? undefined
      : isHook ? sourceAd?.hook?.box : sourceAd?.cards?.[cardIndex++]?.box;
    const item = {
      id: o.overlayId, kind: isHook ? "question-sticker" : "card", text: o.text,
      cueLineId: o.cueLineId,
      ...(proof ? { proof } : {}),
      required: isEnd && !permission?.endCard || isOffer && !permission?.offer
        ? authored.required === true : authored.required !== false,
      provenance: authored.provenance ?? "post",
      ...(readoutInset ? { box: [...READOUT_INSET_BOX] }
        : authored.box !== undefined ? { box: storyboardTextBox(authored.box) } : refBox !== undefined ? { box: refBox } : {}),
      in: authored.startSec ?? (heard.length ? Math.min(...heard.map((w) => w.start)) : undefined),
      out: authored.endSec ?? (heard.length ? Math.max(...heard.map((w) => w.end)) : undefined),
      ...(authored.opening !== undefined ? { opening: authored.opening } : {}),
      ...(authored.value !== undefined ? { value: authored.value } : {}),
      ...(authored.unit !== undefined ? { unit: authored.unit } : {}),
      ...(authored.minReadableSec !== undefined ? { minReadableSec: authored.minReadableSec } : {}),
      layoutOrigin: authored.box ? "approved-board-planned-layout" : refBox ? "source-record-reference-layout" : "missing",
    };
    if (isEnd) {
      if (permission?.endCard) selection.endCard = { ...item, kind: "end" };
      else items.push({ ...item, kind: "end" });
    }
    else if (isOffer) {
      if (permission?.offer) selection.offer = { ...item, kind: "offer", photo: null };
      else items.push({ ...item, kind: "offer" }); // helper skips optional output or holds an explicitly required unauthorized offer
    } else items.push(item);
  }
  // Only trusted template starts migrate to audible-source boundaries.
  // Unstamped mapped runs retain their existing visual-boundary semantics.
  const template = cut.manifest?.templateMotion?.enabled === true;
  const cuts = [];
  if (template) {
    // A muted picture insert does not interrupt a word, nor a whole song.
    for (const seg of cut.timeline.spine) {
      if (seg.wholeVoice) continue;
      cuts.push(seg.startSec, seg.startSec + seg.seconds);
      let removed = 0;
      for (const gap of seg.cuts ?? []) {
        const at = gap.s - removed - (seg.inSec ?? 0);
        if (at > 0 && at < seg.seconds) cuts.push(seg.startSec + at);
        removed += gap.e - gap.s;
      }
    }
    if (policy.captionsByLine === true) {
      for (let i = 1; i < words.length; i++) {
        if (words[i].lineId !== words[i - 1].lineId) cuts.push(words[i].start);
      }
    }
  } else {
    cuts.push(
      ...cut.timeline.spine.flatMap((s) => [s.startSec, s.startSec + s.seconds]),
      ...cut.timeline.cutaways.flatMap((s) => [s.startSec, s.startSec + s.seconds]),
    );
  }
  const captionStyle = {
    ...(sourceAd?.captions ?? {}), ...(board.audio?.captionStyle ?? {}),
    ...(board.audio?.captionStyle?.box !== undefined
      ? { box: storyboardTextBox(board.audio.captionStyle.box), place: undefined } : {}),
  };
  if (template && policy.captions === true && captionStyle.box === undefined) {
    // Source capture already transports the selected caption band as `place`.
    // Without one, use the Skeleton template setup's 0.70–0.80 speech band
    // (video/cards/setup/skeleton-timeline-edit-treatment.md), not an LLM box.
    const band = captionStyle.place ?? [0.70, 0.80];
    captionStyle.box = [0.08, band[0], 0.92, band[1]];
  }
  return {
    treatment: policy.treatment, words, items, selection, pictureHolds, skippedPictures,
    ...(template ? { template: true } : {}),
    captions: {
      on: policy.captions === true,
      keepNumericLists: cut.manifest?.templateMotion?.enabled === true && cut.timeline.narratedShotList === true,
      cap: captionStyle,
      names: (board.cast ?? []).map((c) => c.name).filter(hasText),
      ...(cut.timeline.wholeVoice && !cut.timeline.narratedShotList ? { lyricLines: (board.script ?? []).map((line) => line.text) } : {}),
    },
    cuts: [...new Set(cuts)].sort((a, b) => a - b),
    W: WIDTH, H: HEIGHT, totalSec: (cut.sourceMap?.frames ?? cut.textStage?.frames) / FPS,
  };
}

/** Resolve authored anchors on the actual visible edit and retained word clock, never planning seconds. */
export function resolveTemporalRequirements(cut, board) {
  const words = wordRows(cut.timeline);
  const pictures = sceneTimes(cut.timeline, cut.textStage?.frames !== undefined);
  const requirements = [];
  const owners = [];
  const holds = [];
  const selectedJobs = selectedPictureJobs(cut.manifest, board);
  const covers = (start, end, spans) => {
    let at = start;
    for (const span of spans) {
      if (span.end <= at) continue;
      if (span.start > at + 1e-7) return false;
      at = Math.max(at, span.end);
      if (at >= end - 1e-7) return true;
    }
    return false;
  };
  for (const scene of board.scenes ?? []) {
    const visible = pictures.filter((p) => p.scene === scene.sceneIndex).map((p) => ({ start: p.startSec, end: p.startSec + p.seconds }));
    const anchor = (a) => {
      if (a?.boundary === "scene-start") return visible.length ? visible[0].start : null;
      if (a?.boundary === "scene-end") return visible.length ? visible.at(-1).end : null;
      const heard = words.filter((w) => w.lineId === a?.lineId);
      if (!heard.length) return null;
      return a.edge === "start" ? Math.min(...heard.map((w) => w.start)) : a.edge === "end" ? Math.max(...heard.map((w) => w.end)) : null;
    };
    for (const phase of scene.actionPhases ?? []) {
      const startSec = anchor(phase.window?.start);
      const endSec = anchor(phase.window?.end);
      const invalid = phase.required !== true || !hasText(phase.id) || !hasText(phase.description) ||
        !["contact", "completion", "interior-hold", "living-tail"].includes(phase.kind) ||
        (["contact", "completion"].includes(phase.kind) && (!hasText(phase.before) || !hasText(phase.after))) ||
        requirements.some((p) => p.id === phase.id) ||
        (phase.afterPhaseId && !requirements.some((p) => p.id === phase.afterPhaseId));
      if (invalid || startSec === null || endSec === null || !(endSec > startSec) || !covers(startSec, endSec, visible)) {
        holds.push({ code: "temporal-window-unresolved", id: phase.id ?? `scene:${scene.sceneIndex}`, reason: "the authored phase/state/cue does not resolve to an in-order, fully visible actual edit interval" });
        continue;
      }
      requirements.push({
        id: phase.id, kind: phase.kind, description: phase.description, startSec, endSec,
        ...(selectedJobs
          ? { beatId: selectedJobs.find((job) => job.owners.includes(scene))?.id }
          : scene.planningBeatIds?.length === 1 ? { beatId: scene.planningBeatIds[0] } : {}),
        ...(phase.before !== undefined ? { before: phase.before } : {}),
        ...(phase.after !== undefined ? { after: phase.after } : {}),
        ...(phase.afterPhaseId !== undefined ? { afterPhaseId: phase.afterPhaseId } : {}),
      });
      owners.push({ id: phase.id, sceneIndex: scene.sceneIndex });
    }
  }
  return { requirements, owners, holds };
}

/** A trusted dense receipt must cover this exact authored phase on this exact pre-text source. */
function phasePassed(temporal, id) {
  return temporal?.retention?.status === "pass" && temporal.receipt?.phases.some((phase) => phase.id === id && phase.status === "pass");
}

/** Bind the already rendered unmapped terminal picture to its decoded EOF.
 * Semantic completion still requires the exact-output temporal observer. */
function unmappedTerminalSource(cut, sceneIndex, endFrame, audible = false) {
  if (cut.sourceMap || cut.manifest?.templateMotion?.enabled !== true ||
    !Number.isInteger(endFrame) || cut.textStage?.frames !== endFrame) return null;
  const seg = [...cut.timeline.spine, ...cut.timeline.cutaways].find((entry) =>
    entry.sceneIndex === sceneIndex && entry.source === "clip" && entry.file &&
    !entry.editorialHold && !(entry.holdSec > 0) &&
    Math.abs(entry.startSec + entry.seconds - endFrame / FPS) < 1e-7);
  if (!seg || !audible) return seg ?? null;
  const whole = seg.wholeVoice ? cut.timeline.wholeVoice : null;
  const file = whole?.file ?? (seg.audio === "clip" ? seg.file : seg.audio === "narration" ? seg.voice : null);
  if (!file) return null;
  const audio = clockOf(measureMedia(path.resolve(cut.textStage.dir, file))).audio;
  const end = whole ? endFrame / FPS - whole.startSec : (seg.inSec ?? 0) + seg.seconds;
  return audio && audio.decodedSec + 1 / EDIT_SAMPLE_RATE >= end ? seg : null;
}

/** The canonical line each retained word proves. An explicit lineId, or on a
 * mapped cut its measured source-map line part (wordRows), is authoritative
 * and never corrected: a tagged word its scene does not claim, or that names
 * no script line, holds every line the scene claims. Only Skeleton's measured
 * narration clock tags its words (voiceover.ts); other voice-first narration
 * and Song scene cuts arrive untagged. On an unmapped cut an untagged word is
 * owned by its cut scene: the one line a single-line scene claims, or, on a
 * narration/song route piece, the existing lineParts line map, only when it
 * measures every claimed line and covers every retained word of the piece in
 * order. A line two script entries or two scenes own never takes an untagged
 * word; any word no owner places holds the scene's lines. Native clip words
 * use the same unique single-line scene ownership; untagged multi-line native
 * pieces cannot use a narration line map. */
function spokenWordOwners(timeline, board, located) {
  const owners = located.map(({ row }) => (hasText(row.lineId) ? row.lineId : null));
  const spoiled = new Set();
  if (timeline.mapped) return { owners, spoiled };
  const scriptLines = new Map();
  const entries = new Map();
  for (const line of board?.script ?? []) {
    scriptLines.set(line.lineId, line);
    entries.set(line.lineId, (entries.get(line.lineId) ?? 0) + 1);
  }
  const claims = new Map();
  const claimants = new Map();
  for (const scene of board?.scenes ?? []) {
    if (!Array.isArray(scene.lineIds)) continue;
    const ids = [...new Set(scene.lineIds)];
    claims.set(scene.sceneIndex, ids);
    for (const id of ids) claimants.set(id, (claimants.get(id) ?? 0) + 1);
  }
  const unique = (id, claimed) => claimed.includes(id) && entries.get(id) === 1 && claimants.get(id) === 1;
  const retainedIndexes = new Map();
  for (const { seg, index } of located) {
    if (!retainedIndexes.has(seg)) retainedIndexes.set(seg, []);
    retainedIndexes.get(seg).push(index);
  }
  const partitions = new Map();
  const partition = (seg, claimed) => {
    if (!partitions.has(seg)) {
      const ids = seg.lineIds ?? [];
      const parts = seg.audio === "narration" && ids.length > 0 && ids.every((id) => unique(id, claimed))
        ? lineParts(seg, scriptLines) : null;
      const complete = parts?.every((p) => p.measured) &&
        retainedIndexes.get(seg).every((i) => parts.some((p) => i >= p.firstWord && i <= p.lastWord));
      partitions.set(seg, complete ? parts : null);
    }
    return partitions.get(seg);
  };
  located.forEach(({ seg, index, row }, i) => {
    const claimed = claims.get(row.scene);
    if (!claimed) return;
    if (owners[i] !== null) {
      if (!claimed.includes(owners[i]) || !entries.has(owners[i])) for (const id of [owners[i], ...claimed]) spoiled.add(id);
      return;
    }
    if (!claimed.length) return;
    const owner = claimed.length === 1
      ? (unique(claimed[0], claimed) ? claimed[0] : null)
      : partition(seg, claimed)?.find((p) => index >= p.firstWord && index <= p.lastWord)?.lineId ?? null;
    if (owner) owners[i] = owner;
    else for (const id of claimed) spoiled.add(id);
  });
  return { owners, spoiled };
}

/** One edit frame: frame-rounded in/out points and ASR word edges agree within it. */
const RETAINED_AUDIO_TOLERANCE_SEC = 1 / FPS;

/** The source-clock audio one native piece plays: its in/out points less its sentence-gap cuts. */
function retainedSourceSpans(seg) {
  const from = sourceTimeOf(seg, 0, false);
  const to = sourceTimeOf(seg, seg.seconds, true);
  const spans = [];
  let at = from;
  for (const cut of [...(seg.cuts ?? [])].sort((a, b) => a.s - b.s)) {
    if (cut.e <= at || cut.s >= to) continue;
    if (cut.s > at) spans.push({ start: at, end: cut.s });
    at = Math.max(at, cut.e);
  }
  if (to > at) spans.push({ start: at, end: to });
  return spans;
}

function spansCover(spans, start, end) {
  let at = start;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (at >= end - RETAINED_AUDIO_TOLERANCE_SEC) return true;
    if (span.end <= at) continue;
    if (span.start > at + RETAINED_AUDIO_TOLERANCE_SEC) return false;
    at = Math.max(at, span.end);
  }
  return at >= end - RETAINED_AUDIO_TOLERANCE_SEC;
}

/** Each heard word's sound inside the decoded source; an observation past EOF measures no audio. */
function heardWindows(words, endSec) {
  return (words ?? []).flatMap((word) => {
    const start = Math.max(0, word.s);
    const end = Math.min(endSec, wordEnd(word));
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end }] : [];
  });
}

const envelope = (windows) => windows.length
  ? { start: Math.min(...windows.map((w) => w.start)), end: Math.max(...windows.map((w) => w.end)) } : null;

/** The pre-edit heard words that deliver one line in its scene's source:
 * its tagged words, a single-line claim's untagged words, or a multi-line
 * claim's measured lineParts part; narrowed, as trimJoins does, to the line's
 * first complete scripted delivery when there is one. */
function lineSourceWords(words, claimed, line, scriptLines) {
  const owned = new Set();
  words.forEach((word, i) => {
    if (word.lineId === line.lineId || (!hasText(word.lineId) && claimed.length === 1)) owned.add(i);
  });
  const loose = words.flatMap((word, i) => (hasText(word.lineId) ? [] : [i]));
  if (claimed.length > 1 && loose.length) {
    const part = lineParts({ sceneIndex: 0, lineIds: claimed, words: loose.map((i) => words[i]) }, scriptLines)
      .find((p) => p.lineId === line.lineId && p.measured);
    if (part) for (let k = part.firstWord; k <= part.lastWord; k++) owned.add(loose[k]);
  }
  const own = words.filter((_, i) => owned.has(i));
  const span = own.length ? scriptedSpan(own, [line.text]) : null;
  return span ? own.slice(span.first, span.last + 1) : own;
}

/**
 * Native Omni dialogue and a Suno song master carry ASR words, which can
 * mishear correctly delivered speech. On those template routes a line's proof
 * is its audio: the measured source window of its heard words must survive
 * the actual edit in every scene that claims it. A claiming scene the edit
 * dropped holds. A retained scene where no heard word measures the line has
 * an unknown window (null), never a synthetic whole-take span. Null result on
 * any other route: aligned TTS narration keeps exact-token proof.
 */
function retainedLineAudio(timeline, board, line, scriptLines) {
  const claimants = (board?.scenes ?? []).filter((scene) => Array.isArray(scene.lineIds) && scene.lineIds.includes(line.lineId))
    .map((scene) => ({ claimed: [...new Set(scene.lineIds)], segs: timeline.spine.filter((seg) => seg.sceneIndex === scene.sceneIndex), scene }));
  const all = claimants.flatMap((c) => c.segs);
  if (!all.length) return null;
  const native = all.every((seg) => seg.source === "clip" && seg.audio === "clip" && !seg.wholeVoice && Number.isFinite(seg.sourceSec));
  const asr = timeline.wholeVoice?.asrWords;
  const song = !native && !!asr && all.every((seg) => seg.wholeVoice);
  if (!native && !song) return null;
  const route = song ? "song-asr" : "native-asr";
  const starts = song ? new Map(asr.starts) : null;
  const masterKept = song
    ? [{ start: 0, end: Math.max(...timeline.spine.map((seg) => seg.startSec + seg.seconds)) - timeline.wholeVoice.startSec }] : null;
  let windowRetained = true;
  let wordsRetained = true;
  let unmeasured = false;
  for (const { claimed, segs, scene } of claimants) {
    // A claiming scene the edit dropped keeps none of the line's audio.
    const offset = song ? starts.get(scene.sceneIndex) : 0;
    if (!segs.length || !Number.isFinite(offset)) return { route, windowRetained: false, wordsRetained: false };
    const endSec = song ? asr.seconds : segs[0].sourceSec;
    const words = (segs[0].sourceWords ?? []).map((word) => (song ? { ...word, s: word.s + offset, e: word.e + offset } : word));
    const heard = heardWindows(lineSourceWords(words, claimed, line, scriptLines), endSec);
    if (!heard.length) {
      unmeasured = true;
      continue;
    }
    const kept = song ? masterKept : segs.flatMap(retainedSourceSpans);
    const window = envelope(heard);
    if (!spansCover(kept, window.start, window.end)) windowRetained = false;
    if (!heard.every((w) => spansCover(kept, w.start, w.end))) wordsRetained = false;
  }
  return { route, windowRetained: windowRetained && unmeasured ? null : windowRetained, wordsRetained };
}

/** Approved-line proof shared by every template finish, captions on or off.
 * Aligned (TTS) words prove a line token for token through the words its own
 * owner kept on the final audible route: an unowned, omitted, extra, borrowed
 * or out-of-file word cannot prove it. On a template native or song route the
 * words are ASR: the line holds only when the edit dropped a claiming scene
 * or cut inside its measured audio window (unless the retained heard words
 * are exactly the approved line and every heard word's audio survives).
 * Retained audio heard differently, or a retained scene where no heard word
 * measures the line, is an advisory note for clip QC. No model call. */
function spokenLineFulfillment(timeline, board, template = false) {
  const located = segmentWordRows(timeline);
  const words = located.map(({ row }) => row);
  const { owners, spoiled } = spokenWordOwners(timeline, board, located);
  const scriptLines = new Map((board?.script ?? []).map((line) => [line.lineId, line]));
  const entries = new Map();
  for (const line of board?.script ?? []) entries.set(line.lineId, (entries.get(line.lineId) ?? 0) + 1);
  const holds = [];
  const lines = [];
  const notes = [];
  for (const line of board?.script ?? []) {
    const kept = words.filter((_, i) => owners[i] === line.lineId);
    const scripted = spokenTokens(scriptWords(line.text));
    const retained = spokenTokens(scriptWords(kept.map((w) => w.text).join(" ")));
    // Reuse exact split/join normalization, without fuzzy-name or misheard
    // substitutions. Compare every retained token within this canonical owner:
    // ownership alone cannot excuse omitted, extra or borrowed words.
    const heard = joinSplitWords(retained, scripted.tokens);
    const expected = joinSplitWords(scripted, heard.tokens);
    const exact = !spoiled.has(line.lineId) && expected.tokens.length === heard.tokens.length &&
      expected.tokens.every((token, i) => token === heard.tokens[i]);
    // An approved line two script entries name has no single identity to retain.
    const audio = template && entries.get(line.lineId) === 1 ? retainedLineAudio(timeline, board, line, scriptLines) : null;
    const proven = audio ? audio.windowRetained !== false || (exact && audio.wordsRetained) : exact;
    const source = audio?.route === "song-asr" ? "song master" : "native source";
    lines.push({ lineId: line.lineId, sourceSpan: line.sourceSpan ?? null, retained: kept.map((w) => w.text), exactCanonicalWords: exact,
      ...(audio ? { audioRoute: audio.route, audioWindowRetained: audio.windowRetained } : {}) });
    if (!proven) {
      holds.push({ code: "required-words-not-retained", id: line.lineId, reason: audio
        ? `the actual edit dropped or cut inside the approved line's measured ${source} audio window: ${line.text}`
        : `the final audible route does not retain the complete approved line: ${line.text}` });
    } else if (!exact) {
      notes.push(`asr-wording-advisory: ${line.lineId}: ${audio.windowRetained === null
        ? `no heard word measures its ${source} audio window on the retained take, so the window is unknown, not shown removed`
        : `the edit retains its complete measured ${source} audio window`}; ` +
        `ASR heard "${kept.map((w) => w.text).join(" ")}" for approved "${line.text}"; clip QC owns speech quality`);
    }
  }
  return { words, lines, holds, notes };
}

/** Required spoken lines are checked against what the route-owned track retained, not proportional scene durations. */
export function finishFulfillment(cut, board, policy, temporal = null) {
  const { words, lines, holds, notes } = spokenLineFulfillment(cut.timeline, board, cut.manifest?.templateMotion?.enabled === true);
  const linesProven = holds.length === 0;
  const proofOverlays = board.overlays ?? [];
  const beats = [];
  const selectedJobs = selectedPictureJobs(cut.manifest, board, policy.planningBudget);
  const planned = selectedJobs ?? policy.planningBudget?.beats ?? [];
  // Template scene prose is a generation direction, not an authored temporal
  // observation contract. Explicit phases and handles still require proof.
  const authoredActionsOnly = cut.manifest?.templateMotion?.enabled === true;
  const hasAuthoredAction = scene => scene.actionPhases?.length > 0 || scene.actionLeadSec > 0 || scene.actionTailSec > 0;
  const narratedReservations = cut.timeline.reservedNarration === true;
  for (const beat of planned) {
    const owners = selectedJobs ? beat.owners : (board.scenes ?? []).filter((s) => s.planningBeatIds?.includes(beat.id));
    const windows = sceneTimes(cut.timeline, cut.textStage?.frames !== undefined).filter((s) => owners.some((o) => o.sceneIndex === s.scene))
      .map((s) => ({ start: s.startSec, end: s.startSec + s.seconds }));
    const seconds = windows.reduce((sum, w) => sum + w.end - w.start, 0);
    const reserved = selectedJobs ? beat.reservedSeconds : beat.silent?.seconds ?? beat.picture?.seconds ?? null;
    // The receipt retains its authored reservation. Short sources lower only
    // the retention floor; shortening available reserved footage still holds.
    const ownedSegments = cut.timeline.spine.filter((seg) => owners.some((owner) => owner.sceneIndex === seg.sceneIndex));
    const nativeReservation = cut.manifest?.templateMotion?.enabled === true && ownedSegments.length > 0 &&
      ownedSegments.every((seg) => seg.source === "clip" && seg.audio === "clip" && !seg.wholeVoice);
    let footage = narratedReservations ? ownedSegments
      .reduce((sum, seg) => sum + floorFrame(Math.max(0, (seg.clipSeconds ?? 0) - (seg.inSec ?? 0))), 0) : null;
    if (nativeReservation) {
      // Split pieces share one source EOF: count each take's available picture
      // once, not the same tail again for every resumed piece. A recorded
      // template speech edit deliberately keeps only its own span of the take.
      const takes = new Map();
      for (const seg of ownedSegments) {
        const source = Math.max(0, seg.clipSeconds - seg.inSec);
        const speech = seg.templateSpeech ? Math.max(0, seg.templateSpeech.tailSec - seg.templateSpeech.headSec) : Infinity;
        const available = floorFrame(Math.min(source, speech));
        takes.set(seg.sceneIndex, Math.max(takes.get(seg.sceneIndex) ?? 0, available));
      }
      footage = [...takes.values()].reduce((sum, seconds) => sum + seconds, 0);
    }
    const floor = footage === null ? reserved : Math.min(reserved, footage);
    const retained = owners.length > 0 && windows.length > 0 && seconds > 0 && (floor === null || seconds * FPS + 1e-6 >= Math.ceil(floor * FPS - 1e-6));
    const pictureAction = beat.picture?.binding === "concrete"
      ? board.pictureBindings?.find((binding) => binding.beatId === beat.id)?.picture?.action
      : beat.picture?.action;
    const needsAction = selectedJobs
      ? owners.some((scene) => authoredActionsOnly ? hasAuthoredAction(scene) : narratedReservations ? scene.actionPhases?.length > 0 : hasText(scene.subjectAction) || hasText(scene.videoPrompt))
      : Boolean(beat.picture?.action) && (!authoredActionsOnly || owners.some(hasAuthoredAction));
    const observed = owners.length > 0 && owners.every((scene) => {
      if (authoredActionsOnly ? !hasAuthoredAction(scene) : narratedReservations && !scene.actionPhases?.length) return true;
      const actualAction = selectedJobs ? scene.subjectAction || scene.videoPrompt : pictureAction;
      const phases = temporal?.owners?.filter((owner) => owner.sceneIndex === scene.sceneIndex) ?? [];
      return phases.length > 0 && phases.every((phase) => phasePassed(temporal, phase.id)) &&
        (!needsAction || hasText(actualAction) && temporal.requirements.some((phase) =>
          phase.description.trim() === actualAction.trim() && phases.some((owner) => owner.id === phase.id) && phasePassed(temporal, phase.id)));
    });
    beats.push({ id: beat.id, windows, seconds, reservedSeconds: reserved, retained, action: needsAction ? observed ? "observed" : "not-temporally-observed" : "not-asked" });
    if (!retained) holds.push({ code: "required-beat-not-retained", id: beat.id, reason: "the required picture/action/hold reservation is missing or shortened in the actual edit" });
    if (needsAction && !observed) holds.push({ code: "required-action-unobserved", id: beat.id, reason: "no exact-source dense observation proves the authored contact/completion/hold/tail phases" });
    if (beat.picture?.finalWordTailSec > 0) {
      const owner = finalWordTailScene(board, beat);
      const endFrame = cut.sourceMap?.frames ?? cut.textStage?.frames;
      const endSec = endFrame / FPS;
      const finalWord = words.length ? Math.max(...words.map((word) => word.end)) : null;
      const finalPiece = owner && cut.sourceMap?.pieces?.find((piece) =>
        piece.sceneIndex === owner.sceneIndex && piece.edit.startFrame + piece.edit.frames === endFrame &&
        piece.picture && !piece.picture.editorialHold && piece.picture.heldFrames === 0 &&
        piece.sound && piece.sound.tailSilenceSamples === 0 && ["clip", "narration"].includes(piece.route.audio));
      const finalSource = owner && unmappedTerminalSource(cut, owner.sceneIndex, endFrame, true);
      const finalOwnedWord = finalWord !== null && words.some((word) =>
        word.scene === owner?.sceneIndex && Math.abs(word.end - finalWord) < 1e-7);
      const visibleTail = finalWord !== null && sceneTimes(cut.timeline, cut.textStage?.frames !== undefined).some((window) =>
        window.scene === owner?.sceneIndex && window.startSec <= finalWord + 1e-7 &&
        window.startSec + window.seconds >= endSec - 1e-7);
      const livingTail = temporal?.requirements?.some((phase) =>
        phase.kind === "living-tail" && hasText(pictureAction) && phase.description.trim() === pictureAction.trim() &&
        temporal.owners?.some((binding) => binding.id === phase.id && binding.sceneIndex === owner?.sceneIndex) &&
        finalWord !== null && Math.abs(phase.startSec - finalWord) < 1e-6 &&
        Math.abs(phase.endSec - endSec) < 1e-6 && phasePassed(temporal, phase.id));
      if (!(finalPiece || finalSource) || !finalOwnedWord || !visibleTail || !livingTail ||
        (finalPiece ? finalPiece.edit.startFrame / FPS : finalSource?.startSec ?? Infinity) > finalWord + 1e-7 ||
        endSec - finalWord + 1e-7 < beat.picture.finalWordTailSec) {
        holds.push({ code: "final-word-tail-unproven", id: beat.id,
          reason: `the selected living suffix requires at least ${beat.picture.finalWordTailSec}s after the complete final heard word inside the same final voiced take, fully visible through EOF with exact-source living-tail observation; no appended silent picture or frozen fill` });
      }
    }
  }
  let ending = { status: "unselected" };
  if (policy.outputPermission?.ending?.mode === "native") {
    const terminalBeat = planned.at(-1);
    const owners = selectedJobs ? terminalBeat?.owners ?? []
      : (board.scenes ?? []).filter((scene) => scene.planningBeatIds?.includes(terminalBeat?.id));
    const owner = selectedJobs ? owners.at(-1) ?? null : owners.length === 1 ? owners[0] : null;
    const visible = sceneTimes(cut.timeline, cut.textStage?.frames !== undefined);
    const last = visible.at(-1);
    const endFrame = cut.sourceMap?.frames ?? cut.textStage?.frames;
    const endSec = endFrame / FPS;
    const spans = owner ? visible.filter((span) => span.scene === owner.sceneIndex) : [];
    const uninterrupted = spans.length === 1 && last === spans[0] &&
      Math.abs(last.startSec + last.seconds - endSec) < 1e-7;
    const terminalPiece = owner && cut.sourceMap?.pieces?.find((piece) =>
      piece.sceneIndex === owner.sceneIndex && piece.picture && piece.edit.startFrame + piece.edit.frames === endFrame);
    const terminalOverlay = owner && cut.sourceMap?.overlays?.find((overlay) =>
      overlay.scene === owner.sceneIndex && overlay.picture && overlay.startFrame + overlay.frames === endFrame);
    const held = terminalPiece?.picture?.editorialHold;
    const predecessor = held && cut.sourceMap.pieces.find((piece) =>
      piece.sceneIndex === held.sourceSceneIndex && piece.edit.startFrame + piece.edit.frames === terminalPiece.edit.startFrame);
    const heldProven = !!held && !!predecessor && policy.outputPermission.ending.kind === "editorial-hold" &&
      predecessor.picture?.lastFrame === held.sourceFrame &&
      predecessor.picture?.lastSlot === held.sourceSlot;
    const releaseScene = heldProven ? held.sourceSceneIndex : owner?.sceneIndex;
    const releaseEnd = heldProven ? terminalPiece.edit.startFrame / FPS : endSec;
    const releaseStart = heldProven ? predecessor.edit.startFrame / FPS : last?.startSec ?? Infinity;
    const release = owner && temporal?.requirements?.find((phase) =>
      (heldProven ? phase.kind === "completion" : ["completion", "living-tail", "interior-hold"].includes(phase.kind)) &&
      temporal.owners?.some((binding) => binding.id === phase.id && binding.sceneIndex === releaseScene) &&
      phase.startSec >= releaseStart - 1e-7 && Math.abs(phase.endSec - releaseEnd) < 1e-7 &&
      phasePassed(temporal, phase.id));
    // Template/narration boards have no release contract unless authored.
    // Retained terminal picture and words remain mandatory on every route.
    const needsRelease = (!authoredActionsOnly && !narratedReservations) || (board.scenes ?? []).some((scene) =>
      scene.sceneIndex === releaseScene && (authoredActionsOnly ? hasAuthoredAction(scene) : scene.actionPhases?.length > 0));
    const retainedPicture = cut.sourceMap
      ? !!(terminalPiece || terminalOverlay) && (policy.outputPermission.ending.kind === "editorial-hold" ? heldProven : !held)
      : policy.outputPermission.ending.kind !== "editorial-hold" && !!owner && !!unmappedTerminalSource(cut, owner.sceneIndex, endFrame);
    const fulfilled = !!terminalBeat && uninterrupted && (!needsRelease || !!release) && !!retainedPicture &&
      linesProven;
    ending = { kind: policy.outputPermission.ending.kind, status: fulfilled ? "fulfilled" : "hold",
      beatId: terminalBeat?.id ?? null, sceneIndex: owner?.sceneIndex ?? null,
      startFrame: last ? Math.round(last.startSec * FPS) : null, endFrame: endFrame ?? null,
      phaseId: release?.id ?? null };
    if (!fulfilled) holds.push({ code: "native-ending-unproven", id: terminalBeat?.id ?? "ending",
      reason: "native permission is not fulfillment: the selected terminal job must be the uninterrupted final retained picture through decoded EOF, with every approved line proven retained and any required exact-source completion/release proof" });
  }
  if (cut.manifest?.templateMotion?.enabled === true) for (const overlay of proofOverlays) {
    const phaseId = overlay.proof?.actionPhaseId;
    if (phaseId && !phasePassed(temporal, phaseId)) holds.push({ code: "proof-action-unobserved", id: overlay.overlayId,
      reason: "the insert's authored picture-action dependency lacks exact-source observation" });
  }
  for (const phase of temporal?.requirements ?? []) {
    if (!phasePassed(temporal, phase.id)) holds.push({ code: "temporal-observation-unproven", id: phase.id, reason: temporal.receipt?.phases.find((p) => p.id === phase.id)?.reason ?? "the required temporal phase was not observed on this exact source" });
  }
  holds.push(...(temporal?.holds ?? []));
  const resolvedPlanningFindings = [];
  for (const piece of cut.sourceMap?.pieces ?? []) {
    for (const side of ["lead", "tail"]) {
      const action = piece.action?.[side];
      if (!action || action.status !== "unproven") continue;
      const heard = words.filter((w) => w.scene === piece.sceneIndex);
      const start = piece.edit.startFrame / FPS;
      const end = (piece.edit.startFrame + piece.edit.frames) / FPS;
      const wordStart = heard.length ? Math.min(...heard.map((w) => w.start)) : start + action.wantedSec;
      const wordEnd = heard.length ? Math.max(...heard.map((w) => w.end)) : end - action.wantedSec;
      const requiredStart = side === "lead" ? wordStart - action.wantedSec : wordEnd;
      const requiredEnd = side === "lead" ? wordStart : wordEnd + action.wantedSec;
      const phase = temporal?.requirements.find((p) =>
        temporal.owners.some((owner) => owner.id === p.id && owner.sceneIndex === piece.sceneIndex) &&
        p.startSec <= requiredStart + 1e-7 && p.endSec >= requiredEnd - 1e-7 && phasePassed(temporal, p.id));
      if (!phase) holds.push({ code: `action-${side}-unobserved`, id: `scene:${piece.sceneIndex}`, reason: "the required action handle has no complete exact-source temporal observation" });
      else resolvedPlanningFindings.push({ scene: piece.sceneIndex, code: `action-${side}-unproven`, phaseId: phase.id });
    }
  }
  return { ok: holds.length === 0, lines, beats, ending, holds, resolvedPlanningFindings, notes };
}

/** Unknown screen geometry cannot license a post graphic over reserved acting. */
function protectDirectorGraphics(text, cut, board, notes) {
  if (!(board.scenes ?? []).some((s) => s.directorBeats?.length || s.actionPhases?.some((p) => p.required))) return;
  const { reservations } = directorCutProjection(cut, board);
  if (!reservations.length) return;
  const protect = (card) => {
    if (!card) return card;
    const clock = textFrameWindow(card.in, card.out);
    let spans = [{ from: clock.startFrame, to: clock.startFrame + clock.frames }];
    for (const reservation of reservations) {
      const from = Math.floor(reservation.startSec * FPS + 1e-7), to = Math.ceil(reservation.endSec * FPS - 1e-7);
      spans = spans.flatMap((span) => to <= span.from || from >= span.to ? [span]
        : [{ from: span.from, to: from }, { from: to, to: span.to }].filter((s) => s.to > s.from));
    }
    const safe = spans.sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
    if (safe?.from === clock.startFrame && safe.to === clock.startFrame + clock.frames) return card;
    notes.push(`director-graphic-${safe ? "rescheduled" : "omitted"}: ${card.id}: post graphic ${safe ? "moved outside" : "omitted for"} reserved acting; no screen tracking is claimed`);
    if (!safe) {
      text.skipped.push({ id: card.id, code: "director-graphic-omitted", reason: "no clear graphic interval remains outside reserved acting" });
      return null;
    }
    return { ...card, in: safe.from / FPS, out: safe.to / FPS };
  };
  text.directives.cards = text.directives.cards.map(protect).filter(Boolean);
  text.directives.hook = protect(text.directives.hook);
  text.directives.endCard = protect(text.directives.endCard);
}

/**
 * Completes a prepared, already transformed cut. Async observer sees exactly
 * that file's bytes. No scene is re-cut under its receipt; the second pass
 * changes only pixels via ASS and STREAM-COPIES its already finished audio.
 */
export async function completeFirstCutText(cut, { out, prepareReadoutVerifier, observeTemporalAction, checkTemporalRetention, renderer: suppliedRenderer } = {}) {
  if (!cut.textStage || (!cut.sourceMap?.render && cut.manifest?.templateMotion?.enabled !== true)) {
    throw new FirstCutError(1, "Text completion requires the prepared mapped or trusted Template pre-text artifact");
  }
  if (cut.finishEvidence?.provenance.complete === false) {
    throw new SourceMapRefusal("A partial join cannot be promoted to a final cut", [
      { severity: "refuse", code: "partial-not-final", scene: null, detail: `missing/skipped scenes: ${cut.finishEvidence.provenance.missingSceneIndexes.join(", ")}` },
    ]);
  }
  const originalTimeline = cut.timeline;
  const prepared = cut.sourceMap ? null : renderFindings(null, measureMedia(cut.out));
  if (prepared?.findings.some((finding) => finding.severity === "refuse")) {
    throw new SourceMapRefusal("The prepared native/song cut has no usable decoded clock", prepared.findings);
  }
  if (prepared) {
    const speed = cut.textStage.speed ?? 1;
    const scale = (seg) => ({
      ...seg, startSec: seg.startSec / speed, seconds: seg.seconds / speed, inSec: (seg.inSec ?? 0) / speed,
      ...(seg.words ? { words: seg.words.map((word) => ({
        ...word, s: word.s / speed, e: word.e / speed,
        ...(Number.isFinite(word.phoneEndAfterSec) ? { phoneEndAfterSec: word.phoneEndAfterSec / speed } : {}),
      })) } : {}),
      ...(seg.cuts ? { cuts: seg.cuts.map((gap) => ({ ...gap, s: gap.s / speed, e: gap.e / speed })) } : {}),
    });
    cut = {
      ...cut, textStage: { ...cut.textStage, frames: prepared.render.frames },
      ...(speed !== 1 ? { timeline: { ...cut.timeline, spine: cut.timeline.spine.map(scale), cutaways: cut.timeline.cutaways.map(scale) } } : {}),
    };
  }
  const { dir, board, policy } = cut.textStage;
  if (!board || !Array.isArray(board.scenes)) throw new TextFinishRefusal([{ code: "approved-board-missing", id: "cut", reason: "the approved board is required to retain selected words, actions and text" }]);
  const material = textMaterial(cut, board, policy);
  const template = cut.manifest?.templateMotion?.enabled === true;
  const finishNotes = [];
  let fulfillment = finishFulfillment(cut, board, policy);
  const needsRaster = material.captions.on || material.items.some((item) => !["physical-readout", "authentic-lettering"].includes(item.provenance)) ||
    material.selection.endCard || material.selection.offer;
  const renderer = suppliedRenderer ?? (needsRaster
    ? createTextRenderer({ dir, W: WIDTH, H: HEIGHT })
    : { libass: false, measureText: undefined });
  const sourceBytes = readFileSync(cut.out);
  const source = { id: `${cut.manifest.runId ?? "cut"}:pre-text`, sha256: createHash("sha256").update(sourceBytes).digest("hex") };
  const resolved = resolveTemporalRequirements(cut, board);
  let receipt = null;
  let retention = null;
  const wordOrPictureMissing = fulfillment.holds.some((h) => ["required-words-not-retained", "required-beat-not-retained"].includes(h.code));
  if (!wordOrPictureMissing && !resolved.holds.length && resolved.requirements.length && observeTemporalAction && checkTemporalRetention) {
    receipt = await observeTemporalAction({ source, sourceBytes, requirements: resolved.requirements, approvedContext: board });
    retention = checkTemporalRetention({
      receipt, source, requirements: resolved.requirements, approvedContext: board, spans: [{ in: 0, out: material.totalSec }],
    });
  }
  const temporal = { ...resolved, receipt, retention };
  fulfillment = finishFulfillment(cut, board, policy, temporal);
  finishNotes.push(...fulfillment.notes);
  const selectedItems = [
    ...material.items,
    ...(material.selection.endCard ? [{ ...material.selection.endCard, id: "end-card" }] : []),
    ...(material.selection.offer ? [{ ...material.selection.offer, id: "offer" }] : []),
  ];
  const observedItems = selectedItems.filter((item) => ["physical-readout", "authentic-lettering"].includes(item.provenance));
  const verifyObservation = !fulfillment.holds.length && observedItems.length && prepareReadoutVerifier
    ? await prepareReadoutVerifier({
        source, sourceBytes, items: observedItems,
        heardWords: material.words.map((w) => ({ word: w.text, start: w.start, end: w.end, cueLineId: w.lineId ?? undefined })),
      })
    : undefined;
  let text = planText({
    ...material, libass: renderer.libass, measureText: renderer.measureText,
    source, verifyObservation, inheritedHolds: [...fulfillment.holds, ...material.pictureHolds],
  });
  if (template && text.holds.length) {
    // Reflow local post-owned presentation without altering literal content,
    // source evidence, the audible spine or the selected output permissions.
    const layoutCodes = ["geometry-missing", "geometry-invalid", "geometry-blocked", "text-overflow",
      "caption-geometry", "timing-out-of-range", "text-timing", "text-slot-conflict", "word-crosses-cut"];
    if (text.holds.some((hold) => layoutCodes.includes(hold.code))) {
      const repair = (item, index = 0) => {
        if (!item || ["physical-readout", "authentic-lettering"].includes(item.provenance)) return item;
        const box = item.proof?.kind === "readout" ? [...READOUT_INSET_BOX]
          : item.proof?.presentation === "lower-panel" ? [0.08, 0.70, 0.92, 0.95]
            : [0.08, 0.08 + (index % 3) * 0.18, 0.92, 0.24 + (index % 3) * 0.18];
        const start = Math.min(material.totalSec - 1 / FPS, Math.max(0, item.in ?? 0));
        return { ...item, box, in: start,
          out: Math.max(start + 1 / FPS, Math.min(material.totalSec, item.out ?? material.totalSec)), minReadableSec: undefined };
      };
      material.captions.cap = { ...material.captions.cap, box: [0.08, 0.70, 0.92, 0.92], place: undefined };
      const repaired = planText({
        ...material, items: material.items.map(repair),
        selection: { ...material.selection,
          ...(material.selection.endCard ? { endCard: repair(material.selection.endCard) } : {}),
          ...(material.selection.offer ? { offer: repair(material.selection.offer) } : {}) },
        captions: material.captions,
        libass: renderer.libass, measureText: renderer.measureText, source, verifyObservation,
        inheritedHolds: [...fulfillment.holds, ...material.pictureHolds],
      });
      finishNotes.push(...text.holds.filter((hold) => layoutCodes.includes(hold.code)).map((hold) => `${hold.code}: ${hold.reason}; local text reflow attempted`));
      text = repaired;
    }
  }
  if (template) protectDirectorGraphics(text, cut, board, finishNotes);
  text.skipped.push(...material.skippedPictures);
  const directives = text.directives;
  const clocked = [
    ...directives.captions.map((caption, i) => ({ id: `caption:${i}`, start: caption.s, end: caption.e })),
    ...[...directives.cards, directives.hook, directives.endCard].filter(Boolean).map((card) => ({ id: card.id, start: card.in, end: card.out })),
  ];
  for (const item of clocked) {
    const frames = textFrameWindow(item.start, item.end).frames;
    const minimum = selectedItems.find((selected) => selected.id === item.id)?.minReadableSec;
    if (frames < 1 || (Number.isFinite(minimum) && frames / FPS + 1e-9 < minimum)) {
      text.ok = false;
      text.holds.push({ code: "text-frame-window-invalid", id: item.id, reason: "the exact delivered frame interval cannot meet the authored text window/readability; no text clock is extended" });
    }
  }
  const destination = path.resolve(out ?? path.join(dir, "cut.mp4"));
  const reportPath = destination.replace(/\.[^.]+$/, "") + ".text.json";
  writeFileSync(reportPath, `${JSON.stringify({ source, text, fulfillment, temporal }, null, 2)}\n`);
  if (!text.ok) throw new TextFinishRefusal(text.holds);
  if (destination === path.resolve(cut.out)) throw new FirstCutError(1, "The text output must differ from its immutable observed pre-text source");
  const ass = ".final-text.ass";
  const assPath = path.join(dir, ass);
  const hasBurn = directives.captions.length || directives.cards.length || directives.hook || directives.endCard;
  let assSha256 = null;
  try {
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", cut.out];
    if (hasBurn) {
      if (renderer.assertFont && !renderer.assertFont()) throw new TextFinishRefusal([{ code: "font-changed", id: "text", reason: "the resolved measured font changed before the final burn" }]);
      let assContent;
      try {
        assContent = measuredTextAss(directives, { W: WIDTH, H: HEIGHT, style: material.captions.cap?.style });
      } catch (error) {
        throw new TextFinishRefusal([{ code: "text-frame-window-invalid", id: "burn", reason: error.message }]);
      }
      assSha256 = createHash("sha256").update(assContent).digest("hex");
      writeFileSync(assPath, assContent);
      args.push("-vf", `subtitles=filename=${ass}`, "-c:v", "libx264", "-preset", "medium", "-crf", "20");
    } else args.push("-c:v", "copy");
    // Never resample/re-encode/remix sound or reset PTS under an observation.
    args.push("-map", "0:v:0", "-map", "0:a:0", "-c:a", "copy", "-movflags", "+faststart", destination);
    if (spawnSync("ffmpeg", args, { cwd: dir, stdio: "inherit" }).status !== 0) throw new FirstCutError(1, "The measured same-file ASS burn failed; no plain-cut fallback is delivered");
  } finally { rmSync(assPath, { force: true }); }
  // Check source immutability and the actual target's clocks after the ONLY
  // subsequent transform. The audio stream is copied, not AAC-encoded again.
  if (createHash("sha256").update(readFileSync(cut.out)).digest("hex") !== source.sha256) throw new FirstCutError(1, "The pre-text source changed while its observation was being used");
  const { findings, render, planningTiming } = renderFindings(cut.sourceMap, measureMedia(destination), policy.planningBudget);
  if (prepared && (render.frames !== prepared.render.frames || render.samples !== prepared.render.samples ||
    render.soundStartSamples !== prepared.render.soundStartSamples)) {
    findings.push({ severity: "refuse", code: "text-render-clock-changed", scene: null, detail: "the native/song text burn changed its prepared picture or copied-audio clock" });
  }
  if (!cut.sourceMap && findings.some((finding) => finding.severity === "refuse")) {
    throw new SourceMapRefusal("The native/song text finish cannot retain its exact prepared clock", findings);
  }
  if (cut.sourceMap) {
    cut.sourceMap.findings.push(...findings);
    cut.sourceMap.render = render;
    if (planningTiming) cut.sourceMap.planningTiming = planningTiming;
    const rasters = [
      ...directives.captions.map((c, i) => ({ ...c, id: `caption:${i}`, kind: "caption", startSec: c.s, endSec: c.e, renderBox: material.captions.cap?.box })),
      ...[...directives.cards, directives.hook, directives.endCard].filter(Boolean).map((c) => ({ ...c, startSec: c.in, endSec: c.out })),
    ].map((entry) => {
      const { lines, ...measurement } = entry.measurement;
      return {
        id: entry.id, kind: entry.kind, startSec: entry.startSec, endSec: entry.endSec,
        renderBox: entry.renderBox, box: entry.box, fs: entry.fs,
        textSha256: createHash("sha256").update(JSON.stringify(entry.lines)).digest("hex"), measurement,
        raster: textFrameWindow(entry.startSec, entry.endSec),
      };
    });
    cut.sourceMap.text = {
      source, report: path.basename(reportPath), permissions: text.permissions, fulfillment,
      styleVersion: "literal-ass.v1", assSha256, rasters, readouts: text.readouts,
    };
    const planningResolved = (finding) => fulfillment.resolvedPlanningFindings.some((p) => p.scene === finding.scene && p.code === finding.code);
    cut.sourceMap.semanticPlanningFindings = cut.sourceMap.findings.filter(planningResolved);
    cut.sourceMap.findings = cut.sourceMap.findings.filter((finding) => !planningResolved(finding));
    cut.sourceMap.temporal = temporal;
    try {
      cut.sourceMap.final = { sha256: createHash("sha256").update(readFileSync(destination)).digest("hex") };
    } catch (error) {
      if (!planningTiming) throw error;
      delete cut.sourceMap.final;
      planningTiming.status = "unknown";
      planningTiming.decoded = null;
      cut.sourceMap.findings.push({ severity: "refuse", code: "planning-budget-clock-unmeasured", scene: null, detail: "the actual final bytes could not be hashed, so the final decoded timing is not byte-bound" });
    }
    if (planningTiming) planningTiming.finalSha256 = cut.sourceMap.final?.sha256 ?? null;
    const mapSidecar = sourceMapPath(destination);
    refuseUnholdable(cut.sourceMap);
    writeFileSync(mapSidecar, `${JSON.stringify(cut.sourceMap, null, 2)}\n`);
  }
  const sidecars = { ...sidecarPaths(destination), ...(cut.sourceMap ? { sourceMap: sourceMapPath(destination) } : {}), text: reportPath };
  if (!cut.sourceMap && planningTiming) planningTiming.finalSha256 = createHash("sha256").update(readFileSync(destination)).digest("hex");
  writeFileSync(sidecars.words, `${JSON.stringify(material.words, null, 2)}\n`);
  writeFileSync(sidecars.scenes, `${JSON.stringify(sceneTimes(cut.timeline, cut.textStage?.frames !== undefined), null, 2)}\n`);
  writeFileSync(sidecars.srt, toSrt(material.words));
  const { textStage, ...finished } = cut;
  const paths = finishPaths(destination);
  if (cut.musicOnlyMaster) {
    // Preserve the selected alternate audio, but pair it with the SAME final
    // text pixels, rather than exporting stale pre-text pictures.
    const args = [
      "-y", "-hide_banner", "-loglevel", "error", "-i", destination, "-i", cut.musicOnlyMaster,
      "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart", paths.master,
    ];
    if (spawnSync("ffmpeg", args, { stdio: "inherit" }).status !== 0) throw new FirstCutError(1, "The selected music-only master's final picture copy failed");
    finished.musicOnlyMaster = paths.master;
    if (finished.sound) finished.sound = { ...finished.sound, master: path.basename(paths.master) };
  }
  if (finished.pace) writeFileSync(paths.pace, `${JSON.stringify(finished.pace, null, 2)}\n`);
  if (finished.sound) writeFileSync(paths.sound, `${JSON.stringify(finished.sound, null, 2)}\n`);
  if (cut.finishEvidence) {
    // The text pass stream-copies sound; its word/loudness evidence is unchanged,
    // but the final picture bytes must never inherit the pre-text identity.
    const bytes = readFileSync(destination);
    finished.finishEvidence = {
      ...cut.finishEvidence,
      provenance: { ...cut.finishEvidence.provenance, kind: "final", isFinal: true },
      artifact: { file: path.basename(destination), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length },
    };
    sidecars.finish = destination.replace(/\.[^.]+$/, "") + ".finish.json";
    writeFileSync(sidecars.finish, `${JSON.stringify(finished.finishEvidence, null, 2)}\n`);
  }
  return {
    ...finished, timeline: originalTimeline, out: destination,
    durationSec: (cut.sourceMap?.frames ?? render.frames) / FPS,
    ...(cut.sourceMap ? { sourceMap: cut.sourceMap } : {}),
    ...(!cut.sourceMap && planningTiming ? { planningTiming } : {}),
    sidecars, text, notes: [...(cut.notes ?? []), ...new Set(finishNotes)],
  };
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
 * A byte-bound assembly receipt, not a new ASR observation or product-quality
 * verdict. Source-sidecar words follow the actual audible route through the edit;
 * unknown/unmeasurable evidence is explicit, including on refused partial pulls.
 */
function cutFinishEvidence({ manifest, storyboard, timeline = null, skip = new Set(), exists, readWords, out = null, preText = false, loudnessMeasurement = null }) {
  const planned = [...scenePlans(storyboard).keys()];
  const expected = planned.length ? planned : (manifest.scenes ?? []).map((s) => s.sceneIndex);
  const missing = scenesWithNoClip({ manifest, storyboard, skip: new Set(), exists });
  const retained = new Set(timeline ? [...timeline.spine, ...timeline.cutaways].filter((s) => s.seconds > 0).map((s) => s.sceneIndex) : []);
  const skippedSceneIndexes = expected.filter((n) => skip.has(n));
  const missingSceneIndexes = [...new Set([...missing, ...skippedSceneIndexes])].sort((a, b) => a - b);
  // A complete pull may yield an intentionally shorter edit: cue-less inserts,
  // short expendable B-roll and song pictures with no voice window are omissions,
  // not unavailable source media and never a reason to reject the final.
  const editorOmittedSceneIndexes = timeline
    ? expected.filter((n) => !retained.has(n) && !missingSceneIndexes.includes(n)) : [];
  const complete = Boolean(timeline && missingSceneIndexes.length === 0 && storyboard);
  const source = [], native = [];
  for (const scene of manifest.scenes ?? []) {
    const words = readWords(scene.words);
    if (!Array.isArray(words)) continue;
    const fromClip = scene.wordsFrom !== "voice" && manifest.clipAudio !== "discard" && !manifest.wholeVoice;
    if (scene.wordsFrom === "clip" && !fromClip) continue;
    source.push(...words);
    if (fromClip) native.push(...words);
  }
  const seconds = timeline?.spine.reduce((n, s) => n + s.seconds, 0) ?? 0;
  const final = timeline ? wordRows(timeline).filter((w) => w.start >= -1e-6 &&
    w.end <= seconds + 1e-6) : [];
  const canonical = (storyboard?.script ?? []).flatMap((line) => scriptWords(line.text)).map(checkWord).filter(Boolean);
  const tokens = final.map((w) => checkWord(w.text)).filter(Boolean);
  const missingWords = [];
  let cursor = 0;
  for (const word of canonical) {
    const at = tokens.indexOf(word, cursor);
    if (at < 0) missingWords.push(word);
    else cursor = at + 1;
  }
  const measured = loudnessMeasurement ?? (out ? measureLoudness(out) : null);
  const bytes = out ? readFileSync(out) : null;
  return {
    version: "cut-finish-evidence.v1",
    provenance: {
      kind: !complete || !out ? "partial" : preText ? "pre-text" : "final",
      isFinal: complete && Boolean(out) && !preText,
      complete, expectedSceneIndexes: expected, retainedSceneIndexes: [...retained],
      missingSceneIndexes, skippedSceneIndexes, editorOmittedSceneIndexes,
    },
    artifact: bytes ? { file: path.basename(out), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length } : null,
    loudness: {
      status: measured ? "measured" : "unknown",
      integratedLufs: measured?.i ?? null, truePeakDbtp: measured?.tp ?? null, rangeLu: measured?.lra ?? null,
    },
    words: {
      basis: "source-word-sidecars-through-audible-edit-clock",
      finalAudioTranscribed: false,
      expected: canonical.length, source: source.length, native: native.length, final: final.length,
      coverage: !storyboard || (canonical.length > 0 && final.length === 0) ? "unknown"
        : missingWords.length || canonical.length !== tokens.length ? "incomplete" : "complete",
      missing: missingWords,
    },
  };
}

/**
 * The whole cut, as the CLI makes it, for any caller (#2988: the worker cuts a
 * Video-page run with this). Renders `out` (default <dir>/cut.mp4) and its word
 * sidecars, and throws FirstCutError where the CLI would exit. The CLI's report
 * is printed by main() from what this returns.
 */
export function firstCut({ dir, out: outOpt, skip = new Set(), music: musicOn = true, stillFill = false, prepareText = false }) {
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
  if (manifest.templateMotion?.enabled === true &&
    (skip.size || scenesWithNoClip({ manifest, storyboard, skip: new Set(), exists }).length)) {
    const evidence = cutFinishEvidence({ manifest, storyboard, skip, exists, readWords: readJson });
    writeFileSync(out.replace(/\.[^.]+$/, "") + ".finish.json", `${JSON.stringify(evidence, null, 2)}\n`);
  }
  if (!storyboard) {
    console.error(`Warning: ${manifest.storyboard ?? "storyboard.json"} is missing or unreadable, so every scene is cut as A-roll and no cutaway is placed.`);
  }
  const finish = finishingOf(manifest);
  const sourceAd = sourceAdOf(manifest);
  const wholeVoice = wholeVoiceOf(manifest, readJson, exists);
  // A template song retains its decoded musical release. Audio container
  // durations can include padding or only estimate VBR/ADTS length; neither is
  // a sample clock. Reuse the mapped reader without opting this cut into maps.
  if (manifest.templateMotion?.enabled === true && wholeVoice && manifest.sourceMap !== true) {
    const clock = clockOf(measureMedia(here(wholeVoice.file)));
    const problem = clockProblem(clock, "audio");
    if (problem) throw new SourceMapRefusal("The whole song's decoded EOF could not be measured", [
      { severity: "refuse", code: "unmeasured-whole-voice", scene: null, detail: `${wholeVoice.file}: ${problem}` },
    ]);
    wholeVoice.seconds = clock.audio.decodedSec;
  }
  if (manifest.wholeVoice === true && !wholeVoice) {
    console.error("Warning: the manifest asks for the voice laid whole, but the narration track or its narration.json is missing, so each scene's voice is laid on its own.");
  }
  if (manifest.templateMotion?.narratedShotList === true) narrationFinishClock({ dir, manifest, storyboard });
  const readClocks = manifest.sourceMap === true ? mediaReader(here, exists) : null;
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
    ...(readClocks ? { measure: readClocks } : {}),
    ...(finish ? { finish } : {}),
    ...(wholeVoice ? { wholeVoice } : {}),
    ...(sourceAd ? { sourceAd } : {}),
  });
  if (timeline.spine.length === 0) {
    throw new FirstCutError(1, `No scene has a clip or a keyframe. Check: exodus video status ${manifest.runId}`);
  }
  protectTemplateMotion(timeline, manifest, storyboard, timeline.notes);
  const stagedText = prepareText && (timeline.mapped || manifest.templateMotion?.enabled === true);

  // The finishing settings' part of the render: the speed, the burned
  // captions and cards, and where the mix goes before its loudness pass.
  const notes = [...(timeline.notes ?? [])];
  const unusedSpeed = paceSpeedNote(manifest.finishing);
  if (unusedSpeed) notes.push(unusedSpeed);
  if (finish?.captionColours && stagedText) notes.push("captionColours: the text stage draws these captions, so they stay one colour");
  const pictureSec = timeline.spine.reduce((sum, seg) => sum + seg.seconds, 0);
  // Template clocks are always real time, including runs with no action windows.
  // Preserve the legacy Door 1 pace policy only for unstamped runs.
  const template = manifest.templateMotion?.enabled === true;
  const protectedMotion = [...timeline.spine, ...timeline.cutaways].some((s) => s.motionProtection);
  // pacePass: its speed in place of cutPace's, on a cut no clock is held to (no song laid whole, no selected or mapped clock).
  const paced = finish?.pacePass === true && !template && !timeline.wholeVoice && !protectedMotion && !timeline.mapped &&
    manifest.templateMotion?.enabled !== true;
  if (finish?.pacePass && !paced) notes.push("this cut keeps a real-time clock, so pacePass did not speed it up or zoom it");
  const paceSpeed = finish?.paceSpeed ?? PACE_PASS.speed;
  if (paced) notes.push(paceZooms(timeline.spine, paceSpeed));
  const speed = paced
    ? paceSpeed
    : finish?.cutPace && !template && !timeline.wholeVoice && !protectedMotion ? speedFor(pictureSec, finish.targetSeconds) : 1;
  if (finish?.cutPace && (template || protectedMotion)) notes.push("template/action/listening/ending clocks remain real time; cutPace does not accelerate the cut");
  if (timeline.sourceMap) {
    // The exact bytes every measured clock was read from, for whoever binds an approval to them.
    timeline.sourceMap.sources = readClocks.files().filter(exists).map((file) => {
      const bytes = readFileSync(here(file));
      return { file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
    const shaOf = new Map(timeline.sourceMap.sources.map((s) => [s.file, s.sha256]));
    for (const s of [...timeline.sourceMap.audibleSources, ...timeline.sourceMap.mutedPictures]) s.sha256 = shaOf.get(s.file) ?? null;
    for (const piece of timeline.sourceMap.pieces) {
      if (!timeline.spine.some((seg) => seg.sceneIndex === piece.sceneIndex && seg.templateNarrationHold) ||
        !(piece.picture?.heldFrames > 0)) continue;
      const from = (piece.edit.startFrame + piece.edit.frames - piece.picture.heldFrames) / FPS;
      const to = (piece.edit.startFrame + piece.edit.frames) / FPS;
      notes.push(`template-audio-source-reservation: scene ${piece.sceneIndex} repeats retained frame ${piece.picture.lastFrame} ` +
        `from ${from.toFixed(6)}–${to.toFixed(6)}s; source sha256 ${shaOf.get(piece.route.file)}; full approved narration retained, no longer clip purchased`);
    }
    if (manifest.wholeVoice === true && !wholeVoice) {
      timeline.sourceMap.findings.push({
        severity: "refuse", code: "whole-voice-missing", scene: null,
        detail: "the manifest lays a song whole, but its narration track or narration.json is not in the pull",
      });
    }
    if (speed !== 1) {
      timeline.sourceMap.findings.push({
        severity: "refuse", code: "cut-speedup", scene: null,
        detail: `the kind's cutPace would speed the whole cut ${speed}x`,
      });
    }
    refuseUnholdable(timeline.sourceMap, prepareText ? new Set((storyboard?.scenes ?? []).filter((s) => s.actionPhases?.length).map((s) => s.sceneIndex)) : new Set());
  }
  // A mapped cut is laid sample-exact on its measured map, so these finishes, which retime or refilter it, stay off.
  if (timeline.mapped) {
    for (const key of ["brollMinSec", "speedUpSlowBroll", "cleanVoice"]) {
      if (finish?.[key]) notes.push(`${key} is not applied to a cut laid on its measured map`);
    }
  }
  if (finish?.brollMinSec && !timeline.mapped) {
    const held = holdBroll(timeline, finish.brollMinSec, speed, (file) => probe(file).seconds);
    timeline.left.push(...held);
    notes.push(...held);
  }
  if (finish?.speedUpSlowBroll && !template && !timeline.mapped && timeline.cutaways.length > 0) {
    const motionOf = (file, from, seconds) => {
      const res = spawnSync("ffmpeg", motionArgs(here(file), from, seconds), { encoding: "utf8", maxBuffer: 1 << 28 });
      if (res.status !== 0) return null;
      return motionByShot(readMotion(res.stdout), [{ n: 0, role: null, start: 0, end: seconds }])[0].motion;
    };
    notes.push(...speedUpSlowBroll(timeline, motionOf, (file) => probe(file).seconds));
  }
  let ass = null;
  // The caption screens and text cards burned in, which cutChecks reads.
  let burned = null;
  let burnedCards = [];
  // A copied ad: its words in the record's boxes and its product photos from the product sheet.
  const copied = sourceAd && finish?.cards ? sourceAdEdit(storyboard, sourceAd, timeline.sourceGroups ?? []) : null;
  if (copied) notes.push(...copied.notes);
  let pictures = [];
  if (!timeline.mapped && sourceAd && finish?.cards && sourceAd.pictures.length > 0) {
    if (exists(manifest.productSheet)) {
      pictures = sourceAd.pictures.map((p) => ({
        file: manifest.productSheet, box: p.box,
        startSec: roundMs(mapSourceTime(timeline.sourceGroups ?? [], p.tIn)),
        endSec: roundMs(mapSourceTime(timeline.sourceGroups ?? [], p.tOut)),
      }));
    } else {
      notes.push(`the pull has no product sheet picture, so the source's ${sourceAd.pictures.length} product card(s) were not drawn`);
    }
  }
  // endCardLayers (Plan 14): the pack photo the worker downloaded, its words drawn by code.
  const brand = finish?.endCardLayers || finish?.brandCheck ? brandOf(manifest) : null;
  const packPhoto = Boolean(brand?.packPhoto) && exists(brand.packPhoto);
  let endLayers = null;
  if (finish?.endCardLayers) {
    endLayers = packPhoto ? endCardLayersOf(brand, storyboard, pictureSec, speed) : null;
    if (!endLayers) notes.push("the pull has no pack photo of the product, so the end card was not drawn");
  }
  if (finish && (finish.captions || finish.cards || endLayers) && !stagedText) {
    if (hasFilter("subtitles")) {
      ass = "edit.ass";
      const cap = sourceAd?.captions ?? null;
      const screens = captionsBeforeEndCard(!finish.captions
        ? []
        : finish.captionsByLine
          ? lineCaptionScreens(lineWords(timeline, storyboard), cap)
          : captionScreens(wordRows(timeline), cap), endLayers);
      if (finish.captions) burned = screens;
      burnedCards = finish.cards ? (copied ? copied.cards : storyboardCards(storyboard, timeline)) : [];
      writeFileSync(here(ass), editAss({
        captions: finish.captionColours ? colourScreens(screens, storyboard) : screens,
        cap,
        ...(finish.captionsByLine ? { capMaxShare: CAPTION_MAX_SHARE } : {}),
        cards: burnedCards,
        hook: copied?.hook ?? null,
        // A copied ad has an end card only where its source does. The pack-photo end card takes the CTA words' place.
        endCard: !endLayers && finish.cards && (!sourceAd || sourceAd.endCard) ? endCardOf(storyboard, pictureSec) : null,
        endLayers,
      }));
    } else {
      notes.push(
        endLayers
          ? "this ffmpeg has no subtitles filter (libass), so the captions, cards and the end card's words were not burned in"
          : "this ffmpeg has no subtitles filter (libass), so the captions and cards were not burned in",
      );
    }
  }
  // cleanVoice, where this ffmpeg has the filters. A voice laid whole is a song, kept as it is.
  let clean = null;
  if (finish?.cleanVoice && !timeline.mapped) {
    const missing = timeline.wholeVoice ? [] : missingFilters(CLEAN_FILTERS);
    if (timeline.wholeVoice) notes.push("the voice is a song laid whole, so it was kept as it is, not cleaned");
    else if (missing.length > 0) notes.push(`this ffmpeg has no ${missing.join(", ")} filter, so the voice was not cleaned`);
    else clean = { voice: VOICE_CLEAN, under: UNDER_VOICE };
  }
  let limiter = null;
  if (finish?.limitPeaks) {
    if (hasFilter("alimiter")) limiter = PEAK_LIMITER;
    else notes.push("this ffmpeg has no alimiter filter, so the loudness pass ran without the limiter");
  }
  const paths = finishPaths(out);
  const rendered = finish?.finishLoudness ? paths.mix : out;
  const meters = finish?.cutChecks ? {
    voice: paths.voice, bed: paths.bed,
    ...(manifest.templateMotion?.enabled === true || manifest.roomTone === false ? { allowAbsentBed: true } : {}),
  } : null;
  // The burn reads its file from the folder ffmpeg runs in, so every path is absolute then.
  const at = ass ? (file) => path.resolve(dir, file) : here;

  const templateCut = manifest.templateMotion?.enabled === true || manifest.videoChoice?.videoModel === "template-video";
  const songMaster = templateCut && timeline.wholeVoice?.songOnly === true;
  const music = musicOn && (!templateCut || manifest.musicBed !== "off") && !songMaster && exists(manifest.music) ? manifest.music : null;
  const sound = soundOf(manifest, songMaster);
  let mixSound = null;
  const levels = new Map();
  const measure = (file) => {
    if (!levels.has(file)) levels.set(file, exists(file) ? measureLufs(here(file)) : null);
    return levels.get(file);
  };
  if (sound) {
    const missing = [...sound.effects, ...sound.beds].filter((x) => !exists(x.file)).map((x) => x.file);
    const plan = soundPlan(
      { ...sound, effects: sound.effects.filter((x) => exists(x.file)), beds: sound.beds.filter((x) => exists(x.file)) },
      timeline, storyboard, { levelled: !finish?.finishLoudness, measure, template },
    );
    const ducked = sound.duck && music ? { gainDb: duckedMusicGain(plan.voiceLufs, measure(music)), duck: DUCK } : null;
    mixSound = {
      ...plan, ...(sound.roomTone === false ? { roomTone: false } : {}), music: ducked,
      notes: [...missing.map((f) => `${f} is not in the folder, so it is left out`), ...plan.notes],
    };
  }
  if (timeline.sourceMap) {
    const record = (file, metadata) => {
      const bytes = readFileSync(here(file));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (metadata?.kind === "library" && metadata.sha256 !== sha256) {
        throw new SourceMapRefusal("A licensed sound changed before the mix; unchecked bytes are not delivered", [
          { severity: "refuse", code: "sound-source-hash", scene: null, detail: file },
        ]);
      }
      const audio = clockOf(readClocks(file)).audio;
      const event = metadata?.kind === "library" ? metadata.eventWindow : null;
      if (!audio || (event && Math.ceil(event.toSec * EDIT_SAMPLE_RATE) > audio.edit.samples - audio.edit.priming)) {
        throw new SourceMapRefusal("A sound lacks decoded coverage of its registered event; declared duration is not EOF evidence", [
          { severity: "refuse", code: "sound-event-eof", scene: null, detail: file },
        ]);
      }
      if (!timeline.sourceMap.sources.some((s) => s.file === file)) timeline.sourceMap.sources.push({ file, bytes: bytes.length, sha256 });
      return { sourceSha256: sha256, sourcePrimingSamples: audio.edit.priming, sourceSamples: audio.edit.samples, sourceOriginSec: audio.originSec };
    };
    if (mixSound) {
      mixSound.effects = mixSound.effects.map((e) => {
        const decoded = record(e.file, e.source);
        const event = e.source?.kind === "library" ? e.source.eventWindow : null;
        if (Number.isFinite(e.durationSec) && Math.round(e.durationSec * EDIT_SAMPLE_RATE) >
          decoded.sourceSamples - decoded.sourcePrimingSamples) {
          if (!template || event || e.required === true) throw new SourceMapRefusal("An authored sound duration exceeds its actual decoded asset", [
            { severity: "refuse", code: "sound-duration-eof", scene: null, detail: e.file },
          ]);
          e.durationSec = (decoded.sourceSamples - decoded.sourcePrimingSamples) / EDIT_SAMPLE_RATE;
          mixSound.notes.push(`sound-duration-eof: optional sound ${e.file} trimmed to its retained decoded EOF`);
        }
        if (event && e.atSec + event.toSec > timeline.sourceMap.frames / FPS + 1 / EDIT_SAMPLE_RATE) {
          throw new SourceMapRefusal("A required registered sound event would be truncated by the final cut", [
            { severity: "refuse", code: "sound-event-cutoff", scene: e.fromScene ?? null, detail: e.file },
          ]);
        }
        return {
          ...e, ...decoded, placementOffsetSec: e.atSec,
          editStartSample: Math.max(0, Math.round(e.atSec * EDIT_SAMPLE_RATE)),
          sourceStartSample: decoded.sourcePrimingSamples + Math.max(0, -Math.round(e.atSec * EDIT_SAMPLE_RATE)),
        };
      });
      mixSound.beds = mixSound.beds.map((b) => ({
        ...b, ...record(b.file, b.source), loop: true,
        editStartSample: Math.round(b.startSec * EDIT_SAMPLE_RATE), samples: Math.round(b.seconds * EDIT_SAMPLE_RATE),
      }));
    }
    if (music) {
      const decoded = record(music);
      timeline.musicPrimingSamples = decoded.sourcePrimingSamples;
      timeline.musicSource = { file: music, ...decoded, loop: true };
    }
  }
  const ffmpegArgs = buildFfmpegArgs(timeline, {
    resolve: at,
    music: music ? at(music) : null,
    out: rendered,
    ...(finish
      ? {
        finish: {
          levelSegments: !finish.finishLoudness, ass, speed,
          ...(pictures.length ? { pictures } : {}), ...(clean ? { clean } : {}), ...(meters ? { meters } : {}),
          ...(endLayers ? { endCard: endLayers } : {}),
        },
      }
      : {}),
    ...(mixSound ? { sound: mixSound } : {}),
  });
  if (meters?.allowAbsentBed) {
    rmSync(meters.voice, { force: true });
    rmSync(meters.bed, { force: true });
  }
  const res = spawnSync("ffmpeg", ffmpegArgs, { stdio: "inherit", ...(ass ? { cwd: path.resolve(dir) } : {}) });
  if (res.status !== 0) {
    const quoted = ffmpegArgs.map((a) => (/[\s\[\];]/.test(a) ? `'${a}'` : a)).join(" ");
    throw new FirstCutError(1, `ffmpeg failed. The command it ran:\n  ffmpeg ${quoted}`);
  }
  let meterLevels = null;
  if (meters) {
    meterLevels = { voiceLufs: measureLufs(meters.voice), bedLufs: meters.allowAbsentBed && !existsSync(meters.bed) ? null : measureLufs(meters.bed) };
    rmSync(meters.voice, { force: true });
    rmSync(meters.bed, { force: true });
  }
  let loudness = null;
  let loudnessMeasurement = null;
  if (finish?.finishLoudness) {
    try {
      loudness = finishLoudnessPass(rendered, out, limiter, template
        ? (measured) => { loudnessMeasurement = measured; } : null);
    } catch (error) {
      if (!template || !(error instanceof FirstCutError)) throw error;
      // One local limiter pass on the same retained mix, never a provider call.
      // If it still clips or cannot be measured, the refusal holds the cut.
      loudness = finishLoudnessPass(rendered, out, PEAK_LIMITER,
        (measured) => { loudnessMeasurement = measured; });
    } finally {
      rmSync(rendered, { force: true });
    }
  }
  const repairedGaps = template ? repairFinalClock(out) : null;
  if (repairedGaps) {
    notes.push(`render-clock-repaired: padded measured audio gaps with silence at ${repairedGaps.map((gap) =>
      `${gap.startSec.toFixed(6)}–${gap.endSec.toFixed(6)}s (${gap.samples} samples)`).join(", ")}; retained word and picture timestamps unchanged`);
    loudnessMeasurement = measureLoudness(out);
    if (loudness) loudness = loudnessMeasurement
      ? { ...loudness, lufs: round2(loudnessMeasurement.i), truePeak: round2(loudnessMeasurement.tp) } : null;
  }
  if (template && trimTemplateTerminalSilence(out, timeline, manifest, storyboard, notes)) {
    loudnessMeasurement = measureLoudness(out);
    if (loudness) loudness = loudnessMeasurement
      ? { ...loudness, lufs: round2(loudnessMeasurement.i), truePeak: round2(loudnessMeasurement.tp) } : null;
  }

  // With the cut sped up, the times written beside it are the sped-up ones.
  const faster = (t) => (speed === 1 ? t : roundMs(t / speed));
  const rows = wordRows(timeline).map((r) => (speed === 1 ? r : { ...r, start: faster(r.start), end: faster(r.end) }));
  const scenes = sceneTimes(timeline).map((p) =>
    speed === 1 ? p : { ...p, startSec: faster(p.startSec), seconds: faster(p.seconds) },
  );
  const sidecars = { ...sidecarPaths(out), ...(timeline.sourceMap ? { sourceMap: sourceMapPath(out) } : {}) };
  if (rows.length > 0) {
    writeFileSync(sidecars.words, `${JSON.stringify(rows, null, 2)}\n`);
    writeFileSync(sidecars.srt, toSrt(rows));
  } else {
    rmSync(sidecars.words, { force: true });
    rmSync(sidecars.srt, { force: true });
  }
  writeFileSync(sidecars.scenes, `${JSON.stringify(scenes, null, 2)}\n`);

  const duration = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out,
  ]).toString().trim();
  const durationSec = Number(duration);
  const timing = template && !stagedText && manifest.planningBudget
    ? measureCutPlanningTiming(out, manifest.planningBudget) : null;
  if (timing?.findings.some((finding) => finding.severity === "refuse")) {
    const evidence = cutFinishEvidence({ manifest, storyboard, timeline, skip, exists, readWords: readJson });
    writeFileSync(out.replace(/\.[^.]+$/, "") + ".finish.json", `${JSON.stringify({ ...evidence, planningTiming: timing.planningTiming }, null, 2)}\n`);
    throw new SourceMapRefusal(`The retained cut cannot meet its frozen edit-length promise:\n${timing.findings.map((finding) => finding.detail).join("\n")}`, timing.findings);
  }
  if (timeline.sourceMap) {
    // The cut as it decodes after every pass, never its container's duration.
    const { findings, render } = renderFindings(timeline.sourceMap, measureMedia(out));
    timeline.sourceMap.render = render;
    timeline.sourceMap.findings.push(...findings);
    timeline.sourceMap.mix = {
      fallback: mixSound?.roomTone === false || mixSound?.beds?.length || timeline.wholeVoice ? "none" : "brown-noise",
      effects: mixSound?.effects ?? [], beds: mixSound?.beds ?? [],
      ...(timeline.musicSource ? { music: timeline.musicSource } : {}),
    };
    refuseUnholdable(timeline.sourceMap, prepareText ? new Set((storyboard?.scenes ?? []).filter((s) => s.actionPhases?.length).map((s) => s.sceneIndex)) : new Set());
    writeFileSync(sidecars.sourceMap, `${JSON.stringify(timeline.sourceMap, null, 2)}\n`);
  }

  // The sound record beside the cut, and the music-only master the kind asked for.
  let soundRecord;
  if (mixSound) {
    let master = null;
    if (sound.musicOnlyMaster) {
      const lufs = music ? measure(music) : null;
      if (!music) mixSound.notes.push("the cut has no music, so no music-only master was made");
      else if (!Number.isFinite(lufs)) mixSound.notes.push("the music has no loudness to measure, so no music-only master was made");
      else {
        const args = musicOnlyMasterArgs(out, here(music), durationSec, round2(FINISH_LUFS - lufs), paths.master);
        if (spawnSync("ffmpeg", args, { stdio: "inherit" }).status === 0) master = paths.master;
        else mixSound.notes.push("ffmpeg could not make the music-only master");
      }
    }
    soundRecord = {
      voiceLufs: mixSound.voiceLufs,
      effects: mixSound.effects,
      beds: mixSound.beds,
      ...(mixSound.music ? { music: mixSound.music } : {}),
      ...(master ? { master: path.basename(master) } : {}),
      notes: mixSound.notes,
    };
    writeFileSync(paths.sound, `${JSON.stringify(soundRecord, null, 2)}\n`);
  }
  const withSound = (cut0) => {
    const evidence = template ? cutFinishEvidence({
      manifest, storyboard, timeline, skip, exists, readWords: readJson, out, preText: stagedText, loudnessMeasurement,
    }) : null;
    // Captions/cards/text off never weaken approved lines: a complete template
    // final with no text stage owes the same line proof completeFirstCutText
    // applies. A partial join is already never final. The held report keeps
    // the same fulfillment shape; the unproven bytes are not left deliverable.
    if (template && !stagedText && evidence?.provenance.complete) {
      const { lines, holds, notes: wordNotes } = spokenLineFulfillment(timeline, storyboard, true);
      if (holds.length) {
        writeFileSync(out.replace(/\.[^.]+$/, "") + ".text.json", `${JSON.stringify({ fulfillment: { lines, holds } }, null, 2)}\n`);
        rmSync(out, { force: true });
        if (soundRecord?.master) rmSync(paths.master, { force: true });
        throw new TextFinishRefusal(holds);
      }
      notes.push(...wordNotes);
    }
    if (evidence) {
      sidecars.finish = out.replace(/\.[^.]+$/, "") + ".finish.json";
      writeFileSync(sidecars.finish, `${JSON.stringify(evidence, null, 2)}\n`);
    }
    const cut = {
      ...cut0, ...(timeline.sourceMap ? { sourceMap: timeline.sourceMap } : {}),
      notes: [...notes, ...(soundRecord?.notes ?? [])],
      ...(timing ? { planningTiming: timing.planningTiming } : {}),
      ...(evidence ? { finishEvidence: evidence } : {}),
      ...(manifest.templateMotion?.enabled === true ? { motion: templateMotionReport(timeline, storyboard, speed) } : {}),
      ...(stagedText ? { textStage: { dir: path.resolve(dir), board: storyboard, speed, policy: { ...manifest.textFinish, ...(manifest.templateMotion?.enabled === true ? { captionsByLine: manifest.textFinish?.captionsByLine ?? finish?.captionsByLine === true } : {}), outputPermission: manifest.outputPermission, planningBudget: manifest.planningBudget } } } : {}),
    };
    return soundRecord ? { ...cut, sound: soundRecord, ...(soundRecord.master ? { musicOnlyMaster: paths.master } : {}) } : cut;
  };
  if (!finish) return withSound({ out, durationSec, manifest, timeline, music, rows, sidecars });

  const plans = finish.blipCheck ? scenePlans(storyboard) : null;
  const checks = finish.cutChecks
    ? checkCut({
        timeline, storyboard, screens: burned, rows, scenes, out, loudness, levels: meterLevels,
        finish, sourceAd, shotOf: (n) => plans?.get(n)?.sourceShot ?? null, cards: burnedCards, speed, endCard: endLayers,
      })
    : null;
  // The pace record: the cut's own numbers, the settings it was cut with (so
  // a redo of the run matches), its loudness once the pass ran, and its checks.
  const pace = {
    ...paceReport({
      ourShots: scenes.map((p) => ({ start: p.startSec, end: roundMs(p.startSec + p.seconds) })),
      ...(sourceAd ? { srcShots: sourceAdPaceShots(sourceAd), srcSec: sourceAd.seconds } : {}),
      ourSec: durationSec,
      ourWords: rows.length,
      ourSilences: voicePauses(rows).filter((x) => x.s > 0.3 && x.e < durationSec - 0.3),
      speed,
    }),
    finishing: finish,
    ...(loudness ? { loudness } : {}),
    ...(checks ? { checks } : {}),
    ...(finish.brandCheck ? { brand: brandRecord({ brand, packPhoto, endLayers, rows }) } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
  writeFileSync(paths.pace, `${JSON.stringify(pace, null, 2)}\n`);
  return withSound({ out, durationSec, manifest, timeline, music, rows, sidecars, pace });
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
  console.log(`Room tone: ${manifest.roomTone === false ? "off" : "under the whole ad"}. Music bed: ${music ?? "none"}`);
  if (cut.pace) {
    const { pace } = cut;
    const loud = pace.loudness ? `, ${pace.loudness.lufs} LUFS, true peak ${pace.loudness.truePeak} dBTP` : "";
    console.log(
      `Pace: ${pace.cutsPerMin.ours} cuts a minute, ${pace.over4s.ours} shots over ${LONG_SHOT_SEC}s, ` +
        `${pace.deadAir.over03s} pauses over 0.3s, speed ${pace.speed}${loud} -> ${path.basename(finishPaths(out).pace)}`,
    );
    for (const note of pace.notes ?? []) console.log(`  ${note}`);
  }
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
