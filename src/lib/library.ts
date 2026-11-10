// Droits sur la bibliothèque vidéo : chaque dossier appartient à un restaurant (ou à la bibliothèque commune).
import type { Album, Group } from './types';

export const COMMON = 'common';

export function libraryAccess(isSuperAdmin: boolean, groups: Group[]) {
  const mine = new Set(groups.map(g => g.id));
  return {
    /** Visible : dossiers de mes restaurants + bibliothèque commune (l'admin voit tout). */
    canSee: (a: Album) => isSuperAdmin || !a.group_id || mine.has(a.group_id),
    /** Modifiable : dossiers de mes restaurants (la bibliothèque commune est réservée à l'admin). */
    canManage: (a: Album | undefined | null) => !!a && (isSuperAdmin || (!!a.group_id && mine.has(a.group_id))),
    /** Peut créer un dossier : l'admin, ou un gérant qui a au moins un restaurant. */
    canCreate: isSuperAdmin || groups.length > 0,
  };
}

/** Dossiers proposés pour un mur : ceux de son (ses) restaurant(s) + la bibliothèque commune. */
export const albumsForGroups = (albums: Album[], groupIds: Set<string>) => albums.filter(a => !a.group_id || groupIds.has(a.group_id));

/** Nom affiché du propriétaire d'un dossier. */
export const ownerLabel = (a: Album, groups: Group[]) => (a.group_id ? groups.find(g => g.id === a.group_id)?.name || 'Restaurant' : 'Commune');
