/**
 * Cultural Patterns for Regional Toggles
 * 
 * Each region has distinctive traditional patterns that give the UI
 * a premium cultural feel:
 * - West Africa: Kente cloth patterns
 * - East Africa: Kikoi/Kanga patterns
 * - Southern Africa: Ndebele geometric patterns
 * - South Asia: Paisley/Mandala patterns
 * - Southeast Asia: Batik patterns
 * - MENA: Islamic geometric patterns
 * - Latin America: Aztec/Mayan patterns
 * - Caribbean: Carnival patterns
 * - Pacific: Tapa cloth patterns
 */

import { ILOWA_COLORS } from './colors';

export interface CulturalPattern {
  id: string;
  name: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  // SVG path data for pattern elements
  patternElements: string[];
  // Gradient stops for premium glass effect
  glassGradient: string[];
  // Pattern opacity for toggle background
  patternOpacity: number;
}

export const CULTURAL_PATTERNS: Record<string, CulturalPattern> = {
  'west-africa': {
    id: 'west-africa',
    name: 'Kente',
    description: 'Traditional Ghanaian Kente cloth weave pattern',
    primaryColor: '#FFD700', // Gold
    secondaryColor: '#228B22', // Forest Green
    accentColor: '#FF4500', // Orange Red
    patternElements: [
      // Horizontal stripes
      'M0,2 L20,2 M0,6 L20,6 M0,10 L20,10',
      // Vertical stripes
      'M2,0 L2,12 M6,0 L6,12 M10,0 L10,12',
      // Interlocking squares
      'M0,0 L4,0 L4,4 L0,4 Z M8,4 L12,4 L12,8 L8,8 Z',
    ],
    glassGradient: ['rgba(255, 215, 0, 0.15)', 'rgba(34, 139, 34, 0.08)', 'rgba(255, 215, 0, 0.05)'],
    patternOpacity: 0.3,
  },
  'east-africa': {
    id: 'east-africa',
    name: 'Kikoi',
    description: 'East African Kikoi/Kanga striped pattern',
    primaryColor: '#E74C3C', // Red
    secondaryColor: '#3498DB', // Blue
    accentColor: '#F1C40F', // Yellow
    patternElements: [
      // Bold horizontal stripes
      'M0,0 L24,0 L24,3 L0,3 Z',
      'M0,5 L24,5 L24,6 L0,6 Z',
      'M0,9 L24,9 L24,12 L0,12 Z',
    ],
    glassGradient: ['rgba(231, 76, 60, 0.15)', 'rgba(52, 152, 219, 0.08)', 'rgba(241, 196, 15, 0.05)'],
    patternOpacity: 0.25,
  },
  'southern-africa': {
    id: 'southern-africa',
    name: 'Ndebele',
    description: 'South African Ndebele geometric pattern',
    primaryColor: '#2ECC71', // Emerald
    secondaryColor: '#E74C3C', // Red
    accentColor: '#3498DB', // Blue
    patternElements: [
      // Triangles
      'M0,12 L6,0 L12,12 Z',
      // Nested rectangles
      'M2,2 L10,2 L10,10 L2,10 Z M4,4 L8,4 L8,8 L4,8 Z',
      // Zigzag
      'M0,6 L3,0 L6,6 L9,0 L12,6',
    ],
    glassGradient: ['rgba(46, 204, 113, 0.15)', 'rgba(231, 76, 60, 0.08)', 'rgba(52, 152, 219, 0.05)'],
    patternOpacity: 0.28,
  },
  'south-asia': {
    id: 'south-asia',
    name: 'Paisley',
    description: 'Traditional Indian Paisley/Buta pattern',
    primaryColor: '#9B59B6', // Purple
    secondaryColor: '#E74C3C', // Red
    accentColor: '#F39C12', // Orange
    patternElements: [
      // Paisley teardrop shape
      'M6,0 Q12,3 12,9 Q12,12 6,12 Q0,9 3,6 Q6,3 6,0',
      // Inner detail
      'M6,2 Q9,4 9,7 Q9,9 6,10 Q3,8 4,6 Q5,4 6,2',
      // Dots
      'M3,3 L4,3 L4,4 L3,4 Z M8,8 L9,8 L9,9 L8,9 Z',
    ],
    glassGradient: ['rgba(155, 89, 182, 0.15)', 'rgba(231, 76, 60, 0.08)', 'rgba(243, 156, 18, 0.05)'],
    patternOpacity: 0.25,
  },
  'southeast-asia': {
    id: 'southeast-asia',
    name: 'Batik',
    description: 'Indonesian Batik wax-resist pattern',
    primaryColor: '#8B4513', // Saddle Brown
    secondaryColor: '#DAA520', // Goldenrod
    accentColor: '#2F4F4F', // Dark Slate
    patternElements: [
      // Parang diagonal waves
      'M0,12 Q4,8 8,12 Q12,8 16,12',
      // Kawung ovals
      'M6,6 Q8,4 10,6 Q8,8 6,6',
      // Floral center
      'M6,6 L7,4 L8,6 L10,7 L8,8 L7,10 L6,8 L4,7 Z',
    ],
    glassGradient: ['rgba(139, 69, 19, 0.15)', 'rgba(218, 165, 32, 0.10)', 'rgba(47, 79, 79, 0.05)'],
    patternOpacity: 0.22,
  },
  'mena': {
    id: 'mena',
    name: 'Arabesque',
    description: 'Islamic geometric arabesque pattern',
    primaryColor: '#1ABC9C', // Turquoise
    secondaryColor: '#F39C12', // Gold
    accentColor: '#2C3E50', // Dark Blue
    patternElements: [
      // 8-pointed star
      'M6,0 L8,4 L12,4 L9,7 L10,12 L6,9 L2,12 L3,7 L0,4 L4,4 Z',
      // Interlocking circles
      'M6,6 m-4,0 a4,4 0 1,0 8,0 a4,4 0 1,0 -8,0',
      // Diamond grid
      'M0,6 L6,0 L12,6 L6,12 Z',
    ],
    glassGradient: ['rgba(26, 188, 156, 0.15)', 'rgba(243, 156, 18, 0.10)', 'rgba(44, 62, 80, 0.05)'],
    patternOpacity: 0.25,
  },
  'latin-america': {
    id: 'latin-america',
    name: 'Aztec',
    description: 'Pre-Columbian Aztec/Mayan geometric pattern',
    primaryColor: '#E74C3C', // Terracotta
    secondaryColor: '#27AE60', // Jade
    accentColor: '#F39C12', // Gold
    patternElements: [
      // Step pyramid
      'M0,12 L2,12 L2,10 L4,10 L4,8 L6,8 L6,6 L8,6 L8,8 L10,8 L10,10 L12,10 L12,12',
      // Sun symbol
      'M6,6 L8,4 L6,2 L4,4 Z',
      // Serpent wave
      'M0,6 Q3,3 6,6 Q9,9 12,6',
    ],
    glassGradient: ['rgba(231, 76, 60, 0.15)', 'rgba(39, 174, 96, 0.08)', 'rgba(243, 156, 18, 0.05)'],
    patternOpacity: 0.28,
  },
  'caribbean': {
    id: 'caribbean',
    name: 'Carnival',
    description: 'Caribbean carnival feather and jewel pattern',
    primaryColor: '#9B59B6', // Purple
    secondaryColor: '#E91E63', // Pink
    accentColor: '#00BCD4', // Cyan
    patternElements: [
      // Feather curves
      'M0,12 Q6,6 0,0 M2,12 Q8,6 2,0 M4,12 Q10,6 4,0',
      // Jewel diamonds
      'M6,3 L9,6 L6,9 L3,6 Z',
      // Stars
      'M6,6 L7,4 L8,6 L10,6 L8,8 L9,10 L6,8 L3,10 L4,8 L2,6 L4,6 L5,4 Z',
    ],
    glassGradient: ['rgba(155, 89, 182, 0.15)', 'rgba(233, 30, 99, 0.10)', 'rgba(0, 188, 212, 0.05)'],
    patternOpacity: 0.25,
  },
  'pacific': {
    id: 'pacific',
    name: 'Tapa',
    description: 'Polynesian Tapa bark cloth pattern',
    primaryColor: '#8B4513', // Brown
    secondaryColor: '#2C3E50', // Dark
    accentColor: '#E74C3C', // Red
    patternElements: [
      // Cross-hatch
      'M0,0 L12,12 M12,0 L0,12 M6,0 L6,12 M0,6 L12,6',
      // Turtle shell
      'M3,3 L9,3 L9,9 L3,9 Z M4,4 L8,4 M4,6 L8,6 M4,8 L8,8',
      // Wave pattern
      'M0,6 Q3,3 6,6 T12,6',
    ],
    glassGradient: ['rgba(139, 69, 19, 0.15)', 'rgba(44, 62, 80, 0.08)', 'rgba(231, 76, 60, 0.05)'],
    patternOpacity: 0.22,
  },
};

// Get pattern for a region key
export function getCulturalPattern(regionKey: string): CulturalPattern {
  return CULTURAL_PATTERNS[regionKey] || CULTURAL_PATTERNS['west-africa'];
}

// Generate SVG pattern string for use in components
export function getPatternSVG(pattern: CulturalPattern, size: number = 24): string {
  const elements = pattern.patternElements.join(' ');
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 12 12">
      <path d="${elements}" fill="${pattern.primaryColor}" fill-opacity="${pattern.patternOpacity}" />
    </svg>
  `;
}
