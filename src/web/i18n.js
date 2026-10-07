/** Interface en 3 langues (fr / en / es). Le français est la langue par défaut ; toute clé manquante retombe dessus. */
export const LANGS = [
  { code: 'fr-FR', flag: '🇫🇷', label: 'Français' },
  { code: 'en-GB', flag: '🇬🇧', label: 'English' },
  { code: 'es-ES', flag: '🇪🇸', label: 'Español' },
];
export const DEFAULT_LANG = 'fr-FR';

const fr = {
  'app.name': '🎓 Coach IA', 'lang.label': 'Langue', 'common.cancel': 'Annuler', 'common.remove': 'Retirer', 'common.close': 'Fermer', 'common.back': '← Cursus',
  // onboarding
  'onb.intro': 'Ton coach personnel pour préparer une certification. Tout reste sur ta machine ; seule l’API OpenAI est appelée.',
  'onb.firstName': 'Prénom', 'onb.firstNamePh': 'Ton prénom', 'onb.apiKey': 'Clé API OpenAI (stockée uniquement sur cette machine)',
  'onb.persona': 'Ton coach', 'onb.personaHint': 'Choisis la personnalité et la voix de ton coach.', 'onb.try': 'Essayer', 'onb.continue': 'Continuer', 'onb.verifying': 'Vérification de la clé…',
  'persona.lumen.desc': 'Chaleureuse et patiente, explique sous plusieurs angles', 'persona.lumen.trait': 'Bienveillante', 'persona.lumen.sample': 'Bonjour ! Je suis Lumen. On va avancer ensemble, à ton rythme, et je t’expliquerai chaque notion sous plusieurs angles.',
  'persona.vera.desc': 'Rigoureuse et précise, va droit au but', 'persona.vera.trait': 'Exigeante', 'persona.vera.sample': 'Bonjour. Je suis Vera. Je serai directe et précise : chaque point doit être maîtrisé avant de passer au suivant.',
  'persona.eko.desc': 'Dynamique et motivant, rythme soutenu', 'persona.eko.trait': 'Énergique', 'persona.eko.sample': 'Salut ! Moi c’est Eko. On y va, rythme soutenu : chaque réponse juste te rapproche de la certification !',
  // accueil
  'home.hello': 'Bonjour {name} 👋', 'home.new': '➕ Nouveau cursus', 'home.empty1': 'Aucun cursus pour l’instant.', 'home.empty2': 'Donne-moi l’URL officielle de l’examen visé : je construis ton plan de formation.',
  'home.first': 'Créer mon premier cursus', 'home.open': '▶ Ouvrir', 'home.continue': '↩ Reprendre', 'home.seeCreation': 'Voir la création', 'home.delete': 'Supprimer', 'home.creating': '⏳ Création en cours', 'home.resume': '⚠ Création à reprendre',
  'home.created': 'créé le {date}', 'home.delTitle': 'Supprimer « {name} » ?', 'home.delText': 'La progression, les lacunes et tout l’historique de ce cursus seront définitivement effacés.',
  // formulaire
  'form.title': 'Nouveau cursus', 'form.prefill': 'Préremplir : {label}', 'form.name': 'Nom du cursus', 'form.namePh': 'Ex : Prépa AI-103 Oct 2026', 'form.nameSuggest': 'Prépa AI-103',
  'form.url': 'URL officielle de la page d’examen', 'form.required': '(obligatoire)', 'form.urlPh': 'https://learn.microsoft.com/…/study-guides/…',
  'form.urlHelp': 'Page publique de l’éditeur listant les compétences évaluées et leur pondération (« study guide », « exam objectives »…).',
  'form.lang': 'Langue de formation', 'form.langHelp': 'Langue du coach, de l’interface, des QCM, du plan et de la voix. Figée pour toute la durée du cursus, même si tu écris dans une autre langue.',
  'form.annex': 'Liens annexes', 'form.optional': '(optionnel, 5 maximum)', 'form.annexPh': 'https://… (documentation, cours, article)', 'form.add': '＋ Ajouter un lien', 'form.submit': 'Créer mon plan de formation',
  'form.errName': 'Donne un nom à ton cursus.', 'form.errUrl': 'L’URL officielle de l’examen est obligatoire.',
  // création
  'create.title': 'Création de « {name} »', 'create.note': 'Quelques dizaines de secondes : recherche web comprise. Tu peux quitter cette page, la création continue.', 'create.stopped': '⚠ La création s’est arrêtée',
  'create.retry': 'Réessayer', 'create.paste': 'Coller le contenu de la page', 'create.pastePh': 'Colle ici le contenu de la page d’examen (Ctrl+A, Ctrl+C sur la page officielle)…', 'create.analyze': 'Analyser ce texte', 'create.home': 'Retour à l’accueil',
  'create.done': 'Cursus créé avec succès', 'create.doneText': '{blocs} modules, {modules} sous-modules et un QCM récap par module.', 'create.start': 'OK → Démarrer',
  // espace de travail
  'ws.msgPh': 'Écris ton message…', 'ws.send': 'Envoyer', 'ws.voice': 'Mode vocal', 'ws.voiceTip': 'Parle naturellement : ta phrase part au coach quand tu marques une pause, et sa réponse est lue à voix haute',
  'ws.mute': '🎙 Couper le micro', 'ws.unmute': '🔇 Micro coupé — réactiver', 'ws.diag': 'Diagnostic de niveau', 'ws.recommended': 'recommandé', 'ws.gaps': 'Lacunes', 'ws.quizNode': '📝 QCM récap',
  'ws.block': 'Module {n}', 'ws.blockDash': 'Module {n} — {name}', 'ws.blockWeight': 'Module {n} · poids officiel {w} %', 'ws.blockModules': '{n} sous-module(s), puis un QCM récap pour valider le module.',
  'ws.objective': 'Objectif pédagogique', 'ws.quizGoal': 'Valider le module « {name} » avec au moins 70 % de bonnes réponses.', 'ws.quizCovers': 'Notions couvertes : {list}',
  'ws.quizRetry': '📝 Refaire le QCM', 'ws.quizStart': '📝 Lancer le QCM récap', 'ws.bestScore': 'Meilleur score : {pct} %', 'ws.startCoach': '▶ Démarrer avec le coach', 'ws.reviseCoach': '↻ Réviser avec le coach', 'ws.resumeCoach': '▶ Reprendre avec le coach',
  'ws.hoursProgress': '{h} h · avancement {p} %', 'ws.progress': 'Progression', 'ws.menu': 'Ouvrir le programme', 'ws.steps': '{done}/{total} étapes', 'ws.globalTip': 'Progression globale : {g} %',
  'ws.usage': 'API : {calls} appels{searches} · {k}k tokens{cost}', 'ws.usageSearches': ' (dont {n} recherches web)', 'ws.usageTip': 'Estimation indicative, tarifs modifiables dans config.js.',
  'ws.usageStartup': 'Création du cursus (programme + recherche)', 'ws.usageDiag': 'Diagnostic', 'ws.usagePlan': 'Programme', 'ws.usageQuiz': 'QCM', 'ws.usageChat': 'Conversation', 'ws.usageLine': '{label} : {calls} appel(s){searches}', 'ws.usageLineSearch': ', {n} recherche(s) web',
  'ws.gapsOpen': 'Lacunes ouvertes ({n})', 'ws.gapsResolve': 'Résolue', 'ws.gapsNone': 'Aucune lacune ouverte 🎉 Elles apparaissent après un diagnostic, un QCM raté, ou quand le coach en repère.',
  'ws.diagPrep': 'Préparation…', 'ws.diagTitle': 'Diagnostic de niveau', 'ws.diagIntro': 'Quelques questions pour calibrer ton programme (durée, priorités). Possible tant que tu n’as pas commencé un module.',
  'ws.diagLevel': 'Ton niveau global', 'ws.lvBeg': 'Débutant', 'ws.lvMid': 'Intermédiaire', 'ws.lvAdv': 'Avancé', 'ws.diagHours': 'Heures disponibles par semaine', 'ws.diagDate': 'Date d’examen (optionnel)', 'ws.diagSelf': 'Ton niveau perçu sur ce domaine',
  'ws.diagGo': 'Recalibrer mon programme', 'ws.diagBusy': 'Génération… (15-60 s)', 'ws.quizPrep': 'Génération du QCM…', 'ws.ctaQuizTitle': 'Prêt à tester vos connaissances ?', 'ws.ctaQuizSub': 'Générez un QCM récap pour ce module', 'ws.ctaQuizBtn': 'Lancer le QCM récap', 'ws.ctaStartTitle': 'Commencer ce module', 'ws.ctaStartBtn': 'Démarrer avec le coach', 'ws.quizGenTitle': 'Génération des QCM en cours...', 'ws.quizReadyTitle': 'Vos QCM sont prêts !', 'ws.quizBegin': 'Commencer', 'ws.quizGenText': 'Le coach prépare tes questions (15-60 s). Ne ferme pas cette fenêtre.', 'ws.quizIntro': 'Format examen : choix unique ou multiple (nombre de réponses indiqué). Seuil de réussite : 70 %.',
  'ws.quizPick': 'Sélectionnez {n}', 'ws.quizSubmit': 'Valider mes réponses', 'ws.quizGrading': 'Correction…', 'ws.quizResult': 'Résultat : {ok}/{total} ({pct} %) — {verdict}', 'ws.quizPassed': 'module validé ✅', 'ws.quizFailed': 'objectif 70 % non atteint', 'ws.quizGood': 'Bonne réponse : {list}',
  'ws.debrief': '📋 Débrief de démarrage (page officielle, recherche web, confiance)', 'ws.welcome': 'Bonjour {name} ! Choisis une étape dans l’arbre à gauche ou dis-moi par où tu veux commencer.',
  'ws.startMsg': 'Commençons le module « {title} ».', 'ws.resumeMsg': 'Reprenons le module « {title} ».',
  'voice.listening': 'À l’écoute — parle naturellement', 'voice.hearing': 'Je t’entends…', 'voice.thinking': '{name} réfléchit…', 'voice.speaking': '{name} parle — micro en pause (⏹ ou Échap pour interrompre)', 'ws.interrupt': '⏹ Interrompre',
  'voice.unsupported': 'Reconnaissance vocale non supportée par ce navigateur : utilise Chrome, Edge ou Safari.',
  'chat.coach': 'Coach · {name}', 'chat.phase.course': '📖 Phase cours', 'chat.phase.check': '❓ Vérification', 'chat.phase.decision': '🧭 Décision', 'chat.concept': '💡 Concept clé', 'chat.analogy': '🔄 Analogie',
  'theme.toLight': 'Passer en mode clair', 'theme.toDark': 'Passer en mode sombre',
  'voice.err.not-allowed': 'Micro refusé : autorise l’accès au micro pour ce site puis réactive le mode vocal.', 'voice.err.service-not-allowed': 'Reconnaissance vocale bloquée par le navigateur ou le système.', 'voice.err.audio-capture': 'Aucun micro détecté.',
  'voice.err.language-not-supported': 'Langue non supportée par la reconnaissance vocale de ce navigateur ({lang}).', 'voice.err.network': 'La reconnaissance vocale de Chrome/Edge passe par un service en ligne : vérifie ta connexion Internet.',
  'voice.err.unstable': 'Reconnaissance vocale instable, mode vocal coupé.', 'voice.err.speak': 'Lecture vocale impossible : {detail}',
};

