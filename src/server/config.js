import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const PORT = Number(process.env.COACH_PORT ?? 3210);
export const HOST = '127.0.0.1'; // jamais exposé hors machine : la clé API transite par ce serveur
/** Données locales : `data/` à la racine du dépôt (indépendant du dossier de lancement), ou COACH_DATA_DIR. */
export const DATA_DIR = resolve(process.env.COACH_DATA_DIR ?? join(import.meta.dirname, '../../data'));
export const WEB_DIR = resolve(import.meta.dirname, '../web');
export const PUBLIC_DIR = resolve(import.meta.dirname, '../../public'); // icônes (icon.png / .ico / .icns)
export const MODELS = {
  text: process.env.COACH_TEXT_MODEL ?? 'gpt-4.1',
  extract: process.env.COACH_EXTRACT_MODEL ?? 'gpt-4.1-mini',
  research: process.env.COACH_RESEARCH_MODEL ?? 'gpt-4.1',
};
export const HOME = homedir();

/** Tarifs INDICATIFS (USD / million de tokens, USD / 1000 recherches web) pour le compteur d'usage : à vérifier
 *  sur la page de tarification OpenAI et surcharger via COACH_PRICING (JSON) si besoin. */
export const PRICING = {
  models: { 'gpt-4.1': { in: 2, out: 8 }, 'gpt-4.1-mini': { in: 0.4, out: 1.6 } },
  searchPer1k: 10,
  ...(process.env.COACH_PRICING ? JSON.parse(process.env.COACH_PRICING) : {}),
};
