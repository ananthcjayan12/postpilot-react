import { mkdtemp, writeFile, rm, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { secretNames, validate } from './config.mjs';
validate(process.env);
const state = JSON.parse(await readFile('.cloudflare-state.json', 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'postpilot-secrets-'));
try {
  const path = join(directory, 'secrets.json');
  const secrets = Object.fromEntries(
    secretNames.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
  );
  await writeFile(path, JSON.stringify(secrets), { mode: 0o600 });
  const result = spawnSync(
    'npx',
    ['--no-install', 'wrangler', 'deploy', '--config', 'wrangler.generated.json', '--secrets-file', path],
    { stdio: 'inherit', env: process.env },
  );
  if (result.error || result.status !== 0)
    throw new Error('Worker deployment failed. Review Wrangler diagnostics.');
  const missing = [
    !secrets.GOOGLE_CLIENT_ID && 'Google sign-in / YouTube credentials not supplied',
    !secrets.META_APP_ID && 'Meta credentials not supplied',
    !secrets.R2_ACCESS_KEY_ID && 'R2 upload signing credentials not supplied',
  ].filter(Boolean);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `\nDeployment completed: ${state.origin}\n\n${missing.map((x) => `- ${x}; existing Worker secrets, if any, are retained.`).join('\n')}\n`,
    );
} finally {
  await rm(directory, { recursive: true, force: true });
}
