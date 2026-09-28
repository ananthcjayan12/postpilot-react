PostPilot Companion runs your installed Codex or Antigravity CLI for PostPilot hashtags and thumbnail headlines.

Download the installer for your computer:
- Apple Silicon (M1 or later): `aarch64-apple-darwin.dmg`
- Intel Mac: `x86_64-apple-darwin.dmg`
- Windows x64: `x86_64-pc-windows-msvc.exe`

The app itself needs no Node.js or Rust installation. Install and sign in to a current Codex or Antigravity CLI separately. Open the companion, enter your PostPilot URL and a pairing code from website Settings, then click Start. Select the local provider in PostPilot Settings and save. Keep the companion running; closing its window leaves it in the tray/menu bar. Use Quit to stop it.

Device credentials use macOS Keychain or Windows Credential Manager. Generation uses the provider's online service and your account limits. Images and video analysis remain API-backed.

SHA-256 checksum files are included. Builds are ad-hoc signed on macOS and unsigned on Windows unless the repository maintainer configured production signing. Unsigned/unnotarized downloads can trigger OS trust warnings; signatures and checksums do not establish that a build is notarized. Follow your organization's software installation policy.
