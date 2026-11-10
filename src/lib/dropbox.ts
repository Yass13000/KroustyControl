// Envoi des vidéos vers Dropbox directement depuis le navigateur.
// L'accès temporaire est délivré par la fonction serveur /api/dropbox-token (secrets côté Vercel).
// La vidéo ne transite ni par Vercel ni par Supabase : aucun quota consommé.

import { sbAuth } from './supabase';
import { transformStorageUrl } from './media';

const CHUNK = 8 * 1024 * 1024; // 8 Mo par morceau
const FOLDER = '/videos';

export type SetupState = 'offline' | 'not_configured' | 'not_connected';

export class DropboxSetupError extends Error {
  constructor(message: string, readonly state: SetupState) {
    super(message);
  }
}

let cached: { token: string; expiresAt: number } | null = null;

async function authHeaders() {
  const { data } = await sbAuth.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) throw new Error('Session expirée, reconnectez-vous');
  return { Authorization: `Bearer ${jwt}` };
}

/** Adresse Dropbox où autoriser l'app (étape 1 de « Connecter Dropbox »). */
export async function connectUrl(): Promise<string> {
  const res = await fetch('/api/dropbox-connect', { headers: await authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error('Impossible d’ouvrir Dropbox');
  return body.url;
}

/** Enregistre la connexion à partir du code affiché par Dropbox (étape 2). */
export async function connectWithCode(code: string) {
  const res = await fetch('/api/dropbox-connect', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      body.error === 'invalid_code'
        ? 'Code refusé ou expiré : recommencez l’autorisation'
        : body.error === 'storage_failed'
          ? 'Enregistrement refusé : vérifier SUPABASE_SERVICE_ROLE_KEY (clé service_role) dans Vercel'
          : body.error === 'forbidden'
            ? 'Réservé aux administrateurs'
            : body.error === 'not_configured'
              ? `Variable manquante dans Vercel : ${(body.missing || []).join(', ')}`
              : `Erreur ${res.status}`,
    );
  }
  cached = null;
}

/** Accès Dropbox temporaire (mis en cache jusqu'à 1 min avant expiration). */
async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  let res: Response;
  try {
    res = await fetch('/api/dropbox-token', { method: 'POST', headers: await authHeaders() });
  } catch {
    throw new DropboxSetupError('Service d’envoi injoignable', 'offline');
  }
  if (res.status === 404) throw new DropboxSetupError('Envoi disponible uniquement sur la version en ligne', 'offline');
  const body = await res.json().catch(() => ({}));
  if (res.status === 503) throw new DropboxSetupError('Clés Dropbox à ajouter dans Vercel', 'not_configured');
  if (res.status === 409) throw new DropboxSetupError('Dropbox à connecter', 'not_connected');
  if (res.status === 403) throw new Error('Réservé aux administrateurs');
  if (!res.ok) throw new Error(body.error === 'dropbox_auth' ? 'Accès Dropbox refusé : vérifier la configuration' : `Erreur ${res.status}`);

  cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cached.token;
}

/** En-tête Dropbox-API-Arg : JSON en ASCII strict (les accents doivent être échappés). */
const apiArg = (value: unknown) => JSON.stringify(value).replace(/[\u007f-￿]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

async function rpc<T>(endpoint: string, body: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === null ? {} : { 'Content-Type': 'application/json' }) },
    body: body === null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(data.error_summary || `Dropbox ${res.status}`), { data });
  return data as T;
}

async function content<T>(endpoint: string, arg: unknown, chunk: Blob): Promise<T> {
  const token = await getToken();
  const res = await fetch(`https://content.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': apiArg(arg), 'Content-Type': 'application/octet-stream' },
    body: chunk,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error_summary || `Dropbox ${res.status}`);
  return data as T;
}

/** Nom de fichier sûr (ASCII), unique grâce à l'horodatage. */
const safeName = (name: string) => {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${Date.now()}-${base || 'video.mp4'}`;
};

/**
 * Envoie un fichier dans Applications/KroustyControl/videos et renvoie son lien de lecture directe.
 * `onProgress` reçoit une valeur entre 0 et 1.
 */
export async function uploadVideo(file: File, onProgress: (p: number) => void, signal?: AbortSignal): Promise<string> {
  const path = `${FOLDER}/${safeName(file.name)}`;
  onProgress(0);

  let meta: { path_lower: string };
  if (file.size <= CHUNK) {
    meta = await content('files/upload', { path, mode: 'add', autorename: true, mute: true }, file);
  } else {
    const first = file.slice(0, CHUNK);
    const { session_id } = await content<{ session_id: string }>('files/upload_session/start', { close: false }, first);
    let offset = first.size;
    onProgress(offset / file.size);
    while (file.size - offset > CHUNK) {
      if (signal?.aborted) throw new Error('Envoi annulé');
      const chunk = file.slice(offset, offset + CHUNK);
      await content('files/upload_session/append_v2', { cursor: { session_id, offset }, close: false }, chunk);
      offset += chunk.size;
      onProgress(offset / file.size);
    }
    if (signal?.aborted) throw new Error('Envoi annulé');
    meta = await content(
      'files/upload_session/finish',
      { cursor: { session_id, offset }, commit: { path, mode: 'add', autorename: true, mute: true } },
      file.slice(offset),
    );
  }
  onProgress(1);

  // Lien partagé (réutilise l'existant si Dropbox en a déjà créé un)
  let url: string;
  try {
    url = (await rpc<{ url: string }>('sharing/create_shared_link_with_settings', { path: meta.path_lower })).url;
  } catch (err) {
    const existing = (err as { data?: { error?: { shared_link_already_exists?: { metadata?: { url: string } } } } }).data?.error?.shared_link_already_exists?.metadata?.url;
    if (existing) url = existing;
    else url = (await rpc<{ links: { url: string }[] }>('sharing/list_shared_links', { path: meta.path_lower, direct_only: true })).links[0]?.url;
  }
  if (!url) throw new Error('Lien Dropbox introuvable');
  return transformStorageUrl(url);
}

/** Espace Dropbox utilisé / disponible (octets). */
export async function spaceUsage(): Promise<{ used: number; allocated: number }> {
  const r = await rpc<{ used: number; allocation: { allocated?: number } }>('users/get_space_usage', null);
  return { used: r.used, allocated: r.allocation.allocated || 0 };
}
