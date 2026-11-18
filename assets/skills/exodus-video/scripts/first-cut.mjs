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
import { fileURLToPath, pathToFileURL } from "node:url";
import { planText, READOUT_INSET_BOX } from "./first-cut-text.mjs";
import { createTextRenderer, measuredTextAss, textFrameWindow } from "./first-cut-text-render.mjs";
import { isZeroDurationSpeech, parseAuthoredBeat, templateActionWindows, templateJoinAnchors, templateSpeechEdit, TEMPLATE_SPEECH_LEAD_SEC, TEMPLATE_SPEECH_TAIL_SEC, DIALOGUE_BREATH_LEAD_SEC, DIALOGUE_BREATH_TAIL_SEC } from "./first-cut-speech.mjs";
import { captionSync, placementHeard, retimeWords, soundPictureCheck } from "./first-cut-sync.mjs";

const USAGE = "usage: first-cut.mjs <pulled-dir> [--out cut.mp4] [--skip 2,5] [--no-music] [--still-fill]";
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 24;
/** The speed step's clock, in ticks a second: fine enough that a frame's faster time is not rounded to a whole frame. */
const SPEED_TIME_BASE = 96000;
/** The speed step (COP-300): on a fine clock, so `fps` puts each faster or slower frame on the 24 fps tick nearest its true time. */
const speedStep = (speed) => `settb=1/${SPEED_TIME_BASE},setpts=PTS/${speed},fps=${FPS}:round=near`;
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
/**
 * COP-382: under a headline at the top for the whole film (finishing.cardPlace "top-film"), every step closer keeps the
 * frame's top edge where it is (`zoomTop` on a segment): the picture grows down and out, so a head below the headline's
 * box on the plain framing stays below it, where a centred step would lift it into the box.
 */
const zoomedAtTop = (zoom) => `scale=${even(WIDTH * zoom)}:${even(HEIGHT * zoom)},crop=${WIDTH}:${HEIGHT}:(iw-ow)/2:0,setsar=1`;
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
/** COP-300: the fade-out at the end of a sped-up cut's sound, after it is cut to the picture: 10 ms at 48 kHz. */
const END_FADE_SAMPLES = 480;
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
 * limiter at PEAK_LIMIT (about -1.9 dB), so a peak between two samples is caught too.
 * The cut is still measured after and refused over TRUE_PEAK_MAX_DB. Its
 * resample is pinned to stereo, as every one after loudnorm is (loudnessApplyArgs).
 */
export const PEAK_LIMIT = 0.8;
/** The limiter at `limit`, a linear level alimiter takes from 0.0625 to 1. */
export function peakLimiter(limit = PEAK_LIMIT) {
  return `aresample=192000,aformat=channel_layouts=stereo,alimiter=limit=${limit}:level=false:attack=2:release=60`;
}
export const PEAK_LIMITER = peakLimiter();
/**
 * #4573: the AAC encode after the limiter can put a peak back over
 * TRUE_PEAK_MAX_DB, by a different amount on each cut of the same takes (the
 * room tone is fresh noise every time). A limited cut that lands over is
 * limited again from the same mix, this many times at most, each time lower by
 * what the last one landed over FINISH_TRUE_PEAK; still over, it is refused.
 */
export const LIMIT_AGAIN_MAX = 2;
/** The lowest ceiling a limit again goes to (about -6 dB): a cut that needs lower is refused, not squashed. */
const PEAK_LIMIT_MIN = 0.5;

/** The next ceiling down after a limited pass measured `tp` dBTP. */
export function lowerPeakLimit(limit, tp) {
  const lower = limit * 10 ** (-(tp - FINISH_TRUE_PEAK) / 20);
  return Math.max(PEAK_LIMIT_MIN, Math.round(lower * 10_000) / 10_000);
}
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

/**
 * pauseTrim (COP-355, a run's saved sheet: Luke's three pause levels, by name): jumpCut with these numbers in place of
 * its own, so any pause over maxGap between two heard words is cut to about keepAfter plus keepBefore. The pauses
 * jumpCut keeps whole (one the script writes in, one a direction asks for, a reaction's beat) stay whole here too.
 */
export const PAUSE_TRIMS = {
  light: { maxGap: 0.6, keepAfter: 0.15, keepBefore: 0.15 },
  medium: { maxGap: 0.4, keepAfter: 0.1, keepBefore: 0.1 },
  hard: { maxGap: 0.25, keepAfter: 0.05, keepBefore: 0.05 },
};
const PAUSE_LEVELS = new Set(Object.values(PAUSE_TRIMS));
/**
 * pauseTrim: the fade of a take's sound at each join inside it, in and out, as Luke's own finish fades its joins. It
 * changes no length. Today's trim and kept pauses have none.
 */
const PAUSE_JOIN_FADE_SEC = 0.012;

/**
 * addedCuts (COP-355, a run's saved sheet: Luke's locked finish, by name): the longest a take may run with no cut, in
 * seconds on its own clock before the speed-up. See addedCutPlan for where a cut goes. `ADDED_CUT`: a removal this
 * long or longer (`realSec`) is a cut already; an added cut sits at least `clearSec` from both ends of its stretch;
 * the other framing is `zoom` times the take's own, or its own divided by `zoom` when the take is punched in past
 * `tightPast`, centred left to right with `top` of the spare height above it.
 */
export const ADDED_CUTS = { "7": 7, "5": 5, "3.5": 3.5 };
export const ADDED_CUT = { realSec: 0.3, clearSec: 1.2, zoom: 1.08, tightPast: 1.1, top: 0.42 };
/** The ffmpeg filters an added cut's picture uses (buildFfmpegArgs), each in ffmpeg 5.1, the worker's. */
export const ADDED_CUT_FILTERS = ["split", "trim", "setpts", "scale", "crop", "setsar", "concat"];
/**
 * addedCuts: a framing change this many frames or fewer from another, or from a take's edge, is left out (a piece of a
 * frame or two flashes, and at a speed over 1 the join of the pieces can lose a frame); a take that would start in a
 * zoom within FRAMING_SAME_WITHIN of the one the take before it ends in starts in its other framing (the same picture
 * across a join, #3304).
 */
const FRAMING_MIN_FRAMES = 6;
const FRAMING_SAME_WITHIN = 0.03;
/** addedCuts: framingChangeTimes leaves out a change this many frames or fewer from a cutaway's edges (1/24 s, and the frame its edge can land from its clock). */
const FRAMING_NEAR_CUTAWAY = 2;
/** A name of `table`, as a string, or null; never one of an object's own words ("constructor"). */
const nameIn = (table, value) => (typeof value === "string" && Object.prototype.hasOwnProperty.call(table, value) ? value : null);

/**
 * COP-273 W2 cut, songEnd (a sung run's saved finish, by name): Luke's end. The film ends SONG_END_AFTER_SEC after the
 * last sung word ends, or at the song's own end if that comes sooner, the song fading over the film's last
 * SONG_END_FADE_SEC; the end card is the film's last SONG_END_CARD_SEC (never more than half of it), fading in over
 * SONG_END_CARD_FADE_SEC, and a sung word under it is no refusal: the song plays on under the card. His numbers (his dev
 * pack, lab/story_build.py and lab/prepro_finish.py, read as text).
 */
export const SONG_END_AFTER_SEC = 3.5;
export const SONG_END_FADE_SEC = 2.5;
/**
 * COP-273 W2 end order: the worker trims such a song at the same end already (its times kept to the ms), so a song that
 * runs less than this past the last sung word plus SONG_END_AFTER_SEC is at its end: nothing is cut and no second fade.
 */
const SONG_END_SAME_SEC = 0.01;
export const SONG_END_CARD_SEC = 4;
export const SONG_END_CARD_FADE_SEC = 0.45;
/**
 * COP-273 W2 cut, songCaptions: the caption looks of a sung run's saved finish, by name, drawn on the sung words' own
 * times (songCaptionScreens). `per` words of one line a screen (Infinity: the whole line); `size` and `y` (the screen's
 * centre) as shares of the frame's height; `caps` in capitals; `colour` the words' (ASS, &HAABBGGRR), `lit` the word
 * being sung (ASS, &HBBGGRR&), `outline` and `shadow` the edge. "lit" is Luke's look `lights_up` (white capitals, a
 * black edge, the sung word yellow #FFE600, three words, at 64 % of the height for the line's top) and "word" his
 * `one_word` (one orange #FF7A00 word at a time, mid frame), each in the cut's own font, sized to fit it; "line" is the
 * look the kind's captions have today, a whole sung line a screen. His bounce is not drawn (his own finish does not
 * draw it either).
 */
export const SONG_CAPTION_LOOKS = {
  lit: { per: 3, size: 0.05, y: 0.665, caps: true, colour: "&H00FFFFFF", lit: "&H00E6FF&", outline: 7, shadow: 4 },
  line: { per: Infinity, size: 0.034, y: 0.7, caps: false, colour: "&H00FFFFFF", lit: null, outline: 1.5, shadow: 2 },
  word: { per: 1, size: 0.08, y: 0.46, caps: true, colour: "&H00007AFF", lit: null, outline: 8, shadow: 4 },
};
/** songCaptions: a line's last screen stays up at most this long after its last word starts, or until the next line. */
export const SONG_CAPTION_HOLD_SEC = 1.4;
/**
 * COP-273 W2 cut, songEditing: light dips to black into the end card, as Luke's finish does: black comes in over
 * `in` seconds from `lead` before the card, and goes out over `out` seconds from the card. His white flash at the turn
 * is not drawn: his editor finds the turn with a model call, which no price holds yet.
 */
export const SONG_EDITING_LEVELS = { off: null, light: { lead: 0.35, in: 0.3, out: 0.35 } };
/** addedCuts' `wholeLines`, the script line ids the worker marked, as finishingOf keeps them: none when there are none. */
function wholeLinesOf(raw) {
  const ids = Array.isArray(raw) ? raw.filter((id) => typeof id === "string" && id !== "") : [];
  return ids.length > 0 ? { wholeLines: ids } : {};
}

/**
 * COP-357, the phone look: a run's saved sheet ("Ultra realism"), written by the worker as three settings, each read only when
 * true, on a cut of its own clock (not a template launch's, not one laid on its measured map).
 * - fps30: the finished file runs at DELIVERY_FPS. The last step of the picture, after the words are burned in, repeats
 *   one frame in four (the fps filter), so the cut's own clock (FPS), its edges, its speed step, its captions and its
 *   sound stay as they are.
 * - lensSmudge: LENS_SMUDGE, a soft haze of the picture itself laid back over it near one top corner, the brighter
 *   one about 1.0 s into the joined takes (brighterSide).
 * - phonePass: PHONE_PASS, grain that changes every frame, softer colour, a light halo and a slow drift of the
 *   exposure. No shake.
 * Both picture passes run on the joined takes, before any cutaway, picture, end card or burned word is laid over them,
 * so those stay sharp. The numbers are Luke's, from his free realism test at its light strength and his locked smudge
 * at half strength: tuned at 720x1280, the smudge's places and sizes are scaled here to WIDTH x HEIGHT; his own 1080 run
 * of the phone pass kept its numbers. A pass whose filters this ffmpeg lacks is left out, with a note.
 * With either picture pass the takes are also read before the look, in the same render (LOOK_PROBE); a 30 fps film's
 * motion is read back on FPS, and its caption check reads each caption on the frame the delivered file shows it on.
 *
 * COP-385, the sheet's ultra: the same three names, once (never a pass of their own on top of the phone look's), and
 * quietRoom (QUIET_ROOM_DB). The takes it cuts are the files Topaz sharpened at their own size, which the worker hands it
 * as the takes, at the takes' own 24 fps (no frames made up in between); the cut reads them as any take, scaled to
 * WIDTH x HEIGHT on its own FPS clock (`norm`), and the film is delivered at 30 by repeated frames as above.
 */
export const DELIVERY_FPS = 30;

/** The finished cut's frames on FPS: the joined picture's, or round(frames / speed) after a speed step, as its sound ends. */
export function filmFrames(pictureSec, speed = null) {
  const frames = Math.round(pictureSec * FPS);
  return speed ? Math.round(frames / speed + 1e-9) : frames;
}

/**
 * #4817: the frames a film delivered at `deliverFps` has, so its picture runs as long as its sound: after a speed step
 * the sound ends on filmFrames on FPS, with none it ends on pictureSec itself. Rounded up to a whole delivered frame, so
 * the picture never ends before the sound, and never by a whole frame after it.
 */
export function deliveredFrames(pictureSec, speed, deliverFps) {
  const soundSec = speed ? filmFrames(pictureSec, speed) / FPS : Number(pictureSec.toFixed(6));
  return Math.ceil(soundSec * deliverFps - 1e-9);
}
export const LENS_SMUDGE = {
  /** Where the side is read: this far into the cut. */
  readAtSec: 1,
  /** The mask: its peak of 255 (half of full), its reach in pixels, how it stretches across and down, its falloff. */
  strength: 117, radius: 900, stretch: [1.1, 0.9], power: 1.25,
  /** The mask's centre on each side, in pixels of WIDTH x HEIGHT. */
  centre: { left: [165, 570], right: [900, 450] },
  /** The haze: the picture made this small, blurred round (sigma) and along a line (angle, radius), averaged, scaled up. */
  haze: { width: 180, height: 320, sigma: 6.5, angle: 32, radius: 17 },
  /** The haze softened before it is merged in. */
  tone: { contrast: 0.8, brightness: 0.05, saturation: 0.9 },
};
export const PHONE_PASS = {
  grain: { luma: 4, chroma: 2 },
  chromaBlur: 0.8,
  halo: { size: 5, amount: 0.35 },
  /** The exposure's drift, as eq expressions of the time. */
  brightness: "0.008*sin(2*PI*t*0.23+1)+0.004*sin(2*PI*t*0.71+2.4)",
  gamma: "1+0.016*sin(2*PI*t*0.17)",
};
/** The filters each picture pass needs that a build of ffmpeg may leave out. */
export const LOOK_FILTERS = {
  lensSmudge: ["gblur", "dblur", "blend", "eq", "geq", "maskedmerge"],
  phonePass: ["gblur", "eq", "unsharp", "noise"],
};

/**
 * COP-357, fix A: the look's exposure drift hides a frozen picture from both freeze checks (its grain from the worker's
 * too): the worker's freezedetect compares each frame with the first of the freeze, the cut's motion read each frame with
 * the one before, and the drift steps the picture a whole level at a time. So with either
 * picture pass the joined takes are split before the look, in the same render, and a probe branch reads them as the
 * two checks read a film: freezedetect at the worker's -60 dB (scout media-probe.ts FREEZE_NOISE) from 0.2 s; on a cut
 * whose framing changed, from 0.05 s, two identical frames, as the guard reads such a film (scout auto-cut.ts
 * FRAMING_FREEZE_MIN_SEC: an added cut halves a held pause into pieces, one maybe a few frames long, #4787); and the
 * cut's motion rows, each into a side file in the folder (read, then taken
 * away). The worker joins the runs that meet at a framing change and drops those under 2 s, as it does the film's own.
 * Its times are the takes' clock, before the speed step.
 */
export const LOOK_PROBE = { noise: "-60dB", minSec: 0.2, framingMinSec: 0.05, freeze: "edit.lookfreeze.txt", motion: "edit.lookmotion.txt" };
/** The motion read of a picture: each frame's change from the one before, on a 90 px wide copy (motionArgs, LOOK_PROBE). */
const MOTION_READ = "scale=90:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG";

/**
 * The probe branch's filters, from the takes' split to its sink. #4787 (COP-373 review): `minSec` is
 * LOOK_PROBE.framingMinSec only on a cut whose framing changed, as the worker's guard reads such a film; else today's.
 */
export function lookProbeFilter(minSec = LOOK_PROBE.minSec) {
  return `freezedetect=n=${LOOK_PROBE.noise}:d=${minSec},metadata=print:file=${LOOK_PROBE.freeze},` +
    `${MOTION_READ}:file=${LOOK_PROBE.motion},nullsink`;
}

/** freezedetect's hits in the probe's side file as runs, in its order; one still open at the end runs to `endSec`. */
export function lookFreezeRunsOf(text, endSec) {
  const runs = [];
  let open = null;
  for (const line of String(text ?? "").split("\n")) {
    // ffmpeg prints a time with %g ("4.16667e-05" for frame 0): the exponent and a sign are part of the number (COP-361).
    const hit = line.match(/^lavfi\.freezedetect\.freeze_(start|end)=([-+]?[\d.]+(?:e[-+]?\d+)?)/i);
    if (!hit) continue;
    if (hit[1] === "start") open = Number(hit[2]);
    else if (open !== null) {
      runs.push([open, Number(hit[2])]);
      open = null;
    }
  }
  if (open !== null && endSec > open) runs.push([open, endSec]);
  return runs;
}

/** The span from `from` to `to` less each covered [a, b]: the pieces left. */
function uncovered(from, to, covered) {
  let pieces = [[from, to]];
  for (const [a, b] of covered) {
    pieces = pieces.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [[s, Math.min(e, a)], [Math.max(s, b), e]].filter(([x, y]) => y - x > 1e-9)));
  }
  return pieces;
}

/**
 * What the probe leaves out, on the takes' clock: what covers the whole frame, so the takes are not seen there (a
 * cutaway, the end card). A product picture sits in its box with the takes around it, so it covers nothing.
 */
export function lookCovered({ cutaways = [], pictures: _pictures = [], endCard = null }) {
  return [...cutaways.map((c) => [c.startSec, c.startSec + c.seconds]), ...(endCard ? [[endCard.in, endCard.out]] : [])];
}

/**
 * The probe's two side files, read on the film's clock (divided by the speed), with what covers the whole frame left
 * out (lookCovered): the freeze runs for the worker's guard, and the motion rows for the cut's freeze check (a covered
 * row never counts as still), and how many frame changes it read of the takes' (`rowsRead` of `changes`). Null when
 * either file cannot be read. Both files are taken away.
 */
function readLookProbe(here, { pictureSec, speed, covered }) {
  let freezeText;
  let motionText;
  try {
    freezeText = readFileSync(here(LOOK_PROBE.freeze), "utf8");
    motionText = readFileSync(here(LOOK_PROBE.motion), "utf8");
  } catch {
    return null;
  } finally {
    rmSync(here(LOOK_PROBE.freeze), { force: true });
    rmSync(here(LOOK_PROBE.motion), { force: true });
  }
  const freezes = lookFreezeRunsOf(freezeText, pictureSec)
    .flatMap(([from, to]) => uncovered(from, to, covered))
    .map(([from, to]) => ({ start: roundMs(from / speed), end: roundMs(to / speed), duration: roundMs(to / speed - from / speed) }));
  const read = readMotion(motionText);
  const rows = read.map((r) => ({ t: r.t / speed, y: covered.some(([a, b]) => r.t >= a && r.t < b) ? Infinity : r.y }));
  return { freezes, rows, rowsRead: read.length, changes: Math.max(0, Math.round(pictureSec * FPS) - 1) };
}

/** Two freeze runs of one hold, read on two clocks, can miss each other by less than a frame: one run within this. */
const FREEZE_JOIN_SEC = 1 / FPS;

/** Freeze runs ({ at, sec }) merged where they overlap or come within FREEZE_JOIN_SEC, in time order. */
export function mergedFreezes(runs) {
  const out = [];
  for (const run of [...runs].sort((a, b) => a.at - b.at)) {
    const last = out.at(-1);
    if (last && run.at <= last.at + last.sec + FREEZE_JOIN_SEC + 1e-9) last.sec = roundMs(Math.max(last.at + last.sec, run.at + run.sec) - last.at);
    else out.push({ ...run });
  }
  return out;
}

/**
 * COP-357: when the cut's 24 fps frame that starts at `sec` is first seen in its file repeated to `fps` frames a second.
 * The fps filter shows frame n first at frame floor(n x fps / 24 + 0.5) (rounding to nearest, its default).
 */
export function deliveredSeenSec(sec, fps) {
  const n = Math.round(sec * FPS);
  return Math.floor((n * fps) / FPS + 0.5) / fps;
}

/** lensSmudge's filters, from the picture labelled `input` to `output`, its mask centred on the `side` top corner. */
export function lensSmudgeFilters(input, side, output) {
  const s = LENS_SMUDGE;
  const [x, y] = s.centre[side];
  const h = s.haze;
  const t = s.tone;
  return [
    `[${input}]format=gbrp,split=3[lkpic][lkbase][lksmall]`,
    `[lksmall]scale=${h.width}:${h.height},split[lksmall1][lksmall2]`,
    `[lksmall1]gblur=sigma=${h.sigma}[lkround]`,
    `[lksmall2]dblur=angle=${h.angle}:radius=${h.radius}[lkline]`,
    `[lkround][lkline]blend=all_mode=average,scale=${WIDTH}:${HEIGHT}:flags=bilinear[lkhaze]`,
    `[lkpic][lkhaze]blend=all_mode=screen:all_opacity=1,eq=contrast=${t.contrast}:brightness=${t.brightness}:saturation=${t.saturation},format=gbrp[lkhazed]`,
    // One frame of mask, made once: maskedmerge holds an input's last frame to the end of the others (ffmpeg's framesync).
    `nullsrc=s=${WIDTH}x${HEIGHT}:r=${FPS},format=gray,` +
      `geq=lum=${s.strength}*pow(clip(1-hypot((X-${x})/${s.stretch[0]}\\,(Y-${y})/${s.stretch[1]})/${s.radius}\\,0\\,1)\\,${s.power}),` +
      "trim=end_frame=1,format=gbrp[lkmask]",
    `[lkbase][lkhazed][lkmask]maskedmerge,format=yuv420p[${output}]`,
  ];
}

/** phonePass's filter chain. */
export function phonePassFilter() {
  const p = PHONE_PASS;
  const { size, amount } = p.halo;
  return `gblur=sigma=${p.chromaBlur}:planes=6,unsharp=${size}:${size}:${amount}:${size}:${size}:0,` +
    `noise=c0s=${p.grain.luma}:c0f=t+u:c1s=${p.grain.chroma}:c1f=t+u:c2s=${p.grain.chroma}:c2f=t+u,` +
    `eq=brightness=${p.brightness}:gamma=${p.gamma}:eval=frame`;
}

/**
 * lensSmudge's side: the top corner that is brighter, "left" or "right", in one frame of `file` at `atSec`, made 2 by 3
 * pixels of grey (each top pixel is one half of the frame's top third); null when the frame cannot be read.
 */
export function brighterSide(file, atSec) {
  const res = spawnSync("ffmpeg", [
    "-v", "error", "-ss", sec(atSec), "-i", file, "-frames:v", "1", "-vf", "scale=2:3:flags=area,format=gray", "-f", "rawvideo", "-",
  ], { maxBuffer: 1 << 16 });
  const px = res.status === 0 && res.stdout?.length >= 2 ? res.stdout : null;
  return px ? (px[0] > px[1] ? "left" : "right") : null;
}

/** The take and its time that the cut shows about `atSec` in (a still shows its picture from its start). */
function spineFrameAt(spine, atSec) {
  const seg = spine.find((s) => s.startSec + s.seconds > atSec) ?? spine.at(-1);
  if (!seg) return null;
  const into = Math.max(0, Math.min(atSec - seg.startSec, seg.seconds));
  return { file: seg.file, atSec: seg.source === "clip" ? (seg.inSec ?? 0) + into : 0 };
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
    ...(f.captionCheck === true ? { captionCheck: true } : {}),
    ...(f.keepPauses === true ? { keepPauses: true } : {}),
    // COP-353: a name of the cut's own chains only, and only beside the chain it stands in place of.
    ...(f.cleanVoice === true && typeof f.voiceSound === "string" && Object.hasOwn(VOICE_SOUNDS, f.voiceSound)
      ? { voiceSound: f.voiceSound } : {}),
    // COP-354: none, or the name of one of the cut's own beds.
    ...(typeof f.roomSound === "string" && (f.roomSound === "none" || Object.hasOwn(ROOM_BEDS, f.roomSound)) ? { roomSound: f.roomSound } : {}),
    // COP-355: a saved sheet's pause level and cuts added, each by its name; the lines no added cut falls inside with it.
    ...(nameIn(PAUSE_TRIMS, f.pauseTrim) ? { pauseTrim: f.pauseTrim } : {}),
    ...(nameIn(ADDED_CUTS, f.addedCuts) ? { addedCuts: f.addedCuts, ...wholeLinesOf(f.wholeLines) } : {}),
    ...(f.fps30 === true ? { fps30: true } : {}),
    ...(f.lensSmudge === true ? { lensSmudge: true } : {}),
    ...(f.phonePass === true ? { phonePass: true } : {}),
    // COP-385: the room bed QUIET_ROOM_DB quieter, only beside a room sound to lay.
    ...(f.quietRoom === true && typeof f.roomSound === "string" && Object.hasOwn(ROOM_BEDS, f.roomSound) ? { quietRoom: true } : {}),
    // COP-356: the card as a headline at the top (headlineCards), a name only the worker writes from a run's sheet;
    // COP-382: "top-film", the headline for the whole film.
    ...(on.cards && (f.cardPlace === "top" || f.cardPlace === "top-film") ? { cardPlace: f.cardPlace } : {}),
    // COP-370: beside it, the take the board filmed with room above the head, by its number (headlineCards' band).
    ...(on.cards && (f.cardPlace === "top" || f.cardPlace === "top-film") && Number.isInteger(f.headRoom) && f.headRoom > 0 ? { headRoom: f.headRoom } : {}),
    // COP-382: a run's sheet's words over the last shot, which only the worker writes.
    ...(endingWordsOf(f.endingWords) ? { endingWords: endingWordsOf(f.endingWords) } : {}),
    // COP-273 W2 cut: a sung run's saved finish, names only the worker writes from the run's sheet. Each acts only on a
    // song laid whole (songEndOf, songCaptionScreens, the dip into the end card).
    ...(f.songEnd === true ? { songEnd: true } : {}),
    ...(on.captions && nameIn(SONG_CAPTION_LOOKS, f.songCaptions) ? { songCaptions: f.songCaptions } : {}),
    ...(nameIn(SONG_EDITING_LEVELS, f.songEditing) ? { songEditing: f.songEditing } : {}),
    // COP-383: a run's sheet's music, laid at Luke's level (LIGHT_MUSIC), a name only the worker writes.
    ...(f.musicMix === "light" ? { musicMix: "light" } : {}),
    // COP-384: a run's sheet's extra shots, the clips the worker laid in the manifest's `extraShots` (EXTRA_SHOTS).
    ...(f.extraShots === true ? { extraShots: true } : {}),
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
 * its set's first scene (the first bed from the start) to the next heard bed,
 * looped BED_UNDER_DB under the voice. Rejected beds keep that legacy span
 * unless a known new place starts without its own usable bed: that interval
 * uses the existing brown-noise underlay, not the previous place's air.
 * Beds below BED_FLOOR_LUFS or unmeasurable are omitted with a note. With
 * `duck` the music sits MUSIC_UNDER_DB under the voice and a
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
/**
 * COP-353, voiceSound: how the voice sounds, a run's saved sheet's pick, which the worker writes beside cleanVoice as
 * a name: the cut runs only its own chains, never a filter graph from a manifest. The chain stands in VOICE_CLEAN's
 * place, on the joined voice before the beds are ducked under it, and the loudness pass sets the film's level after
 * it, as it does today. phone: the lows under 120 Hz and the highs over 7.5 kHz cut, a fast 4:1 compressor and a soft
 * clip, with no noise reduction or de-essing before it. memo: a narrow band from 300 Hz to 3.4 kHz, a hard 8:1
 * compressor, 4 dB more and a soft clip. raw: the voice as filmed. The numbers are Luke's tested chains (his kit's post
 * tests) without his gain back to a level and his limiter, which the loudness pass and its limiter do here. Every
 * filter is in ffmpeg 5.1, the worker's (exodus/__tests__/first-cut-sheet-voice.test.ts lists them).
 */
export const VOICE_SOUNDS = {
  phone: "highpass=f=120,lowpass=f=7500,acompressor=threshold=-24dB:ratio=4:attack=5:release=120:makeup=2,asoftclip=type=tanh",
  memo: "highpass=f=300,lowpass=f=3400,acompressor=threshold=-32dB:ratio=8:attack=3:release=80:makeup=4,volume=4dB,asoftclip=type=tanh",
  raw: "anull",
};
/** The filters a chain runs, by name. */
const chainFilters = (chain) => chain.split(",").map((part) => part.split("=")[0]);
/** The filters the duck under the voice runs, whichever chain is on it (UNDER_VOICE). */
const UNDER_FILTERS = ["highpass", "lowpass", "sidechaincompress"];
/**
 * COP-354, roomSound: the room sound under the whole film, a run's saved sheet's pick, which the worker writes as a
 * name ("none", "room", "kitchen", "car" or "outside"): the cut runs only its own beds, never a graph from a manifest.
 * Each bed is made here by ffmpeg from seeded noise and tones (no sound file, no vendor), for the film's whole length
 * before the speed step, and mixed after the join and the pause trims, so it runs on under every cut and every take's
 * own floor. It is not ducked: a room does not go quiet when someone talks. Its RMS is set ROOM_UNDER_DB under the
 * voice's integrated loudness after its chain, measured in one extra pass of the voice alone; the loudness pass then
 * moves both together. It fades in and out over ROOM_FADE_SEC. With a bed, or with "none", the cut's own faint brown
 * bed (ROOM_TONE) is not laid. The beds are Luke's made-up placeholders, synthesised the same way (his kit's post
 * tests), at 48 kHz; the times of the kitchen's clinks and the outside's chirps come from a seeded generator, so one
 * folder cuts the same bed every time. Each clink and chirp is an if() that ffmpeg works out only in its own moment:
 * as a product, a clink's exp() long before its moment overflows, and 0 times infinity silences the bed up to there on
 * a film over about 22 s; it is also ten times faster to make.
 */
export const ROOM_UNDER_DB = 27;
export const ROOM_FADE_SEC = 0.08;
/**
 * COP-385, quietRoom: the saved sheet's ultra lays the room sound this much quieter, as Luke's Ultra B does ("room tone
 * 6 dB quieter than the first test", lab/post_lock.json; realism_ultra.py locked it at -44 against the test's -38). A
 * name the worker writes only beside the phone look's three, so the room bed sits ROOM_UNDER_DB + this under the voice.
 */
export const QUIET_ROOM_DB = 6;
const ROOM_RATE = 48000;
/**
 * COP-383, musicMix "light": a run's sheet's music at Luke's lock (lab/post_v2.py final3, post3.py final): its loudness
 * `underDb` under the voice's after its chain (measured in one extra pass of the voice alone, as the room is), faded in
 * over `fadeInSec` and out over the film's last `fadeOutSec`, and ducked lightly while the voice speaks: a compressor
 * keyed on the voice, its threshold `duck.underDb` under the voice's loudness, ratio 1.33, about 4 dB. It is laid on the
 * finished film's clock, after the speed step, so the music keeps its own tempo, and after the voice's chain and the
 * duck under it, so cleanVoice neither turns it down 6 dB more (UNDER_VOICE) nor ducks it hard: one level, one duck.
 */
export const LIGHT_MUSIC = { underDb: 20, fadeInSec: 0.5, fadeOutSec: 1, duck: { underDb: 18, ratio: 1.33, attack: 40, release: 450, knee: 2 } };

/** A seeded generator of numbers in [0, 1) (mulberry32): the same seed gives the same numbers on every machine. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Moments for a sound now and then: the first between 1.5 s and `every`, then every 0.6 to 1.5 times `every`. */
export function roomMoments(seconds, every, seed) {
  const next = seeded(seed);
  const between = (lo, hi) => lo + (hi - lo) * next();
  const out = [];
  for (let t = between(1.5, every); t < seconds - 1; t += between(every * 0.6, every * 1.5)) out.push(Math.round(t * 100) / 100);
  return out;
}

const noise = (color, amplitude, seed, seconds) => `anoisesrc=d=${seconds}:c=${color}:r=${ROOM_RATE}:a=${amplitude}:seed=${seed}`;
const tone = (expr, seconds) => `aevalsrc=exprs='${expr}':s=${ROOM_RATE}:d=${seconds}`;
const clinks = (times, f1, f2, decay = 32) =>
  times.map((k) => `if(gte(t,${k})*lt(t,${(k + 0.4).toFixed(2)}),exp(-${decay}*(t-${k}))*(sin(2*PI*${f1}*(t-${k}))+0.5*sin(2*PI*${f2}*(t-${k}))),0)`).join("+") || "0";
const chirps = (times) =>
  times.flatMap((k) => [0, 1, 2].map((q) => {
    const a = (k + q * 0.16).toFixed(2);
    return `if(between(t,${a},${(k + q * 0.16 + 0.1).toFixed(2)}),sin(2*PI*(${3000 + 400 * q}+9000*(t-${a}))*(t-${a}))*pow(sin(PI*(t-${a})/0.1),2),0)`;
  })).join("+") || "0";

/** Each bed: its sources and the graph that joins them into [a], for a film of `seconds`. */
export const ROOM_BEDS = {
  room: (d) => ({
    sources: [noise("brown", 0.6, 3, d), tone("0.02*sin(2*PI*60*t)", d)],
    graph: "[0:a]highpass=f=70,lowpass=f=700[a0];[a0][1:a]amix=inputs=2:normalize=0[a]",
  }),
  kitchen: (d) => ({
    sources: [
      tone("(1+0.06*sin(2*PI*0.31*t))*(0.30*sin(2*PI*60*t)+0.22*sin(2*PI*120*t)+0.12*sin(2*PI*180*t)+0.06*sin(2*PI*240*t)+0.03*sin(2*PI*360*t))", d),
      noise("brown", 0.35, 4, d),
      tone(`0.5*(${clinks(roomMoments(Number(d), 6.5, 21), 2350, 3720)})`, d),
    ],
    graph: "[1:a]highpass=f=80,lowpass=f=900[a1];[0:a][a1][2:a]amix=inputs=3:normalize=0[a]",
  }),
  car: (d) => ({
    sources: [noise("brown", 0.9, 5, d), noise("pink", 0.5, 6, d)],
    graph: "[0:a]lowpass=f=160[a0];[1:a]highpass=f=180,lowpass=f=650,volume=volume='0.25+0.75*pow(sin(PI*t/9.5),6)':eval=frame[a1];[a0][a1]amix=inputs=2:normalize=0[a]",
  }),
  outside: (d) => ({
    sources: [noise("pink", 0.6, 8, d), tone(`0.35*(${chirps(roomMoments(Number(d), 4.5, 31))})`, d)],
    graph: "[0:a]highpass=f=150,lowpass=f=1400,volume=volume='0.45+0.55*pow(sin(PI*t/11),2)':eval=frame[a0];[a0][1:a]amix=inputs=2:normalize=0[a]",
  }),
};

/** The ffmpeg command that makes a bed for `seconds` into `out` (mono, 48 kHz, 32-bit float: a peak over full scale is kept for the gain). */
export function roomBedArgs(name, seconds, out) {
  const { sources, graph } = ROOM_BEDS[name](seconds.toFixed(3));
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    ...sources.flatMap((source) => ["-f", "lavfi", "-i", source]),
    "-filter_complex", graph, "-map", "[a]", "-ac", "1", "-ar", String(ROOM_RATE), "-c:a", "pcm_f32le", out,
  ];
}
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
  // Unknown/same-place bed failures retain the legacy next-HEARD-bed span.
  // Only a known change of place can replace it with the existing free underlay.
  const places = new Map((storyboard?.scenes ?? []).map((scene) =>
    [scene.sceneIndex, String(scene.place ?? "").trim().toLowerCase()]));
  const placeRuns = [];
  let previousPlace = "";
  // #4944: template runs only; a regular cut keeps dev's next-heard-bed span.
  if (template) for (const seg of spine) {
    const place = places.get(seg.sceneIndex);
    if (place && place !== previousPlace) {
      placeRuns.push({ from: seg.startSec, place });
      previousPlace = place;
    }
  }
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
  const failedPlaceStarts = placeRuns.filter((run) => !heard.some((b) => b.from === run.from)).map((run) => run.from);
  const beds = heard.map((b, k) => {
    const changedPlace = placeRuns.slice(1).some((run) => run.from <= b.from);
    const startSec = k === 0 && !changedPlace ? 0 : timeline.mapped ? b.from : roundMs(b.from);
    const end = Math.min(k + 1 < heard.length ? heard[k + 1].from : pictureSec,
      ...failedPlaceStarts.filter((from) => from > b.from));
    return {
      ...(timeline.mapped ? b : {}), file: b.file, fromScene: b.fromScene, startSec,
      seconds: timeline.mapped ? end - startSec : roundMs(Math.max(0.1, end - startSec)), gainDb: b.gainDb,
    };
  });
  const fallbackBeds = [];
  if (beds.length) for (const [index, run] of placeRuns.entries()) {
    const end = placeRuns[index + 1]?.from ?? pictureSec;
    let from = run.from;
    for (const bed of beds.filter((bed) => bed.startSec < end && bed.startSec + bed.seconds > from)) {
      if (bed.startSec > from) fallbackBeds.push({ startSec: from, seconds: bed.startSec - from });
      from = Math.max(from, Math.min(end, bed.startSec + bed.seconds));
    }
    if (from < end) fallbackBeds.push({ startSec: from, seconds: end - from });
  }
  for (const gap of fallbackBeds) notes.push(
    `place-bed-fallback: at ${gap.startSec.toFixed(3)}s no usable place bed; ${sound.roomTone === false ? "room underlay explicitly disabled" : "existing brown-noise underlay retained"}, no previous-place bed or new purchase`);
  return { voiceLufs, effects, beds, notes,
    ...(fallbackBeds.length && sound.roomTone !== false ? { fallbackBeds } : {}) };
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

/**
 * COP-311: a scribe writes two words it heard as one with a slash ("probiotic/an" for "probiotic and"): the
 * aligners read them as the words they are, as scout scribe.ts slashParts. A number ("1/2", "24/7") stays whole.
 */
function slashParts(word) {
  const parts = String(word ?? "").split("/").filter(Boolean);
  return parts.length > 1 && parts.every((p) => /\p{L}/u.test(p)) ? parts : [word];
}

