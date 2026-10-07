import { MODELS } from '../config.js';
import { respond } from '../openai.js';
import { isBotBlocking, normalizeUrl, tierOf } from './sources.js';
import { probeUrl } from './url.js';

/**
 * URL écrites en clair dans un texte, avec le texte environnant comme titre/snippet (lien markdown [titre](url) sinon la ligne).
 * ⚠ Ces URL sont des CANDIDATES : le texte est écrit par le modèle, une URL inventée y est indiscernable d'une vraie.
 */
export function urlsInText(text) {
  const out = new Map();
  const clean = (u) => u.replace(/[.,;:!?*_`'"»]+$/, '');
  const add = (raw, title) => {
    const url = normalizeUrl(clean(raw));
    if (url && !out.has(url)) out.set(url, { title: (title ?? '').trim().slice(0, 140) });
  };
  for (const m of text.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/g)) add(m[2], m[1]);
  for (const m of text.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)) {
    const url = normalizeUrl(clean(m[0]));
    if (!url || out.has(url)) continue;
    const start = text.lastIndexOf('\n', m.index) + 1;
    const end = text.indexOf('\n', m.index);
    const line = text.slice(start, end < 0 ? undefined : end).replace(m[0], ' ').replace(/[*#>•\-–—|[\]()]+/g, ' ').replace(/\s+/g, ' ');
    add(m[0], line);
  }
  return out;
}

/**
 * Vérifie par téléchargement que des URL candidates existent (HEAD/GET) : 2xx/3xx = joignable ; 401/403/429 acceptés
 * seulement pour les sites connus pour bloquer les robots (marqués « blocked ») ; 404, 5xx, injoignable = écartée.
 * Seules les URL de domaines fiables (officiels ou reconnus) sont sondées : pas de requête vers un site arbitraire.
 */
export async function verifyReachable(candidates, { extraOfficial = [], probe = probeUrl, max = 12 } = {}) {
  const todo = [...candidates].filter(([url]) => tierOf(url, extraOfficial)).slice(0, max);
  const results = await Promise.all(todo.map(async ([url, meta]) => {
    try {
      const status = await probe(url);
      if (status < 400) return [url, { ...meta, verification: 'reachable' }];
      if ([401, 403, 429].includes(status) && isBotBlocking(url)) return [url, { ...meta, verification: 'blocked' }];
    } catch { /* injoignable : écartée */ }
    return null;
  }));
  return new Map(results.filter(Boolean));
}

/**
 * Recherche web dont les sources sont fiables, quel que soit ce que l'API expose :
 *  1. « cited »     : l'API fournit des citations/sources (annotations url_citation, action.sources) → vues par la recherche ;
 *  2. « reachable » : sinon, les URL écrites dans la réponse sont vérifiées par téléchargement (la page existe vraiment) ;
 *  3. « none »      : aucune source exploitable.
 * Réponse en TEXTE LIBRE (une sortie JSON stricte supprime les annotations).
 */
export async function searchWeb(apiKey, { key, input, instructions, domains = [], extraOfficial = [], model = MODELS.research, probe, signal }) {
  const a = await respond(apiKey, {
    model,
    instructions: `${instructions}\nPour chaque résultat, écris son titre puis son URL complète en clair.`,
    input,
    tools: [{ type: 'web_search', ...(domains.length ? { filters: { allowed_domains: [...new Set(domains)] } } : {}) }],
    toolChoice: 'required', // sinon le modèle peut répondre de mémoire sans rien chercher
    schemaName: `research_${key}_search`,
    signal,
  });
  const base = { text: a.text, searches: a.searches, raw: a.raw };
  if (a.citations.size) {
    return { ...base, mode: 'cited', seen: new Map([...a.citations].map(([url, title]) => [url, { title, verification: 'cited' }])) };
  }
  const seen = await verifyReachable(urlsInText(a.text), { extraOfficial, probe });
  return { ...base, mode: seen.size ? 'reachable' : 'none', seen };
}
