# Architecture — Coach IA

## 1. Stack et justification

| Couche | Choix | Pourquoi |
|---|---|---|
| Runtime | **Node.js ≥ 22, zéro dépendance npm** | `fetch`, `node:http`, `node:test`, `AsyncLocalStorage` natifs → pas d'`npm install`, pas de build, pas de venv : « clone + 1 commande ». |
| Backend | `node:http` + table de routes (`"METHOD /path"`) | Le backend est fin : proxy OpenAI, pipeline de création, persistance. Un framework n'apporterait rien. |
| Frontend | HTML/CSS + ES modules vanilla servis en statique | Pas de bundler. Thème sombre, 3 colonnes. |
| LLM | **Chat Completions** (streaming SSE, function calling) pour le coach ; **Responses API** (sortie JSON structurée, `web_search`) pour extraction, recherche, diagnostic, plan, QCM | Chaque API pour ce qu'elle fait de mieux. |
| Voix | **Web Speech API du navigateur** (`SpeechRecognition` continu + `speechSynthesis`) | Gratuit côté OpenAI, zéro token, aucun endpoint dédié. Contrepartie : Chrome/Edge font la reconnaissance via un service en ligne. |
| Stockage | **Fichiers JSON** (`data/`), écriture atomique, sérialisée par clé | Lisible, éditable, sans binaire natif. Interface `JsonStore` (get/set/update/remove) remplaçable par SQLite. |
| i18n | Dictionnaires fr/en/es côté client **et** serveur | Interface, messages automatiques et erreurs suivent la langue du cursus. Extensible : [ADD_A_LANGUAGE.md](ADD_A_LANGUAGE.md). |
| Tests / CI | `node:test` (118 tests, sans réseau), `scripts/check.mjs`, GitHub Actions (Linux/Windows/macOS × Node 22/24) | |

### Alternatives écartées
- **Python/FastAPI** : venv + pip = friction (surtout Windows).
- **Electron/Tauri, React/Vite** : build et poids disproportionnés pour un MVP.
- **OpenAI Realtime (WebRTC)** : essayé puis supprimé — connexion fragile et coût par token ; la Web Speech API est gratuite et suffisante.
- **SQLite** : `node:sqlite` encore expérimental en Node 22 ; addons natifs = friction.
- **TUI** : voix, suivi visuel et QCM cliquables sont plus naturels en web.

## 2. Structure

```
src/server/
  index.js, app.js        # démarrage ; routes, ALS langue, SSE du chat, jobs en arrière-plan
  config.js, storage.js, usage.js, i18n.js, html.js, openai.js, doctor.js
  certs/                  # création d'un cursus
    pipeline.js           #   5 étapes idempotentes (reprise sur échec)
    official.js, research.js, sources.js, url.js, debrief.js, catalog.json
  coach/                  # intelligence pédagogique
    persona.js, personas.js, language.js
    assessment.js, planner.js, quiz.js, progress.js, tools.js
src/web/
  index.html, style.css, app.js (routeur), ui.js, i18n.js, speech.js
  views/ onboarding, home, form, create, workspace, widgets
scripts/ check.mjs, doctor.mjs
test/   *.test.js
docs/   ARCHITECTURE.md, ADD_A_LANGUAGE.md, REAL_KEY_TEST.md
```

```
Navigateur ──HTTP/SSE──► Serveur local ──HTTPS──► OpenAI (chat, responses, web_search)
   │  Web Speech (micro/voix)    │  └─► page d'examen fournie (+ liens annexes)
   └─ localStorage (langue UI)   └─► data/*.json
```

## 3. Parcours et modèle de données

