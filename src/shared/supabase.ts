import type { Database } from './database.types';
import { isPublicKey } from './public-config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
let client: SupabaseClient<Database> | undefined;

export function getSupabase() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error('Задайте публичные параметры Supabase.');
  if (!isPublicKey(key)) throw new Error('Требуется публичный ключ Supabase.');
  client = createClient<Database>(url, key, { db: { timeout: 10_000 } });
  return client;
}
