// The types of first-cut-drawn.mjs: how the cut draws a One-take film's drawn items (copy-coders
// docs/port/broll-in-app/PLAN.md, version 7, 3.3, 3.6 and 4.7 "Drawn items").
import type { CutawayDrawnKind, CutawayDrawnLaid } from "./first-cut-cutaways.mjs";

/** The drawn kinds this cut lays. */
export const DRAWN_KINDS_LAID: readonly CutawayDrawnKind[];
/** The words as the manifest gives them when they take the card's shape (no brace, backslash or line break), else null. */
export function drawnWordsOf(words: unknown): string | null;
export const DRAWN_LOOK: Readonly<Record<string, unknown>>;
/** A frame of the finished film as an ASS time, floored to the centisecond. */
export function drawnFrameTime(frame: number, fps?: number): string;
export function circlePath(cx: number, cy: number, r: number): string;
/** Words wrapped at their spaces at the largest em from `em` to `floorEm` where they fit; null when none does. */
export function fitWords(
  text: string,
  measure: (text: string, em: number) => number,
  opts: { maxW: number; em: number; floorEm: number; maxLines: number },
): { em: number; lines: string[]; width: number } | null;
/** Our own drawings of the 12 emoji of the set: each a list of [path in a 100-unit square, ASS colour]. */
export const DRAWN_EMOJI: Readonly<Record<string, readonly (readonly [string, string])[]>>;
/** The red arrow's size, in pixels of a 1080-wide frame. */
export const DRAWN_ARROW: Readonly<{ w: number; h: number; gap: number; border: number }>;
/** The share of its ring a chart card fills: its words' one number, 0 to 100, over 100; null for none, more, or past 100. */
export function chartShareOf(words: string): number | null;
/** The chart's ring filled to `share` as an ASS drawing, a wedge from the top clockwise; null for nothing to fill. */
export function ringWedgePath(share: number, cx: number, cy: number, r: number): string | null;

/** The burn's font: its family name, the words' width in pixels at `em` pixels a em, and the ASS size for that em. */
export interface DrawnFont {
  name: string;
  measure(text: string, em: number): number;
  fs(em: number): number;
}
/** A drawn item's size, and its groups of parts, each coming in on its own frame. */
export interface DrawnLayout {
  w: number;
  h: number;
  /** A sticker: its cut-out's file, laid as a picture under the burned words. */
  picture?: string;
  groups: { from: number; cx: number; cy: number; parts: Record<string, unknown>[] }[];
  /** Its arrow was drawn (plan 3.6). */
  arrow?: true;
}
export function drawnLayoutOf(laid: Omit<CutawayDrawnLaid, "place" | "n" | "key" | "template" | "family" | "track">, font: DrawnFont, W?: number, H?: number, opts?: { small?: boolean }): DrawnLayout | { code: string };
export function drawnStyle(font: DrawnFont, H?: number): string;
/** A laid drawn item's events, its times frames of the finished film written as they are. */
export function drawnEvents(laid: { out: number; place: { box: readonly number[] }; layout: DrawnLayout }, font: DrawnFont, fps?: number): string[];
