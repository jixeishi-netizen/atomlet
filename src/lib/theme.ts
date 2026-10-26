import type { CSSProperties } from 'react';

/**
 * 三套主题 = 三组 CSS 变量值。
 *
 * 关键点：主题不是"给某个组件传 prop"，而是把变量写到 DOM 上（AppRenderer 的 style），
 * 组件只消费 var(--brand-600) 这类变量。这样 spec.app.theme 一改，整页配色立刻生效，
 * 组件代码不用知道当前是哪套主题（见缺陷 2）。
 */
export type ThemeName = 'neutral' | 'warm' | 'cool';

export type ThemePalette = {
  /** 主色：主按钮、页签选中态、链接 */
  brand600: string;
  /** 主色 hover */
  brand500: string;
  /** 主色浅底：chip 高亮、选中背景 */
  brand50: string;
  /** 应用画布底色 */
  canvas: string;
};

export const THEMES: Record<ThemeName, ThemePalette> = {
  neutral: {
    brand600: '#4F46E5',
    brand500: '#6366F1',
    brand50: '#EEF2FF',
    canvas: '#F5F3EC',
  },
  warm: {
    brand600: '#B4530A',
    brand500: '#D97706',
    brand50: '#FEF3E2',
    canvas: '#FAF6EF',
  },
  cool: {
    brand600: '#0E7490',
    brand500: '#0891B2',
    brand50: '#E0F2F7',
    canvas: '#F2F5F6',
  },
};

export const themeName: Record<ThemeName, string> = {
  neutral: '中性',
  warm: '暖色',
  cool: '冷色',
};

export function normalizeTheme(theme?: string | null): ThemeName {
  return theme === 'warm' || theme === 'cool' || theme === 'neutral' ? theme : 'neutral';
}

/** 返回可直接展开到 style 上的 CSS 变量，键名与 globals.css / Tailwind 任意值语法一致 */
export function themeStyle(theme?: string | null): CSSProperties {
  const palette = THEMES[normalizeTheme(theme)];
  return {
    '--brand-600': palette.brand600,
    '--brand-500': palette.brand500,
    '--brand-50': palette.brand50,
    '--canvas': palette.canvas,
  } as CSSProperties;
}
