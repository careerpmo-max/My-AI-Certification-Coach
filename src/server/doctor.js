import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { MODELS } from './config.js';
import { fetchPageText } from './certs/official.js';
import { extractOutline } from './certs/official.js';
import { chatStream, describeResponse, listModels, respond } from './openai.js';
import { searchWeb } from './certs/websearch.js';
import { withUsage } from './usage.js';

const OK_SCHEMA = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
const SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } } },
};
const PING_TOOL = { type: 'function', function: { name: 'ping', description: 'Enregistre un ping', parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } } };

export const DEFAULT_EXAM_URL = 'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-103';

/**
 * Diagnostic de bout en bout avec une vraie clé : chaque point risqué du projet est exercé avec un appel minimal.
 * Renvoie une liste de { id, label, status: 'ok'|'warn'|'fail'|'skip', detail, hint }. Coût typique : quelques centimes.
 */
export async function runDoctor({ apiKey, url = DEFAULT_EXAM_URL, dataDir, skipSearch = false, skipExtract = false, onResult = () => {} } = {}) {
  const results = [];
  const record = (id, label, status, detail = '', hint = '') => {
    const r = { id, label, status, detail, hint };
    results.push(r);
    onResult(r);
    return r;
  };
  const step = async (id, label, fn) => {
    try {
      const out = await fn();
      return record(id, label, out?.status ?? 'ok', out?.detail ?? '', out?.hint ?? '');
    } catch (e) {
      return record(id, label, 'fail', e.message, e.hint ?? '');
    }
  };

  await step('node', 'Node.js ≥ 22', async () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) throw Object.assign(new Error(`Node ${process.versions.node}`), { hint: 'Installe Node.js 22 ou plus : https://nodejs.org' });
    return { detail: `v${process.versions.node}` };
  });

  if (dataDir) {
    await step('data', 'Dossier de données inscriptible', async () => {
      await mkdir(dataDir, { recursive: true });
      const f = join(dataDir, '.doctor');
      await writeFile(f, 'ok');
      await access(f, constants.R_OK | constants.W_OK);
      await rm(f);
      return { detail: dataDir };
    });
  }

  if (!apiKey) {
    record('key', 'Clé OpenAI', 'fail', 'introuvable', 'Fais l\'onboarding dans l\'application, ou lance : OPENAI_API_KEY=sk-… npm run doctor');
    return results;
  }

  let models = [];
  const auth = await step('auth', 'Clé OpenAI acceptée + liste des modèles', async () => {
    models = await listModels(apiKey);
    return { detail: `${models.length} modèles visibles` };
  });
  if (auth.status === 'fail') return results;

  await step('models', 'Modèles configurés disponibles', async () => {
    const wanted = [...new Set([MODELS.text, MODELS.extract, MODELS.research])];
    const missing = wanted.filter((m) => !models.includes(m));
    if (missing.length) return { status: 'warn', detail: `absents de la liste : ${missing.join(', ')}`, hint: 'Surcharge avec COACH_TEXT_MODEL / COACH_EXTRACT_MODEL / COACH_RESEARCH_MODEL (voir README).' };
    return { detail: wanted.join(', ') };
  });

  await step('structured', `Sortie JSON structurée (Responses API, ${MODELS.extract})`, async () => {
    const { json } = await respond(apiKey, { model: MODELS.extract, input: 'Réponds avec ok=true.', schema: OK_SCHEMA, schemaName: 'doctor_ok' });
    if (json.ok !== true) throw new Error('réponse inattendue');
    return {};
  });

  await step('stream', `Chat en streaming + usage + appel d'outil (${MODELS.text})`, async () => {
    const entries = [];
    const called = [];
    let text = '';
    await withUsage(entries, async () => {
      for await (const d of chatStream(apiKey, [{ role: 'system', content: 'Tu dois TOUJOURS appeler l\'outil ping avant de répondre.' }, { role: 'user', content: 'Appelle ping avec note="doctor" puis dis simplement « ok ».' }], {
        tools: [PING_TOOL],
        runTool: async (name, args) => { called.push([name, args]); return { ok: true }; },
      })) text += d;
    });
    const usage = entries[0];
    const notes = [];
    if (!usage?.input) notes.push('usage de tokens non reçu (stream_options.include_usage)');
    if (!called.length) notes.push('le modèle n\'a pas appelé l\'outil : function calling non vérifié');
    if (!text.trim()) notes.push('aucun texte reçu après l\'outil');
    if (notes.length) return { status: 'warn', detail: notes.join(' ; '), hint: 'Vérifie le modèle (COACH_TEXT_MODEL). Les progressions fines du coach reposent sur ce mécanisme.' };
    return { detail: `${entries.length} tour(s), ${usage.input}+${usage.output} tokens, outil « ${called[0][0]} » appelé` };
  });

  if (skipSearch) record('search', 'Recherche web (web_search + allowed_domains)', 'skip', '--skip-search');
  else {
    await step('search', `Recherche web (web_search + allowed_domains, ${MODELS.research})`, async () => {
      const query = { key: 'doctor', instructions: 'Utilise la recherche web.', input: 'Trouve la page Microsoft Learn de l\'examen AZ-900.' };
      const r = await searchWeb(apiKey, { ...query, domains: ['learn.microsoft.com'] });
      if (r.mode === 'cited') return { detail: `${r.searches} recherche(s), ${r.seen.size} source(s) citée(s) par l'API` };
      if (r.mode === 'reachable') {
        return { detail: `${r.searches} recherche(s) ; l'API n'expose pas de citations → ${r.seen.size} URL du texte vérifiée(s) par téléchargement (${[...r.seen.keys()][0]})` };
      }
      const shape = JSON.stringify(describeResponse(r.raw));
      if (dataDir) await writeFile(join(dataDir, 'doctor-websearch.json'), JSON.stringify(r.raw, null, 2).slice(0, 200_000)).catch(() => {});
      // même requête sans filtre de domaines : isole la cause (filtre allowed_domains ou format de réponse)
      const variant = await searchWeb(apiKey, { ...query, domains: [] })
        .then((v) => `Sans allowed_domains : ${v.searches} recherche(s), mode « ${v.mode} », ${v.seen.size} source(s)${v.seen.size ? ' → le filtre allowed_domains est en cause' : ' → le format de réponse est en cause'}.`)
        .catch((e) => `Sans allowed_domains : erreur (${e.message}).`);
      return {
        status: 'warn',
        detail: `${r.searches ? `${r.searches} recherche(s) lancée(s) mais` : 'le modèle n\'a lancé aucune recherche :'} aucune source citée ni URL vérifiable. ${variant} Structure reçue : ${shape}`,
        hint: dataDir ? `Réponse brute enregistrée dans ${join(dataDir, 'doctor-websearch.json')} (sans clé) : colle ce fichier ou la ligne ci-dessus.` : 'Colle la structure ci-dessus pour que j\'adapte le parsing (src/server/certs/websearch.js).',
      };
    });
  }

  let pageText;
  await step('page', 'Page d\'examen téléchargeable', async () => {
    pageText = await fetchPageText(url);
    return { detail: `${pageText.length} caractères depuis ${new URL(url).hostname}` };
  });

  if (skipExtract || !pageText) record('extract', 'Extraction des domaines et pondérations', 'skip', skipExtract ? '--skip-extract' : 'page indisponible');
  else {
    await step('extract', 'Extraction des domaines et pondérations (page réelle)', async () => {
      const o = await extractOutline(apiKey, { name: 'Doctor' }, pageText, { url });
      const detail = `${o.domains.length} domaine(s), ancrés : ${o.domains.filter((d) => d.grounded).length}, pondérations ${o.weightsConsistent ? 'cohérentes' : 'incohérentes'}, mise à jour : ${o.lastUpdated ?? 'non trouvée'}`;
      if (o.status !== 'ok') return { status: 'warn', detail: `${detail} — ${o.warnings.join(' ; ')}`, hint: 'Si la page est partielle, le texte peut être collé à la main dans l\'écran de création.' };
      return { detail };
    });
  }
  return results;
}
