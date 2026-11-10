/**
 * Fonction serveur Vercel : remet un accès Dropbox temporaire (≈ 4 h) à un admin connecté.
 * Les secrets Dropbox ne quittent jamais le serveur ; l'accès est limité au dossier de l'app.
 *
 * Variables Vercel : DROPBOX_APP_KEY, DROPBOX_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY.
 * Jeton de renouvellement : DROPBOX_REFRESH_TOKEN (Vercel) ou enregistré par « Connecter Dropbox ».
 */
import { dropboxBasicAuth, json, missingEnv, readSetting, requireUploader, visibleEnvNames } from './_shared.js';

export async function POST(request: Request): Promise<Response> {
  const missing = missingEnv();
  if (missing.length) return json({ error: 'not_configured', missing, visible: visibleEnvNames() }, 503);

  const denied = await requireUploader(request);
  if (denied) return denied;

  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN || (await readSetting('dropbox_refresh_token'));
  if (!refreshToken) return json({ error: 'not_connected' }, 409);

  const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: dropboxBasicAuth() },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!tokenRes.ok) return json({ error: 'dropbox_auth', detail: await tokenRes.text() }, 502);

  const token = (await tokenRes.json()) as { access_token: string; expires_in: number };
  return json({ access_token: token.access_token, expires_in: token.expires_in });
}
