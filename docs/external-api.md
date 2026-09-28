# PostPilot external API

The Cloudflare Worker exposes the same publishing engine used by the studio. A separate app can upload media, create drafts or scheduled posts, start publication, and read per-platform results. Supported targets are **YouTube videos and Shorts, Instagram images, Reels and image carousels, and Facebook Page images and videos**. Instagram carousels contain 2–10 images and cannot be combined with another target in one post.

## Setup and authentication

1. Deploy PostPilot and sign in to the studio.
2. Connect each target in **Accounts**. Google/Instagram/Facebook OAuth still happens in the studio browser.
3. Open **Settings → External API access**, create a named key, and copy it immediately. The raw key is displayed only once. Revoking it takes effect on the next request.
4. Send the key from your other app's **server**, using `Authorization: Bearer ppk_...`. Do not embed it in a browser or mobile binary. All keys have full access to the owner's PostPilot workspace, including publishing, deleting media or published content, settings, and AI services. Use HTTPS in production.

Base URL: `https://YOUR-ORIGIN`. JSON requests should send `Content-Type: application/json`. Browser session clients continue to use the `pp_session` cookie, matching `Origin`, and `X-CSRF-Token`. Bearer requests do not use cookies or CSRF. `/api/keys` itself requires a browser session; keys cannot mint more keys. OAuth connection and local companion device management also require the studio browser session.

For server-side integration, first call `GET /api/accounts` and check `accounts.<platform>.connected` and `readiness`. Instagram and Facebook publishing require a deployed HTTPS origin that Meta can fetch. Connecting an account or holding a key does not override provider account, permission, format, quota, or verification rules.

## Content matrix

| Media | YouTube | Instagram | Facebook Page |
|---|---|---|---|
| Single video | Video or Short | Reel | Video |
| Single image | — | Image post | Image post |
| 2–10 images | — | Carousel | — |

Uploads accept JPEG, PNG, WEBP, MP4, MOV (`video/quicktime`), and WEBM, up to 5 GiB per file. Provider-specific restrictions may be narrower. YouTube Shorts need `youtubeFormat: "short"` and `videoMetadata` with square/portrait dimensions and duration ≤180 seconds. YouTube thumbnails must be JPEG/PNG and ≤50 MiB. All media IDs in a post must belong to the same workspace.

## Upload files

The upload is multipart with **8 MiB** parts. An upload reservation expires after 24 hours. Upload each part's exact byte range; the last part may be smaller. Use the returned `partSize`, not a hard-coded value.

1. `POST /api/media/uploads` with `{"name":"clip.mp4","type":"video/mp4","size":12345678}`. Response `201`: `{"id":"uuid","partSize":8388608,"parts":2}`.
2. For each part number starting at 1, `POST /api/media/uploads/{uploadId}/parts` with `{"partNumber":1}`. Response: `{"url":"...","local":false}`. `PUT` the raw bytes to that URL. For R2 signed URLs, do not send the PostPilot bearer token. Record the `ETag` response header without enclosing quotes. In local development (`local:true`), the URL is a PostPilot endpoint and needs the bearer token; the JSON response contains `etag`.
3. `POST /api/media/uploads/{uploadId}/complete` with `{"parts":[{"partNumber":1,"etag":"..."},...]}`. Response `201` is a media asset including `id`, `originalName`, `mimeType`, `size`, and `createdAt`. A repeat completion returns `200` and the same asset.

To cancel a pending upload: `POST /api/media/uploads/{uploadId}/abort`. List and inspect completed assets with `GET /api/media` and `GET /api/media/{id}`. `DELETE /api/media/{id}` deletes the source asset and any posts using it; use carefully. The `localUrl` in asset JSON is a studio preview URL requiring a browser session and is not a public CDN URL.

Example using a small local file:

```bash
BASE='https://YOUR-ORIGIN'
KEY='ppk_REPLACE_ME'
FILE='photo.jpg'
SIZE=$(wc -c < "$FILE" | tr -d ' ')
CREATE=$(curl -fsS "$BASE/api/media/uploads" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d "{\"name\":\"photo.jpg\",\"type\":\"image/jpeg\",\"size\":$SIZE}")
UPLOAD_ID=$(printf '%s' "$CREATE" | jq -r .id)
PART=$(curl -fsS "$BASE/api/media/uploads/$UPLOAD_ID/parts" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"partNumber":1}')
URL=$(printf '%s' "$PART" | jq -r .url)
# Production R2 URL: upload bytes, then read ETag from the response headers.
curl -fsS -D /tmp/postpilot-part-headers -X PUT --data-binary "@$FILE" "$URL"
ETAG=$(awk 'tolower($1)=="etag:" {gsub(/\r|\"/,"",$2); print $2}' /tmp/postpilot-part-headers)
curl -fsS "$BASE/api/media/uploads/$UPLOAD_ID/complete" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d "{\"parts\":[{\"partNumber\":1,\"etag\":\"$ETAG\"}]}"
```

For files larger than one part, repeat the signed URL and PUT steps for each range and include every part in the final manifest. R2 CORS is configured for the studio origin; server-side HTTP clients do not depend on browser CORS.

## Create, schedule, publish, and inspect posts

`POST /api/posts` accepts:

```json
{
  "title": "Launch day",
  "caption": "Our new release is here.",
  "mediaId": "first-media-uuid",
  "carouselMediaIds": ["second-media-uuid", "third-media-uuid"],
  "platforms": ["instagram"],
  "action": "draft",
  "hashtags": "#launch #new",
  "youtubeFormat": "video",
  "thumbnailMediaId": null,
  "thumbnailText": "Optional cover headline",
  "thumbnailIdeas": "Optional art direction"
}
```

`title` (1–100 chars), `mediaId`, `platforms` (one or more of `youtube`, `instagram`, `facebook`), and `action` (`draft`, `schedule`, or `publish`) are required. `caption` defaults to `""` and is limited to 5000 chars. `hashtags` is limited to 1000 chars and applies to Instagram. `carouselMediaIds` holds up to nine additional slides, in order after `mediaId`; it requires Instagram alone. `youtubeFormat` defaults to `video`. For Shorts, supply `videoMetadata: {"width":1080,"height":1920,"duration":30}`. For scheduling, use `action:"schedule"` and a future RFC 3339 UTC timestamp, for example `scheduledFor:"2026-10-01T09:00:00Z"`.

`action:"draft"` saves without publishing. `action:"publish"` creates a post and starts an asynchronous workflow. To avoid accidental duplicate posts after a network timeout, integrations should **create a draft first**, keep its ID, then call `POST /api/posts/{id}/publish` once. `POST /api/posts/{id}/retry` retries failed targets; successful targets are skipped. `PUT /api/posts/{id}` replaces a draft or scheduled post using the same input shape with `action:"draft"` or `"schedule"`.

`GET /api/posts/{id}` returns one post. `GET /api/posts` lists all posts, newest first. These are polling endpoints; publication can take time. A `201` response with `status:"publishing"` means the workflow started, not that the provider accepted the content. Inspect `status`, `targetStatuses`, `results`, `lastError`, and `attempts` until status is `published`, `partial`, or `failed`.

Typical response (fields omitted for brevity):

```json
{
  "id": "post-uuid",
  "status": "partial",
  "platforms": ["youtube", "instagram"],
  "targetStatuses": {"youtube":"success","instagram":"failed"},
  "results": {
    "youtube": {"ok":true,"id":"provider-id","url":"https://..."},
    "instagram": {"ok":false,"error":"Provider error"}
  },
  "attempts": 1,
  "lastError": "One or more targets failed"
}
```

Target statuses include `pending`, `uploading`, `processing`, `sending`, `success`, `failed`, `review`, and `deleted`. A `review` outcome is deliberately blocked from retrying until the provider account is checked, to avoid duplicate publication. After checking it, `POST /api/posts/{id}/targets/{platform}/resolve` with `{"outcome":"published","remoteId":"provider-id","confirmation":"I checked the provider account"}` or `{"outcome":"not_published","confirmation":"I checked the provider account"}`. `DELETE /api/posts/{id}/targets/{platform}` deletes an already published provider item and updates the local result.

Scheduling uses minute-level dispatch and is subject to provider processing and quota delays. It is not a guaranteed publication deadline. `GET /api/settings` reports preferences, including `schedulerEnabled`. `PUT /api/settings` changes the entire settings object; preserve fields returned by GET. AI provider API keys can be added or removed through that route, but responses never reveal stored secrets.

## Other services

| Method | Path | Purpose |
|---|---|
| GET | `/health` | Worker health; no auth |
| GET | `/api/accounts` | Connected YouTube/Instagram/Facebook accounts and readiness |
| GET | `/api/analytics` | Workspace publishing counts and recent activity, not provider views/likes |
| GET, PUT | `/api/settings` | Workspace preferences and AI routing |
| POST | `/api/ai/suggest` | Video title/description suggestions; body `{"mediaId":"uuid","youtubeFormat":"video"}` |
| POST | `/api/ai/hashtags` | Hashtags; body `{"title":"...","caption":"..."}` |
| POST | `/api/ai/thumbnail-copy` | Cover headline; body `{"title":"...","caption":"...","feedback":"optional"}` |
| POST | `/api/ai/thumbnail` | Generated thumbnail asset; body includes `title`, `caption`, `orientation` (`horizontal` or `vertical`), optional `referenceMediaId`, `thumbnailText`, `referenceMode`, `preserveReferenceBranding`, `imageIdeas`, `regenerationFeedback` |

AI calls require the configured provider key. If a text AI route uses the local companion, `/api/ai/hashtags` or `/api/ai/thumbnail-copy` may return `202` with `jobId`. Poll `GET /api/companion/requests/{jobId}` from the signed-in studio session; companion management is currently a browser-session API.

## Responses and errors

Responses are JSON except raw part uploads. Typical success codes are `200`, `201`, and AI `202`. Errors use `{"error":"message"}`; validation errors also include Zod `details`. Common codes: `400` invalid input, `401` missing/invalid key, `403` forbidden browser-session CSRF request, `404` missing or unowned resource, `409` state conflict or review required, `410` expired upload, `413` body/quota limit, `503` missing service configuration, and `5xx` provider or server failure. Regular JSON bodies are capped at 9 MiB; upload bytes go to R2 signed URLs. Do not place tokens in URLs or logs.
