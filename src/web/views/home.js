import { getLang, storedLang, setLang, t } from '../i18n.js';
import { api, dialog, el } from '../ui.js';

export function render(root, { state }, go) {
  setLang(storedLang());
  const { profile, curricula } = state;
  const langLabel = (code) => state.languages.find((l) => l.code === code)?.label ?? code;
  const err = el('div', { class: 'error' });

  const remove = async (c) => {
    const choice = await dialog({
      icon: '🗑️', title: t('home.delTitle', { name: c.name }), text: t('home.delText'),
      actions: [{ id: 'no', label: t('common.cancel') }, { id: 'yes', label: t('home.delete'), class: 'danger' }],
    });
    if (choice !== 'yes') return;
    try {
      await api('/api/curricula/delete', { curriculumId: c.id });
      go('home', { state: await api('/api/state') });
    } catch (e) { err.textContent = e.message; }
  };

  const badge = (c) => (c.creation === 'running' ? el('span', { class: 'badge' }, t('home.creating')) : c.creation === 'failed' ? el('span', { class: 'badge warn' }, t('home.resume')) : null);
  const card = (c) => el('div', { class: 'card cursus' },
    el('div', { class: 'grow' },
      el('div', { class: 'row' }, el('strong', {}, c.name), badge(c)),
      el('div', { class: 'muted small' }, `${c.certification !== c.name ? `${c.certification} · ` : ''}${langLabel(c.language)} · ${t('home.created', { date: new Date(c.createdAt).toLocaleDateString(getLang()) })}`),
      el('div', { class: 'row', style: 'margin-top:8px' }, el('div', { class: 'bar grow' }, el('i', { style: `width:${c.progress}%` })), el('span', { class: 'muted small' }, `${c.progress} %`))),
    el('div', { class: 'row' },
      el('button', { class: c.creation === 'done' && c.progress > 0 ? 'resume' : 'primary', textContent: c.creation !== 'done' ? t('home.seeCreation') : c.progress > 0 ? t('home.continue') : t('home.open'), onclick: () => go(c.creation === 'done' ? 'workspace' : 'create', { id: c.id, name: c.name }) }),
      el('button', { class: 'ghost danger-text', textContent: t('home.delete'), onclick: () => remove(c) })));

  root.append(el('div', { class: 'page' },
    el('header', { class: 'page-head' },
      el('h1', {}, t('home.hello', { name: profile.name })),
      el('button', { class: 'primary', textContent: t('home.new'), onclick: () => go('form', { state }) })),
    curricula.length
      ? el('div', { class: 'stack' }, curricula.map(card))
      : el('div', { class: 'card empty' }, el('p', {}, t('home.empty1')), el('p', { class: 'muted' }, t('home.empty2')),
        el('button', { class: 'primary', textContent: t('home.first'), onclick: () => go('form', { state }) })),
    err));
}
