// Connexion d'une TV neuve par QR code.
// La TV (lecteur 1.4+) s'annonce sous un identifiant provisoire « TV-<code> » et affiche ce code en QR.
// Ici, on lui donne son nom et sa place sur un mur ; elle reçoit la commande « adopt:<nom> » et démarre.

import { sbClient } from './supabase';
import { must } from './data';
import { pairingId } from './pairingIds';
import type { AppScreen, Configuration, Group } from './types';

export { codeOf, isPairingId, isPairingRow, isValidCode, normalizeCode, pairingId } from './pairingIds';

/** Nom d'écran sûr : lettres, chiffres, espaces, tirets. */
export const cleanScreenName = (raw: string) =>
  raw
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40);

export interface WaitingTv {
  id: string;
  last_ping: string | null;
  device_model?: string | null;
  player_version?: string | null;
}

/** Cherche la TV qui affiche ce code. */
export async function findWaitingTv(code: string): Promise<WaitingTv | null> {
  const { data } = must(
    await sbClient.from('screens_config').select('id,last_ping,device_model,player_version,configuration_id').eq('id', pairingId(code)).maybeSingle(),
  );
  return data && !data.configuration_id ? (data as WaitingTv) : null;
}

export interface PairTarget {
  /** Nom final de l'écran (nouveau, ou celui de l'écran remplacé). */
  name: string;
  /** Écran existant repris par la nouvelle TV (remplacement d'une TV en panne). */
  replace: boolean;
  config: Configuration | null;
  group: Group | null;
  x: number;
  y: number;
  cols: number;
  rows: number;
  /** Écran du même mur dont on reprend le contenu et les horaires. */
  sibling?: AppScreen;
  /** 180 si la TV est montée à l'envers. */
  rotation: 0 | 180;
  ownerId: string | null;
}

/** Crée l'écran (si nouveau) puis demande à la TV d'adopter ce nom. */
export async function pairTv(code: string, t: PairTarget) {
  if (!t.replace) {
    const existing = must(await sbClient.from('screens_config').select('id').eq('id', t.name).maybeSingle());
    if (existing.data) throw new Error('Ce nom est déjà utilisé');
    const row: Record<string, unknown> = {
      id: t.name,
      configuration_id: t.config?.id ?? null,
      pos_x: t.x,
      pos_y: t.y,
      total_cols: t.cols,
      total_rows: t.rows,
      video_url: t.sibling?.video_url ?? '',
      audio_url: t.sibling?.audio_url ?? '',
      rotation: t.rotation,
    };
    if (t.sibling?.opening_time) row.opening_time = t.sibling.opening_time;
    if (t.sibling?.closing_time) row.closing_time = t.sibling.closing_time;
    if (t.ownerId) row.user_id = t.ownerId;
    must(await sbClient.from('screens_config').insert(row));
  } else {
    // Une ancienne commande restée sur l'écran remplacé ne doit pas être rejouée par la nouvelle TV.
    must(await sbClient.from('screens_config').update({ command: null, command_id: null, rotation: t.rotation }).eq('id', t.name));
  }
  must(
    await sbClient
      .from('screens_config')
      .update({ command: `adopt:${t.name}`, command_id: crypto.randomUUID(), command_at: new Date().toISOString() })
      .eq('id', pairingId(code)),
  );
}

/** Attend que la TV redémarre sous son nouveau nom (au plus ~75 s). */
export async function waitForTv(name: string, since: number, previousBoot: string | null, signal: { cancelled: boolean }): Promise<boolean> {
  const before = Date.parse(previousBoot || '') || 0;
  for (let i = 0; i < 30 && !signal.cancelled; i++) {
    await new Promise(r => setTimeout(r, 2500));
    const { data } = await sbClient.from('screens_config').select('booted_at').eq('id', name).maybeSingle();
    // Marge de 2 min : l'horloge de la TV peut être légèrement en retard sur celle du téléphone.
    // Remplacement : il faut un démarrage plus récent que celui de l'ancienne TV.
    const boot = Date.parse(data?.booted_at || '') || 0;
    if (boot > since - 120_000 && boot > before) return true;
  }
  return false;
}

/**
 * Dernier mur utilisé pour connecter une TV (2 h) : en scannant les TV l'une après l'autre,
 * chaque scan rouvre l'app sur le même mur, à la place libre suivante.
 */
const WALL_KEY = 'synk-pair-wall';
export function rememberWall(groupId: string, configId: string) {
  try {
    localStorage.setItem(WALL_KEY, JSON.stringify({ groupId, configId, at: Date.now() }));
  } catch {
    /* stockage indisponible : on ne retient rien */
  }
}
export function recallWall(): { groupId: string; configId: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(WALL_KEY) || 'null');
    return v && Date.now() - v.at < 2 * 3600_000 ? { groupId: v.groupId, configId: v.configId } : null;
  } catch {
    return null;
  }
}

/** Retire la ligne provisoire une fois la TV connectée. */
export const removeWaitingTv = (code: string) => sbClient.from('screens_config').delete().eq('id', pairingId(code)).is('configuration_id', null);

/** Ménage (admin) : lignes provisoires de TV éteintes depuis plus d'un jour. Une TV encore allumée se ré-annonce seule. */
export async function pruneWaitingTvs(rows: WaitingTv[]) {
  const limit = Date.now() - 24 * 3600_000;
  const stale = rows.filter(r => (Date.parse(r.last_ping || '') || 0) < limit).map(r => r.id);
  if (stale.length) await sbClient.from('screens_config').delete().in('id', stale).is('configuration_id', null);
}
