/** Must stay identical to video/lib/templateExperienceBrief.ts; the CLI journey parity test guards drift. */
export function composeTemplateBrief({ product = "", audience = "", offer = "", mechanism = "", about = "" }: {
  product?: string;
  audience?: string;
  offer?: string;
  mechanism?: string;
  about?: string;
}): string {
  return [
    product.trim() ? `Product: ${product.trim()}` : "",
    audience.trim() ? `Audience: ${audience.trim()}` : "",
    offer.trim() ? `Offer: ${offer.trim()}` : "",
    mechanism.trim() ? `Mechanism: ${mechanism.trim()}` : "",
    about.trim(),
  ].filter(Boolean).join("\n\n");
}
