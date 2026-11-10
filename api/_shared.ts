// Outils communs aux fonctions serveur (fichier préfixé « _ » : Vercel ne l'expose pas comme route).

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qterhrrgommazueinntd.supabase.co';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

/** Variables Vercel manquantes (le jeton de renouvellement peut aussi venir de la base). */
export function missingEnv() {
  return ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !process.env[k]);
}

/** Aide au diagnostic : NOMS des variables Supabase/Dropbox visibles (jamais leurs valeurs). */
export function visibleEnvNames() {
  return Object.keys(process.env).filter(k => /SUPABASE|DROPBOX/i.test(k)).sort();
}

const service = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: key, Authorization: `Bearer ${key}` };
};

/** Vérifie que l'appel vient d'un admin connecté (jeton de session Supabase). Renvoie une Response d'erreur sinon. */
export async function requireAdmin(request: Request): Promise<Response | null> {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return json({ error: 'unauthorized' }, 401);
  const user = (await userRes.json()) as { id: string; app_metadata?: { role?: string }; user_metadata?: { role?: string } };

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, { headers: service() });
  const rows = profileRes.ok ? ((await profileRes.json()) as { role?: string }[]) : [];
  const isAdmin = rows[0]?.role === 'admin' || user.app_metadata?.role === 'super_admin' || user.user_metadata?.role === 'super_admin';
  return isAdmin ? null : json({ error: 'forbidden' }, 403);
}

export async function readSetting(key: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`, { headers: service() });
  if (!res.ok) return null;
  const rows = (await res.json()) as { value: string }[];
  return rows[0]?.value ?? null;
}

export async function writeSetting(key: string, value: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings`, {
    method: 'POST',
    headers: { ...service(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  return res.ok;
}

export const dropboxBasicAuth = () => `Basic ${btoa(`${process.env.DROPBOX_APP_KEY}:${process.env.DROPBOX_APP_SECRET}`)}`;
