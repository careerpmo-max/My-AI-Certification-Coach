import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONA_SPEECH, VoiceMode, cleanForSpeech, guessGender, isEcho, pickPersonaVoice, pickVoice, speakSample, splitSentences } from '../src/web/speech.js';

test('cleanForSpeech : plus de markdown, de code ni d\'URL à lire', () => {
  assert.equal(cleanForSpeech('## Titre\n- **Point** un\n1. Deux avec `code` et https://exemple.org/x ok'), 'Titre Point un Deux avec code et ok');
  assert.equal(cleanForSpeech('avant ```js\nconst a = 1;\n``` après'), 'avant après');
});

test('splitSentences : phrases complètes uniquement pendant le flux, reste vidé à la fin', () => {
  let [ready, rest] = splitSentences('Bonjour Ada. Un agent est un LLM qui');
  assert.deepEqual(ready, ['Bonjour Ada.']);
  assert.equal(rest, ' Un agent est un LLM qui');
  [ready, rest] = splitSentences(rest + ' agit ! Et 3.5 fois ?');
  assert.deepEqual(ready.map((s) => s.trim()), ['Un agent est un LLM qui agit !']);
  assert.equal(rest, ' Et 3.5 fois ?'); // ponctuation finale : on attend la suite (3.5 !)
  [ready] = splitSentences(rest, true);
  assert.deepEqual(ready, [' Et 3.5 fois ?']);
  // invariant : rien n'est perdu, quel que soit le découpage du flux
  const text = 'Salut ! Version 3.5 : ok. « Vraiment ? » Oui...\nFin';
  for (let cut = 0; cut <= text.length; cut++) {
    const [r1, rest1] = splitSentences(text.slice(0, cut));
    const [r2] = splitSentences(rest1 + text.slice(cut), true);
    assert.equal([...r1, ...r2].join(''), text, `coupure ${cut}`);
  }
  [ready, rest] = splitSentences('Dernier morceau sans point', true);
  assert.deepEqual(ready, ['Dernier morceau sans point']);
  assert.equal(rest, '');
});

test('pickVoice : première voix de la langue, sinon même langue, sinon voix par défaut', () => {
  const voices = [{ name: 'A', lang: 'en_US' }, { name: 'B', lang: 'fr-CA' }, { name: 'C', lang: 'fr-FR' }, { name: 'D', lang: 'fr-FR' }];
  assert.equal(pickVoice(voices, 'fr-FR').name, 'C');
  assert.equal(pickVoice(voices, 'en-US').name, 'A'); // séparateur _ toléré
  assert.equal(pickVoice(voices.filter((v) => v.name !== 'C' && v.name !== 'D'), 'fr-FR').name, 'B');
  assert.equal(pickVoice(voices, 'de-DE'), null);
  assert.equal(pickVoice([], 'fr-FR'), null);
});

test('isEcho : le coach qui s\'entend lui-même n\'est pas une interruption', () => {
  const spoken = 'Un agent, c\'est un modèle de langage qui peut appeler des outils';
  assert.equal(isEcho('un agent c\'est un modèle', spoken), true);
  assert.equal(isEcho('attends j\'ai une question', spoken), false);
  assert.equal(isEcho('stop', spoken), false);
  assert.equal(isEcho('', spoken), true);
});

