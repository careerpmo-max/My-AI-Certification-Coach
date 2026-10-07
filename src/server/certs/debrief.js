import { tt } from '../i18n.js';

const LEVELS = [[80, 'high'], [50, 'medium'], [0, 'low']];

/** Score de confiance déterministe (pas d'auto-évaluation du LLM) avec ses raisons, dans la langue courante. */
export function scoreConfidence({ official, research }) {
  let score = 0;
  const reasons = [];
  const add = (pts, ok, yes, no) => {
    if (ok) score += pts;
    reasons.push(`${ok ? '✔' : '✘'} ${ok ? yes : no}`);
  };
  const usable = official.status === 'ok' || official.status === 'partial';
  add(40, official.status === 'ok', tt('conf.ok'), usable ? tt('conf.partial', { warnings: official.warnings.join(' ; ') }) : tt('conf.failed', { error: official.error ?? tt('conf.failedGeneric') }));
  if (official.status === 'partial') score += 20;
  add(10, !!official.lastUpdated, tt('conf.date', { date: official.lastUpdated }), tt('conf.noDate'));
  add(10, !!official.weightsConsistent, tt('conf.weights'), tt('conf.noWeights'));
  const { qcm, resources, tips } = research;
  add(10, qcm.items.length >= 3, tt('conf.qcm', { n: qcm.items.length }), tt('conf.qcmFew', { n: qcm.items.length }));
  add(10, resources.items.length >= 3, tt('conf.res', { n: resources.items.length }), tt('conf.resFew', { n: resources.items.length }));
  const tipHosts = new Set(tips.items.flatMap((t) => t.sources.map((s) => new URL(s.url).hostname)));
  add(10, tips.items.length >= 3 && tipHosts.size >= 2, tt('conf.tips', { n: tips.items.length, h: tipHosts.size }), tt('conf.tipsFew'));
  add(10, [...qcm.items, ...resources.items].some((i) => i.tier === 'official'), tt('conf.official'), tt('conf.noOfficial'));
  const levelKey = LEVELS.find(([min]) => score >= min)[1];
  return { score: Math.min(score, 100), levelKey, level: tt(`level.${levelKey}`), reasons, unreliableProgramme: !usable };
}

const pct = (d) => (d.weightMin === d.weightMax ? `${d.weightMin} %` : `${d.weightMin}–${d.weightMax} %`);
const tierTag = (t) => (t === 'official' ? tt('debrief.tierOfficial') : tt('debrief.tierRecognized'));
const top = (items, n = 6) => items.slice(0, n);
const flag = (x) => (x.verification === 'blocked' ? ` ${tt('debrief.unverified')}` : '');

/** Débrief lisible avec sources citées (URLs vérifiées uniquement), dans la langue du cursus. */
export function buildDebrief({ name, cert, official, research, confidence, annex = [] }) {
  const L = [tt('debrief.title', { cert: cert.name ?? cert.examCode }), ''];
  L.push(tt('debrief.s1'));
  if (official.status === 'failed') {
    L.push(tt('debrief.failed', { error: official.error }), tt('debrief.sourceTarget', { url: official.url }));
  } else {
    L.push(tt('debrief.source', { url: official.url, date: official.fetchedAt.slice(0, 10) }), tt('debrief.updated', { date: official.lastUpdated ?? tt('debrief.notIndicated') }), tt('debrief.domains'));
    for (const d of official.domains) L.push(`  – ${d.name} : ${pct(d)}${d.grounded ? '' : tt('debrief.notFound')}`);
    for (const w of official.warnings) L.push(`• ⚠ ${w}`);
  }
  if (annex.length) {
    L.push('', tt('debrief.annex'));
    for (const a of annex) L.push(`  – ${a.url} ${a.ok ? tt('debrief.annexOk') : tt('debrief.annexKo', { error: a.error })}`);
  }

  L.push('', tt('debrief.s2'));
  const { qcm, resources, tips, errors } = research;
  L.push(tt('debrief.qcm', { n: qcm.items.length }));
  for (const i of top(qcm.items)) L.push(`  – ${i.title} — ${i.provider}${i.questionCount ? `, ${tt('debrief.questions', { n: i.questionCount })}` : ''} [${tierTag(i.tier)}] ${i.url}${flag(i)}`);
  L.push(tt('debrief.res', { n: resources.items.length }));
  for (const i of top(resources.items)) L.push(`  – ${i.title} (${i.kind}, ${i.covers}) [${tierTag(i.tier)}] ${i.url}${flag(i)}`);
  L.push(tt('debrief.tipsHead', { n: tips.items.length }));
  for (const t of top(tips.items)) L.push(`  – ${t.tip}${t.domainHint ? ` (${t.domainHint})` : ''}${t.date ? ` — ${t.date}` : ''}`, ...t.sources.map((s) => `      ${tt('debrief.tipSource', { url: s.url })}${flag(s)}`));
  for (const [key, msg] of Object.entries(errors)) L.push(tt('debrief.searchFailed', { key, msg }));
  const dropped = qcm.dropped + resources.dropped + tips.dropped;
  if (dropped) L.push(tt('debrief.dropped', { n: dropped }));
  L.push(tt('debrief.dumps'));

  L.push('', tt('debrief.s3', { level: confidence.level, score: confidence.score }), ...confidence.reasons.map((r) => `  ${r}`));
  L.push('', confidence.unreliableProgramme ? tt('debrief.needProgramme', { name }) : tt('debrief.planReady', { name }));
  return L.join('\n');
}

/** Contexte compact injecté dans le prompt du coach (programme + tips), une fois la création terminée. Destiné au LLM : pas traduit. */
export function coachContext(discovery) {
  if (discovery?.status !== 'done') return '';
  const { official, research } = discovery;
  const lines = [];
  if (official.domains.length) {
    lines.push(`Programme officiel (mis à jour : ${official.lastUpdated ?? 'date inconnue'}) :`, ...official.domains.map((d) => `- ${d.name} : ${pct(d)}`));
  }
  if (research.tips.items.length) lines.push('Tips de candidats (indicatifs, sourcés) :', ...research.tips.items.slice(0, 6).map((t) => `- ${t.tip}`));
  return lines.join('\n');
}
