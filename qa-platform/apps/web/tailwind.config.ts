import type { Config } from 'tailwindcss';

/** Blueprint palette — matches ARCHITECTURE.md design tokens. */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: '#F6F8FA',
        surface: '#FFFFFF',
        ink: '#0F1B2D',
        body: '#3D4A5C',
        muted: '#6B7787',
        line: '#E2E8F0',
        accent: { DEFAULT: '#0E6E8C', bright: '#14A0C4', wash: '#E6F2F6' },
        pass: '#1F9D57',
        warn: '#C77F0A',
        fail: '#D1483A',
        ai: '#6D5BD0',
      },
      fontFamily: {
        sans: ['Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;
