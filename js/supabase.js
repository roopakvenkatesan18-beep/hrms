/* ============================================================
   CADD Tech HRMS — Supabase Client Initialization
   Public configuration served by the application server
   ============================================================ */

if (typeof APP_CONFIG === 'undefined') {
  throw new Error('Supabase configuration failed to load. Check the Vercel environment variables.');
}

const SUPABASE_URL = APP_CONFIG.supabaseUrl;
const SUPABASE_ANON_KEY = APP_CONFIG.supabaseAnonKey;

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
