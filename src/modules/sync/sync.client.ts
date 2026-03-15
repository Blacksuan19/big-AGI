import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { useSyncStore } from './store-sync';

let _cachedClient: SupabaseClient | null = null;
let _cachedUrl = '';
let _cachedKey = '';

export function getSyncClient(): SupabaseClient | null {
  const { supabaseUrl, supabaseAnonKey } = useSyncStore.getState();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  if (_cachedClient && _cachedUrl === supabaseUrl && _cachedKey === supabaseAnonKey) return _cachedClient;

  _cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  _cachedUrl = supabaseUrl;
  _cachedKey = supabaseAnonKey;
  return _cachedClient;
}

export function clearSyncClient(): void {
  _cachedClient = null;
  _cachedUrl = '';
  _cachedKey = '';
}
