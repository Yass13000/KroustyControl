# Envoi des vidéos vers Dropbox — configuration (une seule fois)

Gratuit, sans carte bancaire, sans ligne de commande. Compter environ 5 minutes.

## 1. Créer l'app Dropbox
1. Aller sur https://www.dropbox.com/developers/apps (connecté avec le compte Dropbox qui héberge les vidéos).
2. **Create app** → **Scoped access** → **App folder** → nom au choix (ex. `SynKwall`).
   Les vidéos envoyées iront dans `Applications/<nom de l'app>/videos` ; l'app n'a accès qu'à ce dossier.
3. Onglet **Permissions** : cocher `account_info.read`, `files.content.read`, `files.content.write`,
   `sharing.read`, `sharing.write`, puis **Submit**.
4. Onglet **Settings** : noter l'**App key** et l'**App secret**.
   ⚠️ Ne jamais partager l'App secret (message, capture…). S'il a circulé, en générer un nouveau.

## 2. Supabase (une fois)
Exécuter `supabase/migrations/20261111_app_settings.sql` dans Supabase → SQL Editor.

## 3. Vercel (une fois)
Vercel → projet **krousty-control** → **Settings** → **Environment Variables** (Production) :

| Nom | Valeur |
|---|---|
| `DROPBOX_APP_KEY` | App key |
| `DROPBOX_APP_SECRET` | App secret |
| `SUPABASE_SERVICE_ROLE_KEY` | clé « service_role » (Supabase → Settings → API) |

Puis **Deployments → Redeploy**.

## 4. Dans l'app
Vidéos → un dossier → **+** → onglet **Fichier** :
1. **Autoriser dans Dropbox** → accepter → copier le code affiché.
2. Le coller dans **Coller le code** → **OK**.

C'est fini : l'envoi direct est actif (l'espace Dropbox utilisé s'affiche en haut de la fenêtre).

## Fonctionnement
- L'app demande à `/api/dropbox-token` un accès temporaire (≈ 4 h), réservé aux comptes **admin**.
- La vidéo part **directement du navigateur vers Dropbox** (morceaux de 8 Mo) : rien ne passe par Vercel ni Supabase.
- Le lien de lecture et la miniature sont créés automatiquement.
- L'ajout par lien (Dropbox, Drive…) reste disponible dans l'onglet **Lien**.
