import { AsyncLocalStorage } from 'node:async_hooks';
import { PRICING } from './config.js';

/** Enregistre les appels OpenAI d'un contexte (cursus) sans que openai.js connaisse le stockage. */
const als = new AsyncLocalStorage();
export const withUsage = (entries, fn) => als.run(entries, fn);
export const recordCall = (entry) => als.getStore()?.push(entry);

/** Regroupe les appels par étape du parcours. */
export function groupOf(label) {
  if (label === 'chat') return 'chat';
  if (label === 'diagnostic') return 'diagnostic';
  if (label === 'study_plan') return 'plan';
  if (label.startsWith('quiz')) return 'quiz';
  return 'startup'; // extraction du programme + recherches web
}

const blank = () => ({ calls: 0, input: 0, output: 0, searches: 0 });

/** Cumule des entrées {label, model, input, output, searches} dans un objet usage persistable. */
export function mergeUsage(prev, entries) {
  const u = structuredClone(prev ?? { ...blank(), byGroup: {}, byModel: {} });
  for (const e of entries) {
    const g = (u.byGroup[groupOf(e.label)] ??= blank());
    const m = (u.byModel[e.model] ??= { input: 0, output: 0 });
    for (const t of [u, g]) {
      t.calls += 1;
      t.input += e.input ?? 0;
      t.output += e.output ?? 0;
      t.searches += e.searches ?? 0;
    }
    m.input += e.input ?? 0;
    m.output += e.output ?? 0;
  }
  return u;
}

/** Coût indicatif en USD, ou null si un modèle n'a pas de tarif connu. Tarifs modifiables (config.js). */
export function estimateCost(usage, pricing = PRICING) {
  if (!usage) return 0;
  let usd = (usage.searches / 1000) * pricing.searchPer1k;
  for (const [model, t] of Object.entries(usage.byModel)) {
    const p = pricing.models[model];
    if (!p) return null;
    usd += (t.input * p.in + t.output * p.out) / 1e6;
  }
  return usd;
}

export function usageView(usage) {
  const u = usage ?? { ...blank(), byGroup: {}, byModel: {} };
  return { calls: u.calls, tokens: u.input + u.output, searches: u.searches, byGroup: u.byGroup, costUsd: estimateCost(usage) };
}
