// Magic-byte sniffing for brand-identity image uploads (DEV-2). The upload
// path trusts file CONTENT, never the extension — a text file renamed .png
// must be rejected before any bytes leave the machine.

/** Per-file size cap for brand images (route + CLI agree on this). */
export const BRAND_IMAGE_MAX_BYTES = 15 * 1024 * 1024;

export interface SniffedImageType {
  ext: "png" | "jpg" | "webp";
  mime: "image/png" | "image/jpeg" | "image/webp";
}

/**
 * Identify png / jpeg / webp from leading magic bytes. Returns null for
 * anything else — the accepted set matches what the image pipelines consume.
 */
export function sniffImageType(buf: Uint8Array): SniffedImageType | null {
  if (buf.length >= 8) {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (png.every((b, i) => buf[i] === b)) {
      return { ext: "png", mime: "image/png" };
    }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // "WEBP"
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

export interface SniffedBrollType {
  media: "video" | "image";
  mime: "video/mp4" | "video/quicktime" | "video/webm" | SniffedImageType["mime"];
}

/** Per-file size caps for B-roll kit uploads (#3918), matching the server's. */
export const BROLL_KIT_MAX_BYTES = { video: 200 * 1024 * 1024, image: BRAND_IMAGE_MAX_BYTES } as const;

/**
 * Identify a B-roll kit file (#3918) from its leading bytes: mp4 / mov
 * (an ISO "ftyp" box, "qt  " brand for QuickTime), webm (an EBML header
 * whose doctype is webm), or one of the brand-image types.
 */
export function sniffBrollType(buf: Uint8Array): SniffedBrollType | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length >= 12 && ascii(4, 8) === "ftyp") {
    return { media: "video", mime: ascii(8, 12) === "qt  " ? "video/quicktime" : "video/mp4" };
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return ascii(0, Math.min(buf.length, 64)).includes("webm") ? { media: "video", mime: "video/webm" } : null;
  }
  const image = sniffImageType(buf);
  return image ? { media: "image", mime: image.mime } : null;
}
