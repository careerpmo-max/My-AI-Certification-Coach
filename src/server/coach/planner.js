import { MODELS } from '../config.js';
import { tt } from '../i18n.js';
import { writeIn } from './language.js';
import { respond } from '../openai.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'modules'],
  properties: {
    overview: { type: 'string' },
    modules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'domainId', 'objectives', 'hours', 'rationale'],
        properties: {
          title: { type: 'string' },
          domainId: { type: 'string' },
          objectives: { type: 'array', items: { type: 'string' } },
          hours: { type: 'number' },
          rationale: { type: 'string' },
        },
      },
    },
  },
};

const DAY = 86400000;

/** Budget d'heures : heures/semaine × semaines jusqu'à l'examen (6 semaines par défaut), borné. */
export function totalHours({ hoursPerWeek, examDate }, now = Date.now()) {
  const hpw = Math.min(40, Math.max(1, Number(hoursPerWeek) || 5));
  const t = Date.parse(examDate);
  const weeks = Number.isFinite(t) && t > now ? Math.min(26, Math.max(1, Math.ceil((t - now) / (7 * DAY)))) : 6;
  return { hours: Math.min(200, Math.max(8, Math.round(hpw * weeks))), weeks, hoursPerWeek: hpw };
}

const mid = (d) => (d.weightMin + d.weightMax) / 2;
/** Priorité d'un domaine : poids officiel × (besoin + plancher). */
const need = (d, levels) => mid(d) * (1 - (levels[d.id]?.score ?? 0) + 0.15);

/** Ajoute, après le dernier module de chaque bloc (domaine), une étape « QCM récap » validée uniquement par le quiz. */
export function withRecapQuizzes(modules, domains) {
  const existing = new Set(modules.filter((m) => m.kind === 'quiz').map((m) => m.domainId));
  const lastLesson = new Map();
  modules.forEach((m, i) => m.kind !== 'quiz' && lastLesson.set(m.domainId, i));
  const out = [];
  modules.forEach((m, i) => {
    out.push(m);
    if (m.kind === 'quiz' || lastLesson.get(m.domainId) !== i || existing.has(m.domainId)) return;
    const lessons = modules.filter((x) => x.domainId === m.domainId && x.kind !== 'quiz');
    out.push({
      id: `q-${m.domainId}`,
      kind: 'quiz',
      status: 'todo',
      progress: 0,
      title: tt('plan.quizTitle', { domain: domains.find((d) => d.id === m.domainId)?.name ?? m.domainId }),
      domainId: m.domainId,
      objectives: lessons.flatMap((x) => [x.title, ...x.objectives]).slice(0, 14),
      hours: 0.5,
      rationale: tt('plan.quizRationale'),
    });
  });
  return out;
}

const finalize = (modules, source, overview, domains) => ({
  source,
  overview,
  generatedAt: new Date().toISOString(),
  modules: withRecapQuizzes(modules.map((m, i) => ({ id: `m${i + 1}`, kind: 'lesson', status: 'todo', progress: 0, ...m, hours: Math.round(m.hours * 10) / 10 })), domains),
});

/** Plan déterministe de secours : modules par groupes de sous-domaines, heures ∝ priorité. */
export function fallbackPlan(domains, levels, budget) {
  const wsum = domains.reduce((a, d) => a + need(d, levels), 0);
  const modules = [];
  for (const d of domains) {
    const groups = [];
    const subs = d.subdomains?.length ? d.subdomains : [d.name];
    for (let i = 0; i < subs.length; i += 3) groups.push(subs.slice(i, i + 3));
    const hours = (budget.hours * need(d, levels)) / wsum / groups.length;
    groups.forEach((g, i) => modules.push({
      title: groups.length > 1 ? `${d.name} — partie ${i + 1}` : d.name,
      domainId: d.id,
      objectives: g,
      hours,
      rationale: tt('plan.rationale', { min: d.weightMin, max: d.weightMax, level: Math.round((levels[d.id]?.score ?? 0) * 100) }),
    }));
  }
  return finalize(modules, 'fallback', tt('plan.overviewFallback'), domains);
}

/** Valide un plan LLM : domaines connus, tous couverts, volumes plausibles. */
export function validatePlan(plan, domains) {
  const ids = new Set(domains.map((d) => d.id));
  const ms = plan.modules;
  if (ms.length < domains.length || ms.length > 24) return 'nombre de modules hors bornes';
  if (ms.some((m) => !ids.has(m.domainId) || !(m.hours > 0) || !m.objectives.length)) return 'module invalide';
  if (domains.some((d) => !ms.some((m) => m.domainId === d.id))) return 'domaine non couvert';
  return null;
}

