# Test avec une vraie clé — checklist

Coût total : quelques centimes (le diagnostic) + ~5 appels pour un cursus (dont des recherches web facturées à part).

## 1. Diagnostic automatique (2 min)

```sh
OPENAI_API_KEY=sk-… npm run doctor            # ou, après l'onboarding : npm run doctor
npm run doctor -- --url <page d'examen> --skip-search   # variantes
```

Vérifie : clé et modèles → sortie JSON structurée → chat en streaming + usage + **appel d'outil** → **recherche web** avec `allowed_domains` → téléchargement de la page → extraction des domaines. Chaque ligne est ✅ / ⚠️ / ❌ avec une piste de correction. **Copie-colle la sortie complète** si quelque chose n'est pas ✅.

Si la **recherche web** est en ⚠️ : le doctor affiche la structure de la réponse (types, clés, nombres — sans contenu), teste la même requête sans `allowed_domains` pour isoler la cause, et enregistre la réponse brute dans `data/doctor-websearch.json` (aucune clé dedans). Colle-moi la ligne ou le fichier.

## 2. Parcours dans l'application (10 min)

| # | À faire | Attendu | Si ça casse |
|---|---|---|---|
| 1 | Onboarding : prénom, clé, persona (essaie « Essayer ») | Accueil « Bonjour … » | Message rouge sous le formulaire |
| 2 | Nouveau cursus : nom, URL officielle, langue | Création en 5 étapes jusqu'à 100 %, pop-up ✅ | Étape en erreur + « Réessayer » / « Coller le contenu de la page » |
| 3 | Lire le débrief (message replié en haut du fil) | Domaines, pondérations et date cohérents avec la page officielle ; sources cliquables ; confiance expliquée | Note ta valeur de confiance et ce qui manque |
| 4 | Cliquer « Démarrer avec le coach », répondre à une question, dire « j'ai fini ce module » | Réponse en streaming ; le cercle du module avance ; « Reprise : … » après rechargement | Compteur d'API : des appels ont-ils eu lieu ? |
| 5 | Diagnostic (avant de démarrer un module) | Plan recalibré | |
| 6 | QCM récap d'un bloc | 8 questions, correction, lacunes créées si raté | |
| 7 | Mode vocal (casque conseillé) : parler, se faire répondre, interrompre | Texte + voix ; interruption immédiate | Chrome/Edge : connexion requise |
| 8 | Changer de langue pour un 2ᵉ cursus (🇬🇧 / 🇪🇸) | Interface, messages, QCM et voix dans la langue | |

## 3. Réglages si besoin
`COACH_TEXT_MODEL`, `COACH_EXTRACT_MODEL`, `COACH_RESEARCH_MODEL` (modèle absent de ton compte), `COACH_PRICING` (tarifs du compteur).
