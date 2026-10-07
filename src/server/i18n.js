import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LANGUAGE, normalizeLanguage } from './coach/language.js';

/**
 * Messages visibles produits par le serveur (erreurs, débrief, plan, QCM…) dans la langue du cursus.
 * Le contexte de langue (AsyncLocalStorage) vient de l'en-tête x-lang de la requête, puis du cursus une fois chargé.
 */
const als = new AsyncLocalStorage();
export const withLang = (lang, fn) => als.run({ lang: normalizeLanguage(lang) }, fn);
export const setCtxLang = (lang) => { const s = als.getStore(); if (s && lang) s.lang = normalizeLanguage(lang); };
export const currentLang = () => als.getStore()?.lang ?? DEFAULT_LANGUAGE;

const fr = {
  // erreurs
  'err.host': 'host interdit', 'err.origin': 'origin interdit', 'err.bodyTooBig': 'corps trop volumineux', 'err.badJson': 'JSON invalide',
  'err.forbidden': 'interdit', 'err.notFound': 'introuvable', 'err.unknownCurriculum': 'Cursus inconnu',
  'err.nameRequired': 'Prénom requis', 'err.keyRequired': 'Clé API requise', 'err.keyRefused': 'Clé refusée par OpenAI : {msg}', 'err.openaiDown': 'OpenAI injoignable',
  'err.unknownPersona': 'Persona inconnu', 'err.onboardingRequired': 'Onboarding requis', 'err.cursusNameRequired': 'Nom du cursus requis',
  'err.officialUrl': 'URL officielle : {msg}', 'err.unknownLanguage': 'Langue de formation inconnue', 'err.annexInvalid': 'Liens annexes invalides',
  'err.annexMax': '{n} liens annexes maximum', 'err.annexLink': 'Lien annexe : {msg}', 'err.noFailure': 'Aucun échec à relancer', 'err.notBlocked': 'Cursus non bloqué',
  'err.textShort': 'Texte trop court : colle le contenu complet de la page', 'err.noDomainInText': 'Aucun domaine détecté dans ce texte',
  'err.diagDone': 'Diagnostic déjà effectué', 'err.diagUnavailable': 'Diagnostic indisponible (cursus déjà démarré ou en création)', 'err.diagUnavailableShort': 'Diagnostic indisponible',
  'err.diagNotStarted': 'Diagnostic non démarré', 'err.genRunning': 'Génération en cours', 'err.badAnswers': 'Réponses invalides', 'err.unknownModule': 'Module inconnu',
  'err.noQuiz': 'Aucun QCM en cours pour ce module', 'err.unknownGap': 'Lacune inconnue', 'err.emptyMessage': 'Message vide', 'err.onboardingOrCursus': 'Onboarding ou cursus manquant',
  'err.noDomainPage': 'Aucun domaine détecté dans la page fournie : est-ce bien la page d\'examen ou le « study guide » ?', 'err.quizUnusable': 'QCM généré inexploitable, réessaie',
  'url.invalid': 'URL invalide : {raw}', 'url.https': 'Seules les URL https:// sont acceptées', 'url.creds': 'URL avec identifiants refusée', 'url.local': 'Adresse locale refusée',
  'url.private': 'Adresse privée refusée', 'url.http': 'Page inaccessible (HTTP {status})', 'url.redirects': 'Trop de redirections',
  'page.empty': 'Page vide ou non exploitable (contenu rendu par JavaScript ?)',
  'warn.noDomain': 'aucun domaine extrait', 'warn.ungrounded': 'certains domaines ne figurent pas textuellement dans la page', 'warn.weights': 'pondérations incohérentes (somme {min}–{max} %)',
  // création
  'step.fetch': 'Récupération de la page officielle…', 'step.extract': 'Extraction des domaines et pondérations…', 'step.resources': 'Recherche de ressources complémentaires…',
  'step.qcm': 'Recherche de QCM et tests blancs…', 'step.plan': 'Construction du plan personnalisé…',
  'research.noSources': 'aucune source vérifiable trouvée (ni citation fournie par l\'API, ni lien joignable)', 'debrief.unverified': '(lien non vérifiable automatiquement : le site bloque les robots)',
  // confiance
  'level.high': 'élevée', 'level.medium': 'moyenne', 'level.low': 'faible',
  'conf.ok': 'programme officiel extrait et cohérent', 'conf.partial': 'programme officiel extrait avec réserves ({warnings})', 'conf.failed': 'programme officiel non récupéré ({error})', 'conf.failedGeneric': 'échec',
  'conf.date': 'date de mise à jour trouvée ({date})', 'conf.noDate': 'date de mise à jour introuvable', 'conf.weights': 'pondérations cohérentes (≈100 %)', 'conf.noWeights': 'pondérations absentes ou incohérentes',
  'conf.qcm': '{n} tests/QCM gratuits vérifiés', 'conf.qcmFew': 'seulement {n} test(s)/QCM gratuit(s) vérifié(s)', 'conf.res': '{n} ressources complémentaires vérifiées', 'conf.resFew': 'seulement {n} ressource(s) vérifiée(s)',
  'conf.tips': '{n} tips recoupés sur {h} sources distinctes', 'conf.tipsFew': 'tips insuffisants ou pas assez recoupés', 'conf.official': 'au moins une source officielle dans la recherche', 'conf.noOfficial': 'aucune source officielle dans la recherche',
  // débrief
  'debrief.title': '📋 Débrief de démarrage — {cert}', 'debrief.s1': '1) Ce que dit la page officielle',
  'debrief.failed': '• Non récupérée : {error}. Je ne te donne donc aucune pondération que je ne peux pas sourcer.', 'debrief.sourceTarget': '  Source visée : {url}',
  'debrief.source': '• Source : {url} (consultée le {date})', 'debrief.updated': '• Dernière mise à jour du programme : {date}', 'debrief.notIndicated': 'non indiquée', 'debrief.domains': '• Domaines et pondérations :',
  'debrief.notFound': ' (⚠ non retrouvé tel quel dans la page)', 'debrief.annex': 'Liens annexes que tu as fournis :', 'debrief.annexOk': '(lu, pris en compte pour le plan)', 'debrief.annexKo': '(⚠ illisible : {error})',
  'debrief.s2': '2) Ce que donne la recherche complémentaire (sources officielles ou reconnues, URL vérifiées)', 'debrief.qcm': 'Tests blancs / QCM gratuits ({n})', 'debrief.questions': '{n} questions',
  'debrief.res': 'Ressources complémentaires ({n})', 'debrief.tipsHead': 'Tips de candidats ({n}) — retours communautaires, indicatifs', 'debrief.tipSource': 'source : {url}',
  'debrief.searchFailed': '⚠ Recherche « {key} » en échec : {msg}', 'debrief.dropped': '({n} résultat(s) écarté(s) : source non fiable, non retrouvée par la recherche, ou payante.)',
  'debrief.dumps': 'Note : les sites de « dumps » (ex. Examtopics) sont exclus volontairement — leurs questions sont souvent réelles (interdit par la politique d\'examen) et leurs réponses régulièrement fausses.',
  'debrief.s3': '3) Confiance pour construire ton plan : {level} ({score}/100)', 'debrief.tierOfficial': 'officiel', 'debrief.tierRecognized': 'reconnu',
  'debrief.needProgramme': '{name}, je ne peux pas encore bâtir un plan fiable sans le programme officiel. Réessaie l\'analyse, ou colle-moi ici le contenu de la page study guide.', 'debrief.planReady': '{name}, ton plan initial est prêt. Le diagnostic de niveau le recalibrera sur ton niveau réel.',
  // plan
  'plan.overviewFallback': 'Plan généré automatiquement à partir des pondérations officielles.', 'plan.rationale': 'Poids {min}–{max} %, niveau initial {level} %', 'plan.quizTitle': 'QCM récap — {domain}', 'plan.quizRationale': 'Valide le bloc (seuil 70 %)',
  'plan.introHead': '{name}, ton plan initial est prêt (≈ {hours} h, base {hpw} h/semaine sur {weeks} semaines).', 'plan.blocks': 'Modules :',
  'plan.introTail': 'Chaque module se termine par un QCM récap (seuil 70 %). Ce plan suppose un niveau intermédiaire : le diagnostic (dans l\'arbre, à gauche) le recalibre selon ton niveau réel, ton temps disponible et ta date d\'examen.',
  'plan.sumHead': 'Merci {name} ! Voici ton diagnostic et ton programme recalibré.', 'plan.sumLevels': 'Niveau de départ par domaine :', 'plan.sumProgram': 'Programme (≈ {hours} h sur {weeks} semaine(s), {hpw} h/semaine) :',
  'plan.sumStart': 'On commence par « {title} ». Dis-moi quand tu veux démarrer, ou choisis un autre élément dans l\'arbre à gauche.',
  // diagnostic / QCM
  'gap.overconfident': 'Auto-évaluation élevée ({self}/5) mais QCM diagnostic raté : {expl}', 'gap.mcqFailed': 'QCM diagnostic raté : {expl}', 'gap.selfLow': 'Auto-évaluation basse ({self}/5)',
  'gap.quiz': 'QCM « {title} » : {q} → {expl}',
  'quiz.summaryPass': 'QCM « {title} » : {ok}/{total} ({pct} %) — objectif {target} % atteint, module validé ✅', 'quiz.summaryFail': 'QCM « {title} » : {ok}/{total} ({pct} %) — objectif {target} % non atteint : on revoit les points ci-dessous avant de retenter.',
};

