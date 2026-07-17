/*
 * RegionalCloth, the premium, minimalistic woven backdrop every AV
 * surface sits on (library, Upload, Go Live, the full player).
 *
 * Layers, back to front:
 *  1. region-tinted vertical gradient over the cosmic background
 *  2. coarse weave block + fine thread (the cultural pattern, two scales)
 *  3. a radial "lit from above" vignette, light at the top-centre,
 *     darker at the edges, so content pops and the cloth reads physical
 *  4. a faint diagonal light sweep for a hyper-real sheen
 *
 * Kept deliberately low-opacity so glass bars placed on top stay clean
 * (the bars themselves carry a near-opaque frosted base). Sits behind
 * everything, no interaction.
 *
 * react-native-svg + expo-linear-gradient only; no new libs.
 */

import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Defs,
  Path,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { ILOWA_COLORS, type ElderRegionKey } from '@/theme/colors';
import { getCulturalPattern } from '@/theme/cultural-patterns';

// camelCase region key (rest of the app) → hyphenated CULTURAL_PATTERNS slug.
const REGION_SLUG: Record<ElderRegionKey, string> = {
  westAfrica: 'west-africa',
  eastAfrica: 'east-africa',
  southernAfrica: 'southern-africa',
  latinAmerica: 'latin-america',
  southAsia: 'south-asia',
  southeastAsia: 'southeast-asia',
  mena: 'mena',
  caribbean: 'caribbean',
  pacific: 'pacific',
};

export function RegionalCloth({
  regionKey,
  primaryColor,
}: {
  regionKey: ElderRegionKey;
  primaryColor: string;
}) {
  const slug = REGION_SLUG[regionKey] ?? 'west-africa';
  const pattern = getCulturalPattern(slug);
  // Stable per-region ids so re-renders don't churn SVG defs.
  const coarseId = `cloth-c-${slug}`;
  const fineId = `cloth-f-${slug}`;
  const vignetteId = `cloth-v-${slug}`;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[`${primaryColor}1F`, ILOWA_COLORS.cosmicPurple, ILOWA_COLORS.deepBlack]}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Coarse weave block, larger tile, faint. */}
      <Svg width="100%" height="100%" style={[StyleSheet.absoluteFill, { opacity: 0.04 }]}>
        <Defs>
          <Pattern id={coarseId} x="0" y="0" width="56" height="56" patternUnits="userSpaceOnUse">
            {pattern.patternElements.map((d, i) => (
              <Path key={i} d={d} stroke={primaryColor} strokeWidth={1.4} fill="none" transform="scale(2.3)" />
            ))}
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${coarseId})`} />
      </Svg>

      {/* Fine thread, original tile, slightly stronger. */}
      <Svg width="100%" height="100%" style={[StyleSheet.absoluteFill, { opacity: 0.06 }]}>
        <Defs>
          <Pattern id={fineId} x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
            {pattern.patternElements.map((d, i) => (
              <Path key={i} d={d} stroke={primaryColor} strokeWidth={0.6} fill="none" />
            ))}
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${fineId})`} />
      </Svg>

      {/* Radial vignette, lit from the top-centre, edges sink to black. */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={vignetteId} cx="50%" cy="0%" r="120%">
            <Stop offset="0" stopColor={primaryColor} stopOpacity="0.10" />
            <Stop offset="0.45" stopColor={ILOWA_COLORS.deepBlack} stopOpacity="0" />
            <Stop offset="1" stopColor={ILOWA_COLORS.deepBlack} stopOpacity="0.4" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${vignetteId})`} />
      </Svg>

      {/* Diagonal light sweep, the hyper-real sheen across the cloth. */}
      <LinearGradient
        colors={['rgba(255,255,255,0.035)', 'transparent', 'transparent']}
        locations={[0, 0.4, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.85 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
