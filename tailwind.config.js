/**
 * Tailwind config — mirrors the inline config that used to live in
 * <script>tailwind.config = {...}</script> inside index.html.
 * Build:  npm run build   (outputs dist/tailwind.css, ~15 KB minified)
 * Watch:  npm run watch   (rebuilds on every index.html edit)
 */
module.exports = {
  content: ['./index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: '#6366f1',
        surface: { DEFAULT: '#0f172a', 2: '#1e293b', 3: '#334155' }
      },
      fontFamily: {
        sans: ['-apple-system','BlinkMacSystemFont','Segoe UI','Roboto','sans-serif'],
        mono: ['ui-monospace','SFMono-Regular','Menlo','monospace']
      }
    }
  },
  /* Safelist a few dynamically-built classes the JIT can't see in
     templates (e.g. interpolated into HTML strings via template literals). */
  safelist: [
    'bg-emerald-400', 'bg-amber-400', 'bg-rose-400', 'bg-slate-300',
    'text-emerald-600', 'text-amber-600', 'text-rose-600',
    'dark:text-emerald-400', 'dark:text-amber-400', 'dark:text-rose-400',
    'rotate-90'
  ]
};
