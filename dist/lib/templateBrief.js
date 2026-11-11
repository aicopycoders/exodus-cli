export function composeTemplateBrief({ product = "", audience = "", offer = "", mechanism = "", about = "" }) {
    return [
        product.trim() ? `Product: ${product.trim()}` : "",
        audience.trim() ? `Audience: ${audience.trim()}` : "",
        offer.trim() ? `Offer: ${offer.trim()}` : "",
        mechanism.trim() ? `Mechanism: ${mechanism.trim()}` : "",
        about.trim(),
    ].filter(Boolean).join("\n\n");
}