const en = {
  'err.host': 'host not allowed', 'err.origin': 'origin not allowed', 'err.bodyTooBig': 'request body too large', 'err.badJson': 'invalid JSON',
  'err.forbidden': 'forbidden', 'err.notFound': 'not found', 'err.unknownCurriculum': 'Unknown course',
  'err.nameRequired': 'First name required', 'err.keyRequired': 'API key required', 'err.keyRefused': 'Key rejected by OpenAI: {msg}', 'err.openaiDown': 'OpenAI unreachable',
  'err.unknownPersona': 'Unknown persona', 'err.onboardingRequired': 'Onboarding required', 'err.cursusNameRequired': 'Course name required',
  'err.officialUrl': 'Official URL: {msg}', 'err.unknownLanguage': 'Unknown training language', 'err.annexInvalid': 'Invalid extra links',
  'err.annexMax': '{n} extra links maximum', 'err.annexLink': 'Extra link: {msg}', 'err.noFailure': 'No failure to retry', 'err.notBlocked': 'Course is not blocked',
  'err.textShort': 'Text too short: paste the full content of the page', 'err.noDomainInText': 'No domain detected in this text',
  'err.diagDone': 'Diagnostic already done', 'err.diagUnavailable': 'Diagnostic unavailable (course already started or still being created)', 'err.diagUnavailableShort': 'Diagnostic unavailable',
  'err.diagNotStarted': 'Diagnostic not started', 'err.genRunning': 'Generation in progress', 'err.badAnswers': 'Invalid answers', 'err.unknownModule': 'Unknown module',
  'err.noQuiz': 'No quiz in progress for this module', 'err.unknownGap': 'Unknown gap', 'err.emptyMessage': 'Empty message', 'err.onboardingOrCursus': 'Onboarding or course missing',
  'err.noDomainPage': 'No domain found on the given page: is it really the exam page or the study guide?', 'err.quizUnusable': 'Generated quiz unusable, please retry',
  'url.invalid': 'Invalid URL: {raw}', 'url.https': 'Only https:// URLs are accepted', 'url.creds': 'URLs with credentials are refused', 'url.local': 'Local address refused',
  'url.private': 'Private address refused', 'url.http': 'Page unreachable (HTTP {status})', 'url.redirects': 'Too many redirects',
  'page.empty': 'Page empty or unusable (content rendered by JavaScript?)',
  'warn.noDomain': 'no domain extracted', 'warn.ungrounded': 'some domains do not appear verbatim in the page', 'warn.weights': 'inconsistent weightings (sum {min}–{max} %)',
  'step.fetch': 'Fetching the official page…', 'step.extract': 'Extracting domains and weightings…', 'step.resources': 'Searching complementary resources…',
  'step.qcm': 'Searching quizzes and practice tests…', 'step.plan': 'Building your personalised plan…',
  'research.noSources': 'no verifiable source found (no citation from the API, no reachable link)', 'debrief.unverified': '(link could not be verified automatically: the site blocks bots)',
  'level.high': 'high', 'level.medium': 'medium', 'level.low': 'low',
  'conf.ok': 'official programme extracted and consistent', 'conf.partial': 'official programme extracted with caveats ({warnings})', 'conf.failed': 'official programme not retrieved ({error})', 'conf.failedGeneric': 'failure',
  'conf.date': 'update date found ({date})', 'conf.noDate': 'update date not found', 'conf.weights': 'consistent weightings (≈100 %)', 'conf.noWeights': 'weightings missing or inconsistent',
  'conf.qcm': '{n} free quizzes/practice tests verified', 'conf.qcmFew': 'only {n} free quiz(zes)/practice test(s) verified', 'conf.res': '{n} complementary resources verified', 'conf.resFew': 'only {n} resource(s) verified',
  'conf.tips': '{n} tips cross-checked across {h} distinct sources', 'conf.tipsFew': 'tips insufficient or not cross-checked enough', 'conf.official': 'at least one official source in the search', 'conf.noOfficial': 'no official source in the search',
  'debrief.title': '📋 Kick-off debrief — {cert}', 'debrief.s1': '1) What the official page says',
  'debrief.failed': '• Not retrieved: {error}. So I am not giving you any weighting I cannot source.', 'debrief.sourceTarget': '  Target source: {url}',
  'debrief.source': '• Source: {url} (read on {date})', 'debrief.updated': '• Programme last updated: {date}', 'debrief.notIndicated': 'not indicated', 'debrief.domains': '• Domains and weightings:',
  'debrief.notFound': ' (⚠ not found verbatim in the page)', 'debrief.annex': 'Extra links you provided:', 'debrief.annexOk': '(read, used for the plan)', 'debrief.annexKo': '(⚠ unreadable: {error})',
  'debrief.s2': '2) What the complementary search found (official or recognised sources, verified URLs)', 'debrief.qcm': 'Free quizzes / practice tests ({n})', 'debrief.questions': '{n} questions',
  'debrief.res': 'Complementary resources ({n})', 'debrief.tipsHead': 'Candidate tips ({n}) — community feedback, indicative', 'debrief.tipSource': 'source: {url}',
  'debrief.searchFailed': '⚠ Search "{key}" failed: {msg}', 'debrief.dropped': '({n} result(s) discarded: unreliable source, not found by the search, or paid.)',
  'debrief.dumps': 'Note: "dump" sites (e.g. Examtopics) are deliberately excluded — their questions are often real exam questions (forbidden by exam policy) and their answers are regularly wrong.',
  'debrief.s3': '3) Confidence for building your plan: {level} ({score}/100)', 'debrief.tierOfficial': 'official', 'debrief.tierRecognized': 'recognised',
  'debrief.needProgramme': '{name}, I cannot build a reliable plan yet without the official programme. Retry the analysis, or paste the content of the study guide page here.', 'debrief.planReady': '{name}, your initial plan is ready. The level diagnostic will recalibrate it to your real level.',
  'plan.overviewFallback': 'Plan generated automatically from the official weightings.', 'plan.rationale': 'Weight {min}–{max} %, initial level {level} %', 'plan.quizTitle': 'Recap quiz — {domain}', 'plan.quizRationale': 'Validates the block (70 % threshold)',
  'plan.introHead': '{name}, your initial plan is ready (≈ {hours} h, based on {hpw} h/week over {weeks} weeks).', 'plan.blocks': 'Modules:',
  'plan.introTail': 'Each module ends with a recap quiz (70 % threshold). This plan assumes an intermediate level: the diagnostic (in the tree, on the left) recalibrates it to your real level, available time and exam date.',
  'plan.sumHead': 'Thanks {name}! Here is your diagnostic and your recalibrated programme.', 'plan.sumLevels': 'Starting level per domain:', 'plan.sumProgram': 'Programme (≈ {hours} h over {weeks} week(s), {hpw} h/week):',
  'plan.sumStart': 'We start with "{title}". Tell me when you want to begin, or pick another item in the tree on the left.',
  'gap.overconfident': 'High self-assessment ({self}/5) but diagnostic question missed: {expl}', 'gap.mcqFailed': 'Diagnostic question missed: {expl}', 'gap.selfLow': 'Low self-assessment ({self}/5)',
  'gap.quiz': 'Quiz "{title}": {q} → {expl}',
  'quiz.summaryPass': 'Quiz "{title}": {ok}/{total} ({pct} %) — {target} % target reached, module validated ✅', 'quiz.summaryFail': 'Quiz "{title}": {ok}/{total} ({pct} %) — {target} % target not reached: let\'s review the points below before retrying.',
};

