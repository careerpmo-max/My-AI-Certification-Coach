import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/server/storage.js';
import { createApp } from '../src/server/app.js';
import { computeProgress } from '../src/server/coach/progress.js';
import { scoreAssessment } from '../src/server/coach/assessment.js';
import { fallbackPlan, planContext, totalHours, validatePlan, withRecapQuizzes } from '../src/server/coach/planner.js';
import { SPOKEN_ADDENDUM, systemPrompt } from '../src/server/coach/persona.js';
import { applyTool, phaseProgress } from '../src/server/coach/tools.js';
import { LANGUAGES } from '../src/server/coach/language.js';
import { quizGaps, scoreQuiz, validQuestion } from '../src/server/coach/quiz.js';
import { estimateCost, groupOf, mergeUsage } from '../src/server/usage.js';

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const D = (id, name, min, max, subdomains = []) => ({ id, name, weightMin: min, weightMax: max, subdomains, grounded: true });
const DOMAINS = [D('d1', 'Plan and manage', 25, 30, ['a', 'b', 'c', 'd']), D('d2', 'Generative AI and agents', 35, 40, ['e']), D('d3', 'Retrieval and search', 30, 35)];
const QUESTIONS = DOMAINS.map((d) => ({ domainId: d.id, question: `Q ${d.name}`, options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: `Voir ${d.name}` }));

test('scoreAssessment : mélange QCM/auto-évaluation et détection de surconfiance', () => {
  const { levels, gaps } = scoreAssessment(DOMAINS, QUESTIONS, [
    { domainId: 'd1', choice: 1, self: 5 },   // 1.0
    { domainId: 'd2', choice: 0, self: 5 },   // 0.4 -> lacune + surconfiance
    { domainId: 'd3', choice: 1, self: 1 },   // 0.6
  ]);
  assert.equal(levels.d1.score, 1);
  assert.equal(levels.d2.score, 0.4);
  assert.equal(levels.d3.score, 0.6);
  assert.deepEqual(gaps.map((g) => g.domainId), ['d2']);
  assert.match(gaps[0].note, /Auto-évaluation élevée/);
});

test('scoreAssessment : sans QCM, auto-évaluation seule', () => {
  const { levels, gaps } = scoreAssessment(DOMAINS, [], [{ domainId: 'd1', self: 1 }]);
  assert.equal(levels.d1.score, 0);
  assert.equal(levels.d2.score, 0); // réponse absente -> 1/5
  assert.equal(gaps.length, 3);
});

test('totalHours : date d\'examen ou 6 semaines par défaut, borné', () => {
  const now = Date.parse('2026-09-30');
  assert.deepEqual(totalHours({ hoursPerWeek: 5 }, now), { hours: 30, weeks: 6, hoursPerWeek: 5 });
  assert.equal(totalHours({ hoursPerWeek: 10, examDate: '2026-10-28' }, now).weeks, 4);
  assert.equal(totalHours({ hoursPerWeek: 999, examDate: '2030-01-01' }, now).hours, 200);
});

test('fallbackPlan : couvre tous les domaines, heures ∝ besoin, valide', () => {
  const levels = { d1: { score: 1 }, d2: { score: 0 }, d3: { score: 0.5 } };
  const plan = fallbackPlan(DOMAINS, levels, { hours: 40 });
  assert.equal(validatePlan(plan, DOMAINS), null);
  const lessons = plan.modules.filter((m) => m.kind === 'lesson');
  const h = (id) => lessons.filter((m) => m.domainId === id).reduce((a, m) => a + m.hours, 0);
  assert.ok(h('d2') > h('d3') && h('d3') > h('d1'));
  assert.ok(Math.abs(lessons.reduce((a, m) => a + m.hours, 0) - 40) < 1);
  assert.equal(plan.modules.filter((m) => m.kind === 'quiz').length, 3); // un QCM récap par bloc
  assert.equal(lessons.filter((m) => m.domainId === 'd1').length, 2); // 4 sous-domaines -> 2 groupes
  assert.ok(plan.modules.every((m) => m.status === 'todo'));
});

test('validatePlan rejette domaine inconnu ou non couvert', () => {
  const mk = (domainId) => ({ modules: [1, 2, 3].map(() => ({ domainId, hours: 1, objectives: ['x'] })) });
  assert.match(validatePlan(mk('zzz'), DOMAINS), /invalide/);
  assert.match(validatePlan(mk('d1'), DOMAINS), /non couvert/);
});

test('computeProgress : pondéré par domaine', () => {
  const c = { discovery: { official: { domains: DOMAINS } }, plan: { modules: [
    { domainId: 'd1', hours: 2, status: 'done' }, { domainId: 'd1', hours: 2, status: 'todo' },
    { domainId: 'd2', hours: 4, status: 'done' }, { domainId: 'd3', hours: 4, status: 'todo' },
  ] } };
  const p = computeProgress(c);
  assert.deepEqual(p.byDomain.map((d) => d.percent), [50, 100, 0]);
  assert.equal(p.global, Math.round((27.5 * 50 + 37.5 * 100) / 97.5));
  assert.equal(computeProgress({}).global, 0);
});

test('applyTool : valide les identifiants et ne modifie rien sur erreur', () => {
  const c = { discovery: { official: { domains: DOMAINS } }, plan: { modules: [{ id: 'm1', status: 'todo' }] } };
  assert.equal(applyTool(c, 'set_module_status', { moduleId: 'm1', status: 'done' }).curriculum.plan.modules[0].status, 'done');
  assert.equal(applyTool(c, 'set_module_status', { moduleId: 'm9', status: 'done' }).result.error, 'module inconnu');
  assert.equal(applyTool(c, 'set_module_status', { moduleId: 'm1', status: 'fait' }).curriculum, c);
  assert.equal(applyTool(c, 'record_gap', { domainId: 'dx', note: 'n' }).result.error, 'domaine inconnu');
  assert.equal(applyTool(c, 'record_gap', { domainId: 'd1', note: 'n' }).curriculum.gaps.length, 1);
  assert.equal(applyTool(c, 'save_cursor', { moduleId: 'm1', summary: 's' }).curriculum.cursor.summary, 's');
  assert.equal(applyTool(c, 'nope', {}).result.error, 'outil inconnu');
});


test('withRecapQuizzes : un QCM récap après le dernier module de chaque bloc, idempotent', () => {
  const lessons = [
    { id: 'm1', kind: 'lesson', domainId: 'd2', title: 'A', objectives: ['x'], hours: 1 },
    { id: 'm2', kind: 'lesson', domainId: 'd1', title: 'B', objectives: ['y'], hours: 1 },
    { id: 'm3', kind: 'lesson', domainId: 'd2', title: 'C', objectives: ['z'], hours: 1 },
  ];
  const out = withRecapQuizzes(lessons, DOMAINS);
  assert.deepEqual(out.map((m) => m.id), ['m1', 'm2', 'q-d1', 'm3', 'q-d2']);
  const q = out.find((m) => m.id === 'q-d2');
  assert.equal(q.kind, 'quiz');
  assert.deepEqual(q.objectives, ['A', 'x', 'C', 'z']);
  assert.equal(withRecapQuizzes(out, DOMAINS).length, out.length);
});

