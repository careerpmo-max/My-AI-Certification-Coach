import { setLang, storedLang } from './i18n.js';
import { applyTheme, mountThemeToggle, storedTheme } from './theme.js';
import { api, el } from './ui.js';

const root = document.getElementById('app');

/** Routeur minimal : chaque vue exporte render(root, params, go). */
const VIEWS = {
  onboarding: () => import('./views/onboarding.js'),
  home: () => import('./views/home.js'),
  form: () => import('./views/form.js'),
  create: () => import('./views/create.js'),
  workspace: () => import('./views/workspace.js'),
};

export async function go(view, params = {}) {
  root.className = `view-${view}`;
  const mod = await VIEWS[view]();
  root.replaceChildren();
  await mod.render(root, params, go);
}

(async () => {
  applyTheme(storedTheme());
  setLang(storedLang());
  mountThemeToggle();
  try {
    const state = await api('/api/state');
    await go(state.onboarded ? 'home' : 'onboarding', { state });
  } catch (e) {
    root.replaceChildren(el('div', { class: 'boot-error' }, `Erreur : ${e.message}`));
  }
})();
