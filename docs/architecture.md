# Cloudflare architecture

PostPilot uses the existing React/Vite application, one Hono Worker, D1, a private R2 bucket, and a publishing Workflow. No Express process or local disk is required in production. The old API remains available with `npm run dev:legacy` for reference and migration only.

## Requests and identity

Workers Static Assets serves the SPA. `/api/*`, `/media-files/*`, `/media-delivery/*`, and `/health` execute the Worker first. Unknown API routes return JSON, not HTML. The application and API share an origin.

Studio login uses Google OIDC with PKCE, state, nonce, signature/issuer/audience/expiry verification, verified-email allowlisting, and persistent Google subject identifiers. Opaque session cookies are HttpOnly, SameSite=Lax, and Secure on HTTPS. D1 stores only token hashes. Mutations require an exact Origin and session CSRF header. Publishing OAuth is separate from sign-in and bound to the current session owner.

Provider grants use AES-256-GCM with a fresh nonce, an owner/provider context, and a versioned envelope. The persistent base64 encryption key is a Worker secret. Google refresh updates use an optimistic version check. No provider grants are returned to the browser. Logout revokes the current studio session; disconnect removes the provider grant locally (it does not revoke the grant at the provider).

## Data and uploads

SQL tables separate users, sessions, OAuth state, accounts, encrypted credentials, media, upload reservations, posts, publishing targets, runs, attempts, and settings. Ownership is checked by API queries. Media bytes stay in R2.

The browser requests a quota reservation, then uploads 8 MiB parts directly to R2 through 15-minute signed URLs. Upload manifests are retained in sessionStorage for retries within the same browser tab; reselect the same file to resume. The server completes uploads, verifies size and MIME metadata, and registers the object. MIME metadata is not a transcoding or malware inspection service. Only authenticated owners may upload.

Local development uses an authenticated bounded-part adapter to local R2. It only activates when LOCAL_UPLOADS=true and APP_ORIGIN is localhost/127.0.0.1; generated production configuration disables it.

Previews are authenticated and implement byte ranges. Providers receive object-specific HMAC-signed GET/HEAD URLs valid for two days, generated during publishing. The bucket itself stays private. Bucket lifecycle rules abort incomplete multipart uploads after two days; Cron cleans expired upload reservations and orphaned objects. Originals are never automatically deleted. Default per-owner storage quota is 50 GiB; uploads are limited to 5 GiB.

## Publishing and recovery

Post creation writes post, targets, and pending run atomically. API requests return immediately and attempt dispatch. Cron retries pending dispatch every minute and claims due scheduled posts in D1 batches. Unique active-run constraints prevent simultaneous runs for a post. Workflows receive a run ID, use stable instance IDs, and keep durable provider identifiers in D1. D1 retains run history beyond Workflow retention.

YouTube uses resumable sessions encrypted in D1. Each bounded 8 MiB chunk first probes the remote session, allowing a lost final response to reconcile to a video ID. Instagram persists its container, polls using durable sleeps, and publishes only after processing. Facebook persists the returned ID and checks video processing. Successful targets are skipped by subsequent attempts.

External APIs do not provide a universal exactly-once guarantee. Before a non-idempotent Meta publish, the target is marked `sending`. A replay reconciles Instagram container state; an uncertain Facebook result is marked for review rather than reposted. Failed/terminated Workflows are reconciled by Cron. Provider failures receive bounded retries; terminal errors stop the target. Aggregate statuses preserve partial success. Error messages are sanitized; operational IDs may appear in logs, secrets do not.

Schedule dispatch has minute-level granularity and does not guarantee a platform publication deadline. Video processing and provider quotas may delay publication. Settings can pause scheduled dispatch. The browser refreshes dashboard/calendar/library while visible; publishing runs without it.

## Scope and operations

Analytics measure this application's publishing activity, not platform likes/views. There is no video transcoding; formats, account eligibility, permissions, and provider verification still apply. Default channels and publish confirmations are persisted. Browser notifications are an optional in-app feature, not an email/push delivery service. Existing decorative search/notification/filter controls are not expanded into new product features.

Workers Paid is recommended for CPU headroom. Costs depend on retained media, requests, D1 usage, and Workflow steps/storage. R2 originals are the main growing storage cost. No automatic paid-service activation is performed. Use Cloudflare billing alerts; quotas and bounded retries are not a guaranteed account spending cap.

Use additive schema migrations. Deployment and SQL migrations are not atomic; rolling Worker code back does not undo schema changes. Back up D1 and R2 and retain the encryption key separately. Key rotation requires decrypt/re-encrypt migration; do not replace the secret directly. One production workflow serializes deployments.

References: [Workers assets](https://developers.cloudflare.com/workers/static-assets/), [Workflows](https://developers.cloudflare.com/workflows/), [D1](https://developers.cloudflare.com/d1/), [R2 signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [YouTube resumable uploads](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol).
