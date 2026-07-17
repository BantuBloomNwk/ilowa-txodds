export const ILOWA_COLORS = {
  // Core brand
  gold: '#FFD700',
  purple: '#8B5CF6',
  cyan: '#00D9FF',

  // Backgrounds
  deepBlack: '#000000',
  cosmicPurple: '#0A0518',
  cardDark: '#1A1F2E',

  // Functional
  truth: '#10B981',
  doubt: '#EF4444',
  wisdom: '#8B5CF6',
  voice: '#00D9FF',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.4)',

  // Elder-specific (rotate based on active region)
  elders: {
    westAfrica: {
      primary: '#FFD700',
      secondary: '#8B5CF6',
      glow: 'rgba(255, 215, 0, 0.6)',
    },
    eastAfrica: {
      primary: '#DC143C',
      secondary: '#1E90FF',
      glow: 'rgba(220, 20, 60, 0.6)',
    },
    southernAfrica: {
      primary: '#008000',
      secondary: '#000000',
      glow: 'rgba(0, 128, 0, 0.6)',
    },
    latinAmerica: {
      primary: '#8B4513',
      secondary: '#00CED1',
      glow: 'rgba(0, 206, 209, 0.6)',
    },
    southAsia: {
      primary: '#FF9933',
      secondary: '#138808',
      glow: 'rgba(255, 153, 51, 0.6)',
    },
    southeastAsia: {
      primary: '#0038A8',
      secondary: '#CE1126',
      glow: 'rgba(0, 56, 168, 0.6)',
    },
    mena: {
      primary: '#007A3D',
      secondary: '#FFD700',
      glow: 'rgba(0, 122, 61, 0.6)',
    },
    caribbean: {
      primary: '#B8860B',
      secondary: '#FF1493',
      glow: 'rgba(184, 134, 11, 0.6)',
    },
    pacific: {
      primary: '#002366',
      secondary: '#00CED1',
      glow: 'rgba(0, 206, 209, 0.6)',
    },
  },
} as const;

export type ElderRegionKey = keyof typeof ILOWA_COLORS.elders;
