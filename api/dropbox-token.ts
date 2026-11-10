/**
 * Fonction serveur Vercel : remet un accès Dropbox temporaire (≈ 4 h) à un admin connecté.
 *
 * Les secrets Dropbox ne quittent jamais le serveur. L'accès remis est limité au
 * « dossier de l'app » (Applications/KroustyControl) grâce au type d'app Dropbox choisi.
 *
 * Variables d'environnement Vercel requises :
 *   DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export async function POST(request: Request): Promise<Response> {
  const env = process.env;
  const required = ['DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'DROPBOX_REFRESH_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(k => !env[k]);
  if (missing.length) return json({ error: 'not_configured', missing }, 503);

  const supabaseUrl = env.SUPABASE_URL!;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY!;

  // 1. Qui appelle ? (jeton de session Supabase de l'utilisateur connecté)
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return json({ error: 'unauthorized' }, 401);
  const user = (await userRes.json()) as { id: string; app_metadata?: { role?: string }; user_metadata?: { role?: string } };

  // 2. Est-ce un admin ?
  const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const rows = profileRes.ok ? ((await profileRes.json()) as { role?: string }[]) : [];
  const isAdmin = rows[0]?.role === 'admin' || user.app_metadata?.role === 'super_admin' || user.user_metadata?.role === 'super_admin';
  if (!isAdmin) return json({ error: 'forbidden' }, 403);

  // 3. Accès Dropbox temporaire à partir du jeton de renouvellement
  const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${env.DROPBOX_APP_KEY}:${env.DROPBOX_APP_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.DROPBOX_REFRESH_TOKEN! }),
  });
  if (!tokenRes.ok) return json({ error: 'dropbox_auth', detail: await tokenRes.text() }, 502);

  const token = (await tokenRes.json()) as { access_token: string; expires_in: number };
  return json({ access_token: token.access_token, expires_in: token.expires_in });
}
