#!/usr/bin/env node
// Crée un raccourci « un clic » sur le bureau : npm run shortcut
// Options : --desktop <dossier> (autre emplacement), --dry-run (n'écrit rien), --platform win32|darwin|linux (tests)
//   --auto : mode silencieux appelé au 1er démarrage / postinstall — une seule fois (marqueur dans le dossier de données),
//            ne bloque jamais (code de sortie 0), désactivable avec COACH_NO_SHORTCUT=1
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIcns, encodeIco, iconPng } from '../src/server/icon.js';
import { buildShortcutPlan } from '../src/server/shortcut.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const dryRun = args.includes('--dry-run');
const platform = opt('--platform') ?? process.platform;
const auto = args.includes('--auto');
const MARKER = join(process.env.COACH_DATA_DIR ? resolve(process.env.COACH_DATA_DIR) : join(ROOT, 'data'), '.shortcut-done');
if (auto) {
  if (process.env.COACH_NO_SHORTCUT || process.env.CI || process.env.NODE_TEST_CONTEXT || await stat(MARKER).then(() => true, () => false)) process.exit(0);
  const fail = (m) => { console.error(`[coach] raccourci bureau non créé (${m}) — réessaie avec : npm run shortcut`); process.exit(0); };
  process.on('uncaughtException', (e) => fail(e.message));
}

const exists = (p) => stat(p).then(() => true, () => false);

// icônes : régénérées si elles manquent (public/icon.png / .ico / .icns)
if (!dryRun && !(await exists(join(ROOT, 'public', 'icon.png')))) {
  const png = iconPng(256);
  await mkdir(join(ROOT, 'public'), { recursive: true });
  await writeFile(join(ROOT, 'public', 'icon.png'), png);
  await writeFile(join(ROOT, 'public', 'icon.ico'), encodeIco(png));
  await writeFile(join(ROOT, 'public', 'icon.icns'), encodeIcns(png));
}

// dossier Bureau : localisé sous Linux (xdg-user-dir), redirigé sous Windows (OneDrive…) → résolu par PowerShell dans le plan
let desktopDir = opt('--desktop') ? resolve(opt('--desktop')) : null;
if (!desktopDir && platform === 'linux') {
  const r = spawnSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim() && r.stdout.trim() !== homedir()) desktopDir = r.stdout.trim();
}

const plan = buildShortcutPlan({ platform, repoDir: ROOT, nodePath: process.execPath, port: Number(process.env.COACH_PORT) || 3210, desktopDir, homeDir: homedir() });
if (!['win32', 'darwin', 'linux'].includes(platform)) console.log(`Plateforme « ${platform} » : plan Linux utilisé.`);

for (const f of plan.files) {
  console.log(`${dryRun ? '[dry-run] ' : ''}→ ${f.path}`);
  if (dryRun) continue;
  await mkdir(dirname(f.path), { recursive: true });
  if (f.copyFrom) await copyFile(f.copyFrom, f.path);
  else await writeFile(f.path, f.content);
  if (f.mode) await chmod(f.path, f.mode);
}
for (const c of plan.commands) {
  if (dryRun) { console.log(`[dry-run] ${c.cmd} ${c.args.join(' ').slice(0, 120)}…`); continue; }
  if (c.cmd === 'powershell' && platform !== process.platform) continue; // plan Windows évalué depuis un autre système (tests)
  const r = spawnSync(c.cmd, c.args, { encoding: 'utf8' });
  if (r.status !== 0 && !c.optional) {
    const why = (r.stderr || r.error?.message || '').trim();
    if (auto) { console.error(`[coach] raccourci bureau non créé (${c.cmd} : ${why}) — réessaie avec : npm run shortcut`); process.exit(0); }
    console.error(`❌ ${c.cmd} a échoué : ${why}`);
    process.exit(1);
  }
}
if (auto && !dryRun) { await mkdir(dirname(MARKER), { recursive: true }); await writeFile(MARKER, new Date().toISOString()); }
console.log(`\n✅ Raccourci prêt${plan.desktop ? ` sur le bureau (${plan.desktop})` : ' sur le bureau'} : double-clic pour lancer Coach IA (serveur + navigateur).`);
if (platform === 'linux') console.log('   Si le bureau demande une confirmation : clic droit → « Autoriser le lancement ».');
if (platform === 'win32') console.log('   Le serveur tourne dans une fenêtre réduite : la fermer arrête Coach IA.');