// ---------- faux navigateur ----------
function env(opts = {}) {
  const recs = [];
  let failures = opts.failFirstStart ? 1 : 0;
  class Rec {
    constructor() { this.started = 0; this.aborted = 0; recs.push(this); }
    start() { if (failures > 0) { failures--; throw new Error('InvalidStateError'); } this.started++; }
    abort() { this.aborted++; }
  }
  const spoken = [];
  const synth = { spoken, cancelled: 0, getVoices: () => [{ name: 'Amelie', lang: 'fr-FR' }, { name: 'Microsoft Paul', lang: 'fr-FR' }], speak(u) { spoken.push(u); }, cancel() { this.cancelled++; }, resume() {} };
  class Utt { constructor(text) { this.text = text; } }
  const timers = [];
  const fake = { set: (fn, ms) => (timers.push({ fn, ms, live: true }), timers.length - 1), clear: (i) => { if (timers[i]) timers[i].live = false; } };
  const log = { utterances: [], interim: [], states: [], errors: [], barge: 0 };
  const vm = new VoiceMode({
    language: 'fr-FR', SpeechRecognitionCtor: Rec, synth, UtteranceCtor: Utt, timers: fake,
    onUtterance: (t) => log.utterances.push(t), onInterim: (t) => log.interim.push(t), onState: (s) => log.states.push(s),
    onError: (code) => log.errors.push(code), onBargeIn: () => log.barge++, ...opts,
  });
  const fire = (ms) => timers.filter((t) => t.live && t.ms === ms).forEach((t) => { t.live = false; t.fn(); });
  const say = (transcript, isFinal) => vm.rec.onresult({ resultIndex: 0, results: [{ isFinal, 0: { transcript } }] });
  return { vm, recs, synth, log, timers, fire, say };
}

test('reconnaissance : la phrase part au chat après la pause (VAD natif), les finals rapprochés sont réunis', () => {
  const { vm, recs, log, fire, say } = env();
  vm.start();
  assert.equal(recs.length, 1);
  assert.deepEqual([recs[0].lang, recs[0].continuous, recs[0].interimResults], ['fr-FR', true, true]);
  say('explique', false);
  say('explique moi les agents', false);
  assert.equal(vm.state, 'hearing');
  say('explique moi les agents', true);
  say(' et le RAG', true); // deuxième final avant la fin du délai
  fire(1200);
  assert.deepEqual(log.utterances, ['explique moi les agents et le RAG']);
  assert.equal(vm.state, 'thinking');
  fire(1200);
  assert.equal(log.utterances.length, 1, 'envoyé une seule fois');
});

test('tant que l\'utilisateur parle encore, rien n\'est envoyé', () => {
  const { vm, log, fire, say } = env();
  vm.start();
  say('première partie', true);
  say('et je continue', false); // nouvelle parole : le délai d'envoi est annulé
  fire(1200);
  assert.deepEqual(log.utterances, []);
  say('et je continue', true);
  fire(1200);
  assert.deepEqual(log.utterances, ['première partie et je continue']);
});

test('lecture à voix haute : phrase par phrase pendant le streaming, voix et langue du cursus', () => {
  const { vm, synth, log, fire } = env();
  vm.start();
  const speech = vm.newSpeech();
  speech.push('Bonjour Ada. Un agent ');
  assert.deepEqual(synth.spoken.map((u) => u.text), ['Bonjour Ada.']);
  speech.push('est un LLM **outillé**. ');
  speech.push('Des questions');
  speech.end();
  assert.deepEqual(synth.spoken.map((u) => u.text), ['Bonjour Ada.', 'Un agent est un LLM outillé.', 'Des questions']);
  assert.ok(synth.spoken.every((u) => u.lang === 'fr-FR' && u.voice.name === 'Microsoft Paul'));
  assert.equal(vm.state, 'speaking');
  synth.spoken.forEach((u) => u.onend());
  assert.equal(vm.speaking, false);
  assert.equal(vm.state, 'speaking', 'pas d\'écoute avant la fin du délai de réverbération');
  fire(400);
  assert.equal(vm.state, 'listening');
  assert.ok(log.states.includes('speaking'));
});

