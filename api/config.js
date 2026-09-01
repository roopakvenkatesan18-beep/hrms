export default function handler(request, response) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url || '') || !key) {
    response.statusCode = 503;
    response.end('throw new Error("Application configuration is unavailable.");\n');
    return;
  }
  response.setHeader('Cache-Control', 'public, max-age=300');
  response.statusCode = 200;
  response.end(`const APP_CONFIG = Object.freeze(${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: key }).replace(/</g, '\\u003c')});\n`);
}
