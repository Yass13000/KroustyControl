import { createClient } from '@supabase/supabase-js'

const SB_URL = "https://qterhrrgommazueinntd.supabase.co"
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0ZXJocnJnb21tYXp1ZWlubnRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg4MzEwNywiZXhwIjoyMDkyNDU5MTA3fQ.UxuMyrex3ZxGp-s1WWr_bJ-aTv24vmOb9mumw27pLUA"

/** Client de CONNEXION : gère la session de l'utilisateur (login, logout, identité). */
export const sbAuth = createClient(SB_URL, SB_KEY)

/**
 * Client de DONNÉES : sans session, il garde l'accès complet de la clé du projet
 * et n'est donc pas filtré par les règles RLS liées au compte connecté.
 * Le périmètre de chacun (admin = tout, user = ses restaurants) est appliqué par l'app (voir lib/data.ts).
 * ⚠️ Avant commercialisation : passer à la clé anon + règles RLS (supabase/migrations).
 */
export const sbClient = createClient(SB_URL, SB_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: 'krousty-data',
  },
})
