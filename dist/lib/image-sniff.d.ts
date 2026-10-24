export declare const BRAND_IMAGE_MAX_BYTES: number;
export interface SniffedImageType {
    ext: "png" | "jpg" | "webp";
    mime: "image/png" | "image/jpeg" | "image/webp";
}
export declare function sniffImageType(buf: Uint8Array): SniffedImageType | null;
export interface SniffedBrollType {
    media: "video" | "image";
    mime: "video/mp4" | "video/quicktime" | "video/webm" | SniffedImageType["mime"];
}
export declare const BROLL_KIT_MAX_BYTES: {
    readonly video: number;
    readonly image: number;
};
export declare function sniffBrollType(buf: Uint8Array): SniffedBrollType | null;
