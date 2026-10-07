import { htmlToText } from '../html.js';
import { tt } from '../i18n.js';
import { fallbackPlan, generatePlan, planIntro, totalHours } from '../coach/planner.js';
import { buildDebrief, scoreConfidence } from './debrief.js';
import { extractOutline, fetchPageText } from './official.js';
import { emptyResearch, researchInto } from './research.js';
import { hostOf } from './sources.js';
import { fetchPublicText } from './url.js';

/** Étapes visibles de la création d'un cursus ; `pct` = avancement une fois l'étape terminée. */
export const STEPS = [
  { key: 'fetch', pct: 20 },
  { key: 'extract', pct: 40 },
  { key: 'resources', pct: 60 },
  { key: 'qcm', pct: 80 },
  { key: 'plan', pct: 100 },
];

export const DEFAULT_PROFILE = { experience: 'intermediaire', hoursPerWeek: 5, examDate: null };

export class StepError extends Error {
  constructor(message, { needsProgramme = false } = {}) {
    super(message);
    this.needsProgramme = needsProgramme;
  }
}

/** Contexte de recherche : libellé d'examen + hôtes considérés comme officiels (celui de l'URL fournie). */
export const certOf = (c) => ({
  name: c.certification ?? c.name,
  examCode: c.cert?.examCode ?? null,
  officialHosts: [hostOf(c.officialUrl)].filter(Boolean),
  language: c.language,
});

/**
 * Exécute (ou reprend) la création d'un cursus, étape par étape. Idempotent : les étapes déjà terminées
 * (`creation.done`) sont sautées, donc « Réessayer » repart de l'étape en échec.
 * `patch(fn)` applique fn au cursus (no-op si supprimé) ; `get()` le relit.
 */
export async function runPipeline({ apiKey, get, patch, isCancelled, appendMessage, name }) {
  let pageText;

  const begin = (key) => patch((c) => ({ ...c, creation: { ...c.creation, status: 'running', active: key, error: null, failedStep: null } }));
  const finish = (step) => patch((c) => ({ ...c, creation: { ...c.creation, done: [...c.creation.done, step.key], percent: step.pct, active: null } }));
  const fail = (key, e) => patch((c) => ({ ...c, creation: { ...c.creation, status: 'failed', active: null, failedStep: key, error: e.message, needsProgramme: !!e.needsProgramme } }));

  const stepFns = {
    async fetch(c) {
      pageText = await fetchPageText(c.officialUrl);
      const annex = await Promise.all((c.annexLinks ?? []).map(async (url) => {
        try {
          return { url, ok: true, excerpt: htmlToText(await fetchPublicText(url), 6000) };
        } catch (e) {
          return { url, ok: false, error: e.message };
        }
      }));
      await patch((x) => ({ ...x, discovery: { ...x.discovery, annex } }));
    },

    async extract(c) {
      pageText ??= await fetchPageText(c.officialUrl);
      const official = await extractOutline(apiKey, certOf(c), pageText, { url: c.officialUrl });
      if (!official.domains.length) throw new StepError(tt('err.noDomainPage'), { needsProgramme: true });
      await patch((x) => ({ ...x, certification: official.title ?? x.name, cert: { examCode: official.examCode }, discovery: { ...x.discovery, official } }));
    },

    async resources(c) {
      const research = c.discovery?.research ?? emptyResearch();
      await researchInto(research, apiKey, ['resources', 'tips'], certOf(c));
      await patch((x) => ({ ...x, discovery: { ...x.discovery, research } }));
    },

    async qcm(c) {
      const research = c.discovery.research ?? emptyResearch();
      await researchInto(research, apiKey, ['qcm'], certOf(c));
      await patch((x) => ({ ...x, discovery: { ...x.discovery, research } }));
    },

    async plan(c) {
      const domains = c.discovery.official.domains;
      const budget = totalHours(DEFAULT_PROFILE);
      let plan;
      try {
        plan = await generatePlan(apiKey, { cert: certOf(c), discovery: c.discovery, profile: DEFAULT_PROFILE, budget });
      } catch {
        plan = fallbackPlan(domains, {}, budget);
      }
      const { official, research, annex } = c.discovery;
      const confidence = scoreConfidence({ official, research });
      const debrief = buildDebrief({ name, cert: certOf(c), official, research, confidence, annex });
      const done = await patch((x) => ({
        ...x,
        plan,
        cursor: { moduleId: plan.modules[0].id, phase: 'course', summary: '', updatedAt: new Date().toISOString() },
        discovery: { ...x.discovery, status: 'done', confidence, debrief, finishedAt: new Date().toISOString() },
      }));
      if (!done) return;
      await appendMessage({ role: 'assistant', content: debrief, kind: 'debrief' });
      await appendMessage({ role: 'assistant', content: planIntro({ name, plan, budget }), kind: 'plan' });
    },
  };

  for (const step of STEPS) {
    const c = await get();
    if (!c || isCancelled()) return;
    if (c.creation.done.includes(step.key)) continue;
    await begin(step.key);
    try {
      await stepFns[step.key](await get());
    } catch (e) {
      await fail(step.key, e);
      return;
    }
    if (isCancelled()) return;
    await finish(step);
  }
  await patch((c) => ({ ...c, creation: { ...c.creation, status: 'done' } }));
}
