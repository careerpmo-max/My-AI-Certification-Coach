import { createServer } from 'node:http';
import { chmod, readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PUBLIC_DIR, WEB_DIR } from './config.js';
import { chatStream, OpenAIError, validateKey } from './openai.js';
import { SPOKEN_ADDENDUM, systemPrompt } from './coach/persona.js';
import { DEFAULT_LANGUAGE, LANGUAGES, isLanguage, normalizeLanguage } from './coach/language.js';
import { DEFAULT_PERSONA, isPersona } from './coach/personas.js';
import { setCtxLang, tt, withLang } from './i18n.js';
import { coachContext } from './certs/debrief.js';
import { extractOutline } from './certs/official.js';
import { STEPS, DEFAULT_PROFILE, certOf, runPipeline } from './certs/pipeline.js';
import { assertPublicHttps } from './certs/url.js';
import { generateQuestions, publicQuestions, scoreAssessment } from './coach/assessment.js';
import { fallbackPlan, generatePlan, planContext, planSummary, totalHours } from './coach/planner.js';
import { bestScore, computeProgress, modProgress } from './coach/progress.js';
import { generateQuiz, publicQuiz, quizGaps, quizSummary, scoreQuiz } from './coach/quiz.js';
import { mergeUsage, usageView, withUsage } from './usage.js';
import { TOOLS, applyTool } from './coach/tools.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.icns': 'image/icns' };
/** Icônes servies depuis public/ (le reste de l'interface vient de src/web). */
const PUBLIC_FILES = new Set(['/icon.png', '/icon.ico', '/icon.icns']);
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const HISTORY_WINDOW = 30;
const MAX_ANNEX = 5;

/** Erreur HTTP dont le message est traduit (clé i18n) dans la langue de la requête/du cursus ; un message déjà traduit passe tel quel. */
const httpError = (status, key, params) => Object.assign(new Error(tt(key, params)), { status });
/** Examens connus : simples suggestions de préremplissage du formulaire de création. */
const catalog = JSON.parse(await readFile(new URL('./certs/catalog.json', import.meta.url), 'utf8'));

/** Anti DNS-rebinding / CSRF : Host et Origin doivent être locaux. */
function assertLocal(req) {
  const host = new URL(`http://${req.headers.host ?? ''}`).hostname;
  if (!LOCAL_HOSTS.has(host)) throw httpError(403, 'err.host');
  if (req.headers.origin && !LOCAL_HOSTS.has(new URL(req.headers.origin).hostname)) throw httpError(403, 'err.origin');
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw httpError(413, 'err.bodyTooBig');
    chunks.push(c);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  } catch {
    throw httpError(400, 'err.badJson');
  }
}

/** Un cursus est « démarré » dès qu'un module a de l'avancement : le diagnostic ne peut plus recalibrer le plan. */
const started = (plan) => plan.modules.some((m) => m.status !== 'todo' || modProgress(m) > 0);

