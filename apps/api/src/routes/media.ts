import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { uploadsDir } from '../config.js';
import { addMedia, getMedia, loadDb } from '../lib/store.js';

mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^.a-zA-Z0-9]/g, '').slice(0, 10);
    cb(null, `${randomUUID()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('video/') && !file.mimetype.startsWith('image/')) {
      cb(new Error('Only image and video media are supported.'));
      return;
    }
    cb(null, true);
  }
});

export const mediaRouter = Router();

mediaRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file was uploaded.' });
  const asset = await addMedia({
    originalName: req.file.originalname,
    fileName: req.file.filename,
    mimeType: req.file.mimetype,
    size: req.file.size
  });
  res.status(201).json({ ...asset, localUrl: `/media-files/${asset.id}` });
});

mediaRouter.get('/', async (_req, res) => {
  const db = await loadDb();
  res.json(db.media.map((m) => ({ ...m, localUrl: `/media-files/${m.id}` })));
});

mediaRouter.get('/:id', async (req, res) => {
  const media = await getMedia(req.params.id);
  if (!media) return res.status(404).json({ error: 'Media not found.' });
  res.json({ ...media, localUrl: `/media-files/${media.id}` });
});
