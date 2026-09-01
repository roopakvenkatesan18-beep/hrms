export default function handler(request, response) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url || '') || !key) {
    return response.status(503).type('application/javascript').send('throw new Error("Application configuration is unavailable.");\n');
  }
  response.setHeader('Cache-Control', 'public, max-age=300');
  response.type('application/javascript').send(`const APP_CONFIG = Object.freeze(${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }).replace(/</g, '\\u003c')});\n`);
}