test('micro suspendu pendant que le coach parle, rallumé 400 ms après la fin de la lecture (protection principale contre l\'écho)', () => {
  const { vm, recs, synth, timers, fire, log } = env();
  vm.start();
  const first = recs[0];
  const speech = vm.newSpeech();
  assert.equal(first.aborted, 0, 'avant tout son (réflexion du coach) le micro reste ouvert : l\'utilisateur peut encore parler');
  speech.push('Un agent est un modèle de langage. Voici la suite. ');
  assert.equal(first.aborted, 1);
  assert.equal(vm.micSuspended, true);
  assert.deepEqual([first.onresult, first.onend, first.onerror], [null, null, null], 'plus aucun résultat, même tardif, ne peut passer');
  speech.end();
  synth.spoken[0].onend();
  assert.equal(vm.micSuspended, true, 'toujours suspendu entre deux phrases');
  assert.equal(timers.filter((t) => t.live && t.ms === 400).length, 0);
  synth.spoken[1].onend(); // dernière phrase terminée
  assert.equal(vm.micSuspended, true);
  assert.equal(recs.length, 1, 'aucune écoute avant le délai');
  assert.equal(timers.filter((t) => t.live && t.ms === 400).length, 1, 'délai de 400 ms armé');
  fire(400);
  assert.equal(vm.micSuspended, false);
  assert.equal(recs.length, 2);
  assert.equal(recs[1].started, 1);
  assert.equal(vm.state, 'listening');
  assert.deepEqual(log.errors, []);
});

test('résultat tardif pendant la suspension : ignoré, même sans ressembler au coach', () => {
  const { vm, log, fire } = env();
  vm.start();
  vm.newSpeech().push('Bonjour à toi. ');
  vm.handleResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'phrase totalement différente' } }] });
  fire(1200);
  assert.deepEqual(log.utterances, []);
  assert.equal(log.barge, 0);
});

test('interruption par bouton/Échap : la lecture et le flux s\'arrêtent, le micro revient après 400 ms', () => {
  const { vm, recs, synth, log, fire } = env();
  vm.start();
  const speech = vm.newSpeech();
  speech.push('Un agent est un modèle. Voici un exemple. ');
  const cancelled = synth.cancelled;
  const spokenBefore = synth.spoken.length;
  vm.interrupt();
  assert.equal(synth.cancelled, cancelled + 1);
  assert.equal(log.barge, 1);
  assert.equal(vm.speaking, false);
  assert.equal(recs.length, 1, 'pas encore de micro');
  speech.push('texte tardif du flux annulé. ');
  assert.equal(synth.spoken.length, spokenBefore);
  synth.spoken[0].onend(); // fin tardive d'une lecture annulée : sans effet
  fire(400);
  assert.equal(recs.length, 2);
  assert.equal(vm.state, 'listening');
});

test('une nouvelle lecture pendant le délai annule la reprise du micro', () => {
  const { vm, recs, synth, timers, fire } = env();
  vm.start();
  const s1 = vm.newSpeech();
  s1.push('Première réponse. ');
  s1.end();
  synth.spoken[0].onend();
  assert.equal(timers.filter((t) => t.live && t.ms === 400).length, 1);
  vm.newSpeech().push('Deuxième réponse. ');
  assert.equal(timers.filter((t) => t.live && t.ms === 400).length, 0, 'reprise annulée');
  fire(400);
  assert.equal(vm.micSuspended, true);
  assert.equal(recs.length, 1);
});

test('micro coupé par l\'utilisateur : la reprise automatique le respecte', () => {
  const { vm, recs, synth, fire } = env();
  vm.start();
  const s = vm.newSpeech();
  s.push('Une phrase. ');
  s.end();
  vm.setMuted(true);
  synth.spoken[0].onend();
  fire(400);
  assert.equal(vm.micSuspended, false);
  assert.equal(recs.length, 1, 'pas de nouvelle écoute : micro coupé');
  vm.setMuted(false);
  assert.equal(recs.length, 2);
});

test('phrase en cours de dictée : reportée pendant la lecture, envoyée après la reprise', () => {
  const { vm, log, synth, timers, fire, say } = env();
  vm.start();
  say('bonjour coach', true); // envoi armé à 1200 ms
  const s = vm.newSpeech();
  s.push('Une réponse. ');
  assert.equal(timers.filter((t) => t.live && t.ms === 1200).length, 0, 'envoi suspendu avec le micro');
  s.end();
  synth.spoken[0].onend();
  fire(400);
  assert.deepEqual(log.utterances, []);
  fire(1200);
  assert.deepEqual(log.utterances, ['bonjour coach']);
});