const es = {
  'err.host': 'host no permitido', 'err.origin': 'origin no permitido', 'err.bodyTooBig': 'cuerpo demasiado grande', 'err.badJson': 'JSON no válido',
  'err.forbidden': 'prohibido', 'err.notFound': 'no encontrado', 'err.unknownCurriculum': 'Curso desconocido',
  'err.nameRequired': 'Nombre obligatorio', 'err.keyRequired': 'Clave API obligatoria', 'err.keyRefused': 'Clave rechazada por OpenAI: {msg}', 'err.openaiDown': 'OpenAI no accesible',
  'err.unknownPersona': 'Persona desconocida', 'err.onboardingRequired': 'Configuración inicial necesaria', 'err.cursusNameRequired': 'Nombre del curso obligatorio',
  'err.officialUrl': 'URL oficial: {msg}', 'err.unknownLanguage': 'Idioma de formación desconocido', 'err.annexInvalid': 'Enlaces adicionales no válidos',
  'err.annexMax': 'Máximo {n} enlaces adicionales', 'err.annexLink': 'Enlace adicional: {msg}', 'err.noFailure': 'No hay ningún fallo que reintentar', 'err.notBlocked': 'El curso no está bloqueado',
  'err.textShort': 'Texto demasiado corto: pega el contenido completo de la página', 'err.noDomainInText': 'No se ha detectado ningún dominio en este texto',
  'err.diagDone': 'Diagnóstico ya realizado', 'err.diagUnavailable': 'Diagnóstico no disponible (curso ya iniciado o en creación)', 'err.diagUnavailableShort': 'Diagnóstico no disponible',
  'err.diagNotStarted': 'Diagnóstico no iniciado', 'err.genRunning': 'Generación en curso', 'err.badAnswers': 'Respuestas no válidas', 'err.unknownModule': 'Módulo desconocido',
  'err.noQuiz': 'No hay ningún test en curso para este módulo', 'err.unknownGap': 'Laguna desconocida', 'err.emptyMessage': 'Mensaje vacío', 'err.onboardingOrCursus': 'Falta la configuración inicial o el curso',
  'err.noDomainPage': 'No se ha detectado ningún dominio en la página indicada: ¿es realmente la página del examen o la guía de estudio?', 'err.quizUnusable': 'Test generado inutilizable, inténtalo de nuevo',
  'url.invalid': 'URL no válida: {raw}', 'url.https': 'Solo se aceptan URL https://', 'url.creds': 'URL con credenciales rechazada', 'url.local': 'Dirección local rechazada',
  'url.private': 'Dirección privada rechazada', 'url.http': 'Página inaccesible (HTTP {status})', 'url.redirects': 'Demasiadas redirecciones',
  'page.empty': 'Página vacía o inutilizable (¿contenido generado por JavaScript?)',
  'warn.noDomain': 'ningún dominio extraído', 'warn.ungrounded': 'algunos dominios no aparecen literalmente en la página', 'warn.weights': 'ponderaciones incoherentes (suma {min}–{max} %)',
  'step.fetch': 'Obteniendo la página oficial…', 'step.extract': 'Extrayendo dominios y ponderaciones…', 'step.resources': 'Buscando recursos complementarios…',
  'step.qcm': 'Buscando tests y exámenes de prueba…', 'step.plan': 'Construyendo tu plan personalizado…',
  'research.noSources': 'no se ha encontrado ninguna fuente verificable (ni citas de la API, ni enlaces accesibles)', 'debrief.unverified': '(enlace no verificable automáticamente: el sitio bloquea robots)',
  'level.high': 'alta', 'level.medium': 'media', 'level.low': 'baja',
  'conf.ok': 'programa oficial extraído y coherente', 'conf.partial': 'programa oficial extraído con reservas ({warnings})', 'conf.failed': 'programa oficial no obtenido ({error})', 'conf.failedGeneric': 'fallo',
  'conf.date': 'fecha de actualización encontrada ({date})', 'conf.noDate': 'fecha de actualización no encontrada', 'conf.weights': 'ponderaciones coherentes (≈100 %)', 'conf.noWeights': 'ponderaciones ausentes o incoherentes',
  'conf.qcm': '{n} tests gratuitos verificados', 'conf.qcmFew': 'solo {n} test(s) gratuito(s) verificado(s)', 'conf.res': '{n} recursos complementarios verificados', 'conf.resFew': 'solo {n} recurso(s) verificado(s)',
  'conf.tips': '{n} consejos contrastados en {h} fuentes distintas', 'conf.tipsFew': 'consejos insuficientes o poco contrastados', 'conf.official': 'al menos una fuente oficial en la búsqueda', 'conf.noOfficial': 'ninguna fuente oficial en la búsqueda',
  'debrief.title': '📋 Resumen inicial — {cert}', 'debrief.s1': '1) Lo que dice la página oficial',
  'debrief.failed': '• No obtenida: {error}. Por eso no te doy ninguna ponderación que no pueda citar.', 'debrief.sourceTarget': '  Fuente objetivo: {url}',
  'debrief.source': '• Fuente: {url} (consultada el {date})', 'debrief.updated': '• Última actualización del programa: {date}', 'debrief.notIndicated': 'no indicada', 'debrief.domains': '• Dominios y ponderaciones:',
  'debrief.notFound': ' (⚠ no encontrado literalmente en la página)', 'debrief.annex': 'Enlaces adicionales que has aportado:', 'debrief.annexOk': '(leído, tenido en cuenta para el plan)', 'debrief.annexKo': '(⚠ ilegible: {error})',
  'debrief.s2': '2) Lo que aporta la búsqueda complementaria (fuentes oficiales o reconocidas, URL verificadas)', 'debrief.qcm': 'Tests / exámenes de prueba gratuitos ({n})', 'debrief.questions': '{n} preguntas',
  'debrief.res': 'Recursos complementarios ({n})', 'debrief.tipsHead': 'Consejos de candidatos ({n}) — opiniones de la comunidad, orientativas', 'debrief.tipSource': 'fuente: {url}',
  'debrief.searchFailed': '⚠ La búsqueda «{key}» ha fallado: {msg}', 'debrief.dropped': '({n} resultado(s) descartado(s): fuente poco fiable, no encontrada por la búsqueda o de pago.)',
  'debrief.dumps': 'Nota: los sitios de «dumps» (p. ej. Examtopics) se excluyen deliberadamente: sus preguntas suelen ser reales (prohibido por la política de examen) y sus respuestas a menudo son erróneas.',
  'debrief.s3': '3) Confianza para construir tu plan: {level} ({score}/100)', 'debrief.tierOfficial': 'oficial', 'debrief.tierRecognized': 'reconocido',
  'debrief.needProgramme': '{name}, todavía no puedo construir un plan fiable sin el programa oficial. Reintenta el análisis o pega aquí el contenido de la página de la guía de estudio.', 'debrief.planReady': '{name}, tu plan inicial está listo. El diagnóstico de nivel lo recalibrará según tu nivel real.',
  'plan.overviewFallback': 'Plan generado automáticamente a partir de las ponderaciones oficiales.', 'plan.rationale': 'Peso {min}–{max} %, nivel inicial {level} %', 'plan.quizTitle': 'Test resumen — {domain}', 'plan.quizRationale': 'Valida el bloque (umbral 70 %)',
  'plan.introHead': '{name}, tu plan inicial está listo (≈ {hours} h, base {hpw} h/semana durante {weeks} semanas).', 'plan.blocks': 'Módulos:',
  'plan.introTail': 'Cada módulo termina con un test resumen (umbral 70 %). Este plan supone un nivel intermedio: el diagnóstico (en el árbol, a la izquierda) lo recalibra según tu nivel real, tu tiempo disponible y la fecha del examen.',
  'plan.sumHead': '¡Gracias {name}! Aquí tienes tu diagnóstico y tu programa recalibrado.', 'plan.sumLevels': 'Nivel de partida por dominio:', 'plan.sumProgram': 'Programa (≈ {hours} h en {weeks} semana(s), {hpw} h/semana):',
  'plan.sumStart': 'Empezamos por «{title}». Dime cuándo quieres empezar o elige otro elemento en el árbol de la izquierda.',
  'gap.overconfident': 'Autoevaluación alta ({self}/5) pero pregunta del diagnóstico fallada: {expl}', 'gap.mcqFailed': 'Pregunta del diagnóstico fallada: {expl}', 'gap.selfLow': 'Autoevaluación baja ({self}/5)',
  'gap.quiz': 'Test «{title}»: {q} → {expl}',
  'quiz.summaryPass': 'Test «{title}»: {ok}/{total} ({pct} %) — objetivo del {target} % alcanzado, módulo validado ✅', 'quiz.summaryFail': 'Test «{title}»: {ok}/{total} ({pct} %) — objetivo del {target} % no alcanzado: repasamos los puntos siguientes antes de reintentar.',
};

export const MESSAGES = { 'fr-FR': fr, 'en-GB': en, 'es-ES': es };

/** Message traduit ; retombe sur le français puis sur la clé. Les {paramètres} sont substitués. */
export function tt(key, params = {}, lang = currentLang()) {
  const tpl = MESSAGES[lang]?.[key] ?? fr[key];
  if (tpl === undefined) return key;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}
