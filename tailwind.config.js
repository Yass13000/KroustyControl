import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#ff751f',
          50: '#fff5ee',
          100: '#ffe8d7',
          200: '#ffcfae',
          600: '#ec600c',
          700: '#cf4f05',
          800: '#b74b1b',
          900: '#912d00',
          logo: '#f97933',
        },
        cream: '#faf6f0',
        sand: '#f2ede4',
        line: '#e3dad0',
        muted: '#7c6258',
        ink: '#4a2516',
        online: '#22b455',
      },
      fontFamily: {
        sans: ['Outfit', 'HelveticaCustom', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(74,37,22,0.04), 0 8px 24px -12px rgba(183,75,27,0.18)',
        lift: '0 2px 4px rgba(74,37,22,0.05), 0 18px 40px -16px rgba(183,75,27,0.30)',
        brand: '0 10px 24px -10px rgba(255,117,31,0.75)',
      },
      spacing: {
        4.5: '1.125rem',
        safe: 'env(safe-area-inset-bottom)',
      },
    },
  },
  plugins: [animate],
};
