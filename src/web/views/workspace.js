import { getLang, setLang, storedLang, t } from '../i18n.js';
import { renderMessage } from '../markdown.js';
import { VoiceMode } from '../speech.js';
import { api, progressDialog, el, richText, ring } from '../ui.js';
import { personaName } from './widgets.js';

const modProgress = (m) => m.progress ?? (m.status === 'done' ? 100 : 0);

export async function render(root, { id, name }, go) {
  let view = await api(`/api/plan?curriculumId=${id}`);
  if (view.phase !== 'learning') return go('create', { id, name });
  setLang(view.language); // l'interface suit la langue du cursus tant qu'on y travaille
  const { name: userName, persona } = (await api('/api/state')).profile;
  const coachName = personaName(persona);

  let sel = { type: 'module', id: view.cursor?.moduleId ?? view.plan.modules[0].id };
  const collapsed = new Set();
  let busy = false;
  let panelKind = null;
  let objOpen = false; // objectifs du module : repliés par défaut (bandeau discret)

  // ---------- squelette ----------
  const tree = el('aside', { class: 'tree' });
  const sect = el('header', { class: 'sect' });
  const panel = el('section', { class: 'panel', hidden: true });
  const log = el('div', { class: 'log', ariaLive: 'polite' });
  const input = el('textarea', { rows: 2, placeholder: t('ws.msgPh') });
  const send = el('button', { class: 'primary', textContent: t('ws.send') });
  const err = el('div', { class: 'error' });
  const usageBar = el('div', { class: 'usage' });
  const rail = el('aside', { class: 'rail' });
  // Mode vocal : reconnaissance + synthèse vocales du navigateur (gratuit, aucun token). Le texte reste toujours actif.
  const voiceBtn = el('button', { class: 'voice', type: 'button', role: 'switch', ariaChecked: 'false', title: t('ws.voiceTip') }, el('span', { class: 'switch' }, el('i')), t('ws.voice'));
  const vStatus = el('span', { class: 'grow' });
  const vMute = el('button', { class: 'ghost small', type: 'button', textContent: t('ws.mute') });
  const vStop = el('button', { class: 'ghost small stop', type: 'button', textContent: t('ws.interrupt'), hidden: true });
  const voiceBar = el('div', { class: 'voicebar', hidden: true }, el('span', { class: 'vdot' }), vStatus, vStop, vMute);
  let voice = null;
  let streamAbort = null;

  // Mobile (< 900 px) : colonne unique ; le programme s'ouvre en panneau par-dessus, la progression devient une barre fine sous la topbar.
  const menuBtn = el('button', { class: 'menu-btn', type: 'button', textContent: '☰', title: t('ws.menu'), ariaLabel: t('ws.menu'), ariaExpanded: 'false' });
  const mTitle = el('div', { class: 'mbar-title' });
  const mPct = el('div', { class: 'mbar-pct' });
  const mFill = el('i');
  const mbar = el('div', { class: 'mbar' }, el('div', { class: 'mbar-row' }, menuBtn, mTitle, mPct), el('div', { class: 'hbar', role: 'progressbar', ariaLabel: t('ws.progress') }, mFill));
  const backdrop = el('div', { class: 'ws-backdrop' });
  const wsEl = el('div', { class: 'ws' });
  const setMenu = (open) => { wsEl.classList.toggle('menu-open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
  const closeMenu = () => setMenu(false);
  menuBtn.onclick = () => setMenu(!wsEl.classList.contains('menu-open'));
  backdrop.onclick = closeMenu;

  const center = el('main', { class: 'center' }, mbar, sect, panel, log, err, voiceBar, el('div', { class: 'compose' }, input, el('div', { class: 'col' }, send, voiceBtn)), usageBar);
  wsEl.append(tree, center, rail, backdrop);
  root.append(wsEl);

  // ---------- données dérivées ----------
  const byId = (mid) => view.plan.modules.find((m) => m.id === mid);
  const domainOf = (did) => view.domains.find((d) => d.id === did);
  const domProgress = (did) => view.progress.byDomain.find((d) => d.id === did)?.percent ?? 0;
  const blocIndex = (did) => view.domains.findIndex((d) => d.id === did) + 1;
  const openGaps = () => view.gaps.filter((g) => !g.resolvedAt);

  // ---------- arbre ----------
  function renderTree() {
    const item = (m) => {
      const isQuiz = m.kind === 'quiz';
      const active = sel.type === 'module' && sel.id === m.id;
      const best = view.quizzes[m.id]?.best;
      return el('button', { class: `node ${isQuiz ? 'quiz' : ''} ${active ? 'active' : ''} ${view.cursor?.moduleId === m.id ? 'here' : ''}`, onclick: () => select({ type: 'module', id: m.id }) },
        ring(modProgress(m), 16), el('span', { class: 'grow' }, isQuiz ? t('ws.quizNode') : m.title),
        isQuiz && best !== null && best !== undefined ? el('span', { class: 'muted small' }, `${Math.round(best * 100)} %`) : el('span', { class: 'muted small' }, isQuiz ? '' : `${m.hours} h`));
    };
    const blocs = view.domains.map((d) => {
      const closed = collapsed.has(d.id);
      const head = el('button', { class: `bloc ${sel.type === 'bloc' && sel.id === d.id ? 'active' : ''}`, onclick: () => { collapsed.has(d.id) ? collapsed.delete(d.id) : collapsed.add(d.id); select({ type: 'bloc', id: d.id }); } },
        ring(domProgress(d.id), 20), el('span', { class: 'grow' }, t('ws.blockDash', { n: blocIndex(d.id), name: d.name })), el('span', { class: 'chev' }, closed ? '▸' : '▾'));
      return el('div', { class: 'bloc-wrap' }, head, closed ? null : el('div', { class: 'children' }, view.plan.modules.filter((m) => m.domainId === d.id).map(item)));
    });
    const diag = view.diagnostic.available
      ? el('button', { class: `node special ${panelKind === 'diag' ? 'active' : ''}`, onclick: openDiagnostic }, '🎯', el('span', { class: 'grow' }, t('ws.diag')), el('span', { class: 'badge' }, t('ws.recommended')))
      : null;
    const back = el('button', { class: 'ghost small', textContent: t('common.back'), onclick: async () => { stopVoice(); setLang(storedLang()); go('home', { state: await api('/api/state') }); } });
    tree.replaceChildren(
      el('div', { class: 'tree-head' }, el('div', { class: 'row spread' }, back, el('button', { class: 'ghost tree-close', type: 'button', textContent: '✕', title: t('common.close'), onclick: closeMenu })), el('h2', { title: view.certification }, view.name), el('div', { class: 'muted small' }, view.certification)),
      ...[diag, ...blocs].filter(Boolean),
      el('div', { class: 'tree-foot' }, el('button', { class: `node special ${panelKind === 'gaps' ? 'active' : ''}`, onclick: openGaps_ }, '⚠️', el('span', { class: 'grow' }, t('ws.gaps')), el('span', { class: 'badge' }, String(openGaps().length)))));
  }

  // ---------- en-tête de section ----------
  function renderSect() {
    let crumb, title, objectives, actions = [];
    if (sel.type === 'bloc') {
      const d = domainOf(sel.id);
      crumb = t('ws.blockWeight', { n: blocIndex(d.id), w: d.weightMin === d.weightMax ? d.weightMin : `${d.weightMin}–${d.weightMax}` });
      title = d.name;
      objectives = d.subdomains.length ? d.subdomains : [t('ws.blockModules', { n: view.plan.modules.filter((m) => m.domainId === d.id && m.kind !== 'quiz').length })];
    } else {
      const m = byId(sel.id);
      const d = domainOf(m.domainId);
      crumb = t('ws.blockDash', { n: blocIndex(d.id), name: d.name });
      title = m.title;
      objectives = m.kind === 'quiz'
        ? [t('ws.quizGoal', { name: d.name }), t('ws.quizCovers', { list: m.objectives.slice(0, 6).join(' ; ') })]
        : m.objectives;
      if (m.kind === 'quiz') {
        const best = view.quizzes[m.id]?.best;
        actions.push(el('button', { class: 'primary', textContent: m.status === 'done' ? t('ws.quizRetry') : t('ws.quizStart'), onclick: (e) => startQuiz(m, e.target) }));
        if (best !== null && best !== undefined) actions.push(el('span', { class: 'muted small' }, t('ws.bestScore', { pct: Math.round(best * 100) })));
      } else {
        actions.push(el('button', { class: 'primary', textContent: m.status === 'todo' ? t('ws.startCoach') : m.status === 'done' ? t('ws.reviseCoach') : t('ws.resumeCoach'), onclick: () => talkAbout(m) }));
        actions.push(el('span', { class: 'muted small' }, t('ws.hoursProgress', { h: m.hours, p: modProgress(m) })));
      }
    }
    // bandeau réduit à une ligne discrète : « MODULE 1 — … › titre » ; les objectifs se déplient à la demande
    const objBox = el('div', { class: 'obj', hidden: !objOpen }, el('div', { class: 'obj-label' }, t('ws.objective')), el('ul', {}, objectives.map((o) => el('li', {}, o))));
    const toggle = el('button', { class: 'ghost obj-toggle', type: 'button', ariaExpanded: String(objOpen), title: t('ws.objective'), textContent: '🎯', onclick: () => { objOpen = !objOpen; objBox.hidden = !objOpen; toggle.setAttribute('aria-expanded', String(objOpen)); } });
    sect.replaceChildren(
      el('div', { class: 'sect-line' }, el('span', { class: 'crumb', title: `${crumb} › ${title}` }, `${crumb} › ${title}`), toggle, ...actions),
      objBox);
  }

  // ---------- barre droite ----------
  function renderRail() {
    const g = view.progress.global;
    const lessons = view.plan.modules;
    const done = lessons.filter((m) => m.status === 'done').length;
    rail.replaceChildren(el('div', { class: 'rail-pct' }, `${g}`, el('small', {}, ' %')), el('div', { class: 'vbar', title: t('ws.globalTip', { g }) }, el('i', { style: `height:${g}%` })),
      el('div', { class: 'rail-label' }, t('ws.progress'), el('br'), t('ws.steps', { done, total: lessons.length })));
  }

  function renderUsage({ usage }) {
    if (!usage.calls) { usageBar.textContent = ''; return; }
    const money = (n) => (n < 0.01 ? '< $0.01' : `$${n.toFixed(2)}`).replace('.', getLang() === 'en-GB' ? '.' : ',');
    const cost = usage.costUsd === null ? '' : ` · ≈ ${money(usage.costUsd)}`;
    usageBar.textContent = t('ws.usage', { calls: usage.calls, searches: usage.searches ? t('ws.usageSearches', { n: usage.searches }) : '', k: Math.round(usage.tokens / 1000), cost });
    const g = usage.byGroup;
    const line = (k, label) => (g[k] ? t('ws.usageLine', { label, calls: g[k].calls, searches: g[k].searches ? t('ws.usageLineSearch', { n: g[k].searches }) : '' }) : null);
    usageBar.title = [t('ws.usageTip'), line('startup', t('ws.usageStartup')), line('diagnostic', t('ws.usageDiag')), line('plan', t('ws.usagePlan')), line('quiz', t('ws.usageQuiz')), line('chat', t('ws.usageChat'))].filter(Boolean).join('\n');
  }

  const renderMobileBar = () => { const g = view.progress.global; mTitle.textContent = view.name; mPct.textContent = `${g} %`; mFill.style.width = `${g}%`; mbar.querySelector('.hbar').title = t('ws.globalTip', { g }); };
  const paint = () => { renderTree(); renderSect(); renderRail(); renderMobileBar(); renderUsage(view); syncLog(); };
  const refresh = async () => { view = await api(`/api/plan?curriculumId=${id}`); paint(); };

  // ---------- navigation ----------
  async function select(next) {
    closeMenu();
    if (QUIZ_PANELS.has(panelKind)) closePanel(); // on quitte le QCM pour retrouver le cours
    sel = next;
    paint(); // affichage immédiat, la position est sauvegardée ensuite
    if (next.type === 'module' && view.cursor?.moduleId !== next.id) {
      view = await api('/api/cursor', { curriculumId: id, moduleId: next.id }).catch(() => view);
      paint();
    }
  }

  // ---------- panneaux (quiz, lacunes, diagnostic) ----------
  const QUIZ_PANELS = new Set(['quiz', 'diag']);
  const openPanel = (kind, ...content) => {
    panelKind = kind;
    center.classList.toggle('quiz-mode', QUIZ_PANELS.has(kind)); // QCM / diagnostic : le cours (chat) est masqué, seules les questions restent
    panel.hidden = false;
    panel.replaceChildren(el('button', { class: 'ghost close', textContent: '✕', title: t('common.close'), onclick: closePanel }), ...content.flat(Infinity).filter(Boolean));
    panel.scrollTop = 0;
    renderTree();
    renderEmptyState(); // masque le call-to-action pendant un QCM
  };
  const closePanel = () => { panelKind = null; center.classList.remove('quiz-mode'); panel.hidden = true; panel.replaceChildren(); renderTree(); renderEmptyState(); };
  const guard = async (button, label, fn) => {
    const old = button.textContent;
    button.disabled = true;
    button.textContent = label;
    err.textContent = '';
    try { await fn(); } catch (e) { err.textContent = e.message; } finally { button.disabled = false; button.textContent = old; }
  };

  function openGaps_() {
    closeMenu();
    const gaps = openGaps();
    openPanel('gaps', el('h3', {}, t('ws.gapsOpen', { n: gaps.length })),
      gaps.length ? gaps.map((g) => el('div', { class: 'row spread gap-row' },
        el('span', {}, el('span', { class: 'muted' }, `${domainOf(g.domainId)?.name ?? g.domainId} · `), g.note),
        el('button', { textContent: t('ws.gapsResolve'), onclick: async () => { await api('/api/gaps/resolve', { curriculumId: id, gapId: g.id }); await refresh(); openGaps_(); } })))
        : el('p', { class: 'muted' }, t('ws.gapsNone')));
  }

  async function openDiagnostic(e) {
    closeMenu();
    await guard(e.currentTarget, t('ws.diagPrep'), async () => {
      const { domains, questions } = await api('/api/assessment/start', { curriculumId: id });
      const exp = el('select', {}, [['debutant', t('ws.lvBeg')], ['intermediaire', t('ws.lvMid')], ['avance', t('ws.lvAdv')]].map(([v, label]) => el('option', { value: v, selected: v === 'intermediaire' }, label)));
      const hours = el('input', { type: 'number', min: 1, max: 40, value: 5 });
      const date = el('input', { type: 'date' });
      const rows = domains.map((d) => {
        const q = questions.find((x) => x.domainId === d.id);
        const radios = (q?.options ?? []).map((o, i) => el('label', { class: 'opt' }, el('input', { type: 'radio', name: `q-${d.id}`, value: i }), ` ${o}`));
        const self = el('select', {}, [1, 2, 3, 4, 5].map((n) => el('option', { value: n, selected: n === 3 }, `${n}/5`)));
        return { d, radios, self, node: el('div', { class: 'card' }, el('strong', {}, d.name), q ? el('p', {}, q.question) : null, radios, el('label', {}, t('ws.diagSelf')), self) };
      });
      const go_ = el('button', { class: 'primary', textContent: t('ws.diagGo'), onclick: (ev) => guard(ev.target, t('ws.diagBusy'), async () => {
        const answers = rows.map((r) => ({ domainId: r.d.id, choice: Number(r.radios.map((l) => l.firstChild).find((i) => i.checked)?.value ?? -1), self: Number(r.self.value) }));
        view = await api('/api/assessment/submit', { curriculumId: id, answers, profile: { experience: exp.value, hoursPerWeek: Number(hours.value), examDate: date.value || undefined } });
        closePanel();
        await loadLog();
        sel = { type: 'module', id: view.cursor.moduleId };
        paint();
      }) });
      openPanel('diag', el('h3', {}, t('ws.diagTitle')), el('p', { class: 'muted' }, t('ws.diagIntro')),
        el('div', { class: 'card' }, el('label', {}, t('ws.diagLevel')), exp, el('label', {}, t('ws.diagHours')), hours, el('label', {}, t('ws.diagDate')), date),
        rows.map((r) => r.node), go_);
    });
  }

  async function startQuiz(m, button) {
    // pop-up en deux phases : génération (spinner, non fermable) puis « Vos QCM sont prêts ! » → Commencer
    const modal = progressDialog({ title: t('ws.quizGenTitle'), text: t('ws.quizGenText') });
    await guard(button, t('ws.quizPrep'), async () => {
      let quiz;
      try { quiz = await api('/api/quiz/start', { curriculumId: id, moduleId: m.id }); } catch (e) { modal.close(); throw e; }
      await modal.ready(t('ws.quizReadyTitle'), t('ws.quizBegin'));
      const inputs = quiz.questions.map((q, i) => q.options.map((o, k) => el('label', { class: 'opt' }, el('input', { type: q.type === 'multiple' ? 'checkbox' : 'radio', name: `qz-${i}`, value: k }), ` ${o}`)));
      const submit = el('button', { class: 'primary', textContent: t('ws.quizSubmit'), onclick: (ev) => guard(ev.target, t('ws.quizGrading'), async () => {
        const answers = inputs.map((ls) => ls.map((l) => l.firstChild).filter((x) => x.checked).map((x) => Number(x.value)));
        const { result, view: v } = await api('/api/quiz/submit', { curriculumId: id, moduleId: m.id, answers });
        view = v;
        const cards = quiz.questions.map((q, i) => {
          const r = result.results[i];
          return el('div', { class: `card ${r.correct ? 'ok' : 'ko'}` }, el('strong', {}, `${r.correct ? '✅' : '❌'} ${q.question}`),
            el('p', { class: 'muted' }, t('ws.quizGood', { list: r.correctIndices.map((k) => q.options[k]).join(' ; ') })), el('p', {}, r.explanation));
        });
        openPanel('quiz', el('div', { class: 'card' }, el('strong', {}, t('ws.quizResult', { ok: result.correctCount, total: result.total, pct: Math.round(result.score * 100), verdict: result.passed ? t('ws.quizPassed') : t('ws.quizFailed') }))), cards);
        paint();
        await loadLog();
      }) });
      openPanel('quiz', el('h3', {}, quiz.title), el('p', { class: 'muted' }, t('ws.quizIntro')),
        quiz.questions.map((q, i) => el('div', { class: 'card' }, el('strong', {}, `${i + 1}. ${q.question}`), q.type === 'multiple' ? el('div', { class: 'muted' }, t('ws.quizPick', { n: q.pick })) : null, inputs[i])), submit);
    });
  }

  // ---------- conversation ----------
  const labels = () => ({ concept: t('chat.concept'), analogy: t('chat.analogy'), phaseCourse: t('chat.phase.course'), phaseCheck: t('chat.phase.check') });
  const PHASE_KEYS = { course: 'chat.phase.course', check: 'chat.phase.check', decision: 'chat.phase.decision' };
  /** Tête d'un message du coach : avatar rond de 24 px (CSS pur, initiale du persona) + « Coach · Nom ». */
  const coachHead = () => el('div', { class: 'coach-head' }, el('span', { class: `pavatar p-${persona}`, ariaHidden: 'true' }, coachName[0]), el('span', { class: 'coach-label' }, t('chat.coach', { name: coachName })));
  /** Badge de phase en haut du message (📖 cours / ❓ vérification / 🧭 décision). */
  const setPhase = (b, phase) => {
    b.querySelector('.phase-badge')?.remove();
    if (PHASE_KEYS[phase]) b.querySelector('.coach-head')?.append(el('span', { class: `phase-badge ${phase}` }, t(PHASE_KEYS[phase])));
  };
  /** (Re)dessine le contenu : rendu enrichi pour le cours du coach, texte brut pour l'utilisateur et les messages automatiques. */
  const setText = (b, text, streaming = false) => {
    const body = b.querySelector('.msg-body');
    if (!body) return richText(b, text);
    if (body.classList.contains('plain')) richText(body, text);
    else renderMessage(body, text, labels(), streaming);
  };
  const bubble = (role, text = '', kind, phase) => {
    let b;
    if (role === 'user') {
      b = el('div', { class: 'msg user' });
      richText(b, text); // les bulles de l'utilisateur n'ont pas d'avatar
    } else if (kind === 'debrief') {
      b = el('details', { class: 'msg assistant debrief' }, el('summary', {}, coachHead(), t('ws.debrief')), el('div', { class: 'msg-body plain debrief-body' }));
      setText(b, text);
    } else {
      b = el('div', { class: 'msg assistant' }, coachHead(), el('div', { class: `msg-body${kind ? ' plain' : ''}` }));
      setText(b, text);
      setPhase(b, phase);
    }
    log.append(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };
  /** Chaque module (et chaque QCM récap) a son propre historique : le chat affiche celui du nœud sélectionné. */
  const chatScope = () => (sel.type === 'module' ? sel.id : view.cursor?.moduleId) ?? view.plan.modules[0].id;
  let loadedScope = null;
  async function loadLog() {
    const scope = chatScope();
    loadedScope = scope;
    const { messages } = await api(`/api/session?curriculumId=${id}&moduleId=${encodeURIComponent(scope)}`);
    if (scope !== chatScope() || busy) { loadedScope = null; return; } // changement de module (ou tour en cours) pendant le chargement : on ne touche pas au fil affiché
    log.replaceChildren();
    messages.forEach((m) => { const b = bubble(m.role, m.content, m.kind, m.phase); if (m.channel === 'voice') b.classList.add('from-voice'); });
    lastMessages = messages;
    const mod = byId(scope);
    if (!messages.length && mod?.kind !== 'quiz' && mod?.status !== 'todo') bubble('assistant', t('ws.welcome', { name: userName }));
    renderEmptyState();
  }
  let lastMessages = [];
  /**
   * États vides : call-to-action centré dans la zone de chat quand il n'y a encore rien à lire —
   * QCM récap jamais corrigé (→ générer) ou module de cours pas encore entamé (→ démarrer avec le coach).
   * Le débrief et le plan (messages de création) ne comptent pas comme une conversation.
   */
  function renderEmptyState() {
    log.querySelector('.empty-cta')?.remove();
    const m = byId(chatScope());
    if (!m || busy || QUIZ_PANELS.has(panelKind) || sel.type !== 'module') return;
    const talked = lastMessages.some((x) => !['debrief', 'plan'].includes(x.kind));
    if (talked) return;
    let cta;
    if (m.kind === 'quiz') {
      cta = ['📝', t('ws.ctaQuizTitle'), t('ws.ctaQuizSub'), t('ws.ctaQuizBtn'), (e) => startQuiz(m, e.currentTarget)];
    } else if (m.status === 'todo') {
      cta = ['📚', t('ws.ctaStartTitle'), m.title, t('ws.ctaStartBtn'), () => talkAbout(m)];
    } else return;
    const [icon, title, sub, label, action] = cta;
    log.append(el('div', { class: 'empty-cta' }, el('div', { class: 'empty-icon', ariaHidden: 'true' }, icon), el('h2', {}, title), el('p', { class: 'muted' }, sub), el('button', { class: 'primary big', type: 'button', textContent: label, onclick: action })));
  }
  const syncLog = () => (!busy && loadedScope !== chatScope() ? loadLog().catch(() => {}) : Promise.resolve());

  /** Envoie un message au chat. En mode vocal, la réponse est lue à voix haute au fil du streaming. */
  async function submit(text, { channel = 'text' } = {}) {
    const message = (typeof text === 'string' ? text : input.value).trim();
    if (!message || busy) return;
    const spoken = !!voice?.active;
    const cursorBefore = view.cursor?.moduleId;
    busy = true;
    send.disabled = true;
    err.textContent = '';
    if (typeof text !== 'string') input.value = '';
    log.querySelector('.empty-cta')?.remove();
    lastMessages = [...lastMessages, { role: 'user', content: message }]; // la conversation a commencé : plus d'état vide
    const userBubble = bubble('user', message);
    if (channel === 'voice') userBubble.classList.add('from-voice');
    const out = bubble('assistant');
    if (spoken) out.classList.add('from-voice');
    const speech = spoken ? voice.newSpeech() : null; // annule toute lecture en cours
    voice?.markThinking();
    streamAbort = new AbortController();
    let acc = '';
    try {
      const res = await fetch('/api/chat', { method: 'POST', signal: streamAbort.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ curriculumId: id, message, voice: spoken, channel }) });
      if (!res.ok) throw new Error((await res.json()).error);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const evt = JSON.parse(buf.slice(0, i).replace(/^data: /, ''));
          buf = buf.slice(i + 2);
          if (evt.error) throw new Error(evt.error);
          if (evt.delta) { acc += evt.delta; setText(out, acc, true); speech?.push(evt.delta); log.scrollTop = log.scrollHeight; }
          if (evt.done && evt.phase) setPhase(out, evt.phase);
          if (evt.done && evt.progress) { view.progress.global = evt.progress.global; renderRail(); renderMobileBar(); } // valeur calculée par le serveur à ce tour, sans attendre le rechargement du plan
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') err.textContent = e.message; // AbortError = interruption volontaire (barge-in)
    }
    if (acc) setText(out, acc); // rendu final : une balise restée ouverte est interprétée comme en relecture
    speech?.end();
    streamAbort = null;
    busy = false;
    send.disabled = false;
    if (!spoken) input.focus();
    await refresh().catch(() => {});
    // le coach a fait avancer le curseur (module suivant) : le bandeau et l'arbre suivent en temps réel
    if (view.cursor?.moduleId && view.cursor.moduleId !== cursorBefore) { sel = { type: 'module', id: view.cursor.moduleId }; paint(); }
  }

  const talkAbout = async (m) => {
    if (busy) return;
    if (QUIZ_PANELS.has(panelKind)) closePanel();
    view = await api('/api/cursor', { curriculumId: id, moduleId: m.id, start: true });
    paint();
    await syncLog(); // l'historique de ce module est affiché avant d'y ajouter le message de reprise
    submit(t(m.status === 'todo' ? 'ws.startMsg' : 'ws.resumeMsg', { title: m.title }));
  };

  // ---------- voix (Web Speech API) ----------
  const statusText = (st) => ({ listening: t('voice.listening'), hearing: t('voice.hearing'), thinking: t('voice.thinking', { name: coachName }), speaking: t('voice.speaking', { name: coachName }) })[st];
  const stopVoice = () => { voice?.stop(); };

  /** Une phrase de l'utilisateur est terminée : si le coach répond encore, on coupe sa réponse puis on envoie. */
  async function onUtterance(text) {
    if (busy) {
      streamAbort?.abort();
      for (let i = 0; i < 40 && busy; i++) await new Promise((r) => setTimeout(r, 50));
    }
    submit(text, { channel: 'voice' });
  }

  voiceBtn.onclick = () => {
    err.textContent = '';
    if (voice?.active) return stopVoice();
    if (!VoiceMode.supported()) { err.textContent = t('voice.unsupported'); return; }
    voice = new VoiceMode({
      language: view.language,
      persona,
      SpeechRecognitionCtor: window.SpeechRecognition || window.webkitSpeechRecognition,
      synth: window.speechSynthesis,
      UtteranceCtor: window.SpeechSynthesisUtterance,
      onUtterance,
      onInterim: (text) => { vStatus.textContent = `🎙 ${text}`; },
      onBargeIn: () => streamAbort?.abort(),
      onState: (st) => {
        const on = st !== 'idle';
        voiceBtn.setAttribute('aria-checked', String(on));
        voiceBar.hidden = !on;
        voiceBar.dataset.state = st;
        if (statusText(st)) vStatus.textContent = statusText(st);
        vStop.hidden = !['speaking', 'thinking'].includes(st); // le micro est éteint pendant que le coach parle : on l'interrompt à la main
        if (!on) vMute.textContent = t('ws.mute');
      },
      onError: (code, params) => { err.textContent = t(`voice.err.${code}`, params); },
    });
    voice.start(); // la première fois, le navigateur demande l'accès au micro
  };
  // le micro étant éteint pendant la lecture (anti-écho), l'interruption se fait au bouton ou à la touche Échap
  vStop.onclick = () => { vStop.hidden = true; voice?.interrupt(); };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); if (e.key === 'Escape' && voice?.active && ['speaking', 'thinking'].includes(voice.state)) voice.interrupt(); });
  vMute.onclick = () => {
    const muted = vMute.textContent === t('ws.mute');
    voice?.setMuted(muted);
    vMute.textContent = muted ? t('ws.unmute') : t('ws.mute');
    voiceBar.classList.toggle('muted', muted);
  };
  window.addEventListener('beforeunload', stopVoice);

  send.onclick = () => submit();
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } };

  await loadLog();
  paint();
  input.focus();
}
