import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { createGoogleOAuthClient, GOOGLE_SCOPES, saveGoogleGrant, disconnectYouTube } from '../integrations/youtube.js';
import { disconnectFacebook, exchangeFacebookCode, facebookLoginUrl } from '../integrations/meta.js';
import { disconnectInstagram, exchangeInstagramCode, instagramLoginUrl } from '../integrations/instagram.js';

export const oauthRouter = Router();

function state() { return randomBytes(24).toString('hex'); }
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: false, maxAge: 10 * 60 * 1000 };

oauthRouter.get('/google/start', (req, res) => {
  try {
    const s = state();
    res.cookie('pp_google_state', s, cookieOptions);
    const client = createGoogleOAuthClient();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_SCOPES,
      state: s
    });
    res.redirect(url);
  } catch (error: any) {
    res.redirect(`${config.appOrigin}/accounts?error=${encodeURIComponent(error?.message || String(error))}`);
  }
});

oauthRouter.get('/google/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const s = String(req.query.state || '');
    if (!code || !s || s !== req.cookies.pp_google_state) throw new Error('Google OAuth state check failed. Please try connecting again.');
    const client = createGoogleOAuthClient();
    const { tokens } = await client.getToken(code);
    await saveGoogleGrant(tokens);
    res.clearCookie('pp_google_state');
    res.redirect(`${config.appOrigin}/accounts?connected=youtube`);
  } catch (error: any) {
    res.redirect(`${config.appOrigin}/accounts?error=${encodeURIComponent(error?.message || String(error))}`);
  }
});

oauthRouter.get('/facebook/start', (req, res) => {
  try {
    const s = state();
    res.cookie('pp_facebook_state', s, cookieOptions);
    res.redirect(facebookLoginUrl(s));
  } catch (error: any) {
    res.redirect(`${config.appOrigin}/accounts?error=${encodeURIComponent(error?.message || String(error))}`);
  }
});

oauthRouter.get('/facebook/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const s = String(req.query.state || '');
    if (!code || !s || s !== req.cookies.pp_facebook_state) throw new Error('Facebook OAuth state check failed. Please try connecting again.');
    await exchangeFacebookCode(code);
    res.clearCookie('pp_facebook_state');
    res.redirect(`${config.appOrigin}/accounts?connected=facebook`);
  } catch (error: any) {
    res.redirect(`${config.appOrigin}/accounts?error=${encodeURIComponent(error?.message || String(error))}`);
  }
});

oauthRouter.get('/instagram/start', (req, res) => {
  try {
    const s = state();
    res.cookie('pp_instagram_state', s, cookieOptions);
    res.redirect(instagramLoginUrl(s));
  } catch (error: any) {
    res.redirect(`${config.appOrigin}/accounts?error=${encodeURIComponent(error?.message || String(error))}`);
  }
});

oauthRouter.get('/instagram/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const s = String(req.query.state || '');
    if (!code || !s || s !== req.cookies.pp_instagram_state) throw new Error('Instagram OAuth state check failed. Please try connecting again.');
    await exchangeInstagramCode(code);
    res.clearCookie('pp_instagram_state');
    res.redirect(`${config.appOrigin}/accounts?connected=instagram`);
  } catch (error: any) {
    res.redirect(`${config.appOrigin}/accounts?error=${encodeURIComponent(error?.message || String(error))}`);
  }
});

oauthRouter.post('/google/disconnect', async (_req, res) => {
  await disconnectYouTube();
  res.json({ ok: true });
});

oauthRouter.post('/facebook/disconnect', async (_req, res) => {
  await disconnectFacebook();
  res.json({ ok: true });
});

oauthRouter.post('/instagram/disconnect', async (_req, res) => {
  await disconnectInstagram();
  res.json({ ok: true });
});
