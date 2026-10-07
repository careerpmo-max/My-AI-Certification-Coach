import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse } from '../src/server/openai.js';
import { htmlToText } from '../src/server/html.js';
import { normalizeUrl, tierOf } from '../src/server/certs/sources.js';
import { scoreConfidence } from '../src/server/certs/debrief.js';

const realFetch = globalThis.fetch;
const cert = { name: 'Azure AI Apps and Agents', examCode: 'AI-103', officialHosts: [] };

const PAGE = `<html><body><nav>menu</nav><main><h1>Study guide for Exam AI-103</h1>
<p>Last updated: September 2026 ${'Skills measured. '.repeat(20)}</p>
<h2>Plan and manage an Azure AI solution (25–30%)</h2><li>Select the appropriate services</li>
<h2>Implement generative AI and agents (35–40%)</h2><li>Build agents</li>
<h2>Implement retrieval and search (30–35%)</h2><li>Configure indexes</li></main></body></html>`;

const OUTLINE = { examCode: 'AI-103', title: 'AI-103', lastUpdated: 'September 2026', domains: [
  { name: 'Plan and manage an Azure AI solution', weightMin: 25, weightMax: 30, subdomains: ['Select the appropriate services'] },
  { name: 'Implement generative AI and agents', weightMin: 35, weightMax: 40, subdomains: ['Build agents'] },
  { name: 'Implement retrieval and search', weightMin: 30, weightMax: 35, subdomains: ['Configure indexes'] },
] };

const U = {
  pa: 'https://learn.microsoft.com/en-us/credentials/certifications/exams/ai-103/practice-assessment',
  wl: 'https://www.whizlabs.com/free-test/ai-103',
  dump: 'https://www.examtopics.com/exams/microsoft/ai-103/',
  blog: 'https://random-blog.example.com/ai-103',
  ghost: 'https://learn.microsoft.com/invented-page',
  lab: 'https://github.com/MicrosoftLearning/mslearn-ai-agents',
  rd1: 'https://www.reddit.com/r/AzureCertification/comments/abc/ai103_passed',
  rd2: 'https://www.reddit.com/r/AzureCertification/comments/def/ai103_tips',
};

/** Simule Responses API : renvoie une charge utile selon le schemaName. */
// URL « vues » par la recherche (citations de l'API) pour chaque catégorie : étape 1 = recherche en texte libre, étape 2 = structuration
const CITED = {
  qcm: [U.pa, U.wl, U.dump, U.blog, U.pa + '?paid'],
  resources: [U.lab, U.pa, 'https://learn.microsoft.com/azure/ai-foundry/'],
  tips: [U.rd1, U.rd2, U.blog, U.pa],
};

function responsesMock(body) {
  if (!body.text) { // recherche web en texte libre : sources dans les annotations url_citation
    const cat = /QCM/.test(body.input) ? 'qcm' : /ressources/.test(body.input) ? 'resources' : 'tips';
    const annotations = CITED[cat].map((url) => ({ type: 'url_citation', url: `${url}?utm_source=openai`, title: 'page' }));
    return { output: [{ type: 'web_search_call', action: { type: 'search' } }, { type: 'message', content: [{ type: 'output_text', text: `Résultats pour ${cat}`, annotations }] }] };
  }
  const name = body.text.format.name;
  const wrap = (json) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(json), annotations: [] }] }] });
  if (name === 'certification_outline') return wrap(OUTLINE);
  if (name === 'research_qcm') return wrap({ items: [
    { title: 'Practice Assessment', url: U.pa, provider: 'Microsoft Learn', free: true, questionCount: 50, note: '' },
    { title: 'Free test', url: U.wl, provider: 'Whizlabs', free: true, questionCount: 15, note: '' },
    { title: 'Dumps', url: U.dump, provider: 'Examtopics', free: true, questionCount: 500, note: '' },
    { title: 'Blog', url: U.blog, provider: 'Blog', free: true, questionCount: null, note: '' },
    { title: 'Inventée', url: U.ghost, provider: 'MS', free: true, questionCount: null, note: '' },
    { title: 'Payant', url: U.pa + '?paid', provider: 'MS', free: false, questionCount: null, note: '' },
  ] });
  if (name === 'research_resources') return wrap({ items: [
    { title: 'Labs agents', url: U.lab, kind: 'lab', covers: 'agents', note: '' },
    { title: 'Practice again', url: U.pa, kind: 'learning_path', covers: 'général', note: '' },
    { title: 'Docs', url: 'https://learn.microsoft.com/azure/ai-foundry/', kind: 'docs', covers: 'Foundry', note: '' },
  ] });
  if (name === 'research_tips') return wrap({ items: [
    { tip: 'Beaucoup de questions sur les agents', type: 'overweighted', domainHint: 'agents', sources: [U.rd1], date: '2026-09' },
    { tip: 'Piège sur les index vectoriels', type: 'pitfall', domainHint: null, sources: [U.rd2, U.blog], date: null },
    { tip: 'Tip sans source valide', type: 'strategy', domainHint: null, sources: [U.blog], date: null },
    { tip: 'Lire les études de cas en premier', type: 'strategy', domainHint: null, sources: [U.pa], date: null },
  ] });
  throw new Error(`schéma inattendu ${name}`);
}

