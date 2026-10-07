import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDoctor } from '../src/server/doctor.js';
import { describeResponse, parseResponse, respond } from '../src/server/openai.js';
import { emptyResearch, researchInto } from '../src/server/certs/research.js';
import { searchWeb, urlsInText, verifyReachable } from '../src/server/certs/websearch.js';

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const URL_EXAM = 'https://exam.example.org/guide';
const PAGE = `<main>${'Skills measured. '.repeat(30)}<h2>Plan and manage (50%)</h2><h2>Build agents (50%)</h2></main>`;
const GOOD = 'https://learn.microsoft.com/en-us/credentials/certifications/exams/az-900/';
const GHOST = 'https://learn.microsoft.com/en-us/does-not-exist';
const BLOG = 'https://random-blog.example.com/az900';
const REDDIT = 'https://www.reddit.com/r/AzureCertification/comments/abc/az900_passed';
const usage = { input_tokens: 10, output_tokens: 5 };
const wrap = (json) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(json), annotations: [] }] }], usage });
const msg = (text, annotations = []) => ({ type: 'message', content: [{ type: 'output_text', text, annotations }] });
const sse = (...events) => new Response(new ReadableStream({
  start(c) { const e = new TextEncoder(); for (const ev of [...events, { choices: [], usage: { prompt_tokens: 20, completion_tokens: 4 } }]) c.enqueue(e.encode(`data: ${JSON.stringify(ev)}\n\n`)); c.enqueue(e.encode('data: [DONE]\n\n')); c.close(); },
}));

const searchBodies = [];
const probed = [];

/** Réponse de la recherche web (texte libre) selon le comportement simulé de l'API. */
function searchResponse(mode, filtered) {
  const call = (sources) => ({ type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'q', ...(sources ? { sources } : {}) } });
  const text = `Résultats :\n- [Page AZ-900](${GOOD}) : examen de base\n- Page inventée ${GHOST}\n- Blog ${BLOG}\n* Retour de candidat : ${REDDIT}.`;
  if (mode === 'cited') return { output: [call([{ url: GOOD }]), msg('Voir ' + GOOD)], usage };
  if (mode === 'annotated') return { output: [call(), msg('Voir ' + GOOD, [{ type: 'url_citation', url: GOOD, title: 'AZ-900' }])], usage };
  if (mode === 'reachable') return { output: [call(), msg(text)], usage };
  if (mode === 'filterOnly') return filtered ? { output: [call(), msg('Rien')], usage } : { output: [call([{ url: GOOD }]), msg('Voir ' + GOOD)], usage };
  if (mode === 'nosearch') return { output: [msg('Je ne sais pas')], usage };
  return { output: [call(), msg('Aucune URL')], usage };
}

function mock({ models = ['gpt-4.1', 'gpt-4.1-mini'], auth = true, callsTool = true, search = 'cited', pageStatus = 200 } = {}) {
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes('exam.example.org')) return pageStatus === 200 ? new Response(PAGE) : new Response('', { status: pageStatus });
    if (init?.method === 'HEAD' || init?.method === 'GET') { // sondes d'existence (probeUrl)
      probed.push(url);
      if (url.replace(/\/$/, '') === GOOD.replace(/\/$/, '')) return new Response(null, { status: 200 });
      if (url === GHOST) return new Response(null, { status: 404 });
      if (url.startsWith('https://www.reddit.com')) return new Response(null, { status: 403 });
      throw new Error(`sonde inattendue ${url}`);
    }
    if (!auth) return new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), { status: 401 });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: models.map((id) => ({ id })) }));
    if (url.endsWith('/responses')) {
      const b = JSON.parse(init.body);
      const name = b.text?.format?.name;
      if (!name) { searchBodies.push(b); return new Response(JSON.stringify(searchResponse(search, !!b.tools[0].filters))); }
      if (name === 'doctor_ok') return new Response(JSON.stringify(wrap({ ok: true })));
      if (name === 'certification_outline') return new Response(JSON.stringify(wrap({ examCode: 'X', title: 'X', lastUpdated: 'Oct 2026', domains: [{ name: 'Plan and manage', weightMin: 50, weightMax: 50, subdomains: [] }, { name: 'Build agents', weightMin: 50, weightMax: 50, subdomains: [] }] })));
      return new Response(JSON.stringify(wrap({ items: [] })));
    }
    if (url.endsWith('/chat/completions')) {
      const body = JSON.parse(init.body);
      if (body.messages.at(-1).role === 'tool') return sse({ choices: [{ delta: { content: 'ok' } }] });
      if (!callsTool) return sse({ choices: [{ delta: { content: 'ok' } }] });
      return sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'ping', arguments: '{"note":"doctor"}' } }] } }] });
    }
    throw new Error(`fetch inattendu ${url}`);
  };
}
const byId = (rs) => Object.fromEntries(rs.map((r) => [r.id, r]));

