import { tt } from '../i18n.js';

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/** Valide une URL fournie par l'utilisateur avant que le serveur ne la télécharge : https public uniquement. */
export function assertPublicHttps(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error(tt('url.invalid', { raw }));
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:') throw new Error(tt('url.https'));
  if (u.username || u.password) throw new Error(tt('url.creds'));
  const isV6 = host.startsWith('[');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !isV6) throw new Error(tt('url.local'));
  if (PRIVATE_V4.some((re) => re.test(host))) throw new Error(tt('url.private'));
  if (isV6 && /^\[(::1?|f[cd]|fe80)/i.test(host)) throw new Error(tt('url.private'));
  return u.toString();
}

/** GET texte avec redirections suivies à la main (chaque saut revalidé), délai et taille bornés. */
export async function fetchPublicText(raw, { timeoutMs = 20000, maxBytes = 2_000_000, signal } = {}) {
  let url = assertPublicHttps(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'my-ai-certification-coach/0.1' },
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = assertPublicHttps(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    if (!res.ok) throw new Error(tt('url.http', { status: res.status }));
    return (await res.text()).slice(0, maxBytes);
  }
  throw new Error(tt('url.redirects'));
}

/**
 * Statut HTTP d'une URL (HEAD, puis GET si HEAD non supporté), redirections revalidées une à une, sans lire le corps.
 * Sert à vérifier qu'une URL citée par le modèle existe vraiment. Lève une erreur si injoignable.
 */
export async function probeUrl(raw, { timeoutMs = 8000 } = {}) {
  let url = assertPublicHttps(raw);
  for (let hop = 0; hop < 4; hop++) {
    let res = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: PROBE_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if ([403, 405, 501].includes(res.status)) res = await fetch(url, { method: 'GET', redirect: 'manual', headers: PROBE_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    res.body?.cancel?.().catch(() => {});
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = assertPublicHttps(new URL(res.headers.get('location'), url).toString());
      continue;
    }
    return res.status;
  }
  throw new Error(tt('url.redirects'));
}

const PROBE_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; my-ai-certification-coach/0.1)', accept: 'text/html,*/*;q=0.8' };