export function createApp({ store, dataDir, log = process.env.NODE_TEST_CONTEXT ? () => {} : (...a) => console.log(...a) }) {
  const jobs = new Map(); // clé -> Promise (création ou génération en cours)
  const cancelled = new Set(); // cursus supprimés pendant qu'un job tournait
  const apiKey = async () => (await store.get('secrets'))?.openaiKey;

  const need = async (id) => {
    const c = id ? await store.get(`curricula/${id}`) : null;
    if (!c) throw httpError(404, 'err.unknownCurriculum');
    setCtxLang(c.language); // les messages suivent la langue du cursus, quelle que soit celle de l'en-tête
    return c;
  };

  /** Applique fn au cursus ; no-op (false) s'il a été supprimé. Évite de recréer un fichier fantôme. */
  async function patch(id, fn) {
    let applied = false;
    await store.update(`curricula/${id}`, (c) => {
      if (!c || cancelled.has(id)) return undefined;
      applied = true;
      return fn(c);
    });
    return applied;
  }

  /** Exécute fn en comptabilisant les appels OpenAI dans curricula/<id>.usage. */
  async function track(id, fn) {
    const entries = [];
    try {
      return await withUsage(entries, fn);
    } finally {
      if (entries.length) await patch(id, (c) => ({ ...c, usage: mergeUsage(c.usage, entries) })).catch(() => {});
    }
  }

  /**
   * Un historique de chat par module : chaque message porte `moduleId`. Les messages sans `moduleId` (débrief, plan,
   * diagnostic, historique d'avant cette fonction) sont rattachés au premier module de cours.
   */
  const firstLessonId = (c) => (c?.plan?.modules.find((m) => m.kind !== 'quiz') ?? c?.plan?.modules[0])?.id ?? null;
  const scopeOf = (m, c) => m.moduleId ?? firstLessonId(c);
  const inScope = (messages, c, moduleId) => messages.filter((m) => scopeOf(m, c) === moduleId);

  const appendMessage = (id, msg) =>
    store.update(`sessions/${id}`, (s) => ({ messages: [...s.messages, { channel: 'text', at: new Date().toISOString(), ...msg }] }), { messages: [] });

  const phase = (c) => (c.creation?.status === 'failed' ? 'creation_failed' : c.creation?.status === 'done' ? 'learning' : 'creating');
  const diagnosticState = (c) => ({ done: !!c.assessment?.doneAt, available: c.creation?.status === 'done' && !!c.plan && !c.assessment?.doneAt && !started(c.plan) });

  const planView = (c) => ({
    phase: phase(c),
    name: c.name,
    certification: c.certification,
    officialUrl: c.officialUrl,
    language: normalizeLanguage(c.language),
    plan: c.plan ?? null,
    cursor: c.cursor ?? null,
    gaps: c.gaps ?? [],
    levels: c.assessment?.levels ?? null,
    domains: (c.discovery?.official?.domains ?? []).map(({ id, name, weightMin, weightMax, subdomains }) => ({ id, name, weightMin, weightMax, subdomains })),
    progress: computeProgress(c),
    quizzes: Object.fromEntries(Object.entries(c.quizzes ?? {}).map(([id, q]) => [id, { attempts: q.attempts?.length ?? 0, best: bestScore(q) }])),
    diagnostic: diagnosticState(c),
    usage: usageView(c.usage),
  });

  const creationView = (c) => {
    const cr = c.creation;
    const activeIdx = STEPS.findIndex((s) => s.key === cr.active);
    return {
      name: c.name,
      language: normalizeLanguage(c.language),
      status: cr.status,
      percent: cr.status === 'done' ? 100 : cr.percent ?? 0,
      error: cr.error ?? null,
      failedStep: cr.failedStep ?? null,
      needsProgramme: !!cr.needsProgramme,
      steps: STEPS.map((s, i) => ({ key: s.key, label: tt(`step.${s.key}`), pct: s.pct, state: cr.done.includes(s.key) ? 'done' : cr.failedStep === s.key ? 'error' : i === activeIdx ? 'active' : 'pending' })),
    };
  };

  /** Lance/reprend la création en arrière-plan (un seul job par cursus) ; clé et prénom résolus juste avant. */
  const launch = async (id) => {
    if (jobs.has(id)) return;
    const [key, profile, cur] = await Promise.all([apiKey(), store.get('profile'), store.get(`curricula/${id}`)]);
    const job = withLang(cur?.language, () => track(id, () => runPipeline({
      apiKey: key,
      name: profile.name,
      get: () => store.get(`curricula/${id}`),
      patch: (fn) => patch(id, fn),
      isCancelled: () => cancelled.has(id),
      appendMessage: (m) => appendMessage(id, m),
    }))).catch((e) => patch(id, (c) => ({ ...c, creation: { ...c.creation, status: 'failed', failedStep: c.creation.active, error: e.message } })).catch(() => {}))
      .finally(() => jobs.delete(id));
    jobs.set(id, job);
  };

  async function createCurriculum({ name, officialUrl, annexLinks, language }) {
    const id = randomUUID();
    const c = {
      id,
      name,
      officialUrl,
      annexLinks,
      language,
      certification: name,
      createdAt: new Date().toISOString(),
      creation: { status: 'running', done: [], active: null, percent: 0 },
      discovery: { status: 'pending' },
    };
    await store.set(`curricula/${id}`, c);
    await store.update('curricula-index', (ids) => [...ids, id], []);
    await launch(id);
    return c;
  }

  const routes = new Map([
    ['GET /api/state', async () => {
      const profile = await store.get('profile');
      const onboarded = !!profile && !!(await apiKey());
      const ids = onboarded ? await store.get('curricula-index', []) : [];
      const curricula = (await Promise.all(ids.map((id) => store.get(`curricula/${id}`)))).filter(Boolean).map((c) => ({
        id: c.id, name: c.name, certification: c.certification, language: normalizeLanguage(c.language), createdAt: c.createdAt, progress: computeProgress(c).global, creation: c.creation?.status,
      }));
      return { onboarded, profile: profile && { ...profile, persona: isPersona(profile.persona) ? profile.persona : DEFAULT_PERSONA }, curricula, languages: Object.entries(LANGUAGES).map(([code, l]) => ({ code, label: l.label, flag: l.flag })), suggestions: catalog.map((e) => ({ label: e.name, name: e.suggestedName, url: e.officialUrls.studyGuide })) };
    }],

    ['POST /api/onboarding', async (_req, { name, apiKey: key, persona = DEFAULT_PERSONA }) => {
      name = String(name ?? '').trim();
      key = String(key ?? '').trim();
      if (!name) throw httpError(400, 'err.nameRequired');
      if (!key) throw httpError(400, 'err.keyRequired');
      if (!isPersona(persona)) throw httpError(400, 'err.unknownPersona');
      try {
        await validateKey(key);
      } catch (e) {
        if (e instanceof OpenAIError) throw httpError(e.status === 401 ? 401 : 502, 'err.keyRefused', { msg: e.message });
        throw httpError(502, 'err.openaiDown');
      }
      await store.set('secrets', { openaiKey: key });
      if (dataDir) await chmod(join(dataDir, 'secrets.json'), 0o600).catch(() => {});
      await store.set('profile', { name, persona, createdAt: new Date().toISOString() });
      return { ok: true };
    }],

    ['POST /api/curricula', async (_req, { name, officialUrl, annexLinks = [], language = DEFAULT_LANGUAGE }) => {
      if (!(await store.get('profile'))) throw httpError(409, 'err.onboardingRequired');
      name = String(name ?? '').trim().slice(0, 80);
      if (!name) throw httpError(400, 'err.cursusNameRequired');
      let url;
      try {
        url = assertPublicHttps(officialUrl);
      } catch (e) {
        throw httpError(400, 'err.officialUrl', { msg: e.message });
      }
      if (!isLanguage(language)) throw httpError(400, 'err.unknownLanguage');
      if (!Array.isArray(annexLinks)) throw httpError(400, 'err.annexInvalid');
      const annex = [...new Set(annexLinks.map((l) => String(l).trim()).filter(Boolean))];
      if (annex.length > MAX_ANNEX) throw httpError(400, 'err.annexMax', { n: MAX_ANNEX });
      let clean;
      try {
        clean = annex.map(assertPublicHttps);
      } catch (e) {
        throw httpError(400, 'err.annexLink', { msg: e.message });
      }
      const c = await createCurriculum({ name, officialUrl: url, annexLinks: clean, language });
      return { curriculum: { id: c.id, name: c.name } };
    }],

    ['POST /api/curricula/delete', async (_req, { curriculumId }) => {
      await need(curriculumId);
      cancelled.add(curriculumId);
      await store.update('curricula-index', (ids) => ids.filter((x) => x !== curriculumId), []);
      await store.remove(`curricula/${curriculumId}`);
      await store.remove(`sessions/${curriculumId}`);
      return { ok: true };
    }],

    ['GET /api/creation', async (req) => {
      const id = new URL(req.url, 'http://x').searchParams.get('curriculumId');
      const c = await need(id);
      if (c.creation?.status === 'running' && !jobs.has(id)) await launch(id); // reprise après redémarrage du serveur
      return creationView(c);
    }],

    ['POST /api/creation/retry', async (_req, { curriculumId }) => {
      const c = await need(curriculumId);
      if (c.creation.status !== 'failed') throw httpError(409, 'err.noFailure');
      await patch(curriculumId, (x) => ({ ...x, creation: { ...x.creation, status: 'running', error: null, failedStep: null, needsProgramme: false } }));
      await launch(curriculumId);
      return creationView(await need(curriculumId));
    }],

    // Texte de la page d'examen collé à la main (page illisible ou extraction impossible)
    ['POST /api/creation/manual', async (_req, { curriculumId, text }) => {
      const c = await need(curriculumId);
      text = String(text ?? '');
      if (c.creation.status !== 'failed') throw httpError(409, 'err.notBlocked');
      if (text.length < 200) throw httpError(400, 'err.textShort');
      const official = await track(curriculumId, async () => extractOutline(await apiKey(), certOf(c), text.slice(0, 60000), { url: c.officialUrl, manual: true }))
        .catch((e) => { throw httpError(502, e.message); });
      if (!official.domains.length) throw httpError(422, 'err.noDomainInText');
      official.fetchedAt = new Date().toISOString();
      await patch(curriculumId, (x) => ({
        ...x,
        certification: official.title ?? x.name,
        cert: { examCode: official.examCode },
        discovery: { ...x.discovery, official },
        creation: { ...x.creation, status: 'running', done: [...new Set([...x.creation.done, 'fetch', 'extract'])], percent: 40, error: null, failedStep: null, needsProgramme: false },
      }));
      await launch(curriculumId);
      return creationView(await need(curriculumId));
    }],

    ['GET /api/session', async (req) => {
      const id = new URL(req.url, 'http://x').searchParams.get('curriculumId');
      const c = await need(id);
      const mod = c.plan?.modules.find((m) => m.id === c.cursor?.moduleId);
      const wanted = new URL(req.url, 'http://x').searchParams.get('moduleId'); // absent : tout l'historique
      const all = (await store.get(`sessions/${id}`, { messages: [] })).messages;
      return {
        messages: wanted ? inScope(all, c, wanted) : all,
        resume: mod ? { moduleId: mod.id, title: mod.title, status: mod.status, phase: c.cursor.phase ?? 'course', summary: c.cursor.summary, updatedAt: c.cursor.updatedAt } : null,
      };
    }],

    ['GET /api/plan', async (req) => planView(await need(new URL(req.url, 'http://x').searchParams.get('curriculumId')))],

    ['POST /api/assessment/start', async (_req, { curriculumId }) => {
      const c = await need(curriculumId);
      if (!diagnosticState(c).available) throw httpError(409, c.assessment?.doneAt ? 'err.diagDone' : 'err.diagUnavailable');
      const domains = c.discovery.official.domains;
      let questions = c.assessment?.questions;
      if (!questions) {
        // sans QCM (échec de génération), le diagnostic reste possible en auto-évaluation seule
        questions = await track(curriculumId, async () => generateQuestions(await apiKey(), certOf(c), domains)).catch(() => []);
        await patch(curriculumId, (x) => ({ ...x, assessment: { ...x.assessment, questions } }));
      }
      return { domains: domains.map(({ id, name }) => ({ id, name })), questions: publicQuestions(questions) };
    }],

    // Le diagnostic recalibre le plan initial (tant qu'aucun module n'est démarré)
    ['POST /api/assessment/submit', async (_req, { curriculumId, answers, profile: p = {} }) => {
      const c = await need(curriculumId);
      if (!diagnosticState(c).available) throw httpError(409, 'err.diagUnavailableShort');
      if (!c.assessment?.questions) throw httpError(409, 'err.diagNotStarted');
      if (jobs.has(`plan:${curriculumId}`)) throw httpError(409, 'err.genRunning');
      if (!Array.isArray(answers)) throw httpError(400, 'err.badAnswers');
      const job = (async () => {
        const domains = c.discovery.official.domains;
        const profile = {
          experience: ['debutant', 'intermediaire', 'avance'].includes(p.experience) ? p.experience : DEFAULT_PROFILE.experience,
          hoursPerWeek: Math.min(40, Math.max(1, Number(p.hoursPerWeek) || DEFAULT_PROFILE.hoursPerWeek)),
          examDate: /^\d{4}-\d{2}-\d{2}$/.test(p.examDate ?? '') ? p.examDate : null,
        };
        const { levels, gaps } = scoreAssessment(domains, c.assessment.questions, answers);
        const budget = totalHours(profile);
        let plan;
        try {
          plan = await track(curriculumId, async () => generatePlan(await apiKey(), { cert: certOf(c), discovery: c.discovery, levels, gaps, profile, budget }));
        } catch {
          plan = fallbackPlan(domains, levels, budget);
        }
        const name = (await store.get('profile')).name;
        const next = await store.update(`curricula/${curriculumId}`, (x) => ({
          ...x,
          assessment: { ...x.assessment, answers, levels, profile, budget, doneAt: new Date().toISOString() },
          plan,
          gaps: [...(x.gaps ?? []), ...gaps],
          cursor: { moduleId: plan.modules[0].id, phase: 'course', summary: '', updatedAt: new Date().toISOString() },
        }));
        await appendMessage(curriculumId, { role: 'assistant', content: planSummary({ name, domains, levels, plan, budget }), kind: 'plan' });
        return next;
      })();
      jobs.set(`plan:${curriculumId}`, job);
      try {
        return planView(await job);
      } finally {
        jobs.delete(`plan:${curriculumId}`);
      }
    }],

    // Navigation : déplace le curseur. `start: true` (bouton « Démarrer avec le coach ») marque en plus le module comme commencé.
    ['POST /api/cursor', async (_req, { curriculumId, moduleId, start }) => {
      const c = await need(curriculumId);
      if (!c.plan?.modules.some((m) => m.id === moduleId)) throw httpError(404, 'err.unknownModule');
      const next = await store.update(`curricula/${curriculumId}`, (x) => {
        const modules = x.plan.modules.map((m) => (start === true && m.id === moduleId && m.kind !== 'quiz' && m.status === 'todo' ? { ...m, status: 'in_progress', progress: Math.max(m.progress ?? 0, 5) } : m));
        return { ...x, plan: { ...x.plan, modules }, cursor: { moduleId, phase: x.cursor?.moduleId === moduleId ? x.cursor.phase ?? 'course' : 'course', summary: x.cursor?.moduleId === moduleId ? x.cursor.summary : '', updatedAt: new Date().toISOString() } };
      });
      return planView(next);
    }],

    ['POST /api/quiz/start', async (_req, { curriculumId, moduleId }) => {
      const c = await need(curriculumId);
      const module = c.plan?.modules.find((m) => m.id === moduleId);
      if (!module) throw httpError(404, 'err.unknownModule');
      const domain = c.discovery.official.domains.find((d) => d.id === module.domainId);
      const gaps = (c.gaps ?? []).filter((g) => g.domainId === module.domainId && !g.resolvedAt).slice(-4);
      const tips = (c.discovery.research?.tips?.items ?? []).slice(0, 4).map((t) => t.tip);
      const questions = await track(curriculumId, async () => generateQuiz(await apiKey(), { cert: certOf(c), module, domain, gaps, tips }))
        .catch((e) => { throw httpError(502, e.message); });
      await store.update(`curricula/${curriculumId}`, (x) => ({ ...x, quizzes: { ...x.quizzes, [moduleId]: { ...x.quizzes?.[moduleId], current: { questions, at: new Date().toISOString() } } } }));
      return { moduleId, title: module.title, questions: publicQuiz(questions) };
    }],

    ['POST /api/quiz/submit', async (_req, { curriculumId, moduleId, answers }) => {
      const c = await need(curriculumId);
      const module = c.plan?.modules.find((m) => m.id === moduleId);
      const current = c.quizzes?.[moduleId]?.current;
      if (!module || !current) throw httpError(409, 'err.noQuiz');
      if (!Array.isArray(answers)) throw httpError(400, 'err.badAnswers');
      const r = scoreQuiz(current.questions, answers);
      const newGaps = quizGaps(module, current.questions, r.results, c.gaps);
      const next = await store.update(`curricula/${curriculumId}`, (x) => ({
        ...x,
        gaps: [...(x.gaps ?? []), ...newGaps],
        plan: r.passed ? { ...x.plan, modules: x.plan.modules.map((m) => (m.id === moduleId ? { ...m, status: 'done', progress: 100 } : m)) } : x.plan,
        quizzes: { ...x.quizzes, [moduleId]: { attempts: [...(x.quizzes[moduleId].attempts ?? []), { at: new Date().toISOString(), score: r.score, correctCount: r.correctCount, total: r.total }], current: null } },
      }));
      await appendMessage(curriculumId, { role: 'assistant', content: quizSummary(module, r), kind: 'quiz', moduleId });
      return { result: r, view: planView(next) };
    }],

    ['POST /api/gaps/resolve', async (_req, { curriculumId, gapId }) => {
      await need(curriculumId);
      let found = false;
      const next = await store.update(`curricula/${curriculumId}`, (x) => ({
        ...x,
        gaps: (x.gaps ?? []).map((g) => (g.id === gapId && !g.resolvedAt ? ((found = true), { ...g, resolvedAt: new Date().toISOString() }) : g)),
      }));
      if (!found) throw httpError(404, 'err.unknownGap');
      return planView(next);
    }],

    // Streaming SSE : { curriculumId, message } -> data: {delta} ... data: {done:true}
    ['POST /api/chat', async (req, { curriculumId, message, voice = false, channel }, res) => {
      message = String(message ?? '').trim();
      if (!message) throw httpError(400, 'err.emptyMessage');
      const key = await apiKey();
      const profile = await store.get('profile');
      const curriculum = await store.get(`curricula/${curriculumId}`);
      if (!key || !profile || !curriculum) throw httpError(409, 'err.onboardingOrCursus');

      const now = () => new Date().toISOString();
      const inCh = channel === 'voice' ? 'voice' : 'text';
      const outCh = voice === true ? 'voice' : 'text';
      const scope = curriculum.cursor?.moduleId ?? firstLessonId(curriculum); // le tour appartient au module où il a commencé
      const userMsg = { role: 'user', content: message, channel: inCh, at: now(), ...(scope ? { moduleId: scope } : {}) };
      const session = await store.get(`sessions/${curriculumId}`, { messages: [] });
      const history = [...inScope(session.messages, curriculum, scope), userMsg]; // le coach ne voit que la conversation de ce module
      const context = [coachContext(curriculum.discovery), planContext(curriculum)].filter(Boolean).join('\n\n');
      const llmMessages = [
        { role: 'system', content: `${systemPrompt({ name: profile.name, certification: curriculum.certification, context, language: curriculum.language, persona: profile.persona })}${voice === true ? `\n\n${SPOKEN_ADDENDUM}` : ''}` },
        ...history.slice(-HISTORY_WINDOW).map(({ role, content }) => ({ role, content })),
      ];
      // ajout atomique : la création en arrière-plan peut écrire dans la même session
      const append = (...msgs) => store.update(`sessions/${curriculumId}`, (s) => ({ messages: [...s.messages, ...msgs] }), { messages: [] });

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      let reply = '';
      const toolLog = [];
      const modProgressOf = (c, mid) => c?.plan?.modules.find((m) => m.id === mid)?.progress ?? 0;
      const before = { global: computeProgress(curriculum).global, cursor: curriculum.cursor?.moduleId };
      try {
        await track(curriculumId, async () => {
          const runTool = async (name, args) => {
            let result;
            await store.update(`curricula/${curriculumId}`, (c) => {
              const out = applyTool(c, name, args);
              result = out.result;
              return out.curriculum;
            });
            toolLog.push({ name, args, ok: !!result.ok });
            if (result.ok) send({ tool: name });
            return result;
          };
          const tools = curriculum.plan ? TOOLS : undefined;
          for await (const delta of chatStream(key, llmMessages, { signal: abort.signal, tools, runTool })) {
            reply += delta;
            send({ delta });
          }
        });

        // --- avancement : état après le tour, filet de sécurité, journal, et valeurs renvoyées au client ---
        let after = await store.get(`curricula/${curriculumId}`);
        let cur = after?.plan?.modules.find((m) => m.id === after.cursor?.moduleId);
        const lesson = cur && cur.kind !== 'quiz';
        const touched = toolLog.some((t) => t.ok && ['set_module_status', 'save_cursor'].includes(t.name));
        let floor = false;
        // Si le coach n'a déclaré aucun avancement alors qu'il vient d'enseigner (réponse substantielle, phase cours),
        // on estime un léger avancement (+5 %, plafonné à 60 %) : la barre ne reste pas figée à cause d'un outil non appelé.
        if (lesson && !touched && cur.status !== 'done' && (after.cursor.phase ?? 'course') === 'course' && reply.length >= 400 && (cur.progress ?? 0) < 60) {
          floor = true;
          after = await store.update(`curricula/${curriculumId}`, (c) => ({
            ...c,
            plan: { ...c.plan, modules: c.plan.modules.map((m) => (m.id === cur.id ? { ...m, status: 'in_progress', progress: Math.min(60, (m.progress ?? 0) + 5) } : m)) },
          }));
          cur = after.plan.modules.find((m) => m.id === cur.id);
        }
        const progress = computeProgress(after);
        const phase = lesson ? after.cursor.phase ?? 'course' : undefined;
        const summary = (t) => `${t.ok ? '' : '✗'}${t.name}(${[t.args.phase, t.args.status, t.args.percent !== undefined ? `${t.args.percent}%` : null, t.args.covered !== undefined ? `covered=${t.args.covered}` : null].filter(Boolean).join(',')})`;
        log(`[coach] ${new Date().toTimeString().slice(0, 8)} tour ${curriculumId.slice(0, 8)} module=${cur?.id ?? '-'}${phase ? ` phase=${phase}` : ''} | outils : ${toolLog.length ? toolLog.map(summary).join(' ') : 'aucun'} | module ${modProgressOf(curriculum, cur?.id)}→${cur?.progress ?? 0} % | global ${before.global}→${progress.global} %${floor ? ' | +5 % estimé (aucun outil d\'avancement appelé)' : ''}`);

        await append(userMsg, { role: 'assistant', content: reply, channel: outCh, at: now(), ...(scope ? { moduleId: scope } : {}), ...(phase ? { phase } : {}) });
        send({ done: true, ...(phase ? { phase } : {}), progress: { global: progress.global, moduleId: cur?.id ?? null, module: cur?.progress ?? null } });
      } catch (e) {
        // on conserve le message utilisateur (et la réponse partielle) pour ne rien perdre
        await append(userMsg, ...(reply ? [{ role: 'assistant', content: reply, channel: outCh, partial: true, at: now(), ...(scope ? { moduleId: scope } : {}) }] : []));
        send({ error: e.message });
      }
      res.end();
    }],
  ]);

  return createServer((req, res) => withLang(req.headers['x-lang'], async () => {
    const { pathname } = new URL(req.url, 'http://x');
    try {
      assertLocal(req);
      if (pathname === '/favicon.ico') return void res.writeHead(204).end();
      const handler = routes.get(`${req.method} ${pathname}`);
      if (handler) {
        const out = await handler(req, req.method === 'POST' ? await readBody(req) : {}, res);
        if (!res.headersSent) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
        return;
      }
      const root = PUBLIC_FILES.has(pathname) ? PUBLIC_DIR : WEB_DIR;
      const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
      if (file !== root && !file.startsWith(root + sep)) throw httpError(403, 'err.forbidden'); // « web-evil » ne doit pas passer pour « web »
      const body = await readFile(file).catch(() => { throw httpError(404, 'err.notFound'); });
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch (e) {
      if (res.headersSent) return res.end();
      res.writeHead(e.status ?? 500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }));
    }
  }));
}
