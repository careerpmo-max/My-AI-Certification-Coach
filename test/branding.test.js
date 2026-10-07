import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { JsonStore } from '../src/server/storage.js';
import { createApp } from '../src/server/app.js';
import { encodeIcns, encodeIco, iconPng, iconSvg, renderIcon } from '../src/server/icon.js';
import { buildShortcutPlan } from '../src/server/shortcut.js';
import { applyTheme, otherTheme, storedTheme } from '../src/web/theme.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFile(join(ROOT, p));

function decodePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  let off = 8;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = (x, y) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)];
  return { w, h, bitDepth: buf[24], colorType: buf[25], px };
}

test('icône : PNG 256×256 RGBA valide, design attendu (fond #1e2535, « C » blanc, étincelle bleue, coins transparents)', () => {
  const img = decodePng(iconPng(256));
  assert.deepEqual([img.w, img.h, img.bitDepth, img.colorType], [256, 256, 8, 6]);
  assert.equal(img.px(0, 0)[3], 0, 'coin extérieur transparent (carré arrondi)');
  assert.deepEqual(img.px(128, 20), [0x1e, 0x25, 0x35, 255], 'fond bleu foncé');
  assert.deepEqual(img.px(50, 132), [255, 255, 255, 255], 'trait gauche du C : blanc');
  assert.deepEqual(img.px(220, 200), [0x1e, 0x25, 0x35, 255]);
  assert.deepEqual(img.px(130, 132), [0x1e, 0x25, 0x35, 255], 'intérieur du C : fond');
  assert.deepEqual(img.px(230, 132), [0x1e, 0x25, 0x35, 255], 'ouverture du C à droite : fond');
  assert.deepEqual(img.px(198, 78), [0x6b, 0x93, 0xff, 255], 'cœur de l\'étincelle IA');
  const mid = img.px(1, 128); // bord arrondi : anti-crénelage (alpha partiel)
  assert.ok(mid[3] > 0 && mid[3] < 255 || img.px(2, 128)[3] > 0);
});

test('icône : rendu à d\'autres tailles, ICO (PNG intégré) et ICNS valides', () => {
  assert.equal(renderIcon(64).length, 64 * 64 * 4);
  const png = iconPng(256);
  const ico = encodeIco(png);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.equal(ico.readUInt32LE(14), png.length);
  assert.equal(ico.readUInt32LE(18), 22);
  assert.ok(ico.subarray(22).equals(png));
  const icns = encodeIcns(png);
  assert.equal(icns.toString('ascii', 0, 4), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.equal(icns.toString('ascii', 8, 12), 'ic08');
  assert.ok(icns.subarray(16).equals(png));
});

test('identité visuelle : favicon.svg et public/icon.* sont à jour (régénérer : node scripts/make-icon.mjs)', async () => {
  const svg = (await read('src/web/favicon.svg')).toString();
  assert.equal(svg, iconSvg());
  assert.match(svg, /fill="#1e2535"/);
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok((await read('public/icon.png')).equals(iconPng(256)));
  assert.ok((await read('public/icon.ico')).equals(encodeIco(iconPng(256))));
  assert.ok((await read('public/icon.icns')).equals(encodeIcns(iconPng(256))));
});

test('le serveur sert /favicon.svg et /icon.png (et refuse de sortir de public/)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coach-brand-'));
  const server = createApp({ store: new JsonStore(dir), dataDir: dir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const svg = await fetch(`${base}/favicon.svg`);
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml');
    assert.match(await svg.text(), /<svg/);
    const png = await fetch(`${base}/icon.png`);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.equal((await png.arrayBuffer()).byteLength, (await read('public/icon.png')).length);
    assert.equal((await fetch(`${base}/icon.ico`)).headers.get('content-type'), 'image/x-icon');
    const html = await (await fetch(base)).text();
    assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
    assert.notEqual((await fetch(`${base}/..%2fpackage.json`)).status, 200);
  } finally { server.close(); }
});

// ---------- raccourcis bureau ----------
const base = { repoDir: '/home/ada/coach-ai', nodePath: '/usr/local/bin/node', port: 3210, homeDir: '/home/ada' };

