# Deploy PostPilot through GitHub Actions

This guide assumes you have never set up Cloudflare deployment before. Follow the order below. You can deploy the basic site first, then add Google, Meta, and R2 credentials and deploy again.

## The three places you will use

- **Cloudflare dashboard:** creates deployment access and storage credentials.
- **Google Cloud Console / Meta for Developers:** creates sign-in and publishing app credentials.
- **GitHub repository settings:** stores the values safely for the automated deploy.

The code runs from GitHub Actions when you push to the `main` branch. The browser app does not contain your secrets.

## First: open the GitHub settings page

1. Open this repository on GitHub.
2. Select **Settings**.
3. In the left menu open **Secrets and variables → Actions**.
4. You will see two tabs: **Secrets** and **Variables**. Use **New repository secret** for secret values and **New repository variable** for ordinary settings.
5. For each entry below, type the name exactly as shown. Paste its value, then select **Add secret** or **Add variable**.

Secrets are hidden after saving. GitHub does not show the old value later; if you lose one, make a new credential at its provider and replace it here.

You can create the GitHub page now, but add the required initial values in the next steps before deploying.

## 1. Make the three required values

The first deployment needs just these:

| Name | Kind | How to make it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Step 2 below |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Step 2 below |
| `APP_ENCRYPTION_KEY` | Secret | Step 3 below |
| `ALLOWED_OWNER_EMAIL` | Variable | Type the email address you will use to sign in with Google |

`ALLOWED_OWNER_EMAIL` is a GitHub **variable** even though it is an email address. It is not a password. It must exactly match the verified email on your Google account. To allow more than one owner later, enter email addresses separated by commas.

Add those four values to GitHub now. Do not run the first deployment until they are saved.

## 2. Get the Cloudflare account ID and deployment token

### Account ID

