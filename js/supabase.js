/* ============================================================
   CADD Tech HRMS — Supabase Client Initialization
   Public configuration served by the application server
   ============================================================ */

const SUPABASE_URL = APP_CONFIG.supabaseUrl;
const SUPABASE_ANON_KEY = APP_CONFIG.supabaseAnonKey;

// Initialize Supabase client
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