const en = {
  'app.name': '🎓 Coach AI', 'lang.label': 'Language', 'common.cancel': 'Cancel', 'common.remove': 'Remove', 'common.close': 'Close', 'common.back': '← Courses',
  'onb.intro': 'Your personal coach for certification prep. Everything stays on your machine; only the OpenAI API is called.',
  'onb.firstName': 'First name', 'onb.firstNamePh': 'Your first name', 'onb.apiKey': 'OpenAI API key (stored on this machine only)',
  'onb.persona': 'Your coach', 'onb.personaHint': 'Pick your coach’s personality and voice.', 'onb.try': 'Try', 'onb.continue': 'Continue', 'onb.verifying': 'Checking the key…',
  'persona.lumen.desc': 'Warm and patient, explains from several angles', 'persona.lumen.trait': 'Caring', 'persona.lumen.sample': 'Hello! I’m Lumen. We’ll move forward together, at your pace, and I’ll explain every concept from several angles.',
  'persona.vera.desc': 'Rigorous and precise, straight to the point', 'persona.vera.trait': 'Demanding', 'persona.vera.sample': 'Hello. I’m Vera. I’ll be direct and precise: every point must be mastered before we move on.',
  'persona.eko.desc': 'Dynamic and motivating, fast pace', 'persona.eko.trait': 'Energetic', 'persona.eko.sample': 'Hey! I’m Eko. Let’s go, fast pace: every right answer brings you closer to the certification!',
  'home.hello': 'Hello {name} 👋', 'home.new': '➕ New course', 'home.empty1': 'No course yet.', 'home.empty2': 'Give me the official URL of the exam you are aiming for: I’ll build your study plan.',
  'home.first': 'Create my first course', 'home.open': '▶ Open', 'home.continue': '↩ Resume', 'home.seeCreation': 'See creation', 'home.delete': 'Delete', 'home.creating': '⏳ Creating…', 'home.resume': '⚠ Creation to resume',
  'home.created': 'created on {date}', 'home.delTitle': 'Delete “{name}”?', 'home.delText': 'Progress, gaps and the whole history of this course will be permanently erased.',
  'form.title': 'New course', 'form.prefill': 'Prefill: {label}', 'form.name': 'Course name', 'form.namePh': 'E.g. AI-103 prep Oct 2026', 'form.nameSuggest': 'AI-103 prep',
  'form.url': 'Official exam page URL', 'form.required': '(required)', 'form.urlPh': 'https://learn.microsoft.com/…/study-guides/…',
  'form.urlHelp': 'Public vendor page listing the assessed skills and their weighting (“study guide”, “exam objectives”…).',
  'form.lang': 'Training language', 'form.langHelp': 'Language of the coach, interface, quizzes, plan and voice. Fixed for the whole course, even if you write in another language.',
  'form.annex': 'Extra links', 'form.optional': '(optional, 5 max)', 'form.annexPh': 'https://… (documentation, course, article)', 'form.add': '＋ Add a link', 'form.submit': 'Create my study plan',
  'form.errName': 'Give your course a name.', 'form.errUrl': 'The official exam URL is required.',
  'create.title': 'Creating “{name}”', 'create.note': 'A few dozen seconds, web search included. You can leave this page, creation keeps going.', 'create.stopped': '⚠ Creation stopped',
  'create.retry': 'Retry', 'create.paste': 'Paste the page content', 'create.pastePh': 'Paste the exam page content here (Ctrl+A, Ctrl+C on the official page)…', 'create.analyze': 'Analyse this text', 'create.home': 'Back to home',
  'create.done': 'Course created successfully', 'create.doneText': '{blocs} modules, {modules} sub-modules and a recap quiz per module.', 'create.start': 'OK → Start',
  'ws.msgPh': 'Type your message…', 'ws.send': 'Send', 'ws.voice': 'Voice mode', 'ws.voiceTip': 'Speak naturally: your sentence is sent to the coach when you pause, and the answer is read aloud',
  'ws.mute': '🎙 Mute microphone', 'ws.unmute': '🔇 Microphone muted — unmute', 'ws.diag': 'Level diagnostic', 'ws.recommended': 'recommended', 'ws.gaps': 'Gaps', 'ws.quizNode': '📝 Recap quiz',
  'ws.block': 'Module {n}', 'ws.blockDash': 'Module {n} — {name}', 'ws.blockWeight': 'Module {n} · official weight {w} %', 'ws.blockModules': '{n} sub-module(s), then a recap quiz to validate the module.',
  'ws.objective': 'Learning objective', 'ws.quizGoal': 'Validate the module “{name}” with at least 70 % correct answers.', 'ws.quizCovers': 'Topics covered: {list}',
  'ws.quizRetry': '📝 Retake the quiz', 'ws.quizStart': '📝 Start the recap quiz', 'ws.bestScore': 'Best score: {pct} %', 'ws.startCoach': '▶ Start with the coach', 'ws.reviseCoach': '↻ Revise with the coach', 'ws.resumeCoach': '▶ Resume with the coach',
  'ws.hoursProgress': '{h} h · progress {p} %', 'ws.progress': 'Progress', 'ws.menu': 'Open the programme', 'ws.steps': '{done}/{total} steps', 'ws.globalTip': 'Overall progress: {g} %',
  'ws.usage': 'API: {calls} calls{searches} · {k}k tokens{cost}', 'ws.usageSearches': ' (incl. {n} web searches)', 'ws.usageTip': 'Indicative estimate, prices editable in config.js.',
  'ws.usageStartup': 'Course creation (programme + search)', 'ws.usageDiag': 'Diagnostic', 'ws.usagePlan': 'Programme', 'ws.usageQuiz': 'Quizzes', 'ws.usageChat': 'Conversation', 'ws.usageLine': '{label}: {calls} call(s){searches}', 'ws.usageLineSearch': ', {n} web search(es)',
  'ws.gapsOpen': 'Open gaps ({n})', 'ws.gapsResolve': 'Resolved', 'ws.gapsNone': 'No open gaps 🎉 They appear after a diagnostic, a failed quiz, or when the coach spots one.',
  'ws.diagPrep': 'Preparing…', 'ws.diagTitle': 'Level diagnostic', 'ws.diagIntro': 'A few questions to calibrate your programme (duration, priorities). Possible until you start a module.',
  'ws.diagLevel': 'Your overall level', 'ws.lvBeg': 'Beginner', 'ws.lvMid': 'Intermediate', 'ws.lvAdv': 'Advanced', 'ws.diagHours': 'Hours available per week', 'ws.diagDate': 'Exam date (optional)', 'ws.diagSelf': 'Your perceived level in this domain',
  'ws.diagGo': 'Recalibrate my programme', 'ws.diagBusy': 'Generating… (15-60 s)', 'ws.quizPrep': 'Generating the quiz…', 'ws.ctaQuizTitle': 'Ready to test your knowledge?', 'ws.ctaQuizSub': 'Generate a recap quiz for this module', 'ws.ctaQuizBtn': 'Start the recap quiz', 'ws.ctaStartTitle': 'Start this module', 'ws.ctaStartBtn': 'Start with the coach', 'ws.quizGenTitle': 'Generating your quizzes...', 'ws.quizReadyTitle': 'Your quizzes are ready!', 'ws.quizBegin': 'Start', 'ws.quizGenText': 'The coach is preparing your questions (15-60 s). Please keep this window open.', 'ws.quizIntro': 'Exam format: single or multiple choice (number of answers shown). Pass mark: 70 %.',
  'ws.quizPick': 'Select {n}', 'ws.quizSubmit': 'Submit my answers', 'ws.quizGrading': 'Grading…', 'ws.quizResult': 'Result: {ok}/{total} ({pct} %) — {verdict}', 'ws.quizPassed': 'module validated ✅', 'ws.quizFailed': '70 % target not reached', 'ws.quizGood': 'Correct answer: {list}',
  'ws.debrief': '📋 Kick-off debrief (official page, web search, confidence)', 'ws.welcome': 'Hello {name}! Pick a step in the tree on the left or tell me where you want to start.',
  'ws.startMsg': 'Let’s start the module “{title}”.', 'ws.resumeMsg': 'Let’s resume the module “{title}”.',
  'voice.listening': 'Listening — speak naturally', 'voice.hearing': 'I hear you…', 'voice.thinking': '{name} is thinking…', 'voice.speaking': '{name} is speaking — microphone paused (⏹ or Esc to interrupt)', 'ws.interrupt': '⏹ Interrupt',
  'voice.unsupported': 'Speech recognition is not supported by this browser: use Chrome, Edge or Safari.',
  'chat.coach': 'Coach · {name}', 'chat.phase.course': '📖 Lesson phase', 'chat.phase.check': '❓ Check', 'chat.phase.decision': '🧭 Decision', 'chat.concept': '💡 Key concept', 'chat.analogy': '🔄 Analogy',
  'theme.toLight': 'Switch to light mode', 'theme.toDark': 'Switch to dark mode',
  'voice.err.not-allowed': 'Microphone denied: allow microphone access for this site, then turn voice mode back on.', 'voice.err.service-not-allowed': 'Speech recognition is blocked by the browser or the system.', 'voice.err.audio-capture': 'No microphone detected.',
  'voice.err.language-not-supported': 'Language not supported by this browser’s speech recognition ({lang}).', 'voice.err.network': 'Chrome/Edge speech recognition uses an online service: check your Internet connection.',
  'voice.err.unstable': 'Speech recognition unstable, voice mode turned off.', 'voice.err.speak': 'Speech playback impossible: {detail}',
};

