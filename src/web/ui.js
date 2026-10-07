import { getLang } from './i18n.js';

/** Petits utilitaires DOM partagés par les vues (aucune dépendance). */
export const el = (tag, props = {}, ...kids) => {
  const { class: cls, style, dataset, ...rest } = props;
  const n = Object.assign(document.createElement(tag), rest);
  if (cls) n.className = cls;
  if (style) n.style.cssText = style;
  if (dataset) Object.assign(n.dataset, dataset);
  n.append(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  return n;
};

export async function api(path, body) {
  // x-lang : le serveur traduit ses erreurs et messages dans la langue de l'interface
  const headers = { 'x-lang': getLang(), ...(body ? { 'content-type': 'application/json' } : {}) };
  const res = await fetch(path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Texte + URLs cliquables (pas d'innerHTML : le contenu du LLM reste du texte). */
export function richText(node, text) {
  node.replaceChildren();
  text.split(/(https?:\/\/[^\s)]+)/).forEach((part, i) => {
    if (i % 2) node.append(el('a', { href: part, target: '_blank', rel: 'noopener noreferrer', textContent: part }));
    else node.append(part);
  });
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/** Cercle de progression : gris = non commencé, arc coloré = en cours, vert plein coché = terminé. */
export function ring(pct, size = 18) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const root = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'ring', role: 'img', 'aria-label': `${p} %` });
  if (p >= 100) {
    root.append(svg('circle', { cx: 12, cy: 12, r: 11, fill: 'var(--green)' }), svg('path', { d: 'M7 12.5l3.2 3.2L17 8.8', fill: 'none', stroke: '#fff', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return root;
  }
  const r = 9;
  const c = 2 * Math.PI * r;
  root.append(svg('circle', { cx: 12, cy: 12, r, fill: 'none', stroke: 'var(--track)', 'stroke-width': 3.5 }));
  if (p > 0) root.append(svg('circle', { cx: 12, cy: 12, r, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-dasharray': `${(c * p) / 100} ${c}`, transform: 'rotate(-90 12 12)' }));
  return root;
}

/** Boîte de dialogue modale. Renvoie l'id de l'action choisie. */
export function dialog({ icon, title, text, actions }) {
  return new Promise((resolve) => {
    const dlg = el('dialog', { class: 'modal' });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      icon ? el('div', { class: 'modal-icon' }, icon) : null,
      el('h2', {}, title),
      text ? el('p', { class: 'muted' }, text) : null,
      el('div', { class: 'modal-actions' }, actions.map((a) => el('button', { class: a.class ?? '', textContent: a.label, onclick: () => close(a.id) }))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(actions[0].id); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/**
 * Modale de progression en deux phases : « en cours » (spinner, non fermable : Échap neutralisé) puis « prêt » (bouton).
 * start() -> { ready(title, label) : Promise résolue au clic sur le bouton, close() : fermeture sans attendre (erreur) }.
 */
export function progressDialog({ title, text }) {
  const dlg = el('dialog', { class: 'modal busy-modal', ariaLive: 'polite' });
  const heading = el('h2', {}, title);
  const hint = el('p', { class: 'muted' }, text ?? '');
  const slot = el('div', { class: 'modal-actions' });
  const spinner = el('div', { class: 'spinner', role: 'status' });
  dlg.append(el('div', { class: 'modal-icon' }, spinner), heading, hint, slot);
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Échap ne ferme jamais la modale
  document.body.append(dlg);
  dlg.showModal();
  const close = () => { if (dlg.open) dlg.close(); dlg.remove(); };
  return {
    close,
    ready: (readyTitle, label) => new Promise((resolve) => {
      spinner.replaceWith(el('span', { class: 'ready-icon', ariaHidden: 'true' }, '✅'));
      heading.textContent = readyTitle;
      hint.textContent = '';
      const btn = el('button', { class: 'primary big', textContent: label, onclick: () => { close(); resolve(); } });
      slot.replaceChildren(btn);
      btn.focus();
    }),
  };
}

export const successIcon = () => {
  const s = svg('svg', { viewBox: '0 0 64 64', width: 64, height: 64, 'aria-hidden': 'true' });
  s.append(svg('circle', { cx: 32, cy: 32, r: 30, fill: 'var(--green)' }), svg('path', { d: 'M18 33l9 9 19-20', fill: 'none', stroke: '#fff', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return s;
};
