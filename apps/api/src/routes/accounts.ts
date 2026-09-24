import { Router } from 'express';
import { config } from '../config.js';
import { loadDb } from '../lib/store.js';

export const accountsRouter = Router();

accountsRouter.get('/', async (_req, res) => {
  const db = await loadDb();
  res.json({
    accounts: db.accounts,
    readiness: {
      googleConfigured: Boolean(config.googleClientId && config.googleClientSecret),
      facebookConfigured: Boolean(config.facebookAppId && config.facebookAppSecret),
      instagramConfigured: Boolean(config.instagramAppId && config.instagramAppSecret),
      publicMediaUrlConfigured: Boolean(config.publicBaseUrl),
      publicBaseUrl: config.publicBaseUrl || null
    }
  });
});