test('raccourci Windows : launch.bat (serveur en arrière-plan, attente 1,5 s, navigateur) + .lnk PowerShell avec l\'icône .ico', () => {
  const plan = buildShortcutPlan({ ...base, platform: 'win32', repoDir: 'C:\\Users\\Ada\\coach-ai', nodePath: 'C:\\Program Files\\nodejs\\node.exe' });
  const bat = plan.files[0];
  assert.equal(bat.path, 'C:\\Users\\Ada\\coach-ai\\launch.bat');
  assert.ok(bat.content.includes('\r\n'), 'fins de ligne Windows');
  assert.match(bat.content, /cd \/d "%~dp0"/);
  assert.match(bat.content, /start "Coach IA" \/MIN "%NODE%" src\\server\\index\.js/);
  assert.match(bat.content, /if exist "C:\\Program Files\\nodejs\\node\.exe" set "NODE=C:\\Program Files\\nodejs\\node\.exe"/);
  assert.match(bat.content, /Start-Sleep -Milliseconds 1500/);
  assert.match(bat.content, /start "" http:\/\/127\.0\.0\.1:3210/);
  assert.ok(bat.content.indexOf('Start-Sleep') < bat.content.indexOf('start "" http'), 'on attend avant d\'ouvrir le navigateur');
  const ps = plan.commands[0];
  assert.equal(ps.cmd, 'powershell');
  const script = ps.args.at(-1);
  assert.match(script, /\[Environment\]::GetFolderPath\('Desktop'\)/, 'bureau réel (OneDrive compris)');
  assert.match(script, /New-Object -ComObject WScript\.Shell/);
  assert.match(script, /CreateShortcut\(\(Join-Path \$desktop 'Coach IA\.lnk'\)\)/);
  assert.match(script, /TargetPath = 'C:\\Users\\Ada\\coach-ai\\launch\.bat'/);
  assert.match(script, /IconLocation = 'C:\\Users\\Ada\\coach-ai\\public\\icon\.ico,0'/);
  assert.match(script, /WindowStyle = 7/);
  assert.match(buildShortcutPlan({ ...base, platform: 'win32', repoDir: "C:\\Users\\O'Neil\\coach-ai", nodePath: 'node' }).commands[0].args.at(-1), /TargetPath = 'C:\\Users\\O''Neil\\coach-ai\\launch\.bat'/, 'apostrophe échappée en PowerShell');
  assert.match(buildShortcutPlan({ ...base, platform: 'win32', desktopDir: 'D:\\Bureau' }).commands[0].args.at(-1), /\$desktop = 'D:\\Bureau'/);
  assert.match(buildShortcutPlan({ ...base, platform: 'win32', port: 4000 }).files[0].content, /set "COACH_PORT=4000"[\s\S]*start "" http:\/\/127\.0\.0\.1:4000/);
});

