import { writeFileSync } from 'node:fs';
const config = {bundle:{}};
if (process.platform === 'darwin') config.bundle.macOS = {signingIdentity:process.env.APPLE_SIGNING_IDENTITY || '-'};
if (process.platform === 'win32' && process.env.WINDOWS_CERTIFICATE_THUMBPRINT) config.bundle.windows = {
  certificateThumbprint:process.env.WINDOWS_CERTIFICATE_THUMBPRINT,
  digestAlgorithm:'sha256',timestampUrl:'http://timestamp.digicert.com'
};
writeFileSync(new URL('../src-tauri/release.config.json',import.meta.url),JSON.stringify(config));
