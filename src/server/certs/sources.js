/**
 * Politique de sources : seules les sources officielles ou reconnues sont conservées.
 * Les sites de « dumps » (questions réelles d'examen) sont exclus : ils contreviennent à la politique
 * d'examen des éditeurs (risque de révocation de certification) et leurs réponses sont souvent fausses.
 */
export const OFFICIAL = ['learn.microsoft.com', 'microsoft.com', 'azure.microsoft.com', 'techcommunity.microsoft.com'];
export const RECOGNIZED = ['whizlabs.com', 'udemy.com', 'reddit.com', 'youtube.com', 'github.com'];
/** Sites qui répondent 401/403/429 aux robots même pour des pages qui existent : un tel statut n'invalide pas un lien. */
export const BOT_BLOCKING = ['reddit.com', 'youtube.com', 'udemy.com', 'whizlabs.com'];
export const EXCLUDED = ['examtopics.com', 'exam-labs.com', 'dumpsgate.com', 'pass4sure.com', 'certkiller.com'];

const matches = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

export const isBotBlocking = (url) => { const h = hostOf(url); return !!h && matches(h, BOT_BLOCKING); };

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** 'official' | 'recognized' | null (non fiable ou exclu). `extraOfficial` : hôtes de l'URL d'examen fournie par l'utilisateur. */
export function tierOf(url, extraOfficial = []) {
  const host = hostOf(url);
  if (!host || matches(host, EXCLUDED)) return null;
  if (matches(host, [...OFFICIAL, ...extraOfficial])) return 'official';
  if (matches(host, RECOGNIZED)) return 'recognized';
  return null;
}

/** URL canonique pour comparer citations et résultats (sans utm_*, fragment ni slash final). */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
