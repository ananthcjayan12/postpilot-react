import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from '../config.js';
import type { DbShape, MediaAsset, PostRecord, PublicAccountState } from '../types.js';

const dbPath = path.resolve(dataDir, 'postpilot.json');
const tmpPath = `${dbPath}.tmp`;

const blankAccounts: PublicAccountState = {
  youtube: { platform: 'youtube', connected: false },
  instagram: { platform: 'instagram', connected: false },
  facebook: { platform: 'facebook', connected: false }
};

const defaultDb = (): DbShape => ({
  media: [],
  posts: [],
  accounts: structuredClone(blankAccounts),
  settings: {
    schedulerEnabled: true,
    defaultPlatforms: ['youtube', 'instagram', 'facebook']
  }
});

let writeChain: Promise<void> = Promise.resolve();
let mutateChain: Promise<void> = Promise.resolve();

export async function loadDb(): Promise<DbShape> {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw) as DbShape;
    parsed.accounts ||= structuredClone(blankAccounts);
    parsed.media ||= [];
    parsed.posts ||= [];
    parsed.settings ||= defaultDb().settings;
    return parsed;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    const db = defaultDb();
    await saveDb(db);
    return db;
  }
}

export async function saveDb(db: DbShape): Promise<void> {
  writeChain = writeChain.catch(() => undefined).then(async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(tmpPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
    await rename(tmpPath, dbPath);
  });
  return writeChain;
}

export async function mutateDb<T>(fn: (db: DbShape) => T | Promise<T>): Promise<T> {
  let result!: T;
  let thrown: unknown;
  mutateChain = mutateChain.catch(() => undefined).then(async () => {
    try {
      const db = await loadDb();
      result = await fn(db);
      await saveDb(db);
    } catch (error) {
      thrown = error;
    }
  });
  await mutateChain;
  if (thrown) throw thrown;
  return result;
}

export async function addMedia(input: Omit<MediaAsset, 'id' | 'createdAt'>): Promise<MediaAsset> {
  return mutateDb((db) => {
    const asset: MediaAsset = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...input
    };
    db.media.unshift(asset);
    return asset;
  });
}

export async function getMedia(id: string): Promise<MediaAsset | undefined> {
  const db = await loadDb();
  return db.media.find((m) => m.id === id);
}

export async function upsertPost(post: PostRecord): Promise<PostRecord> {
  return mutateDb((db) => {
    const i = db.posts.findIndex((p) => p.id === post.id);
    if (i >= 0) db.posts[i] = post;
    else db.posts.unshift(post);
    return post;
  });
}

export async function updatePost(id: string, patch: Partial<PostRecord>): Promise<PostRecord | undefined> {
  return mutateDb((db) => {
    const post = db.posts.find((p) => p.id === id);
    if (!post) return undefined;
    Object.assign(post, patch, { updatedAt: new Date().toISOString() });
    return post;
  });
}
