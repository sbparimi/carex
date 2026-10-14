/** Tenant theming with a contrast guardrail: a brand colour that fails WCAG AA against white text is darkened until it passes (PRD §9). */
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
export function safeBrand(hex: string): string {
  let c = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#0b5fff";
  for (let i = 0; i < 40 && contrast(c, "#ffffff") < 4.5; i++) c = "#" + [1, 3, 5].map((k) => Math.max(0, Math.round(parseInt(c.slice(k, k + 2), 16) * 0.92)).toString(16).padStart(2, "0")).join("");
  return c;
}
