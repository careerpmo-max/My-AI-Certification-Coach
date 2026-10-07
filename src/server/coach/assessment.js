import { randomUUID } from 'node:crypto';
import { MODELS } from '../config.js';
import { tt } from '../i18n.js';
import { writeIn } from './language.js';
import { respond } from '../openai.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['domainId', 'question', 'options', 'correctIndex', 'explanation'],
        properties: {
          domainId: { type: 'string' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          explanation: { type: 'string' },
        },
      },
    },
  },
};

const INSTRUCTIONS = `Tu conçois un court diagnostic de niveau pour une certification technique.
Pour CHAQUE domaine fourni, écris exactement 1 QCM à choix unique (4 options, une seule bonne) de difficulté moyenne, centré sur un concept central du domaine, formulé comme une mini-situation professionnelle.
Ce sont des questions ORIGINALES de calibration : jamais de questions réelles d'examen.`;

/** Questions de diagnostic (1 QCM/domaine). Les invalides sont écartées ; un domaine sans QCM sera évalué à l'auto-évaluation seule. */
export async function generateQuestions(apiKey, cert, domains, { signal } = {}) {
  const { json } = await respond(apiKey, {
    model: MODELS.text,
    instructions: `${INSTRUCTIONS}\n${writeIn(cert.language)}`,
    input: `Certification : ${cert.name}\nDomaines :\n${domains.map((d) => `- id=${d.id} : ${d.name} (${d.subdomains?.join('; ') || 'sous-domaines non listés'})`).join('\n')}`,
    schema: SCHEMA,
    schemaName: 'diagnostic',
    signal,
  });
  const ids = new Set(domains.map((d) => d.id));
  const seen = new Set();
  return json.questions.filter((q) => {
    const ok = ids.has(q.domainId) && !seen.has(q.domainId) && q.options.length === 4 && q.correctIndex >= 0 && q.correctIndex < 4;
    if (ok) seen.add(q.domainId);
    return ok;
  });
}

/** Version client : sans la bonne réponse. */
export const publicQuestions = (qs) => qs.map(({ correctIndex, explanation, ...q }) => q);

/**
 * Score par domaine : 60 % QCM + 40 % auto-évaluation (1–5), ou auto-évaluation seule sans QCM.
 * Lacune si score < 0.5, ou auto-évaluation ≥ 4 démentie par le QCM (surconfiance).
 */
export function scoreAssessment(domains, questions, answers) {
  const levels = {};
  const gaps = [];
  for (const d of domains) {
    const a = answers.find((x) => x.domainId === d.id) ?? {};
    const q = questions.find((x) => x.domainId === d.id);
    const self = Math.min(5, Math.max(1, Number(a.self) || 1));
    const selfNorm = (self - 1) / 4;
    const mcq = q ? (a.choice === q.correctIndex ? 1 : 0) : null;
    const score = mcq === null ? selfNorm : 0.6 * mcq + 0.4 * selfNorm;
    levels[d.id] = { score: Math.round(score * 100) / 100, self, mcq };
    const overconfident = mcq === 0 && self >= 4;
    if (score < 0.5 || overconfident) {
      gaps.push({
        id: randomUUID().slice(0, 8),
        domainId: d.id,
        note: overconfident ? tt('gap.overconfident', { self, expl: q.explanation }) : mcq === 0 ? tt('gap.mcqFailed', { expl: q.explanation }) : tt('gap.selfLow', { self }),
        source: 'assessment',
        at: new Date().toISOString(),
      });
    }
  }
  return { levels, gaps };
}
