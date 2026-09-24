import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: 'wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations('apps/worker/migrations'),
          APP_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          ALLOWED_OWNER_EMAIL: 'owner@example.com',
          APP_ORIGIN: 'http://localhost:5173',
          LOCAL_UPLOADS: 'true',
        },
      },
    }),
  ],
  test: { include: ['apps/worker/tests/**/*.test.ts'], fileParallelism: false },
}));
