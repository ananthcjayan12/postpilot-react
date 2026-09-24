import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Context, Next } from 'hono';
import type { AppEnv } from './env';
import { AppError, random, hash, now, providerJson, encryptionKey } from './lib';
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export const auth = new Hono<AppEnv>();
export function secure(c: Context<AppEnv>) {
  return new URL(c.env.APP_ORIGIN).protocol === 'https:';
}
export function cookieOptions(c: Context<AppEnv>) {
  return { httpOnly: true, secure: secure(c), sameSite: 'Lax' as const, path: '/' };
}
export async function requireSession(c: Context<AppEnv>, next: Next) {
  const token = getCookie(c, 'pp_session');
  if (!token) throw new AppError('Sign in to continue.', 401);
  const session = await c.env.DB.prepare(
    'SELECT u.id,u.email,u.name,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
  )
    .bind(await hash(token), Date.now())
    .first<{ id: string; email: string; name: string; csrf: string }>();
  if (!session || !ownerAllowed(c.env.ALLOWED_OWNER_EMAIL, session.email))
    throw new AppError('Session expired or access revoked.', 401);
  c.set('user', session);
  c.set('csrf', session.csrf);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('Origin') !== c.env.APP_ORIGIN || c.req.header('X-CSRF-Token') !== session.csrf)
      throw new AppError('Invalid request origin or CSRF token.', 403);
  }
  await next();
}
export function ownerAllowed(allowlist: string | undefined, email: string) {
  return !!allowlist
    ?.split(',')
    .map((x) => x.trim().toLowerCase())
    .includes(email.toLowerCase());
}
export async function startState(c: Context<AppEnv>, kind: string, user: string | null = null) {
  const state = random(),
    nonce = random(),
    verifier = random();
  await c.env.DB.prepare(
    'INSERT INTO oauth_states(id,kind,user_id,nonce,verifier,expires_at) VALUES(?,?,?,?,?,?)',
  )
    .bind(await hash(state), kind, user, nonce, verifier, Date.now() + 600000)
    .run();
  setCookie(c, `pp_state_${kind}`, state, { ...cookieOptions(c), maxAge: 600 });
  return { state, nonce, verifier };
}
export async function consumeState(c: Context<AppEnv>, kind: string) {
  const state = c.req.query('state');
  if (!state || state !== getCookie(c, `pp_state_${kind}`))
    throw new AppError('OAuth state check failed. Start again.', 400);
  const row = await c.env.DB.prepare(
    'DELETE FROM oauth_states WHERE id=? AND kind=? AND expires_at>? RETURNING *',
  )
    .bind(await hash(state), kind, Date.now())
    .first<{ user_id: string | null; nonce: string; verifier: string }>();
  deleteCookie(c, `pp_state_${kind}`, cookieOptions(c));
  if (!row) throw new AppError('OAuth state expired or already used.', 400);
  return row;
}
auth.get('/google/start', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET || !c.env.ALLOWED_OWNER_EMAIL)
    throw new AppError(
      'Studio sign-in is not configured. Add Google credentials and ALLOWED_OWNER_EMAIL, then redeploy.',
      503,
    );
  await encryptionKey(c.env);
  const { state, nonce, verifier } = await startState(c, 'login');
  const challenge = (await hash(verifier)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return c.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri: `${c.env.APP_ORIGIN}/api/auth/google/callback`, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' })}`,
  );
});
auth.get('/google/callback', async (c) => {
  try {
    const state = await consumeState(c, 'login');
    const code = c.req.query('code');
    if (!code) throw new AppError('Authorization was not completed.');
    const tokens = await providerJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${c.env.APP_ORIGIN}/api/auth/google/callback`,
        code_verifier: state.verifier,
      }),
    });
    const { payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: c.env.GOOGLE_CLIENT_ID,
      requiredClaims: ['exp', 'iat', 'sub', 'nonce', 'email'],
    });
    if (
      payload.nonce !== state.nonce ||
      payload.email_verified !== true ||
      typeof payload.email !== 'string' ||
      !ownerAllowed(c.env.ALLOWED_OWNER_EMAIL, payload.email)
    )
      throw new AppError('This Google account is not an allowed studio owner.', 403);
    const id = payload.sub!;
    await c.env.DB.prepare(
      'INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name',
    )
      .bind(id, payload.email, String(payload.name || payload.email), now())
      .run();
    const token = random(),
      csrf = random();
    const previous = getCookie(c, 'pp_session');
    if (previous)
      await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?')
        .bind(await hash(previous))
        .run();
    await c.env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)')
      .bind(await hash(token), id, csrf, Date.now() + 7 * 86400000)
      .run();
    setCookie(c, 'pp_session', token, { ...cookieOptions(c), maxAge: 7 * 86400 });
    return c.redirect(`${c.env.APP_ORIGIN}/`);
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Sign-in verification failed. Try again.';
    return c.redirect(`${c.env.APP_ORIGIN}/login?error=${encodeURIComponent(message)}`);
  }
});
auth.get('/session', requireSession, (c) => c.json({ user: c.get('user'), csrf: c.get('csrf') }));
auth.post('/logout', requireSession, async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?')
    .bind(await hash(getCookie(c, 'pp_session')!))
    .run();
  deleteCookie(c, 'pp_session', cookieOptions(c));
  return c.json({ ok: true });
});