const es = {
  'app.name': '🎓 Coach IA', 'lang.label': 'Idioma', 'common.cancel': 'Cancelar', 'common.remove': 'Quitar', 'common.close': 'Cerrar', 'common.back': '← Cursos',
  'onb.intro': 'Tu coach personal para preparar una certificación. Todo se queda en tu equipo; solo se llama a la API de OpenAI.',
  'onb.firstName': 'Nombre', 'onb.firstNamePh': 'Tu nombre', 'onb.apiKey': 'Clave API de OpenAI (guardada solo en este equipo)',
  'onb.persona': 'Tu coach', 'onb.personaHint': 'Elige la personalidad y la voz de tu coach.', 'onb.try': 'Probar', 'onb.continue': 'Continuar', 'onb.verifying': 'Comprobando la clave…',
  'persona.lumen.desc': 'Cálida y paciente, explica desde varios ángulos', 'persona.lumen.trait': 'Cercana', 'persona.lumen.sample': '¡Hola! Soy Lumen. Avanzaremos juntos, a tu ritmo, y te explicaré cada concepto desde varios ángulos.',
  'persona.vera.desc': 'Rigurosa y precisa, va directa al grano', 'persona.vera.trait': 'Exigente', 'persona.vera.sample': 'Hola. Soy Vera. Seré directa y precisa: cada punto debe dominarse antes de pasar al siguiente.',
  'persona.eko.desc': 'Dinámico y motivador, ritmo intenso', 'persona.eko.trait': 'Enérgico', 'persona.eko.sample': '¡Hola! Soy Eko. ¡Vamos, ritmo intenso: cada respuesta correcta te acerca a la certificación!',
  'home.hello': 'Hola {name} 👋', 'home.new': '➕ Nuevo curso', 'home.empty1': 'Todavía no hay ningún curso.', 'home.empty2': 'Dame la URL oficial del examen que quieres preparar: construiré tu plan de formación.',
  'home.first': 'Crear mi primer curso', 'home.open': '▶ Abrir', 'home.continue': '↩ Reanudar', 'home.seeCreation': 'Ver la creación', 'home.delete': 'Eliminar', 'home.creating': '⏳ Creándose…', 'home.resume': '⚠ Creación por reanudar',
  'home.created': 'creado el {date}', 'home.delTitle': '¿Eliminar «{name}»?', 'home.delText': 'El progreso, las lagunas y todo el historial de este curso se borrarán definitivamente.',
  'form.title': 'Nuevo curso', 'form.prefill': 'Rellenar: {label}', 'form.name': 'Nombre del curso', 'form.namePh': 'Ej.: Prep. AI-103 oct. 2026', 'form.nameSuggest': 'Prep. AI-103',
  'form.url': 'URL oficial de la página del examen', 'form.required': '(obligatorio)', 'form.urlPh': 'https://learn.microsoft.com/…/study-guides/…',
  'form.urlHelp': 'Página pública del fabricante con las competencias evaluadas y su ponderación («study guide», «exam objectives»…).',
  'form.lang': 'Idioma de formación', 'form.langHelp': 'Idioma del coach, de la interfaz, de los tests, del plan y de la voz. Fijo durante todo el curso, aunque escribas en otro idioma.',
  'form.annex': 'Enlaces adicionales', 'form.optional': '(opcional, máximo 5)', 'form.annexPh': 'https://… (documentación, curso, artículo)', 'form.add': '＋ Añadir un enlace', 'form.submit': 'Crear mi plan de formación',
  'form.errName': 'Ponle un nombre a tu curso.', 'form.errUrl': 'La URL oficial del examen es obligatoria.',
  'create.title': 'Creando «{name}»', 'create.note': 'Unas decenas de segundos, búsqueda web incluida. Puedes salir de esta página, la creación continúa.', 'create.stopped': '⚠ La creación se ha detenido',
  'create.retry': 'Reintentar', 'create.paste': 'Pegar el contenido de la página', 'create.pastePh': 'Pega aquí el contenido de la página del examen (Ctrl+A, Ctrl+C en la página oficial)…', 'create.analyze': 'Analizar este texto', 'create.home': 'Volver al inicio',
  'create.done': 'Curso creado con éxito', 'create.doneText': '{blocs} módulos, {modules} submódulos y un test resumen por módulo.', 'create.start': 'OK → Empezar',
  'ws.msgPh': 'Escribe tu mensaje…', 'ws.send': 'Enviar', 'ws.voice': 'Modo voz', 'ws.voiceTip': 'Habla con naturalidad: tu frase se envía al coach cuando haces una pausa y la respuesta se lee en voz alta',
  'ws.mute': '🎙 Silenciar micrófono', 'ws.unmute': '🔇 Micrófono silenciado — reactivar', 'ws.diag': 'Diagnóstico de nivel', 'ws.recommended': 'recomendado', 'ws.gaps': 'Lagunas', 'ws.quizNode': '📝 Test resumen',
  'ws.block': 'Módulo {n}', 'ws.blockDash': 'Módulo {n} — {name}', 'ws.blockWeight': 'Módulo {n} · peso oficial {w} %', 'ws.blockModules': '{n} submódulo(s), y después un test resumen para validar el módulo.',
  'ws.objective': 'Objetivo pedagógico', 'ws.quizGoal': 'Validar el módulo «{name}» con al menos un 70 % de aciertos.', 'ws.quizCovers': 'Contenidos cubiertos: {list}',
  'ws.quizRetry': '📝 Repetir el test', 'ws.quizStart': '📝 Iniciar el test resumen', 'ws.bestScore': 'Mejor puntuación: {pct} %', 'ws.startCoach': '▶ Empezar con el coach', 'ws.reviseCoach': '↻ Repasar con el coach', 'ws.resumeCoach': '▶ Continuar con el coach',
  'ws.hoursProgress': '{h} h · avance {p} %', 'ws.progress': 'Progreso', 'ws.menu': 'Abrir el programa', 'ws.steps': '{done}/{total} etapas', 'ws.globalTip': 'Progreso global: {g} %',
  'ws.usage': 'API: {calls} llamadas{searches} · {k}k tokens{cost}', 'ws.usageSearches': ' (de ellas {n} búsquedas web)', 'ws.usageTip': 'Estimación orientativa, tarifas editables en config.js.',
  'ws.usageStartup': 'Creación del curso (programa + búsqueda)', 'ws.usageDiag': 'Diagnóstico', 'ws.usagePlan': 'Programa', 'ws.usageQuiz': 'Tests', 'ws.usageChat': 'Conversación', 'ws.usageLine': '{label}: {calls} llamada(s){searches}', 'ws.usageLineSearch': ', {n} búsqueda(s) web',
  'ws.gapsOpen': 'Lagunas abiertas ({n})', 'ws.gapsResolve': 'Resuelta', 'ws.gapsNone': 'Ninguna laguna abierta 🎉 Aparecen tras un diagnóstico, un test fallado o cuando el coach detecta una.',
  'ws.diagPrep': 'Preparando…', 'ws.diagTitle': 'Diagnóstico de nivel', 'ws.diagIntro': 'Unas preguntas para calibrar tu programa (duración, prioridades). Posible mientras no hayas empezado un módulo.',
  'ws.diagLevel': 'Tu nivel general', 'ws.lvBeg': 'Principiante', 'ws.lvMid': 'Intermedio', 'ws.lvAdv': 'Avanzado', 'ws.diagHours': 'Horas disponibles por semana', 'ws.diagDate': 'Fecha del examen (opcional)', 'ws.diagSelf': 'Tu nivel percibido en este dominio',
  'ws.diagGo': 'Recalibrar mi programa', 'ws.diagBusy': 'Generando… (15-60 s)', 'ws.quizPrep': 'Generando el test…', 'ws.ctaQuizTitle': '¿Listo para probar tus conocimientos?', 'ws.ctaQuizSub': 'Genera un test resumen para este módulo', 'ws.ctaQuizBtn': 'Iniciar el test resumen', 'ws.ctaStartTitle': 'Empezar este módulo', 'ws.ctaStartBtn': 'Empezar con el coach', 'ws.quizGenTitle': 'Generando los tests...', 'ws.quizReadyTitle': '¡Tus tests están listos!', 'ws.quizBegin': 'Empezar', 'ws.quizGenText': 'El coach está preparando tus preguntas (15-60 s). No cierres esta ventana.', 'ws.quizIntro': 'Formato de examen: respuesta única o múltiple (se indica el número de respuestas). Nota de corte: 70 %.',
  'ws.quizPick': 'Selecciona {n}', 'ws.quizSubmit': 'Validar mis respuestas', 'ws.quizGrading': 'Corrigiendo…', 'ws.quizResult': 'Resultado: {ok}/{total} ({pct} %) — {verdict}', 'ws.quizPassed': 'módulo validado ✅', 'ws.quizFailed': 'objetivo del 70 % no alcanzado', 'ws.quizGood': 'Respuesta correcta: {list}',
  'ws.debrief': '📋 Resumen inicial (página oficial, búsqueda web, confianza)', 'ws.welcome': '¡Hola {name}! Elige una etapa en el árbol de la izquierda o dime por dónde quieres empezar.',
  'ws.startMsg': 'Empecemos el módulo «{title}».', 'ws.resumeMsg': 'Retomemos el módulo «{title}».',
  'voice.listening': 'Escuchando — habla con naturalidad', 'voice.hearing': 'Te oigo…', 'voice.thinking': '{name} está pensando…', 'voice.speaking': '{name} está hablando — micrófono en pausa (⏹ o Esc para interrumpir)', 'ws.interrupt': '⏹ Interrumpir',
  'voice.unsupported': 'Este navegador no admite reconocimiento de voz: usa Chrome, Edge o Safari.',
  'chat.coach': 'Coach · {name}', 'chat.phase.course': '📖 Fase de curso', 'chat.phase.check': '❓ Verificación', 'chat.phase.decision': '🧭 Decisión', 'chat.concept': '💡 Concepto clave', 'chat.analogy': '🔄 Analogía',
  'theme.toLight': 'Cambiar a modo claro', 'theme.toDark': 'Cambiar a modo oscuro',
  'voice.err.not-allowed': 'Micrófono denegado: permite el acceso al micrófono para este sitio y vuelve a activar el modo voz.', 'voice.err.service-not-allowed': 'El reconocimiento de voz está bloqueado por el navegador o el sistema.', 'voice.err.audio-capture': 'No se ha detectado ningún micrófono.',
  'voice.err.language-not-supported': 'Idioma no admitido por el reconocimiento de voz de este navegador ({lang}).', 'voice.err.network': 'El reconocimiento de voz de Chrome/Edge usa un servicio en línea: comprueba tu conexión a Internet.',
  'voice.err.unstable': 'Reconocimiento de voz inestable, modo voz desactivado.', 'voice.err.speak': 'No se puede reproducir la voz: {detail}',
};

