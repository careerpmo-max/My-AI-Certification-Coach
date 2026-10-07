import { LANGS, bindT, getLang, setLang, t } from '../i18n.js';
import { PERSONA_SPEECH, speakSample } from '../speech.js';
import { el } from '../ui.js';

const NS = 'http://www.w3.org/2000/svg';
let flagSeq = 0;
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};

const stripes = (colors, vertical) => (root) => colors.forEach((fill, i) => root.append(vertical
  ? svg('rect', { x: i * (60 / colors.length), width: 60 / colors.length, height: 40, fill })
  : svg('rect', { y: i * (40 / colors.length), width: 60, height: 40 / colors.length, fill })));

/**
 * Registre des drapeaux dessinés en SVG inline (Windows n'affiche pas les emojis de drapeaux : il montre « FR », « GB »).
 * Ajouter une langue : ajouter son dessin ici (voir docs/ADD_A_LANGUAGE.md) ; sans dessin, une pastille avec le code est affichée.
 */
export const FLAG_DRAWERS = {
  'fr-FR': stripes(['#0055A4', '#fff', '#EF4135'], true),
  'es-ES': (root) => root.append(svg('rect', { width: 60, height: 40, fill: '#AA151B' }), svg('rect', { y: 10, width: 60, height: 20, fill: '#F1BF00' })),
  'en-GB': (root) => {
    const id = `uj${++flagSeq}`;
    root.append(
      svg('clipPath', { id: `${id}s` }, svg('path', { d: 'M0,0 v40 h60 v-40 z' })),
      svg('clipPath', { id: `${id}t` }, svg('path', { d: 'M30,20 h30 v20 z v20 h-30 z h-30 v-20 z v-20 h30 z' })),
      svg('g', { 'clip-path': `url(#${id}s)` },
        svg('path', { d: 'M0,0 v40 h60 v-40 z', fill: '#012169' }),
        svg('path', { d: 'M0,0 L60,40 M60,0 L0,40', stroke: '#fff', 'stroke-width': 8 }),
        svg('path', { d: 'M0,0 L60,40 M60,0 L0,40', 'clip-path': `url(#${id}t)`, stroke: '#C8102E', 'stroke-width': 5 }),
        svg('path', { d: 'M30,0 v40 M0,20 h60', stroke: '#fff', 'stroke-width': 13 }),
        svg('path', { d: 'M30,0 v40 M0,20 h60', stroke: '#C8102E', 'stroke-width': 8 })));
  },
};

export function flagSvg(code) {
  const root = svg('svg', { viewBox: '0 0 60 40', width: 36, height: 24, class: 'flag-img', 'aria-hidden': 'true' });
  if (FLAG_DRAWERS[code]) FLAG_DRAWERS[code](root);
  else root.append(svg('rect', { width: 60, height: 40, fill: '#3b4660' }), svg('text', { x: 30, y: 26, 'text-anchor': 'middle', 'font-size': 16, 'font-family': 'sans-serif', fill: '#fff' }, code.slice(0, 2).toUpperCase()));
  return root;
}

export function flagPicker({ onChange = () => {} } = {}) {
  const buttons = LANGS.map((l) => el('button', {
    class: 'flag', type: 'button', role: 'radio', title: l.label, dataset: { lang: l.code },
    ariaLabel: l.label,
    onclick: () => { setLang(l.code, { persist: true }); sync(); onChange(l.code); },
  }, flagSvg(l.code)));
  const box = el('div', { class: 'flags', role: 'radiogroup', ariaLabel: 'Language' }, buttons);
  const sync = () => buttons.forEach((b) => { const on = b.dataset.lang === getLang(); b.classList.toggle('selected', on); b.setAttribute('aria-checked', String(on)); });
  sync();
  return box;
}

export const PERSONAS = [{ id: 'lumen', name: 'Lumen' }, { id: 'vera', name: 'Vera' }, { id: 'eko', name: 'Eko' }];
export const personaName = (id) => PERSONAS.find((p) => p.id === id)?.name ?? 'Lumen';

/** Avatar dessiné en CSS pur (aucune image). */
export const avatar = (id) => el('div', { class: `avatar a-${id}`, ariaHidden: 'true' }, el('i', { class: 'hair' }), el('i', { class: 'body' }), el('i', { class: 'head' }), el('i', { class: 'fringe' }));

/** Trois grands cercles : avatar, nom, description, trait, bouton « Essayer » (speechSynthesis). Sélection au clic. */
export function personaPicker({ selected = 'lumen', onSelect = () => {} } = {}) {
  let current = selected;
  const circles = PERSONAS.map(({ id, name }) => {
    const tryBtn = bindT(el('button', { class: 'try', type: 'button' }), 'textContent', 'onb.try');
    tryBtn.onclick = (e) => {
      e.stopPropagation();
      // voix indisponible ou synthèse absente : aucun message d'erreur, on n'entend simplement rien
      if (typeof window !== 'undefined' && window.speechSynthesis && window.SpeechSynthesisUtterance) {
        speakSample({ text: t(`persona.${id}.sample`), lang: getLang(), persona: id, synth: window.speechSynthesis, UtteranceCtor: window.SpeechSynthesisUtterance });
      }
    };
    const c = el('div', { class: 'persona', role: 'radio', tabIndex: 0, dataset: { persona: id } },
      avatar(id),
      el('strong', { class: 'pname' }, name),
      bindT(el('span', { class: 'pdesc' }), 'textContent', `persona.${id}.desc`),
      bindT(el('span', { class: 'badge' }), 'textContent', `persona.${id}.trait`),
      tryBtn);
    const pick = () => { current = id; sync(); onSelect(id); };
    c.onclick = pick;
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    return c;
  });
  const sync = () => circles.forEach((c) => { const on = c.dataset.persona === current; c.classList.toggle('selected', on); c.setAttribute('aria-checked', String(on)); });
  sync();
  const root = el('div', { class: 'personas', role: 'radiogroup' }, circles);
  root.value = () => current;
  return root;
}
