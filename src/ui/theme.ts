import type { ThemeVariety } from '../store/storage';

export interface ThemeColors {
  name: string;
  description: string;
  bg: string;
  cardBg: string;
  cardBorder: string;
  headerBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentGold: string;
  accentPrimary: string;
  accentSecondary: string;
  accentSuccess: string;
  accentWarning: string;
  gridActive: string;
  gridInactive: string;
  badgeBg: string;
  fontMonospace: boolean;
}

export const THEMES: Record<ThemeVariety, ThemeColors> = {
  terminal: {
    name: 'Bloomberg Terminal',
    description: 'High-contrast Wall St terminal with obsidian black, amber & gold accents.',
    bg: '#0A0E17',
    cardBg: '#121824',
    cardBorder: '#2A3447',
    headerBg: '#070A10',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    accentGold: '#D4AF37',
    accentPrimary: '#F59E0B',
    accentSecondary: '#3B82F6',
    accentSuccess: '#10B981',
    accentWarning: '#EF4444',
    gridActive: '#F59E0B',
    gridInactive: '#1E293B',
    badgeBg: '#2A2008',
    fontMonospace: true,
  },
  executive: {
    name: 'Wall St Executive',
    description: 'Sleek luxury navy & sapphire suite for investment bankers & executives.',
    bg: '#0F172A',
    cardBg: '#1E293B',
    cardBorder: '#334155',
    headerBg: '#0B1120',
    textPrimary: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textMuted: '#64748B',
    accentGold: '#EAB308',
    accentPrimary: '#3B82F6',
    accentSecondary: '#6366F1',
    accentSuccess: '#10B981',
    accentWarning: '#F43F5E',
    gridActive: '#3B82F6',
    gridInactive: '#334155',
    badgeBg: '#1E3A8A',
    fontMonospace: false,
  },
  quant: {
    name: 'Quant Cyber Neon',
    description: 'Cyberpunk HFT trading desk with electric cyan, neon violet & audio spectrum glow.',
    bg: '#050811',
    cardBg: '#0D1322',
    cardBorder: '#1E2945',
    headerBg: '#03050B',
    textPrimary: '#FFFFFF',
    textSecondary: '#A5B4FC',
    textMuted: '#475569',
    accentGold: '#F59E0B',
    accentPrimary: '#00F2FE',
    accentSecondary: '#8B5CF6',
    accentSuccess: '#00FF9D',
    accentWarning: '#FF0055',
    gridActive: '#00F2FE',
    gridInactive: '#151D33',
    badgeBg: '#1E1B4B',
    fontMonospace: true,
  },
};

export function getTheme(variety: ThemeVariety = 'terminal'): ThemeColors {
  return THEMES[variety] || THEMES.terminal;
}
