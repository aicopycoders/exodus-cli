// VENDORED mirror of video/lib/faceBox.ts FaceBox and faceBoxOf. The CLI package builds standalone (rootDir ".") and
// cannot import video/lib, so this is a copy; exodus/__tests__/face-box-vendored.test.ts keeps the two reading the same.

/**
 * COP-383: where a One-take take's face is, as parts of its frame: `top` and `bottom` of its height from its top edge,
 * `left` and `right` of its width from its left edge, each from 0 to 1. The pull copies it onto the take's scene in
 * the manifest, where the cut sets the take's captions clear of it.
 */
export interface FaceBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

const part = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** A face box as stored, or null for anything else: four parts of the frame, top above bottom and left of right. */
export function faceBoxOf(value: unknown): FaceBox | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { top, bottom, left, right } = value as Record<string, unknown>;
  if (!part(top) || !part(bottom) || !part(left) || !part(right) || !(top < bottom) || !(left < right)) return null;
  return { top, bottom, left, right };
}
