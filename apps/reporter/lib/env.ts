import 'server-only';

/**
 * Fail loudly at startup when the deployment is missing configuration, instead
 * of failing quietly on the first request that needs it.
 */
const REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const;
const OPTIONAL = ['OPENROUTER_KEY', 'SOURCE_ENCRYPTION_KEY'] as const;

let checked = false;
export function checkEnv(): void {
  if (checked) return;
  checked = true;
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing required environment: ${missing.join(', ')}`);
  for (const k of OPTIONAL.filter((k) => !process.env[k])) {
    console.warn(`[env] ${k} is not set — ${k === 'OPENROUTER_KEY' ? 'the assistant and model-assisted naming are disabled' : 'saving database passwords is disabled'}.`);
  }
}
