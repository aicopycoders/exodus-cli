const part = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
export function faceBoxOf(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return null;
    const { top, bottom, left, right } = value;
    if (!part(top) || !part(bottom) || !part(left) || !part(right) || !(top < bottom) || !(left < right))
        return null;
    return { top, bottom, left, right };
}