test('outils : un QCM récap ne se valide pas par le coach ; avancement partiel', () => {
  const c = { plan: { modules: [{ id: 'm1', kind: 'lesson', status: 'todo', progress: 0 }, { id: 'q-d1', kind: 'quiz', status: 'todo', progress: 0 }] } };
  assert.match(applyTool(c, 'set_module_status', { moduleId: 'q-d1', status: 'done' }).result.error, /quiz/);
  const p = applyTool(c, 'set_module_status', { moduleId: 'm1', status: 'in_progress', percent: 60 }).curriculum.plan.modules[0];
  assert.deepEqual([p.status, p.progress], ['in_progress', 60]);
  assert.equal(applyTool(c, 'set_module_status', { moduleId: 'm1', status: 'in_progress', percent: 500 }).curriculum.plan.modules[0].progress, 99);
  assert.equal(applyTool(c, 'set_module_status', { moduleId: 'm1', status: 'done' }).curriculum.plan.modules[0].progress, 100);
});

test('progression : avancement partiel des modules compté au prorata des heures', () => {
  const c = { discovery: { official: { domains: [DOMAINS[0]] } }, plan: { modules: [{ domainId: 'd1', hours: 4, status: 'in_progress', progress: 50 }, { domainId: 'd1', hours: 4, status: 'todo' }] } };
  assert.equal(computeProgress(c).byDomain[0].percent, 25);
});

test('storage : update sans retour n\'écrit rien ; remove', async () => {
  const s = new JsonStore(await mkdtemp(join(tmpdir(), 'coach-st-')));
  assert.equal(await s.update('ghost', () => undefined), null);
  assert.equal(await s.get('ghost'), null);
  await s.set('k', { a: 1 });
  await s.remove('k');
  await s.remove('k');
  assert.equal(await s.get('k'), null);
});

test('assertPublicHttps : https public uniquement', async () => {
  const { assertPublicHttps } = await import('../src/server/certs/url.js');
  assert.equal(assertPublicHttps('https://learn.microsoft.com/x'), 'https://learn.microsoft.com/x');
  for (const bad of ['http://learn.microsoft.com', 'https://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://192.168.1.2/', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://intranet/x', 'https://a.local/', 'https://u:p@example.com/', 'file:///etc/passwd', 'pas une url']) {
    assert.throws(() => assertPublicHttps(bad), undefined, bad);
  }
});

test('quiz : validation, correction exacte des choix multiples, lacunes dédupliquées', () => {
  assert.equal(validQuestion({ type: 'single', options: ['a', 'b', 'c', 'd'], correctIndices: [0, 1] }), false);
  assert.equal(validQuestion({ type: 'multiple', options: ['a', 'b', 'c', 'd'], correctIndices: [0] }), false);
  assert.equal(validQuestion({ type: 'multiple', options: ['a', 'b', 'c', 'd'], correctIndices: [0, 9] }), false);
  assert.equal(validQuestion({ type: 'multiple', options: ['a', 'b', 'c', 'd', 'e'], correctIndices: [0, 3] }), true);
  const qs = [{ type: 'single', question: 'Q', options: [], correctIndices: [1], explanation: 'x' }, { type: 'multiple', question: 'M', options: [], correctIndices: [0, 3], explanation: 'y' }];
  const r = scoreQuiz(qs, [[1], [3]]); // multiple partiel -> faux
  assert.deepEqual(r.results.map((x) => x.correct), [true, false]);
  assert.equal(r.score, 0.5);
  assert.equal(r.passed, false);
  assert.equal(scoreQuiz(qs, [[1], [3, 0, 3]]).passed, true); // doublons ignorés
  const mod = { title: 'Mod', domainId: 'd1' };
  const g = quizGaps(mod, qs, r.results);
  assert.equal(g.length, 1);
  assert.equal(quizGaps(mod, qs, r.results, g).length, 0);
});

test('usage : regroupement, cumul et coût indicatif', () => {
  assert.equal(groupOf('research_tips'), 'startup');
  assert.equal(groupOf('certification_outline'), 'startup');
  assert.equal(groupOf('quiz_module'), 'quiz');
  const u = mergeUsage(null, [{ label: 'research_qcm', model: 'gpt-4.1', input: 1e6, output: 0, searches: 1 }, { label: 'chat', model: 'gpt-4.1-mini', input: 1e6, output: 1e6 }]);
  assert.equal(u.calls, 2);
  assert.equal(u.byGroup.startup.searches, 1);
  assert.ok(Math.abs(estimateCost(u) - (0.01 + 2 + 0.4 + 1.6)) < 1e-9);
  assert.equal(estimateCost(mergeUsage(null, [{ label: 'chat', model: 'modele-inconnu', input: 1, output: 1 }])), null);
});


// ---------- intégration : création (pipeline) -> plan initial -> diagnostic -> chat avec outils -> reprise ----------
const OFFICIAL_URL = 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103';
const PAGE = `<main><h1>Study guide</h1><p>Last updated: September 2026 ${'Skills measured. '.repeat(20)}</p>${DOMAINS.map((d) => `<h2>${d.name} (${d.weightMin}–${d.weightMax}%)</h2>`).join('')}</main>`;
const wrap = (json) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(json), annotations: [] }] }], usage: { input_tokens: 100, output_tokens: 50 } });
const sse = (...events) => new Response(new ReadableStream({
  start(c) { const e = new TextEncoder(); for (const ev of [...events, { choices: [], usage: { prompt_tokens: 200, completion_tokens: 20 } }]) c.enqueue(e.encode(`data: ${JSON.stringify(ev)}\n\n`)); c.enqueue(e.encode('data: [DONE]\n\n')); c.close(); },
}));
const seenChat = [];
const seenResponses = [];

