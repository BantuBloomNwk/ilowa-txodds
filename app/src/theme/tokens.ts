/**
 * Ilowa Design Tokens, Impeccable Design Framework
 * Strict 4pt spatial grid. Premium vertical rhythm.
 * Glass morphism + brand colors untouched.
 */

// ── Spatial Grid (4pt base) ────────────────────────────────────────
export const SP = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24,
  7: 28, 8: 32, 9: 36, 10: 40, 12: 48, 16: 64,
} as const;

// ── Border Radius ──────────────────────────────────────────────────
export const RAD = {
  xs: 6, sm: 8, md: 12, lg: 16, xl: 20, pill: 999,
} as const;

// ── Hit Targets (minimum 44dp) ─────────────────────────────────────
export const HIT = {
  min: 44, comfortable: 48, large: 56,
} as const;

// ── Semantic State Colors ───────────────────────────────────────────
export const STATE = {
  success:     { bg: 'rgba(16,185,129,0.08)', text: '#10B981', border: 'rgba(16,185,129,0.20)' },
  pending:     { bg: 'rgba(245,158,11,0.08)',  text: '#F59E0B', border: 'rgba(245,158,11,0.20)' },
  error:       { bg: 'rgba(239,68,68,0.08)',   text: '#EF4444', border: 'rgba(239,68,68,0.20)' },
  info:        { bg: 'rgba(0,217,255,0.06)',   text: '#00D9FF', border: 'rgba(0,217,255,0.15)' },
  gold:        { bg: 'rgba(255,215,0,0.08)',   text: '#FFD700', border: 'rgba(255,215,0,0.20)' },
  purple:      { bg: 'rgba(139,92,246,0.08)',  text: '#8B5CF6', border: 'rgba(139,92,246,0.15)' },
} as const;

// ── Typography Scale ───────────────────────────────────────────────
export const TYPE = {
  display:  { fontFamily: 'Sora', fontSize: 36, fontWeight: '700', letterSpacing: -1,   lineHeight: 44 },
  h1:       { fontFamily: 'Sora', fontSize: 24, fontWeight: '600', letterSpacing: -0.5, lineHeight: 32 },
  h2:       { fontFamily: 'Sora', fontSize: 20, fontWeight: '600', letterSpacing: -0.25, lineHeight: 28 },
  h3:       { fontFamily: 'Sora', fontSize: 16, fontWeight: '600', letterSpacing: 0,    lineHeight: 24 },
  body:     { fontFamily: 'Inter', fontSize: 15, fontWeight: '400', letterSpacing: 0,    lineHeight: 22 },
  bodySm:   { fontFamily: 'Inter', fontSize: 13, fontWeight: '400', letterSpacing: 0,    lineHeight: 19 },
  caption:  { fontFamily: 'Inter', fontSize: 11, fontWeight: '500', letterSpacing: 0.3,  lineHeight: 16 },
  overline: { fontFamily: 'Sora', fontSize: 11, fontWeight: '600', letterSpacing: 0.8,  lineHeight: 16 },
  mono:     { fontFamily: 'monospace', fontSize: 12, fontWeight: '400', letterSpacing: 0, lineHeight: 16 },
} as const;

// ── Glass Morphism Presets ──────────────────────────────────────────
export const GLASS = {
  card:     { backgroundColor: 'rgba(26,31,46,0.85)', borderRadius: RAD.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  elevated: { backgroundColor: 'rgba(26,31,46,0.95)', borderRadius: RAD.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  subtle:   { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: RAD.sm, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
} as const;

// ── Shadow / Glow ──────────────────────────────────────────────────
export const GLOW = {
  gold:   { shadowColor: '#FFD700', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8 },
  purple: { shadowColor: '#8B5CF6', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 6 },
  cyan:   { shadowColor: '#00D9FF', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
} as const;

// ── Luxury Glass Colors (gradient stops for bars/badges) ───────────
export const LUX = {
  gold:   { grad: ['#FFE866','#FFD700','#CC9F00'], border: 'rgba(255,215,0,0.35)', glow: 'rgba(255,215,0,0.15)' },
  purple: { grad: ['#B794F6','#8B5CF6','#6D28D9'], border: 'rgba(139,92,246,0.30)', glow: 'rgba(139,92,246,0.12)' },
  green:  { grad: ['#6EE7B7','#10B981','#047857'], border: 'rgba(16,185,129,0.30)', glow: 'rgba(16,185,129,0.12)' },
  red:    { grad: ['#FCA5A5','#EF4444','#B91C1C'], border: 'rgba(239,68,68,0.30)', glow: 'rgba(239,68,68,0.12)' },
  cyan:   { grad: ['#67E8F9','#00D9FF','#0891B2'], border: 'rgba(0,217,255,0.30)', glow: 'rgba(0,217,255,0.12)' },
} as const;
