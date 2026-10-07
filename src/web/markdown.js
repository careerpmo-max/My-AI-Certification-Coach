/**
 * Rendu enrichi des messages du coach : **gras**, *italique*, `code`, listes en checklist, blocs [CONCEPT] / [ANALOGIE],
 * séparateurs de section. Le parseur (parseMessage / parseInline) est pur et testé sous Node ; le rendu DOM n'utilise que
 * createElement/textContent (jamais innerHTML : le contenu vient d'un LLM) et n'autorise que des liens http(s).
 */

// [CONCEPT] Titre · [CONCEPT: Titre] … [/CONCEPT] · [ANALOGIE] … [/ANALOGIE] (groupe 2 = titre « deux-points », 3 = reste de la ligne)
const TAG = /^\s*\[(CONCEPT|ANALOGIE|ANALOGY|SECTION)(?:\s*:\s*([^\]\n]*))?\]\s*(.*)$/i;
const CLOSE = /^\s*\[\/(CONCEPT|ANALOGIE|ANALOGY)\]\s*$/i;
const PHASE = /^\s*(📖|❓)\s*(.*)$/u;
const HEADING = /^\s{0,3}#{1,4}\s+(.*)$/;
const HR = /^\s*([-*_])\1{2,}\s*$/;
const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;

const isBlank = (l) => l === undefined || /^\s*$/.test(l);
const startsBlock = (l) => TAG.test(l) || CLOSE.test(l) || PHASE.test(l) || HEADING.test(l) || HR.test(l);

// ---------- inline ----------
const INLINE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>\]]+)/g;

/** Texte -> nœuds inline : { t: 'text'|'b'|'i'|'code'|'a', ... } */
export function parseInline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'code', v: m[1] });
    else if (m[2] !== undefined) out.push({ t: 'b', c: parseInline(m[2]) });
    else if (m[3] !== undefined) out.push({ t: 'i', c: parseInline(m[3]) });
    else if (m[4] !== undefined) out.push({ t: 'a', href: m[5], c: parseInline(m[4]) });
    else {
      const url = m[6].replace(/[.,;:!?]+$/, '');
      out.push({ t: 'a', href: url, c: [{ t: 'text', v: url }] });
      if (url.length < m[6].length) out.push({ t: 'text', v: m[6].slice(url.length) });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

// ---------- blocs ----------
/** Message du coach -> blocs : p, ul, ol, concept, analogy, section, hr (voir les tests pour le détail). */
export function parseMessage(text, { streaming = false } = {}) {
  let src = text.replace(/\r\n?/g, '\n');
  if (streaming) src = src.replace(/\[\/?[A-Za-zÉé]*(?::[^\]\n]*)?$/, ''); // balise encore incomplète en bout de flux : masquée jusqu'à ce qu'elle soit complète
  return parseLines(src.split('\n'), streaming);
}

const stripBold = (s) => s.replace(/^\*\*(.+?)\*\*$/, '$1').trim();

function parseLines(lines, streaming = false) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    if (CLOSE.test(line)) { i++; continue; } // fermeture orpheline : ignorée

    const ph = line.match(PHASE);
    if (ph) { blocks.push({ type: 'phase', kind: ph[1] === '📖' ? 'course' : 'check', title: stripBold(ph[2]) }); i++; continue; }

    const tag = line.match(TAG);
    if (tag) {
      const kind = tag[1].toUpperCase();
      const colonTitle = tag[2] !== undefined ? tag[2].trim() : null;
      const noClose = (x) => x.replace(/\[\/(?:CONCEPT|ANALOGIE|ANALOGY)\]/gi, '').trim();
      const rest = noClose(colonTitle ?? tag[3]);
      const first = colonTitle !== null ? noClose(tag[3]) : '';
      i++;
      if (kind === 'SECTION') { blocks.push({ type: 'section', title: rest }); continue; }
      const type = kind === 'CONCEPT' ? 'concept' : 'analogy';
      // forme fermée [CONCEPT: Titre] … [/CONCEPT] : fermeture présente (ou, en streaming, bloc encore ouvert)
      const closeRe = new RegExp(`\\[/(?:${kind === 'CONCEPT' ? 'CONCEPT' : 'ANALOGIE|ANALOGY'})\\]`, 'i');
      const hasCloser = lines.slice(i).some((l) => closeRe.test(l));
      if (hasCloser || (streaming && colonTitle !== null)) {
        const inner = first ? [first] : [];
        while (i < lines.length && !closeRe.test(lines[i])) inner.push(lines[i++]);
        if (i < lines.length) { const before = lines[i].replace(closeRe, '').trim(); if (before) inner.push(before); i++; }
        const inTitle = colonTitle !== null || (rest !== '' && rest.length <= 90);
        blocks.push({ type, title: inTitle ? rest : '', body: parseLines(inTitle ? inner : [rest, ...inner].filter((x) => x !== ''), streaming) });
        continue;
      }
      // forme courte [CONCEPT] Titre : le contenu suit la balise ; une seule ligne vide est tolérée juste après elle
      if (isBlank(lines[i]) && !isBlank(lines[i + 1]) && !startsBlock(lines[i + 1])) i++;
      const body = first ? [first] : [];
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) body.push(lines[i++]);
      // « [CONCEPT] longue phrase » sans titre distinct : tout est du corps
      const longTitle = !body.length && rest.length > 90;
      blocks.push({ type, title: longTitle ? '' : rest, body: parseLines(longTitle ? [rest] : body) });
      continue;
    }

    const h = line.match(HEADING);
    if (h) { blocks.push({ type: 'section', title: h[1].trim() }); i++; continue; }
    if (HR.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }

    const listRe = UL.test(line) ? UL : OL.test(line) ? OL : null;
    if (listRe) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(listRe);
        if (m) { items.push(m[1].trim()); i++; continue; }
        if (/^\s{2,}\S/.test(lines[i]) && items.length && !startsBlock(lines[i])) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; continue; } // ligne de continuation indentée
        if (isBlank(lines[i]) && listRe.test(lines[i + 1] ?? '')) { i++; continue; } // liste « aérée »
        break;
      }
      blocks.push({ type: listRe === UL ? 'ul' : 'ol', items });
      continue;
    }

    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i])) para.push(lines[i++]);
    blocks.push({ type: 'p', text: para.join('\n') });
  }
  return blocks;
}

