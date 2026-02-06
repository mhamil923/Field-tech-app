/**
 * First Class Glass CRM design system colors.
 * Matches the web CRM frontend palette.
 */

export const CRM = {
  primaryBlue: '#0d6efd',
  darkSlate: '#0f172a',
  pageBackground: '#f1f5f9',
  white: '#ffffff',
  lightBorder: '#e2e8f0',
  secondaryText: '#0f172a',
  dangerRed: '#dc2626',
  logoutRed: '#E63946',
  logoutRedHover: '#D62839',
  navInactive: '#2B2D42',
  navActiveBlue: '#0d6efd',
  cardBackground: '#ffffff',
  cardBorder: '#eef2f7',
  controlBorder: '#cbd5e1',
  lightCard: '#f8fafc',
};

// Keep the legacy Colors export so existing code doesn't break
const tintColorLight = CRM.primaryBlue;
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: CRM.darkSlate,
    background: CRM.pageBackground,
    tint: tintColorLight,
    icon: CRM.secondaryText,
    tabIconDefault: CRM.secondaryText,
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};
