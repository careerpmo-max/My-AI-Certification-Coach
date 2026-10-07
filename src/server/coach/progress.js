/** Meilleur score (0–1) parmi les tentatives d'un module, ou null. */
export const bestScore = (q) => (q?.attempts?.length ? Math.max(...q.attempts.map((a) => a.score)) : null);

/** Avancement d'un module 0–100 (rétro-compatible : à défaut de `progress`, dérivé du statut). */
export const modProgress = (m) => m.progress ?? (m.status === 'done' ? 100 : 0);

const mid = (d) => (d.weightMin + d.weightMax) / 2;

/**
 * Progression pure et testable.
 * domaine % = heures des modules terminés / heures totales du domaine ; global % = moyenne pondérée par le poids officiel.
 */
export function computeProgress(curriculum) {
  const domains = curriculum.discovery?.official?.domains ?? [];
  const modules = curriculum.plan?.modules ?? [];
  const byDomain = domains.map((d) => {
    const ms = modules.filter((m) => m.domainId === d.id);
    const total = ms.reduce((a, m) => a + m.hours, 0);
    const done = ms.reduce((a, m) => a + (m.hours * modProgress(m)) / 100, 0);
    const bests = ms.map((m) => bestScore(curriculum.quizzes?.[m.id])).filter((b) => b !== null);
    return {
      id: d.id,
      name: d.name,
      weight: mid(d),
      percent: total ? Math.round((100 * done) / total) : 0,
      quizAvg: bests.length ? Math.round((100 * bests.reduce((a, b) => a + b, 0)) / bests.length) : null,
    };
  });
  const wsum = byDomain.reduce((a, d) => a + d.weight, 0);
  const global = wsum ? Math.round(byDomain.reduce((a, d) => a + d.weight * d.percent, 0) / wsum) : 0;
  return { global, byDomain };
}
