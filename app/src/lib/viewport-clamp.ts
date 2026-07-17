// Mobile-first viewport clamp (web only).
//
// This MUST run before any other app module evaluates. Many screens
// snapshot `Dimensions.get('window').width` at module load (splash,
// region/language pickers, players, reels, home). On a desktop browser
// that's ~1900px, so they size themselves desktop-huge and overflow the
// phone column. Clamping the reported width here, installed from the
// custom entry (index.js) before expo-router/entry, means every
// consumer, including those module-level snapshots and the
// useWindowDimensions() hook, sees a phone-width viewport.
//
// Kept dependency-free on purpose so it is safe to load first.

import { Platform, Dimensions } from 'react-native';

export const PWA_MAX_WIDTH = 480;

let installed = false;

export function installViewportClamp(): void {
  if (installed) return;
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  installed = true;

  const origGet = Dimensions.get.bind(Dimensions);
  Dimensions.get = ((dim: 'window' | 'screen') => {
    const r = origGet(dim);
    if (r && typeof r.width === 'number' && r.width > PWA_MAX_WIDTH) {
      return { ...r, width: PWA_MAX_WIDTH };
    }
    return r;
  }) as typeof Dimensions.get;
}

// Install on import so a bare `import './viewport-clamp'` is enough.
installViewportClamp();