test('filet de sécurité : onend jamais reçu (bug Chrome) -> reprise quand la synthèse est silencieuse 1 s', () => {
  const { vm, recs, synth, timers, fire } = env();
  synth.speaking = true;
  synth.pending = false;
  vm.start();
  const s = vm.newSpeech();
  s.push('Une phrase sans onend. ');
  s.end();
  fire(500);
  assert.equal(vm.micSuspended, true, 'tant que la synthèse parle, on attend');
  synth.speaking = false; // la synthèse s'est tue sans onend
  fire(500);
  assert.equal(vm.micSuspended, true, 'un seul contrôle silencieux ne suffit pas (la lecture peut démarrer)');
  fire(500);
  assert.equal(timers.filter((t) => t.live && t.ms === 400).length, 1);
  fire(400);
  assert.equal(vm.micSuspended, false);
  assert.equal(recs.length, 2);
});

test('redémarrage refusé par le navigateur juste après abort() : nouvel essai, jamais d\'erreur', () => {
  const { vm, recs, log, fire } = env({ failFirstStart: true });
  vm.start();
  assert.equal(recs[0].started, 0);
  fire(300);
  assert.equal(recs[0].started, 1);
  assert.deepEqual(log.errors, []);
});

test('écoute continue relancée automatiquement ; erreurs graves coupent le mode', () => {
  const { vm, recs, log, timers } = env();
  vm.start();
  recs[0].onend();
  timers.at(-1).fn();
  assert.equal(recs.length, 2, 'nouvelle instance après la fin naturelle de l\'écoute');
  recs[1].onerror({ error: 'no-speech' });
  recs[1].onerror({ error: 'aborted' });
  assert.deepEqual(log.errors, []);
  assert.equal(vm.active, true);
  recs[1].onerror({ error: 'not-allowed' });
  assert.equal(log.errors[0], 'not-allowed');
  assert.equal(vm.active, false);
  assert.equal(vm.state, 'idle');
});

test('erreurs réseau et langue explicites ; boucle de relance bloquée', () => {
  const a = env();
  a.vm.start();
  a.vm.rec.onerror({ error: 'network' });
  assert.equal(a.log.errors[0], 'network');
  const b = env();
  b.vm.start();
  b.vm.rec.onerror({ error: 'language-not-supported' });
  assert.equal(b.log.errors[0], 'language-not-supported');
  const c = env();
  c.vm.start();
  for (let i = 0; i < 12 && c.vm.active; i++) { c.vm.rec.onend(); c.timers.at(-1).fn(); }
  assert.equal(c.log.errors.at(-1), 'unstable');
  assert.equal(c.vm.active, false);
});

test('micro coupé puis réactivé ; stop() libère tout', () => {
  const { vm, recs, synth } = env();
  vm.start();
  vm.setMuted(true);
  assert.equal(recs[0].aborted, 1);
  recs[0].onend(); // pas de relance quand le micro est coupé
  assert.equal(recs.length, 1);
  vm.setMuted(false);
  assert.equal(recs.length, 2);
  vm.newSpeech().push('Bonjour tout le monde. ');
  vm.stop();
  assert.equal(recs[1].aborted, 1); // éteint une seule fois (suspension à la lecture)
  assert.ok(synth.cancelled >= 2);
  assert.equal(vm.state, 'idle');
});

test('supported() : nécessite reconnaissance ET synthèse', () => {
  assert.equal(VoiceMode.supported({}), false);
  assert.equal(VoiceMode.supported({ webkitSpeechRecognition() {}, speechSynthesis: {}, SpeechSynthesisUtterance() {} }), true);
  assert.equal(VoiceMode.supported({ SpeechRecognition() {}, speechSynthesis: {} }), false);
});

test('une erreur de speak() n\'interrompt pas le flux de texte', () => {
  const { vm, synth, log } = env();
  synth.speak = () => { throw new Error('indisponible'); };
  vm.start();
  const speech = vm.newSpeech();
  assert.doesNotThrow(() => { speech.push('Bonjour. Deuxième phrase. '); speech.end(); });
  assert.equal(log.errors[0], 'speak');
  assert.equal(vm.speaking, false);
});