export async function generatePlan(apiKey, { cert, discovery, levels = {}, gaps = [], profile, budget, signal }) {
  const domains = discovery.official.domains;
  const input = [
    `Certification : ${cert.name}`,
    `Niveau initial ${Object.keys(levels).length ? 'mesuré par diagnostic' : 'INCONNU (pas encore de diagnostic : suppose un profil intermédiaire)'}.`,
    `Profil : expérience ${profile.experience}, ${budget.hoursPerWeek} h/semaine, ${budget.weeks} semaine(s) → budget total ≈ ${budget.hours} h.`,
    'Domaines (poids officiel, niveau initial 0–1) :',
    ...domains.map((d) => `- id=${d.id} ${d.name} : ${d.weightMin}–${d.weightMax} %, niveau ${levels[d.id]?.score ?? 0}, sous-domaines : ${d.subdomains.join('; ') || 'n/a'}`),
    gaps.length ? `Lacunes détectées : ${gaps.map((g) => `${g.domainId} (${g.note})`).join(' | ')}` : 'Aucune lacune détectée.',
    discovery.annex?.some((a) => a.ok) ? `Documents fournis par l'apprenant (extraits) :\n${discovery.annex.filter((a) => a.ok).map((a) => `- ${a.url} : ${a.excerpt.slice(0, 1500)}`).join('\n')}` : '',
    discovery.research?.tips?.items?.length ? `Tips de candidats sourcés : ${discovery.research.tips.items.slice(0, 5).map((t) => t.tip).join(' | ')}` : '',
  ].filter(Boolean).join('\n');
  const { json } = await respond(apiKey, {
    model: MODELS.text,
    instructions: `Tu construis un programme d'apprentissage personnalisé. ${writeIn(cert.language)} Règles : 4 à 20 modules ordonnés du fondamental vers l'avancé ; chaque domaine officiel a au moins un module (domainId exact) ; heures totales ≈ budget ; plus d'heures pour les domaines à fort poids ET faible niveau ; objectifs concrets et vérifiables par QCM ; aucun contenu hors programme officiel.`,
    input,
    schema: SCHEMA,
    schemaName: 'study_plan',
    signal,
  });
  const err = validatePlan(json, domains);
  if (err) throw new Error(`plan LLM invalide : ${err}`);
  return finalize(json.modules, 'llm', json.overview, domains);
}

/** Message coach résumant le diagnostic et le plan (déterministe : pas d'appel API supplémentaire), dans la langue du cursus. */
export function planSummary({ name, domains, levels, plan, budget }) {
  const L = [tt('plan.sumHead', { name }), '', tt('plan.sumLevels')];
  for (const d of domains) L.push(`  – ${d.name} : ${Math.round((levels[d.id]?.score ?? 0) * 100)} %`);
  L.push('', tt('plan.sumProgram', { hours: budget.hours, weeks: budget.weeks, hpw: budget.hoursPerWeek }));
  if (plan.overview) L.push(plan.overview);
  plan.modules.filter((m) => m.kind !== 'quiz').forEach((m, i) => L.push(`  ${i + 1}. ${m.title} — ${m.hours} h`));
  L.push('', tt('plan.sumStart', { title: plan.modules[0].title }));
  return L.join('\n');
}

/** Message d'accueil du plan initial (avant diagnostic), dans la langue du cursus. */
export function planIntro({ name, plan, budget }) {
  const L = [tt('plan.introHead', { name, hours: budget.hours, hpw: budget.hoursPerWeek, weeks: budget.weeks })];
  if (plan.overview) L.push(plan.overview);
  L.push('', tt('plan.blocks'));
  plan.modules.filter((m) => m.kind !== 'quiz').forEach((m, i) => L.push(`  ${i + 1}. ${m.title} — ${m.hours} h`));
  L.push('', tt('plan.introTail'));
  return L.join('\n');
}

/** Contexte de plan pour le prompt du coach (état + curseur + lacunes). */
export function planContext(c) {
  if (!c.plan) return '';
  const cur = c.plan.modules.find((m) => m.id === c.cursor?.moduleId);
  const L = ['Programme de l\'apprenant (id : titre [statut]) :', ...c.plan.modules.map((m) => `- ${m.id} : ${m.title} [${m.status}${m.kind === 'quiz' ? ', QCM récap : validé uniquement par le quiz' : `, ${m.progress ?? 0} %`}] (domaine ${m.domainId}; objectifs : ${m.objectives.join('; ')})`)];
  const PHASES = { course: 'phase 1 (cours en cours)', check: 'phase 2 (vérification)', decision: 'phase 3 (attente du choix avancer/réviser)' };
  if (cur) L.push(`Position actuelle : ${cur.id} « ${cur.title} » — ${PHASES[c.cursor.phase] ?? PHASES.course}${c.cursor.summary ? ` — dernier point : ${c.cursor.summary}` : ''}`);
  const open = (c.gaps ?? []).filter((g) => !g.resolvedAt);
  if (open.length) L.push('Lacunes connues :', ...open.slice(-8).map((g) => `- (${g.domainId}) ${g.note}`));
  L.push('Outils : appelle set_module_status (avec percent = avancement estimé 1–99 tant que non terminé) quand un module est démarré, avance ou est terminé (100 uniquement si l\'apprenant a vraiment maîtrisé les objectifs ; jamais sur un QCM récap), record_gap quand tu identifies une lacune, save_cursor (avec phase = course | check | decision, covered = nombre d\'objectifs du sous-module déjà expliqués, et un résumé de ce qui est expliqué et de ce qui reste) APRÈS CHAQUE RÉPONSE d\'enseignement et à chaque changement de phase : c\'est ce qui fait avancer la barre de progression, pour reprendre exactement là où vous en êtes. Quand l\'apprenant choisit d\'avancer après la phase 3, passe le module à done puis save_cursor sur le sous-module suivant (phase course). Ne mentionne pas ces appels à l\'apprenant.');
  return L.join('\n');
}
