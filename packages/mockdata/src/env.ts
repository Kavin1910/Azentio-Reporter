import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env reader. Deliberately not a dependency: the seed script runs once
 * against a database and does not warrant pulling dotenv into the workspace.
 */
export function loadEnv(file = resolve(process.cwd(), '../../.env')): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {};
  }

  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function requireEnv(env: Record<string, string>, keys: string[]): Record<string, string> {
  const merged = { ...env, ...process.env } as Record<string, string>;
  const missing = keys.filter((k) => !merged[k]);

  if (missing.length > 0) {
    console.error(
      `\nMissing required environment variable(s): ${missing.join(', ')}\n\n` +
        `Add them to .env at the repository root. The service role key is under\n` +
        `Supabase → Project Settings → API → service_role. It bypasses RLS, so keep\n` +
        `it out of the apps and out of version control.\n`,
    );
    process.exit(1);
  }

  return merged;
}
