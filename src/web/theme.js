import { bindFn, t } from './i18n.js';

/** Thème clair/sombre : préférence dans localStorage, sombre par défaut ; tout passe par des variables CSS (bascule instantanée). */
export const THEMES = ['dark', 'light'];
export const DEFAULT_THEME = 'dark';

export function storedTheme() {
  try {
    const v = localStorage.getItem('coach.theme');
    return THEMES.includes(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export const otherTheme = (theme) => (theme === 'dark' ? 'light' : 'dark');

export function applyTheme(theme, { persist = false } = {}) {
  const th = THEMES.includes(theme) ? theme : DEFAULT_THEME;
  document.documentElement.dataset.theme = th;
  if (persist) { try { localStorage.setItem('coach.theme', th); } catch { /* stockage indisponible */ } }
  return th;
}

/** Bouton en haut à droite (toutes les vues). */
export function mountThemeToggle(parent = document.body) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle';
  const paint = () => {
    const th = document.documentElement.dataset.theme ?? DEFAULT_THEME;
    btn.textContent = th === 'dark' ? '☀️' : '🌙'; // l'icône montre le thème vers lequel on bascule
    btn.title = t(th === 'dark' ? 'theme.toLight' : 'theme.toDark');
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(th === 'light'));
  };
  btn.onclick = () => { applyTheme(otherTheme(document.documentElement.dataset.theme ?? DEFAULT_THEME), { persist: true }); paint(); };
  bindFn(btn, paint); // le libellé suit aussi la langue
  parent.append(btn);
  return btn;
}
