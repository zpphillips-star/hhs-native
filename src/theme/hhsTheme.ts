import { Text, TextInput, type TextStyle } from 'react-native';

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

const HHS_NATIVE_TEXT_DEFAULTS: TextStyle = {
  fontFamily: HHS_FONT_FAMILY,
};

type BrandableTextComponent = {
  defaultProps?: {
    style?: TextStyle | TextStyle[];
    [key: string]: unknown;
  };
};

let hhsTypographyDefaultsRegistered = false;

function withBrandFont(style?: TextStyle | TextStyle[]) {
  if (!style) return HHS_NATIVE_TEXT_DEFAULTS;
  return Array.isArray(style) ? [HHS_NATIVE_TEXT_DEFAULTS, ...style] : [HHS_NATIVE_TEXT_DEFAULTS, style];
}

export function configureHhsNativeTypography() {
  if (hhsTypographyDefaultsRegistered) return;
  hhsTypographyDefaultsRegistered = true;

  const text = Text as unknown as BrandableTextComponent;
  text.defaultProps = text.defaultProps ?? {};
  text.defaultProps.style = withBrandFont(text.defaultProps.style);

  const textInput = TextInput as unknown as BrandableTextComponent;
  textInput.defaultProps = textInput.defaultProps ?? {};
  textInput.defaultProps.style = withBrandFont(textInput.defaultProps.style);
  textInput.defaultProps.placeholderTextColor = HHS_COLORS.muted;
}

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
