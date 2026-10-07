import { MODELS } from './config.js';
import { normalizeUrl } from './certs/sources.js';
import { recordCall } from './usage.js';

const BASE = process.env.COACH_OPENAI_BASE ?? 'https://api.openai.com/v1';

export class OpenAIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(apiKey, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new OpenAIError(body.error?.message ?? `OpenAI HTTP ${res.status}`, res.status);
  }
  return res;
}

/** Vérifie la clé (GET /models). Lève OpenAIError si invalide. */
export async function validateKey(apiKey) {
  await call(apiKey, '/models');
  return true;
}

/** Identifiants des modèles accessibles avec cette clé. */
export async function listModels(apiKey) {
  const res = await call(apiKey, '/models');
  return ((await res.json()).data ?? []).map((m) => m.id);
}

/** Parse un flux SSE OpenAI ("data: {...}" / "data: [DONE]") en objets JSON. */
export async function* parseSSE(stream) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      yield JSON.parse(data);
    }
  }
}

/**
 * Génère les deltas de texte d'un chat en streaming. Avec `tools` + `runTool`, exécute les appels d'outils
 * (function calling) puis relance le modèle, jusqu'à `maxRounds` tours.
 */
export async function* chatStream(apiKey, messages, { model = MODELS.text, signal, tools, runTool, maxRounds = 4 } = {}) {
  const msgs = [...messages];
  for (let round = 0; round < maxRounds; round++) {
    const res = await call(apiKey, '/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model, messages: msgs, stream: true, stream_options: { include_usage: true }, ...(tools ? { tools } : {}) }),
      signal,
    });
    const calls = new Map();
    let usage;
    for await (const evt of parseSSE(res.body)) {
      if (evt.usage) usage = evt.usage;
      const delta = evt.choices?.[0]?.delta;
      if (delta?.content) yield delta.content;
      for (const tc of delta?.tool_calls ?? []) {
        const c = calls.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
        calls.set(tc.index, c);
      }
    }
    recordCall({ label: 'chat', model, input: usage?.prompt_tokens, output: usage?.completion_tokens });
    if (!calls.size || !runTool) return;
    const list = [...calls.values()];
    msgs.push({ role: 'assistant', content: null, tool_calls: list.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })) });
    for (const c of list) {
      let result;
      try {
        result = await runTool(c.name, JSON.parse(c.args || '{}'));
      } catch (e) {
        result = { error: e.message };
      }
      msgs.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
}

/**
 * Extrait texte JSON + URLs vues/citées d'une réponse de l'API Responses.
 * `citations` : Map<url normalisée, titre> = annotations url_citation + sources des web_search_call.
 */
/** URL http(s) trouvées dans un sous-arbre, quel que soit le nom du champ (url, source_url, uri…). */
function urlsIn(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return out;
  if (Array.isArray(node)) {
    for (const n of node) urlsIn(n, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && /^(url|uri|source_url)$/i.test(k) && /^https?:\/\//i.test(v)) out.push({ url: v, title: node.title ?? node.name });
    else if (v && typeof v === 'object') urlsIn(v, out, depth + 1);
  }
  return out;
}

/**
 * Extrait texte JSON + URLs vues/citées d'une réponse de l'API Responses.
 * `citations` : Map<url normalisée, titre> = annotations (url_citation ou toute annotation portant une URL) + tout ce que
 * les appels web_search_call exposent (action.sources, action.url, results…). Tolère les variations de format.
 * `searches` : nombre d'appels de recherche web ; `raw` : la réponse brute (diagnostic).
 */
export function parseResponse(data, { expectJson = true } = {}) {
  let text = '';
  let searches = 0;
  const citations = new Map();
  const add = ({ url, title }) => {
    const n = normalizeUrl(url);
    if (n && !citations.get(n)) citations.set(n, title ?? '');
  };
  for (const item of data.output ?? []) {
    if (item.type === 'web_search_call') {
      searches++;
      urlsIn(item).forEach(add);
    }
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'refusal') throw new OpenAIError(`Refus du modèle : ${c.refusal}`, 422);
      if (c.type !== 'output_text') continue;
      text += c.text;
      urlsIn(c.annotations).forEach(add);
    }
  }
  if (!expectJson) return { text, json: null, citations, searches, raw: data };
  try {
    return { text, json: JSON.parse(text), citations, searches, raw: data };
  } catch {
    throw new OpenAIError('Réponse du modèle non exploitable (JSON invalide)', 502);
  }
}

/** Structure d'une réponse (types, clés, nombres) sans le contenu : à coller dans un rapport de bug. */
export function describeResponse(data) {
  const count = (arr = []) => arr.reduce((o, x) => ((o[x] = (o[x] ?? 0) + 1), o), {});
  return (data.output ?? []).map((i) => {
    const d = { type: i.type, status: i.status, keys: Object.keys(i) };
    if (i.type === 'web_search_call') d.action = i.action ? { type: i.action.type, keys: Object.keys(i.action), sources: Array.isArray(i.action.sources) ? i.action.sources.length : null } : null;
    if (i.type === 'message') d.content = (i.content ?? []).map((c) => ({ type: c.type, textLength: c.text?.length ?? 0, annotations: count((c.annotations ?? []).map((a) => a.type)) }));
    return d;
  });
}

async function respondOnce(apiKey, { model, instructions, input, tools, toolChoice, schema, schemaName = 'result', signal }) {
  const res = await call(apiKey, '/responses', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      model,
      instructions,
      input,
      tools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      include: tools?.some((t) => t.type === 'web_search') ? ['web_search_call.action.sources'] : undefined,
      ...(schema ? { text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } } } : {}),
    }),
  });
  const data = await res.json();
  recordCall({
    label: schemaName,
    model,
    input: data.usage?.input_tokens,
    output: data.usage?.output_tokens,
    searches: (data.output ?? []).filter((i) => i.type === 'web_search_call').length,
  });
  return parseResponse(data, { expectJson: !!schema });
}

/** Appel Responses API (sortie JSON structurée si `schema`, sinon texte libre avec annotations), web_search optionnel. Si `tool_choice` est refusé, nouvel essai sans. */
export async function respond(apiKey, opts) {
  try {
    return await respondOnce(apiKey, opts);
  } catch (e) {
    if (opts.toolChoice && e instanceof OpenAIError && e.status === 400 && /tool_choice/i.test(e.message)) return respondOnce(apiKey, { ...opts, toolChoice: undefined });
    throw e;
  }
}
