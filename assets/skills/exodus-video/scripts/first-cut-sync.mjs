// COP-300: two sync checks on a finished cut, in numbers only.
//
// Check A: the finished film's sound against its picture, its decoded samples
// against its frames: under SOUND_PICTURE_LIMIT_MS apart.
// Check B: each caption, at the frame it is first seen, against the start of
// its first word in the finished film's sound: no section (a take of the cut,
// a verse of a song) off by more than `sectionMs` at its median, and no growth
// of more than `growthMs` from the first section to the last.
//
// The finished film's word times come from a listen of the film (the worker's
// paid one), or from placementHeard: each take's own word times, moved by where
// that take's sound is found in the finished sound, word by word, by matching
// their loudness. It needs no transcriber and no paid call.
//
// A second cut (a song laid whole, say) calls captionSync with its own
// sections and limits; nothing here reads a kind of ad.
import { spawnSync } from "node:child_process";

/** Check A's limit: the finished sound and picture end at most this far apart. */
export const SOUND_PICTURE_LIMIT_MS = 40;
/** Check B's default limits: each section's median offset, and its growth from the first section to the last. */
export const CAPTION_SYNC_LIMITS = Object.freeze({ sectionMs: 80, growthMs: 60 });
/** A section is judged on at least this many captions whose first word was heard; fewer are listed, not judged. */
export const MIN_SECTION_CAPTIONS = 3;
/** A caption is tied to a heard word at most this far from where it is seen. */
const MAX_PAIR_SEC = 1.5;
/** placementHeard keeps a word whose loudness matches its take's at least this well. */
const MIN_MATCH = 0.8;
const LISTEN_RATE = 16000;

