// Dark-mode support: Tailwind is configured with darkMode: 'class'.
// This module owns the `dark` class on <html> and persists the choice.

export type Theme = 'light' | 'dark'
const KEY = 'opal-theme'

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(theme: Theme) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

/** Apply the stored theme before first paint (call once at app start). */
export function initTheme() {
  setTheme(getTheme())
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}
