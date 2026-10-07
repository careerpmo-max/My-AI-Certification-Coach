/** Langues de formation : figées à la création du cursus, elles pilotent le coach, le contenu généré, les messages automatiques, l'interface et la voix. */
export const LANGUAGES = {
  'fr-FR': { label: 'Français', name: 'français', flag: '🇫🇷' },
  'en-GB': { label: 'English', name: 'anglais', flag: '🇬🇧' },
  'es-ES': { label: 'Español', name: 'espagnol', flag: '🇪🇸' },
};
export const DEFAULT_LANGUAGE = 'fr-FR';
export const isLanguage = (l) => Object.hasOwn(LANGUAGES, l);

/** Ramène une valeur quelconque (y compris d'anciennes données, ex. en-US) à une langue supportée. */
export function normalizeLanguage(l) {
  if (isLanguage(l)) return l;
  const prefix = String(l ?? '').toLowerCase().split(/[-_]/)[0];
  return Object.keys(LANGUAGES).find((k) => k.toLowerCase().startsWith(`${prefix}-`)) ?? DEFAULT_LANGUAGE;
}
export const languageName = (l) => LANGUAGES[normalizeLanguage(l)].name;

/** Règle stricte injectée dans le prompt système du coach. */
export const languageRule = (l) => `Réponds exclusivement en ${languageName(l)}, sans jamais dévier, même si l'utilisateur écrit dans une autre langue.`;

/** Pour les contenus générés (diagnostic, plan, QCM) : langue de rédaction, noms officiels conservés. */
export const writeIn = (l) => `Rédige en ${languageName(l)} (les noms officiels de services, produits et domaines restent tels que publiés).`;
