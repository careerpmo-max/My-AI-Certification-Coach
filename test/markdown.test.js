import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMessage } from '../src/web/markdown.js';

const txt = (nodes) => nodes.map((n) => (n.t === 'text' ? n.v : n.t === 'code' ? n.v : txt(n.c))).join('');

test('inline : gras, italique, code, liens markdown et URL nues', () => {
  const n = parseInline('Un **agent** *outillé* appelle `search()` via [la doc](https://learn.microsoft.com/a) ou https://github.com/o/r.');
  assert.deepEqual(n.map((x) => x.t), ['text', 'b', 'text', 'i', 'text', 'code', 'text', 'a', 'text', 'a', 'text']);
  assert.equal(txt(n[1].c ?? []), 'agent');
  assert.deepEqual([n[7].href, txt(n[7].c)], ['https://learn.microsoft.com/a', 'la doc']);
  assert.deepEqual([n[9].href, n.at(-1).v], ['https://github.com/o/r', '.'], 'la ponctuation finale reste hors du lien');
  // imbrication : gras contenant du code ; astérisque isolée ou multiplication : pas d'italique parasite
  assert.equal(parseInline('**le `x`**')[0].c[1].t, 'code');
  assert.deepEqual(parseInline('2 * 3 * 4').map((x) => x.t), ['text']);
  assert.deepEqual(parseInline('rien').map((x) => x.t), ['text']);
});

test('inline : jamais de lien non http(s) (javascript:, data:)', () => {
  const n = parseInline('[clic](javascript:alert(1)) et [ok](https://example.org/x) et data:text/html,<b>');
  assert.deepEqual(n.filter((x) => x.t === 'a').map((x) => x.href), ['https://example.org/x']);
});

test('blocs : [CONCEPT] avec titre, corps sur les lignes suivantes, liste incluse', () => {
  const [b] = parseMessage('[CONCEPT] Les agents\nUn agent est un LLM qui agit.\n- Il planifie\n- Il appelle des outils');
  assert.equal(b.type, 'concept');
  assert.equal(b.title, 'Les agents');
  assert.deepEqual(b.body.map((x) => x.type), ['p', 'ul']);
  assert.deepEqual(b.body[1].items, ['Il planifie', 'Il appelle des outils']);
});

test('blocs : une ligne vide juste après la balise est tolérée, le bloc se termine à la ligne vide suivante', () => {
  const blocks = parseMessage('[ANALOGIE] Chef d\'orchestre\n\nIl dirige les musiciens.\nChacun joue sa partie.\n\nTexte après le bloc.');
  assert.deepEqual(blocks.map((x) => x.type), ['analogy', 'p']);
  assert.equal(blocks[0].title, 'Chef d\'orchestre');
  assert.equal(blocks[0].body[0].text, 'Il dirige les musiciens.\nChacun joue sa partie.');
  assert.equal(blocks[1].text, 'Texte après le bloc.');
});

test('blocs : balises insensibles à la casse, [ANALOGY] accepté, phrase longue sans titre distinct = corps', () => {
  assert.equal(parseMessage('[concept] x')[0].type, 'concept');
  assert.equal(parseMessage('[Analogy] x')[0].type, 'analogy');
  const long = 'Un agent est un système qui combine un modèle de langage, une mémoire et des outils pour atteindre un objectif de façon autonome.';
  const [b] = parseMessage(`[CONCEPT] ${long}`);
  assert.equal(b.title, '');
  assert.equal(b.body[0].text, long);
});

test('blocs : listes (checklist), listes numérotées, continuation indentée, liste aérée', () => {
  const [ul, ol] = parseMessage('- premier point\n  suite du premier\n- deuxième\n\n- troisième\n\n1. un\n2) deux');
  assert.equal(ul.type, 'ul');
  assert.deepEqual(ul.items, ['premier point suite du premier', 'deuxième', 'troisième']);
  assert.deepEqual([ol.type, ol.items], ['ol', ['un', 'deux']]);
  assert.deepEqual(parseMessage('* a\n• b')[0].items, ['a', 'b']);
});

