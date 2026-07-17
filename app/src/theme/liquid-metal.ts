/*
 * liquid-metal.ts, the "mercurial" treatment that turns any regional
 * primary into a molten-metal surface instead of a flat fill.
 *
 * One source of truth for: deriving a 3-stop liquid gradient from a
 * single hex (sheen → core → shadow), tint/alpha helpers, and the
 * contrast-safe glyph color for a filled regional surface (previously
 * duplicated in CreatorUpload / GoLive / CallInButton).
 */

import { ILOWA_COLORS } from './colors';

/**
 * Premium metallic gold + bronze bases for the PoR / Proven-Live surfaces.
 * Richer and less neon than the flat #FFD700 accent (which reads as bright
 * yellow). Feed these into liquidGradient() / chromeStops() / <LiquidSurface>
 * so badges, the Capture-Live UI and the condenser mic read as molten metal
 * rather than painted yellow. METAL_GOLD is the default; METAL_BRONZE is the
 * warmer companion tone (mic shadows, accents).
 */
export const METAL_GOLD = '#C9A24B';
export const METAL_BRONZE = '#B97A3D';

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length < 6) return { r: 255, g: 215, b: 0 }; // fall back to gold
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Mix a color toward white by amt (0..1). */
export function lighten(hex: string, amt: number): string {
  const { r, g, b } = parseHex(hex);
  return toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}

/** Mix a color toward black by amt (0..1). */
export function darken(hex: string, amt: number): string {
  const { r, g, b } = parseHex(hex);
  return toHex(r * (1 - amt), g * (1 - amt), b * (1 - amt));
}

/** rgba() string from a hex + alpha. */
export function alpha(hex: string, a: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Liquid-metal 3-stop gradient derived from any regional primary: a
 * bright sheen, the core pigment, and a deep shadow. Painted on a
 * diagonal it reads as molten/mercurial metal rather than a flat fill.
 * Works for the flat regional greens/navies as much as for gold, the
 * derived sheen + shadow give them the depth they lacked.
 */
export function liquidGradient(hex: string): [string, string, string] {
  return [lighten(hex, 0.42), hex, darken(hex, 0.42)];
}

/**
 * Polished-chrome reflection profile for any hue. Chrome reads as a
 * vertical reflection: bright sky at the top, a sharp dark "horizon"
 * band near the middle, then a lighter ground bounce at the bottom.
 * Two light bands around one dark band is what separates metal from
 * matte paint. Feed straight into a vertical LinearGradient.
 */
export function chromeStops(hex: string): {
  colors: [string, string, string, string, string, string];
  locations: [number, number, number, number, number, number];
} {
  return {
    colors: [
      lighten(hex, 0.62),
      lighten(hex, 0.18),
      darken(hex, 0.14),
      darken(hex, 0.52),
      darken(hex, 0.04),
      lighten(hex, 0.4),
    ],
    locations: [0, 0.22, 0.46, 0.54, 0.8, 1],
  };
}

/** Contrast-safe foreground for a flat-filled regional surface (bright
 *  gold → black glyph, dark navy/green → white glyph). */
export function contrastOn(hex: string): string {
  const { r, g, b } = parseHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6
    ? ILOWA_COLORS.deepBlack
    : '#FFFFFF';
}

/**
 * Contrast-safe foreground for a glyph CENTERED on a LiquidSurface. The
 * chrome reflection's dark "horizon" band sits dead-center (chromeStops
 * locations 0.46–0.54), so a glyph there must contrast against that band
 *, NOT the base accent. Using contrastOn(accent) makes a dark glyph for
 * bright accents (e.g. gold) that then disappears on the dark center.
 * Contrasting the darkened horizon resolves to a light glyph for almost
 * every saturated regional primary, so centered icons stay legible.
 */
export function contrastOnSurface(hex: string): string {
  return contrastOn(darken(hex, 0.33));
}
