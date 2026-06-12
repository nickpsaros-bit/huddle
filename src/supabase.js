import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fhhnmxrqklgwsjffkcex.supabase.co'
const supabaseKey = 'sb_publishable_q8G8GHAQIWUNHVnqrHdgiw_HN4vJOGV'

export const supabase = createClient(supabaseUrl, supabaseKey)
