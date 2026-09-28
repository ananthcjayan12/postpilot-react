# PostPilot Companion desktop

A Rust/Tauri desktop companion for the existing PostPilot Worker protocol. The Rust backend owns networking, pairing, credential storage, provider detection, subprocesses, and job lifecycle. A bundled HTML/CSS/JavaScript window provides the UI; it has no Node runtime, remote scripts, or shell plugin.

## For users

Download the installer from this repository's GitHub Releases:

- Apple Silicon Mac: `PostPilot-Companion-VERSION-aarch64-apple-darwin.dmg`
- Intel Mac: `PostPilot-Companion-VERSION-x86_64-apple-darwin.dmg`
- Windows x64: `PostPilot-Companion-VERSION-x86_64-pc-windows-msvc.exe`

Drag the macOS app to Applications, or run the Windows installer. Windows setup installs WebView2 if needed (internet required). The companion itself does not require Rust, Node.js, or the project source. Your selected provider CLI may have its own prerequisites.

1. Install a current Codex or Antigravity CLI and sign in through that CLI.
2. Open PostPilot Companion. Enter the PostPilot website origin and a computer name.
3. In website Settings → AI on your computer, create a pairing code and paste it into the app.
4. Click Pair, then Start. Check that your provider reports Ready.
5. Select Codex or Antigravity for hashtags/thumbnail writing in website Settings and save.

Closing the window keeps the companion running in the menu bar/system tray. Open it again from that menu, or select Quit to stop it. Pause cancels active CLI work. Opening an already-paired app reconnects it; it does not register itself to launch at OS login. Use website Settings to revoke a device. Forget pairing removes the local credential only; revoke it on the website too.

The UI supports trusted absolute executable paths when discovery cannot locate a CLI. On Windows, use the native `.exe`; npm `.cmd` wrappers are intentionally not run through a shell. Install the CLI's native binary if necessary. The app searches PATH plus common user install locations; it does not read or execute shell startup files. Missing or incompatible CLIs are reported in the UI.

CLI inference still uses the provider's online service and account limits. This release supports hashtags and thumbnail headlines; video analysis and image generation continue through PostPilot's API providers.

## Build locally

Install [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/): Rust stable and Xcode Command Line Tools on macOS, or the MSVC C++ build tools and WebView2 on Windows. Then from the repository root:

```sh
npm ci
npm run companion:desktop
# Native platform installer:
npm run companion:build -- --bundles dmg   # macOS
npm run companion:build -- --bundles nsis  # Windows
cargo test --locked --manifest-path apps/companion-desktop/src-tauri/Cargo.toml
```

Bundles are written to `src-tauri/target/release/bundle`. macOS and Windows installers should be built on their respective OS; the GitHub matrix handles both. The icon SVG is source-controlled; regenerate icons with `npx tauri icon apps/companion-desktop/icon.svg --output apps/companion-desktop/src-tauri/icons`.

## GitHub releases

`.github/workflows/companion-release.yml` tests and builds all three architectures. Pull requests and **Run workflow** produce downloadable Actions artifacts without publishing a release. Tags matching `companion-v*` publish a GitHub Release only after all matrix jobs succeed. Each installer includes a SHA-256 checksum file. A public repository is required for unauthenticated downloads; private releases need repository access.

For version 0.1.0:

```sh
# Commit the application, Worker integration, and workflow first.
git tag companion-v0.1.0
git push origin companion-v0.1.0
```

For later versions, update `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and this package's `package.json`; refresh both lockfiles. The tag must match the configured app version. Publishing a tag is a release action, so do it after review. No updater endpoint or automatic updates are enabled; users download the next installer to upgrade.

### Signing

Builds work without signing secrets: macOS uses an ad-hoc signature and Windows is unsigned. These builds are suitable for controlled testing but may be blocked by Gatekeeper or SmartScreen. For a public distribution with verified publisher identity, configure signing:

| Platform | GitHub Actions secrets |
| --- | --- |
| macOS signing | `APPLE_CERTIFICATE` (base64 Developer ID Application .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` |
| macOS notarization | `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID` |
| Windows signing | `WINDOWS_CERTIFICATE` (base64 code-signing .pfx), `WINDOWS_CERTIFICATE_PASSWORD` |

Tauri imports/signs/notarizes macOS builds with those credentials. The Windows job imports the certificate into the ephemeral runner's user certificate store and configures SHA-256 signing with a timestamp. Hardware-backed/managed signing services require adapting that signing step. Production signing credentials must belong to the publisher; they cannot be generated by this project. See [macOS signing](https://v2.tauri.app/distribute/sign/macos/) and [Windows signing](https://v2.tauri.app/distribute/sign/windows/).

## Security and behavior

- Device credentials are saved in macOS Keychain or Windows Credential Manager, never exposed to the UI or persisted in a plaintext config file. Existing Node companion credentials are not automatically imported; pair the desktop app separately.
- The desktop app only makes outbound HTTPS requests, with loopback HTTP allowed for development. Redirects are rejected and responses are bounded. Pair only with a trusted PostPilot deployment.
- The existing Worker enforces ownership, device revocation, job leases, input/result validation, queue limits, and duplicate completion handling. Deploy that Worker integration before distributing the companion.
- CLI arguments are fixed in Rust. Prompts are data, not shell strings. Codex receives its prompt through stdin; Antigravity receives a literal argument. Runtime and output are bounded. POSIX process groups / Windows kill-on-close Job Objects contain subprocess descendants; pause, lease loss, and quit stop active work.
- Temporary workspaces are deleted after the process stops. Raw CLI logs and credentials are not sent to PostPilot. Provider tools remain subject to the CLI's own sandbox/account configuration; a temporary folder is not a complete OS isolation boundary.
- One worker loop runs per desktop process. A single-instance plugin prevents duplicate app instances. The worker renews active jobs every 15 seconds, pauses on lease loss, and retries delivery up to three times without regenerating.
