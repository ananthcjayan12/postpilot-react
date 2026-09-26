ALTER TABLE posts ADD COLUMN hashtags TEXT;
ALTER TABLE posts ADD COLUMN thumbnail_media_id TEXT REFERENCES media(id);
