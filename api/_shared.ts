// Outils communs aux fonctions serveur (fichier préfixé « _ » : Vercel ne l'expose pas comme route).

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qterhrrgommazueinntd.supabase.co';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Variables Vercel manquantes (le jeton de renouvellement peut aussi venir de la base). */
export function missingEnv() {
  return ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !(process.env[k] || '').trim());
}

/** Aide au diagnostic : NOMS des variables Supabase/Dropbox visibles (jamais leurs valeurs). */
export function visibleEnvNames() {
  return Object.keys(process.env).filter(k => /SUPABASE|DROPBOX/i.test(k)).sort();
}

/**
 * En-têtes d'accès « service ». Deux formats de clé existent chez Supabase :
 *  - ancienne clé service_role (JWT « eyJ… ») : apikey + Authorization ;
 *  - nouvelle clé secrète (« sb_secret_… ») : uniquement l'en-tête apikey (ce n'est pas un JWT).
 */
const service = (): Record<string, string> => {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
};

/** Identifie l'appelant (jeton de session Supabase) : admin ou gérant d'au moins un restaurant. */
async function caller(request: Request): Promise<{ isAdmin: boolean; ownsRestaurant: boolean } | Response> {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return json({ error: 'unauthorized' }, 401);
  const user = (await userRes.json()) as { id: string; app_metadata?: { role?: string }; user_metadata?: { role?: string } };
  const id = encodeURIComponent(user.id);

  const [profileRes, groupsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}&select=role`, { headers: service() }),
    fetch(`${SUPABASE_URL}/rest/v1/groups?user_id=eq.${id}&select=id&limit=1`, { headers: service() }),
  ]);
  const rows = profileRes.ok ? ((await profileRes.json()) as { role?: string }[]) : [];
  const groups = groupsRes.ok ? ((await groupsRes.json()) as unknown[]) : [];
  const isAdmin = rows[0]?.role === 'admin' || user.app_metadata?.role === 'super_admin' || user.user_metadata?.role === 'super_admin';
  return { isAdmin, ownsRestaurant: groups.length > 0 };
}

/** Réservé à l'admin (ex. connecter Dropbox). Renvoie une Response d'erreur sinon. */
export async function requireAdmin(request: Request): Promise<Response | null> {
  const c = await caller(request);
  if (c instanceof Response) return c;
  return c.isAdmin ? null : json({ error: 'forbidden' }, 403);
}

/** Envoi de vidéos : l'admin, ou un gérant qui a au moins un restaurant. */
export async function requireUploader(request: Request): Promise<Response | null> {
  const c = await caller(request);
  if (c instanceof Response) return c;
  return c.isAdmin || c.ownsRestaurant ? null : json({ error: 'forbidden' }, 403);
}

export async function readSetting(key: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, { headers: service() });
  if (!res.ok) return null;
  const rows = (await res.json()) as { value: string }[];
  return rows[0]?.value ?? null;
}

export async function writeSetting(key: string, value: string): Promise<{ ok: boolean; detail?: string }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
    method: 'POST',
    headers: { ...service(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  return res.ok ? { ok: true } : { ok: false, detail: `${res.status} ${(await res.text()).slice(0, 200)}` };
}

/** Valeur d'une variable Vercel sans espaces ni retours à la ligne collés par erreur. */
export const env = (name: string) => (process.env[name] || '').trim();

export const dropboxBasicAuth = () => `Basic ${btoa(`${env('DROPBOX_APP_KEY')}:${env('DROPBOX_APP_SECRET')}`)}`;
