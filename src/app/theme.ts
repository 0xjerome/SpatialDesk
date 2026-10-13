export type ThemePreference = 'system' | 'dark' | 'light';
const KEY = 'spatialdesk.theme';

export function getTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(pref: ThemePreference): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable */
  }
  applyTheme(pref);
}

export function applyTheme(pref: ThemePreference = getTheme()): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}
