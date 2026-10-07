# Ajouter une langue (ex. `de-DE`, `it-IT`)

L'architecture i18n est conçue pour qu'ajouter une langue soit mécanique : **5 endroits**, tous vérifiés par `npm test`
(un test échoue tant qu'une langue déclarée n'est pas complète).

| # | Fichier | Quoi |
|---|---|---|
| 1 | `src/server/coach/language.js` | Ajouter l'entrée dans `LANGUAGES` : `'de-DE': { label: 'Deutsch', name: 'allemand', flag: '🇩🇪' }`. `name` est en **français** (il est injecté dans le prompt : « Réponds exclusivement en allemand… »). |
| 2 | `src/server/i18n.js` | Ajouter un dictionnaire `de` (mêmes clés et mêmes `{paramètres}` que `fr`) et l'enregistrer dans `MESSAGES`. Erreurs, débrief, plan, QCM, étapes de création… |
| 3 | `src/web/i18n.js` | Ajouter le dictionnaire `de` de l'interface, l'entrée dans `LANGS` et dans `DICT`. Les 3 textes de chaque persona (`persona.<id>.desc/trait/sample`) en font partie. |
| 4 | `src/web/views/widgets.js` | (optionnel) Dessiner le drapeau dans `FLAG_DRAWERS['de-DE']`. Sans dessin, une pastille « DE » est affichée. Ex. : `stripes(['#000', '#DD0000', '#FFCE00'], false)` ; Italie : `stripes(['#009246', '#fff', '#CE2B37'], true)`. |
| 5 | `src/web/speech.js` | (optionnel) Compléter les listes de prénoms de voix `FEMALE` / `MALE` pour la langue (déjà prévues : Katja, Hedda, Anna, Petra, Conrad, Stefan, Markus, Isabella, Federica, Luca, Cosimo…). |

Rien d'autre n'est à toucher : le sélecteur de drapeaux, le formulaire, la validation serveur (`isLanguage`), la reconnaissance et la synthèse
vocales (le code BCP-47 est passé tel quel au navigateur), les contenus générés (`writeIn`) et les dates (`toLocaleDateString`) suivent.

Vérification : `npm test` (parité des clés et paramètres, une entrée par langue partout) puis `npm run check`.

> Les anciennes valeurs stockées (ex. `en-US`) sont ramenées à la langue supportée la plus proche par `normalizeLanguage`.