export const DICT = { 'fr-FR': fr, 'en-GB': en, 'es-ES': es };

let lang = DEFAULT_LANG;
const bound = new Set(); // éléments dont le texte suit la langue (formulaires qui changent dynamiquement)

export const isLang = (l) => Object.hasOwn(DICT, l);
export const getLang = () => lang;

export function t(key, params = {}) {
  const tpl = DICT[lang][key] ?? fr[key] ?? key;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}

/** Lie une propriété d'un élément (textContent, placeholder, title…) à une clé : mise à jour automatique au changement de langue. */
export function bindT(node, prop, key, params) {
  const apply = () => { node[prop] = t(key, typeof params === 'function' ? params() : params); };
  apply();
  bound.add({ node, apply });
  return node;
}

/** Lie un élément à une fonction de rendu : rappelée à chaque changement de langue (ex. libellés dépendant de plusieurs états). */
export function bindFn(node, fn) {
  fn(node);
  bound.add({ node, apply: () => fn(node) });
  return node;
}

export function setLang(next, { persist = false } = {}) {
  lang = isLang(next) ? next : DEFAULT_LANG;
  if (typeof document !== 'undefined') document.documentElement.lang = lang.slice(0, 2);
  if (persist) { try { localStorage.setItem('coach.lang', lang); } catch { /* stockage indisponible */ } }
  for (const b of [...bound]) {
    if (typeof document !== 'undefined' && !b.node.isConnected) bound.delete(b);
    else b.apply();
  }
}

export function storedLang() {
  try { const l = localStorage.getItem('coach.lang'); return isLang(l) ? l : DEFAULT_LANG; } catch { return DEFAULT_LANG; }
}
