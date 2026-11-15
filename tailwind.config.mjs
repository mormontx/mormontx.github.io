/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F9F8F6',
        ink: '#1A1A1A',
        mute: '#6E6A63',
        hairline: '#E5E2DC',
        accent: '#A85D6B',
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
        serif: ['"Newsreader Variable"', 'Georgia', 'serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        meta: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.14em' }],
      },
    },
  },
  plugins: [],
};