- **Profil** (`data/profile.json`) : prénom, persona ; clé API dans `data/secrets.json` (droits restreints, jamais renvoyée au navigateur).
- **Cursus** (`data/curricula/<id>.json`) : nom, URL officielle, liens annexes, **langue (figée)**, `creation` (état du pipeline), `discovery` (programme extrait, recherche, confiance, débrief), `plan`, `cursor`, `gaps`, `assessment`, `quizzes`, `usage`. Conversation dans `data/sessions/<id>.json`.
- **Création** (`certs/pipeline.js`) : page officielle (20 %) → extraction des domaines et pondérations (40 %) → ressources + tips (60 %) → QCM et tests blancs (80 %) → plan (100 %). État persisté (`creation.done`) : « Réessayer » repart de l'étape en échec ; le texte de la page peut être collé à la main ; supprimer un cursus pendant sa création arrête le job sans fichier fantôme.
  - URL utilisateur : **https public uniquement** (adresses locales/privées refusées, redirections revalidées, taille et délai bornés).
  - Anti-hallucination : chaque domaine extrait doit figurer textuellement dans la page ; pondérations ≈ 100 % ; sites de dumps exclus.
  - **Recherche web en 2 temps** (`certs/websearch.js`, `certs/research.js`) : (1) `web_search` forcé (`tool_choice: required`) en **texte libre** (une sortie JSON stricte supprime les annotations et l'API n'expose pas toujours `action.sources`) ; une source n'est retenue que si elle est **citée par l'API** (annotations / `action.sources`) ou, à défaut, si l'URL écrite dans la réponse est **vérifiée par téléchargement** (HEAD/GET : 2xx/3xx ; 401/403/429 tolérés seulement pour les sites qui bloquent les robots, signalés « non vérifiable ») ; seules les URL de domaines fiables sont sondées ; les URL du texte du modèle ne sont jamais crues sur parole ; (2) structuration par un second appel **sans outil**, restreint à ces sources.
  - **Confiance** : score déterministe sur 100 avec raisons (jamais auto-évalué par le LLM).
- **Plan** : bloc = domaine officiel ; modules = sous-blocs ; chaque bloc se termine par un **QCM récap** (`kind: 'quiz'`, 8 questions format examen, seuil 70 %, seul le quiz le valide). Plan initial dès la création (niveau intermédiaire, 5 h/semaine) ; le **diagnostic** (1 QCM par domaine + auto-évaluation, notation 60/40, détection de surconfiance) le recalibre tant qu'aucun module n'est démarré. Plan LLM validé côté serveur, sinon plan de secours déterministe.
- **Méthode pédagogique** (`coach/persona.js`) : chaque sous-module (= module du programme) en 3 phases — cours complet (tous les objectifs, exemples, analogies, sans questions de contrôle), vérification par 2-3 questions ciblées (lacunes notées via `record_gap`), décision explicite avancer/réviser (révision = autre angle). La phase est portée par `cursor.phase` (`save_cursor`) et rappelée au coach à chaque tour ; la consigne vaut aussi à l'oral (le prompt « voix » n'impose plus de réponses courtes).
- **Mémoire et reprise** : le coach dispose d'outils (function calling : `set_module_status` avec avancement 1–99, `record_gap`, `save_cursor`), validés côté serveur. Chaque tour reçoit programme, statuts, position et lacunes ouvertes ; l'interface affiche « Reprise : … » à l'ouverture.
- **Progression** (`coach/progress.js`, pure) : % domaine = heures accomplies / heures du domaine ; % global pondéré par les poids officiels.
- **Compteur d'usage** (`usage.js`) : chaque appel OpenAI est enregistré (tokens, recherches web) via `AsyncLocalStorage`, cumulé par cursus et par étape ; coût estimé avec des tarifs indicatifs modifiables.

## 4. Interface

3 colonnes (`views/workspace.js`) : arbre du cursus (cercles de progression gris / arc partiel / vert coché, navigation au clic) — section courante (titre, objectif pédagogique, historique complet, panneaux QCM / lacunes / diagnostic) — barre verticale de progression globale. Naviguer ne démarre rien : seul « Démarrer avec le coach » marque un module comme commencé.