function mockNetwork({ badPlan = false, pageStatus = 200 } = {}) {
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith('http://127.0.0.1')) return realFetch(url, init);
    if (url.includes('study-guides')) return pageStatus === 200 ? new Response(PAGE) : new Response('', { status: pageStatus });
    if (url === 'https://docs.example.org/annex') return new Response(`<main>${'Annexe utile. '.repeat(30)}</main>`);
    if (url.endsWith('/models')) return new Response('{"data":[]}');
    if (url.endsWith('/responses')) {
      const reqBody = JSON.parse(init.body);
      const name = reqBody.text?.format?.name ?? 'research_search'; // sans format : recherche web en texte libre
      seenResponses.push({ name, instructions: reqBody.instructions ?? '' });
      if (name === 'certification_outline') return new Response(JSON.stringify(wrap({ examCode: 'AI-103', title: 'Azure AI Apps and Agents', lastUpdated: 'September 2026', domains: DOMAINS.map(({ grounded, ...d }) => ({ ...d, subdomains: [] })) })));
      if (name === 'research_search') return new Response(JSON.stringify({ output: [{ type: 'web_search_call', action: { type: 'search' } }, { type: 'message', content: [{ type: 'output_text', text: 'Aucun résultat exploitable', annotations: [] }] }], usage: { input_tokens: 100, output_tokens: 50 } }));
      if (name.startsWith('research_')) return new Response(JSON.stringify(wrap({ items: [] })));
      if (name === 'diagnostic') return new Response(JSON.stringify(wrap({ questions: [...QUESTIONS, { domainId: 'zzz', question: 'x', options: ['a', 'b'], correctIndex: 0, explanation: '' }] })));
      if (name === 'quiz_module') return new Response(JSON.stringify(wrap({ questions: [
        { type: 'single', question: 'Q1 ?', options: ['a', 'b', 'c', 'd'], correctIndices: [1], explanation: 'E1' },
        { type: 'multiple', question: 'Q2 ? (Sélectionnez 2)', options: ['a', 'b', 'c', 'd', 'e'], correctIndices: [0, 3], explanation: 'E2' },
        { type: 'single', question: 'Q3 ?', options: ['a', 'b', 'c', 'd'], correctIndices: [2], explanation: 'E3' },
        { type: 'single', question: 'invalide', options: ['a', 'b', 'c', 'd'], correctIndices: [0, 1], explanation: '' },
      ] })));
      if (name === 'study_plan') {
        const modules = badPlan ? [{ title: 'seul', domainId: 'd1', objectives: ['x'], hours: 5, rationale: '' }]
          : DOMAINS.map((d) => ({ title: `Module ${d.name}`, domainId: d.id, objectives: ['obj'], hours: 10, rationale: 'r' }));
        return new Response(JSON.stringify(wrap({ overview: 'Vue d\'ensemble', modules })));
      }
    }
    if (url.endsWith('/chat/completions')) {
      const body = JSON.parse(init.body);
      seenChat.push(body);
      const last = body.messages.at(-1);
      if (last.role === 'tool') return sse({ choices: [{ delta: { content: 'Bravo, module validé.' } }] });
      if (body.tools && last.content.includes('COVER')) {
        return sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c8', function: { name: 'save_cursor', arguments: '{"moduleId":"m1","summary":"1 objectif expliqué","phase":"course","covered":1}' } }] } }] });
      }
      if (last.content.includes('LONG')) return sse({ choices: [{ delta: { content: 'Explication détaillée. '.repeat(25) } }] });
      if (body.tools && last.content.includes('VERIF')) {
        return sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: 'save_cursor', arguments: '{"moduleId":"m1","summary":"3 questions posées","phase":"check"}' } }] } }] });
      }
      if (body.tools && last.content.includes('TERMINÉ')) {
        return sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'set_module_status', arguments: '{"moduleId":"m1",' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"status":"in_progress","percent":60}' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'save_cursor', arguments: '{"moduleId":"m2","summary":"Début du module 2"}' } }] } }] });
      }
      return sse({ choices: [{ delta: { content: 'ok' } }] });
    }
    throw new Error(`fetch inattendu ${url}`);
  };
}

async function boot({ waitCreation = true, annexLinks = [], language, persona } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'coach-plan-'));
  const logs = [];
  const server = createApp({ store: new JsonStore(dir), dataDir: dir, log: (m) => logs.push(m) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, body, headers = {}) => {
    const r = await realFetch(base + path, body ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) } : { headers });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() };
  };
  await api('/api/onboarding', { name: 'Ada', apiKey: 'sk', ...(persona ? { persona } : {}) });
  const created = await api('/api/curricula', { name: 'Prépa AI-103 Oct 2026', officialUrl: OFFICIAL_URL, annexLinks, ...(language ? { language } : {}) });
  const id = created.body.curriculum?.id;
  const waitFor = async (pred) => {
    let v;
    for (let i = 0; i < 300; i++) {
      v = (await api(`/api/creation?curriculumId=${id}`)).body;
      if (pred(v)) return v;
      await new Promise((r) => setTimeout(r, 20));
    }
    return v;
  };
  if (waitCreation) await waitFor((v) => v.status !== 'running');
  return { server, api, id, dir, base, waitFor, created, logs };
}

const answers = [{ domainId: 'd1', choice: 1, self: 5 }, { domainId: 'd2', choice: 0, self: 5 }, { domainId: 'd3', choice: 1, self: 2 }];
const chatOnce = async (api, id, message) => (await api('/api/chat', { curriculumId: id, message })).body;

