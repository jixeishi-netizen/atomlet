import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#1A1A19',
          700: '#3A3A38',
          500: '#6B6B67',
          300: '#A8A8A2',
          100: '#E6E4DC',
          50: '#F5F3EC',
        },
        brand: {
          600: '#4F46E5',
          500: '#6366F1',
          100: '#E0E7FF',
          50: '#EEF2FF',
        },
        ok: { 600: '#0F6E56', 50: '#E1F5EE' },
        warn: { 600: '#854F0B', 50: '#FAEEDA' },
        bad: { 600: '#A32D2D', 50: '#FCEBEB' },
      },
      borderRadius: { md: '8px', lg: '12px', xl: '16px' },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