1. Sign in at [Cloudflare](https://dash.cloudflare.com/).
2. Select the account where you want PostPilot deployed.
3. On the account home page, find **Account ID**. It is a 32-character string, usually shown in the account details panel. You can also open any zone, choose **Overview**, and find **API** in the right sidebar; its page shows the account ID.
4. Copy the account ID into GitHub as the secret `CLOUDFLARE_ACCOUNT_ID`.

### Deployment API token

1. In Cloudflare, open your profile menu → **My Profile** → **API Tokens**, or visit [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens).
2. Select **Create Token**, then choose **Create Custom Token**.
3. Give it a name such as `PostPilot GitHub Deploy`.
4. Grant only the account permissions needed for deployment and resource setup:
   - Workers Scripts: Edit (Cloudflare may show this as Workers Scripts Write or Workers Admin; use the role that permits creating and deploying a Worker).
   - D1: Edit.
   - Workers R2 Storage: Edit.
   - Workers Workflows: Edit, if listed separately for your account.
   - Account Settings: Read, if needed to discover your `workers.dev` subdomain.
5. Under **Account Resources**, select **Include → Specific account**, then select the account from step 2.
6. Continue through the summary and select **Create Token**.
7. Copy the token immediately. Cloudflare only reveals the token once.
8. Add it to GitHub as the secret `CLOUDFLARE_API_TOKEN`.

Do not use your Cloudflare Global API Key. If GitHub deploy reports a permission error, read the permission named by Cloudflare and add that specific permission to this token.

### Turn on the Cloudflare products once

In the Cloudflare dashboard, open **Workers & Pages** and configure the free `workers.dev` subdomain if asked. Open **R2 Object Storage** and enable it. Cloudflare may ask for billing information before enabling R2. The workflow creates the database and bucket, but it cannot accept billing terms for you.

## 3. Make the permanent encryption key

This key encrypts social-account credentials and signs temporary media links. Create it once and keep it forever (or until you deliberately perform a key migration).

On Mac or Linux, open Terminal. On Windows, use Git Bash or WSL. Run:

```bash
openssl rand -base64 32
```

Copy the single line it prints. In GitHub, add it as secret `APP_ENCRYPTION_KEY`. Save another copy in a password manager or other private backup. If the key is lost, the saved social-account connections cannot be decrypted. Do not put it in a normal GitHub variable, source file, or message.

If the `openssl` command is unavailable, use a trusted password manager's random 32-byte/base64 generator. Do not reuse a password.

## 4. Choose basic GitHub variables (optional defaults)

The workflow supplies these defaults. You may skip them for the first deployment:

| Variable | What it means | Suggested first value |
|---|---|---|
| `WORKER_NAME` | Name for the Cloudflare Worker | `postpilot` |
| `D1_DATABASE_NAME` | Name for the database the workflow creates | `postpilot-db` |
| `R2_BUCKET_NAME` | Name for the private media bucket | `postpilot-media` |
| `APP_ORIGIN` | Your website's HTTPS origin | Leave empty initially; it is discovered from `workers.dev` |
| `META_GRAPH_VERSION` | Meta API version | Leave empty to use `v25.0` |
| `META_PAGE_ID` | Optional ID to select one Page when you manage several | Leave empty unless needed |
| `STORAGE_QUOTA_BYTES` | Maximum stored media for the owner | Leave empty for 50 GiB |

If you do add `WORKER_NAME`, `D1_DATABASE_NAME`, or `R2_BUCKET_NAME`, use lowercase letters, digits, and hyphens, starting with a letter. Keep the names stable. Changing them later points the app at different resources; it does not move existing data.

## 5. Run the first deployment

1. Push the code to the GitHub repository's `main` branch.
2. On GitHub, open the **Actions** tab.
3. Select **Deploy PostPilot to Cloudflare**.
4. Select **Run workflow**, choose branch **main**, then start it.
5. Wait for the green check mark. Open the completed run and find **Cloudflare resources** in its summary.
6. Copy the **Application** URL. It looks like `https://postpilot.your-account.workers.dev`.
7. The summary also prints the Google sign-in, YouTube, and Meta callback URLs. You will use those in the provider steps below.

If this run fails, open the failed step and read its message. Common first-time issues are an API token missing D1/R2/Workers permissions, R2 not enabled, or the account's `workers.dev` subdomain not configured.

## 6. Create Google sign-in and YouTube credentials

You need a Google OAuth client for signing in and connecting YouTube. The same Client ID and Client Secret are used by both flows; PostPilot keeps studio sign-in separate from YouTube publishing consent.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in with your Google account.
2. Create a project (or select one you already use for PostPilot). The project name can be `PostPilot`.
3. In the project, open **APIs & Services → Library**. Search for **YouTube Data API v3**, open it, and select **Enable**.
4. Open **Google Auth Platform**. If Google asks to configure the consent screen, enter an app name such as `PostPilot`, your support email, and your email as the developer contact. Choose **External** if this is a personal Gmail account. If the app is in testing mode, add your Google account under **Audience → Test users**.
5. Open **Google Auth Platform → Clients** (or **APIs & Services → Credentials**, depending on the current console layout). Select **Create client** and choose **Web application**.
6. Give the client a name such as `PostPilot Cloudflare`.
7. Under **Authorized redirect URIs**, add the two exact Google URLs from the GitHub Actions summary:

   ```text
   https://YOUR-ORIGIN/api/auth/google/callback
   https://YOUR-ORIGIN/api/oauth/google/callback
   ```

   Replace `YOUR-ORIGIN` with the actual hostname and keep each URL's path exactly as printed. Do not add a trailing slash.

8. Select **Create**. Copy the **Client ID** and **Client secret**. If you close the pop-up, open the client you just created to see the ID; if Google no longer shows its secret, create a replacement secret in that client.
9. In GitHub → repository **Settings → Secrets and variables → Actions → Secrets**, create:
   - `GOOGLE_CLIENT_ID` = the full Client ID (it normally ends in `.apps.googleusercontent.com`).
   - `GOOGLE_CLIENT_SECRET` = the Client secret.
10. Rerun **Deploy PostPilot to Cloudflare** from the Actions tab.
11. Open the website URL from the deployment summary and choose **Continue with Google**. Sign in with the same email as `ALLOWED_OWNER_EMAIL`.
12. In PostPilot, open **Accounts** and select **Connect YouTube**. This is a second Google consent step for publishing.

The callback URLs have to match exactly. Google sign-in is checked against `ALLOWED_OWNER_EMAIL`, so a different Google account cannot open the studio. YouTube API quotas, testing status, and Google's verification rules still apply.

## 7. Create separate Instagram and Facebook credentials

Skip this section if you only want studio sign-in and YouTube. PostPilot intentionally uses two independent OAuth connections: direct Instagram Login for Instagram, and Facebook Login for Page publishing.

1. Open [Meta for Developers](https://developers.facebook.com/) and sign in with the Facebook account that manages your Page.
2. If prompted, complete Meta's developer registration.
3. In **Instagram API → API setup with Instagram login**, configure a Business/Creator login app. Register the exact callback printed by Actions:

   ```text
   https://YOUR-ORIGIN/api/oauth/instagram/callback
   ```

   Enable `instagram_business_basic` and `instagram_business_content_publish`. Copy the Instagram App ID and App Secret and save them in GitHub Actions secrets as `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`.

4. Configure Facebook Page Login separately. Register:

   ```text
   https://YOUR-ORIGIN/api/oauth/facebook/callback
   ```

   Make `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts` available for testing. Save the Facebook app credentials as `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.

5. In GitHub **Variables**, optionally add `META_PAGE_ID` if the Facebook account manages several Pages. Leave `META_GRAPH_VERSION` empty to use the repository default, or set a version supported by your app.
6. Rerun the GitHub deployment workflow.
7. In PostPilot **Accounts**, connect Instagram and Facebook independently.

The older `META_APP_ID` and `META_APP_SECRET` secret names remain accepted as aliases for Facebook only, so an existing deployment can migrate without breaking its Page connection.

## 8. Enable direct media uploads (R2 keys)

R2 Access Key ID and Secret Access Key are different from the Cloudflare deployment API token. The first deploy creates the private `postpilot-media` bucket, so do this after step 5.

1. In Cloudflare, open **R2 Object Storage**.
2. Open **Manage R2 API Tokens** (often in the R2 overview's account details area).
3. Select **Create API token**. Choose **Object Read & Write**. Restrict it to the PostPilot media bucket if Cloudflare offers a bucket selector.
4. Create the token and copy both **Access Key ID** and **Secret Access Key** immediately. Cloudflare only displays the secret once. These are S3-compatible credentials, not the token from My Profile → API Tokens.
5. In GitHub repository **Settings → Secrets and variables → Actions → Secrets**, add:
   - `R2_ACCESS_KEY_ID` = Access Key ID.
   - `R2_SECRET_ACCESS_KEY` = Secret Access Key.
6. Rerun deployment. The workflow keeps these credentials server-side. The React page never receives them.
7. Sign in to PostPilot and upload a small test image. Then try a supported small video. The upload should show progress and the library should show the media.

If R2 is not enabled yet, Cloudflare may first ask you to enable R2 or add billing information. Do that in Cloudflare manually, rerun the workflow, then create the bucket-scoped R2 token.

## 9. How to add or change a value later

1. Open GitHub repository **Settings → Secrets and variables → Actions**.
2. Choose **Secrets** or **Variables**.
3. Select the existing name and choose **Update** (for a secret, GitHub may instead require removing it and adding it again).
4. Save the new value.
5. Open **Actions → Deploy PostPilot to Cloudflare → Run workflow**, select `main`, and run it.

Do not change `APP_ENCRYPTION_KEY` to rotate it. That requires a separate migration. Do not change the resource-name variables unless you intend to set up a separate, empty deployment or migrate the existing data.

## 10. What each GitHub value means

### Secrets

| Exact name | Required when | Get it from |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | First deployment | Cloudflare profile → My Profile → API Tokens → scoped custom token |
| `CLOUDFLARE_ACCOUNT_ID` | First deployment | Cloudflare account home/details |
| `APP_ENCRYPTION_KEY` | First deployment | Generate once with `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Sign-in and YouTube | Google Cloud → Google Auth Platform → Clients |
| `GOOGLE_CLIENT_SECRET` | Paired with Google Client ID | Same Web application OAuth client |
| `FACEBOOK_APP_ID` | Facebook Page publishing | Meta for Developers → Facebook app settings |
| `FACEBOOK_APP_SECRET` | Paired with Facebook App ID | Same Facebook app |
| `INSTAGRAM_APP_ID` | Instagram direct login | Instagram API → API setup with Instagram login |
| `INSTAGRAM_APP_SECRET` | Paired with Instagram App ID | Same Instagram Login setup |
| `META_APP_ID` | Optional legacy Facebook alias | Existing deployments only |
| `META_APP_SECRET` | Optional legacy Facebook alias | Existing deployments only |
| `R2_ACCESS_KEY_ID` | Upload in deployed app | Cloudflare R2 → Manage API Tokens → Object Read & Write |
| `R2_SECRET_ACCESS_KEY` | Paired with R2 key ID | Same R2 token creation screen; save it when shown |

### Variables

| Exact name | What to enter |
|---|---|
| `ALLOWED_OWNER_EMAIL` | Required. Verified email for the Google account allowed to sign in |
| `WORKER_NAME` | Optional. Defaults to `postpilot` |
| `D1_DATABASE_NAME` | Optional. Defaults to `postpilot-db` |
| `R2_BUCKET_NAME` | Optional. Defaults to `postpilot-media` |
| `APP_ORIGIN` | Optional. Leave blank to use the discovered `workers.dev` URL |
| `META_GRAPH_VERSION` | Optional. Defaults to `v25.0` |
| `META_PAGE_ID` | Optional. Leave blank to choose the first eligible Page |
| `STORAGE_QUOTA_BYTES` | Optional. Defaults to `53687091200` bytes (50 GiB) |

You do not need to create `APP_ORIGIN` just to use the `workers.dev` site. If you add a custom domain later, set `APP_ORIGIN` to the complete origin such as `https://studio.example.com`, redeploy, then update every Google and Meta callback URL to use that domain.

## 11. Test the finished setup

In PostPilot, confirm that the top profile shows your Google name. Open **Accounts** and connect YouTube and Meta. Upload a small supported media file, save a draft, then schedule a harmless test post a few minutes ahead. Keep in mind that selecting **Publish Now** or a due schedule sends real content to your social accounts. The app cannot recall a post once a provider has published it.

The previous local data can be imported separately; see [the local-data migration guide](local-data-migration.md). Deployment never imports or deletes your local files automatically.

## 12. Troubleshooting

- **`Missing CLOUDFLARE_API_TOKEN` or `ALLOWED_OWNER_EMAIL`:** check spelling and whether you saved it under the `production` environment or repository Actions settings.
- **Cloudflare permission/403 error:** edit the API token and add the specific missing account permission. Confirm the token is scoped to the right account.
- **`workers.dev` subdomain missing:** configure the account's subdomain in Workers & Pages, then rerun.
- **R2 unavailable:** open R2 once in Cloudflare and enable it; the deploy workflow cannot approve billing prompts.
- **Google says redirect URI mismatch:** compare the URI in Google Auth Platform to the URL in the latest Actions summary character by character.
- **Google sign-in succeeds but says account not allowed:** make `ALLOWED_OWNER_EMAIL` match the verified Google email exactly, redeploy, and sign in again.
- **Google shows an app-testing warning:** add your account under the Google Auth Platform audience's test users.
- **Meta says URL not allowed:** put the exact HTTPS Meta callback in Facebook Login's Valid OAuth Redirect URIs and save.
- **Meta connects Facebook but not Instagram:** ensure the Instagram account is Business/Creator and linked to the selected Facebook Page.
- **Upload gets an ETag/CORS error:** check `APP_ORIGIN` matches the actual deployed site, then rerun deployment.
- **Change a secret:** update it in GitHub and rerun the workflow; never paste it into a source file.

## Local development

For local development, follow the commands in the [README](../README.md) and use `.dev.vars.example`. Local callbacks differ from production and must be registered separately. Keep local keys and production secrets different.

## Backups and rollback

Back up D1 and R2 independently and retain the encryption key securely. Additive SQL migrations are not automatically reversed if you roll code back. Do not change the encryption key directly; rotating it requires decrypting and re-encrypting the stored credentials.

Official links: [Cloudflare API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), [R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/), [Google OAuth credentials](https://developers.google.com/workspace/guides/create-credentials), [Google Auth Platform](https://console.cloud.google.com/auth/overview), [Meta for Developers](https://developers.facebook.com/apps/).

<!-- Previous condensed deployment notes retained below for reference; the beginner checklist above is current. -->

Use Node.js 22 locally. In Cloudflare, select an account, configure its Workers subdomain, and enable R2. R2 may require billing details. Workers Paid is recommended; the workflow does not activate paid plans for you.

Create an account-scoped Cloudflare API token with **Workers Scripts: Edit**, **D1: Edit**, **Workers R2 Storage: Edit**, and **Workers Workflows: Edit**. Add **Account Settings: Read** if your account requires it to resolve the Workers subdomain. Restrict it to the intended account. Custom domains additionally need the relevant zone access/Workers Routes permission. Cloudflare may change dashboard labels; consult the permission listed by a failed API operation rather than granting access to every account.

Record the account ID. This deployment token manages infrastructure. R2 S3 signing keys are separate: create an R2 API token with **Object Read & Write**, restricted to the media bucket once it exists. Save its Access Key ID and Secret Access Key. Never expose these to React.

## 2. Configure GitHub

In repository Settings → Secrets and variables → Actions, create the following. The deploy job uses the `production` environment; repository-level secrets also work unless overridden there. Environment protections are your choice. No pull request deploys to production.

| Secret | Bootstrap required? | Purpose |
|---|---|---|
| CLOUDFLARE_API_TOKEN | Yes | Provision and deploy |
| CLOUDFLARE_ACCOUNT_ID | Yes | Target account |
| APP_ENCRYPTION_KEY | Yes | Persistent token/media-signing key |
| GOOGLE_CLIENT_ID | No, required to sign in | Google Web OAuth client |
| GOOGLE_CLIENT_SECRET | Paired with client ID | Google OAuth secret |
| META_APP_ID | No | Meta integration |
| META_APP_SECRET | Paired with app ID | Meta OAuth secret |
| R2_ACCESS_KEY_ID | No, required for production uploads | R2 signing |
| R2_SECRET_ACCESS_KEY | Paired with access key | R2 signing |

Generate the encryption key once on your own machine:

```bash
openssl rand -base64 32
```

Save it in a password manager and GitHub. Never regenerate it on each deployment or commit it. Losing it loses access to encrypted grants. Changing it also invalidates provider media URLs.

| Variable | Default / purpose |
|---|---|
| ALLOWED_OWNER_EMAIL | Required; your verified Google email, or comma-separated owners |
| WORKER_NAME | postpilot |
| D1_DATABASE_NAME | WORKER_NAME-db |
| R2_BUCKET_NAME | WORKER_NAME-media |
| APP_ORIGIN | Optional; automatically resolved workers.dev origin |
| META_GRAPH_VERSION | v25.0; verify against your Meta app |
| META_PAGE_ID | Optional exact Facebook Page ID |
| STORAGE_QUOTA_BYTES | 53687091200 (50 GiB per owner) |

Names must contain 3–51 lowercase letters/digits/hyphens and start with a letter. APP_ORIGIN, if supplied, must be an HTTPS origin without trailing slash. Changing resource names creates/selects different resources; it does not migrate old data.

## 3. First deployment

Push this implementation to `main`, or open Actions → Deploy PostPilot to Cloudflare → Run workflow on `main`.

The workflow validates, tests, builds, creates/reuses D1 and R2, checks that the bucket is private, configures upload CORS and incomplete-upload cleanup, generates bindings, applies migrations, and deploys code/assets/secrets together using Wrangler's `--secrets-file`. Existing omitted Worker secrets are retained. Partial credential pairs fail validation. The temporary secret file is restricted and removed after deployment.

The Actions summary prints the public URL and these callback paths:

```text
https://YOUR-ORIGIN/api/auth/google/callback
https://YOUR-ORIGIN/api/oauth/google/callback
https://YOUR-ORIGIN/api/oauth/facebook/callback
https://YOUR-ORIGIN/api/oauth/instagram/callback
```

Bootstrap works without provider keys: the login page and health endpoint are available, private APIs deny access, and sign-in explains missing configuration. R2 keys can be added after the workflow creates the bucket.

## 4. Google configuration

In Google Cloud Console create/select a project, enable YouTube Data API v3, configure the OAuth consent screen, and create a **Web application** OAuth client. Register both Google callback URLs above as exact authorized redirect URIs. Add your owner account as a test user when the consent screen is in Testing. Add the origin if the console requests authorized JavaScript origins.

Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to GitHub. Studio sign-in requests openid/email/profile; connecting YouTube separately requests youtube.upload and youtube.readonly. Provider restrictions still apply: testing grants may expire and public YouTube uploads can require the API project's audit/verification. Hosting alone does not remove these restrictions.

## 5. Meta configuration

Configure a Meta app using Facebook Login and Instagram API with Facebook Login. Register the exact `/api/oauth/meta/callback` URL in Valid OAuth Redirect URIs. Configure the app's required URLs/domains and test roles in the Meta dashboard.

Required permissions are pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, and instagram_content_publish. Use an eligible Facebook Page and its linked Instagram Professional account. Set META_PAGE_ID when the account manages multiple Pages. App review/access level depends on who uses the integration; start with your own app-role account.

Add META_APP_ID and META_APP_SECRET to GitHub. Set META_GRAPH_VERSION to a version supported by your application. Consult the current Meta dashboard and official API documentation for account and content requirements.

## 6. Finish configuration and verify

Add the R2 object-signing credentials. Rerun the deploy workflow. Sign in with the allowed Google identity, connect YouTube and Meta on Accounts, and verify readiness. Upload a small supported image/video, inspect its preview, save a draft, then explicitly publish test content. Test a scheduled post while your browser is closed and check its result later. These tests publish content to your real accounts; automated deployment smoke checks do not publish.

Incomplete browser uploads retry parts automatically. After a network failure, reselect the same unchanged file in the same tab to resume its retained manifest. Failed channels can be retried from Library. A result marked for review is deliberately blocked from automatic retry because a duplicate may otherwise be created; inspect provider results first and use the documented reconciliation action in the library when available.

## 7. Local development

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate
npm run build
npm run dev
```

Fill `.dev.vars` with a separate local encryption key, owner email, and OAuth credentials. Register Google localhost callbacks at `http://localhost:5173/api/auth/google/callback` and `/api/oauth/google/callback`. Open localhost:5173; Vite proxies private API/media requests to Wrangler on 8787. There is no auth bypass. Local D1/R2 stay in `.wrangler/` and production deployment does not upload them.

Meta fetching and callbacks need publicly reachable HTTPS for realistic end-to-end testing. Use a separate staging deployment with different resource names and credentials; production R2 signing keys are not needed by the local upload adapter. Local Workflows emulate durable execution, but provider end-to-end behavior must be verified on HTTPS.

## 8. Operations and troubleshooting

- **Provisioning 403:** correct the account/token permissions. The workflow does not treat this as a missing resource.
- **R2 unavailable:** enable R2/billing manually, then rerun.
- **Bucket public:** use a dedicated private bucket or remove public access; the workflow refuses to silently change existing exposure.
- **Login denied:** check verified owner email, callback URI, consent-screen test users, and paired Google secrets.
- **Upload ETag/CORS errors:** verify the deployed origin matches APP_ORIGIN; rerun provisioning to update CORS.
- **Provider errors:** check Accounts, grant expiry, Page linkage, permissions, and provider quotas. Reconnect when appropriate.
- **Scheduling delayed:** check schedulerEnabled, Cron invocation logs, runs/targets in D1, and Workflows status in Cloudflare.
- **Rollback:** roll back Worker code through Cloudflare or redeploy a previous compatible commit. Do not blindly reverse SQL migrations. Use D1 backups/Time Travel when a deliberate data restore is needed.
- **Key rotation:** requires a separately reviewed re-encryption migration. Changing APP_ENCRYPTION_KEY alone breaks existing grants.

Use Cloudflare's Worker/Workflow logs for diagnostics. Do not paste tokens, signed media URLs, or full OAuth callback URLs into issue reports. Back up D1 and R2 independently and retain the encryption key securely.

For a custom domain, put the zone on Cloudflare, grant the deployment token the necessary zone permissions, and set APP_ORIGIN. The generated config binds the domain. Redeploy, update all provider callback registrations, and reconnect if required. Existing provider media URLs may reference the previous origin until they expire.

Official references: [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [R2 tokens](https://developers.cloudflare.com/r2/api/tokens/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Workflows](https://developers.cloudflare.com/workflows/).