/** { tokens, sourceIndex }: tokens[i] came from written word sourceIndex[i]. */
function spokenTokens(words, partsOf = (word) => [word]) {
  const tokens = [];
  const sourceIndex = [];
  words.forEach((word, i) => {
    for (const token of partsOf(word).flatMap(spokenWords)) {
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
 * The script's and the heard words' tokens as the aligner compares them, and
 * its word match: matches(e, h) when script token e is said by heard token h.
 * `slash`: both sides read a word written with a slash as its words (COP-311).
 */
function scriptTokens(words, written, slash = true) {
  const partsOf = slash ? slashParts : undefined;
  const scripted = spokenTokens(written, partsOf);
  const heardWords = spokenTokens(words.map((w) => w.w), partsOf);
  const nameLike = nameLikeWords(written);
  const names = scripted.tokens.filter((_, t) => nameLike[scripted.sourceIndex[t]]);
  const heard = joinSplitWords(heardWords, scripted.tokens, names);
  const expected = joinSplitWords(scripted, heard.tokens);
  const matches = (e, h) =>
    h < heard.tokens.length && sameWord(expected.tokens[e], heard.tokens[h], nameLike[expected.sourceIndex[e]]);
  return { heardWords, heard, expected, matches };
}

/**
 * Where the script's first complete, in-order delivery sits in the heard
 * words, or null. heardTokenOf/heardWordOf give the heard token and word that
 * deliver each (joined) script token; spokenWords lists every heard word that
 * carries a token. #3140: one scripted word misheard as another is paired with
 * the heard word in its place when the next scripted word follows it, but an
 * exact delivery wins. Mirrors scout scribe.ts alignScript.
 */
function alignScript(words, written) {
  // COP-311: read with the slash words split, else as written, so a take found before ("salt and/or pepper"
  // said "salt and pepper") is still found. Mirrors scout scribe.ts alignScript.
  return alignTokens(scriptTokens(words, written, true)) ?? alignTokens(scriptTokens(words, written, false));
}

function alignTokens({ heardWords, heard, expected, matches }) {
  if (expected.tokens.length === 0 || heard.tokens.length === 0) return null;
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

/** scriptTimes: sounds a speaker makes between words; one never stands in the place of a script word. */
const FILLER_TOKENS = new Set(["um", "umm", "uhm", "uh", "uhh", "er", "erm", "ah", "hmm", "mm", "mhm"]);
/**
 * COP-382: the fillers Luke's finish takes out at his medium and hard levels (post3.py FILL), "like" with
 * FILLER_LIKE_QUIET_SEC of quiet on both sides, and "you know" set off by a comma or that quiet (find_dead). Only a heard
 * word the script does not have is ever one (sentenceGapCuts).
 */
const FILLER_WORDS = new Set(["um", "uh", "umm", "uhm", "erm", "er", "hmm"]);
const FILLER_LIKE_QUIET_SEC = 0.15;
/** Luke's word for comparing (post3.py norm): small letters, digits, % and the apostrophe. */
const fillerNorm = (word) => String(word ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9%']/g, "");

/** COP-382: of the heard words at `indexes` (the script has none of them), the ones that are fillers (FILLER_WORDS). */
function fillerWords(words, indexes) {
  const out = new Set();
  const among = new Set(indexes);
  const quietBefore = (i) => i === 0 || words[i].s - words[i - 1].e >= FILLER_LIKE_QUIET_SEC - 1e-9;
  const quietAfter = (i) => i + 1 >= words.length || words[i + 1].s - words[i].e >= FILLER_LIKE_QUIET_SEC - 1e-9;
  for (const i of indexes) {
    const said = fillerNorm(words[i].w);
    if (FILLER_WORDS.has(said)) out.add(i);
    else if (said === "like" && i > 0 && i + 1 < words.length && quietBefore(i) && quietAfter(i)) out.add(i);
    else if (said === "you" && among.has(i + 1) && fillerNorm(words[i + 1].w) === "know" &&
      (/,$/.test(String(words[i + 1].w)) || quietAfter(i + 1)) && (i === 0 || /,$/.test(String(words[i - 1].w)) || quietBefore(i))) {
      out.add(i);
      out.add(i + 1);
    }
  }
  return out;
}

/** scriptTimes: a take with fewer of its script's tokens heard as written than this share is not the script misheard. */
const MIN_HEARD_SHARE = 0.5;

/**
 * COP-311, Mario's "Fix the text, never the times", for a take where
 * alignScript finds no delivery of the whole script in order: the script's
 * tokens and the heard ones are paired by their longest common run, with the
 * aligner's word match. The script tokens left between two pairs take the
 * time of the heard words left in their place, a filler ("um") never one of
 * them: one heard token each when the counts are the same, else, with one
 * heard token more (a word heard as two), the span of them shared evenly by
 * the script words there. Before the first pair or after the last, only one
 * heard token each: a lead-in ("Okay so") or a sign-off ("Thanks guys") is
 * not told apart from a misheard first or last word, so neither is shown.
 * Every other place times nothing: a script word dropped, or said over words
 * the script does not have, is not shown, and a heard word with no script
 * word in its place times nothing. A take with fewer than MIN_HEARD_SHARE of
 * its script tokens heard as written says something else: only those are
 * timed. A script word with a digit ("$23.08", "30%") is timed only where
 * its number words are heard as written ("dollars" may be heard as "oh"),
 * so a number said otherwise is never shown. `times[e]` is script token e's [start, end] on the heard words'
 * clock, or null.
 */
function scriptTimes(words, written) {
  const { heard, expected, matches } = scriptTokens(words, written);
  const n = expected.tokens.length;
  const m = heard.tokens.length;
  // run[e * (m + 1) + h]: the longest common run of script tokens e.. and heard tokens h..
  const run = new Int32Array((n + 1) * (m + 1));
  const at = (e, h) => run[e * (m + 1) + h];
  for (let e = n - 1; e >= 0; e--) {
    for (let h = m - 1; h >= 0; h--) {
      run[e * (m + 1) + h] = matches(e, h) ? at(e + 1, h + 1) + 1 : Math.max(at(e + 1, h), at(e, h + 1));
    }
  }
  // Each script token on its earliest heard token that keeps the run longest.
  const pairs = [[-1, -1]];
  for (let e = 0, h = 0; e < n && h < m; ) {
    if (matches(e, h)) pairs.push([e++, h++]);
    else if (at(e, h + 1) >= at(e + 1, h)) h++;
    else e++;
  }
  pairs.push([n, m]);
  const span = (from, to) => [words[heard.sourceIndex[from]].s, words[heard.lastSourceIndex[to]].e];
  const times = new Array(n).fill(null);
  const scriptHeard = pairs.length - 2 >= n * MIN_HEARD_SHARE;
  for (let k = 0; k + 1 < pairs.length; k++) {
    const [e0, h0] = pairs[k];
    const [e1, h1] = pairs[k + 1];
    if (e0 >= 0) times[e0] = span(h0, h0);
    const left = e1 - e0 - 1;
    if (!scriptHeard || left === 0) continue;
    const places = [];
    for (let h = h0 + 1; h < h1; h++) if (!FILLER_TOKENS.has(heard.tokens[h])) places.push(h);
    // At an end, a heard word more is a lead-in or a sign-off as likely as a word heard as two.
    if ((e0 < 0 || e1 === n) && places.length !== left) continue;
    if (places.length === left) {
      for (let i = 0; i < left; i++) times[e0 + 1 + i] = span(places[i], places[i]);
    } else if (places.length === left + 1) {
      const [gapStart, gapEnd] = span(places[0], places.at(-1));
      const owners = [...new Set(expected.sourceIndex.slice(e0 + 1, e1))];
      const share = (gapEnd - gapStart) / owners.length;
      for (let t = e0 + 1; t < e1; t++) {
        const u = owners.indexOf(expected.sourceIndex[t]);
        times[t] = [gapStart + u * share, gapStart + (u + 1) * share];
      }
    }
  }
  // A number token of a script word with a digit not heard as written: that word is not shown.
  const paired = new Set(pairs.slice(1, -1).map(([e]) => e));
  const numberToken = (token) => NUMBER_WORDS.has(token) || /\p{N}/u.test(token);
  const unheardNumbers = new Set();
  for (let e = 0; e < n; e++) {
    if (paired.has(e) || !numberToken(expected.tokens[e])) continue;
    for (let i = expected.sourceIndex[e]; i <= expected.lastSourceIndex[e]; i++) if (/\p{N}/u.test(written[i])) unheardNumbers.add(i);
  }
  for (let e = 0; e < n; e++) {
    for (let i = expected.sourceIndex[e]; i <= expected.lastSourceIndex[e]; i++) if (unheardNumbers.has(i)) times[e] = null;
  }
  return { expected, times };
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
/**
 * #4803 (a number of ours, for Daniel): reading a word's sound out past its listed edge at a pause level, a dip under
 * SOUND_DB this long or shorter is still the word (the hush before a "t", as in "eight").
 */
const PAUSE_EDGE_BRIDGE_SEC = 0.1;
/** #4803 (a number of ours, for Daniel): a run past such a dip is the word's when it comes within this of the word's loudest. */
const PAUSE_EDGE_WORD_DB = 12;
/** COP-382: how much of a filler's own sound a cut that takes it out must take (takeOut in sentenceGapCuts). */
const FILLER_COVER = 2 / 3;
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
 *
 * gapMax (COP-350, keepPauses): the longest silence between two sentences that
 * is kept whole, SENTENCE_GAP_MAX_SEC unless given. Infinity shortens no pause,
 * and only a sound in a break is cut.
 */
export function sentenceGapCuts(words, lines, levels = null, lineGap = null, jump = null, gapMax = SENTENCE_GAP_MAX_SEC) {
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
  const { expected, heard: heardTokens, heardTokenOf, heardWordOf, spokenWords: spoken } = aligned;
  // COP-355 (#4803): at one of Luke's pause levels, a pause's cut reads where the words' sound really ends and starts.
  const level = PAUSE_LEVELS.has(jump) && levels ? jump : null;
  const cuts = [];
  const cutPause = (earlier, later, { sentenceBreak, newLine, nextLine }) => {
    // Inside a sentence only jumpCut acts, and only on a pause over its longest.
    if (!sentenceBreak && !(jump && jumpCutSpan(earlier.e, later.s, jump))) return;
    const gap = later.s - earlier.e;
    const heard = levels && soundBetween(levels, earlier.e, later.s);
    // A sound's frame edges widen the cut, so none of it is left in.
    const sound = heard && { s: Math.max(floorFrame(heard.s), ceilFrame(earlier.e)), e: ceilFrame(heard.e) };
    const removed = sound ? sound.e - sound.s : 0;
    const spans = sound ? [sound] : [];
    // #4803: a word list can time a word late or far too short ("eight" listed from 4.50 s when it is heard from
    // 4.24 s), so at a level the air each side is kept from where the words' sound really ends and starts (heardEdge).
    // Which pauses are cut still goes by the listed gap.
    const wordEnd = level ? heardEdge(levels, earlier.e, 1, sound ? sound.s : later.s, peakDbOf(levels, earlier)) : earlier.e;
    const wordStart = level ? heardEdge(levels, later.s, -1, sound ? sound.e : wordEnd, peakDbOf(levels, later)) : later.s;
    const [breakMax, gapKeep] =
      lineGap && newLine ? [lineGap.max, lineGap.keep] : [gapMax, SENTENCE_GAP_KEEP_SEC];
    // jumpCut: a pause over its longest keeps its two edges, with a sound in it taken out whole.
    const jumped = Boolean(jump) && gap - removed > jump.maxGap + 1e-6;
    const paused = jumped || (sentenceBreak && gap - removed > breakMax + 1e-6);
    if (paused) {
      // Placed on the gap with the sound already out, then moved back past it.
      // Frame edges only ever widen what is kept, so the silence left stays
      // between the kept length and the longest allowed.
      const back = (t) => (sound && t > sound.s ? t + removed : t);
      const [keepAfter, keepBefore] = jumped ? [jump.keepAfter, jump.keepBefore] : [gapKeep / 2, gapKeep / 2];
      const after = ceilFrame(wordEnd + keepAfter);
      // COP-355: at one of Luke's pause levels, a sound that starts inside the air kept after the word takes that air
      // with it: the silence's cut starts with the sound's, so no piece of the pause of a frame or two is left between them.
      const s = jumped && PAUSE_LEVELS.has(jump) && sound && sound.s < after - 1e-6 ? sound.s : back(after);
      const e = back(floorFrame(wordStart - removed - keepBefore));
      if (e > s) spans.push({ s, e });
    }
    const merged = [];
    for (const span of spans.sort((x, y) => x.s - y.s)) {
      const prev = merged.at(-1);
      if (prev && span.s <= prev.e + 1e-6) prev.e = Math.max(prev.e, span.e);
      else merged.push({ ...span });
    }
    const kept = gap - merged.reduce((sum, c) => sum + c.e - c.s, 0);
    const split = lineGap && newLine && paused ? nextLine : null;
    merged.forEach(({ s, e }, m) => {
      const cut = { s, e, after: earlier.w, gap, kept, sound: Boolean(sound) };
      cuts.push(split !== null && m === merged.length - 1 ? { ...cut, atLine: split } : cut);
    });
  };
  // COP-382: at Luke's medium and hard levels the heard fillers the script does not have come out, and at hard the first
  // copy of a false start too (post_v2.py FILLER; post3.py find_dead): each with the air around it cut to the level.
  const fillersOut = jump === PAUSE_TRIMS.medium || jump === PAUSE_TRIMS.hard;
  const taken = new Set();
  // As the plain pause cut (#4803), the span starts no earlier than the word before's heard end and ends no later than the
  // word after's heard start (heardEdge), so neither neighbour loses any of itself. Inside those, a word list times an um
  // loosely (Scribe once listed one 40 ms long inside 220 ms of its sound), so with the take's loudness the span is the
  // filler's own sound, out to the quiet each side; where that runs on into the next word's heard start, the cut stops there.
  // A span held in by a neighbour that way can be a frame or two of an um whose sound runs on into the word (a picture jump
  // inside a still-heard um), so it is cut only when it takes at least FILLER_COVER (two thirds) of the filler's own sound:
  // the run of sound it sits in, out to the quiet each side, or to a neighbour's listed edge where the sound runs on into it.
  // The same holds for a false start's first copy.
  const takeOut = (earlier, first, last, later, what) => {
    const wordEnd = !earlier ? 0 : level ? heardEdge(levels, earlier.e, 1, first.s, peakDbOf(levels, earlier)) : earlier.e;
    const wordStart = level ? heardEdge(levels, later.s, -1, last.e, peakDbOf(levels, later)) : later.s;
    const from = levels ? soundRunEdge(levels, first.s, -1, wordEnd) : first.s;
    const to = levels ? soundRunEdge(levels, last.e, 1, wordStart) : last.e;
    const s = earlier ? Math.max(ceilFrame(wordEnd), Math.min(ceilFrame(wordEnd + jump.keepAfter), floorFrame(from))) : floorFrame(from);
    const e = to >= wordStart - 1e-6 ? floorFrame(wordStart) : Math.min(floorFrame(wordStart), Math.max(floorFrame(wordStart - jump.keepBefore), ceilFrame(to)));
    if (!(e > s + 1e-6)) return false;
    if (levels) {
      const ownFrom = soundRunEdge(levels, first.s, -1, earlier?.e ?? 0);
      const ownTo = soundRunEdge(levels, last.e, 1, later.s);
      const own = ownTo - ownFrom;
      if (own > 1e-6 && Math.min(e, ownTo) - Math.max(s, ownFrom) < own * FILLER_COVER - 1e-6) return false;
    }
    const gap = later.s - (earlier?.e ?? first.s);
    cuts.push({ s, e, after: earlier?.w ?? "", gap, kept: gap - (e - s), sound: false, ...what });
    return true;
  };
  // At hard, Luke's false starts, read on the heard words: a run of one to five said twice in a row, never across a full
  // stop, one word only when a comma follows it, and never a doubling the script writes itself ("very, very"), read in the
  // aligner's own tokens (spokenTokens, then joinSplitWords against the script's: a digit is its number words, a hyphenated
  // word is one token its heard halves join into), so "win-win" heard "win, win" and "5 5 5" heard "five, five five" are
  // the script's.
  if (jump === PAUSE_TRIMS.hard) {
    const said = (words ?? []).map((w) => fillerNorm(w.w));
    const scriptSide = spokenTokens(written);
    const script = ` ${scriptSide.tokens.join(" ")} `;
    const doubledOf = (from, to) => {
      const run = (words ?? []).slice(from, to).map((w) => w.w);
      return joinSplitWords(spokenTokens([...run, ...run]), scriptSide.tokens).tokens;
    };
    for (let i = 0; i < said.length; ) {
      const size = [5, 4, 3, 2, 1].find((n) => {
        if (i + 2 * n > said.length || said.slice(i, i + n).join(" ") !== said.slice(i + n, i + 2 * n).join(" ")) return false;
        const end = String(words[i + n - 1].w);
        if (/[.?!]["'”’)\]]*$/.test(end) || (n === 1 && !/,["'”’)\]]*$/.test(end))) return false;
        const doubled = doubledOf(i, i + n);
        return said.slice(i, i + n).every(Boolean) && doubled.length > 0 && !script.includes(` ${doubled.join(" ")} `);
      });
      if (size && takeOut(words[i - 1], words[i], words[i + size - 1], words[i + size], { start: words.slice(i, i + size).map((w) => w.w).join(" "), taken: words.slice(i, i + size) })) {
        for (let k = i; k < i + size; k++) taken.add(k);
        i += size;
      } else i += 1;
    }
  }
  for (let t = 0; t + 1 < heardWordOf.length; t++) {
    const to = heardWordOf[t + 1];
    if (heardWordOf[t] === to) continue;
    // A joined script token keeps its first word's line and lead-in.
    const [a, b] = [pieces[expected.sourceIndex[t]], pieces[expected.sourceIndex[t + 1]]];
    const newLine = a.li !== b.li;
    const keptWhole = WRITTEN_PAUSE.test(b.before) || lines[a.li].asksPause || lines[b.li].asksPause || (newLine && lines[a.li].cuesBeat);
    if (heardTokenOf[t + 1] !== heardTokenOf[t] + 1) {
      // #4806: at one of Luke's pause levels, a word heard between two script words that the script does not have (an
      // "um") is a heard word like any other: each pause from the earlier script word through it to the later one is
      // cut at the level. Neither word is touched, and the pauses a script word's place keeps whole stay whole.
      if (!PAUSE_LEVELS.has(jump) || keptWhole) continue;
      const from = heardTokens.lastSourceIndex[heardTokenOf[t]];
      const chain = [from, ...spoken.filter((w) => w > from && w < to), to];
      // COP-382: at medium and hard, a run of fillers among them goes, from the air kept after the word before it to the
      // air kept before the word after it; the pauses that touch no filler are cut at the level as before.
      const filler = fillersOut ? fillerWords(words, chain.slice(1, -1)) : new Set();
      for (let k = 0; k + 1 < chain.length; k++) {
        if (taken.has(chain[k]) || taken.has(chain[k + 1])) continue;
        if (filler.has(chain[k + 1])) {
          let j = k + 1;
          while (filler.has(chain[j + 1])) j++;
          const run = chain.slice(k + 1, j + 1);
          if (!run.some((w) => taken.has(w)) && takeOut(words[chain[k]], words[run[0]], words[run.at(-1)], words[chain[j + 1]], { filler: run.map((w) => words[w].w).join(" "), taken: run.map((w) => words[w]) })) {
            k = j;
            continue;
          }
        }
        cutPause(words[chain[k]], words[chain[k + 1]], { sentenceBreak: false, newLine: false, nextLine: null });
      }
      continue;
    }
    // A name heard split in two (#2300) ends on its last heard word.
    const [earlier, later] = [words[spoken.findLast((w) => w < to)], words[to]];
    const sentenceBreak = newLine || SENTENCE_END.test(b.before) || heardSentenceEnd(earlier.w);
    if (keptWhole) continue;
    cutPause(earlier, later, { sentenceBreak, newLine, nextLine: b.li });
  }
  // COP-382: a false start's span can take in the pauses around its words; overlapping spans are one cut, and say both.
  if (!cuts.some((c) => c.filler || c.start)) return cuts;
  const merged = [];
  for (const cut of [...cuts].sort((x, y) => x.s - y.s)) {
    const prev = merged.at(-1);
    if (prev && cut.s <= prev.e + 1e-6) {
      Object.assign(prev, { e: Math.max(prev.e, cut.e), ...(cut.filler ? { filler: cut.filler } : {}), ...(cut.start ? { start: cut.start } : {}), ...(cut.atLine !== undefined ? { atLine: cut.atLine } : {}),
        ...(cut.taken ? { taken: [...(prev.taken ?? []), ...cut.taken] } : {}) });
      prev.kept = prev.gap - (prev.e - prev.s);
    } else merged.push({ ...cut });
  }
  return merged;
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

/**
 * COP-382: from `from` in the take (`dir` 1 forward, -1 back), the edge of the run of sound windows (SOUND_DB or over) it
 * sits in, where the quiet starts; `bound` when the sound runs on to it.
 */
function soundRunEdge(levels, from, dir, bound) {
  const { db, windowSec } = levels;
  for (let i = dir > 0 ? Math.floor(from / windowSec + 1e-9) : Math.ceil(from / windowSec - 1e-9) - 1; i >= 0 && i < db.length; i += dir) {
    const t = dir > 0 ? i * windowSec : (i + 1) * windowSec;
    if (dir > 0 ? t >= bound - 1e-9 : t <= bound + 1e-9) return bound;
    if (db[i] < SOUND_DB) return t;
  }
  return bound;
}

/**
 * #4803: at one of Luke's pause levels, where a word's sound really ends (`dir` 1, from its listed end `from`) or starts
 * (`dir` -1, from its listed start) on the pause's side, never past `bound`. A run of windows at SOUND_DB or over, from
 * the listed edge or past a dip of PAUSE_EDGE_BRIDGE_SEC or less, is the word's when it comes within PAUSE_EDGE_WORD_DB
 * of the word's own loudest window (`wordPeakDb`): the rest of a word its list timed too short ("eight" listed from
 * 4.50 s and heard from 4.24 s, its "t" after a hush), where a breath, a click or a room's steady noise is quieter. The
 * edge only ever moves out into the pause.
 */
export function heardEdge(levels, from, dir, bound, wordPeakDb) {
  const { db, windowSec } = levels;
  const bridge = Math.round(PAUSE_EDGE_BRIDGE_SEC / windowSec);
  const step = dir > 0 ? 1 : -1;
  const inPause = (i) => i >= 0 && i < db.length && (dir > 0 ? i * windowSec < bound - 1e-9 : (i + 1) * windowSec > bound + 1e-9);
  const edgeOf = (i) => (dir > 0 ? Math.min(bound, (i + 1) * windowSec) : Math.max(bound, i * windowSec));
  let i = dir > 0 ? Math.ceil(from / windowSec - 1e-9) : Math.floor(from / windowSec + 1e-9) - 1;
  let edge = from;
  for (;;) {
    let dip = 0;
    while (inPause(i) && db[i] < SOUND_DB && dip <= bridge) { i += step; dip++; }
    if (!inPause(i) || dip > bridge) break;
    let loudest = -Infinity;
    let far = i;
    for (; inPause(i) && db[i] >= SOUND_DB; i += step) { loudest = Math.max(loudest, db[i]); far = i; }
    if (loudest < wordPeakDb - PAUSE_EDGE_WORD_DB) break;
    edge = edgeOf(far);
  }
  return dir > 0 ? Math.max(from, edge) : Math.min(from, edge);
}

/** The loudest window of a word's listed span, in dB; -Infinity for none. */
function peakDbOf(levels, word) {
  const { db, windowSec } = levels;
  let peak = -Infinity;
  for (let i = Math.floor(word.s / windowSec + 1e-9); i < db.length && i * windowSec < word.e - 1e-9; i++) peak = Math.max(peak, db[i]);
  return peak;
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

/**
 * manifest.scenes[].actionEvidence may carry {file, lead/tail: {
 * status:"absent", fromSec, toSec, detail}} from an existing source observation.
 * It must name these bytes and cover the whole reserved edge on the decoded
 * picture clock. Unknown, missing, partial or other-source evidence keeps time.
 */
function absentAction(seg, edge, startSec, endSec) {
  const evidence = seg.actionEvidence;
  const observed = evidence?.[edge];
  const delta = seg.map?.deltaSec ?? 0;
  return evidence?.file === seg.file && observed?.status === "absent" &&
    typeof observed.detail === "string" && observed.detail.trim().length > 0 &&
    Number.isFinite(observed.fromSec) && Number.isFinite(observed.toSec) &&
    observed.fromSec <= startSec + delta + 1e-6 && observed.toSec >= endSec + delta - 1e-6;
}

/**
 * An extra edge utterance must not take the later acting performance with it.
 * Remove its own picture/audio together, using the same clearance as join
 * trimming; never cross approved speech or manufacture quiet/held frames.
 */
function actingBeatSpeechCuts(seg, lines, clockSec, notes) {
  const span = scriptedSpan(seg.words, lines.map((line) => line.text));
  if (!span) return [];
  const cuts = [];
  const reserve = (words, edge, seconds, limitStart, limitEnd) => {
    if (!(seconds > 0) || !words.length ||
        words.some((word) => !Number.isFinite(word.s) || !Number.isFinite(word.e))) return;
    const s = Math.max(limitStart, floorFrame(Math.min(...words.map((word) => word.s)) - EXTRA_CLEARANCE_SEC));
    const e = Math.min(limitEnd, ceilFrame(Math.max(...words.map((word) => word.e)) + EXTRA_CLEARANCE_SEC));
    // No usable performance beyond the utterance: retain the existing edge trim.
    if (!(e > s) || (edge === "tail" ? e >= clockSec : s <= 0)) return;
    cuts.push({ s, e, after: `unapproved ${edge} speech`, gap: e - s, kept: 0 });
    notes.push(`acting-beat-extra-speech: scene ${seg.sceneIndex} removed ${s.toFixed(3)}–${e.toFixed(3)}s of source picture/audio together to retain authored ${edge} performance; inspect the resulting join, no action or clean audio is certified`);
  };
  reserve(seg.words.slice(0, span.first), "lead", seg.actionLeadSec,
    0, floorFrame(seg.words[span.first].s));
  reserve(seg.words.slice(span.last + 1), "tail", seg.actionTailSec,
    ceilFrame(seg.words[span.last].e), clockSec);
  return cuts;
}

// Director beats are ordered operations, even when they share a line anchor.
// Required phases describe the same operation, not another additive quota.
function authoredActionMinimum(scene) {
  const positive = (value) => Number.isFinite(value) && value > 0 ? value : 0;
  return Math.max(
    positive(scene?.actionLeadSec) + positive(scene?.actionTailSec),
    (scene?.directorBeats ?? []).reduce((sum, beat) => sum + positive(beat.timing?.minActionSec), 0),
    ...(scene?.actionPhases ?? []).filter((phase) => phase.required)
      .map((phase) => positive(phase.window?.minActionSec)),
  );
}

function retainActionMinimum(edit, scene, clockSec, speechCuts) {
  const minimum = authoredActionMinimum(scene);
  if (!edit || !(minimum > 0)) return;
  // Scene-boundary anchors remain known even if ASR cannot bind the other
  // endpoint (tonight's closing brand/model words are untagged and uncertain).
  if (scene.directorBeats?.some((beat) => beat.timing?.start?.boundary === "scene-start")) edit.headSec = 0;
  if (scene.directorBeats?.some((beat) => beat.timing?.end?.boundary === "scene-end")) edit.tailSec = floorFrame(clockSec);
  const excludedSeconds = () => speechCuts.reduce((sum, cut) =>
    sum + Math.max(0, Math.min(edit.tailSec, cut.e) - Math.max(edit.headSec, cut.s)), 0);
  const removed = edit.cuts.reduce((sum, cut) => sum + cut.endSec - cut.startSec, 0);
  if (edit.tailSec - edit.headSec - removed - excludedSeconds() >= minimum) return;
  // Existing silence is playable source, not a freeze or proof of the action.
  // Keep it before recovering edges; excluded utterances never count as action.
  edit.cuts = [];
  const limit = floorFrame(clockSec);
  edit.headSec = Math.max(0, floorFrame(edit.headSec));
  for (let attempt = 0; attempt <= speechCuts.length; attempt++) {
    const needed = Math.max(0, minimum + excludedSeconds() - (edit.tailSec - edit.headSec));
    const tail = Math.min(limit, ceilFrame(edit.tailSec + needed));
    const lead = Math.max(0, floorFrame(edit.headSec - Math.max(0, needed - (tail - edit.tailSec))));
    if (tail === edit.tailSec && lead === edit.headSec) break;
    edit.tailSec = tail;
    edit.headSec = lead;
  }
}

/** An approved native line owns its entire measured envelope, not just voiced
 * tokens. Cutting its interphrase silence creates an avoidable retention hold
 * when ASR splits or misspells a brand. Keep source first; QC still owns wording. */
function retainRequiredLineEnvelopes(seg, lines, scriptLines, edit, notes) {
  if (!edit) return;
  const measured = lines.flatMap((line) => {
    const words = lineSourceWords(seg.words, seg.lineIds, line, scriptLines);
    const window = envelope(heardWindows(words, seg.seconds));
    return window ? [{ ...window, lineId: line.lineId, unresolved: !equivalentAsrWording(line.text, words.map((word) => word.w)) }] : [];
  });
  // Missing edge tokens make ASR's first/last timestamps unsafe trim points.
  // Keep through the adjacent approved boundary, or the source edge when alone.
  const windows = measured.map((window) => window.unresolved ? {
    ...window,
    start: Math.max(0, ...measured.filter((other) => other !== window && other.end <= window.start).map((other) => other.end)),
    end: Math.min(seg.seconds, ...measured.filter((other) => other !== window && other.start >= window.end).map((other) => other.start)),
  } : window);
  const removed = edit.cuts.filter((cut) => windows.some((window) =>
    cut.startSec < window.end && cut.endSec > window.start));
  edit.cuts = edit.cuts.filter((cut) => !removed.includes(cut));
  for (const window of windows) {
    edit.headSec = Math.min(edit.headSec, Math.max(0, floorFrame(window.start - TEMPLATE_SPEECH_LEAD_SEC)));
    edit.tailSec = Math.max(edit.tailSec, Math.min(seg.seconds, ceilFrame(window.end + TEMPLATE_SPEECH_TAIL_SEC)));
  }
  if (removed.length) notes.push(`required-line-envelope-retained: scene ${seg.sceneIndex}: kept native interphrase audio for ${windows.map((window) => window.lineId).join(", ")}; wording remains a clip-QC finding`);
  return Math.max(0, ...windows.map((window) => window.end));
}

function tightenSentenceGaps(spine, reactionCues, scriptLines, readLevels, lineGap = null, jump = null, templateBoard = null, editingTreatment = null, notes = [], gapMax = SENTENCE_GAP_MAX_SEC) {
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
    const clockSec = Number.isFinite(scene?.durationSec) && scene.durationSec > 0
      ? Math.min(seg.seconds, scene.durationSec) : seg.seconds;
    // #4944: the acting-beat clock and its edge-speech cuts are template work; other runs cut as before.
    if (templateBoard && (seg.actionLeadSec > 0 || seg.actionTailSec > 0 || authoredActionMinimum(scene) > 0)) seg.actionClockSec = clockSec;
    const edgeCuts = !templateBoard || seg.wholeVoice ? [] : actingBeatSpeechCuts(seg, lines, clockSec, notes);
    if (edgeCuts.length) seg.words = seg.words.filter((word) =>
      !edgeCuts.some((cut) => word.s >= cut.s && word.e <= cut.e));
    const edit = templateBoard && !seg.wholeVoice ? templateSpeechEdit(seg.words, {
      durationSec: clockSec, lines, actionLeadSec: seg.actionLeadSec ?? 0,
      span: scriptedSpan(seg.words, lines.map((line) => line.text)),
      actionTailSec: seg.actionTailSec ?? 0, fps: FPS,
      direction: [templateBoard?.stageDirection, scene?.sceneDirection, scene?.shotDirection?.action, scene?.subjectAction],
      actionPhases: scene?.actionPhases, directorBeats: scene?.directorBeats,
      notes, sceneIndex: seg.sceneIndex,
      editingTreatment,
    }) : null;
    retainActionMinimum(edit, scene, clockSec, edgeCuts);
    const anchors = templateJoinAnchors(seg.words.filter((word) => !isZeroDurationSpeech(word)));
    const first = anchors.firstSec;
    const last = anchors.lastSec;
    const leadStart = edit?.headSec ?? Math.max(0, first - (seg.actionLeadSec ?? 0));
    const tailEnd = edit?.tailSec ?? Math.min(seg.seconds, last + (seg.actionTailSec ?? 0));
    if (first > leadStart && absentAction(seg, "lead", leadStart, first)) {
      seg.actionLeadSec = 0;
      if (edit) edit.headSec = Math.max(0, floorFrame(first -
        (editingTreatment?.dialogueBreath ? DIALOGUE_BREATH_LEAD_SEC : TEMPLATE_SPEECH_LEAD_SEC)));
      notes.push(`action-reservation-absent: scene ${seg.sceneIndex} opening action absent in source; shrank lead reservation, retained natural breath (${seg.actionEvidence.lead.detail})`);
    }
    if (tailEnd > last && absentAction(seg, "tail", last, tailEnd)) {
      seg.actionTailSec = 0;
      if (edit) edit.tailSec = Math.min(seg.seconds, ceilFrame(last +
        (editingTreatment?.dialogueBreath ? DIALOGUE_BREATH_TAIL_SEC : TEMPLATE_SPEECH_TAIL_SEC)));
      notes.push(`action-reservation-absent: scene ${seg.sceneIndex} closing action absent in source; shrank tail reservation, retained natural breath (${seg.actionEvidence.tail.detail})`);
    }
    const requiredLineEndSec = retainRequiredLineEnvelopes(seg, lines, scriptLines, edit, notes);
    // The board bounds discretionary action recovery, not required source
    // audio. Do not let the later join cap undo the envelope retained above.
    if (Number.isFinite(requiredLineEndSec) && Number.isFinite(seg.actionClockSec)) {
      seg.actionClockSec = Math.max(seg.actionClockSec, requiredLineEndSec);
    }
    const sentenceCuts = templateBoard
      ? edit && lineGap ? sentenceGapCuts(seg.words, lines, null, lineGap) : []
      : sentenceGapCuts(seg.words, lines, readLevels(seg.file), lineGap, jump, gapMax);
    const jumpCuts = (edit?.cuts ?? []).map((gap) => ({
      s: gap.startSec, e: gap.endSec, after: "speech", gap: gap.endSec - gap.startSec, kept: 0,
      atLine: sentenceCuts.find((cut) => cut.s < gap.endSec && cut.e > gap.startSec)?.atLine,
    }));
    const heardCuts = [...edgeCuts, ...(templateBoard ? jumpCuts : sentenceCuts)].sort((a, b) => a.s - b.s);
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
    if (Number.isFinite(seg.actionClockSec)) seg.actionClockSec -= removedBefore(seg.actionClockSec);
    seg.cuts = cuts.map(({ s, e, slots }) => (slots ? { s, e, slots } : { s, e }));
    // cutPace: where the take is split, in its time once the gaps are out.
    const splits = cuts.filter((c) => c.atLine !== undefined).map((c) => ({ at: c.s - removedBefore(c.s), line: c.atLine }));
    if (splits.length > 0) seg.splits = splits;
    // COP-382: a word taken out (a filler, a false start's first copy) leaves the take's words with its sound: the very
    // words its cut took (`taken`), never read off where its listed middle falls, which a cut can miss by a frame.
    const takenOut = new Set(cuts.flatMap((c) => c.taken ?? []));
    seg.words = seg.words.filter((w) => !takenOut.has(w)).map((w) => ({ ...w, s: w.s - removedBefore(w.s), e: w.e - removedBefore(w.s) }));
    seg.seconds -= removed;
    seg.clipSeconds -= removed;
    seg.note = withHow(
      seg.note,
      [
        ...new Set(
          cuts.map((c) =>
            c.start
              ? `false start "${c.start}" cut, said again after it`
              : c.filler
                ? `"${c.filler}" cut after "${c.after}", ${(c.e - c.s).toFixed(2)}s out`
                : c.sound
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

export function scenePlans(storyboard, planningBudget = null, selectedJobs = null, { template = false } = {}) {
  const plans = new Map();
  const script = new Map((storyboard?.script ?? []).map((line) => [line.lineId, line]));
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
    const sceneBeat = parseAuthoredBeat([scene.stageDirection, scene.performanceDirection, scene.sceneDirection]);
    const firstLine = script.get(scene.lineIds?.[0]);
    const lastLine = script.get(scene.lineIds?.at(-1));
    const firstBeat = parseAuthoredBeat([firstLine?.stageDirection, firstLine?.performanceDirection]);
    const lastBeat = parseAuthoredBeat([lastLine?.stageDirection, lastLine?.performanceDirection]);
    // Structured director timing owns placement; a bare "2 s silent beat"
    // in prose cannot move an authored post-line beat ahead of the speech.
    const directed = (scene.directorBeats ?? []).filter((beat) =>
      beat.timing?.start && beat.timing?.end && beat.timing.minActionSec > 0);
    const directedLead = directed.filter((beat) =>
      beat.timing.start.boundary === "scene-start" &&
      beat.timing.end.lineId === firstLine?.lineId && beat.timing.end.edge === "start")
      .reduce((sum, beat) => sum + beat.timing.minActionSec, 0);
    const directedTail = directed.filter((beat) =>
      beat.timing.start.lineId === lastLine?.lineId && beat.timing.start.edge === "end" &&
      beat.timing.end.boundary === "scene-end")
      .reduce((sum, beat) => sum + beat.timing.minActionSec, 0);
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
        // #4944: the air kept for a timed pause or a director beat is template work; a regular cut keeps dev's.
        !template ? 0 : directed.length ? directedTail : Math.max(sceneBeat.timedTailSec, lastBeat.timedTailSec),
      ),
      actionLeadSec: Math.max(
        typeof scene.actionLeadSec === "number" && scene.actionLeadSec > 0 ? scene.actionLeadSec : 0,
        !template ? 0 : directed.length ? directedLead : Math.max(sceneBeat.timedLeadSec, firstBeat.timedLeadSec),
      ),
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
 * #4835: the most air a join keeps before a scene's first word (trimJoins: the new-speaker beat, floored to a whole
 * frame, so up to one frame more).
 */
const OPENING_AIR_MAX_SEC = JOIN_LEAD_NEW_SPEAKER_SEC + 1 / FPS;

/**
 * #4835: a cutaway laid from a line's first word, when that line opens its scene, started after the scene's picture did:
 * the air a join keeps before the first word showed the speaking scene for a few frames (3 at 24 fps), then the
 * cutaway. A cutaway that starts inside that air (after its scene's first frame, no later than its first word) starts
 * on the scene's first frame instead, and its own first frame is held over the air (`leadHoldSec`), so every frame it
 * showed before stays where it was and its end does not move. A scene that opens on an action (actionLeadSec) keeps
 * it, a scene with more air than a join keeps is left as it is, and so is a shot copied from a source ad.
 */
export function coverOpeningAir(cutaways, spine) {
  const moves = cutaways.flatMap((c) => {
    // A shot copied from a source ad keeps its source's place.
    if (c.method === "source") return [];
    const owner = spine.find((seg) => seg.startSec < c.startSec - 1e-6 && c.startSec < seg.startSec + seg.seconds);
    if (!owner?.words?.length || owner.actionLeadSec > 0) return [];
    const air = c.startSec - owner.startSec;
    const firstWord = Math.min(...owner.words.map((w) => w.s));
    if (air > firstWord + 1e-6 || firstWord > OPENING_AIR_MAX_SEC + 1e-6) return [];
    // Another cutaway on that air already covers it, or starts with this one: nothing flashes, so nothing moves.
    if (cutaways.some((d) => d !== c && d.seconds > 0 && d.startSec <= c.startSec + 1e-6 && d.startSec + d.seconds > owner.startSec + 1e-6)) return [];
    return [{ c, from: owner.startSec, air }];
  });
  for (const { c, from, air } of moves) {
    c.startSec = from;
    c.seconds += air;
    c.leadHoldSec = air;
  }
}

/**
 * #4835: how long a cutaway holds its first frame before its clip plays; none when what is left of it after the hold
 * is under a frame (cut short inside the air), so the render never trims its clip to nothing.
 */
const cutawayLeadHold = (c) => (c.leadHoldSec > 0 && c.seconds - c.leadHoldSec >= 1 / FPS - 1e-9 ? c.leadHoldSec : 0);

/**
 * #4835: the frames of a cutaway moved back from `wasSec` to its scene's first frame at `startSec`. The render lays a
 * cutaway's frames from `setpts=...+<start>/TB` on the 24 fps clock, which ffmpeg truncates to a whole frame, so its
 * first frame landed on frame trunc(wasSec * FPS) (the start as written, to the millisecond). The moved cutaway's own
 * frames land there still, after `clones` copies of its first frame from the scene's `first` frame on, so every frame it
 * showed before is the one it shows now. Its frames are stamped half a frame past `first` (truncated to `first`) and it
 * is shown from half a frame before it, so a start written to the millisecond can never fall just after its frame.
 */
export function openingAirFrames(startSec, wasSec) {
  const first = Math.round(startSec * FPS);
  return { first, clones: Math.max(0, Math.trunc(Number(sec(wasSec)) * FPS) - first) };
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
function trimJoins(spine, reactionCues, scriptLines, gapMax = null, talkTrim = false, readLevels = () => null, notes = []) {
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
    if (Number.isFinite(seg.actionClockSec)) outSec = Math.min(outSec, Math.max(ceilFrame(lastWord), seg.actionClockSec));
    // Translate across already-removed interior time before consulting source
    // PCM. Recovery never crosses a later unapproved utterance.
    const rawTime = (time) => {
      let raw = time;
      for (const cut of seg.cuts ?? []) if (raw >= cut.s - 1e-6) raw += cut.e - cut.s;
      return raw;
    };
    const editedTime = (raw) => raw - (seg.cuts ?? []).reduce(
      (sum, cut) => sum + Math.max(0, Math.min(raw, cut.e) - cut.s), 0);
    const levels = readLevels(seg.file);
    if (activeSpeechEdge(levels, rawTime(outSec), rawTime(lastWord))) {
      const limit = after.length ? Math.min(seg.seconds, Math.min(...after.map((w) => w.s)) - EXTRA_CLEARANCE_SEC) : seg.seconds;
      const rawLimit = rawTime(limit);
      let quietStart = null;
      let recovered = null;
      for (let i = Math.ceil(rawTime(outSec) / levels.windowSec); i < levels.db.length && (i + 1) * levels.windowSec <= rawLimit + 1e-6; i++) {
        if (Number.isFinite(levels.db[i]) && levels.db[i] <= -38) {
          quietStart ??= i * levels.windowSec;
          const target = Math.min(limit, ceilFrame(editedTime(quietStart + TEMPLATE_SPEECH_TAIL_SEC)));
          if ((i + 1) * levels.windowSec - quietStart >= .12 - 1e-6 &&
              (i + 1) * levels.windowSec >= rawTime(target) - 1e-6) {
            recovered = target;
            break;
          }
        } else if (quietStart !== null || !Number.isFinite(levels.db[i])) {
          // A resumed voice after even a short break can be another utterance.
          // Never scan across that break looking for a more convenient release.
          break;
        }
      }
      if (recovered !== null && recovered > outSec) {
        notes.push(`speech-release-recovered: scene ${seg.sceneIndex} restored discarded source tail ${outSec.toFixed(3)}–${recovered.toFixed(3)}s with natural breath; no speech faded or regenerated`);
        outSec = recovered;
      } else if (outSec < limit) {
        notes.push(`speech-release-unresolved: scene ${seg.sceneIndex} kept original trim and approved speech; no measured release inside this utterance before EOF or a possible next utterance`);
      }
    }
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

/** A heard word that ends on a comma (a closing quote or bracket may follow it). */
const HEARD_COMMA = /,["'”’)\]]*$/;

/**
 * addedCuts (COP-355): Luke's locked rule for one take, on its own clock before the speed-up. `realCuts` are the
 * cuts the take holds already; its two edges count as cuts too. `whole` holds the
 * [start, end] spans of the lines no cut may fall inside. A place is the middle of the silence after a heard word that
 * ends a sentence or has a comma, when it is not inside a whole line. While the longest stretch between two cuts that runs
 * over `everySec` has a place at least ADDED_CUT.clearSec from both its ends, a cut goes at one: a sentence's end
 * before a comma, then the place nearest its middle. A stretch with no such place is left as it is (#4804). Returns the times
 * of the cuts added, in order, and the longest stretch left with no cut.
 */
export function addedCutPlan({ words, seconds, realCuts = [], joins = [], everySec, whole = [] }) {
  const places = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const rank = heardSentenceEnd(words[i].w) ? 0 : HEARD_COMMA.test(String(words[i].w ?? "")) ? 1 : null;
    if (rank === null) continue;
    // A pause that holds a cut already (`joins`, one too short to count) has its place on that cut's join, so the
    // framing changes with the picture's jump and not a few frames after it.
    const join = joins.filter((t) => t >= words[i].e - 1e-6 && t <= words[i + 1].s + 1e-6).at(-1);
    const t = join ?? (words[i].e + words[i + 1].s) / 2;
    if (!(t > 0 && t < seconds) || whole.some(([s, e]) => t > s && t < e)) continue;
    places.push({ t, rank });
  }
  const added = [];
  const stretches = () => {
    const marks = [...new Set([0, ...realCuts, ...added, seconds])].sort((a, b) => a - b);
    return marks.slice(1).map((to, k) => ({ length: to - marks[k], from: marks[k], to }));
  };
  const placesIn = (gap) => places.filter((p) =>
    p.t >= gap.from + ADDED_CUT.clearSec - 1e-9 && p.t <= gap.to - ADDED_CUT.clearSec + 1e-9 &&
    added.every((t) => Math.abs(p.t - t) > 0.01));
  // #4804: a stretch with no place (a line no cut falls inside) is passed over, and the next longest one over
  // `everySec` is cut, until none over it has a place.
  for (;;) {
    const gap = stretches()
      .filter((g) => g.length > everySec + 1e-9 && placesIn(g).length > 0)
      .reduce((best, g) => (!best || g.length > best.length + 1e-9 ? g : best), null);
    if (!gap) break;
    const mid = (gap.from + gap.to) / 2;
    const best = placesIn(gap).reduce((a, b) =>
      b.rank < a.rank || (b.rank === a.rank && Math.abs(b.t - mid) < Math.abs(a.t - mid) - 1e-9) ? b : a);
    added.push(best.t);
  }
  const longest = stretches().reduce((most, g) => Math.max(most, g.length), 0);
  return { added: added.map(r6).sort((a, b) => a - b), longest: r6(longest) };
}

/**
 * addedCuts: the cuts a talking segment holds already, on its own clock: each place a pause or a sound was cut out of
 * it, and how much went. The removals of one pause (no heard word between them) are one cut, at the last of them, where
 * the next word's picture starts. A cut counts (Luke's) where ADDED_CUT.realSec or more went.
 */
function breaksOf(seg) {
  const breaks = [];
  let removed = 0;
  for (const c of [...(seg.cuts ?? [])].sort((a, b) => a.s - b.s)) {
    const t = c.s - removed - (seg.inSec ?? 0);
    removed += c.e - c.s;
    const prev = breaks.at(-1);
    if (prev && !seg.words.some((w) => w.s > prev.t + 1e-6 && w.s < t - 1e-6)) Object.assign(prev, { t, length: prev.length + c.e - c.s });
    else breaks.push({ t, length: c.e - c.s });
  }
  return breaks.filter((b) => b.t > 1e-6 && b.t < seg.seconds - 1e-6).map((b) => ({ t: r6(b.t), counts: b.length >= ADDED_CUT.realSec - 1e-6 }));
}

/**
 * addedCuts: the frames where a take's framing changes, from the times of its cuts: on whole frames, in order, none
 * within FRAMING_MIN_FRAMES of the one before it or of the take's two edges (`frames` long). #4805: nor within
 * FRAMING_MIN_FRAMES of a jump the picture makes inside the take (`jumps`, frames), which is a cut already.
 */
export function framingFrames(times, frames, jumps = []) {
  const kept = [];
  for (const f of [...new Set(times.map((t) => Math.round(t * FPS)))].sort((a, b) => a - b)) {
    if (f < FRAMING_MIN_FRAMES || f > frames - FRAMING_MIN_FRAMES) continue;
    if (kept.length > 0 && f - kept.at(-1) < FRAMING_MIN_FRAMES) continue;
    if (jumps.some((j) => Math.abs(f - j) < FRAMING_MIN_FRAMES)) continue;
    kept.push(f);
  }
  return kept;
}

/**
 * #4805: where a take's own picture jumps (`fileJumps`, seconds on its file's clock) on the segment's clock: past the
 * pauses cut out of it before (seg.cuts, on the file's clock) and its trimmed lead-in. A jump inside a part cut out,
 * or outside the segment, is not on it.
 */
export function takeJumpTimes(seg, fileJumps) {
  const cuts = [...(seg.cuts ?? [])].sort((a, b) => a.s - b.s);
  const out = [];
  for (const r of fileJumps) {
    if (cuts.some((c) => r >= c.s - 1e-6 && r < c.e - 1e-6)) continue;
    const t = r - cuts.reduce((sum, c) => sum + (c.e <= r + 1e-6 ? c.e - c.s : 0), 0) - (seg.inSec ?? 0);
    if (t > 1e-6 && t < seg.seconds - 1e-6) out.push(r6(t));
  }
  return out;
}

/** addedCuts: where each script line of a talking segment is heard, [start, end] on the segment's clock, by line id. */
function lineSpans(seg, scriptLines) {
  const lines = seg.lineIds.map((id) => scriptWords(scriptLines.get(id)?.text));
  const spans = new Map();
  if (!lines.some((l) => l.length > 0)) return spans;
  const lineOf = lines.flatMap((ws, j) => ws.map(() => seg.lineIds[j]));
  const put = (i, s, e) => {
    const was = spans.get(lineOf[i]);
    spans.set(lineOf[i], was ? [Math.min(was[0], s), Math.max(was[1], e)] : [s, e]);
  };
  const aligned = alignScript(seg.words, lines.flat());
  if (aligned) {
    const { expected, heard, heardTokenOf } = aligned;
    heardTokenOf.forEach((h, e) => put(expected.sourceIndex[e], seg.words[heard.sourceIndex[h]].s, seg.words[heard.lastSourceIndex[h]].e));
    return spans;
  }
  // COP-311's reading when the script is not heard whole and in order: each script word on what was heard in its place.
  const { expected, times } = scriptTimes(seg.words, lines.flat());
  const timed = new Set();
  times.forEach((time, e) => {
    if (!time) return;
    put(expected.sourceIndex[e], time[0], time[1]);
    timed.add(expected.sourceIndex[e]);
  });
  // A line whose first or last word was not timed may still be spoken past its timed words: its span runs back to the
  // line before's last heard word and on to the next line's first (or the take's edges), so no cut lands in that part.
  const heard = new Map(spans);
  const words = new Set(expected.sourceIndex);
  let from = 0;
  seg.lineIds.forEach((id, j) => {
    const own = [...words].filter((i) => i >= from && i < from + lines[j].length);
    from += lines[j].length;
    const span = heard.get(id);
    if (!span || own.length === 0) return;
    const before = seg.lineIds.slice(0, j).map((k) => heard.get(k)).filter(Boolean).at(-1);
    const after = seg.lineIds.slice(j + 1).map((k) => heard.get(k)).find(Boolean);
    spans.set(id, [
      timed.has(Math.min(...own)) ? span[0] : (before?.[1] ?? 0),
      timed.has(Math.max(...own)) ? span[1] : (after?.[0] ?? seg.seconds),
    ]);
  });
  return spans;
}

/**
 * addedCuts: each talking segment's cuts added (addedCutPlan), and `seg.framing`, the frames of its own clock where its
 * framing changes: at every cut it counts, those it held and those added. A line marked whole that its words do not
 * show is taken to run through the whole take, so nothing is added there. Answers the cut's note.
 * COP-373 review, with COP-370: `headlineSec`, the timeline's first seconds a headline at the top may show
 * (HEADLINE_MAX_SEC at the cut's speed), holds no framing change: the headline is drawn on the finished frame, so a step
 * closer would move the head under it, into the room above the head take 1 was asked for. A cut counted there is still a
 * cut, in its own framing.
 */
function placeAddedCuts(spine, scriptLines, everySec, wholeLines, readJumps = () => [], headlineSec = 0) {
  const whole = new Set(wholeLines);
  const jumpsOf = new Map();
  let count = 0;
  let longest = 0;
  let segStart = 0;
  for (const seg of spine) {
    const startSec = segStart;
    segStart += seg.seconds;
    if (seg.source !== "clip" || seg.audio !== "clip" || !seg.words?.length || seg.reaction || seg.wholeVoice) continue;
    const spans = lineSpans(seg, scriptLines);
    const underHeadline = Math.min(seg.seconds, Math.max(0, headlineSec - startSec));
    const held = [
      ...(seg.lineIds ?? []).filter((id) => whole.has(id)).map((id) => spans.get(id) ?? [0, seg.seconds]),
      ...(underHeadline > 0 ? [[-1, underHeadline + 1 / FPS]] : []),
    ];
    const breaks = breaksOf(seg);
    const realCuts = breaks.filter((b) => b.counts).map((b) => b.t);
    // #4805: a jump the video service made inside the take is a cut the viewer sees: no stretch runs across it, and no
    // framing change lands within FRAMING_MIN_FRAMES of it.
    if (!jumpsOf.has(seg.file)) jumpsOf.set(seg.file, readJumps(seg.file) ?? []);
    const jumps = takeJumpTimes(seg, jumpsOf.get(seg.file));
    const plan = addedCutPlan({
      words: seg.words, seconds: seg.seconds, realCuts: [...realCuts, ...jumps], joins: breaks.map((b) => b.t), everySec, whole: held,
    });
    const frames = Math.round(seg.seconds * FPS);
    const jumpFrames = jumps.map((t) => Math.round(t * FPS));
    // COP-373 review: a pause cut too short to count is still a jump of the picture, so no framing change lands within
    // FRAMING_MIN_FRAMES of it (a zoom, then a jump a few frames later); an added cut placed on its join stays.
    const shortJoins = breaks.filter((b) => !b.counts).map((b) => Math.round(b.t * FPS))
      .filter((j) => !plan.added.some((t) => Math.round(t * FPS) === j));
    const framing = framingFrames([...realCuts.filter((t) => t >= underHeadline + 1 / FPS), ...plan.added], frames, [...jumpFrames, ...shortJoins]);
    const added = plan.added.filter((t) => framing.includes(Math.round(t * FPS)));
    const edges = [...new Set([0, ...framing, ...jumpFrames, frames])].sort((a, b) => a - b);
    longest = Math.max(longest, ...edges.slice(1).map((f, k) => (f - edges[k]) / FPS));
    // Set on every take the row reaches, even with no change, so its join with the take before it is seen to (framingAtJoins).
    seg.framing = framing;
    if (added.length > 0) {
      count += added.length;
      seg.note = withHow(seg.note, [`cuts added at ${added.map((t) => `${t.toFixed(2)}s`).join(", ")}`]);
    }
  }
  return `addedCuts: ${count} cut${count === 1 ? "" : "s"} added where ${everySec}s passed with no cut; ` +
    `the longest stretch left with no cut is ${longest.toFixed(1)}s`;
}

/** A segment's own zoom: plain, the pace pass's step or the punch-in. */
const ownZoomOf = (seg) => (seg.punchIn ? PUNCH_IN_SCALE : seg.paceZoom ? PACE_PASS.zoom : 1);

/** addedCuts: the zoom of a segment's other framing, against its own (plain, the pace pass's step or the punch-in). */
export function alternateZoom(seg) {
  const own = ownZoomOf(seg);
  return own > ADDED_CUT.tightPast ? own / ADDED_CUT.zoom : own * ADDED_CUT.zoom;
}

/**
 * addedCuts, once the spine's own framing is set (punch-ins, the pace pass's steps): a take the row reaches (`framing`
 * set) whose own zoom is within FRAMING_SAME_WITHIN of the zoom the take before it ends in starts in its other framing
 * (`otherFirst`), so the join between them still changes the picture. After a segment the row does not reach (a
 * reaction beat) the take keeps its own. Returns, by segment, whether it starts in its other framing.
 */
export function framingAtJoins(spine) {
  let last = null;
  return spine.map((seg) => {
    const own = ownZoomOf(seg);
    // A segment the row does not reach (a reaction beat): the join after it changes the picture already.
    if (!Array.isArray(seg.framing)) {
      last = null;
      return false;
    }
    const otherFirst = last !== null && Math.abs(last - own) / own < FRAMING_SAME_WITHIN;
    if (otherFirst) seg.otherFirst = true;
    last = (seg.framing.length + (otherFirst ? 1 : 0)) % 2 === 1 ? alternateZoom(seg) : own;
    return otherFirst;
  });
}

/**
 * addedCuts: where the cut changed a take's framing inside it (an added cut, or a pause cut that counts), in seconds
 * on the delivered film's clock: after the speed step, on the frame of the sped-up film that first shows it. The worker
 * joins a freeze that such a change splits, so its last guard reads a held picture as it would with no cut added.
 * Left out: a change under a cutaway, or within 1/24 s of the edge the film shows it at, where two freezes that meet
 * are two pictures. That edge can land a frame from the cutaway's own clock (one placed at 2.467 s first shows at
 * 2.5 s), so a change within FRAMING_NEAR_CUTAWAY frames of its edges on that clock is left out.
 */
export function framingChangeTimes(spine, speed = 1, cutaways = []) {
  const onFilm = (sec) => Math.round((sec / speed) * FPS) / FPS;
  const near = FRAMING_NEAR_CUTAWAY / FPS + 1e-6;
  const covered = cutaways.filter((c) => c.seconds > 0).map((c) => [onFilm(c.startSec) - near, onFilm(c.startSec + c.seconds) + near]);
  return spine.flatMap((seg) => (seg.framing ?? []).map((f) => onFilm(seg.startSec + f / FPS)))
    .filter((t) => !covered.some(([from, to]) => t >= from && t <= to));
}

/**
 * COP-373 review, addedCuts: where the cut added a cut, apart from the pause cuts that change the framing with the row
 * on: each of a take's framing changes that sits at none of its pause cuts (breaksOf, those too short to count among
 * them: an added cut placed on one sits at a pause join), on the clock framingChangeTimes gives. The worker tells a
 * flash here (the row's) from one at a pause cut's framing change, which the film made again without the cuts added
 * shows to be the row's or the pause cut's own (scout cut-additions.ts faultedAdditions).
 */
export function addedCutTimes(spine, speed = 1, cutaways = []) {
  const added = spine.map((seg) => {
    if (!Array.isArray(seg.framing)) return seg;
    const joins = new Set((seg.words ? breaksOf(seg) : []).map((b) => Math.round(b.t * FPS)));
    return { ...seg, framing: seg.framing.filter((f) => !joins.has(f)) };
  });
  return framingChangeTimes(added, speed, cutaways);
}

/**
 * #4805, pauseTrim: where a pause cut at one of Luke's levels joins a take to itself, in seconds on the delivered film's
 * clock (as framingChangeTimes), so the worker can tell a fault the trim made.
 */
export function pauseJoinTimes(spine, speed = 1) {
  const onFilm = (sec) => Math.round((sec / speed) * FPS) / FPS;
  return spine.flatMap((seg, k) => [
    // cutPace: a take split at a pause it cut (splitAtPauses) joins its two pieces at the second one's start.
    ...(k > 0 && seg.cuts?.length && samePiece(spine[k - 1], seg) ? [onFilm(seg.startSec)] : []),
    ...(seg.cuts?.length && seg.words ? breaksOf(seg).map((b) => onFilm(seg.startSec + b.t)) : []),
  ]);
}

/**
 * addedCuts: a segment's picture, `head` being its chain up to its own framing, split at `seg.framing` into pieces cut by
 * frame number, back to back, every other one in its other framing, and joined again with no sound: every frame is
 * kept, in order, and the segment's sound is not touched. Returns the graph's chains, the last one ending in [v<i>].
 */
function framedPicture(head, i, seg, own) {
  const zoom = alternateZoom(seg);
  const other = seg.zoomTop
    ? zoomedAtTop(zoom)
    : `scale=${even(WIDTH * zoom)}:${even(HEIGHT * zoom)},crop=${WIDTH}:${HEIGHT}:(iw-ow)/2:(ih-oh)*${ADDED_CUT.top},setsar=1`;
  // A take with no change of its own that starts in its other framing (framingAtJoins) plays in it whole.
  if (seg.framing.length === 0) return [`${head},${other}[v${i}]`];
  const first = seg.otherFirst ? 1 : 0;
  const edges = [0, ...seg.framing];
  const chains = [`${head},split=${edges.length}${edges.map((_, p) => `[fr${i}_${p}]`).join("")}`];
  edges.forEach((from, p) => {
    const to = edges[p + 1];
    const look = (p + first) % 2 === 0 ? own : [other];
    chains.push(
      `[fr${i}_${p}]trim=start_frame=${from}${to === undefined ? "" : `:end_frame=${to}`},setpts=PTS-STARTPTS` +
        `${look.length ? `,${look.join(",")}` : ""}[fz${i}_${p}]`,
    );
  });
  chains.push(`${edges.map((_, p) => `[fz${i}_${p}]`).join("")}concat=n=${edges.length}:v=1:a=0[v${i}]`);
  return chains;
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
 * COP-273 W2 cut, songEnd: where Luke's end cuts the song laid whole, before fitWholeVoice lays the spine on it. The
 * last sung word is the latest word end of the scenes with a stretch of the song (each scene's words on its own
 * stretch, as the song step heard them); the song then runs SONG_END_AFTER_SEC more, or to its own end if that is
 * sooner. Null when no scene on the song has a word: the song is laid as it is.
 *
 * W2 cut fix (M2): null too when the scene laid LAST on the song has no word time (the listen missed its line, and the
 * song step placed it in the tail): the song keeps its own end and the card the house rule, with one note in `notes`.
 */
export function songEndOf(spine, whole, notes = null) {
  const last = spine.findLast((seg) => whole.starts.has(seg.sceneIndex));
  if (last && !(last.words ?? []).some((w) => Number.isFinite(w.e))) {
    notes?.push(`song-end: scene ${last.sceneIndex}, the last on the song, has no word times, so the song keeps its own end and the end card goes as before`);
    return null;
  }
  const ends = spine.flatMap((seg) =>
    whole.starts.has(seg.sceneIndex) && seg.words?.length
      ? [whole.starts.get(seg.sceneIndex) + Math.max(...seg.words.map((w) => w.e).filter(Number.isFinite))]
      : []).filter(Number.isFinite);
  if (ends.length === 0) return null;
  const lastSungSec = Math.max(...ends);
  const seconds = Math.min(whole.seconds, lastSungSec + SONG_END_AFTER_SEC);
  // W2 end order: a song the worker already ended this way (to the ms) keeps its own end.
  if (whole.seconds - seconds < SONG_END_SAME_SEC) return { lastSungSec, seconds: whole.seconds, cutBySec: 0 };
  return { lastSungSec, seconds, cutBySec: Math.max(0, whole.seconds - seconds) };
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
  const reservedEnd = timeline.reservedNarration || timeline.narrationPictureReservation ? Math.max(0, ...timeline.spine
    .filter((seg) => seg.audio === "narration" && seg.fixedLength)
    .map((seg) => seg.startSec + Math.max(0, seg.seconds - (seg.holdSec ?? 0)))) : 0;
  const resolvedEnd = Math.max(0, ...[...timeline.spine, ...timeline.cutaways].flatMap((seg) =>
    (seg.motionProtection?.resolvedWindows ?? []).map((window) => window.endSec)));
  if (Math.max(authoredEnd, reservedEnd, resolvedEnd) > silenceStart + 1 / FPS) notes.push(
    `terminal-silence-authored: measured -50dB EOF silence starts ${silenceStart.toFixed(3)}s; ` +
    `resolved picture/acting reservation retained through ${Math.max(authoredEnd, reservedEnd, resolvedEnd).toFixed(3)}s, not claimed observed`);
  // #4585: the end card is quiet after the voice on purpose, so a cut with one is never trimmed short of its end.
  const cardEnd = timeline.endCard ? Math.max(0, ...timeline.spine.map((seg) => seg.startSec + seg.seconds)) : 0;
  const frames = Math.max(Math.ceil(silenceStart * FPS - 1e-6),
    Math.floor((lastWord + .3) * FPS + 1e-6), Math.ceil(authoredEnd * FPS - 1e-6),
    Math.ceil(reservedEnd * FPS - 1e-6), Math.ceil(resolvedEnd * FPS - 1e-6), Math.ceil(cardEnd * FPS - 1e-6));
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
  const scriptClock = planningBudget.scriptClock?.version === 1;
  const ceilingSeconds = scriptClock ? null : planningBudget.targetSeconds + overrun.seconds;
  // New script clocks report their measured runtime without a nominal-target veto.
  // Source coverage, frame/sample integrity and paid authorization remain independent.
  const measured = Number.isSafeInteger(render.frames) && render.frames > 0 &&
    pic?.ptsSec.length === render.frames && pic.ptsSec.every((t, k) => Number.isFinite(t) && Math.abs(t * FPS - k) <= 1e-3) &&
    Number.isFinite(pic.endSec) && Math.abs(pic.endSec * FPS - render.frames) <= 1e-3 &&
    (!map || render.frameDelta === 0) && (scriptClock || Number.isFinite(ceilingSeconds)) &&
    !findings.some((finding) => ["render-unmeasured", "render-picture-clock", "render-picture-grid", "render-frames"].includes(finding.code));
  const planningTiming = {
    basis: "decoded-final-picture-clock",
    finalSha256: null,
    planned: { targetSeconds: planningBudget.targetSeconds, overrun: { ...overrun }, ceilingSeconds,
      ...(scriptClock ? { scriptClock: planningBudget.scriptClock } : {}) },
    decoded: measured ? { frames: render.frames, fps: FPS, seconds: render.frames / FPS } : null,
    status: !measured ? "unknown" : scriptClock ? "script-derived" : render.frames > ceilingSeconds * FPS + 1e-7 ? "over-budget" : "within-budget",
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
 * Local release risk, not a voice/phoneme verdict: sustained energy beside the
 * last measured word warrants preserving source, never deleting speech. Unknown
 * levels do not prove a complete release. Click fades are unrelated to recovery.
 */
function activeSpeechEdge(levels, edgeSec, lastWordSec) {
  const step = levels?.windowSec;
  if (!(step > 0) || !Number.isFinite(lastWordSec) ||
      edgeSec < lastWordSec - step || edgeSec - lastWordSec > .35) return false;
  const end = Math.min(levels.db.length, Math.ceil(edgeSec / step));
  const tail = levels.db.slice(Math.max(0, end - 3), end);
  // Constant ambience/music is not speech evidence: require a measured quiet
  // floor elsewhere, in addition to word proximity and sustained edge energy.
  return tail.length === 3 && tail.every((db) => Number.isFinite(db) && db > -38) &&
    levels.db.some((db) => Number.isFinite(db) && db <= -48);
}

/**
 * Local repair inputs on manifest.scenes: availableTakes contains approved,
 * already-paid compatible {clip, words, wordsFrom:"clip",
 * wordsDescribe:"this-file", approved:true} files, never URLs. A replacement
 * must retain the selected take's entire word/line sequence and quiet release.
 * actionEvidence, if supplied, belongs to each take's own source picture clock.
 */
function repairSpeechTakes(manifest, plans, { exists, probe, readWords, readLevels, notes }) {
  if (manifest?.clipAudio === "discard" || manifest?.wholeVoice ||
      manifest?.clipAudio !== "keep" && manifest?.templateMotion?.enabled !== true) return manifest;
  const scenes = (manifest.scenes ?? []).map((scene) => {
    const plan = plans.get(scene.sceneIndex);
    if (!plan || plan.cutaway || plan.narrated || scene.wordsFrom === "voice" ||
        !exists(scene.clip) || scene.wordsDescribe === "original-performance") return scene;
    const clip = probe(scene.clip);
    const words = readWords(scene.words);
    if (!clip.hasAudio || !words?.length) return scene;
    const last = Math.max(...words.filter((w) => !isZeroDurationSpeech(w)).map(wordEnd));
    if (!activeSpeechEdge(readLevels(scene.clip), clip.seconds, last)) return scene;
    const transcript = (rows) => rows.map((w) => `${w.lineId ?? ""}:${wordToken(w.w)}`).join("|");
    for (const take of scene.availableTakes ?? []) {
      if (take.approved !== true || take.wordsDescribe !== "this-file" ||
          take.wordsFrom !== "clip" || !exists(take.clip)) continue;
      let alternate;
      try { alternate = probe(take.clip); }
      catch { continue; } // A failed optional source cannot discard the usable winner.
      const heard = readWords(take.words);
      if (!alternate.hasAudio || !heard?.length || transcript(heard) !== transcript(words)) continue;
      const end = Math.max(...heard.map(wordEnd));
      const levels = readLevels(take.clip);
      const released = levels?.db.slice(Math.ceil(end / levels.windowSec),
        Math.ceil((end + TEMPLATE_SPEECH_TAIL_SEC) / levels.windowSec));
      if (!(alternate.seconds >= end + TEMPLATE_SPEECH_TAIL_SEC) || !released?.length ||
          !released.every((db) => Number.isFinite(db) && db <= -38)) continue;
      const handles = plan.actionLeadSec > 0 || plan.actionTailSec > 0;
      // An unproven handle can hold the cut, so a take with no action evidence
      // of its own never replaces a winner that has some.
      if (handles && scene.actionEvidence && !take.actionEvidence) {
        notes.push(`speech-release-take-skipped: scene ${scene.sceneIndex} kept ${scene.clip}: ${take.clip} has no action evidence of its own to replace the measured action`);
        continue;
      }
      notes.push(`speech-release-take: scene ${scene.sceneIndex} replaced ${scene.clip} with already-paid approved ${take.clip}; identical heard words retained`);
      // Never transplant another file's event clock. The replacement's own
      // legacy endpoints and new edge receipts coexist on its evidence object.
      if (handles) notes.push(
        `action-proof-unproven: scene ${scene.sceneIndex} uses only the replacement take's own action evidence`);
      return { ...scene, clip: take.clip, words: take.words, wordsDescribe: "this-file",
        actionEvidence: take.actionEvidence };
    }
    notes.push(`speech-release-unresolved: scene ${scene.sceneIndex} has sustained energy at source EOF beside its last word; clip and approved speech kept, no complete local approved take; a fade is not a repair`);
    return scene;
  });
  return { ...manifest, scenes };
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

/**
 * COP-273 P4f cut: a run that filmed one video call for one to three sung lines gives every scene the call covers the
 * call's one clip (the manifest's `songCall`). The cut plays each call's WHOLE clip as one piece, sped up or slowed
 * down to last exactly the call's stretch of the song laid whole, with hard cuts between calls (Luke's guide 4.7). The
 * pull says it asks for this cut (`songCallCut`); a cut script that does not fit the clips never sees that marker, and
 * this script refuses a call run pulled without it. The server and the worker hold the same rule in
 * video/lib/songCallFit.ts (a test keeps the two the same).
 */
export const SONG_CALL_CUT = "fit";
/**
 * The lead's ruling of Nov 15: no speed limit, as Luke's chosen cut (song_combo.py `cut`). A call played slower than
 * this, or faster than SONG_CALL_NOTE_FASTER, gets a note for a person to look at; it is never refused or trimmed.
 */
export const SONG_CALL_NOTE_SLOWER = 0.75;
export const SONG_CALL_NOTE_FASTER = 2;

/**
 * The fit of a clip of `clipSec` to a call's `callSec` of the song: `speed`, the clip's seconds played in a second of
 * the song (over 1 sped up). Fitted from its probed length, the whole clip is shown; from the seconds it was ordered at
 * (fix round 2, S3), a longer clip loses its end and a shorter one holds its last frame. Null only when a length is not
 * there to divide.
 */
export function songCallFit(clipSec, callSec) {
  if (!(clipSec > 0) || !(callSec > 0)) return null;
  return { speed: clipSec / callSec };
}

const scenesWords = (scenes) => (scenes.length === 1
  ? `scene ${scenes[0]}` : `scenes ${scenes.slice(0, -1).join(", ")} and ${scenes.at(-1)}`);

/** Why a call run is not cut: a call's clip has no length to read (an empty or broken file), so it cannot be fitted. */
export function songCallUnreadSentence(scenes) {
  return `The clip of ${scenesWords(scenes)} has no length to read, so this video was not cut. Pull it again.`;
}

/** The note for a call played slower than SONG_CALL_NOTE_SLOWER or faster than SONG_CALL_NOTE_FASTER, or null. */
export function songCallSpeedNote(scenes, speed) {
  if (speed >= SONG_CALL_NOTE_SLOWER && speed <= SONG_CALL_NOTE_FASTER) return null;
  // Fix round 2 (S7): two places, so 2.04 never reads as "2.0", inside the range.
  return `song-call-speed: the clip of ${scenesWords(scenes)} plays at ${speed.toFixed(2)} times its filmed speed`;
}

/**
 * P4f cut fix 2 (S3, the lead's ruling): a call is fitted from the seconds its clip was ORDERED at, as Luke's chosen
 * cut divides them by the call's stretch (the prompt's shot times were scaled by the same number). A clip whose real
 * length is further than this from its order gets one note.
 */
export const SONG_CALL_ORDER_GAP_SEC = 0.5;

/**
 * W2 cut fix (M1): what a clip played from its start at `speed` for `callSec` of the song leaves: its last seconds not
 * shown, or its last frame held.
 */
export function songCallShownTail(probedSec, callSec, speed) {
  const shownSec = callSec * speed;
  return probedSec >= shownSec
    ? `its last ${(probedSec - shownSec).toFixed(2)}s not shown`
    : `its last frame held ${(callSec - probedSec / speed).toFixed(2)}s`;
}

/**
 * The note for a clip more than SONG_CALL_ORDER_GAP_SEC off the seconds it was ordered at, or null. `cutSec` (W2 cut
 * fix, M1): the seconds of the call's stretch songEnd cut off; the clip is still fitted at its order's speed.
 */
export function songCallLengthNote(scenes, probedSec, orderedSec, speed, cutSec = 0) {
  if (!(probedSec > 0) || !(orderedSec > 0) || Math.abs(probedSec - orderedSec) <= SONG_CALL_ORDER_GAP_SEC) return null;
  const tail = cutSec > 0 ? songCallShownTail(probedSec, orderedSec / speed - cutSec, speed)
    : probedSec > orderedSec
    ? `its last ${(probedSec - orderedSec).toFixed(2)}s not shown`
    : `its last frame held ${((orderedSec - probedSec) / speed).toFixed(2)}s`;
  return `song-call-length: the clip of ${scenesWords(scenes)} is ${probedSec.toFixed(2)}s long, ordered at ${orderedSec.toFixed(2)}s; the cut fits the ordered ${orderedSec.toFixed(2)}s, ${tail}`;
}

/** Why a call run is not cut when `--skip` names some of a call's scenes and not all of them. */
export function songCallPartSkippedSentence(scenes) {
  return `${scenesWords(scenes).replace(/^s/, "S")} share one clip, so they are cut together or left out together: name all of them in --skip, or none.`;
}

/**
 * P4f cut fix 2 (M1): why a call run is not cut when only some of a call's scenes hold its clip in the cut (a scene's
 * copy did not land, and --still-fill held its keyframe instead): the whole clip fitted to the part left would play
 * one line's picture under another. `pullAgain`: a scene left out has no copy in the folder, so a new pull mends it.
 */
export function songCallPartMissingSentence(scenes, absent, pullAgain, runId) {
  const head = `${scenesWords(scenes).replace(/^s/, "S")} share one clip, and ${scenesWords(absent)}`;
  const one = absent.length === 1;
  return pullAgain
    ? `${head} ${one ? "has" : "have"} no copy of it in this folder, so the clip cannot be fitted to its lines and this video was not cut. Pull it again: exodus video pull ${runId}`
    : `${head} ${one ? "is" : "are"} not in the cut, so the clip cannot be fitted to its lines and this video was not cut.`;
}

/**
 * P4f cut fix 2 (M1): refuses when a call is only partly on the spine as its clip. A call wholly off it (all skipped)
 * is left out together, as --skip asks.
 */
function refusePartCalls(songCalls, spine, manifest, exists) {
  const listed = new Map((manifest?.scenes ?? []).map((scene) => [scene.sceneIndex, scene]));
  for (const call of songCalls) {
    const on = new Set(spine.filter((seg) => seg.source === "clip" && seg.songCallOf === call.first).map((seg) => seg.sceneIndex));
    if (on.size === 0 || on.size === call.scenes.length) continue;
    const absent = call.scenes.filter((n) => !on.has(n));
    const pullAgain = absent.some((n) => !exists(listed.get(n)?.clip));
    throw new FirstCutError(1, songCallPartMissingSentence(call.scenes, absent, pullAgain, manifest.runId ?? "<runId>"));
  }
}

/** COP-273 P4f: why a run of video calls is not cut without its song laid whole. */
export const SONG_CALL_NO_WHOLE_SONG =
  "This video films one to three sung lines in each clip, and its song is not in this folder to lay under them whole, so it was not cut. Pull it again: exodus video pull <runId>";

/** P4f cut: why a call run pulled by an exodus that does not ask for the fitted cut is not cut (version skew). */
export const SONG_CALL_OLD_PULL =
  "This folder was pulled by an older exodus, which does not say that this video's clips are fitted to their lines, so it was not cut. Update exodus, then pull it again: exodus video pull <runId>";

/**
 * P4f cut fix 2 (S1): a member's own pull of a call run (its scenes keyed `index`; exodus video.ts planCustomerPull)
 * holds each scene's slice of the song and no song laid whole, so its clips cannot be fitted here. The app cuts every
 * such video itself (convex lib/video/autoCut.ts isCustomerVideoRun); the folder is for an editor.
 */
export const SONG_CALL_MEMBER_FOLDER =
  "The app cuts this video itself, each clip fitted to its lines over the song laid whole, and this folder holds the pieces for an editor, not the whole song in one file, so it was not cut here. See where the app's cut is: exodus video status <runId>";

/** P4f cut: why a call run is not cut on the measured map, which never retimes a picture. */
export const SONG_CALL_NO_MEASURED_MAP =
  "This video's clips are fitted to their lines by speed, which the measured cut never does, so it was not cut.";

/**
 * The calls of a pulled call run, in scene order: each call's first scene, its scenes, and its clip's file (every
 * scene's file is a copy of the call's one clip). Scenes with no `songCall` are no call's.
 */
function songCallsOfManifest(manifest) {
  const calls = new Map();
  for (const scene of manifest?.scenes ?? []) {
    const first = scene?.songCall?.sceneIndex;
    if (!Number.isInteger(first)) continue;
    const call = calls.get(first) ?? { first, scenes: [] };
    call.scenes.push(scene.sceneIndex);
    calls.set(first, call);
  }
  return [...calls.values()].map((c) => ({ ...c, scenes: c.scenes.sort((a, b) => a - b) })).sort((a, b) => a.scenes[0] - b.scenes[0]);
}

/**
 * Fits each call of the spine (P4f cut): its scenes keep their own stretches of the song laid whole (for the words,
 * the captions and the reports), and the call's first scene carries the one piece the render plays: the call's whole
 * clip, at `speed`, for the frames its scenes take together, whatever the speed; a call under 0.75x or over 2x gets a
 * note (the cut's notes and the scene's), never a refusal.
 *
 * W2 cut fix (M1): `songCutSec` is what songEnd cut off the song laid whole (on the frame clock). The call that holds
 * the last scene on the song was ordered for the longer stretch, so it is fitted at the speed of that order (its
 * stretch plus `songCutSec`): every shot inside it stays on its line, and its last part is not shown.
 */
function fitSongCalls(spine, notes, songCutSec = 0) {
  const groups = new Map();
  for (const seg of spine) {
    if (!seg.songCallOf) continue;
    const group = groups.get(seg.songCallOf) ?? [];
    group.push(seg);
    groups.set(seg.songCallOf, group);
  }
  const lastOnSong = songCutSec > 0 ? spine.findLast((seg) => seg.wholeVoice) : null;
  for (const group of groups.values()) {
    const scenes = group.map((seg) => seg.sceneIndex);
    const frames = group.reduce((n, seg) => n + Math.round(seg.seconds * FPS), 0);
    const callSec = frames / FPS;
    const cutSec = lastOnSong && group.includes(lastOnSong) ? songCutSec : 0;
    // Fix round 2 (S3): the seconds the clip was ordered at, when the pull hands them on; else its probed length.
    const probedSec = group[0].clipSeconds;
    const orderedSec = probedSec > 0 ? group[0].songCallOrderedSec ?? null : null;
    const fit = songCallFit(orderedSec ?? probedSec, cutSec > 0 ? callSec + cutSec : callSec);
    if (!fit) throw new FirstCutError(1, songCallUnreadSentence(scenes));
    // A clip shorter than its order ends before its stretch does: its last frame holds for the rest, so the piece is
    // still exactly its frames and nothing after it moves. The last call's cut-off part needs no frame held.
    const padSec = orderedSec ? Math.max(0, (orderedSec - probedSec) / fit.speed - cutSec) : 0;
    // Fix round 2 (S7): each scene's place in the call's stretch (`atSec`) and the clip the render reads (`clip`), so the
    // reports read a later scene at its real place in the clip and at the call's speed, not from 0 at 1x.
    let atSec = 0;
    group.forEach((seg, k) => {
      seg.holdSec = 0;
      // Fix round 2 (found by the real render): the scene's own fit before the call's (a trim, a held last frame) is
      // not what plays: the call plays its whole clip.
      seg.note = seg.note.replace(/clip trimmed [\d.]+s -> [\d.]+s(, )?/, "").replace(/last frame held [\d.]+s(, )?/, "").replace(/ \(\)$/, "");
      seg.callFit = { speed: fit.speed, scenes, atSec, clip: group[0].file, ...(k === 0 ? { frames, ...(padSec > 0 ? { padSec } : {}) } : {}) };
      atSec += seg.seconds;
    });
    const note = songCallSpeedNote(scenes, fit.speed);
    if (note) notes.push(note);
    const lengthNote = orderedSec ? songCallLengthNote(scenes, probedSec, orderedSec, fit.speed, cutSec) : null;
    if (lengthNote) notes.push(lengthNote);
    // W2 cut fix (M1): the last call at the speed of its order shows only its stretch's worth of its clip.
    const endTail = cutSec > 0 ? songCallShownTail(probedSec, callSec, fit.speed) : null;
    if (endTail) notes.push(`song-end: the clip of ${scenesWords(scenes)} keeps the speed of its order, ${roundMs(fit.speed)}x; ${endTail.replace(/ not shown$/, " are not shown").replace(/ held /, " is held ")}`);
    // Fix round 3 (review R1): fitted from its order, a longer clip loses its end and a shorter one holds its last
    // frame; the line says which, with the seconds, under the half second that makes a note as well.
    const gapTail = cutSec > 0 ? (lengthNote ? null : endTail) : !orderedSec || lengthNote ? null
      : probedSec > orderedSec ? `its last ${(probedSec - orderedSec).toFixed(2)}s not shown`
      : `its last frame held ${((orderedSec - probedSec) / fit.speed).toFixed(2)}s`;
    group[0].note = withHow(group[0].note, [
      cutSec > 0
        ? `the clip of ${scenesWords(scenes)} played from its start at ${roundMs(fit.speed)}x, the speed of its ${(orderedSec ?? probedSec).toFixed(2)}s on the ${(callSec + cutSec).toFixed(2)}s it was ordered for; the song's end was cut, so the film keeps ${callSec.toFixed(2)}s of it`
        : orderedSec
        ? `the clip of ${scenesWords(scenes)} played from its start at ${roundMs(fit.speed)}x, its ordered ${orderedSec.toFixed(2)}s fitted to its ${callSec.toFixed(2)}s of the song`
        : `the clip of ${scenesWords(scenes)} played whole at ${roundMs(fit.speed)}x to last its ${callSec.toFixed(2)}s of the song`,
      ...(gapTail && !/ 0\.00s/.test(gapTail) ? [gapTail] : []),
      ...(note ? [note.replace(/^song-call-speed: the clip of .+? plays/, "it plays")] : []),
      ...(lengthNote ? [lengthNote.replace(/^song-call-length: the clip of .+? is/, "it is")] : []),
    ]);
    for (const seg of group.slice(1)) seg.note = withHow(seg.note, [`inside the clip of ${scenesWords(scenes)}, played as one piece`]);
  }
}

function assembleTimeline({
  manifest, storyboard, skip, probe, exists, readWords, readLevels = () => null, stillFill = false, finish = null,
  wholeVoice = null, sourceAd = null, measure = null, readJumps = () => [],
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
    if (!manifest.planningBudget?.scriptClock && Number.isFinite(requested) && Math.abs(reserved - requested) > .001) {
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
  // COP-273 P4f cut: each call's whole clip is fitted to its stretch of the song laid whole, and played as one piece.
  const songCalls = songCallsOfManifest(manifest);
  if (songCalls.length) {
    const runId = manifest.runId ?? "<runId>";
    const memberFolder = manifest.scenes.some((scene) => scene?.songCall && !Number.isInteger(scene.sceneIndex) && Number.isInteger(scene.index));
    if (memberFolder) throw new FirstCutError(1, SONG_CALL_MEMBER_FOLDER.replace("<runId>", runId));
    if (manifest.songCallCut !== SONG_CALL_CUT) throw new FirstCutError(1, SONG_CALL_OLD_PULL.replace("<runId>", runId));
    if (!wholeVoice || reservedNarration) throw new FirstCutError(1, SONG_CALL_NO_WHOLE_SONG.replace("<runId>", runId));
    if (measure) throw new FirstCutError(1, SONG_CALL_NO_MEASURED_MAP);
    const part = songCalls.find((call) => call.scenes.some((n) => skip.has(n)) && !call.scenes.every((n) => skip.has(n)));
    if (part) throw new FirstCutError(1, songCallPartSkippedSentence(part.scenes));
  }
  const nativeBudget = !measure && manifest?.templateMotion?.enabled === true ? manifest.planningBudget : null;
  const plans = scenePlans(storyboard, measure || selectedJobs ? manifest.planningBudget : nativeBudget, selectedJobs, { template });
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
  const levelCache = new Map();
  const loadLevels = readLevels;
  readLevels = (file) => {
    if (!levelCache.has(file)) levelCache.set(file, loadLevels(file));
    return levelCache.get(file);
  };
  if (template || keepClipAudio) {
    const probes = new Map();
    const loadProbe = probe;
    probe = (file) => {
      if (!probes.has(file)) probes.set(file, loadProbe(file));
      return probes.get(file);
    };
  }
  manifest = repairSpeechTakes(manifest, plans, { exists, probe, readWords, readLevels, notes });
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
        ...(Number.isInteger(scene.songCall?.sceneIndex) ? { songCallOf: scene.songCall.sceneIndex } : {}),
        ...(scene.songCall?.orderedSec > 0 ? { songCallOrderedSec: scene.songCall.orderedSec } : {}),
        ...(m ? { map: m } : {}),
        ...(scene.actionEvidence ? { actionEvidence: scene.actionEvidence } : {}),
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
  // COP-273 W2 cut, songEnd: the song laid whole ends SONG_END_AFTER_SEC after its last sung word. Never on the
  // measured map, whose song keeps its own decoded end.
  const songEnd = finish?.songEnd === true && laid && !laid.measured && !reservedNarration ? songEndOf(spine, laid, notes) : null;
  if (finish?.songEnd === true && laid?.measured) notes.push(songEndMeasuredNote(finish.songEditing));
  const whole = laid && !reservedNarration ? fitWholeVoice(spine, songEnd ? { ...laid, seconds: songEnd.seconds } : laid) : null;
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
  // jumpCut stays off a template launch's cut, whose selected clocks and windows hold their real time. pauseTrim
  // (COP-355, a run's saved sheet) is jumpCut with one of Luke's pause levels in place of its numbers.
  const trim = finish?.pauseTrim && !template ? PAUSE_TRIMS[finish.pauseTrim] : null;
  const jump = trim ?? (finish?.jumpCut && manifest?.templateMotion?.enabled !== true ? JUMP_CUT : null);
  // keepPauses (COP-350, a run's saved sheet): no pause inside a talking clip is shortened, neither a long sentence gap
  // nor jumpCut's (no gap limit, no jump, no split); a sound in a break that is no heard word is still cut (#2554). A
  // template launch's own speech edit runs as before.
  const keepPauses = finish?.keepPauses === true && !template;
  if (keepPauses) notes.push("keepPauses: no pause inside a clip is shortened; a sound in one that is no heard word is still cut");
  else if (trim) notes.push(`pauseTrim ${finish.pauseTrim}: a pause over ${trim.maxGap}s inside a clip is cut to about ${trim.keepAfter + trim.keepBefore}s`);
  tightenSentenceGaps(spine, reactionCues, scriptLines, readLevels, keepPauses ? null : lineGap, keepPauses ? null : jump,
    template ? storyboard : null, template ? manifest.templateMotion.editingTreatment : null, notes,
    keepPauses ? Infinity : SENTENCE_GAP_MAX_SEC);
  // pauseTrim: each join inside a take fades its sound (PAUSE_JOIN_FADE_SEC); a level cuts close to the words.
  if (trim && !keepPauses) for (const seg of spine) if (seg.cuts?.length) seg.joinFadeSec = PAUSE_JOIN_FADE_SEC;
  trimJoins(spine, reactionCues, scriptLines, pace ? PACE_GAP_MAX_SEC : null, finish?.talkTrim === true,
    template || keepClipAudio ? readLevels : undefined, notes);
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
  // addedCuts (COP-355, a run's saved sheet): the framing changes where a take runs too long with no cut; no time and
  // no sound moves. A template's clock or a measured map keeps its framing.
  if (finish?.addedCuts) {
    // With no line marked whole (no board, no script text) nothing says where a cut may not go, so none is added.
    notes.push(template || measure
      ? "addedCuts: a cut on a template's clock or a measured map keeps its framing, so no cut was added"
      : !finish.wholeLines?.length
        ? "addedCuts: no line of the script is marked whole, so no cut was added"
        : placeAddedCuts(spine, scriptLines, ADDED_CUTS[finish.addedCuts], finish.wholeLines, readJumps,
          finish.cards && finish.cardPlace === "top" ? HEADLINE_MAX_SEC * (finish.pacePass ? finish.paceSpeed ?? PACE_PASS.speed : 1) : 0));
  }
  // COP-382: a headline for the whole film takes every step closer from the top edge (zoomTop), so the head stays below it.
  if (finish?.cards && finish.cardPlace === "top-film") {
    for (const seg of spine) seg.zoomTop = true;
  }
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
  if (songCalls.length) {
    refusePartCalls(songCalls, spine, manifest, exists);
    // W2 cut fix (M1): what songEnd cut off the last scene's stretch, on the frame clock fitWholeVoice lays it on.
    fitSongCalls(spine, notes, songEnd ? ceilFrame(laid.seconds) - ceilFrame(songEnd.seconds) : 0);
  }
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
  // #4835: a cutaway starting in the air before its scene's first word starts with that scene instead.
  if (!measure && !template) coverOpeningAir(cutaways, spine);
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
    // COP-273 W2 cut: where the last sung word ends and whether the song was cut short, on the cut's clock.
    ...(whole && songEnd ? { songEnd: {
      lastSungSec: roundMs(whole.startSec + songEnd.lastSungSec),
      cutBySec: roundMs(songEnd.cutBySec),
    } } : {}),
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
    ...(template && selectedJobs && manifest.templateMotion.narrationPictureReservation === true
      ? { narrationPictureReservation: true } : {}),
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

/** Clock readback only: retained seconds never certify a performed operation. */
export function sceneDurationReadback(timeline, board, speed = 1) {
  const shots = sceneTimes(timeline, true);
  const scenes = (board?.scenes ?? []).map((scene) => {
    const keptSec = r6(shots.filter((shot) => shot.scene === scene.sceneIndex)
      .reduce((sum, shot) => sum + shot.seconds / speed, 0));
    const minimum = authoredActionMinimum(scene);
    return {
      sceneIndex: scene.sceneIndex,
      plannedSec: Number.isFinite(scene.durationSec) ? scene.durationSec : null,
      keptSec, actionMinimumSec: r6(minimum),
      actionShortfallSec: r6(Math.max(0, minimum - keptSec)),
      clock: timeline.spine.some((seg) => seg.sceneIndex === scene.sceneIndex && seg.wholeVoice)
        ? "whole-voice" : "source-and-board",
    };
  });
  return {
    plannedSec: r6(scenes.reduce((sum, scene) => sum + (scene.plannedSec ?? 0), 0)),
    keptSec: r6(scenes.reduce((sum, scene) => sum + scene.keptSec, 0)),
    scenes,
  };
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
    // #4835: judged on its own clip's time, as before its first frame was held over its scene's opening air.
    const lead = cutawayLeadHold(c);
    const shown = (c.seconds - lead) / speed;
    if (c.motionProtection || shown >= minSec - 1e-6) {
      kept.push(c);
      continue;
    }
    const why = `cutaway ${c.sceneIndex}: ${shown.toFixed(2)}s on screen, under the ${minSec}s B-roll minimum, so it is left out and`;
    const before = kept.at(-1);
    if (before && !before.motionProtection && Math.abs(before.startSec + before.seconds - (c.startSec + lead)) < 0.5 / FPS) {
      before.seconds = roundMs(c.startSec + c.seconds - before.startSec);
      if (c.cutShortBy) before.cutShortBy = c.cutShortBy;
      else delete before.cutShortBy;
      const hold = before.source === "clip" ? roundMs(before.seconds - cutawayLeadHold(before) - clipSeconds(before.file)) : 0;
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
      .map((seg) => (seg.callFit
        // P4f cut fix 2 (S7): a call's scene is its stretch of the call's clip, at the call's speed.
        ? { n: seg.sceneIndex, role: roleOf(seg), file: seg.file, from: seg.callFit.atSec * seg.callFit.speed, sec: seg.seconds * seg.callFit.speed }
        : { n: seg.sceneIndex, role: roleOf(seg), file: seg.file, from: seg.inSec ?? 0, sec: seg.seconds - (seg.holdSec ?? 0) })),
    ...timeline.cutaways
      .filter((c) => c.source === "clip")
      .map((c) => ({ n: c.sceneIndex, role: "b-roll", file: c.file, from: 0, sec: c.seconds - cutawayLeadHold(c), cutaway: c })),
  ].filter((s) => s.sec > 0);
  const measured = shots.map((s) => ({ ...s, motion: motionOf(s.file, s.from, s.sec) }));
  const notes = [];
  for (const slow of slowShots(measured)) {
    const c = slow.cutaway;
    if (!c || c.motionProtection) continue;
    const have = clipSeconds(c.file);
    const played = c.seconds - cutawayLeadHold(c);
    if (!(have > played + 0.05)) {
      notes.push(`cutaway ${c.sceneIndex} barely moves, but its clip (${have.toFixed(2)}s) is no longer than its time on screen (${c.seconds.toFixed(2)}s), so it plays as it is`);
      continue;
    }
    c.speed = roundMs(Math.min(have / played, SLOW_SHOT_SPEED_MAX));
    notes.push(`cutaway ${c.sceneIndex} barely moves, so it plays ${c.speed}x faster: ${(played * c.speed).toFixed(2)}s of its clip in ${c.seconds.toFixed(2)}s`);
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
 * (read from the folder ffmpeg runs in) after the speed step, on the finished
 * cut's clock, `speed` over 1 speeds the whole cut, picture and sound, `clean` (cleanVoice) is the voice's
 * chain and the duck under it, and `meters` (cutChecks) names the two files
 * the voice and everything under it are also written to. `pcmMix` keeps the
 * render's sound uncompressed, for a mix the loudness pass then encodes once.
 * COP-357: `look` lays the lens smudge (`smudge`, its side) and the phone pass
 * on the joined takes before anything else touches the picture, with `probe`
 * splitting them off first to LOOK_PROBE's side files, and `deliverFps`
 * repeats the finished picture's frames to that rate, last.
 */
export function buildFfmpegArgs(timeline, { resolve, music, out, finish = null, sound = null, voiceOnly = false }) {
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
    // COP-273 P4f cut: a call's later scenes play inside the one piece its first scene carries.
    if (seg.callFit && !seg.callFit.frames) continue;
    const i =
      seg.source === "clip"
        ? addInput("-i", resolve(seg.file))
        : addInput("-loop", "1", "-t", String(seg.seconds), "-i", resolve(seg.file));
    if (mapped) {
      pairs.push(mappedPiece(seg, i, { addInput, filters, tails, level, resolve }));
      continue;
    }
    if (seg.callFit) {
      // The call's whole clip from its start, at its speed, on exactly the frames its scenes take; the song laid
      // whole is its only sound. The pad covers a frame lost to rounding, and (fix round 2, S3) a clip shorter than
      // the seconds it was ordered at, whose last frame then holds to the end of its stretch.
      const { speed, frames, padSec = 0 } = seg.callFit;
      const pad = padSec > 0 ? Math.ceil(padSec) + 1 : 1;
      filters.push(`${norm(`${i}:v`)},setpts=PTS-STARTPTS,${speedStep(speed.toFixed(6))},` +
        `tpad=stop_mode=clone:stop_duration=${pad},trim=end_frame=${frames},setpts=PTS-STARTPTS[v${i}]`);
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${sec(frames / FPS)}[a${i}]`);
      pairs.push(`[v${i}][a${i}]`);
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
        // pauseTrim (COP-355): a short fade in and out at each join inside the take; no length changes. A piece shorter
        // than two fades fades over half its length at each end, so neither fade starts before it nor runs past it.
        const fade = seg.joinFadeSec;
        const length = p < cuts.length ? Number(kept[2 * p + 1].toFixed(6)) - Number(kept[2 * p].toFixed(6)) : Infinity;
        const d = fade && length < 2 * fade ? (Math.max(0, length) / 2).toFixed(6) : fade;
        const fades = !fade ? "" : `${p > 0 ? `,afade=t=in:d=${d}` : ""}${p < cuts.length
          ? `,afade=t=out:st=${Math.max(0, length - Number(d)).toFixed(6)}:d=${d}` : ""}`;
        filters.push(`[ap${i}_${p}]atrim=start=${kept[2 * p].toFixed(6)}${end},asetpts=PTS-STARTPTS${fades}[aq${i}_${p}]`);
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
    // addedCuts (COP-355): a segment with framing changes is split by frame into pieces, every other one in its other framing.
    const own = seg.zoomTop
      ? [...(seg.punchIn ? [zoomedAtTop(PUNCH_IN_SCALE)] : []), ...(seg.paceZoom ? [zoomedAtTop(PACE_PASS.zoom)] : [])]
      : [...(seg.punchIn ? [PUNCH_IN] : []), ...(seg.paceZoom ? [PACE_ZOOM] : [])];
    // voiceOnly (COP-353): the voice-alone pass draws no picture.
    if (!voiceOnly) {
      if (seg.framing?.length > 0 || (seg.framing && seg.otherFirst)) filters.push(...framedPicture(`${norm(`${i}:v`)}${fit.length ? `,${fit.join(",")}` : ""}`, i, seg, own));
      else {
        fit.push(...own);
        filters.push(`${norm(`${i}:v`)}${fit.length ? `,${fit.join(",")}` : ""}[v${i}]`);
      }
    }
    // A segment split around a reaction beat starts partway into its sound too.
    const skipIn = inSec > 0.001 ? `atrim=start=${sec(inSec)},asetpts=PTS-STARTPTS,` : "";
    const [fadeIn, fadeOut] = [seg.fadeInSec ?? EDGE_FADE_SEC, seg.fadeOutSec ?? EDGE_FADE_SEC];
    // A cubic rise keeps a reaction's quiet start near silent until its laugh (#2666).
    const rise = fadeIn > EDGE_FADE_SEC ? ":curve=cub" : "";
    // #4585: the end card's held picture runs on in silence after the segment's own sound has faded out.
    const sounding = seg.seconds - (seg.endCardHoldSec ?? 0);
    const fitLength =
      `apad,atrim=0:${sec(sounding)},afade=t=in:d=${sec(fadeIn)}${rise},` +
      `afade=t=out:st=${sec(sounding - fadeOut)}:d=${sec(fadeOut)}` +
      (seg.endCardHoldSec ? `,apad,atrim=0:${sec(seg.seconds)}` : "");
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
    pairs.push(voiceOnly ? `[a${i}]` : `[v${i}][a${i}]`);
  }

  filters.push(voiceOnly
    ? `${pairs.join("")}concat=n=${pairs.length}:v=0:a=1[voicecat]`
    : `${pairs.join("")}concat=n=${pairs.length}:v=1:a=1[vcat][voicecat]`);
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
      // COP-273 W2 cut, songEnd: a song cut short of its own end fades over the film's last SONG_END_FADE_SEC.
      const fadeOut = timeline.songEnd?.cutBySec > 0
        ? `,afade=t=out:st=${Math.max(0, pictureSec - SONG_END_FADE_SEC).toFixed(6)}:d=${SONG_END_FADE_SEC}`
        : "";
      filters.push(
        `[${k}:a]${stereo},${level},adelay=delays=${Math.round(timeline.wholeVoice.startSec * 1000)}:all=1,` +
          `apad,atrim=end=${pictureSec.toFixed(6)}${fadeOut}[whole]`,
      );
    }
    filters.push("[spoken][whole]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[voice]");
  } else {
    filters.push(`[voicecat]apad,${toPicture}[voice]`);
  }
  // voiceOnly (COP-353): the voice alone after the chain `finish.clean` names, as the render joins it, with no picture
  // and nothing under it (the silences the worker's guard reads; COP-354: the voice's level a room bed is set against);
  // a reaction's tail, which is not the spoken voice, left out.
  if (voiceOnly) {
    filters.push(...tails.map((label) => `${label}anullsink`));
    filters.push(`[voice]${finish?.clean?.voice ?? "anull"}[measured]`);
    return ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"), "-map", "[measured]", "-c:a", "pcm_s16le", out];
  }

  let videoLabel = "vcat";
  // COP-357, the phone look: on the joined takes, before any cutaway, picture, end card or burned word is laid over them.
  // Fix A: with a picture pass, the takes are first split off to the probe, which reads them before the look.
  if (finish?.look?.probe) {
    filters.push(`[${videoLabel}]split=2[lookin][lookprobe]`, `[lookprobe]${lookProbeFilter(finish.look.probeMinSec)}`);
    videoLabel = "lookin";
  }
  if (finish?.look?.smudge) {
    filters.push(...lensSmudgeFilters(videoLabel, finish.look.smudge, "smudged"));
    videoLabel = "smudged";
  }
  if (finish?.look?.phonePass) {
    filters.push(`[${videoLabel}]${phonePassFilter()}[phoned]`);
    videoLabel = "phoned";
  }
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
    // #4835: one that starts with its scene holds its first frame over the scene's opening air (openingAirFrames).
    const lead = cutawayLeadHold(c);
    const air = lead > 0 ? openingAirFrames(c.startSec, c.startSec + lead) : null;
    const from = air ? (air.first - 0.5) / FPS : c.startSec;
    const at = air ? (air.first + 0.5) / FPS : c.startSec;
    const held = air?.clones ? `,setpts=PTS-STARTPTS,tpad=start_mode=clone:start=${air.clones}` : "";
    filters.push(
      `${norm(`${i}:v`)}${faster}${hold},trim=${c.inSec ? sec(c.inSec) : 0}:${sec((c.inSec ?? 0) + c.seconds - lead)}${held},setpts=PTS-STARTPTS+${sec(at)}/TB[cv${j}]`,
    );
    // eof_action=pass keeps the spine showing once the cutaway's frames end.
    filters.push(
      `[${videoLabel}][cv${j}]overlay=enable=between(t\\,${sec(from)}\\,${sec(end)}):eof_action=pass[ov${j}]`,
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
  // endCardLayers: the brand's ground over the whole frame and the pack photo in its box, pushing in slowly, made as
  // one card on its own clock and dissolved in over the last picture (#4585: never the ground alone, never black).
  if (finish?.endCard) {
    const e = finish.endCard;
    const box = END_CARD_PHOTO_BOX;
    const w = even((box[2] - box[0]) * WIDTH);
    const h = even((box[3] - box[1]) * HEIGHT);
    const frames = Math.max(1, Math.round(e.seconds * FPS));
    const length = sec(e.out - e.in);
    const k = addInput("-loop", "1", "-t", length, "-i", resolve(e.file));
    filters.push(`color=c=0x${e.colors.background}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${length},format=yuv420p[ecground]`);
    filters.push(
      `[${k}:v]fps=${FPS},scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x${e.colors.background},setsar=1,` +
        `zoompan=z=1+${END_CARD_PUSH_IN}*on/${frames}:x=iw/2-(iw/zoom/2):y=ih/2-(ih/zoom/2):d=1:s=${w}x${h}:fps=${FPS},` +
        `format=yuv420p[ecpic]`,
    );
    filters.push(
      `[ecground][ecpic]overlay=x=${Math.round(box[0] * WIDTH)}:y=${Math.round(box[1] * HEIGHT)},` +
        `format=yuva420p,fade=t=in:st=0:d=${e.fadeSec ?? END_CARD_FADE_SEC}:alpha=1,setpts=PTS-STARTPTS+${sec(e.in)}/TB[ecbody]`,
    );
    // COP-273 W2 cut, light editing (songEndCardOf): the picture dips to black into the card, under it.
    if (e.dip) {
      const d = e.dip;
      const length = roundMs(d.lead + d.out);
      filters.push(
        `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${length},format=yuva420p,fade=t=in:st=0:d=${d.in}:alpha=1,` +
          `fade=t=out:st=${d.lead}:d=${d.out}:alpha=1,setpts=PTS-STARTPTS+${sec(d.from)}/TB[ecdip]`,
      );
      filters.push(`[${videoLabel}][ecdip]overlay=enable=between(t\\,${sec(d.from)}\\,${sec(d.from + length)}):eof_action=pass[ecdipped]`);
      videoLabel = "ecdipped";
    }
    filters.push(`[${videoLabel}][ecbody]overlay=enable=between(t\\,${sec(e.in)}\\,${sec(e.out)}):eof_action=pass[ecard]`);
    videoLabel = "ecard";
  }
  const speed = finish?.speed > 1 ? finish.speed : null;
  if (speed) {
    // COP-300: on the frames' own 1/24 clock, setpts rounds each faster time to a whole tick and `-r` then shows the
    // picture about 1.5 frames late; on a fine clock, `fps` puts each frame on the 24 fps tick nearest its true time.
    filters.push(`[${videoLabel}]${speedStep(speed)}[faster]`);
    videoLabel = "faster";
  }
  // COP-384: a run's sheet's extra shots (EXTRA_SHOTS), on the finished cut's own frames, after the speed step and
  // under the burned words: each from its clip's `clipFromSec`, at `playSpeed`, settling from `zoomFrom`; a split one on
  // the top with the person's strip below, made from these same frames.
  const xs = finish?.extraShots?.shots?.length ? finish.extraShots : null;
  if (xs) {
    const E = EXTRA_SHOTS;
    // Each shot on the film's own frames, its first and its count: the overlays' windows run from half a frame before
    // its first frame to half a frame before the frame after its last, so no rounding of a time moves it by a frame.
    const windowOf = (s) => {
      const { first, frames } = shotFrames(s);
      return { first, frames, shown: `between(t,${sec((first - 0.5) / FPS)},${sec((first + frames - 0.5) / FPS)})` };
    };
    const splits = xs.shots.filter((s) => s.layout === "split");
    /** The person's strip of each split shot, by the shot's place in `xs.shots`. */
    const strips = new Map();
    if (splits.length > 0) {
      // The strip is made from the film's frames as they pass, every frame, next to the film: a strip cut out of the
      // film for its window alone (a trim of a split) makes the film wait in memory for every frame before the window.
      // The film widened with a blurred copy of itself is shared by the split shots (their margin is the same); the
      // blur and the overlay work in the windows alone, and each shot's crop is cut from it.
      const anyWindow = splits.map((s) => windowOf(s).shown).join("+");
      // A shot showing the person smaller (splitCaptionPlace) widens the canvas; each crop keeps its place on the frame.
      const margin = Math.max(...splits.map((s) => s.split.margin));
      filters.push(`[${videoLabel}]split=2[xsbase][xsrc]`);
      filters.push(`[xsrc]split=2[xsa][xsb]`);
      filters.push(`[xsa]scale=${WIDTH + 2 * margin}:${HEIGHT},boxblur=${E.blur}:enable='${anyWindow}'[xsbg]`);
      filters.push(`[xsbg][xsb]overlay=${margin}:0:enable='${anyWindow}'[xscv]`);
      const canvases = splits.length > 1 ? splits.map((_, j) => `xscv${j}`) : ["xscv"];
      if (splits.length > 1) filters.push(`[xscv]split=${splits.length}${canvases.map((c) => `[${c}]`).join("")}`);
      splits.forEach((s, j) => {
        const k = xs.shots.indexOf(s);
        const { stripH, crop: [wc, hc, x0, y0] } = s.split;
        filters.push(`[${canvases[j]}]crop=${wc}:${hc}:${x0 + margin - s.split.margin}:${y0},scale=${WIDTH}:${stripH},setsar=1[xst${k}]`);
        strips.set(k, `xst${k}`);
      });
      videoLabel = "xsbase";
    }
    xs.shots.forEach((s, k) => {
      const { first, frames, shown } = windowOf(s);
      const hh = s.layout === "split" ? s.split.splitH : HEIGHT;
      // The clip runs one frame past its window: an overlay whose second stream has ended passes the film through on the
      // frame it ends at. Its first frame is put on the film's frame `first` exactly, in whole ticks of its clock.
      const i = addInput("-ss", sec(E.clipFromSec), "-t", sec((frames / FPS) * E.playSpeed + E.clipFromSec + 0.5), "-i", resolve(s.file));
      filters.push(
        `[${i}:v]setpts=PTS/${E.playSpeed},fps=${FPS},scale=${2 * WIDTH}:${2 * hh}:force_original_aspect_ratio=increase,crop=${2 * WIDTH}:${2 * hh},` +
          `zoompan=z='max(1,${E.zoomFrom}-${round2(E.zoomFrom - 1)}*on/${E.zoomFrames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${WIDTH}x${hh}:fps=${FPS},` +
          `setsar=1,trim=end_frame=${frames + 1},setpts=PTS-STARTPTS+round(${first}/(${FPS}*TB))[xs${k}]`,
      );
      filters.push(`[${videoLabel}][xs${k}]overlay=0:0:eof_action=pass:enable='${shown}'[xo${k}]`);
      videoLabel = `xo${k}`;
      if (!strips.has(k)) return;
      filters.push(`[${videoLabel}][${strips.get(k)}]overlay=0:${s.split.splitH}:enable='${shown}'[xp${k}]`);
      videoLabel = `xp${k}`;
    });
  }
  // COP-300: burned after the speed step, on the finished cut's own frames, so no speed step can move the captions
  // off the voice. The ASS file is timed on that clock (editAss `speed`).
  if (finish?.ass) {
    // COP-382: the fonts the cut carries (captionFontsDir), only when the file names one of them.
    filters.push(`[${videoLabel}]subtitles=filename=${finish.ass}${finish.fontsDir ? `:fontsdir=${filterPath(finish.fontsDir)}` : ""}[burned]`);
    videoLabel = "burned";
  }
  // COP-357, fps30: the finished picture, words and all, at the delivered rate by repeated frames; the clock above is FPS.
  // #4817: it ends on exactly the frames its sound needs (deliveredFrames), its last frame repeated when the graph
  // ends a frame early, as Debian's ffmpeg 5.1 (the worker's) does after the lens smudge's maskedmerge.
  if (finish?.deliverFps) {
    const frames = deliveredFrames(pictureSec, speed, finish.deliverFps);
    filters.push(`[${videoLabel}]fps=${finish.deliverFps},tpad=stop_mode=clone:stop=-1,trim=end_frame=${frames}[delivered]`);
    videoLabel = "delivered";
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
    for (const [index, gap] of (sound.fallbackBeds ?? []).entries()) {
      const samples = Math.round(gap.seconds * EDIT_SAMPLE_RATE);
      const delay = Math.round(gap.startSec * EDIT_SAMPLE_RATE);
      filters.push(`${ROOM_TONE},atrim=end_sample=${samples},asetpts=PTS-STARTPTS,adelay=delays=${delay}S:all=1[roomgap${index}]`);
      beds.push(`[roomgap${index}]`);
    }
  } else if (!finish?.room && sound?.roomTone !== false && (!timeline.mapped || !timeline.wholeVoice) && !timeline.wholeVoice?.songOnly) {
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
  // COP-354, roomSound: the cut's own bed under the whole film, after the voice's chain and the duck, and not ducked.
  if (finish?.room?.file) {
    const r = finish.room;
    const k = addInput("-i", r.file);
    filters.push(
      `[${k}:a]${stereo},atrim=0:${pictureSec.toFixed(6)},asetpts=PTS-STARTPTS,volume=${r.gainDb}dB,` +
        `afade=t=in:d=${ROOM_FADE_SEC},afade=t=out:st=${sec(pictureSec - ROOM_FADE_SEC)}:d=${ROOM_FADE_SEC}[roombed]`,
    );
    under = [...under, "[roombed]"];
  }
  // COP-383: the voice as the music's duck hears it, split off before it is mixed (lightMusic, laid after the speed step).
  let lightKey = null;
  if (finish?.lightMusic) {
    filters.push(`${voice}asplit=2[vlm][lmkeyraw]`);
    voice = "[vlm]";
    lightKey = "[lmkeyraw]";
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
    // COP-300: the faster sound padded or cut to the faster picture's own length, as each segment's is to its
    // picture's: `fps` ends the picture on round(frames / speed) frames, and atempo runs on past it. The cut can land
    // in a word's tail, so the last END_FADE_SAMPLES fade out, as each segment's edges do, and the end never clicks.
    const end = filmFrames(pictureSec, speed) * SAMPLES_PER_FRAME;
    filters.push(`[mix]atempo=${speed},apad,atrim=end_sample=${end},afade=t=out:ss=${end - END_FADE_SAMPLES}:ns=${END_FADE_SAMPLES}[mixfaster]`);
    audioLabel = "mixfaster";
  }
  // COP-383, the sheet's music at Luke's level (LIGHT_MUSIC), on the finished film's clock: the track at its own tempo,
  // faded in and out, ducked by the voice heard at the film's speed, and mixed under the finished sound.
  if (finish?.lightMusic && lightKey) {
    const m = finish.lightMusic;
    const end = speed ? filmFrames(pictureSec, speed) * SAMPLES_PER_FRAME : Math.round(pictureSec * EDIT_SAMPLE_RATE);
    const filmSec = end / EDIT_SAMPLE_RATE;
    const k = addInput("-i", m.file);
    const d = LIGHT_MUSIC.duck;
    filters.push(`${lightKey}${speed ? `atempo=${speed},` : ""}apad,atrim=end_sample=${end}[lmkey]`);
    filters.push(
      `[${k}:a]${stereo},apad,atrim=end_sample=${end},asetpts=PTS-STARTPTS,volume=${m.gainDb}dB,` +
        `afade=t=in:d=${LIGHT_MUSIC.fadeInSec},afade=t=out:st=${sec(Math.max(0, filmSec - LIGHT_MUSIC.fadeOutSec))}:d=${LIGHT_MUSIC.fadeOutSec}[lmraw]`,
    );
    filters.push(`[lmraw][lmkey]sidechaincompress=threshold=${m.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}:knee=${d.knee}[lmbed]`);
    filters.push(`[${audioLabel}][lmbed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[withmusic]`);
    audioLabel = "withmusic";
  }
  // COP-384: the whoosh before each extra shot, on the finished film's clock, at the gain the cut set (whooshGain).
  if (xs?.whoosh) {
    const parts = xs.shots.map((s, k) => {
      const i = addInput("-i", resolve(xs.whoosh.file));
      const at = Math.max(0, shotFrames(s).first / FPS - EXTRA_SHOTS.whoosh.leadSec);
      filters.push(`[${i}:a]${stereo},volume=${xs.whoosh.gainDb}dB,adelay=delays=${Math.round(at * 1000)}:all=1[xw${k}]`);
      return `[xw${k}]`;
    });
    filters.push(`[${audioLabel}]${parts.join("")}amix=inputs=${parts.length + 1}:duration=first:dropout_transition=0:normalize=0[withwhoosh]`);
    audioLabel = "withwhoosh";
  }

  return [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", String(finish?.deliverFps ?? FPS),
    // COP-300: a mix the loudness pass finishes keeps its sound uncompressed, so the finished cut's sound is AAC-encoded once.
    ...(finish?.pcmMix ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "192k"]),
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
    // P4f cut fix 2 (S7): a call's scene sits at its place in the call's one clip, at the call's speed.
    if (seg.callFit) return (seg.callFit.atSec + local) * seg.callFit.speed;
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
      sceneIndex: seg.sceneIndex, file: seg.callFit?.clip ?? seg.file ?? null,
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
    // #4585: the picture held under the end card is the card's, not the scene's.
    let pieces = [{ from: seg.startSec, to: seg.startSec + seg.seconds - (seg.endCardHoldSec ?? 0) }];
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
    // #4835: started with its scene, over the air before the scene's first word.
    const held = c.leadHoldSec > 0 ? `, its first frame held ${c.leadHoldSec.toFixed(2)}s from the start of scene ${c.spineSceneIndex ?? "under it"}` : "";
    const covers = !c.broll
      ? ""
      : c.coversFound
        ? `, B-roll covering "${c.broll.covers}"`
        : `, B-roll: "${c.broll.covers}" is not in the line, so it starts with the line for its planned ${c.broll.plannedSec}s`;
    rows.push({
      n: c.sceneIndex,
      line:
        `cutaway ${c.sceneIndex}: ${label} at ${c.startSec.toFixed(2)}s for ${c.seconds.toFixed(1)}s, ` +
        `cued to ${c.cueLineId} in scene ${c.spineSceneIndex} (${how})${covers}${held}${cut}`,
    });
  }
  for (const note of timeline.notes ?? []) {
    const speech = note.match(/^speech-release-[^:]+: scene (\d+)/);
    if (speech) rows.push({ n: Number(speech[1]), line: note });
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
const csTime = (cs) => `${Math.floor(cs / 360000)}:${pad2(Math.floor(cs / 6000) % 60)}:${pad2(Math.floor(cs / 100) % 60)}.${pad2(cs % 100)}`;
const assTime = (t) => csTime(Math.round(Math.max(0, t) * 100));
/**
 * COP-300: a caption's start, in centiseconds of the finished cut, on the frame that holds its word's start: that
 * frame's own time floored to the centisecond, so libass draws the caption from that frame on. Rounded to the
 * centisecond as other times are, it came up on the frame after about half the time.
 */
export const captionStartCs = (t) => Math.floor((Math.floor(Math.max(0, t) * FPS + 1e-6) * 100) / FPS + 1e-9);
/** The time a caption starting at `cs` (centiseconds) is first seen: the first frame at or after it. */
export const captionSeenSec = (cs) => Math.ceil((cs / 100) * FPS - 1e-6) / FPS;
const assText = (s) => String(s).replace(/[{}\\]/g, "").replace(/\s*[\r\n]+\s*/g, " ").trim();

/**
 * COP-382: the fonts the cut carries, for the looks of Luke's lock (his own were Apple fonts with no server licence):
 * Montserrat ExtraBold and Black and Anton, static TTFs from their upstreams, each under the SIL Open Font License 1.1,
 * whose text sits beside them (fonts/*-OFL.txt). They sit in `fonts` beside this script, so the CLI's copy of the skill
 * has them; the Trigger worker bundles this script, and scout/trigger.config.ts's additionalFiles copies the folder under
 * the build root at the same path from the repo's root (its `..` dropped), where captionFontsDir finds it by walking up
 * from the bundle, as scout's reaction-laugh.ts finds its asset. libass loads every font in the folder beside the
 * image's own (the subtitles filter's `fontsdir`) and picks one by its family name, the style's Fontname.
 */
const FONTS_FOLDER = "fonts";
const FONTS_FROM_ROOT = path.join("workspace", ".claude", "skills", "exodus-video", "scripts", FONTS_FOLDER);
export const CAPTION_FONT_FILES = ["Montserrat-ExtraBold.ttf", "Montserrat-Black.ttf", "Anton-Regular.ttf"];

/** COP-382: the folder that holds every one of CAPTION_FONT_FILES, beside this script or under a root above it, or null. */
export function captionFontsDir(from = import.meta.url, cwd = process.cwd()) {
  const holds = (dir) => CAPTION_FONT_FILES.every((file) => existsSync(path.join(dir, file)));
  let dir = path.dirname(fileURLToPath(from));
  if (holds(path.join(dir, FONTS_FOLDER))) return path.join(dir, FONTS_FOLDER);
  for (;;) {
    if (holds(path.join(dir, FONTS_FROM_ROOT))) return path.join(dir, FONTS_FROM_ROOT);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return holds(path.resolve(cwd, FONTS_FROM_ROOT)) ? path.resolve(cwd, FONTS_FROM_ROOT) : null;
}

/**
 * COP-382: a path as a value of a filter's option inside a filter graph: escaped once for the option (its `:`, `'` and
 * `\`) and once for the graph (`\`, `'`, `[`, `]`, `,` and `;`), as ffmpeg's filter docs ask, so a folder with any of
 * them still names itself.
 */
export const filterPath = (value) =>
  String(value).replace(/[\\':]/g, (c) => `\\${c}`).replace(/[\\'[\],;]/g, (c) => `\\${c}`);

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
 * COP-273 W2 cut, songCaptions: caption screens on the sung words, as Luke's finish lays them (his dev pack,
 * lab/prepro_finish.py, read as text): each sung line on its own, `look.per` of its words a screen in order (the whole
 * line for "line"), a screen up from its first word's start to the next screen's of the line; a line's last screen up
 * SONG_CAPTION_HOLD_SEC after its last word starts (never before that word ends) and never past the next line's first
 * word. Each screen keeps its words' own starts (`words`) for the lit word (songLitScreens). `words`: lineWords' rows.
 */
export function songCaptionScreens(words, look) {
  const lines = [];
  // COP-273 P10 finding 28: a look that shows or lights words apart takes them one at a time (songWordTurns).
  for (const w of Number.isFinite(look.per) ? songWordTurns(words) : words) {
    if (lines.length && lines.at(-1)[0].line === w.line) lines.at(-1).push(w);
    else lines.push([w]);
  }
  const cased = (text) => (look.caps ? text.toUpperCase() : text);
  const screens = [];
  lines.forEach((ws, i) => {
    const per = Number.isFinite(look.per) ? Math.max(1, look.per) : ws.length;
    const nextLine = lines[i + 1]?.[0]?.start ?? Infinity;
    for (let k = 0; k < ws.length; k += per) {
      const chunk = ws.slice(k, k + per);
      const last = chunk.at(-1);
      const next = ws[k + per];
      const e = next
        ? next.start
        : Math.min(nextLine - CAPTION_CLEAR_SEC, Math.max(last.start + SONG_CAPTION_HOLD_SEC, last.end + CAPTION_TAIL_SEC));
      const tokens = chunk.map((w) => cased(assText(w.text)));
      tokens[tokens.length - 1] = tokens.at(-1).replace(/[.,;:]+$/, "");
      if (!(e > chunk[0].start)) continue;
      screens.push({
        text: tokens.join(" "),
        s: roundMs(chunk[0].start),
        e: roundMs(e),
        line: chunk[0].line,
        words: chunk.map((w, j) => ({ text: tokens[j], start: roundMs(w.start) })),
      });
    }
  });
  return screens;
}

/**
 * COP-273 P10 finding 28, songCaptionScreens only: the script words one heard word says ("sixty" and "day" for a heard
 * "sixty-day") come from lineWords on that word's whole time, as the talking kinds' captions keep them on one screen. A
 * song look that shows or lights words apart gives each an equal share of that time in their order, the first from its
 * start and the last to its end, as the song step reads a heard word with a hyphen (scout song-voice.ts heardParts).
 * Words one heard word says are those lineWords gives the same line, start and end.
 */
function songWordTurns(words) {
  const out = [];
  for (let i = 0; i < words.length; ) {
    const { line, start, end } = words[i];
    let j = i + 1;
    while (j < words.length && words[j].line === line && words[j].start === start && words[j].end === end) j++;
    const k = j - i;
    const at = (u) => (u === 0 ? start : u === k ? end : roundMs(start + ((end - start) * u) / k));
    for (let u = 0; u < k; u++) out.push(k === 1 ? words[i] : { ...words[i + u], start: at(u), end: at(u + 1) });
    i = j;
  }
  return out;
}

/**
 * COP-273 W2 cut, songCaptions "lit": each screen once for each of its words, that word in the look's lit colour, from
 * its start (the screen's start for the first) to the next word's start (the screen's end for the last), as Luke's
 * finish lights the word being sung. A look with no lit colour keeps its screens as they are.
 */
export function songLitScreens(screens, look) {
  if (!look?.lit) return screens;
  return screens.flatMap((c) => {
    const words = c.words ?? [];
    return words.flatMap((w, j) => {
      const s = j === 0 ? c.s : Math.max(c.s, w.start);
      const e = Math.min(c.e, j + 1 < words.length ? words[j + 1].start : c.e);
      if (!(e > s)) return [];
      const text = words.map((x, k) => (k === j ? `{\\1c${look.lit}}${x.text}{\\1c&HFFFFFF&}` : x.text)).join(" ");
      return [{ text, s: roundMs(s), e: roundMs(e), line: c.line }];
    });
  });
}

/**
 * captionsByLine: the cut's words in its own time, each with the script line
 * it belongs to. They are the script's words as written, never a heard word
 * the script does not have (COP-311). Where a segment's script is heard in
 * order (alignScript), each is timed by the heard words that say it;
 * elsewhere by the heard words in its place (scriptTimes), and a script word
 * with nothing heard in its place is left out.
 *
 * COP-384: with `everyWord`, no script word of a heard segment is left out: one
 * with nothing heard in its place takes the time between the words around it
 * (`guessed`), so an extra shot on a word the script has is placed, never left
 * out as unheard. The words that start alike are not spread (sharedHeardWords).
 */
export function lineWords(timeline, storyboard, { everyWord = false } = {}) {
  const texts = new Map((storyboard?.script ?? []).map((line) => [line?.lineId, line?.text]));
  const rows = [];
  for (const seg of timeline.spine) {
    const heard = seg.words ?? [];
    if (heard.length === 0) continue;
    const at = (t) => roundMs(seg.startSec + t);
    const lines = seg.lineIds.map((id) => scriptWords(texts.get(id)));
    const lineOf = lines.flatMap((ws, j) => ws.map(() => seg.lineIds[j]));
    const aligned = lines.some((l) => l.length > 0) ? alignScript(heard, lines.flat()) : null;
    // Each script word's heard span, or null: aligned in order (alignScript), else by what was heard in its place
    // (COP-311 scriptTimes).
    let spanOf;
    if (aligned) {
      const { expected, heard: tokens, heardTokenOf } = aligned;
      spanOf = (i) => {
        const said = heardTokenOf.filter((_, e) => expected.sourceIndex[e] <= i && i <= expected.lastSourceIndex[e]);
        return said.length === 0 ? null : [at(heard[tokens.sourceIndex[said[0]]].s), at(heard[tokens.lastSourceIndex[said.at(-1)]].e)];
      };
    } else {
      const { expected, times } = scriptTimes(heard, lines.flat());
      spanOf = (i) => {
        const said = times.filter((time, e) => time && expected.sourceIndex[e] <= i && i <= expected.lastSourceIndex[e]);
        return said.length === 0 ? null : [at(said[0][0]), at(said.at(-1)[1])];
      };
    }
    const segRows = [];
    lines.flat().forEach((text, i) => {
      const span = spanOf(i);
      if (span && span[1] > span[0]) segRows.push({ text, start: span[0], end: span[1], line: lineOf[i] });
      else if (everyWord) segRows.push({ text, start: null, end: null, line: lineOf[i], guessed: true });
    });
    if (everyWord) {
      // Between the timed words around it; before the first, from the first heard word; after the last, to the last.
      const first = at(heard[0].s);
      const last = at(heard.at(-1).e);
      segRows.forEach((r, i) => {
        if (r.start !== null) return;
        const before = segRows.slice(0, i).reverse().find((x) => x.start !== null && !x.guessed);
        const after = segRows.slice(i + 1).find((x) => x.start !== null && !x.guessed);
        const from = before ? before.end : first;
        const to = Math.max(after ? after.start : last, from + 0.01);
        r.start = roundMs(from);
        r.end = roundMs(to);
      });
    }
    rows.push(...segRows);
  }
  return everyWord ? rows : sharedHeardWords(rows);
}

/**
 * lineWords: script words that start on one heard word but are not timed
 * alike ("probiotics/and" ending one line and starting the next) take that
 * word's time (to the earliest of their ends) in turn, so no caption screen
 * is cleared before its word is said. A word that runs on past it keeps its
 * own end. Words timed alike on one line stay on one screen
 * (lineCaptionScreens).
 */
function sharedHeardWords(rows) {
  const out = [];
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j].start === rows[i].start) j++;
    const run = rows.slice(i, j);
    const keys = [...new Set(run.map((r) => `${r.line}|${r.end}`))];
    if (keys.length === 1) out.push(...run);
    else {
      const start = run[0].start;
      const shared = Math.min(...run.map((r) => r.end));
      const slot = (shared - start) / keys.length;
      for (const r of run) {
        const u = keys.indexOf(`${r.line}|${r.end}`);
        out.push({ ...r, start: roundMs(start + u * slot), end: r.end > shared ? r.end : roundMs(start + (u + 1) * slot) });
      }
    }
    i = j;
  }
  return out;
}

// ---- COP-382: the three caption looks of Luke's lock, in the fonts the cut carries ----

/**
 * Each font's numbers, from its own tables: its family name (the style's Fontname, which libass matches), its units a
 * em, the OS/2 win ascent and ascent plus descent (libass sizes a font so these are the font size, and lays a line's
 * baseline the ascent below its top), the hhea ascent and descent Luke's drawing laid each line by (PIL's getmetrics),
 * and the advance widths of printable ASCII from the space, then the curly quotes, the dashes and the ellipsis. libass
 * sets no kerning by default, so a word is as wide as its advances (measured: 1 to 2 px over 660 px, libass 0.17.5).
 * Any other character counts as the font's widest ASCII one, so a box is never narrower than its words; a mark as none.
 */
const LOOK_FONTS = {
  extraBold: {
    name: "Montserrat ExtraBold", upm: 1000, winAscent: 1109, winUnits: 1562, ascent: 968, descent: 251, widest: 1184, bold: true,
    advance: [
      291, 301, 462, 730, 647, 897, 752, 242, 369, 369, 453, 609, 283, 388, 283, 415, 685, 405, 599, 603, 700, 607, 649, 632, 669,
      649, 283, 283, 609, 609, 609, 597, 1036, 786, 769, 730, 826, 672, 642, 770, 806, 339, 557, 752, 610, 954, 806, 846, 737, 846,
      740, 647, 635, 786, 766, 1184, 737, 693, 679, 389, 415, 389, 610, 500, 600, 628, 695, 603, 698, 642, 406, 705, 696, 313, 320,
      677, 313, 1045, 696, 666, 695, 695, 443, 547, 447, 692, 620, 956, 619, 620, 556, 414, 314, 414, 609,
    ],
    more: { "‘": 283, "’": 283, "“": 545, "”": 545, "–": 500, "—": 1000, "…": 858 },
  },
  black: {
    name: "Montserrat Black", upm: 1000, winAscent: 1109, winUnits: 1562, ascent: 968, descent: 251, widest: 1206, bold: true,
    advance: [
      300, 314, 489, 740, 657, 917, 777, 254, 381, 381, 473, 620, 304, 390, 304, 440, 692, 418, 608, 614, 712, 619, 661, 645, 678,
      661, 304, 304, 620, 620, 620, 606, 1037, 806, 773, 737, 826, 673, 644, 769, 804, 350, 574, 765, 617, 954, 804, 848, 743, 848,
      745, 657, 654, 784, 786, 1206, 762, 710, 687, 410, 440, 410, 620, 500, 600, 639, 700, 615, 705, 653, 426, 711, 702, 326, 334,
      701, 326, 1040, 702, 678, 700, 700, 456, 565, 460, 698, 644, 977, 645, 644, 570, 438, 320, 438, 620,
    ],
    more: { "‘": 304, "’": 304, "“": 594, "”": 594, "–": 500, "—": 1000, "…": 922 },
  },
  // Anton has one weight, Regular: asked for bold, libass would thicken it, so its styles never ask.
  anton: {
    name: "Anton", upm: 2048, winAscent: 2876, winUnits: 3550, ascent: 2409, descent: 674, widest: 2164, bold: false,
    advance: [
      480, 469, 878, 1119, 946, 2164, 1065, 438, 596, 596, 926, 728, 484, 637, 468, 830, 1012, 677, 1012, 1012, 1012, 1012, 1012, 1012,
      1012, 1012, 495, 502, 658, 637, 658, 1008, 1770, 994, 980, 971, 1010, 843, 817, 993, 1022, 464, 955, 967, 814, 1528, 1020, 996,
      967, 1011, 976, 945, 810, 970, 961, 1458, 991, 914, 840, 651, 830, 651, 970, 748, 650, 990, 1027, 1006, 1020, 1000, 574, 1032,
      1035, 498, 538, 1005, 508, 1553, 1021, 1017, 1027, 1020, 710, 972, 625, 1022, 944, 1426, 940, 944, 790, 696, 443, 697, 1009,
    ],
    more: { "‘": 481, "’": 475, "“": 950, "”": 948, "–": 637, "—": 1153, "…": 1450 },
  },
};

/** COP-382: words' width in pixels in one of the cut's fonts at `emPx` pixels a em (LOOK_FONTS). */
export function lookWordsPx(fontId, text, emPx) {
  const font = LOOK_FONTS[fontId];
  let units = 0;
  for (const char of String(text).normalize("NFD")) {
    if (/\p{M}/u.test(char)) continue;
    const code = char.codePointAt(0);
    units += (code >= 32 && code <= 126 ? font.advance[code - 32] : font.more[char]) ?? font.widest;
  }
  return (units * emPx) / font.upm;
}

/** The ASS font size that draws a font at `emPx` pixels a em. */
const lookFontSize = (font, emPx) => round2((emPx * font.winUnits) / font.upm);

/**
 * COP-382: the three looks of Luke's lock (lab/post_lock.json "looks", drawn by lab/post3.py cap_items), by the name the
 * worker writes into the manifest's `sheetCaptions.look` (video/lib/sheetFinish.ts). His numbers are for a frame 720
 * wide, so each is 1.5 times his at the cut's 1080 (and scaled again for another width); his Avenir Next and Impact are
 * Apple's, so Montserrat and Anton stand in at his sizes (`em`, pixels a em):
 * - bubble: Avenir Next Bold 44 as Montserrat ExtraBold, words #111111 on a white box a line (alpha 250 of 255), its
 *   corners 16 px round, 16 px each side of the words and 7 above and below, lines 2 px closer, wrapped at 478 px.
 * - yellow: Impact 66, capitals, as Anton: white with a 7 px black edge, the key word #FFE400, wrapped at 504 px, lines
 *   6 px apart (keyWord).
 * - purple-box: Avenir Next Heavy 46 as Montserrat Black: white with a 5 px black edge, a line of words stays up and the
 *   word being said sits in a #8B3DFF box with no edge, its corners 10 px round, 9 px each side of the word and 2 above and
 *   below its line, the box moving word to word; lines 2 px apart, balanced, wrapped at 488 px.
 * `words` is the most words a screen holds when the sheet gives no number (his: 3, 2, a line of 5).
 */
export const CAPTION_LOOKS_DRAWN = {
  bubble: { font: "extraBold", em: 66, words: 3, wrapPx: 717, padY: 10.5, lineGap: -3, text: "&H111111&", outline: 0, box: { colour: "&HFFFFFF&", alpha: "&H05&", padX: 24, radius: 24 } },
  yellow: { font: "anton", em: 99, words: 2, wrapPx: 756, padY: 10.5, lineGap: 9, text: "&HFFFFFF&", outline: 10.5, caps: true, key: "&H00E4FF&" },
  "purple-box": { font: "black", em: 69, words: 5, wrapPx: 732, padY: 10.5, lineGap: 3, text: "&HFFFFFF&", outline: 7.5, balanced: true, said: { colour: "&HFF3D8B&", padX: 13.5, padY: 3, radius: 15 } },
};

/** COP-382: the look a caption style asks for by name (the sheet's `look`), or null for today's looks. */
export const drawnLookOf = (cap) => nameIn(CAPTION_LOOKS_DRAWN, cap?.look);

/**
 * Luke's look timing (post3.py cap_items timed), in seconds of the finished film (his edit applied it after the speed-up,
 * so the cut's clock is these times the speed): a screen stays to its last word's end and this long...
 */
export const LOOK_TAIL_SEC = 0.35;
/** ...or runs on to the next screen when that one starts within this of its last word's end. */
export const LOOK_SNAP_SEC = 0.7;
/** post3.py lines_of: a short sentence joins the purple box's line before it when said within this of it (the film's seconds). */
export const LOOK_LINE_JOIN_SEC = 0.6;

/** Luke's stop words and number words for the key word (post3.py STOP, NUMW), and his word for comparing (norm). */
const KEY_STOP = new Set("a an the and or but so to of in on at it is i i'm she he her my me you they they're we this that had has have was be being just not right now make sure get oh for with its it's your their do if".split(" "));
const KEY_NUMBERS = new Set("one two three four five six seven eight nine ten twenty thirty forty fifty hundred half double free".split(" "));
const keyNorm = (word) => String(word).toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9%']/g, "");

/**
 * COP-382, the yellow look's key word (post3.py key_word): the first word with a digit, else the first number word,
 * else the longest word of 4 letters or more that is no stop word, the later one on a tie; null when none is.
 */
export function keyWord(words) {
  const said = words.map(keyNorm);
  const digit = said.findIndex((w) => /\d/.test(w));
  if (digit >= 0) return digit;
  const number = said.findIndex((w) => KEY_NUMBERS.has(w));
  if (number >= 0) return number;
  let best = null;
  said.forEach((w, i) => {
    if (KEY_STOP.has(w) || w.length < 4) return;
    if (best === null || w.length >= said[best].length) best = i;
  });
  return best;
}

/** A word that ends a sentence (post3.py sentences); a closing quote or bracket may follow its mark. */
const LOOK_SENTENCE_END = /[.?!]["'”’)\]]*$/;
const LOOK_COMMA = /,["'”’)\]]*$/;

/** The cut's words as Luke's sentences, [first, last] indexes: a sentence also ends where the script's line changes. */
function lookSentences(words) {
  const out = [];
  let a = 0;
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (!next || LOOK_SENTENCE_END.test(w.text) || (w.line !== undefined && next.line !== w.line)) {
      out.push([a, i]);
      a = i + 1;
    }
  });
  return out;
}

/** `n` items in `k` runs as even as can be, the first ones one longer (post3.py chunks, lines_of). */
const evenRuns = (items, k) => {
  const runs = [];
  let i = 0;
  for (let q = 0; q < k; q++) {
    const size = Math.floor(items.length / k) + (q < items.length % k ? 1 : 0);
    runs.push(items.slice(i, i + size));
    i += size;
  }
  return runs;
};

/**
 * post3.py chunks: groups of at most `n` words, never across a sentence's end, broken after a comma, a one-word clause
 * given to a neighbour with room, each clause split as evenly as can be.
 */
function lookChunks(words, n) {
  const out = [];
  for (const [a, b] of lookSentences(words)) {
    const clauses = [[]];
    for (let i = a; i <= b; i++) {
      clauses.at(-1).push(i);
      if (LOOK_COMMA.test(words[i].text) && i < b) clauses.push([]);
    }
    for (let q = 0; n > 1 && q < clauses.length && clauses.length > 1; ) {
      if (clauses[q].length === 1) {
        if (q + 1 < clauses.length && clauses[q + 1].length < n) {
          clauses[q + 1] = [...clauses[q], ...clauses[q + 1]];
          clauses.splice(q, 1);
          continue;
        }
        if (q > 0 && clauses[q - 1].length < n) {
          clauses[q - 1].push(...clauses[q]);
          clauses.splice(q, 1);
          continue;
        }
      }
      q++;
    }
    for (const clause of clauses) out.push(...evenRuns(clause, Math.ceil(clause.length / n)));
  }
  return out;
}

/**
 * post3.py lines_of: lines of up to `hi` words; short sentences of one script line said within `joinSec` share one, long
 * ones split evenly. Two script lines never share a screen, as the cut's captions by line never do, and words with no
 * script line never join across a sentence's end.
 */
function lookLines(words, hi, joinSec = LOOK_LINE_JOIN_SEC) {
  const out = [];
  let buf = [];
  for (const [a, b] of lookSentences(words)) {
    const s = Array.from({ length: b - a + 1 }, (_, k) => a + k);
    // A word with no script line (the cut's heard words, with captions not by line) is no line known: never joined.
    const sameLine = buf.length > 0 && words[s[0]].line !== undefined && words[s[0]].line === words[buf.at(-1)].line;
    if (buf.length && sameLine && buf.length + s.length <= hi && words[s[0]].start - words[buf.at(-1)].end < joinSec) {
      buf.push(...s);
      continue;
    }
    if (buf.length) out.push(buf);
    out.push(...evenRuns(s, Math.ceil(s.length / hi)));
    buf = out.pop();
  }
  if (buf.length) out.push(buf);
  return out;
}

/** A word as a look shows it: no full stop or comma at its end (post3.py clean), and ours add the semicolon and the colon. */
const lookClean = (text) => assText(text).replace(/[.,;:]+$/, "");

/**
 * COP-382: caption screens in one of Luke's looks, from the cut's words ([{ text, start, end, line }]; `line` optional):
 * grouped as his look groups them (lookChunks, or lookLines for the purple box), at most the sheet's words a screen
 * (`cap.wordsPerLine.median`, else the look's own), each from its first word (on that word's frame, as every caption of
 * the cut, which its caption check reads) to its last word's end and LOOK_TAIL_SEC, or to the next screen when that one
 * starts within LOOK_SNAP_SEC. Each screen keeps its words, as shown, with their times, and the yellow look its key word.
 * The words are on the cut's clock, before the speed-up (`speed`), so Luke's numbers are the film's seconds times it.
 */
export function lookCaptionScreens(words, cap, speed = 1) {
  const name = drawnLookOf(cap);
  const look = CAPTION_LOOKS_DRAWN[name];
  const per = Math.max(1, Math.round(cap?.wordsPerLine?.median ?? look.words));
  // Script words timed by one heard word ("twenty five" for "25") stay on one screen, as lineCaptionScreens keeps them:
  // apart, the first would last no time at all and never show.
  const oneHeard = (a, b) => a.start === b.start && a.end === b.end && a.line === b.line;
  const groups = (look.said ? lookLines(words, per, LOOK_LINE_JOIN_SEC * speed) : lookChunks(words, per)).reduce((out, g) => {
    const prev = out.at(-1);
    if (prev && oneHeard(words[prev.at(-1)], words[g[0]])) prev.push(...g);
    else out.push([...g]);
    return out;
  }, []);
  return groups.map((g, k) => {
    const last = words[g.at(-1)];
    const next = groups[k + 1] ? words[groups[k + 1][0]] : null;
    const e = next && next.start - last.end < LOOK_SNAP_SEC * speed ? next.start : last.end + LOOK_TAIL_SEC * speed;
    const shown = g.map((i, n) => {
      const text = look.said ? (n === g.length - 1 ? lookClean(words[i].text) : assText(words[i].text)) : lookClean(words[i].text);
      return { text: look.caps ? text.toUpperCase() : text, s: roundMs(words[i].start), e: roundMs(words[i].end) };
    }).filter((w) => w.text !== "");
    const key = look.key ? keyWord(shown.map((w) => w.text)) : null;
    return {
      text: shown.map((w) => w.text).join(" "),
      s: roundMs(words[g[0]].start),
      e: roundMs(e),
      ...(words[g[0]].line !== undefined ? { line: words[g[0]].line } : {}),
      look: name,
      words: shown,
      ...(key !== null ? { key } : {}),
    };
  }).filter((c) => c.words.length > 0);
}

/** post3.py wrap: word indexes in lines no wider than `maxPx`, a word to a line at least. */
function lookWrap(widths, space, maxPx) {
  const lines = [[]];
  let w = 0;
  widths.forEach((width, i) => {
    if (lines.at(-1).length && w + space + width > maxPx) {
      lines.push([]);
      w = 0;
    }
    w += (lines.at(-1).length ? space : 0) + width;
    lines.at(-1).push(i);
  });
  return lines;
}

/** post3.py wrap_bal: wrapped, then narrowed in his 16 px steps (24 at 1080) while the count of lines stays, so they come out even. */
function lookWrapBalanced(widths, space, maxPx, scale) {
  let best = lookWrap(widths, space, maxPx);
  for (let w = maxPx - 24 * scale; w > 180 * scale; w -= 24 * scale) {
    const next = lookWrap(widths, space, w);
    if (next.length !== best.length) break;
    best = next;
  }
  return best;
}

/** Ours (COP-382 landing): the share of the frame's height a look's block keeps clear of the top and bottom edges. */
const LOOK_EDGE_SHARE = 0.03;

/**
 * COP-382: where a screen's words sit in a look, centred left to right and their block centred on `y`: lines of
 * { x, w, slotTop, textTop, words: [{ i, x, w }] } (pixels, the word's left edge), each line's slot as his drawing lays it
 * (its ascent and descent, and padY above and below), lineGap between slots, the words' top for an \an7 event so their
 * baseline lands where his did. `lh` is the height of a line's words.
 *
 * Ours: a word wider than the look's wrap (a web address, "supercalifragilistic...") or a block too tall for the frame
 * around `y` (many long words a screen) draws the screen smaller, as Luke's pill fits its words (ENDING_PILL), so no
 * caption runs off the frame. `fit` is the share of the look's size the screen is drawn at (1 for nearly every screen).
 */
export function lookLayout(name, words, W = WIDTH, H = HEIGHT, y = Math.round(H * 0.7)) {
  const look = CAPTION_LOOKS_DRAWN[name];
  const font = LOOK_FONTS[look.font];
  const scale = W / WIDTH;
  const wrap = look.wrapPx * scale;
  const padY = look.padY * scale;
  const gap = look.lineGap * scale;
  const tallest = 2 * (Math.min(y, H - y) - LOOK_EDGE_SHARE * H);
  const laid = (em) => {
    const widths = words.map((w) => lookWordsPx(look.font, w.text, em));
    const space = lookWordsPx(look.font, " ", em);
    const lines = look.balanced ? lookWrapBalanced(widths, space, wrap, scale) : lookWrap(widths, space, wrap);
    const lh = ((font.ascent + font.descent) / font.upm) * em;
    return { em, widths, space, lines, lh, height: lines.length * (lh + 2 * padY) + (lines.length - 1) * gap };
  };
  let at = laid(look.em * scale);
  for (let k = 0; k < 4; k++) {
    const shrink = Math.min(1, wrap / Math.max(1, ...at.widths), tallest / at.height);
    if (shrink >= 1 - 1e-9) break;
    at = laid(at.em * shrink);
  }
  const { em, widths, space, lines, lh } = at;
  const slot = lh + 2 * padY;
  const top = y - (lines.length * slot + (lines.length - 1) * gap) / 2;
  const lift = ((font.ascent - font.winAscent) / font.upm) * em;
  return {
    lh,
    size: lookFontSize(font, em),
    fit: round2(em / (look.em * scale)),
    lines: lines.map((line, k) => {
      const w = line.reduce((sum, i) => sum + widths[i], 0) + space * (line.length - 1);
      const x = W / 2 - w / 2;
      let at = x;
      const placed = line.map((i) => {
        const word = { i, x: at, w: widths[i] };
        at += widths[i] + space;
        return word;
      });
      const slotTop = top + k * (slot + gap);
      return { x, w, slotTop, textTop: slotTop + padY + lift, words: placed };
    }),
  };
}

/** COP-382: a look's style: its font at its size, its colour and edge, no shadow, placed by its events (\an7). */
function lookStyle(name, H) {
  const look = CAPTION_LOOKS_DRAWN[name];
  const font = LOOK_FONTS[look.font];
  const colour = `&H00${look.text.slice(2, 8)}`;
  const size = lookFontSize(font, look.em * (H / HEIGHT));
  return `Style: Look,${font.name},${size},${colour},${colour},&H00000000,&H00000000,${font.bold ? -1 : 0},0,0,0,100,100,0,0,1,${round2(look.outline * (H / HEIGHT))},0,7,0,0,0,1`;
}

const px = (n) => Math.round(n);

/**
 * COP-382: a look screen's events, from `from` to `to` (centiseconds of the finished cut), its words laid by lookLayout
 * around `y`: the bubble's white box a line under its words; the yellow look's lines, the key word in yellow; the purple
 * box's words each on its own, the word being said (from its own frame, `startCs`, to the next one's) without its edge
 * over the purple box.
 */
function lookDialogues(c, W, H, y, from, to, startCs) {
  const name = c.look;
  const look = CAPTION_LOOKS_DRAWN[name];
  const scale = W / WIDTH;
  const layout = lookLayout(name, c.words, W, H, y);
  // A screen drawn smaller (lookLayout's `fit`) says its size; every other one is drawn at its style's.
  const size = layout.fit < 1 ? `\\fs${layout.size}` : "";
  const text = (i) => assText(c.words[i].text);
  const event = (layer, a, b, body) => `Dialogue: ${layer},${csTime(a)},${csTime(b)},Look,,0,0,0,,${body}`;
  if (look.box) {
    const { padX, radius, colour, alpha } = look.box;
    return layout.lines.flatMap((line) => [
      event(1, from, to, `{\\an7\\pos(${px(line.x - padX * scale)},${px(line.slotTop)})\\bord0\\shad0\\1c${colour}\\1a${alpha}\\p1}` +
        roundedBoxPath(px(line.w + 2 * padX * scale), px(layout.lh + 2 * look.padY * scale), px(radius * scale))),
      event(2, from, to, `{\\an7\\pos(${px(line.x)},${px(line.textTop)})${size}}${line.words.map((w) => text(w.i)).join(" ")}`),
    ]);
  }
  if (look.key) {
    return layout.lines.map((line) => event(2, from, to, `{\\an7\\pos(${px(line.x)},${px(line.textTop)})${size}}` +
      line.words.map((w) => (w.i === c.key ? `{\\c${look.key}}${text(w.i)}{\\c${look.text}}` : text(w.i))).join(" ")));
  }
  const { colour, padX, padY, radius } = look.said;
  const placed = layout.lines.flatMap((line) => line.words.map((w) => ({ ...w, line })));
  return placed.flatMap((said, q) => {
    const a = q === 0 ? from : Math.max(from, startCs(c.words[said.i].s));
    const b = q === placed.length - 1 ? to : Math.min(to, startCs(c.words[placed[q + 1].i].s));
    if (!(b > a)) return [];
    return [
      event(1, a, b, `{\\an7\\pos(${px(said.x - padX * scale)},${px(said.line.slotTop + (look.padY - padY) * scale)})\\bord0\\shad0\\1c${colour}\\p1}` +
        roundedBoxPath(px(said.w + 2 * padX * scale), px(layout.lh + 2 * padY * scale), px(radius * scale))),
      ...placed.map((w) => event(2, a, b, `{\\an7\\pos(${px(w.x)},${px(w.line.textTop)})${size}${w.i === said.i ? "\\bord0" : ""}}${text(w.i)}`)),
    ];
  });
}

/**
 * COP-383, captions off the face: the bands a caption sits in, as shares of the frame's height, top to bottom of each
 * (video/lib/sheetFinish.ts PLACE_BAND): the cut centres a screen in its band.
 */
export const CAPTION_BANDS = { bottom: [0.66, 0.74], middle: [0.46, 0.54], top: [0.12, 0.18] };
/** COP-383: the room kept between a caption's drawn block and the face, as a share of the frame's height (19 px of 1920). */
export const FACE_CLEAR_SHARE = 0.01;

const facePart = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
/**
 * COP-383: a take's face box as the pull wrote it on its scene (video/lib/faceBox.ts): top, bottom, left and right as
 * parts of the take's frame, top above bottom and left of right; null for anything else.
 */
export function faceBoxOf(value) {
  if (!isObject(value)) return null;
  const { top, bottom, left, right } = value;
  return facePart(top) && facePart(bottom) && facePart(left) && facePart(right) && top < bottom && left < right ? { top, bottom, left, right } : null;
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));
/**
 * COP-383: where a face box lands on the film once its picture is scaled up by `zoom` and cropped back to the frame:
 * centred left to right, and `fromTop` of the height it gained cut from its top (0.5 a centred crop, 0 one that keeps the
 * top edge, ADDED_CUT.top an added cut's).
 */
export function zoomedFaceBox(box, zoom, fromTop) {
  const y = (v) => clamp01(v * zoom - (zoom - 1) * fromTop);
  const x = (v) => clamp01((v - 0.5) * zoom + 0.5);
  return { top: y(box.top), bottom: y(box.bottom), left: x(box.left), right: x(box.right) };
}

/**
 * COP-383: a spine segment's framings as the graph draws them (buildFfmpegArgs, framedPicture), each a zoom and the
 * share of the gained height cut from the top: its own (the punch-in and the pace pass's step, centred, or keeping the
 * top edge under a headline for the whole film), and with cuts added its other framing (alternateZoom), which a take
 * with no change of its own that starts in it plays in whole.
 */
function segmentFramings(seg) {
  const ownZoom = (seg.punchIn ? PUNCH_IN_SCALE : 1) * (seg.paceZoom ? PACE_PASS.zoom : 1);
  const own = { zoom: ownZoom, fromTop: seg.zoomTop ? 0 : 0.5 };
  const other = { zoom: alternateZoom(seg), fromTop: seg.zoomTop ? 0 : ADDED_CUT.top };
  if (seg.framing?.length > 0) return [own, other];
  return seg.framing && seg.otherFirst ? [other] : [own];
}

const unionBox = (boxes) => (boxes.length === 0 ? null : {
  top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)),
  left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)),
});

/**
 * COP-383: where each take's face is on the film, by scene: its box (`faces`, by scene, from the manifest) under every
 * framing each of its pieces plays in, joined. A take with no box is not in it.
 */
export function filmFaces(timeline, faces) {
  const out = new Map();
  for (const seg of timeline.spine) {
    const box = faces.get(seg.sceneIndex);
    if (!box || seg.source !== "clip") continue;
    out.set(seg.sceneIndex, unionBox([...(out.has(seg.sceneIndex) ? [out.get(seg.sceneIndex)] : []), ...segmentFramings(seg).map((f) => zoomedFaceBox(box, f.zoom, f.fromTop))]));
  }
  return out;
}

/** COP-383: the take on screen at a second of the cut's clock (before the speed-up), or null. */
function takeAt(timeline, t) {
  const seg = timeline.spine.find((s) => t >= s.startSec - 1e-6 && t < s.startSec + s.seconds - 1e-6) ?? (t >= 0 ? timeline.spine.at(-1) : null);
  return seg ? seg.sceneIndex : null;
}

/**
 * COP-383: a caption screen's drawn height as a share of the frame's: a look's lines as lookLayout lays them centred
 * on `y` (px; the bottom band's 0.7 with none), else the caption style's lines at its size (about 0.55 em a character
 * over the frame's width less its margins). Landing review: a look shrinks a block to the room around where it sits
 * (COP-382 `fit`), so a block is measured where it would be drawn: in the middle it may be taller than at the bottom.
 */
export function captionBlockShare(c, cap, W = WIDTH, H = HEIGHT, capMaxShare = null, y = undefined) {
  const look = drawnLookOf(cap);
  if (look && c.look === look && c.words?.length) {
    const spec = CAPTION_LOOKS_DRAWN[look];
    const layout = lookLayout(look, c.words, W, H, y);
    const scale = W / WIDTH;
    const slot = layout.lh + 2 * spec.padY * scale;
    return (layout.lines.length * slot + (layout.lines.length - 1) * spec.lineGap * scale) / H;
  }
  const thick = /thick black outline/i.test(cap?.style ?? "");
  const size = Math.min(Math.round(H * (thick ? 0.05 : 0.034)), capMaxShare ? Math.round(H * capMaxShare) : Infinity);
  const perLine = Math.max(1, Math.floor((W - 120) / (0.55 * size)));
  const lines = Math.max(1, Math.ceil(String(c.text ?? "").length / perLine));
  return (lines * size * 1.25 + 2 * (thick ? 7 : 1.5)) / H;
}

/** COP-383: whether a block of `share` centred in `band` keeps FACE_CLEAR_SHARE from the face (or a card), top to bottom. */
const bandClear = (band, share, face) => {
  const centre = (band[0] + band[1]) / 2;
  return centre + share / 2 + FACE_CLEAR_SHARE <= face.top || centre - share / 2 - FACE_CLEAR_SHARE >= face.bottom;
};

const bandName = (band) => Object.keys(CAPTION_BANDS).find((name) => CAPTION_BANDS[name][0] === band[0] && CAPTION_BANDS[name][1] === band[1]) ?? null;

/**
 * COP-383: where a card in a box is drawn, top to bottom, as shares of the frame's height: centred in its box (editAss
 * `\pos`), in the Card style's opaque box (its 18 px edge and 4 px shadow) at 0.036 of the height a line, as two lines
 * at most (1.25 of the size each). The lower box, 0.56 to 0.64, draws from about 0.545 to 0.655, past its own edges.
 */
export function cardDrawnBand(box, H = HEIGHT) {
  const centre = (box[1] + box[3]) / 2;
  const half = (2 * Math.round(H * 0.036) * 1.25 + 2 * 18 + 4) / 2 / H;
  return { top: Math.round((centre - half) * 10_000) / 10_000, bottom: Math.round((centre + half) * 10_000) / 10_000 };
}

/**
 * Landing review of COP-383: where a headline at the top is drawn, top to bottom, as shares of the frame's height: from
 * the top edge to the lower of its two boxes' rounded box (headlineDialogues: the font's size and HEADLINE_PAD_PX each
 * side, centred in the box).
 */
export function headlineDrawnBand(H = HEIGHT) {
  const half = (headlineFontPx(H) + 2 * HEADLINE_PAD_PX) / 2 / H;
  const bottom = Math.max(...[HEADLINE_BOX, HEADLINE_BOX_NO_ROOM].map((b) => (b[1] + b[3]) / 2 + half));
  return { top: 0, bottom: Math.round(bottom * 10_000) / 10_000 };
}

/**
 * COP-383: the band a take's captions sit in, clear of its face: the band asked for (`base`, the sheet's place, the
 * bottom with none) when its tallest screen (`share`) clears the face there, else the nearest band that does, the lower
 * on a tie; never the top under a headline at the top (`headline`). A band they move to also clears every card shown
 * over the take (`cards`, the lower box at 0.56 to 0.64 of the height: the member's card over the chest), so a caption
 * moved to the middle never touches it; the band asked for keeps today's place beside a card. Null when no band is clear.
 * Landing review: `share` may be a function of the band, the tallest screen as drawn there (a look's block grows with the
 * room around it), and a band moved to under a headline at the top also keeps clear of the headline as drawn
 * (headlineDrawnBand), so a tall block in the middle never reaches it.
 */
export function clearBand({ face, share, base = CAPTION_BANDS.bottom, headline = false, cards = [] }, H = HEIGHT) {
  const shareAt = typeof share === "function" ? share : () => share;
  const centre = (b) => (b[0] + b[1]) / 2;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const others = Object.values(CAPTION_BANDS).filter((b) => !same(b, base));
  const order = [base, ...others.sort((a, b) => Math.abs(centre(a) - centre(base)) - Math.abs(centre(b) - centre(base)) || centre(b) - centre(a))];
  const head = headlineDrawnBand(H);
  const clearOfCards = (band) => same(band, base) ||
    ([...cards, ...(headline ? [head] : [])]).every((card) => bandClear(band, shareAt(band), card));
  return order.find((band) => !(headline && same(band, CAPTION_BANDS.top)) && bandClear(band, shareAt(band), face) && clearOfCards(band)) ?? null;
}

/**
 * COP-383, captions off the face: each take with a face box (`faces`, on the film's frame, filmFaces) gets its captions
 * in the nearest band clear of its face (clearBand), judged by its tallest screen; when no band is clear, the bottom
 * band with fewer words a screen (half the words, rounded up), so each screen is shorter. A take with no box keeps
 * today's place and screens. `screensWith(words, cap)` groups the cut's words into screens as the cut does; a screen
 * belongs to the take on screen at its first word, and takes its band (`band`, top and bottom shares) from it. Never
 * the top band under a headline at the top (`headline`), so no caption moves into it; the words over the last shot
 * come after the captions stop (captionsBeforeEndCard), so none moves into them either.
 */
export function captionsOffFace({ screens, words, screensWith, cap, timeline, faces, headline = false, capMaxShare = null, cards = [] }, W = WIDTH, H = HEIGHT) {
  if (faces.size === 0 || screens.length === 0) return { screens, notes: [], takes: [] };
  const base = Array.isArray(cap?.place) && cap.place.length === 2 ? cap.place : CAPTION_BANDS.bottom;
  const takeOf = (c) => takeAt(timeline, c.s);
  // Each take's screens; its tallest is measured in each band, where a look's block would be drawn (captionBlockShare).
  const screensOf = new Map();
  for (const c of screens) {
    const take = takeOf(c);
    if (faces.has(take)) screensOf.set(take, [...(screensOf.get(take) ?? []), c]);
  }
  const tallestIn = (take) => (band) =>
    Math.max(...screensOf.get(take).map((c) => captionBlockShare(c, cap, W, H, capMaxShare, Math.round(((band[0] + band[1]) / 2) * H))));
  // The cards shown while each take is on screen (`cards`: { top, bottom, in, out } on the cut's clock).
  const cardsOver = (take) => {
    const segs = timeline.spine.filter((seg) => seg.sceneIndex === take);
    const from = Math.min(...segs.map((seg) => seg.startSec));
    const to = Math.max(...segs.map((seg) => seg.startSec + seg.seconds));
    return cards.filter((card) => card.in < to && card.out > from);
  };
  const takes = [...screensOf.keys()].sort((a, b) => a - b).map((take) => {
    const band = clearBand({ face: faces.get(take), share: tallestIn(take), base, headline, cards: cardsOver(take) }, H);
    return { take, band: band ?? CAPTION_BANDS.bottom, fewer: band === null };
  });
  const look = drawnLookOf(cap);
  const per = Math.max(1, Math.round(cap?.wordsPerLine?.median ?? (look ? CAPTION_LOOKS_DRAWN[look].words : 3)));
  const fewerPer = Math.max(1, Math.ceil(per / 2));
  const fewer = new Set(takes.filter((t) => t.fewer).map((t) => t.take));
  const shorter = fewer.size > 0 ? screensWith(words, { ...(cap ?? {}), wordsPerLine: { median: fewerPer } }) : [];
  const bandOf = new Map(takes.map((t) => [t.take, t.band]));
  const placed = [...screens.filter((c) => !fewer.has(takeOf(c))), ...shorter.filter((c) => fewer.has(takeOf(c)))]
    .sort((a, b) => a.s - b.s)
    .map((c) => (bandOf.has(takeOf(c)) ? { ...c, band: bandOf.get(takeOf(c)) } : c));
  const baseName = bandName(base) ?? "asked-for";
  const notes = takes.flatMap(({ take, band, fewer: short }) => {
    if (short) return [`captions: no band is clear of take ${take}'s face, so its captions sit in the bottom band, at most ${fewerPer} word${fewerPer === 1 ? "" : "s"} a screen`];
    if (band[0] === base[0] && band[1] === base[1]) return [];
    return [`captions: take ${take}'s face reaches the ${baseName} band, so its captions sit in the ${bandName(band)} band`];
  });
  return { screens: placed, notes, takes };
}

/**
 * One ASS file for the burn: the caption screens in their band, the cards in
 * their boxes, the hook box and the end card. Boxes are [x0, y0, x1, y1] as
 * shares of the frame. Every word on screen is the script's or the storyboard's.
 * Every time given is on the cut's clock before its speed-up; the file is on
 * the finished cut's (each time over `speed`), since it is burned after the speed step.
 */
export function editAss({ captions = [], cap = null, cards = [], hook = null, endCard = null, endLayers = null, capMaxShare = null, speed = 1, songLook = null, ending = null }, W = WIDTH, H = HEIGHT) {
  const at = (t) => assTime(t / speed);
  // Each caption from the frame of its first word, and off by the time the next one comes up.
  const starts = captions.map((c) => captionStartCs(c.s / speed));
  const endCs = (c, k) => Math.min(Math.round(Math.max(0, c.e / speed) * 100), starts[k + 1] ?? Infinity);
  const end = (c, k) => csTime(endCs(c, k));
  const thick = /thick black outline/i.test(cap?.style ?? "");
  // COP-273 W2 cut: a sung run's saved look (SONG_CAPTION_LOOKS) sets the caption's place, size, colour and edge.
  const y = songLook ? Math.round(H * songLook.y) : cap?.place ? Math.round(((cap.place[0] + cap.place[1]) / 2) * H) : Math.round(H * 0.7);
  const capSize = songLook
    ? Math.round(H * songLook.size)
    : Math.min(Math.round(H * (thick ? 0.05 : 0.034)), capMaxShare ? Math.round(H * capMaxShare) : Infinity);
  const capStyle = songLook
    ? `Style: Cap,Helvetica,${capSize},${songLook.colour},${songLook.colour},&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,${songLook.outline},${songLook.shadow},5,60,60,0,1`
    : `Style: Cap,Helvetica,${capSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,${thick ? 7 : 1.5},${thick ? 4 : 2},5,60,60,0,1`;
  const box = (b) => `\\pos(${Math.round(((b[0] + b[2]) / 2) * W)},${Math.round(((b[1] + b[3]) / 2) * H)})`;
  // COP-382: a look of Luke's lock draws its screens (lookCaptionScreens) in its own style; any other screen as today.
  const look = songLook ? null : drawnLookOf(cap);
  // COP-383: a screen moved off its take's face sits in its own band.
  const yOf = (c) => (Array.isArray(c.band) ? Math.round(((c.band[0] + c.band[1]) / 2) * H) : y);
  const capLine = (c, k) => `Dialogue: 1,${csTime(starts[k])},${end(c, k)},Cap,,0,0,0,,{\\pos(${W / 2},${yOf(c)})${c.colour ? `\\c${c.colour}${thick ? "" : `\\bord${CAPTION_COLOUR_MIN_OUTLINE}`}` : ""}}${c.text}`;
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    capStyle,
    "Style: Card,Helvetica,60,&H00141414,&H00141414,&H00FFFFFF,&H50000000,-1,0,0,0,100,100,0,0,3,18,4,5,0,0,0,1",
    `Style: End,Helvetica,${Math.round(H * 0.045)},&H00FFFFFF,&H00FFFFFF,&H20101010,&H00000000,-1,0,0,0,100,100,2,0,3,40,0,5,0,0,0,1`,
    ...(look ? [lookStyle(look, H)] : []),
    ...(ending ? [endingStyle(H)] : []),
    ...(endLayers ? endCardStyles(endLayers.colors, H) : []),
    ...(cards.some((c) => c.label && c.headline) ? [headlineStyle(H)] : []), "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...captions.flatMap((c, k) => (look && c.look === look && c.words?.length
      ? lookDialogues(c, W, H, yOf(c), starts[k], endCs(c, k), (t) => captionStartCs(t / speed))
      : [capLine(c, k)])),
    ...cards.filter((c) => c.label).flatMap((c) => (c.headline
      ? headlineDialogues(c, W, H, at)
      : [`Dialogue: 2,${at(c.in)},${at(c.out)},Card,,0,0,0,,{${box(c.box)}\\fs${Math.round(H * 0.036)}\\fad(60,0)}${assText(c.label)}`])),
    ...(hook?.text ? [`Dialogue: 3,${at(hook.in)},${at(hook.out)},Card,,0,0,0,,{${box(hook.box)}\\fs${Math.round(H * 0.026)}}${assText(hook.text)}`] : []),
    ...(endCard ? [`Dialogue: 4,${at(endCard.in)},${at(endCard.out)},End,,0,0,0,,{\\pos(${W / 2},${H / 2})\\fad(120,0)}${assText(endCard.text)}`] : []),
    ...(endLayers ? endCardDialogues(endLayers, W, H, at) : []),
    // COP-382: a run's sheet's words over the last shot.
    ...(ending ? endingDialogues(ending, W, H, at, speed) : []),
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
  return cardsOnLines(storyboard, timeline).map(({ card }) => card);
}

/** storyboardCards, each card with the end of the line it is cued to, on the cut's clock. */
function cardsOnLines(storyboard, timeline) {
  const counts = lineWordCounts(storyboard);
  const ctaId = storyboard?.cta?.overlayId;
  const placed = [];
  for (const o of storyboard?.overlays ?? []) {
    if (!hasText(o?.text) || !hasText(o?.cueLineId) || o.overlayId === ctaId || PICTURE_OVERLAY.test(o.type ?? "")) continue;
    const seg = timeline.spine.find((s) => !s.reaction && s.lineIds.includes(o.cueLineId));
    const cue = seg ? cueOffsetOnSpine(timeline.spine, counts, o.cueLineId) : null;
    if (!cue) continue;
    const at = roundMs(Math.max(0, cue.startSec - CARD_LEAD_SEC));
    const lineEnd = seg.startSec + (cueEndInSegment(seg, counts, o.cueLineId) ?? seg.seconds);
    placed.push({
      card: {
        n: placed.length + 1, label: o.text.trim(), box: cardBox(o.placement),
        in: at, out: roundMs(Math.max(lineEnd, at + BROLL_MIN_HOLD_SEC)), on: `line ${o.cueLineId}`,
      },
      lineEnd,
      sceneIndex: seg.sceneIndex,
    });
  }
  return placed;
}

/**
 * COP-356, cardPlace "top" (a run's sheet, through the worker): the card as a headline at the top for the opening, as
 * Luke's hook test clips carry one. Heavy dark words over a white rounded box, centred left to right near the top of the
 * frame (HEADLINE_BOX), from the first frame to the end of the line the card is cued to, and held HEADLINE_MIN_SEC to
 * HEADLINE_MAX_SEC of the finished film. It keeps its place: captions set high give way to it and sit low (the worker
 * writes them so, video/lib/sheetFinish.ts sheetFinishOf), as Luke's kit moves its captions off a banner's place. The
 * numbers are ours.
 */
export const HEADLINE_MIN_SEC = 2.5;
export const HEADLINE_MAX_SEC = 6;
/**
 * The bands the headline is centred in at the top, by the take it opens on. COP-370: over a take filmed with clear room
 * above the head (the manifest's `finishing.headRoom`, that take's number, which only the worker writes from the board's
 * facts: video/lib/sheetFinish.ts headlineAtTop, video/lib/ugcOneTakeKitPrompt.ts ONE_TAKE_HEAD_ROOM_LINE), the box's
 * top edge sits just under the top part of a Reel that Meta asks to keep free of text (about 14% of the height, its Reels
 * ads guide, read Nov 15, 2026), on the place behind the head: on the cut's 1080x1920 frame, with the words' size and the
 * box's padding below, y 273 to 378, its top edge at or under 14.2% of the height and the first whole pixel row there.
 * Over any other take (a board made before COP-370, or take 1 left out of the cut) the headline sits where it did, its
 * middle an eighth of the way down (y 188 to 293), over the hair and not lower on the face.
 */
export const HEADLINE_BOX = [0.08, 0.142, 0.92, 0.197];
export const HEADLINE_BOX_NO_ROOM = [0.08, 0.1, 0.92, 0.15];
/** The white box around the words, in pixels of a 1920-high frame: its padding and its corners' radius. */
const HEADLINE_PAD_PX = 18;
const HEADLINE_RADIUS_PX = 21;
const headlineFontPx = (H) => Math.round(H * 0.036);

/**
 * The words' width on the worker's font, which draws "Helvetica" Bold as DejaVu Sans Bold (its image holds only DejaVu):
 * DejaVu Sans Bold's advance widths in its units, printable ASCII from the space, then the quotes and dashes the card
 * takes. libass sizes a font so its ascent and descent (2384 units) are the font size. Any other character counts as the
 * widest letter, so the box is never narrower than the words there; a mark counts as nothing (a letter's accent).
 */
const HEADLINE_ADVANCE = [
  713, 934, 1067, 1716, 1425, 2052, 1786, 627, 936, 936, 1071, 1716, 778, 850, 778, 748, 1425, 1425, 1425, 1425, 1425, 1425,
  1425, 1425, 1425, 1425, 819, 819, 1716, 1716, 1716, 1188, 2048, 1585, 1561, 1503, 1700, 1399, 1399, 1681, 1714, 762, 762,
  1587, 1305, 2038, 1714, 1741, 1501, 1741, 1577, 1475, 1397, 1663, 1585, 2259, 1579, 1483, 1485, 936, 748, 936, 1716, 1024,
  1024, 1382, 1466, 1214, 1466, 1389, 891, 1466, 1458, 702, 702, 1362, 702, 2134, 1458, 1407, 1466, 1466, 1010, 1219, 979,
  1458, 1335, 1892, 1321, 1335, 1192, 1458, 748, 1458, 1716,
];
const HEADLINE_ADVANCE_MORE = { "\u2018": 778, "\u2019": 778, "\u201C": 1346, "\u201D": 1346, "\u2013": 1024, "\u2014": 2048 };
const HEADLINE_FONT_UNITS = 2384;
const HEADLINE_WIDEST = 2259;

/** The headline's words' width in pixels at `fontPx` (HEADLINE_ADVANCE). */
export function headlineWordsPx(text, fontPx) {
  let units = 0;
  for (const char of String(text).normalize("NFD")) {
    if (/\p{M}/u.test(char)) continue;
    const code = char.codePointAt(0);
    units += (code >= 32 && code <= 126 ? HEADLINE_ADVANCE[code - 32] : HEADLINE_ADVANCE_MORE[char]) ?? HEADLINE_WIDEST;
  }
  return (units * fontPx) / HEADLINE_FONT_UNITS;
}

/**
 * The cards as storyboardCards places them, the first as the headline (cardPlace "top"): from the first frame to the end
 * of its line, HEADLINE_MIN_SEC to HEADLINE_MAX_SEC of the film at `speed`, in HEADLINE_BOX when the take its line is
 * in is `headRoom` (COP-370), else in HEADLINE_BOX_NO_ROOM. COP-382, cardPlace "top-film": with `untilSec` (the cut's
 * clock), the film's end or where its ending starts, the headline stays to it (as Luke's pinned banner, post3.py
 * banner_item, to the ending), every take filmed with room above the head when the take it opens on was (the board asks it
 * of every take then).
 */
export function headlineCards(storyboard, timeline, { speed = 1, headRoom = null, untilSec = null } = {}) {
  return cardsOnLines(storyboard, timeline).map(({ card, lineEnd, sceneIndex }, k) => (k > 0 ? card : {
    ...card,
    box: headRoom !== null && sceneIndex === headRoom ? HEADLINE_BOX : HEADLINE_BOX_NO_ROOM,
    in: 0,
    out: Number.isFinite(untilSec) ? roundMs(untilSec) : roundMs(Math.min(Math.max(lineEnd, HEADLINE_MIN_SEC * speed), HEADLINE_MAX_SEC * speed)),
    headline: true,
  }));
}

/** The headline's style: bold, near-black words with no edge or shadow, centred; its box is a drawing in the same style. */
function headlineStyle(H) {
  return `Style: Head,Helvetica,${headlineFontPx(H)},&H00141414,&H00141414,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`;
}

/** A rounded box `w` by `h` as an ASS drawing from its top left corner, its corners quarter circles of radius `r`. */
function roundedBoxPath(w, h, r) {
  const k = Math.round(r * 0.5523);
  return [
    `m ${r} 0`, `l ${w - r} 0`, `b ${w - r + k} 0 ${w} ${r - k} ${w} ${r}`,
    `l ${w} ${h - r}`, `b ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h}`,
    `l ${r} ${h}`, `b ${r - k} ${h} 0 ${h - r + k} 0 ${h - r}`,
    `l 0 ${r}`, `b 0 ${r - k} ${r - k} 0 ${r} 0`,
  ].join(" ");
}

/** The headline's two events: the white rounded box under, the words over, both on for the headline's time. */
function headlineDialogues(c, W, H, at) {
  const fontPx = headlineFontPx(H);
  const cx = Math.round(((c.box[0] + c.box[2]) / 2) * W);
  const cy = Math.round(((c.box[1] + c.box[3]) / 2) * H);
  const w = Math.min(W, Math.ceil(headlineWordsPx(assText(c.label), fontPx)) + 2 * HEADLINE_PAD_PX);
  const h = fontPx + 2 * HEADLINE_PAD_PX;
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  return [
    `Dialogue: 2,${at(c.in)},${at(c.out)},Head,,0,0,0,,{\\an7\\pos(${x0},${y0})\\1c&HFFFFFF&\\p1}${roundedBoxPath(w, h, HEADLINE_RADIUS_PX)}`,
    `Dialogue: 3,${at(c.in)},${at(c.out)},Head,,0,0,0,,{\\pos(${cx},${cy})}${assText(c.label)}`,
  ];
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
 * How long the end card shows, the same for every brand: Daniel's ruling on COP-309 (2026-11-14, #4585), "the card
 * comes up just after the last spoken word and shows for about 2 seconds, so nothing said is covered".
 */
export const END_CARD_LAYERS_SEC = 2;
/** The end card's colours when the brand gives none: a near-black ground, white words, a white call-to-action box. */
export const END_CARD_COLORS = { background: "111111", text: "FFFFFF", accent: "FFFFFF" };
/** Where the pack photo sits on the end card, as shares of the frame, and how far it pushes in across the card. */
export const END_CARD_PHOTO_BOX = [0.1, 0.1, 0.9, 0.56];
export const END_CARD_PUSH_IN = 0.05;
/**
 * #4585: the card dissolves in over the last picture in END_CARD_FADE_SEC, so its ground never shows alone before the
 * photo, and its words build in one after another, this far apart, each fading in over END_CARD_WORD_FADE_MS, as the
 * dissolve ends. On a 2 s card the headline is fully on screen for 1.65 s, the offer 1.5 s, the call to action 1.35 s.
 */
const END_CARD_WORD_STEP_SEC = 0.15;
const END_CARD_FADE_SEC = 0.2;
const END_CARD_WORD_FADE_MS = 150;
/** A spoken call to action longer than this many words is too long to letter; the card then shows none. */
const END_CARD_CTA_MAX_WORDS = 8;

const hexColour = (value) => (typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().replace(/^#/, "").toUpperCase() : null);

/**
 * endCardLayers and brandCheck (Plan 14): the manifest's `brand`, written by
 * the worker beside `finishing`: the product's pack photo it downloaded
 * (`packPhoto`, a file in the folder), the product's name, the scenes whose
 * picture the pull's rule draws from that photo (`photoScenes`) and the
 * brand's colours (hex), each optional. Null when the manifest has none, so a
 * cut without it is the one it always was.
 */
export function brandOf(manifest) {
  const b = manifest?.brand;
  if (!b || typeof b !== "object") return null;
  const text = (v) => (hasText(v) ? v.trim() : null);
  const colors = b.colors && typeof b.colors === "object" ? b.colors : {};
  return {
    packPhoto: text(b.packPhoto),
    productName: text(b.productName),
    photoScenes: Array.isArray(b.photoScenes) ? b.photoScenes.filter((n) => Number.isInteger(n)) : [],
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

/** #4585: the end card comes up this long after the last heard word ends. */
export const END_CARD_AFTER_VOICE_SEC = 0.3;

/**
 * endCardLayers: the ad's last END_CARD_LAYERS_SEC seconds of screen time (`speed`
 * is the cut's speed-up, applied after) become the end card: the brand's
 * ground colour, the pack photo pushing in slowly, and the words drawn by
 * code over it. Never more than half the ad. Null without a pack photo.
 * #4585: the card never covers a heard word. When the last word (`voiceEndSec`,
 * on the cut's clock before the speed-up) ends inside those seconds, the card
 * comes up just after it, and `holdSec` is how much longer the picture must run
 * under the card so the card keeps its length.
 */
export function endCardLayersOf(brand, storyboard, pictureSec, speed = 1, voiceEndSec = null) {
  if (!brand?.packPhoto) return null;
  const seconds = Math.min(END_CARD_LAYERS_SEC * speed, pictureSec / 2);
  if (!(seconds > 0)) return null;
  // Only a card that would cover a word moves; one that comes up after the last word stays where it was.
  const waits = Number.isFinite(voiceEndSec) && voiceEndSec > Math.max(0, pictureSec - seconds) + 1e-3;
  const afterVoice = waits ? voiceEndSec + END_CARD_AFTER_VOICE_SEC : 0;
  const at = roundMs(Math.max(0, waits ? afterVoice : pictureSec - seconds));
  // Whole frames, so the held picture ends on the cut's own frame clock.
  const holdSec = waits ? Math.max(0, Math.ceil((at + seconds - pictureSec) * FPS - 1e-6)) / FPS : 0;
  const end = pictureSec + holdSec;
  return {
    file: brand.packPhoto,
    in: at,
    out: roundMs(end + 1),
    seconds: roundMs(end - at),
    ...(holdSec > 0 ? { holdSec } : {}),
    words: endCardWords(storyboard, brand.productName),
    colors: brand.colors,
  };
}

/**
 * #4585: the heard words the end card would cover, so they would play with no picture of their scene. Each is a word
 * row (the cut's clock before the speed-up). Empty with no card, or when every word ends before the card comes up.
 */
export function voiceUnderEndCard(rows, endCard) {
  return endCard ? rows.filter((r) => r.end > endCard.in + 1e-3) : [];
}

/**
 * #4585: the end card on the cut. It comes up after the last heard word, and the last scene's picture runs on under it
 * (its sound faded out where it ends, then silence), so the card keeps its length. A cut laid on its measured map
 * cannot run on past its picture, so its card keeps the ad's last seconds. A card that would cover a heard word refuses
 * the cut (VoiceUnderEndCardRefusal). What it did goes in `notes`.
 */
export function placeEndCard(timeline, brand, storyboard, pictureSec, speed, notes, songEditing = null) {
  if (timeline.songEnd) return placeSongEndCard(timeline, brand, storyboard, pictureSec, notes, songEditing);
  const rows = wordRows(timeline);
  const voiceEndSec = timeline.mapped ? null : Math.max(...rows.map((r) => r.end));
  const card = endCardLayersOf(brand, storyboard, pictureSec, speed, voiceEndSec);
  if (card?.holdSec) {
    const last = timeline.spine.at(-1);
    last.endCardHoldSec = card.holdSec;
    last.holdSec = (last.holdSec ?? 0) + card.holdSec;
    last.seconds += card.holdSec;
    notes.push(`the end card waits for the last word, so the ad runs ${card.holdSec.toFixed(2)}s longer under it`);
  }
  const covered = voiceUnderEndCard(rows, card);
  if (covered.length > 0) throw new VoiceUnderEndCardRefusal(covered);
  if (card) timeline.endCard = { in: card.in, out: card.out };
  return card;
}

/**
 * COP-273 W2 cut, songEnd: Luke's end card on a sung run. The film's last SONG_END_CARD_SEC (never more than half of
 * it), fading in over SONG_END_CARD_FADE_SEC. It never waits and is never refused for a sung word under it: the song
 * plays on under the card, as in his finish (the song is the sound, not a speaker whose picture the card would hide).
 * With light editing (`finish.songEditing`, SONG_EDITING_LEVELS) the picture dips to black into it.
 */
export function songEndCardOf(brand, storyboard, pictureSec, editing = null) {
  if (!brand?.packPhoto) return null;
  const seconds = Math.min(SONG_END_CARD_SEC, pictureSec / 2);
  if (!(seconds > 0)) return null;
  const at = roundMs(Math.max(0, pictureSec - seconds));
  const dip = SONG_EDITING_LEVELS[editing] ?? null;
  return {
    file: brand.packPhoto,
    in: at,
    out: roundMs(pictureSec + 1),
    seconds: roundMs(pictureSec - at),
    fadeSec: SONG_END_CARD_FADE_SEC,
    ...(dip ? { dip: { from: roundMs(Math.max(0, at - dip.lead)), lead: dip.lead, in: dip.in, out: dip.out } } : {}),
    words: endCardWords(storyboard, brand.productName),
    colors: brand.colors,
  };
}

/**
 * W2 cut fix (S2): a song laid on its measured map keeps its own end, so the cut keeps today's end card there; the dip
 * is drawn only into the sung run's own card, so light editing draws none, and the note says so.
 */
export function songEndMeasuredNote(songEditing) {
  return SONG_EDITING_LEVELS[songEditing]
    ? "song-end: a song laid on its measured map keeps its own end and today's end card, so light editing draws no dip into it"
    : "song-end: a song laid on its measured map keeps its own end";
}

/** COP-273 W2 cut, songEnd: where the film ends against the last sung word, for the pace record's notes. */
export function songEndNote(songEnd, pictureSec) {
  if (songEnd.cutBySec > 0) {
    return `song-end: the film ends ${SONG_END_AFTER_SEC.toFixed(2)}s after the last sung word, at ${pictureSec.toFixed(2)}s; the song's last ${songEnd.cutBySec.toFixed(2)}s are not used`;
  }
  // W2 cut fix (S1): the song was not cut; say which of the three is true.
  const gapSec = pictureSec - songEnd.lastSungSec;
  if (!(gapSec > 0)) {
    return `song-end: the last sung word's times run to ${songEnd.lastSungSec.toFixed(2)}s, at or past the song's own end, so the film ends with the song, at ${pictureSec.toFixed(2)}s`;
  }
  if (Number(gapSec.toFixed(2)) >= SONG_END_AFTER_SEC) {
    return `song-end: the song ends ${gapSec.toFixed(2)}s after the last sung word, at its own end, so the film ends with it, at ${pictureSec.toFixed(2)}s; nothing of the song is cut`;
  }
  return `song-end: the song ends ${gapSec.toFixed(2)}s after the last sung word, sooner than ${SONG_END_AFTER_SEC.toFixed(2)}s, so the film ends with it, at ${pictureSec.toFixed(2)}s`;
}

function placeSongEndCard(timeline, brand, storyboard, pictureSec, notes, songEditing) {
  const card = songEndCardOf(brand, storyboard, pictureSec, songEditing);
  const { lastSungSec } = timeline.songEnd;
  if (!card) return null;
  const under = lastSungSec - card.in;
  notes.push(`song-end: the end card is the film's last ${card.seconds.toFixed(2)}s, from ${card.in.toFixed(2)}s; ` +
    (under > 1e-3 ? `the song plays on under it, over the last ${under.toFixed(2)}s of its singing` : "the song plays on under it"));
  // W2 cut fix (S3): a song that ends soon after its last word can put a whole sung line under the card (his end
  // does the same); the note names the line and its seconds of singing.
  const byScene = new Map();
  for (const r of wordRows(timeline)) byScene.set(r.scene, [...(byScene.get(r.scene) ?? []), r]);
  const covered = [...byScene].filter(([, rows]) => Math.min(...rows.map((r) => r.start)) >= card.in - 1e-3)
    .sort(([a], [b]) => a - b);
  if (covered.length > 0) {
    const singingSec = covered.reduce((t, [, rows]) => t + Math.max(...rows.map((r) => r.end)) - Math.min(...rows.map((r) => r.start)), 0);
    const scenes = covered.map(([n]) => n);
    notes.push(`song-end: the end card covers the whole of ${scenesWords(scenes)}'s sung line${scenes.length > 1 ? "s" : ""}, ${singingSec.toFixed(2)}s of singing`);
  }
  timeline.endCard = { in: card.in, out: card.out };
  return card;
}

/** The staff message of a cut refused because the end card would cover some of its voice (VoiceUnderEndCardRefusal). */
export function voiceUnderEndCardMessage(words) {
  const scenes = [...new Set(words.map((r) => r.scene))].sort((a, b) => a - b);
  const named = scenes.length > 1 ? `scenes ${scenes.slice(0, -1).join(", ")} and ${scenes.at(-1)}` : `scene ${scenes[0]}`;
  const from = Math.min(...words.map((r) => r.start));
  const to = Math.max(...words.map((r) => r.end));
  return `The end card would cover the voice of ${named} from ${from.toFixed(2)}s to ${to.toFixed(2)}s, so the cut was not attached`;
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

/** The end card's words, building in one after another as the card's dissolve ends. `at` writes a time of the cut's clock. */
function endCardDialogues(e, W, H, at = assTime) {
  const rows = [
    ["EndHead", e.words.headline, 0.64],
    ["EndOffer", e.words.offer, 0.71],
    ["EndCta", e.words.cta, 0.82],
  ].filter(([, words]) => hasText(words));
  return rows.map(([style, words, y], k) => {
    const from = roundMs(e.in + (e.fadeSec ?? END_CARD_FADE_SEC) + k * END_CARD_WORD_STEP_SEC);
    return `Dialogue: 5,${at(from)},${at(e.out)},${style},,0,0,0,,{\\pos(${W / 2},${Math.round(H * y)})\\fad(${END_CARD_WORD_FADE_MS},0)}${assText(words)}`;
  });
}

/** Caption screens stop where the end card starts: its words are the card's, not the caption band's. */
export function captionsBeforeEndCard(screens, e) {
  if (!e) return screens;
  return screens.filter((c) => c.s < e.in).map((c) => (c.e > e.in ? { ...c, e: e.in } : c));
}

// ---- COP-382: a run's sheet's ending, words over the last shot (Luke's LINK BELOW pill) ----

/**
 * Luke's ending (lab/post3.py, step 5 "ending"), in seconds of the finished film: the words come in on the word "link"
 * when it is said in the film's last `linkWithinSec`, else on the last sentence but no earlier than `lastSentenceSec`
 * before the last word ends; the film runs on `runOnSec` after the last word; the words pop in over three frames of
 * `popSec` at `pop` of their size (post3.py pop_in), centred at `y` of the height; the captions stop `captionsClearSec`
 * before they come in (post3.py t_stop). The cut's clock is these times the speed.
 */
export const ENDING = { linkWithinSec: 3, lastSentenceSec: 1.2, runOnSec: 1.6, popSec: 0.045, pop: [0.6, 0.86, 1.07], y: 0.8, captionsClearSec: 0.05 };
/**
 * Luke's pill (post3.py ask_pill), 1.5 times his 720-wide numbers: Avenir Next Heavy 48 as Montserrat Black, #111111 on
 * a white pill (alpha 250) 92 high with round ends, the words 34 in from its left and 12 down, a red (#E62430) arrow
 * pointing down 16 after them, the pill 120 wider than the words, and his soft shadow under it (6 down, blur 9, alpha
 * 110). Words too wide for `maxShare` of the frame's width get smaller, as his fit() makes them.
 */
const ENDING_PILL = {
  em: 72, height: 138, textLeft: 51, textTop: 18, arrowGap: 24, extra: 180, maxShare: 0.86,
  ink: "&H111111&", white: "&HFFFFFF&", whiteAlpha: "&H05&", red: "&H3024E6&", shadow: { down: 9, blur: 13.5, alpha: "&H91&" },
};

/** COP-382: the sheet's words for the ending as the cut takes them: one line of drawable words, 1 to 40 characters; else null. */
export function endingWordsOf(raw) {
  const text = typeof raw === "string" ? assText(raw) : "";
  return text.length >= 1 && text.length <= 40 && /[\p{L}\p{N}]/u.test(text) ? text : null;
}

/**
 * COP-382: words over the last shot, on the cut's clock before the speed-up (`speed`): where they come in (`in`), on the
 * heard word "link" in the last ENDING.linkWithinSec, else the last sentence's first word but no earlier than
 * ENDING.lastSentenceSec before the last word ends; and the film's end, ENDING.runOnSec after the last word.
 *
 * The run-on holds the last frame, on whole frames, with no sound of the take's (its sound fades out where the cut ends,
 * as under the end card: `endCardHoldSec`); the room bed runs on under it. It never plays on into the clip: the take
 * past the cut is what trimJoins cut away, which can be speech after the last line ("Thanks guys") or a mouth still
 * moving, and a held frame cannot bring either back. Luke's finish holds the last frame too (post3.py: "the last frame
 * is held with silence"). `heldFrom` is where the held frames start, for the freeze check. Null with no heard word.
 */
export function placeEndingWords(timeline, text, speed, notes) {
  const rows = wordRows(timeline).filter((r) => r.end > r.start);
  if (rows.length === 0) {
    notes.push("ending: no heard word to time the ending's words by, so they were not drawn");
    return null;
  }
  const lastEnd = Math.max(...rows.map((r) => r.end));
  const link = rows.findLast((r) => /^links?$/i.test(String(r.text).replace(/[^\p{L}]/gu, "")) && lastEnd - r.start < ENDING.linkWithinSec * speed);
  const stop = rows.slice(0, -1).findLastIndex((r) => /[.?!]["'”’)\]]*$/.test(String(r.text)));
  const at = link ? link.start : Math.max(rows[stop + 1].start, lastEnd - ENDING.lastSentenceSec * speed);
  const end = lastEnd + ENDING.runOnSec * speed;
  const filmSec = timeline.spine.reduce((sum, seg) => sum + seg.seconds, 0);
  const more = Math.max(0, ceilFrame(end - filmSec));
  if (more > 0) {
    const last = timeline.spine.at(-1);
    last.seconds += more;
    last.holdSec = (last.holdSec ?? 0) + more;
    last.endCardHoldSec = (last.endCardHoldSec ?? 0) + more;
    notes.push(`ending: the last take's last frame is held ${more.toFixed(2)}s with no sound of its own, to ${ENDING.runOnSec}s after the last word`);
  }
  notes.push(`ending: "${text}" over the last shot from ${roundMs(at / speed)}s${link ? ', on the word "link"' : ""}`);
  return { text, in: roundMs(at), out: roundMs(end + 1), ...(more > 0 ? { heldFrom: roundMs(filmSec) } : {}) };
}

/** COP-382: the pill's events at one size (`s` of its own), centred at (cx, cy), from `a` to `b` (ASS times). */
function endingPillEvents(text, s, W, H, a, b) {
  const scale = W / WIDTH;
  const p = ENDING_PILL;
  let em = p.em * scale;
  const fitsIn = p.maxShare * W;
  let wide = lookWordsPx("black", text, em);
  if (wide + p.extra * scale > fitsIn) {
    em *= (fitsIn - p.extra * scale) / wide;
    wide = lookWordsPx("black", text, em);
  }
  const k = scale * s;
  const font = LOOK_FONTS.black;
  const w = (wide + p.extra * scale) * s;
  const h = p.height * k;
  const cx = W / 2;
  const cy = Math.round(H * ENDING.y);
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const arrow = x0 + (p.textLeft * scale + wide + p.arrowGap * scale) * s;
  const pts = (list) => list.map(([x, y]) => `${px(x)} ${px(y)}`).join(" ");
  const arrowPath = [
    `m ${pts([[arrow + 13.5 * k, y0 + 33 * k]])} l ${pts([[arrow + 34.5 * k, y0 + 33 * k], [arrow + 34.5 * k, y0 + 72 * k], [arrow + 13.5 * k, y0 + 72 * k]])}`,
    `m ${pts([[arrow - 3 * k, y0 + 69 * k]])} l ${pts([[arrow + 51 * k, y0 + 69 * k], [arrow + 24 * k, y0 + 108 * k]])}`,
  ].join(" ");
  const box = roundedBoxPath(px(w), px(h), px(h / 2));
  const size = lookFontSize(font, em * s);
  const textTop = y0 + p.textTop * k + ((font.ascent - font.winAscent) / font.upm) * em * s;
  return [
    `Dialogue: 6,${a},${b},Ending,,0,0,0,,{\\an7\\pos(${px(x0)},${px(y0 + p.shadow.down * k)})\\bord0\\shad0\\1c&H000000&\\1a${p.shadow.alpha}\\blur${round2(p.shadow.blur * k)}\\p1}${box}`,
    `Dialogue: 7,${a},${b},Ending,,0,0,0,,{\\an7\\pos(${px(x0)},${px(y0)})\\bord0\\shad0\\1c${p.white}\\1a${p.whiteAlpha}\\p1}${box}`,
    `Dialogue: 8,${a},${b},Ending,,0,0,0,,{\\an7\\pos(${px(x0 + p.textLeft * k)},${px(textTop)})\\fs${size}}${assText(text)}`,
    `Dialogue: 8,${a},${b},Ending,,0,0,0,,{\\an7\\pos(0,0)\\bord0\\shad0\\1c${p.red}\\p1}${arrowPath}`,
  ];
}

/** COP-382: the ending's style: Montserrat Black in #111111, no edge, placed by its events. */
function endingStyle(H) {
  return `Style: Ending,${LOOK_FONTS.black.name},${lookFontSize(LOOK_FONTS.black, ENDING_PILL.em * (H / HEIGHT))},&H00111111,&H00111111,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`;
}

/**
 * COP-382: the ending's events: the pill popping in over three frames at Luke's sizes, then at its own to the film's end.
 * `at` writes a time of the cut's clock; the pop's frames are ENDING.popSec of the finished film each.
 */
function endingDialogues(e, W, H, at, speed = 1) {
  const step = ENDING.popSec * speed;
  return [
    ...ENDING.pop.flatMap((s, k) => endingPillEvents(e.text, s, W, H, at(e.in + k * step), at(e.in + (k + 1) * step))),
    ...endingPillEvents(e.text, 1, W, H, at(e.in + ENDING.pop.length * step), at(e.out)),
  ];
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

/**
 * #4788: the cut's shots as a viewer sees them: each split where its framing changes (`framingChangesSec`: an added cut,
 * or a pause cut that changes the framing with addedCuts, on the delivered film's clock), so the pace record's cuts a
 * minute and shots over LONG_SHOT_SEC count them. A change on a shot's own edge splits nothing. With none, the shots as
 * they came.
 */
export function shotsSplitAt(shots, changes) {
  const times = (Array.isArray(changes) ? changes : []).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (times.length === 0) return shots;
  return shots.flatMap((shot) => {
    const marks = [shot.start, ...times.filter((t) => t > shot.start + 1e-6 && t < shot.end - 1e-6), shot.end];
    return marks.slice(1).map((end, k) => ({ start: marks[k], end }));
  });
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
export function motionArgs(file, from = null, seconds = null, readFps = null) {
  return [
    "-hide_banner", "-nostats",
    ...(from !== null ? ["-ss", sec(from)] : []), ...(seconds !== null ? ["-t", sec(seconds)] : []),
    "-i", file, "-an",
    // COP-357: a film repeated to 30 frames a second is read back on `readFps` (FPS), its own frames, before the change.
    "-vf", `${readFps ? `fps=${readFps},` : ""}${MOTION_READ}:file=-`,
    "-f", "null", "-",
  ];
}

/** motionArgs' printout as [{ t, y }]: each frame's time and its mean change. */
export function readMotion(stdout) {
  const rows = [];
  let t = null;
  for (const line of String(stdout ?? "").split("\n")) {
    // COP-361: ffmpeg prints a tiny number with %g ("6.94444e-05"); the exponent and a sign are part of the number.
    const time = line.match(/pts_time:([-+]?[\d.]+(?:e[-+]?\d+)?)/i);
    if (time) {
      t = Number(time[1]);
      continue;
    }
    const y = line.match(/YAVG=([-+]?[\d.]+(?:e[-+]?\d+)?)/i);
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
      Object.assign(last, { takeSec: last.takeSec + seg.seconds - (seg.endCardHoldSec ?? 0), lastSeg: i, endsOnReaction });
      return;
    }
    // #4585: the picture held under the end card is not the take's.
    takes.push({
      n: seg.sceneIndex, start: seg.startSec, takeSec: seg.seconds - (seg.endCardHoldSec ?? 0), dialogue: seg.audio === "clip",
      planSec: plans.get(seg.sceneIndex)?.durationSec ?? 0, lastSeg: i, endsOnReaction,
    });
  });
  for (const c of timeline.cutaways) {
    takes.push({ n: c.sceneIndex, start: c.startSec, takeSec: c.seconds, dialogue: false, planSec: plans.get(c.sceneIndex)?.durationSec ?? 0, endsOnReaction: false });
  }
  return takes.map(({ lastSeg, start, ...t }) => ({ ...t, at: start / speed, sec: t.takeSec / speed }));
}

/**
 * #4805: the frames where a picture jumps, as the flash check reads a cut: a change of a cut's size (FLASH_BARS'
 * spikeYavg, and spikeOverMedian times the median change), from readMotion's rows. Each is the time of the first frame
 * of the new picture.
 */
export function pictureJumps(motion, bars = FLASH_BARS) {
  const values = motion.map((m) => m.y).sort((a, b) => a - b);
  const median = values.length ? values[Math.floor(values.length / 2)] : 0;
  return motion.filter((r) => r.y >= bars.spikeYavg && r.y >= median * bars.spikeOverMedian).map((r) => r.t);
}

/**
 * #4805: where a clip's own picture jumps (pictureJumps), on its own clock; none when its picture cannot be read. Read
 * on the cut's own frame grid (FPS), as the flash check reads a film repeated to 30 frames a second (COP-357), so a
 * frame shown twice is never a change of its own.
 */
function clipJumps(file) {
  const read = spawnSync("ffmpeg", motionArgs(file, null, null, FPS), { encoding: "utf8", maxBuffer: 1 << 28 });
  return read.status === 0 ? pictureJumps(readMotion(read.stdout)) : [];
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

/**
 * freezeCheck's runs: the finished film's, and (COP-357, fix A) the takes' read before the look, merged; the end card,
 * which the check leaves out, is left out of both.
 */
function cutFreezes(motion, lookRows, endCard, speed) {
  const found = freezes(motion);
  if (!lookRows) return found;
  return mergedFreezes([...found, ...freezes(endCard ? lookRows.filter((r) => r.t < endCard.in / speed) : lookRows)]);
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
 * the render. Caption sync is checked apart, with captionCheck (cutSync): it
 * needs where each word is heard in the finished cut, not the words the captions came from.
 * With blipCheck and freezeCheck in `finish`, the checks also name blips (each
 * shot's source length found through `shotOf`, the storyboard's sourceShot, in
 * `sourceAd`) and freezes; with them off, their keys are absent. The same holds
 * for Plan 14's checks, floorCheck to nameCheck: `cards` are the text cards
 * burned in and `speed` the cut's speed-up, so every time they name is the
 * finished cut's. `endCard` (endCardLayers) is the pack-photo end card: its
 * slow push-in is still picture by design, so freezeCheck reads only the
 * picture before it.
 */
function checkCut({ timeline, storyboard, screens, rows, scenes, out, loudness, levels, finish = null, sourceAd = null, shotOf = () => null, cards = [], speed = 1, endCard = null, lookRows = null, readFps = null }) {
  const roles = new Map(timeline.spine.map((seg) => [seg.sceneIndex, roleOf(seg)]));
  for (const c of timeline.cutaways) roles.set(c.sceneIndex, "b-roll");
  const shots = scenes.map((p) => ({ n: p.scene, role: roles.get(p.scene) ?? "b-roll", start: p.startSec, end: roundMs(p.startSec + p.seconds) }));
  const read = spawnSync("ffmpeg", motionArgs(out, null, null, readFps), { encoding: "utf8", maxBuffer: 1 << 28 });
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
    ...(finish?.freezeCheck ? { freezes: cutFreezes(endCard ? motion.filter((r) => r.t < endCard.in / speed) : motion, lookRows, endCard, speed) } : {}),
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
export function loudnessApplyArgs(mix, measured, out, limiter = null, linear = false) {
  // COP-354: under a room bed, pass one's gain alone, the same for every sample, ahead of the limiter: loudnorm's dynamic
  // mode would lift the bed in a long pause. Only with the limiter: without it a plain gain can end over the peak bar
  // where loudnorm keeps the film under it, so that cut takes today's pass.
  if (linear && measured && limiter) {
    return [
      "-y", "-hide_banner", "-loglevel", "error", "-i", mix,
      "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
      "-af", `volume=${round2(FINISH_LUFS - measured.i)}dB${limiter ? `,${limiter}` : ""},${stereo}`,
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
    ];
  }
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

/** The mix normalized with pass one's numbers into `out`, through the limiter at `limit` when one is given. */
function applyLoudness(mix, measured, out, limit, linear = false) {
  const args = loudnessApplyArgs(mix, measured, out, limit == null ? null : peakLimiter(limit), linear);
  const res = spawnSync("ffmpeg", args, { stdio: ["inherit", "inherit", "pipe"], encoding: "utf8", maxBuffer: 1 << 26 });
  if (res.status !== 0) {
    // ffmpeg's words still reach the log, and its reason leads the error:
    // a run keeps only the first 500 characters of a failed cut's message.
    if (res.stderr) process.stderr.write(res.stderr);
    const quoted = args.map((a) => (/[\s\[\];]/.test(a) ? `'${a}'` : a)).join(" ");
    throw new FirstCutError(1, `ffmpeg failed on the loudness pass: ${ffmpegReason(res)} The command it ran:\n  ffmpeg ${quoted}`);
  }
  return measureLoudness(out);
}

/** Both passes on the mix, then the finished cut measured again. A receipt may
 * retain that final observation without changing the legacy mastering result.
 * `limit` (limitPeaks) is the limiter's ceiling, PEAK_LIMIT; a limited cut over
 * the limit is limited again lower (LIMIT_AGAIN_MAX), one under it is left as it is.
 * `linear` (COP-354, a room bed laid; COP-383, or the sheet's music): pass two is pass one's gain alone (loudnessApplyArgs). */
export function finishLoudnessPass(mix, out, limit = null, onMeasured = null, linear = false) {
  const measured = measureLoudness(mix);
  let ceiling = limit;
  let finished = applyLoudness(mix, measured, out, ceiling, linear);
  let again = 0;
  while (ceiling != null && finished && finished.tp > TRUE_PEAK_MAX_DB && again < LIMIT_AGAIN_MAX) {
    const lower = lowerPeakLimit(ceiling, finished.tp);
    if (lower >= ceiling) break;
    ceiling = lower;
    finished = applyLoudness(mix, measured, out, ceiling, linear);
    again++;
  }
  const refusal = truePeakRefusal(finished);
  if (refusal) throw new LoudnessRefusal(refusal, finished);
  onMeasured?.(finished);
  return {
    lufs: round2(finished.i), truePeak: round2(finished.tp), passes: measured ? 2 : 1,
    ...(limit != null ? { limited: true } : {}), ...(again > 0 ? { limitedAgain: again, limit: ceiling } : {}),
  };
}

/**
 * COP-353: the worker's last guard (scout auto-cut.ts deadStretch) reads silences off the finished film with ffmpeg's
 * silencedetect at these numbers (media-probe.ts SILENCE_NOISE, SILENCE_MIN_DURATION_SEC). A picked voice chain lifts
 * the film's quiet floor over that noise level, so the cut reads them off the voice alone instead (heardSilences).
 */
export const GUARD_SILENCE = { noise: "-50dB", minSec: 0.5 };
/** COP-353: said when other sounds lie under the voice, so the voice alone is not the film's silence. */
const SOUNDS_UNDER_NOTE = "voiceSilences: music lies under the voice, so the worker's last guard reads the film's own silences, as today";
/**
 * A sound effect, a bed of its own or a reaction's tail sounds under only part of the voice: the voice alone is not the
 * film's silence, and the film's own silences would be filled by a picked chain's floor or a room bed. So the pick is
 * not used there, and the worker's last guard reads the film as today.
 */
const partlyUnderNote = (what, kept) =>
  `${what}: a sound effect, a bed or a reaction's end lies under part of the voice, so the worker's last guard could not ` +
  `hear a silent stretch with it; ${kept}`;

/**
 * COP-353: the voice's silences as today's cut would deliver it: the voice alone through `clean` (today's chain, or
 * none), at the film's level (the loudness pass's gain, with finishLoudness), read as the worker reads a film's (paired
 * starts and ends; a start with no end left out, as there), on the finished film's clock (the voice is the mix's clock,
 * before the speed step); null when ffmpeg cannot make or read it.
 */
function heardSilences(timeline, { resolve, out, clean, levelSegments, finishLoudness, speed }) {
  const base = path.resolve(path.dirname(out), path.basename(out, path.extname(out)));
  const file = `${base}.voice-silence.wav`;
  try {
    const args = buildFfmpegArgs(timeline, { resolve, music: null, out: file, finish: { levelSegments, ...(clean ? { clean } : {}) }, voiceOnly: true });
    if (spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] }).status !== 0) return null;
    const lufs = finishLoudness ? measureLufs(file) : null;
    const gainDb = heardVoice(lufs) ? round2(FINISH_LUFS - lufs) : 0;
    // The shortest silence on the film's clock: the voice runs before the speed step, so it is that much longer here.
    const res = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af",
      `volume=${gainDb}dB,silencedetect=n=${GUARD_SILENCE.noise}:d=${roundMs(GUARD_SILENCE.minSec * speed)}`, "-f", "null", "-"],
      { encoding: "utf8", maxBuffer: 1 << 26 });
    if (res.status !== 0) return null;
    const runs = [];
    for (const line of String(res.stderr ?? "").split(/\r?\n/)) {
      // COP-361: ffmpeg prints a tiny number with %g ("6.25e-05"); the exponent and a sign are part of the number.
      const start = line.match(/silence_start\s*[:=]\s*([-+]?[\d.]+(?:e[-+]?\d+)?)/i);
      if (start) {
        runs.push({ start: Number(start[1]), duration: NaN });
        continue;
      }
      const end = line.match(/silence_end\s*[:=]\s*([-+]?[\d.]+(?:e[-+]?\d+)?).*?silence_duration\s*[:=]\s*([-+]?[\d.]+(?:e[-+]?\d+)?)/i);
      if (!end) continue;
      const last = runs.at(-1);
      if (last && !Number.isFinite(last.duration)) Object.assign(last, { end: Number(end[1]), duration: Number(end[2]) });
      else runs.push({ start: Number(end[1]) - Number(end[2]), end: Number(end[1]), duration: Number(end[2]) });
    }
    return runs.filter((r) => Number.isFinite(r.duration))
      .map((r) => ({ start: roundMs(r.start / speed), end: roundMs(r.end / speed), duration: roundMs(r.duration / speed) }));
  } finally {
    rmSync(file, { force: true });
  }
}

/** COP-354: the two working files of a room bed, beside the cut: the voice measured alone, and the bed. */
function roomPaths(out) {
  const base = path.resolve(path.dirname(out), path.basename(out, path.extname(out)));
  return { voice: `${base}.voice-level.wav`, bed: `${base}.room.wav` };
}

/** COP-354: a sound file's RMS level (dBFS), decoded as floats; null when ffmpeg cannot read it or it is silent. */
function rmsDbOf(file) {
  const res = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (res.status !== 0 || !res.stdout?.length) return null;
  const bytes = res.stdout.subarray(0, res.stdout.length & ~3);
  const x = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  let power = 0;
  for (const v of x) power += v * v;
  return power > 0 ? round2(10 * Math.log10(power / x.length)) : null;
}

/**
 * COP-354: a room bed for this cut: the voice measured alone after its chain (one pass of its sound, no picture), the
 * bed made by its preset for the film's whole length and measured, and the gain that puts its RMS `underDb` (ROOM_UNDER_DB;
 * COP-385, quietRoom: QUIET_ROOM_DB more) under the voice's integrated loudness (gainUnder). Or, when one cannot be had,
 * the note that says why; the cut then keeps its own faint bed.
 */
function roomBed(name, timeline, { resolve, out, clean, levelSegments, pictureSec, underDb = ROOM_UNDER_DB }) {
  const files = roomPaths(out);
  const voiceArgs = buildFfmpegArgs(timeline, { resolve, music: null, out: files.voice, finish: { levelSegments, ...(clean ? { clean } : {}) }, voiceOnly: true });
  if (spawnSync("ffmpeg", voiceArgs, { stdio: ["ignore", "ignore", "pipe"] }).status !== 0) {
    rmSync(files.voice, { force: true });
    return { note: `roomSound ${name}: ffmpeg could not render the voice alone, so the cut's own faint room tone stayed` };
  }
  const voiceLufs = measureLufs(files.voice);
  rmSync(files.voice, { force: true });
  if (!heardVoice(voiceLufs)) {
    return { note: `roomSound ${name}: the voice had no loudness to set the room against, so the cut's own faint room tone stayed` };
  }
  const made = spawnSync("ffmpeg", roomBedArgs(name, pictureSec, files.bed), { stdio: ["ignore", "ignore", "pipe"] });
  const bedRmsDb = made.status === 0 ? rmsDbOf(files.bed) : null;
  const gainDb = gainUnder(voiceLufs, underDb, bedRmsDb, null);
  if (gainDb === null) {
    rmSync(files.bed, { force: true });
    return { note: `roomSound ${name}: ffmpeg could not make the room, so the cut's own faint room tone stayed` };
  }
  return { room: { file: files.bed, gainDb }, record: { sound: name, voiceLufs, bedRmsDb, gainDb, underDb } };
}

/**
 * COP-383: the sheet's music at Luke's level for this cut: the voice measured alone after its chain (one pass of its
 * sound, as roomBed's), the music measured, the gain that puts it LIGHT_MUSIC.underDb under the voice, and the duck's
 * threshold LIGHT_MUSIC.duck.underDb under the voice, as a level. Or the note that says why it cannot be laid.
 */
/**
 * COP-383: ffmpeg's range for sidechaincompress's threshold (its option's own bounds); a duck keyed below it is no duck.
 */
export const SIDECHAIN_THRESHOLD = { min: 0.000976563, max: 1 };

/**
 * COP-383: the music's gain and its duck's threshold for a voice of `voiceLufs` and music of `musicLufs` (LIGHT_MUSIC), or
 * a note when it cannot be laid: a voice or music with no loudness to set it by, or a voice so quiet that the duck's
 * threshold would fall below ffmpeg's range (SIDECHAIN_THRESHOLD): no sane duck, so no music. The threshold is kept
 * inside the range. Never throws: the film never fails because of its music.
 */
export function lightMusicLevels(voiceLufs, musicLufs) {
  if (!heardVoice(voiceLufs)) return { note: "musicMix: the voice had no loudness to set the music against, so the video has no music" };
  const gainDb = gainUnder(voiceLufs, LIGHT_MUSIC.underDb, musicLufs, null);
  if (gainDb === null) return { note: "musicMix: the music file could not be measured, so the video has no music" };
  const raw = 10 ** ((voiceLufs - LIGHT_MUSIC.duck.underDb) / 20);
  if (!(raw >= SIDECHAIN_THRESHOLD.min)) {
    return { note: `musicMix: the voice is too quiet (${voiceLufs} LUFS) for the music's duck to follow it, so the video has no music` };
  }
  const threshold = Math.min(SIDECHAIN_THRESHOLD.max, Math.round(raw * 1e6) / 1e6);
  return { gainDb, threshold: Math.max(SIDECHAIN_THRESHOLD.min, threshold) };
}

function lightMusicBed(file, timeline, { resolve, out, clean, levelSegments }) {
  const voice = `${path.resolve(path.dirname(out), path.basename(out, path.extname(out)))}.music-voice-level.wav`;
  const voiceArgs = buildFfmpegArgs(timeline, { resolve, music: null, out: voice, finish: { levelSegments, ...(clean ? { clean } : {}) }, voiceOnly: true });
  if (spawnSync("ffmpeg", voiceArgs, { stdio: ["ignore", "ignore", "pipe"] }).status !== 0) {
    rmSync(voice, { force: true });
    return { note: "musicMix: ffmpeg could not render the voice alone to set the music against, so the video has no music" };
  }
  const voiceLufs = measureLufs(voice);
  rmSync(voice, { force: true });
  const musicLufs = heardVoice(voiceLufs) ? measureLufs(file) : null;
  const levels = lightMusicLevels(voiceLufs, musicLufs);
  if (levels.note) return levels;
  const { gainDb, threshold } = levels;
  return { music: { file, gainDb, threshold }, record: { voiceLufs, musicLufs, gainDb, underDb: LIGHT_MUSIC.underDb, duck: { ...LIGHT_MUSIC.duck, threshold } } };
}

/**
 * COP-384, extraShots: a run's sheet's extra shots (b-roll), the clips the worker laid in the manifest's `extraShots`
 * (scout auto-cut.ts writeOneTakeShots), cut in at Luke's lock (lab/post_v2.py ins_times, prep_insert, final3, render2),
 * on the finished film's clock, after the speed step, under the burned words:
 * - when: on the word that brings each in (its `nth` time, as the finished film's words say it), from its start less
 *   `leadSec`, never before `notBeforeSec`, at least `gapSec` after the last shot ends, `seconds` long, ending
 *   `lastLineClearSec` before the last line's first word (and `endClearSec` before the film's end); one under `minSec`
 *   is left out, as is one on the first or the last line or whose word is not heard; at most `most`;
 * - how: from `clipFromSec` into its clip, at `playSpeed`, settling from `zoomFrom` to 1 over `zoomFrames` frames, the
 *   voice and everything under it carrying on; over the whole frame (`full`), or on its top `splitShare` with the person
 *   below (`split`): a crop around the take's face (its box, on the film; with none, `faceAt`) from the frame widened
 *   with a blurred copy of itself (`blur`), the face's top `crop.faceTop` and its bottom at most `crop.faceBottom` down
 *   the crop, so the head is never cut and the captions, at `captionsAt` of the height while a split shot is on, sit
 *   under the chin;
 * - a whoosh `whoosh.leadSec` before each, `whoosh.underDb` under the voice, the one sound the worker made for them.
 */
export const EXTRA_SHOTS = {
  most: 6, seconds: 1.7, leadSec: 0.1, notBeforeSec: 0.6, gapSec: 0.7, minSec: 1.0, lastLineClearSec: 0.05, endClearSec: 0.3,
  clipFromSec: 0.3, playSpeed: 1.5, zoomFrom: 1.16, zoomFrames: 6,
  splitShare: 0.46, captionsAt: 0.76, captionsHalf: 0.04, captionsLowest: 0.86, faceAt: [0.5, 0.4],
  crop: { widthShare: 0.72, marginShare: 0.3, faceTop: 0.12, faceBottom: 0.46 },
  blur: "24:2",
  whoosh: { leadSec: 0.08, underDb: 14 },
};

/** COP-384: a word as the shots match it (video/lib/oneTakeBroll.ts oneTakeShotWord): lower case, its ends' punctuation off. */
export const shotWord = (word) => String(word ?? "").toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** COP-384: the manifest's extra shots that read: each a number, a clip, a word and which time it is said, a layout. */
export function extraShotsOf(manifest) {
  const list = Array.isArray(manifest?.extraShots) ? manifest.extraShots : [];
  return list.flatMap((s) => (isObject(s) && Number.isInteger(s.n) && hasText(s.file) && hasText(s.word) && Number.isInteger(s.nth) && s.nth >= 1 &&
    (s.layout === "full" || s.layout === "split")
    ? [{ n: s.n, file: s.file, word: s.word, nth: s.nth, label: hasText(s.label) ? s.label : `shot ${s.n}`, layout: s.layout }]
    : []));
}

/**
 * COP-384: whether a shot's clip is a video ffmpeg can read: ffprobe finds a picture stream and decodes a frame of it
 * where the cut starts reading (EXTRA_SHOTS.clipFromSec).
 */
export function shotClipReadable(file) {
  const res = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-read_intervals", `${EXTRA_SHOTS.clipFromSec}%+#1`,
    "-show_entries", "stream=codec_type:frame=pts_time", "-of", "json", file,
  ], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (res.status !== 0) return false;
  try {
    const info = JSON.parse(res.stdout);
    return info?.streams?.[0]?.codec_type === "video" && Array.isArray(info.frames) && info.frames.length > 0;
  } catch {
    return false;
  }
}

/** COP-384: the line each finished word belongs to, as indexes 0 up, by its script line (every word has one). */
function lineIndexes(rows) {
  let k = -1;
  return rows.map((r, i) => (i === 0 || r.lineId !== rows[i - 1].lineId ? ++k : k));
}

/**
 * COP-384: where each shot comes in on the finished film (EXTRA_SHOTS): `rows` are its words on its own clock (the
 * script's words as the captions place them, each with its `lineId`, or, with no script, the heard words), `filmSec`
 * its length, `stopAt` where words over the last shot begin (none: null), `notBefore` where an opening headline ends
 * (none: 0). Returns the placed shots, each with its `start`, `end` and `at` (its word's start), and a note for each
 * left out.
 */
export function placeExtraShots(shots, rows, { filmSec, stopAt = null, notBefore = 0, joins = [] } = {}) {
  const E = EXTRA_SHOTS;
  const notes = [];
  const placed = [];
  if (rows.length === 0) return { placed, notes: shots.map((s) => `extraShots: shot ${s.n} (${s.label}) was left out: the film has no words to place it on`) };
  // The lines are known when every word carries its script line; else the board's plan, which kept no shot on the
  // script's first or last line, is followed, and only the film's end and the words over the last shot bound a shot.
  const linesKnown = rows.every((r) => hasText(r.lineId));
  const lines = linesKnown ? lineIndexes(rows) : rows.map(() => 1);
  const lastLine = linesKnown ? lines.at(-1) : Infinity;
  const lastStart = linesKnown ? rows[lines.indexOf(lastLine)].start : Infinity;
  let limit = lastLine > 0 ? Math.min(filmSec - E.endClearSec, lastStart - E.lastLineClearSec) : filmSec - E.endClearSec;
  if (Number.isFinite(stopAt)) limit = Math.min(limit, stopAt - E.lastLineClearSec);
  let last = 0;
  for (const shot of shots.slice(0, E.most)) {
    const left = (why) => notes.push(`extraShots: shot ${shot.n} (${shot.label}) was left out: ${why}`);
    const hits = rows.flatMap((r, i) => (shotWord(r.text) === shotWord(shot.word) ? [i] : []));
    const i = hits[shot.nth - 1];
    if (i === undefined) {
      left(hits.length === 0 ? `"${shot.word}" is not heard in the film` : `"${shot.word}" is heard ${hits.length} time${hits.length === 1 ? "" : "s"}, not ${shot.nth}`);
      continue;
    }
    if (lines[i] === 0 || lines[i] === lastLine) {
      left(`"${shot.word}" is said on the ${lines[i] === 0 ? "first" : "last"} line`);
      continue;
    }
    const floor = Math.max(E.notBeforeSec, last + E.gapSec, notBefore);
    let start = Math.max(rows[i].start - E.leadSec, floor);
    // COP-384 landing review: a cut in the person's footage just before the shot, or just after it, would show a sliver
    // of the person under FLASH_BARS.maxSec, a flash: the shot comes in on that cut instead (or, below its floor, lets
    // the person run that long first), and ends on the cut after it (or that long before it, past the limit).
    const snap = FLASH_BARS.maxSec;
    const cutBefore = joins.filter((j) => j < start - 1e-6 && start - j < snap).at(-1);
    if (cutBefore !== undefined) start = cutBefore >= floor - 1e-6 ? cutBefore : cutBefore + snap;
    let end = Math.min(start + E.seconds, limit);
    const cutAfter = joins.find((j) => j > end + 1e-6 && j - end < snap);
    if (cutAfter !== undefined) end = cutAfter <= limit + 1e-6 ? cutAfter : cutAfter - snap;
    if (end - start < E.minSec) {
      left("there is no room for it before the last line");
      continue;
    }
    placed.push({ ...shot, start: roundMs(start), end: roundMs(end), at: rows[i].start });
    last = end;
  }
  return { placed, notes };
}

/**
 * COP-384: the split layout's frame: the shot's height on top, the person's strip below, the blurred canvas's margin
 * each side, and the crop of the canvas around the face: `face` is the take's face box on the film (top, bottom, left,
 * right as parts of the frame) or null. Luke's crop is 0.72 of the width, as tall as the strip's shape; with a box it
 * grows (to the canvas at most) until the face fits between EXTRA_SHOTS.crop.faceTop and faceBottom of its height, and
 * sits with the face's top at faceTop; with none it centres (0.5, 0.40) as his does. `minHc`: a crop at least this tall
 * (the person shown smaller, splitCaptionPlace), with the canvas widened as far as it needs.
 */
export function splitLayout(face, W = WIDTH, H = HEIGHT, { minHc = 0 } = {}) {
  const E = EXTRA_SHOTS;
  const splitH = Math.floor(Math.floor(H * E.splitShare) / 2) * 2;
  const stripH = H - splitH;
  let margin = Math.floor(Math.floor(W * E.crop.marginShare) / 2) * 2;
  let canvasW = W + 2 * margin;
  let wc = Math.floor(Math.floor(W * E.crop.widthShare) / 2) * 2;
  let hc = Math.floor(Math.floor((wc * stripH) / W) / 2) * 2;
  let cx;
  let y0;
  if (face) {
    const need = ((face.bottom - face.top) * H) / (E.crop.faceBottom - E.crop.faceTop);
    if (need > hc) {
      hc = Math.min(H, Math.ceil(need / 2) * 2);
      wc = Math.ceil((hc * W) / stripH / 2) * 2;
      if (wc > canvasW) {
        wc = canvasW;
        hc = Math.floor((wc * stripH) / W / 2) * 2;
      }
    }
    if (minHc > hc) {
      hc = Math.min(H, Math.ceil(minHc / 2) * 2);
      wc = Math.ceil((hc * W) / stripH / 2) * 2;
      margin = Math.max(margin, Math.ceil((wc - W) / 4) * 2);
      canvasW = W + 2 * margin;
    }
    cx = (face.left + face.right) / 2;
    y0 = face.top * H - E.crop.faceTop * hc;
  } else {
    cx = E.faceAt[0];
    y0 = E.faceAt[1] * H - E.faceAt[1] * hc;
  }
  const x0 = Math.round(Math.min(Math.max(cx * W + margin - wc / 2, 0), canvasW - wc));
  y0 = Math.round(Math.min(Math.max(y0, 0), H - hc));
  return { splitH, stripH, margin, crop: [wc, hc, x0, y0] };
}

/** COP-384: where the face sits on the film while a split shot is on: its top and bottom in the person's strip, as parts of the height. */
export function faceInStrip(face, split, H = HEIGHT) {
  const [, hc, , y0] = split.crop;
  const at = (v) => Math.round(((split.splitH + ((v * H - y0) * split.stripH) / hc) / H) * 10_000) / 10_000;
  return { top: at(face.top), bottom: at(face.bottom) };
}

/**
 * COP-384: where a split shot's captions sit, clear of the face in the person's strip (`face` the take's box on the
 * film, `split` its layout, `share` the tallest caption screen over the shot as a part of the height), each choice told
 * by `how`:
 * - "at": at EXTRA_SHOTS.captionsAt (0.76, Luke's), when the screens there keep FACE_CLEAR_SHARE from the face;
 * - "below": else just under the chin, FACE_CLEAR_SHARE from it, when the screens then end by captionsLowest (0.86);
 * - "smaller": else the person shown smaller (a taller crop of a wider canvas) until they do, the captions under the
 *   chin; the crop as tall as the frame at most, the captions under the chin then wherever it is, `fits` false when that
 *   is past captionsLowest.
 * With no face, Luke's place. The band is the captions' centre less and plus captionsHalf.
 */
export function splitCaptionPlace({ face, split, share }, W = WIDTH, H = HEIGHT) {
  const E = EXTRA_SHOTS;
  const bandAt = (centre) => [Math.round((centre - E.captionsHalf) * 10_000) / 10_000, Math.round((centre + E.captionsHalf) * 10_000) / 10_000];
  const at = bandAt(E.captionsAt);
  if (!face) return { band: at, how: "at", split };
  if (bandClear(at, share, faceInStrip(face, split, H))) return { band: at, how: "at", split };
  const under = (layout) => faceInStrip(face, layout, H).bottom + FACE_CLEAR_SHARE + share / 2;
  const fits = (centre) => centre + share / 2 <= E.captionsLowest + 1e-9;
  if (fits(under(split))) return { band: bandAt(under(split)), how: "below", split };
  let smaller = split;
  for (let hc = split.crop[1] + 2; hc <= H; hc += 2) {
    smaller = splitLayout(face, W, H, { minHc: hc });
    if (fits(under(smaller))) break;
  }
  // Even with the whole frame's height in the strip they may not fit: then they sit under the chin all the same, past
  // captionsLowest, and `fits` says so.
  return { band: bandAt(under(smaller)), how: "smaller", split: smaller, fits: fits(under(smaller)) };
}

/** COP-384: a placed shot on the film's 24 fps frames: its first frame and how many it covers (at least one). */
export function shotFrames(shot) {
  const first = Math.round(shot.start * FPS);
  return { first, frames: Math.max(1, Math.round(shot.end * FPS) - first) };
}

/** COP-384: the cut's note of where a split shot's captions sit, and why (splitCaptionPlace's `how`). */
export function splitCaptionsNote(shot) {
  const at = ((shot.captionBand[0] + shot.captionBand[1]) / 2).toFixed(2);
  const E = EXTRA_SHOTS;
  if (shot.captionsHow === "below") {
    return `extraShots: while shot ${shot.n} is on, the captions sit just under the chin, at ${at} of the height: at ${E.captionsAt} they would touch the face`;
  }
  if (shot.captionsHow === "smaller" && shot.captionsFit === false) {
    return `extraShots: shot ${shot.n} shows the person as small as the frame allows, and the captions under the chin still pass ${E.captionsLowest}: they are centred at ${at} of the height, since at ${E.captionsAt} they would touch the face`;
  }
  if (shot.captionsHow === "smaller") {
    return `extraShots: shot ${shot.n} shows the person smaller, so the face sits higher and the captions fit under the chin, at ${at} of the height: at ${E.captionsAt} they would touch the face, and under it they would pass ${E.captionsLowest}`;
  }
  return `extraShots: while shot ${shot.n} is on, the captions sit at ${E.captionsAt} of the height, over the person's half`;
}

/**
 * COP-384: caption screens shown while a split shot is on sit over the person: in the shot's own band (`captionBand`,
 * splitCaptionPlace), else at EXTRA_SHOTS.captionsAt of the height.
 */
export function captionsOverSplits(screens, placed, speed = 1) {
  const splits = placed.filter((s) => s.layout === "split");
  if (splits.length === 0) return screens;
  const at = [EXTRA_SHOTS.captionsAt - EXTRA_SHOTS.captionsHalf, EXTRA_SHOTS.captionsAt + EXTRA_SHOTS.captionsHalf];
  return screens.map((c) => {
    const shot = splits.find((s) => c.s / speed < s.end && c.e / speed > s.start);
    return shot ? { ...c, band: shot.captionBand ?? at } : c;
  });
}

/**
 * COP-384: the whoosh's gain for this cut: the voice measured alone after its chain (as lightMusicBed measures it; the
 * music's own measure when it ran), the whoosh's RMS (Luke's mean_volume), and the gain that puts it
 * EXTRA_SHOTS.whoosh.underDb under the voice. Or the note that says why it cannot be laid.
 */
function whooshGain(file, timeline, { resolve, out, clean, levelSegments, voiceLufs = null }) {
  let voice = voiceLufs;
  if (!Number.isFinite(voice)) {
    const alone = `${path.resolve(path.dirname(out), path.basename(out, path.extname(out)))}.whoosh-voice-level.wav`;
    const args = buildFfmpegArgs(timeline, { resolve, music: null, out: alone, finish: { levelSegments, ...(clean ? { clean } : {}) }, voiceOnly: true });
    const made = spawnSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] }).status === 0;
    voice = made ? measureLufs(alone) : null;
    rmSync(alone, { force: true });
  }
  if (!heardVoice(voice)) return { note: "extraShots: the voice had no loudness to set the whoosh against, so the shots come in with no whoosh" };
  const gainDb = gainUnder(voice, EXTRA_SHOTS.whoosh.underDb, rmsDbOf(file), null);
  if (gainDb === null) return { note: "extraShots: the whoosh could not be measured, so the shots come in with no whoosh" };
  return { gainDb, record: { voiceLufs: voice, gainDb, underDb: EXTRA_SHOTS.whoosh.underDb } };
}

/**
 * COP-354: whether the cut lays its own faint room tone (ROOM_TONE), the bed a room sound stands in for: not on a cut
 * laid on its measured map, a voice laid whole, a run with beds of its own (ElevenLabs), or one whose manifest turns
 * the room tone off.
 */
export function laysOwnRoomTone({ mapped, wholeVoice, fileBeds, roomTone }) {
  return !mapped && !wholeVoice && !fileBeds && roomTone !== false;
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
 * mix before the loudness pass (a .mov, whose sound stays uncompressed until
 * that pass), the voice and bed cutChecks measures, and captionCheck's checks.
 */
export function finishPaths(outPath) {
  const dir = path.dirname(outPath);
  const base = path.basename(outPath, path.extname(outPath));
  return {
    pace: path.join(dir, `${base}.pace.json`),
    mix: path.join(dir, `${base}.mix.mov`),
    sync: path.join(dir, `${base}.sync.json`),
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

const UNPROVEN_HANDLES = ["action-lead-unproven", "action-tail-unproven"];
const UNOBSERVED_HANDLES = ["action-lead-unobserved", "action-tail-unobserved"];

/** The scenes whose action proves a product operation or a readout: a missing handle observation there holds. */
function productProofScenes(board) {
  const scenes = new Set((board?.scenes ?? []).filter((scene) => scene.mechanismCoverage?.length).map((scene) => scene.sceneIndex));
  for (const overlay of board?.overlays ?? []) {
    const phaseId = overlay.proof?.actionPhaseId;
    const scene = phaseId ? board.scenes?.find((entry) => entry.actionPhases?.some((phase) => phase.id === phaseId)) : null;
    if (scene) scenes.add(scene.sceneIndex);
  }
  return scenes;
}

/**
 * A template text finish keeps footage whose generic action handle has no
 * measured picture event and says so in a note instead of holding the cut. A
 * measured short action, and a handle on a product-operation or readout scene,
 * still refuse. Without a text stage, only director-derived generic handles can become notes.
 */
function noteUnprovenHandles(map, notes, proofScenes, eligible = null) {
  map.findings = map.findings.filter((f) => {
    if (!UNPROVEN_HANDLES.includes(f.code) || proofScenes.has(f.scene) || (eligible && !eligible(f))) return true;
    notes.push(`${f.code}: scene ${f.scene}: ${f.detail}`);
    return false;
  });
}

/** Throws SourceMapRefusal for the map's refusals; its "declared" findings are carried out and recorded. */
function refuseUnholdable(map, deferredScenes = new Set()) {
  const refused = map.findings.filter((f) => f.severity === "refuse" &&
    !(deferredScenes.has(f.scene) && UNPROVEN_HANDLES.includes(f.code)));
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

/** #4585: the end card would cover some of the cut's voice (voiceUnderEndCard), so the cut is not delivered. */
export class VoiceUnderEndCardRefusal extends FirstCutError {
  constructor(words) {
    super(1, voiceUnderEndCardMessage(words));
    this.name = "VoiceUnderEndCardRefusal";
    this.words = words;
  }
}

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

/** ASR-only spelling equivalence, never canonical/TTS proof. Keep original
 * words visible: a phonetic brand match is not a pronunciation certification. */
function equivalentAsrWording(text, retainedWords) {
  const normalize = (words) => {
    const side = spokenTokens(words);
    return { ...side, tokens: side.tokens.map((token) => soundKey(token).replace(/([b-df-hj-np-tv-z])\1+/g, "$1")) };
  };
  const scripted = normalize(scriptWords(text));
  const retained = normalize(retainedWords);
  const heard = joinSplitWords(retained, scripted.tokens);
  const expected = joinSplitWords(scripted, heard.tokens);
  return expected.tokens.length === heard.tokens.length &&
    expected.tokens.every((token, i) => token === heard.tokens[i]);
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
      if (kept.length && !equivalentAsrWording(line.text, kept.map((word) => word.text))) {
        const scenes = (board.scenes ?? []).filter((scene) => scene.lineIds?.includes(line.lineId)).map((scene) => scene.sceneIndex);
        notes.push(`source-wording-unresolved: ${line.lineId}: ${scenes.length ? `scene ${scenes.join(", ")}: ` : ""}source words may be missing or different; kept available ${source} audio for review, not a clean approved-word pass`);
      }
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
  // A template's generic action handle with no exact-source observation keeps
  // its footage and is a note, not a hold. Product-operation and readout
  // scenes, and every observed failure, still hold.
  const proofScenes = template ? productProofScenes(board) : new Set();
  const blockingHolds = (holds) => holds.filter((hold) => {
    if (!template || !UNOBSERVED_HANDLES.includes(hold.code) ||
      [...proofScenes].some((sceneIndex) => hold.id === `scene:${sceneIndex}`)) return true;
    finishNotes.push(`${hold.code}: ${hold.id}: ${hold.reason}`);
    return false;
  });
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
  const heldFulfillment = blockingHolds(fulfillment.holds);
  const verifyObservation = !heldFulfillment.length && observedItems.length && prepareReadoutVerifier
    ? await prepareReadoutVerifier({
        source, sourceBytes, items: observedItems,
        heardWords: material.words.map((w) => ({ word: w.text, start: w.start, end: w.end, cueLineId: w.lineId ?? undefined })),
      })
    : undefined;
  let text = planText({
    ...material, libass: renderer.libass, measureText: renderer.measureText,
    source, verifyObservation, inheritedHolds: [...heldFulfillment, ...material.pictureHolds],
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
        inheritedHolds: [...heldFulfillment, ...material.pictureHolds],
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
    if (template) noteUnprovenHandles(cut.sourceMap, finishNotes, proofScenes);
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
export function firstCut({ dir, out: outOpt, skip = new Set(), music: musicOn = true, stillFill = false, prepareText = false, heardWords = null }) {
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
    readJumps: (file) => clipJumps(here(file)),
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
  // COP-382: a run's sheet's words over the last shot lengthen the film (placeEndingWords), so it is read again then.
  let pictureSec = timeline.spine.reduce((sum, seg) => sum + seg.seconds, 0);
  // COP-273 W2 cut, songEnd: where the film ends against the last sung word.
  if (timeline.songEnd) notes.push(songEndNote(timeline.songEnd, pictureSec));
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
  // addedCuts (COP-355): with each take's own framing now set, no join between two takes shows the same picture.
  framingAtJoins(timeline.spine);
  const speed = paced
    ? paceSpeed
    : finish?.cutPace && !template && !timeline.wholeVoice && !protectedMotion ? speedFor(pictureSec, finish.targetSeconds) : 1;
  if (finish?.cutPace && (template || protectedMotion)) notes.push("template/action/listening/ending clocks remain real time; cutPace does not accelerate the cut");
  // A template's text stage decides every action handle (an unobserved generic
  // one becomes a note there); other runs defer only planned action phases.
  const deferredHandles = prepareText ? new Set((storyboard?.scenes ?? []).filter((s) => template || s.actionPhases?.length).map((s) => s.sceneIndex)) : new Set();
  // addedCuts (COP-355): the framing changes made, on the delivered film's clock, for the worker's last guard.
  const framingChangesSec = finish?.addedCuts ? framingChangeTimes(timeline.spine, speed, timeline.cutaways) : null;
  // COP-373 review: the cuts added alone, apart from the pause cuts that change the framing with the row on.
  const addedCutsSec = finish?.addedCuts ? addedCutTimes(timeline.spine, speed, timeline.cutaways) : null;
  // #4805: the joins a pause level made, on the same clock, so the worker can make the film again without them.
  const pauseJoinsSec = finish?.pauseTrim && !finish.keepPauses ? pauseJoinTimes(timeline.spine, speed) : null;
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
    if (template && !prepareText) {
      // Director-derived breathing room retains footage without certifying an
      // observed action. Explicit handles and authored proof phases stay strict.
      noteUnprovenHandles(timeline.sourceMap, notes, productProofScenes(storyboard), (finding) => {
        const scene = storyboard?.scenes?.find((entry) => entry.sceneIndex === finding.scene);
        const lead = finding.code === "action-lead-unproven";
        if (!scene || scene.actionPhases?.length || scene[lead ? "actionLeadSec" : "actionTailSec"] > 0) return false;
        const lineId = lead ? scene.lineIds?.[0] : scene.lineIds?.at(-1);
        return lineId && scene.directorBeats?.some(({ timing }) => timing?.minActionSec > 0 && (lead
          ? timing.start?.boundary === "scene-start" && timing.end?.lineId === lineId && timing.end.edge === "start"
          : timing.start?.lineId === lineId && timing.start.edge === "end" && timing.end?.boundary === "scene-end"));
      });
    }
    refuseUnholdable(timeline.sourceMap, deferredHandles);
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
  // COP-382: the folder of the cut's own fonts, when the burn names one of them (captionFontsDir).
  let fontsDir = null;
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
    endLayers = packPhoto ? placeEndCard(timeline, brand, storyboard, pictureSec, speed, notes, finish.songEditing ?? null) : null;
    if (!endLayers) notes.push("the pull has no pack photo of the product, so the end card was not drawn");
  }
  // COP-382: a run's sheet's words over the last shot, on a cut of its own clock with no end card.
  let ending = null;
  if (finish?.endingWords) {
    const why = endLayers ? "the kind's end card closes this video"
      : stagedText ? "the text stage draws this cut's words"
        : timeline.mapped ? "this cut is laid on its measured map"
          : template ? "a template launch's clock is its own"
            : !hasFilter("subtitles") ? "this ffmpeg has no subtitles filter (libass) to draw them, so the film ends as it was"
              // The pill is sized to Montserrat Black's own widths: in another font its words could run past it.
              : !captionFontsDir() ? "the cut's fonts were not found beside it, so the film ends as it was" : null;
    if (why) notes.push(`ending: "${finish.endingWords}" was not drawn over the last shot: ${why}`);
    else {
      ending = placeEndingWords(timeline, finish.endingWords, speed, notes);
      if (ending) pictureSec = timeline.spine.reduce((sum, seg) => sum + seg.seconds, 0);
    }
  }
  // COP-384: a run's sheet's extra shots (EXTRA_SHOTS), placed on the finished film's clock once an opening headline's end
  // is known (in the burn below, or after it), and laid after the speed step.
  const shotsAsked = finish?.extraShots ? extraShotsOf(manifest) : [];
  const shotsWhy = stagedText ? "the text stage draws this cut's words" : timeline.mapped ? "this cut is laid on its measured map" : template ? "a template launch's clock is its own" : null;
  if (finish?.extraShots && shotsAsked.length === 0) notes.push("extraShots: the folder holds no extra shot, so the film has none");
  for (const s of shotsAsked.filter((shot) => !exists(shot.file))) notes.push(`extraShots: shot ${s.n} (${s.label}) was left out: ${s.file} is not in the folder`);
  // A clip ffmpeg cannot read is left out with a note before anything is placed, so it never fails the cut.
  const shotsUsable = shotsWhy ? [] : shotsAsked.filter((shot) => exists(shot.file)).filter((shot) => {
    if (shotClipReadable(here(shot.file))) return true;
    notes.push(`extraShots: shot ${shot.n} (${shot.label}) was left out: ${shot.file} could not be read as a video`);
    return false;
  });
  if (shotsWhy && shotsAsked.length > 0) notes.push(`extraShots: the shots were not laid: ${shotsWhy}`);
  let shotsPlaced = null;
  const placeShots = (notBefore = 0) => {
    // The script's words as the captions place them (lineWords), every one of them, each with its line, timed again by
    // the finished film's heard words as the captions are; a cut with no script reads its heard words.
    const scripted = lineWords(timeline, storyboard, { everyWord: true }).map(({ line, guessed: _g, ...r }) => ({ ...r, lineId: line }));
    const base = scripted.length > 0 ? scripted : wordRows(timeline);
    const rows = (heardWords?.length ? retimeWords(base, heardWords, speed) : base).map((r) => ({ ...r, start: r.start / speed, end: r.end / speed }));
    const stopAt = ending ? ending.in / speed : endLayers ? endLayers.in / speed : null;
    // Landing review: the film's own cuts (its pieces' joins and the cuts added), on the finished film's clock.
    const joins = [...sceneTimes(timeline).slice(1).map((p) => p.startSec / speed), ...(framingChangesSec ?? [])].sort((a, b) => a - b);
    const { placed, notes: left } = placeExtraShots(shotsUsable, rows, { filmSec: pictureSec / speed, stopAt, notBefore, joins });
    notes.push(...left);
    return placed;
  };
  // Each split shot with the take on screen at its middle, its layout around that take's face on the film, and, given
  // the tallest caption screen over it (`shareOver`, a part of the height, null with none), its captions' place.
  const layShots = (placed, shareOver = () => null) => {
    const faces = filmFaces(timeline, new Map(manifest.scenes.flatMap((scene) => (faceBoxOf(scene.faceBox) ? [[scene.sceneIndex, faceBoxOf(scene.faceBox)]] : []))));
    return placed.map((shot) => {
      if (shot.layout !== "split" || shot.split) return shot;
      const take = takeAt(timeline, ((shot.start + shot.end) / 2) * speed);
      const face = faces.get(take) ?? null;
      // COP-384 landing review: with no face box for its take (none found, or the look failed), a crop could cut the
      // head off, so the shot covers the whole frame instead, and the note says so.
      if (!face) {
        notes.push(`extraShots: shot ${shot.n} (${shot.label}) is laid full screen, not split: take ${take}'s face was not found, so the person's half could not be cropped around it`);
        return { ...shot, layout: "full", take, asked: "split" };
      }
      const split = splitLayout(face);
      const share = shareOver(shot);
      if (share === null) return { ...shot, take, split, faced: Boolean(face) };
      const place = splitCaptionPlace({ face, split, share });
      return {
        ...shot, take, split: place.split, faced: Boolean(face), captionBand: place.band, captionsHow: place.how,
        ...(place.fits === false ? { captionsFit: false } : {}),
      };
    });
  };
  if (finish && (finish.captions || finish.cards || endLayers || ending) && !stagedText) {
    if (hasFilter("subtitles")) {
      ass = "edit.ass";
      const cap = sourceAd?.captions ?? manifest.sheetCaptions ?? null;
      // COP-300: a cut made again after its caption check failed times its captions by the finished film's heard words.
      const timed = (words) => (heardWords?.length ? retimeWords(words, heardWords, speed) : words);
      // COP-273 W2 cut, songCaptions: a sung run's saved look, on a song laid whole only.
      const songLook = finish.captions && finish.songCaptions && timeline.wholeVoice ? SONG_CAPTION_LOOKS[finish.songCaptions] : null;
      // COP-382: a look of Luke's lock (the sheet's `look`) groups and times its screens as his finish does. Its boxes are
      // laid by its own fonts' widths, so with those fonts not found the captions are drawn as today's, never a box laid
      // for one font around words drawn in another. A sung run's own look comes first.
      const lookWanted = finish.captions && !songLook ? drawnLookOf(cap) : null;
      if (lookWanted || ending) fontsDir = captionFontsDir();
      const look = lookWanted && fontsDir ? lookWanted : null;
      // The captions stop before the end card (at its dip, on a sung run), or, COP-382, ENDING.captionsClearSec of the film
      // before words over the last shot (post3.py t_stop).
      const stop = endLayers
        ? (endLayers.dip ? { in: endLayers.dip.from } : endLayers)
        : ending ? { in: roundMs(ending.in - ENDING.captionsClearSec * speed) } : endLayers;
      // COP-383: the cut's words and how they are grouped into screens, kept so captions moved off a face are grouped again.
      const capWords = !finish.captions ? [] : timed(songLook || finish.captionsByLine ? lineWords(timeline, storyboard) : wordRows(timeline));
      const screensOf = (words) => (songLook
        ? songCaptionScreens(words, songLook)
        : look
          ? lookCaptionScreens(words, cap, speed)
          : finish.captionsByLine
            ? lineCaptionScreens(words, cap)
            : captionScreens(words, cap));
      let screens = captionsBeforeEndCard(finish.captions ? screensOf(capWords) : [], stop);
      if (lookWanted) {
        notes.push(look
          ? `captions: the ${look} look of Luke's lock, in the cut's own fonts`
          : `captions: the ${lookWanted} look of Luke's lock was not drawn: its fonts were not found beside the cut, so the captions are white letters as before`);
        if (look && finish.captionColours) notes.push("captionColours: a look of Luke's lock keeps its own colours");
      }
      if (finish.captions) burned = screens;
      // COP-356: a run's sheet may put its card at the top, as a headline for the opening.
      const headline = finish.cards && !copied && (finish.cardPlace === "top" || finish.cardPlace === "top-film");
      burnedCards = finish.cards
        ? (copied
          ? copied.cards
          : headline
            ? headlineCards(storyboard, timeline, { speed, headRoom: finish.headRoom ?? null, ...(finish.cardPlace === "top-film" ? { untilSec: stop?.in ?? pictureSec + 1 } : {}) })
            : storyboardCards(storyboard, timeline))
        : [];
      const drawn = burnedCards.find((c) => c.headline && c.label);
      // COP-383: each take's captions in the nearest band clear of its face, never under the headline at the top.
      const faces = new Map(manifest.scenes.flatMap((scene) => (faceBoxOf(scene.faceBox) ? [[scene.sceneIndex, faceBoxOf(scene.faceBox)]] : [])));
      if (finish.captions && !songLook && faces.size > 0) {
        const screensWith = (words, c) => (look ? lookCaptionScreens(words, c, speed) : finish.captionsByLine ? lineCaptionScreens(words, c) : captionScreens(words, c));
        const offFace = captionsOffFace({
          screens, words: capWords, screensWith, cap, timeline, faces: filmFaces(timeline, faces), headline: Boolean(drawn),
          ...(finish.captionsByLine ? { capMaxShare: CAPTION_MAX_SHARE } : {}),
          // The member's card over the chest (cardBox's lower box), and any other card drawn in a box, never a headline:
          // each as drawn, past its box's own edges (cardDrawnBand).
          cards: burnedCards.filter((c) => c.label && !c.headline && Array.isArray(c.box)).map((c) => ({ ...cardDrawnBand(c.box), in: c.in, out: c.out })),
        });
        screens = captionsBeforeEndCard(offFace.screens, stop);
        burned = screens;
        notes.push(...offFace.notes);
      }
      // COP-384: the shots come in after an opening headline, and captions over a split shot sit over the person's half.
      if (shotsUsable.length > 0) {
        const capShare = finish.captionsByLine ? CAPTION_MAX_SHARE : null;
        const shareOver = (shot) => {
          const over = screens.filter((c) => c.s / speed < shot.end && c.e / speed > shot.start);
          return over.length > 0 ? Math.max(...over.map((c) => captionBlockShare(c, cap, WIDTH, HEIGHT, capShare))) : null;
        };
        shotsPlaced = layShots(placeShots(drawn && finish.cardPlace === "top" ? drawn.out / speed : 0), finish.captions ? shareOver : undefined);
        if (drawn && finish.cardPlace === "top-film" && shotsPlaced.length > 0) notes.push("extraShots: the headline at the top for the whole video stays over the shots");
        if (finish.captions && shotsPlaced.some((shot) => shot.layout === "split")) {
          screens = captionsOverSplits(screens, shotsPlaced, speed);
          burned = screens;
          for (const shot of shotsPlaced.filter((s) => s.captionsHow)) notes.push(splitCaptionsNote(shot));
        }
      }
      if (drawn) {
        notes.push(finish.cardPlace === "top-film"
          ? "cardPlace: the card is a headline at the top for the whole video; every step closer keeps the frame's top edge"
          : `cardPlace: the card is a headline at the top, from the first frame to ${roundMs(drawn.out / speed)} s`);
      }
      writeFileSync(here(ass), editAss({
        captions: songLook ? songLitScreens(screens, songLook) : finish.captionColours ? colourScreens(screens, storyboard) : screens,
        cap,
        ...(songLook ? { songLook } : finish.captionsByLine ? { capMaxShare: CAPTION_MAX_SHARE } : {}),
        cards: burnedCards,
        hook: copied?.hook ?? null,
        // A copied ad has an end card only where its source does. The pack-photo end card takes the CTA words' place.
        endCard: !endLayers && finish.cards && (!sourceAd || sourceAd.endCard) ? endCardOf(storyboard, pictureSec) : null,
        endLayers,
        speed,
        ending,
      }));
    } else {
      notes.push(
        endLayers
          ? "this ffmpeg has no subtitles filter (libass), so the captions, cards and the end card's words were not burned in"
          : "this ffmpeg has no subtitles filter (libass), so the captions and cards were not burned in",
      );
    }
  }
  // cleanVoice, where this ffmpeg has the filters. A voice laid whole is a song, kept as it is. COP-353: voiceSound
  // names another of the cut's chains in VOICE_CLEAN's place; where this ffmpeg lacks one of its filters, the voice is
  // cleaned as before, and the record says why.
  let clean = null;
  // The chain today's cut would clean the voice with (none where it would not), for the silences the guard reads.
  let todayClean = null;
  if (finish?.cleanVoice && !timeline.mapped) {
    const picked = finish.voiceSound ? VOICE_SOUNDS[finish.voiceSound] : null;
    const needs = picked ? [...new Set([...chainFilters(picked), ...UNDER_FILTERS])] : [];
    const missing = timeline.wholeVoice ? [] : missingFilters(picked ? [...new Set([...CLEAN_FILTERS, ...needs])] : CLEAN_FILTERS);
    const own = CLEAN_FILTERS.filter((name) => missing.includes(name));
    const pickedMissing = needs.filter((name) => missing.includes(name));
    if (!timeline.wholeVoice && own.length === 0) todayClean = { voice: VOICE_CLEAN, under: UNDER_VOICE };
    if (timeline.wholeVoice) notes.push("the voice is a song laid whole, so it was kept as it is, not cleaned");
    else if (picked && pickedMissing.length === 0) clean = { voice: picked, under: UNDER_VOICE };
    else if (own.length > 0) notes.push(`this ffmpeg has no ${own.join(", ")} filter, so the voice was not cleaned`);
    else {
      if (picked) {
        notes.push(`this ffmpeg has no ${pickedMissing.join(", ")} filter, so the voice was cleaned as before, not with voiceSound ${finish.voiceSound}`);
      }
      clean = { voice: VOICE_CLEAN, under: UNDER_VOICE };
    }
  }
  // COP-357, the phone look, on a cut of its own clock only.
  let look = null;
  let deliverFps = null;
  const lookAsked = ["fps30", "lensSmudge", "phonePass"].filter((key) => finish?.[key]);
  if (lookAsked.length && (template || timeline.mapped)) {
    notes.push(`${lookAsked.join(", ")} ${lookAsked.length === 1 ? "is" : "are"} not applied to a template launch's cut or one laid on its measured map`);
  } else if (lookAsked.length) {
    if (finish.lensSmudge) {
      const missing = missingFilters(LOOK_FILTERS.lensSmudge);
      if (missing.length) notes.push(`this ffmpeg has no ${missing.join(", ")} filter, so the lens smudge was not added`);
      else {
        const frame = spineFrameAt(timeline.spine, LENS_SMUDGE.readAtSec);
        const side = frame ? brighterSide(here(frame.file), frame.atSec) : null;
        look = { smudge: side ?? "right" };
        notes.push(side
          ? `lensSmudge: a light smudge on the top ${side}, the brighter corner ${LENS_SMUDGE.readAtSec.toFixed(1)} s into the takes`
          : `lensSmudge: a light smudge on the top right; the picture ${LENS_SMUDGE.readAtSec.toFixed(1)} s into the takes could not be read for its brighter corner`);
      }
    }
    if (finish.phonePass) {
      const missing = missingFilters(LOOK_FILTERS.phonePass);
      if (missing.length) notes.push(`this ffmpeg has no ${missing.join(", ")} filter, so the phone pass was not added`);
      else {
        look = { ...look, phonePass: true };
        notes.push("phonePass: grain and a light phone pass on the takes' picture, no shake");
      }
    }
    // Fix A: a picture pass laid, so the takes are read before it too.
    // #4787 (COP-373 review): from two identical frames only on a cut whose framing changed, as the worker's guard.
    if (look) look = { ...look, probe: true, ...(framingChangesSec && framingChangesSec.length > 0 ? { probeMinSec: LOOK_PROBE.framingMinSec } : {}) };
    if (finish.fps30) {
      deliverFps = DELIVERY_FPS;
      notes.push(`fps30: the film is delivered at ${DELIVERY_FPS} frames a second, one frame in four shown twice; the cut's clock stays at ${FPS}`);
    }
  }
  let peakLimit = null;
  if (finish?.limitPeaks) {
    if (hasFilter("alimiter")) peakLimit = PEAK_LIMIT;
    else notes.push("this ffmpeg has no alimiter filter, so the loudness pass ran without the limiter");
  }
  const paths = finishPaths(out);
  const rendered = finish?.finishLoudness ? paths.mix : out;
  const meters = finish?.cutChecks ? {
    voice: paths.voice, bed: paths.bed,
    ...(manifest.templateMotion?.enabled === true || manifest.roomTone === false || finish.roomSound === "none" ? { allowAbsentBed: true } : {}),
  } : null;
  // The burn reads its file from the folder ffmpeg runs in, so every path is absolute then; so does the look's probe,
  // which writes its side files there.
  const at = ass || look ? (file) => path.resolve(dir, file) : here;

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
      { ...sound, effects: sound.effects.filter((x) => exists(x.file)), beds: sound.beds },
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
  // COP-353: a picked chain lifts the film's quiet floor over the worker's silence probe (-50 dB), which would then
  // hear no held, voiceless stretch. So the voice is heard alone, as today's cut would deliver it (its own chain, at the
  // film's level, no bed), and its silences go to the worker in the record (`voiceSilences`). If they cannot be read,
  // the pick is not used and the voice is cleaned as before. The voice alone is the film's silence only when nothing
  // else lies under it. Music runs under the whole film and fills its silences today already, so the worker reads the
  // film's own silences, as today, and the record says so. A sound effect, a bed of its own or a reaction's tail lies
  // under only part of it: the film's other silences would be hidden from the guard, so the pick is not used.
  // COP-383: a run's sheet's music (musicMix "light") is a bed like the room: the worker gets the voice's own silences
  // with it (below), so a voice that drops out under the music is still caught. Only the kind's own music is `musicUnder`.
  const sheetMusic = finish?.musicMix === "light" && Boolean(music);
  const musicUnder = Boolean(music) && !sheetMusic;
  const partlyUnder = !musicUnder && ((mixSound?.effects?.length ?? 0) > 0 || (mixSound?.beds?.length ?? 0) > 0 ||
    timeline.spine.some((seg) => seg.audio === "clip" && seg.reaction?.tail));
  let voiceSilencesHeard = null;
  if (clean && finish.voiceSound && clean.voice === VOICE_SOUNDS[finish.voiceSound]) {
    if (musicUnder) {
      notes.push(SOUNDS_UNDER_NOTE);
    } else if (partlyUnder) {
      notes.push(partlyUnderNote(`voiceSound ${finish.voiceSound}`, "the voice was cleaned as before"));
      clean = todayClean;
    } else {
      voiceSilencesHeard = heardSilences(timeline, {
        resolve: here, out, clean: todayClean, levelSegments: !finish.finishLoudness, finishLoudness: finish.finishLoudness, speed,
      });
      if (!voiceSilencesHeard) {
        notes.push(`voiceSound ${finish.voiceSound}: the voice's silences could not be read, so the voice was cleaned as before`);
        clean = todayClean;
      }
    }
  }
  // COP-354, roomSound: the cut's own bed in the place of its faint brown one, where it lays that one; none lays none.
  let room = null;
  let roomRecord = null;
  if (finish?.roomSound) {
    const laysOwn = laysOwnRoomTone({ mapped: timeline.mapped === true, wholeVoice: Boolean(timeline.wholeVoice), fileBeds: mixSound?.beds?.length ?? 0, roomTone: mixSound?.roomTone });
    if (!laysOwn) notes.push(`roomSound ${finish.roomSound} was not applied: this cut lays no room tone of its own`);
    else if (finish.roomSound === "none") {
      room = { none: true };
      roomRecord = { sound: "none" };
    } else {
      // A bed fills every silence of the film: the worker's guard reads the voice's own (COP-353's pass, once a cut),
      // unless music lies under the voice too, which fills the film's silences today already. A sound under only part
      // of it (partlyUnder) keeps the cut's own faint bed.
      if (!musicUnder && !partlyUnder) {
        voiceSilencesHeard ??= heardSilences(timeline, {
          resolve: here, out, clean: todayClean, levelSegments: !finish.finishLoudness, finishLoudness: finish.finishLoudness, speed,
        });
      }
      const made = partlyUnder
        ? { note: partlyUnderNote(`roomSound ${finish.roomSound}`, "the cut's own faint room tone stayed") }
        : musicUnder || voiceSilencesHeard
          ? roomBed(finish.roomSound, timeline, {
            resolve: at, out, clean, levelSegments: !finish.finishLoudness, pictureSec,
            underDb: ROOM_UNDER_DB + (finish.quietRoom ? QUIET_ROOM_DB : 0),
          })
          : { note: `roomSound ${finish.roomSound}: the voice's silences could not be read, so the cut's own faint room tone stayed` };
      if (made.note) notes.push(made.note);
      else {
        ({ room, record: roomRecord } = made);
        if (finish.quietRoom) notes.push(`quietRoom: the room sound ${roomRecord.underDb} dB under the voice, ${QUIET_ROOM_DB} dB quieter, as the sheet's ultra lays it`);
        if (musicUnder && !notes.includes(SOUNDS_UNDER_NOTE)) notes.push(SOUNDS_UNDER_NOTE);
      }
    }
  }
  // COP-383: a run's sheet's music at Luke's level, in the place of the kind's music mix, on a cut of its own clock. It
  // fills every silence of the film, as a room bed does, so it is laid only with the voice's own silences in hand for
  // the worker's guard (voiceSilences); when they cannot be read, the video has no music.
  let lightMusic = null;
  let musicRecord = null;
  const lightMusicNote = `musicMix: the sheet's music ${LIGHT_MUSIC.underDb} dB under the voice, fading in over ${LIGHT_MUSIC.fadeInSec} s and out over ${LIGHT_MUSIC.fadeOutSec} s, ducked lightly (ratio ${LIGHT_MUSIC.duck.ratio}) while the voice speaks`;
  // Whether the voice's own silences go to the worker: with a bed under the film (the room's, the sheet's music) or a
  // picked voice chain; with neither, the film is today's and the worker reads its own silences.
  const handsSilences = () => Boolean(room?.file || lightMusic || (clean && finish?.voiceSound && clean.voice === VOICE_SOUNDS[finish.voiceSound]));
  if (sheetMusic) {
    if (timeline.mapped || template) notes.push("musicMix: the sheet's music is not laid on a template launch's cut or one laid on its measured map");
    else {
      voiceSilencesHeard ??= heardSilences(timeline, {
        resolve: here, out, clean: todayClean, levelSegments: !finish.finishLoudness, finishLoudness: finish.finishLoudness, speed,
      });
      const made = voiceSilencesHeard
        ? lightMusicBed(at(music), timeline, { resolve: at, out, clean, levelSegments: !finish.finishLoudness })
        : { note: "musicMix: the voice's silences could not be read for the worker's last guard, so the video has no music" };
      if (made.note) notes.push(made.note);
      else {
        ({ music: lightMusic, record: musicRecord } = made);
        notes.push(lightMusicNote);
      }
    }
  }
  // With neither a picked chain nor a bed in the film after all, the film is today's: the worker reads its own silences.
  if (!handsSilences()) voiceSilencesHeard = null;
  // COP-384: the shots placed (with no burn to place them in, here), each split one with the frame of its take's face on
  // the film at its middle, and the whoosh at its gain.
  if (shotsUsable.length > 0 && shotsPlaced === null) shotsPlaced = placeShots(0);
  let extraShots = null;
  let shotsRecord = null;
  if (shotsPlaced?.length) {
    const shots = layShots(shotsPlaced);
    let whoosh = null;
    let whooshRecord = null;
    if (hasText(manifest.extraShotsWhoosh) && exists(manifest.extraShotsWhoosh)) {
      const made = whooshGain(at(manifest.extraShotsWhoosh), timeline, { resolve: at, out, clean, levelSegments: !finish.finishLoudness, voiceLufs: musicRecord?.voiceLufs ?? null });
      if (made.note) notes.push(made.note);
      else {
        whoosh = { file: manifest.extraShotsWhoosh, gainDb: made.gainDb };
        whooshRecord = made.record;
      }
    } else notes.push("extraShots: the folder holds no whoosh, so the shots come in with none");
    extraShots = { shots, ...(whoosh ? { whoosh } : {}) };
    for (const shot of shots) {
      notes.push(`extraShots: shot ${shot.n} (${shot.label}) on "${shot.word}", ${shot.start.toFixed(2)} to ${shot.end.toFixed(2)} s, ${shot.layout === "split" ? `split screen, the person's crop around ${shot.faced ? `take ${shot.take}'s face` : "the frame's centre"}` : "full screen"}`);
    }
    shotsRecord = {
      shots: shots.map((shot) => ({
        n: shot.n, word: shot.word, start: shot.start, end: shot.end, layout: shot.layout,
        ...(shot.split ? { crop: shot.split.crop } : {}),
        ...(shot.captionsHow ? { captions: { how: shot.captionsHow, band: shot.captionBand, ...(shot.captionsFit === false ? { fits: false } : {}) } } : {}),
      })),
      ...(whooshRecord ? { whoosh: whooshRecord } : {}),
    };
  }
  const argsWith = (withMusic) => buildFfmpegArgs(timeline, {
    resolve: at,
    music: music && !sheetMusic ? at(music) : null,
    out: rendered,
    ...(finish
      ? {
        finish: {
          levelSegments: !finish.finishLoudness, ass, speed, ...(finish.finishLoudness ? { pcmMix: true } : {}),
          ...(ass && fontsDir ? { fontsDir } : {}),
          ...(room ? { room } : {}),
          ...(pictures.length ? { pictures } : {}), ...(clean ? { clean } : {}), ...(meters ? { meters } : {}),
          ...(endLayers ? { endCard: endLayers } : {}),
          ...(look ? { look } : {}), ...(deliverFps ? { deliverFps } : {}),
          ...(withMusic && lightMusic ? { lightMusic } : {}),
          ...(extraShots ? { extraShots } : {}),
        },
      }
      : {}),
    ...(mixSound ? { sound: mixSound } : {}),
  });
  let ffmpegArgs = argsWith(true);
  if (meters?.allowAbsentBed) {
    rmSync(meters.voice, { force: true });
    rmSync(meters.bed, { force: true });
  }
  if (look) for (const file of [LOOK_PROBE.freeze, LOOK_PROBE.motion]) rmSync(here(file), { force: true });
  let res = spawnSync("ffmpeg", ffmpegArgs, { stdio: "inherit", ...(ass || look ? { cwd: path.resolve(dir) } : {}) });
  // COP-383: the film never fails for its music: a graph with the sheet's music that ffmpeg refuses is made again without it.
  if (res.status !== 0 && lightMusic) {
    // The record says what the film holds: no music, so no note of its level, and the voice's silences only when another
    // bed or a picked chain still asks for them.
    notes.splice(notes.indexOf(lightMusicNote), 1);
    notes.push("musicMix: ffmpeg could not lay the sheet's music, so the video was made again with no music");
    lightMusic = null;
    musicRecord = null;
    if (!handsSilences()) voiceSilencesHeard = null;
    ffmpegArgs = argsWith(false);
    res = spawnSync("ffmpeg", ffmpegArgs, { stdio: "inherit", ...(ass || look ? { cwd: path.resolve(dir) } : {}) });
  }
  if (room?.file) rmSync(room.file, { force: true });
  if (res.status !== 0) {
    const quoted = ffmpegArgs.map((a) => (/[\s\[\];]/.test(a) ? `'${a}'` : a)).join(" ");
    throw new FirstCutError(1, `ffmpeg failed. The command it ran:\n  ffmpeg ${quoted}`);
  }
  // COP-357, fix A: the takes as read before the look, on the film's clock, less what is laid over them.
  const lookProbe = look ? readLookProbe(here, {
    pictureSec, speed, covered: lookCovered({ cutaways: timeline.cutaways, pictures, endCard: endLayers }),
  }) : null;
  if (look && !lookProbe) notes.push("the takes before the look could not be read for a frozen picture, so only the finished film was checked");
  if (lookProbe && lookProbe.rowsRead < lookProbe.changes) {
    notes.push(`the takes before the look were read for ${lookProbe.rowsRead} of their ${lookProbe.changes} frame changes, so a frozen picture in them may have been missed`);
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
      loudness = finishLoudnessPass(rendered, out, peakLimit, template
        ? (measured) => { loudnessMeasurement = measured; } : null, Boolean(room?.file) || Boolean(lightMusic));
    } catch (error) {
      // A limited pass already limited itself again (#4573); the same mix would only be refused the same way.
      if (!template || peakLimit != null || !(error instanceof FirstCutError)) throw error;
      // The limiter on the same retained mix, never a provider call, limited again lower as finishLoudnessPass does.
      // If it still clips or cannot be measured, the refusal holds the cut.
      loudness = finishLoudnessPass(rendered, out, PEAK_LIMIT,
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
  const sync = finish?.captionCheck
    ? cutSync({ out, speed, scenes, rows, screens: ass && burned ? burned : [], manifest, here, readJson, ...(deliverFps ? { deliverFps } : {}) })
    : null;
  if (sync) writeFileSync(paths.sync, `${JSON.stringify(sync, null, 2)}\n`);

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
    refuseUnholdable(timeline.sourceMap, deferredHandles);
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
      ...(manifest.templateMotion?.enabled === true ? { durationReadback: sceneDurationReadback(timeline, storyboard, speed) } : {}),
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
        finish, sourceAd, shotOf: (n) => plans?.get(n)?.sourceShot ?? null, cards: burnedCards, speed,
        // COP-382: under words over the last shot the freeze check skips only the frames held on purpose.
        endCard: endLayers ?? (ending?.heldFrom !== undefined ? { in: ending.heldFrom } : null),
        ...(lookProbe ? { lookRows: lookProbe.rows } : {}), ...(deliverFps ? { readFps: FPS } : {}),
      })
    : null;
  // The pace record: the cut's own numbers, the settings it was cut with (so
  // a redo of the run matches), its loudness once the pass ran, and its checks.
  const pace = {
    ...paceReport({
      // #4788: an added cut is a cut the viewer sees, so the shots are split at the cut's framing changes.
      ourShots: shotsSplitAt(scenes.map((p) => ({ start: p.startSec, end: roundMs(p.startSec + p.seconds) })), framingChangesSec),
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
    // COP-300: the caption file is timed on the finished, sped-up cut's clock, as it is burned after the speed step.
    ...(ass && speed !== 1 ? { captionClock: "final" } : {}),
    ...(sync ? { sync: syncRecord(sync) } : {}),
    // COP-353: the voice's silences as today's cut delivers it, which the worker's last guard reads in place of the film's.
    ...(voiceSilencesHeard ? { voiceSilences: voiceSilencesHeard } : {}),
    // COP-354: the room sound the cut laid, and its level against the voice.
    ...(roomRecord ? { room: roomRecord } : {}),
    ...(musicRecord ? { music: musicRecord } : {}),
    // COP-384: the extra shots the cut laid, where and how, and the whoosh's level against the voice.
    ...(shotsRecord ? { extraShots: shotsRecord } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
  writeFileSync(paths.pace, `${JSON.stringify(pace, null, 2)}\n`);
  return withSound({
    out, durationSec, manifest, timeline, music, rows, sidecars, pace, ...(sync ? { sync } : {}),
    ...(framingChangesSec ? { framingChangesSec } : {}),
    ...(addedCutsSec ? { addedCutsSec } : {}),
    ...(pauseJoinsSec ? { pauseJoinsSec } : {}),
    // COP-357, fix A: for the worker's guard, the takes' frozen runs read before the look, on the film's clock.
    ...(lookProbe ? { lookFreeze: lookProbe.freezes } : {}),
  });
}

/**
 * COP-300, captionCheck: the finished cut checked against its own sound. Check A on its decoded sound and frames;
 * Check B on each burned caption, at the frame it is first seen, against its first word as the free listener
 * (placementHeard) finds it in the finished sound: each take's own word times, moved by where its sound sits there.
 * The sections are the cut's takes. The captions, sections and heard words come back with the verdicts, so the
 * worker can judge Check B again on a listen of its own, and cut again from the heard words.
 */
function cutSync({ out, speed, scenes, rows, screens, manifest, here, readJson, deliverFps = null }) {
  const sections = [];
  for (const p of scenes) {
    const last = sections.at(-1);
    if (last && last.id === p.scene) last.endSec = roundMs(p.startSec + p.seconds);
    else sections.push({ id: p.scene, startSec: p.startSec, endSec: roundMs(p.startSec + p.seconds) });
  }
  // COP-357: a film repeated to deliverFps shows each caption on the delivered frame that first holds its 24 fps frame.
  const seenOn = (t) => (deliverFps ? deliveredSeenSec(t, deliverFps) : t);
  const captions = screens.map((c) => ({ text: c.text, seenSec: roundMs(seenOn(captionSeenSec(captionStartCs(c.s / speed)))) }));
  const takes = (manifest.scenes ?? []).flatMap((scene) => {
    const file = scene.wordsFrom === "voice" ? scene.voice : scene.clip;
    const words = readJson(scene.words);
    const cutWords = rows.filter((r) => r.scene === scene.sceneIndex);
    if (!file || !Array.isArray(words) || cutWords.length === 0) return [];
    return [{
      file: here(file),
      heard: words.map((w) => ({ text: String(w.w ?? ""), start: w.s, end: w.e })),
      words: cutWords.map((r) => ({ text: r.text, start: r.start, end: r.end })),
    }];
  });
  const heard = captions.length ? placementHeard({ film: out, speed, takes }) : [];
  return {
    checkA: soundPictureCheck(out),
    checkB: captions.length ? captionSync({ captions, heard, sections }) : null,
    listener: captions.length ? "placement" : null,
    captionClock: "final",
    captions, sections, heard,
  };
}

/** The checks' numbers the pace record keeps: the verdicts, without each caption's row. */
export function syncRecord(sync) {
  const { rows, ...checkB } = sync.checkB ?? {};
  return { checkA: sync.checkA, checkB: sync.checkB ? checkB : null, listener: sync.listener };
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
  if (cut.durationReadback) {
    console.log(`Duration: board ${cut.durationReadback.plannedSec.toFixed(3)}s, kept ${cut.durationReadback.keptSec.toFixed(3)}s (retention is not action proof)`);
    for (const scene of cut.durationReadback.scenes) console.log(
      `  scene ${scene.sceneIndex}: planned ${scene.plannedSec ?? "unknown"}s, kept ${scene.keptSec}s` +
      (scene.actionMinimumSec > 0 ? `, action minimum ${scene.actionMinimumSec}s, shortfall ${scene.actionShortfallSec}s (${scene.clock}${scene.clock === "whole-voice" ? " clock unchanged" : " bound"})` : ""));
  }
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
  // COP-354: a room sound of the run's saved sheet is named, with its level; with none, there is none.
  const room = cut.pace?.room;
  const roomWords = room ? (room.sound === "none" ? "none" : `${room.sound}, ${room.underDb ?? ROOM_UNDER_DB} dB under the voice`) : null;
  console.log(`Room tone: ${roomWords ?? (manifest.roomTone === false ? "off" : "under the whole ad")}. Music bed: ${music ?? "none"}`);
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