test('blocs : séparateurs de section (## titre, [SECTION], ---) et paragraphes', () => {
  const blocks = parseMessage('Intro sur\ndeux lignes.\n\n## Deuxième thème\nTexte.\n[SECTION] Troisième\n---\nFin');
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'section', 'p', 'section', 'hr', 'p']);
  assert.equal(blocks[0].text, 'Intro sur\ndeux lignes.');
  assert.deepEqual([blocks[1].title, blocks[3].title], ['Deuxième thème', 'Troisième']);
});

test('robustesse : texte vide, balise sans contenu, flux partiel (streaming), retours chariot Windows', () => {
  assert.deepEqual(parseMessage(''), []);
  assert.deepEqual(parseMessage('\n\n'), []);
  assert.deepEqual(parseMessage('[CONCEPT]'), [{ type: 'concept', title: '', body: [] }]);
  assert.deepEqual(parseMessage('[CONC')[0], { type: 'p', text: '[CONC' }); // balise pas encore complète : texte brut
  assert.equal(parseMessage('[CONCEPT] A\r\nB\r\n\r\nC').length, 2);
  assert.equal(parseMessage('Texte avec **gras non fermé')[0].type, 'p');
});

test('un message ordinaire (sans balises) reste lisible : paragraphes et tirets', () => {
  const blocks = parseMessage('Voici l\'idée.\n\nPoints importants :\n- A\n- B\n\nDes questions ?');
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'p', 'ul', 'p']);
});

test('format fermé : [CONCEPT: Titre] … [/CONCEPT], [ANALOGIE] … [/ANALOGIE], lignes vides tolérées dans le bloc', () => {
  const bl = parseMessage('📖 **Les agents**\n\n[CONCEPT: Agent IA]\nUn agent **planifie**.\n\n- étape 1\n- étape 2\n[/CONCEPT]\n\n[ANALOGIE]\nUn chef d\'orchestre.\n[/ANALOGIE]\n\nSuite du cours.');
  assert.deepEqual(bl.map((b) => b.type), ['phase', 'concept', 'analogy', 'p']);
  assert.deepEqual([bl[0].kind, bl[0].title], ['course', 'Les agents']);
  assert.equal(bl[1].title, 'Agent IA');
  assert.deepEqual(bl[1].body.map((x) => x.type), ['p', 'ul']);
  assert.equal(bl[2].title, ''); assert.equal(bl[2].body[0].text, 'Un chef d\'orchestre.');
  assert.equal(bl[3].text, 'Suite du cours.');
});

test('format fermé : phase vérification, fermeture orpheline ignorée, ouvert sans fermeture = ancien comportement', () => {
  const [v, p] = parseMessage('❓ **Vérifions ta compréhension**\n[/CONCEPT]\nQuestion 1 ?');
  assert.deepEqual([v.type, v.kind, v.title, p.type], ['phase', 'check', 'Vérifions ta compréhension', 'p']);
  const bl = parseMessage('[CONCEPT: Titre]\nCorps.\n\nAutre paragraphe.');
  assert.deepEqual(bl.map((b) => b.type), ['concept', 'p'], 'sans fermeture le bloc s\'arrête à la ligne vide');
});

test('streaming : bloc ouvert rendu en cours de route, balise incomplète masquée', () => {
  const open = parseMessage('[CONCEPT: Agent]\nUn agent planifie.\n\nEt agit.', { streaming: true });
  assert.deepEqual([open.length, open[0].type, open[0].body.length], [1, 'concept', 2], 'tout le bloc ouvert est dans la carte');
  for (const cut of ['[CONC', '[CONCEPT', '[CONCEPT: Ag', '[/CONC', '[ANALOG']) {
    const t = parseMessage(`Intro.\n\n${cut}`, { streaming: true });
    assert.deepEqual(t.map((b) => b.type), ['p'], `« ${cut} » masqué`);
  }
});