### Mise en forme des messages (`web/markdown.js`)
Le prompt demande des balises (`[CONCEPT: Titre] … [/CONCEPT]`, `[ANALOGIE] … [/ANALOGIE]`, tirets `-`, `📖 **Sous-thème**` en phase cours, `❓ **Vérifions ta compréhension**` en vérification, `## Titre`) ; l’ancienne forme courte `[CONCEPT] Titre` reste acceptée. Une balise ouverte pendant le streaming est rendue en carte en cours de route, une balise incomplète est masquée, et le message est re-rendu à la fin du flux. Le **parseur** (pur, testé sous Node) produit des blocs ; le **rendu DOM** n'utilise que `createElement`/`textContent` (jamais `innerHTML` : le contenu vient d'un LLM) et n'autorise que des liens http(s). Un bloc = la ligne de balise + les lignes qui suivent jusqu'à la première ligne vide (une ligne vide juste après la balise est tolérée) ; une balise incomplète pendant le streaming s'affiche en texte brut jusqu'à ce qu'elle soit complète. Les balises ne sont jamais lues à voix haute. Le **badge de phase** vient du serveur : à la fin de chaque tour, la phase du curseur (`save_cursor`) est mémorisée sur le message du coach.
Thème clair/sombre (`web/theme.js`) : tout passe par des variables CSS (`:root[data-theme=light]`), préférence dans `localStorage`, application avant le premier rendu (pas de flash).