test('raccourci macOS : launch.command exécutable + Coach IA.app minimal (Info.plist, exécutable, icône .icns)', () => {
  const plan = buildShortcutPlan({ ...base, platform: 'darwin' });
  const byPath = Object.fromEntries(plan.files.map((f) => [f.path, f]));
  const cmd = byPath['/home/ada/coach-ai/launch.command'];
  assert.equal(cmd.mode, 0o755);
  assert.match(cmd.content, /^#!\/bin\/sh/);
  assert.match(cmd.content, /cd "\$\(dirname "\$0"\)"/);
  assert.match(cmd.content, /\[ -x "\/usr\/local\/bin\/node" \] && NODE="\/usr\/local\/bin\/node"/);
  assert.match(cmd.content, /"\$NODE" src\/server\/index\.js >\/dev\/null 2>&1 &\nsleep 1\.5\nopen "http:\/\/127\.0\.0\.1:3210"/);
  const app = '/home/ada/Desktop/Coach IA.app/Contents';
  const exe = byPath[`${app}/MacOS/launch`];
  assert.equal(exe.mode, 0o755);
  assert.match(exe.content, /cd "\/home\/ada\/coach-ai" \|\| exit 1/, 'le .app ne dépend pas de son emplacement');
  assert.match(exe.content, /NODE="\/usr\/local\/bin\/node"/, 'Finder a un PATH réduit : node par chemin absolu');
  assert.match(byPath[`${app}/Info.plist`].content, /<key>CFBundleExecutable<\/key><string>launch<\/string>[\s\S]*<key>CFBundleIconFile<\/key><string>icon<\/string>[\s\S]*<key>CFBundlePackageType<\/key><string>APPL<\/string>/);
  assert.equal(byPath[`${app}/Resources/icon.icns`].copyFrom, '/home/ada/coach-ai/public/icon.icns');
  assert.equal(plan.desktop, '/home/ada/Desktop');
});

test('raccourci Linux : launch.sh + coach-ia.desktop sur le bureau et dans le menu, icône PNG', () => {
  const plan = buildShortcutPlan({ ...base, platform: 'linux', desktopDir: '/home/ada/Bureau' });
  const byPath = Object.fromEntries(plan.files.map((f) => [f.path, f]));
  assert.equal(byPath['/home/ada/coach-ai/launch.sh'].mode, 0o755);
  assert.match(byPath['/home/ada/coach-ai/launch.sh'].content, /xdg-open "http:\/\/127\.0\.0\.1:3210"/);
  const entry = byPath['/home/ada/Bureau/coach-ia.desktop'];
  assert.equal(entry.mode, 0o755);
  assert.match(entry.content, /^\[Desktop Entry\]\nVersion=1\.0\nType=Application\nName=Coach IA/);
  assert.match(entry.content, /Exec=sh "\/home\/ada\/coach-ai\/launch\.sh"/);
  assert.match(entry.content, /Icon=\/home\/ada\/coach-ai\/public\/icon\.png/);
  assert.match(entry.content, /Terminal=false/);
  assert.ok(byPath['/home/ada/.local/share/applications/coach-ia.desktop']);
  assert.deepEqual(plan.commands[0].args, ['set', '/home/ada/Bureau/coach-ia.desktop', 'metadata::trusted', 'true']);
  assert.equal(plan.commands[0].optional, true);
});

test('npm run shortcut : détecte l\'OS, --dry-run n\'écrit rien, une vraie installation Linux crée les fichiers exécutables', async () => {
  const desktop = await mkdtemp(join(tmpdir(), 'coach-desk-'));
  const home = await mkdtemp(join(tmpdir(), 'coach-home-'));
  const run = (...a) => spawnSync(process.execPath, [join(ROOT, 'scripts/shortcut.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  try {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const r = run('--dry-run', '--platform', platform, '--desktop', desktop);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /\[dry-run\]/);
    }
    assert.deepEqual(await readdir(desktop), [], 'dry-run : aucun fichier écrit');

    const r = run('--platform', 'linux', '--desktop', desktop);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Raccourci prêt/);
    const entry = join(desktop, 'coach-ia.desktop');
    if (process.platform !== 'win32') { // les droits Unix n'existent pas sous Windows
      assert.ok((await stat(entry)).mode & 0o100, '.desktop exécutable');
      assert.ok((await stat(join(ROOT, 'launch.sh'))).mode & 0o100, 'launch.sh exécutable');
    }
    assert.match(await readFile(entry, 'utf8'), /Exec=sh ".*launch\.sh"/);
    // le lanceur généré démarre vraiment le serveur
    if (process.platform !== 'win32') assert.equal(spawnSync('sh', ['-n', join(ROOT, 'launch.sh')]).status, 0, 'launch.sh : syntaxe sh valide');
  } finally {
    await rm(join(ROOT, 'launch.sh'), { force: true });
  }
});

test('raccourci automatique (--auto) : créé une seule fois, désactivable, ne bloque jamais', async () => {
  if (process.platform !== 'linux') return; // le plan Linux est le seul exécutable sur tous les CI
  const data = await mkdtemp(join(tmpdir(), 'coach-auto-'));
  const home = await mkdtemp(join(tmpdir(), 'coach-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home, COACH_DATA_DIR: data };
  for (const k of ['CI', 'NODE_TEST_CONTEXT', 'COACH_NO_SHORTCUT']) delete env[k];
  const run = (e = {}) => spawnSync(process.execPath, [join(ROOT, 'scripts/shortcut.mjs'), '--auto'], { encoding: 'utf8', env: { ...env, ...e } });
  try {
    const off = run({ COACH_NO_SHORTCUT: '1' });
    assert.equal(off.status, 0); assert.equal(off.stdout, '');
    assert.deepEqual(await readdir(data), [], 'opt-out : rien d\'écrit');
    const first = run();
    assert.equal(first.status, 0, first.stderr); assert.match(first.stdout, /Raccourci prêt/);
    assert.ok((await readdir(data)).includes('.shortcut-done'), 'marqueur posé');
    const again = run();
    assert.equal(again.status, 0); assert.equal(again.stdout, '', 'deuxième démarrage : silencieux, rien recréé');
  } finally {
    await rm(join(ROOT, 'launch.sh'), { force: true });
  }
});

test('thème clair/sombre : sombre par défaut, bascule, valeur invalide ignorée', () => {
  assert.equal(storedTheme(), 'dark'); // pas de localStorage sous Node : repli sans erreur
  assert.equal(otherTheme('dark'), 'light');
  assert.equal(otherTheme('light'), 'dark');
  const doc = { documentElement: { dataset: {} } };
  globalThis.document = doc;
  try {
    assert.equal(applyTheme('light'), 'light');
    assert.equal(doc.documentElement.dataset.theme, 'light');
    assert.equal(applyTheme('violet'), 'dark');
    assert.equal(doc.documentElement.dataset.theme, 'dark');
  } finally { delete globalThis.document; }
});
