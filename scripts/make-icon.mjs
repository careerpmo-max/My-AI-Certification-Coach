#!/usr/bin/env node
// Régénère l'identité visuelle : src/web/favicon.svg et public/icon.{png,ico,icns}
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIcns, encodeIco, iconPng, iconSvg } from '../src/server/icon.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const png = iconPng(256);
await mkdir(join(ROOT, 'public'), { recursive: true });
await writeFile(join(ROOT, 'src/web/favicon.svg'), iconSvg());
await writeFile(join(ROOT, 'public/icon.png'), png);
await writeFile(join(ROOT, 'public/icon.ico'), encodeIco(png));
await writeFile(join(ROOT, 'public/icon.icns'), encodeIcns(png));
console.log('favicon.svg, icon.png, icon.ico, icon.icns générés.');
