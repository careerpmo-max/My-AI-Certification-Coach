import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, HOST, PORT } from './config.js';
import { JsonStore } from './storage.js';
import { createApp } from './app.js';

const server = createApp({ store: new JsonStore(DATA_DIR), dataDir: DATA_DIR });
const url = `http://${HOST}:${PORT}`;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Le port ${PORT} est déjà utilisé (une autre instance tourne ?). Choisis-en un autre : COACH_PORT=3211 npm start`);
  else console.error(e.message);
  process.exit(1);
});

// une erreur inattendue dans une tâche de fond ne doit pas tuer le serveur ni perdre les données
process.on('unhandledRejection', (e) => console.error('[coach] erreur inattendue :', e?.message ?? e));

server.listen(PORT, HOST, () => {
  console.log(`Coach IA → ${url}`);
  console.log(`Données locales : ${DATA_DIR}`);
  if (process.argv.includes('--open')) openBrowser(url);
  ensureDesktopShortcut();
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));

/** Ouvre le navigateur par défaut (option `--open`, utilisée par start.sh / start.bat). */
function openBrowser(target) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', target]] : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch { /* pas de navigateur : l'URL est affichée ci-dessus */ }
}

/** 1er démarrage : crée le raccourci bureau « Coach IA » sans rien demander (une seule fois ; COACH_NO_SHORTCUT=1 pour l'éviter). */
function ensureDesktopShortcut() {
  const script = fileURLToPath(new URL('../../scripts/shortcut.mjs', import.meta.url));
  try {
    const r = spawnSync(process.execPath, [script, '--auto'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, COACH_DATA_DIR: DATA_DIR } });
    if (r.stdout.includes('Raccourci prêt')) console.log('🖥️  Raccourci « Coach IA » créé sur ton bureau (double-clic pour relancer).');
    if (r.stderr) console.error(r.stderr.trim());
  } catch { /* jamais bloquant */ }
}
