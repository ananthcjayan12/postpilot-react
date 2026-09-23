# PostPilot

A local-first React + Node publishing studio inspired by the selected **PostPilot** UI concept. Upload one video, publish it to **YouTube + Instagram + a Facebook Page**, or schedule it for later — without a paid scheduling service.

## What is included

- Polished React/Vite UI: Dashboard, Create Post, Calendar, Content Library, Analytics, Connected Accounts, Settings, and Login/landing screen.
- YouTube OAuth 2.0 connection using the official Google client library.
- YouTube video uploads using the official YouTube Data API v3.
- Meta OAuth connection for a Facebook Page and its linked Instagram Professional account.
- Instagram image/Reel publishing through the official Instagram Graph API.
- Facebook Page image/video publishing through the official Pages/Video API.
- Persistent local scheduler. Scheduled jobs survive API restarts.
- Local media library and post state persisted on disk.
- OAuth tokens encrypted at rest with AES-256-GCM.
- No Buffer, Hootsuite, Zapier, or paid scheduling provider.

> This repo deliberately keeps analytics permission-free. The Analytics page shows local publishing activity, not likes/views. Platform insights can be added later, but that requires additional permissions.

---

## 1. Install

Requirements: **Node.js 20+** and npm.

```bash
npm install
npm run setup
```

`npm run setup` creates `.env` and generates a unique `APP_ENCRYPTION_KEY` for local token encryption.

Then edit `.env` and add your Google + Meta app credentials.

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

API health check:

```text
http://localhost:8787/health
```

---

## 2. YouTube connection

### Google Cloud setup

1. Open Google Cloud Console and create/select a project.
2. Enable **YouTube Data API v3**.
3. Configure the OAuth consent screen.
4. For a personal/local app, set the audience to External and add your own Google account as a test user while developing.
5. Create an OAuth Client ID of type **Web application**.
6. Add this exact Authorized redirect URI:

```text
http://localhost:8787/api/oauth/google/callback
```

7. Put the Client ID and Client Secret into `.env`:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:8787/api/oauth/google/callback
```

The app requests only:

```text
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube.readonly
```

The first scope uploads videos. The second reads your own channel identity so PostPilot can show which account is connected.

### Important: Google test-mode refresh tokens

Google OAuth authorizations in **Testing** status expire after 7 days when non-basic scopes are requested. That includes refresh tokens. For a long-running personal scheduler, use an OAuth project configuration appropriate for your personal-use scenario rather than leaving the consent screen in Testing forever. Google documents a personal-use verification exception for limited-user apps, though users can still see the unverified-app warning and the user cap still applies.

---

## 3. Instagram + Facebook connection

Your Instagram account must be **Business or Creator**, and it should be linked to the Facebook Page you want to publish to.

### Meta developer setup

1. Create a Meta developer app. A Business-type app is the simplest fit.
2. Add/configure the products needed for Facebook Login / Facebook Login for Business and Instagram API access.
3. Add this redirect URL to the Facebook login OAuth settings:

```text
http://localhost:8787/api/oauth/meta/callback
```

4. Keep your own Facebook account assigned to the app as an Administrator/Developer/Tester while using the app only for your own Page/account.
5. Make sure your Facebook user has content-creation permissions on the Page.
6. Put these values in `.env`:

```env
META_APP_ID=...
META_APP_SECRET=...
META_REDIRECT_URI=http://localhost:8787/api/oauth/meta/callback
META_GRAPH_VERSION=v25.0
```

If your Facebook account manages several Pages, optionally pin one:

```env
META_PAGE_ID=1234567890
```

PostPilot requests:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
publish_video
instagram_basic
instagram_content_publish
```

For an app used only by your own app-role account(s), you can develop/test in Meta Development mode. App Review becomes relevant when you want broader Live-mode access for people outside the app roles.

---

## 4. One free requirement for Meta: a public media URL

YouTube accepts the uploaded local file directly. Instagram content publishing and the simple Facebook hosted-video publishing flow need Meta's servers to fetch your media from a publicly reachable URL.

For local development, the easiest free option is a temporary HTTPS tunnel.

### Using Cloudflare Quick Tunnel

Install `cloudflared` once, then run:

```bash
cloudflared tunnel --url http://localhost:8787
```

It prints a temporary URL similar to:

```text
https://random-words.trycloudflare.com
```

Put that into `.env`:

```env
PUBLIC_BASE_URL=https://random-words.trycloudflare.com
```

Restart `npm run dev` after changing `.env`.

No paid scheduler is involved. The tunnel only gives Meta a URL from which it can fetch the uploaded file. For a permanent deployment, replace it with the HTTPS origin of your own server.

---

## 5. Connect the accounts in PostPilot

Open:

```text
http://localhost:5173/accounts
```

Click:

- **Connect YouTube** — Google OAuth
- **Connect Facebook** / **Connect through Meta** — Meta OAuth; this also discovers the linked Instagram Professional account

The browser callbacks return to PostPilot and the tokens are stored in:

```text
apps/api/data/secrets.json
```

That file is encrypted and Git-ignored.

---

## 6. Publish or schedule

Go to **Create Post**:

1. Upload an MP4/MOV/WEBM (or image for Meta).
2. Add title + caption.
3. Select YouTube / Instagram / Facebook.
4. Choose **Publish Now** or a future date/time.

For scheduled items, PostPilot persists the job in:

```text
apps/api/data/postpilot.json
```

The API checks due items every 15 seconds and publishes them. Keep the API process running at the scheduled time.

### What each platform receives

- **YouTube:** public video upload through `videos.insert`.
- **Instagram:** video is published as a Reel; images are published as image posts.
- **Facebook:** images go to the Page Photos endpoint; videos go to the Page Video endpoint.

If one channel succeeds and another fails, the job becomes **partial** and the successful platform IDs remain stored. This prevents hiding a partial cross-post failure.

---

## Project structure

```text
postpilot/
├── apps/
│   ├── web/                 # React + Vite UI
│   │   └── src/
│   │       ├── components/
│   │       ├── pages/
│   │       └── lib/
│   └── api/                 # Express API + scheduler + OAuth
│       ├── src/
│       │   ├── integrations/
│       │   ├── lib/
│       │   └── routes/
│       └── data/            # Local runtime data (Git ignored)
├── scripts/setup.mjs
├── .env.example
└── package.json
```

## Build

```bash
npm run typecheck
npm run build
```

The Vite production bundle is written to:

```text
apps/web/dist
```

The API build is written to:

```text
apps/api/dist
```

## Git / GitHub

The zip intentionally does **not** contain a `.git` folder. After extracting it:

```bash
cd postpilot-react
npm install
npm run setup

git init
git add .
git commit -m "Initial PostPilot app"
git branch -M main
```

Then create an empty GitHub repository and add its remote:

```bash
git remote add origin git@github.com:YOUR_USERNAME/postpilot.git
git push -u origin main
```

Never commit `.env`, OAuth tokens, or uploaded media. The included `.gitignore` already excludes them.

---

## Production notes

This build is optimized for **one owner / one local workspace**. Before turning it into a multi-user SaaS, add:

- real user authentication and tenant isolation,
- a database such as PostgreSQL,
- durable job processing such as a queue worker,
- object storage/CDN for uploaded media,
- webhooks for asynchronous platform status updates,
- per-user encrypted token storage,
- formal Meta/Google app review where required for third-party users,
- rate-limit and quota dashboards.

For your stated use case — your own accounts only — this repo intentionally keeps those layers out so the setup remains free and understandable.
