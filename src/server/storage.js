import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Store JSON local : un fichier par document, écriture atomique (tmp + rename).
 * Interface volontairement minimale (get/set/update) pour pouvoir la remplacer par SQLite.
 */
export class JsonStore {
  #queues = new Map();
  constructor(dir) {
    this.dir = dir;
  }

  #path(key) {
    if (!/^[\w./-]+$/.test(key) || key.includes('..')) throw new Error(`clé invalide: ${key}`);
    return join(this.dir, `${key}.json`);
  }

  async get(key, fallback = null) {
    try {
      return JSON.parse(await readFile(this.#path(key), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
  }

  async set(key, value) {
    const path = this.#path(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2));
    await rename(tmp, path);
    return value;
  }

  async remove(key) {
    await rm(this.#path(key), { force: true });
  }

  /** Lecture-modification-écriture sérialisée par clé. Si fn renvoie undefined, rien n'est écrit (valeur courante renvoyée). */
  update(key, fn, fallback = null) {
    const prev = this.#queues.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      const cur = await this.get(key, fallback);
      const out = await fn(cur);
      return out === undefined ? cur : this.set(key, out);
    });
    this.#queues.set(key, next.catch(() => {}));
    return next;
  }
}
