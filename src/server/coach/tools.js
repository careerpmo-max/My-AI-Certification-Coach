import { randomUUID } from 'node:crypto';

/** Outils exposés au coach (function calling) pour mémoriser progression, lacunes et position. */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_module_status',
      description: 'Change le statut et l\'avancement d\'un module du programme (jamais un QCM récap).',
      parameters: { type: 'object', properties: { moduleId: { type: 'string' }, status: { type: 'string', enum: ['todo', 'in_progress', 'done'] }, percent: { type: 'integer', description: 'Avancement estimé 1-99 (statut in_progress)' } }, required: ['moduleId', 'status'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_gap',
      description: 'Enregistre une lacune identifiée chez l\'apprenant.',
      parameters: { type: 'object', properties: { domainId: { type: 'string' }, note: { type: 'string' } }, required: ['domainId', 'note'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_cursor',
      description: 'Mémorise la position exacte de l\'apprenant pour la reprise (module, phase pédagogique, résumé du point atteint).',
      parameters: { type: 'object', properties: { moduleId: { type: 'string' }, summary: { type: 'string', description: 'Où vous en êtes : concepts déjà expliqués et restants (phase cours), points vérifiés/lacunes (phase vérification), choix de l\'apprenant (phase décision)' }, phase: { type: 'string', enum: ['course', 'check', 'decision'], description: 'course = cours en cours ; check = questions de vérification ; decision = attente du choix avancer/réviser' }, covered: { type: 'integer', description: 'Phase cours : nombre d\'objectifs du sous-module DÉJÀ expliqués (0 à N). Sert à calculer l\'avancement.' } }, required: ['moduleId', 'summary'] },
    },
  },
];

/**
 * Avancement (0–99) d'un sous-module d'après sa phase pédagogique : cours = 10 % + 60 % × objectifs expliqués / total ;
 * vérification = 75 % ; décision = 90 %. Jamais 100 : un module n'est terminé que par set_module_status « done » (ou le QCM récap).
 */
export function phaseProgress(mod, phase, covered) {
  if (phase === 'check') return 75;
  if (phase === 'decision') return 90;
  const total = Math.max(1, mod.objectives?.length ?? 1);
  const done = Number.isFinite(Number(covered)) ? Math.min(Math.max(Math.round(Number(covered)), 0), total) : 0;
  return 10 + Math.round((60 * done) / total);
}

/** Applique un appel d'outil à un cursus ; renvoie { curriculum, result }. Pur, valide tous les identifiants. */
export function applyTool(c, name, args, now = new Date().toISOString()) {
  const modules = c.plan?.modules ?? [];
  const bad = (error) => ({ curriculum: c, result: { error } });
  if (name === 'set_module_status') {
    if (!modules.some((m) => m.id === args.moduleId)) return bad('module inconnu');
    if (!['todo', 'in_progress', 'done'].includes(args.status)) return bad('statut invalide');
    if (modules.find((m) => m.id === args.moduleId).kind === 'quiz') return bad('un QCM récap se valide uniquement en réussissant le quiz');
    const percent = args.status === 'done' ? 100 : args.status === 'todo' ? 0 : Math.min(99, Math.max(1, Math.round(Number(args.percent)) || 10));
    const plan = { ...c.plan, modules: modules.map((m) => (m.id === args.moduleId ? { ...m, status: args.status, progress: percent } : m)) };
    return { curriculum: { ...c, plan }, result: { ok: true } };
  }
  if (name === 'record_gap') {
    const domains = c.discovery?.official?.domains ?? [];
    if (!domains.some((d) => d.id === args.domainId)) return bad('domaine inconnu');
    const gaps = [...(c.gaps ?? []), { id: randomUUID().slice(0, 8), domainId: args.domainId, note: String(args.note).slice(0, 400), source: 'coach', at: now }];
    return { curriculum: { ...c, gaps }, result: { ok: true } };
  }
  if (name === 'save_cursor') {
    const mod = modules.find((m) => m.id === args.moduleId);
    if (!mod) return bad('module inconnu');
    const phase = ['course', 'check', 'decision'].includes(args.phase) ? args.phase : (c.cursor?.moduleId === args.moduleId ? c.cursor.phase : 'course');
    const cursor = { moduleId: args.moduleId, phase, summary: String(args.summary).slice(0, 600), updatedAt: now };
    // l'avancement se déduit de la phase pédagogique : il ne dépend plus du seul appel à set_module_status
    const derived = mod.kind === 'quiz' || mod.status === 'done' ? null : phaseProgress(mod, phase, args.covered);
    const next = derived === null ? modules : modules.map((m) => (m.id === mod.id ? { ...m, status: 'in_progress', progress: Math.max(m.progress ?? 0, derived) } : m));
    return { curriculum: { ...c, cursor, plan: { ...c.plan, modules: next } }, result: { ok: true, ...(derived === null ? {} : { progress: Math.max(mod.progress ?? 0, derived) }) } };
  }
  return bad('outil inconnu');
}