const round1 = (n) => Math.round(n * 10) / 10;
const round4 = (n) => Math.round(n * 10000) / 10000;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** A word for matching: lower case, accents and punctuation off. */
export const wordKey = (text) => String(text ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The longest run of equal words of `a` and `b` in order (each by wordKey): pairs [i, j]. */
export function alignWords(a, b) {
  const ka = a.map(wordKey);
  const kb = b.map(wordKey);
  const [n, m] = [ka.length, kb.length];
  const table = new Int32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * (m + 1) + j] = ka[i] && ka[i] === kb[j]
        ? table[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(table[(i + 1) * (m + 1) + j], table[i * (m + 1) + j + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (ka[i] && ka[i] === kb[j]) pairs.push([i++, j++]);
    else if (table[(i + 1) * (m + 1) + j] >= table[i * (m + 1) + j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Check B on any cut. `captions`: [{ text, seenSec }], each caption's words and the time it is first seen in the
 * finished film. `heard`: [{ text, start }], the finished film's words. `sections`: [{ id, startSec, endSec }]. A
 * caption is tied to the heard word that says its first word (the two word lists aligned in order), at most 1.5 s
 * away. Each section is judged on the median of its captions' offsets (seen minus heard, in ms; below zero the
 * caption is early), so one caption tied to the wrong word cannot fail it, when at least `minCaptions` of its
 * captions were tied. A section that holds captions but too few tied ones is listed in `unjudged`: it was not
 * checked. `pass` covers the judged sections only, and is null when none was judged; growth is the last judged
 * section's median minus the first's, null with fewer than two judged.
 */
export function captionSync({ captions, heard, sections, limits = CAPTION_SYNC_LIMITS, minCaptions = MIN_SECTION_CAPTIONS }) {
  const flat = [];
  const owner = [];
  captions.forEach((c, k) => String(c.text ?? "").split(/\s+/).filter(Boolean).forEach((word, n) => {
    flat.push(word);
    owner.push([k, n]);
  }));
  const firstHeard = new Map();
  for (const [i, j] of alignWords(flat, heard.map((h) => h.text))) {
    const [k, n] = owner[i];
    if (n === 0 && Math.abs(heard[j].start - captions[k].seenSec) <= MAX_PAIR_SEC) firstHeard.set(k, heard[j].start);
  }
  const rows = captions.flatMap((c, k) => firstHeard.has(k)
    ? [{ text: c.text, seenSec: round4(c.seenSec), heardSec: round4(firstHeard.get(k)), offsetMs: round1((c.seenSec - firstHeard.get(k)) * 1000) }]
    : []);
  const per = sections.map((s) => {
    const inside = (t) => t >= s.startSec && t < s.endSec;
    const offsets = rows.filter((r) => inside(r.seenSec)).map((r) => r.offsetMs);
    return {
      id: s.id, captions: captions.filter((c) => inside(c.seenSec)).length, n: offsets.length, judged: offsets.length >= minCaptions,
      meanMs: offsets.length ? round1(mean(offsets)) : null, medianMs: offsets.length ? round1(median(offsets)) : null,
    };
  });
  const judged = per.filter((s) => s.judged);
  const worst = judged.reduce((w, s) => (!w || Math.abs(s.medianMs) > Math.abs(w.medianMs) ? s : w), null);
  const growthMs = judged.length >= 2 ? round1(judged.at(-1).medianMs - judged[0].medianMs) : null;
  const worstMs = worst ? Math.abs(worst.medianMs) : null;
  return {
    pass: worst ? worstMs <= limits.sectionMs && (growthMs === null || Math.abs(growthMs) <= limits.growthMs) : null,
    worstMs, worstSection: worst?.id ?? null, growthMs,
    judged: judged.map((s) => s.id), unjudged: per.filter((s) => !s.judged && s.captions > 0).map((s) => s.id),
    limits: { sectionMs: limits.sectionMs, growthMs: limits.growthMs },
    captions: captions.length, paired: rows.length, sections: per, rows,
  };
}

/** Check A: a film's frames against its decoded sound samples, or null when either cannot be read. */
export function soundPictureCheck(file, { limitMs = SOUND_PICTURE_LIMIT_MS } = {}) {
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-count_packets", "-show_entries", "stream=codec_type,nb_read_packets,r_frame_rate,sample_rate", "-of", "json", file,
  ], { encoding: "utf8", maxBuffer: 1 << 24 });
  if (probe.status !== 0) return null;
  const streams = JSON.parse(probe.stdout || "{}").streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video || !audio) return null;
  const [num, den] = String(video.r_frame_rate).split("/").map(Number);
  const frames = Number(video.nb_read_packets);
  const sampleRate = Number(audio.sample_rate);
  const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-f", "s16le", "-"], { maxBuffer: 1 << 30 });
  if (pcm.status !== 0 || !(frames > 0) || !(num > 0) || !(den > 0) || !(sampleRate > 0)) return null;
  const samples = pcm.stdout.length / 2;
  const pictureSec = (frames * den) / num;
  const soundSec = samples / sampleRate;
  const soundMinusPictureMs = round1((soundSec - pictureSec) * 1000);
  return {
    frames, fps: num / den, pictureSec: round4(pictureSec), samples, sampleRate, soundSec: round4(soundSec),
    soundMinusPictureMs, limitMs, pass: Math.abs(soundMinusPictureMs) < limitMs,
  };
}

/** A file's first sound, mono, at LISTEN_RATE, or null. */
function decodeMono(file) {
  const res = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", String(LISTEN_RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (res.status !== 0) return null;
  const bytes = res.stdout;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

/** Loudness in dB on a 1 ms grid, each from a window of `winSec` centred on it; read at any time by `at`. */
function envelope(x, winSec) {
  const sums = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) sums[i + 1] = sums[i] + x[i] * x[i];
  const width = Math.max(1, Math.round(winSec * LISTEN_RATE));
  const grid = new Float32Array(Math.ceil((x.length / LISTEN_RATE) * 1000) + 1);
  for (let k = 0; k < grid.length; k++) {
    const c = Math.round((k / 1000) * LISTEN_RATE);
    const a = Math.min(Math.max(c - (width >> 1), 0), x.length);
    const b = Math.min(a + width, x.length);
    grid[k] = 10 * Math.log10((sums[b] - sums[a]) / Math.max(1, b - a) + 1e-12);
  }
  return (t) => grid[Math.min(grid.length - 1, Math.max(0, Math.round(t * 1000)))];
}

/** Each value raised to 40 dB under the loudest, so silence does not decide a match. */
const floored = (v) => {
  let top = -Infinity;
  for (const x of v) if (x > top) top = x;
  return v.map((x) => Math.max(x, top - 40));
};

/** Where one word of a take sits in the finished sound, against where the cut planned it: the lag in seconds and how well it matched. */
function lagOf(take, film, lo, hi, offset, speed) {
  const taus = [];
  for (let t = lo; t < hi; t += 0.001) taus.push(t);
  const a = floored(taus.map(take));
  const ma = mean(a);
  const da = a.map((x) => x - ma);
  const na = Math.sqrt(da.reduce((sum, d) => sum + d * d, 0));
  const lags = [];
  for (let k = -250; k <= 250; k++) lags.push(k / 1000);
  const r = lags.map((lag) => {
    const b = floored(taus.map((t) => film((t - offset) / speed + lag)));
    const mb = mean(b);
    let dot = 0;
    let nb = 0;
    for (let i = 0; i < b.length; i++) { const d = b[i] - mb; dot += d * da[i]; nb += d * d; }
    return dot / (na * Math.sqrt(nb) + 1e-9);
  });
  let j = 0;
  for (let i = 1; i < r.length; i++) if (r[i] > r[j]) j = i;
  let lag = lags[j];
  if (j > 0 && j < r.length - 1) {
    const den = r[j - 1] - 2 * r[j] + r[j + 1];
    if (den < 0) lag += 0.001 * 0.5 * (r[j - 1] - r[j + 1]) / den;
  }
  return { lag, corr: r[j] };
}

/**
 * The free listener. `film`: the finished cut's file; `speed`: its speed-up. `takes`: [{ file, heard, words }], each
 * take's file, its own word times in that file (`heard`: [{ text, start, end }]) and the cut's words of that take on
 * the finished film's clock (`words`: [{ text, start, end }]). Each cut word is tied to its take word (the two lists
 * aligned in order); the take's loudness around it is found in the finished sound, at most 250 ms either way. Returns
 * the finished film's words, each moved by what was found: [{ text, start, end, lagMs, match }]. A word whose loudness
 * matches poorly (a shared pause, a breath) is left out.
 */
export function placementHeard({ film, takes, speed = 1 }) {
  const filmSound = decodeMono(film);
  if (!filmSound) return [];
  const filmAt = envelope(filmSound, 0.020 / speed);
  const out = [];
  for (const take of takes) {
    const sound = decodeMono(take.file);
    if (!sound) continue;
    const takeAt = envelope(sound, 0.020);
    const pairs = alignWords(take.words.map((w) => w.text), take.heard.map((h) => h.text))
      .map(([i, j]) => ({ word: take.words[i], src: take.heard[j], offset: Math.round((take.heard[j].start - speed * take.words[i].start) * 24) / 24 }));
    pairs.forEach((p, k) => {
      let lo = p.src.start - 0.3;
      let hi = p.src.end + 0.3;
      // A neighbour cut elsewhere in the take bounds the window, so its sound is not matched here.
      if (k > 0 && Math.abs(pairs[k - 1].offset - p.offset) > 1e-6) lo = Math.max(lo, pairs[k - 1].src.end + 0.02);
      if (k + 1 < pairs.length && Math.abs(pairs[k + 1].offset - p.offset) > 1e-6) hi = Math.min(hi, pairs[k + 1].src.start - 0.02);
      if (hi - lo < 0.25) return;
      const { lag, corr } = lagOf(takeAt, filmAt, lo, hi, p.offset, speed);
      if (corr < MIN_MATCH) return;
      out.push({ text: p.word.text, start: round4(p.word.start + lag), end: round4(p.word.end + lag), lagMs: round1(lag * 1000), match: Math.round(corr * 1000) / 1000 });
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The cut's words timed by the finished film's heard words (a cut made again after Check B failed). `rows`: the
 * cut's words before its speed-up, [{ text, start, end, ... }]; `heard`: the finished film's words on its own clock;
 * `speed`: the cut's speed-up. Each row tied to a heard word (the two lists aligned in order) takes that word's
 * times; any other row moves with the nearest row before it that was tied (else the nearest after). The words stay
 * the rows' own.
 */
export function retimeWords(rows, heard, speed = 1) {
  const tied = new Map(alignWords(rows.map((r) => r.text), heard.map((h) => h.text)).map(([i, j]) => [i, heard[j]]));
  if (tied.size === 0) return rows;
  const shifts = rows.map((r, i) => (tied.has(i) ? tied.get(i).start * speed - r.start : null));
  return rows.map((r, i) => {
    if (tied.has(i)) {
      const h = tied.get(i);
      return { ...r, start: round4(h.start * speed), end: round4(Math.max(h.end ?? 0, h.start + 0.01) * speed) };
    }
    let shift = null;
    for (let k = i - 1; k >= 0 && shift === null; k--) shift = shifts[k];
    for (let k = i + 1; k < rows.length && shift === null; k++) shift = shifts[k];
    return { ...r, start: round4(r.start + shift), end: round4(r.end + shift) };
  });
}
