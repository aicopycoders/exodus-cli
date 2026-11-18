export interface FaceBox {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
}
export declare function faceBoxOf(value: unknown): FaceBox | null;