const V = (name, lang) => ({ name, lang });
const FR = [V('Google français', 'fr-FR'), V('Microsoft Paul', 'fr-FR'), V('Amélie', 'fr-FR'), V('Microsoft Julie', 'fr-FR'), V('Thomas', 'fr-FR'), V('Audrey', 'fr-CA'), V('Daniel', 'en-GB')];

test('guessGender : devine le genre d\'après le nom de la voix', () => {
  assert.equal(guessGender(V('Google UK English Female', 'en-GB')), 'f');
  assert.equal(guessGender(V('Google UK English Male', 'en-GB')), 'm');
  assert.equal(guessGender(V('Microsoft Hortense - French', 'fr-FR')), 'f');
  assert.equal(guessGender(V('Thomas', 'fr-FR')), 'm');
  assert.equal(guessGender(V('Google español', 'es-ES')), 'n');
  assert.equal(guessGender(null), 'n');
});

test('voix des personas : Lumen 1re masculine, Vera 2e féminine ou neutre, Eko 1re féminine, jamais d\'erreur', () => {
  assert.equal(pickPersonaVoice(FR, 'fr-FR', 'lumen').name, 'Microsoft Paul');
  assert.equal(pickPersonaVoice(FR, 'fr-FR', 'vera').name, 'Microsoft Julie');
  assert.equal(pickPersonaVoice(FR, 'fr-FR', 'eko').name, 'Amélie');
  // Vera : une seule voix féminine -> voix neutre
  assert.equal(pickPersonaVoice([V('Amélie', 'fr-FR'), V('Google français', 'fr-FR')], 'fr-FR', 'vera').name, 'Google français');
  // aucune voix du genre voulu -> null (voix par défaut)
  assert.equal(pickPersonaVoice([V('Amélie', 'fr-FR')], 'fr-FR', 'lumen'), null);
  assert.equal(pickPersonaVoice([V('Thomas', 'fr-FR')], 'fr-FR', 'eko'), null);
  assert.equal(pickPersonaVoice([], 'fr-FR', 'lumen'), null);
  assert.equal(pickPersonaVoice(FR, 'es-ES', 'lumen'), null); // aucune voix espagnole
  // langue : région exacte d'abord (Audrey fr-CA ne passe qu'en repli)
  assert.equal(pickPersonaVoice([V('Audrey', 'fr-CA')], 'fr-FR', 'eko').name, 'Audrey');
  assert.equal(pickPersonaVoice(FR, 'en-GB', 'lumen')?.name ?? null, 'Daniel');
});

test('délai avant envoi de phrase : 1200 ms', () => {
  const { vm, timers, say } = env();
  vm.start();
  say('bonjour', true);
  assert.equal(timers.at(-1).ms, 1200);
});

test('lecture avec la voix et les réglages du persona', () => {
  const { synth } = (() => {
    const e = env({ persona: 'eko' });
    e.synth.getVoices = () => FR;
    e.vm.start();
    e.vm.newSpeech().push('Salut ! ');
    return e;
  })();
  const u = synth.spoken[0];
  assert.equal(u.voice.name, 'Amélie'); // Eko : 1re voix féminine
  assert.deepEqual([u.rate, u.pitch], [PERSONA_SPEECH.eko.rate, PERSONA_SPEECH.eko.pitch]);
});

test('speakSample (bouton Essayer) : voix du persona, silencieux si la synthèse échoue', () => {
  const spoken = [];
  const synth = { getVoices: () => FR, cancel() {}, speak: (u) => spoken.push(u) };
  class Utt { constructor(t) { this.text = t; } }
  assert.equal(speakSample({ text: 'Bonjour', lang: 'fr-FR', persona: 'vera', synth, UtteranceCtor: Utt }), true);
  assert.deepEqual([spoken[0].voice.name, spoken[0].lang, spoken[0].pitch], ['Microsoft Julie', 'fr-FR', 0.92]);
  assert.equal(speakSample({ text: 'x', lang: 'fr-FR', persona: 'lumen', synth: { cancel() { throw new Error('nope'); } }, UtteranceCtor: Utt }), false);
});
