function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * The team color to paint as a tick. Navy and black primaries vanish on the
 * dark arena floor, and white or gold ones on fresh ice; fall back to the
 * secondary color when it stands out better.
 */
export function teamTickColor(
  primary: string,
  secondary: string | null | undefined,
  dark: boolean,
): string {
  const lp = luminance(primary);
  const ls = secondary ? luminance(secondary) : null;
  if (lp == null || ls == null) return primary;
  if (dark && lp < 0.05 && ls > lp) return secondary!;
  if (!dark && lp > 0.6 && ls < lp) return secondary!;
  return primary;
}
