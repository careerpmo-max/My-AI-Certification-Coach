import { bindT } from '../i18n.js';
import { api, el } from '../ui.js';
import { flagPicker, personaPicker } from './widgets.js';

export function render(root, _params, go) {
  const err = el('div', { class: 'error' });
  const name = bindT(el('input', { autocomplete: 'given-name' }), 'placeholder', 'onb.firstNamePh');
  const key = el('input', { type: 'password', placeholder: 'sk-…', autocomplete: 'off' });
  const personas = personaPicker({ selected: 'lumen' });
  const btn = bindT(el('button', { class: 'primary' }), 'textContent', 'onb.continue');
  btn.onclick = async () => {
    err.textContent = '';
    btn.disabled = true;
    bindT(btn, 'textContent', 'onb.verifying');
    try {
      await api('/api/onboarding', { name: name.value, apiKey: key.value, persona: personas.value() });
      go('home', { state: await api('/api/state') });
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
      bindT(btn, 'textContent', 'onb.continue');
    }
  };
  root.append(el('div', { class: 'center-card onb' },
    el('div', { class: 'row spread' }, bindT(el('h1'), 'textContent', 'app.name'), flagPicker()),
    bindT(el('p', { class: 'muted' }), 'textContent', 'onb.intro'),
    bindT(el('label'), 'textContent', 'onb.firstName'), name,
    bindT(el('label'), 'textContent', 'onb.apiKey'), key,
    bindT(el('label'), 'textContent', 'onb.persona'),
    bindT(el('p', { class: 'muted small' }), 'textContent', 'onb.personaHint'),
    personas,
    el('div', { class: 'row', style: 'margin-top:22px' }, btn), err));
}