test('création : 5 étapes dans l\'ordre, plan initial avec QCM récap par bloc, débrief', async () => {
  mockNetwork();
  const dir = await mkdtemp(join(tmpdir(), 'coach-plan-'));
  const { server, api, id, waitFor } = await boot({ waitCreation: false, annexLinks: ['https://docs.example.org/annex'] });
  try {
    const seen = [];
    let v;
    for (let i = 0; i < 300; i++) {
      v = (await api(`/api/creation?curriculumId=${id}`)).body;
      const label = `${v.percent}:${v.steps.map((s) => s.state[0]).join('')}`;
      if (seen.at(-1) !== label) seen.push(label);
      if (v.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(v.status, 'done');
    assert.equal(v.percent, 100);
    assert.deepEqual(v.steps.map((s) => s.key), ['fetch', 'extract', 'resources', 'qcm', 'plan']);
    assert.ok(v.steps.every((s) => s.state === 'done'));
    const percents = seen.map((l) => Number(l.split(':')[0]));
    assert.deepEqual(percents, [...percents].sort((a, b) => a - b), 'la progression ne recule jamais');

    const view = (await api(`/api/plan?curriculumId=${id}`)).body;
    assert.equal(view.phase, 'learning');
    assert.equal(view.name, 'Prépa AI-103 Oct 2026');
    assert.equal(view.certification, 'Azure AI Apps and Agents');
    assert.equal(view.plan.source, 'llm');
    assert.deepEqual(view.plan.modules.map((m) => m.id), ['m1', 'q-d1', 'm2', 'q-d2', 'm3', 'q-d3']);
    assert.equal(view.cursor.moduleId, 'm1');
    assert.deepEqual(view.domains.map((d) => d.id), ['d1', 'd2', 'd3']);
    assert.deepEqual(view.diagnostic, { done: false, available: true });

    const { messages } = (await api(`/api/session?curriculumId=${id}`)).body;
    assert.deepEqual(messages.map((m) => m.kind), ['debrief', 'plan']);
    assert.match(messages[0].content, /Liens annexes que tu as fournis/);
    assert.match(messages[0].content, /docs\.example\.org\/annex .*lu/);
  } finally { server.close(); }
});

test('création : validation du formulaire (URL https publique, annexes, nom)', async () => {
  mockNetwork();
  const { server, api } = await boot({ waitCreation: false });
  try {
    const post = (b) => api('/api/curricula', b);
    assert.equal((await post({ name: '', officialUrl: OFFICIAL_URL })).status, 400);
    assert.equal((await post({ name: 'x', officialUrl: '' })).status, 400);
    assert.equal((await post({ name: 'x', officialUrl: 'http://learn.microsoft.com/x' })).status, 400);
    assert.equal((await post({ name: 'x', officialUrl: 'https://localhost/x' })).status, 400);
    assert.match((await post({ name: 'x', officialUrl: OFFICIAL_URL, annexLinks: ['https://10.0.0.1/a'] })).body.error, /Lien annexe/);
    assert.equal((await post({ name: 'x', officialUrl: OFFICIAL_URL, annexLinks: Array.from({ length: 6 }, (_, i) => `https://a${i}.example.org/`) })).status, 400);
    assert.equal((await post({ name: 'ok', officialUrl: OFFICIAL_URL })).status, 200);
  } finally { server.close(); }
});

test('suppression d\'un cursus, y compris pendant sa création (pas de fichier fantôme)', async () => {
  mockNetwork();
  const { server, api, id, dir } = await boot({ waitCreation: false });
  try {
    await api('/api/curricula/delete', { curriculumId: id });
    assert.equal((await api(`/api/plan?curriculumId=${id}`)).status, 404);
    await new Promise((r) => setTimeout(r, 300)); // le job en cours ne doit rien recréer
    const state = (await api('/api/state')).body;
    assert.deepEqual(state.curricula, []);
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(dir, 'curricula')).catch(() => []);
    assert.deepEqual(files, []);
    assert.equal((await api('/api/curricula/delete', { curriculumId: id })).status, 404);
  } finally { server.close(); }
});

test('flux complet : diagnostic recalibre le plan, outils du coach, reprise', async () => {
  mockNetwork();
  const { server, api, id } = await boot();
  try {
    const start = (await api('/api/assessment/start', { curriculumId: id })).body;
    assert.equal(start.questions.length, 3); // la question au domaine inconnu est écartée
    assert.ok(!JSON.stringify(start).includes('correctIndex'), 'les bonnes réponses ne sont pas envoyées');

    const sub = await api('/api/assessment/submit', { curriculumId: id, answers, profile: { experience: 'avance', hoursPerWeek: 10 } });
    assert.equal(sub.status, 200);
    assert.deepEqual(sub.body.diagnostic, { done: true, available: false });
    assert.equal(sub.body.plan.modules.filter((m) => m.kind === 'quiz').length, 3);
    assert.equal(sub.body.cursor.moduleId, 'm1');
    assert.deepEqual(sub.body.gaps.map((g) => g.domainId), ['d2']);
    assert.equal((await api('/api/assessment/submit', { curriculumId: id, answers })).status, 409);
    assert.equal((await api('/api/assessment/start', { curriculumId: id })).status, 409);

    const session = (await api(`/api/session?curriculumId=${id}`)).body;
    assert.deepEqual(session.messages.map((m) => m.kind), ['debrief', 'plan', 'plan']);
    assert.equal(session.resume.moduleId, 'm1');

    // le coach appelle 2 outils (avancement 60 % sur m1, curseur sur m2)
    const chat = await chatOnce(api, id, 'Module TERMINÉ !');
    assert.match(chat, /"tool":"set_module_status"/);
    assert.match(chat, /Bravo, module validé\./);
    const view = (await api(`/api/plan?curriculumId=${id}`)).body;
    const m1 = view.plan.modules.find((m) => m.id === 'm1');
    assert.deepEqual([m1.status, m1.progress], ['in_progress', 60]);
    assert.equal(view.cursor.moduleId, 'm2');
    assert.ok(view.progress.global > 0);
    assert.deepEqual(view.diagnostic, { done: true, available: false });

    const resume = (await api(`/api/session?curriculumId=${id}`)).body.resume;
    assert.equal(resume.summary, 'Début du module 2');
    await chatOnce(api, id, 'On continue');
    const sys = seenChat.at(-1).messages[0].content;
    assert.match(sys, /Position actuelle : m2/);
    assert.match(sys, /m1 : Module .* \[in_progress, 60 %\]/);
    assert.match(sys, /q-d1 : QCM récap/);
    assert.match(sys, /Lacunes connues/);

    assert.equal(sub.body.cursor.phase, 'course');
    const nav = await api('/api/cursor', { curriculumId: id, moduleId: 'm3' }); // navigation seule : ne démarre rien
    assert.equal(nav.body.plan.modules.find((m) => m.id === 'm3').status, 'todo');
    const cur = await api('/api/cursor', { curriculumId: id, moduleId: 'm3', start: true });
    assert.equal(cur.body.cursor.moduleId, 'm3');
    assert.deepEqual([cur.body.plan.modules.find((m) => m.id === 'm3').status, cur.body.plan.modules.find((m) => m.id === 'm3').progress], ['in_progress', 5]);
    assert.equal((await api('/api/cursor', { curriculumId: id, moduleId: 'm99' })).status, 404);
  } finally { server.close(); }
});

test('diagnostic indisponible une fois le cursus démarré', async () => {
  mockNetwork();
  const { server, api, id } = await boot();
  try {
    await api('/api/cursor', { curriculumId: id, moduleId: 'm1' });
    assert.equal((await api('/api/assessment/start', { curriculumId: id })).status, 200); // simple navigation : diagnostic toujours possible
    await api('/api/cursor', { curriculumId: id, moduleId: 'm1', start: true });
    assert.equal((await api('/api/assessment/start', { curriculumId: id })).status, 409);
    assert.deepEqual((await api(`/api/plan?curriculumId=${id}`)).body.diagnostic, { done: false, available: false });
  } finally { server.close(); }
});

test('plan LLM invalide -> plan de secours déterministe dès la création', async () => {
  mockNetwork({ badPlan: true });
  const { server, api, id } = await boot();
  try {
    const { plan } = (await api(`/api/plan?curriculumId=${id}`)).body;
    assert.equal(plan.source, 'fallback');
    assert.equal(validatePlan({ modules: plan.modules.filter((m) => m.kind !== 'quiz') }, DOMAINS), null);
    assert.equal(plan.modules.filter((m) => m.kind === 'quiz').length, 3);
  } finally { server.close(); }
});

test('page officielle illisible : échec à l\'étape 1, réessai, puis texte collé à la main', async () => {
  mockNetwork({ pageStatus: 503 });
  const { server, api, id, waitFor } = await boot();
  try {
    let v = (await api(`/api/creation?curriculumId=${id}`)).body;
    assert.equal(v.status, 'failed');
    assert.equal(v.failedStep, 'fetch');
    assert.equal(v.steps[0].state, 'error');
    assert.match(v.error, /HTTP 503/);
    assert.equal((await api(`/api/plan?curriculumId=${id}`)).body.phase, 'creation_failed');

    await api('/api/creation/retry', { curriculumId: id });
    v = await waitFor((x) => x.status !== 'running');
    assert.equal(v.status, 'failed'); // toujours 503

    assert.equal((await api('/api/creation/manual', { curriculumId: id, text: 'court' })).status, 400);
    await api('/api/creation/manual', { curriculumId: id, text: PAGE });
    v = await waitFor((x) => x.status !== 'running');
    assert.equal(v.status, 'done');
    const view = (await api(`/api/plan?curriculumId=${id}`)).body;
    assert.equal(view.phase, 'learning');
    assert.equal(view.plan.modules.length, 6);
    assert.equal((await api('/api/creation/retry', { curriculumId: id })).status, 409);
  } finally { server.close(); }
});

async function boot2() { mockNetwork(); return boot(); }

test('QCM récap de bloc, lacunes résolubles, compteur d\'appels', async () => {
  const { server, api, id } = await boot2();
  try {
    assert.equal((await api('/api/quiz/submit', { curriculumId: id, moduleId: 'q-d1', answers: [] })).status, 409);
    const start = (await api('/api/quiz/start', { curriculumId: id, moduleId: 'q-d1' })).body;
    assert.match(start.title, /QCM récap — Plan and manage/);
    assert.equal(start.questions.length, 3); // la question invalide est écartée
    assert.equal(start.questions[1].pick, 2);
    assert.ok(!JSON.stringify(start).includes('correctIndices') && !JSON.stringify(start).includes('E1'));

    const fail = (await api('/api/quiz/submit', { curriculumId: id, moduleId: 'q-d1', answers: [[1], [0], [0]] })).body;
    assert.equal(fail.result.passed, false);
    assert.equal(fail.view.plan.modules.find((m) => m.id === 'q-d1').status, 'todo');
    const quizGapsList = fail.view.gaps.filter((g) => g.source === 'quiz');
    assert.equal(quizGapsList.length, 2);

    await api('/api/quiz/start', { curriculumId: id, moduleId: 'q-d1' });
    const ok = (await api('/api/quiz/submit', { curriculumId: id, moduleId: 'q-d1', answers: [[1], [3, 0], [2]] })).body;
    assert.equal(ok.result.passed, true);
    const q = ok.view.plan.modules.find((m) => m.id === 'q-d1');
    assert.deepEqual([q.status, q.progress], ['done', 100]);
    assert.equal(ok.view.quizzes['q-d1'].attempts, 2);
    const qLog = (await api(`/api/session?curriculumId=${id}&moduleId=q-d1`)).body.messages;
    assert.equal(qLog.length, 2, 'les 2 corrections sont dans le fil du QCM');
    assert.ok(qLog.every((m) => m.kind === 'quiz' && m.moduleId === 'q-d1'));
    assert.ok(!(await api(`/api/session?curriculumId=${id}&moduleId=m1`)).body.messages.some((m) => m.kind === 'quiz'), 'et pas dans celui du cours');
    assert.equal(ok.view.quizzes['q-d1'].best, 1);
    assert.equal(ok.view.progress.byDomain[0].quizAvg, 100);
    assert.ok(ok.view.progress.global > 0);

    const gid = quizGapsList[0].id;
    const res = await api('/api/gaps/resolve', { curriculumId: id, gapId: gid });
    assert.ok(res.body.gaps.find((g) => g.id === gid).resolvedAt);
    assert.equal((await api('/api/gaps/resolve', { curriculumId: id, gapId: gid })).status, 404);
    await chatOnce(api, id, 'salut');
    const sys = seenChat.at(-1).messages[0].content;
    assert.ok(!sys.includes(quizGapsList[0].note), 'lacune résolue absente du contexte du coach');
    assert.ok(sys.includes(quizGapsList[1].note), 'lacune ouverte présente');

    // compteur : 4 appels de démarrage (extraction + resources/tips + qcm), 1 plan, 2 QCM, 1 chat
    const u = (await api(`/api/plan?curriculumId=${id}`)).body.usage;
    assert.equal(u.byGroup.startup.calls, 4);
    assert.equal(u.byGroup.plan.calls, 1);
    assert.equal(u.byGroup.quiz.calls, 2);
    assert.equal(u.byGroup.chat.calls, 1);
    assert.equal(u.calls, 8);
    assert.equal(u.tokens, 7 * 150 + 220);
    assert.ok(u.costUsd > 0.03 && u.costUsd < 0.04, `coût ${u.costUsd}`); // 3 recherches web à 10 $/1000 + tokens
    assert.equal(u.searches, 3);
  } finally { server.close(); }
});

test('langue de formation : validée, figée, injectée dans le coach et dans les contenus générés', async () => {
  mockNetwork();
  const { server, api, id } = await boot({ waitCreation: false, language: 'en-GB' });
  try {
    await new Promise((r) => setTimeout(r, 0));
    const bad = await api('/api/curricula', { name: 'x', officialUrl: OFFICIAL_URL, language: 'ja-JP' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /Langue/);

    const state = (await api('/api/state')).body;
    assert.deepEqual(state.languages.map((l) => [l.code, l.flag]), Object.entries(LANGUAGES).map(([code, l]) => [code, l.flag]));
    assert.equal(state.languages[0].code, 'fr-FR'); // le français reste la langue par défaut
    assert.equal(state.curricula[0].language, 'en-GB');

    for (let i = 0; i < 300 && (await api(`/api/creation?curriculumId=${id}`)).body.status === 'running'; i++) await new Promise((r) => setTimeout(r, 20));
    const view = (await api(`/api/plan?curriculumId=${id}`)).body;
    assert.equal(view.language, 'en-GB');
    assert.match(seenResponses.filter((r) => r.name === 'study_plan').at(-1).instructions, /Rédige en anglais/);
    assert.match(seenResponses.filter((r) => r.name.startsWith('research_')).at(-1).instructions, /en anglais/);

    await api('/api/quiz/start', { curriculumId: id, moduleId: 'q-d1' });
    assert.match(seenResponses.filter((r) => r.name === 'quiz_module').at(-1).instructions, /Rédige en anglais/);

    await chatOnce(api, id, 'Bonjour, réponds-moi en français');
    assert.match(seenChat.at(-1).messages[0].content, /Réponds exclusivement en anglais, sans jamais dévier, même si l'utilisateur écrit dans une autre langue\./);

    assert.equal((await api('/api/curricula/language', { curriculumId: id, language: 'fr-FR' })).status, 404); // figée
    assert.equal((await api(`/api/plan?curriculumId=${id}`)).body.language, 'en-GB');
  } finally { server.close(); }
});

test('langue par défaut : français', async () => {
  mockNetwork();
  const { server, api, id } = await boot();
  try {
    assert.equal((await api(`/api/plan?curriculumId=${id}`)).body.language, 'fr-FR');
    await chatOnce(api, id, 'salut');
    assert.match(seenChat.at(-1).messages[0].content, /Réponds exclusivement en français/);
  } finally { server.close(); }
});

test('chat en mode vocal : consignes d\'oral, canaux mémorisés ; plus aucune API Realtime', async () => {
  mockNetwork();
  const { server, api, id } = await boot();
  try {
    await api('/api/chat', { curriculumId: id, message: 'Explique les agents', voice: true, channel: 'voice' });
    assert.match(seenChat.at(-1).messages[0].content, /lue à voix haute/);
    await api('/api/chat', { curriculumId: id, message: 'Et en texte ?' });
    assert.doesNotMatch(seenChat.at(-1).messages[0].content, /lue à voix haute/);
    await api('/api/chat', { curriculumId: id, message: 'Tapé pendant la voix', voice: true });
    const msgs = (await api(`/api/session?curriculumId=${id}`)).body.messages.filter((m) => !m.kind);
    assert.deepEqual(msgs.map((m) => `${m.role}:${m.channel}`), ['user:voice', 'assistant:voice', 'user:text', 'assistant:text', 'user:text', 'assistant:voice']);
    for (const path of ['/api/realtime/session', '/api/voice/turn', '/api/voice/tool', '/api/voice/usage', '/api/voice/token']) {
      assert.equal((await api(path, { curriculumId: id })).status, 404, path);
    }
  } finally { server.close(); }
});

test('i18n serveur : mêmes clés et mêmes paramètres dans les 3 langues', async () => {
  const { MESSAGES } = await import('../src/server/i18n.js');
  const params = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const fr = MESSAGES['fr-FR'];
  for (const lang of Object.keys(LANGUAGES).filter((l) => l !== 'fr-FR')) {
    assert.deepEqual(Object.keys(MESSAGES[lang]).sort(), Object.keys(fr).sort(), `clés ${lang}`);
    for (const k of Object.keys(fr)) assert.equal(params(MESSAGES[lang][k]), params(fr[k]), `${lang} ${k}`);
  }
});

test('messages automatiques et erreurs dans la langue du cursus (anglais)', async () => {
  mockNetwork();
  const { server, api, id } = await boot({ language: 'en-GB' });
  try {
    const v = (await api(`/api/creation?curriculumId=${id}`, null, { 'x-lang': 'fr-FR' })).body; // l'en-tête ne prime pas sur la langue du cursus
    assert.deepEqual(v.steps.map((s) => s.label), ['Fetching the official page…', 'Extracting domains and weightings…', 'Searching complementary resources…', 'Searching quizzes and practice tests…', 'Building your personalised plan…']);
    const { messages } = (await api(`/api/session?curriculumId=${id}`)).body;
    assert.match(messages[0].content, /Kick-off debrief/);
    assert.match(messages[0].content, /What the official page says/);
    assert.match(messages[0].content, /Confidence for building your plan: (high|medium|low)/);
    assert.match(messages[1].content, /your initial plan is ready/);
    const plan = (await api(`/api/plan?curriculumId=${id}`)).body.plan;
    assert.match(plan.modules.find((m) => m.kind === 'quiz').title, /^Recap quiz — /);
    assert.equal((await api('/api/quiz/submit', { curriculumId: id, moduleId: 'q-d1', answers: [] }, { 'x-lang': 'fr-FR' })).body.error, 'No quiz in progress for this module');
    // quiz raté -> résumé et lacunes en anglais
    await api('/api/quiz/start', { curriculumId: id, moduleId: 'q-d1' });
    const res = (await api('/api/quiz/submit', { curriculumId: id, moduleId: 'q-d1', answers: [[0], [0], [0]] })).body;
    assert.match((await api(`/api/session?curriculumId=${id}`)).body.messages.at(-1).content, /Quiz ".*": 0\/3 \(0 %\) — 70 % target not reached/);
    assert.match(res.view.gaps[0].note, /^Quiz "/);
  } finally { server.close(); }
});

test('erreurs traduites selon l\'en-tête x-lang ; espagnol', async () => {
  mockNetwork();
  const { server, api } = await boot({ waitCreation: false });
  try {
    const bad = (h) => api('/api/curricula', { name: '', officialUrl: OFFICIAL_URL }, h);
    assert.equal((await bad({})).body.error, 'Nom du cursus requis');
    assert.equal((await bad({ 'x-lang': 'en-GB' })).body.error, 'Course name required');
    assert.equal((await bad({ 'x-lang': 'es-ES' })).body.error, 'Nombre del curso obligatorio');
    assert.equal((await bad({ 'x-lang': 'zz' })).body.error, 'Nom du cursus requis'); // langue inconnue -> français
    assert.match((await api('/api/curricula', { name: 'x', officialUrl: 'http://a.example.org' }, { 'x-lang': 'es-ES' })).body.error, /Solo se aceptan URL https/);
    assert.match((await api('/api/curricula', { name: 'x', officialUrl: 'https://localhost/x' }, { 'x-lang': 'en-GB' })).body.error, /Local address refused/);
  } finally { server.close(); }
});

test('cursus en espagnol : plan et débrief en espagnol', async () => {
  mockNetwork();
  const { server, api, id } = await boot({ language: 'es-ES' });
  try {
    const { messages } = (await api(`/api/session?curriculumId=${id}`)).body;
    assert.match(messages[0].content, /Resumen inicial/);
    assert.match(messages[1].content, /tu plan inicial está listo/);
    assert.match((await api(`/api/plan?curriculumId=${id}`)).body.plan.modules.find((m) => m.kind === 'quiz').title, /^Test resumen — /);
  } finally { server.close(); }
});

test('persona : choix à l\'onboarding, stocké dans le profil, injecté dans le prompt', async () => {
  mockNetwork();
  const { server, api, id } = await boot({ persona: 'vera' });
  try {
    assert.equal((await api('/api/state')).body.profile.persona, 'vera');
    await chatOnce(api, id, 'salut');
    const sys = seenChat.at(-1).messages[0].content;
    assert.match(sys, /^Tu t'appelles Vera\.\nStyle : Exigeante/);
  } finally { server.close(); }
});

test('persona par défaut : Lumen ; persona inconnu refusé', async () => {
  mockNetwork();
  const { server, api, id } = await boot();
  try {
    assert.equal((await api('/api/state')).body.profile.persona, 'lumen');
    await chatOnce(api, id, 'salut');
    assert.match(seenChat.at(-1).messages[0].content, /^Tu t'appelles Lumen\.\nStyle : Bienveillante/);
    assert.equal((await api('/api/onboarding', { name: 'Ada', apiKey: 'sk', persona: 'hal9000' })).status, 400);
  } finally { server.close(); }
});

test('prompt du coach : 3 phases par sous-module (cours complet, vérification 2-3 questions, décision avancer/réviser)', () => {
  const sys = systemPrompt({ name: 'Ada', certification: 'AI-103', language: 'fr-FR', persona: 'lumen' });
  assert.ok(sys.includes("Structure chaque sous-module en 3 phases : cours complet avec exemples, vérification par 2-3 questions ciblées, puis demande explicite à l'utilisateur s'il veut avancer ou réviser. Ne pose pas de questions de vérification avant d'avoir terminé d'expliquer tous les concepts du sous-module en cours."));
  assert.match(sys, /Phase 1 — Cours du sous-module/);
  assert.match(sys, /« Est-ce que c'est clair jusqu'ici \? » ou « Tu as une question sur ce point \? »/);
  assert.match(sys, /Phase 2 — Vérification en fin de sous-module[\s\S]*2 à 3 questions ciblées[\s\S]*record_gap/);
  assert.match(sys, /Phase 3 — Décision avant de continuer[\s\S]*« Tu veux qu'on passe au sous-module suivant, ou tu préfères qu'on reprenne un point qui n'était pas clair \? »/);
  assert.match(sys, /réexplique le point faible autrement/);
  // l'ancien rythme (« un concept, puis une question ») et la consigne de concision ne subsistent plus
  assert.doesNotMatch(sys, /Sois concis\./);
  assert.doesNotMatch(sys, /vérifie la compréhension par une question courte avant d'avancer/);
  assert.doesNotMatch(SPOKEN_ADDENDUM, /Une seule idée puis une question|2 à 4 phrases/);
  assert.match(SPOKEN_ADDENDUM, /plusieurs idées d'affilée[\s\S]*pas de questions de vérification avant la fin du sous-module/);
  // la structure vaut aussi pour les 3 personas et dans les autres langues (la règle de langue reste présente)
  for (const persona of ['lumen', 'vera', 'eko']) assert.match(systemPrompt({ name: 'A', certification: 'C', language: 'en-GB', persona }), /Structure chaque sous-module en 3 phases[\s\S]*Réponds exclusivement en anglais/);
});

test('phase pédagogique mémorisée dans le curseur (save_cursor) et rappelée au coach', () => {
  const base = { plan: { modules: [{ id: 'm1', kind: 'lesson', title: 'Agents', status: 'in_progress', progress: 30, domainId: 'd1', objectives: ['a'] }, { id: 'm2', kind: 'lesson', title: 'Search', status: 'todo', progress: 0, domainId: 'd1', objectives: ['b'] }] }, discovery: { official: { domains: [DOMAINS[0]] } } };
  let c = applyTool(base, 'save_cursor', { moduleId: 'm1', summary: '2 concepts sur 5 expliqués', phase: 'course' }).curriculum;
  assert.deepEqual([c.cursor.phase, c.cursor.summary], ['course', '2 concepts sur 5 expliqués']);
  assert.match(planContext(c), /Position actuelle : m1 « Agents » — phase 1 \(cours en cours\) — dernier point : 2 concepts sur 5 expliqués/);
  c = applyTool(c, 'save_cursor', { moduleId: 'm1', summary: 'Questions posées : 1/3', phase: 'check' }).curriculum;
  assert.match(planContext(c), /phase 2 \(vérification\)/);
  c = applyTool(c, 'save_cursor', { moduleId: 'm1', summary: 'Lacune sur le RAG', phase: 'decision' }).curriculum;
  assert.match(planContext(c), /phase 3 \(attente du choix avancer\/réviser\)/);
  assert.match(planContext(c), /save_cursor \(avec phase = course \| check \| decision/);
  // phase invalide ou absente : la phase courante du même module est conservée ; nouveau module : retour au cours
  assert.equal(applyTool(c, 'save_cursor', { moduleId: 'm1', summary: 's', phase: 'nimporte' }).curriculum.cursor.phase, 'decision');
  assert.equal(applyTool(c, 'save_cursor', { moduleId: 'm1', summary: 's' }).curriculum.cursor.phase, 'decision');
  assert.equal(applyTool(c, 'save_cursor', { moduleId: 'm2', summary: 'début' }).curriculum.cursor.phase, 'course');
});

test('prompt du coach : balises de mise en forme [CONCEPT] / [ANALOGIE] / tirets, comprises par le rendu', () => {
  const sys = systemPrompt({ name: 'Ada', certification: 'AI-103', language: 'fr-FR', persona: 'eko' });
  for (const must of ['[CONCEPT: Titre du concept]', '[/CONCEPT]', '[ANALOGIE]', '[/ANALOGIE]', 'tirets Markdown standard (- point)', '📖 **[Titre du sous-thème]**', '❓ **Vérifions ta compréhension**', 'systématiquement, à chaque réponse de cours', '« ## Titre »'])
    assert.ok(sys.includes(must), must);
  assert.match(SPOKEN_ADDENDUM, /\[CONCEPT: …\] \/ \[\/CONCEPT\] et \[ANALOGIE\] \/ \[\/ANALOGIE\] \(elles sont affichées mais pas lues\)/);
});

test('badge de phase : la phase pédagogique du tour est mémorisée sur le message du coach (et envoyée au client)', async () => {
  mockNetwork();
  const { server, api, id } = await boot();
  try {
    // tour ordinaire pendant le cours : phase « course »
    const t1 = await chatOnce(api, id, 'Explique-moi les agents');
    assert.match(t1, /"done":true,"phase":"course"/);
    // le coach passe en vérification (save_cursor phase=check) : le message porte la nouvelle phase
    const t2 = await chatOnce(api, id, 'VERIF svp');
    assert.match(t2, /"done":true,"phase":"check"/);
    const msgs = (await api(`/api/session?curriculumId=${id}`)).body.messages.filter((m) => !m.kind && m.role === 'assistant');
    assert.deepEqual(msgs.map((m) => m.phase), ['course', 'check']);
    assert.equal((await api(`/api/plan?curriculumId=${id}`)).body.cursor.phase, 'check');
    // sur un QCM récap : pas de badge de phase de cours
    await api('/api/cursor', { curriculumId: id, moduleId: 'q-d1' });
    const t3 = await chatOnce(api, id, 'Bonjour');
    assert.doesNotMatch(t3, /"phase"/);
  } finally { server.close(); }
});

test('avancement : save_cursor fait avancer le module d\'après la phase (plus seulement set_module_status)', () => {
  const mk = (extra = {}) => ({ discovery: { official: { domains: [DOMAINS[0]] } }, plan: { modules: [{ id: 'm1', kind: 'lesson', hours: 4, status: 'todo', progress: 0, domainId: 'd1', objectives: ['a', 'b', 'c', 'd', 'e'], ...extra }, { id: 'q-d1', kind: 'quiz', hours: 1, status: 'todo', progress: 0, domainId: 'd1', objectives: ['x'] }] } });
  const mod = (c) => c.plan.modules[0];
  const save = (c, args) => applyTool(c, 'save_cursor', { moduleId: 'm1', summary: 's', ...args });
  assert.equal(phaseProgress({ objectives: ['a', 'b', 'c', 'd', 'e'] }, 'course', 2), 34); // 10 + 60 × 2/5
  assert.equal(phaseProgress({ objectives: ['a'] }, 'course', 1), 70);
  assert.equal(phaseProgress({ objectives: ['a', 'b'] }, 'course', 99), 70, 'covered borné au nombre d\'objectifs');
  assert.equal(phaseProgress({ objectives: ['a', 'b'] }, 'course', 'n/a'), 10);
  assert.equal(phaseProgress({ objectives: [] }, 'course', 1), 70);
  assert.deepEqual([phaseProgress({ objectives: ['a'] }, 'check'), phaseProgress({ objectives: ['a'] }, 'decision')], [75, 90]);

  let c = mk();
  let out = save(c, { phase: 'course', covered: 2 });
  assert.deepEqual([mod(out.curriculum).status, mod(out.curriculum).progress, out.result.progress], ['in_progress', 34, 34]);
  c = out.curriculum;
  assert.equal(mod(save(c, { phase: 'course', covered: 1 }).curriculum).progress, 34, 'l\'avancement ne recule jamais');
  assert.equal(mod(save(c, { phase: 'check' }).curriculum).progress, 75);
  assert.equal(mod(save(c, { phase: 'decision' }).curriculum).progress, 90);
  assert.ok(mod(save(c, { phase: 'decision', covered: 5 }).curriculum).progress < 100, 'jamais 100 : seul « done » termine un module');
  // module terminé ou QCM récap : inchangés
  assert.equal(mod(save(mk({ status: 'done', progress: 100 }), { phase: 'course', covered: 1 }).curriculum).progress, 100);
  const q = applyTool(mk(), 'save_cursor', { moduleId: 'q-d1', summary: 's', phase: 'check' }).curriculum;
  assert.deepEqual([q.plan.modules[1].progress, q.plan.modules[1].status], [0, 'todo']);
  assert.equal(q.cursor.moduleId, 'q-d1');
  // la progression globale suit
  assert.ok(computeProgress(out.curriculum).global > 0);
});

test('chaque tour : avancement calculé, journalisé côté serveur et renvoyé au client dans l\'événement done', async () => {
  mockNetwork();
  const { server, api, id, logs } = await boot();
  try {
    logs.length = 0;
    // 1) le coach appelle save_cursor(course, covered) : progression et événement done cohérents
    const t1 = await chatOnce(api, id, 'COVER');
    const done = JSON.parse(t1.split('\n\n').map((l) => l.replace(/^data: /, '')).filter(Boolean).find((l) => l.includes('"done"')));
    assert.deepEqual([done.phase, done.progress.moduleId, done.progress.module], ['course', 'm1', 70]);
    const view = (await api(`/api/plan?curriculumId=${id}`)).body;
    assert.equal(done.progress.global, view.progress.global, 'la valeur du serveur = celle du plan');
    assert.ok(view.progress.global > 0);
    assert.match(logs.at(-1), /\[coach\] \d\d:\d\d:\d\d tour [0-9a-f]{8} module=m1 phase=course \| outils : save_cursor\(course,covered=1\) \| module 0→70 % \| global 0→\d+ %$/);

    // 2) réponse courte sans outil : rien n'est inventé
    logs.length = 0;
    await chatOnce(api, id, 'merci');
    assert.match(logs.at(-1), /outils : aucun \| module 70→70 %/);
    assert.ok(!/estimé/.test(logs.at(-1)));
  } finally { server.close(); }
});

test('filet de sécurité : cours long sans aucun outil d\'avancement -> +5 % estimé, plafonné à 60 %', async () => {
  mockNetwork();
  const { server, api, id, logs } = await boot();
  try {
    await api('/api/cursor', { curriculumId: id, moduleId: 'm1', start: true }); // m1 démarré (5 %)
    let last;
    for (let i = 0; i < 14; i++) {
      logs.length = 0;
      await chatOnce(api, id, 'LONG');
      last = logs.at(-1);
      if (i === 0) {
        assert.match(last, /outils : aucun \| module 5→10 %.*\+5 % estimé/);
        assert.equal((await api(`/api/plan?curriculumId=${id}`)).body.plan.modules.find((m) => m.id === 'm1').progress, 10);
      }
    }
    const m1 = (await api(`/api/plan?curriculumId=${id}`)).body.plan.modules.find((m) => m.id === 'm1');
    assert.equal(m1.progress, 60, 'plafond : seul le coach (outils) ou un QCM peut aller au-delà');
    assert.ok(!/estimé/.test(last), 'plus d\'estimation au plafond');

    // si le coach déclare l'avancement lui-même, aucune estimation en plus
    logs.length = 0;
    await chatOnce(api, id, 'COVER LONG');
    assert.ok(!/estimé/.test(logs.at(-1)));
    // QCM récap sélectionné : pas de progression de cours
    await api('/api/cursor', { curriculumId: id, moduleId: 'q-d1' });
    logs.length = 0;
    await chatOnce(api, id, 'LONG');
    assert.match(logs.at(-1), /module=q-d1 \| outils : aucun \| module 0→0 %/);
  } finally { server.close(); }
});

test('chat segmenté : un historique par module, isolé du coach, persisté ; l\'historique d\'avant (sans moduleId) revient au premier module', async () => {
  mockNetwork();
  const { server, api, id } = await boot();
  try {
    const session = async (moduleId) => (await api(`/api/session?curriculumId=${id}${moduleId ? `&moduleId=${moduleId}` : ''}`)).body.messages;
    const before = await session('m1');
    assert.ok(before.length >= 1 && before.every((m) => !m.moduleId), 'débrief / plan sans moduleId : rattachés au premier module');
    assert.deepEqual(await session('m2'), [], 'un module jamais ouvert démarre vide');

    await chatOnce(api, id, 'bonjour sur m1');
    await api('/api/cursor', { curriculumId: id, moduleId: 'm2' });
    await chatOnce(api, id, 'salut sur m2');
    const m1 = await session('m1'), m2 = await session('m2');
    assert.ok(m1.some((m) => m.content === 'bonjour sur m1') && !m1.some((m) => m.content === 'salut sur m2'));
    assert.deepEqual(m2.map((m) => [m.role, m.moduleId]), [['user', 'm2'], ['assistant', 'm2']]);
    assert.equal((await session()).length, m1.length + m2.length, 'sans moduleId : tout l\'historique (compatibilité)');
    // les QCM ont aussi leur fil : le résumé de correction n'apparaît que dans le QCM concerné
    assert.deepEqual(await session('q-d1'), []);
  } finally { server.close(); }
});
