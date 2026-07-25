import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const config = window.MICOLPE_CONFIG;

if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
  throw new Error('Configuration Supabase Micolpe introuvable.');
}

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseAnonKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'micolpe-portal-auth',
    },
  },
);
