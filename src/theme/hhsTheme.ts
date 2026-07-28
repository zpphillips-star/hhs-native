import { Platform } from 'react-native';

export const HHS_COLORS = {
  background: '#191726',
  card: '#201d30',
  cardAlt: '#28233a',
  text: '#d9d8d2',
  muted: '#a69d8d',
  gold: '#d97c2b',
  goldLight: '#e8953a',
  goldDark: '#9f561c',
  danger: '#e57373',
  border: 'rgba(217, 124, 43, 0.18)',
  borderStrong: 'rgba(217, 124, 43, 0.45)',
  goldDim: 'rgba(217, 124, 43, 0.12)',
} as const;

// Web uses Google Font "Modern Antiqua" with Georgia/serif fallbacks.
// The native repo does not currently bundle ModernAntiqua-Regular.ttf, so use
// the closest platform serif stack without adding a new font-loading path.
export const HHS_FONT_FAMILY = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

export const HHS_TYPOGRAPHY = {
  body: {
    fontFamily: HHS_FONT_FAMILY,
  },
  display: {
    fontFamily: HHS_FONT_FAMILY,
    letterSpacing: 0.6,
  },
  kicker: {
    fontFamily: HHS_FONT_FAMILY,
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
  },
  button: {
    fontFamily: HHS_FONT_FAMILY,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
} as const;

export const HHS_STYLES = {
  cardRadius: 16,
  buttonRadius: 12,
  pillRadius: 999,
} as const;
