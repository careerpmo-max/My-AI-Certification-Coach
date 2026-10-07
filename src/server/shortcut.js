import { posix, win32 } from 'node:path';

const q = (s) => `"${s}"`; // chemins entre guillemets (espaces)
const psq = (s) => `'${s.replaceAll("'", "''")}'`; // littéral PowerShell

/**
 * Plan d'installation d'un raccourci bureau « un clic » pour la plateforme donnée : fichiers à écrire/copier et
 * commandes à lancer. Pur (aucune écriture) : testable pour les 3 systèmes depuis n'importe lequel.
 * @returns {{ files: Array<{path:string, content?:string, copyFrom?:string, mode?:number}>, commands: Array<{cmd:string, args:string[], optional?:boolean, shell?:string}>, desktop: string|null, launcher: string }}
 */
export function buildShortcutPlan({ platform, repoDir, nodePath, port = 3210, desktopDir = null, homeDir = '' }) {
  const URL_ = `http://127.0.0.1:${port}`;
  const files = [];
  const commands = [];

  if (platform === 'win32') {
    const p = win32;
    const bat = p.join(repoDir, 'launch.bat');
    const icon = p.join(repoDir, 'public', 'icon.ico'); // un .lnk n'accepte pas le PNG : on utilise l'.ico (PNG 256 px intégré)
    files.push({
      path: bat,
      content: [
        '@echo off',
        'rem Coach IA : lancement en un clic (genere par « npm run shortcut »)',
        'cd /d "%~dp0"',
        ...(port !== 3210 ? [`set "COACH_PORT=${port}"`] : []),
        'set "NODE=node"',
        `if exist ${q(nodePath)} set "NODE=${nodePath}"`,
        'rem serveur en arriere-plan (fenetre reduite : la fermer arrete le serveur)',
        'start "Coach IA" /MIN "%NODE%" src\\server\\index.js',
        'powershell -NoProfile -Command "Start-Sleep -Milliseconds 1500"',
        `start "" ${URL_}`,
        '',
      ].join('\r\n'),
    });
    const where = desktopDir ? psq(desktopDir) : "[Environment]::GetFolderPath('Desktop')";
    commands.push({
      cmd: 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', [
        `$desktop = ${where}`,
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Coach IA.lnk'))",
        `$s.TargetPath = ${psq(bat)}`,
        `$s.WorkingDirectory = ${psq(repoDir)}`,
        `$s.IconLocation = ${psq(`${icon},0`)}`,
        '$s.WindowStyle = 7',
        "$s.Description = 'Coach IA'",
        '$s.Save()',
      ].join('; ')],
    });
    return { files, commands, desktop: desktopDir, launcher: bat };
  }

  const p = posix;
  const script = (cdTarget, openCmd) => [
    '#!/bin/sh',
    '# Coach IA : lancement en un clic (genere par « npm run shortcut »)',
    `cd ${cdTarget} || exit 1`,
    `${port !== 3210 ? `export COACH_PORT=${port}\n` : ''}NODE=node`,
    `[ -x ${q(nodePath)} ] && NODE=${q(nodePath)}`,
    '"$NODE" src/server/index.js >/dev/null 2>&1 &',
    'sleep 1.5',
    openCmd,
    '',
  ].join('\n');

  if (platform === 'darwin') {
    const desktop = desktopDir ?? p.join(homeDir, 'Desktop');
    const launcher = p.join(repoDir, 'launch.command');
    files.push({ path: launcher, mode: 0o755, content: script('"$(dirname "$0")"', `open ${q(URL_)}`) });
    // .app minimal : double-clic sans fenêtre de Terminal. Finder lance les .app avec un PATH réduit : node est donc appelé par chemin absolu.
    const app = p.join(desktop, 'Coach IA.app', 'Contents');
    files.push({ path: p.join(app, 'MacOS', 'launch'), mode: 0o755, content: script(q(repoDir), `open ${q(URL_)}`) });
    files.push({ path: p.join(app, 'Resources', 'icon.icns'), copyFrom: p.join(repoDir, 'public', 'icon.icns') });
    files.push({
      path: p.join(app, 'Info.plist'),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Coach IA</string>
  <key>CFBundleDisplayName</key><string>Coach IA</string>
  <key>CFBundleIdentifier</key><string>local.my-ai-certification-coach</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
</dict>
</plist>
`,
    });
    commands.push({ cmd: 'touch', args: [p.join(desktop, 'Coach IA.app')], optional: true }); // rafraîchit l'icône dans le Finder
    return { files, commands, desktop, launcher };
  }

  // Linux (et assimilés)
  const desktop = desktopDir ?? p.join(homeDir, 'Desktop');
  const launcher = p.join(repoDir, 'launch.sh');
  files.push({ path: launcher, mode: 0o755, content: script('"$(dirname "$0")"', `xdg-open ${q(URL_)} >/dev/null 2>&1 || true`) });
  const entry = `[Desktop Entry]
Version=1.0
Type=Application
Name=Coach IA
Comment=Coach IA : préparer une certification
Exec=sh ${q(launcher)}
Icon=${p.join(repoDir, 'public', 'icon.png')}
Terminal=false
Categories=Education;
StartupNotify=false
`;
  const onDesktop = p.join(desktop, 'coach-ia.desktop');
  files.push({ path: onDesktop, mode: 0o755, content: entry });
  files.push({ path: p.join(homeDir, '.local', 'share', 'applications', 'coach-ia.desktop'), mode: 0o755, content: entry }); // aussi dans le menu des applications
  commands.push({ cmd: 'gio', args: ['set', onDesktop, 'metadata::trusted', 'true'], optional: true }); // GNOME : « autoriser le lancement »
  return { files, commands, desktop, launcher };
}
