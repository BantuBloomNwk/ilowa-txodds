import React, { memo } from 'react';
import { View, Text, StyleSheet, Image, Platform } from 'react-native';
import { ILOWA_COLORS } from '../theme/colors';
import { Elder } from '../types/elder';

interface ElderAvatarProps {
  elder: Elder;
  size: number;
  showGlow?: boolean;
  showName?: boolean;
}

// Extract a URL from whatever Expo's require() returns on each platform.
// On web Expo emits { uri: '/assets/assets/.../foo.HASH.webp', width, height };
// on native it's an opaque number registered with AssetRegistry.
function getUri(source: unknown): string | null {
  if (!source) return null;
  if (typeof source === 'string') return source;
  if (typeof source === 'object' && source !== null && 'uri' in source) {
    const u = (source as { uri?: unknown }).uri;
    if (typeof u === 'string') return u;
  }
  return null;
}

function ElderAvatarComponent({ elder, size, showGlow = false, showName = false }: ElderAvatarProps) {
  const colors = ILOWA_COLORS.elders[elder.region];
  const initials = elder.name
    .split(' ')
    .map((w) => w[0])
    .join('');

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {showGlow && (
        <View
          style={[
            styles.glow,
            {
              width: size + 12,
              height: size + 12,
              borderRadius: (size + 12) / 2,
              backgroundColor: colors.glow,
              shadowColor: colors.primary,
            },
          ]}
        />
      )}
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: showGlow ? colors.primary : 'rgba(255,255,255,0.15)',
            backgroundColor: ILOWA_COLORS.cardDark,
          },
        ]}
      >
        {elder.avatar ? (
          Platform.OS === 'web' ? (
            // Native <img> on web, RN-Web's <Image> does not paint
            // reliably inside the circular overflow:hidden ring on mobile
            // Safari/Chrome (the avatar comes out blank). A plain <img>
            // with the same circular crop renders identically on every
            // browser. Same pattern as CachedImage / ArciumLogo /
            // MagicBlockLogo. The wrapping <View> still provides the
            // border + glow.
            React.createElement('img', {
              src: getUri(elder.avatar) ?? '',
              style: {
                width: size - 8,
                height: size - 8,
                borderRadius: (size - 8) / 2,
                objectFit: 'cover',
                display: 'block',
              },
              draggable: false,
              alt: elder.name,
            })
          ) : (
            <Image
              // require() returns a number (native) or an asset object (web).
              // Native path keeps RN Image as-is.
              source={(typeof elder.avatar === 'string' ? { uri: elder.avatar } : elder.avatar) as any}
              style={{ width: size - 8, height: size - 8, borderRadius: (size - 8) / 2 }}
              fadeDuration={0}
            />
          )
        ) : (
          <Text
            style={[
              styles.initials,
              { fontSize: size * 0.3, color: colors.primary },
            ]}
          >
            {initials}
          </Text>
        )}
      </View>
      {showName && (
        <Text style={[styles.name, { color: colors.primary }]} numberOfLines={1}>
          {elder.name}
        </Text>
      )}
    </View>
  );
}

export const ElderAvatar = memo(ElderAvatarComponent, (prev, next) => (
  prev.elder.id === next.elder.id &&
  prev.elder.avatar === next.elder.avatar &&
  prev.size === next.size &&
  prev.showGlow === next.showGlow &&
  prev.showName === next.showName
));

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    opacity: 0.4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: Platform.OS === 'android' ? 2 : 8,
  },
  avatar: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    fontFamily: 'Sora-Bold',
    letterSpacing: 1,
  },
  name: {
    fontFamily: 'Sora',
    fontSize: 10,
    marginTop: 4,
    textAlign: 'center',
  },
});
