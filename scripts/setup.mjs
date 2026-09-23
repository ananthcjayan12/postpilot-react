import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = resolve(root, '.env.example');
const envPath = resolve(root, '.env');

if (existsSync(envPath)) {
  console.log('.env already exists; leaving it unchanged.');
  process.exit(0);
}

let env = readFileSync(examplePath, 'utf8');
const key = randomBytes(32).toString('base64');
env = env.replace('APP_ENCRYPTION_KEY=\n', `APP_ENCRYPTION_KEY=${key}\n`);
writeFileSync(envPath, env);
console.log('Created .env with a fresh encryption key.');
console.log('Next: add your Google and Meta app credentials to .env.');
