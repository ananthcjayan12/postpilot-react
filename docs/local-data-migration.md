# Import the previous local application

The importer is optional and is never run by deployment. It preserves local files, preserves IDs, uploads media with multipart transfer, and inserts records only when absent. Re-running resumes at existing objects/records. It never overwrites another owner's data or existing connected credentials.

1. Back up `apps/api/data` and the old `.env` encryption key securely.
2. Deploy the new app and sign in once as the intended owner.
3. Find that user's Google subject in D1 `users.id` (or the authenticated `/api/auth/session` response).
4. Run the provisioning script locally with the same deployment environment to generate `.cloudflare-state.json`, or transfer only that nonsecret resource configuration from your trusted deployment environment. Do not commit it.
5. Dry-run the import:

```bash
node scripts/migration/import-local.mjs --source apps/api/data
```

6. Export CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY in your shell without committing them. Then explicitly apply:

```bash
node scripts/migration/import-local.mjs --apply --source apps/api/data --owner-sub YOUR_GOOGLE_SUBJECT --owner-email you@example.com
```

To also migrate credentials, supply OLD_APP_ENCRYPTION_KEY and the new APP_ENCRYPTION_KEY securely in the environment and add `--include-credentials`. The old AES-GCM envelopes are decrypted and re-encrypted with owner-bound versioned envelopes. Reconnecting accounts through the UI is an alternative that avoids transferring old provider tokens.

Scheduled and in-flight local posts import as **drafts**. Original schedules remain in your backed-up JSON; no imported post is automatically published. Inspect the imported media and results. Publish individual drafts deliberately from Library or create a new scheduled post after review. Do not run the old scheduler against the same pending posts during cutover.

Validate counts, previews, connected accounts, and selected successful-platform results before retiring the old setup. If an import fails, correct the reported problem and rerun. Orphaned R2 uploads/objects may remain after an interrupted import; identify them against D1 before deleting anything. No local files are deleted automatically.
