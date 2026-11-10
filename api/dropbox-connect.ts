/**
 * « Connecter Dropbox » depuis l'app (admin uniquement), sans ligne de commande :
 *   GET  → adresse d'autorisation Dropbox à ouvrir
 *   POST { code } → échange le code contre un jeton de renouvellement, enregistré dans app_settings
 */
import { dropboxBasicAuth, env, json, missingEnv, requireAdmin, visibleEnvNames, writeSetting } from './_shared.js';

export async function GET(request: Request): Promise<Response> {
  const missing = missingEnv();
  if (missing.length) return json({ error: 'not_configured', missing, visible: visibleEnvNames() }, 503);
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  url.searchParams.set('client_id', env('DROPBOX_APP_KEY'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('token_access_type', 'offline');
  return json({ url: url.toString() });
}

export async function POST(request: Request): Promise<Response> {
  const missing = missingEnv();
  if (missing.length) return json({ error: 'not_configured', missing, visible: visibleEnvNames() }, 503);
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { code } = (await request.json().catch(() => ({}))) as { code?: string };
  if (!code || !code.trim()) return json({ error: 'missing_code' }, 400);

  const tokenRes = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: dropboxBasicAuth() },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code.trim() }),
  });
  if (!tokenRes.ok) {
    // Détail Dropbox renvoyé tel quel (ex. invalid_grant = code déjà utilisé/expiré, invalid_client = clé ou secret faux)
    const detail = await tokenRes.text();
    return json({ error: /invalid_client/.test(detail) ? 'invalid_client' : 'invalid_code', detail }, 400);
  }

  const token = (await tokenRes.json()) as { refresh_token?: string };
  if (!token.refresh_token) return json({ error: 'no_refresh_token' }, 502);
  const saved = await writeSetting('dropbox_refresh_token', token.refresh_token);
  if (!saved.ok) return json({ error: 'storage_failed', detail: saved.detail }, 500);
  return json({ ok: true });
}
