export default {
  plugins: {
    // Tailwind 4 ships its own PostCSS plugin. The v3 `tailwindcss` +
    // `autoprefixer` pair no longer exists — Tailwind 4 handles vendor
    // prefixing internally.
    '@tailwindcss/postcss': {},
  },
}
