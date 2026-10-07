#!/usr/bin/env node
// Diagnostic avec une vraie clé : npm run doctor [-- --url <page d'examen>] [--skip-search] [--skip-extract]
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from '../src/server/config.js';
import { runDoctor } from '../src/server/doctor.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

let apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) apiKey = JSON.parse(await readFile(join(DATA_DIR, 'secrets.json'), 'utf8').catch(() => '{}')).openaiKey;

const ICON = { ok: '✅', warn: '⚠️ ', fail: '❌', skip: '⏭️ ' };
console.log('Coach IA — diagnostic (quelques appels API, coût typique : quelques centimes)\n');
const results = await runDoctor({
  apiKey,
  url: value('--url'),
  dataDir: DATA_DIR,
  skipSearch: flag('--skip-search'),
  skipExtract: flag('--skip-extract'),
  onResult: (r) => {
    console.log(`${ICON[r.status]} ${r.label}${r.detail ? ` — ${r.detail}` : ''}`);
    if (r.hint && r.status !== 'ok') console.log(`     ↳ ${r.hint}`);
  },
});
const fails = results.filter((r) => r.status === 'fail').length;
const warns = results.filter((r) => r.status === 'warn').length;
console.log(`\n${fails ? '❌' : warns ? '⚠️ ' : '✅'} ${results.length} vérifications : ${fails} échec(s), ${warns} avertissement(s).`);
if (fails || warns) console.log('Copie-colle cette sortie pour que je corrige.');
process.exit(fails ? 1 : 0);
