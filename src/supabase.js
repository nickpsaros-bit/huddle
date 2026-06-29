import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fhhnmxrqklgwsjffkcex.supabase.co'
const supabaseKey = 'sb_publishable_q8G8GHAQIWUNHVnqrHdgiw_HN4vJOGV'

// persistSession + autoRefreshToken are ON by default, which is what keeps
// returning users logged in across visits. experimental.passkey enables the
// auth.registerPasskey() / signInWithPasskey() methods (beta — additive, the
// magic-link and Google flows are unaffected).
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    experimental: { passkey: true },
  },
})