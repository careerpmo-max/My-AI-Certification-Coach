import { setLang, storedLang, t } from '../i18n.js';
import { api, dialog, el, successIcon } from '../ui.js';

const ICON = { pending: '⏳', active: '⏳', done: '✅', error: '❌' };

/** Écran plein écran de création : barre animée + étapes au fil de l'eau, pop-up de succès à 100 %. */
export async function render(root, { id, name }, go) {
  const title = el('h1', {}, t('create.title', { name }));
  const pct = el('div', { class: 'big-pct' }, '0 %');
  const fill = el('i', { style: 'width:0%' });
  const list = el('ul', { class: 'steps' });
  const errBox = el('div', { class: 'card err-box', hidden: true });
  root.append(el('div', { class: 'create-screen' }, title, pct, el('div', { class: 'bar xl' }, fill), list, errBox,
    el('p', { class: 'muted small', dataset: { note: '1' } }, t('create.note'))));

  let stopped = false;
  let syncedLang = false;
  let shown = 0;
  let activeSince = { key: null, t: 0 };
  let last = null;

  // La barre avance de façon continue pendant qu'une étape tourne (sans jamais dépasser l'étape suivante).
  const tick = setInterval(() => {
    if (!last || last.status === 'failed') return;
    const done = last.steps.filter((s) => s.state === 'done').at(-1)?.pct ?? 0;
    const active = last.steps.find((s) => s.state === 'active');
    const creep = active ? Math.min(17, ((Date.now() - activeSince.t) / 1000) * 0.5) : 0;
    const target = last.status === 'done' ? 100 : done + creep;
    shown += (target - shown) * 0.12;
    if (Math.abs(target - shown) < 0.2) shown = target;
    fill.style.width = `${shown}%`;
    pct.textContent = `${Math.round(shown)} %`;
  }, 100);
  const leave = () => { stopped = true; clearInterval(tick); };

  const draw = (v) => {
    last = v;
    const active = v.steps.find((s) => s.state === 'active');
    if (active && activeSince.key !== active.key) activeSince = { key: active.key, t: Date.now() };
    list.replaceChildren(...v.steps.map((s) => el('li', { class: `step ${s.state}` }, el('span', { class: 'ico' }, ICON[s.state]), el('span', { class: 'grow' }, s.label), el('span', { class: 'muted' }, `${s.pct} %`))));
  };

  const showError = (v) => {
    errBox.hidden = false;
    const ta = el('textarea', { rows: 6, placeholder: t('create.pastePh'), hidden: true });
    const e2 = el('div', { class: 'error' });
    const retry = el('button', { class: 'primary', textContent: t('create.retry'), onclick: async () => { await api('/api/creation/retry', { curriculumId: id }); errBox.hidden = true; poll(); } });
    const send = el('button', { class: 'primary', textContent: t('create.analyze'), hidden: true, onclick: async () => {
      send.disabled = true; e2.textContent = '';
      try { await api('/api/creation/manual', { curriculumId: id, text: ta.value }); errBox.hidden = true; poll(); } catch (e) { e2.textContent = e.message; send.disabled = false; }
    } });
    const paste = el('button', { textContent: t('create.paste'), onclick: () => { ta.hidden = false; send.hidden = false; paste.hidden = true; ta.focus(); } });
    const back = el('button', { class: 'ghost', textContent: t('create.home'), onclick: async () => { leave(); setLang(storedLang()); go('home', { state: await api('/api/state') }); } });
    errBox.replaceChildren(el('strong', {}, t('create.stopped')), el('p', {}, v.error), ta, e2,
      el('div', { class: 'row wrap' }, retry, ['fetch', 'extract'].includes(v.failedStep) ? paste : null, send, back));
  };

  const finished = async (v) => {
    leave();
    fill.style.width = '100%';
    pct.textContent = '100 %';
    const info = await api(`/api/plan?curriculumId=${id}`);
    const blocs = info.domains.length;
    await dialog({ icon: successIcon(), title: t('create.done'), text: t('create.doneText', { blocs, modules: info.plan.modules.filter((m) => m.kind !== 'quiz').length }), actions: [{ id: 'ok', label: t('create.start'), class: 'primary' }] });
    go('workspace', { id, name });
  };

  async function poll() {
    if (stopped || !document.contains(list)) return leave();
    let v;
    try { v = await api(`/api/creation?curriculumId=${id}`); } catch { return void setTimeout(poll, 1500); }
    if (!syncedLang) { syncedLang = true; if (v.language) { setLang(v.language); title.textContent = t('create.title', { name }); root.querySelector('[data-note]').textContent = t('create.note'); } }
    draw(v);
    if (v.status === 'done') return finished(v);
    if (v.status === 'failed') return showError(v);
    setTimeout(poll, 800);
  }
  poll();
}
