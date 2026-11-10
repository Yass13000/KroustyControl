// Versions du lecteur TV : envoi de l'APK sur Supabase Storage et déploiement sur les écrans.
import { SB_KEY, SB_URL, sbClient } from './supabase';
import { mustAll } from './data';
import type { ApkInfo } from './apk';
import type { AppScreen } from './types';

const BUCKET = 'player';
const KEEP = 3; // nombre de versions conservées dans le stockage

/** Code de version d'un écran, lu dans player_version (« 1.2 (3) »). */
export const screenVersionCode = (s: AppScreen) => {
  const m = (s.player_version || '').match(/\((\d+)\)/);
  return m ? Number(m[1]) : null;
};

/** Étape de mise à jour d'un écran, en clair. */
export function updateStatus(s: AppScreen, online: boolean): { label: string; tone: 'done' | 'progress' | 'waiting' | 'failed' | 'offline' } {
  const target = s.latest_version_code || 0;
  const current = screenVersionCode(s);
  if (current !== null && current >= target) return { label: 'À jour', tone: 'done' };
  const st = s.update_state || '';
  if (st.startsWith('failed')) return { label: `Échec${st.length > 7 ? ` : ${st.slice(8)}` : ''}`, tone: 'failed' };
  if (st === 'downloading') return { label: 'Téléchargement', tone: 'progress' };
  if (st === 'installing') return { label: 'Installation', tone: 'progress' };
  if (st === 'waiting_user') return { label: 'Clic « Installer » requis sur la TV', tone: 'waiting' };
  if (!online) return { label: 'Hors ligne', tone: 'offline' };
  return { label: current === null ? 'En attente (ancien lecteur)' : 'En attente', tone: 'waiting' };
}

/** Envoie l'APK dans le stockage Supabase (avec progression) et renvoie son adresse publique. */
export function uploadApk(file: File, info: ApkInfo, onProgress: (p: number) => void): Promise<string> {
  const path = `releases/synk-player-${info.versionName || 'v'}-${info.versionCode}-${Date.now()}.apk`.replace(/[^a-zA-Z0-9/._-]/g, '-');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SB_URL}/storage/v1/object/${BUCKET}/${path}`);
    xhr.setRequestHeader('apikey', SB_KEY);
    xhr.setRequestHeader('Authorization', `Bearer ${SB_KEY}`);
    xhr.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(`${SB_URL}/storage/v1/object/public/${BUCKET}/${path}`);
      else reject(new Error(xhr.status === 404 || /bucket/i.test(xhr.responseText) ? 'Stockage « player » absent : exécuter 20261111_player_updates.sql' : `Envoi refusé (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Envoi impossible (réseau)'));
    xhr.send(file);
  });
}

/** Désigne la version cible sur les écrans choisis : chaque lecteur la récupère à sa prochaine synchro. */
export async function deployRelease(screenIds: string[], info: ApkInfo, url: string) {
  await mustAll(
    screenIds.map(id =>
      sbClient
        .from('screens_config')
        .update({ latest_version_code: info.versionCode, apk_url: url, apk_sha256: info.sha256, update_state: null })
        .eq('id', id),
    ),
  );
}

/** Ne garde que les dernières versions dans le stockage (jamais celles encore utilisées par un écran). */
export async function pruneReleases(inUse: string[]) {
  const { data } = await sbClient.storage.from(BUCKET).list('releases', { sortBy: { column: 'created_at', order: 'desc' }, limit: 100 });
  if (!data) return;
  const old = data.slice(KEEP).map(f => `releases/${f.name}`).filter(p => !inUse.some(u => u.endsWith(p)));
  if (old.length) await sbClient.storage.from(BUCKET).remove(old);
}
