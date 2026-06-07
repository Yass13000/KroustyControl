import { createClient } from '@supabase/supabase-js'

const SB_URL = "https://qterhrrgommazueinntd.supabase.co"
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0ZXJocnJnb21tYXp1ZWlubnRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg4MzEwNywiZXhwIjoyMDkyNDU5MTA3fQ.UxuMyrex3ZxGp-s1WWr_bJ-aTv24vmOb9mumw27pLUA"

export const sbClient = createClient(SB_URL, SB_KEY)
