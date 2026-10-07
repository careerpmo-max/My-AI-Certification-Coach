/**
 * Mode vocal 100 % navigateur : SpeechRecognition (écoute continue) + speechSynthesis (lecture des réponses).
 * Aucun appel OpenAI supplémentaire : le texte reconnu part dans le chat existant, la réponse est lue à voix haute.
 * Note : Chrome/Edge effectuent la reconnaissance via un service en ligne de l'éditeur du navigateur.
 * Ce fichier n'accède aux API navigateur que dans start()/speak : la logique est testée sous Node avec des faux.
 */

const strip = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ');
const tokens = (s) => strip(s).split(/\s+/).filter((t) => t.length > 1);

/** Nettoie un texte destiné à la synthèse : pas de markdown, de code ni d'URL lues à voix haute. */
export function cleanForSpeech(text) {
  return text
    .replace(/\[\/?(?:CONCEPT|ANALOGIE|ANALOGY|SECTION)(?:\s*:[^\]]*)?\]/gi, ' ') // balises de mise en forme : affichées, jamais lues
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[*_~#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?…])/g, '$1')
    .trim();
}

/**
 * Découpe un flux de texte en phrases complètes ; renvoie [phrases prêtes, reste]. Aucun caractère n'est jamais perdu.
 * Une ponctuation en bout de tampon n'est pas encore une fin de phrase (« 3. » peut devenir « 3.5 ») : elle attend la suite.
 */
export function splitSentences(buffer, final = false) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (ch === '\n') {
      out.push(buffer.slice(start, i + 1));
      start = i + 1;
    } else if ('.!?…'.includes(ch)) {
      let j = i + 1;
      while (j < buffer.length && '.!?…"»)]'.includes(buffer[j])) j++;
      if (j >= buffer.length) break;
      if (/\s/.test(buffer[j])) {
        out.push(buffer.slice(start, j));
        start = j;
      }
      i = j - 1;
    }
  }
  const rest = buffer.slice(start);
  return final && rest.trim() ? [[...out, rest], ''] : [out, rest];
}

const normLang = (l) => (l ?? '').replace('_', '-').toLowerCase();

/** Voix de la langue du cursus : région exacte si elle existe, sinon même langue. */
export function voicesFor(voices, lang) {
  const want = normLang(lang);
  const exact = voices.filter((v) => normLang(v.lang) === want);
  return exact.length ? exact : voices.filter((v) => normLang(v.lang).split('-')[0] === want.split('-')[0]);
}

/** Première voix système de la langue du cursus (exacte, sinon même langue), sinon null = voix par défaut. */
export function pickVoice(voices, lang) {
  return voicesFor(voices, lang)[0] ?? null;
}

const FEMALE = /\b(female|femme|mujer|woman)\b|\b(amelie|amélie|audrey|aurelie|aurélie|marie|julie|hortense|denise|eloise|éloïse|brigitte|virginie|celine|céline|hazel|susan|libby|sonia|maisie|kate|serena|stephanie|martha|fiona|karen|samantha|victoria|helena|laura|elvira|abril|monica|mónica|paulina|marisol|paloma|lucia|lucía|elena|carmen|alice|elsa|katja|hedda|amala|anna|petra|marlene|isabella|federica|paola)\b/i;
const MALE = /\b(male|homme|hombre|man)\b|\b(paul|claude|henri|antoine|nicolas|thomas|daniel|oliver|arthur|george|ryan|james|alex|fred|pablo|alvaro|álvaro|jorge|juan|diego|enrique|david|mark|guy|conrad|stefan|killian|markus|yannick|cosimo|luca)\b/i;

/** Le navigateur n'expose pas le genre des voix : on le devine d'après le nom. 'f' | 'm' | 'n' (neutre/inconnu). */
export function guessGender(voice) {
  const name = voice?.name ?? '';
  if (FEMALE.test(name)) return 'f';
  if (MALE.test(name)) return 'm';
  return 'n';
}

/** Réglages de débit/hauteur : distinguent les personas même quand le système n'a qu'une seule voix. */
export const PERSONA_SPEECH = {
  lumen: { rate: 0.95, pitch: 1.05 },
  vera: { rate: 1, pitch: 0.92 },
  eko: { rate: 1.12, pitch: 1 },
};

