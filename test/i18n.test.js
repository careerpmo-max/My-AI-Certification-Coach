import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DICT, LANGS, getLang, setLang, t } from '../src/web/i18n.js';
import { PERSONAS } from '../src/server/coach/personas.js';
import { LANGUAGES, normalizeLanguage } from '../src/server/coach/language.js';
import { MESSAGES } from '../src/server/i18n.js';
import { FLAG_DRAWERS } from '../src/web/views/widgets.js';

const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('interface : mêmes clés et mêmes paramètres en fr / en / es', () => {
  const fr = DICT['fr-FR'];
  for (const lang of Object.keys(DICT).filter((l) => l !== 'fr-FR')) {
    assert.deepEqual(Object.keys(DICT[lang]).sort(), Object.keys(fr).sort(), `clés ${lang}`);
    for (const k of Object.keys(fr)) assert.equal(params(DICT[lang][k]), params(fr[k]), `${lang} ${k}`);
  }
});

test('extensibilité : chaque langue déclarée a son dictionnaire client, ses messages serveur et son entrée de sélecteur', () => {
  const codes = Object.keys(LANGUAGES);
  assert.equal(codes[0], 'fr-FR', 'le français reste la langue par défaut');
  assert.deepEqual(LANGS.map((l) => l.code), codes, 'sélecteur client = langues serveur');
  assert.deepEqual(Object.keys(DICT), codes, 'dictionnaires client');
  assert.deepEqual(Object.keys(MESSAGES), codes, 'messages serveur');
  for (const [code, l] of Object.entries(LANGUAGES)) {
    assert.ok(l.label && l.name && l.flag, `métadonnées ${code}`);
    assert.equal(normalizeLanguage(code), code);
  }
});

test('normalizeLanguage : variantes régionales ramenées à une langue supportée, inconnu -> français', () => {
  assert.equal(normalizeLanguage('en-US'), 'en-GB');
  assert.equal(normalizeLanguage('es_MX'), 'es-ES');
  assert.equal(normalizeLanguage('fr'), 'fr-FR');
  assert.equal(normalizeLanguage('ja-JP'), 'fr-FR');
  assert.equal(normalizeLanguage(undefined), 'fr-FR');
});

test('drapeaux : un dessin par langue (sinon repli sur une pastille, jamais d\'erreur)', () => {
  for (const code of Object.keys(LANGUAGES)) assert.equal(typeof FLAG_DRAWERS[code], 'function', `dessin du drapeau ${code}`);
});

test('toute clé utilisée par les vues existe', () => {
  const dir = fileURLToPath(new URL('../src/web/', import.meta.url));
  const files = [...readdirSync(join(dir, 'views')).map((f) => join(dir, 'views', f)), join(dir, 'app.js'), join(dir, 'theme.js')];
  const used = new Set();
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/'((?:app|lang|common|onb|persona|home|form|create|ws|voice|chat|theme)\.[\w.-]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 60, `clés détectées: ${used.size}`);
  for (const k of used) assert.ok(k in DICT['fr-FR'], `clé manquante: ${k}`);
  for (const p of Object.keys(PERSONAS)) for (const part of ['desc', 'trait', 'sample']) assert.ok(`persona.${p}.${part}` in DICT['fr-FR'], `persona.${p}.${part}`);
  for (const code of ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network', 'unstable', 'speak']) assert.ok(`voice.err.${code}` in DICT['fr-FR'], code);
});

test('t() : langue courante, paramètres, repli sur le français, langue inconnue -> français', () => {
  setLang('en-GB');
  assert.equal(getLang(), 'en-GB');
  assert.equal(t('home.hello', { name: 'Ada' }), 'Hello Ada 👋');
  setLang('es-ES');
  assert.equal(t('form.submit'), 'Crear mi plan de formación');
  setLang('xx');
  assert.equal(getLang(), 'fr-FR');
  assert.equal(t('form.submit'), 'Créer mon plan de formation');
  assert.equal(t('clé.inconnue'), 'clé.inconnue');
});

test('personas : les textes suivent la langue', () => {
  setLang('en-GB');
  assert.equal(t('persona.lumen.desc'), 'Warm and patient, explains from several angles');
  assert.equal(t('persona.eko.trait'), 'Energetic');
  setLang('es-ES');
  assert.equal(t('persona.vera.trait'), 'Exigente');
  setLang('fr-FR');
  assert.equal(t('persona.lumen.desc'), 'Chaleureuse et patiente, explique sous plusieurs angles');
  assert.equal(t('persona.lumen.trait'), 'Bienveillante');
  assert.equal(t('persona.vera.desc'), 'Rigoureuse et précise, va droit au but');
  assert.equal(t('persona.eko.trait'), 'Énergique');
});
