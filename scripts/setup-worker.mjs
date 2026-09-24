import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  const template = await readFile('.dev.vars.example', 'utf8');
  await writeFile(
    '.dev.vars',
    template.replace('APP_ENCRYPTION_KEY=', 'APP_ENCRYPTION_KEY=' + randomBytes(32).toString('base64')),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Created .dev.vars with a local encryption key. Add Google credentials and ALLOWED_OWNER_EMAIL.',
  );
} catch (error) {
  if (error.code === 'EEXIST') console.log('.dev.vars already exists; preserved unchanged.');
  else throw error;
}
