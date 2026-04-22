/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Newsreader"', 'Georgia', 'serif'],
        sans: ['"Manrope"', 'system-ui', 'sans-serif'],
      },
      colors: {
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          dim: 'rgb(var(--surface-dim) / <alpha-value>)',
          bright: 'rgb(var(--surface-bright) / <alpha-value>)',
          lowest: 'rgb(var(--surface-container-lowest) / <alpha-value>)',
          low: 'rgb(var(--surface-container-low) / <alpha-value>)',
          container: 'rgb(var(--surface-container) / <alpha-value>)',
          high: 'rgb(var(--surface-container-high) / <alpha-value>)',
          highest: 'rgb(var(--surface-container-highest) / <alpha-value>)',
          variant: 'rgb(var(--surface-variant) / <alpha-value>)',
          inverse: 'rgb(var(--inverse-surface) / <alpha-value>)',
        },
        'on-surface': {
          DEFAULT: 'rgb(var(--on-surface) / <alpha-value>)',
          variant: 'rgb(var(--on-surface-variant) / <alpha-value>)',
          inverse: 'rgb(var(--inverse-on-surface) / <alpha-value>)',
        },
        outline: {
          DEFAULT: 'rgb(var(--outline) / <alpha-value>)',
          variant: 'rgb(var(--outline-variant) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          on: 'rgb(var(--on-primary) / <alpha-value>)',
          container: 'rgb(var(--primary-container) / <alpha-value>)',
          'on-container': 'rgb(var(--on-primary-container) / <alpha-value>)',
          inverse: 'rgb(var(--inverse-primary) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--secondary) / <alpha-value>)',
          on: 'rgb(var(--on-secondary) / <alpha-value>)',
          container: 'rgb(var(--secondary-container) / <alpha-value>)',
          'on-container': 'rgb(var(--on-secondary-container) / <alpha-value>)',
        },
        tertiary: {
          DEFAULT: 'rgb(var(--tertiary) / <alpha-value>)',
          on: 'rgb(var(--on-tertiary) / <alpha-value>)',
          container: 'rgb(var(--tertiary-container) / <alpha-value>)',
          'on-container': 'rgb(var(--on-tertiary-container) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--error) / <alpha-value>)',
          on: 'rgb(var(--on-error) / <alpha-value>)',
          container: 'rgb(var(--error-container) / <alpha-value>)',
          'on-container': 'rgb(var(--on-error-container) / <alpha-value>)',
        },
      },
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.5rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.5rem',
      },
      spacing: {
        base: '8px',
        gutter: '24px',
        margin: '32px',
      },
      fontSize: {
        'display-lg': ['48px', { lineHeight: '1.1', fontWeight: '600' }],
        'headline-lg': ['32px', { lineHeight: '1.2', fontWeight: '500' }],
        'headline-md': ['24px', { lineHeight: '1.3', fontWeight: '500' }],
        'body-lg': ['18px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-md': ['16px', { lineHeight: '1.5', fontWeight: '400' }],
        'label-md': ['14px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '0.02em' }],
        'label-sm': ['12px', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '0.05em' }],
      },
      boxShadow: {
        ambient: '0 8px 24px -8px rgb(97 93 62 / 0.10), 0 2px 6px -2px rgb(97 93 62 / 0.06)',
        'ambient-lg': '0 16px 40px -12px rgb(97 93 62 / 0.14), 0 4px 10px -4px rgb(97 93 62 / 0.08)',
      },
      transitionTimingFunction: {
        soft: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