/**
 * Voix d'un persona parmi celles de la langue du cursus : Lumen = 1re voix masculine, Vera = 2e voix féminine
 * (à défaut une voix neutre), Eko = 1re voix féminine. Introuvable -> null = voix par défaut, sans erreur.
 */
export function pickPersonaVoice(voices, lang, persona = 'lumen') {
  const pool = voicesFor(voices, lang);
  const of = (g) => pool.filter((v) => guessGender(v) === g);
  if (persona === 'vera') return of('f')[1] ?? of('n')[0] ?? null;
  if (persona === 'eko') return of('f')[0] ?? null;
  return of('m')[0] ?? null; // lumen
}

/** Fait parler une phrase avec la voix d'un persona (bouton « Essayer »). Renvoie false si la synthèse est indisponible. */
export function speakSample({ text, lang, persona, synth, UtteranceCtor }) {
  try {
    synth.cancel();
    const u = new UtteranceCtor(text);
    u.lang = lang;
    const voice = pickPersonaVoice(synth.getVoices?.() ?? [], lang, persona);
    if (voice) u.voice = voice;
    Object.assign(u, PERSONA_SPEECH[persona] ?? {});
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le micro capte parfois la voix du coach (haut-parleurs) : un résultat dont les mots sont (presque) tous dans
 * ce que le coach est en train de dire est traité comme de l'écho, pas comme une interruption.
 */
export function isEcho(heard, spoken) {
  const h = tokens(heard);
  if (!h.length) return true;
  const s = new Set(tokens(spoken));
  return h.filter((t) => s.has(t)).length / h.length >= 0.6;
}

export class VoiceMode {
  /**
   * @param {object} o
   * @param {string} o.language           code BCP-47 du cursus (fr-FR, en-US…)
   * @param {(text:string)=>void} o.onUtterance   phrase terminée par l'utilisateur -> envoyée au chat
   * @param {(text:string)=>void} o.onInterim     texte en cours de reconnaissance
   * @param {()=>void} o.onBargeIn                le coach a été interrompu (bouton ⏹ / Échap) : couper aussi le flux en cours
   * @param {number} o.graceMs                    délai après la fin de la lecture avant de rallumer le micro (réverbération)
   * @param {(state:string)=>void} o.onState      idle | listening | hearing | thinking | speaking
   * @param {(code:string, params?:object)=>void} o.onError   code d'erreur (voir voice.err.* dans i18n.js)
   */
  constructor({ language, onUtterance, onInterim = () => {}, onBargeIn = () => {}, onState = () => {}, onError = () => {}, SpeechRecognitionCtor, synth, UtteranceCtor, sendDelayMs = 1200, graceMs = 400, persona = 'lumen', timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t) } }) {
    Object.assign(this, { language, onUtterance, onInterim, onBargeIn, onState, onError, synth, UtteranceCtor, sendDelayMs, graceMs, timers, persona });
    this.Ctor = SpeechRecognitionCtor;
    this.state = 'idle';
    this.on = false;
    this.muted = false;
    this.buffer = '';
    this.sendTimer = null;
    this.spokenText = '';
    this.token = 0; // invalide les callbacks de synthèse d'une lecture annulée
    this.pending = 0;
    this.speechOpen = false;
    this.restarts = [];
    this.micSuspended = false; // micro éteint pendant que le coach parle (protection principale contre l'écho)
    this.resumeTimer = null;
    this.watchTimer = null;
  }

  static supported(win = globalThis) {
    return !!((win.SpeechRecognition || win.webkitSpeechRecognition) && win.speechSynthesis && win.SpeechSynthesisUtterance);
  }

  get active() { return this.on; }
  get speaking() { return this.pending > 0 || this.speechOpen; }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.onState(s);
  }

  // ---------- écoute ----------
  start() {
    if (this.on) return;
    this.on = true;
    this.muted = false;
    this.launch();
    this.setState('listening');
  }

  launch() {
    const rec = (this.rec = new this.Ctor());
    rec.lang = this.language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => this.handleResult(e);
    rec.onerror = (e) => this.handleError(e);
    rec.onend = () => this.handleEnd();
    try {
      rec.start();
    } catch { // abort() tout juste avant : le navigateur peut refuser un redémarrage immédiat
      this.timers.set(() => { if (this.on && !this.muted && !this.micSuspended && this.rec === rec) { try { rec.start(); } catch { /* abandon : onend relancera */ } } }, 300);
    }
  }

  handleResult(e) {
    let finals = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      (r.isFinal ? (finals += r[0].transcript) : (interim += r[0].transcript));
    }
    const heard = `${finals} ${interim}`.trim();
    if (!heard || this.micSuspended) return; // micro suspendu : tout résultat tardif est de l'écho
    if (this.speaking) {
      // complément (le micro est normalement éteint pendant la lecture) : filtre par similarité de texte
      if (isEcho(heard, this.spokenText)) return;
      this.cancelSpeech();
      this.onBargeIn();
    }
    this.setState('hearing');
    if (interim) {
      this.timers.clear(this.sendTimer); // il parle encore : on attend la fin de phrase
      this.onInterim(`${this.buffer} ${heard}`.trim());
    }
    if (finals.trim()) {
      this.buffer = `${this.buffer} ${finals.trim()}`.trim();
      this.onInterim(this.buffer);
      this.timers.clear(this.sendTimer);
      this.sendTimer = this.timers.set(() => this.flush(), this.sendDelayMs);
    }
  }

  flush() {
    const text = this.buffer.trim();
    this.buffer = '';
    if (!text) return this.setState(this.speaking ? 'speaking' : 'listening');
    this.setState('thinking');
    this.onUtterance(text);
  }

  handleError(e) {
    // codes d'erreur (traduits par l'interface) ; 'no-speech' / 'aborted' sont sans gravité : handleEnd relance l'écoute
    if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network'].includes(e.error)) {
      this.onError(e.error, { lang: this.language });
      this.stop();
    }
  }

  handleEnd() {
    if (!this.on || this.muted || this.micSuspended) return;
    const now = Date.now();
    this.restarts = this.restarts.filter((t) => now - t < 5000).concat(now);
    if (this.restarts.length > 8) {
      this.onError('unstable');
      return this.stop();
    }
    this.timers.set(() => { if (this.on && !this.muted && !this.micSuspended) this.launch(); }, 200); // l'écoute continue s'arrête d'elle-même après un silence
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) {
      try { this.rec?.abort(); } catch { /* déjà arrêté */ }
      this.timers.clear(this.sendTimer);
    } else if (this.on && !this.micSuspended) {
      this.launch();
    }
  }

  stop() {
    this.on = false;
    this.micSuspended = false;
    this.timers.clear(this.sendTimer);
    this.timers.clear(this.resumeTimer);
    this.buffer = '';
    this.cancelSpeech();
    if (this.rec) {
      this.rec.onend = this.rec.onresult = this.rec.onerror = null;
      try { this.rec.abort(); } catch { /* déjà arrêté */ }
    }
    this.rec = null;
    this.setState('idle');
  }

  markThinking() {
    if (this.on) this.setState('thinking');
  }

  // ---------- lecture à voix haute ----------
  /** Ouvre une lecture en flux : push(delta) au fil du streaming, end() à la fin. Phrase par phrase, dès qu'une phrase est complète. */
  newSpeech() {
    this.cancelSpeech({ resume: false });
    this.timers.clear(this.resumeTimer);
    const token = ++this.token;
    this.speechOpen = true;
    this.spokenText = '';
    let buf = '';
    const speakAll = (sentences) => sentences.forEach((s) => this.enqueue(s, token));
    return {
      push: (delta) => {
        if (token !== this.token) return;
        const [ready, rest] = splitSentences(buf + delta);
        buf = rest;
        speakAll(ready);
      },
      end: () => {
        if (token !== this.token) return;
        const [ready] = splitSentences(buf, true);
        buf = '';
        speakAll(ready);
        this.speechOpen = false;
        if (!this.pending) this.afterSpeech(token);
      },
    };
  }

  enqueue(sentence, token) {
    const text = cleanForSpeech(sentence);
    if (!text) return;
    const u = new this.UtteranceCtor(text);
    u.lang = this.language;
    const voice = pickPersonaVoice(this.synth.getVoices?.() ?? [], this.language, this.persona);
    if (voice) u.voice = voice;
    Object.assign(u, PERSONA_SPEECH[this.persona] ?? {});
    this.spokenText += ` ${text}`;
    this.pending++;
    this.spokeAt = Date.now();
    const done = () => {
      if (token !== this.token) return;
      this.pending = Math.max(0, this.pending - 1);
      if (!this.pending && !this.speechOpen) this.afterSpeech(token);
    };
    u.onend = done;
    u.onerror = done;
    try {
      this.synth.resume?.(); // contourne le blocage « paused » de Chrome
      this.synth.speak(u);
    } catch (e) { // la synthèse indisponible ne doit pas casser l'affichage du texte
      this.pending = Math.max(0, this.pending - 1);
      this.onError('speak', { detail: e.message });
      return;
    }
    if (this.on) {
      this.suspendMic(); // le coach parle : le micro s'éteint, il ne peut pas l'entendre
      this.setState('speaking');
    }
    this.watch(token);
  }

  // ---------- suspension du micro pendant la lecture ----------
  /** Éteint la reconnaissance (handlers détachés : plus aucun résultat, même tardif, ne passe). */
  suspendMic() {
    this.timers.clear(this.resumeTimer);
    if (this.micSuspended) return;
    this.micSuspended = true;
    this.timers.clear(this.sendTimer); // un envoi en attente est reporté à la reprise (le texte reste dans le tampon)
    if (this.rec) {
      this.rec.onend = this.rec.onresult = this.rec.onerror = null;
      try { this.rec.abort(); } catch { /* déjà arrêté */ }
      this.rec = null;
    }
  }

  /** Rallume le micro `graceMs` après la fin de la lecture : absorbe la réverbération résiduelle de la pièce. */
  scheduleResume() {
    if (!this.micSuspended) return;
    this.timers.clear(this.resumeTimer);
    this.resumeTimer = this.timers.set(() => this.resumeMic(), this.graceMs);
  }

  resumeMic() {
    if (!this.micSuspended) return;
    this.micSuspended = false;
    if (!this.on) return;
    if (!this.muted) this.launch();
    if (this.buffer) this.sendTimer = this.timers.set(() => this.flush(), this.sendDelayMs);
    this.setState('listening');
  }

  /**
   * Filet de sécurité : Chrome n'émet pas toujours `onend` (lecture coupée, onglet en arrière-plan…). Si la synthèse est
   * silencieuse deux contrôles de suite (1 s) alors qu'on croit lire encore, la lecture est considérée comme terminée.
   */
  watch(token) {
    if (this.synth.speaking === undefined) return; // pas d'état observable : on s'en remet à onend
    this.timers.clear(this.watchTimer);
    let quiet = 0;
    const tick = () => {
      if (token !== this.token || !this.pending) return;
      quiet = this.synth.speaking || this.synth.pending ? 0 : quiet + 1;
      if (quiet >= 2) {
        this.pending = 0;
        if (!this.speechOpen) this.afterSpeech(token);
      } else {
        this.watchTimer = this.timers.set(tick, 500);
      }
    };
    this.watchTimer = this.timers.set(tick, 500);
  }

  afterSpeech(token) {
    if (token !== this.token) return;
    this.spokenText = '';
    this.timers.clear(this.watchTimer);
    if (!this.on) return;
    if (this.micSuspended) this.scheduleResume(); // l'état passe à « à l'écoute » à la reprise du micro
    else this.setState(this.state === 'hearing' ? 'hearing' : 'listening');
  }

  /** L'utilisateur interrompt le coach (bouton ⏹ / Échap) : la lecture s'arrête, le flux en cours aussi, le micro revient après le délai. */
  interrupt() {
    this.cancelSpeech();
    this.onBargeIn();
  }

  cancelSpeech({ resume = true } = {}) {
    this.token++;
    this.pending = 0;
    this.speechOpen = false;
    this.spokenText = '';
    this.timers.clear(this.watchTimer);
    try { this.synth?.cancel(); } catch { /* rien à annuler */ }
    if (resume && this.on && this.micSuspended) this.scheduleResume();
  }
}
