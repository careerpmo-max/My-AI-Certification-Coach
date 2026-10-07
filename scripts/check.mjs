#!/usr/bin/env node
// Contrôles statiques + démarrage à blanc : npm run check
//  1. syntaxe de tous les .js/.mjs (node --check)
//  2. tous les imports relatifs pointent vers un fichier existant
//  3. le serveur démarre, sert toute l'interface (index.html + graphe d'imports du front) et refuse la traversée de dossiers
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (m) => problems.push(m);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'data' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.(m?js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [...await walk(join(ROOT, 'src')), ...await walk(join(ROOT, 'scripts')), ...await walk(join(ROOT, 'test'))];

// 1. syntaxe
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) fail(`syntaxe : ${relative(ROOT, f)}\n${r.stderr.trim()}`);
}

// 2. imports relatifs
const importRe = /(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
const graph = new Map();
for (const f of files) {
  const src = await readFile(f, 'utf8');
  const deps = [];
  for (const m of src.matchAll(importRe)) {
    const target = resolve(dirname(f), m[1] ?? m[2]);
    deps.push(target);
    const exists = await readFile(target).then(() => true, () => false);
    if (!exists) fail(`import introuvable : ${relative(ROOT, f)} → ${m[1] ?? m[2]}`);
  }
  graph.set(f, deps);
}

// 3. démarrage à blanc + interface servie
process.env.COACH_DATA_DIR = await mkdtemp(join(tmpdir(), 'coach-check-'));
const { createApp } = await import('../src/server/app.js');
const { JsonStore } = await import('../src/server/storage.js');
const server = createApp({ store: new JsonStore(process.env.COACH_DATA_DIR), dataDir: process.env.COACH_DATA_DIR });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const webRoot = join(ROOT, 'src', 'web');
  const served = new Set(['/']);
  const queue = [join(webRoot, 'app.js')];
  while (queue.length) {
    const f = queue.pop();
    const url = `/${relative(webRoot, f).split(/[\\/]/).join('/')}`;
    if (served.has(url)) continue;
    served.add(url);
    queue.push(...(graph.get(f) ?? []));
  }
  served.add('/style.css');
  for (const url of served) {
    const res = await fetch(base + url);
    if (res.status !== 200) fail(`interface : ${url} → HTTP ${res.status}`);
  }
  const state = await (await fetch(`${base}/api/state`)).json();
  if (state.onboarded !== false || state.languages?.[0]?.code !== 'fr-FR') fail('GET /api/state inattendu à blanc');
  for (const evil of ['/..%2f..%2fsrc/server/config.js', '/../server/config.js', '/%2e%2e/server/config.js']) {
    const r = await fetch(base + evil);
    if (r.status === 200) fail(`traversée de dossier possible : ${evil}`);
  }
  const hostile = await fetch(`${base}/api/state`, { headers: { origin: 'https://evil.example' } });
  if (hostile.status !== 403) fail('requête cross-origin non refusée');
  console.log(`${served.size} fichiers d'interface servis, ${files.length} fichiers de code vérifiés.`);
} finally {
  server.close();
}

if (problems.length) {
  console.error(`\n❌ ${problems.length} problème(s) :\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('✅ check OK');
