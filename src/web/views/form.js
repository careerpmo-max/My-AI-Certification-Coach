import { bindT, getLang, t } from '../i18n.js';
import { api, el } from '../ui.js';
import { flagPicker } from './widgets.js';

/** Formulaire de création : les drapeaux changent langue du cursus ET textes du formulaire, en direct. */
export function render(root, { state }, go) {
  const err = el('div', { class: 'error' });
  const name = bindT(el('input', { maxLength: 80 }), 'placeholder', 'form.namePh');
  const url = bindT(el('input', { type: 'url' }), 'placeholder', 'form.urlPh');
  const annexBox = el('div', { class: 'stack small-gap' });
  const addAnnex = (value = '') => {
    const input = bindT(el('input', { type: 'url', value }), 'placeholder', 'form.annexPh');
    const row = el('div', { class: 'row' }, input, bindT(el('button', { class: 'ghost', type: 'button', onclick: () => row.remove() }), 'title', 'common.remove'));
    row.lastChild.textContent = '✕';
    annexBox.append(row);
    return input;
  };

  const chips = state.suggestions.map((s) => {
    const chip = el('button', { class: 'chip', type: 'button', onclick: () => { name.value = name.value || t('form.nameSuggest'); url.value = s.url; } });
    return bindT(chip, 'textContent', 'form.prefill', { label: s.label });
  });

  const submit = bindT(el('button', { class: 'primary big' }), 'textContent', 'form.submit');
  submit.onclick = async () => {
    err.textContent = '';
    const annexLinks = [...annexBox.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    if (!name.value.trim()) return void (err.textContent = t('form.errName'));
    if (!url.value.trim()) return void (err.textContent = t('form.errUrl'));
    submit.disabled = true;
    try {
      const { curriculum } = await api('/api/curricula', { name: name.value, officialUrl: url.value.trim(), annexLinks, language: getLang() });
      go('create', { id: curriculum.id, name: curriculum.name });
    } catch (e) {
      err.textContent = e.message;
      submit.disabled = false;
    }
  };

  const label = (key) => bindT(el('label'), 'textContent', key);
  // labels à suffixe : chaque morceau est lié séparément pour que le changement de langue ne les écrase pas
  const urlLabel = el('label', {}, bindT(el('span'), 'textContent', 'form.url'), ' ', bindT(el('span', { class: 'req' }), 'textContent', 'form.required'));
  const annexLabel = el('label', {}, bindT(el('span'), 'textContent', 'form.annex'), ' ', bindT(el('span', { class: 'muted' }), 'textContent', 'form.optional'));

  root.append(el('div', { class: 'center-card wide' },
    bindT(el('h1'), 'textContent', 'form.title'),
    el('div', { class: 'row wrap' }, chips),
    label('form.name'), name,
    urlLabel, url,
    bindT(el('p', { class: 'muted small' }), 'textContent', 'form.urlHelp'),
    label('form.lang'),
    flagPicker(),
    bindT(el('p', { class: 'muted small' }), 'textContent', 'form.langHelp'),
    annexLabel, annexBox,
    bindT(el('button', { class: 'ghost', type: 'button', onclick: () => annexBox.children.length < 5 && addAnnex().focus() }), 'textContent', 'form.add'),
    el('div', { class: 'row spread', style: 'margin-top:22px' }, bindT(el('button', { onclick: async () => go('home', { state: await api('/api/state') }) }), 'textContent', 'common.cancel'), submit),
    err));
  name.focus();
}
