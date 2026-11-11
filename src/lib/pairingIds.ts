// Identifiants provisoires des TV qui attendent d'être connectées (voir pairing.ts).

import type { AppScreen } from './types';

const CODE = /^[A-HJKMNP-Z2-9]{6}$/;
const PAIRING_ID = /^TV-[A-HJKMNP-Z2-9]{6}$/;

/** Nettoie un code saisi ou lu dans le lien du QR code. */
export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const isValidCode = (code: string) => CODE.test(code);
export const pairingId = (code: string) => `TV-${code}`;
export const codeOf = (id: string) => id.slice(3);

/** Ligne provisoire d'une TV qui attend d'être connectée (jamais affichée comme un écran). */
export const isPairingRow = (s: Pick<AppScreen, 'id' | 'configuration_id'>) => !s.configuration_id && PAIRING_ID.test(s.id);
export const isPairingId = (id: string) => PAIRING_ID.test(id);
