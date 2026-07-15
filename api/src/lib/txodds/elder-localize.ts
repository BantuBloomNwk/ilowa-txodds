/**
 * Presents the Elder's shaped markets in the user's language. The FACTS (implied %, the immutable
 * predicate, the settlement proof) are language-independent and stay verifiable; only the prose is
 * translated. Numbers carry through translation, so a Hausa or Swahili speaker sees the same %
 * they could check on-chain. English is a passthrough, and any translator failure falls back to
 * English so the Elder always speaks.
 *
 * Translation is injected (dependency) so this stays pure + testable; the route wires it to
 * Ilowa's existing Aya / Lelapa layer.
 */
import type { ShapedMarket } from './elder';

export type TranslateFn = (texts: string[], targetLang: string) => Promise<string[]>;

const LOCALIZABLE = ['question', 'analysis', 'fit'] as const;

export async function localizeMarkets<T extends ShapedMarket>(markets: T[], lang: string, translate?: TranslateFn): Promise<T[]> {
  if (!lang || lang.toLowerCase().startsWith('en') || !translate || markets.length === 0) return markets;
  const texts: string[] = [];
  const slots: Array<[number, string]> = [];
  markets.forEach((m, i) => {
    for (const f of LOCALIZABLE) {
      const v = (m as any)[f];
      if (typeof v === 'string' && v) { slots.push([i, f]); texts.push(v); }
    }
  });
  if (texts.length === 0) return markets;
  try {
    const t = await translate(texts, lang);
    if (!Array.isArray(t) || t.length !== texts.length) return markets;
    const copy = markets.map((m) => ({ ...m }));
    slots.forEach(([i, f], k) => { (copy[i] as any)[f] = t[k] || texts[k]; });
    return copy as T[];
  } catch {
    return markets; // fall back to English; the number stays the same
  }
}
