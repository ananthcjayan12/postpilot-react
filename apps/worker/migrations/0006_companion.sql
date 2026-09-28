CREATE TABLE companion_devices (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL,
 last_seen INTEGER NOT NULL DEFAULT 0, capabilities TEXT NOT NULL DEFAULT '{}', revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE companion_pairs (
 code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
);
CREATE TABLE companion_jobs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL REFERENCES companion_devices(id), request_key TEXT NOT NULL,
 provider TEXT NOT NULL, task TEXT NOT NULL, input TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued', lease TEXT, lease_until INTEGER,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, result TEXT, error TEXT,
 UNIQUE(user_id, request_key)
);
CREATE INDEX companion_jobs_pending ON companion_jobs(device_id,status,created_at);
