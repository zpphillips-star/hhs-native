export const HHS_COLORS = {
  background: '#191726',
  card: '#201d30',
  cardAlt: '#28233a',
  text: '#d9d8d2',
  muted: '#7a7468',
  gold: '#d97c2b',
  goldLight: '#e8953a',
  goldDark: '#9f561c',
  danger: '#e57373',
  border: 'rgba(217, 124, 43, 0.18)',
  borderStrong: 'rgba(217, 124, 43, 0.45)',
  goldDim: 'rgba(217, 124, 43, 0.12)',
} as const;

// Matches the authoritative web app's Google Font family.
// Loaded by NativeAppShell through @expo-google-fonts/modern-antiqua.
export const HHS_FONT_FAMILY = 'ModernAntiqua_400Regular';

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
