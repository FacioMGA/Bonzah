/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./frontend/index.html",
        "./frontend/public/*.html",
        "./frontend/src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                brand: {
                    DEFAULT: 'rgb(var(--tenant-brand-primary-rgb, 51 65 85) / <alpha-value>)',
                    light: 'rgb(var(--tenant-brand-secondary-rgb, 100 116 139) / <alpha-value>)',
                    dark: 'rgb(var(--tenant-brand-dark-rgb, 38 49 64) / <alpha-value>)',
                    deep: 'rgb(var(--tenant-brand-deep-rgb, 18 23 30) / <alpha-value>)',
                    canvas: '#FCFBF7',
                    primary: {
                        DEFAULT: 'rgb(var(--tenant-brand-primary-rgb, 51 65 85) / <alpha-value>)',
                        dark: 'rgb(var(--tenant-brand-dark-rgb, 38 49 64) / <alpha-value>)',
                        50: '#EAF2FF'
                    },
                    secondary: 'rgb(var(--tenant-brand-secondary-rgb, 100 116 139) / <alpha-value>)',
                    accent: '#00B4D8'
                },
                gray: {
                    50: '#F9FAFB',
                    100: '#F3F4F6', // The "Nice Grey"
                    900: '#111827'
                },
                // Semantic tokens (prefer these in feature UI over raw palette values)
                // Values are sourced from CSS variables (see src/styles/*).
                ui: {
                    canvas: 'rgb(var(--ui-canvas, 252 251 247) / 1)',
                    surface: 'rgb(var(--ui-surface, 255 255 255) / 1)',
                    muted: 'rgb(var(--ui-muted, 243 244 246) / 1)',
                    text: 'rgb(var(--ui-text, 15 23 42) / 1)',
                    subtext: 'rgb(var(--ui-subtext, 71 85 105) / 1)',
                    border: 'rgb(var(--ui-border, 148 163 184) / var(--ui-border-alpha, 0.35))',
                    focus: 'rgb(var(--ui-focus, 0 74 138) / 1)',
                    danger: 'rgb(var(--ui-danger, 220 38 38) / 1)',
                    warning: 'rgb(var(--ui-warning, 217 119 6) / 1)',
                    success: 'rgb(var(--ui-success, 22 163 74) / 1)'
                },
                control: {
                    bg: 'rgb(var(--control-bg, 248 250 252) / var(--control-bg-alpha, 0.5))',
                    border: 'rgb(var(--control-border, 226 232 240) / var(--control-border-alpha, 0.6))',
                    text: 'rgb(var(--control-text, 51 65 85) / 1)',
                    placeholder: 'rgb(var(--control-placeholder, 148 163 184) / 1)',
                    disabledText: 'rgb(var(--control-disabled-text, 100 116 139) / 1)',
                    focusShadow: 'rgb(var(--ui-focus, 0 74 138) / var(--control-focus-shadow-alpha, 0.10))',
                },
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            // Sizing tokens (avoid arbitrary values like h-[52px])
            spacing: {
                controlXs: '2.625rem', // 42px
                control: '3.25rem', // 52px
                controlSm: '2.75rem', // 44px
                controlMd: '3.3125rem', // 53px
                controlLg: '3.53125rem', // 56.5px
                action: '2.875rem', // 46px
                col84: '5.25rem', // 84px
                col100: '6.25rem', // 100px
                col150: '9.375rem', // 150px
                col200: '12.5rem', // 200px
                col140: '8.75rem', // 140px
                col170: '10.625rem', // 170px
                col180: '11.25rem', // 180px
                col220: '13.75rem', // 220px
                col260: '16.25rem', // 260px
                contentNarrow: '35rem', // 560px
                tableWide: '61.25rem', // 980px
            },
            height: {
                controlXs: '2.625rem',
                control: '3.25rem',
                controlSm: '2.75rem',
                controlMd: '3.3125rem',
                controlLg: '3.53125rem',
                action: '2.875rem',
            },
            minHeight: {
                controlXs: '2.625rem',
                controlLg: '3.53125rem',
                workspace: '31.25rem', // 500px
                panelSm: '6.25rem', // 100px
                panel: '7.5rem', // 120px
            },
            maxHeight: {
                modal: '90vh',
                panel: '60vh',
            },
            borderRadius: {
                control: '0.875rem', // 14px
            },
            boxShadow: {
                'brand-glow': '0 0 0 4px rgba(0, 74, 138, 0.18)',
            },
            keyframes: {
                'brand-glow': {
                    '0%, 100%': { boxShadow: '0 0 0 0 rgba(0, 74, 138, 0.0)' },
                    '50%': { boxShadow: '0 0 0 4px rgba(0, 74, 138, 0.18)' },
                },
                // Mobile shell micro-animations
                'drawer-in': {
                    from: { transform: 'translateX(-100%)', opacity: '0.8' },
                    to:   { transform: 'translateX(0)', opacity: '1' },
                },
                'nav-item-in': {
                    from: { opacity: '0', transform: 'translateX(-12px)' },
                    to:   { opacity: '1', transform: 'translateX(0)' },
                },
                'backdrop-in': {
                    from: { opacity: '0' },
                    to:   { opacity: '1' },
                },
                'card-appear': {
                    from: { opacity: '0', transform: 'translateY(8px)' },
                    to:   { opacity: '1', transform: 'translateY(0)' },
                },
            },
            animation: {
                'brand-glow': 'brand-glow 900ms ease-out',
            },
        }
    },
    plugins: [],
}