### Identité visuelle et raccourci
`src/server/icon.js` définit une seule géométrie (carré arrondi `#1e2535`, « C » blanc, étincelle IA) rendue en SVG (`/favicon.svg`) et rastérisée en JavaScript pur (supersampling 4×4, encodeur PNG/ICO/ICNS maison : Node n'a pas de Canvas natif) → `public/icon.{png,ico,icns}` (`npm run icons`). Un test vérifie que les fichiers committés sont à jour. `npm run shortcut` (`src/server/shortcut.js` : plan pur, testé pour les 3 OS ; `scripts/shortcut.mjs` : exécution) crée le lanceur et le raccourci du système courant.

### Mode vocal
- **Écoute** : `SpeechRecognition` continu (langue du cursus). Quand tu marques une pause (1200 ms après le dernier résultat final), la phrase part dans le chat existant (`voice: true` → réponses courtes et orales ; `channel: "voice"` → mémorisation). Relance automatique de l'écoute, erreurs graves traduites, boucle de relance bloquée.
- **Lecture** : `speechSynthesis` phrase par phrase pendant le streaming ; markdown, code et URL non lus. Voix du persona (Lumen = 1re voix masculine, Vera = 2e féminine ou neutre, Eko = 1re féminine ; genre deviné d'après le nom) avec repli sur la voix par défaut, débit/hauteur propres à chaque persona.
- **Anti-écho = micro éteint pendant la lecture** : dès qu'une phrase est lue, `SpeechRecognition` est abandonné (handlers détachés : aucun résultat, même tardif, ne passe) ; il est relancé `graceMs` = 400 ms après la **fin de la dernière phrase** (`onend`, avec un filet de sécurité si le navigateur n'émet pas `onend` : synthèse silencieuse pendant 1 s) pour absorber la réverbération. Entre deux phrases d'une même réponse le micro reste éteint ; avant le premier son (réflexion du coach) il reste ouvert. Une phrase dictée en cours est reportée après la reprise. Le filtre par similarité de texte reste en complément.
- **Interruption** : le micro étant éteint, on interrompt au bouton ⏹ ou à la touche Échap (`interrupt()` : lecture et flux coupés, réponse partielle conservée, micro rallumé après 400 ms). Le texte tapé annule aussi la lecture.

### Langue
`fr-FR` (défaut), `en-GB`, `es-ES`, choisie à la création, figée. Suivent la langue : prompt du coach (« Réponds exclusivement en … sans jamais dévier »), contenus générés, messages automatiques, erreurs (en-tête `x-lang`, la langue du cursus prime), interface, voix. Les drapeaux sont des SVG inline (Windows n'affiche pas les emojis de drapeaux).

## 5. Sécurité
Écoute uniquement sur 127.0.0.1 ; contrôle Host/Origin (anti DNS-rebinding/CSRF) ; anti-traversée de dossiers (testée) ; clé jamais renvoyée ; URL utilisateur filtrées (SSRF) ; contenu LLM injecté via `textContent` (jamais `innerHTML`) ; corps de requête borné ; les erreurs de tâches de fond sont consignées sans arrêter le serveur.

## 6. Risques connus
- Format des réponses OpenAI : le doctor réel a montré que `web_search` n'expose ni `action.sources` ni annotations avec une sortie JSON stricte → recherche en texte libre + vérification par téléchargement (ci-dessus). Les autres points (streaming `include_usage`, function calling, extraction) sont validés par le doctor ; le reste est **à valider avec une vraie clé** → `npm run doctor` ([REAL_KEY_TEST.md](REAL_KEY_TEST.md)).
- Tarifs du compteur : indicatifs, à vérifier.
- Genre des voix : deviné par le nom (non exposé par les navigateurs) ; reconnaissance vocale dépendante du navigateur et, sous Chrome/Edge, d'un service en ligne.
- Pages d'examen rendues en JavaScript : repli par collage manuel du contenu.

## Progression et responsive

- **Avancement du module** : `save_cursor(phase, covered)` fait avancer la barre sans attendre `set_module_status` — cours : 10 + 60 × objectifs couverts / total (max 70 %), vérification : 75 %, décision : 90 %. Jamais de recul, jamais 100 % (seul `done` termine). Filet de sécurité : un cours long (≥ 400 caractères) sans aucun outil d'avancement ajoute +5 % estimé, plafonné à 60 %.
- **Journal serveur** à chaque tour : `[coach] HH:MM:SS tour <id> module=m1 phase=course | outils : save_cursor(course,covered=2) | module 0→70 % | global 0→19 %`. Si la barre reste à 0 % : outils vides dans cette ligne = le coach n'a rien appelé ; valeurs non nulles = problème côté client.
- L'événement SSE final `done` embarque `progress: {global, moduleId, module}` ; le client met à jour rail et barre mobile immédiatement.
- **Responsive** : ≥ 900 px trois colonnes ; < 900 px colonne unique (chat), arbre en volet ☰ (fermeture : ✕, fond, Échap, sélection), barre verticale remplacée par une barre horizontale fine sous la topbar.

## Chat par module et génération des QCM

- **Un fil par module** : chaque message de `sessions/<id>.json` porte un `moduleId` (le module du curseur au début du tour ; le résumé de correction d'un QCM porte l'id du QCM). Les messages sans `moduleId` (débrief, plan, diagnostic, historique antérieur) sont rattachés au premier module de cours. `GET /api/session?moduleId=…` filtre (sans paramètre : tout l'historique). Le coach ne reçoit que le fil du module courant (le contexte du programme, lui, reste global). Côté client, le chat affiche le fil du nœud sélectionné (bloc sélectionné → module du curseur) et se recharge à chaque changement ; en mode QCM le fil du cours est remplacé par celui du QCM (vide tant que rien n'a été corrigé).
- **Pop-up de génération** (`progressDialog`) : phase 1 spinner, non fermable (Échap neutralisé) ; phase 2 « Vos QCM sont prêts ! » + bouton « Commencer » qui ouvre les questions. En cas d'erreur, la pop-up se ferme et l'erreur s'affiche.
- **États vides** : dans un fil sans conversation (le débrief et le plan n'en sont pas une), un call-to-action centré remplace le message d'accueil — « Prêt à tester vos connaissances ? » sur un QCM récap sans correction, « Commencer ce module » sur un module de cours encore à `todo`. Il disparaît dès qu'un message part, pendant un QCM, et ne revient pas sur un module déjà entamé.
