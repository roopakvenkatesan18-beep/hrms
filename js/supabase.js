/* ============================================================
   CADD Tech HRMS — Supabase Client Initialization
   ============================================================ */

const SUPABASE_URL = 'https://avsraadmqupkssdxpkzu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2c3JhYWRtcXVwa3NzZHhwa3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDEwODgsImV4cCI6MjA5ODExNzA4OH0.eJIssGkKs4UZj7Sjo0PMeaeM1qAN1kQCUeQuWP_qtXM';

// Initialize Supabase client
// The supabase-js library is loaded via CDN in the HTML <head>
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
