# Envoi des vidéos vers Dropbox — configuration (une seule fois)

Gratuit, sans carte bancaire. Compter environ 10 minutes.

## 1. Créer l'app Dropbox
1. Aller sur https://www.dropbox.com/developers/apps (connecté avec le compte Dropbox qui héberge les vidéos).
2. **Create app** → **Scoped access** → **App folder** → nom : `KroustyControl`.
   Les vidéos envoyées iront dans `Applications/KroustyControl/videos`. L'app n'aura accès qu'à ce dossier.
3. Onglet **Permissions** : cocher
   - `account_info.read`
   - `files.content.read`
   - `files.content.write`
   - `sharing.read`
   - `sharing.write`

   puis **Submit**.
4. Onglet **Settings** : noter l'**App key** et l'**App secret**.

## 2. Obtenir le jeton de renouvellement (refresh token)
1. Ouvrir dans le navigateur (remplacer `APP_KEY`) :
   `https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&token_access_type=offline&response_type=code`
2. Autoriser, puis copier le **code** affiché.
3. Dans un terminal (remplacer `APP_KEY`, `APP_SECRET`, `CODE`) :

   ```bash
   curl https://api.dropboxapi.com/oauth2/token -d code=CODE -d grant_type=authorization_code -u APP_KEY:APP_SECRET
   ```

4. Dans la réponse, copier la valeur de `refresh_token`. Elle ne change plus ensuite.

## 3. Renseigner Vercel
Vercel → projet **krousty-control** → **Settings** → **Environment Variables** (Production), ajouter :

| Nom | Valeur |
|---|---|
| `DROPBOX_APP_KEY` | App key |
| `DROPBOX_APP_SECRET` | App secret |
| `DROPBOX_REFRESH_TOKEN` | refresh_token |
| `SUPABASE_URL` | `https://qterhrrgommazueinntd.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | clé « service_role » (Supabase → Settings → API) |

Puis **Deployments → Redeploy** pour prendre en compte les variables.

## Fonctionnement
- L'app demande à `/api/dropbox-token` un accès temporaire (≈ 4 h). Seuls les comptes **admin** l'obtiennent.
- La vidéo part **directement du navigateur vers Dropbox** (morceaux de 8 Mo) : rien ne passe par Vercel ni Supabase.
- Le lien de lecture est créé automatiquement et la vidéo ajoutée à la bibliothèque.
- L'espace Dropbox utilisé s'affiche dans la fenêtre d'envoi (en rouge au-delà de 90 %).
- L'ajout par lien (Dropbox, Drive…) reste disponible dans l'onglet **Lien**.
