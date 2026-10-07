import { MODELS } from '../config.js';
import { htmlToText } from '../html.js';
import { tt } from '../i18n.js';
import { fetchPublicText } from './url.js';
import { respond } from '../openai.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['examCode', 'title', 'lastUpdated', 'domains'],
  properties: {
    examCode: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] },
    lastUpdated: { type: ['string', 'null'], description: 'Date de mise à jour du programme, telle qu\'imprimée sur la page' },
    domains: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'weightMin', 'weightMax', 'subdomains'],
        properties: {
          name: { type: 'string' },
          weightMin: { type: 'number' },
          weightMax: { type: 'number' },
          subdomains: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const INSTRUCTIONS = `Tu extrais le programme d'une certification depuis le texte brut de sa page officielle (study guide).
Règles : n'utilise QUE le texte fourni, n'invente rien. Recopie les noms de domaines et sous-domaines tels qu'écrits.
Pondération « 25–30 % » -> weightMin 25, weightMax 30 ; pondération unique -> min = max. Date absente -> null.`;

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();

/** Télécharge et convertit en texte la page d'examen (URL https publique validée par fetchPublicText). */
export async function fetchPageText(url, { signal } = {}) {
  const text = htmlToText(await fetchPublicText(url, { signal }));
  if (text.length < 200) throw new Error(tt('page.empty'));
  return text;
}

/** Extraction structurée depuis un texte de study guide (page récupérée ou collée par l'utilisateur). */
export async function extractOutline(apiKey, cert, text, { url, signal, manual = false } = {}) {
  const { json } = await respond(apiKey, {
    model: MODELS.extract,
    instructions: INSTRUCTIONS,
    input: `Certification : ${cert.name}\n\n--- PAGE OFFICIELLE ---\n${text}`,
    schema: SCHEMA,
    schemaName: 'certification_outline',
    signal,
  });

  const haystack = norm(text);
  const domains = json.domains.map((d, i) => ({ id: `d${i + 1}`, ...d, grounded: haystack.includes(norm(d.name)) }));
  const sumMin = domains.reduce((a, d) => a + d.weightMin, 0);
  const sumMax = domains.reduce((a, d) => a + d.weightMax, 0);
  const warnings = [];
  if (!domains.length) warnings.push(tt('warn.noDomain'));
  if (domains.some((d) => !d.grounded)) warnings.push(tt('warn.ungrounded'));
  if (domains.length && (sumMin > 102 || sumMax < 98)) warnings.push(tt('warn.weights', { min: sumMin, max: sumMax }));

  return {
    status: warnings.length ? 'partial' : 'ok',
    manual,
    url,
    fetchedAt: new Date().toISOString(),
    examCode: json.examCode,
    title: json.title,
    lastUpdated: json.lastUpdated,
    domains,
    weightsConsistent: domains.length > 0 && sumMin <= 102 && sumMax >= 98,
    warnings,
  };
}
