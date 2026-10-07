import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../src/server/storage.js';

test('set/get/update sérialisé', async () => {
  const s = new JsonStore(await mkdtemp(join(tmpdir(), 'coach-')));
  assert.equal(await s.get('x'), null);
  await s.set('a/b', { n: 0 });
  await Promise.all(Array.from({ length: 20 }, () => s.update('a/b', (v) => ({ n: v.n + 1 }))));
  assert.equal((await s.get('a/b')).n, 20);
  await assert.rejects(() => s.get('../evil'));
});
