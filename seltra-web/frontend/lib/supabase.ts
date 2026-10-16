import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null

export function getSupabase() {
  if (browserClient) return browserClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }

  browserClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'seltra-supabase-auth',
    },
  })

  return browserClient
}

export function storeSeltraSession(input: {
  access_token: string
  user: unknown
}) {
  localStorage.setItem('seltra:token', input.access_token)
  localStorage.setItem('seltra:user', JSON.stringify(input.user))
}

export function clearSeltraSession() {
  ;['seltra:token', 'seltra:user', 'seltra:active_store'].forEach((key) => localStorage.removeItem(key))
}
