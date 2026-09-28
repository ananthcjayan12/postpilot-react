# Local AI companion

PostPilot can optionally run text generation through the user's installed Codex or Antigravity CLI. This release supports Instagram hashtags and thumbnail headlines. Video analysis still uses Gemini; thumbnail images still use the selected API image provider. CLI execution happens on the computer, but inference uses the provider's online service and account limits.

## Desktop installer (recommended for other users)

Use the [Rust desktop companion](../apps/companion-desktop/README.md). It packages as macOS DMG and Windows EXE, uses the system credential store, and does not require Node.js or this repository on the user’s computer. The GitHub workflow builds downloadable installers; the instructions below describe the Node developer runner.

## Setup

1. Install Node.js 22+ and the PostPilot source package on your computer; run `npm ci`.
2. Install a current Codex CLI or Antigravity CLI and sign in using that CLI. Run `npm run companion -- doctor` to inspect compatibility and account readiness. Antigravity readiness checks model listing; actual generation may still fail if the account lacks model access.
3. Run `npm run companion -- pair`. Enter your PostPilot website origin, such as `https://postpilot.example.com`.
4. In PostPilot Settings, select **Create pairing code**. Paste that one-time code into the companion's prompt. It expires after five minutes. Creating a new code invalidates the previous one.
5. Run `npm run companion`. Leave it running while generating content.
6. In Settings → AI model router, select **Codex · My computer** or **Antigravity · My computer** for hashtags and/or thumbnail writing, then save.

Use the existing composer buttons to generate hashtags or a headline. Review and edit results before publishing. Generate the headline before requesting a thumbnail image. Local jobs show progress and a Cancel button; Settings also lists pending jobs after a browser refresh. Completed results are not automatically applied to another composer session.

For local development, first run `npm run db:migrate`; run PostPilot normally with `npm run dev`. Pair against the local **Worker** origin (normally `http://localhost:8787`), while creating the code in the browser at `http://localhost:5173`. The Vite dev server proxies browser API calls to the Worker.

`CODEX_BIN` and `AGY_BIN` can point to trusted executable paths. No remote request can choose a binary or arbitrary command. On Windows, use native executables or run the companion and CLIs inside WSL; `.cmd`/`.bat` wrappers are not invoked through a shell. Models use CLI defaults; Codex's user configuration is intentionally ignored for these runs.

## Device and job behavior

The companion only makes outbound HTTP(S) requests. HTTPS is required except for loopback development. No incoming port, browser extension, tunnel, or provider token upload is needed. Device tokens are stored in `~/.postpilot/companion.json` with owner-only file permissions on POSIX systems; protect that file on Windows. The Worker stores only a hash of the device token. Revoking a device in Settings immediately blocks subsequent device API requests and cancels its jobs. Existing owner allowlist restrictions also apply to device authentication.

Jobs are scoped to a user and device. The newest ready, online device for the selected provider is chosen. The queue allows three pending jobs per user and one running job per device. Jobs expire after eleven minutes. A running job has a sixty-second lease renewed every fifteen seconds. Lease loss stops local work; interrupted jobs expire rather than automatically regenerating. The companion retries result delivery up to three times without rerunning inference, and duplicate completions do not overwrite the result. Use Generate again for an explicit new attempt. Terminal job records and their text are retained for seven days, then cleaned by Cron.

Prompts contain the title, caption, requested content language, and optional headline feedback. They are stored temporarily in D1 for delivery. CLI authentication stays local. Each run uses a temporary directory removed after process exit. Output and runtime are bounded; cancellation terminates the child process group. Raw CLI stderr, prompts, and output are not uploaded as diagnostics.

Codex uses read-only sandboxing, ephemeral sessions, and ignores user config and exec rules. Antigravity uses plan mode, terminal sandboxing, and disables slash-command expansion, without permission bypass flags. Antigravity's own account settings and installed tools remain governed by its CLI; a temporary directory is not a complete OS security boundary. Both adapters request a tool-free task and validate structured output. Use a trusted CLI installation and account configuration.

## Deployment and verification

Deploy migration `0006_companion.sql` with the Worker/frontend changes. Existing deployment automation applies migrations; for a manually managed deployment, apply the migration before enabling the new UI. No new cloud secrets or bindings are required. Pairing is optional and existing API routes remain the default.

Run `npm run typecheck`, `npm test`, and `npm run build`. Worker integration tests cover pairing/CSRF, idempotent delivery, cancellation, revocation, lease expiry, and access isolation. Companion process tests cover literal stdin handling, output bounds, timeout, cancellation, and result validation. `doctor` performs local read-only CLI checks; it does not prove a live generation will succeed.
