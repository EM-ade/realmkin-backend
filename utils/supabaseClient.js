import { createClient } from '@supabase/supabase-js';

let cachedClient = null;

function ensureConfig() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase configuration is missing. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file.'
    );
  }
}

function createSupabaseClient(options = {}) {
  ensureConfig();
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      ...options,
    }
  );
  return client;
}

export function getSupabaseClient(options = {}) {
  if (!cachedClient) {
    cachedClient = createSupabaseClient(options);
  }
  return cachedClient;
}

export { createSupabaseClient };
