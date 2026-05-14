CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  original_extension TEXT,
  mime_type TEXT,
  file_size_bytes INTEGER,
  sha256_hash TEXT UNIQUE,
  width INTEGER,
  height INTEGER,
  title TEXT,
  description TEXT,
  alt_text TEXT,
  captured_at TEXT,
  date_source TEXT NOT NULL DEFAULT 'uploaded_at' CHECK (date_source IN ('exif', 'file_created', 'file_modified', 'uploaded_at', 'manual')),
  date_manually_edited INTEGER NOT NULL DEFAULT 0 CHECK (date_manually_edited IN (0, 1)),
  location_name TEXT,
  location_label TEXT,
  neighborhood TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  latitude REAL,
  longitude REAL,
  location_manually_edited INTEGER NOT NULL DEFAULT 0 CHECK (location_manually_edited IN (0, 1)),
  camera_make TEXT,
  camera_model TEXT,
  lens_model TEXT,
  iso INTEGER,
  shutter_speed TEXT,
  aperture TEXT,
  focal_length TEXT,
  processing_status TEXT NOT NULL DEFAULT 'queued' CHECK (processing_status IN ('queued', 'processing', 'complete', 'failed', 'needs_review')),
  geo_status TEXT NOT NULL DEFAULT 'skipped' CHECK (geo_status IN ('queued', 'complete', 'skipped', 'failed')),
  processing_error TEXT,
  original_r2_key TEXT,
  thumbnail_r2_key TEXT,
  small_r2_key TEXT,
  large_r2_key TEXT,
  original_url TEXT,
  thumbnail_url TEXT,
  small_url TEXT,
  large_url TEXT,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photo_people (
  photo_id INTEGER NOT NULL,
  person_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_id, person_id),
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
  FOREIGN KEY (person_id) REFERENCES people (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (photo_id, tag_id),
  FOREIGN KEY (photo_id) REFERENCES photos (id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photos_processing_status ON photos (processing_status);
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos (deleted_at);
CREATE INDEX IF NOT EXISTS idx_photos_captured_at ON photos (captured_at);
