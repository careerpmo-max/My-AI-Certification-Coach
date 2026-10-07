import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/server/storage.js';
import { createApp } from '../src/server/app.js';
import { parseSSE } from '../src/server/openai.js';

const realFetch = globalThis.fetch;
let server, base;

// Mock d'OpenAI ; tout autre hôte externe est hors ligne (la création de cursus échoue proprement, sans réseau réel).
function mockOpenAI() {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
    if (!String(url).startsWith('https://api.openai.com')) throw new Error('offline');
    const key = init.headers.authorization;
    if (key !== 'Bearer sk-good') return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    if (String(url).endsWith('/models')) return new Response('{"data":[]}');
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        for (const t of ['Salut ', 'Ada']) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`));
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    });
    return new Response(body);
  };
}

before(async () => {
  mockOpenAI();
  const dir = await mkdtemp(join(tmpdir(), 'coach-app-'));
  server = createApp({ store: new JsonStore(dir), dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { globalThis.fetch = realFetch; server.close(); });

const post = (path, body, headers = {}) =>
  realFetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('parseSSE découpe les événements même fragmentés', async () => {
  const enc = new TextEncoder();
  async function* chunks() { yield enc.encode('data: {"a"'); yield enc.encode(':1}\n\ndata: [DONE]\n'); }
  const out = [];
  for await (const e of parseSSE(chunks())) out.push(e);
  assert.deepEqual(out, [{ a: 1 }]);
});

test('onboarding : clé invalide refusée, rien de stocké', async () => {
  const r = await post('/api/onboarding', { name: 'Ada', apiKey: 'sk-bad' });
  assert.equal(r.status, 401);
  assert.equal((await (await realFetch(base + '/api/state')).json()).onboarded, false);
  assert.equal((await post('/api/curricula', { name: 'x', officialUrl: 'https://example.org/x' })).status, 409);
});

test('onboarding (prénom + clé) puis chat streamé et reprise de session', async () => {
  assert.equal((await post('/api/onboarding', { name: 'Ada', apiKey: 'sk-good' })).status, 200);
  const state = await (await realFetch(base + '/api/state')).json();
  assert.equal(state.onboarded, true);
  assert.equal(state.profile.name, 'Ada');
  assert.equal(state.suggestions[0].url.startsWith('https://learn.microsoft.com/'), true);
  assert.ok(!JSON.stringify(state).includes('sk-good'), 'la clé ne doit jamais fuiter');

  const created = await (await post('/api/curricula', { name: 'Mon cursus', officialUrl: 'https://example.org/exam' })).json();
  const id = created.curriculum.id;

  const chat = await post('/api/chat', { curriculumId: id, message: 'Bonjour' });
  const text = await chat.text();
  assert.match(text, /"delta":"Salut "/);
  assert.match(text, /"done":true/);

  const { messages } = await (await realFetch(`${base}/api/session?curriculumId=${id}`)).json();
  const chatMsgs = messages.filter((m) => !m.kind);
  assert.deepEqual(chatMsgs.map((m) => [m.role, m.content]), [['user', 'Bonjour'], ['assistant', 'Salut Ada']]);
});

test('Origin non local rejeté', async () => {
  const r = await post('/api/curricula', {}, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});