// ---------- rendu DOM (navigateur) ----------
const h = (tag, cls, ...kids) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.append(...kids.filter((k) => k !== null && k !== undefined));
  return n;
};

function inlineNodes(nodes) {
  return nodes.flatMap((n) => {
    if (n.t === 'text') {
      return n.v.split('\n').flatMap((part, i) => (i ? [document.createElement('br'), part] : [part]));
    }
    if (n.t === 'code') return [h('code', '', n.v)];
    if (n.t === 'b') return [h('strong', '', ...inlineNodes(n.c))];
    if (n.t === 'i') return [h('em', '', ...inlineNodes(n.c))];
    const a = h('a', '', ...inlineNodes(n.c));
    a.href = n.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return [a];
  });
}

function blockNode(b, labels) {
  switch (b.type) {
    case 'p': return h('p', '', ...inlineNodes(parseInline(b.text)));
    case 'ul': return h('ul', 'checks', ...b.items.map((it) => h('li', '', ...inlineNodes(parseInline(it)))));
    case 'ol': return h('ol', '', ...b.items.map((it) => h('li', '', ...inlineNodes(parseInline(it)))));
    case 'phase': return h('div', `phase-line ${b.kind}`, h('span', `phase-badge ${b.kind}`, b.kind === 'course' ? labels.phaseCourse : labels.phaseCheck), h('h3', '', ...inlineNodes(parseInline(b.title))));
    case 'hr': return h('hr', 'sep');
    case 'section': return h('div', 'section-sep', h('span', '', ...inlineNodes(parseInline(b.title))));
    default: {
      const concept = b.type === 'concept';
      return h('div', `callout ${concept ? 'concept' : 'analogy'}`,
        h('div', 'callout-label', concept ? labels.concept : labels.analogy),
        b.title ? h('div', 'callout-title', ...inlineNodes(parseInline(b.title))) : null,
        h('div', 'callout-body', ...b.body.map((x) => blockNode(x, labels))));
    }
  }
}

/** Remplit `container` avec le rendu enrichi de `text`. labels = { concept, analogy } (textes traduits). */
export function renderMessage(container, text, labels, streaming = false) {
  container.replaceChildren(...parseMessage(text, { streaming }).map((b) => blockNode(b, labels)));
}