test('doctor : tout passe quand l\'API se comporte comme prévu', async () => {
  mock();
  const seen = [];
  const rs = await runDoctor({ apiKey: 'sk-test', url: URL_EXAM, dataDir: await mkdtemp(join(tmpdir(), 'coach-doc-')), onResult: (r) => seen.push(r.id) });
  assert.deepEqual(rs.map((r) => r.status), rs.map(() => 'ok'), JSON.stringify(rs.filter((r) => r.status !== 'ok')));
  assert.deepEqual(seen, ['node', 'data', 'auth', 'models', 'structured', 'stream', 'search', 'page', 'extract']);
  assert.match(byId(rs).stream.detail, /outil « ping » appelé/);
  assert.match(byId(rs).search.detail, /1 source\(s\) citée\(s\) par l'API/);
  assert.match(byId(rs).extract.detail, /2 domaine\(s\), ancrés : 2/);
});

test('doctor : l\'API ne fournit AUCUNE citation (cas réel) -> ✅ via URL vérifiées par téléchargement, jamais sur parole', async () => {
  mock({ search: 'reachable' });
  probed.length = 0;
  const rs = byId(await runDoctor({ apiKey: 'sk', url: URL_EXAM }));
  assert.equal(rs.search.status, 'ok');
  assert.match(rs.search.detail, /n'expose pas de citations → 2 URL du texte vérifiée\(s\) par téléchargement/); // GOOD + reddit bloqué-accepté ; GHOST (404) écartée
  assert.ok(probed.includes(GOOD.replace(/\/$/, '')) && probed.includes(GHOST), 'les URL candidates sont sondées');
  assert.ok(!probed.includes(BLOG), 'un domaine non fiable n\'est jamais sondé');
});

test('doctor : clé absente ou refusée -> arrêt net avec un conseil', async () => {
  mock();
  const none = await runDoctor({ apiKey: undefined });
  assert.equal(byId(none).key.status, 'fail');
  assert.match(byId(none).key.hint, /OPENAI_API_KEY/);
  mock({ auth: false });
  const bad = await runDoctor({ apiKey: 'sk-bad', url: URL_EXAM });
  assert.equal(byId(bad).auth.status, 'fail');
  assert.match(byId(bad).auth.detail, /Incorrect API key/);
  assert.equal(bad.at(-1).id, 'auth', 'aucun appel de plus après un refus de clé');
});

test('doctor : modèles absents, function calling non vérifié, recherche inexploitable -> avertissements avec diagnostic', async () => {
  mock({ models: ['autre-modele'], callsTool: false, search: 'nosearch' });
  const dir = await mkdtemp(join(tmpdir(), 'coach-doc-'));
  const rs = byId(await runDoctor({ apiKey: 'sk', url: URL_EXAM, dataDir: dir }));
  assert.equal(rs.models.status, 'warn');
  assert.match(rs.models.hint, /COACH_TEXT_MODEL/);
  assert.equal(rs.stream.status, 'warn');
  assert.match(rs.stream.detail, /function calling non vérifié/);
  assert.equal(rs.search.status, 'warn');
  assert.match(rs.search.detail, /le modèle n'a lancé aucune recherche : aucune source citée ni URL vérifiable\. Sans allowed_domains : 0 recherche\(s\), mode « none », 0 source\(s\) → le format de réponse est en cause\. Structure reçue : \[\{"type":"message"/);
  assert.ok(JSON.parse(await readFile(join(dir, 'doctor-websearch.json'), 'utf8')).output, 'réponse brute enregistrée');
});

test('doctor : isole le filtre allowed_domains quand lui seul empêche les sources', async () => {
  mock({ search: 'filterOnly' });
  const rs = byId(await runDoctor({ apiKey: 'sk', url: URL_EXAM }));
  assert.equal(rs.search.status, 'warn');
  assert.match(rs.search.detail, /Sans allowed_domains : 1 recherche\(s\), mode « cited », 1 source\(s\) → le filtre allowed_domains est en cause/);
});

test('doctor : page d\'examen illisible -> échec explicite, extraction ignorée ; options --skip ; URL locale refusée', async () => {
  mock({ pageStatus: 503 });
  const rs = byId(await runDoctor({ apiKey: 'sk', url: URL_EXAM }));
  assert.equal(rs.page.status, 'fail');
  assert.match(rs.page.detail, /HTTP 503/);
  assert.equal(rs.extract.status, 'skip');
  mock();
  const skipped = byId(await runDoctor({ apiKey: 'sk', url: URL_EXAM, skipSearch: true, skipExtract: true }));
  assert.equal(skipped.search.status, 'skip');
  assert.equal(skipped.extract.status, 'skip');
  assert.match(byId(await runDoctor({ apiKey: 'sk', url: 'http://localhost/x' })).page.detail, /https/);
});

test('recherche web : texte libre (pas de JSON strict, qui supprime les annotations), recherche forcée, URL en clair demandées', async () => {
  mock({ search: 'annotated' });
  searchBodies.length = 0;
  const r = await searchWeb('sk', { key: 'k', instructions: 'Cherche.', input: 'q', domains: ['learn.microsoft.com'] });
  const b = searchBodies[0];
  assert.equal(b.text, undefined, 'pas de sortie structurée à l\'étape de recherche');
  assert.equal(b.tool_choice, 'required');
  assert.deepEqual(b.include, ['web_search_call.action.sources']);
  assert.deepEqual(b.tools[0].filters.allowed_domains, ['learn.microsoft.com']);
  assert.match(b.instructions, /URL complète en clair/);
  assert.equal(r.mode, 'cited');
  assert.equal(r.seen.get(GOOD.replace(/\/$/, '')).verification, 'cited');
});

test('urlsInText : URL en clair + texte environnant comme titre', () => {
  const m = urlsInText('Voici :\n- [Page AZ-900](https://learn.microsoft.com/a) : base\n* Guide complet pour débutants https://learn.microsoft.com/b.\n"https://www.reddit.com/r/x/c", puis (https://github.com/o/r).');
  assert.deepEqual([...m.keys()], ['https://learn.microsoft.com/a', 'https://learn.microsoft.com/b', 'https://www.reddit.com/r/x/c', 'https://github.com/o/r']);
  assert.equal(m.get('https://learn.microsoft.com/a').title, 'Page AZ-900');
  assert.match(m.get('https://learn.microsoft.com/b').title, /^Guide complet pour débutants$/);
});

test('verifyReachable : 404/injoignable écartés, bots acceptés seulement sur les sites connus, domaines non fiables jamais sondés', async () => {
  const status = { 'https://learn.microsoft.com/ok': 200, 'https://learn.microsoft.com/gone': 404, 'https://learn.microsoft.com/blocked': 403, 'https://www.reddit.com/r/x': 429, 'https://learn.microsoft.com/down': 'throw' };
  const probe = async (u) => { if (status[u] === 'throw') throw new Error('dns'); return status[u]; };
  const probed2 = [];
  const cands = new Map(Object.keys(status).concat(BLOG).map((u) => [u, { title: '' }]));
  const out = await verifyReachable(cands, { probe: async (u) => { probed2.push(u); return probe(u); } });
  assert.deepEqual([...out].map(([u, m]) => [u, m.verification]), [['https://learn.microsoft.com/ok', 'reachable'], ['https://www.reddit.com/r/x', 'blocked']]);
  assert.ok(!probed2.includes(BLOG));
});

test('parseResponse : sources lues partout où l\'API peut les mettre ; texte libre', () => {
  const data = { output: [
    { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'q', sources: [{ type: 'url', url: 'https://learn.microsoft.com/a?utm_source=openai', title: 'A' }] } },
    { type: 'web_search_call', action: { type: 'open_page', url: 'https://learn.microsoft.com/b' } },
    { type: 'web_search_call', results: [{ source_url: 'https://www.reddit.com/r/x/c' }, { url: 'ftp://nope.example/x' }] },
    msg('{"items":[]}', [{ type: 'url_citation', url: 'https://github.com/MicrosoftLearning/lab#readme', title: 'Lab' }, { type: 'autre', uri: 'https://www.whizlabs.com/free' }, { type: 'file_citation', file_id: 'f' }]),
  ] };
  const r = parseResponse(data);
  assert.deepEqual([...r.citations.keys()].sort(), ['https://github.com/MicrosoftLearning/lab', 'https://learn.microsoft.com/a', 'https://learn.microsoft.com/b', 'https://www.reddit.com/r/x/c', 'https://www.whizlabs.com/free']);
  assert.equal(r.searches, 3);
  assert.equal(r.raw, data);
  const free = parseResponse({ output: [msg('du texte libre, pas du JSON')] }, { expectJson: false });
  assert.deepEqual([free.text, free.json], ['du texte libre, pas du JSON', null]);
  assert.throws(() => parseResponse({ output: [msg('pas du json')] }), /JSON invalide/);
});

test('describeResponse : structure sans contenu (rapport de bug)', () => {
  const data = { output: [{ type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'secret-query' } }, msg('{"items":[]}')] };
  const shape = describeResponse(data);
  assert.deepEqual(shape[0].action, { type: 'search', keys: ['type', 'query'], sources: null });
  assert.deepEqual(shape[1].content, [{ type: 'output_text', textLength: 12, annotations: {} }]);
  assert.ok(!JSON.stringify(shape).includes('secret-query'));
});

test('recherche des cursus : 2 temps (recherche libre puis structuration sans outil) ; sans source, pas de 2e appel et erreur consignée', async () => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    return new Response(JSON.stringify(b.text ? wrap({ items: [{ title: 'Page', url: GOOD, provider: 'MS', free: true, questionCount: null, note: '' }] }) : searchResponse('annotated')));
  };
  const cert = { name: 'X', examCode: 'X-1', officialHosts: ['exam.example.org'] };
  const ok = await researchInto(emptyResearch(), 'sk', ['qcm'], cert);
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].tool_choice === 'required' && !bodies[0].text && bodies[0].tools[0].filters.allowed_domains.includes('exam.example.org'));
  assert.ok(!bodies[1].tools && bodies[1].text.format.name === 'research_qcm', 'structuration sans outil');
  assert.match(bodies[1].input, new RegExp(GOOD.replace(/\//g, '\\/').replace(/\./g, '\\.')), 'seules les URL vues sont fournies');
  assert.deepEqual(ok.qcm.items.map((i) => [i.url, i.verification]), [[GOOD.replace(/\/$/, ''), 'cited']]);

  bodies.length = 0;
  globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify(searchResponse('none'))); };
  const none = await researchInto(emptyResearch(), 'sk', ['tips'], cert);
  assert.equal(bodies.length, 1, 'pas de structuration sans source');
  assert.deepEqual(none.tips.items, []);
  assert.match(none.errors.tips, /aucune source vérifiable/);
});

test('respond : tool_choice refusé par l\'API -> nouvel essai sans, jamais d\'échec pour ça', async () => {
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    if (b.tool_choice) return new Response(JSON.stringify({ error: { message: "Invalid value for 'tool_choice'" } }), { status: 400 });
    return new Response(JSON.stringify(wrap({ items: [] })));
  };
  const r = await respond('sk', { model: 'm', input: 'x', tools: [{ type: 'web_search' }], toolChoice: 'required', schema: { type: 'object' } });
  assert.deepEqual(r.json, { items: [] });
  assert.deepEqual(bodies.map((b) => b.tool_choice), ['required', undefined]);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad schema' } }), { status: 400 });
  await assert.rejects(() => respond('sk', { model: 'm', input: 'x', toolChoice: 'required', schema: {} }), /bad schema/);
});
