import { MODELS } from '../config.js';
import { writeIn } from '../coach/language.js';
import { tt } from '../i18n.js';
import { respond } from '../openai.js';
import { searchWeb } from './websearch.js';
import { EXCLUDED, OFFICIAL, RECOGNIZED, normalizeUrl, tierOf } from './sources.js';

const str = { type: 'string' };
const nstr = { type: ['string', 'null'] };
const list = (props) => ({
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props } } },
});

/** Libellé d'examen pour les requêtes : code d'examen + titre. */
const label = (c) => [c.examCode, c.name].filter(Boolean).join(' — ');

const CATEGORIES = {
  qcm: {
    domains: ['learn.microsoft.com', 'microsoft.com', 'whizlabs.com', 'udemy.com', 'reddit.com', 'youtube.com'],
    schema: list({
      title: str, url: str, provider: str, free: { type: 'boolean' }, questionCount: { type: ['integer', 'null'] }, note: str,
    }),
    ask: (c) => `Trouve des tests blancs / QCM GRATUITS pour ${label(c)} : practice assessment officiel de l'éditeur, extraits gratuits Whizlabs, previews gratuites Udemy, chaînes YouTube reconnues, retours utiles sur les subreddits de certification. Ne renvoie que ce qui existe réellement, avec l'URL exacte de la page. free=true seulement si l'accès gratuit est confirmé.`,
  },
  resources: {
    domains: ['learn.microsoft.com', 'azure.microsoft.com', 'microsoft.com', 'github.com', 'youtube.com'],
    schema: list({ title: str, url: str, kind: { type: 'string', enum: ['lab', 'sandbox', 'docs', 'learning_path', 'article', 'video'] }, covers: str, note: str }),
    ask: (c) => `Trouve des ressources d'apprentissage complémentaires pour ${label(c)} : labs gratuits (dépôts GitHub officiels de l'éditeur), sandboxes officielles, parcours de formation officiels, documentation officielle des services couverts par l'examen. Précise dans "covers" le service ou domaine couvert.`,
  },
  tips: {
    domains: ['reddit.com', 'learn.microsoft.com', 'techcommunity.microsoft.com', 'whizlabs.com', 'youtube.com'],
    schema: list({
      tip: str, type: { type: 'string', enum: ['pitfall', 'misunderstood', 'overweighted', 'strategy'] }, domainHint: nstr,
      sources: { type: 'array', items: str }, date: nstr,
    }),
    ask: (c) => `Trouve des retours d'expérience de candidats RÉCENTS à ${label(c)} : points souvent mal compris, pièges fréquents, domaines sur-représentés dans l'examen, conseils de préparation. Chaque tip doit citer au moins une URL source réellement consultée ; ne formule que ce que les sources disent. Si tu ne trouves rien de fiable, renvoie une liste vide. Ne révèle ni ne cherche de questions réelles d'examen.`,
  },
};

const system = (c) => `Tu es un assistant de recherche pour la préparation à une certification technique. Utilise la recherche web. Exigences : sources fiables uniquement, aucune invention d'URL ou de contenu, aucune question réelle d'examen (dumps). ${writeIn(c.language)} (champs descriptifs uniquement).`;

const STRUCTURE = (c) => `Tu transformes le résultat d'une recherche web en données structurées. N'utilise QUE le texte fourni et la liste d'URL réellement consultées : n'invente aucune URL ni information, omets ce qui n'est pas étayé. ${writeIn(c.language)} (champs descriptifs uniquement).`;

/** Garde un item seulement si chaque URL est fiable ET réellement vue/vérifiée (cf. websearch.js). */
function vet(urlOf, seen, extraOfficial) {
  const url = normalizeUrl(urlOf);
  const tier = url && tierOf(url, extraOfficial);
  return url && seen.has(url) && tier ? { url, tier, verification: seen.get(url).verification } : null;
}

/**
 * Deux temps : (1) recherche web en texte libre → sources citées ou vérifiées par téléchargement ; (2) structuration du
 * résultat par un second appel SANS outil, restreint à ces sources. Une catégorie sans aucune source renvoie `mode: 'none'`.
 */
export async function researchCategory(apiKey, key, cert, { signal, probe } = {}) {
  const cat = CATEGORIES[key];
  const extraOfficial = cert.officialHosts ?? [];
  const search = await searchWeb(apiKey, {
    key,
    instructions: system(cert),
    input: cat.ask(cert),
    domains: [...cat.domains, ...extraOfficial],
    extraOfficial,
    probe,
    signal,
  });
  if (!search.seen.size) return { items: [], dropped: 0, mode: 'none' };

  const { json } = await respond(apiKey, {
    model: MODELS.extract,
    instructions: STRUCTURE(cert),
    input: `Résultat de la recherche :\n${search.text}\n\nURL réellement consultées :\n${[...search.seen].map(([url, m]) => `- ${url}${m.title ? ` (${m.title})` : ''}`).join('\n')}`,
    schema: cat.schema,
    schemaName: `research_${key}`,
    signal,
  });

  const kept = [];
  let dropped = 0;
  for (const item of json.items) {
    if (key === 'tips') {
      const sources = item.sources.map((u) => vet(u, search.seen, extraOfficial)).filter(Boolean);
      if (sources.length) kept.push({ ...item, sources: [...new Map(sources.map((x) => [x.url, x])).values()] });
      else dropped++;
    } else {
      const v = vet(item.url, search.seen, extraOfficial);
      if (!v || (key === 'qcm' && !item.free)) dropped++;
      else kept.push({ ...item, ...v });
    }
  }
  return { items: kept, dropped, mode: search.mode };
}

export const emptyResearch = () => ({
  qcm: { items: [], dropped: 0 },
  resources: { items: [], dropped: 0 },
  tips: { items: [], dropped: 0 },
  errors: {},
  policy: { official: OFFICIAL, recognized: RECOGNIZED, excluded: EXCLUDED },
});

/** Lance une ou plusieurs catégories ; une catégorie en échec est consignée sans invalider les autres. */
export async function researchInto(research, apiKey, keys, cert, { signal } = {}) {
  const settled = await Promise.allSettled(keys.map((k) => researchCategory(apiKey, k, cert, { signal })));
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      research[keys[i]] = r.value;
      if (r.value.mode === 'none') research.errors[keys[i]] = tt('research.noSources');
    } else research.errors[keys[i]] = r.reason?.message ?? String(r.reason);
  });
  return research;
}