function mockNetwork({ pageStatus = 200 } = {}) {
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('http://127.0.0.1')) return realFetch(url, init);
    if (url.includes('study-guides')) return pageStatus === 200 ? new Response(PAGE) : new Response('', { status: pageStatus });
    if (url.endsWith('/models')) return new Response('{"data":[]}');
    if (url.endsWith('/responses')) return new Response(JSON.stringify(responsesMock(JSON.parse(init.body))));
    throw new Error(`fetch inattendu ${url}`);
  };
}
after(() => { globalThis.fetch = realFetch; });

test('sources : tiers, exclusions, normalisation', () => {
  assert.equal(tierOf('https://learn.microsoft.com/x'), 'official');
  assert.equal(tierOf('https://www.reddit.com/r/x'), 'recognized');
  assert.equal(tierOf('https://www.examtopics.com/x'), null);
  assert.equal(tierOf('https://evil-learn.microsoft.com.attacker.io/'), null);
  assert.equal(normalizeUrl('https://Learn.microsoft.com/a/?utm_source=openai&x=1#f'), 'https://learn.microsoft.com/a/?x=1');
});

test('htmlToText garde le contenu de <main>', () => {
  const t = htmlToText(PAGE);
  assert.match(t, /Plan and manage/);
  assert.doesNotMatch(t, /menu/);
});

test('parseResponse : citations + sources de recherche', () => {
  const r = parseResponse({ output: [
    { type: 'web_search_call', action: { sources: [{ url: 'https://a.com/x?utm_source=openai' }] } },
    { type: 'message', content: [{ type: 'output_text', text: '{"k":1}', annotations: [{ type: 'url_citation', url: 'https://b.com/', title: 'B' }] }] },
  ] });
  assert.deepEqual(r.json, { k: 1 });
  assert.deepEqual([...r.citations.keys()].sort(), ['https://a.com/x', 'https://b.com']);
});

test('scoreConfidence est déterministe', () => {
  const empty = { items: [], dropped: 0 };
  const c = scoreConfidence({ official: { status: 'failed', warnings: [] }, research: { qcm: empty, resources: empty, tips: empty } });
  assert.equal(c.score, 0);
  assert.equal(c.level, 'faible');
});


test('extractOutline : domaine halluciné détecté (ancrage) et pondérations incohérentes signalées', async () => {
  mockNetwork();
  OUTLINE.domains.push({ name: 'Domaine imaginaire', weightMin: 40, weightMax: 40, subdomains: [] });
  const { extractOutline } = await import('../src/server/certs/official.js');
  const o = await extractOutline('sk-good', cert, htmlToText(PAGE), { url: 'https://x.example/' });
  OUTLINE.domains.pop();
  assert.equal(o.status, 'partial');
  assert.equal(o.domains.at(-1).grounded, false);
  assert.ok(o.warnings.some((w) => /pondérations incohérentes/.test(w)));
});

test('recherche : filtrage des sources (fiables + vues par la recherche), hôte officiel de l\'URL fournie', async () => {
  mockNetwork();
  const { researchInto, emptyResearch } = await import('../src/server/certs/research.js');
  const r = await researchInto(emptyResearch(), 'sk-good', ['qcm', 'resources', 'tips'], { ...cert, officialHosts: ['learn.microsoft.com'] });
  assert.deepEqual(r.qcm.items.map((i) => i.url), [normalizeUrl(U.pa), normalizeUrl(U.wl)]);
  assert.equal(r.qcm.dropped, 4); // dump, blog, page inventée, payant
  const tips = r.tips.items;
  assert.equal(tips.length, 3);
  assert.deepEqual(tips[1].sources.map((s) => s.url), [normalizeUrl(U.rd2)]); // blog retiré de la liste
  const { scoreConfidence, buildDebrief } = await import('../src/server/certs/debrief.js');
  const official = { status: 'ok', warnings: [], lastUpdated: 'September 2026', weightsConsistent: true, url: 'https://x/', fetchedAt: new Date().toISOString(), domains: [] };
  const conf = scoreConfidence({ official, research: r });
  assert.equal(conf.level, 'élevée');
  const debrief = buildDebrief({ name: 'Ada', cert, official, research: r, confidence: conf });
  for (const url of [U.pa, U.wl, U.lab, U.rd1]) assert.ok(debrief.includes(url), `débrief cite ${url}`);
  assert.doesNotMatch(debrief, /random-blog|invented-page|examtopics\.com\/exams/);
});

test('un hôte officiel fourni par l\'utilisateur est de niveau « official »', () => {
  assert.equal(tierOf('https://docs.aws.amazon.com/x'), null);
  assert.equal(tierOf('https://docs.aws.amazon.com/x', ['docs.aws.amazon.com']), 'official');
  assert.equal(tierOf('https://www.examtopics.com/x', ['examtopics.com']), null); // les dumps restent exclus
});
