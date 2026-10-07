import { randomUUID } from 'node:crypto';
import { MODELS } from '../config.js';
import { tt } from '../i18n.js';
import { writeIn } from './language.js';
import { respond } from '../openai.js';

export const PASS_RATIO = 0.7;
export const QUIZ_SIZE = 8;

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
        required: ['type', 'question', 'options', 'correctIndices', 'explanation'],
        properties: {
          type: { type: 'string', enum: ['single', 'multiple'] },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndices: { type: 'array', items: { type: 'integer' } },
          explanation: { type: 'string' },
        },
      },
    },
  },
};

const INSTRUCTIONS = `Tu écris un QCM de fin de module, au format le plus proche possible d'un examen de certification technique.
Règles : ${QUIZ_SIZE} questions ORIGINALES (jamais de questions réelles d'examen) ; la plupart en mini-scénarios professionnels (« Vous devez… Quelle solution ? ») ; mélange de choix unique (type "single", 4 options, 1 bonne) et de choix multiples (type "multiple", 5 options, 2 ou 3 bonnes, dont l'énoncé précise « Sélectionnez N ») ; distracteurs plausibles ; couvre les objectifs du module ; insiste sur les lacunes fournies. L'explication justifie la bonne réponse ET écarte les pièges.`;

/** Valide une question : type/nombre de bonnes réponses cohérents, indices dans les bornes, sans doublon. */
export function validQuestion(q) {
  const n = q.options.length;
  const idx = q.correctIndices;
  if (n < 4 || n > 6 || !idx.length || new Set(idx).size !== idx.length) return false;
  if (idx.some((i) => i < 0 || i >= n)) return false;
  return q.type === 'single' ? idx.length === 1 : idx.length >= 2 && idx.length < n;
}

export async function generateQuiz(apiKey, { cert, module, domain, gaps = [], tips = [], signal }) {
  const input = [
    `Certification : ${cert.name}`,
    `Module : ${module.title} (domaine « ${domain?.name ?? module.domainId} »)`,
    `Objectifs : ${module.objectives.join(' ; ')}`,
    gaps.length ? `Lacunes à cibler : ${gaps.map((g) => g.note).join(' | ')}` : '',
    tips.length ? `Pièges d'examen rapportés par des candidats : ${tips.join(' | ')}` : '',
  ].filter(Boolean).join('\n');
  const { json } = await respond(apiKey, { model: MODELS.text, instructions: `${INSTRUCTIONS}\n${writeIn(cert.language)}`, input, schema: SCHEMA, schemaName: 'quiz_module', signal });
  const questions = json.questions.filter(validQuestion).slice(0, QUIZ_SIZE);
  if (questions.length < 3) throw new Error(tt('err.quizUnusable'));
  return questions;
}

/** Version client : sans réponses ni explications ; `pick` indique combien de choix cocher. */
export const publicQuiz = (qs) => qs.map((q) => ({ type: q.type, question: q.question, options: q.options, pick: q.correctIndices.length }));

/** Correction : une question est juste si l'ensemble des choix est exactement l'ensemble attendu. */
export function scoreQuiz(questions, answers) {
  const results = questions.map((q, i) => {
    const given = [...new Set(answers?.[i] ?? [])].sort();
    const expected = [...q.correctIndices].sort();
    return { correct: given.length === expected.length && given.every((v, k) => v === expected[k]), correctIndices: expected, given, explanation: q.explanation };
  });
  const correctCount = results.filter((r) => r.correct).length;
  const score = questions.length ? correctCount / questions.length : 0;
  return { results, correctCount, total: questions.length, score, passed: score >= PASS_RATIO };
}

/** Lacunes issues des questions ratées (une par question, dédupliquées sur la note). */
export function quizGaps(module, questions, results, existing = [], now = new Date().toISOString()) {
  const known = new Set(existing.map((g) => g.note));
  return questions.flatMap((q, i) => {
    if (results[i].correct) return [];
    const note = tt('gap.quiz', { title: module.title, q: q.question.slice(0, 140), expl: q.explanation.slice(0, 220) });
    return known.has(note) ? [] : [{ id: randomUUID().slice(0, 8), domainId: module.domainId, note, source: 'quiz', at: now }];
  });
}

export function quizSummary(module, r) {
  const params = { title: module.title, ok: r.correctCount, total: r.total, pct: Math.round(r.score * 100), target: PASS_RATIO * 100 };
  return tt(r.passed ? 'quiz.summaryPass' : 'quiz.summaryFail', params);
}
